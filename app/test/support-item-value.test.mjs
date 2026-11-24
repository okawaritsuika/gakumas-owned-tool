import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { evaluateSupportItemValue, supportBattleItemReference } from '../lib/support-item-value.mjs';
import { calculateHifSupport } from '../lib/hif-model.mjs';

const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});
const teacher=catalog.supportCards.find(card=>card.gameId==='s_card-3-0099');
const change=(index,visual=400)=>({action:'change',fromExamIndex:index,week:index*7+1,parametersBefore:{visual}});
const acquired={confirmed:true,fromExamIndex:0,week:0};
const evaluate=(actions,acquisition=acquired,extra={})=>evaluateSupportItemValue({card:teacher,plan:'anomaly',level:40,catalog,
  options:{produceActions:actions,supportItemAcquisitions:{[teacher.gameId]:acquisition},...extra}});

test('0099 counts exact Vi400 changes with the produce-wide cap and nominal HP2',()=>{
  const actions=[change(1,399),change(1),change(2),change(3),change(4)];
  const before=JSON.stringify(actions),result=evaluate(actions);
  assert.equal(result.applied.activationCount,3);
  assert.equal(result.applied.stats.visual,75);
  assert.equal(result.applied.resources.hpRecovery,6);
  assert.equal(result.byStage.selection.stats.visual,50);
  assert.equal(result.byStage.final.stats.visual,25);
  assert.equal(result.recoveryIsNominal,true);
  assert.equal(JSON.stringify(actions),before);
});

test('unconfirmed acquisition has zero guaranteed grants and only a declared-opportunity bound',()=>{
  const result=evaluate([change(1),change(2),change(3)],{confirmed:false,fromExamIndex:0,week:0});
  assert.equal(result.applied.stats.visual,0);
  assert.equal(result.potential.early.stats.visual,75);
  assert.equal(result.potential.late.stats.visual,25);
  assert.deepEqual(result.potentialRanges.stats.visual,[0,75]);
  assert.equal(result.confirmed,false);
  assert.ok(result.limitations.some(text=>text.includes('획득')));
});

test('missing action-state thresholds and same-bucket acquisition order stay unknown',()=>{
  const noStats=evaluate([{action:'change',fromExamIndex:1,week:9}]);
  assert.equal(noStats.applied.stats.visual,0);
  assert.equal(noStats.potential.unknown.max.stats.visual,25);
  const same=evaluate([change(1)],{confirmed:true,fromExamIndex:1});
  assert.equal(same.applied.stats.visual,0);
  assert.equal(same.confirmed,false);
  const ordered=evaluate([{...change(1),week:12}],{confirmed:true,fromExamIndex:1,week:10});
  assert.equal(ordered.applied.stats.visual,25);
});

test('future acquisition and future actions cannot leak into an earlier exam',()=>{
  const actions=[change(0),change(3)];
  const first=evaluate(actions,acquired,{examIndex:0});
  assert.equal(first.applied.stats.visual,25);
  assert.equal(first.byStage.final.stats.visual,0);
  const future=evaluate(actions,{confirmed:true,fromExamIndex:3,week:21},{examIndex:0});
  assert.equal(future.applied.stats.visual,0);
  assert.equal(future.potential.unknown.max.stats.visual,0);
});

test('unknown earlier activations cannot guarantee unused cap capacity in the final stage',()=>{
  const result=evaluate([{action:'change',fromExamIndex:1,week:8,quantity:3},change(3)]);
  assert.equal(result.applied.activationCount,0);
  assert.equal(result.byStage.final.stats.visual,0);
  assert.equal(result.potential.unknown.max.activationCount,3);
});

test('consult P-item uses visit timing once, not every card purchased during that visit',()=>{
  const card={gameId:'consult',plan:'free',p_item:{name:'consult fixture',effect:{trigger:{key:'consult_selection'},body:[{key:'pp_gain',value:5},{key:'hp_recovery',value:1}]}}};
  const route={selections:[{week:7,activity:'mid_exam'},{week:12,activity:'consult'},{week:13,activity:'mid_exam'},{week:20,activity:'mid_exam'},{week:23,activity:'consult'}]};
  const options={supportItemAcquisitions:{consult:{confirmed:true,beforeProduce:true}},produceActions:[{action:'acquire',fromExamIndex:1,week:12,venue:'consult'}]};
  const result=evaluateSupportItemValue({card,plan:'sense',level:1,route,options});
  assert.equal(result.applied.activationCount,2);
  assert.equal(result.applied.resources.pp,10);
  assert.equal(result.byStage.selection.resources.pp,5);
  assert.equal(result.byStage.final.resources.pp,5);
  const profile=calculateHifSupport(card,[{kind:'consult',effects:[{type:'ProduceEffectType_ProducePointAdditionDisableTrigger',min:20,max:20}]}],1,
    {...route,counts:{consult:2},perAxis:{},parameterBonusRows:[]},'sense',options);
  assert.equal(profile.resources.pp,50); // Existing consult ability40 + distinct item10; neither is duplicated.
});

test('exam-end item reward is absent from its own battle input',()=>{
  const card={gameId:'exam',plan:'free',p_item:{name:'exam fixture',effect:{trigger:{key:'exam_end'},body:[{key:'param_up',param:'vocal',value:26}]}}};
  const route={selections:[{week:7,activity:'mid_exam'}]},base={supportItemAcquisitions:{exam:{confirmed:true,beforeProduce:true}}};
  assert.equal(evaluateSupportItemValue({card,route,options:{...base,examIndex:0}}).applied.stats.vocal,0);
  assert.equal(evaluateSupportItemValue({card,route,options:{...base,examIndex:1}}).byStage.selection.stats.vocal,26);
});

test('unconditional legacy boost and a count alone do not invent acquisition or selection timing',()=>{
  const card=catalog.supportCards.find(card=>card.gameId==='s_card-3-0025');
  const profile=calculateHifSupport(card,[],40,{counts:{class_work_end:6},perAxis:{},parameterBonusRows:[]},'sense',
    {includeSupportEvents:false,pItemCounts:{[card.gameId]:6}});
  assert.equal(profile.fixedStats.visual,0);
  assert.equal(profile.supportItemValue.applied.activationCount,0);
  assert.ok(profile.unscored.some(text=>text.includes('pItemCounts')));
});

test('battle items require an exact native/public reference and produce items stay out of battle',()=>{
  const production=supportBattleItemReference(teacher,catalog);
  assert.equal(production.gameId,'pitem_00-3-352-0');
  assert.equal(production.publicId,487);
  assert.equal(production.mode,'produce');
  assert.equal(production.connectable,false);
  const battle=catalog.supportCards.find(card=>card.p_item?.name==='仲直りのきっかけ');
  const reference=supportBattleItemReference(battle,catalog);
  assert.equal(reference.publicId,78);
  assert.equal(reference.connectable,true);
  assert.equal(reference.requiresConfirmedAcquisition,true);
});

test('item display names the exact Korean trigger, parameter threshold and produce-wide cap',()=>{
  const result=evaluate([change(1),change(2)],{confirmed:false,fromExamIndex:0,week:0});
  assert.ok(result.conditions.includes('발동: 스킬 카드 변환 시'));
  assert.equal(result.triggerKey,'skill_change');
  assert.deepEqual(result.triggerMeta,{key:'skill_change'});
  assert.ok(result.conditions.includes('추가 조건: 비주얼 400 이상'));
  assert.ok(result.conditions.includes('육성당 최대 3회'));
  assert.ok(result.summary.includes('발동 0회'));
  assert.deepEqual(result.potentialRanges.stats.visual,[0,50]);
});

test('compound display conditions stay readable and unfamiliar keys remain unparsed',()=>{
  const card={gameId:'labels',plan:'free',p_item:{name:'표시 검증',effect:{trigger:{key:'consult_selection'},
    condition:[{key:'hp_gte_pct',threshold:50},{key:'pp_gte',threshold:200}],body:[{key:'pp_gain',value:5}],limit:{key:'per_produce',count:2}}}};
  const result=evaluateSupportItemValue({card,plan:'sense',level:1});
  assert.ok(result.conditions.includes('발동: 상담 선택 시'));
  assert.ok(result.conditions.includes('추가 조건: 체력 50% 이상 · P포인트 200 이상'));
  card.p_item.effect.trigger={key:'unrecognized_internal_trigger'};
  card.p_item.effect.condition={key:'unrecognized_internal_condition',param:'visual',threshold:400};
  card.p_item.effect.limit={key:'unrecognized_internal_limit',count:3};
  const unknown=evaluateSupportItemValue({card,plan:'sense',level:1});
  assert.ok(unknown.conditions.some(text=>text.includes('추가 조건 확인 필요')));
  assert.ok(unknown.conditions.every(text=>!text.includes('unrecognized_')&&!text.includes('{')));
});
