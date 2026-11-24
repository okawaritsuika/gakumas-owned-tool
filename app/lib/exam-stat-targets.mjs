import { interpolateExamCoefficient } from './hif-battle-stage.mjs';

const axes=['vocal','dance','visual'];
const shorts={vocal:'vo',dance:'da',visual:'vi'};
const labels={vocal:'보컬',dance:'댄스',visual:'비주얼'};
const examLabels=['선발시험 1','선발시험 2','선발시험 3','본선 라운드 1','본선 라운드 2'];
const list=value=>Array.isArray(value)?value:[];
const number=value=>typeof value!=='boolean'&&value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
const readStat=(row,axis)=>number(row?.[axis]??row?.[shorts[axis]]);
const rounded=value=>Number.isFinite(value)?Math.round(value*1e8)/1e8:null;
const emptyMarks=()=>({'×':null,'△':null,'○':null,'◎':null});
const stageProjection=(candidate,result,index)=>{
  const stages=list(candidate?.stages).length?candidate.stages:list(result?.stages);
  const positional=stages[index];
  return (stages.find(stage=>stage.examIndex===index)??(Number.isInteger(positional?.examIndex)?null:positional))?.projection??null;
};

function coefficientAt(table,value,axis){
  if(value===null)return null;
  return interpolateExamCoefficient(table,value,axis);
}

/** Compare a declared projection or manually supplied snapshot to native fields.
 * Marks remain unknown until the actual client's boundary formula is verified.
 */
export function buildExamStatTargets({candidate=null,result={},catalog={},currentStats=null,examIndex=null}={}){
  if(examIndex!==null&&(!Number.isInteger(examIndex)||examIndex<0||examIndex>4))throw new RangeError('시험 번호는 0~4입니다.');
  const idolCardId=candidate?.selectedIdol?.gameId??candidate?.selectedIdol?.id??result.selectedIdol?.gameId??result.selectedIdol?.id??null;
  const reference=catalog.hifStatTargets;
  const sources=list(reference?.sources);
  const profile=list(catalog.hifExamProfiles?.profiles).find(row=>row.idolCardId===idolCardId);
  const missing=[];
  if(!reference?.criteriaByBattleConfig)missing.push('원본 시험 기준값 카탈로그를 읽지 못했습니다.');
  if(!profile)missing.push('선택한 P아이돌과 HIF 시험을 정확히 연결하지 못했습니다.');
  const limitations=[...missing,
    '○·◎를 포함한 기호 경계와 정수 판정식을 확인하지 못해 기호·다음 기호까지 남은 수치는 미확정입니다.',
    '원본 시험 설정값까지의 차이를 표시하며 ○ 달성까지의 수치라고 단정하지 않습니다.',
    '스탯 +10의 계수 차이는 공개 계수표의 선형 보간 모형입니다. 실제 점수 증가·턴 배분·다른 스탯 미달의 공통 보정을 검증한 값이 아닙니다.',
    '체력·P포인트·실제 선택지가 없으면 스탯 보완을 회복이나 상담보다 우선한다고 정하지 않습니다.'];
  if(missing.length)return{status:'unavailable',asOf:reference?.asOf??null,idolCardId,stages:[],limitations,evidenceSources:sources};
  // An empty manual form is not a captured snapshot. A partially filled form
  // stays partial: never fill its missing axes from future model projections.
  const direct=axes.some(axis=>[axis,shorts[axis]].some(key=>currentStats?.[key]!==undefined&&currentStats?.[key]!==null&&currentStats?.[key]!==''));
  if(direct&&examIndex===null)limitations.push('같은 직접 입력 스냅샷을 각 시험 기준과 비교합니다. 미래 시험 시점의 스탯으로 예측한 값이 아닙니다.');
  if(!direct)limitations.push('실시간 육성 스탯이 없어 시험 직전 경로 모형의 조건부 예상치를 사용합니다. 실제 현재 스탯으로 수집한 값이 아닙니다.');
  const stages=[];
  for(const index of examIndex===null?[0,1,2,3,4]:[examIndex]){
    const exam=list(profile.examStages).find(row=>row.stage===(index<3?'selection':'final')&&row.order===(index<3?index+1:index-2));
    if(!exam){limitations.push(examLabels[index]+' 원본 시험 연결 없음');continue;}
    const native=reference.criteriaByBattleConfig[exam.battleConfigId];
    const projection=stageProjection(candidate,result,index),stats=direct?currentStats:projection?.stats;
    const table=catalog.hifExamProfiles.scoreTables?.[exam.scoreConfigId];
    const values=Object.fromEntries(axes.map(axis=>{
      const value=readStat(stats,axis),criterion=number(native?.criteria?.[axis]);
      const coefficient=coefficientAt(table,value,axis),next=coefficientAt(table,value===null?null:value+10,axis);
      const gain=coefficient!==null&&next!==null?rounded(next-coefficient):null;
      return [axis,{
        value,valueSource:value===null?'unknown':direct?'direct_input':'conditional_projection',
        valueScope:direct?'same_input_snapshot':'projected_before_this_exam',
        rawCriterion:criterion,rawCriterionStatus:criterion===null?'unmapped':'native_field_not_verified_mark_boundary',
        criterionGap:value!==null&&criterion!==null?criterion-value:null,
        remainingToCriterion:value!==null&&criterion!==null?Math.max(0,criterion-value):null,
        thresholds:emptyMarks(),currentMark:null,nextMark:null,remaining:null,markStatus:'boundary_formula_unverified',
        rawExcellent: number(native?.excellentRaw?.[axis]),rawBad:number(native?.badRaw?.[axis]),
        scoreCoefficient:{value:rounded(coefficient),gainFor10:gain,perStat:gain===null?null:rounded(gain/10),unit:'permil',
          multiplierGainFor10:gain===null?null:rounded(gain/1000),method:'piecewise_linear_model_unverified',
          actualScoreGain:null,crossAxisPenaltyVerified:false},
      }];
    }));
    const deficient=axes.filter(axis=>values[axis].remainingToCriterion>0);
    const known=axes.filter(axis=>values[axis].value!==null);
    const reason=!known.length?'스탯 입력 또는 해당 시험 직전 모형 수치가 없어 부족량을 정하지 못했습니다.':
      deficient.length?'원본 설정값보다 낮은 스탯: '+deficient.map(axis=>`${labels[axis]} +${values[axis].remainingToCriterion}`).join(', ')+'. 기호 판정 경계는 미확정이며 회복·P포인트 여유도 함께 확인합니다.':
      '확인된 스탯은 원본 설정값 이상입니다. 이 사실만으로 ○·◎ 달성이나 합격을 확정하지 않습니다.';
    stages.push({examIndex:index,label:examLabels[index],stage:exam.stage,order:exam.order,status:native?'native_criteria_mark_boundaries_unknown':'criteria_unmapped',
      valueBasis:direct?'direct_input':'conditional_projection',axes:values,
      rewardAfterThisExam:direct?null:projection?.rewardAfterThisExam??null,
      nativeSource:{battleConfigId:exam.battleConfigId,scoreConfigId:exam.scoreConfigId,
        parameterBaseLine:exam.parameterBaseLine??null,parameterBaseLineIsPerAxisThreshold:false,
        assessmentSettings:reference.hifSettings?.[exam.stage]??null},
      recommendationReason:reason,recommendedAxis:null,
      statOnlyMarginalOrder:axes.filter(axis=>values[axis].scoreCoefficient.gainFor10!==null)
        .sort((a,b)=>values[b].scoreCoefficient.gainFor10-values[a].scoreCoefficient.gainFor10),
      evidenceSources:sources});
  }
  return {status:stages.length?'partial_mark_boundaries_unknown':'unavailable',asOf:reference.asOf,idolCardId,
    inputBasis:direct?'direct_input':'conditional_projection',actualLiveStatsCaptured:false,stages,limitations,evidenceSources:sources};
}
