import fs from 'node:fs/promises';
import path from 'node:path';
import { computeHifBonuses } from './hif-bonuses.mjs';
import { computeIdolGrowth } from './idol-growth.mjs';
import { summarizeMemoryEffects } from './memory-effects.mjs';

const groups = {
  supportCards: ['userSupportCardList', 'supportCardId'],
  idolCards: ['userIdolCardList', 'idolCardId'],
  memories: ['userMemoryList', 'userMemoryId'],
  characters: ['userCharacterList', 'characterId'],
};
const idOf = row => row?.gameId ?? row?.game_id ?? row?.masterId ?? row?.id;
const displayName = row => row?.nameKo || row?.name || row?.nameJa || null;
const integer = (value, min = 0) => value === null || value === undefined || value === '' || typeof value === 'boolean' ? null : Number.isSafeInteger(Number(value)) && Number(value) >= min ? Number(value) : null;
const lookup = rows => new Map((rows ?? []).flatMap(row => [idOf(row), row?.internalId].filter(Boolean).map(id => [String(id), row])));
const positiveTime = value => { try { return BigInt(value ?? 0) > 0n; } catch { return false; } };

export function emptyInventory() {
  return {
    supportCards: [], idolCards: [], memories: [], characters: [], producerLevel: null,
    complete: false, capturedAt: null, warnings: [],
    collectionStatus: Object.fromEntries(Object.keys(groups).map(key => [key, 'not_read'])),
    counts: Object.fromEntries(Object.keys(groups).map(key => [key, null])),
  };
}

export function normalizeSnapshot(raw, catalog) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== 1) {
    throw new Error('보유정보 파일 형식이 맞지 않습니다. 수집기가 저장한 JSON 파일을 선택해 주세요.');
  }
  if (!raw.capture || typeof raw.capture !== 'object') throw new Error('수집 상태가 없는 보유정보 파일입니다.');
  const result = emptyInventory();
  result.capturedAt = typeof raw.capturedAt === 'string' && Number.isFinite(Date.parse(raw.capturedAt)) ? raw.capturedAt : null;
  result.producerLevel = integer(raw.producerLevel, 1);
  result.capture = raw.capture;
  const supports = lookup(catalog.supportCards);
  const idols = lookup(catalog.idolCards);
  const skills = lookup(catalog.skillCards);
  const skillVariants = new Map((catalog.skillCards ?? []).map(row => [`${idOf(row)}:${Number(row.upgradeCount ?? 0)}`, row]));
  const abilities = lookup(catalog.memoryAbilities);
  const names = { supportCards: '서포트', idolCards: 'P아이돌', memories: '메모리', characters: '캐릭터' };
  for (const [group, [field, identity]] of Object.entries(groups)) {
    const values = raw[field];
    const declared = raw.capture.collections?.[field];
    if (!Array.isArray(values)) {
      result.collectionStatus[group] = declared?.status === 'error' ? 'error' : 'not_read';
      result.warnings.push(`${names[group]} 목록을 아직 읽지 못했습니다.`);
      continue;
    }
    if (values.length > 20000) throw new Error('보유정보 항목 수가 허용 범위를 넘었습니다.');
    const seen = new Set();
    const clean = [];
    let invalid = false;
    for (const row of values) {
      const key = row?.[identity];
      if (!row || typeof row !== 'object' || typeof key !== 'string' || !key || seen.has(key)) {
        invalid = true;
        continue;
      }
      seen.add(key);
      if (group === 'supportCards' && (integer(row.level, 1) == null || integer(row.levelLimitRank) == null)) {
        invalid = true;
      }
      if (group === 'idolCards' && (integer(row.levelLimitRank) == null || integer(row.potentialRank) == null)) {
        invalid = true;
      }
      if (group === 'memories' && (!Object.hasOwn(row, 'produceCard') || !Array.isArray(row.abilities) ||
          row.abilities.some(item => typeof item?.id !== 'string' || integer(item.level) == null) ||
          (row.produceCard != null && (typeof row.produceCard.id !== 'string' || integer(row.produceCard.upgradeCount) == null)))) invalid = true;
      clean.push(row);
    }
    const full = !invalid && declared?.status === 'complete' &&
      integer(declared.expectedCount) === values.length && integer(declared.exportedCount) === values.length;
    result.collectionStatus[group] = full ? 'complete' : 'partial';
    result.counts[group] = full ? clean.length : null;
    if (!full) result.warnings.push(`${names[group]}는 확인된 일부 항목만 표시합니다.`);
    result[group] = clean.map(row => {
      const key = row[identity];
      if (group === 'supportCards') {
        const card = supports.get(key);
        return { ...card, ...row, raw: row, id: key, gameId: key, internalId: card?.internalId ?? card?.id ?? null,
          name: displayName(card) ?? '이름을 확인하지 못한 서포트', known: Boolean(card),
          level: integer(row.level, 1), uncap: integer(row.levelLimitRank),
          levelCap: integer(row.levelLimitRank) == null ? null : integer(card?.maxLevels?.[row.levelLimitRank], 1),
          stockQuantity: integer(row.stockQuantity) };
      }
      if (group === 'idolCards') {
        const card = idols.get(key);
        const art = card?.illustrationVariants?.[integer(row.levelLimitRank) == null ? 'before' : Number(row.levelLimitRank) >= 3 ? 'after' : 'before'];
        return { ...card, ...row, raw: row, id: key, gameId: key, internalId: card?.internalId ?? card?.id ?? null,
          name: displayName(card) ?? '이름을 확인하지 못한 P아이돌', known: Boolean(card),
          imageUrl: art?.imageUrl ?? card?.imageUrl ?? null, thumbnailUrl: art?.thumbnailUrl ?? card?.thumbnailUrl ?? null,
          uncap: integer(row.levelLimitRank), awakening: integer(row.potentialRank),
          primaStella: positiveTime(row.primaStellaUpgradedTime) };
      }
      if (group === 'characters') return { ...row, id: key, gameId: key, raw: row };
      const idol = idols.get(row.idolCardId);
      const skill = skillVariants.get(`${row.produceCard?.id}:${Number(row.produceCard?.upgradeCount ?? 0)}`) ?? skills.get(row.produceCard?.id);
      const skillImage = skill?.characterIconUrls?.[row.characterId] ?? skill?.imageUrl ?? null;
      const resolvedAbilities = (row.abilities ?? []).map(ability => {
        const detail = (catalog.memoryAbilities ?? []).find(item => String(idOf(item)) === ability.id && Number(item.level) === Number(ability.level)) ?? abilities.get(ability.id);
        return { ...detail, ...ability, name: displayName(detail) ?? '효과 이름 미확인', known: Boolean(detail) };
      });
      return { ...row, raw: row, id: key, gameId: key, known: Boolean(skill),
        name: displayName(skill) ?? '반입 스킬 이름 미확인', nameKo: skill?.nameKo ?? null, nameJa: skill?.nameJa ?? null,
        skillName: displayName(skill), skillNameKo: skill?.nameKo ?? null, skillNameJa: skill?.nameJa ?? null,
        skill: skill ? { ...skill, ...row.produceCard } : { ...row.produceCard },
        characterName: idol?.characterName ?? null, characterNameJa: idol?.characterNameJa ?? null, idolName: displayName(idol), idolNameJa: idol?.nameJa ?? null,
        characterImageUrl: idol?.characterImageUrl ?? null, idolImageUrl: idol?.imageUrl ?? null, skillImageUrl: skillImage,
        imageUrl: idol?.imageUrl ?? skillImage, thumbnailUrl: idol?.thumbnailUrl ?? skillImage,
        plan: idol?.plan ?? catalog.planByCode?.[row.planType] ?? null,
        abilities: resolvedAbilities, isPrimaStella: row.isPrimaStella === true,
        stats: { vocal: integer(row.vocal), dance: integer(row.dance), visual: integer(row.visual), stamina: integer(row.stamina) } };
    });
  }
  const characterById = new Map(result.characters.map(row => [row.characterId, row]));
  result.idolCards = result.idolCards.map(card => {
    const characterGrowth = characterById.get(card.characterId) ?? null;
    return { ...card, characterGrowth, ...computeIdolGrowth(card, { ...card.raw, characterGrowth }) };
  });
  if (result.idolCards.some(card => card.growthStatus !== 'current_card')) result.warnings.push('일부 P아이돌은 보유 성장 보정 자료가 부족해 현재 성장률을 확정하지 못했습니다. 기본값과 미확인 항목을 구분해 표시합니다.');
  result.hifBonuses = computeHifBonuses(raw, catalog.hifGrowthPanels);
  result.memories = result.memories.map(memory => ({ ...memory,
    effects: summarizeMemoryEffects(memory, catalog, { plan: memory.plan, producerLevel: result.producerLevel }) }));
  result.complete = Object.values(result.collectionStatus).every(status => status === 'complete');
  if (!result.capturedAt) result.warnings.push('보유정보를 읽은 시각이 확인되지 않았습니다.');
  return result;
}

export async function loadInventory(snapshotPath, catalog) {
  let collectorStatus = null;
  try { collectorStatus = JSON.parse(await fs.readFile(snapshotPath + '.status.json', 'utf8')); } catch {}
  let raw;
  try { raw = JSON.parse(await fs.readFile(snapshotPath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') {
      const state = collectorStatus?.state ?? collectorStatus?.status;
      const failed = ['error', 'partial'].includes(state);
      const message = failed ? '현재 게임에서 보유 목록을 읽지 못했습니다. 수집 상태를 확인해 주세요.' :
        collectorStatus?.stage === 'stability' ? '보유 목록이 안정적으로 읽히는지 한 번 더 확인하고 있습니다.' :
        '게임을 실행해 로비에 도착하면 보유 목록을 불러옵니다.';
      return { inventory: emptyInventory(), raw: null,
        connection: { status: failed ? 'error' : 'waiting', capturedAt: null, message, collectorStage: collectorStatus?.stage ?? null } };
    }
    return { inventory: emptyInventory(), raw: null,
      connection: { status: 'error', capturedAt: null, message: '보유정보 파일을 읽지 못했습니다. 다시 수집해 주세요.' } };
  }
  try {
    const inventory = normalizeSnapshot(raw, catalog);
    const latestFailed = ['error','partial'].includes(collectorStatus?.state ?? collectorStatus?.status);
    if (latestFailed) inventory.warnings.push('최근 갱신에 실패해 마지막으로 저장한 보유 목록을 사용합니다.');
    const message = latestFailed ? '최근 갱신을 완료하지 못해 마지막 저장 목록을 표시합니다.' : inventory.complete ? '저장된 보유 목록을 불러왔습니다.' : '수집된 일부 보유 정보를 표시합니다.';
    return { inventory, raw, connection: { status: latestFailed ? 'partial' : inventory.complete ? 'complete' : 'partial',
      capturedAt: inventory.capturedAt, checkedAt: collectorStatus?.capturedAt ?? collectorStatus?.updatedAt ?? null,
      message, collectorState: collectorStatus?.state ?? collectorStatus?.status ?? null } };
  } catch (error) {
    return { inventory: emptyInventory(), raw: null, connection: { status: 'error', capturedAt: null, message: error.message } };
  }
}

export async function importSnapshot(snapshotPath, raw, catalog) {
  const inventory = normalizeSnapshot(raw, catalog);
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  const temporary = `${snapshotPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(raw, null, 2), 'utf8');
  await fs.rename(temporary, snapshotPath);
  return inventory;
}
