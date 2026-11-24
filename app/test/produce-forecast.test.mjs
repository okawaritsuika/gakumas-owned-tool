import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildProduceForecast } from '../lib/produce-forecast.mjs';
import { loadCatalog } from '../lib/catalog.mjs';

const fixture=()=>({result:{scoreSummary:{scenario:'hif',plan:'anomaly',trainingType:'full_power',
  hifModel:{status:'conditional_incomplete',cappedStats:{vocal:1200,dance:1500,visual:2000},modeledStatTotal:4700}},memories:[]},
  inventory:{capturedAt:'2026-11-04T01:00:00Z',memories:[{vocal:9999,dance:9999,visual:9999}]},catalog:{hifExamProfiles:{snapshot:'fixed'}}});

test('reports route stats and existing index without converting them into fictitious exam scores or total evaluation',()=>{
  const input=fixture(),before=structuredClone(input),forecast=buildProduceForecast(input);
  assert.equal(forecast.status,'partial_stat_forecast');
  assert.deepEqual([forecast.projectedStats.vocal,forecast.projectedStats.dance,forecast.projectedStats.visual],[1200,1500,2000]);
  assert.equal(forecast.projectedStats.total,4700);assert.equal(forecast.comparisonIndex.value,4700);
  assert.equal(forecast.evaluation.projectedParameterContribution,9400);
  assert.equal(forecast.evaluation.constant,-2000);assert.equal(forecast.evaluation.knownSubtotal,7400);
  assert.equal(forecast.evaluation.starContribution,null);assert.equal(forecast.evaluation.round1Contribution,null);
  assert.equal(forecast.evaluation.round2Contribution,null);assert.equal(forecast.evaluation.total,null);
  assert.equal(forecast.evaluation.grade,null);assert.equal(forecast.evaluation.isLowerBound,false);
  assert.equal(forecast.confidence.gameScorePredicted,false);
  assert.deepEqual(input,before);
});

test('only explicitly supplied final star adds a star component; zero is an input rather than an unknown default',()=>{
  const input=fixture();
  const star=buildProduceForecast({...input,options:{finalStar:1000}});
  assert.equal(star.evaluation.starContribution,7500);assert.equal(star.evaluation.knownSubtotal,14900);
  assert.equal(star.evaluation.total,null);
  const zero=buildProduceForecast({...input,options:{finalStar:0}});
  assert.equal(zero.evaluation.starContribution,0);
  const absent=buildProduceForecast(input);assert.equal(absent.evaluation.starContribution,null);
});

test('partial manual final stats remain partial and are never filled with projected or memory-completion stats',()=>{
  const output=buildProduceForecast({...fixture(),options:{finalStats:{vo:1000,da:1200}}});
  assert.equal(output.projectedStats.vocal,1000);assert.equal(output.projectedStats.dance,1200);
  assert.equal(output.projectedStats.visual,null);assert.equal(output.projectedStats.total,null);
  assert.equal(output.evaluation.projectedParameterContribution,null);assert.equal(output.evaluation.knownSubtotal,null);
  assert.equal(output.status,'missing_stat_forecast');
});

test('guide roles use actual native skill, acquisition time and exact grow proof without assigning invented power weights',()=>{
  const input=fixture();input.catalog.hifMemoryRoles={sources:[],profiles:[{id:'power',plan:'anomaly',trainingType:'full_power',
    carryRoles:[{gameId:'skill',nameKo:'축적',purpose:'개시 반복 공격',requiredAcquisitionPhaseForEarlyRole:1,preferredUpgrade:1,
      customizationCriteria:{kind:'grow_effect',nativeGrowEffectType:'exact-grow',minimumValue:2}}]}]};
  input.result.memories=[{id:'memory',skillCard:{gameId:'skill',upgradeCount:1},modelEffects:{carriedSkill:{id:'skill',obtainable:true,
    upgrade:1,phase:{code:1},customizes:[{exactCountKnown:true,customizeCount:1,growEffects:[{effectType:'exact-grow',value:3}]}]}}}];
  const fulfilled=buildProduceForecast(input);assert.equal(fulfilled.guideSkillMatch.fulfilledCount,1);
  assert.equal(fulfilled.guideSkillMatch.readinessConfirmed,false);assert.equal(fulfilled.guideSkillMatch.actualLoopValidated,false);
  assert.equal(fulfilled.guideSkillMatch.roles[0].actualSelectedSkill.acquisitionPhase.code,1);
  assert.equal(fulfilled.guideSkillMatch.roles[0].actualSelectedSkill.customizations[0].growEffects[0].effectType,'exact-grow');
  input.result.memories[0].modelEffects.carriedSkill.phase.code=2;
  const later=buildProduceForecast(input);assert.equal(later.guideSkillMatch.missingCount,1);
  input.result.memories[0].modelEffects.carriedSkill.phase.code=1;
  input.result.memories[0].modelEffects.carriedSkill.customizes[0].exactCountKnown=false;
  const unknown=buildProduceForecast(input);assert.equal(unknown.guideSkillMatch.unknownCount,1);
  assert.equal(fulfilled.comparisonIndex.value,later.comparisonIndex.value);
  assert.equal(later.comparisonIndex.value,unknown.comparisonIndex.value);
  assert.equal(fulfilled.guideSkillMatch.numericSkillBonusApplied,false);
});

test('legacy battle means and arbitrary scalar options cannot contaminate the nonbattle forecast',()=>{
  const input=fixture();input.result.finalContribution={statistics:{mean:87424}};input.result.rankingScore=87424;
  const output=buildProduceForecast({...input,options:{scoreMultiplier:12,skillWeight:10000}});
  assert.equal(output.comparisonIndex.value,4700);assert.equal(output.evaluation.total,null);
  assert.equal(output.evaluation.knownSubtotal,7400);
});

test('missing models or other scenarios do not fabricate HIF components',()=>{
  assert.equal(buildProduceForecast().status,'unsupported_scenario');
  const input=fixture();input.result.scoreSummary.hifModel={};
  const missing=buildProduceForecast(input);assert.equal(missing.projectedStats.total,null);
  assert.equal(missing.comparisonIndex.value,null);
  assert.equal(buildProduceForecast({...fixture(),options:{scenario:'nia'}}).status,'unsupported_scenario');
});

test('public catalog role templates retain unresolved customization clauses instead of certifying a completed loop',()=>{
  const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});
  const input=fixture();input.catalog=catalog;
  const result=buildProduceForecast(input);
  assert.equal(result.guideSkillMatch.roles.length,4);
  assert.equal(result.guideSkillMatch.fulfilledCount,0);
  assert.equal(result.guideSkillMatch.readinessConfirmed,false);
  assert.ok(result.guideSkillMatch.sources.some(source=>source.url==='https://morishimemo.com/gakumasu-memo-43'));
  assert.ok(result.sources.every(source=>source.kind!=='actual_game_score_validation'));
  assert.equal(buildProduceForecast({...input,options:{hifMode:'asari'}}).guideSkillMatch.status,'unsupported_mode');
  const moduleText=fs.readFileSync(new URL('../lib/produce-forecast.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(moduleText,/import\s.*(?:battle-simulation|gakumas-engine)/);
});
