const axes = ['vocal', 'dance', 'visual'];
const short = ['vo', 'da', 'vi'];
const axisMap = values => Object.fromEntries(axes.map((axis, i) => [axis, values[i]]));
const compareId = (a, b) => String(a.id).localeCompare(String(b.id), 'en');
const compareIds = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    const order = compareId(a[i], b[i]);
    if (order) return order;
  }
  return 0;
};

// Compare only confirmed fixed effects on the selected route. The suffix bounds relax
// distinct-copy, repeated-skill and unique-effect constraints, so cannot exclude a better set.
export function selectStatMemories(rows, route, options, legal, fillSlots) {
  const aggregateEstimate = !route.parameterBonusRows && options.scenario !== 'hif';
  const stages = (options.memoryStatStages ?? [{rows:route.parameterBonusRows ?? [route.gains],
    outside:options.memoryOutsideGrowth, caps:options.memoryStatCaps, baseline:options.memoryStatBaseline}]).map(stage=>({
    ...stage, growthCache:axes.map(()=>new Map()),
    headroom:axes.map(axis=>Math.max(0,(stage.caps?.[axis]??Infinity)-(stage.baseline?.[axis]??0)))
  }));
  const headroom = stages.at(-1).headroom;
  const growthAt = (stage, axis, rate) => {
    const cache = stage.growthCache[axis];
    if (!cache.has(rate)) {
      const key = axes[axis], base = stage.outside?.[key] ?? 0;
      const value = aggregateEstimate ? route.gains[key]*rate/1000 : stage.rows.reduce((sum, row) =>
        sum + Math.floor((row[key]??0) * (base + rate) / 1000) - Math.floor((row[key]??0) * base / 1000), 0);
      cache.set(rate, value);
    }
    return cache.get(rate);
  };
  const axisValue = (vector,i) => stages.reduce((carry,stage)=>
    Math.min(stage.headroom[i],carry+growthAt(stage,i,vector[i+3])),vector[i]);
  const valueOf = vector => axes.reduce((sum, _, i) => sum + axisValue(vector,i), 0);
  const vectors = new Map();
  const unique = new Map();
  for (const row of rows) {
    const effect = row.modelEffects;
    const vector = [...short.map(axis => effect.initialStats[axis]), ...short.map(axis => effect.growthRatePermil[axis])];
    vectors.set(row, vector);
    const individual = axes.map((_,i) => stages.reduce((sum,stage)=>sum+growthAt(stage,i,vector[i+3]),vector[i]));
    row.statContribution = axisMap(individual);
    row.score = individual.reduce((sum,value)=>sum+value,0);
    unique.set(row, effect.conditionalEffects.filter(e => e.includedInInitialTotals && e.uniqueKey)
      .map(e => ({key:e.uniqueKey, index:short.indexOf(e.attribute) + (e.kind === 'growth_rate' ? 3 : 0), amount:e.valueMin})));
  }
  // For a given numeric profile and identical uniqueness constraints, at most three
  // other slots can rule out distinct carried skills. Keep the first four eligible
  // alternatives by physical ID. If a physical ID describes multiple records, it
  // could cause a second independent conflict, so retain those inventories in full.
  const duplicateAllowed = new Set((options.allowDuplicateMemorySkillIds ?? []).map(String));
  const groups = new Map();
  const distinct = new Set(rows.map(r=>r.id)).size === rows.length;
  const representatives = distinct ? [...rows].sort(compareId).filter(row => {
    const conflicts = options.scenario === 'hif' ? [] : [...row.uniqueKeys].sort();
    const key = JSON.stringify([vectors.get(row),conflicts,unique.get(row).map(e=>[e.key,e.index,e.amount]).sort()]);
    const used = groups.get(key) ?? new Set();
    const skillId = row.modelEffects.carriedSkill?.id;
    const slotKey = skillId && !duplicateAllowed.has(String(skillId)) ? 'skill:'+skillId : 'copy:'+row.id;
    if (used.has(slotKey) || used.size===4) return false;
    used.add(slotKey); groups.set(key,used);
    return true;
  }) : rows;
  const ordered = representatives.sort((a,b) => valueOf(vectors.get(b)) - valueOf(vectors.get(a)) || compareId(a,b));
  const seed = [];
  for (const row of ordered) {
    if (legal(seed,row)) seed.push(row);
    if (seed.length === 4) break;
  }
  const largest = fillSlots(seed);
  const size = largest.length;
  const zeros = () => Array(6).fill(0);
  const append = (vector, used, row) => {
    const next = vectors.get(row).map((amount,i) => vector[i]+amount);
    const entries = unique.get(row);
    if (entries.length) {
      const encountered = new Set(used);
      for (const e of entries) {
        if (encountered.has(e.key)) next[e.index] -= e.amount;
        encountered.add(e.key);
      }
    }
    return next;
  };
  const combined = chosen => {
    let vector = zeros();
    const seen = new Set();
    for (const row of chosen) {
      vector = append(vector, seen, row);
      for (const e of unique.get(row)) seen.add(e.key);
    }
    return vector;
  };
  let best = [...largest].sort(compareId), bestVector = combined(best), bestScore = valueOf(bestVector);
  // For every suffix and number of empty slots, bound each of the six numeric inputs
  // by the highest possible sum of that many remaining values, independently.
  const bounds = new Array(ordered.length+1), lowestIds = new Array(ordered.length+1);
  // A second upper bound keeps all six coordinates of a card together. With a clipped
  // axis, the final score is also bounded by its headroom plus the other axes' gains.
  const gainTotals = axes.map(axis => stages.reduce((total,stage)=>total+stage.rows.reduce((sum,row)=>sum+(row[axis]??0),0),0));
  const remainders = axes.map(axis => aggregateEstimate ? 0 : stages.reduce((total,stage)=>total+stage.rows.reduce((sum,row)=>
    sum+(((row[axis]??0)*(stage.outside?.[axis]??0))%1000+1000)%1000,0),0));
  const masks = [];
  for (let mask=0;mask<8;mask++) {
    const included = [0,1,2].filter(i=>mask & (1<<i));
    const cap = [0,1,2].filter(i=>!(mask & (1<<i))).reduce((sum,i)=>sum+headroom[i],0);
    if (!Number.isFinite(cap)) continue;
    const linear = v => included.reduce((sum,i)=>sum+1000*v[i]+gainTotals[i]*v[i+3],0);
    masks.push({linear,constant:1000*cap+included.reduce((sum,i)=>sum+remainders[i],0),
      suffix:Array.from({length:ordered.length+1},()=>Array(size+1).fill(0))});
  }
  bounds[ordered.length] = Array.from({length:size+1}, zeros);
  lowestIds[ordered.length] = [];
  for (let i=ordered.length-1; i>=0; i--) {
    const row = ordered[i], vector = vectors.get(row), rest = bounds[i+1];
    const upper = vector.slice();
    // Ignoring a negative unique bonus that another copy already provided can increase the score.
    for (const e of unique.get(row)) if (e.amount<0) upper[e.index] -= e.amount;
    bounds[i] = [zeros()];
    for (let k=1; k<=size; k++) {
      bounds[i].push(upper.map((value,axis) => Math.max(rest[k][axis],rest[k-1][axis]+value)));
    }
    for (const {linear,suffix} of masks) {
      const contribution=linear(upper);
      for (let k=1;k<=size;k++) suffix[i][k]=Math.max(suffix[i+1][k],suffix[i+1][k-1]+contribution);
    }
    lowestIds[i] = [row,...lowestIds[i+1]].sort(compareId).slice(0,size);
  }
  function visit(start, selected, vector, seen) {
    const left = size-selected.length;
    if (!left) {
      const score = valueOf(vector);
      if (score<bestScore) return;
      const sorted = [...selected].sort(compareId);
      if (score>bestScore || compareIds(sorted,best)<0) {
        best = sorted; bestVector = vector; bestScore = score;
      }
      return;
    }
    if (ordered.length-start<left) return;
    let ceiling = valueOf(vector.map((v,i) => v+bounds[start][left][i]));
    for (const {linear,constant,suffix} of masks) {
      ceiling = Math.min(ceiling,(constant+linear(vector)+suffix[start][left])/1000);
    }
    if (ceiling<bestScore || ceiling===bestScore &&
      compareIds([...selected,...lowestIds[start].slice(0,left)].sort(compareId),best)>=0) return;
    for (let i=start; i<=ordered.length-left; i++) {
      const row = ordered[i];
      if (!legal(selected,row)) continue;
      const nextSeen = unique.get(row).length ? new Set([...seen,...unique.get(row).map(e=>e.key)]) : seen;
      visit(i+1,[...selected,row],append(vector,seen,row),nextSeen);
    }
  }
  visit(0,[],zeros(),new Set());
  const growth = axes.map((_,i) => stages.reduce((sum,stage)=>sum+growthAt(stage,i,bestVector[i+3]),0));
  best.statSelection = { initialStats:axisMap(bestVector), growthRatePermil:axisMap(bestVector.slice(3)),
    routeGrowthStats:axisMap(growth), effectiveStats:axisMap(axes.map((_,i)=>axisValue(bestVector,i))),
    score:bestScore, method:'confirmed_stat_contribution_only', tieBreak:'physical_memory_id', slots:size };
  return best;
}
