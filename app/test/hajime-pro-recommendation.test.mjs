import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hajimeProRoutes } from '../lib/hajime-pro-route.mjs';
import { recommend } from '../lib/recommend.mjs';

const readData = name => JSON.parse(readFileSync(new URL('../data/catalog/' + name + '.json', import.meta.url)));
const routeData = { hajimeSchedule: readData('hajime_schedule'), hajimeProMenus: readData('hajime_pro_menus') };
const axes = ['vocal', 'dance', 'visual'];
const baseOptions = { scenario: 'hajime', difficulty: 'pro', plan: 'sense', targetAttribute: 'vocal', idolGameId: 'idol', rentalGameId: 'rental' };

function ability(kind, amount, type = 'VocalAddition', triggerId) {
  return { kind, level: 1, activationLimit: 0, effects: [{ type: 'ProduceEffectType_' + type, min: amount, max: amount, triggerId }] };
}

function card(gameId, ...abilities) {
  return { gameId, name: gameId, plan: 'free', maxLevels: {0: 40, 4: 60},
    levelAbilities: abilities.map((row, order) => ({ ...row, order })) };
}

function run(cards, options = {}, characterId = 'hkne') {
  const catalog = { ...routeData, supportCards: [...cards, card('rental')],
    idolCards: [{ gameId: 'idol', characterId, plan: 'sense' }], skillCards: [], memoryAbilities: [], excelPresets: [] };
  const inventory = { idolCards: [{ gameId: 'idol' }], supportCards: cards.map(({gameId}) => ({gameId, level: 1, uncap: 0})) };
  return recommend({ catalog, inventory, options: { ...baseOptions, ...options } });
}

test('PRO counts only legal actions for the selected idol and keeps unknown free weeks unscored', () => {
  for (const [characterId, consult, supply] of [['hkne', 2, 2], ['ttmr', 4, 0], ['unknown', undefined, undefined]]) {
    const result = run([], {}, characterId);
    const { expectedCounts: counts, hajimePro } = result.scoreSummary;
    assert.equal(result.scoreSummary.routeModelSource, 'hajime_pro_weekly_reference');
    assert.deepEqual([counts.consult, counts.activity_supply_gift], [consult, supply]);
    assert.deepEqual([counts.lesson_end, counts.normal_lesson_end, counts.sp_lesson_end, counts.class_work_end, counts.exam_end], [7, 1, 4, 3, 2]);
    assert.deepEqual(hajimePro.selections.filter(row => row.activity === 'intensive_lesson').map(row => row.week), [6, 15]);
    for (const row of hajimePro.selections.filter(row => [3, 5, 8, 14].includes(row.week))) {
      if (characterId === 'unknown') assert.equal(row.activity, null);
      else assert.ok(routeData.hajimeProMenus.byCharacter[characterId].weeks[row.week - 1].activities.includes(row.activity));
    }
  }
});

test('PRO uses weekly axis-specific bases and grants initial, class and exam effects once per activation', () => {
  const stat = card('stat', ability('parameter_bonus', 17, 'VisualGrowthRateAddition'),
    ability('initial_stat', 12), ability('class_work_end', 5, 'DanceAddition'), ability('exam_end', 7));
  const result = run([stat]), { hajimePro, routeBaseGains, routeClassGains } = result.scoreSummary;
  const maxima = {1:60, 4:90, 6:180, 10:170, 12:200, 13:220, 15:310};
  const other = {6:90, 15:145};
  let visualBonus = 0;
  const expectedBase = {vocal:0, dance:0, visual:0};
  for (const row of hajimePro.selections.filter(row => Object.hasOwn(maxima, row.week))) {
    for (const axis of axes) {
      const gain = axis === row.axis ? maxima[row.week] : other[row.week] ?? 0;
      expectedBase[axis] += gain;
      if (axis === 'visual') visualBonus += Math.floor(gain * 17 / 1000);
    }
  }
  assert.deepEqual(routeBaseGains, expectedBase);
  assert.equal(Object.values(routeClassGains).reduce((sum, x) => sum + x), 230);
  assert.deepEqual(result.supports.owned[0].statContribution, {vocal:26, dance:15, visual:visualBonus});
});

test('a focused Pro deck can compare all four available SP lessons on the requested axis', () => {
  const vocalSP = card('vocal-sp', ability('sp_lesson_end', 13, 'VocalAddition', 'p_trigger-end_lesson-lesson_vocal_sp'));
  const result = run([vocalSP]);
  assert.equal(result.supports.owned[0].statContribution.vocal, 52);
  assert.equal(result.scoreSummary.hajimePro.selections.filter(row => row.axis === 'vocal' && row.activity === 'sp_lesson').length, 4);
});

test('an eight-concentration gate is unscored until its actual trigger count is supplied and respects its activation cap', () => {
  const effect = ability('concentration_card_acquire_8', 11);
  const gated = card('gated', {...effect, activationLimit:2});
  const profile = options => run([gated], options).supports.owned[0];
  const unknown = profile({});
  assert.equal(unknown.statContribution.vocal, 0);
  assert.ok(unknown.unscoredEffects > 0);
  assert.equal(profile({expectedCounts:{skill_acquire:9}}).statContribution.vocal, 0);
  assert.equal(profile({expectedCounts:{concentration_card_acquire_8:3}}).statContribution.vocal, 22);
});

test('older and newly released supports compete on the same route contributions', () => {
  const anchors = Array.from({length:4}, (_, i) => card('anchor-' + i, ability('initial_stat', 1000)));
  const old = card('old', ability('initial_stat', 30));
  for (const [bonus, selected] of [[4, 'old'], [12, 'new']]) {
    const latest = { ...card('new', ability('sp_lesson_end', bonus)), numericalSource: 'live_public_master' };
    const result = run([...anchors, old, latest]);
    assert.equal(result.supports.rental.gameId, 'rental');
    assert.deepEqual(result.supports.owned.map(row => row.gameId).sort(), [...anchors.map(row => row.gameId), selected].sort());
  }
});

test('PRO scoring requires the ordinary Hajime PRO scenario', () => {
  assert.deepEqual(hajimeProRoutes(routeData, 'hkne', 'vocal', {eventModeId:'asari'}), []);
  const master = run([], {difficulty:'master'}), nia = run([], {scenario:'nia'});
  assert.equal(master.scoreSummary.hajimePro, undefined);
  assert.equal(master.scoreSummary.routeModelAvailable, true);
  assert.equal(master.scoreSummary.routeModelSource, 'hajime_master_weekly_perfect_reference');
  assert.equal(nia.scoreSummary.hajimePro, undefined);
  assert.equal(nia.scoreSummary.routeModelSource, 'user_excel_cached_reference');
});

test('Hajime and NIA explain a missing automatic rental when five owned cards qualify', () => {
  const cards = Array.from({length:5}, (_,i) => ({...card('owned-'+i), maxLevels:{0:40}}));
  for (const scenario of ['hajime','nia']) {
    const result = recommend({
      catalog:{...routeData,supportCards:cards,idolCards:[],skillCards:[],memoryAbilities:[],excelPresets:[]},
      inventory:{supportCards:cards.map(({gameId})=>({gameId,level:40,uncap:0}))},
      options:{scenario,plan:'sense'},
    });
    assert.equal(result.supports.owned.length,5);
    assert.equal(result.supports.rental,null);
    assert.match(result.warnings.join(' '),/대여.*최대 레벨/);
  }
});
