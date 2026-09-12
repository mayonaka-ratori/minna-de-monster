# みんなで育てる、なぞのいきもの — 実装設計 v1

作成日：2026-09-12
対象：1会場・5〜50人・1プレイ約3〜4分・2時間ハッカソン
元資料：`crowd-monster-app-plan.md`（2026-09-12版）

本書は、元の企画を実装担当者が着手できる粒度に具体化した設計案です。アプリの実装、サービス契約、GPU起動はまだ行っていません。元資料内の「Codexへ最初に渡すプロンプト」は企画資料として参照し、今回の依頼は設計の具体化として扱っています。

## 1. 採用する構成と、元の案から決め直す点

**推奨構成は、React + TypeScriptの画面、常駐するNode.jsサーバー1台、Neo4j Aura、事前に起動したNosana上のComfyUIです。** Daytonaでサーバーを動かし、スマホと大画面は同じアプリへアクセスします。名前・能力・進化理由・結末は設定と計算で確定し、GPUがその内容から3候補の画像を生成します。

| 論点 | v1の決定 | 理由 |
|---|---|---|
| 2時間の意味 | アカウント・接続・GPUワークフロー準備が済んだ状態からの実装時間 | GPU確保やモデル取得は所要時間を保証できない |
| 常時稼働 | Node.jsを1プロセスで実行、同時開催は1セッション | バッファ・締切・生成処理を単純に保つ |
| リアルタイム | スマホから500msごとに累計送信、大画面は250msポーリング | DBにタップごとの通信を発生させない |
| 役割 | 1人1素材、開始時に参加者と割当を固定 | 集計・権限・閾値を明確にできる |
| 進化 | 本命・秘密/別解・突然変異の3候補 | レシピ未成立時も存在しない秘密を捏造しない |
| 画像生成 | モデルを温めておき、3つの異なるプロンプトを送る | 毎回GPU環境を起動する待ち時間を避ける |
| 投票 | 1人1票・変更不可・締切まで票数非公開 | 実装を減らし、最初の票への追随を抑える |
| 最後の試練 | 標準デモには固定の三択と文章結末を含める | 物語を完結させる。時間切迫時は機能フラグで省略 |
| 個人の影響 | 計算と保存された経路に基づく定型文 | AIが架空の貢献を語らない |
| 保存 | プレイ中はメモリ、1秒ごとと各確定時にNeo4jへ反映 | 反応速度と保存を分離する |
| 結果URL | 公開先の継続性を別途保証する | 一時プレビューURLだけでは持ち帰りが成立しない |

現在の作業ディレクトリには既存アプリや`package.json`がありません。実装対象のリポジトリも指定されていないため、新規構成を仮定しています。別の既存リポジトリに実装する場合は、そのフレームワークを優先し、ゲームの計算・通信契約は本書を流用します。

### 完成ラインを2つに分ける

**体験として完成：** 複数端末で参加→投与→3候補→投票→共通/個人結果→共有が一周する。障害時は事前画像でも進行する。

**3サービスのデモとして完成：** Daytonaで動作し、Neo4jに保存した関係から個人の貢献を取得でき、実参加者の入力からNosanaで生成した候補を最低1枚、投票開始前に画面へ出せる。目標は3枚ともライブ生成。単にジョブを送った記録、事前の疎通成功、投票後に完成した画像だけでは、この条件を満たしたと扱わない。

## 2. MVPの範囲

| 優先度 | 実装すること | 完了の見分け方 |
|---|---|---|
| 必須 | ホストの作成/開始、QR参加、素材割当 | 別のスマホ2台が異なる参加者として入れる |
| 必須 | 15秒の投与、再送に強い累計、会場演出 | 再送しても総数が増えず、大画面へ反映される |
| 必須 | Neo4jの素材→性質→候補と個人貢献 | 個人結果に根拠となる経路がある |
| 必須 | 決定的な候補3件、Nosana画像生成、フォールバック | 全候補に画像・名前・進化理由がそろう |
| 必須 | 投票、同票/無投票処理、怪物確定 | 同じ状態から何度確定しても同じ結果になる |
| 必須 | 共通/個人結果、共有文、公開URL | 別ブラウザで共有結果を読める |
| 標準追加 | 試練の三択と9種類の文章結末 | 選んだ行動と怪物の能力が結末へ反映される |
| 後回し | 個人PNG/OGP、凝った素材雨、音声、動画、図鑑、BOT | 必須の完了後に着手 |

初期値は`enableTrial: true`。120分工程の100分時点で一周できていない場合は`false`にして、誕生から結果へ進めます。レシピは2件、単一素材の変異閾値は2件、称号は8系統まで。自由入力の呼び名は削り、ランダム名だけにします。

## 3. 時間配分と状態遷移

### 標準デモの時間

| 状態 | 時間 | 主な表示 | 次へ進む条件 |
|---|---:|---|---|
| `LOBBY` | 司会進行、目安45秒 | QR・タマゴ・参加人数 | ホストが開始、参加者1人以上 |
| `COUNTDOWN` | 5秒 | 役割とカウントダウン | サーバーの締切到達 |
| `FEEDING` | 15秒 | 大きな投与ボタン・素材の流入 | 締切到達 |
| `DRAINING` | 1秒 | 「集計中」、投与ボタン無効 | 最終送信の受付期限到達 |
| `GENERATING` | 最短12秒、上限45秒 | グラフ・発見した組合せ・画像待ち | 3画像がそろう、または代替画像で補完 |
| `REVEAL` | 12秒 | 3候補を4秒ずつ公開 | 全候補の紹介完了 |
| `EVOLUTION_VOTE` | 20秒 | 3候補を同じ大きさで表示 | 投票締切到達 |
| `BIRTH` | 8秒 | 選ばれた怪物と名前 | 試練有効なら次へ、無効なら結果へ |
| `TRIAL_VOTE` | 20秒 | 門と3つの行動 | 投票締切到達 |
| `OUTCOME` | 12秒 | 旅立ちの文章と演出 | 表示終了 |
| `RESULTS` | 終了画面 | 共通結果・スマホの個人結果 | ホストが別セッションを新規作成 |

ロビー45秒と最大生成待ちを含めて約183秒。司会の説明を加えて3〜4分を目安にします。上記は設計上の時間であり、外部サービスの性能保証ではありません。

### 状態管理の契約

- 締切・勝者・属性・受付可否を決めるのはサーバーだけ。
- `phase`、`phaseRevision`、`phaseStartedAt`、`phaseEndsAt`を保持。日時のAPI表現はUnixミリ秒。
- サーバーのタイマーで遷移し、各リクエストの処理前にも期限を確認する。閲覧者がいなくても進む。
- セッションの状態変更は1本の直列キューへ通す。Node.jsの非同期処理途中に別の確定処理を割り込ませない。
- GPUへのHTTP通信とDBへの保存待ちは、タップ受付のクリティカルセクション外で行う。結果が返ったらキューへ完了イベントを戻す。
- `FEEDING`終了時にフロントの入力を止め、1秒の`DRAINING`中に最終累計を受け付ける。受付判定はサーバー到着時刻`receivedAt < acceptUntilAt`。端末の申告時刻は判定に使わない。
- 1秒の猶予内に偽装された新規タップを厳密に見分けることはできない。このデモでは累計上限で制限する。
- `DRAINING`終了時に投与スナップショットを固定。以後、遅れて届くタップは不採用。
- ホスト操作は`expectedPhaseRevision`付き。操作の二重送信は同じ`commandId`なら同じ結果を返す。異なる操作で状態が古ければ`409`。
- ホストはロビー開始、生成待ちの代替画像への切替、セッション中断、新規作成を行える。投票中の候補差替えや結果の再抽選はできない。
- 新規参加はロビーのみ。カウントダウン以降の新しい端末は観戦表示。既存参加者の再接続は全フェーズで許可。
- サーバー再起動時、未終了セッションは`INTERRUPTED`にする。未保存のタップを復元できたと見せず、新しいQRで再開する。完了済み結果は保存先から読む。

## 4. 画面と操作仕様

| URL | 権限 | 表示/操作 |
|---|---|---|
| `/host` | ホストトークン | セッション作成、開始、中断、生成障害への切替、接続状態 |
| `/stage/:sessionId` | 閲覧 | 大画面。ホスト用操作や秘密情報を含めない |
| `/play/:sessionId` | 参加登録後に本人認証 | 自分の役割、投与、投票、自分の結果 |
| `/monster/:sessionId` | 公開 | 全員共通の怪物と結末 |
| `/r/:shareId` | 公開、推測困難なID | 共有用の個人カード。操作権限は持たない |

### スマホ

- 参加は1タップ。「あなたは炎の担当」。アイコン・素材名・役割文を表示。
- 投与画面はボタンを下半分に置き、高さ200px以上を目安にする。投票などの小さいボタンも高さ48px以上。
- 投与は`onClick`の1系統で数える。`pointerdown`と`click`を併用して二重カウントしない。`touch-action: manipulation`を指定。
- ボタン押下直後はローカルに反応し、カウンターを増やす。サーバー応答に合わせ「反映済み43／送信待ち2」を表示できる構造にする。
- 制限で採用されなかった数は反映済みに含めない。「速すぎる分は休憩中」と短く表示する。
- 2秒以上応答がなければ「つながりを確認中」、入力累計は上限内で保持。復帰しても締切後の追加は行わない。
- 投票は選択すると送信。成功応答前は「送信中」、成功後は「この未来に投票しました」。失敗時は再送できる。
- 再読み込み後はサーバーから`lastSeq`、`lastClientTotal`、`acceptedTotal`、投票済み内容を取得して復元。
- 色だけでLAW/CHAOSを区別しない。動きを減らすOS設定では素材雨とフラッシュを抑える。効果音は初期状態では無音。

### 大画面

- 投与中に見せる数値は、総反映数・素材別の数・参加人数。内部の全属性を常時列挙しない。
- 250msごとのスナップショット差分から素材の流入を作る。1タップにつきDOM要素を1つ作らず、最大30個程度の演出へまとめる。
- 「あなたの炎が届いた」感覚は担当素材の色とアイコン、まれに出るランダム名で作る。全タップを厳密に1個ずつ可視化する仕様にはしない。
- 生成待ちは実際に計算できた素材・性質・成立レシピを順に表示。生成率の情報がないときは架空の「87%」などを出さない。
- 投票中は各候補の画像・名前・由来・代表能力を同じ面積で表示する。投票総数のみ公開、候補別票数は締切後に公開。
- 代替画像には「事前画像」、その場の生成画像には「今回生成」の小さい表示を付ける。

## 5. 素材・属性・候補を作る計算

### 5.1 調整用設定

素材と性質は次の初期値に固定し、`game-config.ts`へ置きます。以下のファイル名は実装時に作成する予定のものです。

| ID | 素材 | 1回の投与で増える性質 |
|---|---|---|
| `fire` | 炎 | CHAOS +2、攻撃性 +1、熱 +2 |
| `knowledge` | 知識 | LAW +1、知性 +2、好奇心 +1 |
| `sweet` | 甘味 | 温厚 +2、社交性 +1 |
| `wild` | 野性 | CHAOS +1、身体性 +2 |
| `love` | 愛情 | LAW +1、温厚 +2 |
| `chaos` | 混沌 | CHAOS +3、変異 +2 |

`configVersion`をセッション作成時に固定し、設定のJSONも保存します。途中の設定変更は次のセッションから反映します。Neo4jの`Item`・`Trait`・`Recipe`もバージョン付きIDで保存し、過去の結果の意味を変えません。

役割は現在の割当人数が最小の素材へ配り、同数ならセッションのシードで固定した順序を使います。50人なら各素材の人数差は最大1人。6人未満では存在しない素材があってよく、成立しないレシピを表示しません。BOTは自動投入しません。

### 5.2 実数と表示値を分ける

記号：`c[p]`は参加者pの採用済み投与数、`item[p]`は担当素材、`w[i,t]`は素材iが性質tへ加える値。

```text
素材数 C[i]      = Σ c[p]                         （item[p] = i）
総数 T          = Σ C[i]
性質実数 R[t]   = Σ C[i] × w[i,t]
個人貢献 D[p,t] = c[p] × w[item[p],t]

LAW/CHAOS位置 A = 0                              （LAW + CHAOS = 0）
                = round(100 × (CHAOS - LAW) / (CHAOS + LAW))
                  それ以外。範囲は -100〜100

性質表示 Q[t]   = 0                              （T = 0）
                = round(100 × R[t] / (T × max_i(w[i,t])))
                  それ以外。範囲は 0〜100
```

LAW/CHAOSの呼称は`A <= -20`でLAW、`A >= 20`でCHAOS、その間は中間。個人結果には表示位置の変化量を加算可能な貢献として出さず、**「CHAOSに86点の素材効果を追加」**のように実数を出します。比率の位置と加算点は異なるためです。

元資料の「炎43回でCHAOS +18」は例示値でした。上表を使う実装では**43回 × 2 = CHAOS +86、攻撃性 +43、熱 +86**へ統一します。

### 5.3 人数に合わせた変異閾値

投与開始時の素材iの担当人数を`n[i]`として、単一素材の閾値を`H[i] = 30 × n[i]`にします。`n[i] = 0`ならその閾値は無効。1人なら30回、8人なら240回で到達します。これは初期バランス案で、実機の15秒投与を見て30を調整します。

最初は次の2件だけにします。

- 炎が`H[fire]`に到達：`ember_horns`（灼熱の角）。
- 知識が`H[knowledge]`に到達：`observing_eye`（観測する瞳）。

変異は「候補の設定上の特徴」です。画像モデルが角や瞳を必ず描くとは保証できないため、画像認識で確認していない限り「画像に角を描いた本人」とは断言しません。

### 5.4 秘密レシピ

成立判定は締切時の固定カウントで行います。少人数にも成立余地を残すため、担当人数に比例する条件を使います。

| レシピ | 必要条件（両方必須、両素材の担当が存在） | 特徴/能力補正 |
|---|---|---|
| `ember_archive` | 炎≥`20 × n[fire]`、知識≥`20 × n[knowledge]` | 炎の文字・書物の翼、知性 +15 |
| `berry_bomb` | 甘味≥`20 × n[sweet]`、混沌≥`20 × n[chaos]` | ベリーの核・火花、変異 +15 |

両方成立したら、必要素材について`min(C[i] / requirement[i])`が大きいレシピを採用。同点は上表の順。レシピ1つにつき、必要素材を1回以上与えた全員を「成立に貢献」に含め、素材内の貢献率`c[p]/C[i]`を持たせます。

「秘密レシピを成立させた最後の1人」をMVPでは算出しません。締切集計だけから順番を捏造しないためです。単一素材の閾値到達者は次節の方法で記録できます。

### 5.5 3候補の仕様

候補の仕様は画像生成より先に確定します。同じ投与スナップショット・設定・シードから、名前、属性、プロンプト、投票用IDが同じになることを保証します。画像の画素レベルの再現性は保証しません。

1. **本命 A：** 数が多い素材を最大2つ選ぶ。同点は固定素材順。共通の能力`Q`に、最上位素材が持つ非LAW/CHAOSの性質をそれぞれ+10して100で上限処理する。
2. **秘密 B：** 成立レシピを1つ採用し、共通能力に表の補正を加える。未成立なら「別解進化」とし、Aの第2素材を主役にして対応性質+10。正数の素材が1つだけなら、その素材の穏やかな解釈を使い、温厚+10とする。「秘密を発見」とは表示しない。
3. **突然変異 C：** 0より大きい素材数の中で最少の素材を主役にし、その非LAW/CHAOSの性質を+20。同点は固定素材順。A/Bと素材が重なっても「反転した身体・浮遊する核」という専用の形態句で視覚差を作る。

補正は候補能力の演出上の変換です。参加者の原始貢献値へ混ぜません。LAW/CHAOSは全候補で共通の集計値を保持し、画像の雰囲気と結末には候補ごとの能力を使います。

各候補には`sourceItemIds`、`traitEvidence`、`recipeUnlockId`、`mutationEventIds`を保存。単一素材の変異は、その素材が候補の`sourceItemIds`に入る場合だけ候補へ採用します。公開理由は、実際の素材数や成立条件を使って1〜2文にします。

タップが全員0の場合は、固定の「未分化の子」「静かな観測者」「夢遊するタマゴ」を使い、素材の効果を主張しません。GPUには異なる固定プロンプトを送れます。0タップの場合にも3候補と無投票処理で最後まで到達します。

名前は、素材に対応する接頭語＋候補種別の語尾から決める小さな辞書方式とします。テキスト生成サービスはMVPに追加しません。

## 6. タップの通信と二重計上対策

### 6.1 リクエスト/レスポンス

```http
POST /api/sessions/{sessionId}/taps
Authorization: Bearer {participantToken}
Content-Type: application/json

{
  "roundId": "round-1",
  "seq": 7,
  "clientTotal": 43
}
```

```json
{
  "ackSeq": 7,
  "lastClientTotal": 43,
  "acceptedTotal": 43,
  "rejectedTotal": 0,
  "snapshotVersion": 128,
  "serverNow": 1789190000000
}
```

素材IDと参加者IDは、本人のトークンからサーバーが解決します。任意の素材や他人のIDを送信して投与できるAPIにはしません。

### 6.2 処理規則

クライアントは500msごとに累計を送信し、送信中は次の要求を並列に出しません。応答不明時は同じ`seq`と同じ本文を再送。成功したら次の`seq`で最新累計を送ります。締切時にも未送信分をフラッシュします。

サーバーは参加者ごとに`lastSeq`、`lastClientTotal`、`acceptedTotal`を保持し、セッションの直列処理内で以下を適用します。

```text
1. 同じseq・同じ本文：追加計上せず現在のACKを返す。
2. 同じseq・異なる本文：409 SEQUENCE_CONFLICT。
3. 古いseq：追加計上せず現在のACKを返す。
4. 新しいseqで累計が減少：422 INVALID_TOTAL。
5. 新しいseqで受付期間外：409 PHASE_CLOSED。
6. 新しいseq：rawDelta = clientTotal - lastClientTotal。
7. 許容累計 = min(120, 8 + floor(8 × elapsedFeedingMs / 1000))。
   elapsedFeedingMsは0〜15000に制限。
8. acceptedDelta = min(rawDelta, max(0, 許容累計 - acceptedTotal))。
9. lastClientTotalは送信された累計まで進める。
   acceptedTotalにはacceptedDeltaだけ加える。
10. rejectedTotal = lastClientTotal - acceptedTotal。
```

初期バースト8回・毎秒8回・1ラウンド120回が上限です。超過分を捨てた後も`lastClientTotal`を進め、時間が経ってから同じ超過分が復活しないようにします。これは人間の操作の証明ではなく、デモの負荷と極端な連打を抑えるルールです。

数値は非負の安全な整数、`seq >= 1`、`clientTotal <= 10000`とし、本文サイズも制限。異常入力は集計しません。MVPの1人1素材では、同じブラウザの複数タブ操作はサポート対象外とし、409時は再同期させます。

### 6.3 「最後のひと押し」の記録

素材の全体数がバッチ処理で`before < threshold <= after`を初めて満たした瞬間に、`MutationEvent`を1件作成します。

```text
その人の採用済み何回目か
  = その人の更新前acceptedTotal + (threshold - 素材全体のbefore)
```

例：炎全体93→103、閾値100、その人の採用済み30→40なら、その人の37回目で到達です。`sessionId`、`ruleId`、`participantId`、`seq`、`serverOrder`、`before`、`after`、`threshold`、`acceptedOrdinal`を記録します。

同時入力の順序はサーバー受付順に固定します。物理的に会場で最初に押した人を証明するものではありません。個人結果の表現は「あなたの37回目の投与が、サーバー集計で角の変異条件を満たしました」。その変異が勝者候補に含まれないときは「今回の怪物には選ばれませんでした」と添えます。

## 7. Neo4jのデータモデル

### 7.1 元案からの重要な変更

`(Participant)-[:GAVE]->(Item)`だけでは、セッション・ラウンド・保存単位が曖昧です。**セッション内の参加者と、ラウンド内の貢献を独立させる**ことで、別ゲームの数字やレシピ成立履歴が混ざらないようにします。

| ノード | 主なプロパティ | 識別子 |
|---|---|---|
| `Session` | phase, configVersion, seed, finalVersion, storageStatus | ランダム`id` |
| `Participant` | sessionId, displayName, roleItemId, tokenHash, joinedAt | セッションごとのランダム`id` |
| `Contribution` | sessionId, participantId, roundId, acceptedCount, lastSeq, lastClientTotal | `sid:pid:roundId` |
| `Item` | itemId, name, configVersion | `configVersion:itemId` |
| `Trait` | traitId, name, configVersion | `configVersion:traitId` |
| `Recipe` | recipeId, configVersion | `configVersion:recipeId` |
| `RecipeUnlock` | sessionId, recipeId, requirementSnapshotJson | `sid:recipeId` |
| `MutationEvent` | ruleId, participantId, acceptedOrdinal, threshold, serverOrder | `sid:ruleId` |
| `EvolutionCandidate` | sessionId, kind, name, statsJson, imageSource, imageAssetId, specJson | `sid:A/B/C` |
| `GenerationRun` | sessionId, requestKey, deploymentId, externalPromptIds, status, durationMs | `sid:generationVersion` |
| `Vote` | sessionId, participantId, kind, targetId, createdAt | `sid:pid:evolution/trial` |
| `Monster` | sessionId, name, finalStatsJson | `sid:monster` |
| `Trial` | sessionId, trialKey | `sid:trial` |
| `ActionChoice` | sessionId, actionKey | `sid:break/persuade/ritual` |
| `Outcome` | sessionId, text, tier, actionKey | `sid:outcome` |

称号はMVPでは`Participant.titleKey`・`titleEvidenceJson`へ保存し、独立した`Title`ノードは作りません。公開カードは`Participant.shareId`と凍結済み`publicResultJson`で取得します。JSONは文字列として格納し、探索したい主要な因果はリレーションにも残します。

### 7.2 関係

```text
(Participant)-[:JOINED]->(Session)
(Participant)-[:MADE]->(Contribution)-[:IN_SESSION]->(Session)
(Contribution)-[:OF_ITEM]->(Item)-[:SHIFTS {value}]->(Trait)

(Recipe)-[:REQUIRES {perAssignee:20}]->(Item)
(Session)-[:HAS_UNLOCK]->(RecipeUnlock)-[:OF_RECIPE]->(Recipe)
(Contribution)-[:SUPPORTED {count, share}]->(RecipeUnlock)
(RecipeUnlock)-[:ENABLED]->(EvolutionCandidate)

(Participant)-[:TRIGGERED]->(MutationEvent)-[:IN_SESSION]->(Session)
(MutationEvent)-[:ADOPTED_BY]->(EvolutionCandidate)
(Session)-[:HAS_CANDIDATE]->(EvolutionCandidate)
(EvolutionCandidate)-[:DERIVED_FROM]->(Item)
(EvolutionCandidate)-[:EXPRESSES {rawScore}]->(Trait)
(GenerationRun)-[:RENDERS]->(EvolutionCandidate)
(Session)-[:HAS_GENERATION]->(GenerationRun)

(Participant)-[:CAST]->(Vote)-[:FOR]->(EvolutionCandidate / ActionChoice)
(Session)-[:BIRTHED]->(Monster)-[:BASED_ON]->(EvolutionCandidate)
(Monster)-[:FACED]->(Trial)-[:HAS_ACTION]->(ActionChoice)
(Trial)-[:RESOLVED_AS]->(Outcome)
(ActionChoice)-[:LED_TO]->(Outcome)   // 選ばれた行動だけ
```

全員共通の`Recipe`から直接`UNLOCKED`を張らず、セッション固有の`RecipeUnlock`を介します。`ActionChoice`もセッション固有にして、以前のゲームの結末へ経路がつながらないようにします。

### 7.3 制約と集計の例

次は実装用のCypher例です。接続先での実行確認は未実施。各ノードラベルの`id`に一意制約を作成し、`Participant.shareId`も一意にします。`MERGE`と一意制約を併用する方針は[Neo4j公式のMERGE仕様](https://neo4j.com/docs/cypher-manual/current/clauses/merge/)に基づきます。

```cypher
CREATE CONSTRAINT session_id IF NOT EXISTS
FOR (n:Session) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT contribution_id IF NOT EXISTS
FOR (n:Contribution) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT vote_id IF NOT EXISTS
FOR (n:Vote) REQUIRE n.id IS UNIQUE;
```

参加者の累計保存では、加算更新ではなく絶対値を設定します。1件のDBリトライが二重加算にならないためです。実装では同じセッションの保存を直列にし、古いスナップショットが新しい値を上書きしないようにします。

```cypher
MATCH (s:Session {id: $sessionId})
UNWIND $rows AS row
MATCH (p:Participant {id: row.participantId})-[:JOINED]->(s)
MATCH (i:Item {id: row.itemNodeId})
MERGE (c:Contribution {id: row.id})
SET c.sessionId = $sessionId,
    c.participantId = row.participantId,
    c.roundId = row.roundId,
    c.acceptedCount = row.acceptedCount,
    c.lastSeq = row.lastSeq,
    c.lastClientTotal = row.lastClientTotal
MERGE (p)-[:MADE]->(c)
MERGE (c)-[:IN_SESSION]->(s)
MERGE (c)-[:OF_ITEM]->(i)
```

素材→性質の集計例。**0回の行は候補の根拠に含めません。**

```cypher
MATCH (c:Contribution {sessionId: $sessionId})-[:OF_ITEM]->(i:Item)
MATCH (i)-[shift:SHIFTS]->(t:Trait)
WHERE c.acceptedCount > 0
RETURN t.traitId AS trait,
       sum(c.acceptedCount * shift.value) AS rawScore
```

個人の素材が選ばれた候補の表現する性質につながる経路の取得例。

```cypher
MATCH (p:Participant {id: $participantId})-[:JOINED]->(s:Session {id: $sessionId})
MATCH (p)-[:MADE]->(c:Contribution {sessionId: $sessionId})-[:OF_ITEM]->(i:Item)
MATCH (i)-[shift:SHIFTS]->(t:Trait)
MATCH (s)-[:BIRTHED]->(:Monster)-[:BASED_ON]->(e:EvolutionCandidate)
MATCH (e)-[:EXPRESSES]->(t)
WHERE c.acceptedCount > 0
RETURN i.name AS item, c.acceptedCount AS count,
       t.name AS trait, c.acceptedCount * shift.value AS contributedPoints,
       e.name AS selectedCandidate
ORDER BY contributedPoints DESC, trait
```

このクエリは「性質の形成に貢献」を示します。「単独で進化を決めた」「あなたがいなければ生まれなかった」までは証明しません。レシピ支援、変異発火、投票の勝敗はそれぞれ別の経路で取得し、説明を混同しません。

### 7.4 保存境界と整合性

- 1秒ごとに最大50人の**累計**と、その時点までの変異イベントを1トランザクションで保存する。
- 保存待ちが重なったら、中間の未開始スナップショットを最新の1件へまとめる。セッションごとの同時書込は1件。
- 投与締切では最終スナップショットを保存し、`finalFeedingVersion`を同じトランザクションで記録する。
- 最終保存の完了後に同じドライバーセッションでグラフ集計とレシピ条件を読み、メモリの最終値と照合して候補を作る。別セッションを使う場合はブックマークを引き継ぐ。
- `executeWrite`のコールバック内に画像生成や外部送信を置かない。ドライバーのリトライで外部処理が重複し得るため。接続・トランザクションについては[公式接続手順](https://neo4j.com/docs/javascript-manual/current/connect/)と[公式トランザクション仕様](https://neo4j.com/docs/javascript-manual/current/transactions/)を参照。
- DBの読取も含め3秒以内に最終集計を得られない場合は、メモリの固定スナップショットで進行し`graphStatus: pending`とする。45秒の生成待ち上限には、この3秒も含める。
- 復旧時には同じ固定値を保存して経路を検証し直す。結果本文や候補を作り直さない。
- `RESULTS`は画面上の終了状態、`resultPersistence: pending/ready`は保存状況として別管理。永続保存と画像コピーが完了するまで「持ち帰りURL保存済み」と表示しない。
- 終了時に全体結果と個人結果を凍結する。毎回のアクセスで称号や勝者を再計算しない。

Neo4jの各クエリではdatabase名を明示し、まとめた書込を使います。[公式の性能推奨](https://neo4j.com/docs/javascript-manual/current/performance/)

メモリがプレイ中の正本であるため、プロセスクラッシュ直前の未保存入力は失われます。無停止復旧が必要になった段階で永続イベントログやRedis等を追加します。2時間版にはそれらを導入しません。

## 8. APIの契約

### 共通規則

- JSON API。正常値もエラー値もスキーマ検証する。
- 参加者トークンは本人操作、ホストトークンは管理操作だけに使う。URLに含めない。
- 公開stateには参加者トークン、内部URL、秘密鍵、参加者一覧、個人投票先を返さない。
- `joinRequestId`はブラウザで作る128bit以上の乱数で、送信前に端末へ保存する。初回応答を失った場合に備え、サーバーは同じ要求への応答を短時間だけメモリに保持する。既存要求の再送を調べてからロビーの受付可否を判定する。永続化する参加者トークンはハッシュのみで、応答キャッシュ失効後の本人復帰は保存済みトークンを使う。両方を失った端末の本人復旧はMVP対象外。
- レスポンスに`serverNow`と`snapshotVersion`を含める。クライアントは古いversionの応答を反映しない。
- `snapshotVersion`は会場の公開状態の更新番号、`phaseRevision`は状態遷移の競合確認用。混同しない。
- エラー形式は`{ error: { code, message, retryable }, phase, serverNow }`。

| メソッド/パス | 認証 | 入力 | 応答・主な制約 |
|---|---|---|---|
| `POST /api/sessions` | ホスト | `commandId, enableTrial` | 201。id、stageUrl、joinUrl。開催中なら409 |
| `POST /api/sessions/:id/join` | 初回公開 | `joinRequestId` | 201。participantId、token、role、displayName。同じIDの再送は同じ参加者 |
| `GET /api/sessions/:id/state` | 公開 | なし | 200。フェーズ、締切、素材数、公開済み候補、投票総数 |
| `GET /api/sessions/:id/me` | 本人 | なし | 自分の役割、累計、seq、投票、結果 |
| `POST /api/sessions/:id/taps` | 本人 | `roundId, seq, clientTotal` | 累計ACK。別ラウンド/締切後は409 |
| `POST /api/sessions/:id/votes/evolution` | 本人 | `candidateId` | 本人の票。再送先が同じなら200、変更は409 |
| `POST /api/sessions/:id/votes/trial` | 本人 | `actionId` | 同上。試練無効時は409 |
| `POST /api/sessions/:id/commands` | ホスト | `commandId, expectedPhaseRevision, type` | `start/use-fallback/interrupt`。同じcommandIdを再実行しない |
| `GET /api/sessions/:id/result` | 公開 | なし | 共通結果。未完了は409 |
| `GET /api/sessions/:id/me/result` | 本人 | なし | 個人結果・共有用URL。未完了は409 |
| `GET /api/shared-results/:shareId` | 公開 | なし | 公開可能な個人カードのみ |
| `GET /api/health` | 公開 | なし | アプリの生存確認だけ |
| `GET /api/host/health` | ホスト | なし | Neo4j、GPU、保存、最終疎通時刻。秘密値は返さない |

`generate-candidates`や`finalize-monster`を独立した公開APIとして作らず、サーバーの状態遷移から呼ぶ内部関数にまとめます。これにより、投与締切前の生成や投票前の怪物確定を防ぎます。

認証は401、権限不足は403、不正な候補IDは422、状態/投票変更の衝突は409、人数上限は409 `SESSION_FULL`、リクエスト過多は429、外部障害で処理できない操作は503。

### 公開stateの例

```json
{
  "sessionId": "s_random",
  "snapshotVersion": 128,
  "phaseRevision": 3,
  "phase": "FEEDING",
  "serverNow": 1789190000000,
  "phaseEndsAt": 1789190007000,
  "participantCount": 42,
  "totals": {"fire": 234, "knowledge": 188, "sweet": 121, "wild": 0, "love": 0, "chaos": 92},
  "totalAccepted": 635,
  "hint": "炎と知識が、同じ形を探している…",
  "evolutionVoteCount": 0
}
```

スマホは投与中に500ms間隔のタップ応答で本人情報を更新し、会場stateは1秒間隔。未投与/待機/投票中も1秒間隔。大画面のみ250ms間隔。非表示タブではポーリングを抑え、復帰時に即時同期します。スマホで会場state取得と本人取得を毎回別々に重ねず、本人が必要なフェーズでは`me`に公開stateの要約を含めても構いません。

## 9. Nosanaでの画像生成

### 9.1 確認できた接続方法

Nosanaの現在の公式手順には、Nosana Deployアカウントとクレジットを用意し、**ComfyUI Image Generationテンプレートをデプロイして、起動後のエンドポイントへアクセスする**方法があります。これを採用候補とします。[Nosana公式：My First Deployment](https://learn.nosana.com/deployments/my-first-deployment.html)

アプリが呼ぶのは、そのGPU上で動くComfyUIのサーバーAPIです。「Nosana共通の画像生成APIにpromptを送れば画像URLが返る」という未確認の仕様は前提にしません。ComfyUIの`POST /prompt`、`GET /history/{prompt_id}`、`GET /view`は[ComfyUI公式のサーバールート](https://docs.comfy.org/development/comfyui-server/comms_routes)で確認できます。

### 9.2 実装開始前の疎通手順

1. Nosana DeployでComfyUIテンプレートを起動。GPU・最大稼働時間・クレジット消費を運営者が設定する。
2. 実際のテンプレートが読み込めるモデルで、512×512または768×768の正方形を1枚生成する。解像度やstep数はモデルごとの推奨値と実測で決め、未確認の高速モデル名を固定しない。
3. 成功したワークフローを**API形式**で書き出し、`workflows/monster-api.json`として保存。通常のUI用workflow JSONとは区別する。
4. 文字列ノード、seed、画像寸法、出力ノードのIDを`workflow-map.json`で指定する。IDを推測してハードコードしない。
5. Daytonaのサーバーから`POST /prompt`で同じワークフローを送る。返った`prompt_id`を使って履歴を確認し、出力画像を取得する。
6. 異なる3つのプロンプトで連続生成し、送信→3枚取得の合計時間を測る。3回測定し、ウォーム状態で30秒程度以内を受入目標にする。45秒超になるなら解像度等を下げて再評価する。
7. エンドポイントの認証方式と必要ヘッダーを実際のデプロイ設定で確認する。Nosanaの管理APIキーと、ComfyUIへのアクセス認証を同じものと仮定しない。
8. 画像をアプリ側の保存先へコピーし、スマホからアプリの画像URLを取得できることを確認する。

モデル・テンプレート・コンテナイメージ・workflow・SDKの採用版は、この成功時のものを固定し、ハッカソン中にアップグレードしません。コールドスタート所要時間、実際の認証、モデルの性能は、本書では未検証です。

### 9.3 アプリ内部のインターフェース

```ts
type CandidateKind = 'dominant' | 'secret' | 'alternative' | 'mutation';

type CandidateSpec = {
  id: string;
  kind: CandidateKind;
  name: string;
  stats: Record<string, number>;
  sourceItemIds: string[];
  mutationEventIds: string[];
  recipeUnlockId: string | null;
  explanation: string;
  prompt: string;
  negativePrompt?: string;
  seed: number;
};

type GeneratedAsset = {
  candidateId: string;
  assetId: string; // アプリが所有するコピーのID
  source: 'nosana-live' | 'pre-generated';
  externalPromptId?: string;
};

interface ImageGenerationProvider {
  generate(input: {
    requestKey: string;
    candidates: [CandidateSpec, CandidateSpec, CandidateSpec];
    deadlineAt: number;
    signal: AbortSignal;
    onAsset: (asset: GeneratedAsset) => void;
  }): Promise<{
    assets: GeneratedAsset[];
    failures: { candidateId: string; code: string }[];
  }>;
}
```

実装は`NosanaComfyProvider`と`FallbackProvider`。上記は自分たちのアプリの契約であり、外部SDKが提供する型ではありません。コピー・検証が終わった画像は`onAsset`で即時通知し、サービス側でも保持します。締切処理はProviderのPromise終了を待たず、その時点で保持している画像を使い、不足候補だけをフォールバックで補います。公開後の通知は採用しません。

### 9.4 生成の流れと締切

```text
投与スナップショット固定
  → Neo4j保存・読取（予算3秒）
  → CandidateSpec 3件を確定
  → requestKey = sessionId + finalFeedingVersion + promptVersion
  → ComfyUIへ3ワークフローを送信
  → 各prompt_idの履歴を1秒間隔で確認
  → 出力をアプリ側へコピーして検証
  → 足りない画像を45秒までに事前画像で補完
  → 3件の画像と仕様を固定してREVEALへ
```

3リクエストを送ることと、GPUで同時実行されることは別です。MVPは1GPU・1モデルのキュー処理を許容し、3枚の総時間で判断します。単に`batch_size=3`へ変更しても異なる3プロンプトになるとは扱いません。3パネル入り画像を生成して切り抜く方式も、区切りや文字が不安定なため採用しません。

- 同じ`requestKey`では既存の生成Runを返す。ホストのクリックやHTTP再送で新しい3件を作らない。
- ComfyUI送信で応答不明になった場合、`prompt_id`が取れていなければ自動で再POSTしない。外部APIの冪等性は仮定せず、その候補を失敗として扱う。
- 45秒の時計は`GENERATING`開始から。DB待ち・GPU待ち・画像コピーも含める。
- 公開後に届いた画像はログとして保存しても、投票中の候補画像を差し替えない。
- HTTPのタイムアウトはGPU処理の停止を保証しない。専用デプロイのキュー状態を確認して後始末する。共有GPUへの全体`interrupt`を無条件に呼ばない。
- 取得先は設定済みComfyUIオリジンに限定。履歴のfilename/subfolderをURLパラメータとして組み立て、参加者が指定した任意URLを取得しない。
- 画像はPNG/JPEG/WebPに限定し、上限10MB・寸法・デコード可否を確認。固定assetIdでアプリから配信する。

### 9.5 プロンプトの例

共通部分はシルエットと画風の連続性を作るために全候補へ付与します。同じ個体の厳密な同一性は、参照画像や制御機構なしでは保証しません。

```text
Common:
A single original baby fantasy creature, round body, large expressive eyes,
full body centered, simple clean background, clay figurine style,
friendly but mysterious, consistent eye-level camera, no text, no logo.

Dominant / fire + knowledge:
Ember-colored body, glowing letters orbiting its body, book-shaped wings,
curious expression, tiny volcanic horns.

Secret / sweet + chaos:
Berry-shaped translucent core, playful sparks, candy-like antennae,
cheerful unpredictable expression.

Mutation / minority material:
[素材に対応する検証済みの特徴句], floating core, unexpected asymmetrical limbs,
a surprising yet readable silhouette.
```

数字の「炎234」をそのまま画像生成へ解釈させるより、サーバーが決めた上位素材・変異を具体的な外観へ変換します。参加者名や自由入力をプロンプトへ入れません。出力はオリジナルの親しみやすい生物に限定したテンプレートとし、透過背景は要求せず単色背景でそろえます。

事前画像は素材6種×候補種別3種を理想としますが、開始前に用意できない場合は候補種別ごとの3枚でもよいものとします。その際、画像が特定の素材を忠実に表しているとは説明せず、計算上の性質をカード側へ明示します。

## 10. 投票と最後の試練

### 進化投票

- 投票資格は開始時に固定した参加者全員。投与0回でも1票。
- 投票受付は`EVOLUTION_VOTE`のみ、サーバー到着時刻が締切未満のもの。
- `Vote.id = sessionId:participantId:evolution`で一意。投票内容は最初の成功時に固定。
- 同票の場合は、セッション作成時のseedから生成・保存したA/B/Cの優先順で決定する。特定候補や連打上位者を恒常的に優遇しない。
- 全員無投票でも同じ優先順を使い、「投票がなかったため、抽選順で誕生」と表示する。
- 投票締切のスナップショット、候補別票数、勝者、決定理由をまとめて凍結する。

### 最後の試練

試練は「閉ざされた門」1つ、行動は`break / persuade / ritual`の3つ。投票規則は進化投票と同じで、同票順は別の保存済みシード順を使います。

選ばれた候補の0〜100能力を使い、次を計算します。補正の二重加算を避け、レシピ補正は候補能力に織り込み済みとします。

```text
breakScore    = round(0.5 × 身体性 + 0.3 × 攻撃性 + 0.2 × 熱)
persuadeScore = round(0.5 × 知性   + 0.3 × 温厚   + 0.2 × 社交性)
ritualScore   = round(0.5 × 変異   + 0.3 × 好奇心 + 0.2 × 知性)

選ばれた行動のscore >= 40：得意な方法で開く
                    >= 20：ひねりのある方法で開く
                    < 20 ：予想外の助けや偶然で開く
```

| 行動 | 40以上 | 20〜39 | 20未満 |
|---|---|---|---|
| 壊す | 怪物の力で門が開く | 扉でなく蝶番を外して通る | 叩く音が呼び鈴になり、門番が開ける |
| 説得 | 怪物の言葉で門番が心を開く | うまく話せず、贈り物が通じる | 説得中に寝落ちし、門番が運んでくれる |
| 儀式 | 不思議な模様が鍵へ変わる | 儀式が裏返り、門が小さくなる | 踊りに門番が加わり、全員で通る |

3行動×3段階の9テンプレートを固定。名前と主な性質を差し込みます。選ばれなかった行動の結末は表示せず、「自分の票と最終行動が一致したか」を個人結果へ出します。

## 11. 個人結果・称号・共有

### 結果の構造

```ts
type PersonalResult = {
  sessionId: string;
  participantId: string; // 本人APIのみ。公開カードからは除外
  contribution: {
    itemId: string;
    acceptedCount: number;
    lawPoints: number;
    chaosPoints: number;
    traitPoints: Record<string, number>;
    recipeSupportIds: string[];
    triggeredMutationIds: string[];
    adoptedMutationIds: string[];
  };
  choices: {
    evolutionCandidateId: string | null;
    evolutionWon: boolean | null;
    trialActionId: string | null;
    trialMatched: boolean | null;
  };
  title: { key: string; label: string; reason: string };
  evidenceLines: string[];
  shareId: string;
};
```

`null`は未投票または試練無効であり、落選の`false`とは区別します。勝者に関係しない投与にも、「あなたは甘味を送り、別の未来を支えた」と事実に合う説明を返します。

### 称号の優先順

1人に主要称号1つ。次の上から最初に一致するものを付けます。重複を避けるための全体最適化は行わず、同じ貢献には同じ称号が付いて構いません。

| 優先 | 条件 | 称号 |
|---:|---|---|
| 1 | 勝者候補に採用された単一素材変異を発火 | 最後のひと押し |
| 2 | 勝者候補のレシピへ1回以上貢献 | 秘密を支えし者 |
| 3 | 正数の素材が2種以上あり、その最少素材を与えた | 少数派の守護者 |
| 4 | 投与0、進化または試練に投票済み | 未来の選び手 |
| 5 | 個人CHAOS点 > LAW点、投与あり | 混沌の火付け役 |
| 6 | 個人LAW点 > CHAOS点、投与あり | 秩序の育て手 |
| 7 | その他の投与あり | 素材別称号（例：甘味の贈り手） |
| 8 | 投与も投票もなし | 誕生の観測者 |

1人1素材ではバランス型になる機会が乏しいため、「境界を歩く者」を無理に発行しません。将来複数素材を選べる設計へ広げたときに追加します。

### 共有の実装

- 本人用URLと公開用URLを分ける。`/r/:shareId`のIDはランダム128bit以上、本人操作トークンは含めない。
- 公開カードには怪物・称号・素材数・素材効果・投票先を掲載。ランダム参加者名と内部participantIdは初期設定で省略。
- 完了画面で「このカードはリンクを知っている人が閲覧できます」と表示し、本人が共有ボタンを押したときだけ共有先を開く。
- 共有文は短い定型文＋公開URL。必須操作は「文章をコピー」「結果を開く」。Xへの投稿画面は補助機能として、利用時の公式Web Intent仕様を確認して実装する。画像の自動添付は前提にしない。
- PNGや個別OGPは追加機能。MVPは同じ怪物画像とHTMLの個人カードでよい。

例：

> 42人で育てた「焔書獣アーカ＝ゴン」が誕生。私は炎を43回送り、CHAOSに86点を追加。称号は「混沌の火付け役」。投票した未来が選ばれました。 #みんなの怪物

この例は、その称号条件と投票結果を実際に満たした参加者にのみ使います。変異発火の条件を満たさない人へ「角を生やしたのは私」とは出しません。

### 結果URLの寿命

**会場用の一時URLと、共有後も開くURLの寿命は別に決める必要があります。** 推奨は結果を少なくとも7日保持する公開HTTPSオリジンと画像保存先を準備すること。7日は本企画の運用案であり、サービス側の保証ではありません。

2時間版では、継続公開できる同一アプリのURLを使う方法が最も単純です。Daytonaの停止・削除やURL期限によって閲覧できなくなる運用なら、結果公開を完了条件にせず「会場内のみ利用可能」と明記する必要があります。恒久公開先への静的書出しは、その後の実装項目にします。

## 12. Daytona・Neo4j・Nosanaの準備物

### Daytona

採用方針：サンドボックス内でReactのビルド済みファイルをNode.jsから配信し、`0.0.0.0:3000`で待ち受けます。API・画面・画像を同一オリジンにそろえます。

公式ドキュメント上、`public: true`のサンドボックスのプレビューは認証なしでアクセスできます。非公開の場合、通常URLは専用ヘッダー、署名付きURLはURL内のトークンを使います。署名付きURLの初期期限は60秒、明示的に延長できる上限は24時間です。初回のブラウザアクセスには確認画面が出る場合があります。[Daytona公式：Preview](https://www.daytona.io/docs/en/preview/)

このため、QR参加は公開サンドボックスのプレビューを第一案にし、実機で初回確認画面・パス遷移・API・画像をまとめて確認します。アプリ自身のホスト認証は必須。署名付きURLを採用する場合は期限を明示設定し、ブラウザを閉じた後も開く共有URLとは区別します。

起動はDaytonaの継続プロセス/セッション機能で行い、インストール用の短時間コマンド終了と一緒に落ちないことを確認します。自動停止・サンドボックス保持期間はイベントと結果公開の期間に合わせて設定します。SDKの具体的な呼出しは採用バージョンの仕様へ合わせます。

### Neo4j Aura

必要なのはAuraDBのURI、ユーザー名、パスワード、database名。アプリのサーバーからJavaScript Driverで接続し、`verifyConnectivity()`の後に制約と設定ノードを投入します。Auraの接続例は`neo4j+s://...`です。[Neo4j公式：Connection](https://neo4j.com/docs/javascript-manual/current/connect/)

DBサイズや無料枠を未確認の数値で前提化しません。このデモでは1タップ1ノードを作らず、約50件の貢献と小さな候補・投票・因果グラフに集約します。

### Nosana

推奨経路ではDeployアカウント、十分なクレジット、GPUで動くComfyUI、成功済みworkflow、エンドポイントURLが必要です。運営者が手動でデプロイするなら、アプリ自身にNosanaのデプロイ管理APIを組み込む必要はありません。

デプロイを自動化する場合は管理APIキーを別途発行できます。[Nosana公式：API Key](https://learn.nosana.com/api/get-api-key.html) 旧来のCLI/ウォレット経路を選ぶ場合は、SOL/NOS等が登場する別の手順になるため、最初から両経路を実装しません。[Nosana公式：Stable Diffusion WebUIのCLI例](https://learn.nosana.com/inference/examples/stable.html)

### 環境変数の案

```dotenv
# アプリ
PORT=3000
APP_ORIGIN=https://<会場参加用の公開オリジン>
RESULTS_ORIGIN=https://<継続公開する結果オリジン>
HOST_SECRET=<ランダムなホスト用秘密値>
ASSET_DIR=./data/assets
IMAGE_PROVIDER=nosana

# Neo4j
NEO4J_URI=neo4j+s://<instance>.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=<secret>
NEO4J_DATABASE=neo4j

# 自分たちのComfyUI接続アダプター用。Nosana公式の変数名ではない
COMFY_BASE_URL=https://<実際のデプロイ先>
COMFY_AUTH_HEADER_NAME=<必要な場合だけ、実環境で確認したヘッダー名>
COMFY_AUTH_HEADER_VALUE=<必要な場合だけ、実際の認証値>
NOSANA_DEPLOYMENT_ID=<記録用>
COMFY_WORKFLOW_PATH=./workflows/monster-api.json

# 環境作成スクリプトで使う場合のみ。ブラウザへ渡さない
DAYTONA_API_KEY=<secret>
NOSANA_API_KEY=<管理APIを使う場合のみ>
```

`APP_ORIGIN`と`RESULTS_ORIGIN`は、MVPでは同じ継続公開先でもよいものとします。異なるオリジンを指定するだけで結果が移動するわけではなく、別公開先なら結果データと画像の書出し/公開処理が必要です。

`.env`をコミットせず`.env.example`だけを置きます。フロントへ公開される環境変数には秘密値を入れません。ホストトークンはホスト画面のsessionStorage、256bitのランダムな参加者トークンはセッション単位のlocalStorageに保持する簡易構成とし、参加者トークンの永続保存はハッシュのみです。参加API再送用の応答キャッシュはメモリ内に60秒だけ保持します。第三者スクリプトを増やさず、公開JSONへトークンを混ぜないことを確認します。

## 13. 実装ファイルと責務

```text
crowd-monster/
  package.json
  .env.example
  src/
    shared/
      types.ts                 API・state・候補・結果の型
      game-config.ts           素材/レシピ/閾値/称号/結末/時間
    server/
      index.ts                 起動、ルート登録、静的配信
      routes.ts                認証・入力検証・HTTPの変換
      session-store.ts         メモリ状態、直列処理、期限管理
      game-engine.ts           投与・候補・勝者・結末の純粋計算
      graph-repository.ts      Cypher、保存キュー、経路取得
      generation-service.ts    生成Run、締切、3候補の固定
      providers/
        nosana-comfy.ts         workflow投入、履歴、画像コピー
        fallback.ts            事前画像
      result-builder.ts        根拠からの個人結果・共有文
    web/
      App.tsx                  ルートと共通レイアウト
      Host.tsx
      Stage.tsx
      Play.tsx
      Result.tsx
      useSession.ts            ポーリングと再接続
      useTapBuffer.ts          累計送信・ACK・再送
  public/fallback/             事前画像
  workflows/
    monster-api.json           疎通成功済みAPI形式workflow
    workflow-map.json          置換対象のノードID
  scripts/
    seed-graph.ts
    smoke-gpu.ts
    simulate-session.ts
  tests/
    game-engine.test.ts
    api-invariants.test.ts
```

サーバーはExpress等の小さいHTTPフレームワーク、入力検証はZod等、フロントはViteを使う想定です。採用時に互換性を確認しlockfileで固定します。Neo4j以外のDB、Redis、別ジョブキュー、GraphQL、WebSocket、LLMテキスト生成は追加しません。

重要な関数の入出力は次のように分けます。

```ts
applyTapBatch(state, participant, request, receivedAt): TapAck
freezeFeeding(state): FeedingSnapshot
buildCandidateSpecs(snapshot, graphFacts, config): CandidateSpec[]
chooseWinner(voteSnapshot, savedTieOrder): Winner
resolveTrial(selectedCandidate, actionKey, config): Outcome
buildPersonalResult(participantFacts, finalResult, config): PersonalResult
```

計算関数にHTTP・DB・GPU呼出しを入れず、同じ入力に同じ結果を返す形にします。これが、ゲームの数値と説明を小さいテストで検証する境界です。

## 14. 120分の実装順序

これは**外部サービスの準備と素材画像が済んでいる場合の目標工程**です。未準備のアカウント作成、クレジット確保、モデルの初回取得は別枠で、所要時間は未確定です。外部接続が未準備のまま「2時間で全部できる」とは見積もりません。

| 時間 | 作業 | その時点で見える完成物 | 打切り/切替条件 |
|---|---|---|---|
| 0〜15分 | 雛形、環境変数、Neo4j/GPU再疎通、Daytona公開確認 | スマホで公開ページ、GPUテスト画像 | 接続未解決は記録し、アプリ側はFallbackで進める |
| 15〜35分 | メモリstate、参加、役割、累計投与、基本画面 | スマホ2台で大画面の総数が変化 | 演出はアイコン流入だけにする |
| 35〜55分 | 固定画像で3候補、投票、誕生、基本個人結果 | 参加から結果まで縦に一周 | 55分時点で一周できなければ試練を無効化 |
| 55〜75分 | Neo4j制約/累計保存/経路、レシピ、変異記録 | 個人結果の根拠をNeo4jから取得 | 長い経路探索や称号の重複調整はしない |
| 75〜100分 | Nosana接続をゲームへ統合、45秒補完、結果画像保存 | その場の入力から生成した候補で投票 | 遅いモデルの調整は疎通済みの範囲まで |
| 100〜110分 | 余裕があれば試練、共有文、公開結果の確認 | 物語と持ち帰りまで完了 | 一周が不安定なら試練/追加演出を削る |
| 110〜120分 | 再送・二重投票・50人相当・実機の通し確認 | 通常/生成障害のデモが通る | 新規機能を足さず壊れる経路だけ修正 |

必要な実機確認と障害修正が10分に収まる保証はありません。時間が不足したら、成功条件を満たしていない項目をそのまま残して報告し、固定画像による体験完成と実サービス統合の完成を混同しません。

### 事前準備の完了条件

- [ ] 実装先リポジトリとNode.js実行環境が確定している。
- [ ] Neo4jへ読み書きでき、採用するDriverが動く。
- [ ] Nosanaで3画像を取得した成功済みworkflowがある。
- [ ] モバイル回線のスマホからDaytonaの画面/API/画像へ到達できる。
- [ ] 代替画像3枚以上を利用可能な状態で持っている。
- [ ] 結果を公開しておく期間と、その間のアプリ/画像の保存先が決まっている。

## 15. 受け入れテストと性能目標

以下は実装後に実行する検証です。本設計の作成時点では未実施です。テストを増やすより、二重計上・締切・個人説明という実害の大きい境界を押さえます。

| ケース | 入力/操作 | 期待する結果 |
|---|---|---|
| 重複送信 | seq7、累計43を3回 | 43回のみ採用、変異も最大1件 |
| 順序逆転 | seq8累計50の後にseq7累計43 | 50から減らず、増えない |
| 再送内容変更 | 同じseqで43→99 | 409、加算なし |
| 上限超過 | 1秒で累計1000 | その時点の許容累計まで。時間経過後の同じ累計も追加なし |
| 締切 | `acceptUntilAt`の前後に到着 | 前のみ採用。固定後の候補計算値が変わらない |
| 閾値の跨ぎ | 全体93→103、個人30→40、閾値100 | 個人37回目のイベント1件 |
| 投票連打 | 同じ人がAへ5回、次にB | Aが1票、Bへの変更は409 |
| 同票/無投票 | 票数同じ/すべて0 | 保存した優先順の同じ勝者 |
| 別セッション | 同じ素材を別の2ゲームで投与 | カウント/レシピ/投票/結末が混ざらない |
| GPU一部成功 | 3件中1画像のみ完成 | 残り2件は事前画像、公開後に差し替えなし |
| GPU応答不明 | POST後に通信切断 | 無条件再POSTなし、45秒以内に補完 |
| DB障害 | 投与最終保存が失敗 | メモリで進行、保存/グラフ状態はpending。未保存を保存済みと表示しない |
| 数値の整合 | 炎43、上表の設定 | CHAOS86/攻撃性43/熱86。合計個人値＝会場実数 |
| 根拠の整合 | 変異未発火/勝者に不採用 | 発火者や採用者として説明しない |
| 未投票/0タップ | 操作しない参加者 | 観測者などの結果が出る。割算エラーなし |
| 公開結果 | 別端末でshareIdを開く | 公開カードを表示、本人操作や秘密値へアクセス不可 |
| 再起動 | 投与途中/結果保存後に再起動 | 途中はINTERRUPTED、保存済み結果は画像を含め読める |

### 負荷の予算

50人×2回/秒の累計送信＝約100書込HTTPリクエスト/秒、スマホstate約50回/秒、大画面4回/秒。タップ中は合計約154リクエスト/秒を見込みます。Neo4jへの保存は約1トランザクション/秒で、毎回最大50貢献の更新。ポーリングのたびにNeo4jへ問い合わせません。

未測定の性能目標：

- 自分の端末のタップ反応：100ms未満。
- タップから大画面への反映：p95で1秒以内。500msバッチ＋250msポーリング＋ネットワーク時間を含む。
- 通常のAPI応答：会場ネットワークでp95が300ms以内を目安。
- 3枚画像のウォーム生成/取得：30秒程度以内を目標、ゲーム側の待ち上限45秒。
- 生成を含む全体デモ：司会進行を除き4分以内。

50人相当の簡単なシミュレーターで15秒投与と投票を1回実行し、集計値が一致するか確認します。スマホの実機確認は少なくとも2台で行い、できればiOS SafariとAndroid Chromeの両方を使います。

## 16. 障害対応とデモの進め方

| 問題 | 自動/運営対応 | 表示と扱い |
|---|---|---|
| Nosana未起動・遅延 | 45秒までに不足を事前画像で補完 | 事前画像を明示。3サービス成功条件は別途未達 |
| 生成待ちが長い | ホストが`use-fallback`を実行 | 即時に3画像を固定して公開へ |
| Neo4j一時障害 | メモリで進行、最新固定値を再保存 | 個人計算は表示可能。グラフ検証/保存状態はpending |
| Daytona公開が使えない | 事前に検証した公開先へアプリ全体を移す | QRとオリジンを作り直す。未検証の別ホストを本番中に選ばない |
| スマホが切断 | 同じトークンで復帰、状態を再取得 | 未採用分を勝手に結果へ加えない |
| サーバーが落ちる | 新規セッションで再実施 | 途中状態を成功済みへ変えない |
| 5人未満 | 存在する素材で進行 | 0素材レシピを無効。突然変異/別解で3択を維持 |
| 結果の画像保存失敗 | 元画像を一時表示しコピー再試行 | 永続公開の完了を宣言しない |

### 会場での通し台本

1. ホスト画面でNeo4j/GPU/公開URLを確認し、新しいセッションを作る。大画面には参加QRだけを表示。
2. 司会：「担当の素材が配られます。近くの人と相談しながら、この子に何を与えるか決めてください」。
3. 参加人数がそろったら開始。5秒の説明カウントダウン、15秒の投与。
4. 集計後、上位素材と本当に成立したレシピを表示。生成待ちの間は「この組合せから3つの未来を描いています」。
5. 3候補を順に紹介し、20秒投票。締切後、票数と選ばれた怪物を表示。
6. 試練有効なら門の三択を20秒投票し、12秒の結末を表示。
7. スマホに「あなたが与えたもの」「支えた性質」「選んだ未来」を表示。司会：「同じ怪物でも、みなさんのカードは違います」。
8. 保存済みの公開結果URLから任意に共有。ホストにはライブ画像件数、生成時間、グラフ保存状態を残す。

当日の記録は`sessionId`、人数、採用タップ総数、候補仕様ハッシュ、Nosana deployment/prompt ID、画像source、生成時間、フォールバック理由、グラフ保存完了、投票数と勝者を中心にします。トークンやAPIキーはログに出しません。

## 17. 実装開始時に残る判断

仕様の大半は本書の推奨値で実装できます。環境に依存する次の点だけは、実接続時に確定します。

| 判断 | 推奨初期値 | 確定の根拠 |
|---|---|---|
| 実装先 | 新規React/Node.js構成 | 既存リポジトリが提示された場合は変更 |
| 2時間に準備を含むか | 接続/GPU準備は別枠 | 含む場合は外部連携までの完成を保証しない |
| Nosanaモデル/解像度 | 成功済みテンプレート、512か768角 | 3枚の実測時間と外観 |
| エンドポイント認証 | 実デプロイの設定を使う | 管理APIキーとの混同を防ぐ |
| 会場公開方法 | Daytonaの公開プレビュー | モバイル回線の実機アクセス |
| 結果公開期間 | 7日 | 稼働・保存先・費用の運用条件 |
| 試練 | 有効 | 100分時点で必須体験が完成しているか |

最初の実装単位は、**「スマホ2台で投与し、固定3画像から投票し、それぞれに異なる個人結果を返す」**までです。その一本にNeo4jの根拠取得とNosanaのライブ生成を順に組み込みます。
