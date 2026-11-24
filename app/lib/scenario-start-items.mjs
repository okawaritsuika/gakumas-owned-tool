import source from '../data/catalog/scenario_start_items.json' with { type: 'json' };

const stages = {
  'hajime:master': { id: 'produce-003', dearness: 10 },
  'hajime:legend': { id: 'produce-006', dearness: 10, producerLevel: 50 },
  'nia:master': { id: 'produce-005', dearness: 20 },
};
const axes = ['vocal', 'dance', 'visual'];
const emptyEffects = () => ({ growthRatePermil: { vocal: 0, dance: 0, visual: 0 }, initialPP: 0 });
const emptyApplied = () => ({ ...emptyEffects(), actions: { skill_acquire: 0 }, produceActions: [] });
const emptyTotals = () => ({ lessonLimitUpScore: 0, auditionParameterGrowthRatePermil: 0 });
const costLabels = {
  AuditionNpcEnhance: ['라이벌 점수 증가', 'percent'],
  EventSchoolStaminaUp: ['수업 체력 소모 증가', 'percent'],
  BeforeAuditionRefreshStaminaDown: ['시험 전 체력 회복량 감소', 'percent'],
  ShopPriceUpMultiple: ['상담 가격 증가', 'percent'],
  ProducePointReduceFix: ['조건 발동 시 P포인트 소모', 'PP'],
  StaminaReduceFix: ['조건 발동 시 체력 소모', ''],
  ExamTurnDown: ['시험 턴 감소', '턴'],
};

function nativeItem(id) {
  const row = source.items[id], startEffects = emptyEffects(), costNotes = [];
  const effects = row.bindings.map(([triggerId, effectId]) => ({ ...source.effects[effectId], triggerId, effectId }));
  for (const effect of effects) {
    const { type, min, max, triggerId } = effect;
    if (min !== max || !Number.isFinite(min)) continue;
    if (['p_trigger-produce_start-initial', 'p_trigger-produce_start-no_description'].includes(triggerId)) {
      const axis = /^(Vocal|Dance|Visual)GrowthRateAddition$/.exec(type)?.[1].toLowerCase();
      if (axis) startEffects.growthRatePermil[axis] += min;
      if (type === 'ProducePointAddition') startEffects.initialPP += min;
    }
    if (Object.hasOwn(costLabels, type)) {
      const [label, unit] = costLabels[type];
      costNotes.push(label + ' ' + (unit === 'percent' ? min / 10 + '%' : min + unit));
    }
  }
  return { id, name: row.nameKo || row.nameJa, nameJa: row.nameJa, descriptionJa: row.descriptionJa,
    effects, startEffects, costNotes, fireLimit: row.fireLimit, fireInterval: row.fireInterval };
}
const items = new Map(Object.keys(source.items).map(id => [id, nativeItem(id)]));

function idsOption(value, key) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id) || new Set(value).size !== value.length) {
    throw new RangeError(key + '에는 서로 다른 챌린지 P아이템 ID 목록이 필요합니다.');
  }
  return value;
}
function knownInteger(value, min, max, label) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(label + '의 입력 범위를 확인해 주세요.');
  return value;
}
function combine(rows) {
  const totals = emptyTotals(), appliedEffects = emptyApplied();
  for (const row of rows) {
    totals.lessonLimitUpScore += row.lessonLimitUpScore;
    totals.auditionParameterGrowthRatePermil += row.auditionParameterGrowthRatePermil;
    appliedEffects.initialPP += row.startEffects.initialPP;
    if (row.routeEffects?.pp) appliedEffects.routePP = (appliedEffects.routePP ?? 0) + row.routeEffects.pp;
    if (row.routeEffects?.axis && row.routeEffects.amount) {
      const stats = appliedEffects.routeStats ??= { vocal: 0, dance: 0, visual: 0 };
      stats[row.routeEffects.axis] += row.routeEffects.amount;
    }
    appliedEffects.actions.skill_acquire += row.routeSupply?.count ?? 0;
    appliedEffects.produceActions.push(...(row.routeSupply?.produceActions ?? []));
    for (const axis of axes) appliedEffects.growthRatePermil[axis] += row.startEffects.growthRatePermil[axis];
  }
  applyNiaExchanges(rows, appliedEffects);
  return { totals, appliedEffects };
}

// A dated check describes the remaining basic cards immediately before the
// challenge rewards. Ordinary actions elsewhere in the week are separate.
const niaExchangeVenues = {
  'p_trigger-end_present-for_nia_master': 'supply_gift',
  'p_trigger-start_customize-for_nia_master': 'special_training',
  'p_trigger-end_step_event_activity-for_nia_master': 'outing',
  'p_trigger-end_shop-for_nia_master': 'consult',
  'p_trigger-end_step_event_business-produce_drink': 'company',
  'p_trigger-end_step_event_business-produce_card': 'commercial',
  'p_trigger-end_step_event_business-produce_point': 'municipal',
};
function niaExchange(item, route) {
  if (!route?.produceActions?.some(a=>a.action==='challenge_check') || item.fireInterval || item.fireLimit <= 0) return null;
  const deletion = item.effects.find(e => e.type === 'ProduceCardDelete' && e.cardSearchId === 'p_card_search-deck_all-starter' &&
    e.pickMin === 1 && e.pickMax === 1);
  const trigger = deletion?.triggerId, venue = niaExchangeVenues[trigger];
  if (!venue || !item.effects.some(e => e.triggerId === trigger && e.type === 'ProduceRewardSet' && e.resource === 'ProduceCard' &&
    e.pick === 'Select' && e.pickMin === 1 && e.pickMax === 1)) return null;
  const pp = item.effects.find(e=>e.triggerId===trigger && e.type==='ProducePointAddition' && e.min===e.max)?.min ?? 0;
  const dates = [];
  for (const day of route.selections ?? []) {
    if ((day.activity === 'business' ? day.venue : day.activity) !== venue) continue;
    const checks = route.produceActions.filter(a=>a.week===day.week && a.action==='challenge_check' && a.venue===venue);
    if (checks.length !== 1 || !Number.isSafeInteger(checks[0].basicCardCountBeforeChallenge) ||
      checks[0].basicCardCountBeforeChallenge < 1 || !Number.isInteger(checks[0].fromExamIndex)) continue;
    dates.push({week:day.week,venue,remaining:checks[0].basicCardCountBeforeChallenge,fromExamIndex:checks[0].fromExamIndex});
  }
  return dates.length ? { dates, pp } : null;
}

function applyNiaExchanges(items, effects) {
  const candidates = items.filter(item=>item.routeExchange);
  if (!candidates.length) return;
  const weeks = new Map(), used = new Map();
  for (const item of candidates) for (const date of item.routeExchange.dates) {
    if (!weeks.has(date.week)) weeks.set(date.week, []);
    weeks.get(date.week).push({item,date});
  }
  for (const [,matches] of [...weeks].sort(([a],[b])=>a-b)) {
    const eligible = matches.filter(({item})=>(used.get(item.id) ?? 0)<item.fireLimit);
    if (!eligible.length) continue;
    const available = eligible[0].date.remaining, ambiguous = eligible.length > available;
    // With one basic card and two eligible exchanges, exactly one funded pair
    // is available. Credit the smaller PP amount and reserve both fire limits.
    for (const {item} of eligible) used.set(item.id,(used.get(item.id) ?? 0)+1);
    const funded = ambiguous ? eligible.sort((a,b)=>a.item.routeExchange.pp-b.item.routeExchange.pp).slice(0,available) : eligible;
    for (const {item,date} of funded) {
      effects.actions.delete = (effects.actions.delete ?? 0) + 1;
      effects.actions.skill_acquire++;
      if (item.routeExchange.pp) effects.routePP = (effects.routePP ?? 0) + item.routeExchange.pp;
      for (const action of ['remove','acquire']) effects.produceActions.push({action, week:date.week, quantity:1,
        fromExamIndex:date.fromExamIndex,venue:date.venue,source:'scenario_start_challenge_item',...(ambiguous ? {} : {providerId:item.id}),
        ...(action==='remove'?{basicCard:true}:{independentAcquisition:true})});
    }
  }
}

const legendRewardVenues = {
  'p_trigger-end_step_event_school-for_hajime_legend_ssr': ['class_work_end', 'class'],
  'p_trigger-end_step_event_activity-for_hajime_legend': ['outing', 'outing'],
  'p_trigger-end_present-for_hajime_legend': ['activity_supply_gift', 'activity_supply', 'supply_gift'],
};
const maximumActionCount = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : Infinity;

function routedItemEffects(item, stage, route) {
  if (!route || item.fireInterval || item.fireLimit <= 0) return null;
  if (stage === 'produce-003') {
    const effect = item.effects.find(e => e.triggerId === 'p_trigger-start_shop' && e.type === 'ProducePointAddition' && e.min === e.max);
    if (!effect) return null;
    const visits = (route.selections ?? []).filter(row => ['consult','consultation'].includes(row.activity));
    const count = Math.min(visits.length, item.fireLimit, maximumActionCount(route.explicitCounts?.consult));
    return { pp: effect.min * count, count, basis: 'planned_consultations' };
  }
  if (stage !== 'produce-006') return null;
  const effect = item.effects.find(e => e.triggerId === 'p_trigger-get_produce_card-produce_card_count-0017_0000-for_hajime_legend_ssr' &&
    /^(Vocal|Dance|Visual)Addition$/.test(e.type) && e.min === e.max);
  if (!effect) return null;
  const acquisitions = (route.produceActions ?? []).filter(action => action.action === 'acquire' &&
    Number.isInteger(action.week) && action.week > 0 && (action.quantity ?? 1) === 1 &&
    Number.isSafeInteger(action.deckCardCountAtTrigger) && action.deckCardCountAtTrigger >= 17);
  const count = Math.min(item.fireLimit, acquisitions.length, maximumActionCount(route.explicitCounts?.skill_acquire));
  return { axis: effect.type.replace('Addition','').toLowerCase(), amount: effect.min * count, count,
    basis: 'declared_single_acquisition_with_17_held_cards' };
}

function legendRewardSupply(item, route) {
  const grant = item.effects.find(e => e.type === 'ProduceRewardSet' && e.resource === 'ProduceCard' &&
    e.pick === 'Select' && e.pickMin === 1 && e.pickMax === 1 && Object.hasOwn(legendRewardVenues, e.triggerId));
  if (!grant || item.fireInterval || item.fireLimit <= 0 || item.effects.some(e => e.type === 'ProduceCardDelete')) return null;
  const [kind, ...activities] = legendRewardVenues[grant.triggerId];
  const model = { kind, limit: item.fireLimit, count: null, produceActions: [], basis: 'schedule_unconfirmed' };
  if (!Array.isArray(route?.selections) || !route.selections.length) return model;
  const dates = route.selections.filter(s => activities.includes(s.activity));
  const explicit = route.explicitCounts?.[kind], constrained = Number.isSafeInteger(explicit) && explicit >= 0 && explicit < dates.length;
  model.count = Math.min(item.fireLimit, dates.length, constrained ? explicit : Infinity);
  model.basis = 'planned_venue_and_one_reward_selected';
  // An aggregate count can remove visits, without specifying which weeks.
  if (!constrained) model.produceActions = dates.slice(0, model.count).map(({ week }) => ({
    id: 'challenge:' + item.id + ':' + week, action: 'acquire', quantity: 1, week, venue: kind,
    fromExamIndex: route.selections.filter(s => s.week < week && ['mid_exam', 'final_exam'].includes(s.activity)).length,
    source: 'scenario_start_challenge_item', independentAcquisition: true,
  }));
  return model;
}

function compareLists(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

// Native groups are disjoint. Only Legend slot 1 supplies start growth, so
// maximizing each independent slot maximizes this lexicographic objective.
function selectEach(groups, available, rateKey, route, axisWeights, benefitFirst) {
  const rows = route?.parameterBonusRows ?? (route?.gains ? [route.gains] : null);
  const selected = [];
  for (const group of groups) {
    let best = null, bestRank = null;
    for (const item of group.items.filter(available)) {
      const growth = item.startEffects.growthRatePermil;
      const projected = rows ? rows.reduce((sum, row) => sum + axes.reduce((n, axis) =>
        n + Math.floor((row[axis] ?? 0) * growth[axis] / 1000) * (axisWeights?.[axis] ?? 1), 0), 0) : 0;
      const pp = item.startEffects.initialPP;
      const rival = item.effects.find(effect => effect.type === 'AuditionNpcEnhance')?.min;
      // Unknown exam effects cannot be interpreted as a measured zero penalty.
      // Compare the listed rival modifier only when both candidates report it.
      const acquisitions = item.routeSupply?.count ?? 0;
      const rank = benefitFirst ? [projected, pp, acquisitions, item[rateKey]] : [item[rateKey], projected, pp, acquisitions];
      const cmp = bestRank ? compareLists(rank, bestRank.rank) : -1;
      if (cmp < 0 || (cmp === 0 && Number.isFinite(rival) && Number.isFinite(bestRank.rival) && rival < bestRank.rival)) {
        best = item; bestRank = { rank, rival };
      }
    }
    if (best) selected.push(best);
  }
  return selected;
}

export function scenarioEntryCondition(scenario,difficulty,inventory,options,idol) {
  const stage=stages[scenario+':'+(scenario==='nia'&&difficulty==='none'?'master':difficulty)];
  if(!stage||options.eventModeId)return {blocked:false,confirmed:false};
  const character=inventory.characters?.find(row=>(row.characterId??row.gameId??row.id)===idol?.characterId);
  const affection=knownInteger(options.startItemDearnessLevel??character?.dearnessLevel,0,999,'아이돌 친애도 레벨');
  const level=options.producerLevel??inventory.producerLevel;
  const blocked=affection!=null&&affection<stage.dearness||Boolean(stage.producerLevel&&level!=null&&Number(level)<stage.producerLevel);
  return {blocked,confirmed:!blocked&&affection!=null&&(!stage.producerLevel||level!=null)};
}

/** Compare only items selected before producing the exact P-idol and difficulty. */
export function buildScenarioStartItemPlan({ catalog = {}, inventory = {}, options = {}, selectedIdol = null,
  route = null, axisWeights = null } = {}) {
  const scenario = options.scenario ?? 'hif';
  const difficulty = scenario === 'nia' && options.difficulty === 'none' ? 'master'
    : options.difficulty ?? ({ hajime: 'legend', nia: 'master', hif: 'none' })[scenario];
  const stage = stages[scenario + ':' + difficulty];
  const manual = idsOption(options.startItemIds, 'startItemIds');
  const observed = idsOption(options.availableStartItemIds, 'availableStartItemIds');
  const slotCount = knownInteger(options.startItemSlotCount, 0, 3, '시작 아이템 해금 슬롯 수');
  const result = { scenario, difficulty, status: 'not_applicable', groups: [], slotCount,
    selectedItems: [], selectedItemIds: [], recommendedItems: [], recommendedItemIds: [], totals: emptyTotals(),
    recommendedTotals: emptyTotals(), appliedEffects: emptyApplied(), selectionMode: manual ? 'manual' : 'automatic',
    confirmedBenefitAlternative: null, comparisonBasis: null, notes: [] };
  const noChoices = (status, note) => {
    if (manual?.length || observed?.length || slotCount > 0) throw new RangeError(note);
    result.status = status;
    result.notes.push(note);
    return result;
  };
  if (options.eventModeId || (scenario==='hif' && options.hifMode && options.hifMode !== 'normal')) {
    return noChoices('event_unconfirmed', '선택한 이벤트의 시작 아이템 선택군과 추가 해금 조건이 확인되지 않았습니다.');
  }
  if (!stage) return noChoices('not_applicable', '이 난이도에는 시작 전 챌린지 P아이템 선택군이 없습니다.');
  if (stage.id==='produce-005' && route?.produceActions?.some(a=>a.action==='challenge_check') &&
      route.produceActions.some(a=>['remove','acquire'].includes(a.action) &&
        (a.source==='scenario_start_challenge_item' || items.has(a.providerId)))) {
    throw new RangeError('주차별 기본 카드를 입력할 때 일반 행동 목록에서 챌린지가 공급한 삭제·획득을 제외해 주세요.');
  }
  const id = selectedIdol?.gameId ?? selectedIdol?.id ?? options.idolGameId ?? options.idolId;
  const idol = selectedIdol ?? catalog.idolCards?.find(row => (row.gameId ?? row.id) === id);
  const family = idol?.produceChallengeSlotId ?? source.idToFamily[id];
  const groups = source.groups[family]?.[stage.id];
  if (!groups || !idol?.characterId) return noChoices('idol_required', 'P아이돌의 시작 아이템 선택군을 확인할 수 없습니다.');
  if (!source.eligibleCharacters[stage.id]?.includes(idol.characterId) || idol.excludedScenarios?.includes(scenario)) {
    return noChoices('unavailable', '이 캐릭터는 해당 시나리오·난이도의 챌린지 아이템 대상에 포함되지 않습니다.');
  }
  const {blocked,confirmed:stageConfirmed}=scenarioEntryCondition(scenario,difficulty,inventory,options,idol);
  if (blocked) {
    return noChoices('unavailable', '아이돌 친애도 또는 프로듀서 레벨이 이 난이도의 입장 조건에 미달합니다.');
  }
  result.groups = groups.map(group => {
    // Master slots 2 and 3 depend on that idol's exam/rank achievements. A
    // captured dearnessPoint is not the completed dearness level or an achievement.
    const unlocked = slotCount !== null ? group.number <= slotCount : stageConfirmed && stage.id === 'produce-003' && group.number === 1 ? true : null;
    const entries = group.options.map(([itemId, lessonLimitUpScore, auditionParameterGrowthRatePermil]) => {
      const available = observed !== null ? observed.includes(itemId) && unlocked !== false : unlocked;
      const item = items.get(itemId);
      return { ...item, lessonLimitUpScore, auditionParameterGrowthRatePermil, available,
        routeEffects: routedItemEffects(item, stage.id, route),
        routeExchange: stage.id === 'produce-005' ? niaExchange(item,route) : null,
        routeSupply: stage.id === 'produce-006' ? legendRewardSupply(item, route) : null };
    });
    return { number: group.number,
      unlockDescription: stage.id === 'produce-003' ? [null, '해당 아이돌로 마스터 입장', '해당 아이돌로 마스터 최종 시험 1위', '해당 아이돌로 마스터 평가 S 획득'][group.number]
        : '해당 난이도 입장 및 실제 선택 가능 슬롯 확인',
      unlockDescriptionJa: group.unlockDescriptionJa || null,
      availability: entries.some(row => row.available === true) ? 'available' : entries.every(row => row.available === false) ? 'unavailable' : 'unknown',
      items: entries };
  });
  const byId = new Map(result.groups.flatMap(group => group.items.map(item => [item.id, { item, slot: group.number }])));
  if (observed?.some(key => !byId.has(key) || byId.get(key).item.available === false)) {
    throw new RangeError('화면에서 확인한 목록에 해당 아이돌·난이도·슬롯에 맞지 않는 아이템이 있습니다.');
  }
  if (manual && (manual.some(key => byId.get(key)?.item.available !== true) ||
    new Set(manual.map(key => byId.get(key)?.slot)).size !== manual.length)) {
    throw new RangeError('수동 시작 아이템은 확인된 각 슬롯에서 한 개씩만 선택할 수 있습니다.');
  }
  const rateKey = scenario === 'nia' ? 'auditionParameterGrowthRatePermil' : 'lessonLimitUpScore';
  const choose = (available, benefitFirst = false) => selectEach(result.groups, available, rateKey, route, axisWeights, benefitFirst);
  const potential = item => item.available !== false, usable = item => item.available === true;
  result.recommendedItems = choose(potential);
  result.selectedItems = manual ? manual.map(key => byId.get(key).item) : choose(usable);
  result.selectedItemIds = result.selectedItems.map(row => row.id);
  result.recommendedItemIds = result.recommendedItems.map(row => row.id);
  result.recommendedTotals = combine(result.recommendedItems).totals;
  Object.assign(result, combine(result.selectedItems));
  result.status = result.groups.some(group => group.availability === 'unknown') ? 'conditional' : 'ready';
  result.comparisonBasis = rateKey;
  const alternative = choose(usable, true);
  if (!manual && alternative.some((row, i) => row.id !== result.selectedItemIds[i])) {
    result.confirmedBenefitAlternative = { itemIds: alternative.map(row => row.id), ...combine(alternative) };
  }
  result.notes.push(scenario === 'nia'
    ? '오디션 기본 보상에 적용할 증가율을 비교했습니다. 실제 획득량은 해당 오디션 결과에 따릅니다.'
    : '레슨·SP 레슨의 PERFECT 상한을 비교했습니다. 추가 파라미터 획득량은 달성 점수에 따릅니다.');
  if (scenario === 'nia') result.notes.push('기본 카드를 교환하는 보상은 실제 방문 주차와 교환 직전 기본 카드 장수가 있는 경우에 계산합니다. 칸끼리 같은 대상을 쓰면 확인 가능한 최소 횟수와 PP만 반영합니다. 회복량과 시험 중 효과는 별도입니다.');
  if (stage.id === 'produce-006') result.notes.push('녹음기·스피커·거울은 1장 획득 시점에 덱 17장 이상을 확인한 주차만 파라미터에 반영합니다.');
  if (result.status === 'conditional') result.notes.push('미확인 슬롯의 추천은 해당 칸을 사용할 수 있을 때의 후보입니다.');
  return result;
}

/** Distinct starting resources for the route's final cap-aware support comparison. */
export function scenarioStartItemAlternatives(plan) {
  if (plan.selectionMode === 'manual' || !plan.selectedItemIds.length) return [plan];
  const pool = new Map();
  const rateKey = plan.comparisonBasis;
  const keyOf = ({ growthRatePermil: g, initialPP, actions, produceActions, routePP, routeStats }) => [g.vocal, g.dance, g.visual, initialPP,
    routePP ?? 0, ...axes.map(axis => routeStats?.[axis] ?? 0),
    actions.skill_acquire, actions.delete ?? 0, ...produceActions.map(a => [a.week,a.action,a.venue].join('/')).sort()].join(',');
  const originalKey = keyOf(plan.appliedEffects);
  pool.set(originalKey, plan);
  const slots = plan.groups.map(group => group.items.filter(item => item.available === true)).filter(rows => rows.length);
  function visit(slot, selectedItems) {
    if (slot < slots.length) {
      visit(slot + 1, selectedItems); // A challenge slot may be left empty.
      for (const item of slots[slot]) visit(slot + 1, [...selectedItems, item]);
      return;
    }
    const { totals, appliedEffects } = combine(selectedItems);
    const key = keyOf(appliedEffects), previous = pool.get(key);
    if (previous && previous.totals[rateKey] >= totals[rateKey]) return;
    pool.set(key, { ...plan, selectedItems, selectedItemIds: selectedItems.map(item => item.id), totals, appliedEffects });
  }
  visit(0, []);
  return [...pool.values()];
}
