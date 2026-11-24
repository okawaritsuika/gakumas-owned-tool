import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** A separate process keeps long card searches away from ownership refreshes. */
export function startPersonalizedComparison({snapshotPath,options,runs}){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./personalized-worker.mjs',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let settled=false,output='';
  child.stdout.setEncoding('utf8');
  const promise=new Promise((resolve,reject)=>{
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('개인화 반복 비교에 시간이 오래 걸립니다. 반복 횟수를 줄여 다시 비교해 주세요.'));},420000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>32*1024*1024){child.kill();finish(new Error('비교 결과가 너무 커서 불러오지 못했습니다.'));}});
    child.stderr.on('data',()=>{});
    child.on('error',()=>finish(new Error('개인화 비교를 시작하지 못했습니다.')));
    child.on('close',code=>{if(settled)return;if(code!==0)return finish(new Error('개인화 시험 비교를 완료하지 못했습니다.'));try{finish(null,JSON.parse(output));}catch{finish(new Error('개인화 비교 결과를 읽지 못했습니다.'));}});
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({snapshotPath,options,runs}));
  });
  return{promise,stop:()=>child.kill()};
}
