import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';
import {createAppServer} from '../server.mjs';

test('end-of-produce API keeps manual candidates separate from ownership and exposes exact HIF choices',async()=>{
  const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gakumas-output-memory-')),snapshotPath=path.join(dir,'inventory.json');
  const lists={userSupportCardList:[],userIdolCardList:[{idolCardId:'i_card-kllj-3-015',levelLimitRank:0,potentialRank:0}],userCharacterList:[],userMemoryList:[]};
  const raw={schemaVersion:1,producerLevel:70,capturedAt:'2026-11-01T00:00:00Z',capture:{collections:Object.fromEntries(Object.entries(lists).map(([key,rows])=>[key,{status:'complete',expectedCount:rows.length,exportedCount:rows.length}]))},...lists};
  await fs.writeFile(snapshotPath,JSON.stringify(raw));const original=await fs.readFile(snapshotPath,'utf8');
  const server=createAppServer({catalog,snapshotPath});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const post=(route,body,extra={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  try{
    const choices=await(await fetch(base+'/api/post-produce-memory-options')).json();
    assert.equal(choices.hifAbilities.length,115);assert.ok(choices.hifAbilities.every(row=>row.hifReferenceMatched));assert.equal(choices.candidateCollectionCaptured,false);
    assert.equal(new Set(choices.abilities.map(row=>row.choiceLabel)).size,choices.abilities.length);
    const pp50=choices.abilities.filter(row=>row.choiceLabel.includes('P포인트 +50'));
    assert.ok(pp50.length>0);assert.ok(pp50.every(row=>row.branches.some(branch=>branch.directEffectValueMinRaw===50)));
    const target={scenario:'hif',plan:'anomaly',trainingType:'fullPower',producerLevel:70,idolGameId:'i_card-kllj-3-015'};
    const candidate={candidateId:'generated',kind:'normal',inputSource:'captured',abilities:[],abilitiesComplete:true,customizationsComplete:true,
      produceCard:{id:'p_card-03-act-1_042',upgradeCount:1,customizes:[]},produceCardPhaseType:1,vocal:9999,dance:9999,visual:9999};
    const response=await post('/api/post-produce-memory-choice',{target,candidates:[candidate],candidatesCaptured:true});assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.coverage.candidateCollectionCaptured,false);assert.equal(result.candidates[0].candidateIsOwnedRecord,false);
    assert.equal(result.candidates[0].candidateSource,'manual_candidate_input');assert.deepEqual(result.candidates[0].initialStats,{vo:0,da:0,vi:0});
    assert.ok(result.creationGoals.some(goal=>goal.kind==='carried_skill'));
    assert.equal(await fs.readFile(snapshotPath,'utf8'),original);
    assert.equal((await post('/api/post-produce-memory-choice',{target,candidates:[candidate]}, {Origin:'https://unrelated.example'})).status,403);
    assert.equal((await post('/api/post-produce-memory-choice',{target:{...target,producerLevel:-1},candidates:[candidate]})).status,400);
    assert.equal((await post('/api/post-produce-memory-choice',{target:{...target,plan:'sense'},candidates:[candidate]})).status,400);
    assert.equal((await post('/api/post-produce-memory-choice',{target,candidates:Array(13).fill(candidate)})).status,400);
    const state=await(await fetch(base+'/api/state')).json();assert.equal(state.collectorMode.mode,'normal');assert.equal(state.inventory.memories.length,0);
    assert.equal((await post('/api/collector-mode',{mode:'collect'})).status,200);
    assert.equal((await post('/api/collector-mode',{mode:'normal'})).status,200);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'collector-control.json'),'utf8')).enabled,false);
    const guideResponse=await post('/api/idol-operating-guidance',{idolGameId:target.idolGameId,scenario:'hif',trainingType:'fullPower',producerLevel:70});assert.equal(guideResponse.status,200);
    const guide=await guideResponse.json();assert.equal(guide.selectedIdol.ownershipVerified,true);assert.ok(guide.uniqueSkills.length);assert.ok(guide.uniqueItems.length);assert.equal(guide.battleSimulationExecuted,false);
    assert.equal((await post('/api/idol-operating-guidance',{idolGameId:target.idolGameId,scenario:'hif',trainingType:'concentration'})).status,400);
    assert.equal((await post('/api/idol-operating-guidance',{idolGameId:target.idolGameId,scenario:'hif',producerLevel:-1})).status,400);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
