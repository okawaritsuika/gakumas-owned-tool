import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountPlaybook } from '../lib/account-playbook.mjs';
import { buildEventUnlockOverrides } from '../lib/event-context.mjs';

function fixture() {
  const card = (gameId, name, plan = 'anomaly', unlockProducerLevel = 1, upgradeCount = 0) => ({ gameId, name, nameJa: name,
    plan, upgradeCount, internalId: gameId, unlockProducerLevel, rentalUnlockProducerLevel: unlockProducerLevel });
  const atStart = { memoryId: 'opening-memory', gameId: 'opening', name: '개시 주력+', nameJa: '開幕+', upgradeCount: 1, obtainable: true, customizes: [], phase: { availableAtStart: true } };
  const afterMid = { memoryId: 'later-memory', gameId: 'later', name: '중간 드로우', nameJa: '中間', upgradeCount: 0, obtainable: true, customizes: [], phase: { availableAtStart: false } };
  const result = { scoreSummary: { scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower', difficulty: 'none',
    hifModel: { selections: [{ week: 1, activity: 'consult' }, { week: 8, activity: 'supply_gift' }, { week: 12, activity: 'consult' }, { week: 23, activity: 'supply_gift' }] } },
    personalizedPlan: { context: { scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower', producerLevel: { value: 70, source: 'user_input' }, idol: { name: '보유 아이돌' } },
      memoryStages: { atStart: [atStart], afterMid: [afterMid], unknown: [] }, uniqueCards: [],
      initialDeck: { masterCards: [{ gameId: 'basic', name: '기본 카드', upgradeCount: 0 }] },
      midgamePlan: { acquisitionTargets: [] }, cardAccess: [{ gameId: 'future', normalAcquisition: { levelEligible: false, requiredProducerLevel: 80 } }] } };
  const catalog = { skillCards: [card('opening', '개시 주력'), card('opening', '개시 주력+', 'anomaly', 1, 1), card('later', '중간 드로우'),
    card('later', '중간 드로우+', 'anomaly', 1, 1), card('basic', '기본 카드'), card('target', '현재 획득 후보', 'anomaly', 40),
    card('future', '고레벨 반복 카드', 'anomaly', 80), card('conflict', '공간 충돌 카드'), card('logic-card', '다른 플랜 카드', 'logic')],
    playbookPolicies: { sources: [{ id: 'source', title: '검증 공략', url: 'https://example.test/guide' }], policies: [{ id: 'full-power', scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower',
      cards: [{ gameId: 'target', action: 'take', reason: '현재 도중 공격 후보', conditions: { minProducerLevel: 40 }, sourceIds: ['source'] },
        { gameId: 'future', action: 'take', reason: '고레벨 반복', conditions: { minProducerLevel: 80 }, sourceIds: ['source'] },
        { gameId: 'conflict', action: 'situational', reason: '보류 경쟁', conditions: { avoidTogether: ['opening'] }, sourceIds: ['source'] }],
      drinks: [{ id: '12', nameJa: '드링크', reason: '화력 보조', useWhen: ['공격을 몰아칠 때'], avoidWhen: ['체력이 부족할 때'], conditions: { minProducerLevel: 55 }, sourceIds: ['source'] }],
      activityRules: [{ activity: 'supply_gift', when: ['회복이 급하지 않을 때'], reason: '카드·드링크 보충', conditions: { selectionWeeks: [8], finalWeeks: [3] }, sourceIds: ['source'] },
        { activity: 'outing', when: ['다음 구간의 체력이 부족할 때'], reason: '회복', conditions: { selectionWeeks: [8] }, sourceIds: ['source'] }] }] },
    calculationModels: { 'score/schedule': { table: { hif: { none: [
      { week: 1, stage: 'selection', activities: ['consult', 'supply_gift'] }, { week: 8, stage: 'selection', activities: ['supply_gift', 'outing'] },
      { week: 12, stage: 'selection', activities: ['consult', 'special_training'] }, { week: 21, stage: 'final', activities: ['class_vo'] },
      { week: 23, stage: 'final', activities: ['supply_gift', 'outing'] },
    ] } } } } };
  const inventory = { memories: [{ id: 'owned-logic', produceCard: { id: 'logic-card', upgradeCount: 0 } }] };
  return { result, inventory, catalog, options: {} };
}

test('HIF final-day rounds and interval share calendar day seven while keeping all nine model steps',()=>{
  const input=fixture(),activities=['class_vo','vo_lesson_da','outing','class_da','da_lesson_vi','consult','final_exam','interval','final_exam'];
  const phases=['ui.settings.hif_final_round1','ui.settings.hif_final_interval','ui.settings.hif_final_round2'];
  input.catalog.calculationModels['score/schedule'].table.hif.none=activities.map((activity,index)=>({week:index+21,stage:'final',activities:[activity],...(index>=6?{week_label:phases[index-6]}:{})}));
  input.result.scoreSummary.hifModel.selections=activities.map((activity,index)=>({week:index+21,activity}));
  const before=structuredClone(input),book=buildAccountPlaybook(input);
  assert.deepEqual(book.weekPlan.map(row=>row.week),[21,22,23,24,25,26,27,28,29]);
  assert.deepEqual(book.weekPlan.map(row=>row.displayWeek),[1,2,3,4,5,6,7,8,9]);
  assert.deepEqual(book.weekPlan.map(row=>row.displayDay),[1,2,3,4,5,6,7,7,7]);
  assert.deepEqual(book.weekPlan.slice(6).map(row=>row.eventPhase),['라운드 1','인터벌','라운드 2']);
  assert.deepEqual(book.weekPlan.slice(6).map(row=>row.label),['본선 당일 · 라운드 1','본선 당일 · 인터벌','본선 당일 · 라운드 2']);
  assert.deepEqual(book.scheduleContext.groups,[{stage:'final',label:'본선',days:7,steps:9}]);
  assert.equal(book.scheduleContext.label,'본선 7일');
  assert.deepEqual(input,before);
});

test('day-route metadata keeps actual stage days and does not claim an event-specific schedule was verified',()=>{
  const input=fixture(),before=structuredClone(input),ordinary=buildAccountPlaybook(input);
  assert.equal(ordinary.scheduleContext.status,'verified_base_schedule');
  assert.deepEqual(ordinary.scheduleContext.groups,[{stage:'selection',label:'선발',days:3,steps:3},{stage:'final',label:'본선',days:1,steps:1}]);
  assert.deepEqual(ordinary.weekPlan.map(row=>row.week),[1,8,12,23]);
  assert.deepEqual(input,before);
  input.options.eventModeId='asari-test';const event=buildAccountPlaybook(input);
  assert.equal(event.scheduleContext.selectedEventModeId,'asari-test');
  assert.equal(event.scheduleContext.status,'base_schedule_event_override_unverified');
  assert.equal(event.scheduleContext.eventScheduleOverrideVerified,false);
  assert.ok(event.scheduleContext.warning.includes('아사리'));
  input.catalog.calculationModels['score/schedule'].table.hif.none[0].activities=['outing'];
  assert.equal(buildAccountPlaybook(input).scheduleContext.status,'schedule_mismatch');
});

test('turns account memories, current PLv and the planned route into conditional choices without inventing live resources', () => {
  const input = fixture(), before = structuredClone(input);
  const playbook = buildAccountPlaybook(input);
  assert.equal(playbook.memories[0].phase, 'start');
  assert.equal(playbook.memories[1].phase, 'after_selection_1');
  assert.ok(playbook.takeCards.some(card => card.gameId === 'target' && card.availability === 'eligible_target'));
  assert.ok(!playbook.takeCards.some(card => card.gameId === 'future'));
  assert.ok(playbook.lockedCards.some(card => card.gameId === 'future' && card.category === 'locked'));
  assert.ok(playbook.avoidCards.some(card => card.gameId === 'conflict' && card.category === 'conflict'));
  assert.ok(!playbook.takeCards.some(card => card.gameId === 'conflict'));
  assert.ok(!playbook.avoidCards.some(card => card.gameId === 'logic-card'));
  assert.equal(playbook.wrongPlanOwnedSkillCount,1);
  assert.ok(playbook.avoidCards.every(card=>['conflict','low_priority'].includes(card.category)));
  assert.deepEqual(playbook.currentResources, { stamina: null, producePoints: null, drinks: null });
  assert.equal(playbook.drinks[0].ownershipKnown, false);
  assert.equal(playbook.drinks[0].available, true);
  const supply = playbook.weekPlan.find(week => week.week === 8);
  assert.equal(supply.activityLabel, '사시이레 · 차입(差し入れ)');
  assert.ok(supply.reason.includes('P포인트 수입으로 계산하지 않습니다'));
  assert.ok(supply.alternatives.some(action => action.activity === 'outing' && action.when[0].includes('체력')));
  assert.equal(supply.optimizedActivityChoice, false);
  assert.equal(playbook.weekPlan.find(week => week.week === 23).displayWeek, 3);
  assert.equal(playbook.sources[0].id, 'source');
  assert.deepEqual(input, before);
});

test('ordinary-mode advice omits unusable plans and separates locked or unknown cards from actual deck cautions',()=>{
  const input=fixture(),policy=input.catalog.playbookPolicies.policies[0];
  policy.cards.push({gameId:'logic-card',action:'avoid',reason:'다른 플랜은 주의 목록 대상이 아님',conditions:{avoidTogether:['opening']}});
  policy.cards.push({gameId:'not-in-master',action:'take',reason:'원자료 미확인'});
  input.catalog.skillCards.push({...input.catalog.skillCards.find(card=>card.gameId==='target'),gameId:'switch-unknown',requiresSkillCardSwitch:true});
  policy.cards.push({gameId:'switch-unknown',action:'avoid',reason:'전환 상태를 읽지 못한 카드'});
  policy.cards.find(card=>card.gameId==='target').action='avoid';
  const before=structuredClone(input),book=buildAccountPlaybook(input);
  assert.ok(book.avoidCards.some(card=>card.gameId==='conflict'&&card.category==='conflict'));
  assert.ok(book.avoidCards.some(card=>card.gameId==='target'&&card.category==='low_priority'));
  assert.ok(book.avoidCards.every(card=>card.plan==='anomaly'||card.plan==='free'));
  assert.ok(![...book.takeCards,...book.avoidCards,...book.lockedCards,...book.unresolvedCards].some(card=>card.gameId==='logic-card'));
  assert.ok(book.lockedCards.some(card=>card.gameId==='future'));
  assert.ok(book.unresolvedCards.some(card=>card.gameId==='not-in-master'&&card.category==='unknown'));
  assert.ok(book.unresolvedCards.some(card=>card.gameId==='switch-unknown'&&card.access.switchEligible===null));
  assert.ok(!book.avoidCards.some(card=>['future','not-in-master'].includes(card.gameId)));
  assert.equal(book.wrongPlanOwnedSkillCount,1);assert.deepEqual(input,before);
});

test('missing native normal unlock stays unknown while explicit zero is known even without a PLv input',()=>{
  const input=fixture(),target=input.catalog.skillCards.find(card=>card.gameId==='target');
  target.unlockProducerLevel=null;
  input.catalog.memoryEffectDetails={tables:{ProducerLevelUnlocks:{target:{level:null}}}};
  const policy=input.catalog.playbookPolicies.policies[0].cards.find(card=>card.gameId==='target');
  policy.conditions={};
  let book=buildAccountPlaybook(input),row=book.unresolvedCards.find(card=>card.gameId==='target');
  assert.equal(row.access.requiredProducerLevel,null);
  assert.equal(row.access.levelEligible,null);assert.equal(row.access.eligible,null);
  policy.conditions.minProducerLevel=40;
  book=buildAccountPlaybook(input);row=book.unresolvedCards.find(card=>card.gameId==='target');
  assert.equal(row.access.requiredProducerLevel,40);assert.equal(row.access.levelEligible,null);
  policy.conditions.minProducerLevel=80;
  assert.ok(buildAccountPlaybook(input).lockedCards.some(card=>card.gameId==='target'));
  policy.conditions={};target.unlockProducerLevel=0;
  input.result.personalizedPlan.context.producerLevel.value=null;
  row=buildAccountPlaybook(input).takeCards.find(card=>card.gameId==='target');
  assert.equal(row.access.requiredProducerLevel,0);assert.equal(row.access.levelEligible,true);
  assert.equal(row.access.eligible,true);
});

test('verified event additions allow only exact during-run cross-plan targets while carried memories keep their own plan',()=>{
  const input=fixture(),logic=input.catalog.skillCards.find(card=>card.gameId==='logic-card');
  input.catalog.skillCards.push({...logic,gameId:'unlisted-logic',nameJa:'검증 목록 밖 카드'});
  input.catalog.playbookPolicies.policies[0].cards.push({gameId:'unlisted-logic',action:'take',reason:'검증되지 않은 다른 플랜'});
  input.catalog.eventModes={modes:[{id:'test-event',supportedPlans:['anomaly'],supportedScenarios:['hif'],rules:{plvAppearanceWaived:true},sourceIds:['official-event'],
    additionalAppearance:{usedForDuringProduceEligibility:true,eligibilitySkillIds:['logic-card'],reportedSkills:[{
      gameId:'logic-card',nameJa:logic.nameJa,normalUsePlan:'logic',sourceIds:['verified-extra-pool'],
      effectRole:'추가 등장한 드로우 보조',useConditions:['실제로 선택지에 제시된 뒤 사용'],evidenceStatus:'native_identity_verified'}]}}]};
  input.options.eventModeId='test-event';
  input.options.eventUnlockOverrides=buildEventUnlockOverrides({catalog:input.catalog,options:input.options,context:{plan:'anomaly',scenario:'hif',trainingType:'fullPower'}});
  const book=buildAccountPlaybook(input),target=book.takeCards.find(card=>card.gameId==='logic-card');
  assert.ok(target);assert.equal(target.source,'during_run_target');assert.equal(target.eventAdditionalAppearance,true);
  assert.equal(target.access.normalPlanEligible,false);assert.equal(target.access.planEligible,true);
  assert.equal(target.ownershipKnown,false);assert.equal(target.acquisitionGuaranteed,false);
  assert.deepEqual(target.sourceIds,['verified-extra-pool']);assert.ok(target.eventUseConditions.length);
  assert.ok(!book.takeCards.some(card=>card.gameId==='unlisted-logic'));
  assert.ok(!book.memories.some(card=>card.gameId==='logic-card'));assert.equal(book.wrongPlanOwnedSkillCount,1);
  assert.ok(!book.avoidCards.some(card=>card.category==='wrong_plan'));
  const forged=buildAccountPlaybook({...input,options:{...input.options,eventUnlockOverrides:{...input.options.eventUnlockOverrides}}});
  assert.ok(!forged.takeCards.some(card=>card.gameId==='logic-card'));
  logic.requiresSkillCardSwitch=true;logic.unlockProducerLevel=80;
  const locked=buildAccountPlaybook(input);
  assert.ok(locked.lockedCards.some(card=>card.gameId==='logic-card'&&card.access.eventAdditionalAppearance));
  assert.ok(!locked.takeCards.some(card=>card.gameId==='logic-card'));
});

test('event card and drink unlock exceptions preserve source operating minima, switch locks and actual assets',()=>{
  const input=fixture(),policy=input.catalog.playbookPolicies.policies[0];
  input.catalog.eventModes={modes:[{id:'test-event',supportedPlans:['anomaly'],supportedScenarios:['hif'],rules:{plvAppearanceWaived:true,plvRentalWaived:true},sourceIds:['official-event']}]};
  policy.drinks[0].conditions.minProducerLevel=75;
  input.options.eventModeId='test-event';
  input.options.eventUnlockOverrides=buildEventUnlockOverrides({catalog:input.catalog,options:input.options,context:{plan:'anomaly',scenario:'hif',trainingType:'fullPower'}});
  const book=buildAccountPlaybook(input);
  assert.equal(book.context.producerLevel.value,70);
  assert.ok(book.takeCards.some(card=>card.gameId==='future'&&card.access.producerLevelWaivedByEvent));
  assert.equal(book.drinks[0].available,true);assert.equal(book.drinks[0].levelEligibleWithoutEvent,false);
  assert.equal(book.drinks[0].producerLevelWaivedByEvent,true);assert.equal(book.eventUnlockAccess.unconfirmedRentalInjected,false);
  assert.equal(book.memories.length,2);
  policy.cards.find(card=>card.gameId==='future').conditions.minProducerLevel=90;
  const sourceLocked=buildAccountPlaybook(input);
  assert.ok(sourceLocked.lockedCards.some(card=>card.gameId==='future'&&card.category==='locked'));
  policy.cards.find(card=>card.gameId==='future').conditions.minProducerLevel=80;
  input.catalog.skillCards.find(card=>card.gameId==='future').requiresSkillCardSwitch=true;
  const switchLocked=buildAccountPlaybook(input);
  assert.ok(switchLocked.lockedCards.some(card=>card.gameId==='future'&&card.category==='locked'&&card.access.levelEligible===false));
  const forged=buildAccountPlaybook({...input,options:{...input.options,eventUnlockOverrides:{...input.options.eventUnlockOverrides}}});
  assert.equal(forged.drinks[0].available,false);
});

test('consultation upgrades target joined owned cards and acquisitions never remove an existing basic card', () => {
  const playbook = buildAccountPlaybook(fixture());
  const first = playbook.weekPlan.find(week => week.week === 1).consultation;
  assert.ok(!first.preferredActions.some(action => action.action === 'upgrade'));
  assert.ok(!first.preferredActions.some(action => action.action === 'change'));
  const later = playbook.weekPlan.find(week => week.week === 12).consultation;
  const upgrade = later.preferredActions.find(action => action.action === 'upgrade');
  assert.deepEqual(upgrade.targetRefs.map(card => card.gameId), ['later']);
  const acquire = later.preferredActions.find(action => action.action === 'acquire');
  assert.equal(acquire.removesExistingCard, false);
  assert.ok(acquire.targetRefs.every(card => card.gameId !== 'future'));
  assert.equal(later.pointsKnown, false);
  assert.equal(later.liveDeckKnown, false);
});

test('missing policy data retains actual memory timing and planned choices', () => {
  const input = fixture();
  delete input.catalog.playbookPolicies;
  const result = buildAccountPlaybook(input);
  assert.equal(result.memories.length, 2);
  assert.equal(result.weekPlan.length, 4);
  assert.equal(result.drinks.length, 0);
  assert.ok(result.missing.some(note => note.includes('운영 정책')));
});

test('keeps source-backed basic-card changes in class and postpones locked upgrade targets', () => {
  const input = fixture();
  input.result.personalizedPlan.initialDeck.masterCards[0].nameJa = '基本カード';
  input.result.scoreSummary.hifModel.selections.push({ week: 10, activity: 'class_vo' });
  input.result.scoreSummary.hifModel.selections.push({ week: 26, activity: 'consult' });
  input.catalog.calculationModels['score/schedule'].table.hif.none.push({ week: 10, stage: 'selection', activities: ['class_vo'] });
  input.catalog.calculationModels['score/schedule'].table.hif.none.push({ week: 26, stage: 'final', activities: ['consult'] });
  input.catalog.playbookPolicies.policies[0].cardManagement = [
    { gameId: null, action: 'change', venue: 'class', reason: '수업의 기본 카드 변환', when: ['실제 변환 선택지가 나왔을 때'],
      conditions: { selectionWeeks: [10], targetFilter: { nameIncludesJa: '基本' } }, sourceIds: ['source'], evidenceKind: 'author_observed_run' },
    { gameId: 'future', action: 'upgrade', venue: 'consult', reason: '해금 후 강화', when: ['해금·획득 뒤'],
      conditions: { selectionWeeks: [12], minProducerLevel: 80, onlyIfUpgradeCount: 0 }, sourceIds: ['source'] },
    { gameId: 'basic', action: 'remove', venue: 'consult', reason: '선발 한정 삭제 예시', when: ['선발12주에 기본 카드가 남았을 때'],
      conditions: { selectionWeeks: [12] }, sourceIds: ['source'] },
  ];
  const result = buildAccountPlaybook(input);
  const lessonClass = result.weekPlan.find(week => week.week === 10);
  assert.equal(lessonClass.managementActions[0].action, 'change');
  assert.equal(lessonClass.managementActions[0].venue, 'class');
  assert.equal(lessonClass.managementActions[0].targetRefs[0].gameId, 'basic');
  const consultation = result.weekPlan.find(week => week.week === 12).consultation;
  assert.ok(consultation.preferredActions.every(action => action.action !== 'change'));
  assert.ok(!consultation.preferredActions.flatMap(action => action.targetRefs).some(card => card.gameId === 'future'));
  assert.equal(result.weekPlan.find(week => week.week === 26).managementActions.length, 0);
});
