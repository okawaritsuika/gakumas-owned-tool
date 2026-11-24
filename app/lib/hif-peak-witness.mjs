// These records describe published lines of play. They only decide whether
// the measured path demonstrates a line; no points enter the calculation.
const cases = {
  'i_card-kcna-3-019':{type:'hold',source:'https://note.com/ikatarou_0987/n/n02cb5297474d'},
  'i_card-ttmr-3-007':{type:'entertainment',source:'https://www.youtube.com/watch?v=sdUJwNsZ1TE'},
  'i_card-shro-3-018':{type:'limelight',source:'https://www.reddit.com/r/Gakuenidolmaster/comments/1tsq7bw/'},
};
const nation='p_card-01-men-3_006', entertainment='p_card-01-act-3_049', limelight='p_card-01-act-3_185';
const momentum='p_card-01-act-1_023', wing='p_card-03-act-3_189', trend='p_card-03-act-2_082';
const isUse=e=>['play','freePlay','replay'].includes(e.kind);

export function hifPeakWitnessRequired(card) {
  return Object.hasOwn(cases,card?.gameId);
}

export function evaluateHifPeakWitness({card,stage,side}) {
  const recipe=cases[card?.gameId];
  if (!recipe) return null;
  const missing=[], events=[];
  const trace=side?.trace ?? [];
  const {produceCardId:first,secondProduceCardId:second}=card.uniqueIds;
  function check(label,e,details={}) {
    if (!e) missing.push(label);
    else events.push({turn:e.turn,action:label,id:e.id,parameter:e.parameter,
      ...(e.parameterGain!=null?{gain:e.parameterGain}:{}),...(e.stamina!=null?{hp:e.stamina}:{}),...details});
  }
  const uses=trace.filter(isUse);
  const replay=uses.find(e=>e.kind==='replay' && e.id===first &&
    (recipe.type==='hold' ? e.stance==='fullPower' : e.stamina*5>=side.maxStamina*4));
  if (recipe.type==='hold') {
    check('전력 중 고유 ① 재연',replay);
    const hits=trace.filter((e,index)=>{
      if(e.kind!=='resolvedCard' || ![wing,trend].includes(e.id) || e.parameterGain<=0 || e.stance!=='fullPower') return false;
      const prior=trace.slice(0,index);
      const use=prior.findLast(isUse);
      if (!use?.extraAction || use.id!==e.id || use.turn!==e.turn) return false;
      const move=prior.findLast(x=>x.kind==='recovery' && x.slot===e.slot);
      return move?.turn===e.turn && move.by===second && !prior.slice(prior.indexOf(move)+1,prior.indexOf(use)).some(x=>isUse(x) && x.slot===e.slot);
    });
    check('고유 ②가 보류에서 회수한 공격을 추가 행동으로 사용해 득점',hits[0]);
    const recycled=trace.find(e=>e.kind==='moveToTop' && e.id===second &&
      [card.uniqueIds.beforeProduceItemId,card.uniqueIds.afterProduceItemId].includes(e.by));
    const redrawn=recycled && trace.slice(trace.indexOf(recycled)+1).find(e=>e.kind==='draw' && e.id===second);
    const reused=redrawn && uses.find(e=>e.id===second && trace.indexOf(e)>trace.indexOf(redrawn));
    check('아이템으로 덱 위에 돌린 ②를 다시 뽑아 사용',reused);
    const repeatHit=reused && hits.find(e=>e!==hits[0] && trace.indexOf(e)>trace.indexOf(reused) &&
      trace.slice(trace.indexOf(reused),trace.indexOf(e)).some(x=>x.kind==='recovery' && x.by===second && x.slot===e.slot));
    check('다시 쓴 ②로 회수한 공격에서 추가 득점 반복',repeatHit);
  } else {
    const target=recipe.type==='entertainment'?entertainment:limelight;
    const doubled=uses.find((e,i)=>{
      if (uses[i-1]?.id!==nation || e.id!==target) return false;
      const start=trace.indexOf(e), end=trace.slice(start+1).findIndex(x=>x.kind==='afterPlay' && x.id===target);
      return end>=0 && trace.slice(start+1,start+1+end).filter(x=>x.kind==='resolvedCard' && x.id===target).length===2;
    });
    check(recipe.type==='entertainment'?'국민적 아이돌로 지고의 엔터테인먼트 두 번 적용':'국민적 아이돌로 각광 두 번 적용',doubled);
    const later=doubled ? trace.slice(trace.indexOf(doubled)+1) : [];
    // Both installed copies must score off the same later action.
    const procs=later.filter(e=>e.kind==='reservation' && e.id===target && e.parameterGain>0 && e.phaseEvent!=null);
    const both=procs.find((e,i)=>i>0 && procs[i-1].phaseEvent===e.phaseEvent);
    const hits=both && [procs[procs.indexOf(both)-1].parameterGain,both.parameterGain];
    check('후속 사용 한 번에서 두 예약의 파라미터 득점',both,hits?{hits,gain:hits[0]+hits[1]}:{});
    if (recipe.type==='entertainment') {
      check('기세에 맡겨 사용으로 고유 아이템 발동',trace.find(e=>e.kind==='itemTrigger' && e.triggerCardId===momentum));
      const end=trace.findLast(e=>e.kind==='turnEnd');
      check('마지막 턴에 고유 집중 비례 타격',
        trace.find(e=>e.kind==='reservation' && e.id===first && e.turn===end?.turn && e.parameterGain>0 && e.concentration>0));
    } else {
      check('고유 ②로 체력 회복 후 80% 유지',trace.find(e=>e.kind==='resolvedCard' && e.id===second && e.staminaGain>0 && e.stamina*5>=side.maxStamina*4));
      check('체력 80% 이상에서 고유 ① 재연',replay);
      const extra=uses.find(e=>e.extraAction && trace.slice(0,trace.indexOf(e)).some(x=>x.kind==='itemTrigger' &&
        x.turn===e.turn && [first,second].includes(x.triggerCardId) && x.stamina*5>=side.maxStamina*4));
      check('고유 아이템 발동 턴에 추가 행동 소비',extra);
    }
  }
  return {verified:missing.length===0,stage,source:recipe.source,missing,events};
}
