import { simulateBattle } from './battle-simulation.mjs';
import { buildHifBattleStage, npcPassBounds } from './hif-battle-stage.mjs';
import { summarizeFinalContribution } from './personalized-comparison.mjs';

const list = value => Array.isArray(value) ? value : [];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const score = candidate => candidate.finalContribution?.statistics?.mean ?? candidate.rankingScore ?? -Infinity;
const lesser = (first, second) => finite(first) && finite(second) ? Math.min(first, second) : null;

export function pairedImprovement(changed, baseline) {
  const key = row => Number.isInteger(row?.round1Seed) && Number.isInteger(row?.round2Seed) ? `rounds:${row.round1Seed}:${row.round2Seed}` :
    Number.isInteger(row?.seed) ? `seed:${row.seed}` : null;
  const uniqueSamples = rows => {
    const samples = new Map(), duplicates = new Set();
    for (const row of list(rows)) {
      const id = key(row);
      if (id === null || !finite(row.score)) continue;
      if (samples.has(id)) duplicates.add(id);
      else samples.set(id, row);
    }
    for (const id of duplicates) samples.delete(id);
    return samples;
  };
  const changedSamples = uniqueSamples(changed), baselineSamples = uniqueSamples(baseline);
  const differences = [...changedSamples].flatMap(([id, row]) => baselineSamples.has(id) ? [row.score - baselineSamples.get(id).score] : []);
  if (!differences.length) return null;
  const mean = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const variance = differences.length > 1 ? differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (differences.length - 1) : null;
  const radius = variance == null ? null : 1.96 * Math.sqrt(variance / differences.length);
  return { runs: differences.length, meanDelta: mean, pairedPositiveRate: differences.filter(value => value > 0).length / differences.length,
    standardErrorOfDelta: variance == null ? null : Math.sqrt(variance / differences.length),
    unmatchedChanged: list(changed).length - differences.length, unmatchedBaseline: list(baseline).length - differences.length,
    approximate95Interval: radius == null ? null : { lower: mean - radius, upper: mean + radius },
    pairingMethod: 'exact_seed_or_round_seed_pair',
    basis: 'paired_model_seeds_normal_approximation_not_game_validation',
    limitation: '같은 난수 조건에서 나온 모형 차이의 몬테카를로 오차 근사입니다. 실제 게임 효과·획득 성공률의 신뢰구간이 아닙니다.' };
}

function examOf(candidate, index, catalog) {
  const id = candidate.selectedIdol?.gameId ?? candidate.selectedIdol?.id;
  return list(catalog.hifExamProfiles?.profiles).find(profile => profile.idolCardId === id)?.examStages?.find(exam =>
    exam.stage === (index < 3 ? 'selection' : 'final') && exam.order === (index < 3 ? index + 1 : index - 2));
}
function artwork(trace, catalog) {
  if (!trace) return null;
  const byId = new Map(list(catalog.skillCards).map(card => [String(card.internalId), card]));
  const decorate = card => card ? { ...card, gameId: byId.get(String(card.id))?.gameId ?? null,
    nameKo: byId.get(String(card.id))?.nameKo ?? null, nameJa: byId.get(String(card.id))?.nameJa ?? card.name,
    imageUrl: byId.get(String(card.id))?.thumbnailUrl ?? byId.get(String(card.id))?.imageUrl ?? null } : null;
  return { ...trace, generatedAtStart: list(trace.generatedAtStart).map(decorate), turns: list(trace.turns).map(turn => ({ ...turn,
    playedCards: list(turn.playedCards).map(decorate), drawnCards: list(turn.drawnCards).map(decorate), heldCards: list(turn.heldCards).map(decorate),
    decisions: list(turn.decisions).map(decision => ({ ...decision, hand: list(decision.hand).map(decorate), selectedCard: decorate(decision.selectedCard) })) })) };
}

/** Refine a short list with the same seeds; keep the coarse search visible. */
export async function refinePersonalizedCandidates({ comparison, catalog, runs = 128, maxCurrent = 2 } = {}) {
  if (!Number.isInteger(runs) || runs < 4 || runs > 1000) throw new RangeError('상위 후보 재검증은 4~1,000회입니다.');
  if (!Number.isInteger(maxCurrent) || maxCurrent < 1 || maxCurrent > 2) throw new RangeError('현재 편성 재검증 후보 수는 1~2개입니다.');
  comparison = structuredClone(comparison ?? {});
  const started = Date.now(), cache = new Map();
  const ranked = list(comparison.candidates).filter(candidate => finite(score(candidate))).sort((a, b) =>
    Number(a.eligibilityForRecommendation === false) - Number(b.eligibilityForRecommendation === false) || score(b) - score(a) || a.id.localeCompare(b.id));
  const selected = [...ranked.filter(candidate => candidate.levelMode === 'current').slice(0, maxCurrent),
    ...ranked.filter(candidate => candidate.levelMode === 'upgraded').slice(0, 1)];
  const selectedIds = new Set(selected.map(candidate => candidate.id));
  for (const candidate of selected) {
    const checkpoints = [];
    candidate.coarseComparison = { rankingScore: candidate.rankingScore, finalContribution: candidate.finalContribution,
      runs: list(candidate.stages)[0]?.statistics?.runs ?? null };
    for (const [branch, stages] of [['conditional', candidate.stages], ['baseline', candidate.baselineStages]]) for (const index of [0, 3, 4]) {
      const output = list(stages).find(stage => stage.examIndex === index);
      const checkpoint = { branch, examIndex: index, status: 'skipped', runs: 0 };
      checkpoints.push(checkpoint);
      if (!output?.deck || output.status !== 'simulated') { checkpoint.reason = '정상 실행한 전체 시험 덱이 없습니다.'; continue; }
      const exam = examOf(candidate, index, catalog);
      const built = output.simulationInput?.stage ? { status: 'ready', stage: output.simulationInput.stage } :
        output.projection?.stats ? buildHifBattleStage({ exam, catalog, stats: output.projection.stats }) : { status: 'unsupported', reason: '재검증용 시험 입력 또는 능력치가 없습니다.' };
      if (built.status !== 'ready') { checkpoint.reason = built.reason; continue; }
      const input = { loadout: output.deck, stage: built.stage, runs, seed: (610397104 + index * 1000) >>> 0, threshold: null };
      const key = JSON.stringify(input);
      if (!cache.has(key)) cache.set(key, await simulateBattle(input));
      const simulation = cache.get(key);
      if (simulation.status !== 'simulated') { checkpoint.status = simulation.status; checkpoint.reason = simulation.reason; continue; }
      checkpoint.status = 'simulated'; checkpoint.runs = runs; checkpoint.seed = input.seed;
      output.coarseStatistics ??= output.statistics;
      output.statistics = simulation.statistics; output.sampleScores = simulation.sampleScores;
      output.representativeTrace = artwork(simulation.representativeTrace, catalog); output.bestTrace = artwork(simulation.bestTrace, catalog);
      const bounds = npcPassBounds(exam, catalog, list(simulation.sampleScores));
      output.passBounds = index >= 3 ? { status: 'unknown_combined_npc', lower: null, upper: null, roundBounds: bounds,
        reason: '본선은 두 라운드의 합산 라이벌 점수를 확인하기 전에는 한 라운드만으로 우승·탈락을 판정하지 않습니다.' } : bounds;
      output.refined = true;
    }
    candidate.finalContribution = summarizeFinalContribution(list(candidate.stages));
    candidate.baselineFinalContribution = summarizeFinalContribution(list(candidate.baselineStages));
    candidate.rankingScore = candidate.finalContribution.statistics?.mean ?? candidate.rankingScore;
    const complete = checkpoints.length === 6 && checkpoints.every(checkpoint => checkpoint.status === 'simulated');
    const evidence = complete ? pairedImprovement(candidate.finalContribution.sampleScores, candidate.baselineFinalContribution.sampleScores) : null;
    candidate.refinement = { status: complete ? 'refined' : 'partial', runs, checkpoints: [0, 3, 4], checkpointResults: checkpoints,
      pairedAcquisitionImprovement: evidence,
      limitations: ['후보 선정과 재검증 표본이 겹칩니다. 보류한 독립 검증 표본이 아니므로 후보 선택 편향이 남습니다.',
        '스타성·친애도·드링크·실제 획득률을 모르는 부분은 반복 횟수를 늘려도 검증되지 않습니다.',
        '선발 2·3은 빠른 탐색의 표본을 유지합니다. 첫 선발과 본선 두 시험만 더 많이 반복했습니다.'] };
    const first = list(candidate.stages).find(stage => stage.examIndex === 0), bounds = first?.passBounds;
    const infeasibleStages = list(candidate.stages).filter(stage => stage.examIndex < 3 && stage.passBounds?.status === 'model_bounds' && stage.passBounds.upper === 0).map(stage => stage.examIndex);
    const firstSelection = { status: bounds?.status === 'model_bounds' && bounds.upper === 0 ? 'model_infeasible' : bounds?.status === 'model_bounds' ? 'conditional_bounds' : 'unknown_pass_condition',
      mean: first?.statistics?.mean ?? null, p10: first?.statistics?.p10 ?? null, passBounds: bounds,
      margin: finite(bounds?.conservativeThreshold) && finite(first?.statistics?.p10) ? first.statistics.p10 - bounds.conservativeThreshold : null };
    const finalSafety = { status: 'unknown_combined_npc', roundBounds: list(candidate.stages).filter(stage => stage.examIndex >= 3).map(stage => ({ examIndex: stage.examIndex, bounds: stage.passBounds?.roundBounds ?? null })),
      reason: '본선 두 라운드의 같은 라이벌 합산 점수 대응을 확인하기 전에는 우승·탈락을 확정하지 않습니다.' };
    candidate.safety = { ...candidate.safety, firstSelection, infeasibleStages, finalSafety,
      reason: infeasibleStages.length ? '재검증 표본에서 알려진 선발 통과 기준에 미달한 시험이 있어 추천에서 제외합니다.' : candidate.safety?.reason };
    candidate.finalSafety = finalSafety;
    candidate.eligibilityForRecommendation = candidate.eligibilityForRecommendation !== false && complete && infeasibleStages.length === 0 && list(candidate.stages).every(stage => stage.status === 'simulated');
    if (candidate.progression?.comparison) Object.assign(candidate.progression.comparison, {
      baselineFinalMean: candidate.baselineStages?.find(stage => stage.examIndex === 4)?.statistics?.mean ?? null,
      conditionalFinalMean: candidate.stages?.find(stage => stage.examIndex === 4)?.statistics?.mean ?? null,
      baselineContributionMean: candidate.baselineFinalContribution.statistics?.mean ?? null,
      conditionalContributionMean: candidate.finalContribution.statistics?.mean ?? null,
      worstObservedBranchMean: lesser(candidate.baselineStages?.find(stage => stage.examIndex === 4)?.statistics?.mean,
        candidate.stages?.find(stage => stage.examIndex === 4)?.statistics?.mean),
      worstObservedBranchContributionMean: lesser(candidate.baselineFinalContribution.statistics?.mean,candidate.finalContribution.statistics?.mean),
    });
    const selectedRoute = list(candidate.progression?.routes).find(route => route.id === candidate.progression?.selectedRouteId);
    if (selectedRoute) Object.assign(selectedRoute, { stages: candidate.stages, finalContribution: candidate.finalContribution,
      contributionMean: candidate.finalContribution.statistics?.mean ?? null,
      finalMean: list(candidate.stages).find(stage => stage.examIndex === 4)?.statistics?.mean ?? null, refinement: candidate.refinement });
  }
  const reranked = ranked.filter(candidate => selectedIds.has(candidate.id) && candidate.refinement.status === 'refined').sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  // Different sample sizes must not compete as if they had equal precision.
  const best = (mode, eligible) => reranked.find(candidate => (!mode || candidate.levelMode === mode) &&
    (!eligible || candidate.eligibilityForRecommendation !== false))?.id ?? null;
  if (reranked.length) Object.assign(comparison, {
    recommendedCandidateId: best(null, true), recommendedCurrentCandidateId: best('current', true), recommendedUpgradedCandidateId: best('upgraded', true),
    bestPreviewCandidateId: best(null, false), bestCurrentPreviewCandidateId: best('current', false), bestUpgradedPreviewCandidateId: best('upgraded', false),
  });
  else if (selected.length) Object.assign(comparison, { recommendedCandidateId: null, recommendedCurrentCandidateId: null,
    recommendedUpgradedCandidateId: null, recommendedBaselineCandidateId: null });
  const baselineRanked = [...reranked].filter(candidate => finite(candidate.baselineFinalContribution?.statistics?.mean))
    .sort((a, b) => b.baselineFinalContribution.statistics.mean - a.baselineFinalContribution.statistics.mean || a.id.localeCompare(b.id));
  if (reranked.length) Object.assign(comparison, {
    recommendedBaselineCandidateId: baselineRanked.find(candidate => list(candidate.baselineStages).every(stage => stage.status === 'simulated') &&
      !list(candidate.baselineStages).some(stage => stage.examIndex < 3 && stage.passBounds?.status === 'model_bounds' && stage.passBounds.upper === 0))?.id ?? null,
    bestBaselinePreviewCandidateId: baselineRanked[0]?.id ?? null,
  });
  comparison.refinement = { status: reranked.length ? 'refined_shortlist' : 'no_supported_shortlist', runs,
    candidateIds: reranked.map(candidate => candidate.id), durationMs: Date.now() - started,
    attemptedCandidateIds: selected.map(candidate => candidate.id), rerankingApplied: reranked.length > 0,
    exhaustive: false, gameEfficacyVerified: false,
    limitation: '공략·빠른 탐색에서 추린 일부 후보의 모형 비교입니다. 실제 평가점 우위나 게임 승률을 증명한 결과는 아닙니다.' };
  return comparison;
}
