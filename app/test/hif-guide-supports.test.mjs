import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildHifRoute } from '../lib/hif-model.mjs';
import { buildHifGuideSupports } from '../lib/hif-guide-supports.mjs';

const catalog = loadCatalog({ dataDir:fileURLToPath(new URL('../data/catalog/',import.meta.url)) });
const selection = (gameId,level=45) => ({gameId,level,levelBasis:'current'});
const owned = ['s_card-3-0002','s_card-3-0005','s_card-3-0010','s_card-3-0004','s_card-3-0014'].map(gameId=>selection(gameId));
const effectFor = (support,kind) => support.triggers.find(row=>row.kind===kind);
const giftRoute = buildHifRoute(catalog,'dance',{activityFocus:'supply_gift',producerLevel:72});
const consultRoute = buildHifRoute(catalog,'dance',{activityFocus:'consult',producerLevel:72});
const model = {...consultRoute,selections:consultRoute.selections.map(row=>row.week===1?giftRoute.selections[0]:row)};
function guide(rental,producerLevel=72,hifModel=model) {
  const result = {scoreSummary:{scenario:'hif',plan:'sense',trainingType:'goodConditionTurns',hifModel},
    supports:{owned,rental},rentalCandidates:[selection('s_card-3-0070')]};
  return buildHifGuideSupports({result,catalog,options:{producerLevel}});
}

test('changing only the sixth equipped support switches receipt to consultation exchange or clears the drink guidance',()=>{
  const receipt = guide(selection('s_card-3-0070'));
  const exchange = guide(selection('s_card-3-0027'));
  const neither = guide(selection('s_card-3-0008'));
  assert.equal(receipt.supports.length,6);
  assert.deepEqual(receipt.supports.slice(0,5),exchange.supports.slice(0,5));
  assert.deepEqual(receipt.supports.slice(0,5),neither.supports.slice(0,5));
  assert.deepEqual(receipt.deckManagement,exchange.deckManagement);
  assert.deepEqual(receipt.deckManagement,neither.deckManagement);
  assert.equal(receipt.supports[5].isRental,true);
  const acquire = effectFor(receipt.supports[5],'p_drink_acquire');
  const shop = effectFor(exchange.supports[5],'p_drink_exchange');
  assert.match(acquire.condition,/획득/);
  assert.ok(acquire.venues.some(row=>row.activity==='supply_gift'&&row.weeks.includes(1)&&/빈 슬롯/.test(row.action)));
  assert.ok(acquire.venues.some(row=>row.activity==='interval'&&row.weeks.includes(28)));
  assert.match(shop.condition,/상담.*교환/);
  assert.deepEqual(shop.venues.map(row=>row.activity),['consult']);
  assert.equal(effectFor(neither.supports[5],'p_drink_acquire'),undefined);
  assert.equal(effectFor(neither.supports[5],'p_drink_exchange'),undefined);
});

test('support trigger filters use the unlocked ability, target type and planned venue',()=>{
  const upgrade = effectFor(guide(selection('s_card-3-0047')).supports[5],'a_skill_enhance');
  const basicChange = effectFor(guide(selection('s_card-3-0099')).supports[5],'basic_card_change');
  assert.match(upgrade.condition,/액티브.*강화/);
  assert.ok(upgrade.venues.some(row=>row.activity==='consult'&&/미강화 액티브/.test(row.action)));
  assert.ok(upgrade.venues.some(row=>row.activity==='interval'&&/본선 R2/.test(row.action)));
  assert.deepEqual(effectFor(guide(selection('s_card-3-0047'),4).supports[5],'a_skill_enhance').venues,[]);
  assert.equal(effectFor(guide(selection('s_card-3-0047',4)).supports[5],'a_skill_enhance'),undefined);
  assert.equal(basicChange.limit,3);
  assert.match(basicChange.condition,/기본 카드/);
  assert.ok(!basicChange.venues.find(row=>row.activity==='class').weeks.includes(3));
  const conditionalItem = guide(selection('s_card-3-0099')).supports[5].item;
  assert.equal(conditionalItem.acquisitionStatus,'conditional');
  assert.equal(conditionalItem.conditionData.threshold,400);
  assert.deepEqual(conditionalItem.limit,{key:'per_produce',count:3});
});

test('native auto removal, manual removal, refresh and R2 refill remain independent',()=>{
  const ready = guide(selection('s_card-2-0029'),15);
  const locked = guide(selection('s_card-2-0029'),14);
  const general = effectFor(ready.supports[5],'delete');
  const typed = effectFor(guide(selection('s_card-3-0054'),15).supports[5],'m_skill_delete');
  assert.deepEqual(general.venues.find(row=>row.automatic).weeks,[7,13]);
  assert.equal(typed.venues.find(row=>row.automatic).targetMatch,'deleted_card_must_match');
  assert.ok(general.venues.some(row=>row.activity==='consult'&&row.action));
  assert.ok(!effectFor(locked.supports[5],'delete').venues.some(row=>row.activity==='consult'));
  const {automaticRemovals,manualRemoval,consultRefresh,selectChange,round2Refill} = ready.deckManagement;
  assert.deepEqual(automaticRemovals.map(row=>[row.examNumber,row.week,row.count]),[[1,7,2],[2,13,2]]);
  assert.equal(manualRemoval.unlockProducerLevel,15);
  assert.deepEqual(locked.deckManagement.manualRemoval.weeks,[]);
  assert.deepEqual(manualRemoval.weeks,consultRefresh.weeks);
  assert.equal(consultRefresh.unlockAffectionLevel,27);
  assert.equal(consultRefresh.sharedAcrossSelectionAndFinal,true);
  assert.equal(selectChange.changesDeckSize,false);
  assert.equal(selectChange.countsAsAcquisition,false);
  assert.equal(round2Refill.minimumDeckSize,22);
  assert.equal(round2Refill.week,29);
  assert.equal(round2Refill.gameId,'pitem_01-3-266-0');
  assert.equal(round2Refill.countsAsAcquisition,false);
  assert.equal(manualRemoval.recommendedCount,undefined);
  assert.equal(selectChange.recommendedCount,undefined);
});
