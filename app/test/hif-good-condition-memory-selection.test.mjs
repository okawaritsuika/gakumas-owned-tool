import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';
import {recommend} from '../lib/recommend.mjs';
import {buildMemorySelectionReview} from '../lib/memory-selection-review.mjs';
import {goodConditionFixture,sumikaId,chinaId,presenceId,declarationId,spotlightId,topicId,chorusId} from './fixtures/hif-good-condition-memories.mjs';

const catalog=loadCatalog({
  dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url)),
  translationDir:fileURLToPath(new URL('../data/translations',import.meta.url)),
});
const ids=rows=>rows.map(m=>m.modelEffects.carriedSkill.id).sort();
const baseThree=[chorusId,spotlightId,topicId];
function compare(input,idolGameId,options={}){
  const settings={...input.options,idolGameId,...options};
  const result=recommend({...input,options:settings});
  return {result,review:buildMemorySelectionReview({result,catalog:input.catalog,inventory:input.inventory,options:settings})};
}
test('ordinary HIF good condition carries the prepared concentration copy for Sumika and the alternative for China',()=>{
  const input=goodConditionFixture(catalog);
  const sumika=compare(input,sumikaId),china=compare(input,chinaId);
  assert.deepEqual(ids(sumika.result.memories),[...baseThree,presenceId].sort());
  assert.deepEqual(ids(china.result.memories),[...baseThree,declarationId].sort());
  assert.match(sumika.review.concentrationDecision.reason,/존재감/);
  assert.match(china.review.concentrationDecision.reason,/존재감/);
  assert.notEqual(china.review.concentrationDecision.reason,sumika.review.concentrationDecision.reason);
  assert.deepEqual(input.inventory.memories.map(m=>m.produceCard.id),[...baseThree,presenceId,declarationId]);
});
test('China can still carry Presence when those are the four available copies',()=>{
  const input=goodConditionFixture(catalog);
  input.inventory.memories=input.inventory.memories.filter(m=>m.produceCard.id!==declarationId);
  assert.deepEqual(ids(compare(input,chinaId).result.memories),[...baseThree,presenceId].sort());
});
test('China can choose Presence over the same available alternative when her native conversion falls below the cost',()=>{
  const input=goodConditionFixture(catalog);
  input.inventory.idolCards.find(card=>card.gameId===chinaId).potentialRank=0;
  const {result,review}=compare(input,chinaId);
  assert.deepEqual(ids(result.memories),[...baseThree,presenceId].sort());
  assert.match(review.concentrationDecision.reason,/20%/);
  assert.match(review.concentrationDecision.reason,/아이돌 선언/);
});
test('a manual Presence target stays selectable for China and stats mode uses the higher stat copy for both idols',()=>{
  const input=goodConditionFixture(catalog);
  assert.ok(ids(compare(input,chinaId,{desiredSkillIds:[presenceId]}).result.memories).includes(presenceId));
  for(const idol of [sumikaId,chinaId]){
    const {result,review}=compare(input,idol,{memorySelectionMode:'stats'});
    assert.ok(ids(result.memories).includes(declarationId));
    assert.ok(!review.concentrationDecision);
  }
});
