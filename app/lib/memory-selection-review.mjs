import {getTrustedEventUnlockOverrides} from './event-context.mjs';

const list=value=>Array.isArray(value)?value:[];
const idOf=row=>row?.gameId??row?.id;
const typeOf=value=>({full_power:'fullPower',good_condition:'goodConditionTurns',goodCondition:'goodConditionTurns',good_impression:'goodImpressionTurns'})[value]??value;

/** Explain which conditions actually selected a carry copy without scoring combat. */
export function buildMemorySelectionReview({result={},catalog={},inventory={},options={}}={}){
  const scenario=result.scoreSummary?.scenario??options.scenario,plan=result.scoreSummary?.plan??options.plan;
  const trainingType=typeOf(result.scoreSummary?.trainingType??options.trainingType??options.type);
  const level=options.producerLevel??inventory.producerLevel??null;
  const profile=result.scoreSummary?.hifModel?.guideMemoryProfile;
  const selectionMode=result.scoreSummary?.hifModel?.memorySelectionMode??options.memorySelectionMode??'guide';
  const statsOnly=selectionMode==='stats';
  const prioritizeGuide=!statsOnly&&(profile?.considered===true||profile?.applied===true);
  const requestedSkills=new Set(options.desiredSkillIds??[]),requestedHif=new Set(options.requiredHifEffectIds??[]);
  const event=getTrustedEventUnlockOverrides(options,{catalog,plan,scenario});
  const switches=options.skillCardSwitchSettings??inventory.skillCardSwitchSettings;
  const slots=list(result.memories).map(memory=>{
    const memoryId=idOf(memory),effects=memory.effects??memory.modelEffects,skill=effects?.carriedSkill;
    const card=list(catalog.skillCards).find(row=>idOf(row)===skill?.id&&(row.upgradeCount??0)===(skill?.upgrade??skill?.upgradeCount??0));
    const matches=statsOnly?[]:list(profile?.roles).filter(role=>role.memoryId===memoryId);
    const requestedSkill=!statsOnly&&requestedSkills.has(skill?.id);
    const requestedEffect=!statsOnly&&list(effects?.hifEffects).some(effect=>requestedHif.has(effect.effectId)&&effect.applies===true);
    const preference=!statsOnly&&list(profile?.characterSelection?.selectedMatches).find(rule=>rule.memoryId===memoryId&&rule.action==='prefer');
    const hifCopy=!statsOnly&&list(result.scoreSummary?.hifModel?.hifAbilityCopyChanges).find(change=>change.toMemoryId===memoryId);
    const bonuses=Object.entries({vo:'보컬',da:'댄스',vi:'비주얼'}).flatMap(([axis,name])=>{
      const initial=effects?.initialStats?.[axis],growth=effects?.growthRatePermil?.[axis];
      return [...(initial>0?[`초기 ${name} +${initial}`]:[]),...(growth>0?[`${name} 성장 +${growth/10}%`]:[])];
    });
    const confirmedZero=Array.isArray(memory.raw?.abilities)&&effects?.abilityEffectsResolved===true&&
      ['vo','da','vi'].every(axis=>effects.initialStats?.[axis]===0&&effects.growthRatePermil?.[axis]===0);
    const basis=requestedSkill||requestedEffect?'requested':prioritizeGuide&&matches.some(role=>role.status==='fulfilled')?'guide_role':
      prioritizeGuide&&matches.some(role=>role.status==='unknown')?'tentative_guide_role':preference?'character_preference':hifCopy?'hif_copy':
      selectionMode==='opening'&&memory.battleRoleProfile?.availableAtStart===true?'opening_candidate':
      confirmedZero?'slot_fill':'stat_fill';
    const sourceAccess=list(result.personalizedPlan?.cardAccess).find(row=>row.gameId===skill?.id)?.normalAcquisition;
    const required=card?.unlockProducerLevel??null,requiresSwitch=card?.requiresSkillCardSwitch===true;
    const switchEligible=requiresSwitch?switches?.[skill?.id]===true?true:switches?.[skill?.id]===false?false:null:true;
    const nativeLevelEligible=required===0?true:required==null||level==null?null:level>=required;
    const levelEligible=event?.producerLevelUnlock&&!requiresSwitch?true:nativeLevelEligible;
    const eligibility=sourceAccess?sourceAccess.eligible??null:skill&&Object.hasOwn(skill,'generationObtainable')?skill.generationObtainable:
      (switchEligible===false||levelEligible===false?false:switchEligible===true&&levelEligible===true?true:null);
    const label={requested:requestedSkill?'지정한 반입 스킬':'지정한 HIF 효과',guide_role:'공략 역할 충족',tentative_guide_role:'공략 역할 · 조건 확인',character_preference:'아이돌 공략의 선호 스킬',hif_copy:'HIF 효과로 선택한 사본',opening_candidate:'개시 스킬 우선',slot_fill:'남은 반입 칸 보충',stat_fill:bonuses.length===1?bonuses[0]:'초기·성장 비교'}[basis];
    const reason=basis==='stat_fill'?(bonuses.length?'이 사본에서 확인한 보너스는 '+bonuses.join(' · ')+'입니다.':'반입 수치 일부가 미확인입니다. 보유 사본 상세에서 초기 가산과 성장 보너스를 확인하세요.'):
      basis==='slot_fill'?'초기 가산과 성장 보너스가 0인 사본으로 남은 반입 칸을 채웠습니다.':
      basis==='requested'?(requestedSkill?'직접 지정한 스킬이 들어 있는 사본입니다.':'지정한 HIF 효과가 있습니다. 발동에 필요한 카드를 시험 덱에 준비하세요.'):
      basis==='opening_candidate'?'육성 개시부터 이 스킬을 덱에 넣을 수 있습니다.':
      basis==='character_preference'?preference.reason:basis==='hif_copy'?hifCopy.reason:matches.map(role=>role.purpose).filter(Boolean).join(' · ');
    return{memoryId,skillId:skill?.id??null,basis,label,reason,roleMatches:matches.map(({gameId,purpose,status,reasons})=>({gameId,purpose,status,reasons})),
      atStart:skill?.phase?.availableAtStart??null,
      duringAcquisition:{eligible:eligibility,requiredProducerLevel:sourceAccess?.requiredProducerLevel??skill?.normalUnlockProducerLevel??required,
        producerLevelWaivedByEvent:sourceAccess?.producerLevelWaivedByEvent??Boolean(event?.producerLevelUnlock&&!requiresSwitch),
        acquired:false,guaranteed:false,firstExamAvailabilityGuaranteed:false,
        note:sourceAccess?.note??'도중 획득 해금 조건만 대조했습니다. 실제 선택지에 등장하고 획득한 것으로 계산하지 않습니다.'},
      battleOptimalityProven:false};
  });
  const counts=Object.fromEntries(['requested','guide_role','tentative_guide_role','character_preference','hif_copy','opening_candidate','slot_fill','stat_fill'].map(basis=>[basis,slots.filter(row=>row.basis===basis).length]));
  const knowledge=catalog.memoryCarryReview??{};
  const cardNotes=list(knowledge.cards).filter(card=>(!card.plan||card.plan==='free'||card.plan===plan)&&(!list(card.trainingTypes).length||card.trainingTypes.map(typeOf).includes(trainingType))).map(card=>({...card,
    selected:slots.some(slot=>slot.skillId===card.gameId),imageUrl:list(catalog.skillCards).find(row=>idOf(row)===card.gameId&&(row.upgradeCount??0)===0)?.thumbnailUrl??null}));
  const preparation=result.scoreSummary?.hifModel?.memoryPreparation;
  const memories=list(result.memories),roleProfilesKnown=memories.length>0&&memories.every(memory=>Array.isArray(memory.battleRoleProfile?.roles));
  const opening=memories.filter(memory=>memory.battleRoleProfile?.availableAtStart===true);
  const labels={attack:'공격',draw:'드로우',extra_action:'추가 행동'};
  const missing=preparation?list(preparation.missingRoles):roleProfilesKnown?Object.keys(labels).filter(role=>!opening.some(memory=>memory.battleRoleProfile.roles.includes(role))):[];
  const firstExam={status:preparation||roleProfilesKnown?'qualitative_carry_roles':'unknown',openingMemoryCount:preparation?list(preparation.openingMemoryIds).length:roleProfilesKnown?opening.length:null,
    missingCarryRoles:preparation||roleProfilesKnown?missing:null,readinessConfirmed:false,
    note:missing.length?'첫 시험의 반입 메모리에서 '+missing.map(role=>labels[role]??role).join('·')+' 역할을 확인하지 못했습니다. 초기 덱·고유 카드·첫 시험 전 실제 획득으로 보완할지 확인해야 합니다.':null};
  const concentrationDecision=selectionMode==='guide'&&scenario==='hif'&&trainingType==='goodConditionTurns'?profile?.concentrationDecision??null:null;
  return{status:'conditional_selection_basis',selectionMode,concentrationDecision,slots,counts,cardNotes,firstExam,
    summary:[counts.stat_fill?`초기 가산·성장률을 비교한 사본 ${counts.stat_fill}장`:null,counts.slot_fill?`남은 칸을 채운 사본 ${counts.slot_fill}장`:null].filter(Boolean).join(' · ')||'사본별 선택 이유와 합류 시점을 확인하세요.',
    guideRolesForced:prioritizeGuide,allOwnedCombinationsExhausted:false,battleSimulationUsed:false,battleOptimalityProven:false,
    limitations:['후보 탐색 범위 안의 비교이며 실제 시험 점수의 최적 편성을 입증한 결과는 아닙니다.',
      '도중 획득은 해금 조건과 실제 등장·획득을 구분합니다. 개시 반입 카드는 첫 시험부터 쓸 수 있지만 도중 획득 시점은 확정하지 않습니다.'],
    sources:list(knowledge.sources).filter(source=>cardNotes.some(card=>list(card.sourceIds).includes(source.id)))};
}
