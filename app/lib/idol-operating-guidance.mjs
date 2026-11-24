import { buildHifAbilityTargetContext } from './hif-ability-guidance.mjs';
import { resolveIdolRecipePolicy, idolRecipeContext } from './idol-recipe-policy.mjs';

const list = value => Array.isArray(value) ? value : [];
const idOf = row => row?.gameId ?? row?.id;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const rankOf = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const typeOf = value => ({ full_power: 'fullPower', good_impression: 'goodImpressionTurns', good_condition: 'goodConditionTurns' })[value] ?? value;
const stateNames = {
  score: '점수', cost: '체력 소비', concentration: '집중', motivation: '의욕', genki: '기운', fixedGenki: '기운 고정 가산',
  goodConditionTurns: '호조', perfectConditionTurns: '절호조', goodImpressionTurns: '호인상', stamina: '현재 체력', maxStamina: '최대 체력', fixedStamina: '체력 고정 회복',
  fullPowerCharge: '전력치', cumulativeFullPowerCharge: '누적 전력치', fullPowerTimes: '전력 진입 횟수', preservationTimes: '온존 진입 횟수', strengthTimes: '강기 진입 횟수',
  isFullPower: '전력 상태', isPreservation: '온존 상태', isStrength: '강기 상태', preservation: '온존', preservation2: '온존 2단계', strength: '강기', strength2: '강기 2단계', fullPower: '전력', leisure: '여유', none: '기본 태세',
  turnsRemaining: '남은 턴', turnsElapsed: '지난 턴', cardsUsed: '사용한 카드 수', activeCardsUsed: '사용한 액티브 카드 수', turnCardsUsed: '이번 턴 사용 카드 수',
  cardUsesRemaining: '남은 카드 사용 수', doubleCardEffectCards: '스킬 효과 추가 발동 카드 수', halfCostTurns: '체력 소비 절반 턴', doubleCostTurns: '체력 소비 증가 턴',
  nullifyCostCards: '소비 무효 카드 수', nullifyCostActiveCards: '액티브 소비 무효 카드 수', costReduction: '체력 소비 감소', enthusiasmExtensionTurns: '강기 연장 턴',
  doubleBuffCostTurns: '버프 소비 증가 턴', prideTurns: '긍정적 사고 턴', uneaseTurns: '불안 턴', nullifyGenkiTurns: '기운 증가 무효 턴', nullifyDebuff: '약화 무효 횟수',
  concentrationMultiplier: '집중 배율', motivationMultiplier: '의욕 배율', goodConditionTurnsMultiplier: '호조 배율', enthusiasmMultiplier: '열의 배율',
  concentrationDelta: '집중 증가량', genkiDelta: '기운 증가량', goodImpressionTurnsDelta: '호인상 증가량', goodConditionTurnsDelta: '호조 증가량',
  consumedGenki: '소비한 기운', consumedGoodImpressionTurns: '소비한 호인상', consumedStamina: '소비한 체력',
  deck: '산패', discarded: '버림패', hand: '손패', held: '보류', removed: '제외 카드', active: '액티브 카드', stance: '태세', prevStance: '이전 태세',
  'g.score': '해당 카드의 점수 효과', 'g.scoreTimes': '해당 카드의 공격 횟수', 'g.cost': '해당 카드의 소비 체력', 'g.genki': '해당 카드의 기운 효과',
  'g.fullPowerCharge': '해당 카드의 전력치 효과', 'g.typedCost': '해당 카드의 버프 소비',
};
const phases = { endOfTurn: '턴 종료 시', startOfTurn: '턴 시작 시', turn: '턴 시작 시', everyTurn: '매 턴', startOfStage: '시험 시작 시',
  beforeStartOfTurn: '턴 시작 처리 전', afterStartOfTurn: '턴 시작 처리 후', activeCardUsed: '액티브 카드 사용 시', afterActiveCardUsed: '액티브 카드 사용 후',
  mentalCardUsed: '멘탈 카드 사용 시', afterMentalCardUsed: '멘탈 카드 사용 후', afterCardUsed: '카드 사용 후', cardUsed: '카드 사용 시',
  stanceChanged: '태세 전환 시', stanceValueChanged: '태세 단계 변경 시', cardRemoved: '카드 제외 시', cardMovedToHand: '카드가 손패로 이동할 때',
  concentrationIncreased: '집중 증가 시', genkiIncreased: '기운 증가 시', fullPowerChargeIncreased: '전력치 증가 시', motivationIncreased: '의욕 증가 시',
  goodImpressionTurnsIncreased: '호인상 증가 시', goodConditionTurnsIncreased: '호조 증가 시', staminaDecreased: '체력 감소 시', buffCostConsumed: '버프 소비 시' };

function expression(value) {
  if (!value) return { text: '수치 미확인', known: false };
  if (value.type === 'number') return { text: String(value.value), known: true };
  if (value.type === 'identifier') return { text: stateNames[value.name] ?? '상세 상태 조건', known: Boolean(stateNames[value.name]) };
  if (value.type === 'unary') { const item = expression(value.argument ?? value.value ?? value.operand); return { text: value.op === '!' ? `${item.text} 아님` : `${value.op}${item.text}`, known: item.known }; }
  if (['comparison', 'binary'].includes(value.type)) {
    const left = expression(value.left), right = expression(value.right);
    const op = { '>=': '이상', '<=': '이하', '>': '초과', '<': '미만', '==': '동일', '===': '동일', '!=': '아님', '!==': '아님', '*': '×', '/': '÷', '&&': '및', '||': '또는' }[value.op] ?? value.op;
    return { text: ['>=', '<=', '>', '<'].includes(value.op) ? `${left.text} ${right.text} ${op}` : `${left.text} ${op} ${right.text}`, known: left.known && right.known };
  }
  return { text: '추가 조건은 원문 확인', known: false };
}

function useConditionNodes(value) {
  if (Array.isArray(value)) return value.flatMap(useConditionNodes);
  if (!value || typeof value !== 'object') return [value];
  if (value.type) return [value];
  // Public card conditions are effect-sequence wrappers, while conditions
  // inside an installed effect are already individual AST predicates.
  return Array.isArray(value.conditions) ? value.conditions.flatMap(useConditionNodes) : [value];
}

function actionText(action, definitions) {
  if (action.type === 'assignment') {
    const value = expression(action.rhs), name = stateNames[action.lhs];
    // Public cost deltas are signed resource changes: a negative cost consumes
    // more. The Korean label describes consumption, so invert additive signs.
    const consumption = action.lhs === 'cost' || action.lhs === 'g.cost';
    const operator = action.op === '+=' ? consumption ? '−' : '+' : action.op === '-=' ? consumption ? '+' : '−' : action.op === '*=' ? '×' : action.op;
    return { text: name ? `${name} ${operator} ${value.text}` : '추가 효과는 원문 확인', known: Boolean(name) && value.known };
  }
  if (action.type === 'call') {
    const args = list(action.args).map(expression);
    if (action.name === 'drawCard') return { text: `카드 ${args[0]?.text ?? '미확인'}장 드로우`, known: Boolean(args[0]?.known) };
    if (action.name === 'setStance') return { text: `${args[0]?.text ?? '지정 태세'}로 전환`, known: Boolean(args[0]?.known) };
    if (action.name === 'holdCard') {
      const id = action.args?.[0]?.value, card = definitions.cards.find(card => Number(card.publicId) === id);
      return { text: `${card?.nameKo ?? card?.nameJa ?? '지정 스킬 카드'} 보류로 회수`, known: Boolean(card) };
    }
    if (action.name === 'holdSelected') return { text: '선택한 카드를 보류', known: true };
    if (action.name === 'removeDebuffs') return { text: '약화 효과 제거', known: true };
    const labels = { setGoodImpressionTurnsBuff: '호인상 증가 보너스', setGoodImpressionTurnsEffectBuff: '호인상 효과 보너스',
      setGoodImpressionTurnsTimesBuff: '호인상 효과 횟수 보너스', setScoreBuff: '점수 효과 보너스', setScoreDebuff: '점수 효과 감소',
      setEnthusiasmBonus: '열의 보너스', setEnthusiasmBuff: '열의 보너스', setConcentrationEffectBuff: '집중 효과 보너스', setConcentrationBuff: '집중 보너스',
      setConcentrationAdditionBuff: '집중 증가 보너스', setMotivationAdditionBuff: '의욕 증가 보너스', setMotivationBuff: '의욕 보너스',
      setFullPowerEffectBuff: '전력 효과 보너스', setFullPowerChargeBuff: '전력치 증가 보너스', setGoodConditionTurnsBuff: '호조 증가 보너스', setStrengthEffectBuff: '강기 효과 보너스',
      moveRandomToHand: '조건 카드 무작위로 손패 이동', moveRandomToTopOfDeck: '조건 카드 무작위로 산패 위 이동', addCardToTopOfDeck: '지정 카드 산패 위에 추가', useRandomCardFree: '조건 카드 무작위 무료 사용' };
    if (labels[action.name]) return { text: `${labels[action.name]} · 세부 수치는 효과 원문 확인`, known: false };
  }
  return { text: '추가 효과는 원문 확인', known: false };
}

function sequences(groups, definitions, prefix = '사용 시', depth = 0) {
  if (depth > 8) return [];
  return list(groups).flatMap(group => {
    const conditions = list(group.conditions).map(expression), actions = list(group.actions).map(action => actionText(action, definitions));
    const timing = phases[group.phase] ?? (group.phase ? '기타 발동 시점 · 원문 확인' : prefix);
    const row = { timing, phase: group.phase ?? null, conditions: conditions.map(row => row.text), effects: actions.map(row => row.text),
      limit: number(group.limit), limitScope: 'public_sequence_scope_not_assumed_per_turn', fullyTranslated: conditions.every(row => row.known) && actions.every(row => row.known),
      conditionsRaw: list(group.conditions), actionsRaw: list(group.actions) };
    return [...(actions.length || conditions.length ? [row] : []), ...sequences(group.effects, definitions, `${timing} 이후 설치되는 효과`, depth + 1)];
  });
}

export function knownRank(owned, fields, stages) {
  const rank = fields.map(field => rankOf(owned?.[field] ?? owned?.raw?.[field])).find(value => value !== null) ?? null;
  if (rank === null || rank > stages.length || Array.from({ length: rank }, (_, index) => stages.filter(stage => stage.rank === index + 1).length).some(count => count !== 1)) return null;
  return rank;
}

function ruleStage(rule, context, source, targetContext, catalog) {
  const cardRefs = list(rule.cardRefs).map(ref => {
    const card = list(catalog.skillCards).find(card => idOf(card) === ref.gameId && card.upgradeCount === 0), present = targetContext.targets.filter(card => card.gameId === ref.gameId);
    const acquire = targetContext.canAcquire(ref.gameId);
    return { ...ref, nameKo: card?.nameKo ?? ref.nameKo, nameJa: card?.nameJa ?? ref.nameJa, imageUrl: card?.thumbnailUrl ?? card?.imageUrl ?? ref.imageUrl ?? null,
      availability: present.find(card => card.availability === 'at_start')?.availability ?? present[0]?.availability ?? (acquire === true ? 'conditional_during' : acquire === false ? 'locked_or_incompatible' : 'unknown'),
      obtainedInCurrentRun: false, sourceCardRequired: true };
  });
  return { ...rule, cardRefs, sourceRefs: [{ sourceId: source.id, author: source.author, title: source.title, publishedAt: source.publishedAt,
    url: rule.url ?? `${source.url}&t=${Math.floor(rule.segment?.startSec ?? 0)}s`, startSec: rule.segment?.startSec ?? null, endSec: rule.segment?.endSec ?? null }],
    sourceStatementVerified: rule.sourceStatementVerified === true, currentAccountRecipeValidated: false, optimalPlayOrderVerified: false,
    cardAvailabilityStatus: cardRefs.some(card => card.availability === 'locked_or_incompatible') ? 'locked_cards' : cardRefs.some(card => card.availability === 'unknown') ? 'unknown_cards' : cardRefs.some(card => card.availability === 'conditional_during') ? 'during_acquisition_required' : 'target_cards_present_or_not_specified',
    nativeConditionIsIndependentOfSourceExample: true, context };
}

/** Conditional operating notes; reads effect definitions without running combat. */
export function buildIdolOperatingGuidance({ result = {}, catalog = {}, inventory = {}, options = {} } = {}) {
  const data = catalog.multiCreatorGuidance;
  const selectedId = idOf(result.selectedIdol) ?? options.idolGameId ?? options.idolId;
  const card = list(catalog.idolCards).find(card => idOf(card) === selectedId) ?? result.selectedIdol;
  const owned = list(inventory.idolCards).find(card => idOf(card) === selectedId) ?? (result.selectedIdol?.ownershipVerified ? result.selectedIdol.owned : null);
  const context = { idolGameId: selectedId ?? null, scenario: result.scoreSummary?.scenario ?? options.scenario ?? 'hif', plan: result.scoreSummary?.plan ?? card?.plan ?? options.plan ?? null,
    trainingType: typeOf(result.scoreSummary?.trainingType ?? options.trainingType), difficulty: result.scoreSummary?.difficulty ?? options.difficulty ?? null, producerLevel: number(options.producerLevel ?? inventory.producerLevel),
    eventModeId: options.eventModeId ?? null, modeFamily: options.eventModeId?.startsWith('asari') || options.hifMode === 'asari' ? 'asari' : 'normal_hif' };
  const empty = { status: !data ? 'source_data_unavailable' : 'selected_idol_unconfirmed', context, uniqueSkills: [], uniqueItems: [], keyActions: [], stages: { setup: [], burst: [], finish: [], attention: [] },
    sourceProfiles: [], conditionalSourceProfiles: [], futureSourceProfiles: [], sources: [], battleSimulationExecuted: false, optimalPlayOrderVerified: false };
  if (!data || !selectedId || !card) return empty;
  const profile = list(data.idolProfiles).find(profile => profile.idolGameId === selectedId), definitions = data.uniqueDefinitions ?? { cards: [], items: [] };
  const specialRank = knownRank(owned, ['levelLimitRank', 'uncap', 'specialTrainingRank'], list(card.specialTrainingStages));
  const potentialRank = knownRank(owned, ['potentialRank', 'awakening', 'awakeningRank'], list(card.awakeningStages));
  const stagesPassed = specialRank === null ? [] : list(card.specialTrainingStages).filter(stage => stage.rank <= specialRank);
  const uniqueSkills = list(profile?.uniqueCardIds).flatMap((gameId, index) => {
    const effectType = index === 0 ? 'IdolCardLevelLimitEffectType_ProduceCardUpgrade' : 'IdolCardLevelLimitEffectType_SecondProduceCardUpgrade';
    const selectedUpgrade = specialRank === null ? null : stagesPassed.filter(stage => list(stage.effectTypes).includes(effectType)).length;
    const available = profile.nativeMaster ? list(catalog.skillCards) : list(definitions.cards);
    const variants = available.filter(row => row.gameId === gameId && (selectedUpgrade === null || row.upgradeCount === selectedUpgrade));
    return variants.map(variant => {
      const native = profile.nativeMaster ? variant : list(data.nativeUniqueGraph?.ProduceCard).find(row => row.id === gameId && row.upgradeCount === variant.upgradeCount);
      const definition = variant.publicDefinitionIdentityVerified ? variant.publicDefinition : null;
      const conditionNodes = useConditionNodes(list(definition?.conditions)), useConditions = conditionNodes.map(expression);
      return { gameId, nameKo: variant.nameKo, nameJa: variant.nameJa, imageUrl: variant.imageUrl, upgradeCount: variant.upgradeCount,
        variantStatus: selectedUpgrade === null ? 'unknown_current_variant' : 'current_owned_variant', selectedForCurrentAccount: selectedUpgrade === null ? null : true,
        nativeReferenceAvailable: Boolean(native) && (profile.nativeMaster || variant.nativeRootKnown === true), identityStatus: variant.identityStatus, effectDefinitionIdentityVerified: variant.publicDefinitionIdentityVerified === true,
        useConditions: useConditions.map(row => row.text), useConditionsRaw: list(definition?.conditions), useConditionNodesRaw: conditionNodes,
        useConditionScope: 'before_card_use_not_cost_or_installed_effect_activation', useConditionsFullyTranslated: Boolean(definition) && useConditions.every(row => row.known),
        cost: native ? { stamina: native.stamina, forceStamina: native.forceStamina, costType: native.costType, costValue: native.costValue } : null,
        effectSummaryKo: variant.effectSummaryKo ?? null,
        costEffects: sequences(definition?.cost, definitions, '사용 비용'), effectSequences: [...sequences(definition?.actions, definitions), ...sequences(definition?.effects, definitions, '설치 효과')],
        rawEffectDefinition: definition, arithmeticFullyVerified: false, currentHandCaptured: false, sourceIds: profile.nativeMaster ? profile.sourceIds : ['native-unique-ProduceCard', 'public-unique-effect-definitions'] };
    });
  });
  const itemUpgraded = potentialRank === null ? null : list(card.awakeningStages).some(stage => stage.rank <= potentialRank && list(stage.effectTypes).includes('IdolCardPotentialEffectType_InitialProduceItemChange'));
  const expectedItemIds = itemUpgraded === null ? list(profile?.uniqueItemIds) : [profile?.uniqueIds?.[itemUpgraded ? 'afterProduceItemId' : 'beforeProduceItemId']].filter(Boolean);
  const uniqueItems = expectedItemIds.map(gameId => {
    const variant = (profile.nativeMaster ? list(catalog.pItems) : list(definitions.items)).find(row => row.gameId === gameId);
    const native = profile.nativeMaster ? variant : list(data.nativeUniqueGraph?.ProduceItem).find(row => row.id === gameId);
    const itemEffects = profile.nativeMaster ? list(native?.nativeItemEffects)
      : list(native?.produceItemEffectIds).map(id => list(data.nativeUniqueGraph?.ProduceItemEffect).find(row => row.id === id)).filter(Boolean);
    return { gameId, nameKo: null, nameJa: variant?.nameJa ?? native?.name ?? null, imageUrl: list(catalog.pItems).find(item => idOf(item) === gameId)?.thumbnailUrl ?? null,
      isUpgraded: variant?.isUpgraded ?? native?.isUpgraded ?? null, variantStatus: itemUpgraded === null ? 'unknown_current_variant' : 'current_owned_variant', selectedForCurrentAccount: itemUpgraded === null ? null : true,
      nativeReferenceAvailable: Boolean(native) && (profile.nativeMaster || variant?.nativeRootKnown === true), identityStatus: variant?.identityStatus ?? 'unknown',
      effectDefinitionIdentityVerified: variant?.publicDefinitionIdentityVerified === true,
      effectSummaryKo: variant?.effectSummaryKo ?? null,
      effectSequences: sequences(variant?.publicDefinitionIdentityVerified ? variant.publicDefinition?.effects : [], definitions, '고유 P아이템 효과'), rawEffectDefinition: variant?.publicDefinitionIdentityVerified ? variant.publicDefinition : null,
      nativeItemEffects: itemEffects, nativeOriginIdolCardId: native?.originIdolCardId ?? null, arithmeticFullyVerified: false,
      sourceIds: profile.nativeMaster ? profile.sourceIds : ['native-unique-ProduceItem', 'native-unique-ProduceItemEffect', 'native-unique-ProduceExamStatusEnchant', 'native-unique-ProduceExamTrigger', 'public-unique-effect-definitions'] };
  });
  const targetContext = buildHifAbilityTargetContext({ result, catalog, inventory, options: { ...options, ...context }, selectedIdol: owned ? { ...card, ownershipVerified: true, owned } : card, memories: list(result.memories) });
  const sourceProfiles = [], conditionalSourceProfiles = [], futureSourceProfiles = [], notApplicableProfiles = [];
  const bySource = new Map(list(data.sources).map(source => [source.id, source]));
  for (const sourceProfile of list(data.sourceProfiles)) {
    const source = bySource.get(sourceProfile.sourceId) ?? {};
    const exactRules = list(sourceProfile.rules).filter(rule => (!list(rule.idolIds).length || list(rule.idolIds).includes(selectedId)) && (!rule.plan || rule.plan === context.plan) &&
      (!rule.trainingType || rule.trainingType === 'general' || rule.trainingType === context.plan || typeOf(rule.trainingType) === context.trainingType));
    if (sourceProfile.scenario !== context.scenario || sourceProfile.difficulty && context.difficulty && sourceProfile.difficulty !== context.difficulty || !exactRules.length || sourceProfile.plan && sourceProfile.plan !== context.plan) {
      notApplicableProfiles.push({ id: sourceProfile.id, reason: sourceProfile.scenario !== context.scenario ? 'scenario_mismatch' : sourceProfile.difficulty && context.difficulty && sourceProfile.difficulty !== context.difficulty ? 'difficulty_mismatch' : 'exact_idol_plan_or_training_mismatch' }); continue;
    }
    const requirements = [], minimum = sourceProfile.requirements?.authorRecommendedProducerLevel;
    const sourceAsari = String(sourceProfile.eventModeScope ?? '').includes('asari');
    const eventMatches = context.modeFamily === 'asari' ? sourceAsari : !sourceAsari;
    if (!eventMatches) requirements.push({ kind: 'event_scope', fulfilled: false, label: '일반 HIF 운영 사례이며 현재 아사리 전체 재현은 미검증' });
    if (eventMatches && sourceAsari && sourceProfile.eventModeId !== context.eventModeId) requirements.push({ kind: 'event_round', fulfilled: null, label: '원문의 아사리 회차와 현재 이벤트의 세부 조건이 같은지 미검증' });
    if (sourceProfile.difficulty && !context.difficulty) requirements.push({ kind: 'difficulty', fulfilled: null, required: sourceProfile.difficulty, label: '원문 난이도 조건이 현재 설정과 맞는지 확인이 필요합니다.' });
    if (number(minimum) !== null) requirements.push({ kind: 'source_complete_loop_producer_level', minimum, actual: context.producerLevel,
      fulfilled: context.producerLevel === null ? null : context.producerLevel >= minimum, universalGameUnlock: false,
      label: `작성자가 제시한 완성 운영의 PLv${minimum} 권장 전제 · 실제 게임 해금과 별개` });
    if (!owned || exactRules.some(rule => rule.futureReferenceOnly)) requirements.push({ kind: 'owned_idol', fulfilled: Boolean(owned), label: owned ? '정확한 P아이돌 보유 확인' : '현재 미보유 사양의 미래 참고' });
    const rules = exactRules.map(rule => ruleStage(rule, context, source, targetContext, catalog));
    const row = { ...sourceProfile, rules, requirements, observedRunContexts: list(sourceProfile.observedRunContexts).filter(run => !list(run.idolIds).length || list(run.idolIds).includes(selectedId)),
      exactIdolSpecificRuleCount: rules.filter(rule => list(rule.idolIds).includes(selectedId)).length,
      status: requirements.some(row => row.kind === 'source_complete_loop_producer_level' && row.fulfilled === false || row.kind === 'owned_idol' && row.fulfilled === false) ? 'future_source_reference' :
        requirements.some(row => row.fulfilled !== true) ? 'conditional_source_reference' : 'source_condition_matches_not_validated_recipe',
      actualSourceRunComparedWithCurrentAccount: false, sourceRefs: [source] };
    if (row.status === 'future_source_reference') futureSourceProfiles.push(row);
    else if (row.status === 'conditional_source_reference') conditionalSourceProfiles.push(row);
    else sourceProfiles.push(row);
  }
  const stages = { setup: [], burst: [], finish: [], attention: [] };
  for (const profile of sourceProfiles) for (const rule of profile.rules) if (rule.purpose !== 'post_produce_memory_crafting') stages[rule.stage in stages ? rule.stage : 'attention'].push(rule);
  const keyActions = [];
  const selectedSkillRows = uniqueSkills.filter(row => row.selectedForCurrentAccount === true), selectedItemRows = uniqueItems.filter(row => row.selectedForCurrentAccount === true);
  const atmosphere = selectedId === 'i_card-kllj-3-015' && profile?.identityVerified &&
    selectedSkillRows.every(row => row.nativeReferenceAvailable && row.effectDefinitionIdentityVerified) && selectedItemRows.every(row => row.nativeReferenceAvailable && row.effectDefinitionIdentityVerified) &&
    ['e_trigger-exam_end_turn-not-full_power_point_up-10', 'e_trigger-exam_end_turn-full_power_point_up-10'].every(id => list(data.nativeUniqueGraph?.ProduceExamTrigger).some(row => row.id === id));
  if (atmosphere && selectedSkillRows.length && selectedItemRows.length) {
    const currentSkill = selectedSkillRows[0];
    keyActions.push({ id: 'atmosphere-current-unique-cost', stage: 'setup', text: `${currentSkill.nameKo ?? currentSkill.nameJa}의 현재 사양은 전력치 ${currentSkill.cost?.costValue ?? '미확인'}를 소비합니다. 사용 수 추가와 설치 효과를 보고 턴 끝의 전력치 조건을 따로 계획하세요.`,
      cardRefs: [{ gameId: currentSkill.gameId, upgradeCount: currentSkill.upgradeCount, nameKo: currentSkill.nameKo, nameJa: currentSkill.nameJa, imageUrl: currentSkill.imageUrl }],
      sourceIds: currentSkill.sourceIds, conditional: true, optimalOrderClaimed: false });
    keyActions.push({ id: 'atmosphere-end-turn-score', stage: 'burst', text: '턴 끝 전력치 9 이하에서 고유 스킬의 설치 점수 효과가 발동합니다. 고유 스킬을 누르는 시점의 사용 조건과 구분하세요.',
      cardRefs: selectedSkillRows.map(row => ({ gameId: row.gameId, upgradeCount: row.upgradeCount, nameKo: row.nameKo, nameJa: row.nameJa, imageUrl: row.imageUrl })),
      sourceIds: ['native-unique-ProduceCard', 'native-unique-ProduceExamStatusEnchant', 'native-unique-ProduceExamTrigger'], conditional: true, optimalOrderClaimed: false });
    keyActions.push({ id: 'atmosphere-end-turn-retrieve', stage: 'setup', text: '턴 끝 전력치 10 이상에서는 고유 P아이템이 고유 스킬 회수 등을 발동합니다. 9 이하 점수 조건과 같은 턴 끝에 동시에 만족시키지 못합니다.',
      itemRefs: selectedItemRows.map(row => ({ gameId: row.gameId, nameJa: row.nameJa, imageUrl: row.imageUrl })), sourceIds: selectedItemRows.flatMap(row => row.sourceIds), conditional: true, optimalOrderClaimed: false });
  }
  for (const skill of atmosphere ? [] : selectedSkillRows) {
    if (keyActions.length >= 4) break;
    const sequence = skill.effectSequences.find(row => row.conditions.length) ?? skill.effectSequences[0];
    if (sequence) keyActions.push({ id: `unique-skill-${skill.gameId}`, stage: 'attention', text: skill.effectSummaryKo ?? `${skill.nameKo ?? skill.nameJa}: ${sequence.timing}${sequence.conditions.length ? ' · ' + sequence.conditions.join(' / ') : ''} · ${sequence.effects.join(' · ')}`,
      cardRefs: [{ gameId: skill.gameId, upgradeCount: skill.upgradeCount, nameKo: skill.nameKo, nameJa: skill.nameJa, imageUrl: skill.imageUrl }], sourceIds: skill.sourceIds, conditional: true, optimalOrderClaimed: false });
  }
  for (const item of atmosphere ? [] : selectedItemRows) {
    if (keyActions.length >= 4) break;
    const sequence = item.effectSequences.find(row => row.conditions.length) ?? item.effectSequences[0];
    if (sequence) keyActions.push({ id: `unique-item-${item.gameId}`, stage: 'attention', text: item.effectSummaryKo ?? `${item.nameJa}: ${sequence.timing}${sequence.conditions.length ? ' · ' + sequence.conditions.join(' / ') : ''} · ${sequence.effects.join(' · ')}`,
      itemRefs: [{ gameId: item.gameId, nameJa: item.nameJa, imageUrl: item.imageUrl }], sourceIds: item.sourceIds, conditional: true, optimalOrderClaimed: false });
  }
  for (const rule of [...stages.setup, ...stages.burst, ...stages.finish, ...stages.attention]) {
    if (keyActions.length >= 5) break;
    if (list(rule.actions).length && !['locked_cards', 'unknown_cards'].includes(rule.cardAvailabilityStatus)) keyActions.push({ id: rule.id, stage: rule.stage, text: rule.actions[0], cardRefs: rule.cardRefs, sourceRefs: rule.sourceRefs, conditional: true, optimalOrderClaimed: false });
  }
  const ownIds = new Set(list(inventory.idolCards).map(idOf)), linkedOwned = list(data.idolProfiles).filter(profile => ownIds.has(profile.idolGameId) && profile.identityVerified);
  const characterPolicy=resolveIdolRecipePolicy({catalog,context:idolRecipeContext({result,catalog,inventory,options})}).evidence;
  const policySources=list(catalog.idolRecipePolicies?.sources).filter(source=>characterPolicy.sourceIds.includes(source.id));
  if(characterPolicy.applied){
    const sourceRefs=policySources.map(source=>({sourceId:source.id,title:source.title,url:source.url}));
    const notes=characterPolicy.operatingNotes.map((text,index)=>({id:'character-source-'+characterPolicy.id+'-'+index,stage:'attention',
      text:'이 P카드의 원문 조건 · '+text,actions:[text],sourceIds:characterPolicy.sourceIds,sourceRefs,
      conditional:true,optimalOrderClaimed:false,currentAccountRecipeValidated:false}));
    stages.attention.push(...notes);
    if(notes[0])keyActions.unshift({...notes[0],cardRefs:selectedSkillRows.map(row=>({gameId:row.gameId,nameKo:row.nameKo,nameJa:row.nameJa,imageUrl:row.imageUrl,upgradeCount:row.upgradeCount}))});
    if(keyActions.length>5)keyActions.length=5;
  }
  const sourceIds = new Set([...list(profile?.sourceIds), ...uniqueSkills.flatMap(row => row.sourceIds), ...uniqueItems.flatMap(row => row.sourceIds), ...sourceProfiles.concat(conditionalSourceProfiles, futureSourceProfiles).flatMap(row => row.sourceIds)]);
  return { status: profile?.identityVerified ? 'conditional_exact_idol_operating_guidance' : 'unique_identity_unconfirmed', context,
    selectedIdol: { gameId: selectedId, nameKo: card.nameKo, nameJa: card.nameJa, ownershipVerified: Boolean(owned), specialTrainingRank: specialRank, potentialRank,
      uniqueIdentityVerified: profile?.identityVerified === true, currentVariantConfirmed: specialRank !== null && potentialRank !== null },
    uniqueSkills, uniqueItems, keyActions, keyActionsAreOptimalSequence: false, stages, sourceProfiles, conditionalSourceProfiles, futureSourceProfiles, notApplicableProfiles,
    characterSourcePolicy:{...characterPolicy,usedForSelection:result.scoreSummary?.hifModel?.guideMemoryProfile?.characterPolicy?.usedForSelection===true},
    memoryCraftingAdvice: sourceProfiles.concat(conditionalSourceProfiles, futureSourceProfiles).flatMap(profile => profile.rules.filter(rule => rule.purpose === 'post_produce_memory_crafting')
      .map(rule => ({ ...rule, sourceApplicability: profile.status, requirements: profile.requirements, inheritedSourceScope: profile.eventModeScope, actualCurrentRecipeValidated: false }))),
    existingIonGuidance: { preservedSeparately: true, runFlowGuidanceAvailable: Boolean(result.runFlowGuidance), notReplacedByThisModule: true },
    coverage: { ...data.coverage, ownedIdolVariants: ownIds.size, ownedCharacters: new Set(list(inventory.idolCards).map(card => card.characterId).filter(Boolean)).size,
      nativeLinkedOwnedVariants: linkedOwned.length, nativeLinkedOwnedCharacters: new Set(linkedOwned.map(profile => profile.characterId)).size,
      sourceReviewedExactOwnedVariants: list(data.researchCoverage?.ownedExactIdolVariantsWithSpecificRules).filter(id => ownIds.has(id)),
      allOwnedIdolVideosReviewed: false, currentScenarioSourceProfileCount: sourceProfiles.length, currentAsariExactRecipeVerified: false },
    researchCoverage: data.researchCoverage, nativeSourceAsOf: profile?.nativeMaster ? catalog.dataFreshness?.liveMaster?.publishedAt ?? null : data.nativeSourceAsOf, sourceCheckedAt: data.asOf,
    limitations: [...list(data.limitations), ...(!owned ? ['현재 보유가 확인되지 않은 P아이돌입니다.'] : []),
      ...(specialRank === null || potentialRank === null ? ['특훈 또는 재능개화 단계가 없어 고유 스킬/P아이템의 현재 사양을 확정하지 않았습니다.'] : []),
      '고유 효과 설명은 조건 확인용입니다. 실제 손패·보류 공간·자원·각 턴의 최적 카드 사용 순서를 계산하지 않습니다.',
      '작성자 화면의 PLv·친애도·완성 스탯은 해당 예시의 관측 기록이며 현재 계정이나 모든 플레이의 필수 조건으로 치환하지 않습니다.'],
    sources: [...list(data.sources).filter(source => sourceIds.has(source.id)),...policySources], battleSimulationExecuted: false, optimalPlayOrderVerified: false };
}
