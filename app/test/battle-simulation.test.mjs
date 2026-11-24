import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateBattle } from '../lib/battle-simulation.mjs';

const fixture = () => ({
  loadout: { fullDeckConfirmed: true, params: [100, 100, 100, 40], supportBonus: 0, pItemIds: [],
    skillCardIdGroups: [[1]], customizationGroups: [[]], plan: 'sense' },
  stage: { scenario: 'hif', turnCounts: { vocal: 2, dance: 0, visual: 0 }, firstTurns: { vocal: 1, dance: 0, visual: 0 },
    criteria: { vocal: 1, dance: 0, visual: 0 }, effects: [], typeMultipliers: { vocal: 1, dance: 1, visual: 1 } },
  runs: 4, seed: 42,
});

test('uses the supplied full deck without contest cards and records played turns', async () => {
  const result = await simulateBattle(fixture());
  assert.equal(result.status, 'simulated');
  assert.equal(result.statistics.mean, 18);
  assert.equal(result.statistics.min, 18);
  assert.equal(result.statistics.maxObserved, 18);
  assert.equal(result.statistics.passRate, null);
  assert.equal(result.statistics.standardError, 0);
  assert.equal(result.representativeTrace.turns.length, 2);
  assert.deepEqual(result.representativeTrace.turns.flatMap(turn => turn.playedCards.map(card => card.id)), [1, 1]);
  assert.equal(result.representativeTrace.turns.at(-1).scoreEnd, 18);
});

test('applies the exact supplied coefficients and only an explicit pass threshold', async () => {
  const input = fixture();
  input.stage.typeMultipliers.vocal = 2;
  input.threshold = 35;
  const result = await simulateBattle(input);
  assert.equal(result.statistics.mean, 36);
  assert.equal(result.statistics.threshold, 35);
  assert.equal(result.statistics.passRate, 1);
  const below = await simulateBattle({ ...input, threshold: 37 });
  assert.equal(below.statistics.passRate, 0);
});

test('rejects incomplete deck declarations and inconsistent turn counts', async () => {
  const input = fixture();
  delete input.loadout.fullDeckConfirmed;
  assert.equal((await simulateBattle(input)).status, 'invalid_input');
  input.loadout.deckAssumptionConfirmed = true;
  assert.equal((await simulateBattle(input)).scope, 'conditional_model');
  input.stage.totalTurns = 3;
  assert.equal((await simulateBattle(input)).status, 'invalid_input');
});

test('unknown customizations are reported instead of silently removed by IdolConfig', async () => {
  const input = fixture();
  input.loadout.customizationGroups = [[{ 999999: 1 }]];
  const result = await simulateBattle(input);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.statistics, null);
  assert.match(result.reason, /커스터마이즈/);
});

test('unimplemented clearRatio and unknown runtime effects produce no score statistics', async () => {
  const input = fixture();
  input.stage.effects = [{ phase: 'startOfTurn', conditions: [{ type: 'identifier', name: 'clearRatio' }], actions: [] }];
  assert.equal((await simulateBattle(input)).status, 'unsupported');
  input.stage.effects = [{ phase: 'startOfTurn', actions: [{ type: 'call', name: '__unsupported_battle_test__', target: null, args: [] }] }];
  const unknown = await simulateBattle(input);
  assert.equal(unknown.status, 'unsupported');
  assert.equal(unknown.statistics, null);
});

test('seeded variable hands reproduce exactly, including simultaneous callers', async () => {
  const input = fixture();
  input.loadout.skillCardIdGroups = [[1, 3, 5, 7, 15, 17, 13]];
  input.loadout.recommendedEffect = 'concentration';
  input.stage.turnCounts = { vocal: 4, dance: 4, visual: 4 };
  input.stage.criteria = { vocal: 1, dance: 1, visual: 1 };
  input.runs = 8;
  const [first, second] = await Promise.all([simulateBattle(input), simulateBattle(input)]);
  assert.equal(first.status, 'simulated');
  assert.deepEqual(first, second);
  assert(first.statistics.maxObserved > first.statistics.min);
  assert(first.statistics.p10 >= first.statistics.min);
  assert(first.statistics.p90 <= first.statistics.maxObserved);
  assert(first.statistics.standardError > 0);
  assert(first.sampleScores.some(row => row.seed === first.representativeTrace.seed && row.score === first.representativeTrace.score));
});
