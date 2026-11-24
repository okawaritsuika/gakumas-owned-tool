const axes=['vocal','dance','visual'];
const list=value=>Array.isArray(value)?value:[];
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;

/** An author's conservative preparation reference, never a native mark boundary. */
export function resolveHifPreparationReference({catalog={},options={},idolGameId=null}={}){
  if(options.scenario!=='hif')return null;
  const reference=catalog.produceFlowGuidance?.finalStatPreparationReference;
  const profile=list(catalog.hifExamProfiles?.profiles).find(row=>row.idolCardId===idolGameId);
  const supported=list(catalog.guideSupportProfiles?.profiles).some(row=>row.idolCardId===idolGameId&&row.scenario==='hif');
  const finals=list(profile?.examStages).filter(row=>row.stage==='final').sort((a,b)=>a.order-b.order);
  const order=finals[0]?.reference?.attributeOrder;
  // This source explicitly does not cover every idol. Apply the automatic
  // comparison only to an idol with a separately reviewed support profile.
  if(!supported||!reference||finals.length!==2||list(order).length!==3||new Set(order).size!==3||!order.every(axis=>axes.includes(axis)))return null;
  if(finals.some(exam=>JSON.stringify(exam.reference?.attributeOrder)!==JSON.stringify(order)))return null;
  const values=reference.byExamAttributeRank;
  if(!Array.isArray(values)||values.length!==3||!values.every(positive))return null;
  const sources=list(catalog.produceFlowGuidance?.sources);
  return {...reference,idolGameId,attributeOrder:order,targets:Object.fromEntries(order.map((axis,index)=>[axis,values[index]])),
    status:'author_preparation_reference',candidateComparisonBasis:'end_of_declared_route_conditional_projection',
    exactCircleBoundaryVerified:false,doubleCircleClaimed:false,guaranteesPassing:false,
    eventRoundApplicabilityVerified:false,
    sourceRefs:list(reference.sourceRefs).map(ref=>({...sources.find(source=>source.id===ref.sourceId),...ref})),
    limitations:[...list(reference.conditions),'현재 계정의 공략 후보 안에서 준비 목표를 충족하는 조합을 먼저 비교합니다. 전체 보유 조합의 최적해나 실전 통과를 보장하지 않습니다.']};
}

export function buildHifPreparationReadiness({result={},candidate=null,catalog={},options={}}={}){
  const reference=resolveHifPreparationReference({catalog,options:{...options,scenario:result.scoreSummary?.scenario??options.scenario},idolGameId:result.selectedIdol?.gameId});
  if(!reference)return null;
  const compare=stats=>({stats:stats??null,remaining:Object.fromEntries(axes.map(axis=>[axis,typeof stats?.[axis]==='number'?Math.max(0,reference.targets[axis]-stats[axis]):null])),
    referenceMet:axes.every(axis=>typeof stats?.[axis]==='number'&&stats[axis]>=reference.targets[axis])});
  const stages=list(candidate?.stages);
  const finals=[3,4].map(examIndex=>({examIndex,label:examIndex===3?'본선 라운드 1 직전':'본선 라운드 2 직전',
    ...compare(stages.find(stage=>stage.examIndex===examIndex)?.projection?.stats)}));
  const comparison=result.scoreSummary?.hifModel?.preparationComparison??null;
  return {...reference,routeProjection:compare(result.scoreSummary?.hifModel?.cappedStats),finals,comparison,
    candidateComparisonApplied:comparison?.enabled===true&&comparison.status!=='not_requested'&&axes.every(axis=>comparison.targets?.[axis]===reference.targets[axis]),
    summary:'본선의 속성 순서에 맞춘 공략 참고 목표입니다. 첫 라운드 직전 스탯과 경로 최종 예상치를 구분합니다.',
    exactMarkBoundaryVerified:false,actualLiveStatsCaptured:false,readinessConfirmed:false};
}
