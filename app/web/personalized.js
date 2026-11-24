'use strict';

function personalRich(value){return memoryRichTextMarkup(plainGameText(value));}
function personalCardVisual(card,size=22){return memorySkillVisualMarkup(card,{size,showJapanese:true});}
function personalSteps(items){const rows=array(items).map(plainGameText).filter(Boolean);return rows.length?`<ul>${rows.map(item=>`<li>${personalRich(item)}</li>`).join('')}</ul>`:'';}
function personalizedDisplayResult(result){return result;}
function personalAxisLabel(axis){return({vocal:'보컬',dance:'댄스',visual:'비주얼'})[axis]||'자동';}
function personalSkillMarkup(card){return `<div class="personal-skill">${personalCardVisual(card,26)}</div>`;}

function forecastOverviewMarkup(result){
  const forecast=result.produceForecast??{},model=result.scoreSummary?.hifModel;if(!model)return '';
  const stats=growthVector(forecast.projectedStats??model.cappedStats),axis=model.primaryAttribute;
  const index=number(forecast.comparisonIndex?.value??forecast.comparisonIndex??model.modeledStatTotal);
  const evidence=result.sourceGuideEvidence??result.scoreSummary?.sourceGuideEvidence;
  const parameterPart=number(forecast.evaluation?.projectedParameterContribution);
  return `<section class="easy-overview"><h3>공략·보유 상태를 반영한 예상</h3><p>${axis?escapeHtml(personalAxisLabel(axis))+' 중심 · ':''}선택한 서포트 계산 레벨·돌파와 반입 메모리 효과로 비교한 능력치입니다.</p><div class="easy-stat-strip">${[['vo','Vo'],['da','Da'],['vi','Vi']].map(([key,label])=>`<div><span>예상 ${label}</span><strong>${formatNumber(stats[key])}</strong></div>`).join('')}</div>${parameterPart!==null?`<p>예상 스탯의 평가식 기여 <strong>${formatNumber(parameterPart)}</strong>점 <small>· 스탯 합 × 2</small></p>`:''}<p class="easy-small-note">전체 평가점은 스타성·본선 성적이 필요해 아직 미확정입니다. 스킬·합류 시점·커스텀과 공략 역할도 함께 대조합니다.</p>${evidence?.mode==='guide'?`<p>공략의 추천·대안 ${array(evidence.poolGameIds).length}종 안에서 같은 레벨 기준으로 비교했습니다.</p>`:evidence?.mode==='unrestricted'?'<p>공략 범위 밖을 포함한 수치 대안입니다. 원문의 추천과 구분해 확인하세요.</p>':''}${index!==null?expandableMarkup('비교 지수·평가식·미확인 조건',`<p>능력치 비교 지수 ${formatNumber(Math.round(index))} · 실제 시험 점수로 환산하지 않습니다.</p>${personalSteps(forecast.unknowns??forecast.limitations??[])}${guideSources(array(forecast.sources).map(source=>source.id),forecast.sources)}`,'forecast-conditions'):''}</section>`;
}

function personalShortOperatingSteps(plan){
  const opening=array(plan.uniqueCards).concat(array(plan.memoryStages?.atStart)),after=array(plan.memoryStages?.afterMid);
  const targets=array(plan.midgamePlan?.acquisitionTargets).filter(card=>card.normalAcquisition?.eligible===true).slice(0,2);
  const show=cards=>cards.map(card=>personalCardVisual(card,22)).join(' / ');
  const openingNote=array(plan.openingPlan?.steps).find(step=>/보류|전력 턴/.test(step));
  return `<div class="easy-operating-steps"><div class="easy-operating-step"><strong>1</strong><div><h4>시작부터 사용할 카드</h4>${opening.length?show(opening):'<p>시작 카드의 확인이 필요해요.</p>'}<p>${openingNote?personalRich(openingNote):'고유기와 실제 시작 반입 카드를 기준으로 첫 시험을 준비합니다.'}</p></div></div><div class="easy-operating-step"><strong>2</strong><div><h4>${plan.context?.scenario==='hif'?'선발 1 이후 합류하는 메모리':'중간 시험 이후 합류하는 메모리'}</h4>${after.length?show(after):'<p>추가로 합류하는 선택 메모리가 없어요.</p>'}${after.length?'<p>첫 시험에는 사용할 수 없어요.</p>':''}</div></div><div class="easy-operating-step"><strong>3</strong><div><h4>육성 중 확보할 카드</h4>${targets.length?show(targets):'<p>현재 확인된 확보 후보가 없어요.</p>'}<p>실제 선택지와 해금·커스텀 조건을 확인한 뒤 가져갑니다.</p></div></div></div>`;
}

function personalizedPlanMarkup(result){
  const plan=result.personalizedPlan;if(!plan)return forecastOverviewMarkup(result);
  const details=`${personalSteps(plan.openingPlan?.steps)}${personalSteps(plan.midgamePlan?.steps)}${personalSteps(array(plan.missingCombinations).map(issue=>issue.message))}`;
  return `${forecastOverviewMarkup(result)}<section class="personalized-plan"><h3>반입 스킬과 덱 운영 준비</h3>${personalShortOperatingSteps(plan)}${expandableMarkup('합류 시점·성장·운영 조건 자세히',details,'personal-plan-details')}</section>`;
}

function startPersonalizedAnalysis(){ui.personalizedComparison=null;ui.personalizedLoading=false;ui.personalizedError='';renderRecommendation();}
