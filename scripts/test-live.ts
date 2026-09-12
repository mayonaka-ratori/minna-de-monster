import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const origin=process.env.APP_ORIGIN||'http://localhost:3000';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function req(path:string,body?:unknown,token?:string,expected=200){const r=await fetch(`${origin}/api${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,expected,`${path}: ${r.status}`);return await r.json() as any;}
const host=(await req('/local-host',{})).token;
await req('/sessions',{commandId:crypto.randomUUID()},undefined,401);
const room=await req('/sessions',{commandId:crypto.randomUUID(),enableTrial:true},host,201),sid=room.id;
const joinId=crypto.randomUUID(),p1=await req(`/sessions/${sid}/join`,{joinRequestId:joinId},undefined,201),again=await req(`/sessions/${sid}/join`,{joinRequestId:joinId});assert.equal(p1.token,again.token);
const p2=await req(`/sessions/${sid}/join`,{joinRequestId:crypto.randomUUID()},undefined,201);
await req(`/sessions/${sid}/commands`,{commandId:crypto.randomUUID(),type:'start',expectedPhaseRevision:room.phaseRevision},host);
console.log('HTTP: authentication, idempotent join, two participants passed.');
let state:any,previous='',fed=false,evolution=false,trial=false;
const deadline=Date.now()+150000;
while(Date.now()<deadline){state=await req(`/sessions/${sid}/state`);if(state.phase!==previous){console.log(`HTTP phase: ${state.phase}`);previous=state.phase;}
  if(state.phase==='FEEDING'&&!fed&&state.phaseEndsAt-Date.now()<9000){const batch={roundId:'round-1',seq:1,clientTotal:43};const a=await req(`/sessions/${sid}/taps`,batch,p1.token);await req(`/sessions/${sid}/taps`,batch,p1.token);assert.equal(a.acceptedTotal,43);await req(`/sessions/${sid}/taps`,{...batch,clientTotal:25},p2.token);fed=true;}
  if(state.phase==='EVOLUTION_VOTE'&&!evolution){assert.equal(state.candidates.length,3);for(const c of state.candidates){assert.ok(c.name.en&&c.name.ja);const r=await fetch(`${origin}${c.imageUrl}`);assert.equal(r.status,200);}const targetId=state.candidates[0].id;await req(`/sessions/${sid}/votes/evolution`,{targetId},p1.token);await req(`/sessions/${sid}/votes/evolution`,{targetId},p1.token);await req(`/sessions/${sid}/votes/evolution`,{targetId:state.candidates[1].id},p1.token,409);await req(`/sessions/${sid}/votes/evolution`,{targetId},p2.token);evolution=true;}
  if(state.phase==='TRIAL_VOTE'&&!trial){for(const p of [p1,p2])await req(`/sessions/${sid}/votes/trial`,{targetId:'ritual'},p.token);trial=true;}
  if(state.phase==='RESULTS'){assert.equal(state.totalAccepted,68);assert.equal(state.voteCount,2);const personal=await req(`/sessions/${sid}/me/result`,undefined,p1.token);assert.equal(personal.result.count,43);assert.equal(personal.result.evolutionWon,true);assert.equal(personal.result.trialMatched,true);const shared=await req(`/shared-results/${personal.result.shareId}`);assert.ok(!JSON.stringify(shared).includes(p1.token));writeFileSync('data/live-test.json',JSON.stringify({sid,shareUrl:`${origin}/r/${personal.result.shareId}`,result:personal.result,phase:state.phase},null,2));console.log(`HTTP PASS: full game, totals, votes, bilingual results, public share. ${origin}/r/${personal.result.shareId}`);process.exit(0);}
  await pause(500);
}
throw Error(`Game did not finish: ${state?.phase}`);
