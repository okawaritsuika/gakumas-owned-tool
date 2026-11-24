import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildProduceResourceLedger } from '../lib/produce-resource-ledger.mjs';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildHifRoute } from '../lib/hif-model.mjs';

const resources=JSON.parse(fs.readFileSync(new URL('../data/catalog/produce_resources.json',import.meta.url),'utf8'));
const fixture=()=>({catalog:{produceResources:resources,skillCards:[],supportCards:[]},result:{scoreSummary:{scenario:'hif',plan:'anomaly',hifModel:{selections:[
  {week:2,main:'dance',sub:'vocal',activity:'da_lesson_vo'},
  {week:3,activity:'class_vo'},
  {week:8,activity:'supply_gift'},
  {week:12,activity:'consult'},
  {week:14,activity:'outing'},
  {week:22,main:'dance',sub:'vocal',activity:'da_lesson_vo'},
  {week:23,activity:'supply_gift'},
]}}}});

test('uses the chosen visits and exact native lesson costs, splitting PP and drink carry at the final',()=>{
  const input=fixture(),before=structuredClone(input);
  const ledger=buildProduceResourceLedger({...input,options:{maxStamina:30}}),[selection,final]=ledger.stages;
  assert.equal(ledger.status,'partial_resource_ledger');
  assert.equal(selection.pp.knownIncome,110);
  assert.equal(final.pp.knownIncome,130);
  assert.equal(selection.stamina.knownCost,8);
  assert.equal(final.stamina.knownCost,8);
  assert.equal(selection.stamina.knownRecovery,18);
  assert.equal(selection.star.lessonBaseIncome,30);
  assert.equal(final.star.lessonBaseIncome,30);
  assert.deepEqual(selection.cards.range,{min:2,max:4});
  assert.equal(selection.drinks.knownAcquisitions,2);
  assert.equal(final.drinks.knownAcquisitions,1);
  for(const stage of ledger.stages){assert.equal(stage.pp.initial,null);assert.equal(stage.pp.balance,null);assert.equal(stage.drinks.actualPossession,null);assert.equal(stage.drinks.carryFromSelection,false);}
  assert.equal(selection.activityCounts.consult,1);
  assert.equal(selection.pp.knownSpend,0);
  assert.equal(selection.activityRows.find(row=>row.activity==='consult').ppSpend,0);
  assert.deepEqual(input,before);
});

test('one floor follows multiplied verified HIF and SALE discounts; missing modifiers are not silently zero',()=>{
  const input=fixture();input.catalog.skillCards=[{gameId:'ssr',upgradeCount:1,rarity:'SSR',nameJa:'検証'}];
  const action={action:'acquire',gameId:'ssr',upgradeCount:1,fromExamIndex:1,venue:'consult',sale:true,priceModifiersConfirmed:true};
  const inventory={hifBonuses:{status:'current_account',selection:{shopCardDiscountPermil:150,initialPP:0},finalOnly:{initialPP:0}}};
  const ledger=buildProduceResourceLedger({...input,inventory,options:{produceActions:[action]}});
  const row=ledger.stages[0].activityRows.find(row=>row.activity==='acquire');
  assert.equal(row.basePrice,150);assert.equal(row.ppSpend,89);assert.equal(ledger.stages[0].pp.knownSpend,89);
  const missing=buildProduceResourceLedger({...input,options:{produceActions:[action]}}).stages[0].activityRows.find(row=>row.activity==='acquire');
  assert.equal(missing.ppSpend,null);assert.deepEqual(missing.ppSpendRange,{min:0,max:150});
});

test('preserves the sixth-price conflict and unknown purchase order; source-free actions do not become free consultation',()=>{
  const input=fixture();
  const ledger=buildProduceResourceLedger({...input,options:{produceActions:[
    {action:'upgrade',fromExamIndex:1,venue:'consult',purchaseIndex:6},
    {action:'remove',fromExamIndex:1,venue:'consult'},
    {action:'upgrade',fromExamIndex:3},
  ]}});
  const upgrade=ledger.stages[0].activityRows.find(row=>row.activity==='upgrade'),remove=ledger.stages[0].activityRows.find(row=>row.activity==='remove');
  assert.equal(upgrade.ppSpend,null);assert.deepEqual(upgrade.ppSpendRange,{min:225,max:250});
  assert.deepEqual(remove.ppSpendRange,{min:100,max:null});assert.equal(ledger.stages[1].activityRows.find(row=>row.activity==='upgrade').ppSpend,null);
  assert.equal(ledger.stages[0].pp.balance,null);
});

test('declared card targets reuse generic activity opportunities without double acquisition and change has no badge income',()=>{
  const input=fixture();input.result.scoreSummary.hifModel.selections=[{week:8,activity:'supply_gift'}];
  const ledger=buildProduceResourceLedger({...input,options:{produceActions:[
    {action:'acquire',gameId:'target',fromExamIndex:1,week:8},
    {action:'change',gameId:'other',fromExamIndex:1,week:10},
  ]}});
  const selection=ledger.stages[0];
  assert.equal(selection.cards.knownAcquisitions,1);assert.equal(selection.cards.declaredTargets.length,1);
  assert.equal(selection.star.declaredCardBaseIncome,null);assert.deepEqual(selection.star.potentialDeclaredCardBaseIncome,{min:0,max:10});
  assert.equal(selection.star.total,null);
});

test('uses actual support level, bounds random memory recovery, and leaves unconfirmed Pitem resources potential only',()=>{
  const input=fixture();
  const support={gameId:'support',nameJa:'検証サポート',level:25,plan:'free',levelAbilities:[
    {level:1,order:1,kind:'initial_pp',activationLimit:1,effects:[{type:'ProduceEffectType_ProducePointAdditionDisableTrigger',min:10,max:10,triggerId:'p_trigger-produce_start-initial',ratePermil:0}]},
    {level:20,order:1,kind:'initial_pp',activationLimit:1,effects:[{type:'ProduceEffectType_ProducePointAdditionDisableTrigger',min:20,max:20,triggerId:'p_trigger-produce_start-initial',ratePermil:0}]},
    {level:40,order:1,kind:'initial_pp',activationLimit:1,effects:[{type:'ProduceEffectType_ProducePointAdditionDisableTrigger',min:90,max:90,triggerId:'p_trigger-produce_start-initial',ratePermil:0}]},
    {level:1,order:2,kind:'sp_lesson_hp',activationLimit:1,effects:[{type:'ProduceEffectType_StaminaRecoverFix',min:3,max:3,triggerId:'p_trigger-end_lesson-lesson_dance_sp',ratePermil:0}]},
  ],p_item:{name:'未確認アイテム',effect:{trigger:{key:'activity_supply_gift_selection'},body:[{key:'pp_gain',value:20}],limit:{key:'per_produce',count:2}}}};
  input.result.supports=[support];
  input.result.memories=[{id:'memory',modelEffects:{conditionalEffects:[{kind:'stamina_recover',type:'StaminaRecoverFix',applies:true,valueMin:4,valueMax:4,trigger:{id:'p_trigger-end_lesson-lesson_dance_sp'},probability:{rawPermil:300}}]}}];
  const ledger=buildProduceResourceLedger(input),[selection,final]=ledger.stages;
  assert.equal(selection.pp.knownIncome,130);assert.equal(final.pp.knownIncome,130);
  assert.equal(selection.stamina.knownRecovery,3);
  assert.equal(final.stamina.knownRecovery,0);
  const memory=ledger.supportEffects.find(row=>row.source==='memory');
  assert.deepEqual(memory.byStage.selection,{min:0,max:4});assert.deepEqual(memory.byStage.final,{min:0,max:4});
  assert.equal(ledger.supportItems[0].applied.resources.pp,0);
  assert.equal(ledger.supportItems[0].potential.early.resources.pp,40);
});

test('real catalog route has 180/100 base lesson PP and 120/40 native star before unknown score bonuses',()=>{
  const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});
  const route=buildHifRoute(catalog,'dance');
  const ledger=buildProduceResourceLedger({catalog,options:{scenario:'hif',route}});
  const lessons=ledger.stages.map(stage=>stage.activityRows.filter(row=>row.activity==='lesson_end'));
  assert.deepEqual(lessons.map(rows=>rows.length),[6,2]);
  assert.deepEqual(lessons.map(rows=>rows.reduce((sum,row)=>sum+row.ppIncome,0)),[180,100]);
  assert.deepEqual(ledger.stages.map(stage=>stage.star.lessonBaseIncome),[120,40]);
  assert.ok(ledger.sources.some(source=>source.kind==='official_rules'));
  assert.ok(ledger.stages.every(stage=>stage.pp.incomeRange.max===null&&stage.star.total===null));
});

test('only confirmed item acquisition and action timing adds fixed resources to its matching stage',()=>{
  const input=fixture();
  input.result.supports=[{gameId:'item-support',level:25,plan:'free',p_item:{name:'確認アイテム',effect:{trigger:{key:'activity_supply_gift_selection'},body:[{key:'pp_gain',value:20}],limit:{key:'per_produce',count:2}}}}];
  const ledger=buildProduceResourceLedger({...input,options:{supportItemAcquisitions:{'item-support':{confirmed:true,beforeProduce:true}}}});
  assert.equal(ledger.supportItems[0].applied.resources.pp,40);
  assert.equal(ledger.stages[0].pp.knownIncome,130);
  assert.equal(ledger.stages[1].pp.knownIncome,150);
  assert.equal(ledger.stages[1].pp.initial,null);
});

test('missing reference or another scenario returns an explicit unsupported status',()=>{
  assert.equal(buildProduceResourceLedger().status,'unavailable');
  const input=fixture();assert.equal(buildProduceResourceLedger({...input,options:{scenario:'nia'}}).status,'unsupported_scenario');
});
