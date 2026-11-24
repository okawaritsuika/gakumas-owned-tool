import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../lib/catalog.mjs';
import { recommend } from '../lib/recommend.mjs';
import { assessHifEffect,buildHifAbilityTargetContext,fulfilledHifEffectIds,selectHifAbilityCopies } from '../lib/hif-ability-guidance.mjs';

const effect={effectId:'effect',abilityId:'ability',abilityLevel:1,applies:true,trigger:{phase:'StartAudition'},
  actions:[{kind:'skill_use_count_add',type:'ExamPlayableValueAdd',value:1,activationLimits:[{count:1}],conditions:[
    {known:true,phaseTypes:['ProduceExamPhaseType_ExamTurnTimer'],phaseValues:[1]},
    {known:true,phaseTypes:['ProduceExamPhaseType_ExamCardPlayAfter'],search:{id:'search',known:true,produceCardIds:['target'],upgradeCounts:[]}}]}]};
const memory=(id,hif=true,customizes=[])=>({id,modelEffects:{carriedSkill:{id:'carry',name:'반입 카드',upgrade:1,variantKnown:true,obtainable:true,
  phase:{code:2,availableAtStart:false},customizes},hifEffects:hif?[effect]:[]}});
function fixture(){
  return {catalog:{skillCards:[{gameId:'target',upgradeCount:0,plan:'anomaly',unlockProducerLevel:80},{gameId:'target',upgradeCount:1,plan:'anomaly'}],
    hifAbilityGuidance:{profiles:[{id:'profile',plan:'anomaly',trainingType:'fullPower',goals:[{id:'goal',triggerCard:{gameId:'target'},abilities:[{abilityId:'ability',level:1}]}]}]}},
    options:{scenario:'hif',plan:'anomaly',trainingType:'fullPower',producerLevel:70},inventory:{}};
}

test('a phase-two carrier can register the ability immediately when a different target is in the opening deck',()=>{
  const input=fixture(),carrier=memory('carrier');
  const context=buildHifAbilityTargetContext({...input,memories:[carrier]});
  context.targets.push({gameId:'target',upgradeCount:1,availability:'at_start',source:'owned_idol_unique'});
  const check=assessHifEffect(effect,context);
  assert.equal(check.targetAvailability,'at_start');assert.equal(check.targetRequirementSatisfied,true);
  assert.equal(check.registrationTiming.independentOfCarriedSkillPhase,true);assert.equal(check.activationConfirmed,false);
  assert.deepEqual(fulfilledHifEffectIds([carrier],context),['effect']);
  context.targets[1]={gameId:'target',upgradeCount:0,availability:'after_selection_1',source:'selected_memory'};
  assert.equal(assessHifEffect(effect,context).targetAvailability,'after_selection_1');
});

test('an unlocked during-run candidate is conditional and does not fulfill a mandatory target',()=>{
  const input=fixture(),carrier=memory('carrier');
  let context=buildHifAbilityTargetContext({...input,memories:[carrier]});
  assert.equal(assessHifEffect(effect,context).targetAvailability,'missing');
  input.catalog.skillCards[0].unlockProducerLevel=40;
  context=buildHifAbilityTargetContext({...input,memories:[carrier]});
  assert.equal(assessHifEffect(effect,context).targetAvailability,'conditional_during');
  assert.deepEqual(fulfilledHifEffectIds([carrier],context),[]);
});

test('source HIF effects compare only exact carried recipes and do not add an arbitrary numeric bonus',()=>{
  const input=fixture();input.catalog.skillCards[0].unlockProducerLevel=40;
  const selected=memory('selected',false),same=memory('same',true),different=memory('different',true,[{id:'custom',customizeCount:1,exactCountKnown:true}]);
  const result=selectHifAbilityCopies({...input,selected:[selected],candidates:[selected,same,different]});
  assert.equal(result.memories[0].id,'same');assert.equal(result.changes[0].numericAbilityWeightApplied,false);
  const incompatible=selectHifAbilityCopies({...input,selected:[selected],candidates:[selected,different]});
  assert.equal(incompatible.memories[0].id,'selected');
  input.catalog.skillCards[0].unlockProducerLevel=80;
  assert.equal(selectHifAbilityCopies({...input,selected:[selected],candidates:[selected,same]}).memories[0].id,'selected');
});

test('an explicit HIF effect remains pending without its real target and preserves carried guide roles',()=>{
  const catalog=loadCatalog(),ability='memory_ability-p_memory_skill-common-hatsuboshi_idol_festival-p_trigger-start_audition-for_hif_memory-exam_status_enchant-exam_turn_timer-exam_status_enchant-01-104-001';
  const nativeEffect=catalog.memoryAbilities.find(row=>row.gameId===ability&&row.level===1).branches[0].produceEffectId;
  const fullSoul=catalog.skillCards.find(card=>card.nameJa==='全身全霊'&&card.upgradeCount===0);
  const inventory={producerLevel:70,memories:[
    {id:'hif-carrier',produceCard:{id:'p_card-03-men-2_064',upgradeCount:1,customizes:[]},produceCardPhaseType:2,abilities:[{id:ability,level:1}]},
    {id:'guide-carry',produceCard:{id:fullSoul.gameId,upgradeCount:0,customizes:[]},produceCardPhaseType:2,abilities:[]}]};
  const result=recommend({catalog,inventory,options:{scenario:'hif',plan:'anomaly',trainingType:'fullPower',targetAttribute:'dance',secondaryAttribute:'visual',
    activityFocus:'consult',requiredHifEffectIds:[nativeEffect]}});
  assert.ok(result.memories.some(row=>row.id==='hif-carrier'));assert.ok(result.memories.some(row=>row.id==='guide-carry'));
  assert.ok(result.scoreSummary.hifModel.memoryRequirements.missing.includes('hif:'+nativeEffect));
  assert.ok(!result.scoreSummary.hifModel.memoryRequirements.fulfilled.includes('hif:'+nativeEffect));
  assert.equal(result.scoreSummary.hifModel.guideMemoryProfile.applicationMode,'guide_roles_prioritized');
});
