import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildExamStatTargets } from '../lib/exam-stat-targets.mjs';

const reference=JSON.parse(fs.readFileSync(new URL('../data/catalog/hif_stat_targets.json',import.meta.url),'utf8'));
const exams=JSON.parse(fs.readFileSync(new URL('../data/catalog/hif_exam_profiles.json',import.meta.url),'utf8'));
const catalog={hifStatTargets:reference,hifExamProfiles:exams};
const candidate=()=>({selectedIdol:{gameId:'i_card-kllj-3-015'},stages:Array.from({length:5},(_,examIndex)=>({examIndex,
  projection:{stats:{vocal:100+examIndex*100,dance:200+examIndex*100,visual:300+examIndex*100}}}))});

test('Atmosphere native per-axis fields are copied for all five exams without treating parameterBaseLine or breakpoints as marks',()=>{
  const input=candidate(),before=structuredClone(input),output=buildExamStatTargets({candidate:input,catalog});
  assert.equal(output.stages.length,5);
  assert.deepEqual(output.stages.map(stage=>Object.values(stage.axes).map(axis=>axis.rawCriterion)),[
    [172,221,296],[340,435,585],[574,735,988],[1088,1392,1871],[1088,1392,1871],
  ]);
  assert.deepEqual(Object.values(output.stages[0].axes).map(axis=>axis.criterionGap),[72,21,-4]);
  assert.equal(output.stages[0].axes.visual.remainingToCriterion,0);
  assert.equal(output.stages[0].nativeSource.parameterBaseLine,150);
  assert.equal(output.stages[0].nativeSource.parameterBaseLineIsPerAxisThreshold,false);
  for(const stage of output.stages)for(const axis of Object.values(stage.axes)){
    assert.equal(axis.currentMark,null);assert.equal(axis.nextMark,null);assert.equal(axis.remaining,null);
    assert.deepEqual(axis.thresholds,{'×':null,'△':null,'○':null,'◎':null});
    assert.equal(axis.rawExcellent,0);assert.equal(axis.rawBad,0);
    assert.equal(axis.valueSource,'conditional_projection');
  }
  assert.deepEqual(input,before);
  assert.equal(output.actualLiveStatsCaptured,false);
});

test('uses manual current values only at the requested exam and never patches missing axes from model values',()=>{
  const output=buildExamStatTargets({candidate:candidate(),catalog,examIndex:3,currentStats:{vocal:1000,dance:1400}});
  assert.equal(output.stages.length,1);assert.equal(output.stages[0].examIndex,3);
  assert.equal(output.inputBasis,'direct_input');
  assert.equal(output.stages[0].axes.vocal.valueSource,'direct_input');
  assert.equal(output.stages[0].axes.vocal.remainingToCriterion,88);
  assert.equal(output.stages[0].axes.dance.remainingToCriterion,0);
  assert.equal(output.stages[0].axes.visual.value,null);
  assert.equal(output.stages[0].axes.visual.valueSource,'unknown');
});

test('empty forms use the conditional projection but zero is a valid manual input',()=>{
  const empty=buildExamStatTargets({candidate:candidate(),catalog,examIndex:0,currentStats:{vocal:null,dance:'',visual:null}});
  assert.equal(empty.inputBasis,'conditional_projection');assert.equal(empty.stages[0].axes.vocal.value,100);
  const manual=buildExamStatTargets({candidate:candidate(),catalog,examIndex:0,currentStats:{vo:0,da:0,vi:0}});
  assert.equal(manual.inputBasis,'direct_input');assert.equal(manual.stages[0].axes.vocal.value,0);
  assert.equal(manual.stages[0].axes.vocal.remainingToCriterion,172);
});

test('per-stat marginal gain is a stated interpolation model, not an excellent boundary or actual score gain',()=>{
  const output=buildExamStatTargets({candidate:candidate(),catalog,examIndex:0,currentStats:{vocal:100,dance:100,visual:100}});
  const coefficient=output.stages[0].axes.vocal.scoreCoefficient;
  assert.equal(coefficient.value,369.13953488);
  assert.equal(coefficient.gainFor10,33.31395349);
  assert.equal(coefficient.actualScoreGain,null);
  assert.equal(coefficient.method,'piecewise_linear_model_unverified');
  assert.equal(output.stages[0].recommendedAxis,null);
  const outside=buildExamStatTargets({candidate:candidate(),catalog,examIndex:0,currentStats:{vocal:20000,dance:100,visual:100}});
  assert.equal(outside.stages[0].axes.vocal.scoreCoefficient.value,null);
});

test('missing projections stay unknown rather than importing final stats into an earlier exam',()=>{
  const input=candidate();delete input.stages[0].projection;
  const output=buildExamStatTargets({candidate:input,catalog,examIndex:0});
  for(const axis of Object.values(output.stages[0].axes)){assert.equal(axis.value,null);assert.equal(axis.criterionGap,null);}
  input.stages=[input.stages[4]];
  const sparse=buildExamStatTargets({candidate:input,catalog,examIndex:0});
  assert.equal(sparse.stages[0].axes.vocal.value,null);
  assert.equal(buildExamStatTargets({candidate:input,catalog,examIndex:4}).stages[0].axes.vocal.value,500);
});

test('unknown mappings, missing reference and invalid exam indices fail explicitly',()=>{
  assert.equal(buildExamStatTargets().status,'unavailable');
  assert.equal(buildExamStatTargets({candidate:{selectedIdol:{gameId:'unknown'}},catalog}).status,'unavailable');
  for(const examIndex of [-1,5,1.5])assert.throws(()=>buildExamStatTargets({candidate:candidate(),catalog,examIndex}),RangeError);
});
