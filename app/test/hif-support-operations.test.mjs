import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { calculateHifSupport, evaluateHifDeck } from '../lib/hif-model.mjs';
import { cardTargetDescriptor, resolveCardTargets } from '../lib/hif-card-targets.mjs';

const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog/',import.meta.url))});
const zero=()=>({vocal:0,dance:0,visual:0});
const caps={vocal:3200,dance:3200,visual:3200};
const active='p_card-00-act-0_001',mental='p_card-00-men-0_003';
const support=id=>catalog.supportCards.find(c=>c.gameId===id);
const latest=(c,kinds)=>[...new Map(c.levelAbilities.filter(a=>kinds.includes(a.kind)).map(a=>[a.order,a])).values()];
const part=counts=>({counts,perAxis:{},parameterBonusRows:[],gains:zero(),classGains:zero()});
const schedule=[{week:1,fromExamIndex:0,stage:'selection',activity:'consult'},
  {week:6,fromExamIndex:0,stage:'selection',activity:'supply_gift'},
  {week:7,fromExamIndex:0,stage:'selection',activity:'mid_exam'},
  {week:19,fromExamIndex:2,stage:'selection',activity:'class_vocal'},
  {week:20,fromExamIndex:2,stage:'selection',activity:'final_exam'}];

function routeFor(ids,declared=[]) {
  const plan={start:ids.map(id=>cardTargetDescriptor(catalog,id,0)),ops:[...declared,
    ...schedule.filter(s=>s.activity?.endsWith('exam')).map(s=>({...s,action:'exam'}))],schedule,horizon:5};
  plan.baseline=resolveCardTargets(plan,[],{details:true});
  return {...part(plan.baseline.counts),stages:{selection:part(plan.baseline.byStage.selection),final:part(plan.baseline.byStage.final)},
    selections:schedule,produceActions:declared,supportPeakScenario:{cardTargetPlan:plan,examDeckSizes:plan.baseline.examDeckSizes,
      managementStoryWeek:19,parameterStoryWeek:12,supportReceiptWeek:6,
      statsBeforeWeek:Object.fromEntries(schedule.map(s=>[s.week,caps]))}};
}
const profile=(c,abilities,route,events=c.events,plan='anomaly')=>calculateHifSupport({...c,events},abilities,60,route,plan,{catalog,supportPeakScenario:true});
const score=(cards,route)=>evaluateHifDeck(cards,{route,statCaps:caps,explainSupportLinks:true});

test('two independent targets from つやつやでふさふさ reward both mental and general enhancement, with no repeat on one card',()=>{
  const supply=support('s_card-3-0037'),any=support('s_card-2-0012'),typed=support('s_card-3-0023');
  const run=ids=>{
    const r=routeFor(ids),p=profile(supply,[],r,supply.events.slice(0,1),supply.plan);
    assert.equal(p.supportItemValue.peak.total.activationCount,1);
    return score([p,profile(any,latest(any,['skill_enhance']),r,[]),profile(typed,latest(typed,['m_skill_enhance']),r,[])],r);
  };
  const two=run([active,mental]);
  assert.equal(two.providedActions.skill_enhance,2);
  assert.equal(two.providedActions.m_skill_enhance,1);
  assert.equal(two.cappedStats.vocal,2*3+9);
  assert.equal(run([mental]).cappedStats.vocal,3+9);
});

test('a selected removal consumes its target and can lose a later fifteen-card exam',()=>{
  const giver=support('s_card-3-0020'),listener=support('s_card-3-0033'),teacher=support('s_card-3-0099');
  const r=routeFor(Array(15).fill(mental)),cards=[profile(giver,[],r,giver.events.filter(e=>e.effect_type==='select_delete')),
    profile(listener,latest(listener,['delete']),r,[]),profile(teacher,latest(teacher,['exam_15']),r,[])];
  const result=score(cards,r);
  assert.equal(result.providedActions.delete,1);
  assert.equal(result.providedActions.exam_15,-1);
  assert.deepEqual(result.examDeckSizes,[15,14]);
  assert.equal(result.cappedStats.vocal,8);
  assert.equal(result.cappedStats.visual,37);
});

test('trouble-specific removal never consumes a normal card, and a named story action is counted once',()=>{
  const provider=support('s_card-3-0033');
  const run=(ids,declared=[])=>{
    const r=routeFor(ids,declared);
    return score([profile(provider,latest(provider,['delete']),r,provider.events.filter(e=>e.effect_type==='trouble_delete'))],r);
  };
  assert.equal(run([mental]).cappedStats.vocal,0);
  const trouble='p_card-00-acc-0_002';
  assert.equal(run([mental,trouble]).cappedStats.vocal,8);
  const receipt={id:'external',providerId:provider.gameId,action:'remove',target:'trouble',week:19,fromExamIndex:2,stage:'selection'};
  assert.equal(run([mental,trouble,trouble],[receipt]).cappedStats.vocal,8);
});

test('思い出カタメコイメ resolves deletion and the distinct R mental reward without an artificial SSR or net deck increase',()=>{
  const supplier=support('s_card-3-0058'),listener=support('s_card-3-0033');
  const r=routeFor([active,mental]);
  const result=score([profile(supplier,[],r,supplier.events.slice(0,1),supplier.plan),
    profile(listener,latest(listener,['delete']),r,[])],r);
  assert.equal(result.providedActions.delete,1);
  assert.equal(result.providedActions.m_skill_acquire,1);
  assert.equal(result.providedActions.ssr_card_acquire??0,0);
  assert.deepEqual(result.examDeckSizes,[2,2]);
  assert.equal(result.cappedStats.vocal,8);
});

test('one supported concentration skill triggers a second item, whose real deletion then rewards a third card',()=>{
  const grant=support('s_card-3-0002'),item=support('s_card-3-0107'),earner=support('s_card-3-0033');
  const r=routeFor([active,mental]);
  const cards=[profile(grant,[],r,grant.events.slice(0,1),'sense'),profile(item,[],r,item.events.slice(0,1),'sense'),
    profile(earner,latest(earner,['delete']),r,[],'sense')];
  const best=score(cards,r);
  assert.equal(best.cappedStats.vocal,18);
  assert.equal(best.providedActions.skill_acquire,2);
  assert.equal(best.providedActions.ssr_card_acquire,1);
  assert.equal(best.providedActions.delete,1);
  assert.equal(best.supportLinks.find(row=>row.producedOperation==='remove')?.producedOperationCount,1);
  assert.deepEqual(best.targetResolution.examDeckSizes,[3,3]);
  for(const deck of [[...cards].reverse(),cards])assert.equal(evaluateHifDeck(deck,{route:r,statCaps:caps,searchOnly:true}).score,best.score);
});

test('a capped keyword-enhancement item may react to its own enhancement only with a seed, another target and remaining charges',()=>{
  const item=support('s_card-2-0048'),seed=support('s_card-3-0019'),pay=support('s_card-2-0012');
  const run=(n,activate)=>{
    const r=routeFor(Array(n).fill('p_card-01-men-0_007'));
    const cards=[profile(item,[],r,item.events.slice(0,1),item.plan),profile(pay,latest(pay,['skill_enhance']),r,[])];
    if(activate)cards.push(profile(seed,[],r,seed.events.filter(e=>e.effect_type==='select_enhance')));
    return score(cards,r);
  };
  assert.equal(run(5,false).providedActions.skill_enhance??0,0);
  assert.equal(run(5,true).providedActions.skill_enhance,3);
  assert.equal(run(2,true).providedActions.skill_enhance,2);
});

test('the trainer assist unlocks its item, 40 PP, then enhancement at their verified levels',()=>{
  const trainer=support('s_card-3-0100'),r=routeFor([mental]);
  const levels=[1,19,20,39,40,60].map(level=>calculateHifSupport(trainer,latest(trainer,['event_pp_boost'])
    .filter(a=>a.level<=level),level,r,'anomaly',{catalog,supportPeakScenario:true}));
  assert.deepEqual(trainer.events.map(e=>[e.release,e.effect_type]),[['initial','p_item'],['lv20','pp_gain'],['lv40','card_enhance']]);
  assert.deepEqual(levels.map(c=>c.providedActions.p_item_acquire),[1,1,1,1,1,1]);
  assert.deepEqual(levels.map(c=>c.resources.pp),[0,0,40,40,40,80]);
  assert.deepEqual(levels.map(c=>c.providedActions.skill_enhance??0),[0,0,0,0,1,1]);
});

test('verified support copy shares the scenario duplication receipt, with no copy of a no-duplicate card',()=>{
  const supplier=support('s_card-2-0075'),trigger=support('s_card-3-0004');
  const r=routeFor([active,mental]),p=profile(supplier,[],r,supplier.events.slice(0,1),supplier.plan);
  const result=score([p,profile(trigger,latest(trigger,['m_skill_acquire']),r,[])],r);
  assert.equal(result.providedActions.copy,1);
  assert.equal(result.providedActions.m_skill_acquire,1);
  assert.equal(result.providedActions.ssr_card_acquire??0,0);
  assert.equal(result.cappedStats.dance,3);
  assert.deepEqual(result.examDeckSizes,[3,3]);
  const only=routeFor(['p_card-01-sup-3_047']);
  assert.equal(score([profile(supplier,[],only,supplier.events.slice(0,1),supplier.plan)],only).providedActions.copy??0,0);
});

test('a verified route copy is one keyword acquisition and later qualifying actions remain available to a capped item',()=>{
  const holder=support('s_card-2-0016');
  const good='p_card-01-men-0_007';
  const copies=[['early',6,true],['size-only',12,false],['late',19,true]].map(([id,week,receipt])=>({
    id,action:'copy',gameId:good,keywords:['good_condition'],countsAsAcquisition:receipt,
    fromExamIndex:week<7?0:2,stage:'selection',week,
  }));
  const r=routeFor([good],copies);
  const card={...holder,p_item:{...holder.p_item,effect:{...holder.p_item.effect,limit:{key:'per_produce',count:1}}}};
  const model=profile(card,[],r,card.events.slice(0,1),holder.plan);
  assert.equal(model.supportItemValue.peak.total.activationCount,1);
  assert.deepEqual(model.supportItemValue.peak.eligibleRouteActions.map(row=>row.actionId),['early','late']);
  assert.equal(score([model],r).cappedStats.dance,6);
});

test('HP stories, capped exam healing, SP lesson PP rates and shop discounts stay in their own units',()=>{
  const teacher=support('s_card-3-0019'),ppCard=support('s_card-3-0002'),discount=support('s_card-2-0014');
  const r=routeFor([mental]);
  r.counts.exam_end=4;
  r.stages.selection.perAxis.vocal={sp_lesson_end:2,normal_lesson_end:0};
  const p=profile(teacher,latest(teacher,['exam_hp','event_recovery_boost']),r,teacher.events.filter(e=>e.effect_type==='hp_recovery'));
  const hp=latest(teacher,['event_recovery_boost'])[0].effects[0].min;
  const exam=latest(teacher,['exam_hp'])[0];
  assert.equal(p.resources.stamina,Math.floor(7*(1+hp/1000))+Math.min(4,exam.activationLimit)*exam.effects[0].min);
  const skill=latest(ppCard,['sp_lesson_pp','support_rate']);
  const bonus=profile(ppCard,skill,r,[],'sense');
  const drink=profile(discount,latest(discount,['discount']),r,[],discount.plan);
  const result=score([bonus,drink],r);
  assert.equal(result.progress.lessonBonusPP,2*Math.floor(30*skill.find(e=>e.kind==='sp_lesson_pp').effects[0].min/1000));
  assert.ok(bonus.resources.supportUpgradeProbabilityUpPermil>0);
  assert.ok(drink.resources.drinkDiscountPermil>0);
  assert.equal(result.score,0);
});

test('temporary lesson support probability leaves the native story receipt at grade zero until a lasting upgrade occurs',()=>{
  const donor=support('s_card-3-0002'),r=routeFor([]);
  const abilities=latest(donor,['support_rate','m_skill_enhance']);
  const receipt=donor.events.filter(e=>e.effect_type==='skill_card');
  const get=events=>score([profile(donor,abilities,r,events,donor.plan)],r);
  const opening=get(receipt);
  assert.equal(opening.targetResolution.actions.find(a=>a.action==='acquire').upgradeCount,0);
  assert.equal(opening.providedActions.skill_enhance??0,0);
  const later=get([...receipt,...donor.events.filter(e=>e.effect_type==='card_enhance')]);
  assert.equal(later.providedActions.m_skill_enhance,1);
  assert.equal(later.cappedStats.vocal,7);
});
