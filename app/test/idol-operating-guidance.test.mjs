import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildIdolOperatingGuidance } from '../lib/idol-operating-guidance.mjs';
import { prepareMultiCreatorGuidance } from '../../work/prepare_multi_creator_guidance.mjs';
import { SkillCards } from '../lib/vendor/gakumas-data/index.js';

const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
catalog.multiCreatorGuidance = JSON.parse(fs.readFileSync(new URL('../data/catalog/multi_creator_guidance.json', import.meta.url), 'utf8'));
const idolId = 'i_card-kllj-3-015';
const options = { idolGameId: idolId, scenario: 'hif', plan: 'anomaly', trainingType: 'fullPower', producerLevel: 70 };
const inventory = { producerLevel: 70, idolCards: [{ gameId: idolId, characterId: 'kllj', levelLimitRank: 3, potentialRank: 0 }] };
const build = extra => buildIdolOperatingGuidance({ catalog, inventory, options, ...extra });

test('the exact owned Atmosphere upgrade and P-item awakening variants are selected independently', () => {
  const result = build();
  assert.equal(result.uniqueSkills.length, 1);
  assert.equal(result.uniqueSkills[0].upgradeCount, 1);
  assert.equal(result.uniqueSkills[0].cost.costValue, 4);
  assert.equal(result.uniqueItems.length, 1);
  assert.equal(result.uniqueItems[0].gameId, 'pitem_03-3-289-0');
  const awakened = build({ inventory: { idolCards: [{ gameId: idolId, levelLimitRank: 0, potentialRank: 2 }] } });
  assert.equal(awakened.uniqueSkills[0].upgradeCount, 0);
  assert.equal(awakened.uniqueSkills[0].cost.costValue, 6);
  assert.equal(awakened.uniqueItems[0].gameId, 'pitem_03-3-289-1');
});

test('unknown ranks keep both variants visible and never silently choose the base variant', () => {
  const result = build({ inventory: { idolCards: [{ gameId: idolId }] } });
  assert.equal(result.selectedIdol.currentVariantConfirmed, false);
  assert.equal(result.uniqueSkills.length, 2);
  assert.equal(result.uniqueItems.length, 2);
  assert.ok(result.uniqueSkills.every(row => row.selectedForCurrentAccount === null));
  assert.ok(result.uniqueItems.every(row => row.variantStatus === 'unknown_current_variant'));
  assert.ok(result.keyActions.every(row => !row.id.startsWith('atmosphere-') && !row.id.startsWith('unique-')));
});

test('Atmosphere separates the skill end-turn <=9 score condition from the item >=10 retrieval condition', () => {
  const result = build();
  const skill = result.uniqueSkills[0], item = result.uniqueItems[0];
  assert.deepEqual(skill.useConditions, []);
  const score = skill.effectSequences.find(row => row.phase === 'endOfTurn');
  assert.deepEqual(score.conditions, ['전력치 9 이하']);
  assert.ok(score.effects[0].includes('누적 전력치'));
  assert.deepEqual(item.effectSequences[0].conditions, ['전력치 10 이상']);
  assert.ok(item.effectSequences[0].effects.some(text => text.includes('보류로 회수')));
  assert.equal(result.keyActions.length, 5);
  assert.ok(result.keyActions.some(row => row.id === 'atmosphere-end-turn-score' && row.text.includes('턴 끝')));
  assert.ok(result.keyActions.some(row => row.id === 'atmosphere-end-turn-retrieve' && row.text.includes('동시에 만족시키지 못')));
  assert.equal(result.keyActionsAreOptimalSequence, false);
});

test('actual grouped play requirements are decoded separately from cost and later effect activation requirements', () => {
  const sumikaId = 'i_card-ssmk-3-002';
  const sumika = build({ options: { ...options, idolGameId: sumikaId }, inventory: { idolCards: [{ gameId: sumikaId, levelLimitRank: 3, potentialRank: 0 }] } });
  const skill = sumika.uniqueSkills.find(row => row.gameId === 'p_card-03-ido-3_084');
  assert.deepEqual(skill.useConditions, ['전력 상태']);
  assert.equal(skill.useConditionsFullyTranslated, true);
  assert.equal(skill.useConditionsRaw[0].conditions[0].name, 'isFullPower');
  assert.equal(skill.useConditionNodesRaw[0].name, 'isFullPower');
  assert.equal(skill.useConditionScope, 'before_card_use_not_cost_or_installed_effect_activation');
  assert.ok(skill.costEffects.length);
  const harunaId = 'i_card-hrnm-3-002';
  const haruna = build({ options: { ...options, idolGameId: harunaId, plan: 'logic', trainingType: 'goodImpressionTurns' }, inventory: { idolCards: [{ gameId: harunaId, levelLimitRank: 3, potentialRank: 0 }] } });
  assert.deepEqual(haruna.uniqueSkills[0].useConditions, ['호인상 1 이상']);
});

test('unknown use-condition wrappers remain explicitly unresolved rather than becoming no-use-restriction', () => {
  const data = structuredClone(catalog.multiCreatorGuidance);
  for (const row of data.uniqueDefinitions.cards.filter(row => row.gameId === 'p_card-03-ido-3_163')) row.publicDefinition.conditions = [{ unsupportedConditionGroup: true }];
  const result = build({ catalog: { ...catalog, multiCreatorGuidance: data } });
  assert.deepEqual(result.uniqueSkills[0].useConditions, ['추가 조건은 원문 확인']);
  assert.equal(result.uniqueSkills[0].useConditionsFullyTranslated, false);
});

test('signed DSL costs display consumption increases and reductions in the correct direction', () => {
  const data = structuredClone(catalog.multiCreatorGuidance);
  const assignment = (lhs, op, value) => ({ type: 'assignment', lhs, op, rhs: { type: 'number', value } });
  for (const row of data.uniqueDefinitions.cards.filter(row => row.gameId === 'p_card-03-ido-3_163')) {
    row.publicDefinition.cost = [{ actions: [assignment('cost', '-=', 4)] }];
    row.publicDefinition.actions = [{ actions: [assignment('g.cost', '-=', 6), assignment('g.cost', '+=', 2), assignment('score', '+=', 10)] }];
    row.publicDefinition.effects = [];
  }
  const result = build({ catalog: { ...catalog, multiCreatorGuidance: data } });
  const skill = result.uniqueSkills[0];
  assert.deepEqual(skill.costEffects[0].effects, ['체력 소비 + 4']);
  assert.deepEqual(skill.effectSequences[0].effects, ['해당 카드의 소비 체력 + 6', '해당 카드의 소비 체력 − 2', '점수 + 10']);
});

test('source PLv71 loop recommendation stays separate from observed PLv78/dearness36 and is future-only at70', () => {
  const result = build();
  const source = result.futureSourceProfiles.find(profile => profile.sourceId === '0GUEH6UnVsg');
  assert.ok(source);
  const requirement = source.requirements.find(row => row.kind === 'source_complete_loop_producer_level');
  assert.equal(requirement.minimum, 71);
  assert.equal(requirement.actual, 70);
  assert.equal(requirement.universalGameUnlock, false);
  assert.equal(source.observedRunContexts[0].producerLevel, 78);
  assert.equal(source.observedRunContexts[0].dearness, 36);
  assert.equal(source.observedRunContexts[0].requiredForEveryRun, false);
  assert.ok(!result.sourceProfiles.some(profile => profile.sourceId === '0GUEH6UnVsg'));
});

test('ordinary HIF source examples do not become a validated Asari recipe', () => {
  const result = build({ options: { ...options, producerLevel: 80, eventModeId: 'asari_2026_10_30' } });
  assert.equal(result.sourceProfiles.length, 0);
  const source = result.conditionalSourceProfiles.find(profile => profile.sourceId === '0GUEH6UnVsg');
  assert.ok(source.requirements.some(row => row.kind === 'event_scope' && row.fulfilled === false));
  assert.equal(source.currentAsariExactRecipeVerified, false);
  assert.equal(result.coverage.currentAsariExactRecipeVerified, false);
});

test('other variants of the same character never receive the exact Atmosphere rules', () => {
  const other = catalog.idolCards.find(card => card.characterId === 'kllj' && card.plan === 'anomaly' && card.gameId !== idolId);
  const result = build({ options: { ...options, idolGameId: other.gameId, producerLevel: 80 }, inventory: { idolCards: [{ gameId: other.gameId, levelLimitRank: 3, potentialRank: 0 }] } });
  const source = result.sourceProfiles.find(profile => profile.sourceId === '0GUEH6UnVsg');
  assert.ok(source.rules.every(rule => !rule.idolIds.length || rule.idolIds.includes(other.gameId)));
  assert.equal(source.exactIdolSpecificRuleCount, 0);
  assert.ok(!result.keyActions.some(action => action.id.startsWith('atmosphere-')));
});

test('unowned exact idol source examples remain future references and do not apply to another Mao variant', () => {
  const result = build({ options: { ...options, idolGameId: 'i_card-amao-3-015', plan: 'sense', trainingType: 'goodConditionTurns', producerLevel: 80 }, inventory: { idolCards: [] } });
  assert.equal(result.selectedIdol.ownershipVerified, false);
  const source = result.futureSourceProfiles.find(profile => profile.sourceId === 'P9v55xvsfoE');
  assert.ok(source);
  assert.ok(source.requirements.some(row => row.kind === 'owned_idol' && row.fulfilled === false));
});

test('NIA master rules stay out of HIF and unknown/other NIA difficulty does not fulfill master scope', () => {
  const hif = build();
  assert.ok(hif.notApplicableProfiles.some(row => row.id === 'creator-FIfJtOrCCrg' && row.reason === 'scenario_mismatch'));
  const unknown = build({ options: { ...options, scenario: 'nia' } });
  assert.ok(unknown.conditionalSourceProfiles.find(profile => profile.sourceId === 'FIfJtOrCCrg').requirements.some(row => row.kind === 'difficulty' && row.fulfilled === null));
  const master = build({ options: { ...options, scenario: 'nia', difficulty: 'master' } });
  assert.ok(master.sourceProfiles.some(profile => profile.sourceId === 'FIfJtOrCCrg'));
  assert.ok(master.sourceProfiles.every(profile => profile.scenario === 'nia'));
  const pro = build({ options: { ...options, scenario: 'nia', difficulty: 'pro' } });
  assert.ok(pro.notApplicableProfiles.some(row => row.id === 'creator-FIfJtOrCCrg' && row.reason === 'difficulty_mismatch'));
});

test('a missing effect identity does not borrow a similarly named effect definition', () => {
  const data = structuredClone(catalog.multiCreatorGuidance);
  for (const row of data.uniqueDefinitions.cards.filter(row => row.gameId === 'p_card-03-ido-3_163')) row.publicDefinitionIdentityVerified = false;
  const result = build({ catalog: { ...catalog, multiCreatorGuidance: data } });
  assert.deepEqual(result.uniqueSkills[0].effectSequences, []);
  assert.equal(result.uniqueSkills[0].effectDefinitionIdentityVerified, false);
  assert.ok(!result.keyActions.some(row => row.id.startsWith('atmosphere-')));
});

test('second unique card upgrades follow their own explicit special-training effect', () => {
  const card = catalog.idolCards.find(card => card.uniqueIds.secondProduceCardId && card.specialTrainingStages.some(stage => stage.effectTypes.includes('IdolCardLevelLimitEffectType_SecondProduceCardUpgrade')));
  assert.ok(card);
  const upgradedAt = card.specialTrainingStages.find(stage => stage.effectTypes.includes('IdolCardLevelLimitEffectType_SecondProduceCardUpgrade')).rank;
  const before = build({ options: { ...options, idolGameId: card.gameId }, inventory: { idolCards: [{ gameId: card.gameId, levelLimitRank: upgradedAt - 1, potentialRank: 0 }] } });
  const after = build({ options: { ...options, idolGameId: card.gameId }, inventory: { idolCards: [{ gameId: card.gameId, levelLimitRank: upgradedAt, potentialRank: 0 }] } });
  assert.equal(before.uniqueSkills.find(row => row.gameId === card.uniqueIds.secondProduceCardId).upgradeCount, 0);
  assert.equal(after.uniqueSkills.find(row => row.gameId === card.uniqueIds.secondProduceCardId).upgradeCount, 1);
});

test('native identity coverage is broad but distinct from video coverage and does not run combat', () => {
  const allOwned = catalog.idolCards.map(card => ({ gameId: card.gameId, characterId: card.characterId, levelLimitRank: 0, potentialRank: 0 }));
  const result = build({ inventory: { idolCards: allOwned } });
  assert.equal(result.coverage.nativeIdolProfiles, 159);
  assert.equal(result.coverage.nativeLinkedOwnedVariants, 159);
  assert.equal(result.coverage.uniqueSkillVariants, 334);
  assert.equal(result.coverage.uniqueItemVariants, 286);
  assert.equal(result.coverage.allOwnedIdolVideosReviewed, false);
  assert.equal(result.battleSimulationExecuted, false);
  assert.equal(result.optimalPlayOrderVerified, false);
  assert.equal(result.existingIonGuidance.notReplacedByThisModule, true);
});

test('missing source data has an explicit unsupported status', () => {
  const result = build({ catalog: { idolCards: catalog.idolCards } });
  assert.equal(result.status, 'source_data_unavailable');
  assert.deepEqual(result.uniqueSkills, []);
});

test('archived September crafting goals stay separate from in-exam actions and preserve exact custom/native HIF limits', () => {
  const result = build({ options: { ...options, eventModeId: 'asari_2026_10_30' } });
  const crafting = result.memoryCraftingAdvice.find(rule => rule.id === 'multi-5-uzsuXxW8U-stack-ideal-memory');
  assert.ok(crafting);
  assert.equal(crafting.sourceApplicability, 'conditional_source_reference');
  assert.equal(crafting.customizationTargets.length, 2);
  assert.ok(crafting.customizationTargets.every(custom => custom.count === 1 && custom.nativeVerified));
  const hif = result.memoryCraftingAdvice.find(rule => rule.id === 'multi-5-uzsuXxW8U-stack-hif-memory');
  assert.equal(hif.abilityTarget.perExamActivationLimit, 2);
  assert.equal(hif.abilityTarget.drawGranted, false);
  assert.ok(Object.values(result.stages).flat().every(rule => rule.purpose !== 'post_produce_memory_crafting'));
});

test('data generation is reproducible from pinned native references and reviewed creator research', () => {
  const research = JSON.parse(fs.readFileSync(new URL('../../work/research/multi_creator_guidance.json', import.meta.url), 'utf8'));
  const supplementalId = 'i_card-kcna-3-019';
  const generated = prepareMultiCreatorGuidance({ catalog: { ...catalog, idolCards: catalog.idolCards.filter(card => card.gameId !== supplementalId) }, research });
  // Compare the pinned October output separately from the later targeted supplement.
  for (const key of ['sources', 'idolProfiles', 'sourceProfiles']) assert.deepEqual(catalog.multiCreatorGuidance[key].slice(0, generated[key].length), generated[key]);
  for (const [key, rows] of Object.entries(generated.uniqueDefinitions)) assert.deepEqual(catalog.multiCreatorGuidance.uniqueDefinitions[key].slice(0, rows.length), rows);
  for (const [key, rows] of Object.entries(generated.nativeUniqueGraph)) assert.deepEqual(catalog.multiCreatorGuidance.nativeUniqueGraph[key].slice(0, rows.length), rows);
  assert.deepEqual(generated.coverage.missingNativeRoots, []);
  assert.equal(generated.coverage.creatorsWithReviewedContent, new Set(research.sources.map(source => source.channelId ?? source.author)).size);
  assert.equal(generated.coverage.videosWithReviewedContent, research.sources.length);
  assert.ok(generated.idolProfiles.every(profile => profile.identityVerified));
  for (const [publicId, nameJa] of [[464, '愛を込めて'], [465, '愛を込めて+'], [729, '夢と現の境界線'], [730, '夢と現の境界線+']]) {
    const row = generated.uniqueDefinitions.cards.find(row => row.publicId === publicId), vendor = SkillCards.getById(publicId);
    assert.equal(row.publicDefinitionIdentityVerified, true);
    assert.equal(row.publicDefinition.name, nameJa);
    const { name: generatedName, ...generatedEffects } = row.publicDefinition;
    const { name: vendorName, ...vendorEffects } = JSON.parse(JSON.stringify(vendor));
    assert.deepEqual(generatedEffects, vendorEffects);
    assert.notEqual(vendorName, generatedName); // The baseline vendor was not overwritten.
  }
  const freshness = JSON.parse(fs.readFileSync(new URL('../data/catalog/data_freshness.json', import.meta.url), 'utf8'));
  assert.equal(freshness.selectivePublicNameCorrections.fullVendorUpdated, false);
});

test('Garakuta Road China uses distinct training ranks for each card and awakening for the P-item', () => {
  const gameId = 'i_card-kcna-3-019';
  const current = build({ inventory: { idolCards: [{ gameId, levelLimitRank: 4, potentialRank: 0 }] }, options: { ...options, idolGameId: gameId } });
  assert.deepEqual(current.uniqueSkills.map(row => [row.upgradeCount, row.cost.forceStamina]), [[1, 0], [0, 8]]);
  assert.equal(current.uniqueItems[0].gameId, 'pitem_03-3-334-0');
  assert.match(current.uniqueItems[0].effectSummaryKo, /직접 체력 소비 1/);
  assert.equal(current.sourceProfiles.filter(row => row.rules.some(rule => rule.idolIds?.includes(gameId))).length, 2);
  const upgraded = build({ inventory: { idolCards: [{ gameId, levelLimitRank: 6, potentialRank: 2 }] }, options: { ...options, idolGameId: gameId } });
  assert.deepEqual(upgraded.uniqueSkills.map(row => [row.upgradeCount, row.cost.forceStamina]), [[1, 0], [1, 5]]);
  assert.equal(upgraded.uniqueItems[0].gameId, 'pitem_03-3-334-1');
  assert.match(upgraded.uniqueItems[0].effectSummaryKo, /기운 \+2/);
});

test('reviewed spelling corrections do not certify a mismatched public upgrade or an unreviewed catalog name', () => {
  const research = JSON.parse(fs.readFileSync(new URL('../../work/research/multi_creator_guidance.json', import.meta.url), 'utf8'));
  const changed = { ...catalog, skillCards: catalog.skillCards.map(card => card.internalId === 464 ? { ...card, internalId: 465 } :
    card.internalId === 729 ? { ...card, nameJa: '未確認の別名' } : card) };
  const generated = prepareMultiCreatorGuidance({ catalog: changed, research });
  assert.equal(generated.uniqueDefinitions.cards.find(row => row.gameId === 'p_card-02-ido-3_086' && row.upgradeCount === 0).publicDefinitionIdentityVerified, false);
  assert.equal(generated.uniqueDefinitions.cards.find(row => row.gameId === 'p_card-02-ido-3_165' && row.upgradeCount === 0).publicDefinitionIdentityVerified, false);
});
