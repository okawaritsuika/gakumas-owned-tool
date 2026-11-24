import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';
import {HIF_PEAK_PLV,buildHifPeakDeck} from '../lib/hif-peak-decks.mjs';
import {buildHifOutfitRoutes} from '../lib/hif-outfit-routes.mjs';
import {buildIdolRecommendation} from '../lib/pidol-recommendation.mjs';

const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});
const advice=new Map(catalog.skillAdvice.cards.map(r=>[r.id,r]));
function outfit(id) {
  const card=catalog.idolCards.find(c=>c.gameId===id);
  return {...card,specialTrainingRank:Math.max(...card.specialTrainingStages.map(s=>s.rank))};
}
function compare(card,deck){
  const keys=card.uniqueIds;
  const skills=[keys.produceCardId,keys.secondProduceCardId].filter(Boolean).map(id=>catalog.idolEffectData.skills[id+':1']);
  return buildHifOutfitRoutes({catalog,card,skills,item:catalog.idolEffectData.items[keys.afterProduceItemId],
    plv:HIF_PEAK_PLV,...deck});
}
test('every published ordinary HIF outfit receives four legal memory variants under the same full-unlock benchmark',()=>{
  const participants=catalog.idolCards.filter(c=>!c.excludedScenarios?.includes('hif') && c.recommendationEligible!==false);
  assert.ok(participants.length>=150);
  assert.equal(HIF_PEAK_PLV,Math.max(...catalog.skillAdvice.cards.filter(r=>!r.status.releaseExcluded).map(r=>r.unlock.acquisitionProducerLevel??0)));
  for(const card of participants) {
    const d=buildHifPeakDeck({catalog,card});
    assert.deepEqual(d.missing,[],card.nameJa);
    assert.equal(new Set(d.preparedCards.map(p=>p.gameId)).size,4);
    assert.equal(d.preparedCards.filter(p=>p.source==='rental').length,1);
    assert.equal(d.preparedCards.filter(p=>p.phase==='produce_start').length,2);
    assert.ok(d.sourceUrls.length);
    for(const p of d.preparedCards) {
      assert.equal(p.upgradeCount,1);
      const r=advice.get(p.gameId);
      if(r.unlock.requiresConversionSelection) assert.ok(d.selectedSwitchIds.includes(p.gameId));
    }
  }
});
test('published hold recovery deck carries the exact leveled wing after the selected switch with custom costs and growth',()=>{
  const card=outfit('i_card-kcna-3-019'), d=buildHifPeakDeck({catalog,card});
  const routes=compare(card,d), wing=d.preparedCards.find(p=>advice.get(p.gameId).nameJa==='羽ばたけ！');
  assert.deepEqual(wing.customizations.map(x=>[x.publicId,x.level]),[[35,1]]);
  assert.ok(d.selectedSwitchIds.includes(wing.gameId));
  assert.deepEqual(routes.final.missing,[]);
  const actual=routes.final.cards.find(c=>c.id===wing.gameId).definition;
  assert.ok(actual.effects.some(g=>g.phase==='prestage' && g.actions.some(a=>a.lhs==='g.typedCost' && a.rhs.value===1)));
  const late=d.preparedCards.find(p=>advice.get(p.gameId).nameJa==='仕切り直し');
  assert.ok(!routes.selection.deck.includes(late.gameId) && routes.finalR2.deck.includes(late.gameId));
  const bad={...d,preparedCards:d.preparedCards.map(p=>p!==wing?p:{...p,customizations:[{...p.customizations[0],level:3}]})};
  assert.ok(compare(card,bad).final.missing.some(m=>m.includes('반입 개조')));
});
test('completed decks carry distinct guide-selected copy targets for Campus Temari and Garakuta Hiro',()=>{
  for(const [id,target] of [['i_card-ttmr-3-007','至高のエンタメ'],['i_card-shro-3-018','脚光']]){
    const card=outfit(id),d=buildHifPeakDeck({catalog,card}),r=compare(card,d);
    const memory=d.preparedCards.find(p=>p.copyTarget);
    assert.equal(advice.get(memory.gameId).nameJa,target);
    assert.equal(r.final.copyTargetId,memory.gameId);
    assert.equal(r.finalR2.copyTargetId,memory.gameId);
    assert.deepEqual(r.finalR2.missing,[]);
  }
});
test('end-of-turn stock gates and good-condition copy finishers run in the ranked stages',()=>{
  const stages=id=>buildIdolRecommendation({card:outfit(id),catalog,data:catalog.idolEffectData,
    scope:'hif',plv:72,traceHif:true}).hif.stages;
  const charge=stages('i_card-kllj-3-015');
  assert.ok(charge.final.itemTriggers>=1);
  assert.equal(charge.finalR2.itemTriggers,3);
  assert.ok(charge.finalR2.route.goalPriorities.some(r=>r.condition.field==='fullPowerCharge' && r.condition.value===10));
  const mood=stages('i_card-jsna-3-002');
  assert.equal(advice.get(mood.final.route.copyTargetId).nameJa,'話題沸騰');
  for(const stage of [mood.final,mood.finalR2]) assert.equal(stage.itemTriggers,2);
  assert.equal(mood.final.comparison.withOutfit.trace.filter(e=>e.kind==='turnEnd').length,11);
});
