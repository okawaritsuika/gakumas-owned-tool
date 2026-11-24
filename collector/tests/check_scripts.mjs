// Isolated HTTP stub and copied scripts; no actual game or app process changes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, unlink, access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const testRoot=await mkdtemp(path.join(root,'work/collector-script-check-'));
const app=path.join(testRoot,'app'),data=path.join(app,'data');
await mkdir(data,{recursive:true});
for(const name of ['Start-Tool.ps1','Stop-Tool.ps1','Collector-Control.ps1']){
  const source=(await readFile(path.join(root,'app',name),'utf8')).replace(/^\uFEFF/,'');
  await writeFile(path.join(app,name),'\uFEFF'+source,'utf8');
}
let controlPath=path.join(data,'collector-control.json'),failNextCollect=false;
const cancelPath=()=>controlPath+'.cancel';
const exists=async file=>access(file).then(()=>true,()=>false);
const control=async()=>JSON.parse(await readFile(controlPath,'utf8'));
const enabled=()=>({schemaVersion:1,enabled:true,expiresAtUnixMs:Date.now()+30000});
const requests=[];
const server=createServer(async(req,res)=>{
  if(req.url==='/api/health') {res.setHeader('Content-Type','application/json');res.end('{"appId":"gakumas-owned-tool"}');return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString());
  requests.push({url:req.url,body,controlBefore:await control(),cancelBefore:await exists(cancelPath())});
  if(req.url==='/api/collector-mode'){
    if(body.mode==='collect'&&failNextCollect){failNextCollect=false;res.statusCode=500;res.end('{}');return;}
    if(body.mode==='collect')await unlink(cancelPath()).catch(()=>{});
    else await writeFile(cancelPath(),'{}');
    await writeFile(controlPath,JSON.stringify(body.mode==='collect'?enabled():{schemaVersion:1,enabled:false,expiresAtUnixMs:0}));
    res.setHeader('Content-Type','application/json');res.end('{"ok":true}');
  }else if(req.url==='/api/shutdown'){
    res.setHeader('Content-Type','application/json');res.end('{"ok":true}');server.close();
  }else{res.statusCode=404;res.end('{}');}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const port=server.address().port;
const run=async(name,args=[],{env={},expectedCode=0}={})=>{
  const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(app,name),'-Port',String(port),...args],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,GAKUMAS_SNAPSHOT:'',...env}});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  const [code]=await once(child,'close');assert.equal(code,expectedCode,stderr||stdout);return {name,code,stdout};
};
try{
  await writeFile(controlPath,JSON.stringify(enabled()));
  const results=[await run('Start-Tool.ps1',['-NoBrowser'])];
  assert.equal(requests.at(-1).body.mode,'normal');
  assert.equal(requests.at(-1).controlBefore.enabled,false,'normal must turn off even before HTTP response');
  assert.equal(requests.at(-1).cancelBefore,true,'normal persists cancellation before HTTP response');
  assert.equal((await control()).enabled,false);
  results.push(await run('Start-Tool.ps1',['-Collect','-NoBrowser']));
  assert.equal(requests.at(-1).body.mode,'collect');assert.equal((await control()).enabled,true);
  assert.equal(await exists(cancelPath()),false,'only explicit collect clears cancellation');
  results.push(await run('Start-Tool.ps1',['-NoBrowser']));
  assert.equal(requests.at(-1).body.mode,'normal');assert.equal((await control()).enabled,false);

  failNextCollect=true;
  results.push(await run('Start-Tool.ps1',['-Collect','-NoBrowser'],{expectedCode:1}));
  assert.equal((await control()).enabled,false);
  assert.equal(await exists(cancelPath()),true,'HTTP failure must leave persistent cancellation');
  await writeFile(controlPath,JSON.stringify(enabled()));
  assert.equal(await exists(cancelPath()),true,'a stale new lease cannot erase cancellation');

  // Installation record overrides app/data, while an explicit environment
  // snapshot overrides both. Only disposable paths below this test root are used.
  const defaultControl=controlPath;
  const recordedSnapshot=path.join(testRoot,'recorded-location','inventory.json');
  await mkdir(path.dirname(recordedSnapshot),{recursive:true});
  await writeFile(path.join(data,'installation.json'),JSON.stringify({snapshotPath:recordedSnapshot}));
  controlPath=path.join(path.dirname(recordedSnapshot),'collector-control.json');
  await writeFile(controlPath,JSON.stringify(enabled()));
  results.push(await run('Start-Tool.ps1',['-NoBrowser']));
  assert.equal((await control()).enabled,false);
  assert.equal(await exists(cancelPath()),true);
  assert.equal(JSON.parse(await readFile(defaultControl,'utf8')).enabled,true,'custom mode must not change default location');
  const envSnapshot=path.join(testRoot,'environment-location','inventory.json');
  await mkdir(path.dirname(envSnapshot),{recursive:true});
  const recordedControl=controlPath;
  await writeFile(recordedControl,JSON.stringify(enabled()));
  controlPath=path.join(path.dirname(envSnapshot),'collector-control.json');
  await writeFile(controlPath,JSON.stringify(enabled()));
  results.push(await run('Start-Tool.ps1',['-NoBrowser'],{env:{GAKUMAS_SNAPSHOT:envSnapshot}}));
  assert.equal((await control()).enabled,false);
  assert.equal(JSON.parse(await readFile(recordedControl,'utf8')).enabled,true,'environment must precede installation record');
  await writeFile(controlPath,JSON.stringify(enabled()));
  results.push(await run('Stop-Tool.ps1',[],{env:{GAKUMAS_SNAPSHOT:envSnapshot}}));
  assert.equal(requests.at(-1).url,'/api/shutdown');
  assert.equal(requests.at(-1).controlBefore.enabled,false,'stop must turn off before shutdown response');
  assert.equal((await control()).enabled,false);
  const report={passed:true,scope:'Copied scripts and own local HTTP stub only.',testRoot,requests,results};
  await writeFile(path.join(testRoot,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,report:path.join(testRoot,'report.json')}));
}finally{
  server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));
}
