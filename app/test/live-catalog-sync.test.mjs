import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { fetchMasterUpdate, gitBlobHash, parseMasterTable, readMasterSnapshot, writeMasterSnapshot } from '../lib/live-master.mjs';
import { createLiveCatalog, masterTables } from '../lib/live-catalog.mjs';
import { loadCatalog } from '../lib/catalog.mjs';
import { createAppServer } from '../server.mjs';

test('updates pin one revision, reuse identical blobs and reject partial responses', async () => {
  const names = ['ProduceEffect', 'ProduceGroupCharacter'], requests = [];
  const inputs = { ProduceEffect: '- id: effect-a\n  produceDescriptions: []\n', ProduceGroupCharacter: '' };
  let commit = 'a'.repeat(40), corrupt = false;
  const fetchImpl = async url => {
    requests.push(url);
    if (url.endsWith('/commits/main')) return Response.json({ sha: commit, commit: { committer: { date: '2026-11-20T01:00:00Z' } } });
    if (url.endsWith('/git/trees/' + commit)) return Response.json({ tree: names.map(name => {
      const bytes = Buffer.from(inputs[name]); return { path: name + '.yaml', type: 'blob', size: bytes.length, sha: gitBlobHash(bytes) };
    }) });
    assert.ok(url.includes('/' + commit + '/'));
    const name = path.basename(url, '.yaml');
    return new Response(corrupt ? 'truncated' : inputs[name]);
  };
  const previous = await fetchMasterUpdate({ names, fetchImpl });
  assert.deepEqual(previous.tables, { ProduceEffect: [{ id: 'effect-a' }], ProduceGroupCharacter: [] });
  requests.length = 0;
  assert.equal(await fetchMasterUpdate({ names, fetchImpl, previous }), null);
  assert.equal(requests.length, 1);
  commit = 'b'.repeat(40); inputs.ProduceEffect = '- id: effect-b\n';
  requests.length = 0;
  assert.equal((await fetchMasterUpdate({ names, fetchImpl, previous })).tables.ProduceEffect[0].id, 'effect-b');
  assert.equal(requests.filter(url => url.includes('raw.githubusercontent.com')).length, 1);
  corrupt = true;
  await assert.rejects(fetchMasterUpdate({ names, fetchImpl, previous }), /불완전/);
  assert.throws(() => parseMasterTable('SupportCard', Buffer.from('- id: missing-identity-data')), /형식/);
  assert.deepEqual(previous.tables.ProduceEffect, [{ id: 'effect-a' }]);
});

test('an open server learns an unseen release, refreshes cached recommendations and restarts offline', async t => {
  const appDir = fileURLToPath(new URL('../', import.meta.url));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-live-master-'));
  const cacheDir = path.join(dir, 'live-catalog'), snapshotPath = path.join(dir, 'inventory.json');
  const settings = { appDir, cacheDir, loadBase: () => loadCatalog({ dataDir: path.join(appDir, 'data/catalog') }) };
  const newId = 'i_card-hkne-3-999', commit = 'f'.repeat(40), baseId = 'i_card-hkne-3-000';
  let release, attempts = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const store = createLiveCatalog({ ...settings, async updateFile({ previousFile, stagedFile }) {
    if (++attempts > 1) throw new Error('offline');
    await gate;
    const snapshot = readMasterSnapshot(previousFile, masterTables);
    const original = snapshot.tables.IdolCard.find(row => row.id === baseId);
    snapshot.tables.IdolCard.push({ ...original, id: newId, name: '新カード' });
    snapshot.tables.Character.find(row => row.id === 'hkne').idolCardIds.push(newId);
    snapshot.commit = commit; snapshot.publishedAt = '2026-11-20T03:00:00Z';
    writeMasterSnapshot(stagedFile, snapshot); return true;
  } });
  const server = createAppServer({ snapshotPath, catalogStore: store });
  t.after(async () => {
    release(); server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (route, body) => {
    const reply = await fetch(base + route, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await reply.json(); assert.equal(reply.status, 200, value.error?.message ?? value.error); return value;
  };
  const beforeSync = store.refresh();
  assert.equal(beforeSync, store.refresh());
  const lists = { userIdolCardList: [baseId, newId].map(idolCardId => ({ idolCardId, levelLimitRank: 0, potentialRank: 0 })),
    userSupportCardList: [{ supportCardId: 's_card-1-0013', level: 1, levelLimitRank: 0 }], userMemoryList: [],
    userCharacterList: [{ characterId: 'hkne', trueEndProduceTypes: [] }] };
  await call('/api/import', { schemaVersion: 1, producerLevel: 70, capturedAt: '2026-11-20T04:00:00Z', ...lists, capture: {
    collections: Object.fromEntries(Object.entries(lists).map(([field, rows]) => [field, { expectedCount: rows.length, exportedCount: rows.length, status: 'complete' }])) } });
  const original = await call('/api/state');
  assert.equal(original.inventory.idolCards.find(row => row.gameId === newId).known, false);
  const options = { idolGameId: baseId, scenario: 'hajime', targetAttribute: 'vocal', producerLevel: 70 };
  await call('/api/recommend', options);
  assert.equal((await call('/api/recommend', options)).recommendationCache.reused, true);
  release(); await beforeSync;
  const updated = await call('/api/state');
  assert.notEqual(updated.catalogVersion, original.catalogVersion);
  assert.equal(updated.inventory.idolCards.find(row => row.gameId === newId).known, true);
  assert.equal((await call('/api/recommend', options)).recommendationCache.reused, false);
  assert.equal((await call('/api/recommend', { ...options, idolGameId: newId })).selectedIdol.gameId, newId);
  assert.equal(JSON.parse(await fs.readFile(snapshotPath)).capturedAt, '2026-11-20T04:00:00Z');
  await store.refresh();
  assert.equal(store.syncStatus.status, 'offline');
  assert.equal(store.current.version, updated.catalogVersion);
  const restart = createLiveCatalog(settings);
  assert.equal(restart.current.version, updated.catalogVersion);
  restart.close();
});
