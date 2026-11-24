import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../lib/recommend.mjs';
import { loadCatalog } from '../lib/catalog.mjs';
import { fileURLToPath } from 'node:url';
import { buildPersonalizedPlan } from '../lib/personalized-plan.mjs';

function fixture() {
  const amounts = { core: 10, preferred: 0, lowered: 300, avoided: 400, neutral: 200, spare: 100 };
  const abilities = Object.entries(amounts).map(([id, value]) => ({ id: 'bonus-' + id, level: 1, produceSkillId: 'bonus-' + id, produceSkillLevel: 1,
    restrictions: { plan: 'free' }, branches: [{ produceEffectId: 'effect-' + id, produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }],
    _effect: { id: 'effect-' + id, produceEffectType: 'ProduceEffectType_VocalAddition', effectValueMin: value, effectValueMax: value } }));
  const catalog = { supportCards: [], idolCards: ['exact', 'other'].map(gameId => ({ gameId, nameJa: gameId === 'exact' ? '[Exact] Character' : '[Other] Character',
    characterId: 'character', plan: 'sense', baseStats: { baseVoDaVi: { vo: 50, da: 50, vi: 50 }, growthRatePermil: { vo: 0, da: 0, vi: 0 } }, specialTrainingStages: [], awakeningStages: [] })),
    skillCards: Object.keys(amounts).map(gameId => ({ gameId, upgradeCount: 0, plan: 'sense', name: gameId, actions: '', unlockProducerLevel: 0, rentalUnlockProducerLevel: 0 })),
    memoryAbilities: abilities, memoryMechanicsGraph: { ProduceEffect: abilities.map(row => row._effect), ProduceTrigger: [] }, calculationModels: {}, excelPresets: [],
    hifMemoryRoles: { sources: [{ id: 'generic', title: 'generic source' }], profiles: [{ id: 'base', plan: 'sense', trainingType: 'concentration', status: 'conditional_guide_profile',
      carryRoles: [{ gameId: 'core', nameKo: 'core' }, { gameId: 'lowered', nameKo: 'lowered' }], conditions: ['원문 일반 조건'], sourceIds: ['generic'] }] },
    idolRecipePolicies: { sources: [{ id: 'specific', title: 'Exact source', url: 'https://example.test/exact', publishedAt: '2026-11-01' }], policies: [{ id: 'exact-policy', evidenceStatus: 'source_verified',
      idolIdentities: [{ gameId: 'exact', characterId: 'character', titleJa: 'Exact' }], scenario: 'hif', plan: 'sense', trainingTypes: ['concentration'], eventScope: 'ordinary_hif', sourceIds: ['specific'],
      roleChanges: { deprioritizeSkillIds: ['lowered'] }, selectionRules: [{ gameId: 'preferred', action: 'prefer', reason: '정확한 원문의 보완 역할', sourceIds: ['specific'] },
        { gameId: 'lowered', action: 'deprioritize', reason: '고유 자원 경쟁', sourceIds: ['specific'] }, { gameId: 'avoided', action: 'avoid', reason: '확인된 고유 조건과 상충', sourceIds: ['specific'] }] }] } };
  const inventory = { producerLevel: 70, idolCards: ['exact', 'other'].map(gameId => ({ gameId, levelLimitRank: 3, potentialRank: 1, currentGrowthRatePermil: { vo: 0, da: 0, vi: 0 } })),
    memories: Object.keys(amounts).map(id => ({ id: 'memory-' + id, produceCard: { id, upgradeCount: 0, customizes: [] }, produceCardPhaseType: 1, abilities: [{ id: 'bonus-' + id, level: 1 }] })) };
  const options = { scenario: 'hif', plan: 'sense', trainingType: 'concentration', idolGameId: 'exact', targetAttribute: 'vocal', secondaryAttribute: 'dance', activityFocus: 'consult', compareSupportUpgrades: false };
  return { catalog, inventory, options };
}
const carried = result => result.memories.map(memory => memory.modelEffects.carriedSkill.id).sort();

test('exact source qualitative choices precede numeric filler without a made-up skill weight', () => {
  const input = fixture(), result = recommend(input);
  assert.deepEqual(carried(result), ['core', 'neutral', 'preferred', 'spare']);
  const profile = result.scoreSummary.hifModel.guideMemoryProfile;
  assert.deepEqual(profile.roles.map(row => row.gameId), ['core']);
  assert.deepEqual(profile.optionalCarryRoles.map(row => row.gameId), ['lowered']);
  assert.equal(profile.characterPolicy.usedForSelection, true);
  assert.equal(profile.characterSelection.numericSkillWeightAdded, false);
  assert.ok(profile.sources.some(source => source.id === 'specific' && source.title === 'Exact source'));
  assert.ok(result.memories.find(memory => memory.modelEffects.carriedSkill.id === 'preferred').characterRecipeMatches.some(rule => rule.action === 'prefer'));
});

test('source avoid is a soft conflict and an explicit desired card still takes priority', () => {
  const input = fixture(), result = recommend({ ...input, options: { ...input.options, desiredSkillIds: ['avoided'] } });
  assert.ok(carried(result).includes('avoided'));
  assert.ok(result.scoreSummary.hifModel.guideMemoryProfile.characterSelection.selectedMatches.some(rule => rule.action === 'avoid'));
  const onlyFour = recommend({ ...input, inventory: { ...input.inventory, memories: input.inventory.memories.filter(memory => !['memory-preferred', 'memory-spare'].includes(memory.id)) } });
  assert.equal(onlyFour.memories.length, 4);
  assert.ok(carried(onlyFour).includes('avoided'));
});

test('the same character in another P-card and another event scope do not inherit the exact recipe policy', () => {
  const input = fixture();
  const other = recommend({ ...input, options: { ...input.options, idolGameId: 'other' } });
  assert.equal(other.scoreSummary.hifModel.guideMemoryProfile.characterPolicy, null);
  assert.ok(carried(other).includes('lowered'));
  assert.ok(!carried(other).includes('preferred'));
  const event = recommend({ ...input, options: { ...input.options, eventModeId: 'asari_fixture' } });
  assert.equal(event.scoreSummary.hifModel.guideMemoryProfile.characterPolicy.applied, false);
  assert.equal(event.scoreSummary.hifModel.guideMemoryProfile.characterPolicy.observations[0].reason, 'event_scope_mismatch');
});

test('an unmet exact-source PLv requirement adds only an inactive explanation and leaves generic selection and scores unchanged', () => {
  const input = fixture(), before = structuredClone(input.catalog.hifMemoryRoles.profiles[0]);
  input.catalog.idolRecipePolicies.policies[0].requirements = { minProducerLevel: 75 };
  const result = recommend(input), profile = result.scoreSummary.hifModel.guideMemoryProfile;
  const control = recommend({ ...input, catalog: { ...input.catalog, idolRecipePolicies: { sources: [], policies: [] } } });
  assert.equal(profile.characterPolicy.applied, false);
  assert.equal(profile.characterPolicy.usedForSelection, false);
  assert.equal(profile.characterPolicy.observations[0].reason, 'requirements_not_met');
  assert.deepEqual(profile.characterSelectionRules, []);
  assert.deepEqual(profile.roles, control.scoreSummary.hifModel.guideMemoryProfile.roles);
  assert.deepEqual(carried(result), carried(control));
  assert.deepEqual(result.scoreSummary.projectedStats, control.scoreSummary.projectedStats);
  assert.deepEqual(input.catalog.hifMemoryRoles.profiles[0], before);
});

test('recommendation and downstream recipes both reject owned training or potential ranks outside the catalog table',()=>{
  const input=fixture(),idol=input.catalog.idolCards.find(card=>card.gameId==='exact');
  idol.specialTrainingStages=[{rank:0},{rank:1}];idol.awakeningStages=[{rank:0},{rank:1}];
  input.catalog.idolRecipePolicies.policies[0].requirements={requiresKnownCurrentVariant:true};
  const owned=input.inventory.idolCards.find(card=>card.gameId==='exact');
  for(const [training,potential] of [[99,99],[99,1],[1,99]]){
    owned.levelLimitRank=training;owned.potentialRank=potential;
    const result=recommend(input),policy=result.scoreSummary.hifModel.guideMemoryProfile.characterPolicy;
    const personal=buildPersonalizedPlan({...input,result});
    assert.equal(policy.applied,false);assert.equal(policy.usedForSelection,false);
    assert.equal(policy.observations[0].reason,'requirements_unconfirmed');
    assert.equal(policy.context.specialTrainingRank,training===99?null:training);
    assert.equal(policy.context.potentialRank,potential===99?null:potential);
    assert.equal(personal.characterRecipePolicy.applied,false);
    assert.equal(personal.characterRecipePolicy.context.specialTrainingRank,policy.context.specialTrainingRank);
    assert.equal(personal.characterRecipePolicy.context.potentialRank,policy.context.potentialRank);
  }
  owned.levelLimitRank=1;owned.potentialRank=1;
  assert.equal(recommend(input).scoreSummary.hifModel.guideMemoryProfile.characterPolicy.applied,true);
});

test('stats and opening comparison seeds keep their original objective instead of applying character preferences', () => {
  const input = fixture();
  for (const memorySelectionMode of ['stats', 'opening']) {
    const result = recommend({ ...input, options: { ...input.options, memorySelectionMode } });
    assert.ok(!carried(result).includes('preferred'));
    assert.ok(carried(result).includes('avoided'));
    assert.equal(result.scoreSummary.hifModel.guideMemoryProfile.characterPolicy.usedForSelection, false);
    assert.deepEqual(result.scoreSummary.hifModel.guideMemoryProfile.characterSelection.selectedMatches, []);
  }
});

test('unmet or unknown per-rule requirements are preserved without affecting selection', () => {
  const input = fixture(), policy = input.catalog.idolRecipePolicies.policies[0];
  policy.roleChanges = {};
  policy.selectionRules = [{ gameId: 'preferred', action: 'prefer', reason: 'PLv75 source condition', sourceIds: ['specific'], requirements: { minProducerLevel: 75 } }];
  const result = recommend(input);
  assert.ok(!carried(result).includes('preferred'));
  assert.equal(result.scoreSummary.hifModel.guideMemoryProfile.characterSelectionRules[0].applies, false);
  // Native carry tiers are zero in this fixture; only source-rule PLv is unknown.
  input.inventory.producerLevel = null;
  const unknown = recommend(input);
  assert.equal(unknown.scoreSummary.hifModel.guideMemoryProfile.characterSelectionRules[0].applies, null);
  assert.ok(!carried(unknown).includes('preferred'));
});

test('a preferred source card below the ordinary numeric top12 still enters the search pool', () => {
  const input = fixture();
  input.catalog.idolRecipePolicies.policies[0].roleChanges = {};
  input.catalog.idolRecipePolicies.policies[0].selectionRules = [{ gameId: 'preferred', action: 'prefer', reason: 'source core alternative', sourceIds: ['specific'] }];
  for (let i = 0; i < 18; i++) {
    input.catalog.skillCards.push({ gameId: 'filler-' + i, upgradeCount: 0, plan: 'sense', name: 'filler-' + i, unlockProducerLevel: 0, rentalUnlockProducerLevel: 0 });
    input.inventory.memories.push({ id: 'fill-memory-' + i, produceCard: { id: 'filler-' + i, upgradeCount: 0, customizes: [] }, produceCardPhaseType: 1, abilities: [{ id: 'bonus-neutral', level: 1 }] });
  }
  assert.ok(carried(recommend(input)).includes('preferred'));
});

test('suppressing an unproven generic recipe stops certifying its four roles and keeps original source metadata', () => {
  const input = fixture(); input.catalog.idolRecipePolicies.policies[0].roleChanges = { suppressGenericRoles: true }; input.catalog.idolRecipePolicies.policies[0].selectionRules = [];
  const result = recommend(input), profile = result.scoreSummary.hifModel.guideMemoryProfile;
  assert.deepEqual(profile.roles, []);
  assert.deepEqual(profile.originalCarryRoleGameIds, ['core', 'lowered']);
  assert.equal(profile.fulfilledCount, 0);
  assert.equal(profile.applied, false);
  assert.equal(profile.characterPolicy.applied, true);
  assert.equal(profile.characterPolicy.exactReplacementRecipeConfirmed, false);
});

test('a required exact HIF effect with its actual target precedes a source soft conflict', () => {
  const full = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
  const input = fixture(), targetId = 'p_card-01-men-1_034';
  const ability = full.hifAbilityGuidance.abilities.find(row => row.trigger.cardIds.length === 1 && row.trigger.cardIds[0] === targetId);
  input.catalog.skillCards.push(...full.skillCards.filter(card => card.gameId === targetId));
  input.catalog.memoryAbilities.push(...full.memoryAbilities.filter(row => row.gameId === ability.abilityId && row.level === ability.level));
  for (const [table, rows] of Object.entries(full.memoryMechanicsGraph)) input.catalog.memoryMechanicsGraph[table] = [...(input.catalog.memoryMechanicsGraph[table] ?? []), ...rows];
  input.inventory.memories.push({ id: 'required-hif', produceCard: { id: targetId, upgradeCount: 0, customizes: [] }, produceCardPhaseType: 1, abilities: [{ id: ability.abilityId, level: ability.level }] });
  input.catalog.idolRecipePolicies.policies[0].selectionRules.push({ gameId: targetId, action: 'avoid', reason: 'soft source conflict', sourceIds: ['specific'] });
  const result = recommend({ ...input, options: { ...input.options, requiredHifEffectIds: [ability.effectId] } });
  assert.ok(carried(result).includes(targetId));
  assert.ok(result.scoreSummary.hifModel.memoryRequirements.fulfilled.includes('hif:' + ability.effectId));
  assert.ok(result.scoreSummary.hifModel.guideMemoryProfile.characterSelection.selectedMatches.some(rule => rule.gameId === targetId && rule.action === 'avoid'));
});
