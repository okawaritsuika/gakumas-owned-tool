import { SkillCards, PItems, Customizations } from './vendor/gakumas-data/index.js';
import { applyHifAutomaticRemovals } from './produce-progression.mjs';

const list = value => Array.isArray(value) ? value : [];
const integer = value => value != null && value !== '' && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const idOf = row => row?.gameId ?? row?.id;
const unique = values => [...new Set(values.filter(Boolean))];
const nameOf = row => row?.nameKo ?? row?.name ?? row?.nameJa ?? idOf(row) ?? '카드';
const compatible = (candidate, plan) => candidate === 'free' || candidate === plan;

/** Assemble an explicit conditional recipe. This is never a captured live deck. */
export function buildBattleLoadout({ result, personalizedPlan, catalog, stage, includeAfterMid = false, assumedCardIds = [], supportItemAcquisitions = null } = {}) {
  const missingInputs = [], limitations = [
    '시나리오 원본 기본 덱·고유 카드·선택 메모리와 명시한 확보 가정을 합친 조건부 덱입니다. 진행 중인 실제 육성 덱을 읽은 결과가 아닙니다.',
    '계정 P스킬로 인한 기본 카드의 추가·제거·교체와 도중 강화·제거는 적용하지 않은 가정입니다.',
    '시기가 확정되지 않은 서포트 이벤트의 스킬·P아이템은 아직 획득하지 않은 가정입니다.',
  ];
  const mappedCards = [], mappedItems = [];
  const definitionFor = (table, id, label) => {
    try { return table.getById(id); }
    catch (error) { missingInputs.push(label + '의 시험 효과를 읽지 못했습니다: ' + error.message); return null; }
  };
  const fail = () => ({ status: 'unsupported', scope: 'unavailable', loadout: null, mappedCards, mappedItems,
    limitations: unique(limitations), missingInputs: unique(missingInputs), suggestedSets: [] });
  if (!result || !personalizedPlan || !catalog) { missingInputs.push('계정 추천 결과와 개인별 준비 계획이 필요합니다.'); return fail(); }
  const context = personalizedPlan.context ?? {}, scenario = context.scenario ?? result.scoreSummary?.scenario;
  const examIndex = stage?.stage === 'selection' ? stage.order - 1 : stage?.stage === 'final' ? stage.order + 2 : 0;
  const plan = context.plan ?? result.scoreSummary?.plan, idol = result.selectedIdol;
  if (!idol?.ownershipVerified || !idOf(idol)) missingInputs.push('실제 보유 P아이돌의 정확한 카드가 필요합니다.');
  if (!['sense', 'logic', 'anomaly'].includes(plan)) missingInputs.push('육성 플랜이 확정되지 않았습니다.');
  if (scenario === 'hif' && !['selection', 'final'].includes(stage?.stage)) missingInputs.push('HIF 선발·본선 구분이 필요합니다.');
  if (includeAfterMid && stage?.stage === 'selection' && stage.order === 1) missingInputs.push('중간 시험 이후 메모리는 첫 선발 시험에 합류할 수 없습니다.');
  if (missingInputs.length) return fail();
  const profile = list(catalog.produceInitialDecks?.idolProfiles).find(row => row.idolCardId === idOf(idol));
  if (!profile) { missingInputs.push('보유 P아이돌의 원본 초기 덱 연결을 확인하지 못했습니다.'); return fail(); }
  const difficulty = result.scoreSummary?.difficulty ?? (scenario === 'hif' ? 'none' : null);
  const scenarioLinks = list(catalog.produceInitialDecks?.scenarioDecks).filter(row => row.scenario === scenario &&
    row.difficulty === difficulty && (scenario !== 'hif' || row.stage === stage.stage) && row.examEffectType === profile.examEffectType);
  if (scenarioLinks.length !== 1) { missingInputs.push('시나리오·난이도·육성 유형에 맞는 초기 덱을 하나로 확인하지 못했습니다.'); return fail(); }
  const link = scenarioLinks[0], nativeDeck = catalog.produceInitialDecks?.decks?.[link.initialDeckId];
  if (!nativeDeck || nativeDeck.usage !== 'produce_scenario_template' || !nativeDeck.upgradeCountsExplicit || !list(nativeDeck.cardSlots).length) {
    missingInputs.push('강화 단계가 명시된 프로듀스 초기 덱 원본이 필요합니다.'); return fail();
  }
  limitations.push('P아이돌 시험 시드 덱은 별도로 더하지 않고 해당 시나리오의 기본 덱 템플릿 한 개만 사용합니다.');
  if (stage?.stage === 'final') limitations.push('저장된 선발 덱이 없어 기본 레시피를 본선까지 유지하는 가정입니다. 실제 저장 덱을 기본 덱으로 덮어쓴 결과가 아닙니다.');

  function mapCard({ gameId, upgradeCount, customizes = [], source, memoryId = null }) {
    if (integer(upgradeCount) == null || upgradeCount < 0) { missingInputs.push('강화 단계 미확인: ' + gameId); return; }
    const card = list(catalog.skillCards).find(row => idOf(row) === gameId && (row.upgradeCount ?? 0) === upgradeCount);
    const publicId = integer(card?.internalId), definition = publicId == null ? null : definitionFor(SkillCards, publicId, gameId);
    if (!card || !definition || card.recommendationEligible === false || /unmatched|ambiguous/.test(card.identityStatus ?? '')) { missingInputs.push('정확한 시험 효과 대응을 확인하지 못한 스킬: ' + gameId + ' / 강화 ' + upgradeCount); return; }
    if (!compatible(card.plan, plan)) { missingInputs.push('현재 플랜에서 사용할 수 없는 스킬: ' + nameOf(card)); return; }
    const customs = {};
    if (!Array.isArray(customizes)) { missingInputs.push('카드별 커스터마이즈 목록을 확인하지 못했습니다: ' + nameOf(card)); return; }
    for (const custom of customizes) {
      const count = integer(custom.customizeCount);
      if (custom.exactCountKnown !== true || count == null || count < 1 || list(custom.growEffects).some(grow => grow.unresolved === true)) { missingInputs.push('커스터마이즈의 정확한 적용 단계·효과가 미확인입니다: ' + nameOf(card)); continue; }
      const candidates = list(catalog.customizations).filter(row => (idOf(row) === custom.id || list(row.equivalentGameIds).includes(custom.id)) &&
        row.identityStatus === 'exact_reference_intersection' && definition.availableCustomizations.includes(String(row.internalId)));
      const ids = unique(candidates.map(row => integer(row.internalId)));
      if (ids.length !== 1) { missingInputs.push('시험 효과에 정확히 대응하지 못한 커스터마이즈: ' + custom.id); continue; }
      const customDefinition = definitionFor(Customizations, ids[0], custom.id);
      if (!customDefinition || count > Number(customDefinition.max) || Object.hasOwn(customs, ids[0])) { missingInputs.push('커스터마이즈 적용 횟수 또는 중복을 확인해야 합니다: ' + custom.id); continue; }
      customs[ids[0]] = count;
      limitations.push('수집된 커스터마이즈 ID와 적용 횟수를 공개 효과에 연결했습니다. 모든 원본 성장 효과의 게임 내 동작까지 검증한 것은 아닙니다.');
    }
    mappedCards.push({ source, gameId, publicId, internalId: publicId, name: nameOf(card), nameJa: card.nameJa, upgradeCount,
      imageUrl: card.thumbnailUrl ?? card.imageUrl ?? null,
      customizations: customs, ...(memoryId ? { memoryId } : {}) });
  }
  for (const slot of nativeDeck.cardSlots) mapCard({ gameId: slot.cardId, upgradeCount: slot.upgradeCount, source: 'scenario_initial_deck' });
  const generatedBasicCardIds = unique(mappedCards.filter(card => card.source === 'scenario_initial_deck').map(card => card.publicId));
  const uniqueCards = list(personalizedPlan.uniqueCards);
  if (!uniqueCards.length) missingInputs.push('보유 P아이돌의 고유 스킬이 확인되지 않았습니다.');
  for (const card of uniqueCards) {
    if (card.variantVerified !== true || !list(profile.uniqueCardIds).includes(card.gameId)) { missingInputs.push('보유 P아이돌 고유 스킬의 정확한 강화 상태가 필요합니다: ' + nameOf(card)); continue; }
    mapCard({ ...card, source: 'owned_idol_unique' });
  }

  const phases = personalizedPlan.memoryStages ?? {};
  if (list(phases.unknown).length) missingInputs.push('반입 스킬의 획득 시점이 확인되지 않았습니다.');
  if (list(phases.atStart).some(memory => memory.phase?.availableAtStart !== true) ||
      (includeAfterMid && list(phases.afterMid).some(memory => memory.phase?.availableAtStart !== false))) missingInputs.push('메모리 그룹과 실제 수집된 획득 시점이 일치하지 않습니다.');
  if (!includeAfterMid && list(phases.afterMid).length) limitations.push('중간 시험 이후 메모리는 이 초기 시험 덱에 포함하지 않았습니다: ' + phases.afterMid.map(nameOf).join(', '));
  if (includeAfterMid && list(phases.afterMid).length) limitations.push('중간 시험 이후 메모리를 선발 1차 시험 뒤 합류시킨 조건부 시점입니다. 참고: https://seesaawiki.jp/gakumasu/d/H.I.F');
  for (const memory of [...list(phases.atStart), ...(includeAfterMid ? list(phases.afterMid) : [])]) {
    if (memory.obtainable !== true) { missingInputs.push('반입 가능 조건을 충족으로 확인하지 못한 메모리: ' + nameOf(memory)); continue; }
    const effects = [...list(memory.effects?.hifEffects), ...list(memory.effects?.conditionalEffects)];
    if (effects.some(effect => effect.applies !== false && ['exam_enchant', 'unknown'].includes(effect.kind) && effect.simulationApplied !== true)) {
      missingInputs.push('이 메모리의 시험·덱 변경 효과를 아직 시험 입력에 적용하지 못했습니다: ' + nameOf(memory)); continue;
    }
    mapCard({ ...memory, source: 'selected_memory' });
  }

  const account = { ...(idol.owned?.raw ?? {}), ...(idol.owned ?? {}) };
  const potential = integer(account.potentialRank ?? account.awakeningRank ?? account.awakening);
  const awakening = list(idol.awakeningStages ?? idol.potentialStages);
  if (potential == null || potential < 0 || potential > awakening.length || (potential > 0 && Array.from({ length: potential }, (_, index) => awakening.filter(row => row.rank === index + 1).length).some(count => count !== 1))) missingInputs.push('고유 P아이템의 변화를 판단할 정확한 재능개화 단계·효과가 필요합니다.');
  else {
    const upgraded = awakening.some(row => row.rank <= potential && list(row.effectTypes).includes('IdolCardPotentialEffectType_InitialProduceItemChange'));
    const nativeId = idol.uniqueIds?.[upgraded ? 'afterProduceItemId' : 'beforeProduceItemId'];
    const item = list(catalog.pItems).find(row => idOf(row) === nativeId);
    const publicId = integer(item?.internalId), definition = publicId == null ? null : definitionFor(PItems, publicId, nativeId);
    if (!nativeId || !item || !definition || !['exact', 'reviewed_name_alias_structured_match'].includes(item.identityStatus)) missingInputs.push('보유 P아이돌 고유 P아이템의 정확한 효과 대응을 확인하지 못했습니다.');
    else mappedItems.push({ gameId: nativeId, publicId, name: item.nameJa, source: 'owned_idol_unique', upgraded });
  }
  if (scenario === 'hif' && stage.stage === 'final' && stage.order === 2) {
    const color = { goodConditionTurns: '紫', concentration: '緑', goodImpressionTurns: '黄', motivation: '赤', strength: '青', fullPower: '桃' }[context.trainingType];
    const item = list(catalog.pItems).find(row => row.nameJa === `H.I.F応援棒（${color}）` && row.identityStatus === 'exact' && compatible(row.plan, plan));
    const publicId = integer(item?.internalId), definition = publicId == null ? null : definitionFor(PItems, publicId, item.gameId);
    if (!definition || !generatedBasicCardIds.length) missingInputs.push('본선 2 응원봉과 기본 카드 생성 풀의 정확한 연결이 필요합니다.');
    else {
      mappedItems.push({ gameId: item.gameId, publicId, name: item.nameJa, source: 'hif_after_final_round_1',
        acquiredAfter: 'final_round_1', sourceUrls: ['https://seesaawiki.jp/gakumasu/d/H.I.F'] });
      limitations.push('본선 1 종료 후 받은 HIF 응원봉을 본선 2에 적용합니다. 시험 시작 덱을 22장까지 기본 카드로 채우며, 원본 기본 카드 종류 중 선택하는 공개 엔진의 분포는 실제 게임과 일치한다고 검증하지 않았습니다. 생성 카드를 일반 카드 획득 지원 효과로 세지 않습니다.');
    }
  }
  const acquiredSupportItems = supportItemAcquisitions ?? result.supportItemAcquisitions ?? {};
  const supports = Array.isArray(result.supports) ? result.supports : [...list(result.supports?.owned), ...(result.supports?.rental ? [result.supports.rental] : [])];
  for (const [supportGameId, acquisition] of Object.entries(acquiredSupportItems)) {
    if (acquisition?.confirmed !== true || integer(acquisition.fromExamIndex) == null || acquisition.fromExamIndex < 0 || acquisition.fromExamIndex > examIndex) continue;
    const selectedSupport = supports.find(row => idOf(row) === supportGameId), card = list(catalog.supportCards).find(row => idOf(row) === supportGameId);
    if (!selectedSupport || !card?.p_item?.name) { missingInputs.push('획득 확정된 P아이템의 실제 편성 서포트를 확인하지 못했습니다: ' + supportGameId); continue; }
    const matches = list(catalog.pItems).filter(item => item.nameJa === card.p_item.name && item.identityStatus === 'exact' && compatible(item.plan, plan));
    const item = matches.length === 1 ? matches[0] : null, publicId = integer(item?.internalId);
    const definition = publicId == null ? null : definitionFor(PItems, publicId, card.p_item.name);
    if (!definition) { missingInputs.push('획득 확정된 서포트 P아이템의 정확한 시험 효과 대응이 없습니다: ' + card.p_item.name); continue; }
    if (definition.mode !== 'stage') { limitations.push(card.p_item.name + '는 육성 중 효과이므로 시험 P아이템에 넣지 않았습니다.'); continue; }
    if (!mappedItems.some(row => row.publicId === publicId)) mappedItems.push({ gameId: item.gameId, publicId, name: item.nameJa,
      source: 'confirmed_support_item', supportGameId, fromExamIndex: acquisition.fromExamIndex });
  }
  if (supports.some(card => card.p_item || list(catalog.supportCards).some(row => idOf(row) === idOf(card) && row.p_item))) limitations.push('서포트 P아이템은 획득 확정과 합류 시험이 명시된 항목만 넣었습니다. 시점 미확인 이벤트 아이템은 보유한 것으로 처리하지 않았습니다.');
  const producerLevel = integer(context.producerLevel?.value);
  function acquisitionCheck(gameId) {
    const card = list(catalog.skillCards).find(row => idOf(row) === gameId && (row.upgradeCount ?? 0) === 0);
    if (!card || card.sourceType !== 'produce' || !compatible(card.plan, plan) || card.recommendationEligible === false) return { reason: '일반 획득 가능한 동일 플랜 스킬로 확인하지 못했습니다: ' + gameId };
    const access = list(personalizedPlan.cardAccess).find(row => row.gameId === gameId)?.normalAcquisition;
    const unlock = catalog.memoryEffectDetails?.tables?.ProducerLevelUnlocks?.[gameId];
    const required = integer(unlock?.level ?? card.unlockProducerLevel);
    if (producerLevel == null || required == null || (required === 0 && !unlock) || producerLevel < required || access?.eligible === false) return { reason: '현재 PLv에서 도중 획득 해금을 확인하지 못했습니다: ' + nameOf(card) };
    const requiresSwitch = unlock?.type === 'ProducerLevelUnlockType_ProduceCardConversion' || card.requiresSkillCardSwitch === true || access?.requiresSwitch === true;
    if (requiresSwitch && access?.switchEligible !== true) return { reason: '스킬 전환 선택이 확인되지 않았습니다: ' + nameOf(card) };
    return { card };
  }
  if (!Array.isArray(assumedCardIds)) missingInputs.push('확보를 가정하는 스킬은 ID 목록으로 지정해야 합니다.');
  else for (const gameId of unique(assumedCardIds)) {
    const access = acquisitionCheck(gameId);
    if (access.reason) { missingInputs.push(access.reason); continue; }
    mapCard({ gameId, upgradeCount: 0, source: 'declared_acquisition_assumption' });
    limitations.push(nameOf(access.card) + '를 이 시험 전까지 획득하고 미강화 상태로 넣는 가정입니다. 출현·획득을 보장하지 않습니다.');
  }
  if (missingInputs.length) return fail();
  const existing = new Set(mappedCards.map(row => row.gameId));
  const suggestedSets = list(personalizedPlan.midgamePlan?.acquisitionTargets).filter(row => !existing.has(row.gameId) &&
    row.normalAcquisition?.eligible === true && !list(row.conflicts).length && !acquisitionCheck(row.gameId).reason).slice(0, 2).map((row, index) => ({
    id: 'eligible_acquisition_' + (index + 1), gameIds: [row.gameId], assumptions: [nameOf(row) + '를 이 시험 전에 실제 선택지에서 확보하는 가정입니다.'],
  }));
  const assembled = { status: 'ready', scope: 'conditional_model', loadout: {
    params: null, supportBonus: 0, pItemIds: mappedItems.map(row => row.publicId),
    generatedBasicCardIds,
    skillCardIdGroups: [mappedCards.map(row => row.publicId)], customizationGroups: [mappedCards.map(row => row.customizations)],
    plan, recommendedEffect: context.trainingType ?? idol.recommendedEffect,
    deckAssumptionConfirmed: true, fullDeckConfirmed: false, assumptions: unique(limitations),
  }, mappedCards, mappedItems, limitations: unique(limitations), missingInputs: [], suggestedSets,
  requiredSimulationInputs: ['시험 직전 Vo·Da·Vi와 최대 체력을 params에 입력해야 합니다.'] };
  return scenario === 'hif' ? applyHifAutomaticRemovals({ built: assembled, examIndex }) : assembled;
}
