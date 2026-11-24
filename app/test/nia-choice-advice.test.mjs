import assert from 'node:assert/strict';
import test from 'node:test';
import {buildNiaChoiceAdvice} from '../lib/nia-choice-advice.mjs';

function decide(activity, week, live, context = {}) {
  const args = {scenario:'nia', difficulty:'master', activity, week, ...context};
  return buildNiaChoiceAdvice({...args, observation:{week, difficulty:args.difficulty, eventModeId:args.eventModeId, ...live}});
}

test('same business week replaces the actual venue roll and compares HP, cards, drinks and P', () => {
  const venues = [{id:'company'}, {id:'municipal',ppReward:50}, {id:'commercial'}];
  const state = {stamina:5, priority:'drink', venueOffers:venues};
  const first = decide('business', 2, state);
  assert.equal(first.recommendation.id,'company');
  assert.deepEqual(first.choices.map(row => [row.costs.stamina,row.rewards.card,row.rewards.drink,row.rewards.pp]), [
    [0,'normal',true,null], [5,'normal',false,50], [5,'upgraded',false,null]]);
  const reroll = decide('business', 2, {...state, priority:'upgradedCard', venueOffers:venues.slice(1)});
  assert.deepEqual(reroll.choices.map(row => row.id), ['municipal','commercial']);
  assert.equal(reroll.recommendation.id, 'commercial');
  assert.equal(decide('business',2,{...state,priority:'pp'}).recommendation.id, 'municipal');
  const recovery = decide('business',2,{...state,stamina:4,venueOffers:[venues[1],{id:'resort',staminaRecovery:10}]});
  assert.equal(recovery.recommendation.id,'resort');
  assert.equal(recovery.recommendation.rewards.staminaRecovery,10);
  assert.equal(recovery.choices[0].canChoose,false);
});

test('Master FINALE requires every gate at equality, and cannot displace an eligible fallback below a gate', () => {
  const state = {auditionOffers:[{id:'finale'},{id:'other',requirements:{}}], fanVotes:62000, affection:17, runNumber:3};
  assert.equal(decide('audition_final',26,state).recommendation.id,'finale');
  for (const below of [{fanVotes:61999},{affection:16},{runNumber:2}]) {
    const advice = decide('audition_final',26,{...state,...below});
    assert.equal(advice.choices[0].canChoose,false);
    assert.equal(advice.recommendation.id,'other');
  }
  assert.equal(decide('audition_final',26,{...state,affection:null}).choices[0].canChoose,null);
  assert.equal(decide('audition_final',26,{...state,affection:16,auditionOffers:[{id:'FINALE',requirements:{}}]}).status,'unavailable');
  assert.equal(decide('audition_first',9,state).choices.some(row => row.id === 'finale'),false);
});

test('Pro uses its own known audition gates and still requires actual venue and event costs', () => {
  const live = {auditionOffers:[{id:'melo-bang'}], fanVotes:14000};
  for(const [fanVotes,status] of [[8999,'unavailable'],[9000,'recommended']])
    assert.equal(decide('audition_first',9,{...live,fanVotes},{difficulty:'pro'}).status,status);
  for (const scope of [{difficulty:'pro'},{eventModeId:'event'}]) {
    assert.equal(decide('audition_first',9,live,scope).status,scope.eventModeId?'unconfirmed':'recommended');
    const auditionOffers = [{id:'melo-bang',requirements:{fanVotes:14001}}];
    assert.equal(decide('audition_first',9,{...live,auditionOffers},scope).status,'unavailable');
    assert.equal(decide('audition_first',9,{...live,auditionOffers,fanVotes:14001},scope).recommendation.id,'melo-bang');
    assert.equal(decide('business',2,{venueOffers:[{id:'municipal'}],stamina:5},scope).status,'unconfirmed');
    const venueOffers = [{id:'municipal',staminaCost:0,ppCost:10,rewardTypes:['card','pp']}];
    assert.equal(decide('business',2,{venueOffers,pp:9},scope).status,'unavailable');
    assert.equal(decide('business',2,{venueOffers,pp:10},scope).recommendation.id,'municipal');
  }
});

test('absent offers, stale context and unconfirmed additional gates never produce a recommendation', () => {
  for (const state of [{venueOffers:undefined}, {venueOffers:[]}, {week:1}, {difficulty:'pro'}, {eventModeId:'event'}]) {
    assert.equal(decide('business',2,{venueOffers:[{id:'company'}],...state}).status,'unconfirmed');
  }
  for (const offer of [{id:'other'},{id:'other',requirements:{unverified:10}},
    {id:'melo-bang',otherConditionsMet:null},{id:'melo-bang',requirements:{fanVotes:null}}]) {
    assert.equal(decide('audition_first',9,{fanVotes:13000,auditionOffers:[offer]}).status,'unconfirmed');
  }
  assert.equal(decide('audition_first',9,{fanVotes:13000,auditionOffers:[{id:'melo-bang',otherConditionsMet:false}]}).status,'unavailable');
});

test('event venues use observed rewards and prefer the confirmed requested amount', () => {
  const context = {eventModeId:'event'};
  const costs = {staminaCost:0,ppCost:0};
  assert.equal(decide('business',2,{venueOffers:[{id:'company',...costs}]},context).status,'unconfirmed');
  const venueOffers = [{id:'company',...costs,rewardTypes:['card','pp'],ppReward:25},
    {id:'commercial',...costs,rewardTypes:['card','pp'],ppReward:60}];
  assert.equal(decide('business',2,{venueOffers,priority:'pp'},context).recommendation.id,'commercial');
  assert.equal(decide('business',2,{venueOffers,priority:'drink'},context).choices[0].rewards.drink,false);
});

test('business explains a missing requested reward and discloses equally affordable alternatives',()=>{
  const choose=priority=>decide('business',2,{priority,stamina:5,venueOffers:[{id:'company'},{id:'resort'}]});
  assert.match(choose('pp').reason,/P포인트 보상이 없어/);
  assert.match(choose('pp').reason,/리조트 시설도 같은 우선순위/);
  assert.match(choose('drink').reason,/원한 보상인 드링크/);
  assert.doesNotMatch(choose('drink').reason,/같은 우선순위/);
});
