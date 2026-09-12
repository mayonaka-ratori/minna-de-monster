import { randomBytes, createHash } from 'node:crypto';
import { actions, bi, configVersion, durations, endings, itemById, items, recipes, traits, traitNames, zero, type ActionId, type ItemId, type Phase, type Stats, type Text } from '../shared/config';
import type { Candidate, Mutation, Outcome, PersonalResult, PublicState } from '../shared/types';
export const id = () => randomBytes(16).toString('hex');
export const hash = (s:string) => createHash('sha256').update(s).digest('hex');
export class GameError extends Error { constructor(public code:string, public status=409){super(code);} }
export type Person = {id:string;tokenHash:string;displayName:Text;itemId:ItemId;shareId:string;lastSeq:number;lastClientTotal:number;acceptedTotal:number;lastBody:string;evolutionVote:string|null;trialVote:ActionId|null;result:PersonalResult|null};
export type Session = {
  id:string;phase:Phase;phaseRevision:number;version:number;seed:string;createdAt:number;phaseStartedAt:number;phaseEndsAt:number|null;feedingAt:number;
  people:Record<string,Person>;totals:Record<ItemId,number>;mutations:Mutation[];serverOrder:number;candidates:Candidate[];winner:Candidate|null;outcome:Outcome|null;
  enableTrial:boolean;stats:Stats;raw:Stats;alignment:number;generationDone:boolean;generationStarted:boolean;generationKey:string;
  graphStatus:'disabled'|'ready'|'pending';persistence:'pending'|'ready';configVersion:string;tieOrder:string[];trialOrder:ActionId[];generationLog:Record<string,unknown>;
};
export const ordered = <T extends string>(list:T[], seed:string) => [...list].sort((a,b)=>hash(seed+a).localeCompare(hash(seed+b)));
export function createSession(enableTrial=true, now=Date.now()):Session {
  const sid=id();
  return {id:sid,phase:'LOBBY',phaseRevision:0,version:1,seed:id(),createdAt:now,phaseStartedAt:now,phaseEndsAt:null,feedingAt:0,
    people:{},totals:Object.fromEntries(items.map(i=>[i.id,0])) as Record<ItemId,number>,mutations:[],serverOrder:0,candidates:[],winner:null,outcome:null,
    enableTrial,stats:zero(),raw:zero(),alignment:0,generationDone:false,generationStarted:false,generationKey:`${sid}:1`,graphStatus:'disabled',persistence:'pending',configVersion,
    tieOrder:ordered(['A','B','C'],sid),trialOrder:ordered(actions.map(a=>a.id),sid),generationLog:{}};
}
export function join(s:Session):{person:Person;token:string} {
  if(s.phase!=='LOBBY') throw new GameError('JOIN_CLOSED');
  if(Object.keys(s.people).length>=50) throw new GameError('SESSION_FULL');
  const roleOrder=ordered(items.map(i=>i.id),s.seed), counts=roleOrder.map(i=>Object.values(s.people).filter(p=>p.itemId===i).length);
  const itemId=roleOrder[counts.indexOf(Math.min(...counts))], pid=id(), token=randomBytes(32).toString('hex'), number=Object.keys(s.people).length+1;
  const person:Person={id:pid,tokenHash:hash(token),displayName:bi(`Keeper ${String(number).padStart(2,'0')}`,`育て手 ${String(number).padStart(2,'0')}`),itemId,shareId:id(),lastSeq:0,lastClientTotal:0,acceptedTotal:0,lastBody:'',evolutionVote:null,trialVote:null,result:null};
  s.people[pid]=person;s.version++;return {person,token};
}
export function transition(s:Session,phase:Phase,now:number) {s.phase=phase;s.phaseStartedAt=now;s.phaseEndsAt=durations[phase]?now+durations[phase]!:null;s.phaseRevision++;s.version++;if(phase==='FEEDING')s.feedingAt=now;}
export function start(s:Session,now=Date.now()){if(s.phase!=='LOBBY'||!Object.keys(s.people).length)throw new GameError('START_REQUIRES_PLAYERS');transition(s,'COUNTDOWN',now);}
export function applyTap(s:Session,p:Person,r:{seq:number;clientTotal:number;roundId:string},now=Date.now()) {
  if(r.roundId!=='round-1')throw new GameError('WRONG_ROUND');
  if(!Number.isSafeInteger(r.seq)||r.seq<1||!Number.isSafeInteger(r.clientTotal)||r.clientTotal<0||r.clientTotal>10000)throw new GameError('INVALID_TOTAL',422);
  const body=JSON.stringify(r);
  if(r.seq===p.lastSeq&&body!==p.lastBody)throw new GameError('SEQUENCE_CONFLICT');
  if(r.seq>p.lastSeq){
    if(!['FEEDING','DRAINING'].includes(s.phase)||now>=s.feedingAt+16000)throw new GameError('PHASE_CLOSED');
    if(r.clientTotal<p.lastClientTotal)throw new GameError('INVALID_TOTAL',422);
    const allowance=Math.min(120,8+Math.floor(8*Math.max(0,Math.min(15000,now-s.feedingAt))/1000));
    const delta=Math.min(r.clientTotal-p.lastClientTotal,Math.max(0,allowance-p.acceptedTotal));
    const before=s.totals[p.itemId], prior=p.acceptedTotal;
    p.lastSeq=r.seq;p.lastBody=body;p.lastClientTotal=r.clientTotal;p.acceptedTotal+=delta;s.totals[p.itemId]+=delta;s.serverOrder++;
    if(['fire','knowledge'].includes(p.itemId)){
      const threshold=30*Object.values(s.people).filter(x=>x.itemId===p.itemId).length;
      if(before<threshold&&s.totals[p.itemId]>=threshold&&!s.mutations.some(m=>m.itemId===p.itemId))s.mutations.push({id:`${s.id}:${p.itemId}`,itemId:p.itemId,participantId:p.id,ordinal:prior+threshold-before,threshold,before,after:s.totals[p.itemId],serverOrder:s.serverOrder,name:p.itemId==='fire'?bi('Ember horns','灼熱の角'):bi('Observing eye','観測する瞳')});
    }
    s.version++;
  }
  return {ackSeq:p.lastSeq,lastClientTotal:p.lastClientTotal,acceptedTotal:p.acceptedTotal,rejectedTotal:p.lastClientTotal-p.acceptedTotal,snapshotVersion:s.version,serverNow:now};
}
export function aggregate(s:Session, graphRaw?:Stats){
  const raw=graphRaw?{...graphRaw}:zero(),total=Object.values(s.totals).reduce((a,b)=>a+b,0);
  if(!graphRaw)for(const i of items)for(const [t,w] of Object.entries(i.weights))raw[t as keyof Stats]+=s.totals[i.id]*w;
  const stats=zero();for(const t of traits){const max=Math.max(...items.map(i=>(i.weights as Partial<Stats>)[t]||0));stats[t]=total?Math.round(100*raw[t]/(total*max)):0;}
  s.raw=raw;s.stats=stats;s.alignment=raw.chaos+raw.law?Math.round(100*(raw.chaos-raw.law)/(raw.chaos+raw.law)):0;
}
export function unlocked(s:Session){return recipes.filter(r=>r.required.every(i=>{const n=Object.values(s.people).filter(p=>p.itemId===i).length;return n>0&&s.totals[i]>=20*n;})).sort((a,b)=>{
  const score=(r:typeof recipes[number])=>Math.min(...r.required.map(i=>s.totals[i]/(20*Object.values(s.people).filter(p=>p.itemId===i).length)));
  return score(b)-score(a);
});}
const prefix:Record<ItemId,Text>={fire:bi('Ember','焔'),knowledge:bi('Rune','書'),sweet:bi('Berry','苺'),wild:bi('Bramble','荒野'),love:bi('Bloom','花'),chaos:bi('Nova','星乱')};
const visual:Record<ItemId,string>={fire:'ember orange skin, small volcanic horns',knowledge:'blue glowing runes, book shaped wings',sweet:'berry pink core, candy antennae',wild:'mossy fur, sturdy paws',love:'lilac petals, warm gentle face',chaos:'lime floating core, playful sparks'};
export function makeCandidates(s:Session, graphRaw?:Stats){
  if(s.candidates.length)return;
  aggregate(s,graphRaw);
  const ranked=items.map(i=>i.id).filter(i=>s.totals[i]>0).sort((a,b)=>s.totals[b]-s.totals[a]||items.findIndex(i=>i.id===a)-items.findIndex(i=>i.id===b));
  const recipe=unlocked(s)[0], first=ranked[0], second=ranked[1]||first;
  const minority=[...ranked].sort((a,b)=>s.totals[a]-s.totals[b]||items.findIndex(i=>i.id===a)-items.findIndex(i=>i.id===b))[0];
  s.candidates=['A','B','C'].map((letter,k)=>{
    const source:ItemId[]=ranked.length?(k===0?ranked.slice(0,2):k===1?(recipe?recipe.required:[second]):[minority]):[];
    const kind=k===0?'dominant':k===1?(recipe?'secret':'alternative'):'mutation';
    const stats={...s.stats};
    if(source.length){if(k===1&&recipe)stats[recipe.trait]=Math.min(100,stats[recipe.trait]+15);else if(k===1&&ranked.length===1)stats.gentle=Math.min(100,stats.gentle+10);else for(const t of Object.keys(itemById(source[0]).weights) as (keyof Stats)[])if(!['law','chaos'].includes(t))stats[t]=Math.min(100,stats[t]+(k===2?20:10));}
    const name=!source.length?[bi('Little Unwritten','未分化の子'),bi('Quiet Observer','静かな観測者'),bi('Dreaming Egg','夢遊するタマゴ')][k]:k===1&&recipe?(recipe.id==='ember_archive'?bi('Arca, the Ember Scribe','焔書獣アーカ'):bi('Berrybomb, the Impossible','爆苺妖精ベリーボム')):bi(`${prefix[source[0]].en}${['ling','whisper','oddity'][k]}`,`${prefix[source[0]].ja}${['の子','のささやき','の異形'][k]}`);
    const materialText=(lang:'en'|'ja')=>source.map(i=>`${itemById(i).name[lang]} ${s.totals[i]}`).join(lang==='en'?' + ':' ＋ ');
    const description=!source.length?bi('No ingredients, just a little possibility.','素材はまだない。あるのは、小さな可能性。'):k===1&&recipe?bi(`${recipe.name.en} awakened: ${materialText('en')}.`,`${recipe.name.ja}が成立：${materialText('ja')}。`):k===2?bi(`A rare ingredient takes the lead: ${materialText('en')}.`,`少数の素材が主役に：${materialText('ja')}。`):bi(`${materialText('en')} shaped this ${k===0?'most likely':'alternative'} future.`,`${materialText('ja')}から生まれた${k===0?'本命':'別解'}の未来。`);
    const mutations=s.mutations.filter(m=>source.includes(m.itemId));
    return {id:`${s.id}:${letter}`,kind,name,description,stats,sourceItemIds:source,recipeId:k===1&&recipe?recipe.id:null,mutations,seed:parseInt(hash(s.seed+letter).slice(0,8),16),prompt:`A single original friendly baby fantasy creature, round body, large expressive eyes, full body centered, clean dark violet background, clay figurine style, no text, no logo. ${source.map(i=>visual[i]).join(', ')}. ${k===2?'Surprising asymmetrical limbs, floating core.':k===1?'Delicate wings, dreamy expression.':'Tiny sturdy paws, curious expression.'}`,imageUrl:`/fallback/${letter}.svg`,imageSource:'pre-generated'} as Candidate;
  });s.version++;
}
export function vote(s:Session,p:Person,kind:'evolution'|'trial',target:string,now=Date.now()){
  const field=kind==='evolution'?'evolutionVote':'trialVote', prior=p[field];
  if(prior){if(prior===target)return;throw new GameError('VOTE_LOCKED');}
  if(s.phase!==(kind==='evolution'?'EVOLUTION_VOTE':'TRIAL_VOTE')||now>=s.phaseEndsAt!)throw new GameError('PHASE_CLOSED');
  if(kind==='evolution'){if(!s.candidates.some(c=>c.id===target))throw new GameError('INVALID_CHOICE',422);p.evolutionVote=target;}
  else {if(!actions.some(a=>a.id===target))throw new GameError('INVALID_CHOICE',422);p.trialVote=target as ActionId;}
  s.version++;
}
export function selectWinner(s:Session){
  const count=(c:Candidate)=>Object.values(s.people).filter(p=>p.evolutionVote===c.id).length;
  s.candidates.forEach(c=>c.votes=count(c));
  s.winner=[...s.candidates].sort((a,b)=>count(b)-count(a)||s.tieOrder.indexOf(a.id.slice(-1))-s.tieOrder.indexOf(b.id.slice(-1)))[0];
}
export function resolveTrial(s:Session){
  const counts=(a:ActionId)=>Object.values(s.people).filter(p=>p.trialVote===a).length;
  const action=[...s.trialOrder].sort((a,b)=>counts(b)-counts(a))[0],t=s.winner!.stats;
  const score=Math.round(action==='break'?.5*t.body+.3*t.aggression+.2*t.heat:action==='persuade'?.5*t.intelligence+.3*t.gentle+.2*t.social:.5*t.mutation+.3*t.curiosity+.2*t.intelligence);
  const tier=score>=40?2:score>=20?1:0;s.outcome={actionId:action,score,tier,text:endings[action][tier]};
}
export function results(s:Session){
  for(const p of Object.values(s.people)){
    const points=zero();for(const [t,w] of Object.entries(itemById(p.itemId).weights))points[t as keyof Stats]=p.acceptedTotal*w;
    const own=s.mutations.filter(m=>m.participantId===p.id), adopted=own.filter(m=>s.winner!.mutations.some(a=>a.id===m.id));
    const recipe=recipes.find(r=>r.id===s.winner!.recipeId),positive=Object.values(s.totals).filter(n=>n>0);
    const rare=p.acceptedTotal>0&&positive.length>=2&&s.totals[p.itemId]===Math.min(...positive);
    let title=bi('Witness of a Beginning','誕生の観測者'),reason=bi('You were here when a new story began.','新しい物語のはじまりを見届けました。');
    if(adopted.length){title=bi('The Final Nudge','最後のひと押し');reason=bi('Your contribution unlocked a trait in the chosen future.','選ばれた未来の変異条件を満たしました。');}
    else if(recipe?.required.includes(p.itemId)&&p.acceptedTotal){title=bi('Secret Keeper','秘密を支えし者');reason=bi('Your ingredient helped unlock the chosen secret recipe.','選ばれた秘密レシピを素材で支えました。');}
    else if(rare){title=bi('Guardian of the Rare','少数派の守護者');reason=bi('You gave a less common ingredient a voice.','少数の素材に、存在感を与えました。');}
    else if(!p.acceptedTotal&&(p.evolutionVote||p.trialVote)){title=bi('Future Chooser','未来の選び手');reason=bi('Your vote helped choose the next chapter.','あなたの一票で、次の物語を選びました。');}
    else if(p.acceptedTotal){title=points.chaos>points.law?bi('Spark of Chaos','混沌の火付け役'):points.law>points.chaos?bi('Keeper of Order','秩序の育て手'):bi('Giver of Sweet Things','優しさの贈り手');reason=bi(`You gave ${p.acceptedTotal} ${itemById(p.itemId).name.en.toLowerCase()}.`,`${itemById(p.itemId).name.ja}を${p.acceptedTotal}回与えました。`);}
    const evidence:Text[]=[];
    for(const m of own)evidence.push(bi(`Your accepted feed #${m.ordinal} unlocked ${m.name.en.toLowerCase()} in server order. ${adopted.some(a=>a.id===m.id)?'It belongs to the chosen future.':'That mutation was not chosen.'}`,`反映済み${m.ordinal}回目の投与が集計で「${m.name.ja}」を解放。${adopted.some(a=>a.id===m.id)?'選ばれた未来に受け継がれました。':'その変異は今回は選ばれませんでした。'}`));
    const top=traits.filter(t=>points[t]>0).sort((a,b)=>points[b]-points[a]).slice(0,2);
    for(const t of top)evidence.push(bi(`${itemById(p.itemId).name.en} → ${traitNames[t].en} +${points[t]} → ${s.winner!.name.en}`,`${itemById(p.itemId).name.ja} → ${traitNames[t].ja} +${points[t]} → ${s.winner!.name.ja}`));
    p.result={shareId:p.shareId,itemId:p.itemId,count:p.acceptedTotal,points,title,titleReason:reason,evidence,evolutionVote:p.evolutionVote,trialVote:p.trialVote,evolutionWon:p.evolutionVote?p.evolutionVote===s.winner!.id:null,trialMatched:p.trialVote&&s.outcome?p.trialVote===s.outcome.actionId:null,mutations:own,graphVerified:s.graphStatus==='ready'};
  }
}
export function tick(s:Session,now=Date.now()){
  if(s.phase==='GENERATING'&&s.generationDone&&now>=s.phaseStartedAt+12000){transition(s,'REVEAL',now);return;}
  if(s.phaseEndsAt===null||now<s.phaseEndsAt)return;
  const at=s.phaseEndsAt;
  switch(s.phase){
    case 'COUNTDOWN':transition(s,'FEEDING',at);break;
    case 'FEEDING':transition(s,'DRAINING',at);break;
    case 'DRAINING':aggregate(s);transition(s,'GENERATING',at);break;
    case 'GENERATING':makeCandidates(s);s.generationDone=true;transition(s,'REVEAL',now);break;
    case 'REVEAL':transition(s,'EVOLUTION_VOTE',now);break;
    case 'EVOLUTION_VOTE':selectWinner(s);transition(s,'BIRTH',now);break;
    case 'BIRTH':if(s.enableTrial)transition(s,'TRIAL_VOTE',now);else{results(s);transition(s,'RESULTS',now);}break;
    case 'TRIAL_VOTE':resolveTrial(s);transition(s,'OUTCOME',now);break;
    case 'OUTCOME':results(s);transition(s,'RESULTS',now);break;
  }
}
export function publicState(s:Session,origin:string,now=Date.now()):PublicState{
  const published=!['LOBBY','COUNTDOWN','FEEDING','DRAINING','GENERATING','INTERRUPTED'].includes(s.phase);
  const safeCandidate=(c:Candidate):Candidate=>({...c,prompt:'',mutations:c.mutations.map(m=>({...m,participantId:''})),votes:s.winner?c.votes:undefined});
  return {id:s.id,phase:s.phase,phaseRevision:s.phaseRevision,version:s.version,serverNow:now,phaseEndsAt:s.phaseEndsAt,participantCount:Object.keys(s.people).length,totals:s.totals,totalAccepted:Object.values(s.totals).reduce((a,b)=>a+b,0),candidates:published?s.candidates.map(safeCandidate):[],winner:s.winner?safeCandidate(s.winner):null,outcome:s.outcome,voteCount:Object.values(s.people).filter(p=>p.evolutionVote).length,trialVoteCount:Object.values(s.people).filter(p=>p.trialVote).length,alignment:s.alignment,stats:s.stats,enableTrial:s.enableTrial,generation:{ready:s.candidates.filter(c=>c.imageSource==='nosana-live').length,source:s.generationDone?'ready':'working'},persistence:s.persistence,graphStatus:s.graphStatus,joinUrl:`${origin}/play/${s.id}`,stageUrl:`${origin}/stage/${s.id}`,mutations:s.mutations.map(m=>({...m,participantId:''}))};
}
