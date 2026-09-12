export type Lang = 'en' | 'ja';
export type Text = { en: string; ja: string };
export const bi = (en: string, ja: string): Text => ({ en, ja });
export const traits = ['law','chaos','intelligence','curiosity','gentle','social','body','aggression','heat','mutation'] as const;
export type Trait = typeof traits[number];
export type Stats = Record<Trait, number>;
export const zero = (): Stats => Object.fromEntries(traits.map(t => [t, 0])) as Stats;
export const traitNames: Record<Trait, Text> = {
  law: bi('LAW','LAW'), chaos: bi('CHAOS','CHAOS'), intelligence: bi('Intellect','知性'), curiosity: bi('Curiosity','好奇心'),
  gentle: bi('Kindness','温厚'), social: bi('Charm','社交性'), body: bi('Strength','身体性'), aggression: bi('Ferocity','攻撃性'), heat: bi('Heat','熱'), mutation: bi('Wonder','変異')
};
export const items = [
  {id:'fire', icon:'🔥', name:bi('Ember','炎'), color:'#ff936e', role:bi('Bring a little fire to its future.','未来に、小さな炎を。'), weights:{chaos:2,aggression:1,heat:2}},
  {id:'knowledge', icon:'📘', name:bi('Knowledge','知識'), color:'#8bbfff', role:bi('Give this little mind something to wonder about.','この子に、不思議を教えよう。'), weights:{law:1,intelligence:2,curiosity:1}},
  {id:'sweet', icon:'🍓', name:bi('Sweetness','甘味'), color:'#ff91bf', role:bi('Make its world a little sweeter.','世界を、少し甘くしよう。'), weights:{gentle:2,social:1}},
  {id:'wild', icon:'🦴', name:bi('Wildness','野性'), color:'#ddcaaa', role:bi('Wake up its wild side.','眠っている野性を呼び起こそう。'), weights:{chaos:1,body:2}},
  {id:'love', icon:'🌸', name:bi('Affection','愛情'), color:'#d5a8ff', role:bi('Teach it how to care.','誰かを思う心を育てよう。'), weights:{law:1,gentle:2}},
  {id:'chaos', icon:'✹', name:bi('Chaos','混沌'), color:'#d9f77f', role:bi('A little unpredictability goes a long way.','予想外を、ひとさじ。'), weights:{chaos:3,mutation:2}}
] as const;
export type ItemId = typeof items[number]['id'];
export const itemById = (id: ItemId) => items.find(i => i.id === id)!;
export const recipes = [
  {id:'ember_archive', required:['fire','knowledge'] as ItemId[], trait:'intelligence' as Trait, name:bi('The Ember Archive','焔の書庫')},
  {id:'berry_bomb', required:['sweet','chaos'] as ItemId[], trait:'mutation' as Trait, name:bi('The Berry Paradox','苺のパラドックス')}
];
export const phases = ['LOBBY','COUNTDOWN','FEEDING','DRAINING','GENERATING','REVEAL','EVOLUTION_VOTE','BIRTH','TRIAL_VOTE','OUTCOME','RESULTS','INTERRUPTED'] as const;
export type Phase = typeof phases[number];
export const durations: Partial<Record<Phase, number>> = {COUNTDOWN:5000,FEEDING:15000,DRAINING:1000,GENERATING:45000,REVEAL:12000,EVOLUTION_VOTE:20000,BIRTH:8000,TRIAL_VOTE:20000,OUTCOME:12000};
export const actions = [
  {id:'break', icon:'⚒', name:bi('Break it open','力ずくで開く'), description:bi('Let your creature do the heavy lifting.','この子の力を信じよう。')},
  {id:'persuade', icon:'♡', name:bi('Win them over','門番を説得する'), description:bi('A few kind words might be the key.','優しい言葉が鍵になるかも。')},
  {id:'ritual', icon:'✧', name:bi('Try a strange ritual','不思議な儀式'), description:bi('Nobody knows. That is the point.','何が起こるか、お楽しみ。')}
] as const;
export type ActionId = typeof actions[number]['id'];
export const endings: Record<ActionId, Text[]> = {
  break:[bi('The knocking became a doorbell. A sleepy keeper opened the gate and waved your creature through.','門を叩く音は呼び鈴になった。眠そうな門番が扉を開き、この子を招き入れた。'),bi('It studied the hinges, gave them one careful nudge, and took the entire door on its journey.','蝶番をじっと見て、そっとひと押し。この子は扉ごと、新しい世界へ歩き出した。'),bi('With one magnificent leap, it burst through the gate. Beyond it, a whole new world was waiting.','見事なひと跳びで門が開いた。その向こうには、まだ知らない世界が待っていた。')],
  persuade:[bi('Halfway through its speech, it fell asleep. The keeper gently carried it into its new world.','話の途中で眠ってしまった。門番はこの子を抱き上げ、新しい世界へ運んでくれた。'),bi('The words got tangled, but a tiny gift said everything. The keeper smiled and opened the gate.','言葉はうまく出なかった。でも小さな贈り物が心を伝え、門番は笑顔で門を開いた。'),bi('It spoke with such warmth and wonder that the keeper opened the gate—and decided to come along.','温かく不思議な言葉に、門番は門を開いた。そして一緒に旅へ出ることにした。')],
  ritual:[bi('The keeper joined its peculiar dance. By the time they stopped laughing, everyone was on the other side.','不思議な踊りに門番も加わった。笑い終えたころには、みんな門の向こうにいた。'),bi('The ritual worked backwards. The enormous gate shrank into a charm, and your creature slipped it into its pocket.','儀式は逆向きに成功した。大きな門は小さなお守りになり、この子はポケットにしまった。'),bi('Bright patterns rose into the air and became a key. The gate opened onto a world only your creature could imagine.','光る模様が空に浮かび、鍵になった。門の向こうには、この子だけが想像できる世界が広がった。')]
};
export const configVersion = '1.0.0';
