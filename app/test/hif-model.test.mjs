import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { loadCatalog } from '../lib/catalog.mjs';
import { allocateExamGain, buildHifRoute, calculateGrowthBonus, evaluateHifDeck, calculateHifSupport,resolveHifExamRewards,hifExamRewardGain } from '../lib/hif-model.mjs';

const zero = () => ({ vocal: 0, dance: 0, visual: 0 });
const profile = (axis, fixed, permil = 0) => ({ fixedStats: { ...zero(), [axis]: fixed }, growthRatePermil: { ...zero(), [axis]: permil }, resources: { spRates: zero(), stamina: 0, pp: 0 }, dynamicEffects: [], providedActions: {} });

test('HIF route keeps explicit lesson pair, reverse-axis classes and three exam gains separate', () => {
  const route = buildHifRoute(loadCatalog(), 'dance', { secondaryAttribute: 'visual' });
  assert.deepEqual(route.lessonGains, { vocal: 0, dance: 800, visual: 340 });
  assert.deepEqual(route.classGains, { vocal: 900, dance: 0, visual: 0 });
  assert.deepEqual(route.examGains, { vocal: 365, dance: 365, visual: 370 });
  assert.deepEqual(route.gains, { vocal: 365, dance: 1165, visual: 710 });
  assert.equal(route.parameterBonusRows.length, 11);
  assert.equal(route.perAxis.dance.sp_lesson_end, 8);
  assert.equal(route.perAxis.visual.sp_lesson_end, 0);
  assert.ok(route.notes.some(note => note.includes('균등 배분')));
});

test('activity focus changes only selectable nonlesson days and recomputes both stage counts',()=>{
  const c={calculationModels:{
    'score/schedule':{table:{hif:{none:[
      {week:1,stage:'selection',activities:['consult','outing','supply_gift']},
      {week:2,stage:'selection',activities:['da_lesson_vi','outing']},
      {week:3,stage:'selection',activities:['class_vo','consult']},
      {week:4,stage:'selection',activities:['mid_exam']},
      {week:5,stage:'final',activities:['consult','supply_gift']}]}}},
    'score/lesson':{table:{hif:{none:{2:[{main:100,sub:40}]}}}},
    'score/class':{table:{hif:{none:{3:120}}}}
  }};
  const consult=buildHifRoute(c,'dance',{secondaryAttribute:'visual',activityFocus:'consult'});
  const outing=buildHifRoute(c,'dance',{secondaryAttribute:'visual',activityFocus:'outing'});
  const gift=buildHifRoute(c,'dance',{secondaryAttribute:'visual',activityFocus:'supply_gift'});
  assert.equal(consult.counts.consult,2);assert.equal(outing.counts.outing,1);assert.equal(outing.counts.consult,1);
  assert.equal(gift.counts.activity_supply_gift,2);assert.equal(gift.stages.selection.counts.activity_supply_gift,1);
  assert.equal(gift.stages.final.counts.activity_supply_gift,1);
  for(const route of [consult,outing,gift]){
    assert.equal(route.selections[1].activity,'da_lesson_vi');assert.equal(route.selections[2].activity,'class_vo');
    assert.equal(route.selections[3].activity,'mid_exam');assert.equal(route.selections[4].fromExamIndex,1);
    assert.deepEqual(route.perAxis,consult.perAxis);assert.deepEqual(route.gains,consult.gains);
  }
  assert.throws(()=>buildHifRoute(c,'dance',{activityFocus:'fake'}),/activityFocus/);
});

test('declared actions at a consult week do not activate when an outing route selects another venue',()=>{
  const c={skillCards:[],calculationModels:{'score/schedule':{table:{hif:{none:[{week:1,activities:['consult','outing']}]}}}}};
  const action={id:'purchase',action:'acquire',venue:'consult',week:1,fromExamIndex:0,gameId:'skill'};
  const consult=buildHifRoute(c,'dance',{activityFocus:'consult',produceActions:[action]});
  const outing=buildHifRoute(c,'dance',{activityFocus:'outing',produceActions:[action]});
  assert.equal(consult.counts.consult_skill_card_acquire,1);assert.equal(outing.counts.consult_skill_card_acquire,0);
  assert.equal(outing.produceActions.length,0);assert.equal(outing.excludedProduceActions[0].id,'purchase');
  assert.equal(action.excludedReason,undefined);
});

test('growth rates aggregate before each opportunity is floored; no invented percent cap', () => {
  const route = { gains: { vocal: 333, dance: 0, visual: 0 }, classGains: zero(), parameterBonusRows: [{ vocal: 333, dance: 0, visual: 0 }] };
  const result = evaluateHifDeck([profile('vocal', 0, 50), profile('vocal', 0, 50)], { route, statCaps: { vocal: 999, dance: 999, visual: 999 } });
  assert.equal(result.growthBonus.vocal, 33); // floor(333 * (50+50) / 1000), not 16+16.
  assert.equal(calculateGrowthBonus([{ vocal: 100, dance: 0, visual: 0 }], { vocal: 1200 }).vocal, 120);
  assert.equal(result.growthRateCapApplied, false);
});

test('actual post-bonus exam gains bypass growth while legacy base rewards retain one growth application',()=>{
  const post=resolveHifExamRewards({}, {hifExamResults:[{examIndex:0,parameterGains:{vocal:100,dance:0,visual:0}}]});
  assert.equal(post[0].basis,'post_bonus');assert.equal(post[0].assumedMaximum,false);
  assert.deepEqual(hifExamRewardGain(post[0],{vocal:1000,dance:1000,visual:1000}),{vocal:100,dance:0,visual:0});
  const base=resolveHifExamRewards({}, {hifExamResults:[{examIndex:0,gainBasis:'base',parameterGains:{vocal:100,dance:0,visual:0}}]});
  assert.deepEqual(hifExamRewardGain(base[0],{vocal:1000,dance:0,visual:0}),{vocal:200,dance:0,visual:0});
  assert.equal(post[1].source,'maximum_reward_reference');assert.equal(post[1].assumedMaximum,true);
  const scoreOnly=resolveHifExamRewards({}, {hifExamResults:[{examIndex:0,score:6100}]});
  assert.deepEqual(scoreOnly[0].parameterGains,resolveHifExamRewards({})[0].parameterGains);
  assert.equal(scoreOnly[0].scoreToRewardFormulaApplied,false);assert.equal(scoreOnly[0].assumedMaximum,true);
});

test('a missing reward field is not zero but explicit zero is valid, and native selection indexing is enforced',()=>{
  assert.throws(()=>resolveHifExamRewards({}, {hifExamResults:[{examIndex:0,parameterGains:{vocal:10,dance:0}}]}),/세 값/);
  assert.throws(()=>resolveHifExamRewards({}, {hifExamResults:[{examIndex:0,parameterGains:{vocal:-1,dance:0,visual:0}}]}),/세 값/);
  assert.throws(()=>resolveHifExamRewards({}, {hifExamResults:[{examIndex:3,parameterGains:zero()}]}),/0~2/);
  assert.throws(()=>resolveHifExamRewards({}, {hifExamResults:[{examIndex:0},{examIndex:0}]}),/중복/);
  assert.deepEqual(resolveHifExamRewards({}, {hifExamResults:[{examIndex:0,parameterGains:zero()}]})[0].parameterGains,zero());
});

test('observed reward overflow is lost at the selection cap and cannot return under the larger final cap',()=>{
  const c={calculationModels:{'score/schedule':{table:{hif:{none:[
    {week:7,stage:'selection',activities:['final_exam']},{week:13,stage:'selection',activities:['final_exam']},
    {week:20,stage:'selection',activities:['mid_exam']},{week:22,stage:'final',activities:['da_lesson_vo']}]}}},
    'score/lesson':{table:{hif:{none:{22:[{main:100,sub:0}]}}}}}};
  const route=buildHifRoute(c,'dance',{secondaryAttribute:'vocal',hifExamResults:[0,1,2].map(examIndex=>({examIndex,
    parameterGains:{vocal:examIndex===0?100:0,dance:0,visual:0}}))});
  const context={route,initialStats:{vocal:2995,dance:0,visual:0},statCaps:{vocal:3200,dance:3200,visual:3200},stageContexts:{
    selection:{statCaps:{vocal:3000,dance:3000,visual:3000},outsideGrowthRatePermil:{vocal:1000,dance:0,visual:0}},
    final:{statCaps:{vocal:3200,dance:3200,visual:3200},outsideGrowthRatePermil:zero()}}};
  const value=evaluateHifDeck([],context);
  assert.equal(value.stageResults[0].cappedStats.vocal,3000);assert.equal(value.stageResults[0].wastedStats.vocal,95);
  assert.equal(value.cappedStats.vocal,3000);assert.equal(value.wastedStats.vocal,95);
  assert.equal(value.stageResults[0].examRewardApplications[0].nominalGainBeforeCap.vocal,100);
  const vo=evaluateHifDeck([profile('vocal',50)],context),da=evaluateHifDeck([profile('dance',40)],context);
  assert.equal(vo.cappedStats.vocal,value.cappedStats.vocal);assert.ok(da.score>vo.score);
});

test('initial carry and growth apply before the actual chosen final stat cap', () => {
  const route = { gains: { vocal: 1000, dance: 1000, visual: 0 }, classGains: { vocal: 0, dance: 0, visual: 100 }, parameterBonusRows: [{ vocal: 1000, dance: 1000, visual: 0 }] };
  const result = evaluateHifDeck([profile('vocal', 1000, 300)], { route, initialStats: { vocal: 200, dance: 30, visual: 10 }, outsideGrowthRatePermil: { vocal: 200, dance: 0, visual: 0 }, statCaps: { vocal: 1500, dance: 2000, visual: 2000 } });
  assert.deepEqual(result.rawStats, { vocal: 2700, dance: 1030, visual: 110 });
  assert.deepEqual(result.cappedStats, { vocal: 1500, dance: 1030, visual: 110 });
  assert.equal(result.wastedStats.vocal, 1200);
});

test('exam allocation preserves totals, zero axes, and the upstream tie remainder rule', () => {
  assert.deepEqual(allocateExamGain(80), { vocal: 26, dance: 26, visual: 28 });
  assert.deepEqual(allocateExamGain(80, { vocal: 0, dance: 1, visual: 1 }), { vocal: 0, dance: 40, visual: 40 });
  assert.deepEqual(allocateExamGain(5, { vocal: 1, dance: 1, visual: 1 }), { vocal: 3, dance: 1, visual: 1 });
});

test('actual level gates events and master permil boosts event points', () => {
  const card = { gameId: 'event', events: [{ release: 'lv20', effect_type: 'param_boost', param_type: 'dance', param_value: 15 }] };
  const abilities = [{ kind: 'event_boost', effects: [{ type: 'ProduceEffectType_SupportCardEventParameterAdditionValueUp', min: 1000, max: 1000 }] }];
  const route = { counts: {}, perAxis: {}, parameterBonusRows: [] };
  assert.equal(calculateHifSupport(card, abilities, 19, route, 'sense').fixedStats.dance, 0);
  assert.equal(calculateHifSupport(card, abilities, 20, route, 'sense').fixedStats.dance, 30);
});

test('selection cap discards overflow before final-only cap and growth are applied', () => {
  const selection = { parameterBonusRows: [{ vocal: 100, dance: 0, visual: 0 }], gains: { vocal: 100, dance: 0, visual: 0 }, classGains: zero() };
  const final = { parameterBonusRows: [{ vocal: 100, dance: 0, visual: 0 }], gains: { vocal: 100, dance: 0, visual: 0 }, classGains: zero() };
  const route = { parameterBonusRows: [...selection.parameterBonusRows, ...final.parameterBonusRows], gains: { vocal: 200, dance: 0, visual: 0 }, classGains: zero(), stages: { selection, final } };
  const result = evaluateHifDeck([], { route, initialStats: { vocal: 2990, dance: 0, visual: 0 }, statCaps: { vocal: 3200 }, stageContexts: {
    selection: { statCaps: { vocal: 3000 }, outsideGrowthRatePermil: zero() },
    final: { statCaps: { vocal: 3200 }, outsideGrowthRatePermil: { vocal: 500, dance: 0, visual: 0 }, additionalInitialStats: { vocal: 10, dance: 0, visual: 0 } },
  } });
  assert.equal(result.cappedStats.vocal, 3160); // 3000 carried + 10 final-only + 100 + 50 growth; 90 lost cannot return.
  assert.equal(result.stageResults[0].wastedStats.vocal, 90);
  assert.equal(result.wastedStats.vocal, 90);
});

test('support acquisition synergy has one shared unique-skill acquisition and respects limits', () => {
  const first = { ...profile('vocal', 0), providedSkillKey: 'unique', providedActions: { skill_acquire: 1 } };
  const second = { ...profile('dance', 0), providedSkillKey: 'unique', providedActions: { skill_acquire: 1 } };
  const receiver = { ...profile('visual', 0), dynamicEffects: [{ axis: 'visual', kind: 'skill_acquire', amount: 10, usedCount: 0, maxCount: 5 }] };
  const route = { gains: zero(), classGains: zero(), parameterBonusRows: [] };
  const result = evaluateHifDeck([first, second, receiver], { route, statCaps: { vocal: 3200, dance: 3200, visual: 3200 } });
  assert.equal(result.rawStats.visual, 10);
});

test('confirmed final P-item acquisition adds support synergy after the selection cap, including the provider own ability',()=>{
  const catalog=loadCatalog(),provider=catalog.supportCards.find(card=>card.gameId==='s_card-3-0099');
  const receiver=catalog.supportCards.find(card=>card.gameId==='s_card-3-0078');
  const ability=receiver.levelAbilities.find(row=>row.kind==='p_item_acquire'&&row.level===51);
  const stage=()=>({counts:{p_item_acquire:0},perAxis:{},parameterBonusRows:[],gains:zero(),classGains:zero()});
  const route={...stage(),stages:{selection:stage(),final:stage()}};
  const context={route,initialStats:{vocal:3000,dance:0,visual:0},statCaps:{vocal:3200},
    stageContexts:{selection:{statCaps:{vocal:3000}},final:{statCaps:{vocal:3200}}}};
  for(const ownsAbility of [false,true]){
    const options={catalog,supportItemAcquisitions:{[provider.gameId]:{confirmed:true,fromExamIndex:3,week:21}}};
    const a=calculateHifSupport({...provider,events:provider.events.filter(event=>event.effect_type==='p_item')},ownsAbility?[ability]:[],60,route,'sense',options);
    const b=calculateHifSupport({...receiver,events:[]},ownsAbility?[]:[ability],60,route,'sense',options);
    const result=evaluateHifDeck([a,b],context);
    assert.equal(result.stageResults[0].rawStats.vocal,3000);
    assert.equal(result.stageResults[0].wastedStats.vocal,0);
    assert.equal(result.stageResults[1].rawStats.vocal,3015);
    assert.equal(result.cappedStats.vocal,3015);
    const selectionOptions={catalog,supportItemAcquisitions:{[provider.gameId]:{confirmed:true,fromExamIndex:0,week:1}}};
    const early=calculateHifSupport({...provider,events:provider.events.filter(event=>event.effect_type==='p_item')},ownsAbility?[ability]:[],60,route,'sense',selectionOptions);
    const earlyValue=evaluateHifDeck([early,b],context);
    assert.equal(earlyValue.stageResults[0].wastedStats.vocal,15);
    assert.equal(earlyValue.cappedStats.vocal,3000,'selection overflow stays discarded');
    const unknown=calculateHifSupport({...provider,events:provider.events.filter(event=>event.effect_type==='p_item')},ownsAbility?[ability]:[],60,route,'sense',{catalog});
    assert.equal(evaluateHifDeck([unknown,b],context).cappedStats.vocal,3000,'unconfirmed acquisition remains excluded');
  }
});

test('earlier P-item providers consume a shared activation limit before a receiver final acquisition',()=>{
  const stage=()=>({counts:{p_item_acquire:0},perAxis:{},parameterBonusRows:[],gains:zero(),classGains:zero()});
  const route={...stage(),stages:{selection:stage(),final:stage()}};
  const early={...profile('vocal',0),providedActions:{p_item_acquire:1},providedActionsByStage:{selection:{p_item_acquire:1},final:{}}};
  const late={...profile('vocal',15),fixedStatsByStage:{selection:zero(),final:{...zero(),vocal:15}},
    providedActions:{p_item_acquire:1},providedActionsByStage:{selection:{},final:{p_item_acquire:1}},
    dynamicEffects:[{axis:'vocal',kind:'p_item_acquire',amount:15,usedCount:1,maxCount:1,usedCountByStage:{selection:0,final:1}}]};
  const result=evaluateHifDeck([early,late],{route,initialStats:{...zero(),vocal:3000},statCaps:{vocal:3200},
    stageContexts:{selection:{statCaps:{vocal:3000}},final:{statCaps:{vocal:3200}}}});
  assert.equal(result.stageResults[0].wastedStats.vocal,15);
  assert.equal(result.stageResults[1].rawStats.vocal,3000);
  assert.equal(result.cappedStats.vocal,3000,'the same once-only activation is not granted again in final');
});

// Execute the pinned upstream functions, without replacing their arithmetic.
// These comparisons intentionally use zero acquisition synergy; conditional P-item
// and battle behaviour are outside this golden fixture's verified coverage.
function originalFunction(text, name) {
  const start = text.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'upstream function exists: ' + name);
  const body = text.indexOf('{', start);
  let depth = 1, end = body + 1;
  for (; depth && end < text.length; end++) { if (text[end] === '{') depth++; else if (text[end] === '}') depth--; }
  return text.slice(start, end);
}
const originalDirectory = new URL('../../work/gaku-navi/src/utils/', import.meta.url);
test('golden: capped deck math matches execution of the original MIT unit evaluator', { skip: !fs.existsSync(new URL('unitOptimizer/evaluator.ts', originalDirectory)) }, () => {
  const plain = path => stripTypeScriptTypes(fs.readFileSync(new URL(path, originalDirectory), 'utf8'), { mode: 'strip' });
  const bonusText = plain('calculator/parameterBonus.ts'), evaluatorText = plain('unitOptimizer/evaluator.ts');
  const referenceBonus = new Function('constant', originalFunction(bonusText, 'calculateParameterBonus') + ';return calculateParameterBonus;')({ PERCENT_DIVISOR: 100 });
  const referenceEvaluator = new Function('calculateParameterBonus', 'calculateSynergyScore',
    'let totalProvidedBuffer = new Float64Array(0); const supportScoreBuffer = new Float64Array(3); const supportPercentBuffer = new Float64Array(3);' +
    originalFunction(evaluatorText, 'ensureProvidedBuffer') + originalFunction(evaluatorText, 'createEvaluatorSeed') + originalFunction(evaluatorText, 'evaluateUnitScoreWithSeed') +
    ';return (members, rows, outside, ctx) => evaluateUnitScoreWithSeed(createEvaluatorSeed([]), members, rows, outside, ctx);')
    (referenceBonus, () => 0);
  const route = buildHifRoute(loadCatalog(), 'dance', { secondaryAttribute: 'visual' });
  const cards = [profile('dance', 1000, 200), profile('visual', 100, 85), profile('vocal', 40, 20),
    profile('dance', 60, 50), profile('visual', 30, 40), profile('dance', 10, 10)];
  const initialStats = { vocal: 100, dance: 100, visual: 100 };
  const outside = { vocal: 180, dance: 200, visual: 180 };
  const members = cards.map(card => ({ baseScoreWithoutParamBonus: Object.values(card.fixedStats).reduce((a, b) => a + b, 0), paramIndex: Object.values(card.fixedStats).findIndex(n => n > 0), paramBonusPercent: Object.fromEntries(Object.entries(card.growthRatePermil).map(([k, v]) => [k, v / 10])), providedActionsVec: new Float64Array(0), providedActionEntries: [], synergyAbilities: [] }));
  for (const cap of [1600, 2400, 3200, 3800]) {
    const actual = evaluateHifDeck(cards, { route, initialStats, outsideGrowthRatePermil: outside, statCaps: { vocal: cap, dance: cap, visual: cap } });
    const nonSupportParams = Object.fromEntries(Object.keys(initialStats).map(axis => [axis, initialStats[axis] + route.gains[axis] + route.classGains[axis]]));
    const expected = referenceEvaluator(members, route.parameterBonusRows, Object.fromEntries(Object.entries(outside).map(([k, v]) => [k, v / 10])), { nonSupportParams, paramCap: cap });
    assert.equal(actual.score, expected, 'stat cap ' + cap);
  }
});
