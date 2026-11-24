import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';
import {buildIdolRecommendation} from '../lib/pidol-recommendation.mjs';

const catalog = loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog/',import.meta.url))});
const data = catalog.idolEffectData;
const saki = catalog.idolCards.find(c=>c.gameId==='i_card-hski-3-000');
const sample = {card:saki,owned:{levelLimitRank:3,potentialRank:2},data,scope:'hajime-legend',plv:70};
const read = overrides=>buildIdolRecommendation({...sample,...overrides});

test('training and awakening independently select verified variants, unowned previews use base',()=>{
  const basic = read({owned:null}), trained = read({}), zero = read({owned:{levelLimitRank:0,potentialRank:0}});
  assert.equal(basic.value,zero.value);
  assert.equal(trained.value,77);
  assert.notEqual(read({owned:{levelLimitRank:2,potentialRank:2}}).value,trained.value);
  assert.notEqual(read({owned:{levelLimitRank:3,potentialRank:1}}).value,trained.value);
  assert.match(basic.stateLabel,/기본 사양/);
  const unknown = read({owned:{potentialRank:2}});
  assert.ok(unknown.estimated);
  assert.match(unknown.stateLabel,/특훈 미확인/);
});

test('only a purchase declared for this outfit and unlocked variant changes the score',()=>{
  const owned = {levelLimitRank:7,potentialRank:2};
  const unlocked = read({owned});
  assert.equal(unlocked.value,read({}).value);
  const turn = unlocked.customizationOptions.find(o=>o.label.includes('턴 +1'));
  assert.match(turn.label,/120P/);
  assert.throws(()=>read({selectedCustomId:turn.id}),/선택할 수 없는 개조/);
  const bought = read({owned,selectedCustomId:turn.id});
  assert.equal(bought.basis,unlocked.basis);
  assert.ok(bought.value>unlocked.value);
  assert.equal(read({owned:{...owned,pastCustomization:turn.id}}).value,unlocked.value);
  for (const scope of ['hajime-regular','hajime-pro','hajime-master']) {
    assert.deepEqual(read({owned,scope}).customizationOptions,[]);
    assert.throws(()=>read({owned,scope,selectedCustomId:turn.id}),/선택할 수 없는 개조/);
  }
});

test('grounds for a direct evaluation are scoped and cannot alter the index',()=>{
  const key = sample.scope+'/'+saki.gameId;
  const evidence = {[key]:{reason:'시험용 근거',minTraining:7,minPlv:70,sources:[]}};
  const detached = {...data,evidence:{}}, linked = {...data,evidence};
  const qualified = {levelLimitRank:7,potentialRank:2};
  assert.equal(read({data:linked,owned:qualified}).value,read({data:detached,owned:qualified}).value);
  assert.ok(!read({data:linked,owned:qualified}).estimated);
  assert.ok(read({data:linked}).estimated);
  assert.ok(read({data:linked,owned:qualified,plv:45}).estimated);
  const event = read({data:linked,owned:qualified,eventModeId:'event'});
  assert.ok(event.estimated);
  assert.equal(event.basis,'common');
});

test('missing native linkage reports the missing ID and preserves the verified part',()=>{
  const missingId = saki.uniqueIds.afterProduceItemId;
  const result = read({data:{...data,items:{...data.items,[missingId]:undefined}}});
  assert.equal(result.value,null);
  assert.equal(result.basis,'missing');
  assert.ok(result.missing.includes(missingId));
  assert.ok(result.known.includes(data.skills[saki.uniqueIds.produceCardId+':1'].name));
});

test('common peak preparation includes the available Prima Stella independently of personal ownership',()=>{
  const card = catalog.idolCards.find(c=>data.primaSkills?.[c.gameId]);
  const owned = {...sample.owned,primaStella:true};
  const final = read({card,owned,scope:'hif'});
  assert.match(final.stateLabel,/본선 프리마/);
  assert.ok(Number.isInteger(final.value));
  const name = data.skills[data.primaSkills[card.gameId]+':0'].name;
  assert.ok(final.known.includes(name));
  assert.match(read({card,scope:'hif'}).stateLabel,/본선 프리마/);
  for (const other of [read({card,owned}),read({card,owned,scope:'hif',eventModeId:'event'})])
    assert.ok(!other.stateLabel.includes('본선 프리마'));
});

test('ordinary HIF ranks attained final parameters, retains marginal and qualifier measurements and carries stamina',()=>{
  const card=catalog.idolCards.find(c=>c.gameId==='i_card-kllj-3-010');
  const args={card,catalog,scope:'hif',plv:72,owned:{levelLimitRank:4,potentialRank:4}};
  const first=read(args),second=read(args);
  assert.equal(first.hif.missing,'');
  const {selection,final,finalR2}=first.hif.stages;
  assert.equal(first.value,final.on+finalR2.on);
  assert.equal(first.hif.finalContribution,final.delta+finalR2.delta);
  assert.equal(selection.delta,selection.on-selection.off);
  for (const key of ['withOutfit','withoutOutfit']) {
    const interval=first.hif.peak.interval[key];
    assert.equal(final.endStamina[key],interval.carried);
    assert.equal(finalR2.startStamina[key],interval.starting);
    assert.ok(interval.spent<=120);
  }
  assert.equal(first.estimated,true);
  assert.equal(first.basis,'scenario');
  assert.equal(first.hif,second.hif);
  const event=read({...args,eventModeId:'period'});
  assert.equal(event.hif,undefined);
  assert.equal(event.value,58);
  const unknown=read({...args,plv:null});
  assert.equal(unknown.value,first.value);
  assert.equal(unknown.hif,first.hif);
  assert.equal(unknown.availability.plv,null);
  assert.equal(unknown.estimated,true);
  assert.equal(read({...args,scope:'hajime-legend'}).hif,undefined);
});
