import { summarizeMemoryEffects } from './memory-effects.mjs';
import { getTrustedEventUnlockOverrides, getEventAdditionalAppearance } from './event-context.mjs';

const list=value=>Array.isArray(value)?value:[];
const idOf=row=>row?.gameId??row?.id;
const number=value=>value!==null&&value!==undefined&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value))?Number(value):null;
const typeOf=value=>({full_power:'fullPower'})[value]??value;
const nameOf=row=>row?.nameKo||row?.name||row?.nameJa||idOf(row)||'미확인';
const skillOf=memory=>memory.modelEffects?.carriedSkill;
const effectSummary=effect=>[...new Set(list(effect.actions).map(action=>{
  if(action.kind==='skill_use_count_add')return `추가 행동 +${action.value??'미확인'}`;
  if(action.type==='ExamCardDraw')return `드로우 ${action.value??'미확인'}장`;
  if(action.kind==='remove_cards')return `${list(action.search?.cards).map(nameOf).join('·')||'조건 카드'} ${action.countMin===action.countMax?action.countMin??'미확인':`${action.countMin}~${action.countMax}`}장${action.raw?.pickRangeType==='ProducePickRangeType_Random'?' 무작위':''} 제외`;
  if(action.kind==='exam_status')return `${({ExamBlock:'기운',ExamFullPowerPoint:'전력치',ExamLessonBuff:'집중',ExamReview:'호인상',ExamParameterBuff:'호조'})[action.type]??action.type} +${action.value??'미확인'}`;
  return action.text??'세부 효과 미확인';
}))].join(' · ')||effect.text||'효과 원자료 미확인';

function sourceProfile(catalog,options,plan){
  const match=row=>row.plan===plan&&typeOf(row.trainingType)===typeOf(options.trainingType);
  const matching=list(catalog.hifAbilityGuidance?.profiles).filter(match);
  const asari=options.eventModeId?.startsWith('asari')||options.hifMode==='asari';
  const profile=(asari?matching.find(profile=>profile.modeFamily==='asari'):matching.find(profile=>profile.modeFamily!=='asari'))??matching.find(profile=>profile.modeFamily!=='asari');
  if(profile)return{profile,goals:list(profile.goals),sources:list(catalog.hifAbilityGuidance.sources)};
  const fallback=list(catalog.hifMemoryRoles?.profiles).find(match);
  return{profile:fallback,goals:list(fallback?.hifAbilityGoals).map((goal,index)=>({...goal,id:goal.id??`hif-source-${index}`,
    sourceIds:goal.sourceIds??fallback.sourceIds, recommendation:goal.recommendation??{purpose:goal.condition,priority:'primary'}})),sources:list(catalog.hifMemoryRoles?.sources)};
}

/** Target availability is independent of the memory carrier's acquisition phase. */
export function buildHifAbilityTargetContext({memories=[],selectedIdol=null,result={},inventory={},catalog={},options={}}={}){
  const plan=result.scoreSummary?.plan??selectedIdol?.plan??options.plan;
  const scenario=result.scoreSummary?.scenario??options.scenario??'hif';
  const level=number(options.producerLevel??inventory.producerLevel),targets=[];
  const add=(gameId,upgradeCount,availability,source)=>{
    if(!gameId)return;const card=list(catalog.skillCards).find(row=>idOf(row)===gameId&&(upgradeCount==null||(row.upgradeCount??0)===upgradeCount));
    targets.push({gameId,name:nameOf(card),nameJa:card?.nameJa??null,imageUrl:card?.thumbnailUrl??card?.imageUrl??null,upgradeCount,availability,source,identityVerified:Boolean(card)});
  };
  const initial=list(result.personalizedPlan?.initialDeck?.masterCards);
  if(initial.length)for(const card of initial)add(card.gameId,card.upgradeCount,'at_start','scenario_initial_deck');
  else{
    const idolId=idOf(selectedIdol??result.selectedIdol),profile=list(catalog.produceInitialDecks?.idolProfiles).find(row=>row.idolCardId===idolId);
    const deck=catalog.produceInitialDecks?.decks?.[profile?.scenarioDeckIds?.['produce-007']];
    if(scenario==='hif')for(const card of list(deck?.cardSlots))add(card.cardId,card.upgradeCount,'at_start','scenario_initial_deck');
  }
  const idol=selectedIdol??result.selectedIdol,unique=list(result.personalizedPlan?.uniqueCards);
  if(unique.length)for(const card of unique)add(card.gameId,card.variantVerified?card.upgradeCount:null,'at_start','owned_idol_unique');
  else if(idol?.ownershipVerified){
    const rank=number(idol.owned?.uncap??idol.owned?.levelLimitRank??idol.owned?.raw?.levelLimitRank);
    const upgrade=effectType=>rank==null?null:list(idol.specialTrainingStages).filter(stage=>stage.rank<=rank&&list(stage.effectTypes).includes(effectType)).length;
    add(idol.uniqueIds?.produceCardId,upgrade('IdolCardLevelLimitEffectType_ProduceCardUpgrade'),'at_start','owned_idol_unique');
    add(idol.uniqueIds?.secondProduceCardId,upgrade('IdolCardLevelLimitEffectType_SecondProduceCardUpgrade'),'at_start','owned_idol_unique');
  }
  for(const memory of memories){const skill=skillOf(memory);if(skill?.obtainable!==true)continue;
    add(skill.id,skill.upgrade??skill.upgradeCount??null,skill.phase?.availableAtStart===true?'at_start':skill.phase?.availableAtStart===false?'after_selection_1':'unknown','selected_memory');}
  const event=getTrustedEventUnlockOverrides(options,{catalog,plan,scenario});
  const canAcquire=gameId=>{
    const card=list(catalog.skillCards).find(row=>idOf(row)===gameId&&(row.upgradeCount??0)===0);
    if(!card||card.recommendationEligible===false)return null;
    const extra=getEventAdditionalAppearance(options,{catalog,plan,scenario,gameId});
    if(card.plan!=='free'&&card.plan!==plan&&!extra)return false;
    const unlock=catalog.memoryEffectDetails?.tables?.ProducerLevelUnlocks?.[gameId];
    const required=number(unlock?.level??card.unlockProducerLevel),switchRequired=unlock?.type==='ProducerLevelUnlockType_ProduceCardConversion'||card.requiresSkillCardSwitch===true;
    const selected=(options.skillCardSwitchSettings??inventory.skillCardSwitchSettings)?.[gameId];
    if(switchRequired&&selected!==true)return selected===false?false:null;
    if(!switchRequired&&event?.producerLevelUnlock===true)return true;
    return required===0?true:required==null||level==null?null:level>=required;
  };
  return{plan,scenario,targets,canAcquire,catalog};
}

export function assessHifEffect(effect,context){
  const conditions=list(effect.actions).flatMap(action=>list(action.conditions));
  const searches=[...new Map(conditions.filter(condition=>condition.search).map(condition=>[condition.search.id??condition.id,condition.search])).values()];
  const groups=searches.map(search=>({ids:list(search.produceCardIds).length?list(search.produceCardIds):list(search.cards).map(card=>card.id),
    upgrades:list(search.upgradeCounts),known:search.known!==false}));
  const rank={at_start:0,after_selection_1:1,conditional_during:2,unknown:3,missing:4};
  const resolved=groups.map(group=>{
    if(!group.known||!group.ids.length)return{availability:'unknown',cards:[]};
    const cards=group.ids.flatMap(gameId=>{
      const present=context.targets.filter(card=>card.gameId===gameId&&(!group.upgrades.length||group.upgrades.includes(card.upgradeCount)));
      if(present.length)return present;
      const acquire=context.canAcquire(gameId),card=list(context.catalog.skillCards).find(card=>idOf(card)===gameId&&(card.upgradeCount??0)===0);
      return[{gameId,name:nameOf(card),nameJa:card?.nameJa??null,imageUrl:card?.thumbnailUrl??card?.imageUrl??null,upgradeCount:null,availability:acquire===true?'conditional_during':acquire===false?'missing':'unknown',source:'during_run_candidate',identityVerified:Boolean(card)}];
    }).sort((a,b)=>rank[a.availability]-rank[b.availability]);
    return{availability:cards[0]?.availability??'missing',cards};
  });
  let targetAvailability=resolved.length?resolved.sort((a,b)=>rank[b.availability]-rank[a.availability])[0].availability:
    effect.includedInInitialTotals===true||conditions.length&&conditions.every(condition=>condition.known!==false&&!list(condition.phaseTypes).includes('ProduceExamPhaseType_ExamCardPlayAfter'))?'at_start':'unknown';
  if(effect.applies!==true)targetAvailability=effect.applies===false?'inapplicable':'unknown';
  return{effectId:effect.effectId,abilityId:effect.abilityId,abilityLevel:effect.abilityLevel,name:effect.name,descriptionJa:effect.descriptionJa,
    uniqueKey:effect.uniqueKey??null,text:effect.text,effectSummary:effectSummary(effect),actions:effect.actions??[],triggerCards:[...new Map(resolved.flatMap(row=>row.cards).map(card=>[card.gameId,card])).values()],
    targetAvailability,targetRequirementSatisfied:['at_start','after_selection_1'].includes(targetAvailability),
    activationConfirmed:false,registrationTiming:{phase:effect.trigger?.phase??null,label:effect.trigger?.label??null,
      independentOfCarriedSkillPhase:true,turns:[...new Set(conditions.flatMap(condition=>list(condition.phaseValues)))]},
    activationLimits:[...new Set(list(effect.actions).flatMap(action=>list(action.activationLimits).map(limit=>typeof limit==='number'?limit:limit.count)))],
    conditions:conditions.map(condition=>condition.text).filter(Boolean),restrictions:effect.restrictions??[],applies:effect.applies};
}

export function fulfilledHifEffectIds(memories,context){
  return [...new Set(memories.flatMap(memory=>list(memory.modelEffects?.hifEffects).map(effect=>assessHifEffect(effect,context))
    .filter(effect=>effect.targetRequirementSatisfied).map(effect=>effect.effectId)))];
}

function copyKey(memory){
  const skill=skillOf(memory);
  if(!skill||skill.obtainable!==true||skill.variantKnown===false||skill.phase?.code==null||list(skill.customizes).some(custom=>!custom.exactCountKnown))return null;
  return JSON.stringify([skill.id,skill.upgrade??skill.upgradeCount,skill.phase.code,list(skill.customizes).map(custom=>[custom.id,custom.customizeCount]).sort()]);
}
const matchesAbility=(effect,ability)=>effect.abilityId===ability.abilityId&&effect.abilityLevel===ability.level;

/** Source effects only break ties among the exact same carried-card recipe. */
export function selectHifAbilityCopies({selected,candidates,catalog,inventory,options,selectedIdol}){
  const source=sourceProfile(catalog,options,selectedIdol?.plan??options.plan),changes=[];
  if(!source.goals.length)return{memories:selected,changes};
  let chosen=[...selected];
  const context=buildHifAbilityTargetContext({memories:chosen,selectedIdol,catalog,inventory,options});
  const quality=memories=>{
    const effects=memories.flatMap(memory=>list(memory.modelEffects?.hifEffects).map(effect=>assessHifEffect(effect,context)));
    const requested=new Set(options.requiredHifEffectIds??[]);
    const goals=source.goals.filter(goal=>goal.recommendation?.priority!=='low_priority');
    const count=(availability,primary)=>goals.filter(goal=>((goal.recommendation?.priority??'primary')==='primary')===primary&&effects.some(effect=>
      (availability==='ready'?effect.targetRequirementSatisfied:effect.targetAvailability==='conditional_during')&&list(goal.abilities).some(ability=>matchesAbility(effect,ability)))).length;
    return{present:[...requested].filter(id=>effects.some(effect=>effect.effectId===id&&effect.applies===true)).length,
      requested:[...requested].filter(id=>effects.some(effect=>effect.effectId===id&&effect.targetRequirementSatisfied)).length,
      readyPrimary:count('ready',true),readyOther:count('ready',false),conditionalPrimary:count('conditional',true),conditionalOther:count('conditional',false)};
  };
  const better=(a,b)=>a.requested-b.requested||a.readyPrimary-b.readyPrimary||a.readyOther-b.readyOther||a.conditionalPrimary-b.conditionalPrimary||a.conditionalOther-b.conditionalOther;
  for(let index=0;index<chosen.length;index++){
    const key=copyKey(chosen[index]);if(!key)continue;
    let best=chosen[index],bestQuality=quality(chosen);
    for(const candidate of candidates){if(candidate.id===best.id||copyKey(candidate)!==key||chosen.some((memory,i)=>i!==index&&memory.id===candidate.id))continue;
      const proposal=chosen.map((memory,i)=>i===index?candidate:memory),rank=quality(proposal);
      if(rank.present>=bestQuality.present&&better(rank,bestQuality)>0){best=candidate;bestQuality=rank;}}
    if(best!==chosen[index]){changes.push({fromMemoryId:chosen[index].id,toMemoryId:best.id,carriedSkillId:skillOf(best).id,
      exactCarryRecipePreserved:true,numericAbilityWeightApplied:false,reason:'같은 반입 스킬·강화·합류 시점·확인된 커스텀에서 원문 권장 HIF 효과를 가진 사본 비교'});chosen[index]=best;}
  }
  return{memories:chosen,changes};
}

/** Account-owned effects and crafting targets, without inventing combat values. */
export function buildHifAbilityGuidance({result={},inventory={},catalog={},options={}}={}){
  const plan=result.scoreSummary?.plan??options.plan,scenario=result.scoreSummary?.scenario??options.scenario??'hif';
  if(scenario!=='hif')return{status:'unsupported_scenario',selectedMemories:[],recommendations:[],ownedCandidates:[],craftingGoals:[]};
  const actualOptions={...options,plan,scenario,trainingType:result.scoreSummary?.trainingType??options.trainingType};
  const context=buildHifAbilityTargetContext({memories:result.memories,selectedIdol:result.selectedIdol,result,inventory,catalog,options:actualOptions});
  const source=sourceProfile(catalog,actualOptions,plan),selectedIds=new Set(list(result.memories).map(memory=>memory.id));
  const summarize=(memory,targetContext=context)=>({memoryId:memory.id??memory.memoryId,rawMemoryLookupId:memory.id??memory.memoryId,
    carriedSkillId:skillOf(memory)?.id??null,name:nameOf(skillOf(memory)),nameJa:skillOf(memory)?.nameJa??null,
    carrierPhase:skillOf(memory)?.phase??null,eligible:skillOf(memory)?.obtainable??null,
    carryRequiredProducerLevel:skillOf(memory)?.requiredProducerLevel??null,normalUnlockProducerLevel:skillOf(memory)?.normalUnlockProducerLevel??null,
    requiresSwitch:skillOf(memory)?.requiresSwitch??null,switchEligible:skillOf(memory)?.switchEligible??null,
    imageUrl:memory.skillCard?.thumbnailUrl??memory.skillImageUrl??null,initialStats:memory.modelEffects?.initialStats??null,
    growthRatePermil:memory.modelEffects?.growthRatePermil??null,
    hifEffects:list(memory.modelEffects?.hifEffects).map(effect=>({...assessHifEffect(effect,targetContext),
      canRequestCompare:skillOf(memory)?.obtainable===true&&effect.applies===true,requestOptions:{requiredHifEffectIds:[effect.effectId]},
      sourceRecommended:source.goals.some(goal=>list(goal.abilities).some(ability=>matchesAbility(effect,ability)))}))});
  const selectedMemories=list(result.memories).map(memory=>summarize(memory));
  const seenEffects=new Map();
  for(const memory of selectedMemories)for(const effect of memory.hifEffects){
    effect.duplicateOfMemoryId=effect.uniqueKey?seenEffects.get(effect.uniqueKey)??null:null;
    if(effect.uniqueKey&&!effect.duplicateOfMemoryId)seenEffects.set(effect.uniqueKey,memory.memoryId);
  }
  const normalizedOwned=list(inventory.memories).map(memory=>{
    if(memory.modelEffects)return memory;
    const raw={...(memory.raw??{}),...memory};
    return{...memory,modelEffects:summarizeMemoryEffects({...memory,raw},catalog,{...actualOptions,
      producerLevel:options.producerLevel??inventory.producerLevel,skillCardSwitchSettings:options.skillCardSwitchSettings??inventory.skillCardSwitchSettings})};
  });
  const owned=normalizedOwned.filter(memory=>list(memory.modelEffects?.hifEffects).length).map(memory=>{
    const key=copyKey(memory),same=list(result.memories).filter(selected=>key&&copyKey(selected)===key);
    const targetContext=buildHifAbilityTargetContext({memories:[...list(result.memories),memory],selectedIdol:result.selectedIdol,result,inventory,catalog,options:actualOptions});
    return{...summarize(memory,targetContext),selected:selectedIds.has(memory.id),sameRecipeAsSelectedMemoryIds:same.map(row=>row.id),
      canRequestCompare:skillOf(memory)?.obtainable===true,
      defaultSelectionReason:selectedIds.has(memory.id)?'현재 선택한 사본입니다.':skillOf(memory)?.obtainable!==true?'현재 메모리 반입 PLv·플랜·전환 조건이 미충족 또는 미확정입니다.':
        same.length?'같은 반입 조건의 사본에서 공략 효과·실제 대상 카드 조건과 초기 수치를 함께 비교합니다.':'현재 공략의 4장과 반입 스킬·강화·합류 시점·커스텀이 다른 별도 대안입니다. 필수 비교를 요청하면 기존 공략 역할과 바뀌는 조건을 함께 확인합니다.',
      targetAssessmentScope:'current_targets_plus_candidate_carried_skill_not_a_verified_five_slot_deck'};
  });
  const recommendations=source.goals.map(goal=>{
    const ownedMatches=owned.filter(memory=>memory.hifEffects.some(effect=>list(goal.abilities).some(ability=>matchesAbility(effect,ability))));
    const card=goal.triggerCard,available=context.targets.filter(target=>target.gameId===card?.gameId);
    const acquire=context.canAcquire(card?.gameId);
    const availability=available.find(target=>target.availability==='at_start')?.availability??available[0]?.availability??(acquire===true?'conditional_during':acquire===false?'missing':'unknown');
    return{goalId:goal.id,triggerCard:card,abilities:list(goal.abilities).map(ability=>({...ability,
      effectId:ability.effectId??list(catalog.memoryAbilities).find(row=>(row.id??row.gameId)===ability.abilityId&&row.level===ability.level)?.branches?.[0]?.produceEffectId??null})),
      targetAvailability:availability,selectedEffectMemoryIds:ownedMatches.filter(memory=>selectedIds.has(memory.memoryId)).map(memory=>memory.memoryId),
      ownedCandidateMemoryIds:ownedMatches.map(memory=>memory.memoryId),purpose:goal.recommendation?.purpose??goal.condition,
      conditions:[...list(goal.recommendation?.conditions),...(goal.condition?[goal.condition]:[])],sourceIds:goal.sourceIds??source.profile?.sourceIds??[],
      sourceTiming:goal.sourceTiming??null,recommendation:goal.recommendation??null,sourceNotes:goal.notes??[],
      craftingGoal:goal.memoryCrafting??{goal:'현재 공략 반입 스킬·강화·합류 시점·커스텀을 유지하면서 해당 HIF 어빌리티가 붙은 사본을 비교합니다.'}};
  });
  const suggested=recommendations.filter(goal=>goal.recommendation?.priority!=='low_priority');
  return{status:'conditional_native_trigger_guidance',selectedMemories,recommendations:suggested,
    sourceCautions:recommendations.filter(goal=>goal.recommendation?.priority==='low_priority'),
    ownedCandidates:owned,copyComparisons:result.scoreSummary?.hifModel?.hifAbilityCopyChanges??[],
    copyGroups:list(result.memories).map(memory=>{const key=copyKey(memory),copies=normalizedOwned.filter(row=>key&&copyKey(row)===key);
      return{selectedMemoryId:memory.id,carriedSkillId:skillOf(memory)?.id??null,exactRecipeComparable:Boolean(key),
        sameRecipeCopyCount:copies.length,sameRecipeHifCopyCount:copies.filter(row=>list(row.modelEffects?.hifEffects).length).length};}),
    craftingGoals:suggested.map(row=>({goalId:row.goalId,...row.craftingGoal,sourceIds:row.sourceIds})),
    selectedEffectCount:selectedMemories.reduce((sum,memory)=>sum+memory.hifEffects.length,0),
    evidenceScope:{profileId:source.profile?.id??null,scope:source.profile?.scope??null,conditions:source.profile?.conditions??[],
      sourceEventMonth:source.profile?.sourceEventMonth??null,currentRoundMethodReferenceSupported:source.profile?.currentRoundMethodReferenceSupported??false,
      currentRoundExactRecipeVerified:false,testedForAtmosphere:source.profile?.testedForAtmosphere??false,sourceCompleteLoopProducerLevel:source.profile?.sourceCompleteLoopProducerLevel??null,actualLoopValidated:false},
    reason:selectedMemories.every(memory=>!memory.hifEffects.length)?'현재 공략 반입 조건의 선택 사본에는 HIF 전용 효과가 없습니다. 다른 반입 스킬이나 미충족 커스텀으로 자동 교체하지 않고 아래 제작 목표와 보유 후보를 구분합니다.':
      'HIF 효과의 등록 시점과 실제 발동 대상 카드의 확보 시점을 따로 대조했습니다.',
    numericAbilityWeightApplied:false,activationConfirmed:false,
    limitations:['어빌리티는 반입 스킬 합류 시점과 별도로 시험 시작부터 등록됩니다. 실제 대상 카드 확보·사용·자원 조건은 별도입니다.',
      '도중 획득 후보는 실제 획득 카드가 아니므로 필수 효과의 발동 조건 충족으로 세지 않습니다.',
      '같은 고유 HIF 효과의 native uniqueKey는 중복 발동 보너스로 더하지 않습니다.',
      '공략 완성 루프·실전 통과·최종 점수를 확인한 결과가 아니며 어빌리티를 임의 스탯 점수로 환산하지 않습니다.'],sources:source.sources};
}
