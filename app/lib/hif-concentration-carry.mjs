import SkillCards from './vendor/gakumas-data/data/skillCards.js';

const byId = rows => new Map((rows ?? []).map(row => [row.id, row]));
const sources = [
  { title: 'もりし · 일반 HIF 호조 덱의 사양별 존재감 우선도', url: 'https://morishimemo.com/gakumasu-memo-39' },
  { title: '공개 게임 마스터 · 고유 카드와 P아이템 발동 조건', url: 'https://github.com/vertesan/gakumasu-diff' },
  { title: '공개 카드 효과 정의', url: 'https://github.com/gakumas-tools/gakumas-tools' },
];
const cache = new WeakMap();
function indices(catalog) {
  if (cache.has(catalog)) return cache.get(catalog);
  const graph = catalog.multiCreatorGuidance?.nativeUniqueGraph ?? {};
  const variants = rows => new Map((rows ?? []).map(row => [(row.gameId ?? row.id) + ':' + row.upgradeCount, row]));
  const result = { cards: variants(catalog.skillCards), uniqueCards: variants(graph.ProduceCard),
    items: byId(graph.ProduceItem), itemEffects: byId(graph.ProduceItemEffect), enchants: byId(graph.ProduceExamStatusEnchant),
    triggers: byId(graph.ProduceExamTrigger), effects: byId(graph.ProduceExamEffect), customIds: new Map() };
  for (const row of catalog.customizations ?? []) {
    if (row.identityStatus !== 'exact_reference_intersection') continue;
    for (const id of [row.gameId, ...(row.equivalentGameIds ?? [])]) result.customIds.set(id, String(row.internalId));
  }
  cache.set(catalog, result);
  return result;
}

function stagesThrough(stages, rank) {
  if (!Array.isArray(stages) || !Number.isInteger(rank) || rank < 0 || rank > stages.length) return null;
  const passed = stages.filter(s => s.rank > 0 && s.rank <= rank);
  return new Set(passed.map(s => s.rank)).size === rank && passed.length === rank ? passed : null;
}

// These are narrowly identified native trigger/effect families. A different
// condition, delayed subeffect, field multiplier or card search stays unknown.
function readIdol(card, owned, index) {
  const state = { gameId: card?.gameId, itemId: null, itemName: null, itemVerified: false,
    recurring: null, late: null, openingConcentration: 0, startWithGood: 0, otherConditionalSupply: false, unique: [], notes: [] };
  if (!card?.uniqueIds) return state;
  const growth = stagesThrough(card.awakeningStages, owned?.potentialRank ?? owned?.awakeningRank ?? owned?.awakening);
  if (growth && !card.uniqueIds.beforeLevelLimitProduceItemId && !card.uniqueIds.afterLevelLimitProduceItemId) {
    const upgraded = growth.some(s => s.effectTypes?.includes('IdolCardPotentialEffectType_InitialProduceItemChange'));
    const item = index.items.get(card.uniqueIds[upgraded ? 'afterProduceItemId' : 'beforeProduceItemId']);
    if (item && item.originIdolCardId === card.gameId && !item.produceTriggerId && !item.produceTriggerIds?.length) {
      state.itemId = item.id; state.itemName = item.name; state.itemVerified = true;
      for (const id of item.produceItemEffectIds ?? []) {
        const branch = index.itemEffects.get(id), enchant = index.enchants.get(branch?.produceExamStatusEnchantId);
        const trigger = index.triggers.get(enchant?.produceExamTriggerId);
        if (branch?.effectType !== 'ProduceItemEffectType_ExamStatusEnchant' || !trigger) continue;
        const simpleTrigger = trigger.phaseTypes?.length === 1 && !trigger.produceCardSearchId &&
          !trigger.fieldStatusProduceCardSearchIds?.length && !trigger.fieldStatusCheckTypes?.length;
        const phase = trigger.phaseTypes[0]?.replace('ProduceExamPhaseType_', '');
        const fields = trigger.fieldStatusTypes ?? [], values = trigger.fieldStatusValues ?? [];
        for (const effectId of enchant.produceExamEffectIds ?? []) {
          const effect = index.effects.get(effectId);
          if (!effect) continue;
          const givesFocus = ['ProduceExamEffectType_ExamLessonBuff','ProduceExamEffectType_ExamLessonBuffDependParameterBuff',
            'ProduceExamEffectType_ExamLessonBuffPerSearchCount'].includes(effect.effectType);
          if (!simpleTrigger) { if (givesFocus) state.otherConditionalSupply = true; continue; }
          if (phase === 'ExamPlayCountInterval' && fields.length === 1 && fields[0] === 'ProduceExamFieldStatusType_LessonBuffUp' &&
              values[0] > 0 && trigger.phaseValues?.[0] > 0 && effect.effectType === 'ProduceExamEffectType_ExamLessonBuffReduce') {
            state.recurring = { threshold: values[0], interval: trigger.phaseValues[0], cost: effect.effectValue1 };
            state.notes.push(`고유 P아이템 ${item.name}의 발동 조건은 집중 ${values[0]} 이상입니다. 카드 ${trigger.phaseValues[0]}회 간격으로 집중 ${effect.effectValue1}을 소비합니다.`);
          }
          if (phase === 'StartPlay' && fields.length === 1 && fields[0] === 'ProduceExamFieldStatusType_RemainingTurn' &&
              values[0] > 0 && effect.effectType === 'ProduceExamEffectType_ExamLessonBuffDependParameterBuff' && effect.effectValue1 > 0) {
            state.late = { turns: values[0], permil: effect.effectValue1, limit: branch.effectCount };
            state.notes.push(`고유 P아이템 ${item.name}의 발동 시점은 마지막 ${values[0]}턴의 턴 시작입니다. 그때 남은 호조의 ${effect.effectValue1 / 10}%만큼 집중이 늘어납니다. 그 전 턴의 집중은 따로 확보해야 합니다.`);
            continue;
          }
          if (phase === 'ExamStartExam' && !fields.length && !trigger.phaseValues?.length && effect.effectType === 'ProduceExamEffectType_ExamLessonBuff') {
            state.openingConcentration += effect.effectValue1;
            state.notes.push(`고유 P아이템 ${item.name}의 효과로 시험 시작에 집중이 ${effect.effectValue1} 증가합니다.`);
            continue;
          }
          if (phase === 'StartPlay' && fields.length === 1 && fields[0] === 'ProduceExamFieldStatusType_ParameterBuff' &&
              !values.length && effect.effectType === 'ProduceExamEffectType_ExamLessonBuff') {
            state.startWithGood = Math.max(state.startWithGood,effect.effectValue1);
            state.notes.push(`턴 시작에 호조가 남아 있으면 ${item.name} 효과로 집중이 ${effect.effectValue1} 증가합니다.`);
            continue;
          }
          if (givesFocus) state.otherConditionalSupply = true;
        }
      }
    }
  }
  const training = stagesThrough(card.specialTrainingStages, owned?.levelLimitRank ?? owned?.uncap ?? owned?.specialTrainingRank);
  if (!training) return state;
  for (const [field, effect] of [['produceCardId','ProduceCardUpgrade'], ['secondProduceCardId','SecondProduceCardUpgrade']]) {
    const id = card.uniqueIds[field];
    if (!id) continue;
    const rank = training.filter(stage => stage.effectTypes?.includes('IdolCardLevelLimitEffectType_' + effect)).length;
    const row = index.uniqueCards.get(id + ':' + rank);
    if (!row) continue;
    const effects = (row.playEffects ?? []).filter(e => !e.produceExamTriggerId).map(e => index.effects.get(e.produceExamEffectId));
    const amount = type => effects.filter(e => e?.effectType === 'ProduceExamEffectType_' + type).reduce((n,e) => n + e.effectValue1, 0);
    const gain = amount('ExamLessonBuff'), ratio = amount('ExamLessonBuffDependParameterBuff');
    const good = effects.filter(e => e?.effectType === 'ProduceExamEffectType_ExamParameterBuff').reduce((n,e) => n + e.effectTurn, 0);
    const cost = row.costType === 'ExamCostType_ExamLessonBuff' ? row.costValue : 0;
    if (!gain && !ratio && !good && !cost) continue;
    const once = row.playMovePositionType === 'ProduceCardMovePositionType_Lost';
    state.unique.push({ id, name: row.name, gain, ratio, cost, once, good, useCondition: row.playProduceExamTriggerId || null });
    if (gain || ratio) state.notes.push(`고유 카드 ${row.name} 사용 시 ${ratio ? '현재 호조의 ' + ratio / 10 + '%' : gain}만큼 집중을 얻습니다.${once ? ' 레슨 중 1회입니다.' : ''}`);
    if (cost) {
      const trigger = index.triggers.get(row.playProduceExamTriggerId);
      const requirement = trigger?.fieldStatusTypes?.length === 1 && trigger.fieldStatusTypes[0] === 'ProduceExamFieldStatusType_ParameterBuffUp' &&
        trigger.fieldStatusValues?.length === 1 ? ` 호조가 ${trigger.fieldStatusValues[0]}턴 이상일 때 사용합니다.` :
        row.playProduceExamTriggerId ? ' 카드 사용 조건도 확인하세요.' : '';
      state.notes.push(`고유 카드 ${row.name}의 사용 비용은 집중 ${cost}입니다.${requirement}`);
    }
  }
  return state;
}

export function readHifIdolConcentration(catalog, card, owned) {
  return readIdol(card, owned, indices(catalog));
}

function directGain(def, field) {
  return (def.actions ?? []).filter(group => !group.phase && !group.conditions?.length)
    .flatMap(group => group.actions ?? []).filter(a => a.type === 'assignment' && a.lhs === field && a.op === '+=' && a.rhs?.type === 'number')
    .reduce((sum, a) => sum + a.rhs.value, 0);
}

function inspect(memory, index) {
  const s = memory?.modelEffects?.carriedSkill, upgrade = s?.upgrade ?? s?.upgradeCount;
  const row = index.cards.get(s?.id + ':' + upgrade);
  // Some inventory normalization paths insert an empty list for missing input.
  // Only an explicitly available, resolved ability list establishes a true zero.
  const abilitiesRead = !memory?.raw || Array.isArray(memory.raw.abilities ?? memory.raw.memoryAbilities);
  const initialStats = abilitiesRead && memory?.modelEffects?.abilityEffectsResolved === true
    ? memory.modelEffects.initialStats : null;
  const out = { memoryId: memory?.id ?? null, gameId: s?.id ?? null, name: s?.name?.trim() || row?.nameKo?.trim() || s?.id,
    upgrade: Number.isInteger(upgrade) ? upgrade : null, phase: s?.phase?.code ?? null,
    initialStats, gain: 0, good: 0, cost: 0, goodCost: 0, once: null, isSupplier: false, candidatePriority: 0, verified: false };
  if (!s || s.obtainable !== true || !s.variantKnown || ![1,2].includes(out.phase) ||
      !Number.isInteger(upgrade) || !row || row.identityStatus !== 'exact' || !Array.isArray(s.customizes)) return out;
  const def = SkillCards.getById(row.internalId);
  if (!def || def.name !== row.nameJa) return out;
  const grow = [];
  for (const custom of s.customizes) {
    if (custom.exactCountKnown !== true || !Number.isInteger(custom.customizeCount) || custom.customizeCount < 1 ||
        !def.availableCustomizations?.includes(index.customIds.get(custom.id)) || !custom.growEffects?.length ||
        custom.growEffects.some(e => !e.effectType || e.unresolved || /EffectChange|PlayTriggerChange/.test(e.effectType))) return out;
    grow.push(...custom.growEffects.filter(e => !e.playProduceExamTriggerId && !e.playEffectProduceExamTriggerId));
  }
  const delta = type => grow.filter(e => e.effectType === 'ProduceCardGrowEffectType_' + type).reduce((sum,e) => sum + e.value, 0);
  // A use condition can itself require the resource being funded. Such a
  // card cannot serve as evidence for the initial supply in this comparison.
  const gain = def.conditions?.length ? 0 : directGain(def, 'concentration');
  const good = def.conditions?.length ? 0 : directGain(def, 'goodConditionTurns');
  out.gain = gain > 0 ? gain + delta('LessonBuffAdd') : 0;
  out.good = good > 0 ? good + delta('ParameterBuffTurnAdd') : 0;
  out.cost = row.costType === 'ExamCostType_ExamLessonBuff' ? Math.max(0, row.costValue - delta('CostLessonBuffReduce') + delta('CostLessonBuffAdd')) : 0;
  out.goodCost = row.costType === 'ExamCostType_ExamParameterBuff' ? Math.max(0, row.costValue - delta('CostParameterBuffReduce')) : 0;
  out.baseGoodCost = row.costType === 'ExamCostType_ExamParameterBuff' ? row.costValue : 0;
  out.baseCost = row.costType === 'ExamCostType_ExamLessonBuff' ? row.costValue : 0;
  out.baseGain = gain;
  out.once = def.limit === 1 && !grow.some(e => e.effectType === 'ProduceCardGrowEffectType_PlayMovePositionTypeChange' &&
    e.playMovePositionType === 'ProduceCardMovePositionType_Grave');
  out.extraUse = directGain(def, 'cardUsesRemaining') > 0;
  out.draw = (def.actions ?? []).some(g => !g.phase && !g.conditions?.length && g.actions?.some(a => a.type === 'call' && a.name === 'drawCard'));
  out.verified = true;
  out.isSupplier = out.gain > 0;
  out.candidatePriority = out.isSupplier ? (out.phase === 1 ? 2 : 1) : 0;
  return out;
}

function copyDescription(c) {
  const facts = [c.phase === 1 ? '개시 합류' : c.phase === 2 ? '중간 이후 합류' : '합류 미확인',
    c.upgrade === 0 ? '미강화' : c.upgrade == null ? '강화 미확인' : '강화 +' + c.upgrade];
  if (c.goodCost !== c.baseGoodCost && c.baseGoodCost > 0) facts.push(`호조 비용 ${c.baseGoodCost}→${c.goodCost} 개조`);
  if (c.cost !== c.baseCost && c.baseCost > 0) facts.push(`집중 비용 ${c.baseCost}→${c.cost} 개조`);
  if (c.gain > c.baseGain) facts.push(`집중 ${c.baseGain}→${c.gain} 개조`);
  return `${c.name} (${facts.join(', ')})`;
}

function compareFixedStats(chosen, omitted, target) {
  if (!chosen || !omitted) return '';
  const labels = { vo:'보컬', da:'댄스', vi:'비주얼' };
  const targetKey = ({ vocal:'vo', dance:'da', visual:'vi' })[target] ?? target;
  const different = Object.keys(labels).filter(axis => chosen.initialStats?.[axis] !== omitted.initialStats?.[axis] &&
    (chosen.initialStats?.[axis] > 0 || omitted.initialStats?.[axis] > 0));
  const axes = different.includes(targetKey) ? [targetKey] : different;
  const value = v => Number.isFinite(v) ? (v > 0 ? '+' + v : String(v)) : '미확인';
  if (!axes.length) {
    return (!chosen.initialStats || !omitted.initialStats) ? '두 사본의 확정 초기 스탯 차이는 미확인입니다.' : '';
  }
  return axes.map(axis => `초기 ${labels[axis]} 반입 수치는 선택한 ${chosen.name} 사본 ${value(chosen.initialStats?.[axis])}, 제외한 ${omitted.name} 사본 ${value(omitted.initialStats?.[axis])}입니다.`).join(' ');
}

// Test the funding for one use and the presence of a renewable supply when
// needed. Card draws, turn order, successive procs and exam scores are unknown.
function assess(idol, copies, firstSelection) {
  const available = firstSelection ? copies.filter(c => c.phase === 1) : copies;
  const good = Math.max(0, ...available.filter(c => !c.cost && !c.goodCost).map(c => c.good),
    ...idol.unique.filter(c => !c.cost && !c.useCondition).map(c => c.good));
  const native = idol.unique.filter(c => !c.cost && !c.useCondition);
  // Compare integer lower bounds, so reaching a threshold never depends on
  // unverified fractional rounding at the moment the idol effect triggers.
  const nativeGain = idol.openingConcentration + Math.max(0, good > 0 ? idol.startWithGood : 0,
    ...native.map(c => c.gain + Math.floor(c.ratio * good / 1000)));
  const threshold = Math.max(idol.recurring?.threshold ?? 0, ...idol.unique.map(c => c.cost), ...available.map(c => c.cost));
  const early = Boolean(idol.recurring);
  const lateSupply = !early && idol.late && good > 0 && Math.floor(idol.late.permil * good / 1000) >= threshold;
  const intrinsic = (!early && nativeGain >= threshold) || (early && native.some(c => !c.once && c.gain >= threshold));
  const usable = available.filter(c => c.isSupplier && !c.cost && c.goodCost <= good);
  const supplied = usable.some(c => (!early || !c.once) && c.gain + nativeGain >= threshold);
  if (threshold === 0) return 'no_resource_cost';
  if (intrinsic) return 'native_skill';
  if (supplied) return 'memory';
  if (lateSupply) return 'last_turns_only';
  return 'uncovered';
}

export function createHifConcentrationCarry({catalog, inventory = {}, selectedIdol, options = {}}) {
  const cardId = selectedIdol?.card?.gameId ?? selectedIdol?.gameId ?? options.idolCardId;
  const card = (catalog.idolCards ?? []).find(row => row.gameId === cardId);
  const owned = (inventory.idolCards ?? []).find(row => row.gameId === cardId) ?? selectedIdol?.owned;
  const active = Boolean(card && card.plan === 'sense' && (options.plan ?? card.plan) === 'sense' && options.scenario === 'hif' &&
    ['goodConditionTurns','good_condition','goodCondition'].includes(options.trainingType) &&
    (options.memorySelectionMode ?? 'guide') === 'guide' && (options.hifMode ?? 'normal') === 'normal' &&
    !options.eventModeId && !options.desiredSkillIds?.length && !card.excludedScenarios?.includes('hif'));
  const index = active ? indices(catalog) : null;
  const idol = active ? readIdol(card, owned, index) : null;
  const seen = new WeakMap();
  const inspectCandidate = memory => {
    if (!active || !memory) return { isSupplier: false, candidatePriority: 0 };
    if (!seen.has(memory)) seen.set(memory, inspect(memory, index));
    return seen.get(memory);
  };
  const evaluate = memories => {
    if (!active) return { priority: 0, firstSelection: 'inactive', laterExams: 'inactive' };
    const copies = memories.map(inspectCandidate).filter(c => c.verified);
    const firstSelection = assess(idol, copies, true), laterExams = assess(idol, copies, false);
    // Each window is binary. A second card that covers the same cost adds nothing.
    // Unknown native variants must not promote an unconfirmed requirement.
    const priority = Number(firstSelection !== 'uncovered') + Number(laterExams !== 'uncovered');
    const nativeRoleKnown = (idol.itemVerified && !idol.otherConditionalSupply) || idol.recurring || idol.late ||
      idol.unique.some(c => c.cost || c.ratio);
    return { priority: nativeRoleKnown ? priority : 0, firstSelection, laterExams };
  };
  const explain = (memories, allCandidates = []) => {
    if (!active) return { status: 'inactive', reason: '', windows: [], sources: [] };
    const result = evaluate(memories), selected = memories.map(inspectCandidate);
    const alternatives = allCandidates.filter(row => !memories.includes(row) && !selected.some(s => s.memoryId != null && s.memoryId === row.id))
      .map(inspectCandidate).filter(c => c.gameId && (c.isSupplier || selected.some(s => s.isSupplier) || !c.verified));
    alternatives.sort((a,b) => b.candidatePriority - a.candidatePriority);
    const selectedSuppliers = selected.filter(c => c.isSupplier);
    const withoutSuppliers = selected.filter(c => c.verified && !c.isSupplier);
    const first = result.firstSelection === 'memory';
    const provider = selectedSuppliers.find(c => assess(idol, [...withoutSuppliers, c], first) === 'memory') ?? selectedSuppliers[0];
    const omitted = alternatives.find(c => c.isSupplier);
    const fallback = selected.find(c => !c.isSupplier && c.extraUse && c.draw);
    const compare = omitted?.name ?? alternatives[0]?.name;
    const notes = [...idol.notes];
    const selectedNames = selected.map(c => c.name).filter(Boolean).join(', ');
    let decision;
    if (result.firstSelection === 'last_turns_only' || result.laterExams === 'last_turns_only') {
      decision = `${omitted ? copyDescription(omitted) + ' 사본을 추가하지 않아도 ' : ''}선택한 조합(${selectedNames || '반입 없음'})에서 호조를 먼저 쌓고 후반 P아이템으로 집중 비용을 마련할 수 있습니다.`;
      if (fallback) {
        decision += ` ${fallback.name} 사본은 드로우와 추가 행동을 맡습니다.`;
        const stats = compareFixedStats(fallback, omitted, options.targetAttribute);
        if (stats) decision += ' ' + stats;
      }
    } else if (result.firstSelection === 'memory' && provider) {
      const other = alternatives.find(c => !c.isSupplier && c.verified && c.draw && c.extraUse) ?? alternatives.find(c => c.verified);
      decision = `${copyDescription(provider)} 사본을 반입하면 첫 선발부터 사용할 수 있습니다. 사용 시 집중이 ${provider.gain} 증가합니다.${provider.goodCost ? ' 먼저 호조 ' + provider.goodCost + '턴이 필요합니다.' : ''}${other ? (other.isSupplier ? ' ' + other.name + '도 같은 공급 역할을 맡을 수 있어 두 장에 중복 가산하지 않습니다.' : ' 다른 후보 ' + other.name + '에는 즉시 집중 공급이 없습니다.') : ''}`;
    } else if (result.laterExams === 'memory' && provider) {
      decision = `${copyDescription(provider)}으로 후속 시험의 집중을 보충합니다. 첫 선발 시점의 공급은 별도로 확인하세요.`;
    } else if (result.firstSelection === 'native_skill') {
      decision = `${idol.itemName ?? card.nameKo}와 현재 고유 효과에서 비용을 마련할 수 있습니다. ${compare ?? provider?.name ?? '다른 집중 사본'}을 더해도 집중 역할은 한 번만 반영됩니다.`;
    } else if (result.firstSelection === 'uncovered' || result.laterExams === 'uncovered') {
      decision = `${selectedNames || '선택한 조합'}에서는 필요한 시점에 쓸 집중 공급을 확인하지 못했습니다.${omitted ? ' 반입 대안으로 ' + omitted.name + '의 합류 시점과 사용 비용을 확인하세요.' : ''}`;
    } else {
      decision = `${selectedNames || '선택한 조합'}에서 확인한 집중 비용이 없어 집중 반입을 별도로 우대하지 않았습니다.`;
    }
    const spenders = selected.filter(c => c.verified && c.cost > 0).map(c => `${c.name} 집중 ${c.cost}`);
    if (spenders.length) notes.push('선택한 반입 카드의 1회 사용 비용은 ' + spenders.join(', ') + '입니다.');
    if (!idol.itemVerified) notes.push('재능개화 단계 또는 고유 P아이템 사양을 확인하지 못했습니다.');
    if (idol.otherConditionalSupply) notes.push('고유 P아이템의 다른 집중 효과는 발동 조건이 있어 해당 턴의 공급량이 미확정입니다.');
    const alternativeDetails = alternatives.slice(0,3).map(c => {
      let reason;
      if (!c.verified) reason = `${c.name}은 합류·반입 자격·정확한 강화/개조 중 미확인 조건이 있습니다.`;
      else if (!c.isSupplier) reason = `${c.name}에는 사용할 때 바로 집중을 더하는 효과가 확인되지 않습니다.`;
      else {
        const coverage = result.firstSelection === 'memory' || result.firstSelection === 'native_skill' ? '선택한 조합에 같은 역할이 있습니다.' :
          result.firstSelection === 'last_turns_only' ? '고유 아이템 발동 전부터 쓸 집중이 필요할 때 대안입니다.' :
          c.phase === 2 ? '첫 선발 이후의 공급 후보입니다.' : '첫 선발부터 쓸 공급 후보입니다.';
        reason = `${copyDescription(c)} 사본을 사용하면 집중이 ${c.gain} 증가합니다. ${coverage}`;
      }
      return { ...c, reason };
    });
    const sourceRefs = [...sources];
    if (card.gameId === 'i_card-ssmk-3-010') sourceRefs.push({ title:'しゆ · 벚꽃 스미카의 1차 선발 집중 수급과 다른 반입 경로', url:'https://note.com/siyu_0112_1111/n/nebf1886c7e17' });
    return { status: 'conditional_resource_comparison', priority: result.priority, reason: [decision, ...notes].join(' '),
      windows: [{ stage: 'first_selection', status: result.firstSelection }, { stage: 'later_exams', status: result.laterExams }],
      selectedSuppliers, alternatives: alternativeDetails, selectedIdol: idol, sources: sourceRefs,
      handOrderVerified: false, scorePrediction: false };
  };
  return { active, inspectCandidate, evaluate, explain };
}
