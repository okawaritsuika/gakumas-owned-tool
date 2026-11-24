import test from 'node:test';
import assert from 'node:assert/strict';
import { buildItemConsideration } from '../lib/item-consideration.mjs';

const zero=()=>({vocal:0,dance:0,visual:0});
function fixture(){
  const applied={stats:zero(),resources:{pp:0,hpRecovery:0,pDrinkAcquisitions:0},activationCount:0};
  const potential={...applied,stats:{...zero(),visual:25},resources:{...applied.resources,hpRecovery:2}};
  return {result:{selectedIdol:{gameId:'idol',uniqueIds:{beforeProduceItemId:'unique-item'}},
    supports:{owned:[{gameId:'support',name:'보유 카드',level:40,p_item:{name:'지원 아이템'}}]},
    resourceLedger:{supportItems:[{supportGameId:'support',itemName:'지원 아이템',status:'unconfirmed_acquisition',applied,
      potential:{unknown:{max:potential},early:potential,late:applied},potentialRanges:{stats:{visual:[0,25]}},conditions:['조건'],unscored:['획득 시점 미확인']}],
      stages:[{stage:'selection',star:{potentialDeclaredCardBaseIncome:{min:0,max:20},declaredCardBaseIncome:null,total:null}}]}},
    catalog:{pItems:[{gameId:'badge',nameJa:'H.I.Fワッペン'}],produceResources:{hif:{star:{cardAcquisitionBase:10,cardAcquisitionCap:20,sourceIds:['badge-source']}}}},options:{}};
}

test('separates four item categories and preserves unknown support acquisition without adding potential to the forecast',()=>{
  const input=fixture(),before=structuredClone(input),value=buildItemConsideration(input);
  assert.deepEqual(Object.keys(value.categories),['support','scenario','unique','event']);
  assert.equal(value.categories.support.actualCoverage,'conditional_only');
  assert.equal(value.categories.support.items[0].included.stats.visual,0);
  assert.deepEqual(value.categories.support.items[0].conditional.ranges.stats.visual,[0,25]);
  assert.equal(value.forecastConnection.appliedStats.visual,0);assert.equal(value.additionalStatsApplied,false);
  assert.equal(value.categories.scenario.conditional[0].stages[0].actualTotalStar,null);
  assert.ok(value.categories.scenario.notIncluded.some(row=>row.id==='chosen_scenario_item'));
  assert.equal(value.categories.unique.actualCoverage,'identity_and_conditions_only');
  assert.equal(value.categories.event.actualCoverage,'not_selected');
  assert.deepEqual(input,before);
});

test('echoes only existing confirmed grants and never describes unsupported zero ranges as a proven zero-valued item',()=>{
  const input=fixture(),item=input.result.resourceLedger.supportItems[0];
  item.status='confirmed_acquisition_conditional_timeline';item.applied.stats.visual=25;item.applied.activationCount=1;
  assert.equal(buildItemConsideration(input).forecastConnection.appliedStats.visual,25);
  item.status='unsupported';item.applied.stats.visual=0;item.potentialRanges={stats:{visual:[0,0]}};
  const unsupported=buildItemConsideration(input).categories.support.items[0];
  assert.equal(unsupported.actualCoverage,'not_included');assert.equal(unsupported.conditional,null);
});

test('verified event item effect references remain separate from actual round identity and numeric forecast',()=>{
  const input=fixture();input.options.eventModeId='asari';
  input.result.eventContext={itemEffects:{nameJa:'ゼミパーカー',nativeEffectChainVerified:true,actualRoundNativeItemLinkVerified:false,
    includedInStatForecast:false,effectRole:{perActivationPermil:100,maxActivations:5,scope:'exam_only'}}};
  const event=buildItemConsideration(input).categories.event;
  assert.equal(event.actualCoverage,'identity_and_conditions_only');assert.deepEqual(event.included,[]);
  assert.equal(event.conditional[0].actualRoundNativeItemLinkVerified,false);
  assert.equal(event.conditional[0].includedInStatForecast,false);
  assert.equal(event.unlockExceptionIsItemBonus,false);
});

test('another scenario never receives the HIF badge rule and manually supplied stats are identified separately',()=>{
  const input=fixture();input.options.scenario='nia';input.options.finalStats={vocal:0};
  const result=buildItemConsideration(input);
  assert.equal(result.categories.scenario.actualCoverage,'unavailable');
  assert.deepEqual(result.categories.scenario.conditional,[]);
  assert.equal(result.forecastConnection.basis,'manual_final_stats_not_item_model');
});
