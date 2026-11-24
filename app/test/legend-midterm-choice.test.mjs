import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildLegendMidtermChoice } from '../lib/legend-midterm-choice.mjs';

const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
const [A, B, C] = ['p_card-01-act-100_004', 'p_card-01-act-100_003', 'p_card-01-men-100_001'];
const context = { catalog, scenario: 'hajime', difficulty: 'legend', trainingType: 'concentration',
  deckCardIds: [catalog.skillAdvice.cards.find(card => card.plan === 'sense' && card.sourceType === 'default').gameId] };
const choose = (observation, settings) => buildLegendMidtermChoice({ ...context, ...settings, observation });

test('same deck follows fresh midterm offers A/B then B/C', () => {
  const initial = choose({ midtermPassed: true, offeredCardIds: [A, B] });
  const next = choose({ midtermPassed: true, offeredCardIds: [B, C] });
  assert.equal(initial.recommended.gameId, A);
  assert.equal(next.recommended.gameId, B);
  assert.deepEqual(next.candidates.map(card => card.gameId), [B, C]);
  assert.equal(choose({ midtermPassed: true, offeredCardIds: [C, B] }).recommended.gameId, B);
});

test('only a passed Hajime LEGEND midterm opens the choice', () => {
  const passed = { midtermPassed: true, offeredCardIds: [A] };
  for (const settings of [{ difficulty: 'regular' }, { difficulty: 'pro' }, { difficulty: 'master' }, { scenario: 'nia' }, { scenario: 'hif' }]) {
    assert.equal(choose(passed, settings).status, 'inactive');
    assert.equal(choose(passed, settings).recommended, null);
  }
  assert.equal(choose({ ...passed, midtermPassed: false }).status, 'inactive');
});

test('legacy, incomplete or unrecognized observations yield no candidate', () => {
  const otherPlan = 'p_card-02-act-100_009', hifStar = 'p_card-01-ido-100_039';
  for (const observation of [undefined, { offeredCardIds: [A] }, { midtermPassed: true },
    { midtermPassed: true, offeredCardIds: [] }, { midtermPassed: true, offeredCardIds: ['unknown', otherPlan, hifStar] }]) {
    assert.equal(choose(observation).status, 'unknown');
    assert.deepEqual(choose(observation).candidates, []);
  }
  assert.equal(choose({ midtermPassed: true, offeredCardIds: [A] }, { difficulty: null }).status, 'unknown');
});

test('form edits replace old offers, resolve Korean and Japanese card names, and preserve unknown exam state', () => {
  const ui = vm.createContext({ ui: { skillVisualCatalog: catalog.skillCards } });
  vm.runInContext(readFileSync(new URL('../web/legend-midterm.js', import.meta.url), 'utf8'), ui);
  const fields = { '[data-legend-passed]': { value: 'yes' }, '[data-legend-offers]': { value: '最高傑作\n무대의 지배자' },
    '[data-legend-deck]': { value: context.deckCardIds[0] } };
  const read = () => ui.readLegendMidtermInputs({ querySelector: key => fields[key] });
  assert.equal(choose(read()).recommended.gameId, A);
  fields['[data-legend-offers]'].value = '무대의 지배자, 완전무결';
  assert.equal(choose(read()).recommended.gameId, B);
  fields['[data-legend-passed]'].value = '';
  assert.equal(choose(read()).status, 'unknown');
});
