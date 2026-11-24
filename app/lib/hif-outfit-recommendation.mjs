import { buildHifOutfitRoutes } from './hif-outfit-routes.mjs';
import { evaluateHifOutfitRoute, evaluateHifOutfitSide, hifOrderPolicies } from './hif-outfit-ledger.mjs';
import { evaluateHifPeakWitness, hifPeakWitnessRequired } from './hif-peak-witness.mjs';

// Live catalog editions are replaced as a unit. Cache only read-only stage
// summaries, never a pointer to an account or a full engine trace.
const editions = new WeakMap();
const stageNames = {selection:'첫 선발',final:'본선 R1',finalR2:'본선 R2'};

// R1's highest score can spend the stamina that R2 needs. Compare the
// linked final for each order, sharing R2 results for equal remaining HP.
function linkedFinal(args, routes, trace, peak) {
  function runArm(active) {
    const check=active && peak && hifPeakWitnessRequired(peak.card);
    const continuations=new Map();
    let best, highest, bothRounds;
    for (const policy of hifOrderPolicies(routes.final)) {
      const r1=evaluateHifOutfitSide({...args,route:routes.final,active,policy,trace:Boolean(check)});
      if (r1.missing) return r1;
      const left=r1.finalState.stamina;
      const max=routes.finalR2.initial.maxStamina;
      const purchases=peak ? Math.min(Math.floor(peak.budget/peak.price),Math.ceil((max-left)/peak.amount)) : 0;
      const stamina=peak ? Math.min(max,left+purchases*peak.amount) : left;
      if (!continuations.has(stamina)) {
        const orders=check ? hifOrderPolicies(routes.finalR2) : [undefined];
        continuations.set(stamina,orders.map(order=>{
          const side=evaluateHifOutfitSide({...args,route:routes.finalR2,active,policy:order,startingStamina:stamina,trace:Boolean(check)});
          return {side,witness:check && !side.missing ? evaluateHifPeakWitness({card:peak.card,stage:'finalR2',side}) : null};
        }));
      }
      const witness1=check ? evaluateHifPeakWitness({card:peak.card,stage:'final',side:r1}) : null;
      for (const {side:r2,witness:witness2} of continuations.get(stamina)) {
        if (r2.missing) return r2;
        const demonstrated=Boolean(witness2?.verified);
        const total=r1.parameter+r2.parameter;
        const entry={total,r1:r1.parameter,r2:r2.parameter,policies:[r1.policy,r2.policy]};
        if (!highest || total>highest.total) highest=entry;
        if (witness1?.verified && demonstrated && (!bothRounds || total>bothRounds.total)) bothRounds=entry;
        if (!best || demonstrated>best.demonstrated || (demonstrated===best.demonstrated && (total>best.total ||
          (total===best.total && r2.finalState.stamina>best.finalR2.finalState.stamina)))) {
          best={final:r1,finalR2:r2,total,demonstrated,witness:check ? {final:witness1,finalR2:witness2} : null,
            interval:{carried:left,spent:purchases*(peak?.price??0),starting:stamina}};
        }
      }
    }
    if (trace) {
      best.final=evaluateHifOutfitSide({...args,route:routes.final,active,policy:best.final.policy,trace});
      best.finalR2=evaluateHifOutfitSide({...args,route:routes.finalR2,active,startingStamina:best.interval.starting,
        policy:best.finalR2.policy,trace});
    }
    return {...best,highest,bothRounds};
  }
  const on=runArm(true),off=runArm(false);
  if (on.missing || off.missing) return {missing:on.missing || off.missing};
  return {witness:on.witness,highest:on.highest,bothRounds:on.bothRounds,interval:{withOutfit:on.interval,withoutOutfit:off.interval},
    ...Object.fromEntries(['final','finalR2'].map(stage=>[stage,{withOutfit:on[stage],withoutOutfit:off[stage],
      marginalParameter:on[stage].parameter-off[stage].parameter}]))};
}

export function compareHifOutfit({catalog,card,skills,item,customizations=[],preparedCards=[],selectedSwitchIds=[],plv,trace=false,peakDeck}) {
  if (!catalog || !Number.isSafeInteger(plv) || plv < 1) {
    return {missing:catalog ? '대표 덱 해금 확인에 필요한 PLv 미입력' : 'H.I.F. 시험·시작 덱 자료 미연결'};
  }
  let cache = editions.get(catalog);
  if (!cache) { cache = new Map(); editions.set(catalog,cache); }
  const key = JSON.stringify([card.gameId,card.specialTrainingRank,card.potentialRank,plv,
    skills.map(s=>[s.id,s.upgradeCount]),item.id,customizations.map(c=>[c.id,c.level]),preparedCards,selectedSwitchIds,Boolean(peakDeck)]);
  if (!trace && cache.has(key)) return cache.get(key);

  const routes = buildHifOutfitRoutes({catalog,card,skills,item,plv,preparedCards,selectedSwitchIds});
  const stages = {}, missing = [];
  const hif=catalog.produceResources?.hif;
  const interval=peakDeck && {card,budget:120,price:hif?.interval?.hpRecoveryPrice,amount:hif?.interval?.hpRecoveryAmount};
  if (interval && (!(interval.price>0) || !(interval.amount>0) || !(hif.publicLessonPP?.final*2+hif.gift?.pp>=interval.budget))) {
    return {stages,rankable:false,missing:'본선 인터벌 회복 가격·확보 P 미확인'};
  }
  if (peakDeck?.missing?.length) missing.push(...peakDeck.missing);
  const finals=routes.final && !routes.final.missing?.length && routes.finalR2 && !routes.finalR2.missing?.length
    ? linkedFinal({plan:card.plan,skills,item,customizations},routes,trace,interval) : {missing:'본선 두 라운드의 연결 경로 미확인'};
  for (const [stage,label] of Object.entries(stageNames)) {
    const route = routes[stage];
    if (!route || route.missing?.length) {
      missing.push(label+' · '+(route?.missing || '운용 경로 미확인'));
      if (trace) stages[stage] = {route};
      continue;
    }
    const comparison = stage==='selection'
      ? evaluateHifOutfitRoute({plan:card.plan,skills:skills.filter(s=>!s.primaStella),item,customizations:[],route,trace})
      : finals[stage] ?? finals;
    if (comparison.missing || !Number.isFinite(comparison.marginalParameter)) {
      missing.push(label+' · '+(comparison.missing || '파라미터 미확인'));
      if (trace) stages[stage] = {route,comparison};
      continue;
    }
    const {withOutfit:on,withoutOutfit:off}=comparison;
    stages[stage] = {turns:route.turnCount,trainingType:route.trainingType,
      on:on.parameter,off:off.parameter,delta:comparison.marginalParameter,
      uniquePlays:on.uniquePlays,uniqueTriggers:on.uniqueTriggers,freePlays:on.freePlays,itemTriggers:on.itemTriggers,
      replays:on.replays,reservationTriggers:on.reservationTriggers,extraActionsSpent:on.extraActionsSpent,recoveredCards:on.recoveredCards,
      offExtraActionsSpent:off.extraActionsSpent,offRecoveredCards:off.recoveredCards,
      policy:{on:on.policy,off:off.policy},
      startStamina:{withOutfit:on.startingStamina,withoutOutfit:off.startingStamina},
      endStamina:{withOutfit:on.finalState.stamina,withoutOutfit:off.finalState.stamina}};
    if (trace) Object.assign(stages[stage],{route,comparison});
  }
  const unobserved = [];
  if (!missing.length) {
    const measurements = [stages.final,stages.finalR2];
    for (const skill of skills) {
      if (measurements.every(s=>!s.uniquePlays[skill.id] && !s.uniqueTriggers[skill.id])) {
        unobserved.push('고유 '+skill.name+' 사용·발동');
      } else if (/再演/.test(skill.text) && measurements.every(s=>!s.replays?.[skill.id])) {
        unobserved.push('고유 '+skill.name+' 제외 후 재연');
      } else if (skill.definition.actions.length && skill.definition.actions.every(group=>group.phase) &&
        measurements.every(s=>!s.reservationTriggers?.[skill.id])) {
        unobserved.push('고유 '+skill.name+' 예약 효과 발동');
      }
    }
    if (measurements.every(s=>!s.itemTriggers)) unobserved.push('P아이템 '+item.name+' 발동');
    for (const stage of ['final','finalR2']) {
      if (stages[stage].on===0) unobserved.push(stageNames[stage]+' 의상 적용 경로의 득점');
    }
    if (unobserved.length) missing.push('본선 대표 운용에서 '+unobserved.join(', ')+' 미확인');
  }
  if (finals.witness && !finals.witness.finalR2.verified) missing.push('R2 완성 덱 운용 미재현 · '+finals.witness.finalR2.missing.join(' · '));
  const result = {stages,unobserved,missing:missing.join(' / '),rankable:!missing.length};
  if (peakDeck) result.peak={plv,training:card.specialTrainingRank,potential:card.potentialRank,
    preparedCards,selectedSwitchIds,requirements:peakDeck.preparationRequirements,sourceUrls:peakDeck.sourceUrls,sourceScope:peakDeck.sourceScope,
    deck:routes.final?.deck,acquisitions:routes.final?.preparation,interval:finals.interval,budget:interval.budget,
    witness:finals.witness??null,highestMeasured:finals.highest,bothRoundsDemonstrated:finals.bothRounds??null,rankValidation:'unverified'};
  if (Number.isFinite(stages.final?.on) && Number.isFinite(stages.finalR2?.on)) {
    result.finalParameter=stages.final.on+stages.finalR2.on;
    result.finalContribution=stages.final.delta+stages.finalR2.delta;
    if (result.rankable) result.value=result.finalParameter;
  }
  if (!trace) {
    if (cache.size>=2048) cache.delete(cache.keys().next().value);
    cache.set(key,result);
  }
  return result;
}
