import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveIdolRecipePolicy,idolRecipeContext} from '../lib/idol-recipe-policy.mjs';

function fixture(){return{
  catalog:{idolCards:[{gameId:'exact',nameJa:'[空と約束] 倉本 千奈',characterId:'kcna',plan:'sense'},{gameId:'other',nameJa:'[別衣装] 倉本 千奈',characterId:'kcna',plan:'sense'}],
    skillCards:[{gameId:'attack',upgradeCount:0,plan:'sense'},{gameId:'spot',upgradeCount:0,plan:'sense'}],
    idolRecipePolicies:{sources:[{id:'primary'}],policies:[{id:'exact-policy',evidenceStatus:'source_verified',idolIdentities:[{gameId:'exact',characterId:'kcna',titleJa:'空と約束'}],
      scenario:'hif',plan:'sense',trainingTypes:['goodConditionTurns'],eventScope:'ordinary_hif',sourceIds:['primary'],summary:'高調固有',
      roleChanges:{deprioritizeSkillIds:['attack']},selectionRules:[{gameId:'spot',action:'avoid',reason:'資源相性',sourceIds:['primary']}],operatingNotes:['原文条件']}]}},
  baseProfile:{id:'generic',labelKo:'유형 공통',carryRoles:[{gameId:'attack'},{gameId:'spot'}],conditions:['기존 조건'],sourceIds:['old']},
  context:{idolGameId:'exact',plan:'sense',trainingType:'goodConditionTurns',scenario:'hif',producerLevel:70,specialTrainingRank:3,potentialRank:1}
};}
test('an exact P-card source lowers an optional role and adds only qualitative conflict evidence',()=>{
  const input=fixture(),before=structuredClone(input),resolved=resolveIdolRecipePolicy(input);
  assert.deepEqual(resolved.profile.carryRoles.map(row=>row.gameId),['spot']);
  assert.deepEqual(resolved.profile.optionalCarryRoles.map(row=>row.gameId),['attack']);
  assert.equal(resolved.selectionRules[0].applies,true);assert.equal(resolved.evidence.usedForSelection,true);
  assert.deepEqual(input,before);
});
test('the same character in a different P-card and a different scenario cannot inherit a recipe',()=>{
  const input=fixture();input.context.idolGameId='other';assert.equal(resolveIdolRecipePolicy(input).profile,input.baseProfile);
  input.context.idolGameId='exact';input.context.scenario='nia';assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
  input.context.scenario='hif';input.context.eventModeId='asari';assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
});
test('unknown or unmet PLv and awakening requirements do not become fulfilled',()=>{
  const input=fixture();input.catalog.idolRecipePolicies.policies[0].requirements={minProducerLevel:75,minPotentialRank:2};
  input.context.producerLevel=null;assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
  input.context.producerLevel=80;assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
  input.context.potentialRank=2;assert.equal(resolveIdolRecipePolicy(input).evidence.applied,true);
  input.catalog.idolRecipePolicies.policies[0].selectionRules[0].requirements={minSpecialTrainingRank:6};
  assert.equal(resolveIdolRecipePolicy(input).selectionRules[0].applies,false);
});

test('low-unlock alternatives stop above their review range and topic recipes require explicit switch and recipe choices',()=>{
  const input=fixture(),policy=input.catalog.idolRecipePolicies.policies[0];
  policy.requirements={maxProducerLevel:75};
  input.context.producerLevel=75;assert.equal(resolveIdolRecipePolicy(input).evidence.applied,true);
  input.context.producerLevel=76;assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
  input.context.producerLevel=null;assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
  policy.requirements={minProducerLevel:78,requiredSwitchGameIds:['topic'],selectedRecipeId:'topic-loop'};
  input.context.producerLevel=80;
  assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
  input.context.skillCardSwitchSettings={topic:true};
  assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
  input.context.selectedRecipeId='topic-loop';assert.equal(resolveIdolRecipePolicy(input).evidence.applied,true);
  input.context.skillCardSwitchSettings.topic=false;assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
});

test('ordinary NIA references stay in NIA and a replaced source role is not suppressed after re-adding it',()=>{
  const input=fixture(),policy=input.catalog.idolRecipePolicies.policies[0];
  policy.scenario='nia';policy.eventScope='ordinary_produce';input.context.scenario='nia';
  policy.roleChanges={suppressGenericRoles:true,addRoles:[{gameId:'attack'}]};
  let resolved=resolveIdolRecipePolicy(input);
  assert.equal(resolved.evidence.applied,true);assert.deepEqual(resolved.evidence.suppressedGenericCarryRoleIds,['spot']);
  input.context.scenario='hif';assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
  input.context.scenario='nia';input.context.eventModeId='event';assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
});
test('unverified source or native identity cannot change selection',()=>{
  const input=fixture();input.catalog.idolRecipePolicies.policies[0].sourceIds=['not-loaded'];assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
  input.catalog.idolRecipePolicies.policies[0].sourceIds=['primary'];input.catalog.idolCards[0].characterId='wrong';assert.equal(resolveIdolRecipePolicy(input).evidence.applied,false);
});
test('a known exceptional character without a proven replacement stops certifying the generic four',()=>{
  const input=fixture();input.catalog.idolRecipePolicies.policies[0].roleChanges={suppressGenericRoles:true};
  const result=resolveIdolRecipePolicy(input);assert.deepEqual(result.profile.carryRoles,[]);
  assert.equal(result.profile.characterPolicy.exactReplacementRecipeConfirmed,false);
  assert.deepEqual(result.profile.originalCarryRoleGameIds,['attack','spot']);
});

test('source evidence bound to a native unique card cannot survive swapping its mechanics identity',()=>{
  const input=fixture();input.catalog.idolRecipePolicies.policies[0].idolIdentities[0].expectedUniqueIds={produceCardId:'native-unique'};
  input.catalog.idolCards[0].uniqueIds={produceCardId:'native-unique'};assert.equal(resolveIdolRecipePolicy(input).evidence.applied,true);
  input.catalog.idolCards[0].uniqueIds.produceCardId='a-different-unique';
  const result=resolveIdolRecipePolicy(input);assert.equal(result.evidence.applied,false);
  assert.equal(result.evidence.observations[0].reason,'native_unique_identity_mismatch');
});

test('current policy context uses owned stages and rejects out-of-table stage values',()=>{
  const input=fixture();input.catalog.idolCards[0].specialTrainingStages=[{rank:1},{rank:2},{rank:3}];
  input.catalog.idolCards[0].awakeningStages=[{rank:1},{rank:2}];
  const inventory={idolCards:[{gameId:'exact',levelLimitRank:2,potentialRank:1}]};
  const context=idolRecipeContext({catalog:input.catalog,inventory,options:{idolGameId:'exact',producerLevel:70,specialTrainingRank:99,potentialRank:99}});
  assert.equal(context.specialTrainingRank,2);assert.equal(context.potentialRank,1);
  inventory.idolCards[0].potentialRank=99;
  assert.equal(idolRecipeContext({catalog:input.catalog,inventory,options:{idolGameId:'exact'}}).potentialRank,null);
});
