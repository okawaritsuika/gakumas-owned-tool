import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCardTargetPlan, cardTargetPlanAtExam, cardTargetDescriptor, resolveCardTargets} from '../lib/hif-card-targets.mjs';
import {declaredProduceActionCounts} from '../lib/produce-action-counts.mjs';

const skill = (gameId,type,keywords,extra={}) => [0,1].map(upgradeCount => ({gameId,type,keywords,
  upgradeCount,sourceType:'default',rarity:'N',noDeckDuplication:false,...extra}));
const sample = [
  ...skill('a','active',['good_impression']), ...skill('m','mental',['motivation']),
  ...skill('simple','active',[]), ...skill('rare','mental',['good_impression'],{sourceType:'produce',rarity:'SSR'}),
  ...skill('u','mental',['good_impression'],{sourceType:'pIdol',noDeckDuplication:true}),
];
const week = (n,activity='consult',fromExamIndex=0,stage='selection') => ({week:n,activity,fromExamIndex,stage,
  ...(activity==='lesson'?{main:'dance'}:{})});
const op = (action,week,more={}) => ({id:action+'-'+week,action,week,stage:'selection',fromExamIndex:0,...more});
function fixture(start,ops=[],schedule=[week(1),week(2),week(3),week(4,'mid_exam')],extra={}) {
  const catalog = {skillCards:sample,produceInitialDecks:{idolProfiles:[{idolCardId:'i',uniqueCardIds:[],
    scenarioDeckIds:{'produce-007':'start'}}],decks:{start:{cardCount:start.length,cardSlots:start.map(value =>
      typeof value==='string'?{cardId:value,upgradeCount:0}:value)}}}, ...extra};
  const plan = buildCardTargetPlan(catalog,{selections:schedule},ops,{hifSelectedIdol:{gameId:'i'},plan:'sense',producerLevel:70});
  return {plan,catalog};
}

test('two physical unenhanced copies earn their own typed and keyword triggers; mutually exclusive targets do not stack', () => {
  const {plan} = fixture(['a','m',{cardId:'a',upgradeCount:1}]);
  const ops = [op('upgrade',1,{providerId:'card-1',sourceId:'story',quantity:3}),op('upgrade',2)];
  const result = resolveCardTargets(plan,ops,{weights:{a_skill_enhance:7,m_skill_enhance:8,good_impression_card_enhance:4},details:true});
  assert.equal(result.counts.skill_enhance,2);
  assert.deepEqual(result.actions.map(a=>[a.gameId,a.targetSlot]),[['a',0],['m',1]]);
  assert.equal(result.actions[0].providerId,'card-1');
  assert.deepEqual(result.actions[0].triggerCounts,{a_skill_enhance:1,good_impression_card_enhance:1,skill_enhance:1});
  assert.equal(result.counts.motivation_card_enhance,1);
  assert.equal(declaredProduceActionCounts(result.actions,{}).skill_enhance,2);
  assert.equal(plan.start[0].upgradeCount,0);
});

test('an eighth keyword copy counts on receipt; deletion and change remove old keywords without granting a new receipt', () => {
  const start = [...Array(7).fill('a'),'simple'];
  const ops = [op('acquire',1,{gameId:'rare',upgradeCount:1}),op('remove',2,{gameId:'a'}),
    op('acquire',2,{gameId:'simple'}),op('change',3,{gameId:'rare',resultGameId:'simple'}),op('acquire',3,{gameId:'a'})];
  const {plan} = fixture(start,ops);
  assert.equal(plan.baseline.counts.good_impression_card_acquire_8,1);
  assert.equal(plan.baseline.counts.skill_acquire,3);
  assert.equal(plan.baseline.counts.good_impression_card_delete,1);
  assert.equal(plan.baseline.counts.basic_card_change,0);
  const removed = plan.baseline.actions.find(a=>a.action==='remove');
  assert.equal(removed.type,'active'); assert.equal(removed.beforeDeckSize-removed.afterDeckSize,1);
});

test('support receipts can unlock lesson/exam deck sizes, then actual removal lowers a later threshold', () => {
  const rows=[week(1),week(2,'lesson'),week(3,'mid_exam'),week(4,'consult',1),week(5,'lesson',1),week(6,'final_exam',1)];
  const {plan}=fixture(Array(14).fill('a'),[op('remove',4,{gameId:'a',quantity:6,fromExamIndex:1})],rows);
  const added=[op('acquire',1,{quantity:6,providerId:'p',card:cardTargetDescriptor({skillCards:sample},'m',0)})];
  const result=resolveCardTargets(plan,added,{details:true});
  assert.deepEqual(result.examDeckSizes,[20,14]);
  assert.deepEqual(result.lessonDeckSizes,[20,14]);
  assert.equal(result.counts.sp_lesson_20,1); assert.equal(result.counts.exam_15,1);
  const beforeFirst=resolveCardTargets(cardTargetPlanAtExam(plan,0),added,{details:true});
  assert.deepEqual(beforeFirst.examDeckSizes,[]); assert.deepEqual(beforeFirst.lessonDeckSizes,[20]);
});

test('copy respects no-duplicate records and separates a physical extra copy from a sourced acquisition trigger', () => {
  const {plan}=fixture(['u','rare'],[op('copy',1,{gameId:'u'}),op('copy',2,{gameId:'rare'}),op('copy',3,{gameId:'rare',countsAsAcquisition:true})]);
  assert.equal(plan.baseline.finalDeckSize,4); assert.equal(plan.baseline.counts.copy,2);
  assert.equal(plan.baseline.counts.skill_acquire,1); assert.equal(plan.baseline.counts.ssr_card_acquire,1);
  assert.equal(plan.baseline.actions[0].triggerCounts.skill_acquire,undefined);
});

test('ambiguous acquisitions do not fabricate a keyword or typed target, and post-exam joins only help later operations', () => {
  const {plan}=fixture(Array(7).fill('a'),[op('acquire',1),op('remove',1,{target:'mental'}),
    op('acquire',2,{gameId:'m',venue:'memory',fromExamIndex:1}),op('remove',3,{target:'mental',fromExamIndex:1})],
    [week(1),week(2,'mid_exam'),week(3,'consult',1)]);
  assert.equal(plan.baseline.counts.good_impression_card_acquire_8,null);
  assert.equal(plan.baseline.counts.m_skill_delete,1);
  assert.ok(plan.baseline.unresolved.some(row=>row.week===1&&row.action==='remove'));
  const prefix=cardTargetPlanAtExam(plan,0).baseline;
  assert.equal(prefix.counts.m_skill_delete,null); assert.equal(prefix.finalDeckSize,8);
  assert.ok(prefix.unresolvedKinds.includes('m_skill_delete'));
});

test('native customization prices and remaining levels are checked independently for each held copy', () => {
  const custom={variants:{'rare:1':{max:2,ids:['upgrade-a','upgrade-b']}},prices:{'upgrade-a':[40,70],'upgrade-b':[100]}};
  const {plan}=fixture([{cardId:'rare',upgradeCount:1}],[op('customize',1,{maxPPCost:39}),
    op('customize',2,{maxPPCost:60}),op('customize',3,{customizationId:'upgrade-a',maxPPCost:70}),op('customize',3)],
    [week(1),week(2),week(3)],{produceResources:{hif:{cardCustomizations:custom}}});
  assert.deepEqual(plan.baseline.actions.map(a=>[a.customizationId,a.customizationLevel,a.ppCost]),[['upgrade-a',1,40],['upgrade-a',2,70]]);
  assert.equal(plan.baseline.counts.customize,2);
});

test('a support starter change cannot spend the last reserved native removal target', () => {
  const {plan}=fixture(['a','rare'],[op('remove',3,{sourceType:'default',venue:'exam_reward'})]);
  const trace=resolveCardTargets(plan,[op('change',1,{target:'starter',providerId:'story'})],{details:true});
  assert.equal(trace.counts.change,0); assert.equal(trace.counts.delete,1);
  assert.equal(trace.actions[0].gameId,'a');
});

test('an unverified mandatory deletion leaves a crossing exam size unknown', () => {
  const {plan}=fixture(Array(14).fill('a'),[op('acquire',1),op('remove',2,{target:'mental',required:true})]);
  assert.equal(plan.baseline.counts.delete,null);
  assert.equal(plan.baseline.counts.exam_15,null);
  assert.deepEqual(plan.baseline.examDeckSizes,[null]);
});

test('a fixed change result must be distinct and obey uniqueness even when a second target is available', () => {
  const {plan}=fixture(['a','m','u']);
  const result=resolveCardTargets(plan,[op('change',1,{resultGameId:'a',quantity:2}),op('change',2,{resultGameId:'u'})],{details:true});
  assert.equal(result.counts.change,1);
  assert.equal(result.actions[0].gameId,'m');
  assert.equal(result.actions[0].resultGameId,'a');
  assert.equal(result.counts.skill_acquire,0);
});

test('a selectable reward uses one verified eligible pool member and the resulting card stays in the deck', () => {
  const skillCards=[...sample,...skill('out-of-plan','active',[],{sourceType:'produce',rarity:'SSR',plan:'logic'}),
    ...skill('locked','active',[],{sourceType:'produce',rarity:'SSR',unlockProducerLevel:80})];
  const {plan}=fixture(['a'],[op('acquire',1,{selectableReward:true,rarity:'SSR',rewardGameIds:['out-of-plan','locked','rare']}),
    op('upgrade',2,{target:'mental'})],undefined,{skillCards});
  assert.equal(plan.baseline.actions[0].gameId,'rare');
  assert.equal(plan.baseline.counts.ssr_card_acquire,1);
  assert.equal(plan.baseline.counts.good_impression_card_enhance,1);
});

test('a newly affordable paid upgrade reprices the next visit and cannot spend the same PP twice', () => {
  const cost={basis:'conditional_retry_route_purchase',purchasePrices:[{min:100,max:100},{min:125,max:125}],routeBudgetPP:200,ppCost:100};
  const {plan}=fixture(['a'],[op('upgrade',2,{...cost,target:'mental'}),op('upgrade',3,{...cost,target:'active'})]);
  assert.deepEqual(plan.baseline.actions.map(a=>[a.week,a.ppCost,a.purchaseIndex]),[[3,100,1]]);
  const supported=resolveCardTargets(plan,[op('acquire',1,{gameId:'m',providerId:'story'})],{details:true});
  assert.equal(supported.counts.skill_enhance,1);
  assert.deepEqual(supported.actions.filter(a=>a.action==='upgrade').map(a=>[a.week,a.ppCost,a.purchaseIndex]),[[2,100,1]]);
  assert.ok(supported.unresolved.some(r=>r.week===3&&r.reason==='insufficient_pp'));
  const final=op('upgrade',5,{...cost,target:'active',stage:'final',fromExamIndex:3,routeBudgetPP:113,discountPermil:100});
  const withFinal=resolveCardTargets(plan,[op('acquire',1,{gameId:'m'}),final],{details:true});
  assert.equal(withFinal.actions.find(a=>a.stage==='final').ppCost,112);
});

test('native enum receipt types and an explicit per-trigger keyword count retain their declared meanings', () => {
  const {plan}=fixture(['a'],[op('acquire',1,{category:'ProduceCardCategory_MentalSkill',rarity:'ProduceCardRarity_Ssr',
    keywordCardCountsAtTrigger:{goodImpression:8}})]);
  assert.equal(plan.baseline.counts.m_skill_acquire,1);
  assert.equal(plan.baseline.counts.ssr_card_acquire,1);
  assert.equal(plan.baseline.counts.good_impression_card_acquire_8,1);
});

test('compact and detailed replays preserve known receipts across a later unknown card', () => {
  const {plan}=fixture(['a'],[op('acquire',1,{gameId:'rare'}),
    op('acquire',5,{fromExamIndex:3,stage:'final'}),op('acquire',6,{fromExamIndex:3,stage:'final',gameId:'m'})]);
  const weights={m_skill_acquire:2};
  const compact=resolveCardTargets(plan,[],{weights});
  const detailed=resolveCardTargets(plan,[],{weights,details:true});
  assert.deepEqual(compact.actions,[]);
  assert.equal(detailed.actions.length,3);
  for (const field of ['counts','byStage','unresolvedKinds','finalDeckSize','lessonDeckSizes','examDeckSizes'])
    assert.deepEqual(compact[field],detailed[field]);
  assert.equal(compact.byStage.selection.good_impression_card_acquire,1);
  assert.equal(compact.byStage.final.good_impression_card_acquire,null);
  assert.equal(compact.counts.good_impression_card_acquire,1);
  assert.equal(compact.byStage.final.m_skill_acquire,1);
  assert.equal(compact.counts.m_skill_acquire,2);
  assert.equal(detailed.actions[1].triggerCounts.m_skill_acquire,null);
});
