import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recommend } from '../lib/recommend.mjs';

const effect = (type, amount, triggerId = '') => ({ type: 'ProduceEffectType_' + type, min: amount, max: amount, triggerId });
const ability = (kind, value, activationLimit = 0) => ({ level: 1, order: 1, kind, effects: [value], activationLimit });
const support = (gameId, attribute, levelAbilities = []) => ({
  gameId, name: gameId, attribute, plan: 'free', maxLevels: { 0: 40, 4: 60 }, levelAbilities
});
const score = (cards, owned, options = {}, extra = {}, inventory = {}) => recommend({
  catalog: { supportCards: cards, idolCards: [], skillCards: [], memoryAbilities: [], calculationModels: {}, ...extra },
  inventory: { supportCards: owned.map(card => ({ gameId: card.gameId, level: 40, uncap: 0 })), ...inventory },
  options: { scenario:'hif', plan:'sense', activityFocus:'consult', targetAttribute:'dance',
    secondaryAttribute:'visual', classAttribute:'vocal', deckTemplate:'4-2', ...options }
});
const ids = result => result.supports.owned.map(card => card.gameId);
const produceResources = JSON.parse(readFileSync(new URL('../data/catalog/produce_resources.json',import.meta.url),'utf8'));

test('a weak SSR supplier and receivers below the per-attribute singleton cutoff survive as a three-support link', () => {
  const fillers = Array.from({length:15}, (_, i) => support('f' + i, 'dance', [ability('initial_stat',effect('DanceAddition',10),1)]));
  const provider = { ...support('z-source','dance'), skill_card:{name:'extra', rarity:'ssr', type:'active'},
    events:[{ release:'initial', effect_type:'skill_card' }] };
  const receivers = ['z-first', 'z-second'].map(id => support(id,'dance',[ability('ssr_card_acquire',effect('DanceAddition',45))]));
  const side = support('side','visual',[ability('initial_stat',effect('VisualAddition',1),1)]);
  const rental = support('rental','visual');
  const owned = [...fillers, provider, ...receivers, side];
  const result = score([...owned, rental],owned,{rentalGameId:rental.gameId});
  const members = ids(result);
  assert.ok(members.includes(provider.gameId) && receivers.every(card => members.includes(card.gameId)));
  const model = result.scoreSummary.hifModel;
  assert.equal(model.supportProvidedActions.ssr_card_acquire,1);
  assert.equal(model.cappedStats.dance,100); // 10 from the remaining slot, plus two distinct +45 triggers.
  const producer = result.supports.owned.find(card => card.gameId === provider.gameId);
  assert.equal(producer.supportContribution.cappedStatDelta.dance,90);
  assert.equal(producer.supportContribution.statEvaluationPoints,180);
  const saturated=score([...owned,rental],owned,{rentalGameId:rental.gameId,statCaps:{dance:70},selectionStatCaps:{dance:70}});
  assert.equal(saturated.scoreSummary.hifModel.cappedStats.dance,70);
  assert.ok(saturated.supports.owned.find(card=>card.gameId===provider.gameId).supportContribution.cappedStatDelta.dance <= 70);
  const reversed=score([rental,...owned.toReversed()],owned.toReversed(),{rentalGameId:rental.gameId});
  assert.deepEqual(ids(reversed).sort(),members.sort());
});

test('a pinned rental can provide the receipt that makes a low-ranked owned recipient useful', () => {
  const fillers = Array.from({length:13}, (_, i) => support('f' + i, 'dance', [ability('initial_stat',effect('DanceAddition',12),1)]));
  const recipient = support('z-linked','dance',[ability('ssr_card_acquire',effect('DanceAddition',40))]);
  const side = support('side','visual'), rental = {...support('rental','visual'),skill_card:{name:'SSR',rarity:'ssr',type:'mental'},
    events:[{release:'initial',effect_type:'skill_card'}]};
  const owned=[...fillers,recipient,side];
  const result=score([...owned,rental],owned,{rentalGameId:'rental'});
  assert.ok(ids(result).includes(recipient.gameId));
  assert.equal(result.supports.rental.supportContribution.cappedStatDelta.dance,40);
});

test('a same-level owned profile gives the rental its own availability and the independently calculated effects', () => {
  const dancers=[1,2,3,4].map(i=>support('d'+i,'dance')),side=support('side','visual');
  const rental={...support('same','visual',[ability('initial_stat',effect('VisualAddition',55),1)]),maxLevels:{0:40,4:40}};
  const cards=[...dancers,side,rental],options={rentalGameId:'same'};
  const withCopy=score(cards,cards,options),withoutCopy=score(cards,[...dancers,side],options);
  assert.deepEqual(withCopy.scoreSummary.projectedStats,withoutCopy.scoreSummary.projectedStats);
  const actual=withCopy.supports.rental;
  assert.deepEqual(actual.supportContribution,withoutCopy.supports.rental.supportContribution);
  assert.equal(actual.ownedLevel,null);
  assert.equal(actual.levelBasis,'rental');
  assert.equal(actual.uncap,4);
  assert.equal(actual.availabilityVerified,false);
  assert.ok(!ids(withCopy).includes(rental.gameId));
});

test('a pinned third-attribute rental fills an auto layout with a fixed secondary and reports a fixed-template conflict', () => {
  const dancers = [1, 2, 3, 4].map(i => support('d' + i, 'dance', [ability('initial_stat', effect('DanceAddition', 20), 1)]));
  const owned = [...dancers, support('singer', 'vocal')], rental = support('vi-rental', 'visual');
  const options = { secondaryAttribute: 'vocal', classAttribute: 'visual', rentalGameId: rental.gameId };
  const automatic = score([...owned, rental], owned, { ...options, deckTemplate: 'auto' });
  assert.equal(automatic.supports.owned.length, 5);
  assert.equal(automatic.supports.rental.gameId, rental.gameId);
  assert.equal(automatic.supports.deckTemplate, '4-1-1');
  const fixed = score([...owned, rental], owned, { ...options, deckTemplate: '4-2' });
  assert.equal(fixed.supports.rental, null);
  assert.equal(fixed.supports.rentalConstraintConflict.reason, 'fixed_template_excludes_attribute');
  assert.ok(fixed.warnings.some(line => line.includes('고정 4-2') && line.includes('비주얼')));
});

test('a low solo total survives when a support slot can raise an uncapped stat', () => {
  const dancers = Array.from({ length: 14 }, (_, i) => support('d' + i, 'dance', [ability('initial_stat', effect('DanceAddition', 40), 1)]));
  const offStat = support('off-stat', 'dance', [ability('initial_stat', effect('VisualAddition', 19), 1)]);
  const owned = [...dancers, offStat, support('side', 'visual')], rental = support('rental', 'visual');
  const models = { produceResources, calculationModels: {
    'score/schedule': { table: { hif: { none: [{ week: 1, stage: 'selection' }] } } },
    'score/lesson': { table: { hif: { none: { 1: [{ type: 'sp', main: 1, sub: 0 }] } } } },
    'score/hifSelectionExams': { entries: [] }
  } };
  const result = score([...owned, rental], owned, { rentalGameId: 'rental', statCaps: { dance: 100 }, selectionStatCaps: { dance: 100 } }, models);
  assert.ok(ids(result).includes(offStat.gameId));
  assert.deepEqual(result.scoreSummary.projectedStats, { vocal: 0, dance: 100, visual: 19 });
});

test('three otherwise weak skill suppliers can collectively reach 15 cards and reward a fourth support', () => {
  const fillers = Array.from({ length: 14 }, (_, i) => support('f' + i, 'dance', [ability('initial_stat', effect('DanceAddition', 20), 1)]));
  const providers = [1, 2, 3].map(i => ({ ...support('give-' + i, 'dance'), skill_card: { name: 'skill-' + i, rarity: 'R', type: 'active' },
    events: [{ release: 'initial', effect_type: 'skill_card' }] }));
  const receiver = support('receive', 'dance', [ability('exam_15', effect('DanceAddition', 220))]);
  const side = support('side', 'visual'), rental = support('rental', 'visual'), idol = { gameId: 'idol', plan: 'sense' };
  const owned = [...fillers, ...providers, receiver, side];
  const catalog = {
    idolCards: [idol], skillCards: [{ gameId: 'basic', sourceType: 'default' }], produceResources,
    produceInitialDecks: {
      idolProfiles: [{ idolCardId: 'idol', scenarioDeckIds: { 'produce-007': 'start' }, uniqueCardIds: [] }],
      decks: { start: { cardCount: 12, cardSlots: Array.from({ length: 12 }, () => ({ cardId: 'basic' })) } }
    },
    calculationModels: {
      'score/schedule': { table: { hif: { none: [{ week: 1, stage: 'selection' }, { week: 2, stage: 'selection', activities: ['mid_exam'] }] } } },
      'score/lesson': { table: { hif: { none: { 1: [{ type: 'sp', main: 1, sub: 0 }] } } } },
      'score/hifSelectionExams': { entries: [] }
    }
  };
  const result = score([...owned, rental], owned, { rentalGameId: 'rental', idolGameId: 'idol', objective: 'stats' }, catalog, { idolCards: [{ gameId: 'idol' }] });
  assert.deepEqual(result.scoreSummary.hifModel.supportActionPlan.peakScenario.examDeckSizes, [12]);
  assert.ok([receiver, ...providers].every(card => ids(result).includes(card.gameId)));
  assert.equal(result.scoreSummary.hifModel.supportProvidedActions.exam_15, 1);
  assert.equal(result.scoreSummary.projectedStats.dance, 221);
});

test('large auto shortlist reports only a physically reachable enhancement and keeps a pinned rental', () => {
  const fillers = Array.from({length:42}, (_, i) => support('fill'+i,['dance','visual','vocal'][i%3]));
  const donors = ['dance','visual'].map((axis,i) => ({...support('donor'+i,axis,
    [ability('initial_stat',effect('DanceAddition',100),1)]),events:[{release:'initial',effect_type:'select_enhance'}]}));
  const rental = support('receiver','vocal',[ability('skill_enhance',effect('VocalAddition',18))]);
  const idol={gameId:'idol',plan:'sense'};
  const catalog={idolCards:[idol],produceResources,
    skillCards:[0,1].map(upgradeCount=>({gameId:'target',upgradeCount,type:'mental',rarity:'R',sourceType:'produce'})),
    produceInitialDecks:{idolProfiles:[{idolCardId:'idol',scenarioDeckIds:{'produce-007':'deck'},uniqueCardIds:[]}],
      decks:{deck:{cardCount:1,cardSlots:[{cardId:'target',upgradeCount:0}]}}},
    calculationModels:{'score/schedule':{table:{hif:{none:[{week:1,stage:'selection'},{week:2,stage:'selection',activities:['mid_exam']}]}}},
      'score/lesson':{table:{hif:{none:{1:[{type:'sp',main:1,sub:0}]}}}},'score/hifSelectionExams':{entries:[]}}};
  const owned=[...fillers,...donors];
  const result=score([...owned,rental],owned,{targetAttribute:'auto',secondaryAttribute:'auto',deckTemplate:'auto',
    idolGameId:'idol',rentalGameId:'receiver',hifConsultPlan:'drinks',hifScenarioItemPath:'none'},catalog,{idolCards:[{gameId:'idol'}]});
  const model=result.scoreSummary.hifModel;
  assert.equal(model.search.largePoolScreening.applied,true);
  assert.ok(model.search.largePoolScreening.sixCardPhysicalReplays>0);
  assert.equal(result.supports.rental.gameId,'receiver');
  assert.ok(donors.every(card=>ids(result).includes(card.gameId)));
  assert.equal(model.supportProvidedActions.skill_enhance,1);
  assert.equal(result.supports.rental.supportContribution.cappedStatDelta.vocal,18);
});

test('with retries the SP helper is a tiebreaker; an explicit declared route retains the SP priority', () => {
  const stats=Array.from({length:4},(_,i)=>support('stat'+i,'dance',[ability('initial_stat',effect('DanceAddition',100 + i),1)]));
  const sp=support('sp','dance',[ability('sp_lesson_rate',effect('LessonDanceSpChangeRatePermilAddition',210),1)]);
  const side = support('side','visual'), rental=support('rental','visual');
  const owned=[...stats,sp,side], cards=[...owned,rental], opts={rentalGameId:rental.gameId};
  const models = {produceResources,calculationModels:{'score/schedule':{table:{hif:{none:[{week:1,stage:'selection'}]}}},
    'score/lesson':{table:{hif:{none:{1:[{type:'sp',main:10,sub:0}]}}}}}};
  const peak=score(cards,owned,opts,models), declared=score(cards,owned,{...opts,supportActionMode:'declared'},models);
  assert.equal(peak.scoreSummary.hifModel.supportPeakScenario,true);
  assert.ok(!ids(peak).includes(sp.gameId));
  assert.ok(ids(declared).includes(sp.gameId));
  assert.ok(peak.scoreSummary.projectedStats.dance > declared.scoreSummary.projectedStats.dance);
});

test('the same consultation week in two focuses retains their separate purchases and scores', () => {
  const drink = support('drink','dance',[ability('p_drink_acquire',effect('DanceAddition',4))]);
  const owned = [drink, ...['d1','d2','d3'].map(id => support(id,'dance')), support('side','visual')];
  const rental = support('rental','visual');
  const models = {produceResources, calculationModels:{'score/schedule':{table:{hif:{none:[
    {week:1,stage:'selection'},{week:2,stage:'selection',activities:['consult']}]}}},
    'score/lesson':{table:{hif:{none:{1:[{type:'sp',main:10,sub:0}]}}}}}};
  const result = score([...owned,rental],owned,{activityFocus:'auto',initialPP:200,rentalGameId:'rental',
    hifScenarioItemPath:'none',produceActions:[{action:'drink_acquire',week:1,fromExamIndex:0,venue:'lesson',quantity:1}]},models);
  const byFocus = Object.fromEntries(result.activityRouteComparison.candidates.map(row => [row.focus,row.scoreSummary]));
  assert.deepEqual(byFocus.consult.hifModel.selections,byFocus.outing.hifModel.selections);
  const added = byFocus.consult.expectedCounts.p_drink_acquire - (byFocus.outing.expectedCounts.p_drink_acquire ?? 0);
  assert.ok(added > 0);
  assert.equal(byFocus.consult.projectedStats.dance - byFocus.outing.projectedStats.dance,4 * added);
});
