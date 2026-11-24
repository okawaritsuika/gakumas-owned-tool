const axes = ['vocal', 'dance', 'visual'];

/** Use the same non-support inputs as the deck evaluator. A class is a fixed
 * gain. Growth applies once per lesson or base exam reward, rounded down on
 * each axis. An observed post-bonus reward already includes its growth. */
export function peakParameterTimeline(route, options) {
  const context = options.supportPeakStatContext;
  const initial = context?.initialStats ?? options.supportPeakInitialStats ?? options.initialStats;
  const stats = Object.fromEntries(axes.map(axis => [axis, initial?.[axis] ?? 0]));
  const statsBeforeWeek = {}, parametersByStage = {};
  let precedingStage;
  for (const row of route.selections) {
    const stage = context?.stageContexts?.[row.stage];
    const caps = stage?.statCaps ?? (row.stage === 'selection' ? options.supportPeakSelectionCaps : options.supportPeakFinalCaps);
    if (precedingStage !== row.stage) {
      for (const axis of axes) stats[axis] = Math.min(caps?.[axis] ?? Infinity,
        stats[axis] + (stage?.additionalInitialStats?.[axis] ?? 0));
      precedingStage = row.stage;
    }
    statsBeforeWeek[row.week] = {...stats};
    parametersByStage[row.stage] = {...stats};
    const exam = row.stage === 'selection' && ['mid_exam','final_exam'].includes(row.activity)
      ? route.examRewards?.[row.fromExamIndex] : null;
    for (const axis of axes) {
      const gain = row.gains?.[axis] ?? 0;
      const growthBase = (row.main ? gain : 0) + (exam?.growthEligibleGains?.[axis] ?? 0);
      const rate = stage?.outsideGrowthRatePermil?.[axis] ?? context?.outsideGrowthRatePermil?.[axis] ?? 0;
      stats[axis] = Math.min(caps?.[axis] ?? Infinity, stats[axis] + gain
        + (exam?.parameterGains?.[axis] ?? 0) + Math.floor(growthBase * rate / 1000));
    }
  }
  return {statsBeforeWeek, parametersByStage};
}

export const isScenarioOperation = action => action.basis === 'conditional_hif_scenario_item'
  || action.venue === 'scenario_item' || Boolean(action.scenarioItemPath);
export const isScenarioDrink = action => action.action === 'drink_acquire' && isScenarioOperation(action);

function activityKind(row) {
  if (row.main) return 'lesson';
  return ['activity_supply','activity_supply_gift'].includes(row.activity) ? 'supply_gift' : row.activity;
}

export function summarizeScenarioOperations(item, operations) {
  const actionCounts = {}, byStage = {selection:0, final:0};
  for (const action of operations) {
    const quantity = action.quantity ?? 1;
    const kind = action.operation === 'copy' ? 'copy' : action.action;
    actionCounts[kind] = (actionCounts[kind] ?? 0) + (action.amount ?? quantity);
    if (action.action === 'drink_acquire') byStage[action.stage] += quantity;
  }
  const actions = [];
  for (const op of operations.filter(a => a.action === 'drink_acquire')) {
    const last=actions.at(-1);
    // Distinct drink grants of a single activation remain distinct in the source
    // and target resolver. The displayed total for this form/week is additive.
    if(last && last.week===op.week && last.formId===op.formId)last.quantity+=op.quantity;
    else actions.push({week:op.week,fromExamIndex:op.fromExamIndex,stage:op.stage,quantity:op.quantity,formId:op.formId??null});
  }
  return {...item,operations,actionCounts,actions,byStage,receipts:byStage.selection+byStage.final};
}

/** Select one linked path. Each form only sees lessons/visits reached after
 * that selection exam and before replacement by the next form. */
export function planScenarioDrinks(route, data, plan, options, explicit, generated) {
  const reference = data.scenarioItemPaths;
  if (!reference) return null;
  const id = !options.hifScenarioItemPath || options.hifScenarioItemPath==='auto' ? 'yellow_robot_flower' : options.hifScenarioItemPath;
  const path = reference.paths[id];
  const result = {id, nameKo:path?.nameKo ?? (id==='none'?'선택 안 함':'직접 선택한 커스텀 P아이템'),
    status:'different_path',conditions:[],sourceIds:reference.sourceIds};
  const declared = explicit.filter(isScenarioOperation);
  if (declared.length) {
    result.status = 'declared_item_receipts';
    return summarizeScenarioOperations(result,declared.map(a=>({...a,quantity:a.quantity??1,stage:a.stage??(a.fromExamIndex>=3?'final':'selection')})));
  }
  if (!path) return summarizeScenarioOperations(result,[]);
  const pool = data.scenarioDrinkItem?.plans?.[plan]?.designatedPool;
  if (!pool) return summarizeScenarioOperations({...result,status:'plan_unverified'},[]);
  const unlocked = pool.filter(drink => drink.unlockProducerLevel===0 || drink.unlockProducerLevel<=options.producerLevel).length;
  const operations = [];
  for (const [index, key] of path.formKeys.entries()) {
    const form = reference.forms[key];
    const next = reference.forms[path.formKeys[index+1]];
    const visits = route.selections.filter(row => activityKind(row)===form.trigger && row.fromExamIndex>=form.fromExamIndex
      && (!next || row.fromExamIndex<next.fromExamIndex)).slice(0,form.useLimit);
    for (const visit of visits) for (const [effectIndex,effect] of form.effects.entries()) {
      const quantity = effect.designated ? Math.min(effect.quantity,unlocked) : effect.quantity??1;
      if (!quantity) continue;
      const op = {...effect,quantity,id:`scenario:${key}:${visit.week}:${effectIndex}`,week:visit.week,
        fromExamIndex:visit.fromExamIndex,stage:visit.stage,venue:form.trigger,independentAcquisition:true,
        scenarioItemPath:id,formId:form.nativeByPlan[plan],basis:'conditional_hif_scenario_item',
        actualAcquisitionConfirmed:false,sourceIds:reference.sourceIds,ppCost:0};
      if(op.action==='copy')op.countsAsAcquisition=true;
      operations.push(op);
      generated.push(op);
    }
  }
  result.status='conditional_path';
  result.conditions.push(path.nameKo+' 경로가 제시될 때 선택하고, 각 단계의 해당 활동에서만 효과를 적용합니다.');
  return summarizeScenarioOperations(result,operations);
}

export function scenarioItemBeforeExam(item, examIndex, stopWeek) {
  if (!item) return null;
  const operations=(item.operations??item.actions.map(row=>({...row,action:'drink_acquire'})))
    .filter(a => a.fromExamIndex<=examIndex && (a.week==null || a.week<stopWeek));
  return summarizeScenarioOperations(item,operations);
}
