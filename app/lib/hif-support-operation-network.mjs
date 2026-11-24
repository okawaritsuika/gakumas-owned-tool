import { resolveCardTargets } from './hif-card-targets.mjs';

const stages=['selection','final'];
const axes=['vocal','dance','visual'];
const zero=()=>({vocal:0,dance:0,visual:0});
const increment=(map,key,count)=>{if(count)map[key]=(map[key]??0)+count;};
const ofStage=row=>row.stage??(row.fromExamIndex>=3?'final':'selection');
const order=(a,b)=>(a.week??Infinity)-(b.week??Infinity)||(a.sequence??0)-(b.sequence??0);
// A selectable reward or a verified acquisition-producing copy also chooses
// the acquired card's category, rarity and keywords.
const targetKind=kind=>kind==='basic_card_change'||/^[am]_skill_(?:acquire|enhance|delete)$/.test(kind)
  ||/_card_(?:acquire(?:_8)?|enhance|delete)$/.test(kind);
const caches=new WeakMap(),profileIds=new WeakMap();
const targetCaches=new WeakMap(),operationKeys=new WeakMap(),actionIndices=new WeakMap();
const declaredSources=new WeakMap(),stageDeltas=new WeakMap();
let nextProfileId=0;
function profileId(card){
  const ops=card.supportOperations;
  if(!profileIds.has(ops))profileIds.set(ops,++nextProfileId);
  return profileIds.get(ops);
}
function actionsById(resolved){
  if(!actionIndices.has(resolved))actionIndices.set(resolved,new Map(resolved.actions.map(action=>[action.id,action])));
  return actionIndices.get(resolved);
}

function rankingWeights(cards) {
  const result={};
  for(const card of cards) {
    for(const effect of card.dynamicEffects??[])
      if(targetKind(effect.kind))increment(result,effect.kind,effect.amount);
    const item=card.itemResponse;
    if(item&&targetKind(item.kind)) {
      const value=axes.reduce((sum,axis)=>sum+item.stats[axis],0)
        +item.operations.length+item.resources.pDrinkAcquisitions;
      increment(result,item.kind,Math.max(1,value));
    }
  }
  return result;
}

function responseActivations(card, resolved, baseline) {
  const response=card.itemResponse,kind=response.kind,roots=response.routeActivations??[];
  const masked=new Set(), matches=[];
  const baselineById=actionsById(baseline),resolvedById=actionsById(resolved);
  for(const [i,root] of roots.entries()) {
    const base=baselineById.get(root.actionId);
    if(base) {
      masked.add(base.id);
      if(!resolvedById.get(base.id)?.triggerCounts?.[kind])continue;
    }
    matches.push({...root,id:root.actionId??'route:'+i,providerId:null});
  }
  for(const action of resolved.actions) {
    if(masked.has(action.id)||!(action.triggerCounts?.[kind]>0))continue;
    // A route trigger already accounted for by a differently labelled
    // original receipt is not a second support action.
    if(!action.providerId&&baselineById.get(action.id)?.triggerCounts?.[kind]>0)continue;
    const eligible=Number.isFinite(action.week)&&response.eligibleByWeek
      ? response.eligibleByWeek[action.week] : response.eligible[ofStage(action)];
    if(!eligible)continue;
    // Unbounded hypothetical operation cycles never introduce fresh sources.
    if(!Number.isFinite(response.limit)&&action.ancestors?.includes(card.gameId))continue;
    matches.push({...action,count:action.triggerCounts[kind]});
  }
  let left=response.limit;
  const active=[];
  for(const action of matches.sort(order)) {
    const count=Math.min(left,action.count??1);
    if(count>0)active.push({...action,count});
    left-=count;
    if(left===0)break;
  }
  return active;
}

function itemOperations(card,active) {
  const result=[];
  for(const trigger of active) for(const [i,op] of card.itemResponse.operations.entries()) {
    const id=card.gameId+':item:'+trigger.id+':'+i;
    result.push({...op,id,sourceId:id,providerId:card.gameId,source:'support_item',
      ancestors:[...(trigger.ancestors??[]),card.gameId],sourceTriggerId:trigger.id,
      stage:ofStage(trigger),week:trigger.week,fromExamIndex:trigger.fromExamIndex,
      order:(trigger.order??1)+1,quantity:op.quantity*trigger.count});
  }
  return result;
}

function remainingOperations(inputs,plan) {
  if(!inputs.length)return inputs;
  let declared=declaredSources.get(plan);
  if(!declared){
    declared={hasNamedProvider:plan.ops.some(op=>op.providerId||op.supportGameId),
      sourceIds:new Set(plan.ops.map(op=>op.sourceId).filter(Boolean))};
    declaredSources.set(plan,declared);
  }
  if(!declared.hasNamedProvider&&!inputs.some(row=>declared.sourceIds.has(row.id)))return inputs;
  const ids=new Set(inputs.map(row=>row.id));
  const named=plan.ops.filter(op=>op.providerId||op.supportGameId||op.sourceId&&ids.has(op.sourceId));
  const claimed=new Map();
  for(const op of named){
    const options=inputs.filter(row=>row.action===op.action&&(row.id===op.sourceId||row.id===op.id||
      row.providerId===(op.providerId??op.supportGameId)&&(!op.source||!['support_item','support_story'].includes(op.source)||op.source===row.source)
      &&(op.week==null||op.week===row.week)));
    if(options.length!==1)continue;
    const id=options[0].id;
    claimed.set(id,(claimed.get(id)??0)+(op.quantity??1));
  }
  return inputs.flatMap(op=>{
    const left=op.quantity-(claimed.get(op.id)??0);
    return left<=0?[]:left===op.quantity?[op]:[{...op,quantity:left}];
  });
}

function operationKey(op){
  if(!operationKeys.has(op))operationKeys.set(op,[op.week,op.fromExamIndex,op.stage,op.order,op.action,op.target,op.quantity,
    op.gameId,op.type,op.rarity,op.upgradeCount,op.countsAsAcquisition,op.cardName].join(':'));
  return operationKeys.get(op);
}

function orderedOperations(inputs,plan) {
  return remainingOperations(inputs,plan).sort((a,b)=>order(a,b)||
    (a.order??1)-(b.order??1)||operationKey(a).localeCompare(operationKey(b))||a.id.localeCompare(b.id));
}

// A card without an operation may change target weights or receive a stat
// award. It does not change which source operations must be replayed.
function resolveFixedNetwork(cards,plan,weights,detailed) {
  let cache=targetCaches.get(plan);
  if(!cache){
    cache={lineups:new Map(),targets:new Map()};
    targetCaches.set(plan,cache);
  }
  const sources=cards.filter(card=>card.supportOperations.length);
  const lineupKey=sources.map(profileId).join(',');
  let lineup=cache.lineups.get(lineupKey);
  if(!lineup){
    const physical=orderedOperations(sources.flatMap(card=>card.supportOperations),plan);
    lineup={physical,signature:physical.map(operationKey).join(',')};
    if(cache.lineups.size>=512)cache.lineups.delete(cache.lineups.keys().next().value);
    cache.lineups.set(lineupKey,lineup);
  }
  const key=Number(detailed)+'|'+lineup.signature+'|'+Object.keys(weights).sort().map(k=>k+':'+weights[k]).join(',');
  let resolved=cache.targets.get(key);
  if(!resolved){
    resolved=resolveCardTargets(plan,lineup.physical,{weights,details:detailed});
    if(cache.targets.size>=512)cache.targets.delete(cache.targets.keys().next().value);
    cache.targets.set(key,resolved);
  }
  return resolved;
}

// The same physical operation cannot feed an item twice. Replaying source
// tokens in chronological order also lets an earlier activation use the last
// charge formerly occupied by a later route action.
function resolveNetwork(cards,plan,weights,explain) {
  const listeners=cards.filter(card=>card.itemResponse);
  const produces= listeners.filter(card=>card.itemResponse.operations.length);
  const reactions=resolved=>new Map(listeners.map(card=>[card,responseActivations(card,resolved,plan.baseline)]));
  // Without an operation-producing listener, anonymous operations share the
  // same numerical replay. The explained deck still uses its actual IDs.
  if(!explain&&!produces.length){
    const resolved=resolveFixedNetwork(cards,plan,weights,listeners.length>0);
    return {resolved,active:reactions(resolved)};
  }
  const inputs=cards.flatMap(card=>card.supportOperations);
  const dynamic=produces.length?new Set(produces.map(card=>card.gameId)):null;
  const fixed=dynamic?inputs.filter(op=>op.source!=='support_item'||!dynamic.has(op.providerId)):inputs;
  let generated=dynamic?inputs.filter(op=>op.source==='support_item'&&dynamic.has(op.providerId)):[];
  let resolved,active;
  const rounds=1+produces.reduce((sum,card)=>sum+(Number.isFinite(card.itemResponse.limit)?card.itemResponse.limit:1),0);
  for(let pass=0;pass<=rounds;pass++) {
    const physical=orderedOperations(generated.length?[...fixed,...generated]:fixed,plan);
    const detailed=explain||listeners.length>0;
    resolved=resolveCardTargets(plan,physical,{weights,details:detailed});
    active=reactions(resolved);
    if(!produces.length||pass===rounds)break;
    const next=produces.flatMap(card=>itemOperations(card,active.get(card)));
    if(next.length===generated.length&&next.every((op,i)=>op.id===generated[i].id&&op.quantity===generated[i].quantity))break;
    generated=next;
  }
  return {resolved,active};
}

// Anonymous operation sets can share a physical replay across many different
// lineups. Its per-stage trigger differences depend only on that replay.
function baseDeltas(resolved,baseline) {
  let cached=stageDeltas.get(resolved);
  if(cached?.baseline===baseline)return cached;
  const counts={selection:{},final:{}},provided={};
  const kinds=Object.keys(baseline.counts);
  for(const stage of stages)for(const kind of kinds) {
    const delta=(resolved.byStage[stage][kind]??0)-(baseline.byStage[stage][kind]??0);
    increment(counts[stage],kind,delta);increment(provided,kind,delta);
  }
  cached={baseline,counts,provided};
  stageDeltas.set(resolved,cached);
  return cached;
}

export function physicalSupportLinks(cards,peak,explain) {
  const plan=peak?.cardTargetPlan;
  if(!plan?.baseline||cards.some(card=>!Array.isArray(card.supportOperations)))return null;
  let key,cache;
  if(!explain) {
    if(!caches.has(plan))caches.set(plan,new Map());
    cache=caches.get(plan);
    key=cards.map(profileId).sort((a,b)=>a-b).join(',');
    if(cache.has(key))return cache.get(key);
  }
  const {resolved,active}=resolveNetwork(cards,plan,rankingWeights(cards),explain);
  const base=baseDeltas(resolved,plan.baseline);
  const counts={selection:{...base.counts.selection},final:{...base.counts.final}},provided={...base.provided};
  const byStage={selection:zero(),final:zero()};
  const resources={hpRecovery:0,pp:0};
  const providers=new Map(), links=[];
  const contribute=(kind,id)=>{if(!id)return;if(!providers.has(kind))providers.set(kind,new Set());providers.get(kind).add(id);};
  for(const card of cards) {
    for(const [kind,n] of Object.entries(card.providedActions??{})) {
      if(Object.hasOwn(plan.baseline.counts,kind))continue;
      const early=card.providedActionsByStage?.selection[kind]??n;
      increment(provided,kind,n);increment(counts.selection,kind,early);increment(counts.final,kind,n-early);
      if(explain&&n)contribute(kind,card.gameId);
    }
  }
  if(explain)for(const action of resolved.actions) {
    if(!action.providerId)continue;
    for(const [kind,n]of Object.entries(action.triggerCounts??{}))if(n>0)contribute(kind,action.providerId);
    if(['acquire','copy','remove'].includes(action.action)){
      for(const key of action.keywords??[])contribute(key+'_card_acquire_8',action.providerId);
      for(const kind of ['exam_15','sp_lesson_20'])contribute(kind,action.providerId);
    }
  }
  const soloUses={};
  for(const [card,acts] of active) {
    const r=card.itemResponse;
    let count=0,early=0;
    for(const a of acts){count+=a.count??1;if(ofStage(a)==='selection')early+=a.count??1;}
    const extra=count-r.routeCount-r.selfCount,earlyExtra=early-r.routeSelection-r.selfSelection;
    if(cards.length===1)Object.assign(soloUses,{count:count-r.routeCount,selection:early-r.routeSelection});
    for(const axis of axes) {
      byStage.selection[axis]+=earlyExtra*r.stats[axis];byStage.final[axis]+=(extra-earlyExtra)*r.stats[axis];
    }
    resources.hpRecovery+=extra*r.resources.hpRecovery;resources.pp+=extra*r.resources.pp;
    const bottles=r.resources.pDrinkAcquisitions;
    increment(provided,'p_drink_acquire',extra*bottles);increment(counts.selection,'p_drink_acquire',earlyExtra*bottles);
    increment(counts.final,'p_drink_acquire',(extra-earlyExtra)*bottles);
    if(explain&&(extra||earlyExtra)) {
      const contributors=[...new Set(acts.map(a=>a.providerId).filter(Boolean))].sort();
      const info={receiverId:card.gameId,kind:r.kind,source:'item',extraCount:extra,extraCountByStage:{selection:earlyExtra,final:extra-earlyExtra},contributors};
      for(const axis of axes)if(r.stats[axis]) links.push({...info,axis,pointsBeforeCap:extra*r.stats[axis],producedDrinks:0});
      if(bottles){links.push({...info,axis:null,pointsBeforeCap:0,producedDrinks:extra*bottles});contribute('p_drink_acquire',card.gameId);}
      for(const op of r.operations) links.push({...info,axis:null,pointsBeforeCap:0,producedDrinks:0,
        producedOperation:op.action,producedOperationCount:resolved.actions.filter(a=>a.providerId===card.gameId&&a.source==='support_item'&&a.action===op.action&&contributors.length&&acts.some(t=>t.providerId&&t.id===a.sourceTriggerId)).length});
    }
  }
  const output={provided,selection:counts.selection,final:counts.final,byStage,resources,providers,links,soloUses,
    ...(explain?{targetResolution:{counts:resolved.counts,byStage:resolved.byStage,actions:resolved.actions,
      unresolved:resolved.unresolved,examDeckSizes:resolved.examDeckSizes,lessonDeckSizes:resolved.lessonDeckSizes},
      operations:resolved.actions.filter(action=>action.providerId),unresolved:resolved.unresolved,examDeckSizes:resolved.examDeckSizes,lessonDeckSizes:resolved.lessonDeckSizes}:{})};
  if(cache){
    if(cache.size>=1024)cache.delete(cache.keys().next().value);cache.set(key,output);
  }
  return output;
}
