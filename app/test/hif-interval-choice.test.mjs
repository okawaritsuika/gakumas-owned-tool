import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {recommendHifInterval} from '../lib/hif-interval-choice.mjs';

const offer=(drinkId,price=100)=>({drinkId,price});
function interval(carry,third=true){
  const r1Reward=200;
  return {postR1P:carry+r1Reward,heldDrinkIds:['kept'],freeSlots:3,desiredDrinkIds:['A','B','C'],
    offers:[offer('A')],nextRefreshCost:10,
    futureShops:[{offers:[offer('B')],nextRefreshCost:10},{offers:third?[offer('C')]:[]}]};
}

test('319P buys the visible A but cannot pay 300P and two 10P refreshes',()=>{
  const result=recommendHifInterval(interval(119));
  assert.deepEqual(result.current.purchases.map(row=>row.drinkId),['A']);
  assert.equal(result.current.remainingP,219);
  assert.equal(result.conditional.plan.allDesired,false);
  assert.equal(result.conditional.plan.purchases.length,2);
  assert.equal(result.conditional.minimumP,320);
  assert.match(result.conditional.summary,/1P 부족/);
});

test('320P buys all three only under the supplied two-refresh lineup',()=>{
  const result=recommendHifInterval(interval(120));
  assert.equal(result.current.allDesired,false);
  const plan=result.conditional.plan;
  assert.equal(plan.allDesired,true);
  assert.deepEqual(plan.purchases.map(({page,drinkId})=>[page,drinkId]),[[0,'A'],[1,'B'],[2,'C']]);
  assert.equal(plan.remainingP,0);
  assert.equal(plan.remainingSlots,0);
  assert.equal(plan.refreshSpend,20);
  assert.equal(recommendHifInterval(interval(120,false)).conditional.plan.allDesired,false);
  assert.equal(recommendHifInterval(interval(120,false)).conditional.minimumP,null);
});

test('current prices, held copies, displayed stock and free slots change the legal basket',()=>{
  const input={...interval(0),desiredDrinkIds:['A','A','B','C'],heldDrinkIds:['A'],
    offers:[offer('A',90),offer('A',3),offer('B',4),offer('C',5)],futureShops:[]};
  const result=recommendHifInterval({...input,postR1P:12});
  assert.equal(result.current.allDesired,true);
  assert.deepEqual(result.current.purchases.map(row=>row.offerIndex),[1,2,3]);
  assert.equal(recommendHifInterval({...input,freeSlots:2}).current.purchases.length,2);
  assert.equal(recommendHifInterval({...input,freeSlots:0}).current.purchases.length,0);
  assert.equal(recommendHifInterval({...input,offers:[offer('A',200)]}).current.purchases.length,1);
  assert.equal(recommendHifInterval({...input,offers:[offer('A',201)]}).current.purchases.length,0);
});

test('unknown menu and prices stay unknown and unknown later refresh costs are never extrapolated',()=>{
  assert.equal(recommendHifInterval().status,'unconfirmed');
  assert.equal(recommendHifInterval({...interval(120),offers:[{drinkId:'A'}]}).current,null);
  const input=interval(120);
  delete input.futureShops[0].nextRefreshCost;
  assert.equal(recommendHifInterval(input).conditional.plan.allDesired,false);
  const firstUnknown=recommendHifInterval({...input,nextRefreshCost:null});
  assert.deepEqual(firstUnknown.conditional.plan.purchases,firstUnknown.current.purchases);
  const futureUnknown=recommendHifInterval({...input,futureShops:undefined});
  assert.equal(futureUnknown.current.purchases.length,1);
  assert.equal(futureUnknown.conditional.plan,null);
});

test('visible cards share the P balance and stock limit with drinks but require no drink slot',()=>{
  const input={...interval(120),postR1P:100,freeSlots:0,desiredDrinkIds:['A'],desiredCardIds:['A','A','B'],
    offers:[offer('A',5),{cardId:'A',price:60},{cardId:'B',price:50}],futureShops:[]};
  const full=recommendHifInterval(input).current;
  assert.deepEqual(full.purchases.map(row=>row.cardId),['B']);
  assert.equal(full.remainingSlots,0);
  assert.equal(full.remainingP,50);
  const mixed=recommendHifInterval({...input,freeSlots:1,postR1P:115}).current;
  assert.equal(mixed.purchases.length,3);
  assert.equal(mixed.remainingP,0);
  assert.deepEqual(mixed.missingCardIds,['A']);
  assert.deepEqual(mixed.missingDrinkIds,[]);
  assert.equal(mixed.allDesired,false);
});

test('form distinguishes empty stock from an unobserved menu and preserves conditional pages',()=>{
  const context={escapeHtml:value=>String(value).replaceAll('<','&lt;')};
  runInNewContext(readFileSync(new URL('../web/hif-interval.js',import.meta.url),'utf8'),context);
  const values={heldDrinkIds:'kept',freeSlots:'3',desiredDrinkIds:'A, B, C',offers:'A 100',
    nextRefreshCost:'10',futureShops:'B 100 | 10\nC 100'};
  const scope={querySelector:selector=>({value:values[selector.match(/"(.+)"/)[1]]})};
  const read=()=>recommendHifInterval({...context.readHifIntervalInputs(scope),postR1P:320});
  assert.equal(read().conditional.plan.allDesired,true);
  values.offers='없음';
  assert.equal(read().current.purchases.length,0);
  values.offers='';
  assert.equal(read().current,null);
  values.offers='[카드] 메인 스킬 50';
  values.desiredCardIds='메인 스킬';
  values.freeSlots='0';
  assert.equal(read().current.purchases[0].cardId,'메인 스킬');
  assert.match(context.hifIntervalInputs(interval(120)),/B 100 \| 10\nC 100/);
  assert.match(context.hifIntervalResult({summary:'<음료>',conditional:{summary:'<조건>'}}),/&lt;조건>/);
});
