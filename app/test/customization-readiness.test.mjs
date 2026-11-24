import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { normalizeSnapshot } from '../lib/inventory.mjs';
import { recommend } from '../lib/recommend.mjs';
import { buildPersonalizedPlan } from '../lib/personalized-plan.mjs';
import { buildCustomizationReadiness } from '../lib/customization-readiness.mjs';

const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
const STACK = 'p_card-03-act-1_042', COUNT = 'p_card_custom-100-g_effect-lesson_count_add-1';
const GROW = 'p_card_custom-040_040_070-g_effect-effect_add-e_effect-exam_add_grow_effect-p_card_search-hand-all-0_0-g_effect-lesson_add-3-g_effect-effect_add-e_effect-exam_add_grow_effect-p_card_search-hand-all-0_0-g_effect-lesson_add-6-g_effect-effect_add-e_effect-exam_add_grow_effect-p_card_search-hand-all-0_0-g_effect-lesson_add-11';
const LIMIT = 'p_card_custom-wrapper-p_card-03-men-1_050-b-01';
const custom = (id, customizeCount = 1) => ({ id, customizeCount });
const memory = (gameId = STACK, customs = [], phase = 1) => ({ id: 'selected', produceCardPhaseType: phase,
  produceCard: { id: gameId, upgradeCount: 1, customizes: customs }, abilities: [] });
const result = (memories, trainingType = 'fullPower') => ({ selectedIdol: { gameId: 'i_card-kllj-3-015', plan: 'anomaly' },
  scoreSummary: { scenario: 'hif', plan: 'anomaly', trainingType, hifModel: { selections: [{ week: 19, activity: 'consult' }] } }, memories });
const build = (memories, extra = {}) => buildCustomizationReadiness({ result: result(memories), catalog, inventory: { producerLevel: 70 }, ...extra });

test('opening attack count and late growth are separate source specifications, not an already completed loop', () => {
  const input = result([memory(STACK, [custom(COUNT)])]);
  const before = structuredClone(input);
  const output = build([], { result: input });
  const row = output.memories[0];
  assert.match(row.actualSummary, /상승 횟수 증가 \+1/);
  assert.equal(row.guide.required[0].status, 'fulfilled');
  assert.equal(row.guide.roleStatus, 'unknown');
  assert.equal(row.guide.templateRequirements[0].status, 'missing');
  assert.equal(row.guide.templateRequirements[0].timing, 'during_produce_not_required_at_start');
  const during = output.duringProduce.find(item => item.target.gameId === STACK);
  assert.deepEqual(during.timing.selectionWeeks, [19]);
  assert.equal(during.targetCount, 2); assert.equal(during.ppCost, null);
  assert.equal(during.applied, false); assert.equal(during.routeIncludesVenueAtTargetWeek, false);
  assert.equal(output.readinessConfirmed, false); assert.equal(output.hypotheticalEffectsApplied, false);
  assert.deepEqual(input, before);
});

test('growth alone does not satisfy attack-count customization and stage 1 does not pretend to be growth twice', () => {
  const one = build([memory(STACK, [custom(GROW)])]).memories[0];
  assert.equal(one.guide.required[0].status, 'missing');
  assert.equal(one.guide.templateRequirements[0].status, 'missing');
  assert.match(one.actualSummary, /성장 효과 추가/);
  const two = build([memory(STACK, [custom(COUNT), custom(GROW, 2)])]).memories[0];
  assert.equal(two.guide.required[0].status, 'fulfilled');
  assert.equal(two.guide.templateRequirements[0].status, 'fulfilled');
  assert.equal(two.loopReadinessConfirmed, false);
});

test('unknown native IDs or nonexistent count rows remain unknown and no effect is inferred from the ID string', () => {
  const row = build([memory(STACK, [custom(COUNT, 99), custom('fake-growth-action-limit-removal', 1)])]).memories[0];
  assert.equal(row.customizationStatus, 'unknown');
  assert.equal(row.guide.required[0].status, 'unknown');
  for (const actual of row.actualCustomizations) { assert.equal(actual.exactCountKnown, false); assert.deepEqual(actual.effects, []); }
});

test('strength loop needs a verified one-use removal on one role card, not every newly acquired copy', () => {
  const without = build([], { result: result([memory('p_card-03-men-1_050')], 'strength') });
  assert.equal(without.memories[0].guide.required[0].status, 'missing');
  const withLimit = build([], { result: result([memory('p_card-03-men-1_050', [custom(LIMIT)])], 'strength') });
  assert.equal(withLimit.memories[0].guide.required[0].status, 'fulfilled');
  assert.match(withLimit.memories[0].actualSummary, /레슨 중 1회 제한 해제/);
  assert.match(withLimit.memories[0].guide.required[0].note, /복사본 모두/);
  assert.equal(withLimit.memories[0].loopReadinessConfirmed, false);
});

test('an added vitality effect is recognized as the optional native description; cost reduction stays optional', () => {
  const output = build([memory('p_card-03-act-3_065', [custom('p_card_custom-070-g_effect-effect_add-e_effect-exam_block-0009')]),
    memory('p_card-00-men-3_005')]);
  assert.equal(output.memories[0].guide.optional[0].status, 'fulfilled');
  assert.equal(output.memories[0].guide.optional[0].required, false);
  assert.equal(output.memories[1].guide.optional[0].status, 'missing');
  assert.deepEqual(output.memories[1].guide.required, []);
});

test('Asari access exceptions never waive source customization requirements or fabricate unspecified requirements', () => {
  const output = build([memory(), memory('p_card-00-men-2_012')], { options: { eventModeId: 'asari_2026_10_30' } });
  assert.equal(output.context.selectedEventModeId, 'asari_2026_10_30');
  assert.equal(output.context.eventWaivesGuideCustomizationRequirements, false);
  assert.equal(output.memories[0].guide.required[0].status, 'missing');
  assert.equal(output.memories[1].guide.status, 'unknown');
  assert.deepEqual(output.memories[1].guide.required, []);
  assert.equal(output.numericSkillScoreAdded, false);
});

test('CM Misuzu exact paper-confetti customization requires the matching native ID at least twice', () => {
  const idol = catalog.idolCards.find(row => row.gameId === 'i_card-hmsz-3-005');
  const owned = { gameId: idol.gameId, levelLimitRank: 4, potentialRank: 0 };
  const exactId = 'p_card_custom-040_070-g_effect-lesson_depend_block_add-200-g_effect-lesson_depend_block_add-600';
  for (const [customs, expected] of [[[], 'missing'], [[custom(exactId)], 'missing'],
    [[custom(COUNT, 1), custom(GROW, 2)], 'missing'], [[custom(exactId, 2)], 'fulfilled'], [[custom(exactId, 99)], 'unknown']]) {
    const selected = memory('p_card-02-act-2_062', customs, 2);
    const output = buildCustomizationReadiness({ catalog, inventory: { producerLevel: 70, idolCards: [owned], memories: [selected] },
      options: { scenario: 'hif', plan: 'logic', trainingType: 'motivation' },
      result: { selectedIdol: { ...idol, ownershipVerified: true, owned }, memories: [selected],
        scoreSummary: { scenario: 'hif', plan: 'logic', trainingType: 'motivation' } } });
    const guide = output.memories[0].guide, requirement = guide.required[0];
    assert.equal(guide.status, expected);
    assert.equal(requirement.status, expected);
    assert.equal(requirement.targetCustomizationId, exactId);
    assert.equal(requirement.requiredCount, 2);
    assert.ok(requirement.checks.some(check => check.kind === 'exact_customization'));
    if (expected === 'missing') assert.match(output.memories[0].summary, /미충족/);
  }
});

test('a memory reference containing only its GUID gameId joins the inventory without matching a different skill ID', () => {
  const owned = { ...memory(STACK, [custom(COUNT)]), id: 'memory-guid', gameId: 'memory-guid' };
  const output = build([], { result: result([{ gameId: 'memory-guid' }]), inventory: { producerLevel: 70, memories: [owned] } });
  assert.equal(output.memories[0].memoryId, 'memory-guid');
  assert.equal(output.memories[0].gameId, STACK);
  assert.equal(output.memories[0].guide.required[0].status, 'fulfilled');
  assert.deepEqual(build([], { result: result([{}]), inventory: { memories: [owned] } }).memories[0].actualCustomizations, []);
});

test('locked level-80 switch customization is a reference, while eligible access is actionable and unread access stays unknown', () => {
  const input = result([memory(STACK, [custom(COUNT)])]);
  const flight = 'p_card-03-act-3_189';
  input.personalizedPlan = { cardAccess: [{ gameId: flight, normalAcquisition: { eligible: false } }] };
  const output = build([], { result: input });
  assert.equal(output.duringProduce.find(row => row.target.gameId === STACK).currentlyActionable, true);
  assert.equal(output.duringProduce.find(row => row.target.gameId === flight).currentlyActionable, false);
  input.personalizedPlan.cardAccess[0].normalAcquisition.eligible = null;
  assert.equal(build([], { result: input }).duringProduce.find(row => row.target.gameId === flight).currentlyActionable, null);
  input.personalizedPlan.midgamePlan = { acquisitionTargets: [{ gameId: flight, normalAcquisition: { eligible: true } }] };
  assert.equal(build([], { result: input }).duringProduce.find(row => row.target.gameId === flight).currentlyActionable, true);
});

test('current account guide selection chooses a real opening +1-attack copy and exposes absent late growth', () => {
  const file = new URL('../../outputs/학마스_보유노트/data/inventory.json', import.meta.url);
  if (!fs.existsSync(file)) return;
  const inventory = normalizeSnapshot(JSON.parse(fs.readFileSync(file, 'utf8')), catalog);
  const options = { scenario: 'hif', idolGameId: 'i_card-kllj-3-015', trainingType: 'fullPower', producerLevel: 70,
    activityFocus: 'consult', targetAttribute: 'dance', secondaryAttribute: 'visual', primaryLessonCount: 6,
    lessonPattern: 'even', deckTemplate: '4-2', compareSupportUpgrades: false, sourceSupportMode: 'guide' };
  const recommended = recommend({ catalog, inventory, options });
  recommended.personalizedPlan = buildPersonalizedPlan({ result: recommended, inventory, catalog, options });
  const output = buildCustomizationReadiness({ result: recommended, inventory, catalog, options });
  const row = output.memories.find(row => row.gameId === STACK);
  assert.ok(row); assert.equal(row.phase.code, 1);
  assert.equal(row.guide.required[0].status, 'fulfilled');
  const original = inventory.memories.find(memory => memory.id === row.memoryId);
  assert.ok(original);
  assert.ok((original.raw.produceCard.customizes).some(custom => custom.id === COUNT && custom.customizeCount === 1));
  assert.equal(row.guide.templateRequirements[0].status, 'missing');
  assert.equal(output.duringProduce.find(row => row.target.gameId === STACK).currentlyActionable, true);
  assert.equal(output.duringProduce.find(row => row.target.gameId === 'p_card-03-act-3_189').currentlyActionable, false);
});
