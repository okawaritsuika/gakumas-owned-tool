import { niaAuditionTarget } from './nia-choice-advice.mjs';
import PDrinks from './vendor/gakumas-data/data/pDrinks.js';

const list = value => Array.isArray(value) ? value : [];
const amount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const axis = {vo:'보컬',da:'댄스',vi:'비주얼',vocal:'보컬',dance:'댄스',visual:'비주얼'};
const names = {
  lesson:'레슨', sp_lesson:'레슨', self_lesson:'자율 레슨', legend_lesson:'레전드 레슨',
  intensive_lesson:'막판 스퍼트 레슨', consult:'상담', outing:'외출', rest:'휴식',
  activity_supply:'활동 지급', supply_gift:'사시이레', class:'수업', business:'영업', special_training:'특별지도',
};
const exam = /^(?:(?:hajime|legend)_(?:mid|final)_exam|(?:mid|final)_exam|audition_(?:first|second|final)|exam)$/;
const normalLesson = /^(?:lesson|sp_lesson|self_lesson|(?:vo|da|vi)_(?:(?:sp_)?lesson_(?:vo|da|vi)|legend_lesson))$/;
const activityName = row => names[row.activity] ??
  (row.activity === 'interval' ? '인터벌' : row.activityLabel ?? row.label ?? '화면에 열린 행동');
const numberText = value => value.toLocaleString('ko-KR');
const ordinaryReasons = {
  consult:'시험에 쓸 카드나 드링크를 준비할 수 있어요.',
  special_training:'강화한 주력 카드의 효과를 다음 시험에 맞출 수 있어요.',
  outing:'회복하거나 화면에 열린 외출 보상으로 덱을 보완할 수 있어요.',
  rest:'다음 행동에 쓸 체력을 회복할 수 있어요.',
  activity_supply:'지금 부족한 카드나 드링크가 제시되면 보충할 수 있어요.',
  supply_gift:'화면에 열린 카드나 드링크로 다음 시험을 준비할 수 있어요.',
  business:'다음 오디션에 필요한 팬 투표와 영업 보상을 얻어요.',
  class:'필요한 속성과 덱을 함께 보완할 수 있어요.',
  intensive_lesson:'시험 직전 부족한 속성을 보완할 기회예요.',
  legend_lesson:'클리어 후 레전드 보너스로 세 속성을 보완할 수 있어요.',
};

function lessonAdvice(activities, preferred, advice, live, canRollSp, modeledAxis) {
  const lessons = activities.filter(row => normalLesson.test(row.activity));
  const regular = row => {
    const attribute = axis[row.axis ?? row.activity.split('_')[0]] ?? axis[modeledAxis];
    return (attribute ? attribute+' ' : '') + (row.activity==='self_lesson'?'자율 레슨':
      row.activity.endsWith('_legend_lesson')?'일반 레전드 레슨':'일반 레슨');
  };
  const preferredLesson = lessons.find(row => row === preferred) ?? lessons[0];
  const native = list(advice.activities).filter(row => row.family === 'lesson');
  if (native.length && Array.isArray(live.spLessonAttributes)) {
    const shown = native.slice().sort((a,b)=>Number(b.planned)-Number(a.planned)).flatMap(row=>
      row.choices.filter(choice=>choice.offered===true && choice.resourceAffordable!==false &&
        !(choice.isSp && live.spLessonStatus==='blocked')).map(choice=>({row,sp:choice.isSp})));
    shown.sort((a,b)=>Number(b.sp)-Number(a.sp));
    const label = ({row,sp})=>regular(row).replace('일반 레슨',sp?'SP 레슨':'일반 레슨');
    const [first,...alternatives] = [...new Set(shown.map(label))];
    const reason = shown[0]?.sp ? '오늘 열린 SP 레슨에서 일반 레슨보다 기본 상승량을 더 얻을 수 있어요.' :
      live.spLessonAttributes.length ? '현재 조건에서 진행할 수 있는 일반 레슨이에요.' : '오늘은 SP 레슨이 뜨지 않았어요.';
    return {confirmed:true,press:first??'진행 가능한 레슨을 확인하지 못했어요.',
      why:first?reason:'현재 체력과 오늘 열린 레슨을 확인했어요.',
      fallback:alternatives.length?alternatives.join(' · '):'게임 화면에 다른 선택이 열려 있는지 확인하세요.'};
  }
  const bestNative = (sp, allowed) => {
    const choices = native.filter(row=>row.choices.some(choice=>choice.isSp===sp&&allowed(choice)));
    return choices.find(row=>row.planned) ?? choices[0];
  };
  const shownNormal = bestNative(false, row => row.offered === true && row.resourceAffordable !== false);
  const allNormalBlocked = native.length && !bestNative(false, row=>row.canChoose!==false);
  const rest = activities.some(row=>row.activity==='rest');
  const other = activities.filter(row=>!normalLesson.test(row.activity)&&row.activity!=='rest').map(activityName);
  const recovery = rest ? '휴식이 열려 있으면 회복하세요.' : other.length ?
    '진행할 수 있는 '+[...new Set(other)].join('·')+'을 확인하세요.' :
    '다른 속성의 레슨도 진행할 수 없으면 그날의 게임 안내를 확인하세요.';
  const normal = shownNormal ? regular(shownNormal) : regular(preferredLesson);
  const fallback = allNormalBlocked || (live.spLessonStatus==='blocked'&&!shownNormal) ?
    (allNormalBlocked ? recovery : '진행할 수 있는 일반 레슨이 있으면 고르고, 없으면 '+recovery) :
    normal+'이 열려 있고 진행할 수 있으면 선택하세요. 어려우면 '+recovery;
  if (!canRollSp) return {press:regular(preferredLesson), why:'이번 레슨에서 필요한 속성을 올려요.', fallback:recovery};
  const sp = bestNative(true, row=>row.offered===true && row.resourceAffordable!==false);
  const observed = live.spLessonStatus ?? (Array.isArray(live.spLessonAttributes) ?
    (sp ? 'available' : live.spLessonAttributes.length ? 'blocked' : 'absent') : null);
  const observedAxis = axis[live.spLessonAxis];
  const spName = sp ? regular(sp).replace('일반 레슨','SP 레슨') : observedAxis ? observedAxis+' SP 레슨':'진행 가능한 SP 레슨';
  if (observed==='available') return {spStatus:observed, press:spName, why:'같은 날의 일반 레슨보다 기본 상승량을 더 얻을 수 있어요.', fallback};
  if (observed==='absent' || observed==='blocked') return {
    spStatus:observed, press:allNormalBlocked ? (rest?'휴식이 열렸다면 선택':'진행 가능한 다른 행동 확인') :
      (shownNormal ? normal : normal+'을 진행할 수 있으면 선택'),
    why:observed==='absent'?'이번 주에는 SP 레슨이 뜨지 않았어요.':'현재 체력으로는 뜬 SP 레슨을 진행하기 어려워요.',
    fallback:recovery,
  };
  return {press:'SP가 떴다면 진행 가능한 SP 레슨', why:'같은 날의 일반 레슨보다 기본 상승량을 더 얻을 수 있어요.', fallback};
}

const bracelet = {id:'pitem_00-3-002-0',name:'하츠보시 팔찌',
  use:'이후 SP 레슨을 마칠 때 체력 3을 써서 시험에 쓸 카드를 강화', type:'enhance'};
const businessItems = [
  {id:'pitem_00-3-098-0',name:'N.I.A 토트백',type:'drink',use:'이후 기업 이벤트 회장 영업을 마칠 때 시험용 드링크 2개 획득'},
  {id:'pitem_00-3-097-0',name:'N.I.A 스마트폰 링',type:'enhance',use:'이후 상업 시설 영업을 마칠 때 시험에 쓸 카드 1장 강화'},
  {id:'pitem_00-3-099-0',name:'N.I.A 패스 케이스',type:'pp',use:'이후 지자체 회장 영업을 마칠 때 특별지도·상담에 쓸 40P 획득'},
];
const proItemSets = {
  sense:[100, '집중', '호조', '보라', '01'],
  logic:[102, '호인상', '의욕', '흰색', '02'],
  anomaly:[104, '전력·온존', '강기·온존', '검정', '03'],
};
const proItemPriority = {concentration:0,goodConditionTurns:1,goodCondition:1,
  goodImpressionTurns:0,goodImpression:0,motivation:1,fullPower:0,strength:1,aggressive:1};
const basicExamItems = {
  sense:[['01-3-003','하츠보시 수첩','턴 시작에 집중 5 이상이면 카드 사용 +1·집중 +2'],
    ['01-3-004','하츠보시 티셔츠','턴 시작에 호조라면 카드 사용 +1·호조 2턴']],
  logic:[['02-3-005','하츠보시 키홀더','턴 시작에 호인상 3 이상이면 카드 사용 +1·호인상 +3'],
    ['02-3-006','마스코트 (비공인)','턴 시작에 의욕 5 이상이면 카드 사용 +1·의욕 +3']],
  anomaly:[['03-3-007','하츠보시 시계','턴 시작에 전력치 3 이상이면 카드 사용 +1·전력치 +3'],
    ['03-3-008','하츠보시 피규어','턴 시작에 강기라면 온존 2단계·카드 사용 +1']],
};
const legendExamItems = {
  sense:['01',186,'주황','호조 5턴','집중 +5',1],
  logic:['02',188,'흰색','호인상 +5','의욕 +5',0],
  anomaly:['03',190,'검정','강기 카드 상승량 +10','전력 카드 상승량 +10',1],
};
const preferredEffect = score => proItemPriority[score.trainingType];

function dayPicks(activity, book, catalog, advice, result, week) {
  const guide=list(result.hifGuide?.days).find(day=>day.week===week)?.activities.find(row=>row.activity===activity);
  if(guide?.channel) return {
    cards:guide.cards.slice(0,2),
    drinks:guide.drinks.slice(0,2).map(drink=>({...drink,name:drink.nameKo})),
  };
  const options = list(advice.activities).find(row=>row.activity===activity)?.choices ?? [];
  const gift = activity==='supply_gift';
  const shop = ['consult','interval'].includes(activity);
  const givesCards = gift || shop || activity==='activity_supply' ||
    options.some(row=>row.rewards?.cardAcquisitionOpportunities>0 || row.rewards?.normalCards>0);
  const givesDrinks = gift || shop || activity==='activity_supply' ||
    options.some(row=>row.rewards?.drinkOpportunities>0);
  const cards = list(book.takeCards).filter(card=>card.source==='during_run_target' &&
    card.availability==='eligible_target' && !card.alreadySelectedMemory && card.name &&
    !card.conditions?.requiresHifAbility)
    .sort((a,b)=>Number(b.guideAction==='take')-Number(a.guideAction==='take'));
  const accessibleTargets=new Set([...cards,...list(book.takeCards).filter(card=>card.availability==='selected')].map(card=>card.gameId));
  const visuals = new Map(list(catalog.drinkVisuals?.drinks).map(drink=>[String(drink.id),drink]));
  const drinks = [...new Map(list(book.drinks).filter(drink=>drink.available===true &&
    (!drink.conditions?.requiresCardTargetId || accessibleTargets.has(drink.conditions.requiresCardTargetId)) &&
    (!gift || ['SR','SSR'].includes(PDrinks.getById(drink.id)?.rarity?.toUpperCase())))
    .map(drink=>[String(drink.id),drink])).values()];
  return {
    cards:givesCards ? cards.slice(0,2) : [],
    drinks:givesDrinks ? drinks.slice(0,2).map(drink=>{
      const visual=visuals.get(String(drink.id));
      return {...drink,name:visual?.nameKo??drink.name,imageUrl:visual?.thumbnailUrl??visual?.imageUrl};
    }) : [],
  };
}

function supportChoice(result, week, preferred, activities) {
  const action = {supply_gift:'activity_supply_gift',outing:'outing',consult:'consult'}[preferred];
  if (!action || !activities.some(row=>row.activity!==preferred)) return '';
  for (const card of list(result.supports)) {
    const value=card.supportItemValue, name=card.nameKo??card.name;
    const grant=list(card.p_item?.effect?.body).find(effect=>['param_up','param_up_hp','param_up_pp','param_up_pp_hp'].includes(effect.key));
    const hit=value?.acquisitionConfirmed && list(value.applied?.activations).find(row=>row.week===week && row.action===action &&
      row.triggerConfirmed && row.acquisitionOrderConfirmed && row.conditionConfirmed);
    const label=axis[grant?.param], points=grant?.value;
    if (name && hit && label && points>0) return name+'의 P아이템으로 '+label+' +'+points;
  }
  return '';
}
function examRewardItems(score, legend) {
  if (!legend) return list(basicExamItems[score.plan]).map(([id,name,use],index)=>({
    id:'pitem_'+id+'-0',name,use:'이후 시험에서 '+use,preferred:preferredEffect(score)===index,
  }));
  const setup = legendExamItems[score.plan];
  const when = '이후 레슨·시험 시작에 R 이상 카드가 21장 이상이면 ';
  const badge = {id:'pitem_00-3-192-0',name:'하츠보시 기장',use:when+'체력 7 회복·기본 카드 제외'};
  if (!setup) return [badge];
  const [plan,start,color,first,second,offset] = setup;
  return [badge,...[first,second].map((effect,index)=>({
    id:`pitem_${plan}-3-${start+index}-0`,name:`${index?'유리 하츠미':'하츠보시 메달'} (${color})`,
    use:when+effect+'·기본 카드 제외',preferred:preferredEffect(score)===(index+offset)%2,
  }))];
}

function niaMasterFinalItems(score) {
  const setup = proItemSets[score.plan];
  if (!setup) return [];
  const [,first,second,color,plan] = setup;
  const effects = score.plan==='sense' ? [second,first] : [first,second];
  const start = {sense:176,logic:178,anomaly:180}[score.plan];
  return effects.map((effect,index)=>({
    id:`pitem_${plan}-3-${start+index}-0`,name:`N.I.A ${index?'라이트':'밴드'} (금·${color})`,
    use:`최종 오디션 턴 시작 후 덱·버린 카드가 ${score.plan==='anomaly'?18:12}장 이상일 때 `+
      (score.plan==='anomaly'?`${effect.split('·')[0]} 카드 성장`:`드로우·${effect} 보완`),
    preferred:preferredEffect(score)===(score.plan==='sense'?1-index:index),
  }));
}

function hifReward(catalog, score, week, guidePath) {
  const stage = [7,13,20].indexOf(week.week);
  const reference = catalog.produceResources?.hif?.scenarioItemPaths;
  if (stage<0 || !reference) return null;
  const peak = score.hifModel?.supportActionPlan?.peakScenario;
  const planned = reference.paths[peak?.scenarioItem?.id]?.formKeys[stage];
  const timings = {lesson:'공개 레슨',consult:'상담',supply_gift:'사시이레',outing:'외출',class:'수업'};
  const items = Object.entries(reference.forms).filter(([,form])=>form.fromExamIndex===stage+1 && form.nativeByPlan?.[score.plan])
    .map(([key,form])=>{
      const color = {red:'빨간',green:'초록',yellow:'노란'}[key.split('_')[0]];
      const effects = form.effects.map(effect=>({
        hp_recover:'체력 '+effect.amount+' 회복', pp_gain:'다음 구매에 쓸 '+effect.amount+'P 확보',
        drink_acquire:(effect.designated?'지정 드링크':'드링크')+' '+effect.quantity+'개 획득',
        shop_discount:({drink_exchange:'드링크 교환',upgrade:'강화',remove:'삭제',acquire:'카드 구매'}[effect.category])+' '+effect.amount/10+'% 할인',
        acquire:(effect.upgradeCount>0?'강화 ':'')+'카드 선택 획득'+(effect.rarity==='SSR'?' (SSR 고확률)':''), change:'카드 체인지',
        upgrade:effect.selectionMode==='random'?'무작위 카드 강화':'주력 카드 강화', remove:'카드 삭제', copy:'카드 복제',
      })[effect.action]).filter(Boolean);
      const name = [color,form.nameKo].filter(Boolean).join(' ');
      const trigger=timings[form.trigger];
      const triggerTiming=form.trigger==='consult'?' 선택 시':' 종료 시';
      const guide=guidePath?.stages.find(item=>item.formKey===key);
      const art=catalog.hifItemVisuals?.byGameId?.[form.nativeByPlan[score.plan]];
      return {id:form.nativeByPlan[score.plan],name,gameName:form.nameJa,formKey:key,fromExamIndex:form.fromExamIndex,
        imageUrl:art?.nameJa===form.nameJa ? art.imageUrl : null,
        timing:(guide?.timingKo?guide.timingKo+' 시':trigger+triggerTiming)+' · 최대 '+form.useLimit+'회',
        effect:guide?.effects.map(effect=>effect.textKo).filter(Boolean).join(' · ') || effects.join(' · '),
        examStart:guide?.examStart,
        use:trigger && effects.length ? trigger+'에서 '+effects.join('·') : null,
        preferred:key===planned};
    });
  return {label:stage===0?'선발시험 뒤 포치 선택':'선발시험 뒤 포치 개조',items};
}

function scenarioReward({week,score,catalog,difficulty,eventModeId,result}) {
  if (eventModeId) return null;
  if (score.scenario==='hif' && week.stage==='selection') return hifReward(catalog,score,week,result.hifGuide?.itemPath);
  const reward = items => ({label:'합격 뒤 P아이템 선택',items});
  if (week.activity==='legend_mid_exam') return reward(examRewardItems(score,true));
  if ((week.activity==='hajime_mid_exam' && ['pro','master'].includes(difficulty)) ||
    week.activity==='audition_second') {
    const items = week.activity==='audition_second' && difficulty==='master' ?
      niaMasterFinalItems(score):examRewardItems(score,false);
    const usesBracelet = list(score.nonHifModel?.scenarioReward?.items).some(item=>item.id===bracelet.id);
    return reward([{...bracelet,preferred:usesBracelet},...items.map(item=>({...item,preferred:!usesBracelet&&item.preferred}))]);
  }
  if (week.activity!=='audition_first') return null;
  if (difficulty==='master') {
    const selected = list(score.nonHifModel?.scenarioReward?.items);
    const counts = score.expectedCounts ?? {};
    const supportEffect = (regex, exchanges = false) => list(result.supports).reduce((total,card)=>{
      const latest = new Map();
      for (const ability of list(card.levelAbilities)) if (ability.level<=card.level &&
        (!latest.has(ability.order)||latest.get(ability.order).level<=ability.level)) latest.set(ability.order,ability);
      return total+[...latest.values()].filter(ability=>regex.test(ability.kind) &&
        (!ability.plan||['free',score.plan].includes(ability.plan)) &&
        (!ability.scenarioEnum||['ProduceType_Unknown','ProduceType_NextIdolAudition'].includes(ability.scenarioEnum)) &&
        !ability.splitEnum?.endsWith('_Final') &&
        (!exchanges||counts.p_drink_acquire>0)).length;
    },0);
    const drinks = supportEffect(/^p_drink_acquire$/,true);
    const enhance = supportEffect(/^(?:skill_enhance|[am]_skill_enhance|.+_card_enhance)$/);
    const preferred = drinks===enhance ? null : drinks>enhance?'drink':'enhance';
    return reward(businessItems.map(item=>({...item,preferred:selected.length ?
      selected.some(row=>row.id===item.id) : item.type===preferred})));
  }
  if (difficulty==='pro') {
    const setup = proItemSets[score.plan];
    const patch = {id:'pitem_00-3-095-0',name:'N.I.A 와펜',use:'다음 특별지도를 시작할 때 체력 6 회복·팬 투표 3,500 확보'};
    if (!setup) return reward([patch]);
    const [start,first,second,color,plan] = setup;
    const items = [first,second].map((effect,index)=>({id:`pitem_${plan}-3-${start+index}-0`,
      name:`N.I.A ${index?'라이트':'밴드'} (${color})`,
      use:`이후 ${effect} 계열 카드를 얻을 때 다음 오디션용 팬 투표 2,000 확보`,
      preferred:proItemPriority[score.trainingType]===index}));
    return reward([...items,patch]);
  }
  return null;
}

function rewardAdvice(reward, observation) {
  if (!reward) return null;
  const offers = list(observation.rewardItemOffers);
  const shown = reward.items.filter(item=>offers.includes(item.id) && item.use);
  const preferred = shown.find(item=>item.preferred) ?? (shown.length===1 ? shown[0] : null);
  const preview = !offers.length && observation.midtermPassed!==false ? reward.items.filter(item=>item.use&&item.preferred) : [];
  const state = observation.midtermPassed===false ? '합격 후 보상 화면이 열리면 그때 확인하세요.' :
    !offers.length && !preview.length ? '합격 후 실제로 뜬 보상 중에서 고르세요.' :
    preferred ? '' : shown.length ? '아래에서 다음 행동에 쓸 효과를 고르세요.' : '확인된 효과가 있는 보기가 없어요. 게임의 보상 설명을 확인하세요.';
  return {...reward,state:preview.length?'':state,shown:observation.midtermPassed===false?[]:
    preferred?[{...preferred,recommended:true},...shown.filter(item=>item!==preferred)]:
      preview.length?preview.map(item=>({...item,conditional:true})):shown};
}

function auditionAdvice(week, detail, difficulty, eventModeId, observation) {
  const target = niaAuditionTarget(difficulty,eventModeId,week.activity);
  const recommended = detail?.recommendation;
  const missed = detail?.choices?.find(row=>row.label===target?.label)?.unmet ??
    detail?.choices?.find(row=>row.unmet?.length)?.unmet ?? [];
  const fan = missed.find(row=>row.criteria==='fanVotes');
  const targetFans = target?.requirements.fanVotes;
  const knownFanGap = target && amount(observation.fanVotes)!==null && observation.fanVotes<targetFans ?
    targetFans-observation.fanVotes : null;
  const conditions = target ? `${target.label}는 팬 투표 ${numberText(targetFans)} 이상` +
    (target.requirements.affection ? `·친애도 ${target.requirements.affection}·${target.requirements.runNumber}회차 이상이 필요해요.`:'이 필요해요.') :
    '화면에 열린 후보의 입장 조건을 확인하세요.';
  return {
    press:recommended?.label ?? (target && !knownFanGap && !missed.length ?
      '조건을 충족한 '+target.label+'이 열리면 선택' : '입장할 수 있는 오디션 선택'),
    why:fan ? `${numberText(fan.needed-fan.current)}표 부족으로 원하는 후보가 잠겼어요.` :
      missed.length ? '선호 후보의 친애도나 육성 회차 조건이 아직 부족해요.' :
      recommended ? '화면에서 확인한 선호 후보의 입장 조건을 충족했어요.' :
      knownFanGap ? `${target.label}까지 팬 투표가 ${numberText(knownFanGap)}표 부족해요.` : conditions,
    fallback:'목표 후보가 잠겨 있으면 화면에 열린 다른 오디션을 고르세요.',
  };
}

function paidAdvice(activity, observation, pp, fallback, timing, customizationTarget) {
  const custom = activity==='special_training';
  const offer = typeof observation.consultOffer==='string' ? observation.consultOffer.trim().slice(0,100) : '';
  const base = custom ? amount(observation.customPrice) : amount(observation.consultBasePrice);
  const discount = amount(observation.consultDiscount);
  const rate = !custom && discount!==null && discount<=100 ? discount : null;
  const price = base===null ? null : Math.floor(base*(100-(rate??0))/100);
  const cost = rate>0 ? `확인한 상담 할인 ${rate}%로 ${base}P에서 ${price}P가 돼요.` : '';
  const label = custom ? '특별지도' : '상담';
  const target = custom ? customizationTarget || '강화한 주력 카드' : offer;
  if (price!==null && pp!==null && (custom || offer)) {
    if (pp<price) return {press:fallback,why:(cost?cost+' ':'')+`${label}에 ${price-pp}P 부족해요.`,
      fallback:custom ? '이번 개조를 미루고 P를 남겨두세요.' : '이번 교환은 건너뛰고 P를 남겨두세요.'};
    return {press:custom ? label+'에서 '+target+' 개조' : label+'에서 '+target+' 선택',
      why:cost || (custom ? timing : '시험에 쓸 것으로 확인한 보기예요.'),fallback};
  }
  return {press:custom ? target+'의 개조가 열리고 살 수 있으면 특별지도' : '필요한 교환·강화·삭제가 보이고 살 수 있으면 상담',
    why:custom ? timing : '시험에 필요한 카드나 드링크를 준비할 수 있어요.',fallback};
}

export function buildDayActionGuidance({week,book,result,catalog,advice,liveState}) {
  const score = {...result.scoreSummary,scenario:book.context?.scenario??result.scoreSummary?.scenario};
  const difficulty = book.scheduleContext?.sourceDifficulty ?? score.difficulty;
  const eventModeId = book.scheduleContext?.selectedEventModeId;
  const observed = advice.observedChoice?.detail;
  const observation = liveState.observation ?? {};
  const activities = [week,...list(week.alternatives)];
  const available = id => activities.some(row=>row.activity===id);
  const fixed = exam.test(week.activity);
  const interval = week.activity==='interval';
  const canRollSp = activities.some(row=>normalLesson.test(row.activity)) &&
    !(score.scenario==='hajime' && difficulty==='pro' && !eventModeId && week.week===1);
  const reward = rewardAdvice(scenarioReward({week,score,catalog,difficulty,eventModeId,result}),observation);
  const fields = {sp:canRollSp, custom:available('special_training'), consult:score.scenario==='hif'&&available('consult')};
  const resultOf = (kind,action,extra={})=>({kind,...action,activity:week.activity,fields,reward,...extra});
  const fallbackFor = id => {
    const options = [...new Set(activities.filter(row=>row.activity!==id).map(activityName))];
    return options.length>1 ? options.join('·')+' 중 열린 행동 선택' :
      options.length ? options[0]+' 버튼이 열렸다면 선택' : '화면에서 다음으로 진행';
  };
  if (fixed && week.activity.startsWith('audition_')) return resultOf('고정 일정',auditionAdvice(week,observed,difficulty,eventModeId,observation));
  if (fixed) return resultOf('고정 일정',{
    press:week.eventPhase??(score.scenario==='hif'?'선발시험 '+([7,13,20].indexOf(week.week)+1):activityName(week)),
  });
  if (interval) {
    const current = observed?.current;
    const purchases = list(current?.purchases);
    const priceBarrier = list(observation.offers).find(row=>amount(row?.price)!==null && amount(liveState.pp)!==null &&
      row.price>liveState.pp && (current?.missingDrinkIds?.includes(row.drinkId)&&observation.freeSlots>0 ||
        current?.missingCardIds?.includes(row.cardId)));
    return resultOf('직접 고를 행동',{
      press:purchases.length ? purchases.map(row=>row.drinkId??row.cardId).join('·')+' 구매' : current ?
        '바로 살 목표 상품이 없으면 다음으로' : 'R1 뒤 보이는 가격으로 R2용 카드·드링크 확인',
      why:priceBarrier ? `인터벌 표시가 ${priceBarrier.price}P에 ${priceBarrier.price-liveState.pp}P 부족해요. 상담 할인은 인터벌에서 적용되지 않아요.` :
        'R1 보상까지 받은 잔액과 인터벌 표시가를 써요. 상담 할인은 인터벌에서 적용되지 않아요.',
      fallback:observed?.conditional?.plan ? observed.conditional.summary :
        current?.allDesired?'목표를 준비했으면 라운드 2로 진행하세요.':
        '목표가 없으면 P를 남기거나 갱신 비용을 확인하고, 준비되면 라운드 2로 진행하세요.',
    },{picks:dayPicks('interval',book,catalog,advice,result,week.week)});
  }
  if (activities.some(row=>normalLesson.test(row.activity))) {
    const modeledAxis = score.hajimeMaster?.selections?.find(row=>row.week===week.week)?.axis ?? score.nonHifModel?.targetAxis;
    const preferredLesson = modeledAxis ? activities.find(row=>normalLesson.test(row.activity)&&
      axis[row.activity.split('_')[0]]===axis[modeledAxis]) ?? week : week;
    const lesson = lessonAdvice(activities,preferredLesson,advice,liveState,canRollSp,modeledAxis);
    return resultOf(canRollSp&&!lesson.spStatus?'등장하면 고를 행동':'직접 고를 행동',lesson);
  }
  if (available('business')) {
    const choice = observed?.recommendation;
    const next = list(book.weekPlan).find(row=>row.week>week.week&&row.activity.startsWith('audition_'));
    const target = niaAuditionTarget(difficulty,eventModeId,next?.activity);
    const gap = target && amount(observation.fanVotes)!==null ? target.requirements.fanVotes-observation.fanVotes : null;
    return resultOf(choice?'직접 고를 행동':'등장하면 고를 행동',{
      press:choice?.label ?? (gap>0?'열린 영업 중 팬 투표 보상이 큰 장소':'열린 영업 중 다음 시험에 필요한 보상을 주는 장소'),
      why:gap>0 ? `다음 ${target.label}까지 팬 투표 ${numberText(gap)}표가 필요해요.` :
        choice?.rewardText.join('·') || ordinaryReasons.business,
      fallback:'원하는 장소가 없으면 지금 진행 가능한 다른 장소의 보상을 확인하세요.',
    });
  }
  if (fields.custom && (week.activity==='special_training' || score.scenario==='hajime'&&difficulty==='legend' ||
    amount(observation.customPrice)!==null)) {
    const next = list(book.weekPlan).find(row=>row.week>week.week&&exam.test(row.activity));
    const timing = (next ? (score.scenario==='hif'?'다음 선발시험':activityName(next)) : '다음 시험')+' 전에 주력 카드 효과를 보완해요.';
    const target = list(result.customizationReadiness?.duringProduce).find(row=>row.currentlyActionable!==false &&
      row.currentStoredMemoryStatus!=='fulfilled' && list(row.timing?.selectionWeeks).includes(week.week))?.target;
    return resultOf('등장하면 고를 행동',paidAdvice('special_training',observation,amount(liveState.pp),
      fallbackFor('special_training'),timing,target?.nameKo||target?.nameJa));
  }
  if (fields.consult && (week.activity==='consult'||amount(observation.consultBasePrice)!==null)) {
    return resultOf('등장하면 고를 행동',paidAdvice('consult',observation,amount(liveState.pp),fallbackFor('consult')),
      {activity:'consult',picks:dayPicks('consult',book,catalog,advice,result,week.week),supportChoice:supportChoice(result,week.week,'consult',activities)});
  }
  const recommended = list(advice.recommendations)[0];
  const preferred = activities.find(row=>row.activity===recommended?.activity) ?? week;
  const name = activityName(preferred);
  const family = /_legend_lesson$/.test(preferred.activity)?'legend_lesson':
    /^class_/.test(preferred.activity)?'class':preferred.activity;
  return resultOf('직접 고를 행동',{
    press:preferred.activity==='consult'?'필요한 대상이 있고 살 수 있으면 상담':name,
    why:preferred.activity==='supply_gift' && catalog.produceResources?.hif?.gift ?
      '사시이레로 '+catalog.produceResources.hif.gift.pp+'P를 보충해요.' :
      ordinaryReasons[family] ?? '이 편성의 다음 시험 준비에 쓰는 행동이에요.',
    fallback:fallbackFor(preferred.activity),
  },{activity:preferred.activity,picks:dayPicks(preferred.activity,book,catalog,advice,result,week.week),
    supportChoice:supportChoice(result,week.week,preferred.activity,activities)});
}
