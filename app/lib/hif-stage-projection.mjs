import { resolveHifExamRewards, hifExamRewardGain, calculateHifSupport, evaluateHifDeck } from './hif-model.mjs';
import { withDeclaredProduceActions } from './produce-action-counts.mjs';
import { supportPeakAtExam } from './hif-support-actions.mjs';
const axes=['vocal','dance','visual'];
const short={vocal:'vo',dance:'da',visual:'vi'};
const zero=()=>({vocal:0,dance:0,visual:0});
const add=(...rows)=>Object.fromEntries(axes.map(axis=>[axis,rows.reduce((sum,row)=>sum+Number(row?.[axis]??row?.[short[axis]]??0),0)]));
const stageWeeks=[7,13,20,27,29];
const kindOf=activity=>({consult:'consult',activity_supply:'activity_supply_gift',supply_gift:'activity_supply_gift',outing:'outing',special_training:'special_training',final_exam:'exam_end',mid_exam:'exam_end',rest:'rest'})[activity];
export function projectHifStamina(result){const idol=result.selectedIdol,base=idol?.baseStats?.stamina,training=idol?.owned?.levelLimitRank??idol?.owned?.uncap,awakening=idol?.owned?.potentialRank??idol?.owned?.awakening;if(!Number.isFinite(base)||!Number.isInteger(training)||!Number.isInteger(awakening))return{status:'unknown',value:null,limitations:['보유 P아이돌의 기본 체력·특훈·재능개화를 모두 확인하지 못했습니다.']};let value=base;for(const stage of idol.specialTrainingStages??[])if(stage.rank<=training)value+=stage.staminaDeltaByExplicitEffectType??0;for(const stage of idol.awakeningStages??[])if(stage.rank<=awakening)value+=stage.staminaDeltaByExplicitEffectType??0;const supports=Array.isArray(result.supports)?result.supports:[...(result.supports?.owned??[]),...(result.supports?.rental?[result.supports.rental]:[])];for(const card of supports){const latest=new Map();for(const ability of card.levelAbilities??[])if(ability.level<=card.level&&(!latest.has(ability.order)||latest.get(ability.order).level<=ability.level))latest.set(ability.order,ability);for(const ability of latest.values())if(ability.kind==='max_hp'&&(!ability.plan||ability.plan==='free'||ability.plan===result.scoreSummary.plan)&&(!ability.scenarioEnum||/Unknown|HatsuboshiIdolFestival/.test(ability.scenarioEnum)))for(const effect of ability.effects??[])if(/MaxStaminaAddition$/.test(effect.type)&&Number.isFinite(effect.min)&&effect.min===effect.max)value+=effect.min;}return{status:'known_component_model',value,limitations:['시험 시작 체력은 확인된 기본·특훈·개화·서포트 최대 체력의 합까지 회복한 상태를 가정합니다.','미확정 계정·메모리·P아이템 체력 보정과 실제 육성 중 체력 소비는 별도로 검증하지 않았습니다.']};}
function countsFor(rows){const counts={initial_stat:1,initial_pp:1,parameter_bonus:1,max_hp:1,sp_lesson_rate:1,sp_lesson_rate_all:1,class_work_end:0,consult:0,outing:0,rest:0,activity_supply_gift:0,special_training:0,exam_end:0};const perAxis=Object.fromEntries(axes.map(axis=>[axis,{lesson_end:0,sp_lesson_end:0,normal_lesson_end:0}]));for(const row of rows){if(row.main){perAxis[row.main].lesson_end++;perAxis[row.main][row.isSpLesson === false ? 'normal_lesson_end' : 'sp_lesson_end']++;}else if(row.activity?.startsWith('class_'))counts.class_work_end++;else if(kindOf(row.activity))counts[kindOf(row.activity)]++;}for(const key of ['lesson_end','sp_lesson_end','normal_lesson_end'])counts[key]=axes.reduce((sum,axis)=>sum+perAxis[axis][key],0);return{counts,perAxis};}

/** Prefix the chosen growth route. Never give selection 1 the final route's stats. */
export function projectHifStageStats({result,inventory,catalog,examIndex,options={}}){
  const model=result.scoreSummary?.hifModel;
  if(!model||!Number.isInteger(examIndex)||examIndex<0||examIndex>4)return null;
  const schedule=catalog.calculationModels?.['score/schedule']?.table?.hif?.[result.scoreSummary.difficulty??'none']??[];
  const exams=schedule.filter(row=>row.activities?.some(activity=>['mid_exam','final_exam'].includes(activity)));
  const stop=exams[examIndex]?.week??stageWeeks[examIndex];
  const rows=(model.selections??[]).filter(row=>row.week<stop);
  const rewards=resolveHifExamRewards(catalog,options),previousExamRewards=rewards.slice(0,Math.min(examIndex,3));
  const grouped={selection:rows.filter(row=>schedule.find(week=>week.week===row.week)?.stage!=='final'),final:rows.filter(row=>schedule.find(week=>week.week===row.week)?.stage==='final')};
  const stageRoute=(stage,items)=>{const lessons=items.filter(row=>row.main).map(row=>row.gains),classRows=items.filter(row=>row.activity?.startsWith('class_')).map(row=>row.gains);const parameterBonusRows=[...lessons,...(stage==='selection'?previousExamRewards.map(reward=>reward.growthEligibleGains):[])];return{...countsFor(items),parameterBonusRows,gains:add(...parameterBonusRows,...(stage==='selection'?previousExamRewards.map(reward=>reward.postBonusGains):[])),classGains:add(...classRows)};};
  const stages=Object.fromEntries(Object.entries(grouped).map(([stage,items])=>[stage,stageRoute(stage,items)]));
  const peak=model.supportPeakScenario?supportPeakAtExam(model.supportActionPlan?.peakScenario,examIndex):null;
  const produceActions=(options.produceActions??model.produceActions)?.filter(action=>!Number.isFinite(action.week)||action.week<stop);
  const route=withDeclaredProduceActions({...countsFor(rows),selections:rows,examRewards:previousExamRewards,parameterBonusRows:[...stages.selection.parameterBonusRows,...stages.final.parameterBonusRows],gains:add(stages.selection.gains,stages.final.gains),classGains:add(stages.selection.classGains,stages.final.classGains),stages,
    ...(peak?{supportPeakScenario:peak}:{})},produceActions,catalog,{examIndex,examDeckSizes:options.examDeckSizes??peak?.examDeckSizes});
  const supports=Array.isArray(result.supports)?result.supports:[...(result.supports?.owned??[]),...(result.supports?.rental?[result.supports.rental]:[])];
  const includeSupportEvents=peak?Number.isFinite(peak.supportReceiptWeek)&&peak.supportReceiptWeek<stop:examIndex>=3;
  const blockedSkillNames=(result.memories??[]).filter(memory=>memory.skillCard?.noDeckDuplication&&(!peak||
    memory.modelEffects?.carriedSkill?.obtainable===true&&[1,2].includes(memory.modelEffects.carriedSkill.phase?.code)))
    .map(memory=>memory.skillCard.nameJa??memory.skillCard.name);
  const cards=supports.map(card=>{
    const latest=new Map();
    for(const ability of card.levelAbilities??[])if(ability.level<=card.level&&(!latest.has(ability.order)||latest.get(ability.order).level<=ability.level))latest.set(ability.order,ability);
    const known=options.supportItemAcquisitions?.[card.gameId]?.confirmed===true;
    // The final ranking can use all unlocked stories. A prefix also needs
    // an order: schedule one successive story per card per selection block.
    const timedCard=peak&&examIndex<2?{...card,events:(card.events??[]).slice(0,examIndex+1)}:card;
    return calculateHifSupport(!includeSupportEvents&&!known?{...timedCard,p_item:null}:timedCard,[...latest.values()],card.level,route,result.scoreSummary.plan,
      {...options,produceActions,supportReceiptPlan:model.produceActions??options.produceActions,catalog,examIndex,includeSupportEvents,blockedSkillNames,supportPeakScenario:Boolean(peak)});
  });
  const panels=inventory.hifBonuses?.status==='current_account'?inventory.hifBonuses:null;
  const growth=result.selectedIdol?.currentGrowthRatePermil??result.selectedIdol?.growthBreakdown?.knownTotal??{};
  const baseGrowth=add(growth,model.memoryGrowthRatePermil);
  const selectionCaps=Object.fromEntries(axes.map(axis=>[axis,options.selectionStatCaps?.[axis]??panels?.selection?.statCaps?.[short[axis]]??catalog.hifGrowthPanels?.baseCaps?.selection?.value??3000]));
  const evaluation=evaluateHifDeck(cards,{route,initialStats:model.initialStats,statCaps:examIndex<3?selectionCaps:model.statCaps,
    stageContexts:{selection:{statCaps:selectionCaps,outsideGrowthRatePermil:add(baseGrowth,panels?.selection?.growthRatePermil)},final:{statCaps:model.statCaps,outsideGrowthRatePermil:add(baseGrowth,panels?.final?.growthRatePermil),additionalInitialStats:examIndex>=3?add(panels?.finalOnly?.initialStats):zero()}}});
  const stage=examIndex<3?evaluation.stageResults.find(row=>row.stage==='selection'):evaluation.stageResults.find(row=>row.stage==='final');
  const reachedStages=examIndex<3?evaluation.stageResults.filter(row=>row.stage==='selection'):evaluation.stageResults;
  const ownReward=rewards[examIndex],nominal=ownReward?hifExamRewardGain(ownReward,stage.totalGrowthRatePermil):null;
  const after=nominal?Object.fromEntries(axes.map(axis=>[axis,Math.min(stage.cappedStats[axis]+nominal[axis],stage.statCaps[axis]??Infinity)])):null;
  return{week:stop,stats:stage.cappedStats,rawStats:stage.rawStats,discardedStats:add(...reachedStages.map(row=>row.wastedStats)),stageResults:reachedStages,
    previousExamCount:previousExamRewards.length,previousExamRewards,
    rewardAfterThisExam:ownReward?{...ownReward,nominalGainBeforeCap:nominal,statsAfterParameterReward:after,
      appliedGainAfterCap:Object.fromEntries(axes.map(axis=>[axis,after[axis]-stage.cappedStats[axis]])),
      discardedStatsFromReward:Object.fromEntries(axes.map(axis=>[axis,nominal[axis]-(after[axis]-stage.cappedStats[axis])])),
      excludesOtherExamEndEffects:true,basis:'conditional_pre_exam_stats_then_parameter_reward_only'}:null,
    route,supportItemValues:cards.map(card=>card.supportItemValue).filter(Boolean),source:'chosen_route_prefix',assumptions:['계획된 레슨은 모두 SP 성공으로 가정합니다.',...(peak?['선발 구간마다 각 서포트의 이벤트를 순서대로 한 개씩 배정하는 경로입니다. 첫 시험 전에는 첫 이벤트만 반영합니다. 실제 이벤트 주차는 달라질 수 있습니다.']:[examIndex<3?'시기 미확정인 무작위 서포트 이벤트 보상은 선발 시험 전 능력치에서 제외합니다.':'본선 전 레벨 조건을 충족한 서포트 이벤트가 발생한 가정입니다.','P아이템은 획득 시점·행동 직전 조건을 확인한 부분만 더합니다. 미확인 잠재 가치는 별도입니다.']),
      '입력한 시험 보상만 해당 basis로 적용하고, 미입력 시험은 최대 보상·균등/지정 배분의 조건부 참고값입니다. 현재 시험 보상은 다음 시험부터 반영됩니다.']};
}
