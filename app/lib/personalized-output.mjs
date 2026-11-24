const list = value => Array.isArray(value) ? value : [];
const pick = (row, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(row ?? {}, key)).map(key => [key, row[key]]));
const supportKeys = ['id', 'gameId', 'internalId', 'name', 'nameKo', 'nameJa', 'rarity', 'plan', 'attribute', 'characterIds',
  'imageUrl', 'thumbnailUrl', 'level', 'uncap', 'levelCap', 'maxLevels', 'isRental', 'rental', 'availabilityVerified',
  'score', 'utilityScore', 'fixedStats', 'fixedStatsByStage', 'growthRatePermil', 'statContribution', 'resources',
  'p_item', 'supportItemValue', 'unscored', 'unscoredEffects', 'sourceConflict', 'numericalSource', 'reasons',
  'candidateModeledStatTotal', 'requiresReoptimization'];

function compactSupport(row) { return pick(row, supportKeys); }
function compactMemory(row) {
  const { raw, abilities, catalog, ...rest } = row;
  // Browser details read effects; keep the model's identity/phase summary without
  // serializing its full conditional-effect source tree a second time.
  if (rest.effects && rest.modelEffects) rest.modelEffects = { ...pick(rest.modelEffects,
    ['status', 'initialStats', 'growthRatePermil', 'issues', 'calculationScope']),
    carriedSkill: pick(rest.modelEffects.carriedSkill, ['id', 'upgrade', 'name', 'nameJa', 'plan', 'phase', 'obtainable', 'customizes']), detailsLocation: 'effects' };
  return rest;
}
function cardRef(row) {
  const { effects, raw, abilities, catalog, ...rest } = row;
  return rest;
}
function compactPlan(plan) {
  if (!plan) return plan;
  if (plan.openingPlan) plan.openingPlan.cards = list(plan.openingPlan.cards).map(cardRef);
  if (plan.midgamePlan) plan.midgamePlan.cards = list(plan.midgamePlan.cards).map(cardRef);
  if (plan.simulationInputs) for (const recipe of list(plan.simulationInputs.stageRecipes)) {
    recipe.confirmedCards = list(recipe.confirmedCards).map(cardRef);
    recipe.assumedCards = list(recipe.assumedCards).map(cardRef);
  }
  return plan;
}
function compactTrace(trace, detailed) {
  if (!trace) return trace;
  const compactCard = row => {
    if (!row) return row;
    const copy = { ...row };
    if (copy.name === copy.nameJa || copy.name === copy.nameKo) delete copy.name;
    return copy;
  };
  return { ...trace, ...(detailed ? {} : { detailLevel: 'played_and_held_cards' }),
    generatedAtStart: list(trace.generatedAtStart).map(compactCard), turns: list(trace.turns).map(turn => {
      const { decisions, drawnCards, ...rest } = turn;
      return { ...rest, playedCards: list(turn.playedCards).map(compactCard), heldCards: list(turn.heldCards).map(compactCard),
        ...(detailed ? { drawnCards: list(drawnCards).map(compactCard), decisions: list(decisions).map(decision => ({ ...decision,
          hand: list(decision.hand).map(compactCard), selectedCard: compactCard(decision.selectedCard) })) } : {}) };
    }) };
}
function compactStages(stages, detailed) {
  return list(stages).map(stage => {
    const output = { ...stage, representativeTrace: compactTrace(stage.representativeTrace, detailed) };
    if (!detailed) { output.bestTrace = null; output.traceDetail = 'representative_played_and_held_cards'; }
    if (output.deckState) {
      const { automaticRemovals, appliedEdits, cumulativeAcquisitions, ...state } = output.deckState;
      const eventRef = event => pick(event, ['id', 'gameId', 'action', 'fromExamIndex']);
      output.deckState = { ...state, automaticRemovalPatternId: automaticRemovals?.patternId,
        appliedEdits: list(appliedEdits).map(eventRef), cumulativeAcquisitions: list(cumulativeAcquisitions).map(eventRef) };
    }
    if (output.projection?.route) {
      const route = output.projection.route;
      output.projection = { ...output.projection, route: { ...pick(route, ['counts', 'produceActions', 'explicitActionCounts', 'actionCountBasis']),
        stages: Object.fromEntries(Object.entries(route.stages ?? {}).map(([stage, part]) => [stage, pick(part,
          ['counts', 'gains', 'classGains', 'explicitActionCounts', 'actionCountBasis'])])) } };
    }
    if (output.projection?.supportItemValues) output.projection.supportItemValues = list(output.projection.supportItemValues).map(value => pick(value,
      ['supportGameId', 'itemName', 'status', 'confirmed', 'acquisition', 'applied', 'potentialRanges', 'summary', 'unscored', 'calculationBasis']));
    return output;
  });
}

/** Run after refinement, ledger and consultation calculations. Never mutate their inputs. */
export function compactComparison(comparison) {
  const result = structuredClone(comparison), candidates = list(result.candidates);
  const detailed = new Set(Object.entries(result).filter(([key, value]) => /CandidateId$/.test(key) && typeof value === 'string').map(([, value]) => value));
  for (const mode of ['current', 'upgraded']) {
    for (const candidate of candidates.filter(row => row.levelMode === mode).sort((a, b) => (b.rankingScore ?? -Infinity) - (a.rankingScore ?? -Infinity)).slice(0, mode === 'current' ? 2 : 1)) detailed.add(candidate.id);
  }
  for (const candidate of candidates) {
    const keepDetails = detailed.has(candidate.id);
    candidate.supports = list(candidate.supports).map(compactSupport);
    candidate.rentalCandidates = list(candidate.rentalCandidates).map(compactSupport);
    candidate.memories = list(candidate.memories).map(compactMemory);
    candidate.personalizedPlan = compactPlan(candidate.personalizedPlan);
    candidate.stages = compactStages(candidate.stages, keepDetails);
    candidate.baselineStages = compactStages(candidate.baselineStages, keepDetails).map(stage => ({ ...stage, bestTrace: null }));
    if (candidate.baselineSelection) {
      const { memories, ...selection } = candidate.baselineSelection;
      candidate.baselineSelection = { ...selection, supports: list(selection.supports).map(compactSupport),
        memoryIds: list(memories).map(memory => memory.id ?? memory.gameId), memoryDetailsLocation: 'candidate.memories' };
    }
    if (candidate.progression) candidate.progression.routes = list(candidate.progression.routes).map(route => {
      const { personalizedPlan, supports, memories, scoreSummary, ...rest } = route;
      const selected = route.id === candidate.progression.selectedRouteId;
      const stages = compactStages(route.stages, false).map(stage => ({ ...pick(stage,
        ['examIndex', 'label', 'stage', 'order', 'status', 'statistics', ...(selected ? [] : ['sampleScores']), 'passBounds', 'limitations']),
        projection: { stats: stage.projection?.stats, week: stage.projection?.week, counts: stage.projection?.route?.counts },
        representativeTrace: selected ? null : stage.representativeTrace,
        ...(selected ? { detailedStageLocation: 'candidate.stages' } : {}) }));
      return { ...rest, stages,
        selection: { supportIds: list(supports).map(card => ({ gameId: card.gameId ?? card.id, level: card.level, uncap: card.uncap,
          isRental: card.isRental === true })), memoryIds: list(memories).map(card => card.id ?? card.gameId),
          source: 'route_reselected_before_simulation', fullPlanLocation: route.id === candidate.progression.selectedRouteId ? 'candidate.personalizedPlan' : null } };
    });
  }
  result.outputDetail = { format: 'compact_personalized_comparison_v1', numericalResultsPreserved: true,
    detailedTraceCandidateIds: [...detailed], omitted: ['support_master_level_ability_tables', 'raw_inventory_rows',
      'duplicate_route_personalized_plans', 'nonleading_trace_hand_snapshots_and_best_traces'],
    note: '표본 점수·덱·적용 조건은 유지했습니다. 중복 원자료와 일부 후보의 손패 상세만 줄였습니다.' };
  return result;
}
