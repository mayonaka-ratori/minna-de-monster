import {existsSync} from 'node:fs';
import {createSession,makeCandidates} from '../src/server/engine';
import {generate} from '../src/server/generation';
if(existsSync('.env'))process.loadEnvFile('.env');
const s=createSession();s.totals.fire=50;s.totals.knowledge=40;s.totals.sweet=15;makeCandidates(s);
const start=Date.now(),assets:string[]=[];
const result=await generate(s.candidates,process.env.DATA_DIR||'data',AbortSignal.timeout(45000),(id,url,promptId)=>{assets.push(url);console.log(JSON.stringify({candidateId:id,url,promptId}));});
console.log(JSON.stringify({images:assets.length,elapsedMs:Date.now()-start,failed:result.filter(r=>r.status==='rejected').length}));
if(assets.length!==3)process.exitCode=1;
