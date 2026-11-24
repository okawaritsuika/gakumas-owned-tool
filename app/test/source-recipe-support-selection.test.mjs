import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../lib/recommend.mjs';

function fixture() {
  const support = (gameId, amount, attribute = 'dance') => ({ gameId, id: gameId, nameJa: gameId, name: gameId, plan: 'logic', attribute,
    maxLevels: { 0: 40, 4: 60 }, levelAbilities: [{ level: 1, order: 1, kind: 'initial_stat', activationLimit: 1,
      effects: [{ type: attribute === 'dance' ? 'ProduceEffectType_DanceAddition' : 'ProduceEffectType_VisualAddition',
        min: amount, max: amount, phase: 'ProducePhaseType_ProduceStart', triggerId: 'p_trigger-produce_start-initial', ratePermil: 0 }] }] });
  const cards = [...Array.from({ length: 12 }, (_, i) => support('a-fill-' + String(i).padStart(2, '0'), 100 + i)),
    support('z-source-low', 1), support('rental-visual', 1000, 'visual')];
  const idols = ['exact', 'other'].map(gameId => ({ gameId, nameJa: gameId === 'exact' ? '[Exact] Character' : '[Other] Character', characterId: 'character', plan: 'logic',
    baseStats: { baseVoDaVi: { vo: 50, da: 50, vi: 50 }, growthRatePermil: { vo: 0, da: 0, vi: 0 } }, specialTrainingStages: [], awakeningStages: [], uniqueIds: {} }));
  const catalog = { supportCards: cards, idolCards: idols,
    skillCards: [{ gameId: 'core', name: 'core', nameJa: 'core', upgradeCount: 0, plan: 'logic', actions: '', unlockProducerLevel: 0, rentalUnlockProducerLevel: 0 }],
    memoryAbilities: [], calculationModels: {}, excelPresets: [],
    hifMemoryRoles: { sources: [{ id: 'generic' }], profiles: [{ id: 'generic-logic', plan: 'logic', trainingType: 'motivation',
      status: 'conditional_guide_profile', carryRoles: [], sourceIds: ['generic'] }] },
    guideSupportProfiles: { sources: [{ id: 'support-source' }], profiles: [{ id: 'exact-pool', idolGameId: 'exact', idolCardId: 'exact', scenario: 'hif', plan: 'logic',
      trainingType: 'motivation', eventScope: 'ordinary_hif', expectedUniqueIds: {}, sourceIds: ['support-source'],
      idealSupports: [...cards.slice(0, 5), cards[13]].map(card => ({ gameId: card.gameId, attribute: card.attribute })),
      alternativeSupports: cards.slice(5, 13).map(card => ({ gameId: card.gameId, attribute: card.attribute })) }] },
    idolRecipePolicies: { sources: [{ id: 'recipe-source' }], policies: [{ id: 'exact-recipe', evidenceStatus: 'source_verified',
      idolIdentities: [{ gameId: 'exact', characterId: 'character', titleJa: 'Exact', expectedUniqueIds: {} }],
      scenario: 'hif', plan: 'logic', trainingTypes: ['motivation'], eventScope: 'ordinary_hif', sourceIds: ['recipe-source'],
      roleChanges: { suppressGenericRoles: true, addRoles: [{ gameId: 'core', nameJa: 'core', purpose: '원문 역할' }] }, selectionRules: [],
      sourceRecipe: { requiredSupports: [{ anyOfGameIds: ['z-source-low'], minimumLevel: null, observedLevel: 40 }] } }] } };
  const inventory = { producerLevel: 70, idolCards: idols.map(card => ({ gameId: card.gameId, levelLimitRank: 0, potentialRank: 0, currentGrowthRatePermil: { vo: 0, da: 0, vi: 0 } })),
    supportCards: cards.slice(0, 13).map(card => ({ gameId: card.gameId, level: 40, uncap: 0 })),
    memories: [{ id: 'owned-core', produceCard: { id: 'core', upgradeCount: 0, customizes: [] }, produceCardPhaseType: 1, abilities: [] }] };
  const options = { scenario: 'hif', plan: 'logic', trainingType: 'motivation', idolGameId: 'exact', producerLevel: 70, targetAttribute: 'dance',
    secondaryAttribute: 'visual', classAttribute: 'vocal', activityFocus: 'consult', compareSupportUpgrades: false, sourceSupportMode: 'guide',
    memorySelectionMode: 'guide', rentalGameId: 'rental-visual' };
  return { catalog, inventory, options };
}
const members = result => [...result.supports.owned, ...(result.supports.rental ? [result.supports.rental] : [])];
const metadata = result => result.scoreSummary.hifModel;
const requirement = input => input.catalog.idolRecipePolicies.policies[0].sourceRecipe.requiredSupports[0];

test('active source support composition precedes greater numeric stats and survives a low singleton rank', () => {
  const input = fixture();
  // Every singleton meets exactly one group. The thirteen numeric candidates
  // would drop the low second-group card from a plain per-axis top12 pool.
  input.catalog.idolRecipePolicies.policies[0].sourceRecipe.requiredSupports.unshift({
    anyOfGameIds: input.catalog.supportCards.slice(0, 12).map(row => row.gameId), minimumLevel: null });
  const before = structuredClone(input.inventory), result = recommend(input);
  assert.equal(members(result).length, 6);
  assert.ok(result.supports.owned.some(row => row.gameId === 'z-source-low'));
  assert.equal(metadata(result).sourceSupportRequirementMissingCount, 0);
  assert.equal(metadata(result).sourceSupportRequirementGroups.length, 2);
  assert.ok(metadata(result).sourceSupportRequirementGroups.every(row => row.satisfied));
  assert.equal(metadata(result).sourceSupportRequirementGroups[0].satisfied, true);
  assert.equal(result.sourceGuideEvidence.sourceSupportRequirements.numericEffectWeightAdded, false);
  assert.equal(result.sourceGuideEvidence.sourceSupportRequirements.itemAcquisitionConfirmed, false);
  assert.equal(metadata(result).sourceSupportRequirementGroups[0].actualItemAcquisitionConfirmed, null);
  const control = recommend({ ...input, options: { ...input.options, memorySelectionMode: 'stats' } });
  assert.ok(!members(control).some(row => row.gameId === 'z-source-low'));
  assert.ok(metadata(control).modeledStatTotal > metadata(result).modeledStatTotal);
  assert.deepEqual(input.inventory, before);
});

test('an ANY group chooses a valid alternative rather than requiring every listed support', () => {
  const input = fixture(); requirement(input).anyOfGameIds.push('a-fill-00');
  const result = recommend(input), group = metadata(result).sourceSupportRequirementGroups[0];
  assert.equal(group.satisfied, true);
  assert.ok(group.selected.some(row => row.gameId === 'a-fill-00'));
  assert.ok(!members(result).some(row => row.gameId === 'z-source-low'));
});

test('null minimum is not the observed level and does not upgrade a lower current owned card', () => {
  const input = fixture(); input.inventory.supportCards.find(row => row.gameId === 'z-source-low').level = 1;
  input.options.supportLevelMode = 'current';
  const result = recommend(input), group = metadata(result).sourceSupportRequirementGroups[0];
  assert.equal(group.minimumLevel, null); assert.equal(group.observedLevel, 40); assert.equal(group.observedLevelIsMinimum, false);
  assert.equal(group.satisfied, true);
  assert.equal(result.supports.owned.find(row => row.gameId === 'z-source-low').level, 1);
  assert.equal(input.inventory.supportCards.find(row => row.gameId === 'z-source-low').uncap, 0);
});

test('an explicit minimum is checked against the selected level and manual rental still wins', () => {
  const input = fixture(); requirement(input).minimumLevel = 55;
  const result = recommend(input);
  assert.equal(result.supports.rental.gameId, 'rental-visual');
  assert.equal(metadata(result).sourceSupportRequirementMissingCount, 1);
  assert.ok(result.supports.owned.every(row => row.level === 40 && row.uncap === 0));
  assert.equal(metadata(result).sourceSupportRequirementGroups[0].satisfied, false);
});

test('a user-selected rental outside the author pool remains the explicit exception', () => {
  const input = fixture();
  input.catalog.supportCards.push({ ...input.catalog.supportCards.at(-1), gameId: 'manual-outside', nameJa: 'manual-outside', name: 'manual-outside' });
  input.options.rentalGameId = 'manual-outside';
  const result = recommend(input);
  assert.equal(result.supports.rental.gameId, 'manual-outside');
  assert.ok(result.supports.owned.some(row => row.gameId === 'z-source-low'));
  assert.equal(metadata(result).sourceSupportRequirementMissingCount, 0);
});

test('source requirements outside the exact author pool do not expand it', () => {
  const input = fixture();
  input.catalog.supportCards.push({ ...input.catalog.supportCards[0], gameId: 'outside-required', nameJa: 'outside-required' });
  input.inventory.supportCards.push({ gameId: 'outside-required', level: 40, uncap: 0 });
  requirement(input).anyOfGameIds = ['outside-required'];
  const result = recommend(input), group = metadata(result).sourceSupportRequirementGroups[0];
  assert.ok(!members(result).some(row => row.gameId === 'outside-required'));
  assert.deepEqual(group.eligibleGameIds, []);
  assert.deepEqual(group.outsideSourcePoolIds, ['outside-required']);
  assert.equal(metadata(result).sourceSupportRequirementMissingCount, 1);
});

test('invalid owned level/uncap or incompatible native plan never satisfies the group', () => {
  for (const change of ['level', 'uncap', 'plan']) {
    const input = fixture();
    if (change === 'level') delete input.inventory.supportCards.find(row => row.gameId === 'z-source-low').level;
    else if (change === 'uncap') input.inventory.supportCards.find(row => row.gameId === 'z-source-low').uncap = 5;
    else input.catalog.supportCards.find(row => row.gameId === 'z-source-low').plan = 'sense';
    const result = recommend(input);
    assert.ok(!members(result).some(row => row.gameId === 'z-source-low'));
    assert.equal(metadata(result).sourceSupportRequirementMissingCount, 1);
  }
});

test('stats/opening, manual memory targets, inactive policies and another P-card keep their existing selection scope', () => {
  for (const patch of [{ memorySelectionMode: 'stats' }, { memorySelectionMode: 'opening' }, { desiredSkillIds: ['core'] },
    { idolGameId: 'other' }, { eventModeId: 'asari_fixture' }]) {
    const input = fixture(), result = recommend({ ...input, options: { ...input.options, ...patch } });
    assert.deepEqual(metadata(result).sourceSupportRequirementGroups, []);
    assert.ok(!members(result).some(row => row.gameId === 'z-source-low'));
  }
  const input = fixture(); input.catalog.idolRecipePolicies.policies[0].requirements = { minProducerLevel: 75 };
  const result = recommend(input);
  assert.deepEqual(metadata(result).sourceSupportRequirementGroups, []);
});

test('preparation-target fallback does not silently drop an achievable source support group', () => {
  const input = fixture(), result = recommend({ ...input, options: { ...input.options, preparationTargets: { vocal: 50, dance: 550, visual: 50 } } });
  assert.equal(metadata(result).sourceSupportRequirementMissingCount, 0);
  assert.ok(result.supports.owned.some(row => row.gameId === 'z-source-low'));
  assert.equal(metadata(result).preparationComparison.met, false);
  assert.equal(metadata(result).preparationComparison.sourceSupportRequirementsPreserved, true);
});
