import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {buildRecommendationCoverage} from '../lib/recommendation-coverage.mjs';
import {loadCatalog} from '../lib/catalog.mjs';
import {buildIdolOperatingGuidance} from '../lib/idol-operating-guidance.mjs';

function fixture(){
  const card={gameId:'idol-a',characterId:'char-a',nameKo:'테스트 P카드',nameJa:'テスト',plan:'logic',recommendedEffect:'motivation',
    baseStats:{baseVoDaVi:{vo:40,da:50,vi:60},growthRatePermil:{vo:100,da:200,vi:300}},specialTrainingStages:[{rank:1,voDaViDelta:{vo:10,da:20,vi:30}}],
    awakeningStages:[{rank:1,growthRatePermilDelta:{vo:10,da:20,vi:30},cumulativeDeltaArithmetic:{growthRatePermil:{vo:10,da:20,vi:30}}}],
    characterBonuses:{characterId:'char-a',trueEndBonuses:[{scenarioEnum:'ProduceType_HatsuboshiIdolFestival',growthRatePermilDelta:{vo:7,da:8,vi:9}}]}};
  const owned={gameId:'idol-a',characterId:'char-a',levelLimitRank:1,potentialRank:1,characterGrowth:{characterId:'char-a',trueEndProduceTypes:[3]}};
  const inventory={idolCards:[owned]},catalog={idolCards:[card],multiCreatorGuidance:{idolProfiles:[{idolGameId:'idol-a',characterId:'char-a',identityVerified:true}],researchCoverage:{}},guideSupportProfiles:{profiles:[{id:'source-a',idolCardId:'idol-a',scenario:'hif',plan:'logic',trainingType:'motivation'}]}};
  const result={selectedIdol:{...card,ownershipVerified:true,owned},scoreSummary:{scenario:'hif',plan:'logic',trainingType:'motivation',hifModel:{initialStats:{vocal:80,dance:90,visual:100}}},supports:{owned:[{gameId:'s1',level:25,uncap:2}],rental:{gameId:'s2',level:60,uncap:4,rental:true}}};
  return {result,catalog,inventory,options:{scenario:'hif'}};
}
const row=(data,id)=>data.usedForSelection.find(item=>item.id===id);

test('HIF coverage distinguishes current awakening/character True End growth from combined initial stats and never claims unique combat modeling',()=>{
  const input=fixture(),before=structuredClone(input),data=buildRecommendationCoverage(input);
  assert.equal(row(data,'initial_stats').status,'used');
  assert.deepEqual(row(data,'initial_stats').evidence.modeledCombinedInitial,{vocal:80,dance:90,visual:100});
  assert.equal(row(data,'persistent_growth').status,'used');
  assert.deepEqual(row(data,'persistent_growth').evidence.currentGrowthRatePermil,{vo:117,da:228,vi:339});
  assert.deepEqual(row(data,'persistent_growth').evidence.awakening,{vo:10,da:20,vi:30});
  assert.deepEqual(row(data,'persistent_growth').evidence.trueEnd,{vo:7,da:8,vi:9});
  assert.equal(data.characterFullyModeled,false);assert.equal(data.uniqueSkillCombatEffectsRanked,false);assert.equal(data.changesRanking,false);
  assert.deepEqual(input,before);
  input.options.initialStats={vocal:1,dance:2,visual:3};
  assert.equal(row(buildRecommendationCoverage(input),'initial_stats').status,'manual_override');
});

test('unknown observed ranks and True End state stay partial instead of silently assuming maximum or zero',()=>{
  const input=fixture();input.result.selectedIdol.owned={gameId:'idol-a'};input.inventory.idolCards=[{gameId:'idol-a',characterId:'char-a'}];
  const data=buildRecommendationCoverage(input),growth=row(data,'persistent_growth');
  assert.equal(row(data,'initial_stats').status,'partial');assert.equal(growth.status,'partial');
  assert.equal(growth.evidence.currentGrowthRatePermil,null);assert.deepEqual(growth.evidence.knownGrowthRatePermil,{vo:100,da:200,vi:300});
  assert.equal(growth.evidence.awakening,null);assert.equal(growth.evidence.trueEnd,null);
  assert.equal(data.variantEvidence.currentVariantConfirmed,false);
});

test('only exact P-card and type-matched source evidence can say an individual support or memory policy was used',()=>{
  const input=fixture();input.result.sourceGuideEvidence={profileId:'source-a',mode:'guide',poolGameIds:['s1','s2']};
  input.result.scoreSummary.hifModel.guideMemoryProfile={trainingType:'motivation',characterPolicy:{id:'policy-a',applied:true,usedForSelection:true,selectedIdolGameId:'idol-a',matchedPolicyIds:['rule-a'],sourceIds:['source-a']}};
  let data=buildRecommendationCoverage(input);assert.equal(row(data,'exact_support_pool').status,'used');assert.equal(row(data,'character_memory_policy').status,'used');
  input.result.sourceGuideEvidence.mode='unrestricted';
  assert.equal(row(buildRecommendationCoverage(input),'exact_support_pool').status,'available_not_used');
  input.result.scoreSummary.hifModel.guideMemoryProfile.characterPolicy.selectedIdolGameId='same-character-other-card';
  assert.equal(row(buildRecommendationCoverage(input),'character_memory_policy').status,'inconsistent_evidence');
  input.result.scoreSummary.hifModel.guideMemoryProfile.characterPolicy.selectedIdolGameId='idol-a';
  input.result.scoreSummary.hifModel.guideMemoryProfile.trainingType='goodImpressionTurns';
  assert.equal(row(buildRecommendationCoverage(input),'character_memory_policy').status,'inconsistent_evidence');
});

test('real Atmosphere skill training and item awakening variants are identity evidence; HIF target presence is not a combat bonus',()=>{
  const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))}),id='i_card-kllj-3-015',card=catalog.idolCards.find(row=>row.gameId===id);
  const owned={gameId:id,characterId:card.characterId,levelLimitRank:3,potentialRank:0},inventory={idolCards:[owned]},options={scenario:'hif',trainingType:'fullPower',producerLevel:70};
  const result={selectedIdol:{...card,ownershipVerified:true,owned},scoreSummary:{scenario:'hif',plan:'anomaly',trainingType:'fullPower',hifModel:{initialStats:{vocal:100,dance:100,visual:100}}}};
  result.idolOperatingGuidance=buildIdolOperatingGuidance({result,catalog,inventory,options});
  result.hifAbilityGuidance={selectedMemories:[{memoryId:'phase2-carrier',hifEffects:[{effectId:'target-effect',applies:true,targetRequirementSatisfied:true,targetAvailability:'at_start',triggerCards:[{gameId:card.uniqueIds.produceCardId}]}]}]};
  let data=buildRecommendationCoverage({result,catalog,inventory,options});
  assert.equal(data.variantEvidence.uniqueSkills[0].upgradeCount,1);
  assert.equal(data.variantEvidence.uniqueItems[0].gameId,'pitem_03-3-289-0');
  assert.equal(data.variantEvidence.currentVariantConfirmed,true);
  assert.equal(row(data,'hif_target_conditions').status,'qualitative_condition_only');
  assert.equal(row(data,'hif_target_conditions').evidence.uniqueCardUsedAsTargetEvidence,true);
  assert.equal(row(data,'hif_target_conditions').evidence.numericSkillBonusApplied,false);
  assert.equal(data.uniqueItemCombatEffectsRanked,false);
  owned.levelLimitRank=0;owned.potentialRank=2;
  result.idolOperatingGuidance=buildIdolOperatingGuidance({result,catalog,inventory,options});
  data=buildRecommendationCoverage({result,catalog,inventory,options});
  assert.equal(data.variantEvidence.uniqueSkills[0].upgradeCount,0);
  assert.equal(data.variantEvidence.uniqueItems[0].gameId,'pitem_03-3-289-1');
});

test('non-HIF coverage does not claim HIF initial/deck-growth arithmetic or HIF effects and support items require confirmed grants',()=>{
  const input=fixture();input.result.scoreSummary.scenario='nia';input.result.scoreSummary.hifModel=undefined;
  let data=buildRecommendationCoverage(input);
  assert.equal(row(data,'initial_stats').status,'not_in_numeric_path');assert.equal(row(data,'persistent_growth').status,'reference_only');assert.equal(row(data,'hif_target_conditions').status,'not_applicable');
  input.result.resourceLedger={supportItems:[{supportGameId:'s1',acquisitionConfirmed:false,applied:{stats:{vocal:0},resources:{hpRecovery:0}},potential:{stats:{vocal:99}}}]};
  assert.equal(row(buildRecommendationCoverage(input),'support_produce_items').status,'reference_only');
  input.result.resourceLedger.supportItems.push({supportGameId:'s2',acquisitionConfirmed:true,applied:{activationCount:1,stats:{vocal:25,dance:0,visual:0},resources:{hpRecovery:2}}});
  data=buildRecommendationCoverage(input);assert.equal(row(data,'support_produce_items').status,'reference_only');assert.equal(row(data,'support_produce_items').evidence.numericRankInclusionConfirmed,false);
  input.result.scoreSummary.scenario='hif';input.result.scoreSummary.hifModel={};
  data=buildRecommendationCoverage(input);assert.equal(row(data,'support_produce_items').status,'partial');assert.equal(row(data,'support_produce_items').evidence.appliedItems.length,1);
});

test('inventory coverage counts are derived from current records rather than a fixed 114-card snapshot',()=>{
  const input=fixture();input.inventory.idolCards.push({gameId:'new-unlinked-card',characterId:'char-b'});
  const data=buildRecommendationCoverage(input);
  assert.equal(data.catalogCoverage.ownedVariants,2);assert.equal(data.catalogCoverage.ownedCharacters,2);assert.equal(data.catalogCoverage.nativeIdLinkedOwnedVariants,1);
  assert.equal(data.catalogCoverage.allOwnedUniqueMechanicsModeled,false);
});

test('coverage renderer keeps the scope summary visible, details folded, and untrusted names escaped',()=>{
  const data=buildRecommendationCoverage(fixture());data.selectedIdol.nameKo='<img src=x onerror=alert(1)>';
  const context=vm.createContext({escapeHtml:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))});
  vm.runInContext(fs.readFileSync(new URL('../web/recommendation-coverage.js',import.meta.url),'utf8'),context);
  const html=context.recommendationCoverageMarkup({recommendationCoverage:data});
  assert.match(html,/rc-summary/);assert.match(html,/고유 전투 효능 · 미계산/);assert.match(html,/<details class="rc-details">/);
  assert.doesNotMatch(html,/<details[^>]+open/);assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img/);
  assert.equal(context.recommendationCoverageMarkup({}),'');
});
