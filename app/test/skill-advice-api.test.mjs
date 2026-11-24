import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { createAppServer } from '../server.mjs';

test('skill advice API works before ownership collection, validates context and never imports catalog cards as owned', async () => {
  const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gakumas-skill-advice-'));
  const snapshotPath = path.join(dir, 'inventory.json');
  const server = createAppServer({ catalog, snapshotPath });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(base + '/api/skill-advice', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const settings = { scenario: 'hif', trainingType: 'concentration', producerLevel: 75,
    purpose: 'memory', upgradeCount: 1, switchState: 'enabled', cardIds: ['p_card-01-act-3_185'] };
  try {
    const optionsResponse = await fetch(base + '/api/skill-advice/options');
    assert.equal(optionsResponse.status, 200);
    const options = await optionsResponse.json();
    assert.equal(options.cards.length, 476);
    assert.equal(new Set(options.cards.map(card => card.id)).size, 476);
    const response = await post(settings);
    assert.equal(response.status, 200);
    const selected = await response.json();
    assert.equal(selected.cards.length, 1);
    assert.equal(selected.cards[0].gameId, settings.cardIds[0]);
    assert.equal(selected.cards[0].eligibility.status, 'eligible');
    assert.notEqual(selected.cards[0].rating.basis, undefined);
    const blockedResponse = await post({ ...settings, producerLevel: 70 });
    assert.equal(blockedResponse.status, 200);
    assert.equal((await blockedResponse.json()).cards[0].eligibility.status, 'blocked');
    for (const invalid of [null, [], { ...settings, producerLevel: 91 }, { ...settings, upgradeCount: 2 },
      { ...settings, producerLevel: '75' }, { ...settings, purpose: 'unknown' },
      { ...settings, scenario: 'nia', difficulty: 'legend' }, { ...settings, hifAbilityState: true }]) {
      const invalidResponse = await post(invalid);
      assert.equal(invalidResponse.status, 400, JSON.stringify(invalid));
      assert.equal(typeof (await invalidResponse.json()).error, 'string');
    }
    assert.equal((await post(settings, { Origin: 'https://unrelated.example' })).status, 403);
    const state = await (await fetch(base + '/api/state')).json();
    assert.equal(state.connection.status, 'waiting');
    assert.equal(state.inventory.supportCards.length, 0);
    assert.equal(state.inventory.memories.length, 0);
    await assert.rejects(fs.stat(snapshotPath), { code: 'ENOENT' });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.match(path.basename(dir), /^gakumas-skill-advice-/);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
