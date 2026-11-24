import { parentPort, workerData } from 'node:worker_threads';
import { recommendForWorker } from './recommendation-parallel.mjs';
import { buildPersonalizedPlan } from './personalized-plan.mjs';
import { buildAccountPlaybook } from './account-playbook.mjs';
import { buildProduceResourceLedger } from './produce-resource-ledger.mjs';
import { buildProduceForecast } from './produce-forecast.mjs';
import { projectHifStageStats } from './hif-stage-projection.mjs';
import { buildWeekChoiceAdvice } from './week-choice-advice.mjs';
import { buildExamStatTargets } from './exam-stat-targets.mjs';
import { buildExamScoreTargets } from './exam-score-targets.mjs';
import { buildItemConsideration } from './item-consideration.mjs';
import { buildCustomizationReadiness, describeStoredCustomizations, storedCustomizationLabel } from './customization-readiness.mjs';
import { buildHifAbilityGuidance } from './hif-ability-guidance.mjs';
import { buildRunFlowGuidance } from './run-flow-guidance.mjs';
import { resolveHifPreparationReference, buildHifPreparationReadiness } from './hif-preparation-targets.mjs';
import { buildEventContext, buildEventUnlockOverrides } from './event-context.mjs';
import { buildIdolOperatingGuidance } from './idol-operating-guidance.mjs';
import { buildMemorySelectionReview } from './memory-selection-review.mjs';
import { buildMemoryReplacements } from './memory-replacements.mjs';
import { buildRecommendationCoverage } from './recommendation-coverage.mjs';
import { buildSourceRecipeReadiness } from './source-recipe-readiness.mjs';
import { buildRecommendedDeck } from './recommended-deck.mjs';
import { buildHifGuide } from './hif-guide.mjs';

const nextExamIndex = week => week <= 7 ? 0 : week <= 13 ? 1 : week <= 20 ? 2 : week <= 27 ? 3 : 4;
const addWeekAdvice = ({ book, result, candidate, resourceLedger }, catalog) => {
  if (book.scheduleContext?.status === 'reference_schedule') {
    book.weekPlan = book.weekPlan.map(row => {
      const {day,observedChoice} = buildWeekChoiceAdvice({book,result,candidate,catalog,week:row.week});
      return {...row,choiceAdvice:{day,...(observedChoice?{observedChoice}:{})}};
    });
    return;
  }
  const targets = Array.from({ length: 5 }, (_, examIndex) => buildExamStatTargets({ candidate, result, catalog, examIndex }));
  book.weekPlan = (book.weekPlan ?? []).map(row => {
    const statTargets = targets[nextExamIndex(row.week)];
    return { ...row, nextExamTargets: statTargets,
      choiceAdvice: buildWeekChoiceAdvice({ book, result, candidate, resourceLedger, catalog, week: row.week, liveState: {}, statTargets }) };
  });
};

async function calculate({ input, inventory, catalog, inventoryVersion }) {
  const options = { ...input, scenario: input.scenario ?? 'hif',
    objective: input.goal === 'memory' ? 'memory_farming' : input.objective ?? 'evaluation',
    idolGameId: input.idolId ?? input.idolGameId, trainingType: input.type ?? input.trainingType,
    targetAttribute: input.targetAttribute === 'auto' ? undefined : input.targetAttribute,
    eventUnlockOverrides: null };
  const requestedIdol = inventory.idolCards.find(row => row.gameId === options.idolGameId);
  const preparationReference = resolveHifPreparationReference({ catalog, options, idolGameId: requestedIdol?.gameId });
  if (preparationReference && options.preparationTargets == null) options.preparationTargets = preparationReference.targets;
  options.eventUnlockOverrides = buildEventUnlockOverrides({ catalog, options, context: {
    plan: requestedIdol?.plan ?? options.plan, scenario: options.scenario, trainingType: options.trainingType } });
  let result = await recommendForWorker({ inventory, catalog, options });
  const actualOverrides = buildEventUnlockOverrides({ catalog, options, context: {
    plan: result.selectedIdol?.plan ?? result.scoreSummary?.plan, scenario: result.scoreSummary?.scenario ?? options.scenario,
    trainingType: result.scoreSummary?.trainingType } });
  const selectedPreparationReference = resolveHifPreparationReference({ catalog, options, idolGameId: result.selectedIdol?.gameId });
  const preparationChanged = options.preparationTargets == null && selectedPreparationReference !== null;
  if (preparationChanged) {
    options.preparationTargets = selectedPreparationReference.targets;
    options.idolGameId = result.selectedIdol.gameId;
  }
  const ruleKey = value => value ? JSON.stringify([value.eventModeId, value.plan, value.scenario, value.trainingType,
    value.producerLevelUnlock, value.memoryRentalProducerLevelUnlock]) : null;
  if (preparationChanged || ruleKey(actualOverrides) !== ruleKey(options.eventUnlockOverrides)) {
    options.eventUnlockOverrides = actualOverrides;
    result = await recommendForWorker({ inventory, catalog, options });
  }
  result.eventContext = buildEventContext({ result, inventory, catalog, options });
  if (result.eventContext.validation.status === 'invalid') return { failure: { code: 'invalid_event_selection',
    error: result.eventContext.validation.issues.find(issue => issue.severity === 'invalid').message, eventContext: result.eventContext } };
  if (result.eventContext.status === 'pending_rules') result.warnings = [...(result.warnings ?? []),
    '이벤트 렌탈은 실제 목록·메모리 상세가 확인되지 않아 반영하지 않았습니다. 보유 편성과 이벤트 검색 목표를 구분합니다.'];
  const selectedModel = result.scoreSummary?.hifModel, selectedPlan = selectedModel?.supportActionPlan?.peakScenario;
  const routeOptions = Array.isArray(selectedModel?.produceActions) ? { ...options, activityFocus:selectedModel.activityFocus,
    hifScenarioItemPath:selectedPlan?.scenarioItem?.id, hifConsultPlan:selectedPlan?.consultPlan, produceActions:selectedModel.produceActions } : options;
  result.personalizedPlan = buildPersonalizedPlan({ result, inventory, catalog, options: routeOptions });
  result.accountPlaybook = buildAccountPlaybook({ result, inventory, catalog, options: routeOptions });
  if (result.scoreSummary?.hifModel) result.scoreSummary.hifModel.examProfile = {
    ...(catalog.hifExamProfiles?.profiles?.find(profile => profile.idolCardId === result.selectedIdol?.gameId) ?? {}),
    sources: catalog.hifExamProfiles?.sources ?? [],
  };
  if (result.supports && !Array.isArray(result.supports)) {
    const selection = result.supports;
    result.supports = [...(selection.owned ?? []), ...(selection.rental ? [{ ...selection.rental, isRental: true }] : [])];
    result.rentalCandidates = selection.rentalCandidates ?? [];
    if (selection.rentalConstraintConflict) result.rentalConstraintConflict = selection.rentalConstraintConflict;
  }
  const ownedMemories = new Map(inventory.memories.map(row => [row.gameId, row]));
  const memoryArtwork = row => {
    const original = ownedMemories.get(row.gameId ?? row.id);
    return { ...row, effects: row.modelEffects ?? original?.effects ?? null, produceRecordStats: original?.stats ?? null, ...Object.fromEntries(['imageUrl','thumbnailUrl','idolImageUrl','skillImageUrl','characterImageUrl',
      'characterName','characterNameJa','idolName','idolNameJa','skillNameKo','skillNameJa'].map(key => [key, original?.[key] ?? null])) };
  };
  result.memories = (result.memories ?? []).map(memoryArtwork);
  if (result.supportUpgradeComparison?.memories) result.supportUpgradeComparison.memories = result.supportUpgradeComparison.memories.map(memoryArtwork);
  if (result.supportUpgradeComparison?.currentMemories) result.supportUpgradeComparison.currentMemories = result.supportUpgradeComparison.currentMemories.map(memoryArtwork);
  const ownedIdols = new Map(inventory.idolCards.map(row => [row.gameId, row]));
  const currentIdolArt = row => row ? { ...row, ...Object.fromEntries(['imageUrl','thumbnailUrl','characterImageUrl','characterNameJa'].map(key => [key, ownedIdols.get(row.gameId)?.[key] ?? row[key] ?? null])) } : row;
  result.selectedIdol = currentIdolArt(result.selectedIdol);
  result.farmingIdols = (result.farmingIdols ?? []).map(currentIdolArt);
  result.warnings = [...new Set([...(inventory.warnings ?? []), ...(result.warnings ?? [])])];
  result.resourceLedger = buildProduceResourceLedger({ result, inventory, catalog, options: routeOptions });
  result.produceForecast = buildProduceForecast({ result, inventory, catalog, options: routeOptions });
  result.examScoreTargets = buildExamScoreTargets({ result, catalog, options: routeOptions });
  result.itemConsideration = buildItemConsideration({ result, inventory, catalog, options: routeOptions });
  result.customizationReadiness = buildCustomizationReadiness({ result, inventory, catalog, options: routeOptions });
  result.hifAbilityGuidance = buildHifAbilityGuidance({ result, inventory, catalog, options: routeOptions });
  const recommendedDeck = buildRecommendedDeck({ result, inventory, catalog, options: routeOptions });
  if (recommendedDeck) result.recommendedDeck = recommendedDeck;
  const hifGuide = buildHifGuide({ result, inventory, catalog, options: routeOptions });
  if (hifGuide) result.hifGuide = hifGuide;
  result.sourceRecipeReadiness = buildSourceRecipeReadiness({result,catalog,inventory,options:routeOptions});
  const candidate = { ...result, stages: options.scenario === 'hif' ? Array.from({ length: 5 }, (_, examIndex) => ({ examIndex,
    projection: projectHifStageStats({ result, inventory, catalog, examIndex, options: routeOptions }) })) : [] };
  result.preparationReadiness = buildHifPreparationReadiness({ result, candidate, catalog, options: routeOptions });
  result.runFlowGuidance = buildRunFlowGuidance({ result, inventory, catalog, options: routeOptions });
  result.idolOperatingGuidance = buildIdolOperatingGuidance({ result, inventory, catalog, options: routeOptions });
  result.recommendationCoverage = buildRecommendationCoverage({result,catalog,inventory,options:routeOptions});
  result.memorySelectionReview = buildMemorySelectionReview({result,inventory,catalog,options:routeOptions});
  const describeCopyCustomizations = skill => describeStoredCustomizations(skill, catalog).map((custom, index) => ({
    id: custom.id, customizeCount: custom.customizeCount, exactCountKnown: custom.exactCountKnown,
    label: storedCustomizationLabel(custom, skill.customizes[index].nameJa) || custom.description,
  }));
  const detailCopy = row => ({ ...memoryArtwork(row),
    storedCustomizations: describeCopyCustomizations(row.modelEffects?.carriedSkill) });
  const replacements = buildMemoryReplacements({result, inventory, catalog, options:routeOptions, memoryArtwork:detailCopy});
  result.memorySelectionReview.slots.forEach((slot, index) => Object.assign(slot, replacements[index], {
    storedCustomizations: describeCopyCustomizations(result.memories[index].effects?.carriedSkill),
  }));
  result.inventoryVersion = inventoryVersion;
  result.inventoryCapturedAt = inventory.capturedAt ?? null;
  addWeekAdvice({ book: result.accountPlaybook, result, candidate, resourceLedger: result.resourceLedger }, catalog);
  delete selectedModel?.fixedDeckPolicyComparison?.policiesCompared;
  delete selectedModel?.fixedDeckPolicyComparison?.replayedAlternatives;
  return { result, stages: candidate.stages, scenario: options.scenario, checkedAt: new Date().toISOString() };
}

parentPort.postMessage(await calculate(workerData));
