import {Customizations,PItems,SkillCards} from './vendor/gakumas-data/index.js';
import CardManager from './vendor/gakumas-engine/engine/CardManager/index.js';

// These are ordinary acquisitions by role in the bundled H.I.F. guides.
// Each column is one acquisition opportunity with lower-PLv alternatives.
// They choose a legal deck and never provide numerical outfit bonuses.
const roleCards = {
  goodConditionTurns: [
    ['スポットライト','始まりの合図','楽観的'],['シュプレヒコール','楽観的'],
    ['話題沸騰','立ち位置チェック'],['存在感'],['国民的アイドル']
  ],
  concentration: [
    ['シュプレヒコール','楽観的'],['存在感'],['国民的アイドル'],['立ち位置チェック']
  ],
  motivation: [
    ['ワクワクが止まらない'],[],['届いて！','元気な挨拶']
  ],
  goodImpressionTurns: [
    ['オトメゴコロ'],['手拍子'],['キセキの魔法'],['びしっとキメ顔']
  ],
  fullPower: [
    ['積み重ね'],['全身全霊'],['本領発揮']
  ],
  preservation: [
    ['リスキーチャンス','覚悟','積み重ね'],['潜在能力','翔び立て！'],['トレンドリーダー']
  ],
  strength: [
    ['全身全霊'],['積み重ね'],['エンターテイナー'],['巻き返し']
  ]
};
const roles = {parameter_buff:'goodConditionTurns',lesson_buff:'concentration',
  card_play_aggressive:'motivation',review:'goodImpressionTurns',full_power:'fullPower',concentration:'strength'};
const indexCache=new WeakMap();
function indices(catalog) {
  if(indexCache.has(catalog)) return indexCache.get(catalog);
  const records=catalog.skillAdvice?.cards ?? [], profiles=catalog.hifExamProfiles?.profiles ?? [];
  const index={byId:new Map(records.map(r=>[r.id,r])), byName:new Map(records.map(r=>[r.nameJa,r])),
    byBase:new Map(records.filter(r=>r.variants[0]?.sourcePublicId!=null).map(r=>[r.variants[0].sourcePublicId,r])),
    decks:new Map((catalog.produceInitialDecks?.idolProfiles ?? []).map(r=>[r.idolCardId,r])),
    exams:new Map(profiles.map(r=>[r.idolCardId,r.examStages])), commons:new Map(), nativeRows:new Map()};
  for(const stage of ['selection','final','finalR2']) {
    const ref=profiles.flatMap(r=>r.examStages.filter(s=>s.stage===(stage==='selection'?'selection':'final') && s.order===(stage==='finalR2'?2:1)));
    const specs=new Set(ref.map(r=>JSON.stringify([r.turn,r.produceExamEffectIds])));
    if(ref.length && specs.size===1) index.commons.set(stage,ref[0]);
  }
  indexCache.set(catalog,index);
  return index;
}
function external(index,id,upgrade=0) {
  const key=id+':'+upgrade;
  if(index.nativeRows.has(key)) return index.nativeRows.get(key);
  const record=index.byId.get(id), variant=record?.variants.find(v=>v.upgradeCount===upgrade);
  const definition=variant && Number.isInteger(variant.sourcePublicId) && SkillCards.getById(variant.sourcePublicId);
  const row=definition ? {id,publicBaseId:record.variants[0].sourcePublicId,definition} : null;
  index.nativeRows.set(key,row);
  return row;
}
function walk(value,callback) {
  if(!value || typeof value!=='object') return;
  callback(value);
  for(const child of Object.values(value)) walk(child,callback);
}
function facts(row) {
  const f={baseIds:[],usedIds:[],names:new Set(),gains:{},gates:{},spent:new Set(),converts:new Set(),resets:new Set(),
    direct:0,delayed:false,stockScore:false,entry:false,goodGate:0};
  const d=row?.definition;
  if(!d) return f;
  for(const group of [...(d.actions??[]),...(d.effects??[])]) {
    if(group.phase==='cardMovedToHand') f.entry=true;
    walk(group.actions,n=>{
      if(n.name) f.names.add(n.name);
      if(n.lhs && n.op==='+=' && n.rhs?.type==='number') f.gains[n.lhs]=Math.max(f.gains[n.lhs]??0,n.rhs.value);
      if(n.lhs && n.op==='=' && n.rhs?.value===0) f.resets.add(n.lhs);
      if(n.lhs==='score' && !group.phase) f.direct+=n.rhs?.type==='number'?n.rhs.value:15;
      if(n.lhs==='score') walk(n.rhs,x=>{
        if(x.name==='genki') f.stockScore=true;
        if(x.type==='identifier') f.converts.add(x.name);
        if(group.phase==='turn' && x.name==='cumulativeFullPowerCharge') f.delayed=true;
      });
    });
  }
  walk(d,n=>{
    if(n.name==='baseId' && Number.isInteger(n.args?.[0]?.value)) f.baseIds.push(n.args[0].value);
    if(n.type==='comparison' && n.op==='==' && n.left?.name==='usedCardBaseId' && n.right?.type==='number') f.usedIds.push(n.right.value);
    if(n.type==='comparison' && ['>=','>'].includes(n.op) && n.left?.type==='identifier' && n.right?.type==='number')
      f.gates[n.left.name]=Math.max(f.gates[n.left.name]??0,n.right.value+(n.op==='>'?1:0));
  });
  walk(d.conditions,n=>{
    if(n.left?.name==='goodConditionTurns' && ['>=','>'].includes(n.op)) f.goodGate=Math.max(f.goodGate,n.right.value+(n.op==='>'?1:0));
  });
  walk(d.cost,n=>{if(n.op==='-=' && n.lhs) f.spent.add(n.lhs);});
  return f;
}
function available(record,plan,plv,selectedSwitchIds=[]) {
  if(!record || record.sourceType!=='produce' || !['active','mental'].includes(record.category) || ![plan,'free','all','common'].includes(record.plan) ||
    record.status?.releaseExcluded || record.status?.libraryHidden || record.status?.isLegend ||
    record.unlock?.requiresConversionSelection && !selectedSwitchIds.includes(record.id) ||
    selectedSwitchIds.includes(record.unlock?.convertedGameId)) return false;
  const min=acquisitionLevel(record);
  return Number.isInteger(min) && Number.isInteger(plv) && min<=plv;
}
function acquisitionLevel(record) {
  // The native zero also occurs on restricted families. Use the public
  // ordinary PLv1 only when the native catalog explicitly excludes that case.
  const u=record.unlock;
  if(Number.isInteger(u?.acquisitionProducerLevel)) return u.acquisitionProducerLevel;
  if(u?.rawAcquisitionProducerLevel===0 && u.rawZeroNeedsSeparateRule===false &&
    SkillCards.getById(record.variants[0]?.sourcePublicId)?.unlockPlv===1) return 1;
  return null;
}
export function hifOutfitTrainingType(catalog,card) {
  const profile=indices(catalog).decks.get(card.gameId);
  return profile?.showExamEffectType==='ProduceExamEffectType_ExamPreservation'
    ? 'preservation' : roles[profile?.scenarioDeckIds?.['produce-007']?.split('produce_007-')[1]];
}

function memoryWithCustomizations(row,variant,choices,missing) {
  const levels={};
  for(const {id,publicId,level} of choices) {
    const index=variant.customizationIds.indexOf(id);
    const option=Customizations.getById(publicId);
    if(index<0 || variant.publicCustomizationIds[index]!==publicId || !option || !Number.isInteger(level) ||
      level<1 || level>option.max || Object.hasOwn(levels,publicId)) {
      missing.push(row.id+' 반입 개조 대상·단계 '+id);
      return;
    }
    levels[publicId]=level;
  }
  if(Object.values(levels).reduce((sum,n)=>sum+n,0)>variant.native.maxCustomizeCount) {
    missing.push(row.id+' 반입 개조 횟수 초과');
    return;
  }
  const d={...row.definition};
  for(const key of ['conditions','cost','actions','effects']) {
    for(const [id,level] of Object.entries(levels)) {
      if(Customizations.getById(id)[key]?.some(p=>p.op==='patch' && (p.level??1)===level &&
        !d[key].some(g=>g.anchor===p.anchor))) {
        missing.push(row.id+' 반입 개조 원자료 일치 여부');
        return;
      }
    }
    d[key]=CardManager.prototype.computeLines({id:d.id,c11n:levels},key);
  }
  for(const id of Object.keys(levels)) {
    const option=Customizations.getById(id);
    if(option.forceInitialHand) d.forceInitialHand=true;
    if(String(option.limit)==='0') {d.liftLimit=true;d.limit=0;}
  }
  return {...row,definition:d};
}
function routeFor({catalog,card,skills,item,plv,preparedCards,selectedSwitchIds,index},stage) {
  const missing=[],preparation=[],notes=[];
  const id=card.gameId, isFinal=stage!=='selection';
  const profile=index.decks.get(id), scenario=isFinal?'produce-008':'produce-007';
  const deckId=profile?.scenarioDeckIds?.[scenario], template=catalog.produceInitialDecks?.decks?.[deckId];
  const nativeRole=roles[deckId?.split('produce_007-')[1]];
  const role=profile?.showExamEffectType==='ProduceExamEffectType_ExamPreservation'?'preservation':nativeRole;
  const exact=index.exams.get(id)?.find(r=>r.stage===(isFinal?'final':'selection') && r.order===(stage==='finalR2'?2:1));
  const exam=exact ?? index.commons.get(stage), turnCount=exam?.turn;
  if(!template || !role) missing.push('해당 H.I.F. 초기 덱·육성 타입 '+(deckId??id));
  if(!turnCount || exam.produceExamEffectIds?.join()!=='e_effect-exam_block-0001') missing.push('시험 턴·시작 효과');
  const result={stage,label:stage==='finalR2'?'본선 R2':isFinal?'본선 R1':'첫 선발',scenario,trainingType:role,turnCount,preferBestOrder:true,
    preparation,notes,missing,deck:[],cards:[],turnPriorities:[],playWindows:{}};
  result.guideSources=catalog.deckGuides?.guides?.find(g=>g.scenario==='hif' && g.trainingType===role)?.sourceIds??[];
  if(missing.length) return result;
  if(!exact) notes.push('의상별 시험표가 비어 있어 같은 일반 H.I.F. 시험 전체가 공유하는 턴·초기 효과를 사용');
  const kit=skills.filter(r=>isFinal || !r.primaStella);
  const own=new Set(kit.map(r=>r.id)), rows=new Map(kit.map(r=>[r.id,r]));
  const starter=template.cardSlots.map(s=>s.cardId);
  function register(record,upgrade=0) {
    const value=external(index,record?.id,upgrade);
    if(!value) {missing.push((record?.id??'불명')+' 강화 '+upgrade+' 스킬 원자료');return false;}
    rows.set(value.id,value);
    return true;
  }
  for(const s of template.cardSlots) register(index.byId.get(s.cardId),s.upgradeCount??0);
  if(stage==='finalR2') {
    const color={goodConditionTurns:'紫',concentration:'緑',goodImpressionTurns:'黄',motivation:'赤',strength:'青',fullPower:'桃',preservation:'桃'}[role];
    const stick=catalog.pItems?.find(i=>i.nameJa==='H.I.F応援棒（'+color+'）' && i.identityStatus==='exact');
    result.stageEffects=stick && PItems.getById(Number(stick.internalId))?.effects;
    result.generatedBasicCardIds=[...new Set(template.cardSlots.map(s=>index.byId.get(s.cardId)?.variants[0]?.sourcePublicId))];
    if(!result.stageEffects?.length || !result.generatedBasicCardIds.every(Number.isInteger)) missing.push('본선 2 응원봉·기본 카드 생성 풀');
    else preparation.push({source:'hif_after_final_round_1',id:stick.gameId,rule:'시험 시작 시 덱 22장까지 기본 카드 생성'});
  }
  const selections=[], starterChanges=[];
  const itemFacts=facts(item);
  // Native ProduceEffect leaves produceRewards empty in this snapshot.
  // All 13 text-verified ProduceCardChangeUpgrade grants replace a basic
  // with the upgraded ordinary card named by the outfit item's use trigger.
  const graph=catalog.idolMechanicsGraph;
  for(const training of card.specialTrainingStages??[]) {
    if(training.rank>(card.specialTrainingRank??0)) continue;
    for(const grant of training.skillGrants??[]) {
      if(!grant.produceSkillId.includes('produce_card_change_upgrade')) continue;
      const skill=graph?.ProduceSkill?.find(s=>s.id===grant.produceSkillId && s.level===grant.level);
      const effect=graph?.ProduceEffect?.find(e=>e.id===skill?.produceEffectId1);
      const search=graph?.ProduceCardSearch?.find(s=>s.id===effect?.produceCardSearchId);
      const targets=[...new Set(itemFacts.usedIds)].map(n=>index.byBase.get(n)).filter(r=>r?.sourceType==='produce');
      const slot=starter.findIndex(id=>search?.produceCardIds.includes(id));
      if(effect?.produceEffectType!=='ProduceEffectType_ProduceCardChangeUpgrade' || targets.length!==1 || slot<0) {
        missing.push(grant.produceSkillId+' 개시 교체 대상');continue;
      }
      const record=targets[0];
      if(register(record,1)) {
        starterChanges.push(record.id);
        preparation.push({source:'trained_starting_replacement',id:record.id,replaces:starter[slot],upgrade:1,
          minTraining:training.rank,grantId:grant.produceSkillId});
        starter[slot]=record.id;
      }
    }
  }
  for(const p of preparedCards) {
    if(!['produce_start','after_mid_audition'].includes(p.phase) || (!isFinal && p.phase==='after_mid_audition')) continue;
    const record=index.byId.get(p.gameId);
    if(!record || ![card.plan,'free','all','common'].includes(record.plan)) {missing.push(p.gameId+' 반입 플랜');continue;}
    if(record.unlock.requiresConversionSelection && (!selectedSwitchIds.includes(record.id) || plv<record.unlock.conversionProducerLevel)) continue;
    if(selectedSwitchIds.includes(record.unlock.convertedGameId)) continue;
    if(p.source==='rental' && (!Number.isInteger(record.unlock.rentalProducerLevel) || plv<record.unlock.rentalProducerLevel)) continue;
    if(own.has(p.gameId) || selections.includes(p.gameId) && record.status.noDeckDuplication) continue;
    if(register(record,p.upgradeCount??0)){
      if(p.customizations?.length) {
        const variant=record.variants.find(v=>v.upgradeCount===(p.upgradeCount??0));
        const patched=memoryWithCustomizations(rows.get(record.id),variant,p.customizations,missing);
        if(!patched) continue;
        rows.set(record.id,patched);
      }
      if(p.copyTarget) result.copyTargetId=record.id;
      selections.push(record.id);
      preparation.push({id:record.id,source:'selected_memory',phase:p.phase,upgrade:p.upgradeCount??0,
        ...(p.customizations?.length?{customizations:p.customizations}:{})});
    }
  }
  const kitFacts=kit.map(facts), repeat=kit.find((r,i)=>kitFacts[i].names.has('useRandomCardFree'));
  const entry=kit.find((r,i)=>kitFacts[i].entry);
  const choices=roleCards[role].map(column=>column.map(name=>index.byName.get(name)));
  const linked=[...new Set([...itemFacts.usedIds,...itemFacts.baseIds,...kitFacts.flatMap(f=>[...f.baseIds,...f.usedIds])])]
    .map(id=>index.byBase.get(id)).filter(c=>available(c,card.plan,plv) && !rows.has(c.id));
  const gates=Object.assign({},...kitFacts.map(f=>f.gates),itemFacts.gates);
  const prefer=(i,names)=>{choices[i]=[...names.map(name=>index.byName.get(name)),...(choices[i]??[])];};
  if(card.plan==='anomaly' && gates.cumulativeFullPowerCharge>=8) {
    prefer(0,['覚悟','セッティング','翔び立て！']);prefer(1,['積み重ね','心・技・体','ラッキー♪']);
    if(gates.cumulativeFullPowerCharge>=13) {prefer(0,['アッチェレランド']);prefer(1,['トレーニングの成果','翔び立て！']);}
  }
  if(card.plan==='logic' && gates.goodImpressionTurns>=5) prefer(0,['トキメキ','幸せな時間','思い出し笑い']);
  if(card.plan==='logic' && gates.genki>=7) prefer(1,['ひなたぼっこ','あのときの約束']);
  if(card.plan==='sense' && gates.concentration>=8) {
    prefer(1,['意地','存在感','準備運動']);
    if(gates.concentration>=13) prefer(0,['スタンドプレー','ひと呼吸']);
  }
  // A threshold on a single gain uses the increase of one actual action.
  // Several smaller gains cannot satisfy it, even if their total is larger.
  for(const field of ['concentration','motivation','goodImpressionTurns']) {
    const threshold=gates[field+'Delta'];
    if(!threshold) continue;
    const candidates=[];
    for(const record of index.byId.values()) {
      if(!available(record,card.plan,plv,selectedSwitchIds) || rows.has(record.id)) continue;
      const actions=external(index,record.id)?.definition.actions??[];
      const reaches=actions.some(g=>!g.phase && !g.conditions?.length && g.actions?.some(a=>
        a.lhs===field && a.op==='+=' && a.rhs?.type==='number' && a.rhs.value>=threshold));
      if(reaches) candidates.push(record);
    }
    if(candidates.length) choices[1]=[...candidates.sort((a,b)=>acquisitionLevel(a)-acquisitionLevel(b)),...choices[1]];
  }
  if(card.plan==='logic' && kitFacts.some(f=>f.spent.has('motivation'))) prefer(0,['ひなたぼっこ','本番前夜','イメトレ']);
  if(card.plan==='anomaly' && gates.genki>=30) {
    prefer(0,['インフルエンサー','カウントダウン']);prefer(1,['カウントダウン','ハッピー♪']);
  }
  if(card.plan==='anomaly' && gates.strengthTimes>=3) {prefer(0,['心・技・体','ラッキー♪']); prefer(1,['全身全霊']);}
  let lowStamina=false;
  walk(item.definition.effects,n=>{
    if(n.op==='<=' && n.left?.name==='stamina' && n.right?.left?.name==='maxStamina') lowStamina=true;
  });
  if(lowStamina && card.plan==='sense') {prefer(0,['祝福']);prefer(1,['スタンドプレー','ひと呼吸']);}
  const fromHeld=kit.find(r=>facts(r).names.has('moveHeldCardsToHand'));
  const holdThreshold=itemFacts.gates.fullPowerCharge;
  const alternatingCharge=preparedCards.some(p=>p.peakPreparation) && holdThreshold && itemFacts.names.has('holdCard') &&
    kit.some(r=>r.definition.actions.some(group=>group.phase==='endOfTurn' && group.conditions?.some(g=>
      g.left?.name==='fullPowerCharge' && g.op==='<=' && g.right?.value===holdThreshold-1)));
  if(alternatingCharge) {
    // Alternate the actual stock required to reserve the card with its
    // low-stock scoring window. Pick legal generators before more attackers.
    prefer(0,['アッチェレランド','モチベ']);prefer(1,['モチベ','覚悟']);
    prefer(2,['覚悟']);prefer(3,['トレンドリーダー']);
  }
  if(role==='fullPower' && fromHeld) {
    prefer(0,['モチベ','覚悟']);prefer(1,['積み重ね']);
    prefer(2,['羽ばたけ！','輝け！']); prefer(3,['トレンドリーダー']);
    prefer(4,['リスキーチャンス','覚悟']); prefer(5,['全身全霊']);
    prefer(6,['本領発揮','アイドルになります']);
  }
  if(linked.length) choices[0]=[...linked,...choices[0]];
  // A final route has the same maximum number of ordinary picks for every
  // outfit. Fill remaining slots from the bundled guide for its training type.
  if(isFinal) {
    const guide=catalog.deckGuides?.guides?.find(g=>g.scenario==='hif' && g.trainingType===role);
    const candidates=[...new Set([...(guide?.examFlow?.steps??[]).flatMap(s=>s.cardIds??[]),...(guide?.memoryRecommendations??[]).map(r=>r.gameId)])];
    while(choices.length<7) choices.push(candidates.map(id=>index.byId.get(id)));
  }
  for(const [i,column] of choices.entries()) {
    if(!isFinal && i>=2) break;
    // A kit that already repeats its own direct motivation and receives a
    // second mental card uses the native four distance-building starters.
    if(role==='motivation' && repeat && entry && i<2 && !linked.length) continue;
    const record=column.find(c=>available(c,card.plan,plv,selectedSwitchIds) && !rows.has(c.id));
    if(!record || !register(record)) continue;
    selections.push(record.id);
    preparation.push({id:record.id,source:'representative_acquisition',phase:i<2?'before_first_selection':'before_final_R1',
      opportunity:i<2?('수업 '+(i===0?'3':'6')+'일차 선택 가정'):'선발 후 본선 R1까지 일반 획득 가정',
      minPlv:acquisitionLevel(record),...(record.unlock.requiresConversionSelection?{selectedSwitchFrom:record.unlock.conversionSourceGameId}:{}),upgrade:0});
  }
  const descriptors=new Map([...rows].map(([id,r])=>[id,facts(r)]));
  const byFact=id=>descriptors.get(id);
  if(!result.copyTargetId && preparedCards.some(p=>p.peakPreparation) &&
      [...rows.values()].some(row=>row.definition.actions.some(g=>g.actions?.some(a=>a.lhs==='doubleCardEffectCards')))) {
    // Use the same copied repeatable scoring effect for every compatible deck.
    // A duplicate remains an actual effect with its original legality and cost.
    const copyCandidates=role==='goodConditionTurns'?['話題沸騰','至高のエンタメ','脚光']:['脚光','至高のエンタメ'];
    for(const name of copyCandidates) {
      const target=index.byName.get(name)?.id;
      if(rows.has(target)) {result.copyTargetId=target;break;}
    }
  }
  const resources={fullPower:'fullPowerCharge',preservation:'fullPowerCharge',strength:'enthusiasm'};
  const resource=resources[role]??role;
  const gain=id=>byFact(id)?.gains[resource]??0;
  const generators=[...new Set(starter)].sort((a,b)=>gain(b)-gain(a)||
    (byFact(b)?.gains.genki??0)-(byFact(a)?.gains.genki??0));
  let basics=[...starter];
  if(isFinal) {
    const rule=catalog.produceResources?.hif?.basicCardRemovals;
    if(!rule?.afterSelectionExamIndices?.length || !Number.isInteger(rule.count)) missing.push('선발 후 기본 카드 삭제 규칙');
    else {
      const count=rule.count*rule.afterSelectionExamIndices.length;
      const keepScore=id=>(byFact(id).stockScore && !selections.some(x=>byFact(x).stockScore)?50:0)+gain(id)*3+
        (gates.genki>=15?(byFact(id).gains.genki??0)*2:0)+
        (byFact(id).gains.genki??0)*0.2+(byFact(id).gains.score??0)*0.1;
      const removal=basics.filter(id=>!starterChanges.includes(id)).sort((a,b)=>keepScore(a)-keepScore(b)).slice(0,count);
      for(const id of removal) basics.splice(basics.indexOf(id),1);
      preparation.push({source:'basic_removals',ids:removal,opportunity:'선발 1·2 종료 시 기본 카드 2장씩 삭제되는 압축 결과 가정'});
    }
  }
  notes.push('기본 카드와 실제 고유 카드로 시작. 일반 획득·기본 카드 삭제·드로 순서는 이 대표 경로의 조건.');
  const alt=[...new Set([...starterChanges,...selections])], extra=alt.filter(id=>byFact(id).gains.cardUsesRemaining>0);
  const finish=[...new Set([...basics,...selections,...own])].filter(x=>{
    const f=byFact(x);
    return f.stockScore || [...f.resets].some(key=>f.converts.has(key));
  });
  const gated=kit.find(r=>byFact(r.id).goodGate>=5);
  const delayed=kit.find(r=>byFact(r.id).delayed);
  const fullPowerRecovery=role==='fullPower' && fromHeld;
  const heldAttacks=alt.filter(id=>byFact(id).names.has('holdThisCard') && byFact(id).direct>0);
  const chargeSetups=alt.filter(id=>rows.get(id).definition.limit===1 && byFact(id).gains.fullPowerCharge>0)
    .sort((a,b)=>Number(byFact(b).names.has('cardHasEffect'))-Number(byFact(a).names.has('cardHasEffect')) ||
      gain(b)-gain(a));
  const all=[...basics,...selections,...kit.map(r=>r.id)], order=[];
  const take=id=>{const next=all.indexOf(id);if(next>=0)order.push(...all.splice(next,1));};
  const setup=generators.filter(id=>basics.includes(id));
  if(fullPowerRecovery && isFinal) {
    for(const id of [repeat?.id,...chargeSetups,setup[0],...heldAttacks,fromHeld.id,...extra]) take(id);
  } else if(repeat && entry && entry!==repeat) {
    take(repeat.id);take(setup[0]);take(setup[0]);take(entry.id);take(setup[0]);
    take(finish[0]);take(basics.find(id=>!gain(id) && !finish.includes(id)));
  } else if(gated) {
    take(alt.filter(id=>gain(id)>0).sort((a,b)=>gain(b)-gain(a))[0]);
    take(extra[0]);take(setup[0]);take(setup[1]);take(gated.id);take(setup[0]);
  } else if(delayed) {
    take(setup[0]);take(alt[0]);take(setup[1]);take(setup[1]);take(delayed.id);
  } else {
    for(const id of [alt[0],kit[0]?.id,setup[0],kit[1]?.id,...extra,...alt.slice(1)]) take(id);
  }
  result.deck=[...order,...all];
  // Most starters recur and setup can be reused after the first shuffle.
  // Keep action refunds ahead of paid actions, and convert the saved stock
  // in the last part of the exam, even if it came from an ordinary starter.
  const ids=kit.map(r=>r.id);
  const nonFinishing=alt.filter(id=>!finish.includes(id));
  const early=[...extra,...ids,...nonFinishing,...setup.filter(id=>!finish.includes(id))];
  const arrangedFinish=[...finish].sort((a,b)=>Number(alt.includes(b))-Number(alt.includes(a)));
  const last=turnCount-2;
  for(const id of finish) result.playWindows[id]={first:Math.max(1,last)};
  if(delayed) result.playWindows[delayed.id]={first:2,last:turnCount-1};
  for(const row of kit) {
    const f=byFact(row.id);
    if(row.definition?.limit===1 && f.names.has('cardsUsed')) result.playWindows[row.id]={first:Math.ceil(turnCount/2)};
  }
  // Save a one-shot, high direct impression gain until after producing
  // the stock required at that very gain. Earlier stock is never assumed.
  if(itemFacts.gates.goodImpressionTurnsDelta && itemFacts.gates.genki) {
    for(const id of alt) if(rows.get(id).definition.limit===1 &&
      byFact(id).gains.goodImpressionTurns>=itemFacts.gates.goodImpressionTurnsDelta) {
      result.playWindows[id]={first:Math.ceil(turnCount/2)};
    }
  }
  // The extra use on draw/play must follow the persistent generation buff.
  if(repeat && entry && repeat!==entry) result.playWindows[entry.id]={first:2};
  const attacks=[...new Set([...ids,...alt,...basics])].filter(id=>byFact(id)?.direct>0 && !finish.includes(id))
    .sort((a,b)=>byFact(b).direct-byFact(a).direct);
  const afterSetup=Math.ceil(turnCount*0.55);
  const linkedTargets=[...new Set([...starterChanges,...linked.map(c=>c.id).filter(id=>rows.has(id))])];
  for(let t=1;t<=turnCount;t++) {
    let priorities=[...(t>=last?arrangedFinish:[]),...early];
    if(gated) priorities=[...extra,gated.id,...(t>=afterSetup?attacks:[]),...alt.filter(id=>gain(id)>0).sort((a,b)=>gain(b)-gain(a)),...priorities];
    else if(t>=afterSetup) priorities=[...extra,...(t>=last?arrangedFinish:[]),...linkedTargets,...attacks,...priorities];
    if(t<afterSetup && linkedTargets.length) priorities=[...extra,...(t===1?ids:[]),...linkedTargets,...priorities];
    if(delayed && t===1) priorities=[...setup,...priorities];
    if(t===1 && kitFacts.some(f=>f.spent.has('motivation'))) priorities=[...ids,...priorities];
    if(t===turnCount) priorities=[...extra,...arrangedFinish,...attacks,...priorities];
    result.turnPriorities.push([...new Set(priorities)]);
  }
  result.priority=[...new Set([...early,...finish,...result.deck])];
  result.redrawOrder=[...new Set([...(repeat && entry?[entry.id]:[]),...result.deck])];
  // These rules only choose between legal cards already in hand. Their
  // source is the actual gate in this kit, not an outfit's name or tier.
  // Finish actions take priority again in the final turns.
  const rules=result.goalPriorities=[];
  const allIds=[...new Set(result.deck)];
  const orderedGains=key=>allIds.filter(id=>byFact(id).gains[key]>0 && !byFact(id).spent.has(key))
    .sort((a,b)=>byFact(b).gains[key]-byFact(a).gains[key]);
  const rule=(field,op,value,order,last=turnCount-2)=>{
    if(order.length) rules.push({condition:{field,op,value},order:[...new Set(order)],last});
  };
  if(alternatingCharge) rule('fullPowerCharge','<',holdThreshold,orderedGains('fullPowerCharge'),turnCount-1);
  if(fullPowerRecovery) {
    // The free replay requires two uses in one full-power turn. Recovering
    // held attackers before that turn spends fixed HP without landing them.
    const chargeOrder=[...chargeSetups,...orderedGains('fullPowerCharge')];
    rule('stance','!=','fullPower',[repeat?.id,...chargeOrder].filter(Boolean),turnCount);
    rule('stance','==','fullPower',[...heldAttacks,fromHeld.id,...attacks,...extra],turnCount);
  } else if(fromHeld) {
    rule('heldCount','>',0,[fromHeld.id],turnCount);
    rule('heldCount','==',0,allIds.filter(id=>byFact(id).names.has('holdThisCard') || byFact(id).names.has('holdSelected')));
  }
  const itemConditions=(item.definition?.effects??[]).flatMap(g=>g.conditions??[]);
  const conditionNames=new Set();
  walk(itemConditions,n=>{if(n.name) conditionNames.add(n.name);});
  if(conditionNames.has('isFullPower') && conditionNames.has('preservation'))
    rule('stance','==','fullPower',allIds.filter(id=>byFact(id).names.has('preservation') || byFact(id).names.has('preservation2')),turnCount);
  if(gates.genki>=7) {
    const whenStocked=conditionNames.has('isStrength')
      ? allIds.filter(id=>byFact(id).names.has('strength') || byFact(id).names.has('strength2'))
      : [...linkedTargets,...ids];
    rule('genki','>=',gates.genki,whenStocked);
    rule('genki','<',gates.genki,[...allIds.filter(id=>byFact(id).gains['g.genki']>0),...orderedGains('genki')]);
  }
  if(gates.concentration>=8) rule('concentration','<',gates.concentration,orderedGains('concentration'));
  if(gates.cumulativeFullPowerCharge>=8) rule('cumulativeFullPowerCharge','<',gates.cumulativeFullPowerCharge,orderedGains('fullPowerCharge'));
  if(itemFacts.gates.goodImpressionTurns>=6) {
    rule('goodImpressionTurns','>=',itemFacts.gates.goodImpressionTurns,[...ids,...attacks]);
    rule('goodImpressionTurns','<',itemFacts.gates.goodImpressionTurns,orderedGains('goodImpressionTurns'));
  }
  if(lowStamina) {
    rule('staminaRatio','>',0.5,allIds.filter(id=>byFact(id).spent.has('stamina') || byFact(id).spent.has('fixedStamina')));
    rule('staminaRatio','<=',0.5,[...ids,...attacks]);
  }
  result.cards=[...rows.values()].filter(r=>!own.has(r.id) && result.deck.includes(r.id));
  const rank=card.specialTrainingRank??0, stamina=card.baseStats?.stamina;
  const growth=(card.specialTrainingStages??[]).filter(r=>r.rank<=rank).reduce((sum,r)=>sum+(r.staminaDeltaByExplicitEffectType??0),0);
  if(!Number.isInteger(stamina) || stamina<=0) missing.push('의상 초기 체력');
  result.initial={genki:1,stamina:stamina+growth,maxStamina:stamina+growth};
  return result;
}

export function buildHifOutfitRoutes({catalog,card,skills=[],item,plv,preparedCards=[],selectedSwitchIds=[]}) {
  const input={catalog,card,skills,item,plv,preparedCards,selectedSwitchIds,index:indices(catalog)};
  return {selection:routeFor(input,'selection'),final:routeFor(input,'final'),finalR2:routeFor(input,'finalR2')};
}
