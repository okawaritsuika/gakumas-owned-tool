import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyHajimeLessonLimit, hajimeMasterRoutes} from '../lib/hajime-master-route.mjs';
import {recommend} from '../lib/recommend.mjs';
import {buildScenarioStartItemPlan} from '../lib/scenario-start-items.mjs';

const catalog = {hajimeSchedule:JSON.parse(readFileSync(new URL('../data/catalog/hajime_schedule.json',import.meta.url)))};
const rows = options => hajimeMasterRoutes(catalog, null,'vocal',options);
const total = route => Object.values(route.gains).reduce((sum,value)=>sum+value,0);
const start = limit => ({totals:{lessonLimitUpScore:limit},recommendedTotals:{lessonLimitUpScore:90}});

test('MASTER PERFECT rows distinguish the normal, SP and two intensive lessons', () => {
  const sp = rows({})[0], normal = rows({expectedCounts:{sp_lesson_end:0}})[0];
  assert.deepEqual(sp.parameterBonusRows.map(row=>row.vocal),[90,180,170,200,220,310]);
  assert.deepEqual(normal.parameterBonusRows.map(row=>row.vocal),[60,180,110,120,150,310]);
  assert.deepEqual(normal.parameterBonusRows.map(row=>row.visual),[0,90,0,0,0,145]);
  assert.deepEqual([total(normal), total(sp)], [1400,1640]);
  assert.deepEqual([sp.counts.lesson_end, sp.counts.class_work_end, sp.counts.exam_end],[6,4,2]);
  assert.equal(sp.counts.consult,undefined);
  assert.equal(sp.selections.find(row=>row.week===6).activity,null);
});

test('MASTER confirmed challenge limit raises four regular or SP weeks before bonuses, once', () => {
  for (const count of [0,2,4]) {
    const route = rows({expectedCounts:{sp_lesson_end:count}})[0];
    const capped = applyHajimeLessonLimit(route,start(60));
    assert.equal(total(capped) - total(route),240);
    assert.deepEqual(capped.parameterBonusRows.map((row,i)=>row.vocal-route.parameterBonusRows[i].vocal),[60,0,60,60,60,0]);
    assert.deepEqual(applyHajimeLessonLimit(capped,start(20)).parameterBonusRows,applyHajimeLessonLimit(route,start(20)).parameterBonusRows);
    assert.equal(total(applyHajimeLessonLimit(capped,start(0))),total(route));
  }
  assert.equal(total(applyHajimeLessonLimit(rows({})[0],start(60))),1880);
});

test('MASTER respects actual SP totals, axis constraints and requested bracelet weeks', () => {
  const routes = rows({expectedCounts:{sp_lesson_end:2}, perAxisCounts:{vocal:{sp_lesson_end:0}, dance:{sp_lesson_end:1}}});
  for (const route of routes) {
    const selected = route.selections.filter(row=>row.activity==='sp_lesson');
    assert.equal(selected.length,2);
    assert.deepEqual(selected.map(row=>row.axis).sort(),['dance','visual']);
  }
  const requested = rows({expectedCounts:{sp_lesson_end:1},scenarioRewardSpWeeks:[15]})[0];
  assert.deepEqual(requested.selections.filter(row=>row.activity==='sp_lesson').map(row=>row.week),[15]);
  assert.throws(()=>rows({expectedCounts:{sp_lesson_end:5}}),RangeError);
  assert.throws(()=>rows({perAxisCounts:{dance:{sp_lesson_end:3},visual:{sp_lesson_end:2}}}),RangeError);
});

test('MASTER leaves user gains, event mode and incomplete schedules outside the PERFECT model', () => {
  const override = rows({baseLessonGains:{vocal:100,dance:200,visual:300}})[0];
  assert.deepEqual(applyHajimeLessonLimit(override,start(60)).parameterBonusRows,[{vocal:100,dance:200,visual:300}]);
  assert.deepEqual(rows({eventModeId:'event'}),[]);
  assert.deepEqual(hajimeMasterRoutes({},null,null,{}),[]);
});

test('LEGEND respects published +90 reference, ordinary lessons, and integer remainder going to the main axis', () => {
  const route = {difficulty:'legend',modelAvailable:true,selections:[4,7,12,14,16].map(week=>({week,activity:'sp_lesson',axis:'dance'}))};
  const cap90 = applyHajimeLessonLimit(route,start(90));
  assert.deepEqual(cap90.parameterBonusRows.map(row=>[row.dance,row.visual]),[[140,55],[180,60],[260,70],[370,90],[570,115]]);
  const cap0 = applyHajimeLessonLimit(cap90,start(0));
  assert.deepEqual(cap0.parameterBonusRows.map(row=>[row.dance,row.visual]),[[110,25],[150,30],[230,40],[340,60],[540,85]]);
  const mixed = {...route,selections:route.selections.map(row=>row.week===7?{...row,activity:'lesson'}:row)};
  const cap20 = applyHajimeLessonLimit(mixed,start(20));
  assert.deepEqual(cap20.parameterBonusRows.slice(0,2),[{vocal:31,dance:118,visual:31},{vocal:30,dance:120,visual:30}]);
  assert.deepEqual(cap0.parameterBonusRows,applyHajimeLessonLimit(cap0,start(0)).parameterBonusRows);
  assert.equal(applyHajimeLessonLimit(route,start(60),{eventModeId:'event'}),route);
});

test('the recommendation entry point uses the actually selected MASTER and LEGEND slots', () => {
  const idol = {gameId:'i_card-hski-1-000',characterId:'hski',plan:'sense'};
  const reference = JSON.parse(readFileSync(new URL('../data/catalog/calculation_model_presets.json',import.meta.url)));
  const data = {...catalog,calculationModels:reference.data,idolCards:[idol],supportCards:[],skillCards:[],memoryAbilities:[],excelPresets:[]};
  const inventory = {idolCards:[{gameId:idol.gameId}],supportCards:[]};
  for (const [difficulty, count, cap] of [['master',4,60],['legend',5,90]]) {
    const options = {scenario:'hajime',difficulty,plan:'sense',targetAttribute:'vocal',producerLevel:72,idolGameId:idol.gameId,startItemSlotCount:3};
    const plan = buildScenarioStartItemPlan({catalog:data,inventory,selectedIdol:idol,options});
    const full = plan.groups.map(group=>group.items.reduce((a,b)=>a.lessonLimitUpScore >= b.lessonLimitUpScore ? a:b).id);
    const sums = [[], full].map(startItemIds => {
      const result = recommend({catalog:data,inventory,options:{...options,startItemIds}});
      return Object.values(result.scoreSummary.routeBaseGains).reduce((sum,value)=>sum+value,0);
    });
    assert.equal(sums[1]-sums[0],count*cap);
  }
});
