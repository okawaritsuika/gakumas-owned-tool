import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import SkillCards from '../lib/vendor/gakumas-data/data/skillCards.js';
import {PItems} from '../lib/vendor/gakumas-data/index.js';
import {getRand,getRandCallCount,resetRand,withRand} from '../lib/vendor/gakumas-engine/utils.js';
import {evaluateHifOutfitRoute,evaluateHifOutfitSide,hifOrderPolicies} from '../lib/hif-outfit-ledger.mjs';

const source=JSON.parse(readFileSync(new URL('../data/catalog/pidol_unique_effects.json',import.meta.url)));
const basic=(id,publicId)=>({id,definition:SkillCards.getById(publicId)});
function evaluate(versions,itemId,route) {
  const skills=versions.map(k=>source.skills[k]);
  return evaluateHifOutfitRoute({skills,item:source.items[itemId],plan:skills[0].definition.plan,route,trace:true});
}

test('unit attribute multiplier, self-earned cumulative charge and the last-turn boundary',()=>{
  const id='p_card-03-ido-3_123',item='pitem_03-3-116-1';
  const route={deck:[id,'basic','basic','basic','basic','basic'],cards:[basic('basic',1)],turnCount:2};
  const early=evaluate([id+':1'],item,route);
  assert.equal(early.missing,'');
  assert.equal(early.withOutfit.uniquePlays[id],1);
  assert.equal(early.withOutfit.itemTriggers,1);
  const hit=early.withOutfit.trace.find(e=>e.kind==='reservation');
  assert.deepEqual([hit.turn,hit.parameter,hit.cumulativeFullPowerCharge],[2,23,5]);
  // Both paths draw three slots in identical order, regardless of the number
  // of enabled uniques. The counterfactual uses a real basic instead.
  assert.deepEqual(early.withOutfit.trace.filter(e=>e.kind==='draw').map(e=>e.id),
    early.withoutOutfit.trace.filter(e=>e.kind==='draw').map(e=>e.id));
  const last=evaluate([id+':1'],item,{...route,turnCount:1});
  assert.equal(last.withOutfit.parameter,0);
  assert.equal(last.withoutOutfit.parameter,9);
  assert.equal(last.marginalParameter,-9);
});

test('Garakuta receives each direct increase, pays for two item activations and replays only after removal',()=>{
  const a='p_card-02-ido-3_201',b='p_card-02-ido-3_214',item='pitem_02-3-314-0';
  const route={deck:[a,'distance','distance',b,'self','distance','distance','basic','fin'],
    cards:[basic('distance',678),basic('self',680),basic('basic',652),basic('fin',152)],turnCount:12,
    priority:[b,a,'distance','self','basic','fin'],playWindows:{fin:{first:12}},turnPriorities:{12:['fin']},
    redrawOrder:[b,'distance','self','fin','basic'],initial:{stamina:50}};
  const result=evaluate([a+':1',b+':0'],item,route);
  assert.equal(result.missing,'');
  const on=result.withOutfit, events=on.trace;
  assert.equal(on.uniquePlays[a],3);
  assert.equal(on.freePlays[a],2);
  assert.equal(on.uniqueTriggers[a],2);
  assert.equal(on.itemTriggers,2);
  assert.deepEqual(events.filter(e=>e.turn===2 && e.kind==='afterEffect'&& e.id===item).map(e=>[e.counter,e.motivation]),
    [[2,7],[3,9],[4,12]]);
  for (const first of events.filter(e=>e.kind==='itemTrigger')) {
    const after=events.slice(events.indexOf(first)+1).find(e=>e.kind==='afterEffect'&&e.id===item && e.activation===first.activation);
    assert.equal(after.genki-first.genki,10+2*first.motivation);
    assert.equal(first.stamina-after.stamina,1);
    assert.equal(after.genkiChange,10+2*first.motivation);
    assert.equal(after.staminaChange,-1);
  }
  assert.equal(result.marginalParameter,on.parameter-result.withoutOutfit.parameter);
  assert.equal(result.withoutOutfit.itemTriggers,0);
});

test('Agitato requires eight good-condition turns, schedules two draws and hits only while sleep is in hand',()=>{
  const id='p_card-01-ido-3_246',item='pitem_01-3-346-0';
  const route={deck:[id,...Array(22).fill('basic')],cards:[basic('basic',1)],turnCount:3,initial:{goodConditionTurns:8}};
  const result=evaluate([id+':1'],item,route), on=result.withOutfit;
  assert.equal(result.missing,'');
  assert.equal(on.uniquePlays[id],1);
  assert.deepEqual(on.trace.filter(e=>e.kind==='reservation').map(e=>[e.turn,e.uses,e.hand.length]),[[2,2,5],[3,1,5]]);
  assert.deepEqual(on.trace.filter(e=>e.kind==='reservation').map(e=>[e.draws,e.additionalUses]),[[2,1],[2,0]]);
  const activations=on.trace.filter(e=>e.kind==='itemTrigger');
  assert.equal(activations.length,2);
  assert.ok(activations.every(e=>e.turn===2 && e.hand.includes('23') && e.triggerCardId==='basic'));
  assert.equal(evaluate([id+':1'],item,{...route,initial:{goodConditionTurns:7}}).withOutfit.uniquePlays[id],0);
  const last=evaluate([id+':1'],item,{...route,turnCount:1}).withOutfit;
  assert.equal(last.itemTriggers,0);
  assert.ok(!last.trace.some(e=>e.kind==='reservation'));
});

test('scoped vendor randomness restores both the stream and counter on success, nesting and failure',()=>{
  resetRand(432); const expected=[getRand(),getRand(),getRand()];
  resetRand(432); assert.equal(getRand(),expected[0]);
  assert.throws(()=>withRand(30,()=>{getRand();withRand(31,()=>getRand());throw Error('boundary');}));
  assert.equal(getRandCallCount(),1);
  assert.equal(getRand(),expected[1]);
  withRand(36,()=>getRand());
  assert.equal(getRandCallCount(),2);
  assert.equal(getRand(),expected[2]);
});

test('published PLv80 compressed window returns both attacks, redraws the second unique and consumes real actions',()=>{
  const a='p_card-03-ido-3_206', b='p_card-03-ido-3_219';
  // Conditional final window (not a starting deck or a recommendation):
  // pre-existing 30 unspent charge, unmodified advanced skills and no drinks.
  // The *cumulative* charge required by wing must be earned in this fixture.
  const route={initial:{stamina:26,genki:1,fullPowerCharge:30},turnCount:2,
    deck:[a,'setup','wing',b,'trend','stack','draw'],
    cards:[basic('setup',444),basic('wing',780),basic('trend',550),basic('stack',388),basic('draw',438)],
    turnPriorities:[[a,'setup','draw','wing'],['wing','trend',b,'draw','stack']]};
  const out=evaluate([a+':1',b+':1'],'pitem_03-3-334-0',route), side=out.withOutfit;
  assert.equal(out.missing,'');
  const t=side.trace.filter(e=>e.turn===2);
  assert.deepEqual(t.filter(e=>['play','replay'].includes(e.kind)).map(e=>e.id),[
    'wing','trend',a,b,'wing','trend','draw',b,'wing','trend','stack']);
  assert.equal(side.replays[a],2);
  assert.deepEqual(t.filter(e=>e.kind==='recovery' && e.by===b).map(e=>e.id),['trend','wing','trend','wing']);
  const redraw=t.findIndex(e=>e.kind==='draw' && e.id===b && t.indexOf(e)>t.findIndex(x=>x.kind==='play' && x.id==='draw'));
  assert.ok(redraw>0 && t.slice(redraw+1).some(e=>e.kind==='play' && e.id===b));
  assert.equal(t.filter(e=>e.kind==='play' && e.extraAction).length,9);
  for(const e of t.filter(e=>e.kind==='play' && ['wing','trend'].includes(e.id))){
    assert.ok(t.slice(t.indexOf(e)+1).find(x=>x.kind==='afterPlay' && x.id===e.id).parameter>e.parameter);
  }
  assert.equal(side.parameter,1182);
  assert.equal(side.extraActionsSpent,11);
  assert.equal(out.withoutOutfit.parameter,288);
});

test('delayed-only native Sumika effect counts its qualifying trigger, not the registration',()=>{
  const id='p_card-01-ido-3_134', item=source.items['pitem_01-3-158-0'];
  const params={plan:'sense',skills:[source.skills[id+':0']],item};
  const route={deck:[id,'filler','filler','gain','filler','filler'],cards:[basic('gain',704),basic('filler',1)],turnCount:2,
    turnPriorities:[[id],['gain']]};
  for(const trace of [false,true]){
    assert.equal(evaluateHifOutfitSide({...params,route,trace}).reservationTriggers[id],1);
    assert.equal(evaluateHifOutfitSide({...params,route:{...route,turnCount:1},trace}).reservationTriggers[id],0);
  }
});

test('per-arm order and carried stamina include the legal zero-stamina start',()=>{
  const id='p_card-03-ido-3_206', item=source.items['pitem_03-3-334-0'];
  const params={plan:'anomaly',skills:[source.skills[id+':1']],item,
    route:{deck:[id,'hit','hit'],cards:[basic('hit',1)],turnCount:1,
      initial:{stamina:26,maxStamina:26},preferBestOrder:true}};
  const both=evaluateHifOutfitRoute({...params,startingStamina:{withOutfit:0,withoutOutfit:26}});
  assert.equal(both.missing,'');
  for(const active of [true,false]){
    const side=both[active?'withOutfit':'withoutOutfit'], startingStamina=active?0:26;
    assert.equal(side.startingStamina,startingStamina);
    const candidates=hifOrderPolicies(params.route).map(policy=>evaluateHifOutfitSide({...params,policy,active,startingStamina}));
    assert.equal(side.parameter,Math.max(...candidates.map(c=>c.parameter)));
  }
});

test('remaining cards actually fill draws and both native R2 decks reach 22',()=>{
  const a='p_card-03-ido-3_206', b='p_card-03-ido-3_219';
  const params={plan:'anomaly',skills:[source.skills[a+':1'],source.skills[b+':0']],item:source.items['pitem_03-3-334-0'],
    route:{deck:[a,b,'draw','hit','hit','hit','hit','hit'],cards:[basic('draw',438),basic('hit',1)],
      turnCount:1,preferBestOrder:true},trace:true};
  const off=evaluateHifOutfitSide({...params,active:false});
  assert.equal(off.initialDeckCount,6);
  assert.equal(off.openingDeckCount,6);
  assert.deepEqual(off.trace.filter(e=>e.kind==='draw').slice(0,3).map(e=>e.id),['draw','hit','hit']);
  assert.ok(off.trace.every(e=>!e.hand.includes(a) && !e.hand.includes(b)));
  const r2={...params.route,stageEffects:PItems.getById(427).effects,generatedBasicCardIds:[1]};
  const {withOutfit:on,withoutOutfit:remaining}=evaluateHifOutfitRoute({...params,route:r2});
  assert.deepEqual([on.initialDeckCount,remaining.initialDeckCount],[8,6]);
  assert.deepEqual([on.openingDeckCount,remaining.openingDeckCount],[22,22]);
});

test('both paths use the same priority condition against their own current resources and turn window',()=>{
  const id='p_card-02-ido-3_201', item='pitem_02-3-314-0';
  const route={deck:[id,'hit','setup','hit','setup','hit','hit','setup','hit'],
    cards:[basic('hit',1),basic('setup',678)],turnCount:3,priority:[id,'hit','setup'],
    goalPriorities:[{first:2,last:2,condition:{field:'motivation',op:'<',value:3},order:['setup']}]};
  const result=evaluate([id+':1'],item,route);
  assert.equal(result.missing,'');
  const plays=side=>side.trace.filter(e=>e.kind==='play').map(e=>[e.turn,e.id]);
  assert.deepEqual(plays(result.withOutfit),[[1,id],[2,'hit'],[3,'hit']]);
  assert.deepEqual(plays(result.withoutOutfit),[[1,'hit'],[2,'setup'],[3,'hit']]);
  const invalid={...route,goalPriorities:[{condition:{field:'unverified',op:'<',value:1},order:['hit']}]};
  assert.match(evaluate([id+':1'],item,invalid).missing,/우선순위 조건/);
});

test('recovered exact native item rows are used, unknown mechanics are explicitly unscorable',()=>{
  const id='p_card-02-ido-3_201', skill=source.skills[id+':1'], real=source.items['pitem_02-3-314-0'];
  const input={plan:'logic',skills:[skill],item:{...real,mechanics:{kind:'unverified'}},
    route:{deck:[id],cards:[],turnCount:1}};
  const result=evaluateHifOutfitRoute(input);
  assert.equal(result.marginalParameter,null);
  assert.match(result.missing,/unverified/);
  const native={...real,definition:{...real.definition,effects:[{phase:'startOfStage',actions:[
    {type:'assignment',lhs:'fixedGenki',op:'+=',rhs:{type:'number',value:17}}]}]}};
  const repaired=evaluateHifOutfitRoute({...input,item:native});
  assert.equal(repaired.missing,'');
  assert.equal(repaired.withOutfit.finalState.genki,15);
  assert.equal(repaired.withoutOutfit.finalState.genki,0);
  const broken=structuredClone(native);
  broken.definition.effects[0].conditions=[{type:'number',value:0}];
  broken.definition.effects[0].actions[0].lhs='unmappedCore';
  const hidden=evaluateHifOutfitRoute({...input,item:broken});
  assert.equal(hidden.marginalParameter,null);
  assert.match(hidden.missing,/unmappedCore/);
});
