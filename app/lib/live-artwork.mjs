import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseCsvRecords } from './vendor/gakumas-data/utils/csv.js';

const prefix = '/assets/live/';
const wiki = 'https://seesaawiki.jp/gakumasu/d/';
const supportList = wiki + '%a5%b5%a5%dd%a1%bc%a5%c8%a5%ab%a1%bc%a5%c9%b0%ec%cd%f7';
const idolList = wiki + '%a5%d7%a5%ed%a5%c7%a5%e5%a1%bc%a5%b9%a5%a2%a5%a4%a5%c9%a5%eb%b0%ec%cd%f7';
const publicRepo = 'https://raw.githubusercontent.com/gakumas-tools/gakumas-tools/master/packages/';
const gallery = 'https://imasgk.gamedbs.jp/';
const csvUrl = file => publicRepo + 'gakumas-data/csv/' + file + '.csv';
const pngUrl = file => publicRepo + 'gakumas-images/images/' + file + '.png';
const isWikiImage = url => /^https:\/\/image\d+\.seesaawiki\.jp\/g\/u\/gakumasu\/[a-z0-9_-]+\.(png|jpe?g|webp)$/i.test(url);
const safeId = id => typeof id === 'string' && /^[a-z0-9_-]{1,100}$/i.test(id);
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s/g, '').replaceAll('〜', '~');
const characterName = idol => normalize(idol.characterNameJa);

function images(base) {
  return { imageUrl: base + '/full', thumbnailUrl: base + '/thumb' };
}

/** Fill missing artwork on public catalog records. Only the local server contacts image sources. */
export function attachLiveArtwork(catalog, tables = {}) {
  const portraits = new Map();
  for (const idol of catalog.idolCards ?? []) {
    if (idol.characterImageUrl) portraits.set(idol.characterId, idol.characterImageUrl);
  }
  const characters = new Set();
  for (const idol of catalog.idolCards ?? []) {
    if (safeId(idol.characterId) && characterName(idol)) {
      characters.add(idol.characterId);
      idol.characterImageUrl ??= portraits.get(idol.characterId) ?? prefix + 'characters/' + idol.characterId;
    }
    if (!idol.imageUrl && !idol.thumbnailUrl && safeId(idol.gameId) && idol.nameJa) {
      const base = prefix + 'idols/' + idol.gameId;
      const variants = idol.illustrationVariants ??= {};
      variants.before ??= images(base + '/before');
      variants.after ??= images(base + '/after');
      Object.assign(idol, variants.before);
    }
  }
  for (const card of catalog.supportCards ?? []) {
    if (!card.imageUrl && !card.thumbnailUrl && safeId(card.gameId) && card.nameJa)
      Object.assign(card, images(prefix + 'supports/' + card.gameId));
  }
  const characterAssets = new Set((tables.ProduceCard ?? []).filter(row => row.isCharacterAsset).map(row => row.id));
  for (const skill of catalog.skillCards ?? []) {
    const upgrade = skill.upgradeCount ?? 0;
    if (!safeId(skill.gameId) || !skill.nameJa || !Number.isSafeInteger(upgrade) || upgrade < 0) continue;
    const base = prefix + 'skills/' + skill.gameId + '/' + upgrade;
    if (skill.isCharacterAsset || characterAssets.has(skill.gameId) || Object.keys(skill.characterIconUrls ?? {}).length) {
      skill.characterIconUrls ??= {};
      for (const id of characters) skill.characterIconUrls[id] ??= base + '/' + id;
    } else if (!skill.imageUrl && !skill.thumbnailUrl) {
      skill.imageUrl = skill.thumbnailUrl = base;
    }
  }
  return catalog;
}

function routeRecord(pathname, catalog) {
  if (!pathname.startsWith(prefix)) return null;
  const parts = pathname.slice(prefix.length).split('/');
  if (!parts.every(safeId)) return null;
  const [kind, id, a, b] = parts;
  const idols = catalog.idolCards ?? [];
  if (kind === 'characters' && parts.length === 2) {
    const idol = idols.find(row => row.characterId === id && row.characterImageUrl === pathname);
    return idol && { kind, idol };
  }
  if (kind === 'skills' && (parts.length === 3 || parts.length === 4)) {
    const skill = catalog.skillCards?.find(row => row.gameId === id && String(row.upgradeCount ?? 0) === a);
    if (!skill || (b ? skill.characterIconUrls?.[b] !== pathname : skill.imageUrl !== pathname)) return null;
    const idol = b && idols.find(row => row.characterId === b);
    const originId = skill.originIdolCardId || skill.originPrimaStellaIdolCardId;
    const owner = originId && idols.find(row => row.gameId === originId);
    return (!b || idol) && { kind, skill, idol, owner };
  }
  const field = parts.at(-1) === 'full' ? 'imageUrl' : parts.at(-1) === 'thumb' ? 'thumbnailUrl' : null;
  if (kind === 'supports' && parts.length === 3 && field) {
    const card = catalog.supportCards?.find(row => row.gameId === id && row[field] === pathname);
    return card && { kind, card, field, idols };
  }
  if (kind === 'idols' && parts.length === 4 && (a === 'before' || a === 'after') && field) {
    const idol = idols.find(row => row.gameId === id && row.illustrationVariants?.[a]?.[field] === pathname);
    return idol && { kind, idol, stage: a, field };
  }
  return null;
}

const bodies = (markup, tag) => Array.from(markup.matchAll(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'gi')), m => m[1]);
const attributes = (markup, tag, attr) => Array.from(markup.matchAll(new RegExp('<' + tag + '\\b[^>]*?\\s' + attr + '=["\']([^"\']+)["\']', 'gi')), m => m[1]);
const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
function plain(markup) {
  return normalize(markup?.replace(/<[^>]*>/g, '').replace(/&(amp|quot|apos|lt|gt|nbsp|#\d+|#x[0-9a-f]+);/gi, (_, key) => {
    if (entities[key]) return entities[key];
    const code = Number(key[1] === 'x' ? '0x' + key.slice(2) : key.slice(1));
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }));
}

// A duplicate normalized label pointing to different artwork cannot identify a card.
function setUnique(index, key, value) {
  if (key && value) index.set(key, index.has(key) && index.get(key) !== value ? null : value);
}

function parseSupportList(html) {
  const index = new Map();
  for (const row of bodies(html, 'tr')) {
    const [rarity, picture, title] = bodies(row, 'td');
    if (!['R', 'SR', 'SSR'].includes(plain(rarity))) continue;
    const url = attributes(picture ?? '', 'img', 'src').find(isWikiImage);
    setUnique(index, plain(bodies(title ?? '', 'a')[0]) + '|' + plain(rarity), url);
  }
  return index;
}

function parseIdolList(html) {
  const index = new Map();
  for (const match of html.matchAll(/<a\b[^>]*?\shref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = plain(match[2]);
    if (match[1].startsWith(wiki) && /^【.+】.+$/.test(label)) setUnique(index, label, match[1]);
  }
  return index;
}

function galleryLinks(html, type) {
  const index = new Map();
  for (const match of html.matchAll(/<a\b[^>]*?\shref=["'](https:\/\/imasgk\.gamedbs\.jp\/chara\/show\/\d+(\/s\d+)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if ((type === 'support') === Boolean(match[2])) setUnique(index, plain(match[3]), match[1]);
  }
  return index;
}

function parseIdolPage(html) {
  let variants = [];
  const skills = new Map();
  for (const table of bodies(html, 'table')) {
    const headers = bodies(table, 'th').map(plain);
    if (/^特訓0[~～]2$/.test(headers[0]) && /^特訓3[~～]/.test(headers[1])) {
      variants = bodies(table, 'td').slice(0, 2).map(cell => ({
        imageUrl: attributes(cell, 'a', 'href').find(isWikiImage),
        thumbnailUrl: attributes(cell, 'img', 'src').find(isWikiImage),
      }));
    }
    if (headers[0]?.includes('スキルカード')) {
      const titleRow = bodies(table, 'tr').find(row => bodies(row, 'th').some(cell => plain(cell) === 'カード名'));
      const [icon, name] = bodies(titleRow ?? '', 'td');
      setUnique(skills, plain(name), attributes(icon ?? '', 'img', 'src').find(isWikiImage));
    }
  }
  return { variants, skills };
}

function picture(bytes) {
  if (!bytes || bytes.length < 24) return null;
  let contentType;
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && bytes.toString('ascii', 12, 16) === 'IHDR'
    && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') contentType = 'image/png';
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) contentType = 'image/jpeg';
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    && bytes.readUInt32LE(4) + 8 === bytes.length) contentType = 'image/webp';
  return contentType ? { contentType, bytes } : null;
}

async function download(fetchImpl, url, maxBytes) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Artwork source unavailable');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Artwork exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

const bundledSeed = fileURLToPath(new URL('../data/artwork-seed/', import.meta.url));
const bundledWeb = fileURLToPath(new URL('../web/', import.meta.url));
export function createLiveArtworkCache({ cacheDir, seedDir = bundledSeed, webDir = bundledWeb, fetchImpl = fetch, now = Date.now } = {}) {
  const documents = new Map(), pending = new Map(), failures = new Map();
  const retryMs = 5 * 60_000;
  function document(url, parse, charset = 'utf-8') {
    const saved = documents.get(url);
    if (saved && now() < saved.expires) return saved.promise;
    const entry = { expires: now() + 30 * 60_000 };
    entry.promise = download(fetchImpl, url, 4 * 1024 * 1024).then(bytes => {
      const utf8 = /<meta[^>]+charset\s*=\s*["']?utf-8/i.test(bytes.subarray(0, 1024).toString('latin1'));
      return parse(new TextDecoder(utf8 ? 'utf-8' : charset).decode(bytes));
    }).catch(error => {
      entry.expires = now() + retryMs;
      throw error;
    });
    documents.set(url, entry);
    return entry.promise;
  }
  const table = file => document(csvUrl(file), parseCsvRecords);
  async function publicCharacter(idol) {
    const candidates = (await table('idols')).filter(row => normalize(row.name) === characterName(idol));
    return candidates.length === 1 && Number.isSafeInteger(candidates[0].id) ? candidates[0].id : null;
  }
  async function idolPage(idol) {
    const index = await document(idolList, parseIdolList, 'euc-jp');
    const name = normalize(idol.nameJa).replace(/^\[(.+)\]/, '【$1】');
    const page = index.get(name);
    return page ? document(page, parseIdolPage, 'euc-jp') : null;
  }
  async function gallerySupport({ card, idols, field }) {
    const characters = await document(gallery, html => galleryLinks(html, 'character'));
    for (const id of card.characterIds ?? []) {
      const idol = idols.find(row => row.characterId === id);
      const page = idol && characters.get(characterName(idol));
      if (!page) continue;
      const index = await document(page, html => galleryLinks(html, 'support'));
      const detail = index.get(normalize(card.nameJa));
      if (!detail) continue;
      const urls = await document(detail, html => ({
        imageUrl: attributes(html, 'a', 'href').find(url => /^https:\/\/imasgk\.gamedbs\.jp\/image\/scard\/img\/+[a-z0-9_-]+\.webp$/i.test(url)),
        thumbnailUrl: html.match(/<meta\s+name=["']twitter:image["']\s+content=["'](https:\/\/imasgk\.gamedbs\.jp\/image\/scard\/ico\/+[a-z0-9_-]+\.webp)["']/i)?.[1],
      }));
      if (urls[field]) return [urls[field], urls[field === 'imageUrl' ? 'thumbnailUrl' : 'imageUrl']];
    }
    return [];
  }
  async function sources(record) {
    const { kind, card, idol, skill, stage, field } = record;
    if (kind === 'supports') {
      const index = await document(supportList, parseSupportList, 'euc-jp').catch(() => null);
      const thumb = index?.get(normalize(card.nameJa) + '|' + card.rarity?.toUpperCase());
      if (!thumb) return [];
      const full = thumb.replace(/-s\.(?=png$|jpe?g$|webp$)/i, '.');
      return field === 'imageUrl' ? [full, thumb] : [thumb, full];
    }
    if (kind === 'idols') {
      const variant = (await idolPage(idol))?.variants[stage === 'after' ? 1 : 0];
      return variant ? [variant[field], variant[field === 'imageUrl' ? 'thumbnailUrl' : 'imageUrl']] : [];
    }
    if (kind === 'characters') {
      const id = await publicCharacter(idol);
      return id ? [pngUrl('idols/' + id)] : [];
    }
    let matches = (await table('skill_cards')).filter(row => normalize(row.name) === normalize(skill.nameJa) && row.plan === skill.plan);
    if (matches.length > 1 && skill.internalId != null) matches = matches.filter(row => row.id === skill.internalId);
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id)) return [];
    const id = matches[0].id;
    if (!idol) return [pngUrl('skillCards/icons/' + id)];
    const charId = await publicCharacter(idol);
    if (!charId) return [];
    const key = id + '_' + charId;
    const keys = await document(publicRepo + 'gakumas-images/images/skillCards/icons/keys.json',
      text => new Set(JSON.parse(text))).catch(() => null);
    return !keys || keys.has(key) ? [pngUrl('skillCards/icons/' + key)] : [];
  }
  async function* candidates(record) {
    yield* new Set(await sources(record).catch(() => []));
    if (record.kind === 'supports') yield* new Set(await gallerySupport(record).catch(() => []));
    if (record.kind === 'skills' && record.owner && !record.idol && !record.skill.upgradeCount) {
      const page = await idolPage(record.owner).catch(() => null);
      yield page?.skills.get(normalize(record.skill.nameJa));
    }
  }
  async function readPicture(dir, name) {
    return dir ? picture(await fs.readFile(path.join(dir, name)).catch(() => null)) : null;
  }
  async function existingSkillImage(record) {
    if (record.kind !== 'skills' || !record.idol) return null;
    const asset = record.skill.imageUrl ?? record.skill.thumbnailUrl;
    if (!/^\/assets\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(png|jpe?g|webp)$/i.test(asset)) return null;
    const img = await readPicture(webDir, asset.slice(1));
    return img && { ...img, provisional: true };
  }
  async function load(key, record) {
    const filename = key.slice(prefix.length).replaceAll('/', '.') + '.img';
    const saved = await readPicture(cacheDir, filename) ?? await readPicture(seedDir, filename);
    if (saved) return saved;
    if (now() < (failures.get(key) ?? 0)) return existingSkillImage(record);
    for await (const url of candidates(record)) {
      if (!url) continue;
      const result = picture(await download(fetchImpl, url, 8 * 1024 * 1024).catch(() => null));
      if (!result) continue;
      if (cacheDir) {
        const file = path.join(cacheDir, filename), temp = file + '.' + randomUUID() + '.tmp';
        try {
          await fs.mkdir(cacheDir, { recursive: true });
          await fs.writeFile(temp, result.bytes);
          await fs.rename(temp, file);
        } catch { await fs.unlink(temp).catch(() => {}); }
      }
      failures.delete(key);
      return { ...result, sourceUrl: url };
    }
    failures.set(key, now() + retryMs);
    return existingSkillImage(record);
  }
  return {
    get(pathname, catalog) {
      const record = routeRecord(pathname, catalog);
      if (!record) return Promise.resolve(null);
      if (!pending.has(pathname)) pending.set(pathname, load(pathname, record).finally(() => pending.delete(pathname)));
      return pending.get(pathname);
    },
  };
}
