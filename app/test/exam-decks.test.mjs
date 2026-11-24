import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildSkillAdviceOptions } from '../lib/skill-advice.mjs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const deckGuides = JSON.parse(read('../data/catalog/deck_guides.json'));
const skillAdvice = JSON.parse(read('../data/catalog/skill_card_advice.json'));
const options = buildSkillAdviceOptions({catalog:{deckGuides, skillAdvice}});
const ui = vm.createContext({ array: value => Array.isArray(value) ? value : [], escapeHtml: String });
vm.runInContext(read('../web/exam-decks.js'), ui);

test('each exam walkthrough has distinct steps, resolvable card families and a cited source', () => {
  const cards = new Set(skillAdvice.cards.filter(card => card.gameId).map(card => card.gameId));
  for (const guide of options.examDecks) {
    assert.ok(guide.conditions.length && guide.sourceIds.length);
    assert.ok(guide.sourceIds.every(id => options.examDeckSources.some(source => source.id === id && source.url)));
    assert.ok(guide.examFlow.fallback && guide.examFlow.steps.length >= 3);
    const ids = guide.examFlow.steps.flatMap(step => step.cardIds);
    assert.ok(ids.length && ids.every(id => cards.has(id)), guide.id);
    for (const id of guide.examFlow.requiredSwitchIds ?? []) {
      assert.ok(ids.includes(id));
      assert.ok(options.cards.find(card => card.gameId === id)?.unlock?.conversionProducerLevel > 0);
    }
  }
});

test('the PLv80 card is linked by game ID even when its PLv11 partner has the same Korean name', () => {
  const context = { scenario:'hif', trainingType:'fullPower', strategy:'general', producerLevel:71 };
  const match = id => ui.matchingExamDecks(options.examDecks, id, context, 'anomaly');
  assert.equal(match('p_card-03-act-3_057').length, 0);
  const [guide] = match('p_card-03-act-3_189');
  assert.equal(guide.id, 'deck-hif-anomaly_full_power');
  assert.match(ui.examSwitchNote(guide.examFlow, context, options.cards), /현재 PLv 71.*PLv80/);
  assert.match(ui.examFlowMarkup(guide,'p_card-03-act-3_189'), /이 카드를 쓰는 단계/);
});

test('exact difficulty, deck strategy and chosen Legend card constrain walkthroughs', () => {
  const match = (context, cardId, plan) => ui.matchingExamDecks(options.examDecks, cardId, context, plan).map(row => row.id).join(',');
  const nia = { scenario:'nia', difficulty:'pro', trainingType:'fullPower', strategy:'outing' };
  assert.equal(match(nia, 'p_card-03-act-3_053', 'anomaly'), 'deck-nia-pro-fullpower');
  assert.equal(match({...nia,difficulty:'master'}, 'p_card-03-act-3_053', 'anomaly'), '');
  assert.equal(match({...nia,difficulty:'master',strategy:'inflation'}, 'p_card-03-act-3_053', 'anomaly'), 'deck-nia-fullpower');
  const legend = { scenario:'hajime', difficulty:'legend', trainingType:'strength', legendCardGameId:'unrelated' };
  assert.equal(match(legend, 'p_card-03-act-100_013', 'anomaly'), '');
  assert.equal(match({...legend, legendCardGameId:'p_card-03-act-100_013'}, 'p_card-03-act-100_013', 'anomaly'), 'deck-hajime-strength');
});
