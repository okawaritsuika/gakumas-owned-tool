import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSnapshot, loadInventory, importSnapshot } from '../lib/inventory.mjs';
import { computeIdolGrowth } from '../lib/idol-growth.mjs';
import { loadCatalog } from '../lib/catalog.mjs';
import { createLiveCatalog, masterTables } from '../lib/live-catalog.mjs';
import { readMasterSnapshot } from '../lib/live-master.mjs';

const catalog = {
  supportCards: [{gameId:'support-a',internalId:'internal-a',nameJa:'A'}],
  idolCards: [{gameId:'idol-a',name:'아이돌',plan:'logic'}],
  skillCards: [{gameId:'skill-a',name:'기본',upgradeCount:0},{gameId:'skill-a',name:'강화+',upgradeCount:1}],
  memoryAbilities: [],
};
function snapshot() {
  const lists = {
    userSupportCardList:[{supportCardId:'support-a',level:25,levelLimitRank:2}],
    userIdolCardList:[{idolCardId:'idol-a',levelLimitRank:1,potentialRank:2}],
    userMemoryList:[{userMemoryId:'memory-a',idolCardId:'idol-a',produceCard:{id:'skill-a',upgradeCount:0,customizes:[]},abilities:[],vocal:500}],
    userCharacterList:[],
  };
  return {schemaVersion:1,capturedAt:'2026-11-03T00:00:00Z',capture:{status:'complete',collections:Object.fromEntries(Object.entries(lists).map(([key,rows])=>[key,{status:'complete',expectedCount:rows.length,exportedCount:rows.length}]))},...lists};
}
test('normalization preserves actual support level, base skill variant and independent memory identity',()=>{
  const actual=normalizeSnapshot(snapshot(),catalog);
  assert.equal(actual.complete,true);
  assert.equal(actual.supportCards[0].level,25);
  assert.equal(actual.supportCards[0].uncap,2);
  assert.equal(actual.memories[0].name,'기본');
  assert.equal(actual.memories[0].id,'memory-a');
  assert.equal(actual.memories[0].plan,'logic');
});
test('missing growth fields remain owned unknown values rather than disappearing or becoming zero',()=>{
  const raw=snapshot();raw.userSupportCardList[0].level=null;
  const actual=normalizeSnapshot(raw,catalog);
  assert.equal(actual.supportCards.length,1);
  assert.equal(actual.supportCards[0].level,null);
  assert.equal(actual.collectionStatus.supportCards,'partial');
  assert.equal(actual.counts.supportCards,null);
  assert.equal(actual.complete,false);
});
test('artwork follows owned training stage and the memory skill uses its own character and upgrade',()=>{
  const raw=snapshot();
  raw.userIdolCardList[0].levelLimitRank=4;
  raw.userMemoryList[0].characterId='hski';
  raw.userMemoryList[0].produceCard.upgradeCount=1;
  const illustrated={...catalog,
    idolCards:[{...catalog.idolCards[0],characterId:'hski',characterNameJa:'花海 咲季',
      illustrationVariants:{before:{imageUrl:'/assets/before.png',thumbnailUrl:'/assets/before-small.png'},after:{imageUrl:'/assets/after.png',thumbnailUrl:'/assets/after-small.png'}}}],
    skillCards:[{...catalog.skillCards[0],imageUrl:'/assets/base.png'},
      {...catalog.skillCards[1],nameJa:'強化+',imageUrl:'/assets/generic.png',characterIconUrls:{hski:'/assets/saki-plus.png',ttmr:'/assets/temari-plus.png'}}],
  };
  const actual=normalizeSnapshot(raw,illustrated);
  assert.equal(actual.complete,true);
  assert.equal(actual.idolCards[0].imageUrl,'/assets/after.png');
  assert.equal(actual.idolCards[0].thumbnailUrl,'/assets/after-small.png');
  assert.equal(actual.memories[0].skillImageUrl,'/assets/saki-plus.png');
  assert.equal(actual.memories[0].skillNameJa,'強化+');
  assert.equal(actual.memories[0].characterNameJa,'花海 咲季');
  assert.equal(actual.memories[0].stats.vocal,500);
});
test('missing counts and duplicated records cannot claim complete ownership',()=>{
  const raw=snapshot();raw.capture.collections.userCharacterList.expectedCount=null;
  raw.userSupportCardList.push({...raw.userSupportCardList[0]});
  const actual=normalizeSnapshot(raw,catalog);
  assert.equal(actual.collectionStatus.characters,'partial');
  assert.equal(actual.supportCards.length,1);
  assert.equal(actual.complete,false);
});
test('missing snapshot is unknown and validated empty collections are genuinely empty',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gakumas-import-'));
  const filename=path.join(dir,'inventory.json');
  try {
    const before=await loadInventory(filename,catalog);
    assert.equal(before.connection.status,'waiting');
    assert.equal(before.inventory.counts.memories,null);
    const raw=snapshot();raw.userMemoryList=[];raw.capture.collections.userMemoryList={status:'complete',expectedCount:0,exportedCount:0};
    await importSnapshot(filename,raw,catalog);
    const after=await loadInventory(filename,catalog);
    assert.equal(after.inventory.counts.memories,0);
    assert.equal(after.inventory.complete,true);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('gakumas-import-'));
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test('growth uses exact cumulative awakening once and earned True Ends once',()=>{
  const card={characterId:'test',baseStats:{growthRatePermil:{vo:100,da:100,vi:100}},awakeningStages:[
    {rank:1,growthRatePermilDelta:{vo:10,da:0,vi:0},cumulativeDeltaArithmetic:{growthRatePermil:{vo:10,da:0,vi:0}}},
    {rank:2,growthRatePermilDelta:{vo:10,da:10,vi:0},cumulativeDeltaArithmetic:{growthRatePermil:{vo:20,da:10,vi:0}}},
  ],characterBonuses:{characterId:'test',trueEndBonuses:[
    {scenarioEnum:'ProduceType_FirstStar',growthRatePermilDelta:{vo:40,da:40,vi:0}},
    {scenarioEnum:'ProduceType_HatsuboshiIdolFestival',growthRatePermilDelta:{vo:0,da:30,vi:30}},
  ]}};
  const actual=computeIdolGrowth(card,{potentialRank:2,characterGrowth:{characterId:'test',trueEndProduceTypes:[1,1],dearnessPoint:99999}});
  assert.deepEqual(actual.currentGrowthRatePermil,{vo:160,da:150,vi:100});
  assert.deepEqual(actual.growthBreakdown.awakening,{vo:20,da:10,vi:0});
  assert.deepEqual(actual.growthBreakdown.trueEnd,{vo:40,da:40,vi:0});
  assert.equal(actual.growthBreakdown.appliedTrueEndBonuses.length,1);
  assert.equal(actual.growthStatus,'current_card');
  assert.deepEqual(card.baseStats.growthRatePermil,{vo:100,da:100,vi:100});
});

test('unknown growth adjustments are not asserted to be zero current growth',()=>{
  const card={characterId:'test',baseStats:{growthRatePermil:{vo:100,da:120,vi:140}},awakeningStages:[]};
  const absent=computeIdolGrowth(card,{potentialRank:0});
  assert.equal(absent.currentGrowthRatePermil,null);
  assert.equal(absent.growthStatus,'partial');
  assert.ok(absent.growthBreakdown.issues.some(issue=>issue.code==='true_end_state_unknown'));
  const noClears=computeIdolGrowth(card,{potentialRank:0,characterGrowth:{characterId:'test',trueEndProduceTypes:[]}});
  assert.deepEqual(noClears.currentGrowthRatePermil,{vo:100,da:120,vi:140});
  const missingRank=computeIdolGrowth(card,{characterGrowth:{characterId:'test',trueEndProduceTypes:[]}});
  assert.equal(missingRank.currentGrowthRatePermil,null);
  assert.equal(missingRank.growthBreakdown.awakening,null);
  const unsupported=computeIdolGrowth(card,{potentialRank:0,characterGrowth:{characterId:'test',trueEndProduceTypes:[99]}});
  assert.equal(unsupported.currentGrowthRatePermil,null);
  assert.equal(computeIdolGrowth({},{}).growthStatus,'unknown');
});

test('actual account growth: every owned rank and newly earned True End cross-checks the native source',async t=>{
  const snapshotPath = fileURLToPath(new URL('../../outputs/학마스_보유노트/data/inventory.json', import.meta.url));
  let raw;
  try {
    raw=JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
  } catch(error) {
    if(error.code==='ENOENT'){t.skip('개인 계정·공개 마스터 스냅샷이 없는 배포 환경');return;}
    throw error;
  }
  const appDir = fileURLToPath(new URL('../', import.meta.url)), cacheDir = path.join(path.dirname(snapshotPath), 'live-catalog');
  const store = createLiveCatalog({ appDir, cacheDir, loadBase: () => loadCatalog({ dataDir: path.join(appDir, 'data/catalog') }) });
  t.after(() => store.close());
  const catalog = store.current.catalog, actual = normalizeSnapshot(raw, catalog);
  const edition = [path.join(cacheDir, 'master.json.gz'), path.join(appDir, 'data/catalog/live-master.json.gz')]
    .map(file => readMasterSnapshot(file, masterTables)).find(data => data?.commit === catalog.dataFreshness.liveMaster?.commit);
  assert.ok(edition, 'current native master for the account comparison');
  const source = edition.tables, original = new Map(source.IdolCard.map(row => [row.id, row]));
  const characters = new Map(source.Character.map(row => [row.id, row]));
  const ownedCharacters=new Map(raw.userCharacterList.map(row=>[row.characterId,row]));
  const literalEnums={1:'ProduceType_FirstStar',2:'ProduceType_NextIdolAudition',3:'ProduceType_HatsuboshiIdolFestival'};
  assert.equal(actual.idolCards.length,raw.userIdolCardList.length);
  for(const card of actual.idolCards){
    const master=original.get(card.gameId);
    assert.ok(master,`master identity ${card.gameId}`);
    assert.equal(card.growthStatus,'current_card',card.gameId+': '+JSON.stringify(card.growthBreakdown.issues));
    const clears=new Set(ownedCharacters.get(master.characterId).trueEndProduceTypes.map(code=>literalEnums[code]));
    const bonusId = characters.get(master.characterId).characterTrueEndBonusId;
    const bonuses = source.CharacterTrueEndBonus.filter(row => row.id === bonusId && clears.has(row.produceType));
    const stages = source.IdolCardPotential.filter(row => row.id === master.idolCardPotentialId && Number(row.rank.split('__')[1]) <= card.raw.potentialRank);
    // Read the independent native increments directly, before the app's stage and growth conversions.
    for (const [axis, field] of Object.entries({ vo: 'produceVocalGrowthRatePermil', da: 'produceDanceGrowthRatePermil', vi: 'produceVisualGrowthRatePermil' })) {
      const awakening = stages.reduce((sum, row) => sum + row[field], 0), bonus = bonuses.reduce((sum, row) => sum + row[field], 0);
      assert.equal(card.growthBreakdown.base[axis], master[field], card.gameId);
      assert.equal(card.growthBreakdown.awakening[axis], awakening, card.gameId);
      assert.equal(card.growthBreakdown.trueEnd[axis], bonus, card.gameId);
      assert.equal(card.currentGrowthRatePermil[axis], master[field] + awakening + bonus, `${card.gameId}:${axis}`);
    }
  }
  assert.ok(actual.idolCards.some(card => card.gameId === 'i_card-kllj-3-015'));
});
