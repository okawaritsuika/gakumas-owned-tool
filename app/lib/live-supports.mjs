import { normalizeAttribute, normalizePlan } from './catalog.mjs';

const levelTables = ['Vocal', 'Dance', 'Visual', 'Assist'].map(axis => 'SupportCardProduceSkillLevel' + axis);
export const supportTables = ['SupportCard', 'SupportCardLevelLimit', ...levelTables, 'ProduceSkill',
  'ProduceTrigger', 'ProduceEffect', 'ProduceEventSupportCard', 'ProduceStepEventDetail', 'ProduceCard',
  'ProduceItem', 'ProduceItemEffect'];

const index = (rows, key = row => row.id) => new Map(rows.map(row => [key(row), row]));
const axes = ['vocal', 'dance', 'visual'];
const statAxis = type => /^ProduceEffectType_(Vocal|Dance|Visual)Addition$/.exec(type)?.[1].toLowerCase();
const skillKey = (id, level) => id + ':' + level;
const rarityOf = value => value?.split('_').at(-1).toUpperCase();
const fixedValue = effect => Number.isFinite(effect?.effectValueMin) && effect.effectValueMin === effect.effectValueMax ? effect.effectValueMin : null;
const group = (rows, key) => {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
};

// An existing route counter describes the exact trigger, including deck-size
// and keyword gates. Only the axis of the awarded stat may be interchangeable.
const effectSignature = (triggerId, phase, type) => [triggerId, phase, type?.replace(/Vocal|Dance|Visual/g, 'Axis')].join(':');
function knownKinds(cards) {
  const kinds = new Map();
  for (const card of cards) for (const ability of card.levelAbilities ?? []) {
    for (const part of ability.effects ?? []) {
      if (!part.type || !part.phase || !ability.kind || ability.kind === 'unclassified') continue;
      const key = effectSignature(part.triggerId, part.phase, part.type);
      if (!kinds.has(key)) kinds.set(key, ability.kind);
      else if (kinds.get(key) !== ability.kind) kinds.set(key, null);
    }
  }
  return kinds;
}

function levelAbility(row, refs) {
  const skill = refs.skills.get(skillKey(row.produceSkillId, row.produceSkillLevel));
  const effects = [], kinds = new Set();
  for (const n of [1, 2, 3]) {
    const effectId = skill?.['produceEffectId' + n], triggerId = skill?.['produceTriggerId' + n];
    if (!effectId && !triggerId) continue;
    const effect = refs.effects.get(effectId), phase = refs.triggers.get(triggerId)?.phaseType;
    const ratePermil = skill['activationRatePermil' + n];
    const kind = refs.kinds.get(effectSignature(triggerId, phase, effect?.produceEffectType));
    kinds.add(kind);
    effects.push({ type: effect?.produceEffectType ?? null, min: effect?.effectValueMin ?? null,
      max: effect?.effectValueMax ?? null, phase: phase ?? null, triggerId, ratePermil, effectId });
  }
  const kind = kinds.size === 1 ? [...kinds][0] : null;
  // The arithmetic consumes fixed, unconditional grants. Keep a new condition
  // or random roll visible without awarding its nominal amount at every visit.
  const knownScenario = /^ProduceType_(Unknown|FirstStar|NextIdolAudition|HatsuboshiIdolFestival)$/.test(skill?.produceType);
  const knownSplit = skill?.produceSplitType === 'ProduceSplitType_Unknown' ||
    (skill?.produceType === 'ProduceType_HatsuboshiIdolFestival' && /^ProduceSplitType_\w+$/.test(skill.produceSplitType));
  const applicable = kind && Number.isInteger(skill?.activationCount) && skill.activationCount >= 0 &&
    /^ProducePlanType_(Common|Plan[123])$/.test(skill.planType) && knownScenario && knownSplit;
  const parts = effects.length ? effects : [{ type: null }];
  return { level: row.supportCardLevel, order: row.order, skillId: row.produceSkillId,
    skillLevel: row.produceSkillLevel, kind: kind ?? 'unclassified', activationLimit: skill?.activationCount ?? null,
    plan: normalizePlan(skill?.planType), scenarioEnum: skill?.produceType ?? null, splitEnum: skill?.produceSplitType ?? null,
    effects: parts.map(part => applicable && [0, 1000].includes(part.ratePermil) ? part
      : { ...part, nativeMin: part.min ?? null, nativeMax: part.max ?? null, min: null, max: null }) };
}

const itemTriggerKinds = {
  start_shop: 'consult_selection', start_present: 'activity_supply_gift_selection', start_customize: 'special_training_start',
  end_step_event_activity: 'outing_end', end_step_event_school: 'class_work_end', end_audition: 'exam_end',
  change_produce_card: 'skill_change', upgrade_produce_card: 'card_enhance', get_produce_drink: 'pdrink_acquire',
};
const keywords = { lesson_buff: 'concentration', parameter_buff: 'good_condition', review: 'good_impression',
  card_play_aggressive: 'motivation', block: 'vitality', preservation: 'reserve', full_power: 'full_power', concentration: 'aggressive' };
function itemTrigger(triggerId) {
  let base = triggerId.replace(/^p_trigger-/, ''), condition;
  const bounds = base.match(/-(vocal|dance|visual|stamina_ratio|produce_point)-(\d+)_(\d+)$/);
  if (bounds) {
    const [, stat, min, max] = bounds, low = Number(min), high = Number(max);
    if (Boolean(low) === Boolean(high)) return null;
    if (axes.includes(stat)) condition = { key: low ? 'param_gte' : 'param_lte', param: stat, threshold: low || high };
    else if (stat === 'stamina_ratio') condition = { key: low ? 'hp_gte_pct' : 'hp_lte_pct', threshold: (low || high) / 10 };
    else if (low) condition = { key: 'pp_gte', threshold: low };
    else return null;
    base = base.slice(0, bounds.index);
  }
  let trigger;
  if (Object.hasOwn(itemTriggerKinds, base)) trigger = { key: itemTriggerKinds[base] };
  const lesson = base.match(/^end_lesson-lesson_(vocal|dance|visual)(_sp)?$/);
  if (lesson) trigger = { key: lesson[2] ? 'param_sp_lesson_end' : 'param_lesson_end', param: lesson[1] };
  const card = base.match(/^(get|upgrade)_produce_card-0000_0000-p_card_search-deck_all-effect_group-visible-exam_(\w+)-000$/);
  if (card && Object.hasOwn(keywords, card[2])) trigger = { key: card[1] === 'get' ? 'keyword_card_acquire' : 'keyword_card_enhance', keyword: keywords[card[2]] };
  const planCard = base.match(/^get_produce_card-0000_0000-p_card_search-plan([123])-deck_all$/);
  if (planCard) trigger = { key: 'plan_card_acquire', plan: normalizePlan('Plan' + planCard[1]) };
  return trigger ? { trigger, ...(condition && { condition }) } : null;
}

const singlePick = effect => effect.pickCountMin === 1 && effect.pickCountMax === 1;
function itemBody(effect) {
  const type = effect?.produceEffectType, value = fixedValue(effect), param = statAxis(type);
  if (param && value !== null) return { key: 'param_up', param, value };
  if (type === 'ProduceEffectType_ProducePointAddition' && value !== null) return { key: 'pp_gain', value };
  if (type === 'ProduceEffectType_StaminaRecoverFix' && value !== null) return { key: 'hp_recovery', value };
  if (type === 'ProduceEffectType_ProduceRewardSet' && effect.produceResourceType === 'ProduceResourceType_ProduceDrink'
    && effect.pickRangeType === 'ProducePickRangeType_Random' && Number.isInteger(effect.pickCountMin)
    && effect.pickCountMin > 0 && effect.pickCountMin === effect.pickCountMax) return { key: 'random_pdrink_count', count: effect.pickCountMin };
  if (type === 'ProduceEffectType_ProduceCardUpgrade' && value === 1 && singlePick(effect) && effect.produceCardSearchId === 'p_card_search-deck_all') {
    if (effect.pickRangeType === 'ProducePickRangeType_Select') return { key: 'select_enhance' };
    if (effect.pickRangeType === 'ProducePickRangeType_Random') return { key: 'random_enhance' };
  }
  return { key: 'unmapped', nativeEffectId: effect?.id ?? null };
}

function providedItem(native, refs) {
  const item = { gameId: native.id, name: native.name, rarity: rarityOf(native.rarity)?.toLowerCase(), effect: null };
  const trigger = refs.triggers.has(native.produceTriggerId) ? itemTrigger(native.produceTriggerId) : null;
  if (!trigger || native.isExamEffect !== false || native.fireInterval !== 0 || !Number.isInteger(native.fireLimit) || native.fireLimit < 0 ||
    native.produceTriggerIds?.length || native.skills?.some(part => part.produceTriggerId) || !native.produceItemEffectIds?.length) return item;
  const body = native.produceItemEffectIds.map(id => {
    const row = refs.itemEffects.get(id);
    return itemBody(row?.effectType === 'ProduceItemEffectType_ProduceEffect' && refs.effects.get(row.produceEffectId));
  });
  item.effect = { ...trigger, body, ...(native.fireLimit > 0 && { limit: { key: 'per_produce', count: native.fireLimit } }) };
  return item;
}

function eventReward(effect, cardId, card, refs) {
  const type = effect?.produceEffectType, value = fixedValue(effect), axis = statAxis(type);
  if (axis && value !== null) return { effect_type: 'param_boost', param_type: axis, param_value: value };
  if (type === 'ProduceEffectType_ProducePointAddition' && value !== null) return { effect_type: 'pp_gain', param_value: value };
  if (type === 'ProduceEffectType_StaminaRecoverFix' && value !== null) return { effect_type: 'hp_recovery', param_value: value };
  if (effect && singlePick(effect)) {
    const select = effect.pickRangeType === 'ProducePickRangeType_Select', random = effect.pickRangeType === 'ProducePickRangeType_Random';
    if (type === 'ProduceEffectType_ProduceCardUpgrade' && value === 1 && effect.produceCardSearchId === 'p_card_search-deck_all' && (select || random))
      return { effect_type: select ? 'select_enhance' : 'card_enhance' };
    if (type === 'ProduceEffectType_ProduceCardChange' && value === 1 && effect.produceCardSearchId === 'p_card_search-deck_all-starter' && random)
      return { effect_type: 'card_change' };
    if (type === 'ProduceEffectType_ProduceCardDelete' && select && effect.produceCardSearchId === 'p_card_search-deck_all')
      return { effect_type: 'select_delete' };
  }
  const reward = effect?.produceRewards?.length === 1 && effect.produceRewards[0];
  if (type === 'ProduceEffectType_ProduceReward' && value === 1 && reward) {
    if (reward.resourceType === 'ProduceResourceType_ProduceItem') {
      const native = refs.items.get(reward.resourceId);
      if (native?.originSupportCardId === cardId && native.isUpgraded === false && reward.resourceLevel === 0) {
        card.p_item = providedItem(native, refs);
        return { effect_type: 'p_item' };
      }
    } else if (reward.resourceType === 'ProduceResourceType_ProduceCard') {
      const native = refs.cards.get(skillKey(reward.resourceId, reward.resourceLevel));
      if (native?.originSupportCardId === cardId && reward.resourceLevel === 0) {
        card.skill_card = { gameId: native.id, name: native.name, rarity: rarityOf(native.rarity)?.toLowerCase(),
          type: ({ ProduceCardCategory_ActiveSkill: 'active', ProduceCardCategory_MentalSkill: 'mental' })[native.category] ?? null,
          no_duplicate: native.noDeckDuplication };
        return { effect_type: 'skill_card' };
      }
    }
  }
  return { effect_type: 'unmapped', nativeEffectId: effect?.id ?? null };
}

function storyRewards(cardId, refs) {
  const card = { events: [], skill_card: null, p_item: null };
  const stories = refs.stories.get(cardId) ?? [];
  for (const row of [...stories].sort((a, b) => a.number - b.number)) {
    if (!Number.isInteger(row.supportCardLevel) || row.supportCardLevel < 1) continue;
    const detail = refs.details.get(row.produceStepEventDetailId);
    const release = row.supportCardLevel === 1 ? 'initial' : 'lv' + row.supportCardLevel;
    // A selectable story can contain mutually exclusive grants.
    if (detail?.supportCardId !== cardId || detail.suggestionType !== 'ProduceEventSuggestionType_Primary' ||
        detail.produceStepEventSuggestionIds?.length || !detail.produceEffectIds?.length) {
      card.events.push({ release, effect_type: 'unmapped', nativeStoryId: row.produceStepEventDetailId });
      continue;
    }
    for (const id of detail.produceEffectIds) card.events.push({ release, ...eventReward(refs.effects.get(id), cardId, card, refs) });
  }
  return card;
}

/** Enrich the private catalog being assembled for a single upstream revision. */
export function mergeLiveSupports(catalog, tables, { translations = {}, now = Date.now() } = {}) {
  const existing = index(catalog.supportCards, row => row.gameId);
  const refs = {
    kinds: knownKinds(catalog.supportCards), milestones: group(levelTables.flatMap(name => tables[name]), 'supportCardId'),
    skills: index(tables.ProduceSkill, row => skillKey(row.id, row.level)), effects: index(tables.ProduceEffect),
    triggers: index(tables.ProduceTrigger), stories: group(tables.ProduceEventSupportCard, 'supportCardId'),
    details: index(tables.ProduceStepEventDetail), items: index(tables.ProduceItem), itemEffects: index(tables.ProduceItemEffect),
    cards: index(tables.ProduceCard, row => skillKey(row.id, row.upgradeCount)),
    limits: group(tables.SupportCardLevelLimit, 'id'),
  };
  for (const raw of tables.SupportCard) {
    if (!/^s_card-\d+-\d+$/.test(raw.id) || !raw.name || !/^\d+$/.test(raw.viewStartTime) || Number(raw.viewStartTime) > now) continue;
    const stored = existing.get(raw.id);
    const fromLive = stored?.numericalSource === 'live_public_master';
    if (stored?.events?.length && stored.levelAbilities?.length && !fromLive) continue;
    const levels = refs.milestones.get(raw.id), limits = refs.limits.get(raw.supportCardLevelLimitId);
    const plan = normalizePlan(raw.planType), attribute = normalizeAttribute(raw.type);
    if (!levels?.length || !limits?.length || !/^ProducePlanType_(Common|Plan[123])$/.test(raw.planType) ||
      ![...axes, 'assist'].includes(attribute)) continue;
    const maxLevels = {};
    for (const row of limits) {
      const rank = /^SupportCardLevelLimitRank_(Unknown|_[1-4])$/.exec(row.rank)?.[1];
      if (rank && Number.isInteger(row.levelLimit) && row.levelLimit > 0) maxLevels[rank === 'Unknown' ? 0 : Number(rank.slice(1))] = row.levelLimit;
    }
    if (maxLevels[0] == null) continue;
    const nameKo = translations.supports?.[raw.id] ?? stored?.nameKo ?? null;
    const card = stored ?? { id: raw.id, gameId: raw.id, internalId: null, nameJa: raw.name, nameKo, name: nameKo || raw.name,
      rarity: rarityOf(raw.rarity), plan, attribute, maxLevels, characterIds: raw.characterIds, assetId: raw.assetId,
      imageUrl: null, thumbnailUrl: null, abilities: [], levelAbilities: [], events: [], p_item: null, skill_card: null,
      numericalSource: 'live_public_master', sourceConflict: false };
    if (fromLive) Object.assign(card, { nameJa: raw.name, nameKo, name: nameKo || raw.name, maxLevels,
      rarity: rarityOf(raw.rarity), plan, attribute, characterIds: raw.characterIds, assetId: raw.assetId });
    if (!card.levelAbilities?.length || fromLive) card.levelAbilities = [...levels].sort((a, b) => a.order - b.order || a.supportCardLevel - b.supportCardLevel)
      .map(row => levelAbility(row, refs));
    if (!card.events?.length || fromLive) Object.assign(card, storyRewards(raw.id, refs));
    if (!stored) { catalog.supportCards.push(card); existing.set(raw.id, card); }
  }
  if (catalog.indices) catalog.indices.supportCards = Object.fromEntries(existing);
}
