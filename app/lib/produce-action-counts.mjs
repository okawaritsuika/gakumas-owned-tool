import { SkillCards } from './vendor/gakumas-data/index.js';

const list = value => Array.isArray(value) ? value : [];
const managedKinds = ['skill_acquire', 'a_skill_acquire', 'm_skill_acquire', 'ssr_card_acquire',
  'consult_skill_card_acquire', 'skill_enhance', 'a_skill_enhance', 'm_skill_enhance',
  'delete', 'a_skill_delete', 'm_skill_delete', 'change', 'basic_card_change', 'customize',
  'p_drink_acquire', 'p_drink_exchange', 'p_item_acquire'];
const stageFor = action => action.stage ?? (action.fromExamIndex >= 3 ? 'final' : 'selection');
const keywordGroups = {
  good_condition: 'effect_group-visible-exam_parameter_buff-000',
  concentration: 'effect_group-visible-exam_lesson_buff-000',
  good_impression: 'effect_group-visible-exam_review-000',
  motivation: 'effect_group-visible-exam_card_play_aggressive-000',
  vitality: 'effect_group-visible-exam_block-000',
  reserve: 'effect_group-visible-exam_preservation-000',
  full_power: 'effect_group-visible-exam_full_power-000',
};
const thresholdKeywords = ['good_condition', 'concentration', 'good_impression', 'motivation', 'reserve', 'full_power'];
export const cardEffectKeywords = Object.freeze(Object.keys(keywordGroups));
export const cardHoldingKeywords = Object.freeze([...thresholdKeywords]);
const keywordOf = input => ({ goodCondition: 'good_condition', goodConditionTurns: 'good_condition',
  goodImpression: 'good_impression', goodImpressionTurns: 'good_impression', preservation: 'reserve',
  fullPower: 'full_power', fullPowerCharge: 'full_power' })[input] ?? input;
const knownCount = input => Number.isInteger(input) && input >= 0 ? input : null;
const categoryOf = input => ({ active: 'a', mental: 'm', trouble: 'other',
  ProduceCardCategory_ActiveSkill: 'a', ProduceCardCategory_MentalSkill: 'm', ProduceCardCategory_Trouble: 'other' })[input] ?? null;
const rarityOf = input => {
  const rarity = String(input ?? '').replace(/^ProduceCardRarity_/, '').toUpperCase();
  return ['N', 'R', 'SR', 'SSR', 'L', 'T', 'LEGEND'].includes(rarity) ? rarity : null;
};
export const normalizedCardType = input => ({a:'active',m:'mental',other:'trouble'})[categoryOf(input)] ?? null;
export const normalizedCardRarity = rarityOf;
export const normalizedCardKeyword = keywordOf;

export function actionKeywords(action, card) {
  if (Array.isArray(action.keywords)) {
    const keys = action.keywords.map(keywordOf);
    return keys.every(key => Object.hasOwn(keywordGroups, key)) ? new Set(keys) : null;
  }
  const groups = action.effectGroupIds ?? card?.effectGroupIds;
  if (!Array.isArray(groups)) return null;
  return new Set(Object.entries(keywordGroups).filter(([, group]) => groups.includes(group)).map(([key]) => key));
}

function keywordDeckCount(action, keyword) {
  // The native _8 trigger checks this keyword's cards, not total deck size.
  // Use an explicit count at the acquisition trigger; do not invent a deck
  // composition or assume whether an incoming batch crosses the threshold.
  if (action.quantity > 1 && !action.keywordCardCountsAtTrigger) return null;
  const counts = action.keywordCardCountsAtTrigger ?? action.keywordCardCountsAfter;
  if (!counts || typeof counts !== 'object') return null;
  for (const [key, count] of Object.entries(counts)) if (keywordOf(key) === keyword) return knownCount(count);
  return null;
}

/** Counts for a declared recipe, never an estimate of random acquisition rates. */
export function declaredProduceActionCounts(actions, catalog, { examIndex = 5, stage = null, knownMinimum = false } = {}) {
  const counts = Object.fromEntries(managedKinds.map(kind => [kind, 0]));
  const unresolved = new Set();
  for (const keyword of cardEffectKeywords) for (const suffix of ['card_acquire', 'card_enhance', 'card_delete']) counts[`${keyword}_${suffix}`] = 0;
  for (const keyword of thresholdKeywords) counts[`${keyword}_card_acquire_8`] = 0;
  counts.sp_lesson_20 = 0;
  for (const action of list(actions)) {
    if (!Number.isInteger(action.fromExamIndex) || action.fromExamIndex < 0 || action.fromExamIndex > examIndex || stage && stageFor(action) !== stage) continue;
    const quantity = Number.isInteger(action.quantity) && action.quantity > 0 ? action.quantity : 1;
    if (action.cardTargetResolved === true && action.triggerCounts) {
      for (const [kind, amount] of Object.entries(action.triggerCounts)) {
        if (amount === null) unresolved.add(kind);
        else if (Number.isInteger(amount) && amount >= 0) counts[kind] = (counts[kind] ?? 0) + amount;
      }
      continue;
    }
    const card = list(catalog.skillCards).find(card => card.gameId === action.gameId && (card.upgradeCount ?? 0) === (action.upgradeCount ?? 0));
    let definition;
    try { definition = card?.internalId != null ? SkillCards.getById(Number(card.internalId)) : null; } catch {}
    const category = categoryOf(action.category ?? action.type ?? card?.type ?? definition?.type);
    const rarity = rarityOf(action.rarity ?? card?.rarity ?? definition?.rarity);
    const addTyped = suffix => {
      for (const type of ['a', 'm']) {
        const key = `${type}_skill_${suffix}`;
        if (category === null) unresolved.add(key);
        else if (category === type) counts[key] += quantity;
      }
    };
    if (['acquire', 'upgrade', 'remove'].includes(action.action)) {
      const keywords = actionKeywords(action, card), suffix = { acquire:'card_acquire', upgrade:'card_enhance', remove:'card_delete' }[action.action];
      for (const keyword of Object.keys(keywordGroups)) {
        const key = `${keyword}_${suffix}`;
        if (keywords === null) unresolved.add(key);
        else if (keywords.has(keyword)) counts[key] += quantity;
      }
    }
    if (action.action === 'acquire') {
      counts.skill_acquire += quantity;
      addTyped('acquire');
      if (rarity === null) unresolved.add('ssr_card_acquire');
      else if (rarity === 'SSR') counts.ssr_card_acquire += quantity;
      if (action.venue === 'consult' || action.venue === 'consultation') counts.consult_skill_card_acquire += quantity;
      // Once eight related cards are held, acquisition of any skill can
      // trigger this ability; the acquired card need not share the keyword.
      for (const keyword of thresholdKeywords) {
        const key = `${keyword}_card_acquire_8`, held = keywordDeckCount(action, keyword);
        if (held === null) unresolved.add(key);
        else if (held >= 8) counts[key] += quantity;
      }
    } else if (action.action === 'upgrade') {
      counts.skill_enhance += quantity;
      addTyped('enhance');
    } else if (action.action === 'remove') {
      counts.delete += quantity;
      addTyped('delete');
    } else if (action.action === 'change') {
      counts.change += quantity;
      const sourceType = action.sourceType ?? card?.sourceType ?? definition?.sourceType;
      const basic = typeof action.basicCard === 'boolean' ? action.basicCard : sourceType === 'default' ? true
        : ['produce', 'pIdol', 'support'].includes(sourceType) ? false : null;
      if (basic === null) unresolved.add('basic_card_change');
      else if (basic) counts.basic_card_change += quantity;
    } else if (action.action === 'customize') counts.customize += quantity;
    else if (action.action === 'drink_acquire') counts.p_drink_acquire += quantity;
    else if (action.action === 'drink_exchange') {
      counts.p_drink_acquire += quantity;
      if (action.venue!=='interval') counts.p_drink_exchange += quantity;
    }
    else if (action.action === 'item_acquire') counts.p_item_acquire += quantity;
    else if (action.action === 'lesson_end') {
      if (action.isSpLesson === false) continue;
      const size = knownCount(action.beforeDeckSize ?? action.deckSize);
      if (action.isSpLesson !== true || size === null) unresolved.add('sp_lesson_20');
      else if (size >= 20) counts.sp_lesson_20 += quantity;
    }
  }
  // In an explicitly conditional peak plan, a known matching card can still
  // be scored when a second random card has unknown rarity/category/keywords.
  // Unknown-only triggers remain unknown, including in that peak plan.
  for (const key of unresolved) if (!knownMinimum || !counts[key]) counts[key] = null;
  return counts;
}

/** Add only actions occurring before the requested exam to both produce splits. */
export function withDeclaredProduceActions(route, actions, catalog, { examIndex = 5, examDeckSizes = null } = {}) {
  const hasActions = Array.isArray(actions);
  if (!hasActions && !Array.isArray(examDeckSizes)) return route;
  const explicit = list(actions);
  const lessons = list(route.selections).filter(row => row.main).map(row => {
    const state = explicit.find(action => action.action === 'lesson_end' && action.week === row.week && stageFor(action) === stageFor(row));
    return { ...row, action: 'lesson_end', isSpLesson: row.isSpLesson ?? true, ...state };
  });
  const countActions = [...explicit.filter(action => action.action !== 'lesson_end' || !lessons.some(row => row.week === action.week && stageFor(row) === stageFor(action))), ...lessons];
  const knownMinimum = Boolean(route.supportPeakScenario);
  const total = hasActions ? declaredProduceActionCounts(countActions, catalog, { examIndex, knownMinimum }) : {};
  const stages = route.stages ? Object.fromEntries(Object.entries(route.stages).map(([stage, part]) => [stage, {
    ...part, counts: { ...part.counts, ...(hasActions ? declaredProduceActionCounts(countActions, catalog, { examIndex, stage, knownMinimum }) : {}) },
  }])) : undefined;
  // Only completed exams can grant this bonus. Never add an exam's own
  // reward to its input stats, and never infer deck size from memory count.
  if (Array.isArray(examDeckSizes)) {
    const required = Math.min(examIndex, 5), preceding = examDeckSizes.slice(0, required);
    const countExams = (sizes, length) => sizes.length === length && sizes.every(size => knownCount(size) !== null)
      ? sizes.filter(size => size >= 15).length : null;
    total.exam_15 = countExams(preceding, required);
    if (stages) {
      stages.selection.counts.exam_15 = countExams(preceding.slice(0, 3), Math.min(required, 3));
      stages.final.counts.exam_15 = countExams(preceding.slice(3), Math.max(0, required - 3));
    }
  }
  return { ...route, counts: { ...route.counts, ...total }, ...(stages ? { stages } : {}),
    produceActions: explicit.filter(action => Number.isInteger(action.fromExamIndex) && action.fromExamIndex <= examIndex),
    explicitActionCounts: total, actionCountBasis: 'declared_conditional_route_not_random_expectation' };
}
