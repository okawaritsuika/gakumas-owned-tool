import { findHifMemoryProfile, summarizeHifGuideProfile } from './hif-memory-profile.mjs';
import { idolRecipeContext } from './idol-recipe-policy.mjs';
import { HIF_STAT_POINTS, HIF_STAR_POINTS } from './hif-support-evaluation.mjs';

const axes=['vocal','dance','visual'];
const short={vocal:'vo',dance:'da',visual:'vi'};
const list=value=>Array.isArray(value)?value:[];
const number=value=>typeof value!=='boolean'&&value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
const readStat=(stats,axis)=>number(stats?.[axis]??stats?.[short[axis]]);
const sources=[
  {id:'hif-evaluation-calculator',title:'H.I.F 평가 계산기 · 계산식 설명',url:'https://gktools.unoeins.org/en/calculator/hif',checkedAt:'2026-11-04',
    kind:'calculator_author_documentation',gameFormulaIndependentlyVerified:false,
    scope:'스탯 합×2 + 최종 스타성×7.5 + 두 라운드의 감쇠 평가 항 − 2000. 실제 시험 점수를 예측하는 식은 아닙니다.'},
  {id:'hif-native-grade',title:'ProduceGrade · 공개 마스터 등급 임계값',
    url:'https://github.com/vertesan/gakumasu-diff/blob/fc6afb8b5ba4b5b3e0f041edb5f33f53db2f6a64/ProduceGrade.yaml',checkedAt:'2026-11-04',
    kind:'public_master_transcription',scope:'등급 임계값은 있지만 평가점 계산 알고리즘 자체는 이 테이블에 없습니다.'},
  {id:'hif-stat-model',title:'gaku-navi · 육성 경로 스탯 모델',
    url:'https://github.com/33ki3/gaku-navi/blob/5e8bd85f6de8f668f3394c163afe7189b8c32047/src/utils/unitOptimizer/evaluator.ts',checkedAt:'2026-11-04',
    kind:'public_source_model',scope:'상승 기회별 성장률·내림·스탯 상한 참고. 스킬 화력·실제 시험 점수를 환산하지 않습니다.'},
];

function guideMatch(result,catalog,options,inventory){
  if(options.hifMode&&options.hifMode!=='normal')return{status:'unsupported_mode',roles:[],fulfilledCount:0,missingCount:0,unknownCount:0,
    readinessConfirmed:false,actualLoopValidated:false,sourceConditionsVerified:false,
    reason:'일반 HIF 공략을 강화월간·아사리 등 다른 모드의 충족 판정에 사용하지 않습니다.',sources:[]};
  const model=result.scoreSummary?.hifModel??{};
  const existing=model.guideMemoryProfile;
  const profile=findHifMemoryProfile(catalog,idolRecipeContext({result,catalog,inventory,options}));
  if(!profile)return{status:'unavailable',roles:[],fulfilledCount:0,missingCount:0,unknownCount:0,
    readinessConfirmed:false,actualLoopValidated:false,sourceConditionsVerified:false,
    reason:'현재 플랜·육성 유형에 연결된 공략 역할 원자료가 없습니다.',sources:[]};
  const summary=summarizeHifGuideProfile(profile,list(result.memories),catalog,{prioritized:existing?.considered??existing?.applied??false});
  const roles=summary.roles.map(role=>{
    const memory=list(result.memories).find(row=>row.id===role.memoryId),skill=memory?.modelEffects?.carriedSkill;
    return{...role,actualSelectedSkill:skill?{memoryId:memory.id,gameId:skill.id,upgradeCount:skill.upgrade??skill.upgradeCount??null,
      obtainable:skill.obtainable??null,acquisitionPhase:skill.phase??null,
      customizations:list(skill.customizes).map(custom=>({id:custom.id??null,count:custom.customizeCount??null,
        exactCountKnown:custom.exactCountKnown===true,growEffects:list(custom.growEffects).map(grow=>({effectType:grow.effectType,
          value:grow.value??null,unresolved:grow.unresolved===true}))}))}:null};
  });
  return{...summary,roles,status:'conditional_guide_role_match',roleMatchOnly:true,readinessConfirmed:false,
    actualLoopValidated:false,sourceConditionsVerified:false,numericSkillBonusApplied:false,
    proofPolicy:'native_skill_id_actual_acquisition_phase_exact_custom_count_and_grow_effect_checks',
    note:'원본 스킬 ID·실제 합류 시점·커스텀 횟수/성장 효과를 확인한 역할만 충족으로 셉니다. 서술형 조건이나 미확정 성장 템플릿은 미확정으로 남깁니다.'};
}

/** A conditional route forecast and a partial evaluation reference, with no
 * battle engine, random trial, invented skill weights, or fitted score factor.
 */
export function buildProduceForecast({result={},inventory={},catalog={},options={}}={}){
  const summary=result.scoreSummary??{},model=summary.hifModel??{};
  const scenario=options.scenario??summary.scenario??null;
  const supported=scenario==='hif';
  const manual=options.finalStats&&axes.some(axis=>readStat(options.finalStats,axis)!==null);
  const stats=supported?(manual?options.finalStats:model.cappedStats):null;
  const values=Object.fromEntries(axes.map(axis=>[axis,readStat(stats,axis)]));
  const total=axes.every(axis=>values[axis]!==null)?axes.reduce((sum,axis)=>sum+values[axis],0):null;
  const projectedStats={...values,total,basis:manual?'manual_final_stats':'conditional_route',
    actualLiveStatsCaptured:false,forecastRange:null,
    assumptions:manual?['직접 입력한 최종 스탯을 평가식의 스탯 항에 대입했습니다. 실제 수집 기록으로 판정하지 않습니다.']:
      ['선택한 육성 경로·SP 성공·이전 선발 보상 등 기존 스탯 모델의 조건이 충족된 경우입니다.',
        '현재 수집한 육성 중 실시간 스탯이나 전체 선택지 성공 확률을 예측한 값이 아닙니다.']};
  const index=supported?number(model.modeledStatTotal):null;
  const parameterContribution=total===null?null:total*HIF_STAT_POINTS;
  const star=supported?number(options.finalStar):null;
  const starContribution=star===null?null:star*HIF_STAR_POINTS;
  const constant=supported?-2000:null;
  const partial=parameterContribution===null?null:parameterContribution+(starContribution??0)+constant;
  const unknowns=[
    ...(supported?[]:['이 예측기는 일반 HIF의 스탯 경로와 부분 평가식만 다룹니다.']),
    ...(total===null?['최종 Vo·Da·Vi 중 확인되지 않은 스탯이 있습니다.']:[]),
    ...(star===null?['최종 스타성을 알 수 없어 스타성 평가 항을 더하지 않았습니다.']:[]),
    '실제 본선 두 라운드 점수와 해당 점수의 감쇠 평가 항을 계산하지 않았습니다.',
    '최종 시험 우승·통과 여부와 실제 최종 평가점·등급은 예측하지 않습니다.',
    '미확인 이벤트 시점·현재 PP/체력 수지·랜덤 카드/아이템 획득률은 완전한 경로 확률로 계산하지 않았습니다.',
    '확률 자료가 없어 스탯이나 최종 평가점의 신뢰구간·기대값 범위를 만들지 않았습니다.',
  ];
  const knownContributions=[];
  if(parameterContribution!==null)knownContributions.push({id:'parameters',label:'예상 스탯의 평가식 기여',value:parameterContribution,
    formula:'(Vo + Da + Vi) * 2',status:manual?'manual_input_contribution':'conditional_projected_contribution',unit:'evaluation_points_component',sourceIds:['hif-evaluation-calculator']});
  if(starContribution!==null)knownContributions.push({id:'star',label:'직접 입력한 최종 스타성 기여',value:starContribution,
    input:star,formula:'finalStar * 7.5',status:'manual_input_contribution',unit:'evaluation_points_component',sourceIds:['hif-evaluation-calculator']});
  if(supported)knownContributions.push({id:'constant',label:'공개 평가식의 상수 항',value:constant,status:'documented_formula_term',unit:'evaluation_points_component',sourceIds:['hif-evaluation-calculator']});
  return{status:!supported?'unsupported_scenario':total===null?'missing_stat_forecast':'partial_stat_forecast',asOf:'2026-11-04',scenario,
    projectedStats,
    comparisonIndex:{value:index,label:'경로 스탯 참고지수',basis:'hifModel.modeledStatTotal',unit:'index',
      actualExamScore:false,finalEvaluationScore:false,skillPowerConverted:false,
      note:'기존 스탯 비교 지수를 그대로 표시합니다. 임의 스킬 가중치나 관측 최고점 맞춤 배율을 더하지 않았습니다.'},
    evaluation:{status:'partial',total:null,grade:null,projectedParameterContribution:parameterContribution,
      starContribution,round1Contribution:null,round2Contribution:null,constant,knownSubtotal:partial,
      subtotalLabel:'확인 가능한 항의 부분값',isLowerBound:false,finalScorePredicted:false,
      formulaReference:'parameterTotal * 2 + finalStar * 7.5 + round1ScoreRating + round2ScoreRating - 2000',
      formulaAuthority:'calculator_author_documentation_not_independently_game_verified',
      note:'부분값은 최종 평가점이나 최소 보장 점수가 아닙니다. 시험 결과와 스타성이 없으면 최종 합계를 만들지 않습니다.'},
    knownContributions,unknowns,confidence:{label:manual?'직접 입력 스탯의 부분 평가':'계획 경로 기반 조건부 추정',
      modelStatus:model.status??null,gameScorePredicted:false,rankPredicted:false,probabilityEstimated:false,
      sourceSnapshotKnown:Boolean(catalog.hifExamProfiles?.snapshot),inventoryCapturedAt:inventory.capturedAt??null},
    guideSkillMatch:supported?guideMatch(result,catalog,options,inventory):null,
    coverage:{included:['현재 추천의 상한 적용 예상 Vo·Da·Vi','기존 경로 스탯 비교 지수','공개 평가식의 스탯 ×2 항·상수 항','직접 입력한 최종 스타성 ×7.5 항','공략 반입 역할의 실제 ID·시점·커스텀 조건'],
      partial:['공략 역할 일치는 완성 루프나 실전 준비 완료를 보증하지 않음','스탯 예상치는 선택 경로 조건부 값이며 확률 평균이 아님','평가식은 공개 계산기 설명을 참고했으며 게임 구현을 독립 검증하지 않음'],
      excluded:['전투 시뮬레이션·Monte Carlo','고정 스킬 화력 가중치','기존 낮은 전투 점수를 목표 최고점에 맞추는 배율 보정','실제 본선 점수의 감쇠 환산·순위·최종 등급 판정']},
    sources:supported?structuredClone(sources):[]};
}
