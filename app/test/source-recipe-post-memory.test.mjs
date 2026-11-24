import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildPostProduceMemoryChoice } from '../lib/post-produce-memory-choice.mjs';

const native = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
const IVY = 'i_card-ttmr-3-001', CM = 'i_card-shro-3-007';
const EVE = 'p_card-02-men-2_054', CONFETTI = 'p_card-02-act-2_062', RESET = 'p_card-00-men-3_005';
function setup({ idolId = IVY, triggerId = EVE, requiredOverrides = {}, generic = false } = {}) {
  const idol = native.idolCards.find(row => row.gameId === idolId);
  const reference = native.hifAbilityGuidance.abilities.find(row => row.trigger?.cardIds?.includes(triggerId));
  assert(reference);
  const required = { effectId: reference.effectId, abilityId: reference.abilityId, level: reference.level,
    triggerCardId: triggerId, summaryKo: reference.summaryKo, ...requiredOverrides };
  const policy = { id: 'fixture-source-本番前夜', evidenceStatus: 'source_verified',
    idolIdentities: [{ gameId: idolId, characterId: idol.characterId, titleJa: idol.nameJa.match(/^\[([^\]]+)\]/)?.[1],
      expectedUniqueIds: { ...idol.uniqueIds } }], plan: idol.plan, trainingTypes: [idol.recommendedEffect],
    scenario: 'hif', eventScope: 'ordinary_hif', requirements: { requiresKnownCurrentVariant: true, maxProducerLevel: 75 },
    sourceIds: ['exact-source'], labelKo: '정확 사양 실전 참고', conditions: [],
    roleChanges: { suppressGenericRoles: false, addRoles: [], deprioritizeSkillIds: [] }, selectionRules: [],
    operatingNotes: [], sourceRecipe: { requiredHifEffects: [required], observedConditions: ['실제 대상 카드 확보와 사용 확인'] } };
  const target = { scenario: 'hif', idolGameId: idolId, plan: idol.plan, trainingType: idol.recommendedEffect, producerLevel: 70 };
  const triggerCard = native.skillCards.find(row => row.gameId === triggerId && row.upgradeCount === 0);
  const genericGoal = { id: 'generic-existing', triggerCard: { gameId: triggerId, nameJa: triggerCard.nameJa },
    abilities: [{ abilityId: reference.abilityId, level: reference.level, effectId: reference.effectId }],
    sourceIds: ['generic-source'], recommendation: { priority: 'primary', purpose: '기존 공통 목표' } };
  const catalog = { ...native, multiCreatorGuidance: { sourceProfiles: [] },
    idolRecipePolicies: { sources: [{ id: 'exact-source', title: '정확 사양 작성자', url: 'https://example.test/exact-recipe' }], policies: [policy] },
    hifMemoryRoles: { sources: [], profiles: [{ id: 'fixture-carry', plan: idol.plan, trainingType: idol.recommendedEffect,
      carryRoles: [], conditions: [], sourceIds: [], status: 'conditional_guide_profile' }] },
    hifAbilityGuidance: { ...native.hifAbilityGuidance,
      profiles: generic ? [{ id: 'generic-profile', plan: idol.plan, trainingType: idol.recommendedEffect,
        sourceIds: ['generic-source'], goals: [genericGoal] }] : [],
      sources: [{ id: 'generic-source', url: 'https://example.test/generic' }] } };
  const inventory = { idolCards: [{ gameId: idolId, levelLimitRank: 3, potentialRank: 3 }], memories: [] };
  const memory = (id, extra = {}) => ({ id, produceCard: { id: RESET, upgradeCount: 0, customizes: [] }, produceCardPhaseType: 2,
    abilities: [{ id: reference.abilityId, level: reference.level }], ...extra });
  const targetMemory = { id: 'explicit-future-target', modelEffects: { carriedSkill: { id: triggerId,
    obtainable: true, upgrade: 0, phase: { availableAtStart: false, code: 2 } } } };
  const run = (extra = {}) => buildPostProduceMemoryChoice({ catalog, inventory, target, ...extra });
  return { catalog, inventory, target, reference, required, policy, memory, targetMemory, run };
}
const abilityGoals = result => result.creationGoals.filter(goal => goal.kind === 'hif_ability');

test('active exact Ivy source recipe adds a deterministic native HIF goal without forcing its target as the carried skill', () => {
  const f = setup();
  const before = JSON.stringify({ catalog: f.catalog, inventory: f.inventory, target: f.target });
  const first = f.run(), again = f.run();
  const [goal] = abilityGoals(first);
  assert.equal(abilityGoals(first).length, 1);
  assert.ok(goal.id.startsWith('hif:source:fixture-source-本番前夜:'));
  assert.equal(goal.id, abilityGoals(again)[0].id);
  assert.equal(goal.triggerCard.gameId, EVE);
  assert.equal(goal.nativeReferenceMatched, true);
  assert.equal(goal.carrierSkillUnrestricted, true);
  assert.equal(goal.requiredCarriedSkillId, null);
  assert.equal(goal.activationConfirmed, false);
  assert.equal(goal.guaranteedCreation, false);
  assert.ok(first.creationGoals.every(item => item.id !== `carry:${EVE}`));
  assert.ok(first.sources.some(source => source.url === 'https://example.test/exact-recipe'));
  assert.equal(JSON.stringify({ catalog: f.catalog, inventory: f.inventory, target: f.target }), before);
});

test('actual owned ability on another carried skill stays conditional until the future trigger deck is supplied', () => {
  const f = setup();
  f.inventory.memories = [f.memory('owned-reset-carrier')];
  const absent = abilityGoals(f.run())[0];
  assert.equal(absent.triggerAvailability, 'conditional_during');
  assert.deepEqual(absent.ownedFulfilledMemoryIds, []);
  assert.deepEqual(absent.ownedConditionalMemoryIds, ['owned-reset-carrier']);
  const present = abilityGoals(f.run({ options: { targetMemories: [f.targetMemory] } }))[0];
  assert.equal(present.triggerAvailability, 'after_selection_1');
  assert.deepEqual(present.ownedFulfilledMemoryIds, ['owned-reset-carrier']);
  assert.deepEqual(present.ownedConditionalMemoryIds, []);
  assert.equal(present.activationConfirmed, false);
  assert.equal(f.inventory.memories[0].produceCard.id, RESET);
});

test('merely carrying 本番前夜 does not fulfill its separate source HIF ability goal', () => {
  const f = setup();
  f.inventory.memories = [f.memory('eve-no-ability', { produceCard: { id: EVE, upgradeCount: 0, customizes: [] }, abilities: [] })];
  const [goal] = abilityGoals(f.run());
  assert.deepEqual(goal.ownedFulfilledMemoryIds, []);
  assert.deepEqual(goal.ownedConditionalMemoryIds, []);
});

test('missing ability or customization completeness cannot fulfill a source recipe crafting goal', () => {
  const f = setup();
  f.inventory.memories = [f.memory('unknown-abilities', { raw: { produceCard: { id: RESET, upgradeCount: 0, customizes: [] } } }),
    f.memory('unknown-customs', { raw: { produceCard: { id: RESET, upgradeCount: 0 }, abilities: [{ id: f.reference.abilityId, level: f.reference.level }] } })];
  const [goal] = abilityGoals(f.run({ options: { targetMemories: [f.targetMemory] } }));
  assert.deepEqual(goal.ownedFulfilledMemoryIds, []);
  assert.deepEqual(goal.ownedConditionalMemoryIds.sort(), ['unknown-abilities', 'unknown-customs']);
});

test('source recipe goals respect exact P-card, scenario, ordinary-event scope, and maximum PLv gates', () => {
  const f = setup();
  for (const target of [{ ...f.target, scenario: 'nia' }, { ...f.target, idolGameId: 'i_card-hrnm-3-002' },
    { ...f.target, eventModeId: 'asari_2026_10_30' }, { ...f.target, producerLevel: 76 }]) {
    assert.deepEqual(abilityGoals(f.run({ target })), []);
  }
});

test('wrong native ability level, effect, trigger, or missing master branch does not manufacture a source goal', () => {
  for (const requiredOverrides of [{ level: 2 }, { effectId: 'not-the-native-effect' }, { triggerCardId: RESET }]) {
    assert.deepEqual(abilityGoals(setup({ requiredOverrides }).run()), []);
  }
  const f = setup();
  f.catalog.memoryAbilities = f.catalog.memoryAbilities.filter(row => (row.id ?? row.gameId) !== f.reference.abilityId);
  assert.deepEqual(abilityGoals(f.run()), []);
});

test('an existing generic goal is deduplicated by native effect or exact ability while retaining both source URLs', () => {
  const f = setup({ generic: true });
  const [goal] = abilityGoals(f.run());
  assert.equal(abilityGoals(f.run()).length, 1);
  assert.equal(goal.id, 'hif:generic-existing');
  assert.deepEqual(goal.sourceIds.sort(), ['exact-source', 'generic-source']);
  assert.equal(goal.sourceRecipes[0].id, f.policy.id);
  assert.ok(f.run().sources.some(source => source.url === 'https://example.test/generic'));
  assert.ok(f.run().sources.some(source => source.url === 'https://example.test/exact-recipe'));
});

test('effect aliases retain the exact required ability and an active character requirement can override a generic low-priority goal', () => {
  const f = setup({ generic: true });
  const generic = f.catalog.hifAbilityGuidance.profiles[0].goals[0];
  generic.abilities[0].abilityId = 'other-generic-label-for-this-effect';
  generic.recommendation.priority = 'low_priority';
  f.inventory.memories = [f.memory('actual-ability-on-reset')];
  const [goal] = abilityGoals(f.run({ options: { targetMemories: [f.targetMemory] } }));
  assert.equal(abilityGoals(f.run()).length, 1);
  assert.equal(goal.id, 'hif:generic-existing');
  assert.ok(goal.abilities.some(ability => ability.abilityId === f.reference.abilityId && ability.level === f.reference.level));
  assert.deepEqual(goal.ownedFulfilledMemoryIds, ['actual-ability-on-reset']);
  assert.equal(goal.nativeReferenceMatched, true);
});

test('Cm native confetti requirement is shown as an HIF crafting goal even on an unrelated carried card', () => {
  const f = setup({ idolId: CM, triggerId: CONFETTI });
  const candidates = [{ ...f.memory('new-reset-with-confetti-ability'), candidateId: 'new-reset-with-confetti-ability',
    kind: 'hif', abilitiesComplete: true, customizationsComplete: true }];
  const result = f.run({ candidates });
  const [goal] = abilityGoals(result);
  assert.equal(goal.triggerCard.gameId, CONFETTI);
  assert.equal(goal.abilities[0].abilityId, f.reference.abilityId);
  assert.equal(result.candidates[0].skill.id, RESET);
  assert.ok(result.candidates[0].hifAssessment.effects[0].sourceGoals.some(source => source.id.startsWith('source:')));
  assert.ok(result.candidates[0].sourceAdvice.goalIds.includes(goal.id));
  assert.deepEqual(result.candidates[0].hifAssessment.triggerReadyEffectIds, []);
  assert.equal(result.candidates[0].hifAssessment.activationConfirmed, false);
  assert.equal(result.comparisonRules.skillWeightsAdded, false);
});
