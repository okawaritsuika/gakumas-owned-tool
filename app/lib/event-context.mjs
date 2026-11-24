const list = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values)];
const idOf = row => row?.gameId ?? row?.id;
const nativeSkillOf = memory => memory?.produceCard?.id ?? memory?.raw?.produceCard?.id ?? memory?.modelEffects?.carriedSkill?.id ?? memory?.effects?.carriedSkill?.id;
const knownInteger = value => Number.isInteger(value) && value >= 0 ? value : null;
const typeOf = value => ({ full_power: 'fullPower', enthusiasm: 'strength' })[value] ?? value;
const nameOf = row => row?.nameKo || row?.name || row?.nameJa || idOf(row) || '스킬 미확인';
const trustedUnlockTokens = new WeakMap();

/** Issue only catalog-backed exceptions. JSON copied from a client is not a token. */
export function buildEventUnlockOverrides({ catalog = {}, options = {}, context = {} } = {}) {
  const mode = list(catalog.eventModes?.modes).find(row => row.id === options.eventModeId);
  const plan = context.plan, scenario = context.scenario, trainingType = typeOf(context.trainingType);
  if (!mode || !list(mode.supportedPlans).includes(plan) || !list(mode.supportedScenarios).includes(scenario)) return null;
  if (Array.isArray(mode.supportedTrainingTypes) && mode.supportedTrainingTypes.length && !mode.supportedTrainingTypes.map(typeOf).includes(trainingType)) return null;
  const appearance = mode.additionalAppearance;
  const additionalAppearanceGameIds = appearance?.usedForDuringProduceEligibility === true ? list(appearance.eligibilitySkillIds).filter(gameId => {
    const source = list(appearance.reportedSkills).find(row => row.gameId === gameId);
    const card = list(catalog.skillCards).find(row => idOf(row) === gameId && (row.upgradeCount ?? 0) === 0);
    return source && card && source.nameJa === card.nameJa && source.normalUsePlan === card.plan && card.recommendationEligible !== false;
  }) : [];
  const token = Object.freeze({ validated: true, eventModeId: mode.id, plan, scenario, trainingType: trainingType ?? null,
    producerLevelUnlock: mode.rules?.plvAppearanceWaived === true,
    memoryRentalProducerLevelUnlock: mode.rules?.plvRentalWaived === true || mode.rental?.plvRestrictionWaived === true,
    skillSwitchUnlockWaived: false, crossPlanRentalPermissionGranted: false, accountProducerLevelChanged: false,
    additionalAppearanceGameIds: Object.freeze([...additionalAppearanceGameIds]),
    sourceIds: Object.freeze([...list(mode.sourceIds)]), appliesOnlyToSelectedEvent: true,
    condition: '실제 게임에서 해당 이벤트 모드로 육성할 때에만 적용합니다. 계정 PLv·전환 해금·선택·보유 기록은 바꾸지 않습니다.' });
  trustedUnlockTokens.set(token, catalog);
  return token;
}

/** Consumers must check the actual plan, scenario and same catalog instance. */
export function getTrustedEventUnlockOverrides(options, { catalog, plan, scenario } = {}) {
  const token = options?.eventUnlockOverrides;
  if (!token || typeof token !== 'object' || trustedUnlockTokens.get(token) !== catalog || !catalog ||
    token.eventModeId !== options.eventModeId || token.plan !== plan || token.scenario !== scenario) return null;
  return token;
}

/** Extra appearances can be used during this produce; they are not carry-in permission. */
export function getEventAdditionalAppearanceCandidates(options, context = {}) {
  const token = getTrustedEventUnlockOverrides(options, context);
  if (!token) return [];
  const mode = list(context.catalog.eventModes?.modes).find(row => row.id === token.eventModeId);
  return list(mode?.additionalAppearance?.reportedSkills).filter(row => token.additionalAppearanceGameIds.includes(row.gameId)).map(row => ({
    ...row, sourceIds: [...list(row.sourceIds)], planEligible: true, eventAdditionalAppearance: true,
    acquisitionUseOnly: true, acquisitionGuaranteed: false, ownershipGranted: false,
    eventModeId: token.eventModeId, source: 'event_during_run_target',
  }));
}

export function getEventAdditionalAppearance(options, { gameId, ...context } = {}) {
  return getEventAdditionalAppearanceCandidates(options, context).find(row => row.gameId === gameId) ?? null;
}

/** Event declarations are separate from owned cards and never modify their bonuses. */
export function buildEventContext({ result = {}, inventory = {}, catalog = {}, options = {} } = {}) {
  const issues = [], issue = (severity, code, message, gameId) => issues.push({ severity, code, message, ...(gameId ? { gameId } : {}) });
  const rawIds = options.eventRentalSkillIds ?? [], modeId = typeof options.eventModeId === 'string' ? options.eventModeId.trim() : null;
  if (!Array.isArray(rawIds) || rawIds.some(id => typeof id !== 'string' || !id.trim())) issue('invalid', 'invalid_event_rental_skill_ids', '이벤트 렌탈 검색 스킬은 정확한 ID 목록으로 지정해야 합니다.');
  if (options.eventModeId != null && typeof options.eventModeId !== 'string') issue('invalid', 'invalid_event_mode_id', '이벤트 모드는 정확한 ID로 지정해야 합니다.');
  const requestedIds = unique(list(rawIds).filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()));
  if (Array.isArray(rawIds) && rawIds.length !== requestedIds.length && !issues.length) issue('invalid', 'duplicate_event_rental_skill', '같은 스킬을 이벤트 렌탈 슬롯 여러 개로 중복 지정하지 않습니다.');
  const base = { modeId, asOf: catalog.eventModes?.asOf ?? null, status: 'disabled', requestedSkillIds: requestedIds,
    selectedSkills: [], memoryTargets: [], acquisitionCandidates: [], sources: [], readinessConfirmed: false,
    accountInventoryUnchanged: true, ownedMemorySelectionUnchanged: true, recommendationApplied: false,
    comparison: { available: false, statDelta: null, reason: '렌탈 메모리의 실제 능력치·합류 시점·강화·커스텀을 확인하기 전에는 보유 편성의 수치와 합산하지 않습니다.' },
    validation: { status: 'not_requested', acceptedGameIds: [], pendingGameIds: [], issues },
    limitations: ['이벤트 렌탈 검색 목표와 실제 보유 메모리는 별개입니다. 선택한 스킬 ID만으로 렌탈 사본을 보유했다고 판정하지 않습니다.'] };
  if (!modeId) {
    if (requestedIds.length) issue('invalid', 'event_mode_required', '렌탈 검색 스킬을 지정하려면 이벤트 모드를 먼저 선택해야 합니다.');
    return { ...base, status: issues.length ? 'invalid_selection' : 'disabled', validation: { ...base.validation, status: issues.length ? 'invalid' : 'not_requested' } };
  }
  const mode = list(catalog.eventModes?.modes).find(row => row.id === modeId);
  if (!mode) {
    issue('pending', 'event_rules_not_loaded', '이 이벤트의 공식 대상·렌탈 규칙을 아직 확인하지 못해 적용하지 않았습니다.');
    const invalid = issues.some(row => row.severity === 'invalid');
    return { ...base, status: invalid ? 'invalid_selection' : 'pending_rules',
      validation: { ...base.validation, status: invalid ? 'invalid' : 'pending', pendingGameIds: requestedIds } };
  }
  const rental = mode.rental ?? {}, rules = mode.rules ?? {};
  const plan = result.selectedIdol?.plan ?? result.scoreSummary?.plan ?? options.plan;
  const trainingType = typeOf(result.scoreSummary?.trainingType ?? options.trainingType ?? options.type);
  const scenario = result.scoreSummary?.scenario ?? options.scenario ?? 'hif';
  const unlockOverrides = getTrustedEventUnlockOverrides(options, { catalog, plan, scenario });
  const plans = mode.supportedPlans, types = mode.supportedTrainingTypes, scenarios = mode.supportedScenarios;
  if (Array.isArray(plans) && plans.length) {
    if (!plan || plan === 'free') issue('pending', 'produce_plan_unknown', '육성 대상의 실제 플랜을 먼저 확인해야 합니다.');
    else if (!plans.includes(plan)) issue('invalid', 'event_plan_not_supported', '이 이벤트의 확인된 대상 플랜에 현재 P아이돌이 포함되지 않습니다.');
  } else issue('pending', 'event_plan_scope_unknown', '이벤트 대상 플랜의 공식 범위가 미확인입니다.');
  if (Array.isArray(types) && types.length && !types.map(typeOf).includes(trainingType)) issue('invalid', 'event_training_type_not_supported', '현재 육성 유형은 이 이벤트의 확인된 대상 유형이 아닙니다.');
  if (Array.isArray(scenarios) && scenarios.length && !scenarios.includes(scenario)) issue('invalid', 'event_scenario_not_supported', '현재 시나리오는 이 이벤트의 확인된 대상이 아닙니다.');
  if (!Array.isArray(scenarios) || !scenarios.length) issue('pending', 'event_scenario_scope_unknown', '이벤트를 적용할 수 있는 시나리오 범위가 미확인입니다.');
  if (mode.eligibility?.requiresInGameEligibilityCheck === true) issue('pending', 'in_game_event_eligibility_required', '현재 P아이돌·육성 유형이 게임의 이벤트 대상 화면에 표시되는지 확인해야 합니다.');
  const slotLimit = knownInteger(rental.slotLimit), totalMemorySlots = knownInteger(rental.totalMemorySlots);
  if (requestedIds.length && slotLimit == null) issue('pending', 'rental_slot_limit_unknown', '이벤트 렌탈 슬롯 수를 아직 확정하지 못했습니다.');
  if (slotLimit != null && requestedIds.length > slotLimit) issue('invalid', 'event_rental_slot_limit_exceeded', `확인된 렌탈 메모리 슬롯은 ${slotLimit}개입니다. 가져갈 메모리 전체 슬롯과 구분합니다.`);
  const pool = rental.availableRentalSkillIds ?? mode.availableRentalSkillIds;
  if (requestedIds.length && !Array.isArray(pool)) issue('pending', 'actual_rental_pool_unknown', '현재 렌탈 목록이 수집되지 않았습니다. 지정한 ID는 검색 목표이며 지금 빌릴 수 있다고 확인한 카드가 아닙니다.');
  const poolIds = new Set(list(pool).map(row => typeof row === 'string' ? row : idOf(row)));
  const selectedSkills = requestedIds.map(gameId => {
    const card = list(catalog.skillCards).find(row => idOf(row) === gameId && (row.upgradeCount ?? 0) === 0);
    if (Array.isArray(pool) && !poolIds.has(gameId)) issue('invalid', 'skill_not_in_verified_event_pool', '확인된 이벤트 렌탈 목록에 이 스킬이 없습니다.', gameId);
    if (!card) issue('pending', 'event_skill_identity_unknown', '이 스킬 ID와 카드 원자료를 정확히 연결하지 못했습니다.', gameId);
    if (card && card.plan !== 'free' && card.plan !== plan) {
      if (rules.crossPlanRentalAllowed === false) issue('invalid', 'event_rental_wrong_plan', '현재 플랜에서 이 렌탈 스킬을 사용할 수 없습니다.', gameId);
      else issue('pending', 'cross_plan_rental_rule_unknown', '다른 플랜의 스킬 렌탈 예외는 확인되지 않았습니다. 추가 등장 규칙을 렌탈 허용으로 대신하지 않습니다.', gameId);
    }
    return { gameId, name: nameOf(card), nameJa: card?.nameJa ?? null, nameKo: card?.nameKo ?? null, plan: card?.plan ?? null,
      imageUrl: card?.thumbnailUrl ?? card?.imageUrl ?? null, imageRepresents: 'base_skill_identity_not_selected_memory',
      source: 'event_rental_search_target', owned: false, actualRentalSelected: false, upgradeCount: null, acquisitionPhase: null, customizations: null,
      statBonus: { status: 'unknown', vocal: null, dance: null, visual: null, stamina: null },
      ownedMemoryIdsWithSameSkill: list(inventory.memories).filter(memory => nativeSkillOf(memory) === gameId).map(idOf),
      guideRoleFulfilled: null, reason: '실제 렌탈 사본의 강화·합류 시점·커스텀·어빌리티를 확인한 뒤 선택합니다.' };
  });
  if (requestedIds.length) issue('pending', 'rental_memory_details_required', '스킬 ID만으로는 실제 렌탈 메모리의 능력치·강화·합류 시점·커스텀을 알 수 없어 보유 편성에 넣지 않았습니다.');
  const allMemoryTargets = list(mode.memoryGoals).map(goal => {
    const card = list(catalog.skillCards).find(row => idOf(row) === goal.gameId && (row.upgradeCount ?? 0) === 0);
    const owned = list(inventory.memories).filter(memory => nativeSkillOf(memory) === goal.gameId);
    return { ...goal, name: nameOf(goal), imageUrl: card?.thumbnailUrl ?? card?.imageUrl ?? null,
      source: 'event_memory_goal_reference', ownedMemoryIds: owned.map(idOf), ownedMemoryCount: owned.length,
      rentalSearchRequested: requestedIds.includes(goal.gameId), actualRentalAvailable: null, roleFulfilled: null,
      recommendedAction: owned.length ? 'compare_actual_owned_copies_then_rental_details' : 'search_actual_event_rental_and_plan_future_memory_creation',
      requirementCheck: 'target_conditions_not_verified_on_an_actual_rental_memory',
      outsideEventProducerLevel: goal.normalUnlockProducerLevel ?? card?.unlockProducerLevel ?? null,
      eventRentalProducerLevelWaived: rental.plvRestrictionWaived === true || rules.plvRentalWaived === true,
      accountProducerLevelChanged: false };
  });
  const memoryTargets = allMemoryTargets.filter(goal => !goal.normalUsePlan || goal.normalUsePlan === 'free' || goal.normalUsePlan === plan);
  const otherPlanMemoryTargets = allMemoryTargets.filter(goal => goal.normalUsePlan && goal.normalUsePlan !== 'free' && goal.normalUsePlan !== plan)
    .map(goal => ({ ...goal, recommendedForCurrentPlan: false, scope: 'future_other_plan_only' }));
  const invalid = issues.some(row => row.severity === 'invalid'), pending = issues.some(row => row.severity === 'pending');
  const switches=options.skillCardSwitchSettings??inventory.skillCardSwitchSettings;
  const actualLevel=knownInteger(options.producerLevel??inventory.producerLevel);
  const acquisitionCandidates=getEventAdditionalAppearanceCandidates(options,{catalog,plan,scenario}).map(row=>{
    const card=list(catalog.skillCards).find(card=>idOf(card)===row.gameId&&(card.upgradeCount??0)===0);
    const native=catalog.memoryEffectDetails?.tables?.ProducerLevelUnlocks?.[row.gameId];
    const required=knownInteger(native?.level??row.normalUnlockProducerLevel??card?.unlockProducerLevel);
    const requiresSwitch=native?.type==='ProducerLevelUnlockType_ProduceCardConversion'||row.normalRequiresSkillSwitch===true||card?.requiresSkillCardSwitch===true;
    const switchUnlocked=!requiresSwitch?true:actualLevel==null||required==null?null:actualLevel>=required;
    const switchEligible=!requiresSwitch?true:switches?.[row.gameId]===true?true:switches?.[row.gameId]===false?false:null;
    const producerLevelWaivedByEvent=!requiresSwitch&&unlockOverrides?.producerLevelUnlock===true;
    const levelEligible=producerLevelWaivedByEvent?true:actualLevel==null||required==null?null:actualLevel>=required;
    const checks=[Boolean(card),levelEligible,switchUnlocked,switchEligible];
    const availability=checks.includes(false)?'locked':checks.includes(null)?'unknown':'eligible';
    return {...row,name:nameOf(row).trim(),nameKo:row.nameKo?.trim()??null,nameJa:row.nameJa,
      imageUrl:card?.thumbnailUrl??card?.imageUrl??row.characterIconUrls?.[result.selectedIdol?.characterId]??null,
      characterIconUrls:card?.characterIconUrls??row.characterIconUrls??{},plan:card?.plan??row.normalUsePlan,
      availability,access:{planEligible:true,eventAdditionalAppearance:true,requiredProducerLevel:required,
        actualProducerLevel:actualLevel,producerLevelWaivedByEvent,requiresSwitch,switchUnlocked,switchEligible},
      actualOffered:null,acquisitionGuaranteed:false,owned:false,usageConditionStatus:'check_actual_resources_and_deck',
      conditions:['실제 아사리 이벤트 모드에서 이번 회차 추가 목록이 제시될 때의 후보입니다.',
        ...(requiresSwitch?['스킬 카드 스위치의 실제 PLv 해금과 선택을 확인해야 합니다.']:[]),...list(row.useConditions)]};
  });
  const sourceIds = new Set([...list(mode.sourceIds),...list(mode.eventItem?.sourceIds),...acquisitionCandidates.flatMap(row=>list(row.sourceIds))]);
  return { ...base, status: invalid ? 'invalid_selection' : pending ? 'pending_rules' : 'ready',
    mode: { id: mode.id, nameKo: mode.nameKo, nameJa: mode.nameJa, family: mode.family, period: mode.period,
      activityStatus: mode.activityStatus, supportedPlans: plans ?? null, supportedTrainingTypes: types ?? null,
      eventSelectionDeclared: true, inGameEligibilityConfirmed: false },
    rentalRules: { kind: rental.kind ?? null, slotLimit, totalMemorySlots,
      baseDailyLimit: knownInteger(rental.baseDailyLimit), remainingUses: rental.remainingUses ?? null,
      additionalCouponUses: rental.additionalCouponUses ?? null, phase: rental.phase ?? null,
      producerLevelRestrictionWaived: rental.plvRestrictionWaived ?? rules.plvRentalWaived ?? null },
    temporaryProduceConditions: { plvAppearanceWaived: rules.plvAppearanceWaived ?? null,
      plvRentalWaived: rules.plvRentalWaived ?? rental.plvRestrictionWaived ?? null,
      skillSwitchUnlockWaived: rules.skillSwitchUnlockWaived ?? null,
      skillSwitchRentalInteraction: rules.skillSwitchRentalInteraction ?? null,
      crossPlanAdditionalAppearance: rules.crossPlanAdditionalAppearance ?? null,
      crossPlanRentalAllowed: rules.crossPlanRentalAllowed ?? null, appliesOnlyToSelectedEvent: true,
      appliedToRecommendation: unlockOverrides?.producerLevelUnlock === true },
    verifiedUnlockRuleApplication: { appearanceApplied: unlockOverrides?.producerLevelUnlock === true,
      rentalLevelPermission: unlockOverrides?.memoryRentalProducerLevelUnlock === true, actualRentalInserted: false,
      actualProducerLevel: options.producerLevel ?? inventory.producerLevel ?? null, accountProducerLevelChanged: false,
      sourceIds: unlockOverrides?.sourceIds ?? [] },
    ownedRecommendationScope: unlockOverrides?.producerLevelUnlock === true ? 'owned_assets_with_verified_event_appearance_unlocks' : 'normal_account_reference_without_event_effects',
    selectedSkills, memoryTargets, otherPlanMemoryTargets,acquisitionCandidates,
    itemEffects:mode.eventItem?{...mode.eventItem,eventSelectionDeclared:true,actualPossessionCaptured:false,
      automaticAtProduceStartByRule:mode.eventItem.automaticAtProduceStart?.verified===true,
      includedInStatForecast:false,fixedVoDaViBonusApplied:false,effectRolesConsidered:true}:null,
    validation: { status: invalid ? 'invalid' : pending ? 'pending' : 'valid', acceptedGameIds: [],
      pendingGameIds: invalid ? requestedIds.filter(id => !issues.some(row => row.severity === 'invalid' && row.gameId === id)) : requestedIds, issues },
    sources: list(catalog.eventModes?.sources).filter(source => sourceIds.has(source.id)),
    limitations: [...base.limitations, ...list(mode.unknowns),
      unlockOverrides?.producerLevelUnlock === true ? '공식으로 확인한 이벤트 PLv 등장 면제는 획득·드링크 후보에 적용합니다. 실제 계정 PLv·스위치 제한은 그대로이며 미확인 렌탈 사본과 스탯 보너스는 넣지 않습니다.' :
        '기존 추천은 실제 보유 기록과 일반 렌탈 규칙으로 계산한 참고안입니다. 이벤트의 미확인 스탯 보너스나 임시 카드를 반영한 완료 편성이 아닙니다.',
      '일일 기본 이용 횟수와 남은 이용 횟수는 다릅니다. 남은 횟수·쿠폰 사용량을 알지 못하면 임의로 채우지 않습니다.',
      '이벤트에서 사용할 수 있어도 계정의 영구 PLv 해금이나 보유 메모리로 바뀌지는 않습니다.'] };
}
