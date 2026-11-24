import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';
import {idolRecipeContext} from '../lib/idol-recipe-policy.mjs';
import {findHifMemoryProfile,summarizeHifGuideProfile} from '../lib/hif-memory-profile.mjs';
import {buildPersonalizedPlan} from '../lib/personalized-plan.mjs';
import {buildAccountPlaybook} from '../lib/account-playbook.mjs';
import {buildProduceForecast} from '../lib/produce-forecast.mjs';
import {buildCustomizationReadiness} from '../lib/customization-readiness.mjs';
import {buildRunFlowGuidance} from '../lib/run-flow-guidance.mjs';
import {buildIdolOperatingGuidance} from '../lib/idol-operating-guidance.mjs';
import {buildPostProduceMemoryChoice} from '../lib/post-produce-memory-choice.mjs';
import {buildRecommendationCoverage} from '../lib/recommendation-coverage.mjs';

const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});
function inputFor(idolGameId,trainingType){
  const card=catalog.idolCards.find(row=>row.gameId===idolGameId),owned={gameId:idolGameId,levelLimitRank:3,potentialRank:1};
  const inventory={producerLevel:70,idolCards:[owned],memories:[],supportCards:[]};
  const options={scenario:'hif',idolGameId,plan:card.plan,trainingType,producerLevel:70};
  const result={selectedIdol:{...card,ownershipVerified:true,owned},memories:[],supports:[],scoreSummary:{scenario:'hif',plan:card.plan,trainingType,hifModel:{}}};
  const profile=findHifMemoryProfile(catalog,idolRecipeContext({result,catalog,inventory,options}));
  result.scoreSummary.hifModel.guideMemoryProfile=summarizeHifGuideProfile(profile,[],catalog,{prioritized:true});
  return{result,catalog,inventory,options,profile};
}
test('LUV generic carry requirements cannot reappear in forecasts, farming goals, customization, or default acquisition instructions',()=>{
  const input=inputFor('i_card-hrnm-3-002','goodImpressionTurns');
  assert.equal(input.profile.characterPolicy.genericCarryRolesSuppressed,true);assert.equal(input.profile.carryRoles.length,0);
  input.result.personalizedPlan=buildPersonalizedPlan(input);
  assert.ok(!input.result.personalizedPlan.cardAccess.some(row=>row.gameId==='p_card-02-act-3_052'));
  assert.ok(input.result.personalizedPlan.cardAccess.some(row=>row.gameId==='p_card-02-men-3_004'&&row.priority==='character_during_target'));
  const book=buildAccountPlaybook(input);
  assert.ok(!book.takeCards.some(row=>row.gameId==='p_card-02-act-3_052'&&row.source==='during_run_target'));
  assert.ok(book.optionalCards.some(row=>row.gameId==='p_card-02-act-3_052'));
  const forecast=buildProduceForecast(input);
  if(forecast.guideSkillMatch)assert.equal(forecast.guideSkillMatch.roles.length,0);
  assert.ok(!buildCustomizationReadiness(input).duringProduce.some(row=>row.target.gameId==='p_card-02-act-3_052'));
  const choice=buildPostProduceMemoryChoice({catalog,inventory:input.inventory,target:input.options,candidates:[]});
  assert.equal(choice.creationGoals.filter(goal=>goal.kind==='carried_skill').length,0);
  const flow=buildRunFlowGuidance(input);
  assert.ok(flow.notApplicableProfiles.some(profile=>profile.reason.includes('고유 예외')));
  input.result.idolOperatingGuidance=buildIdolOperatingGuidance(input);
  assert.ok(input.result.idolOperatingGuidance.keyActions.some(row=>row.text.includes('회복')&&row.text.includes('한 번')));
  assert.equal(buildRecommendationCoverage(input).characterFullyModeled,false);
});
test('another Rinami P-card cannot inherit LUV despite sharing the character and impression type',()=>{
  const input=inputFor('i_card-hrnm-3-013','goodImpressionTurns');
  assert.equal(input.profile.characterPolicy,undefined);assert.equal(input.profile.carryRoles.length,4);
});
test('Sora China optional attack and source cautions stay distinct from a new mandatory recipe',()=>{
  const input=inputFor('i_card-kcna-3-014','goodConditionTurns');
  assert.ok(!input.profile.carryRoles.some(row=>row.gameId==='p_card-01-act-2_059'));
  assert.ok(input.profile.optionalCarryRoles.some(row=>row.gameId==='p_card-01-act-2_059'));
  assert.ok(input.profile.characterSelectionRules.some(rule=>rule.gameId==='p_card-01-act-3_185'&&rule.action==='avoid'&&rule.applies===true));
  assert.equal(input.profile.characterPolicy.exactReplacementRecipeConfirmed,false);
  assert.equal(input.profile.characterPolicy.duringTargets.find(row=>row.gameId==='p_card-01-act-3_184').applies,false);
});
