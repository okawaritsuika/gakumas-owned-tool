import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/memory-visuals.js', import.meta.url), 'utf8');
const skills = [
  { gameId: 'p_card-stack', internalId: 388, upgradeCount: 0, nameKo: '축적', nameJa: '積み重ね', imageUrl: '/assets/stack.png' },
  { gameId: 'p_card-stack', internalId: 389, upgradeCount: 1, nameKo: '축적+', nameJa: '積み重ね+', imageUrl: '/assets/stack-plus.png' },
  { gameId: 'p_card-reset', internalId: 160, upgradeCount: 0, nameKo: '다시 시작하기', nameJa: '仕切り直し', imageUrl: '/assets/reset.png' },
  { gameId: 'p_card-fly-sense', internalId: 700, nameKo: '날아올라라!', nameJa: '翔び立て！', imageUrl: '/assets/fly-sense.png' },
  { gameId: 'p_card-fly-anomaly', internalId: 779, nameKo: '날아올라라!', nameJa: '羽ばたけ！', imageUrl: '/assets/fly-anomaly.png' },
  { gameId: 'p_card-character', internalId: 638, nameKo: '넘쳐흐르는 마음', nameJa: 'あふれ出る想い', characterIconUrls: { kllj: '/assets/lillja.png', other: '/assets/other.png' } },
];
function runtime({ cards = skills, owned = [], fetch } = {}) {
  const context = { ui: { skillVisualCatalog: [...cards] }, recordsOf: () => owned,
    selectedVariant: () => ({ characterId: 'kllj' }), fetch };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test('native and public IDs select the exact family and upgrade while preferring Korean names', () => {
  const context = runtime();
  const native = context.memorySkillVisualMarkup({ gameId: 'p_card-stack', upgradeCount: 1 });
  assert.match(native, /src="\/assets\/stack-plus.png"/);
  assert.match(native, />축적\+</);
  const numeric = context.memorySkillVisualMarkup({ id: 389, name: '積み重ね+' });
  assert.match(numeric, /stack-plus.png/);
  assert.match(numeric, />축적\+</);
  assert.match(numeric, /alt=""/);
  assert.match(context.memorySkillVisualMarkup({ id: '389' }), /stack-plus.png/);
});

test('shared Korean fly names never guess a card; Japanese or exact ID resolves them', () => {
  const context = runtime();
  const ambiguous = context.memorySkillVisualMarkup('날아올라라!');
  assert.doesNotMatch(ambiguous, /<img/);
  assert.match(ambiguous, /같은 이름의 스킬/);
  assert.match(context.memorySkillVisualMarkup({ nameKo: '날아올라라!', nameJa: '羽ばたけ！' }), /fly-anomaly.png/);
  assert.match(context.memorySkillVisualMarkup({ gameId: 'p_card-fly-sense', nameKo: '날아올라라!' }), /fly-sense.png/);
});

test('uses the exact memory artwork and selected character variant without borrowing another family', () => {
  const owned = [{ id: 'owned-1', skillImageUrl: '/assets/owned-stack.png', effects: { carriedSkill: { id: 'p_card-stack', upgrade: 1, nameKo: '축적+', nameJa: '積み重ね+' } } }];
  const context = runtime({ owned });
  assert.match(context.memorySkillVisualMarkup({ memoryId: 'owned-1' }), /owned-stack.png/);
  const rawMemory = context.memorySkillVisualMarkup(owned[0]);
  assert.match(rawMemory, />축적\+</);
  assert.match(rawMemory, /owned-stack.png/);
  assert.match(context.memorySkillVisualMarkup({ gameId: 'p_card-character' }), /lillja.png/);
  const trigger = { gameId: 'p_card-character' };
  assert.match(context.memorySkillVisualMarkup(trigger, { characterId: 'other' }), /other.png/);
  assert.match(context.memorySkillVisualMarkup(trigger, { characterId: 'unlisted' }), /lillja.png/);
  assert.doesNotMatch(context.memorySkillVisualMarkup({ gameId: 'missing' }, { characterId: 'other', label: '축적' }), /<img/);
  const missing = context.memorySkillVisualMarkup({ gameId: 'p_card-missing', nameKo: '없는 스킬' });
  assert.doesNotMatch(missing, /<img/);
  assert.match(missing, /스킬 그림 미확인/);
});

test('rich text preserves source wording, handles attached Korean particles and full-width plus, and escapes HTML', () => {
  const context = runtime();
  const text = '축적+와 다시 시작하기를 준비합니다. 積み重ね＋ <img src=x onerror=alert(1)> & 끝';
  const markup = context.memoryRichTextMarkup(text);
  assert.equal((markup.match(/class="memory-skill-visual/g) ?? []).length, 3);
  assert.match(markup, /stack-plus.png/);
  assert.match(markup, />積み重ね＋</);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markup, /&amp; 끝/);
  assert.doesNotMatch(context.memoryRichTextMarkup('누적축적량을 봅니다'), /memory-skill-visual/);
});

test('unowned catalogue entries render and catalogue loading is shared across repeated calls', async () => {
  let requests = 0, ready = 0;
  const context = runtime({ cards: [], fetch: async url => {
    assert.equal(url, '/api/catalog'); requests++;
    return { ok: true, json: async () => ({ skillCards: skills, supportCards: [{ gameId: 'support-1' }], freshness: { asOf: '2026-11-03' } }) };
  } });
  await Promise.all([context.loadMemorySkillVisualCatalog(() => ready++), context.loadMemorySkillVisualCatalog({ onReady: () => ready++ })]);
  assert.equal(requests, 1);
  assert.equal(ready, 2);
  assert.equal(context.ui.skillVisualCatalogLoaded, true);
  assert.equal(context.ui.supportVisualCatalog[0].gameId, 'support-1');
  assert.equal(context.ui.catalogFreshness.asOf, '2026-11-03');
  assert.match(context.memorySkillVisualMarkup('仕切り直し'), /reset.png/);
  await context.loadMemorySkillVisualCatalog();
  assert.equal(requests, 1);
});

test('no image can inject attributes and Japanese detail is opt-in', () => {
  const context = runtime();
  const markup = context.memorySkillVisualMarkup({ gameId: 'p_card-stack', skillImageUrl: '/assets/x.png" onerror="x' }, { showJapanese: true, size: 999 });
  assert.match(markup, /--memory-skill-size:36px/);
  assert.match(markup, /&quot; onerror=&quot;/);
  assert.doesNotMatch(markup, /src="[^"]*" onerror="/);
  assert.match(markup, /class="memory-skill-japanese" lang="ja"/);
  assert.doesNotMatch(context.memorySkillVisualMarkup('축적'), /class="memory-skill-japanese"/);
});
