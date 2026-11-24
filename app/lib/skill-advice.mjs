const list = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values.filter(Boolean))];
const labels = { core: '핵심', recommended: '추천', situational: '조건부', low: '후순위', avoid: '비추천', unrated: '미평가' };
const grades = { core: 'S', recommended: 'A', situational: 'B', low: 'C', avoid: 'D', unrated: null };
const typePlans = { concentration: 'sense', goodConditionTurns: 'sense', motivation: 'logic', goodImpressionTurns: 'logic', strength: 'anomaly', fullPower: 'anomaly', preservation: 'anomaly' };
const typeLabels = { concentration: '센스 · 집중', goodConditionTurns: '센스 · 호조', motivation: '로직 · 의욕', goodImpressionTurns: '로직 · 호인상', strength: '아노말리 · 강기', fullPower: '아노말리 · 전력', preservation: '아노말리 · 온존' };
const roleNames = { score: '화력', draw: '드로', extra_action: '추가행동', stamina: '체력 회복', cost_reduction: '체력 부담 감소', concentration: '집중', good_condition: '호조', perfect_condition: '절호조', motivation: '의욕', genki: '원기', impression: '호인상', guidance: '지침 전환', full_power: '전력치', enthusiasm: '열의', hand_buff: '손패 강화', growth: '성장', double_effect: '효과 재발동', turn_extension: '턴 연장', debuff_protection: '약화 방지', debuff_recovery: '약화 회복', concentration_scaling: '집중 비례', good_condition_scaling: '호조 비례', impression_scaling: '호인상 비례', motivation_scaling: '의욕 비례', full_power_scaling: '전력치 비례', score_buff: '파라미터 상승량 증가', card_generation: '카드 생성', card_removal: '카드 제외', card_reuse: '카드 재사용', free_use: '비용 없이 사용', draw_setup: '다음 손패 준비', opening_hand: '개막 손패', hold: '보류' };
const relevantRoles = { concentration: ['concentration', 'double_effect'], goodConditionTurns: ['good_condition', 'perfect_condition', 'double_effect'], motivation: ['motivation', 'genki'], goodImpressionTurns: ['impression'], strength: ['guidance', 'enthusiasm', 'growth'], fullPower: ['full_power', 'guidance', 'hand_buff', 'growth'], preservation: ['guidance', 'full_power'] };
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

export function normalizeSkillAdviceInput({ input = {}, catalog = {} } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('스킬 추천 조건을 항목별로 입력해 주세요.');
  const scenario = input.scenario ?? 'hif';
  if (!['hif', 'nia', 'hajime'].includes(scenario)) fail('시나리오를 목록에서 선택해 주세요.');
  const difficulties = { hif: [], nia: ['pro', 'master'], hajime: ['regular', 'pro', 'master', 'legend'] };
  const difficulty = input.difficulty == null || input.difficulty === '' ? scenario === 'hif' ? null : scenario === 'nia' ? 'master' : 'legend' : input.difficulty;
  if (difficulty != null && !difficulties[scenario].includes(difficulty)) fail('선택한 시나리오에 맞는 난이도를 선택해 주세요.');
  const trainingType = input.trainingType ?? 'concentration';
  if (!Object.hasOwn(typePlans, trainingType)) fail('육성 유형을 목록에서 선택해 주세요.');
  const producerLevel = input.producerLevel ?? null;
  if (producerLevel != null && (!Number.isInteger(producerLevel) || producerLevel < 1 || producerLevel > 90)) fail('PLv는 1~90 정수 또는 미확인으로 입력해 주세요.');
  const upgradeCount = input.upgradeCount ?? 1;
  if (![0, 1].includes(upgradeCount)) fail('영구 강화는 미강화 또는 강화 1회로 비교합니다. 시험 중 일시 강화와 구분해 주세요.');
  const purpose = input.purpose ?? 'acquisition';
  if (!['acquisition', 'memory', 'upgrade', 'customization'].includes(purpose)) fail('평가 목적을 목록에서 선택해 주세요.');
  const stage = input.stage ?? 'any';
  if (!['any', 'early', 'late'].includes(stage)) fail('사용 시점을 목록에서 선택해 주세요.');
  const strategy = input.strategy ?? 'general';
  if (!['general', 'inflation', 'outing'].includes(strategy) || scenario !== 'nia' && strategy !== 'general') fail('NIA 육성 방식을 목록에서 선택해 주세요.');
  const context = { scenario, difficulty, trainingType, plan: typePlans[trainingType], producerLevel, upgradeCount, purpose, stage, strategy };
  context.legendCardGameId = input.legendCardGameId || null;
  if (context.legendCardGameId && (scenario !== 'hajime' || difficulty !== 'legend' || !list(catalog.skillAdvice?.cards).some(card => card.gameId === context.legendCardGameId && card.status?.isLegend && card.sourceType === 'produce' && ['free', context.plan].includes(card.plan)))) fail('현재 플랜에 맞는 初 LEGEND 레전드 스킬을 선택해 주세요.');
  for (const [key, values] of Object.entries({ customizationState: ['unknown', 'none', 'matched'], hifAbilityState: ['unknown', 'none', 'matched'], switchState: ['unknown', 'enabled', 'disabled'], acquisitionTimingState: ['unknown', 'opening', 'mid'] })) {
    context[key] = input[key] ?? 'unknown';
    if (!values.includes(context[key])) fail('카드 조건은 미확인·없음·충족 확인 중에서 선택해 주세요.');
  }
  context.idolGameId = input.idolGameId || null;
  if (context.idolGameId) {
    const idol = list(catalog.idolCards).find(row => row.gameId === context.idolGameId);
    if (!idol) fail('P아이돌을 목록에서 선택해 주세요.');
    if (idol.plan !== context.plan) fail('P아이돌의 플랜과 육성 유형을 맞춰 주세요.');
    if (idol.excludedScenarios?.includes(scenario)) context.idolScenarioExcluded = true;
  }
  if (input.cardIds != null && (!Array.isArray(input.cardIds) || input.cardIds.length > 500 || input.cardIds.some(id => typeof id !== 'string'))) fail('확인할 스킬 카드를 목록에서 선택해 주세요.');
  context.cardIds = input.cardIds == null ? null : unique(input.cardIds);
  return context;
}

function allCards(catalog) {
  const data = catalog.skillAdvice ?? {};
  const cards = list(data.cards);
  const unresolved = list(data.unresolvedCards).map(row => ({ ...row, id: row.id ?? `unresolved:${row.sourceId ?? row.source_id ?? row.publicId}`, gameId: null, variants: list(row.variants), status: { ...row.status, identityVerified: false } }));
  return [...cards, ...unresolved];
}
const idOf = card => card.id ?? card.gameId;
function displayCard(card, catalog, upgradeCount = 0, idolGameId = null) {
  const art = list(catalog.skillCards).find(row => row.gameId === card.gameId && row.upgradeCount === upgradeCount) ?? list(catalog.skillCards).find(row => row.gameId === card.gameId);
  const characterId = list(catalog.idolCards).find(idol => idol.gameId === idolGameId)?.characterId;
  const icons = art?.characterIconUrls ?? {};
  const selectedIcon = characterId ? icons[characterId] : null;
  const representativeIcon = Object.values(icons).find(url => typeof url === 'string' && url.startsWith('/assets/'));
  const icon = selectedIcon || art?.imageUrl || art?.thumbnailUrl || representativeIcon || null;
  return { id: idOf(card), gameId: card.gameId ?? null, name: card.nameKo || art?.nameKo || card.nameJa || card.name || '이름 미확인', nameKo: card.nameKo || art?.nameKo || null, nameJa: card.nameJa || card.name || null, plan: card.plan ?? 'free', rarity: card.rarity, sourceType: card.sourceType ?? 'unknown', category: card.category ?? null, isLegend: Boolean(card.status?.isLegend), imageUrl: icon || art?.referenceImageUrl || card.imageUrl || null, thumbnailUrl: icon || art?.referenceImageUrl || card.thumbnailUrl || null };
}

export function buildSkillAdviceOptions({ catalog = {} } = {}) {
  const cards = allCards(catalog);
  const examDecks = list(catalog.deckGuides?.guides).filter(guide => guide.examFlow).map(guide => ({
    id: guide.id, scenario: guide.scenario, difficulty: guide.difficulty, plan: guide.plan, trainingType: guide.trainingType,
    examFlow: guide.examFlow, conditions: guide.conditions, sourceIds: guide.sourceIds,
    memoryRecommendations: list(guide.memoryRecommendations).map(({ gameId, purpose, conditions }) => ({ gameId, purpose, conditions })),
  }));
  return { asOf: catalog.skillAdvice?.asOf ?? null, coverage: { ...catalog.skillAdvice?.coverage, catalogCount: cards.length, verifiedFamilies: cards.filter(row => row.gameId).length, unresolvedFamilies: cards.filter(row => !row.gameId).length },
    examDecks, examDeckSources: list(catalog.deckGuides?.sources).filter(source => examDecks.some(guide => guide.sourceIds.includes(source.id))),
    cards: cards.map(card => ({ ...displayCard(card, catalog), variants: list(card.variants).map(v => ({ upgradeCount: v.upgradeCount, permanent: v.upgradeCount <= 1 })), unlock: card.unlock, origin: card.origin })),
    sources: list(catalog.skillAdvice?.sources), idolCards: list(catalog.idolCards).map(({ gameId, name, nameJa, plan, excludedScenarios }) => ({ gameId, name, nameJa, plan, excludedScenarios })),
    scenarios: [{ id: 'hif', label: 'H.I.F.', difficulties: [] }, { id: 'nia', label: 'N.I.A.', difficulties: ['pro', 'master'] }, { id: 'hajime', label: '初', difficulties: ['regular', 'pro', 'master', 'legend'] }],
    trainingTypes: Object.entries(typePlans).map(([id, plan]) => ({ id, plan })),
    notes: ['공략의 조건부 판단과 효과를 바탕으로 한 잠정 평가를 구분합니다.', '직접 확인하지 못한 효과·신원은 미평가로 남깁니다. 시험 점수나 승률 예측은 아닙니다.'] };
}

function eligibility(card, variant, context, catalog) {
  const blocked = [], unknown = [], restricted = [];
  if (context.idolScenarioExcluded) blocked.push('선택한 P아이돌은 현재 이 시나리오에서 프로듀스할 수 없습니다.');
  if (!card.gameId || card.status?.identityVerified === false) unknown.push('카드 ID·출시·효과의 연결을 확인해야 합니다.');
  if (card.status?.releaseExcluded) blocked.push('출시·자료 검증 조건 때문에 현재 추천 후보에서 제외한 카드입니다.');
  if (card.plan !== 'free' && card.plan !== context.plan) blocked.push('선택한 육성 플랜과 다른 카드입니다.');
  if (!variant) unknown.push('선택한 강화 단계의 효과 자료가 없습니다.');
  const unlock = card.unlock ?? {};
  const isConversion = unlock.requiresConversionSelection === true || unlock.requiresSkillCardSwitch === true;
  const requiresSwitch = isConversion || list(card.switchPartnerGameIds).length > 0 && context.producerLevel != null && context.producerLevel >= unlock.switchUnlockProducerLevel;
  const required = isConversion ? unlock.conversionProducerLevel ?? unlock.acquisitionProducerLevel : context.purpose === 'memory' ? unlock.rentalProducerLevel : unlock.acquisitionProducerLevel;
  const rentalComparison = context.purpose === 'memory' && !isConversion;
  if (required > 0 && context.producerLevel == null) unknown.push(rentalComparison ?
    `앱의 반입 PLv 비교 기준은 대여 해금값 PLv${required}을 참조합니다. 현재 PLv가 없어 충족 여부는 미확인이며, 자기 보유 반입의 공식 적용 범위는 미확정입니다.` : `PLv${required} 조건을 확인할 현재 PLv가 없습니다.`);
  else if (required > 0 && context.producerLevel < required) blocked.push(rentalComparison ?
    `앱의 반입 PLv 비교 기준 미충족: 현재 PLv${context.producerLevel}, 대여 해금값 PLv${required} 참조. 자기 보유 반입의 공식 적용 범위는 미확정입니다.` : `현재 PLv${context.producerLevel}에서는 해금 전입니다. PLv${required}이 필요합니다.`);
  if (requiresSwitch) {
    if (context.switchState === 'disabled') blocked.push('이 카드의 스킬 스위치가 선택되지 않았습니다.');
    if (context.switchState === 'unknown') unknown.push('해금 PLv와 별도로 이 카드의 스킬 스위치 선택을 확인해 주세요.');
  }
  const idolIds = unique([...list(card.origin?.idolGameIds), ...list(card.origin?.primaStellaIdolIds)]);
  // P-idol restrictions apply to obtaining the unique during a run. A carried
  // memory is governed by its carry rules, not ownership of the original idol.
  if (idolIds.length && context.purpose !== 'memory') {
    if (!context.idolGameId) unknown.push('이 고유 카드가 속한 정확한 P아이돌 버전을 선택해 주세요.');
    else if (!idolIds.includes(context.idolGameId)) blocked.push('선택한 P아이돌 버전의 고유 카드가 아닙니다.');
  }
  if (card.sourceType === 'support' && context.purpose !== 'memory') restricted.push('해당 서포트 이벤트에서 얻는 카드입니다. 편성과 이벤트 발생을 확인해야 합니다.');
  if (card.sourceType === 'primaStella') {
    if (context.scenario !== 'hif') restricted.push('일번성 전용 카드의 해당 시나리오 적용 조건을 확인해야 합니다.');
    unknown.push('일번성 해금·사용 상태를 확인해야 합니다.');
  }
  if (card.status?.isLegend || /Legend/i.test(card.rarity ?? '')) unknown.push('레전드 카드의 시나리오·획득 경로를 확인해야 합니다.');
  if (card.status?.isLegend && card.sourceType === 'produce' && context.purpose === 'memory') blocked.push('레전드 스킬 카드는 일반 메모리 생성 추첨에서 제외됩니다. 반입 후보와 구분합니다.');
  if (card.sourceType === 'default' && context.purpose === 'acquisition') restricted.push('시작 덱의 기본 카드입니다. 도중 일반 획득 후보와 구분합니다.');
  const trouble = /Trouble|trouble/.test(card.category ?? '') || variant?.dsl?.type === 'trouble';
  if (trouble) restricted.push('트러블 카드입니다. 직접 화력보다 생성·제거 조건과 덱 간섭을 확인합니다.');
  if (context.purpose === 'upgrade') {
    if (!list(card.variants).some(row => row.upgradeCount === 1)) blocked.push('이 카드는 일반 영구 강화 대상이 아닙니다.');
    if (context.upgradeCount === 1) restricted.push('이미 강화한 사양입니다. 추가 영구 강화와 시험 중 일시 강화를 구분합니다.');
  }
  if (context.purpose === 'customization') {
    if (context.upgradeCount === 0) restricted.push('커스텀은 먼저 강화한 뒤 검토합니다.');
    else if (!(variant?.native?.maxCustomizeCount > 0)) blocked.push('이 사양은 커스텀 가능한 횟수가 없습니다.');
  }
  const status = blocked.length ? 'blocked' : unknown.length ? 'unknown' : restricted.length ? 'restricted' : 'eligible';
  return { status, reasons: unique([...blocked, ...unknown, ...restricted]), requiredProducerLevel: required ?? null, requiresSwitch, conditionFulfillmentSource: 'user_declaration_not_game_verification' };
}

function derivedAssessment(card, variant, context) {
  const roles = list(variant?.roles), has = role => roles.includes(role);
  const dsl = variant?.dsl;
  const text = [dsl?.actions, dsl?.effects].filter(Boolean).join('; ');
  if (/Trouble|trouble/.test(card.category ?? '')) return { tier: 'avoid', reasons: ['직접 사용하는 이득이 없는 트러블 카드입니다. 특정 생성·제거 조합은 별도로 확인합니다.'] };
  if (!card.gameId || card.status?.identityVerified === false || !roles.length || !dsl) return { tier: 'unrated', reasons: ['효과의 의미나 카드 연결이 충분히 확인되지 않아 등급을 보류합니다.'] };
  let tier = 'situational';
  const reasons = [];
  const supportsType = (relevantRoles[context.trainingType] ?? []).some(has);
  if (has('draw') && has('extra_action')) { tier = 'recommended'; reasons.push('손패와 행동 수를 함께 보충해 준비 카드와 주력 카드를 잇는 데 도움이 됩니다.'); }
  else if (has('extra_action') && supportsType) { tier = 'recommended'; reasons.push('선택한 육성 자원을 늘리면서 다음 카드를 사용할 행동도 확보합니다.'); }
  else if (has('turn_extension')) { tier = 'recommended'; reasons.push('추가 턴을 활용할 수 있는 덱에서 준비와 마지막 화력의 기회를 늘립니다.'); }
  else if (supportsType) reasons.push('선택한 육성 유형에서 사용하는 자원을 보충하거나 주력 효과를 준비합니다.');
  else if (has('score')) { tier = 'low'; reasons.push('화력 역할은 있지만 선택한 육성 유형의 자원·행동을 직접 보완하는 효과는 적습니다.'); }
  else reasons.push('현재 덱에서 부족한 체력·손패·자원 역할을 채울 때 검토할 카드입니다.');
  if (context.trainingType === 'motivation' && /score\s*\+=\s*genki\s*\*/.test(text)) {
    tier = context.stage === 'early' ? 'situational' : 'recommended'; reasons.push('원기에 비례하는 화력입니다. 준비한 원기와 사용하는 턴이 중요합니다.');
  }
  if (context.trainingType === 'goodImpressionTurns' && /score\s*\+=\s*goodImpressionTurns\s*\*/.test(text)) { tier = context.stage === 'early' ? 'situational' : 'recommended'; reasons.push('호인상을 쌓은 뒤 화력으로 전환하는 역할입니다.'); }
  if (context.trainingType === 'concentration' && /concentrationMultiplier\s*=\s*[2-9]/.test(text)) { tier = 'recommended'; reasons.push('집중의 적용 배율을 높이는 공격이므로 집중을 준비한 뒤 사용합니다.'); }
  if (context.scenario === 'hif' && context.trainingType === 'fullPower' && has('full_power') && has('hold') && has('score') && !dsl.limit) {
    tier = 'recommended'; reasons.push('전력치를 보충하면서 온존에서 보류한 뒤 전력 상태에서 반복 공격할 수 있습니다. 성장·상승 횟수 커스텀을 갖춘 공략 사양과는 구분합니다.');
  }
  if (['strength', 'fullPower'].includes(context.trainingType) && has('growth')) reasons.push('성장 조건을 반복해서 채워야 하므로 초반 준비와 반복 횟수를 함께 확인합니다.');
  if (context.stage === 'late' && !has('score') && !has('extra_action') && !has('draw')) { tier = 'situational'; reasons.push('후반에는 준비 효과를 활용할 남은 행동·턴이 있는지 확인합니다.'); }
  if (card.sourceType === 'default') {
    tier = context.producerLevel != null && context.producerLevel < 20 && context.stage !== 'late' ? 'situational' : 'low';
    reasons.push('초반의 기본 역할과 이후 압축·대체 우선도를 나누어 봅니다.');
  }
  if (context.producerLevel != null && context.producerLevel < 20 && has('score') && context.stage === 'early') { tier = 'recommended'; reasons.push('핵심 엔진 해금 전 초반 시험의 즉시 화력 후보입니다.'); }
  if ((variant?.native?.stamina ?? 0) + (variant?.native?.forceStamina ?? 0) >= 7) {
    reasons.push(has('cost_reduction') ? '사용 체력과 함께 이 카드의 비용 무효·감소 효과를 비교합니다. 후속 카드의 비용과 원기 확보에 따라 부담이 달라집니다.' : '체력 비용이 커서 회복·원기와 다음 시험 준비를 함께 확인합니다.');
  }
  if (context.purpose === 'memory') {
    reasons.push('반입 가치는 개막 확보 필요성·자연 획득 난도와 다른 세 자리의 역할까지 비교해야 합니다.');
    if (card.sourceType === 'default' || roles.every(role => ['score', 'genki'].includes(role))) tier = 'low';
  }
  if (context.purpose === 'upgrade') {
    const upgraded = list(card.variants).find(row => row.upgradeCount === 1);
    const base = list(card.variants).find(row => row.upgradeCount === 0);
    const addedRoles = list(upgraded?.roles).filter(role => !list(base?.roles).includes(role));
    const extraActionsImprove = (upgraded?.analysis?.directNumbers?.cardUsesRemaining ?? 0) > (base?.analysis?.directNumbers?.cardUsesRemaining ?? 0);
    tier = extraActionsImprove || addedRoles.some(role => ['draw', 'extra_action', 'turn_extension'].includes(role)) ? 'recommended' : card.sourceType === 'default' ? 'low' : 'situational';
    reasons.push(addedRoles.length ? '강화하면 새 역할이 생기는지와 원래 역할의 수치 변화를 함께 봅니다.' : '현재 역할을 유지하며 비용·수치가 개선되는 강화입니다. 핵심 카드의 강화와 우선도를 비교합니다.');
  }
  if (context.purpose === 'customization') {
    tier = 'situational'; reasons.push('카드별 커스텀 항목을 보고 필요한 비용 제거·개막·행동·화력 효과를 골라야 합니다.');
  }
  if (tier === 'recommended' && list(variant?.analysis?.conditionalRoles).some(role => ['draw', 'extra_action', ...(relevantRoles[context.trainingType] ?? [])].includes(role))) { tier = 'situational'; reasons.push('핵심 효과에 발동 조건이 있어 현재 상태·횟수·남은 턴을 확인해야 합니다.'); }
  if (list(variant?.analysis?.risks).some(risk => /sleep|眠気/.test(risk))) reasons.push('졸음 생성으로 손패가 막힐 수 있어 생성 이후의 덱과 제거 조건을 함께 확인합니다.');
  return { tier, reasons };
}

const contextType = value => ['general', 'all', 'common', 'sense', 'logic', 'anomaly'].includes(value) ? null : ({ concentration_spotlight: 'concentration', motivation: 'motivation', good_impression: 'goodImpressionTurns', good_condition: 'goodConditionTurns', full_power: 'fullPower', strong: 'strength' })[value] ?? value;
function evidenceMatches(evidence, card, context) {
  const subjects = list(evidence.subjectGameIds);
  if (!subjects.includes(card.gameId)) return false;
  const c = evidence.context ?? {};
  if (c.mode && !['produce', 'normal'].includes(c.mode)) return false;
  if (list(c.idolGameIds).length && !c.idolGameIds.includes(context.idolGameId)) return false;
  if (c.futureReferenceOnly && !context.idolGameId) return false;
  if (c.eventModeScope && !['ordinary_hif', 'ordinary_nia_master', 'ordinary_nia_pro', 'ordinary_hajime_legend', 'ordinary_produce'].includes(c.eventModeScope)) return false;
  if (c.eventModeScope === 'ordinary_hif' && context.scenario !== 'hif') return false;
  if (c.eventModeScope === 'ordinary_nia_master' && !(context.scenario === 'nia' && context.difficulty === 'master')) return false;
  if (c.eventModeScope === 'ordinary_nia_pro' && !(context.scenario === 'nia' && context.difficulty === 'pro')) return false;
  if (c.eventModeScope === 'ordinary_hajime_legend' && !(context.scenario === 'hajime' && context.difficulty === 'legend')) return false;
  if (c.scenario && !['all', 'common', 'unknown', context.scenario].includes(c.scenario)) return false;
  if (c.plan && !['all', 'free', context.plan].includes(c.plan)) return false;
  const training = contextType(c.trainingType ?? c.build ?? c.planSubtype);
  if (training && training !== context.trainingType) return false;
  if (c.difficulty && !['all', 'unknown', context.difficulty].includes(c.difficulty)) return false;
  if (c.strategy && !['general', context.strategy].includes(c.strategy)) return false;
  if (c.strategyLegendSkillGameId && context.legendCardGameId && c.strategyLegendSkillGameId !== context.legendCardGameId) return false;
  if (c.stage && !['any', context.stage].includes(c.stage)) return false;
  if (c.idolGameId && c.idolGameId !== context.idolGameId) return false;
  if (c.producerLevelMin != null && (context.producerLevel == null || context.producerLevel < c.producerLevelMin)) return false;
  if (c.producerLevelMax != null && (context.producerLevel == null || context.producerLevel > c.producerLevelMax)) return false;
  return true;
}

function matchesAssessmentPurpose(evidence, context) {
  const dimension = evidence.comparisonDimension;
  return dimension === 'deck_performance' ? ['acquisition', 'memory'].includes(context.purpose) : !dimension || ({ acquisition: 'run_acquisition', memory: 'memory_import', upgrade: 'upgrade', customization: 'customization' })[context.purpose] === dimension;
}
function authorAssessment(evidence, context) {
  if (evidence.supersededByEvidenceId) return null;
  if (!matchesAssessmentPurpose(evidence, context)) return null;
  const c = evidence.context ?? {};
  // An unspecified historical difficulty supports an explanation, not a grade
  // for a different, newer difficulty. Likewise keep level-bounded ratings bounded.
  if (context.scenario !== 'hif' && (!c.difficulty || c.difficulty === 'unknown')) return null;
  let grade = evidence.authorTier ?? null;
  const ratings = evidence.authorRatings;
  const boundedLevels = list(c.producerLevelUpperLabels);
  if (boundedLevels.length && (context.producerLevel == null || context.producerLevel > Math.max(...boundedLevels))) return null;
  if (ratings) {
    if (context.purpose === 'acquisition') {
      const rows = list(ratings.acquisition).filter(row => context.producerLevel != null && (row.minProducerLevel == null || context.producerLevel >= row.minProducerLevel) && (row.maxProducerLevel == null || context.producerLevel <= row.maxProducerLevel)).sort((a, b) => (a.maxProducerLevel ?? 999) - (b.maxProducerLevel ?? 999));
      grade = rows[0]?.rating ?? null;
    } else if (context.purpose === 'customization') grade = ratings.customization ?? null;
    else grade = null;
  }
  if (ratings && !grade) return null;
  const categoryTier = !ratings && evidence.authorCategory && evidence.comparisonDimension && evidence.normalizedTier;
  const gradeTier = evidence.authorRatingScale?.[grade] ?? { SS: 'core', S: 'core', A: 'recommended', B: 'situational', C: 'low', D: 'low', E: 'avoid', F: 'avoid' }[grade];
  const tier = !ratings && Object.hasOwn(grades, categoryTier || evidence.normalizedTier) ? categoryTier || evidence.normalizedTier : gradeTier;
  if (!tier || tier === 'unrated' || !grade && !categoryTier) return null;
  const unmet = assessmentRequirements(evidence, context);
  let selectedTier = Object.hasOwn(grades, evidence.purposeTiers?.[context.purpose]) ? evidence.purposeTiers[context.purpose] : tier;
  if (evidence.conditionalAdjustment && context.scenario === 'hif' && context.hifAbilityState === 'matched') {
    const steps = { up_one_tier: 1, up_two_tiers: 2 }[evidence.conditionalAdjustment.authorTierDirection] ?? 0;
    for (let step = 0; step < steps; step++) selectedTier = { avoid: 'low', low: 'situational', situational: 'recommended', recommended: 'core', core: 'core' }[selectedTier];
  }
  return { tier: selectedTier, unmet, originalGrade: grade, guideBasis: evidence.evaluationStatus === 'author_preview_opinion' ? 'author_preview' : grade ? 'author_letter' : 'author_category', evidence };
}

function assessmentRequirements(evidence, context) {
  const unmet = [];
  const requirements = evidence.requirements ?? {};
  const specification = evidence.assessedSpecification ?? requirements;
  const conditions = list(evidence.conditionsKo ?? evidence.conditions ?? requirements.conditionsKo);
  if (specification.upgradeCount != null && context.upgradeCount < specification.upgradeCount) unmet.push('이 평가에 필요한 강화 사양을 갖춰야 합니다.');
  if (specification.earlyExamUpgradeCount != null && context.stage === 'early' && context.upgradeCount < specification.earlyExamUpgradeCount) unmet.push('초반 역할에 필요한 강화 사양을 갖춰야 합니다.');
  if ((specification.acquisitionTiming === 'opening' || requirements.acquisitionTiming === 'opening') && context.purpose === 'memory' && context.acquisitionTimingState !== 'opening') unmet.push('메모리가 개막에 합류하는지 확인해야 합니다.');
  if ((conditions.some(text => /커스텀|개조/.test(text)) || list(requirements.customizationEffects).length) && context.customizationState !== 'matched') unmet.push('이 평가가 요구하는 커스텀 사양을 확인해야 합니다.');
  if (context.upgradeCount === 0 && (conditions.some(text => /커스텀|개조/.test(text)) || list(requirements.customizationEffects).length)) unmet.push('이 커스텀 사양은 강화 후에 준비할 수 있습니다.');
  if ((conditions.some(text => /HIF.*어빌|어빌.*HIF|추가행동 HIF/.test(text)) || /HIF/.test(evidence.authorCategory ?? '')) && context.hifAbilityState !== 'matched') unmet.push('공략에서 요구한 드로·추가행동 계열 HIF 어빌리티를 갖춘 사양인지 확인해야 합니다.');
  if (requirements.idolVersion && !context.idolGameId) unmet.push('작성자가 지정한 P아이돌 버전의 사례입니다.');
  if (evidence.context?.build === 'concentration_spotlight' && !(context.producerLevel >= 75)) unmet.push('이 공략은 PLv75 각광을 확보한 집중 덱의 평가입니다.');
  if (evidence.context?.strategyLegendSkillGameId && !context.legendCardGameId) unmet.push(`이 공략은 ${evidence.context.strategyLegendSkillNameJa || '지정한 레전드 스킬'}을 중심으로 한 덱의 평가입니다. 레전드 스킬 선택을 확인해 주세요.`);
  if (specification.routeItemNameJa) unmet.push(`${specification.routeItemNameJa}을 선택한 경로의 평가입니다. 실제 P아이템을 확인해 주세요.`);
  return unmet;
}

function assessmentScope(evidence) {
  const context = evidence.context ?? {};
  return (context.idolGameId || list(context.idolGameIds).length ? 16 : 0) +
    (context.strategy && context.strategy !== 'general' ? 8 : 0) +
    (context.strategyLegendSkillGameId ? 2 : 0) +
    (contextType(context.trainingType ?? context.build ?? context.planSubtype) ? 4 : 0) +
    (context.stage && context.stage !== 'any' ? 2 : 0) +
    (context.difficulty && !['all', 'unknown'].includes(context.difficulty) ? 1 : 0);
}

function effectSummary(variant) {
  const roles = list(variant?.roles);
  const text = [variant?.dsl?.actions, variant?.dsl?.effects].filter(Boolean).join('; ');
  const lines = [];
  const direct = variant?.analysis?.directNumbers?.score;
  if (Number.isFinite(direct) && !variant?.analysis?.scoreDynamic && !list(variant?.analysis?.conditionalRoles).includes('score')) lines.push(`기본 파라미터 상승 ${direct} · 버프·발동 조건에 따라 달라짐`);
  const nativeEffects = list(variant?.native?.directEffects).filter(effect => !effect.conditional);
  const draw = nativeEffects.find(effect => effect.type === 'ExamCardDraw');
  if (draw?.value1 > 0) lines.push(`카드 드로 ${draw.value1}장`);
  const actions = variant?.analysis?.directNumbers?.cardUsesRemaining;
  if (actions > 0) lines.push(`스킬 사용 추가 ${actions}회`);
  const freeCards = variant?.analysis?.directNumbers?.nullifyCostCards;
  if (freeCards > 0) lines.push(`이후 ${freeCards}장의 소비 체력 무효`);
  if (roles.length) lines.push(roles.map(role => roleNames[role]).filter(Boolean).join(' · '));
  if (variant?.native?.stamina) lines.push(`소비 체력 ${variant.native.stamina}`);
  if (variant?.native?.forceStamina) lines.push(`체력 직접 소모 ${variant.native.forceStamina}`);
  if (!lines.length) lines.push('효과 설명을 확인 중입니다.');
  return lines;
}

function customizationOptions(variant, catalog) {
  const names = { CostPenetrateReduce: '체력 직접 소모 감소', CostReduce: '소비 체력 감소', AggressiveAdd: '의욕 증가', BlockAdd: '원기 증가', FullPowerPointAdd: '전력치 증가', LessonAdd: '파라미터 상승량 증가', LessonBuffAdd: '집중 증가', LessonDependBlockAdd: '원기 비례 화력 증가', LessonDependExamCardPlayAggressiveAdd: '의욕 비례 화력 증가', LessonDependExamReviewAdd: '호인상 비례 화력 증가', ParameterBuffMultiplePerTurnAdd: '절호조 증가', ParameterBuffTurnAdd: '호조 증가', ReviewAdd: '호인상 증가', StaminaConsumptionDownTurnAdd: '체력 소모 감소 지속 연장', CostAggressiveReduce: '의욕 비용 감소', CostFullPowerPointReduce: '전력치 비용 감소', CostLessonBuffReduce: '집중 비용 감소', CostParameterBuffMultiplePerTurnReduce: '절호조 비용 감소', CostParameterBuffReduce: '호조 비용 감소', CostReviewReduce: '호인상 비용 감소', InitialAdd: '개막 손패에 합류', LessonCountAdd: '파라미터 상승 횟수 증가', PlayMovePositionTypeChange: '사용 후 이동 위치 변경', CardStatusEnchantChange: '카드 성장 효과 변경', PlayEffectTriggerChange: '효과 발동 조건 변경', PlayTriggerChange: '사용 조건 변경', EffectAdd: '효과 추가', EffectChange: '효과 변경' };
  const details = new Map(list(catalog.skillAdvice?.customizations).map(row => [row.id, row]));
  const examEffects = new Map(list(catalog.memoryMechanicsGraph?.ProduceExamEffect).map(row => [row.id, row]));
  return list(variant?.customizationIds).map(id => details.get(id)).filter(Boolean).map(option => {
    const levels = list(option.levels).map(level => ({ level: level.level, price: level.price, effectLabels: unique(list(level.growEffects).map(effect => {
      const added = examEffects.get(effect.playProduceExamEffectId);
      const addedLabel = { ProduceExamEffectType_ExamPlayableValueAdd: '추가행동', ProduceExamEffectType_ExamCardDraw: '카드 드로', ProduceExamEffectType_ExamCardUpgrade: '손패 강화' }[added?.effectType];
      return addedLabel ? `${addedLabel} 효과 추가` : names[effect.type] ?? '세부 효과 확인 필요';
    })) }));
    const effectLabels = unique(levels.flatMap(row => row.effectLabels));
    return { id: option.id, name: effectLabels.join(' · '), nameJa: option.nameJa ?? null, max: option.max, levels, priceScope: 'master_base_before_scenario_discounts' };
  });
}

function specificationAdvice(card, variant, context, evidence, catalog) {
  const base = list(card.variants).find(row => row.upgradeCount === 0), plus = list(card.variants).find(row => row.upgradeCount === 1);
  const upgradeAdvice = [], customizationAdvice = [];
  if (!plus) upgradeAdvice.push('일반 영구 강화 대상이 아닙니다.');
  else {
    if (base?.native?.stamina !== plus?.native?.stamina) upgradeAdvice.push(`강화 시 소비 체력 ${base?.native?.stamina ?? '미확인'} → ${plus?.native?.stamina ?? '미확인'}`);
    if (base?.native?.costValue !== plus?.native?.costValue) upgradeAdvice.push(`강화 시 카드 자원 비용 ${base?.native?.costValue ?? '미확인'} → ${plus?.native?.costValue ?? '미확인'}`);
    const baseActions = base?.analysis?.directNumbers?.cardUsesRemaining ?? 0, plusActions = plus?.analysis?.directNumbers?.cardUsesRemaining ?? 0;
    if (baseActions !== plusActions) upgradeAdvice.push(`강화 시 스킬 사용 추가 ${baseActions}회 → ${plusActions}회`);
    const added = list(plus.roles).filter(role => !list(base?.roles).includes(role));
    if (added.length) upgradeAdvice.push(`강화 후 추가 역할: ${added.map(role => roleNames[role] ?? role).join(' · ')}`);
    if (!upgradeAdvice.length) upgradeAdvice.push(card.nativeMaster
      ? '이 카드의 강화 전후 역할과 효과 차이는 검토 중입니다.'
      : '강화 전후 역할은 같습니다. 수치·비용·조건의 개선과 다른 핵심 카드 강화의 우선도를 비교하세요.');
    upgradeAdvice.push('영구 강화는 1회이며, ++·+++는 시험 중 일시 강화와 구분합니다.');
  }
  const cap = variant?.native?.maxCustomizeCount ?? 0;
  if (context.upgradeCount === 0) customizationAdvice.push(`먼저 강화해야 합니다. 강화판의 커스텀 가능 횟수: ${plus?.native?.maxCustomizeCount ?? '미확인'}`);
  else if (!cap) customizationAdvice.push('현재 사양에는 확인된 커스텀 가능 횟수가 없습니다.');
  else customizationAdvice.push(`현재 사양에서 최대 ${cap}회. 같은 카드라도 선택한 항목·횟수에 따라 평가가 달라집니다.`);
  const options = customizationOptions(context.upgradeCount === 0 ? plus : variant, catalog);
  for (const option of options) customizationAdvice.push(`${option.name || option.nameJa || '커스텀 항목'}${option.nameJa ? ` (${option.nameJa})` : ''} · ${option.levels.map(level => `${level.level}단계 ${level.price}PP`).join(' / ')} · 할인 전 기준 비용`);
  for (const row of evidence) for (const condition of list(row.conditionsKo ?? row.conditions ?? row.requirements?.conditionsKo)) if (/커스텀|개조/.test(condition)) customizationAdvice.push(condition);
  for (const row of evidence) for (const alternative of list(row.preferredSpecification?.otherCustomization)) customizationAdvice.push(`그 밖의 권장 개조: ${alternative}`);
  return { upgradeAdvice: unique(upgradeAdvice), customizationAdvice: unique(customizationAdvice), customizationOptions: options };
}

function usageAdvice(variant, context) {
  const roles = list(variant?.roles), lines = [];
  if (roles.some(role => ['concentration', 'motivation', 'impression', 'good_condition', 'growth', 'hand_buff'].includes(role))) lines.push('주력 공격 전에 필요한 버프·성장 조건을 준비하세요.');
  if (roles.includes('draw')) lines.push('준비 카드와 주력 카드가 함께 필요하거나 손패가 부족할 때 드로를 연결하세요.');
  if (roles.includes('extra_action')) lines.push('추가행동 뒤에 사용할 손패와 비용이 남는지 확인하세요.');
  if (roles.includes('score') && ['motivation', 'goodImpressionTurns'].includes(context.trainingType)) lines.push('비례하는 자원을 충분히 쌓고 유리한 속성·턴에 화력으로 전환하세요.');
  if (roles.includes('guidance')) lines.push('현재 지침과 전환 후 행동 수·전력치·손패 수지를 함께 확인하세요.');
  if (!lines.length) lines.push('현재 시험에서 부족한 역할과 사용 조건을 확인한 뒤 사용하세요.');
  return lines;
}

function buildRelationships(card, context, evidence, cards, catalog) {
  const result = [];
  const index = new Map(cards.filter(row => row.gameId).map(row => [row.gameId, row]));
  const typeLabels = { required: '이 조합에 필요', combo_sequence: '사용 순서', synergy: '함께 쓰면 좋은 카드', alternative: '대체 후보', slot_competition: '공간 경쟁', resource_support: '자원 보완', timing_and_stamina_competition: '턴·체력 경쟁', setup_for_finisher: '피니셔 준비', same_conditional_role: '비슷한 조건부 역할', alternative_with_different_cost: '비용이 다른 대안' };
  const switchPartners = list(card.switchPartnerGameIds);
  if (switchPartners.length) result.push({ type: 'conflict', label: '스위치 전후 · 동시 보유 불가', cards: switchPartners.map(id => index.get(id)).filter(Boolean).map(ref => displayCard(ref, catalog, context.upgradeCount, context.idolGameId)), reason: '스킬 스위치로 선택하는 전후 관계입니다. 같은 육성에서 함께 획득·소지할 수 없습니다.', basis: 'official', sourceIds: ['official-card-switch-rules'] });
  for (const row of evidence) for (const relation of list(row.relationships)) {
    const refs = [...list(relation.cards).map(ref => ref.gameId ?? ref.id), ...list(relation.gameIds)].map(id => index.get(id)).filter(ref => ref && ref.gameId !== card.gameId && !switchPartners.includes(ref.gameId));
    if (!refs.length) continue;
    result.push({ type: relation.type ?? 'synergy', label: typeLabels[relation.type] ?? '공략의 조합 조건', cards: refs.map(ref => displayCard(ref, catalog, context.upgradeCount, context.idolGameId)), reason: relation.reasonKo ?? relation.reason ?? '', basis: 'guide', sourceIds: row.sourceIds });
  }
  const roles = list(card.variants.find(row => row.upgradeCount === context.upgradeCount)?.roles);
  const complementary = roles.includes('score') ? unique([...(relevantRoles[context.trainingType] ?? []), 'draw', 'extra_action']) : ['score', 'draw', 'extra_action'];
  const candidates = cards.filter(candidate => candidate.gameId !== card.gameId && !switchPartners.includes(candidate.gameId) && candidate.sourceType === 'produce' && candidate.gameId && !candidate.status?.releaseExcluded && (candidate.plan === 'free' || candidate.plan === context.plan) && candidate.unlock?.acquisitionProducerLevel != null && candidate.unlock.acquisitionProducerLevel <= (context.producerLevel ?? 0) && !candidate.unlock?.requiresConversionSelection && !candidate.status?.isLegend && list(candidate.variants.find(v => v.upgradeCount === context.upgradeCount)?.roles).some(role => complementary.includes(role)));
  if (!result.some(row => row.type !== 'conflict') && candidates.length && roles.length && card.category !== 'trouble') result.push({ type: 'synergy', label: '역할을 보완할 후보', cards: candidates.slice(0, 3).map(ref => displayCard(ref, catalog, context.upgradeCount, context.idolGameId)), reason: '버프·화력·드로·행동의 역할을 보완하는 효과상 후보입니다. 고정 필수 조합은 아닙니다.', basis: 'derived', sourceIds: [] });
  return result.slice(0, 8);
}

function evaluationContext(card, variant, context, evidence) {
  if (card.plan === 'free' || !Object.values(typePlans).includes(card.plan) || card.plan === context.plan) return context;
  const roles = list(variant?.roles);
  let trainingType = card.plan === 'sense' ? roles.includes('good_condition') && !roles.includes('concentration') ? 'goodConditionTurns' : 'concentration' :
    card.plan === 'logic' ? roles.includes('impression') ? 'goodImpressionTurns' : 'motivation' :
    roles.some(role => ['full_power', 'full_power_scaling', 'hand_buff'].includes(role)) ? 'fullPower' : 'strength';
  const order = Object.keys(grades);
  const documented = Object.entries(typePlans).filter(([, plan]) => plan === card.plan).flatMap(([type]) => {
    const candidate = { ...context, plan: card.plan, trainingType: type, idolGameId: null, legendCardGameId: null };
    return list(evidence).filter(row => evidenceMatches(row, card, candidate)).map(row => authorAssessment(row, candidate)).filter(Boolean).map(row => ({ trainingType: type, tier: row.tier }));
  }).sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || Number(b.trainingType === trainingType) - Number(a.trainingType === trainingType));
  trainingType = documented[0]?.trainingType ?? trainingType;
  // Show the best documented native role in an all-plan catalogue. Eligibility
  // still belongs to the user's selected deck, and the chosen role is labelled.
  return { ...context, plan: card.plan, trainingType, idolGameId: null, legendCardGameId: null };
}

export function buildSkillAdvice({ catalog = {}, input = {} } = {}) {
  const context = normalizeSkillAdviceInput({ input, catalog });
  const data = catalog.skillAdvice ?? {}, all = allCards(catalog), ids = new Set(all.map(idOf));
  if (context.cardIds?.some(id => !ids.has(id))) fail('목록에 없는 스킬 카드입니다. 목록을 새로 불러와 주세요.');
  const selected = context.cardIds ? all.filter(row => context.cardIds.includes(idOf(row))) : all;
  const sourceIndex = new Map(list(data.sources).map(row => [row.id, row]));
  const rows = selected.map(card => {
    const requested = list(card.variants).find(row => row.upgradeCount === context.upgradeCount);
    const variant = requested ?? (!list(card.variants).some(row => row.upgradeCount === 1) ? list(card.variants).find(row => row.upgradeCount === 0) : null);
    const cardContext = variant && !requested ? { ...context, upgradeCount: variant.upgradeCount } : context;
    const access = eligibility(card, variant, cardContext, catalog);
    const assessmentContext = evaluationContext(card, variant, cardContext, data.evidence);
    const relevant = list(data.evidence).filter(row => evidenceMatches(row, card, assessmentContext));
    const derived = derivedAssessment(card, variant, assessmentContext);
    const authored = relevant.map(row => authorAssessment(row, assessmentContext)).filter(Boolean).sort((a, b) =>
      assessmentScope(b.evidence) - assessmentScope(a.evidence) || Number(Boolean(a.unmet.length)) - Number(Boolean(b.unmet.length)));
    const chosen = authored[0];
    const guideAssessments = [...new Map(authored.map(row => {
      const sourceId = row.evidence.sourceIds?.[0], url = sourceIndex.get(sourceId)?.url ?? null;
      const value = { evidenceId: row.evidence.id, sourceId, url, grade: grades[row.tier], authorGrade: row.originalGrade, authorCategory: row.evidence.authorCategory ?? null, guideBasis: row.guideBasis, missingConditions: row.unmet };
      return [(url ?? sourceId) + ':' + value.grade + ':' + value.authorGrade + ':' + row.unmet.join('|'), value];
    })).values()];
    const differingGrades = unique(guideAssessments.map(row => row.grade));
    const missing = unique(chosen ? chosen.unmet : relevant.filter(row => !row.authorTier && !row.authorRatings && matchesAssessmentPurpose(row, assessmentContext)).flatMap(row => assessmentRequirements(row, assessmentContext)));
    let tier = chosen?.tier ?? derived.tier, basis = chosen ? chosen.guideBasis === 'author_preview' ? 'derived' : 'guide' : derived.tier === 'unrated' ? 'unknown' : 'derived';
    const potentialTier = tier;
    if (['unknown', 'restricted'].includes(access.status) && ['core', 'recommended'].includes(tier) || missing.length && ['core', 'recommended'].includes(tier)) tier = 'situational';
    if (access.status === 'blocked') tier = 'unrated';
    if (!card.gameId || card.status?.identityVerified === false || card.status?.releaseExcluded || !variant || derived.tier === 'unrated') { tier = 'unrated'; basis = 'unknown'; }
    if (context.purpose === 'customization' && (context.upgradeCount === 0 || !(variant?.native?.maxCustomizeCount > 0)) || context.purpose === 'upgrade' && (!list(card.variants).some(v => v.upgradeCount === 1) || context.upgradeCount === 1)) { tier = 'unrated'; basis = 'unknown'; }
    // A missing confirmation is readiness, not a weaker card. Keep known absent
    // recipes and incompatible upgrade specifications in the performance grade.
    const explicitMissingSpecification = missing.some(text => /강화 사양|강화 후/.test(text)) ||
      cardContext.customizationState === 'none' && missing.some(text => /커스텀/.test(text)) ||
      cardContext.hifAbilityState === 'none' && missing.some(text => /HIF/.test(text)) ||
      cardContext.acquisitionTimingState === 'mid' && missing.some(text => /개막/.test(text));
    const unavailablePurpose = card.status?.isLegend && card.sourceType === 'produce' && context.purpose === 'memory';
    const canGrade = basis !== 'unknown' && card.gameId && !unavailablePurpose;
    const performanceTier = canGrade ? explicitMissingSpecification ? (tier === 'unrated' ? derived.tier : tier) : potentialTier : 'unrated';
    const grade = grades[performanceTier];
    const potentialGrade = canGrade && performanceTier !== potentialTier ? grades[potentialTier] : null;
    const isSelectedType = assessmentContext.trainingType === context.trainingType;
    const gradeNote = unique([!isSelectedType && `${typeLabels[assessmentContext.trainingType]} 기준 평가입니다.`, potentialGrade ? `필요한 카드 사양을 갖추면 ${potentialGrade} 티어입니다.` :
      grade && (missing.length || access.status !== 'eligible') ? '성능 티어와 별도로 아래 사용 조건을 확인해 주세요.' : null,
      chosen?.evidence.context?.strategyLegendSkillGameId && `${chosen.evidence.context.strategyLegendSkillNameJa || '지정 레전드 스킬'} 경로의 공략 평가입니다.`,
      chosen?.guideBasis === 'author_preview' && '출시 전 공개 효과를 보고 낸 원저자 의견에 따른 잠정 티어입니다. 실전 사용 검증과 구별합니다.',
      differingGrades.length > 1 && `공략별 평가는 ${differingGrades.join('/')}로 다릅니다. 대상 사양과 육성 방식을 원문에서 확인해 주세요.`]).join(' ') || null;
    const reasons = unique([...(chosen ? [chosen.evidence.summaryKo] : derived.reasons), ...relevant.filter(row => row.summaryKo).slice(0, 2).map(row => row.summaryKo), ...missing]);
    const { upgradeAdvice, customizationAdvice, customizationOptions } = specificationAdvice(card, variant, assessmentContext, relevant, catalog);
    return { ...displayCard(card, catalog, cardContext.upgradeCount, context.idolGameId), upgradeCount: cardContext.upgradeCount, requestedUpgradeCount: context.upgradeCount,
      rating: { tier, label: labels[tier], performanceTier, grade, gradeNote, potentialGrade, basis, basisLabel: { guide: '공략 근거', derived: '효과 기반 잠정', unknown: '미평가' }[basis], potentialTier: potentialTier !== tier ? potentialTier : null, potentialLabel: potentialTier !== tier ? labels[potentialTier] : null, authorGrade: chosen?.originalGrade ?? null, authorCategory: chosen?.evidence.authorCategory ?? null, guideBasis: chosen?.guideBasis ?? null, assessedConditions: list(chosen?.evidence.requirements?.conditionsKo), guideAssessments, evaluationContext: { plan: assessmentContext.plan, trainingType: assessmentContext.trainingType, strategy: assessmentContext.strategy, isSelectedType } },
      eligibility: access, roles: list(variant?.roles).map(id => ({ id, label: roleNames[id] ?? id })), reasons, usage: usageAdvice(variant, assessmentContext), effectSummary: effectSummary(variant), upgradeAdvice, customizationAdvice,
      relationships: buildRelationships(card, assessmentContext, relevant, all, catalog), missingConditions: unique([...missing, ...(['unknown', 'restricted'].includes(access.status) ? access.reasons : [])]),
      evidence: relevant.filter(row => row.summaryKo).map(row => {
        const assessment = authored.find(value => value.evidence.id === row.id);
        return { id: row.id, sourceIds: row.sourceIds, sourceId: row.sourceIds?.[0], summary: row.summaryKo,
          ...(row.supersededByEvidenceId ? { supersededByEvidenceId: row.supersededByEvidenceId } : {}),
          conditions: row.conditionsKo ?? row.requirements?.conditionsKo ?? [], originalGrade: assessment?.originalGrade ?? row.authorTier ?? null,
          normalizedGrade: assessment ? grades[assessment.tier] : null, authorCategory: row.authorCategory ?? null,
          authorRatingScale: row.authorRatingScale ?? null, sourceBuildRatings: row.sourceBuildRatings ?? null,
          appliedToRating: row.id === chosen?.evidence.id, url: sourceIndex.get(row.sourceIds?.[0])?.url ?? null };
      }),
      meta: { unlockProducerLevel: card.unlock?.acquisitionProducerLevel ?? null, rentalUnlockProducerLevel: card.unlock?.rentalProducerLevel ?? null, conversionProducerLevel: card.unlock?.conversionProducerLevel ?? null, requiresSwitch: access.requiresSwitch, maxCustomizeCount: variant?.native?.maxCustomizeCount ?? null, customizationOptions, permanentUpgradeLimit: 1, origin: card.origin ?? {}, roleStatus: variant?.analysis?.status ?? variant?.roleStatus ?? 'unresolved', temporaryUpgradeCounts: list(card.variants).filter(v => v.upgradeCount > 1).map(v => v.upgradeCount) } };
  });
  return { context, asOf: data.asOf ?? null, coverage: { ...data.coverage, catalogCount: all.length, verifiedFamilies: all.filter(row => row.gameId).length, unresolvedFamilies: all.filter(row => !row.gameId).length, evaluatedCount: rows.length, gradeCounts: Object.fromEntries(Object.keys(labels).map(tier => [tier, rows.filter(row => row.rating.performanceTier === tier).length])), guideCount: rows.filter(row => row.rating.basis === 'guide').length, derivedCount: rows.filter(row => row.rating.basis === 'derived').length }, cards: rows, sources: list(data.sources), warnings: ['효과 기반 잠정 등급은 역할·비용·사용 시점을 비교한 참고 판단입니다. 실제 시험 점수·승률을 계산한 결과가 아닙니다.', ...(context.scenario === 'nia' && context.strategy === 'general' ? ['NIA 팽창·외출 공략의 평가는 육성 방식을 고른 뒤 반영합니다.'] : []), ...(context.producerLevel == null ? ['현재 PLv가 없어 레벨 제한이 있는 카드의 사용 가능 여부는 미확인입니다.'] : [])] };
}
