import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';

const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});

test('expanded author support lists bind exact native variants, legal plans and local support identities',()=>{
  const data=catalog.guideSupportProfiles;
  assert.ok(data.profiles.length>100);
  const sources=new Set(data.sources.map(row=>row.id)),ids=new Set();
  for(const profile of data.profiles){
    const idol=catalog.idolCards.find(row=>row.gameId===profile.idolCardId);
    assert.ok(idol,profile.id);assert.equal(profile.plan,idol.plan);
    assert.ok(!ids.has(idol.gameId));ids.add(idol.gameId);
    assert.equal(profile.eventScope,'ordinary_hif');
    assert.deepEqual(profile.expectedUniqueIds,idol.uniqueIds);
    assert.equal(profile.idealSupports.length,6);assert.equal(profile.alternativeSupports.length,8);
    const pool=[...profile.idealSupports,...profile.alternativeSupports];
    assert.equal(new Set(pool.map(row=>row.gameId)).size,14);
    assert.ok(profile.sourceIds.every(id=>sources.has(id)));
    for(const ref of pool){
      const card=catalog.supportCards.find(row=>row.gameId===ref.gameId);
      assert.ok(card,profile.id+': '+ref.nameJa);
      assert.equal(ref.nameJa,card.nameJa);
      assert.ok([profile.plan,'free'].includes(card.plan));
      assert.ok(card.imageUrl?.startsWith('/assets/'));
      assert.equal(ref.maximumLevelValuesApplied,false);
      assert.equal(ref.requiresCurrentLevelReevaluation,true);
    }
  }
});
