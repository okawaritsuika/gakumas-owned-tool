import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function browserModel() {
  const values = Object.fromEntries(Object.entries({ skillAdviceScenario: 'hif', skillAdviceDifficulty: '',
    skillAdviceType: 'goodConditionTurns', skillAdviceLevel: '80', skillAdviceUpgrade: '1',
    skillAdvicePurpose: 'acquisition', skillAdviceStage: 'any', skillAdviceIdol: '',
    skillAdviceStrategy: 'general', skillAdviceLegend: '' }).map(([id, value]) => [id, { value }]));
  const context = vm.createContext({ $: id => values[id], number: value => value === '' ? null : Number(value),
    array: value => Array.isArray(value) ? value : [], escapeHtml: value => String(value), plainGameText: value => String(value) });
  vm.runInContext(fs.readFileSync(new URL('../web/skill-advice.js', import.meta.url), 'utf8'), context);
  const run = source => vm.runInContext(source, context);
  const read = source => JSON.parse(run(`JSON.stringify(${source})`));
  run("skillAdvice.selectedId = 'p_card-01-act-2_059'; skillAdvice.conditions.set(skillAdviceConditionKey(), {customizationState:'matched',hifAbilityState:'matched'});");
  return { values, context, run, read };
}

test('recipe declarations belong to the scenario, deck, purpose, upgrade and level where they were checked', () => {
  const { values, read } = browserModel();
  assert.equal(read('skillAdviceCurrentConditions()').customizationState, 'matched');
  for (const [id, changed] of [['skillAdviceScenario', 'hajime'], ['skillAdviceType', 'concentration'],
    ['skillAdvicePurpose', 'memory'], ['skillAdviceUpgrade', '0'], ['skillAdviceLevel', '71']]) {
    const previous = values[id].value;
    values[id].value = changed;
    assert.equal(read('skillAdviceCurrentConditions()').customizationState, 'unknown', id);
    values[id].value = previous;
    assert.equal(read('skillAdviceCurrentConditions()').customizationState, 'matched', id);
  }
});

test('cross-scenario comparisons clear declarations and never send a NIA strategy to HIF or Legend', () => {
  const { values, run, read } = browserModel();
  values.skillAdviceScenario.value = 'nia'; values.skillAdviceDifficulty.value = 'master';
  values.skillAdviceStrategy.value = 'inflation';
  run("skillAdvice.conditions.set(skillAdviceConditionKey(), {customizationState:'matched'});");
  const rows = read("skillAdviceComparisonInputs('scenario')");
  for (const { input } of rows) {
    assert.equal(input.strategy, input.scenario === 'nia' ? 'inflation' : 'general');
    assert.equal(input.customizationState, input.scenario === 'nia' ? 'matched' : 'unknown');
    if (input.scenario !== 'hajime') assert.equal(input.legendCardGameId, undefined);
  }
});

test('level and upgrade comparisons retain confirmation only for the original specification', () => {
  const { read } = browserModel();
  for (const { input } of read("skillAdviceComparisonInputs('level')")) {
    assert.equal(input.customizationState, input.producerLevel === 80 ? 'matched' : 'unknown');
  }
  for (const { input } of read("skillAdviceComparisonInputs('upgrade')")) {
    assert.equal(input.customizationState, input.upgradeCount === 1 ? 'matched' : 'unknown');
  }
});

test('same-scenario comparisons clear recipe declarations when the difficulty changes', () => {
  for (const [scenario, difficulty, targetDifficulty] of [['nia', 'pro', 'master'], ['hajime', 'pro', 'legend'],
    ['hajime', 'master', 'legend'], ['nia', 'master', 'master'], ['hajime', 'legend', 'legend']]) {
    const { values, run, read } = browserModel();
    values.skillAdviceScenario.value = scenario; values.skillAdviceDifficulty.value = difficulty;
    run("skillAdvice.conditions.set(skillAdviceConditionKey(), { customizationState:'matched', hifAbilityState:'matched', switchState:'enabled', acquisitionTimingState:'opening' });");
    const { input } = read("skillAdviceComparisonInputs('scenario')").find(row => row.input.scenario === scenario);
    assert.equal(input.difficulty, targetDifficulty);
    const unchanged = difficulty === targetDifficulty;
    for (const [key, confirmed] of Object.entries({ customizationState: 'matched', hifAbilityState: 'matched',
      switchState: 'enabled', acquisitionTimingState: 'opening' })) {
      assert.equal(input[key], unchanged ? confirmed : 'unknown', `${scenario}/${difficulty}/${key}`);
    }
  }
});

test('rental unlock metadata distinguishes its confirmed scope from owned memory imports', () => {
  const { run } = browserModel();
  const html = run('skillAdviceMetaMarkup({meta:{unlockProducerLevel:23,rentalUnlockProducerLevel:20}})');
  assert.match(html, /일반 획득 해금/);
  assert.match(html, /대여 해금 기준/);
  assert.match(html, /자기 보유.*미확정/);
  assert.doesNotMatch(html, /메모리 반입 조건/);
  const row = "{eligibility:{status:'blocked',reasons:['앱의 반입 PLv 비교 기준 미충족: 대여 해금값을 참조합니다. 자기 보유 적용은 미확정입니다.']}}";
  assert.match(run(`skillAdviceConditionBadge(${row})`), />앱 PLv 기준</);
  assert.equal(run(`skillAdviceEligibility(${row})`), '앱 PLv 비교 기준 미충족');
});

test('closing a skill dialog restores the current gallery button after related-card navigation', async () => {
  const { values, context, run } = browserModel();
  const events = {};
  let focused, buttons = [], previousButtons = [];
  for (const id of ['skillAdviceContent', 'skillAdviceDialog', 'skillAdviceForm', 'skillAdviceSearch',
    'skillAdvicePlanFilter', 'skillAdviceSourceFilter', 'skillAdviceRatingFilter', 'skillAdviceSort', 'skillAdviceMore']) {
    values[id] = { ...values[id], addEventListener: (type, listener) => { events[`${id}:${type}`] = listener; },
      focus: () => { focused = values[id]; } };
  }
  const dialog = values.skillAdviceDialog;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; events['skillAdviceDialog:close']?.(); };
  values.skillAdviceList = { querySelectorAll: () => buttons };
  context.renderSkillAdviceList = () => {
    previousButtons = buttons;
    buttons = ['origin', 'related'].map(id => ({ dataset: { skillAdviceCard: id }, focus() { focused = this; } }));
  };
  context.renderSkillAdviceDetail = () => {};
  run("skillAdvice.options = {cards:[{id:'origin'},{id:'related'}]}; skillAdvice.rows = [{id:'origin'},{id:'related'}]; bindSkillAdviceEvents();");
  await run("selectSkillAdviceCard('origin')");
  await run("selectSkillAdviceCard('related')");
  assert.equal(dialog.open, true);
  dialog.close();
  assert.equal(focused, buttons[0]);
  assert.ok(!previousButtons.includes(focused));
});

test('a late detail response rebuilding the gallery keeps the restored card focused', () => {
  const { values, context, run } = browserModel();
  let buttons;
  context.document = { activeElement: null };
  const makeButton = () => ({ dataset: { skillAdviceCard: 'origin' }, focus() { context.document.activeElement = this; } });
  buttons = [makeButton()];
  const previous = buttons[0];
  context.document.activeElement = previous;
  values.skillAdviceList = { setAttribute() {}, classList: { toggle() {} },
    contains: element => buttons.includes(element), querySelectorAll: () => buttons,
    set innerHTML(value) { buttons = [makeButton()]; context.document.activeElement = null; } };
  for (const id of ['skillAdviceCollectionTitle', 'skillAdviceResultCount', 'skillAdviceEvidenceCoverage', 'skillAdviceMore']) values[id] = {};
  values.skillAdviceSourceFilter = { value: 'all' };
  context.visualFrame = () => '';
  context.assetUrl = () => '';
  context.skillAdviceFilteredRows = () => [{ id: 'origin', name: '원래 카드' }];
  run("skillAdvice.options = {cards:[{id:'origin'}]}; renderSkillAdviceList();");
  assert.equal(context.document.activeElement, buttons[0]);
  assert.notEqual(context.document.activeElement, previous);
});
