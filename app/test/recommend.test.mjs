import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../lib/catalog.mjs';
import { recommend } from '../lib/recommend.mjs';
import { evaluateHifGuideRole, hifGuideConflicts, findHifMemoryProfile } from '../lib/hif-memory-profile.mjs';

const effect = (amount, type = 'ProduceEffectType_VocalAddition') => ({ type, min: amount, max: amount, phase: 'ProducePhaseType_ProduceStart', triggerId: 'p_trigger-produce_start-initial', ratePermil: 0 });
const support = (id, amount, plan = 'free') => ({ gameId: id, id, name: id, plan, maxLevels: { 0: 40, 4: 60 }, levelAbilities: [{ level: 1, order: 1, kind: 'initial_stat', activationLimit: 1, effects: [effect(amount)] }] });
const catalog = cards => ({ supportCards: cards, idolCards: [], skillCards: [], memoryAbilities: [], calculationModels: {}, excelPresets: [] });
const owned = id => ({ gameId: id, level: 1, uncap: 0 });
const options = { scenario: 'hif', plan: 'sense' };

test('catalog joins protocol IDs and source-specific low-level values', () => {
  const data = loadCatalog();
  assert.equal(data.supportCards.length, 210);
  assert.equal(data.idolCards.length, 159);
  assert.equal(data.memoryAbilities.length, 585);
  const card = data.supportCards.find(row => row.gameId === 's_card-1-0000');
  assert.equal(card.nameJa, '念入りにストレッチ');
  assert.equal(card.maxLevels[0], 20);
  assert.ok(card.levelAbilities.some(row => row.level === 1));
  assert.deepEqual(data.planByCode, {});
  const hajime = data.scenarios.find(row => row.id === 'hajime');
  assert.deepEqual(hajime.availableDifficulties, ['pro', 'master', 'legend']);
  assert.deepEqual(hajime.modeledDifficulties, ['pro','master','legend']);
  const nia = data.scenarios.find(row => row.id === 'nia');
  assert.deepEqual(nia.availableDifficulties, ['pro', 'master']);
  assert.equal(nia.defaultDifficulty, 'master');
  assert.ok(data.skillCards.some(row => row.gameId === 'p_card-00-act-0_001' && row.upgradeCount === 0));
  const correctedSr = data.supportCards.find(row => row.rarity === 'SR' && row.abilities.some(ability => ability.name_key === 'initial_pp' && ability.sourceValues?.[0] === '65'));
  assert.ok(correctedSr);
  const pp = correctedSr.levelAbilities.filter(row => row.kind === 'initial_pp' && row.level <= 30).sort((a, b) => b.level - a.level)[0];
  assert.equal(pp.effects[0].min, 15); // This SR's master PP15 at level30; conflicting calculator value65 is not used.
});

test('uses actual level milestone and permil growth instead of max-level source values', () => {
  const s = support('owned', 10);
  s.levelAbilities.push({ level: 20, order: 1, kind: 'initial_stat', activationLimit: 1, effects: [effect(100)] });
  s.levelAbilities.push({ level: 1, order: 2, kind: 'parameter_bonus', effects: [effect(20, 'ProduceEffectType_VocalGrowthRateAddition')] });
  s.levelAbilities.push({ level: 1, order: 3, kind: 'sp_lesson_rate', effects: [effect(100, 'ProduceEffectType_LessonVocalSpChangeRatePermilAddition')] });
  const result = recommend({ catalog: catalog([s, support('rental', 1)]), inventory: { supportCards: [owned('owned')] }, options: { ...options, supportLevelMode:'current', baseLessonGains: { vocal: 1000 } } });
  const actual = result.supports.owned[0];
  assert.equal(actual.statContribution.vocal, 30); // 10 + 1000 × 20/1000
  assert.equal(actual.utilityScore, 5); // 100 permil = 10 percentage points × 0.5
  assert.equal(actual.score, 35);
});

test('five owned supports plus separate rental obey plan and card identity constraints', () => {
  const cards = Array.from({ length: 6 }, (_, i) => support(`own-${i}`, 10 + i));
  cards.push(support('unowned', 50), support('wrong-plan', 999, 'logic'));
  const inventory = { complete: true, supportCards: [...cards.slice(0, 6).map(row => owned(row.gameId)), owned('own-0'), owned('wrong-plan')] };
  const result = recommend({ inventory, catalog: catalog(cards), options: { ...options, allowSingleAttribute: true } });
  assert.equal(result.supports.owned.length, 5);
  assert.ok(result.supports.owned.every(row => row.gameId.startsWith('own-')));
  assert.equal(new Set(result.supports.owned.map(row => row.gameId)).size, 5);
  assert.equal(result.supports.rental.gameId, 'unowned');
  assert.ok(!result.supports.owned.some(row => row.gameId === result.supports.rental.gameId));
  assert.equal(result.scoreSummary.gameFinalScorePredicted, false);
});

test('unknown level and unmapped records remain incomplete instead of becoming max-level owned cards', () => {
  const result = recommend({ catalog: catalog([support('known', 10), support('unowned', 20)]), inventory: { complete: false, supportCards: [{ gameId: 'known', uncap: 0 }, owned('missing-id')] }, options });
  assert.equal(result.status, 'partial');
  assert.equal(result.supports.owned.length, 0);
  assert.ok(result.warnings.some(row => row.includes('레벨·돌파')));
  assert.ok(result.warnings.some(row => row.includes('알 수 없는')));
  assert.ok(result.warnings.some(row => row.includes('미보유로 판정하지')));
});

test('memory selection respects skill families, plan, scenario and unique activation', () => {
  const c = catalog([]);
  c.skillCards = [
    { gameId: 's', upgradeCount: 0, plan: 'sense', name: 'sense', actions: '', noDeckDuplication: true, recommendationEligible: true },
    { gameId: 's', upgradeCount: 1, plan: 'sense', name: 'sense+', actions: 'drawCard', noDeckDuplication: true, recommendationEligible: true },
    { gameId: 'l', upgradeCount: 0, plan: 'logic', name: 'logic', actions: 'drawCard', recommendationEligible: true },
    { gameId: 'f', upgradeCount: 0, plan: 'free', name: 'free', actions: '', recommendationEligible: true },
  ];
  c.memoryAbilities = [{ gameId: 'a', level: 1, plan: 'free', produceSkillId: 'unique-a', isUniqueActivation: true, summaryKo: 'HIF 전용', restrictions: { explicitGroupScenarios: ['hif'] }, branches: [{ phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 1000, directEffectType: 'ProduceEffectType_VocalAddition', directEffectValueMinRaw: 20, directEffectValueMaxRaw: 20 }] }];
  const inventory = { memories: [
    { id: 'm1', produceCardId: 's', produceCardUpgradeCount: 0, abilities: [{ memoryAbilityId: 'a', level: 1 }] },
    { id: 'm2', produceCardId: 's', produceCardUpgradeCount: 1 },
    { id: 'm3', produceCardId: 'l', produceCardUpgradeCount: 0 },
    { id: 'm4', produceCardId: 'f', produceCardUpgradeCount: 0, abilities: [{ memoryAbilityId: 'a', level: 1 }] },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `extra${i}`, produceCardId: 'f', produceCardUpgradeCount: 0 })),
  ] };
  const hif = recommend({ inventory, catalog: c, options });
  assert.equal(hif.memories.length, 2); // Only two distinct compatible carried skills are known.
  assert.ok(!hif.memories.some(row => row.id === 'm3'));
  assert.ok(hif.memories.filter(row => row.skillCard?.gameId === 's').length <= 1);
  assert.ok(hif.memories.filter(row => row.abilities.length).length <= 1);
  const nia = recommend({ inventory, catalog: c, options: { ...options, scenario: 'nia' } });
  assert.ok(nia.memories.every(row => row.abilities.length === 0));
});

test('farming lists only owned P-idol versions and missing memory upgrade is not assumed zero', () => {
  const c = catalog([]);
  c.idolCards = ['owned', 'unowned'].map(gameId => ({ gameId, id: gameId, plan: 'sense', recommendationEligible: true, baseStats: { growthRatePermil: { vo: 100, da: 100, vi: 100 } } }));
  c.skillCards = [{ gameId: 'skill', upgradeCount: 0, plan: 'sense', name: 'skill', recommendationEligible: true }];
  const result = recommend({ inventory: { idolCards: [{ idolCardId: 'owned' }], memories: [{ id: 'unknown-upgrade', produceCardId: 'skill', vocal: 999999 }] }, catalog: c, options });
  assert.deepEqual(result.farmingIdols.map(row => row.gameId), ['owned']);
  assert.equal(result.memories.length, 0);
  assert.ok(result.warnings.some(row => row.includes('추측하지')));
});

test('selected owned P-idol determines its actual plan despite conflicting form input', () => {
  const c = catalog([support('sense-only', 10, 'sense'), support('logic-only', 100, 'logic')]);
  c.idolCards = [{ gameId: 'sense-idol', plan: 'sense', recommendationEligible: true }];
  const inventory = { idolCards: [{ idolCardId: 'sense-idol' }], supportCards: [owned('sense-only'), owned('logic-only')] };
  const result = recommend({ inventory, catalog: c, options: { ...options, idolGameId: 'sense-idol', plan: 'logic' } });
  assert.equal(result.scoreSummary.plan, 'sense');
  assert.deepEqual(result.supports.owned.map(row => row.gameId), ['sense-only']);
  assert.ok(result.warnings.some(row => row.includes('실제 플랜')));
});

test('automatic target is owned, respects requested plan, and prevents mixed-plan support selection', () => {
  const c = catalog([support('sense-only', 100, 'sense'), support('logic-only', 10, 'logic'), support('free-rental', 1)]);
  c.idolCards = [
    { gameId: 'own-sense', name: '센스 보유', plan: 'sense', baseStats: { growthRatePermil: { vo: 100, da: 100, vi: 100 } }, awakeningStages: [{ rank: 1, growthRatePermilDelta: { vo: 400, da: 0, vi: 0 } }] },
    { gameId: 'own-logic', name: '로직 보유', plan: 'logic', baseStats: { growthRatePermil: { vo: 200, da: 200, vi: 200 } } },
    { gameId: 'not-owned', name: '미보유', plan: 'sense', baseStats: { growthRatePermil: { vo: 999, da: 999, vi: 999 } } },
  ];
  const inventory = { idolCards: [{ idolCardId: 'own-sense', awakeningRank: 0 }, { idolCardId: 'own-logic', awakeningRank: 0 }], supportCards: [owned('sense-only'), owned('logic-only')] };
  const auto = recommend({ inventory, catalog: c, options: { scenario: 'hif', plan: 'free' } });
  assert.equal(auto.selectedIdol.gameId, 'own-logic');
  assert.equal(auto.selectedIdol.selectionMode, 'automatic');
  assert.equal(auto.scoreSummary.plan, 'logic');
  assert.ok(auto.supports.owned.every(row => row.plan === 'logic' || row.plan === 'free'));
  assert.ok(auto.assumptions.some(row => row.includes('자동 선택')));
  const constrained = recommend({ inventory, catalog: c, options: { scenario: 'hif', plan: 'sense' } });
  assert.equal(constrained.selectedIdol.gameId, 'own-sense');
  inventory.idolCards[0].awakeningRank = 1;
  const awakened = recommend({ inventory, catalog: c, options: { scenario: 'hif', plan: 'free' } });
  assert.equal(awakened.selectedIdol.gameId, 'own-sense');
  const missing = recommend({ inventory: { complete: true }, catalog: c, options: { scenario: 'hif' } });
  assert.equal(missing.selectedIdol, null);
  assert.equal(missing.status, 'partial');
});

test('explicit supported difficulty uses its own schedule and does not silently substitute legend', () => {
  const s = support('owned', 0);
  s.levelAbilities = [{ level: 1, order: 1, kind: 'lesson_end', activationLimit: 0, effects: [effect(7)] }];
  const c = catalog([s, support('rental', 0)]);
  c.calculationModels = {
    'score/schedule': { table: { hajime: {
      pro: [{ week: 1, activities: ['vo_lesson'] }],
      legend: [{ week: 1, activities: ['vo_lesson'] }, { week: 2, activities: ['vo_lesson'] }],
      master: [],
    } } },
    'score/lesson': { table: { hajime: {
      pro: { 1: [{ type: 'sp', main: 10, sub: 1 }] },
      legend: { 1: [{ type: 'sp', main: 10, sub: 1 }], 2: [{ type: 'sp', main: 20, sub: 2 }] },
      master: {},
    } } },
  };
  const inventory = { supportCards: [owned('owned')] };
  const run = difficulty => recommend({ inventory, catalog: c, options: { scenario: 'hajime', plan: 'sense', difficulty, targetAttribute: 'vocal' } });
  const pro = run('pro'), legend = run('legend'), missing = run('master');
  assert.equal(pro.supports.owned[0].statContribution.vocal, 7); // One observed route lesson.
  assert.equal(legend.supports.owned[0].statContribution.vocal, 14); // Two observed route lessons.
  assert.equal(pro.scoreSummary.difficulty, 'pro');
  assert.equal(missing.scoreSummary.routeModelAvailable, false);
  assert.ok(missing.supports.owned[0].unscoredEffects > 0);
  assert.ok(missing.assumptions.some(row => row.includes('레슨 상승량은 미확인')));
  assert.throws(() => run('invented'), /No such difficulty/);
});

test('NIA keeps the selected guide difficulty independently of the shared Excel reference', () => {
  const run = difficulty => recommend({ catalog: catalog([]), inventory: {}, options: { scenario: 'nia', plan: 'sense', difficulty } });
  for (const [input, expected] of [[undefined, 'master'], ['none', 'master'], ['pro', 'pro'], ['master', 'master']]) {
    const result = run(input);
    assert.equal(result.scoreSummary.difficulty, expected);
    assert.equal(result.scoreSummary.routeModelSource, 'user_excel_cached_reference');
  }
  assert.throws(() => run('legend'), /NIA 난이도/);
});

test('unknown producer level warns without asserting that a carried skill is unlocked', () => {
  const c = catalog([]);
  c.skillCards = [{ gameId: 'skill', upgradeCount: 0, name: 'skill', plan: 'sense', unlockProducerLevel: 30, rentalUnlockProducerLevel: 30, recommendationEligible: true }];
  const inventory = { memories: [{ id: 'memory', produceCardId: 'skill', produceCardUpgradeCount: 0 }] };
  const unknown = recommend({ inventory, catalog: c, options });
  assert.equal(unknown.memories.length, 1);
  assert.ok(unknown.warnings.some(row => row.includes('PLv 해금 여부를 확인하지 못했습니다')));
  const locked = recommend({ inventory: { ...inventory, producerLevel: 20 }, catalog: c, options });
  assert.equal(locked.memories.length, 0);
});

const axisSupport = (id, attribute, amount, spPermil = 0) => {
  const card = support(id, amount);
  card.attribute = attribute;
  card.levelAbilities[0].effects = [effect(amount, 'ProduceEffectType_' + attribute[0].toUpperCase() + attribute.slice(1) + 'Addition')];
  if (spPermil) card.levelAbilities.push({ level: 1, order: 2, kind: 'sp_lesson_rate', activationLimit: 1,
    effects: [effect(spPermil, 'ProduceEffectType_Lesson' + attribute[0].toUpperCase() + attribute.slice(1) + 'SpChangeRatePermilAddition')] });
  return card;
};
function mixedCatalog() {
  const c = catalog([
    ...Array.from({ length: 5 }, (_, i) => axisSupport('da-' + i, 'dance', 100 - i, i === 0 ? 210 : 0)),
    ...Array.from({ length: 5 }, (_, i) => axisSupport('vi-' + i, 'visual', 60 - i, i === 0 ? 210 : 0)),
    axisSupport('rent-da', 'dance', 130, 280), axisSupport('rent-vi', 'visual', 90, 280),
  ]);
  c.calculationModels = {
    'score/schedule': { table: { hif: { none: [{ week: 1, stage: 'selection', activities: ['da_lesson_vi', 'vi_lesson_da'] }, { week: 2, stage: 'selection', activities: ['class_vo'] }, { week: 3, stage: 'final', activities: ['da_lesson_vi', 'vi_lesson_da'] }] } } },
    'score/lesson': { table: { hif: { none: { 1: [{ type: 'sp', main: 100, sub: 40 }], 3: [{ type: 'sp', main: 100, sub: 40 }] } } } },
    'score/class': { table: { hif: { none: { 2: 50 } } } },
    'score/paramCap': { table: { hif: { none: 3200 } } },
  };
  return c;
}
const mixedOptions = { scenario: 'hif', plan: 'sense', targetAttribute: 'dance', secondaryAttribute: 'visual' };

function preparationFixture() {
  // All supports occupy the same attribute slots, but one lower-total card
  // supplies the otherwise missing Visual bonus outside the normal top12 pool.
  const high=Array.from({length:13},(_,i)=>axisSupport('a-'+String(i).padStart(2,'0'),'dance',0));
  for(const card of high)card.levelAbilities[0].effects=[effect(100)];
  const balance=axisSupport('z-balance','dance',0);
  balance.levelAbilities[0].effects=[effect(80,'ProduceEffectType_VisualAddition')];
  const rental=axisSupport('rental','dance',0);
  const c=catalog([...high,balance,rental]);
  const inventory={supportCards:[...high,balance].map(card=>owned(card.gameId))};
  const opts={scenario:'hif',plan:'sense',targetAttribute:'dance',secondaryAttribute:'visual',classAttribute:'vocal',
    activityFocus:'consult',allowSingleAttribute:true,rentalGameId:'rental',
    initialStats:{vocal:100,dance:100,visual:100},hifExamResults:[0,1,2].map(examIndex=>({examIndex,parameterGains:{vocal:0,dance:0,visual:0}}))};
  return {c,inventory,opts};
}

test('preparation feasibility keeps a lower-total complete deck beyond the ordinary singleton pool',()=>{
  const {c,inventory,opts}=preparationFixture();
  const baseline=recommend({catalog:c,inventory,options:opts});
  const targets={vocal:100,dance:100,visual:180};
  const prepared=recommend({catalog:c,inventory,options:{...opts,preparationTargets:targets}});
  assert.ok(!baseline.supports.owned.some(card=>card.gameId==='z-balance'));
  assert.ok(prepared.supports.owned.some(card=>card.gameId==='z-balance'));
  assert.equal(prepared.supports.owned.length,5);assert.equal(prepared.supports.rental.gameId,'rental');
  const comparison=prepared.scoreSummary.hifModel.preparationComparison;
  assert.equal(comparison.status,'targets_met_in_bounded_search');assert.equal(comparison.met,true);
  assert.deepEqual(comparison.shortfall,{vocal:0,dance:0,visual:0});
  assert.ok(prepared.scoreSummary.hifModel.modeledStatTotal<baseline.scoreSummary.hifModel.modeledStatTotal);
  assert.deepEqual(comparison.unconstrainedCappedStats,baseline.scoreSummary.projectedStats);
  assert.equal(comparison.search.originalBeamPreserved,true);
  assert.equal(comparison.search.deficitOrderingIsSearchOnly,true);
  assert.equal(comparison.numericStatWeightsChanged,false);
  assert.equal(comparison.gameReadinessConfirmed,false);
  assert.equal(comparison.basis,'end_of_declared_route_conditional_projection');
});

test('unreachable preparation targets preserve the original current result and expose actual deficits',()=>{
  const {c,inventory,opts}=preparationFixture();
  const baseline=recommend({catalog:c,inventory,options:opts});
  const result=recommend({catalog:c,inventory,options:{...opts,classAttribute:undefined,preparationTargets:{vocal:9999,dance:9999,visual:9999}}});
  assert.deepEqual(result.supports,baseline.supports);
  assert.deepEqual(result.memories,baseline.memories);
  assert.deepEqual(result.scoreSummary.projectedStats,baseline.scoreSummary.projectedStats);
  const comparison=result.scoreSummary.hifModel.preparationComparison;
  assert.equal(comparison.status,'no_feasible_candidate_in_bounded_search');
  assert.equal(comparison.feasibleCandidateFound,false);assert.equal(comparison.fallbackPreserved,true);
  assert.equal(comparison.globalFeasibilityProven,false);
  assert.deepEqual(comparison.shortfall,Object.fromEntries(['vocal','dance','visual'].map(axis=>[axis,9999-result.scoreSummary.projectedStats[axis]])));
});

test('automatic class comparison checks all three axes while an explicit class remains binding',()=>{
  const {c,inventory,opts}=preparationFixture();
  c.calculationModels={
    'score/schedule':{table:{hif:{none:[{week:1,stage:'final',activities:['class_vo']}]}}},
    'score/class':{table:{hif:{none:{1:100}}}},
  };
  const setting={...opts,classAttribute:'auto',preparationTargets:{vocal:100,dance:100,visual:200}};
  const result=recommend({catalog:c,inventory,options:setting});
  assert.equal(result.scoreSummary.hifModel.classAttribute,'visual');
  assert.deepEqual(result.scoreSummary.hifModel.classComparison.map(row=>row.classAttribute),['vocal','dance','visual']);
  assert.equal(result.scoreSummary.hifModel.classComparison.filter(row=>row.selected).length,1);
  assert.equal(result.scoreSummary.hifModel.preparationComparison.met,true);
  const forced=recommend({catalog:c,inventory,options:{...setting,classAttribute:'vocal',preparationTargets:{vocal:100,dance:100,visual:9999}}});
  assert.equal(forced.scoreSummary.hifModel.classAttribute,'vocal');
  assert.deepEqual(forced.scoreSummary.hifModel.classComparison.map(row=>row.classAttribute),['vocal']);
  assert.equal(forced.scoreSummary.hifModel.preparationComparison.met,false);
});

test('infeasible targets do not replace fallback rentals with results from newly explored class axes',()=>{
  const c=mixedCatalog();
  c.supportCards[0].levelAbilities.push({level:1,order:3,kind:'parameter_bonus',
    effects:[effect(300,'ProduceEffectType_DanceGrowthRateAddition')]});
  const inventory={supportCards:c.supportCards.slice(0,10).map(card=>owned(card.gameId))};
  const opts={...mixedOptions,activityFocus:'consult'};
  const before=recommend({catalog:c,inventory,options:opts});
  const after=recommend({catalog:c,inventory,options:{...opts,preparationTargets:{vocal:9999,dance:9999,visual:9999}}});
  assert.equal(after.scoreSummary.hifModel.classComparison.length,3);
  assert.deepEqual(after.supports,before.supports);
  assert.deepEqual(after.memories,before.memories);
  assert.deepEqual(after.scoreSummary.projectedStats,before.scoreSummary.projectedStats);
});

test('preparation metadata follows activity and current-uncap leveling comparisons without changing owned levels',()=>{
  const {c,inventory,opts}=preparationFixture();
  const before=structuredClone(inventory);
  const result=recommend({catalog:c,inventory,options:{...opts,supportLevelMode:'current',activityFocus:'auto',compareSupportUpgrades:true,
    preparationTargets:{vocal:100,dance:100,visual:180}}});
  assert.ok(result.activityRouteComparison.candidates.every(row=>row.preparationComparison.met===true));
  assert.equal(result.supportUpgradeComparison.preparationComparison.met,true);
  assert.equal(result.supportUpgradeComparison.scoreSummary.hifModel.preparationComparison.met,true);
  assert.deepEqual(inventory,before);
  assert.ok(result.supports.owned.every(card=>card.level===1));
});

test('preparation target validation requires exactly three positive numeric values',()=>{
  const {c,inventory,opts}=preparationFixture();
  for(const preparationTargets of [null,{},[],{vocal:1,dance:1},{vocal:0,dance:1,visual:1},
    {vocal:true,dance:1,visual:1},{vocal:'100',dance:1,visual:1},{vocal:Infinity,dance:1,visual:1},
    {vocal:1,dance:1,visual:1,extra:1}])
    assert.throws(()=>recommend({catalog:c,inventory,options:{...opts,preparationTargets}}),/preparationTargets/);
});

test('entered exam rewards reselect the deck after one attribute saturates instead of rewarding discarded support stats',()=>{
  const c=mixedCatalog(),inventory={supportCards:c.supportCards.slice(0,10).map(card=>owned(card.gameId))};
  const settings={scenario:'hif',plan:'sense',activityFocus:'consult',targetAttribute:'free'};
  const before=recommend({catalog:c,inventory,options:settings});
  const after=recommend({catalog:c,inventory,options:{...settings,hifExamResults:[0,1,2].map(examIndex=>({examIndex,
    parameterGains:{vocal:0,dance:examIndex===0?9999:0,visual:0}}))}});
  assert.equal(before.supports.primaryAttribute,'dance');assert.equal(after.supports.primaryAttribute,'visual');
  assert.ok(after.scoreSummary.hifModel.discardedStats.dance>0);
  assert.equal(after.scoreSummary.hifModel.examMaximumRewardAssumed,false);
  assert.equal(after.scoreSummary.hifModel.examAllocationAssumedEqual,false);
  assert.equal(after.scoreSummary.hifModel.examRewards[0].basis,'post_bonus');
});

function sourceGuideFixture() {
  const c=mixedCatalog();
  c.supportCards.push(axisSupport('guide-vo','vocal',80,0),axisSupport('outside-da','dance',9999,1000));
  c.idolCards=[{gameId:'source-idol',id:'source-idol',plan:'sense',recommendationEligible:true,baseStats:{growthRatePermil:{vo:0,da:0,vi:0}}}];
  const ids=['guide-vo','da-0','da-1','da-2','da-3','vi-0'];
  const ref=id=>({gameId:id,attribute:c.supportCards.find(card=>card.gameId===id).attribute});
  c.guideSupportProfiles={sources:[{id:'author',url:'https://example.com/exact-idol',updated:'2026-10-24'}],profiles:[{
    id:'exact-source',idolGameId:'source-idol',scenario:'hif',plan:'sense',trainingType:'concentration',sourceIds:['author'],
    idealSupports:ids.map(ref),alternativeSupports:['da-4','vi-1','rent-da','rent-vi'].map(ref),conditions:['현재 레벨로 재비교'],limitations:[]}]};
  const inventory={producerLevel:70,supportCards:c.supportCards.filter(card=>!card.gameId.startsWith('rent-')).map(card=>owned(card.gameId)),idolCards:[{idolCardId:'source-idol'}]};
  const opts={...mixedOptions,idolGameId:'source-idol',trainingType:'concentration'};
  return {c,inventory,opts};
}

test('exact idol guide is the default support pool and current-level alternatives compete without a source rank bonus',()=>{
  const {c,inventory,opts}=sourceGuideFixture();
  const result=recommend({catalog:c,inventory,options:{...opts,supportLevelMode:'current'}});
  const evidence=result.sourceGuideEvidence;
  assert.equal(evidence.mode,'guide');assert.equal(evidence.profileId,'exact-source');
  assert.deepEqual(evidence.idealAttributeCounts,{vocal:1,dance:4,visual:1,assist:0});
  assert.equal(evidence.mixedAttributeCandidatesIncluded,true);
  assert.equal(evidence.authorReferenceCandidate.available,true);
  assert.ok(evidence.authorReferenceCandidate.owned.every(card=>card.level===1));
  assert.equal(evidence.currentOwnedLevelsUsed,true);assert.equal(evidence.sourceOrderUsedAsRank,false);
  assert.ok([...result.supports.owned,result.supports.rental].filter(Boolean).every(card=>evidence.poolGameIds.includes(card.gameId)));
  assert.ok(result.supports.owned.every(card=>card.level===1));
  assert.equal(result.scoreSummary.gameFinalScorePredicted,false);
  assert.deepEqual(result.scoreSummary.projectedStats,result.scoreSummary.hifModel.cappedStats);
  const all=recommend({catalog:c,inventory,options:{...opts,sourceSupportMode:'unrestricted'}});
  assert.equal(all.sourceGuideEvidence.mode,'unrestricted');
  assert.ok([...all.supports.owned,all.supports.rental].filter(Boolean).some(card=>card.gameId==='outside-da'));
});

test('author three-attribute reference can fill six slots while manual two-attribute templates remain binding',()=>{
  const {c,inventory,opts}=sourceGuideFixture();
  c.guideSupportProfiles.profiles[0].alternativeSupports=[];
  const result=recommend({catalog:c,inventory,options:opts});
  assert.equal(result.supports.owned.length,5);assert.ok(result.supports.rental);
  assert.equal(result.sourceGuideEvidence.exactIdealCompositionSelected,true);
  assert.equal(result.supports.deckTemplate,'source_reference6');
  const forced=recommend({catalog:c,inventory,options:{...opts,deckTemplate:'4-2'}});
  assert.equal(forced.sourceGuideEvidence.manualTemplatePreserved,true);
  assert.equal(forced.sourceGuideEvidence.mixedAttributeCandidatesIncluded,false);
  assert.equal(forced.supports.deckTemplate,'4-2');
  assert.equal(forced.supports.attributeCounts.vocal,0);
});

test('missing source cards use owned author alternatives and one rental without filling with unlisted cards',()=>{
  const {c,inventory,opts}=sourceGuideFixture();
  inventory.supportCards=inventory.supportCards.filter(row=>!['da-1','da-2','da-3'].includes(row.gameId));
  const result=recommend({catalog:c,inventory,options:opts});
  assert.equal(result.sourceGuideEvidence.completeSixCardDeck,true);
  assert.ok(result.sourceGuideEvidence.missingOwnedIdealIds.includes('da-1'));
  assert.ok(result.supports.owned.some(card=>['da-4','vi-1'].includes(card.gameId)));
  inventory.supportCards=inventory.supportCards.filter(row=>['guide-vo','da-0','outside-da'].includes(row.gameId));
  const partial=recommend({catalog:c,inventory,options:opts});
  assert.equal(partial.sourceGuideEvidence.completeSixCardDeck,false);
  assert.ok(partial.sourceGuideEvidence.unfilledSlots>0);
  assert.ok(!partial.supports.owned.some(card=>card.gameId==='outside-da'));
});

test('support source does not leak to another idol or training type and invalid mode fails explicitly',()=>{
  const {c,inventory,opts}=sourceGuideFixture();
  const result=recommend({catalog:c,inventory,options:{...opts,trainingType:'goodConditionTurns'}});
  assert.equal(result.sourceGuideEvidence.status,'no_exact_author_profile');
  assert.equal(result.sourceGuideEvidence.mode,'unrestricted');
  assert.throws(()=>recommend({catalog:c,inventory,options:{...opts,sourceSupportMode:'invented'}}),/sourceSupportMode/);
});

test('unknown source acquisition and customization stay unknown despite a fully recorded owned copy',()=>{
  const memory={id:'copy',modelEffects:{carriedSkill:{id:'skill',upgrade:1,obtainable:true,phase:{code:1},customizes:[]}}};
  const role={gameId:'skill',preferredUpgrade:1,sourceAcquisitionPhaseUnconfirmed:true,sourceCustomizationsFullyKnown:false};
  const result=evaluateHifGuideRole(role,memory);
  assert.equal(result.status,'unknown');
  assert.ok(result.checks.some(check=>check.kind==='source_acquisition_phase'&&check.passed===null));
  assert.ok(result.checks.some(check=>check.kind==='source_customizations'&&check.passed===null));
  const exact={gameId:'skill',exactCustomizations:[{id:'correct-custom',minimumCount:2}]};
  memory.modelEffects.carriedSkill.customizes=[{id:'different-custom',customizeCount:2,exactCountKnown:true}];
  assert.equal(evaluateHifGuideRole(exact,memory).status,'missing');
  memory.modelEffects.carriedSkill.customizes=[{id:'correct-custom',customizeCount:1,exactCountKnown:true}];
  assert.equal(evaluateHifGuideRole(exact,memory).status,'missing');
  memory.modelEffects.carriedSkill.customizes[0].customizeCount=2;
  assert.equal(evaluateHifGuideRole(exact,memory).status,'fulfilled');
});

test('ordinary HIF support lists stay out of events and stop matching after native unique identity changes',()=>{
  const {c,inventory,opts}=sourceGuideFixture();
  const event=recommend({catalog:c,inventory,options:{...opts,eventModeId:'asari'}});
  assert.equal(event.sourceGuideEvidence.mode,'unrestricted');
  assert.equal(event.sourceGuideEvidence.profileId,null);
  const profile=c.guideSupportProfiles.profiles[0];
  profile.expectedUniqueIds={produceCardId:'expected-unique'};
  c.idolCards[0].uniqueIds={produceCardId:'a-different-unique'};
  const swapped=recommend({catalog:c,inventory,options:opts});
  assert.equal(swapped.sourceGuideEvidence.profileId,null);
  c.idolCards[0].uniqueIds={produceCardId:'expected-unique'};
  assert.equal(recommend({catalog:c,inventory,options:opts}).sourceGuideEvidence.profileId,'exact-source');
});

test('auto activity comparison reselects supports by route effects without converting PP or recovery to points',()=>{
  const {c,inventory,opts}=sourceGuideFixture();
  c.calculationModels['score/schedule'].table.hif.none.unshift({week:0,stage:'selection',activities:['consult','outing','supply_gift']});
  const makeEffect=(id,kind,amount)=>c.supportCards.find(card=>card.gameId===id).levelAbilities.push({level:1,order:10,kind,activationLimit:10,
    effects:[effect(amount,'ProduceEffectType_DanceAddition')]});
  makeEffect('da-1','consult',300);makeEffect('da-2','outing',500);makeEffect('da-3','activity_supply_gift',800);
  const result=recommend({catalog:c,inventory,options:{...opts,activityFocus:'auto',compareSupportUpgrades:true}});
  const comparison=result.activityRouteComparison;
  assert.equal(comparison.candidates.length,3);assert.equal(comparison.evaluatedDistinctRoutes,3);
  assert.equal(comparison.selectedFocus,'supply_gift');
  const rows=Object.fromEntries(comparison.candidates.map(row=>[row.focus,row]));
  assert.equal(rows.consult.activityCounts.consult,1);assert.equal(rows.outing.activityCounts.outing,1);
  assert.equal(rows.supply_gift.activityCounts.activity_supply_gift,1);
  for(const row of comparison.candidates){
    assert.equal(row.scoreSummary.hifModel.activityFocus,row.focus);
    assert.equal(row.resources.ppAndHPConvertedToStatPoints,false);
    assert.ok(row.supports.owned.every(card=>row.sourceGuideEvidence.poolGameIds.includes(card.gameId)));
  }
  assert.ok(rows.supply_gift.statDelta.dance===0);
  assert.equal(result.supportUpgradeComparison.activityFocus,'supply_gift');
  assert.equal(result.supportUpgradeComparison.activityRouteReoptimized,false);
  const explicit=recommend({catalog:c,inventory,options:{...opts,activityFocus:'outing'}});
  assert.equal(explicit.activityRouteComparison.candidates.length,1);
  assert.equal(explicit.activityRouteComparison.selectedFocus,'outing');
});

test('identical available routes reuse stat search while focus metadata remains distinct and other scenarios stay unsupported',()=>{
  const {c,inventory,opts}=sourceGuideFixture();
  const result=recommend({catalog:c,inventory,options:opts});
  assert.equal(result.activityRouteComparison.evaluatedDistinctRoutes,1);
  assert.ok(result.activityRouteComparison.candidates.every(row=>row.focus===row.scoreSummary.hifModel.activityFocus));
  const nia=recommend({catalog:c,inventory,options:{...opts,scenario:'nia',activityFocus:'outing'}});
  assert.equal(nia.activityRouteComparison.status,'unsupported_scenario');
  assert.equal(nia.activityRouteComparison.candidates.length,0);
  assert.throws(()=>recommend({catalog:c,inventory,options:{...opts,activityFocus:'imaginary'}}),/activityFocus/);
});

test('automatic activity comparison preserves explicit support PP and stamina requirements before higher stats',()=>{
  for(const [requiredOption,resourceEffect,progressKey] of [
    ['requiredSupportPP','ProduceEffectType_ProducePointAdditionDisableTrigger','pp'],
    ['requiredSupportStamina','ProduceEffectType_StaminaRecoverFix','stamina']]){
    const cards=Array.from({length:6},(_,i)=>({gameId:'resource-'+i,name:'지원'+i,nameJa:'Support'+i,
      plan:'sense',attribute:i<3?'dance':'visual',maxLevels:{0:40,4:60},levelAbilities:[
        {level:1,order:1,kind:'consult',effects:[effect(100,resourceEffect)]},
        {level:1,order:2,kind:'outing',effects:[effect(100,'ProduceEffectType_DanceAddition')]}]}));
    const catalog={supportCards:cards,idolCards:[],skillCards:[],memoryAbilities:[],excelPresets:[],
      calculationModels:{'score/schedule':{table:{hif:{none:[{week:1,stage:'selection',activities:['consult','outing','supply_gift']}]}}}}};
    const inventory={supportCards:cards.map(card=>({gameId:card.gameId,level:40,uncap:0}))};
    const options={scenario:'hif',plan:'sense',trainingType:'concentration',targetAttribute:'dance',secondaryAttribute:'visual',
      activityFocus:'auto',compareSupportUpgrades:false,[requiredOption]:1};
    const comparison=recommend({catalog,inventory,options}).activityRouteComparison;
    assert.equal(comparison.selectedFocus,'consult',requiredOption);
    const consult=comparison.candidates.find(row=>row.focus==='consult'),outing=comparison.candidates.find(row=>row.focus==='outing');
    assert.ok(consult.scoreSummary.hifModel.progress[progressKey]>=1);
    assert.equal(outing.scoreSummary.hifModel.progress[progressKey],0);
    assert.ok(outing.scoreSummary.hifModel.modeledStatTotal>consult.scoreSummary.hifModel.modeledStatTotal);
  }
});

test('HIF current route and deck stay at actual levels when current-uncap leveling is shown separately',()=>{
  const {c,inventory,opts}=sourceGuideFixture();
  c.calculationModels['score/schedule'].table.hif.none.unshift({week:0,activities:['consult','outing','supply_gift']});
  const late=c.supportCards.find(card=>card.gameId==='da-4');
  late.levelAbilities.push({level:40,order:1,kind:'initial_stat',activationLimit:1,effects:[effect(1800,'ProduceEffectType_DanceAddition')]});
  const before=structuredClone(inventory);
  const current=recommend({catalog:c,inventory,options:{...opts,supportLevelMode:'current',activityFocus:'auto'}});
  const withLeveling=recommend({catalog:c,inventory,options:{...opts,supportLevelMode:'current',activityFocus:'auto',compareSupportUpgrades:true}});
  assert.deepEqual(withLeveling.supports,current.supports);assert.deepEqual(withLeveling.memories,current.memories);
  assert.deepEqual(withLeveling.scoreSummary,current.scoreSummary);
  assert.equal(withLeveling.activityRouteComparison.selectedFocus,current.activityRouteComparison.selectedFocus);
  assert.ok(withLeveling.supports.owned.every(card=>card.level===1));
  const alternative=withLeveling.supportUpgradeComparison;
  assert.equal(alternative.available,true);assert.equal(alternative.scope,'current_uncap_leveling_only');
  assert.equal(alternative.affordability,null);assert.equal(alternative.supportPointCost,null);
  assert.equal(alternative.currentAccountLevelsChanged,false);
  assert.ok(alternative.supports.owned.every(card=>card.level===40&&card.uncap===0));
  assert.deepEqual(inventory,before);assert.equal(withLeveling.nextUncapComparison,undefined);
});

test('all scenarios exclude other-plan, locked and switched-off memory skills even when their carry stats are larger', () => {
  const c = mixedCatalog();
  c.skillCards = [
    { gameId: 'confetti', upgradeCount: 1, name: '반짝반짝 색종이+', nameJa: 'きらきら紙吹雪+', plan: 'logic', unlockProducerLevel: 1, rentalUnlockProducerLevel: 1, recommendationEligible: true },
    { gameId: 'allowed', upgradeCount: 0, name: '전력용 스킬', plan: 'anomaly', unlockProducerLevel: 1, rentalUnlockProducerLevel: 1, recommendationEligible: true },
    { gameId: 'locked', upgradeCount: 0, name: 'PLv 반입 제한', plan: 'anomaly', unlockProducerLevel: 80, rentalUnlockProducerLevel: 71, recommendationEligible: true },
    { gameId: 'switch', upgradeCount: 0, name: '전환 비활성', plan: 'anomaly', unlockProducerLevel: 60, rentalUnlockProducerLevel: 50, requiresSkillCardSwitch: true, recommendationEligible: true },
  ];
  c.memoryAbilities = [
    { id: 'large', gameId: 'large', level: 1, produceSkillId: 'large', restrictions: { plan: 'free' }, activationCountRaw: 1,
      branches: [{ produceEffectId: 'large-effect', produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }] },
    { id: 'inactive', gameId: 'inactive', level: 1, produceSkillId: 'inactive', restrictions: { plan: 'logic' }, activationCountRaw: 1,
      branches: [{ produceEffectId: 'large-effect', produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }] },
  ];
  c.memoryMechanicsGraph = { ProduceEffect: [{ id: 'large-effect', produceEffectType: 'ProduceEffectType_DanceAddition', effectValueMin: 99999, effectValueMax: 99999 }], ProduceTrigger: [] };
  const inventory = { producerLevel: 70, skillCardSwitchSettings: { switch: false }, supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)), memories: [
    { id: 'other-plan', produceCard: { id: 'confetti', upgradeCount: 1 }, abilities: [{ id: 'large', level: 1 }] },
    { id: 'usable', produceCard: { id: 'allowed', upgradeCount: 0 }, abilities: [{ id: 'inactive', level: 1 }] },
    { id: 'too-low-level', produceCard: { id: 'locked', upgradeCount: 0 }, abilities: [{ id: 'large', level: 1 }] },
    { id: 'switch-off', produceCard: { id: 'switch', upgradeCount: 0 }, abilities: [{ id: 'large', level: 1 }] },
  ] };
  for (const scenario of ['hajime', 'nia', 'hif']) {
    const result = recommend({ inventory, catalog: c, options: { ...mixedOptions, scenario, plan: 'anomaly', trainingType: 'fullPower', desiredSkillIds: ['confetti'] } });
    assert.deepEqual(result.memories.map(memory => memory.id), ['usable']);
    assert.equal(result.memories[0].modelEffects.carriedSkill.obtainable, true);
    assert.equal(result.memories[0].modelEffects.initialStats.da, 0);
    assert.ok(result.warnings.some(warning => warning.includes('선택 플랜과 다른')));
    assert.ok(result.warnings.some(warning => warning.includes('현재 PLv')));
    if (scenario === 'hif') {
      assert.deepEqual(result.scoreSummary.hifModel.memoryRequirements.missing, ['skill:confetti']);
      assert.deepEqual(result.scoreSummary.hifModel.memoryInitialStats, { vocal: 0, dance: 0, visual: 0 });
    }
  }
  const unknown = recommend({ inventory: { ...inventory, producerLevel: null, memories: [inventory.memories[2]] }, catalog: c,
    options: { ...mixedOptions, plan: 'anomaly', trainingType: 'fullPower' } });
  assert.equal(unknown.memories.length, 1);
  assert.equal(unknown.memories[0].modelEffects.carriedSkill.obtainable, null);
  assert.ok(unknown.memories[0].reasons.some(reason => reason.includes('사용 조건 미확정')));
});

test('all scenarios honor a requested rental even when that card is owned and preserve it in upgrade comparisons', () => {
  const c = mixedCatalog();
  const inventory = { supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)) };
  for (const scenario of ['hajime', 'nia', 'hif']) {
    const result = recommend({ inventory, catalog: c, options: { ...mixedOptions, scenario, rentalGameId: 'da-0', compareSupportUpgrades: true } });
    assert.equal(result.supports.rental?.gameId, 'da-0');
    assert.ok(!result.supports.owned.some(card => card.gameId === 'da-0'));
    assert.equal(result.supportUpgradeComparison.supports.rental?.gameId, 'da-0');
    assert.ok(!result.supportUpgradeComparison.supports.owned.some(card => card.gameId === 'da-0'));
    assert.ok(result.supports.rentalCandidates.length > 0);
    assert.ok(!result.supports.rentalCandidates.some(card => card.gameId === 'da-0'));
  }
  const limited = recommend({ inventory: { supportCards: inventory.supportCards.slice(0, 5) }, catalog: c,
    options: { scenario: 'hajime', plan: 'sense', rentalGameId: 'da-0' } });
  assert.equal(limited.supports.rental?.gameId, 'da-0');
  assert.equal(limited.supports.owned.length, 4);
});

test('rental alternatives offer up to eight distinct compatible cards across complete deck comparisons', () => {
  const c = mixedCatalog();
  const extras = Array.from({ length: 12 }, (_, i) => axisSupport('alternative-' + i, i % 2 ? 'dance' : 'visual', 200 + i, 280));
  const wrongPlan = axisSupport('logic-only-rental', 'dance', 99999, 1000); wrongPlan.plan = 'logic';
  c.supportCards.push(...extras, extras[0], wrongPlan);
  const inventory = { supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)) };
  for (const scenario of ['hajime', 'nia', 'hif']) {
    const result = recommend({ inventory, catalog: c, options: { ...mixedOptions, scenario } });
    const alternatives = result.supports.rentalCandidates;
    assert.equal(alternatives.length, 8);
    assert.equal(new Set(alternatives.map(card => card.gameId)).size, 8);
    assert.ok(alternatives.every(card => card.gameId !== result.supports.rental.gameId && card.plan !== 'logic' && card.requiresReoptimization));
    assert.ok(alternatives.every(card => c.supportCards.some(source => source.gameId === card.gameId)));
    assert.equal(result.supports.rentalCandidatesRequireReoptimization, true);
  }
});

test('support upgrade comparison considers a low-level uncapped card without changing the current recommendation or inventory', () => {
  const late = support('late-unlock', 1);
  late.maxLevels = { 0: 20, 1: 40, 2: 50, 4: 60 };
  late.levelAbilities.push({ level: 50, order: 1, kind: 'initial_stat', activationLimit: 1, effects: [effect(500)] });
  const c = catalog([...Array.from({ length: 6 }, (_, i) => support('steady-' + i, 10 + i)), late, support('rental', 1000)]);
  const inventory = { supportCards: [...c.supportCards.slice(0, 6).map(card => ({ gameId: card.gameId, level: 40, uncap: 0 })),
    { gameId: 'late-unlock', level: 1, uncap: 2, raw: { level: 1, levelLimitRank: 2 } }] };
  const before = structuredClone(inventory);
  const settings = { scenario: 'hajime', plan: 'sense', targetAttribute: 'vocal', rentalGameId: 'rental',supportLevelMode:'current' };
  const baseline = recommend({ inventory, catalog: c, options: settings });
  const result = recommend({ inventory, catalog: c, options: { ...settings, compareSupportUpgrades: true } });
  const { supportUpgradeComparison: comparison, ...current } = result;
  assert.deepEqual(current, baseline);
  assert.deepEqual(inventory, before);
  assert.ok(!current.supports.owned.some(card => card.gameId === 'late-unlock'));
  assert.equal(comparison.available, true);
  assert.ok(comparison.supports.owned.some(card => card.gameId === 'late-unlock' && card.level === 50 && card.uncap === 2));
  assert.deepEqual(comparison.upgrades.map(({ gameId, currentLevel, targetLevel, uncap }) => ({ gameId, currentLevel, targetLevel, uncap })),
    [{ gameId: 'late-unlock', currentLevel: 1, targetLevel: 50, uncap: 2 }]);
  assert.deepEqual(comparison.addedSupportIds, ['late-unlock']);
  assert.equal(comparison.statBasis, 'scenario_capped_stats');
  assert.equal(comparison.statDelta.vocal, 500 - 11);
  assert.equal(comparison.statDelta.dance, 0);
  assert.equal(comparison.supports.rental.gameId, 'rental');
  assert.equal(comparison.scoreSummary.gameFinalScorePredicted, false);
});

test('support upgrade comparison never invents an uncap or an unknown level cap', () => {
  const capped = support('capped', 10), unknown = support('unknown-cap', 20);
  unknown.maxLevels = { 4: 60 };
  const c = catalog([capped, unknown]);
  const result = recommend({ inventory: { supportCards: [{ gameId: 'capped', level: 40, uncap: 0 }, { gameId: 'unknown-cap', level: 1, uncap: 2 }] },
    catalog: c, options: { scenario: 'hajime', compareSupportUpgrades: true } });
  assert.equal(result.supportUpgradeComparison.available, false);
  assert.equal(result.supportUpgradeComparison.unknownCount, 1);
  assert.deepEqual(result.supportUpgradeComparison.upgrades, []);
  assert.ok(!result.supportUpgradeComparison.supports);
});

test('default recommendation searches all owned cards at their own uncap maximum before picking the deck', () => {
  const late=support('two-uncaps',1);
  late.maxLevels={0:40,1:45,2:50,3:55,4:60};
  late.levelAbilities.push({level:50,order:1,kind:'initial_stat',effects:[effect(500)]},
    {level:55,order:1,kind:'initial_stat',effects:[effect(5000)]});
  const fixed=support('zero-uncaps',2);fixed.maxLevels={...late.maxLevels};
  fixed.levelAbilities.push({level:45,order:1,kind:'initial_stat',effects:[effect(9000)]});
  const c=catalog([late,fixed,...Array.from({length:4},(_,i)=>support('steady'+i,10+i)),support('rent',50)]);
  const inventory={supportCards:[{gameId:late.gameId,level:7,uncap:2,raw:{level:7,levelLimitRank:2}},
    {gameId:fixed.gameId,level:40,uncap:0},...c.supportCards.slice(2,6).map(card=>owned(card.gameId))]};
  const original=structuredClone(inventory), options={scenario:'hajime',rentalGameId:'rent',plan:'sense'};
  const primary=recommend({catalog:c,inventory,options});
  const atCap=primary.supports.owned.find(card=>card.gameId===late.gameId);
  assert.equal(atCap.ownedLevel,7);assert.equal(atCap.level,50);assert.equal(atCap.uncap,2);
  assert.equal(atCap.statContribution.vocal,500);
  assert.equal(primary.supportLevelAssumption.mode,'uncapMax');
  assert.deepEqual(primary.supportLevelAssumption.upgrades.find(x=>x.gameId===late.gameId)?.targetLevel,50);
  assert.ok(!primary.supports.owned.some(card=>card.gameId===fixed.gameId));
  const current=recommend({catalog:c,inventory,options:{...options,supportLevelMode:'current'}});
  assert.ok(!current.supports.owned.some(card=>card.gameId===late.gameId));
  assert.deepEqual(inventory,original);
});

test('HIF upgrade deltas use modeled capped totals rather than individual card indices', () => {
  const c = mixedCatalog();
  const late = c.supportCards.find(card => card.gameId === 'da-4');
  late.levelAbilities.push({ level: 40, order: 1, kind: 'initial_stat', activationLimit: 1,
    effects: [effect(5000, 'ProduceEffectType_DanceAddition')] });
  const inventory = { supportCards: c.supportCards.slice(0, 10).map(card => ({ gameId: card.gameId, level: card === late ? 1 : 40, uncap: 0 })) };
  const result = recommend({ inventory, catalog: c, options: { ...mixedOptions, rentalGameId: 'rent-da', compareSupportUpgrades: true } });
  const comparison = result.supportUpgradeComparison;
  assert.equal(comparison.available, true);
  assert.equal(comparison.statBasis, 'hif_capped_stats');
  assert.ok(comparison.upgrades.some(card => card.gameId === 'da-4' && card.targetLevel === 40));
  for (const axis of ['vocal', 'dance', 'visual']) {
    assert.equal(comparison.statDelta[axis], result.scoreSummary.hifModel.cappedStats[axis] - comparison.currentStats[axis]);
  }
  assert.ok(comparison.scoreSummary.hifModel.cappedStats.dance <= comparison.scoreSummary.hifModel.statCaps.dance);
});

test('HIF default compares mixed decks with an explicit secondary axis and preserves five owned plus one rental', () => {
  const c = mixedCatalog(), inventory = { complete: true, supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)) };
  const result = recommend({ inventory, catalog: c, options: mixedOptions });
  assert.equal(result.supports.owned.length, 5);
  assert.ok(result.supports.rental);
  const counts = result.supports.attributeCounts;
  assert.ok(counts.dance === 3 || counts.dance === 4);
  assert.equal(counts.visual, 6 - counts.dance);
  assert.equal(counts.vocal, 0);
  assert.equal(result.scoreSummary.method, 'hif_capped_stat_candidate_search');
  assert.equal(result.status, 'partial');
  assert.equal(result.scoreSummary.hifModel.search.globalOptimalityProven, false);
  assert.ok(result.scoreSummary.routeClassGains.vocal > 0);
});

test('HIF exposes all searched primary axes and its equal-stat objective without claiming to model exam scores', () => {
  const c = mixedCatalog();
  c.supportCards.push(...Array.from({ length: 5 }, (_, i) => axisSupport('vo-' + i, 'vocal', 80 - i, i === 0 ? 210 : 0)));
  const inventory = { supportCards: c.supportCards.map(card => owned(card.gameId)) };
  const automatic = recommend({ inventory, catalog: c, options: { scenario: 'hif', plan: 'sense' } }).scoreSummary;
  const model = automatic.hifModel;
  assert.deepEqual(model.attributeComparison.map(row => row.primaryAttribute), ['vocal', 'dance', 'visual']);
  assert.deepEqual(automatic.axisWeights, { vocal: 1, dance: 1, visual: 1 });
  assert.equal(model.autoSelectionBasis, 'equal_weight_capped_stat_sum');
  assert.equal(model.examScoreConsidered, false);
  assert.equal(model.examAllocationAssumedEqual, true);
  assert.equal(model.attributeComparison.filter(row => row.selected).length, 1);
  const selected = model.attributeComparison.find(row => row.selected);
  assert.equal(selected.primaryAttribute, model.primaryAttribute);
  assert.equal(selected.modeledStatTotal, model.modeledStatTotal);
  assert.deepEqual(selected.cappedStats, model.cappedStats);
  for (const row of model.attributeComparison) {
    assert.equal(row.modeledStatTotal, row.cappedStats.vocal + row.cappedStats.dance + row.cappedStats.visual);
    assert.ok(row.stageResults.length > 0);
  }
  const forced = recommend({ inventory, catalog: c, options: { ...mixedOptions, hifExamRatios: [{ dance: 1 }] } }).scoreSummary.hifModel;
  assert.deepEqual(forced.attributeComparison.map(row => row.primaryAttribute), ['dance']);
  assert.equal(forced.attributeComparison[0].selected, true);
  assert.equal(forced.examAllocationAssumedEqual, false);
});

test('HIF explicit 3-3 and 4-2 templates constrain the combined owned/rental deck', () => {
  const c = mixedCatalog(), inventory = { supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)) };
  for (const [deckTemplate, count] of [['3-3', 3], ['4-2', 4]]) {
    const result = recommend({ inventory, catalog: c, options: { ...mixedOptions, deckTemplate } });
    assert.equal(result.supports.attributeCounts.dance, count);
    assert.equal(result.supports.attributeCounts.visual, 6 - count);
    const all = [...result.supports.owned, result.supports.rental];
    assert.equal(new Set(all.map(card => card.gameId)).size, 6);
    assert.ok(result.supports.owned.every(card => inventory.supportCards.some(row => row.gameId === card.gameId)));
  }
});

test('mixed HIF shortage stays incomplete rather than silently filling the deck with six primary cards', () => {
  const c = mixedCatalog();
  const inventory = { supportCards: c.supportCards.slice(0, 5).map(card => owned(card.gameId)) };
  const result = recommend({ inventory, catalog: c, options: mixedOptions });
  assert.ok(result.supports.owned.length < 5);
  assert.ok(result.supports.attributeCounts.dance <= 4);
  assert.ok(result.supports.attributeCounts.visual <= 1);
  assert.equal(result.status, 'partial');
  assert.ok(result.warnings.some(row => row.includes('빈칸')));
});

test('single-axis HIF is opt-in and capped primary stats change the selected mixed template', () => {
  const c = mixedCatalog(), inventory = { supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)) };
  const capped = recommend({ inventory, catalog: c, options: { ...mixedOptions,
    initialStats: { vocal: 0, dance: 1500, visual: 0 }, statCaps: { vocal: 3000, dance: 1500, visual: 3000 }, selectionStatCaps: { vocal: 3000, dance: 1500, visual: 3000 } } });
  assert.equal(capped.supports.deckTemplate, '3-3');
  assert.equal(capped.scoreSummary.hifModel.cappedStats.dance, 1500);
  assert.ok(capped.scoreSummary.hifModel.discardedStats.dance > 0);
  const singleOnly = catalog(Array.from({ length: 7 }, (_, i) => axisSupport('only-' + i, 'dance', 100 + i)));
  const singleInventory = { supportCards: singleOnly.supportCards.slice(0, 6).map(card => owned(card.gameId)) };
  const blocked = recommend({ inventory: singleInventory, catalog: singleOnly, options: mixedOptions });
  assert.ok(blocked.supports.owned.length < 5);
  const explicit = recommend({ inventory: singleInventory, catalog: singleOnly, options: { ...mixedOptions, allowSingleAttribute: true } });
  assert.equal(explicit.supports.attributeCounts.dance, 6);
  assert.equal(explicit.supports.deckTemplate, 'single_explicit');
});

test('recommendation uses the shared current growth helper including exact True End bonuses', () => {
  const c = mixedCatalog();
  c.idolCards = [{ gameId: 'idol', characterId: 'test', plan: 'sense', baseStats: { baseVoDaVi: { vo: 80, da: 100, vi: 90 }, growthRatePermil: { vo: 140, da: 160, vi: 180 } },
    awakeningStages: [{ rank: 1, growthRatePermilDelta: { vo: 0, da: 0, vi: 0 } }, { rank: 2, growthRatePermilDelta: { vo: 0, da: 0, vi: 0 } }],
    characterBonuses: { characterId: 'test', trueEndBonuses: [{ scenarioEnum: 'ProduceType_FirstStar', growthRatePermilDelta: { vo: 40, da: 40, vi: 0 } }, { scenarioEnum: 'ProduceType_NextIdolAudition', growthRatePermilDelta: { vo: 0, da: 0, vi: 0 } }] } }];
  const inventory = { idolCards: [{ idolCardId: 'idol', potentialRank: 2, levelLimitRank: 0, characterGrowth: { characterId: 'test', trueEndProduceTypes: [1, 2] } }], supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)) };
  const result = recommend({ inventory, catalog: c, options: { ...mixedOptions, idolGameId: 'idol' } });
  assert.deepEqual(result.selectedIdol.currentGrowthRatePermil, { vo: 180, da: 200, vi: 180 });
  assert.deepEqual(result.farmingIdols[0].currentGrowthRatePermil, result.selectedIdol.currentGrowthRatePermil);
  assert.equal(result.selectedIdol.growthStatus, 'current_card');
});

test('HIF numeric model uses actual memory carry-in effects and never its completed stats', () => {
  const c = mixedCatalog();
  c.memoryAbilities = [
    { id: 'initial', gameId: 'initial', level: 1, produceSkillId: 'start-stat', restrictions: { plan: 'free' }, activationCountRaw: 1,
      branches: [{ produceEffectId: 'initial-effect', produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }] },
    { id: 'growth', gameId: 'growth', level: 1, produceSkillId: 'start-growth', restrictions: { plan: 'free' }, activationCountRaw: 1,
      branches: [{ produceEffectId: 'growth-effect', produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }] },
  ];
  c.memoryMechanicsGraph = { ProduceEffect: [
    { id: 'initial-effect', produceEffectType: 'ProduceEffectType_DanceAddition', effectValueMin: 30, effectValueMax: 30 },
    { id: 'growth-effect', produceEffectType: 'ProduceEffectType_VisualGrowthRateAddition', effectValueMin: 20, effectValueMax: 20 },
  ], ProduceTrigger: [] };
  const inventory = { producerLevel: 80, supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)),
    memories: [{ id: 'memory', vocal: 999999, dance: 999999, visual: 999999, abilities: [{ id: 'initial', level: 1 }, { id: 'growth', level: 1 }] }] };
  const result = recommend({ inventory, catalog: c, options: mixedOptions });
  assert.equal(result.memories.length, 1);
  assert.deepEqual(result.scoreSummary.hifModel.memoryInitialStats, { vocal: 0, dance: 30, visual: 0 });
  assert.deepEqual(result.scoreSummary.hifModel.memoryGrowthRatePermil, { vocal: 0, dance: 0, visual: 20 });
  assert.equal(result.scoreSummary.hifModel.initialStats.dance, 30);
  assert.ok(result.scoreSummary.hifModel.modeledStatTotal < 10000);
  assert.equal(result.memories[0].unscoredEffects, 0);
});

test('known HIF panels apply common initial stats once and final-only growth only in final', () => {
  const c = mixedCatalog(), z = { vo: 0, da: 0, vi: 0 };
  const inventory = { supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)),
    hifBonuses: { status: 'current_account', selection: { initialStats: { vo: 10, da: 20, vi: 30 }, growthRatePermil: z, statCaps: { vo: 3000, da: 3000, vi: 3000 }, spRatePermil: 50 },
      finalOnly: { initialStats: { vo: 0, da: 5, vi: 0 } }, final: { growthRatePermil: { vo: 0, da: 500, vi: 0 }, statCaps: { vo: 3200, da: 3200, vi: 3200 } } } };
  const result = recommend({ inventory, catalog: c, options: mixedOptions });
  const model = result.scoreSummary.hifModel;
  assert.deepEqual(model.initialStats, { vocal: 10, dance: 20, visual: 30 });
  assert.equal(model.panelStatus, 'current_account');
  assert.equal(model.statCapsVerified, true);
  assert.equal(model.stageResults[0].totalGrowthRatePermil.dance, 0);
  assert.equal(model.stageResults[1].totalGrowthRatePermil.dance, 500);
  assert.equal(model.stageResults[0].statCaps.dance, 3000);
  assert.equal(model.stageResults[1].statCaps.dance, 3200);
});

test('required HIF memory and carried skill targets precede larger unrelated stat memories', () => {
  const c = mixedCatalog();
  c.skillCards = [{ gameId: 'carry75', upgradeCount: 0, name: 'carry75', plan: 'sense', unlockProducerLevel: 75,
    rentalUnlockProducerLevel: 71, noDeckDuplication: true, recommendationEligible: true, actions: '', effects: '' }];
  c.memoryAbilities = [
    { id: 'required', gameId: 'required', level: 1, produceSkillId: 'hif-required', restrictions: { plan: 'free', explicitGroupScenarios: ['hif'] }, activationCountRaw: 1,
      branches: [{ produceEffectId: 'required-effect', produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }] },
    { id: 'big', gameId: 'big', level: 1, produceSkillId: 'big-stat', restrictions: { plan: 'free' }, activationCountRaw: 1,
      branches: [{ produceEffectId: 'big-effect', produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }] },
  ];
  c.memoryMechanicsGraph = { ProduceEffect: [
    { id: 'required-effect', produceEffectType: 'ProduceEffectType_DanceAddition', effectValueMin: 1, effectValueMax: 1 },
    { id: 'big-effect', produceEffectType: 'ProduceEffectType_VisualAddition', effectValueMin: 500, effectValueMax: 500 },
  ], ProduceTrigger: [] };
  const inventory = { producerLevel: 71, supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)), memories: [
    { id: 'must-skill', produceCard: { id: 'carry75', upgradeCount: 0 }, produceCardPhaseType: 2, abilities: [] },
    { id: 'must-hif', abilities: [{ id: 'required', level: 1 }] },
    ...Array.from({ length: 5 }, (_, i) => ({ id: 'stat-' + i, abilities: [{ id: 'big', level: 1 }] })),
  ] };
  const result = recommend({ inventory, catalog: c, options: { ...mixedOptions, desiredSkillIds: ['carry75'], requiredHifEffectIds: ['required-effect'] } });
  assert.ok(result.memories.some(memory => memory.id === 'must-skill'));
  assert.ok(result.memories.some(memory => memory.id === 'must-hif'));
  assert.equal(result.memories.length, 4);
  assert.deepEqual(result.scoreSummary.hifModel.memoryRequirements.missing, []);
  const carry = result.memories.find(memory => memory.id === 'must-skill').modelEffects.carriedSkill;
  assert.equal(carry.obtainable, true);
  assert.equal(carry.phase.availableAtStart, false);
  assert.equal(carry.normalUnlockProducerLevel, 75);
  assert.equal(carry.requiredProducerLevel, 71);
  const missing = recommend({ inventory, catalog: c, options: { ...mixedOptions, requiredHifEffectIds: ['not-owned'] } });
  assert.deepEqual(missing.scoreSummary.hifModel.memoryRequirements.missing, ['hif:not-owned']);
  assert.ok(missing.warnings.some(warning => warning.includes('필수 메모리')));
});

test('all scenarios use the shared zero-sentinel initial and growth memory interpretation', () => {
  const c = mixedCatalog();
  c.memoryAbilities = [{ id: 'bonus', gameId: 'bonus', level: 1, produceSkillId: 'bonus', restrictions: { plan: 'free' }, activationCountRaw: 1,
    branches: [{ produceEffectId: 'effect', produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }] }];
  c.memoryMechanicsGraph = { ProduceEffect: [{ id: 'effect', produceEffectType: 'ProduceEffectType_VocalAddition', effectValueMin: 30, effectValueMax: 30 }], ProduceTrigger: [] };
  const inventory = { memories: [{ id: 'memory', abilities: [{ id: 'bonus', level: 1 }], vocal: 999999 }] };
  for (const scenario of ['hajime', 'nia', 'hif']) {
    const result = recommend({ inventory, catalog: c, options: { ...mixedOptions, scenario } });
    assert.equal(result.memories.length, 1);
    assert.equal(result.memories[0].statContribution.vocal, 30);
    assert.equal(result.memories[0].modelEffects.initialStats.vo, 30);
  }
});

test('guide role matching requires exact acquisition phase, selected grow effect and effective cost', () => {
  const row = { id: 'memory', skillCard: { costType: 'ExamCostType_ExamParameterBuff', costValue: 1 },
    modelEffects: { carriedSkill: { id: 'skill', obtainable: true, upgrade: 1, phase: { code: 1 }, customizes: [
      { exactCountKnown: true, customizeCount: 2, growEffects: [{ effectType: 'ProduceCardGrowEffectType_ParameterBuffTurnAdd', value: 4 }, { effectType: 'ProduceCardGrowEffectType_CostParameterBuffReduce', value: 1 }] },
    ] } } };
  const role = { gameId: 'skill', requiredAcquisitionPhaseForEarlyRole: 1, preferredUpgrade: 1,
    customizationCriteria: { kind: 'grow_effect', nativeGrowEffectType: 'ProduceCardGrowEffectType_ParameterBuffTurnAdd', guideCustomizationCount: 2 } };
  assert.equal(evaluateHifGuideRole(role, row).status, 'fulfilled');
  const late = structuredClone(row); late.modelEffects.carriedSkill.phase.code = 2;
  assert.equal(evaluateHifGuideRole(role, late).status, 'missing');
  const wrong = structuredClone(row); wrong.modelEffects.carriedSkill.customizes[0].growEffects.shift();
  assert.equal(evaluateHifGuideRole(role, wrong).status, 'missing');
  const costRole = { gameId: 'skill', customizationCriteria: { kind: 'effective_cost', nativeGrowEffectType: 'ProduceCardGrowEffectType_CostParameterBuffReduce', maximum: 0 } };
  assert.equal(evaluateHifGuideRole(costRole, row).status, 'fulfilled');
  delete row.skillCard.costValue;
  assert.equal(evaluateHifGuideRole(costRole, row).status, 'unknown');
  row.modelEffects.carriedSkill.obtainable = null;
  assert.equal(evaluateHifGuideRole({ gameId: 'skill' }, row).status, 'unknown');
});

test('guide role matching preserves incomplete customization recipes and actual deck conditions as unknown', () => {
  const row = { id: 'memory', modelEffects: { carriedSkill: { id: 'skill', obtainable: true, customizes: [
    { exactCountKnown: true, customizeCount: 1, growEffects: [{ effectType: 'grow', value: 1 }] },
  ] } } };
  assert.equal(evaluateHifGuideRole({ gameId: 'skill', customizationCriteria: { kind: 'grow_effect', nativeGrowEffectType: 'grow', minimumValue: 1,
    note: '나머지 조합은 완성 템플릿으로 확정하지 않음.' } }, row).status, 'unknown');
  assert.equal(evaluateHifGuideRole({ gameId: 'skill', deckCondition: '졸음 2장 유지' }, row).status, 'unknown');
});

test('guide conflicts retain carry-space conflicts and uncertain removal or customization anti-synergies', () => {
  const a = { modelEffects: { carriedSkill: { id: 'a', customizes: [{ exactCountKnown: true, growEffects: [{ effectType: 'reduce' }] }] }, hifEffects: [
    { applies: true, actions: [{ kind: 'remove_cards', search: { cards: [{ id: 'trouble' }] } }] },
  ] } }, b = { modelEffects: { carriedSkill: { id: 'b' } } };
  const profile = { incompatibleCarryPairs: [{ cards: [{ gameId: 'a' }, { gameId: 'b' }], reason: '보류 공간 경쟁' }],
    antiSynergies: [{ kind: 'remove_cards', target: { gameId: 'trouble' }, condition: '졸음 유지', decision: '실제 수량 확인' },
      { kind: 'customization', target: { gameId: 'a' }, nativeGrowEffectType: 'reduce', condition: '조건부 루프', decision: '비용 감소 주의' }] };
  assert.deepEqual(hifGuideConflicts(profile, [a, b]).map(conflict => conflict.status), ['conflict', 'unknown', 'unknown']);
});

test('automatic guide roles precede unrelated stats, while manual targets override and missing PLv stays unknown', () => {
  const c = mixedCatalog();
  c.idolCards = [{ gameId: 'idol', plan: 'sense', recommendedEffect: 'goodConditionTurns' }];
  c.skillCards = ['core', 'manual', 'stat'].map(gameId => ({ gameId, upgradeCount: 0, name: gameId, plan: 'sense',
    rentalUnlockProducerLevel: 20, unlockProducerLevel: 20, recommendationEligible: true, noDeckDuplication: gameId !== 'stat' }));
  c.memoryAbilities = [{ id: 'big-stat', gameId: 'big-stat', level: 1, produceSkillId: 'stat', restrictions: { plan: 'free' }, activationCountRaw: 1,
    branches: [{ produceEffectId: 'stat-effect', produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }] }];
  c.memoryMechanicsGraph = { ProduceEffect: [{ id: 'stat-effect', produceEffectType: 'ProduceEffectType_VisualAddition', effectValueMin: 300, effectValueMax: 300 }], ProduceTrigger: [] };
  c.hifMemoryRoles = { sources: [{ id: 'source', url: 'https://example.test/guide', published: '2026-07-01' }], profiles: [
    { id: 'good', plan: 'sense', trainingType: 'good_condition', trainingTypeAliases: ['goodConditionTurns'], labelKo: '호조축', status: 'conditional_guide_profile',
      sourceIds: ['source'], conditions: ['일반 HIF 사례'], carryRoles: [{ gameId: 'core', nameKo: '핵심', requiredAcquisitionPhaseForEarlyRole: 1 }], firstSelectionWithoutHifAbilities: '초회 준비 안내' },
  ] };
  const inventory = { producerLevel: 70, idolCards: [{ idolCardId: 'idol' }],
    supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)), memories: [
      { id: 'core', produceCard: { id: 'core', upgradeCount: 0 }, produceCardPhaseType: 1, abilities: [] },
      { id: 'duplicate-core', produceCard: { id: 'core', upgradeCount: 0 }, produceCardPhaseType: 1, abilities: [] },
      { id: 'manual', produceCard: { id: 'manual', upgradeCount: 0 }, produceCardPhaseType: 1, abilities: [] },
      ...Array.from({ length: 5 }, (_, i) => ({ id: 'stat-' + i, produceCard: { id: 'stat', upgradeCount: 0 }, produceCardPhaseType: 1, abilities: [{ id: 'big-stat', level: 1 }] })),
    ] };
  const result = recommend({ inventory, catalog: c, options: { ...mixedOptions, idolGameId: 'idol' } });
  const profile = result.scoreSummary.hifModel.guideMemoryProfile;
  assert.equal(result.scoreSummary.trainingType, 'goodConditionTurns');
  assert.equal(profile.applied, true);
  assert.equal(profile.roles[0].status, 'fulfilled');
  assert.equal(profile.sources[0].published, '2026-07-01');
  assert.equal(profile.readinessConfirmed, false);
  assert.equal(result.memories.filter(memory => memory.modelEffects.carriedSkill?.id === 'core').length, 1);
  const noProfile = recommend({ inventory, catalog: { ...c, hifMemoryRoles: null }, options: { ...mixedOptions, idolGameId: 'idol' } });
  assert.equal(new Set(noProfile.memories.map(memory => memory.modelEffects.carriedSkill?.id)).size, noProfile.memories.length);
  const manual = recommend({ inventory, catalog: c, options: { ...mixedOptions, idolGameId: 'idol', desiredSkillIds: ['manual'] } });
  assert.equal(manual.scoreSummary.hifModel.guideMemoryProfile.applied, false);
  assert.equal(manual.scoreSummary.hifModel.guideMemoryProfile.applicationMode, 'manual_targets_override');
  assert.ok(manual.memories.some(memory => memory.id === 'manual'));
  assert.equal(new Set(manual.memories.map(memory => memory.modelEffects.carriedSkill?.id)).size, manual.memories.length);
  const unknown = recommend({ inventory: { ...inventory, producerLevel: null }, catalog: c, options: { ...mixedOptions, idolGameId: 'idol' } });
  assert.equal(unknown.scoreSummary.hifModel.guideMemoryProfile.applied, false);
  assert.equal(unknown.scoreSummary.hifModel.guideMemoryProfile.considered, true);
  assert.equal(unknown.scoreSummary.hifModel.guideMemoryProfile.tentative, true);
  assert.equal(unknown.scoreSummary.hifModel.guideMemoryProfile.roles[0].status, 'unknown');
  assert.equal(unknown.memories.filter(memory => memory.modelEffects.carriedSkill?.id === 'core').length, 1);
  c.idolCards[0].recommendedEffectConflict = true;
  const conflict = recommend({ inventory, catalog: c, options: { ...mixedOptions, idolGameId: 'idol' } });
  assert.equal(conflict.scoreSummary.trainingType, null);
  assert.equal(conflict.scoreSummary.hifModel.guideMemoryProfile, null);
});

test('required different skill memories may share a unique HIF ability; its fixed effect activates once', () => {
  const c = mixedCatalog();
  c.skillCards = ['a', 'b'].map(gameId => ({ gameId, upgradeCount: 0, name: gameId, plan: 'sense',
    rentalUnlockProducerLevel: 20, unlockProducerLevel: 20, recommendationEligible: true, noDeckDuplication: true }));
  c.memoryAbilities = [{ id: 'shared', gameId: 'shared', level: 1, produceSkillId: 'same-hif', isUniqueActivation: true,
    restrictions: { explicitGroupScenarios: ['hif'] }, activationCountRaw: 1,
    branches: [{ produceEffectId: 'shared-effect', produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }] }];
  c.memoryMechanicsGraph = { ProduceEffect: [{ id: 'shared-effect', produceEffectType: 'ProduceEffectType_DanceAddition', effectValueMin: 30, effectValueMax: 30 }], ProduceTrigger: [] };
  const inventory = { producerLevel: 70, supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)),
    memories: ['a', 'b'].map(id => ({ id, produceCard: { id, upgradeCount: 0 }, produceCardPhaseType: 1, abilities: [{ id: 'shared', level: 1 }] })) };
  const result = recommend({ inventory, catalog: c, options: { ...mixedOptions, desiredSkillIds: ['a', 'b'] } });
  assert.deepEqual(result.scoreSummary.hifModel.memoryRequirements.missing, []);
  assert.deepEqual(result.memories.map(memory => memory.id).sort(), ['a', 'b']);
  assert.equal(result.scoreSummary.hifModel.memoryInitialStats.dance, 30);
});

function openingRoleFixture() {
  const c = mixedCatalog();
  c.skillCards = [
    ['potential','genki+=15; fullPowerCharge+=4'],
    ['opening-attack','score+=20'],
    ['opening-draw','cardUsesRemaining+=1; drawCard(2)'],
    ['strengthen','target:hand { g.score+=8 }; cardUsesRemaining+=1'],
    ['late-attack','score+=999'],
    ['late-draw','cardUsesRemaining+=2; drawCard(3)'],
  ].map(([gameId,actions]) => ({gameId,name:gameId,upgradeCount:0,plan:'sense',actions,
    unlockProducerLevel:1,rentalUnlockProducerLevel:1,recommendationEligible:true,noDeckDuplication:false}));
  c.memoryAbilities = [{id:'big',gameId:'big',level:1,produceSkillId:'big',restrictions:{plan:'free'},activationCountRaw:1,
    branches:[{produceEffectId:'big-effect',produceTriggerId:'start',phaseType:'ProducePhaseType_ProduceStart',activationRatePermilRaw:0}]}];
  c.memoryMechanicsGraph = {ProduceEffect:[{id:'big-effect',produceEffectType:'ProduceEffectType_DanceAddition',effectValueMin:500,effectValueMax:500}],ProduceTrigger:[]};
  const carry = (id,skill,phase,big=false) => ({id,produceCard:{id:skill,upgradeCount:0},produceCardPhaseType:phase,abilities:big?[{id:'big',level:1}]:[]});
  const inventory = {producerLevel:70,supportCards:c.supportCards.slice(0,10).map(card=>owned(card.gameId)),memories:[
    ...[1,2,3].map(n=>carry('potential-'+n,'potential',2,true)),
    carry('early-attack','opening-attack',1),carry('early-draw','opening-draw',1),
    carry('strengthen','strengthen',2),carry('late-attack','late-attack',2,true),carry('late-draw','late-draw',2,true),
  ]};
  return {c,inventory,carry};
}

test('automatic HIF selects distinct carried skills and opening attack/draw/action before late stat bonuses', () => {
  const {c,inventory}=openingRoleFixture();
  const result=recommend({catalog:c,inventory,options:{...mixedOptions,memorySelectionMode:'opening'}});
  assert.equal(result.memories.length,4);
  assert.equal(new Set(result.memories.map(memory=>memory.modelEffects.carriedSkill.id)).size,4);
  assert.ok(result.memories.some(memory=>memory.id==='early-attack'));
  assert.ok(result.memories.some(memory=>memory.id==='early-draw'));
  assert.ok(result.memories.filter(memory=>memory.modelEffects.carriedSkill.id==='potential').length<=1);
  const preparation=result.scoreSummary.hifModel.memoryPreparation;
  assert.deepEqual(preparation.missingRoles,[]);
  assert.equal(preparation.readinessConfirmed,false);
  assert.equal(preparation.duplicatePolicy,'distinct_exact_carried_skill_ids');
});

test('unknown acquisition phase and card-strengthening text cannot certify an opening attack', () => {
  const {c,inventory,carry}=openingRoleFixture();
  inventory.memories=[carry('unknown-attack','late-attack',0,true),carry('buff','strengthen',1,true),carry('known-attack','opening-attack',1)];
  const result=recommend({catalog:c,inventory,options:mixedOptions});
  const preparation=result.scoreSummary.hifModel.memoryPreparation;
  assert.deepEqual(preparation.openingAttackMemoryIds,['known-attack']);
  assert.ok(preparation.unknownMemoryIds.includes('unknown-attack'));
  assert.ok(result.memories.find(memory=>memory.id==='buff').battleRoleProfile.roles.includes('strengthen'));
  assert.ok(!result.memories.find(memory=>memory.id==='buff').battleRoleProfile.roles.includes('attack'));
});

test('late-only memories report the missing first-selection roles instead of certifying readiness', () => {
  const {c,inventory}=openingRoleFixture();
  inventory.memories=inventory.memories.filter(memory=>memory.produceCardPhaseType===2);
  const result=recommend({catalog:c,inventory,options:mixedOptions});
  assert.deepEqual(result.scoreSummary.hifModel.memoryPreparation.missingRoles,['attack','draw','extra_action']);
  assert.equal(result.scoreSummary.hifModel.memoryPreparation.readinessConfirmed,false);
  assert.ok(result.warnings.some(warning=>warning.includes('첫 선발시험')));
  assert.equal(new Set(result.memories.map(memory=>memory.modelEffects.carriedSkill.id)).size,result.memories.length);
});

test('duplicate carried skills require an explicit skill-specific opt-in, not a desired skill target', () => {
  const {c,inventory}=openingRoleFixture();
  inventory.memories=inventory.memories.filter(memory=>memory.produceCard.id==='potential');
  const run=extra=>recommend({catalog:c,inventory,options:{...mixedOptions,desiredSkillIds:['potential'],...extra}});
  assert.equal(run({}).memories.length,1);
  const intentional=run({allowDuplicateMemorySkillIds:['potential']});
  assert.equal(intentional.memories.length,3);
  assert.deepEqual(intentional.scoreSummary.hifModel.memoryPreparation.duplicateExceptions,['potential']);
});

test('opening role metadata retains conditional attacks and delayed draws without certifying them', () => {
  const {c,inventory}=openingRoleFixture();
  c.skillCards.find(card=>card.gameId==='opening-attack').actions='if:isFullPower { score+=20 }; at:turn { drawCard }';
  const result=recommend({catalog:c,inventory,options:{...mixedOptions,memorySelectionMode:'opening'}});
  const roles=result.memories.find(memory=>memory.id==='early-attack').battleRoleProfile;
  assert.ok(roles.activationConditions.includes('isFullPower'));
  assert.equal(roles.hasDelayedEffects,true);
  assert.equal(roles.conditionsVerified,false);
  assert.equal(result.scoreSummary.hifModel.memoryPreparation.readinessConfirmed,false);
});

test('guide mode is the default and opening/stats are separate comparison seeds', () => {
  const {c,inventory}=openingRoleFixture();
  c.hifMemoryRoles={sources:[],profiles:[{id:'source-guide',plan:'sense',trainingType:'concentration',status:'conditional_guide_profile',
    carryRoles:[{gameId:'opening-attack',nameKo:'source core',requiredAcquisitionPhaseForEarlyRole:1}],sourceIds:[]}]};
  const run=mode=>recommend({catalog:c,inventory,options:{...mixedOptions,trainingType:'concentration',...(mode?{memorySelectionMode:mode}:{})}});
  const guide=run(),opening=run('opening'),stats=run('stats');
  assert.equal(guide.scoreSummary.hifModel.memorySelectionMode,'guide');
  assert.ok(guide.memories.some(memory=>memory.id==='early-attack'));
  assert.ok(!guide.memories.some(memory=>memory.id==='early-draw')); // Opening utility is not a compulsory default objective.
  assert.ok(opening.memories.some(memory=>memory.id==='early-draw'));
  // A zero-bonus fourth slot can tie after stat caps; its identity is not a
  // numeric objective. Stats mode must keep the numeric optimum without making
  // the source role compulsory, rather than depend on an incidental UUID tie.
  assert.ok(stats.scoreSummary.hifModel.modeledStatTotal>=guide.scoreSummary.hifModel.modeledStatTotal);
  assert.equal(stats.scoreSummary.hifModel.memorySelectionMethod,'carry_stats_comparison_seed');
  assert.equal(stats.scoreSummary.hifModel.guideMemoryProfile.applied,false);
  assert.equal(opening.scoreSummary.hifModel.memoryPreparation.readinessConfirmed,false);
  assert.throws(()=>run('invented'),/memorySelectionMode/);
});

test('an explicit training archetype must match the exact owned idol plan', () => {
  const c = mixedCatalog();
  c.idolCards = ['sense', 'logic', 'anomaly'].map((plan, index) => ({ gameId: 'idol-' + plan, plan, recommendationEligible: true,
    baseStats: { baseVoDaVi: { vo: 50, da: 50, vi: 50 }, growthRatePermil: { vo: 100 + index, da: 100, vi: 100 } }, awakeningStages: [], specialTrainingStages: [] }));
  const inventory = { producerLevel: 70, idolCards: c.idolCards.map(card => ({ gameId: card.gameId, levelLimitRank: 0, potentialRank: 0,
    currentGrowthRatePermil: { vo: 100, da: 100, vi: 100 } })), supportCards: c.supportCards.slice(0, 10).map(card => owned(card.gameId)) };
  const run = (plan, trainingType) => recommend({ catalog: c, inventory, options: { ...mixedOptions, idolGameId: 'idol-' + plan, trainingType } });
  assert.throws(() => run('sense', 'motivation'), /센스.*집중·호조/);
  assert.throws(() => run('logic', 'concentration'), /로직.*의욕·호인상/);
  assert.throws(() => run('anomaly', 'goodConditionTurns'), /어노말리.*전력·강기·온존/);
  assert.throws(() => run('sense', 'unknown-type'), /확인되지 않은 육성 유형/);
  // The actual selected idol still overrides a contradictory form plan.
  assert.equal(run('logic', 'motivation').scoreSummary.plan, 'logic');
  assert.equal(run('sense', 'good_condition').scoreSummary.trainingType, 'good_condition');
});

test('an archetype-only automatic request restricts idol candidates to its plan before comparing growth', () => {
  const c = mixedCatalog();
  c.idolCards = [{ gameId: 'stronger-sense', plan: 'sense', recommendationEligible: true }, { gameId: 'requested-logic', plan: 'logic', recommendationEligible: true }];
  const inventory = { producerLevel: 70, idolCards: [{ gameId: 'stronger-sense', currentGrowthRatePermil: { vo: 999, da: 999, vi: 999 } },
    { gameId: 'requested-logic', currentGrowthRatePermil: { vo: 10, da: 10, vi: 10 } }] };
  const result = recommend({ catalog: c, inventory, options: { scenario: 'hif', trainingType: 'motivation', activityFocus: 'consult', targetAttribute: 'dance', secondaryAttribute: 'visual' } });
  assert.equal(result.selectedIdol.gameId, 'requested-logic');
  assert.equal(result.scoreSummary.plan, 'logic');
  assert.equal(result.scoreSummary.trainingType, 'motivation');
});

test('guide lookup normalizes both legacy profile type names and caller aliases', () => {
  for (const [legacy, canonical] of [['full_power', 'fullPower'], ['good_condition', 'goodConditionTurns'], ['good_impression', 'goodImpressionTurns'], ['enthusiasm', 'strength']]) {
    const profile = { id: legacy, plan: 'sense', trainingType: legacy, carryRoles: [] };
    const c = { hifMemoryRoles: { profiles: [profile] } };
    assert.equal(findHifMemoryProfile(c, { plan: 'sense', trainingType: canonical }), profile);
    profile.trainingType = canonical;
    assert.equal(findHifMemoryProfile(c, { plan: 'sense', trainingType: legacy }), profile);
  }
  const aliased = { id: 'alias-only', plan: 'sense', trainingType: 'legacy-other', trainingTypeAliases: ['goodCondition'] };
  assert.equal(findHifMemoryProfile({ hifMemoryRoles: { profiles: [aliased] } }, { plan: 'sense', trainingType: 'goodConditionTurns' }), aliased);
});
