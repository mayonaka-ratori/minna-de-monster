import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Candidate } from '../shared/types';
export type WorkflowMap={positive:string[];negative?:string[];seed:string[];output:string};
export async function generate(candidates:Candidate[],dataDir:string,signal:AbortSignal,onAsset:(id:string,url:string,promptId:string)=>void){
  const base=process.env.COMFY_BASE_URL;if(!base)throw Error('GPU_NOT_CONFIGURED');
  const url=new URL(base);if(!['http:','https:'].includes(url.protocol))throw Error('INVALID_GPU_URL');
  const workflow=JSON.parse(await readFile(resolve(process.env.COMFY_WORKFLOW_PATH||'workflows/monster-api.json'),'utf8'));
  const map:WorkflowMap=JSON.parse(await readFile(resolve(process.env.COMFY_MAP_PATH||'workflows/workflow-map.json'),'utf8'));
  const headers:Record<string,string>={'Content-Type':'application/json'};if(process.env.COMFY_AUTH_HEADER_NAME&&process.env.COMFY_AUTH_HEADER_VALUE)headers[process.env.COMFY_AUTH_HEADER_NAME]=process.env.COMFY_AUTH_HEADER_VALUE;
  async function request(path:string,init:RequestInit={}){const response=await fetch(`${base!.replace(/\/$/,'')}${path}`,{...init,headers:{...headers,...init.headers},signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),redirect:'error'});if(!response.ok)throw Error(`GPU_HTTP_${response.status}`);return response;}
  const jobs:Promise<void>[]=[];
  for(const c of candidates){
    const w=structuredClone(workflow);
    for(const node of map.positive){if(!w[node]?.inputs)throw Error('INVALID_WORKFLOW_MAP');w[node].inputs.text=c.prompt;}
    for(const node of map.seed){if(!w[node]?.inputs)throw Error('INVALID_WORKFLOW_MAP');w[node].inputs.seed=c.seed;}
    for(const node of map.negative||[])w[node].inputs.text='text, logo, watermark, gore, realistic human, explicit content';
    jobs.push((async()=>{
      const submission=await(await request('/prompt',{method:'POST',body:JSON.stringify({prompt:w,client_id:c.id})})).json() as {prompt_id?:string;node_errors?:unknown};
      if(!submission.prompt_id)throw Error('GPU_SUBMISSION_FAILED');
      while(!signal.aborted){
        const history=await(await request(`/history/${encodeURIComponent(submission.prompt_id)}`)).json() as Record<string,any>;
        const entry=history[submission.prompt_id],output=entry?.outputs?.[map.output]?.images?.[0];
        if(entry?.status?.status_str==='error')throw Error('GPU_EXECUTION_FAILED');
        if(output){
          const query=new URLSearchParams({filename:output.filename,subfolder:output.subfolder||'',type:output.type||'output'});
          const response=await request(`/view?${query}`),mime=response.headers.get('content-type')?.split(';')[0];
          if(!['image/png','image/jpeg','image/webp'].includes(mime||''))throw Error('INVALID_IMAGE');
          const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
          for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024){await reader.cancel();throw Error('IMAGE_TOO_LARGE');}chunks.push(value);}
          const bytes=Buffer.concat(chunks);if(bytes.length<12)throw Error('INVALID_IMAGE');
          const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
          if(!valid)throw Error('INVALID_IMAGE');
          const ext=mime==='image/png'?'png':mime==='image/jpeg'?'jpg':'webp',filename=`${c.id.replace(':','-')}.${ext}`;
          await mkdir(resolve(dataDir,'assets'),{recursive:true});await writeFile(resolve(dataDir,'assets',filename),bytes);
          onAsset(c.id,`/assets/${filename}`,submission.prompt_id);return;
        }
        await new Promise<void>(r=>{const timer=setTimeout(done,1000);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);r();}signal.addEventListener('abort',done,{once:true});});
      }
    })());
  }
  return await Promise.allSettled(jobs);
}
