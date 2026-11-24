import { cardTargetDescriptor } from './hif-card-targets.mjs';

// Card changes replace the target. Only acquire/copy are new receipts.
const stories = {
  card_enhance:['upgrade','any'],select_enhance:['upgrade','any'],
  trouble_delete:['remove','trouble'],select_delete:['remove','any'],card_change:['change','starter'],
};

export function supportItemOperation(op,catalog,providerId) {
  // These three items and HIF's red ribbon use the identical native
  // produce_card_duplicate ... deck_all-select-01_01 reward operation.
  if(op.cardAction==='copy'&&['s_card-2-0027','s_card-2-0043','s_card-2-0075'].includes(providerId))
    return {...op,action:'copy',countsAsAcquisition:true};
  if(!op.cardName)return {...op,action:op.cardAction};
  const matches=(catalog?.skillCards??[]).filter(s=>s.nameJa===op.cardName&&s.upgradeCount===0);
  const target=matches.length===1?matches[0]:null;
  return {...op,action:op.cardAction,...(target?{gameId:target.gameId,card:cardTargetDescriptor(catalog,target.gameId,0),type:target.type,rarity:target.rarity}:{})};
}

export function compileSupportOperations(card,events,grantsSkill,skillId,route,options,itemByStage) {
  const peak=route.supportPeakScenario, operations=[];
  const descriptor=(id)=>id&&options.catalog?cardTargetDescriptor(options.catalog,id,0):null;
  const stamp=(sourceId,week,extra)=>({id:sourceId,sourceId,providerId:card.gameId,source:'support_story',week,stage:'selection',fromExamIndex:0,
    ...extra});
  for (const [i,event] of events.entries()) {
    const source=card.gameId+':story:'+i;
    if(event.effect_type==='skill_card'&&grantsSkill) operations.push(stamp(source,peak?.supportReceiptWeek,{
      action:'acquire',target:'any',quantity:1,card:descriptor(skillId),gameId:skillId,
      type:card.skill_card.type,rarity:card.skill_card.rarity,uniqueKey:card.skill_card.no_duplicate?card.skill_card.name:null}));
    const operation=stories[event.effect_type];
    if(operation)operations.push(stamp(source,peak?.managementStoryWeek,{
      action:operation[0],target:operation[1],quantity:1,fromExamIndex:2}));
  }
  for(const stage of ['selection','final']) for(const [i,op] of (itemByStage?.[stage]?.operations??[]).entries()) {
    if(!op.cardAction)continue;
    const source=card.gameId+':item:'+op.actionId+':'+i;
    operations.push(stamp(source,op.week,{...supportItemOperation(op,options.catalog,card.gameId),stage,quantity:op.quantity*op.count,
      sourceTriggerId:op.actionId,source:'support_item'}));
  }
  return operations;
}
