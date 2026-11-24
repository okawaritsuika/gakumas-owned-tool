import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildSourceRecipeReadiness} from '../lib/source-recipe-readiness.mjs';

function fixture(){
  return {catalog:{skillCards:[{gameId:'carrier',upgradeCount:1,nameKo:'반입 카드+',nameJa:'持込+',imageUrl:'/assets/carrier.png'},{gameId:'target',upgradeCount:0,nameKo:'발동 대상',nameJa:'対象',imageUrl:'/assets/target.png'}],supportCards:[{gameId:'support',nameKo:'서포트',nameJa:'サポート'}],idolRecipePolicies:{sources:[{id:'source',title:'작성자 원문',url:'https://example.test/guide'}]}},
    result:{memories:[{id:'selected',modelEffects:{carriedSkill:{id:'carrier',upgrade:1,phase:{code:2}}}}],supports:{owned:[{gameId:'support',level:20}],rental:null},
      scoreSummary:{hifModel:{guideMemoryProfile:{roles:[{gameId:'carrier',memoryId:'selected',status:'fulfilled',checks:[]}],characterPolicy:{sourceRecipes:[{id:'recipe',label:'조건부 후보',sourceIds:['source'],sourcePhasesKnown:false,sourceCustomizationsFullyKnown:false,observedConditions:['원문 지원 조건'],requiredHifEffects:[{effectId:'required-effect',abilityId:'native-ability',level:1,triggerCardId:'target',summaryKo:'발동 대상 사용 후 추가사용'}],requiredSupports:[{anyOfGameIds:['support'],minimumLevel:null,observedLevel:40}],drinkRequirements:[{nameJa:'ハツボシエキス',perRound:1}]}]}}}},
      hifAbilityGuidance:{selectedMemories:[{memoryId:'selected',carriedSkillId:'carrier',hifEffects:[]}]}},inventory:{},options:{}};
}
const recipe=data=>data.recipes[0];
const required=input=>input.result.scoreSummary.hifModel.guideMemoryProfile.characterPolicy.sourceRecipes[0];
const effect=input=>input.result.hifAbilityGuidance.selectedMemories[0].hifEffects;

test('no source recipes produce no payload and no UI',()=>{
  const input=fixture();input.result.scoreSummary.hifModel.guideMemoryProfile.characterPolicy.sourceRecipes=[];
  assert.equal(buildSourceRecipeReadiness(input),null);
  const context=vm.createContext({URL});vm.runInContext(fs.readFileSync(new URL('../web/source-recipe-readiness.js',import.meta.url),'utf8'),context);
  assert.equal(context.sourceRecipeReadinessMarkup({}),'');
});

test('known current phase never fills an unknown source phase or custom template; inputs stay unchanged',()=>{
  const input=fixture(),before=structuredClone(input),data=buildSourceRecipeReadiness(input),row=recipe(data);
  assert.equal(row.carryRoles[0].currentPhase,2);assert.equal(row.carryRoles[0].sourcePhaseKnown,false);
  assert.ok(row.checks.some(check=>check.id==='source_phases'&&check.status==='unknown'));
  assert.ok(row.checks.some(check=>check.id==='source_customizations'&&check.status==='unknown'));
  assert.equal(row.readinessConfirmed,false);assert.equal(data.battleSimulationUsed,false);assert.equal(data.battle,false);
  assert.deepEqual(input,before);
  input.result.memories[0].modelEffects.carriedSkill.phase={code:0};
  assert.equal(recipe(buildSourceRecipeReadiness(input)).carryRoles[0].currentPhase,null);
});

test('having the carrier or the trigger card name does not supply a required HIF effect',()=>{
  const input=fixture();input.result.memories.push({id:'target-memory',produceCard:{id:'target'}});
  assert.equal(recipe(buildSourceRecipeReadiness(input)).hifRequirements[0].status,'missing_ability');
  effect(input).push({effectId:'different-effect',abilityId:'native-ability',targetRequirementSatisfied:true});
  assert.equal(recipe(buildSourceRecipeReadiness(input)).hifRequirements[0].status,'missing_ability');
});

test('an exact HIF effect requires target evidence; a later target never becomes a first-exam or actual-activation claim',()=>{
  const input=fixture();effect(input).push({effectId:'required-effect',targetRequirementSatisfied:false,targetAvailability:'conditional_during',activationConfirmed:true});
  let row=recipe(buildSourceRecipeReadiness(input)).hifRequirements[0];
  assert.equal(row.status,'conditional_target');assert.equal(row.targetRequirementSatisfied,false);assert.equal(row.activationConfirmed,false);
  effect(input)[0].targetAvailability='missing';
  assert.equal(recipe(buildSourceRecipeReadiness(input)).hifRequirements[0].status,'missing_target');
  effect(input)[0].targetAvailability='after_selection_1';effect(input)[0].targetRequirementSatisfied=true;
  row=recipe(buildSourceRecipeReadiness(input)).hifRequirements[0];
  assert.equal(row.status,'target_present');assert.equal(row.targetAvailability,'after_selection_1');assert.equal(row.activationConfirmed,false);
  assert.equal(row.targetAvailabilityLabel,'선발1 후 대상 합류');
  assert.equal(recipe(buildSourceRecipeReadiness(input)).readinessConfirmed,false);
});

test('owned but unselected HIF carriers cannot satisfy the selected four requirements',()=>{
  const input=fixture();input.result.hifAbilityGuidance.selectedMemories.push({memoryId:'owned-only',carriedSkillId:'target',hifEffects:[{effectId:'required-effect',targetRequirementSatisfied:true}]});
  assert.equal(recipe(buildSourceRecipeReadiness(input)).hifRequirements[0].status,'missing_ability');
  delete input.result.hifAbilityGuidance;
  assert.equal(recipe(buildSourceRecipeReadiness(input)).hifRequirements[0].status,'unknown_effect');
});

test('an observed support level is not a minimum, and only a stated minimum has an exact boundary',()=>{
  const input=fixture();let row=recipe(buildSourceRecipeReadiness(input)).supportRequirements[0];
  assert.equal(row.status,'selected');assert.equal(row.minimumLevel,null);assert.equal(row.observedLevel,40);assert.equal(row.itemAcquisitionConfirmed,null);
  required(input).requiredSupports[0].minimumLevel=40;input.result.supports.owned[0].level=39;
  assert.equal(recipe(buildSourceRecipeReadiness(input)).supportRequirements[0].status,'level_missing');
  input.result.supports.owned[0].level=40;
  assert.equal(recipe(buildSourceRecipeReadiness(input)).supportRequirements[0].status,'selected');
  delete input.result.supports.owned[0].level;
  assert.equal(recipe(buildSourceRecipeReadiness(input)).supportRequirements[0].status,'level_unknown');
  input.result.supports.owned=[];
  assert.equal(recipe(buildSourceRecipeReadiness(input)).supportRequirements[0].status,'missing');
});

test('any-of support alternatives include the rental, but neither support nor drink possession certifies a Pitem or its activation',()=>{
  const input=fixture();required(input).requiredSupports[0]={anyOfGameIds:['absent','support'],minimumLevel:40};
  input.result.supports={owned:[{gameId:'support',level:39}],rental:{gameId:'support',level:40,rental:true}};
  input.inventory.drinks=[{nameJa:'ハツボシエキス',quantity:99}];input.options.drinksConfirmed=true;
  const row=recipe(buildSourceRecipeReadiness(input));
  assert.equal(row.supportRequirements[0].status,'selected');assert.equal(row.supportRequirements[0].itemStatus,'unknown');
  assert.equal(row.drinkRequirements[0].status,'unknown');assert.equal(row.drinkRequirements[0].quantityConfirmed,false);
});

test('renderer folds details, shows exact skill refs and current shortage, escapes text, and rejects executable source URLs',()=>{
  const input=fixture(),data=buildSourceRecipeReadiness(input),calls=[];
  data.recipes[0].label='<img src=x onerror=alert(1)>';
  data.recipes[0].sources.push({title:'bad source',url:'javascript:alert(1)'});
  const context=vm.createContext({URL,memorySkillVisualMarkup:ref=>{calls.push(ref.gameId);return '<span class="visual-stub">스킬 그림</span>';}});
  vm.runInContext(fs.readFileSync(new URL('../web/source-recipe-readiness.js',import.meta.url),'utf8'),context);
  const html=context.sourceRecipeReadinessMarkup({sourceRecipeReadiness:data});
  assert.match(html,/현재 부족/);assert.match(html,/<details>/);assert.doesNotMatch(html,/<details[^>]+open/);
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);assert.doesNotMatch(html,/href="javascript:/);
  assert.ok(calls.includes('carrier'));assert.ok(calls.includes('target'));assert.match(html,/원문 실전 레벨 40/);
  assert.match(html,/현재 편성 Lv 20/);
  assert.match(html,/현재 확보 미확인/);assert.match(html,/서포트 보상 실제 획득/);
});

test('a support skill reward does not become a Pitem acquisition warning',()=>{
  const input=fixture(),support=input.catalog.supportCards[0];
  support.skill_card={name:'頭上に注意！'};support.p_item=null;
  let row=recipe(buildSourceRecipeReadiness(input)).supportRequirements[0];
  assert.equal(row.rewardKind,'skill_card');assert.match(row.acquisitionLabel,/지원 스킬 실제 획득/);
  assert.doesNotMatch(row.acquisitionLabel,/P아이템/);assert.equal(row.itemAcquisitionConfirmed,null);
  support.p_item={name:'寝心地は良好'};support.skill_card=null;
  row=recipe(buildSourceRecipeReadiness(input)).supportRequirements[0];
  assert.equal(row.rewardKind,'p_item');assert.match(row.acquisitionLabel,/P아이템 실제 획득/);
});
