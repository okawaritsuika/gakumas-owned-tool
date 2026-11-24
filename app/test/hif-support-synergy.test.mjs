import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../lib/catalog.mjs';
import { calculateHifSupport, evaluateHifDeck } from '../lib/hif-model.mjs';
import { withDeclaredProduceActions } from '../lib/produce-action-counts.mjs';

const catalog = loadCatalog();
const zero = () => ({ vocal: 0, dance: 0, visual: 0 });
const caps = { vocal: 3200, dance: 3200, visual: 3200 };
const byId = id => catalog.supportCards.find(card => card.gameId === id);
const latest = (card, level, kinds) => [...new Map(card.levelAbilities
  .filter(ability => ability.level <= level && kinds.includes(ability.kind))
  .map(ability => [ability.order, ability])).values()];
const stage = counts => ({ counts, perAxis: {}, parameterBonusRows: [], gains: zero(), classGains: zero() });
const routeFor = (counts, selectionCounts, selections = []) => ({
  ...stage(counts), stages: { selection: stage(selectionCounts), final: stage({}) }, selections,
});
const context = route => ({ route, statCaps: caps, stageContexts: {
  selection: { statCaps: caps }, final: { statCaps: caps },
}, explainSupportLinks: true });
const scoped = (card, abilities, level, route, options = {}) => ({
  gameId: card.gameId, ...calculateHifSupport(card, abilities, level, route, options.plan ?? 'anomaly', { catalog, ...options }),
});

test('four item bottles on a 36-drink route feed every receiver once, including the provider', () => {
  const selections = [
    { week: 2, stage: 'selection', main: 'dance', sub: 'vocal' },
    { week: 5, stage: 'selection', activity: 'mid_exam' },
    { week: 21, stage: 'final', main: 'dance', sub: 'vocal' },
  ];
  const route = routeFor({ p_drink_acquire: 36 }, { p_drink_acquire: 30 }, selections);
  const summer = byId('s_card-3-0069'), supplier = byId('s_card-2-0007');
  const ability = latest(summer, 40, ['p_drink_acquire']);
  const a = scoped({ ...summer, events: [] }, ability, 40, route);
  const b = scoped({ ...supplier, events: supplier.events.slice(0, 1) }, ability, 40, route,
    { supportItemAcquisitions: { [supplier.gameId]: { confirmed: true, beforeProduce: true } } });
  assert.equal(a.fixedStats.dance, 144);
  assert.equal(b.fixedStats.dance, 160);
  assert.deepEqual(b.providedActionsByStage, { selection: { p_item_acquire: 1, p_drink_acquire: 2 },
    final: { p_drink_acquire: 2 } });
  const deck = evaluateHifDeck([a, b], context(route));
  assert.equal(deck.providedActions.p_drink_acquire, 4);
  assert.equal(deck.cappedStats.dance, 320);
  assert.equal(deck.synergyStats.dance, 16);
  assert.deepEqual(deck.supportLinks.map(link => [link.receiverId, link.kind, link.extraCount, link.pointsBeforeCap]),
    [[summer.gameId, 'p_drink_acquire', 4, 16]]);
  assert.equal(deck.stageResults[0].cappedStats.dance, 256);
  assert.deepEqual(evaluateHifDeck([b,a], context(route)).cappedStats, deck.cappedStats);
  const search = evaluateHifDeck([a,b], { ...context(route), searchOnly:true, explainSupportLinks:false });
  assert.equal(search.score, deck.score);
  assert.equal(search.supportLinks, undefined);
});

test('two different SSR support skill grants produce two acquisitions and a single extra per receiver', () => {
  const route = routeFor({ ssr_card_acquire: 0 }, {});
  const cards = [byId('s_card-3-0080'), byId('s_card-3-0069')];
  const selected = cards.map((card, i) => {
    const level = [60, 40][i];
    return scoped({ ...card, events: card.events.filter(event => event.effect_type === 'skill_card') },
      latest(card, level, ['ssr_card_acquire']), level, route);
  });
  const result = evaluateHifDeck(selected, context(route));
  assert.equal(result.providedActions.ssr_card_acquire, 2);
  assert.deepEqual(result.cappedStats, { vocal: 10, dance: 10, visual: 0 });
  assert.deepEqual(result.synergyStats, { vocal: 5, dance: 5, visual: 0 });
  const duplicate = scoped({ ...cards[0], events: cards[0].events.slice(0,1), skill_card: cards[1].skill_card },
    latest(cards[0], 60, ['ssr_card_acquire']), 60, route);
  assert.deepEqual(evaluateHifDeck([duplicate, selected[1]], context(route)).cappedStats, { vocal: 5, dance: 5, visual: 0 });
});

test('a declared receipt of the same one-copy support skill triggers its acquisition once', () => {
  const crane = byId('s_card-3-0080'), summer = byId('s_card-3-0069');
  const skill = catalog.skillCards.find(card => card.nameJa === crane.skill_card.name && card.upgradeCount === 0);
  const receipt = { action:'acquire', gameId:skill.gameId, fromExamIndex:0 };
  const route = withDeclaredProduceActions(routeFor({},{}), [receipt], catalog);
  const source = scoped({ ...crane, events:crane.events.slice(0,1) },latest(crane,60,['ssr_card_acquire']),60,route);
  const receiver = scoped({ ...summer, events:[] },latest(summer,40,['ssr_card_acquire']),40,route);
  const deck = evaluateHifDeck([source,receiver],context(route));
  assert.equal(deck.providedActions.ssr_card_acquire, undefined);
  assert.deepEqual(deck.cappedStats,{ vocal:5, dance:5, visual:0 });
  assert.deepEqual(deck.supportLinks,[]);
});

test('a scheduled one-copy SSR stays unavailable before its declared receipt, unless a known removal frees it', () => {
  const crane = byId('s_card-3-0080');
  const skill = catalog.skillCards.find(card => card.nameJa === crane.skill_card.name && card.upgradeCount === 0);
  const source = {...crane,events:crane.events.slice(0,1)};
  const early = routeFor({ssr_card_acquire:0},{ssr_card_acquire:0});
  early.supportPeakScenario = {supportReceiptWeek:6};
  const acquire = {action:'acquire',gameId:skill.gameId,fromExamIndex:3,week:21};
  const remove = {action:'remove',gameId:skill.gameId,fromExamIndex:3,week:22};
  const planned = actions => scoped(source,[],60,early,{examIndex:0,supportReceiptPlan:actions}).providedActions.ssr_card_acquire;
  assert.equal(planned([acquire]),undefined);
  assert.equal(planned([acquire,remove]),undefined);
  assert.equal(planned([{...acquire,week:1,fromExamIndex:0},{...remove,week:2,fromExamIndex:0}]),1);
  assert.equal(planned([{...acquire,week:1,fromExamIndex:0,supportGameId:crane.gameId},{...remove,week:2,fromExamIndex:0}]),undefined);
});

test('receiving a battle-only P-item triggers acquisition bonuses independently of the item body', () => {
  const provider = byId('s_card-3-0062'), listener = byId('s_card-3-0086');
  const itemCard = { ...provider, events:provider.events.slice(0,1) };
  const receiver = { ...listener, events:[], p_item:null };
  const abilities = latest(listener,60,['p_item_acquire']);
  const route = routeFor({p_item_acquire:0},{p_item_acquire:0},[
    {week:1,stage:'selection',activity:'consult'}, {week:21,stage:'final',activity:'consult'},
  ]);
  route.supportPeakScenario = {};
  const peak = {supportPeakScenario:true};
  const source = scoped(itemCard,[],40,route,peak);
  assert.equal(source.supportItemValue.status,'unsupported');
  assert.equal(source.supportItemValue.acquisitionConfirmed,false);
  assert.equal(source.supportItemValue.applied.activationCount,0);
  const deck = evaluateHifDeck([source,scoped(receiver,abilities,60,route,peak)],context(route));
  assert.equal(deck.providedActions.p_item_acquire,1);
  assert.equal(deck.stageResults[0].cappedStats.visual,11);
  assert.deepEqual(deck.supportLinks[0].contributors,[provider.gameId]);
  for (const options of [{supportPeakScenario:false},{includeSupportEvents:false},{plan:'logic'},
    {supportItemAcquisitions:{[provider.gameId]:{confirmed:false}}},
    {examIndex:0,supportItemAcquisitions:{[provider.gameId]:{confirmed:true,fromExamIndex:3,week:21}}}])
    assert.equal(scoped(itemCard,[],40,route,{...peak,...options}).providedActions.p_item_acquire, undefined);
  const locked = {...itemCard,events:[{...itemCard.events[0],release:'lv50'}]};
  assert.equal(scoped(locked,[],40,route,peak).providedActions.p_item_acquire,undefined);
  const late = scoped(itemCard,[],40,route,{...peak,supportItemAcquisitions:{
    [provider.gameId]:{confirmed:true,fromExamIndex:3,week:21}}});
  assert.deepEqual(late.providedActionsByStage,{selection:{},final:{p_item_acquire:1}});
  const native = catalog.pItems.find(item => item.originSupportCardId === provider.gameId && !item.isUpgraded);
  const named = {action:'item_acquire',gameId:native.gameId,fromExamIndex:3,week:21};
  const accounted = withDeclaredProduceActions(route,[named],catalog);
  const once = evaluateHifDeck([scoped(itemCard,[],40,accounted,peak),scoped(receiver,abilities,60,accounted,peak)],context(accounted));
  assert.equal(once.providedActions.p_item_acquire,undefined);
  assert.equal(once.stageResults[0].cappedStats.visual,0);
  assert.equal(once.cappedStats.visual,11);
  const early = scoped(itemCard,[],40,route,{...peak,examIndex:0,supportReceiptPlan:[named]});
  assert.equal(early.providedActions.p_item_acquire,undefined);
});

test('a named P-item claim in the final does not produce drinks from preceding dance lessons', () => {
  const supplier = byId('s_card-2-0007');
  const story = {...supplier,events:supplier.events.slice(0,1)};
  const base = routeFor({},{},[
    {week:2,main:'dance',stage:'selection'}, {week:7,activity:'mid_exam',stage:'selection'},
    {week:13,activity:'mid_exam',stage:'selection'}, {week:20,activity:'final_exam',stage:'selection'},
    {week:22,main:'dance',stage:'final'},
  ]);
  base.supportPeakScenario = {};
  const named = {action:'item_acquire',supportGameId:supplier.gameId,fromExamIndex:3,week:21,stage:'final'};
  const route = withDeclaredProduceActions(base,[named],catalog);
  const source = scoped(story,[],50,route,{supportPeakScenario:true});
  assert.equal(source.providedActions.p_item_acquire,undefined);
  assert.equal(source.supportItemValue.acquisitionConfirmed,false);
  assert.equal(source.supportItemValue.applied.activationCount,0);
  assert.deepEqual(source.providedActionsByStage,{selection:{p_drink_acquire:0},final:{p_drink_acquire:2}});
});

test('basic-change targets, shared limits and fifteen-card exam thresholds are deck-wide', () => {
  const teacher = byId('s_card-3-0099'), ssr = byId('s_card-3-0080'), summer = byId('s_card-3-0069');
  const route = routeFor({ basic_card_change: 1, change: 1, exam_15: 1 }, { basic_card_change: 1, change: 1, exam_15: 0 });
  route.supportPeakScenario = { remainingBasicCards: 1, examDeckSizes: [13,12,11,15,14] };
  const a = scoped({ ...teacher, events: [], p_item: null }, latest(teacher,60,['exam_15','basic_card_change']), 60, route);
  const b = scoped(ssr, [], 60, route);
  const c = scoped({ ...summer, events: [summer.events[0], ssr.events[2]] }, [], 40, route);
  const result = evaluateHifDeck([a,b,c], context(route));
  assert.equal(result.providedActions.basic_card_change, 1);
  assert.equal(result.providedActions.change, 1);
  assert.equal(result.providedActions.exam_15, 2);
  assert.equal(result.cappedStats.visual, 39 * 2 + 37 * 3);
  const capped = evaluateHifDeck([a,b,c],{ ...context(route), stageContexts:{
    selection:{statCaps:{...caps,visual:70}}, final:{statCaps:caps},
  } });
  assert.equal(capped.stageResults[0].wastedStats.visual, 39*2 + 37 - 70);
  assert.equal(capped.cappedStats.visual, 70 + 37 * 2);
});

test('an actual Asari item and ability share the same native change, with independent produce limits', () => {
  const teacher = byId('s_card-3-0099'), crane = byId('s_card-3-0080');
  const route = routeFor({ change: 1, basic_card_change: 1 }, { change: 1, basic_card_change: 1 }, [
    { week:1, activity:'consult', stage:'selection' }, { week:2, activity:'consult', stage:'selection' },
  ]);
  route.produceActions = [{ week:2, fromExamIndex:0, action:'change', basicCard:true, parametersBefore:{ visual:400 }}];
  route.supportPeakScenario = { remainingBasicCards:2, statsBeforeWeek:{1:{visual:400},2:{visual:400}} };
  const options = { supportPeakScenario:true };
  const a = scoped({ ...teacher, events: teacher.events.filter(e => e.effect_type !== 'param_boost') },
    latest(teacher,60,['basic_card_change']), 60, route, options);
  const b = scoped({ ...crane, events: [crane.events[2]] }, [], 60, route, options);
  const result = evaluateHifDeck([a,b], context(route));
  assert.equal(a.supportItemValue.acquisitionConfirmed, false);
  assert.equal(a.supportItemValue.applied.activationCount, 0);
  assert.equal(a.supportItemValue.peak.total.activationCount, 1);
  assert.equal(a.fixedStats.visual, (39 + 25) * 2);
  assert.equal(result.cappedStats.visual, (39 + 25) * 3);
  assert.equal(result.synergyStats.visual, 64);
  const extra = { ...b, gameId:'extra-provider' };
  assert.equal(evaluateHifDeck([a,b,extra], context(route)).score, result.score);
});

test('a vitality skill from one support triggers another support item and two separate drink bonuses', () => {
  const summer = byId('s_card-3-0069'), crane = byId('s_card-3-0080'), chair = byId('s_card-3-0038');
  const route = routeFor({ p_drink_acquire:0 }, { p_drink_acquire:0 }, [
    { week:1, activity:'consult', stage:'selection' }, { week:2, activity:'consult', stage:'selection' },
  ]);
  route.supportPeakScenario = { remainingBasicCards:0, supportReceiptWeek:2, statsBeforeWeek:{2:{visual:200}} };
  const options = { plan:'logic', supportPeakScenario:true };
  const supplier = scoped({ ...crane, events:crane.events.slice(0,1) },[],60,route,options);
  const b = scoped({ ...chair, events:chair.events.slice(0,1) },[],60,route,options);
  const c = scoped({ ...summer, events:[] },latest(summer,40,['p_drink_acquire']),40,route,options);
  const other = scoped({ gameId:'another_consumer' },[{ kind:'p_drink_acquire', activationLimit:1,
    effects:[{ type:'ProduceEffectType_VisualAddition',min:3,max:3 }] }],60,route,options);
  for (const deck of [[supplier,b,c,other], [other,c,b,supplier]]) {
    const result = evaluateHifDeck(deck,context(route));
    assert.equal(result.providedActions.vitality_card_acquire,1);
    assert.equal(result.providedActions.p_drink_acquire,1);
    assert.deepEqual(result.synergyStats,{vocal:0,dance:4,visual:3});
    assert.deepEqual(result.supportLinks.find(link=>link.producedDrinks)?.contributors,[crane.gameId]);
    assert.deepEqual(result.supportLinks.find(link=>link.kind==='p_drink_acquire')?.contributors,[chair.gameId]);
  }
  route.supportPeakScenario.statsBeforeWeek[2].visual=199;
  route.selections.push({week:3,activity:'consult',stage:'selection'});
  route.supportPeakScenario.statsBeforeWeek[3]={visual:200};
  const lateItem=scoped({ ...chair, events:chair.events.slice(0,1) },[],60,route,options);
  assert.equal(evaluateHifDeck([supplier,lateItem,c,other],context(route)).synergyStats.dance,0,
    'a skill counted at the early receipt cannot also arrive after a later gate');
});

test('a support story can take over a flexible class target without granting an extra basic change', () => {
  const teacher=byId('s_card-3-0099'), crane=byId('s_card-3-0080');
  const route=routeFor({basic_card_change:1,change:1},{basic_card_change:0,change:0});
  route.supportPeakScenario={remainingBasicCards:0,reassignableBasicChanges:1,
    reassignableBasicChangesByStage:{selection:0,final:1}};
  const a=scoped({...teacher,events:[],p_item:null},latest(teacher,60,['basic_card_change']),60,route);
  const b=scoped({...crane,events:[crane.events[2]]},[],60,route);
  const result=evaluateHifDeck([a,b],context(route));
  assert.equal(result.providedActions.change,1);
  assert.equal(result.providedActions.basic_card_change??0,0);
  assert.equal(result.stageResults[0].cappedStats.visual,39);
  assert.equal(result.stageResults[1].cappedStats.visual,39);
});

test('a synthetic drink-on-drink source does not recirculate its own receipts', () => {
  const supplier = byId('s_card-2-0007'), summer = byId('s_card-3-0069');
  const route = routeFor({p_drink_acquire:1},{p_drink_acquire:1},[
    {week:1,activity:'consult',stage:'selection'},{week:2,activity:'consult',stage:'selection'},
  ]);
  route.produceActions=[{action:'drink_exchange',week:2,fromExamIndex:0,stage:'selection'}];
  route.supportPeakScenario={remainingBasicCards:0};
  const cyclicItem={...supplier,p_item:{...supplier.p_item,
    effect:{trigger:{key:'pdrink_acquire'},body:[{key:'random_pdrink_count',count:2}]}},events:supplier.events.slice(0,1)};
  const a=scoped(cyclicItem,[],40,route,{supportPeakScenario:true});
  const b=scoped({...summer,events:[]},latest(summer,40,['p_drink_acquire']),40,route,{supportPeakScenario:true});
  const value=evaluateHifDeck([a,b],context(route));
  assert.equal(value.providedActions.p_drink_acquire,2);
  assert.equal(value.cappedStats.dance,12);
});
