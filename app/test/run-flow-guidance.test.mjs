import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';
import {buildEventUnlockOverrides} from '../lib/event-context.mjs';
import {buildRunFlowGuidance} from '../lib/run-flow-guidance.mjs';
import {buildHifAbilityGuidance} from '../lib/hif-ability-guidance.mjs';
import {prepareProduceFlowGuidance} from '../../work/prepare_produce_flow_guidance.mjs';
const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});
catalog.produceFlowGuidance=JSON.parse(fs.readFileSync(new URL('../data/catalog/produce_flow_guidance.json',import.meta.url),'utf8'));
function fixture(){
  const idol=catalog.idolCards.find(card=>card.gameId==='i_card-kllj-3-015');
  const options={scenario:'hif',plan:'anomaly',trainingType:'fullPower',producerLevel:70,eventModeId:'asari_2026_10_30'};
  options.eventUnlockOverrides=buildEventUnlockOverrides({catalog,options,context:options});
  return{catalog,inventory:{producerLevel:70},options,result:{selectedIdol:{...idol,ownershipVerified:true,owned:{uncap:3}},
    scoreSummary:{scenario:'hif',plan:'anomaly',trainingType:'fullPower',projectedStats:{vocal:1550,dance:2936,visual:1235}},
    memories:[{id:'late',modelEffects:{carriedSkill:{id:'p_card-03-men-2_076',upgrade:1,obtainable:true,phase:{code:2,availableAtStart:false}},hifEffects:[]}}]}};
}

test('September anomaly and October logic remain separate and the current-round method reference does not certify every condition',()=>{
  const input=fixture(),value=buildRunFlowGuidance(input);
  assert.equal(value.sourceProfiles.length,1);assert.equal(value.sourceProfiles[0].sourceEventMonth,'2026-09');
  assert.equal(value.sourceProfiles[0].currentRoundExactRecipeVerified,false);
  assert.equal(value.sourceProfiles[0].fullRecipeValidatedForCurrentIdol,false);
  assert.ok(value.notApplicableProfiles.some(profile=>profile.id.includes('motivation')));
  assert.ok(value.notApplicableProfiles.some(profile=>profile.id.includes('impression')));
  const opening=value.stages.find(stage=>stage.id==='opening').steps.find(step=>step.id==='actual-opening-cards');
  assert.ok(!opening.cardRefs.some(card=>card.gameId==='p_card-03-men-2_076'));
  const sleep=value.stages.find(stage=>stage.id==='main_turn').steps.find(step=>step.id==='sleep-four');
  assert.equal(sleep.status,'needs_hif_memory');
  assert.equal(sleep.cardRefs.find(card=>card.gameId==='p_card-03-men-2_076').availability,'after_selection_1');
  assert.ok(sleep.sourceRefs.some(source=>source.url.includes('t=141s')));
  assert.equal(value.battleSimulationRun,false);assert.equal(value.readinessConfirmed,false);
});

test('source safety preparation uses actual native exam order and never labels a verified circle boundary',()=>{
  const value=buildRunFlowGuidance(fixture()),prep=value.parameterPreparation;
  assert.deepEqual(prep.targets.map(row=>[row.axis,row.target]),[['visual',2000],['dance',1400],['vocal',1100]]);
  assert.equal(prep.targets[0].remaining,765);assert.equal(prep.exactMarkBoundaryVerified,false);
  assert.equal(prep.stage,'final');assert.equal(prep.doubleCircleClaimed,false);
  assert.equal(prep.usedAsAutomaticScoreWeight,false);
  assert.ok(prep.sourceRefs[0].url.endsWith('&t=544s'));
});

test('normal HIF does not silently execute a historical Asari recipe and another plan receives only its own source rules',()=>{
  const input=fixture();input.options={...input.options,eventModeId:null,eventUnlockOverrides:null};
  const normal=buildRunFlowGuidance(input);
  assert.equal(normal.sourceProfiles.length,1);assert.equal(normal.referenceProfiles.length,1);
  assert.equal(normal.sourceProfiles[0].sourceCompleteLoopProducerLevel,80);
  assert.equal(normal.sourceProfiles[0].sourceLoopLevelMet,false);
  assert.equal(normal.sourceProfiles[0].sourceLoopAssumptionIsUniversalUnlockGate,false);
  const logic=buildRunFlowGuidance({...input,options:{...input.options,eventModeId:'asari_logic_historical'},result:{
    scoreSummary:{scenario:'hif',plan:'logic',trainingType:'motivation'},memories:[]}});
  assert.equal(logic.sourceProfiles.length,1);assert.ok(logic.sourceProfiles[0].id.includes('motivation'));
  assert.ok(logic.stages.some(stage=>stage.steps.some(step=>step.id==='motivation-opening')));
  assert.ok(!logic.stages.some(stage=>stage.steps.some(step=>step.id==='sleep-four')));
});

test('a carrier in the opening deck cannot hide an inapplicable HIF effect or its missing trigger card',()=>{
  const stop='p_card-02-men-2_056',reset='p_card-00-men-3_005';
  const data={produceFlowGuidance:catalog.produceFlowGuidance,skillCards:[
    {gameId:stop,upgradeCount:0,plan:'logic',unlockProducerLevel:99},
    {gameId:reset,upgradeCount:0,plan:'free',unlockProducerLevel:0}],eventModes:{modes:[]},memoryEffectDetails:{tables:{}}};
  const result={scoreSummary:{scenario:'hif',plan:'logic',trainingType:'motivation'},memories:[{id:'carrier',modelEffects:{
    carriedSkill:{id:reset,obtainable:true,phase:{availableAtStart:true}}}}],hifAbilityGuidance:{selectedMemories:[{hifEffects:[{
      effectId:'effect',applies:false,targetAvailability:'inapplicable',triggerCards:[{gameId:stop}],targetRequirementSatisfied:false}]}]}};
  const run=()=>buildRunFlowGuidance({catalog:data,result,options:{eventModeId:'asari_fixture',producerLevel:1},inventory:{producerLevel:1}})
    .stages.flatMap(stage=>stage.steps).find(step=>step.id==='logic-hif-common');
  assert.equal(run().status,'needs_hif_memory');
  const effect=result.hifAbilityGuidance.selectedMemories[0].hifEffects[0];
  effect.applies=true;effect.targetAvailability='conditional_during';
  let step=run();assert.equal(step.status,'needs_trigger_acquisition');
  assert.deepEqual(step.hifRequirements.map(row=>row.gameId),[stop]);
  assert.equal(step.hifRequirements[0].targetPresent,false);
  effect.targetAvailability='at_start';effect.targetRequirementSatisfied=true;
  assert.equal(run().status,'needs_trigger_acquisition');
  result.memories.push({id:'trigger',modelEffects:{carriedSkill:{id:stop,obtainable:true,phase:{availableAtStart:true}}}});
  step=run();assert.equal(step.status,'condition_check_required');assert.equal(step.hifRequirements[0].readyForUseConditionCheck,true);
});

test('mode-specific HIF preferences preserve source ranks, native mappings and draw-before-removal warnings',()=>{
  const input=fixture(),value=buildHifAbilityGuidance(input);
  assert.equal(value.evidenceScope.sourceEventMonth,'2026-09');
  const primary=value.recommendations.filter(goal=>goal.recommendation.priority==='primary');
  assert.deepEqual(primary.map(goal=>goal.triggerCard.nameJa),['モチベ','タフネス','盛り上げ上手','セッティング']);
  assert.ok(value.recommendations.some(goal=>goal.recommendation.priority==='situational'&&goal.triggerCard.nameJa==='忍耐力'));
  assert.equal(value.sourceCautions.length,2);
  assert.ok(!value.craftingGoals.some(goal=>value.sourceCautions.some(caution=>caution.goalId===goal.goalId)));
  assert.ok(primary.every(goal=>goal.abilities.every(ability=>ability.effects.some(effect=>effect.kind==='remove_cards'))));
  const normal=buildHifAbilityGuidance({...input,options:{...input.options,eventModeId:null}});
  assert.equal(normal.evidenceScope.profileId,'anomaly_full_power');assert.equal(normal.recommendations.length,2);
});

test('flow data regenerates exactly and all video rule names have exact native identities',()=>{
  const data=prepareProduceFlowGuidance(catalog);
  assert.deepEqual(data,catalog.produceFlowGuidance);
  for(const profile of data.profiles)for(const stage of profile.stages)for(const step of stage.steps)for(const card of step.cardRefs)
    assert.ok(catalog.skillCards.some(row=>row.gameId===card.gameId&&row.nameJa===card.nameJa));
  assert.equal(data.coverage.all411VideoContentsReviewed,false);
  assert.equal(data.researchCoverage.transcriptsRetrieved,14);
  assert.equal(data.reviewedSourceRules.length,38);
});
