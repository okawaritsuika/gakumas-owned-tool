import { evaluateSupportItemValue } from './support-item-value.mjs';
import { supportLessonPPAt } from './hif-support-funding.mjs';

const list=value=>Array.isArray(value)?value:[];
const num=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
const integer=value=>Number.isInteger(num(value))?num(value):null;
const stageOf=row=>['selection','final'].includes(row.stage)?row.stage:num(row.week)!==null?(row.week>20?'final':'selection'):integer(row.fromExamIndex)!==null?(row.fromExamIndex>=3?'final':'selection'):null;
const normalize=value=>({supply_gift:'activity_supply_gift',activity_supply:'activity_supply_gift',final_exam:'exam_end',mid_exam:'exam_end',consultation:'consult'})[value]??value;
const range=(min=0,max=min)=>({min,max});
const addRange=(target,value)=>{target.min+=value.min??0;target.max=target.max===null||value.max===null?null:target.max+(value.max??0);};
const magnitude=(min,max)=>num(min)!==null&&num(max)!==null?range(Math.min(num(min),num(max)),Math.max(num(min),num(max))):null;
const compatible=(required,actual)=>!required||['free','common'].includes(required)?true:actual?required===actual:null;
const labelOf=activity=>({consult:'상담',activity_supply_gift:'차입',outing:'외출',class_work_end:'수업',lesson_end:'공개 레슨',exam_end:'시험',special_training:'특별 지도',rest:'휴식',interval:'인터벌',acquire:'카드 획득',upgrade:'카드 강화',remove:'카드 삭제',change:'카드 교환',copy:'카드 복사',customize:'커스텀',drink_exchange:'드링크 교환',drink_acquire:'드링크 획득',pp_gain:'P포인트 획득',hp_recover:'체력 회복',shop_discount:'상담 할인'})[activity]??activity;

function selectedRoute(candidate,result,options){
  const selected=list(candidate?.progression?.routes).find(row=>row.id===candidate?.progression?.selectedRouteId);
  return options.route??candidate?.scoreSummary?.hifModel??selected?.scoreSummary?.hifModel??result?.scoreSummary?.hifModel??{};
}

function declaredActions(candidate,options){
  const selected=list(candidate?.progression?.routes).find(row=>row.id===candidate?.progression?.selectedRouteId);
  const rows=Array.isArray(options.produceActions)?options.produceActions:list(candidate?.progression?.events).length?candidate.progression.events:list(selected?.events);
  const seen=new Set();
  return rows.filter(row=>{
    const key=row.id??JSON.stringify([row.action,row.gameId,row.fromExamIndex,row.week,row.sequence,row.quantity,row.venue]);
    if(seen.has(key))return false;seen.add(key);return true;
  }).map(row=>({...row,stage:stageOf(row)}));
}

function routeTimeline(route){
  let precedingExams=0;
  return [...list(route.selections)].sort((a,b)=>(num(a.week)??0)-(num(b.week)??0)).map(row=>{
    const activity=row.main?'lesson_end':String(row.activity).startsWith('class_')?'class_work_end':normalize(row.activity);
    const fromExamIndex=precedingExams;
    if(activity==='exam_end')precedingExams++;
    return {...row,activity,stage:stageOf(row),fromExamIndex,isSpLesson:row.main?row.isSpLesson!==false:row.isSpLesson};
  });
}

function emptyStage(stage,resources,options){
  const initial=num(typeof options.initialPP==='object'?options.initialPP?.[stage]:stage==='selection'?options.initialPP:null);
  return {stage,label:stage==='selection'?'선발':'본선',activityCounts:{},
    pp:{initial,gameBaseInitial:resources.hif.settings[stage==='selection'?'p_setting-7':'p_setting-8']?.initialProducePoint??null,
      knownIncome:0,knownSpend:0,balance:null,knownNet:0,incomeRange:range(),spendRange:range(),unpricedActions:[],carryFromSelection:false},
    stamina:{knownCost:0,knownRecovery:0,costRange:range(),potentialRecovery:range(),actualRemaining:null,recoveryIsNominal:true},
    cards:{knownAcquisitions:0,range:range(),troubleRange:range(),declaredTargets:[],actualDeckSize:null},
    drinks:{knownAcquisitions:0,range:range(),actualPossession:null,carryFromSelection:false,capacity:resources.hif.settings[stage==='selection'?'p_setting-7':'p_setting-8']?.produceDrinkPossessLimit??null},
    star:{lessonBaseIncome:0,declaredCardBaseIncome:null,potentialDeclaredCardBaseIncome:range(),examIncome:null,friendshipMultiplier:null,scoreMultiplier:null,total:null},
    activityRows:[]};
}

function rowFor(entry){
  return {week:num(entry.week),fromExamIndex:integer(entry.fromExamIndex),activity:entry.activity??entry.action,label:labelOf(entry.activity??entry.action),
    status:'planned_route',ppIncome:0,ppSpend:0,ppIncomeRange:range(),ppSpendRange:range(),
    cards:range(),troubleCards:range(),drinks:range(),staminaCost:0,staminaCostRange:range(),staminaRecovery:0,staminaRecoveryRange:range(),sourceIds:[],notes:[]};
}

function percentageRecovery(row,permil,stage,options){
  const max=num(typeof options.maxStamina==='object'?options.maxStamina?.[stage]:options.maxStamina);
  row.staminaRecovery=max===null?null:Math.floor(max*permil/1000);
  row.staminaRecoveryRange=max===null?range(0,null):range(row.staminaRecovery);
  row.recoveryPermil=permil;
  row.notes.push('회복은 최대 체력 기준 명목량이며 현재 체력을 넘는 회복은 실제로 적용되지 않습니다.');
}

function activityRow(entry,data,options){
  const row=rowFor(entry),hif=data.hif;
  if(entry.activity==='lesson_end'){
    const slot=hif.lessonWeeks[entry.week];
    const lesson=slot&&hif.lessons.find(item=>item.period===slot.period&&item.focus===slot.focus&&item.isSp===entry.isSpLesson&&(!entry.sub||item.sub===entry.sub));
    row.ppIncome=hif.publicLessonPP[entry.stage]??null;row.ppIncomeRange=range(row.ppIncome??0,row.ppIncome);
    row.staminaCost=lesson?.stamina??null;row.staminaCostRange=range(row.staminaCost??0,row.staminaCost);
    row.starBaseIncome=lesson?.star??null;row.sourceIds=['native-open-lessons','community-hif'];
    if(lesson)row.nativeLessonId=lesson.id;
    row.notes.push(entry.isSpLesson?'이 경로의 SP 레슨이 실제 발생한 조건입니다.':'일반 공개 레슨 조건입니다.');
  }else if(entry.activity==='activity_supply_gift'){
    row.ppIncome=hif.gift.pp;row.ppIncomeRange=range(row.ppIncome);row.cards=range(hif.gift.skillCardOpportunities);row.drinks=range(hif.gift.drinkOpportunities);
    row.sourceIds=hif.gift.sourceIds;row.drinkMinimumRarity=hif.gift.drinkMinimumRarity;
    row.notes.push('HIF 차입의 팬 보너스는 없습니다. 카드·드링크는 획득 기회 수이며 종류와 보관 잔고를 뜻하지 않습니다.');
  }else if(entry.activity==='outing'){
    const choiceId=options.activityChoices?.[entry.week]??entry.choiceId;
    const choice=hif.outing.choices.find(choice=>choice.id===choiceId);
    percentageRecovery(row,hif.outing.recoveryPermil,entry.stage,options);row.sourceIds=hif.outing.sourceIds;
    row.drinks=range(1);row.cards=choice?range(choice.normalCards+choice.upgradedCards):range(1,2);row.troubleCards=choice?range(choice.troubleCards):range(0,1);
    row.ppSpend=choice?choice.ppCost:null;row.ppSpendRange=choice?range(choice.ppCost):range(0,50);
    if(!choice){row.status='choice_unconfirmed';row.choices=hif.outing.choices;row.notes.push('선택지 미지정: 무료/50PP/졸음 추가 중 실제 선택을 확정하지 않았습니다.');}
  }else if(entry.activity==='class_work_end'){
    const choiceId=options.activityChoices?.[entry.week]??entry.choiceId;
    const early=hif.class.earlyWeeks.includes(entry.week),choiceKnown=['hp','effectA','effectB','trouble'].includes(choiceId);
    const trouble=choiceId==='trouble';
    row.staminaCost=choiceKnown?(trouble?0:hif.class.staminaCost):null;row.staminaCostRange=choiceKnown?range(row.staminaCost):range(0,hif.class.staminaCost);
    row.cards=early?(choiceKnown?range(trouble?0:1):range(0,1)):range();row.troubleCards=choiceKnown?range(trouble?1:0):range(0,1);
    row.selectChangeOpportunities=early?(choiceKnown?(trouble?1:0):null):1;row.sourceIds=hif.class.sourceIds;
    row.notes.push(early?'체력 선택지는 미강화 카드 1장 획득, 졸음 선택지는 셀렉트 체인지입니다.':'셀렉트 체인지는 새 카드 획득으로 중복 계산하지 않습니다.');
    if(!choiceKnown){row.status='choice_unconfirmed';row.notes.push('체력 5 소비/졸음 추가 선택이 확인되지 않았습니다.');}
  }else if(entry.activity==='exam_end'){
    row.ppIncome=null;row.ppIncomeRange=range(0,null);row.starBaseIncome=null;row.status='reward_unknown';
    row.sourceIds=['native-hif-settings','community-hif'];percentageRecovery(row,hif.settings[entry.stage==='selection'?'p_setting-7':'p_setting-8']?.beforeAuditionRefreshStaminaRecoveryPermil??500,entry.stage,options);
    row.notes.push('시험 직전 기본 회복을 표시합니다. 시험 중 체력 소비·획득 PP·스타성은 시험 결과와 실제 상태 미수집으로 계산하지 않습니다.');
  }else if(entry.activity==='rest'){
    percentageRecovery(row,hif.settings[entry.stage==='selection'?'p_setting-7':'p_setting-8']?.refreshStaminaRecoveryPermil??500,entry.stage,options);row.sourceIds=['native-hif-settings','community-hif'];
  }else if(entry.activity==='consult'){
    row.sourceIds=hif.consult.sourceIds;row.notes.push('방문만으로 PP를 쓰지 않습니다. 실제 구매·강화·삭제를 선언한 경우에만 아래 행동에 비용을 표시합니다.');
  }else if(entry.activity==='interval'){
    row.sourceIds=hif.interval.sourceIds;row.notes.push('인터벌은 상담과 별도 메뉴이며 상담 방문 효과를 발동시키지 않습니다.');
  }else if(entry.activity==='special_training'){
    row.sourceIds=['community-hif'];row.notes.push('특별 지도 커스텀은 선택·할인·단계가 명시된 행동만 가격을 확인합니다.');
  }else{
    row.status='unsupported_activity';row.ppIncome=null;row.ppIncomeRange=range(0,null);row.notes.push('이 활동의 자원 보상을 확인하지 못했습니다.');
  }
  return row;
}

function resolveCard(action,catalog){
  return list(catalog.skillCards).find(card=>card.gameId===action.gameId&&(card.upgradeCount??0)===(action.upgradeCount??0));
}

function actionRow(action,data,catalog,inventory,options){
  const row=rowFor(action),card=resolveCard(action,catalog),consult=['consult','consultation'].includes(action.venue),interval=action.venue==='interval';
  row.status='declared_conditional_action';row.gameId=action.gameId??null;row.card=card?{gameId:card.gameId,internalId:card.internalId,nameKo:card.nameKo,nameJa:card.nameJa,imageUrl:card.imageUrl}:null;
  row.sourceIds=action.sourceIds??(consult?data.hif.consult.sourceIds:interval?data.hif.interval.sourceIds:[]);
  if(action.action==='pp_gain' && num(action.amount)!==null) {
    row.ppIncome=action.amount;row.ppIncomeRange=range(action.amount);return row;
  }
  if(action.action==='hp_recover' && num(action.amount)!==null) {
    row.staminaRecovery=action.amount;row.staminaRecoveryRange=range(action.amount);return row;
  }
  if(action.action==='shop_discount') return row;
  const quantity=integer(action.quantity)>0?integer(action.quantity):1;
  const explicit=num(action.ppCost??action.cost?.pp);
  let base=null,priceRange=null;
  if(action.ppCostRange && num(action.ppCostRange.min)!==null && num(action.ppCostRange.max)!==null
    && action.ppCostRange.min>=0 && action.ppCostRange.max>action.ppCostRange.min){
    row.ppSpend=null;row.ppSpendRange=range(action.ppCostRange.min,action.ppCostRange.max);row.priceBasis='budget_reserved_for_unidentified_offer';
  } else if(explicit!==null&&explicit>=0){row.ppSpend=explicit;row.ppSpendRange=range(explicit);row.priceBasis='explicit_input';}
  else{
    if(consult&&action.action==='acquire'){
      const rarity=String(action.rarity??card?.rarity??'').toUpperCase();
      base=data.hif.consult.cardPrices[rarity]?.[action.upgradeCount??card?.upgradeCount??0]??null;
      if(base===null&&rarity==='R'&&(action.upgradeCount??0)===0)row.notes.push('미강화 R은 HIF 상담에 제시되지 않습니다.');
    }else if(consult&&action.action==='drink_exchange')base=data.hif.consult.drinkPrices[String(action.rarity??'').toUpperCase()]??null;
    else if(consult&&['upgrade','remove'].includes(action.action)){
      const index=integer(action.purchaseIndex);
      priceRange=index>0?data.hif.consult.enhanceDeletePrices[index-1]??null:range(100,null);
      if(index===null)row.notes.push('이 강화/삭제의 실제 가격 차수를 수집하지 않아 첫 가격 100만 하한으로 표시합니다.');
      if(priceRange?.status==='source_conflict')row.notes.push('6회째 가격 출처가 225/250으로 불일치합니다.');
      if(priceRange?.min===priceRange?.max)base=priceRange.min;
    }else if(action.action==='customize'){
      const custom=list(catalog.customizations).find(row=>row.gameId===action.customizationId||row.equivalentGameIds?.includes(action.customizationId));
      base=list(custom?.levels).find(level=>level.level===action.customizationLevel)?.price??null;
      if(base!==null)row.sourceIds=['native-customization'];
      row.notes.push('카드 커스텀의 native 단계별 기본 가격이며 특별 지도/아이템 할인은 별도 확인이 필요합니다.');
    }else if(interval&&action.action==='acquire')base=data.hif.interval.cardPrices[String(action.rarity??card?.rarity??'').toUpperCase()]?.[action.upgradeCount??card?.upgradeCount??0]??null;
    else if(interval&&action.action==='drink_exchange')base=data.hif.interval.drinkPrices[String(action.rarity??'').toUpperCase()]??null;
    row.basePrice=base;row.basePriceRange=priceRange;
    if(base!==null){
      const factors=[];
      if(consult&&['acquire','drink_exchange'].includes(action.action)){
        if(typeof action.sale==='boolean')factors.push(action.sale?0.7:1);
        else row.notes.push('SALE 여부가 미확인입니다.');
        if(action.action==='acquire'){
          const discount=inventory.hifBonuses?.status==='current_account'?num(inventory.hifBonuses?.[action.stage]?.shopCardDiscountPermil):null;
          if(discount!==null)factors.push(1-discount/1000);
          else row.notes.push('해당 시점의 HIF 카드 할인 패널 합계 미확인');
        }
      }
      const discount=num(action.confirmedDiscountPermil);
      if(discount!==null&&discount>=0&&discount<=1000)factors.push(1-discount/1000);
      const needsSale=consult&&['acquire','drink_exchange'].includes(action.action);
      const knownPanel=action.action!=='acquire'||!consult||inventory.hifBonuses?.status==='current_account'&&num(inventory.hifBonuses?.[action.stage]?.shopCardDiscountPermil)!==null;
      const allModifiersKnown=action.priceModifiersConfirmed===true&&(!needsSale||typeof action.sale==='boolean')&&knownPanel;
      if(allModifiersKnown){row.ppSpend=Math.floor(base*factors.reduce((n,f)=>n*f,1))*quantity;row.ppSpendRange=range(row.ppSpend);row.priceBasis='base_price_and_confirmed_modifiers';}
      else{row.ppSpend=null;row.ppSpendRange=range(0,base*quantity);row.notes.push('아이템·SALE·패널 할인 적용 여부를 모두 확인하지 않아 실제 지출은 범위로 남깁니다.');}
    }else{row.ppSpend=null;row.ppSpendRange=priceRange?range(priceRange.min*quantity,priceRange.max===null?null:priceRange.max*quantity):range(0,null);}
  }
  if(action.action==='acquire'||action.action==='copy'&&action.cardTargetResolved===true&&action.countsAsAcquisition===true){
    row.acquisitionTarget={gameId:action.gameId??null,name:card?.nameKo??card?.nameJa??action.name??null,quantity,fromExamIndex:integer(action.fromExamIndex),week:num(action.week),venue:action.venue??null};
    if(consult||interval||action.independentAcquisition===true||action.action==='copy')row.cards=range(quantity);
    else row.notes.push('목표 카드는 수업·외출·차입 등 기존 획득 기회와 중복될 수 있어 획득 수 총계에 다시 합산하지 않습니다.');
  }else if(action.action==='drink_exchange'||action.action==='drink_acquire')row.drinks=range(quantity);
  if(['automatic_remove','item_acquire','change'].includes(action.action)&&explicit===null){row.ppSpend=0;row.ppSpendRange=range();}
  if(['upgrade','remove','customize'].includes(action.action)&&!consult&&!interval&&explicit===null&&action.ppCost!==0)row.notes.push('상담/수업/아이템 등 실행 경로가 확인되지 않아 PP 비용을 확정하지 않았습니다.');
  return row;
}

function addRow(stage,row){
  stage.activityRows.push(row);
  stage.activityCounts[row.activity]=(stage.activityCounts[row.activity]??0)+1;
  if(num(row.ppIncome)!==null)stage.pp.knownIncome+=row.ppIncome;
  if(num(row.ppSpend)!==null)stage.pp.knownSpend+=row.ppSpend;
  addRange(stage.pp.incomeRange,row.ppIncomeRange);addRange(stage.pp.spendRange,row.ppSpendRange);
  if(num(row.ppSpend)===null)stage.pp.unpricedActions.push({week:row.week,action:row.activity,gameId:row.gameId??null,range:row.ppSpendRange});
  if(num(row.staminaCost)!==null)stage.stamina.knownCost+=row.staminaCost;
  if(num(row.staminaRecovery)!==null)stage.stamina.knownRecovery+=row.staminaRecovery;
  addRange(stage.stamina.costRange,row.staminaCostRange);addRange(stage.stamina.potentialRecovery,row.staminaRecoveryRange);
  stage.cards.knownAcquisitions+=row.cards.min;addRange(stage.cards.range,row.cards);addRange(stage.cards.troubleRange,row.troubleCards);
  stage.drinks.knownAcquisitions+=row.drinks.min;addRange(stage.drinks.range,row.drinks);
  if(row.acquisitionTarget)stage.cards.declaredTargets.push(row.acquisitionTarget);
  stage.star.lessonBaseIncome+=num(row.starBaseIncome)??0;
}

function matchingResourceActions(triggerId,timeline){
  if(['p_trigger-produce_start-initial','p_trigger-produce_start-no_description'].includes(triggerId))return [{stage:'selection',week:0,activity:'initial',fromExamIndex:0}];
  if(triggerId==='p_trigger-end_audition')return timeline.filter(row=>row.activity==='exam_end');
  if(triggerId==='p_trigger-start_present')return timeline.filter(row=>row.activity==='activity_supply_gift');
  const lesson=/^p_trigger-(?:start|end)_lesson-lesson_(vocal|dance|visual|sp)(_sp)?$/.exec(triggerId??'');
  if(lesson)return timeline.filter(row=>row.activity==='lesson_end'&&(lesson[1]==='sp'?row.isSpLesson:row.main===lesson[1]&&(!lesson[2]||row.isSpLesson)));
  return null;
}

function applyResourceEffect({effect,kind,limit,eligibility=null,owner,timeline,stages,output}){
  const type=effect.type??effect.directEffectType,resource=/ProducePointAdditionDisableTrigger$/.test(type??'')?'pp':/StaminaRecoverFix$/.test(type??'')?'hp':null;
  if(!resource)return;
  const values=magnitude(effect.min??effect.valueMin,effect.max??effect.valueMax),matches=matchingResourceActions(effect.triggerId??effect.trigger?.id,timeline);
  const record={...owner,kind,resource,triggerId:effect.triggerId??effect.trigger?.id,nominal:true,status:'partial',byStage:{selection:range(),final:range()},notes:[]};
  if(!values||!matches){record.notes.push('효과 수치 또는 발동 경로를 해석하지 못했습니다.');output.push(record);return;}
  const raw=num(effect.ratePermil??effect.probability?.rawPermil);
  const automaticStart=matches[0]?.activity==='initial'&&raw===0;
  const certain=eligibility===true&&(raw===1000||automaticStart||owner.source==='support'&&raw===0);
  if(eligibility===false){record.status='inapplicable';output.push(record);return;}
  let remaining=integer(limit)>0?integer(limit):Infinity;
  for(const action of matches){
    if(!stages[action.stage]||remaining<=0)continue;
    remaining--;
    const value=range(certain?values.min:0,values.max);addRange(record.byStage[action.stage],value);
  }
  record.status=certain&&values.min===values.max?'fixed_on_declared_route':'conditional_range';
  if(!certain)record.notes.push('확률·적용 조건이 확정되지 않아 기대값을 만들지 않았습니다.');
  if(integer(limit)>0)record.notes.push('발동 제한은 선언한 전체 경로에 한 번 적용했습니다. 선발/본선 간 제한 초기화 여부는 추가 확인이 필요합니다.');
  for(const [stageId,value] of Object.entries(record.byStage)){
    const stage=stages[stageId];
    if(resource==='pp'){
      if(stage.pp.initial!==null&&matches.some(a=>a.stage===stageId&&a.activity==='initial')){record.notes.push('직접 입력한 시작 잔고에 개시 보상이 포함됩니다.');continue;}
      stage.pp.knownIncome+=value.min;addRange(stage.pp.incomeRange,value);
    }
    else{stage.stamina.knownRecovery+=value.min;addRange(stage.stamina.potentialRecovery,value);}
  }
  output.push(record);
}

/** Resource amounts on the declared HIF route, never a captured live balance. */
export function buildProduceResourceLedger({candidate=null,result={},inventory={},catalog={},options={}}={}){
  const data=catalog.produceResources;
  if(!data?.hif)return {status:'unavailable',stages:[],supportEffects:[],supportItems:[],coverage:{implemented:[],partial:[],notIncluded:['HIF 자원 참고 데이터 없음']},unknowns:['produce_resources 카탈로그를 읽지 못했습니다.'],sources:[]};
  const scenario=options.scenario??candidate?.scoreSummary?.scenario??result?.scoreSummary?.scenario;
  if(scenario&&scenario!=='hif')return {status:'unsupported_scenario',stages:[],supportEffects:[],supportItems:[],coverage:{implemented:[],partial:[],notIncluded:['初·NIA의 활동 자원 수지']},unknowns:['HIF 전용 값을 다른 시나리오에 적용하지 않았습니다.'],sources:data.sources};
  const route=selectedRoute(candidate,result,options),timeline=routeTimeline(route),actions=declaredActions(candidate,options);
  const funding=route.supportActionPlan?.peakScenario?.supportFunding??route.supportPeakScenario?.supportFunding;
  const stageMap=Object.fromEntries(['selection','final'].map(stage=>[stage,emptyStage(stage,data,options)]));
  const unknowns=['실제 현재 P포인트·체력·드링크 잔고와 무작위 보상 이력을 수집하지 않았습니다.','시험 성적에 따른 P포인트·스타성, 친애도 배율을 계산하지 않았습니다.','획득 목표의 등장 확률과 상담에서의 판매 확률은 알 수 없습니다.'];
  const visitDrinks=new Map();
  for(const entry of timeline){
    if(!stageMap[entry.stage]){unknowns.push('시기를 확인하지 못한 활동: '+entry.activity);continue;}
    const row=activityRow(entry,data,options);
    if(entry.activity==='lesson_end'&&funding&&Number.isFinite(row.ppIncome)){
      const extra=supportLessonPPAt(funding,entry,data.hif.publicLessonPP[entry.stage]);
      row.ppIncome+=extra;addRange(row.ppIncomeRange,range(extra));
      if(extra) row.notes.push('이 편성에서 레슨 종료 시 받는 추가 '+extra+' PP를 반영했습니다.');
    }
    addRow(stageMap[entry.stage],row);
    const storyPP=funding?.ppByWeek?.[entry.week]??0;
    if(storyPP>0){
      const grant=rowFor({...entry,activity:'support_story_pp'});
      grant.label='서포트 스토리 P포인트';grant.ppIncome=storyPP;grant.ppIncomeRange=range(storyPP);
      grant.notes.push('이 주차의 고정 스토리 보상을 받고 다음 주차부터 구매에 사용하는 조건입니다.');
      addRow(stageMap[entry.stage],grant);
    }
    if(row.drinks.min>0)visitDrinks.set(`${entry.stage}:${entry.week}:${entry.activity}`,row.drinks.min);
  }
  for(const action of actions){
    if(!stageMap[action.stage]){unknowns.push('시기를 확인하지 못한 선언 행동: '+action.action);continue;}
    const row=actionRow(action,data,catalog,inventory,options);
    if(action.action==='drink_acquire' && !action.independentAcquisition){
      const key=`${action.stage}:${action.week}:${normalize(action.venue)}`;
      const credited=visitDrinks.get(key)??0,overlap=Math.min(credited,row.drinks.min);
      if(overlap){
        visitDrinks.set(key,credited-overlap);
        row.drinks=range(row.drinks.min-overlap,row.drinks.max-overlap);
        row.notes.push('이 방문에서 이미 센 드링크 획득 기회를 합계에 한 번 반영했습니다.');
      }
    }
    addRow(stageMap[action.stage],row);
  }
  const supports=candidate?.supports??result.supports??[];
  const selectedSupports=Array.isArray(supports)?supports:[...list(supports.owned),...(supports.rental?[supports.rental]:[])];
  const supportEffects=[],supportItems=[];
  const plan=candidate?.scoreSummary?.plan??result.scoreSummary?.plan;
  for(const selected of selectedSupports){
    const base=list(catalog.supportCards).find(card=>card.gameId===selected.gameId)??selected,card={...base,...selected};
    const level=num(selected.level);
    if(level===null){unknowns.push((card.nameKo??card.nameJa??card.gameId)+' 서포트 레벨 미확인');continue;}
    const latest=new Map();
    for(const ability of list(card.levelAbilities))if(ability.level<=level&&(!latest.has(ability.order)||latest.get(ability.order).level<=ability.level))latest.set(ability.order,ability);
    for(const ability of latest.values()){
      const eligibility=compatible(ability.plan,plan);
      const scenarioOK=!ability.scenarioEnum||/Unknown|HatsuboshiIdolFestival/.test(ability.scenarioEnum);
      const splitOK=!ability.splitEnum||/_Unknown$/.test(ability.splitEnum)?true:options.splitType?ability.splitEnum===options.splitType:null;
      for(const effect of list(ability.effects)){
        if(/SupportCardEvent(ProducePointAdditionValueUp|StaminaRecoverValueUp)$/.test(effect.type??'')){
          supportEffects.push({source:'support',gameId:card.gameId,name:card.nameKo??card.nameJa,level,kind:ability.kind,resource:'event_modifier',modifierPermil:num(effect.min),status:'event_base_and_timing_unknown',notes:['서포트 이벤트의 기초 보상·발생 시점이 없어 배율을 실제 PP/회복량으로 변환하지 않았습니다.']});continue;
        }
        applyResourceEffect({effect,kind:ability.kind,limit:ability.activationLimit,eligibility:!scenarioOK||eligibility===false||splitOK===false?false:eligibility===null||splitOK===null?null:true,
          owner:{source:'support',gameId:card.gameId,name:card.nameKo??card.nameJa,level},timeline,stages:stageMap,output:supportEffects});
      }
    }
    const itemTimeline=timeline.map(row=>({...row,activity:row.activity==='exam_end'?'final_exam':row.activity}));
    const value=evaluateSupportItemValue({card,plan,level,route:{...route,selections:itemTimeline},options:{...options,produceActions:actions},catalog});
    if(value){
      supportItems.push(value);
      for(const stageId of ['selection','final']){
        const applied=value.byStage?.[stageId]?.resources,stage=stageMap[stageId];
        if(!applied)continue;
        stage.pp.knownIncome+=applied.pp??0;addRange(stage.pp.incomeRange,range(applied.pp??0));
        stage.stamina.knownRecovery+=applied.hpRecovery??0;addRange(stage.stamina.potentialRecovery,range(applied.hpRecovery??0));
        stage.drinks.knownAcquisitions+=applied.pDrinkAcquisitions??0;addRange(stage.drinks.range,range(applied.pDrinkAcquisitions??0));
      }
    }
  }
  const seenMemoryEffects=new Set();
  for(const memory of list(candidate?.memories??result.memories))for(const effect of list(memory.modelEffects?.conditionalEffects)){
    if(effect.applies===false)continue;
    const key=effect.uniqueKey;
    if(key&&seenMemoryEffects.has(key))continue;if(key)seenMemoryEffects.add(key);
    applyResourceEffect({effect,kind:effect.kind,limit:effect.activationLimit,eligibility:effect.applies,
      owner:{source:'memory',gameId:memory.gameId??memory.id,name:memory.nameKo??memory.nameJa},timeline,stages:stageMap,output:supportEffects});
  }
  const bonuses=inventory.hifBonuses?.status==='current_account'?inventory.hifBonuses:null;
  let remainingBadges=data.hif.star.cardAcquisitionCap;
  for(const stage of Object.values(stageMap)){
    // Account start grants are not a claim about a current live PP balance.
    const bonus=num(stage.stage==='selection'?bonuses?.selection?.initialPP:bonuses?.finalOnly?.initialPP);
    if(bonus!==null){
      if(stage.pp.initial===null){stage.pp.knownIncome+=bonus;addRange(stage.pp.incomeRange,range(bonus));}
      stage.pp.accountInitialGrant=bonus;
    }
    else stage.pp.accountInitialGrant=null;
    const opening=funding?.initialPP?.[stage.stage]??0;
    if(opening&&stage.pp.initial===null){
      const credited=supportEffects.filter(effect=>effect.source==='support'&&effect.kind==='initial_pp')
        .reduce((n,effect)=>n+(effect.byStage?.[stage.stage]?.min??0),0);
      const extra=Math.max(0,opening-credited);
      stage.pp.knownIncome+=extra;addRange(stage.pp.incomeRange,range(extra));
    }
    const acquisitionCount=actions.filter(action=>action.stage===stage.stage && (action.action==='acquire'
      || action.action==='copy'&&action.cardTargetResolved===true&&action.countsAsAcquisition===true)).reduce((sum,action)=>sum+(integer(action.quantity)>0?integer(action.quantity):1),0);
    const badgeCount=Math.min(acquisitionCount,remainingBadges);
    stage.star.potentialDeclaredCardBaseIncome=range(0,badgeCount*data.hif.star.cardAcquisitionBase);
    remainingBadges-=badgeCount;
    stage.star.notes=data.hif.star.notes;
    stage.pp.knownNet=(stage.pp.initial??0)+stage.pp.knownIncome-stage.pp.knownSpend;
    stage.activityRows.sort((a,b)=>(a.week??Infinity)-(b.week??Infinity));
  }
  if(!timeline.length)unknowns.push('선택한 육성 경로의 주차별 활동이 없습니다.');
  return {status:timeline.length?'partial_resource_ledger':'missing_route',asOf:data.asOf,scope:'conditional_route',basis:'chosen_route_and_declared_actions_not_live_inventory',
    stages:Object.values(stageMap),supportEffects,supportItems,
    coverage:{implemented:['선택한 공개 레슨의 기본 PP·native 체력 비용·기본 스타성','차입의 80PP·카드 1회·SR 이상 드링크 1회','외출·수업의 선택지별 비용/획득 범위','명시한 상담 행동의 기본 가격·확인 할인·가격 충돌','현재 서포트 레벨의 고정 자원 효과와 메모리 자원 효과','획득 시점·조건이 확인된 P아이템의 명목 자원량','선발/본선 PP·드링크 비계승'],
      partial:['체력 회복은 현재 체력에 따른 초과분을 자르기 전 명목량','미지정 선택지·랜덤 발동은 범위이며 기대값이 아님','P아이템 미획득/획득 시점 미확인 효과는 잠재 범위만 별도 표시','상담 가격 차수·SALE·할인 전부 확인 시에만 지출 확정','HIF 와펜은 선언 획득분의 기본 스타 상한만 표시','시험 전 회복은 native 기본 50%까지만 표시하며 추가 계정·아이템 보정은 미연결'],
      notIncluded:['실시간 PP 잔고와 PP 부족에 따른 실행 가능성','시험 성적별 PP·스타성 및 친애도·스타성 점수 배율','랜덤 이벤트 원보상과 PP·회복 보너스의 실제 적용','드링크 종류별 효과·사용·폐기·슬롯 초과','카드/아이템 등장 확률과 전체 육성 결과의 기대값']},
    unknowns:[...new Set(unknowns)],sources:data.sources};
}
