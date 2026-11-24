import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildBattleLoadout } from '../lib/battle-loadout.mjs';
import { simulateBattle } from '../lib/battle-simulation.mjs';

const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
const idol = catalog.idolCards.find(row => row.gameId === 'i_card-kllj-3-015');
function fixture() {
  return { result: { selectedIdol: { ...idol, ownershipVerified: true, owned: { potentialRank: 0, uncap: 0 } },
    scoreSummary: { scenario: 'hif', plan: 'anomaly', difficulty: 'none' } }, catalog,
  personalizedPlan: { context: { scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower', producerLevel: { value: 70 } },
    uniqueCards: [{ gameId: idol.uniqueIds.produceCardId, upgradeCount: 0, variantVerified: true, customizes: [] }],
    memoryStages: { atStart: [], afterMid: [], unknown: [] }, cardAccess: [], midgamePlan: { acquisitionTargets: [] } },
  stage: { stage: 'selection', order: 1 } };
}
const memory = (gameId = 'p_card-00-men-3_005', upgradeCount = 0) => ({
  memoryId: 'owned-memory', gameId, name: '반입 스킬', upgradeCount, obtainable: true,
  phase: { code: 1, availableAtStart: true }, customizes: [], effects: {},
});

test('uses the seven-card scenario template once, plus the exact owned unique card', () => {
  const built = buildBattleLoadout(fixture());
  assert.equal(built.status, 'ready');
  assert.equal(built.mappedCards.filter(row => row.source === 'scenario_initial_deck').length, 7);
  assert.equal(built.mappedCards.length, 8);
  assert.equal(built.mappedCards.find(row => row.source === 'owned_idol_unique').publicId, 638);
  assert.deepEqual(built.loadout.pItemIds, [364]);
  assert.equal(built.loadout.fullDeckConfirmed, false);
  assert.equal(built.loadout.deckAssumptionConfirmed, true);
  assert.equal(built.loadout.params, null);
});

test('selects an upgraded unique P-item using the exact awakening effect, not a generic rank cutoff', () => {
  const input = fixture();
  input.result.selectedIdol.owned.potentialRank = 2;
  assert.deepEqual(buildBattleLoadout(input).loadout.pItemIds, [365]);
  input.result.selectedIdol.awakeningStages = idol.awakeningStages.map(stage => ({ ...stage, effectTypes: [] }));
  assert.deepEqual(buildBattleLoadout(input).loadout.pItemIds, [364]);
  input.result.selectedIdol.awakeningStages = [];
  assert.equal(buildBattleLoadout(input).status, 'unsupported');
});

test('keeps phase-two memories out of the first trial and adds them only at a declared later stage', () => {
  const input = fixture();
  input.personalizedPlan.memoryStages.afterMid = [{ ...memory(), phase: { code: 2, availableAtStart: false } }];
  assert.equal(buildBattleLoadout(input).mappedCards.length, 8);
  assert.equal(buildBattleLoadout({ ...input, includeAfterMid: true }).status, 'unsupported');
  input.stage.order = 2;
  const later = buildBattleLoadout({ ...input, includeAfterMid: true });
  assert.equal(later.status, 'ready');
  assert.equal(later.mappedCards.length, 7);
  assert.equal(later.automaticRemovals.appliedEvents.length, 2);
  assert.equal(later.mappedCards.filter(card => card.source === 'selected_memory').length, 1);
});

test('maps a real memory customization ID and exact count into the public engine definition', () => {
  const input = fixture(), custom = catalog.customizations.find(row => row.internalId === 4);
  input.personalizedPlan.memoryStages.atStart = [{ ...memory('p_card-03-act-1_042', 1),
    customizes: [{ id: custom.gameId, exactCountKnown: true, customizeCount: 1, growEffects: [] }] }];
  const built = buildBattleLoadout(input), carried = built.mappedCards.find(row => row.source === 'selected_memory');
  assert.equal(built.status, 'ready');
  assert.equal(carried.publicId, 389);
  assert.deepEqual(carried.customizations, { 4: 1 });
  input.personalizedPlan.memoryStages.atStart[0].customizes[0].id = 'unmapped-native-grow';
  assert.equal(buildBattleLoadout(input).status, 'unsupported');
  input.personalizedPlan.memoryStages.atStart[0].customizes[0].id = custom.gameId;
  input.personalizedPlan.memoryStages.atStart[0].customizes[0].exactCountKnown = false;
  assert.equal(buildBattleLoadout(input).status, 'unsupported');
});

test('does not add a PLv80 or unselected-switch normal-acquisition card at PLv70', () => {
  const input = fixture();
  input.assumedCardIds = ['p_card-03-act-3_189'];
  assert.equal(buildBattleLoadout(input).status, 'unsupported');
  input.personalizedPlan.context.producerLevel.value = 80;
  assert.equal(buildBattleLoadout(input).status, 'unsupported');
  input.personalizedPlan.cardAccess = [{ gameId: input.assumedCardIds[0], normalAcquisition: { eligible: true, requiresSwitch: true, switchEligible: true } }];
  assert.equal(buildBattleLoadout(input).status, 'ready');
});

test('only proposes eligible normal cards and records a selected acquisition as an assumption', () => {
  const input = fixture(), gameId = 'p_card-03-men-3_058';
  input.personalizedPlan.midgamePlan.acquisitionTargets = [{ gameId, name: '아이돌이 됩니다', normalAcquisition: { eligible: true }, conflicts: [] }];
  const base = buildBattleLoadout(input);
  assert.deepEqual(base.suggestedSets[0].gameIds, [gameId]);
  assert.equal(base.mappedCards.length, 8);
  const acquired = buildBattleLoadout({ ...input, assumedCardIds: [gameId] });
  assert.equal(acquired.status, 'ready');
  assert.equal(acquired.mappedCards.length, 9);
  assert.equal(acquired.mappedCards.at(-1).source, 'declared_acquisition_assumption');
});

test('blocks missing unique variants and memory effects that would otherwise silently change the deck', () => {
  const input = fixture();
  input.personalizedPlan.uniqueCards[0].variantVerified = false;
  assert.equal(buildBattleLoadout(input).loadout, null);
  input.personalizedPlan.uniqueCards[0].variantVerified = true;
  input.personalizedPlan.memoryStages.atStart = [{ ...memory(), effects: { hifEffects: [{ kind: 'exam_enchant', applies: true, actions: [{ kind: 'remove_cards' }] }] } }];
  assert.equal(buildBattleLoadout(input).status, 'unsupported');
});

test('an assembled native recipe runs only after explicit stage-stat injection', async () => {
  const built = buildBattleLoadout(fixture());
  const stage = { scenario: 'hif', turnCounts: { vocal: 2, dance: 2, visual: 2 },
    firstTurns: { vocal: 1, dance: 0, visual: 0 }, criteria: { vocal: 1, dance: 1, visual: 1 },
    effects: [], typeMultipliers: { vocal: 1, dance: 1, visual: 1 } };
  assert.equal((await simulateBattle({ loadout: built.loadout, stage, runs: 2, seed: 42 })).status, 'invalid_input');
  const battle = await simulateBattle({ loadout: { ...built.loadout, params: [100, 100, 100, 40] }, stage, runs: 2, seed: 42 });
  assert.equal(battle.status, 'simulated');
  assert.equal(battle.scope, 'conditional_model');
  assert.equal(battle.representativeTrace.turns.length, 6);
  assert.equal(battle.representativeTrace.startingDeckCardCount, 8);
});

test('applies the same declared automatic removals cumulatively and adds the HIF response item only in final two', () => {
  const input = fixture(), before = structuredClone(input.personalizedPlan);
  const stages = [{ stage: 'selection', order: 1 }, { stage: 'selection', order: 2 }, { stage: 'selection', order: 3 },
    { stage: 'final', order: 1 }, { stage: 'final', order: 2 }].map(stage => buildBattleLoadout({ ...input, stage }));
  assert.deepEqual(stages.map(stage => stage.mappedCards.filter(card => card.source === 'scenario_initial_deck').length), [7, 5, 3, 3, 3]);
  assert.deepEqual(stages.map(stage => stage.automaticRemovals.appliedEvents.length), [0, 2, 4, 4, 4]);
  assert.ok(stages.slice(0, 4).every(stage => !stage.mappedItems.some(item => item.publicId === 441)));
  assert.ok(stages[4].mappedItems.some(item => item.publicId === 441));
  assert.deepEqual(stages[3].mappedCards, stages[4].mappedCards);
  assert.deepEqual(input.personalizedPlan, before);
});

test('HIF response item generates to 22 from the exact basic kinds without adding another initial deck', async () => {
  const built = buildBattleLoadout({ ...fixture(), stage: { stage: 'final', order: 2 } });
  const stage = { scenario: 'hif', turnCounts: { vocal: 1, dance: 1, visual: 1 }, firstTurns: { vocal: 1, dance: 0, visual: 0 },
    criteria: { vocal: 1, dance: 1, visual: 1 }, effects: [], typeMultipliers: { vocal: 1, dance: 1, visual: 1 } };
  const loadout = { ...built.loadout, params: [100, 100, 100, 40] };
  const battle = await simulateBattle({ loadout, stage, runs: 2, seed: 42 });
  assert.equal(battle.status, 'simulated');
  for (const trace of [battle.representativeTrace, battle.bestTrace]) {
    assert.equal(trace.suppliedCardCount, 4);
    assert.equal(trace.startingDeckCardCount, 22);
    assert.equal(trace.generatedAtStart.length, 18);
    assert.ok(trace.generatedAtStart.every(card => built.loadout.generatedBasicCardIds.includes(card.id)));
  }
  const alreadyLarge = { ...loadout, skillCardIdGroups: [Array.from({ length: 23 }, () => 662)], customizationGroups: [] };
  const full = await simulateBattle({ loadout: alreadyLarge, stage, runs: 1, seed: 42 });
  assert.equal(full.status, 'simulated');
  assert.equal(full.representativeTrace.startingDeckCardCount, 23);
  assert.deepEqual(full.representativeTrace.generatedAtStart, []);
});

test('only explicitly acquired support battle items enter at their declared stage; growth items stay outside battle', () => {
  const input = fixture(), stageSupport = catalog.supportCards.find(card => card.p_item?.name === '仲直りのきっかけ');
  const growthSupport = catalog.supportCards.find(card => card.gameId === 's_card-3-0099');
  input.result.supports = { owned: [stageSupport, growthSupport] };
  assert.ok(!buildBattleLoadout(input).mappedItems.some(item => item.publicId === 78));
  const acquisitions = { [stageSupport.gameId]: { confirmed: true, fromExamIndex: 1 }, [growthSupport.gameId]: { confirmed: true, fromExamIndex: 0 } };
  assert.ok(!buildBattleLoadout({ ...input, supportItemAcquisitions: acquisitions }).mappedItems.some(item => item.publicId === 78));
  const later = buildBattleLoadout({ ...input, stage: { stage: 'selection', order: 2 }, supportItemAcquisitions: acquisitions });
  assert.equal(later.status, 'ready');
  assert.ok(later.mappedItems.some(item => item.publicId === 78));
  assert.ok(!later.mappedItems.some(item => item.name === '素敵なお仕事'));
  assert.ok(later.limitations.some(reason => reason.includes('육성 중 효과')));
});
