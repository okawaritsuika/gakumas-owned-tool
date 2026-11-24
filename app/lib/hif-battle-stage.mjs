const axes=['vocal','dance','visual'];

// The master contains breakpoints, not a verified game implementation. Keep
// interpolation and turn-order assumptions in the public result.
export function interpolateExamCoefficient(table,parameter,axis){const index=axes.indexOf(axis)+1;if(index<1||!Number.isFinite(parameter)||parameter<0||!table?.length)return null;const rows=[...table].sort((a,b)=>a[0]-b[0]);const exact=rows.find(row=>row[0]===parameter);if(exact)return exact[index];const upper=rows.findIndex(row=>row[0]>parameter);if(upper<=0)return null;const a=rows[upper-1],b=rows[upper];return a[index]+(b[index]-a[index])*(parameter-a[0])/(b[0]-a[0]);}

export function buildHifBattleStage({exam,catalog,stats}){
  if(!exam||!Number.isInteger(exam.turn)||exam.turn<1)return{status:'unsupported',reason:'시험의 전체 턴 수를 확인하지 못했습니다.'};
  const data=catalog.hifExamProfiles,table=data?.scoreTables?.[exam.scoreConfigId];
  if(exam.gimmickEffectGroupId&&!Object.hasOwn(data?.gimmickGroups??{},exam.gimmickEffectGroupId))return{status:'unsupported',reason:'시험 기믹의 원본 연결이 없어 효과가 없는 시험으로 처리하지 않았습니다.'};
  const coefficients=Object.fromEntries(axes.map(axis=>[axis,interpolateExamCoefficient(table,stats[axis],axis)]));
  if(axes.some(axis=>coefficients[axis]==null))return{status:'unsupported',reason:'시험 계수 표 범위에서 능력치 보정을 계산하지 못했습니다.'};
  const active=(data.gimmickGroups?.[exam.gimmickEffectGroupId]??[]).filter(effect=>!(effect.startTurn>exam.turn));
  if(active.length)return{status:'unsupported',reason:'해당 시험의 활성 기믹을 아직 전투 효과에 정확히 대응하지 못했습니다.',unsupportedGimmicks:active};
  const order=exam.reference?.attributeOrder??[...axes].sort((a,b)=>coefficients[b]-coefficients[a]);
  const turnCounts=exam.turnCounts??Object.fromEntries(axes.map(axis=>[axis,Math.floor(exam.turn/3)]));
  if(!exam.turnCounts)for(let remaining=exam.turn%3;remaining>0;remaining--)turnCounts[order[(exam.turn%3)-remaining]]++;
  const firstTurns=exam.firstTurns??Object.fromEntries(axes.map(axis=>[axis,1/3]));
  const limitations=['점수 계수는 원본 표의 구간별 선형 보간을 가정했습니다. 게임의 보간·반올림과 일치한다고 검증한 값은 아닙니다.','총 턴 수보다 큰 startTurn을 가진 기믹은 발동하지 않는 모형으로 처리합니다. 실제 발동 알고리즘까지 검증한 것은 아닙니다.',...(!exam.turnCounts?['속성별 턴 수는 균등 배분하고 남는 턴을 같은 능력치에서 비중이 높은 속성에 배정한 모형입니다. 실제 HIF의 턴 배분을 확인한 값이 아닙니다.']:[]),...(!exam.firstTurns?['첫 턴 속성은 1/3씩 가정합니다.']:[])];
  return{status:'ready',coefficients,coefficientMethod:'piecewise_linear_model_unverified',stage:{scenario:'hif',turnCount:exam.turn,turnCounts,firstTurns,criteria:Object.fromEntries(axes.map(axis=>[axis,exam.reference?.coefficients?.[axis]??coefficients[axis]])),typeMultipliers:Object.fromEntries(axes.map(axis=>[axis,coefficients[axis]/1000])),effects:[],limitations}};
}

export function npcPassBounds(exam,catalog,sampleScores){
  if(!exam?.isStaticNpcScore)return{status:'unknown',lower:null,upper:null,reason:'능력치에 따라 달라지는 선발 라이벌 점수·순위를 재현하지 않아 통과율을 확정하지 않습니다.'};
  const rows=catalog.hifExamProfiles?.npcGroups?.[exam.npcGroupId],rank=exam.rankThreshold;
  if(!rows?.length||!Number.isInteger(rank)||rank<1)return{status:'unknown',lower:null,upper:null,reason:'통과 순위 또는 라이벌 점수 범위를 확인하지 못했습니다.'};
  const threshold=field=>rows.length<rank?0:[...rows].map(row=>row[field]).sort((a,b)=>b-a)[rank-1]+1;
  const optimisticThreshold=threshold('scoreMin'),conservativeThreshold=threshold('scoreMax');
  const scores=sampleScores.map(row=>typeof row==='number'?row:row.score);
  return{status:'model_bounds',lower:scores.filter(score=>score>=conservativeThreshold).length/scores.length,upper:scores.filter(score=>score>=optimisticThreshold).length/scores.length,optimisticThreshold,conservativeThreshold,rankThreshold:rank,reason:'원본 고정 라이벌의 최소·최대 점수로 구한 모형 통과율 범위입니다. 라이벌 점수의 확률분포는 가정하지 않았고, 동점은 통과로 세지 않았습니다.'};
}
