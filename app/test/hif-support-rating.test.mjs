import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSupportRatingContext, partialSupportRating } from '../lib/hif-support-evaluation.mjs';
import { buildItemConsideration } from '../lib/item-consideration.mjs';
import { loadCatalog } from '../lib/catalog.mjs';

const catalog = { produceResources: { hif: { star: { cardAcquisitionBase: 10, cardAcquisitionCap: 20 } } } };
const route = { counts: { skill_acquire: 19, change: 3, p_drink_acquire: 14 } };
const options = { goal: 'evaluation', supportPeakScenario: true };

test('the default development catalog can score the published HIF route and starting deck', () => {
  const reference=loadCatalog();
  assert.equal(reference.produceResources.hif.scenarioDrinkItem.id,'yellow_robot_flower');
  assert.ok(Object.keys(reference.produceInitialDecks.decks).length>0);
});

test('stat and capped badge terms use evaluation units and a shared trigger limit', () => {
  const context = buildSupportRatingContext(catalog, route, options);
  const fiveCards = partialSupportRating(3000, 0, context);
  assert.equal(partialSupportRating(2980, 2, context) - fiveCards, -40 + 75);
  assert.equal(partialSupportRating(3000, 1, context), partialSupportRating(3000, 7, context));
});

test('keeps scores in stat-only units when badge inputs are missing or fixed', () => {
  for (const other of [{ finalStar: 0 }, { goal: 'memory' }, { objective: 'memory_farming' }, { supportPeakScenario: false }]) {
    assert.equal(buildSupportRatingContext(catalog, route, { ...options, ...other }), null);
  }
  assert.equal(buildSupportRatingContext(catalog, { counts: { skill_acquire: null } }, options), null);
  assert.equal(buildSupportRatingContext({}, route, options), null);
  assert.equal(partialSupportRating(3000, 3, null), 6000);
});

test('the item view distinguishes a ranked conditional grant from a confirmed receipt', () => {
  const resources={pDrinkAcquisitions:4};
  const peak={total:{resources,activationCount:2},basis:'early_support_event_projected_route'};
  const supports=[{gameId:'supplier',nameKo:'공급 카드',p_item:{name:'드링크 아이템'},supportItemValue:{peak}}];
  const result={supports,scoreSummary:{scenario:'hif',hifModel:{supportPeakScenario:true}}};
  const items=buildItemConsideration({result,catalog}).categories.support;
  assert.equal(items.included.length,0);
  assert.equal(items.projected[0].rankedProjection.resources.pDrinkAcquisitions,4);
  assert.equal(items.items[0].actualCoverage,'conditional_peak_included');
  assert.equal(items.rankingScope.numericRankingIncludesConfirmedProduceEffectsOnly,false);
});

test('the support display reports distinct sources, shared receipts and capped marginal value', () => {
  const script=file=>fs.readFileSync(new URL('../web/'+file,import.meta.url),'utf8');
  const extract=(code,start,end)=>code.slice(code.indexOf('function '+start+'('),code.indexOf('function '+end+'('));
  const view=vm.createContext({array:v=>v??[],supportRows:v=>v,formatNumber:v=>String(v),
    escapeHtml:s=>String(s).replaceAll('<','&lt;'),easyAdviceList:()=>'',expandableMarkup:()=>''});
  vm.runInContext(extract(script('app.js'),'supportContributionMarkup','recommendedRows')+
    extract(script('playbook.js'),'supportSynergyMarkup','supportEvaluationMarkup'),view);
  const result={supports:[{gameId:'d',nameKo:'<공급>'},{gameId:'r',nameKo:'수혜'}]};
  const model={supportPeakScenario:true,supportActionPlan:{peakScenario:{routeDrinkReceipts:36}},
    supportProvidedActions:{p_drink_acquire:4},supportLinks:[{receiverId:'r',kind:'p_drink_acquire',contributors:['d'],extraCount:4,axis:'dance',pointsBeforeCap:16}]};
  const html=view.supportSynergyMarkup(result,model);
  assert.ok(html.includes('40개')&&html.includes('경로 36개')&&html.includes('서포트 4개')&&html.includes('Da +16'));
  assert.ok(html.includes('&lt;공급>')&&!html.includes('<공급>'));
  const contribution=view.supportContributionMarkup({supportContribution:{comparison:'remove_one_same_route',
    cappedStatDelta:{vocal:0,dance:7,visual:0},statEvaluationPoints:14,partialEvaluationPoints:14,badgeEvaluationPoints:0}});
  assert.ok(contribution.includes('Da +7')&&contribution.includes('+14점'));
});
