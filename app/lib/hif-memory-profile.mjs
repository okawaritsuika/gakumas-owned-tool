// Conditional guide matching, not a battle simulator. Only explicit structured
// criteria are executable; prose-only deck/customization conditions stay unknown.
import { resolveIdolRecipePolicy } from './idol-recipe-policy.mjs';
const numeric = x => x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x);
const trainingTypeOf = type => ({ full_power: 'fullPower', good_condition: 'goodConditionTurns', goodCondition: 'goodConditionTurns',
  good_impression: 'goodImpressionTurns', goodImpression: 'goodImpressionTurns', enthusiasm: 'strength' })[type] ?? type;
const skillOf = memory => memory.modelEffects?.carriedSkill;
const growsOf = skill => (skill?.customizes ?? []).flatMap(custom =>
  (custom.growEffects ?? []).map(grow => ({ ...grow, customizeCount: custom.customizeCount, exact: custom.exactCountKnown === true })));

export function findHifMemoryProfile(catalog, options = {}) {
  const { plan, trainingType, hifMode = 'normal' } = options;
  const baseProfile = hifMode === 'normal' ? catalog.hifMemoryRoles?.profiles?.find(profile => profile.plan === plan &&
    (trainingTypeOf(profile.trainingType) === trainingTypeOf(trainingType) || profile.trainingTypeAliases?.map(trainingTypeOf).includes(trainingTypeOf(trainingType)))) ?? null : null;
  const idol = options.selectedIdol ?? options.idol;
  const owned = idol?.owned ?? {};
  const resolved = resolveIdolRecipePolicy({ catalog, baseProfile, context: { ...options, plan, trainingType, hifMode,
    scenario: options.scenario ?? 'hif', idolGameId: options.idolGameId ?? options.idolCardId ?? idol?.gameId ?? idol?.id,
    specialTrainingRank: Object.hasOwn(options, 'specialTrainingRank') ? options.specialTrainingRank : numeric(owned.levelLimitRank ?? owned.uncap ?? owned.raw?.levelLimitRank),
    potentialRank: Object.hasOwn(options, 'potentialRank') ? options.potentialRank : numeric(owned.potentialRank ?? owned.awakeningRank ?? owned.awakening ?? owned.raw?.potentialRank) } });
  if (baseProfile && resolved.evidence.applied === false && resolved.evidence.observations?.length) {
    return { ...baseProfile, characterPolicy: { ...resolved.evidence, usedForSelection: false }, characterSelectionRules: [] };
  }
  return resolved.profile;
}

export function evaluateHifGuideRole(role, memory) {
  const skill = skillOf(memory);
  if (skill?.id !== role.gameId) return null;
  const checks = [];
  const add = (kind, passed, reason) => checks.push({ kind, passed, reason });
  const carryConditions = skill.requiresSwitch ? '현재 앱 비교 기준의 플랜·실제 스위치 해금 PLv·선택 상태' :
    '현재 앱 비교 기준의 플랜·공식 대여 해금 PLv(대여 PLv의 자기 보유 적용 범위는 공식 미확정)';
  add('carry_eligibility', skill.obtainable ?? null,
    `${carryConditions} ${skill.obtainable === true ? '충족' : skill.obtainable === false ? '불충족' : '미확정'}`);
  if (role.requiredAcquisitionPhaseForEarlyRole != null) {
    const phase = skill.phase?.code;
    add('acquisition_phase', phase == null || phase === 0 ? null : phase === role.requiredAcquisitionPhaseForEarlyRole,
      phase === role.requiredAcquisitionPhaseForEarlyRole ? '공략에서 요구한 개시 획득 확인' :
        phase == null || phase === 0 ? '획득 시점 미확인' : '중간 시험 후 획득으로 개시 역할을 충족하지 못함');
  }
  if (role.preferredUpgrade != null) {
    const upgrade = numeric(skill.upgrade ?? skill.upgradeCount);
    add('guide_upgrade', upgrade == null ? null : upgrade >= role.preferredUpgrade,
      upgrade >= role.preferredUpgrade ? '공략의 권장 강화 단계 충족' : '공략의 권장 강화 단계 미충족 또는 미확인');
  }
  if (role.sourceAcquisitionPhaseUnconfirmed === true) add('source_acquisition_phase', null,
    '보유 사본의 합류 시점과 별개로 원문 사본의 합류 시점은 미확인입니다. 같은 출발 조건으로 확정하지 않습니다.');
  if (role.sourceCustomizationsFullyKnown === false) add('source_customizations', null,
    '원문 사본의 전체 개조를 확인하지 못했습니다. 동명·동강화만으로 같은 완성 사양을 인증하지 않습니다.');
  for (const requirement of role.exactCustomizations ?? []) {
    const customs=skill?.customizes??[],matching=customs.filter(custom=>custom.id===requirement.id);
    const confirmed=matching.some(custom=>custom.exactCountKnown===true&&numeric(custom.customizeCount)>=requirement.minimumCount);
    const unknown=matching.some(custom=>custom.exactCountKnown!==true)||customs.some(custom=>custom.unresolved);
    add('exact_customization',confirmed?true:unknown?null:false,
      confirmed?'원문과 같은 개조 ID·누적 횟수 확인':'원문 개조의 정확한 ID·누적 횟수 조건이 미충족 또는 미확인입니다.');
  }
  const criteria = role.customizationCriteria;
  const grows = growsOf(skill);
  const matching = grows.filter(grow => grow.effectType === criteria?.nativeGrowEffectType && grow.exact);
  const unresolved = (skill.customizes ?? []).some(custom => !custom.exactCountKnown || custom.growEffects?.some(grow => grow.unresolved));
  if (criteria?.kind === 'grow_effect') {
    let passed;
    if (criteria.guideCustomizationCount != null) passed = matching.some(grow => numeric(grow.customizeCount) >= criteria.guideCustomizationCount);
    else passed = matching.reduce((sum, grow) => sum + (numeric(grow.value) ?? 0), 0) >= (criteria.minimumValue ?? 1);
    add('customization', passed ? true : unresolved ? null : false,
      passed ? '동일 커스텀 ID·누적 횟수의 원본 성장 효과가 공략 수치 조건 충족' :
        unresolved ? '커스텀의 정확한 단계·효과를 확인하지 못함' : '공략에서 요구한 종류·수치의 커스텀 미충족');
    // Some research profiles deliberately describe only one part of the full
    // custom template. Passing that part must not certify the whole template.
    if (criteria.note?.includes('완성 템플릿으로 확정하지 않음')) add('remaining_customization', null, criteria.note);
  } else if (criteria?.kind === 'effective_cost') {
    const card = memory.skillCard;
    const base = card?.costType === 'ExamCostType_ExamParameterBuff' ? numeric(card.costValue) : null;
    const reduction = matching.reduce((sum, grow) => sum + (numeric(grow.value) ?? 0), 0);
    const remainder = base == null ? null : Math.max(0, base - reduction);
    add('effective_cost', base == null || unresolved ? null : remainder <= criteria.maximum,
      base == null ? '강화 단계별 기본 호조 비용 원자료 없음' : unresolved ? '비용 감소 커스텀 원자료 미확정' :
        `기본 호조 비용 ${base} − 확인된 감소 ${reduction} = ${remainder}; 공략 조건 ${criteria.maximum} 이하`);
  } else if (role.customizationRequirement && !(role.exactCustomizations?.length)) add('customization', null, '서술형 커스텀 요건을 실행 가능한 원자료 조건으로 확정하지 못함: ' + role.customizationRequirement);
  if (role.deckCondition) add('deck_condition', null, '실제 시험 덱 조건은 미검증: ' + role.deckCondition);
  const status = checks.some(check => check.passed === false) ? 'missing' : checks.some(check => check.passed == null) ? 'unknown' : 'fulfilled';
  return { gameId: role.gameId, nameKo: role.nameKo, nameJa: role.nameJa, purpose: role.purpose, status,
    memoryId: memory.id, checks, reasons: checks.filter(check => check.passed !== true).map(check => check.reason) };
}

export function hifGuideConflicts(profile, memories) {
  if (!profile) return [];
  const ids = new Set(memories.map(memory => skillOf(memory)?.id));
  const conflicts = [];
  for (const pair of profile.incompatibleCarryPairs ?? []) if (pair.cards?.every(card => ids.has(card.gameId))) {
    conflicts.push({ kind: 'carry_pair', status: 'conflict', reason: pair.reason, cardIds: pair.cards.map(card => card.gameId) });
  }
  for (const anti of profile.antiSynergies ?? []) {
    if (anti.kind === 'remove_cards') {
      const effects = memories.flatMap(memory => memory.modelEffects?.hifEffects ?? []).filter(effect => effect.applies !== false);
      if (effects.some(effect => effect.actions?.some(action => action.kind === 'remove_cards' &&
          (action.search?.cards?.some(card => card.id === anti.target?.gameId) || action.removeCardIds?.includes(anti.target?.gameId))))) {
        conflicts.push({ kind: anti.kind, status: 'unknown', reason: anti.condition + ' ' + anti.decision, cardIds: [anti.target.gameId] });
      }
    } else if (anti.kind === 'customization' && memories.some(memory => skillOf(memory)?.id === anti.target?.gameId &&
        growsOf(skillOf(memory)).some(grow => grow.exact && grow.effectType === anti.nativeGrowEffectType))) {
      conflicts.push({ kind: anti.kind, status: 'unknown', reason: anti.condition + ': ' + anti.decision, cardIds: [anti.target.gameId] });
    }
  }
  return conflicts;
}

export function summarizeHifGuideProfile(profile, memories, catalog, { prioritized = false, manual = false, candidates = [], characterPolicyUsed } = {}) {
  if (!profile) return null;
  const rank = { fulfilled: 0, unknown: 1, missing: 2 };
  const roles = (profile.carryRoles ?? []).map(role => {
    const matches = memories.map(memory => evaluateHifGuideRole(role, memory)).filter(Boolean).sort((a, b) => rank[a.status] - rank[b.status]);
    if (matches.length) return matches[0];
    const owned = candidates.map(memory => evaluateHifGuideRole(role, memory)).filter(Boolean).sort((a, b) => rank[a.status] - rank[b.status]);
    return { gameId: role.gameId, nameKo: role.nameKo, nameJa: role.nameJa, purpose: role.purpose,
      status: owned[0]?.status === 'unknown' ? 'unknown' : 'missing', memoryId: null,
      checks: owned[0]?.checks ?? [], reasons: ['선택된 반입 메모리 4장에 해당 역할이 없음', ...(owned[0]?.reasons ?? [])] };
  }).map(role => {
    const memory = memories.find(memory => memory.id === role.memoryId);
    const skill = memory?.skillCard ?? catalog.skillCards?.find(skill => skill.gameId === role.gameId && (skill.upgradeCount ?? 0) === 0);
    return { ...role, skillImageUrl: skill?.thumbnailUrl ?? skill?.imageUrl ?? null, skillCharacterIconUrls: skill?.characterIconUrls ?? {} };
  });
  const applied = !manual && prioritized && roles.some(role => role.status === 'fulfilled' && role.memoryId != null);
  const selectedTentativeCount = roles.filter(role => role.status === 'unknown' && role.memoryId != null).length;
  const considered = !manual && prioritized && (applied || selectedTentativeCount > 0);
  return { id: profile.id, labelKo: profile.labelKo, trainingType: profile.trainingType, status: profile.status, applied,
    considered, tentative: considered && selectedTentativeCount > 0, selectedTentativeCount,
    applicationMode: manual ? 'manual_targets_override' : applied ? 'guide_roles_prioritized' : considered ? 'guide_roles_tentative' :
      profile.status !== 'conditional_guide_profile' ? 'unconfirmed_profile' : 'no_verified_role',
    sources: [...new Map([...(catalog.hifMemoryRoles?.sources ?? []), ...(catalog.idolRecipePolicies?.sources ?? [])].map(source => [source.id, source])).values()]
      .filter(source => profile.sourceIds?.includes(source.id))
      .map(({ id, title, url, author, published, publishedAt, updated, checkedAt, scope }) => ({ id, title, url, author, published, publishedAt, updated, checkedAt, scope })),
    conditions: [...(profile.conditions ?? [])], roles,
    optionalCarryRoles: [...(profile.optionalCarryRoles ?? [])], originalCarryRoleGameIds: [...(profile.originalCarryRoleGameIds ?? [])],
    characterSelectionRules: [...(profile.characterSelectionRules ?? [])],
    characterPolicy: profile.characterPolicy ? { ...profile.characterPolicy,
      usedForSelection: characterPolicyUsed === undefined ? profile.characterPolicy.usedForSelection : characterPolicyUsed } : null,
    preparationNotes: [profile.firstSelectionWithoutHifAbilities, profile.requiredClarification,
      '이 자료는 일반 HIF의 조건부 운영 사례입니다. 작성 당시의 고레벨 완성 루프를 현재 계정의 실전 준비 완료로 판정하지 않습니다.'].filter(Boolean),
    conflicts: hifGuideConflicts(profile, memories),
    fulfilledCount: roles.filter(role => role.status === 'fulfilled').length,
    missingCount: roles.filter(role => role.status === 'missing').length,
    unknownCount: roles.filter(role => role.status === 'unknown').length, readinessConfirmed: false };
}
