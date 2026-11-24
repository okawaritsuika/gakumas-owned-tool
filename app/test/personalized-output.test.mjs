import test from 'node:test';
import assert from 'node:assert/strict';
import { compactComparison } from '../lib/personalized-output.mjs';

test('compacts duplicated master and route data without changing source results, decks, scores, memory timing or artwork', () => {
  const trace = { seed: 1, score: 40, turns: [{ turn: 1, playedCards: [{ gameId: 'skill', imageUrl: '/skill.png' }], heldCards: [],
    drawnCards: [{ id: 1 }], decisions: [{ hand: [{ id: 1 }], selectedCard: { id: 1 } }] }] };
  const stage = { examIndex: 4, statistics: { runs: 8, mean: 40 }, sampleScores: [{ seed: 1, score: 40 }],
    deck: { params: [100, 200, 300, 40], skillCardIdGroups: [[1]] }, representativeTrace: trace, bestTrace: trace,
    projection: { stats: { vocal: 100 }, route: { counts: { acquire: 2 }, rawMasterRows: ['huge'] } }, limitations: ['조건부'] };
  const support = { gameId: 'support', level: 40, uncap: 2, imageUrl: '/support.png', p_item: { name: '아이템' },
    supportItemValue: { status: 'partial' }, reasons: ['이유'], levelAbilities: [{ huge: 'source' }], raw: { level: 40 } };
  const memory = { id: 'owned-copy', imageUrl: '/memory.png', modelEffects: { carriedSkill: { phase: { code: 2 } } }, effects: { carriedSkill: { phase: { code: 2 } } }, raw: { huge: true } };
  const plan = { memoryStages: { afterMid: [{ memoryId: 'owned-copy', effects: { hifEffects: [] } }] },
    openingPlan: { cards: [{ gameId: 'skill', effects: { huge: true } }] }, simulationInputs: { stageRecipes: [{ confirmedCards: [{ gameId: 'skill', effects: { huge: true } }] }] } };
  const input = { recommendedCurrentCandidateId: 'best', candidates: ['best', 'other', 'third'].map((id, index) => ({ id, levelMode: 'current', rankingScore: 40 - index,
    supports: [support], rentalCandidates: [support], memories: [memory], personalizedPlan: plan, stages: [stage], baselineStages: [stage],
    progression: { selectedRouteId: 'route', routes: [{ id: 'route', stages: [stage], supports: [support], memories: [memory], personalizedPlan: plan, scoreSummary: {} }] } })) };
  const before = structuredClone(input), compact = compactComparison(input);
  assert.deepEqual(input, before);
  for (const candidate of compact.candidates) {
    assert.ok(!('levelAbilities' in candidate.supports[0]));
    assert.deepEqual(candidate.supports[0].supportItemValue, support.supportItemValue);
    assert.equal(candidate.memories[0].imageUrl, '/memory.png');
    assert.equal(candidate.memories[0].modelEffects.carriedSkill.phase.code, 2);
    assert.deepEqual(candidate.stages[0].statistics, stage.statistics);
    assert.deepEqual(candidate.stages[0].deck, stage.deck);
    assert.deepEqual(candidate.stages[0].sampleScores, stage.sampleScores);
    assert.ok(!('personalizedPlan' in candidate.progression.routes[0]));
    assert.deepEqual(candidate.personalizedPlan.memoryStages, plan.memoryStages);
  }
  assert.deepEqual(compact.candidates[0].stages[0].representativeTrace.turns[0].decisions, trace.turns[0].decisions);
  assert.ok(!('decisions' in compact.candidates[2].stages[0].representativeTrace.turns[0]));
  assert.deepEqual(compact.candidates[2].stages[0].representativeTrace.turns[0].playedCards, trace.turns[0].playedCards);
  compact.candidates[0].stages[0].statistics.mean = 99;
  assert.equal(input.candidates[0].stages[0].statistics.mean, 40);
});
