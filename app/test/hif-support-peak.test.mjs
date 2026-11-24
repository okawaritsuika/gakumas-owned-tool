import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildHifRoute } from '../lib/hif-model.mjs';
import { applyPeakExamDeckCounts, supportPeakAtExam } from '../lib/hif-support-actions.mjs';
import { peakParameterTimeline } from '../lib/hif-peak-state.mjs';
import { evaluateSupportItemValue } from '../lib/support-item-value.mjs';
import { buildProduceResourceLedger } from '../lib/produce-resource-ledger.mjs';

const catalog = loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog/', import.meta.url))});
const options = {supportPeakScenario:true, hifSelectedIdol:{gameId:'i_card-hski-1-000'},
  supportPeakInitialStats:{vocal:30,dance:30,visual:30}, secondaryAttribute:'vocal', activityFocus:'consult'};
const build = (changes = {}) => buildHifRoute(catalog, 'dance', {...options, ...changes});
const teacher = catalog.supportCards.find(card => card.gameId === 's_card-3-0099');
const drinkProvider = catalog.supportCards.find(card => card.nameJa === 'ふわふわでワクワク');
const item = (card, route, extra = {}) => evaluateSupportItemValue({card, route, level:40, plan:'sense', catalog,
  options:{...options, produceActions:route.produceActions, ...extra}});

test('consult drink scenario buys a finite stock with PP already earned in each split', () => {
  const route = build(), buys = route.supportActionPlan.peakScenario.consultDrinkPurchases;
  assert.ok(buys.length > 0);
  assert.ok(!buys.some(row => row.week === 1)); // No starting PP.
  assert.ok(buys.every(row => row.ppCost <= row.availablePP && row.count <= 4));
  assert.equal(route.counts.p_drink_exchange, buys.reduce((n, row) => n + row.count, 0));
  assert.equal(route.supportPeakScenario.routeDrinkReceipts, route.counts.activity_supply_gift + route.counts.p_drink_exchange);
  assert.equal(route.counts.p_drink_acquire, route.supportPeakScenario.routeDrinkReceipts + route.supportPeakScenario.scenarioItem.receipts);
  const ledger = buildProduceResourceLedger({result:{scoreSummary:{scenario:'hif',hifModel:route}},
    catalog,options:{route,produceActions:route.produceActions}});
  assert.equal(ledger.stages.reduce((n, stage) => n + stage.drinks.knownAcquisitions, 0), route.counts.p_drink_acquire);
  assert.equal(ledger.stages.reduce((n, stage) => n + stage.pp.knownSpend, 0), buys.reduce((n,b) => n+b.ppCost, 0));
  const granted = build({supportPeakInitialPPGrants:{selection:100}});
  assert.equal(granted.supportActionPlan.peakScenario.consultDrinkPurchases.find(row => row.week === 1)?.count, 2);
  const explicit = build({initialPP:0,supportPeakInitialPPGrants:{selection:100}});
  assert.ok(!explicit.supportActionPlan.peakScenario.consultDrinkPurchases.some(row => row.week === 1));
});

test('explicit shopping takes precedence, and normal evidence does not transfer into declared or event paths', () => {
  const action = {action:'drink_exchange',week:5,stage:'selection',fromExamIndex:0,venue:'consult',quantity:1,ppCost:75};
  const route = build({produceActions:[action]});
  assert.equal(route.stages.selection.counts.p_drink_exchange, 1);
  assert.equal(route.supportActionPlan.peakScenario.consultDrinkPurchases.some(row => row.stage === 'selection'), false);
  for (const changes of [{supportActionMode:'declared'}, {eventModeId:'asari'}, {supportPeakScenario:false},
    {hifMode:'asari'}, {expectedCounts:{p_drink_acquire:2}}]) assert.equal(build(changes).supportPeakScenario, undefined);
});

test('estimated item timing respects levels, explicit absence, acquisition order, and known thresholds', () => {
  const route = build();
  const drinks = item(drinkProvider, route);
  assert.equal(drinks.applied.resources.pDrinkAcquisitions, 0);
  assert.equal(drinks.peak.total.resources.pDrinkAcquisitions, 16); // All eight Da SP lessons occur after day one.
  assert.equal(drinks.peak.byStage.selection.resources.pDrinkAcquisitions, 12);
  const late = item(drinkProvider, route, {supportItemAcquisitions:{[drinkProvider.gameId]:{confirmed:true,week:20,fromExamIndex:3}}});
  assert.equal(late.peak.total.resources.pDrinkAcquisitions, 4);
  const plannedLate = item(drinkProvider,route,{supportPeakItemReceipt:{week:20,fromExamIndex:3,stage:'final'}});
  assert.equal(plannedLate.peak.total.resources.pDrinkAcquisitions,4);
  assert.equal(plannedLate.acquisitionConfirmed,false);
  assert.equal(item(drinkProvider, route,{supportItemAcquisitions:{[drinkProvider.gameId]:{confirmed:false}}}).peak, undefined);
  assert.equal(item(drinkProvider, route,{includeSupportEvents:false}).peak, undefined);
  const visual = item(teacher, route);
  assert.equal(visual.peak.total.stats.visual, 75);
  assert.equal(visual.applied.stats.visual, 0);
  assert.ok(visual.peak.total.activations.every(action => route.supportPeakScenario.statsBeforeWeek[action.week].visual >= 400));
  const low = build({supportPeakSelectionCaps:{visual:399}, supportPeakFinalCaps:{visual:399}});
  assert.equal(item(teacher, low).peak.total.stats.visual, 0);
  assert.equal(item(teacher, low).peak.supportEventEligibility.final, false);
  const stored = {...route,supportPeakScenario:true};
  assert.equal(item(teacher,stored).peak.total.stats.visual,75);
  const ledger = buildProduceResourceLedger({result:{scoreSummary:{scenario:'hif',plan:'sense',hifModel:stored},
    supports:[{...drinkProvider,level:40}]},catalog,options:{produceActions:route.produceActions}});
  assert.equal(ledger.supportItems[0].peak.total.resources.pDrinkAcquisitions,16);
  assert.equal(ledger.stages.reduce((n,stage) => n+stage.drinks.knownAcquisitions,0),route.counts.p_drink_acquire);
});

test('basic targets and exam deck sizes use the available copies and actual memory join phases', () => {
  const route = build();
  assert.equal(route.supportPeakScenario.initialBasicCards, 7);
  assert.equal(route.counts.delete, 4);
  assert.equal(route.counts.basic_card_change, 3);
  assert.equal(route.supportPeakScenario.remainingBasicCards, 0);
  assert.equal(route.supportPeakScenario.reassignableBasicChanges, 3);
  const memory = (id, code, obtainable = true) => ({id,modelEffects:{carriedSkill:{phase:{code},obtainable}},
    skillCard:{gameId:id,type:'active',rarity:'SSR',effectGroupIds:[],upgradeCount:1}});
  const base = applyPeakExamDeckCounts(route, [], options);
  const withMemories = applyPeakExamDeckCounts(route,[memory('one',1),memory('two',2),memory('locked',1,false)],options);
  assert.equal(withMemories.counts.ssr_card_acquire, 2);
  assert.equal(withMemories.counts.skill_acquire, base.counts.skill_acquire + 2);
  assert.deepEqual(withMemories.supportPeakScenario.examDeckSizes,base.supportPeakScenario.examDeckSizes.map((v,i) => v+(i===0?1:2)));
  assert.deepEqual(withMemories.produceActions.filter(a => a.venue === 'memory').map(a => a.fromExamIndex), [0,1]);
  assert.equal(base.supportPeakScenario.examDeckSizes[1], 9); // 7 starters + 1 unique + 3 receipts − 2 removals.
  const explicitSizes = {examDeckSizes:[14,15,14,15,15]};
  const manual = applyPeakExamDeckCounts(build(explicitSizes), [], {...options,...explicitSizes});
  assert.equal(manual.supportPeakScenario.examDeckSizes, null);
  assert.equal(manual.counts.exam_15, 3);
});

test('exam projections use the same funded plan, reserve mandatory removals and stop before each reward', () => {
  const route = applyPeakExamDeckCounts(build(), [], options);
  const full = JSON.parse(JSON.stringify(route.supportActionPlan.peakScenario));
  const first = supportPeakAtExam(full, 0), second = supportPeakAtExam(full, 1);
  assert.deepEqual(first.examDeckSizes, []);
  assert.deepEqual(second.examDeckSizes, full.examDeckSizes.slice(0, 1));
  assert.equal(Math.max(...Object.keys(first.statsBeforeWeek).map(Number)), 6);
  assert.ok(first.consultDrinkPurchases.every(row => row.week < 7));
  assert.equal(first.routeDrinkReceipts, full.routeDrinkReceiptsByExam[0]);
  assert.equal(first.remainingBasicCards, 3);
  assert.equal(first.reassignableBasicChanges, 0);
  assert.equal(second.remainingBasicCards + second.reassignableBasicChanges, 3);
  assert.equal(first.supportReceiptWeek, 6);
  assert.ok(!Object.hasOwn(second.parametersByStage, 'final'));
  const lateItem = item(teacher, route, {supportItemAcquisitions:{[teacher.gameId]:{confirmed:true,fromExamIndex:1,week:8}}});
  assert.equal(lateItem.peak.supportEventEligibility.selection, true);
  assert.equal(lateItem.peak.supportReceiptEligibility.selection, false);
});

test('an identified SSR acquisition keeps its score when a random route card has unidentified rarity', () => {
  const route = build({produceActions:[{action:'acquire',fromExamIndex:0,week:4,rarity:'SSR',type:'mental'}]});
  assert.equal(route.counts.ssr_card_acquire, 1);
  const memory = {id:'early', modelEffects:{carriedSkill:{phase:{code:1},obtainable:true}},
    skillCard:{gameId:'card',type:'active',rarity:'SSR',effectGroupIds:['effect_group-visible-exam_lesson_buff-000']}};
  const carrying = applyPeakExamDeckCounts(route, [memory], options);
  assert.equal(carrying.counts.ssr_card_acquire, 2);
  assert.equal(carrying.supportActionPlan.counts.ssr_card_acquire, 2);
  assert.deepEqual(carrying.produceActions.find(a => a.venue === 'memory').keywords, ['concentration']);
  assert.equal(carrying.stages.final.counts.ssr_card_acquire, null);
  assert.equal(applyPeakExamDeckCounts(carrying, [memory], options).counts.ssr_card_acquire, 2);
});

test('ordinary HIF custom item awards follow one native branch, replacement phases and unlocked plan drink', () => {
  const route = build(), peak = route.supportPeakScenario, custom = peak.scenarioItem;
  assert.equal(custom.id,'yellow_robot_flower');
  assert.equal(custom.receipts,10);
  assert.deepEqual(custom.byStage,{selection:6,final:4});
  assert.deepEqual(custom.actions.map(a => [a.week,a.quantity]),[[9,1],[11,1],[15,2],[18,2],[22,2],[25,2]]);
  assert.equal(peak.routeDrinkReceipts,12);
  assert.equal(route.counts.p_drink_acquire + item(drinkProvider,route).peak.total.resources.pDrinkAcquisitions,38);
  assert.equal(supportPeakAtExam(peak,0).scenarioItem.receipts,0);
  assert.equal(supportPeakAtExam(peak,1).scenarioItem.receipts,2);
  assert.equal(supportPeakAtExam(peak,2).scenarioItem.receipts,6);
  const without = build({hifScenarioItemPath:'none'});
  assert.equal(without.supportPeakScenario.scenarioItem.receipts,0);
  assert.equal(without.counts.p_drink_acquire,12);
  for(const [plan,plv,receipts] of [['logic',54,10],['logic',55,10],['anomaly',59,10],['anomaly',60,10]]){
    assert.equal(build({supportPeakPlan:plan,producerLevel:plv}).supportPeakScenario.scenarioItem.receipts,receipts);
  }
  const entered = build({produceActions:[{action:'drink_acquire',quantity:2,week:15,fromExamIndex:2,venue:'scenario_item'}]});
  assert.equal(entered.supportPeakScenario.scenarioItem.receipts,2);
  assert.equal(entered.counts.p_drink_acquire,14);
});

test('peak action gates use the selected memory and account context, respecting per-opportunity growth and stage caps', () => {
  const route={selections:[
    {week:1,stage:'selection',main:'visual',gains:{visual:11}},
    {week:2,stage:'selection',activity:'class_vi',gains:{visual:7}},
    {week:3,stage:'selection',activity:'mid_exam',fromExamIndex:0},
    {week:4,stage:'selection',activity:'final_exam',fromExamIndex:1},
    {week:5,stage:'final',main:'visual',gains:{visual:3}},
    {week:6,stage:'final',activity:'final_exam',fromExamIndex:3}],
    examRewards:[{parameterGains:{visual:11},growthEligibleGains:{visual:11}},{parameterGains:{visual:5},growthEligibleGains:{visual:0}}]};
  const context={initialStats:{visual:4},stageContexts:{
    selection:{statCaps:{visual:47},outsideGrowthRatePermil:{visual:500}},
    final:{statCaps:{visual:100},outsideGrowthRatePermil:{visual:400},additionalInitialStats:{visual:8}}}};
  const projected=peakParameterTimeline(route,{supportPeakStatContext:context});
  assert.deepEqual(Object.values(projected.statsBeforeWeek).map(stats=>stats.visual),[4,20,27,43,55,59]);
  const updated=applyPeakExamDeckCounts(build(),[],{...options,supportPeakStatContext:{initialStats:{visual:402}}});
  assert.equal(updated.supportActionPlan.peakScenario.statsBeforeWeek[1].visual,402);
  assert.equal(updated.supportActionPlan.peakScenario.jointEventTimingVerified,false);
});
