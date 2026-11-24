import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { recommend } from '../lib/recommend.mjs';
import { resolveExcelSupportCounts } from '../lib/excel-support-counts.mjs';

const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
const routePreset = 'NIAマスター膨張：アノマリー';

test('supplied NIA counters retain acquisition, drinks, typed actions and exact exam scope', () => {
  const result = resolveExcelSupportCounts(catalog, { scenario: 'nia', routePreset });
  assert.equal(result.counts.skill_acquire, 24);
  assert.equal(result.counts.m_skill_acquire, 17);
  assert.equal(result.counts.ssr_card_acquire, 12);
  assert.equal(result.counts.p_drink_acquire, 16);
  assert.equal(result.counts.p_drink_exchange, 9);
  assert.equal(result.counts.a_skill_enhance, 4);
  assert.equal(result.counts.m_skill_delete, 3);
  assert.equal(result.counts.change, 3);
  assert.equal(result.counts.exam_end, 1); // P-item-only exam assumption is 3.
  assert.equal(result.counts.sp_lesson_20, 4);
  assert.equal(result.source.recalculated, false);
  assert.equal(result.source.actualAccountActionsConfirmed, false);
  assert.ok(result.source.cells.p_drink_acquire[0].sourceCell);
  assert.equal(result.counts.reserve_card_acquire_8, undefined);
});

test('zero, unavailable and fractional cached assumptions remain distinct', () => {
  const result = resolveExcelSupportCounts({ excelPresets: [{ name: 'NIA test', values: [
    { label: 'スキル獲得', value: 0 }, { label: 'Aスキル獲得', value: '未実装' },
    { label: 'Mスキル獲得', value: '' }, { label: 'Pドリンク獲得', value: '3.5' },
    { label: 'Pドリンク交換', value: -1 }, { label: '変換', value: 2 }, { label: 'チェンジ', value: 3 },
  ] }] }, { scenario: 'nia', routePreset: 'NIA test' });
  assert.equal(result.counts.skill_acquire, 0);
  assert.equal(result.counts.p_drink_acquire, 3.5);
  for (const kind of ['a_skill_acquire', 'm_skill_acquire', 'p_drink_exchange', 'change']) {
    assert.equal(Object.hasOwn(result.counts, kind), false);
    assert.ok(result.unconfirmed.some(row => row.kind === kind));
  }
});

test('an explicit unknown preset does not silently substitute NIA 通常 or cross into HIF', () => {
  assert.throws(() => resolveExcelSupportCounts(catalog, { scenario: 'nia', routePreset: 'missing' }), /routePreset/);
  assert.throws(() => resolveExcelSupportCounts(catalog, { scenario: 'nia', routePreset: '初マスター：通常（強化寄り）' }), /NIA/);
  assert.equal(resolveExcelSupportCounts(catalog, { scenario: 'nia' }).preset.name, 'NIA 通常');
  assert.equal(resolveExcelSupportCounts({}, { scenario: 'nia' }).source.status, 'preset_missing');
  const hif = resolveExcelSupportCounts(catalog, { scenario: 'hif', routePreset });
  assert.deepEqual(hif.counts, {});
  assert.equal(hif.preset, null);
  assert.equal(hif.source.status, 'not_applicable');
});

test('a current Lv40 zero-uncap support receives the supplied drink and SSR-acquisition contribution in NIA', () => {
  const inventory = { supportCards: [{ gameId: 's_card-3-0069', level: 40, uncap: 0 }] };
  const original = structuredClone(inventory);
  const result = recommend({ catalog, inventory, options: {
    scenario: 'nia', plan: 'anomaly', routePreset, targetAttribute: 'dance', rentalGameId: 's_card-3-0004',
  } });
  const card = result.supports.owned.find(row => row.gameId === 's_card-3-0069');
  assert.ok(card);
  assert.equal(card.level, 40);
  assert.equal(card.uncap, 0);
  assert.equal(result.scoreSummary.expectedCounts.ssr_card_acquire, 12);
  assert.equal(result.scoreSummary.expectedCounts.p_drink_acquire, 16);
  assert.equal(card.statContribution.dance, 222.8); // Before the missing counts: 98.8.
  assert.equal(result.scoreSummary.gameFinalScorePredicted, false);
  assert.deepEqual(inventory, original);
});
