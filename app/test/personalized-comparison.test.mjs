import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { comparePersonalized, summarizeFinalContribution } from '../lib/personalized-comparison.mjs';
import { loadCatalog } from '../lib/catalog.mjs';

function fixture() {
  const supports = Array.from({ length: 9 }, (_, i) => ({ gameId: 'support-' + i, name: '서포트 ' + i, plan: 'free',
    attribute: ['vocal', 'dance', 'visual'][Math.floor(i / 3)], maxLevels: { 0: 40, 4: 60 },
    levelAbilities: [{ level: 1, order: 1, kind: 'initial_stat', activationLimit: 1,
      effects: [{ type: 'ProduceEffectType_VocalAddition', min: 1 + i, max: 1 + i }] }] }));
  const catalog = { supportCards: supports, skillCards: [], memoryAbilities: [], excelPresets: [],
    idolCards: [{ gameId: 'idol', name: '보유 아이돌', plan: 'anomaly', baseStats: { stamina: 30, baseVoDaVi: { vo: 50, da: 50, vi: 50 }, growthRatePermil: { vo: 0, da: 0, vi: 0 } }, specialTrainingStages: [], awakeningStages: [] }],
    hifExamProfiles: { profiles: [] }, calculationModels: {
      'score/schedule': { table: { hif: { none: [{ week: 1, stage: 'selection', activities: ['vo_lesson_da'] }, { week: 7, stage: 'selection', activities: ['mid_exam'] }, { week: 21, stage: 'final', activities: ['vo_lesson_da'] }] } } },
      'score/lesson': { table: { hif: { none: { 1: [{ type: 'sp', main: 50, sub: 20 }], 21: [{ type: 'sp', main: 50, sub: 20 }] } } } },
      'score/paramCap': { table: { hif: { none: 3200 } } },
    } };
  const inventory = { capturedAt: '2026-11-03T10:00:00Z', producerLevel: 70,
    supportCards: supports.map(card => ({ gameId: card.gameId, level: 1, uncap: 0 })),
    idolCards: [{ gameId: 'idol', levelLimitRank: 0, potentialRank: 0 }], memories: [] };
  return { inventory, catalog, options: { scenario: 'hif', idolGameId: 'idol', plan: 'anomaly', trainingType: 'fullPower', compareSupportUpgrades: true }, runs: 1 };
}

test('compares account-specific current and upgrade candidates for each axis without inventing unsupported statistics', async () => {
  const input = fixture(), before = structuredClone(input);
  const result = await comparePersonalized(input);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.candidates.length, 6);
  assert.deepEqual(result.candidates.filter(row => row.levelMode === 'current').map(row => row.primaryAttribute), ['vocal', 'dance', 'visual']);
  assert.deepEqual(result.candidates.filter(row => row.levelMode === 'upgraded').map(row => row.primaryAttribute), ['vocal', 'dance', 'visual']);
  assert.equal(result.recommendedCandidateId, null);
  assert.equal(result.recommendedCurrentCandidateId, null);
  assert.equal(result.recommendedUpgradedCandidateId, null);
  assert.equal(result.rankingBasis, 'known_pass_constraints_then_documented_final_rounds_contribution');
  assert.equal(result.rankingObjective.evaluationScoreImplemented, false);
  assert.deepEqual(result.seedSearch.requestedModes, ['guide', 'opening', 'stats']);
  assert.ok(result.candidates.every(candidate => candidate.seedModes.length === 3));
  assert.equal(result.request.capturedAt, input.inventory.capturedAt);
  for (const candidate of result.candidates) {
    assert.equal(candidate.stages.length, 5);
    assert.equal(candidate.rankingScore, null);
    assert.ok(candidate.supports.filter(card => !card.isRental).every(card => input.inventory.supportCards.some(owned => owned.gameId === card.gameId)));
    assert.equal(candidate.personalizedPlan.context.producerLevel.value, 70);
    for (const stage of candidate.stages) {
      assert.equal(stage.status, 'unsupported');
      assert.equal(stage.statistics, null);
      assert.equal(stage.representativeTrace, null);
      assert.equal(stage.passBounds.lower, null);
      assert.equal(stage.passBounds.upper, null);
    }
  }
  assert.deepEqual(input, before);
});

test('forced axis and current-level-only requests stay bounded and expose capped run counts', async () => {
  const input = fixture();
  input.options.targetAttribute = 'dance';
  input.options.compareSupportUpgrades = false;
  input.runs = 99;
  const result = await comparePersonalized(input);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, 'dance-current');
  assert.equal(result.request.runs, 32);
  assert.equal(result.request.requestedRuns, 99);
  assert.ok(result.limitations.some(value => value.includes('32회')));
  await assert.rejects(comparePersonalized({ ...input, options: { scenario: 'nia' } }), /H.I.F/);
  await assert.rejects(comparePersonalized({ ...input, runs: 0 }), /반복 횟수/);
});

function nativeFixture() {
  const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
  const supports = ['vocal', 'dance', 'visual'].flatMap(axis => catalog.supportCards.filter(card => card.plan === 'free' && card.attribute === axis).slice(0, 3));
  return { catalog, inventory: { capturedAt: '2026-11-03T10:00:00Z', producerLevel: 70,
    supportCards: supports.map(card => ({ gameId: card.gameId, level: 1, uncap: 0 })),
    idolCards: [{ gameId: 'i_card-kllj-3-015', levelLimitRank: 0, potentialRank: 0 }], memories: [] },
  options: { scenario: 'hif', idolGameId: 'i_card-kllj-3-015', plan: 'anomaly', trainingType: 'fullPower', targetAttribute: 'dance', compareSupportUpgrades: true }, runs: 2 };
}

test('native account recipes carry declared acquisitions across five exams and preserve a missed branch without inventing final victory bounds', async () => {
  const result = await comparePersonalized(nativeFixture());
  assert.equal(result.status, 'conditional_comparison');
  assert.equal(result.candidates.length, 2);
  const current = result.candidates.find(candidate => candidate.levelMode === 'current');
  const upgraded = result.candidates.find(candidate => candidate.levelMode === 'upgraded');
  assert.equal(current.stages.length, 5);
  assert.ok(current.stages.every(stage => stage.status === 'simulated'));
  for (const [index, stage] of current.stages.entries()) {
    assert.equal(stage.sampleScores[0].seed, upgraded.stages[index].sampleScores[0].seed);
    assert.equal(stage.statistics.runs, 2);
    assert.equal(stage.statistics.passRate, null);
    assert.ok(current.baselineStages[index].mappedCards.every(card => card.source !== 'declared_acquisition_assumption'));
    assert.equal(stage.automaticRemovals.appliedEvents.length, [0, 2, 4, 4, 4][index]);
  }
  assert.equal(current.stages[0].projection.previousExamCount, 0);
  assert.equal(current.stages[1].projection.previousExamCount, 1);
  assert.equal(current.stages[0].passBounds.status, 'unknown');
  assert.equal(current.stages[4].passBounds.status, 'unknown_combined_npc');
  assert.equal(current.stages[4].passBounds.roundBounds.status, 'model_bounds');
  assert.ok(current.stages[0].representativeTrace.turns.flatMap(turn => turn.playedCards).every(card => card.gameId && card.nameJa));
  assert.equal(current.personalizedPlan.scope.battleSimulationRun, true);
  assert.ok(current.progression.selectedRouteId);
  assert.equal(current.progression.comparison.expectedMean, null);
  const selected = current.progression.routes.find(route => route.id === current.progression.selectedRouteId);
  assert.equal(selected.supportReselected, true);
  assert.equal(selected.memoryPoolPreserved, true);
  assert.deepEqual(selected.stages.map(stage => stage.mappedCards.filter(card => card.source === 'declared_acquisition_assumption').length), [0, 1, 2, 2, 2]);
  assert.ok(selected.events.every(event => event.gameId !== 'p_card-03-act-3_189'));
  assert.ok(current.stages[4].representativeTrace.startingDeckCardCount >= 22);
  assert.equal(current.stages[0].representativeTrace.generatedAtStart.length, 0);
  assert.equal(current.finalSafety.status, 'unknown_combined_npc');
  assert.deepEqual(current.safety.infeasibleStages, []);
  assert.equal(current.eligibilityForRecommendation, true);
  assert.equal(result.recommendedCurrentCandidateId, current.id);
  assert.equal(result.recommendedUpgradedCandidateId, upgraded.id);
  assert.ok(result.recommendedBaselineCandidateId);
  assert.equal(result.bestCurrentPreviewCandidateId, current.id);
  assert.equal(current.rankingScore, current.finalContribution.statistics.mean);
  assert.equal(current.finalContribution.sampleScores[0].score,
    Math.floor(current.stages[3].sampleScores[0].score * 1.2) + current.stages[4].sampleScores[0].score);
});

test('unsupported memory effects trigger reselection among actual owned copies instead of stripping customizations', async () => {
  const input = nativeFixture();
  input.options.compareSupportUpgrades = false;
  input.runs = 1;
  input.inventory.memories = [
    { id: 'unsupported-owned-copy', produceCard: { id: 'p_card-03-act-1_042', upgradeCount: 1,
      customizes: [{ id: 'unsupported-native-grow', customizeCount: 1 }] }, produceCardPhaseType: 1, abilities: [] },
    { id: 'supported-owned-copy', produceCard: { id: 'p_card-03-act-1_042', upgradeCount: 1, customizes: [] }, produceCardPhaseType: 1, abilities: [] },
  ];
  const before = structuredClone(input.inventory);
  const result = await comparePersonalized(input);
  const candidate = result.candidates[0];
  assert.ok(candidate.memoryFallback);
  assert.equal(candidate.memoryFallback.eligibleMemoryCount, 1);
  assert.deepEqual(candidate.memories.map(memory => memory.id), ['supported-owned-copy']);
  assert.ok(candidate.stages.every(stage => stage.status === 'simulated'));
  assert.deepEqual(input.inventory, before);
});

test('battle-checks different owned acquisition phases of one memory skill and preserves early-score safeguards', async () => {
  const input = nativeFixture();
  input.options.compareSupportUpgrades = false;
  input.options.memorySelectionMode = 'opening';
  input.catalog.hifMemoryRoles = { profiles: [] };
  input.catalog.memoryMechanicsGraph.ProduceEffect.push(...Array.from({ length: 4 }, (_, index) => ({ id: 'priority-effect-' + index,
    produceEffectType: 'ProduceEffectType_VocalAddition', effectValueMin: 100, effectValueMax: 100 })));
  input.catalog.memoryAbilities.push(...Array.from({ length: 4 }, (_, index) => ({ gameId: 'priority-bonus-' + index, id: 'priority-bonus-' + index, level: 1, produceSkillId: 'priority-bonus-' + index,
    restrictions: { plan: 'free' }, activationCountRaw: 1, branches: [{ phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0,
      produceEffectId: 'priority-effect-' + index, produceTriggerId: 'priority-start' }] })));
  const skills = ['p_card-03-act-1_042', 'p_card-03-act-3_065', 'p_card-00-men-3_005', 'p_card-03-men-3_058'];
  input.options.desiredSkillIds = [skills[1]];
  input.inventory.memories = skills.map((gameId, index) => ({ id: 'stat-selected-' + index,
    produceCard: { id: gameId, upgradeCount: index === 2 ? 0 : 1, customizes: [] }, produceCardPhaseType: 2,
    abilities: [{ id: 'priority-bonus-' + index, level: 1 }] }));
  input.inventory.memories.push({ id: 'owned-opening-copy', produceCard: { id: skills[1], upgradeCount: 1, customizes: [] }, produceCardPhaseType: 1, abilities: [] });
  input.runs = 2;
  const result = await comparePersonalized({ ...input, memorySearchLimit: 1 });
  const base = result.candidates.find(candidate => candidate.id === result.searchSummary.baseCandidateId);
  const changed = result.candidates.find(candidate => candidate.baseCandidateId === base.id);
  assert.ok(base.memories.some(memory => memory.id === 'owned-opening-copy'));
  assert.ok(!base.memories.some(memory => memory.id === 'stat-selected-1'));
  assert.ok(changed);
  assert.ok(changed.memories.some(memory => memory.id === 'stat-selected-1'));
  assert.equal(changed.memoryChanges.added[0].source, 'owned_inventory');
  assert.deepEqual(changed.scoreSummary.hifModel.memoryRequirements.missing, []);
  assert.equal(changed.stages[0].mappedCards.filter(card => card.source === 'selected_memory').length, 0);
  assert.equal(base.stages[0].mappedCards.filter(card => card.source === 'selected_memory').length, 1);
  assert.equal(changed.stages[0].sampleScores[0].seed, base.stages[0].sampleScores[0].seed);
  assert.equal(changed.stages[4].statistics.runs, base.stages[4].statistics.runs);
  assert.equal(result.searchSummary.simulatedNeighbors, 1);
  assert.equal(result.searchSummary.exhaustive, false);
  if (!changed.memoryComparison.finalMeanImproved) {
    assert.equal(changed.eligibilityForRecommendation, false);
    assert.notEqual(result.recommendedCurrentCandidateId, changed.id);
  }
  const diversified = await comparePersonalized({ ...input, options: { ...input.options, memorySelectionMode: undefined }, runs: 1, memorySearchLimit: 0 });
  const guide = diversified.candidates.find(candidate => candidate.seedModes.includes('guide'));
  const opening = diversified.candidates.find(candidate => candidate.seedModes.includes('opening'));
  assert.ok(guide && opening);
  assert.ok(guide.memories.some(memory => memory.id === 'stat-selected-1'));
  assert.ok(opening.memories.some(memory => memory.id === 'owned-opening-copy'));
  assert.ok(diversified.candidates.some(candidate => candidate.seedModes.includes('stats')));
  assert.ok(diversified.candidates.every(candidate => candidate.stages.every(stage => stage.statistics?.runs === 1)));
});

test('known impossible first-selection bounds exclude a candidate while preserving it as an explicitly unready preview', async () => {
  const input = nativeFixture();
  input.options.compareSupportUpgrades = false;
  input.options.memorySelectionMode = 'guide';
  input.runs = 1;
  const exam = input.catalog.hifExamProfiles.profiles.find(row => row.idolCardId === input.options.idolGameId).examStages[0];
  Object.assign(exam, { isStaticNpcScore: true, npcGroupId: 'test-impossible-first', rankThreshold: 1 });
  input.catalog.hifExamProfiles.npcGroups['test-impossible-first'] = [{ scoreMin: 1e9, scoreMax: 1e9 }];
  const result = await comparePersonalized({ ...input, memorySearchLimit: 0 });
  const candidate = result.candidates[0];
  assert.equal(candidate.stages[0].passBounds.upper, 0);
  assert.equal(candidate.safety.firstSelection.status, 'model_infeasible');
  assert.ok(candidate.safety.infeasibleStages.includes(0));
  assert.equal(candidate.eligibilityForRecommendation, false);
  assert.equal(result.recommendedCandidateId, null);
  assert.equal(result.recommendedBaselineCandidateId, null);
  assert.equal(result.bestPreviewCandidateId, candidate.id);
});

test('summarizes only documented two-round contributions and leaves missing samples unavailable', () => {
  const result = summarizeFinalContribution([{ examIndex: 3, sampleScores: [{ seed: 31, score: 11 }, { seed: 32, score: 20 }] },
    { examIndex: 4, sampleScores: [{ seed: 41, score: 50 }, { seed: 42, score: 100 }] }]);
  assert.deepEqual(result.sampleScores.map(row => row.score), [63, 124]);
  assert.equal(result.statistics.mean, 93.5);
  assert.equal(result.evaluationScoreImplemented, false);
  assert.equal(result.pairingMethod, 'same_sample_index_independent_stage_seeds');
  assert.equal(summarizeFinalContribution([]).statistics, null);
});
