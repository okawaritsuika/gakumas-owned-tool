import { buildPersonalizedPlan } from './personalized-plan.mjs';
import { getTrustedEventUnlockOverrides, getEventAdditionalAppearance, getEventAdditionalAppearanceCandidates } from './event-context.mjs';

const list = value => Array.isArray(value) ? value : [];
const idOf = row => row?.gameId ?? row?.id;
const nameOf = row => String(row?.nameKo || row?.name || row?.nameJa || '이름 미확인').trim();
const integer = value => value != null && value !== '' && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const unique = values => [...new Set(values.filter(Boolean))];
const axisNames = { vocal: '보컬', dance: '댄스', visual: '비주얼', vo: '보컬', da: '댄스', vi: '비주얼' };
const activityNames = { consult: '상담', supply_gift: '사시이레 · 차입(差し入れ)', activity_supply: '활동 지급(活動支給)',
  outing: '외출', special_training: '특별지도', rest: '휴식', final_exam: '시험', mid_exam: '시험', interval: '인터벌',
  legend_mid_exam: '중간 시험', legend_final_exam: '최종 시험', hajime_mid_exam: '중간 시험', hajime_final_exam: '최종 시험',
  lesson: '레슨', sp_lesson: 'SP 레슨', class: '수업', intensive_lesson: '막판 스퍼트 레슨',
  self_lesson: '자율 레슨 · Vo / Da / Vi', business: '영업', audition_first: '1차 오디션', audition_second: '2차 오디션', audition_final: '최종 오디션' };
const normalizeType = value => ({ full_power: 'fullPower', good_condition: 'goodConditionTurns', goodCondition: 'goodConditionTurns',
  good_impression: 'goodImpressionTurns', goodImpression: 'goodImpressionTurns', enthusiasm: 'strength' })[value] ?? value;
const weekApplies = (conditions, stage, week) => {
  const selection = list(conditions?.selectionWeeks), final = list(conditions?.finalWeeks);
  return !selection.length && !final.length || (stage === 'final' ? final : selection).includes(week);
};

function activityLabel(activity) {
  const lesson = /^(vo|da|vi)_lesson_(vo|da|vi)$/.exec(activity ?? '');
  if (lesson) return `${axisNames[lesson[1]]} 레슨 · 부속성 ${axisNames[lesson[2]]}`;
  const legendLesson = /^(vo|da|vi)_legend_lesson$/.exec(activity ?? '');
  if (legendLesson) return `${axisNames[legendLesson[1]]} 레전드 레슨`;
  const lessonClass = /^class_(vo|da|vi)$/.exec(activity ?? '');
  return lessonClass ? `${axisNames[lessonClass[1]]} 수업` : activityNames[activity] ?? '행동 확인';
}

function referenceSchedule({ scenario, difficulty, schedule, hajimeSchedule, niaSchedule, eventModeId, proMenu, proRoute }) {
  let rows = [], name, sourceUrl, choicesNote;
  if (scenario === 'hajime' && difficulty === 'legend') {
    name = '初 레전드';
    sourceUrl = 'https://wikiwiki.jp/gakumas/%E5%88%9DLEGEND';
    rows = schedule.map(row => ({ week: row.week, activities: [
      ...list(row.activities).map(activity => ({ mid_exam: 'legend_mid_exam', final_exam: 'legend_final_exam' })[activity] ?? activity.replace(/^(vo|da|vi)_lesson$/, '$1_legend_lesson')),
      ...(row.can_rest ? ['rest'] : []),
    ] }));
  } else if (scenario === 'hajime' && ['pro', 'master'].includes(difficulty)) {
    name = `初 ${difficulty === 'pro' ? '프로' : '마스터'}`;
    sourceUrl = hajimeSchedule?.sources?.[difficulty];
    rows = list(hajimeSchedule?.[difficulty]).map((activities, index) => ({ week: index + 1, activities }));
    choicesNote = '주차별 주요 행동과 가능한 후보를 표시합니다. 외출·상담·활동 지급은 해당 회차의 메뉴를, 휴식은 남은 체력을 확인하세요.';
    if (difficulty === 'pro' && !eventModeId) {
      if (proMenu?.weeks?.length) {
        sourceUrl = proMenu.sourceUrl;
        rows = proMenu.weeks.map(({ week, activities }) => ({ week,
          activities: unique([...activities, ...(hajimeSchedule?.pro?.[week - 1]?.includes('rest') ? ['rest'] : [])]) }));
        choicesNote = '선택한 아이돌의 주차별 메뉴입니다. 휴식은 체력이 줄어 있을 때 고를 수 있습니다.';
      }
      if (proRoute?.selections?.length) choicesNote += ' 굵게 표시한 비교 경로는 추천 계산에서 가정한 행동입니다.';
    }
  } else if (scenario === 'nia' && ['none', 'pro', 'master'].includes(difficulty)) {
    difficulty = difficulty === 'none' ? 'master' : difficulty;
    name = `N.I.A. ${difficulty === 'pro' ? '프로' : '마스터'}`;
    sourceUrl = niaSchedule?.sources?.[difficulty];
    rows = list(niaSchedule?.pro).filter((_, index) => difficulty !== 'master' || index + 1 !== niaSchedule.masterOmitsProWeek)
      .map((activities, index) => ({ week: index + 1, activities }));
  }
  const selections = new Map((scenario === 'hajime' && difficulty === 'pro' && !eventModeId ? list(proRoute?.selections) : [])
    .map(row => [row.week, row]));
  const weekPlan = rows.filter(row => row.activities.length).map(({ week, activities }) => {
    const planned = selections.get(week);
    const assumed = Boolean(planned?.activity && activities.includes(planned.activity === 'sp_lesson' ? 'lesson' : planned.activity));
    const activity = assumed ? planned.activity : activities[0];
    const axis = assumed ? planned.axis : null;
    const alternatives = activities.filter(option => option !== activity).map(option => ({
      activity: option, label: option === 'rest' && proMenu && scenario === 'hajime' && difficulty === 'pro' && !eventModeId
        ? '휴식 · 체력 감소 시' : activityLabel(option),
    }));
    return { week, displayWeek: week, stage: 'produce', label: `${week}주차`, activity,
      activityLabel: [axisNames[axis], activityLabel(activity)].filter(Boolean).join(' '),
      ...(assumed ? { assumed: true, axis } : {}), alternatives, source: 'reference_schedule' };
  });
  if (!weekPlan.length) return null;
  return { weekPlan, scheduleContext: { sourceScenario: scenario, sourceDifficulty: difficulty, selectedEventModeId: eventModeId ?? null,
    status: 'reference_schedule', label: `${name} 기본 일정`, sourceUrl,
    groups: [{ stage: 'produce', label: name, days: weekPlan.length, steps: weekPlan.length }],
    warning: [choicesNote, eventModeId && '일반 모드 기준입니다. 선택한 이벤트의 일정 변경 여부는 확인되지 않았어요.'].filter(Boolean).join(' ') || null } };
}

/** Convert the chosen modeled route and owned assets into conditional click choices. */
export function buildAccountPlaybook({ result, inventory = {}, catalog, options = {} }) {
  const personal = result.personalizedPlan ?? buildPersonalizedPlan({ result, inventory, catalog, options });
  const context = personal.context, level = context.producerLevel.value;
  const eventRules=getTrustedEventUnlockOverrides(options,{catalog,plan:context.plan,scenario:context.scenario});
  const policies = list(catalog.playbookPolicies?.policies).filter(policy => policy.scenario === context.scenario && policy.plan === context.plan &&
    normalizeType(policy.trainingType) === normalizeType(context.trainingType));
  const skillIndex = new Map(list(catalog.skillCards).map(card => [`${idOf(card)}:${card.upgradeCount ?? 0}`, card]));
  const switches = options.skillCardSwitchSettings ?? inventory.skillCardSwitchSettings;
  const ref = (gameId, upgradeCount = 0) => {
    const card = skillIndex.get(`${gameId}:${upgradeCount}`) ?? skillIndex.get(`${gameId}:0`);
    return { gameId, publicId: card?.internalId ?? null, name: nameOf(card), nameJa: card?.nameJa ?? null, plan: card?.plan ?? null,
      imageUrl: card?.thumbnailUrl ?? card?.imageUrl ?? null, upgradeCount };
  };
  const memories = ['atStart', 'afterMid', 'unknown'].flatMap(group => list(personal.memoryStages[group]).map(memory => ({
    ...ref(memory.gameId, memory.upgradeCount), memoryId: memory.memoryId, obtainable: memory.obtainable, customizes: memory.customizes,
    phase: group === 'atStart' ? 'start' : group === 'afterMid' ? context.scenario === 'hif' ? 'after_selection_1' : 'after_mid_exam' : 'unknown',
    phaseLabel: group === 'atStart' ? '시작부터 사용' : group === 'afterMid' ? context.scenario === 'hif' ? '선발시험 1 후 합류' : '중간 시험 후 합류' : '합류 시점 미확인',
    reason: group === 'atStart' ? '첫 시험에 사용할 반입 스킬입니다.' : group === 'afterMid' ? '첫 시험에는 넣지 않고 합류한 뒤 사용합니다.' : '획득 시점을 확인한 뒤 시험 덱에 넣습니다.' })));
  const selectedIds = new Set(memories.map(memory => memory.gameId));
  const take = new Map(), avoid = new Map(), locked = new Map(), unresolved = new Map(), optionalCards=[];
  const characterPolicy=personal.characterRecipePolicy??result.scoreSummary?.hifModel?.guideMemoryProfile?.characterPolicy;
  const suppressed=new Set(characterPolicy?.applied?list(characterPolicy.suppressedGenericCarryRoleIds):[]);
  const characterRules=list(result.scoreSummary?.hifModel?.guideMemoryProfile?.characterSelectionRules).filter(rule=>rule.applies===true);
  for (const memory of memories) if (memory.obtainable !== false && (!memory.plan || memory.plan==='free'||memory.plan===context.plan)) take.set('memory:' + memory.memoryId, { ...memory,
    source: 'selected_memory', availability: memory.obtainable === true ? 'selected' : 'unknown', ownershipKnown: true });
  for (const card of list(personal.uniqueCards)) take.set('unique:' + card.gameId, { ...card, source: 'owned_idol_unique',
    availability: card.variantVerified ? 'selected' : 'unknown', ownershipKnown: true, reason: '선택한 보유 P아이돌의 고유 카드입니다.' });

  function normalAccess(gameId, conditions = {}) {
    const card = skillIndex.get(`${gameId}:0`), native = catalog.memoryEffectDetails?.tables?.ProducerLevelUnlocks?.[gameId];
    const normalRequired=integer(native?.level??card?.unlockProducerLevel),sourceRequired=integer(conditions.minProducerLevel);
    const required = normalRequired == null ? sourceRequired : Math.max(sourceRequired ?? 0,normalRequired);
    const switchRequired = conditions.requiresSwitchUnlockAndSelection === true || native?.type === 'ProducerLevelUnlockType_ProduceCardConversion' || card?.requiresSkillCardSwitch === true;
    const switchEligible = switchRequired ? switches?.[gameId] === true ? true : switches?.[gameId] === false ? false : null : true;
    const normalPlanEligible = card && ['sense', 'logic', 'anomaly', 'free'].includes(card.plan) ? card.plan === 'free' || card.plan === context.plan : null;
    const eventAppearance=getEventAdditionalAppearance(options,{catalog,plan:context.plan,scenario:context.scenario,gameId});
    const planEligible=normalPlanEligible===true||eventAppearance?.planEligible===true?true:normalPlanEligible;
    const levelEligibleWithoutEvent = required != null && level != null && level < required ? false :
      normalRequired == null ? null : level == null ? required === 0 ? true : null : true;
    // A higher source minimum is an operating prerequisite, rather than the native unlock.
    const sourceMinimumLevelEligible=sourceRequired!=null&&(normalRequired==null||sourceRequired>normalRequired)?level==null?null:level>=sourceRequired:true;
    const producerLevelWaivedByEvent=Boolean(card)&&normalRequired!=null&&!switchRequired&&eventRules?.producerLevelUnlock===true;
    const levelEligible=producerLevelWaivedByEvent?sourceMinimumLevelEligible:levelEligibleWithoutEvent;
    return { known: Boolean(card), requiredProducerLevel: required,normalRequiredProducerLevel:normalRequired,sourceMinimumProducerLevel:sourceRequired,
      planEligible,normalPlanEligible,eventAdditionalAppearance:eventAppearance?.eventAdditionalAppearance===true,
      eventAppearance,eventAdditionalAppearanceSourceIds:eventAppearance?.sourceIds??[],
      levelEligible,levelEligibleWithoutEvent,sourceMinimumLevelEligible,producerLevelWaivedByEvent,
      eventUnlockSourceIds:producerLevelWaivedByEvent?eventRules.sourceIds:[],requiresSwitch: switchRequired, switchEligible,
      eligible: !card || planEligible == null ? null : !planEligible || levelEligible === false || switchEligible === false ? false : levelEligible == null || switchEligible == null ? null : true };
  }

  function addCard(card, reason, conditions = {}, sourceIds = []) {
    const personalTarget = list(personal.midgamePlan?.acquisitionTargets).find(target => target.gameId === card.gameId);
    const mergedConflicts = unique([...list(card.conflicts), ...list(personalTarget?.conflicts)]);
    const access = normalAccess(card.gameId, conditions), conflicts = list(conditions.avoidTogether).filter(gameId => selectedIds.has(gameId));
    const characterAvoid=characterRules.find(rule=>rule.gameId===card.gameId&&rule.action==='avoid');
    take.delete('target:' + card.gameId);
    const row = { ...ref(card.gameId), reason, conditions, access, guideAction:card.action, dayReason:card.dayReason,
      sourceIds:unique([...sourceIds,...list(access.eventAdditionalAppearanceSourceIds)]),
      eventAdditionalAppearance:access.eventAdditionalAppearance,eventUseConditions:list(access.eventAppearance?.useConditions),
      source: 'during_run_target', ownershipKnown: false,
      acquisitionGuaranteed: false, alreadySelectedMemory: selectedIds.has(card.gameId) };
    if (!access.known || access.planEligible == null) unresolved.set(card.gameId, { ...row, category: 'unknown',
      reason: '카드 원자료·플랜 대응을 확인하지 못해 확정 획득 목표로 두지 않습니다. 사용 불가로 확정한 결과는 아닙니다.' });
    else if (access.planEligible === false) return;
    else if (access.levelEligible === false || access.switchEligible === false) locked.set(card.gameId, { ...row, category: 'locked', scope: 'normal_acquisition',
      reason: access.levelEligible === false ? `도중 신규 획득은 PLv ${access.requiredProducerLevel} 조건입니다. 현재 PLv ${level}에서 확보한 것으로 계획하지 않습니다.` : '필요한 스킬 전환이 선택되지 않아 도중 획득 대상으로 고정하지 않습니다.' });
    else if (access.eligible == null) unresolved.set(card.gameId, { ...row, category:'unknown',
      reason:'PLv·스킬 전환 등 접근 조건이 미확정입니다. 실제로 사용할 수 있는지 확인한 뒤 도중 후보와 대조합니다.' });
    else if(characterAvoid)avoid.set(card.gameId+':character_conflict',{...row,category:'conflict',reason:characterAvoid.reason+' 사용 금지가 아닌 고유 상성의 주의 조건입니다.',sourceIds:unique([...row.sourceIds,...list(characterAvoid.sourceIds)])});
    else if (conflicts.length || mergedConflicts.length) avoid.set(card.gameId + ':conflict', { ...row, category: 'conflict',
      reason: mergedConflicts.length ? mergedConflicts.join(' ') : `선택한 ${conflicts.map(gameId => ref(gameId).name).join(', ')}와 보류 공간·운영 조건이 충돌합니다. 둘 다 고정 채용하지 않습니다.` });
    else if (card.action === 'avoid') avoid.set(card.gameId + ':low_priority', { ...row, category: 'low_priority' });
    else if (!selectedIds.has(card.gameId)) take.set('target:' + card.gameId, { ...row,
      availability: access.eligible === true ? 'eligible_target' : 'unknown',
      reason: access.eligible == null ? reason + ' 스위치·해금 등 미확정 조건을 먼저 확인합니다.' : reason });
  }
  for (const card of list(personal.midgamePlan?.acquisitionTargets)) {
    if(card.priority==='optional_character_role'){optionalCards.push({...ref(card.gameId),reason:card.purpose,availability:'optional_character_reference',sourceIds:list(card.sourceIds)});continue;}
    addCard(card,card.purpose??'현재 해금된 도중 확보 후보입니다.',{},list(card.sourceIds));
  }
  for (const card of getEventAdditionalAppearanceCandidates(options,{catalog,plan:context.plan,scenario:context.scenario}))
    addCard(card,card.effectRole??card.purpose??'선택 이벤트에서 추가 등장이 확인된 도중 획득 후보입니다. 실제 선택지와 사용 조건을 확인합니다.',{},card.sourceIds??[]);
  const specificTargets=new Set(list(personal.midgamePlan?.acquisitionTargets).filter(card=>card.priority==='character_during_target').map(card=>card.gameId));
  for (const policy of policies) for (const card of list(policy.cards)) {
    if(suppressed.has(card.gameId)&&!selectedIds.has(card.gameId)){
      optionalCards.push({...ref(card.gameId),reason:'유형 공통 공략의 참고 카드입니다. 이 P카드의 전용 필수 조합으로 확인하지 않았습니다.',availability:'optional_character_reference',sourceIds:list(card.sourceIds)});continue;
    }
    if(!specificTargets.has(card.gameId))addCard(card,card.reason,card.conditions,card.sourceIds);
  }
  for (const card of list(personal.cardAccess).filter(card => card.normalAcquisition?.levelEligible === false)) {
    if (!locked.has(card.gameId)) addCard(card, card.purpose, { minProducerLevel: card.normalAcquisition.requiredProducerLevel });
  }
  const otherPlan = new Map();
  for (const memory of list(inventory.memories)) {
    if (!['sense', 'logic', 'anomaly'].includes(context.plan)) break;
    const raw = memory.raw ?? memory, skill = raw.produceCard ?? memory.produceCard ?? memory.skill;
    const card = skillIndex.get(`${skill?.id}:${skill?.upgradeCount}`);
    if (!card || card.plan === context.plan || card.plan === 'free') continue;
    if (!otherPlan.has(card.gameId)) otherPlan.set(card.gameId, { ...ref(card.gameId, card.upgradeCount), category: 'wrong_plan', source: 'owned_memory',
      ownershipKnown: true, reason: '보유 메모리라도 이 스킬은 선택한 P아이돌과 플랜이 달라 사용할 수 없습니다. 높은 반입 스탯만으로 고르지 않습니다.' });
  }
  const takeCards = [...take.values()], avoidCards = [...avoid.values()];
  const drinks = policies.flatMap(policy => list(policy.drinks)).map(drink => {
    const required = integer(drink.conditions?.minProducerLevel),levelEligibleWithoutEvent = required == null || level == null ? null : level >= required;
    const producerLevelWaivedByEvent=required!=null&&eventRules?.producerLevelUnlock===true;
    const eligible=producerLevelWaivedByEvent?true:levelEligibleWithoutEvent;
    return { ...drink, name: nameOf(drink), ownershipKnown: false, available: eligible,
      levelEligibleWithoutEvent,producerLevelWaivedByEvent,eventUnlockSourceIds:producerLevelWaivedByEvent?eventRules.sourceIds:[],
      reason: eligible === false ? `해금 PLv ${required}가 필요하므로 현재 필수 준비물로 두지 않습니다.` : drink.reason,
      useWhen: list(drink.useWhen), avoidWhen: list(drink.avoidWhen) };
  });
  const difficulty = result.scoreSummary?.difficulty ?? 'none';
  const schedule = list(catalog.calculationModels?.['score/schedule']?.table?.[context.scenario]?.[difficulty]);
  const reference = referenceSchedule({ scenario: context.scenario, difficulty, schedule, hajimeSchedule: catalog.hajimeSchedule,
    niaSchedule: catalog.niaSchedule, eventModeId: options.eventModeId, proRoute: result.scoreSummary?.hajimePro,
    proMenu: catalog.hajimeProMenus?.byCharacter?.[result.selectedIdol?.characterId] });
  const selections = list(result.scoreSummary?.hifModel?.selections);
  const stageStart = stage => schedule.find(row => row.stage === stage)?.week ?? 1;
  const basicTargets = [...new Map(list(personal.initialDeck?.masterCards).map(card => [card.gameId, { ...card, assumption: '기본 덱 원자료이며 실제 현재 덱에 남아 있는지는 확인해야 합니다.' }])).values()];
  const activityRules = policies.flatMap(policy => list(policy.activityRules));
  const managementRules = policies.flatMap(policy => list(policy.cardManagement));
  const whenFor = (activity, stage, displayWeek) => activityRules.filter(rule => rule.activity === activity &&
    weekApplies(rule.conditions, stage, displayWeek));
  const weekPlan = selections.map(row => {
    const native = schedule.find(week => week.week === row.week), stage = native?.stage ?? 'selection', displayWeek = row.week - stageStart(stage) + 1;
    const eventPhase = context.scenario === 'hif' && stage === 'final' ?
      ({'ui.settings.hif_final_round1':'라운드 1','ui.settings.hif_final_interval':'인터벌','ui.settings.hif_final_round2':'라운드 2'}[native?.week_label] ??
        ({7:'라운드 1',8:'인터벌',9:'라운드 2'})[displayWeek] ?? null) : null;
    const displayDay = eventPhase ? 7 : displayWeek;
    const activity = row.activity, rules = whenFor(activity, stage, displayWeek);
    let reason = rules.map(rule => rule.reason).join(' ') || '능력치 비교에 사용한 계획 동선입니다. 이 행동이 최적인지까지 계산한 결과는 아닙니다.';
    if (row.main) reason = `${axisNames[row.main]}를 주로 올리고 ${axisNames[row.sub]}를 함께 올리는 레슨 경로입니다. 모형은 SP 성공을 가정하므로 실제 SP 발생을 확인합니다.`;
    if (activity?.startsWith('class_')) reason = `${activityLabel(activity)}으로 비교 경로의 능력치를 보완합니다. 함께 제시되는 스킬은 아래 가져갈 후보와 현재 해금 조건을 대조해 고릅니다.`;
    if (activity === 'supply_gift') reason += ' 카드·드링크 보충 목적이며 활동 지급과 동일한 P포인트 수입으로 계산하지 않습니다.';
    if (activity === 'activity_supply') reason += ' 실제 지급 내용과 소지 한도를 확인합니다. 차입(差し入れ)과 구분합니다.';
    const alternatives = list(native?.activities).filter(other => other !== activity).map(other => {
      const alternativesRules = whenFor(other, stage, displayWeek);
      return { activity: other, label: activityLabel(other), reason: alternativesRules.map(rule => rule.reason).join(' ') || '게임에 제시된 다른 선택입니다.',
        when: alternativesRules.flatMap(rule => list(rule.when)), conditions: alternativesRules.map(rule => rule.conditions), sourceIds: alternativesRules.flatMap(rule => list(rule.sourceIds)) };
    });
    const record = { week: row.week, displayWeek, displayDay, eventPhase, stage, label: eventPhase ? `본선 당일 · ${eventPhase}` : `${stage === 'final' ? '본선' : '선발'} ${displayDay}일차`, activity,
      activityLabel: activityLabel(activity), reason, alternatives,
      condition: rules.flatMap(rule => list(rule.when)).join(' · ') || '현재 체력·P포인트와 실제 제시된 보상을 확인한 뒤 선택합니다.',
      source: 'planned_model_route', optimizedActivityChoice: false, sourceIds: rules.flatMap(rule => list(rule.sourceIds)) };
    const joined = memories.filter(memory => memory.phase === 'start' || (context.scenario === 'hif' && (stage === 'final' || row.week > 7) && memory.phase === 'after_selection_1'));
    const venue = activity?.startsWith('class_') ? 'class' : activity;
    record.managementActions = managementRules.filter(rule => rule.venue === venue &&
      weekApplies(rule.conditions, stage, displayWeek)).flatMap(rule => {
      if (integer(rule.conditions?.minProducerLevel) != null && (level == null || level < rule.conditions.minProducerLevel)) return [];
      let targetRefs = rule.gameId ? [...joined, ...list(personal.uniqueCards)].filter(card => card.gameId === rule.gameId) :
        basicTargets.filter(card => !rule.conditions?.targetFilter?.nameIncludesJa || (card.nameJa ?? card.name).includes(rule.conditions.targetFilter.nameIncludesJa));
      if (rule.conditions?.onlyIfUpgradeCount != null) targetRefs = targetRefs.filter(card => card.upgradeCount === rule.conditions.onlyIfUpgradeCount);
      if (!targetRefs.length && rule.action === 'remove' && rule.gameId) targetRefs = [{ ...ref(rule.gameId), presence: 'unconfirmed',
        condition: '실제 덱에 이 카드가 있고 고유·공격의 필수 역할이 아닌지 먼저 확인합니다.' }];
      if (!targetRefs.length) return [];
      return [{ action: rule.action, venue: rule.venue, targetRefs, when: list(rule.when).join(' · '), reason: rule.reason,
        conditions: rule.conditions, priority: rule.priority, sourceIds: list(rule.sourceIds), evidenceKind: rule.evidenceKind }];
    });
    if (activity === 'consult') {
      const upgradeTargets = [...joined, ...list(personal.uniqueCards)].filter(card => card.upgradeCount === 0 && skillIndex.has(`${card.gameId}:1`));
      record.consultation = { preferredActions: [...record.managementActions,
        { action: 'remove', targetRefs: basicTargets, when: '실제 덱에 불필요한 기본 카드가 남아 있고 필요한 카드 수·발동 조건을 해치지 않을 때',
          reason: `${joined.map(nameOf).join(', ') || '현재 사용할 주력 카드'}를 더 잘 뽑기 위한 압축 후보입니다. 첫 시험의 공격 수단부터 확인합니다.` },
        ...(upgradeTargets.length ? [{ action: 'upgrade', targetRefs: upgradeTargets, when: '해당 카드가 이미 합류했고 강화 비용을 지불할 여유가 있을 때', reason: '실제로 반입한 미강화 카드 중 강화 단계가 확인된 대상을 검토합니다.' }] : []),
        { action: 'acquire', targetRefs: takeCards.filter(card => card.availability === 'eligible_target'), removesExistingCard: false,
          when: '상담 목록에 현재 해금된 가져갈 카드가 제시되고 교환에 필요한 P포인트가 있을 때',
          reason: 'P포인트로 새 카드를 획득합니다. 기존 기본 카드를 빼는 수업의 카드 변환과 다르며 제시되지 않은 카드를 확정 획득으로 세지 않습니다.' },
      ], fallback: '유효한 삭제·강화·교환 대상이 없거나 비용이 부족하면 드링크 교환·포인트 보존을 검토하고, 선택 가능한 다른 활동과 비교합니다.',
      pointsKnown: false, liveDeckKnown: false, costRules: catalog.playbookPolicies?.globalConsultationRules ?? null };
    }
    return record;
  });
  const scheduleGroups = unique(weekPlan.map(row=>row.stage)).map(stage=>{
    const rows=weekPlan.filter(row=>row.stage===stage);
    return {stage,label:stage==='final'?'본선':'선발',days:unique(rows.map(row=>row.displayDay)).length,steps:rows.length};
  });
  const scheduleMatches = weekPlan.length>0 && weekPlan.every(row=>schedule.some(native=>native.week===row.week&&native.stage===row.stage&&list(native.activities).includes(row.activity)));
  const scheduleContext = { sourceScenario:context.scenario,sourceDifficulty:result.scoreSummary?.difficulty??'none',selectedEventModeId:options.eventModeId??null,
    status:!weekPlan.length?'no_plan':!scheduleMatches?'schedule_mismatch':options.eventModeId?'base_schedule_event_override_unverified':'verified_base_schedule',
    label:scheduleGroups.map(group=>group.label+' '+group.days+'일').join(' · '),groups:scheduleGroups,
    source:'calculation_models.score/schedule',eventScheduleOverrideVerified:false,
    warning:!weekPlan.length?'선택 조건의 날짜별 계획이 없습니다.':!scheduleMatches?'현재 경로와 일정 원본이 맞는지 확인이 필요합니다.':options.eventModeId?'H.I.F. 기본 일정으로 계산한 동선입니다. 아사리에서 실제 제시되는 선택지와 대조해 주세요.':null };
  const selectedSourceIds = new Set([...policies.flatMap(policy => [...list(policy.cards), ...list(policy.drinks), ...list(policy.activityRules), ...list(policy.cardManagement)].flatMap(row => list(row.sourceIds))),
    ...list(catalog.playbookPolicies?.globalConsultationRules?.sourceIds)]);
  const missing = ['진행 중 체력·P포인트·드링크 소지는 수집되지 않아 보유 0으로 판정하지 않았습니다.',
    reference ? '주차별 행동은 일반 모드의 기본 선택지입니다.' : '주차별 행동은 기존 능력치 모형의 계획 경로이며 실제 선택지·비용까지 최적화한 일정은 아닙니다.'];
  if (!policies.length) missing.push(reference ? '이 시나리오·육성 유형은 실제 반입 시점과 기본 일정을 중심으로 표시합니다.' :
    '이 시나리오·육성 유형에 연결된 운영 정책이 없어 실제 반입 시점과 계획 경로를 중심으로 표시합니다.');
  if (level == null) missing.push('실제 PLv를 확인하기 전에는 높은 레벨의 카드·드링크를 확보 가능으로 확정하지 않습니다.');
  return { status: 'conditional_account_playbook',
    summary: `${context.idol?.name ?? '선택한 P아이돌'} · PLv ${level ?? '미확인'} · 시작 반입 ${memories.filter(memory => memory.phase === 'start').length}장, 이후 합류 ${memories.filter(memory => memory.phase !== 'start' && memory.phase !== 'unknown').length}장 기준의 운영 준비입니다.`,
    context, memories, weekPlan: reference?.weekPlan ?? weekPlan, scheduleContext: reference?.scheduleContext ?? scheduleContext, takeCards, avoidCards, optionalCards:[...new Map(optionalCards.map(card=>[card.gameId,card])).values()],lockedCards:[...locked.values()],unresolvedCards:[...unresolved.values()],drinks, missing,
    eventUnlockAccess:eventRules?{eventModeId:eventRules.eventModeId,producerLevelUnlock:eventRules.producerLevelUnlock,
      sourceIds:eventRules.sourceIds,accountProducerLevelChanged:false,guidePrerequisitesWaived:false,unconfirmedRentalInjected:false}:null,
    cardHandling: managementRules.filter(rule => rule.venue === 'any' && selectedIds.has(rule.gameId)).map(rule => ({ ...rule, targetRef: ref(rule.gameId) })),
    consultationScope: '실제 카드와 조건을 대조한 상담 행동 후보이며 비용·카드 선택 전수 최적화 결과가 아닙니다.',
    wrongPlanOwnedSkillCount: otherPlan.size, currentResources: { stamina: null, producePoints: null, drinks: null },
    sources: list(catalog.playbookPolicies?.sources).filter(source => selectedSourceIds.has(source.id)), policyIds: policies.map(policy => policy.id) };
}
