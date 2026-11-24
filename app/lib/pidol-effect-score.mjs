// Index units, not predicted exam points. One extra ordinary play is worth the
// printed six-parameter attack in the reference deck. Permanent training,
// awakening and purchased customizations have already selected the input rows.
const units = {
  cost: 1, stamina: 1, fixedStamina: 1, genki: 1, fixedGenki: 1, concentration: 1, motivation: 2,
  goodConditionTurns: 3, perfectConditionTurns: 4, goodImpressionTurns: 2, fullPowerCharge: 2,
  cardUsesRemaining: 6, doubleCardEffectCards: 6, halfCostTurns: 2, doubleCostTurns: -2,
  costReduction: 1, nullifyCostCards: 3, nullifyCostActiveCards: 3, nullifyGenkiTurns: -2,
  prideTurns: 2, uneaseTurns: -2, nullifyDebuff: 2, doubleBuffCostTurns: -2, enthusiasmExtensionTurns: 2,
  'g.score': 1, 'g.cost': -1, 'g.scoreTimes': 6, 'g.genki': 1, 'g.fullPowerCharge': 2, 'g.typedCost': -1,
};
const multipliers = new Set(['concentrationMultiplier', 'goodConditionTurnsMultiplier', 'motivationMultiplier', 'enthusiasmMultiplier']);
const increasedEvents = {
  genki: 'genki', fixedGenki: 'genki', motivation: 'motivation', concentration: 'concentration',
  goodConditionTurns: 'goodConditionTurns', goodImpressionTurns: 'goodImpressionTurns', fullPowerCharge: 'fullPowerCharge',
};
const commandUnits = {
  drawCard: 3, moveRandomToHand: 3, moveRandomToTopOfDeck: 2, moveSelectedToTopOfDeck: 2,
  addCardToTopOfDeck: 2, addCardToDeck: 1, holdSelected: 3, holdCard: 3, moveHeldCardsToHand: 3,
  useRandomCardFree: 6, useSelectedFree: 6, useRandomFree: 6, useSelected: 3,
  removeDebuffs: 2, upgradeHand: 4, upgradeRandomCardInHand: 2,
};
const buffUnits = {
  setScoreBuff: 12, setScoreDebuff: -12, setGoodImpressionTurnsBuff: 8, setGoodImpressionTurnsEffectBuff: 8,
  setGoodImpressionTurnsTimesBuff: 4, setConcentrationBuff: 8, setConcentrationEffectBuff: 8,
  setConcentrationAdditionBuff: 1, setMotivationBuff: 8, setMotivationAdditionBuff: 2,
  setGoodConditionTurnsBuff: 8, setFullPowerEffectBuff: 12, setStrengthEffectBuff: 12,
  setEnthusiasmBuff: 8, setEnthusiasmBonus: 2, setFullPowerChargeBuff: 8,
};
const stateLabels = {
  goodConditionTurns: '호조', perfectConditionTurns: '절호조', concentration: '집중', motivation: '의욕', genki: '원기',
  goodImpressionTurns: '호인상', fullPowerCharge: '전력치', cumulativeFullPowerCharge: '누적 전력치',
  stamina: '체력', turnsRemaining: '남은 턴', turnsElapsed: '경과 턴', turnCardsUsed: '턴 내 사용 수',
  cardsUsed: '사용 카드', isFullPower: '전력 상태', isStrength: '강기 상태', isPreservation: '온존 상태',
  usedCardBaseId: '지정 카드 사용', strengthTimes: '강기 전환 횟수', preservationTimes: '온존 전환 횟수',
  concentrationDelta: '집중 증가량', goodConditionTurnsDelta: '호조 증가량', goodImpressionTurnsDelta: '호인상 증가량',
};
const phaseLabels = {
  startOfStage: '레슨 시작', startOfTurn: '턴 시작', afterStartOfTurn: '턴 시작 후', beforeStartOfTurn: '턴 시작 전',
  endOfTurn: '턴 종료', turn: '후속 턴', everyTurn: '매 턴', beforeCardUsed: '스킬 사용 전', cardUsed: '스킬 사용 시', afterCardUsed: '스킬 사용 후',
  activeCardUsed: '액티브 사용 시', afterActiveCardUsed: '액티브 사용 후', mentalCardUsed: '멘탈 사용 시',
  afterMentalCardUsed: '멘탈 사용 후', cardRemoved: '카드 제외', concentrationIncreased: '집중 증가',
  motivationIncreased: '의욕 증가', genkiIncreased: '원기 증가', fullPowerChargeIncreased: '전력치 증가',
  staminaDecreased: '체력 감소', buffCostConsumed: '버프 소비', cardMovedToHand: '손패로 회수',
  stanceChanged: '태세 전환', stanceValueChanged: '태세 단계 변경', goodConditionTurnsIncreased: '호조 증가',
  goodImpressionTurnsIncreased: '호인상 증가', prestage: '레슨 전',
};
const scopeLegend = 'hajime-legend';
const list = v => Array.isArray(v) ? v : [];
const nameOf = r => r?.name ?? r?.nameJa ?? r?.id ?? '';
const unsupported = key => { throw new Error(String(key)); };
const collectionFilters = new Set(['deck', 'discarded', 'hand', 'held', 'removed', 'active', 'mental', 'SR', 'SSR', 'L', 'pIdol', 'processCost']);
const stanceNames = new Set(['strength', 'strength2', 'preservation', 'preservation2', 'fullPower', 'none', 'leisure']);

function reference(plan, index, column, legend) {
  const prepared = [0, 4, legend ? 8 : 16];
  const g = plan === 'sense' ? prepared[index] : 0;
  const c = plan === 'sense' ? prepared[column] : 0;
  const tier = column, state = plan !== 'anomaly' ? 'none' : index === 2 ? 'fullPower' : ['none', 'preservation', 'strength'][tier];
  return {
    tier, index, plan, goodConditionTurns: g, concentration: c, perfectConditionTurns: 0, motivation: plan === 'logic' ? prepared[index] : 0,
    goodImpressionTurns: plan === 'logic' ? [0, 8, 28][column] : 0, genki: [0, 8, 40][index],
    fullPowerCharge: plan === 'anomaly' ? prepared[column] : 0, cumulativeFullPowerCharge: [0, 10, 30][column],
    enthusiasm: plan === 'anomaly' ? prepared[index] : 0, stamina: [28, 18, 10][index], maxStamina: 30,
    stance: state, prevStance: ['none', 'strength', 'fullPower'][index], isFullPower: plan === 'anomaly' && index === 2,
    isStrength: state === 'strength', isPreservation: state === 'preservation',
    strengthTimes: tier, preservationTimes: index, stanceChangedTimes: tier + index, fullPowerTimes: tier,
    turnsElapsed: [1, 4, 7][index], turnsRemaining: [8, 4, 1][index], cardsUsed: [1, 4, 9][column],
    activeCardsUsed: column + 1, turnCardsUsed: column + 1, concentrationDelta: prepared[column], genkiDelta: [0, 6, 12][column],
    goodConditionTurnsDelta: prepared[index], goodImpressionTurnsDelta: prepared[column], consumedStamina: [0, 6, 12][index],
    consumedGenki: [0, 5, 15][column], consumedGoodImpressionTurns: [0, 2, 5][index], movedCardBaseId: 0,
    usedCardBaseId: 0, cardSourceType: 'pIdol', cardRarity: 'SSR', parentPhase: 'processCost', effectCounter: column,
    isDirectEffect: true, pool: [], used: null, opportunities: {}, concentrationMultiplier: 1,
    goodConditionTurnsMultiplier: 1, motivationMultiplier: 1, enthusiasmMultiplier: 1,
  };
}

function hasRole(row, node) {
  const key = node?.name;
  if (!(key in units) && key !== 'score' && !stanceNames.has(key)) return unsupported(key ?? '효과 태그');
  return !!row?.roles?.includes(key);
}

function selectedBy(n, row) {
  if (typeof n === 'string') n = { type: 'identifier', name: n };
  if (n?.type === 'number') return row?.base === n.value || row?.id === n.value;
  if (n?.type === 'identifier') {
    if (n.name === 'all') return true;
    if (n.name === 'this') return !!row?.unique;
    if (!collectionFilters.has(n.name)) return unsupported(n.name);
    return [row?.pile, row?.type, row?.rarity, row?.source].includes(n.name);
  }
  if (n?.type === 'call') {
    if (n.name === 'effect') return hasRole(row, n.args?.[0]);
    if (!['baseId', 'id'].includes(n.name) || n.args?.[0]?.type !== 'number') return unsupported(n.name);
    return row?.[n.name === 'baseId' ? 'base' : 'id'] === n.args[0].value;
  }
  if (n?.type === 'binary' && ['&', '|'].includes(n.op)) {
    const left = selectedBy(n.left, row), right = selectedBy(n.right, row);
    return n.op === '&' ? left && right : left || right;
  }
  return unsupported(n?.name ?? n?.op ?? '카드 대상');
}

function cardRoles(def) {
  const roles = new Set();
  for (const group of list(def.actions)) {
    for (const action of list(group.actions)) {
      if (action.type === 'assignment') roles.add(action.lhs);
      if (action.name === 'setStance') roles.add(action.args?.[0]?.name?.replace(/2$/, ''));
    }
  }
  return [...roles];
}

// Availability of hand/deck/stance triggers is a comparison input. No account
// observations or source tier labels participate in either reference profile.
function expression(n, s) {
  if (!n) return unsupported('빈 수식');
  if (n.type === 'number') return n.value;
  if (n.type === 'identifier') {
    if (n.name in s) return s[n.name];
    if (n.name in units || n.name === 'turn') return 0;
    if (stanceNames.has(n.name) || collectionFilters.has(n.name)) return n.name;
    return unsupported(n.name);
  }
  if (n.type === 'unary') {
    const value = expression(n.operand, s);
    if (n.op === '!') return !value;
    if (n.op === '-') return -value;
  }
  if (n.type === 'call') {
    if (n.name === 'countCards') return s.pool.filter(card => selectedBy(n.target, card)).reduce((a, r) => a + r.count, 0);
    if (n.name === 'effectCounter') return s.effectCounter;
    if (n.name === 'cardHasEffect') return hasRole(s.used, n.args?.[0]);
    if (['effect', 'baseId', 'id'].includes(n.name)) return selectedBy(n, s.used);
  }
  if (n.type === 'binary' || n.type === 'comparison') {
    const a = expression(n.left, s), b = expression(n.right, s);
    switch (n.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b ? a / b : unsupported('0으로 나누는 효과식');
      case '%': return a % b;
      case '&': return Boolean(a && b);
      case '|': return Boolean(a || b);
      case '==': return a === b;
      case '!=': return a !== b;
      case '>': return a > b;
      case '>=': return a >= b;
      case '<': return a < b;
      case '<=': return a <= b;
    }
  }
  return unsupported(n.name ?? n.op ?? n.type);
}

function matches(group, s) {
  return list(group.conditions).every(n => expression(n, s)) && (!group.filter || selectedBy(group.filter, s.used)) &&
    (!group.targets?.length || group.targets.some(target => s.pool.some(r => r.count > 0 && selectedBy(target, r))));
}

function noteFor(node) {
  if (!node) return '';
  if (node.type === 'identifier') return stateLabels[node.name] ?? '';
  if (node.type === 'binary') return [noteFor(node.left), noteFor(node.right)].filter(Boolean).join('·');
  if (node.type !== 'comparison') return '';
  const key = node.left?.name, label = stateLabels[key], num = node.right?.value;
  if (key === 'usedCardBaseId') return '지정 카드 사용';
  const unit = key === 'goodConditionTurns' || key === 'perfectConditionTurns' ? '턴' : '';
  if (label && Number.isFinite(num)) return label + ' ' + num + unit + ({ '>=': ' 이상', '<=': ' 이하', '==': '', '>': ' 초과', '<': ' 미만' }[node.op] ?? '');
  return label ?? '';
}

function roleValue(a, s) {
  if (a.type === 'assignment') {
    const key = a.lhs, rhs = expression(a.rhs, s), before = s[key] ?? 0;
    let after;
    switch (a.op) {
      case '=': after = rhs; break;
      case '+=': after = before + rhs; break;
      case '-=': after = before - rhs; break;
      case '*=': after = before * rhs; break;
      case '/=': after = before / rhs; break;
      default: return unsupported(a.op);
    }
    if (!Number.isFinite(after)) return unsupported(key);
    if (key === 'motivation' && after > before && s.motivationBuffs) {
      for (const buff of s.motivationBuffs) if (s.turnsElapsed < buff.until) after += buff.amount;
    }
    if (key === 'fullPowerCharge' && after > before) s.cumulativeFullPowerCharge += after - before;
    if (key === 'score') {
      const focus = s.concentration * s.concentrationMultiplier + s.enthusiasm * s.enthusiasmMultiplier;
      const buff = s.goodConditionTurns > 0 ? 1 + (0.5 + (s.perfectConditionTurns > 0 ? s.goodConditionTurns * 0.1 : 0)) * s.goodConditionTurnsMultiplier : 1;
      const amount = after - before + (s.playGrowth?.['g.score'] ?? 0);
      const hits = 1 + (s.extraHits ?? 0);
      s.extraHits = 0;
      const value = amount > 0 ? hits * (amount + focus) * buff * (s.scoreFactor ?? 1) : amount;
      if (s.pathMode) s.parameter += value > 0 ? Math.ceil(value - 1e-8) : 0;
      return value;
    }
    if (key === 'turnsRemaining') {
      // A turn at the end has no automatic value. The probes have no payable
      // card / an unbuffed 6-cost-3 attack / a buffed 6+4-cost-3 attack.
      return (after - before) * [0, 3, 12][s.index];
    }
    if (s.metamorphosis?.buffs.includes(key) && after > before) {
      const mod = s.lateHalf ? s.metamorphosis.lateBuffDelta : s.metamorphosis.earlyBuffDelta;
      after = before + Math.max(0, after - before + mod);
    }
    if (after > before && increasedEvents[key]) {
      const e = increasedEvents[key] + 'Increased';
      s.opportunities[e] = (s.opportunities[e] ?? 0) + 1;
      s[increasedEvents[key] + 'Delta'] = after - before;
    }
    if (['stamina', 'fixedStamina', 'cost'].includes(key) && after < before &&
      (key !== 'cost' || before - after > s.genki)) s.opportunities.staminaDecreased = (s.opportunities.staminaDecreased ?? 0) + 1;
    if (increasedEvents[key] && key !== 'genki' && key !== 'fixedGenki' && after < before) s.opportunities.buffCostConsumed = (s.opportunities.buffCostConsumed ?? 0) + 1;
    if (key === 'genki' && after > before) after += s.motivation * s.motivationMultiplier + (s.playGrowth?.['g.genki'] ?? 0);
    s[key] = after;
    if (s.pathMode && key === 'cost' && after < before) {
      const expense = before - after;
      s.stamina -= Math.max(0, expense - s.genki);
      s.genki = Math.max(0, s.genki - expense);
    }
    if (key === 'fixedStamina') s.stamina = Math.max(0, Math.min(s.maxStamina, s.stamina + after - before));
    if (key === 'fixedGenki') s.genki += after - before;
    if (after > before && increasedEvents[key]) s.onGain?.(increasedEvents[key] + 'Increased');
    if (key === 'effectCounter' || multipliers.has(key)) return 0;
    if (key === 'g.scoreByGenki') return (after - before) * s.genki;
    if (key in units) return (after - before) * units[key];
    return unsupported(key);
  }
  const cmd = a.name;
  if (cmd === 'setStance') {
    let next = a.args?.[0]?.name;
    if (!stanceNames.has(next)) return unsupported(cmd);
    if ((s.stance==='fullPower' && next!=='none') || (s.stance==='leisure' && next.startsWith('preservation'))) return 0;
    const family = next.replace(/2$/,'');
    const entered = s.stance.replace(/2$/,'') !== family;
    if (!entered && ['strength','preservation'].includes(family)) next=family+'2';
    const changed = s.stance !== next;
    if (changed) {
      if (entered) {
        s.opportunities.stanceChanged = (s.opportunities.stanceChanged ?? 0) + 1;
        if (['strength','preservation','fullPower'].includes(family)) s[family+'Times']++;
        s.stanceChangedTimes++;
      }
      s.opportunities.stanceValueChanged = (s.opportunities.stanceValueChanged ?? 0) + 1;
    }
    s.stance = next; s.isStrength = next.startsWith('strength'); s.isPreservation = next.startsWith('preservation'); s.isFullPower = next === 'fullPower';
    return changed ? 3 : 0;
  }
  if (cmd in commandUnits) {
    if (a.target && !s.pool.some(r => r.count > 0 && selectedBy(a.target, r))) return 0;
    if (cmd === 'useRandomCardFree' && a.target?.type === 'call' && ['id','baseId'].includes(a.target.name)) {
      s.playFree?.(a.target);
      return 0;
    }
    const quantity = ['drawCard', 'removeDebuffs', 'moveRandomToTopOfDeck','moveSelectedToTopOfDeck'].includes(cmd) && a.args?.length ? expression(a.args[0], s) : 1;
    if (['addCardToTopOfDeck','addCardToDeck'].includes(cmd) && a.args?.[0]?.type === 'number') {
      const id = a.args[0].value;
      s.pool = [...s.pool, { base: id, id, pile: 'deck', count: 1 }];
    }
    if (cmd === 'holdCard' && a.args?.[0]?.type === 'number' && !s.pool.some(r => r.count > 0 && r.base === a.args[0].value)) return 0;
    if (cmd === 'moveHeldCardsToHand' && !s.pool.some(r => r.pile === 'held' && r.count > 0)) return 0;
    if (['drawCard', 'moveRandomToHand', 'moveHeldCardsToHand'].includes(cmd)) s.opportunities.cardMovedToHand = (s.opportunities.cardMovedToHand ?? 0) + quantity;
    return commandUnits[cmd] * quantity;
  }
  if (cmd in buffUnits) {
    const amount = expression(a.args?.[0], s), duration = a.args?.length > 1 ? expression(a.args[1], s) : 2;
    if (cmd === 'setMotivationAdditionBuff' && s.motivationBuffs) {
      s.motivationBuffs.push({amount, until:s.turnsElapsed + duration});
      return 0;
    }
    return buffUnits[cmd] * amount * Math.min(2, duration);
  }
  return unsupported(cmd ?? a.type);
}

function apply(group, s) {
  if (!matches(group, s)) return 0;
  const namedTargets = group.targets?.every(target=>target.type==='number' || target.name==='baseId' || target.name==='id')
    ? s.pool.filter(r=>r.unique && group.targets.some(t=>selectedBy(t,r))) : [];
  return list(group.actions).reduce((sum,a)=>{
    if (!namedTargets.length || !['g.score','g.scoreTimes','g.genki'].includes(a.lhs)) return sum + roleValue(a,s);
    for (const target of namedTargets) {
      target.growth ??= {};
      roleValue(a,target.growth);
    }
    return sum;
  },0);
}

// Delayed and event-driven effects are compared over up to two eligible
// opportunities. Durations, limits, and trigger predicates belong to the
// group, not to every child action. The caller supplies the reference state.
function later(group, base) {
  const s = { ...base, onGain:null, playFree:null, motivationBuffs:base.motivationBuffs?.slice(),
    opportunities: { ...base.opportunities } };
  if (group.phase && !(group.phase in phaseLabels)) return unsupported(group.phase);
  const scheduled = list(group.conditions).find(x => x.type === 'comparison' && x.op === '==' &&
    x.left?.name === 'turnsElapsed' && Number.isFinite(x.right?.value))?.right.value;
  if (scheduled !== undefined && (scheduled < base.turnsElapsed || scheduled >= base.turnsElapsed + base.turnsRemaining)) return 0;
  const phase = group.phase;
  // In the public definitions "turn" with no delay means *next* turn;
  // delay:2 on that same phase means three turns after play.
  const offset = (group.delay ?? 0) + (phase === 'turn' ? 1 : 0);
  const calendar = !phase || atStart.has(phase) || ['turn', 'everyTurn', 'endOfTurn', 'prestage'].includes(phase);
  const observable = calendar ? 2 : (s.opportunities[phase] ?? 0);
  const slots = Math.min(group.ttl ?? 2, observable, scheduled !== undefined || ['startOfStage', 'prestage'].includes(phase) ? 1 : 2,
    Math.max(0, s.turnsRemaining - offset));
  let value = 0, fired = 0;
  for (let n = 0; n < slots && fired < (group.limit ?? slots); n++) {
    s.turnsElapsed = scheduled ?? base.turnsElapsed + offset + n;
    s.turnsRemaining = base.turnsRemaining - (s.turnsElapsed - base.turnsElapsed);
    if (s.metamorphosis) {
      s.lateHalf = s.turnsElapsed > s.turnsRemaining;
      s.scoreFactor = s.lateHalf ? s.metamorphosis.lateScoreMultiplier : s.metamorphosis.earlyScoreMultiplier;
    }
    if (group.phase) s.effectCounter = base.effectCounter + n;
    if (!matches(group, s)) continue;
    fired++;
    value += apply(group, s);
    for (const child of list(group.effects)) value += later(child, s);
  }
  return value;
}

const atUse = new Set(['beforeCardUsed','activeCardUsed', 'afterActiveCardUsed', 'cardUsed', 'afterCardUsed', 'mentalCardUsed', 'afterMentalCardUsed']);
const atStart = new Set(['startOfTurn', 'afterStartOfTurn', 'beforeStartOfTurn', 'startOfStage']);
const trackedPhases = new Set(['cardMovedToHand','motivationIncreased','goodImpressionTurnsIncreased']);
const trackedGroup = (owner,group) => trackedPhases.has(group.phase) || owner.replayOncePerTurn ||
  owner.effects.some(g=>g.phase===group.phase && g.actions?.some(a=>a.lhs==='effectCounter'));

// Count only emitted events. Every owner has its own counter. Sibling
// predicates (e.g. increment and test the fifth event) see its pre-event value.
function trackDirectEffects(s, owners, add, trace) {
  const counters = new Map(), uses = new Map(), lastReplayTurn = new Map();
  function dispatch(phase, direct) {
    const outer = {effectCounter:s.effectCounter, isDirectEffect:s.isDirectEffect};
    const ready = [];
    for (const owner of owners) {
      s.effectCounter = counters.get(owner) ?? 0;
      s.isDirectEffect = direct;
      for (const group of owner.effects) {
        if (group.phase !== phase || !trackedGroup(owner,group) || (uses.get(group) ?? 0) >= (group.limit ?? Infinity) || !matches(group,s)) continue;
        const isReplay = owner.replayOncePerTurn && group.actions.some(a => a.name === 'useRandomCardFree');
        if (isReplay && lastReplayTurn.get(group) === s.turnsElapsed) continue;
        ready.push({owner,group,isReplay});
      }
    }
    for (const {owner,group,isReplay} of ready) {
      uses.set(group,(uses.get(group) ?? 0) + 1);
      if (isReplay) lastReplayTurn.set(group,s.turnsElapsed);
      s.isDirectEffect = phase === 'cardMovedToHand';
      s.effectCounter = counters.get(owner) ?? 0;
      const previousMultiplier = s.motivationMultiplier;
      for (const action of group.actions) {
        add(roleValue(action,s));
        if (action.lhs === 'effectCounter') counters.set(owner,s.effectCounter);
      }
      s.motivationMultiplier = previousMultiplier;
      if (trace) trace.push({kind:group.actions.every(a=>a.lhs==='effectCounter') ? 'counter' : 'trigger',
        turn:s.turnsElapsed, source:owner.id, phase, counter:counters.get(owner) ?? 0,
        motivation:s.motivation,genki:s.genki,stamina:s.stamina});
    }
    Object.assign(s,outer);
  }
  s.onGain = phase => dispatch(phase,s.isDirectEffect);
  return dispatch;
}

function valueAt(skills, item, base, card, followup) {
  const s = { ...base, motivationBuffs:[], cardUsesRemaining:1 }, used = new Map(), nextTurnActions=[];
  // Synthetic role counts only. Named IDs occur exclusively when a selected
  // outfit supplies the card or an explicit action adds it to the reference.
  const generic = { base: null, id: null, rarity: 'R', source: 'produce', roles: ['score'], type: 'active' };
  s.pool = [...skills.map(d => ({
    id: d.id, base: d.publicBaseId, unique: true, pile: 'deck',
    type: d.type, rarity: card?.rarity, source: 'pIdol', roles: cardRoles(d), count: 1
  })),
  ...Object.entries({ deck: 4, discarded: s.index, held: s.plan === 'anomaly' ? s.tier : 0, removed: [0, 3, 12][s.tier] }).map(
    ([pile, count]) => ({ ...generic, pile, count })), { ...generic, pile: 'hand', count: 1 }];
  let sum = 0;
  const dispatch = trackDirectEffects(s,[item,...skills],x=>{sum+=x;});
  function event(phase) {
    s.opportunities[phase] = (s.opportunities[phase] ?? 0) + 1;
    const previous = s.isDirectEffect;
    s.isDirectEffect = false;
    dispatch(phase,false);
    for (const group of item.effects) {
      if (group.phase !== phase || trackedGroup(item,group) || (used.get(group) ?? 0) >= Math.min(2, group.limit ?? 2) || !matches(group, s)) continue;
      used.set(group, (used.get(group) ?? 0) + 1);
      sum += apply(group, s);
      for (const child of list(group.effects)) sum += later(child, s);
    }
    s.isDirectEffect = previous;
  }
  function playEvents(type, after) {
    if(!after)event('beforeCardUsed');
    event(after ? 'afterCardUsed' : 'cardUsed');
    event((after ? 'after' + (type === 'mental' ? 'Mental' : 'Active') : (type === 'mental' ? 'mental' : 'active')) + 'CardUsed');
  }
  event('startOfStage'); event('beforeStartOfTurn'); event('startOfTurn'); event('afterStartOfTurn');
  function draw(entry) {
    entry.pile = 'hand';
    s.movedCardBaseId = entry.base;
    dispatch('cardMovedToHand',true);
    s.movedCardBaseId = null;
  }
  for (const entry of s.pool.filter(r=>r.unique)) draw(entry);
  s.playFree = target => {
    const entry = s.pool.find(r=>r.unique && r.pile==='removed' && selectedBy(target,r));
    const def = entry && skills.find(d=>d.id===entry.id);
    if (def) play(def,true);
  };
  function play(def, free) {
    const canPay = list(def.cost).every(group => list(group.actions).every(a => a.type !== 'assignment' || a.op !== '-=' ||
      !['goodConditionTurns', 'concentration', 'fullPowerCharge', 'goodImpressionTurns', 'motivation', 'genki'].includes(a.lhs) || s[a.lhs] >= expression(a.rhs, s)));
    if ((!free && !canPay) || !list(def.conditions).every(g => matches(g, s))) return;
    const outer = {used:s.used,usedCardBaseId:s.usedCardBaseId,isDirectEffect:s.isDirectEffect,playGrowth:s.playGrowth,extraHits:s.extraHits,
      cardRarity:s.cardRarity, cardSourceType:s.cardSourceType};
    s.isDirectEffect = true;
    s.usedCardBaseId = def.publicBaseId ?? null;
    s.used = s.pool.find(r => r.unique && r.id === def.id);
    s.cardRarity=s.used.rarity; s.cardSourceType=s.used.source;
    s.playGrowth = s.used.growth;
    s.extraHits = s.playGrowth?.['g.scoreTimes'] ?? 0;
    if (!free) s.cardUsesRemaining--;
    if (!free) for (const group of def.cost) sum += apply(group, s);
    playEvents(def.type, false);
    s.used.pile = 'playing';
    for (const group of def.actions) {
      if (group.phase) {
        if (group.phase==='turn' && !group.delay && group.limit===1 && group.actions.some(a=>a.name==='setStance') &&
          s.turnsElapsed===base.turnsElapsed) nextTurnActions.push(group);
        else sum += later(group, s);
        continue;
      }
      if (!matches(group, s)) continue;
      sum += apply(group, s);
      for (const child of list(group.effects)) sum += later(child, s);
    }
    s.used.pile = def.limit === 1 ? 'removed' : 'discarded';
    s.cardsUsed++; s.turnCardsUsed++;
    if (def.type==='active') s.activeCardsUsed++;
    if (s.used.pile === 'removed') s.opportunities.cardRemoved = (s.opportunities.cardRemoved ?? 0) + 1;
    playEvents(def.type, true);
    for (const group of def.effects) if (!trackedGroup(def,group)) sum += later(group, s);
    if (def.mechanics?.kind === 'growSelectedOnFullPower' && s.isFullPower && s.fullPowerCharge >= def.mechanics.minCharge) {
      const m = def.mechanics;
      const targets = s.pool.filter(r => r.pile !== m.exclude).reduce((n, r) => n + r.count, 0);
      const net = m.scoreGain + m.hitGain * 6 - m.costGain;
      sum += Math.min(targets, m.maxCards) * net * Math.min(1, m.limit);
    }
    s.concentrationMultiplier = s.goodConditionTurnsMultiplier = s.motivationMultiplier = s.enthusiasmMultiplier = 1;
    // Guaranteed initial draw improves access; a selected limit-lift adds a
    // repeat opportunity only in the prepared reference, not on every use.
    if (!free && def.forceInitialHand) sum += 2;
    if (!free && def.purchasedLimitLift && s.tier === 2) sum += 6;
    Object.assign(s,outer);
    return true;
  }
  const extraUse = d => d.actions.some(g=>!g.phase && !g.conditions?.length &&
    g.actions.some(a=>a.lhs==='cardUsesRemaining' && a.op==='+=' && a.rhs?.value>0));
  const ordered = [...skills].sort((a,b)=>Number(extraUse(b))-Number(extraUse(a)));
  const unplayed = new Set(ordered);
  function playAvailable() {
    for (const def of unplayed) {
      if (s.cardUsesRemaining < 1) break;
      if (play(def,false)) unplayed.delete(def);
    }
  }
  playAvailable();
  // This additional opportunity has no intrinsic score in the outfit index.
  // When the starting deck is explicitly transformed, its verified target can
  // satisfy the item; other named combo cards are never assumed present.
  s.usedCardBaseId = followup;
  s.used = { ...generic, base: s.usedCardBaseId, id: null, roles: followup === 24 ? ['goodConditionTurns', 'score'] : ['score'] };
  s.cardSourceType = 'produce'; s.cardRarity = 'R';
  if (skills.length===1 || s.cardUsesRemaining>0) {
    playEvents('active', false);
    s.cardsUsed++; s.activeCardsUsed++; s.turnCardsUsed++;
    playEvents('active', true);
  }
  dispatch('endOfTurn',false);
  if (s.turnsRemaining > 1) {
    s.turnsElapsed++; s.turnsRemaining--;
    s.cardUsesRemaining=1; s.turnCardsUsed=0;
    for (const r of s.pool) if (r.unique && r.pile==='hand') r.pile='discarded';
    event('beforeStartOfTurn'); event('startOfTurn'); event('afterStartOfTurn');
    for (const group of nextTurnActions) sum+=apply(group,s);
    // For multi-unique comparisons only, the second turn supplies the still
    // unplayed unique. Never put a played, removed card back in the hand.
    if (skills.length>1) {
      s.goodConditionTurns=Math.max(0,s.goodConditionTurns-1);
      for (const def of unplayed) {
        const r=s.pool.find(r=>r.unique && r.id===def.id);
        if (r.pile==='discarded') draw(r);
      }
      playAvailable();
    }
    dispatch('everyTurn',false); dispatch('endOfTurn',false);
    s.turnsElapsed--; s.turnsRemaining++;
  }
  for (const group of item.effects) if (!atStart.has(group.phase) && !atUse.has(group.phase) && !trackedGroup(item,group)) sum += later(group, s);
  return sum;
}

function checkedDefinition(row, item = false) {
  const d = row?.definition;
  if (!d || !Array.isArray(d.effects) || (!item && (!Array.isArray(d.actions) || !Array.isArray(d.cost) || !Array.isArray(d.conditions)))) return unsupported(nameOf(row) + ' 효과 정의');
  if (!(item ? d.effects.length : d.actions.length || d.effects.length)) return unsupported(nameOf(row) + ' 효과 동작');
  // Validate operations even when a prerequisite happens to fail on all nine
  // probes. Unknown primitives must not accidentally look like known zeroes.
  const check = g => {
    if (g.phase && !(g.phase in phaseLabels)) unsupported(g.phase);
    const p = reference('sense', 1, 1, false);
    p.pool = [{ id: 1, base: 1, pile: 'hand', count: 1, roles: ['score'] }];
    for (const n of list(g.conditions)) expression(n, p);
    if (g.filter) selectedBy(g.filter, null);
    for (const target of list(g.targets)) selectedBy(target, null);
    for (const a of list(g.actions)) {
      if (a.target) selectedBy(a.target, null);
      roleValue(a, p);
    }
    for (const child of list(g.effects)) check(child);
  };
  for (const field of ['cost', 'actions', 'effects', 'conditions']) list(d[field]).forEach(check);
  return d;
}

function applyCustom(skills, options, rows) {
  return skills.map((d, index) => {
    const result = { ...d };
    for (const option of options.filter(o => o.skillId === rows[index].id)) {
      const level = option.level ?? option.count ?? 1;
      if (!list(rows[index].customizationIds).includes(option.id) || !option.levels?.some(x => x.level === level)) unsupported(nameOf(option) + ' 적용 개조 정의');
      const custom = option.patches;
      if (!custom) unsupported(nameOf(option) + ' 개조 효과');
      for (const field of ['cost', 'actions', 'effects', 'conditions']) {
        const groups = [...list(result[field])];
        for (const patch of list(custom[field]).filter(p => (p.level ?? 1) === level)) {
          if (patch.op === 'append') { groups.push(patch.effect); continue; }
          const i = groups.findIndex(g => g.anchor === patch.anchor);
          if (patch.op !== 'patch' || i < 0) unsupported(nameOf(option) + ' 개조 대상');
          groups[i] = { ...groups[i], ...patch.delta };
        }
        result[field] = groups;
      }
      if (custom.forceInitialHand) result.forceInitialHand = true;
      if (String(custom.limit) === '0') result.purchasedLimitLift = true;
    }
    return result;
  });
}

function conditionLine(skills, item, customizations) {
  for (const s of skills) for (const group of s.conditions) {
    const words = list(group.conditions).map(noteFor).filter(Boolean);
    if (words.length) return '고유 사용 전 ' + words.join('·') + ' 필요';
  }
  if (customizations.length) return '실제 선택한 고유 개조 반영 · 추가 효과는 남은 행동에 따라 달라집니다.';
  const readsCharge = n => !!n && (n.name === 'cumulativeFullPowerCharge' || readsCharge(n.left) || readsCharge(n.right));
  if (skills.some(d => d.actions.some(g => g.phase === 'turn' && !g.delay &&
    g.actions.some(a => a.lhs === 'score' && readsCharge(a.rhs))))) {
    return '다음 턴 누적 전력치로 득점 · 마지막 턴 타격 없음';
  }
  for (const g of item.effects) {
    const note = list(g.conditions).map(noteFor).filter(Boolean).join('·');
    if (note || g.phase) return [phaseLabels[g.phase], note, g.limit ? '최대 ' + g.limit + '회' : ''].filter(Boolean).join(' · ');
  }
  return '고유 스킬·아이템 효과를 함께 반영합니다.';
}

function legendSupported(skills, item, plan, scope) {
  if (scope !== scopeLegend || plan !== 'sense') return false;
  const senseStats = new Set(['score', 'goodConditionTurns', 'concentration', 'genki', 'fixedGenki', 'cardUsesRemaining',
    'stamina', 'fixedStamina', 'cost', 'concentrationMultiplier', 'goodConditionTurnsMultiplier', 'turnsRemaining']);
  const supports = g => !g.effects?.length && !g.filter && !g.targets?.length && !g.delay &&
    (!g.phase || atStart.has(g.phase) || atUse.has(g.phase) || g.phase === 'endOfTurn') &&
    list(g.actions).every(a => a.type === 'assignment' && senseStats.has(a.lhs)) &&
    list(g.conditions).every(q => q.type === 'comparison' && ['concentration', 'goodConditionTurns', 'usedCardBaseId'].includes(q.left?.name));
  return skills.every(s => !s.effects.length && s.conditions.every(supports) && s.actions.every(g => !g.phase && supports(g))) && item.effects.every(supports);
}

function followupCard(scope, card) {
  if (card?.referenceFollowupCardId) return card.referenceFollowupCardId;
  // This training grant changes a LEGEND starter to 軽い足取り+, supplying
  // the card for the single follow-up in the published reference workload.
  const grants = list(card?.specialTrainingStages).filter(x => x.rank <= card.specialTrainingRank).flatMap(x => list(x.skillGrants));
  const campusSaki = grants.some(x => x.produceSkillId === 'p_idol_skill-common-p_trigger-produce_start-no_description-produce_card_change_upgrade-p_rd-p_ability-p_idol_skill-i_card-hski-3-008-03-001');
  return scope === scopeLegend && campusSaki ? 24 : 0;
}

// An evidence path is a ledger of supplied draws and plays. It never chooses
// a card, generates an unobserved draw, or searches for a play sequence.
function pathLedger(definitions, item, external, path, plan, includeOutfit) {
  const turnCount = path.turnCount;
  if (!Number.isSafeInteger(turnCount) || turnCount < 1 || !Array.isArray(path.events)) unsupported('경로 턴/행동');
  const trace = [], pending = [], fired = new Map();
  const s = {...reference(plan,0,0,false), pathMode:true, parameter:0, motivationBuffs:[], cumulativeFullPowerCharge:0,
    turnCardsUsed:0, cardsUsed:0, activeCardsUsed:0, turnsElapsed:0, isDirectEffect:false};
  for (const [k,v] of Object.entries(path.initial ?? {})) {
    if (!['genki','motivation','stamina','maxStamina','concentration','goodConditionTurns','goodImpressionTurns',
      'fullPowerCharge','cumulativeFullPowerCharge','enthusiasm'].includes(k) || !Number.isFinite(v) || v < 0) unsupported('경로 시작 상태 ' + k);
    s[k] = v;
  }
  const rows = [...(includeOutfit ? definitions : []),...external];
  s.pool = rows.flatMap(def => Array.from({length:def.copies ?? 1},()=>({
    key:def.key, id:def.id, base:def.publicBaseId, unique:definitions.includes(def), pile:'deck', count:1,
    type:def.type, source:definitions.includes(def) ? 'pIdol' : 'produce', roles:cardRoles(def),def
  })));
  const owners = [...(includeOutfit ? [item] : []), ...rows];
  const ledgerStats = new Set(['score','cost','stamina','fixedStamina','genki','fixedGenki','motivation','cardUsesRemaining',
    'goodImpressionTurns','fullPowerCharge','motivationMultiplier','concentration','goodConditionTurns','perfectConditionTurns','effectCounter']);
  const ledgerCommands = new Set(['drawCard','setMotivationAdditionBuff','useRandomCardFree']);
  const ledgerPhases = new Set([...trackedPhases,...atStart,...atUse,'endOfTurn','turn']);
  function checkGroup(group) {
    if (group.phase && !ledgerPhases.has(group.phase)) unsupported('경로 발동 시점 '+group.phase);
    for (const a of list(group.actions)) {
      if (a.type==='assignment' ? !ledgerStats.has(a.lhs) : !ledgerCommands.has(a.name)) unsupported('경로 동작 '+(a.lhs ?? a.name));
    }
    for (const child of list(group.effects)) checkGroup(child);
  }
  for (const owner of owners) {
    if (owner.mechanics) unsupported('경로 복합 효과 '+owner.mechanics.kind);
    for (const field of ['actions','cost','effects']) list(owner[field]).forEach(checkGroup);
  }
  const dispatch = trackDirectEffects(s,owners,()=>{},trace);
  const log = (kind, details) => trace.push({turn:s.turnsElapsed,kind,...details});
  function run(group, direct, source) {
    // Reject unimplemented path primitives explicitly. The ordinary role
    // index can still be calculated for these outfits.
    const previous = {isDirectEffect:s.isDirectEffect, motivationMultiplier:s.motivationMultiplier};
    s.isDirectEffect=direct;
    if (!matches(group,s)) { Object.assign(s,previous); return; }
    for (const action of group.actions ?? []) {
      if (action.type === 'assignment') {
        roleValue(action,s);
      } else if (action.name === 'drawCard') {
        const count=action.args?.length ? expression(action.args[0],s) : 1;
        s.drawsRemaining+=count;
        log('drawAvailable',{source,count});
      } else if (['setMotivationAdditionBuff','useRandomCardFree'].includes(action.name)) {
        roleValue(action,s);
      } else unsupported('경로 동작 '+action.name);
    }
    Object.assign(s,previous);
    for (const child of list(group.effects)) schedule(child,direct,source);
  }
  function schedule(group,direct,source) {
    if (group.phase !== 'turn' || group.limit !== 1) unsupported('경로 예약 '+group.phase);
    pending.push({turn:s.turnsElapsed + 1 + (group.delay ?? 0),group,direct,source});
  }
  function event(phase) {
    dispatch(phase,false);
    for (const owner of owners) for (const group of owner.effects) {
      if (group.phase !== phase || trackedGroup(owner,group) || !matches(group,s) || (fired.get(group) ?? 0) >= (group.limit ?? Infinity)) continue;
      fired.set(group,(fired.get(group) ?? 0)+1);
      run(group,false,owner.id);
      log('trigger',{source:owner.id,phase});
    }
  }
  function play(entry,free) {
    const d = entry.def;
    const unpayable = !free && d.cost.some(g => list(g.actions).some(a => {
      if (a.type !== 'assignment' || a.op !== '-=') return false;
      const amount = expression(a.rhs,s);
      if (a.lhs === 'cost') return s.genki + s.stamina < amount;
      return (a.lhs === 'fixedStamina' ? s.stamina : s[a.lhs]) < amount;
    }));
    const reason = !free && s.cardUsesRemaining < 1 ? '사용권 없음' :
      !d.conditions.every(g=>matches(g,s)) ? '사용 전 조건 미충족' : unpayable ? '비용 부족' : '';
    if (reason) { log('skipped',{id:entry.key,reason}); return; }
    const previous = {used:s.used,usedCardBaseId:s.usedCardBaseId};
    s.used=entry; s.usedCardBaseId=entry.base;
    log(free ? 'replay' : 'play',{id:entry.key});
    event('beforeCardUsed');
    if (!free) {
      for (const group of d.cost) run(group,true,d.id);
      s.cardUsesRemaining--;
    }
    entry.pile='playing'; // A replay cannot count its own gain while outside the removed pile.
    event('cardUsed'); event(d.type==='active' ? 'activeCardUsed' : 'mentalCardUsed');
    for (const group of d.actions) {
      if (group.phase) schedule(group,true,d.id);
      else run(group,true,d.id);
    }
    entry.pile=d.limit ? 'removed' : 'discarded';
    s.cardsUsed++; s.turnCardsUsed++;
    if (d.type==='active') s.activeCardsUsed++;
    event('afterCardUsed'); event(d.type==='active' ? 'afterActiveCardUsed' : 'afterMentalCardUsed');
    log('stateAfterPlay',{id:entry.key,parameter:s.parameter,genki:s.genki,motivation:s.motivation,stamina:s.stamina});
    Object.assign(s,previous);
  }
  s.playFree=target=>{
    const entry = s.pool.find(r=>r.pile==='removed' && selectedBy(target,r));
    if (entry) play(entry,true);
  };
  let lastTurn=0;
  for (const e of path.events) {
    if (!Number.isInteger(e.turn) || e.turn<1 || e.turn<lastTurn || e.turn>turnCount || !['draw','play'].includes(e.kind) ||
      ![...definitions,...external].some(d=>d.key===e.id)) unsupported('경로 행동/카드 '+e.id);
    lastTurn=e.turn;
  }
  event('startOfStage');
  function processEntry(e) {
    if (!includeOutfit && definitions.some(d=>d.key===e.id)) return;
    const possible=s.pool.filter(r=>r.key===e.id);
    const entry=e.kind==='draw' ? possible.find(r=>r.pile==='deck') ?? possible.find(r=>r.pile==='discarded') :
      possible.find(r=>r.pile==='hand');
    if (!entry) { log('skipped',{id:e.id,reason:e.kind==='play' ? '손패에 없음' : '이동 가능한 카드 없음'}); return; }
    if (e.kind==='play') { play(entry,false); return; }
    if (s.drawsRemaining<1) { log('skipped',{id:e.id,reason:'확인된 드로 수 초과'}); return; }
    s.drawsRemaining--;
    entry.pile='hand'; s.movedCardBaseId=entry.base;
    log('draw',{id:e.id}); dispatch('cardMovedToHand',true); s.movedCardBaseId=null;
  }
  for (let turn=1;turn<=turnCount;turn++) {
    s.turnsElapsed=turn; s.turnsRemaining=turnCount-turn+1; s.cardUsesRemaining=1; s.turnCardsUsed=0; s.drawsRemaining=3;
    event('beforeStartOfTurn'); event('startOfTurn');
    const entries=path.events.filter(e=>e.turn===turn);
    let index=0;
    while(index<entries.length && entries[index].kind==='draw' && index<3) processEntry(entries[index++]);
    event('afterStartOfTurn');
    for (const entry of pending.filter(x=>x.turn===turn)) run(entry.group,entry.direct,entry.source);
    for (;index<entries.length;index++) processEntry(entries[index]);
    event('endOfTurn');
    for (const entry of s.pool) if (entry.pile==='hand') entry.pile='discarded';
  }
  return {parameter:s.parameter,genki:s.genki,motivation:s.motivation,stamina:s.stamina,trace};
}

function comparePath(ds,item,path,plan) {
  try {
    const external=list(path.cards).map(row=>{
      const d=checkedDefinition(row);
      const copies=row.count ?? 1;
      if (!Number.isSafeInteger(copies) || copies<1 || copies>99) unsupported('경로 카드 매수');
      return {...d,key:row.id,publicBaseId:row.publicBaseId ?? d.id,copies};
    });
    const withOutfit=pathLedger(ds,item,external,path,plan,true);
    const withoutOutfit=pathLedger(ds,item,external,path,plan,false);
    return {withOutfit,withoutOutfit,marginalParameter:withOutfit.parameter-withoutOutfit.parameter,missing:''};
  } catch(error) {
    return {marginalParameter:null,missing:error.message};
  }
}

export function scoreIdolEffects({ skills = [], item, customizations = [], scope, plan, card, referencePath } = {}) {
  const names = [...skills, item].filter(Boolean).map(r => nameOf(r) + (r.text ? ' ' + String(r.text).replace(/\s+/g, ' ').slice(0, 110) : ''));
  const known = names.join(' / ');
  try {
    if (!skills.length) unsupported('고유 스킬 ID 또는 현재 강화 단계');
    if (!item) unsupported('고유 P아이템 ID 또는 현재 개화 단계');
    for (const option of customizations) if (!skills.some(row => row.id === option.skillId)) unsupported('선택 개조의 대상 고유 스킬');
    const ds = applyCustom(skills.map(s => {
      if (s.mechanics && s.mechanics.kind !== 'growSelectedOnFullPower') unsupported(s.mechanics.kind);
      const d = checkedDefinition(s);
      return { ...d, key:s.id, replayOncePerTurn:/再演[\s\S]*ターン内1回/.test(s.text),
        publicBaseId: s.publicBaseId ?? (s.upgradeCount === 0 ? d.id : null), mechanics: s.mechanics };
    }), customizations, skills);
    if (customizations.length) for (const definition of ds) checkedDefinition({ name: definition.name, definition });
    const it = checkedDefinition(item, true);
    if (item.mechanics && item.mechanics.kind !== 'metamorphosis') unsupported(item.mechanics.kind);
    const scenario = legendSupported(ds, it, plan, scope);
    const followup = followupCard(scope, card);
    let total = 0;
    for (let row = 0; row < 3; row++)for (let col = 0; col < 3; col++) {
      // All outfits compared in a given scope retain the same starting-state
      // grid, including those whose complex effect roles use the common rule.
      const state = reference(plan, row, col, scope === scopeLegend && plan === 'sense');
      if (item.mechanics) {
        state.metamorphosis = item.mechanics;
        state.lateHalf = state.turnsElapsed > state.turnsRemaining;
        state.scoreFactor = state.lateHalf ? item.mechanics.lateScoreMultiplier : item.mechanics.earlyScoreMultiplier;
        // Value the kit-wide output modifier on one separate basic follow-up,
        // as well as on the actual early/late unique-card hits below.
        total += 6 * (state.scoreFactor - 1);
      }
      total += valueAt(ds, it, state, card, followup);
    }
    if (!Number.isFinite(total)) unsupported('효과 수치');
    let condition = conditionLine(ds, it, customizations);
    if (scope === scopeLegend && plan === 'sense' && ds.some(d => d.conditions.some(g => list(g.conditions).some(
      q => q.type === 'comparison' && q.left?.name === 'goodConditionTurns' && q.op === '>=' && q.right?.value === 8)))) {
      condition += ' · 시작 호조 8턴인 비교 상태 ⅓';
    }
    if (followup === 24) condition = '고유 사용 전 호조 4 이상 · 변환된 가벼운 발걸음 사용 후 아이템 1회 가정';
    if (item.mechanics?.kind === 'metamorphosis') condition = '전반에는 버프 증가·득점 감소, 후반에는 득점 증가·버프 감소';
    const repeated = ds.find(d=>d.replayOncePerTurn);
    if (repeated) {
      const trigger = repeated.effects.find(g=>g.actions.some(a=>a.name==='useRandomCardFree'));
      const modulo = trigger?.conditions.find(n=>n.left?.op==='%')?.left.right?.value;
      if (modulo) condition = '제외 후 직접 '+(phaseLabels[trigger.phase] ?? trigger.phase)+' '+modulo+'회마다 재연 · 환산 카드는 실제 사용 시 득점';
    }
    return { value: Math.round(total / 9), basis: scenario ? 'scenario' : 'common', condition, known, missing: '',
      ...(referencePath ? {path:comparePath(ds,it,referencePath,plan)} : {}) };
  } catch (error) {
    return { value: null, basis: 'missing', condition: '효과 확인 필요', known, missing: error.message };
  }
}
