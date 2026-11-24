import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProduceProgression, applyProgressionEdits, hifAutomaticRemovalPlan, applyHifAutomaticRemovals } from '../lib/produce-progression.mjs';

function fixture() {
  const skill = (id, level, extra = {}) => ({ gameId: id, internalId: level + 100, name: id, nameJa: id, sourceType: 'produce',
    plan: 'anomaly', upgradeCount: 0, unlockProducerLevel: level, recommendationEligible: true, ...extra });
  const basics = ['act0', 'act1', 'act1', 'men0', 'men0', 'men1', 'men1'].map((gameId, index) => ({ gameId, nameJa: gameId + '基本',
    name: gameId, internalId: index + 1, publicId: index + 1, source: 'scenario_initial_deck', upgradeCount: 0, customizations: {} }));
  return { result: { memories: [] }, inventory: {}, options: {},
    personalizedPlan: { context: { scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower', producerLevel: { value: 70 } },
      uniqueCards: [], initialDeck: { masterCards: basics }, cardAccess: [], midgamePlan: { acquisitionTargets: [] } },
    catalog: { skillCards: [skill('first', 10), skill('first', 10, { upgradeCount: 1, internalId: 111 }), skill('second', 20), skill('late', 80),
      skill('logic', 1, { plan: 'logic' }), skill('switch', 50, { requiresSkillCardSwitch: true })],
    memoryEffectDetails: { tables: { ProducerLevelUnlocks: {} } }, playbookPolicies: { policies: [{ scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower',
      cards: ['first', 'second', 'late', 'logic', 'switch'].map(gameId => ({ gameId, action: 'take', reason: '주력', sourceIds: ['source'] })) }] } } };
}

test('declares two cumulative eligible acquisitions after the first exam, with unknown encounter probability and cost', () => {
  const input = fixture(), before = structuredClone(input), plan = buildProduceProgression(input);
  assert.deepEqual(plan.eligibleTargets.map(card => card.gameId), ['first', 'second']);
  assert.equal(plan.expectedMean, null);
  assert.equal(plan.successProbability, null);
  assert.ok(plan.routes.length >= 1 && plan.routes.length <= 2);
  for (const route of plan.routes) {
    const acquisitions = route.events.filter(event => event.action === 'acquire');
    assert.deepEqual(acquisitions.map(event => event.fromExamIndex), [1, 2]);
    assert.ok(acquisitions.every(event => event.cost === null && event.occurrenceProbability === null));
    assert.ok(!route.events.some(event => event.fromExamIndex === 0));
  }
  assert.deepEqual(input, before);
});

test('updates only the declared acquired copy and rejects invalid removals instead of silently editing memories', () => {
  const input = fixture(), plan = buildProduceProgression(input), route = plan.routes.find(route => route.id === 'acquire_then_upgrade');
  const mappedCards = [{ gameId: 'first', publicId: 110, upgradeCount: 0, source: 'declared_acquisition_assumption', customizations: {} },
    { gameId: 'first', publicId: 110, upgradeCount: 0, source: 'selected_memory', customizations: { 4: 1 } },
    { gameId: 'second', publicId: 120, upgradeCount: 0, source: 'declared_acquisition_assumption', customizations: {} }];
  const built = { status: 'ready', loadout: { assumptions: [] }, mappedCards }, before = structuredClone(built);
  const prior = applyProgressionEdits({ built, route, examIndex: 2, catalog: input.catalog });
  assert.deepEqual(prior.mappedCards.map(card => card.upgradeCount), [0, 0, 0]);
  const final = applyProgressionEdits({ built, route, examIndex: 3, catalog: input.catalog });
  assert.equal(final.status, 'ready');
  assert.deepEqual(final.mappedCards.map(card => card.upgradeCount), [1, 0, 0]);
  assert.deepEqual(final.mappedCards[1].customizations, { 4: 1 });
  assert.deepEqual(final.loadout.skillCardIdGroups, [[111, 110, 120]]);
  const bad = applyProgressionEdits({ built, route: { events: [{ action: 'remove', fromExamIndex: 1, gameId: 'first', name: 'first' }] }, examIndex: 3, catalog: input.catalog });
  assert.equal(bad.status, 'unsupported');
  assert.equal(bad.loadout, null);
  assert.deepEqual(built, before);
});

test('automatic basic removals are a shared explicit outcome and never count as paid consultation actions', () => {
  const input = fixture(), mappedCards = input.personalizedPlan.initialDeck.masterCards;
  const built = { status: 'ready', mappedCards, loadout: { assumptions: [] }, limitations: [] };
  const rule = hifAutomaticRemovalPlan(mappedCards), before = structuredClone(built);
  const stages = [0, 1, 2, 3, 4].map(examIndex => applyHifAutomaticRemovals({ built, examIndex }));
  assert.deepEqual(stages.map(stage => stage.mappedCards.length), [7, 5, 3, 3, 3]);
  assert.equal(rule.probability, null);
  assert.ok(rule.events.every(event => event.action === 'automatic_remove' && event.venue === 'scenario_rule' && event.cost === 0 && event.supportDeleteTriggerApplied === false));
  assert.deepEqual(stages[2].mappedCards, stages[4].mappedCards);
  assert.deepEqual(built, before);
});
