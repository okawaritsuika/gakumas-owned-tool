const selectionExamDays = [7,13,20];
const colors = { red:'빨간',green:'초록',yellow:'노란' };
const timingLabels = { lesson:'공개 레슨 종료',consult:'상담 선택',outing:'외출 종료',supply_gift:'사시이레 종료' };
const activationPhrases = { lesson:'공개 레슨을 마치면',consult:'상담을 열면',outing:'외출을 마치면',supply_gift:'사시이레를 마치면' };
const discounts = { drink_exchange:'드링크 교환',upgrade:'카드 강화',remove:'카드 삭제',acquire:'카드 구매' };

// The native item art is made of img_general_cstm-pitem layers (assetId1–4).
function imageIds(gameId) {
  const [pouch,shape,,decoration] = gameId.slice('customize_pitem-'.length).split('_');
  const layers = [pouch.slice(0,2)+'-1-001',shape?.slice(3),pouch.slice(3),decoration?.slice(3)];
  return layers.filter(Boolean).map(layer=>'img_general_cstm-pitem_'+layer);
}

function displayEffect(effect, formKey, planDrinks, producerLevel) {
  const quantity = effect.quantity;
  switch (effect.action) {
    case 'drink_acquire': {
      if (effect.designated) {
        const levelKnown = Number.isInteger(producerLevel);
        const pool = (planDrinks?.designatedPool ?? []).filter(row=>
          row.unlockProducerLevel===0 || levelKnown && row.unlockProducerLevel<=producerLevel);
        const maxQuantity = levelKnown || pool.length>=quantity ? Math.min(quantity,pool.length) : null;
        const qualifier = quantity>1 ? '서로 다른 지정 드링크 최대 ' : '지정 풀에서 무작위 드링크 ';
        return {...effect,maxQuantity,drinkIds:pool.map(row=>row.id),selectionMode:'random',
          textKo:qualifier+(maxQuantity??quantity)+'개 획득'+(maxQuantity===null?' (현재 PLv에 따른 수량 미확인)':'')};
      }
      // Native flowers on the red bear, green parrot and yellow robot reward
      // a drink choice. The support calculation only needs the receipt count.
      const selectionMode = ['red_bear_flower','green_parrot_flower','yellow_robot_flower'].includes(formKey) ? 'select' : 'random';
      return {...effect,selectionMode,textKo:(selectionMode==='select'?'제시된 드링크 ':'무작위 드링크 ')+quantity+'개 획득'+
        (selectionMode==='select'?' (직접 선택)':'')};
    }
    case 'hp_recover': return {...effect,textKo:'체력 '+effect.amount+' 회복'};
    case 'pp_gain': return {...effect,textKo:'P포인트 +'+effect.amount};
    case 'shop_discount': return {...effect,percent:effect.amount/10,textKo:'해당 상담의 '+discounts[effect.category]+' '+effect.amount/10+'% 할인'};
    case 'acquire': return {...effect,rarityGuaranteed:false,
      textKo:(effect.upgradeCount?'강화된 ':'')+'스킬 카드 '+quantity+'장 선택 획득 (SSR 고확률)'};
    case 'upgrade': return {...effect,textKo:(effect.selectionMode==='random'?'무작위로':'직접 골라')+' 카드 '+quantity+'장 강화'};
    case 'change': return {...effect,textKo:(effect.target==='non_trouble'?'트러블 제외 카드 ':'카드 ')+quantity+
      '장 셀렉트 체인지'+(effect.resultRarity==='SSR'?' (SSR 고확률)':'')};
    case 'copy': return {...effect,textKo:'카드 '+quantity+'장 선택 복제'};
    case 'remove': return {...effect,textKo:'카드 '+quantity+'장 선택 삭제'};
  }
}

function examStartEffect(plan, form, formKey) {
  const subsequent = form.fromExamIndex===3;
  const stat = form.fromExamIndex===1 ? 2 : form.useLimit===2 ? 3 : 6;
  const effect = {
    sense:'집중 +'+stat+' · 호조 '+stat+'턴',
    logic:'호인상 +'+stat+' · 의욕 +'+stat,
    anomaly:'모든 스킬 카드의 파라미터 상승 수치 +'+2*stat,
  }[plan];
  return {scope:subsequent?'subsequent_finals':'next_selection_exam',
    timingKo:subsequent?'활동 발동 후 본선 시험 시작마다':'활동 발동 후 다음 선발시험 시작',
    textKo:effect+(subsequent&&formKey.startsWith('red_moja_')?' · 고정 원기 +6':'')};
}

function choiceReason(form, effects) {
  const has = action => effects.some(effect=>effect.action===action);
  const next = form.fromExamIndex===3 ? '본선' : '선발 '+(form.fromExamIndex+1)+'차';
  const outcome = has('shop_discount') ? '상담 비용을 줄여 필요한 교환이나 덱 정리에 P를 남겨요.'
    : has('acquire') && has('drink_acquire') ? next+'용 드링크를 얻고, 덱에 부족한 카드가 제시되면 추가할 수 있어요.'
    : has('acquire') ? '덱에 부족한 카드가 제시되면 추가할 수 있어요.'
    : has('change') ? '약한 카드를 바꿔 '+next+' 덱을 보완할 수 있어요.'
    : has('remove') ? '쓸모가 줄어든 카드를 빼서 주력 카드를 뽑기 쉽게 해요.'
    : has('copy') ? '이미 확보한 주력 카드를 복제할 수 있어요.'
    : has('upgrade') ? next+'에 투입할 카드의 효과를 높일 수 있어요.'
    : effects.some(effect=>effect.action==='drink_acquire'&&effect.selectionMode==='select') ? next+'용 드링크를 제시된 보기에서 골라 확보해요.'
    : has('drink_acquire') ? next+'에서 쓸 드링크를 확보할 수 있어요.'
    : has('pp_gain') ? next+' 전에 카드·드링크에 쓸 P를 모을 수 있어요.'
    : '체력을 회복해 다음 활동을 이어갈 수 있어요.';
  return activationPhrases[form.trigger]+' '+outcome;
}

function activityKind(row) {
  if (row.main) return 'lesson';
  if (['activity_supply','activity_supply_gift'].includes(row.activity)) return 'supply_gift';
  return row.activity;
}

/** Describe the selected route without changing its encoded score or action totals. */
export function buildHifGuideItems({result,catalog,inventory,options={}}) {
  const score = result.scoreSummary;
  if ((score?.scenario ?? options.scenario)!=='hif' || options.eventModeId || result.eventContext?.mode?.id ||
    options.hifMode && options.hifMode!=='normal') return null;
  const model = score?.hifModel;
  const id = model?.supportActionPlan?.peakScenario?.scenarioItem?.id ?? options.hifScenarioItemPath;
  const {scenarioItemPaths,scenarioDrinkItem} = catalog.produceResources?.hif ?? {};
  const path = scenarioItemPaths?.paths[id];
  if (!path) return null;
  const plan = score?.plan ?? result.selectedIdol?.plan;
  const producerLevel = options.producerLevel ?? inventory?.producerLevel;
  let replacesGameId = null;
  const stages = path.formKeys.map((formKey,index)=>{
    const form = scenarioItemPaths.forms[formKey];
    const gameId = form?.nativeByPlan?.[plan];
    if (!gameId) return null;
    const images = imageIds(gameId);
    const art = catalog.hifItemVisuals?.byGameId?.[gameId];
    const effects = form.effects.map(effect=>displayEffect(effect,formKey,scenarioDrinkItem?.plans?.[plan],producerLevel));
    const plannedActivationWeeks = Array.isArray(model?.selections) ? model.selections
      .filter(row=>row.fromExamIndex===form.fromExamIndex && activityKind(row)===form.trigger)
      .slice(0,form.useLimit).map(row=>row.week) : null;
    const row = {formKey,gameId,imageId:images[index===1?1:images.length-1],imageIds:images,
      imageUrl:art?.nameJa===form.nameJa ? art.imageUrl : null,
      nameKo:index===0?colors[formKey.split('_')[0]]+' '+form.nameKo:form.nameKo,
      nameJa:form.nameJa,week:selectionExamDays[index],fromExamIndex:form.fromExamIndex,
      chooseWhenKo:'선발 '+form.fromExamIndex+'차 통과 직후',availability:'if_offered',
      trigger:form.trigger,timingKo:timingLabels[form.trigger],useLimit:form.useLimit,effects,
      examStart:examStartEffect(plan,form,formKey),plannedActivationWeeks,replacesGameId,reasonKo:choiceReason(form,effects)};
    replacesGameId = gameId;
    return row;
  });
  if (stages.some(row=>!row)) return null;
  return {id,nameKo:path.nameKo,stages,sourceIds:scenarioItemPaths.sourceIds};
}
