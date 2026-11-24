import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../lib/catalog.mjs';
import { declaredProduceActionCounts, withDeclaredProduceActions } from '../lib/produce-action-counts.mjs';
import { calculateHifSupport } from '../lib/hif-model.mjs';

const catalog = loadCatalog();
const empty = () => ({ vocal: 0, dance: 0, visual: 0 });
const route = () => ({ counts: { consult: 2 }, perAxis: {}, parameterBonusRows: [], stages: {
  selection: { counts: { consult: 1 }, perAxis: {} }, final: { counts: { consult: 1 }, perAxis: {} },
} });
test('only completed acquisition and management opportunities trigger their own support bonuses', () => {
  const card = catalog.skillCards.find(card => card.nameJa === 'アッチェレランド' && card.upgradeCount === 0);
  const actions = [{ action: 'acquire', gameId: card.gameId, fromExamIndex: 1, venue: 'consult' },
    { action: 'upgrade', gameId: card.gameId, upgradeCount: 1, fromExamIndex: 3, venue: 'consult' }];
  const before = withDeclaredProduceActions(route(), actions, catalog, { examIndex: 0 });
  assert.equal(before.counts.skill_acquire, 0);
  const selection = declaredProduceActionCounts(actions, catalog, { examIndex: 1 });
  assert.equal(selection.a_skill_acquire, 1);
  assert.equal(selection.consult_skill_card_acquire, 1);
  assert.equal(selection.skill_enhance, 0);
  const final = withDeclaredProduceActions(route(), actions, catalog, { examIndex: 3 });
  assert.equal(final.counts.consult, 2);
  assert.equal(final.counts.a_skill_enhance, 1);
  assert.equal(final.stages.selection.counts.skill_acquire, 1);
  assert.equal(final.stages.final.counts.skill_enhance, 1);
  const abilities = [{ kind: 'consult_skill_card_acquire', activationLimit: 2,
    effects: [{ type: 'ProduceEffectType_VisualAddition', min: 23, max: 23 }] }];
  assert.deepEqual(calculateHifSupport({}, abilities, 60, before, 'anomaly').fixedStats, empty());
  assert.equal(calculateHifSupport({}, abilities, 60, final, 'anomaly').fixedStats.visual, 23);
});

test('0099 counts actual basic changes and earlier 15-card exams without granting its own exam reward', () => {
  const card = catalog.supportCards.find(card => card.gameId === 's_card-3-0099');
  const latest = new Map();
  for (const row of card.levelAbilities) if (row.level <= 60) latest.set(row.order, row);
  const relevant = [...latest.values()].filter(row => ['basic_card_change', 'exam_15'].includes(row.kind));
  const actions = [{ action: 'change', basicCard: true, fromExamIndex: 1 },
    { action: 'change', basicCard: false, fromExamIndex: 3 },
    { action: 'change', basicCard: true, fromExamIndex: 4 }];
  const original = route(), before = structuredClone(original);
  const early = withDeclaredProduceActions(original, actions, catalog, { examIndex: 1, examDeckSizes: [14, 16, 16, 20, 22] });
  assert.equal(early.counts.exam_15, 0);
  assert.equal(calculateHifSupport({ ...card, events: [], p_item: null }, relevant, 60, early, 'anomaly').fixedStats.visual, 39);
  const late = withDeclaredProduceActions(original, actions, catalog, { examIndex: 4, examDeckSizes: [14, 16, 16, 20, 22] });
  assert.equal(late.counts.exam_15, 3);
  assert.equal(late.counts.basic_card_change, 2);
  assert.equal(calculateHifSupport({ ...card, events: [], p_item: null }, relevant, 60, late, 'anomaly').fixedStats.visual, 39 * 2 + 37 * 3);
  assert.deepEqual(original, before);
});

test('keyword acquisitions and upgrades use the exact variant native groups or explicit keywords', () => {
  const native = { skillCards: [
    { gameId: 'native', upgradeCount: 0, effectGroupIds: ['effect_group-visible-exam_preservation-000'] },
    { gameId: 'native', upgradeCount: 1, effectGroupIds: ['effect_group-visible-exam_full_power-000'] },
    { gameId: 'plain', upgradeCount: 0, effectGroupIds: [] },
  ] };
  const actions = [
    { action: 'acquire', gameId: 'native', upgradeCount: 0, fromExamIndex: 1, quantity: 2 },
    { action: 'acquire', gameId: 'plain', fromExamIndex: 1 },
    { action: 'upgrade', gameId: 'native', upgradeCount: 1, fromExamIndex: 3 },
    { action: 'acquire', keywords: ['goodConditionTurns', 'concentration'], fromExamIndex: 4 },
  ];
  const before = JSON.stringify(actions), counts = declaredProduceActionCounts(actions, native, { examIndex: 3 });
  assert.equal(counts.reserve_card_acquire, 2);
  assert.equal(counts.full_power_card_acquire, 0);
  assert.equal(counts.full_power_card_enhance, 1);
  assert.equal(counts.reserve_card_enhance, 0);
  assert.equal(counts.good_condition_card_acquire, 0);
  const final = declaredProduceActionCounts(actions, native);
  assert.equal(final.good_condition_card_acquire, 1);
  assert.equal(final.concentration_card_acquire, 1);
  assert.equal(JSON.stringify(actions), before);
});

test('unknown keyword identity and missing upgraded variant remain uncalculated instead of zero', () => {
  const native = { skillCards: [{ gameId: 'native', upgradeCount: 0, effectGroupIds: ['effect_group-visible-exam_full_power-000'] }] };
  for (const action of [
    { gameId: 'native', upgradeCount: 1 },
    { gameId: 'missing', name: '全力' },
    { keywords: ['unrecognized_keyword'] },
  ]) {
    const counts = declaredProduceActionCounts([{ ...action, action: 'acquire', fromExamIndex: 0 }], native);
    assert.equal(counts.full_power_card_acquire, null);
    assert.equal(counts.good_condition_card_acquire, null);
  }
  assert.equal(declaredProduceActionCounts([{ action: 'acquire', keywords: [], fromExamIndex: 0 }], native).full_power_card_acquire, 0);
});

test('eight-card thresholds count any acquisition only with explicit matching keyword deck counts', () => {
  const actions = [
    { action: 'acquire', keywords: [], fromExamIndex: 1, keywordCardCountsAtTrigger: { fullPower: 7 } },
    { action: 'acquire', keywords: [], fromExamIndex: 2, keywordCardCountsAtTrigger: { fullPower: 8 } },
    { action: 'acquire', keywords: ['reserve'], fromExamIndex: 3, quantity: 2, keywordCardCountsAtTrigger: { fullPower: 9 } },
  ];
  const current = declaredProduceActionCounts(actions, catalog, { examIndex: 2 });
  assert.equal(current.full_power_card_acquire_8, 1);
  assert.equal(current.full_power_card_acquire, 0);
  const final = declaredProduceActionCounts(actions, catalog, { stage: 'final' });
  assert.equal(final.full_power_card_acquire_8, 2);
  assert.equal(final.reserve_card_acquire, 2);
  const noKeywordCount = declaredProduceActionCounts([{ action: 'acquire', keywords: [], beforeDeckSize: 30, fromExamIndex: 0 }], catalog);
  assert.equal(noKeywordCount.full_power_card_acquire_8, null);
  const unknownBatch = declaredProduceActionCounts([{ action: 'acquire', keywords: ['fullPower'], quantity: 2,
    keywordCardCountsAfter: { fullPower: 8 }, fromExamIndex: 1 }], catalog);
  assert.equal(unknownBatch.full_power_card_acquire_8, null);
  const unknownProfile = calculateHifSupport({}, [{ kind: 'full_power_card_acquire_8', effects: [
    { type: 'ProduceEffectType_VocalAddition', min: 16, max: 16 },
  ] }], 40, { ...route(), counts: noKeywordCount }, 'anomaly');
  assert.ok(unknownProfile.unscored.some(reason => reason.includes('경로 기본 횟수 미확인')));
});

test('SP twenty-card checks use the declared lesson state and preserve exam and stage cutoffs', () => {
  const input = route();
  input.selections = [
    { week: 2, main: 'vocal', fromExamIndex: 0, stage: 'selection' },
    { week: 9, main: 'dance', fromExamIndex: 1, stage: 'selection' },
    { week: 23, main: 'dance', fromExamIndex: 3, stage: 'final' },
  ];
  const actions = [
    { action: 'lesson_end', week: 2, fromExamIndex: 0, isSpLesson: true, beforeDeckSize: 19 },
    { action: 'lesson_end', week: 9, fromExamIndex: 1, isSpLesson: true, beforeDeckSize: 20 },
    { action: 'lesson_end', week: 23, fromExamIndex: 3, isSpLesson: true, beforeDeckSize: 22 },
  ];
  const original = structuredClone(input);
  const early = withDeclaredProduceActions(input, actions, catalog, { examIndex: 1 });
  assert.equal(early.counts.sp_lesson_20, 1);
  assert.equal(early.stages.final.counts.sp_lesson_20, 0);
  const final = withDeclaredProduceActions(input, actions, catalog, { examIndex: 3 });
  assert.equal(final.counts.sp_lesson_20, 2);
  assert.equal(final.stages.selection.counts.sp_lesson_20, 1);
  assert.equal(final.stages.final.counts.sp_lesson_20, 1);
  assert.equal(withDeclaredProduceActions(input, actions.slice(0, 1), catalog, { examIndex: 1 }).counts.sp_lesson_20, null);
  assert.deepEqual(input, original);
});

test('exam deck-size input works without management actions and incomplete sizes stay unknown', () => {
  const input = route();
  const exact = withDeclaredProduceActions(input, undefined, catalog, { examIndex: 4, examDeckSizes: [14, 15, 20, 16] });
  assert.equal(exact.counts.exam_15, 3);
  assert.equal(exact.stages.selection.counts.exam_15, 2);
  assert.equal(exact.stages.final.counts.exam_15, 1);
  assert.ok(!Object.hasOwn(exact.counts, 'delete'));
  const incomplete = withDeclaredProduceActions(input, undefined, catalog, { examIndex: 4, examDeckSizes: [20, 20] });
  assert.equal(incomplete.counts.exam_15, null);
  assert.equal(incomplete.stages.selection.counts.exam_15, null);
  assert.equal(incomplete.stages.final.counts.exam_15, null);
});

test('unidentified acquisitions keep category and rarity totals unknown instead of zero', () => {
  const actions = [
    { action: 'acquire', category: 'active', rarity: 'SSR', keywords: [], quantity: 2, fromExamIndex: 0 },
    { action: 'acquire', type: 'trouble', rarity: 'N', keywords: [], fromExamIndex: 0 },
  ];
  const known = declaredProduceActionCounts(actions, { skillCards: [] });
  assert.equal(known.skill_acquire, 3);
  assert.equal(known.a_skill_acquire, 2);
  assert.equal(known.m_skill_acquire, 0);
  assert.equal(known.ssr_card_acquire, 2);
  const partial = declaredProduceActionCounts([...actions, { action: 'acquire', fromExamIndex: 1 }], { skillCards: [] });
  assert.equal(partial.skill_acquire, 4);
  assert.equal(partial.a_skill_acquire, null);
  assert.equal(partial.m_skill_acquire, null);
  assert.equal(partial.ssr_card_acquire, null);
  assert.equal(partial.full_power_card_acquire, null);
  const rareOnly = declaredProduceActionCounts([{ action: 'acquire', rarity: 'SR', fromExamIndex: 0 }], { skillCards: [] });
  assert.equal(rareOnly.ssr_card_acquire, 0);
  assert.equal(rareOnly.a_skill_acquire, null);
});

test('unknown upgrade and removal types remain unknown while exact catalog types can be counted', () => {
  const native = { skillCards: [{ gameId: 'mental', upgradeCount: 1, type: 'mental', rarity: 'SR', effectGroupIds: [] }] };
  const known = declaredProduceActionCounts([{ action: 'upgrade', gameId: 'mental', upgradeCount: 1, fromExamIndex: 1 },
    { action: 'remove', category: 'ProduceCardCategory_ActiveSkill', fromExamIndex: 1 }], native);
  assert.equal(known.m_skill_enhance, 1);
  assert.equal(known.a_skill_enhance, 0);
  assert.equal(known.a_skill_delete, 1);
  assert.equal(known.m_skill_delete, 0);
  const unknown = declaredProduceActionCounts([{ action: 'upgrade', fromExamIndex: 1 }, { action: 'remove', fromExamIndex: 1 }], native);
  assert.equal(unknown.skill_enhance, 1);
  assert.equal(unknown.delete, 1);
  assert.equal(unknown.a_skill_enhance, null);
  assert.equal(unknown.m_skill_enhance, null);
  assert.equal(unknown.a_skill_delete, null);
  assert.equal(unknown.m_skill_delete, null);
});

test('a generic change does not prove that no basic card was changed', () => {
  const exact = { skillCards: [{ gameId: 'basic', upgradeCount: 0, sourceType: 'default' },
    { gameId: 'nonbasic', upgradeCount: 0, sourceType: 'produce' }] };
  const known = declaredProduceActionCounts([
    { action: 'change', gameId: 'basic', fromExamIndex: 1 },
    { action: 'change', gameId: 'nonbasic', fromExamIndex: 1 },
  ], exact);
  assert.equal(known.change, 2);
  assert.equal(known.basic_card_change, 1);
  const unknown = declaredProduceActionCounts([{ action: 'change', fromExamIndex: 1 }], exact);
  assert.equal(unknown.change, 1);
  assert.equal(unknown.basic_card_change, null);
});
