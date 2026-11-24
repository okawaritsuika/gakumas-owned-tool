const list=value=>Array.isArray(value)?value:[];
const axes=['vocal','dance','visual'];
const copy=value=>value==null?value:structuredClone(value);
const anyValue=value=>Object.values(value?.stats??{}).some(number=>number!==0)
  ||Object.values(value?.resources??{}).some(number=>number!==0);
const wikiSource={id:'hif-custom-item-guide',title:'HIF 위키 · 선택형 P아이템과 커스텀',
  url:'https://seesaawiki.jp/gakumasu/d/H.I.F',checkedAt:'2026-11-04',kind:'community_documented'};

function currentLedger(result){
  return result.resourceLedger??result.produceResourceLedger
    ??list(result.activityRouteComparison?.candidates).find(row=>row.selected)?.resourceLedger??null;
}

/** Display existing coverage only. This function never adds item bonuses to stats. */
export function buildItemConsideration({result={},catalog={},inventory={},options={}}={}){
  const scenarioId=options.scenario??result.scoreSummary?.scenario??'hif';
  const ledger=currentLedger(result),supports=Array.isArray(result.supports)?result.supports
    :[...list(result.supports?.owned),...(result.supports?.rental?[result.supports.rental]:[])];
  const model=result.scoreSummary?.hifModel;
  const itemValues=new Map(list(ledger?.supportItems).map(item=>[item.supportGameId,item]));
  const supportRows=supports.filter(card=>card.p_item||itemValues.has(card.gameId)).map(card=>{
    const value=card.supportItemValue?.comparison?card.supportItemValue:itemValues.get(card.gameId)??card.supportItemValue;
    const applied=value?.applied??null,hasApplied=anyValue(applied),unsupported=value?.status==='unsupported';
    const potential=value?.potential?.unknown?.max;
    const hasPotential=!unsupported&&(anyValue(potential)||list(value?.potential?.early?.operations).length>0||list(applied?.discounts).length>0);
    const comparison=card.supportItemValue?.comparison;
    const projected=model?.supportPeakScenario?card.supportItemValue?.peak?.total:comparison?.basis!=='declared_timeline'?comparison?.total:null;
    const links=list(model?.supportLinks).filter(link=>link.source==='item'&&link.receiverId===card.gameId);
    const peakUsed=Boolean(projected&&(anyValue(projected)||links.length||list(projected.operations).length));
    const actualCoverage=peakUsed?'conditional_peak_included':hasApplied?'partial_included':hasPotential?'conditional_only':'not_included';
    return {id:card.gameId,supportGameId:card.gameId,supportName:card.nameKo??card.name??card.nameJa,
      name:value?.itemName??card.p_item?.name??'P아이템 미확인',level:card.level??null,rental:card.rental===true,
      status:value?.status??'missing_evaluation',actualCoverage,acquisitionConfirmed:value?.acquisitionConfirmed===true,
      statForecastHasRawGrant:Object.values(applied?.stats??{}).some(number=>number!==0),
      resourceLedgerContainsConfirmedGrant:Object.values(applied?.resources??{}).some(number=>number!==0),battleEffectsInStatForecast:false,
      summary:peakUsed?'추천은 이 경로에서 유리한 시기에 획득·발동한 경우의 지급량과 편성 연계를 사용했습니다.':hasApplied?'확인된 획득·발동 조건의 육성 효과를 반영했습니다.':hasPotential?
        '획득·조건이 미확정이라 수치에는 더하지 않고 조건부 범위만 표시합니다.':'현재 계산에 수치로 반영하지 않은 효과입니다.',
      included:applied?{stats:copy(applied.stats),resources:copy(applied.resources),activationCount:applied.activationCount??0,
        byStage:copy(value.byStage),discounts:copy(applied.discounts),basis:'existing_model_raw_item_grants_before_final_stat_caps'}:null,
      rankedProjection:peakUsed?{stats:copy(projected.stats),resources:copy(projected.resources),
        routeActivationCount:projected.activationCount,deckLinks:copy(links),basis:comparison?.basis??card.supportItemValue.peak?.basis}:null,
      conditional:unsupported?null:{ranges:copy(value?.potentialRanges??null),early:copy(value?.potential?.early??null),
        late:copy(value?.potential?.late??null),basis:'declared_opportunity_bound_not_expected_value',knownProduceEffectsOnly:true,completeItemValueBound:false},
      conditions:list(value?.conditions),notIncluded:!value?['기존 모델의 P아이템 평가 자료가 없습니다.']:
        [...list(value.unscored),...(value.battleItem?.mode==='stage'?['시험 중 효과는 현재 전투 제외 예측에 수치로 환산하지 않습니다.']:[])],
      value:copy(value??null)};
  });
  const confirmed=supportRows.filter(row=>anyValue(row.included));
  const projected=supportRows.filter(row=>row.rankedProjection);
  const support={actualCoverage:projected.length?'conditional_peak_included':confirmed.length?'partial_included':supportRows.some(row=>row.actualCoverage==='conditional_only')?'conditional_only':'not_included',
    summary:`서포트 P아이템 ${supportRows.length}개 중 입력으로 확인된 지급 ${confirmed.length}개, 경로 조건을 가정한 지급 ${projected.length}개.`,
    included:confirmed,projected,
    conditional:supportRows.filter(row=>row.actualCoverage==='conditional_only'),
    notIncluded:supportRows.filter(row=>row.actualCoverage==='not_included'),items:supportRows,
    rankingScope:{authorRecommendedPoolUsed:result.sourceGuideEvidence?.mode==='guide',
      numericRankingIncludesConfirmedProduceEffectsOnly:projected.length===0,battleItemPowerConvertedToPoints:false,allItemEffectsRanked:false},
    limitations:['위 수치는 기존 모델에 이미 들어간 아이템 지급량입니다. 최종 상한으로 버려지는 양과 편성의 한계 기여는 다를 수 있습니다.',
      '획득 시점·발동 조건·명시한 행동이 확인된 효과만 보장 합산합니다. 미확인 발동을 최대 횟수로 가산하지 않습니다.']};
  const badge=list(catalog.pItems).find(item=>item.nameJa==='H.I.Fワッペン');
  const star=catalog.produceResources?.hif?.star;
  const itemPath=model?.supportActionPlan?.peakScenario?.scenarioItem;
  const scenario=scenarioId==='hif'?{actualCoverage:model?.supportRating?.badgeEvaluationPoints!=null||itemPath?.status==='conditional_path'?'conditional_peak_included':'partial_reference_only',
    rankedDrinkPath:copy(itemPath??null),
    summary:[model?.supportRating?.badgeEvaluationPoints!=null?`추천에 와펜 ${model.supportRating.badgeActivationCount}회의 기본 스타성을 반영했습니다.`:'와펜의 카드 획득·스타성 규칙을 참고합니다.',
      itemPath?.status==='conditional_path'?`${itemPath.nameKo} 경로의 해당 주차에서 지급·카드 관리 효과를 적용했습니다.${itemPath.receipts?' 드링크 '+itemPath.receipts+'개.':''}`:'시나리오 아이템의 실제 선택은 미확인입니다.'].join(' '),
    included:[],conditional:star?[{id:badge?.gameId??null,name:badge?.nameJa??'H.I.F 와펜',
      rule:{starPerCard:star.cardAcquisitionBase,activationCap:star.cardAcquisitionCap},
      stages:list(ledger?.stages).map(stage=>({stage:stage.stage,potentialCardStar:copy(stage.star?.potentialDeclaredCardBaseIncome??null),
        appliedCardStar:stage.star?.declaredCardBaseIncome??null,actualTotalStar:stage.star?.total??null})),
      sourceIds:list(star.sourceIds),conditions:['명시한 카드 획득만 발동 기회로 대조합니다. 체인지·방문 횟수를 카드 획득으로 바꾸지 않습니다.',
        '이전 발동 횟수·친애도·시험 보상 등이 없어 실제 스타성 합계는 미확정입니다.']}]:[],
    notIncluded:itemPath?.status==='conditional_path'?[]:[{id:'chosen_scenario_item',name:'시나리오에서 고르는 P아이템',
      reason:'아이템 경로와 발동 주차를 지정한 경우 해당 선택의 효과를 계산합니다.'}],
    choiceGuidance:[{when:'상담 위주 동선',reason:'상담 발동 PP·할인형을 실제 제시된 선택지와 대조합니다.'},
      {when:'외출 위주 동선',reason:'외출 발동 강화·복사·제거형을 실제 제시된 선택지와 대조합니다.'},
      {when:'안정적인 레슨 발동을 원하는 경우',reason:'레슨 발동 보급형의 커스텀과 발동 제한을 확인합니다.'}],
    sourceIds:[...list(star?.sourceIds),wikiSource.id],choiceGuidanceIsConditional:true}:
    {actualCoverage:'unavailable',summary:'현재 시나리오 P아이템의 반영 자료가 연결되지 않았습니다.',included:[],conditional:[],notIncluded:[{
      id:'scenario_items',reason:'HIF 와펜·커스텀 아이템 자료를 다른 시나리오에 대신 적용하지 않았습니다.'}],sourceIds:[]};
  const startItems=result.scenarioStartItemPlan, reward=result.scoreSummary?.nonHifModel?.scenarioReward;
  if(startItems?.groups?.length||reward?.items?.length){
    scenario.actualCoverage=startItems?.selectedItems.length||reward?.items?.length?'partial_included':'conditional_only';
    scenario.included=[...list(startItems?.selectedItems).map(item=>({id:item.id,name:item.name})),...list(reward?.items)];
    scenario.summary=`시작 전 선택 ${list(startItems?.selectedItems).length}개 · 육성 중 비교에 채택한 보상 ${list(reward?.items).length}개. `+list(startItems?.notes).join(' ');
    scenario.notIncluded=[];
  }
  const idolId=result.selectedIdol?.gameId,profile=list(catalog.guideSupportProfiles?.profiles).find(row=>(row.idolGameId??row.idolCardId)===idolId&&row.scenario===scenarioId);
  const uniqueRefs=list(profile?.uniqueItemRefs).length?list(profile.uniqueItemRefs):
    [...new Set(Object.entries(result.selectedIdol?.uniqueIds??{}).filter(([key,value])=>/ItemId$/.test(key)&&value).map(([,value])=>value))]
      .map(gameId=>list(catalog.pItems).find(item=>item.gameId===gameId)??{gameId});
  const unique={actualCoverage:uniqueRefs.length?'identity_and_conditions_only':'unavailable',
    summary:uniqueRefs.length?'고유 P아이템의 신원·운영 조건은 확인하지만 시험 중 효과를 예측 수치로 환산하지 않습니다.':'고유 P아이템 자료가 연결되지 않았습니다.',
    included:[],conditional:[],notIncluded:uniqueRefs.map(item=>({...copy(item),reason:'시험 중 효과·실제 강화 상태·발동 횟수는 이번 수치 예측에 반영하지 않았습니다.'})),
    operatingNotes:copy(profile?.operatingNotes??[]),variantConfirmed:false,sourceIds:profile?.sourceIds??[]};
  const modeId=options.eventModeId??result.eventContext?.modeId??null;
  const eventEffect=result.eventContext?.itemEffects;
  const event={actualCoverage:modeId?eventEffect?.nativeEffectChainVerified?'identity_and_conditions_only':'not_included':'not_selected',
    summary:modeId?eventEffect?.nativeEffectChainVerified?'이벤트 P아이템의 원본 효과 조건은 확인했지만 시험 중 효과는 예측 수치에 합산하지 않습니다.':
      '이벤트 해금 예외와 이벤트 P아이템의 수치 반영은 별개입니다. P아이템 선택·획득 상태는 미확정입니다.':'이벤트 모드를 선택하지 않았습니다.',
    included:[],conditional:eventEffect?[copy(eventEffect)]:[],notIncluded:modeId?[{id:'event_items',reason:eventEffect?.nativeEffectChainVerified?
      '검증한 원본 효과는 시험 중 효과입니다. 실제 회차의 아이템 ID 연결·소지 상태와 적용 횟수를 예측 값으로 바꾸지 않았습니다.':
      '이벤트 P아이템의 정확한 원본·선택·획득 시점이 현재 예측 입력에 연결되지 않았습니다.'}]:[],
    eventModeId:modeId,unlockExceptionIsItemBonus:false};
  return {status:'existing_model_coverage_only',categories:{support,scenario,unique,event},
    summary:'서포트·시나리오·고유·이벤트 P아이템을 구분해 반영 범위를 표시합니다. 모든 효과를 계산했다는 뜻은 아닙니다.',
    additionalStatsApplied:false,inventoryChanged:false,liveItemInventoryCaptured:false,customItemBranchOptimized:Boolean(model?.fixedDeckPolicyComparison?.policiesCompared>1),
    forecastConnection:{basis:options.finalStats&&axes.some(axis=>options.finalStats[axis]!=null||options.finalStats[({vocal:'vo',dance:'da',visual:'vi'})[axis]]!=null)?'manual_final_stats_not_item_model':result.scoreSummary?.nonHifModel?'existing_scenario_capped_stats':'existing_hifModel_cappedStats',rawItemGrantsMayBeCapped:true,
      separateItemBonusAdded:false,appliedStats:Object.fromEntries(axes.map(axis=>[axis,supportRows.reduce((sum,row)=>sum+(row.included?.stats?.[axis]??0),0)]))},
    sources:[...list(ledger?.sources),wikiSource,...list(catalog.guideSupportProfiles?.sources)].filter((source,index,all)=>all.findIndex(row=>row.id===source.id)===index)};
}
