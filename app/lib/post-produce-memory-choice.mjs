import { summarizeMemoryEffects } from './memory-effects.mjs';
import { findHifMemoryProfile, evaluateHifGuideRole } from './hif-memory-profile.mjs';
import { idolRecipeContext } from './idol-recipe-policy.mjs';
import { buildHifAbilityTargetContext, assessHifEffect } from './hif-ability-guidance.mjs';

const list = value => Array.isArray(value) ? value : [];
const idOf = row => row?.gameId ?? row?.id;
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const axes = ['vo', 'da', 'vi'];
const long = { vo: 'vocal', da: 'dance', vi: 'visual' };
const unknownVector = () => ({ vo: null, da: null, vi: null });
const typeOf = value => ({ full_power: 'fullPower', good_impression: 'goodImpressionTurns', good_condition: 'goodConditionTurns' })[value] ?? value;
const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const sameMultiset = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const effectKey = effect => JSON.stringify({ abilityId: effect.abilityId, abilityLevel: effect.abilityLevel,
  produceSkillId: effect.produceSkillId, effectId: effect.effectId, type: effect.type, trigger: effect.trigger,
  probability: effect.probability, activationCountRaw: effect.activationCountRaw, activationLimit: effect.activationLimit,
  restrictions: effect.nativeRestrictions, appliedRestrictions: effect.restrictions, uniqueKey: effect.uniqueKey,
  valueMin: effect.valueMin, valueMax: effect.valueMax });
const officialSources = [
  { id: 'official-memory-generate', title: '공식 도움말 · 메모리 생성', url: 'https://stat.game-gakuen-idolmaster.jp/html/help/57518177f6e31bea30b483caf16ea057793b78e9864a63d5131bb40b7e5a773c/index.html', checkedAt: '2026-11-04', scope: '소지 스킬에서 생성·재생성하며 후보 중 하나를 선택하는 구조' },
  { id: 'official-memory-produce-effects', title: '공식 도움말 · 프로듀스 편성 시 효과', url: 'https://stat.game-gakuen-idolmaster.jp/html/help/f55ad8e5c496ac39b7d4fa3ac94ba36c2326b9cfefd425b894e070e60ecc8536/index.html', checkedAt: '2026-11-04', scope: '반입 스킬·어빌리티와 완성 능력치를 구분' },
  { id: 'official-memory-hif-ability', title: '공식 도움말 · HIF 전용 어빌리티', url: 'https://stat.game-gakuen-idolmaster.jp/html/help/c7ad38dec09d4003ecaba0130f659fb2b310fbd4bb1e1d2af362001d857916e7/index.html', checkedAt: '2026-11-04', scope: '본선 종료 생성·HIF에서만 효과·동일 효과 중복 발동 불가' },
  { id: 'official-selection-checkpoint', title: '공식 도움말 · 선발 시험 메모리', url: 'https://stat.game-gakuen-idolmaster.jp/html/help/91c45d9078a50354452e6d9e67ceb99a70261d00e4c9295ca58de9020f491b6f/index.html', checkedAt: '2026-11-04', scope: '본선 재시작용 저장 상태로 종료 후 반입 메모리와 구분' },
];

function suppliedVector(value) {
  if (value == null) return { supplied: false, valid: false, value: null };
  const values = Object.fromEntries(axes.map(axis => [axis, numeric(value?.[axis] ?? value?.[long[axis]])]));
  return { supplied: true, valid: axes.every(axis => values[axis] !== null), value: values };
}

function characterRecipeAbilityGoals(catalog, target, carry, genericGoals) {
  const goals = genericGoals.map(goal => ({ ...goal, abilities: [...list(goal.abilities)],
    sourceIds: [...list(goal.sourceIds)], recommendation: goal.recommendation ? { ...goal.recommendation } : undefined }));
  const policy = carry?.characterPolicy;
  if (policy?.applied !== true || policy.selectedIdolGameId !== target.idolGameId) return goals;
  const sourceIds = new Set(list(catalog.idolRecipePolicies?.sources).map(source => source.id));
  for (const recipe of list(policy.sourceRecipes)) {
    const recipeSources = list(recipe.sourceIds);
    if (!recipe.id || !recipeSources.length || recipeSources.some(id => !sourceIds.has(id))) continue;
    for (const required of list(recipe.requiredHifEffects)) {
      if (!required.effectId || !required.abilityId || !required.triggerCardId ||
          !Number.isSafeInteger(required.level) || required.level < 1) continue;
      const native = list(catalog.hifAbilityGuidance?.abilities).find(row => row.abilityId === required.abilityId && row.level === required.level);
      const ability = list(catalog.memoryAbilities).find(row => idOf(row) === required.abilityId && row.level === required.level);
      const card = list(catalog.skillCards).find(row => idOf(row) === required.triggerCardId && (row.upgradeCount ?? 0) === 0);
      if (!native || native.scope !== 'hif_only' || native.effectId !== required.effectId ||
          !list(native.trigger?.cardIds).includes(required.triggerCardId) || !card ||
          !list(ability?.branches).some(branch => branch.produceEffectId === required.effectId)) continue;
      const reference = { id: recipe.id, label: recipe.label ?? recipe.id, sourceIds: [...recipeSources] };
      const existing = goals.find(goal => list(goal.abilities).some(item => item.effectId === required.effectId ||
        item.abilityId === required.abilityId && item.level === required.level));
      if (existing) {
        if (!existing.abilities.some(item => item.abilityId === required.abilityId && item.level === required.level))
          existing.abilities.push({ abilityId: required.abilityId, level: required.level, effectId: required.effectId });
        existing.sourceIds = [...new Set([...existing.sourceIds, ...recipeSources])];
        existing.sourceRecipes = [...list(existing.sourceRecipes).filter(item => item.id !== recipe.id), reference];
        existing.requiresCompleteRecipeEvidence = true;
        existing.nativeReferenceMatched = true;
        existing.recommendation = { ...existing.recommendation,
          ...(existing.recommendation?.priority === 'low_priority' ? { priority: 'primary', purpose: `${reference.label} · ${native.summaryKo}` } : {}),
          conditions: [...new Set([...list(existing.recommendation?.conditions), ...list(recipe.observedConditions)])] };
        continue;
      }
      goals.push({ id: `source:${recipe.id}:${required.effectId}`, triggerCard: {
        gameId: card.gameId ?? card.id, nameKo: card.nameKo ?? null, nameJa: card.nameJa ?? null,
        imageUrl: card.thumbnailUrl ?? card.imageUrl ?? null },
        abilities: [{ abilityId: required.abilityId, level: required.level, effectId: required.effectId }],
        sourceIds: [...recipeSources], sourceRecipes: [reference], sourceScope: 'exact_active_character_source_recipe',
        requiresCompleteRecipeEvidence: true, nativeReferenceMatched: true,
        recommendation: { priority: 'primary', purpose: `${reference.label} · ${native.summaryKo ?? required.summaryKo ?? '원문 HIF 어빌리티 제작 목표'}`,
          conditions: [...list(recipe.observedConditions),
            '어빌리티가 붙은 메모리의 반입 스킬과 발동 대상 카드는 별개입니다.',
            '실제 어빌리티 사본과 발동 대상 확보·사용 조건을 확인합니다. 효과 보유만으로 발동을 확정하지 않습니다.'] } });
    }
  }
  return goals;
}

function targetSources(catalog, target, inventory) {
  const carry = target.scenario === 'hif' ? findHifMemoryProfile(catalog,idolRecipeContext({catalog,inventory,options:target})) : null;
  const matches = list(catalog.hifAbilityGuidance?.profiles).filter(profile => profile.plan === target.plan && typeOf(profile.trainingType) === typeOf(target.trainingType));
  const asari = target.eventModeId?.startsWith('asari') || target.hifMode === 'asari';
  const ability = target.scenario === 'hif' ? (asari ? matches.find(profile => profile.modeFamily === 'asari') : matches.find(profile => profile.modeFamily !== 'asari')) ?? matches.find(profile => profile.modeFamily !== 'asari') : null;
  const genericGoals = list(ability?.goals).map(goal => ({ ...goal, sourceIds: goal.sourceIds ?? list(ability?.sourceIds) }));
  return { carry, ability, goals: characterRecipeAbilityGoals(catalog, target, carry, genericGoals) };
}

function rawInput(candidate) {
  const raw = { ...(candidate.raw ?? {}), ...candidate };
  // The comparison's own fields must not become master-table memory fields.
  delete raw.raw;
  return raw;
}

function targetContext(input, candidateMemory = null) {
  const { catalog, inventory, target, options } = input;
  const selectedIdol = list(catalog.idolCards).find(card => idOf(card) === target.idolGameId);
  const ownedIdol = list(inventory.idolCards).find(card => idOf(card) === target.idolGameId);
  return buildHifAbilityTargetContext({ catalog, inventory, options: { ...options, ...target },
    selectedIdol: selectedIdol ? { ...selectedIdol, ownershipVerified: Boolean(ownedIdol), owned: ownedIdol } : null,
    memories: [...list(options.targetMemories), ...(candidateMemory ? [candidateMemory] : [])] });
}

function normalize(candidate, index, input, owned = false) {
  const { catalog, inventory, target, options, sources } = input;
  const raw = rawInput(candidate), candidateId = String(candidate.candidateId ?? candidate.id ?? raw.userMemoryId ?? `candidate-${index + 1}`);
  const originalOwned = candidate.raw && typeof candidate.raw === 'object' ? candidate.raw : raw;
  const abilityComplete = owned ? Array.isArray(originalOwned.abilities) : candidate.abilitiesComplete === true && Array.isArray(raw.abilities);
  const customComplete = owned ? Array.isArray(originalOwned.produceCard?.customizes) : candidate.customizationsComplete === true && Array.isArray(raw.produceCard?.customizes);
  const modelEffects = summarizeMemoryEffects({ ...raw, raw }, catalog, { ...options, ...target,
    producerLevel: target.producerLevel ?? inventory.producerLevel,
    skillCardSwitchSettings: options.skillCardSwitchSettings ?? inventory.skillCardSwitchSettings });
  const skill = modelEffects.carriedSkill;
  const nativeHifObserved = modelEffects.hifEffects.length > 0;
  const inputKind = candidate.kind ?? raw.kind ?? (owned && abilityComplete && modelEffects.status === 'resolved' ? nativeHifObserved ? 'hif' : 'normal' : 'unknown');
  const requestedKind = ({ hif_ability_memory: 'hif', selection_checkpoint: 'checkpoint' })[inputKind] ?? inputKind;
  const kindConflict = requestedKind === 'normal' && nativeHifObserved ||
    requestedKind === 'hif' && abilityComplete && modelEffects.abilityEffectsResolved === true && !nativeHifObserved;
  const kind = kindConflict ? 'unknown' : ['hif', 'normal', 'checkpoint'].includes(requestedKind) ? requestedKind : nativeHifObserved ? 'hif' : 'unknown';
  const unknowns = [];
  if (!abilityComplete) unknowns.push('어빌리티 목록이 완전한지 확인하지 못했습니다. 빈 목록을 효과 없음으로 판정하지 않습니다.');
  if (!customComplete) unknowns.push('개조 목록이 완전한지 확인하지 못했습니다. 빈 목록을 무개조로 확정하지 않습니다.');
  if (kind === 'unknown') unknowns.push(kindConflict ? '선택한 메모리 종류와 입력한 HIF 전용 어빌리티 정보가 다릅니다. 보상창에서 두 항목을 다시 확인하세요.' : '일반/HIF 메모리 종류를 확인하지 못했습니다.');
  const knownNativeInitialStats = { ...modelEffects.initialStats }, knownNativeGrowthRatePermil = { ...modelEffects.growthRatePermil };
  const nativeTotalsConfirmed = abilityComplete && modelEffects.abilityEffectsResolved === true;
  const directInitial = suppliedVector(candidate.confirmedInitialStats), directGrowth = suppliedVector(candidate.confirmedGrowthRatePermil);
  let manualConflict = false;
  for (const [label, direct, native] of [['초기 가산', directInitial, knownNativeInitialStats], ['성장 보너스', directGrowth, knownNativeGrowthRatePermil]]) {
    if (direct.supplied && !direct.valid) unknowns.push(`${label} 직접 입력은 3축 모두 0 이상의 유한수여야 합니다.`);
    if (direct.valid && nativeTotalsConfirmed && axes.some(axis => direct.value[axis] !== native[axis])) {
      manualConflict = true; unknowns.push(`${label} 직접 입력과 완전히 확인된 어빌리티 합계가 다릅니다. 비교를 보류합니다.`);
    }
  }
  const initialStats = directInitial.valid ? directInitial.value : nativeTotalsConfirmed ? knownNativeInitialStats : unknownVector();
  const growthRatePermil = directGrowth.valid ? directGrowth.value : nativeTotalsConfirmed ? knownNativeGrowthRatePermil : unknownVector();
  const fixedKeys = modelEffects.conditionalEffects.filter(effect => effect.includedInInitialTotals && effect.uniqueKey).map(effect => effect.uniqueKey);
  const recipeKnown = Boolean(skill?.variantKnown && integer(raw.produceCard?.upgradeCount) !== null && [1, 2].includes(skill.phase?.code) && customComplete && skill.customizes.every(custom => custom.exactCountKnown));
  const recipeKey = recipeKnown ? JSON.stringify([skill.id, raw.produceCard.upgradeCount, skill.phase.code,
    skill.customizes.map(custom => [custom.id, custom.customizeCount]).sort()]) : null;
  if (!recipeKnown) unknowns.push('반입 스킬·강화·합류·정확한 개조 조건이 모두 확인되어야 같은 제작 목표끼리 비교할 수 있습니다.');
  const currentStatus = kind === 'checkpoint' ? 'unsupported_candidate_kind' : !skill?.variantKnown ? 'unknown' : skill.obtainable === true ? 'ready' : skill.planCompatible === false ? 'wrong_plan' : skill.obtainable === false ? 'locked' : 'unknown';
  if (currentStatus === 'unknown') unknowns.push('현재 앱 비교에 쓰는 PLv·플랜·스위치 조건이 미확정입니다.');
  const guideRoles = list(sources.carry?.carryRoles).map(role => evaluateHifGuideRole(role, { id: candidateId, modelEffects, skillCard: list(catalog.skillCards).find(card => idOf(card) === skill?.id && (card.upgradeCount ?? 0) === raw.produceCard?.upgradeCount) })).filter(Boolean);
  const ownMemory = { id: candidateId, modelEffects };
  const context = targetContext(input, ownMemory);
  const hifEffects = modelEffects.hifEffects.map(effect => {
    const assessed = assessHifEffect(effect, context);
    const goals = sources.goals.filter(goal => list(goal.abilities).some(ability => ability.abilityId === effect.abilityId && ability.level === effect.abilityLevel));
    return { ...assessed, sourceGoals: goals.map(goal => ({ id: goal.id, purpose: goal.recommendation?.purpose ?? goal.condition,
      priority: goal.recommendation?.priority ?? 'primary', conditions: list(goal.recommendation?.conditions), sourceTiming: goal.sourceTiming ?? null,
      sourceIds: goal.sourceIds ?? sources.ability?.sourceIds ?? [], sourceRecipes: list(goal.sourceRecipes) })), valueOutsideHif: 'inapplicable',
      triggerEvidenceScope: 'future_target_deck_plus_this_candidate_recipe_not_current_produce_result' };
  });
  const nativeHifKeys = new Map(hifEffects.map((effect, index) => [effect, effectKey(modelEffects.hifEffects[index])]));
  const positiveHifEffects = hifEffects.filter(effect => effect.applies === true && (list(options.requiredHifEffectIds).includes(effect.effectId) || effect.sourceGoals.some(goal => goal.priority !== 'low_priority')));
  const readyHif = positiveHifEffects.filter(effect => effect.targetRequirementSatisfied).map(effect => effect.effectId);
  const conditionalHif = positiveHifEffects.filter(effect => !effect.targetRequirementSatisfied).map(effect => effect.effectId);
  const unvaluedProduction = modelEffects.conditionalEffects.filter(effect => !effect.includedInInitialTotals && !modelEffects.hifEffects.includes(effect) && effect.applies !== false).map(effectKey);
  const completedStats = Object.fromEntries(axes.map(axis => [axis, numeric(candidate.completedStats?.[axis] ?? candidate.completedStats?.[long[axis]] ?? raw[long[axis]] ?? candidate.stats?.[long[axis]])]));
  return { candidateId, kind, kindMeaning: kind === 'checkpoint' ? 'selection_restart_checkpoint_not_a_carry_memory' : 'hif_only_ability_classification_not_scenario_carry_prohibition',
    kindEvidence: { input: requestedKind, source: owned ? 'complete_owned_ability_list' : candidate.kindSource ?? 'manual_input', nativeHifAbilityObserved: nativeHifObserved, conflict: kindConflict, isPrimaStellaUsedForClassification: false },
    candidateSource: owned ? 'owned_inventory' : candidate.inputSource ?? 'manual_candidate_input', candidateIsOwnedRecord: owned,
    skill: skill ? { ...skill, imageUrl: list(catalog.skillCards).find(card => idOf(card) === skill.id && (card.upgradeCount ?? 0) === raw.produceCard?.upgradeCount)?.thumbnailUrl ?? null } : null,
    carryReadiness: { status: currentStatus, currentCarryReady: kind === 'checkpoint' || !skill?.variantKnown ? null : skill.obtainable ?? null, futureOnly: currentStatus === 'locked', requiredProducerLevel: skill?.requiredProducerLevel ?? null,
      producerLevel: target.producerLevel ?? inventory.producerLevel ?? null, switchEligible: skill?.switchEligible ?? null },
    initialStats, growthRatePermil, knownNativeInitialStats, knownNativeGrowthRatePermil,
    numericBasis: { initialStats: directInitial.valid ? 'manual_input_replaces_native' : nativeTotalsConfirmed ? 'native_confirmed' : 'unknown_total', growthRatePermil: directGrowth.valid ? 'manual_input_replaces_native' : nativeTotalsConfirmed ? 'native_confirmed' : 'unknown_total', manualConflict },
    completedStats, completedStatsUsedForCarry: false, evaluationScore: numeric(candidate.evaluationScore ?? raw.evaluationScore ?? raw.power ?? raw.evaluation),
    additionalEffects: modelEffects.conditionalEffects.filter(effect=>!effect.includedInInitialTotals&&!modelEffects.hifEffects.includes(effect)).map(({name,text,descriptionJa,applies,trigger,probability,activationLimit,restrictions})=>({name,text,descriptionJa,applies,trigger,probability,activationLimit,restrictions})),
    evaluationScoreRecomputed: false, abilitiesComplete: abilityComplete, abilityEffectsResolved: modelEffects.abilityEffectsResolved, customizationsComplete: customComplete,
    guideAssessment: { profileId: sources.carry?.id ?? null, roles: guideRoles, conditions: list(sources.carry?.conditions), sourceIds: list(sources.carry?.sourceIds),
      fulfilledRoles: guideRoles.filter(role => role.status === 'fulfilled').map(role => role.gameId), unresolvedRoles: guideRoles.filter(role => role.status !== 'fulfilled').map(role => role.gameId), currentFullLoopValidated: false },
    hifAssessment: { appliesInTargetScenario: target.scenario === 'hif', effects: hifEffects, sourceProfileId: sources.ability?.id ?? null,
      sourceConditions: list(sources.ability?.conditions), sourceScope: sources.ability?.scope ?? null, sourceEventMonth: sources.ability?.sourceEventMonth ?? null,
      currentRoundExactRecipeVerified: false, triggerReadyEffectIds: readyHif, conditionalEffectIds: conditionalHif, activationConfirmed: false, numericAbilityWeightApplied: false },
    unknowns: [...unknowns, ...modelEffects.issues], recipeKey, recipeKnown,
    completeForComparison: kind !== 'checkpoint' && kind !== 'unknown' && abilityComplete && recipeKnown && !manualConflict && modelEffects.status === 'resolved' &&
      !(directInitial.supplied && !directInitial.valid) && !(directGrowth.supplied && !directGrowth.valid),
    _comparison: { readyHif: positiveHifEffects.filter(effect => effect.targetRequirementSatisfied).map(effect => nativeHifKeys.get(effect)),
      conditionalHif: positiveHifEffects.filter(effect => !effect.targetRequirementSatisfied).map(effect => nativeHifKeys.get(effect)),
      unvaluedHif: hifEffects.filter(effect => effect.applies !== false && !positiveHifEffects.includes(effect)).map(effect => nativeHifKeys.get(effect)),
      unvaluedProduction, fixedKeys },
    ownedComparison: null, dominates: [], dominatedBy: [], equivalentTo: [], numericDominates: [], numericDominatedBy: [] };
}

function numericOrder(a, b) {
  if (a.numericBasis.manualConflict || b.numericBasis.manualConflict) return null;
  const pairs = ['initialStats', 'growthRatePermil'].flatMap(key => axes.map(axis => [a[key][axis], b[key][axis]]));
  if (pairs.some(pair => pair.some(value => value === null))) return null;
  const ge = pairs.every(([x, y]) => x >= y), le = pairs.every(([x, y]) => x <= y);
  return ge && le ? 0 : ge ? 1 : le ? -1 : null;
}

// Dominance is deliberately restricted to an identical carried-card recipe.
// Unpriced conditional effects, differing duplicate groups, and unknown inputs
// cannot be silently treated as zero-value abilities.
function compare(a, b) {
  if (!a.completeForComparison || !b.completeForComparison || !a.recipeKey || a.recipeKey !== b.recipeKey) return null;
  for (const key of ['conditionalHif', 'unvaluedHif', 'unvaluedProduction', 'fixedKeys']) if (!sameMultiset(a._comparison[key], b._comparison[key])) return null;
  const stats = numericOrder(a, b);
  const allEffects = new Set([...a._comparison.readyHif, ...b._comparison.readyHif]);
  const pairs = [...allEffects].map(id => [Number(a._comparison.readyHif.includes(id)), Number(b._comparison.readyHif.includes(id))]);
  const ag = pairs.every(([x, y]) => x >= y), bg = pairs.every(([x, y]) => x <= y);
  if (stats === 0 && ag && bg) return 0;
  if ((stats === 0 || stats === 1) && ag) return 1;
  if ((stats === 0 || stats === -1) && bg) return -1;
  return null;
}

function creatorCraftingGoals(input) {
  const { catalog, target } = input;
  const goals = [];
  for (const profile of list(catalog.multiCreatorGuidance?.sourceProfiles)) {
    if (profile.scenario !== target.scenario || profile.plan && profile.plan !== target.plan ||
        profile.trainingType && profile.trainingType !== 'general' && typeOf(profile.trainingType) !== typeOf(target.trainingType)) continue;
    const rules = list(profile.rules).filter(rule => rule.purpose === 'post_produce_memory_crafting' &&
      (!list(rule.idolIds).length || list(rule.idolIds).includes(target.idolGameId)));
    for (const customRule of rules.filter(rule => rule.requiredCustomizationsExactVerified === true && list(rule.customizationTargets).length)) {
      const gameId = customRule.cardRefs?.[0]?.gameId;
      const phaseRule = rules.find(rule => rule.requiredPhase && list(rule.cardRefs).some(card => card.gameId === gameId));
      const hifRule = rules.find(rule => rule.abilityTarget?.triggerCardId === gameId && rule.abilityTarget.nativeVerified === true);
      if (!gameId || !phaseRule || !hifRule) continue;
      const ability = hifRule.abilityTarget;
      const native = list(catalog.hifAbilityGuidance?.abilities).find(row => row.abilityId === ability.abilityId && row.level === ability.level);
      const nativeVerified = Boolean(native) && list(native.trigger?.cardIds).includes(gameId) && native.trigger?.perExamActivationLimit === ability.perExamActivationLimit &&
        native.effects.some(effect => effect.kind === 'skill_use_count_add' && effect.value === 1) && !native.effects.some(effect => effect.type === 'ExamCardDraw');
      const card = list(catalog.skillCards).find(card => idOf(card) === gameId && card.upgradeCount === 0);
      const scope = profile.eventModeScope ?? null;
      const minimum = numeric(profile.requirements?.authorRecommendedProducerLevel);
      const sourceLevelMet = minimum === null ? true : numeric(target.producerLevel) === null ? null : target.producerLevel >= minimum;
      const sourceContextVerified = sourceLevelMet === true && (scope === 'ordinary_hif' && !target.eventModeId?.startsWith('asari') ||
        Boolean(profile.eventModeId && profile.eventModeId === target.eventModeId && profile.currentAsariExactRecipeVerified === true));
      goals.push({ id: `creator:${profile.sourceId}:${gameId}`, kind: 'creator_carried_recipe',
        skill: { gameId, nameKo: card?.nameKo ?? null, nameJa: card?.nameJa ?? null, imageUrl: card?.thumbnailUrl ?? card?.imageUrl ?? null },
        purpose: `이 작성자의 ${card?.nameKo ?? card?.nameJa ?? '지정 스킬'} 개시·개조·전용 HIF 제작 대안`, requiredPhase: phaseRule.requiredPhase.nativeCode,
        customizationTargets: customRule.customizationTargets, hifAbilityTarget: { ...ability, effectId: native?.effectId ?? null, nativeReferenceMatched: nativeVerified },
        sourceApplicability: sourceLevelMet === false ? 'future_source_level_reference' : sourceContextVerified ? 'source_context_matches_not_validated_playthrough' : 'historical_event_crafting_reference',
        sourceContextVerified, sourceScope: scope, sourceEventMonth: /\d{6}/.test(scope ?? '') ? `${scope.match(/\d{6}/)[0].slice(0, 4)}-${scope.match(/\d{6}/)[0].slice(4)}` : null, currentRoundExactRecipeVerified: false,
        authorRecommendedProducerLevel: minimum, sourceProducerLevelConditionMet: sourceLevelMet,
        conditions: ['반입 스킬은 프로듀스 시작 시 합류할 것', '원문이 확인한 상승 횟수 개조 1회와 성장 추가 개조 1회를 모두 갖출 것',
          '축적 사용 후 추가 사용 수 +1의 정확한 HIF 어빌리티가 붙을 것 · 시험마다 최대 2회 · 드로우 없음',
          '해당 영상은 2026년 9월 어노말리 아사리의 공략용 메모리 제작 목적이며 일반 HIF·현재 회차·콘테스트의 보편 최적 사양으로 확정하지 않음'],
        sourceRules: [phaseRule, customRule, hifRule].map(rule => ({ id: rule.id, actions: rule.actions, url: rule.url, segment: rule.segment })),
        sourceIds: [...new Set([...list(profile.sourceIds), ...list(native?.sourceIds)])], guaranteedCreation: false, activationConfirmed: false, numericSkillWeightAdded: false,
        strictCandidateRankingChanged: false, ownedFulfilledMemoryIds: [], ownedRecipeSatisfiedMemoryIds: [], ownedConditionalMemoryIds: [] });
    }
  }
  return goals;
}

function assessCreatorGoal(goal, row) {
  const checks = [], add = (kind, passed, reason) => checks.push({ kind, passed, reason });
  add('carried_skill', row.skill?.id == null ? null : row.skill.id === goal.skill.gameId, '작성자가 지정한 정확한 반입 스킬');
  add('carry_eligibility', row.carryReadiness.currentCarryReady, row.skill?.requiresSwitch ?
    '현재 앱 비교 기준의 플랜·실제 스위치 해금 PLv·선택 상태' :
    '현재 앱 비교 기준의 플랜·공식 대여 해금 PLv · 대여 PLv의 자기 보유 적용 범위는 공식 미확정');
  add('opening_phase', row.skill?.phase?.code == null || row.skill.phase.code === 0 ? null : row.skill.phase.code === goal.requiredPhase, '프로듀스 시작 시 합류');
  for (const target of goal.customizationTargets) {
    const custom = list(row.skill?.customizes).find(custom => custom.id === target.id);
    add('exact_customization', !row.customizationsComplete || custom && !custom.exactCountKnown ? null : Boolean(custom && custom.customizeCount === target.count), `${target.labelKo} · 정확한 개조 ${target.count}회`);
  }
  const effect = row.hifAssessment.effects.find(effect => effect.abilityId === goal.hifAbilityTarget.abilityId && effect.abilityLevel === goal.hifAbilityTarget.level);
  add('exact_hif_ability', !row.abilitiesComplete ? null : goal.hifAbilityTarget.nativeReferenceMatched ? Boolean(effect && effect.effectId === goal.hifAbilityTarget.effectId && effect.applies === true && effect.activationLimits.includes(goal.hifAbilityTarget.perExamActivationLimit)) : null,
    '축적 사용 후 추가 사용 수 +1 · 시험마다 최대 2회 · 드로우 없음');
  add('hif_trigger_available', effect ? effect.targetRequirementSatisfied : row.abilitiesComplete ? false : null, 'HIF 발동 대상 축적을 향후 반입 덱에서 확보');
  const recipeStatus = checks.some(check => check.passed === false) ? 'missing' : checks.some(check => check.passed == null) ? 'unknown' : 'fulfilled';
  return { goalId: goal.id, recipeStatus, recipeRequirementsSatisfied: recipeStatus === 'fulfilled', sourceApplicability: goal.sourceApplicability,
    currentSourceContextVerified: goal.sourceContextVerified, currentWholeRecipeValidated: false, activationConfirmed: false, checks };
}

/** Picker metadata; generic customization names do not prove applicability. */
export function buildPostMemoryChoiceOptions({ catalog = {}, skillId = null } = {}) {
  const references = new Map(list(catalog.hifAbilityGuidance?.abilities).map(row => [`${row.abilityId}:${row.level}`, row]));
  const abilities = list(catalog.memoryAbilities).map(row => {
    const id = idOf(row), reference = references.get(`${id}:${row.level}`), restrictions = row.restrictions ?? {};
    const hifOnly = restrictions.produceTypeEnum === 'ProduceType_HatsuboshiIdolFestival' || sameSet(list(restrictions.explicitGroupScenarios), ['hif']);
    const effects = summarizeMemoryEffects({ abilities: [{ id, level: row.level }] }, catalog).conditionalEffects;
    const plain = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const effectLabels = effects.map(effect => [...new Set([
      effect.text?.replace(/실드/g, '기운'), ...list(effect.trigger?.conditions).map(condition => condition.text),
      effect.probability?.percent != null ? `${effect.probability.percent}% 발동` : null,
      ...list(effect.restrictions).map(condition => condition.kind === 'scenario' ? list(condition.required).map(value => ({hajime:'初',nia:'N.I.A.',hif:'H.I.F.'})[value] ?? value).join('·')+' 전용' : condition.kind === 'plan' ? ({sense:'센스',logic:'로직',anomaly:'어노말리'})[condition.required]+' 전용' : null),
      effect.activationLimit ? `최대 ${effect.activationLimit}회` : null,
      plain(effect.descriptionJa),
    ].filter(Boolean))].join(' · '));
    const choiceLabel = `${hifOnly ? 'HIF' : '일반'} · ${hifOnly && reference ? list(reference.triggerCards).map(card=>card.nameKo||card.nameJa).join('·')+' → '+list(reference.effects).map(effect=>effect.textKo).join(' · ') : effectLabels.join(' / ') || row.summaryKo || row.nameKo || row.name || '효과 확인 필요'} · Lv.${row.level}`;
    return { id, level: row.level, name: row.summaryKo ?? row.nameKo ?? row.name ?? row.nameJa ?? null,
      nameJa: row.nameJa ?? null, hifOnly, effectIds: list(row.branches).map(branch => branch.produceEffectId),
      hifReferenceMatched: Boolean(reference), effectSummary: reference ? list(reference.effects).map(effect => effect.textKo).filter(Boolean).join(' · ') : row.summaryKo ?? null,
      triggerCards: list(reference?.triggerCards), trigger: reference?.trigger ?? null, duplicateGroupKey: reference?.duplicateGroupKey ?? null,
      choiceLabel, selectionKey: `${id}:${row.level}` };
  });
  const labels = new Map();
  for (const ability of abilities) { const group = labels.get(ability.choiceLabel) ?? []; group.push(ability); labels.set(ability.choiceLabel, group); }
  for (const group of labels.values()) if (group.length > 1) group.sort((a,b)=>a.selectionKey.localeCompare(b.selectionKey)).forEach((ability,index)=>{ability.choiceLabel += ` · 사양 ${index+1}`;});
  const selectedSkill = list(catalog.skillCards).find(card => idOf(card) === skillId);
  return { abilities, hifAbilities: abilities.filter(row => row.hifOnly),
    customizations: { status: 'applicability_unverified_in_loaded_catalog', skillId, skillKnown: Boolean(selectedSkill), choices: [],
      genericCatalogCount: list(catalog.customizations).length, emptyChoicesMeansNoCustomizationsAvailable: false,
      reason: '현재 카탈로그에는 선택한 스킬에 적용 가능한 정확한 개조 연결 자료가 없습니다. 같은 이름의 일반 개조를 적용 가능 후보로 단정하지 않습니다.' },
    kindChoices: [{ value: 'normal', label: '일반 메모리' }, { value: 'hif', label: 'HIF용 생성 메모리 · 전용 효과는 HIF에서만' },
      { value: 'unknown', label: '종류 미확인' }, { value: 'checkpoint', label: '선발 시험 저장 메모리 · 비교 대상 아님' }],
    sources: officialSources };
}

/** Compare end-of-produce output candidates; never selects carry-in memories. */
export function buildPostProduceMemoryChoice({ candidates = [], target = {}, catalog = {}, inventory = {}, options = {} } = {}) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  const targetIdol = list(catalog.idolCards).find(card => idOf(card) === target.idolGameId);
  if (targetIdol && target.plan && targetIdol.plan !== target.plan) throw new RangeError('선택한 P아이돌의 플랜과 향후 사용 플랜이 다릅니다.');
  const normalizedTarget = { ...target, scenario: target.scenario ?? 'hif', producerLevel: target.producerLevel ?? inventory.producerLevel };
  const sources = targetSources(catalog, normalizedTarget, inventory), input = { catalog, inventory, target: normalizedTarget, options, sources };
  const rows = candidates.map((candidate, index) => normalize(candidate, index, input));
  if (new Set(rows.map(row => row.candidateId)).size !== rows.length) throw new RangeError('candidateId must be unique');
  const owned = list(inventory.memories).map((memory, index) => normalize(memory, index, input, true));
  for (const row of rows) {
    for (const other of rows) if (row !== other) {
      const order = compare(row, other), numeric = numericOrder(row, other);
      if (order === 1) row.dominates.push(other.candidateId);
      if (order === -1) row.dominatedBy.push(other.candidateId);
      if (order === 0) row.equivalentTo.push(other.candidateId);
      if (numeric === 1) row.numericDominates.push(other.candidateId);
      if (numeric === -1) row.numericDominatedBy.push(other.candidateId);
    }
    const same = owned.filter(memory => row.recipeKey && memory.recipeKey === row.recipeKey);
    const better = same.filter(memory => compare(row, memory) === 1), worse = same.filter(memory => compare(row, memory) === -1), equal = same.filter(memory => compare(row, memory) === 0);
    row.ownedComparison = { status: !row.recipeKnown ? 'recipe_unknown' : !same.length ? 'new_recipe' : worse.length ? 'existing_copy_better' : equal.length ? 'equivalent_existing_copy' : better.length ? 'improves_existing_copy' : 'tradeoffs_or_unknown',
      sameRecipeOwnedCount: same.length, improvedOwnedMemoryIds: better.map(memory => memory.candidateId), dominatingOwnedMemoryIds: worse.map(memory => memory.candidateId), equivalentOwnedMemoryIds: equal.map(memory => memory.candidateId),
      existingCopyStillOwned: true, candidateOwnershipGranted: false, allDifferentRecipesCompared: false };
    row.reasons = [row.kind === 'checkpoint' ? '선발 재시작용 기록은 종료 후 반입 메모리 후보와 다른 기능이므로 비교에서 제외합니다.' :
      row.carryReadiness.status === 'ready' ? '현재 앱 비교 기준의 반입 조건을 충족한 후보입니다. 대여 해금 PLv의 자기 보유 적용 범위는 공식 미확정이며 실전 발동·완성 루프는 별도입니다.' :
      row.carryReadiness.status === 'locked' ? '앱의 PLv·스위치 비교 기준에서는 향후 후보입니다. 대여 해금 PLv의 자기 보유 적용 범위는 공식 미확정입니다.' :
      row.carryReadiness.status === 'wrong_plan' ? '선택한 향후 사용 플랜과 반입 스킬이 맞지 않습니다.' : '현재 반입 조건을 확정하지 못했습니다.',
      ...(row.guideAssessment.roles.length ? ['공략 반입 역할의 합류·개조·해금 조건을 각각 대조했습니다.'] : []),
      ...(row.hifAssessment.effects.length ? [normalizedTarget.scenario === 'hif' ? 'HIF 효과는 실제 발동 대상 카드의 확보 시점과 사용 조건을 별도로 확인합니다.' : 'HIF 전용 어빌리티는 이 시나리오에서 발동하지 않습니다. 일반 반입 스킬·초기·성장은 별도 비교합니다.'] : [])];
  }
  const comparable = rows.filter(row => row.completeForComparison && row.carryReadiness.status === 'ready');
  const frontier = comparable.filter(row => !row.dominatedBy.length);
  const currentCandidates = rows.filter(row => !['wrong_plan', 'locked', 'unsupported_candidate_kind'].includes(row.carryReadiness.status));
  const hasUnknown = currentCandidates.some(row => !row.completeForComparison || row.carryReadiness.status === 'unknown');
  const single = frontier.length === 1 && !hasUnknown && currentCandidates.every(row => row === frontier[0] || frontier[0].dominates.includes(row.candidateId));
  const status = !rows.length ? 'no_candidates' : !currentCandidates.length ? 'no_compatible_candidates' : single ? 'recommended' : hasUnknown || !frontier.length ? 'insufficient_data' : 'tradeoffs';
  const recommendedCandidateIds = single ? [frontier[0].candidateId] : [];
  const creatorGoals = creatorCraftingGoals(input);
  const sourceIds = new Set([...list(sources.carry?.sourceIds), ...list(sources.ability?.sourceIds), ...sources.goals.flatMap(goal => list(goal.sourceIds)), ...creatorGoals.flatMap(goal => goal.sourceIds), ...rows.flatMap(row => row.hifAssessment.effects.flatMap(effect => effect.sourceGoals.flatMap(goal => goal.sourceIds)))]);
  const seenSources = new Set();
  const usedSources = [...list(catalog.hifMemoryRoles?.sources), ...list(catalog.idolRecipePolicies?.sources), ...list(catalog.hifAbilityGuidance?.sources), ...list(catalog.multiCreatorGuidance?.sources)].filter(source => sourceIds.has(source.id) && !seenSources.has(source.id) && seenSources.add(source.id));
  const ownedFulfilledRoles = new Set(owned.flatMap(row => row.guideAssessment.fulfilledRoles));
  const creationContext = targetContext(input);
  const creationGoals = [
    ...list(sources.carry?.carryRoles).map(role => {
      const card = list(catalog.skillCards).find(card => idOf(card) === role.gameId && (card.upgradeCount ?? 0) === (role.preferredUpgrade ?? 0));
      const matching = owned.filter(row => row.guideAssessment.roles.some(match => match.gameId === role.gameId));
      return { id: `carry:${role.gameId}`, kind: 'carried_skill', skill: { gameId: role.gameId, nameKo: role.nameKo ?? card?.nameKo, nameJa: role.nameJa ?? card?.nameJa, imageUrl: card?.thumbnailUrl ?? card?.imageUrl ?? null },
        purpose: role.purpose, requiredPhase: role.requiredAcquisitionPhaseForEarlyRole ?? null, preferredUpgrade: role.preferredUpgrade ?? null,
        customizationCriteria: role.customizationCriteria ?? null, customizationRequirement: role.customizationRequirement ?? role.customizationPreference ?? null,
        carryUnlockProducerLevel: role.carryUnlockProducerLevel ?? card?.rentalUnlockProducerLevel ?? null, normalUnlockProducerLevel: role.normalUnlockProducerLevel ?? card?.unlockProducerLevel ?? null,
        requiresSwitch: role.requiresSwitch ?? card?.requiresSkillCardSwitch ?? null,
        ownedFulfilledMemoryIds: matching.filter(row => row.guideAssessment.fulfilledRoles.includes(role.gameId)).map(row => row.candidateId),
        ownedConditionalMemoryIds: matching.filter(row => row.guideAssessment.roles.some(match => match.gameId === role.gameId && match.status === 'unknown')).map(row => row.candidateId),
        sourceScope: 'conditional_guide_carry_role_not_a_guaranteed_drop', conditions: [...list(sources.carry?.conditions), ...(role.deckCondition ? [role.deckCondition] : [])], sourceIds: list(sources.carry?.sourceIds), guaranteedCreation: false };
    }),
    ...sources.goals.filter(goal => goal.recommendation?.priority !== 'low_priority').map(goal => {
      const matches = owned.filter(row => row.hifAssessment.effects.some(effect => list(goal.abilities).some(ability => effect.abilityId === ability.abilityId && effect.abilityLevel === ability.level)));
      const targets = creationContext.targets.filter(card => card.gameId === goal.triggerCard?.gameId);
      const canAcquire = creationContext.canAcquire(goal.triggerCard?.gameId);
      const availability = targets.find(card => card.availability === 'at_start')?.availability ?? targets[0]?.availability ?? (canAcquire === true ? 'conditional_during' : canAcquire === false ? 'missing' : 'unknown');
      const fulfilled = row => (!goal.requiresCompleteRecipeEvidence || row.completeForComparison) && row.carryReadiness.currentCarryReady === true &&
        row.hifAssessment.effects.some(effect => effect.targetRequirementSatisfied && list(goal.abilities).some(ability => effect.abilityId === ability.abilityId && effect.abilityLevel === ability.level));
      return { id: `hif:${goal.id}`, kind: 'hif_ability', triggerCard: goal.triggerCard, abilities: list(goal.abilities), purpose: goal.recommendation?.purpose ?? goal.condition,
        triggerAvailability: availability, triggerEvidenceScope: 'provided_future_target_deck_not_all_owned_memories', sourceTiming: goal.sourceTiming ?? null,
        ownedFulfilledMemoryIds: matches.filter(fulfilled).map(row => row.candidateId),
        ownedConditionalMemoryIds: matches.filter(row => !fulfilled(row)).map(row => row.candidateId),
        sourceScope: goal.sourceScope ?? sources.ability?.scope ?? null, sourceRecipes: list(goal.sourceRecipes),
        nativeReferenceMatched: goal.nativeReferenceMatched ?? null, carrierSkillUnrestricted: list(goal.sourceRecipes).length > 0,
        requiredCarriedSkillId: null, sourceEventMonth: sources.ability?.sourceEventMonth ?? null, currentRoundExactRecipeVerified: false,
        conditions: [...list(sources.ability?.conditions), ...list(goal.recommendation?.conditions), ...(goal.condition ? [goal.condition] : [])],
        sourceIds: goal.sourceIds ?? list(sources.ability?.sourceIds), guaranteedCreation: false, activationConfirmed: false };
    }),
  ];
  for (const goal of creatorGoals) {
    const matching = owned.filter(row => row.skill?.id === goal.skill.gameId).map(row => ({ row, assessment: assessCreatorGoal(goal, row) }));
    goal.ownedRecipeSatisfiedMemoryIds = matching.filter(match => match.assessment.recipeRequirementsSatisfied).map(match => match.row.candidateId);
    goal.ownedFulfilledMemoryIds = goal.sourceContextVerified ? [...goal.ownedRecipeSatisfiedMemoryIds] : [];
    goal.ownedConditionalMemoryIds = matching.filter(match => match.assessment.recipeStatus === 'unknown' || match.assessment.recipeRequirementsSatisfied && !goal.sourceContextVerified).map(match => match.row.candidateId);
    creationGoals.push(goal);
  }
  const adviceItems = [];
  for (const row of rows) {
    const fills = row.guideAssessment.fulfilledRoles.filter(id => !ownedFulfilledRoles.has(id));
    const owns = row.guideAssessment.fulfilledRoles.filter(id => ownedFulfilledRoles.has(id));
    const creatorAssessments = creatorGoals.filter(goal => goal.skill.gameId === row.skill?.id).map(goal => assessCreatorGoal(goal, row));
    const goalIds = [...row.guideAssessment.roles.map(role => `carry:${role.gameId}`), ...row.hifAssessment.effects.flatMap(effect => effect.sourceGoals.filter(goal => goal.priority !== 'low_priority').map(goal => `hif:${goal.id}`)), ...creatorAssessments.map(assessment => assessment.goalId)];
    row.sourceAdvice = { goalIds: [...new Set(goalIds)], fillsMissingOwnedGuideRoleIds: fills, ownedFullyMatchingGuideRoleIds: owns,
      existingCopyStatus: row.ownedComparison.status, absoluteWinnerAcrossRecipes: false, creatorGoalAssessments: creatorAssessments,
      fillsMissingOwnedCreatorRecipeGoalIds: creatorAssessments.filter(assessment => assessment.recipeRequirementsSatisfied && !creatorGoals.find(goal => goal.id === assessment.goalId).ownedRecipeSatisfiedMemoryIds.length).map(assessment => assessment.goalId),
      ownedRoleCoverageStatus: inventory.collectionStatus?.memories === 'complete' ? 'complete_collected_inventory' : 'within_supplied_owned_inventory' };
    if (row.kind === 'checkpoint' || row.carryReadiness.status === 'wrong_plan') continue;
    const why = [...(fills.length ? ['현재 입력된 보유 목록에서 충족 사본이 없는 공략 반입 역할을 채웁니다.'] : []),
      ...(row.ownedComparison.status === 'improves_existing_copy' ? ['같은 반입 스킬·강화·합류·개조의 기존 사본보다 확인된 항목이 개선됩니다.'] : []),
      ...(row.ownedComparison.status === 'equivalent_existing_copy' ? ['같은 제작 목표의 동등한 사본을 이미 보유해 새 반입 효과 개선은 확인되지 않았습니다.'] : []),
      ...(row.ownedComparison.status === 'existing_copy_better' ? ['같은 제작 목표로 이미 더 나은 확인 사본이 있습니다.'] : []),
      ...(row.hifAssessment.triggerReadyEffectIds.length ? ['공략 또는 직접 지정한 HIF 효과의 발동 대상이 향후 반입 덱 조건에 있습니다. 실제 사용·자원 조건은 별도입니다.'] : []),
      ...(creatorAssessments.length ? [creatorAssessments.some(assessment => assessment.recipeRequirementsSatisfied) ? '별도 작성자의 개시·정확한 두 개조·HIF 제작 사양을 충족합니다. 현재 회차 적용과 실제 발동은 별도로 남깁니다.' : '별도 작성자의 제작 목표와 비교했으며 개시·정확한 개조·HIF 중 부족하거나 미확정인 조건을 표시합니다.'] : []),
      ...(row.guideAssessment.unresolvedRoles.length || row.hifAssessment.conditionalEffectIds.length ? ['공략 목표 후보이지만 합류·개조 또는 HIF 발동 대상 확보 조건이 아직 남아 있습니다.'] : [])];
    if (why.length) adviceItems.push({ candidateId: row.candidateId, when: row.carryReadiness.futureOnly ? '향후 반입 PLv·스위치 등 잠금을 충족한 뒤 해당 공략 목표를 만들 때' : '표시한 공략 제작 목표를 우선할 때',
      why, goalIds: row.sourceAdvice.goalIds, requiresConfirmation: !row.completeForComparison || row.guideAssessment.unresolvedRoles.length > 0 || row.hifAssessment.conditionalEffectIds.length > 0 || creatorAssessments.some(assessment => !assessment.recipeRequirementsSatisfied || !assessment.currentSourceContextVerified),
      sourceIds: [...new Set(creationGoals.filter(goal => row.sourceAdvice.goalIds.includes(goal.id)).flatMap(goal => goal.sourceIds))] });
  }
  for (const row of rows) delete row._comparison;
  const choicePaths = [];
  if (status === 'tradeoffs' && frontier.length > 1) {
    const add = (when, matches) => {
      if (matches.length && matches.length < frontier.length) choicePaths.push({ when, candidateIds: matches.map(row => row.candidateId) });
    };
    add('첫 시험부터 반입 스킬을 쓰려면', frontier.filter(row => row.skill.phase.availableAtStart === true));
    add('보유 목록에서 비어 있는 공략 역할을 채우려면', frontier.filter(row => row.sourceAdvice.fillsMissingOwnedGuideRoleIds.length));
    add('다음 덱에 발동 대상이 확인된 HIF 효과를 남기려면', frontier.filter(row => row.hifAssessment.triggerReadyEffectIds.length));
    if (inventory.collectionStatus?.memories === 'complete') {
      add('아직 보유하지 않은 스킬·강화·합류·개조 조합을 남기려면', frontier.filter(row => row.ownedComparison.status === 'new_recipe'));
    }
    const skillIds = new Set(frontier.map(row => row.skill.id));
    if (!choicePaths.length && skillIds.size > 1) for (const id of skillIds) {
      const matches = frontier.filter(row => row.skill.id === id), skill = matches[0].skill;
      add(`다음 덱에 ‘${skill.nameKo || skill.name || skill.nameJa || id}’을 넣으려면`, matches);
    }
    for (const axis of axes) for (const [key, label, divisor, unit] of [['initialStats', '초기 가산', 1, ''], ['growthRatePermil', '성장률', 10, '%']]) {
      const values = frontier.map(row => row[key][axis]);
      if (values.some(value => value == null) || new Set(values).size < 2) continue;
      const best = Math.max(...values), name = { vo: '보컬', da: '댄스', vi: '비주얼' }[axis];
      add(`${name} ${label}을 우선하면 (+${best / divisor}${unit})`, frontier.filter(row => row[key][axis] === best));
    }
  }
  let reason = '후보에 표시된 미확인 항목을 보상창과 대조한 뒤 다시 비교하세요.';
  if (status === 'recommended') {
    if (rows.length === 1) reason = '입력한 후보 한 장의 반입 조건을 확인했습니다. 재생성 후보가 있으면 추가해 함께 비교하세요.';
    else if (currentCandidates.length === 1) reason = '선택한 사용처에서 지금 반입 조건이 확인된 후보가 한 장입니다.';
    else reason = '같은 스킬·강화·합류·개조에서 확인한 능력치나 효과가 더 좋고, 다른 비교 항목도 동등하거나 더 좋습니다.';
  } else if (status === 'tradeoffs') {
    const equivalent = frontier.every(row => row === frontier[0] || row.equivalentTo.includes(frontier[0].candidateId));
    if (equivalent) reason = '우선 남길 수 있는 후보들은 확인한 반입 스킬·어빌리티·수치가 동등합니다.';
    else reason = choicePaths.length ? '다음 육성에서 먼저 확보할 항목을 고르세요. 조건마다 해당하는 후보를 표시했습니다.' :
      '조건부 어빌리티나 개조가 다릅니다. 후보 상세에서 다음 덱에 사용할 효과를 확인하세요.';
    if (equivalent && frontier.length < rows.length) choicePaths.push({when:'같은 효과를 얻으려면 이 중 한 장',candidateIds:frontier.map(row=>row.candidateId)});
  } else if (status === 'no_candidates') {
    reason = creationGoals.length ? '보상창을 열기 전에는 아래 제작 목표를 참고하세요. 보상창을 열면 실제 후보를 입력해 비교할 수 있습니다.' :
      '이 조건에 연결된 제작 공략이 없습니다. 보상창의 후보를 입력하면 스킬·합류 시점·어빌리티를 비교할 수 있습니다.';
  } else if (status === 'no_compatible_candidates') {
    reason = '각 후보의 플랜·반입 조건을 확인하세요. 선발 시험 저장 기록은 본선 재개에 사용합니다.';
  }
  return { status, target: normalizedTarget, recommendedCandidateIds, nonDominatedCandidateIds: frontier.map(row => row.candidateId), futureCandidateIds: rows.filter(row => row.carryReadiness.futureOnly).map(row => row.candidateId),
    recommendation: { status, reason, choicePaths },
    creationGoals, conditionalAdvice: { status: 'purpose_conditional_not_absolute_winner', candidateIds: adviceItems.map(item => item.candidateId), items: adviceItems, rankedByScalar: false },
    candidates: rows, priorityGroups: {
      currentConfirmedSourceGoalIds: rows.filter(row => row.carryReadiness.status === 'ready' && (row.guideAssessment.fulfilledRoles.length || row.hifAssessment.triggerReadyEffectIds.length)).map(row => row.candidateId),
      currentConditionalSourceGoalIds: rows.filter(row => row.carryReadiness.status === 'ready' && (row.guideAssessment.unresolvedRoles.length || row.hifAssessment.conditionalEffectIds.length)).map(row => row.candidateId),
      futureSourceGoalIds: rows.filter(row => row.carryReadiness.futureOnly && (row.guideAssessment.roles.length || row.hifAssessment.effects.some(effect => effect.sourceGoals.length))).map(row => row.candidateId),
      groupsAreEvidenceNotScalarRanks: true,
    }, comparisonRules: { method: 'same_recipe_pareto_with_source_verified_hif_effects', skillWeightsAdded: false, battleSimulationUsed: false, completedStatsUsedForCarry: false,
      numericComparison: '초기 3축·성장 3축만 비교하며 서로 다른 반입 스킬 성능의 우열로 쓰지 않습니다.',
      sourcePriority: '공략의 정확한 역할·개조·합류 조건과 실제 발동 대상이 확인된 HIF 목표를 구분하며 미확인을 충족으로 세지 않습니다.',
      hifKindAlwaysPreferred: false, officialEvaluationScoreUsedForCarryRanking: false },
    coverage: { candidateCollectionCaptured: options.candidatesCaptured === true, candidateInputSource: options.candidatesCaptured === true ? 'declared_captured_candidate_list' : 'manual_candidate_input_not_collector_list',
      ownedInventoryUsedOnlyForExistingCopyComparison: true, candidateAddedToInventory: false },
    limitations: ['이 비교는 육성 종료 후 생성·재생성 후보 중 남길 메모리를 고르는 참고이며, 다음 육성에 가져갈 4장을 재선정하지 않습니다.',
      '다른 반입 스킬·정확히 다른 개조 목표는 임의 점수로 합쳐 순위를 만들지 않습니다. 확인된 같은 제작 조건에서만 우열을 판단합니다.',
      '조건부 HIF 효과·드로우·사용 수·졸음 제외를 스탯이나 실제 시험 점수로 환산하지 않습니다.',
      '완성 능력치와 공식 평가점은 입력한 제작 기록이며 반입 능력치와 합산하지 않습니다. 평가점을 임의 생성하지 않습니다.',
      '메모리의 어빌리티 등록 시점은 반입 스킬 합류 시점과 별개입니다. 실제 트리거 카드 사용과 자원 조건은 별도입니다.'], sources: [...officialSources, ...usedSources] };
}
