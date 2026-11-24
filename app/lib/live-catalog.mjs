import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { readMasterSnapshot } from './live-master.mjs';
import { idolTables, mergeLiveIdols } from './live-idols.mjs';
import { supportTables, mergeLiveSupports } from './live-supports.mjs';
import { attachLiveArtwork } from './live-artwork.mjs';

export const masterTables = [...new Set([...idolTables, ...supportTables])].sort();
const hour = 60 * 60 * 1000;
const retryDelay = 5 * 60 * 1000;

function runUpdate(workerData, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./live-master-worker.mjs', import.meta.url), { workerData, execArgv: [] });
    const stop = () => { void worker.terminate(); };
    signal.addEventListener('abort', stop, { once: true });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', () => {
      signal.removeEventListener('abort', stop);
      reject(new Error('공개 카드 갱신이 중단됐습니다.'));
    });
  });
}

export function createLiveCatalog({ appDir, cacheDir, loadBase, now = Date.now, updateFile = runUpdate }) {
  const seed = path.join(appDir, 'data/catalog/live-master.json.gz');
  const cache = path.join(cacheDir, 'master.json.gz');
  const namesFile = path.join(appDir, 'data/translations/names.json');
  const translations = fs.existsSync(namesFile) ? JSON.parse(fs.readFileSync(namesFile, 'utf8').replace(/^\uFEFF/, '')) : {};
  const controller = new AbortController();
  let current, currentFile, nextRelease = Infinity;
  let pending, timer, lastAttempt = -Infinity, status = 'ready', checkedAt = null;

  function build(snapshot) {
    const catalog = loadBase();
    if (!snapshot) return { catalog, version: 'bundled', nextRelease: Infinity };
    const time = now(), { tables, commit, publishedAt } = snapshot;
    const options = { translations, now: time, commit };
    mergeLiveIdols(catalog, tables, options);
    mergeLiveSupports(catalog, tables, options);
    attachLiveArtwork(catalog, tables);
    const byId = rows => Object.fromEntries(rows.map(row => [row.gameId, row]));
    catalog.indices = { ...catalog.indices, supportCards: byId(catalog.supportCards), idolCards: byId(catalog.idolCards) };
    catalog.dataFreshness = { ...catalog.dataFreshness, liveMaster: { commit, publishedAt,
      url: 'https://github.com/vertesan/gakumasu-diff/tree/' + commit } };
    const starts = [tables.IdolCard, tables.SupportCard, tables.ProduceCard, tables.ProduceItem].flat()
      .map(row => Number(row.viewStartTime)).filter(Number.isFinite);
    const released = starts.filter(date => date > 0 && date <= time);
    return { catalog, version: commit + '-' + Math.max(0, ...released), nextRelease: Math.min(Infinity, ...starts.filter(date => date > time)) };
  }
  function use(result, filename) {
    current = { catalog: result.catalog, version: result.version };
    currentFile = filename;
    nextRelease = result.nextRelease;
  }
  const candidates = [cache, seed].map(file => ({ file, snapshot: readMasterSnapshot(file, masterTables) }))
    .filter(entry => entry.snapshot).sort((a, b) => Date.parse(b.snapshot.publishedAt) - Date.parse(a.snapshot.publishedAt));
  for (const { file, snapshot } of candidates) {
    try { use(build(snapshot), file); break; } catch { /* Try the other verified edition. */ }
  }
  if (!current) use(build(null), null);

  function refresh() {
    if (pending || controller.signal.aborted) return pending;
    clearTimeout(timer);
    status = 'checking';
    lastAttempt = now();
    const stagedFile = cache + '.' + randomUUID() + '.tmp';
    pending = (async () => {
      try {
        const changed = await updateFile({ previousFile: currentFile, stagedFile, names: masterTables }, controller.signal);
        if (controller.signal.aborted) return;
        const cached = readMasterSnapshot(cache, masterTables);
        const cachedDate = Date.parse(cached?.publishedAt);
        if (cached && cached.commit !== current.catalog.dataFreshness?.liveMaster?.commit &&
            (!currentFile || cachedDate >= Date.parse(current.catalog.dataFreshness?.liveMaster?.publishedAt))) {
          use(build(cached), cache);
        }
        if (changed) {
          const snapshot = readMasterSnapshot(stagedFile, masterTables);
          if (!snapshot) throw new Error('새 카드 표가 불완전합니다.');
          if (!cached || Date.parse(snapshot.publishedAt) >= cachedDate) {
            const result = build(snapshot);
            fs.renameSync(stagedFile, cache);
            use(result, cache);
          }
        }
        checkedAt = new Date(now()).toISOString();
        status = 'ready';
      } catch { status = 'offline'; }
      finally {
        await fs.promises.rm(stagedFile, { force: true }).catch(() => {});
        pending = null;
        if (!controller.signal.aborted) timer = setTimeout(refresh, status === 'ready' ? hour : retryDelay).unref();
      }
    })();
    return pending;
  }
  return {
    get current() {
      if (now() >= nextRelease) {
        const snapshot = readMasterSnapshot(currentFile, masterTables);
        if (snapshot) use(build(snapshot), currentFile);
      }
      return current;
    },
    get syncStatus() { return { status, checkedAt, publishedAt: current.catalog.dataFreshness?.liveMaster?.publishedAt ?? null }; },
    refresh,
    checkMissing(inventory) {
      if (now() - lastAttempt >= retryDelay &&
          [...inventory.supportCards, ...inventory.idolCards].some(card => !card.known)) void refresh();
    },
    close() { clearTimeout(timer); controller.abort(); },
  };
}
