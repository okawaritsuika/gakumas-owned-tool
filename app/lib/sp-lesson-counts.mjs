// Reserve explicit axis counts first. When only a total is supplied, keep
// the earliest remaining SP opportunities in the modeled lesson order.
export function fitWeeklySpAxes(planned, options) {
  const axes=['vocal','dance','visual'];
  const explicit=Object.fromEntries(axes.map(axis=>[axis,options.perAxisCounts?.[axis]?.sp_lesson_end]));
  const total=options.expectedCounts?.sp_lesson_end;
  const counts=Object.values(explicit).filter(value=>value!=null);
  const reserved=counts.reduce((sum,count)=>sum+count,0);
  if ([total,...counts].some(value=>value!=null && (!Number.isSafeInteger(value)||value<0||value>planned.length)) ||
    reserved>(total??planned.length) || total!=null && counts.length===3 && reserved!==total) {
    throw new RangeError('SP 레슨 총횟수와 속성별 횟수를 실제 주차 범위에서 지정해 주세요.');
  }
  if (!counts.length) return planned;
  const result=[...planned], unreserved=[], remaining={...explicit};
  for (const [i,axis] of result.entries()) {
    if (remaining[axis]>0) remaining[axis]--;
    else unreserved.push(i);
  }
  for (const axis of axes) for(let n=0;n<(remaining[axis]??0);n++) {
    result[unreserved.shift()]=axis;
  }
  const unbound=axes.filter(axis=>explicit[axis]==null);
  if (total!=null && unbound.length) {
    let missing=total-reserved-unreserved.filter(i=>unbound.includes(result[i])).length;
    for (const i of unreserved) if (missing>0 && !unbound.includes(result[i])) {
      result[i]=unbound[0];missing--;
    }
  }
  return result;
}

export function applySpLessonTotal(perAxis, options, plannedAxes) {
  const total = options.expectedCounts?.sp_lesson_end;
  if (!Number.isFinite(total)) return;
  const axes = Object.keys(perAxis);
  const assigned = {};
  let remaining = total;
  for (const axis of axes) {
    assigned[axis] = options.perAxisCounts?.[axis]?.sp_lesson_end ?? 0;
    remaining -= assigned[axis];
  }
  if (remaining < 0) throw new RangeError('속성별 SP 레슨 횟수가 지정한 총횟수를 초과합니다.');
  for (const axis of plannedAxes) {
    if (!remaining) break;
    if (options.perAxisCounts?.[axis]?.sp_lesson_end != null) continue;
    const count = Math.min(1, remaining, perAxis[axis].sp_lesson_end - assigned[axis]);
    assigned[axis] += count;
    remaining -= count;
  }
  for (const axis of axes) perAxis[axis].sp_lesson_end = assigned[axis];
}
