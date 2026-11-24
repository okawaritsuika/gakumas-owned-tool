import { actionKeywords, withDeclaredProduceActions } from './produce-action-counts.mjs';
import { isScenarioDrink, isScenarioOperation, peakParameterTimeline, planScenarioDrinks, scenarioItemBeforeExam, summarizeScenarioOperations } from './hif-peak-state.mjs';
import { planHifPurchases } from './hif-route-purchases.mjs';
import { buildCardTargetPlan, cardTargetPlanAtExam } from './hif-card-targets.mjs';

const list = value => Array.isArray(value) ? value : [];
const venueOf = value => ({ activity_supply: 'supply_gift', activity_supply_gift: 'supply_gift', consultation: 'consult' })[value] ?? value;
const quantityOf = action => Number.isInteger(action.quantity) && action.quantity > 0 ? action.quantity : 1;
const isExam = row => ['mid_exam', 'final_exam'].includes(row.activity);
const stageFor = row => row.stage ?? (row.fromExamIndex >= 3 ? 'final' : 'selection');
const sumQuantity = rows => rows.reduce((sum, row) => sum + quantityOf(row), 0);
const byStage = rows => Object.fromEntries(['selection', 'final'].map(stage =>
  [stage, sumQuantity(rows.filter(row => stageFor(row) === stage))]));
const isCardAction = a => ['acquire','upgrade','remove','change','copy','customize'].includes(a.action);
const isPurchase = action => action.basis==='conditional_retry_route_purchase';

function settlePaidTargets(route, initialInputs, peak, options) {
  const data=options.catalog?.produceResources?.hif;
  const adjustable=data&&['upgrade','remove','customize'].includes(peak.consultPlan);
  let inputs=initialInputs, purchases=peak.purchases??[], targetPlan;
  const unpaid=adjustable?initialInputs.filter(a=>!isPurchase(a)):null;
  const explicit=adjustable?list(options.produceActions).filter(a=>
    !list(route.excludedProduceActions).some(excluded=>a===excluded || a.id && a.id===excluded.id)):null;
  // The next decision only depends on earlier charges and remaining targets.
  // Each replay fixes at least the first unsettled visit in calendar order.
  for (let pass=0;;pass++) {
    targetPlan=buildCardTargetPlan(options.catalog,route,inputs,options);
    if (!adjustable || !targetPlan || pass>=route.selections.length) break;
    const costs=new Map(purchases.map(row=>[row.id,0]));
    for (const action of targetPlan.baseline.actions) if (costs.has(action.originId))
      costs.set(action.originId,costs.get(action.originId)+(action.ppCost??0));
    const amended=[...unpaid];
    const {purchases:next}=planHifPurchases(route,data,explicit,amended,{...options,hifConsultPlan:peak.consultPlan},costs);
    const same=next.length===purchases.length && next.every((row,i)=>row.id===purchases[i].id
      && row.ppCost===purchases[i].ppCost && row.count===purchases[i].count);
    purchases=next;
    if (same) break;
    inputs=amended;
  }
  return {inputs,purchases,targetPlan};
}


function peakRoutePlan(route, data, catalog, explicit, generated, options) {
  const profile = list(catalog.produceInitialDecks?.idolProfiles).find(row => row.idolCardId === options.hifSelectedIdol?.gameId);
  const deck = catalog.produceInitialDecks?.decks?.[profile?.scenarioDeckIds?.['produce-007']];
  const sourceTypes = new Map(list(catalog.skillCards).filter(card => card.sourceType).map(card => [card.gameId,card.sourceType]));
  const initialBasics = Array.isArray(deck?.cardSlots) && deck.cardSlots.every(slot => sourceTypes.has(slot.cardId))
    ? deck.cardSlots.filter(slot => sourceTypes.get(slot.cardId) === 'default').length : null;
  // Reserve starter targets for both native post-exam removals and explicitly
  // scheduled operations before allocating the remaining copies to class changes.
  const explicitOperations = explicit.filter(a => {
    const sourceType = a.sourceType ?? sourceTypes.get(a.gameId);
    return ['change', 'remove'].includes(a.action) && a.basicCard !== false
      && (a.basicCard === true || sourceType === 'default' || !sourceType);
  });
  const reserved = explicitOperations.reduce((n, a) => n + quantityOf(a), 0)
    + generated.filter(a => a.action === 'remove' && a.sourceType === 'default').reduce((n, a) => n + a.quantity, 0);
  let remaining = initialBasics === null ? null : Math.max(0, initialBasics - reserved);
  if (remaining !== null && !Object.hasOwn(options.expectedCounts ?? {}, 'basic_card_change')) {
    for (const action of generated.filter(a => a.action === 'change')) {
      action.basicCard = remaining >= action.quantity;
      if (action.basicCard) remaining -= action.quantity;
    }
  }
  const plan = options.supportPeakPlan ?? (options.plan && options.plan !== 'auto' ? options.plan : null)
    ?? options.hifSelectedIdol?.plan ?? list(catalog.idolCards).find(idol => idol.gameId === options.hifSelectedIdol?.gameId)?.plan;
  const scenarioItem = planScenarioDrinks(route, data, plan, options, explicit, generated);
  const {plan:consultPlan,purchases} = planHifPurchases(route,data,explicit,generated,options);
  const consultDrinkPurchases = purchases.filter(purchase=>purchase.action==='drink_exchange');
  const exams = route.selections.filter(isExam).map(({week, stage, fromExamIndex}) => ({week, stage, fromExamIndex}));
  const flexibleChanges = generated.filter(a => a.action === 'change' && a.basicCard === true);
  const actions = [...explicit, ...generated];
  const drinkReceipts = actions.filter(a => ['drink_acquire','drink_exchange'].includes(a.action) && !isScenarioDrink(a));
  const beforeExam = (rows, exam) => rows.filter(a => Number.isInteger(a.fromExamIndex) && a.fromExamIndex <= exam.fromExamIndex
    && (a.week == null || a.week < exam.week));
  const basicOperations = [...explicitOperations, ...generated.filter(a =>
    a.action === 'remove' && a.sourceType === 'default' || a.action === 'change' && a.basicCard)];
  const storyWeek = exam => route.selections.findLast(row => row.stage === 'selection' && row.week < exam?.week)?.week ?? null;
  const supportReceiptWeek = storyWeek(exams[0]);
  return { basis: 'conditional_ordinary_hif_retry', consultPlan, purchases, consultDrinkPurchases, scenarioItem, ...peakParameterTimeline(route, options),
    ...(options.supportPeakFunding?{supportFunding:options.supportPeakFunding}:{}),
    jointEventTimingVerified:false, exams,
    parameterStoryWeek:storyWeek(exams[1]),managementStoryWeek:storyWeek(exams[2]),
    supportReceiptWeek, routeDrinkReceipts:sumQuantity(drinkReceipts),
    routeDrinkReceiptsByExam:exams.map(exam => sumQuantity(beforeExam(drinkReceipts, exam))),
    initialDeckSize: Number.isInteger(deck?.cardCount) && Array.isArray(profile.uniqueCardIds)
      ? deck.cardCount + new Set(profile.uniqueCardIds).size : null,
    initialBasicCards: initialBasics, remainingBasicCards: remaining,
    basicCardsByExam:exams.map(exam => initialBasics === null ? null : Math.max(0, initialBasics - sumQuantity(beforeExam(basicOperations, exam)))),
    reassignableBasicChanges:sumQuantity(flexibleChanges), reassignableBasicChangesByStage:byStage(flexibleChanges),
    reassignableBasicChangesByExam:exams.map(exam => byStage(beforeExam(flexibleChanges, exam))),
    examDeckSizes:null, examStages:exams.map(exam => exam.stage) };
}

/** The same full-route assumptions, restricted to actions preceding this
 * exam. Reserve the starters needed by later mandatory removals. A class
 * not yet reached can still use a nonbasic card if a support changes a
 * starter early, without creating an extra basic-card trigger at that class. */
export function supportPeakAtExam(peak, examIndex) {
  if (!peak || !Number.isInteger(examIndex) || examIndex < 0) return null;
  const cutoff = peak.exams[examIndex]?.week;
  if (cutoff == null) return peak;
  const exams = peak.exams.slice(0, examIndex);
  const statsBeforeWeek = Object.fromEntries(Object.entries(peak.statsBeforeWeek).filter(([week]) => Number(week) < cutoff));
  const parametersByStage = {};
  for (const [week, stats] of Object.entries(statsBeforeWeek))
    parametersByStage[Number(week) <= (peak.exams[2]?.week ?? Infinity) ? 'selection' : 'final'] = stats;
  const flexible = peak.reassignableBasicChangesByExam[examIndex];
  const remainingBasicCards = peak.remainingBasicCards === null ? null :
    peak.remainingBasicCards + peak.reassignableBasicChanges - flexible.selection - flexible.final;
  return { ...peak, statsBeforeWeek, parametersByStage, exams, examStages:exams.map(exam => exam.stage),
    ...(peak.cardTargetPlan?{cardTargetPlan:cardTargetPlanAtExam(peak.cardTargetPlan,examIndex)}:{}),
    examDeckSizes:peak.examDeckSizes?.slice(0, examIndex) ?? null, remainingBasicCards,
    basicTargetsAfterPlannedChanges:remainingBasicCards, basicCardsByExam:peak.basicCardsByExam.slice(0, examIndex + 1),
    reassignableBasicChanges:flexible.selection + flexible.final, reassignableBasicChangesByStage:flexible,
    reassignableBasicChangesByExam:peak.reassignableBasicChangesByExam.slice(0, examIndex + 1),
    supportReceiptWeek:peak.supportReceiptWeek < cutoff ? peak.supportReceiptWeek : null,
    parameterStoryWeek:peak.parameterStoryWeek < cutoff ? peak.parameterStoryWeek : null,
    managementStoryWeek:peak.managementStoryWeek < cutoff ? peak.managementStoryWeek : null,
    consultDrinkPurchases:peak.consultDrinkPurchases.filter(row => row.week < cutoff),
    purchases:(peak.purchases??[]).filter(row=>row.week<cutoff),
    scenarioItem:scenarioItemBeforeExam(peak.scenarioItem, examIndex, cutoff),
    routeDrinkReceipts:peak.routeDrinkReceiptsByExam[examIndex],
    routeDrinkReceiptsByExam:peak.routeDrinkReceiptsByExam.slice(0, examIndex + 1),
    selectedMemoryReceipts:peak.selectedMemoryReceiptsByExam?.[examIndex] ?? 0,
    selectedMemoryReceiptsByExam:peak.selectedMemoryReceiptsByExam?.slice(0, examIndex + 1) ?? [] };
}

/** Complete the route counts once the carried skill copies and their join
 * phases are known. Support-event receipts are added separately by the deck. */
export function applyPeakExamDeckCounts(route, memories, options = {}) {
  const peak = route.supportPeakScenario;
  if (!peak) return route;
  const actions = list(route.produceActions).map(action => {
    if (!['acquire','upgrade'].includes(action.action) || !action.gameId) return action;
    const card = list(options.catalog?.skillCards).find(card => card.gameId === action.gameId
      && (card.upgradeCount ?? 0) === (action.upgradeCount ?? 0));
    const keywords = actionKeywords(action, card);
    return {...action, rarity:action.rarity ?? card?.rarity, type:action.type ?? card?.type,
      ...(keywords ? {keywords:[...keywords]} : {})};
  });
  const horizon = options.examIndex ?? 5;
  const receipts = [];
  const seen = new Set();
  const midWeek = peak.exams[0]?.week;
  for (const memory of memories ?? []) {
    const carried = memory.modelEffects?.carriedSkill, card = memory.skillCard;
    if (carried?.obtainable !== true || !card || ![1, 2].includes(carried.phase?.code)) continue;
    const fromExamIndex = carried.phase.code === 1 ? 0 : 1;
    if (fromExamIndex > horizon || (fromExamIndex === 1 && midWeek == null)) continue;
    if (card.noDeckDuplication && seen.has(card.gameId)) continue;
    seen.add(card.gameId);
    if (actions.some(a => a.action === 'acquire' && a.gameId === card.gameId && a.fromExamIndex === fromExamIndex
      && (a.venue === 'memory' || a.source === 'selected_memory' || a.basis === 'selected_memory_receipt'))) continue;
    const keywords = actionKeywords(card, card);
    receipts.push({id: `memory:${memory.gameId ?? memory.id}:${card.gameId}`, action:'acquire', quantity:1,
      gameId:card.gameId, upgradeCount:card.upgradeCount, type:card.type, rarity:card.rarity, effectGroupIds:card.effectGroupIds,
      ...(Array.isArray(carried.customizes)?{customizes:carried.customizes}:{}),
      ...(keywords ? {keywords:[...keywords]} : {}),
      fromExamIndex, week:fromExamIndex === 0 ? 0 : midWeek, stage:'selection', venue:'memory', independentAcquisition:true,
      basis:'selected_memory_receipt', actualAcquisitionConfirmed:false});
  }
  const rememberedPlan=peak.cardTargetPlan;
  const pending=rememberedPlan?[...actions.filter(a=>!isCardAction(a)),...rememberedPlan.ops.filter(isCardAction),...receipts]:[...actions,...receipts];
  const {inputs:allInputs,purchases,targetPlan}=settlePaidTargets(route,pending,peak,options);
  const resolved=targetPlan?.baseline;
  const allActions = resolved?[...allInputs.filter(a=>!isCardAction(a)),...resolved.actions]
    : allInputs.filter(a=>!(a.requiresPricedTarget || ['conditional_hif_scenario_item','conditional_retry_route_purchase'].includes(a.basis)
      && ['copy','customize','remove','upgrade','change'].includes(a.action)));
  const realizedPurchases=purchases.flatMap(row=>{
    const actual=allActions.filter(a=>(a.originId??a.id)===row.id);
    return actual.length?[{...row,count:sumQuantity(actual),ppCost:actual.reduce((n,a)=>n+(a.ppCost??0),0)}]:[];
  });
  const updatedItem=peak.scenarioItem?summarizeScenarioOperations(peak.scenarioItem,allActions.filter(isScenarioOperation)):null;
  const rebuilt=withDeclaredProduceActions(route,allActions,options.catalog??{},{examIndex:horizon,examDeckSizes:options.examDeckSizes});
  const sizes = peak.exams.filter(exam => exam.fromExamIndex < horizon).map(exam => {
    const before = allActions.filter(a => Number.isInteger(a.fromExamIndex) && a.fromExamIndex <= exam.fromExamIndex);
    return Math.max(0, peak.initialDeckSize + before.reduce((size, a) =>
      size + (a.action === 'acquire' ? quantityOf(a) : a.action === 'remove' ? -quantityOf(a) : 0), 0));
  });
  const inferExams = peak.initialDeckSize !== null && !Array.isArray(options.examDeckSizes) && !Object.hasOwn(options.expectedCounts ?? {}, 'exam_15');
  const memoryActions = allActions.filter(a => a.venue === 'memory' || a.basis === 'selected_memory_receipt');
  const knownStats = options.supportPeakStatContext ? peakParameterTimeline(route, options) : {};
  const fullScenario = {...peak, ...knownStats, scenarioItem:updatedItem,purchases:realizedPurchases,
    ...(targetPlan?{cardTargetPlan:targetPlan}:{}),
    examDeckSizes:inferExams ? (resolved?.examDeckSizes??sizes) : null, selectedMemoryReceipts:sumQuantity(memoryActions),
    selectedMemoryReceiptsByExam:peak.exams.map(exam => sumQuantity(memoryActions.filter(a => a.fromExamIndex <= exam.fromExamIndex)))};
  const scenario = supportPeakAtExam(fullScenario, horizon);
  const counted=(base,stage)=>{
    const ordinary={...base};
    if(inferExams)ordinary.exam_15=sizes.filter((size,i)=>size>=15&&(!stage||peak.exams[i].stage===stage)).length;
    const physical=stage?resolved?.byStage[stage]:resolved?.counts;
    for(const [key,n] of Object.entries(physical??{})){
      if(key==='exam_15'&&!inferExams||Object.hasOwn(options.expectedCounts??{},key))continue;
      ordinary[key]=n;
    }
    return ordinary;
  };
  const counts = counted(rebuilt.counts);
  const stages = Object.fromEntries(Object.entries(rebuilt.stages ?? {}).map(([stage, part]) =>
    [stage, { ...part, counts:counted(part.counts, stage) }]));
  const explicitActionCounts = counted(rebuilt.explicitActionCounts);
  const packedScenario=targetPlan?{...scenario,cardTargetPlan:{...scenario.cardTargetPlan,baseline:null}}:scenario;
  const generatedIds=new Set(list(route.supportActionPlan.generatedActions).map(a=>a.originId??a.id));
  for (const purchase of purchases) generatedIds.add(purchase.id);
  return {...route, stages, counts, explicitActionCounts, produceActions:allActions, supportPeakScenario:scenario,
    supportActionPlan:{...route.supportActionPlan, counts:explicitActionCounts,generatedActions:allActions.filter(a=>generatedIds.has(a.originId??a.id)),
      peakScenario:{...route.supportActionPlan.peakScenario, ...packedScenario}}};
}

/** Planned receipts and operations, never a capture of completed actions. */
export function planHifSupportActions(route, catalog, options = {}) {
  const mode = options.supportActionMode ?? 'route';
  if (!['route', 'declared'].includes(mode)) throw new RangeError('Unsupported supportActionMode');
  const explicit = list(options.produceActions);
  if (mode === 'declared') return { route, actions: options.produceActions,
    evidence: { mode, basis: 'declared_actions_only', generatedActions: [], actualAcquisitionsConfirmed: false } };
  const data = catalog.produceResources?.hif;
  if (!data) return { route, actions: options.produceActions,
    evidence: { mode, basis: 'route_resource_data_unavailable', generatedActions: [], actualAcquisitionsConfirmed: false } };
  const generated = [], decisions = [];
  const troubleAction = entry => entry.sourceType === 'trouble' || ['trouble', 'ProduceCardCategory_Trouble'].includes(
    entry.type ?? entry.category ?? list(catalog.skillCards).find(card => card.gameId === entry.gameId && card.upgradeCount === (entry.upgradeCount ?? 0))?.type);
  const add = (row, action, quantity, extra = {}) => {
    if (!Number.isInteger(quantity) || quantity <= 0) return;
    const venue = row.main ? 'lesson' : String(row.activity).startsWith('class_') ? 'class_work_end' : venueOf(row.activity);
    // An explicit receipt at this visit fills the same slot; it is not a
    // second random card/drink in addition to the visit's declared target.
    const supplied = explicit.filter(entry => !entry.independentAcquisition && entry.week === row.week && entry.action === action
      && venueOf(entry.venue) === venue && troubleAction(entry) === (extra.sourceType === 'trouble'))
      .reduce((sum, entry) => sum + (Number.isInteger(entry.quantity) && entry.quantity > 0 ? entry.quantity : 1), 0);
    if (supplied >= quantity) return;
    generated.push({ id: `route:${row.week}:${action}:${extra.sourceType ?? 'reward'}`, action, quantity: quantity - supplied, week: row.week,
      stage: row.stage, fromExamIndex: row.fromExamIndex, venue,
      basis: 'planned_route_opportunity', actualAcquisitionConfirmed: false, ...extra });
  };
  const selections = list(route.selections).map(original => {
    const row = { ...original };
    if (['activity_supply', 'supply_gift', 'activity_supply_gift'].includes(row.activity)) {
      add(row, 'acquire', data.gift?.skillCardOpportunities, { sourceIds: data.gift?.sourceIds ?? [] });
      add(row, 'drink_acquire', data.gift?.drinkOpportunities, { sourceIds: data.gift?.sourceIds ?? [] });
    } else if (row.activity === 'outing') {
      const choiceId = options.activityChoices?.[row.week] ?? row.choiceId ?? 'free';
      const choice = list(data.outing?.choices).find(choice => choice.id === choiceId);
      if (choice) {
        row.choiceId = choiceId;
        add(row, 'acquire', choice.normalCards + choice.upgradedCards, { sourceIds: data.outing.sourceIds });
        add(row, 'drink_acquire', choice.drinks, { sourceIds: data.outing.sourceIds });
        if (choice.troubleCards) add(row, 'acquire', choice.troubleCards,
          { rarity: 'N', type: 'trouble', keywords: [], sourceType: 'trouble', sourceIds: data.outing.sourceIds });
        decisions.push({ week: row.week, choice: choiceId, reason: '외출 선택지에 따른 획득 기회' });
      }
    } else if (String(row.activity).startsWith('class_')) {
      row.choiceId = options.activityChoices?.[row.week] ?? row.choiceId ?? 'hp';
      const early = list(data.class?.earlyWeeks).includes(row.week), trouble = row.choiceId === 'trouble';
      if (early && !trouble) add(row, 'acquire', data.class?.earlyAcquireCards, { sourceIds: data.class?.sourceIds ?? [] });
      else add(row, 'change', data.class?.lateChangeCards, { sourceIds: data.class?.sourceIds ?? [] });
      if (trouble) add(row, 'acquire', data.class?.troubleCostCards,
        { rarity: 'N', type: 'trouble', keywords: [], sourceType: 'trouble', sourceIds: data.class?.sourceIds ?? [] });
      decisions.push({ week: row.week, choice: row.choiceId, reason: early && !trouble ? '초반 수업의 카드 획득 선택' : '수업의 셀렉트 체인지 선택' });
    }
    return row;
  });
  const removals = data.basicCardRemovals;
  const exams = selections.filter(row => row.stage !== 'final' && ['mid_exam', 'final_exam'].includes(row.activity));
  for (const examIndex of list(removals?.afterSelectionExamIndices)) {
    const row = exams[examIndex];
    if (row) add({ ...row, fromExamIndex: examIndex + 1, activity: 'exam_reward' }, 'remove', removals.count,
      { sourceType: 'default', sourceIds: removals.sourceIds ?? [] });
  }
  // Aggregate overrides have no week or preceding state. Keep the explicitly
  // supplied model rather than manufacturing a conflicting chronological run.
  const peakEnabled = options.supportPeakScenario === true && route.modelAvailable && !options.eventModeId
    && (!options.hifMode || options.hifMode === 'normal') && !options.baseLessonGains
    && !Object.keys(options.expectedCounts ?? {}).length && !Object.keys(options.perAxisCounts ?? {}).length;
  const peak = peakEnabled ? peakRoutePlan({...route,selections}, data, catalog, explicit, generated, options) : null;
  return { route: { ...route, selections, ...(peak ? {supportPeakScenario:peak} : {}) }, actions: [...explicit, ...generated],
    evidence: { mode, basis: 'planned_hif_route_opportunities', generatedActions: generated, decisions,
      actualAcquisitionsConfirmed: false, randomCardRarityOrKeywordAssumed: false,
      eventScheduleVerified: options.eventModeId ? false : null,
      ...(peak ? {peakScenario:{...peak,
        basicTargetsAfterPlannedChanges:peak.remainingBasicCards,
        conditions:['선택한 구매 방침 한 가지에 선발·본선의 시작 P포인트와 해당 주차까지 받은 레슨·사시이레·시나리오 P아이템 수입을 사용합니다. 외출 비용을 먼저 확보합니다.',
          ...(peak.consultPlan==='drinks'?['상담에 R 드링크가 진열되고 빈 슬롯을 확보할 때 방문당 최대 4개를 교환합니다.']:[]),
          ...(['skills','ssr'].includes(peak.consultPlan)?['상담에 해당 레어도의 미강화 스킬 카드가 제시되면 방문당 1장을 받습니다.']:[]),
          ...(['upgrade','remove'].includes(peak.consultPlan)?['프로듀서 레벨로 열린 상담에서 방문당 1장의 실제 대상을 골라 누적 차수 가격을 지불합니다.']:[]),
          ...(peak.consultPlan==='customize'?['특별 지도와 인터벌에서 강화 상태·개조 이력을 확인할 수 있는 카드에 다음 단계의 원본 가격을 지불합니다.']:[]),
          ...(['skills','ssr','drinks','upgrade'].includes(peak.consultPlan)?['본선 라운드 1 뒤 인터벌은 별도 가격·상품 수와 남은 PP를 사용합니다. 이때 받은 물품은 라운드 2부터 반영합니다.']:[]),
          '기본 카드 강제 삭제분을 예약하고 수업과 서포트 체인지가 같은 기본 카드를 두 번 쓰지 않도록 배분합니다. 서포트 스킬은 선발 1차 시험 전에 획득하는 경우입니다.',
          '레벨로 열린 P아이템 이벤트가 초반에 발생하고 행동 직전에 발동 조건을 만족하는 경우입니다. 여러 서포트가 같은 주차에 필요한 편성은 각 이벤트가 함께 발생하는 순서까지 확인되지 않았습니다.',
          '매장 새로고침과 드링크 사용 효과는 계산에서 제외합니다.',
          ...(peak.scenarioItem?.conditions ?? [])]}} : {}),
      limitations: ['차입·외출의 카드와 드링크를 받아 가는 계획입니다. 종류·소지 잔고·실제 획득 기록은 아닙니다.',
        '미지정 외출은 무료 선택, 수업은 체력을 쓰는 선택을 가정합니다. 후반 체인지를 새 카드 획득으로 세지 않습니다.',
        ...(peak ? [peak.supportFunding?'선택한 서포트의 개시·레슨·이전 주차 고정 이벤트 PP와 확인된 드링크 할인을 같은 편성에 적용했습니다.':'자동 구매의 기본 예산은 서포트 편성을 고르기 전에 정합니다.'] :
          ['상담의 구입·드링크 교환·추가 강화·삭제·기본 카드 체인지는 별도 입력이 없으면 횟수를 만들지 않습니다.',
           '키워드 8장·덱 20장·시험 15장 조건과 P아이템 획득 시점은 자동 충족하지 않습니다.']),
        ...(options.eventModeId ? ['이벤트에서는 일반 HIF 기본 일정의 비교 가정입니다. 회차의 실제 선택지와 대조해야 합니다.'] : [])] } };
}
