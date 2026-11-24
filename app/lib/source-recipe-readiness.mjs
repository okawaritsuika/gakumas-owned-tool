const list=value=>Array.isArray(value)?value:[];
const idOf=value=>value?.gameId??value?.id??null;
const integer=value=>value!==null&&value!==undefined&&value!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const copy=value=>structuredClone(value);
const phaseLabel=value=>value===1?'개시 합류':value===2?'선발1 후 합류':'현재 사본 합류 미확인';
const targetAvailabilityLabel=value=>({at_start:'개시부터 대상 존재',after_selection_1:'선발1 후 대상 합류',conditional_during:'육성 중 대상 확보 필요',missing:'현재 대상 미확보',inapplicable:'현재 적용 불가',unknown:'대상 합류·확보 미확인'})[value]??'대상 합류·확보 미확인';
const skillOf=memory=>memory?.modelEffects?.carriedSkill??memory?.effects?.carriedSkill??memory?.raw?.produceCard??memory?.produceCard??memory?.skillCard??{};
const memoryId=memory=>memory?.memoryId??memory?.id??memory?.gameId??null;

function cardRef(catalog,gameId,upgradeCount=null,fallback={}){
  const card=list(catalog.skillCards).find(row=>idOf(row)===gameId&&(upgradeCount==null||(row.upgradeCount??0)===upgradeCount))??{};
  return {gameId,upgradeCount,nameKo:card.nameKo??fallback.nameKo??null,nameJa:card.nameJa??fallback.nameJa??null,
    name:card.nameKo??fallback.nameKo??card.name??fallback.name??card.nameJa??fallback.nameJa??'이름 미확인',
    imageUrl:card.thumbnailUrl??card.imageUrl??fallback.skillImageUrl??fallback.imageUrl??null,
    characterIconUrls:copy(card.characterIconUrls??fallback.skillCharacterIconUrls??{})};
}

function selectedSupports(result){
  return Array.isArray(result.supports)?result.supports:[...list(result.supports?.owned),...(result.supports?.rental?[result.supports.rental]:[])];
}

/** A source-condition checklist only. It never certifies a full recipe, predicts
 * battle scores, or treats an unobserved item/drink as acquired. */
export function buildSourceRecipeReadiness({result={},catalog={},inventory={},options={}}={}){
  const profile=result.scoreSummary?.hifModel?.guideMemoryProfile;
  const sourceRecipes=list(profile?.characterPolicy?.sourceRecipes);
  if(!sourceRecipes.length)return null;
  const memories=list(result.memories),byMemory=new Map(memories.map(memory=>[memoryId(memory),memory]));
  const hasSelectedList=Array.isArray(result.memories),hasHifGuidance=Array.isArray(result.hifAbilityGuidance?.selectedMemories);
  const hifMemories=list(result.hifAbilityGuidance?.selectedMemories).filter(memory=>!hasSelectedList||byMemory.has(memoryId(memory)));
  const effects=hifMemories.flatMap(memory=>list(memory.hifEffects).map(effect=>({memory,effect})));
  const supports=selectedSupports(result),sourceIndex=new Map(list(catalog.idolRecipePolicies?.sources).map(source=>[source.id,source]));
  const recipes=sourceRecipes.map(source=>{
    const checks=[];
    const check=(id,status,label)=>checks.push({id,status,label});
    const sourcePhasesKnown=source.sourcePhasesKnown===true,sourceCustomizationsFullyKnown=source.sourceCustomizationsFullyKnown===true;
    if(!sourcePhasesKnown)check('source_phases','unknown','원문 사본의 합류 시점 미확인');
    if(!sourceCustomizationsFullyKnown)check('source_customizations','unknown','원문 사본의 전체 개조 사양 미확인');
    if(list(source.observedConditions).length)check('source_context','unknown','원문의 육성·지원 조건 직접 확인 필요');
    const carryRoles=list(profile.roles).map(role=>{
      const selected=byMemory.get(role.memoryId)??memories.find(memory=>idOf(skillOf(memory))===role.gameId);
      const skill=skillOf(selected),phase=integer(skill.phase?.code??selected?.raw?.produceCardPhaseType??selected?.produceCardPhaseType);
      const currentPhase=phase===1||phase===2?phase:null;
      const status=!selected?'missing':role.status==='fulfilled'?'matches_known_conditions':role.status==='missing'?'missing':'unknown';
      const card=cardRef(catalog,role.gameId,integer(skill.upgrade??skill.upgradeCount),role);
      check('carry:'+role.gameId,status==='matches_known_conditions'?'matched':status,
        card.name+(status==='missing'?' · 반입 조건 미충족':status==='unknown'?' · 반입 조건 미확정':' · 확인된 역할 조건 일치'));
      return {card,memoryId:selected?memoryId(selected):null,status,currentPhase,currentPhaseLabel:phaseLabel(currentPhase),
        sourcePhaseKnown:sourcePhasesKnown,sourcePhaseLabel:sourcePhasesKnown?'원문 역할의 합류 조건 참조':'원문 합류 시점 미확인',
        sourceCustomizationsFullyKnown,checks:copy(list(role.checks)),reasons:copy(list(role.reasons)),readinessConfirmed:false};
    });
    const hifRequirements=list(source.requiredHifEffects).map((required,index)=>{
      const matches=required.effectId?effects.filter(row=>row.effect.effectId===required.effectId):[];
      const present=matches.find(row=>row.effect.applies!==false&&row.effect.targetRequirementSatisfied===true);
      const representative=present??matches[0],effect=representative?.effect;
      const status=!required.effectId?'unknown_effect':!hasHifGuidance?'unknown_effect':!matches.length?'missing_ability':present?'target_present':
        effect?.applies===false?'inapplicable':effect?.targetAvailability==='missing'?'missing_target':effect?.targetAvailability==='conditional_during'?'conditional_target':'unknown_target';
      const target=cardRef(catalog,required.triggerCardId??null);
      const statusText={target_present:'대상 카드 존재 조건 확인 · 실제 발동 미확인',missing_ability:'선택한 4장에 해당 HIF 능력 없음',missing_target:'HIF 발동 대상 카드 미확보',conditional_target:'HIF 대상은 육성 중 확보해야 함',inapplicable:'현재 조건에서 적용 불가',unknown_effect:'선택 HIF 능력 정보 미확인',unknown_target:'HIF 대상 존재·합류 미확인'}[status];
      check('hif:'+index,['missing_ability','missing_target','inapplicable'].includes(status)?'missing':status==='target_present'?'matched':'unknown',target.name+' · '+statusText);
      return {effectId:required.effectId??null,abilityId:required.abilityId??null,level:required.level??null,
        summaryKo:required.summaryKo??null,target,status,statusText,effectSelected:matches.length>0,
        targetRequirementSatisfied:status==='target_present',targetAvailability:effect?.targetAvailability??null,
        targetAvailabilityLabel:targetAvailabilityLabel(effect?.targetAvailability),
        selectedCarriers:matches.map(({memory,effect})=>({memoryId:memoryId(memory),
          card:cardRef(catalog,memory.carriedSkillId??null,null,memory),targetRequirementSatisfied:effect.targetRequirementSatisfied===true})),
        activationConfirmed:false,carrierNameDoesNotProveAbility:true};
    });
    const supportRequirements=list(source.requiredSupports).map((required,index)=>{
      const ids=list(required.anyOfGameIds),minimumLevel=integer(required.minimumLevel),matches=supports.filter(row=>ids.includes(idOf(row)));
      const passing=matches.find(row=>minimumLevel===null||integer(row.level)!==null&&integer(row.level)>=minimumLevel);
      const unknownLevel=matches.some(row=>integer(row.level)===null);
      const status=!ids.length?'unknown':!matches.length?'missing':passing?'selected':unknownLevel?'level_unknown':'level_missing';
      const selectedRewards=matches.map(row=>list(catalog.supportCards).find(card=>idOf(card)===idOf(row))).filter(Boolean);
      const rewardKind=selectedRewards.length&&selectedRewards.every(card=>card.p_item&&!card.skill_card)?'p_item':
        selectedRewards.length&&selectedRewards.every(card=>card.skill_card&&!card.p_item)?'skill_card':'unknown';
      const acquisitionLabel=(rewardKind==='p_item'?'P아이템':rewardKind==='skill_card'?'지원 스킬':'서포트 보상')+' 실제 획득·발동 시점 미확인';
      const choices=ids.map(gameId=>{const card=list(catalog.supportCards).find(row=>idOf(row)===gameId)??{};
        return {gameId,nameKo:card.nameKo??null,nameJa:card.nameJa??null,name:card.nameKo??card.nameJa??card.name??'서포트 이름 미확인',imageUrl:card.thumbnailUrl??card.imageUrl??null};});
      check('support:'+index,['missing','level_missing'].includes(status)?'missing':status==='selected'?'matched':'unknown',
        choices.map(row=>row.name).join(' / ')+(status==='selected'?' · 편성에 있음':status==='level_missing'?' · 명시된 최소 레벨 미충족':status==='missing'?' · 현재 편성에 없음':' · 레벨·대상 미확인'));
      check('support_item:'+index,'unknown',acquisitionLabel);
      return {choices,status,minimumLevel,observedLevel:integer(required.observedLevel),observedLevelIsRequirement:false,
        selected:matches.map(row=>({gameId:idOf(row),level:integer(row.level),rental:row.rental===true||row.isRental===true})),
        rewardKind,acquisitionLabel,itemAcquisitionConfirmed:null,itemStatus:'unknown',activationConfirmed:false};
    });
    const drinkRequirements=list(source.drinkRequirements).map((required,index)=>{
      check('drink:'+index,'unknown',String(required.nameJa??'드링크')+' · 실제 보유·확보 미확인');
      return {nameJa:required.nameJa??null,perRound:integer(required.perRound),status:'unknown',acquired:null,quantityConfirmed:false};
    });
    const missingNotes=checks.filter(row=>row.status==='missing').map(row=>row.label),unknownNotes=checks.filter(row=>row.status==='unknown').map(row=>row.label);
    return {id:source.id??null,label:source.label??'해금 전 조건부 공략 후보',sourceIds:copy(list(source.sourceIds)),
      sources:list(source.sourceIds).map(id=>sourceIndex.get(id)).filter(Boolean).map(row=>({id:row.id,title:row.title??null,url:row.url??null})),
      observedConditions:copy(list(source.observedConditions)),sourcePhasesKnown,sourceCustomizationsFullyKnown,
      carryRoles,hifRequirements,supportRequirements,drinkRequirements,checks,missingNotes,unknownNotes,
      counts:{missing:missingNotes.length,unknown:unknownNotes.length,matched:checks.filter(row=>row.status==='matched').length},
      summary:missingNotes.length?`현재 부족 ${missingNotes.length} · 미확정 ${unknownNotes.length}`:`확인된 조건만 일치 · 미확정 ${unknownNotes.length}`,
      readinessConfirmed:false,battleSimulationUsed:false,activationConfirmed:false,claimsOptimal:false};
  });
  return {status:'conditional_source_recipe_checks',recipes,summary:'원문의 반입 후보와 현재 사본을 비교합니다. 실제 덱 완성·우승 확인은 아닙니다.',
    readinessConfirmed:false,battleSimulationUsed:false,battle:false,activationConfirmed:false,claimsOptimal:false,
    limitations:['현재 사본의 합류가 확인돼도 원문 사양이 미확인이면 일치로 확정하지 않습니다.','HIF 능력과 대상 카드가 있어도 실제 사용·발동을 확인한 것은 아닙니다.','서포트 편성은 P아이템 획득을 뜻하지 않습니다. 드링크·실제 육성 중 수급은 별도 확인합니다.']};
}
