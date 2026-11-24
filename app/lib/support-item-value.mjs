import { PItems } from './vendor/gakumas-data/index.js';

const axes = ['vocal','dance','visual'];
const list = value => Array.isArray(value) ? value : [];
const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const integer = value => Number.isInteger(number(value)) ? number(value) : null;
const zeroStats = () => ({vocal:0,dance:0,visual:0});
const zeroResources = () => ({hpRecovery:0,pp:0,pDrinkAcquisitions:0});
const emptyValue = () => ({stats:zeroStats(),resources:zeroResources(),activationCount:0,activations:[],operations:[],discounts:[]});
const stageOf = action => ['selection','final'].includes(action.stage) ? action.stage : action.fromExamIndex >= 3 ? 'final' : 'selection';
const compatible = (required, actual) => !required || required === 'free' || required === 'common' ? true : actual ? required === actual : null;
const combine = values => values.includes(false) ? false : values.includes(null) ? null : true;
const nativeKeyword = key => ({preservation:'reserve',strength:'aggressive',fullPower:'full_power',goodConditionTurns:'good_condition',goodImpressionTurns:'good_impression'})[key] ?? key;
const parameterLabels = {vocal:'보컬',dance:'댄스',visual:'비주얼'};
const keywordLabels = {concentration:'집중',good_condition:'호조',perfect_condition:'절호조',good_impression:'호인상',
  motivation:'의욕',vitality:'원기',reserve:'보존',aggressive:'강기',full_power:'전력',full_power_value:'전력치'};
const conditionUnknown = '추가 조건 확인 필요';

function itemTriggerLabel(trigger) {
  const simple={consult_selection:'상담 선택 시',activity_supply_gift_selection:'사시이레 선택 시',outing_end:'외출 종료 시',
    special_training_start:'특별 지도 시작 시',class_work_end:'수업 종료 시',exam_end:'시험 종료 시',
    skill_change:'스킬 카드 변환 시',card_enhance:'스킬 카드 강화 시',card_acquire:'스킬 카드 획득 시',
    skill_acquire:'스킬 카드 획득 시',card_delete:'스킬 카드 삭제 시',pdrink_acquire:'P드링크 획득 시',
    turn_start:'턴 시작 시',turn_start_after:'턴 시작 후',active_card_use:'액티브 스킬 카드 사용 시',
    card_use:'스킬 카드 사용 시',lesson_start:'레슨 시작 시',exam_start:'시험 시작 시',
    motivation_increase_after:'의욕 증가 후',card_cost_hp_decrease:'카드 비용으로 체력 감소 시'};
  if(simple[trigger?.key])return simple[trigger.key];
  if (trigger?.key === 'plan_card_acquire') {
    const label = { sense: '센스', logic: '로직', anomaly: '어노말리' }[trigger.plan];
    return label ? label + ' 스킬 카드 획득 시' : conditionUnknown;
  }
  const param=parameterLabels[trigger?.param],keyword=keywordLabels[nativeKeyword(trigger?.keyword)];
  if(param&&['param_lesson_end','param_sp_lesson_end'].includes(trigger.key))return `${param}${trigger.key==='param_sp_lesson_end'?' SP':''} 레슨 종료 시`;
  if(keyword&&['keyword_card_acquire','keyword_card_enhance'].includes(trigger.key))return `${keyword} 관련 스킬 카드 ${trigger.key==='keyword_card_acquire'?'획득':'강화'} 시`;
  const count=integer(trigger?.count);
  if(trigger?.key==='card_use_count_in_turn'&&count!==null)return `턴 내 스킬 카드 ${count}회 사용 시`;
  return conditionUnknown;
}

function itemConditionLabel(condition) {
  if(Array.isArray(condition))return condition.length?condition.map(itemConditionLabel).join(' · '):'추가 조건 없음';
  if(!condition)return '추가 조건 없음';
  const key=condition.key,param=parameterLabels[condition.param],value=number(condition.threshold);
  const keyword=keywordLabels[nativeKeyword(condition.keyword)];
  if(param&&value!==null&&['param_gte','param_lte'].includes(key))return `${param} ${value} ${key==='param_gte'?'이상':'이하'}`;
  if(value!==null&&['hp_gte_pct','hp_lte_pct'].includes(key))return `체력 ${value}% ${key==='hp_gte_pct'?'이상':'이하'}`;
  if(key==='pp_gte'&&value!==null)return `P포인트 ${value} 이상`;
  if(keyword&&key==='keyword_state')return `${keyword} 상태일 때`;
  if(keyword&&value!==null){
    if(['keyword_gte','keyword_lte','keyword_eq'].includes(key))return `${keyword} ${value}${key==='keyword_eq'?'일 때':key==='keyword_gte'?' 이상':' 이하'}`;
    if(key==='keyword_turns_gte')return `${keyword} ${value}턴 이상`;
    if(key==='keyword_count_gte')return `${keyword} ${value}회 이상`;
  }
  if(key==='policy_change_gte'&&value!==null)return `지침 변경 ${value}회 이상`;
  if(key==='excluded_cards_gte'&&value!==null)return `제외된 스킬 카드 ${value}장 이상`;
  if(key==='prev_active_card')return '직전에 액티브 스킬 카드를 사용했을 때';
  if(key==='plan')return ({sense:'센스 플랜',logic:'로직 플랜',anomaly:'어노말리 플랜',free:'모든 플랜',common:'모든 플랜'})[condition.plan??condition.value]??conditionUnknown;
  const rarity=String(condition.rarity??condition.value??'').toUpperCase();
  if(key==='rarity'&&['R','SR','SSR','L','T'].includes(rarity))return `${rarity==='T'?'트러블':rarity==='L'?'레전드':rarity} 카드일 때`;
  return conditionUnknown;
}

function itemLimitLabel(limit) {
  if(!limit)return '원문에 횟수 제한 표기 없음';
  const count=integer(limit.count),unit=({per_produce:'육성당',per_lesson:'레슨당'})[limit.key];
  return unit&&count!==null&&count>=0?`${unit} 최대 ${count}회`:conditionUnknown;
}

function addValue(target, delta, multiplier=1) {
  for (const axis of axes) target.stats[axis] += delta.stats[axis] * multiplier;
  for (const key of Object.keys(target.resources)) target.resources[key] += delta.resources[key] * multiplier;
}

/** Resolve identity only; acquiring/equipping the item remains a separate check. */
export function supportBattleItemReference(card, catalog={}) {
  const item=card?.p_item;
  if (!item) return null;
  const matches=list(catalog.pItems).filter(row=>row.identityStatus==='exact' && !row.isUpgraded &&
    (item.gameId ? row.gameId===item.gameId : row.nameJa===item.name));
  if (matches.length!==1) return {status:'unmapped',connectable:false,reason:'동일 native/public P아이템의 단일 정확 매핑을 확인하지 못했습니다.'};
  const match=matches[0]; let definition;
  try { definition=PItems.getById(Number(match.internalId)); } catch {}
  if (!definition || definition.sourceType!=='support' || definition.name!==match.nameJa) return {status:'unmapped',connectable:false,reason:'공개 엔진의 동일 서포트 아이템 원본을 확인하지 못했습니다.'};
  return {status:'exact_native_public_reference',gameId:match.gameId,publicId:Number(match.internalId),nameJa:match.nameJa,
    mode:definition.mode,connectable:definition.mode==='stage',requiresConfirmedAcquisition:true,
    reason:definition.mode==='stage'?'획득·시점이 확인되면 전투 입력에 연결할 수 있는 아이템입니다.':'육성 중 효과이며 전투 효과로 넣지 않습니다.'};
}

function actionKind(row) {
  if (row.action==='copy' && (row.countsAsAcquisition===true || row.triggerCounts?.skill_acquire>0)) return 'acquire';
  return ({skill_change:'change',card_enhance:'upgrade',card_acquire:'acquire',card_delete:'remove',
    consultation:'consult',supply_gift:'activity_supply_gift',activity_supply:'activity_supply_gift'})[row.action ?? row.activity] ?? row.action ?? row.activity;
}

function timeline(route, options, examIndex) {
  const rows=[]; let precedingExams=0;
  for (const entry of [...list(route?.selections)].sort((a,b)=>(number(a.week)??0)-(number(b.week)??0))) {
    const kind=actionKind(entry), exam=['mid_exam','final_exam'].includes(kind);
    if (exam) precedingExams++;
    const action=exam?'exam_end':entry.main?'lesson_end':String(kind).startsWith('class_')?'class_work_end':kind;
    rows.push({...entry,action,fromExamIndex:precedingExams,stage:entry.stage??(precedingExams>=3 && !exam?'final':precedingExams>3?'final':'selection'),
      isSpLesson:entry.isSpLesson ?? (entry.main ? true : undefined),parameter:entry.main??entry.parameter,basis:'planned_route'});
  }
  const explicit=list(options.produceActions ?? route?.produceActions);
  for (let index=0;index<explicit.length;index++) {
    const entry=explicit[index],action=actionKind(entry);
    // A declared visit replaces the corresponding route visit, never adds a
    // second consult/gift trigger for the same stage/week.
    if (number(entry.week)!==null && ['consult','outing','activity_supply_gift','special_training','class_work_end','lesson_end','exam_end'].includes(action)) {
      const existing=rows.findIndex(row=>row.week===entry.week && row.action===action && stageOf(row)===stageOf(entry));
      if (existing>=0) rows.splice(existing,1);
    }
    rows.push({...entry,action,basis:entry.basis??'declared_produce_action',inputOrder:index});
  }
  return rows.filter(row=>integer(row.fromExamIndex)!==null && row.fromExamIndex>=0 && row.fromExamIndex<=examIndex)
    .sort((a,b)=>a.fromExamIndex-b.fromExamIndex || (number(a.week)??Infinity)-(number(b.week)??Infinity) || (number(a.sequence)??a.inputOrder??0)-(number(b.sequence)??b.inputOrder??0))
    .map((row,index)=>({...row,actionId:row.actionId??row.id??`${stageOf(row)}:${row.week??'unknown'}:${row.action}:${index}`}));
}

function triggerCheck(trigger, action) {
  const kind=trigger?.key;
  const simple={consult_selection:'consult',activity_supply_gift_selection:'activity_supply_gift',outing_end:'outing',
    special_training_start:'special_training',class_work_end:'class_work_end',exam_end:'exam_end',skill_change:'change',card_enhance:'upgrade'};
  if (simple[kind]) return action.action===simple[kind];
  if (kind==='param_lesson_end' || kind==='param_sp_lesson_end') return action.action==='lesson_end' &&
    (action.parameter??action.main)===trigger.param && (kind!=='param_sp_lesson_end' || action.isSpLesson===true);
  if (kind==='keyword_card_acquire' || kind==='keyword_card_enhance') {
    if (action.action!==(kind==='keyword_card_acquire'?'acquire':'upgrade')) return false;
    if (!Array.isArray(action.keywords)) return null;
    return action.keywords.map(nativeKeyword).includes(nativeKeyword(trigger.keyword));
  }
  if (kind==='card_acquire' || kind==='skill_acquire') return action.action==='acquire';
  if (kind==='plan_card_acquire') {
    if (action.action!=='acquire') return false;
    return ['sense','logic','anomaly','free'].includes(action.cardPlan) ? action.cardPlan===trigger.plan : null;
  }
  if (kind==='card_delete') return action.action==='remove';
  if (kind==='pdrink_acquire') return ['drink_acquire','drink_exchange'].includes(action.action);
  return undefined;
}

function conditionCheck(condition, action, plan, options) {
  if (!condition) return true;
  if (Array.isArray(condition)) return combine(condition.map(row=>conditionCheck(row,action,plan,options)));
  const snapshot=options.supportItemActionStates?.[action.actionId] ?? action;
  const stats=snapshot.parametersBefore??snapshot.statsBefore;
  const param=number(stats?.[condition.param]??stats?.[({vocal:'vo',dance:'da',visual:'vi'})[condition.param]]);
  const threshold=number(condition.threshold);
  if (['param_gte','param_lte'].includes(condition.key)) return param===null||threshold===null?null:condition.key==='param_gte'?param>=threshold:param<=threshold;
  if (['hp_gte_pct','hp_lte_pct'].includes(condition.key)) {
    const hp=number(snapshot.hpBefore),max=number(snapshot.maxHpBefore);
    return hp===null||max===null||max<=0||threshold===null?null:condition.key==='hp_gte_pct'?hp/max*100>=threshold:hp/max*100<=threshold;
  }
  if (condition.key==='pp_gte') { const pp=number(snapshot.pointsBefore);return pp===null||threshold===null?null:pp>=threshold; }
  if (condition.key==='plan') return compatible(condition.plan??condition.value,plan);
  if (condition.key==='rarity') return action.rarity==null?null:String(action.rarity).toLowerCase()===String(condition.rarity??condition.value).toLowerCase();
  return null;
}

function afterAcquisition(acquisition, action) {
  if (acquisition?.beforeProduce===true || acquisition?.beforeActions===true) return true;
  const start=integer(acquisition?.fromExamIndex);
  if (start===null) return null;
  if (action.fromExamIndex!==start) return action.fromExamIndex>start;
  const week=number(acquisition.week),actionWeek=number(action.week);
  if (week!==null && actionWeek!==null && week!==actionWeek) return actionWeek>week;
  const sequence=number(acquisition.sequence),actionSequence=number(action.sequence);
  if (sequence!==null && actionSequence!==null) return actionSequence>sequence;
  return null;
}

function bodyValue(body, unscored) {
  const result=emptyValue();
  const addParam=(param,value)=>{if(axes.includes(param)&&number(value)!==null)result.stats[param]+=Number(value);else unscored.add('P아이템 파라미터 종류·수치 미확인');};
  const operation=(kind,action,target='any',quantity=1,extra={})=>{
    if(Number.isInteger(quantity)&&quantity>0)result.operations.push({kind,cardAction:action,target,quantity,...extra,confirmed:false});
  };
  for (const effect of list(body)) {
    const value=number(effect.value),count=number(effect.count),turns=number(effect.turns);
    if (effect.key==='param_up') addParam(effect.param,value);
    else if (effect.key==='hp_recovery' && value!==null) result.resources.hpRecovery+=value;
    else if (effect.key==='pp_gain' && value!==null) result.resources.pp+=value;
    else if (effect.key==='param_up_hp' && value!==null && count!==null) {addParam(effect.param,value);result.resources.hpRecovery+=count;}
    else if (effect.key==='param_up_pp' && value!==null && count!==null) {addParam(effect.param,value);result.resources.pp+=count;}
    else if (effect.key==='param_up_pp_hp' && value!==null && count!==null && turns!==null) {addParam(effect.param,value);result.resources.pp+=count;result.resources.hpRecovery+=turns;}
    else if (effect.key==='pp_hp_recovery' && value!==null && count!==null) {result.resources.pp+=value;result.resources.hpRecovery+=count;}
    else if (effect.key==='hp_recovery_pp' && value!==null && count!==null) {result.resources.hpRecovery+=value;result.resources.pp+=count;}
    else if (['random_pdrink_count','random_pdrink_sr'].includes(effect.key)) {result.resources.pDrinkAcquisitions+=effect.key==='random_pdrink_count'?(count??0):1;unscored.add('랜덤 드링크의 종류·슬롯 초과·사용 효과는 수치화하지 않음');}
    else if (['param_up_random_pdrink','param_up_random_pdrink_sr'].includes(effect.key)) {addParam(effect.param,value);result.resources.pDrinkAcquisitions++;unscored.add('랜덤 드링크의 종류·슬롯 초과·사용 효과는 수치화하지 않음');}
    else if (effect.key==='acquire_pdrink_pp') {result.resources.pDrinkAcquisitions++;if(value!==null)result.resources.pp+=value;}
    else if (['param_up_select_change','param_up_select_copy'].includes(effect.key)) {addParam(effect.param,value);const change=effect.key==='param_up_select_change';operation(change?'select_change':'select_copy',change?'change':'copy');}
    else if (['random_enhance','select_enhance','select_cards_enhance','select_enhance_hp','random_enhance_hp','random_enhance_pp'].includes(effect.key)) {
      operation(effect.key,'upgrade','any',effect.key==='select_cards_enhance'?count:1);
      if(effect.key.endsWith('_hp')&&value!==null)result.resources.hpRecovery+=value;
      if(effect.key.endsWith('_pp')&&value!==null)result.resources.pp+=value;
    }
    else if (['select_delete','select_delete_pp','trouble_delete_pp','trouble_delete_hp','trouble_delete_param_up','select_delete_acquire_mental_card'].includes(effect.key)) {
      operation(effect.key,'remove',effect.key.startsWith('trouble_')?'trouble':'any');
      if(effect.key.endsWith('_pp')&&value!==null)result.resources.pp+=value;
      if(effect.key.endsWith('_hp')&&value!==null)result.resources.hpRecovery+=value;
      if(effect.key.endsWith('_param_up'))addParam(effect.param,value);
      if(effect.key==='select_delete_acquire_mental_card')operation(effect.key,'acquire','mental',1,{cardName:effect.card_name});
    }
    else if (effect.key==='select_copy_pp') {operation(effect.key,'copy');if(value!==null)result.resources.pp+=value;}
    else if (effect.key==='select_change') operation(effect.key,'change');
    else if (['select_skill_card_r_acquire','random_skill_card_r_acquire'].includes(effect.key))
      operation(effect.key,'acquire','any',1,{rarity:'R',upgradeCount:0});
    else if (['consult_discount','special_training_customize_discount'].includes(effect.key) && value!==null) result.discounts.push({kind:effect.key,percent:value,pointValue:null});
    else {result.operations.push({kind:effect.key,confirmed:false});unscored.add('P아이템 미계산 효과: '+effect.key);}
  }
  return result;
}

/** Fixed produce effects on a declared timeline; no default event time/max proc. */
export function evaluateSupportItemValue({card,plan,level,route={},options={},catalog={},examIndex=options.examIndex??5}={}) {
  const item=card?.p_item;
  if (!item) return null;
  const unscored=new Set(),effect=item.effect;
  const acquisition=options.supportItemAcquisitions?.[card.gameId]??null;
  const result={supportGameId:card.gameId,itemName:item.name,name:item.name,nameJa:item.name,status:'conditional',confirmed:false,
    triggerKey:effect?.trigger?.key??null,triggerMeta:effect?.trigger?structuredClone(effect.trigger):null,
    acquisition:{...acquisition,confirmed:acquisition?.confirmed===true},acquisitionConfirmed:false,
    applied:emptyValue(),byStage:{selection:emptyValue(),final:emptyValue()},potential:null,
    battleItem:supportBattleItemReference(card,catalog),unscored:[],
    calculationBasis:'declared_timeline_and_explicit_acquisition_only',recoveryIsNominal:true,
    notes:['체력 회복은 효과의 명목량입니다. 실제 회복은 현재/최대 체력과 비용을 연결한 자원 수지에서 제한해야 합니다.',
      '잠재 상한은 명시한 행동 범위 안에서만 산출하며 기회 확률·기대값이 아닙니다. 미확인 조건을 충족으로 판정하지 않습니다.']};
  const finish=()=>{
    result.unscored=[...unscored];result.limitations=[...result.unscored,...result.notes];
    result.conditions=[effect?.trigger?'발동: '+itemTriggerLabel(effect.trigger):'발동 조건 미확인',
      effect?.condition?'추가 조건: '+itemConditionLabel(effect.condition):effect?.restriction?conditionUnknown:'추가 조건 없음',
      itemLimitLabel(effect?.limit),
      result.acquisitionConfirmed?'획득 여부·선행 시점 입력 확인':'획득 여부 또는 선행 시점 입력 미확인'];
    result.summary=result.status==='unsupported'?'이 타임라인에서 수치로 계산하지 않는 효과입니다.':
      `확인된 조건의 발동 ${result.applied.activationCount}회. 미확인 획득·조건은 보장 합계에 넣지 않았습니다.`;
    const max=result.potential?.unknown?.max??emptyValue(),min=result.applied;
    result.potentialRanges={stats:Object.fromEntries(axes.map(axis=>[axis,[min.stats[axis],Math.max(min.stats[axis],max.stats[axis])]])),
      resources:Object.fromEntries(Object.keys(min.resources).map(key=>[key,[min.resources[key],Math.max(min.resources[key],max.resources[key])]]))};
    return result;
  };
  if (!effect) {result.status='unsupported';unscored.add('P아이템 구조화 원본 효과 없음');return finish();}
  const release=card.events?.find(event=>event.effect_type==='p_item')?.release;
  const required=String(release??'').match(/^lv(\d+)$/)?.[1];
  const levelEligible=!required?true:number(level)===null?null:Number(level)>=Number(required);
  const planEligible=compatible(card.plan,plan);
  const acquisitionInPrefix=acquisition?.beforeProduce===true || integer(acquisition?.fromExamIndex)!==null && acquisition.fromExamIndex<=examIndex;
  const confirmed=acquisition?.confirmed===true && acquisitionInPrefix && levelEligible===true && planEligible===true;
  result.acquisitionConfirmed=confirmed;
  const rows=timeline(route,options,examIndex);
  if (effect.trigger?.key==='plan_card_acquire') {
    for (const action of rows.filter(row=>row.action==='acquire')) {
      const gameId=action.gameId??action.card?.gameId;
      const variant=gameId && catalog.skillCards?.find(card=>card.gameId===gameId && card.upgradeCount===(action.upgradeCount??0));
      action.cardPlan=variant?.plan??action.cardPlan??action.card?.plan;
    }
  }
  const triggerSupported=triggerCheck(effect.trigger,{action:'__probe__'})!==undefined;
  const productionSupported=triggerSupported && !effect.restriction && (!effect.limit || effect.limit.key==='per_produce');
  const delta=bodyValue(effect.body,unscored);
  const limit=effect.limit?integer(effect.limit.count):Infinity;
  if (!productionSupported || limit===null || limit<0) {
    result.status='unsupported';unscored.add('육성 타임라인으로 평가하지 않는 발동/제한 조건: '+effect.trigger?.key);
    return finish();
  }
  const peakRoute=route.supportPeakScenario && typeof route.supportPeakScenario==='object'
    ? route.supportPeakScenario : route.supportPeakScenario===true ? route.supportActionPlan?.peakScenario : null;
  const peakCondition=(action)=>{
    const check=conditionCheck(effect.condition,action,plan,options);
    if(check!==null || !peakRoute || options.supportItemActionStates?.[action.actionId])return check;
    // Route income is a lower estimate of pre-action parameters. It can qualify
    // a >= gate, never a <= gate or a snapshot the player supplied.
    const condition=effect.condition;
    if(condition?.key!=='param_gte' || action.parametersBefore || action.statsBefore)return check;
    const estimate=number(peakRoute.statsBeforeWeek?.[action.week]?.[condition.param]);
    return estimate!==null && number(condition.threshold)!==null && estimate>=condition.threshold ? true : null;
  };
  const run=(start,optimistic,usePeak=false)=>{
    const total=emptyValue(),byStage={selection:emptyValue(),final:emptyValue()};let possiblyConsumed=0;
    // A different selected deck may lose an early typed target and reach the
    // same item's limit through a later baseline action instead.
    const eligibleRouteActions=usePeak && ['skill_change','card_enhance','card_delete','card_acquire','skill_acquire',
      'plan_card_acquire','keyword_card_acquire','keyword_card_enhance'].includes(effect.trigger?.key) ? [] : null;
    for (const action of rows) {
      if (possiblyConsumed>=limit&&!eligibleRouteActions) break;
      if (start?.referenceStage && stageOf(action)!==start.referenceStage) continue;
      const trigger=triggerCheck(effect.trigger,action);
      if (trigger===false) continue;
      const when=afterAcquisition(start,action),condition=usePeak?peakCondition(action):conditionCheck(effect.condition,action,plan,options);
      const eligible=combine([trigger,when,condition,levelEligible,planEligible]);
      const quantity=integer(action.quantity)>0?integer(action.quantity):1;
      if (eligible===false) continue;
      // Unknown earlier activations can consume a per-produce cap. Do not
      // guarantee a later stage's grant when that capacity may already be used.
      if (eligible!==true && !optimistic) {
        // In a conditional estimate use the verified qualifying opportunities.
        // An early unknown action still consumes capacity for guaranteed output.
        if(!usePeak)possiblyConsumed=Math.min(limit,possiblyConsumed+quantity);
        continue;
      }
      const count=Math.min(quantity,limit-possiblyConsumed);
      const record={actionId:action.actionId,action:action.action,week:action.week??null,fromExamIndex:action.fromExamIndex,stage:stageOf(action),count,
        triggerConfirmed:trigger===true,acquisitionOrderConfirmed:when===true,conditionConfirmed:condition===true,basis:action.basis};
      if(eligibleRouteActions)eligibleRouteActions.push({...record,count:quantity});
      if(count===0)continue;
      possiblyConsumed+=count;
      for (const target of [total,byStage[stageOf(action)]]) {
        addValue(target,delta,count);target.activationCount+=count;target.activations.push(record);
        target.operations.push(...delta.operations.map(row=>({...row,...record})));target.discounts.push(...delta.discounts.map(row=>({...row,...record})));
      }
    }
    return {total,byStage,...(eligibleRouteActions?{eligibleRouteActions}:{})};
  };
  if (confirmed) {const applied=run(acquisition,false);result.applied=applied.total;result.byStage=applied.byStage;}
  else unscored.add(levelEligible===false?'보유 레벨에서 P아이템 이벤트 미해금':planEligible===false?'P아이템 플랜 불일치':'P아이템 획득 여부·획득 시점이 확인되지 않아 보장 수치에 미합산');
  const early=run({beforeActions:true},true),late=run({fromExamIndex:3,week:0,referenceStage:'final'},true);
  // Known acquisition time narrows the unknown-condition bound. Otherwise use
  // the earliest allowed acquisition, never the item cap alone.
  const upper=run(acquisition?.beforeProduce===true||integer(acquisition?.fromExamIndex)!==null?acquisition:{beforeActions:true},true);
  result.potential={early:early.total,late:late.total,unknown:{min:result.applied,max:upper.total},
    basis:'early_before_all_declared_actions_late_before_final_actions_not_expected_value'};
  if(peakRoute && options.includeSupportEvents!==false && release && levelEligible===true && planEligible===true
      && (confirmed || acquisition===null)) {
    // The favorable run obtains the unlocked event at the first route step.
    // Opening memory receipts precede it; a user-specified later/absent item
    // never moves earlier. Unknown conditions do not grant free activations.
    const start=acquisition??options.supportPeakItemReceipt??{fromExamIndex:0,week:route.selections[0]?.week,sequence:-1};
    const projected=run(start,false,true);
    const supportEventEligibility=Object.fromEntries(['selection','final'].map(stage=>[stage,
      rows.some(action=>stageOf(action)===stage && action.week>0 && afterAcquisition(start,action)===true
        && peakCondition(action)===true)]));
    // The same early support skill receipts also contribute to the first
    // 15-card exam. A later threshold cannot retroactively trigger this item.
    const receiptWeek=peakRoute.supportReceiptWeek;
    const receipt=rows.find(row=>row.week===receiptWeek && row.basis==='planned_route');
    const supportReceiptEligibility={selection:Boolean(receipt && afterAcquisition(start,receipt)===true && peakCondition(receipt)===true),final:false};
    const supportEligibilityByWeek={};
    for(const action of rows.filter(row=>row.basis==='planned_route')) {
      const supportAction={...action,sequence:action.sequence??0};
      supportEligibilityByWeek[action.week]=afterAcquisition(start,supportAction)===true&&peakCondition(supportAction)===true;
    }
    result.peak={...projected,perActivation:{stats:delta.stats,resources:delta.resources,operations:delta.operations},supportEventEligibility,supportReceiptEligibility,supportEligibilityByWeek,
      acquisition:start,basis:confirmed?'declared_acquisition_projected_route':options.supportPeakItemReceipt?'planned_item_receipt_projected_route':'early_support_event_projected_route'};
  }
  if (rows.some(action=>triggerCheck(effect.trigger,action)===null)) unscored.add(effect.trigger?.key==='plan_card_acquire'
    ? '획득한 스킬 카드의 플랜 미확인' : '획득/강화 카드의 실제 키워드가 없어 P아이템 발동 여부 미확정');
  if (rows.some(action=>triggerCheck(effect.trigger,action)!==false && conditionCheck(effect.condition,action,plan,options)===null)) unscored.add('행동 직전 능력치·체력·P포인트 조건 미확인');
  if (confirmed && rows.some(action=>triggerCheck(effect.trigger,action)!==false && afterAcquisition(acquisition,action)===null)) unscored.add('같은 시험 구간 안의 획득/행동 순서 미확인. week 또는 sequence 필요');
  if (!rows.length) unscored.add('P아이템을 발동시킬 명시 행동 타임라인 없음');
  if (options.pItemCounts?.[card.gameId]!=null) unscored.add('총 발동 횟수만으로는 시점·조건을 검증할 수 없어 pItemCounts를 자동 합산하지 않음');
  result.status=confirmed?'confirmed_acquisition_conditional_timeline':'unconfirmed_acquisition';
  result.confirmed=confirmed && !rows.some(action=>{
    const trigger=triggerCheck(effect.trigger,action);
    return trigger!==false && combine([trigger,afterAcquisition(acquisition,action),conditionCheck(effect.condition,action,plan,options)])===null;
  });
  return finish();
}
