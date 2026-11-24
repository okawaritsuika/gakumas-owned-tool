import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCollectorMode} from '../lib/collector-mode.mjs';

test('saved mode denies collection, explicit mode grants a bounded lease, and only a fresh supported complete capture ends it',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gakumas-mode-')),snapshotPath=path.join(dir,'inventory.json');
  let now=100000;const mode=createCollectorMode({snapshotPath,clock:()=>now,heartbeatMs:1000000});
  const read=()=>fs.readFile(mode.controlPath,'utf8').then(JSON.parse);
  try{
    await mode.ready;assert.deepEqual(await read(),{schemaVersion:1,enabled:false,expiresAtUnixMs:0});
    await mode.setMode('collect');assert.equal((await read()).expiresAtUnixMs,130000);
    const collections=Object.fromEntries(['userSupportCardList','userIdolCardList','userCharacterList','userMemoryList'].map(key=>[key,{status:'complete'}]));
    const capture={capturedAt:new Date(now+1).toISOString(),capture:{collections}};
    await fs.writeFile(snapshotPath,JSON.stringify(capture));
    await fs.writeFile(snapshotPath+'.status.json',JSON.stringify({state:'complete',capturedAt:capture.capturedAt}));
    assert.equal((await mode.status()).mode,'collect');
    await fs.writeFile(snapshotPath+'.status.json',JSON.stringify({state:'complete',collectorVersion:'0.1.3',controlSupported:true,capturedAt:new Date(now-1).toISOString()}));
    assert.equal((await mode.status()).mode,'collect');
    await fs.writeFile(snapshotPath+'.status.json',JSON.stringify({state:'complete',collectorVersion:'0.1.3',controlSupported:true,capturedAt:capture.capturedAt}));
    const finished=await mode.status();assert.equal(finished.mode,'normal');assert.equal(finished.lastCompletedAt,capture.capturedAt);assert.equal((await read()).enabled,false);
    const saved=await fs.readFile(snapshotPath,'utf8');await mode.setMode('normal');assert.equal(await fs.readFile(snapshotPath,'utf8'),saved);
    now+=5000;await mode.setMode('collect');assert.equal((await mode.status()).mode,'collect');
    await fs.writeFile(mode.cancelPath,'{}');
    assert.equal((await mode.status()).mode,'normal');assert.equal((await read()).enabled,false);
    await mode.setMode('collect');await assert.rejects(fs.stat(mode.cancelPath),{code:'ENOENT'});
    await mode.setMode('normal');assert.equal((await read()).enabled,false);
  }finally{mode.dispose();await fs.rm(dir,{recursive:true,force:true});}
});
