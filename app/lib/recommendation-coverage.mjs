import {computeIdolGrowth} from './idol-growth.mjs';

const list=value=>Array.isArray(value)?value:[];
const idOf=row=>row?.gameId??row?.id??null;
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const rank=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const types=value=>({full_power:'fullPower',good_condition:'goodConditionTurns',goodCondition:'goodConditionTurns',good_impression:'goodImpressionTurns',goodImpression:'goodImpressionTurns',enthusiasm:'strength'})[value]??value;
const axes=['vo','da','vi'];
const vector=value=>value&&axes.every(axis=>number(value[axis])!==null)?Object.fromEntries(axes.map(axis=>[axis,value[axis]])):null;
const longVector=value=>value&&['vocal','dance','visual'].every(axis=>number(value[axis])!==null)?structuredClone(value):null;
const hasGrant=value=>Object.values(value?.stats??{}).some(value=>number(value)!==null&&value!==0)||Object.values(value?.resources??{}).some(value=>number(value)!==null&&value!==0);
const field=(id,label,status,evidence={},notes=[])=>({id,label,status,evidence,notes});

/** Report what the existing recommendation used; never changes its ranking or
 * turns parsed unique-effect descriptions into a combat score. */
export function buildRecommendationCoverage({result={},catalog={},inventory={},options={}}={}){
  const selected=result.selectedIdol??null,id=idOf(selected),card=list(catalog.idolCards).find(row=>idOf(row)===id)??selected;
  const observed=list(inventory.idolCards).find(row=>idOf(row)===id),owned=selected?.owned??observed??{};
  const ownedConfirmed=Boolean(id&&(selected?.ownershipVerified===true||observed));
  const scenario=result.scoreSummary?.scenario??options.scenario??null,model=result.scoreSummary?.hifModel??null,hif=scenario==='hif'&&Boolean(model);
  const plan=result.scoreSummary?.plan??selected?.plan??options.plan??null,trainingType=types(result.scoreSummary?.trainingType??options.trainingType??options.type??card?.recommendedEffect??null);
  const computed=card?computeIdolGrowth(card,owned):null;
  const growthBreakdown=selected?.growthBreakdown??computed?.growthBreakdown??null;
  const growthStatus=selected?.growthStatus??computed?.growthStatus??'unknown';
  const currentGrowth=Object.hasOwn(selected??{},'currentGrowthRatePermil')?vector(selected.currentGrowthRatePermil):vector(owned.currentGrowthRatePermil)??vector(computed?.currentGrowthRatePermil);
  const knownGrowth=currentGrowth??vector(growthBreakdown?.knownTotal);
  const specialRank=rank(owned.levelLimitRank??owned.uncap??owned.specialTrainingRank),potentialRank=rank(owned.potentialRank??owned.awakeningRank??owned.awakening);
  const profile=model?.guideMemoryProfile??null,policy=profile?.characterPolicy??null;
  const policyReported=policy?.applied===true&&policy?.usedForSelection===true;
  const policyIdentity=Boolean(id&&policy?.selectedIdolGameId===id);
  const policyType=!profile?.trainingType||types(profile.trainingType)===trainingType;
  const policyUsed=hif&&policyReported&&policyIdentity&&policyType;
  const policyStatus=!policy?'not_configured':!hif?'not_applicable':policyReported&&(!policyIdentity||!policyType)?'inconsistent_evidence':policyUsed?'used':'not_applied';
  const notAppliedNotes=list(policy?.observations).filter(row=>!row.applied).map(row=>{
    const labels={requirements_not_met:'원문 운용 조건 미충족',requirements_unconfirmed:'원문 운용 조건 미확인',event_scope_mismatch:'다른 이벤트·일반 모드의 원문',training_type_mismatch:'다른 육성 유형의 원문',scenario_mismatch:'다른 시나리오의 원문',native_identity_mismatch:'정확한 P카드 대응 미확인',native_unique_identity_mismatch:'원문과 현재 고유 효과 ID 대응 불일치',source_unverified:'출처 확인 미완료',difficulty_unconfirmed:'난이도 미확인',difficulty_mismatch:'다른 난이도의 원문'};
    return (labels[row.reason]??'현재 적용 조건 확인 필요')+
      (row.requirements?.minProducerLevel!=null?' · 원문 운용 PLv '+row.requirements.minProducerLevel+' 이상 조건':'')+
      (row.requirements?.maxProducerLevel!=null?' · 해금 전 대안 검토 범위 PLv '+row.requirements.maxProducerLevel+' 이하':'')+
      (row.requirements?.minSpecialTrainingRank!=null?' · 원문 특훈 '+row.requirements.minSpecialTrainingRank+' 이상 전제':'')+
      (row.requirements?.minPotentialRank!=null?' · 원문 개화 '+row.requirements.minPotentialRank+' 이상 전제':'')+
      (row.requirements?.requiredSwitchGameIds?.length?' · 스위치 선택 확인 필요':'')+
      (row.requirements?.selectedRecipeId?' · 해당 공략 경로의 명시적 선택 필요':'');
  });
  const sourceGuide=result.sourceGuideEvidence??result.scoreSummary?.sourceGuideEvidence??null;
  const sourceProfile=list(catalog.guideSupportProfiles?.profiles).find(row=>row.id===sourceGuide?.profileId);
  const exactGuide=Boolean(sourceProfile&&(sourceProfile.idolCardId??sourceProfile.idolGameId)===id&&sourceProfile.scenario===scenario&&(!sourceProfile.plan||sourceProfile.plan===plan)&&(!sourceProfile.trainingType||types(sourceProfile.trainingType)===trainingType));
  const sourceUsed=hif&&sourceGuide?.mode==='guide'&&exactGuide;
  const operating=result.idolOperatingGuidance?.selectedIdol?.gameId===id?result.idolOperatingGuidance:null;
  const uniqueProfile=list(catalog.multiCreatorGuidance?.idolProfiles).find(row=>row.idolGameId===id);
  const uniqueSkills=list(operating?.uniqueSkills).filter(row=>row.selectedForCurrentAccount===true).map(row=>({gameId:row.gameId,upgradeCount:row.upgradeCount,nameKo:row.nameKo??null,nameJa:row.nameJa??null,nativeReferenceAvailable:row.nativeReferenceAvailable===true,effectDefinitionIdentityVerified:row.effectDefinitionIdentityVerified===true}));
  const uniqueItems=list(operating?.uniqueItems).filter(row=>row.selectedForCurrentAccount===true).map(row=>({gameId:row.gameId,isUpgraded:row.isUpgraded??null,nameJa:row.nameJa??null,nativeReferenceAvailable:row.nativeReferenceAvailable===true,effectDefinitionIdentityVerified:row.effectDefinitionIdentityVerified===true}));
  const uniqueIds=new Set([...uniqueSkills.map(row=>row.gameId),...list(card?.uniqueIds?.produceCardId?[card.uniqueIds.produceCardId]:[]),...list(card?.uniqueIds?.secondProduceCardId?[card.uniqueIds.secondProduceCardId]:[])]);
  const effects=list(result.hifAbilityGuidance?.selectedMemories).flatMap(memory=>list(memory.hifEffects).map(effect=>({memoryId:memory.memoryId,effectId:effect.effectId,applies:effect.applies??null,targetRequirementSatisfied:effect.targetRequirementSatisfied===true,
    targetAvailability:effect.targetAvailability??'unknown',triggerCardIds:[...new Set([...list(effect.trigger?.cardIds),...list(effect.triggerCards).map(idOf)].filter(Boolean))],activationConfirmed:false})));
  const uniqueTargets=effects.filter(effect=>effect.applies!==false&&effect.triggerCardIds.some(id=>uniqueIds.has(id)));
  const supports=Array.isArray(result.supports)?result.supports:[...list(result.supports?.owned),...(result.supports?.rental?[result.supports.rental]:[])];
  const ledger=result.resourceLedger??list(result.activityRouteComparison?.candidates).find(row=>row.selected)?.resourceLedger;
  const scenarioDeck=result.scoreSummary?.nonHifModel;
  const values=!scenarioDeck&&list(ledger?.supportItems).length?ledger.supportItems:supports.map(row=>row.supportItemValue).filter(Boolean);
  const appliedItems=values.filter(row=>row.acquisitionConfirmed===true&&hasGrant(row.applied));
  const projectedItems=list(result.itemConsideration?.categories?.support?.projected).map(row=>row.supportGameId);
  const ownIds=new Set(list(inventory.idolCards).map(idOf).filter(Boolean)),linked=list(catalog.multiCreatorGuidance?.idolProfiles).filter(row=>ownIds.has(row.idolGameId)&&row.identityVerified===true);
  const modeledInitial=hif?longVector(model.initialStats):longVector(scenarioDeck?.idolInitialStats);
  const numericInitial=ownedConfirmed&&modeledInitial!==null;
  const overriddenInitialAxes=['vocal','dance','visual'].filter(axis=>number(options.initialStats?.[axis])!==null);
  const usedForSelection=[
    field('actual_context','실제 플랜·선택 육성 유형',['sense','logic','anomaly'].includes(plan)?'used':'unknown',{plan,trainingType,nativeRecommendedType:types(card?.recommendedEffect??null),selectionMode:selected?.selectionMode??null},['플랜·반입 조건과 공략 적용 범위에 사용합니다. 유형이 같아도 고유 카드 효능이 같은 것으로 보지 않습니다.']),
    field('initial_stats','기본·특훈 초기 능력치',numericInitial?(overriddenInitialAxes.length===3?'manual_override':specialRank===null||overriddenInitialAxes.length?'partial':'used'):'not_in_numeric_path',{baseStats:structuredClone(card?.baseStats?.baseVoDaVi??null),specialTrainingRank:specialRank,modeledCombinedInitial:hif?modeledInitial:null,modeledIdolInitial:scenarioDeck?modeledInitial:null,manualInitialOverride:overriddenInitialAxes.length>0,overriddenInitialAxes},['직접 지정한 초기값은 해당 속성의 카드 초기값을 대신합니다.']),
    field('persistent_growth','개화·캐릭터 True End 성장률',(hif||scenarioDeck?.idolGrowthRatePermil)&&ownedConfirmed&&knownGrowth?(growthStatus==='current_card'&&currentGrowth?'used':'partial'):selected?.selectionMode==='automatic'&&knownGrowth?'used_for_idol_choice':'reference_only',
      {growthStatus,currentGrowthRatePermil:currentGrowth,knownGrowthRatePermil:knownGrowth,base:vector(growthBreakdown?.base),awakening:vector(growthBreakdown?.awakening),trueEnd:vector(growthBreakdown?.trueEnd),potentialRank,observedTrueEndTypes:structuredClone(growthBreakdown?.trueEndProduceTypes??null)},
      [hif||scenarioDeck?'경로에 연결한 기본 상승량에 아이돌·메모리·서포트 성장률을 적용합니다.':'아이돌 성장 자료를 참고합니다.',...(growthBreakdown?.issues??[]).map(row=>row.message)]),
    field('support_levels','서포트 보유 레벨·계산 레벨·돌파',supports.length?'used':'unavailable',{cards:supports.map(row=>({gameId:idOf(row),level:row.level??null,ownedLevel:row.ownedLevel??null,levelBasis:row.levelBasis??null,uncap:row.uncap??null,rental:row.rental===true||row.isRental===true}))},['선택한 레벨 기준으로 각 보유 카드의 실제 해금 효과를 비교합니다. 대여는 실제 친구 목록 보유 여부를 확인해야 합니다.']),
    field('exact_support_pool','정확한 P카드의 서포트 공략 풀',sourceUsed?'used':exactGuide?'available_not_used':'not_configured',{profileId:sourceGuide?.profileId??null,mode:sourceGuide?.mode??null,exactPCardMatched:exactGuide,poolGameIds:sourceUsed?list(sourceGuide.poolGameIds):[]},['캐릭터 이름만 같은 다른 P카드에 원문 추천을 자동으로 옮기지 않습니다.']),
    field('character_memory_policy','정확한 P카드의 반입 정책',policyStatus,{id:policy?.id??null,reportedApplied:policy?.applied??false,reportedUsedForSelection:policy?.usedForSelection??false,selectedIdolGameId:policy?.selectedIdolGameId??null,identityMatches:policyIdentity,trainingTypeMatches:policyType,matchedPolicyIds:list(policy?.matchedPolicyIds),sourceIds:list(policy?.sourceIds),summary:policy?.summary??null,observations:list(policy?.observations)},[...notAppliedNotes,...list(policy?.limitations),'정책의 역할·조건 비교를 고유 스킬의 전투 점수로 환산하지 않습니다.']),
    field('hif_target_conditions','HIF 어빌리티의 발동 대상 조건',!hif?'not_applicable':effects.length?'qualitative_condition_only':'not_selected',
      {selectedEffects:effects,targetPresentCount:effects.filter(row=>row.targetRequirementSatisfied).length,uniqueCardTargetCount:uniqueTargets.length,uniqueCardUsedAsTargetEvidence:uniqueTargets.length>0,actualActivationConfirmed:false,numericSkillBonusApplied:false,copyChangeCount:list(model?.hifAbilityCopyChanges).length},['대상 카드 존재·합류와 실제 사용·발동은 다릅니다. 이 조건을 화력 점수로 더하지 않습니다.']),
    field('support_produce_items','서포트 P아이템의 육성 효과',!hif&&!scenarioDeck?values.length?'reference_only':'unavailable':appliedItems.length||projectedItems.length?'partial':values.length?'conditional_only':'unavailable',
      {evaluatedItems:values.length,numericRankInclusionConfirmed:Boolean(hif||scenarioDeck)&&appliedItems.length>0,conditionalRankedItemIds:projectedItems,
        appliedItems:appliedItems.map(row=>({supportGameId:row.supportGameId,activationCount:row.applied?.activationCount??0,stats:structuredClone(row.applied?.stats??null),resources:structuredClone(row.applied?.resources??null)}))},[projectedItems.length?'추천에서는 경로상 조기 획득과 조건 충족을 가정한 지급량도 비교합니다.':'수치 반영에는 획득·발동 시점이 필요합니다.','카드별 편성 기여는 최종 스탯 상한을 적용한 값입니다.']),
  ];
  const variantEvidence={identityLinked:uniqueProfile?.identityVerified===true,currentVariantConfirmed:operating?.selectedIdol?.currentVariantConfirmed===true,specialTrainingRank:specialRank,potentialRank,uniqueSkills,uniqueItems,
    identityUsedForHifTargetAvailability:uniqueTargets.length>0,effectDefinitionDoesNotMeanNumericalModel:true};
  const guidanceOnly=[field('unique_skills','고유 스킬의 실제 전투 효능','not_numerically_modeled',{identityLinked:variantEvidence.identityLinked,currentVariants:uniqueSkills},['고유 해금·현재 강화 사양과 조건 설명은 확인하지만, 그 화력·손패 순환으로 편성 순위를 계산하지 않습니다.']),
    field('unique_items','고유 P아이템의 실제 전투 효능','not_numerically_modeled',{currentVariants:uniqueItems},['현재 개화 사양의 발동 조건 안내와 실제 발동 횟수·효능 계산을 구분합니다.']),
    field('scenario_event_items','시나리오·이벤트 아이템의 전체 분기','not_fully_modeled',{scenarioCoverage:result.itemConsideration?.categories?.scenario?.actualCoverage??null,eventCoverage:result.itemConsideration?.categories?.event?.actualCoverage??null},['이벤트 등장 제한 면제는 아이템 보너스가 아닙니다. 미확인 선택·커스텀·발동을 합산하지 않습니다.'])];
  const selectedIdol={gameId:id,nameKo:selected?.nameKo??card?.nameKo??null,nameJa:selected?.nameJa??card?.nameJa??null,characterId:card?.characterId??null,characterName:card?.characterName??null,ownershipVerified:ownedConfirmed,plan,trainingType,scenario};
  return {status:id?'partial_model_with_separate_operating_guidance':'selected_idol_unconfirmed',summary:!ownedConfirmed?'선택한 P카드의 보유와 계산 입력을 확인하지 못했습니다. 고유 효능을 모두 반영한 편성으로 판정하지 않습니다.':hif?
    '이 편성은 현재 초기값·성장률과 서포트 효과, 확인된 공략 조건으로 비교했습니다. 고유 스킬·P아이템의 전투 효능까지 계산한 완성 덱은 아닙니다.':
    '이 편성은 선택 시나리오의 참고 경로와 보유 조건으로 비교했습니다. 고유 스킬·P아이템의 전투 효능은 별도 안내이며 완전히 계산하지 않았습니다.',
    selectedIdol,usedForSelection,guidanceOnly,variantEvidence,
    catalogCoverage:{ownedVariants:ownIds.size,ownedCharacters:new Set(list(inventory.idolCards).map(row=>row.characterId).filter(Boolean)).size,nativeIdLinkedOwnedVariants:linked.length,sourceReviewedExactOperatingOwnedVariants:list(catalog.multiCreatorGuidance?.researchCoverage?.ownedExactIdolVariantsWithOperatingRules).filter(id=>ownIds.has(id)).length,
      exactSupportGuideProfiles:list(catalog.guideSupportProfiles?.profiles).length,allOwnedUniqueMechanicsModeled:false},
    characterFullyModeled:false,uniqueSkillCombatEffectsRanked:false,uniqueItemCombatEffectsRanked:false,battleSimulationUsed:false,changesRanking:false,
    limitations:['원자료 ID·효과 설명 연결과 실제 선정 계산에 사용한 정보는 다릅니다.','같은 캐릭터라도 정확한 P카드·현재 해금·플랜·육성 유형의 조건을 따로 확인합니다.','출처가 없는 고유 효능을 임의 가중치로 만들어 더하지 않습니다. 실제 시험 점수·통과율·전체 최적 편성은 검증하지 않았습니다.']};
}
