import { normalizeAttribute, normalizePlan } from './catalog.mjs';
import { selectStatMemories } from './memory-stat-selection.mjs';
import { buildScenarioStartItemPlan, scenarioStartItemAlternatives, scenarioEntryCondition } from './scenario-start-items.mjs';
import { applySpLessonTotal, fitWeeklySpAxes } from './sp-lesson-counts.mjs';
import { computeIdolGrowth } from './idol-growth.mjs';
import { buildHifRoute, calculateHifSupport, evaluateHifDeck } from './hif-model.mjs';
import { applyPeakExamDeckCounts } from './hif-support-actions.mjs';
import { buildSupportRatingContext, partialSupportRating, HIF_STAT_POINTS } from './hif-support-evaluation.mjs';
import { completeRentalDeck, groupSupportEffects, linkedSupportStarts } from './hif-support-search.mjs';
import { bestFixedDeckPolicy, fundingSwaps, replayFundedDeck } from './hif-funded-finals.mjs';
import { automaticHifPolicies, chooseHifActionStrategy } from './hif-action-strategies.mjs';
import { summarizeMemoryEffects } from './memory-effects.mjs';
import { findHifMemoryProfile, evaluateHifGuideRole, hifGuideConflicts, summarizeHifGuideProfile } from './hif-memory-profile.mjs';
import { createHifConcentrationCarry } from './hif-concentration-carry.mjs';
import { buildProduceResourceLedger } from './produce-resource-ledger.mjs';
import { buildHifAbilityTargetContext, fulfilledHifEffectIds, selectHifAbilityCopies } from './hif-ability-guidance.mjs';
import { idolRecipeContext } from './idol-recipe-policy.mjs';
import { eligibleNiaPresets, resolveExcelSupportCounts } from './excel-support-counts.mjs';
import { hajimeProRoutes } from './hajime-pro-route.mjs';
import { evaluateHajimeProSupportStories, isStoryRewardBoost } from './hajime-support-stories.mjs';
import { prepareScenarioTimeline, scoreScenarioSupportItem, evaluateScenarioDeck, scenarioStatCaps, hajimeFreeActivities, scenarioRentalScoreCeiling, fixedScenarioSupportGroup } from './non-hif-support.mjs';
import { niaChallengeBonusStats, scenarioRewardOptions } from './scenario-reward-items.mjs';
import { hajimeMasterRoutes, applyHajimeLessonLimit } from './hajime-master-route.mjs';

const axes = ['vocal', 'dance', 'visual'];
const fixedActionLayout = Symbol('selected lesson layout for purchase comparison');
const beamActionAlternative = Symbol('action comparison for the original support beam');
const policyFinalists = Symbol('request-local HIF policy finalists');
const policyWitness = Symbol('winning fixed-deck policy');
const axisShort = { vocal: 'vo', dance: 'da', visual: 'vi' };
const compatible = (candidate, plan) => !plan || plan === 'free' || !candidate || candidate === 'free' || candidate === plan;
const value = input => input === '' || input === null || input === undefined ? null : Number.isFinite(Number(input)) ? Number(input) : null;
const record = input => ({ ...(input?.raw ?? {}), ...input });
const gameId = row => String(row?.gameId ?? row?.supportCardId ?? row?.idolCardId ?? row?.id ?? '');
const zeroAxes = () => ({ vocal: 0, dance: 0, visual: 0 });
const round = number => Math.round(number * 100) / 100;
const effectAxis = type => axes.find(axis => String(type).toLowerCase().includes(axis));
const scenarioFromEnum = name => /NextIdolAudition/.test(name ?? '') ? 'nia' : /HatsuboshiIdolFestival/.test(name ?? '') ? 'hif' : /FirstStar/.test(name ?? '') ? 'hajime' : null;
const axisInTrigger = id => axes.find(axis => String(id).includes(`lesson_${axis}`));
const canonicalTrainingType = type => ({ goodCondition: 'goodConditionTurns', good_condition: 'goodConditionTurns', goodImpression: 'goodImpressionTurns',
  good_impression: 'goodImpressionTurns', full_power: 'fullPower', enthusiasm: 'strength' })[type] ?? type;
const trainingTypePlans = { concentration: 'sense', goodConditionTurns: 'sense', motivation: 'logic', goodImpressionTurns: 'logic', fullPower: 'anomaly', strength: 'anomaly', preservation: 'anomaly' };

function preparationTargetsOf(options) {
  const targets = options.preparationTargets;
  if (targets === undefined) return null;
  if (!targets || Array.isArray(targets) || typeof targets !== 'object' || Object.keys(targets).length !== 3
    || axes.some(axis => typeof targets[axis] !== 'number' || !Number.isFinite(targets[axis]) || targets[axis] <= 0))
    throw new RangeError('preparationTargets must contain three positive finite numbers: vocal, dance, visual');
  return Object.fromEntries(axes.map(axis => [axis, targets[axis]]));
}

function preparationAssessment(stats, targets) {
  if (!targets) return { enabled: false, met: null, targets: null, status: 'not_requested' };
  const shortfall = Object.fromEntries(axes.map(axis => [axis,
    typeof stats?.[axis] === 'number' && Number.isFinite(stats[axis]) ? Math.max(0, targets[axis] - stats[axis]) : null]));
  const missingAxes = axes.filter(axis => shortfall[axis] !== 0);
  return { enabled: true, met: !missingAxes.length, targets, shortfall, missingAxes,
    totalShortfall: axes.some(axis => shortfall[axis] === null) ? null : axes.reduce((sum, axis) => sum + shortfall[axis], 0) };
}

function idolGrowthIndex(card, owned, axisWeights) {
  const computed = computeIdolGrowth(card, owned);
  const growth = owned.currentGrowthRatePermil ?? computed.currentGrowthRatePermil;
  const known = growth ?? computed.growthBreakdown?.knownTotal ?? card.baseStats?.growthRatePermil ?? {};
  const awakening = value(owned.awakeningRank ?? owned.potentialRank ?? owned.awakening);
  return { ...computed, currentGrowthRatePermil: growth, awakening,
    score: axes.reduce((sum, axis) => sum + (known[axisShort[axis]] ?? 0) / 10 * axisWeights[axis], 0) };
}

export function routeAssumption(catalog, scenario, target, options) {
  if (scenario === 'hif') return buildHifRoute(catalog, target ?? 'vocal', options.classAttribute === 'auto' ? { ...options, classAttribute: undefined } : options);
  const counts = { initial_stat: 1, initial_pp: 1, parameter_bonus: 1, max_hp: 1,
    sp_lesson_rate: 1, sp_lesson_rate_all: 1, class_work_end: 0, consult: 0,
    outing: 0, rest: 0, activity_supply_gift: 0, special_training: 0, exam_end: 0 };
  const gains = zeroAxes(), classGains = zeroAxes(), selections = [], lessonRows = [];
  const spOrder = [];
  const perAxis = Object.fromEntries(axes.map(axis => [axis, { lesson_end: 0, sp_lesson_end: 0, normal_lesson_end: 0 }]));
  const notes = [];
  const models = catalog.calculationModels ?? {};
  const defaultDifficulty = catalog.scenarios?.find(row => row.id === scenario)?.defaultDifficulty ?? (scenario === 'nia' ? 'master' : 'legend');
  const difficulty = scenario === 'nia' && options.difficulty === 'none' ? defaultDifficulty : options.difficulty ?? defaultDifficulty;
  let modelAvailable = false;
  let modelSource = 'community_calculation_model';
  let excelSupportCounts = null;
  const knownRouteCounts = {};
  if (scenario === 'nia') {
    if (!['pro', 'master'].includes(difficulty)) throw new RangeError('NIA 난이도는 프로 또는 마스터를 선택해 주세요.');
    const excel = resolveExcelSupportCounts(catalog, { scenario, routePreset: options.routePreset });
    const preset = excel.preset;
    excelSupportCounts = { ...excel.source, unconfirmed: excel.unconfirmed };
    const data = Object.fromEntries((preset?.values ?? []).map(row => [row.label, value(row.value)]));
    Object.assign(counts, excel.counts);
    const main = target ?? 'vocal';
    for (const axis of axes) {
      gains[axis] = data[axis === main ? 'メインパラメータ上昇量' : 'サブパラメータ上昇量'] ?? 0;
      perAxis[axis].sp_lesson_end = data[axis === main ? 'メインSPレッスン' : 'サブSPレッスン'] ?? 0;
      perAxis[axis].normal_lesson_end = data[axis === main ? 'メイン通常レッスン' : 'サブ通常レッスン'] ?? 0;
      perAxis[axis].lesson_end = data[axis === main ? 'メインレッスン' : 'サブレッスン'] ?? (perAxis[axis].sp_lesson_end + perAxis[axis].normal_lesson_end);
    }
    // The workbook supplies totals rather than dates. Consume the target
    // axis first when reconciling a smaller user-entered SP total.
    for (const axis of [main, ...axes.filter(axis => axis !== main)]) {
      for (let i = 0; i < perAxis[axis].sp_lesson_end; i++) spOrder.push(axis);
    }
    notes.push(preset ? `NIA 경로는 제공 엑셀의 캐시 프리셋 「${preset.name}」을 사용합니다. 현행 경로의 실측값이 아닙니다.` : 'NIA 경로 프리셋을 읽지 못해 초기 효과만 수치화합니다.');
    modelAvailable = Boolean(preset);
    modelSource = 'user_excel_cached_reference';
    notes.push(`NIA ${difficulty === 'pro' ? '프로' : '마스터'} 일정을 사용합니다. 서포트 비교 횟수는 난이도와 별도로 엑셀 프리셋을 따릅니다.`);
  } else {
    const schedules = models['score/schedule']?.table?.[scenario] ?? {};
    if (options.difficulty && !Object.hasOwn(schedules, difficulty) && !catalog.hajimeSchedule?.[difficulty]?.length) throw new RangeError('No such difficulty in the calculation model');
    const schedule = models['score/schedule']?.table?.[scenario]?.[difficulty] ?? [];
    const lessons = models['score/lesson']?.table?.[scenario]?.[difficulty] ?? {};
    const classes = models['score/class']?.table?.[scenario]?.[difficulty] ?? {};
    let turn = 0;
    let rotation=0;
    const plannedAxes=schedule.flatMap(({week})=>{
      if (!lessons[week]?.[0] && classes[week]===undefined) return [];
      const axis=target??axes[rotation%3];
      rotation++;
      return lessons[week]?.[0] ? [axis] : [];
    });
    const lessonAxes = difficulty==='legend' && plannedAxes.length ? fitWeeklySpAxes(plannedAxes,options) : null;
    for (const week of schedule) {
      const lesson = lessons[week.week]?.[0];
      if (lesson) {
        const main = lessonAxes?.[lessonRows.length] ?? target ?? axes[turn % 3];
        turn++;
        const row = Object.fromEntries(axes.map(axis=>[axis, axis === main ? lesson.main : lesson.sub]));
        lessonRows.push(row);
        for (const axis of axes) gains[axis] += row[axis];
        selections.push({week:week.week, activity:'sp_lesson', axis:main});
        perAxis[main].lesson_end++;
        perAxis[main].sp_lesson_end++;
        spOrder.push(main);
        continue;
      }
      if (classes[week.week] !== undefined) {
        const axis = target ?? axes[turn++ % 3];
        classGains[axis] += classes[week.week];
        selections.push({week:week.week, activity:'class', axis});
        counts.class_work_end = (counts.class_work_end ?? 0) + 1;
        continue;
      }
      const activities = week.activities ?? [];
      const selected = ['consult', 'activity_supply', 'supply_gift', 'outing', 'special_training', 'final_exam', 'mid_exam'].find(id => activities.includes(id));
      selections.push({week:week.week, activity:selected ?? null});
      const key = ({ activity_supply: 'activity_supply_gift', supply_gift: 'activity_supply_gift', final_exam: 'exam_end', mid_exam: 'exam_end' })[selected] ?? selected;
      if (key) counts[key] = (counts[key] ?? 0) + 1;
    }
    modelAvailable = schedule.length > 0 && Object.keys(lessons).length > 0;
    if (!schedule.length && difficulty === 'master' && !options.eventModeId && catalog.hajimeSchedule?.master?.length) {
      modelSource = 'hajime_master_schedule_without_lesson_amounts';
      for (const [i, menu] of catalog.hajimeSchedule.master.entries()) {
        const week = i + 1;
        const main = target ?? axes[turn % axes.length];
        let activity = null, axis = null;
        if (menu.includes('class')) {
          activity = 'class'; axis = main; counts.class_work_end++;
        } else if (menu.includes('lesson') || menu.includes('intensive_lesson')) {
          axis = main; turn++;
          activity = menu.includes('intensive_lesson') ? 'intensive_lesson'
            : options.scenarioRewardSpWeeks?.includes(week) ? 'sp_lesson' : 'lesson';
          perAxis[axis].lesson_end++;
          if (activity === 'sp_lesson') { perAxis[axis].sp_lesson_end++; spOrder.push(axis); }
        } else if (menu.some(a=>/^hajime_.*_exam$/.test(a))) {
          activity = menu[0]; counts.exam_end++;
        }
        selections.push({week,activity,axis});
      }
      Object.assign(knownRouteCounts,{class_work_end:true,exam_end:true,lesson_end:true,sp_lesson_end:spOrder.length>0});
    }
    const difficultyLabel = ({ regular: '레귤러', pro: '프로', master: '마스터', legend: '레전드', none: '기본' })[difficulty] ?? difficulty;
    if (modelAvailable) notes.push(`初 ${difficultyLabel} 공개 계산 모델의 일정·레슨 표를 사용합니다. SP 횟수 미입력 시 가능한 레슨에서 SP 성공을 가정합니다. 자유 주차는 실제 입력한 방문과 메뉴에서 고른 비교 후보를 따릅니다. 수업의 고정 상승분에는 성장률을 곱하지 않는 임시 가정입니다.`);
    else notes.push(`初 ${difficultyLabel}의 레슨 상승량은 미확인입니다. 일정에서 확인한 행동과 입력한 효과만 비교합니다.`);
  }
  for (const axis of axes) Object.assign(perAxis[axis], options.perAxisCounts?.[axis] ?? {});
  applySpLessonTotal(perAxis, options, spOrder);
  if (selections.length && (options.perAxisCounts || options.expectedCounts?.sp_lesson_end != null)) {
    const remaining = Object.fromEntries(axes.map(axis=>[axis,perAxis[axis].sp_lesson_end]));
    for (const row of selections) if (row.activity === 'sp_lesson') {
      if (remaining[row.axis] >= 1) remaining[row.axis]--;
      else row.activity='lesson';
    }
    for (const axis of axes) if (options.perAxisCounts?.[axis]?.normal_lesson_end==null) {
      perAxis[axis].normal_lesson_end=selections.filter(row=>row.activity==='lesson' && row.axis===axis).length;
    }
  }
  if (options.expectedCounts?.sp_lesson_end != null) notes.push(scenario === 'nia'
    ? 'SP 발동 횟수는 입력한 속성별 횟수와 총횟수를 적용합니다. 엑셀에는 주차 순서가 없어 남은 횟수는 목표 속성부터 배정합니다. 기본 레슨 상승량은 프리셋 기준입니다.'
    : 'SP 발동 횟수는 입력한 속성별 횟수와 총횟수를 적용합니다. 남은 횟수는 레슨 순서대로 배정하며 기본 레슨 상승량은 경로 모델 기준입니다.');
  for (const kind of ['lesson_end', 'sp_lesson_end', 'normal_lesson_end']) counts[kind] = axes.reduce((sum, axis) => sum + perAxis[axis][kind], 0);
  Object.assign(counts, options.expectedCounts ?? {});
  Object.assign(gains, options.baseLessonGains ?? {});
  return { counts, perAxis, gains, classGains, notes, difficulty, modelAvailable, modelSource, selections, targetAxis:target ?? null,
    ...(lessonRows.length ? {parameterBonusRows:options.baseLessonGains ? [gains] : lessonRows} : {}),
    explicitCounts: options.expectedCounts ?? {}, explicitGains: Boolean(options.baseLessonGains), knownRouteCounts, excelSupportCounts };
}

function contribution(effects, countFor, route, weights, activationLimit) {
  const stats = zeroAxes();
  const resources = { spRates: zeroAxes(), stamina: 0, pp: 0 };
  let utility = 0, unscored = 0;
  const features = [];
  for (const effect of effects) {
    const amount = value(effect.min);
    if (amount === null || amount !== value(effect.max)) { unscored++; continue; }
    const axis = effectAxis(effect.type);
    let count = countFor(effect);
    if (count === null || !Number.isFinite(count)) { unscored++; continue; }
    if (activationLimit > 0) count = Math.min(count, activationLimit);
    if (effect.type?.endsWith('GrowthRateAddition') && axis) {
      if (!route.modelAvailable && !route.explicitGains) { unscored++; continue; }
      stats[axis] += route.parameterBonusRows
        ? route.parameterBonusRows.reduce((sum, row) => sum + Math.floor(amount * row[axis] / 1000), 0)
        : amount / 1000 * route.gains[axis];
    }
    else if (/^ProduceEffectType_(Vocal|Dance|Visual)Addition$/.test(effect.type ?? '') && axis) stats[axis] += amount * count;
    else if (/SpChangeRatePermilAddition$/.test(effect.type ?? '')) {
      const percent = amount / 10;
      utility += percent * weights.sp;
      for (const target of axis ? [axis] : axes) resources.spRates[target] += amount;
      features.push(`SP율 +${round(percent)}%p`);
    } else if (/StaminaRecoverFix|MaxStaminaAddition/.test(effect.type ?? '')) {
      utility += amount * count * weights.stamina;
      resources.stamina += amount * count;
      features.push(`체력 효과 ${round(amount * count)}`);
    } else if (/ProducePointAdditionDisableTrigger/.test(effect.type ?? '')) {
      utility += amount * count * weights.pp;
      resources.pp += amount * count;
      features.push(`P포인트 ${round(amount * count)}`);
    } else unscored++;
  }
  return { stats, utility, unscored, features, resources };
}

function scoreSupport(card, owned, route, plan, scenario, axisWeights, weights, rental = false, options = {}, sameLevelProfile = null) {
  const data = record(owned);
  const level = value(data.level);
  const uncap = value(data.uncap ?? data.levelLimitRank);
  if (level === null || uncap === null || level < 1 || !Number.isInteger(uncap) || uncap < 0 || uncap > 4) return null;
  const cap = value(card.maxLevels?.[uncap]);
  if (cap !== null && level > cap) return null;
  const ownedLevel = rental ? null : value(data.ownedLevel ?? data.level);
  const levelBasis = rental ? 'rental' : data.supportLevelBasis ?? 'current';
  const levelReason = levelBasis === 'uncapMax' && ownedLevel !== level
    ? `보유 Lv.${ownedLevel} → 현재 ${uncap}돌 상한 Lv.${level}의 해금 효과 사용`
    : `${rental ? '렌탈 가정' : '보유'} Lv.${level}의 해금 효과 사용`;
  const latest = new Map();
  for (const ability of card.levelAbilities ?? []) if (ability.level <= level && (!latest.has(ability.order) || latest.get(ability.order).level <= ability.level)) latest.set(ability.order, ability);
  if (scenario === 'hif') {
    const profile = sameLevelProfile ?? calculateHifSupport(card, [...latest.values()], level, route, plan, options);
    const utility = Math.max(...axes.map(axis => profile.resources.spRates[axis])) / 10 * weights.sp
      + profile.resources.stamina * weights.stamina + profile.resources.pp * weights.pp;
    return { ...card, ...profile, level, ownedLevel, levelBasis, levelCap:cap, uncap, rental, availabilityVerified: !rental,
      score: round(axes.reduce((sum, axis) => sum + profile.statContribution[axis] * axisWeights[axis], utility)),
      utilityScore: round(utility), unscoredEffects: profile.unscored.length,
      reasons: [levelReason, '서포트가 서로 제공하는 행동과 성장률을 합산하고 단계별 상한을 적용합니다.',
        ...(card.sourceConflict ? ['출처 수치 차이가 있는 카드: 공개 마스터의 계산 레벨별 수치 사용'] : []), ...profile.unscored.slice(0, 3)] };
  }
  const stats = zeroAxes();
  const resources = { spRates: zeroAxes(), stamina: 0, pp: 0 };
  let utility = 0, unscored = 0;
  const features = [];
  const itemReceivers = [], growthRates = zeroAxes(), individualGrowth = zeroAxes();
  const stories = route.hajimePro && evaluateHajimeProSupportStories(card, level, {plan,
    includeSupportEvents: options.includeSupportEvents, abilities: latest.values()});
  if (stories) {
    Object.assign(stats, stories.stats);
    Object.assign(resources, stories.resources);
    utility += resources.pp * weights.pp + resources.stamina * weights.stamina;
    features.push(...stories.reasons);
    unscored += stories.unscoredEffects;
  }
  for (const ability of latest.values()) {
    const requiredScenario = scenarioFromEnum(ability.scenarioEnum);
    if (!compatible(ability.plan, plan) || (requiredScenario && requiredScenario !== scenario)) continue;
    const countFor = effect => {
      if (ability.kind === 'support_rate') return null;
      const countKind = ({ sp_lesson_hp: 'sp_lesson_end', sp_lesson_hp_all: 'sp_lesson_end', sp_lesson_pp: 'sp_lesson_end' })[ability.kind]
        ?? (route.hajimePro ? ({exam_hp: 'exam_end', activity_supply_gift_hp: 'activity_supply_gift'})[ability.kind] : null) ?? ability.kind;
      const initialKinds = ['initial_stat', 'initial_pp', 'max_hp', 'sp_lesson_rate', 'sp_lesson_rate_all'];
      if (!route.modelAvailable && !route.knownRouteCounts?.[countKind] && !initialKinds.includes(countKind) &&
        !Object.hasOwn(route.explicitCounts, countKind) && !(countKind === 'parameter_bonus' && route.explicitGains)) {
        return route.minimumCounts?.[countKind] || null;
      }
      const keyed = route.counts[countKind];
      if (keyed === undefined) return null;
      const triggerAxis = axisInTrigger(effect.triggerId);
      return triggerAxis && route.perAxis[triggerAxis]?.[countKind] !== undefined ? route.perAxis[triggerAxis][countKind] : keyed;
    };
    const effects = stories ? ability.effects.filter(effect => !isStoryRewardBoost(effect.type)) : ability.effects;
    const result = contribution(effects, countFor, route, weights, ability.activationLimit);
    for (const effect of effects) {
      const amount = value(effect.min), axis = effectAxis(effect.type);
      if (!axis || amount === null || amount !== value(effect.max)) continue;
      if (['p_drink_acquire','skill_enhance'].includes(ability.kind) &&
        /^ProduceEffectType_(Vocal|Dance|Visual)Addition$/.test(effect.type)) {
        itemReceivers.push({kind:ability.kind,axis,amount,used:countFor(effect) ?? 0,
          limit:ability.activationLimit > 0 ? ability.activationLimit : Infinity});
      }
      if (effect.type?.endsWith('GrowthRateAddition') && (route.modelAvailable || route.explicitGains) && countFor(effect) != null) {
        growthRates[axis] += amount;
        individualGrowth[axis] += route.parameterBonusRows
          ? route.parameterBonusRows.reduce((sum,row)=>sum + Math.floor(row[axis] * amount/1000),0)
          : route.gains[axis] * amount/1000;
      }
    }
    for (const axis of axes) stats[axis] += result.stats[axis];
    for (const axis of axes) resources.spRates[axis] += result.resources.spRates[axis];
    resources.stamina += result.resources.stamina; resources.pp += result.resources.pp;
    utility += result.utility; unscored += result.unscored; features.push(...result.features);
  }
  const supportItemValue = scoreScenarioSupportItem(card, level, route, plan, options, options.catalog);
  const item = supportItemValue?.comparison.total;
  if (item) {
    for (const axis of axes) stats[axis] += item.stats[axis];
    resources.stamina += item.resources.hpRecovery;
    resources.pp += item.resources.pp;
    utility += item.resources.hpRecovery * weights.stamina + item.resources.pp * weights.pp;
  }
  return {
    ...card, level, ownedLevel, levelBasis, levelCap:cap, uncap, rental, availabilityVerified: !rental,
    score: round(axes.reduce((sum, axis) => sum + stats[axis] * axisWeights[axis], utility)),
    statContribution: Object.fromEntries(axes.map(axis => [axis, round(stats[axis])])),
    utilityScore: round(utility), resources, supportItemValue, itemReceivers, growthRates, individualGrowth,
    unscoredEffects: unscored + (stories ? 0 : (card.events?.length ?? 0) + (card.skill_card ? 1 : 0)),
    uniqueProvidedSkill: card.skill_card?.no_duplicate ? card.skill_card.name : null,
    reasons: [...features, levelReason, ...(card.sourceConflict ? ['출처 차이가 있는 카드: 공개 마스터 레벨별 수치 선택'] : [])],
  };
}

// Qualitative roles come from the exact carried variant's actions. They do not
// certify buff/cost conditions, customization calculations, or an exam clear.
export function memoryBattleRoles(memory, policy) {
  const carried = memory.modelEffects?.carriedSkill, skill = memory.skillCard;
  const actions = `${carried?.actions ?? skill?.actions ?? ''};${carried?.effects ?? skill?.effects ?? ''}`;
  const roles = [];
  if (/(?:^|[;{}]\s*)\s*score\s*(?:\+=|=)/.test(actions)) roles.push('attack');
  if (/\b(?:drawCard|exchangeHand|moveSelectedToHand|moveRandomToHand)\b/.test(actions)) roles.push('draw');
  if (/\bcardUsesRemaining\s*\+=\s*[1-9]/.test(actions)) roles.push('extra_action');
  if (/\bg\.(?:score|scoreTimes)\s*[+*=]|\bupgradeHand\b/.test(actions)) roles.push('strengthen');
  const sourcePolicy = policy?.cards?.find(row => row.gameId === carried?.id && row.action !== 'avoid');
  const verified = carried?.obtainable === true;
  return { roles, verified, availableAtStart: verified && carried.phase?.availableAtStart === true,
    useCondition: carried?.conditions || skill?.conditions || null,
    activationConditions: [...new Set([...actions.matchAll(/\bif:([^;{}]+)/g)].map(match => match[1].trim()))],
    hasDelayedEffects: /\bat:/.test(actions), actionDescriptionScope: carried?.actionDescriptionScope ?? 'exact_variant_actions',
    policyCandidate: verified && Boolean(sourcePolicy), sourceIds: sourcePolicy?.sourceIds ?? [],
    conditionsVerified: false };
}

export function canAddMemoryCopy(chosen, candidate, scenario, duplicateExceptions) {
  const skillId = candidate.modelEffects?.carriedSkill?.id;
  return !chosen.some(other => other.id === candidate.id ||
    (skillId && !duplicateExceptions.has(String(skillId)) && other.modelEffects?.carriedSkill?.id === skillId) ||
    (scenario !== 'hif' && candidate.uniqueKeys.some(key => other.uniqueKeys.includes(key))));
}

function selectMemories(inventory, catalog, plan, scenario, route, axisWeights, weights, options, warnings) {
  const guideProfile = scenario === 'hif' ? options.guideMemoryProfile : null;
  const selectionMode = options.memorySelectionMode ?? 'guide';
  if (!['guide','opening','stats'].includes(selectionMode)) throw new RangeError('Unsupported memorySelectionMode');
  const manual = Boolean(options.desiredSkillIds?.length);
  const guidePrioritized = Boolean(selectionMode === 'guide' && !manual && guideProfile?.status === 'conditional_guide_profile');
  const concentration = guidePrioritized ? createHifConcentrationCarry({
    catalog, inventory, selectedIdol: options.hifSelectedIdol, options: { ...options, plan, scenario },
  }) : null;
  // The source's Presence preference depends on the other three copies and the idol's native supply.
  const characterRules = selectionMode === 'guide' ? (guideProfile?.characterSelectionRules ?? []).filter(rule =>
    rule.applies === true && !(concentration?.active && rule.gameId === 'p_card-01-men-2_037')) : [];
  const policy = catalog.playbookPolicies?.policies?.find(row => row.scenario === scenario && row.plan === plan && row.trainingType === options.trainingType);
  const semanticKeys = new WeakMap();
  const semanticKey = memory => {
    if (!semanticKeys.has(memory)) {
      const effect = memory.modelEffects, skill = effect?.carriedSkill;
      semanticKeys.set(memory, JSON.stringify([skill?.id ?? null, skill?.upgrade ?? skill?.upgradeCount ?? null, skill?.phase?.code ?? null,
        (skill?.customizes ?? []).map(custom => [custom.id, custom.customizeCount, custom.exactCountKnown]).sort(),
        effect?.initialStats, effect?.growthRatePermil, skill?.obtainable, memory.uniqueKeys.slice().sort(),
        (effect?.hifEffects ?? []).map(entry => [entry.abilityId, entry.abilityLevel, entry.effectId, entry.applies]).sort(),
        (effect?.conditionalEffects ?? []).map(entry => [entry.abilityId, entry.abilityLevel, entry.effectId, entry.trigger?.id, entry.applies]).sort()]));
    }
    return semanticKeys.get(memory);
  };
  // This recommendation rule is intentionally stricter than noDeckDuplication.
  // A requested skill alone is not permission to fill several slots with it.
  const duplicateExceptions = new Set((options.allowDuplicateMemorySkillIds ?? []).map(String));
  const carriedId = memory => memory.modelEffects?.carriedSkill?.id ?? null;
  const skillIndex = new Map(catalog.skillCards.map(row => [`${row.gameId}:${row.upgradeCount ?? 0}`, row]));
  const rows = [];
  const missingSkillIdentityMemoryIds = [], unverifiedSkillEligibilityMemoryIds = [];
  for (const original of inventory.memories ?? []) {
    const memory = record(original);
    const skillRef = memory.produceCard ?? memory.skillCard ?? {};
    const sid = memory.produceCardId ?? memory.skillCardId ?? skillRef.produceCardId ?? skillRef.gameId ?? skillRef.id;
    const upgrade = value(memory.produceCardUpgradeCount ?? memory.upgradeCount ?? skillRef.upgradeCount);
    const skill = skillIndex.get(`${sid}:${upgrade}`);
    if (skill && !compatible(skill.plan, plan)) {
      warnings.add('선택 플랜과 다른 스킬을 가진 메모리는 반입 스탯이 높아도 추천에서 제외했습니다.');
      continue;
    }
    if (skill?.recommendationEligible === false) {
      warnings.add('사용 가능한 카드로 확인되지 않은 메모리 스킬은 추천에서 제외했습니다.');
      continue;
    }
    const abilityRefs = memory.abilities ?? memory.memoryAbilities ?? [];
    const summaryInput = { ...memory, raw: { ...memory,
      produceCard: memory.produceCard ?? (sid && upgrade !== null ? { id: sid, upgradeCount: upgrade, customizes: [] } : undefined),
      abilities: Array.isArray(abilityRefs) ? abilityRefs.map(ref => typeof ref === 'string' ? { id: ref } : { ...ref, id: ref.id ?? ref.memoryAbilityId ?? ref.gameId }) : [],
    } };
    let modelEffects = options.memoryEffectCache?.get(original);
    if (!modelEffects) {
      modelEffects = summarizeMemoryEffects(summaryInput, catalog, { ...options,scenario, plan, producerLevel: options.producerLevel ?? inventory.producerLevel,
        skillCardSwitchSettings: options.skillCardSwitchSettings ?? inventory.skillCardSwitchSettings });
      options.memoryEffectCache?.set(original, modelEffects);
    }
    if (selectionMode === 'stats') {
      const copyId = memory.id ?? memory.memoryId ?? memory.userMemoryId;
      if (copyId == null || String(copyId).trim() === '') {
        warnings.add('스탯 모드에서 보유 사본 ID가 없어 실제 선택할 수 없는 메모리는 제외했습니다.');
        continue;
      }
      if (!sid && !modelEffects.carriedSkill) {
        missingSkillIdentityMemoryIds.push(copyId);
        warnings.add('스탯 모드에서 반입 스킬 정보가 없는 사본은 장착 조건을 확인할 수 없어 추천 칸에서 제외했습니다.');
        continue;
      }
      if (!modelEffects.carriedSkill?.variantKnown || modelEffects.carriedSkill.obtainable == null) {
        unverifiedSkillEligibilityMemoryIds.push(copyId);
        warnings.add('스탯 모드에서 반입 스킬의 강화 단계·PLv·스위치 조건을 확인할 수 없는 메모리는 제외했습니다.');
        continue;
      }
    }
    if (modelEffects.carriedSkill?.obtainable === false) {
      warnings.add(modelEffects.carriedSkill.levelEligible === false ?
        '현재 PLv의 반입 단계에 맞지 않는 메모리 스킬은 제외했습니다. 일반 해금과 반입 PLv는 구분합니다.' :
        '현재 플랜·스킬 전환·반입 조건을 충족하지 못한 메모리는 반입 스탯이 높아도 추천에서 제외했습니다.');
      continue;
    }
    let score = 0, known = false, unscored = 0;
    const reasons = [], uniqueKeys = [];
    if (skill) {
      const plvValue = value(options.producerLevel ?? inventory.producerLevel);
      const plv = plvValue !== null && plvValue >= 1 ? plvValue : null;
      if (plv === null) warnings.add('프로듀서 레벨이 없어 메모리 스킬의 PLv 해금 여부를 확인하지 못했습니다. 스킬을 자동 해금으로 판정하지 않았습니다.');
    }
    if (skill) known = true;
    if (skill && selectionMode !== 'stats') {
      score += 1 + upgrade * 0.5;
      const skillText = `${skill.actions ?? ''};${skill.effects ?? ''}`;
      if (/drawCard/.test(skillText)) { score += weights.draw; reasons.push('드로 보조'); }
      if (/cardUsesRemaining|actionCount|additionalTurn|extraTurn/.test(skillText)) { score += weights.action; reasons.push('추가 행동 관련 효과'); }
      const styleKeywords = { concentration: ['concentration', 'focus'], goodCondition: ['goodConditionTurns'], goodConditionTurns: ['goodConditionTurns'], good_condition: ['goodConditionTurns'], motivation: ['motivation'], goodImpression: ['goodImpression'], goodImpressionTurns: ['goodImpression'], good_impression: ['goodImpression'], fullPower: ['fullPowerCharge'], full_power: ['fullPowerCharge'], strength: ['enthusiasm', 'aggressive'], preservation: ['preservation', 'isPreservation'] };
      if ((styleKeywords[options.trainingType] ?? []).some(keyword => skillText.includes(keyword))) { score += weights.training; reasons.push('선택한 육성 타입의 자원·효과 보조'); }
      if ((options.desiredSkillIds ?? []).includes(skill.gameId)) { score += 100; reasons.push('사용자가 지정한 목표 스킬'); }
      reasons.push(modelEffects.carriedSkill?.planCompatible === true ? `플랜에 맞는 스킬: ${skill.name}` : '반입 스킬의 플랜 조건 미확정');
      if (modelEffects.carriedSkill?.obtainable == null) reasons.push('반입 스킬 사용 조건 미확정: PLv·스킬 전환 조건을 확인해야 합니다.');
    } else if (!skill && sid) unscored++;
    if (!modelEffects.carriedSkill) reasons.push('반입 스킬 정보 미확인: 확인된 스탯 효과만 비교한 후보입니다.');
    {
      const initial = longAxes(modelEffects.initialStats), growthRate = longAxes(modelEffects.growthRatePermil);
      const roleScore = score;
      const bonusRows = route.parameterBonusRows ?? [route.gains];
      const stats = Object.fromEntries(axes.map(axis => [axis, initial[axis] + bonusRows.reduce((sum, row) => sum + Math.floor(row[axis] * growthRate[axis] / 1000), 0)]));
      const numericScore = axes.reduce((sum, axis) => sum + stats[axis] * (selectionMode === 'stats' ? 1 : axisWeights[axis]), 0);
      uniqueKeys.push(...(modelEffects.uniqueKeys ?? []));
      const unresolvedEffects = [...(modelEffects.conditionalEffects ?? []), ...(modelEffects.hifEffects ?? [])]
        .filter(effect => effect.applies !== false && !effect.includedInInitialTotals);
      unscored += new Set(unresolvedEffects.map(effect => [effect.produceSkillId, effect.effectId, effect.trigger?.id].join(':'))).size + (modelEffects.issues?.length ?? 0);
      known ||= (modelEffects.conditionalEffects?.length ?? 0) > 0 || (modelEffects.hifEffects?.length ?? 0) > 0;
      if (!known) { warnings.add('카탈로그로 확인할 수 없는 메모리 스킬·어빌리티는 점수를 추측하지 않았습니다.'); continue; }
      const memoryTargets = [];
      if (modelEffects.carriedSkill?.obtainable === true && (options.desiredSkillIds ?? []).map(String).includes(String(modelEffects.carriedSkill.id))) memoryTargets.push('skill:' + modelEffects.carriedSkill.id);
      for (const id of options.requiredHifEffectIds ?? []) if (modelEffects.hifEffects?.some(effect => effect.effectId === id && effect.applies === true)) memoryTargets.push('hif:' + id);
      const applicableIds = new Set((modelEffects.conditionalEffects ?? []).filter(effect => effect.applies !== false).map(effect => effect.abilityId));
      const applicableAbilities = (Array.isArray(abilityRefs) ? abilityRefs : []).filter(ref => applicableIds.has(typeof ref === 'string' ? ref : ref.id ?? ref.gameId ?? ref.memoryAbilityId));
      rows.push({ id: memory.id ?? memory.memoryId ?? memory.userMemoryId, gameId: memory.id ?? memory.memoryId ?? memory.userMemoryId,
        name: skill?.name ?? '반입 효과 메모리', nameJa: skill?.nameJa, nameKo: skill?.nameKo,
        skillCard: skill ?? null, abilities: applicableAbilities,
        score: round(roleScore + numericScore), roleScore, statContribution: stats, modelEffects, memoryTargets,
        reasons: [...reasons, '반입 초기 스탯·성장률만 수치화; 완성 메모리 Vo/Da/Vi는 합산하지 않음',
          ...(unscored ? ['조건부·시험 어빌리티는 발동 구조를 표시하고 이 스탯 비교에는 미합산'] : [])],
        unscoredEffects: unscored, uniqueKeys, raw: original.raw ?? original });
      continue;
    }
  }
  for (const row of rows) {
    row.battleRoleProfile = memoryBattleRoles(row, policy);
    row.characterRecipeMatches = characterRules.filter(rule => rule.gameId === carriedId(row) &&
      (rule.action !== 'prefer' || row.modelEffects.carriedSkill?.obtainable === true));
    const matches = (guideProfile?.carryRoles ?? []).map(role => evaluateHifGuideRole(role, row)).filter(Boolean);
    row.guideRoles = matches.filter(match => match.status === 'fulfilled').map(match => match.gameId);
    row.guideTentativeRoles = matches.filter(match => match.status === 'unknown').map(match => match.gameId);
    row.guideEvidenceByRole = Object.fromEntries(matches.filter(match => match.status !== 'missing')
      .map(match => [match.gameId, match.checks.filter(check => check.passed === true).length]));
    row.guideEvidenceCount = Object.values(row.guideEvidenceByRole).reduce((sum, count) => sum + count, 0);
  }
  const finalize = selected => {
    const copySelection=scenario==='hif'&&selectionMode==='guide'?selectHifAbilityCopies({selected,candidates:rows,catalog,inventory,
      options:{...options,plan,scenario},selectedIdol:options.hifSelectedIdol}):{memories:selected,changes:[]};
    selected=copySelection.memories;
    selected.eligibleCount = rows.length;
    selected.hifAbilityCopyChanges=copySelection.changes;
    selected.fulfilledHifEffectIds=fulfilledHifEffectIds(selected,buildHifAbilityTargetContext({memories:selected,
      selectedIdol:options.hifSelectedIdol,catalog,inventory,options:{...options,plan,scenario}}));
    selected.guideProfile = summarizeHifGuideProfile(guideProfile, selected, catalog,
      { prioritized: guidePrioritized, manual, candidates: rows,
        characterPolicyUsed: Boolean(guidePrioritized && guideProfile?.characterPolicy?.usedForSelection || characterRules.length) });
    if (concentration?.active && selected.guideProfile)
      selected.guideProfile.concentrationDecision = concentration.explain(selected, rows);
    if (selected.guideProfile) selected.guideProfile.characterSelection = { selectionMode, numericSkillWeightAdded: false,
      method: 'source_qualitative_lexicographic', appliesOnlyToGuideMode: true,
      selectedMatches: selected.flatMap(memory => memory.characterRecipeMatches.map(rule => ({ ...rule, memoryId: memory.id }))) };
    const opening = selected.filter(row => row.battleRoleProfile.availableAtStart);
    const openingRoles = new Set(opening.flatMap(row => row.battleRoleProfile.roles));
    selected.openingPreparation = { status: 'qualitative_roles_only', readinessConfirmed: false, selectionMode,
      duplicatePolicy: 'distinct_exact_carried_skill_ids', duplicateExceptions: [...duplicateExceptions],
      openingMemoryIds: opening.map(row => row.id), openingSkillIds: opening.map(carriedId),
      openingAttackMemoryIds: opening.filter(row => row.battleRoleProfile.roles.includes('attack')).map(row => row.id),
      missingRoles: ['attack','draw','extra_action'].filter(role => !openingRoles.has(role)),
      unknownMemoryIds: selected.filter(row => !row.battleRoleProfile.verified || row.modelEffects.carriedSkill?.phase?.availableAtStart == null).map(row => row.id),
      note: '개시 획득·반입 조건과 원본 효과의 역할만 확인. 실제 손패·체력·자원 조건이나 첫 시험 통과를 검증한 결과는 아닙니다.' };
    return selected;
  };
  rows.sort((a, b) => b.score - a.score || (selectionMode === 'stats'
    ? String(a.id).localeCompare(String(b.id), 'en') : semanticKey(a).localeCompare(semanticKey(b))));
  const legal = (chosen, row) => canAddMemoryCopy(chosen, row, scenario, duplicateExceptions);
  // If ranking leaves an empty slot, prove the largest feasible size against
  // all eligible rows. The normal fast path never runs this backtracking pass.
  const fillSlots = selected => {
    if (selected.length === 4) return selected;
    function find(start, needed, chosen) {
      if (!needed) return chosen;
      const indices = [], skills = new Set();
      let repeatable = 0;
      for (let i = start; i < rows.length; i++) {
        const row = rows[i];
        if (!legal(chosen, row)) continue;
        indices.push(i);
        const skill = carriedId(row);
        if (!skill || duplicateExceptions.has(String(skill))) repeatable++;
        else skills.add(skill);
      }
      if (skills.size + repeatable < needed) return null;
      for (let j = 0; j <= indices.length - needed; j++) {
        const i = indices[j];
        const found = find(i + 1, needed - 1, [...chosen, rows[i]]);
        if (found) return found;
      }
      return null;
    }
    for (let size = Math.min(4, rows.length); size > selected.length; size--) {
      const found = find(0, size, []);
      if (found) return found;
    }
    return selected;
  };
  if (selectionMode === 'stats') {
    const selected = selectStatMemories(rows,route,{...options,scenario},legal,fillSlots);
    Object.assign(selected.statSelection,{missingSkillIdentityMemoryIds,unverifiedSkillEligibilityMemoryIds});
    return finalize(selected);
  }
  const requestedTargets = [...new Set([...(options.desiredSkillIds ?? []).map(id => 'skill:' + id), ...(options.requiredHifEffectIds ?? []).map(id => 'hif:' + id)])];
  if (scenario === 'hif') {
    // Collapse interchangeable instances only. Allowed repeated skills and
    // stat-only copies can occupy four slots, so keep up to four physical IDs.
    const copies = new Map();
    const sharedIds = new Set(), seenIds = new Set();
    for (const row of rows) {
      if (seenIds.has(row.id)) sharedIds.add(row.id);
      seenIds.add(row.id);
    }
    const variants = rows.filter(row => {
      if (sharedIds.has(row.id)) return true;
      const key = semanticKey(row), n = copies.get(key) ?? 0;
      copies.set(key, n + 1);
      return n < (!carriedId(row) || duplicateExceptions.has(String(carriedId(row))) ? 4 : 1);
    });
    const exact = variants.length <= 24;
    const poolSet = new Set(exact ? variants : variants.slice(0, 12));
    // A saturated axis and flooring of *combined* growth rates can reverse
    // the per-card ranking. Seed each remaining axis combination with its
    // best unrounded contributions when a four-card set could hit a cap.
    if (!exact) {
      const gains = axes.map(axis => (route.parameterBonusRows ?? [route.gains]).reduce((sum, row) => sum + row[axis], 0));
      const vectors = variants.map(row => {
        const fixed = longAxes(row.modelEffects.initialStats), rates = longAxes(row.modelEffects.growthRatePermil);
        return { row, values: axes.map((axis, i) => fixed[axis] + rates[axis] * gains[i] / 1000) };
      });
      const canCap = axes.some((axis, i) => vectors.map(v => v.values[i]).sort((a, b) => b - a).slice(0, 4)
        .reduce((sum, n) => sum + n, options.memoryStatBaseline?.[axis] ?? 0) > (options.memoryStatCaps?.[axis] ?? Infinity));
      if (canCap) {
        for (let mask = 1; mask < 8; mask++) {
          const weighted = vectors.map(({ row, values }) => ({ row,
            score: values.reduce((sum, n, i) => sum + ((mask & (1 << i)) ? n : 0), 0) }));
          for (const { row } of weighted.sort((a, b) => b.score - a.score).slice(0, 8)) poolSet.add(row);
        }
      }
    }
    const seed = predicate => {
      const skills = new Set();
      for (const row of variants.filter(predicate)) {
        const id = carriedId(row) ?? row.id;
        if (skills.has(id)) continue;
        skills.add(id); poolSet.add(row);
        if (skills.size >= 4) break;
      }
    };
    seed(() => true);
    if (concentration?.active) {
      seed(row => concentration.inspectCandidate(row).candidatePriority === 2);
      seed(row => concentration.inspectCandidate(row).candidatePriority === 1);
    }
    for (const role of ['attack','draw','extra_action','strengthen']) {
      seed(row => row.battleRoleProfile.availableAtStart && row.battleRoleProfile.roles.includes(role));
      seed(row => row.battleRoleProfile.verified && row.battleRoleProfile.roles.includes(role));
    }
    seed(row => row.battleRoleProfile.availableAtStart && row.battleRoleProfile.policyCandidate);
    seed(row => row.battleRoleProfile.policyCandidate);
    for (const id of new Set(characterRules.filter(rule => rule.action === 'prefer').map(rule => rule.gameId))) {
      for (const row of variants.filter(row => carriedId(row) === id && row.characterRecipeMatches.some(rule => rule.action === 'prefer')).slice(0, 12)) poolSet.add(row);
    }
    if (characterRules.some(rule => ['avoid', 'deprioritize'].includes(rule.action))) {
      seed(row => row.battleRoleProfile.verified && !row.characterRecipeMatches.some(rule => ['avoid', 'deprioritize'].includes(rule.action)));
    }
    for (const target of requestedTargets) for (const row of variants.filter(row => row.memoryTargets.includes(target)).slice(0, 12)) poolSet.add(row);
    if (guidePrioritized) for (const role of guideProfile.carryRoles) for (const row of variants
      .filter(row => row.guideRoles.includes(role.gameId) || row.guideTentativeRoles.includes(role.gameId))
      .sort((a, b) => Number(b.guideRoles.includes(role.gameId)) - Number(a.guideRoles.includes(role.gameId)) || b.guideEvidenceCount - a.guideEvidenceCount || b.score - a.score || semanticKey(a).localeCompare(semanticKey(b))).slice(0, 12)) poolSet.add(row);
    const pool = [...poolSet].sort((a, b) => semanticKey(a).localeCompare(semanticKey(b)));
    const evaluate = memories => {
      const present = new Set(memories.flatMap(memory => memory.memoryTargets));
      const covered = new Set([...present].filter(target=>!target.startsWith('hif:')));
      if(options.requiredHifEffectIds?.length){
        const context=buildHifAbilityTargetContext({memories,selectedIdol:options.hifSelectedIdol,catalog,inventory,options:{...options,plan,scenario}});
        for(const effectId of fulfilledHifEffectIds(memories,context))if(options.requiredHifEffectIds.includes(effectId))covered.add('hif:'+effectId);
      }
      const fixed = sumMemoryFixedEffects(memories);
      const stats = Object.fromEntries(axes.map(axis => [axis, fixed.initial[axis] + (route.parameterBonusRows ?? [route.gains])
        .reduce((sum, row) => sum + Math.floor(row[axis] * fixed.growth[axis] / 1000), 0)]));
      const numeric = axes.reduce((sum, axis) => {
        const base = options.memoryStatBaseline?.[axis] ?? 0, cap = options.memoryStatCaps?.[axis] ?? Infinity;
        return sum + Math.min(base + stats[axis], cap) - Math.min(base, cap);
      }, 0);
      const verified = new Set(memories.flatMap(memory => memory.guideRoles));
      const tentative = new Set(memories.flatMap(memory => memory.guideTentativeRoles).filter(id => !verified.has(id)));
      const unique = new Set(), skillIds = new Set();
      let repeated = 0, roleScore = 0;
      for (const memory of memories) {
        for (const key of memory.uniqueKeys) { if (unique.has(key)) repeated++; unique.add(key); }
        const skillId = carriedId(memory);
        if (skillId && skillIds.has(skillId)) repeated++;
        if (!skillId || !skillIds.has(skillId)) roleScore += memory.roleScore;
        if (skillId) skillIds.add(skillId);
      }
      const opening = memories.filter(memory => memory.battleRoleProfile.availableAtStart);
      const earlyRoles = new Set(opening.flatMap(memory => memory.battleRoleProfile.roles));
      const battleRoles = new Set(memories.filter(memory => memory.battleRoleProfile.verified).flatMap(memory => memory.battleRoleProfile.roles));
      const characterCount = action => new Set(memories.flatMap(memory => memory.characterRecipeMatches.filter(rule => rule.action === action).map(rule => rule.gameId))).size;
      return { covered: covered.size,requestedPresent:present.size, openingAttack: Number(earlyRoles.has('attack')),
        openingSupport: Number(earlyRoles.has('draw')) + Number(earlyRoles.has('extra_action')),
        openingCount: Math.min(2, opening.length), battleRoleCoverage: battleRoles.size,
        policyCovered: new Set(memories.filter(memory => memory.battleRoleProfile.policyCandidate).map(carriedId)).size,
        guideCovered: guidePrioritized ? verified.size : 0, tentativeCovered: guidePrioritized ? tentative.size : 0,
        concentrationCoverage: concentration?.active ? concentration.evaluate(memories).priority : 0,
        guideEvidence: guidePrioritized ? [...new Set([...verified, ...tentative])].reduce((sum, id) =>
          sum + Math.max(0, ...memories.map(memory => memory.guideEvidenceByRole[id] ?? 0)), 0) : 0, repeated,
        conflicts: (guidePrioritized ? hifGuideConflicts(guideProfile, memories).filter(conflict => conflict.status === 'conflict').length : 0) + characterCount('avoid'),
        characterPreferred: characterCount('prefer'), characterDeprioritized: characterCount('deprioritize'),
        score: selectionMode === 'opening' ? numeric + roleScore : numeric };
    };
    const compare = (a, b) => b.covered - a.covered || b.requestedPresent - a.requestedPresent || a.conflicts - b.conflicts ||
      (selectionMode === 'opening' ? b.openingAttack - a.openingAttack || b.openingSupport - a.openingSupport ||
        b.openingCount - a.openingCount || b.battleRoleCoverage - a.battleRoleCoverage || b.policyCovered - a.policyCovered : 0) ||
      b.guideCovered - a.guideCovered || b.concentrationCoverage - a.concentrationCoverage || b.tentativeCovered - a.tentativeCovered ||
      a.repeated - b.repeated || b.guideEvidence - a.guideEvidence || b.characterPreferred - a.characterPreferred ||
      a.characterDeprioritized - b.characterDeprioritized || b.score - a.score || a.semantic.localeCompare(b.semantic);
    const all = variants.slice().sort((a, b) => semanticKey(a).localeCompare(semanticKey(b)));
    const ordinal = new Map(all.map((row, i) => [row, String(i).padStart(6, '0')]));
    const rank = memories => ({ memories, ...evaluate(memories), semantic: memories.map(row => ordinal.get(row)).sort().join(',') });
    if (exact) {
      let best = null;
      function visit(start, chosen, size) {
        if (chosen.length === size) {
          const next = rank(chosen);
          if (!best || compare(next, best) < 0) best = next;
          return;
        }
        for (let i = start; i <= pool.length - (size - chosen.length); i++) {
          if (legal(chosen, pool[i])) visit(i + 1, [...chosen, pool[i]], size);
        }
      }
      for (let size = Math.min(4, pool.length); size && !best; size--) visit(0, [], size);
      return finalize(fillSlots(best?.memories ?? []));
    }
    let beam = [{ memories: [], indices: [] }];
    for (let depth = 0; depth < 4; depth++) {
      const nextByCombination = new Map();
      // A partial guide recipe must remain able to add every unused candidate.
      // Increasing UUID indices made a strong late-ranked guide anchor prune
      // all paths that could still add a numerically better earlier UUID.
      for (const state of beam) for (let index = 0; index < pool.length; index++) {
        const row = pool[index];
        if (!legal(state.memories, row)) continue;
        const memories = [...state.memories, row];
        const indices = [...state.indices, index].sort((a, b) => a - b);
        const identity = indices.join(',');
        if (nextByCombination.has(identity)) continue;
        // Pool indices already follow semantic order; the short key avoids
        // repeatedly joining long native effect/customization IDs in the beam.
        nextByCombination.set(identity, { ...rank(memories), indices });
      }
      const next = [...nextByCombination.values()];
      if (!next.length) break;
      next.sort(compare);
      beam = next.slice(0, 48);
    }
    let best = rank(fillSlots(beam[0]?.memories ?? []));
    // Reopen every slot to every distinct recipe, including variants omitted
    // from numeric, guide and target seeds. Compare complete legal selections.
    // A strict improvement in the common total ordering ensures termination.
    let previous;
    do {
      previous = best;
      for (let slot = 0; slot < previous.memories.length; slot++) {
        const rest = previous.memories.filter((_, i) => i !== slot);
        for (const row of all) {
          if (row === previous.memories[slot] || !legal(rest, row)) continue;
          const next = rank([...rest, row]);
          if (compare(next, best) < 0) best = next;
        }
      }
    } while (previous !== best);
    return finalize(best.memories);
  }
  const selected = [];
  for (const row of rows) {
    if (legal(selected, row)) selected.push(row);
    if (selected.length === 4) break;
  }
  return finalize(fillSlots(selected));
}

const supportIdentity = card => card.nameJa ?? card.name ?? card.gameId;
const supportAxis = card => [...axes, 'assist'].includes(card.attribute) ? card.attribute
  : effectAxis(card.levelAbilities?.flatMap(row => row.effects ?? []).find(effect => /GrowthRateAddition|Addition$/.test(effect.type ?? ''))?.type);
const longAxes = input => Object.fromEntries(axes.map(axis => [axis, value(input?.[axis] ?? input?.[axisShort[axis]]) ?? 0]));

function exactSupportGuide(catalog, selected, plan, options) {
  return catalog.guideSupportProfiles?.profiles?.find(profile =>
    (profile.idolGameId ?? profile.idolCardId) === selected?.gameId && profile.scenario === 'hif'
    && compatible(profile.plan, plan) && (!profile.trainingType || canonicalTrainingType(profile.trainingType) === canonicalTrainingType(options.trainingType))
    && (!profile.expectedUniqueIds || Object.entries(profile.expectedUniqueIds).every(([key,value])=>selected?.uniqueIds?.[key]===value))
    && ((profile.eventScope??'ordinary_hif') === 'any_hif' ||
      (profile.eventScope??'ordinary_hif') === 'ordinary_hif' && !options.eventModeId && (!options.hifMode || options.hifMode === 'normal') ||
      profile.eventScope === 'exact_event' && (profile.eventModeIds??[]).includes(options.eventModeId))) ?? null;
}

export function sumMemoryFixedEffects(memories) {
  const initial = zeroAxes(), growth = zeroAxes(), seen = new Set();
  for (const memory of memories) {
    const fixed = longAxes(memory.modelEffects?.initialStats), rate = longAxes(memory.modelEffects?.growthRatePermil);
    for (const entry of memory.modelEffects?.conditionalEffects ?? []) if (entry.includedInInitialTotals && entry.uniqueKey) {
      const axis = axes.find(axis => axisShort[axis] === entry.attribute);
      if (seen.has(entry.uniqueKey) && axis) (entry.kind === 'growth_rate' ? rate : fixed)[axis] -= entry.valueMin;
      seen.add(entry.uniqueKey);
    }
    for (const axis of axes) { initial[axis] += fixed[axis]; growth[axis] += rate[axis]; }
  }
  return { initial, growth };
}

function hifInitialStats(selected, options) {
  const stats = longAxes(selected?.baseStats?.baseVoDaVi);
  const rank = value(selected?.owned?.levelLimitRank ?? selected?.owned?.uncap ?? selected?.owned?.specialTrainingRank);
  if (rank !== null) for (const stage of selected?.specialTrainingStages ?? []) if (stage.rank <= rank) {
    const delta = longAxes(stage.voDaViDelta);
    for (const axis of axes) stats[axis] += delta[axis];
  }
  for (const axis of axes) if (value(options.initialStats?.[axis]) !== null) stats[axis] = Number(options.initialStats[axis]);
  return stats;
}

function recommendHif({ inventory, catalog, selected, plan, targetAxis, weights, options, warnings }) {
  const recipeContext = idolRecipeContext({ catalog, inventory, result: { selectedIdol: selected },
    options: { ...options, plan, scenario: 'hif' } });
  options = { ...options, supportPeakScenario: options.supportPeakScenario !== false, hifSelectedIdol:selected, memoryEffectCache: new WeakMap(),
    guideMemoryProfile: findHifMemoryProfile(catalog, { ...recipeContext, selectedIdol: selected }) };
  const supportGuide = exactSupportGuide(catalog, selected, plan, options);
  const requestedPool = options.sourceSupportMode ?? 'auto';
  if (!['auto', 'guide', 'unrestricted'].includes(requestedPool)) throw new RangeError('Unsupported sourceSupportMode');
  const guidePool = new Set([...(supportGuide?.idealSupports ?? []), ...(supportGuide?.alternativeSupports ?? [])].map(card => card.gameId));
  const supportIndex = new Map(catalog.supportCards.map(card => [card.gameId, card]));
  const rawOwned = (inventory.supportCards ?? []).map(row => ({ owned: record(row), card: supportIndex.get(gameId(row)) }));
  const newOwnedOutsideGuide = new Set();
  if (supportGuide && requestedPool === 'auto') for (const { owned, card } of rawOwned) {
    if (card?.numericalSource !== 'live_public_master' || guidePool.has(card.gameId) || !compatible(card.plan, plan) ||
      (options.allowAssist === false && card.attribute === 'assist')) continue;
    const level = value(owned.ownedLevel ?? owned.level), uncap = value(owned.uncap ?? owned.levelLimitRank);
    const cap = Number.isInteger(uncap) && uncap >= 0 && uncap <= 4 ? card.maxLevels?.[uncap] : null;
    if (Number.isInteger(level) && level >= 1 && Number.isInteger(cap) && level <= cap) newOwnedOutsideGuide.add(card.gameId);
  }
  const expansion = newOwnedOutsideGuide.size ? { reason: 'owned_live_support_outside_guide', gameIds: [...newOwnedOutsideGuide].sort(),
    message: `새로 연동한 보유 서포트 ${newOwnedOutsideGuide.size}장이 이 아이돌의 공략 목록 밖에 있어 전체 후보와 함께 계산했습니다.` } : null;
  const sourceSupportMode = requestedPool === 'auto' ? (supportGuide && !expansion ? 'guide' : 'unrestricted') : requestedPool;
  const restrictToGuide = sourceSupportMode === 'guide' && Boolean(supportGuide);
  const supportAllowed = card => !restrictToGuide || guidePool.has(card.gameId) || card.gameId === options.rentalGameId;
  const referenceCounts = Object.fromEntries([...axes, 'assist'].map(axis => [axis,
    (supportGuide?.idealSupports ?? []).filter(card => card.attribute === axis).length]));
  if (expansion) warnings.add(expansion.message);
  if (sourceSupportMode === 'guide' && !supportGuide) warnings.add('해당 고유·시나리오·육성 유형에 맞는 서포트 원문을 찾지 못해 출처 미확인 전체 풀 대안으로 비교합니다.');
  if (restrictToGuide) warnings.add('해당 아이돌 공략의 추천·대안 서포트를 보유 돌파와 선택한 계산 레벨로 비교했습니다.');
  if (restrictToGuide && options.rentalGameId && !guidePool.has(options.rentalGameId)) warnings.add('사용자가 지정한 렌탈은 원문 후보 풀 밖의 명시적 예외로 비교했습니다.');
  const template = options.deckTemplate ?? 'auto';
  if (!['auto', '3-3', '4-2'].includes(template)) throw new RangeError('Unsupported deckTemplate');
  const secondaryInput = normalizeAttribute(options.secondaryAttribute ?? 'free');
  const preparationTargets = preparationTargetsOf(options);
  const classInput = options.classAttribute;
  if (classInput !== undefined && classInput !== 'auto' && !axes.includes(classInput)) throw new RangeError('Unsupported classAttribute');
  const compareClassAxes = classInput === 'auto' || classInput === undefined && Boolean(preparationTargets);
  const requestedSecondary = axes.includes(secondaryInput) ? secondaryInput : null;
  if (targetAxis && requestedSecondary === targetAxis) throw new RangeError('secondaryAttribute must differ from targetAttribute');
  const axisWeights = { vocal: 1, dance: 1, visual: 1 };
  const growth = selected ? idolGrowthIndex(selected, selected.owned, axisWeights) : null;
  const knownGrowth = growth?.currentGrowthRatePermil ?? growth?.growthBreakdown?.knownTotal ?? {};
  const baseInitial = hifInitialStats(selected, options);
  const panels = inventory.hifBonuses?.status === 'current_account' ? inventory.hifBonuses : null;
  const defaultCap = value(catalog.calculationModels?.['score/paramCap']?.table?.hif?.[options.difficulty ?? 'none']);
  const statCaps = Object.fromEntries(axes.map(axis => [axis, value(options.statCaps?.[axis]) ?? value(panels?.final?.statCaps?.[axisShort[axis]]) ?? defaultCap]));
  const selectionBaseCap = value(catalog.hifGrowthPanels?.baseCaps?.selection?.value) ?? 3000; // Produce007 base cap; panel additions remain unverified without account capture.
  const selectionCaps = Object.fromEntries(axes.map(axis => [axis, value(options.selectionStatCaps?.[axis]) ?? value(panels?.selection?.statCaps?.[axisShort[axis]]) ?? selectionBaseCap]));
  if (axes.some(axis => statCaps[axis] !== null && statCaps[axis] < 0)) throw new RangeError('statCaps must be nonnegative');
  const capVerified = Boolean(panels) || axes.every(axis => value(options.statCaps?.[axis]) !== null && value(options.selectionStatCaps?.[axis]) !== null);
  if (!capVerified) warnings.add('HIF 패널을 포함한 실제 속성별 상한이 없어 공개 계산기 기본 상한으로 조건부 비교했습니다. 미확인을 보너스 0으로 확정하지 않았습니다.');
  if (selected && growth.growthStatus !== 'current_card') warnings.add('선택 P아이돌의 현재 성장률을 완전히 확인하지 못해 확인된 부분합으로만 임시 비교했습니다.');
  if (rawOwned.some(row => !row.card)) warnings.add('알 수 없는 보유 서포트 ID가 있어 해당 카드를 수동 확인 대상으로 남겼습니다.');
  let best = null, bestPrepared = null, bestAuthorReference = null, modelsEvaluated = 0, feasibleModelsEvaluated = 0;
  let beamBest = null, beamPrepared = null, witnessFinalist = null;
  const beamByPrimary = new Map(), beamPreparedByPrimary = new Map();
  let screenedLargePool = false, finalistsReplayed = 0;
  const bestByPrimary = new Map();
  const preparedByPrimary = new Map(), bestByClass = new Map(), preparedByClass = new Map();
  const rentalAlternatives = new Map();
  const sourceSupportMissing = row => row?.evaluation?.sourceSupportRequirementMissingCount ?? 0;
  const uncoveredSp = entry => entry.evaluation.spRequired - entry.evaluation.spCovered;
  const better = (a, b) => b.length - a.length || sourceSupportMissing(a) - sourceSupportMissing(b) || b.evaluation.budgetConstraintsMet - a.evaluation.budgetConstraintsMet
    || (!a.evaluation.supportPeakScenario && uncoveredSp(a) - uncoveredSp(b)) || b.evaluation.partialEvaluationPoints - a.evaluation.partialEvaluationPoints
    || uncoveredSp(a) - uncoveredSp(b) || b.evaluation.progressIndex - a.evaluation.progressIndex || a.key.localeCompare(b.key);
  const missingMemoryRequirements = row => options.memorySelectionMode === 'stats' ? 0 : row.memoryRequirements.missing.length;
  const compareMemories = (a, b) => options.memorySelectionMode === 'stats' ? 0 : a.memoryRequirements.missing.length - b.memoryRequirements.missing.length ||
    (a.guideMemoryProfile?.considered && b.guideMemoryProfile?.considered ?
      a.guideMemoryProfile.conflicts.filter(conflict => conflict.status === 'conflict').length - b.guideMemoryProfile.conflicts.filter(conflict => conflict.status === 'conflict').length ||
      b.guideMemoryProfile.fulfilledCount - a.guideMemoryProfile.fulfilledCount ||
      (b.guideMemoryProfile.concentrationDecision?.priority ?? 0) - (a.guideMemoryProfile.concentrationDecision?.priority ?? 0) ||
      b.guideMemoryProfile.selectedTentativeCount - a.guideMemoryProfile.selectedTentativeCount : 0);
  const compareResults = (a, b) => (options.rentalGameId ? Number(b.rental?.gameId === options.rentalGameId) - Number(a.rental?.gameId === options.rentalGameId) : 0)
    || b.length - a.length || (a.length < 6 ? b.owned.length - a.owned.length : 0) || compareMemories(a, b) || better(a, b);
  // Deficits order only an additional search lane. They never become a stat or
  // exam score, and the original beam remains independent for exact fallback.
  const preparationBetter = (a, b) => a.evaluation.preparation.missingAxes.length - b.evaluation.preparation.missingAxes.length
    || (a.evaluation.preparation.totalShortfall ?? Infinity) - (b.evaluation.preparation.totalShortfall ?? Infinity) || better(a, b);
  const requiredPP = value(options.requiredSupportPP), requiredStamina = value(options.requiredSupportStamina);
  function rankDeck(cards,result,context,ratingContext,groups,usedAxes) {
    const spCovered = usedAxes.filter(axis => result.progress.spBonusPermil[axis] > 0 || (context.baseSpRatePermil[axis] ?? 0) >= 1000).length;
    const ppMet = requiredPP === null || result.progress.pp >= requiredPP;
    const staminaMet = requiredStamina === null || result.progress.stamina >= requiredStamina;
    const progressIndex = usedAxes.reduce((sum, axis) => sum + result.progress.spRatePermil[axis] / 10 * weights.sp, 0)
      + result.progress.pp * weights.pp + result.progress.stamina * weights.stamina;
    const supportGroups = groups.length ? groups.map(group => {
      const matches = cards.filter(card => group.eligibleGameIds.includes(card.gameId));
      const satisfied = group.minimumLevelKnown && matches.some(card => group.minimumLevel === null || card.level >= group.minimumLevel);
      return { ...group, satisfied, status: satisfied ? 'selected_composition_matches' : !group.minimumLevelKnown ? 'minimum_level_unconfirmed' : 'missing',
        selected: matches.map(card => ({ gameId: card.gameId, level: card.level, uncap: card.uncap, rental: card.rental === true })),
        actualItemAcquisitionConfirmed: null, battleEffectCalculated: false };
    }) : groups;
    return { score:result.score,cappedStats:result.cappedStats,spCovered,spRequired:usedAxes.length,
      budgetConstraintsMet:Number(ppMet)+Number(staminaMet),progressIndex,
      partialEvaluationPoints:partialSupportRating(result.score,result.providedActions?.skill_acquire??0,ratingContext),
      supportPeakScenario:Boolean(context.route.supportPeakScenario),sourceSupportRequirementGroups:supportGroups,
      sourceSupportRequirementMissingCount:supportGroups.filter(group=>!group.satisfied).length,
      ...(preparationTargets?{preparation:preparationAssessment(result.cappedStats,preparationTargets)}:{}) };
  }
  const n = Object.keys(catalog.calculationModels?.['score/lesson']?.table?.hif?.[options.difficulty ?? 'none'] ?? {}).length;
  const layout=options[fixedActionLayout];
  const primaryCounts = layout ? [layout.primaryLessonCount] : n ? Array.from({ length: n - Math.ceil(n / 2) + 1 }, (_, i) => Math.ceil(n / 2) + i) : [0];
  const primaries = layout ? [layout.primary] : targetAxis ? [targetAxis] : axes;
  for (const primary of primaries) for (const secondary of layout ? [layout.secondary] : requestedSecondary ? [requestedSecondary] : axes.filter(axis => axis !== primary)) {
    if (primary === secondary) continue;
    const originalClassAxis = axes.find(axis => axis !== primary && axis !== secondary);
    for (const classAttribute of layout ? [layout.classAttribute] : compareClassAxes ? axes : [classInput ?? originalClassAxis])
    for (const count of primaryCounts) for (const pattern of layout ? [layout.lessonPattern] : count === n ? ['even'] : ['even', 'early']) {
      const baselineClass = Boolean(layout) || classInput !== undefined || !preparationTargets || classAttribute === originalClassAxis;
      const routeOptions = { ...options, classAttribute, secondaryAttribute: secondary, primaryLessonCount: count, lessonPattern: pattern,
        supportPeakFunding:null,
        supportPeakPlan: plan, producerLevel: options.producerLevel ?? inventory.producerLevel,
        supportPeakInitialStats: baseInitial, supportPeakSelectionCaps: selectionCaps, supportPeakFinalCaps: statCaps,
        supportPeakInitialPPGrants: { selection: panels?.selection?.initialPP, final: panels?.finalOnly?.initialPP } };
      let route = routeAssumption(catalog, 'hif', primary, routeOptions);
      const baseline = evaluateHifDeck([], { route, initialStats: baseInitial, outsideGrowthRatePermil: longAxes(knownGrowth), statCaps });
      let memoryStatStages;
      if (options.memorySelectionMode === 'stats' && route.stages) {
        const initial = longAxes(panels?.selection?.initialStats), outside = longAxes(knownGrowth);
        const stageContexts = Object.fromEntries(['selection','final'].map(stage => {
          const panelGrowth = longAxes(panels?.[stage]?.growthRatePermil);
          return [stage,{statCaps:stage === 'selection' ? selectionCaps : statCaps,
            outsideGrowthRatePermil:Object.fromEntries(axes.map(axis=>[axis,outside[axis]+panelGrowth[axis]])),
            additionalInitialStats:stage==='final' ? longAxes(panels?.finalOnly?.initialStats) : zeroAxes()}];
        }));
        const stageBase = evaluateHifDeck([], {route, initialStats:Object.fromEntries(axes.map(axis=>[axis,baseInitial[axis]+initial[axis]])),
          outsideGrowthRatePermil:outside,statCaps,stageContexts});
        memoryStatStages = stageBase.stageResults.map(stage => ({
          rows:route.stages[stage.stage].parameterBonusRows, outside:stage.totalGrowthRatePermil,
          caps:stage.statCaps, baseline:stage.cappedStats }));
      }
      const memories = selectMemories(inventory, catalog, plan, 'hif', route, axisWeights, weights,
        { ...options, memoryStatBaseline: baseline.cappedStats, memoryStatCaps: statCaps, memoryOutsideGrowth:longAxes(knownGrowth),memoryStatStages }, warnings);
      // These are source composition requirements, not an estimate of the
      // support's battle effect or proof that its P-item has been acquired.
      const sourceSupportRequirementGroups = (options.memorySelectionMode ?? 'guide') === 'guide'
        && memories.guideProfile?.characterPolicy?.usedForSelection === true
        ? (memories.guideProfile.characterPolicy.sourceRecipes ?? []).flatMap(source => (source.requiredSupports ?? []).map((required, index) => {
          const anyOfGameIds = [...new Set((required.anyOfGameIds ?? []).filter(id => typeof id === 'string'))];
          const minimumLevel = value(required.minimumLevel);
          return { id: `${source.id ?? 'source'}:support:${index}`, sourceRecipeId: source.id ?? null, sourceIds: source.sourceIds ?? [], anyOfGameIds,
            eligibleGameIds: anyOfGameIds.filter(id => !supportGuide || guidePool.has(id)),
            outsideSourcePoolIds: anyOfGameIds.filter(id => supportGuide && !guidePool.has(id)),
            minimumLevel, minimumLevelKnown: required.minimumLevel == null || minimumLevel !== null && minimumLevel >= 1,
            observedLevel: value(required.observedLevel), observedLevelIsMinimum: false };
        })) : [];
      const sourceSupportSeedIds = new Set(sourceSupportRequirementGroups.flatMap(group => group.eligibleGameIds));
      const requestedMemoryTargets = [...new Set([...(options.desiredSkillIds ?? []).map(id => 'skill:' + id), ...(options.requiredHifEffectIds ?? []).map(id => 'hif:' + id)])];
      const fulfilledMemoryTargets = [...new Set([...memories.flatMap(memory => (memory.memoryTargets ?? []).filter(target=>!target.startsWith('hif:'))),
        ...(memories.fulfilledHifEffectIds??[]).filter(id=>(options.requiredHifEffectIds??[]).includes(id)).map(id=>'hif:'+id)])];
      const containedMemoryTargets=[...new Set(memories.flatMap(memory=>memory.memoryTargets??[]))];
      const memoryRequirements = { requested: requestedMemoryTargets, fulfilled: fulfilledMemoryTargets,
        contained:containedMemoryTargets,pendingTriggerTargets:containedMemoryTargets.filter(target=>!fulfilledMemoryTargets.includes(target)),
        missing: requestedMemoryTargets.filter(target => !fulfilledMemoryTargets.includes(target)),
        method: options.memorySelectionMode === 'stats' ? 'stat_comparison_targets_reported_only' : requestedMemoryTargets.length ? 'requirements_first_bounded_search' : memories.guideProfile?.applied ?
          'verified_guide_roles_first_bounded_search' : memories.guideProfile?.considered ? 'tentative_guide_roles_first_bounded_search' : 'numeric_carry_stats_only_no_guide_loadout_confirmed',
        uniqueEffectsActivateOnce: true,hifFulfillmentBasis:'target_card_present_in_known_loadout_not_actual_activation' };
      const fixedMemories = sumMemoryFixedEffects(memories), memoryInitial = fixedMemories.initial, memoryGrowth = fixedMemories.growth;
      const panelInitial = longAxes(panels?.selection?.initialStats), finalInitial = longAxes(panels?.finalOnly?.initialStats);
      const selectionGrowth = longAxes(panels?.selection?.growthRatePermil), finalGrowth = longAxes(panels?.final?.growthRatePermil);
      const outsideGrowth = Object.fromEntries(axes.map(axis => [axis, (knownGrowth[axisShort[axis]] ?? 0) + memoryGrowth[axis]]));
      const context = { route, initialStats: Object.fromEntries(axes.map(axis => [axis, baseInitial[axis] + memoryInitial[axis] + panelInitial[axis]])),
        outsideGrowthRatePermil: outsideGrowth,
        statCaps, axisWeights, baseSpRatePermil: options.baseSpRatePermil ?? Object.fromEntries(axes.map(axis => [axis, panels?.selection?.spRatePermil ?? 0])),
        stageContexts: {
          selection: { statCaps: selectionCaps, outsideGrowthRatePermil: Object.fromEntries(axes.map(axis => [axis, outsideGrowth[axis] + selectionGrowth[axis]])) },
          final: { statCaps, outsideGrowthRatePermil: Object.fromEntries(axes.map(axis => [axis, outsideGrowth[axis] + finalGrowth[axis]])), additionalInitialStats: finalInitial },
        } };
      route = applyPeakExamDeckCounts(route, memories, { ...routeOptions, catalog, supportPeakStatContext: context });
      context.route = route;
      const peak = Boolean(route.supportPeakScenario);
      const ratingContext = peak ? buildSupportRatingContext(catalog, route, options) : null;
      const blockedSkillNames = memories.filter(memory => {
        if (!memory.skillCard?.noDeckDuplication) return false;
        if (!peak) return true;
        const carried = memory.modelEffects?.carriedSkill;
        return carried?.obtainable === true && (carried.phase?.code === 1 || carried.phase?.code === 2 && route.supportPeakScenario.exams.length > 0);
      }).map(memory => memory.skillCard.nameJa ?? memory.skillCard.name);
      const supportOptions = { ...routeOptions, supportPeakScenario: peak, produceActions:route.produceActions??options.produceActions, catalog, blockedSkillNames };
      const ownedById = new Map();
      for (const { card, owned } of rawOwned) {
        if (!card || !compatible(card.plan, plan) || !supportAllowed(card)) continue;
        const row = scoreSupport(card, owned, route, plan, 'hif', axisWeights, weights, false, supportOptions);
        if (!row) { warnings.add('레벨·돌파가 없거나 범위를 벗어난 서포트는 최대 레벨로 추정하지 않았습니다.'); continue; }
        if (!ownedById.has(row.gameId) || ownedById.get(row.gameId).score < row.score) ownedById.set(row.gameId, row);
      }
      const rentals = catalog.supportCards.filter(card => compatible(card.plan, plan) && supportAllowed(card)).map(card => {
        const level = card.maxLevels?.[4], owned = ownedById.get(card.gameId);
        return scoreSupport(card,{level,uncap:4},route,plan,'hif',axisWeights,weights,true,supportOptions,
          owned && owned.level === level && supportIndex.get(card.gameId) === card ? owned : null);
      }).filter(Boolean);
      const requestedRental = rentals.find(card => card.gameId === options.rentalGameId);
      const searchRentals = requestedRental ? [requestedRental] : rentals;
      // Most layouts visit the same partial decks on this route. Cache by the
      // scored card instance (owned and rental levels are distinct).
      const evaluationCache = new Map(), screeningCache = new Map();
      const searchContext = { ...context, searchOnly: true };
      const allOwned = [...ownedById.values()];
      // An unrestricted all-axis search visits every lesson split and support
      // layout. Use singleton-calibrated action groups to shortlist there,
      // then score retained six-card decks against the actual dated targets.
      const screen = peak && route.supportPeakScenario.cardTargetPlan && !layout && !restrictToGuide
        && !targetAxis && !requestedSecondary && template === 'auto' && allOwned.length >= 40;
      if (screen) screenedLargePool = true;
      const screeningContext = screen ? { ...searchContext, route: { ...route,
        supportPeakScenario: { ...route.supportPeakScenario, cardTargetPlan: null } } } : searchContext;
      const effectGroups = groupSupportEffects([...allOwned, ...searchRentals], route.supportPeakScenario);
      const rowIndex = new Map([...allOwned, ...rentals].map((row, index) => [row, index]));
      const usedAxes = axes.filter(axis => route.perAxis[axis].lesson_end > 0);
      const fundingInputs = {routeOptions,supportOptions,usedAxes,groups:sourceSupportRequirementGroups,context,ratingContext,ownedById,rentals};
      const evaluate = (cards, shortlistOnly = false) => {
        const grouped = screen && shortlistOnly && cards.length > 1;
        const cache = grouped ? screeningCache : evaluationCache;
        const cacheKey = cards.map(card => rowIndex.get(card)).sort((a, b) => a - b).join(',');
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        if (screen && !grouped && cards.length === 6) finalistsReplayed++;
        const result = evaluateHifDeck(cards, grouped ? screeningContext : searchContext);
        // Full per-stage traces and link details are rebuilt for the winner.
        // Keeping one copy per partial deck makes wide route comparisons slow.
        const evaluated = rankDeck(cards,result,context,ratingContext,sourceSupportRequirementGroups,usedAxes);
        cache.set(cacheKey, evaluated);
        return evaluated;
      };
      const singles = new Map();
      const singleEvaluation = row => {
        if (!singles.has(row)) singles.set(row, evaluate([row]));
        return singles.get(row);
      };
      const empty = evaluate([]);
      const soloPoints = row => singleEvaluation(row).partialEvaluationPoints - empty.partialEvaluationPoints;
      const layouts = (template === 'auto' ? [3, 4] : [Number(template[0])]).map(primarySlots => ({ primarySlots, assistSlots: 0 }));
      if (template === 'auto' && options.allowAssist !== false) layouts.push({ primarySlots: 3, assistSlots: 1 }, { primarySlots: 4, assistSlots: 1 });
      const pinnedOffAxis = requestedRental && supportAxis(requestedRental) === originalClassAxis;
      if (template === 'auto' && !restrictToGuide && (pinnedOffAxis || peak && !requestedSecondary
        && [...allOwned, ...rentals].some(card => supportAxis(card) === originalClassAxis))) {
        for (const primarySlots of [3, 4]) layouts.push({ name: `${primarySlots}-${5 - primarySlots}-1`,
          quotas: { [primary]: primarySlots, [secondary]: 5 - primarySlots, [originalClassAxis]: 1 } });
      }
      if (options.allowSingleAttribute === true && template === 'auto') layouts.push({ primarySlots: 6, assistSlots: 0 });
      if (restrictToGuide && template === 'auto') {
        if ((supportGuide.idealSupports ?? []).length === 6 && (options.allowAssist !== false || !referenceCounts.assist))
          layouts.push({ name: 'source_reference6', quotas: referenceCounts });
        layouts.push({ name: 'source_mixed6', mixed: true, quotas: { vocal: 6, dance: 6, visual: 6, assist: options.allowAssist === false ? 0 : 6 } });
      }
      for (const { primarySlots, assistSlots, name, mixed, quotas: sourceQuotas } of layouts) {
        const quotas = sourceQuotas ?? { [primary]: primarySlots, [secondary]: 6 - primarySlots - assistSlots, assist: assistSlots };
        const rentalAxis = requestedRental && supportAxis(requestedRental);
        const ownedQuotas = rentalAxis && quotas[rentalAxis] ? { ...quotas, [rentalAxis]: quotas[rentalAxis] - 1 } : quotas;
        const candidatePool = allOwned.filter(row => (quotas[supportAxis(row)] ?? 0) > 0
          && (!requestedRental || row.gameId !== requestedRental.gameId && supportIdentity(row) !== supportIdentity(requestedRental)));
        const allowedLinks = new Set([...candidatePool, ...searchRentals.filter(row => (quotas[supportAxis(row)] ?? 0) > 0)]);
        const fits = cards => {
          if (requestedRental && !cards.includes(requestedRental)) cards = [...cards, requestedRental];
          const rentalsInDeck = cards.filter(card => card.rental).length;
          if (rentalsInDeck > 1 || cards.length - rentalsInDeck > 5 || new Set(cards.map(supportIdentity)).size !== cards.length) return false;
          const counts = {};
          for (const card of cards) {
            const axis = supportAxis(card);
            counts[axis] = (counts[axis] ?? 0) + 1;
            if (counts[axis] > (quotas[axis] ?? 0)) return false;
          }
          return true;
        };
        const { starts: linkedStarts, partners } = linkedSupportStarts(effectGroups, allowedLinks, fits, soloPoints);
        for (const group of sourceSupportRequirementGroups) {
          const anchor = [...allowedLinks].filter(card => group.eligibleGameIds.includes(card.gameId) && group.minimumLevelKnown
            && (group.minimumLevel === null || card.level >= group.minimumLevel) && fits([card]))
            .sort((a, b) => soloPoints(b) - soloPoints(a) || Number(a.rental) - Number(b.rental) || a.gameId.localeCompare(b.gameId))[0];
          if (anchor) linkedStarts.push([anchor]);
        }
        const pool = [], preparationPool = [];
        for (const axis of [...axes, 'assist']) {
          const ranked = candidatePool.filter(row => supportAxis(row) === axis)
            .map(row => ({ row, evaluation: singleEvaluation(row), length: 1, key: row.gameId })).sort(better);
          const sourceSeeds = ranked.filter(entry => sourceSupportSeedIds.has(entry.row.gameId));
          // A support can raise a different attribute than its slot. Keep the
          // best gain on each axis even if other cards win on solo total.
          const axisSeeds = [];
          for (const stat of peak ? axes : []) {
            const strongest = ranked.reduce((best, entry) => !best || entry.evaluation.cappedStats[stat] > best.evaluation.cappedStats[stat] ? entry : best, null);
            if (strongest && strongest.evaluation.cappedStats[stat] > empty.cappedStats[stat]) axisSeeds.push(strongest);
          }
          pool.push(...[...new Set([...ranked.slice(0, 12), ...sourceSeeds, ...axisSeeds])].map(entry => entry.row));
          if (preparationTargets) preparationPool.push(...[...new Set([
            ...ranked.slice(0, 12), ...[...ranked].sort(preparationBetter).slice(0, 6), ...sourceSeeds
          ])].map(entry => entry.row));
        }
        // Reserve a few starts that can include an otherwise discarded
        // provider (or a rental/three-card chain). Fill these in any order so
        // a high-ID supplier never blocks adding an earlier receiver.
        // A single receipt can reward several different low-singleton cards.
        // Include the best providers and receivers from each active family.
        const linkedPool = [...new Set([...pool, ...[...partners].filter(card => !card.rental)])]
          .sort((a, b) => a.gameId.localeCompare(b.gameId));
        const singleEntry = row => ({ evaluation: singleEvaluation(row), length: 1, key: row.gameId });
        pool.sort((a, b) => peak ? better(singleEntry(a), singleEntry(b)) : a.gameId.localeCompare(b.gameId));
        preparationPool.sort((a, b) => a.gameId.localeCompare(b.gameId));
        let beam = [{ cards: [], last: -1, counts: {}, evaluation: evaluate([]), length: 0, key: '' }];
        let preparationBeam = preparationTargets ? [...beam] : [];
        const expand = (states, searchPool, preserveCompletable = false) => {
          const next = [];
          for (const state of states) for (let i = state.last + 1; i < searchPool.length; i++) {
            const row = searchPool[i], axis = supportAxis(row);
            if ((state.counts[axis] ?? 0) >= ownedQuotas[axis] || state.cards.some(card => supportIdentity(card) === supportIdentity(row))) continue;
            const cards = [...state.cards, row];
            if (preserveCompletable && searchPool.slice(i + 1).filter(future =>
              (state.counts[supportAxis(future)] ?? 0) + Number(supportAxis(future) === axis) < (ownedQuotas[supportAxis(future)] ?? 0)
              && !cards.some(card => supportIdentity(card) === supportIdentity(future))).length < 5 - cards.length) continue;
            next.push({ cards, last: i, counts: { ...state.counts, [axis]: (state.counts[axis] ?? 0) + 1 }, evaluation: evaluate(cards, true), length: cards.length, key: cards.map(card => card.gameId).sort().join('|') });
          }
          return next;
        };
        for (let depth = 0; depth < 5; depth++) {
          const next = expand(beam, pool);
          if (next.length) beam = next.sort(better).slice(0, peak ? 8 : 24);
          if (preparationTargets) {
            const preparedNext = expand(preparationBeam, preparationPool, true);
            if (preparedNext.length) preparationBeam = preparedNext.sort(preparationBetter).slice(0, 12);
          }
          if (!next.length) break;
        }
        for (const start of linkedStarts) {
          const cards = start.filter(row => !row.rental);
          const seedRental = start.find(row => row.rental) ?? requestedRental;
          while (cards.length < 5) {
            const taken = seedRental ? [...cards, seedRental] : cards;
            const identities = new Set(taken.map(supportIdentity)), counts = {};
            for (const member of taken) counts[supportAxis(member)] = (counts[supportAxis(member)] ?? 0) + 1;
            let next;
            for (const row of linkedPool) {
              const axis = supportAxis(row);
              if ((counts[axis] ?? 0) >= (quotas[axis] ?? 0) || identities.has(supportIdentity(row))) continue;
              const combined = seedRental ? [...cards, row, seedRental] : [...cards, row];
              const entry = { row, evaluation: evaluate(combined, true), length: combined.length, key: row.gameId };
              if (!next || better(entry, next) < 0) next = entry;
            }
            if (!next) break;
            cards.push(next.row);
          }
          cards.sort((a, b) => a.gameId.localeCompare(b.gameId));
          const key = cards.map(card => card.gameId).join('|');
          if (!beam.some(entry => entry.key === key)) {
            const counts = {};
            for (const card of cards) counts[supportAxis(card)] = (counts[supportAxis(card)] ?? 0) + 1;
            beam.push({ cards, counts, evaluation: evaluate(cards, true), length: cards.length, key });
          }
        }
        // Keep the author's exact six-card reference reviewable when five can be owned
        // and the remaining card can be rented; its current-level values still compete.
        if (restrictToGuide && name === 'source_reference6') {
          const ideal = (supportGuide.idealSupports ?? []).map(card => ownedById.get(card.gameId)).filter(Boolean);
          for (let omit = 0; omit < (ideal.length === 6 ? 6 : ideal.length === 5 ? 1 : 0); omit++) {
            const cards = ideal.length === 6 ? ideal.filter((_, index) => index !== omit) : ideal;
            if (requestedRental && cards.some(card => card.gameId === requestedRental.gameId)) continue;
            const counts = Object.fromEntries([...axes, 'assist'].map(axis => [axis, cards.filter(card => supportAxis(card) === axis).length]));
            beam.push({ cards, counts, evaluation: evaluate(cards), length: cards.length, key: cards.map(card => card.gameId).join('|') });
          }
        }
        // Every eligible rental gets its own five-card draft on this route.
        // Rank owned copies by stat contribution; include a second draft with
        // an SP provider on each scheduled axis when the role changes priority.
        const rankedDraftPool = [...candidatePool].sort((a,b) => soloPoints(b)-soloPoints(a) || a.gameId.localeCompare(b.gameId));
        for (const rental of searchRentals.filter(row => quotas[supportAxis(row)] > 0)) {
          const draft = first => completeRentalDeck(rankedDraftPool,rental,quotas,mixed,supportAxis,supportIdentity,first);
          const cards = draft(null);
          const drafts = [cards];
          if (!peak && cards.length === 5 && uncoveredSp({evaluation:evaluate([...cards,rental])}) > 0) {
            for (const axis of usedAxes) {
              const provider = rankedDraftPool.find(row => supportIdentity(row)!==supportIdentity(rental) && row.resources.spRates[axis] > 0);
              if (provider) drafts.push(draft(provider));
            }
          }
          // Re-evaluate replacements in the context of the other five cards.
          // A singleton's stat contribution can be rounded or capped differently
          // once growth and SP coverage from the rental are already present.
          if (!peak && cards.length === 5) {
            let improved = cards;
            let bestEntry = {length:6, evaluation:evaluate([...cards,rental]), key:cards.map(c=>c.gameId).join('|')};
            for (const previous of cards) {
              const remainder = improved.filter(row => row !== previous);
              const used = new Set([rental,...remainder].map(supportIdentity));
              const replacements = rankedDraftPool.filter(row => supportAxis(row) === supportAxis(previous)
                && row !== previous && !used.has(supportIdentity(row))).slice(0,4);
              for (const row of replacements) {
                const next = [...remainder,row];
                const entry = {length:6,evaluation:evaluate([...next,rental]),key:next.map(c=>c.gameId).sort().join('|')};
                if (better(entry,bestEntry)<0) { improved = next; bestEntry = entry; }
              }
            }
            if (improved !== cards) drafts.push(improved);
          }
          for (const owned of drafts) {
            const counts = {};
            for (const card of owned) counts[supportAxis(card)] = (counts[supportAxis(card)] ?? 0) + 1;
            beam.push({cards:owned, counts, draftRental:rental, key:owned.map(card=>card.gameId).sort().join('|')+'@'+rental.gameId});
          }
        }
        const witness = options[policyWitness];
        if (witness) {
          const owned = witness.owned.map(id => ownedById.get(id)), rental = rentals.find(card => card.gameId === witness.rental);
          if (rental && owned.length === 5 && owned.every(Boolean) && fits([...owned,rental])) {
            const counts = {};
            for (const card of owned) counts[supportAxis(card)] = (counts[supportAxis(card)] ?? 0) + 1;
            beam.push({cards:owned,counts,draftRental:rental,policyWitness:true,key:owned.map(card=>card.gameId).sort().join('|')+'@'+rental.gameId});
          }
        }
        const baselineKeys = new Set(beam.map(state => state.key));
        const finalStates = [...beam, ...preparationBeam.filter(state => !baselineKeys.has(state.key))];
        for (const state of finalStates) {
          const candidates = (state.draftRental ? [state.draftRental] : rentals).filter(row => (state.counts[supportAxis(row)] ?? 0) < (quotas[supportAxis(row)] ?? 0)
            && !state.cards.some(card => card.gameId === row.gameId || supportIdentity(card) === supportIdentity(row))
            && (!mixed || new Set([...state.cards, row].map(supportAxis)).size >= 2));
          const rankRental = (rental, shortlistOnly) => ({ rental, evaluation: evaluate([...state.cards, rental], shortlistOnly),
            length: state.cards.length + 1, key: state.key + '|' + rental.gameId });
          let retained = candidates;
          if (screen && candidates.length > 3) {
            const ranked = candidates.map(rental => rankRental(rental, true)).sort(better);
            retained = new Set(ranked.slice(0, 3).map(row => row.rental));
            if (requestedRental && candidates.includes(requestedRental)) retained.add(requestedRental);
            if (preparationTargets) {
              for (const row of [...ranked].sort(preparationBetter).slice(0, 2)) retained.add(row.rental);
            }
            // Preserve the physical rental from a grouped seed even when
            // approximate target selection underestimates its specific item.
            for (const seed of linkedStarts) {
              const rental = seed.find(row => row.rental);
              if (rental && candidates.includes(rental) && seed.every(row => row.rental || state.cards.includes(row))) retained.add(rental);
            }
          }
          const alternatives = [...retained].map(rental => rankRental(rental, false)).sort(better);
          const baselineTop = (options.rentalGameId ? alternatives.find(row => row.rental.gameId === options.rentalGameId) : alternatives[0])
            ?? { rental: null, evaluation: evaluate(state.cards), length: state.cards.length, key: state.key };
          const preparedTop = preparationTargets ? (options.rentalGameId ? alternatives.filter(row => row.rental.gameId === options.rentalGameId) : alternatives)
            .find(row => row.evaluation.preparation.met) : null;
          const top = preparedTop ?? baselineTop;
          const result = { ...top, owned: state.cards, route, memories, primary, secondary, ratingContext, fundingInputs,
            template: name ?? (primarySlots === 6 ? 'single_explicit' : primarySlots + '-' + (6 - primarySlots - assistSlots) + (assistSlots ? '+assist' : '')), quotas, context, memoryInitial, memoryGrowth, memoryRequirements,
            guideMemoryProfile: memories.guideProfile, memoryPreparation: memories.openingPreparation,
            capVerified, panelStatus: inventory.hifBonuses?.status ?? 'unknown' };
          const baselineResult = top === baselineTop ? result : { ...result, ...baselineTop };
          if (state.policyWitness && (!witnessFinalist || compareResults(result,witnessFinalist)<0)) witnessFinalist=result;
          if (baselineKeys.has(state.key) && baselineClass) for (const alternative of alternatives) {
            const previous = rentalAlternatives.get(alternative.rental.gameId);
            if (!previous || better(alternative,previous)<0)
              rentalAlternatives.set(alternative.rental.gameId,{...result,...alternative});
          }
          const resultIds = new Set([...state.cards, ...(top.rental ? [top.rental] : [])].map(card => card.gameId));
          if (supportGuide?.idealSupports?.length === 6 && resultIds.size === 6 && supportGuide.idealSupports.every(card => resultIds.has(card.gameId))
            && (!bestAuthorReference || compareResults(result, bestAuthorReference) < 0)) bestAuthorReference = result;
          if (restrictToGuide && name === 'source_reference6' && state.cards.length === 5) {
            const exactRental = alternatives.find(alternative => {
              const ids = new Set([...state.cards,alternative.rental].map(card=>card.gameId));
              return ids.size === 6 && supportGuide.idealSupports.every(card=>ids.has(card.gameId));
            });
            if (exactRental) {
              const referenceResult = {...result,...exactRental};
              if (!bestAuthorReference || compareResults(referenceResult,bestAuthorReference)<0) bestAuthorReference=referenceResult;
            }
          }
          modelsEvaluated++;
          if (baselineKeys.has(state.key)) {
            const previousClass = bestByClass.get(classAttribute);
            if (!previousClass || compareResults(baselineResult, previousClass) < 0) bestByClass.set(classAttribute, baselineResult);
            if (baselineClass) {
              const previousPrimary = bestByPrimary.get(primary);
              if (!previousPrimary || compareResults(baselineResult, previousPrimary) < 0) bestByPrimary.set(primary, baselineResult);
              if (!best || compareResults(baselineResult, best) < 0) best = baselineResult;
              if (!state.draftRental) {
                if (!beamBest || compareResults(baselineResult,beamBest)<0) beamBest=baselineResult;
                const previous=beamByPrimary.get(primary);
                if (!previous || compareResults(baselineResult,previous)<0) beamByPrimary.set(primary,baselineResult);
              }
            }
          }
          if (preparationTargets && result.length === 6 && !missingMemoryRequirements(result)
            && result.evaluation.budgetConstraintsMet === 2 && result.evaluation.preparation.met) {
            feasibleModelsEvaluated++;
            if (!bestPrepared || compareResults(result, bestPrepared) < 0) bestPrepared = result;
            if (!state.draftRental) {
              if (!beamPrepared || compareResults(result,beamPrepared)<0) beamPrepared=result;
              const previous=beamPreparedByPrimary.get(primary);
              if (!previous || compareResults(result,previous)<0) beamPreparedByPrimary.set(primary,result);
            }
            const previousPrimary = preparedByPrimary.get(primary), previousClass = preparedByClass.get(classAttribute);
            if (!previousPrimary || compareResults(result, previousPrimary) < 0) preparedByPrimary.set(primary, result);
            if (!previousClass || compareResults(result, previousClass) < 0) preparedByClass.set(classAttribute, result);
          }
        }
      }
    }
  }
  if (!best) return null;
  if (requestedPool === 'auto' && restrictToGuide && best.length < 6) {
    const widerWarnings = new Set();
    const wider = recommendHif({inventory,catalog,selected,plan,targetAxis,weights,
      options:{...options,sourceSupportMode:'unrestricted'},warnings:widerWarnings});
    if (wider && wider.length > best.length) {
      const message = '자동 공략 후보만으로 편성을 채울 수 없어 전체 허용 서포트에서 다시 비교했습니다.';
      for (const warning of widerWarnings) warnings.add(warning);
      warnings.delete('해당 아이돌 공략의 추천·대안 서포트를 보유 돌파와 선택한 계산 레벨로 비교했습니다.');
      warnings.add(message);
      wider.sourceGuideEvidence.requestedMode = requestedPool;
      wider.sourceGuideEvidence.automaticPoolExpansion = {reason:'incomplete_guide_deck',message};
      return wider;
    }
  }
  const canPrepare = row => row?.length===6 && !missingMemoryRequirements(row) && row.evaluation.budgetConstraintsMet===2
    && row.evaluation.preparation?.met===true;
  const fundedPreference = (a,b) => (preparationTargets && sourceSupportMissing(a)===sourceSupportMissing(b)
    ? Number(canPrepare(b))-Number(canPrepare(a)) : 0) || compareResults(a,b);
  const fundedTools = {catalog,rank:rankDeck,prefer:fundedPreference,
    rescore:(row,route,settings)=>scoreSupport(supportIndex.get(row.gameId),{level:row.level,uncap:row.uncap,ownedLevel:row.ownedLevel,
      supportLevelBasis:row.levelBasis},route,plan,'hif',axisWeights,weights,row.rental,settings)};
  const members = row => [...row.owned,...(row.rental?[row.rental]:[])];
  const exactFinalists = new Map();
  function reprice(row) {
    if(!row || row.length!==6 || !row.route.supportPeakScenario || row.route.supportPeakScenario.consultPlan==='none') return row;
    if(!exactFinalists.has(row))exactFinalists.set(row,replayFundedDeck(row,members(row),fundedTools));
    return exactFinalists.get(row);
  }
  const swappedFinalists = new Map();
  for(const finalist of new Set([best,bestPrepared,beamBest,beamPrepared].filter(Boolean))) {
    let selected = reprice(finalist);
    if (finalist.length===6 && finalist.route.supportPeakScenario && finalist.route.supportPeakScenario.consultPlan!=='none')
      for(const cards of fundingSwaps(finalist,supportAxis,supportIdentity,options.rentalGameId)) {
        const alternative=replayFundedDeck(finalist,cards,fundedTools);
        if (fundedPreference(alternative,selected)<0) selected=alternative;
      }
    swappedFinalists.set(finalist,selected);
  }
  bestAuthorReference=reprice(bestAuthorReference);
  const financed=row=>swappedFinalists.get(row)??reprice(row);
  best=financed(best);
  bestPrepared=financed(bestPrepared);
  // Do not discard the prior beam winner before either search lane has
  // replayed its card-dependent budget and compared its funded alternatives.
  for (const entry of new Set([beamBest,beamPrepared,...beamByPrimary.values(),...beamPreparedByPrimary.values()].filter(Boolean))) {
    const candidate=financed(entry);
    if (compareResults(candidate,best)<0) best=candidate;
    if (canPrepare(candidate) && (!bestPrepared || compareResults(candidate,bestPrepared)<0)) bestPrepared=candidate;
  }
  // Compare the best full draft for each rental after replaying the actual
  // purchase budget on its selected route, just as for the beam winner.
  for (const [id,entry] of rentalAlternatives) {
    const candidate = financed(entry);
    rentalAlternatives.set(id,candidate);
    if (options.rentalGameId && options.rentalGameId !== id) continue;
    if (compareResults(candidate,best)<0) best = candidate;
    if (canPrepare(candidate) && (!bestPrepared || compareResults(candidate,bestPrepared)<0)) bestPrepared = candidate;
    for (const [choices,axis] of [[bestByPrimary,candidate.primary],[bestByClass,candidate.route.classAttribute]]) {
      const previous = choices.get(axis);
      if (previous && compareResults(candidate,financed(previous))<0) choices.set(axis,entry);
    }
  }
  for(const choices of [bestByPrimary,bestByClass,preparedByPrimary,preparedByClass])
    for(const [axis,row] of choices)choices.set(axis,financed(row));
  for(const row of bestByPrimary.values()) {
    if(compareResults(row,best)<0)best=row;
    if(canPrepare(row)&&(!bestPrepared||compareResults(row,bestPrepared)<0))bestPrepared=row;
  }
  for(const [old,row] of swappedFinalists) if(!canPrepare(old)&&canPrepare(row))feasibleModelsEvaluated++;
  for(const row of preparedByPrimary.values()) if(canPrepare(row)&&(!bestPrepared||compareResults(row,bestPrepared)<0))bestPrepared=row;
  // A funding provider can change which partner is most effective. Reprice
  // one- and two-card replacements on the same winning route and rental.
  function improveFundedPartners(entry) {
    if (!entry || entry.length!==6 || !entry.route.supportPeakScenario || entry.route.supportPeakScenario.consultPlan==='none') return entry;
    const deckKey = cards => cards.map(c=>c.gameId+(c.rental?'/r':'')).sort().join('|');
    const seen = new Set([deckKey(members(entry))]);
    function neighbors(seed) {
      const deck=members(seed), alternatives=[];
      for (let slot=0;slot<deck.length;slot++) {
        const old=deck[slot];
        if (old.rental) continue;
        for (const row of entry.fundingInputs.ownedById.values()) {
          if (supportAxis(row)!==supportAxis(old) || deck.some(c=>supportIdentity(c)===supportIdentity(row))) continue;
          const next=[...deck];next[slot]=row;
          const key=deckKey(next);
          if (seen.has(key)) continue;
          seen.add(key);
          alternatives.push(replayFundedDeck(entry,next,fundedTools));
        }
      }
      return alternatives.sort(fundedPreference);
    }
    let improved=entry;
    for (const changed of neighbors(entry).slice(0,3)) {
      if (fundedPreference(changed,improved)<0) improved=changed;
      const second=neighbors(changed)[0];
      if (second && fundedPreference(second,improved)<0) improved=second;
    }
    return improved;
  }
  // A deck that paid for a better item path can lose an unfunded ranking to
  // another draft of the same rental. Price this known witness independently.
  if (witnessFinalist) {
    const witness = reprice(witnessFinalist);
    if (compareResults(witness,best)<0) {
      best=witness;
      bestByPrimary.set(witness.primary,witness);
      bestByClass.set(witness.route.classAttribute,witness);
    }
    if (canPrepare(witness) && (!bestPrepared || compareResults(witness,bestPrepared)<0)) {
      bestPrepared=witness;
      preparedByPrimary.set(witness.primary,witness);
      preparedByClass.set(witness.route.classAttribute,witness);
    }
  }
  const beforePartnerSearch=best;
  best=improveFundedPartners(best);
  if (best !== beforePartnerSearch) {
    bestByPrimary.set(best.primary,best);
    bestByClass.set(best.route.classAttribute,best);
    if (canPrepare(best) && (!bestPrepared || compareResults(best,bestPrepared)<0)) bestPrepared=best;
  }
  const unconstrainedBest = best;
  if (bestPrepared && sourceSupportMissing(bestPrepared) > sourceSupportMissing(best)) bestPrepared = null;
  best = bestPrepared ?? best;
  // The favorable item/shop policy depends on the seed deck and its lesson
  // layout. A stronger draft on the default route must not suppress a better
  // downstream policy discovered from the independent beam.
  if (!layout && best.route.supportPeakScenario) {
    const original = [...new Set([beamBest,beamPrepared,...beamByPrimary.values(),...beamPreparedByPrimary.values()].filter(Boolean))]
      .map(financed).sort(fundedPreference)[0];
    const sameMembers = original && original.route===best.route && original.key===best.key;
    if (original && !sameMembers) {
      const lesson = {primary:original.primary,secondary:original.secondary,classAttribute:original.route.classAttribute,
        primaryLessonCount:original.fundingInputs.routeOptions.primaryLessonCount,lessonPattern:original.fundingInputs.routeOptions.lessonPattern};
      const model = {primaryAttribute:lesson.primary,secondaryAttribute:lesson.secondary,classAttribute:lesson.classAttribute,
        supportActionPlan:original.route.supportActionPlan,supportProvidedActions:evaluateHifDeck(members(original),original.context).providedActions};
      const alternate = chooseHifActionStrategy({catalog,inventory,focus:options.activityFocus,
        options:{...options,primaryLessonCount:lesson.primaryLessonCount,lessonPattern:lesson.lessonPattern},
        result:{selectedIdol:selected,scoreSummary:{plan,hifModel:model},supports:{owned:original.owned,rental:original.rental},
          sourceGuideEvidence:{mode:sourceSupportMode,poolGameIds:[...guidePool]}}});
      if (alternate) best[beamActionAlternative]={alternate,layout:lesson};
    }
  }
  best.preparationComparison = { ...preparationAssessment(best.evaluation.cappedStats, preparationTargets),
    status: !preparationTargets ? 'not_requested' : bestPrepared ? 'targets_met_in_bounded_search' : 'no_feasible_candidate_in_bounded_search',
    basis: 'end_of_declared_route_conditional_projection', feasibleCandidateFound: preparationTargets ? Boolean(bestPrepared) : null,
    feasibleEvaluations: feasibleModelsEvaluated, fallbackPreserved: Boolean(preparationTargets && !bestPrepared),
    unconstrainedCappedStats: unconstrainedBest.evaluation.cappedStats,
    unconstrainedModeledStatTotal: unconstrainedBest.evaluation.score,
    numericStatWeightsChanged: false, gameReadinessConfirmed: false, globalFeasibilityProven: false,
    eligibleCandidateRequiresSixSupportsAndRequestedMemories: true,
    explicitSupportResourceRequirementsPreserved: true, sourceSupportRequirementsPreserved: true,
    search: { additionalBeamWidth: preparationTargets ? 12 : 0, additionalCandidatesPerAttribute: preparationTargets ? 6 : 0,
      deficitOrderingIsSearchOnly: true, originalBeamPreserved: true },
    limitations: ['전체 선언 경로 종료 시점의 조건부 최종 스탯 목표입니다. 첫 본선·첫 선발 통과나 실제 ○·◎ 판정의 확인이 아닙니다.',
      '각 후보는 수업 전체를 한 속성에 배정합니다. 주차별 세 속성 혼합 수업 배분까지 탐색하지 않습니다.',
      '공략 후보 풀·기존 반입 조건과 제한 탐색 안의 결과이며 목표를 만족하는 모든 조합을 찾았다고 보장하지 않습니다.'] };
  best.classComparison = [...bestByClass.keys()].map(classAttribute => {
    const baseline = bestByClass.get(classAttribute), prepared = preparedByClass.get(classAttribute);
    const result = classAttribute === best.route.classAttribute ? best
      : prepared && sourceSupportMissing(prepared) <= sourceSupportMissing(baseline) ? prepared : baseline;
    return { classAttribute, primaryAttribute: result.primary, secondaryAttribute: result.secondary,
      cappedStats: result.evaluation.cappedStats, modeledStatTotal: result.evaluation.score, partialEvaluationPoints: result.evaluation.partialEvaluationPoints,
      preparation: preparationAssessment(result.evaluation.cappedStats, preparationTargets), selected: classAttribute === best.route.classAttribute };
  });
  const cards = [...best.owned, ...(best.rental ? [best.rental] : [])];
  const selectedDeck = evaluateHifDeck(cards, { ...best.context, explainSupportLinks: true });
  best.evaluation = { ...best.evaluation, ...selectedDeck };
  const suppliedReceipts = selectedDeck.providedActions?.skill_acquire ?? 0;
  const statPoints = HIF_STAT_POINTS * selectedDeck.score;
  const partialPoints = partialSupportRating(selectedDeck.score, suppliedReceipts, best.ratingContext);
  best.supportRating = { statEvaluationPoints: statPoints, partialEvaluationPoints: partialPoints,
    badgeEvaluationPoints: best.ratingContext ? partialPoints - statPoints : null,
    badgeActivationCount: best.ratingContext ? Math.min(best.ratingContext.activationCap, best.ratingContext.routeReceipts + suppliedReceipts) : null };
  options[policyFinalists]?.set(best.supportRating,{entry:best,tools:fundedTools});
  const withContribution = card => {
    const remaining=cards.filter(member=>member!==card);
    const without=replayFundedDeck(best,remaining,fundedTools);
    const cappedStatDelta = Object.fromEntries(axes.map(axis => [axis, selectedDeck.cappedStats[axis] - without.evaluation.cappedStats[axis]]));
    const statEvaluationPoints = (selectedDeck.score - without.evaluation.score) * HIF_STAT_POINTS;
    const partialEvaluationPoints = partialPoints - without.evaluation.partialEvaluationPoints;
    return { ...card, supportContribution: { comparison: 'remove_one_same_route', cappedStatDelta, statEvaluationPoints,
      partialEvaluationPoints, badgeEvaluationPoints: best.ratingContext ? partialEvaluationPoints - statEvaluationPoints : null } };
  };
  best.owned = best.owned.map(withContribution);
  if (best.rental) best.rental = withContribution(best.rental);
  best.supportPeakScenario = Boolean(best.route.supportPeakScenario);
  best.attributeCounts = Object.fromEntries([...axes, 'assist'].map(axis => [axis, cards.filter(card => supportAxis(card) === axis).length]));
  const selectedIds = new Set(cards.map(card => card.gameId));
  const eligibleOwnedIds = new Set(rawOwned.filter(({card,owned}) => {
    const level=value(owned.level),uncap=value(owned.uncap??owned.levelLimitRank),cap=value(card?.maxLevels?.[uncap]);
    return card && compatible(card.plan,plan) && level!==null && level>=1 && Number.isInteger(uncap) && uncap>=0 && uncap<=4 && (cap===null||level<=cap);
  }).map(({card}) => card.gameId));
  best.sourceGuideEvidence = {
    status: supportGuide ? restrictToGuide ? 'matched_author_pool_account_recalculation' : 'unrestricted_comparison_alternative' : 'no_exact_author_profile',
    mode: restrictToGuide ? 'guide' : 'unrestricted', requestedMode: requestedPool, automaticPoolExpansion: expansion,
    profileId: supportGuide?.id ?? null, sourceIds: supportGuide?.sourceIds ?? [],
    sources: (catalog.guideSupportProfiles?.sources ?? []).filter(source => supportGuide?.sourceIds?.includes(source.id)),
    sourceUpdated: supportGuide?.sourceUpdated ?? null, checkedAt: supportGuide?.checkedAt ?? null,
    poolGameIds: [...guidePool], idealSupportIds: (supportGuide?.idealSupports ?? []).map(card => card.gameId),
    alternativeSupportIds: (supportGuide?.alternativeSupports ?? []).map(card => card.gameId),
    idealAttributeCounts: supportGuide ? referenceCounts : null, selectedAttributeCounts: best.attributeCounts,
    exactIdealCompositionSelected: supportGuide ? cards.length === 6 && supportGuide.idealSupports.every(card => selectedIds.has(card.gameId)) : null,
    authorReferenceCandidate: bestAuthorReference ? {
      available:true,primaryAttribute:bestAuthorReference.primary,secondaryAttribute:bestAuthorReference.secondary,
      cappedStats:bestAuthorReference.evaluation.cappedStats,modeledStatTotal:bestAuthorReference.evaluation.score,
      selectedStatsDelta:Object.fromEntries(axes.map(axis=>[axis,best.evaluation.cappedStats[axis]-bestAuthorReference.evaluation.cappedStats[axis]])),
      owned:bestAuthorReference.owned.map(card=>({gameId:card.gameId,level:card.level,ownedLevel:card.ownedLevel,uncap:card.uncap})),
      rental:bestAuthorReference.rental?{gameId:bestAuthorReference.rental.gameId,level:bestAuthorReference.rental.level,uncap:bestAuthorReference.rental.uncap}:null,
      note:'원문 여섯 장에도 같은 보유 서포트 계산 레벨과 대여 한 칸을 적용했습니다.'
    } : {available:false,reason:supportGuide?'원문 여섯 장을 확인된 보유 다섯 장·대여 한 칸과 현재 수동 조건으로 구성하지 못했거나 해당 모드에서 별도 평가하지 않았습니다.':'해당 고유의 원문 편성 없음'},
    selected: cards.map(card => ({gameId:card.gameId,name:card.name,nameJa:card.nameJa,level:card.level,uncap:card.uncap,rental:card.rental,
      sourceRole: supportGuide?.idealSupports?.some(ref=>ref.gameId===card.gameId) ? 'ideal' : guidePool.has(card.gameId) ? 'alternative' : 'outside_author_pool'})),
    missingOwnedIdealIds: (supportGuide?.idealSupports ?? []).filter(card=>!eligibleOwnedIds.has(card.gameId)).map(card=>card.gameId),
    substitutedIdealIds: (supportGuide?.idealSupports ?? []).filter(card=>!selectedIds.has(card.gameId)).map(card=>card.gameId),
    completeSixCardDeck: cards.length === 6, unfilledSlots: Math.max(0,6-cards.length),
    manualTemplatePreserved: template !== 'auto', mixedAttributeCandidatesIncluded: restrictToGuide && template === 'auto',
    supportLevelMode:options.supportLevelMode, currentOwnedLevelsUsed:options.supportLevelMode==='current',
    maximumLevelValuesAppliedToOwned:options.supportLevelMode==='uncapMax', sourceOrderUsedAsRank: false,
    sourceSupportRequirements: { active: best.evaluation.sourceSupportRequirementGroups.length > 0,
      missingCount: best.evaluation.sourceSupportRequirementMissingCount, groups: best.evaluation.sourceSupportRequirementGroups,
      basis: 'active_memory_source_recipe_composition_before_numeric_stats', numericEffectWeightAdded: false,
      itemAcquisitionConfirmed: false, note: '원문의 편성 조건만 우선 비교했습니다. 실제 P아이템 획득·시험 효과 발동을 확정하거나 화력 수치를 가산한 결과가 아닙니다.' },
    unrestrictedAlternative: { available: Boolean(supportGuide), considered: !restrictToGuide, requestOptions: {sourceSupportMode:'unrestricted'} },
    numericBasis: best.ratingContext ? '조건부 최종 Vo/Da/Vi와 스킬 획득 와펜의 평가점 기여.' : '조건부 최종 Vo/Da/Vi와 서포트 기여 비교 지수.',
    conditions: supportGuide?.conditions ?? [], limitations: [...(supportGuide?.limitations ?? []),
      '공략 후보 풀·선택한 레벨·상한·성장 단계·SP 보조·명시 자원 조건으로 편성을 비교합니다.',
      '미확인 P아이템 획득 시점·발동 조건은 보장 수치에 합산하지 않고 조건부 값 또는 미계산 이유를 유지합니다.',
      '보유 카드·계산 레벨·대여 한 칸·동선 조건에 따라 원문과 다른 편성을 선택할 수 있습니다.']
  };
  best.modelsEvaluated = modelsEvaluated;
  best.searchScreening = { applied: screenedLargePool, rentalFinalistsPerOwnedDeck: screenedLargePool ? 3 : null,
    preparationAndLinkedRentalsRetained: screenedLargePool, sixCardPhysicalReplays: screenedLargePool ? finalistsReplayed : null };
  best.attributeComparison = [...bestByPrimary].map(([primary, baseline]) => {
    const prepared = preparedByPrimary.get(primary);
    return prepared && sourceSupportMissing(prepared) <= sourceSupportMissing(baseline) ? prepared : baseline;
  }).map(result => ({ primaryAttribute: result.primary,
    secondaryAttribute: result.secondary, deckTemplate: result.template, cappedStats: result.evaluation.cappedStats,
    modeledStatTotal: result.evaluation.score, partialEvaluationPoints: result.evaluation.partialEvaluationPoints,
    stageResults: result === best ? best.evaluation.stageResults
      : evaluateHifDeck([...result.owned, ...(result.rental ? [result.rental] : [])], result.context).stageResults,
    spProviderCoverage: { covered: result.evaluation.spCovered, required: result.evaluation.spRequired },
    memoryMissingCount: result.memoryRequirements.missing.length, guideFulfilledCount: result.guideMemoryProfile?.fulfilledCount ?? 0,
    selected: result === best }));
  best.rentalCandidates = [...rentalAlternatives.values()].sort(better).map(entry => ({ ...entry.rental,
    candidateModeledStatTotal: entry.evaluation.score, candidatePartialEvaluationPoints: entry.evaluation.partialEvaluationPoints,
    candidateCappedStats: entry.evaluation.cappedStats, candidateFundingBasis:'selected_deck_route', requiresReoptimization: true }));
  best.baseline = evaluateHifDeck([], best.fundingInputs.context);
  if (best.length < 6) warnings.add(`서포트 ${best.template} 편성에서 ${6-best.length}칸을 빈칸으로 표시합니다. 전체 허용 후보에 속성별 정원·동일 카드 제외·보유 5장과 대여 1장 조건을 적용한 결과는 보유 ${best.owned.length}장과 대여 ${best.rental ? 1 : 0}장입니다.`);
  if (best.evaluation.spCovered < best.evaluation.spRequired) warnings.add('계획한 속성의 SP 확률 보조가 부족합니다. 모든 SP 성공 가정을 실제 진행 가능성으로 확인한 결과가 아닙니다.');
  if (options.allowAssist === false) warnings.add('사용자 설정으로 어시스트 서포트 후보를 제외했습니다.');
  warnings.add('HIF 편성은 계획한 SP 성공과 발동 조건에서 비교합니다. 실제 본선 화력과 메모리의 전투 효과는 별도입니다.');
  warnings.add('자동 메모리 추천은 명시한 중복 예외 외에는 같은 반입 스킬 ID를 한 장만 선택합니다. 이는 게임의 중복 허용 규칙과 별도의 기본 후보 생성 조건입니다.');
  warnings.add(({guide:'메모리는 공략의 검증·미확정 조건을 구분해 우선 비교한 뒤 반입 수치를 비교합니다. 개시 역할을 무조건 먼저 뽑는 규칙은 적용하지 않습니다.',
    opening:'개시 역할 우선 메모리는 성능 비교용 대안 씨드입니다. 실제 평가점이 더 높다는 판정이 아닙니다.',
    stats:'반입 수치 우선 메모리는 성능 비교용 대안 씨드입니다. 시험 화력·최종 평가점이 더 높다는 판정이 아닙니다.'})[options.memorySelectionMode??'guide']);
  if (best.memoryPreparation?.missingRoles.length) warnings.add('첫 선발시험의 개시 메모리에서 확인하지 못한 역할: ' + best.memoryPreparation.missingRoles.map(role => ({attack:'공격',draw:'드로우',extra_action:'추가 행동'})[role]).join('·') + '. 기본 덱·고유·도중 획득으로 보완되는지 확인해야 하며 통과 준비 완료로 판정하지 않았습니다.');
  if (best.guideMemoryProfile?.applied) warnings.add('공략의 확인된 반입 역할을 우선 비교했습니다. 개막·커스텀·해금의 미충족 및 미확정 역할과 원문의 적용 조건을 함께 확인해야 합니다.');
  if (best.guideMemoryProfile?.considered && best.guideMemoryProfile.tentative) warnings.add('공략 역할에 맞는 미확정 메모리 후보도 무관한 스탯보다 우선 비교했습니다. PLv·개막·커스텀 등 확인되지 않은 조건을 충족으로 판정하지 않았습니다.');
  if (best.guideMemoryProfile?.conflicts.length) warnings.add('공략에서 지적한 보류 공간·커스텀·덱 제거 효과의 상충 가능성이 있습니다. 실제 덱 조건을 수동 확인해야 합니다.');
  if (best.memoryRequirements.missing.length) warnings.add(options.memorySelectionMode === 'stats'
    ? '스탯 모드에서는 요청 스킬·HIF 효과를 선택 기준에 넣지 않습니다. 선택 후 충족 여부는 메모리 요구 조건에서 확인할 수 있습니다.'
    : '요청한 필수 메모리 스킬·HIF 효과를 모두 충족하지 못했습니다. 보유·반입 조건과 중복 제한을 수동 확인해야 합니다.');
  return best;
}

function scenarioSupportPool(inventory, catalog, route, plan, scenario, axisWeights, weights, options, warnings) {
  const supportIndex = new Map(catalog.supportCards.map(row => [row.gameId, row]));
  const eligibleOwned = new Map();
  for (const original of inventory.supportCards ?? []) {
    const owned = record(original);
    const card = supportIndex.get(gameId(owned));
    if (!card) { warnings.add('알 수 없는 보유 서포트 ID가 있어 해당 카드를 수동 확인 대상으로 남겼습니다.'); continue; }
    if (!compatible(card.plan, plan)) continue;
    const result = scoreSupport(card, owned, route, plan, scenario, axisWeights, weights, false, options);
    if (!result) { warnings.add('레벨·돌파가 없거나 범위를 벗어난 서포트는 최대 레벨로 추정하지 않았습니다.'); continue; }
    if (!eligibleOwned.has(card.gameId) || eligibleOwned.get(card.gameId).score < result.score) eligibleOwned.set(card.gameId, result);
  }
  const rankedOwned = [...eligibleOwned.values()].sort((a, b) => b.score - a.score);
  const rentalCards = catalog.supportCards.filter(card => compatible(card.plan, plan));
  const rentals = rentalCards.map(card => scoreSupport(card, { level: card.maxLevels?.[4], uncap: 4 }, route, plan, scenario, axisWeights, weights, true, options)).filter(Boolean).sort((a, b) => b.score - a.score);
  return {rankedOwned,rentals};
}

function refineScenarioSupportDraft(entry, rankedOwned, context) {
    const deck = [...entry.owned, entry.rental], ownedIds = new Set(deck.map(card => card.gameId));
    let firstTwo=entry.score;
    for (let pass = 0; pass < 5; pass++) {
      let bestCard, bestSlot = -1, bestScore = entry.score;
      for (let slot = 0; slot < entry.owned.length; slot++) {
        const fixed=fixedScenarioSupportGroup(deck,deck[slot]);
        for (const card of rankedOwned) {
          if (ownedIds.has(card.gameId)) continue;
          const score = evaluateScenarioDeck([fixed,card], context);
          if (score > bestScore + 1e-8) { bestScore=score; bestSlot=slot; bestCard=card; }
        }
      }
      if (bestSlot < 0) break;
      ownedIds.delete(deck[bestSlot].gameId);
      ownedIds.add(bestCard.gameId);
      entry.owned[bestSlot] = deck[bestSlot] = bestCard;
      entry.score = bestScore;
      if (pass<2) firstTwo=bestScore;
    }
    return firstTwo;
}

function compareScenarioSupports({rankedOwned,rentals}, route, options, context, finalRoute=null) {
  const order = (a,b)=>b.length-a.length || b.score-a.score || a.rental.gameId.localeCompare(b.rental.gameId);
  const preferred=finalRoute && [...finalRoute.owned,...rankedOwned.filter(card=>!finalRoute.owned.some(row=>row.gameId===card.gameId))];
  const alternatives = rentals.map(rental => {
    const owned = rankedOwned.filter(row => row.gameId !== rental.gameId).slice(0, 5);
    const entry={ rental, owned, length: owned.length + 1, score: evaluateScenarioDeck([...owned,rental],context) };
    if (preferred) {
      const other=preferred.filter(row=>row.gameId!==rental.gameId).slice(0,5);
      const score=evaluateScenarioDeck([...other,rental],context);
      if (score>entry.score+1e-8) entry.seed={owned:other,score};
    }
    return entry;
  }).sort(order);
  const finalists = options.rentalGameId ? alternatives.filter(entry=>entry.rental.gameId===options.rentalGameId)
    : finalRoute ? alternatives : alternatives.slice(0,3);
  const ceiling=finalRoute ? scenarioRentalScoreCeiling(rankedOwned,rentals,context) : null;
  const seeds=finalRoute ? alternatives.map(entry=>({...entry,score:entry.seed?.score??entry.score})).sort(order) : [];
  const cutoff=finalRoute?.minimum?.score ?? seeds[8]?.score ?? -Infinity;
  const cutoffLength=finalRoute?.minimum?.length ?? seeds[8]?.length ?? 0;
  let skippedByCeiling=0;
  const firstDraft=options.rentalGameId ? finalists[0] : alternatives[0];
  let firstTwo=firstDraft?.score ?? null;
  for (const entry of finalists) {
    if (ceiling) {
      const upper=ceiling(entry.rental);
      if (upper<=(entry.seed?.score??entry.score)+1e-8 || entry.length<=cutoffLength && upper<cutoff-1e-8) {
        if (entry.seed) Object.assign(entry,entry.seed);
        skippedByCeiling++;
        continue;
      }
    }
    const initialRouteScore=refineScenarioSupportDraft(entry,rankedOwned,context);
    if (entry.seed && entry.seed.score>entry.score+1e-8) Object.assign(entry,entry.seed);
    if (entry.length===firstDraft.length) firstTwo=Math.max(firstTwo,initialRouteScore);
  }
  alternatives.sort(order);
  const top = options.rentalGameId ? alternatives.find(row => row.rental.gameId === options.rentalGameId) : alternatives[0];
  const owned = top?.owned ?? rankedOwned.slice(0, 5);
  const model = evaluateScenarioDeck(top ? [...owned,top.rental] : owned,context,true);
  return { route, owned, rental: top?.rental ?? null, length: owned.length + Number(Boolean(top?.rental)),
    score: model.score, model, skippedByCeiling, firstTwo:firstTwo ?? model.score,
    rentals: alternatives.map(entry => ({ ...entry.rental, modeledDeckScore:entry.score, requiresReoptimization: true })) };
}

/** Owned-account recommendation with explicit partial-data and heuristic boundaries. */
function recommendCurrent({ inventory = {}, catalog, options = {} }) {
  if (!catalog) throw new TypeError('catalog is required');
  const scenario = options.scenario ?? 'hif';
  if (!['hajime', 'nia', 'hif'].includes(scenario)) throw new RangeError('Unsupported scenario');
  if (options.startItemObservations!=null && (options.eventModeId ||
    !(scenario==='nia' && ['master','none'].includes(options.difficulty??'master') ||
      scenario==='hajime' && (options.difficulty??'legend')==='legend'))) {
    throw new RangeError('주차별 챌린지 관측은 일반 NIA 마스터와 하지메 레전드에서 입력해 주세요.');
  }
  if (options.niaAuditionBaseRewards!=null && (scenario!=='nia'||!['master','none'].includes(options.difficulty??'master')||options.eventModeId)) {
    throw new RangeError('오디션 챌린지 보상은 일반 NIA 마스터에서만 입력할 수 있습니다.');
  }
  if (scenario==='hif' && ['scenarioRewardVisits','scenarioRewardSpWeeks','scenarioRewardBaseCounts'].some(key=>options[key]!=null)) {
    throw new RangeError('선택한 중간 보상은 HIF에서 사용할 수 없습니다.');
  }
  const warnings = new Set();
  const idolIndex = new Map(catalog.idolCards.map(row => [row.gameId, row]));
  const ownedIdols = (inventory.idolCards ?? []).map(row => ({ owned: record(row), card: idolIndex.get(gameId(row)) })).filter(row => row.card);
  const target = normalizeAttribute(options.targetAttribute ?? 'free');
  const targetAxis = axes.includes(target) ? target : null;
  const axisWeights = Object.fromEntries(axes.map(axis => [axis, scenario === 'hif' ? 1 : targetAxis ? axis === targetAxis ? 1 : 0.6 : 1]));
  const selectedIdolId = options.idolGameId ?? options.idolId;
  let requestedPlan = normalizePlan(options.plan ?? 'free');
  if (!['sense', 'logic', 'anomaly', 'free'].includes(requestedPlan)) { requestedPlan = 'free'; warnings.add('확인되지 않은 플랜 코드이므로 자동 대응하지 않았습니다.'); }
  const requestedTrainingPlan = trainingTypePlans[canonicalTrainingType(options.trainingType)];
  if (!selectedIdolId && requestedPlan === 'free' && requestedTrainingPlan) requestedPlan = requestedTrainingPlan;
  const stageDifficulty=options.difficulty??catalog.scenarios?.find(row=>row.id===scenario)?.defaultDifficulty??({nia:'master',hajime:'legend'})[scenario];
  const entryBlocked=card=>scenarioEntryCondition(scenario,stageDifficulty,inventory,options,card).blocked;
  const availableOwnedIdols = ownedIdols.filter(({ card }) => !card.excludedScenarios?.includes(scenario)&&!entryBlocked(card)
    && (card.recommendationEligible !== false || card.recommendWhenOwned === true));
  const requested = selectedIdolId && ownedIdols.find(row => row.card.gameId === selectedIdolId);
  if (entryBlocked(requested?.card)||(!selectedIdolId&&ownedIdols.length&&ownedIdols.every(({card})=>entryBlocked(card)))) {
    throw new RangeError('친애도 또는 프로듀서 레벨이 선택한 난이도의 입장 조건에 미달합니다.');
  }
  if (requested?.card.excludedScenarios?.includes(scenario)) {
    const scenarioName = { hajime: '初', nia: 'N.I.A', hif: 'H.I.F' }[scenario];
    throw new RangeError(`${requested.card.characterName ?? requested.card.name}는 현재 ${scenarioName}에서 프로듀스할 수 없습니다.`);
  }
  const autoCandidates = availableOwnedIdols.filter(({ card }) => ['sense', 'logic', 'anomaly'].includes(card.plan) && compatible(card.plan, requestedPlan));
  const selectedIdol = selectedIdolId
    ? requested
    : autoCandidates.sort((a, b) => idolGrowthIndex(b.card, b.owned, axisWeights).score - idolGrowthIndex(a.card, a.owned, axisWeights).score || a.card.gameId.localeCompare(b.card.gameId))[0];
  if (selectedIdolId && !selectedIdol) warnings.add('선택 P아이돌의 보유 기록을 확인하지 못했습니다.');
  if (!selectedIdol) warnings.add('조건에 맞는 보유 P아이돌을 확인하지 못해 육성 대상을 자동 선택하지 않았습니다.');
  if (selectedIdol && requestedPlan !== 'free' && requestedPlan !== selectedIdol.card.plan) warnings.add('선택한 P아이돌의 실제 플랜으로 편성 조건을 맞췄습니다.');
  let plan = selectedIdol?.card.plan ?? requestedPlan;
  if (!['sense', 'logic', 'anomaly', 'free'].includes(plan)) { plan = 'free'; warnings.add('확인되지 않은 플랜 코드이므로 자동 대응하지 않았습니다.'); }
  const selectionMode = selectedIdolId ? 'explicit' : 'automatic';
  const selected = selectedIdol ? { ...selectedIdol.card, ownershipVerified: true, selectionMode, comparisonIndex: round(idolGrowthIndex(selectedIdol.card, selectedIdol.owned, axisWeights).score), selectionReason: selectedIdolId ? '사용자가 선택한 보유 P아이돌' : '조건에 맞는 보유 P아이돌 중 개화·True End를 반영한 공통 성장률로 자동 선택. 고유 카드의 전투 성능 최적화를 뜻하지 않음.', owned: selectedIdol.owned } : null;
  if (selected) {
    const growth = idolGrowthIndex(selected, selected.owned, axisWeights);
    selected.currentGrowthRatePermil = growth.currentGrowthRatePermil;
    selected.growthBreakdown = growth.growthBreakdown;
    selected.growthStatus = growth.growthStatus;
    if (growth.growthStatus !== 'current_card') selected.selectionReason += ' 현재 성장률이 미확정인 부분은 확인된 부분합만 비교했습니다.';
  }
  if (!options.trainingType && selected?.recommendedEffect && !selected.recommendedEffectConflict) {
    const type = ({ goodCondition: 'goodConditionTurns', goodImpression: 'goodImpressionTurns', enthusiasm: 'strength' })[selected.recommendedEffect] ?? selected.recommendedEffect;
    if (['concentration', 'goodConditionTurns', 'motivation', 'goodImpressionTurns', 'fullPower', 'strength', 'preservation'].includes(type)) options = { ...options, trainingType: type };
  } else if (!options.trainingType && selected?.recommendedEffectConflict) warnings.add('선택 P아이돌의 추천 효과 출처가 달라 육성 유형을 자동 확정하지 않았습니다.');
  if (options.trainingType) {
    const typePlan = trainingTypePlans[canonicalTrainingType(options.trainingType)];
    if (!typePlan) throw new RangeError('확인되지 않은 육성 유형입니다. 집중·호조·의욕·호인상·전력·강기·온존 중 선택해 주세요.');
    if (plan !== 'free' && typePlan !== plan) {
      const planName = { sense: '센스', logic: '로직', anomaly: '어노말리' }[plan];
      const allowed = { sense: '집중·호조', logic: '의욕·호인상', anomaly: '전력·강기·온존' }[plan];
      throw new RangeError(`${planName} 플랜에서는 ${allowed} 유형만 비교할 수 있습니다.`);
    }
  }
  const farming = options.objective === 'memory_farming' || options.goal === 'memory';
  if (scenario === 'hif' && ['startItemIds','availableStartItemIds','startItemSlotCount','startItemDearnessLevel'].some(key => options[key] != null)) {
    buildScenarioStartItemPlan({catalog, inventory, selectedIdol:selected, options});
  }
  if (scenario !== 'hif' && (options.hifScenarioItemPath || options.hifConsultPlan)) {
    throw new RangeError('HIF 아이템 경로와 상담 구매 방침은 HIF에서만 선택할 수 있습니다.');
  }
  if (scenario === 'hif' && (options.eventModeId || options.hifMode && options.hifMode !== 'normal')
    && [options.hifScenarioItemPath,options.hifConsultPlan].some(setting=>setting&&setting!=='none')) {
    throw new RangeError('선택한 이벤트에서 일반 HIF의 시나리오 아이템·구매 경로를 고를 수 없습니다.');
  }
  const weights = { sp: 0.5, stamina: farming ? 0.5 : 0.25, pp: farming ? 0.1 : 0.05, draw: 5, action: 8, training: 2, ...(options.comparisonWeights ?? {}) };
  const difficulty = options.difficulty ?? catalog.scenarios?.find(row => row.id === scenario)?.defaultDifficulty;
  let nonHifRoutes = [];
  if (scenario === 'hajime' && difficulty === 'pro') nonHifRoutes = hajimeProRoutes(catalog, selected?.characterId,targetAxis,options);
  if (scenario === 'hajime' && difficulty === 'master') nonHifRoutes = hajimeMasterRoutes(catalog, selected?.characterId,targetAxis,options);
  if (scenario === 'nia') {
    const eligible = eligibleNiaPresets(catalog, difficulty === 'none' || !difficulty ? 'master' : difficulty, plan);
    if (options.routePreset && options.routePreset !== 'auto' && !eligible.includes(options.routePreset)) {
      throw new RangeError('선택한 NIA 난이도·플랜에 사용할 수 없는 경로 프리셋입니다.');
    }
    const presets = options.routePreset === 'auto' && eligible.length ? eligible : [options.routePreset === 'auto' ? undefined : options.routePreset];
    nonHifRoutes = presets.flatMap(routePreset => (targetAxis ? [targetAxis] : axes)
      .map(axis => routeAssumption(catalog,scenario,axis,{...options,routePreset})));
  } else if (scenario === 'hajime' && !nonHifRoutes.length) {
    const targets = !targetAxis && (difficulty ?? 'legend') === 'legend' ? [null,...axes] : [targetAxis];
    nonHifRoutes = targets.map(axis => routeAssumption(catalog,scenario,axis,options));
  }
  let route = nonHifRoutes[0] ?? routeAssumption(catalog, scenario, targetAxis, options);
  if (!route.modelAvailable) warnings.add('선택 시나리오·난이도의 경로 모델이 없어 경로 효과 전체를 비교할 수 없습니다.');
  let hif = null, nonHifModel = null, ownedSelection = [], rental = null, rentals = [], memories = [];
  if (scenario === 'hif') {
    hif = recommendHif({ inventory, catalog, selected, plan, targetAxis, weights, options, warnings });
    if (hif) {
      route = hif.route; ownedSelection = hif.owned; rental = hif.rental;
      rentals = hif.rentalCandidates; memories = hif.memories;
    }
  } else {
    const settings = {...options, catalog, memoryEffectCache:new WeakMap()};
    const initial = hifInitialStats(selected, options);
    const idolRates = longAxes(selected?.currentGrowthRatePermil ?? selected?.growthBreakdown?.knownTotal);
    const byStartItems=new Map();
    const freeDayGroups=new Map();
    let originalItemKeys;
    const better=(length,score,previous)=>!previous || length>previous.length || length===previous.length && score>previous.score+1e-8;
    let best = null;
    const lessonRouteCount = nonHifRoutes.length;
    for (let index=0; index<nonHifRoutes.length; index++) {
      const template = scenario==='hajime' && index<lessonRouteCount
        ? hajimeFreeActivities(catalog,nonHifRoutes[index],selected,settings) : nonHifRoutes[index];
      const candidate = prepareScenarioTimeline(catalog,scenario,template,settings,selected);
      const rewards = scenarioRewardOptions({scenario,route:candidate,options:settings,catalog,plan});
      const relevantItems=freeDayGroups.get(template);
      const startPlans = scenarioStartItemAlternatives(buildScenarioStartItemPlan({catalog,inventory,options:settings,
        selectedIdol:selected,route:{...candidate,produceActions:candidate.challengeActions},axisWeights})).filter(plan=>{
          const key=plan.selectedItemIds.join('|');
          return !relevantItems || relevantItems.has(key) || !originalItemKeys.has(key);
        });
      const separateItemSupply = Object.fromEntries(['skill_enhance','p_drink_acquire'].map(kind=>[kind,
        scenario !== 'nia' || Array.isArray(settings.produceActions) || Object.hasOwn(settings.scenarioRewardBaseCounts ?? {},kind)
        || Object.hasOwn(settings.expectedCounts ?? {},kind)]));
      const firstPlace = candidate.hajimePro ? Object.values(catalog.hajimeSchedule.scoringPro.examFirstPlaceEachAxis ?? {})
        .reduce((sum,amount)=>sum+amount,0) : 0;
      const caps = scenarioStatCaps(scenario,candidate.difficulty,settings);
      const memoryOrders = new Map();
      const starts = startPlans.map(startItems => {
        const route = scenario === 'hajime' ? applyHajimeLessonLimit(candidate,startItems,settings) : candidate;
        const key = JSON.stringify(route.parameterBonusRows ?? route.gains);
        const auditionBonus = scenario === 'nia' ? niaChallengeBonusStats(settings,startItems) : null;
        let memorySettings = settings, memoryKey = key;
        if (settings.memorySelectionMode === 'stats') {
          const outsideGrowth = {}, baseline = {};
          for (const axis of axes) {
            const rate = idolRates[axis] + startItems.appliedEffects.growthRatePermil[axis];
            outsideGrowth[axis] = rate;
            const growth = route.parameterBonusRows
              ? route.parameterBonusRows.reduce((sum,row)=>sum+Math.floor(row[axis]*rate/1000),0) : route.gains[axis]*rate/1000;
            baseline[axis] = initial[axis] + route.gains[axis] + route.classGains[axis] + firstPlace + growth
              + (auditionBonus?.[axis] ?? 0) + (startItems.appliedEffects.routeStats?.[axis] ?? 0);
          }
          memorySettings = {...settings,memoryOutsideGrowth:outsideGrowth,memoryStatCaps:caps,memoryStatBaseline:baseline};
          memoryKey = JSON.stringify([key,outsideGrowth,baseline]);
        }
        let carried = memoryOrders.get(memoryKey);
        if (!carried) {
          carried = selectMemories(inventory,catalog,plan,scenario,route,axisWeights,weights,memorySettings,warnings);
          memoryOrders.set(memoryKey,carried);
        }
        const fixed = sumMemoryFixedEffects(carried);
        const upgradeTargets = route.knownUpgradeTargets + carried.filter(row => {
          const skill = row.modelEffects?.carriedSkill;
          return skill?.phase?.availableAtStart && skill.obtainable && skill.upgradeCount === 0 &&
            route.upgradeVariants.has(skill.id);
        }).length;
        const baseGrowth = {}, baseGrowthStats = {}, base = {};
        for (const axis of axes) {
          baseGrowth[axis] = idolRates[axis] + fixed.growth[axis] + startItems.appliedEffects.growthRatePermil[axis];
          baseGrowthStats[axis] = route.parameterBonusRows
            ? route.parameterBonusRows.reduce((sum,row)=>sum+Math.floor(row[axis]*baseGrowth[axis]/1000),0)
            : route.gains[axis] * baseGrowth[axis]/1000;
          base[axis] = initial[axis] + fixed.initial[axis] + route.gains[axis] + route.classGains[axis]
            + firstPlace + baseGrowthStats[axis] + (auditionBonus?.[axis] ?? 0) + (startItems.appliedEffects.routeStats?.[axis] ?? 0);
        }
        return {startItems,route,key,carried,upgradeTargets,base,baseGrowth,baseGrowthStats,auditionBonus};
      });
      for (const reward of rewards) {
        const counts = {...candidate.counts};
        for (const [kind, extra] of Object.entries(reward.actionCounts ?? {})) counts[kind] = (counts[kind] ?? 0) + extra;
        const rewardTimeline = [];
        for (const item of reward.items ?? []) {
          const action = {p_drink_acquire:'drink_acquire',skill_enhance:'upgrade'}[item.unit];
          if (!action || !reward.actionCounts?.[item.unit]) continue;
          for (const week of item.weeks) rewardTimeline.push({week, action, quantity:item.quantity/item.weeks.length,
            fromExamIndex:candidate.knownExamWeekIndices[week],basis:'planned_scenario_reward',providerId:item.id});
        }
        const profilesByStartActions = new Map();
        for (const {startItems,route:startRoute,key:lessonKey,carried,upgradeTargets,base,baseGrowth,baseGrowthStats,auditionBonus} of starts) {
          const startCounts = startItems.appliedEffects.actions ?? {};
          const startActions = startItems.appliedEffects.produceActions ?? [];
          const key = JSON.stringify([lessonKey,startCounts,startActions]);
          let profiles = profilesByStartActions.get(key);
          if (!profiles) {
            const combined = {...counts};
            const overlapsPreset = scenario==='nia' && !Array.isArray(settings.produceActions);
            for (const [kind,amount] of Object.entries(startCounts)) combined[kind] = overlapsPreset
              ? Math.max(combined[kind] ?? 0,amount) : (combined[kind] ?? 0) + amount;
            const minimumCounts = {...candidate.minimumCounts};
            for (const [kind,amount] of Object.entries(reward.actionCounts ?? {})) minimumCounts[kind]=(minimumCounts[kind] ?? 0)+amount;
            for (const [kind,amount] of Object.entries(startCounts)) minimumCounts[kind]=(minimumCounts[kind] ?? 0)+amount;
            const undatedItemActions = overlapsPreset && startActions.length ? startRoute.undatedItemActions.map(action=>{
              const alreadyDated=action.action==='acquire' ? startCounts.skill_acquire : action.action==='remove' ? startCounts.delete : 0;
              return alreadyDated ? {...action,quantity:Math.max(0,action.quantity-alreadyDated)} : action;
            }).filter(action=>action.quantity>0) : startRoute.undatedItemActions;
            const route = {...startRoute,counts:combined,minimumCounts,undatedItemActions,rewardTimeline:[...rewardTimeline,...startActions],scenarioReward:reward};
            const pool = scenarioSupportPool(inventory,catalog,route,plan,scenario,axisWeights,weights,settings,warnings);
            profiles = {route,pool};
            profilesByStartActions.set(key,profiles);
          }
          const remainingUpgradeTargets = Math.max(0,upgradeTargets - (profiles.route.counts.skill_enhance ?? 0)
            - (profiles.route.counts.delete ?? 0) - (profiles.route.counts.change ?? 0));
          const fixedUtility = (startItems.appliedEffects.initialPP + (startItems.appliedEffects.routePP ?? 0) + (reward.pp ?? 0)) * weights.pp
            + (reward.stamina ?? 0) * weights.stamina;
          const context = {base,baseGrowth,baseGrowthStats,bonusRows:startRoute.parameterBonusRows,
            gains:startRoute.gains,caps,axisWeights,remainingUpgradeTargets,separateItemSupply,fixedUtility};
          const result = compareScenarioSupports(profiles.pool,profiles.route,settings,context);
          const itemKey=startItems.selectedItemIds.join('|');
          let group=byStartItems.get(itemKey);
          if (!group) {group={};byStartItems.set(itemKey,group);}
          if (index<lessonRouteCount && better(result.length,result.firstTwo,group.firstRoute)) {
            group.firstRoute={template,length:result.length,score:result.firstTwo};
          }
          if (better(result.length,result.score,group.best)) {
            group.best={...result, pool:profiles.pool, context, template, route:{...profiles.route,scenarioStartItemPlan:startItems}, memories:carried,auditionBonus};
            if (better(result.length,result.score,best)) best=group.best;
          }
        }
      }
      if (scenario==='hajime' && index===lessonRouteCount-1) {
        // A new lesson-layout leader can have a weaker set of free days. Keep
        // the original short search's layout as well when that leader changes.
        originalItemKeys=new Set(byStartItems.keys());
        const layouts=new Map();
        for (const [key,group] of byStartItems) for (const layout of [group.best.template,group.firstRoute.template]) {
          if (!layouts.has(layout)) layouts.set(layout,new Set());
          layouts.get(layout).add(key);
        }
        for (const [layout,keys] of layouts) {
          for (const variant of hajimeFreeActivities(catalog,layout,selected,settings,true)) {
            nonHifRoutes.push(variant);
            // Keep the shared leader's alternatives for every item. Extra layouts
            // are specific to the starting items that selected them.
            if (layout!==best.template) freeDayGroups.set(variant,keys);
          }
        }
      }
    }
    if (!settings.rentalGameId) {
      // Each retained starting-item combination gets the same rental search
      // as when that combination is selected manually.
      const leaders=new Set([best,...[...byStartItems.values()].map(group=>group.best)]);
      let alternativesComplete=true;
      for (const leader of leaders) {
        const minimum=leader===best ? null : best;
        const final=compareScenarioSupports(leader.pool,leader.route,settings,leader.context,{owned:leader.owned,minimum});
        if (leader===best || better(final.length,final.score,best)) {
          best={...leader,...final};
          alternativesComplete=!minimum;
        }
      }
      if (!alternativesComplete) {
        const final=compareScenarioSupports(best.pool,best.route,settings,best.context,{owned:best.owned});
        best={...best,...final};
      }
    }
    route = best.route;
    ownedSelection = best.owned;
    rental = best.rental;
    rentals = best.rentals;
    memories = best.memories;
    nonHifModel = {...best.model, niaChallengeBonusStats:best.auditionBonus, scenarioReward:route.scenarioReward, targetAxis:route.targetAxis ?? null,
      idolInitialStats:selected?.baseStats?.baseVoDaVi || options.initialStats ? initial : null,
      idolGrowthRatePermil:selected?.currentGrowthRatePermil || selected?.growthBreakdown?.knownTotal ? idolRates : null,
      idolGrowthStatus:selected?.growthStatus ?? 'unknown',
      selections:route.selections, perAxisCounts:route.perAxis, excludedProduceActions:route.excludedProduceActions,
      routeModelAvailable:route.modelAvailable, projectedGradeVerified:false, globalOptimalityProven:false,
      examFirstPlaceRewardsAssumed:Boolean(route.hajimePro),
      search:'all_rentals_refined_on_selected_route',lessonRoutesCompared:lessonRouteCount,
      startItemFinalistsCompared:byStartItems.size,
      finalRouteRentalsCompared:settings.rentalGameId ? Number(Boolean(rental)) : best.pool.rentals.length,
      finalRouteRentalsPrunedByScoreBound:best.skippedByCeiling,
      freeActivityVariantsCompared:nonHifRoutes.length-lessonRouteCount};
  }
  if (ownedSelection.length < 5) warnings.add('조건에 맞고 레벨·돌파를 확인한 보유 서포트가 5장보다 적습니다.');
  if (memories.length < 4) {
    const eligible = memories.eligibleCount ?? 0;
    warnings.add(`반입 메모리 4장 중 ${4 - memories.length}장 부족합니다. 보유 목록 ${(inventory.memories ?? []).length}장에서 플랜·반입 조건과 확인 가능한 효과를 적용한 후보는 ${eligible}장이고, 사본·스킬${scenario === 'hif' ? '' : '·고유 효과'} 중복 제한을 적용하면 최대 ${memories.length}장을 편성할 수 있습니다.`);
  }
  if (rental) warnings.add('렌탈은 카탈로그의 풀돌·최대 레벨 비교 후보입니다. 실제 친구 목록에서 빌릴 수 있는지는 확인하지 않았습니다.');
  else if (scenario !== 'hif' && !options.rentalGameId) warnings.add('대여 슬롯 1장이 비었습니다. 선택한 플랜에서 풀돌 최대 레벨을 확인할 수 있는 대여 후보가 없습니다.');
  let rentalConstraintConflict = null;
  if (options.rentalGameId && rental?.gameId !== options.rentalGameId) {
    const requested = catalog.supportCards.find(card => card.gameId === options.rentalGameId);
    const attribute = requested && supportAxis(requested);
    if (hif && attribute && compatible(requested.plan, plan) && ['3-3', '4-2'].includes(options.deckTemplate)
      && ![hif.primary, hif.secondary].includes(attribute)) {
      rentalConstraintConflict = { reason: 'fixed_template_excludes_attribute', requestedGameId: options.rentalGameId, attribute, deckTemplate: options.deckTemplate };
      const names = { vocal: '보컬', dance: '댄스', visual: '비주얼', assist: '어시스트' };
      warnings.add(`선택한 렌탈 ${requested.name ?? requested.gameId}(${names[attribute]})를 넣을 자리가 없습니다. 고정 ${options.deckTemplate} 편성의 속성은 ${names[hif.primary]}·${names[hif.secondary]}이며, 표시된 편성은 보유 ${ownedSelection.length}장입니다.`);
    } else warnings.add('선택한 대여 카드가 현재 플랜·혼합 편성·확인된 레벨 조건에 맞지 않아 편성하지 못했습니다.');
  }
  const farmingIdols = availableOwnedIdols.filter(({ card }) => compatible(card.plan, plan)).map(({ owned, card }) => {
    const growth = idolGrowthIndex(card, owned, axisWeights);
    return { ...card, score: round(growth.score), currentGrowthRatePermil: growth.currentGrowthRatePermil, growthBreakdown: growth.growthBreakdown, growthStatus: growth.growthStatus,
      reasons: ['보유 P아이돌·선택 플랜 일치', growth.growthStatus === 'current_card' ? '보유 개화·True End를 반영한 공통 성장률 계산 사용' : '현재 성장률 미확정: 확인된 부분합만 임시 비교', '고유 카드의 실전 성능은 별도 비교 필요', '메모리 스킬의 추첨 확률 우위를 뜻하지 않음'], unknownAwakening: growth.awakening === null, raw: owned.raw ?? owned };
  }).sort((a, b) => b.score - a.score).slice(0, 8);
  const complete = inventory.complete === true && !Object.values(inventory.collectionStatus ?? {}).some(status => status !== 'complete');
  if (!complete) warnings.add('보유 정보가 완전한지 확인되지 않았습니다. 읽지 못한 카드를 미보유로 판정하지 않았습니다.');
  if (plan === 'free') warnings.add('육성 플랜을 선택하지 않아 플랜별 편성 적합성을 확정할 수 없습니다.');
  if ([...ownedSelection, ...(rental ? [rental] : []), ...memories].some(row => row.unscoredEffects > 0)) warnings.add('발동 조건·이벤트·일부 효과는 점수에 포함하지 않았습니다. 이유와 실제 운용을 함께 확인해야 합니다.');
  if (!ownedIdols.length && (inventory.idolCards ?? []).length) warnings.add('P아이돌 ID가 카탈로그와 연결되지 않았습니다. 임의로 캐릭터를 대응하지 않았습니다.');
  return {
    status: 'partial', // Neither the HIF stat model nor the other scenarios simulate battle readiness.
    selectedIdol: selected,
    sourceGuideEvidence: hif?.sourceGuideEvidence ?? null,
    supports: { owned: ownedSelection, rental, rentalCandidates: [...new Map(rentals.filter(row => row.gameId !== rental?.gameId).map(row => [row.gameId, row])).values()].slice(0, 8),
      rentalCandidateMethod: hif ? 'whole_deck_bounded_search' : 'whole_deck_additive_comparison', rentalCandidatesRequireReoptimization: true,
      ...(rentalConstraintConflict ? { rentalConstraintConflict } : {}),
      ...(hif ? { primaryAttribute: hif.primary, secondaryAttribute: hif.secondary, classAttribute: route.classAttribute, deckTemplate: hif.template, attributeCounts: hif.attributeCounts } : {}) },
    memories, farmingIdols, warnings: [...warnings],
    assumptions: [...route.notes, ...(selected ? [`육성 대상: ${selected.name ?? selected.gameId} (${selectionMode === 'automatic' ? '보유 성장률·확인된 부분합 기준 자동 선택' : '사용자 선택'}).`] : []),
      ...(hif ? ['HIF는 3+3·4+2 및 어시스트 포함 편성을 비교합니다. 일반 HIF의 전체 풀·자동 부속성 또는 제3속성 렌탈을 지정한 자동 편성에서는 4+1+1·3+2+1도 비교합니다. 단일 속성 6장은 allowSingleAttribute를 명시한 경우에만 허용합니다.',
        ...(hif.sourceGuideEvidence?.mixedAttributeCandidatesIncluded ? ['해당 아이돌 공략 모드의 자동 편성은 원문의 세 속성 혼합 편성과 추천·대안 풀의 혼합 6장도 비교합니다. 수동 3+3·4+2 설정은 그대로 유지합니다.'] : []),
        '속성별 단독 상위 12장 외에 획득·체인지·드링크를 제공하고 받는 조합을 따로 구성합니다. 렌탈 후보도 같은 경로의 편성 안에서 비교합니다.',
        '덱 평가는 성장률을 먼저 합산하고 상승기회별 내림 후 선발 상한→인계→본선 상한을 적용합니다. 단독 카드 지수의 합과는 다릅니다.',
        hif.supportPeakScenario ? '유리한 SP 성공을 전제로 상한 적용 스탯의 평가 기여와 계산 가능한 와펜 기여를 우선합니다. SP 확률은 동점 판단에 사용합니다.'
          : 'SP 보조의 유무와 명시한 PP·회복 요구를 별도로 비교합니다.',
        hif.supportPeakScenario ? '레벨로 열린 서포트 이벤트와 P아이템의 이른 획득을 가정합니다. 획득 시점을 직접 지정하면 해당 시점의 조건을 사용합니다.'
          : '서포트 이벤트는 계산 레벨의 해금 조건을 확인한 뒤 선발에서 1회 발생한다고 가정합니다. 획득 여부와 시점을 직접 지정한 P아이템 효과를 계산합니다.',
        '메모리는 시작 시 반입 초기값·성장률만 스탯에 합산합니다. 중간 합류 스킬과 조건부 HIF 어빌리티를 시작 시 효과로 바꾸지 않습니다.',
        '파라미터 성장률 자체의 별도 상한은 이 원본 모델에서 확인되지 않아 임의 비율로 자르지 않았습니다. 게임 내 상한을 검증했다는 뜻은 아닙니다.'] : ['휴리스틱 비교 지수이며 실전 시뮬레이션·전역 최적해가 아닙니다.']),
      farming ? '메모리 제작 목표는 체력·P포인트 보조 비교 가중치를 높입니다. 원하는 스킬·어빌리티의 추첨 확률을 계산한 것은 아닙니다.' : '평가 육성 목표는 수치 기여와 진행 보조를 구분해 비교합니다.',
      '미구현 효과는 성능이 0이라는 뜻이 아닙니다. 메모리의 완성 Vo/Da/Vi는 반입 초기 능력치로 더하지 않습니다.',
      '기본 메모리 선택은 게임의 noDeckDuplication과 별개로 같은 native 반입 스킬을 중복 선택하지 않습니다. 명시한 allowDuplicateMemorySkillIds만 예외입니다. 서로 다른 스킬이 공유하는 중복 불가 수치 효과는 한 번만 반영하며 메모리 렌탈은 포함하지 않습니다.'],
    ...(hif?.[beamActionAlternative] ? {[beamActionAlternative]:hif[beamActionAlternative]} : {}),
    ...(nonHifModel ? {scenarioStartItemPlan:route.scenarioStartItemPlan} : {}),
    scoreSummary: { supportLevelMode:options.supportLevelMode, method: hif ? 'hif_capped_stat_candidate_search' : 'scenario_capped_stat_candidate_search',
      ...(memories.statSelection ? {memoryStatSelection:memories.statSelection} : {}),
      ...(nonHifModel ? {nonHifModel} : {}),
      sourceGuideEvidence: hif?.sourceGuideEvidence ?? null,
      projectedStats: hif?.evaluation.cappedStats ?? (route.modelAvailable ? nonHifModel?.cappedStats : null), comparisonIndexMeaning: '서포트 기여 비교 지수이며 실제 시험 점수·최종 평가점이 아님',
      selectedIdol: selected ? { gameId: selected.gameId, name: selected.name, selectionMode, comparisonIndex: selected.comparisonIndex, growthStatus: selected.growthStatus, currentGrowthRatePermil: selected.currentGrowthRatePermil } : null,
      supportComparisonIndex: hif ? round(hif.evaluation.score - hif.baseline.score) : nonHifModel?.supportComparisonIndex ?? 0,
      ...(hif ? { hifModel: { status: 'conditional_incomplete', primaryAttribute: hif.primary, secondaryAttribute: hif.secondary, deckTemplate: hif.template,
        activityFocus:route.activityFocus??'balanced', supportPeakScenario:hif.supportPeakScenario,
        supportRating:hif.supportRating, supportProvidedActions:hif.evaluation.providedActions ?? {}, supportLinks:hif.evaluation.supportLinks ?? [],
        cardActionCounts:hif.evaluation.targetResolution?.counts ?? null, cardActionUnknowns:hif.evaluation.targetResolution?.unresolved ?? [],
        examDeckSizes:hif.evaluation.targetResolution?.examDeckSizes ?? null,
        classAttribute:route.classAttribute,classComparison:hif.classComparison,preparationComparison:hif.preparationComparison,
        primaryLessonCount:hif.fundingInputs.routeOptions.primaryLessonCount,lessonPattern:hif.fundingInputs.routeOptions.lessonPattern,
        produceActions:route.produceActions??[],excludedProduceActions:route.excludedProduceActions??[], supportActionPlan: route.supportActionPlan ?? null,
        attributeComparison: hif.attributeComparison, autoSelectionBasis: options.preparationTargets ? 'preparation_targets_then_existing_conditional_comparison'
          : hif.ratingContext ? 'capped_stats_and_acquisition_badge_evaluation_components' : hif.sourceGuideEvidence?.mode === 'guide' ? 'author_support_pool_then_current_level_capped_stat_sum' : 'equal_weight_capped_stat_sum', examScoreConsidered: false,
        examAllocationAssumedEqual: hif.route.examRewards.every(reward=>reward.allocationBasis==='equal_ratio_maximum_reference'),
        examSomeAllocationsAssumedEqual:hif.route.examRewards.some(reward=>reward.allocationBasis==='equal_ratio_maximum_reference'),
        examMaximumRewardAssumed:hif.route.examRewards.some(reward=>reward.assumedMaximum),
        examRewards:hif.evaluation.stageResults.flatMap(stage=>stage.examRewardApplications??[]),examRewardSources:hif.route.examRewardSources,
        attributeCounts: hif.attributeCounts, modeledStatTotal: hif.evaluation.score, rawStats: hif.evaluation.rawStats, cappedStats: hif.evaluation.cappedStats,
        discardedStats: hif.evaluation.wastedStats, stageResults: hif.evaluation.stageResults, initialStats: hif.context.initialStats,
        memoryInitialStats: hif.memoryInitial, memoryGrowthRatePermil: hif.memoryGrowth,
        memoryRequirements: hif.memoryRequirements,
        guideMemoryProfile: hif.guideMemoryProfile,
        sourceSupportRequirementMissingCount: hif.evaluation.sourceSupportRequirementMissingCount,
        sourceSupportRequirementGroups: hif.evaluation.sourceSupportRequirementGroups,
        memoryPreparation: hif.memoryPreparation, memorySelectionMode: options.memorySelectionMode??'guide',
        hifAbilityCopyChanges:hif.memories.hifAbilityCopyChanges??[],
        memorySelectionMethod: ({guide:'guide_roles_then_carry_stats',opening:'opening_roles_comparison_seed',stats:'carry_stats_comparison_seed'})[options.memorySelectionMode??'guide'],
        panelStatus: hif.panelStatus, statCapsVerified: hif.capVerified, statCaps: hif.context.statCaps,
        growthRateCapApplied: false, growthRateCapVerified: false, progress: hif.evaluation.progress,
        spProviderCoverage: { covered: hif.evaluation.spCovered, required: hif.evaluation.spRequired },
        modelsEvaluated: hif.modelsEvaluated, search: { method: 'bounded_beam', candidatesPerAttribute: 12, beamWidth: hif.supportPeakScenario ? 8 : 24,
          completeDraftPerEligibleRental:true, fullOwnedPoolForRentalDraft:true,
          groupedEffectStartsPerLayout: 4, includesRentalLinks:true, keepsBestGainPerStat:hif.supportPeakScenario,
          largePoolScreening:hif.searchScreening,
          preparationBeamWidth:options.preparationTargets?12:0,globalOptimalityProven: false },
        perAxisCounts: route.perAxis, selections: route.selections,
        unresolved: ['실제 SP 실패와 정상 레슨 결과', '선발시험 실제 속성별 득점 배분', '제공 스킬·고유 효과의 시험 화력', '조건부 메모리·HIF 어빌리티', '이벤트 시점과 전체 PP/체력 수지'] } } : {}),
      scenario, difficulty: route.difficulty, routeModelAvailable: route.modelAvailable, routeModelSource: route.modelSource,
      ...(route.hajimePro ? {hajimePro: route.hajimePro} : {}),
      ...(route.hajimeMaster ? {hajimeMaster: route.hajimeMaster} : {}),
      excelSupportCounts: route.excelSupportCounts ?? null, plan,
      objective: farming ? 'memory_farming' : hif?.supportPeakScenario && (options.goal === 'evaluation' || options.objective !== 'stats') ? 'evaluation' : 'stats',
      trainingType: options.trainingType ?? null, targetAttribute: targetAxis,
      weights, axisWeights, expectedCounts: route.counts, routeBaseGains: route.gains, routeClassGains: route.classGains, gameFinalScorePredicted: false },
  };
}

function projectOwnedSupportLevels(inventory, catalog) {
  const supportIndex = new Map(catalog.supportCards.map(card => [card.gameId, card]));
  const possibleUpgrades = new Map();
  let unknownCount = 0;
  const supportCards = (inventory.supportCards ?? []).map(original => {
    const owned = record(original), card = supportIndex.get(gameId(owned));
    const level = value(owned.level), uncap = value(owned.uncap ?? owned.levelLimitRank);
    const targetLevel = uncap !== null && Number.isInteger(uncap) && uncap >= 0 && uncap <= 4 ? value(card?.maxLevels?.[uncap]) : null;
    if (!card || level === null || !Number.isInteger(level) || level < 1 || targetLevel === null || !Number.isInteger(targetLevel) || level > targetLevel) {
      unknownCount++;
      return original;
    }
    if (level < targetLevel) possibleUpgrades.set(card.gameId, { gameId: card.gameId, name: card.name, nameKo: card.nameKo ?? null, nameJa: card.nameJa ?? null,
      currentLevel: level, targetLevel, uncap, imageUrl: card.imageUrl ?? null, thumbnailUrl: card.thumbnailUrl ?? null });
    return { ...original, gameId:card.gameId, level:targetLevel, ownedLevel:level, supportLevelBasis:'uncapMax' };
  });
  return { inventory:{ ...inventory, supportCards }, possibleUpgrades, unknownCount };
}

function finishLevelComparison(primary, inventory, projected, catalog, options) {
  const { possibleUpgrades, unknownCount } = projected;
  const useCap = options.supportLevelMode === 'uncapMax';
  const assumption = '보유 서포트마다 현재 돌파 단계와 레어도에서 열리는 최대 레벨을 적용합니다. 필요한 서포트 포인트는 확보한다고 가정합니다.';
  const selectedUpgrades = result => result.supports.owned.map(card => possibleUpgrades.get(card.gameId)).filter(Boolean);
  primary.supportLevelAssumption = { mode:options.supportLevelMode, unknownCount, upgrades:useCap ? selectedUpgrades(primary) : [],
    currentAccountLevelsChanged:false, supportPointCost:null };
  if (options.compareSupportUpgrades !== true) return primary;
  if (!possibleUpgrades.size) {
    primary.supportUpgradeComparison = { available: false, assumption, upgrades: [], unknownCount,
      affordability:null,supportPointsOwned:null,supportPointCost:null,levelingResourceCostVerified:false,
      scope:'current_uncap_leveling_only',currentAccountLevelsChanged:false,
      reason: unknownCount ? '현재 레벨·돌파·상한을 모두 확인한 레벨업 후보가 없습니다.' : '확인된 보유 서포트가 모두 현재 돌파의 레벨 상한에 도달했습니다.' };
    return primary;
  }
  const other = recommendCurrent({ inventory:useCap ? inventory : projected.inventory, catalog,
    options:{...options,supportLevelMode:useCap?'current':'uncapMax'} });
  const current = useCap ? other : primary, upgraded = useCap ? primary : other;
  const upgrades = selectedUpgrades(upgraded);
  const hif = current.scoreSummary.hifModel && upgraded.scoreSummary.hifModel;
  const modeledStats = result => result.scoreSummary.hifModel?.cappedStats ?? result.scoreSummary.nonHifModel?.cappedStats ?? Object.fromEntries(axes.map(axis => [axis,
    [...result.supports.owned, ...(result.supports.rental ? [result.supports.rental] : [])].reduce((sum, card) => sum + (card.statContribution?.[axis] ?? 0), 0)]));
  const currentStats = modeledStats(current), upgradedStats = modeledStats(upgraded);
  const statDelta = Object.fromEntries(axes.map(axis => [axis, round(upgradedStats[axis] - currentStats[axis])]));
  const currentIds = new Set(current.supports.owned.map(card => card.gameId));
  const upgradedIds = new Set(upgraded.supports.owned.map(card => card.gameId));
  primary.supportUpgradeComparison = { available: true, assumption, upgrades, unknownCount,
    activityFocus:options.activityFocus??'balanced',activityRouteReoptimized:false,
    affordability:null,supportPointsOwned:null,supportPointCost:null,levelingResourceCostVerified:false,
    scope:'current_uncap_leveling_only',currentAccountLevelsChanged:false,
    supports: upgraded.supports, scoreSummary: upgraded.scoreSummary, memories: upgraded.memories,
    currentSupports:current.supports, currentMemories:current.memories,
    preparationComparison:upgraded.scoreSummary.hifModel?.preparationComparison??null,
    statBasis: hif ? 'hif_capped_stats' : current.scoreSummary.nonHifModel ? 'scenario_capped_stats' : 'support_stat_contribution', currentStats, upgradedStats, statDelta,
    modeledStatTotalDelta: round(axes.reduce((sum, axis) => sum + statDelta[axis], 0)),
    addedSupportIds: [...upgradedIds].filter(id => !currentIds.has(id)), removedSupportIds: [...currentIds].filter(id => !upgradedIds.has(id)),
    warnings: upgraded.warnings, assumptions: upgraded.assumptions,
    note: '현재 선택한 활동 위주 경로에서 현재 돌파의 레벨 상한까지 육성한 편성을 다시 비교한 조건부 계산입니다. SP 보조·회복·P포인트는 능력치 차이에 합산하지 않으며 시험 점수를 예측하지 않습니다.' };
  return primary;
}

function compareHifRows(options) {
  const complete=row=>row.result.supports.owned.length+Number(Boolean(row.result.supports.rental));
  const missing=row=>options.memorySelectionMode === 'stats' ? 0 : row.result.scoreSummary.hifModel?.memoryRequirements?.missing.length??0;
  const resourceConstraintsMet=row=>{
    const progress=row.result.scoreSummary.hifModel?.progress;
    return Number(value(options.requiredSupportPP)===null||progress?.pp>=Number(options.requiredSupportPP))
      +Number(value(options.requiredSupportStamina)===null||progress?.stamina>=Number(options.requiredSupportStamina));
  };
  const covered=row=>{const p=row.result.scoreSummary.hifModel?.spProviderCoverage;return p?(p.required-p.covered):0;};
  const points=row=>row.result.scoreSummary.hifModel?.supportRating?.partialEvaluationPoints ?? 0;
  const requiredSupportsMissing=row=>row.result.scoreSummary.hifModel?.sourceSupportRequirementMissingCount ?? 0;
  const compare=(a,b)=>complete(b)-complete(a)
    ||Number(b.result.scoreSummary.hifModel?.preparationComparison?.met===true)-Number(a.result.scoreSummary.hifModel?.preparationComparison?.met===true)
    ||missing(a)-missing(b)||requiredSupportsMissing(a)-requiredSupportsMissing(b)
    ||resourceConstraintsMet(b)-resourceConstraintsMet(a)||(!a.result.scoreSummary.hifModel?.supportPeakScenario && covered(a)-covered(b))
    ||points(b)-points(a)||covered(a)-covered(b);
  return {compare,points};
}

export function startHifActivitySearch({inventory,catalog,options,focus}) {
  const finalists = new WeakMap();
  const baseOptions={...options,activityFocus:focus,compareSupportUpgrades:false,[policyFinalists]:finalists};
  const {compare,points}=compareHifRows(options);
  let row={focus,policy:{},result:recommendCurrent({inventory,catalog,options:baseOptions})};
  const model=row.result.scoreSummary.hifModel;
  const alternate=model?.supportPeakScenario && chooseHifActionStrategy({catalog,inventory,
    options:{...baseOptions,primaryLessonCount:model.primaryLessonCount,lessonPattern:model.lessonPattern},result:row.result,focus});
  const defaultPoints=points(row);
  const proposals=[];
  if(alternate) proposals.push({alternate,layout:{primary:model.primaryAttribute,secondary:model.secondaryAttribute,classAttribute:model.classAttribute,
    primaryLessonCount:model.primaryLessonCount,lessonPattern:model.lessonPattern}});
  if(row.result[beamActionAlternative]) proposals.push(row.result[beamActionAlternative]);
  const tested=new Set();
  for(const {alternate,layout} of proposals){
    const policy={hifScenarioItemPath:alternate.hifScenarioItemPath,hifConsultPlan:alternate.hifConsultPlan};
    const signature=JSON.stringify([layout,policy]);
    if(tested.has(signature)) continue;
    tested.add(signature);
    const challenger={focus,policy:{...policy,[fixedActionLayout]:layout},result:recommendCurrent({inventory,catalog,
      options:{...baseOptions,...policy,[fixedActionLayout]:layout}})};
    const alternativePoints=points(challenger);
    if(compare(challenger,row)<0)row=challenger;
    else if(row.result.scoreSummary.hifModel.actionStrategyComparison) continue;
    row.result.scoreSummary.hifModel.actionStrategyComparison={choicesConsidered:alternate.choicesConsidered,
      baselinePoints:defaultPoints,alternativePoints,alternative:policy,lessonLayout:layout,alternativeSelected:row===challenger,
      baselineSearch:model.search.largePoolScreening,alternativeSearch:challenger.result.scoreSummary.hifModel.search.largePoolScreening};
  }
  return {row,finish:()=>finishHifActivitySearch(row,inventory,catalog,options,finalists,compare,points)};
}

function finishHifActivitySearch(selected,inventory,catalog,options,finalists,compare,points) {
  const selectedFocus=selected.focus;
  const selectedModel=selected.result.scoreSummary.hifModel;
  const finalist=finalists.get(selectedModel?.supportRating);
  const policies=automaticHifPolicies(catalog,options,selected.result.scoreSummary.plan);
  if (policies && finalist?.entry.length === 6 && selectedModel.supportPeakScenario) {
    const {entry,tools}=finalist;
    const review=bestFixedDeckPolicy(entry,tools,policies);
    const layout={primary:entry.primary,secondary:entry.secondary,classAttribute:entry.route.classAttribute,
      primaryLessonCount:entry.fundingInputs.routeOptions.primaryLessonCount,lessonPattern:entry.fundingInputs.routeOptions.lessonPattern};
    if (review.policy) {
      const policy={...review.policy,[fixedActionLayout]:layout};
      const witness={owned:entry.owned.map(c=>c.gameId),rental:entry.rental.gameId};
      const challenger={focus:selectedFocus,policy,result:recommendCurrent({inventory,catalog,
        options:{...options,...policy,activityFocus:selectedFocus,compareSupportUpgrades:false,[policyWitness]:witness}})};
      if (compare(challenger,selected)<0) {
        const model=challenger.result.scoreSummary.hifModel;
        model.actionStrategyComparison={choicesConsidered:review.compared,baselinePoints:points(selected),alternativePoints:points(challenger),
          alternative:review.policy,lessonLayout:layout,alternativeSelected:true,
          baselineSearch:selectedModel.search.largePoolScreening,alternativeSearch:model.search.largePoolScreening};
        selected=challenger;
      }
    }
    selected.result.scoreSummary.hifModel.fixedDeckPolicyComparison = {policiesCompared:review.compared,replayedAlternatives:review.replayed,
      baselinePoints:selectedModel.supportRating.partialEvaluationPoints,fixedDeckPoints:review.points,
      selectedPoints:points(selected),suggestedPolicy:review.policy,selectedImprovement:selected.result.scoreSummary.hifModel!==selectedModel};
  }
  return selected;
}

// Retain the chosen layout across structured cloning of a worker's result.
export function hifActivityRowMessage(row) {
  return {row,layout:row.policy[fixedActionLayout]};
}

export function hifActivityRowFromMessage({row,layout}) {
  if(layout)row.policy[fixedActionLayout]=layout;
  return row;
}

/** Compare activity routes in stat units; never convert PP or HP to invented points. */
export function* recommendationSteps({inventory={},catalog,options={}}) {
  const mode = options.supportLevelMode ?? 'uncapMax';
  if (!['uncapMax','current'].includes(mode)) throw new RangeError('Unsupported supportLevelMode');
  options = {...options,supportLevelMode:mode};
  for (const key of ['hifConsultPlan','hifScenarioItemPath']) if (options[key]==='auto') delete options[key];
  const originalInventory = inventory;
  const projected = projectOwnedSupportLevels(originalInventory,catalog);
  if (mode === 'uncapMax') inventory = projected.inventory;
  preparationTargetsOf(options);
  if (options.classAttribute !== undefined && options.classAttribute !== 'auto' && !axes.includes(options.classAttribute)) throw new RangeError('Unsupported classAttribute');
  const requestedFocus=options.activityFocus??'auto';
  if(!['auto','balanced','consult','outing','supply_gift'].includes(requestedFocus))throw new RangeError('Unsupported activityFocus');
  if((options.scenario??'hif')!=='hif'){
    const primary=recommendCurrent({inventory,catalog,options});
    const result=finishLevelComparison(primary,originalInventory,projected,catalog,options);
    result.activityRouteComparison={status:'unsupported_scenario',requestedFocus,selectedFocus:null,candidates:[],
      note:'활동 위주 동선 비교는 HIF만 지원합니다. 初·NIA의 실제 일정을 임의로 바꾸지 않았습니다.'};
    return result;
  }
  const focuses=requestedFocus==='auto'?['consult','outing','supply_gift']:[requestedFocus];
  const {compare}=compareHifRows(options);
  const cache=new Map(),canonical=new Map();
  for(const focus of focuses){
    const route=buildHifRoute(catalog,'vocal',{...options,activityFocus:focus,compareSupportUpgrades:false,
      supportPeakScenario:options.supportPeakScenario!==false,classAttribute:options.classAttribute==='auto'?undefined:options.classAttribute});
    const consultShopping=Boolean(route.supportPeakScenario && focus==='consult' && route.selections.some(row=>row.activity==='consult'));
    const signature=JSON.stringify([route.selections.map(row=>[row.week,row.activity,row.choiceId]),consultShopping]);
    if(!cache.has(signature))cache.set(signature,focus);
    canonical.set(focus,cache.get(signature));
  }
  const searched = yield [...cache.values()].map(focus=>({focus,inventory,catalog,options}));
  const rows=focuses.map(focus=>{
    const row=searched.get(canonical.get(focus));
    if(row.focus===focus)return row;
    const result=structuredClone(row.result);
    if(result.scoreSummary.hifModel)result.scoreSummary.hifModel.activityFocus=focus;
    return {...row,focus,result};
  });
  rows.sort(compare);
  const selectedFocus=rows[0].focus;
  const selected=rows[0]=(yield selectedFocus)??rows[0];
  const peak=selected.result.scoreSummary.hifModel?.supportPeakScenario===true;
  const result=finishLevelComparison(selected.result,originalInventory,projected,catalog,{...options,...selected.policy,activityFocus:selectedFocus});
  const selectedStats=result.scoreSummary.projectedStats;
  const candidates=rows.map(({focus,policy,result:alternative})=>{
    const model=alternative.scoreSummary.hifModel;
    const ledger=buildProduceResourceLedger({result:alternative,inventory,catalog,options:{...options,...policy,activityFocus:focus,produceActions:model?.produceActions??options.produceActions}});
    return {focus,label:({consult:'상담 위주',outing:'외출 위주',supply_gift:'사시이레 위주',balanced:'기존 우선순위'})[focus],
      selected:focus===selectedFocus,supports:alternative.supports,memories:alternative.memories,scoreSummary:alternative.scoreSummary,
      preparationComparison:model?.preparationComparison??null,
      sourceGuideEvidence:alternative.sourceGuideEvidence,
      statDelta: selectedStats?Object.fromEntries(axes.map(axis=>[axis,(alternative.scoreSummary.projectedStats?.[axis]??0)-selectedStats[axis]])):null,
      activityCounts:alternative.scoreSummary.expectedCounts,selections:model?.selections??[],resourceLedger:ledger,
      resources:{supportContribution:model?.progress??null,stages:ledger.stages??[],status:ledger.status,
        actualCurrentPPKnown:false,actualCurrentHPKnown:false,ppAndHPConvertedToStatPoints:false},
      conditions:['그 주차에 가능한 활동에서 지정 활동을 우선하는 조건부 경로입니다. 모든 주차를 같은 활동으로 바꾸지 않습니다.',
        '각 경로에서 선택한 계산 레벨·메모리·공략 후보를 같은 레슨 성공·서포트 이벤트 가정으로 비교합니다.',
        model?.supportPeakScenario ? '선택한 사용처의 구매·카드 관리에는 해당 주차의 경로 P포인트와 처리 가능한 대상이 필요합니다.'
          : '상담 방문은 카드 구입·강화·삭제를 실행한 횟수가 아닙니다. 명시한 행동만 추가 발동 횟수와 비용에 반영합니다.',
        '주차가 명시된 상담 행동은 실제로 상담을 선택한 주차에서만 반영합니다. 날짜 없는 선언 행동은 그 행동 기회를 확보한다는 추가 조건입니다.',
        '현재 HP/PP·상담 제시 카드·아이템 획득 시점이 없어 실제 완주 가능성이나 최적 행동은 확정하지 않습니다.',
        ...(ledger.unknowns??[]) ]};
  });
  result.activityRouteComparison={status:'conditional_nonbattle_route_comparison',requestedFocus,selectedFocus,
    selectionBasis:peak?'완성 편성·공략 필수 카드·명시 자원 조건을 확인한 뒤, 리트 조건에서 상한 적용 스탯과 계산 가능한 와펜 기여를 비교합니다. SP 확률은 동점 판단에 사용합니다.':'완성 편성·명시 메모리 요구·명시 PP/체력 조건·SP 보조 조건을 확인한 뒤 같은 단위의 조건부 최종 능력치 합계 비교. PP·HP 환산 가중치 없음.',
    candidates,evaluatedDistinctRoutes:cache.size,compareSupportUpgradesOnSelectedRouteOnly:options.compareSupportUpgrades===true,
    optimizedActivityChoice:false,gameFinalScorePredicted:false,
    limitations:['동선별 체력·PP는 별도 수지이며 현재 잔고가 아닙니다. 미확인 가격·회복 상한·랜덤 선택은 null/범위로 유지합니다.',
      '일반 HIF 비교이며 아사리 제미의 대여·보너스를 자동 적용하지 않습니다.']};
  return result;
}

export function recommend(args) {
  const steps=recommendationSteps(args);
  const first=steps.next();
  if(first.done)return first.value;
  const searches=new Map(first.value.map(query=>[query.focus,startHifActivitySearch(query)]));
  const selected=steps.next(new Map([...searches].map(([focus,search])=>[focus,search.row]))).value;
  return steps.next(searches.get(selected)?.finish()).value;
}
