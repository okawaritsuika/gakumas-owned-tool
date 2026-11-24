import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';
import {buildHifOutfitRoutes} from '../lib/hif-outfit-routes.mjs';
import {evaluateHifOutfitRoute} from '../lib/hif-outfit-ledger.mjs';

const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});
function fixture(id,plv=72,rank=4,extras=[]) {
  const card={...catalog.idolCards.find(c=>c.gameId===id),specialTrainingRank:rank};
  const ids=card.uniqueIds, data=catalog.idolEffectData;
  const skills=[ids.produceCardId,ids.secondProduceCardId].filter(Boolean)
    .map((id,i)=>data.skills[id+':'+Number(rank>=(i===0?3:6))]);
  const item=data.items[ids.beforeProduceItemId], input={catalog,card,skills,item,plv,preparedCards:extras};
  return {...input,...buildHifOutfitRoutes(input)};
}
test('an ordinary final conversion has an acquisition phase and level; a selected memory uses its own phase',()=>{
  const id='i_card-kllj-3-018', fin='p_card-02-act-3_039';
  const low=fixture(id,43), high=fixture(id,44);
  assert.ok(!low.selection.deck.includes(fin) && !low.final.deck.includes(fin));
  assert.ok(!high.selection.deck.includes(fin) && high.final.deck.includes(fin));
  assert.equal(high.final.preparation.find(p=>p.id===fin).source,'representative_acquisition');
  const mid=fixture(id,43,4,[{gameId:fin,phase:'after_mid_audition',upgradeCount:1}]);
  assert.ok(!mid.selection.deck.includes(fin));
  assert.equal(mid.final.preparation.find(p=>p.id===fin).source,'selected_memory');
  assert.equal(mid.final.cards.find(r=>r.id===fin).definition.upgraded,true);
});
test('the training grant actually replaces one matching native starter with the upgraded card',()=>{
  const saki=fixture('i_card-hski-3-008',1,1), basic=fixture('i_card-hski-3-008',1,0);
  const changed=saki.selection.preparation.find(p=>p.source==='trained_starting_replacement');
  assert.deepEqual([changed.replaces,changed.id,changed.upgrade],['p_card-01-act-0_023','p_card-01-act-1_002',1]);
  assert.ok(!basic.selection.preparation.some(p=>p.source==='trained_starting_replacement'));
  assert.equal(saki.selection.cards.find(r=>r.id===changed.id).definition.upgraded,true);
  assert.equal(saki.selection.deck.filter(id=>id===changed.replaces).length,
    basic.selection.deck.filter(id=>id===changed.replaces).length-1);
  assert.deepEqual(saki.final.preparation.find(p=>p.source==='basic_removals').ids.filter(id=>id===changed.id),[]);
});
test('prepared native decks realize replay, delayed score, and sleep-in-hand in both actual H.I.F. stages',()=>{
  for(const [id,kind] of [['i_card-kllj-3-018','replay'],['i_card-kllj-3-010','reservation'],['i_card-kllj-3-022','sleep']]) {
    const input=fixture(id);
    for(const stage of ['selection','final']) {
      const route=input[stage], {skills,item}=input;
      assert.deepEqual(route.missing,[]);
      const result=evaluateHifOutfitRoute({route,skills,item,plan:input.card.plan,trace:true});
      assert.equal(result.missing,'');
      const {trace,freePlays,itemTriggers}=result.withOutfit;
      assert.ok(itemTriggers>0);
      const unique=skills[0].id;
      if(kind==='replay') {assert.equal(freePlays[unique],2);assert.equal(itemTriggers,2);}
      if(kind==='reservation') assert.ok(trace.some(x=>x.id===unique && x.kind==='reservation' && x.cumulativeFullPowerCharge>=5));
      if(kind==='sleep') {
        assert.ok(trace.some(x=>x.id===unique && x.kind==='play' && x.goodConditionTurns>=8));
        assert.ok(trace.some(x=>x.kind==='itemTrigger' && x.hand.includes('23')));
        assert.ok(result.withoutOutfit.parameter>0);
      }
    }
  }
});

test('HIF R2 carries the native cheering stick and only explicitly selected, unlocked switches enter a route',()=>{
  const input=fixture('i_card-kcna-3-019');
  const switched='p_card-03-act-3_189';
  const selected={...input,selectedSwitchIds:[switched]};
  const locked=buildHifOutfitRoutes({...selected,preparedCards:[{gameId:switched,phase:'produce_start',source:'rental'}]});
  const unselected=buildHifOutfitRoutes({...input,plv:80});
  const high=buildHifOutfitRoutes({...selected,plv:80});
  for(const stage of ['selection','final','finalR2']) {
    assert.ok(!locked[stage].deck.includes(switched));
    assert.ok(!unselected[stage].deck.includes(switched));
  }
  assert.ok(high.final.deck.includes(switched));
  const hit=high.final.preparation.find(x=>x.id===switched);
  assert.deepEqual([hit.minPlv,hit.selectedSwitchFrom],[80,'p_card-03-act-3_057']);
  assert.deepEqual([high.selection.turnCount,high.final.turnCount,high.finalR2.turnCount],[10,9,12]);
  assert.equal(high.final.stageEffects,undefined);
  assert.equal(high.finalR2.stageEffects[0].phase,'startOfStage');
  assert.equal(high.finalR2.stageEffects[0].conditions[0].right.value,22);
  assert.ok(high.finalR2.generatedBasicCardIds.length>1);
  assert.deepEqual(high.final.deck.slice().sort(),high.finalR2.deck.slice().sort());
});

test('a concentration increase threshold can be met by a single acquired card at its actual level',()=>{
  const card='p_card-01-men-2_041';
  assert.ok(fixture('i_card-ssmk-3-012',36).selection.deck.includes(card));
  assert.ok(!fixture('i_card-ssmk-3-012',35).selection.deck.includes(card));
});
