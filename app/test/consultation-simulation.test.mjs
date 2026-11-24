import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { simulateConsultationChoices } from '../lib/consultation-simulation.mjs';

const baseCatalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
const makeExam = (stage, order) => ({ stage, order, turn: 2, scoreConfigId: 'constant-coefficients',
  turnCounts: { vocal: 2, dance: 0, visual: 0 }, firstTurns: { vocal: 1, dance: 0, visual: 0 } });
const catalog = { ...baseCatalog, hifExamProfiles: {
  profiles: [{ idolCardId: 'fixture-idol', examStages: [makeExam('selection', 1), makeExam('selection', 2), makeExam('final', 2)] }],
  scoreTables: { 'constant-coefficients': [[0, 1000, 1000, 1000], [100, 1000, 1000, 1000]] }, gimmickGroups: {},
} };
function candidateWith(cards) {
  const deck = { fullDeckConfirmed: false, deckAssumptionConfirmed: true, plan: 'sense', recommendedEffect: 'concentration',
    params: [100, 100, 100, 40], supportBonus: 0, pItemIds: [], skillCardIdGroups: [cards],
    customizationGroups: [cards.map(() => ({}))] };
  return { selectedIdol: { gameId: 'fixture-idol' }, stages: [0, 1, 4].map(examIndex => ({ examIndex, status: 'simulated',
    stage: examIndex < 3 ? 'selection' : 'final', order: examIndex < 3 ? examIndex + 1 : 2,
    projection: { stats: { vocal: 100, dance: 100, visual: 100 } }, deck: structuredClone(deck) })) };
}

test('compares an exact base-to-plus card with a real, reproducible score change at three independent checkpoints', async () => {
  const candidate = candidateWith([1]), original = structuredClone(candidate);
  const results = await simulateConsultationChoices({ candidate, catalog, runs: 4 });
  assert.deepEqual(results.map(row => row.stageIndex), [0, 1, 4]);
  for (const row of results) {
    assert.equal(row.status, 'simulated');
    assert.equal(row.baselineStatistics.mean, 18);
    assert.equal(row.actions.length, 1);
    const upgrade = row.actions[0];
    assert.equal(upgrade.action, 'upgrade');
    assert.equal(upgrade.card.internalId, 1);
    assert.equal(upgrade.replacement.gameId, upgrade.card.gameId);
    assert.equal(upgrade.replacement.internalId, catalog.skillCards.find(card => card.gameId === upgrade.card.gameId && card.upgradeCount === 1).internalId);
    assert.equal(upgrade.statistics.mean, 28);
    assert.equal(upgrade.meanDelta, 10);
    assert.equal(upgrade.p10Delta, 10);
    assert.equal(row.recommendedAction.id, upgrade.id);
    assert.equal(upgrade.statistics.passRate, null);
    assert.equal(upgrade.afterCardCount, 1);
    assert.match(row.limitations.join(' '), /독립/);
  }
  assert.deepEqual(candidate, original);
});

test('deletes only one duplicate copy, preserves slots, and never upgrades existing plus or P-idol unique cards', async () => {
  const unique = catalog.skillCards.find(card => card.sourceType === 'pIdol' && card.plan === 'sense' && card.upgradeCount === 0);
  const candidate = candidateWith([1, 1, 2, 3, 3, 4, 5, 7, 13, 15, 17, unique.internalId]);
  const original = structuredClone(candidate);
  const results = await simulateConsultationChoices({ candidate, catalog, runs: 4 });
  const first = results[0];
  assert.equal(first.status, 'simulated');
  const deletion = first.screening.checked.find(action => action.action === 'remove' && action.card.internalId === 1);
  assert(deletion);
  assert.equal(deletion.copiesChanged, 1);
  assert.equal(deletion.beforeCardCount, 12);
  assert.equal(deletion.afterCardCount, 11);
  assert.equal(deletion.remainingCopies, 1);
  assert.equal(first.screening.checked.filter(action => action.action === 'remove' && action.card.internalId === 1).length, 1);
  assert(first.actions.length <= 2);
  assert(!first.screening.checked.some(action => action.card.internalId === unique.internalId));
  assert(!first.screening.checked.some(action => action.action === 'upgrade' && [2, 4].includes(action.card.internalId)));
  assert.deepEqual(candidate, original);
  const protectedOnly = await simulateConsultationChoices({ candidate: candidateWith([unique.internalId]), catalog, runs: 4 });
  assert(protectedOnly.every(row => row.status === 'no_legal_actions' && row.actions.length === 0 && row.recommendedAction === null));
});
