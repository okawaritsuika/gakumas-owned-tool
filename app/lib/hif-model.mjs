import { applySpLessonTotal } from './sp-lesson-counts.mjs';
/**
 * HIF comparison arithmetic adapted from 33ki3/gaku-navi (MIT), commit
 * 5e8bd85f6de8f668f3394c163afe7189b8c32047:
 * calculator/parameterBonus.ts, calculator/calculateCard.ts,
 * unitOptimizer/evaluator.ts and data/score/exam.ts.
 * This is a conditional stat model, not an exam/battle simulator.
 */
import { declaredProduceActionCounts, withDeclaredProduceActions } from './produce-action-counts.mjs';
import { evaluateSupportItemValue } from './support-item-value.mjs';
import { planHifSupportActions } from './hif-support-actions.mjs';
import { allocateStoryChanges, deckSupportLinks, extraDeckSizeTriggers, itemResponse, ownItemUses, resolveSoloSupport } from './hif-support-links.mjs';
import { compileSupportOperations } from './hif-support-operations.mjs';
const axes = ['vocal', 'dance', 'visual'];
const short = { vocal: 'vo', dance: 'da', visual: 'vi' };
const zero = () => ({ vocal: 0, dance: 0, visual: 0 });
function add(...rows) {
  const sum = zero();
  for (const row of rows) {
    if (!row) continue;
    sum.vocal += row.vocal ?? 0;
    sum.dance += row.dance ?? 0;
    sum.visual += row.visual ?? 0;
  }
  return sum;
}
const finite = x => x !== '' && x !== null && x !== undefined && Number.isFinite(Number(x)) ? Number(x) : null;
const effectAxis = type => axes.find(axis => String(type).toLowerCase().includes(axis));
const compatible = (candidate, plan) => !plan || plan === 'free' || !candidate || candidate === 'free' || candidate === plan;

/** One floor per gain opportunity, after aggregating all growth rates. */
export function calculateGrowthBonus(rows, growthRatePermil) {
  const bonus = zero();
  const { vocal = 0, dance = 0, visual = 0 } = growthRatePermil;
  for (const row of rows) {
    bonus.vocal += Math.floor((row.vocal ?? 0) * vocal / 1000);
    bonus.dance += Math.floor((row.dance ?? 0) * dance / 1000);
    bonus.visual += Math.floor((row.visual ?? 0) * visual / 1000);
  }
  return bonus;
}

export function allocateExamGain(total, ratio = zero()) {
  const sum = axes.reduce((n, axis) => n + (ratio[axis] ?? 0), 0);
  if (sum <= 0) {
    const each = Math.floor(total / 3);
    return { vocal: each, dance: each, visual: total - each * 2 };
  }
  const result = Object.fromEntries(axes.map(axis => [axis, Math.floor(total * (ratio[axis] ?? 0) / sum)]));
  const remainder = total - axes.reduce((n, axis) => n + result[axis], 0);
  const largest = axes.reduce((best, axis) => (ratio[axis] ?? 0) > (ratio[best] ?? 0) ? axis : best, 'vocal');
  result[largest] += remainder;
  return result;
}

const rewardSources=[
  {id:'official-hif-selection-reward',title:'공식 HIF 선발시험 도움말',url:'https://stat.game-gakuen-idolmaster.jp/html/help/7c4d347ab6b9a8432d1edb5ffaafa234671d9fe5e12f05e40cc34ae9125020a4/index.html'},
  {id:'hif-selection-maximum-reference',title:'HIF 파라미터 보상 관측',url:'https://seesaawiki.jp/gakumasu/d/H.I.F'},
  {id:'gaku-navi-hif-reward-model',title:'gaku-navi HIF 잠정 배분 모델',url:'https://github.com/33ki3/gaku-navi/blob/5e8bd85f6de8f668f3394c163afe7189b8c32047/src/data/score/exam.ts'},
];
const rewardVector=(input,label)=>{
  if(!input||axes.some(axis=>typeof input[axis]!=='number'||!Number.isFinite(input[axis])||input[axis]<0))
    throw new RangeError(`${label}: Vo/Da/Vi 세 값은 0 이상의 유한수여야 합니다. 미입력 속성을 0으로 대체하지 않습니다.`);
  return Object.fromEntries(axes.map(axis=>[axis,input[axis]]));
};

/** Observed post-bonus rewards bypass growth. Missing exams retain a labelled maximum reference. */
export function resolveHifExamRewards(catalog,options={}){
  if(options.hifExamResults!=null&&!Array.isArray(options.hifExamResults))throw new TypeError('hifExamResults must be an array');
  const entered=new Map();
  for(const row of options.hifExamResults??[]){
    if(!row||!Number.isInteger(row.examIndex)||row.examIndex<0||row.examIndex>2||entered.has(row.examIndex))throw new RangeError('선발 보상 시험 번호는 중복 없이 0~2입니다.');
    if(row.gainBasis!=null&&!['base','post_bonus'].includes(row.gainBasis))throw new RangeError('gainBasis must be base or post_bonus');
    if(row.score!=null&&(typeof row.score!=='number'||!Number.isFinite(row.score)||row.score<0))throw new RangeError('시험 점수는 0 이상의 유한수입니다.');
    if(row.parameterGains!=null)rewardVector(row.parameterGains,'시험 보상');
    if(row.scoreByAttribute!=null)rewardVector(row.scoreByAttribute,'속성별 시험 점수');
    entered.set(row.examIndex,row);
  }
  const definitions=catalog.calculationModels?.['score/hifSelectionExams']?.entries??[{base:20,allocation:80},{base:80,allocation:200},{base:100,allocation:220}];
  return definitions.slice(0,3).map((definition,examIndex)=>{
    const input=entered.get(examIndex),manual=input?.parameterGains!=null,legacy=options.hifExamGains?.[examIndex];
    const ratio=input?.scoreByAttribute??options.hifExamRatios?.[examIndex];
    const basis=manual?input.gainBasis??'post_bonus':'base';
    const gains=manual?rewardVector(input.parameterGains,'시험 보상'):legacy!=null?rewardVector(legacy,'hifExamGains 보너스 적용 전 보상'):
      add({vocal:definition.base,dance:definition.base,visual:definition.base},allocateExamGain(definition.allocation,ratio));
    return{examIndex,stage:'selection',availableFromExamIndex:examIndex+1,basis,
      source:manual?'manual_reward_input':legacy!=null?'legacy_base_reward_input':'maximum_reward_reference',
      assumedMaximum:!manual&&legacy==null,parameterGains:gains,
      growthEligibleGains:basis==='base'?gains:zero(),postBonusGains:basis==='post_bonus'?gains:zero(),
      growthAlreadyIncluded:basis==='post_bonus',score:input?.score??null,scoreByAttribute:input?.scoreByAttribute??null,
      eventModeId:options.eventModeId??null,referenceEventApplicability:!manual&&legacy==null&&options.eventModeId?'normal_hif_reference_event_applicability_unverified':null,
      allocationBasis:manual||legacy!=null?'explicit_axis_gains':ratio?'user_ratio_maximum_reference':'equal_ratio_maximum_reference',
      scoreToRewardFormulaApplied:false,exactGameRewardFunctionVerified:false,
      allocationFormulaAuthority:manual||legacy!=null?'user_supplied_vector':'upstream_community_model',
      sourceIds:manual||legacy!=null?[]:rewardSources.map(source=>source.id),
      note:manual?'직접 입력한 보상창 상승량입니다. post_bonus에는 성장 보정을 다시 곱하지 않습니다.':
        '최대 보상 관측치와 공개 계산기의 잠정 배분 조건입니다. 실제 달성한 점수·보상을 뜻하지 않습니다.'};
  });
}

export function hifExamRewardGain(reward,growthRatePermil=zero()){
  return add(reward.growthEligibleGains,calculateGrowthBonus([reward.growthEligibleGains],growthRatePermil),reward.postBonusGains);
}

export function buildHifRoute(catalog, primary, options = {}) {
  const requestedActivityFocus=options.activityFocus??'balanced';
  if(!['auto','balanced','consult','outing','supply_gift'].includes(requestedActivityFocus))throw new RangeError('Unsupported activityFocus');
  // A single route cannot optimize three alternatives; recommend() performs that comparison.
  const activityFocus=requestedActivityFocus==='auto'?'balanced':requestedActivityFocus;
  const basePriority=['consult','activity_supply','supply_gift','outing','special_training','final_exam','mid_exam'];
  const focusPriority=activityFocus==='outing'?['outing']:activityFocus==='supply_gift'?['activity_supply','supply_gift']:activityFocus==='consult'?['consult']:[];
  const customizePath=options.hifConsultPlan==='customize' && options.supportPeakScenario===true
    && (options.supportActionMode??'route')==='route' && !options.eventModeId && (!options.hifMode||options.hifMode==='normal')
    && !options.baseLessonGains && !Object.keys(options.expectedCounts??{}).length && !Object.keys(options.perAxisCounts??{}).length;
  const activityPriority=[...new Set([...(customizePath?['special_training']:[]),...focusPriority,...basePriority])];
  const difficulty = options.difficulty ?? 'none';
  const model = catalog.calculationModels ?? {};
  const schedules = model['score/schedule']?.table?.hif ?? {};
  if (options.difficulty && !Object.hasOwn(schedules, difficulty)) throw new RangeError('No such difficulty in the calculation model');
  const schedule = schedules[difficulty] ?? [];
  const lessons = model['score/lesson']?.table?.hif?.[difficulty] ?? {};
  const classes = model['score/class']?.table?.hif?.[difficulty] ?? {};
  const secondary = options.secondaryAttribute ?? axes.find(axis => axis !== primary);
  const classAxis = options.classAttribute ?? axes.find(axis => axis !== primary && axis !== secondary);
  const n = schedule.filter(week => lessons[week.week]?.[0]).length;
  const primaryCount = Math.max(0, Math.min(n, options.primaryLessonCount ?? n));
  const perAxis = Object.fromEntries(axes.map(axis => [axis, { lesson_end: 0, sp_lesson_end: 0, normal_lesson_end: 0 }]));
  const counts = { initial_stat: 1, initial_pp: 1, parameter_bonus: 1, max_hp: 1,
    sp_lesson_rate: 1, sp_lesson_rate_all: 1, class_work_end: 0, consult: 0, outing: 0,
    rest: 0, activity_supply_gift: 0, special_training: 0, exam_end: 0 };
  const lessonRows = [], classRows = [], selections = [];
  const stageRows = { selection: [], final: [] }, stageClasses = { selection: [], final: [] };
  const stageCounts = { selection: { ...counts }, final: Object.fromEntries(Object.keys(counts).map(key => [key, 0])) };
  const stagePerAxis = Object.fromEntries(['selection', 'final'].map(stage => [stage,
    Object.fromEntries(axes.map(axis => [axis, { lesson_end: 0, sp_lesson_end: 0, normal_lesson_end: 0 }]))]));
  let turn = 0, examsPassed=0;
  for (const week of schedule) {
    const stage = week.stage === 'final' ? 'final' : 'selection';
    const lesson = lessons[week.week]?.[0];
    if (lesson) {
      const isPrimary = options.lessonPattern === 'early' ? turn < primaryCount
        : Math.floor((turn + 1) * primaryCount / n) > Math.floor(turn * primaryCount / n);
      const main = isPrimary ? primary : secondary, sub = main === primary ? secondary : primary;
      const row = { ...zero(), [main]: lesson.main, [sub]: lesson.sub };
      lessonRows.push(row); perAxis[main].lesson_end++; perAxis[main].sp_lesson_end++;
      stageRows[stage].push(row); stagePerAxis[stage][main].lesson_end++; stagePerAxis[stage][main].sp_lesson_end++;
      selections.push({ week: week.week, stage, fromExamIndex:examsPassed, activity: short[main] + '_lesson_' + short[sub], main, sub, gains: row }); turn++;
    } else if (classes[week.week] !== undefined) {
      const row = { ...zero(), [classAxis]: classes[week.week] };
      classRows.push(row); counts.class_work_end++;
      stageClasses[stage].push(row); stageCounts[stage].class_work_end++;
      selections.push({ week: week.week, stage, fromExamIndex:examsPassed, activity: 'class_' + short[classAxis], gains: row });
    } else {
      const declaredVisit=customizePath?(options.produceActions??[]).find(action=>action.week===week.week&&week.activities?.includes(action.venue==='consultation'?'consult':action.venue))?.venue:null;
      const activity = (declaredVisit==='consultation'?'consult':declaredVisit) ?? activityPriority.find(id => week.activities?.includes(id));
      const kind = ({ activity_supply: 'activity_supply_gift', supply_gift: 'activity_supply_gift', final_exam: 'exam_end', mid_exam: 'exam_end' })[activity] ?? activity;
      if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
      if (kind) stageCounts[stage][kind] = (stageCounts[stage][kind] ?? 0) + 1;
      selections.push({ week: week.week, stage, fromExamIndex:examsPassed, activity: activity ?? week.activities?.[0] ?? null });
      if(kind==='exam_end')examsPassed++;
    }
  }
  // The upstream source labels these three exam definitions tentative.
  // They are not reconstructed from the cached Hajime-only exam table.
  const examRewards=schedule.length?resolveHifExamRewards(catalog,options):[];
  const examRows=examRewards.map(reward=>reward.growthEligibleGains),examPostBonusRows=examRewards.map(reward=>reward.postBonusGains);
  let parameterBonusRows = [...lessonRows, ...examRows];
  stageRows.selection.push(...examRows);
  if (options.baseLessonGains) {
    parameterBonusRows = [{ ...zero(), ...options.baseLessonGains }];
    stageRows.selection = [...parameterBonusRows]; stageRows.final = [];
  }
  for (const axis of axes) Object.assign(perAxis[axis], options.perAxisCounts?.[axis] ?? {});
  if (options.expectedCounts?.sp_lesson_end != null || axes.some(axis => options.perAxisCounts?.[axis]?.sp_lesson_end != null)) {
    const lessonSelections = selections.filter(row => row.main);
    applySpLessonTotal(perAxis, options, lessonSelections.map(row => row.main));
    const used = zero();
    for (const row of lessonSelections) {
      if (++used[row.main] <= perAxis[row.main].sp_lesson_end) continue;
      row.isSpLesson = false;
      stagePerAxis[row.stage][row.main].sp_lesson_end--;
      stagePerAxis[row.stage][row.main].normal_lesson_end++;
      if (options.perAxisCounts?.[row.main]?.normal_lesson_end == null) perAxis[row.main].normal_lesson_end++;
    }
  }
  for (const kind of ['lesson_end', 'sp_lesson_end', 'normal_lesson_end']) counts[kind] = axes.reduce((sum, axis) => sum + perAxis[axis][kind], 0);
  Object.assign(counts, options.expectedCounts ?? {});
  for (const stage of ['selection', 'final']) for (const kind of ['lesson_end', 'sp_lesson_end', 'normal_lesson_end']) stageCounts[stage][kind] = axes.reduce((sum, axis) => sum + stagePerAxis[stage][axis][kind], 0);
  const normalizeActivity=activity=>({consultation:'consult',activity_supply:'supply_gift'})[activity]??activity;
  const excludedProduceActions=[];
  const produceActions=Array.isArray(options.produceActions)?options.produceActions.filter(action=>{
    if(!Number.isInteger(action.week)||!['consult','consultation','outing','supply_gift','activity_supply','special_training'].includes(action.venue))return true;
    const selected=selections.find(row=>row.week===action.week);
    const matches=normalizeActivity(selected?.activity)===normalizeActivity(action.venue);
    if(!matches)excludedProduceActions.push({...action,excludedReason:'명시 주차의 행동 장소가 이 동선에서 선택한 활동과 다름'});
    return matches;
  }):options.produceActions;
  const baseRoute = { counts, perAxis, gains: add(...parameterBonusRows,...examPostBonusRows), classGains: add(...classRows),
    lessonGains: add(...lessonRows), examGains: add(...examRows,...examPostBonusRows),examRewards,examRewardSources:rewardSources,parameterBonusRows, selections,
    stages: Object.fromEntries(['selection', 'final'].map(stage => [stage, { parameterBonusRows: stageRows[stage], gains: add(...stageRows[stage],...(stage==='selection'?examPostBonusRows:[])), classGains: add(...stageClasses[stage]), counts: stageCounts[stage], perAxis: stagePerAxis[stage] }])),
    difficulty, primary, secondary, classAttribute: classAxis,activityFocus,requestedActivityFocus,excludedProduceActions,
    modelAvailable: schedule.length > 0 && n > 0, modelSource: 'gaku_navi_hif_conditional_stat_model',
    explicitCounts: options.expectedCounts ?? {}, explicitGains: Boolean(options.baseLessonGains),
    notes: ['HIF 공개 계산기의 속성별 레슨·수업·선발시험 상승과 상승기회별 내림을 사용합니다. 레슨은 모두 SP 성공으로 가정합니다.',
      `비레슨·비수업 선택일은 ${customizePath?'특별 지도를 먼저 선택하고 ':''}${({balanced:'상담→사시이레→외출',consult:'상담',outing:'외출',supply_gift:'사시이레'})[activityFocus]} 순으로 가능한 활동을 고릅니다.`,
      '수업 고정 상승은 성장 보너스 대상에서 분리합니다. 선발시험 상승은 원본 계산기에서 성장 대상입니다.',
      options.hifExamResults?.some(row=>row.parameterGains)?'입력한 시험 보상은 basis에 따라 반영합니다. post_bonus는 성장 보정 후 값이라 재보정하지 않으며, 미입력 시험은 최대 보상 참고 가정입니다.':options.hifExamGains ? '선발시험 상승은 사용자가 입력한 성장 보정 전 기본값입니다.' : options.hifExamRatios ? '선발시험의 속성별 배분비는 사용자 입력이며 최대 기본·배분량은 공개 계산기의 잠정 정의입니다.' : '선발시험은 최대 보상 관측치와 균등 배분을 가정했습니다. 실제 점수·보상 배분을 확인한 값이 아닙니다.',
      '역속성 수업과 주·보조 속성 레슨의 여러 동선을 비교합니다. 실제 플레이와 동일한 경로를 보장하지 않습니다.'] };
  const planned = planHifSupportActions(baseRoute, catalog, { ...options, produceActions });
  if (selections.some(row => row.isSpLesson === false)) planned.route.notes.push('서포트의 SP 발동 횟수는 입력한 조건으로 제한하고 남은 횟수는 레슨 순서대로 배정합니다. 기본 레슨 상승량은 공개 계산 모델 기준입니다.');
  const route = withDeclaredProduceActions(planned.route, planned.actions, catalog,
    { examIndex: options.examIndex ?? 5, examDeckSizes: options.examDeckSizes });
  Object.assign(route.counts, options.expectedCounts ?? {});
  route.supportActionPlan = { ...planned.evidence, counts: route.explicitActionCounts ?? null };
  if (planned.evidence.generatedActions.length) route.notes.push('차입·외출·수업에서 카드를 받는 계획과 확인된 기본 카드 삭제 기회를 서포트 효과 횟수에 반영합니다. 실제 획득·카드 종류·P아이템 시점은 확정하지 않습니다.');
  return route;
}

function eventAvailable(event, level) {
  const required = String(event.release ?? '').match(/^lv(\d+)$/)?.[1];
  return !required || level >= Number(required);
}

function countFor(kind, triggerId, route) {
  const triggerAxis = axes.find(axis => String(triggerId).includes('lesson_' + axis));
  const key = ({ sp_lesson_hp: 'sp_lesson_end', sp_lesson_hp_all: 'sp_lesson_end', sp_lesson_pp: 'sp_lesson_end',
    exam_hp:'exam_end', activity_supply_gift_hp:'activity_supply_gift' })[kind] ?? kind;
  if (triggerAxis && route.perAxis[triggerAxis]?.[key] !== undefined) return route.perAxis[triggerAxis][key];
  return finite(route.counts[key]);
}

function declaredSupportItemReceipt(card, actions, catalog) {
  if (!card.p_item || !actions?.some(action => action.action === 'item_acquire')) return null;
  const native = (catalog?.pItems ?? []).filter(item => !item.isUpgraded && item.identityStatus === 'exact' &&
    (item.originSupportCardId === card.gameId || !item.originSupportCardId && item.nameJa === card.p_item.name));
  const itemId = card.p_item.gameId ?? (native.length === 1 ? native[0].gameId : null);
  return actions.find(action => action.action === 'item_acquire' && (
    card.gameId && (action.supportGameId === card.gameId || action.gameId === card.gameId) ||
    itemId && (action.itemGameId ?? action.gameId) === itemId || card.p_item.name && action.itemName === card.p_item.name
  )) ?? null;
}

function uniqueSkillAlreadyScheduled(skillId, supportId, actions, receiptWeek) {
  const rows = actions?.filter(action => action.gameId === skillId && ['acquire','remove','change'].includes(action.action));
  if (!rows?.some(action => action.action === 'acquire')) return false;
  if (rows.some(action => action.action === 'acquire' && (supportId && action.supportGameId === supportId || action.venue === 'support'))) return true;
  // A second copy can only be granted in a known gap between losing a
  // copy and obtaining another one. A future removal cannot free it now.
  if (!Number.isInteger(receiptWeek) || rows.some(action => !Number.isInteger(action.week) || action.week === receiptWeek)) return true;
  rows.sort((a,b) => a.week - b.week || (a.sequence ?? 0) - (b.sequence ?? 0));
  const before = rows.findLast(action => action.week < receiptWeek);
  const after = rows.find(action => action.week > receiptWeek);
  return before?.action === 'acquire' || after?.action === 'acquire';
}

// Receiving a support item is an action even if the item only works in
// battle. Its own trigger, effect or battle simulator mapping is immaterial.
function supportItemGrantStage(card, level, plan, route, options, declared) {
  const story = card.events?.find(event => event.effect_type === 'p_item');
  if (!card.p_item || !story || !eventAvailable(story, level) ||
    card.plan && !['free', 'common', plan].includes(card.plan)) return null;
  const acquisition = options.supportItemAcquisitions?.[card.gameId];
  if (acquisition && acquisition.confirmed !== true) return null;
  const start = acquisition ?? declared;
  if (!start) return options.supportPeakScenario === true && route.supportPeakScenario && options.includeSupportEvents !== false
    ? 'selection' : null;
  if (start.beforeProduce === true) return 'selection';
  const index = finite(start.fromExamIndex);
  if (!Number.isInteger(index) || index < 0 || index > (options.examIndex ?? 5)) return null;
  const lastWeek = route.selections?.at(-1)?.week;
  if (options.examIndex < 5 && Number.isFinite(lastWeek) && start.week > lastWeek) return null;
  return start.stage === 'final' || start.stage !== 'selection' && index >= 3 ? 'final' : 'selection';
}

function additionalLessonPP(cards,route) {
  let base, normal, sp;
  for (const card of cards) for (const bonus of card.resources?.lessonPPBonuses??[]) {
    if (!card.resources.baseLessonPP) continue;
    base=card.resources.baseLessonPP;
    normal??=zero(); sp??=zero();
    for (const axis of bonus.axis?[bonus.axis]:axes) {
      sp[axis]+=bonus.permil;
      if (!bonus.spOnly) normal[axis]+=bonus.permil;
    }
  }
  if (!base) return 0;
  let extra=0;
  for (const stage of ['selection','final']) for (const axis of axes) {
    const part=route.stages?.[stage]?.perAxis?.[axis];
    if(!part||!Number.isFinite(base[stage]))continue;
    extra+=(part.sp_lesson_end??0)*Math.floor(base[stage]*sp[axis]/1000)
      +(part.normal_lesson_end??0)*Math.floor(base[stage]*normal[axis]/1000);
  }
  return extra;
}

/** Level-resolved effects; no uncap-to-max substitution is performed here. */
export function calculateHifSupport(card, abilities, level, route, plan, options = {}) {
  const fixedStats = zero(), growthRatePermil = zero();
  const fixedStatsByStage = { selection: zero(), final: zero() };
  const resources = { spRates: zero(), stamina: 0, pp: 0 };
  const recordPP=(week,amount)=>{
    if(!Number.isFinite(week)||!amount)return;
    resources.ppByWeek??={}; resources.ppByWeek[week]=(resources.ppByWeek[week]??0)+amount;
  };
  const providedActions = {}, dynamicEffects = [], unscored = [];
  const events = options.includeSupportEvents === false ? [] : (card.events ?? []).filter(event => eventAvailable(event, level));
  const gives = kind => events.some(event => event.effect_type === kind);
  const grantsSkill = gives('skill_card') && card.skill_card &&
    !(card.skill_card.no_duplicate && options.blockedSkillNames?.includes(card.skill_card.name));
  const matches = grantsSkill ? (options.catalog?.skillCards ?? []).filter(skill => skill.upgradeCount === 0 &&
    (card.skill_card.gameId ? skill.gameId === card.skill_card.gameId : skill.nameJa === card.skill_card.name)) : [];
  const skillId = matches.length === 1 ? matches[0].gameId : null;
  const fullReceiptPlan = options.supportReceiptPlan;
  const sameReceipt = skillId && card.skill_card.no_duplicate && uniqueSkillAlreadyScheduled(
    skillId, card.gameId, fullReceiptPlan ?? route.produceActions, route.supportPeakScenario?.supportReceiptWeek);
  const providedSkillKey = grantsSkill && !sameReceipt && card.skill_card.no_duplicate ? card.skill_card.name : null;
  if (grantsSkill && !sameReceipt) {
    providedActions.skill_acquire = 1;
    if (card.skill_card.type === 'mental') providedActions.m_skill_acquire = 1;
    if (card.skill_card.type === 'active') providedActions.a_skill_acquire = 1;
    if (String(card.skill_card.rarity).toLowerCase() === 'ssr') providedActions.ssr_card_acquire = 1;
    if (skillId) {
      const counts = declaredProduceActionCounts([{ action: 'acquire', gameId: skillId, fromExamIndex: 0 }], options.catalog);
      for (const [kind, count] of Object.entries(counts)) if (/_card_acquire$/.test(kind) && count > 0) providedActions[kind] = count;
    }
  }
  const enhances = events.filter(event => ['card_enhance', 'select_enhance'].includes(event.effect_type)).length;
  if (enhances) providedActions.skill_enhance = enhances;
  // gaku-navi's card_change event explicitly means random starter-card change;
  // the catalog's native events all use p_card_search-deck_all-starter.
  const basicChangeStories = events.filter(event => event.effect_type === 'card_change').length;
  const changes = allocateStoryChanges(route.supportPeakScenario, basicChangeStories);
  if (changes.change) {
    providedActions.change = changes.change;
    providedActions.basic_card_change = changes.basic;
  }
  const routeItemReceipt = declaredSupportItemReceipt(card, route.produceActions, options.catalog);
  const receiptPlan = fullReceiptPlan ?? options.produceActions;
  const declaredItem = routeItemReceipt ?? (receiptPlan === route.produceActions ? null : declaredSupportItemReceipt(card, receiptPlan, options.catalog));
  const itemOptions = declaredItem ? { ...options, supportPeakItemReceipt: declaredItem } : options;
  const supportItemValue = evaluateSupportItemValue({card,plan,level,route,options:itemOptions,catalog:options.catalog??{}});
  const peakItem = options.supportPeakScenario === true ? supportItemValue?.peak : null;
  const scoredItem = peakItem?.total ?? supportItemValue?.applied;
  const itemByStage = peakItem?.byStage ?? supportItemValue?.byStage;
  const routeCountsReceipt = routeItemReceipt && route.counts.p_item_acquire > 0;
  const grantStage = routeCountsReceipt ? null : supportItemGrantStage(card, level, plan, route, options, declaredItem);
  if (grantStage) providedActions.p_item_acquire = 1;
  const providedActionsByStage = { selection: { ...providedActions }, final: {} };
  if (changes.earlyBasic !== changes.basic) {
    providedActionsByStage.selection.basic_card_change = changes.earlyBasic;
    providedActionsByStage.final.basic_card_change = changes.basic - changes.earlyBasic;
  }
  if (grantStage === 'final') {
    delete providedActionsByStage.selection.p_item_acquire;
    providedActionsByStage.final.p_item_acquire = 1;
  }
  const supportOperations=compileSupportOperations(card,events,grantsSkill&&!sameReceipt,skillId,route,options,itemByStage);
  const itemLink = itemResponse(card.p_item, peakItem,options.catalog,card.gameId,Boolean(route.supportPeakScenario?.cardTargetPlan));
  // The timeline's receipts are independent of the bottles granted by this
  // item. Only the latter are provided actions of this support card.
  if (scoredItem?.resources.pDrinkAcquisitions) {
    providedActions.p_drink_acquire = scoredItem.resources.pDrinkAcquisitions;
    for (const stage of ['selection', 'final'])
      providedActionsByStage[stage].p_drink_acquire = itemByStage[stage].resources.pDrinkAcquisitions;
  }
  const ownUses = ownItemUses(itemLink, providedActionsByStage);
  if (ownUses && itemLink.resources.pDrinkAcquisitions) {
    const bottles = itemLink.resources.pDrinkAcquisitions;
    providedActions.p_drink_acquire = (providedActions.p_drink_acquire ?? 0) + bottles * ownUses.count;
    for (const stage of ['selection', 'final']) providedActionsByStage[stage].p_drink_acquire =
      (providedActionsByStage[stage].p_drink_acquire ?? 0) + bottles * ownUses[stage];
  }
  const soloExams = extraDeckSizeTriggers(route.supportPeakScenario, providedActions.skill_acquire ?? 0,
    providedActionsByStage.selection.skill_acquire ?? 0);
  let eventBoostPermil = 0, eventPPBoost = 0, eventRecoveryBoost = 0;
  for (const ability of abilities) {
    if (!compatible(ability.plan, plan)) continue;
    if (ability.scenarioEnum && !/Unknown|HatsuboshiIdolFestival/.test(ability.scenarioEnum)) continue;
    if (ability.splitEnum && !/_Unknown$/.test(ability.splitEnum) && ability.splitEnum !== options.splitType) { unscored.push(ability.kind + ': 세부 시나리오 조건 미확인'); continue; }
    for (const effect of ability.effects ?? []) {
      const amount = finite(effect.min), axis = effectAxis(effect.type);
      if (amount === null || amount !== finite(effect.max)) { unscored.push(ability.kind + ': 변동 수치'); continue; }
      if (/GrowthRateAddition$/.test(effect.type ?? '') && axis) { growthRatePermil[axis] += amount; continue; }
      if (effect.type === 'ProduceEffectType_SupportCardEventParameterAdditionValueUp') { eventBoostPermil = Math.max(eventBoostPermil, amount); continue; }
      if (effect.type === 'ProduceEffectType_SupportCardEventProducePointAdditionValueUp') { eventPPBoost=Math.max(eventPPBoost,amount);continue; }
      if (effect.type === 'ProduceEffectType_SupportCardEventStaminaRecoverUp') { eventRecoveryBoost=Math.max(eventRecoveryBoost,amount);continue; }
      // Official スキルカードサポート raises the skill grade for the active
      // turn only. All 59 native support-story skill rewards use resourceLevel 0.
      if (effect.type === 'ProduceEffectType_SupportCardProduceCardUpgradeProbabilityUp') {resources.supportUpgradeProbabilityUpPermil=amount;continue;}
      if (effect.type === 'ProduceEffectType_ShopProduceDrinkPriceDiscountMultiple') {resources.drinkDiscountPermil=amount;continue;}
      if (effect.type === 'ProduceEffectType_LessonPresentProducePointUp') {
        const triggerAxis=axes.find(key=>String(effect.triggerId).includes('lesson_'+key))??null;
        (resources.lessonPPBonuses??=[]).push({axis:triggerAxis,spOnly:ability.kind==='sp_lesson_pp',permil:amount});
        resources.baseLessonPP=options.catalog?.produceResources?.hif?.publicLessonPP;
        continue;
      }
      if (/SpChangeRatePermilAddition$/.test(effect.type ?? '')) {
        for (const target of axis ? [axis] : axes) resources.spRates[target] += amount;
        continue;
      }
      const count = countFor(ability.kind, effect.triggerId, route);
      const self = ability.kind === 'exam_15' ? soloExams.selection + soloExams.final : providedActions[ability.kind] ?? 0;
      const maxCount = ability.activationLimit > 0 ? ability.activationLimit : Infinity;
      if (/^ProduceEffectType_(Vocal|Dance|Visual)Addition$/.test(effect.type ?? '') && axis) {
        const used = Math.min(maxCount, (count ?? 0) + self);
        if (count === null) unscored.push(ability.kind + ': 경로 기본 횟수 미확인; 제공 이벤트분만 반영');
        fixedStats[axis] += Math.floor(amount * used);
        const routeSelection = route.stages ? countFor(ability.kind, effect.triggerId, route.stages.selection) : count;
        const earlySelf = ability.kind === 'exam_15' ? soloExams.selection : providedActionsByStage.selection[ability.kind] ?? 0;
        const selectionCount = Math.min(used, (routeSelection ?? 0) + earlySelf);
        fixedStatsByStage.selection[axis] += Math.floor(amount * selectionCount);
        fixedStatsByStage.final[axis] += Math.floor(amount * used) - Math.floor(amount * selectionCount);
        if (ability.kind in providedActions || /acquire|enhance|delete|change/.test(ability.kind) ||
          (ability.kind === 'exam_15' && route.supportPeakScenario?.examDeckSizes) ||
          (ability.kind === 'sp_lesson_20' && route.supportPeakScenario?.cardTargetPlan)) dynamicEffects.push({
          axis, kind: ability.kind, amount, usedCount: used, maxCount, routeCount: count ?? 0, routeSelection: Math.min(count ?? 0, routeSelection ?? 0),
          usedCountByStage: { selection: selectionCount, final: used - selectionCount } });
      } else if (/StaminaRecoverFix|MaxStaminaAddition/.test(effect.type ?? '') && count !== null) resources.stamina += amount * Math.min(count, maxCount);
      else if (/ProducePointAdditionDisableTrigger/.test(effect.type ?? '') && count !== null) {
        const pp=amount*Math.min(count,maxCount);
        resources.pp+=pp;if(ability.kind==='initial_pp')recordPP(0,pp);
      }
      else unscored.push(ability.kind + ': 미구현 조건·효과');
    }
  }
  for (const event of events) {
    if (event.effect_type === 'param_boost' && axes.includes(event.param_type) && finite(event.param_value) !== null) {
      const amount = Math.floor(Number(event.param_value) * (1 + eventBoostPermil / 1000));
      fixedStats[event.param_type] += amount;
      fixedStatsByStage.selection[event.param_type] += amount;
    }
    else if (['hp_recovery','pp_gain'].includes(event.effect_type)) {
      // ProduceStepEventDetail fixes the two HP stories at 7, all thirteen
      // R-card PP stories at 10, and はじめてのお友達 at 25.
      const hp=event.effect_type==='hp_recovery';
      const amount=finite(event.param_value) ?? (hp && ['s_card-3-0019','s_card-3-0020'].includes(card.gameId) ? 7
        : !hp && /^s_card-1-00(?:0\d|1[012])$/.test(card.gameId) ? 10 : !hp && card.gameId==='s_card-2-0014' ? 25 : null);
      if(amount!==null) {
        const grant=Math.floor(amount*(1+(hp?eventRecoveryBoost:eventPPBoost)/1000));
        resources[hp?'stamina':'pp']+=grant;
        if(!hp)recordPP(event.release==='initial'?route.supportPeakScenario?.supportReceiptWeek:route.supportPeakScenario?.parameterStoryWeek,grant);
      }
      else unscored.push('서포트 이벤트 '+event.effect_type+': 원본 수치 미확인');
    }
    else if (!['skill_card', 'p_item', 'card_enhance', 'select_enhance', 'card_change','trouble_delete','select_delete'].includes(event.effect_type)) unscored.push('서포트 이벤트 ' + event.effect_type + ': 효과·선택 미확인');
  }
  if (card.skill_card) unscored.push('제공 스킬의 실제 화력·카드 순환은 시험 시뮬레이션 미구현');
  if (supportItemValue) {
    for (const axis of axes) {
      fixedStats[axis] += scoredItem.stats[axis] + (ownUses ? ownUses.count * itemLink.stats[axis] : 0);
      for (const stage of ['selection','final']) fixedStatsByStage[stage][axis] += itemByStage[stage].stats[axis]
        + (ownUses ? ownUses[stage] * itemLink.stats[axis] : 0);
    }
    resources.stamina += scoredItem.resources.hpRecovery + (ownUses ? ownUses.count * itemLink.resources.hpRecovery : 0);
    resources.pp += scoredItem.resources.pp + (ownUses ? ownUses.count * itemLink.resources.pp : 0);
    if(peakItem?.perActivation.resources.pp)for(const activation of scoredItem.activations)if(Number.isFinite(activation.week)){
      resources.itemPPByWeek??={};
      resources.itemPPByWeek[activation.week]=(resources.itemPPByWeek[activation.week]??0)+peakItem.perActivation.resources.pp*activation.count;
    }
    if(scoredItem.discounts?.length)resources.discounts=scoredItem.discounts;
    resources.pDrinkAcquisitions = providedActions.p_drink_acquire ?? 0;
    unscored.push(...supportItemValue.unscored.map(reason=>'P아이템 '+card.p_item.name+': '+reason));
  }
  const profile={gameId:card.gameId,fixedStats, fixedStatsByStage, growthRatePermil, resources, providedActions, providedActionsByStage, providedSkillKey, basicChangeStories,supportOperations,
    itemResponse:itemLink,dynamicEffects,supportItemValue,unscored};
  resolveSoloSupport(profile,route.supportPeakScenario);
  return {...profile,statContribution:add(fixedStats,calculateGrowthBonus(route.parameterBonusRows,growthRatePermil))};
}

/** Aggregated-rate rounding and final per-axis cap match the upstream evaluator. */
export function evaluateHifDeck(cards, { route, initialStats = zero(), outsideGrowthRatePermil = zero(), statCaps,
  axisWeights = { vocal: 1, dance: 1, visual: 1 }, baseSpRatePermil = zero(), stageContexts = null,
  searchOnly = false, explainSupportLinks = false }) {
  const linked = deckSupportLinks(cards, route.supportPeakScenario, explainSupportLinks);
  const synergyStatsByStage = linked.byStage;
  const synergyStats = add(synergyStatsByStage.selection, synergyStatsByStage.final);
  const cardRates = add(...cards.map(card => card.growthRatePermil));
  const rates = add(outsideGrowthRatePermil, cardRates);
  const growthBonus = calculateGrowthBonus(route.parameterBonusRows, rates);
  let rawStats, cappedStats;
  const wastedStats = zero();
  const stageResults = [];
  if (stageContexts && route.stages) {
    let carried = initialStats;
    for (const stage of ['selection', 'final']) {
      const settings = stageContexts[stage], stageRoute = route.stages[stage];
      const stageFixed = add(...cards.map(card => card.fixedStatsByStage?.[stage] ?? (stage === 'selection' ? card.fixedStats : zero())), synergyStatsByStage[stage]);
      const stageRates = add(settings.outsideGrowthRatePermil, cardRates);
      const stageGrowth = calculateGrowthBonus(stageRoute.parameterBonusRows, stageRates);
      rawStats = add(carried, settings.additionalInitialStats, stageRoute.gains, stageRoute.classGains, stageFixed, stageGrowth);
      cappedStats = Object.fromEntries(axes.map(axis => [axis, Math.min(rawStats[axis], settings.statCaps[axis] ?? Infinity)]));
      const wasted = Object.fromEntries(axes.map(axis => [axis, rawStats[axis] - cappedStats[axis]]));
      for (const axis of axes) wastedStats[axis] += wasted[axis];
      stageResults.push({ stage, rawStats, cappedStats, wastedStats: wasted, growthBonus: stageGrowth, statCaps: settings.statCaps, totalGrowthRatePermil: stageRates,
        examRewardApplications:searchOnly ? [] : (route.examRewards??[]).filter(reward=>reward.stage===stage).map(reward=>({...reward,
          nominalGainBeforeCap:hifExamRewardGain(reward,stageRates),growthAppliedOnce:reward.basis==='base',discardedByRewardAlone:null})) });
      carried = cappedStats;
    }
  } else {
    const fixed = add(synergyStats, ...cards.map(card => card.fixedStats));
    rawStats = add(initialStats, route.gains, route.classGains, fixed, growthBonus);
    cappedStats = Object.fromEntries(axes.map(axis => [axis, Math.min(rawStats[axis], statCaps[axis] ?? Infinity)]));
    for (const axis of axes) wastedStats[axis] = rawStats[axis] - cappedStats[axis];
  }
  const bonusSp = add(...cards.map(card => card.resources?.spRates));
  const spRatePermil = Object.fromEntries(axes.map(axis => [axis, Math.min(1000, (baseSpRatePermil[axis] ?? 0) + bonusSp[axis])]));
  const lessonBonusPP=additionalLessonPP(cards,route);
  const progress = { spRatePermil, spBonusPermil: bonusSp, lessonBonusPP,
    stamina: cards.reduce((sum, card) => sum + (card.resources?.stamina ?? 0), linked.resources.hpRecovery),
    pp: cards.reduce((sum, card) => sum + (card.resources?.pp ?? 0), linked.resources.pp+lessonBonusPP) };
  return { score: axes.reduce((sum, axis) => sum + cappedStats[axis] * axisWeights[axis], 0),
    rawStats, cappedStats, wastedStats, growthBonus, totalGrowthRatePermil: rates, progress, stageResults,
    synergyStats, providedActions: linked.provided, ...(explainSupportLinks ? { supportLinks: linked.links,
      ...(linked.operations?{targetResolution:linked.targetResolution,supportOperations:linked.operations,unresolvedSupportOperations:linked.unresolved,examDeckSizes:linked.examDeckSizes,lessonDeckSizes:linked.lessonDeckSizes}:{}) } : {}),
    growthRateCapApplied: false, note: '성장률 합산·상승기회별 내림·최종 스탯 상한 비교. 실제 시험 점수 예측이 아님.' };
}
