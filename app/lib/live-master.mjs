import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { load, JSON_SCHEMA } from './vendor/js-yaml/js-yaml.mjs';

const repository = 'vertesan/gakumasu-diff';
const api = 'https://api.github.com/repos/' + repository;
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const maxTableBytes = 128 * 1024 * 1024;
const requiredKeys = {
  Character: ['id', 'isPlayable', 'idolCardIds'], IdolCard: ['id', 'name', 'characterId', 'planType', 'viewStartTime'],
  SupportCard: ['id', 'name', 'type', 'planType', 'supportCardLevelLimitId', 'viewStartTime'],
  ProduceCard: ['id', 'upgradeCount', 'name', 'planType'], ProduceItem: ['id', 'name', 'planType'],
  ProduceCharacter: ['produceId', 'characterId'], ProduceGroupCharacter: ['produceGroupId', 'characterId', 'isExcluded'],
  ProduceInitialDeck: ['produceId', 'examInitialDeckId'], ProduceEventSupportCard: ['supportCardId', 'produceStepEventDetailId'],
};
function validTable(name, rows) {
  const keys = requiredKeys[name] ?? (name.startsWith('SupportCardProduceSkillLevel') ? ['supportCardId', 'produceSkillId', 'supportCardLevel'] : ['id']);
  return Array.isArray(rows) && (rows.length > 0 || name === 'ProduceGroupCharacter') &&
    rows.every(row => row && typeof row === 'object' && keys.every(key => Object.hasOwn(row, key)));
}

export function parseMasterTable(name, bytes) {
  const rows = load(bytes.toString('utf8'), { schema: JSON_SCHEMA });
  // An empty exclusion table means that the master lists no scenario exclusions.
  if (rows == null && !bytes.toString('utf8').trim() && name === 'ProduceGroupCharacter') return [];
  if (!validTable(name, rows)) throw new Error(name + ' 카드 자료의 형식이 바뀌었습니다.');
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      // The UI uses typed effects and conditions. Their repeated display templates account for most of the YAML.
      if (/Descriptions$/i.test(key)) delete row[key];
    }
  }
  return rows;
}

export function gitBlobHash(bytes) {
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

export function readMasterSnapshot(filename, names) {
  if (!filename || !fs.existsSync(filename)) return null;
  try {
    const data = JSON.parse(gunzipSync(fs.readFileSync(filename), { maxOutputLength: 200 * 1024 * 1024 }).toString('utf8'));
    if (data.schema !== 1 || !sha(data.commit) || !Number.isFinite(Date.parse(data.publishedAt)) ||
        !names.every(name => sha(data.blobs?.[name]) && validTable(name, data.tables?.[name]))) return null;
    return data;
  } catch { return null; }
}

export function writeMasterSnapshot(filename, data) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, gzipSync(JSON.stringify(data), { level: 6 }), { flag: 'wx' });
}

async function get(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(60000), redirect: 'error',
    headers: { 'User-Agent': 'gakumas-owned-tool', Accept: url.startsWith(api) ? 'application/vnd.github+json' : 'text/plain' } });
  if (!response.ok) throw new Error('공개 카드 자료를 받을 수 없습니다 (HTTP ' + response.status + ').');
  return response;
}

// Fetch only public, commit-pinned tables. A failed or truncated download never becomes a usable snapshot.
export async function fetchMasterUpdate({ previous, names, fetchImpl = fetch }) {
  const head = await (await get(api + '/commits/main', fetchImpl)).json();
  const publishedAt = head.commit?.committer?.date;
  if (!sha(head.sha) || !Number.isFinite(Date.parse(publishedAt))) throw new Error('공개 카드 자료의 버전을 확인하지 못했습니다.');
  if (previous && (previous.commit === head.sha || Date.parse(previous.publishedAt) > Date.parse(publishedAt))) return null;
  const tree = await (await get(api + '/git/trees/' + head.sha, fetchImpl)).json();
  if (!Array.isArray(tree.tree) || tree.truncated) throw new Error('공개 카드 파일 목록이 불완전합니다.');
  const files = new Map(tree.tree.filter(file => file.type === 'blob').map(file => [file.path, file]));
  const tables = {}, blobs = {};
  for (const name of names) {
    const filename = name + '.yaml', file = files.get(filename);
    if (!file || !sha(file.sha) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxTableBytes) {
      throw new Error(name + ' 카드 자료를 확인하지 못했습니다.');
    }
    blobs[name] = file.sha;
    if (previous?.blobs[name] === file.sha) {
      tables[name] = previous.tables[name];
      continue;
    }
    const response = await get('https://raw.githubusercontent.com/' + repository + '/' + head.sha + '/' + filename, fetchImpl);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== file.size || gitBlobHash(bytes) !== file.sha) throw new Error(name + ' 카드 파일이 불완전합니다.');
    tables[name] = parseMasterTable(name, bytes);
  }
  return { schema: 1, commit: head.sha, publishedAt, blobs, tables };
}
