const list = value => Array.isArray(value) ? value : [];
const idOf = row => row?.gameId ?? row?.id;
const integer = value => value != null && value !== '' && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const nameOf = row => row?.nameKo || row?.name || row?.nameJa || '이름 미확인';
const normalizeType = value => ({ full_power: 'fullPower', good_condition: 'goodConditionTurns', good_impression: 'goodImpressionTurns' })[value] ?? value;
const hifRuleSource = 'https://seesaawiki.jp/gakumasu/d/H.I.F';

/** One shared declared outcome of the two random removals; not their distribution. */
export function hifAutomaticRemovalPlan(cards) {
  const basics = list(cards).filter(card => card.source === 'scenario_initial_deck' && /基本/.test(card.nameJa ?? ''));
  // The fixed order is shared by every compared deck; it is not a game RNG model.
  const order = [1, 4, 2, 5, 0, 3, 6].filter(index => index < basics.length);
  return { status: basics.length >= 4 ? 'declared_outcome' : 'unsupported', patternId: 'shared-basic-removal-pattern-1',
    probability: null, actualTargetsCaptured: false, sourceUrls: [hifRuleSource],
    events: order.slice(0, 4).map((slot, index) => ({ ...basics[slot], id: 'automatic-basic-removal-' + (index + 1),
      action: 'automatic_remove', quantity: 1, originalBasicSlot: slot, fromExamIndex: index < 2 ? 1 : 2,
      venue: 'scenario_rule', cost: 0, supportDeleteTriggerApplied: false })),
    assumption: '선발 1·2 통과 직후 기본 카드가 각각 2장 자동 삭제되는 규칙을 반영했습니다. 실제 무작위 삭제 대상은 수집되지 않아 모든 비교에 같은 삭제 목록 하나를 적용했습니다. 삭제 결과별 확률·전체 우열은 검증하지 않았습니다.' };
}

export function applyHifAutomaticRemovals({ built, examIndex }) {
  if (built.status !== 'ready' || !built.loadout) return built;
  const rule = hifAutomaticRemovalPlan(built.mappedCards);
  const active = rule.events.filter(event => event.fromExamIndex <= examIndex), mappedCards = list(built.mappedCards).map(card => ({ ...card }));
  if (active.length && rule.status !== 'declared_outcome') return { ...built, status: 'unsupported', loadout: null,
    missingInputs: [...list(built.missingInputs), 'HIF 자동 삭제에 대응할 원본 기본 카드가 부족합니다.'] };
  for (const event of active) {
    const index = mappedCards.findIndex(card => card.source === 'scenario_initial_deck' && card.gameId === event.gameId);
    if (index < 0) return { ...built, status: 'unsupported', loadout: null,
      missingInputs: [...list(built.missingInputs), '선언한 자동 삭제 대상이 원본 기본 카드에 없습니다.'] };
    mappedCards.splice(index, 1);
  }
  return { ...built, mappedCards, automaticRemovals: { ...rule, appliedEvents: active },
    limitations: [...list(built.limitations), rule.assumption], loadout: { ...built.loadout,
      skillCardIdGroups: [mappedCards.map(card => card.publicId)], customizationGroups: [mappedCards.map(card => card.customizations)],
      assumptions: [...list(built.loadout.assumptions), rule.assumption] } };
}

/** A few declared successful acquisition opportunities, not an encounter forecast. */
export function buildProduceProgression({ result, personalizedPlan, catalog, inventory = {}, options = {} }) {
  const context = personalizedPlan.context, level = integer(context.producerLevel?.value);
  const policies = list(catalog.playbookPolicies?.policies).filter(policy => policy.scenario === 'hif' && policy.plan === context.plan &&
    normalizeType(policy.trainingType) === normalizeType(context.trainingType));
  const baseCards = list(catalog.skillCards), switches = options.skillCardSwitchSettings ?? inventory.skillCardSwitchSettings;
  const selected = new Set([...list(result.memories).map(memory => memory.modelEffects?.carriedSkill?.id), ...list(personalizedPlan.uniqueCards).map(idOf)]);
  const goals = new Map();
  for (const policy of policies) for (const card of list(policy.cards).filter(card => card.action === 'take')) goals.set(card.gameId, card);
  for (const card of list(personalizedPlan.midgamePlan?.acquisitionTargets)) if (!goals.has(card.gameId)) goals.set(card.gameId, card);
  const eligibleTargets = [];
  for (const goal of goals.values()) {
    const card = baseCards.find(card => idOf(card) === goal.gameId && (card.upgradeCount ?? 0) === 0);
    const native = catalog.memoryEffectDetails?.tables?.ProducerLevelUnlocks?.[goal.gameId];
    const required = Math.max(integer(goal.conditions?.minProducerLevel) ?? 0, integer(native?.level ?? card?.unlockProducerLevel) ?? 0);
    const access = list(personalizedPlan.cardAccess).find(row => row.gameId === goal.gameId)?.normalAcquisition;
    const needsSwitch = goal.conditions?.requiresSwitchUnlockAndSelection === true || native?.type === 'ProducerLevelUnlockType_ProduceCardConversion' || card?.requiresSkillCardSwitch === true;
    const switchEligible = !needsSwitch || switches?.[goal.gameId] === true || access?.switchEligible === true;
    const knownTarget = list(personalizedPlan.midgamePlan?.acquisitionTargets).find(row => row.gameId === goal.gameId);
    const conflicts = list(goal.conditions?.avoidTogether).some(id => selected.has(id)) || list(goal.conflicts).length > 0 || list(knownTarget?.conflicts).length > 0;
    if (!card || card.sourceType !== 'produce' || card.recommendationEligible === false || !['free', context.plan].includes(card.plan) ||
      selected.has(goal.gameId) || level == null || level < required || (required === 0 && !native) || !switchEligible || access?.eligible === false || conflicts ||
      integer(card.internalId) == null || /unmatched|ambiguous/.test(card.identityStatus ?? '')) continue;
    eligibleTargets.push({ gameId: card.gameId, internalId: integer(card.internalId), name: nameOf(card), nameJa: card.nameJa,
      imageUrl: card.thumbnailUrl ?? card.imageUrl ?? null, upgradeCount: 0, requiredProducerLevel: required,
      sourceIds: list(goal.sourceIds), reason: goal.reason ?? goal.purpose ?? '현재 조건에서 도중 확보할 카드 후보입니다.' });
  }
  const targets = eligibleTargets.slice(0, 2);
  const events = targets.map((target, index) => ({ ...target, id: 'acquire-' + (index + 1), action: 'acquire', quantity: 1,
    fromExamIndex: index + 1, before: index === 0 ? '선발시험 2' : '선발시험 3', venue: 'consult_or_actual_card_choice',
    cost: null, occurrenceProbability: null, requirements: ['해당 시험 전 실제 선택지·상담 목록에 이 카드가 제시됨', '실제 가격을 지불할 P포인트 또는 해당 획득 보상이 있음', '그 이전 시험을 통과함'],
    assumption: `${index === 0 ? '선발시험 2' : '선발시험 3'} 전에 ${nameOf(target)}를 미강화 1장 확보한 조건입니다. 획득률·제시 시점을 예측한 결과가 아닙니다.` }));
  const routes = [];
  if (events.length) {
    const acquired = targets[0], plus = baseCards.find(card => idOf(card) === acquired.gameId && card.upgradeCount === 1);
    if (plus && integer(plus.internalId) != null && plus.recommendationEligible !== false) routes.push({ id: 'acquire_then_upgrade',
      label: `${events.length}장 확보 + 본선 전 주력 1회 강화`, events: [...events, { ...acquired,
        id: 'upgrade-acquired', action: 'upgrade', fromExamIndex: 3, before: '본선 라운드 1', venue: 'consult',
        fromUpgradeCount: 0, upgradeCount: 1, internalId: integer(plus.internalId), cost: null, occurrenceProbability: null,
        requirements: ['앞서 확보한 해당 카드가 덱에 남아 있고 아직 0강임', '강화 기능과 실제 제시 가격을 확인하고 비용을 지불할 수 있음'],
        assumption: '본선 라운드 1 전에 앞서 확보한 미강화 주력 한 장을 1강으로 강화한 조건입니다. 무료 강화나 비용 충족을 확인한 결과가 아닙니다.' }] });
    const remainingBasics = list(personalizedPlan.initialDeck?.masterCards).map(card => ({ ...card, source: 'scenario_initial_deck' }));
    for (const event of hifAutomaticRemovalPlan(remainingBasics).events) {
      const index = remainingBasics.findIndex(card => card.gameId === event.gameId);
      if (index >= 0) remainingBasics.splice(index, 1);
    }
    const counts = new Map();
    for (const card of remainingBasics) counts.set(card.gameId, (counts.get(card.gameId) ?? 0) + 1);
    const duplicate = remainingBasics.find(card => counts.get(card.gameId) >= 2 &&
      !selected.has(card.gameId) && /基本/.test(card.nameJa ?? '') && card.upgradeCount === 0);
    if (duplicate) routes.push({ id: 'acquire_then_trim', label: `${events.length}장 확보 + 본선 전 중복 기본 1장 삭제`, events: [...events,
      { ...duplicate, id: 'remove-one-basic', action: 'remove', quantity: 1, fromExamIndex: 3, before: '본선 라운드 1', venue: 'consult',
        minimumRemainingCopies: 1, cost: null, occurrenceProbability: null,
        requirements: ['해당 기본 카드가 실제 덱에 2장 이상 남아 있음', '한 장 삭제 후에도 필요한 공격·지침·덱 장수 조건을 유지함', '삭제 기능과 실제 가격을 확인하고 비용을 지불할 수 있음'],
        assumption: '본선 전에 중복 기본 카드 한 장만 삭제하고 최소 한 장은 남긴 조건입니다. 비용을 충족했다고 단정하지 않습니다.' }] });
    if (routes.length < 2) routes.push({ id: 'declared_acquisitions', label: `${events.length}장 확보 · 추가 관리 없음`, events });
  }
  return { status: routes.length ? 'declared_routes' : 'no_verified_acquisition_target', routes: routes.slice(0, 2), eligibleTargets,
    successProbability: null, expectedMean: null,
    assumptions: ['도중 획득에 성공한 조건과 하나도 확보하지 못한 기존 기본 경로를 별도로 비교합니다.',
      '획득 확률·실제 제시 주차·P포인트 수급·가격은 확인하지 않았습니다. 시험별 평균에 성공 확률 100%를 숨겨 적용하지 않습니다.',
      '선발시험 1에는 추가 카드를 넣지 않습니다. 이후 시험에는 앞 단계의 획득·강화·삭제를 누적해서 반영합니다.',
      '명시된 카드 획득·강화·삭제 횟수와 시험별 덱 장수만 지원 효과에 연결합니다. 미확정 출현 횟수·스타성 수급·조건부 P아이템까지 모두 계산한 것은 아닙니다.'] };
}

/** Apply exact edits to the assembled recipe; acquisition cards were mapped first. */
export function applyProgressionEdits({ built, route, examIndex, catalog }) {
  if (built.status !== 'ready' || !built.loadout) return built;
  const mappedCards = list(built.mappedCards).map(card => ({ ...card, customizations: { ...(card.customizations ?? {}) } }));
  const applied = [], errors = [];
  for (const event of list(route.events).filter(event => event.fromExamIndex <= examIndex)) {
    if (event.action === 'acquire') {
      if (mappedCards.some(card => card.gameId === event.gameId)) applied.push(event);
      else errors.push('선언한 획득 카드가 덱에 정확히 대응되지 않았습니다: ' + event.name);
    } else if (event.action === 'upgrade') {
      const index = mappedCards.findIndex(card => card.gameId === event.gameId && card.upgradeCount === 0 && card.source === 'declared_acquisition_assumption');
      const plus = list(catalog.skillCards).find(card => idOf(card) === event.gameId && card.upgradeCount === 1);
      if (index < 0 || integer(plus?.internalId) == null) errors.push('강화할 실제 0강 획득 카드 또는 정확한 1강 대응이 없습니다: ' + event.name);
      else { mappedCards[index] = { ...mappedCards[index], publicId: integer(plus.internalId), upgradeCount: 1, name: nameOf(plus), nameJa: plus.nameJa }; applied.push(event); }
    } else if (event.action === 'remove') {
      const matches = mappedCards.map((card, index) => ({ card, index })).filter(({ card }) => card.gameId === event.gameId && card.source === 'scenario_initial_deck');
      if (matches.length <= (event.minimumRemainingCopies ?? 1)) errors.push('중복 기본 카드를 한 장 남기는 삭제 조건을 충족하지 못했습니다: ' + event.name);
      else { mappedCards.splice(matches.at(-1).index, 1); applied.push(event); }
    }
  }
  if (errors.length) return { ...built, status: 'unsupported', loadout: null, mappedCards,
    missingInputs: [...list(built.missingInputs), ...errors] };
  return { ...built, mappedCards, appliedEvents: applied, loadout: { ...built.loadout,
    skillCardIdGroups: [mappedCards.map(card => card.publicId)], customizationGroups: [mappedCards.map(card => card.customizations)],
    assumptions: [...list(built.loadout.assumptions), ...applied.map(event => event.assumption)] } };
}
