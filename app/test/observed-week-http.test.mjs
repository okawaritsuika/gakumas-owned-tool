import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';
import { loadCatalog } from '../lib/catalog.mjs';

test('one saved deck accepts replacement menus through the weekly HTTP endpoint', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gakumas-menu-'));
  const snapshotPath = path.join(dir, 'inventory.json');
  const catalog = loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog', import.meta.url))});
  const idol = catalog.idolCards.find(card => card.plan === 'sense');
  catalog.supportCards = catalog.supportCards.filter(card => card.plan === 'free').slice(0, 6);
  const server = createAppServer({snapshotPath, catalog});
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, {recursive:true, force:true});
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const post = async (route, body) => {
    const res = await fetch('http://127.0.0.1:'+server.address().port+'/api/'+route,
      {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const result = await res.json();
    assert.equal(res.status, 200, result.error);
    return result;
  };
  await post('import', {schemaVersion:1, capture:{}, producerLevel:70, capturedAt:'2026-11-21T00:00:00Z',
    userIdolCardList:[{idolCardId:idol.gameId, levelLimitRank:0, potentialRank:0}],
    userSupportCardList:catalog.supportCards.slice(0,5).map(card => ({supportCardId:card.gameId,level:1,levelLimitRank:0}))});
  const saved = await readFile(snapshotPath);
  for (const [scenario,difficulty,activity] of [['hajime','legend','legend_mid_exam'],['nia','master','business'],['hif','none','interval']]) {
    const {accountPlaybook:book} = await post('recommend',{scenario,difficulty,idolId:idol.gameId,type:'concentration'});
    const row = book.weekPlan.find(row => row.activity === activity);
    const live = async liveState => (await post('week-choices',{week:row.week,
      recommendationContextId:book.recommendationContextId,liveState})).weekAdvice.observedChoice.detail;
    assert.deepEqual(await live({}),row.choiceAdvice.observedChoice.detail);
    if (scenario === 'hajime') {
      const [a,b,c] = ['p_card-01-act-100_004','p_card-01-act-100_003','p_card-01-men-100_001'];
      const choose = async ids => (await live({observation:{midtermPassed:true,offeredCardIds:ids}})).recommended.gameId;
      assert.equal(await choose([a,b]),a);
      assert.equal(await choose([b,c]),b);
    } else if (scenario === 'nia') {
      const choose = async ids => (await live({stamina:5,observation:{week:row.week,difficulty,priority:'drink',
        venueOffers:ids.map(id=>({id}))}})).recommendation.id;
      assert.equal(await choose(['company','commercial']),'company');
      assert.equal(await choose(['commercial']),'commercial');
    } else {
      const observation={heldDrinkIds:[],freeSlots:1,desiredDrinkIds:['A'],offers:[{drinkId:'A',price:50}]};
      assert.equal((await live({pp:49,observation})).current.allDesired,false);
      assert.equal((await live({pp:50,observation})).current.allDesired,true);
    }
    assert.deepEqual(await live({}),row.choiceAdvice.observedChoice.detail);
  }
  assert.deepEqual(await readFile(snapshotPath),saved);
});
