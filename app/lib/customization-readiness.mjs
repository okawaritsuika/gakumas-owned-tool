import { summarizeMemoryEffects } from './memory-effects.mjs';
import { findHifMemoryProfile, evaluateHifGuideRole } from './hif-memory-profile.mjs';
import { idolRecipeContext } from './idol-recipe-policy.mjs';

const list = value => Array.isArray(value) ? value : [];
const integer = value => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const idOf = row => row?.memoryId ?? row?.id ?? row?.userMemoryId ?? row?.gameId ?? null;
const nameOf = row => row?.nameKo || row?.name || row?.nameJa || '이름 미확인';
const short = type => String(type ?? '').replace('ProduceCardGrowEffectType_', '');
const combine = checks => checks.some(check => check.status === 'missing') ? 'missing' : checks.some(check => check.status === 'unknown') ? 'unknown' : checks.length ? 'fulfilled' : 'not_specified';
const statusOf = value => value === true ? 'fulfilled' : value === false ? 'missing' : 'unknown';
const STACK = 'p_card-03-act-1_042';
const STACK_COUNT = 'p_card_custom-100-g_effect-lesson_count_add-1';
const STACK_GROWTH = 'p_card_custom-040_040_070-g_effect-effect_add-e_effect-exam_add_grow_effect-p_card_search-hand-all-0_0-g_effect-lesson_add-3-g_effect-effect_add-e_effect-exam_add_grow_effect-p_card_search-hand-all-0_0-g_effect-lesson_add-6-g_effect-effect_add-e_effect-exam_add_grow_effect-p_card_search-hand-all-0_0-g_effect-lesson_add-11';
const ROLLBACK = 'p_card-03-men-1_050';
const ROLLBACK_LIMIT = 'p_card_custom-wrapper-p_card-03-men-1_050-b-01';
const officialSources = [
  { id: 'official-card-customization', title: '공식 스킬 카드 커스터마이즈 도움말', checkedAt: '2026-11-04',
    url: 'https://stat.game-gakuen-idolmaster.jp/html/help/c8badfde900eeb0a979ffe8fdc1632009d163f31b6b991b286336a3b8d8dd05f/index.html' },
  { id: 'official-special-guidance', title: '공식 특별지도 도움말', checkedAt: '2026-11-04',
    url: 'https://stat.game-gakuen-idolmaster.jp/html/help/a8ee5d71a163252de84346f4085e9a590ea98113ad9c5feb528d0384920cd754/index.html' },
];
const labels = { CostReduce: '소비 체력 감소', LessonAdd: '파라미터 상승량 증가', LessonCountAdd: '파라미터 상승 횟수 증가',
  LessonBuffAdd: '집중 증가', ParameterBuffTurnAdd: '호조 지속 턴 증가', BlockAdd: '원기 증가',
  FullPowerPointAdd: '전력치 증가', ReviewAdd: '호인상 증가', CostParameterBuffReduce: '호조 비용 감소',
  CostLessonBuffReduce: '집중 비용 감소', CostFullPowerPointReduce: '전력치 비용 감소', CostReviewReduce: '호인상 비용 감소' };
const descriptionLabels = { '成長追加': '성장 효과 추가', '成長+': '성장 효과 강화', '持続効果+': '지속 효과 강화',
  '元気追加': '원기 효과 추가', '保留追加': '보류 효과 추가', 'やる気追加': '의욕 효과 추가', 'スキルカード強化追加': '스킬 카드 강화 효과 추가',
  '強気追加': '강기 전환 추가', '温存追加': '온존 전환 추가', '全力値追加': '전력치 효과 추가', '集中追加': '집중 효과 추가',
  '絶好調追加': '절호조 효과 추가', '好調追加': '호조 효과 추가', '好印象追加': '호인상 효과 추가', '消費体力減少追加': '소비 체력 감소 효과 추가',
  'スキルカード使用数+': '스킬 카드 사용 수 증가' };
const cleanDescription = text => String(text ?? '').replace(/(?:\\n|\n)+/g, ' ').replace(/\\/g, '').replace(/\s+/g, ' ').trim();

export { actualCustomizations as describeStoredCustomizations };

export function storedCustomizationLabel(custom, originalName) {
  const sourceName = custom.descriptionJa || originalName;
  const ratioLabels = {
    ProduceCardGrowEffectType_LessonDependBlockAdd: '원기 비례 화력',
    ProduceCardGrowEffectType_LessonDependExamReviewAdd: '호인상 비례 화력',
    ProduceCardGrowEffectType_LessonDependExamCardPlayAggressiveAdd: '의욕 비례 화력',
  };
  const parts = custom.effects.map(effect => {
    if (effect.verification === 'exact_native_row_label') return effect.label;
    if (effect.verification === 'unknown') return null;
    if (ratioLabels[effect.type] && effect.value !== null) return ratioLabels[effect.type] + ' +' + effect.value / 10 + '%';
    if (effect.type === 'ProduceCardGrowEffectType_AggressiveAdd' && effect.value !== null) return '의욕 +' + effect.value;
    return sourceName;
  }).filter(Boolean);
  return [...new Set(parts)].join(', ') || sourceName;
}

function effectView(effect, description) {
  const type = short(effect.effectType), value = integer(effect.value);
  const knownLabel = labels[type];
  let label = knownLabel ? knownLabel + (value === null ? '' : ` +${value}`) : null;
  if (type === 'PlayMovePositionTypeChange' && effect.playMovePositionType === 'ProduceCardMovePositionType_Grave') label = '레슨 중 1회 제한 해제 · 사용 후 버림패로 이동';
  if (!label && descriptionLabels[description]) label = descriptionLabels[description];
  if (!label && /レッスン中1回.*制限削除/.test(description)) label = '레슨 중 1회 제한 해제';
  return { id: effect.id ?? null, type: effect.effectType ?? null, value, label: label ?? '추가 효과의 세부 조건 확인 필요',
    verification: effect.unresolved ? 'unknown' : label ? 'exact_native_row_label' : 'native_row_semantics_unresolved',
    referenceEffectId: effect.playProduceExamEffectId || null, playMovePositionType: effect.playMovePositionType ?? null };
}

function actualCustomizations(skill, catalog) {
  const tables = catalog.memoryEffectDetails?.tables ?? {};
  return list(skill?.customizes).map(custom => {
    const count = integer(custom.customizeCount);
    const native = count === null ? null : tables.ProduceCardCustomize?.[`${custom.id}:${count}`];
    // Only the exact native count row is authoritative; a public alias or a
    // same-name customization never establishes its actual stage or effect.
    const rawEffects = native ? list(native.produceCardGrowEffectIds).map(id => tables.ProduceCardGrowEffect?.[id] ?? { id, unresolved: true }) : [];
    const descriptionJa = cleanDescription(native?.description);
    const effects = rawEffects.map(effect => effectView(effect, descriptionJa));
    const exact = Boolean(native && count !== null && rawEffects.length && rawEffects.every(effect => !effect.unresolved));
    return { id: custom.id ?? null, customizeCount: count, exactCountKnown: Boolean(native), status: exact ? 'resolved' : 'unknown',
      description: effects.map(effect => effect.label).join(', ') || '정확한 개조 단계·효과 확인 필요', descriptionJa: descriptionJa || null,
      effects, source: 'ProduceCardCustomize.id_and_customizeCount', appliedToStoredMemoryOnly: true };
  });
}

function exactCustomCheck(customs, { id, count = 1, effectType = null, destination = null }) {
  const target = customs.filter(custom => custom.id === id);
  const confirmed = target.some(custom => custom.status === 'resolved' && custom.customizeCount >= count && (!effectType ||
    custom.effects.some(effect => effect.type === effectType && (!destination || effect.playMovePositionType === destination))));
  return confirmed ? 'fulfilled' : target.some(custom => custom.status === 'unknown') ? 'unknown' : 'missing';
}

function guideFor(role, profile, memory, customs) {
  if (!role) return { status: 'unknown', roleStatus: 'unknown', required: [], optional: [], templateRequirements: [], sourceIds: [],
    note: '이 스킬의 필수 개조를 확정한 선택 공략 조건이 없습니다. 실제 개조만 표시합니다.' };
  const evaluated = evaluateHifGuideRole(role, memory);
  const checks = list(evaluated?.checks).map(check => ({ ...check, status: statusOf(check.passed) }));
  const required = [], templateRequirements = [];
  if (profile.id === 'anomaly_full_power' && role.gameId === STACK) {
    required.push({ id: 'opening_count_customization', label: '이 공략의 개시 반입 사양: 파라미터 상승 횟수 +1',
      status: exactCustomCheck(customs, { id: STACK_COUNT, effectType: 'ProduceCardGrowEffectType_LessonCountAdd' }),
      timing: 'carry_in_for_first_selection', targetCustomizationId: STACK_COUNT, requiredCount: 1,
      checks: checks.filter(check => check.kind === 'customization'), sourceIds: ['morishi-43'],
      note: 'PLv80 완성 루프 전체의 준비 완료가 아니라 작성자 개시 메모리의 개조 사양입니다.' });
    templateRequirements.push({ id: 'late_growth_customization', label: '원문의 후반 완성 사양: 성장 개조 2회',
      status: exactCustomCheck(customs, { id: STACK_GROWTH, count: 2 }), timing: 'during_produce_not_required_at_start',
      targetCustomizationId: STACK_GROWTH, requiredCount: 2, sourceIds: ['morishi-43'],
      note: '원문은 횟수 개조만 반입하고 19주 특별지도에서 성장 개조를 추가했습니다. 실제 진행 중 추가 여부는 미수집입니다.' });
  } else if (profile.id === 'anomaly_strength' && role.gameId === ROLLBACK) {
    required.push({ id: 'loop_usage_limit_removed', label: '이 공략의 반복 루프용 한 장: 레슨 중 1회 제한 해제',
      status: exactCustomCheck(customs, { id: ROLLBACK_LIMIT, effectType: 'ProduceCardGrowEffectType_PlayMovePositionTypeChange', destination: 'ProduceCardMovePositionType_Grave' }),
      timing: 'carry_in_for_loop', targetCustomizationId: ROLLBACK_LIMIT, requiredCount: 1, sourceIds: ['morishi-42'],
      note: '도중에 얻는 열의 추가용 복사본 모두에 제한 해제를 요구하지 않습니다.' });
  } else if (role.customizationRequirement || role.customizationCriteria || list(role.exactCustomizations).length) {
    const customChecks = checks.filter(check => ['customization', 'exact_customization', 'effective_cost', 'remaining_customization'].includes(check.kind));
    const exact = list(role.exactCustomizations);
    required.push({ id: 'guide_customization', label: role.customizationRequirement ?? '공략의 개조 수치 조건',
      status: combine(customChecks), timing: 'source_recipe', checks: customChecks,
      targetCustomizationId: exact.length === 1 ? exact[0].id : null,
      requiredCount: exact.length === 1 ? exact[0].minimumCount : role.customizationCriteria?.guideCustomizationCount ?? null,
      exactCustomizations: structuredClone(exact), sourceIds: list(profile.sourceIds) });
  }
  const optional = [];
  if (role.customizationPreference) {
    const effectType = role.gameId === 'p_card-03-act-3_065' ? 'ProduceCardGrowEffectType_BlockAdd' :
      role.gameId === 'p_card-00-men-3_005' ? 'ProduceCardGrowEffectType_CostReduce' : null;
    const has = effectType && customs.some(custom => custom.status === 'resolved' && (custom.effects.some(effect => effect.type === effectType) ||
      effectType === 'ProduceCardGrowEffectType_BlockAdd' && custom.descriptionJa === '元気追加'));
    optional.push({ id: 'guide_preference', label: role.customizationPreference, required: false,
      status: has ? 'fulfilled' : effectType ? customs.some(custom => custom.status === 'unknown') ? 'unknown' : 'missing' : 'unknown',
      sourceIds: list(profile.sourceIds), note: '원문의 선택 개조이며 미보유만으로 루프 불성립을 확정하지 않습니다.' });
  }
  return { status: combine(required), roleStatus: evaluated?.status ?? 'unknown', required, optional, templateRequirements,
    checks, sourceIds: list(profile.sourceIds), loopReadinessConfirmed: false };
}

/** Exact memory customization audit; never adds hypothetical effects to scores. */
export function buildCustomizationReadiness({ result = {}, catalog = {}, inventory = {}, options = {} } = {}) {
  const plan = result.scoreSummary?.plan ?? result.selectedIdol?.plan ?? options.plan ?? null;
  const scenario = result.scoreSummary?.scenario ?? options.scenario ?? 'hif';
  const trainingType = result.scoreSummary?.trainingType ?? options.trainingType ?? null;
  const context = { ...options, plan, scenario, trainingType, producerLevel: options.producerLevel ?? inventory.producerLevel,
    skillCardSwitchSettings: options.skillCardSwitchSettings ?? inventory.skillCardSwitchSettings };
  // Event exceptions concern card appearance/rental access. They do not prove
  // that a normal-mode guide's loop/customization requirements can be waived.
  const profile = scenario === 'hif' ? findHifMemoryProfile(catalog,idolRecipeContext({result,catalog,inventory,options})) : null;
  const sourceIds = new Set(list(profile?.sourceIds));
  const roles = [...list(profile?.carryRoles), ...list(profile?.alternatives)];
  const selected = list(result.memories);
  const memories = selected.map(selectedMemory => {
    const selectedId = idOf(selectedMemory);
    const inventoryMemory = selectedId === null ? null : list(inventory.memories).find(memory => idOf(memory) === selectedId);
    const memory = { ...inventoryMemory, ...selectedMemory };
    const hasRawSkill = Boolean(memory.raw?.produceCard?.id || memory.produceCard?.id || memory.skill?.id);
    const effects = hasRawSkill ? summarizeMemoryEffects(memory, catalog, context) : memory.modelEffects;
    const skill = effects?.carriedSkill ?? null;
    const normalized = { ...memory, modelEffects: effects, skillCard: memory.skillCard ?? list(catalog.skillCards).find(card =>
      card.gameId === skill?.id && card.upgradeCount === skill?.upgrade) };
    const customs = actualCustomizations(skill, catalog);
    const role = roles.find(role => role.gameId === skill?.id);
    const guide = guideFor(role, profile, normalized, customs);
    const actualSummary = customs.length ? customs.map(custom => `${custom.description} (${custom.customizeCount ?? '?'}회)`).join(' · ') : skill ? '개조 없음' : '반입 스킬·개조 미확인';
    const requiredSummary = guide.required.length ? guide.required.map(item => `${item.label}: ${{ fulfilled: '충족', missing: '미충족', unknown: '미확정', not_specified: '명시 없음' }[item.status]}`).join(' · ') : '확정된 필수 개조 조건 없음';
    return { memoryId: idOf(memory), gameId: skill?.id ?? memory.skillCard?.gameId ?? null,
      nameKo: skill?.nameKo ?? skill?.name ?? memory.skillCard?.nameKo ?? null, nameJa: skill?.nameJa ?? memory.skillCard?.nameJa ?? null,
      name: nameOf(skill ?? memory.skillCard), imageUrl: memory.skillImageUrl ?? memory.skillCard?.thumbnailUrl ?? memory.skillCard?.imageUrl ?? null,
      phase: skill?.phase ?? null, upgradeCount: skill?.upgrade ?? null, obtainable: skill?.obtainable ?? null,
      actualCustomizations: customs, customizationStatus: !skill ? 'unknown' : customs.some(custom => custom.status === 'unknown') ? 'unknown' : customs.length ? 'exact_native_rows' : 'none',
      actualSummary, guide, summary: `${actualSummary} / ${requiredSummary}`, loopReadinessConfirmed: false };
  });
  const policy = list(catalog.playbookPolicies?.policies).find(policy => policy.scenario === scenario && policy.plan === plan &&
    (policy.trainingType === trainingType || profile?.trainingTypeAliases?.includes(policy.trainingType)));
  const route = result.scoreSummary?.hifModel?.route ?? result.scoreSummary?.hifModel ?? result.route ?? {};
  const suppressed=new Set(profile?.characterPolicy?.applied?list(profile.characterPolicy.suppressedGenericCarryRoleIds):[]);
  const duringProduce = list(policy?.cardManagement).filter(item => item.action === 'customize' && item.venue === 'special_training' &&
    ['author_observed_run', 'author_recommendation'].includes(item.evidenceKind)&&(!suppressed.has(item.gameId)||memories.some(memory=>memory.gameId===item.gameId))).map(item => {
    for (const id of list(item.sourceIds)) sourceIds.add(id);
    const selectedMemory = memories.find(memory => memory.gameId === item.gameId);
    const card = list(catalog.skillCards).find(card => card.gameId === item.gameId && card.upgradeCount === 1);
    const weeks = list(item.conditions?.selectionWeeks);
    const exactTarget = item.gameId === STACK ? { id: STACK_GROWTH, count: 2 } : item.gameId === ROLLBACK ? { id: ROLLBACK_LIMIT, count: 1 } : null;
    const memoryStatus = exactTarget && selectedMemory ? exactCustomCheck(selectedMemory.actualCustomizations, exactTarget) : 'unknown';
    const accessRows = [...list(result.personalizedPlan?.cardAccess), ...list(result.personalizedPlan?.midgamePlan?.acquisitionTargets),
      ...list(result.personalizedPlan?.midgameAcquisitionTargets), ...list(result.midgameAcquisitionTargets)]
      .filter(row => row.gameId === item.gameId);
    const actionabilityChecks = [
      ...(selectedMemory ? [{ source: 'selected_memory_carry', eligible: selectedMemory.obtainable ?? null }] : []),
      ...accessRows.map(row => ({ source: 'normal_acquisition_access', eligible: row.normalAcquisition?.eligible ?? null })),
    ];
    const currentlyActionable = actionabilityChecks.some(check => check.eligible === true) ? true :
      actionabilityChecks.length && actionabilityChecks.every(check => check.eligible === false) ? false : null;
    return { target: { gameId: item.gameId, memoryId: selectedMemory?.memoryId ?? null, nameKo: item.nameKo ?? card?.nameKo ?? null,
        nameJa: item.nameJa ?? card?.nameJa ?? null, imageUrl: selectedMemory?.imageUrl ?? card?.thumbnailUrl ?? card?.imageUrl ?? null },
      label: list(item.conditions?.customizationTargets).join(' · ') || item.reason, status: 'conditional_plan',
      currentlyActionable, actionabilityChecks, actionabilityScope: 'card_carry_or_acquisition_access_only',
      actionabilityReason: currentlyActionable === true ? '반입 또는 도중 획득 가능 조건 확인. 실제 육성 중 소지·강화·방문·가격은 별도 확인합니다.' :
        currentlyActionable === false ? '확인된 반입·도중 획득 경로가 잠겨 있어 현재 실행할 개조 계획에 포함하지 않습니다.' :
          '현재 계정의 반입·도중 획득 가능 조건이 미확인입니다.',
      currentStoredMemoryStatus: memoryStatus, targetCustomizationId: exactTarget?.id ?? null, targetCount: exactTarget?.count ?? null,
      venue: 'special_training', venueLabel: '특별지도', timing: { selectionWeeks: weeks, labels: list(item.when), verifiedBy: item.evidenceKind },
      routeIncludesVenueAtTargetWeek: list(route.selections).length ? list(route.selections).some(row => (!weeks.length || weeks.includes(row.week)) && ['special_training', 'guidance', 'special_guidance'].includes(row.activity)) : null,
      ppCost: null, costStatus: 'check_displayed_price', minimumProducerLevelInSource: item.conditions?.minProducerLevel ?? null,
      conditions: ['현재 육성에서 해당 카드를 실제 소지하고 강화한 상태일 것', '화면의 개조 가능 항목·잔여 횟수·P포인트 가격을 확인할 것',
        '특별지도를 선택할 수 있고 해당 주차에 방문할 것', ...(policy?.scope ? [policy.scope] : [])],
      sourceConditions: structuredClone(item.conditions ?? {}), sourceIds: list(item.sourceIds),
      applied: false, note: '저장된 메모리를 변경하거나 진행 중 육성에 이미 개조했다고 가정하지 않습니다.' };
  });
  const guideSources = [...list(catalog.hifMemoryRoles?.sources),...list(catalog.idolRecipePolicies?.sources)].filter(source => sourceIds.has(source.id));
  const policySources = list(catalog.playbookPolicies?.sources).filter(source => sourceIds.has(source.id) && !guideSources.some(row => row.id === source.id));
  const nativeSources = list(catalog.memoryEffectDetails?.provenance).filter(row => ['ProduceCardCustomize', 'ProduceCardGrowEffect'].includes(row.table))
    .map(row => ({ id: 'native-' + row.table, title: row.table + ' 원본 ID·단계', url: row.sourceUrl, sha256: row.sha256 }));
  return { status: memories.length ? 'partial_source_audit' : 'no_selected_memories', asOf: '2026-11-04',
    summary: '실제 메모리 개조와 공략의 개시 사양·육성 중 추가 계획을 구분합니다. 완성 루프 성립은 미검증입니다.',
    context: { scenario, plan, trainingType, profileId: profile?.id ?? null, guideScope: 'normal_hif_reference',
      selectedEventModeId: options.eventModeId ?? result.eventContext?.modeId ?? null, eventWaivesGuideCustomizationRequirements: false },
    memories, duringProduce, sources: [...guideSources, ...policySources, ...officialSources, ...nativeSources],
    readinessConfirmed: false, hypotheticalEffectsApplied: false, numericSkillScoreAdded: false,
    limitations: ['개조는 동일 native ID와 정확한 누적 횟수 행으로 확인합니다. 이름·개조 총개수만으로 요구 효과를 충족 처리하지 않습니다.',
      '공략의 필수는 해당 작성자·플랜·운영안 조건입니다. 모든 P아이돌과 PLv70 계정의 보편 필수 조합이 아닙니다.',
      '일반 HIF 공략을 아사리 등 이벤트의 모든 추가 카드·해금 예외에 맞춘 완성 루프로 재검증한 것은 아닙니다.',
      '추가 행동·보류·성장 효과의 ID는 표시하지만 실제 턴 운영과 전체 덱의 효능을 점수로 환산하지 않습니다.',
      '육성 중 추가한 개조는 메모리 추첨에 일부만 반영될 수 있어 목표 메모리 완성을 보장하지 않습니다.'] };
}
