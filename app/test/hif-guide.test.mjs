import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildPersonalizedPlan } from '../lib/personalized-plan.mjs';
import { buildHifRoute } from '../lib/hif-model.mjs';
import { buildHifGuide } from '../lib/hif-guide.mjs';
import { createAppServer } from '../server.mjs';

const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog/', import.meta.url)) });
const china = 'i_card-kcna-3-014';
const lilja = 'i_card-kllj-3-018';
const chorus = 'p_card-01-act-2_001';
const genkiFinisher = 'p_card-02-act-3_039';
const blend = 'pdrink_02-3-007';
const energy = 'pdrink_01-3-004';
const coffee = 'pdrink_02-1-008';
const beforeSwitch = 'p_card-02-men-2_053';
const afterSwitch = 'p_card-02-men-2_111';
const nativeItem = 'yellow_robot_wing';
const ids = rows => rows.map(row => row.gameId);
const supportIds = ['s_card-3-0002','s_card-3-0005','s_card-3-0010','s_card-3-0004','s_card-3-0014'];
const phase = id => id === china ? 'goodConditionTurns' : 'motivation';
const planFor = id => id === china ? 'sense' : 'logic';
const selectedSupport = gameId => ({ gameId, level: 40, levelBasis: 'current' });
const dayActivity = (guide, week, activity = 'supply_gift') =>
  guide.days.find(day => day.week === week).activities.find(row => row.activity === activity);
const deckCard = (guide, id) => Object.values(guide.deck.groups).flat().find(row => row.gameId === id);

function fixture(id, level, { memories = [], switchSettings, desiredSkillIds, rental = 's_card-3-0070' } = {}) {
  const selectedIdol = { ...catalog.idolCards.find(row => row.gameId === id), ownershipVerified: true, owned: { uncap: 4, potentialRank: 0 } };
  const options = { scenario: 'hif', producerLevel: level, skillCardSwitchSettings: switchSettings, desiredSkillIds };
  const hifModel = buildHifRoute(catalog, 'visual', { producerLevel: level, activityFocus: 'supply_gift' });
  hifModel.supportActionPlan = { peakScenario: { scenarioItem: { id: nativeItem } } };
  hifModel.fixedDeckPolicyComparison = { policiesCompared: 322 };
  const result = { selectedIdol, memories: [], supports: [...supportIds.map(selectedSupport), { ...selectedSupport(rental), isRental: true }],
    scoreSummary: { scenario: 'hif', plan: planFor(id), trainingType: phase(id), hifModel } };
  result.personalizedPlan = buildPersonalizedPlan({ result, inventory: {}, catalog, options });
  for (const [gameId, timing, obtainable = true, customizes = []] of memories) {
    result.personalizedPlan.memoryStages[timing].push({ gameId, obtainable, upgradeCount: 1, customizes });
  }
  return buildHifGuide({ result, options, catalog });
}

test('the same HIF date and activity give different China and Garakuta Lilja cards and drinks', () => {
  const chinaGuide = fixture(china, 72), liljaGuide = fixture(lilja, 72);
  const chinaGift = dayActivity(chinaGuide, 1), liljaGift = dayActivity(liljaGuide, 1);
  assert.equal(chinaGift.cards[0].gameId, chorus);
  assert.equal(liljaGift.cards[0].gameId, genkiFinisher);
  assert.equal(chinaGift.drinks[0].gameId, energy);
  assert.equal(liljaGift.drinks[0].gameId, blend);
  assert.notDeepEqual(ids(chinaGift.cards), ids(liljaGift.cards));
  assert.notDeepEqual(ids(chinaGift.drinks), ids(liljaGift.drinks));
  assert.notDeepEqual(ids(dayActivity(chinaGuide, 3, 'class_vo').cards), ids(dayActivity(liljaGuide, 3, 'class_vo').cards));
  assert.notDeepEqual(ids(dayActivity(chinaGuide, 23).drinks), ids(dayActivity(liljaGuide, 23).drinks));
  for (const candidate of [...liljaGift.cards, ...liljaGift.drinks]) {
    assert.ok(candidate.nameKo && candidate.imageId.startsWith('img_general_') && candidate.reason);
    assert.equal(candidate.availability, 'if_offered');
  }
  assert.equal(liljaGift.drinks[0].imageId, 'img_general_pdrink_3-007');
  assert.equal(liljaGift.cards[0].imageId, 'img_general_skillcard_act-3_039');
  assert.equal(liljaGuide.days.length, 29);
  assert.deepEqual(liljaGuide.days.slice(-3).map(day => [day.week, day.displayDay, day.eventPhase]), [
    [27, 7, 'round_1'], [28, 7, 'interval'], [29, 7, 'round_2'],
  ]);
  assert.ok(!JSON.stringify(liljaGuide.itemPath).includes('322'));
});

test('PLv, rarity, switch selection and the venue rule constrain day-specific offers', () => {
  const low = fixture(lilja, 14);
  const gift = dayActivity(low, 1);
  assert.ok(ids(gift.cards).includes('p_card-02-act-1_004'));
  assert.ok(!ids(gift.cards).includes(genkiFinisher));
  assert.ok(!ids(gift.drinks).includes(blend));
  assert.deepEqual(ids(gift.drinks), ['pdrink_00-3-001','pdrink_00-2-004','pdrink_00-2-001']);
  assert.ok(gift.drinks.every(row => row.rarity !== 'R'));
  assert.ok(ids(dayActivity(low, 1, 'consult').drinks).includes(coffee));
  const cheapCard = dayActivity(low, 1, 'consult').cards.find(row => row.gameId === 'p_card-02-act-1_004');
  assert.deepEqual(cheapCard.upgradeCounts, [1]);
  const middle = fixture(lilja, 56, { switchSettings: { [afterSwitch]: true } });
  assert.ok(ids(dayActivity(middle, 1).cards).includes(beforeSwitch));
  assert.ok(!ids(dayActivity(middle, 1).cards).includes(afterSwitch));
  const high = fixture(lilja, 57, { switchSettings: { [afterSwitch]: true } });
  assert.ok(!ids(dayActivity(high, 1).cards).includes(beforeSwitch));
  assert.ok(ids(dayActivity(high, 1).cards).includes(afterSwitch));
  assert.equal(dayActivity(high, 3, 'class_vo').operation, 'acquire');
  assert.ok(dayActivity(high, 3, 'class_vo').cards.every(row => row.upgradeCounts[0] === 0));
  assert.equal(dayActivity(high, 10, 'class_vo').operation, 'change');
  assert.deepEqual(dayActivity(high, 10, 'class_vo').drinks, []);
});

test('confirmed carry by the target exam suppresses picks while a late or uncertain receipt stays distinct', () => {
  const opening = fixture(china, 32, { memories: [[chorus, 'atStart']] });
  assert.ok(!ids(dayActivity(opening, 1).cards).includes(chorus));
  assert.equal(deckCard(opening, chorus).acquisition.status, 'memory');
  assert.equal(deckCard(opening, chorus).acquisition.source.firstExam.id, 'selection-1');
  assert.equal(deckCard(opening, chorus).upgradeCount, 1);
  const late = fixture(china, 72, { memories: [[chorus, 'afterMid']] });
  assert.equal(deckCard(late, chorus).acquisition.status, 'joins_after_deadline');
  assert.equal(deckCard(late, chorus).acquisition.source.firstExam.id, 'selection-2');
  assert.ok(!ids(dayActivity(late, 1).cards).includes(chorus));
  const settledLilja = fixture(lilja, 72, { memories: [[genkiFinisher, 'afterMid']] });
  assert.equal(deckCard(settledLilja, genkiFinisher).availableByDeadline, true);
  assert.ok(!ids(dayActivity(settledLilja, 1).cards).includes(genkiFinisher));
  assert.ok(ids(dayActivity(settledLilja, 1).cards).includes('p_card-02-act-1_004'));
  const uncertain = fixture(lilja, 72, { memories: [[genkiFinisher, 'atStart', null]] });
  assert.equal(deckCard(uncertain, genkiFinisher).acquisition.status, 'if_offered');
  assert.ok(ids(dayActivity(uncertain, 1).cards).includes(genkiFinisher));
});

test('customization requires a feasible upgrade and an open slot before the target exam', () => {
  const prepared = fixture(lilja, 72);
  const finisher = deckCard(prepared, genkiFinisher);
  assert.ok(finisher.enhancement.availableWeeksBeforeDeadline.includes(5));
  assert.ok(finisher.customization.availableWeeksBeforeDeadline.includes(12));
  assert.ok(!finisher.customization.availableWeeksBeforeDeadline.includes(1));
  assert.equal(finisher.customization.nextPrice, 100);
  assert.equal(deckCard(fixture(lilja, 43), genkiFinisher), undefined);
  const id='p_card_custom-100-g_effect-lesson_depend_block_add-1000';
  const full=fixture(lilja,72,{memories:[[genkiFinisher,'atStart',true,[{id,customizeCount:1,exactCountKnown:true}]]]});
  assert.equal(deckCard(full,genkiFinisher).customization.nextPrice,null);
  const unknown=fixture(lilja,72,{memories:[[genkiFinisher,'atStart',true,[{id,customizeCount:null,exactCountKnown:false}]]]});
  assert.equal(deckCard(unknown,genkiFinisher).customization.nextPrice,null);
});

test('the Lilja skip tip requires both exact cards in the opening deck', () => {
  const ao='p_card-02-men-1_031', first='p_card-02-men-2_004';
  const both=fixture(lilja,72,{memories:[[first,'atStart'],[beforeSwitch,'atStart']]});
  assert.match(deckCard(both,ao).skipPick,/선발 1 시작 덱.*두근거림.*흘러넘치는 마음.*에이에이오!/);
  assert.ok(ids(both.deck.groups.alternatives).includes(ao));
  assert.ok(!ids(dayActivity(both,1).cards).includes(ao));
  const late=fixture(lilja,72,{memories:[[first,'atStart'],[beforeSwitch,'afterMid']]});
  assert.equal(deckCard(late,ao).skipPick,null);
  const pinned=fixture(lilja,72,{memories:[[first,'atStart'],[beforeSwitch,'atStart']],desiredSkillIds:[ao]});
  assert.ok(ids(dayActivity(pinned,1).cards).includes(ao));
});

test('same route and idol candidates survive changing only the equipped sixth support', () => {
  const receipt = fixture(china, 72, { rental: 's_card-3-0070' });
  const exchange = fixture(china, 72, { rental: 's_card-3-0027' });
  const neither = fixture(china, 72, { rental: 's_card-3-0008' });
  const kinds = guide => guide.supports.at(-1).triggers.map(row => row.kind);
  assert.deepEqual(receipt.days, exchange.days);
  assert.deepEqual(receipt.days, neither.days);
  assert.deepEqual(receipt.supports.slice(0, 5), exchange.supports.slice(0, 5));
  assert.ok(kinds(receipt).includes('p_drink_acquire'));
  assert.ok(kinds(exchange).includes('p_drink_exchange'));
  assert.ok(!kinds(neither).some(kind => kind === 'p_drink_acquire' || kind === 'p_drink_exchange'));
});

test('normal recommendation API returns both profiles and retains the China deck response', { timeout: 90000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gakumas-hif-guide-'));
  const supportCards = ['visual', 'dance'].flatMap(attribute => catalog.supportCards.filter(row =>
    row.attribute === attribute && row.plan === 'free' && row.rarity === 'SSR' &&
    !row.characterIds?.some(id => ['kcna', 'kllj'].includes(id))).slice(0, 4));
  const server = createAppServer({ snapshotPath: path.join(directory, 'inventory.json'), catalog: { ...catalog, supportCards } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const lists = {
    userIdolCardList: [china, lilja].map(id => ({ idolCardId: id, levelLimitRank: 4, potentialRank: 0 })),
    userSupportCardList: supportCards.map(row => ({ supportCardId: row.gameId, level: 1, levelLimitRank: 0 })),
    userCharacterList: [], userMemoryList: [],
  };
  try {
    const imported = await post('/api/import', {
      schemaVersion: 1, producerLevel: 72, capturedAt: '2026-11-23T00:00:00Z', ...lists,
      capture: { collections: Object.fromEntries(Object.entries(lists).map(([name, rows]) =>
        [name, { status: 'complete', expectedCount: rows.length, exportedCount: rows.length }])) },
    });
    assert.equal(imported.status, 200);
    for (const idolId of [china, lilja]) {
      const response = await post('/api/recommend', { scenario: 'hif', idolId, type: phase(idolId), targetAttribute: 'visual',
        secondaryAttribute: 'dance', activityFocus: 'supply_gift', hifConsultPlan: 'none', hifScenarioItemPath: nativeItem,
        deckTemplate: '3-3', supportLevelMode: 'current', sourceSupportMode: 'unrestricted' });
      const body = await response.json();
      assert.equal(response.status, 200, body.error);
      assert.equal(body.selectedIdol.gameId, idolId);
      assert.equal(body.hifGuide.itemPath.id, nativeItem);
      assert.equal(body.hifGuide.producerLevel, 72);
      assert.equal(body.hifGuide.supports.length, 6);
      assert.deepEqual(ids(body.hifGuide.supports), ids(body.supports));
      assert.equal(dayActivity(body.hifGuide, 1).drinks[0].gameId, idolId === china ? energy : blend);
      if (idolId === china) assert.ok(body.recommendedDeck.views.pending.groups.core.length);
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), os.tmpdir());
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 4 });
  }
});
