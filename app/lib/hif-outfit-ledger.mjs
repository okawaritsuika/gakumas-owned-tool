import StageEngine from './vendor/gakumas-engine/engine/StageEngine.js';
import SkillCards from './vendor/gakumas-data/data/skillCards.js';
import { DEFAULT_EFFECTS, G, PHASES, RARITIES, S, SKILL_CARD_TYPES, SOURCE_TYPES, STANCES } from './vendor/gakumas-engine/constants.js';
import { withRand } from './vendor/gakumas-engine/utils.js';

const fail = message => { throw new Error(message); };
const attributes = ['conditions','cost','actions','effects'];
const number = value => ({type:'number',value});
const variable = name => ({type:'identifier',name});
const goalFields=new Set(['genki','motivation','stamina','concentration','goodImpressionTurns','goodConditionTurns',
  'fullPowerCharge','cumulativeFullPowerCharge','heldCount','stance','staminaRatio']);
const compare={ '<':(a,b)=>a<b, '<=':(a,b)=>a<=b, '==':(a,b)=>a===b, '!=':(a,b)=>a!==b, '>=':(a,b)=>a>=b, '>':(a,b)=>a>b };

function compileSkill(row, options) {
  if (row?.mechanics) fail(row.id+' 추가 원본 동작 '+row.mechanics.kind+'의 실행 미지원');
  const source = row?.definition;
  if (!source || !attributes.every(key=>Array.isArray(source[key]))) fail((row?.id ?? '스킬')+' 효과 정의');
  const publicCard = Number.isInteger(source.id) && SkillCards.getById(source.id);
  if (!publicCard) fail(row.id+' 공개 엔진 스킬 ID 연결 필요');
  const d={...source};
  for (const option of options) {
    const level=option.level ?? 1;
    if (!row.customizationIds?.includes(option.id) || !option.levels?.some(l=>l.level===level) || !option.patches) fail(option.id+' 개조 정의');
    for (const attr of attributes) {
      const groups=d[attr].slice();
      for (const patch of option.patches[attr] ?? []) {
        if ((patch.level ?? 1)!==level) continue;
        if (patch.op==='append') groups.push(patch.effect);
        else {
          const i=groups.findIndex(g=>g.anchor===patch.anchor);
          if (i<0 || patch.op!=='patch') fail(option.id+' 개조 대상');
          groups[i]={...groups[i],...patch.delta};
        }
      }
      d[attr]=groups;
    }
    if (option.patches.forceInitialHand) d.forceInitialHand=true;
    if (String(option.patches.limit)==='0') d.liftLimit=true;
  }
  // Some public replay definitions carry the lesson cap alone. The original
  // card text independently specifies once per turn. Keep the direct-gain
  // counter and this turn marker in different slots on the same source.
  if (/再演[\s\S]*ターン内1回/.test(row.text)) {
    const turn={type:'binary',op:'+',left:variable('turnsElapsed'),right:number(1)};
    d.effects=d.effects.map(g=>{
      if (!g.actions?.some(a=>a.name==='useRandomCardFree')) return g;
      const key='outfitReplayTurn';
      return {...g,conditions:[...(g.conditions ?? []),{type:'comparison',op:'!=',
        left:{type:'call',name:'effectCounter',args:[variable(key)]},right:turn}],
        actions:[{type:'assignment',lhs:'effectCounter',lhsName:key,op:'=',rhs:turn},...g.actions]};
    });
  }
  return {row, d, publicCard};
}

function prepare({skills,item,customizations,route}) {
  if (!route || !Number.isSafeInteger(route.turnCount) || route.turnCount<1 || !route.deck?.length) fail('대표 경로 덱·턴 수');
  if (Array.isArray(route.missing) ? route.missing.length : route.missing) fail(String(route.missing));
  if (!skills?.length || !item?.definition?.effects?.length) fail('고유 스킬·P아이템 효과 정의');
  if (item.mechanics) fail(item.id+' 추가 원본 동작 '+item.mechanics.kind);
  const owned=new Set(skills.map(r=>r.id));
  for (const option of customizations) if (!owned.has(option.skillId)) fail(option.id+' 개조 대상 스킬');
  const rows=new Map(), ids=new Map();
  for (const row of [...(route.cards ?? []),...skills]) {
    const compiled=compileSkill(row,customizations.filter(o=>o.skillId===row.id));
    rows.set(row.id,compiled);
    ids.set(compiled.d.id,row.id);
  }
  for (const id of route.deck) if (!rows.has(id)) fail('경로 카드 정의 '+id);
  for (const id of owned) if (!route.deck.includes(id)) fail('경로 덱에서 빠진 고유 스킬 '+id);
  for (const goal of route.goalPriorities ?? []) {
    const {field,op,value}=goal.condition ?? {};
    if (!goalFields.has(field) || !Object.hasOwn(compare,op) || !Array.isArray(goal.order) ||
      (field==='stance' ? !['==','!='].includes(op) || !STANCES.includes(value) : !Number.isFinite(value))) fail('경로 행동 우선순위 조건 '+field);
    if ([goal.first,goal.last].some(x=>x!=null && (!Number.isInteger(x) || x<1)) ||
      (goal.first ?? 1)>(goal.last ?? Infinity)) fail('경로 행동 우선순위 턴 범위');
  }
  return {rows,ids,owned};
}

function installCards(engine, context, slots, active) {
  const cm=engine.cardManager;
  const byId=new Map([...context.rows.values()].map(e=>[e.d.id,e]));
  const disabled=i=>!active && context.owned.has(slots[i]);
  // The vendor caches card profiles by public ID globally. Each run can have
  // different native repairs, customizations and inactive slots, so keep
  // this particular engine's derived profiles local to its own cards.
  const profiles=new Map();
  cm.profileOf=(state,i)=>{
    const id=state[S.cardMap][i].id, key=disabled(i) ? -id : id;
    if (!profiles.has(key)) profiles.set(key,{lines:{},conditions:null,costActions:null,effectNames:null,costNames:null,
      forceInitialHand:byId.get(id)?.d.forceInitialHand ?? null,c11nNoLimit:byId.get(id)?.d.liftLimit ?? null});
    return profiles.get(key);
  };
  const compute=cm.computeLines.bind(cm), lines=cm.getLines.bind(cm);
  cm.computeLines=(entry,attr)=>byId.get(entry.id)?.d[attr] ?? compute(entry,attr);
  cm.getLines=(state,i,attr)=>disabled(i) ? [] : lines(state,i,attr);
  const targets=cm.getTargetRuleCards.bind(cm);
  cm.getTargetRuleCards=(state,rule,source)=>{
    const result=targets(state,rule,source);
    if (!active) for (const i of result) if (disabled(i)) result.delete(i);
    return result;
  };
  return disabled;
}

// The backend otherwise warns only if a line actually fires. Check all
// branches of the selected definitions before interpreting an unused line as
// a known, untriggered effect.
const constants=new Set([...PHASES,...RARITIES,...SKILL_CARD_TYPES,...SOURCE_TYPES,...STANCES]);
const piles=new Set(['all','this','deck','discarded','removed','held','hand','basic','pIdol',...SKILL_CARD_TYPES,...RARITIES]);
function checkTarget(t) {
  if (!t || t.type==='number') return;
  if (typeof t==='string' && (piles.has(t) || /^\d+$/.test(t))) return;
  if (t.type==='identifier' && piles.has(t.name)) return;
  if (t.type==='call' && ['id','baseId','cost','effect'].includes(t.name)) return;
  if (t.type==='binary' && ['&','|'].includes(t.op)) {checkTarget(t.left);checkTarget(t.right);return;}
  if (t.type==='unary' && t.op==='!') {checkTarget(t.operand);return;}
  fail('미지원 카드 대상 '+(t.name ?? t.op ?? t.type));
}
function checkExpression(n,engine) {
  if (!n || n.type==='number') return;
  if (n.type==='identifier' && (n.name in S || n.name in engine.evaluator.variableResolvers || constants.has(n.name))) return;
  if (n.type==='call' && n.name in engine.evaluator.variableResolvers) {
    checkTarget(n.target);
    // DSL identifier arguments here are literal effect/counter names.
    for (const arg of n.args ?? []) if (arg.type!=='identifier') checkExpression(arg,engine);
    return;
  }
  if (['binary','comparison'].includes(n.type)) {checkExpression(n.left,engine);checkExpression(n.right,engine);return;}
  if (n.type==='unary') {checkExpression(n.operand,engine);return;}
  fail('미지원 효과 식 '+(n.name ?? n.type));
}
function checkGroups(groups,engine) {
  for (const g of groups) {
    if (g.phase && !PHASES.includes(g.phase)) fail('미지원 발동 시점 '+g.phase);
    checkTarget(g.filter);
    for (const t of g.targets ?? []) checkTarget(t);
    for (const n of g.conditions ?? []) checkExpression(n,engine);
    for (const a of g.actions ?? []) {
      if (a.type==='assignment') {
        if (!(a.lhs in S || a.lhs in G || a.lhs in engine.executor.intermediateResolvers || a.lhs==='effectCounter')) fail('미지원 효과 수치 '+a.lhs);
        checkExpression(a.rhs,engine);
      } else if (!['call','identifier'].includes(a.type) || !(a.name in engine.executor.specialActions)) fail('미지원 효과 동작 '+a.name);
      checkTarget(a.target);
      for (const arg of a.args ?? []) if (arg.type!=='identifier') checkExpression(arg,engine);
    }
    checkGroups(g.effects ?? [],engine);
  }
}

function runSide({plan,skills,item,route,trace,startingStamina}, ctx, active, policy) {
  const initial={...route.initial}, maxStamina=initial.maxStamina ?? initial.stamina ?? 30;
  const carry=startingStamina?.[active?'withOutfit':'withoutOutfit'];
  if(carry!=null){
    if(!Number.isFinite(carry) || carry<0 || carry>maxStamina) fail('본선 이전 라운드 종료 체력');
    initial.stamina=carry;
  }
  const stage={type:'custom',turnCount:route.turnCount,effects:[]};
  // A compressed remaining deck has no fictitious cards taking draw/hand
  // slots. Preserve every non-unique card and its relative order. A supplied
  // R2 stage effect still pads the actual resulting deck on each side.
  // Fixed effect-isolation fixtures explicitly compare identical draw slots.
  const slots=!active && route.preferBestOrder ? route.deck.filter(id=>!ctx.owned.has(id)) : route.deck;
  const cards=slots.map(id=>({id:ctx.rows.get(id).d.id}));
  const config={stage,idol:{plan,params:{stamina:maxStamina},cards,pItemIds:[]},defaultCardIds:[],
    generatedBasicCardIds:route.generatedBasicCardIds ?? cards.filter((r,i)=>!ctx.owned.has(slots[i]) && SkillCards.getById(r.id).name.includes('基本')).map(r=>r.id),
    typeMultipliers:{vocal:1,dance:1,visual:1}};
  const engine=new StageEngine(config), cm=engine.cardManager, em=engine.effectManager;
  if (active) {
    for (const {d} of ctx.rows.values()) for (const attr of attributes) checkGroups(d[attr],engine);
    checkGroups(item.definition.effects,engine);
    checkGroups(route.stageEffects ?? [],engine);
  }
  engine.turnManager.generateTurnTypes=()=>Array.from({length:route.turnCount},(_,i)=>['vocal','dance','visual'][i%3]);
  const disabled=installCards(engine,ctx,slots,active);
  const nativeId=(s,i)=>{
    const card=s[S.cardMap][i], original=ctx.rows.get(slots[i]);
    const exact=ctx.ids.get(card?.id);
    if (exact) return exact;
    if (original && (original.row.publicBaseId ?? original.publicCard.id)===card?.baseId) return original.row.id;
    return String(card?.id);
  };
  const rank=(order,id)=>{const i=order.indexOf(id);return i<0 ? Infinity : i;};
  // Put a documented copy pair in the intended compressed draw order. The
  // original force-in-hand rule, draw limits, costs and R2 padding still run.
  const copy=policy.startsWith('copy-') && [...ctx.rows.values()].find(r=>r.d.actions.some(g=>!g.phase &&
    g.actions?.some(a=>a.lhs==='doubleCardEffectCards' && a.op==='+=')));
  const copyId=copy?.row?.id, target=route.copyTargetId;
  const moodSetup=copy ? [...ctx.rows.values()].filter(r=>r.d.actions.some(g=>!g.phase && !g.conditions?.length &&
    g.actions?.some(a=>a.lhs==='goodConditionTurns' && a.op==='+=' && a.rhs?.value>=2))).map(r=>r.row.id) : [];
  const pairOrder=copy?[copyId,target]:[];
  const orderFor=(s)=>{
    const turn=s[S.turnsElapsed]+1, key=Array.isArray(route.turnPriorities) ? turn-1 : turn;
    const goals=[];
    for (const g of route.goalPriorities ?? []) {
      if (turn<(g.first ?? 1) || turn>(g.last ?? Infinity)) continue;
      const {field,op,value}=g.condition;
      const current=field==='heldCount' ? s[S.heldCards].filter(i=>!disabled(i)).length :
        field==='staminaRatio' ? s[S.stamina]/maxStamina : s[S[field]];
      if (compare[op](current,value)) goals.push(...g.order);
    }
    return [...goals,...(route.turnPriorities?.[key] ?? []),...(route.priority ?? []),...slots];
  };
  const pick=(s,indices,num=1)=>{
    const order=orderFor(s);
    return indices.map((card,index)=>({card,index})).filter(x=>!disabled(x.card))
      .sort((a,b)=>rank(order,nativeId(s,a.card))-rank(order,nativeId(s,b.card))).slice(0,num).map(x=>x.index);
  };
  engine.strategy={pickCardsToMoveToHand:pick,pickCardsToHold:pick,pickCardsToUseFree:pick,pickCardsToMoveToTopOfDeck:pick};
  cm.recycleDiscards=s=>{
    const order=copy?[...pairOrder,...(route.redrawOrder??slots)]:(route.redrawOrder ?? slots);
    s[S.deckCards]=s[S.discardedCards].slice().sort((a,b)=>rank(order,nativeId(s,a))-rank(order,nativeId(s,b)) || a-b).reverse();
    s[S.discardedCards]=[];
  };
  const s=engine.getInitialState(true);
  s[S.deckCards]=cards.map((_,i)=>i).sort((a,b)=>Number(cm.isForceInitialHand(s,b))-Number(cm.isForceInitialHand(s,a)) || a-b).reverse();
  for (const [key,value] of Object.entries(initial)) {
    if (key==='maxStamina') continue;
    if (!['stamina','genki','motivation','goodConditionTurns','concentration','goodImpressionTurns','enthusiasm','fullPowerCharge'].includes(key) ||
      !Number.isFinite(value) || value<0) fail('확인되지 않은 시작 상태 '+key);
    s[S[key]]=value;
  }
  em.setEffects(s,DEFAULT_EFFECTS);
  s[S.effectInstanceId]++;
  if(route.stageEffects?.length){
    em.setEffects(s,route.stageEffects,{type:'stage',primary:true});
    s[S.effectInstanceId]++;
  }
  const counterOnly=g=>Boolean(g.actions?.length && g.actions.every(a=>a.lhs==='effectCounter') && !g.effects?.length);
  if (active) {
    for (const [index,g] of item.definition.effects.entries()) {
      em.setEffects(s,[g],{type:'pItem',id:item.id,index,primary:true,counterOnly:counterOnly(g)});
    }
    s[S.effectInstanceId]++;
  }
  for (const [i,entry] of s[S.cardMap].entries()) {
    const groups=cm.getLines(s,i,'effects');
    for (const [index,g] of groups.entries()) em.setEffects(s,[g],{
      type:'skillCard',id:entry.id,idx:i,index,primary:true,counterOnly:counterOnly(g)});
    if (groups.length) s[S.effectInstanceId]++;
  }

  const uniquePlays=Object.fromEntries(skills.map(r=>[r.id,0])), freePlays={...uniquePlays}, uniqueTriggers={...uniquePlays};
  const replays={}, recoveredCards={}, reservationTriggers={...uniquePlays};
  const register=em.setEffects.bind(em);
  em.setEffects=(state,groups,source)=>{
    if(source?.type!=='skillCardEffect') return register(state,groups,source);
    for(const group of groups) register(state,[group],{...source,counterOnly:counterOnly(group)});
  };
  const events=[], frames=[], plays=[], sources=[];
  let itemTriggers=0, turn=0, primaryUses=0, extraActionsSpent=0, openingDeckCount=slots.length, phaseNumber=0;
  let pairInstalled=false;
  const snapshot=()=>({parameter:s[S.score],stamina:s[S.stamina],genki:s[S.genki],motivation:s[S.motivation],
    goodConditionTurns:s[S.goodConditionTurns],concentration:s[S.concentration],cumulativeFullPowerCharge:s[S.cumulativeFullPowerCharge],
    fullPowerCharge:s[S.fullPowerCharge],stance:s[S.stance],cardsUsed:s[S.turnCardsUsed],
    held:s[S.heldCards].filter(i=>!disabled(i)).map(i=>nativeId(s,i)),
    uses:s[S.cardUsesRemaining],hand:s[S.handCards].filter(i=>!disabled(i)).map(i=>nativeId(s,i))});
  const emit=(kind,detail={})=>{if(trace) events.push({turn,kind,...detail,...snapshot()});};
  const phase=em.triggerEffectsForPhase.bind(em);
  em.triggerEffectsForPhase=(state,name,...rest)=>{
    if (name==='cardMovedToHand' && disabled(state[S.movedCard])) return;
    if(name==='cardMovedToHand' && recovering?.cards.delete(state[S.movedCard])){
      const id=nativeId(state,state[S.movedCard]);
      recoveredCards[id]=(recoveredCards[id]??0)+1;
      emit('recovery',{id,slot:state[S.movedCard],by:recovering.by});
    }
    frames.push({item:false,skills:new Set(),number:++phaseNumber});
    try {
      const result=phase(state,name,...rest);
      if (policy==='prepared-draw' && name==='afterStartOfStage') {
        // A second legal opening in the compressed-deck benchmark. Preserve
        // every added basic and its own order behind the prepared cards.
        state[S.deckCards].sort((a,b)=>Number(cm.isForceInitialHand(state,a))-Number(cm.isForceInitialHand(state,b)) ||
          Number(a<slots.length)-Number(b<slots.length) || (a<slots.length && b<slots.length ? b-a : 0));
      }
      if (copy && name==='afterStartOfStage') {
        const drawn=state[S.deckCards].slice().reverse();
        const forced=drawn.filter(i=>cm.isForceInitialHand(state,i));
        const extras=drawn.filter(i=>!forced.includes(i));
        const pair=pairOrder.map(id=>extras.find(i=>nativeId(state,i)===id));
        if (pair.every(i=>i!=null)) {
          const rest=extras.filter(i=>!pair.includes(i)).sort((a,b)=>
            Number(moodSetup.includes(nativeId(state,b)))-Number(moodSetup.includes(nativeId(state,a))));
          const lead=Math.max(0,Number(policy.slice(5))-forced.length);
          state[S.deckCards]=[...forced,...rest.slice(0,lead),...pair,...rest.slice(lead)].reverse();
        }
      }
      return result;
    } finally {frames.pop();}
  };
  const use=cm.useCard.bind(cm);
  // The vendor resolves a doubled card twice within one use. Count those
  // resolutions, including installations that only pay off on later cards.
  if(trace) {
    const resolve=em.triggerEffects.bind(em);
    em.triggerEffects=(state,groups,conditions,card,...rest)=>{
      if (card==null || state[S.phase]!=='processCard') return resolve(state,groups,conditions,card,...rest);
      const score=state[S.score], hp=state[S.stamina];
      const result=resolve(state,groups,conditions,card,...rest);
      emit('resolvedCard',{id:nativeId(state,card),slot:card,parameterGain:state[S.score]-score,staminaGain:state[S.stamina]-hp});
      return result;
    };
  }
  // The ordinary move-to-hand log also fires for deck/discard searches.
  // Collect only the indices still in hold immediately before this recovery.
  const recover=cm.moveHeldCardsToHand.bind(cm);
  let recovering=null;
  cm.moveHeldCardsToHand=state=>{
    const previous=recovering;
    recovering={cards:new Set(state[S.heldCards]),by:state[S.phase]==='processCard' && state[S.usedCard]!=null
      ? nativeId(state,state[S.usedCard]) : null};
    try {return recover(state);} finally {recovering=previous;}
  };
  cm.useCard=(state,i,pile)=>{
    if (disabled(i)) return;
    const id=nativeId(state,i), free=state[S.freeCardUses]>0, removed=pile===S.removedCards;
    const usable=!free || cm.getConditions(state,i).every(c=>engine.evaluator.evaluateCondition(state,c));
    if (copy && usable && id===target && state[S.doubleCardEffectCards]>0) pairInstalled=true;
    if (usable && ctx.owned.has(id)) {uniquePlays[id]++; if(free) freePlays[id]++;}
    const normal=usable && !free && state[S.paidCardUses]===0;
    const extraAction=normal && primaryUses>0;
    if(normal) primaryUses++;
    if(extraAction) extraActionsSpent++;
    if(usable && free && removed) replays[id]=(replays[id]??0)+1;
    emit(!usable ? 'conditionSkipped' : free && removed ? 'replay' : free ? 'freePlay' : 'play',{id,slot:i,extraAction});
    const previous=state[S.usedCard];
    plays.push(id);
    try {use(state,i,pile);} finally {
      plays.pop();
      if ((free || state[S.paidCardUses]>0) && previous!=null) state[S.usedCard]=previous;
    }
  };
  engine.logger.log=(state,kind,data={})=>{
    if(kind==='startTurn'){
      turn=data.num;
      if(turn===1) openingDeckCount=state[S.deckCards].length;
      primaryUses=0;emit('turnStart');return;
    }
    if(kind==='holdCard') emit('held',{id:ctx.ids.get(data.id)??String(data.id)});
    if(trace && kind==='entityStart') sources.push({entityId:data.id,draws:0,additionalUses:0,genkiChange:0,staminaChange:0,parameterGain:0});
    const origin=trace && sources.at(-1);
    if(kind==='entityStart' && data.type==='skillCardEffect' && !data.counterOnly){
      const id=ctx.ids.get(data.id);
      if(ctx.owned.has(id)) reservationTriggers[id]++;
    }
    if(kind==='entityStart' && data.type==='skillCard' && data.primary && !data.counterOnly) {
      const id=nativeId(state,data.idx), f=frames.at(-1);
      if(ctx.owned.has(id) && !f?.skills.has(id)) {
        uniqueTriggers[id]++; f?.skills.add(id); emit('uniqueTrigger',{id,phase:state[S.phase]});
      }
    }
    if(kind==='entityStart' && data.type==='pItem' && data.primary && !data.counterOnly){
      const f=frames.at(-1);
      if (!f?.item) {
        itemTriggers++; if(f)f.item=true;
        if (f) f.activation=itemTriggers;
        emit('itemTrigger',{id:item.id,activation:itemTriggers,phase:state[S.phase],triggerCardId:state[S.usedCard]==null?null:nativeId(state,state[S.usedCard])});
      }
      if (origin) origin.activation=f?.activation ?? itemTriggers;
    }
    if (!trace) return;
    if (kind==='diff' && origin) {
      const key=({[S.cardUsesRemaining]:'additionalUses',[S.genki]:'genkiChange',[S.stamina]:'staminaChange',[S.score]:'parameterGain'})[data.field];
      if (key) origin[key]+=data.next-data.prev;
    }
    // A normal use may automatically start the next turn before useCard
    // returns. The entity-end event is the actual pre-next-turn snapshot.
    if (kind==='entityEnd' && data.type==='skillCard' && !data.primary && data.idx==null) emit('afterPlay',{id:plays.at(-1)});
    if (kind==='entityEnd' && (data.type==='pItem' || data.type==='skillCard' && data.primary)) {
      const counter=state[S.effectCounters][state[S.currentEffectInstanceId]]?.main;
      emit('afterEffect',{source:data.type,id:ctx.ids.get(data.id) ?? data.id,phase:state[S.phase],counter,...origin});
    }
    if (kind==='drawCard') {
      if (origin) origin.draws++;
      emit('draw',{id:ctx.ids.get(data.id) ?? String(data.id)});
    }
    if (kind==='addCardToTopOfDeck') emit('addToTop',{id:ctx.ids.get(data.id) ?? String(data.id)});
    if (kind==='moveCardToTopOfDeck') emit('moveToTop',{id:ctx.ids.get(data.id) ?? String(data.id),
      slot:state[S.movedCard],by:origin?.entityId});
    if (kind==='entityEnd' && data.type==='skillCardEffect') emit('reservation',{id:ctx.ids.get(data.id) ?? data.id,phase:state[S.phase],
      phaseEvent:frames.at(-1)?.number,triggerCardId:state[S.usedCard]==null?null:nativeId(state,state[S.usedCard]),...origin});
    if (kind==='entityEnd') sources.pop();
  };
  // The turn engine emits source boundaries even with expensive per-action
  // diff snapshots disabled. The ledger captures the selected events above.
  engine.logger.enable=()=>{engine.logger.disabled=!trace;};
  engine.logger.pushGraphData=state=>{if(turn) emit('turnEnd',{completed:state[S.turnsElapsed]});};
  engine.startStage(s);
  let decisions=0;
  while (s[S.turnsRemaining]>0) {
    if (++decisions>1200) fail('대표 경로 행동이 종료되지 않음');
    const order=orderFor(s);
    const available=s[S.cardUsesRemaining]>0 ? s[S.handCards].filter(i=>{
      if (disabled(i)) return false;
      if (SkillCards.getById(s[S.cardMap][i].id).type==='trouble' && !order.includes(nativeId(s,i))) return false;
      const window=policy==='prepared' && route.playWindows?.[nativeId(s,i)];
      return (!window || turn>=(window.first ?? 1) && turn<=(window.last ?? Infinity)) && cm.isCardUsable(s,i);
    }) : [];
    available.sort((a,b)=>rank(order,nativeId(s,a))-rank(order,nativeId(s,b)));
    let chosen;
    if (copy && !pairInstalled) {
      const heldTarget=available.find(i=>nativeId(s,i)===target);
      const heldCopy=available.find(i=>nativeId(s,i)===copyId);
      // The copying card itself can consume a good-condition turn. Test
      // the target's actual cost after that purchase before starting a pair.
      if (heldTarget!=null && s[S.doubleCardEffectCards]>0) chosen=heldTarget;
      else if (heldCopy!=null && heldTarget!=null) {
        const cost=id=>cm.getCostActions(s,id).filter(a=>a.lhs==='goodConditionTurns' && a.op==='-=')
          .reduce((n,a)=>n+engine.evaluator.evaluateExpression(s,a.rhs),0);
        if (s[S.goodConditionTurns]>=cost(heldCopy)+cost(heldTarget)) chosen=heldCopy;
      }
      if(chosen==null) {
        const others=available.filter(i=>![copyId,target].includes(nativeId(s,i)));
        const setup=others.find(i=>moodSetup.includes(nativeId(s,i)) && s[S.goodConditionTurns]<3);
        chosen=setup??chooseOrder(others,'attack');
      }
    } else chosen=policy==='prepared' ? available[0] : chooseOrder(available,policy==='prepared-draw'?'cycle':policy);
    if (chosen!=null) cm.useCard(s,chosen);
    else engine.turnManager.endTurn(s);
  }
  const parameter=s[S.score];
  if (!Number.isFinite(parameter)) fail('정규화 파라미터 계산 불가');
  const unusedSkills=active ? Object.keys(uniquePlays).filter(id=>!uniquePlays[id]) : [];
  return {parameter,policy,maxStamina,initialDeckCount:slots.length,openingDeckCount,uniquePlays,freePlays,uniqueTriggers,reservationTriggers,itemTriggers,unusedSkills,replays,recoveredCards,extraActionsSpent,
    startingStamina:initial.stamina??maxStamina,finalState:snapshot(),...(trace?{trace:events}:{})};

  // Compare a small, fixed family of legal play orders. Only the actual
  // terminal score chooses the winning path; priority flags are not points.
  function chooseOrder(indices,mode) {
    let best, bestKey;
    for(const i of indices){
      const groups=cm.getLines(s,i,'actions').filter(g=>!g.phase && !g.targets?.length &&
        (g.conditions??[]).every(c=>engine.evaluator.evaluateCondition(s,c)));
      const actions=groups.flatMap(g=>g.actions??[]);
      const gain=field=>actions.filter(a=>a.lhs===field && a.op==='+=')
        .reduce((n,a)=>n+engine.evaluator.evaluateExpression(s,a.rhs),0);
      const damage=gain('score'), more=gain('cardUsesRemaining');
      const recovery=actions.some(a=>a.name==='moveHeldCardsToHand');
      const held=s[S.heldCards].some(index=>!disabled(index));
      const draw=actions.some(a=>a.name==='drawCard' || a.name==='drawCards');
      const repeat=cm.getLines(s,i,'effects').some(g=>g.actions?.some(a=>a.name==='useRandomCardFree'));
      const full=s[S.stance]==='fullPower';
      // Returning held attacks off stance or with no attack to recover costs
      // stamina. On a spare action a recovery is still legal in the other
      // policies. Do not spend the following rounds' carried HP for an empty hand.
      if(mode==='cycle' && recovery && (!held || !full) && !damage && !draw) continue;
      const effectiveExtra=more>0 && (!recovery || held || indices.length>1);
      const key=mode==='cycle'
        ? [Number(repeat && more>0),Number(full && damage>0 && s[S.cardUsesRemaining]>1),
          Number(effectiveExtra),Number(full && damage>0),Number(draw && indices.length===1 && s[S.cardUsesRemaining]>1)]
        : [Number(effectiveExtra && !recovery),Number(damage>0),damage,Number(effectiveExtra)];
      const different=bestKey ? key.findIndex((v,j)=>v!==bestKey[j]) : -1;
      if(!bestKey || different>=0 && key[different]>bestKey[different]){
        best=i;bestKey=key;
      }
    }
    return best;
  }
}

export function hifOrderPolicies(route) {
  if (!route?.preferBestOrder) return ['prepared'];
  const policies=['prepared','cycle','attack'];
  if (route.stage==='finalR2' && route.preparation?.filter(p=>p.source==='selected_memory').length===4) policies.push('prepared-draw');
  if (route.copyTargetId) policies.push('copy-3','copy-4','copy-6');
  return policies;
}

function runBest(args,ctx,active,policy) {
  const policies=policy ? [policy] : hifOrderPolicies(args.route);
  if(policy && !hifOrderPolicies(args.route).includes(policy)) fail('미지원 대표 운용 '+policy);
  const simulate=(order,trace)=>withRand(args.route.seed??137,()=>runSide({...args,trace},ctx,active,order));
  let best;
  for(const order of policies){
    const candidate=simulate(order,args.trace && policies.length===1);
    if(!best || candidate.parameter>best.parameter ||
      candidate.parameter===best.parameter && candidate.finalState.stamina>best.finalState.stamina) best=candidate;
  }
  return args.trace && policies.length>1 ? simulate(best.policy,true) : best;
}

// Vendor warnings signal an unsupported DSL primitive. Runs are strictly
// synchronous and restore the process hooks and random stream on failure.
function checkWarnings(callback) {
  const warn=console.warn;
  try {
    console.warn=(message,...args)=>fail([message,...args].map(String).join(' '));
    return callback();
  } finally {console.warn=warn;}
}

export function evaluateHifOutfitSide({plan,skills=[],item,customizations=[],route,trace=false,startingStamina,active=true,policy}={}) {
  try {
    const ctx=prepare({skills,item,customizations,route});
    return checkWarnings(()=>runBest({plan,skills,item,route,trace,
      startingStamina:{[active?'withOutfit':'withoutOutfit']:startingStamina}},ctx,active,policy));
  } catch(error) { return {missing:error.message}; }
}

/** Same external deck and normalized multiplier. Representative comparisons
 * deal the remaining external cards on the side without outfit skills. */
export function evaluateHifOutfitRoute({plan,skills=[],item,customizations=[],route,trace=false,startingStamina}={}) {
  try {
    const ctx=prepare({skills,item,customizations,route});
    const args={plan,skills,item,route,trace,startingStamina};
    return checkWarnings(()=>{
      const withOutfit=runBest(args,ctx,true), withoutOutfit=runBest(args,ctx,false);
      return {withOutfit,withoutOutfit,marginalParameter:withOutfit.parameter-withoutOutfit.parameter,missing:''};
    });
  } catch(error) {
    return {withOutfit:null,withoutOutfit:null,marginalParameter:null,missing:error.message};
  }
}
