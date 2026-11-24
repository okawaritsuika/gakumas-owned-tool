import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../lib/recommend.mjs';

function scenario(spec, extraOptions = {}) {
  const kinds = [['vo', 'VocalAddition', 1], ['da', 'DanceAddition', 1], ['vo9', 'VocalAddition', 9],
    ['da8', 'DanceAddition', 8], ['vo4', 'VocalAddition', 4], ...['Vocal', 'Dance', 'Visual'].map(axis => [axis, axis + 'GrowthRateAddition', 250])];
  const abilities = kinds.map(([id, type, value]) => ({ id, level: 1, produceSkillId: id, produceSkillLevel: 1,
    isUniqueActivation: spec.some(row => row.bonuses) && ['vo','da'].includes(id), restrictions: { plan: 'free' }, branches: [{ produceEffectId: id, produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }] }));
  const catalog = { supportCards: [], idolCards: [], skillCards: [...new Set(spec.map(row => row.skill))].map(id => ({
    gameId: id, name: id, plan: 'free', upgradeCount: 0, rentalUnlockProducerLevel: 1, actions: '' })),
    memoryAbilities: abilities, memoryMechanicsGraph: { ProduceEffect: kinds.map(([id, type, value]) => ({
      id, produceEffectType: 'ProduceEffectType_' + type, effectValueMin: value, effectValueMax: value })), ProduceTrigger: [] },
    calculationModels: {}, excelPresets: [] };
  const memories = spec.map(({ skill, growth, custom, phase, bonuses }, i) => ({ id: 'memory-' + i, produceCardPhaseType: phase ?? 2,
    produceCard: { id: skill, upgradeCount: 0, customizes: custom ? [{ id: custom, customizeCount: 1 }] : [] },
    abilities: (bonuses ?? (growth ? ['vo','Vocal','Dance','Visual'] : ['vo'])).map(id => ({ id, level: 1 })) }));
  return recommend({ catalog, inventory: { producerLevel: 70, memories }, options: { scenario: 'hif', plan: 'anomaly',
    targetAttribute: 'vocal', secondaryAttribute: 'dance', activityFocus: 'consult', deckTemplate: '4-2',
    memorySelectionMode: 'stats', compareSupportUpgrades: false, baseLessonGains: { vocal: 1, dance: 1, visual: 1 }, ...extraOptions } });
}
for (const copies of [12, 13]) test('four slots despite ' + copies + ' high-ranked copies of one skill', () => {
  // Exercise both the observed total-inventory boundary and the case where
  // this many copies alone can occupy the entire original ranked pool.
  for (const repeatCount of [copies - 3, copies]) {
    const result = scenario([...Array.from({ length: repeatCount }, () => ({ skill: 'a' })), ...['b','c','d'].map(skill => ({ skill }))]);
    assert.deepEqual(result.memories.map(m => m.modelEffects.carriedSkill.id).sort(), ['a','b','c','d']);
  }
});
test('deficit is reported only after all eligible memories and duplicate exceptions are checked', () => {
  const input = [...Array.from({ length: 13 }, () => ({ skill: 'a' })), { skill: 'b' }, { skill: 'c' }];
  const partial = scenario(input);
  assert.equal(partial.memories.length, 3);
  assert.match(partial.warnings.join(' '), /메모리.*4장.*부족/);
  const full = scenario(input, { allowDuplicateMemorySkillIds: ['a'] });
  assert.equal(full.memories.length, 4);
  assert.equal(new Set(full.memories.map(row => row.id)).size, 4);
});
test('four complementary growth copies survive partial scores, matching exhaustive four-slot search', () => {
  // Individually and in triples the growth contributes zero after flooring.
  // Only the four late-sorting growth variants earn one additional point on every axis.
  const input = Array.from({ length: 12 }, (_, i) => ({ skill: String(i).padStart(2, '0'), growth: i >= 8 }));
  const result = scenario(input);
  let bestScore = -Infinity, bestSkills = [];
  for (let a = 0; a < 9; a++) for (let b = a+1; b < 10; b++) for (let c = b+1; c < 11; c++) for (let d = c+1; d < 12; d++) {
    const group = [a,b,c,d].map(i => input[i]);
    const score = 4 + 3 * Math.floor(group.filter(row => row.growth).length * 250 / 1000);
    if (score > bestScore) { bestScore = score; bestSkills = group.map(row => row.skill); }
  }
  assert.equal(bestScore, 7);
  assert.deepEqual(result.memories.map(row => row.modelEffects.carriedSkill.id).sort(), bestSkills);
});
test('a late same-skill variant with different customs and phase can complete the highest scoring quartet', () => {
  const input = [...Array.from({ length: 13 }, () => ({ skill: 'a' })), { skill: 'a', growth: true, phase: 1, custom: 'variant' },
    ...['b','c','d'].map(skill => ({ skill, growth: true }))];
  const result = scenario(input);
  assert.equal(result.memories.length, 4);
  const a = result.memories.find(row => row.modelEffects.carriedSkill.id === 'a').modelEffects.carriedSkill;
  assert.equal(a.phase.code, 1);
  assert.equal(a.customizes[0].id, 'variant');
});
test('the 11-copy capped-axis counterexample selects the Da +8 copy for a contribution of 20', () => {
  const input = [...Array.from({ length: 4 }, () => ({ skill: 'a', bonuses: ['vo9'] })), { skill: 'a', bonuses: ['da8'] },
    ...['b','c','d','e','f','g'].map(skill => ({ skill, bonuses: ['vo4'] }))];
  const caps = { vocal: 3018, dance: 3099, visual: 3099 };
  const result = scenario(input, { baseLessonGains: { vocal: 0, dance: 0, visual: 0 }, initialStats: { vocal: 3000, dance: 3000, visual: 3000 },
    statCaps: caps, selectionStatCaps: caps });
  const stats = result.memories.map(m => m.modelEffects.initialStats);
  assert.equal(Math.min(18, stats.reduce((n, row) => n + row.vo, 0)) + stats.reduce((n, row) => n + row.da, 0), 20);
});
test('a larger bounded search reopens every slot to variants outside its ranking seeds', () => {
  const input = [...Array.from({ length: 25 }, (_, i) => ({ skill: 'a', custom: 'custom-' + i, bonuses: ['vo9'] })),
    { skill: 'a', phase: 1, bonuses: ['da8'] }, ...['b','c','d'].map(skill => ({ skill, bonuses: ['vo4'] }))];
  const caps = { vocal: 3018, dance: 3099, visual: 3099 };
  const result = scenario(input, { baseLessonGains: { vocal: 0, dance: 0, visual: 0 }, initialStats: { vocal: 3000, dance: 3000, visual: 3000 },
    statCaps: caps, selectionStatCaps: caps });
  assert.equal(result.memories.length, 4);
  assert.equal(result.memories.find(row => row.modelEffects.carriedSkill.id === 'a').modelEffects.initialStats.da, 8);
});
test('Hajime and NIA reconsider a high-ranked memory whose unique effects block two slots', () => {
  // The same two unique bonuses occur together on the strongest card and separately on two alternatives.
  for (const scenarioId of ['hajime', 'nia']) {
    const input = [{ skill: 'a', bonuses: ['vo','da'] }, { skill: 'b', bonuses: ['vo'] }, { skill: 'c', bonuses: ['da'] }, { skill: 'd', bonuses: [] }, { skill: 'e', bonuses: [] }];
    const result = scenario(input, { scenario: scenarioId });
    assert.deepEqual(result.memories.map(m => m.modelEffects.carriedSkill.id).sort(), ['b','c','d','e']);
  }
});
