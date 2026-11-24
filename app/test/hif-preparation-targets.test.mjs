import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';
import {resolveHifPreparationReference,buildHifPreparationReadiness} from '../lib/hif-preparation-targets.mjs';

const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});
const idolGameId='i_card-kllj-3-015',options={scenario:'hif'};
test('reviewed Atmosphere reference follows its actual exam order rather than growth axis',()=>{
  const reference=resolveHifPreparationReference({catalog,options,idolGameId});
  assert.deepEqual(reference.targets,{visual:2000,dance:1400,vocal:1100});
  assert.equal(reference.exactCircleBoundaryVerified,false);
  assert.equal(reference.guaranteesPassing,false);
  assert.equal(reference.eventRoundApplicabilityVerified,false);
});
test('an author reference is not applied to unreviewed idols or other scenarios',()=>{
  assert.equal(resolveHifPreparationReference({catalog,options,idolGameId:'unknown'}),null);
  assert.equal(resolveHifPreparationReference({catalog,options:{scenario:'nia'},idolGameId}),null);
});
test('final-route sufficiency does not imply preparation before the first final',()=>{
  const result={selectedIdol:{gameId:idolGameId},scoreSummary:{scenario:'hif',hifModel:{cappedStats:{vocal:1200,dance:1500,visual:2100}}}};
  const candidate={stages:[{examIndex:3,projection:{stats:{vocal:900,dance:1400,visual:1800}}},{examIndex:4,projection:{stats:{vocal:1200,dance:1500,visual:2100}}}]};
  const readiness=buildHifPreparationReadiness({result,candidate,catalog,options});
  assert.equal(readiness.routeProjection.referenceMet,true);
  assert.equal(readiness.finals[0].referenceMet,false);
  assert.deepEqual(readiness.finals[0].remaining,{vocal:200,dance:0,visual:200});
  assert.equal(readiness.readinessConfirmed,false);
});
test('a not-requested or different target comparison is not reported as source-goal prioritization',()=>{
  const result={selectedIdol:{gameId:idolGameId},scoreSummary:{scenario:'hif',hifModel:{preparationComparison:{status:'not_requested'}}}};
  assert.equal(buildHifPreparationReadiness({result,catalog,options}).candidateComparisonApplied,false);
  result.scoreSummary.hifModel.preparationComparison={status:'targets_met_in_bounded_search',enabled:true,targets:{vocal:100,dance:200,visual:300}};
  assert.equal(buildHifPreparationReadiness({result,catalog,options}).candidateComparisonApplied,false);
});
