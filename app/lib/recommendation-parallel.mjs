import { availableParallelism, freemem } from 'node:os';
import { Worker, parentPort, workerData } from 'node:worker_threads';
import { hifActivityRowFromMessage, hifActivityRowMessage, recommend, recommendationSteps,
  startHifActivitySearch } from './recommend.mjs';

const activityTask = 'hif_activity_search';

function waitForResult(worker) {
  return new Promise((resolve,reject)=>{
    const done=(callback,value)=>{
      worker.off('message',onMessage);
      worker.off('error',onError);
      worker.off('exit',onExit);
      callback(value);
    };
    const onMessage=value=>done(resolve,hifActivityRowFromMessage(value));
    const onError=error=>done(reject,error);
    const onExit=code=>done(reject,new Error(`H.I.F. 경로 계산이 중단됐습니다 (${code}).`));
    worker.once('message',onMessage);
    worker.once('error',onError);
    worker.once('exit',onExit);
  });
}

export function recommendForWorker(args) {
  const {scenario,activityFocus}=args.options??{};
  // These are independent searches. On a small machine the same searches run
  // in sequence so that parallel workers do not compete for CPU or memory.
  if((scenario??'hif')!=='hif'||(activityFocus??'auto')!=='auto'||
    availableParallelism()<4||freemem()<8*1024**3)return recommend(args);
  return recommendInParallel(args).catch(error=>{
    if(['ERR_WORKER_INIT_FAILED','ERR_WORKER_OUT_OF_MEMORY'].includes(error.code))return recommend(args);
    throw error;
  });
}

export async function recommendInParallel(args) {
  const steps=recommendationSteps(args);
  const first=steps.next();
  if(first.done)return first.value;
  if(first.value.length<2)return recommend(args);
  const workers=new Map();
  const stopped=[];
  try{
    const rows=await Promise.all(first.value.map(async query=>{
      const worker=new Worker(new URL(import.meta.url),{workerData:{kind:activityTask,query},execArgv:[]});
      workers.set(query.focus,worker);
      return [query.focus,await waitForResult(worker)];
    }));
    const selected=steps.next(new Map(rows)).value;
    for(const [focus,worker] of workers)if(focus!==selected){
      stopped.push(worker.terminate());
      workers.delete(focus);
    }
    const winner=workers.get(selected);
    const finalized=winner&&waitForResult(winner);
    winner?.postMessage('finish');
    return steps.next(await finalized).value;
  }finally{
    await Promise.allSettled([...stopped,...[...workers.values()].map(worker=>worker.terminate())]);
  }
}

if(workerData?.kind===activityTask){
  const search=startHifActivitySearch(workerData.query);
  parentPort.once('message',()=>parentPort.postMessage(hifActivityRowMessage(search.finish())));
  parentPort.postMessage(hifActivityRowMessage(search.row));
}
