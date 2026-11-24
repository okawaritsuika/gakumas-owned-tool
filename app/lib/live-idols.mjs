import { normalizePlan } from './catalog.mjs';

export const idolTables = [
  'Character', 'IdolCard', 'IdolCardLevelLimitStatusUp', 'IdolCardPotential', 'CharacterTrueEndBonus',
  'ProduceCharacter', 'ProduceGroupCharacter', 'ProduceInitialDeck', 'ExamInitialDeck',
  'ProduceCard', 'ProduceItem', 'ProduceItemEffect',
];

const scenarioGroups = {
  'produce_group-001': 'hajime', 'produce_group-002': 'nia', 'produce_group-003': 'hif',
};
const scenarioTypes = {
  ProduceType_FirstStar: 'hajime', ProduceType_NextIdolAudition: 'nia', ProduceType_HatsuboshiIdolFestival: 'hif',
};
const trainingTypes = {
  ProduceExamEffectType_ExamParameterBuff: 'goodConditionTurns', ProduceExamEffectType_ExamLessonBuff: 'concentration',
  ProduceExamEffectType_ExamReview: 'goodImpressionTurns', ProduceExamEffectType_ExamCardPlayAggressive: 'motivation',
  ProduceExamEffectType_ExamConcentration: 'strength', ProduceExamEffectType_ExamFullPower: 'fullPower',
  ProduceExamEffectType_ExamPreservation: 'preservation',
};
const skillTypes = {
  ProduceCardCategory_ActiveSkill: 'active', ProduceCardCategory_MentalSkill: 'mental', ProduceCardCategory_Trouble: 'trouble',
};
const uniqueFields = ['produceCardId', 'secondProduceCardId', 'beforeProduceItemId', 'afterProduceItemId',
  'beforeLevelLimitProduceItemId', 'afterLevelLimitProduceItemId'];
const variantKey = (id, upgrade) => id + ':' + upgrade;
const rankOf = value => Number(/__(\d+)$/.exec(value)?.[1]) || null;
const list = value => Array.isArray(value) ? value : [];
const masterUrl = commit => 'https://github.com/vertesan/gakumasu-diff' + (/^[a-f0-9]{40}$/.test(commit) ? '/tree/' + commit : '');

function groupBy(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[field])) groups.set(row[field], []);
    groups.get(row[field]).push(row);
  }
  return groups;
}

// The publication timestamp is a display gate. It does not confirm a release or ownership.
function visible(row, now) {
  const time = row.viewStartTime;
  return (typeof time === 'number' || typeof time === 'string' && /^\d+$/.test(time))
    && Number.isSafeInteger(Number(time)) && Number(time) >= 0 && Number(time) <= now;
}

function stats(row, suffix = '') {
  const vector = { vo: row['produceVocal' + suffix], da: row['produceDance' + suffix], vi: row['produceVisual' + suffix] };
  return Object.values(vector).every(Number.isSafeInteger) ? vector : null;
}

function stageRows(rows, training, maxRank) {
  const stages = [];
  for (const row of rows ?? []) {
    const rank = rankOf(row.rank);
    if (!rank || training && rank > maxRank) continue;
    const delta = stats(row, training ? '' : 'GrowthRatePermil');
    if (!delta || !Array.isArray(row.effectTypes)) continue;
    const staminaType = training ? 'IdolCardLevelLimitEffectType_ProduceStamina' : 'IdolCardPotentialEffectType_ProduceStamina';
    stages.push({ rank, effectTypes: row.effectTypes, effectValue: row.effectValue,
      staminaDeltaByExplicitEffectType: row.effectTypes.includes(staminaType) ? row.effectValue : 0,
      ...(training ? { voDaViDelta: delta, illustrationChanges: row.isIllustrationChange } : { growthRatePermilDelta: delta }) });
  }
  return stages.sort((a, b) => a.rank - b.rank);
}

function mergeIdolRows(catalog, tables, { translations, now, commit }) {
  const existing = new Map(catalog.idolCards.map(card => [card.gameId, card]));
  const characters = new Map(tables.Character.map(row => [row.id, row]));
  const training = groupBy(tables.IdolCardLevelLimitStatusUp, 'id');
  const potential = groupBy(tables.IdolCardPotential, 'id');
  const bonuses = groupBy(tables.CharacterTrueEndBonus, 'id');
  const exclusions = groupBy(tables.ProduceGroupCharacter.filter(row => row.isExcluded === true), 'characterId');
  const playable = groupBy(tables.ProduceCharacter, 'characterId');
  const scenarioByProduce = new Map(list(catalog.produceInitialDecks?.scenarioDecks).map(row => [row.produceId, row.scenario]));
  const translatedTitles = new Map();
  for (const row of tables.IdolCard) {
    const title = translations.idolCards?.[row.id];
    if (!title) continue;
    if (!translatedTitles.has(row.name)) translatedTitles.set(row.name, title);
    else if (translatedTitles.get(row.name) !== title) translatedTitles.set(row.name, null);
  }
  const visibleOwners = new Set();
  for (const row of tables.IdolCard) {
    const character = characters.get(row.characterId), previous = existing.get(row.id);
    if (!row.name || !character?.isPlayable || !list(character.idolCardIds).includes(row.id) || !visible(row, now)) continue;
    visibleOwners.add(row.id);
    const available = new Set((playable.get(character.id) ?? []).map(link => scenarioByProduce.get(link.produceId)));
    const excluded = new Set((exclusions.get(character.id) ?? []).map(link => scenarioGroups[link.produceGroupId]).filter(Boolean));
    for (const scenario of new Set(scenarioByProduce.values())) if (!available.has(scenario)) excluded.add(scenario);
    if (previous && !previous.nativeMaster) {
      if (row.produceChallengeSlotId !== undefined) previous.produceChallengeSlotId = row.produceChallengeSlotId;
      if (previous.recommendationEligible === false) previous.recommendWhenOwned = true;
      if (excluded.size || previous.excludedScenarios) previous.excludedScenarios = [...excluded];
      continue;
    }
    const plan = normalizePlan(row.planType);
    if (!['sense', 'logic', 'anomaly'].includes(plan)) continue;
    const base = stats(row), growth = stats(row, 'GrowthRatePermil');
    if (!base || !growth || !Number.isSafeInteger(row.produceStamina)) continue;
    const characterJa = [character.lastName, character.firstName].filter(Boolean).join(' ');
    const characterKo = translations.characters?.[character.id] ?? null;
    const titleKo = translations.idolCards?.[row.id] ?? translatedTitles.get(row.name) ?? null;
    const nameJa = '[' + row.name + '] ' + characterJa;
    const nameKo = titleKo && characterKo ? '[' + titleKo + '] ' + characterKo : null;
    const displayEffect = row.showExamEffectType && row.showExamEffectType !== 'ProduceExamEffectType_Unknown'
      ? row.showExamEffectType : row.examEffectType;
    const trueEndRows = bonuses.get(character.characterTrueEndBonusId);
    const card = { id: row.id, gameId: row.id, internalId: null, nativeMaster: true, masterCommit: commit ?? null,
      name: nameKo ?? '[' + (titleKo ?? row.name) + '] ' + (characterKo ?? characterJa), nameJa, nameKo, title: titleKo ?? row.name,
      characterId: character.id, characterName: characterKo ?? characterJa, characterNameKo: characterKo, characterNameJa: characterJa,
      rarity: row.rarity.replace('IdolCardRarity_', '').toUpperCase(), plan, attribute: null, assetId: row.assetId,
      baseStats: { baseVoDaVi: base, growthRatePermil: growth, stamina: row.produceStamina },
      specialTrainingStages: stageRows(training.get(row.idolCardLevelLimitStatusUpId), true, rankOf(row.maxIdolCardLevelLimitRank)),
      awakeningStages: stageRows(potential.get(row.idolCardPotentialId), false),
      characterBonuses: trueEndRows ? { characterId: character.id, trueEndBonuses: trueEndRows.map(bonus => ({
        scenarioEnum: bonus.produceType, scenario: scenarioTypes[bonus.produceType] ?? null,
        voDaViDelta: stats(bonus), growthRatePermilDelta: stats(bonus, 'GrowthRatePermil'), staminaDelta: bonus.produceStamina,
      })) } : null,
      uniqueIds: Object.fromEntries(uniqueFields.map(key => [key, row[key] ?? null])),
      uniqueSkillCardIds: [], initialDeckId: row.examInitialDeckId, produceChallengeSlotId: row.produceChallengeSlotId ?? null,
      recommendedEffect: trainingTypes[displayEffect] ?? null,
      recommendedEffectConflict: false, recommendationEligible: false, recommendWhenOwned: true, excludedScenarios: [...excluded] };
    if (previous) Object.assign(previous, card);
    else { existing.set(row.id, card); catalog.idolCards.push(card); }
  }
  return visibleOwners;
}

function skillSource(row) {
  if (row.originPrimaStellaIdolCardId) return 'primaStella';
  if (row.originIdolCardId) return 'pIdol';
  if (row.originSupportCardId) return 'support';
  if (row.isInitialDeckProduceCard) return 'default';
  return row.unlockProducerLevel > 0 || row.isReward === true ? 'produce' : 'unknown';
}

function mergeSkillsAndItems(catalog, tables, owners, { translations, now }) {
  const supportOwners = Array.isArray(tables.SupportCard)
    ? new Set(tables.SupportCard.filter(row => visible(row, now)).map(row => row.id))
    : new Set(catalog.supportCards.map(row => row.gameId));
  const skills = new Map(catalog.skillCards.map(card => [variantKey(card.gameId, card.upgradeCount), card]));
  for (const row of tables.ProduceCard) {
    // ++ and +++ are temporary in-exam upgrades. The collection and carry selectors show permanent versions.
    if (![0, 1].includes(row.upgradeCount) || row.libraryHidden !== false || !visible(row, now)) continue;
    const owner = row.originIdolCardId || row.originPrimaStellaIdolCardId;
    if (owner && !owners.has(owner)) continue;
    if (row.originSupportCardId && !supportOwners.has(row.originSupportCardId)) continue;
    const key = variantKey(row.id, row.upgradeCount), previous = skills.get(key);
    if (previous && !previous.nativeMaster) continue;
    const nameKo = translations.skillCards?.[key] ?? null;
    const type = skillTypes[row.category] ?? null;
    const rawRarity = row.rarity.replace('ProduceCardRarity_', '').toUpperCase();
    const card = { id: row.id, gameId: row.id, nativeMaster: true, internalId: null, upgradeCount: row.upgradeCount,
      name: nameKo ?? row.name, nameJa: row.name, nameKo, plan: normalizePlan(row.planType), attribute: null,
      type, rarity: type === 'trouble' ? 'T' : rawRarity === 'LEGEND' ? 'L' : rawRarity, sourceType: skillSource(row),
      originIdolCardId: row.originIdolCardId || null, originSupportCardId: row.originSupportCardId || null,
      originPrimaStellaIdolCardId: row.originPrimaStellaIdolCardId || null, assetId: row.assetId, isCharacterAsset: row.isCharacterAsset,
      stamina: row.stamina, forceStamina: row.forceStamina, costValue: row.costValue, costType: row.costType,
      maxCustomizeCount: row.maxCustomizeCount, customizationIds: row.produceCardCustomizeIds, isInitial: row.isInitial,
      isInitialDeck: row.isInitialDeckProduceCard,
      effectGroupIds: Array.isArray(row.effectGroupIds) ? row.effectGroupIds : null, noDeckDuplication: row.noDeckDuplication,
      unlockProducerLevel: row.unlockProducerLevel, rentalUnlockProducerLevel: row.rentalUnlockProducerLevel,
      requiresSkillCardSwitch: row.isConversion, recommendationEligible: true, identityStatus: 'exact_native' };
    if (previous) Object.assign(previous, card);
    else { skills.set(key, card); catalog.skillCards.push(card); }
  }
  const items = new Map(catalog.pItems.map(item => [item.gameId, item]));
  const itemEffects = new Map(tables.ProduceItemEffect.map(row => [row.id, row]));
  for (const row of tables.ProduceItem) {
    if (row.libraryHidden !== false || !visible(row, now) || row.originIdolCardId && !owners.has(row.originIdolCardId)
      || row.originSupportCardId && !supportOwners.has(row.originSupportCardId)) continue;
    const previous = items.get(row.id);
    if (previous && !previous.nativeMaster) continue;
    const item = { gameId: row.id, nativeMaster: true, internalId: null, nameJa: row.name, plan: normalizePlan(row.planType),
      originIdolCardId: row.originIdolCardId || null, originSupportCardId: row.originSupportCardId || null,
      assetId: row.assetId, isUpgraded: row.isUpgraded, identityStatus: 'exact_native',
      ...(row.originIdolCardId ? { nativeItemEffects: list(row.produceItemEffectIds).map(id => itemEffects.get(id)).filter(Boolean) } : {}) };
    if (previous) Object.assign(previous, item);
    else { items.set(row.id, item); catalog.pItems.push(item); }
  }
}

function addUnreviewedSkillFamilies(catalog, commit) {
  const advice = catalog.skillAdvice;
  if (!advice) return;
  advice.cards ??= [];
  const existing = new Map(advice.cards.map(card => [card.gameId, card]));
  const families = groupBy(catalog.skillCards.filter(row => row.nativeMaster), 'gameId');
  const sourceId = 'live-skill-master';
  for (const [gameId, variants] of families) {
    const previous = existing.get(gameId);
    if (previous && !previous.nativeMaster) continue;
    const card = variants.find(row => row.upgradeCount === 0);
    if (!card) continue;
    const family = { id: gameId, gameId, nativeMaster: true, nameKo: card.nameKo, nameJa: card.nameJa, rarity: card.rarity,
      sourceType: card.sourceType, plan: card.plan, category: card.type,
      origin: { idolGameIds: [card.originIdolCardId].filter(Boolean), supportGameIds: [card.originSupportCardId].filter(Boolean),
        primaStellaIdolIds: [card.originPrimaStellaIdolCardId].filter(Boolean) },
      status: { identityVerified: true, isLegend: card.rarity === 'L', isInitialDeck: card.isInitialDeck, forceInitialHand: card.isInitial,
        noDeckDuplication: card.noDeckDuplication }, sourceIds: [sourceId],
      unlock: { acquisitionProducerLevel: card.unlockProducerLevel > 0 ? card.unlockProducerLevel : null,
        rentalProducerLevel: card.rentalUnlockProducerLevel ?? null, requiresConversionSelection: card.requiresSkillCardSwitch },
      variants: variants.map(row => ({ nameKo: row.nameKo, nameJa: row.nameJa, upgradeCount: row.upgradeCount,
        native: { stamina: row.stamina, forceStamina: row.forceStamina, costType: row.costType, costValue: row.costValue,
          maxCustomizeCount: row.maxCustomizeCount }, customizationIds: row.customizationIds, roleStatus: 'native_identity_only' })) };
    if (previous) Object.assign(previous, family);
    else advice.cards.push(family);
  }
  advice.sources ??= [];
  if (families.size && !advice.sources.some(row => row.id === sourceId)) {
    advice.sources.push({ id: sourceId, title: '공개 마스터의 스킬 카드와 강화 단계', url: masterUrl(commit) });
  }
}

function mergeInitialDecks(catalog, tables) {
  const data = catalog.produceInitialDecks;
  if (!data) return;
  const nativeDecks = new Map(tables.ExamInitialDeck.map(row => [row.id, row]));
  const scenarioByProduce = new Map(list(data.scenarioDecks).map(row => [row.produceId, row.scenario]));
  const links = groupBy(tables.ProduceInitialDeck, 'examEffectType');
  const idols = new Map(tables.IdolCard.map(row => [row.id, row]));
  const profiles = new Map(list(data.idolProfiles).map(profile => [profile.idolCardId, profile]));
  data.idolProfiles ??= [];
  data.decks ??= {};
  for (const card of catalog.idolCards.filter(card => card.nativeMaster)) {
    const row = idols.get(card.gameId);
    if (!row) continue;
    const scenarioDeckIds = {};
    for (const link of links.get(row.examEffectType) ?? []) {
      const scenario = scenarioByProduce.get(link.produceId);
      const deck = nativeDecks.get(link.examInitialDeckId);
      if (!scenario || card.excludedScenarios.includes(scenario) || !deck || !deck.produceCardIds?.length) continue;
      const upgrades = list(deck.produceCardUpgradeCounts);
      if (deck.produceCardIds.length !== upgrades.length || !upgrades.every(Number.isSafeInteger)) continue;
      scenarioDeckIds[link.produceId] = deck.id;
      if (!data.decks[deck.id]) {
        const cardSlots = deck.produceCardIds.map((cardId, index) => ({ cardId, upgradeCount: upgrades[index] }));
        data.decks[deck.id] = { id: deck.id, usage: 'produce_scenario_template', cardCount: cardSlots.length,
          upgradeCountsExplicit: true, cardSlots };
      }
    }
    const profile = { idolCardId: row.id, initialDeckId: row.examInitialDeckId, examEffectType: row.examEffectType,
      showExamEffectType: row.showExamEffectType, uniqueCardIds: [row.produceCardId, row.secondProduceCardId].filter(Boolean),
      scenarioDeckIds, runtimeModifiedStartingDeckVerified: false };
    if (profiles.has(row.id)) Object.assign(profiles.get(row.id), profile);
    else data.idolProfiles.push(profile);
  }
}

function linkUniqueProfiles(catalog, commit) {
  const guidance = catalog.multiCreatorGuidance;
  if (!guidance) return;
  const liveCards = catalog.idolCards.filter(card => card.nativeMaster);
  if (!liveCards.length) return;
  const sourceId = 'live-idol-master';
  guidance.sources ??= [];
  if (!guidance.sources.some(source => source.id === sourceId)) {
    guidance.sources.push({ id: sourceId, title: '공개 마스터의 P아이돌·고유 스킬·P아이템', url: masterUrl(commit) });
  }
  guidance.idolProfiles ??= [];
  const profilesById = new Map(guidance.idolProfiles.map(profile => [profile.idolGameId, profile]));
  const skills = new Set(catalog.skillCards.filter(row => row.upgradeCount === 0).map(row => row.gameId));
  const items = new Set(catalog.pItems.map(row => row.gameId));
  for (const card of liveCards) {
    if (profilesById.has(card.gameId) && !profilesById.get(card.gameId).nativeMaster) continue;
    const uniqueCardIds = [card.uniqueIds.produceCardId, card.uniqueIds.secondProduceCardId].filter(Boolean);
    const uniqueItemIds = [...new Set(uniqueFields.filter(key => key.endsWith('ItemId')).map(key => card.uniqueIds[key]).filter(Boolean))];
    const profile = { nativeMaster: true, idolGameId: card.gameId, characterId: card.characterId, plan: card.plan,
      nameJa: card.nameJa, nameKo: card.nameKo, uniqueIds: card.uniqueIds, uniqueCardIds, uniqueItemIds,
      identityVerified: uniqueCardIds.length > 0 && uniqueCardIds.every(id => skills.has(id)) && uniqueItemIds.every(id => items.has(id)),
      sourceIds: [sourceId] };
    if (profilesById.has(card.gameId)) Object.assign(profilesById.get(card.gameId), profile);
    else guidance.idolProfiles.push(profile);
  }
}

/** Merge one pinned set of native rows into the supplied catalog before publishing it. */
export function mergeLiveIdols(catalog, tables, { translations = {}, now = Date.now(), commit } = {}) {
  for (const name of idolTables) if (!Array.isArray(tables[name])) throw new Error('P아이돌 마스터 표 누락: ' + name);
  const owners = mergeIdolRows(catalog, tables, { translations, now, commit });
  mergeSkillsAndItems(catalog, tables, owners, { translations, now });
  addUnreviewedSkillFamilies(catalog, commit);
  mergeInitialDecks(catalog, tables);
  linkUniqueProfiles(catalog, commit);
  if (catalog.indices) catalog.indices.idolCards = Object.fromEntries(catalog.idolCards.map(card => [card.gameId, card]));
  return catalog;
}
