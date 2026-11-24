import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEventUnlockOverrides } from '../lib/event-context.mjs';
import fs from 'node:fs';
import { loadCatalog } from '../lib/catalog.mjs';
import { summarizeMemoryEffects } from '../lib/memory-effects.mjs';

function fixture() {
  const makeAbility = (id, type, value, extra = {}) => ({ id, level: 1, produceSkillId: id, produceSkillLevel: 1,
    restrictions: { plan: 'free' }, activationCountRaw: 1,
    branches: [{ produceEffectId: `${id}-effect`, produceTriggerId: 'start', phaseType: 'ProducePhaseType_ProduceStart', activationRatePermilRaw: 0 }],
    ...extra, _effect: { id: `${id}-effect`, produceEffectType: `ProduceEffectType_${type}`, effectValueMin: value, effectValueMax: value } });
  const abilities = [makeAbility('initial', 'VocalAddition', 30), makeAbility('bonus', 'DanceGrowthRateAddition', 7),
    makeAbility('conditional', 'VisualAddition', 10, { branches: [{ produceEffectId: 'conditional-effect', produceTriggerId: 'lesson', phaseType: 'ProducePhaseType_StartLesson', activationRatePermilRaw: 500 }] })];
  return { memoryAbilities: abilities, skillCards: [{ id: 'skill', upgradeCount: 0, name: '기본 스킬', plan: 'sense', noDeckDuplication: true, unlockProducerLevel: 47, rentalUnlockProducerLevel: 45 },
    { id: 'skill', upgradeCount: 1, name: '강화 스킬', plan: 'sense', noDeckDuplication: true, unlockProducerLevel: 47, rentalUnlockProducerLevel: 45 }],
    idolCards: [{ id: 'idol', characterId: 'character' }],
    memoryMechanicsGraph: { ProduceEffect: abilities.map(row => row._effect), ProduceTrigger: [] } };
}
const refs = [{ id: 'initial', level: 1 }, { id: 'bonus', level: 1 }, { id: 'conditional', level: 1 }];
const target = { scenario: 'hif', plan: 'sense', producerLevel: 70 };

test('trusted event appearance waives only the producer unlock and actual rental tier while owned carry and switches stay separate',()=>{
  const catalog=fixture();
  catalog.eventModes={modes:[{id:'test-event',supportedPlans:['sense'],supportedScenarios:['hif'],rules:{plvAppearanceWaived:true,plvRentalWaived:true},sourceIds:['official-event']}]};
  const options={scenario:'hif',plan:'sense',producerLevel:10,eventModeId:'test-event'};
  options.eventUnlockOverrides=buildEventUnlockOverrides({catalog,options,context:options});
  const memory={produceCard:{id:'skill',upgradeCount:0},produceCardPhaseType:1};
  const owned=summarizeMemoryEffects(memory,catalog,options).carriedSkill;
  assert.equal(owned.producerLevel,10);assert.equal(owned.generationLevelEligible,true);
  assert.equal(owned.generationLevelEligibleWithoutEvent,false);assert.equal(owned.levelEligible,false);
  assert.equal(owned.rentalProducerLevelWaived,false);assert.equal(owned.accountProducerLevelChanged,false);
  const rental=summarizeMemoryEffects({...memory,rental:true},catalog,options).carriedSkill;
  assert.equal(rental.rentalProducerLevelWaived,true);assert.equal(rental.levelEligible,true);
  const forged=summarizeMemoryEffects(memory,catalog,{...options,eventUnlockOverrides:{...options.eventUnlockOverrides}}).carriedSkill;
  assert.equal(forged.generationLevelEligible,false);
  catalog.skillCards[0].requiresSkillCardSwitch=true;
  const switched=summarizeMemoryEffects({...memory,rental:true},catalog,{...options,skillCardSwitchSettings:{skill:true}}).carriedSkill;
  assert.equal(switched.levelEligible,false);assert.equal(switched.generationLevelEligible,false);
  assert.equal(switched.generationProducerLevelWaived,false);
  const disabled=summarizeMemoryEffects({...memory,rental:true},catalog,{...options,producerLevel:70,skillCardSwitchSettings:{skill:false}}).carriedSkill;
  assert.equal(disabled.obtainable,false);assert.equal(disabled.switchEligible,false);
  catalog.skillCards[0].requiresSkillCardSwitch=false;catalog.skillCards[0].plan='logic';
  const wrongPlan=summarizeMemoryEffects({...memory,rental:true},catalog,options).carriedSkill;
  assert.equal(wrongPlan.planCompatible,false);assert.equal(wrongPlan.obtainable,false);
});

test('only automatic produce-start bonuses enter totals; final memory stats and proc effects do not', () => {
  const result = summarizeMemoryEffects({ abilities: refs, vocal: 9999, dance: 8888, visual: 7777 }, fixture(), target);
  assert.deepEqual(result.initialStats, { vo: 30, da: 0, vi: 0 });
  assert.deepEqual(result.growthRatePermil, { vo: 0, da: 7, vi: 0 });
  assert.equal(result.conditionalEffects[0].probability.kind, 'not_specified');
  assert.equal(result.conditionalEffects[0].probability.percent, null);
  assert.equal(result.conditionalEffects[2].probability.percent, 50);
  assert.equal(result.conditionalEffects[2].includedInInitialTotals, false);
  assert.equal(result.noAbilityChain, true);
});

test('plan and scenario restrictions exclude numeric bonuses independently of carried skill', () => {
  const catalog = fixture();
  catalog.memoryAbilities[0].restrictions = { plan: 'logic', explicitGroupScenarios: ['nia'] };
  const wrong = summarizeMemoryEffects({ abilities: [refs[0]] }, catalog, target);
  assert.equal(wrong.conditionalEffects[0].applies, false);
  assert.equal(wrong.initialStats.vo, 0);
  const right = summarizeMemoryEffects({ abilities: [refs[0]] }, catalog, { scenario: 'nia', plan: 'logic' });
  assert.equal(right.initialStats.vo, 30);
  const unknown = summarizeMemoryEffects({ abilities: [refs[0]] }, catalog);
  assert.equal(unknown.conditionalEffects[0].applies, null);
  assert.equal(unknown.initialStats.vo, 0);
  assert.equal(unknown.status, 'partial');
});

test('unresolved ability levels never fall back to a different level and missing abilities are explicit', () => {
  const unknown = summarizeMemoryEffects({ abilities: [{ id: 'initial', level: 2 }] }, fixture(), target);
  assert.equal(unknown.initialStats.vo, 0);
  assert.match(unknown.issues[0], /정확한 레벨/);
  assert.equal(summarizeMemoryEffects({}, fixture(), target).status, 'partial');
});

test('native ability interpretation is separate from carried-card access and preserves known partial sums', () => {
  const memory = { abilities: [refs[0]], produceCardPhaseType: 1, produceCard: { id: 'skill', upgradeCount: 0 } };
  const unknownCarry = summarizeMemoryEffects(memory, fixture(), { plan: 'sense' });
  assert.equal(unknownCarry.status, 'partial');
  assert.equal(unknownCarry.abilityEffectsResolved, true);
  assert.equal(unknownCarry.initialStats.vo, 30);
  const unknownAbility = summarizeMemoryEffects({ abilities: [refs[0], { id: 'not-in-master', level: 1 }] }, fixture(), target);
  assert.equal(unknownAbility.abilityEffectsResolved, false);
  assert.equal(unknownAbility.initialStats.vo, 30);
  assert.equal(summarizeMemoryEffects({ abilities: [] }, fixture(), target).abilityEffectsResolved, true);
});

test('carried skill uses exact upgrade and acquisition phase, not the exam/contest deck', () => {
  const raw = { idolCardId: 'idol', produceCardPhaseType: 2, abilities: [],
    produceCard: { id: 'skill', upgradeCount: 1, customizes: [] },
    examBattleProduceCards: [{ id: 'other-skill', upgradeCount: 0 }] };
  const summary = summarizeMemoryEffects(raw, fixture(), target);
  assert.equal(summary.carriedSkill.name, '강화 스킬');
  assert.equal(summary.carriedSkill.phase.key, 'after_mid_audition');
  assert.equal(summary.carriedSkill.phase.availableAtStart, false);
  assert.equal(summary.carriedSkill.characterId, 'character');
  assert.equal(summary.carriedSkill.obtainable, true);
  assert.deepEqual(summary.uniqueKeys, ['skill:skill']);
  const wrongPlan = summarizeMemoryEffects(raw, fixture(), { ...target, plan: 'logic' });
  assert.equal(wrongPlan.carriedSkill.obtainable, false);
  assert.deepEqual(wrongPlan.uniqueKeys, []);
});

test('PLv unknown stays unknown; app owned comparison uses the official rental tier without confirming the owned scope', () => {
  const memory = { abilities: [], produceCardPhaseType: 1, produceCard: { id: 'skill', upgradeCount: 0 } };
  const unknown = summarizeMemoryEffects(memory, fixture(), { plan: 'sense' });
  assert.equal(unknown.carriedSkill.levelEligible, null);
  assert.equal(unknown.carriedSkill.obtainable, null);
  assert.equal(unknown.carriedSkill.phase.availableAtStart, true);
  const own = summarizeMemoryEffects(memory, fixture(), { plan: 'sense', producerLevel: 45 });
  assert.equal(own.carriedSkill.obtainable, true);
  assert.equal(own.carriedSkill.generationLevelEligible, false);
  assert.equal(own.carriedSkill.levelRule.ownedScopeOfficiallyConfirmed, false);
  assert.equal(own.carriedSkill.levelRule.officialScope, 'memory_rental_unlock');
  assert.match(own.carriedSkill.levelRule.noteKo, /자기 보유.*미확정/);
  const rental = summarizeMemoryEffects(memory, fixture(), { plan: 'sense', producerLevel: 45, rental: true });
  assert.equal(rental.carriedSkill.obtainable, true);
  assert.equal(rental.carriedSkill.requiredProducerLevel, 45);
});

test('PLv71 can carry a level75 skill; switch76-80 still requires its actual unlock and selected switch', () => {
  const native = { abilities: [], produceCardPhaseType: 1, produceCard: { id: 'p_card-03-men-3_060', upgradeCount: 0 } };
  const carry = summarizeMemoryEffects(native, catalog, { plan: 'anomaly', producerLevel: 71 });
  assert.equal(carry.carriedSkill.nameJa, '本領発揮');
  assert.equal(carry.carriedSkill.requiredProducerLevel, 71);
  assert.equal(carry.carriedSkill.obtainable, true);
  assert.equal(carry.carriedSkill.generationLevelEligible, false);
  const unknown = summarizeMemoryEffects(native, catalog, { plan: 'anomaly', producerLevel: null });
  assert.equal(unknown.carriedSkill.levelEligible, null);
  const source = fixture();
  source.skillCards[0] = { ...source.skillCards[0], unlockProducerLevel: 80, rentalUnlockProducerLevel: 76, requiresSkillCardSwitch: true };
  const memory = { abilities: [], produceCardPhaseType: 1, produceCard: { id: 'skill', upgradeCount: 0 } };
  const early = summarizeMemoryEffects(memory, source, { plan: 'sense', producerLevel: 76, skillCardSwitchSettings: { skill: true } });
  assert.equal(early.carriedSkill.requiredProducerLevel, 80);
  assert.equal(early.carriedSkill.obtainable, false);
  const unknownSwitch = summarizeMemoryEffects(memory, source, { plan: 'sense', producerLevel: 80 });
  assert.equal(unknownSwitch.carriedSkill.levelEligible, true);
  assert.equal(unknownSwitch.carriedSkill.obtainable, null);
  const selected = summarizeMemoryEffects(memory, source, { plan: 'sense', producerLevel: 80, skillCardSwitchSettings: { skill: true } });
  assert.equal(selected.carriedSkill.obtainable, true);
});

test('real switch cards with native unlock zero use the separate ProducerLevel conversion table', () => {
  const ids = [['p_card-01-act-3_185', 75], ['p_card-02-act-3_186', 76], ['p_card-03-act-3_188', 77],
    ['p_card-01-act-3_184', 78], ['p_card-02-act-3_187', 79], ['p_card-03-act-3_189', 80]];
  for (const [id, unlock] of ids) {
    const card = catalog.skillCards.find(row => row.gameId === id && row.upgradeCount === 0);
    assert.equal(card.unlockProducerLevel, 0);
    const memory = { abilities: [], produceCardPhaseType: 1, produceCard: { id, upgradeCount: 0 } };
    const early = summarizeMemoryEffects(memory, catalog, { plan: card.plan, producerLevel: unlock - 1, skillCardSwitchSettings: { [id]: true } });
    assert.equal(early.carriedSkill.requiredProducerLevel, unlock);
    assert.equal(early.carriedSkill.levelEligible, false);
    assert.equal(early.carriedSkill.obtainable, false);
    const unknown = summarizeMemoryEffects(memory, catalog, { plan: card.plan, producerLevel: unlock });
    assert.equal(unknown.carriedSkill.levelEligible, true);
    assert.equal(unknown.carriedSkill.obtainable, null);
    const selected = summarizeMemoryEffects(memory, catalog, { plan: card.plan, producerLevel: unlock, skillCardSwitchSettings: { [id]: true } });
    assert.equal(selected.carriedSkill.obtainable, true);
  }
  const missingTable = { ...catalog, memoryEffectDetails: null };
  const incomplete = summarizeMemoryEffects({ abilities: [], produceCardPhaseType: 1, produceCard: { id: ids[0][0], upgradeCount: 0 } }, missingTable, target);
  assert.equal(incomplete.carriedSkill.obtainable, null);
  assert.match(incomplete.issues.join(' '), /해금 PLv 0을 무제한/);
});

const catalog = loadCatalog();
catalog.memoryEffectDetails = JSON.parse(fs.readFileSync(new URL('../data/memory_effect_details.json', import.meta.url), 'utf8'));
const removalAbility = 'memory_ability-p_memory_skill-common-hatsuboshi_idol_festival-p_trigger-start_audition-for_hif_memory-exam_status_enchant-exam_turn_timer-exam_status_enchant-01-001-001';
const useCountAbility = 'memory_ability-p_memory_skill-common-hatsuboshi_idol_festival-p_trigger-start_audition-for_hif_memory-exam_status_enchant-exam_turn_timer-exam_status_enchant-01-035-001';

test('HIF graph resolves actual named skill, negative card removal, location and one-use cap', () => {
  const summary = summarizeMemoryEffects({ abilities: [{ id: removalAbility, level: 1 }] }, catalog, target);
  const effect = summary.hifEffects[0];
  const action = effect.actions[0];
  assert.equal(summary.status, 'resolved');
  assert.equal(action.kind, 'remove_cards');
  assert.equal(action.search.cards[0].id, 'p_card-00-acc-0_002');
  assert.equal(action.search.cards[0].nameJa, '眠気');
  assert.equal(action.conditions[1].search.cards[0].nameJa, 'ひと呼吸');
  assert.equal(action.countMin, 1);
  assert.equal(action.destination, 'Lost');
  assert.equal(action.activationLimits[0].count, 1);
  assert.match(effect.descriptionJa, /以降1回まで/);
  assert.equal(summary.uniqueKeys.length, 1);
  const off = summarizeMemoryEffects({ abilities: [{ id: removalAbility, level: 1 }] }, catalog, { ...target, scenario: 'hajime' });
  assert.equal(off.hifEffects[0].applies, false);
  assert.deepEqual(off.uniqueKeys, []);
});

test('HIF extra card use is +1 per trigger with a two-activation limit, not a flat +2 action bonus', () => {
  const summary = summarizeMemoryEffects({ abilities: [{ id: useCountAbility, level: 1 }] }, catalog, target);
  const action = summary.hifEffects[0].actions[0];
  assert.equal(action.kind, 'skill_use_count_add');
  assert.equal(action.value, 1);
  assert.equal(action.activationLimits[0].count, 2);
  assert.equal(action.conditions.at(-1).search.cards[0].nameJa, 'ファンサ');
  assert.deepEqual(summary.initialStats, { vo: 0, da: 0, vi: 0 });
  assert.deepEqual(summary.growthRatePermil, { vo: 0, da: 0, vi: 0 });
  const duplicate = summarizeMemoryEffects({ abilities: [{ id: useCountAbility, level: 1 }] }, catalog, target);
  assert.deepEqual(summary.uniqueKeys, duplicate.uniqueKeys);
});

test('native customizeCount joins the exact source row while customized card math is clearly not simulated', () => {
  const summary = summarizeMemoryEffects({ abilities: [], produceCardPhaseType: 1,
    produceCard: { id: 'p_card-01-men-1_034', upgradeCount: 1,
      customizes: [{ id: 'p_card_custom-020-g_effect-cost_reduce-2', customizeCount: 1 }] } }, catalog, target);
  const customize = summary.carriedSkill.customizes[0];
  assert.equal(customize.known, true);
  assert.equal(customize.exactCountKnown, true);
  assert.equal(customize.native.customizeCount, 1);
  assert.equal(customize.growEffects[0].effectType, 'ProduceCardGrowEffectType_CostReduce');
  assert.equal(customize.growEffects[0].value, 2);
  assert.equal(summary.carriedSkill.actionDescriptionScope, 'base_card_before_customization');
  assert.equal(summary.carriedSkill.customizationCalculationStatus, 'not_simulated');
});

test('every current account memory resolves its exact ability graph and customize identity', () => {
  const file = new URL('../../outputs/학마스_보유노트/data/inventory.json', import.meta.url);
  if (!fs.existsSync(file)) return; // Account snapshot is deliberately absent in distributed source packages.
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  const plans = new Map(catalog.idolCards.map(card => [card.gameId, card.plan]));
  assert.ok(snapshot.userMemoryList.length > 0);
  for (const memory of snapshot.userMemoryList) {
    // Explicit test PLv, not an invented level assigned to the account.
    const summary = summarizeMemoryEffects(memory, catalog, { scenario: 'hif', plan: plans.get(memory.idolCardId), producerLevel: 70 });
    assert.deepEqual(summary.issues, []);
    assert.equal(summary.conditionalEffects.length, memory.abilities.length);
    assert.ok(summary.carriedSkill.variantKnown);
    assert.ok(summary.carriedSkill.customizes.every(row => row.exactCountKnown));
    for (const number of [...Object.values(summary.initialStats), ...Object.values(summary.growthRatePermil)]) assert.ok(Number.isFinite(number));
  }
});
