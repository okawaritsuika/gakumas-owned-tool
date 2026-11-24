import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { summarizeMemoryEffects } from '../lib/memory-effects.mjs';
import { prepareHifAbilityGuidance } from '../../work/prepare_hif_ability_guidance.mjs';

const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
const data = JSON.parse(fs.readFileSync(new URL('../data/catalog/hif_ability_guidance.json', import.meta.url), 'utf8'));
const profile = data.profiles.find(profile => profile.id === 'anomaly_full_power');
const just = profile.goals.find(goal => goal.triggerCard.gameId === 'p_card-03-act-1_038');
const setting = profile.goals.find(goal => goal.triggerCard.gameId === 'p_card-03-men-1_051');

test('reviewed full-power goals preserve source timing and never certify the Atmosphere level70 loop or memory drop', () => {
  assert.equal(profile.goals.length, 2);
  assert.equal(profile.testedForAtmosphere, false);
  assert.deepEqual(profile.testedIdolCardIds, []);
  assert.equal(profile.sourceCompleteLoopProducerLevel, 80);
  assert.equal(just.sourceTiming.fromExamIndex, 4);
  assert.equal(setting.sourceTiming.selectionWeek, 10);
  assert.equal(setting.sourceTiming.fromExamIndex, 1);
  for (const goal of profile.goals) {
    assert.equal(goal.memoryCrafting.guaranteed, false);
    assert.equal(goal.memoryCrafting.dropProbability, null);
    assert.equal(goal.memoryCrafting.currentDropPoolMembershipVerified, false);
    assert.equal(goal.memoryCrafting.carriedSkillMayDifferFromTrigger, true);
    assert.equal(goal.memoryCrafting.creationPhase, 'hif_final_produce_end');
    assert.equal(goal.recommendation.appliesToAllFullPowerIdols, false);
    assert.ok(goal.sourceIds.includes('morishi-43'));
  }
});

test('Just Appeal is one additional use and one draw on its actual card use, not a permanent action bonus', () => {
  const ability = just.abilities[0];
  assert.match(ability.abilityId, /01-082-001$/);
  assert.deepEqual(ability.trigger.cardIds, ['p_card-03-act-1_038']);
  assert.equal(ability.trigger.timing, 'after_card_use');
  assert.equal(ability.trigger.activationLimit, 1);
  assert.equal(ability.trigger.perExamActivationLimit, 1);
  assert.equal(ability.trigger.requiresActualCardUse, true);
  assert.deepEqual(ability.effects.map(effect => [effect.type, effect.value]), [['ExamPlayableValueAdd', 1], ['ExamCardDraw', 1]]);
  assert.equal(ability.nativeEvidence.probabilityRawPermil, 0);
  assert.equal(ability.nativeEvidence.probabilityMeaning, 'not_specified_not_zero_percent');
});

test('Setting removal keeps one random Sleep in deck/discard only and its own five-charge use requirement', () => {
  const ability = setting.abilities[0], effect = ability.effects[0];
  assert.match(ability.abilityId, /01-022-001$/);
  assert.equal(ability.trigger.activationLimit, 1);
  assert.equal(effect.kind, 'remove_cards');
  assert.deepEqual(effect.targetCardIds, ['p_card-00-acc-0_002']);
  assert.equal(effect.targetPositionType, 'ProduceCardPositionType_DeckGrave');
  assert.equal(effect.destination, 'Lost');
  assert.equal(effect.pickRangeType, 'ProducePickRangeType_Random');
  assert.equal(effect.countMin, 1); assert.equal(effect.countMax, 1);
  assert.deepEqual(setting.triggerCard.useRequirements.map(row => [row.kind, row.value]), [['full_power_charge_at_least', 5]]);
});

test('base and upgraded trigger variants have no native upgrade filter, while the original query constraints remain available', () => {
  for (const goal of profile.goals) {
    assert.equal(goal.triggerCard.upgradeScope.kind, 'no_native_upgrade_filter');
    assert.deepEqual(goal.triggerCard.upgradeScope.knownCatalogUpgradeCounts, [0, 1]);
    const ability = goal.abilities[0];
    assert.deepEqual(ability.trigger.upgradeCounts, []);
    assert.equal(ability.trigger.noUpgradeFilter, true);
    const after = ability.trigger.conditions.find(row => row.phaseTypes.includes('ProduceExamPhaseType_ExamCardPlayAfter'));
    assert.deepEqual(after.cardIds, [goal.triggerCard.gameId]);
    assert.deepEqual(after.upgradeCounts, []);
    assert.equal(after.nativeSearch.cardPositionType, 'ProduceCardPositionType_Target');
    assert.deepEqual(after.fieldStatusTypes, []);
  }
});

test('ability activation starts at each HIF exam independent from a different carried skill joining after mid-exam', () => {
  const ability = just.abilities[0];
  const memory = { abilities: [{ id: ability.abilityId, level: ability.level }], produceCardPhaseType: 2,
    produceCard: { id: 'p_card-00-men-3_005', upgradeCount: 1, customizes: [] } };
  const summary = summarizeMemoryEffects(memory, catalog, { scenario: 'hif', plan: 'anomaly', producerLevel: 70 });
  assert.equal(summary.carriedSkill.phase.availableAtStart, false);
  assert.equal(summary.hifEffects[0].applies, true);
  assert.equal(summary.hifEffects[0].trigger.phase, 'StartAudition');
  assert.equal(ability.trigger.unlockAtTurn, 1);
  assert.equal(ability.trigger.carriedSkillPhaseControlsAbilityStart, false);
  const otherScenario = summarizeMemoryEffects(memory, catalog, { scenario: 'nia', plan: 'anomaly', producerLevel: 70 });
  assert.equal(otherScenario.hifEffects[0].applies, false);
});

test('all neutral native references retain exact duplicate identity and limits without becoming recommendations or invented growth', () => {
  const native = catalog.memoryAbilities.filter(ability => ability.restrictions?.explicitGroupScenarios?.includes('hif'));
  assert.equal(data.abilities.length, native.length);
  assert.equal(data.abilities.length, 115);
  assert.equal(new Set(data.abilities.map(ability => ability.abilityId + ':' + ability.level)).size, 115);
  assert.equal(data.coverage.growthAbilityFoundInLoadedSnapshot, false);
  for (const ability of data.abilities) {
    assert.equal(ability.recommendation, null);
    assert.equal(ability.scope, 'hif_only');
    assert.equal(ability.duplicateGroupKey, ability.uniqueKey);
    assert.equal(ability.duplicateActivationAllowed, false);
    assert.ok([1, 2].includes(ability.trigger.activationLimit));
    assert.equal(ability.dropAvailability.currentDropPoolMembershipVerified, false);
  }
  assert.equal(data.rules.ownedAbilityDoesNotUnlockTriggerCard, true);
  assert.equal(data.rules.lockedOrSwitchOffTriggerAbilitiesMayBeGenerated, true);
});

test('regeneration reproduces the checked reference data and source IDs resolve', () => {
  assert.deepEqual(prepareHifAbilityGuidance(catalog), data);
  const ids = new Set(data.sources.map(source => source.id));
  for (const profile of data.profiles) for (const goal of profile.goals) for (const id of goal.sourceIds) assert.ok(ids.has(id));
});
