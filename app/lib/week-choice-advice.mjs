import { buildLegendMidtermChoice } from './legend-midterm-choice.mjs';
import { buildNiaChoiceAdvice } from './nia-choice-advice.mjs';
import { recommendHifInterval } from './hif-interval-choice.mjs';
import { buildDayActionGuidance } from './day-action-guidance.mjs';

const list=value=>Array.isArray(value)?value:[];
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const integer=value=>Number.isInteger(amount(value))?value:null;
const unique=values=>[...new Set(values.filter(Boolean))];
const axisNames={vocal:'보컬',dance:'댄스',visual:'비주얼'};
const axes={vo:'vocal',da:'dance',vi:'visual'};
const activityNames={consult:'상담',outing:'외출',supply_gift:'사시이레 · 차입',activity_supply:'활동 지급',special_training:'특별지도',rest:'휴식',final_exam:'시험',mid_exam:'시험',interval:'인터벌'};
const activityFamily=activity=>/^class_/.test(activity)?'class':/_lesson_/.test(activity)?'lesson':activity;
const labelOf=activity=>activityNames[activity]??(/^class_(vo|da|vi)$/.test(activity)?axisNames[axes[activity.slice(6)]]+' 수업':/^(vo|da|vi)_lesson_(vo|da|vi)$/.test(activity)?activity.split('_lesson_').map(axis=>axisNames[axes[axis]]).join(' · 부속성 ')+' 레슨':activity);
const range=(min,max=min)=>({min,max});
const decision=checks=>checks.includes(false)?false:checks.includes(null)?null:true;
const currentType=value=>({full_power:'fullPower',good_condition:'goodConditionTurns',good_impression:'goodImpressionTurns',enthusiasm:'strength'})[value]??value;

function evidenceSources(catalog,book,resourceLedger){
  const all=[...list(catalog.produceResources?.sources),...list(catalog.playbookPolicies?.sources),...list(catalog.scenarioEvents?.sources),...list(book.sources),...list(resourceLedger?.sources)];
  return [...new Map(all.filter(row=>row.id).map(row=>[row.id,row])).values()];
}

function resourceFeasibility(costs,live){
  const reasons=[],checks=[];
  for(const [key,cost,current] of [['P포인트',costs.pp,live.pp],['체력',costs.stamina,live.stamina]]){
    if(cost===null){checks.push(null);reasons.push(key+' 실제 비용 미확인');}
    else if(cost===0)checks.push(true);
    else if(current===null){checks.push(null);reasons.push('현재 '+key+' 미확인');}
    else if(current<cost){checks.push(false);reasons.push(`${key} ${cost} 필요 · 현재 ${current}`);}
    else checks.push(true);
  }
  return {resourceAffordable:decision(checks),feasibilityReasons:reasons};
}

function choice(data,live){
  const costs={pp:0,ppRange:range(0),stamina:0,troubleCards:0,...data.costs};
  const feasibility=resourceFeasibility(costs,live);
  const availability=data.offered===undefined?true:data.offered;
  return {...data,costs,...feasibility,canChoose:decision([feasibility.resourceAffordable,availability]),
    feasibilityReasons:[...feasibility.feasibilityReasons,...(availability===null?['현재 게임에 이 선택지가 제시되었는지 확인 필요']:availability===false?['현재 제시된 선택지가 아님']:[])],
    costText:list(data.costText),rewardText:list(data.rewardText),sourceIds:unique(list(data.sourceIds))};
}

function matchingEvent(catalog,{category,stage,week,plan,axis,early}){
  const produce=stage==='final'?'produce_008':'produce_007',planCode={sense:'plan1',logic:'plan2',anomaly:'plan3'}[plan];
  const period=stage==='final'?'':category==='school'?early?'before_1st':'before_3rd':week>13?'before_3rd':week>7?'before_2nd':null;
  if(period===null)return null;
  return list(catalog.scenarioEvents?.events).find(event=>event.scenario==='hif'&&event.category===category&&
    event.id.includes(produce)&&(!period||event.id.includes(period))&&(!planCode||category!=='school'||event.id.includes(planCode))&&
    (!axis||event.id.includes('school-'+axis+'-')));
}

function recovery(permil,live){
  const nominal=live.currentMaxStamina===null?null:Math.floor(live.currentMaxStamina*permil/1000);
  const actual=nominal===null||live.stamina===null?null:Math.min(nominal,Math.max(0,live.currentMaxStamina-live.stamina));
  return {nominal,actual,permil};
}

function outingChoices(data,event,live){
  const labels={pp50:'P포인트 50 사용 · 강화 카드도 확보',trouble:'졸음 1장 추가 · 강화 카드도 확보',free:'추가 비용 없이 회복·보충'};
  return list(data.choices).map((row,index)=>{
    const original=list(event?.choices)[index],heal=recovery(data.recoveryPermil,live);
    return choice({id:row.id,eventId:event?.id??null,eventChoiceId:original?.id??null,label:labels[row.id]??row.id,
      costs:{pp:amount(row.ppCost),ppRange:range(amount(row.ppCost),amount(row.ppCost)),troubleCards:row.troubleCards??0},
      rewards:{pp:0,staminaRecovery:heal.actual,nominalStaminaRecovery:heal.nominal,recoveryPermil:data.recoveryPermil,
        normalCards:row.normalCards,upgradedCards:row.upgradedCards,drinkOpportunities:row.drinks},
      costText:original?.costs??[...(row.ppCost?[`P포인트 ${row.ppCost} 소비`]:[]),...(row.troubleCards?[`졸음 ${row.troubleCards}장 추가`]:[])],
      rewardText:original?.rewards??['최대 체력의 60%만큼 회복',`일반 카드 ${row.normalCards}장${row.upgradedCards?`·강화 카드 ${row.upgradedCards}장`:''} 획득 기회`,`드링크 ${row.drinks}개 획득 기회`],
      conditions:original?.conditions??[],sourceIds:unique([...list(data.sourceIds),...list(event?.sourceIds)]),
      limitations:['회복 초과분과 실제 카드·드링크 종류는 확인해야 합니다. 졸음 추가가 현재 덱에 유리한지는 별도 판단합니다.']},live);
  });
}

function classChoices(activity,data,event,live,early){
  if(!event)return [choice({id:'class-unconfirmed',label:'실제 수업 선택지 확인',costs:{stamina:null},rewards:{},
    rewardText:[],costText:['원본 수업 선택지 대응 미확인'],sourceIds:list(data.sourceIds),offered:null},live)];
  return list(event.choices).map((row,index)=>{
    const trouble=list(row.costs).some(text=>text.includes('졸음'));
    const stats={};for(const axis of Object.keys(axisNames)){
      const match=list(row.rewards).join(' ').match(new RegExp(axisNames[axis]+'\\s*\\+(\\d+)'));
      if(match)stats[axis]=Number(match[1]);
    }
    return choice({id:row.id,eventId:event.id,eventChoiceId:row.id,label:trouble?'체력 대신 졸음 추가':`체력 사용 · ${index===0?'첫 번째':'두 번째'} 유형 카드`,
      costs:{stamina:trouble?0:amount(data.staminaCost),troubleCards:trouble?data.troubleCostCards:0},
      rewards:{parameterGains:stats,cardAcquisitionOpportunities:early&&!trouble?data.earlyAcquireCards:0,
        selectChangeOpportunities:early?(trouble?1:0):data.lateChangeCards},costText:row.costs,rewardText:row.rewards,
      conditions:row.conditions,sourceIds:unique([...list(data.sourceIds),...list(event.sourceIds)]),
      limitations:['셀렉트 체인지는 기존 카드 변환이며 새 카드 획득으로 중복 계산하지 않습니다.']},live);
  });
}

function consultationChoices(record,book,catalog,liveState,live){
  const data=catalog.produceResources.hif.consult,global=catalog.playbookPolicies?.globalConsultationRules;
  const actions=list(record?.consultation?.preferredActions).length?record.consultation.preferredActions:
    list(record?.managementActions).filter(row=>row.venue==='consult');
  const offers=list(liveState.consultationOffers),result=[];
  for(const row of actions)for(const target of list(row.targetRefs)){
    if(!['remove','upgrade','acquire','drink_exchange'].includes(row.action))continue;
    const gameId=target.gameId??target.id;
    const offer=offers.find(value=>value.action===row.action&&(!value.gameId||value.gameId===gameId));
    const prices=liveState.consultPrices?.[row.action];
    const price=amount(offer?.price??(typeof prices==='object'?prices?.[gameId]:prices));
    const rarity=String(target.rarity??list(catalog.skillCards).find(card=>card.gameId===gameId)?.rarity??'').toUpperCase();
    let baseRange=null;
    if(['upgrade','remove'].includes(row.action)){
      const position=integer(liveState.consultPurchaseIndex);
      baseRange=position>0?data.enhanceDeletePrices?.[position-1]??null:range(data.enhanceDeletePrices?.[0]?.min??null,null);
    }else if(row.action==='acquire'){
      const base=data.cardPrices?.[rarity]?.[target.upgradeCount??0]??null;if(base!==null)baseRange=range(base);
    }
    const actionNames={remove:'삭제',upgrade:'강화',acquire:'새 카드 획득',drink_exchange:'드링크 교환'};
    const explicitOffer=offer?.available===false?false:offer?.available===true?true:null;
    result.push(choice({id:`consult-${row.action}-${gameId}`,action:row.action,label:actionNames[row.action],targetRefs:[target],
      offered:explicitOffer,costs:{pp:price,ppRange:price===null?range(0,baseRange?.max??null):range(price)},
      basePPCostRange:baseRange,rewards:{cardAcquisitionOpportunities:row.action==='acquire'?1:0},
      costText:[price===null?'현재 메뉴의 가격·할인 확인 필요':`P포인트 ${price} 소비`],
      rewardText:[row.reason??row.when??'대상 카드와 현재 덱을 대조해 선택'],
      conditions:list(row.conditions?.requiresActualRoleCheck?['현재 덱에서 해당 역할이 필요한지 확인']:[]),
      sourceIds:unique([...list(row.sourceIds),...list(data.sourceIds),...list(global?.sourceIds)]),
      ruleId:'book-week-consult-'+row.action,reason:row.reason??row.when,
      removesExistingCard:row.action==='acquire'?false:undefined,
      limitations:['상담 구매는 기존 카드를 빼는 수업의 셀렉트 체인지와 다릅니다. 실제 대상·가격을 확인해야 합니다.']},live));
  }
  return result;
}

function sourceRules(catalog,context,stage,displayWeek,activity){
  return list(catalog.playbookPolicies?.policies).filter(policy=>policy.scenario===context.scenario&&policy.plan===context.plan&&currentType(policy.trainingType)===currentType(context.trainingType))
    .flatMap(policy=>list(policy.activityRules).map((rule,index)=>({policy,rule,index}))).filter(({rule})=>rule.activity===activity&&
      (!list(rule.conditions?.selectionWeeks).length&&!list(rule.conditions?.finalWeeks).length||list(rule.conditions?.[stage==='final'?'finalWeeks':'selectionWeeks']).includes(displayWeek)))
    .map(({policy,rule,index})=>({ruleId:`${policy.id}:activity:${index}`,when:list(rule.when),reason:rule.reason,alternative:rule.alternative,
      conditions:rule.conditions,sourceIds:list(rule.sourceIds),application:'conditional_author_rule'}));
}

function statNeedsOf(statTargets,liveState){
  const rows=list(statTargets?.stages),next=rows.find(row=>row.examIndex===liveState.nextExamIndex)??rows[0];
  if(!next)return [];
  return Object.entries(next.axes??{}).map(([axis,row])=>({axis,label:axisNames[axis]??axis,value:row.value??null,
    valueSource:row.valueSource??'unknown',rawCriterion:row.rawCriterion??null,rawCriterionGap:row.rawCriterionGap??row.criterionGap??null,
    remaining:row.remaining??null,examIndex:next.examIndex,sourceIds:list(next.sourceIds),
    reason:'입력된 다음 시험 준비 기준의 차이입니다. ○·◎ 경계나 특정 활동의 최적성을 새로 추정하지 않습니다.'}));
}

/** On-screen choices and source rules. Never promotes a modeled balance to live HP/PP. */
export function buildWeekChoiceAdvice(input={}) {
  const advice = buildWeekChoices(input);
  const {book={},result={},catalog={},liveState={}} = input;
  const week = list(book.weekPlan).find(row=>row.week===advice.week);
  return week ? {...advice,day:buildDayActionGuidance({week,book,result,catalog,advice,liveState})} : advice;
}

function buildWeekChoices({book={},result={},candidate=null,resourceLedger=null,catalog={},week,liveState={},statTargets=null}={}){
  const live={stamina:amount(liveState.stamina),currentMaxStamina:amount(liveState.maxStamina??liveState.currentMaxStamina),pp:amount(liveState.pp)};
  const score=candidate?.scoreSummary??result.scoreSummary??{},context={...book.context,scenario:book.context?.scenario??score.scenario??'hif',
    plan:book.context?.plan??score.plan,trainingType:book.context?.trainingType??score.trainingType};
  const sources=evidenceSources(catalog,book,resourceLedger),base={week:integer(week),liveResources:live,activities:[],recommendations:[],statNeeds:[],
    optimizedActivityChoice:false,sourceScoreWeightsApplied:false,sources,
    limitations:['현재 자원 입력이 없으면 실행 가능 여부를 미확정으로 남깁니다. 모형 수지나 누적 수입을 현재 잔고로 사용하지 않습니다.',
      '출처가 있는 분기·비용 비교이며 활동과 카드 선택을 전수 최적화한 결과가 아닙니다. 실제 제시 카드·SP·할인·추가 효과를 확인하세요.']};
  const record = list(book.weekPlan).find(row => row.week === base.week);
  const scenario = context.scenario;
  const selectedDifficulty = book.scheduleContext?.sourceDifficulty ?? score.difficulty;
  const eventModeId = book.scheduleContext?.selectedEventModeId ?? null;
  const observation = liveState.observation ?? {};
  const scheduledActivities = [record?.activity, ...list(record?.alternatives).map(row => row.activity)];
  const observed = (kind, activity, detail) => ({ ...base, status: 'observed_week_choices',
    observedChoice: { kind, activity, detail } });
  if (scenario === 'hajime' && selectedDifficulty === 'legend' && scheduledActivities.includes('legend_mid_exam')) {
    return observed('legend', 'legend_mid_exam', buildLegendMidtermChoice({ catalog, scenario, difficulty: selectedDifficulty,
      plan: context.plan, trainingType: context.trainingType, observation }));
  }
  if (scenario === 'nia') {
    const activity = scheduledActivities.find(id => id === 'business' || ['audition_first','audition_second','audition_final'].includes(id));
    if (activity) return observed('nia', activity, buildNiaChoiceAdvice({ scenario, difficulty: selectedDifficulty,
      eventModeId, week: base.week, activity, observation: { ...observation, stamina: live.stamina, pp: live.pp } }));
  }
  if (scenario === 'hif' && record?.activity === 'interval') {
    return observed('hif', 'interval', recommendHifInterval({ ...observation, postR1P: live.pp }));
  }
  if(context.scenario!=='hif'||!catalog.produceResources?.hif)return {...base,status:'unsupported_scenario',reason:'이 주차에는 비교할 실제 선택지 입력이 없습니다.'};
  const difficulty=score.difficulty??'none',schedule=list(catalog.calculationModels?.['score/schedule']?.table?.hif?.[difficulty]);
  const native=schedule.find(row=>row.week===integer(week));
  if(!native)return {...base,status:'missing_schedule',reason:'해당 주차의 실제 선택 가능 활동을 확인하지 못했습니다.'};
  const data=catalog.produceResources.hif,stage=native.stage??'selection',start=schedule.find(row=>row.stage===stage)?.week??1,displayWeek=native.week-start+1;
  const planned=list(candidate?.scoreSummary?.hifModel?.selections??result.scoreSummary?.hifModel?.selections).find(row=>row.week===native.week)?.activity??record?.activity;
  const activities=list(native.activities).map(activity=>{
    const family=activityFamily(activity),rules=sourceRules(catalog,context,stage,displayWeek,activity);
    let choices=[];
    if(activity==='outing')choices=outingChoices(data.outing,matchingEvent(catalog,{category:'activity',stage,week:native.week}),live);
    else if(activity==='supply_gift')choices=[choice({id:'supply-gift',label:'차입 받기',costText:['P포인트·체력 추가 소비 없음'],
      rewardText:[`P포인트 ${data.gift.pp}`,`스킬 카드 ${data.gift.skillCardOpportunities}장 획득 기회`,`SR 이상 드링크 ${data.gift.drinkOpportunities}개 획득 기회`],
      rewards:{pp:data.gift.pp,cardAcquisitionOpportunities:data.gift.skillCardOpportunities,drinkOpportunities:data.gift.drinkOpportunities},sourceIds:data.gift.sourceIds},live)];
    else if(family==='class'){
      const axis=axes[activity.slice(6)],early=list(data.class.earlyWeeks).includes(native.week);
      choices=classChoices(activity,data.class,matchingEvent(catalog,{category:'school',stage,week:native.week,plan:context.plan,axis,early}),live,early);
    }else if(family==='lesson'){
      const [main,sub]=activity.split('_lesson_').map(value=>axes[value]),slot=data.lessonWeeks?.[native.week];
      choices=list(data.lessons).filter(row=>row.period===slot?.period&&row.focus===slot?.focus&&row.sub===sub).map(row=>{
        const sp=list(liveState.spLessonAttributes),known=Array.isArray(liveState.spLessonAttributes);
        const offered=known?(row.isSp?sp.includes(main):!sp.includes(main)):null;
        return choice({id:row.id,label:row.isSp?'SP 레슨':'일반 레슨',isSp:row.isSp,offered,
          costs:{stamina:amount(row.stamina)},costText:[`체력 ${row.stamina} 소비`],
          rewards:{pp:data.publicLessonPP?.[stage]??null,parameterGains:{[main]:row.mainParameter,[sub]:row.subParameter},starBase:row.star},
          rewardText:[`${axisNames[main]} 기본 +${row.mainParameter} · ${axisNames[sub]} 기본 +${row.subParameter}`,`기본 스타성 +${row.star}`,`P포인트 ${data.publicLessonPP?.[stage]??'미확인'}`],
          sourceIds:['native-open-lessons','community-hif'],limitations:['레슨의 기본 상승값입니다. 성장률·서포트·실제 성공 결과를 더한 최종 수치가 아닙니다. SP 발생은 실제 화면 확인 필요.']},live);
      });
    }else if(activity==='consult')choices=consultationChoices(record,book,catalog,liveState,live);
    else if(activity==='special_training')choices=list(record?.managementActions).filter(row=>row.action==='customize').map((row,index)=>choice({id:'special-'+index,label:'필요한 카드 커스텀',action:'customize',
      targetRefs:list(row.targetRefs),costs:{pp:null,ppRange:range(0,null)},costText:['선택 커스텀·단계·할인 가격 확인'],rewardText:[row.reason??row.when],sourceIds:unique([...list(row.sourceIds),'native-customization']),offered:null},live));
    const canChoose=choices.some(row=>row.canChoose===true)?true:choices.length&&choices.every(row=>row.canChoose===false)?false:null;
    return {activity,label:labelOf(activity),family,availableInSchedule:true,planned:activity===planned,canChoose,
      canVisit:['consult','special_training'].includes(activity)?true:canChoose,choices,sourceRules:rules,
      reason:rules.map(rule=>rule.reason).join(' ')||'해당 주차에 제시되는 선택입니다. 비용과 지금 필요한 보상을 비교하세요.',
      sourceIds:unique([...rules.flatMap(rule=>rule.sourceIds),...choices.flatMap(row=>row.sourceIds)]),
      ...(activity==='consult'?{consultation:{preferredActions:record?.consultation?.preferredActions??[],targetsConnected:Boolean(record?.consultation),
        visitCost:0,visitEffects:list(resourceLedger?.supportEffects).filter(row=>row.kind==='consult'),
        potentialItemEffects:list(resourceLedger?.supportItems).filter(row=>row.triggerKey==='consult_selection'),
        note:'상담 방문 자체와 구매 비용은 구분합니다. 방문 효과의 누적 합계는 지금 쓸 수 있는 잔고가 아닙니다.'}}:{})};
  });
  const recommendations=[];
  const gift=activities.find(row=>row.activity==='supply_gift'),outing=activities.find(row=>row.activity==='outing'),consult=activities.find(row=>row.activity==='consult');
  if(gift&&consult&&live.pp!==null&&live.pp===0&&!consult.choices.some(row=>row.canChoose===true))recommendations.push({activity:'supply_gift',choiceIds:['supply-gift'],status:'conditional_source_rule',
    ruleId:'no-confirmed-affordable-consult-target-use-gift',reason:`지금 쓸 P포인트가 없고 살 수 있는 상담 대상이 확인되지 않았다면, 차입의 ${data.gift.pp}PP·카드·드링크 보충을 먼저 검토합니다. 상담 방문 보너스가 필요한 경우는 별도로 비교하세요.`,
    sourceIds:unique([...list(data.gift.sourceIds),...list(data.consult.sourceIds)]),conditions:['현재 PP 0','실제 구매 가능한 상담 대상 미확인','회복이나 다른 효과가 더 급하지 않은지 확인']});
  for(const row of activities)for(const rule of row.sourceRules){
    const threshold=amount(rule.conditions?.minimumStaminaForPlan);
    const applies=threshold!==null&&live.stamina!==null&&[8,14].includes(native.week)&&stage==='selection';
    if(row.activity==='outing'&&applies){
      if(live.stamina<threshold)recommendations.push({activity:'outing',status:'conditional_source_rule',ruleId:rule.ruleId,
        reason:`원문의 두 SP 레슨·수업 동선은 체력 ${threshold}을 준비합니다. 현재 ${live.stamina}이면 외출의 회복 선택지를 우선 검토합니다.`,
        sourceIds:rule.sourceIds,conditions:['원문의 SP8+SP8+수업5 동선일 때','서포트 회복·실제 비용은 별도 확인']});
      else if(gift)recommendations.push({activity:'supply_gift',status:'conditional_source_rule',ruleId:rule.ruleId,
        reason:`원문의 다음 구간 체력 ${threshold} 조건을 만족하므로 회복보다 차입 보충을 검토할 수 있습니다.`,sourceIds:unique([...rule.sourceIds,...list(data.gift.sourceIds)]),
        conditions:['원문의 SP8+SP8+수업5 동선일 때','실제 비용·회복 변화는 별도 확인']});
    }
  }
  // Both branches remain visible when current resources are absent. No single
  // default route is relabeled as a live optimum.
  const branchRules=[];
  if(outing)branchRules.push({ruleId:'recover-via-outing',activity:'outing',when:'회복이 필요할 때',reason:`외출은 최대 체력의 ${data.outing.recoveryPermil/10}% 회복 선택지가 있고, 무료·50PP·졸음 추가의 보상이 다릅니다.`,sourceIds:data.outing.sourceIds});
  if(gift)branchRules.push({ruleId:'replenish-via-gift',activity:'supply_gift',when:'회복보다 PP·카드·드링크 보충이 필요할 때',reason:`차입은 ${data.gift.pp}PP와 카드·드링크 획득 기회를 제공합니다.`,sourceIds:data.gift.sourceIds});
  if(consult)branchRules.push({ruleId:'use-consult-for-confirmed-target',activity:'consult',when:'필요한 삭제·강화·구매 대상이 있고 현재 가격을 지불할 수 있을 때',reason:'상담은 필요한 작업을 PP로 실행합니다. 대상·가격이 없으면 방문만으로 덱이 좋아진다고 계산하지 않습니다.',sourceIds:data.consult.sourceIds});
  const used=new Set([...activities.flatMap(row=>row.sourceIds),...recommendations.flatMap(row=>row.sourceIds),...branchRules.flatMap(row=>row.sourceIds)]);
  return {...base,status:'conditional_week_choices',stage,displayWeek,plannedActivity:planned??null,fixedActivity:native.fixed===true,
    activities,recommendations,branchRules,statNeeds:statNeedsOf(statTargets,{...liveState,nextExamIndex:schedule.filter(row=>row.week<native.week&&list(row.activities).some(activity=>['mid_exam','final_exam'].includes(activity))).length}),
    sources:sources.filter(source=>used.has(source.id)),reason:recommendations[0]?.reason??'현재 체력·P포인트와 제시된 대상에 따라 아래 분기를 고르세요. 계획 동선 자체를 최적 선택으로 확정하지 않습니다.'};
}
