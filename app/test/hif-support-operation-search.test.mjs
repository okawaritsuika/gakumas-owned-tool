import test from 'node:test';
import assert from 'node:assert/strict';
import {groupSupportEffects, linkedSupportStarts} from '../lib/hif-support-search.mjs';

const row = (gameId, add={}) => ({gameId,providedActions:{},dynamicEffects:[],supportOperations:[],...add});
const receives = (kind,amount) => ({kind,amount,usedCount:0,maxCount:5});
function starts(cards, peak) {
  const groups=groupSupportEffects(cards,peak);
  const fits=rows=>rows.length<=5 && new Set(rows.map(row=>row.gameId)).size===rows.length;
  return linkedSupportStarts(groups,new Set(cards),fits,()=>0).starts.map(rows=>rows.map(row=>row.gameId).sort().join(','));
}

test('a known keyword receipt, P-item upgrade and third-party typed receiver survive together', () => {
  const provider=row('source',{supportOperations:[{action:'acquire',card:{type:'mental',keywords:['good_impression']}}]});
  const item=row('item',{itemResponse:{kind:'good_impression_card_acquire',limit:1,routeCount:0,selfCount:0,
    stats:{},resources:{},operations:[{action:'upgrade',target:'active'}]}});
  const receiver=row('receiver',{dynamicEffects:[receives('a_skill_enhance',40)]});
  assert.ok(starts([provider,item,receiver]).includes('item,receiver,source'));
  const unknown=row('unknown',{supportOperations:[{action:'acquire'}]});
  assert.ok(!starts([unknown,item,receiver]).includes('item,receiver,unknown'));
});

test('size-only copies can fill SP and exam deficits; known keyword holdings can be increased by copying a legal target', () => {
  const template=Array(7).fill({gameId:'known',keywords:['good_impression'],noDeckDuplication:false,type:'mental'});
  const plan={start:template,ops:[],baseline:{lessonDeckSizes:[18],actions:[{triggerCounts:{skill_acquire:1},keywordCardCountsAfter:{good_impression:7}}]}};
  const peak={examDeckSizes:[14],cardTargetPlan:plan};
  const c1=row('c1',{supportOperations:[{action:'copy',target:'mental'}]});
  const c2=row('c2',{supportOperations:[{action:'copy',target:'mental'}]});
  const ex=row('exam',{dynamicEffects:[receives('exam_15',20)]});
  const sp=row('sp',{dynamicEffects:[receives('sp_lesson_20',35)]});
  const kw=row('keyword',{dynamicEffects:[receives('good_impression_card_acquire_8',30)]});
  const seeds=starts([c1,c2,ex,sp,kw],peak);
  assert.ok(seeds.includes('c1,c2,sp'));
  assert.ok(seeds.includes('c1,exam'));
  assert.ok(seeds.includes('c1,keyword'));
  const illegal=row('off-type',{supportOperations:[{action:'copy',target:'active'}]});
  assert.ok(!starts([illegal,kw],peak).includes('keyword,off-type'));
});
