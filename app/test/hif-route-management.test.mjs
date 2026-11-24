import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';
import {buildHifRoute} from '../lib/hif-model.mjs';
import {applyPeakExamDeckCounts, supportPeakAtExam} from '../lib/hif-support-actions.mjs';
import {planHifPurchases} from '../lib/hif-route-purchases.mjs';
import {deriveSupportFunding} from '../lib/hif-support-funding.mjs';
import {chooseHifActionStrategy} from '../lib/hif-action-strategies.mjs';
import {buildProduceResourceLedger} from '../lib/produce-resource-ledger.mjs';
import {declaredProduceActionCounts} from '../lib/produce-action-counts.mjs';

const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog/',import.meta.url))});
const data=catalog.produceResources.hif;
const idol=catalog.idolCards.find(i=>i.gameId==='i_card-hski-1-000');
const card=catalog.skillCards.find(s=>s.gameId==='p_card-01-act-2_003'&&s.upgradeCount===1);
const memory={id:'carried',skillCard:card,modelEffects:{carriedSkill:{obtainable:true,phase:{code:1},customizes:[]}}};
const defaults={catalog,supportPeakScenario:true,hifSelectedIdol:idol,producerLevel:65,activityFocus:'consult',hifConsultPlan:'none'};
function build(options,memories=[]) {
  const config={...defaults,...options};
  return applyPeakExamDeckCounts(buildHifRoute(catalog,'dance',config),memories,config);
}

test('each pouch path selects one actual form per stage and a second distinct designated drink needs PLv',()=>{
  assert.equal(Object.keys(data.scenarioItemPaths.paths).length,45);
  for(const [id,path] of Object.entries(data.scenarioItemPaths.paths)){
    assert.equal(path.formKeys.length,3); assert.equal(path.formKeys[2],id);
    for(const [index,key] of path.formKeys.entries()){
      const form=data.scenarioItemPaths.forms[key]; assert.equal(form.fromExamIndex,index+1);
      assert.deepEqual(Object.keys(form.nativeByPlan).sort(),['anomaly','logic','sense']);
    }
  }
  const route=plv=>build({activityFocus:'outing',hifScenarioItemPath:'yellow_rabbit_ribbon',producerLevel:plv},[memory]);
  const low=route(0),high=route(55);
  assert.equal(low.supportPeakScenario.scenarioItem.receipts,4);
  assert.equal(high.supportPeakScenario.scenarioItem.receipts,6);
  const copy=high.produceActions.find(a=>a.action==='copy');
  assert.equal(copy.gameId,card.gameId); assert.equal(copy.triggerCounts.skill_acquire,1);
  assert.equal(copy.afterDeckSize,copy.beforeDeckSize+1);
  assert.equal(high.supportPeakScenario.scenarioItem.actionCounts.copy,1);
  assert.equal(supportPeakAtExam(high.supportPeakScenario,2).scenarioItem.actionCounts.copy,undefined);
  assert.equal(high.produceActions.filter(a=>a.action==='acquire'&&a.week===copy.week&&a.originId===copy.originId).length,0);
  const ledger=buildProduceResourceLedger({result:{scoreSummary:{scenario:'hif',hifModel:high}},catalog,
    options:{route:high,produceActions:high.produceActions}});
  assert.ok(ledger.stages.flatMap(s=>s.activityRows).some(r=>r.activity==='copy'&&r.cards.min===1));
});

test('consultation chooses one funded product, uses the native PLv gate, and respects entered spending',()=>{
  const config={hifScenarioItemPath:'green_rabbit_ribbon',initialPP:{selection:120,final:300}};
  const closed=build({...config,hifConsultPlan:'upgrade',producerLevel:4});
  assert.equal(closed.supportPeakScenario.purchases.length,0);
  const open=build({...config,hifConsultPlan:'upgrade',producerLevel:5},[memory]);
  assert.ok(open.supportPeakScenario.purchases.length>=2);
  assert.ok(open.supportPeakScenario.purchases.every(p=>p.action==='upgrade'&&p.ppCost<=p.availablePP&&p.count===1));
  const closedDelete=build({...config,hifConsultPlan:'remove',producerLevel:14});
  assert.equal(closedDelete.supportPeakScenario.purchases.length,0);
  const bought=build({...config,hifConsultPlan:'ssr'});
  assert.ok(bought.supportPeakScenario.purchases.length>0);
  assert.ok(bought.produceActions.filter(a=>a.basis==='conditional_retry_route_purchase').every(a=>a.rarity==='SSR'&&a.ppCost===(a.venue==='interval'?50:100)));
  const explicit=build({...config,hifConsultPlan:'ssr',produceActions:[{action:'acquire',week:1,fromExamIndex:0,
    stage:'selection',venue:'consult',rarity:'SSR',ppCost:100}]});
  assert.ok(explicit.supportPeakScenario.purchases.every(a=>a.stage==='final'));
});

test('round-1 reward PP buys real interval offers for round 2 without consult-only activations',()=>{
  const fromRound1={action:'pp_gain',amount:150,week:27,fromExamIndex:4,stage:'final',venue:'exam_reward'};
  const config={hifScenarioItemPath:'none',produceActions:[fromRound1]};
  const bought=build({...config,hifConsultPlan:'drinks'});
  const peak=bought.supportPeakScenario,interval=peak.purchases.find(p=>p.venue==='interval');
  assert.equal(interval.week,28);assert.equal(interval.count,2);assert.equal(interval.ppCost,150);
  assert.deepEqual(interval.ppCostRange,{min:100,max:150});
  assert.ok(!supportPeakAtExam(peak,3).purchases.some(p=>p.venue==='interval'));
  assert.ok(supportPeakAtExam(peak,4).purchases.some(p=>p.venue==='interval'));
  assert.equal(bought.counts.p_drink_exchange,peak.consultDrinkPurchases.reduce((n,p)=>n+p.count,0));
  const explicit=declaredProduceActionCounts([{action:'drink_exchange',quantity:2,fromExamIndex:4,venue:'interval'}],catalog);
  assert.equal(explicit.p_drink_exchange,0);assert.equal(explicit.p_drink_acquire,2);
  for(const [plan,rarity,plus] of [['skills','SR',1],['ssr','SSR',0]]){
    const route=build({...config,hifConsultPlan:plan}),op=route.produceActions.find(a=>a.venue==='interval'&&a.action==='acquire');
    assert.deepEqual([op.rarity,op.upgradeCount,op.ppCost],[rarity,plus,50]);
    assert.equal(op.triggerCounts.consult_skill_card_acquire,undefined);
  }
  const target=catalog.skillCards.find(s=>s.gameId===card.gameId&&s.upgradeCount===0);
  const granted={...fromRound1,id:'before-interval',action:'acquire',gameId:target.gameId,amount:undefined,upgradeCount:0,independentAcquisition:true};
  const up=build({...config,hifConsultPlan:'upgrade',produceActions:[fromRound1,granted]});
  assert.equal(up.supportPeakScenario.purchases.find(p=>p.venue==='interval'&&p.action==='upgrade').ppCost,100);
  assert.ok(!build({...config,hifConsultPlan:'remove'}).supportPeakScenario.purchases.some(p=>p.venue==='interval'));
});

test('special instruction spends actual native prices on a held upgraded skill with available custom slots',()=>{
  const config={hifScenarioItemPath:'none',hifConsultPlan:'customize',initialPP:{selection:110,final:110}};
  const empty=build(config), withMemory=build(config,[memory]);
  assert.equal(empty.supportPeakScenario.purchases.length,0);
  assert.ok(!empty.supportActionPlan.generatedActions.some(a=>a.action==='customize'));
  const purchases=withMemory.supportPeakScenario.purchases;
  assert.deepEqual(purchases.map(p=>p.ppCost),[20,40]);
  assert.ok(purchases.every(p=>p.venue==='special_training'||p.venue==='interval'));
  assert.equal(purchases[1].availablePP,290);
  assert.ok(withMemory.produceActions.filter(a=>a.action==='customize').every(a=>a.gameId===card.gameId&&a.customizationId&&a.cardTargetResolved));
  const unknownHistory={...memory,modelEffects:{carriedSkill:{obtainable:true,phase:{code:1}}}};
  assert.equal(build(config,[unknownHistory]).supportPeakScenario.purchases.length,0);
});

test('locked support funding uses pre-purchase fixed PP and rounded lesson rewards in the proper split',()=>{
  const owner={gameId:'fixed',level:50,resources:{pp:999,itemPPByWeek:{1:999},ppByWeek:{0:20,1:40,3:500},
    lessonPPBonuses:[{axis:'dance',spOnly:true,permil:50}],drinkDiscountPermil:200}};
  const funding=deriveSupportFunding({catalog,result:{supports:{owned:[owner],rental:null},scoreSummary:{hifModel:{supportPeakScenario:true}}}});
  assert.deepEqual(funding.initialPP,{selection:20,final:0}); assert.equal(funding.ppByWeek[1],40);
  const route={activityFocus:'consult',selections:[{week:1,stage:'selection',activity:'consult'},
    {week:2,stage:'selection',main:'dance'}, {week:3,stage:'selection',activity:'consult'},
    {week:4,stage:'final',activity:'consult'}, {week:5,stage:'final',main:'dance'}, {week:6,stage:'final',activity:'consult'}]};
  const costs=planHifPurchases(route,data,[],[],{hifConsultPlan:'drinks',supportPeakFunding:funding}).purchases;
  assert.deepEqual(costs.map(p=>[p.week,p.availablePP,p.ppCost]),[[3,91,80],[6,52,40]]);
  assert.deepEqual(planHifPurchases(route,data,[],[],{hifConsultPlan:'drinks'}).purchases.map(p=>p.week),[6]);
  const ledger=initialPP=>buildProduceResourceLedger({catalog,result:{scoreSummary:{scenario:'hif',plan:'sense'},supports:{owned:[owner]}},
    options:{route:{...route,supportActionPlan:{peakScenario:{supportFunding:funding}}},initialPP}});
  assert.equal(ledger().stages[0].pp.knownIncome,591);
  assert.equal(ledger(20).stages[0].pp.knownIncome,571);
  assert.equal(ledger().stages[1].pp.knownIncome,52);
});

test('automatic alternate respects an explicit path and compares a high-value eligible enhancement trigger',()=>{
  const support={gameId:'enhance',plan:'free',maxLevels:[40,45,50,55,60],levelAbilities:[{kind:'skill_enhance',level:40,order:1,
    activationLimit:99,effects:[{type:'ProduceEffectType_DanceAddition',min:70,max:70}]}]};
  const fixture={...catalog,supportCards:[support]};
  const route=build({hifConsultPlan:'drinks',hifScenarioItemPath:'none',initialPP:{selection:150,final:300}},[memory]);
  const result={selectedIdol:idol,supports:{owned:[{gameId:support.gameId,level:40}]},scoreSummary:{plan:idol.plan,hifModel:{...route,
    primaryAttribute:'dance',secondaryAttribute:'vocal',supportPeakScenario:true}}};
  const opts={initialPP:{selection:150,final:300},hifScenarioItemPath:'none',objective:'stats',producerLevel:65,rentalGameId:support.gameId};
  const pick=(changes={})=>chooseHifActionStrategy({catalog:fixture,inventory:{},result,focus:'consult',options:{...opts,...changes}});
  assert.deepEqual(pick(),{hifConsultPlan:'upgrade',hifScenarioItemPath:'none',choicesConsidered:7});
  assert.equal(pick({hifConsultPlan:'remove'}),null);
  assert.equal(pick({produceActions:[{action:'change',week:2}]}),null);
  assert.equal(pick({eventModeId:'limited'}),null);
});
