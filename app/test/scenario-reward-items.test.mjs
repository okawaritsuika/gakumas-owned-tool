import assert from 'node:assert/strict';
import test from 'node:test';
import niaSchedule from '../data/catalog/nia_schedule.json' with {type:'json'};
import hajimeSchedule from '../data/catalog/hajime_schedule.json' with {type:'json'};
import {niaChallengeBonusStats,scenarioRewardOptions} from '../lib/scenario-reward-items.mjs';
import {startItemObservationActions,prepareScenarioTimeline} from '../lib/non-hif-support.mjs';
const catalog={niaSchedule,hajimeSchedule};
const run=(options,scenario='nia',difficulty='master',route={})=>scenarioRewardOptions({scenario,options,catalog,route:{difficulty,...route}});

test('a challenge check preserves preset actions and uses a shared visit once',()=>{
  const kind='skill_acquire',counts={[kind]:8,delete:3},perAxis=Object.fromEntries(['vocal','dance','visual'].map(axis=>[axis,{lesson_end:0,sp_lesson_end:0}]));
  const route={difficulty:'master',counts,perAxis,knownRouteCounts:{},explicitCounts:{}};
  const options={startItemObservations:[{week:6,venue:'consult',basicCardCountBeforeChallenge:1},{week:12,venue:'company',basicCardCountBeforeChallenge:0}],
    scenarioRewardVisits:[{week:12,venue:'company'}]};
  const result=prepareScenarioTimeline(catalog,'nia',route,options);
  assert.equal(result.counts[kind],8);assert.equal(result.counts.delete,3);
  assert.deepEqual(result.challengeActions.map(a=>[a.week,a.action,a.basicCardCountBeforeChallenge]),[[6,'challenge_check',1],[12,'challenge_check',0]]);
  const tote=run(options).find(row=>row.id==='pitem_00-3-098-0');
  assert.deepEqual(tote.items[0].weeks,[12]);
  assert.throws(()=>prepareScenarioTimeline(catalog,'nia',route,{...options,produceActions:[{week:6,action:'challenge_check',venue:'consult'}]}),RangeError);
  assert.throws(()=>run({...options,scenarioRewardVisits:[{week:12,venue:'municipal'}]}),RangeError);
  assert.throws(()=>startItemObservationActions(catalog,'nia',route,{startItemObservations:[{week:6,venue:'company',basicCardCountBeforeChallenge:0}]}),RangeError);
});

test('NIA challenge increments apply separately to each declared base reward',()=>{
  const items={difficulty:'master',totals:{auditionParameterGrowthRatePermil:150}};
  const options={scenario:'nia',niaAuditionBaseRewards:[{vocal:41,dance:10,visual:0},null,{vocal:100,dance:10,visual:25}]};
  assert.deepEqual(niaChallengeBonusStats(options,items),{vocal:21,dance:2,visual:3});
  assert.equal(niaChallengeBonusStats({},items),null);
  assert.throws(()=>niaChallengeBonusStats({...options,scenario:'hajime'},items),RangeError);
  assert.throws(()=>niaChallengeBonusStats({...options,niaAuditionBaseRewards:[{},null,null]},items),RangeError);
});

test('NIA first and second reward stages use their own weeks and limits',()=>{
  const input={scenarioRewardVisits:[{week:12,venue:'company'},{week:15,venue:'company'},{week:20,venue:'company'},{week:23,venue:'commercial'}],
    scenarioRewardSpWeeks:[19],scenarioRewardBaseCounts:{p_drink_acquire:3,skill_enhance:1}};
  const rows=run(input);
  const tote=rows.find(row=>row.id==='pitem_00-3-098-0+pitem_00-3-002-0');
  assert.deepEqual(tote.actionCounts,{p_drink_acquire:4,skill_enhance:1});
  assert.equal(tote.stamina,-3);
  assert.deepEqual(tote.items[0].weeks,[12,15]);
  assert.ok(!rows.some(row=>row.id?.includes('098')&&row.id.includes('097')));
  assert.deepEqual(run({...input,scenarioRewardBaseCounts:undefined}).find(row=>row.id===tote.id).actionCounts,{});
});
test('reward choices reject pre-acquisition, duplicate, other difficulty and event weeks',()=>{
  for(const input of [{scenarioRewardVisits:[{week:7,venue:'company'}]},
    {scenarioRewardVisits:[{week:12,venue:'company'},{week:12,venue:'commercial'}]},
    {scenarioRewardSpWeeks:[11]}, {eventModeId:'event',scenarioRewardSpWeeks:[19]}])assert.throws(()=>run(input),RangeError);
  assert.throws(()=>run({scenarioRewardVisits:[{week:12,venue:'company'}]},'nia','pro'),RangeError);
  assert.throws(()=>run({scenarioRewardSpWeeks:[14]},'hajime','legend'),RangeError);
});
test('Hajime PRO plans only funded-in-stamina conditions and post-midterm SP with upgrade targets',()=>{
  const route={hajimePro:{},counts:{skill_enhance:1,sp_lesson_end:4},knownUpgradeTargets:3,
    selections:[4,10,12,13].map(week=>({week,activity:'sp_lesson'}))};
  const item=run({},'hajime','pro',route)[1];
  assert.deepEqual(item.items[0].weeks,[10,12]);assert.equal(item.stamina,-6);
  assert.equal(run({scenarioRewardSpWeeks:[]},'hajime','pro',route).length,1);
});
