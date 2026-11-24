import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const maxSavedRecommendations = 16;
const digest = value => createHash('sha256').update(value).digest('hex');

async function calculationVersion(appDir, catalog) {
  const libDir = path.join(appDir, 'lib');
  const files = (await fs.readdir(libDir, { recursive: true }))
    .filter(name => /\.(?:mjs|js|json)$/.test(name)).sort();
  const code = await Promise.all([path.join(appDir, 'server.mjs'), ...files.map(name => path.join(libDir, name))]
    .map(async file => digest(await fs.readFile(file))));
  return digest(JSON.stringify([code, catalog]));
}

export function createRecommendationCache({ appDir, snapshotPath, catalog }) {
  const directory = `${snapshotPath}.recommendations`;
  let version;
  let writes = Promise.resolve();

  return {
    async key(input, inventoryVersion, warnings) {
      version ??= calculationVersion(appDir, catalog).catch(() => null);
      const currentVersion = await version;
      if (!currentVersion) return null;
      const conditions = Object.keys(input).sort().map(key => [key, input[key]]);
      return digest(JSON.stringify([currentVersion, inventoryVersion, warnings, conditions]));
    },
    async read(key) {
      if (!key) return null;
      try {
        const entry = JSON.parse(await fs.readFile(path.join(directory, `${key}.json`), 'utf8'));
        if (entry?.result?.accountPlaybook && entry.result.eventContext && Array.isArray(entry.stages) && typeof entry.checkedAt === 'string') return entry;
      } catch { /* Missing or unreadable saved results can be recalculated. */ }
      return null;
    },
    async save(key, entry) {
      if (!key) return;
      const filename = path.join(directory, `${key}.json`);
      const temporary = `${filename}.${randomUUID()}.tmp`;
      writes = writes.then(async () => {
        await fs.mkdir(directory, { recursive: true });
        try {
          await fs.writeFile(temporary, JSON.stringify(entry), { flag: 'wx' });
          await fs.rename(temporary, filename);
        } finally {
          await fs.unlink(temporary).catch(() => {});
        }
        const files = (await fs.readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
        if (files.length <= maxSavedRecommendations) return;
        const saved = await Promise.all(files.map(async name => {
          const file = path.join(directory, name);
          return { file, modified: (await fs.stat(file)).mtimeMs };
        }));
        saved.sort((a, b) => b.modified - a.modified);
        await Promise.all(saved.slice(maxSavedRecommendations).map(({ file }) => fs.unlink(file)));
      }).catch(() => { /* A cache write failure does not invalidate a successful recommendation. */ });
      await writes;
    },
  };
}
