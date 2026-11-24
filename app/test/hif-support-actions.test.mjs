import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildHifRoute, calculateHifSupport, evaluateHifDeck } from '../lib/hif-model.mjs';
import { declaredProduceActionCounts } from '../lib/produce-action-counts.mjs';
import { planHifSupportActions } from '../lib/hif-support-actions.mjs';

const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
const options = { secondaryAttribute: 'visual', activityFocus: 'supply_gift' };
const latest = (card, level) => {
  const rows = new Map();
  for (const ability of card.levelAbilities) if (ability.level <= level) rows.set(ability.order, ability);
  return [...rows.values()];
};

test('HIF gift route includes actual opportunity types and keeps unconfirmed deck conditions out', () => {
  const route = buildHifRoute(catalog, 'dance', options);
  assert.equal(route.counts.skill_acquire, 7); // Five gifts + two early class selections, no lesson cards.
  assert.equal(route.counts.p_drink_acquire, 5);
  assert.equal(route.counts.delete, 4);
  assert.equal(route.counts.change, 4);
  assert.equal(route.counts.basic_card_change, null);
  assert.equal(route.counts.p_drink_exchange, 0);
  assert.equal(route.counts.full_power_card_acquire_8, null);
  assert.equal(route.counts.sp_lesson_20, null);
  assert.equal(route.supportActionPlan.actualAcquisitionsConfirmed, false);
  assert.equal(route.supportActionPlan.randomCardRarityOrKeywordAssumed, false);
  assert.equal(new Set(route.produceActions.map(action => action.id)).size, route.produceActions.length);
  assert.equal(route.stages.selection.counts.p_drink_acquire, 4);
  assert.equal(route.stages.final.counts.p_drink_acquire, 1);
});

test('a zero-uncap Lv40 support receives its drink contribution without being upgraded or granted a P-item', () => {
  const card = catalog.supportCards.find(card => card.gameId === 's_card-3-0069');
  const before = structuredClone(card);
  const baseline = buildHifRoute(catalog, 'dance', { ...options, supportActionMode: 'declared' });
  const planned = buildHifRoute(catalog, 'dance', options);
  const evaluate = route => calculateHifSupport(card, latest(card, 40), 40, route, 'anomaly', { catalog, includeSupportEvents: false });
  assert.equal(evaluate(planned).fixedStats.dance - evaluate(baseline).fixedStats.dance, 20);
  assert.equal(evaluate(planned).providedActions.p_item_acquire, undefined);
  assert.deepEqual(card, before);
});

test('explicit gift target replaces the same planned receipt instead of adding a second card', () => {
  const action = { id: 'actual-target', action: 'acquire', venue: 'supply_gift', week: 1, fromExamIndex: 0, gameId: 'p_card-03-men-1_144' };
  const before = structuredClone(action);
  const route = buildHifRoute(catalog, 'dance', { ...options, produceActions: [action] });
  assert.equal(route.counts.skill_acquire, 7);
  assert.equal(route.produceActions.filter(row => row.week === 1 && row.action === 'acquire').length, 1);
  assert.deepEqual(action, before);
});

test('base-card deletion occurs after each completed exam and never before that exam', () => {
  const route = buildHifRoute(catalog, 'dance', options);
  const before = declaredProduceActionCounts(route.produceActions, catalog, { examIndex: 0 });
  const afterFirst = declaredProduceActionCounts(route.produceActions, catalog, { examIndex: 1 });
  assert.equal(before.delete, 0);
  assert.equal(afterFirst.delete, 2);
  assert.equal(afterFirst.change, 1); // The day-10 class is before selection exam 2.
  assert.equal(declaredProduceActionCounts(route.produceActions, catalog, { examIndex: 2 }).delete, 4);
});

test('a declared trouble card fills only the trouble slot of an outing selection', () => {
  const row = { week: 5, activity: 'outing', fromExamIndex: 0, stage: 'selection', choiceId: 'trouble' };
  const actions = [{ action: 'acquire', week: 5, venue: 'outing', fromExamIndex: 0, quantity: 2, type: 'mental', rarity: 'SR', keywords: [] },
    { action: 'acquire', week: 5, venue: 'outing', fromExamIndex: 0, type: 'trouble', rarity: 'N', keywords: [] }];
  const planned = planHifSupportActions({ selections: [row] }, catalog, { produceActions: actions });
  assert.equal(planned.actions.filter(action => action.action === 'acquire').reduce((sum, action) => sum + (action.quantity ?? 1), 0), 3);
  assert.ok(!planned.evidence.generatedActions.some(action => action.action === 'acquire'));
});

test('explicit-only mode and event boundaries stay visible and invalid mode is rejected', () => {
  const declared = buildHifRoute(catalog, 'dance', { ...options, supportActionMode: 'declared' });
  assert.equal(declared.counts.skill_acquire, undefined);
  assert.equal(declared.supportActionPlan.basis, 'declared_actions_only');
  const event = buildHifRoute(catalog, 'dance', { ...options, eventModeId: 'asari' });
  assert.equal(event.supportActionPlan.eventScheduleVerified, false);
  assert.ok(event.supportActionPlan.limitations.some(text => text.includes('이벤트')));
  assert.throws(() => buildHifRoute(catalog, 'dance', { ...options, supportActionMode: 'invented' }), /supportActionMode/);
});

test('level-gated enhancement events contribute to generic enhancement synergy, never an invented mental target', () => {
  const route = { counts: {}, perAxis: {}, parameterBonusRows: [] };
  const card = { events: [{ release: 'lv40', effect_type: 'card_enhance' }] };
  const receiver = { levelAbilities: [], events: [] };
  const ability = { kind: 'skill_enhance', activationLimit: 0, effects: [{ type: 'ProduceEffectType_DanceAddition', min: 7, max: 7 }] };
  const below = calculateHifSupport(card, [], 39, route, 'anomaly');
  const unlocked = calculateHifSupport(card, [], 40, route, 'anomaly');
  const profile = calculateHifSupport(receiver, [ability], 40, route, 'anomaly');
  const context = { route, statCaps: {}, initialStats: { vocal: 0, dance: 0, visual: 0 } };
  assert.equal(evaluateHifDeck([below, profile], context).cappedStats.dance, 0);
  assert.equal(evaluateHifDeck([unlocked, profile], context).cappedStats.dance, 7);
  assert.equal(unlocked.providedActions.m_skill_enhance, undefined);
});
