import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const appSource = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const postSource = fs.readFileSync(new URL('../web/post-memory.js', import.meta.url), 'utf8');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function browserModel() {
  const elements = new Map();
  for (const id of ['refreshButton', 'connectionBanner', 'connectionTitle', 'connectionMessage', 'collectorModeTitle',
    'collectorModeMessage', 'collectorStartButton', 'collectorStopButton', 'postMemoryResult', 'postMemoryStatus', 'postCompareButton', 'importFile']) {
    const classes = new Set(), listeners = {};
    elements.set(id, { innerHTML: '', textContent: '', hidden: false, disabled: false, listeners,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      addEventListener: (name, callback) => { listeners[name] = callback; } });
  }
  const calls = [];
  const context = vm.createContext({ $: id => elements.get(id) ?? null,
    ui: { state: { inventoryVersion: 'before', inventory: { memories: [{ id: 'copy', initial: 10 }] }, collectorMode: { mode: 'normal' } }, stateRequestEpoch: 0, fetching: null },
    array: value => Array.isArray(value) ? value : [], text: value => typeof value === 'string' ? value : '',
    recordsOf: key => context.ui.state?.inventory?.[key] ?? [],
    api: (path, options) => { const request = deferred(); calls.push({ path, options, ...request }); return request.promise; },
    document: { addEventListener() {}, querySelectorAll: () => [] },
    renderConnection() {}, renderInventory() {}, renderIdolOptions() {}, renderRecommendation() {}, recommendationUnderReview: () => false, toast() {} });
  vm.runInContext(appSource.slice(appSource.indexOf('function snapshotVersion()'), appSource.indexOf('\nfunction rarityOf(')), context);
  vm.runInContext(appSource.slice(appSource.indexOf('async function loadState('), appSource.indexOf('\nfunction detailFact(')), context);
  for (const prefix of ['const escapeHtml =', 'function nameOf(', 'function recordId(', 'function categoryStatus('])
    vm.runInContext(appSource.split('\n').find(line => line.startsWith(prefix)), context);
  vm.runInContext(postSource, context);
  const run = source => vm.runInContext(source, context);
  const read = source => JSON.parse(run(`JSON.stringify(${source})`));
  run("renderPostEntries = function() {}; postTarget = function() { return {}; }; postCandidates = function() { return []; }; renderPostResult = function(result) { $('postMemoryResult').innerHTML = result.status; };");
  return { context, elements, calls, run, read };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('collector success immediately displays its mode and an older state response cannot overwrite it', async () => {
  const model = browserModel(), { calls, elements, run, read } = model;
  const old = run('loadState()');
  const click = elements.get('collectorStartButton').listeners.click();
  assert.equal(calls[1].path, '/api/collector-mode');
  calls[1].resolve({ mode: 'collect', message: '수집 중' }); await flush();
  assert.equal(calls[2].path, '/api/state');
  assert.equal(read('ui.state.collectorMode.mode'), 'collect');
  assert.equal(elements.get('collectorStopButton').hidden, false);
  calls[0].resolve({ inventory: { memories: [{ id: 'copy', initial: 10 }] }, collectorMode: { mode: 'normal' } }); await old;
  assert.equal(read('ui.state.collectorMode.mode'), 'collect');
  assert.ok(run('ui.fetching !== null'));
  calls[2].resolve({ inventory: { memories: [{ id: 'copy', initial: 10 }] }, collectorMode: { mode: 'collect' } }); await click;
  assert.equal(read('ui.state.collectorMode.mode'), 'collect');
  assert.equal(run('ui.fetching'), null);
});

test('an obsolete failed state request cannot replace a newer successful state with an error banner', async () => {
  const { calls, elements, run, read } = browserModel();
  const old = run('loadState(true)'), fresh = run('loadState(false, true)');
  calls[1].resolve({ inventory: {}, collectorMode: { mode: 'normal' } }); await fresh;
  calls[0].reject(new Error('old failure')); await old;
  assert.equal(read('ui.state.collectorMode.mode'), 'normal');
  assert.notEqual(elements.get('connectionTitle').textContent, '연결을 확인하지 못했어요');
});

test('changed memory contents invalidate owned comparisons and refresh recipes without losing candidate fields', async () => {
  const { calls, elements, run, read } = browserModel();
  elements.set('postCandidateInputs', {});
  run("postMemoryUi.initialized=true; postMemoryUi.choices={ownedCustomRecipes:[{key:'recipe-0',skillId:'old'}]}; postMemoryUi.entries=[{id:'entry',label:'작성한 후보',customRecipe:'recipe-0',initial:{vo:'12',da:'0',vi:'0'}}]; postMemoryUi.result={status:'recommended'};");
  const refresh = run('loadState()');
  calls[0].resolve({ inventoryVersion: 'after', inventory: { memories: [{ id: 'copy', initial: 20 }] }, collectorMode: { mode: 'normal' } }); await refresh;
  assert.equal(read('postMemoryUi.result'), null);
  assert.equal(read('postMemoryUi.revision'), 1);
  assert.equal(read('postMemoryUi.entries[0].customRecipe'), 'unknown');
  assert.deepEqual(read('postMemoryUi.choices.ownedCustomRecipes'), []);
  assert.match(elements.get('postMemoryStatus').textContent, /보유 목록/);
  assert.equal(calls[1].path, '/api/post-produce-memory-options');
  calls[1].resolve({ ownedCustomRecipes: [{ key: 'recipe-0', skillId: 'new' }] }); await run('postMemoryUi.optionsLoading');
  assert.equal(read('postMemoryUi.entries[0].label'), '작성한 후보');
  assert.equal(read('postMemoryUi.entries[0].initial.vo'), '12');
  assert.equal(read('postMemoryUi.entries[0].customRecipe'), 'unknown');
  assert.equal(read('postMemoryUi.choices.ownedCustomRecipes[0].skillId'), 'new');
});

test('an unchanged inventory refresh preserves a comparison and avoids reloading recipe choices', async () => {
  const { calls, run, read } = browserModel();
  run("postMemoryUi.result={status:'recommended'};");
  const refresh = run('loadState()');
  calls[0].resolve({ inventoryVersion: 'before', inventory: { memories: [{ id: 'copy', initial: 10 }] }, collectorMode: { mode: 'normal' }, readAt: 'later' }); await refresh;
  assert.equal(read('postMemoryUi.result.status'), 'recommended');
  assert.equal(read('postMemoryUi.revision'), 0);
  assert.equal(calls.length, 1);
});

test('a comparison already in flight is ignored when the inventory changes', async () => {
  const { calls, run, read } = browserModel();
  const comparison = run('comparePostMemories()');
  run('invalidatePostMemoryInventory()');
  calls[0].resolve({ status: 'recommended' }); await comparison;
  assert.equal(read('postMemoryUi.result'), null);
});

test('options fetched before a second inventory change are never adopted', async () => {
  const { calls, run, read } = browserModel();
  const refresh = run('refreshPostMemoryOptions()');
  run('postMemoryUi.inventoryRevision++');
  calls[0].resolve({ ownedCustomRecipes: [{ key: 'stale' }] }); await flush();
  assert.equal(calls.length, 2);
  assert.equal(read('postMemoryUi.choices'), null);
  calls[1].resolve({ ownedCustomRecipes: [{ key: 'current' }] }); await refresh;
  assert.equal(read('postMemoryUi.choices.ownedCustomRecipes[0].key'), 'current');
});

test('an input edit while refreshed options are loading cancels the pending comparison', async () => {
  const { calls, run, read } = browserModel();
  run('postMemoryUi.optionsStale=true');
  const comparison = run('comparePostMemories()');
  run('markPostResultStale()');
  calls[0].resolve({ ownedCustomRecipes: [] }); await comparison;
  assert.equal(calls.length, 1);
  assert.equal(read('postMemoryUi.result'), null);
});

test('a failed options refresh leaves the existing form usable and asks for another attempt', async () => {
  const { calls, elements, run, read } = browserModel();
  run('postMemoryUi.initialized=true;postMemoryUi.optionsStale=true');
  const opening = run('openPostMemoryChoice()');
  calls[0].reject(new Error('다시 확인해 주세요.')); await opening;
  assert.equal(elements.get('postMemoryStatus').textContent, '다시 확인해 주세요.');
  assert.equal(read('postMemoryUi.initialized'), true);
  assert.equal(read('postMemoryUi.optionsStale'), true);
});

test('import success forces a fresh inventory read instead of reusing an older request', async () => {
  const { calls, elements, run, read } = browserModel();
  run(appSource.split('\n').find(line => line.startsWith("$('importFile').addEventListener")));
  const old = run('loadState()');
  const input = { value: 'fixture', files: [{ size: 2, text: async () => '{}' }] };
  const importing = elements.get('importFile').listeners.change({ target: input }); await flush();
  assert.equal(calls[1].path, '/api/import');
  calls[1].resolve({ ok: true }); await flush();
  assert.equal(calls[2]?.path, '/api/state');
  calls[0].resolve({ inventory: { memories: [{ id: 'copy', initial: 10 }] }, collectorMode: { mode: 'normal' } }); await old;
  calls[2].resolve({ inventoryVersion: 'imported', inventory: { memories: [{ id: 'copy', initial: 20 }] }, collectorMode: { mode: 'normal' } }); await importing;
  assert.equal(read('ui.state.inventory.memories[0].initial'), 20);
  assert.equal(read('postMemoryUi.revision'), 1);
  assert.equal(input.value, '');
});

test('new owned idols become post-memory targets while partial refreshes preserve the existing target and inputs', async () => {
  const { calls, elements, run, read } = browserModel();
  let markup = '<option value="">선택하지 않음</option><option value="old1">Old Idol</option>', selected = 'old1';
  const options = () => [...markup.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map(match => ({
    value: match[1], textContent: match[3], dataset: { postIdolName: /data-post-idol-name="([^"]*)"/.exec(match[2])?.[1] } }));
  const select = {};
  Object.defineProperties(select, { innerHTML: { get: () => markup, set: value => { markup = value; selected = ''; } },
    value: { get: () => selected, set: value => { selected = options().some(option => option.value === value) ? value : ''; } },
    options: { get: options }, selectedOptions: { get: () => options().filter(option => option.value === selected) } });
  elements.set('postTargetIdol', select);
  elements.set('postTargetLevel', { value: '66' });
  run("ui.state.inventory.idolCards=[{id:'old1',name:'Old Idol'}];postMemoryUi.initialized=true;postMemoryUi.entries=[{label:'My candidate',customRecipe:'none',initial:{vo:'123',da:'0',vi:'0'}}];");
  const refresh = async (idols, status) => {
    const request = run('loadState()'), call = calls.at(-1);
    call.resolve({ inventoryVersion: status + idols.map(idol => idol.id).join(','), inventory: { memories: [{ id: 'copy', initial: 10 }], idolCards: idols,
      collectionStatus: { idolCards: { status } } }, collectorMode: { mode: 'normal' } }); await request;
  };
  await refresh([{ id: 'old1', name: 'Old Idol' }, { id: 'new2', name: 'New Idol' }], 'complete');
  assert.ok(select.options.some(option => option.value === 'new2'));
  assert.equal(select.value, 'old1');
  await refresh([{ id: 'new2', name: 'New Idol' }], 'partial');
  assert.equal(select.value, 'old1');
  assert.match(select.selectedOptions[0].textContent, /이번 목록에서 미관측/);
  assert.doesNotMatch(select.selectedOptions[0].textContent, /미보유|보유 목록에 없음/);
  await refresh([{ id: 'new2', name: 'New Idol' }], 'complete');
  assert.equal(select.value, 'old1');
  assert.match(select.selectedOptions[0].textContent, /현재 보유 목록에 없음/);
  assert.doesNotMatch(select.selectedOptions[0].textContent, /이번 목록에서 미관측/);
  assert.equal(elements.get('postTargetLevel').value, '66');
  assert.equal(read('postMemoryUi.entries[0].label'), 'My candidate');
  assert.equal(read('postMemoryUi.entries[0].initial.vo'), '123');
});
