import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonalizedPlan } from '../lib/personalized-plan.mjs';
import { buildEventUnlockOverrides } from '../lib/event-context.mjs';

const skill = (gameId, name, normal, carry, extra = {}) => ({ gameId, name, nameJa: name, plan: 'anomaly',
  upgradeCount: 0, unlockProducerLevel: normal, rentalUnlockProducerLevel: carry, recommendationEligible: true, ...extra });
const memory = (id, gameId, name, phase) => ({ id, skillCard: skill(gameId, name, 1, 1), modelEffects: {
  carriedSkill: { id: gameId, name, nameJa: name, plan: 'anomaly', upgrade: 1, obtainable: true,
    phase: { code: phase, availableAtStart: phase === 1 }, customizes: [{ id: 'custom', customizeCount: 1, exactCountKnown: true, growEffects: [] }] } } });

function fixture() {
  const stacking = 'p_card-03-act-1_042', future = 'p_card-03-act-3_189';
  const catalog = { skillCards: [skill('unique', '고유 카드', 0, 0), skill('unique', '고유 카드+', 0, 0, { upgradeCount: 1 }),
    skill(stacking, '축적', 13, 1), skill('draw', '전심전력', 50, 50), skill('grow', '아이돌이 됩니다', 25, 20),
    skill(future, '날아올라라!', 0, 0), skill('hold', '본령 발휘', 75, 71), skill('switch', '전환 카드', 0, 0),
    skill('current-attack', '현재 공격 후보', 11, 1, { rarity: 'SSR', sourceType: 'produce', actions: 'score+=10+cumulativeFullPowerCharge' })],
    memoryEffectDetails: { tables: { ProducerLevelUnlocks: {
      [future]: { level: 80, type: 'ProducerLevelUnlockType_ProduceCardConversion' },
      switch: { level: 54, type: 'ProducerLevelUnlockType_ProduceCardConversion' },
    } } },
    hifMemoryRoles: { profiles: [{ id: 'full', plan: 'anomaly', trainingType: 'full_power', trainingTypeAliases: ['fullPower'],
      carryRoles: [{ gameId: stacking, plan: 'anomaly', nameKo: '축적', purpose: '개시 반복 공격', requiredAcquisitionPhaseForEarlyRole: 1 },
        { gameId: 'hold', plan: 'anomaly', nameKo: '본령 발휘', purpose: '보류·성장', normalUnlockProducerLevel: 75, carryUnlockProducerLevel: 71 }],
      alternatives: [{ gameId: future, plan: 'anomaly', nameKo: '날아올라라!', purpose: '고레벨 반복', normalUnlockProducerLevel: 80, carryUnlockProducerLevel: 80, requiresSwitch: true },
        { gameId: 'grow', plan: 'anomaly', nameKo: '아이돌이 됩니다', purpose: '손패 강화' },
        { gameId: 'switch', plan: 'anomaly', nameKo: '전환 카드', purpose: '보조', requiresSwitch: true }] }] } };
  const idol = { gameId: 'idol', name: '보유 아이돌', plan: 'anomaly', ownershipVerified: true, owned: { uncap: 3 },
    uniqueIds: { produceCardId: 'unique' }, specialTrainingStages: [{ rank: 3, effectTypes: ['IdolCardLevelLimitEffectType_ProduceCardUpgrade'] }] };
  const result = { selectedIdol: idol, supports: { owned: [{ gameId: 'support', name: '현재 서포트', plan: 'free', level: 10, uncap: 2, maxLevels: { 2: 50 } }], rental: null },
    memories: [memory('start', stacking, '축적+', 1), memory('later-draw', 'draw', '전심전력+', 2), memory('later-grow', 'grow', '아이돌이 됩니다+', 2)],
    scoreSummary: { scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower' },
    supportUpgradeComparison: { available: true, upgrades: [{ gameId: 'support', currentLevel: 10, targetLevel: 50 }], statDelta: { vocal: 20, dance: 0, visual: 0 }, addedSupportIds: [], removedSupportIds: [], assumption: '현재 돌파 상한' } };
  return { result, inventory: { producerLevel: null }, catalog, options: { producerLevel: 70 } };
}

test('personal preparation separates opening and mid-exam cards and postpones the level80 full-power loop', () => {
  const input = fixture(), before = structuredClone(input);
  const plan = buildPersonalizedPlan(input);
  assert.deepEqual(plan.context.producerLevel, { value: 70, source: 'user_input' });
  assert.deepEqual(plan.memoryStages.atStart.map(card => card.memoryId), ['start']);
  assert.deepEqual(plan.memoryStages.afterMid.map(card => card.memoryId), ['later-draw', 'later-grow']);
  assert.deepEqual(plan.simulationInputs.stageRecipes[0].confirmedCards.map(card => card.gameId), ['unique', 'p_card-03-act-1_042']);
  assert.ok(!plan.simulationInputs.stageRecipes[0].confirmedCards.some(card => card.gameId === 'draw'));
  assert.deepEqual(plan.simulationInputs.stageRecipes[1].assumedCards, []);
  assert.equal(plan.simulationInputs.stageRecipes[1].id, 'after_selection_1');
  assert.equal(plan.midgamePlan.timingRule.status, 'community_documented');
  assert.deepEqual(plan.midgamePlan.timingRule.appliesAfter, { stage: 'selection', order: 1 });
  assert.equal(plan.simulationInputs.stageRecipes[1].requiresCandidateSelection, true);
  assert.ok(plan.simulationInputs.stageRecipes[1].acquisitionCandidates.some(card => card.gameId === 'current-attack'));
  assert.equal(plan.uniqueCards[0].upgradeCount, 1);
  assert.equal(plan.uniqueCards[0].name, '고유 카드+');
  assert.equal(plan.memoryStages.atStart[0].customizes[0].customizeCount, 1);
  const future = plan.cardAccess.find(card => card.gameId === 'p_card-03-act-3_189');
  assert.equal(future.normalAcquisition.requiredProducerLevel, 80);
  assert.equal(future.normalAcquisition.eligible, false);
  assert.ok(!plan.midgamePlan.acquisitionTargets.some(card => card.gameId === future.gameId));
  assert.ok(plan.midgamePlan.acquisitionTargets.some(card => card.gameId === 'current-attack'));
  const hold = plan.cardAccess.find(card => card.gameId === 'hold');
  assert.equal(hold.normalAcquisition.requiredProducerLevel, 75);
  assert.equal(hold.memoryCarry.requiredProducerLevel, 71);
  assert.ok(plan.missingCombinations.some(issue => issue.gameId === future.gameId && issue.kind === 'level_locked_card'));
  assert.equal(plan.supports[0].currentLevel, 10);
  assert.equal(plan.supports[0].levelCap, 50);
  assert.equal(plan.supportUpgradePlan.upgrades[0].targetLevel, 50);
  assert.equal(plan.simulationInputs.fullDeckVerified, false);
  assert.equal(plan.simulationInputs.scoreStatistics, null);
  assert.equal(plan.scope.battleSimulationRun, false);
  assert.deepEqual(input, before);
});

test('event normal acquisition exceptions keep real PLv, owned carry tiers and the level80 switch loop unchanged',()=>{
  const input=fixture();
  input.catalog.eventModes={modes:[{id:'test-event',supportedPlans:['anomaly'],supportedScenarios:['hif'],rules:{plvAppearanceWaived:true,plvRentalWaived:true},sourceIds:['official-event']}]};
  input.options.eventModeId='test-event';
  input.options.skillCardSwitchSettings={'p_card-03-act-3_189':true};
  input.options.eventUnlockOverrides=buildEventUnlockOverrides({catalog:input.catalog,options:input.options,context:{plan:'anomaly',scenario:'hif',trainingType:'fullPower'}});
  const plan=buildPersonalizedPlan(input),hold=plan.cardAccess.find(card=>card.gameId==='hold');
  assert.equal(plan.context.producerLevel.value,70);assert.equal(plan.context.eventUnlockAccess.guidePrerequisitesWaived,false);
  assert.equal(hold.normalAcquisition.levelEligible,true);assert.equal(hold.normalAcquisition.levelEligibleWithoutEvent,false);
  assert.equal(hold.normalAcquisition.producerLevelWaivedByEvent,true);assert.equal(hold.memoryCarry.levelEligible,false);
  const future=plan.cardAccess.find(card=>card.gameId==='p_card-03-act-3_189');
  assert.equal(future.normalAcquisition.levelEligible,false);assert.equal(future.normalAcquisition.requiresSwitch,true);
  assert.ok(plan.midgamePlan.acquisitionTargets.some(card=>card.gameId==='hold'));
  assert.ok(!plan.midgamePlan.acquisitionTargets.some(card=>card.gameId===future.gameId));
  assert.equal(Object.values(plan.memoryStages).flat().length,3);
  const forged=buildPersonalizedPlan({...input,options:{...input.options,eventUnlockOverrides:{...input.options.eventUnlockOverrides}}});
  assert.equal(forged.cardAccess.find(card=>card.gameId==='hold').normalAcquisition.levelEligible,false);
});

test('unread switch and eligibility states never become acquired cards or a verified opening recipe', () => {
  const input = fixture();
  input.result.memories[0].modelEffects.carriedSkill.obtainable = null;
  input.result.selectedIdol.owned.uncap = null;
  const plan = buildPersonalizedPlan(input);
  const switching = plan.cardAccess.find(card => card.gameId === 'switch');
  assert.equal(switching.normalAcquisition.eligible, null);
  assert.equal(switching.normalAcquisition.acquired, false);
  assert.equal(switching.normalAcquisition.switchEligible, null);
  assert.equal(plan.simulationInputs.stageRecipes[0].confirmedCards.length, 0);
  assert.equal(plan.uniqueCards[0].variantVerified, false);
  assert.ok(plan.simulationInputs.missingInputs.some(item => item.includes('스킬 전환')));
});

test('other scenarios keep account-specific assets without claiming verified HIF operating advice', () => {
  const input = fixture();
  input.result.scoreSummary.scenario = 'nia';
  const plan = buildPersonalizedPlan(input);
  assert.equal(plan.scope.hasVerifiedHifRoleProfile, false);
  assert.equal(plan.context.scenario, 'nia');
  assert.equal(plan.memoryStages.afterMid.length, 2);
  assert.equal(plan.simulationInputs.historicalMemoryDeckIsLiveDeck, false);
  assert.ok(plan.scope.operatingAdvice.includes('미검증'));
});

test('HIF initial deck uses the seven explicit scenario slots and never adds the separate idol seed deck', () => {
  const input = fixture();
  input.catalog.skillCards.push(skill('basic', '기본 카드', 0, 0));
  input.catalog.produceInitialDecks = { idolProfiles: [{ idolCardId: 'idol', initialDeckId: 'idol-seed', scenarioDeckIds: { 'produce-007': 'scenario-deck' } }],
    decks: { 'idol-seed': { cardSlots: [{ cardId: 'seed-card', upgradeCount: null }, { cardId: 'seed-card', upgradeCount: null }] },
      'scenario-deck': { cardSlots: Array.from({ length: 7 }, () => ({ cardId: 'basic', upgradeCount: 0 })) } } };
  const plan = buildPersonalizedPlan(input);
  assert.equal(plan.initialDeck.initialDeckId, 'scenario-deck');
  assert.equal(plan.initialDeck.cardCount, 7);
  assert.equal(plan.initialDeck.includesIdolSeedDeck, false);
  assert.ok(plan.initialDeck.masterCards.every(card => card.gameId === 'basic' && card.upgradeCount === 0));
  assert.equal(plan.openingPlan.cards.length, 9);
  assert.equal(plan.simulationInputs.stageRecipes[0].assumedCards.length, 7);
  assert.ok(!plan.openingPlan.cards.some(card => card.gameId === 'seed-card'));
  assert.equal(plan.simulationInputs.fullDeckVerified, false);
});
