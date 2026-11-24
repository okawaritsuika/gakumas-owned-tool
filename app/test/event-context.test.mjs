import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildPersonalizedPlan } from '../lib/personalized-plan.mjs';
import { summarizeMemoryEffects } from '../lib/memory-effects.mjs';
import { buildEventContext, buildEventUnlockOverrides, getTrustedEventUnlockOverrides, getEventAdditionalAppearanceCandidates } from '../lib/event-context.mjs';

function fixture() {
  const mode = { id: 'asari-test', family: 'asari', nameKo: '아사리 시험', supportedPlans: ['anomaly'],
    supportedScenarios: ['hif'], supportedTrainingTypes: ['fullPower', 'strength'], sourceIds: ['official'],
    rental: { kind: 'produce_memory', slotLimit: 1, totalMemorySlots: 4, baseDailyLimit: 3, plvRestrictionWaived: true,
      phase: 'selected_memory_original_phase', availableRentalSkillIds: null },
    rules: { plvAppearanceWaived: true, plvRentalWaived: true, skillSwitchUnlockWaived: false, crossPlanRentalAllowed: false, crossPlanAdditionalAppearance: true },
    memoryGoals: [{ gameId: 'late', nameKo: '후반 카드', normalUsePlan: 'anomaly', normalUnlockProducerLevel: 80,
      targetAcquisitionPhase: 1, targetUpgrade: 1, customizationCriteria: { kind: 'exact_count', count: 4 } }], unknowns: ['실제 렌탈 사본 미확인'] };
  return { result: { selectedIdol: { gameId: 'idol', plan: 'anomaly' }, scoreSummary: { scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower' },
    memories: [{ id: 'owned-copy', modelEffects: { carriedSkill: { id: 'late', obtainable: false } } }] },
    inventory: { producerLevel: 70, memories: [{ id: 'owned-copy', produceCard: { id: 'late', upgradeCount: 1 }, produceCardPhaseType: 2, stats: { vocal: 123 } }] },
    catalog: { eventModes: { asOf: '2026-11-04', sources: [{ id: 'official', url: 'https://example.test/official' }], modes: [mode] },
      skillCards: [{ gameId: 'late', plan: 'anomaly', nameKo: '후반 카드', nameJa: '後半カード', upgradeCount: 0, imageUrl: '/late.png', unlockProducerLevel: 80 },
        { gameId: 'logic', plan: 'logic', nameJa: 'ロジック', upgradeCount: 0 }] },
    options: { eventModeId: 'asari-test', eventRentalSkillIds: ['late'], producerLevel: 70 } };
}

test('keeps unknown rental copies and bonuses separate from owned memories and permanent PLv', () => {
  const input = fixture(), before = structuredClone(input), context = buildEventContext(input);
  assert.equal(context.status, 'pending_rules');
  assert.deepEqual(context.validation.acceptedGameIds, []);
  assert.equal(context.recommendationApplied, false);
  assert.equal(context.accountInventoryUnchanged, true);
  assert.equal(context.selectedSkills[0].owned, false);
  assert.equal(context.selectedSkills[0].actualRentalSelected, false);
  assert.equal(context.selectedSkills[0].upgradeCount, null);
  assert.equal(context.selectedSkills[0].acquisitionPhase, null);
  assert.deepEqual(context.selectedSkills[0].statBonus, { status: 'unknown', vocal: null, dance: null, visual: null, stamina: null });
  assert.deepEqual(context.selectedSkills[0].ownedMemoryIdsWithSameSkill, ['owned-copy']);
  assert.equal(context.memoryTargets[0].outsideEventProducerLevel, 80);
  assert.equal(context.memoryTargets[0].eventRentalProducerLevelWaived, true);
  assert.equal(context.temporaryProduceConditions.skillSwitchUnlockWaived, false);
  assert.equal(context.rentalRules.remainingUses, null);
  assert.equal(context.rentalRules.baseDailyLimit, 3);
  assert.equal(context.comparison.statDelta, null);
  assert.deepEqual(input, before);
});

test('validates the one rental slot, verified pool and explicit plan/scenario boundaries', () => {
  const input = fixture();
  input.options.eventRentalSkillIds = ['late', 'logic'];
  let context = buildEventContext(input);
  assert.equal(context.status, 'invalid_selection');
  assert.ok(context.validation.issues.some(issue => issue.code === 'event_rental_slot_limit_exceeded'));
  assert.ok(context.validation.issues.some(issue => issue.code === 'event_rental_wrong_plan'));
  input.options.eventRentalSkillIds = ['late'];
  input.catalog.eventModes.modes[0].rental.availableRentalSkillIds = ['logic'];
  assert.ok(buildEventContext(input).validation.issues.some(issue => issue.code === 'skill_not_in_verified_event_pool'));
  input.result.scoreSummary.scenario = 'nia';
  assert.ok(buildEventContext(input).validation.issues.some(issue => issue.code === 'event_scenario_not_supported'));
  input.result.scoreSummary.scenario = 'hif';
  input.result.selectedIdol.plan = 'sense';
  assert.ok(buildEventContext(input).validation.issues.some(issue => issue.code === 'event_plan_not_supported'));
});

test('does not convert additional cross-plan appearances into permission to rent another plan', () => {
  const input = fixture();
  input.options.eventRentalSkillIds = ['logic'];
  input.catalog.eventModes.modes[0].rules.crossPlanRentalAllowed = null;
  const context = buildEventContext(input);
  assert.equal(context.status, 'pending_rules');
  assert.equal(context.temporaryProduceConditions.crossPlanAdditionalAppearance, true);
  assert.ok(context.validation.issues.some(issue => issue.code === 'cross_plan_rental_rule_unknown'));
  assert.equal(context.selectedSkills[0].guideRoleFulfilled, null);
  assert.equal(context.recommendationApplied, false);
});

test('even a verified skill pool does not supply the actual memory phase, customization or stat bonus', () => {
  const input = fixture();
  input.catalog.eventModes.modes[0].rental.availableRentalSkillIds = ['late'];
  const context = buildEventContext(input);
  assert.equal(context.status, 'pending_rules');
  assert.ok(!context.validation.issues.some(issue => issue.code === 'actual_rental_pool_unknown'));
  assert.ok(context.validation.issues.some(issue => issue.code === 'rental_memory_details_required'));
  assert.equal(context.selectedSkills[0].customizations, null);
  assert.equal(context.memoryTargets[0].roleFulfilled, null);
});

test('disables ordinary mode, rejects malformed selections and keeps unknown event rules pending', () => {
  assert.equal(buildEventContext({}).status, 'disabled');
  const input = fixture();
  input.options.eventModeId = null;
  assert.equal(buildEventContext(input).status, 'invalid_selection');
  input.options.eventModeId = 'not-loaded';
  assert.equal(buildEventContext(input).status, 'pending_rules');
  input.options.eventRentalSkillIds = 'late';
  assert.equal(buildEventContext(input).status, 'invalid_selection');
  input.options.eventModeId = 'asari-test';input.options.eventRentalSkillIds = ['late', 'late'];
  assert.ok(buildEventContext(input).validation.issues.some(issue => issue.code === 'duplicate_event_rental_skill'));
});

test('actual Asari source goals are not a rental whitelist or proof of a high-level completed deck', () => {
  const eventModes = JSON.parse(fs.readFileSync(new URL('../data/catalog/event_modes.json', import.meta.url), 'utf8'));
  const mode = eventModes.modes[0], source = fixture();
  source.catalog.eventModes = eventModes;
  source.options = { producerLevel: 70, eventModeId: mode.id, eventRentalSkillIds: ['p_card-03-act-3_189'] };
  source.catalog.skillCards.push({ gameId: 'p_card-03-act-3_189', plan: 'anomaly', upgradeCount: 0, nameJa: '羽ばたけ！', unlockProducerLevel: 0 });
  const output = buildEventContext(source);
  assert.equal(output.status, 'pending_rules');
  assert.equal(output.rentalRules.slotLimit, 1);
  assert.equal(output.rentalRules.totalMemorySlots, 4);
  assert.equal(output.temporaryProduceConditions.plvRentalWaived, true);
  assert.equal(output.temporaryProduceConditions.skillSwitchUnlockWaived, false);
  assert.ok(output.validation.issues.some(issue => issue.code === 'actual_rental_pool_unknown'));
  assert.ok(!output.validation.issues.some(issue => issue.code === 'skill_not_in_verified_event_pool'));
  const goal = output.memoryTargets.find(goal => goal.gameId === 'p_card-03-act-3_189');
  assert.equal(goal.outsideEventProducerLevel, 80);
  assert.equal(goal.normalRequiresSkillSwitch, true);
  assert.equal(goal.roleFulfilled, null);
  assert.ok(output.otherPlanMemoryTargets.every(goal => goal.recommendedForCurrentPlan === false));
  assert.equal(output.recommendationApplied, false);
});

test('issues only catalog-backed event unlock tokens and rejects JSON booleans, copies and another plan or catalog', () => {
  const input = fixture(), before = structuredClone(input), context = { plan: 'anomaly', scenario: 'hif', trainingType: 'fullPower' };
  const token = buildEventUnlockOverrides({ catalog: input.catalog, options: input.options, context });
  assert.ok(Object.isFrozen(token));
  assert.equal(token.producerLevelUnlock, true);
  assert.equal(token.memoryRentalProducerLevelUnlock, true);
  assert.equal(token.skillSwitchUnlockWaived, false);
  assert.equal(token.crossPlanRentalPermissionGranted, false);
  const options = { ...input.options, eventUnlockOverrides: token };
  assert.equal(getTrustedEventUnlockOverrides(options, { ...context, catalog: input.catalog }), token);
  assert.equal(getTrustedEventUnlockOverrides({ ...options, eventUnlockOverrides: structuredClone(token) }, { ...context, catalog: input.catalog }), null);
  assert.equal(getTrustedEventUnlockOverrides({ ...options, eventUnlockOverrides: { validated: true, producerLevelUnlock: true } }, { ...context, catalog: input.catalog }), null);
  assert.equal(getTrustedEventUnlockOverrides(options, { ...context, plan: 'logic', catalog: input.catalog }), null);
  assert.equal(getTrustedEventUnlockOverrides(options, { ...context, scenario: 'nia', catalog: input.catalog }), null);
  assert.equal(getTrustedEventUnlockOverrides(options, { ...context, catalog: structuredClone(input.catalog) }), null);
  assert.equal(getTrustedEventUnlockOverrides({ ...options, eventModeId: 'other' }, { ...context, catalog: input.catalog }), null);
  assert.deepEqual(input, before);
});

test('applies verified appearance permission separately from unconfirmed rental copies without changing actual producer level', () => {
  const input = fixture();
  input.options.eventUnlockOverrides = buildEventUnlockOverrides({ catalog: input.catalog, options: input.options,
    context: { plan: 'anomaly', scenario: 'hif', trainingType: 'fullPower' } });
  const output = buildEventContext(input);
  assert.equal(output.verifiedUnlockRuleApplication.appearanceApplied, true);
  assert.equal(output.verifiedUnlockRuleApplication.rentalLevelPermission, true);
  assert.equal(output.verifiedUnlockRuleApplication.actualRentalInserted, false);
  assert.equal(output.verifiedUnlockRuleApplication.actualProducerLevel, 70);
  assert.equal(output.selectedSkills[0].actualRentalSelected, false);
  assert.equal(output.selectedSkills[0].statBonus.vocal, null);
  assert.equal(output.status, 'pending_rules');
  assert.equal(input.inventory.producerLevel, 70);
});

test('does not issue exceptions outside the exact catalog mode scope or promote unverified source flags', () => {
  const input = fixture(), context = { plan: 'anomaly', scenario: 'hif', trainingType: 'fullPower' };
  assert.equal(buildEventUnlockOverrides({ catalog: input.catalog, options: {}, context }), null);
  assert.equal(buildEventUnlockOverrides({ catalog: input.catalog, options: input.options, context: { ...context, plan: 'sense' } }), null);
  assert.equal(buildEventUnlockOverrides({ catalog: input.catalog, options: input.options, context: { ...context, trainingType: 'motivation' } }), null);
  input.catalog.eventModes.modes[0].rules.plvAppearanceWaived = null;
  const token = buildEventUnlockOverrides({ catalog: input.catalog, options: { ...input.options, producerLevelUnlock: true }, context });
  assert.equal(token.producerLevelUnlock, false);
});

test('exact current-round sense appearances become during-produce candidates while normal carry and the PLv78 switch stay restricted', () => {
  const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
  const idol = catalog.idolCards.find(row => row.gameId === 'i_card-kllj-3-015');
  const result = { selectedIdol: { ...idol, ownershipVerified: true, owned: { uncap: 0, potentialRank: 0 } },
    scoreSummary: { scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower' }, memories: [] };
  const inventory = { producerLevel: 70, memories: [] };
  const options = { eventModeId: 'asari_2026_10_30', producerLevel: 70, scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower',
    skillCardSwitchSettings: { 'p_card-01-act-3_184': true } };
  options.eventUnlockOverrides = buildEventUnlockOverrides({ catalog, options, context: { plan: 'anomaly', scenario: 'hif', trainingType: 'fullPower' } });
  assert.equal(getEventAdditionalAppearanceCandidates(options, { catalog, plan: 'anomaly', scenario: 'hif' }).length, 10);
  const plan = buildPersonalizedPlan({ result, inventory, catalog, options });
  const national = plan.cardAccess.find(row => row.gameId === 'p_card-01-men-3_006');
  assert.equal(national.normalAcquisition.eligible, true);
  assert.equal(national.normalAcquisition.eventAdditionalAppearance, true);
  assert.equal(national.memoryCarry.planEligible, false);
  assert.equal(national.memoryCarry.eligible, false);
  assert.ok(plan.midgamePlan.acquisitionTargets.some(row => row.gameId === national.gameId));
  const withoutEvent = buildPersonalizedPlan({ result, inventory, catalog, options: { producerLevel: 70 } });
  assert.ok(!withoutEvent.midgamePlan.acquisitionTargets.some(row => row.gameId === national.gameId));
  const borrowed = { id: 'sense-copy', produceCard: { id: national.gameId, upgradeCount: 0, customizes: [] }, produceCardPhaseType: 1, abilities: [] };
  const effects = summarizeMemoryEffects(borrowed, catalog, options).carriedSkill;
  assert.equal(effects.planCompatible, false);
  assert.equal(effects.obtainable, false);
  assert.equal(effects.generationPlanCompatible, true);
  assert.equal(effects.generationObtainable, true);
  const unlisted = catalog.skillCards.find(row => row.nameJa === '深呼吸' && row.upgradeCount === 0);
  const outsidePool = summarizeMemoryEffects({ ...borrowed, produceCard: { ...borrowed.produceCard, id: unlisted.gameId } }, catalog, options).carriedSkill;
  assert.equal(outsidePool.generationPlanCompatible, false);
  const output = buildEventContext({ result, inventory, catalog, options });
  assert.equal(output.acquisitionCandidates.length, 10);
  assert.equal(output.acquisitionCandidates.filter(row => row.availability === 'eligible').length, 9);
  assert.equal(output.acquisitionCandidates.find(row => row.gameId === 'p_card-01-act-3_184').availability, 'locked');
  const useful = output.acquisitionCandidates.find(row => row.gameId === national.gameId);
  assert.ok(useful.effectRole.generalEffects.includes('repeat_next_card'));
  assert.ok(useful.useConditions.some(text => text.includes('호조 1')));
  assert.equal(useful.usageConditionStatus, 'check_actual_resources_and_deck');
  assert.equal(output.itemEffects.nativeEffectChainVerified, true);
  assert.equal(output.itemEffects.automaticAtProduceStartByRule, true);
  assert.equal(output.itemEffects.fixedVoDaViBonusApplied, false);
  assert.equal(output.itemEffects.effectRole.scope, 'exam_only');
  assert.equal(inventory.producerLevel, 70);
});
