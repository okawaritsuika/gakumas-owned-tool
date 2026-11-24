import test from 'node:test';
import assert from 'node:assert/strict';
import { projectHifStageStats,projectHifStamina } from '../lib/hif-stage-projection.mjs';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildHifRoute } from '../lib/hif-model.mjs';
import { applyPeakExamDeckCounts } from '../lib/hif-support-actions.mjs';

test('early selection forecasts release successive support stories without borrowing later stat events',()=>{
  const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog/',import.meta.url))});
  const options={supportPeakScenario:true,hifSelectedIdol:{gameId:'i_card-hski-1-000'}};
  const route=applyPeakExamDeckCounts(buildHifRoute(catalog,'dance',options),[],{...options,catalog});
  const teacher=catalog.supportCards.find(card=>card.gameId==='s_card-3-0099');
  const initialStats={vocal:30,dance:30,visual:30},statCaps={vocal:5000,dance:5000,visual:5000};
  const model={...route,initialStats,statCaps,supportPeakScenario:true};
  function forecast(events,examIndex){
    const result={supports:[{...teacher,level:60,events}],scoreSummary:{plan:'anomaly',hifModel:model}};
    return projectHifStageStats({result,inventory:{},catalog,options,examIndex}).stats.visual;
  }
  const withoutStat=teacher.events.map(event=>event.effect_type==='param_boost'?{...event,param_value:0}:event);
  assert.equal(forecast(teacher.events,0),forecast(withoutStat,0));
  assert.equal(forecast(teacher.events,1)-forecast(withoutStat,1),40);
});
test('first selection gets neither later lessons nor rewards for the exam it has not passed',()=>{const catalog={calculationModels:{'score/schedule':{table:{hif:{none:[{week:2,stage:'selection',activities:[]},{week:7,stage:'selection',activities:['final_exam']},{week:9,stage:'selection',activities:[]},{week:13,stage:'selection',activities:['final_exam']},{week:20,stage:'selection',activities:['mid_exam']},{week:27,stage:'final',activities:['final_exam']},{week:29,stage:'final',activities:['final_exam']}]}}},'score/hifSelectionExams':{entries:[{base:20,allocation:80},{base:80,allocation:200},{base:100,allocation:220}]}}};const result={selectedIdol:{currentGrowthRatePermil:{vo:0,da:0,vi:0}},supports:{owned:[],rental:null},scoreSummary:{plan:'anomaly',difficulty:'none',hifModel:{initialStats:{vocal:10,dance:10,visual:10},statCaps:{vocal:3000,dance:3000,visual:3000},selections:[{week:2,main:'dance',activity:'da_lesson_vo',gains:{vocal:5,dance:10,visual:0}},{week:7,activity:'final_exam'},{week:9,main:'vocal',activity:'vo_lesson_da',gains:{vocal:1000,dance:100,visual:0}}]}}};const first=projectHifStageStats({result,inventory:{},catalog,examIndex:0});assert.deepEqual(first.stats,{vocal:15,dance:20,visual:10});assert.equal(first.previousExamCount,0);const second=projectHifStageStats({result,inventory:{},catalog,examIndex:1});assert.equal(second.previousExamCount,1);assert.ok(second.stats.vocal>1000);});
test('stamina uses known training, awakening and level-unlocked max HP, never unknown ranks as zero',()=>{const result={selectedIdol:{baseStats:{stamina:28},owned:{levelLimitRank:1,potentialRank:4},specialTrainingStages:[{rank:1,staminaDeltaByExplicitEffectType:3},{rank:5,staminaDeltaByExplicitEffectType:3}],awakeningStages:[{rank:4,staminaDeltaByExplicitEffectType:3}]},supports:{owned:[{level:1,levelAbilities:[{level:1,order:1,kind:'max_hp',plan:'free',effects:[{type:'ProduceEffectType_MaxStaminaAddition',min:2,max:2}]},{level:10,order:1,kind:'max_hp',effects:[{type:'ProduceEffectType_MaxStaminaAddition',min:10,max:10}]}]}]},scoreSummary:{plan:'anomaly'}};assert.equal(projectHifStamina(result).value,36);delete result.selectedIdol.owned.potentialRank;assert.equal(projectHifStamina(result).value,null);});

test('manual rewards enter only following exams, bypass growth once, and selection overflow never returns in the final',()=>{
  const schedule=[{week:7,stage:'selection',activities:['final_exam']},{week:13,stage:'selection',activities:['final_exam']},
    {week:20,stage:'selection',activities:['mid_exam']},{week:22,stage:'final',activities:['vo_lesson_da']},
    {week:27,stage:'final',activities:['final_exam']},{week:29,stage:'final',activities:['final_exam']}];
  const catalog={calculationModels:{'score/schedule':{table:{hif:{none:schedule}}}}};
  const result={selectedIdol:{currentGrowthRatePermil:{vo:500,da:0,vi:0}},supports:{owned:[]},scoreSummary:{plan:'anomaly',difficulty:'none',hifModel:{
    initialStats:{vocal:2995,dance:0,visual:0},memoryGrowthRatePermil:{vocal:0,dance:0,visual:0},statCaps:{vocal:3200,dance:3200,visual:3200},
    selections:[{week:7,activity:'final_exam'},{week:13,activity:'final_exam'},{week:20,activity:'mid_exam'},
      {week:22,activity:'vo_lesson_da',main:'vocal',sub:'dance',gains:{vocal:100,dance:0,visual:0}}]}}};
  const options={hifExamResults:[0,1,2].map(examIndex=>({examIndex,parameterGains:{vocal:examIndex===0?100:examIndex===2?999:0,dance:0,visual:0}}))};
  const project=examIndex=>projectHifStageStats({result,inventory:{},catalog,examIndex,options});
  const first=project(0);assert.equal(first.stats.vocal,2995);assert.equal(first.previousExamCount,0);
  assert.equal(first.rewardAfterThisExam.nominalGainBeforeCap.vocal,100);
  assert.equal(first.rewardAfterThisExam.appliedGainAfterCap.vocal,5);assert.equal(first.rewardAfterThisExam.discardedStatsFromReward.vocal,95);
  const second=project(1);assert.equal(second.stats.vocal,3000);assert.equal(second.previousExamCount,1);
  assert.equal(second.previousExamRewards[0].basis,'post_bonus');
  const final=project(3);assert.equal(final.previousExamCount,3);assert.equal(final.stats.vocal,3150);
  assert.equal(final.discardedStats.vocal,1094);assert.equal(final.rewardAfterThisExam,null);
});
