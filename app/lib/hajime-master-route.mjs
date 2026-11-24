import { applySpLessonTotal } from './sp-lesson-counts.mjs';

const axes = ['vocal', 'dance', 'visual'];
const zero = () => ({vocal:0, dance:0, visual:0});
const lessonKinds = ['lesson_end','normal_lesson_end','sp_lesson_end'];

// Gakumas Tools, 初 lesson calculator, and zuTa's MASTER observations.
// The two intensive lessons grant the indicated amount to each other axis.
const masterLessons = {
  5: {normal:60, sp:90}, 7: {intensive:180, other:90},
  11: {normal:110, sp:170}, 14: {normal:120, sp:200},
  15: {normal:150, sp:220}, 17: {intensive:310, other:145},
};
// ProduceStepLessonLevel.yaml, produce_006: [clear threshold, base PERFECT score].
// The chosen stat takes the clear score plus any remainder after a three-way split.
const legendLessons = {
  4: {lesson:[60,120], sp_lesson:[85,160]}, 7: {lesson:[90,160], sp_lesson:[120,210]},
  12: {lesson:[155,240], sp_lesson:[190,310]}, 14: {lesson:[245,380], sp_lesson:[280,460]},
  16: {lesson:[395,630], sp_lesson:[455,710]},
};

function weeklyGains(difficulty, {week, activity, axis}, limit) {
  let main, other;
  if (difficulty === 'legend') {
    const [clear, perfect] = legendLessons[week][activity];
    const bonus = perfect + limit - clear;
    other = Math.floor(bonus / 3);
    main = clear + other + bonus % 3;
  } else {
    const row = masterLessons[week];
    other = row.other ?? 0;
    main = row.intensive ?? ((activity === 'sp_lesson' ? row.sp : row.normal) + limit);
  }
  return Object.fromEntries(axes.map(key => [key, key === axis ? main : other]));
}

export function applyHajimeLessonLimit(route, selectedStart, options = {}) {
  if (!route.modelAvailable || route.explicitGains || options.eventModeId) return route;
  const legend = route.difficulty === 'legend';
  if (!legend && !route.hajimeMaster) return route;
  const table = legend ? legendLessons : masterLessons;
  const lessons = route.selections?.filter(row => Object.hasOwn(table,row.week)) ?? [];
  if (lessons.length !== Object.keys(table).length || lessons.some(row => !axes.includes(row.axis) ||
    !(legend ? Object.hasOwn(table[row.week],row.activity)
      : row.activity === 'intensive_lesson' || ['lesson','sp_lesson'].includes(row.activity)))) return route;
  const limit = selectedStart?.totals?.lessonLimitUpScore ?? 0;
  const parameterBonusRows = lessons.map(row => weeklyGains(route.difficulty, row, limit));
  const gains = zero();
  for (const row of parameterBonusRows) for (const axis of axes) gains[axis] += row[axis];
  const lessonLimitNote = legend
    ? `레전드 공개 SP 레슨 표의 기준은 챌린지 상한 +90입니다. 선택한 상한 +${limit}와 주차별 일반·SP PERFECT를 적용하고, 클리어 뒤 점수를 3등분한 나머지는 선택 속성에 더했습니다.`
    : `선택한 시작 아이템의 레슨 상한 +${limit}을 일반·SP 4주에 적용했습니다.`;
  const notes = (route.notes ?? []).filter(note => note !== route.lessonLimitNote);
  return {...route, gains, parameterBonusRows, appliedLessonLimitUpScore:limit, lessonLimitNote, notes:[...notes,lessonLimitNote]};
}

function lessonOrders(target, options) {
  const orders = new Map();
  const flexible = [0,2,3,4];
  const reserved = axes.flatMap(axis => Array(options.perAxisCounts?.[axis]?.sp_lesson_end ?? 0).fill(axis));
  const available = axes.filter(axis=>options.perAxisCounts?.[axis]?.sp_lesson_end == null);
  const total = options.expectedCounts?.sp_lesson_end;
  if (reserved.length > flexible.length || (total != null && (reserved.length > total || (!available.length && reserved.length !== total)))) {
    throw new RangeError('하지메 마스터의 속성별 SP 횟수와 총횟수를 동시에 달성할 수 없습니다.');
  }
  for (const first of target ? [target] : axes) {
    const others = axes.filter(axis => axis !== first);
    for (const cycle of [[first], [first,others[0]], [first,others[1]], [first,...others], [first,...others.toReversed()]]) {
      const order = Array.from({length:6}, (_,i) => cycle[i % cycle.length]);
      // Preserve a legal candidate for an explicit axis count even when ordinary
      // alternating patterns allocate too few of the four flexible weeks there.
      if (options.perAxisCounts) {
        const missing = [...reserved], free = [];
        for (const pos of flexible) {
          const index = missing.indexOf(order[pos]);
          if (index >= 0) missing.splice(index,1);
          else free.push(pos);
        }
        for (const axis of missing) order[free.shift()] = axis;
        const unconstrained = free.filter(pos=>available.includes(order[pos])).length;
        const extra = (total ?? 0) - reserved.length - unconstrained;
        for (const pos of free.filter(pos=>!available.includes(order[pos])).slice(0, Math.max(0,extra))) order[pos] = available[0];
      }
      orders.set(order.join(','), order);
    }
  }
  return [...orders.values()];
}

export function hajimeMasterRoutes(catalog, _characterId, target, options = {}) {
  const schedule = catalog.hajimeSchedule?.master;
  if (options.eventModeId || schedule?.length !== 18 || Object.entries(masterLessons).some(([week,lesson]) =>
    !schedule[week-1]?.includes(lesson.intensive ? 'intensive_lesson' : 'lesson'))) return [];
  const weeks = Object.keys(masterLessons).map(Number);
  const preferred = new Set(options.scenarioRewardSpWeeks ?? []);
  const spWeeks = weeks.filter(week=>masterLessons[week].sp).sort((a,b)=>Number(preferred.has(b))-Number(preferred.has(a)));
  const explicitSp = options.expectedCounts?.sp_lesson_end;
  const axisCounts = axes.map(axis => options.perAxisCounts?.[axis]?.sp_lesson_end ?? 0);
  if ([explicitSp ?? 0,...axisCounts].some(count=>!Number.isSafeInteger(count)||count<0||count>4))
    throw new RangeError('하지메 마스터 SP 레슨 횟수는 0~4의 정수로 입력해 주세요.');
  return lessonOrders(target,options).map(lessonOrder => {
    const main = week => lessonOrder[weeks.indexOf(week)];
    const perAxis = Object.fromEntries(axes.map(axis => [axis, {lesson_end:0,normal_lesson_end:0,sp_lesson_end:0}]));
    const spBudget = Object.fromEntries(axes.map(axis => [axis, {sp_lesson_end:
      options.perAxisCounts?.[axis]?.sp_lesson_end ?? spWeeks.filter(week=>main(week)===axis).length}]));
    applySpLessonTotal(spBudget, options, spWeeks.map(main));
    const selectedSpWeeks = new Set(spWeeks.filter(week => {
      const budget = spBudget[main(week)];
      if (budget.sp_lesson_end <= 0) return false;
      budget.sp_lesson_end--;
      return true;
    }));
    const counts = {initial_stat:1, initial_pp:1, parameter_bonus:1, max_hp:1, sp_lesson_rate:1, sp_lesson_rate_all:1,
      class_work_end:0, exam_end:0};
    const selections = schedule.map((menu,i) => {
      const week = i + 1;
      let activity = null, axis = null;
      if (masterLessons[week]) {
        axis = main(week);
        activity = masterLessons[week].intensive ? 'intensive_lesson' : selectedSpWeeks.has(week) ? 'sp_lesson' : 'lesson';
        perAxis[axis].lesson_end++;
        if (activity === 'lesson') perAxis[axis].normal_lesson_end++;
        if (activity === 'sp_lesson') perAxis[axis].sp_lesson_end++;
      } else if (menu.includes('class')) {
        activity = 'class';
        counts.class_work_end++;
      } else if (menu.some(key=>key === 'hajime_mid_exam' || key === 'hajime_final_exam')) {
        activity = menu.find(key=>key === 'hajime_mid_exam' || key === 'hajime_final_exam');
        counts.exam_end++;
      }
      return {week, activity, axis};
    });
    for (const axis of axes) Object.assign(perAxis[axis], options.perAxisCounts?.[axis]);
    for (const key of lessonKinds) counts[key] = axes.reduce((sum,axis)=>sum+perAxis[axis][key],0);
    Object.assign(counts, options.expectedCounts);
    const notes = [
      '하지메 마스터 18주에서 모든 레슨 PERFECT와 수업 4회 선택을 가정합니다. SP 횟수 미지정 시 가능한 4주를 SP로 비교합니다.',
      '챌린지 상한은 선택한 시작 아이템만 5·11·14·15주 주속성에 더합니다. 7·17주 추격 레슨은 세 속성에 고정 수치를 배분합니다.',
      '수업의 선택지별 파라미터와 시험 순위 보상은 합산에서 제외했습니다. 자유 행동은 아이돌별 실제 제시 메뉴가 미확인입니다.',
      '레슨 수치 출처는 Gakumas Tools의 初 레슨 계산기와 2024-12-13 ずたぽけ 마스터 실측입니다.',
    ];
    const route = applyHajimeLessonLimit({difficulty:'master', modelAvailable:true, modelSource:'hajime_master_weekly_perfect_reference',
      counts, classGains:zero(), perAxis, selections, targetAxis:target ?? null, notes, explicitCounts:options.expectedCounts ?? {},
      knownRouteCounts:{class_work_end:true,exam_end:true,lesson_end:true,normal_lesson_end:true,sp_lesson_end:true},
      hajimeMaster:{lessonOrder,selections}});
    if (!options.baseLessonGains) return route;
    const gains = {...route.gains,...options.baseLessonGains};
    return {...route, gains, parameterBonusRows:[gains], explicitGains:true,
      lessonLimitNote:null, appliedLessonLimitUpScore:null, notes:[...notes,'수동 기초 상승량을 사용해 시작 아이템의 레슨 상한은 따로 더하지 않았습니다.']};
  });
}
