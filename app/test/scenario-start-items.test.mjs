import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenarioStartItemPlan, scenarioStartItemAlternatives } from '../lib/scenario-start-items.mjs';
import { recommend } from '../lib/recommend.mjs';
import data from '../data/catalog/scenario_start_items.json' with { type: 'json' };

const selectedIdol = { gameId: 'i_card-hski-1-000', characterId: 'hski' };
const settings = { scenario: 'hajime', difficulty: 'legend', producerLevel: 72 };
const plan = (options = {}, extra = {}) => buildScenarioStartItemPlan({
  selectedIdol, options: { ...settings, ...options }, ...extra,
});
const textbooks = ['pitem_00-1-048-challenge', 'pitem_00-1-049-challenge', 'pitem_00-1-050-challenge'];

test('a known unqualified NIA idol cannot earn route or audition rewards',()=>{
  const idol={...selectedIdol,plan:'sense'};
  assert.throws(()=>recommend({catalog:{idolCards:[idol],supportCards:[],skillCards:[]},
    inventory:{idolCards:[{gameId:idol.gameId}]},options:{scenario:'nia',difficulty:'master',idolGameId:idol.gameId,
      startItemDearnessLevel:19,producerLevel:72,scenarioRewardVisits:[{week:12,venue:'municipal'}]}}),/입장 조건/);
});

test('ordinary HIF purchases cannot be fixed in a period event',()=>{
  assert.throws(()=>recommend({catalog:{idolCards:[],supportCards:[]},options:{
    scenario:'hif',eventModeId:'event',hifConsultPlan:'ssr'}}),/일반 HIF/);
});

test('the bundled item groups preserve native slot identity, disjoint choices and growth exclusivity', () => {
  const used = new Set();
  for (const group of Object.values(data.groups)) for (const [stage, slots] of Object.entries(group)) {
    assert.deepEqual(slots.map(s => s.number), [1, 2, 3]);
    const ids = new Set();
    for (const slot of slots) for (const [id, limit, rate] of slot.options) {
      assert.ok(!ids.has(id));
      ids.add(id); used.add(id);
      const item = data.items[id];
      assert.ok(item.nameJa && item.descriptionJa && item.bindings.length);
      assert.ok(stage === 'produce-005' ? rate > 0 && limit === 0 : limit > 0 && rate === 0);
      for (const [trigger, effect] of item.bindings) {
        assert.ok(Object.hasOwn(data.effects, effect));
        if (trigger?.startsWith('p_trigger-produce_start') && data.effects[effect].type.endsWith('GrowthRateAddition')) {
          assert.equal(stage, 'produce-006'); assert.equal(slot.number, 1);
        }
      }
    }
  }
  assert.equal(used.size, 237);
});

test('only the exact supported pre-produce groups appear, including availability of new live P-idols', () => {
  for (const opts of [{ scenario: 'hif', difficulty: 'none' }, { difficulty: 'pro' }, { scenario: 'nia', difficulty: 'pro' }]) {
    assert.equal(plan(opts).status, 'not_applicable');
    assert.throws(() => plan({ ...opts, startItemIds: [textbooks[0]] }), RangeError);
  }
  assert.equal(plan({}, { selectedIdol: null }).status, 'idol_required');
  const fresh = { gameId: 'fresh-id', characterId: 'hski', produceChallengeSlotId: data.idToFamily[selectedIdol.gameId] };
  assert.equal(plan({}, { selectedIdol: fresh }).groups.length, 3);
  const kanae = { gameId: 'i_card-hkne-3-000', characterId: 'hkne' };
  assert.equal(plan({ scenario: 'nia', difficulty: 'master' }, { selectedIdol: kanae }).status, 'unavailable');
  assert.equal(plan({ scenario: 'nia', difficulty: 'none' }).difficulty, 'master');
  assert.equal(plan({ eventModeId: 'test-event' }).status, 'event_unconfirmed');
  assert.throws(() => plan({ eventModeId: 'test-event', startItemSlotCount: 3 }), RangeError);
});

test('account PLv, dearness level, observed slots and a true empty item list are distinct', () => {
  assert.equal(plan({ producerLevel: 49 }).status, 'unavailable');
  assert.equal(plan({ startItemDearnessLevel: 9 }).status, 'unavailable');
  assert.equal(plan({ startItemDearnessLevel: 19, scenario: 'nia', difficulty: 'master' }).status, 'unavailable');
  const unknown = plan({}, { inventory: { characters: [{ characterId: 'hski', dearnessPoint: 100000 }] } });
  assert.equal(unknown.status, 'conditional'); assert.deepEqual(unknown.selectedItemIds, []);
  assert.equal(unknown.recommendedItemIds.length, 3);
  const master = plan({ difficulty: 'master', startItemDearnessLevel: 10 });
  assert.equal(master.selectedItemIds.length, 1);
  assert.equal(master.groups[1].availability, 'unknown');
  const none = plan({ startItemSlotCount: 3, availableStartItemIds: [] });
  assert.equal(none.status, 'ready'); assert.deepEqual(none.recommendedItemIds, []);
  assert.deepEqual(plan({ startItemSlotCount: 0 }).selectedItemIds, []);
  assert.throws(() => plan({ startItemSlotCount: 4 }), RangeError);
});

test('observed and manual choices reject stale items, locked slots and duplicates', () => {
  const secondSlot = plan().groups[1].items[0].id;
  assert.throws(() => plan({ startItemSlotCount: 1, availableStartItemIds: [secondSlot] }), RangeError);
  assert.throws(() => plan({ startItemSlotCount: 3, startItemIds: ['invalid'] }), RangeError);
  assert.throws(() => plan({ startItemSlotCount: 1, startItemIds: textbooks.slice(0, 2) }), RangeError);
  assert.throws(() => plan({ startItemSlotCount: 1, startItemIds: [textbooks[0], textbooks[0]] }), RangeError);
  assert.throws(() => plan({ startItemIds: [textbooks[0]] }), RangeError);
  const manual = plan({ startItemIds: [textbooks[0]], availableStartItemIds: textbooks });
  assert.deepEqual(manual.selectedItemIds, [textbooks[0]]);
  assert.deepEqual(scenarioStartItemAlternatives(manual), [manual]);
});

test('exact opening growth, PP and bonus ceiling are reported in separate units', () => {
  const route = { parameterBonusRows: [{ vocal: 100, dance: 200, visual: 0 }] };
  const choice = plan({ availableStartItemIds: textbooks }, { route });
  assert.deepEqual(choice.selectedItemIds, [textbooks[1]]);
  assert.deepEqual(choice.appliedEffects, { growthRatePermil: { vocal: 0, dance: 85, visual: 0 }, initialPP: 0,
    actions: { skill_acquire: 0 }, produceActions: [] });
  assert.equal(choice.totals.lessonLimitUpScore, 20);
  const all = plan({ startItemSlotCount: 3 }, { route });
  assert.equal(all.totals.lessonLimitUpScore, 90);
  assert.ok(all.confirmedBenefitAlternative.itemIds.includes(textbooks[1]));
  const gripper = 'pitem_00-1-025-challenge';
  const pp = plan({ difficulty: 'master', availableStartItemIds: [gripper] });
  assert.equal(pp.appliedEffects.initialPP, 50);
  assert.deepEqual(pp.selectedItems[0].costNotes, ['수업 체력 소모 증가 20%', '라이벌 점수 증가 5%']);
  const nia = plan({ scenario: 'nia', difficulty: 'master', startItemSlotCount: 3 });
  assert.deepEqual(nia.totals, { lessonLimitUpScore: 0, auditionParameterGrowthRatePermil: 550 });
  assert.equal(nia.appliedEffects.initialPP, 0);
});

test('distinct opening effects keep all cap-aware alternatives; each representative maximizes the conditional bound', () => {
  const result = plan({ startItemSlotCount: 3 });
  const alternatives = scenarioStartItemAlternatives(result);
  assert.equal(alternatives[0], result);
  assert.equal(alternatives.length, 4);
  for (const [i, axis] of ['vocal', 'dance', 'visual'].entries()) {
    const alternative = alternatives.find(p => p.appliedEffects.growthRatePermil[axis] === 85);
    assert.ok(alternative.selectedItemIds.includes(textbooks[i]));
    assert.equal(alternative.totals.lessonLimitUpScore, 80);
  }
  assert.deepEqual(scenarioStartItemAlternatives(plan()), [plan()]);
});

test('Legend slot 2 gives one selected skill per matching completed visit, capped at three', () => {
  const route = { selections: [
    { week: 1, activity: 'class' }, { week: 2, activity: 'class' }, { week: 3, activity: 'outing' },
    { week: 9, activity: 'mid_exam' }, { week: 11, activity: 'class' }, { week: 15, activity: 'class' },
  ] };
  const item = plan().groups[1].items.find(i => i.routeSupply?.kind === 'class_work_end');
  assert.ok(item); assert.equal(item.routeSupply.count, null);
  const options = { availableStartItemIds: [item.id] };
  const chosen = plan(options, { route }).selectedItems[0];
  assert.equal(chosen.routeSupply.count, 3);
  assert.deepEqual(chosen.routeSupply.produceActions.map(a => [a.week, a.fromExamIndex, a.action, a.quantity]),
    [[1, 0, 'acquire', 1], [2, 0, 'acquire', 1], [11, 1, 'acquire', 1]]);
  const empty = plan(options, { route: { ...route, explicitCounts: { class_work_end: 0 } } });
  assert.equal(empty.appliedEffects.actions.skill_acquire, 0);
  const constrained = plan(options, { route: { ...route, explicitCounts: { class_work_end: 2 } } });
  assert.equal(constrained.appliedEffects.actions.skill_acquire, 2);
  assert.deepEqual(constrained.appliedEffects.produceActions, []);
  const all = plan({ startItemSlotCount: 3 }, { route });
  const candidates = scenarioStartItemAlternatives(all);
  assert.ok(candidates.some(p => p.appliedEffects.actions.skill_acquire === 3));
  assert.ok(candidates.some(p => p.appliedEffects.actions.skill_acquire === 1));
  assert.ok(candidates.some(p => p.appliedEffects.actions.skill_acquire === 0));
  const nia = plan({ scenario: 'nia', difficulty: 'master', startItemSlotCount: 3 }, { route });
  assert.equal(nia.appliedEffects.actions.skill_acquire, 0);
});

test('equal lesson ceilings keep distinct PP and cap-sensitive stat gains', () => {
  const consult = 'pitem_00-2-042-challenge';
  const master = plan({difficulty:'master',startItemSlotCount:3}, {route:{
    selections:[3,4,6].map(week=>({week,activity:'consult'}))}});
  assert.equal(master.groups[2].items.find(i=>i.id===consult).routeEffects.pp,40);
  assert.ok(scenarioStartItemAlternatives(master).some(p=>p.appliedEffects.routePP===40));
  const ids = ['193','194','195'].map(n=>'pitem_00-3-'+n+'-challenge');
  const route = {produceActions:[17,16,17,17,17,17,17,null].map((n,i)=>({
    action:'acquire',week:i+1,deckCardCountAtTrigger:n})).concat([{action:'acquire',week:9,quantity:2,deckCardCountAtTrigger:17}])};
  const result=plan({availableStartItemIds:ids},{route});
  const pool=scenarioStartItemAlternatives(result);
  for(const [i,axis] of ['vocal','dance','visual'].entries()) {
    assert.equal(pool.find(p=>p.selectedItemIds.includes(ids[i])).appliedEffects.routeStats[axis],75);
  }
  const missing=plan({availableStartItemIds:ids},{route:{produceActions:[{week:3,action:'acquire'},{week:4,action:'acquire',quantity:2,deckCardCountAtTrigger:17}]}});
  assert.equal(missing.appliedEffects.routeStats,undefined);
});

test('NIA equal-rate exchange items require matching visits, enough basic cards, and unique reward accounting', () => {
  const idol = {gameId:'i_card-ssmk-3-014',characterId:'ssmk'};
  function at(items,weeks,checks,manual=true) {
    return plan({scenario:'nia',difficulty:'master',availableStartItemIds:items,...(manual?{startItemIds:items}:{})},
      {selectedIdol:idol,route:{selections:weeks,produceActions:checks}});
  }
  const outing='pitem_00-1-038-challenge-exam_review', watch='pitem_00-2-099-challenge-exam_review';
  const balloon='pitem_02-3-219-challenge', handkerchief='pitem_02-3-218-challenge';
  const weeks=[3,6,10,13].map(week=>({week,activity:'outing'}));
  const checks = weeks.map(({week})=>({week,venue:'outing',action:'challenge_check',basicCardCountBeforeChallenge:2,fromExamIndex:week<9?0:1}));
  const confirmed=at([outing,watch],weeks,checks).appliedEffects;
  assert.deepEqual(confirmed.actions,{skill_acquire:6,delete:6});
  assert.equal(confirmed.routePP,135);
  const contested=at([outing,watch],weeks,[{...checks[0],basicCardCountBeforeChallenge:1}]).appliedEffects;
  assert.deepEqual(contested.actions,{skill_acquire:1,delete:1});
  assert.equal(contested.routePP,20);
  assert.ok(contested.produceActions.every(a=>!a.providerId));
  assert.equal(at([outing],weeks,[{...checks[0],basicCardCountBeforeChallenge:0}]).appliedEffects.actions.skill_acquire,0);
  assert.throws(()=>at([outing],weeks,[checks[0],{week:3,action:'acquire',providerId:outing}]),/챌린지가 공급한/);
  const routed=at([balloon,handkerchief],[{week:6,activity:'consult'}],[{...checks[1],venue:'consult'}],false);
  const alternatives=scenarioStartItemAlternatives(routed);
  assert.equal(alternatives.find(p=>p.selectedItemIds.includes(balloon)).appliedEffects.actions.skill_acquire,1);
  assert.equal(alternatives.find(p=>p.selectedItemIds.includes(handkerchief)).appliedEffects.actions.skill_acquire,0);
});

test('all legal manual slot combinations have a matching or better modeled automatic representative', () => {
  const selectedIdol={gameId:'i_card-ssmk-3-014',characterId:'ssmk'};
  const configurations=[
    ['nia','master',{selections:[{week:6,activity:'consult'}],
      produceActions:[{week:6,action:'challenge_check',venue:'consult',basicCardCountBeforeChallenge:1,fromExamIndex:0}]}],
    ['hajime','master',{selections:[3,4].map(week=>({week,activity:'consult'}))}],
    ['hajime','legend',{selections:[{week:1,activity:'class'},{week:3,activity:'outing'}],
      produceActions:[{week:12,action:'acquire',deckCardCountAtTrigger:17}]}],
  ];
  const signature=({appliedEffects:e})=>JSON.stringify([e.growthRatePermil,e.initialPP,e.routePP??0,e.routeStats??null,
    e.actions,e.produceActions.map(a=>[a.week,a.fromExamIndex,a.venue,a.action,a.quantity].join('/')).sort()]);
  for(const [scenario,difficulty,route] of configurations) {
    const options={scenario,difficulty,startItemSlotCount:3};
    const make=opts=>plan({...options,...opts},{selectedIdol,route});
    const base=make({}), key=base.comparisonBasis;
    const retained=new Map(scenarioStartItemAlternatives(base).map(p=>[signature(p),p.totals[key]]));
    const reference=new Map();
    const [first,second,third]=base.groups.map(slot=>[null,...slot.items.map(item=>item.id)]);
    for(const a of first) for(const b of second) for(const c of third) {
      const manual=make({startItemIds:[a,b,c].filter(Boolean)}), effects=signature(manual);
      reference.set(effects,Math.max(reference.get(effects)??0,manual.totals[key]));
    }
    assert.deepEqual(retained,reference,scenario+'/'+difficulty);
    console.log(`${scenario}/${difficulty}: ${first.length*second.length*third.length} legal manual choices → ${retained.size} modeled effects`);
  }
});
