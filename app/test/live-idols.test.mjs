import test from 'node:test';
import assert from 'node:assert/strict';
import { idolTables, mergeLiveIdols } from '../lib/live-idols.mjs';
import { computeIdolGrowth } from '../lib/idol-growth.mjs';
import { recommend } from '../lib/recommend.mjs';
import { buildIdolOperatingGuidance } from '../lib/idol-operating-guidance.mjs';
import { buildPersonalizedPlan } from '../lib/personalized-plan.mjs';
import { buildSkillAdvice, buildSkillAdviceOptions } from '../lib/skill-advice.mjs';

function fixture() {
  const tables = Object.fromEntries(idolTables.map(name => [name, []]));
  const newId = 'i_card-new-3-000', future = 'i_card-new-3-001';
  const stat = { produceVocal: 20, produceDance: 30, produceVisual: 40 };
  const growth = { produceVocalGrowthRatePermil: 50, produceDanceGrowthRatePermil: 60, produceVisualGrowthRatePermil: 70 };
  tables.Character = [{ id: 'new', lastName: '姓', firstName: '名', isPlayable: true,
    idolCardIds: [newId, future], characterTrueEndBonusId: 'true-end' }];
  const idle = { characterId: 'new', rarity: 'IdolCardRarity_Ssr', planType: 'ProducePlanType_Plan1',
    examEffectType: 'ProduceExamEffectType_ExamLessonBuff', showExamEffectType: 'ProduceExamEffectType_Unknown',
    examInitialDeckId: 'idol-deck', produceCardId: 'skill', beforeProduceItemId: 'item', afterProduceItemId: 'item-plus',
    maxIdolCardLevelLimitRank: 'IdolCardLevelLimitRank__1', idolCardLevelLimitStatusUpId: 'training',
    idolCardPotentialId: 'potential', produceStamina: 30, ...stat, ...growth };
  tables.IdolCard = [{ ...idle, id: newId, name: '新曲', viewStartTime: '10' },
    { ...idle, id: future, name: '未公開', viewStartTime: '200' }, { ...idle, id: 'unlisted', name: '未掲載', viewStartTime: '0' }];
  tables.IdolCardLevelLimitStatusUp = [{ id: 'training', rank: 'IdolCardLevelLimitRank__1', effectValue: 0,
    effectTypes: ['IdolCardLevelLimitEffectType_ProduceCardUpgrade'], ...stat }];
  tables.IdolCardPotential = [{ id: 'potential', rank: 'IdolCardPotentialRank__1', effectValue: 0,
    effectTypes: ['IdolCardPotentialEffectType_InitialProduceItemChange'], ...growth }];
  tables.CharacterTrueEndBonus = [{ id: 'true-end', produceType: 'ProduceType_FirstStar', produceStamina: 0, ...stat, ...growth }];
  tables.ProduceCharacter = [{ characterId: 'new', produceId: 'first' }];
  tables.ProduceGroupCharacter = [{ produceGroupId: 'produce_group-003', characterId: 'new', isExcluded: true }];
  tables.ProduceInitialDeck = [{ produceId: 'first', examEffectType: idle.examEffectType, examInitialDeckId: 'scenario-deck' }];
  tables.ExamInitialDeck = [{ id: 'scenario-deck', produceCardIds: ['basic'], produceCardUpgradeCounts: [0] }];
  const base = { name: '高点', originIdolCardId: newId, planType: idle.planType, libraryHidden: false, viewStartTime: '0' };
  tables.ProduceCard = [0, 1, 2].map(upgradeCount => ({ ...base, id: 'skill', upgradeCount,
    name: base.name + '+'.repeat(upgradeCount), rarity: 'ProduceCardRarity_Ssr', category: 'ProduceCardCategory_ActiveSkill',
    stamina: 3, noDeckDuplication: true, effectGroupIds: ['keyword'], unlockProducerLevel: 0, rentalUnlockProducerLevel: 0 }));
  tables.ProduceItem = [{ ...base, id: 'item', isUpgraded: false, produceItemEffectIds: [] },
    { ...base, id: 'item-plus', isUpgraded: true, produceItemEffectIds: ['item-effect'] }];
  tables.ProduceItemEffect = [{ id: 'item-effect', effectType: 'ProduceItemEffectType_ExamStatusEnchant' }];
  const original = { id: 'other', gameId: 'other', name: '기존', plan: 'sense',
    baseStats: { baseVoDaVi: { vo: 1, da: 1, vi: 1 }, growthRatePermil: { vo: 1, da: 1, vi: 1 } } };
  const catalog = { idolCards: [original], supportCards: [], skillCards: [], pItems: [], memoryAbilities: [],
    indices: { idolCards: {} }, calculationModels: {}, excelPresets: [], multiCreatorGuidance: {}, skillAdvice: {},
    produceInitialDecks: { idolProfiles: [], decks: {}, scenarioDecks: [
      { produceId: 'first', scenario: 'hajime', difficulty: 'legend', examEffectType: idle.examEffectType },
      { produceId: 'audition', scenario: 'nia' }, { produceId: 'festival', scenario: 'hif' }] } };
  const owned = { gameId: newId, potentialRank: 1, levelLimitRank: 1, characterGrowth: { characterId: 'new', trueEndProduceTypes: [1] } };
  const inventory = { idolCards: [original, owned], supportCards: [], memories: [] };
  const settings = { now: 100, translations: { characters: { new: '새 아이돌' } } };
  return { newId, future, tables, catalog, settings, owned, inventory };
}

test('live native idol, permanent unique variants and True End growth join by IDs', () => {
  const { newId, future, tables, catalog, settings, owned, inventory } = fixture();
  mergeLiveIdols(catalog, tables, settings);
  mergeLiveIdols(catalog, tables, settings);
  const card = catalog.indices.idolCards[newId];
  assert.equal(card.name, '[新曲] 새 아이돌');
  assert.equal(card.nameJa, '[新曲] 姓 名');
  assert.equal(card.recommendedEffect, 'concentration');
  assert.deepEqual(card.excludedScenarios.sort(), ['hif', 'nia']);
  assert.deepEqual(catalog.idolCards.map(i => i.gameId), ['other', newId]);
  assert.deepEqual(catalog.skillCards.map(s => s.upgradeCount), [0, 1]);
  assert.deepEqual(catalog.produceInitialDecks.idolProfiles[0].scenarioDeckIds, { first: 'scenario-deck' });
  assert.equal(catalog.produceInitialDecks.decks['scenario-deck'].cardSlots[0].upgradeCount, 0);
  assert.deepEqual(computeIdolGrowth(card, owned).currentGrowthRatePermil, { vo: 150, da: 180, vi: 210 });
  const guide = buildIdolOperatingGuidance({ catalog, inventory, options: { scenario: 'hajime', idolGameId: newId } });
  assert.equal(guide.selectedIdol.uniqueIdentityVerified, true);
  assert.deepEqual(guide.uniqueSkills.map(s => [s.gameId, s.upgradeCount, s.cost.stamina]), [['skill', 1, 3]]);
  assert.deepEqual(guide.uniqueItems.map(item => [item.gameId, item.nativeItemEffects[0].id]), [['item-plus', 'item-effect']]);
  assert.equal(guide.uniqueSkills[0].effectDefinitionIdentityVerified, false);
  const plan = buildPersonalizedPlan({ catalog, inventory, result: {
    selectedIdol: { ...card, owned, ownershipVerified: true }, scoreSummary: { scenario: 'hajime', difficulty: 'legend' } } });
  assert.equal(plan.initialDeck.initialDeckId, 'scenario-deck');
  const option = buildSkillAdviceOptions({ catalog }).cards.find(row => row.gameId === 'skill');
  assert.deepEqual(option.origin.idolGameIds, [newId]);
  assert.deepEqual(option.variants.map(row => row.upgradeCount), [0, 1]);
  const advice = buildSkillAdvice({ catalog, input: { cardIds: ['skill'], scenario: 'hajime', difficulty: 'legend', plan: 'sense',
    trainingType: 'concentration', purpose: 'acquisition', idolGameId: newId } });
  assert.equal(advice.cards[0].rating.performanceTier, 'unrated');
  const otherScenario = buildSkillAdvice({ catalog, input: { cardIds: ['skill'], scenario: 'nia', trainingType: 'concentration',
    purpose: 'acquisition', idolGameId: newId } });
  assert.equal(otherScenario.cards[0].eligibility.status, 'blocked');
  assert.equal(catalog.indices.idolCards[future], undefined);
});

test('scenario restrictions cover manual, auto and farming picks and change with the upstream tables', () => {
  const { newId, tables, catalog, settings, inventory } = fixture();
  mergeLiveIdols(catalog, tables, settings);
  const run = (scenario, extra = {}, current = inventory) => recommend({ catalog, inventory: current, options: { scenario, ...extra } });
  assert.equal(run('hajime').selectedIdol.gameId, newId);
  assert.equal(run('hajime', {}, { ...inventory, idolCards: [] }).selectedIdol, null);
  const nia = run('nia');
  assert.equal(nia.selectedIdol.gameId, 'other');
  assert.ok(!nia.farmingIdols.some(card => card.gameId === newId));
  assert.throws(() => run('hif', { idolGameId: newId }), /H\.I\.F에서 프로듀스할 수 없습니다/);
  tables.ProduceCharacter.push({ characterId: 'new', produceId: 'audition' }, { characterId: 'new', produceId: 'festival' });
  tables.ProduceGroupCharacter = [];
  mergeLiveIdols(catalog, tables, settings);
  assert.equal(run('nia').selectedIdol.gameId, newId);
  assert.deepEqual(catalog.indices.idolCards[newId].excludedScenarios, []);
});
