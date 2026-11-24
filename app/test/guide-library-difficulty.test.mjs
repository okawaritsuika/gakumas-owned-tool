import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const decks = JSON.parse(read('../data/catalog/deck_guides.json'));
const events = JSON.parse(read('../data/catalog/scenario_events.json'));
const script = read('../web/guides.js');
const html = read('../web/index.html');
const node = { addEventListener() {} };
const ui = vm.createContext({
  document: { querySelector: () => node, querySelectorAll: () => [] },
  $: () => node, array: value => Array.isArray(value) ? value : [],
});
vm.runInContext(script, ui);

test('ordinary Hajime overview uses the exam weeks of the selected difficulty',()=>{
  for (const [difficulty,midterm,final] of [['regular',6,13],['pro',7,16],['master',8,18],['legend',10,18]]) {
    assert.match(ui.scenarioWalkthrough('hajime',difficulty)[0][1],new RegExp(midterm+'주차에 중간시험, '+final+'주차에 최종시험'));
  }
  assert.doesNotMatch(ui.scenarioWalkthrough('hajime','')[0][1],/\d+주차/);
});

test('guide library shows Pro and Master guides before general references', () => {
  assert.match(html, /<select id="guideDifficulty"[^>]*>[^<]*<option[\s\S]*?<\/select>/);
  for (const scenario of ['nia', 'hajime']) {
    const rows = decks.guides.filter(row => row.scenario === scenario || row.scenario === 'common');
    for (const difficulty of ['pro', 'master']) {
      const result = ui.guideRowsForDifficulty(rows, difficulty);
      assert.equal(result[0].difficulty, difficulty);
      assert.ok(result.every(row => !row.difficulty || row.difficulty === difficulty));
      assert.ok(result.find(row => row.scenario === 'common'));
      assert.ok(result[0].opening.length && result[0].midgame.length && result[0].finish.length);
      assert.ok(result[0].sourceIds.every(id => decks.sources.find(source => source.id === id)));
    }
  }
});

test('NIA Master and Pro events appear on the first page of their own filters', () => {
  const rows = events.events.filter(row => row.scenario === 'nia');
  for (const difficulty of ['pro', 'master']) {
    const result = ui.guideRowsForDifficulty(rows, difficulty);
    assert.ok(result.length > 24);
    assert.ok(result.slice(0, 24).every(row => ui.guideRowDifficulty(row) === difficulty));
    assert.ok(result.every(row => !ui.guideRowDifficulty(row) || ui.guideRowDifficulty(row) === difficulty));
  }
});

test('初 keeps unspecified events distinct from Master and Legend variants', () => {
  const rows = events.events.filter(row => row.scenario === 'hajime');
  const master = ui.guideRowsForDifficulty(rows, 'master');
  assert.equal(ui.guideRowDifficulty(master[0]), 'master');
  assert.ok(master.some(row => !ui.guideRowDifficulty(row)));
  const pro = ui.guideRowsForDifficulty(rows, 'pro');
  assert.ok(pro.every(row => !ui.guideRowDifficulty(row) || ui.guideRowDifficulty(row) === 'pro'));
});
