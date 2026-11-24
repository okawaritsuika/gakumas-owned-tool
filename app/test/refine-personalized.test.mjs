import test from 'node:test';
import assert from 'node:assert/strict';
import { pairedImprovement, refinePersonalizedCandidates } from '../lib/refine-personalized.mjs';

const shortStage=()=>({scenario:'hif',turnCounts:{vocal:2,dance:0,visual:0},firstTurns:{vocal:1,dance:0,visual:0},
  criteria:{vocal:1,dance:0,visual:0},effects:[],typeMultipliers:{vocal:1,dance:1,visual:1}});
const deck=id=>({deckAssumptionConfirmed:true,params:[100,100,100,40],supportBonus:0,pItemIds:[],
  skillCardIdGroups:[[id]],customizationGroups:[[]],plan:'sense'});
const stage=(index,id=1)=>({examIndex:index,stage:index<3?'selection':'final',order:index<3?index+1:index-2,status:'simulated',
  deck:deck(id),simulationInput:{stage:shortStage()},statistics:{runs:8,mean:3,p10:2},sampleScores:[{seed:100+index,score:3}],
  passBounds:{status:'unknown',lower:null,upper:null}});
const candidate=(id='current',mode='current',eligible=true,coarseMean=100)=>({id,levelMode:mode,eligibilityForRecommendation:eligible,
  selectedIdol:{gameId:'idol'},rankingScore:coarseMean,finalContribution:{statistics:{mean:coarseMean}},
  stages:Array.from({length:5},(_,index)=>stage(index,index>=3?2:1)),baselineStages:Array.from({length:5},(_,index)=>stage(index)),
  safety:{firstSelection:{status:'unknown_pass_condition',mean:3,p10:2}},
  progression:{selectedRouteId:'route',routes:[{id:'route',finalMean:3}],comparison:{baselineFinalMean:3,conditionalFinalMean:3,expectedMean:null}}});
const catalog=()=>({skillCards:[{internalId:1,gameId:'base',nameKo:'기본 어필',nameJa:'基本アピール',imageUrl:'base.png'},
  {internalId:2,gameId:'base',nameKo:'기본 어필+',nameJa:'基本アピール+',imageUrl:'plus.png'}],hifExamProfiles:{profiles:[]}});

test('repeats exact two-turn engine inputs with 128 common seeds, keeps the source unchanged, and reports conditional 18→28',async()=>{
  const comparison={candidates:[candidate()]},before=structuredClone(comparison);
  const result=await refinePersonalizedCandidates({comparison,catalog:catalog()});
  const refined=result.candidates[0];
  assert.deepEqual(comparison,before);
  assert.equal(result.refinement.runs,128);assert.equal(result.refinement.status,'refined_shortlist');
  assert.equal(refined.refinement.checkpointResults.length,6);
  for(const index of [0,3,4]){
    const changed=refined.stages[index],baseline=refined.baselineStages[index];
    assert.equal(changed.statistics.runs,128);assert.equal(baseline.statistics.runs,128);
    assert.equal(changed.statistics.mean,index===0?18:28);assert.equal(baseline.statistics.mean,18);
    assert.deepEqual(changed.sampleScores.map(row=>row.seed),baseline.sampleScores.map(row=>row.seed));
    assert.equal(changed.coarseStatistics.runs,8);
  }
  for(const index of [1,2]){
    assert.deepEqual(refined.stages[index],before.candidates[0].stages[index]);
    assert.deepEqual(refined.baselineStages[index],before.candidates[0].baselineStages[index]);
  }
  assert.equal(refined.finalContribution.statistics.mean,61);
  assert.equal(refined.baselineFinalContribution.statistics.mean,39);
  assert.equal(refined.refinement.pairedAcquisitionImprovement.meanDelta,22);
  assert.deepEqual(refined.refinement.pairedAcquisitionImprovement.approximate95Interval,{lower:22,upper:22});
  assert.equal(refined.refinement.pairedAcquisitionImprovement.runs,128);
  assert.match(refined.refinement.pairedAcquisitionImprovement.limitation,/몬테카를로.*실제 게임/);
  assert.equal(refined.progression.comparison.baselineFinalMean,18);
  assert.equal(refined.progression.comparison.conditionalFinalMean,28);
  assert.equal(refined.progression.comparison.expectedMean,null);
  assert.equal(refined.progression.routes[0].contributionMean,61);
  assert.equal(refined.stages[4].representativeTrace.turns[0].playedCards[0].imageUrl,'plus.png');
});

test('shortlist admits eligible current top two and eligible upgraded top one before higher-scoring infeasible previews',async()=>{
  const comparison={candidates:[candidate('preview-a','current',false,1000),candidate('preview-b','current',false,900),
    candidate('eligible-a','current',true,800),candidate('eligible-b','current',true,700),
    candidate('upgrade-preview','upgraded',false,1000),candidate('upgrade-eligible','upgraded',true,50)]};
  const result=await refinePersonalizedCandidates({comparison,catalog:catalog(),runs:4});
  assert.deepEqual(new Set(result.refinement.candidateIds),new Set(['eligible-a','eligible-b','upgrade-eligible']));
  for(const id of ['preview-a','preview-b','upgrade-preview'])assert.equal(result.candidates.find(row=>row.id===id).refinement,undefined);
  assert.ok(['eligible-a','eligible-b'].includes(result.recommendedCurrentCandidateId));
  assert.equal(result.recommendedUpgradedCandidateId,'upgrade-eligible');
  assert.ok(result.refinement.exhaustive===false&&result.refinement.gameEfficacyVerified===false);
});

test('recomputed first-selection failure removes eligibility while round failures keep combined-NPC uncertainty',async()=>{
  const input=candidate();
  const data=catalog();data.hifExamProfiles={profiles:[{idolCardId:'idol',examStages:Array.from({length:5},(_,index)=>({
    stage:index<3?'selection':'final',order:index<3?index+1:index-2,isStaticNpcScore:true,npcGroupId:index<3?'selection-npc':'final-npc',rankThreshold:1}))}],
    npcGroups:{'selection-npc':[{scoreMin:20,scoreMax:20}],'final-npc':[{scoreMin:1000,scoreMax:1000}]}};
  const result=await refinePersonalizedCandidates({comparison:{candidates:[input],recommendedCandidateId:input.id},catalog:data,runs:4});
  const refined=result.candidates[0];
  assert.equal(refined.stages[0].passBounds.upper,0);
  assert.equal(refined.safety.firstSelection.status,'model_infeasible');
  assert.deepEqual(refined.safety.infeasibleStages,[0]);
  assert.equal(refined.eligibilityForRecommendation,false);assert.equal(result.recommendedCandidateId,null);
  assert.equal(refined.safety.firstSelection.margin,-3);
  for(const index of [3,4]){
    assert.equal(refined.stages[index].passBounds.status,'unknown_combined_npc');
    assert.equal(refined.stages[index].passBounds.upper,null);
    assert.equal(refined.stages[index].passBounds.roundBounds.upper,0);
  }
  const firstPass=candidate('pass');firstPass.stages[0]=stage(0,2);firstPass.baselineStages[0]=stage(0,2);
  const pass=await refinePersonalizedCandidates({comparison:{candidates:[firstPass]},catalog:data,runs:4});
  assert.equal(pass.candidates[0].eligibilityForRecommendation,true);
  assert.deepEqual(pass.candidates[0].safety.infeasibleStages,[]);
});

test('pairs by actual seeds even when rows are shuffled, and does not invent pairs for missing or duplicate keys',()=>{
  const paired=pairedImprovement([{seed:1,score:12},{seed:2,score:22},{seed:3,score:9}],
    [{seed:2,score:20},{seed:1,score:10},{seed:4,score:40}]);
  assert.equal(paired.runs,2);assert.equal(paired.meanDelta,2);assert.equal(paired.pairedPositiveRate,1);
  assert.equal(paired.unmatchedChanged,1);assert.equal(paired.unmatchedBaseline,1);
  assert.deepEqual(paired.approximate95Interval,{lower:2,upper:2});
  assert.equal(pairedImprovement([{score:12}],[{score:10}]),null);
  assert.equal(pairedImprovement([{seed:1,score:12},{seed:1,score:13}],[{seed:1,score:10}]),null);
  assert.equal(pairedImprovement([{round1Seed:1,round2Seed:2,score:12}],[{round1Seed:1,round2Seed:3,score:10}]),null);
});

test('changing only a future stage leaves earlier actual engine samples identical',async()=>{
  const comparison={candidates:[candidate()]},future=structuredClone(comparison);
  future.candidates[0].stages[4].simulationInput.stage.typeMultipliers.vocal=2;
  const first=await refinePersonalizedCandidates({comparison,catalog:catalog(),runs:4});
  const second=await refinePersonalizedCandidates({comparison:future,catalog:catalog(),runs:4});
  for(const index of [0,3])assert.deepEqual(first.candidates[0].stages[index].sampleScores,second.candidates[0].stages[index].sampleScores);
  assert.equal(first.candidates[0].stages[4].statistics.mean,28);
  assert.equal(second.candidates[0].stages[4].statistics.mean,56);
  assert.deepEqual(first.candidates[0].baselineStages,second.candidates[0].baselineStages);
});

test('variable real hands yield a nonzero paired Monte Carlo interval for the declared success versus miss branch',async()=>{
  const input=candidate(),ids=[1,3,5,7,15,17,13];
  for(const [branch,stages] of [['conditional',input.stages],['baseline',input.baselineStages]])for(const row of stages){
    row.deck.skillCardIdGroups=[[...ids]];row.deck.recommendedEffect='concentration';
    if(branch==='conditional'&&row.examIndex>=3)row.deck.skillCardIdGroups[0][0]=2;
  }
  const result=await refinePersonalizedCandidates({comparison:{candidates:[input]},catalog:catalog(),runs:32});
  const refined=result.candidates[0],evidence=refined.refinement.pairedAcquisitionImprovement;
  assert.equal(evidence.runs,32);assert.equal(evidence.meanDelta,7.5625);
  assert.equal(evidence.pairedPositiveRate,0.875);
  assert.ok(evidence.standardErrorOfDelta>0);
  assert.ok(evidence.approximate95Interval.lower>5.89&&evidence.approximate95Interval.lower<5.90);
  assert.ok(evidence.approximate95Interval.upper>9.22&&evidence.approximate95Interval.upper<9.24);
  assert.equal(evidence.unmatchedChanged,0);assert.equal(evidence.unmatchedBaseline,0);
  assert.ok(refined.finalContribution.statistics.maxObserved>refined.finalContribution.statistics.min);
  assert.equal(refined.progression.comparison.expectedMean,null);
  assert.match(evidence.basis,/not_game_validation/);
});

test('unsupported revalidation does not masquerade as equal-precision evidence or retain recommendation',async()=>{
  const input=candidate();input.stages[4].deck.customizationGroups=[[{999999:1}]];
  const result=await refinePersonalizedCandidates({comparison:{candidates:[input],recommendedCandidateId:input.id},catalog:catalog(),runs:4});
  assert.equal(result.candidates[0].refinement.status,'partial');
  assert.equal(result.candidates[0].refinement.pairedAcquisitionImprovement,null);
  assert.equal(result.candidates[0].eligibilityForRecommendation,false);
  assert.equal(result.recommendedCandidateId,null);
  assert.equal(result.refinement.status,'no_supported_shortlist');
  assert.deepEqual(result.refinement.candidateIds,[]);
  assert.ok(result.candidates[0].refinement.checkpointResults.some(row=>row.examIndex===4&&row.status==='unsupported'));
});

test('validates repetition and shortlist bounds without altering caller input',async()=>{
  for(const runs of [3,1001,4.5])await assert.rejects(refinePersonalizedCandidates({comparison:{candidates:[]},catalog:catalog(),runs}),RangeError);
  for(const maxCurrent of [0,3,1.5])await assert.rejects(refinePersonalizedCandidates({comparison:{candidates:[]},catalog:catalog(),runs:4,maxCurrent}),RangeError);
});
