import { summarizeMemoryEffects } from './memory-effects.mjs';
import { findHifMemoryProfile, evaluateHifGuideRole } from './hif-memory-profile.mjs';
import { idolRecipeContext } from './idol-recipe-policy.mjs';
import { getTrustedEventUnlockOverrides, getEventAdditionalAppearance, getEventAdditionalAppearanceCandidates } from './event-context.mjs';

const list = value => Array.isArray(value) ? value : [];
const integer = value => value !== null && value !== undefined && value !== '' && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const idOf = row => row?.gameId ?? row?.id;
const record = row => ({ ...(row?.raw ?? {}), ...row });
const nameOf = row => String(row?.nameKo || row?.name || row?.nameJa || '이름 미확인').trim();
const labelOf = row => nameOf(row) + (row?.nameJa && row.nameJa !== nameOf(row) ? ` (${row.nameJa})` : '');
const phaseOf = skill => skill?.phase?.availableAtStart === true ? 'atStart' : skill?.phase?.availableAtStart === false ? 'afterMid' : 'unknown';
const combine = values => values.includes(false) ? false : values.includes(null) ? null : true;

function accessFor(card, role, context, catalog, switches, options) {
  const unlock = catalog.memoryEffectDetails?.tables?.ProducerLevelUnlocks?.[role.gameId];
  const normalRequired = integer(unlock?.level ?? role.normalUnlockProducerLevel ?? card?.unlockProducerLevel);
  const requiresSwitch = unlock?.type === 'ProducerLevelUnlockType_ProduceCardConversion' || role.requiresSwitch === true || card?.requiresSkillCardSwitch === true;
  const carryRequired = requiresSwitch ? normalRequired : integer(role.carryUnlockProducerLevel ?? card?.rentalUnlockProducerLevel);
  const plan = role.plan ?? card?.plan;
  const planEligible = !plan || !context.plan || context.plan === 'free' ? null : plan === 'free' || plan === context.plan;
  const switchEligible = requiresSwitch ? switches?.[role.gameId] === true ? true : switches?.[role.gameId] === false ? false : null : true;
  const eventRules=getTrustedEventUnlockOverrides(options,{catalog,plan:context.plan,scenario:context.scenario});
  const additionalAppearance=getEventAdditionalAppearance(options,{catalog,plan:context.plan,scenario:context.scenario,gameId:role.gameId});
  const check = (requiredProducerLevel,appearance=false) => {
    const levelEligibleWithoutEvent = requiredProducerLevel === 0 ? true : requiredProducerLevel == null || context.producerLevel.value == null ? null : context.producerLevel.value >= requiredProducerLevel;
    const producerLevelWaivedByEvent=Boolean(card)&&appearance&&!requiresSwitch&&eventRules?.producerLevelUnlock===true;
    const levelEligible=producerLevelWaivedByEvent?true:levelEligibleWithoutEvent;
    const effectivePlanEligible=appearance&&additionalAppearance?.planEligible===true?true:planEligible;
    const eligible = combine([Boolean(card), effectivePlanEligible, levelEligible, switchEligible]);
    return { status: eligible === true ? 'eligible' : eligible === false ? 'locked' : 'unknown', eligible,
      requiredProducerLevel, levelEligible, levelEligibleWithoutEvent, producerLevelWaivedByEvent,
      eventUnlockSourceIds:producerLevelWaivedByEvent?eventRules.sourceIds:[], planEligible:effectivePlanEligible,normalPlanEligible:planEligible,
      eventAdditionalAppearance:appearance&&Boolean(additionalAppearance),eventAppearanceSourceIds:appearance?additionalAppearance?.sourceIds??[]:[], requiresSwitch, switchEligible };
  };
  return { normalAcquisition: { ...check(normalRequired,true), acquired: false, acquisitionGuaranteed: false,
    note: role.priority === 'off_type_access' ? '해금 조건과 별개로 이 육성 유형에서 자연 획득하기 어려운 역할입니다. 실제 선택 후보에 뜨는지는 확인해야 합니다.' :
      '해금 조건 점검입니다. 실제 카드 선택지·교환에 등장하거나 획득한 것으로 가정하지 않습니다.' }, memoryCarry: check(carryRequired) };
}

function uniqueCardsFor(idol, catalog) {
  if (!idol?.ownershipVerified) return [];
  const rank = integer(idol.owned?.uncap ?? idol.owned?.levelLimitRank ?? idol.owned?.raw?.levelLimitRank);
  return ['produceCardId', 'secondProduceCardId'].flatMap((key, index) => {
    const gameId = idol.uniqueIds?.[key];
    if (!gameId) return [];
    const effectType = index === 0 ? 'IdolCardLevelLimitEffectType_ProduceCardUpgrade' : 'IdolCardLevelLimitEffectType_SecondProduceCardUpgrade';
    const count = rank == null ? null : list(idol.specialTrainingStages).filter(stage =>
      stage.rank <= rank && list(stage.effectTypes).includes(effectType)).length;
    const card = list(catalog.skillCards).find(card => idOf(card) === gameId && card.upgradeCount === count)
      ?? list(catalog.skillCards).find(card => idOf(card) === gameId && (card.upgradeCount ?? 0) === 0);
    return [{ gameId, name: nameOf(card), nameJa: card?.nameJa ?? null, upgradeCount: count, customizes: [],
      imageUrl: card?.thumbnailUrl ?? card?.imageUrl ?? null, source: 'owned_idol_unique',
      identityVerified: Boolean(card), variantVerified: Boolean(card) && count != null && card.upgradeCount === count }];
  });
}

function initialDeckFor(context, catalog) {
  const profile = list(catalog.produceInitialDecks?.idolProfiles).find(row => row.idolCardId === context.idol?.gameId);
  const scenario = list(catalog.produceInitialDecks?.scenarioDecks).find(row => row.scenario === context.scenario
    && row.difficulty === context.difficulty && row.examEffectType === profile?.examEffectType);
  const produceId = context.scenario === 'hif' ? 'produce-007' : scenario?.produceId;
  const initialDeckId = profile?.scenarioDeckIds?.[produceId];
  const deck = catalog.produceInitialDecks?.decks?.[initialDeckId];
  const masterCards = list(deck?.cardSlots).map(slot => {
    const upgradeCount = integer(slot.upgradeCount);
    const card = list(catalog.skillCards).find(card => idOf(card) === slot.cardId && card.upgradeCount === upgradeCount);
    return { gameId: slot.cardId, name: nameOf(card), nameJa: card?.nameJa ?? null, upgradeCount, customizes: [],
      source: 'scenario_master_initial_deck', identityVerified: Boolean(card), variantVerified: Boolean(card) && upgradeCount != null,
      imageUrl: card?.thumbnailUrl ?? card?.imageUrl ?? null };
  });
  return { status: masterCards.length ? 'master_recipe' : 'unavailable', initialDeckId: initialDeckId ?? null, masterCards,
    cardCount: masterCards.length, fullCurrentDeckVerified: false, includesIdolSeedDeck: false,
    note: masterCards.length ? '선택한 시나리오와 P아이돌의 기본 덱 원자료입니다. P스킬·P아이템에 의한 초기 덱 변경과 실제 진행 중 덱은 확인하지 않았습니다.' :
      '현재 조건에 연결된 시나리오 초기 덱 원자료를 확인하지 못했습니다. 보유 카드와 반입 스킬 준비는 계속 표시합니다.' };
}

/** Account-specific preparation recipes; these are not a captured full live deck. */
export function buildPersonalizedPlan({ result, inventory = {}, catalog, options = {} }) {
  const rawLevel = integer(options.producerLevel ?? inventory.producerLevel);
  const level = rawLevel != null && rawLevel >= 1 ? rawLevel : null;
  const context = { scenario: result.scoreSummary?.scenario ?? options.scenario ?? 'hif',
    difficulty: result.scoreSummary?.difficulty ?? options.difficulty ?? null,
    plan: result.scoreSummary?.plan ?? result.selectedIdol?.plan ?? options.plan ?? null,
    trainingType: result.scoreSummary?.trainingType ?? options.trainingType ?? null,
    producerLevel: { value: level, source: options.producerLevel != null ? 'user_input' : level != null ? 'inventory_capture' : 'unknown' },
    idol: result.selectedIdol ? { gameId: idOf(result.selectedIdol), name: nameOf(result.selectedIdol), plan: result.selectedIdol.plan,
      owned: result.selectedIdol.ownershipVerified === true } : null };
  const switches = options.skillCardSwitchSettings ?? inventory.skillCardSwitchSettings;
  const eventRules=getTrustedEventUnlockOverrides(options,{catalog,plan:context.plan,scenario:context.scenario});
  context.eventUnlockAccess=eventRules?{eventModeId:eventRules.eventModeId,producerLevelUnlock:eventRules.producerLevelUnlock,
    sourceIds:eventRules.sourceIds,accountProducerLevelChanged:false,guidePrerequisitesWaived:false}:null;
  const profile = context.scenario === 'hif' ? findHifMemoryProfile(catalog,idolRecipeContext({result,catalog,inventory,options})) : null;
  const selectedMemories = list(result.memories).map(memory => {
    const effects = (!eventRules||!(memory.produceCard?.id||memory.raw?.produceCard?.id)?memory.modelEffects:null)
      ?? summarizeMemoryEffects(memory, catalog, { ...options,...context, producerLevel: level, skillCardSwitchSettings: switches });
    const skill = effects.carriedSkill;
    return { memoryId: idOf(memory), gameId: skill?.id ?? null, name: nameOf(skill), nameJa: skill?.nameJa ?? null,
      upgradeCount: skill?.upgrade ?? null, phase: skill?.phase ?? null, obtainable: skill?.obtainable ?? null,
      customizes: list(skill?.customizes).map(custom => ({ id: custom.id, customizeCount: custom.customizeCount,
        exactCountKnown: custom.exactCountKnown === true, growEffects: list(custom.growEffects) })),
      imageUrl: memory.skillImageUrl ?? memory.skillCard?.thumbnailUrl ?? memory.skillCard?.imageUrl ?? null,
      source: 'selected_memory', skillKnown: Boolean(skill), effects };
  });
  const memoryStages = Object.fromEntries(['atStart', 'afterMid', 'unknown'].map(phase => [phase,
    selectedMemories.filter(memory => phaseOf(memory) === phase)]));
  const uniqueCards = uniqueCardsFor(result.selectedIdol, catalog);
  const initialDeck = initialDeckFor(context, catalog);
  const afterMidRule = context.scenario === 'hif' ? { status: 'community_documented', appliesAfter: { stage: 'selection', order: 1 },
    label: '선발시험 1 종료 후 합류', sourceUrls: ['https://seesaawiki.jp/gakumasu/d/H.I.F', 'https://morishimemo.com/gakumasu-memo-43'],
    note: '공개 규칙·작성자 운영 로그로 확인한 모형 규칙입니다. 현재 진행 중 세션의 획득을 읽은 기록은 아닙니다.' } :
    { status: 'generic_phase_code', label: '중간 시험 종료 후 합류', appliesAfter: null, sourceUrls: [], note: '선택 시나리오의 세부 시험 순서와 별도로 원본 반입 시점을 구분합니다.' };
  const supportRows = Array.isArray(result.supports) ? result.supports : [...list(result.supports?.owned), ...(result.supports?.rental ? [result.supports.rental] : [])];
  const supports = supportRows.map(card => ({ gameId: idOf(card), name: nameOf(card), plan: card.plan,
    currentLevel: integer(card.ownedLevel ?? card.level), evaluatedLevel: integer(card.level), uncap: integer(card.uncap), levelCap: integer(card.maxLevels?.[card.uncap]),
    rental: card.rental === true || card.isRental === true, imageUrl: card.thumbnailUrl ?? card.imageUrl ?? null }));
  const roles = [...list(profile?.carryRoles), ...list(profile?.alternatives),
    ...list(profile?.optionalCarryRoles).map(role=>({...role,priority:'optional_character_role'}))];
  for(const target of list(profile?.characterPolicy?.duringTargets).filter(target=>target.applies===true))if(!roles.some(role=>role.gameId===target.gameId))roles.push({
    ...target,purpose:target.purpose??target.reason,priority:'character_during_target',useConditions:list(target.conditions)});
  const extraCards=getEventAdditionalAppearanceCandidates(options,{catalog,plan:context.plan,scenario:context.scenario});
  for(const card of extraCards)if(!roles.some(role=>role.gameId===card.gameId))roles.push({...card,plan:card.normalUsePlan,
    purpose:card.effectRole?.summary??'이번 이벤트에서 추가 등장하는 다른 플랜의 카드',priority:'event_additional_appearance'});
  if (context.plan === 'anomaly' && ['fullPower', 'full_power'].includes(context.trainingType)) {
    const knownIds = new Set(roles.map(role => role.gameId));
    for (const card of list(catalog.skillCards).filter(card => !knownIds.has(idOf(card)) && card.plan === 'anomaly' &&
      card.upgradeCount === 0 && card.sourceType === 'produce' && ['R', 'SR', 'SSR'].includes(card.rarity) &&
      card.recommendationEligible !== false && /score\+=.*cumulativeFullPowerCharge/.test(card.actions ?? ''))) {
      const role = { gameId: idOf(card), plan: card.plan, purpose: '누적 전력치 관련 공격 후보 · 화력 최적성 미검증', priority: 'level_eligible_attack_candidate' };
      if (accessFor(card, role, context, catalog, switches,options).normalAcquisition.eligible === true) roles.push(role);
    }
  }
  const cardAccess = [...new Map(roles.map(role => [role.gameId, role])).values()].map(role => {
    const card = list(catalog.skillCards).find(card => idOf(card) === role.gameId && (card.upgradeCount ?? 0) === 0);
    const access = accessFor(card, role, context, catalog, switches,options);
    const selected = selectedMemories.filter(memory => memory.gameId === role.gameId);
    const matches = list(result.memories).map(memory => evaluateHifGuideRole(role, memory)).filter(Boolean);
    return { gameId: role.gameId, name: (role.nameKo || nameOf(card)).trim(), nameJa: role.nameJa ?? card?.nameJa ?? null,
      imageUrl: card?.thumbnailUrl ?? card?.imageUrl ?? role.characterIconUrls?.[result.selectedIdol?.characterId] ?? null,
      characterIconUrls:card?.characterIconUrls??role.characterIconUrls??{},purpose: role.purpose, priority: role.priority,
      effectRole:role.effectRole??null,useConditions:list(role.useConditions),sourceIds:list(role.sourceIds),
      ...access, selectedMemoryIds: selected.map(memory => memory.memoryId), selectedPhases: selected.map(memory => phaseOf(memory)),
      roleStatus: matches.some(match => match.status === 'fulfilled') ? 'fulfilled' : matches.some(match => match.status === 'unknown') ? 'unknown' : 'missing' };
  });
  const atStart = memoryStages.atStart.filter(memory => memory.obtainable === true);
  const afterMid = memoryStages.afterMid.filter(memory => memory.obtainable === true);
  const openingSteps = [atStart.length ? `시작 시 반입되는 ${atStart.map(nameOf).join(', ')}와 보유 P아이돌의 고유 카드로 첫 시험을 준비합니다.` :
    '시작 시 반입 스킬이 확인되지 않았습니다. 보유 P아이돌의 고유 카드와 기본 덱을 먼저 확인하는 준비부터 진행합니다.'];
  if (memoryStages.afterMid.length) openingSteps.push(`${memoryStages.afterMid.map(nameOf).join(', ')}는 ${context.scenario === 'hif' ? '선발시험 1' : '중간 시험'} 이후 합류하므로 첫 시험의 드로우·재행동 수단에 포함하지 않습니다.`);
  if (selectedMemories.some(memory => memory.obtainable == null)) openingSteps.push('반입 가능 조건이 미확정인 메모리는 조건 확인 전까지 초반 운영의 확정 카드로 세지 않습니다.');
  if (context.plan === 'anomaly' && ['fullPower', 'full_power'].includes(context.trainingType) &&
      atStart.some(memory => memory.gameId === 'p_card-03-act-1_042')) {
    openingSteps.push('개시 축적은 온존에서 보류하고 전력 턴에 공격하는 역할로 준비합니다. 실제 성장량·보류 공간과 고유 카드의 발동 조건은 별도로 확인합니다.');
  }
  const missingCombinations = cardAccess.filter(card => card.normalAcquisition.levelEligible === false || card.memoryCarry.levelEligible === false).map(card => ({
    kind: 'level_locked_card', gameId: card.gameId, name: card.name, currentProducerLevel: level,
    normalRequiredProducerLevel: card.normalAcquisition.requiredProducerLevel, carryRequiredProducerLevel: card.memoryCarry.requiredProducerLevel,
    message: `${labelOf(card)}를 전제로 하는 운영은 현재 PLv에서 확정하지 않습니다. 도중 획득 PLv ${card.normalAcquisition.requiredProducerLevel ?? '미확인'}, 메모리 반입 PLv ${card.memoryCarry.requiredProducerLevel ?? '미확인'}를 구분해 준비합니다.` }));
  for (const role of list(profile?.carryRoles)) {
    const access = cardAccess.find(card => card.gameId === role.gameId);
    if (access?.roleStatus !== 'fulfilled') missingCombinations.push({ kind: 'incomplete_role', gameId: role.gameId,
      name: access?.name ?? role.nameKo ?? role.nameJa, status: access?.roleStatus ?? 'missing',
      message: `${access?.name ?? role.nameKo ?? role.nameJa}의 ${role.purpose ?? '공략 역할'}은 개시 시점·강화·커스텀을 포함한 충족으로 확인되지 않았습니다.` });
  }
  const selectedSkillIds = new Set(selectedMemories.map(memory => memory.gameId));
  const acquisitionTargets = cardAccess.filter(card => !card.selectedMemoryIds.length && card.normalAcquisition.eligible === true).map(card => ({
    ...card, conflicts: list(profile?.incompatibleCarryPairs).filter(pair => list(pair.cards).some(other => other.gameId === card.gameId) &&
      list(pair.cards).some(other => other.gameId !== card.gameId && selectedSkillIds.has(other.gameId))).map(pair => pair.reason) }));
  const midgameSteps = [afterMid.length ? `${context.scenario === 'hif' ? '선발시험 1' : '중간 시험'} 이후 ${afterMid.map(nameOf).join(', ')}를 합류시켜 이후 시험의 운영에 사용합니다.` :
    '중간 이후 합류하는 반입 스킬이 확인되지 않았습니다. 실제 카드 선택지와 서포트 이벤트에서 확보한 카드에 맞춰 다음 시험 덱을 정합니다.'];
  if (acquisitionTargets.length) midgameSteps.push(`현재 PLv${eventRules?.producerLevelUnlock?'·선택 이벤트의 해금 예외':''} 조건을 통과한 도중 확보 후보는 ${acquisitionTargets.map(labelOf).join(', ')}입니다. 실제 선택지 등장과 획득을 확인한 뒤 덱에 추가합니다.`);
  if(extraCards.length)midgameSteps.push('이번 아사리의 확인된 센스 추가 명단은 이벤트 도중 획득 후보에만 넣습니다. 호조 비용·예약 드로우·전환 해금 등 사용 조건을 확인하며 일반 어노말리 메모리 반입 허용으로 바꾸지 않습니다.');
  if (acquisitionTargets.some(card => card.conflicts.length)) midgameSteps.push('선택 메모리와 보류 공간이 충돌하는 도중 후보는 동시 채용을 고정하지 않고 실제 공간·전력치 수지를 먼저 확인합니다.');
  if (missingCombinations.some(issue => issue.gameId === 'p_card-03-act-3_189' && issue.kind === 'level_locked_card')) midgameSteps.push('PLv80 羽ばたけ！ 반복 덱을 현재 준비 완료로 취급하지 않고, 현재 반입 카드와 해금된 공격 후보로 운영합니다.');
  const confirmedUnique = uniqueCards.filter(card => card.variantVerified);
  const confirmedMemory = memories => memories.filter(memory => memory.obtainable === true && memory.upgradeCount != null);
  const missingInputs = ['실제 새 육성의 전체 초기 덱과 카드 수', '시험별 턴 구성·통과 목표·능력치/점수 조건',
    '실제 P아이템·드링크·시험 시작 상태', '도중 카드 획득·강화·제거 결과와 SP 성공 여부'];
  if (uniqueCards.some(card => !card.variantVerified)) missingInputs.push('보유 P아이돌 고유 카드의 정확한 강화 단계');
  if (memoryStages.unknown.length) missingInputs.push('획득 시점 미확인 반입 스킬의 합류 시점');
  if (selectedMemories.some(memory => memory.obtainable == null)) missingInputs.push('미확정 메모리의 실제 반입 PLv·스킬 전환 조건');
  const upgrade = result.supportUpgradeComparison;
  return { status: 'partial_actionable', context, supports, memoryStages, uniqueCards, initialDeck, cardAccess,
    openingPlan: { cards: [...initialDeck.masterCards, ...uniqueCards, ...atStart], steps: openingSteps,
      limitations: ['개시 스킬 목록은 전체 초기 덱이 아닙니다. 현재 수집기는 진행 중인 육성 덱을 읽지 않습니다.'] },
    midgamePlan: { cards: afterMid, steps: midgameSteps, acquisitionTargets, timingRule: afterMidRule,
      assumptions: ['도중 확보 후보는 획득 확정 카드가 아닙니다.', '고레벨 원문의 완성 덱을 초반 덱이나 현재 계정의 완성 상태로 사용하지 않습니다.'] },
    missingCombinations,
    supportUpgradePlan: upgrade ? { available: upgrade.available, upgrades: list(upgrade.upgrades), statDelta: upgrade.statDelta ?? null,
      addedSupportIds: list(upgrade.addedSupportIds), removedSupportIds: list(upgrade.removedSupportIds), note: upgrade.assumption ?? upgrade.reason } : null,
    simulationInputs: { status: 'incomplete', fullDeckVerified: false, historicalMemoryDeckIsLiveDeck: false,
      stageRecipes: [{ id: 'first_selection', confirmedCards: [...confirmedUnique, ...confirmedMemory(atStart)], assumedCards: initialDeck.masterCards },
        { id: context.scenario === 'hif' ? 'after_selection_1' : 'after_mid_exam', timingRule: afterMidRule,
          confirmedCards: [...confirmedUnique, ...confirmedMemory(atStart), ...confirmedMemory(afterMid)], assumedCards: initialDeck.masterCards,
          acquisitionCandidates: acquisitionTargets.map(card => ({ gameId: card.gameId, name: card.name, nameJa: card.nameJa,
            source: 'unacquired_target', upgradeCount: null, conflicts: card.conflicts })), requiresCandidateSelection: acquisitionTargets.length > 0 }],
      missingInputs, scoreStatistics: null, note: '확인된 카드와 확보 가정을 분리한 입력 준비 자료입니다. 반복 시험의 평균·최고·저점·통과율은 아직 계산하지 않았습니다.' },
    characterRecipePolicy:profile?.characterPolicy??null,
    scope: { accountAssetsConsidered: true, currentSessionCaptured: false, hasVerifiedHifRoleProfile: Boolean(list(profile?.carryRoles).length),
      operatingAdvice: profile?.characterPolicy?.applied?profile.characterPolicy.summary:profile ? '조건부 HIF 역할 자료와 실제 반입 시점을 적용한 준비 계획' : '현재 자산과 반입 시점 구분까지 지원하며 유형별 완성 운영은 미검증',
      battleSimulationRun: false } };
}
