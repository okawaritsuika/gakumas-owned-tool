import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLiveSupports, supportTables } from '../lib/live-supports.mjs';
import { recommend } from '../lib/recommend.mjs';
import { calculateHifSupport } from '../lib/hif-model.mjs';
import { evaluateSupportItemValue } from '../lib/support-item-value.mjs';

const currentId = 's_card-3-9915', nextId = 's_card-3-9916', futureId = 's_card-3-9917';
const triggerId = 'p_trigger-produce_start-initial', phase = 'ProducePhaseType_ProduceStart';
const currentTime = 1_800_000_000_000;
const fixed = (id, type, amount) => ({ id, produceEffectType: 'ProduceEffectType_' + type, effectValueMin: amount, effectValueMax: amount });
const source = (gameId, release = 0) => ({ id: gameId, name: gameId + ' JP', assetId: 'csprt-' + gameId.slice(7),
  characterIds: ['future'], viewStartTime: String(release), type: 'SupportCardType_Vocal', rarity: 'SupportCardRarity_Ssr',
  planType: 'ProducePlanType_Plan2', supportCardLevelLimitId: 'ssr-limits' });

function fixture() {
  const reference = { id: 'reference', gameId: 'reference', name: '기존', attribute: 'visual', plan: 'free', rarity: 'SSR',
    maxLevels: { 0: 40, 4: 60 }, events: [{ release: 'initial', effect_type: 'param_boost', param_type: 'vocal', param_value: 1 }],
    levelAbilities: [{ order: 1, level: 1, skillId: 'another-skill-id', kind: 'initial_stat', activationLimit: 1,
      effects: [{ type: 'ProduceEffectType_DanceAddition', min: 10, max: 10, triggerId, phase, ratePermil: 0 }] }] };
  const catalog = { supportCards: [reference], indices: { supportCards: { reference } }, idolCards: [], skillCards: [],
    memoryAbilities: [], calculationModels: {}, excelPresets: [], pItems: [] };
  const tables = Object.fromEntries(supportTables.map(name => [name, []]));
  tables.SupportCard = [source(currentId), source(nextId), source(futureId, currentTime + 1)];
  tables.SupportCardLevelLimit = [0, 1, 2, 3, 4].map(rank => ({ id: 'ssr-limits',
    rank: 'SupportCardLevelLimitRank_' + (rank ? '_' + rank : 'Unknown'), levelLimit: 40 + 5 * rank }));
  tables.ProduceTrigger = [{ id: triggerId, phaseType: phase }];
  for (let level = 1; level <= 2; level++) {
    const effect = fixed('fixed-' + level, 'VocalAddition', 7 * level);
    tables.ProduceEffect.push(effect);
    tables.ProduceSkill.push({ id: 'new-skill', level, planType: 'ProducePlanType_Common', produceType: 'ProduceType_Unknown',
      produceSplitType: 'ProduceSplitType_Unknown', activationCount: 1, produceEffectId1: effect.id,
      produceTriggerId1: triggerId, activationRatePermil1: 0 });
    for (const card of tables.SupportCard) tables.SupportCardProduceSkillLevelVocal.push({ supportCardId: card.id, order: 1,
      produceSkillId: 'new-skill', produceSkillLevel: level, supportCardLevel: level === 1 ? 1 : 20 });
  }
  return { catalog, tables };
}

test('the next support joins both recommendation paths at the owned level and native cap', () => {
  const { catalog, tables } = fixture(), anchor = structuredClone(catalog.supportCards[0]);
  const translations = { supports: { [currentId]: '신규 서포트' } };
  mergeLiveSupports(catalog, tables, { translations, now: currentTime });
  assert.deepEqual(catalog.supportCards[0], anchor);
  assert.equal(catalog.indices.supportCards[currentId].name, '신규 서포트');
  assert.equal(catalog.indices.supportCards[nextId].name, nextId + ' JP');
  assert.equal(catalog.indices.supportCards[futureId], undefined);
  assert.equal(catalog.indices.supportCards[nextId].maxLevels[4], 60);
  for (const scenario of ['nia', 'hif']) {
    const inventory = { supportCards: [{ gameId: nextId, level: 19, uncap: 0 }] };
    const options = { scenario, rentalGameId: 'reference', plan: 'logic', targetAttribute: 'vocal', supportLevelMode: 'current' };
    const result = recommend({ catalog, inventory, options }).supports.owned[0];
    assert.equal(result.gameId, nextId);
    assert.equal(result.level, 19);
    assert.equal(result.statContribution.vocal, 7);
    assert.ok(!recommend({ catalog, inventory, options: { ...options, plan: 'sense' } }).supports.owned.some(card => card.gameId === nextId));
    inventory.supportCards[0].level = 20;
    assert.equal(recommend({ catalog, inventory, options }).supports.owned[0].statContribution.vocal, 14);
  }
  tables.ProduceEffect[1].effectValueMin = tables.ProduceEffect[1].effectValueMax = 18;
  mergeLiveSupports(catalog, tables, { translations, now: currentTime });
  assert.equal(catalog.supportCards.filter(card => card.gameId === nextId).length, 1);
  assert.equal(catalog.indices.supportCards[nextId].levelAbilities[1].effects[0].min, 18);
});

test('a new or chance-based trigger remains unscored while preserving its raw quantities', () => {
  const { catalog, tables } = fixture();
  tables.ProduceSkill[0].activationRatePermil1 = 200;
  tables.ProduceSkill[1].produceTriggerId1 = 'p_trigger-produce_start-unverified-condition';
  tables.ProduceTrigger.push({ id: tables.ProduceSkill[1].produceTriggerId1, phaseType: phase });
  mergeLiveSupports(catalog, tables, { now: currentTime });
  const card = catalog.indices.supportCards[currentId];
  for (const ability of card.levelAbilities) {
    assert.equal(ability.effects[0].min, null);
    assert.ok(ability.effects[0].nativeMin > 0);
    const result = calculateHifSupport(card, [ability], 30, { perAxis: {}, counts: { initial_stat: 1 }, parameterBonusRows: [] }, 'logic');
    assert.equal(result.fixedStats.vocal, 0);
    assert.ok(result.unscored.length > 0);
  }
});

test('HIF auto compares owned live cards outside an exact guide while respecting manual pool choices', () => {
  const { catalog, tables } = fixture();
  mergeLiveSupports(catalog, tables, { now: currentTime });
  const target = { gameId: 'target', name: '대상', plan: 'logic', characterId: 'new', uniqueIds: {},
    baseStats: { baseVoDaVi: { vo: 60, da: 60, vi: 60 }, growthRatePermil: { vo: 0, da: 0, vi: 0 } } };
  catalog.idolCards.push(target);
  const profile = { id: 'author', scenario: 'hif', idolGameId: target.gameId, plan: 'logic',
    idealSupports: [{ gameId: 'reference', attribute: 'visual' }], alternativeSupports: [] };
  catalog.guideSupportProfiles = { profiles: [profile], sources: [] };
  const base = { scenario: 'hif', plan: 'logic', idolGameId: target.gameId, targetAttribute: 'vocal',
    secondaryAttribute: 'visual', classAttribute: 'dance', supportLevelMode: 'current', rentalGameId: 'reference' };
  const valid = { gameId: currentId, level: 19, uncap: 0 };
  const run = (supportCards, mode) => recommend({ catalog, inventory: { supportCards,
    idolCards: [{ gameId: 'target', levelLimitRank: 0, potentialRank: 0 }] }, options: { ...base, sourceSupportMode: mode } });
  const auto = run([valid]);
  assert.equal(auto.sourceGuideEvidence.mode, 'unrestricted');
  assert.deepEqual(auto.sourceGuideEvidence.automaticPoolExpansion.gameIds, [currentId]);
  assert.ok(auto.warnings.includes(auto.sourceGuideEvidence.automaticPoolExpansion.message));
  assert.ok(auto.supports.owned.some(card => card.gameId === currentId && card.level === 19));
  const manual = run([valid], 'guide');
  assert.equal(manual.sourceGuideEvidence.mode, 'guide');
  assert.equal(manual.sourceGuideEvidence.automaticPoolExpansion, null);
  assert.ok(!manual.supports.owned.some(card => card.gameId === currentId));
  assert.equal(run([valid], 'unrestricted').sourceGuideEvidence.automaticPoolExpansion, null);
  assert.equal(run([]).sourceGuideEvidence.mode, 'guide');
  assert.equal(run([{ ...valid, level: 41 }], 'auto').sourceGuideEvidence.mode, 'guide');
  catalog.indices.supportCards[currentId].plan = 'sense';
  assert.equal(run([valid]).sourceGuideEvidence.mode, 'guide');
  catalog.indices.supportCards[currentId].plan = 'logic';
  profile.alternativeSupports.push({ gameId: currentId, attribute: 'vocal' });
  assert.equal(run([valid]).sourceGuideEvidence.mode, 'guide');
});

test('item stories use their actual level, acquired card plan, pre-action stat and produce-wide limit', () => {
  const { catalog, tables } = fixture();
  const itemId = 'new-item', itemTrigger = 'p_trigger-get_produce_card-0000_0000-p_card_search-plan2-deck_all-vocal-0900_0000';
  tables.ProduceTrigger.push({ id: itemTrigger, phaseType: 'ProducePhaseType_GetProduceCard' });
  tables.ProduceEffect.push(fixed('add25', 'VocalAddition', 25),
    { ...fixed('grant', 'ProduceReward', 1), produceRewards: [{ resourceType: 'ProduceResourceType_ProduceItem', resourceId: itemId, resourceLevel: 0 }] });
  tables.ProduceItem.push({ id: itemId, originSupportCardId: currentId, name: '신규 P아이템', rarity: 'ProduceItemRarity_Ssr', isUpgraded: false,
    isExamEffect: false, fireLimit: 2, fireInterval: 0, produceTriggerId: itemTrigger, produceTriggerIds: [],
    skills: [{ produceTriggerId: '', produceItemEffectId: 'item-effect' }], produceItemEffectIds: ['item-effect'] });
  tables.ProduceItemEffect.push({ id: 'item-effect', effectType: 'ProduceItemEffectType_ProduceEffect', produceEffectId: 'add25' });
  tables.ProduceEventSupportCard.push({ number: 1, supportCardId: currentId, supportCardLevel: 20, produceStepEventDetailId: 'story' });
  tables.ProduceStepEventDetail.push({ id: 'story', supportCardId: currentId, suggestionType: 'ProduceEventSuggestionType_Primary',
    produceEffectIds: ['grant'], produceStepEventSuggestionIds: [] });
  catalog.skillCards = ['free', 'logic', 'sense'].map(plan => ({ gameId: plan, upgradeCount: 0, plan }));
  mergeLiveSupports(catalog, tables, { now: currentTime });
  const card = catalog.indices.supportCards[currentId];
  const acquisitions = ['free','sense','logic','logic','logic','logic'].map((gameId, i) => ({
    action: 'acquire', gameId, week: i + 1, fromExamIndex: 0, statsBefore: { vocal: i === 2 ? 899 : 900 },
  }));
  const options = { supportItemAcquisitions: { [currentId]: { confirmed: true, beforeProduce: true } }, produceActions: acquisitions };
  const evaluate = level => evaluateSupportItemValue({ card, catalog, plan: 'logic', level, options });
  assert.equal(evaluate(19).applied.activationCount, 0);
  assert.equal(evaluate(20).applied.stats.vocal, 50);
  assert.deepEqual(evaluate(20).applied.activations.map(a => a.week), [4, 5]);
  assert.ok(evaluate(20).conditions.some(label => label.includes('로직')));
  options.produceActions = [{ action: 'acquire', week: 1, fromExamIndex: 0, statsBefore: { vocal: 900 } }];
  assert.equal(evaluate(20).applied.activationCount, 0);
  assert.ok(evaluate(20).unscored.some(note => note.includes('플랜 미확인')));
});

test('only the granted skill ID supplies keywords when a different card has the same title', () => {
  const { catalog, tables } = fixture(), id = 'new-skill-card';
  tables.ProduceEventSupportCard.push({ number: 1, supportCardId: nextId, supportCardLevel: 1, produceStepEventDetailId: 'skill-story' });
  tables.ProduceStepEventDetail.push({ id: 'skill-story', supportCardId: nextId, suggestionType: 'ProduceEventSuggestionType_Primary',
    produceEffectIds: ['skill-grant'], produceStepEventSuggestionIds: [] });
  tables.ProduceEffect.push({ ...fixed('skill-grant', 'ProduceReward', 1),
    produceRewards: [{ resourceType: 'ProduceResourceType_ProduceCard', resourceId: id, resourceLevel: 0 }] });
  tables.ProduceCard.push({ id, upgradeCount: 0, name: '同名', category: 'ProduceCardCategory_MentalSkill',
    noDeckDuplication: true, rarity: 'ProduceCardRarity_Ssr', originSupportCardId: nextId });
  catalog.skillCards = [{ gameId: 'different', nameJa: '同名', upgradeCount: 0, effectGroupIds: [] },
    { gameId: id, nameJa: '同名', upgradeCount: 0, effectGroupIds: ['effect_group-visible-exam_lesson_buff-000'] }];
  mergeLiveSupports(catalog, tables, { now: currentTime });
  const card = catalog.indices.supportCards[nextId];
  const result = calculateHifSupport(card, [], 1, { perAxis: {}, counts: {}, parameterBonusRows: [] }, 'logic', { catalog });
  assert.equal(result.providedActions.concentration_card_acquire, 1);
  assert.equal(result.providedActions.m_skill_acquire, 1);
  assert.equal(card.skill_card.gameId, id);
});
