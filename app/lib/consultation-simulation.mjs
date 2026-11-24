import { simulateBattle } from './battle-simulation.mjs';
import { buildHifBattleStage } from './hif-battle-stage.mjs';
import { SkillCards } from './vendor/gakumas-data/index.js';

const checkpoints = [{ index: 0, label: '선발 1 전 상담' }, { index: 1, label: '선발 2 전 상담' }, { index: 4, label: '본선 2 전 상담' }];
const axes = ['vocal', 'dance', 'visual'];
const list = value => Array.isArray(value) ? value : [];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const cardCount = deck => list(deck.skillCardIdGroups).reduce((sum, group) => sum + list(group).filter(Boolean).length, 0);
const limitations = [
  '세 시점을 각각 독립적으로 점검했습니다. 앞선 상담의 삭제·강화가 이후 주차까지 누적된 시뮬레이션은 아닙니다.',
  '입력한 확보 가정 덱에서 카드 한 장만 바꾸는 비교입니다. 실제 진행 중 덱과 P포인트는 수집하지 않았습니다.',
  '상담에 해당 선택지가 보이고 비용에 여유가 있을 때의 후보입니다. P포인트 비용은 추정하지 않았으며 그대로 진행하는 선택도 가능합니다.',
  '삭제·강화로 발동하는 육성 중 서포트·P아이템의 추가 능력치 변화는 별도로 계산하지 않았습니다.',
];

function stageAt(candidate, index) {
  const stages = list(candidate?.stages);
  return stages.some(stage => Number.isInteger(stage?.examIndex)) ? stages.find(stage => stage.examIndex === index) : stages[index];
}
function restoreStage(candidate, output, index, catalog) {
  const direct = output.simulationInput?.stage ?? output.battleStage ?? (output.stage && typeof output.stage === 'object' ? output.stage : null);
  if (direct?.turnCounts) return { status: 'ready', stage: structuredClone(direct) };
  const idolId = candidate.selectedIdol?.gameId ?? candidate.selectedIdol?.id;
  const profile = list(catalog.hifExamProfiles?.profiles).find(row => row.idolCardId === idolId);
  const stageType = index < 3 ? 'selection' : 'final', order = index < 3 ? index + 1 : index - 2;
  const exam = list(profile?.examStages).find(row => row.stage === stageType && row.order === order);
  const stats = output.projection?.stats ?? Object.fromEntries(axes.map((axis, axisIndex) => [axis, output.deck.params?.[axisIndex]]));
  const built = buildHifBattleStage({ exam, catalog, stats });
  if (built.status !== 'ready') return built;
  if (output.coefficients && axes.some(axis => !finite(output.coefficients[axis]) || Math.abs(output.coefficients[axis] - built.coefficients[axis]) > 1e-8)) return { status: 'unsupported', reason: '원래 비교와 같은 시험 점수 계수를 복원하지 못했습니다.' };
  return built;
}
function visualCard(card) {
  return { gameId: card.gameId ?? card.id, internalId: card.internalId,
    nameKo: card.nameKo ?? null, nameJa: card.nameJa ?? card.name ?? null,
    imageUrl: card.thumbnailUrl ?? card.imageUrl ?? null };
}
function legalActions(deck, catalog) {
  const byId = new Map(list(catalog.skillCards).filter(card => card.internalId != null).map(card => [Number(card.internalId), card]));
  const actions = [], seen = new Set(), beforeCardCount = cardCount(deck);
  for (const [groupIndex, group] of list(deck.skillCardIdGroups).entries()) for (const [cardIndex, rawId] of list(group).entries()) {
    if (!rawId) continue;
    const id = Number(rawId), card = byId.get(id), definition = card ? SkillCards.getById(id) : null;
    if (!card || !definition || !['default', 'produce'].includes(card.sourceType) || ['trouble'].includes(definition.type) || ['T', 'L'].includes(definition.rarity) || card.recommendationEligible === false) continue;
    const add = (action, replacement = null) => {
      const key = action + ':' + id;
      if (seen.has(key)) return;
      seen.add(key);
      actions.push({ id: key, action, card: visualCard(card), replacement: replacement ? visualCard(replacement) : null,
        groupIndex, cardIndex, publicId: id, replacementId: replacement ? Number(replacement.internalId) : null, beforeCardCount });
    };
    // The captured catalogue identifies the game's starter cards. Normal
    // produce cards require an explicit removability assertion; never infer
    // deletion rights from a translated name or a nearby numeric ID.
    if (beforeCardCount > 1 && (card.sourceType === 'default' || card.canDelete === true || card.removalEligible === true)) add('remove');
    if (card.upgradeCount !== 0) continue;
    const next = list(catalog.skillCards).filter(other => other.gameId === card.gameId && other.upgradeCount === 1 &&
      other.recommendationEligible !== false && other.internalId != null && other.plan === card.plan);
    if (next.length !== 1 || !SkillCards.getById(Number(next[0].internalId))) continue;
    add('upgrade', next[0]);
  }
  return actions;
}
function changeDeck(deck, action) {
  const changed = structuredClone(deck);
  changed.customizationGroups ??= list(changed.skillCardIdGroups).map(group => list(group).map(() => ({})));
  while (changed.customizationGroups.length < changed.skillCardIdGroups.length) changed.customizationGroups.push([]);
  const customGroup = changed.customizationGroups[action.groupIndex];
  while (customGroup.length < changed.skillCardIdGroups[action.groupIndex].length) customGroup.push({});
  if (action.action === 'remove') {
    changed.skillCardIdGroups[action.groupIndex].splice(action.cardIndex, 1);
    customGroup.splice(action.cardIndex, 1);
  } else changed.skillCardIdGroups[action.groupIndex][action.cardIndex] = action.replacementId;
  return changed;
}
const improvement = (changed, baseline) => ({ meanDelta: changed.mean - baseline.mean, p10Delta: changed.p10 - baseline.p10 });
const rankActions = (a, b) => b.meanDelta - a.meanDelta || b.p10Delta - a.p10Delta || a.id.localeCompare(b.id);

/** Seed-matched, one-card consultation checks on three independent recipes. */
export async function simulateConsultationChoices({ candidate, catalog, runs = 8 } = {}) {
  const finalRuns = Number.isInteger(runs) && runs > 0 ? Math.min(32, runs) : 8;
  const results = [];
  for (const checkpoint of checkpoints) {
    const output = stageAt(candidate, checkpoint.index);
    const row = { stageIndex: checkpoint.index, label: checkpoint.label, status: 'unsupported', actions: [],
      baselineStatistics: null, recommendedAction: null, skipAvailable: true, limitations: [...limitations] };
    results.push(row);
    if (!output?.deck || output.status && output.status !== 'simulated') { row.limitations.push('이 시점의 실행 가능한 원래 시험 덱이 없습니다.'); continue; }
    if (!catalog) { row.limitations.push('카드·시험 원자료가 없습니다.'); continue; }
    let restored, actions;
    try { restored = restoreStage(candidate, output, checkpoint.index, catalog); actions = legalActions(output.deck, catalog); }
    catch (error) { row.limitations.push('카드·시험 조건을 읽지 못했습니다: ' + error.message); continue; }
    if (restored.status !== 'ready') { row.limitations.push(restored.reason ?? '시험 조건을 복원하지 못했습니다.'); continue; }
    if (!actions.length) { row.status = 'no_legal_actions'; row.limitations.push('삭제·강화를 허용한다고 확인한 카드가 없습니다.'); continue; }
    const rawSeed = output.sampleScores?.[0]?.seed;
    const seed = Number.isInteger(rawSeed) && rawSeed >= 0 && rawSeed <= 0xffffffff ? rawSeed : (610397104 + checkpoint.index * 1000) >>> 0;
    const baseInput = { loadout: output.deck, stage: restored.stage, seed, threshold: null };
    const screenBaseline = await simulateBattle({ ...baseInput, runs: 4 });
    if (screenBaseline.status !== 'simulated') { row.limitations.push(...list(screenBaseline.reasons)); continue; }
    const screened = [], rejected = [];
    for (const action of actions) {
      const changed = changeDeck(output.deck, action);
      const simulation = await simulateBattle({ ...baseInput, loadout: changed, runs: 4 });
      if (simulation.status !== 'simulated') { rejected.push({ id: action.id, action: action.action, card: action.card, reasons: list(simulation.reasons) }); continue; }
      screened.push({ ...action, ...improvement(simulation.statistics, screenBaseline.statistics),
        statistics: simulation.statistics, changedDeck: changed, afterCardCount: cardCount(changed),
        remainingCopies: list(changed.skillCardIdGroups).flat().filter(id => Number(id) === action.publicId).length });
    }
    screened.sort(rankActions);
    row.screening = { runs: 4, seed, eligibleActions: actions.length, supportedActions: screened.length,
      checked: screened.map(action => ({ id: action.id, action: action.action, card: action.card,
        meanDelta: action.meanDelta, p10Delta: action.p10Delta, beforeCardCount: action.beforeCardCount,
        afterCardCount: action.afterCardCount, remainingCopies: action.remainingCopies, copiesChanged: 1 })), rejected };
    if (!screened.length) { row.limitations.push('지원되는 효과를 유지한 상담 변경 후보를 계산하지 못했습니다.'); continue; }
    const baseline = finalRuns === 4 ? screenBaseline : await simulateBattle({ ...baseInput, runs: finalRuns });
    if (baseline.status !== 'simulated') { row.limitations.push(...list(baseline.reasons)); continue; }
    row.baselineStatistics = baseline.statistics;
    row.status = 'simulated';
    for (const action of screened.slice(0, 2)) {
      const simulation = finalRuns === 4 ? { status: 'simulated', statistics: action.statistics } :
        await simulateBattle({ ...baseInput, loadout: action.changedDeck, runs: finalRuns });
      if (simulation.status !== 'simulated') { row.limitations.push(...list(simulation.reasons)); continue; }
      row.actions.push({ id: action.id, action: action.action, card: action.card, replacement: action.replacement,
        statistics: simulation.statistics, ...improvement(simulation.statistics, baseline.statistics), copiesChanged: 1,
        beforeCardCount: action.beforeCardCount, afterCardCount: action.afterCardCount, remainingCopies: action.remainingCopies,
        assumptions: [action.action === 'remove' ? '이 시험 직전에 해당 스킬 카드 한 장만 삭제하는 가정입니다.' : '이 시험 직전에 현재 미강화 카드 한 장만 동일 스킬의 강화 1단계로 바꾸는 가정입니다.',
          '기존 커스터마이즈·P아이템·능력치는 그대로 유지합니다. 실제 상담 선택지와 비용을 확인한 뒤 적용하세요.'] });
    }
    row.actions.sort(rankActions);
    row.recommendedAction = row.actions.find(action => action.meanDelta >= 0 && action.p10Delta >= 0 &&
      (action.meanDelta > 0 || action.p10Delta > 0)) ?? null;
    row.limitations.push('공통 4개 시드로 후보를 줄인 뒤 상위 두 행만 다시 비교했습니다. 모든 후보의 최적성을 증명하지 않습니다.');
    if (!row.recommendedAction) row.limitations.push('평균과 하위 10% 표본 점수를 함께 유지하면서 개선하는 상담 행동이 확인되지 않아 그대로 진행할 수 있습니다.');
  }
  return results;
}
