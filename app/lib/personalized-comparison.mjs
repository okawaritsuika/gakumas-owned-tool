import { recommend } from './recommend.mjs';
import { buildPersonalizedPlan } from './personalized-plan.mjs';
import { projectHifStageStats, projectHifStamina } from './hif-stage-projection.mjs';
import { buildHifBattleStage, npcPassBounds } from './hif-battle-stage.mjs';
import { buildBattleLoadout } from './battle-loadout.mjs';
import { simulateBattle } from './battle-simulation.mjs';
import { summarizeMemoryEffects } from './memory-effects.mjs';
import { buildProduceProgression, applyProgressionEdits } from './produce-progression.mjs';

const axes = ['vocal', 'dance', 'visual'];
const labels = ['선발시험 1', '선발시험 2', '선발시험 3', '본선 라운드 1', '본선 라운드 2'];
const list = value => Array.isArray(value) ? value : [];
const idOf = row => row?.gameId ?? row?.id;
const unique = values => [...new Set(values.filter(Boolean))];
const finite = value => typeof value === 'number' && Number.isFinite(value);

function artworkForMemories(memories, inventory) {
  const owned = new Map(list(inventory.memories).map(row => [idOf(row), row]));
  return list(memories).map(row => {
    const original = owned.get(idOf(row));
    return { ...row, effects: row.modelEffects ?? original?.effects ?? null, produceRecordStats: original?.stats ?? null,
      ...Object.fromEntries(['imageUrl', 'thumbnailUrl', 'idolImageUrl', 'skillImageUrl', 'characterImageUrl',
        'characterName', 'characterNameJa', 'idolName', 'idolNameJa', 'skillNameKo', 'skillNameJa'].map(key => [key, original?.[key] ?? row[key] ?? null])) };
  });
}

function supportsOf(result) {
  return Array.isArray(result.supports) ? result.supports : [...list(result.supports?.owned),
    ...(result.supports?.rental ? [{ ...result.supports.rental, isRental: true }] : [])];
}

function traceArtwork(trace, catalog) {
  if (!trace) return null;
  const index = new Map(list(catalog.skillCards).filter(card => card.internalId != null).map(card => [String(card.internalId), card]));
  const decorate = row => {
    if (!row) return null;
    const card = index.get(String(row.id));
    return { ...row, gameId: card?.gameId ?? null, nameKo: card?.nameKo ?? null,
      nameJa: card?.nameJa ?? row.name, imageUrl: card?.thumbnailUrl ?? card?.imageUrl ?? null };
  };
  return { ...trace, generatedAtStart: list(trace.generatedAtStart).map(decorate), turns: list(trace.turns).map(turn => ({ ...turn,
    drawnCards: list(turn.drawnCards).map(decorate), playedCards: list(turn.playedCards).map(decorate), heldCards: list(turn.heldCards).map(decorate),
    decisions: list(turn.decisions).map(decision => ({ ...decision, hand: list(decision.hand).map(decorate), selectedCard: decorate(decision.selectedCard) })) })) };
}

function unknownPass(reason) {
  return { status: 'unknown', lower: null, upper: null, reason };
}

function stagePassBounds(exam, catalog, samples) {
  const bounds = npcPassBounds(exam, catalog, samples);
  return exam.stage === 'final' ? { status: 'unknown_combined_npc', lower: null, upper: null, roundBounds: bounds,
    reason: '본선 승리는 라운드 1의 1.2배와 라운드 2 점수를 합산합니다. 같은 라이벌의 합산 점수 대응을 확인하지 못해 한 라운드 점수만으로 우승·탈락을 판정하지 않습니다.' } : bounds;
}

export function summarizeFinalContribution(stages) {
  const first = stages.find(stage => stage?.examIndex === 3) ?? stages[3], second = stages.find(stage => stage?.examIndex === 4) ?? stages[4];
  const sampleScores = list(first?.sampleScores).flatMap((row, index) => {
    const next = second?.sampleScores?.[index];
    return finite(row.score) && finite(next?.score) ? [{ runIndex: index, round1Seed: row.seed, round2Seed: next.seed,
      round1Score: row.score, round2Score: next.score, score: Math.floor(row.score * 1.2) + next.score }] : [];
  });
  const scores = sampleScores.map(row => row.score).sort((a, b) => a - b), count = scores.length;
  const quantile = proportion => { const position = (count - 1) * proportion, lower = Math.floor(position), upper = Math.ceil(position);
    return scores[lower] + (scores[upper] - scores[lower]) * (position - lower); };
  return { status: count ? 'conditional_model_contribution' : 'unsupported', formula: 'floor(round1Score * 1.2) + round2Score',
    pairingMethod: 'same_sample_index_independent_stage_seeds',
    evaluationScoreImplemented: false, sourceUrls: ['https://seesaawiki.jp/gakumasu/d/H.I.F'], sampleScores,
    statistics: count ? { runs: count, mean: scores.reduce((sum, value) => sum + value, 0) / count, median: quantile(0.5),
      min: scores[0], maxObserved: scores.at(-1), p10: quantile(0.1), p90: quantile(0.9) } : null,
    limitations: ['공개된 본선 두 라운드의 점수 합산 기여만 계산했습니다. 최종 육성 평가점·등급 전체를 계산한 값은 아닙니다.',
      '같은 표본 순번의 라운드를 합쳤습니다. 라운드 사이 남은 체력·아이템·카드 변경을 연속 재현한 시험 기록은 아닙니다.'] };
}

function normalizedOptions(options) {
  return { ...options, scenario: options.scenario ?? 'hif', idolGameId: options.idolId ?? options.idolGameId,
    trainingType: options.type ?? options.trainingType,
    objective: options.goal === 'memory' ? 'memory_farming' : options.objective ?? 'stats' };
}

async function runProgressionRoutes({ result, personalizedPlan, candidate, inventory, catalog, options, runs, exams, cache }) {
  const plan = buildProduceProgression({ result, personalizedPlan, inventory, catalog, options }), routes = [];
  for (const route of plan.routes) {
    const memoryIds = new Set(list(result.memories).map(idOf));
    const examDeckSizes = candidate.baselineStages.map((stage, examIndex) => {
      const existing = new Set(stage.mappedCards.map(card => card.gameId)), active = route.events.filter(event => event.fromExamIndex <= examIndex);
      return stage.mappedCards.length + unique(active.filter(event => event.action === 'acquire' && !existing.has(event.gameId)).map(event => event.gameId)).length
        - active.filter(event => event.action === 'remove').length;
    });
    const routeOptions = { ...options, supportLevelMode:'current', produceActions: route.events, examDeckSizes, idolGameId: idOf(result.selectedIdol), compareSupportUpgrades: candidate.levelMode === 'upgraded' };
    const reselection = recommend({ inventory: { ...inventory, memories: list(inventory.memories).filter(memory => memoryIds.has(idOf(memory))) }, catalog, options: routeOptions });
    const upgrade = reselection.supportUpgradeComparison;
    const routeResult = candidate.levelMode === 'upgraded' && upgrade?.available ? { ...reselection, supports: upgrade.supports, memories: upgrade.memories,
      scoreSummary: upgrade.scoreSummary, warnings: upgrade.warnings, assumptions: upgrade.assumptions, supportUpgradeComparison: null } : reselection;
    routeResult.memories = artworkForMemories(routeResult.memories, inventory);
    const routePlan = buildPersonalizedPlan({ result: routeResult, inventory, catalog, options: routeOptions });
    const routeStamina = projectHifStamina(routeResult);
    const stages = [];
    for (let examIndex = 0; examIndex < 5; examIndex++) {
      const baseline = candidate.baselineStages[examIndex], active = route.events.filter(event => event.fromExamIndex <= examIndex);
      const exam = exams.find(row => row.stage === baseline.stage && row.order === baseline.order);
      const projection = projectHifStageStats({ result: routeResult, inventory, catalog, examIndex, options: routeOptions });
      const output = { ...baseline, status: 'unsupported', statistics: null, sampleScores: [], representativeTrace: null, bestTrace: null,
        passBounds: unknownPass('누적 획득 경로의 시험 표본을 계산하지 못했습니다.'), projection, progressionEvents: active,
        limitations: unique([...list(projection?.assumptions), ...list(routeStamina.limitations)]) };
      if (!exam || !projection || !finite(routeStamina.value)) { stages.push(output); continue; }
      const battleStage = buildHifBattleStage({ exam, catalog, stats: projection.stats });
      const existingIds = new Set(baseline.mappedCards.map(card => card.gameId));
      const acquired = unique(active.filter(event => event.action === 'acquire').map(event => event.gameId)).filter(id => !existingIds.has(id));
      let built = buildBattleLoadout({ result: routeResult, personalizedPlan: routePlan, catalog, stage: { stage: baseline.stage, order: baseline.order },
        includeAfterMid: examIndex >= 1, assumedCardIds: acquired, supportItemAcquisitions: options.supportItemAcquisitions });
      built = applyProgressionEdits({ built, route, examIndex, catalog });
      output.mappedCards = list(built.mappedCards); output.mappedItems = list(built.mappedItems); output.automaticRemovals = built.automaticRemovals;
      output.deckState = { routeId: route.id, origin: 'declared_progression', actualSessionCaptured: false,
        cardCount: output.mappedCards.length, automaticRemovals: built.automaticRemovals,
        cumulativeAcquisitions: active.filter(event => event.action === 'acquire'), appliedEdits: list(built.appliedEvents) };
      output.limitations = unique([...output.limitations, ...plan.assumptions, ...list(built.limitations), ...list(built.missingInputs),
        battleStage.status !== 'ready' ? battleStage.reason : null]);
      if (built.status !== 'ready' || !built.loadout || battleStage.status !== 'ready') { stages.push(output); continue; }
      const loadout = { ...built.loadout, params: [...axes.map(axis => projection.stats[axis]), routeStamina.value] };
      const input = { loadout, stage: battleStage.stage, runs, seed: (610397104 + examIndex * 1000) >>> 0, threshold: null };
      const key = JSON.stringify(input);
      if (!cache.has(key)) cache.set(key, await simulateBattle(input));
      const simulated = cache.get(key);
      output.status = simulated.status; output.deck = loadout; output.statistics = simulated.statistics; output.sampleScores = list(simulated.sampleScores);
      output.coefficients = battleStage.coefficients; output.coefficientMethod = battleStage.coefficientMethod;
      output.representativeTrace = traceArtwork(simulated.representativeTrace, catalog); output.bestTrace = traceArtwork(simulated.bestTrace, catalog);
      output.limitations = unique([...output.limitations, ...list(simulated.limitations), ...list(simulated.reasons)]);
      if (simulated.status === 'simulated') output.passBounds = stagePassBounds(exam, catalog, output.sampleScores);
      stages.push(output);
    }
    const final = stages[4], finalContribution = summarizeFinalContribution(stages);
    routes.push({ ...route, stages, examDeckSizes, supports: supportsOf(routeResult), memories: routeResult.memories, scoreSummary: routeResult.scoreSummary,
      personalizedPlan: routePlan, upgrades: candidate.levelMode === 'upgraded' ? list(upgrade?.upgrades) : [],
      supportReselected: true, memoryPoolPreserved: true, status: stages.every(stage => stage.status === 'simulated') ? 'simulated' : 'partial',
      finalContribution, contributionMean: finalContribution.statistics?.mean ?? null,
      finalMean: final.status === 'simulated' ? final.statistics.mean : null });
  }
  const simulatedRoutes = routes.filter(route => finite(route.finalMean));
  const feasibleRoutes = simulatedRoutes.filter(route => !route.stages.some(stage => stage.passBounds?.status === 'model_bounds' && stage.passBounds.upper === 0));
  const selected = (feasibleRoutes.length ? feasibleRoutes : simulatedRoutes).sort((a, b) => (b.contributionMean ?? -Infinity) - (a.contributionMean ?? -Infinity)
    || b.finalMean - a.finalMean
    || (b.stages[0]?.statistics?.p10 ?? -Infinity) - (a.stages[0]?.statistics?.p10 ?? -Infinity) || a.id.localeCompare(b.id))[0];
  const baselineFinalMean = candidate.baselineStages[4]?.statistics?.mean ?? null, baselineContributionMean = candidate.baselineFinalContribution.statistics?.mean ?? null;
  return { ...plan, status: selected ? 'conditional_progression' : plan.status, routes, selectedRouteId: selected?.id ?? null,
    label: selected?.label ?? '미획득 기본 경로', events: selected?.events ?? [],
    comparison: { baselineFinalMean, conditionalFinalMean: selected?.finalMean ?? null,
      baselineContributionMean, conditionalContributionMean: selected?.contributionMean ?? null,
      worstObservedBranchContributionMean: selected && finite(baselineContributionMean) ? Math.min(baselineContributionMean, selected.contributionMean) : null,
      worstObservedBranchMean: selected && finite(baselineFinalMean) ? Math.min(baselineFinalMean, selected.finalMean) : null, expectedMean: null },
    recommendationCondition: selected ? `${selected.label} 조건을 모두 충족한 분기의 표본입니다. 미획득 분기의 점수와 실제 선택지·P포인트 조건도 함께 확인합니다.` :
      '현재 조건에 연결된 정상 획득 경로의 시험을 계산하지 못했습니다. 기본 덱 표본만으로 완성 편성으로 추천하지 않습니다.' };
}

function stageSafety(candidate) {
  const first = candidate.stages[0], statistics = first?.statistics, bounds = first?.passBounds;
  const infeasibleStages = candidate.stages.filter(stage => stage.examIndex < 3 && stage.passBounds?.status === 'model_bounds' && stage.passBounds.upper === 0).map(stage => stage.examIndex);
  const threshold = bounds?.conservativeThreshold;
  return { firstSelection: { status: bounds?.status === 'model_bounds' && bounds.upper === 0 ? 'model_infeasible' : bounds?.status === 'model_bounds' ? 'conditional_bounds' : 'unknown_pass_condition',
    mean: statistics?.mean ?? null, p10: statistics?.p10 ?? null, passBounds: bounds,
    margin: finite(threshold) && finite(statistics?.p10) ? statistics.p10 - threshold : null }, infeasibleStages,
    finalSafety: { status: 'unknown_combined_npc', roundBounds: candidate.stages.filter(stage => stage.examIndex >= 3).map(stage => ({ examIndex: stage.examIndex, bounds: stage.passBounds?.roundBounds ?? null })),
      reason: '본선 라운드별 라이벌 범위는 참고값이며, 동일 라이벌의 합산 점수와 비교하기 전에는 우승·탈락을 판정하지 않습니다.' },
    reason: infeasibleStages.length ? '이번 표본에서 알려진 통과 기준에 도달하지 못한 시험이 있어 준비 완료 추천에서 제외합니다.' :
      '알려진 통과 미달은 추천 제약으로 사용합니다. 동적 라이벌 점수·실제 통과 확률을 검증한 결과는 아닙니다.' };
}

function baselineRanking(candidates, requireFeasible) {
  return candidates.filter(candidate => finite(candidate.baselineFinalContribution?.statistics?.mean) &&
    (!requireFeasible || !candidate.baselineStages.some(stage => stage.passBounds?.status === 'model_bounds' && stage.passBounds.upper === 0)))
    .sort((a, b) => b.baselineFinalContribution.statistics.mean - a.baselineFinalContribution.statistics.mean
      || (b.baselineStages[0]?.statistics?.p10 ?? -Infinity) - (a.baselineStages[0]?.statistics?.p10 ?? -Infinity) || a.id.localeCompare(b.id));
}

function compatibleMemoryPool({ result, inventory, catalog, options }) {
  const build = memories => {
    const proposal = { ...result, memories };
    const personalizedPlan = buildPersonalizedPlan({ result: proposal, inventory, catalog, options });
    return buildBattleLoadout({ result: proposal, personalizedPlan, catalog, stage: { stage: 'selection', order: 2 }, includeAfterMid: true,
      supportItemAcquisitions: options.supportItemAcquisitions });
  };
  const preview = build(result.memories);
  if (preview.status === 'ready' || build([]).status !== 'ready') return null;
  const skills = new Map(list(catalog.skillCards).map(card => [`${card.gameId}:${card.upgradeCount ?? 0}`, card]));
  const memories = [];
  for (const original of list(inventory.memories)) {
    const effects = summarizeMemoryEffects(original, catalog, { scenario: 'hif', plan: result.scoreSummary.plan,
      producerLevel: options.producerLevel ?? inventory.producerLevel, skillCardSwitchSettings: options.skillCardSwitchSettings ?? inventory.skillCardSwitchSettings });
    if (effects.carriedSkill?.obtainable !== true || effects.carriedSkill.phase?.availableAtStart == null) continue;
    const row = { ...original, modelEffects: effects, skillCard: skills.get(`${effects.carriedSkill.id}:${effects.carriedSkill.upgrade}`) };
    if (build([row]).status === 'ready') memories.push(original);
  }
  return memories.length ? { memories, excludedCount: list(inventory.memories).length - memories.length,
    reason: '실행할 수 없는 메모리 효과를 생략하지 않고, 실제 보유한 다른 메모리 사본 중 시험 효과를 연결한 후보로 다시 추천했습니다.',
    originalIssues: list(preview.missingInputs) } : null;
}

function memoryVariantKey(effects) {
  const skill = effects.carriedSkill;
  return JSON.stringify([skill.id, skill.upgrade, skill.phase.code,
    list(skill.customizes).map(custom => [custom.id, custom.customizeCount]).sort(), effects.initialStats, effects.growthRatePermil,
    list(effects.hifEffects).filter(effect => effect.applies !== false).map(effect => effect.effectId).sort()]);
}

function memorySkillPriority(effects, trainingType) {
  const skill = effects.carriedSkill, actions = String(skill?.actions ?? '') + ';' + String(skill?.effects ?? '');
  return (skill?.phase?.availableAtStart === true ? 8 : 0) + (actions.match(/drawCard/g)?.length ?? 0) * 3
    + (actions.match(/cardUsesRemaining|actionCount|extraTurn/g)?.length ?? 0) * 4
    + (/fullPower|full_power/.test(trainingType ?? '') && /fullPowerCharge|cumulativeFullPowerCharge/.test(actions) ? 4 : 0)
    + (/genki|stamina|heal/i.test(actions) ? 2 : 0) + (skill?.upgrade ?? 0)
    + list(skill?.customizes).filter(custom => custom.exactCountKnown).length;
}

function samplePrefix(stage, runs) {
  const scores = list(stage?.sampleScores).slice(0, runs).map(row => row.score).filter(finite).sort((a, b) => a - b);
  if (!scores.length) return null;
  const position = (scores.length - 1) * 0.1, lower = Math.floor(position), upper = Math.ceil(position);
  return { runs: scores.length, mean: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    p10: scores[lower] + (scores[upper] - scores[lower]) * (position - lower) };
}

async function searchMemoryNeighbors({ baseCandidate, inventory, catalog, options, runs, limit }) {
  const started = Date.now(), summaries = new Map(), selectedIds = new Set(baseCandidate.memories.map(idOf));
  const currentSkill = baseCandidate.scoreSummary.trainingType;
  const summaryOptions = { scenario: 'hif', plan: baseCandidate.scoreSummary.plan,
    producerLevel: options.producerLevel ?? inventory.producerLevel, skillCardSwitchSettings: options.skillCardSwitchSettings ?? inventory.skillCardSwitchSettings };
  const variants = new Map();
  for (const memory of list(inventory.memories)) {
    const effects = summarizeMemoryEffects(memory, catalog, summaryOptions), skill = effects.carriedSkill;
    summaries.set(idOf(memory), effects);
    if (selectedIds.has(idOf(memory)) || skill?.obtainable !== true || skill.phase?.availableAtStart == null) continue;
    const key = memoryVariantKey(effects);
    if (!variants.has(key)) variants.set(key, { memory, effects, priority: memorySkillPriority(effects, currentSkill) });
  }
  const selectedVariants = new Set(baseCandidate.memories.map(memory => memoryVariantKey(memory.modelEffects)));
  const cheapPool = [...variants.entries()].filter(([key]) => !selectedVariants.has(key)).map(([, value]) => value)
    .sort((a, b) => b.priority - a.priority || String(idOf(a.memory)).localeCompare(String(idOf(b.memory)))).slice(0, 8);
  const originalOwned = new Map(list(inventory.memories).map(memory => [idOf(memory), memory]));
  const currentMemories = baseCandidate.memories.map(memory => originalOwned.get(idOf(memory))).filter(Boolean);
  const baseMissing = new Set(list(baseCandidate.scoreSummary.hifModel?.memoryRequirements?.missing));
  const checked = [], proposals = new Set(), neighbors = [];
  for (const incoming of cheapPool) {
    if (neighbors.length >= limit) break;
    const sameSkill = currentMemories.filter(memory => summaries.get(idOf(memory)).carriedSkill.id === incoming.effects.carriedSkill.id);
    const slots = currentMemories.length ? [...(sameSkill.length ? sameSkill : currentMemories)].sort((a, b) =>
      memorySkillPriority(summaries.get(idOf(a)), currentSkill) - memorySkillPriority(summaries.get(idOf(b)), currentSkill)) : [null];
    for (const removed of slots) {
      const subset = [...currentMemories.filter(memory => idOf(memory) !== idOf(removed)), incoming.memory].slice(0, 4);
      const signature = subset.map(idOf).sort().join('|');
      if (proposals.has(signature)) continue;
      const subsetTargets = new Set(subset.flatMap(memory => {
        const effects = summaries.get(idOf(memory));
        return [...(effects.carriedSkill?.obtainable === true ? ['skill:' + effects.carriedSkill.id] : []),
          ...list(effects.hifEffects).filter(effect => effect.applies === true).map(effect => 'hif:' + effect.effectId)];
      }));
      if (list(baseCandidate.scoreSummary.hifModel?.memoryRequirements?.requested).some(target => !baseMissing.has(target) && !subsetTargets.has(target))) continue;
      const subsetRows = subset.map(memory => ({ ...memory, modelEffects: summaries.get(idOf(memory)) }));
      const previewResult = { ...baseCandidate, memories: subsetRows };
      const previewPlan = buildPersonalizedPlan({ result: previewResult, inventory, catalog, options });
      const preview = buildBattleLoadout({ result: previewResult, personalizedPlan: previewPlan, catalog,
        stage: { stage: 'selection', order: 2 }, includeAfterMid: true, supportItemAcquisitions: options.supportItemAcquisitions });
      if (preview.status !== 'ready') { checked.push({ memoryId: idOf(incoming.memory), status: 'unsupported' }); break; }
      const candidateOptions = { ...options, supportLevelMode:baseCandidate.levelMode==='upgraded'?'uncapMax':'current', targetAttribute: baseCandidate.primaryAttribute,
        memorySelectionMode: baseCandidate.memorySelectionMode, memorySelectionModes: [baseCandidate.memorySelectionMode], compareSupportUpgrades: false };
      const proposal = recommend({ inventory: { ...inventory, memories: subset }, catalog, options: candidateOptions });
      if (!proposal.memories.some(memory => idOf(memory) === idOf(incoming.memory))) {
        checked.push({ memoryId: idOf(incoming.memory), status: 'not_selected_in_actual_subset' });
        continue;
      }
      const child = await comparePersonalized({ inventory: { ...inventory, memories: subset }, catalog, options: candidateOptions, runs, memorySearchLimit: 0 });
      const candidate = child.candidates[0];
      if (!candidate || !candidate.memories.some(memory => idOf(memory) === idOf(incoming.memory)) ||
          list(candidate.scoreSummary.hifModel?.memoryRequirements?.missing).some(target => !baseMissing.has(target))) {
        checked.push({ memoryId: idOf(incoming.memory), status: 'requirements_or_selection_changed' });
        continue;
      }
      proposals.add(signature);
      candidate.id = `${baseCandidate.id}-memory-${neighbors.length + 1}`;
      candidate.variantLabel = '실제 보유 메모리 교체';
      candidate.baseCandidateId = baseCandidate.id;
      candidate.memoryChanges = { removed: removed ? [{ memoryId: idOf(removed), name: baseCandidate.memories.find(memory => idOf(memory) === idOf(removed))?.name ?? null }] : [],
        added: [{ memoryId: idOf(incoming.memory), gameId: incoming.effects.carriedSkill.id,
          name: incoming.effects.carriedSkill.nameKo ?? incoming.effects.carriedSkill.nameJa, source: 'owned_inventory' }] };
      const firstBase = samplePrefix(baseCandidate.stages[0], runs), firstChanged = samplePrefix(candidate.stages[0], runs);
      const finalBase = samplePrefix(baseCandidate.finalContribution, runs), finalChanged = samplePrefix(candidate.finalContribution, runs);
      const earlyTradeoff = Boolean(firstBase && firstChanged && (firstChanged.mean < firstBase.mean || firstChanged.p10 < firstBase.p10));
      const improved = Boolean(finalBase && finalChanged && finalChanged.mean > finalBase.mean);
      candidate.eligibilityForRecommendation = candidate.eligibilityForRecommendation !== false && Boolean(firstBase && firstChanged && improved);
      candidate.memoryComparison = { baseRuns: runs, metric: 'documented_final_rounds_score_contribution', firstBase, firstChanged, finalBase, finalChanged, earlyTradeoff, finalMeanImproved: improved,
        reason: earlyTradeoff ? '초반 평균 또는 하위 10% 표본이 낮아지는 교환입니다. 이 하락 자체를 불합격으로 단정하지 않으며, 실제 첫 시험 통과 조건을 확인해야 합니다.' :
          candidate.eligibilityForRecommendation ? '같은 표본 수에서 본선 두 라운드의 합산 점수 기여 평균이 개선됐습니다.' :
            '알려진 통과 조건 또는 본선 합산 점수 기여 개선을 충족하지 못해 기본 추천 순위에서 제외했습니다.' };
      candidate.limitations.push('실제 보유 메모리의 제한된 이웃 교체 후보입니다. 모든 메모리 조합을 전수 탐색하지 않았습니다.');
      neighbors.push(candidate);
      checked.push({ memoryId: idOf(incoming.memory), status: 'simulated', candidateId: candidate.id });
      break;
    }
  }
  const searchSummary = { baseCandidateId: baseCandidate.id, ownedMemoryCount: list(inventory.memories).length,
    distinctLegalVariants: variants.size, cheapPoolSize: cheapPool.length, maxSimulatedNeighbors: limit, simulatedNeighbors: neighbors.length,
    checked, durationMs: Date.now() - started, exhaustive: false,
    method: 'owned_memory_one_slot_neighbors_then_seeded_battle_samples',
    limitation: '드로우·추가 행동·육성 유형·개시 시점으로 후보를 줄인 제한 탐색입니다. 최고 조합을 증명하지 않습니다.' };
  for (const candidate of neighbors) candidate.searchSummary = searchSummary;
  return { neighbors, searchSummary };
}

/** Sample explicit account-based HIF deck recipes, never claim a global optimum. */
export async function comparePersonalized({ inventory = {}, catalog, options = {}, runs = 8, memorySearchLimit = 4 }) {
  const started = Date.now(), request = normalizedOptions(options);
  if (request.scenario !== 'hif') throw new RangeError('현재 계정별 반복 시험 비교는 H.I.F.를 지원합니다.');
  if (!Number.isInteger(runs) || runs < 1) throw new RangeError('반복 횟수는 1 이상의 정수여야 합니다.');
  const effectiveRuns = Math.min(runs, 32);
  const requestedAxis = axes.includes(request.targetAttribute) ? request.targetAttribute : null;
  const primaries = requestedAxis ? [requestedAxis] : axes;
  const allowedModes = ['guide', 'opening', 'stats'];
  const memoryModes = Array.isArray(request.memorySelectionModes) ? unique(request.memorySelectionModes.filter(mode => allowedModes.includes(mode))) :
    allowedModes.includes(request.memorySelectionMode) ? [request.memorySelectionMode] : allowedModes;
  if (!memoryModes.length) memoryModes.push('guide');
  const candidates = [], limitations = [], cache = new Map();
  const candidateSignatures = new Map();
  const stageCatalog = list(catalog.hifExamProfiles?.profiles);
  for (const primary of primaries) {
    if (primary === request.secondaryAttribute) {
      limitations.push(`${primary}는 사용자가 고른 부속성과 같아 주속성 비교에서 제외했습니다.`);
      continue;
    }
    for (const memorySelectionMode of memoryModes) {
    const candidateOptions = { ...request, supportLevelMode:'current', targetAttribute: primary, memorySelectionMode, compareSupportUpgrades: request.compareSupportUpgrades === true };
    let recommendation = recommend({ inventory, catalog, options: candidateOptions });
    const memoryFallback = compatibleMemoryPool({ result: recommendation, inventory, catalog, options: candidateOptions });
    if (memoryFallback) recommendation = recommend({ inventory: { ...inventory, memories: memoryFallback.memories }, catalog, options: candidateOptions });
    const variants = [{ levelMode: 'current', result: recommendation, upgrades: [] }];
    const upgraded = recommendation.supportUpgradeComparison;
    if (request.compareSupportUpgrades === true && upgraded?.available) variants.push({ levelMode: 'upgraded', upgrades: list(upgraded.upgrades),
      result: { ...recommendation, supports: upgraded.supports, memories: upgraded.memories, scoreSummary: upgraded.scoreSummary,
        warnings: upgraded.warnings, assumptions: upgraded.assumptions, supportUpgradeComparison: null } });
    for (const variant of variants) {
      const result = { ...variant.result, memories: artworkForMemories(variant.result.memories, inventory) };
      const signature = JSON.stringify([primary, variant.levelMode, idOf(result.selectedIdol), result.scoreSummary.hifModel?.secondaryAttribute,
        result.scoreSummary.hifModel?.deckTemplate, supportsOf(result).map(card => [idOf(card), card.level, card.isRental === true]).sort(), result.memories.map(idOf).sort()]);
      if (candidateSignatures.has(signature)) {
        candidateSignatures.get(signature).seedModes.push(memorySelectionMode);
        continue;
      }
      const personalizedPlan = buildPersonalizedPlan({ result, inventory, catalog, options: candidateOptions });
      const modeLabel = { guide: '공략 역할 기준', opening: '개시 운용 고려', stats: '능력치 중심' }[memorySelectionMode];
      const candidate = { id: `${primary}${memorySelectionMode === memoryModes[0] ? '' : '-' + memorySelectionMode}-${variant.levelMode}`, levelMode: variant.levelMode,
        memorySelectionMode, seedModes: [memorySelectionMode], variantLabel: modeLabel,
        primaryAttribute: result.scoreSummary.hifModel?.primaryAttribute ?? primary,
        secondaryAttribute: result.scoreSummary.hifModel?.secondaryAttribute ?? null,
        selectedIdol: result.selectedIdol, supports: supportsOf(result), memories: result.memories,
        rentalCandidates: list(result.supports?.rentalCandidates),
        scoreSummary: result.scoreSummary, personalizedPlan, upgrades: variant.upgrades,
        stages: [], acquisitionComparisons: [], limitations: [], memoryFallback: memoryFallback ? {
          excludedCount: memoryFallback.excludedCount, eligibleMemoryCount: memoryFallback.memories.length,
          reason: memoryFallback.reason, originalIssues: memoryFallback.originalIssues } : null,
        rankingScore: null, rankingBasis: 'conditional_sample_mean_not_global_optimum' };
      const stamina = projectHifStamina(result);
      const exams = list(stageCatalog.find(profile => profile.idolCardId === idOf(result.selectedIdol))?.examStages);
      for (let examIndex = 0; examIndex < 5; examIndex++) {
        const stageType = examIndex < 3 ? 'selection' : 'final', order = examIndex < 3 ? examIndex + 1 : examIndex - 2;
        const exam = exams.find(row => row.stage === stageType && row.order === order);
        const projection = projectHifStageStats({ result, inventory, catalog, examIndex, options: candidateOptions });
        const stageOutput = { examIndex, label: labels[examIndex], stage: stageType, order, status: 'unsupported', projection,
          deck: null, mappedCards: [], mappedItems: [], statistics: null, sampleScores: [], representativeTrace: null, bestTrace: null,
          passBounds: unknownPass('시험 표본을 계산하지 못해 통과율을 표시하지 않습니다.'), limitations: [] };
        if (!exam || !projection) {
          stageOutput.limitations.push(!exam ? '이 P아이돌의 시험 원자료를 연결하지 못했습니다.' : '해당 시험 직전까지의 능력치 경로를 계산하지 못했습니다.');
          candidate.stages.push(stageOutput);
          continue;
        }
        const battleStage = buildHifBattleStage({ exam, catalog, stats: projection.stats });
        const built = buildBattleLoadout({ result, personalizedPlan, catalog, stage: { stage: stageType, order }, includeAfterMid: examIndex >= 1,
          assumedCardIds: [], supportItemAcquisitions: candidateOptions.supportItemAcquisitions });
        stageOutput.mappedCards = list(built.mappedCards);
        stageOutput.mappedItems = list(built.mappedItems);
        stageOutput.automaticRemovals = built.automaticRemovals;
        stageOutput.deckState = { origin: 'no_additional_acquisition', actualSessionCaptured: false,
          cardCount: stageOutput.mappedCards.length, automaticRemovals: built.automaticRemovals };
        stageOutput.suggestedSets = list(built.suggestedSets);
        stageOutput.limitations = unique([...list(projection.assumptions), ...list(stamina.limitations), ...list(built.limitations), ...list(built.missingInputs),
          ...list(battleStage.stage?.limitations), battleStage.status !== 'ready' ? battleStage.reason : null]);
        if (built.status !== 'ready' || !built.loadout || battleStage.status !== 'ready' || !finite(stamina.value) || stamina.value <= 0) {
          if (!finite(stamina.value)) stageOutput.limitations.push('현재 보유 상태에서 최대 체력의 확인된 구성값을 계산하지 못했습니다.');
          candidate.stages.push(stageOutput);
          continue;
        }
        const loadout = { ...built.loadout, params: [...axes.map(axis => projection.stats[axis]), stamina.value] };
        const seed = (610397104 + examIndex * 1000) >>> 0;
        const simulationInput = { loadout, stage: battleStage.stage, runs: effectiveRuns, seed, threshold: null };
        const cacheKey = JSON.stringify(simulationInput);
        if (!cache.has(cacheKey)) cache.set(cacheKey, await simulateBattle(simulationInput));
        const simulation = cache.get(cacheKey);
        stageOutput.status = simulation.status;
        stageOutput.deck = loadout;
        stageOutput.coefficients = battleStage.coefficients;
        stageOutput.coefficientMethod = battleStage.coefficientMethod;
        stageOutput.statistics = simulation.statistics;
        stageOutput.sampleScores = list(simulation.sampleScores);
        stageOutput.representativeTrace = traceArtwork(simulation.representativeTrace, catalog);
        stageOutput.bestTrace = traceArtwork(simulation.bestTrace, catalog);
        stageOutput.limitations = unique([...stageOutput.limitations, ...list(simulation.limitations), ...list(simulation.reasons)]);
        if (simulation.status === 'simulated' && stageOutput.sampleScores.length) stageOutput.passBounds = stagePassBounds(exam, catalog, stageOutput.sampleScores);
        candidate.stages.push(stageOutput);
      }
      candidate.baselineStages = candidate.stages;
      candidate.baselineFinalContribution = summarizeFinalContribution(candidate.baselineStages);
      candidate.progression = await runProgressionRoutes({ result, personalizedPlan, candidate, inventory, catalog,
        options: candidateOptions, runs: effectiveRuns, exams, cache });
      const progressionRoute = candidate.progression.routes.find(route => route.id === candidate.progression.selectedRouteId);
      if (progressionRoute) {
        candidate.baselineSelection = { supports: candidate.supports, memories: candidate.memories, scoreSummary: candidate.scoreSummary };
        candidate.stages = progressionRoute.stages; candidate.supports = progressionRoute.supports;
        candidate.memories = progressionRoute.memories; candidate.scoreSummary = progressionRoute.scoreSummary;
        candidate.personalizedPlan = progressionRoute.personalizedPlan; candidate.upgrades = progressionRoute.upgrades;
      }
      const final = candidate.stages.find(stage => stage.examIndex === 4);
      if (final?.status === 'simulated' && !candidate.progression.selectedRouteId) {
        const finalExam = exams.find(row => row.stage === 'final' && row.order === 2);
        const battleStage = buildHifBattleStage({ exam: finalExam, catalog, stats: final.projection.stats });
        for (const set of list(final.suggestedSets).slice(0, 2)) {
          const built = buildBattleLoadout({ result, personalizedPlan, catalog, stage: { stage: 'final', order: 2 }, includeAfterMid: true,
            assumedCardIds: set.gameIds, supportItemAcquisitions: candidateOptions.supportItemAcquisitions });
          const comparison = { id: set.id, assumedCardIds: set.gameIds, source: 'declared_acquisition_assumption', rankingExcluded: true,
            conditions: list(set.gameIds).map(id => personalizedPlan.cardAccess.find(card => card.gameId === id)).filter(Boolean),
            status: built.status, statistics: null, meanDelta: null, mappedCards: list(built.mappedCards),
            representativeTrace: null, medianTrace: null, bestTrace: null, passBounds: unknownPass('확보 가정의 시험 표본을 계산하지 못했습니다.'),
            limitations: unique([...list(set.assumptions), ...list(built.limitations), ...list(built.missingInputs),
              '도중에 이 카드를 확보했다는 별도 가정입니다. 현재 반입 덱이나 보유 메모리 사본으로 세지 않습니다.']) };
          if (built.status === 'ready' && built.loadout && battleStage.status === 'ready') {
            const loadout = { ...built.loadout, params: [...axes.map(axis => final.projection.stats[axis]), stamina.value] };
            const simulationInput = { loadout, stage: battleStage.stage, runs: effectiveRuns, seed: (610397104 + 4000) >>> 0, threshold: null };
            const cacheKey = JSON.stringify(simulationInput);
            if (!cache.has(cacheKey)) cache.set(cacheKey, await simulateBattle(simulationInput));
            const simulation = cache.get(cacheKey);
            comparison.status = simulation.status;
            comparison.statistics = simulation.statistics;
            comparison.meanDelta = finite(simulation.statistics?.mean) ? simulation.statistics.mean - final.statistics.mean : null;
            comparison.representativeTrace = traceArtwork(simulation.representativeTrace, catalog);
            comparison.medianTrace = comparison.representativeTrace;
            comparison.bestTrace = traceArtwork(simulation.bestTrace, catalog);
            comparison.limitations = unique([...comparison.limitations, ...list(simulation.limitations), ...list(simulation.reasons)]);
            if (simulation.status === 'simulated') comparison.passBounds = stagePassBounds(finalExam, catalog, list(simulation.sampleScores));
          }
          candidate.acquisitionComparisons.push(comparison);
        }
      }
      candidate.finalContribution = summarizeFinalContribution(candidate.stages);
      candidate.rankingScore = candidate.finalContribution.statistics?.mean ?? null;
      candidate.rankingBasis = 'known_pass_constraints_then_documented_final_rounds_contribution';
      candidate.safety = stageSafety(candidate);
      candidate.finalSafety = candidate.safety.finalSafety;
      candidate.eligibilityForRecommendation = candidate.safety.infeasibleStages.length === 0 && candidate.stages.every(stage => stage.status === 'simulated');
      candidate.status = candidate.stages.every(stage => stage.status === 'simulated') ? 'simulated' : candidate.stages.some(stage => stage.status === 'simulated') ? 'partial' : 'unsupported';
      candidate.personalizedPlan.scope.battleSimulationRun = candidate.stages.some(stage => stage.status === 'simulated');
      if (candidate.personalizedPlan.scope.battleSimulationRun) {
        candidate.personalizedPlan.simulationInputs.scoreStatistics = candidate.stages.map(stage => ({ examIndex: stage.examIndex, status: stage.status, statistics: stage.statistics }));
        candidate.personalizedPlan.simulationInputs.note = '시험별로 실행 가능한 카드와 가정 덱을 반복 계산했습니다. 아래 통계는 현재 계정의 실제 시험 기록이 아닌 조건부 표본입니다.';
      }
      candidate.limitations = unique(['새 육성의 경로·획득 카드와 시험 시작 상태를 조건으로 둔 모형 비교입니다.',
        '도중 확보 후보를 자동으로 모두 얻었다고 처리하지 않았습니다.',
        '선발 통과 여부와 경로 완주를 증명한 결과가 아닙니다.', ...list(result.warnings)]);
      candidate.readiness = { status: 'not_proven', readinessConfirmed: false,
        reason: '전체 선발 통과와 본선 합산 우승·실제 최종 육성 평가점을 검증하지 않았습니다. 이번 추천은 확보·강화 조건을 둔 모형 비교이며, 스타성·친애도·드링크 등 미반영 요소가 있습니다.',
        missingCombinations: personalizedPlan.missingCombinations };
      candidates.push(candidate);
      candidateSignatures.set(signature, candidate);
    }
    }
  }
  const previewRanked = mode => candidates.filter(candidate => (!mode || candidate.levelMode === mode) && finite(candidate.rankingScore))
    .sort((a, b) => b.rankingScore - a.rankingScore
      || (b.safety?.firstSelection?.p10 ?? -Infinity) - (a.safety?.firstSelection?.p10 ?? -Infinity) || a.id.localeCompare(b.id));
  const ranked = mode => previewRanked(mode).filter(candidate => candidate.eligibilityForRecommendation !== false);
  let searchSummary = null;
  const memoryBase = ranked('current')[0] ?? previewRanked('current')[0];
  if (memoryBase && memorySearchLimit > 0 && list(inventory.memories).length > memoryBase.memories.length) {
    const search = await searchMemoryNeighbors({ baseCandidate: memoryBase, inventory, catalog, options: request,
      runs: effectiveRuns, limit: Math.min(memorySearchLimit, 4) });
    candidates.push(...search.neighbors);
    searchSummary = search.searchSummary;
  }
  return { status: candidates.some(candidate => candidate.status !== 'unsupported') ? 'conditional_comparison' : 'unsupported',
    request: { options: request, memorySelectionModes: memoryModes, capturedAt: inventory.capturedAt ?? null, runs: effectiveRuns, requestedRuns: runs },
    durationMs: Date.now() - started, candidates, searchSummary, recommendedCandidateId: ranked()[0]?.id ?? null,
    recommendedCurrentCandidateId: ranked('current')[0]?.id ?? null, recommendedUpgradedCandidateId: ranked('upgraded')[0]?.id ?? null,
    recommendedBaselineCandidateId: baselineRanking(candidates, true)[0]?.id ?? null,
    bestPreviewCandidateId: previewRanked()[0]?.id ?? null, bestCurrentPreviewCandidateId: previewRanked('current')[0]?.id ?? null,
    bestBaselinePreviewCandidateId: baselineRanking(candidates, false)[0]?.id ?? null,
    rankingBasis: 'known_pass_constraints_then_documented_final_rounds_contribution',
    modelValidation: { gameScoreCalibrated: false, idolOperatingPolicyValidated: false,
      recommendationUse: 'diagnostic_only',
      reason: '실제 HIF 완성 덱·점수와 같은 조건에서 재현 검증되지 않았습니다. 이 모형 순위와 최고점으로 실전 우열을 확정하지 않습니다.' },
    rankingObjective: { metric: 'documented_final_rounds_score_contribution', formula: 'floor(round1Score * 1.2) + round2Score', evaluationScoreImplemented: false, allStagePassVerified: false,
      acquisitionProbabilityKnown: false, basis: 'conditional_model_samples_not_actual_produce_evaluation' },
    seedSearch: { requestedModes: memoryModes, uniqueSeedCandidates: candidateSignatures.size,
      method: 'guide_opening_and_stat_seeds_then_conditional_battle_samples', exhaustive: false },
    rankingExplanation: '알려진 선발 통과 기준에 미달한 경로를 제외하고, 본선 1 점수의 1.2배(소수 버림)와 본선 2 점수를 더한 조건부 기여 평균을 비교합니다. 첫 시험 평균의 작은 차이만으로 후반 이득을 버리지 않습니다. 최종 육성 평가점 전체·본선 합산 라이벌·전체 선발 통과는 검증하지 않았고 미획득 분기도 별도로 표시합니다.',
    limitations: unique([...limitations, '평균·저점·관측 최고점은 명시한 덱과 모형 조건의 표본 통계입니다.',
      '선발 1·2 뒤 기본 카드 2장씩 자동 삭제를 반영하되, 실제 대상이 미수집되어 모든 후보에 같은 삭제 목록 하나를 가정했습니다. 다른 삭제 결과까지 검증한 순위는 아닙니다.',
      '본선 2의 HIF 응원봉으로 22장까지 기본 카드를 생성합니다. 생성 종류·위치의 공개 엔진 분포는 게임과 일치한다고 검증하지 않았습니다.',
      '스타성·친애도에 따른 추가 점수 배율과 계정 영구 P스킬·드링크를 모두 반영한 실제 점수 예측이 아닙니다.',
      '시험 시작 체력은 매번 계산된 최대 체력으로 둔 모형입니다. 특히 본선 1에서 소모한 체력이 본선 2에 이어지는 실제 상태와 인더벌 회복은 재현하지 않았습니다.',
      '능력치별 시험 계수 보간과 턴 배분은 공개 자료를 이용한 가정이며 실제 게임과 일치한다고 검증되지 않았습니다.',
      '동적 라이벌 점수는 재현하지 않으며 고정 라이벌도 최소·최대 점수에 따른 통과율 범위만 표시합니다.',
      runs > effectiveRuns ? `실행 시간을 제한하기 위해 반복 횟수를 ${effectiveRuns}회로 제한했습니다.` : null]) };
}
