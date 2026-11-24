const list=value=>Array.isArray(value)?value:[];
const typeOf=value=>({full_power:'fullPower',good_condition:'goodConditionTurns',goodCondition:'goodConditionTurns',good_impression:'goodImpressionTurns',goodImpression:'goodImpressionTurns',enthusiasm:'strength'})[value]??value;
const idOf=value=>value?.gameId??value?.id;
const rank=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const compact=value=>String(value??'').replace(/\s/g,'');

export function idolRecipeContext({result={},catalog={},inventory={},options={}}={}){
  const supplied=result.selectedIdol??options.hifSelectedIdol;
  const idolGameId=idOf(supplied)??options.idolGameId??options.idolId;
  const selected={...list(catalog.idolCards).find(row=>idOf(row)===idolGameId),...supplied};
  const observed=list(inventory.idolCards).find(row=>idOf(row)===idolGameId);
  const owned=selected?.ownershipVerified?selected.owned??observed:observed;
  const knownStage=(fields,stages)=>{
    const value=fields.map(key=>owned?.[key]??owned?.raw?.[key]).find(value=>rank(value)!==null);
    const maximum=Math.max(0,...list(stages).map(stage=>rank(stage.rank)??0));
    return rank(value)!==null&&value<=maximum?value:null;
  };
  return{...options,idolGameId,scenario:result.scoreSummary?.scenario??options.scenario??'hif',
    plan:result.scoreSummary?.plan??selected?.plan??options.plan,
    trainingType:typeOf(result.scoreSummary?.trainingType??options.trainingType??options.type),
    producerLevel:options.producerLevel??inventory.producerLevel??null,
    specialTrainingRank:knownStage(['levelLimitRank','uncap','specialTrainingRank'],selected?.specialTrainingStages),
    potentialRank:knownStage(['potentialRank','awakeningRank','awakening'],selected?.awakeningStages),
    skillCardSwitchSettings:options.skillCardSwitchSettings??inventory.skillCardSwitchSettings??null,
    selectedRecipeId:options.selectedRecipeId??null,
    difficulty:result.scoreSummary?.difficulty??options.difficulty,
    eventModeId:options.eventModeId??result.eventContext?.modeId??null};
}

function requirementsStatus(requirements={},context){
  const checks=[];
  for(const [key,field] of [['minProducerLevel','producerLevel'],['minPotentialRank','potentialRank'],['minSpecialTrainingRank','specialTrainingRank']]){
    if(requirements[key]==null)continue;
    if(rank(requirements[key])===null){checks.push(null);continue;}
    const actual=rank(context[field]);checks.push(actual===null?null:actual>=requirements[key]);
  }
  if(requirements.maxProducerLevel!=null){
    const actual=rank(context.producerLevel),maximum=rank(requirements.maxProducerLevel);
    checks.push(actual===null||maximum===null?null:actual<=maximum);
  }
  if(requirements.selectedRecipeId!=null)checks.push(context.selectedRecipeId==null?null:context.selectedRecipeId===requirements.selectedRecipeId);
  for(const id of list(requirements.requiredSwitchGameIds))checks.push(context.skillCardSwitchSettings?.[id]===true?true:context.skillCardSwitchSettings?.[id]===false?false:null);
  if(requirements.requiresKnownCurrentVariant===true)checks.push(rank(context.specialTrainingRank)!==null&&rank(context.potentialRank)!==null?true:null);
  return checks.includes(false)?false:checks.includes(null)?null:true;
}

/** Apply only reviewed rules for the exact P-card and source context. These are
 * qualitative preferences; they never add invented skill or exam points. */
export function resolveIdolRecipePolicy({catalog={},baseProfile=null,context={}}={}){
  const data=catalog.idolRecipePolicies??{},idol=list(catalog.idolCards).find(row=>idOf(row)===context.idolGameId);
  const sources=new Map(list(data.sources).map(source=>[source.id,source]));
  const normalized={...context,trainingType:typeOf(context.trainingType)};
  const matched=[],observations=[],selectionRules=[],operatingNotes=[],duringTargets=[];
  let roles=[...list(baseProfile?.carryRoles)],optional=[...list(baseProfile?.optionalCarryRoles)],suppress=false,label=baseProfile?.labelKo;
  const validSources=ids=>list(ids).length>0&&list(ids).every(id=>sources.has(id));
  for(const policy of list(data.policies)){
    const identity=list(policy.idolIdentities).find(row=>row.gameId===context.idolGameId);
    if(!identity)continue;
    let reason=null;
    if(!idol||identity.characterId&&identity.characterId!==idol.characterId||identity.titleJa&&!compact(idol.nameJa).includes(compact(identity.titleJa)))reason='native_identity_mismatch';
    else if(identity.expectedUniqueIds&&Object.entries(identity.expectedUniqueIds).some(([key,value])=>idol.uniqueIds?.[key]!==value))reason='native_unique_identity_mismatch';
    else if(policy.evidenceStatus!=='source_verified'||!validSources(policy.sourceIds))reason='source_unverified';
    else if(policy.scenario!==context.scenario)reason='scenario_mismatch';
    else if(policy.plan!==context.plan||idol.plan!==context.plan)reason='plan_mismatch';
    else if(list(policy.trainingTypes).length&&!policy.trainingTypes.map(typeOf).includes(normalized.trainingType))reason='training_type_mismatch';
    else{
      const eventPresent=Boolean(context.eventModeId||context.hifMode&&context.hifMode!=='normal');
      if(policy.eventScope==='ordinary_hif'&&eventPresent)reason='event_scope_mismatch';
      else if(policy.eventScope==='ordinary_produce'&&eventPresent)reason='event_scope_mismatch';
      else if(policy.eventScope==='exact_event'&&!list(policy.eventModeIds).includes(context.eventModeId))reason='event_scope_mismatch';
      else if(!['ordinary_hif','ordinary_produce','any_hif','exact_event'].includes(policy.eventScope))reason='event_scope_unverified';
      else if(policy.difficulty&&policy.difficulty!==context.difficulty)reason=context.difficulty==null?'difficulty_unconfirmed':'difficulty_mismatch';
    }
    const eligible=reason?false:requirementsStatus(policy.requirements,normalized);
    if(!reason&&eligible!==true)reason=eligible===null?'requirements_unconfirmed':'requirements_not_met';
    observations.push({id:policy.id,applied:!reason,reason,sourceIds:list(policy.sourceIds),requirements:policy.requirements??null});
    if(reason)continue;
    matched.push(policy);if(policy.labelKo)label=policy.labelKo;
    if(policy.roleChanges?.suppressGenericRoles===true){suppress=true;optional=[];roles=[];}
    const lower=new Set(list(policy.roleChanges?.deprioritizeSkillIds));
    optional.push(...roles.filter(role=>lower.has(role.gameId)));roles=roles.filter(role=>!lower.has(role.gameId));
    for(const role of list(policy.roleChanges?.addRoles)){
      const card=list(catalog.skillCards).find(card=>idOf(card)===role.gameId&&(card.upgradeCount??0)===0);
      if(card&&[context.plan,'free'].includes(card.plan)&&!roles.some(row=>row.gameId===role.gameId))roles.push({...role,sourceIds:list(policy.sourceIds)});
    }
    for(const rule of list(policy.selectionRules)){
      const card=list(catalog.skillCards).find(card=>idOf(card)===rule.gameId&&(card.upgradeCount??0)===0);
      const ruleSources=rule.sourceIds??policy.sourceIds;
      const condition=requirementsStatus(rule.requirements,normalized);
      const verified=Boolean(card)&&[context.plan,'free'].includes(card.plan)&&['prefer','deprioritize','avoid'].includes(rule.action)&&validSources(ruleSources);
      selectionRules.push({...rule,applies:verified?condition:false,sourceIds:list(ruleSources),policyId:policy.id});
    }
    operatingNotes.push(...list(policy.operatingNotes));
    duringTargets.push(...list(policy.duringTargets).map(target=>({...target,policyId:policy.id,sourceIds:list(target.sourceIds??policy.sourceIds),
      applies:requirementsStatus(target.requirements,normalized),acquired:false,acquisitionGuaranteed:false})));
  }
  const applied=matched.length>0,sourceIds=[...new Set(matched.flatMap(policy=>list(policy.sourceIds)))];
  const evidence={id:applied?matched.map(policy=>policy.id).join('+'):null,applied,usedForSelection:applied&&
    (suppress||roles.length!==list(baseProfile?.carryRoles).length||selectionRules.some(rule=>rule.applies===true)),
    matchedPolicyIds:matched.map(policy=>policy.id),sourceIds,selectedIdolGameId:context.idolGameId??null,baseProfileId:baseProfile?.id??null,
    summary:matched.map(policy=>policy.summary).filter(Boolean).join(' '),operatingNotes:[...new Set(operatingNotes)],duringTargets,observations,
    genericCarryRolesSuppressed:suppress,suppressedGenericCarryRoleIds:suppress?list(baseProfile?.carryRoles).map(role=>role.gameId).filter(id=>!roles.some(role=>role.gameId===id)):[],
    sourceRecipes:matched.flatMap(policy=>policy.sourceRecipe?[{...policy.sourceRecipe,id:policy.id,label:policy.labelKo,sourceIds:list(policy.sourceIds)}]:[]),
    context:Object.fromEntries(['idolGameId','scenario','plan','trainingType','producerLevel','specialTrainingRank','potentialRank','eventModeId','difficulty'].map(key=>[key,normalized[key]??null])),
    exactReplacementRecipeConfirmed:applied&&!suppress&&matched.some(policy=>policy.replacementRecipeConfirmed===true),
    limitations:['이 P카드에 확인한 원문 조건만 적용합니다. 같은 캐릭터의 다른 P카드에 일반화하지 않습니다.',
      '정성적 우선·회피 조건이며 고유 화력·P아이템 효과를 시험 점수로 환산한 결과는 아닙니다.']};
  if(!applied)return{profile:baseProfile,selectionRules:[],evidence};
  const original=baseProfile??{id:'character-source-'+evidence.id,plan:context.plan,trainingType:normalized.trainingType,status:'conditional_guide_profile',carryRoles:[],sourceIds:[]};
  const profile={...original,labelKo:label??original.labelKo,carryRoles:roles,
    alternatives:suppress?[]:list(original.alternatives),
    optionalCarryRoles:[...new Map(optional.map(role=>[role.gameId,role])).values()],
    originalCarryRoleGameIds:list(baseProfile?.carryRoles).map(role=>role.gameId),
    sourceIds:[...new Set([...list(original.sourceIds),...sourceIds])],
    conditions:[...(suppress?[]:list(original.conditions)),...matched.flatMap(policy=>list(policy.conditions))],
    characterPolicy:evidence,characterSelectionRules:selectionRules};
  return{profile,selectionRules,evidence};
}
