import { evaluateSupportItemValue } from './support-item-value.mjs';

const list = value => Array.isArray(value) ? value : [];
const axisNames = { vocal:'보컬', dance:'댄스', visual:'비주얼', vo:'보컬', da:'댄스', vi:'비주얼' };
const keywordNames = {concentration:'집중', good_condition:'호조', good_impression:'호인상', motivation:'의욕',
  vitality:'기운', reserve:'온존', full_power:'전력'};
const venueOf = id => ({activity_supply:'supply_gift', activity_supply_gift:'supply_gift', consultation:'consult'})[id] ?? id;
const selectedSupports = supports => Array.isArray(supports) ? supports :
  [...list(supports?.owned), ...(supports?.rental ? [{...supports.rental,isRental:true}] : [])];
const eventLevel = release => release === 'initial' ? 1 : Number(/^lv(\d+)$/.exec(release ?? '')?.[1]);
const weekList = rows => [...new Set(rows.map(row=>row.week).filter(Number.isInteger))].sort((a,b)=>a-b);
const isExam = row => ['mid_exam','final_exam'].includes(row.activity);

function routeVenues(model, data, level) {
  const rows = list(model.selections);
  const visits = activity => weekList(rows.filter(row=>venueOf(row.activity)===activity));
  const classes = rows.filter(row=>row.activity?.startsWith('class_'));
  const earlyClasses = classes.filter(row=>list(data.class?.earlyWeeks).includes(row.week) && row.choiceId!=='trouble');
  const changeClasses = classes.filter(row=>!earlyClasses.includes(row));
  const consult = visits('consult'), interval = visits('interval');
  const paidUnlocked = gate => Number.isInteger(level) && Number.isInteger(gate) && level>=gate;
  const hasUpgrade = paidUnlocked(data.consult?.enhanceUnlockPLv);
  const hasDelete = paidUnlocked(data.consult?.deleteUnlockPLv);
  const exams = rows.filter(row=>row.stage!=='final' && isExam(row));
  const automatic = list(data.basicCardRemovals?.afterSelectionExamIndices).map(index=>({examNumber:index+1,
    week:exams[index]?.week??null, count:data.basicCardRemovals.count, target:'random_starter',
    condition:`선발시험 ${index+1} 통과 직후 커스텀 P아이템 선택 전에 기본 카드 ${data.basicCardRemovals.count}장 자동 삭제`,
    sourceIds:list(data.basicCardRemovals.sourceIds)}));
  const selectedOperations = list(model.produceActions).filter(op=>!op.providerId && Number.isInteger(op.week));
  const changes = selectedOperations.filter(op=>op.action==='change' && venueOf(op.venue)==='class_work_end');
  const scenarioOperations = selectedOperations.filter(op=>op.basis==='conditional_hif_scenario_item');
  return { rows, visits, consult, interval, hasUpgrade, hasDelete, automatic, earlyClasses, changeClasses, changes, scenarioOperations };
}

const venue = (activity,weeks,action,conditions={}) => ({activity,weeks,action,...conditions});
const compare = {acquire:'획득',enhance:'강화',delete:'삭제'};
const simpleConditions = {initial_stat:'육성 시작 시', initial_pp:'육성 시작 시', max_hp:'육성 시작 효과',
  parameter_bonus:'해당 속성 파라미터 상승 보너스',sp_lesson_rate:'해당 속성 SP 발생률 증가',sp_lesson_rate_all:'모든 속성 SP 발생률 증가',
  support_rate:'서포트 발생 시 스킬 카드 강화 확률 증가',event_boost:'서포트 이벤트의 파라미터 보상 증가',
  event_pp_boost:'서포트 이벤트의 P포인트 보상 증가',event_recovery_boost:'서포트 이벤트의 체력 회복량 증가',
  p_item_acquire:'P아이템 획득 시', exam_end:'시험 종료 시', exam_hp:'시험 종료 시', exam_15:'덱 15장 이상으로 시험을 마치면',
  rest:'휴식 시작 시', consult:'상담 시작 시', discount:'상담 시작 시 드링크 교환 가격 할인',
  outing:'외출 종료 시', class_work_end:'수업 종료 시', activity_supply_gift:'사시이레 선택 시',
  activity_supply_gift_hp:'사시이레 선택 시', special_training:'특별지도 시작 시', customize:'스킬 카드 개조 시'};

function effectText(effect) {
  const type = effect.type?.replace(/^ProduceEffectType_/,'')??'';
  const axis = axisNames[/(Vocal|Dance|Visual)/.exec(type)?.[1].toLowerCase()];
  const amount = (scale=1) => effect.min===effect.max?String(effect.min/scale):`${effect.min/scale}~${effect.max/scale}`;
  if (!Number.isFinite(effect.min)||!Number.isFinite(effect.max)) return null;
  if (/^(Vocal|Dance|Visual)Addition$/.test(type)) return `${axis} +${amount()}`;
  if (type.endsWith('GrowthRateAddition')) return `${axis} 파라미터 보너스 +${amount(10)}%`;
  if (type.endsWith('SpChangeRatePermilAddition')) return `${axis??'전체'} SP 발생률 +${amount(10)}%p`;
  const format = {StaminaRecoverFix:['체력 회복 +',1,''], MaxStaminaAddition:['최대 체력 +',1,''],
    ProducePointAdditionDisableTrigger:['P포인트 +',1,''], LessonPresentProducePointUp:['레슨 보상 P포인트 +',10,'%'],
    ShopProduceDrinkPriceDiscountMultiple:['상담 드링크 가격 할인 ',10,'%'],
    SupportCardProduceCardUpgradeProbabilityUp:['서포트 카드 강화 확률 +',10,'%p'],
    SupportCardEventParameterAdditionValueUp:['서포트 이벤트의 파라미터 보상 +',10,'%'],
    SupportCardEventProducePointAdditionValueUp:['서포트 이벤트의 P포인트 보상 +',10,'%'],
    SupportCardEventStaminaRecoverUp:['서포트 이벤트의 체력 회복량 +',10,'%']}[type];
  return format ? `${format[0]}${amount(format[1])}${format[2]}` : null;
}

function triggerGuide(kind, effect, route) {
  const {rows,visits,consult,interval,hasUpgrade,hasDelete,automatic,earlyClasses,changeClasses,changes,scenarioOperations} = route;
  const lessonAxis = /lesson_(vocal|dance|visual)(?:_|$)/.exec(effect?.triggerId ?? '')?.[1];
  if (/^(?:sp_|normal_)?lesson_(?:end|pp|boost|hp(?:_all)?|20)$/.test(kind) || kind==='lesson_pp_boost') {
    const sp = kind.startsWith('sp_'), normal = kind.startsWith('normal_');
    const matching = rows.filter(row=>row.main && (!lessonAxis||row.main===lessonAxis) && (!sp||row.isSpLesson!==false));
    const label = [axisNames[lessonAxis],sp?'SP':normal?'일반':'','공개 레슨'].filter(Boolean).join(' ');
    const threshold = kind==='sp_lesson_20'?'스킬 카드 20장 이상으로 ':'';
    return {condition:`${threshold}${label} 종료 시`,venues:matching.length?[venue('lesson',weekList(matching),
      kind==='sp_lesson_20'?'레슨 전 덱이 20장 이상인지 확인하고, 해당 SP 공개 레슨을 마치세요.':
        `${label}을 마치면 이 효과를 받을 수 있어요.`,{requiresSp:sp,requiresNormal:normal,axis:lessonAxis??null})]:[]};
  }
  const type = /^([am])_skill_(acquire|enhance|delete)$/.exec(kind);
  const keyword = /^(.+)_card_(acquire|enhance|delete)(_8)?$/.exec(kind);
  const keywordName = keywordNames[keyword?.[1]];
  const typeName = type ? (type[1]==='a'?'액티브':'멘탈') : null;
  const target = typeName ?? (keywordName&&!keyword[3]?`${keywordName} 관련`:null) ?? (kind==='ssr_card_acquire'?'SSR':null);
  const card = target ? `${target} 스킬 카드` : '스킬 카드';
  const operation = type?.[2] ?? (keywordName ? keyword[2] : null) ??
    ({skill_acquire:'acquire',ssr_card_acquire:'acquire',skill_enhance:'enhance',delete:'delete'})[kind];
  let condition, venues = [];
  if (kind==='p_drink_acquire') {
    condition = 'P드링크를 실제로 획득할 때';
    venues = [venue('supply_gift',visits('supply_gift'),'사시이레에 다음 시험용 드링크가 보이고 빈 슬롯이 있으면 받으세요.'),
      venue('outing',visits('outing'),'외출에서 드링크 보상이 붙은 선택지를 고르고 빈 슬롯에 받으세요.'),
      venue('consult',consult,'상담에서 시험용 드링크가 진열되고 P포인트와 빈 슬롯이 있으면 교환하세요.'),
      venue('interval',interval,'인터벌에 라운드 2용 드링크가 진열되고 P포인트와 빈 슬롯이 있으면 받으세요.')];
  } else if (kind==='p_drink_exchange' || kind==='consult_skill_card_acquire') {
    const product = kind==='p_drink_exchange'?'P드링크':'스킬 카드';
    condition = `상담에서 P포인트를 내고 ${product} 교환 시`;
    venues = [venue('consult',consult,`상담에 필요한 ${product}가 보이면 가격을 확인하고 교환하세요.${kind==='p_drink_exchange'?' 빈 드링크 슬롯도 확인하세요.':''}`)];
  } else if (operation) {
    const threshold = keywordName&&keyword[3] ? `${keywordName} 관련 카드 8장 이상 보유 시 ` : '';
    condition = `${threshold}${card} ${compare[operation]} 시`;
    if (operation==='acquire') venues = [
      ...['supply_gift','outing','consult','interval'].map(activity=>venue(activity,visits(activity),
        `${threshold?'발동 조건인 8장을 확인한 뒤 ':''}현재 목표 덱에 필요한 ${card}가 보이면 획득하세요.${['consult','interval'].includes(activity)?' 가격도 확인하세요.':''}`)),
      venue('class',weekList(earlyClasses),`초반 수업의 체력 소비 선택에서 필요한 ${card}가 열리면 획득하세요.`),
    ];
    if (operation==='enhance' && hasUpgrade) venues = [
      venue('consult',consult,`상담 강화 메뉴에서 이미 덱에 들어온 미강화 ${card} 중 다음 시험의 주력 카드를 골라 강화하세요. 가격을 먼저 확인하세요.`),
      venue('interval',interval,`본선 R2에 사용할 미강화 ${card} 중 주력 카드를 골라 인터벌에서 강화하세요.`),
    ];
    if (operation==='delete') venues = [
      venue('exam_reward',weekList(automatic),null,{automatic:true,targetMatch:target?'deleted_card_must_match':'any'}),
      ...(hasDelete?[venue('consult',consult,`실제 덱에서 ${target?target+' ':''}카드 중 시험의 준비·득점에 필요 없는 카드가 남아 있고 교체용 카드와 P포인트가 충분할 때만 삭제하세요.`)]:[]),
    ];
  } else if (kind==='basic_card_change'||kind==='change') {
    const basic = kind==='basic_card_change';
    condition = `${basic?'기본 카드':'스킬 카드'} 체인지 시`;
    const nonStarter = op => op.basicCard===false || ['produce','pIdol','support'].includes(op.sourceType);
    const eligible = basic ? changeClasses.filter(row=>{
      const planned = changes.filter(op=>op.week===row.week);
      return !planned.length || planned.some(op=>!nonStarter(op));
    }) : changeClasses;
    venues = [venue('class',weekList(eligible),`${basic?'남아 있는 기본':'현재 덱의 불필요한'} 카드를 수업의 셀렉트 체인지에서 필요한 카드로 바꾸세요. 보상과 비용을 먼저 확인하세요.`),
      venue('interval',interval,`인터벌에 맞는 교체 대상과 목표 카드가 보일 때만 ${basic?'남아 있는 기본':'불필요한'} 카드를 바꾸세요.`)];
  } else {
    condition = simpleConditions[kind];
    const ordinary = {rest:'rest',outing:'outing',consult:'consult',discount:'consult',
      activity_supply_gift:'supply_gift',activity_supply_gift_hp:'supply_gift',special_training:'special_training'}[kind];
    if (ordinary) venues=[venue(ordinary,visits(ordinary),({rest:'회복할 체력이 있을 때 휴식하세요.',outing:'외출의 회복량과 보상을 비교하세요.',
      consult:'이 상담에서 준비할 카드나 강화가 있는지 확인하세요.',discount:'시험용 드링크의 실제 할인 표시가를 확인하세요.',
      supply_gift:'다음 시험에 필요한 사시이레 보상을 확인하세요.',special_training:'이미 확보한 강화 카드의 개조 대상과 가격을 확인하세요.'})[kind==='discount'?'discount':ordinary])];
    if (kind==='class_work_end') venues=[venue('class',weekList([...earlyClasses,...changeClasses]),'수업에서 카드 보상과 체력·졸음 비용을 확인하세요.')];
    if (kind==='customize') venues=['special_training','interval'].map(activity=>venue(activity,visits(activity),
      '강화된 주력 카드에 원하는 개조가 열리고 남은 P포인트가 충분할 때 선택하세요.'));
  }
  const scenarioAction = kind==='p_drink_acquire'?'drink_acquire':(['change','basic_card_change'].includes(kind)?'change':
    ({acquire:'acquire',enhance:'upgrade',delete:'remove'})[operation]);
  if (scenarioAction) {
    const matches = scenarioOperations.filter(row=>row.action===scenarioAction || scenarioAction==='acquire'&&row.action==='copy'&&row.countsAsAcquisition);
    if (matches.length) venues.push(venue('scenario_item',weekList(matches),null,{
      availability:'if_selected_item_proc_matches',targetMatch:target||kind==='basic_card_change'?'result_must_match_trigger':'any'}));
  }
  return {condition:condition??null,venues:venues.filter(row=>row.weeks.length)};
}

function unlockedAbilities(card, plan) {
  const current = new Map();
  for (const ability of list(card.levelAbilities)) if (Number.isFinite(ability.level) && ability.level<=card.level &&
    (current.get(ability.order)?.level??-1)<=ability.level) current.set(ability.order,ability);
  return [...current.values()].filter(ability=>(!ability.plan||ability.plan==='free'||ability.plan===plan) &&
    (!ability.scenarioEnum||['ProduceType_Unknown','ProduceType_HatsuboshiIdolFestival'].includes(ability.scenarioEnum)) &&
    (!ability.splitEnum||ability.splitEnum.endsWith('_Unknown')));
}

function supportItem(card, plan, route, catalog, options) {
  const item = card.p_item, effect = item?.effect;
  const release = eventLevel(list(card.events).find(event=>event.effect_type==='p_item')?.release);
  if (!effect || !Number.isInteger(release) || release>card.level) return null;
  const value = card.supportItemValue ?? evaluateSupportItemValue({card,level:card.level,plan,catalog,options});
  const key = effect.trigger?.key;
  const kind = ({consult_selection:'consult',activity_supply_gift_selection:'activity_supply_gift',outing_end:'outing',
    skill_change:'change',card_enhance:'skill_enhance',card_acquire:'skill_acquire',skill_acquire:'skill_acquire',
    card_delete:'delete',pdrink_acquire:'p_drink_acquire',class_work_end:'class_work_end',special_training_start:'special_training',
    param_sp_lesson_end:'sp_lesson_end',param_lesson_end:'lesson_end'})[key] ??
    (key==='keyword_card_acquire'?`${effect.trigger.keyword}_card_acquire`:key==='keyword_card_enhance'?`${effect.trigger.keyword}_card_enhance`:null);
  // The item itself can supply the named reward. Purchasing that reward is
  // not required to trigger an item with a visit or lesson condition.
  const guide = triggerGuide(kind??'',{triggerId:`lesson_${effect.trigger?.param??''}`},route);
  const acquired = value?.acquisitionConfirmed===true;
  const acquisition = value?.acquisition;
  const firstWeek = Number.isInteger(acquisition?.week) ? acquisition.week : null;
  const venues = guide.venues.map(row=>({...row,weeks:row.weeks.filter(week=>!acquired||firstWeek===null||week>firstWeek||
    week===firstWeek&&acquisition?.beforeActions===true),
    ...(row.action?{action:`${item.name}을 이미 받았고 발동 조건을 충족하면 ${value?.conditions?.[0]?.replace(/^발동: /,'')??guide.condition} 효과를 받을 수 있어요.`}:{}),
    requiresItemAcquisition:true})).filter(row=>row.weeks.length);
  return {name:item.name, gameId:value?.battleItem?.gameId??null, imageId:value?.battleItem?.gameId??null,
    eventUnlockLevel:release, acquisitionStatus:acquired?'confirmed':'conditional',
    condition:value?.conditions?.[0]?.replace(/^발동: /,'')??guide.condition, extraConditions:list(value?.conditions).slice(1,2),
    conditionData:effect.condition??null, restriction:effect.restriction??null, trigger:effect.trigger??null,
    effect:list(effect.body), limit:effect.limit??null, venues};
}

/** Data-only guidance for the chosen regular HIF route and equipped cards. */
export function buildHifGuideSupports({ result, catalog = {}, options = {} }) {
  const score = result?.scoreSummary, model = score?.hifModel;
  const context = result?.accountPlaybook?.context ?? result?.personalizedPlan?.context;
  if (!model || (score.scenario??context?.scenario??options.scenario)!=='hif' || options.eventModeId ||
    result.accountPlaybook?.scheduleContext?.selectedEventModeId || (options.hifMode&&options.hifMode!=='normal')) return null;
  const data = catalog.produceResources?.hif??{};
  const level = options.producerLevel ?? context?.producerLevel?.value;
  const route = routeVenues(model,data,level);
  const supports = selectedSupports(result.supports).filter(Boolean).map(selected=>{
    const gameId = selected.gameId??selected.id;
    const card = {...list(catalog.supportCards).find(row=>row.gameId===gameId),...selected};
    const triggers = unlockedAbilities(card,score.plan).flatMap(ability=>list(ability.effects).map(effect=>({
      kind:ability.kind, source:'support_ability', unlockLevel:ability.level, skillId:ability.skillId??null,
      triggerId:effect.triggerId??null, effect:{type:effect.type,min:effect.min,max:effect.max,ratePermil:effect.ratePermil??null,text:effectText(effect)},
      limit:ability.activationLimit>0?ability.activationLimit:null,
      ...triggerGuide(ability.kind,effect,route),
    })));
    const storyEvents = list(card.events).map(row=>({...row,unlockLevel:eventLevel(row.release)})).filter(row=>
      Number.isInteger(row.unlockLevel)&&row.unlockLevel<=card.level).map(row=>({
      title:row.title,kind:row.effect_type,unlockLevel:row.unlockLevel,acquisitionStatus:'event_required',
      condition:`서포트 Lv${row.unlockLevel} 이상에서 이 이벤트가 발생하면`,
      effect:{param:row.param_type??null,value:row.param_value??null},
      action:({card_enhance:'강화 보상이 발동하면 실제 강화된 카드를 확인하세요.',select_enhance:'대상 선택이 열리면 다음 시험의 미강화 핵심 카드를 고르세요.',
        trouble_delete:'삭제 효과가 발동할 때 덱에 트러블 카드가 있는지 확인하세요.',
        select_delete:'삭제 대상이 제시되면 목표 덱에 필요 없는 카드만 고르세요.',card_change:'이벤트로 체인지된 기본 카드와 결과 카드를 확인하세요.'})[row.effect_type]??null,
    }));
    return {gameId,name:card.nameKo||card.name||card.nameJa||gameId,imageId:gameId,level:card.level??null,
      ownedLevel:card.ownedLevel??null,levelBasis:card.levelBasis??null,isRental:card.isRental===true||card.rental===true,
      triggers,storyEvents,item:supportItem(card,score.plan,route,catalog,options)};
  });
  const round2 = route.rows.filter(row=>row.stage==='final'&&isExam(row)).at(-1)?.week??null;
  const color = ({goodConditionTurns:'紫',concentration:'緑',goodImpressionTurns:'黄',motivation:'赤',strength:'青',fullPower:'桃'})[score.trainingType??context?.trainingType];
  const refillItem = list(catalog.pItems).find(item=>item.nameJa===`H.I.F応援棒（${color}）`&&item.identityStatus==='exact');
  return {supports,deckManagement:{
    automaticRemovals:route.automatic,
    manualRemoval:{activity:'consult',weeks:route.hasDelete?route.consult:[],unlockProducerLevel:data.consult?.deleteUnlockPLv??null,
      unlocked:Number.isInteger(level)?route.hasDelete:null, prices:list(data.consult?.enhanceDeletePrices),
      action:'목표 덱에서 빠져도 되는 실제 카드를 확인하고, 상담의 남은 삭제 슬롯과 표시가를 확인하세요. 최종 R2 장수를 함께 점검하세요.',
      sourceIds:list(data.consult?.sourceIds)},
    consultRefresh:{activity:'consult',weeks:route.consult, unlockAffectionLevel:27, sharedAcrossSelectionAndFinal:true,
      action:'친애도 27의 상담 리프레시가 남았으면 진열을 다시 확인할 수 있어요. 삭제 메뉴가 다시 열리면 대상과 표시가를 확인하세요. 선발에서 쓴 리프레시는 본선에서도 사용한 상태예요.',
      sourceIds:['kareha-hif-management','community-hif'],
      sourceUrls:['https://game8.jp/gakuen-idolmaster/787695']},
    selectChange:{classWeeks:weekList(route.changeClasses),intervalWeeks:route.interval, changesDeckSize:false, countsAsAcquisition:false,
      action:'선택 가능한 수업 또는 인터벌에서 실제 덱의 불필요한 카드를 목표 카드로 바꾸세요. 체인지만으로 R2 덱 장수를 채울 수 없어요.',
      sourceIds:[...list(data.class?.sourceIds),...list(data.interval?.sourceIds)]},
    round2Refill:{week:round2, phase:'final_round_2',acquiredAfter:'final_round_1',minimumDeckSize:22, target:'random_starter',
      gameId:refillItem?.gameId??null, imageId:refillItem?.gameId??null, name:'H.I.F 응원봉',countsAsAcquisition:false,
      condition:'본선 R2 시험 시작 시 덱이 22장 미만이면 부족한 만큼 무작위 기본 카드를 덱에 생성',
      action:'인터벌에서 실제 장수를 세고, 22장 미만이면 필요한 카드를 새로 획득해 기본 카드가 섞이는 양을 줄이세요.',
      sourceIds:['community-hif','simawi-hif-interval']},
  }};
}
