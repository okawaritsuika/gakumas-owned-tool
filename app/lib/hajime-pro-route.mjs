import { applySpLessonTotal, fitWeeklySpAxes } from './sp-lesson-counts.mjs';
const axes = ['vocal', 'dance', 'visual'];
const shortNames = { vocal: 'Vo', dance: 'Da', visual: 'Vi' };
const freeActions = { consult: 'consult', activity_supply: 'activity_supply_gift', outing: 'outing' };
const lessonCounts = ['lesson_end', 'normal_lesson_end', 'sp_lesson_end'];
const zeroAxes = () => ({ vocal: 0, dance: 0, visual: 0 });

// The four SP opportunities are lessons 2, 4, 5 and 6 in this sequence.
// A high SP roll and a perfect clear are assumptions for comparing decks.
export function hajimeProRoutes(catalog, characterId, target, options) {
  const schedule = catalog.hajimeSchedule;
  if (!schedule?.scoringPro || !schedule.pro?.length || options.eventModeId) return [];
  const menus = catalog.hajimeProMenus?.byCharacter?.[characterId];
  const weeks = menus?.weeks ?? schedule.pro.map((activities, i) => ({week: i + 1, activities}));
  const orders = [];
  for (const first of axes) {
    for (const second of axes.filter(axis => axis !== first)) {
      const third = axes.find(axis => axis !== first && axis !== second);
      orders.push([first, second, third, first, second, third, first]);
      if (!target || second === target) {
        orders.push([first, second, third, second, second, third, first]);
        orders.push([first, second, third, second, second, second, first]);
      }
    }
  }
  return orders.map(order => {
    const counts = { initial_stat: 1, initial_pp: 1, parameter_bonus: 1, max_hp: 1,
      sp_lesson_rate: 1, sp_lesson_rate_all: 1, class_work_end: 0, exam_end: 0 };
    if (menus) Object.assign(counts, { consult: 0, activity_supply_gift: 0, outing: 0, rest: 0 });
    const perAxis = Object.fromEntries(axes.map(axis => [axis, {lesson_end: 0, normal_lesson_end: 0, sp_lesson_end: 0}]));
    const gains = zeroAxes(), classGains = zeroAxes(), parameterBonusRows = [], selections = [];
    const spWeeks = Object.entries(schedule.scoringPro.lessons).filter(([, lesson]) => lesson.sp).map(([week]) => Number(week));
    const lessonWeeks = weeks.filter(({week, activities}) => schedule.scoringPro.lessons[week] &&
      (activities.includes('lesson') || activities.includes('intensive_lesson')));
    const spSlots=lessonWeeks.flatMap(({week},index)=>spWeeks.includes(week) ? [index] : []);
    const plannedSpAxes=fitWeeklySpAxes(spSlots.map(index=>order[index]),options);
    spSlots.forEach((slot,i)=>{order[slot]=plannedSpAxes[i];});
    const spBudget = Object.fromEntries(axes.map(axis => [axis, { sp_lesson_end:
      options.perAxisCounts?.[axis]?.sp_lesson_end ?? plannedSpAxes.filter(main => main === axis).length }]));
    applySpLessonTotal(spBudget, options, plannedSpAxes);
    for (const {week, activities} of weeks) {
      const lesson = schedule.scoringPro.lessons[week];
      const school = schedule.scoringPro.classes[week];
      let activity, axis;
      if (lesson && (activities.includes('lesson') || activities.includes('intensive_lesson'))) {
        axis = order[parameterBonusRows.length];
        const isSp = lesson.sp && perAxis[axis].sp_lesson_end < spBudget[axis].sp_lesson_end;
        activity = lesson.intensive ? 'intensive_lesson' : isSp ? 'sp_lesson' : 'lesson';
        const reward = lesson.intensive ?? (isSp ? lesson.sp : lesson.normal);
        const row = Object.fromEntries(axes.map(key => [key, key === axis ? reward.main : reward.eachOther]));
        parameterBonusRows.push(row);
        for (const key of axes) gains[key] += row[key];
        perAxis[axis].lesson_end++;
        if (activity === 'sp_lesson') perAxis[axis].sp_lesson_end++;
        if (activity === 'lesson') perAxis[axis].normal_lesson_end++;
      } else if (school && activities.includes('class')) {
        activity = 'class';
        axis = order[counts.class_work_end % order.length];
        counts.class_work_end++;
        classGains[axis] += school.high;
      } else if (activities.includes('hajime_mid_exam') || activities.includes('hajime_final_exam')) {
        activity = activities[0];
        counts.exam_end++;
      } else if (menus) {
        activity = Object.keys(freeActions).find(action => activities.includes(action));
        if (activity) counts[freeActions[activity]]++;
      }
      selections.push({ week, activity: activity ?? null, axis: axis ?? null });
    }
    for (const axis of axes) Object.assign(perAxis[axis], options.perAxisCounts?.[axis]);
    for (const key of lessonCounts) counts[key] = axes.reduce((sum, axis) => sum + perAxis[axis][key], 0);
    Object.assign(counts, options.expectedCounts);
    Object.assign(gains, options.baseLessonGains);
    const notes = [
      '하지메 프로 16주에서 지정한 SP 횟수와 막판 스퍼트 2회의 퍼펙트를 가정합니다. 횟수 미지정 시 SP 가능 4주를 사용합니다. 수업 3회는 높은 고정 보상을 고른 경우입니다.',
      '계산에 쓴 레슨 속성은 주차 순으로 ' + order.map(axis => shortNames[axis]).join(' → ') + '입니다. 덱의 레슨 성장률은 주차별로 합쳐 적용합니다.',
      menus ? '자유 행동은 이 아이돌에게 제시되는 메뉴에서 선택합니다. 최종 레슨 경로에서 발동 효과가 있는 장소의 주차별 대안을 비교했습니다.'
        : '이 아이돌의 자유 행동 메뉴가 확인되지 않아 해당 주차의 발동 횟수는 미확인입니다.',
      '서포트 이벤트는 해금된 고정 보상이 발생한 경우만 비교합니다. 덱 8장 등 획득 조건은 횟수가 주어졌을 때만 더합니다.',
    ];
    if (options.expectedCounts?.sp_lesson_end != null) notes.push('지정한 SP 횟수 밖의 주는 같은 주의 일반 레슨 보상과 종료 효과로 비교합니다.');
    return { difficulty: 'pro', modelAvailable: true, modelSource: 'hajime_pro_weekly_reference', counts, gains,
      classGains, perAxis, parameterBonusRows: options.baseLessonGains ? [gains] : parameterBonusRows,
      explicitCounts: options.expectedCounts ?? {}, explicitGains: Boolean(options.baseLessonGains), notes, selections,
      hajimePro: { lessonOrder: order, selections, characterMenuSource: menus?.sourceUrl ?? null } };
  });
}
