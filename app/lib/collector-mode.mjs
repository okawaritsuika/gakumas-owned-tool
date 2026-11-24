import fs from 'node:fs/promises';
import path from 'node:path';

const readJson=async file=>{try{return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch{return null;}};
const newCollector=status=>status?.controlSupported===true&&/^0\.1\.(?:[3-9]|\d{2,})$/.test(status.collectorVersion??status.moduleVersion??'');

/** Collection permission is temporary and opt-in. Merely reading saved ownership
 * never renews a lease or requests game inspection. */
export function createCollectorMode({snapshotPath,controlPath=path.join(path.dirname(snapshotPath),'collector-control.json'),installationPath=path.join(path.dirname(snapshotPath),'installation.json'),clock=Date.now,heartbeatMs=10000,leaseMs=30000}={}){
  const cancelPath=controlPath+'.cancel';
  let mode='normal',requestedAt=null,lastCompletedAt=null,error=null,closed=false,queue=Promise.resolve(),sequence=0,generation=0;
  const write=enabled=>{
    const expiresAtUnixMs=enabled?clock()+leaseMs:0;
    queue=queue.catch(()=>{}).then(async()=>{
      await fs.mkdir(path.dirname(controlPath),{recursive:true});
      const temporary=controlPath+'.'+process.pid+'.'+(++sequence)+'.tmp';
      try{await fs.writeFile(temporary,JSON.stringify({schemaVersion:1,enabled,expiresAtUnixMs}),'utf8');await fs.rename(temporary,controlPath);error=null;}
      catch(cause){await fs.unlink(temporary).catch(()=>{});error='수집 모드 제어 파일을 저장하지 못했습니다.';throw cause;}
    });
    return queue;
  };
  const markCancelled=async()=>{await fs.mkdir(path.dirname(cancelPath),{recursive:true});await fs.writeFile(cancelPath,'{}','utf8');};
  const ready=markCancelled().then(()=>write(false)).catch(()=>{error='일반 모드의 수집 중지 요청을 저장하지 못했습니다.';});
  async function setMode(next){
    if(!['normal','collect'].includes(next))throw new RangeError('일반 또는 수집 모드를 선택해 주세요.');
    if(closed)throw new Error('보유노트가 종료 중입니다.');
    await ready;generation++;mode=next;requestedAt=next==='collect'?clock():null;
    try{
      if(next==='collect')await fs.unlink(cancelPath).catch(cause=>{if(cause.code!=='ENOENT')throw cause;});
      else await markCancelled();
      await write(next==='collect');
    }catch{mode='normal';throw new Error(error??'수집 중지 요청을 저장하지 못했습니다.');}
    return status();
  }
  async function checkCompletion(){
    if(mode!=='collect')return;
    const session=generation,started=requestedAt;
    const [snapshot,collector]=await Promise.all([readJson(snapshotPath),readJson(snapshotPath+'.status.json')]);
    const captured=Date.parse(snapshot?.capturedAt??''),checked=Date.parse(collector?.capturedAt??'');
    const collections=snapshot?.capture?.collections;
    const complete=['userSupportCardList','userIdolCardList','userCharacterList','userMemoryList'].every(key=>collections?.[key]?.status==='complete');
    if(mode!=='collect'||generation!==session)return;
    if(newCollector(collector)&&collector.state==='complete'&&complete&&Number.isFinite(captured)&&captured>=started&&Number.isFinite(checked)&&checked>=started){
      mode='normal';lastCompletedAt=snapshot.capturedAt;requestedAt=null;await markCancelled();await write(false);
    }
  }
  async function status(){
    await ready;await reconcileCancellation();await checkCompletion().catch(()=>{});
    const [collector,installation]=await Promise.all([readJson(snapshotPath+'.status.json'),readJson(installationPath)]);
    const supported=newCollector(collector),installedVersion=installation?.moduleVersion??null;
    const activationPending=Boolean(installation)&&!supported;
    return{mode,labelKo:mode==='collect'?'수집 모드':'일반 모드',collectOnce:true,
      requestedAt:requestedAt===null?null:new Date(requestedAt).toISOString(),lastCompletedAt,
      usesSavedInventory:mode==='normal',gameSamplingRequested:mode==='collect',
      collectorControlVerified:supported,collectorVersion:collector?.collectorVersion??collector?.moduleVersion??null,
      installedVersion,activationPending,installationFound:Boolean(installation),
      latestCollectorState:collector?.state??null,error,
      state:error?'control_error':mode==='collect'?!installation?'not_installed':activationPending?'waiting_for_new_collector':'waiting_for_fresh_snapshot':lastCompletedAt?'collected_and_returned_to_normal':'saved_inventory',
      message:error??(mode==='collect'?!installation?'수집기 연결을 먼저 완료해 주세요.':activationPending?'새 수집기를 적용한 뒤 게임을 실행해 로비에 들어가 주세요.':'게임의 로비에서 보유 목록을 한 번 갱신한 뒤 자동으로 일반 모드로 돌아갑니다.':lastCompletedAt?'방금 수집한 보유 목록을 추천에 사용합니다.':'마지막으로 수집한 내 보유 목록을 추천에 사용합니다. 새로 얻은 카드가 있으면 게임에서 목록을 갱신해 주세요.'),
      limitations:activationPending?['현재 실행된 수집기의 제어 지원이 확인되지 않았습니다. 새 모듈 설치 후 게임 재실행이 필요할 수 있습니다.']:[]};
  }
  async function reconcileCancellation(){
    if(mode!=='collect')return;
    const session=generation;
    try{await fs.stat(cancelPath);if(mode!=='collect'||generation!==session)return;generation++;mode='normal';requestedAt=null;await write(false);}
    catch(cause){if(cause.code!=='ENOENT')throw cause;}
  }
  const timer=setInterval(()=>{
    if(closed||mode!=='collect')return;
    reconcileCancellation().then(()=>checkCompletion()).then(()=>mode==='collect'?write(true):null).catch(()=>{});
  },heartbeatMs);timer.unref?.();
  const dispose=()=>{closed=true;clearInterval(timer);};
  return{ready,status,setMode,dispose,controlPath,cancelPath};
}
