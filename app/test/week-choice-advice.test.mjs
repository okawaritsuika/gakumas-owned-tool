import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildWeekChoiceAdvice } from '../lib/week-choice-advice.mjs';
import { evaluateSupportItemValue } from '../lib/support-item-value.mjs';

const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});
function fixture(){
  const preferredActions=[{action:'remove',targetRefs:[{gameId:'basic',nameKo:'기본 카드'}],reason:'현재 남은 불필요 카드 삭제',sourceIds:['official-produce-shop']},
    {action:'upgrade',targetRefs:[{gameId:'carry',nameKo:'현재 주력'}],reason:'실제 합류한 미강화 주력 보완',sourceIds:['official-produce-shop']},
    {action:'acquire',targetRefs:[{gameId:'target',nameKo:'확보 후보'}],reason:'현재 제시된 목표 카드 획득',sourceIds:['official-produce-shop']}];
  return {catalog,book:{context:{scenario:'hif',plan:'anomaly',trainingType:'fullPower'},weekPlan:[
    {week:1,activity:'consult',consultation:{preferredActions}},{week:5,activity:'consult',consultation:{preferredActions}},
    {week:8,activity:'supply_gift'},{week:12,activity:'consult',consultation:{preferredActions}},
  ]},result:{scoreSummary:{scenario:'hif',plan:'anomaly',trainingType:'fullPower',difficulty:'none',hifModel:{selections:[{week:1,activity:'consult'},{week:5,activity:'consult'}]}}}};
}

test('only schedule-available activities are compared and an empty live state stays unknown',()=>{
  const result=buildWeekChoiceAdvice({...fixture(),week:1});
  assert.deepEqual(result.activities.map(row=>row.activity),['consult','supply_gift','special_training']);
  assert.equal(result.liveResources.pp,null);
  assert.equal(result.liveResources.stamina,null);
  assert.deepEqual(result.recommendations,[]);
  assert.equal(result.optimizedActivityChoice,false);
  assert.equal(result.sourceScoreWeightsApplied,false);
  assert.equal(result.plannedActivity,'consult');
  assert.ok(result.activities.every(row=>row.availableInSchedule));
});

test('PP zero keeps the free consult visit but separates unaffordable actions and the gift branch',()=>{
  const result=buildWeekChoiceAdvice({...fixture(),week:1,liveState:{pp:0,stamina:20,currentMaxStamina:30,
    consultationOffers:[{action:'upgrade',gameId:'carry',price:100,available:true}]}});
  const consult=result.activities.find(row=>row.activity==='consult'),gift=result.activities.find(row=>row.activity==='supply_gift');
  assert.equal(consult.canVisit,true);
  assert.equal(consult.choices.find(row=>row.action==='upgrade').canChoose,false);
  assert.equal(gift.choices[0].rewards.pp,80);
  assert.equal(result.recommendations[0].activity,'supply_gift');
  assert.ok(result.recommendations[0].sourceIds.length);
});

test('a selected support item names an actual trigger only on its matching choice date',()=>{
  const input=fixture();
  input.book.weekPlan[0].alternatives=[{activity:'supply_gift'}];
  const trigger={week:1,action:'consult',triggerConfirmed:true,acquisitionOrderConfirmed:true,conditionConfirmed:true};
  const value={acquisitionConfirmed:true,applied:{activations:[trigger]}};
  input.result.supports=[{name:'편성 서포트',supportItemValue:value,p_item:{effect:{body:[{key:'param_up',param:'dance',value:10}]}}}];
  assert.match(buildWeekChoiceAdvice({...input,week:1}).day.supportChoice,/편성 서포트.*댄스 \+10/);
  assert.equal(buildWeekChoiceAdvice({...input,week:5}).day.supportChoice,'');
  value.acquisitionConfirmed=false;
  assert.equal(buildWeekChoiceAdvice({...input,week:1}).day.supportChoice,'');
});

test('outing exposes paid, trouble and free choices and clips nominal recovery at maximum HP',()=>{
  const result=buildWeekChoiceAdvice({...fixture(),week:5,liveState:{pp:0,stamina:27,maxStamina:30}});
  const choices=result.activities.find(row=>row.activity==='outing').choices;
  assert.equal(choices.length,3);
  assert.equal(choices.find(row=>row.id==='pp50').canChoose,false);
  assert.equal(choices.find(row=>row.id==='free').canChoose,true);
  assert.equal(choices.find(row=>row.id==='trouble').costs.troubleCards,1);
  assert.equal(choices[0].rewards.nominalStaminaRecovery,18);
  assert.equal(choices[0].rewards.staminaRecovery,3);
  assert.equal(choices.find(row=>row.id==='free').rewards.upgradedCards,0);
});

test('class choices retain the exact stage/plan/axis and HP-versus-trouble costs',()=>{
  const result=buildWeekChoiceAdvice({...fixture(),week:3,liveState:{stamina:4}});
  const row=result.activities.find(row=>row.activity==='class_vo');
  assert.equal(row.choices.length,3);
  assert.ok(row.choices.every(choice=>choice.eventId.includes('vocal')&&choice.eventId.includes('plan3')&&choice.eventId.includes('before_1st')));
  assert.equal(row.choices.filter(choice=>choice.costs.stamina===5).length,2);
  assert.ok(row.choices.filter(choice=>choice.costs.stamina===5).every(choice=>choice.canChoose===false));
  const trouble=row.choices.find(choice=>choice.costs.troubleCards===1);
  assert.equal(trouble.canChoose,true);
  assert.equal(trouble.rewards.selectChangeOpportunities,1);
  assert.equal(trouble.rewards.cardAcquisitionOpportunities,0);
  assert.equal(trouble.rewards.parameterGains.vocal,120);
});

test('actual SP availability and native costs prevent treating every planned lesson as SP success',()=>{
  const result=buildWeekChoiceAdvice({...fixture(),week:2,liveState:{stamina:7,spLessonAttributes:['dance']}});
  const dance=result.activities.find(row=>row.activity==='da_lesson_vi'),vocal=result.activities.find(row=>row.activity==='vo_lesson_vi');
  assert.equal(dance.choices.find(row=>row.isSp).costs.stamina,8);
  assert.equal(dance.choices.find(row=>row.isSp).canChoose,false);
  assert.equal(dance.choices.find(row=>!row.isSp).offered,false);
  assert.equal(dance.canChoose,false);
  assert.equal(vocal.choices.find(row=>!row.isSp).canChoose,true);
});

test('consultation uses this week targets and displayed prices; acquisition does not remove a card',()=>{
  const input=fixture(),liveState={pp:100,consultationOffers:[{action:'upgrade',gameId:'carry',price:100,available:true},{action:'acquire',gameId:'target',price:101,available:true}]};
  const result=buildWeekChoiceAdvice({...input,week:12,liveState}),choices=result.activities.find(row=>row.activity==='consult').choices;
  assert.equal(choices.find(row=>row.action==='upgrade').canChoose,true);
  assert.equal(choices.find(row=>row.action==='acquire').canChoose,false);
  assert.equal(choices.find(row=>row.action==='acquire').removesExistingCard,false);
  assert.deepEqual(choices.find(row=>row.action==='upgrade').targetRefs.map(row=>row.gameId),['carry']);
  assert.equal(choices.find(row=>row.action==='remove').costs.pp,null);
});

test('consultation item effects use explicit trigger metadata independently of translated display conditions',()=>{
  const item=key=>evaluateSupportItemValue({card:{gameId:key,plan:'free',p_item:{name:key,
    effect:{trigger:{key},body:[{key:'pp_gain',value:5}]}}},plan:'anomaly',level:1,
    route:{selections:[{week:1,activity:'consult'}]}});
  const consultItem=item('consult_selection'),otherItem=item('outing_end');
  assert.equal(consultItem.conditions[0],'발동: 상담 선택 시');
  assert.equal(consultItem.applied.resources.pp,0);
  assert.deepEqual(consultItem.potentialRanges.resources.pp,[0,5]);
  // Display text containing an old raw key cannot grant a different trigger.
  otherItem.conditions=['consult_selection'];
  const result=buildWeekChoiceAdvice({...fixture(),week:1,resourceLedger:{supportItems:[consultItem,otherItem]}});
  const effects=result.activities.find(row=>row.activity==='consult').consultation.potentialItemEffects;
  assert.deepEqual(effects.map(row=>row.supportGameId),['consult_selection']);
  assert.equal(effects[0].triggerKey,'consult_selection');
});

test('a modeled ledger balance never becomes the current PP or HP balance',()=>{
  const result=buildWeekChoiceAdvice({...fixture(),week:5,resourceLedger:{stages:[{stage:'selection',pp:{balance:99999,knownIncome:99999},stamina:{actualRemaining:99}}]}});
  assert.equal(result.liveResources.pp,null);
  assert.equal(result.liveResources.stamina,null);
  assert.equal(result.activities.find(row=>row.activity==='outing').choices.find(row=>row.id==='pp50').canChoose,null);
  assert.equal(result.recommendations.length,0);
});

test('the author 21-HP branch is conditional on its route and changes at the exact boundary',()=>{
  const run=stamina=>buildWeekChoiceAdvice({...fixture(),week:8,liveState:{stamina,currentMaxStamina:30}});
  assert.equal(run(20).recommendations[0].activity,'outing');
  assert.equal(run(21).recommendations[0].activity,'supply_gift');
  assert.ok(run(20).recommendations[0].conditions.some(text=>text.includes('SP8')));
  assert.ok(run(20).recommendations[0].sourceIds.includes('morishi-43'));
});

test('zero partial stats are preserved without inventing attribute-mark thresholds or score weights',()=>{
  const input=fixture(),statTargets={stages:[{examIndex:0,axes:{vocal:{value:0,valueSource:'direct_input',rawCriterion:100,rawCriterionGap:100}}}]};
  const result=buildWeekChoiceAdvice({...input,week:3,liveState:{pp:'100',stamina:false,stats:{vocal:0}},statTargets});
  assert.equal(result.liveResources.pp,null);assert.equal(result.liveResources.stamina,null);
  assert.equal(result.statNeeds[0].value,0);assert.equal(result.statNeeds[0].rawCriterionGap,100);
  assert.equal(result.statNeeds[0].valueSource,'direct_input');
  assert.equal(result.sourceScoreWeightsApplied,false);
});

test('missing weeks and other scenarios are not populated with substitute HIF choices',()=>{
  assert.equal(buildWeekChoiceAdvice({...fixture(),week:30}).status,'missing_schedule');
  const input=fixture();input.book.context.scenario='nia';
  const result=buildWeekChoiceAdvice({...input,week:1});
  assert.equal(result.status,'unsupported_scenario');assert.deepEqual(result.activities,[]);
});

test('constructing advice never mutates the route, book, live state or resource source data',()=>{
  const input={...fixture(),week:5,liveState:{pp:20,stamina:10,currentMaxStamina:30}};
  const before=JSON.stringify(input);
  buildWeekChoiceAdvice(input);
  assert.equal(JSON.stringify(input),before);
});
