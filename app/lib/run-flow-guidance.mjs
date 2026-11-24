import {buildHifAbilityTargetContext} from './hif-ability-guidance.mjs';
const list=value=>Array.isArray(value)?value:[];
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const typeOf=value=>({full_power:'fullPower',goodImpression:'goodImpressionTurns'})[value]??value;
const rank={at_start:0,after_selection_1:1,conditional_during:2,unknown:3,missing:4};

/** Source-conditioned instructions; no hand order or battle score is fabricated. */
export function buildRunFlowGuidance({result={},catalog={},inventory={},options={}}={}){
  const context={scenario:result.scoreSummary?.scenario??options.scenario??'hif',plan:result.scoreSummary?.plan??options.plan,
    trainingType:typeOf(result.scoreSummary?.trainingType??options.trainingType),producerLevel:options.producerLevel??inventory.producerLevel??null,
    idolGameId:result.selectedIdol?.gameId??null,eventModeId:options.eventModeId??result.eventContext?.modeId??null};
  const mode=list(catalog.eventModes?.modes).find(mode=>mode.id===context.eventModeId);
  context.modeFamily=mode?.family?.startsWith('asari')||context.eventModeId?.startsWith('asari')?'asari':'normal_hif';
  const data=catalog.produceFlowGuidance??{},sources=list(data.sources);
  const sourceRefs=refs=>list(refs).map(ref=>{const source=sources.find(source=>source.id===ref.sourceId);return{...ref,...source,
    sourceId:ref.sourceId,url:source?.url?source.url+(source.url.includes('youtube.com')&&number(ref.startSec)!==null?`&t=${ref.startSec}s`:''):null};});
  if(context.scenario!=='hif')return{status:'unsupported_scenario',context,sourceProfiles:[],stages:[],notApplicableProfiles:[],limitations:['HIF 운영 자료를 다른 시나리오에 대신 적용하지 않았습니다.'],battleSimulationRun:false};
  const targetContext=buildHifAbilityTargetContext({result,memories:result.memories,selectedIdol:result.selectedIdol,catalog,inventory,options:{...options,...context}});
  const cardRef=ref=>{const all=targetContext.targets.filter(target=>target.gameId===ref.gameId).sort((a,b)=>rank[a.availability]-rank[b.availability]);
    const acquire=targetContext.canAcquire(ref.gameId),availability=all[0]?.availability??(acquire===true?'conditional_during':acquire===false?'missing':'unknown');
    const card=list(catalog.skillCards).find(card=>card.gameId===ref.gameId&&card.upgradeCount===0);
    return{...ref,name:ref.nameKo??card?.nameKo??card?.name, nameJa:ref.nameJa??card?.nameJa,imageUrl:ref.imageUrl??card?.thumbnailUrl??card?.imageUrl,
      availability,selectedMemoryIds:list(result.memories).filter(memory=>memory.modelEffects?.carriedSkill?.id===ref.gameId).map(memory=>memory.id),
      acquisitionGuaranteed:false,useConditions:card?.conditions??null};};
  const matches=list(data.profiles).filter(profile=>(profile.plan===context.plan||profile.plan==='free')&&(typeOf(profile.trainingType)===context.trainingType||profile.trainingType==='general'));
  const eventPlanAllowed=!mode?.supportedPlans?.length||mode.supportedPlans.includes(context.plan);
  const characterPolicy=result.scoreSummary?.hifModel?.guideMemoryProfile?.characterPolicy;
  const suppressedCommonLoop=characterPolicy?.applied===true&&characterPolicy.genericCarryRolesSuppressed===true;
  const excludedForCharacter=matches.filter(profile=>suppressedCommonLoop&&profile.trainingType!=='general'&&!list(profile.idolCardIds).includes(context.idolGameId));
  const active=matches.filter(profile=>profile.modeFamily===context.modeFamily&&eventPlanAllowed&&!excludedForCharacter.includes(profile));
  const describe=profile=>({id:profile.id,label:profile.labelKo,sourceEventMonth:profile.sourceEventMonth,
    applicability:profile.modeFamily==='normal_hif'?'ordinary_hif_source_reference_not_current_loop_validation':profile.currentRoundMethodReferenceSupported?'author_method_reference_current_round_exact_conditions_unverified':'historical_event_reference_exact_round_unverified',
    currentRoundExactRecipeVerified:false,fullRecipeValidatedForCurrentIdol:profile.fullRecipeValidatedForAtmosphere===true&&context.idolGameId==='i_card-kllj-3-015',
    sourceCompleteLoopProducerLevel:profile.sourceCompleteLoopLevelByType?.[context.trainingType]??null,
    sourceLoopLevelMet:profile.sourceCompleteLoopLevelByType?.[context.trainingType]!=null&&number(context.producerLevel)!=null?
      context.producerLevel>=profile.sourceCompleteLoopLevelByType[context.trainingType]:null,
    sourceLoopAssumptionIsUniversalUnlockGate:false,
    conditions:list(profile.conditions),sources:sources.filter(source=>list(profile.sourceIds).includes(source.id))});
  const stageIds=['opening','setup','main_turn','next_round'],labels={opening:'초반',setup:'준비',main_turn:'주력 카드 사용',next_round:'다음 시험'};
  const stages=stageIds.map(id=>({id,label:labels[id],steps:active.flatMap(profile=>list(profile.stages).filter(stage=>stage.id===id).flatMap(stage=>list(stage.steps).map(step=>{
    const cards=list(step.cardRefs).map(cardRef),anyAvailable=cards.some(card=>['at_start','after_selection_1'].includes(card.availability));
    const hif=list(result.hifAbilityGuidance?.selectedMemories).flatMap(memory=>list(memory.hifEffects));
    const triggerIds=list(step.hifTriggerCardIds).length?step.hifTriggerCardIds:cards.filter(card=>!list(step.carrierCardIds).includes(card.gameId)).map(card=>card.gameId);
    const hifRequirements=step.requiresHifAbility?triggerIds.map(gameId=>{
      const target=cards.find(card=>card.gameId===gameId)??cardRef({gameId});
      const effects=hif.filter(effect=>effect.applies===true&&effect.targetAvailability!=='inapplicable'&&list(effect.triggerCards).some(card=>card.gameId===gameId));
      const targetPresent=['at_start','after_selection_1'].includes(target.availability);
      return{gameId,targetAvailability:target.availability,applicableEffectIds:effects.map(effect=>effect.effectId),
        applicableMemoryPresent:effects.length>0,targetPresent,readyForUseConditionCheck:targetPresent&&effects.some(effect=>effect.targetRequirementSatisfied===true)};
    }):[];
    const missingMemory=hifRequirements.some(requirement=>!requirement.applicableMemoryPresent);
    const missingTarget=hifRequirements.some(requirement=>!requirement.targetPresent);
    const unresolvedTrigger=hifRequirements.some(requirement=>!requirement.readyForUseConditionCheck);
    return{...step,profileId:profile.id,cardRefs:cards,sourceRefs:sourceRefs(step.sourceRefs),
      hifRequirements,
      status:step.requiresHifAbility?missingMemory?'needs_hif_memory':missingTarget?'needs_trigger_acquisition':unresolvedTrigger?'needs_trigger_confirmation':'condition_check_required':
        cards.length&&!anyAvailable?'needs_acquisition_or_unlock':'condition_check_required',
      currentRoundExactConditionsVerified:false,actualUseConfirmed:false};
  })))}));
  const opening=list(result.memories).filter(memory=>memory.modelEffects?.carriedSkill?.phase?.availableAtStart===true).map(memory=>({gameId:memory.modelEffects.carriedSkill.id,
    nameKo:memory.nameKo??memory.name,nameJa:memory.nameJa}));
  stages[0].steps.unshift({id:'actual-opening-cards',text:'첫 시험에서는 개시 반입 카드·보유 고유·시나리오 기본 덱을 먼저 확인합니다. 선발시험 1 뒤에 합류하는 반입 스킬을 첫 시험 카드로 세지 않습니다.',
    cardRefs:opening.map(cardRef),conditions:['실제 손패 순서·비용은 수집되지 않았습니다.'],sourceRefs:[],source:'account_timing_and_native_phase',actualUseConfirmed:false});
  const later=list(result.memories).filter(memory=>memory.modelEffects?.carriedSkill?.phase?.availableAtStart===false).map(memory=>({gameId:memory.modelEffects.carriedSkill.id,
    nameKo:memory.nameKo??memory.name,nameJa:memory.nameJa}));
  if(later.length)stages[1].steps.unshift({id:'after-selection-one-cards',text:'이 반입 스킬은 선발시험 1 종료 후 합류합니다. 첫 시험의 카드와 구분하고 다음 시험부터 확보된 스킬로 대조합니다.',
    cardRefs:later.map(cardRef),conditions:['반입 카드의 합류 시점이며 HIF 어빌리티 자체의 등록 시점과는 별개입니다.'],sourceRefs:[],
    source:'account_memory_phase',status:'after_selection_1',actualUseConfirmed:false});
  const idolProfile=list(catalog.guideSupportProfiles?.profiles).find(profile=>(profile.idolGameId??profile.idolCardId)===context.idolGameId);
  for(const note of list(idolProfile?.operatingNotes))stages[2].steps.push({id:note.id,text:note.textKo,cardRefs:list(note.skillRefs).map(cardRef),
    conditions:note.conditions,sourceRefs:list(note.sourceIds).map(sourceId=>({sourceId,...list(catalog.guideSupportProfiles?.sources).find(source=>source.id===sourceId)})),
    source:'exact_idol_native_condition',actualUseConfirmed:false});
  stages[3].steps.push({id:'exam-reward-following-stage',text:'선발시험 보상창의 실제 상승량을 입력하면 다음 시험부터 반영합니다. 미입력 시험은 최대 보상 참고 가정이며 선발 상한에서 버려진 능력치는 본선에서 복원되지 않습니다.',
    cardRefs:[],source:'current_model_reward_timing',conditions:['시험 점수만으로 실제 보상을 역산하지 않습니다.'],sourceRefs:[],actualUseConfirmed:false});
  const preparation=data.finalStatPreparationReference??data.parameterPreparation;
  const examProfile=list(catalog.hifExamProfiles?.profiles).find(profile=>profile.idolCardId===context.idolGameId);
  const exam=list(examProfile?.examStages).find(stage=>stage.stage==='final'&&stage.order===2)??list(examProfile?.examStages).find(stage=>stage.stage==='final');
  const order=exam?.reference?.attributeOrder??examProfile?.reference?.attributeOrder??[];
  const stats=result.scoreSummary?.projectedStats??result.scoreSummary?.hifModel?.cappedStats;
  const parameterPreparation=preparation?{...preparation,sourceRefs:sourceRefs(preparation.sourceRefs),attributeOrder:order,
    targets:list(order).map((axis,index)=>({axis,target:preparation.byExamAttributeRank[index],projected:number(stats?.[axis]),
      remaining:number(stats?.[axis])==null?null:Math.max(0,preparation.byExamAttributeRank[index]-stats[axis])})),
    exactMarkBoundaryVerified:false,usedAsAutomaticScoreWeight:false,eventRoundApplicabilityVerified:false}:null;
  return{status:active.length?'conditional_source_flow':'account_timing_with_separate_source_references',context,sourceProfiles:active.map(describe),
    referenceProfiles:matches.filter(profile=>!active.includes(profile)).map(describe),stages,parameterPreparation,
    accountPlan:{openingSteps:list(result.personalizedPlan?.openingPlan?.steps),midgameSteps:list(result.personalizedPlan?.midgamePlan?.steps),
      acquisitionTargets:list(result.personalizedPlan?.midgamePlan?.acquisitionTargets).map(cardRef),afterSelection1Cards:later.map(cardRef),
      separateFromHistoricalSourceRecipe:true},
    hifAbilityAdvice:result.hifAbilityGuidance?.recommendations??[],
    sleepBudgetReferences:active.flatMap(profile=>list(profile.retentionRequirements)),
    additionalSourceReferences:list(data.reviewedSourceRules).filter(rule=>active.some(profile=>list(profile.sourceIds).includes(rule.sourceId))),
    researchCoverage:data.researchCoverage??data.coverage??null,
    notApplicableProfiles:[...list(data.profiles).filter(profile=>!matches.includes(profile)).map(profile=>({id:profile.id,label:profile.labelKo,reason:'현재 플랜·육성 유형과 다른 원문입니다.'})),
      ...excludedForCharacter.map(profile=>({id:profile.id,label:profile.labelKo,reason:'이 P카드의 고유 예외 때문에 유형 공통 루프를 확정 적용하지 않습니다.'}))],
    readinessConfirmed:false,battleSimulationRun:false,liveHandOrderCaptured:false,
    limitations:[...list(data.limitations),'단계별 참고 흐름이며 지금 누를 카드의 최적 순서를 계산한 자동 플레이가 아닙니다.',
      '현재 회차·고유·개조·실제 획득·손패·드링크의 모든 조건이 같다고 확인하지 않았습니다.'],sources};
}
