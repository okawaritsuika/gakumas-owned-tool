import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildExamScoreTargets } from '../lib/exam-score-targets.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL('../data/catalog/' + name + '.json', import.meta.url), 'utf8'));
const catalog = { hifExamScoreTargets: read('hif_exam_score_targets'), hifExamProfiles: read('hif_exam_profiles') };
const result = { selectedIdol: { gameId: 'i_card-kllj-3-015' }, scoreSummary: { scenario: 'hif', producerLevel: 70 } };

test('Atmosphere selection goals distinguish guide passing scores, star caps and sufficient parameter observations', () => {
  const output = buildExamScoreTargets({ result, catalog });
  assert.deepEqual(output.stages.map(row => row.pass.guideScore), [6100, 50000, 137000]);
  assert.deepEqual(output.stages.map(row => row.rewardTargets.find(target => target.kind === 'star_cap').targetScore), [15000, 150000, 400000]);
  assert.deepEqual(output.stages.map(row => row.rewardTargets.find(target => target.kind === 'star_cap').baseReward), [40, 110, 110]);
  assert.deepEqual(output.stages.map(row => row.rewardTargets.find(target => target.kind === 'parameter_cap_observed').observedSufficientScore), [10463, 80611, 204894]);
  assert.deepEqual(output.stages.map(row => row.rewardTargets.find(target => target.kind === 'parameter_cap_observed').baseRewardTotal), [140, 440, 520]);
  assert.equal(output.projectedExamScore, null);
  assert.equal(output.actualExamScoreCaptured, false);
});

test('manual score and post-bonus reward are preserved independently without inventing a score-to-reward function',()=>{
  const input={hifExamResults:[{examIndex:0,score:6100,parameterGains:{vocal:0,dance:18,visual:7}}]};
  const output=buildExamScoreTargets({result,catalog,options:input});
  assert.equal(output.stages[0].enteredResult.score,6100);
  assert.deepEqual(output.stages[0].enteredResult.parameterGains,{vocal:0,dance:18,visual:7});
  assert.equal(output.stages[0].enteredResult.gainBasis,'post_bonus');
  assert.equal(output.stages[0].enteredResult.observedScoreToParametersApplied,false);
  assert.equal(output.stages[0].pass.passed,null);assert.equal(output.stages[1].modeledParameterReward.assumedMaximum,true);
});

test('native dynamic NPC scores and rank data remain raw evidence, never an exact game passing threshold', () => {
  const output = buildExamScoreTargets({ result, catalog });
  assert.deepEqual(output.stages.map(row => row.native.rawNativeNpcBorder.scoreMin), [5963, 49168, 134524]);
  for (const stage of output.stages) {
    assert.equal(stage.pass.nativeRankThreshold, 2);
    assert.equal(stage.native.isStaticNpcScore, false);
    assert.equal(stage.native.accountSpecificCrossChecked, true);
    assert.equal(stage.native.rawNativeNpcBorderIsPassingThreshold, false);
    assert.equal(stage.pass.exactThreshold, null);
    assert.equal(stage.pass.exact, false);
    assert.equal(stage.pass.passed, null);
    assert.equal(stage.pass.actualDisplayedThreshold, null);
    assert.equal(stage.pass.rule, 'displayed_breakthrough_line');
  }
});

test('reward values are unbonused and observational, not exact integer minimum thresholds', () => {
  for (const stage of buildExamScoreTargets({ result, catalog }).stages) {
    for (const target of stage.rewardTargets) { assert.equal(target.bonusIncluded, false); assert.equal(target.exact, false); }
    const parameter = stage.rewardTargets.find(target => target.kind === 'parameter_cap_observed');
    assert.equal(parameter.exactThreshold, null);
    assert.equal(parameter.baseRewardTotal, 3 * parameter.baseFixedPerAxis + parameter.baseAllocatedTotal);
    assert.equal(parameter.targetScore, undefined);
  }
});

test('other idols retain general reference scope without claiming idol-specific native validation', () => {
  const other = catalog.hifExamProfiles.profiles.find(row => row.idolCardId !== result.selectedIdol.gameId);
  const output = buildExamScoreTargets({ result: { ...result, selectedIdol: { gameId: other.idolCardId } }, catalog });
  assert.equal(output.stages[0].native.accountSpecificCrossChecked, false);
  assert.match(output.limitations.join(' '), /이 P아이돌의 실제 돌파선을 따로 검증한 값이 아닙니다/);
});

test('event rules are not silently treated as normal HIF and final rounds get no recycled selection goals', () => {
  const output = buildExamScoreTargets({ result, catalog, options: { eventModeId: 'asari_2026_10_30' }, examIndex: 1 });
  assert.equal(output.status, 'normal_reference_event_applicability_unknown');
  assert.equal(output.stages[0].examIndex, 1);
  assert.equal(output.stages[0].pass.guideScore, 50000);
  assert.equal(output.stages[0].appliesToSelectedMode, null);
  assert.equal(buildExamScoreTargets({ result: { ...result, eventContext: { modeId: 'asari_2026_10_30' } }, catalog }).status,
    'normal_reference_event_applicability_unknown');
  for (const examIndex of [3, 4]) {
    const final = buildExamScoreTargets({ result, catalog, examIndex });
    assert.equal(final.status, 'unavailable_for_final'); assert.deepEqual(final.stages, []);
  }
});

test('missing mappings, non-HIF scope and invalid exam indices do not fabricate targets; inputs remain unchanged', () => {
  assert.equal(buildExamScoreTargets().status, 'unavailable');
  assert.equal(buildExamScoreTargets({ result: { selectedIdol: { gameId: 'unknown' } }, catalog }).status, 'unavailable');
  assert.deepEqual(buildExamScoreTargets({ result, catalog, options: { scenario: 'nia' } }).stages, []);
  for (const examIndex of [-1, 5, 0.5]) assert.throws(() => buildExamScoreTargets({ result, catalog, examIndex }), RangeError);
  const before = structuredClone({ result, catalog });
  const output = buildExamScoreTargets({ result, catalog });
  output.stages[0].rewardTargets[0].targetScore = 0;
  assert.deepEqual({ result, catalog }, before);
  const ids = new Set(output.evidenceSources.map(source => source.id));
  for (const stage of output.stages) for (const sourceId of stage.sourceIds) assert.ok(ids.has(sourceId));
});
