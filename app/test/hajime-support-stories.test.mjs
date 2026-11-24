import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { evaluateHajimeProSupportStories } from '../lib/hajime-support-stories.mjs';

const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog/', import.meta.url)) });
const card = id => catalog.supportCards.find(row => row.gameId === id);
const run = (id, level, options = {}) => evaluateHajimeProSupportStories(card(id), level, { plan: 'anomaly', ...options });

test('an unlocked direct reward uses the boost from the current card level', () => {
  const starter = 's_card-1-0000';
  assert.equal(run(starter, 1).stats.visual, 10);
  assert.equal(run(starter, 19).resources.pp, 0);
  assert.equal(run(starter, 20).resources.pp, 10);
  assert.equal(run(starter, 40).stats.visual, 20);
  assert.equal(run(starter, 40).resources.pp, 10);
  assert.equal(run(starter, 40).status, 'conditional_unlocked_story_rewards');
  const disabled = run(starter, 40, { includeSupportEvents: false });
  assert.equal(disabled.status, 'disabled');
  assert.equal(disabled.scoredEffects, 0);
});

test('PP and nominal recovery use their own multiplier and round down', () => {
  assert.equal(run('s_card-3-0100', 19).resources.pp, 0);
  assert.equal(run('s_card-3-0100', 20).resources.pp, 40);
  assert.equal(run('s_card-3-0100', 60).resources.pp, 80);
  assert.equal(run('s_card-3-0019', 40).resources.stamina, 10);
  assert.equal(run('s_card-3-0019', 60).resources.stamina, 14);
  // The trainer's P-item and enhancement do not have a fixed point value.
  assert.equal(run('s_card-3-0100', 60).unscoredEffects, 2);
});

test('unknown amounts, release conditions and variable boosts cannot earn fixed rewards', () => {
  const source = card('s_card-1-0000');
  const ability = source.levelAbilities.find(row => row.kind === 'event_boost');
  const testCard = {
    gameId: 'unreviewed-support',
    levelAbilities: [{ ...ability, effects: [{ ...ability.effects[0], min: 100, max: 300 }] }],
    events: [
      { release: 'initial', effect_type: 'param_boost', param_type: 'visual', param_value: 10 },
      { release: 'initial', effect_type: 'pp_gain' },
      { release: 'unknown', effect_type: 'hp_recovery', param_value: 5 },
      { release: 'lv80', effect_type: 'param_boost', param_type: 'dance', param_value: 100 },
    ],
  };
  const result = evaluateHajimeProSupportStories(testCard, 40, { plan: 'logic' });
  assert.equal(result.scoredEffects, 0);
  assert.equal(result.unscoredEffects, 3);
  assert.equal(result.stats.visual, 0);
  assert.deepEqual(result.resources, { pp: 0, stamina: 0 });
});
