import { actionKeywords, cardEffectKeywords, cardHoldingKeywords, normalizedCardType, normalizedCardRarity, normalizedCardKeyword } from './produce-action-counts.mjs';

const cardActions = new Set(['acquire', 'upgrade', 'remove', 'change', 'copy', 'customize']);
const stages = ['selection', 'final'];
const byCatalog = new WeakMap(), byPlan = new WeakMap(), planCatalogs = new WeakMap(), acquiredCards = new WeakMap();
const list = value => Array.isArray(value) ? value : [];
const quantity = op => Number.isInteger(op.quantity) && op.quantity > 0 ? op.quantity : 1;
const stageOf = op => op.stage ?? (op.fromExamIndex >= 3 ? 'final' : 'selection');
const typed = { active: 'a', mental: 'm', trouble: 'other' };
const allKinds = ['skill_acquire', 'a_skill_acquire', 'm_skill_acquire', 'ssr_card_acquire', 'consult_skill_card_acquire',
  'skill_enhance', 'a_skill_enhance', 'm_skill_enhance', 'delete', 'a_skill_delete', 'm_skill_delete', 'basic_card_change',
  'change', 'copy', 'customize', 'sp_lesson_20', 'exam_15', ...cardHoldingKeywords.map(key => key + '_card_acquire_8'),
  ...cardEffectKeywords.flatMap(key => ['acquire', 'enhance', 'delete'].map(suffix => key + '_card_' + suffix))];
const emptyCounts = Object.fromEntries(allKinds.map(key => [key, 0]));
const zeroCounts = () => ({...emptyCounts});
const triggerNames = Object.fromEntries(['acquire','enhance','delete','undefined'].map(suffix => [suffix, {
  active:'a_skill_'+suffix, mental:'m_skill_'+suffix, trouble:'other_skill_'+suffix,
  keywords:Object.fromEntries(cardEffectKeywords.map(word=>[word,word+'_card_'+suffix])),
}]));
const holdingTriggers = Object.fromEntries(cardHoldingKeywords.map(word=>[word,word+'_card_acquire_8']));
const emptyHoldings = Object.fromEntries(cardHoldingKeywords.map(word=>[word,0]));

function catalogue(catalog) {
  if (!byCatalog.has(catalog)) {
    const skills = new Map();
    for (const row of list(catalog.skillCards)) {
      if (!skills.has(row.gameId)) skills.set(row.gameId, new Map());
      skills.get(row.gameId).set(row.upgradeCount ?? 0, row);
    }
    byCatalog.set(catalog, { skills, descriptors: new Map() });
  }
  return byCatalog.get(catalog);
}

/** A small serializable record that can travel with a support reward. */
export function cardTargetDescriptor(catalog, gameId, upgradeCount = 0) {
  if (!catalog || !gameId) return null;
  const { skills, descriptors } = catalogue(catalog), key = gameId + ':' + upgradeCount;
  if (descriptors.has(key)) return descriptors.get(key);
  const levels = skills.get(gameId);
  const row = levels?.get(upgradeCount ?? 0);
  if (!row) return null;
  let keywords = actionKeywords(row, row);
  if (upgradeCount == null && keywords) {
    for (const variant of levels.values()) {
      const other = actionKeywords(variant, variant);
      if (!other || [...keywords].some(k => !other.has(k)) || other.size !== keywords.size) { keywords = null; break; }
    }
  }
  const customData = catalog.produceResources?.hif?.cardCustomizations, variant = customData?.variants?.[key];
  const customs = Object.fromEntries(list(variant?.ids).filter(id => Array.isArray(customData.prices[id])).map(id => [id,customData.prices[id]]));
  const result = { gameId, upgradeCount, type: normalizedCardType(row.type), rarity: normalizedCardRarity(row.rarity), sourceType: row.sourceType ?? null,
    noDeckDuplication: row.noDeckDuplication ?? null, keywords: keywords ? [...keywords] : null, customs, customMax:variant?.max ?? 0,
    canDelete: row.canDelete ?? row.removalEligible ?? null, canChange: row.canChange ?? null, canCopy: row.canCopy ?? null };
  if (upgradeCount === 0 && levels.has(1)) result.upgraded = cardTargetDescriptor(catalog, gameId, 1);
  descriptors.set(key, result);
  return result;
}

function suppliedCard(op, native) {
  const input = op.card ?? op;
  const keys = actionKeywords(input, native);
  return { ...native, ...op.card, gameId: input.gameId ?? native?.gameId ?? null,
    type: normalizedCardType(input.type ?? input.category ?? op.type ?? op.category ?? native?.type),
    rarity: normalizedCardRarity(input.rarity ?? op.rarity ?? native?.rarity),
    upgradeCount: input.upgradeCount ?? native?.upgradeCount ?? null, sourceType: input.sourceType ?? native?.sourceType ?? null,
    noDeckDuplication: input.noDeckDuplication ?? native?.noDeckDuplication ?? (op.uniqueKey ? true : null),
    uniqueKey: op.uniqueKey ?? native?.uniqueKey ?? null,
    customized: Array.isArray(op.customizes) ? Object.fromEntries(op.customizes.map(v => [v.id,v.customizeCount])) : native?.customized,
    customStateUnknown: (op.venue === 'memory' || op.basis === 'selected_memory_receipt') && !Array.isArray(op.customizes),
    keywords: keys ? [...keys] : native?.keywords ?? null };
}

const isExam = row => row.activity === 'mid_exam' || row.activity === 'final_exam';
const orderOf = row => row.beforeCheckpoint || row.timing === 'before_lesson' || row.timing === 'before_exam' ? -2
  : row.action === 'exam' || row.action === 'lesson_end' ? 0 : row.order ?? 1;
const timeOrder = (a, b) => a.week - b.week || a.fromExamIndex - b.fromExamIndex || orderOf(a) - orderOf(b)
  || (a.providerId && b.providerId ? Number(b.action === 'acquire') - Number(a.action === 'acquire')
    || String(a.id ?? a.providerId).localeCompare(String(b.id ?? b.providerId)) : 0);
function timed(plan, op) {
  const stage = stageOf(op);
  const index = Number.isInteger(op.fromExamIndex) ? op.fromExamIndex : Number.isFinite(op.week)
    ? (plan.schedule.find(row => row.week === op.week)?.fromExamIndex ?? (stage === 'final' ? 3 : 0)) : stage === 'final' ? 3 : 0;
  // Undated declarations apply at the end of their stated exam interval.
  const week = Number.isFinite(op.week) ? op.week : (plan.schedule.find(row => isExam(row) && row.fromExamIndex === index)?.week
    ?? (plan.schedule.at(-1)?.week ?? 0) + 1) - 0.25;
  const type = normalizedCardType(op.type ?? op.category), rarity = normalizedCardRarity(op.rarity);
  return { ...op, ...(type?{type}:{}), ...(rarity?{rarity}:{}), ...(op.keyword?{keyword:normalizedCardKeyword(op.keyword)}:{}), stage, week, fromExamIndex: index };
}
function uniqueUpgrade(idol, gameId) {
  const rank = idol?.owned?.uncap ?? idol?.owned?.levelLimitRank ?? idol?.owned?.raw?.levelLimitRank;
  if (idol?.uniqueIds?.produceCardId !== gameId || !Number.isInteger(rank) || !Array.isArray(idol.specialTrainingStages)) return null;
  return idol.specialTrainingStages.filter(stage => stage.rank <= rank && list(stage.effectTypes).includes('IdolCardLevelLimitEffectType_ProduceCardUpgrade')).length;
}

/** Compile only ordinary HIF's known starting template and the reached actions. */
export function buildCardTargetPlan(catalog, route, actions, options = {}) {
  const idol = options.hifSelectedIdol;
  const profile = list(catalog?.produceInitialDecks?.idolProfiles).find(row => row.idolCardId === idol?.gameId);
  const deck = catalog?.produceInitialDecks?.decks?.[profile?.scenarioDeckIds?.['produce-007']];
  if (!deck?.cardSlots?.length || deck.cardCount !== deck.cardSlots.length || !Array.isArray(profile?.uniqueCardIds)) return null;
  const start = [...deck.cardSlots.map(slot => ({ gameId: slot.cardId, upgradeCount: slot.upgradeCount ?? null })),
    ...[...new Set(profile.uniqueCardIds)].map(gameId => ({ gameId, upgradeCount: uniqueUpgrade(idol, gameId) }))];
  const plan = { start: start.map(slot => cardTargetDescriptor(catalog, slot.gameId, slot.upgradeCount) ?? slot), horizon: options.examIndex ?? 5,
    schedule: list(route.selections).map(row => ({week:row.week, stage:row.stage, fromExamIndex:row.fromExamIndex,
      activity:row.activity, main:row.main, isSpLesson:row.isSpLesson})),
    explicitExamSizes:Array.isArray(options.examDeckSizes) ? options.examDeckSizes : null, ops: [] };
  planCatalogs.set(plan,catalog);
  for (const raw of list(actions)) {
    if (!cardActions.has(raw.action) || raw.cardTargetResolved) continue;
    const op = { ...raw };
    if (op.action === 'acquire') {
      op.card = suppliedCard(op, cardTargetDescriptor(catalog, op.gameId, op.upgradeCount ?? 0));
      if (op.selectableReward && Array.isArray(op.rewardGameIds)) {
        const planType = options.supportPeakPlan ?? options.plan ?? idol?.plan;
        op.rewardPool = op.rewardGameIds.filter(id => {
          const base = catalogue(catalog).skills.get(id)?.get(op.upgradeCount ?? 0);
          return base && base.sourceType === 'produce' && base.recommendationEligible !== false
            && (!base.plan || base.plan === 'free' || base.plan === planType)
            && (!op.rarity || base.rarity === op.rarity.toUpperCase())
            && (!base.unlockProducerLevel || Number.isInteger(options.producerLevel) && options.producerLevel >= base.unlockProducerLevel);
        }).map(id => cardTargetDescriptor(catalog,id,op.upgradeCount ?? 0));
      }
    }
    if (op.action === 'change' && (op.resultGameId || Array.isArray(op.resultGameIds))) {
      const ids = op.resultGameId ? [op.resultGameId] : op.resultGameIds;
      op.resultVariants = [0,1].map(level => ids.map(id => cardTargetDescriptor(catalog,id,level)).filter(Boolean));
    }
    plan.ops.push(timed(plan, op));
  }
  for (const row of plan.schedule) {
    if (row.main) {
      const state = list(actions).find(op => op.week === row.week && op.action === 'lesson_end');
      plan.ops.push({ ...row, ...state, action:'lesson_end' });
    } else if (isExam(row)) plan.ops.push({ ...row, action:'exam' });
  }
  plan.ops.sort(timeOrder);
  plan.baseline = resolveCardTargets(plan, [], {details:true, weights:options.cardTargetWeights});
  return plan;
}

/** The target exam awards no stats before its own start. */
export function cardTargetPlanAtExam(plan, examIndex) {
  if (!plan || examIndex == null || examIndex >= plan.horizon) return plan;
  const prefix = { ...plan, horizon:examIndex, baseline:null };
  if (planCatalogs.has(plan)) planCatalogs.set(prefix,planCatalogs.get(plan));
  prefix.baseline = resolveCardTargets(prefix, [], {details:true});
  return prefix;
}

const suffixOf = { acquire:'acquire', copy:'acquire', upgrade:'enhance', remove:'delete' };
const roleOf = { starter:'default', basic:'default' };
/** Potential recipients for candidate discovery. Actual triggers come from the physical replay. */
export function possibleCardOperationTriggers(op) {
  const receipt = op.action === 'acquire' || op.action === 'copy' && op.countsAsAcquisition === true;
  if (op.action === 'change') return ['change','basic_card_change'];
  if (op.action === 'customize') return ['customize'];
  if (op.action === 'copy' && !receipt) return ['copy','sp_lesson_20','exam_15'];
  const suffix = suffixOf[op.action];
  if (!suffix) return [];
  const category = typed[op.target] ?? typed[op.card?.type ?? op.type];
  const roles = category ? [category] : ['a','m'];
  const keys = op.action === 'acquire' ? (op.card?.keywords ?? op.keywords ?? []) : cardEffectKeywords;
  const ssr = op.action === 'copy' || (op.card?.rarity ?? op.rarity)?.toUpperCase() === 'SSR';
  return [...(receipt ? ['skill_acquire',...(ssr ? ['ssr_card_acquire'] : []),'exam_15','sp_lesson_20',...cardHoldingKeywords.map(k => k+'_card_acquire_8')]
    : [op.action === 'upgrade' ? 'skill_enhance' : 'delete']),
    ...roles.filter(role => role !== 'other').map(role => role+'_skill_'+suffix), ...keys.map(k => k+'_card_'+suffix)];
}
function matches(op, card) {
  const wanted = op.target ?? (op.action === 'acquire' ? 'any' : op.sourceType === 'default' || op.basicCard === true ? 'starter' : 'any');
  if (op.gameId && op.gameId !== card.gameId) return false;
  if (op.targetUpgradeCount != null && op.targetUpgradeCount !== card.upgradeCount) return false;
  if (op.rarity && op.rarity.toUpperCase() !== card.rarity) return false;
  if (roleOf[wanted] && card.sourceType !== roleOf[wanted]) return false;
  if (wanted in typed && card.type !== wanted) return false;
  if (wanted === 'non_trouble' && !['active','mental'].includes(card.type)) return false;
  if (!['any','non_trouble'].includes(wanted) && !(wanted in typed) && !roleOf[wanted] && wanted !== card.gameId) return false;
  const type = op.type ?? op.category;
  if (type && type !== card.type) return false;
  if (op.keyword && !card.keywords?.includes(op.keyword)) return false;
  if (op.action === 'upgrade') return Boolean(card.upgraded && card.upgradeCount === 0);
  if (op.action === 'remove') return card.canDelete !== false && (card.canDelete === true || card.sourceType === 'default'
    || card.type === 'trouble' && (wanted === 'trouble' || op.allowTroubleTarget === true || op.venue === 'consult')
    || card.sourceType === 'produce' && ['active','mental'].includes(card.type) && card.rarity !== 'L');
  if (op.action === 'change') return card.canChange !== false && (card.canChange === true || card.sourceType === 'default'
    || card.type === 'trouble' && op.allowTroubleTarget === true
    || card.sourceType === 'produce' && card.type && card.type !== 'trouble' && card.rarity !== 'L');
  if (op.action === 'copy') return card.canCopy !== false && card.noDeckDuplication === false && Boolean(card.gameId);
  if (op.action === 'customize') return Boolean(nextCustom(card, op));
  return false;
}
function nextCustom(card, op) {
  if (card.customStateUnknown || Object.values(card.customized ?? {}).reduce((sum,n) => sum + n,0) >= (card.customMax ?? 0)) return null;
  let best = null;
  for (const [id, prices] of Object.entries(card.customs ?? {})) {
    const level = (card.customized?.[id] ?? 0) + 1, cost = prices[level - 1];
    if (op.customizationId && op.customizationId !== id || op.customizationLevel != null && op.customizationLevel !== level
      || !Number.isInteger(cost) || cost < 0 || cost > (op.maxPPCost ?? Infinity)) continue;
    if (!best || cost < best.cost || cost === best.cost && id < best.id) best = {id,level,cost};
  }
  return best;
}
function couldBeUnknownTarget(op, card) {
  if (op.gameId && card.gameId && op.gameId !== card.gameId) return false;
  if (op.rarity && card.rarity && op.rarity.toUpperCase() !== card.rarity) return false;
  const target = op.target ?? (op.basicCard === true || op.sourceType === 'default' ? 'starter' : 'any');
  const wantedType = target in typed ? target : op.type ?? op.category;
  if (card.type && wantedType && wantedType !== card.type || target === 'non_trouble' && card.type === 'trouble') return false;
  if (roleOf[target] && card.sourceType && card.sourceType !== roleOf[target]) return false;
  if (op.keyword && Array.isArray(card.keywords) && !card.keywords.includes(op.keyword)) return false;
  if (op.action === 'upgrade' && card.upgradeCount >= 1 || op.action === 'copy' && (card.noDeckDuplication || card.canCopy === false)
    || op.action === 'remove' && card.canDelete === false || op.action === 'change' && card.canChange === false) return false;
  return !card.gameId || !card.type || (op.action === 'upgrade' && card.upgradeCount == null)
    || (op.action === 'customize' && card.customMax > 0 && card.customStateUnknown) || (op.action === 'copy' && card.noDeckDuplication == null);
}
function targetValue(op, card, weights) {
  const suffix = suffixOf[op.action];
  const names = triggerNames[suffix], category = typed[card.type];
  let score = category ? weights[names[card.type]] ?? 0 : 0;
  for (const key of card.keywords ?? []) score += weights[Object.hasOwn(names.keywords,key) ? names.keywords[key] : key+'_card_'+suffix] ?? 0;
  if ((op.action === 'acquire' || op.action === 'copy' && op.countsAsAcquisition) && card.rarity === 'SSR') score += weights.ssr_card_acquire ?? 0;
  if (op.action === 'change' && card.sourceType === 'default') score += weights.basic_card_change ?? 0;
  // For the same operation bonus preserve known holdings with a later reward.
  if (op.action === 'remove' || op.action === 'change')
    for (const key of card.keywords ?? []) score -= weights[Object.hasOwn(holdingTriggers,key) ? holdingTriggers[key] : key+'_card_acquire_8'] ?? 0;
  return score;
}
function hasWeightedTargets(action, weights) {
  const suffix = suffixOf[action];
  return Object.keys(weights).some(key => weights[key] && (
    suffix && (key === 'a_skill_' + suffix || key === 'm_skill_' + suffix || key.endsWith('_card_' + suffix))
    || (action === 'acquire' || action === 'copy') && key === 'ssr_card_acquire'
    || action === 'change' && key === 'basic_card_change'
    || (action === 'remove' || action === 'change') && key.endsWith('_card_acquire_8')));
}
function replacementFor(op,target,deck,weights) {
  const candidates=op.resultCard?[op.resultCard]:op.resultVariants?.[target.upgradeCount];
  let best, bestValue=-Infinity;
  for (const card of candidates ?? []) {
    if (card.gameId===target.gameId || op.resultRarity && op.resultRarity.toUpperCase()!==card.rarity
      || card.noDeckDuplication && deck.some(member=>member!==target&&member.gameId===card.gameId)) continue;
    const points=(card.keywords??[]).reduce((n,k)=>n+(weights[k+'_card_acquire_8']??0),0);
    if (!best || points>bestValue || points===bestValue && card.gameId<best.gameId) {best=card;bestValue=points;}
  }
  return best;
}
function emitTypedTriggers(card, suffix, general, emit, receipt = false) {
  const names = triggerNames[suffix];
  if (!typed[card.type]) { emit(names.active,null); emit(names.mental,null); }
  else if (card.type === 'active' || card.type === 'mental') emit(names[card.type]);
  for (const key of cardEffectKeywords) {
    if (!card.keywords) emit(names.keywords[key],null);
    else if (card.keywords.includes(key)) emit(names.keywords[key]);
  }
  if (receipt) {
    if (card.rarity === 'SSR') emit('ssr_card_acquire');
    else if (!card.rarity) emit('ssr_card_acquire',null);
  }
  emit(general);
}

/** Replay one deck. Only a successful physical operation emits triggers. */
export function resolveCardTargets(plan, additional = [], { weights = {}, details = false } = {}) {
  if (!plan) return null;
  weights ??= {};
  if (!additional.length && !Object.keys(weights).length && plan.baseline) return plan.baseline;
  let cache = byPlan.get(plan);
  if (!cache) {
    cache = {results:new Map(), ids:new Map(), refs:new WeakMap(), timed:new WeakMap(), nextId:0};
    byPlan.set(plan, cache);
  }
  // Fixed source operations occur in many partial decks. Intern each once,
  // including its complete descriptor; dynamic item operations can reuse the
  // same key when their trigger, week and recipient are unchanged.
  const tokens = additional.map(op => {
    if (cache.refs.has(op)) return cache.refs.get(op);
    const signature = JSON.stringify(op);
    if (!cache.ids.has(signature)) {
      if (cache.ids.size >= 1024) cache.ids.delete(cache.ids.keys().next().value);
      cache.ids.set(signature,++cache.nextId);
    }
    const token = cache.ids.get(signature);
    cache.refs.set(op,token);
    return token;
  });
  const key = JSON.stringify([tokens,weights,details]);
  if (cache.results.has(key)) return cache.results.get(key);
  const cutoff = plan.schedule.find(row => isExam(row) && row.fromExamIndex === plan.horizon)?.week ?? Infinity;
  const catalog=planCatalogs.get(plan);
  const timeline = [...plan.ops, ...additional.map(raw => {
    if (cache.timed.has(raw)) return cache.timed.get(raw);
    const op=timed(plan,raw);
    if(op.action==='acquire'&&op.gameId&&!op.card) op.card=cardTargetDescriptor(catalog,op.gameId,op.upgradeCount??0);
    if(op.action==='change'&&op.resultGameId&&!op.resultCard&&!op.resultVariants)
      op.resultVariants=[0,1].map(level=>[cardTargetDescriptor(catalog,op.resultGameId,level)].filter(Boolean));
    cache.timed.set(raw,op);
    return op;
  })].filter(op =>
    op.fromExamIndex <= plan.horizon && op.week < cutoff).sort(timeOrder);
  const deck = plan.start.map((card, slot) => ({ ...card, slot }));
  let nextSlot = deck.length;
  const counts = zeroCounts(), byStage = { selection: zeroCounts(), final: zeroCounts() };
  const unknown = {selection:new Set(), final:new Set()}, unresolved = [], actions = [], examDeckSizes = [], lessonDeckSizes = [];
  const spentPP = {selection:0,final:0}, paidUses = {upgrade:0,remove:0};
  const weighted = {};
  const holds = {...emptyHoldings};
  let unknownHoldings = 0, possibleForcedRemovals = 0, possibleForcedCopies = 0;
  function track(card, delta) {
    if (!Array.isArray(card.keywords)) unknownHoldings += delta;
    else for (const key of card.keywords) if (key in holds) holds[key] += delta;
  }
  for (const card of deck) track(card, 1);
  // Totals are always needed. Only a detailed replay needs a per-action dictionary too.
  let stageCounts, stageUnknown, actionCounts;
  function emit(kind, amount = 1) {
    if (actionCounts) actionCounts[kind] = amount;
    if (amount === null) stageUnknown.add(kind);
    else { stageCounts[kind] += amount; counts[kind] += amount; }
  }
  const mandatory = op => op.action === 'remove' && (op.sourceType === 'default' || op.target === 'starter')
    && (op.venue === 'exam_reward' || op.required === true);
  let reserved = timeline.filter(mandatory).reduce((sum, op) => sum + quantity(op), 0);
  for (const op of timeline) {
    const stage = stageOf(op);
    stageCounts = byStage[stage];
    stageUnknown = unknown[stage];
    actionCounts = null;
    if (op.action === 'exam' || op.action === 'lesson_end') {
      const exam = op.action === 'exam';
      const declared = exam ? plan.explicitExamSizes?.[op.fromExamIndex] : op.beforeDeckSize ?? op.deckSize;
      const explicitSize = Number.isInteger(declared), size = explicitSize ? declared : deck.length;
      const minimum = explicitSize ? size : Math.max(0,size-possibleForcedRemovals), maximum = explicitSize ? size : size+possibleForcedCopies;
      const threshold = exam ? 15 : 20;
      (exam ? examDeckSizes : lessonDeckSizes).push(minimum === maximum ? size : null);
      if ((exam || op.isSpLesson !== false) && maximum >= threshold)
        emit(exam ? 'exam_15' : 'sp_lesson_20', minimum >= threshold ? 1 : null);
      continue;
    }
    if (!cardActions.has(op.action)) continue;
    const forced = mandatory(op), attempts = quantity(op);
    const touched = attempts > 1 && op.action !== 'acquire' ? new Set() : null;
    const funded = op.basis === 'conditional_retry_route_purchase' && Number.isFinite(op.routeBudgetPP);
    let remainingPP = Math.min(op.maxPPCost ?? Infinity, funded ? op.routeBudgetPP - spentPP[stage] : Infinity);
    if (forced) reserved -= attempts;
    for (let i = 0; i < attempts; i++) {
      const beforeDeckSize = deck.length;
      let target, affected, custom, replacement;
      const steppedPrice = funded && ['upgrade','remove'].includes(op.action) && Array.isArray(op.purchasePrices);
      const priceBand = steppedPrice ? op.purchasePrices[paidUses[op.action]] : null;
      const expectedCost = steppedPrice ? (Number.isFinite(priceBand?.max)
        ? Math.floor(priceBand.max*(1000-(op.discountPermil??0))/1000) : null) : Number.isFinite(op.ppCost)
        ? Math.floor(op.ppCost*(i+1)/quantity(op))-Math.floor(op.ppCost*i/quantity(op)) : 0;
      if (funded && op.action!=='customize' && (expectedCost == null || expectedCost > remainingPP)) {
        if(details) unresolved.push({sourceId:op.sourceId??op.id,action:op.action,week:op.week,
          quantity:quantity(op)-i,reason:expectedCost==null?'unverified_price':'insufficient_pp'});
        break;
      }
      if (op.action === 'acquire') {
        const pool = list(op.rewardPool).filter(card => !card.noDeckDuplication || !deck.some(row => row.gameId === card.gameId));
        if (Array.isArray(op.rewardPool) && !pool.length) {
          if (details) unresolved.push({sourceId:op.sourceId ?? op.id, action:op.action, week:op.week, reason:'no_eligible_reward'});
          continue;
        }
        affected = pool.sort((a,b) => targetValue(op,b,weights)-targetValue(op,a,weights) || a.gameId.localeCompare(b.gameId))[0];
        if (!affected) {
          if (!acquiredCards.has(op)) acquiredCards.set(op,suppliedCard(op,op.card));
          affected = acquiredCards.get(op);
        }
        if (affected.noDeckDuplication && deck.some(card => affected.gameId && card.gameId === affected.gameId
          || affected.uniqueKey && affected.uniqueKey === card.uniqueKey)) {
          if (details) unresolved.push({sourceId:op.sourceId ?? op.id,action:op.action,reason:'duplicate_unique_card',week:op.week});
          continue;
        }
      } else {
        const protectsStarters = !forced && reserved > 0 && ['remove','change'].includes(op.action)
          && deck.filter(card => card.sourceType === 'default').length <= reserved;
        const flexibleClass = op.action === 'change' && op.venue === 'class_work_end' && op.basis === 'planned_route_opportunity';
        const filter = flexibleClass ? {...op,basicCard:false,target:'any'} : op.action === 'customize' ? {...op,maxPPCost:remainingPP} : op;
        const rankTargets = weighted[op.action] ??= hasWeightedTargets(op.action,weights);
        let bestValue = -Infinity;
        for (const card of deck) {
          if (touched?.has(card.slot) || protectsStarters && card.sourceType === 'default' || !matches(filter,card)) continue;
          const candidateReplacement=op.action==='change' && (op.resultCard || op.resultVariants) ? replacementFor(op,card,deck,weights) : null;
          if (op.action==='change' && (op.resultCard || op.resultVariants) && !candidateReplacement) continue;
          const score = (rankTargets ? targetValue(op,card,weights) : 0) + (flexibleClass && card.sourceType === 'default' ? 0.01 : 0);
          if (score > bestValue) {target=card;bestValue=score;replacement=candidateReplacement;}
          if (!rankTargets && (!flexibleClass || card.sourceType === 'default')) break;
        }
        if (!target) {
          const possible = deck.some(card => !touched?.has(card.slot) && couldBeUnknownTarget(filter,card));
          if (possible) {
            for (const kind of possibleCardOperationTriggers(op)) if (!['exam_15','sp_lesson_20'].includes(kind)) unknown[stage].add(kind);
            if (forced || op.required === true) {
              if (op.action === 'remove') possibleForcedRemovals += quantity(op)-i;
              if (op.action === 'copy') possibleForcedCopies += quantity(op)-i;
            }
          }
          if (details) unresolved.push({sourceId:op.sourceId ?? op.id,providerId:op.providerId,action:op.action,
            reason:possible?'target_identity_unconfirmed':'no_verified_target',week:op.week,quantity:quantity(op)-i});
          break;
        }
        touched?.add(target.slot);
        affected = target;
      }
      actionCounts = details ? {} : null;
      if (op.action === 'acquire' || op.action === 'copy') {
        const added = {...affected,slot:nextSlot++};
        deck.push(added); track(added,1);
        if (op.action === 'copy') touched?.add(added.slot);
        if (op.action === 'acquire' || op.countsAsAcquisition === true) {
          emitTypedTriggers(added,'acquire','skill_acquire',emit,true);
          if (op.action === 'acquire' && ['consult','consultation'].includes(op.venue)) emit('consult_skill_card_acquire');
          const declared = op.keywordCardCountsAtTrigger ?? (quantity(op) === 1 ? op.keywordCardCountsAfter : null);
          const observed = declared && Object.fromEntries(Object.entries(declared).filter(([,value])=>Number.isInteger(value)&&value>=0)
            .map(([key,value])=>[normalizedCardKeyword(key),value]));
          for (const word of cardHoldingKeywords) {
            const held = observed?.[word] ?? holds[word];
            if (held >= 8) emit(holdingTriggers[word]);
            else if (observed?.[word] == null && held + unknownHoldings >= 8) emit(holdingTriggers[word],null);
          }
        }
        if (op.action === 'copy') emit('copy');
      } else if (op.action === 'upgrade') {
        track(target,-1);
        affected = { ...target.upgraded, slot:target.slot, customized:target.customized };
        deck[deck.indexOf(target)] = affected; track(affected,1);
        emitTypedTriggers(affected,'enhance','skill_enhance',emit);
      } else if (op.action === 'remove') {
        deck.splice(deck.indexOf(target),1); track(target,-1);
        emitTypedTriggers(target,'delete','delete',emit);
      } else if (op.action === 'change') {
        // A change keeps enhancement. Its random replacement has no verified
        // identity, category or keyword until a result is supplied.
        track(target,-1);
        const changed = { ...replacement, rarity:replacement?.rarity ?? op.resultRarity?.toUpperCase() ?? null,
          upgradeCount:target.upgradeCount, slot:nextSlot++ };
        deck[deck.indexOf(target)] = changed; track(changed,1);
        touched?.add(changed.slot);
        emit('change');
        if (target.sourceType === 'default') emit('basic_card_change');
        else if (!target.sourceType) emit('basic_card_change',null);
      } else if (op.action === 'customize') {
        custom = nextCustom(target,{...op,maxPPCost:remainingPP});
        target.customized = {...target.customized,[custom.id]:custom.level};
        emit('customize');
      }
      const realizedCost = custom ? custom.cost : expectedCost;
      if (funded) {
        spentPP[stage] += realizedCost;
        if (steppedPrice) paidUses[op.action]++;
      }
      if (custom || funded) remainingPP -= realizedCost;
      if (details) {
        const id = op.id ?? op.sourceId ?? op.action + ':' + op.week;
        const accepted = {...op, gameId:affected.gameId ?? null, type:affected.type ?? null, rarity:affected.rarity ?? null,
          keywords:affected.keywords ?? null, upgradeCount:affected.upgradeCount, sourceType:affected.sourceType ?? null,
          id:quantity(op) > 1 ? id + ':' + i : id, originId:op.id ?? id, sourceId:op.sourceId ?? id, quantity:1,
          targetSlot:target?.slot ?? null, beforeDeckSize, afterDeckSize:deck.length, triggerCounts:actionCounts, cardTargetResolved:true};
        delete accepted.card; delete accepted.resultVariants; delete accepted.rewardPool;
        if (op.action==='change') Object.assign(accepted,{resultGameId:replacement?.gameId??null,resultRarity:replacement?.rarity??op.resultRarity??null});
        if (typeof op.ppCost === 'number' || funded) accepted.ppCost = realizedCost;
        if (steppedPrice) accepted.purchaseIndex = paidUses[op.action];
        if (custom) Object.assign(accepted,{customizationId:custom.id,customizationLevel:custom.level,ppCost:custom.cost});
        if (actionCounts.skill_acquire) accepted.keywordCardCountsAfter = {...holds};
        actions.push(accepted);
      }
    }
  }
  for (const stage of stages) for (const kind of unknown[stage]) {
    if (!Object.hasOwn(counts,kind)) continue;
    if (!counts[kind]) counts[kind] = null;
    if (!byStage[stage][kind]) byStage[stage][kind] = null;
  }
  const result = {counts,byStage,actions,unresolved,examDeckSizes,lessonDeckSizes,finalDeckSize:deck.length,
    unresolvedKinds:[...new Set([...unknown.selection,...unknown.final])]};
  if (cache.results.size >= 256) cache.results.delete(cache.results.keys().next().value);
  cache.results.set(key,result);
  return result;
}
