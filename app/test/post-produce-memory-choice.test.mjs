import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { loadCatalog } from '../lib/catalog.mjs';
import { normalizeSnapshot } from '../lib/inventory.mjs';
import { buildPostProduceMemoryChoice, buildPostMemoryChoiceOptions } from '../lib/post-produce-memory-choice.mjs';

const target = { scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower', producerLevel: 70 };
function fixture() {
  const ability = (id, type, amount) => ({ id, level: 1, restrictions: { plan: 'free' }, produceSkillId: id, produceSkillLevel: 1,
    branches: [{ produceEffectId: `${id}-effect`, produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }],
    effect: { id: `${id}-effect`, produceEffectType: `ProduceEffectType_${type}`, effectValueMin: amount, effectValueMax: amount } });
  const abilities = [ability('vo10', 'VocalAddition', 10), ability('vo30', 'VocalAddition', 30), ability('da30', 'DanceAddition', 30), ability('viGrowth', 'VisualGrowthRateAddition', 21)];
  return { skillCards: ['skill', 'other'].map(id => ({ id, gameId: id, upgradeCount: 0, plan: 'anomaly', name: id, unlockProducerLevel: 1, rentalUnlockProducerLevel: 1 })),
    memoryAbilities: abilities, memoryMechanicsGraph: { ProduceEffect: abilities.map(row => row.effect), ProduceTrigger: [] } };
}
const candidate = (id, abilityIds = [], extra = {}) => ({ candidateId: id, kind: 'normal', produceCard: { id: 'skill', upgradeCount: 0, customizes: [] },
  produceCardPhaseType: 1, abilities: abilityIds.map(id => ({ id, level: 1 })), abilitiesComplete: true, customizationsComplete: true, ...extra });
const choose = (candidates, extra = {}) => buildPostProduceMemoryChoice({ candidates, target, catalog: fixture(), ...extra });

test('same-recipe fixed-stat improvement is recommended without using completed stats or an internal score', () => {
  const result = choose([candidate('old', ['vo10'], { vocal: 9999, dance: 9999, visual: 9999, score: 9999999 }), candidate('new', ['vo30'], { vocal: 1, dance: 1, visual: 1 })]);
  assert.deepEqual(result.recommendedCandidateIds, ['new']);
  assert.equal(result.status, 'recommended');
  assert.deepEqual(result.candidates[1].initialStats, { vo: 30, da: 0, vi: 0 });
  assert.equal(result.candidates[0].evaluationScore, null);
  assert.equal(result.candidates[0].completedStats.vo, 9999);
  assert.equal(result.candidates[0].completedStatsUsedForCarry, false);
  assert.equal(result.coverage.candidateAddedToInventory, false);
});

test('axis and growth tradeoffs do not become a made-up combined skill score', () => {
  const result = choose([candidate('vo', ['vo30']), candidate('da', ['da30']), candidate('growth', ['viGrowth'])]);
  assert.equal(result.status, 'tradeoffs');
  assert.deepEqual(result.recommendedCandidateIds, []);
  assert.deepEqual(result.nonDominatedCandidateIds.sort(), ['da', 'growth', 'vo']);
  assert.equal(result.comparisonRules.skillWeightsAdded, false);
});

test('different carried skills remain separate recipes even when one has greater confirmed numeric bonuses', () => {
  const result = choose([candidate('a', ['vo10']), candidate('b', ['vo30'], { produceCard: { id: 'other', upgradeCount: 0, customizes: [] } })]);
  assert.equal(result.status, 'tradeoffs');
  assert.deepEqual(result.candidates[1].dominates, []);
  assert.deepEqual(result.candidates[1].numericDominates, ['a']);
});

test('missing ability completion, missing custom completion, and unknown kind never mean zero effects or no customization', () => {
  const result = choose([candidate('missing', [], { kind: 'unknown', abilitiesComplete: false, customizationsComplete: false })]);
  const row = result.candidates[0];
  assert.equal(result.status, 'insufficient_data');
  assert.deepEqual(row.initialStats, { vo: null, da: null, vi: null });
  assert.equal(row.recipeKnown, false);
  assert.equal(row.kind, 'unknown');
  assert.equal(row.completeForComparison, false);
  assert.ok(row.unknowns.length >= 3);
});

test('complete empty ability and customization lists are explicit zero and no-customization values', () => {
  const result = choose([candidate('empty')]);
  assert.deepEqual(result.candidates[0].initialStats, { vo: 0, da: 0, vi: 0 });
  assert.equal(result.candidates[0].recipeKnown, true);
  assert.equal(result.status, 'recommended');
});

test('a complete ability list with unresolved native effects keeps total bonuses unknown and cannot create numeric dominance', () => {
  for (const unresolved of ['missing-ability', 'missing-effect', 'unknown-effect']) {
    const catalog = fixture();
    if (unresolved !== 'missing-ability') {
      catalog.memoryAbilities.push({ id: unresolved, level: 1, restrictions: { plan: 'free' },
        branches: [{ produceEffectId: unresolved, produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }] });
      if (unresolved === 'unknown-effect') catalog.memoryMechanicsGraph.ProduceEffect.push({ id: unresolved,
        produceEffectType: 'ProduceEffectType_UninterpretedBonus', effectValueMin: 20, effectValueMax: 20 });
    }
    const result = choose([candidate('known', ['vo30']), candidate('unresolved', ['vo10', unresolved])], { catalog });
    const row = result.candidates[1];
    assert.deepEqual(row.knownNativeInitialStats, { vo: 10, da: 0, vi: 0 }, unresolved);
    assert.deepEqual(row.initialStats, { vo: null, da: null, vi: null }, unresolved);
    assert.deepEqual(row.growthRatePermil, { vo: null, da: null, vi: null }, unresolved);
    assert.equal(row.numericBasis.initialStats, 'unknown_total', unresolved);
    assert.equal(row.numericBasis.growthRatePermil, 'unknown_total', unresolved);
    assert.deepEqual(row.numericDominatedBy, [], unresolved);
    assert.deepEqual(result.candidates[0].numericDominates, [], unresolved);
    assert.equal(row.completeForComparison, false, unresolved);
    assert.equal(result.status, 'insufficient_data', unresolved);
  }
});

test('observed three-axis totals can compare unresolved abilities while an unknown carry PLv does not erase resolved native totals', () => {
  const observed = choose([candidate('known', ['vo10']), candidate('observed', ['missing-ability'], {
    confirmedInitialStats: { vo: 30, da: 0, vi: 0 }, confirmedGrowthRatePermil: { vo: 0, da: 0, vi: 0 },
  })]);
  assert.deepEqual(observed.candidates[1].numericDominates, ['known']);
  assert.equal(observed.candidates[1].numericBasis.manualConflict, false);
  assert.equal(observed.candidates[1].completeForComparison, false);
  assert.equal(observed.status, 'insufficient_data');
  const unknownPlv = choose([candidate('known', ['vo10'])], { target: { ...target, producerLevel: null } }).candidates[0];
  assert.equal(unknownPlv.carryReadiness.status, 'unknown');
  assert.deepEqual(unknownPlv.initialStats, { vo: 10, da: 0, vi: 0 });
  assert.equal(unknownPlv.numericBasis.initialStats, 'native_confirmed');
  const conflict = choose([candidate('conflict', ['vo10'], { confirmedInitialStats: { vo: 99, da: 0, vi: 0 } })],
    { target: { ...target, producerLevel: null } }).candidates[0];
  assert.equal(conflict.numericBasis.manualConflict, true);
});

test('manual three-axis values replace native partial totals and preserve unconfirmed ability coverage', () => {
  const result = choose([candidate('manual', ['vo10'], { abilitiesComplete: false, confirmedInitialStats: { vocal: 40, dance: 0, visual: 0 }, confirmedGrowthRatePermil: { vo: 0, da: 0, vi: 21 } })]);
  const row = result.candidates[0];
  assert.equal(row.initialStats.vo, 40);
  assert.equal(row.knownNativeInitialStats.vo, 10);
  assert.equal(row.growthRatePermil.vi, 21);
  assert.equal(row.numericBasis.initialStats, 'manual_input_replaces_native');
  assert.equal(row.completeForComparison, false);
  assert.equal(result.status, 'insufficient_data');
});

test('manual/native conflicts and incomplete direct vectors block comparison rather than silently adding or filling zeros', () => {
  const conflict = choose([candidate('conflict', ['vo10'], { confirmedInitialStats: { vo: 99, da: 0, vi: 0 } })]);
  assert.equal(conflict.candidates[0].numericBasis.manualConflict, true);
  assert.deepEqual(conflict.recommendedCandidateIds, []);
  const missing = choose([candidate('missing', [], { abilitiesComplete: false, confirmedInitialStats: { vo: 1, da: 0 } })]);
  assert.equal(missing.candidates[0].initialStats.vi, null);
  assert.ok(missing.candidates[0].unknowns.some(text => text.includes('3축')));
});

test('locked carry-in stays a future candidate without upgrading the actual producer level', () => {
  const catalog = fixture(); catalog.skillCards[0].rentalUnlockProducerLevel = 71;
  const result = choose([candidate('future', ['vo30'])], { catalog });
  assert.equal(result.candidates[0].carryReadiness.currentCarryReady, false);
  assert.deepEqual(result.futureCandidateIds, ['future']);
  assert.equal(result.target.producerLevel, 70);
  assert.deepEqual(result.recommendedCandidateIds, []);
});

test('a locked future option does not mask the only currently usable reward, while an unknown option still does', () => {
  const catalog = fixture();
  catalog.skillCards[1].rentalUnlockProducerLevel = 71;
  const future = candidate('later', [], { produceCard: { id: 'other', upgradeCount: 0, customizes: [] } });
  const now = candidate('now', ['vo10']);
  const result = choose([now, future], { catalog });
  assert.deepEqual(result.recommendedCandidateIds, ['now']);
  assert.deepEqual(result.futureCandidateIds, ['later']);
  delete catalog.skillCards[1].rentalUnlockProducerLevel;
  assert.equal(choose([now, future], { catalog }).status, 'insufficient_data');
});

test('conditional choices name the early skill and each leading stat, with no completed-stat tiebreak', () => {
  const early = candidate('early', ['vo10']);
  const late = candidate('late', ['da30'], { produceCardPhaseType: 2, vocal: 99999 });
  const result = choose([early, late]);
  const paths = result.recommendation.choicePaths;
  assert.equal(result.status, 'tradeoffs');
  assert.deepEqual(paths.find(path => path.when.includes('첫 시험')).candidateIds, ['early']);
  assert.deepEqual(paths.find(path => path.when.includes('보컬 초기 가산')).candidateIds, ['early']);
  assert.deepEqual(paths.find(path => path.when.includes('댄스 초기 가산')).candidateIds, ['late']);
  assert.deepEqual(choose([early, { ...late, abilitiesComplete: false }]).recommendation.choicePaths, []);
});

test('a reward equivalent to the best owned copy is not an improvement over the collection', () => {
  const owned = [candidate('equal', ['vo30']), candidate('weaker', ['vo10'])];
  const result = choose([candidate('reward', ['vo30'])], { inventory: { memories: owned } });
  assert.equal(result.candidates[0].ownedComparison.status, 'equivalent_existing_copy');
  assert.deepEqual(result.candidates[0].ownedComparison.improvedOwnedMemoryIds, ['weaker']);
});

test('a confirmed empty ability list conflicts with a claim to carry an HIF-only ability', () => {
  const result = choose([candidate('conflict', [], { kind:'hif' })]);
  assert.equal(result.status,'insufficient_data');
  assert.equal(result.candidates[0].kindEvidence.conflict,true);
});

test('an existing better and equivalent copy are identified without treating the new candidate as owned', () => {
  const owned = [candidate('owned-better', ['vo30']), candidate('owned-equal', ['vo10'])].map(row => ({ ...row, id: row.candidateId }));
  const result = choose([candidate('new', ['vo10'])], { inventory: { memories: owned } });
  const row = result.candidates[0];
  assert.equal(row.ownedComparison.status, 'existing_copy_better');
  assert.deepEqual(row.ownedComparison.dominatingOwnedMemoryIds, ['owned-better']);
  assert.deepEqual(row.ownedComparison.equivalentOwnedMemoryIds, ['owned-equal']);
  assert.equal(row.candidateIsOwnedRecord, false);
  assert.equal(row.ownedComparison.candidateOwnershipGranted, false);
});

test('complete captured owned lists need no manual kind or completeness fields for existing-copy comparison', () => {
  const result = choose([candidate('new', ['vo10'])], { inventory: { memories: [{ id: 'owned', produceCard: { id: 'skill', upgradeCount: 0, customizes: [] },
    produceCardPhaseType: 1, abilities: [{ id: 'vo30', level: 1 }] }] } });
  assert.equal(result.candidates[0].ownedComparison.status, 'existing_copy_better');
  assert.deepEqual(result.candidates[0].ownedComparison.dominatingOwnedMemoryIds, ['owned']);
});

test('selection checkpoints are explicitly excluded and PrimaStella does not classify HIF memories', () => {
  const result = choose([candidate('checkpoint', [], { kind: 'selection_checkpoint' }), candidate('ordinary', [], { isPrimaStella: true })]);
  assert.equal(result.candidates[0].kind, 'checkpoint');
  assert.equal(result.candidates[0].carryReadiness.status, 'unsupported_candidate_kind');
  assert.equal(result.candidates[0].carryReadiness.currentCarryReady, null);
  assert.equal(result.candidates[1].kind, 'normal');
  assert.equal(result.candidates[1].kindEvidence.isPrimaStellaUsedForClassification, false);
  assert.deepEqual(result.recommendedCandidateIds, ['ordinary']);
});

const realCatalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
realCatalog.multiCreatorGuidance = JSON.parse(fs.readFileSync(new URL('../data/catalog/multi_creator_guidance.json', import.meta.url), 'utf8'));
const settingGoal = realCatalog.hifAbilityGuidance.profiles.find(profile => profile.id === 'anomaly_full_power').goals.find(goal => goal.triggerCard.gameId === 'p_card-03-men-1_051');
const hifAbility = settingGoal.abilities[0];
const settingCandidate = (id, hasHif, extra = {}) => candidate(id, [], { kind: hasHif ? 'hif' : 'normal',
  produceCard: { id: 'p_card-03-men-1_051', upgradeCount: 0, customizes: [] }, produceCardPhaseType: 2,
  abilities: hasHif ? [{ id: hifAbility.abilityId, level: hifAbility.level }] : [], ...extra });

test('real 30% and 60% recovery abilities stay tradeoffs despite a higher fixed-stat bonus', () => {
  const low = 'memory_ability-p_memory_skill-common-p_trigger-end_lesson-lesson_dance-stamina_recover_fix-01-001-001';
  const high = 'memory_ability-p_memory_skill-common-p_trigger-end_lesson-lesson_dance-stamina_recover_fix-03-001-001';
  const vo = 'ability-p_cd-memory-vocal-1000-001-p_memory_skill-common-p_trigger-produce_start-initial-vocal_addition-03-001';
  const make = (id, abilities) => candidate(id, abilities, { produceCard: { id: 'p_card-00-men-2_012', upgradeCount: 0, customizes: [] } });
  const context = { catalog: realCatalog, target: { scenario: 'hif', plan: 'sense', trainingType: 'concentration', producerLevel: 70 } };
  const result = choose([make('recover60', [high]), make('vo20-recover30', [low, vo])], context);
  assert.equal(result.status, 'tradeoffs');
  assert.deepEqual(result.recommendedCandidateIds, []);
  assert.ok(result.candidates.every(row => !row.dominates.length && !row.equivalentTo.length));
  const sameStats = choose([make('recover60', [high]), make('recover30', [low])], context);
  assert.ok(sameStats.candidates.every(row => !row.equivalentTo.length));
  const sameRecovery = choose([make('recover30', [low]), make('vo20-recover30', [low, vo])], context);
  assert.deepEqual(sameRecovery.recommendedCandidateIds, ['vo20-recover30']);
});

test('unpriced production effects preserve native level, limits, restrictions, uniqueness and branch multiplicity', () => {
  for (const difference of ['level', 'probability', 'limit', 'restriction', 'unique', 'multiplicity']) {
    const catalog = fixture();
    const effect = { id: 'recover', produceEffectType: 'ProduceEffectType_StaminaRecoverFix', effectValueMin: 4, effectValueMax: 4 };
    const branch = { produceEffectId: effect.id, produceTriggerId: 'lesson', phaseType: 'ProducePhaseType_EndLesson', activationRatePermilRaw: 300 };
    const first = { id: 'recover-one', level: 1, restrictions: { plan: 'free' }, activationCountRaw: 1, isUniqueActivation: false, branches: [{ ...branch }] };
    const second = { ...first, id: 'recover-two', restrictions: { ...first.restrictions }, branches: [{ ...branch }] };
    if (difference === 'level') { second.id = first.id; second.level = 2; }
    if (difference === 'probability') second.branches[0].activationRatePermilRaw = 600;
    if (difference === 'limit') second.activationCountRaw = 2;
    if (difference === 'restriction') second.restrictions.plan = 'anomaly';
    if (difference === 'unique') second.isUniqueActivation = true;
    if (difference === 'multiplicity') second.branches.push({ ...branch });
    catalog.memoryAbilities.push(first, second);
    catalog.memoryMechanicsGraph.ProduceEffect.push(effect);
    const secondCandidate = candidate('second', ['vo30'], { abilities: [{ id: second.id, level: second.level }, { id: 'vo30', level: 1 }] });
    const result = choose([candidate('first', [first.id]), secondCandidate], { catalog });
    assert.equal(result.status, 'tradeoffs', difference);
    assert.ok(result.candidates.every(row => !row.dominates.length && !row.equivalentTo.length), difference);
  }
});

test('a source-verified HIF target carried in the candidate is conditional on use and independent of the carrier phase', () => {
  const result = choose([settingCandidate('plain', false), settingCandidate('hif', true)], { catalog: realCatalog });
  assert.deepEqual(result.recommendedCandidateIds, ['hif']);
  const effect = result.candidates[1].hifAssessment.effects[0];
  assert.equal(effect.targetAvailability, 'after_selection_1');
  assert.equal(effect.targetRequirementSatisfied, true);
  assert.equal(effect.activationConfirmed, false);
  assert.equal(effect.registrationTiming.independentOfCarriedSkillPhase, true);
  assert.equal(result.candidates[1].hifAssessment.numericAbilityWeightApplied, false);
  assert.ok(effect.sourceGoals[0].sourceTiming);
});

test('outside HIF, only the HIF ability is inapplicable and a HIF-produced memory is not prohibited', () => {
  const result = choose([settingCandidate('plain', false), settingCandidate('hif', true)], { catalog: realCatalog, target: { ...target, scenario: 'nia' } });
  const row = result.candidates[1];
  assert.equal(row.carryReadiness.status, 'ready');
  assert.equal(row.hifAssessment.effects[0].applies, false);
  assert.equal(row.hifAssessment.effects[0].targetAvailability, 'inapplicable');
  assert.deepEqual(row.dominates, []);
  assert.equal(result.status, 'tradeoffs');
  assert.deepEqual(result.recommendedCandidateIds, []);
});

test('a HIF kind is not an automatic advantage and an absent trigger does not count as a ready effect', () => {
  const noTrigger = settingCandidate('hif', true, { produceCard: { id: 'p_card-00-men-3_005', upgradeCount: 0, customizes: [] } });
  const plain = { ...noTrigger, candidateId: 'plain', kind: 'normal', abilities: [] };
  const result = choose([plain, noTrigger], { catalog: realCatalog });
  const row = result.candidates[1];
  assert.equal(row.hifAssessment.effects[0].targetAvailability, 'conditional_during');
  assert.deepEqual(row.hifAssessment.triggerReadyEffectIds, []);
  assert.ok(row.hifAssessment.conditionalEffectIds.length);
  assert.equal(result.status, 'tradeoffs');
  assert.deepEqual(result.recommendedCandidateIds, []);
});

test('normal-kind input conflicting with a native HIF-only ability is marked unknown', () => {
  const result = choose([settingCandidate('conflict', true, { kind: 'normal' })], { catalog: realCatalog });
  assert.equal(result.candidates[0].kind, 'unknown');
  assert.equal(result.candidates[0].kindEvidence.conflict, true);
  assert.equal(result.status, 'insufficient_data');
});

test('unknown-kind input can be positively identified by exact native HIF restrictions but never by a missing effect', () => {
  const result = choose([settingCandidate('observed', true, { kind: 'unknown' }), settingCandidate('unknown', false, { kind: 'unknown' })], { catalog: realCatalog });
  assert.equal(result.candidates[0].kind, 'hif');
  assert.equal(result.candidates[1].kind, 'unknown');
});

test('candidate identities are distinct from owned records and duplicate candidate identifiers are rejected', () => {
  assert.throws(() => choose([candidate('same'), candidate('same')]), /unique/);
  assert.throws(() => buildPostProduceMemoryChoice({ candidates: {} }), /array/);
});

test('picker matches HIF native ability ID and exact level and does not invent skill-customization compatibility', () => {
  const result = buildPostMemoryChoiceOptions({ catalog: realCatalog, skillId: 'p_card-03-act-1_042' });
  assert.equal(result.hifAbilities.length, 115);
  assert.ok(result.hifAbilities.every(row => row.hifReferenceMatched));
  assert.ok(result.hifAbilities.every(row => row.triggerCards.length && row.effectSummary));
  assert.ok(result.hifAbilities.some(row => row.id === hifAbility.abilityId && row.level === hifAbility.level));
  assert.deepEqual(result.customizations.choices, []);
  assert.equal(result.customizations.emptyChoicesMeansNoCustomizationsAvailable, false);
  assert.equal(result.customizations.status, 'applicability_unverified_in_loaded_catalog');
});

test('creation goals are returned before any uncollected post-produce candidates are entered', () => {
  const result = choose([], { catalog: realCatalog });
  assert.equal(result.status, 'no_candidates');
  assert.ok(result.creationGoals.length >= 6);
  const stacking = result.creationGoals.find(goal => goal.id === 'carry:p_card-03-act-1_042');
  assert.equal(stacking.requiredPhase, 1);
  assert.equal(stacking.customizationCriteria.nativeGrowEffectType, 'ProduceCardGrowEffectType_LessonCountAdd');
  assert.equal(stacking.guaranteedCreation, false);
  const hif = result.creationGoals.find(goal => goal.kind === 'hif_ability');
  assert.ok(hif.sourceTiming);
  assert.ok(hif.sourceIds.length);
  assert.equal(hif.activationConfirmed, false);
  assert.equal(result.coverage.candidateCollectionCaptured, false);
});

test('purpose-conditional advice identifies an unfilled owned guide role without declaring a winner across recipes', () => {
  const catalog = fixture();
  catalog.hifMemoryRoles = { profiles: [{ id: 'source', scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower', sourceIds: ['source'],
    conditions: ['원문 완성 루프 조건은 별도로 확인'], carryRoles: ['skill', 'other'].map(gameId => ({ gameId, purpose: `${gameId} 역할`, requiredAcquisitionPhaseForEarlyRole: 1 })) }], sources: [{ id: 'source', url: 'https://example.test/source' }] };
  const inventory = { memories: [{ id: 'owned', produceCard: { id: 'skill', upgradeCount: 0, customizes: [] }, produceCardPhaseType: 1, abilities: [{ id: 'vo10', level: 1 }] }] };
  const result = choose([candidate('existing-role', ['vo10']), candidate('new-role', ['vo10'], { produceCard: { id: 'other', upgradeCount: 0, customizes: [] } })], { catalog, inventory });
  assert.equal(result.status, 'tradeoffs');
  assert.deepEqual(result.recommendedCandidateIds, []);
  assert.deepEqual(result.candidates[0].sourceAdvice.fillsMissingOwnedGuideRoleIds, []);
  assert.deepEqual(result.candidates[1].sourceAdvice.fillsMissingOwnedGuideRoleIds, ['other']);
  const advice = result.conditionalAdvice.items.find(item => item.candidateId === 'new-role');
  assert.ok(advice.why.some(text => text.includes('없는 공략 반입 역할')));
  assert.deepEqual(advice.sourceIds, ['source']);
  assert.equal(result.conditionalAdvice.rankedByScalar, false);
});

test('creator crafting goals require the opening phase, both exact customs, and the exact twice-per-exam action-only HIF ability', () => {
  const profile = realCatalog.multiCreatorGuidance.sourceProfiles.find(profile => profile.sourceId === '5-uzsuXxW8U');
  const customs = profile.rules.find(rule => rule.customizationTargets?.length).customizationTargets;
  const ability = profile.rules.find(rule => rule.abilityTarget).abilityTarget;
  const complete = candidate('complete', [], { kind: 'hif', produceCard: { id: 'p_card-03-act-1_042', upgradeCount: 1,
    customizes: customs.map(custom => ({ id: custom.id, customizeCount: custom.count })) }, abilities: [{ id: ability.abilityId, level: ability.level }] });
  const late = { ...complete, candidateId: 'late', produceCardPhaseType: 2 };
  const noGrowth = { ...complete, candidateId: 'no-growth', produceCard: { ...complete.produceCard, customizes: complete.produceCard.customizes.slice(0, 1) } };
  const noHif = { ...complete, candidateId: 'no-hif', kind: 'normal', abilities: [] };
  const result = choose([complete, late, noGrowth, noHif], { catalog: realCatalog, target: { ...target, idolGameId: 'i_card-kllj-3-015', eventModeId: 'asari_2026_10_30' } });
  const goal = result.creationGoals.find(goal => goal.kind === 'creator_carried_recipe');
  assert.equal(goal.requiredPhase, 1);
  assert.equal(goal.customizationTargets.length, 2);
  assert.equal(goal.hifAbilityTarget.perExamActivationLimit, 2);
  assert.equal(goal.hifAbilityTarget.drawGranted, false);
  assert.equal(goal.hifAbilityTarget.nativeReferenceMatched, true);
  assert.equal(goal.sourceApplicability, 'historical_event_crafting_reference');
  assert.equal(goal.strictCandidateRankingChanged, false);
  const checks = Object.fromEntries(result.candidates.map(row => [row.candidateId, row.sourceAdvice.creatorGoalAssessments[0]]));
  assert.equal(checks.complete.recipeStatus, 'fulfilled');
  assert.equal(checks.complete.currentSourceContextVerified, false);
  assert.equal(checks.complete.activationConfirmed, false);
  assert.equal(checks.late.recipeStatus, 'missing');
  assert.equal(checks['no-growth'].recipeStatus, 'missing');
  assert.equal(checks['no-hif'].recipeStatus, 'missing');
  assert.ok(checks.late.checks.some(check => check.kind === 'opening_phase' && check.passed === false));
  assert.ok(result.sources.some(source => source.id === '5-uzsuXxW8U'));
});

test('creator full-power targets are not generalized to logic or NIA and do not change strict Pareto winners', () => {
  const noCandidate = choose([], { catalog: realCatalog, target: { ...target, plan: 'logic', trainingType: 'motivation' } });
  assert.ok(noCandidate.creationGoals.every(goal => goal.kind !== 'creator_carried_recipe'));
  const nia = choose([], { catalog: realCatalog, target: { ...target, scenario: 'nia' } });
  assert.ok(nia.creationGoals.every(goal => goal.kind !== 'creator_carried_recipe'));
  const rows = [settingCandidate('plain', false), settingCandidate('hif', true)];
  const withCreator = choose(rows, { catalog: realCatalog });
  const withoutCreator = choose(rows, { catalog: { ...realCatalog, multiCreatorGuidance: undefined } });
  assert.deepEqual(withCreator.recommendedCandidateIds, withoutCreator.recommendedCandidateIds);
});

test('an exact target idol cannot be used to validate a contradictory target plan', () => {
  assert.throws(() => choose([], { catalog: realCatalog, target: { ...target, idolGameId: 'i_card-kllj-3-015', plan: 'sense' } }), /플랜/);
});

test('a display-only empty ability list from a partial owned snapshot does not prove an equivalent zero-effect copy', () => {
  const produceCard = { id: 'p_card-00-men-3_005', upgradeCount: 0, customizes: [] };
  const missingAbilities = { userMemoryId: 'incomplete-owned', produceCard, produceCardPhaseType: 1 };
  const normalizeOwned = row => normalizeSnapshot({ schemaVersion: 1, capture: { collections: {
    userMemoryList: { status: 'partial', expectedCount: 1, exportedCount: 1 },
  } }, userMemoryList: [row] }, realCatalog);
  const inventory = normalizeOwned(missingAbilities);
  assert.equal(inventory.collectionStatus.memories, 'partial');
  assert.deepEqual(inventory.memories[0].abilities, []);
  assert.equal(Object.hasOwn(inventory.memories[0].raw, 'abilities'), false);

  const compareOwned = ownedInventory => choose([candidate('new', [], { produceCard })], {
    catalog: realCatalog, inventory: ownedInventory,
  }).candidates[0].ownedComparison;
  const unknown = compareOwned(inventory);
  assert.equal(unknown.sameRecipeOwnedCount, 1);
  assert.equal(unknown.status, 'tradeoffs_or_unknown');
  assert.deepEqual(unknown.equivalentOwnedMemoryIds, []);
  assert.deepEqual(unknown.improvedOwnedMemoryIds, []);
  assert.deepEqual(unknown.dominatingOwnedMemoryIds, []);

  // An explicitly captured empty list is a different, confirmed observation.
  const explicitNone = compareOwned(normalizeOwned({ ...missingAbilities, abilities: [] }));
  assert.equal(explicitNone.status, 'equivalent_existing_copy');
  assert.deepEqual(explicitNone.equivalentOwnedMemoryIds, ['incomplete-owned']);
});
