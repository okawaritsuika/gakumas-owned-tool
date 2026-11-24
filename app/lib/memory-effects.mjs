// Master-table interpretation only. Conditional effects are not simulated or
// converted into final-stat expectations; a memory's final Vo/Da/Vi is not carry-in.
import { getTrustedEventUnlockOverrides, getEventAdditionalAppearance } from './event-context.mjs';
const vector = () => ({ vo: 0, da: 0, vi: 0 });
const nativeId = row => row?.gameId ?? row?.id;
const nameOf = row => row?.nameKo || row?.name || row?.nameJa || null;
const integer = value => value !== null && value !== undefined && value !== '' && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const combine = values => values.includes(false) ? false : values.includes(null) ? null : true;
const short = value => String(value ?? '').replace(/^[A-Za-z]+Type_/, '');
const planOf = value => ({ Common: 'free', Unknown: 'free', Plan1: 'sense', Plan2: 'logic', Plan3: 'anomaly' })[String(value ?? '').replace('ProducePlanType_', '')] ?? value;
const scenarioOf = value => ({ hatsu: 'hajime', FirstStar: 'hajime', NIA: 'nia', HatsuboshiIdolFestival: 'hif' })[String(value ?? '').replace('ProduceType_', '')] ?? value;
const cache = new WeakMap();

function indices(catalog) {
  if (cache.has(catalog)) return cache.get(catalog);
  const graph = Object.fromEntries(Object.entries(catalog.memoryMechanicsGraph ?? {}).map(([key, rows]) => [key, new Map(rows.map(row => [row.id, row]))]));
  const skills = new Map((catalog.skillCards ?? []).map(row => [`${nativeId(row)}:${row.upgradeCount ?? 0}`, row]));
  const abilities = new Map((catalog.memoryAbilities ?? []).map(row => [`${nativeId(row)}:${row.level}`, row]));
  const customizes = new Map((catalog.customizations ?? []).flatMap(row => [nativeId(row), ...(row.equivalentGameIds ?? [])].map(id => [id, row])));
  const value = { graph, skills, abilities, customizes };
  cache.set(catalog, value);
  return value;
}

const phaseLabels = {
  ProduceStart: '프로듀스 시작 시', StartLesson: '레슨 시작 시', EndLesson: '레슨 종료 시',
  StartAudition: '시험마다', StartAuditionMid1: '중간 시험 1 시작 시',
  StartAuditionMid2: '중간 시험 2 시작 시', StartAuditionFinal: '최종 시험 시작 시',
};
function produceTrigger(id, phaseType) {
  const phase = short(phaseType);
  const conditions = [];
  const match = /^p_trigger-(?:start|end)_lesson-lesson_(vocal|dance|visual)(_sp)?$/.exec(id ?? '');
  if (match) conditions.push({ kind: 'lesson', attribute: match[1], sp: Boolean(match[2]), text: `${{ vocal: '보컬', dance: '댄스', visual: '비주얼' }[match[1]]}${match[2] ? ' SP' : ''} 레슨` });
  return { id, phase, label: phaseLabels[phase] ?? phase, conditions };
}

function applicability(restrictions, options) {
  const conditions = [];
  const requiredPlan = planOf(restrictions.plan ?? restrictions.planEnum ?? 'free');
  if (requiredPlan && requiredPlan !== 'free') conditions.push({ kind: 'plan', required: requiredPlan, actual: options.plan ?? null, applies: options.plan ? options.plan === requiredPlan : null });
  let scenarios = (restrictions.explicitGroupScenarios ?? []).map(scenarioOf);
  const type = scenarioOf(restrictions.produceTypeEnum);
  if (type && type !== 'ProduceType_Unknown' && type !== 'Unknown' && !scenarios.length) scenarios = [type];
  if (scenarios.length) conditions.push({ kind: 'scenario', required: scenarios, actual: options.scenario ?? null, applies: options.scenario ? scenarios.includes(scenarioOf(options.scenario)) : null });
  const split = restrictions.produceSplitTypeEnum;
  if (split && split !== 'ProduceSplitType_Unknown') conditions.push({ kind: 'produce_split', required: split, actual: options.produceSplitType ?? null, applies: options.produceSplitType ? split === options.produceSplitType : null });
  return { applies: combine(conditions.map(row => row.applies)), conditions, hifOnly: scenarios.length === 1 && scenarios[0] === 'hif' };
}

function probability(raw) {
  const value = integer(raw);
  if (value > 0 && value <= 1000) return { rawPermil: value, kind: 'explicit', percent: value / 10 };
  // Zero is the sentinel used by listed parameter bonuses and HIF effects;
  // it cannot mean "0% proc". Do not invent a probability for this sentinel.
  return { rawPermil: value, kind: 'not_specified', percent: null };
}

function cardReference(id, upgrade, index) {
  const exact = upgrade == null ? null : index.skills.get(`${id}:${upgrade}`);
  const card = exact ?? index.skills.get(`${id}:0`);
  return { id, upgrade: upgrade ?? null, name: nameOf(card), nameJa: card?.nameJa ?? null,
    plan: card?.plan ?? null, unlockProducerLevel: card?.unlockProducerLevel ?? null,
    rentalUnlockProducerLevel: card?.rentalUnlockProducerLevel ?? null, known: Boolean(card),
    variantKnown: upgrade == null ? null : Boolean(exact) };
}

function searchDetails(id, index, issues) {
  if (!id) return null;
  const row = index.graph.ProduceCardSearch?.get(id);
  if (!row) { issues.add(`카드 탐색 조건을 확인하지 못했습니다: ${id}`); return { id, known: false, cards: [] }; }
  const upgrades = row.upgradeCounts ?? [];
  return { ...row, known: true, cards: (row.produceCardIds ?? []).map(cardId => cardReference(cardId, upgrades.length === 1 ? upgrades[0] : null, index)) };
}

function examTrigger(id, index, issues) {
  const row = index.graph.ProduceExamTrigger?.get(id);
  if (!row) { issues.add(`시험 발동 조건을 확인하지 못했습니다: ${id}`); return { id, known: false, text: '시험 발동 조건 미확인' }; }
  const search = searchDetails(row.produceCardSearchId, index, issues);
  const names = search?.cards.map(card => card.name ?? card.id).join(', ');
  const phases = row.phaseTypes ?? [];
  let text = phases.map(short).join(', ');
  if (phases.includes('ProduceExamPhaseType_ExamTurnTimer')) text = `${(row.phaseValues ?? []).join(', ')}턴 시작 시`;
  if (phases.includes('ProduceExamPhaseType_ExamCardPlayAfter')) text = `${names || '조건에 맞는 스킬 카드'} 사용 후`;
  return { ...row, known: true, search, text };
}

const effectLabels = {
  ExamBlock: '실드', ExamCardDraw: '스킬 카드 드로우', ExamCardPlayAggressive: '의욕',
  ExamFullPowerPoint: '전력치', ExamLessonBuff: '집중', ExamParameterBuff: '호조',
  ExamPreservation: '보존', ExamReview: '호인상', ExamStaminaConsumptionDown: '소비 체력 감소',
};

function resolveEnchant(id, index, details, issues, trail = new Set()) {
  if (trail.has(id) || trail.size >= 12) { issues.add(`지속 효과의 순환 참조를 확인해야 합니다: ${id}`); return null; }
  const row = index.graph.ProduceExamStatusEnchant?.get(id);
  if (!row) { issues.add(`지속 효과를 확인하지 못했습니다: ${id}`); return null; }
  const next = new Set(trail).add(id);
  const description = details?.tables?.ProduceExamStatusEnchant?.[id];
  const trigger = examTrigger(row.produceExamTriggerId, index, issues);
  return { id, trigger, descriptionJa: description?.descriptionJa ?? null,
    effects: (row.produceExamEffectIds ?? []).map(effectId => resolveExamEffect(effectId, index, details, issues, next, description)).filter(Boolean) };
}

function resolveExamEffect(id, index, details, issues, trail, parentDescription) {
  const row = index.graph.ProduceExamEffect?.get(id);
  if (!row) { issues.add(`시험 효과를 확인하지 못했습니다: ${id}`); return null; }
  const type = short(row.effectType);
  const result = { id, type, raw: row, kind: type, text: null };
  if (type === 'ExamStatusEnchant') {
    const confirmedLimit = parentDescription?.activationLimits?.find(item => item.effectId === id)?.count;
    result.kind = 'persistent_effect';
    result.activationLimit = confirmedLimit ?? null;
    result.activationLimitSource = confirmedLimit == null ? null : 'original_description_CustomizeEffectCount';
    result.durationTurns = row.effectTurn === -1 ? null : row.effectTurn;
    result.enchant = resolveEnchant(row.produceExamStatusEnchantId, index, details, issues, trail);
    result.text = `${confirmedLimit == null ? '지속 효과' : `이후 ${confirmedLimit}회까지`}: ${result.enchant?.descriptionJa ?? result.enchant?.trigger.text ?? '세부 조건 미확인'}`;
  } else if (type === 'ExamPlayableValueAdd') {
    result.kind = 'skill_use_count_add'; result.value = row.effectCount;
    result.text = `스킬 카드 사용 수 +${row.effectCount}`;
  } else if (type === 'ExamCardMove') {
    result.kind = row.movePositionType === 'ProduceCardMovePositionType_Lost' ? 'remove_cards' : 'move_cards';
    result.search = searchDetails(row.produceCardSearchId, index, issues);
    result.destination = short(row.movePositionType);
    result.countMin = row.pickCountMin; result.countMax = row.pickCountMax;
    const names = result.search?.cards.map(card => card.name ?? card.id).join(', ') || '조건에 맞는 카드';
    const position = { DeckGrave: '산패 또는 버림패', DeckAll: '덱', Target: '사용한 카드' }[short(result.search?.cardPositionType)] ?? '지정 위치';
    result.text = `${position}의 ${names} ${row.pickCountMin === row.pickCountMax ? row.pickCountMin : `${row.pickCountMin}~${row.pickCountMax}`}장 ${result.kind === 'remove_cards' ? '제외' : `${result.destination}로 이동`}${row.pickRangeType === 'ProducePickRangeType_Random' ? ' (무작위)' : ''}`;
  } else if (type === 'ExamAddGrowEffect') {
    result.kind = 'modify_cards'; result.search = searchDetails(row.produceCardSearchId, index, issues);
    result.growEffects = (row.produceCardGrowEffectIds ?? []).map(growId => {
      const grow = index.graph.ProduceCardGrowEffect?.get(growId);
      if (!grow) issues.add(`카드 성장 효과를 확인하지 못했습니다: ${growId}`);
      return grow ? { ...grow, text: `${short(grow.effectType) === 'LessonAdd' ? '파라미터 상승량' : short(grow.effectType)} +${grow.value}` } : { id: growId, text: '변경 효과 미확인' };
    });
    result.text = `조건에 맞는 스킬 카드에 ${result.growEffects.map(grow => grow.text).join(', ')}`;
  } else if (effectLabels[type]) {
    result.kind = 'exam_status'; result.value = row.effectValue1; result.turns = row.effectTurn;
    result.text = `${effectLabels[type]} ${row.effectTurn ? `${row.effectTurn}턴` : `+${row.effectValue1}`}`;
  } else { result.text = `미해석 시험 효과: ${type}`; issues.add(result.text); }
  // Existing memory graph has no chained effects, but retain any referenced
  // effects instead of silently dropping them when public data changes.
  const chains = [...new Set([row.chainProduceExamEffectId, ...(row.chainProduceExamEffectIds ?? [])].filter(Boolean))];
  if (chains.length) {
    if (trail.has(id)) issues.add(`시험 효과 순환 참조: ${id}`);
    else result.chainedEffects = chains.map(chain => resolveExamEffect(chain, index, details, issues, new Set(trail).add(id), null)).filter(Boolean);
  }
  return result;
}

function leafEffects(enchant, conditions = [], limits = []) {
  if (!enchant) return [];
  const inherited = [...conditions, enchant.trigger];
  return enchant.effects.flatMap(effect => effect.enchant ? leafEffects(effect.enchant, inherited,
    [...limits, ...(effect.activationLimit == null ? [] : [{ effectId: effect.id, count: effect.activationLimit }])]) :
    [{ ...effect, conditions: inherited, activationLimits: limits }]);
}

function carriedSkill(memory, raw, catalog, index, options, issues) {
  const source = raw.produceCard ?? memory.produceCard ?? memory.skill;
  if (!source?.id) return null;
  const upgrade = integer(source.upgradeCount);
  const card = index.skills.get(`${source.id}:${upgrade}`);
  if (!card) issues.add(`반입 스킬의 강화 단계 자료를 확인하지 못했습니다: ${source.id}:${upgrade}`);
  const reference = cardReference(source.id, upgrade, index);
  const code = integer(raw.produceCardPhaseType ?? memory.produceCardPhaseType);
  const phase = code === 1 ? { code, key: 'produce_start', label: '프로듀스 시작 시 획득', availableAtStart: true } :
    code === 2 ? { code, key: 'after_mid_audition', label: '중간 시험 종료 후 획득', availableAtStart: false } :
      { code, key: 'unknown', label: '획득 시점 미확인', availableAtStart: null };
  if (phase.availableAtStart == null) issues.add('반입 스킬의 획득 시점을 확인하지 못했습니다.');
  const plan = reference.plan;
  const planCompatible = !plan ? null : plan === 'free' ? true : options.plan ? plan === options.plan : null;
  if (planCompatible == null) issues.add('선택 플랜 또는 반입 스킬 플랜이 없어 스킬 획득 가능 여부를 확정하지 못했습니다.');
  const level = integer(options.producerLevel);
  const rental = options.rental === true || memory.rental === true;
  const unlockTable = catalog.memoryEffectDetails?.tables?.ProducerLevelUnlocks;
  const unlock = unlockTable?.[source.id];
  const normalUnlock = integer(unlock?.level ?? card?.unlockProducerLevel);
  const carryUnlock = integer(card?.rentalUnlockProducerLevel);
  // This native field specifies rental unlock tiers. The app also uses it for
  // owned-memory comparisons; its official owned-carry scope is unconfirmed.
  // Generation and actual skill-switch unlocks are checked separately.
  const requiresSwitch = unlock?.type === 'ProducerLevelUnlockType_ProduceCardConversion' || card?.requiresSkillCardSwitch === true;
  const missingUnlockTable = !unlockTable && card?.sourceType === 'produce' && normalUnlock === 0;
  const required = missingUnlockTable ? null : requiresSwitch ? normalUnlock : carryUnlock;
  const eventRules=getTrustedEventUnlockOverrides(options,{catalog,plan:options.plan,scenario:options.scenario});
  const additionalAppearance=getEventAdditionalAppearance(options,{catalog,plan:options.plan,scenario:options.scenario,gameId:source.id});
  const generationPlanCompatible=additionalAppearance?.planEligible===true?true:planCompatible;
  const rentalProducerLevelWaived=Boolean(card)&&!requiresSwitch&&rental&&eventRules?.memoryRentalProducerLevelUnlock===true;
  const generationProducerLevelWaived=Boolean(card)&&!requiresSwitch&&eventRules?.producerLevelUnlock===true;
  const levelEligibleWithoutEvent = required === 0 ? true : required == null || level == null ? null : level >= required;
  const generationLevelEligibleWithoutEvent = normalUnlock === 0 ? true : normalUnlock == null || level == null ? null : level >= normalUnlock;
  const levelEligible = rentalProducerLevelWaived?true:levelEligibleWithoutEvent;
  const generationLevelEligible = generationProducerLevelWaived?true:generationLevelEligibleWithoutEvent;
  const switchSetting = requiresSwitch ? options.skillCardSwitchSettings?.[source.id] : true;
  const switchEligible = switchSetting === true ? true : switchSetting === false ? false : null;
  if (levelEligible == null) issues.add('PLv 또는 스킬 해금 자료가 없어 스킬 획득 제한을 확정하지 못했습니다.');
  if (missingUnlockTable) issues.add('별도 스킬 전환 해금 표가 없어 원자료의 해금 PLv 0을 무제한으로 판정하지 않습니다.');
  if (requiresSwitch && switchEligible == null) issues.add('스킬 카드 스위치 설정을 읽지 못했습니다. 실제 해금 PLv와 스위치 선택 상태를 확인해야 합니다.');
  const customizes = (source.customizes ?? []).map(customize => {
    const detail = index.customizes.get(customize.id);
    const native = catalog.memoryEffectDetails?.tables?.ProduceCardCustomize?.[`${customize.id}:${customize.customizeCount}`];
    const growEffects = (native?.produceCardGrowEffectIds ?? []).map(id => catalog.memoryEffectDetails?.tables?.ProduceCardGrowEffect?.[id] ?? { id, unresolved: true });
    if (!detail && !native) issues.add(`스킬 커스터마이즈 효과를 확인하지 못했습니다: ${customize.id}`);
    const labels = { CostReduce: '소비 체력 감소', LessonAdd: '파라미터 상승량', LessonDependBlockAdd: '실드 비례 파라미터 상승량', AggressiveAdd: '의욕', ReviewAdd: '호인상', LessonBuffAdd: '집중', FullPowerPointAdd: '전력치', BlockAdd: '실드', ParameterBuffTurnAdd: '호조 지속 턴', CostReviewReduce: '호인상 비용 감소', CostLessonBuffReduce: '집중 비용 감소', CostParameterBuffReduce: '호조 비용 감소', CostFullPowerPointReduce: '전력치 비용 감소', LessonCountAdd: '파라미터 상승 횟수', LessonDependExamReviewAdd: '호인상 비례 파라미터 상승량', EffectAdd: '효과 추가', EffectChange: '효과 변경', PlayTriggerChange: '사용 조건 변경', PlayMovePositionTypeChange: '사용 후 카드 위치 변경' };
    const description = native?.description || growEffects.map(effect => `${labels[short(effect.effectType)] ?? short(effect.effectType)}${effect.value ? ` ${effect.value}` : ''}`).join(', ');
    return { ...customize, name: nameOf(detail) ?? (description || null), nameJa: detail?.nameJa ?? null,
      known: Boolean(native ?? detail), exactCountKnown: Boolean(native), levels: detail?.levels ?? [],
      native, growEffects, note: '원자료의 동일 ID·customizeCount 행입니다. 반입 스킬의 기본 설명에 변경 효과를 수치 재계산하지 않습니다.' };
  });
  return { ...reference, variantKnown: Boolean(card), phase, customizes, planCompatible,
    producerLevel: level, requiredProducerLevel: required, rental, levelEligible,
    levelEligibleWithoutEvent,generationLevelEligibleWithoutEvent,rentalProducerLevelWaived,generationProducerLevelWaived,
    eventUnlockSourceIds:eventRules?.sourceIds??[],eventModeId:eventRules?.eventModeId??null,accountProducerLevelChanged:false,
    normalUnlockProducerLevel: normalUnlock, carryUnlockProducerLevel: carryUnlock,
    generationLevelEligible, requiresSwitch, switchEligible,
    generationPlanCompatible,eventAdditionalAppearance:Boolean(additionalAppearance),
    generationObtainable:combine([Boolean(card),generationPlanCompatible,generationLevelEligible,switchEligible]),
    generationUseScope:additionalAppearance?'selected_event_during_produce_only':'normal_plan_and_unlock_rules',
    levelRule: { kind: requiresSwitch ? 'actual_unlock_and_switch' : 'memory_carry_tier',
      sourceField: requiresSwitch ? 'ProducerLevel.unlockTargets:ProduceCardConversion' : 'ProduceCard.rentalUnlockProducerLevel',
      unlockTarget: unlock ?? null,
      officialScope: requiresSwitch ? 'skill_card_switch_unlock_and_selection' : 'memory_rental_unlock',
      ownedScopeEvidence: 'community_reference_official_scope_unconfirmed',
      ownedScopeOfficiallyConfirmed: false,
      noteKo: requiresSwitch ? '스위치는 실제 해금 PLv와 선택 상태를 확인합니다. 자기 보유 반입 전체의 PLv 적용 범위는 별도로 미확정입니다.' :
        '공식 대여 해금 PLv를 현재 앱의 자기 보유 비교에도 사용합니다. 자기 보유 반입에 같은 기준이 적용되는지는 공식 미확정입니다.',
      sources: [catalog.memoryEffectDetails?.provenance?.find(row => row.table === 'ProducerLevel')?.sourceUrl,
        'https://stat.game-gakuen-idolmaster.jp/html/help/c51ffcb5ef2228ee8dc48a5a881eeff02c4a95322feb513c9ed912136ae26c31/index.html',
        'https://stat.game-gakuen-idolmaster.jp/html/help/83c812f6ee4404aa579e5ba2243ced3baf30d02eff033916d30a1b088871c053/index.html',
        'https://wikiwiki.jp/gakumas/メモリー転写'].filter(Boolean) },
    obtainable: combine([Boolean(card), planCompatible, levelEligible, switchEligible]),
    noDeckDuplication: card?.noDeckDuplication ?? null,
    duplicateKey: card?.noDeckDuplication ? `skill:${source.id}` : null,
    actions: card?.actions ?? null, effects: card?.effects ?? null, conditions: card?.conditions ?? null,
    actionDescriptionScope: customizes.length ? 'base_card_before_customization' : 'exact_upgrade_card',
    customizationCalculationStatus: customizes.length ? 'not_simulated' : 'not_needed',
    characterId: raw.characterId ?? memory.characterId ?? (catalog.idolCards ?? []).find(row => nativeId(row) === raw.idolCardId)?.characterId ?? null };
}

/** Pure summary of the memory's carried skill and exact master-table effects. */
export function summarizeMemoryEffects(memory, catalog, options = {}) {
  const raw = memory?.raw ?? memory ?? {};
  const index = indices(catalog);
  const details = catalog.memoryEffectDetails;
  const issues = new Set();
  const result = { initialStats: vector(), growthRatePermil: vector(), conditionalEffects: [], hifEffects: [],
    carriedSkill: null, uniqueKeys: [], issues: [], status: 'resolved',
    noAbilityChain: true,
    calculationScope: '적용 가능한 프로듀스 시작 고정 수치만 합산합니다. 조건부·시험 효과는 기대 수치로 환산하지 않습니다. 메모리의 육성 완료 능력치는 반입 수치가 아닙니다.',
    probabilityNote: '원자료 확률 0은 확률 미지정 값입니다. 0% 불발로 처리하지 않습니다.' };
  const keys = new Set();
  result.carriedSkill = carriedSkill(memory ?? {}, raw, catalog, index, options, issues);
  if (result.carriedSkill?.duplicateKey && result.carriedSkill.obtainable === true) keys.add(result.carriedSkill.duplicateKey);
  const abilityIssues = new Set();
  const abilityRefs = raw.abilities ?? memory?.abilities;
  if (!Array.isArray(abilityRefs)) abilityIssues.add('메모리 어빌리티 목록을 읽지 못했습니다.');
  const seen = new Set();
  for (const ref of abilityRefs ?? []) {
    const identity = `${ref.id ?? ref.gameId}:${ref.level}`;
    if (seen.has(identity)) { abilityIssues.add(`같은 메모리에 어빌리티가 중복 기록되어 합산을 보류했습니다: ${identity}`); continue; }
    seen.add(identity);
    const ability = index.abilities.get(identity);
    if (!ability) { abilityIssues.add(`어빌리티의 정확한 레벨 자료를 확인하지 못했습니다: ${identity}`); continue; }
    const application = applicability(ability.restrictions ?? {}, options);
    if (application.applies == null) abilityIssues.add(`어빌리티 적용 조건에 필요한 플랜·시나리오 정보가 부족합니다: ${identity}`);
    const descriptionJa = details?.tables?.ProduceSkill?.[`${ability.produceSkillId}:${ability.produceSkillLevel}`]?.descriptionJa ?? null;
    for (const branch of ability.branches ?? []) {
      const effect = index.graph.ProduceEffect?.get(branch.produceEffectId);
      if (!effect) { abilityIssues.add(`어빌리티 효과 원자료를 확인하지 못했습니다: ${branch.produceEffectId}`); continue; }
      const triggerRow = index.graph.ProduceTrigger?.get(branch.produceTriggerId);
      const trigger = produceTrigger(branch.produceTriggerId, triggerRow?.phaseType ?? branch.phaseType);
      const type = short(effect.produceEffectType);
      const entry = { abilityId: ability.id, abilityLevel: ability.level, effectId: effect.id,
        produceSkillId: ability.produceSkillId, name: ability.summaryKo ?? null, descriptionJa,
        type, applies: application.applies, restrictions: application.conditions, nativeRestrictions: ability.restrictions ?? {}, trigger,
        probability: probability(branch.activationRatePermilRaw),
        activationLimit: ability.activationCountRaw > 0 ? ability.activationCountRaw : null,
        activationCountRaw: ability.activationCountRaw, valueMin: effect.effectValueMin, valueMax: effect.effectValueMax,
        uniqueKey: ability.isUniqueActivation ? `${application.hifOnly ? 'hif' : 'ability'}:${effect.id}@${trigger.id}` : null,
        includedInInitialTotals: false };
      if (entry.uniqueKey && application.applies === true) keys.add(entry.uniqueKey);
      const stat = /^(Vocal|Dance|Visual)(GrowthRate)?Addition$/.exec(type);
      if (stat) {
        const attribute = { Vocal: 'vo', Dance: 'da', Visual: 'vi' }[stat[1]];
        entry.kind = stat[2] ? 'growth_rate' : 'initial_stats'; entry.attribute = attribute;
        entry.unit = stat[2] ? 'permil' : 'points';
        entry.text = `${{ vo: '보컬', da: '댄스', vi: '비주얼' }[attribute]}${stat[2] ? ' 파라미터 보너스' : ''} +${stat[2] ? effect.effectValueMin / 10 : effect.effectValueMin}${stat[2] ? '%' : ''}`;
        // Configured automatic start bonuses use the probability-zero sentinel;
        // this is a listed bonus, never a probability-weighted expected value.
        if (application.applies === true && trigger.phase === 'ProduceStart' && effect.effectValueMin === effect.effectValueMax &&
            [0, 1000].includes(branch.activationRatePermilRaw)) {
          result[stat[2] ? 'growthRatePermil' : 'initialStats'][attribute] += effect.effectValueMin;
          entry.includedInInitialTotals = true;
        }
      } else if (type === 'ExamStatusEnchant') {
        entry.kind = 'exam_enchant';
        entry.enchant = resolveEnchant(effect.produceExamStatusEnchantId, index, details, abilityIssues);
        entry.actions = leafEffects(entry.enchant);
        entry.text = entry.actions.map(action => `${trigger.label} → ${action.conditions.map(condition => condition.text).join(' → ')}: ${action.text}${action.activationLimits.length ? ` (이후 ${action.activationLimits.map(limit => limit.count).join('/')}회까지)` : ''}`).join(' / ');
      } else if (type === 'StaminaRecoverFix') {
        entry.kind = 'stamina_recover'; entry.text = `체력 ${entry.valueMin === entry.valueMax ? entry.valueMin : `${entry.valueMin}~${entry.valueMax}`} 회복`;
      } else if (type === 'ProducePointAdditionDisableTrigger') {
        entry.kind = 'produce_points'; entry.text = `P포인트 +${entry.valueMin === entry.valueMax ? entry.valueMin : `${entry.valueMin}~${entry.valueMax}`}`;
        entry.noChain = true;
      } else { entry.kind = 'unknown'; entry.text = `미해석 효과: ${type}`; abilityIssues.add(entry.text); }
      result.conditionalEffects.push(entry);
      if (application.hifOnly) result.hifEffects.push(entry);
    }
  }
  result.abilityEffectsResolved = abilityIssues.size === 0;
  for (const issue of abilityIssues) issues.add(issue);
  result.uniqueKeys = [...keys];
  result.issues = [...issues];
  result.status = issues.size ? 'partial' : 'resolved';
  return result;
}
