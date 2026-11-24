import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL(file,import.meta.url),'utf8');
const {events} = JSON.parse(read('../data/catalog/scenario_events.json'));
const ctx = vm.createContext({});
vm.runInContext(read('../web/event-choice-guide.js'),ctx);
const compare = (event,goal,offered,resources={}) => ctx.compareEventChoices(event,{goal,offered:new Set(offered),...resources});
const outing=events.find(event=>event.id==='event-detail-activity-003-produce_007-before_2nd-01');

test('HIF recovery recommends the free offered choice and distinguishes blank P from zero',()=>{
  assert.match(compare(outing,'recover',[]),/체크하세요/);
  assert.match(compare(outing,'recover',[0]),/현재 P포인트 입력 필요/);
  assert.match(compare(outing,'recover',[0],{pp:0}),/비용 부족.*50 필요 · 현재 0/);
  const recovery=compare(outing,'recover',[0,1,2],{pp:50});
  assert.match(recovery,/3번 · 최대 체력의 60%/);
  assert.doesNotMatch(recovery,/[12]번/);
  const stronger=compare(outing,'upgraded',[0,1,2],{pp:50});
  assert.match(stronger,/1번 .*P포인트 50 소비/);
  assert.match(stronger,/2번 .*졸음 1장 획득/);
  assert.doesNotMatch(stronger,/3번/);
  assert.match(compare(outing,'upgraded',[2],{pp:100}),/원하는 보상을 찾지/);
});

test('school keeps success and failure rewards and checks payment at the exact boundary',()=>{
  const school=events.find(event=>event.id==='event-detail-school-001-amao-024');
  assert.match(compare(school,'visual',[1],{stamina:3}),/체력 4 필요 · 현재 3/);
  const result=compare(school,'visual',[1],{stamina:4});
  assert.match(result,/40% 확률로 성공: 비주얼 \+110/);
  assert.match(result,/60% 확률로 실패: 비주얼 \+40/);
});

test('NIA business compares the selected attribute only among offers and preserves common rewards',()=>{
  const business=events.find(event=>event.id==='event-detail-business-produce_005-plan2-produce_drink-before_1st-01-049');
  assert.match(compare(business,'dance',[0,1]),/2번 · 댄스 \+80/);
  assert.match(compare(business,'dance',[0]),/원하는 보상을 찾지/);
  assert.match(compare(business,'votes',[0,1]),/1번 .*팬 투표수 \+2400[\s\S]*2번 .*팬 투표수 \+2400/);
});

test('a larger fixed gain wins at equal cost, an unknown cost remains unresolved',()=>{
  const event={choices:[{rewards:['보컬 +20'],costs:[]},{rewards:['보컬 +40'],costs:[]},{rewards:['보컬 +100'],costs:['새 비용']}]};
  const result=compare(event,'vocal',[0,1,2],{pp:100,stamina:40});
  assert.match(result,/2번 · 보컬 \+40/);
  assert.doesNotMatch(result,/1번/);
  assert.match(result,/3번의 비용 확인 필요/);
});

test('a lesson starts the chosen attribute without inventing a stat gain',()=>{
  const lessons=events.find(event=>event.id==='event-detail-school-001-amao-022');
  assert.match(compare(lessons,'danceLesson',[0,1,2]),/2번 · 댄스 일반 레슨 시작/);
  assert.match(compare(lessons,'dance',[0,1,2]),/원하는 보상을 찾지/);
});
