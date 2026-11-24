import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMemorySelectionReview} from '../lib/memory-selection-review.mjs';

function fixture(){
  const memory=(id,skill,opening)=>({gameId:id,effects:{carriedSkill:{id:skill,upgrade:0,phase:{availableAtStart:opening}},hifEffects:[]}});
  return{result:{scoreSummary:{scenario:'hif',plan:'anomaly',trainingType:'fullPower',hifModel:{guideMemoryProfile:{considered:true,roles:[
    {gameId:'core',memoryId:'a',purpose:'주력',status:'fulfilled'},{gameId:'growth',memoryId:'b',purpose:'성장',status:'unknown',reasons:['개조 조건 미확정']} ]}}},memories:[memory('a','core',false),memory('b','growth',true),memory('c','draw',true)]},
    catalog:{skillCards:[{gameId:'core',upgradeCount:0,unlockProducerLevel:80},{gameId:'growth',upgradeCount:0,unlockProducerLevel:1},{gameId:'draw',upgradeCount:0,unlockProducerLevel:50}],
      memoryCarryReview:{cards:[{gameId:'draw',plan:'free',trainingTypes:['fullPower'],summaryKo:'선택형 보조',sourceIds:['review']}],sources:[{id:'review',url:'https://example.test/review'}]}},inventory:{producerLevel:70},options:{}};
}
test('a fourth numerical fill is not called a guide core or a proven combat optimum',()=>{
  const input=fixture(),before=structuredClone(input),review=buildMemorySelectionReview(input);
  assert.deepEqual(review.slots.map(row=>row.basis),['guide_role','tentative_guide_role','stat_fill']);
  assert.equal(review.counts.stat_fill,1);assert.equal(review.battleOptimalityProven,false);
  assert.equal(review.slots[2].duringAcquisition.eligible,true);assert.equal(review.slots[2].duringAcquisition.acquired,false);
  assert.equal(review.slots[2].duringAcquisition.firstExamAvailabilityGuaranteed,false);
  assert.equal(review.cardNotes[0].selected,true);assert.deepEqual(input,before);
});
test('requested skills and unsupported acquisition conditions remain explicit',()=>{
  const input=fixture();input.options.desiredSkillIds=['draw'];input.catalog.skillCards[2].requiresSkillCardSwitch=true;
  const review=buildMemorySelectionReview(input);assert.equal(review.slots[2].basis,'requested');
  assert.equal(review.slots[2].duringAcquisition.eligible,null);assert.equal(review.slots[0].duringAcquisition.eligible,false);
});
test('manual targets do not falsely claim the remaining guide recipe was forced',()=>{
  const input=fixture();input.result.scoreSummary.hifModel.guideMemoryProfile.considered=false;
  const review=buildMemorySelectionReview(input);assert.equal(review.guideRolesForced,false);
  assert.ok(review.slots.every(slot=>slot.basis==='stat_fill'));
});

test('known first-exam gaps remain visible without claiming the whole battle deck lacks those roles',()=>{
  const input=fixture();input.result.scoreSummary.hifModel.memoryPreparation={openingMemoryIds:['b','c'],missingRoles:['extra_action']};
  const review=buildMemorySelectionReview(input);assert.equal(review.firstExam.openingMemoryCount,2);
  assert.deepEqual(review.firstExam.missingCarryRoles,['extra_action']);assert.equal(review.firstExam.readinessConfirmed,false);
  assert.ok(review.firstExam.note.includes('반입 메모리'));assert.ok(review.firstExam.note.includes('고유 카드'));
});

test('a late join, failed guide requirement and inapplicable HIF effect do not claim to fill an opening or requested slot',()=>{
  const input=fixture();
  input.options={memorySelectionMode:'opening',requiredHifEffectIds:['hif-only']};
  input.result.scoreSummary.hifModel.guideMemoryProfile.roles[0].status='missing';
  input.result.memories[0].effects.hifEffects=[{effectId:'hif-only',applies:false}];
  input.result.memories[0].battleRoleProfile={availableAtStart:false,roles:['attack']};
  const review=buildMemorySelectionReview(input);
  assert.equal(review.slots[0].basis,'stat_fill');
  assert.equal(review.slots[0].atStart,false);
  input.result.memories[0].effects.hifEffects[0].applies=true;
  assert.equal(buildMemorySelectionReview(input).slots[0].basis,'requested');
});

test('NIA opening overview uses only verified opening copies and keeps unknown profile coverage unknown',()=>{
  const input=fixture();
  input.result.scoreSummary={scenario:'nia',plan:'anomaly',trainingType:'fullPower'};
  input.result.memories[0].battleRoleProfile={availableAtStart:false,roles:['attack']};
  input.result.memories[1].battleRoleProfile={availableAtStart:true,roles:['draw']};
  input.result.memories[2].battleRoleProfile={availableAtStart:false,roles:['extra_action']};
  const {firstExam}=buildMemorySelectionReview(input);
  assert.equal(firstExam.openingMemoryCount,1);
  assert.deepEqual(firstExam.missingCarryRoles,['attack','extra_action']);
  delete input.result.memories[1].battleRoleProfile;
  assert.equal(buildMemorySelectionReview(input).firstExam.openingMemoryCount,null);
});

test('a fully checked zero-bonus copy fills a slot, while a positive stat slot names its actual bonus',()=>{
  const input=fixture(),row=input.result.memories[2];
  row.raw={abilities:[]};
  Object.assign(row.effects,{abilityEffectsResolved:true,initialStats:{vo:0,da:0,vi:0},growthRatePermil:{vo:0,da:0,vi:0}});
  let review=buildMemorySelectionReview(input);
  assert.equal(review.slots[2].basis,'slot_fill');
  assert.equal(review.counts.slot_fill,1);
  row.effects.growthRatePermil.vi=21;
  review=buildMemorySelectionReview(input);
  assert.equal(review.slots[2].basis,'stat_fill');
  assert.match(review.slots[2].label,/비주얼 성장 \+2.1%/);
});

test('only HIF good-condition guide results expose the concentration explanation used for selection',()=>{
  const input=fixture(),model=input.result.scoreSummary.hifModel,profile=model.guideMemoryProfile;
  const decision={status:'not_selected',reason:'고유 카드로 충족해 다른 역할을 선택했습니다.'};
  profile.concentrationDecision=decision;
  input.result.scoreSummary.trainingType='goodConditionTurns';
  assert.deepEqual(buildMemorySelectionReview(input).concentrationDecision,decision);
  model.memorySelectionMode='stats';
  input.options.desiredSkillIds=['core'];
  const stats=buildMemorySelectionReview(input);
  assert.equal(stats.concentrationDecision,null);
  assert.equal(stats.selectionMode,'stats');
  assert.equal(stats.guideRolesForced,false);
  assert.ok(stats.slots.every(row=>row.basis==='stat_fill'&&!row.roleMatches.length));
  model.memorySelectionMode='guide';
  input.result.scoreSummary.trainingType='concentration';
  assert.equal(buildMemorySelectionReview(input).concentrationDecision,null);
  input.result.scoreSummary.trainingType='goodConditionTurns';
  input.result.scoreSummary.scenario='nia';
  assert.equal(buildMemorySelectionReview(input).concentrationDecision,null);
});
