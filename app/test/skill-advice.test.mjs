import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildSkillAdvice, buildSkillAdviceOptions, normalizeSkillAdviceInput } from '../lib/skill-advice.mjs';

let loaded;
const catalog = () => loaded ??= loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog', import.meta.url)) });
const input = extra => ({ scenario: 'hif', trainingType: 'concentration', producerLevel: 80,
  upgradeCount: 1, purpose: 'acquisition', switchState: 'enabled',
  customizationState: 'unknown', hifAbilityState: 'unknown', ...extra });
const advise = (id, extra = {}) => {
  const result = buildSkillAdvice({ catalog: catalog(), input: input({ ...extra, cardIds: [id] }) });
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].id, id);
  return result.cards[0];
};
const adviseWithEvidence = (id, evidence, extra = {}) => {
  const c = catalog();
  return buildSkillAdvice({ catalog: { ...c, skillAdvice: { ...c.skillAdvice, evidence,
    sources: evidence.map(row => ({ id: row.sourceIds[0], url: `https://example.com/${row.sourceIds[0]}` })) } }, input: input({ ...extra, cardIds: [id] }) }).cards[0];
};

test('skill advice validates current PLv and permanent upgrade inputs rather than guessing values', () => {
  const c = { idolCards: [] };
  for (const producerLevel of [-1, 0, 1.5, 91, '75']) {
    assert.throws(() => normalizeSkillAdviceInput({ catalog: c, input: input({ producerLevel }) }),
      error => error.status === 400, `Invalid producerLevel ${producerLevel}`);
  }
  for (const upgradeCount of [-1, 2, 3, 1.5, '1']) {
    assert.throws(() => normalizeSkillAdviceInput({ catalog: c, input: input({ upgradeCount }) }),
      error => error.status === 400, `Temporary or invalid upgrade ${upgradeCount}`);
  }
  assert.equal(normalizeSkillAdviceInput({ catalog: c, input: input({ producerLevel: null }) }).producerLevel, null);
  assert.equal(normalizeSkillAdviceInput({ catalog: c, input: input({ producerLevel: 90 }) }).producerLevel, 90);
});

test('skill advice keeps scenario difficulty and typed conditional states explicit', () => {
  const c = { idolCards: [] };
  for (const [scenario, difficulty] of [['hif', null], ['hajime', 'legend'], ['nia', 'master']]) {
    assert.equal(normalizeSkillAdviceInput({ catalog: c, input: input({ scenario }) }).difficulty, difficulty);
  }
  for (const invalid of [
    { scenario: 'other' }, { scenario: 'nia', difficulty: 'legend' },
    { scenario: 'hif', difficulty: 'master' }, { purpose: 'win_probability' },
    { trainingType: 'unknown_type' }, { stage: 'middle_unknown' },
    { customizationState: true }, { hifAbilityState: 'enabled' }, { switchState: 'matched' },
    { acquisitionTimingState: 'enabled' }, { strategy: 'other' }, { scenario: 'hif', strategy: 'inflation' },
    { legendCardGameId: 'not-a-legend-card' },
  ]) {
    assert.throws(() => normalizeSkillAdviceInput({ catalog: c, input: input(invalid) }),
      error => error.status === 400, JSON.stringify(invalid));
  }
});

test('explicit author categories can support a tier without inventing an original letter', () => {
  const id = 'p_card-01-men-2_037';
  const evidence = [{ id: 'category', sourceIds: ['category-source'], subjectGameIds: [id],
    context: { scenario: 'nia', difficulty: 'master', plan: 'sense', trainingType: 'concentration' },
    authorTier: null, authorCategory: '필수', normalizedTier: 'core', comparisonDimension: 'deck_performance', summaryKo: '작성자는 이 덱의 필수 카드로 분류한다.' }];
  const row = adviseWithEvidence(id, evidence, { scenario: 'nia' });
  assert.equal(row.rating.grade, 'S');
  assert.equal(row.rating.authorGrade, null);
  assert.equal(row.rating.guideBasis, 'author_category');
  assert.equal(row.rating.basis, 'guide');
  assert.notEqual(adviseWithEvidence(id, evidence, { scenario: 'nia', purpose: 'upgrade', upgradeCount: 0 }).rating.basis, 'guide');
});

test('an unassessed lower PLv band does not inherit a later band and each source keeps its own scale', () => {
  const id = 'p_card-01-men-2_037';
  const evidence = [{ id: 'bands', sourceIds: ['bands-source'], subjectGameIds: [id],
    context: { scenario: 'hajime', difficulty: 'legend', plan: 'sense', build: 'general', producerLevelUpperLabels: [65, 80] },
    authorRatings: { acquisition: [{ maxProducerLevel: 65, rating: null }, { maxProducerLevel: 80, rating: 'A' }], concentrationBuild: 'A' },
    authorRatingScale: { A: 'core', B: 'recommended', C: 'situational', D: 'low', E: 'avoid' }, summaryKo: '원문 PLv 열과 유형 열은 별도다.' }];
  const lower = adviseWithEvidence(id, evidence, { scenario: 'hajime', producerLevel: 60 });
  assert.equal(lower.rating.authorGrade, null);
  assert.equal(lower.rating.basis, 'derived');
  const upper = adviseWithEvidence(id, evidence, { scenario: 'hajime', producerLevel: 70 });
  assert.equal(upper.rating.authorGrade, 'A');
  assert.equal(upper.rating.grade, 'S');
  assert.equal(adviseWithEvidence(id, evidence, { scenario: 'hajime', producerLevel: 81 }).rating.authorGrade, null);
  evidence[0].authorRatings.acquisition[0].rating = 'C';
  assert.equal(adviseWithEvidence(id, evidence, { scenario: 'hajime', producerLevel: 60 }).rating.authorGrade, 'C', 'an independent build column must not replace the PLv column');
});

test('NIA inflation and outing evidence stays inside its selected strategy', () => {
  const id = 'p_card-01-men-2_037';
  const make = (strategy, authorTier) => ({ id: strategy, sourceIds: [strategy], subjectGameIds: [id],
    context: { scenario: 'nia', difficulty: 'master', plan: 'sense', trainingType: 'concentration', strategy },
    authorTier, comparisonDimension: 'deck_performance', summaryKo: '선택한 육성 방식의 평가다.' });
  const evidence = [make('inflation', 'S'), make('outing', 'C')];
  assert.equal(adviseWithEvidence(id, evidence, { scenario: 'nia', strategy: 'inflation' }).rating.grade, 'S');
  assert.equal(adviseWithEvidence(id, evidence, { scenario: 'nia', strategy: 'outing' }).rating.grade, 'C');
  assert.equal(adviseWithEvidence(id, evidence, { scenario: 'nia' }).rating.basis, 'derived');
});

test('superseded same-source rows remain provenance and cannot win an assessment', () => {
  const id = 'p_card-01-men-2_037';
  const old = { id: 'old', sourceIds: ['review'], subjectGameIds: [id],
    context: { scenario: 'hif', plan: 'sense', trainingType: 'concentration' }, authorTier: 'S',
    comparisonDimension: 'deck_performance', summaryKo: '보존한 과거 기록.', supersededByEvidenceId: 'replacement' };
  const replacement = { ...old, id: 'replacement', authorTier: 'A', supersededByEvidenceId: undefined };
  const otherAuthor = { ...replacement, id: 'other', sourceIds: ['other-author'], authorTier: 'B' };
  const row = adviseWithEvidence(id, [old, replacement, otherAuthor]);
  assert.equal(row.rating.grade, 'A');
  assert.deepEqual(row.rating.guideAssessments.map(value => value.evidenceId), ['replacement', 'other']);
  const previous = row.evidence.find(value => value.id === old.id);
  assert.ok(previous);
  assert.equal(previous.appliedToRating, false);
  assert.equal(previous.supersededByEvidenceId, replacement.id);
});

test('re-reviewed stack import grades do not escape the NIA inflation or Legend Star route', () => {
  const id = 'p_card-03-act-1_042';
  const recipe = { trainingType: 'fullPower', purpose: 'memory', customizationState: 'matched', acquisitionTimingState: 'opening' };
  for (const strategy of ['general', 'outing']) {
    const row = advise(id, { ...recipe, scenario: 'nia', difficulty: 'master', strategy });
    assert.equal(row.rating.basis, 'derived', strategy);
    assert.ok(!row.rating.guideAssessments.some(value => value.evidenceId === 'tier-review-morishi-28-stack-memory'));
  }
  const otherLegends = catalog().skillAdvice.cards.filter(card => card.plan === 'anomaly' && card.sourceType === 'produce' && card.status.isLegend && card.gameId !== 'p_card-03-men-100_016');
  assert.ok(otherLegends.length >= 4);
  for (const legend of otherLegends) {
    const row = advise(id, { ...recipe, scenario: 'hajime', difficulty: 'legend', legendCardGameId: legend.gameId });
    assert.equal(row.rating.basis, 'derived', legend.gameId);
  }
  for (const [extra, previousId, replacementId] of [
    [{ scenario: 'nia', difficulty: 'master', strategy: 'inflation' }, 'tier-review-morishi-28-stack-memory', 'nia-review-nia-fullpower-p_card-03-act-1_042'],
    [{ scenario: 'hajime', difficulty: 'legend', legendCardGameId: 'p_card-03-men-100_016' }, 'tier-review-morishi-37-stack-memory', 'legend-review-morishi-37-p_card-03-act-1_042'],
  ]) {
    const row = advise(id, { ...recipe, ...extra });
    assert.equal(row.rating.grade, 'A');
    assert.equal(row.rating.basis, 'guide');
    assert.deepEqual(row.missingConditions, []);
    assert.equal(row.evidence.find(value => value.appliedToRating)?.id, replacementId);
    const previous = catalog().skillAdvice.evidence.find(value => value.id === previousId);
    assert.equal(previous.supersededByEvidenceId, replacementId);
    assert.ok(previous.sourceLocator);
    assert.equal(row.evidence.find(value => value.id === previousId)?.appliedToRating, false);
  }
  const oldLegend = catalog().skillAdvice.evidence.find(value => value.id === 'tier-review-morishi-37-stack-memory');
  assert.deepEqual(oldLegend.preferredSpecification.otherCustomization, ['성장 2회 또는 성장+비용 감소']);
});

test('stack total two hits requires one rise-count customization, with the 100 PP maximum retained', () => {
  const row = advise('p_card-03-act-1_042', { scenario: 'nia', difficulty: 'master', strategy: 'inflation',
    trainingType: 'fullPower', purpose: 'memory', customizationState: 'matched', acquisitionTimingState: 'opening' });
  assert.ok(row.rating.assessedConditions.some(text => /상승 횟수\+1.*1회.*총 2타/.test(text)));
  assert.ok(row.customizationAdvice.some(text => /상승 횟수\+1.*1회.*총 2타/.test(text)));
  assert.ok([...row.rating.assessedConditions, ...row.customizationAdvice, ...row.reasons]
    .every(text => !/파라미터.*(?:커스텀 2회|두 번 개조)/.test(text)));
  const option = row.meta.customizationOptions.find(value => value.id === 'p_card_custom-100-g_effect-lesson_count_add-1');
  assert.equal(option.max, 1);
  assert.deepEqual(option.levels.map(value => [value.level, value.price]), [[1, 100]]);
});

test('memory-only recipes cannot lower an acquisition grade or replace the selected recipe requirements', () => {
  const id = 'p_card-01-men-3_006';
  const row = advise(id, { scenario: 'nia', strategy: 'inflation', producerLevel: 80, customizationState: 'none' });
  assert.equal(row.rating.grade, 'S');
  assert.deepEqual(row.missingConditions, []);
  const evidence = [{ id: 'pick', sourceIds: ['pick'], subjectGameIds: [id], context: { scenario: 'hif', plan: 'sense', trainingType: 'concentration' }, authorTier: 'S', comparisonDimension: 'run_acquisition', summaryKo: '도중 획득 S.' },
    { id: 'carry', sourceIds: ['carry'], subjectGameIds: [id], context: { scenario: 'hif', plan: 'sense' }, authorTier: null, comparisonDimension: 'memory_import', requirements: { conditionsKo: ['원기 커스텀'] }, summaryKo: '반입 사양.' }];
  const isolated = adviseWithEvidence(id, evidence, { customizationState: 'none' });
  assert.equal(isolated.rating.grade, 'S');
  assert.deepEqual(isolated.missingConditions, []);
});

test('pre-release card opinions remain provisional and cannot be counted as direct author tier verification', () => {
  const row = advise('p_card-01-men-1_026', { producerLevel: 90 });
  assert.equal(row.rating.guideBasis, 'author_preview');
  assert.equal(row.rating.basis, 'derived');
  assert.equal(row.rating.authorGrade, null);
  assert.equal(row.rating.grade, 'C');
  assert.match(row.rating.gradeNote, /출시 전/);
});

test('legend deck prerequisites are named when unspecified and excluded when a different legend is selected', () => {
  const id = 'p_card-01-men-2_037';
  const [first, second] = catalog().skillAdvice.cards.filter(card => card.plan === 'sense' && card.sourceType === 'produce' && card.status.isLegend);
  const evidence = [{ id: 'legend-route', sourceIds: ['legend-route'], subjectGameIds: [id],
    context: { scenario: 'hajime', difficulty: 'legend', plan: 'sense', trainingType: 'concentration', strategyLegendSkillGameId: first.gameId, strategyLegendSkillNameJa: first.nameJa },
    authorTier: 'S', comparisonDimension: 'deck_performance', summaryKo: '지정 레전드 카드의 경로다.' }];
  const unknown = adviseWithEvidence(id, evidence, { scenario: 'hajime' });
  assert.ok(unknown.missingConditions.some(text => text.includes(first.nameJa)));
  assert.equal(adviseWithEvidence(id, evidence, { scenario: 'hajime', legendCardGameId: first.gameId }).rating.basis, 'guide');
  assert.equal(adviseWithEvidence(id, evidence, { scenario: 'hajime', legendCardGameId: second.gameId }).rating.basis, 'derived');
});

test('specific deck evidence wins over a general opinion and differing guide grades remain visible', () => {
  const id = 'p_card-01-men-2_037';
  const general = { id: 'general', sourceIds: ['general'], subjectGameIds: [id], context: { scenario: 'hif', plan: 'sense' }, authorTier: 'S', comparisonDimension: 'deck_performance', summaryKo: '플랜 일반 의견.' };
  const exact = { ...general, id: 'exact', sourceIds: ['exact'], context: { scenario: 'hif', plan: 'sense', trainingType: 'concentration' }, authorTier: 'B', summaryKo: '집중 덱 의견.' };
  for (const evidence of [[general, exact], [exact, general]]) {
    const row = adviseWithEvidence(id, evidence);
    assert.equal(row.rating.grade, 'B');
    assert.equal(row.rating.guideAssessments.length, 2);
    assert.match(row.rating.gradeNote, /공략별 평가/);
  }
});

test('complete skill options preserve native card families and four unresolved public identities', () => {
  const c = catalog(), options = buildSkillAdviceOptions({ catalog: c });
  assert.equal(c.skillAdvice.cards.length, 472);
  assert.equal(c.skillAdvice.unresolvedCards.length, 4);
  assert.equal(options.cards.length, 476);
  assert.equal(new Set(options.cards.map(card => card.id)).size, 476);
  for (const native of c.skillAdvice.cards) {
    assert.ok(options.cards.some(card => card.gameId === native.gameId), native.gameId);
  }
  for (const unresolved of c.skillAdvice.unresolvedCards) {
    const card = options.cards.find(row => row.id === unresolved.id);
    assert.ok(card);
    assert.equal(card.gameId, null);
  }
});

test('native double and triple upgrades stay temporary and never inherit an unrelated public DSL row', () => {
  const cards = catalog().skillAdvice.cards;
  const variants = cards.flatMap(card => card.variants);
  assert.equal(variants.length, 1801);
  assert.equal(variants.filter(row => row.upgradeCount === 0).length, 472);
  assert.equal(variants.filter(row => row.upgradeCount === 1).length, 443);
  for (const variant of variants) {
    if (variant.upgradeCount >= 2) {
      assert.equal(variant.stateKind, 'lesson_temporary_upgrade');
      assert.equal(variant.dsl, null);
    } else {
      assert.equal(variant.stateKind, variant.upgradeCount === 0 ? 'permanent_base' : 'permanent_upgrade');
    }
  }
  const spotlight = cards.find(card => card.gameId === 'p_card-01-act-3_185');
  assert.equal(spotlight.unlock.rawAcquisitionProducerLevel, 0);
  assert.equal(spotlight.unlock.conversionProducerLevel, 75);
  assert.equal(spotlight.unlock.requiresConversionSelection, true);
});

test('raw PLv zero never unlocks Spotlight before PLv75 or substitutes for switch confirmation', () => {
  const id = 'p_card-01-act-3_185';
  const before = advise(id, { producerLevel: 70 });
  assert.equal(before.eligibility.status, 'blocked');
  assert.notEqual(before.rating.tier, 'core');
  const unknown = advise(id, { producerLevel: 75, switchState: 'unknown' });
  assert.equal(unknown.eligibility.status, 'unknown');
  assert.ok(unknown.eligibility.reasons.length);
  const disabled = advise(id, { producerLevel: 75, switchState: 'disabled' });
  assert.equal(disabled.eligibility.status, 'blocked');
  const enabled = advise(id, { producerLevel: 75, switchState: 'enabled' });
  assert.equal(enabled.eligibility.status, 'eligible');
});

test('normal acquisition and memory carry tiers are evaluated separately', () => {
  const id = 'p_card-01-men-2_037';
  assert.equal(advise(id, { producerLevel: 20, purpose: 'acquisition' }).eligibility.status, 'blocked');
  assert.equal(advise(id, { producerLevel: 20, purpose: 'memory' }).eligibility.status, 'eligible');
  assert.equal(advise(id, { producerLevel: 19, purpose: 'memory' }).eligibility.status, 'blocked');
  assert.equal(advise(id, { producerLevel: null }).eligibility.status, 'unknown');
});

test('the memory PLv comparison names its rental-value basis without claiming an owned-memory game rule', () => {
  const id = 'p_card-01-men-2_037';
  const blocked = advise(id, { producerLevel: 19, purpose: 'memory' });
  assert.equal(blocked.eligibility.status, 'blocked');
  assert.ok(blocked.eligibility.reasons.some(text => /앱의 반입 PLv 비교 기준 미충족/.test(text) && /대여 해금값/.test(text) && /자기 보유.*미확정/.test(text)));
  assert.ok(blocked.eligibility.reasons.every(text => !/해금 전입니다/.test(text)));
  const unknown = advise(id, { producerLevel: null, purpose: 'memory' });
  assert.equal(unknown.eligibility.status, 'unknown');
  assert.ok(unknown.eligibility.reasons.some(text => /앱의 반입 PLv 비교 기준/.test(text) && /자기 보유.*미확정/.test(text)));
  const ordinary = advise(id, { producerLevel: 19, purpose: 'acquisition' });
  assert.ok(ordinary.eligibility.reasons.some(text => /해금 전입니다/.test(text)));
});

test('a different P-idol version cannot make its exclusive skill eligible', () => {
  const c = catalog();
  const native = c.skillAdvice.cards.find(card => card.sourceType === 'pIdol' &&
    !card.status.releaseExcluded && card.origin.idolGameIds.length &&
    c.idolCards.some(idol => card.origin.idolGameIds.includes(idol.gameId)));
  assert.ok(native);
  const other = c.idolCards.find(idol => idol.plan === native.plan &&
    !native.origin.idolGameIds.includes(idol.gameId));
  assert.ok(other);
  const trainingType = { sense: 'concentration', logic: 'motivation', anomaly: 'fullPower' }[native.plan];
  const unknownOwner = advise(native.id, { trainingType });
  assert.notEqual(unknownOwner.eligibility.status, 'eligible');
  const differentOwner = advise(native.id, { trainingType, idolGameId: other.gameId });
  assert.equal(differentOwner.eligibility.status, 'blocked');
});

test('legend acquisition and carry eligibility are not confirmed from presence in the master alone', () => {
  const native = catalog().skillAdvice.cards.find(card => card.sourceType === 'produce' &&
    card.status.isLegend && !card.status.releaseExcluded);
  assert.ok(native);
  const trainingType = { sense: 'concentration', logic: 'motivation', anomaly: 'fullPower' }[native.plan] ?? 'concentration';
  assert.notEqual(advise(native.id, { scenario: 'nia', trainingType }).eligibility.status, 'eligible');
  assert.notEqual(advise(native.id, { scenario: 'hajime', difficulty: 'pro', trainingType }).eligibility.status, 'eligible');
  assert.notEqual(advise(native.id, { purpose: 'memory', trainingType }).eligibility.status, 'eligible');
});

test('a memory guide requiring custom Presence is conditional until that recipe is declared matched', () => {
  const id = 'p_card-01-men-2_037';
  for (const customizationState of ['unknown', 'none']) {
    const row = advise(id, { purpose: 'memory', customizationState });
    assert.equal(row.rating.tier, 'situational');
    assert.equal(row.rating.potentialTier, 'core');
    assert.ok(row.missingConditions.some(text => /커스텀/.test(text)));
    assert.ok(row.customizationAdvice.some(text => /호조/.test(text)));
  }
  assert.equal(advise(id, { purpose: 'memory', customizationState: 'matched' }).rating.tier, 'core');
});

test('letter performance grades stay separate from unconfirmed readiness and keep known missing recipes meaningful', () => {
  const id = 'p_card-01-men-2_037';
  const unknown = advise(id, { purpose: 'memory', customizationState: 'unknown' });
  assert.equal(unknown.rating.grade, 'S');
  assert.equal(unknown.rating.performanceTier, 'core');
  assert.equal(unknown.rating.tier, 'situational');
  assert.ok(unknown.missingConditions.some(text => /커스텀/.test(text)));
  assert.match(unknown.rating.gradeNote, /사용 조건/);
  const withoutRecipe = advise(id, { purpose: 'memory', customizationState: 'none' });
  assert.equal(withoutRecipe.rating.grade, 'B');
  assert.equal(withoutRecipe.rating.potentialGrade, 'S');
  const matched = advise(id, { purpose: 'memory', customizationState: 'matched' });
  assert.equal(matched.rating.grade, 'S');
  assert.equal(matched.rating.performanceTier, 'core');
});

test('a locked but identified card can show a performance grade while an unresolved identity cannot', () => {
  const locked = advise('p_card-01-act-3_185', { purpose: 'memory', producerLevel: 70 });
  assert.equal(locked.rating.grade, 'S');
  assert.equal(locked.eligibility.status, 'blocked');
  assert.equal(locked.rating.tier, 'unrated');
  const unresolved = advise(catalog().skillAdvice.unresolvedCards[0].id, { trainingType: 'fullPower' });
  assert.equal(unresolved.rating.grade, null);
  assert.equal(unresolved.rating.performanceTier, 'unrated');
  const legend = catalog().skillAdvice.cards.find(card => card.sourceType === 'produce' && card.status.isLegend && card.plan === 'sense' && !card.status.releaseExcluded);
  assert.equal(advise(legend.id, { purpose: 'memory' }).rating.grade, null);
  const base = advise('p_card-01-act-2_001', { purpose: 'memory', stage: 'early', upgradeCount: 0 });
  assert.notEqual(base.rating.grade, 'S');
});

test('All-out is S for the documented HIF strength and full-power decks, including ordinary acquisition', () => {
  for (const trainingType of ['strength', 'fullPower']) for (const purpose of ['acquisition', 'memory']) {
    const row = advise('p_card-03-act-3_065', { trainingType, purpose, producerLevel: 70 });
    assert.equal(row.rating.grade, 'S', `${trainingType}:${purpose}`);
    assert.equal(row.rating.basis, 'guide');
    assert.equal(row.rating.authorGrade, 'S');
    assert.equal(row.eligibility.status, 'eligible');
  }
  const upgrade = advise('p_card-03-act-3_065', { trainingType: 'strength', purpose: 'upgrade', upgradeCount: 0 });
  assert.equal(upgrade.rating.grade, 'A');
  assert.equal(upgrade.rating.authorGrade, null, 'deck performance is not an authored upgrade priority');
  assert.ok(upgrade.upgradeAdvice.some(text => /스킬 사용 추가 1회 → 2회/.test(text)));
  const plus = advise('p_card-03-act-3_065', { trainingType: 'strength' });
  assert.ok(plus.effectSummary.includes('카드 드로 3장'));
  assert.ok(plus.effectSummary.includes('스킬 사용 추가 2회'));
  assert.ok(plus.effectSummary.includes('이후 2장의 소비 체력 무효'));
});

test('a different plan keeps its native performance grade and explicitly names the assessment deck', () => {
  const allOut = advise('p_card-03-act-3_065');
  assert.equal(allOut.rating.grade, 'S');
  assert.equal(allOut.eligibility.status, 'blocked');
  assert.deepEqual(allOut.rating.evaluationContext, { plan: 'anomaly', trainingType: 'strength', strategy: 'general', isSelectedType: false });
  assert.match(allOut.rating.gradeNote, /아노말리 · 강기 기준/);
  const stack = advise('p_card-03-act-1_042');
  assert.equal(stack.rating.grade, 'A');
  assert.equal(stack.rating.basis, 'derived');
  assert.deepEqual(stack.rating.evaluationContext, { plan: 'anomaly', trainingType: 'fullPower', strategy: 'general', isSelectedType: false });
  assert.ok(stack.relationships.filter(relation => relation.basis === 'derived').every(relation =>
    relation.cards.every(card => ['free', 'anomaly'].includes(card.plan))));
  const locked = advise('p_card-03-act-3_065', { producerLevel: 49 });
  assert.equal(locked.rating.grade, 'S');
  assert.equal(locked.eligibility.status, 'blocked');
  assert.ok(locked.eligibility.reasons.some(reason => /PLv50/.test(reason)));
  const overdrive = advise('p_card-03-act-2_102');
  assert.equal(overdrive.rating.grade, 'S', 'a resource tag must not hide the documented strength role');
  assert.equal(overdrive.rating.evaluationContext.trainingType, 'strength');
});

test('Stacking has a documented HIF role without inventing an author letter or exporting it to other scenarios', () => {
  const row = advise('p_card-03-act-1_042', { trainingType: 'fullPower' });
  assert.equal(row.rating.grade, 'A');
  assert.equal(row.rating.authorGrade, null);
  assert.ok(row.reasons.some(reason => /반복 공격/.test(reason)));
  assert.notEqual(advise('p_card-03-act-1_042', { trainingType: 'fullPower', scenario: 'nia', purpose: 'acquisition' }).rating.grade, 'S');
});

test('upfront cost alone does not erase draw, extra actions and cost-nullification utility', () => {
  const c = catalog();
  const synthetic = { ...c, skillAdvice: { ...c.skillAdvice, evidence: [] } };
  const row = buildSkillAdvice({ catalog: synthetic, input: input({ trainingType: 'strength', cardIds: ['p_card-03-act-3_065'] }) }).cards[0];
  assert.equal(row.rating.grade, 'A');
  assert.ok(row.reasons.some(reason => /비용 무효·감소/.test(reason)));
});

test('gallery metadata distinguishes ordinary pickups from legend and trouble cards', () => {
  const c = catalog(), options = buildSkillAdviceOptions({ catalog: c });
  for (const native of c.skillAdvice.cards) {
    const row = options.cards.find(card => card.id === native.id);
    assert.equal(row.category, native.category ?? null);
    assert.equal(row.isLegend, Boolean(native.status.isLegend));
  }
  assert.equal(options.cards.find(card => card.id === 'p_card-03-act-1_042').sourceType, 'produce');
  assert.equal(options.cards.find(card => card.id === 'p_card-03-act-1_042').isLegend, false);
});

test('gallery and complementary candidates use real card icons and respect a selected character icon variant', () => {
  const c = catalog();
  const idol = c.idolCards.find(row => row.characterId === 'ttmr' && row.plan === 'sense');
  assert.ok(idol);
  const row = advise('p_card-01-men-2_037', { purpose: 'memory', idolGameId: idol.gameId });
  const known = c.skillCards.find(card => card.gameId === row.gameId && card.upgradeCount === 1);
  assert.equal(row.imageUrl, known.characterIconUrls.ttmr);
  assert.notEqual(row.imageUrl, known.referenceImageUrl);
  for (const relation of row.relationships) for (const card of relation.cards) {
    assert.match(card.imageUrl, /^\/assets\/artwork\//);
    assert.equal(card.thumbnailUrl, card.imageUrl);
  }
  const fallback = advise('p_card-01-act-1_001');
  const complementary = fallback.relationships.find(relation => relation.label === '역할을 보완할 후보');
  assert.ok(complementary?.cards.length);
  assert.ok(complementary.cards.every(card => card.imageUrl?.startsWith('/assets/artwork/')));
});

test('the early Schprehi call specification does not become complete on the base upgrade', () => {
  const row = advise('p_card-01-act-2_001', { purpose: 'memory', stage: 'early', upgradeCount: 0 });
  assert.notEqual(row.rating.tier, 'core');
  assert.ok(row.missingConditions.some(text => /강화/.test(text)));
  assert.ok(row.missingConditions.some(text => /개막/.test(text)));
});

test('opening acquisition confirmation and permanent upgrade independently complete the early memory specification', () => {
  const id = 'p_card-01-act-2_001';
  const base = advise(id, { purpose: 'memory', stage: 'early', upgradeCount: 0, acquisitionTimingState: 'opening' });
  assert.ok(base.missingConditions.some(text => /강화/.test(text)));
  const mid = advise(id, { purpose: 'memory', stage: 'early', upgradeCount: 1, acquisitionTimingState: 'mid' });
  assert.ok(mid.missingConditions.some(text => /개막/.test(text)));
  const complete = advise(id, { purpose: 'memory', stage: 'early', upgradeCount: 1, acquisitionTimingState: 'opening' });
  assert.equal(complete.rating.tier, 'core');
  assert.equal(complete.missingConditions.length, 0);
});

test('cards without a permanent upgrade stay visible under the global upgraded filter using their real base state', () => {
  const row = advise('p_card-00-acc-0_002', { upgradeCount: 1 });
  assert.equal(row.upgradeCount, 0);
  assert.ok(row.upgradeAdvice.some(text => /강화 대상이 아/.test(text)));
  assert.deepEqual(row.meta.temporaryUpgradeCounts, []);
});

test('HIF ability advice changes only under its declared ability condition', () => {
  const id = 'p_card-01-men-2_041';
  const none = advise(id, { hifAbilityState: 'none' });
  const matched = advise(id, { hifAbilityState: 'matched' });
  assert.equal(none.rating.authorGrade, 'B');
  assert.equal(matched.rating.authorGrade, 'B');
  assert.notEqual(matched.rating.tier, none.rating.tier);
  assert.equal(matched.rating.basis, 'guide');
});

test('reviewed HIF tiers follow each deck instead of giving every card a universal letter', () => {
  const mentalFocus = 'p_card-01-men-2_104';
  assert.equal(advise(mentalFocus, { trainingType: 'concentration' }).rating.grade, 'S');
  assert.equal(advise(mentalFocus, { trainingType: 'goodConditionTurns' }).rating.grade, 'D');
  const reach = 'p_card-02-act-3_039';
  assert.equal(advise(reach, { trainingType: 'motivation' }).rating.grade, 'S');
  assert.equal(advise(reach, { trainingType: 'goodImpressionTurns' }).rating.grade, 'D');
  const star = 'p_card-02-men-3_002';
  assert.equal(advise(star, { trainingType: 'motivation', purpose: 'acquisition' }).rating.grade, 'S');
  assert.equal(advise(star, { trainingType: 'motivation', purpose: 'memory' }).rating.grade, 'A');
  const position = advise('p_card-01-act-2_059', { trainingType: 'goodConditionTurns', purpose: 'memory' });
  assert.equal(position.rating.grade, 'S', 'an exception for some idol uniques must not lower every memory');
});

test('a source requiring two HIF tier steps moves C to A only after the matching ability is confirmed', () => {
  const id = 'p_card-02-men-2_008', trainingType = 'goodImpressionTurns';
  for (const hifAbilityState of ['unknown', 'none']) {
    assert.equal(advise(id, { trainingType, hifAbilityState }).rating.grade, 'C');
  }
  const matched = advise(id, { trainingType, hifAbilityState: 'matched' });
  assert.equal(matched.rating.grade, 'A');
  assert.equal(matched.rating.authorGrade, 'C');
  assert.equal(matched.rating.basis, 'guide');
});

test('guide conditions without an author letter remain visible and never become an invented author rating', () => {
  const id = 'p_card-02-act-1_028', trainingType = 'motivation';
  const unknown = advise(id, { trainingType, hifAbilityState: 'unknown' });
  const none = advise(id, { trainingType, hifAbilityState: 'none' });
  const matched = advise(id, { trainingType, hifAbilityState: 'matched' });
  assert.ok(unknown.missingConditions.some(text => /HIF/.test(text)));
  assert.ok(none.missingConditions.some(text => /HIF/.test(text)));
  assert.ok(!matched.missingConditions.some(text => /HIF/.test(text)));
  assert.notEqual(none.rating.grade, matched.rating.grade);
  for (const row of [unknown, none, matched]) {
    assert.equal(row.rating.authorGrade, null);
    assert.equal(row.rating.basis, 'derived');
  }
});

test('explicit source relationships survive normalized gameId links, including hand-slot conflicts', () => {
  const row = advise('p_card-03-act-1_042', { trainingType: 'fullPower', purpose: 'memory' });
  const conflict = row.relationships.find(relation => relation.type === 'slot_competition');
  assert.ok(conflict);
  assert.equal(conflict.basis, 'guide');
  assert.ok(conflict.cards.some(card => card.gameId === 'p_card-03-act-2_082'));
  const sequence = row.relationships.find(relation => relation.type === 'combo_sequence');
  assert.ok(sequence?.cards.some(card => card.gameId === 'p_card-03-act-3_189'));
});

test('switch pairs preserve both identities and never become positive companion recommendations', () => {
  const c = catalog(), data = c.skillAdvice;
  assert.equal(data.switchPairs.length, 31);
  for (const pair of data.switchPairs) {
    const before = data.cards.find(card => card.gameId === pair.beforeGameId);
    const after = data.cards.find(card => card.gameId === pair.afterGameId);
    assert.ok(before);
    assert.ok(after);
    assert.equal(pair.simultaneousPossessionAllowed, false);
    assert.ok(before.switchPartnerGameIds.includes(after.gameId));
    assert.ok(after.switchPartnerGameIds.includes(before.gameId));
    assert.equal(after.unlock.conversionProducerLevel, pair.unlockProducerLevel);
  }
  const pair = data.switchPairs.find(row => row.afterGameId === 'p_card-01-act-1_068');
  assert.ok(pair);
  const row = advise(pair.afterGameId);
  const conflict = row.relationships.find(relation => relation.cards.some(card => card.gameId === pair.beforeGameId)
    && /동시|상호.*배타|스위치/.test(relation.label + ' ' + relation.reason));
  assert.ok(conflict);
  assert.ok(row.relationships.filter(relation => relation.basis === 'derived').every(relation =>
    relation.cards.every(card => card.gameId !== pair.beforeGameId)));
});

test('author PLv acquisition bands and memory categories do not become every-purpose grades', () => {
  const id = 'p_card-01-act-1_020';
  const evidence = catalog().skillAdvice.evidence.filter(row => row.sourceIds.includes('plv-muzora-sense-20260409'));
  assert.equal(adviseWithEvidence(id, evidence, { scenario: 'hajime', producerLevel: 60 }).rating.authorGrade, 'C');
  assert.equal(adviseWithEvidence(id, evidence, { scenario: 'hajime', producerLevel: 70 }).rating.authorGrade, 'D');
  assert.equal(adviseWithEvidence(id, evidence, { scenario: 'hajime', producerLevel: 81 }).rating.authorGrade, null);
  const spotlightUpgrade = advise('p_card-01-act-3_185', { purpose: 'upgrade', upgradeCount: 0 });
  assert.equal(spotlightUpgrade.rating.authorGrade, null);
  assert.notEqual(spotlightUpgrade.rating.basis, 'guide');
});

test('historical NIA and contest opinions are not evidence for a current HIF assessment', () => {
  const id = 'p_card-00-men-3_003';
  const row = advise(id, { trainingType: 'fullPower' });
  assert.ok(row.evidence.every(evidence => !evidence.sourceIds.some(sourceId =>
    sourceId.startsWith('plv-man-contest-') || sourceId.startsWith('plv-sumire-'))));
  assert.equal(advise(id, { trainingType: 'fullPower', purpose: 'upgrade', upgradeCount: 0 }).rating.authorGrade, null);
});

test('idol-specific, future-reference and event evidence stays inside its original scope with resolvable sources', () => {
  const c = catalog(), sourceIds = new Set(c.skillAdvice.sources.map(source => source.id));
  for (const evidence of c.skillAdvice.evidence) {
    assert.ok(evidence.sourceIds.length > 0, evidence.id);
    assert.ok(evidence.sourceIds.every(id => sourceIds.has(id)), evidence.id);
  }
  const scopedId = 'multi:multi-0GUEH6UnVsg-atmosphere-preservation';
  const profileId = 'p_card-03-men-2_066';
  assert.ok(!advise(profileId, { trainingType: 'fullPower' }).evidence.some(row => row.id === scopedId));
  assert.ok(!advise(profileId, { trainingType: 'fullPower', idolGameId: 'i_card-ttmr-3-016' }).evidence.some(row => row.id === scopedId));
  assert.ok(advise(profileId, { trainingType: 'fullPower', idolGameId: 'i_card-kllj-3-015' }).evidence.some(row => row.id === scopedId));
  const futureId = 'multi:multi-P9v55xvsfoE-mite-mao-prepare-before-active';
  assert.ok(!advise('p_card-01-men-3_006').evidence.some(row => row.id === futureId));
  assert.ok(advise('p_card-01-men-3_006', { idolGameId: 'i_card-amao-3-015' }).evidence.some(row => row.id === futureId));
  assert.ok(advise('p_card-03-act-1_042', { trainingType: 'fullPower' }).evidence.every(row =>
    !row.id.startsWith('multi:multi-5-uzsuXxW8U-')));
  const niaId = 'multi:multi-FIfJtOrCCrg-nia-memory-custom';
  assert.ok(advise('p_card-00-men-3_005', { scenario: 'nia', difficulty: 'master' }).evidence.some(row => row.id === niaId));
  assert.ok(!advise('p_card-00-men-3_005', { scenario: 'nia', difficulty: 'pro' }).evidence.some(row => row.id === niaId));
  assert.ok(!advise('p_card-00-men-3_005').evidence.some(row => row.id === niaId));
});

test('customization details list only the card-allowed options and retain stage prices before discounts', () => {
  const presence = advise('p_card-01-men-2_037', { purpose: 'customization' });
  assert.equal(presence.meta.customizationOptions.length, 2);
  const cost = presence.meta.customizationOptions.find(option => option.id === 'p_card_custom-040-g_effect-cost_parameter_buff_reduce-1');
  assert.ok(cost);
  assert.match(cost.name, /호조 비용 감소/);
  assert.deepEqual(cost.levels.map(level => [level.level, level.price]), [[1, 40]]);
  assert.equal(cost.priceScope, 'master_base_before_scenario_discounts');
  assert.ok(presence.customizationAdvice.some(text => /40PP/.test(text) && /할인 전/.test(text)));
  const stack = advise('p_card-03-act-1_042', { trainingType: 'fullPower', purpose: 'customization' });
  const growth = stack.meta.customizationOptions.find(option => option.nameJa === '成長追加');
  assert.ok(growth);
  assert.deepEqual(growth.levels.map(level => [level.level, level.price]), [[1, 40], [2, 40], [3, 70]]);
  assert.ok(!presence.meta.customizationOptions.some(option => option.id === growth.id));
});

test('conditional persistent damage is not described as a guaranteed base attack', () => {
  const spotlight = advise('p_card-01-act-3_185');
  assert.ok(spotlight.effectSummary.every(text => !text.startsWith('기본 파라미터 상승')));
  const simple = advise('p_card-00-act-0_001');
  assert.ok(simple.effectSummary.some(text => text.startsWith('기본 파라미터 상승 14')));
});

test('all scenario and training-type views retain every card and do not mutate their source profiles', () => {
  const c = catalog(), before = JSON.stringify(c.skillAdvice);
  const expected = [...c.skillAdvice.cards, ...c.skillAdvice.unresolvedCards].map(card => card.id).sort();
  for (const scenario of ['hif', 'nia', 'hajime']) {
    for (const trainingType of ['concentration', 'goodConditionTurns', 'motivation', 'goodImpressionTurns', 'strength', 'fullPower', 'preservation']) {
      const result = buildSkillAdvice({ catalog: c, input: input({ scenario, trainingType }) });
      assert.equal(result.cards.length, 476, scenario + ':' + trainingType);
      assert.deepEqual(result.cards.map(card => card.id).sort(), expected);
      assert.equal(Object.values(result.coverage.gradeCounts).reduce((sum, count) => sum + count, 0), 476);
      for (const row of result.cards) {
        assert.ok(['guide', 'derived', 'unknown'].includes(row.rating.basis));
        assert.ok(['eligible', 'blocked', 'unknown', 'restricted'].includes(row.eligibility.status));
        assert.ok(Array.isArray(row.reasons));
        assert.ok(Array.isArray(row.upgradeAdvice));
        assert.ok(Array.isArray(row.customizationAdvice));
        for (const role of row.roles) assert.match(role.label, /[가-힣]/);
        if (!row.gameId) assert.equal(row.rating.tier, 'unrated');
      }
    }
  }
  assert.equal(JSON.stringify(c.skillAdvice), before);
});

test('unresolved identities and missing effect analysis remain unrated rather than poor recommendations', () => {
  for (const card of catalog().skillAdvice.unresolvedCards) {
    const row = advise(card.id);
    assert.equal(row.rating.tier, 'unrated');
    assert.equal(row.rating.basis, 'unknown');
    assert.notEqual(row.eligibility.status, 'eligible');
  }
  const c = catalog(), profile = structuredClone(c.skillAdvice.cards.find(card => card.gameId === 'p_card-00-men-3_005'));
  profile.evidenceIds = [];
  profile.guideReferences = [];
  for (const variant of profile.variants) {
    variant.dsl = null;
    variant.roles = [];
    variant.native.directEffects = [];
    variant.analysis = { status: 'unavailable', conditionalRoles: [], phases: [], stances: [], directNumbers: {}, risks: [], unknownActions: [] };
  }
  const isolated = { ...c, skillAdvice: { ...c.skillAdvice, cards: [profile], unresolvedCards: [], evidence: [] } };
  const row = buildSkillAdvice({ catalog: isolated, input: input({ cardIds: [profile.id] }) }).cards[0];
  assert.equal(row.rating.tier, 'unrated');
  assert.equal(row.rating.basis, 'unknown');
});
