import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recommend} from '../lib/recommend.mjs';

const produceResources=JSON.parse(readFileSync(new URL('../data/catalog/produce_resources.json',import.meta.url),'utf8'));
const ability=(kind,type,min,level=1)=>({kind,level,order:1,activationLimit:0,effects:[{type:'ProduceEffectType_'+type,min,max:min}]});
const card=(gameId,attribute,levelAbilities=[])=>({gameId,name:gameId,attribute,plan:'free',maxLevels:{0:40,3:55,4:60},levelAbilities});
function example(menu,levelMode,omitCash=false) {
  const fillers=Array.from({length:14},(_,i)=>card('f'+i,'dance',[ability('initial_stat','DanceAddition',10)]));
  const receiver=card('receiver','visual',[ability(menu==='drinks'?'p_drink_acquire':'ssr_card_acquire','VisualAddition',7)]);
  const amount=menu==='drinks'?100:produceResources.hif.consult.cardPrices.SSR[0];
  const cash=card('cash','dance',[ability('initial_pp','ProducePointAdditionDisableTrigger',amount,55)]),rental=card('rental','visual');
  const catalog={supportCards:[...fillers,receiver,cash,rental],skillCards:[],idolCards:[],memoryAbilities:[],produceResources,
    calculationModels:{'score/schedule':{table:{hif:{none:[{week:1,stage:'selection',activities:['consult']},{week:2,stage:'selection'}]}}},
      'score/lesson':{table:{hif:{none:{2:[{type:'sp',main:1,sub:0}]}}}},'score/hifSelectionExams':{entries:[]}}};
  const inventory={supportCards:[...fillers,receiver,...(omitCash?[]:[cash])].map(c=>({gameId:c.gameId,level:40,uncap:c===cash?3:0}))};
  const options={scenario:'hif',plan:'sense',goal:'evaluation',targetAttribute:'dance',secondaryAttribute:'visual',classAttribute:'vocal',
    deckTemplate:'4-2',activityFocus:'consult',hifConsultPlan:menu,hifScenarioItemPath:'none',supportLevelMode:levelMode,
    compareSupportUpgrades:false,rentalGameId:'rental',
    supportPeakFunding:{providerIds:['outside'],initialPP:{selection:10000}}};
  return recommend({catalog,inventory,options});
}

test('a financier below fourteen better solo stat cards buys two drinks only at its real owned uncap level', () => {
  const current=example('drinks','current'),max=example('drinks','uncapMax'),removed=example('drinks','uncapMax',true);
  const provider=max.supports.owned.find(c=>c.gameId==='cash');
  assert.equal(provider.level,55);
  assert.equal(provider.ownedLevel,40);
  assert.deepEqual(max.scoreSummary.hifModel.supportActionPlan.peakScenario.supportFunding.providers,[{gameId:'cash',level:55,rental:false}]);
  assert.equal(max.scoreSummary.expectedCounts.p_drink_exchange,2);
  assert.equal(provider.supportContribution.cappedStatDelta.visual,14);
  assert.equal(provider.supportContribution.statEvaluationPoints,28);
  for(const other of [current,removed]) {
    assert.ok(!other.supports.owned.some(row=>row.gameId==='cash'));
    assert.equal(other.scoreSummary.expectedCounts.p_drink_exchange,0);
    assert.equal(other.scoreSummary.hifModel.supportActionPlan.peakScenario.supportFunding,undefined);
  }
});

test('removing the payer also removes the real purchase receipt and its shared badge points', () => {
  const result=example('ssr','uncapMax'),provider=result.supports.owned.find(c=>c.gameId==='cash');
  assert.equal(result.scoreSummary.expectedCounts.ssr_card_acquire,1);
  assert.equal(provider.supportContribution.cappedStatDelta.visual,7);
  assert.equal(provider.supportContribution.badgeEvaluationPoints,75);
  assert.equal(provider.supportContribution.partialEvaluationPoints,89);
});

test('an automatic shop checks the selected deck after stat caps and spends only available PP', () => {
  const drink = card('drink','dance',[ability('p_drink_acquire','DanceAddition',100)]);
  const ssr = card('ssr','visual',[ability('ssr_card_acquire','VisualAddition',7)]);
  const rental = card('rental','visual');
  const owned = [drink,ssr,...['a','b','c'].map(id=>card(id,'dance'))];
  const catalog = { supportCards:[...owned,rental], skillCards:[],idolCards:[],memoryAbilities:[],produceResources,
    calculationModels:{'score/schedule':{table:{hif:{none:[{week:1,stage:'selection',activities:['consult']},{week:2,stage:'selection'}]}}},
      'score/lesson':{table:{hif:{none:{2:[{type:'sp',main:1,sub:0}]}}}},'score/hifSelectionExams':{entries:[]}} };
  const inventory = {supportCards:owned.map(c=>({gameId:c.gameId,level:40,uncap:0}))};
  const options = {scenario:'hif',plan:'sense',objective:'stats',targetAttribute:'dance',secondaryAttribute:'visual',
    classAttribute:'vocal',deckTemplate:'4-2',activityFocus:'consult',rentalGameId:rental.gameId,hifScenarioItemPath:'none',
    statCaps:{dance:1},selectionStatCaps:{dance:1},initialPP:produceResources.hif.consult.cardPrices.SSR[0]};
  const run = changes => recommend({inventory,catalog,options:{...options,...changes}}).scoreSummary.hifModel;
  const best=run({}), forced=run({hifConsultPlan:'ssr'}), drinks=run({hifConsultPlan:'drinks'});
  assert.ok(forced.supportRating.partialEvaluationPoints>drinks.supportRating.partialEvaluationPoints);
  assert.equal(best.supportRating.partialEvaluationPoints,forced.supportRating.partialEvaluationPoints);
  assert.equal(best.supportActionPlan.peakScenario.consultPlan,'ssr');
  assert.equal(best.fixedDeckPolicyComparison.policiesCompared,7);
  assert.equal(drinks.fixedDeckPolicyComparison,undefined);
  assert.equal(run({initialPP:0}).supportActionPlan.peakScenario.purchases.length,0);
});
