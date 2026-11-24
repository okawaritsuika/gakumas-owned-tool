'use strict';

function expandableMarkup(label,body,key,className=''){return body?`<details class="easy-details ${className}" data-detail-key="${escapeHtml(key)}"><summary>${escapeHtml(label)}</summary><div class="easy-details-body">${body}</div></details>`:'';}
function currentPlaybook(result){return result?.accountPlaybook??null;}
function runFlowGuidanceMarkup(result){
  const data=result.runFlowGuidance,stages=array(data?.stages);if(!stages.length)return '';
  const current=stages.find(stage=>stage.id===ui.runFlowStageId)??stages[0];
  return `<section class="easy-run-flow" id="runFlowGuidance"><h3>시험은 이 순서로 진행하세요</h3><nav aria-label="시험 진행 단계">${stages.map((stage,index)=>`<button type="button" data-flow-stage="${escapeHtml(stage.id)}" aria-pressed="${stage.id===current.id}"><span>${index+1}</span>${escapeHtml(stage.label)}</button>`).join('')}</nav><div id="runFlowDetail">${runFlowStageMarkup(current,data)}</div></section>`;
}
function runFlowStageMarkup(stage,data){
  const steps=array(stage?.steps),sources=steps.flatMap(step=>array(step.sourceRefs));
  const accountNotes=stage.id==='opening'?array(data.accountPlan?.openingSteps):stage.id==='setup'?array(data.accountPlan?.midgameSteps):[];
  const sourceLinks=[...new Map(sources.map(ref=>[ref.url+'|'+ref.startSec,ref])).values()].map(ref=>{const safe=safeSourceUrl(ref.url);if(!safe)return '';const url=new URL(safe);if(Number.isInteger(ref.startSec)&&ref.startSec>=0)url.searchParams.set('t',ref.startSec+'s');const profile=array(data.sourceProfiles).find(row=>row.id===ref.sourceId);return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(profile?.title||'공략 원문')}${Number.isInteger(ref.startSec)?' · '+Math.floor(ref.startSec/60)+':'+String(ref.startSec%60).padStart(2,'0'):''}</a>`;}).join(' · ');
  const stateLabel={needs_hif_memory:'해당 HIF 어빌리티를 먼저 준비',needs_acquisition_or_unlock:'카드 획득·해금 후 사용',needs_trigger_acquisition:'발동 대상 카드를 먼저 확보',needs_trigger_confirmation:'어빌리티 발동 대상·조건 확인 필요'};
  const cardState={at_start:'시작 덱',after_selection_1:'선발 1 후 합류',conditional_during:'도중에 얻은 후 사용',missing:'현재 획득 조건 미충족',unknown:'획득 조건 확인'};
  const cardsMarkup=cards=>cards.map(card=>`<div>${memorySkillVisualMarkup(card,{size:32,showJapanese:true})}<small class="easy-flow-card-state">${escapeHtml(cardState[card.availability]||'사용 조건 확인')}</small></div>`).join('');
  return `<ol class="easy-flow-steps">${steps.map(step=>`<li><div>${array(step.cardRefs).length?`<div class="easy-flow-cards">${cardsMarkup(step.cardRefs)}</div>`:''}${stateLabel[step.status]?`<span class="easy-state-pill">${stateLabel[step.status]}</span>`:''}<p>${memoryRichTextMarkup(text(step.text))}</p></div></li>`).join('')}</ol>${accountNotes.length?expandableMarkup('내 반입 카드의 운영·합류 조건',`<ul>${easyAdviceList(accountNotes)}</ul>`,'flow-account-'+stage.id):''}${expandableMarkup('이 단계의 조건·원문 구간',`<ul>${easyAdviceList(steps.flatMap(step=>array(step.conditions)).concat(array(data.limitations)))}</ul>${sourceLinks?'<p>'+sourceLinks+'</p>':''}`,'flow-stage-'+stage.id)}`;
}
const activityNames={consult:['상담','相談'],outing:['외출','お出かけ'],supply_gift:['사시이레','差し入れ'],activity_supply:['활동 지급','活動支給'],lesson:['레슨','レッスン'],sp_lesson:['SP 레슨','SPレッスン'],class:['수업','授業'],rest:['휴식','休む'],sleep:['휴식','休む'],special_training:['특별지도','特別指導'],exam:['시험','試験'],interval:['인터벌','インターバル'],self_lesson:['자율 레슨','自主レッスン'],legend_lesson:['레전드 레슨','レジェンドレッスン'],business:['영업','営業'],audition_first:['1차 오디션','1次オーディション'],audition_second:['2차 오디션','2次オーディション'],audition_final:['최종 오디션','最終オーディション'],intensive_lesson:['막판 스퍼트 레슨','追い込みレッスン'],hajime_mid_exam:['중간 시험','中間試験'],hajime_final_exam:['최종 시험','最終試験'],legend_mid_exam:['중간 시험','中間試験'],legend_final_exam:['최종 시험','最終試験']};
function routeActivityMeta(value){
  const row=typeof value==='string'?{activity:value}:value??{},activity=text(row.activity),lesson=/^(vo|da|vi)_(sp_)?lesson_(vo|da|vi)$/.exec(activity),school=/^class_(vo|da|vi)$/.exec(activity),legend=/^(vo|da|vi)_legend_lesson$/.exec(activity);
  const family=lesson?(lesson[2]?'sp_lesson':'lesson'):school?'class':legend?'legend_lesson':['final_exam','mid_exam','audition','exam'].includes(activity)?'exam':activity==='sleep'?'rest':activity==='supply'?'supply_gift':Object.hasOwn(activityNames,activity)?activity:'unknown';
  const axisCode=lesson?.[1]??school?.[1]??legend?.[1],subCode=lesson?.[3],axis=({vo:'vocal',da:'dance',vi:'visual'})[axisCode]??null,names=activityNames[family]??['행동 확인','未確認'];
  const art=({business:'class',self_lesson:'lesson',legend_lesson:'lesson',intensive_lesson:'lesson',hajime_mid_exam:'exam',hajime_final_exam:'exam',audition_first:'exam',audition_second:'exam',audition_final:'exam',legend_mid_exam:'exam',legend_final_exam:'exam'})[family]??family;
  return {family,axis,subAxis:({vo:'vocal',da:'dance',vi:'visual'})[subCode]??null,axisLabel:axisCode?axisCode[0].toUpperCase()+axisCode.slice(1):'',subLabel:subCode?subCode[0].toUpperCase()+subCode.slice(1):'',ko:names[0],ja:names[1],imageUrl:'/assets/actions/'+art+'.svg'};
}
function activityIconMarkup(activity){
  const meta=routeActivityMeta(activity);
  return `<span class="activity-picture activity-${meta.family}" aria-hidden="true"><img src="${meta.imageUrl}" width="48" height="48" alt="" decoding="async"></span>`;
}
const playbookLiveStates=new WeakMap();
const playbookWeekRequests=new WeakMap();
function routeShortfallMarkup(result,row,meta){
  if(row.stage!=='final'||!['lesson','sp_lesson','class'].includes(meta.family))return '';
  const remaining=array(result.preparationReadiness?.finals).find(exam=>exam.examIndex===3)?.remaining;
  const labels={vocal:'보컬',dance:'댄스',visual:'비주얼'};
  const missing=[...new Set([meta.axis,meta.subAxis])].filter(axis=>labels[axis]&&remaining?.[axis]>0);
  if(!missing.length)return '';
  return '<span class="route-shortfall">부족 예상'+missing.map(axis=>
    '<span><img src="/assets/ui/recommend/'+axis+'.png" alt="'+labels[axis]+'" width="12" height="12">'+formatNumber(remaining[axis])+'</span>').join('')+'</span>';
}
function dayRouteOverviewMarkup(result){
  const book=currentPlaybook(result);if(!book)return '';
  const context=book.scheduleContext??{},sourceScenario=context.sourceScenario??book.context?.scenario,selectedScenario=result.scoreSummary?.scenario??ui.recommendationRequest?.scenario??book.context?.scenario;
  const mismatch=sourceScenario&&selectedScenario&&sourceScenario!==selectedScenario;
  const reference=context.status==='reference_schedule',unit=reference?'주':'일';
  const rows=array(book.weekPlan).filter(row=>Number.isInteger(row.week)&&row.week>0).slice().sort((a,b)=>a.week-b.week);
  if(mismatch||!rows.length||['scenario_schedule_mismatch','unsupported_scenario','missing_schedule'].includes(context.status))return `<section class="day-route-overview route-unavailable" id="dayRouteOverview"><h3>日程 · 날짜별 행동</h3><p>${escapeHtml(context.warning||'선택한 시나리오의 날짜별 계획을 확인하지 못했어요. 다른 시나리오의 일정으로 대신 표시하지 않습니다.')}</p></section>`;
  const selected=rows.find(row=>row.week===ui.playbookWeek)??rows[0],groups=new Map();
  for(const row of rows){const key=row.stage??'produce';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  const cell=row=>{
    const meta=routeActivityMeta(row),names=new Map();
    for(const option of array(row.alternatives)){const other=routeActivityMeta(option);const key=other.family+'|'+other.axis;if(!names.has(key))names.set(key,other);}
    const alternatives=[...names.values()],label=row.label||`${row.week}번째 일정`,isSelected=row.week===selected.week;
    const day=weekAdvice(row)?.day,spUnconfirmed=meta.family==='sp_lesson'&&day?.fields.sp;
    const otherTitle=alternatives.map(other=>(other.axisLabel?other.axisLabel+' ':'')+other.ko).join(' · ');
    const activities=[meta,...alternatives];
    const title=spUnconfirmed?row.activityLabel.replace('SP 레슨','레슨'):row.assumed?row.activityLabel:meta.ko;
    const japanese=spUnconfirmed?activityNames.lesson[1]:meta.ja;
    const referenceAxes=reference?activities.filter(option=>option.axisLabel).map(option=>option.axisLabel).join(' · '):'';
    const spLabel=({available:'SP 진행 가능',absent:'SP 미등장',blocked:'SP 체력 부족'})[day?.spStatus];
    const fixedLabel=meta.imageUrl.endsWith('/exam.svg')||meta.family==='interval'?'고정 일정':
      day?.fields.sp?spLabel||'SP는 등장 시':day?.kind??'직접 고를 행동';
    const accessibleLabel=row.assumed?title:reference?title:row.activityLabel||meta.ko;
    const axisMarkup=referenceAxes?`<span class="route-axis-label">${escapeHtml(referenceAxes)}</span>`:
      !reference&&meta.axis?`<span class="route-axis-label">${meta.axisLabel}${meta.subLabel?`<small> + ${meta.subLabel}</small>`:''}</span>`:'';
    return `<button type="button" class="day-route-cell${!reference&&meta.axis?' route-axis-'+meta.axis:''}${meta.imageUrl.endsWith('/exam.svg')?' route-exam':''}" data-route-week="${row.week}" aria-pressed="${isSelected}" aria-haspopup="dialog" aria-controls="routeDayDialog" aria-label="${escapeHtml(label+' · '+accessibleLabel+(!reference&&otherTitle?' · 다른 선택 '+otherTitle:''))}"><span class="route-day-number">${row.eventPhase?'당일':Number.isInteger(row.displayDay)?row.displayDay:Number.isInteger(row.displayWeek)?row.displayWeek:row.week}<small>${row.eventPhase?escapeHtml(row.eventPhase):unit+'차'}</small></span><img class="route-action-art" src="${spUnconfirmed?'/assets/actions/lesson.svg':meta.imageUrl}" width="40" height="40" alt="" decoding="async"><strong>${escapeHtml(title)}</strong><span class="route-action-jp" lang="ja">${escapeHtml(japanese)}</span>${axisMarkup}${alternatives.length?`<span class="route-alternative-icons" title="${escapeHtml('다른 선택: '+otherTitle)}">${alternatives.slice(0,3).map(other=>`<img src="${other.imageUrl}" width="14" height="14" alt="${escapeHtml((other.axisLabel?other.axisLabel+' ':'')+other.ko)}">`).join('')}${alternatives.length>3?`<small>+${alternatives.length-3}</small>`:''}</span>`:''}<span class="route-fixed-label">${escapeHtml(fixedLabel)}</span>${routeShortfallMarkup(result,row,meta)}</button>`;
  };
  const content=[...groups].map(([stage,days])=>{const provided=array(context.groups).find(group=>group.stage===stage),label=provided?.label??({selection:'선발',final:'본선'})[stage]??'육성',calendarDays=provided?.days??new Set(days.map(row=>row.displayDay??row.displayWeek??row.week)).size;return `<section class="route-day-group"><div class="route-group-heading"><h4>${escapeHtml(label)}</h4><span>확인된 ${calendarDays}${unit}${days.length>calendarDays?' · '+days.length+'개 일정':''}</span></div><div class="route-day-grid">${days.map(cell).join('')}</div></section>`;}).join('');
  const eventUnverified=context.status==='base_schedule_event_override_unverified'||result.eventContext?.status!=='disabled'&&Boolean(result.eventContext?.modeId)&&!context.status;
  const warning=context.warning||(eventUnverified?'일반 HIF의 기본 일정입니다. 아사리 회차에 별도 일정 변경이 있는지는 확인하지 못했어요.':'');
  const source=reference?safeSourceUrl(context.sourceUrl):null;
  const note=reference?`일반 모드의 기본 선택지입니다. ${sourceScenario==='nia'?'휴식은 실제 게임에서 가능한 주차와 남은 횟수를 확인하세요.':''}${source?` <a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">일정 출처</a>`:''}`:'계산한 추천 동선이며 실제 진행 날짜를 자동으로 읽은 표는 아니에요.';
  return `<section class="day-route-overview" id="dayRouteOverview"><div class="route-overview-heading"><h3>날짜별 추천 행동 한눈에</h3><span class="route-selected-day" data-route-selected-label>선택한 날 · ${escapeHtml(selected.label||String(selected.week))}</span></div><p class="route-overview-intro">${escapeHtml(context.label||'계산한 경로에 있는 날짜만 표시합니다.')} · ${reference?'주차를 누르면 선택지 창이 열려요.':'날짜를 누르면 그날의 선택지 창이 열려요.'}</p>${warning?`<p class="route-schedule-warning">${escapeHtml(warning)}</p>`:''}${content}<p class="route-overview-legend"><span class="route-legend-vo">Vo 보컬</span><span class="route-legend-da">Da 댄스</span><span class="route-legend-vi">Vi 비주얼</span><span>작은 그림은 그날의 다른 선택</span></p><p class="route-overview-note">${note}</p></section>`;
}
function selectPlaybookWeek(week){
  const book=currentPlaybook(personalizedDisplayResult(ui.recommendation)),row=array(book?.weekPlan).find(row=>row.week===week);if(!row)return;
  ui.playbookWeek=week;
  for(const button of document.querySelectorAll('[data-route-week]'))button.setAttribute('aria-pressed',String(Number(button.dataset.routeWeek)===week));
  const label=document.querySelector('[data-route-selected-label]');if(label)label.textContent='선택한 날 · '+(row.label||String(week));
  return row;
}
function openPlaybookWeekDialog(button){
  const row=selectPlaybookWeek(Number(button.dataset.routeWeek));
  if(!row)return;
  const dialog=document.getElementById('routeDayDialog');
  document.getElementById('routeDayDialogTitle').textContent=row.label;
  document.getElementById('routeDayDialogContent').innerHTML=weekActionMarkup(row);
  dialog.showModal();
  dialog.scrollTop=0;
  dialog.addEventListener('close',()=>{
    const trigger=button.isConnected?button:document.querySelector(`[data-route-week="${row.week}"]`);
    trigger?.focus({preventScroll:true});
  },{once:true});
}
function activityTitleMarkup(activity,fallback){const names=activityNames[activity];return bilingualMarkup(names?.[0]||fallback||'활동',names?.[1]||'','activity-title','activity-japanese');}
function supportRows(value){return Array.isArray(value)?value:[...array(value?.owned),...(value?.rental?[{...value.rental,isRental:true}]:[])];}
function currentLevelComparisonMarkup(result){
  const c=result.supportUpgradeComparison,assumption=result.supportLevelAssumption;
  const capped=assumption?.mode==='uncapMax';
  const title=capped?'현재 돌파 상한까지 강화한 편성':'지금 보유한 레벨의 편성';
  const upgrades=array(assumption?.upgrades);
  const summary=capped?(upgrades.length?upgrades.map(card=>escapeHtml(card.nameKo||card.name)+' Lv.'+card.currentLevel+' → '+card.targetLevel).join(' · '):'선택한 보유 카드 중 추가 레벨업을 가정한 카드가 없습니다.'):'각 보유 카드의 현재 레벨로 해금 효과를 계산했습니다.';
  const unknown=assumption?.unknownCount?`<p>보유 레벨·돌파·상한을 대조하지 못한 카드 ${formatNumber(assumption.unknownCount)}장은 확인된 수치만 사용했습니다.</p>`:'';
  const row=(label,values)=>`<tr><th>${label}</th>${['vocal','dance','visual'].map(axis=>`<td>${formatNumber(values?.[axis])}</td>`).join('')}</tr>`;
  const comparison=c?.available?`<table class="easy-level-table"><thead><tr><th>같은 활동 방침의 레벨별 비교</th><th>Vo</th><th>Da</th><th>Vi</th></tr></thead><tbody>${row('현재 레벨',c.currentStats)}${row('현재 돌파 상한',c.upgradedStats)}</tbody></table>${expandableMarkup('강화 전후 편성 보기',supportUpgradeMarkup(result),'support-upgrades')}`:c?.reason?`<p>${escapeHtml(c.reason)}</p>`:'';
  return `<section class="easy-level-comparison" id="levelComparison"><h3>${title}</h3><p>${summary}</p>${unknown}${comparison}</section>`;
}
function activityRouteComparisonMarkup(result){
  const c=result.activityRouteComparison;if(!array(c?.candidates).length)return '';
  const routeCards=c.candidates.map(candidate=>{
    const stats=candidate.scoreSummary?.hifModel?.cappedStats??candidate.scoreSummary?.projectedStats,counts=candidate.activityCounts??{};
    const deck=supportRows(candidate.supports),stages=array(candidate.resources?.stages);
    const resources=stages.map(stage=>`<p>${escapeHtml(stage.label)} · PP 수입 ${ledgerRange(stage.pp?.incomeRange)} / 지출 ${ledgerRange(stage.pp?.spendRange)}</p>`).join('');
    const deckDetails=`${recommendationGroup('이 경로의 서포트',deck,'확인할 편성이 없어요.',true)}${recommendationGroup('이 경로의 메모리',candidate.memories,'확인할 메모리가 없어요.',false,'memories')}${resources}`;
    return `<article class="easy-route-card${candidate.selected?' selected':''}"><div class="easy-activity-heading">${activityIconMarkup(candidate.focus)}<div>${activityTitleMarkup(candidate.focus,candidate.label)}${candidate.selected?'<span class="easy-state-pill">현재 선택</span>':''}</div></div><p class="easy-route-stats">Vo ${formatNumber(stats?.vocal)} · Da ${formatNumber(stats?.dance)} · Vi ${formatNumber(stats?.visual)}</p><p>상담 ${formatNumber(counts.consult??0)} · 외출 ${formatNumber(counts.outing??0)} · 사시이레 ${formatNumber(counts.supply_gift??counts.activity_supply_gift??0)}회</p>${expandableMarkup('편성·수지 보기',deckDetails,'route-'+candidate.focus)}${candidate.selected?'':`<button type="button" class="button button-secondary" data-route-choice="${candidate.focus}">이 경로로 준비</button>`}</article>`;
  }).join('');
  return `<section class="easy-route-comparison"><h3>어디에 자주 갈지에 따라 편성도 달라져요</h3><p class="easy-small-note">각 경로에서 선택한 계산 레벨·공략 후보·메모리를 다시 비교했어요. PP·체력은 아래 수지에서 따로 확인하세요.</p><div class="easy-route-grid">${routeCards}</div>${expandableMarkup('경로를 고른 기준·조건',`<p>${escapeHtml(c.selectionBasis)}</p><ul>${easyAdviceList(c.limitations)}</ul>`,'route-conditions')}</section>`;
}
function renderEventModeOptions(){
  const select=$('eventModeSelect'),previous=select.value||ui.rememberedEventModeId||'';
  select.innerHTML='<option value="">일반 프로듀스</option>'+array(ui.eventModes?.modes).map(mode=>`<option value="${escapeHtml(mode.id)}">${escapeHtml(mode.nameKo||mode.nameJa)}</option>`).join('');
  if([...select.options].some(option=>option.value===previous))select.value=previous;
  ui.rememberedEventModeId='';
}
function eventAcquisitionMarkup(context){
  const rows=array(context.acquisitionCandidates);if(!rows.length)return '';
  const eligible=rows.filter(card=>card.availability==='eligible'),utility=eligible.filter(card=>card.effectRole?.category==='general_utility_with_cost'),conditional=eligible.filter(card=>card.effectRole?.category!=='general_utility_with_cost'),checks=rows.filter(card=>card.availability!=='eligible');
  const cards=items=>items.map(card=>`<article class="easy-event-acquisition"><div>${memorySkillVisualMarkup(card,{size:36,showJapanese:true})}<span class="easy-card-status">${escapeHtml(plans[card.plan]||'플랜 확인 필요')} · ${card.availability==='eligible'?'이번 이벤트에서 등장 가능':card.availability==='locked'?'전환 해금·선택 확인':'등장 조건 확인 필요'}</span></div><p>${escapeHtml(card.effectRole?.summary||'효과와 사용 조건 확인 필요')}</p>${array(card.useConditions).length?`<ul>${easyAdviceList(card.useConditions)}</ul>`:''}</article>`).join('');
  return `<section class="easy-event-acquisition-section"><h4>이번 아사리에서 새로 얻을 다른 플랜 카드</h4><p class="easy-small-note">이번 회차 자료에서 확인한 ${rows.length}종입니다. 실제 선택지에 나왔을 때, 효과에 필요한 호조·집중 등의 조건을 함께 확인하세요.</p>${utility.length?`<div class="easy-event-grid">${cards(utility)}</div>`:''}${conditional.length?expandableMarkup('센스 효과·조건을 갖춰 고를 카드',`<div class="easy-event-grid">${cards(conditional)}</div>`,'event-acquire-conditional'):''}${checks.length?expandableMarkup('전환 해금·등장 조건이 남은 카드',`<div class="easy-event-grid">${cards(checks)}</div>`,'event-acquire-access'):''}</section>`;
}
function eventItemOperatingMarkup(context){
  const item=context.itemEffects;if(!item?.effectRole?.summary)return '';
  return `<div class="easy-event-item"><strong>${bilingualMarkup(item.nameKo||item.nameJa,item.nameJa,'event-item-name','activity-japanese')}</strong><p>${escapeHtml(item.effectRole.summary)}</p><p class="easy-small-note">센스 카드의 실제 사용 조건을 맞춰 발동을 준비하세요. 이번 회차 보고와 같은 원본 효과를 확인했으며, 게임의 아이템 설명도 대조하세요.</p></div>`;
}
function eventContextMarkup(result){
  const context=result.eventContext;if(!context||context.status==='disabled')return '';
  const goals=array(context.memoryTargets),selected=new Set(context.requestedSkillIds??[]),type=value=>({full_power:'fullPower',enthusiasm:'strength'})[value]||value,currentType=type(result.scoreSummary?.trainingType);
  const matches=goal=>array(goal.targetSpecs).some(spec=>type(spec.trainingType)===currentType),primary=goals.filter(matches),other=goals.filter(goal=>!matches(goal));
  const targets=rows=>rows.map(goal=>`<article class="easy-event-goal">${memorySkillVisualMarkup(goal,{size:32,showJapanese:true})}<p>${escapeHtml(array(goal.targetSpecs).filter(spec=>type(spec.trainingType)===currentType).map(spec=>spec.purpose).filter(Boolean).slice(0,2).join(' · ')||'다른 유형·장기 제작용 후보')}</p><small>보유 ${formatNumber(goal.ownedMemoryCount)}개 · 일반 등장 PLv ${formatNumber(goal.outsideEventProducerLevel)}${goal.normalRequiresSkillSwitch?' · 전환 해금·선택 필요':''}</small><button type="button" class="button button-secondary" data-event-rental-target="${escapeHtml(goal.gameId)}" aria-pressed="${selected.has(goal.gameId)}">${selected.has(goal.gameId)?'검색 목표 해제':'대여 검색 목표로 선택'}</button></article>`).join('');
  const applied=context.temporaryProduceConditions?.appliedToRecommendation===true||context.recommendationApplied===true;
  const issues=array(context.validation?.issues).map(issue=>issue.message);
  return `<section class="easy-event-context" id="eventChoices"><h3>${escapeHtml(context.mode?.nameKo||'이벤트 준비')}</h3>${context.mode?.nameJa?`<p lang="ja">${escapeHtml(context.mode.nameJa)}</p>`:''}<p>${applied?'PLv에 따른 카드·드링크 등장 제한을 면제해 획득 후보를 골랐어요. 스킬 전환의 해금·선택 조건은 함께 확인합니다.':'공식 이벤트 조건과 일반 편성을 함께 확인하는 준비 안내예요.'}</p>${eventItemOperatingMarkup(context)}${eventAcquisitionMarkup(context)}${expandableMarkup('가져갈 대여 메모리·제작 목표',`<p>메모리 대여는 총 ${formatNumber(context.rentalRules?.totalMemorySlots)}칸 중 ${formatNumber(context.rentalRules?.slotLimit)}칸이에요. 실제 친구 목록에서 사본을 확인해 주세요.</p>${context.selectedSkills?.length?`<div class="easy-rental-target"><strong>찾아볼 메모리</strong>${easySkillList(context.selectedSkills,30)}<p>스탯·합류 시점·커스텀이 확인되기 전에는 편성 수치에 더하지 않아요.</p></div>`:''}<p>현재 육성 유형의 공략 역할을 메우는 후보입니다.</p><div class="easy-event-grid">${targets(primary)}</div>${other.length?expandableMarkup('다른 유형·장기 제작 후보',`<div class="easy-event-grid">${targets(other)}</div>`,'event-other-goals'):''}`,'event-memory-goals')}${expandableMarkup('이벤트 규칙·미확인 조건과 출처',`<ul>${easyAdviceList(issues.concat(array(context.limitations)))}</ul>${guideSources(array(context.sources).map(source=>source.id),context.sources)}`,'event-rules')}</section>`;
}
function sourceGuideMarkup(result){
  const data=ui.guideSupportProfiles,evidence=result.sourceGuideEvidence??result.scoreSummary?.sourceGuideEvidence;
  const profile=array(data?.profiles).find(row=>row.id===evidence?.profileId&&row.idolCardId===result.selectedIdol?.gameId);
  if(!profile)return '';
  const all=[...array(profile.idealSupports),...array(profile.alternativeSupports)],owned=new Map(recordsOf('supportCards').map(row=>[recordId(row),row]));
  const cards=rows=>`<div class="easy-source-support-grid">${rows.map(card=>{const current=owned.get(card.gameId);return `<article>${visualFrame(assetUrl(card.thumbnailUrl,card.imageUrl),(card.nameKo||card.nameJa)+' 그림','easy-support-art')}<div><strong>${bilingualMarkup(card.nameKo||card.nameJa,card.nameJa,'source-support-name','activity-japanese')}</strong><small>${current?'보유 Lv.'+current.level+' · '+(uncapOf(current)??'미확인')+'돌':'현재 미보유 · 대여 확인 필요'}</small>${!current?`<button type="button" class="button button-secondary" data-rental-choice="${escapeHtml(card.gameId)}">빌려서 비교</button>`:''}</div></article>`;}).join('')}</div>`;
  const ideal=array(profile.idealSupports),matches=ideal.filter(card=>owned.has(card.gameId)).length;
  const notes=array(profile.operatingNotes).map(row=>`<li>${memoryRichTextMarkup(row.textKo)}</li>`).join(''),reference=evidence?.authorReferenceCandidate;
  const referenceComparison=reference?.available?`<h4>원문 6장을 같은 레벨 기준으로 계산한 경우</h4><p>Vo ${formatNumber(reference.cappedStats?.vocal)} · Da ${formatNumber(reference.cappedStats?.dance)} · Vi ${formatNumber(reference.cappedStats?.visual)}</p><p>선택안과 차이: ${['vocal','dance','visual'].map(axis=>`${{vocal:'Vo',dance:'Da',visual:'Vi'}[axis]} ${reference.selectedStatsDelta?.[axis]>0?'+':''}${formatNumber(reference.selectedStatsDelta?.[axis])}`).join(' · ')}</p><p>${escapeHtml(reference.note)}</p>`:'';
  const missing=ideal.filter(card=>!owned.has(card.gameId));
  return `<section class="easy-source-guide"><h3>이 아이돌의 공략과 대조</h3><p>원문 기준 ${escapeHtml(profile.sourceUpdated??profile.sourceAsOf??'날짜 미확인')} · 추천 서포트 ${ideal.length}종 중 ${matches}종 보유</p>${missing.length?`<h4>원문 추천 중 빌려서 비교할 카드</h4>${cards(missing)}`:''}${expandableMarkup('고유 카드 운영·원문 추천과 대안',`<ul>${notes}</ul>${cards(ideal)}${referenceComparison}<h4>공략의 대안 ${Math.max(0,all.length-ideal.length)}종</h4>${cards(array(profile.alternativeSupports))}<ul>${easyAdviceList(profile.conditions)}</ul><ul>${easyAdviceList(profile.limitations)}</ul>${guideSources(array(profile.sourceIds),data.sources)}`,'exact-idol-guide')}</section>`;
}
function supportLevelPreviewMarkup(){return '';}
function renderSupportComparisonControls(){
  const scenario=$('scenarioSelect').value;
  if(typeof syncScenarioItemControls==='function')syncScenarioItemControls();
  if($('hajimeDifficultyField'))$('hajimeDifficultyField').hidden=scenario!=='hajime';
  if($('niaDifficultyField'))$('niaDifficultyField').hidden=scenario!=='nia';
  if($('supportActionModeField'))$('supportActionModeField').hidden=scenario!=='hif';
  if($('supportPoolField'))$('supportPoolField').hidden=scenario!=='hif';
  if($('hifScenarioItemField'))$('hifScenarioItemField').hidden=scenario!=='hif'||Boolean($('eventModeSelect')?.value)||$('supportActionMode')?.value==='declared';
  if($('hifConsultPlanField'))$('hifConsultPlanField').hidden=$('hifScenarioItemField').hidden;
  const paths=array(ui.hifScenarioItemPaths),pathSelect=$('hifScenarioItemPath');
  if(pathSelect&&paths.length&&pathSelect.options.length!==paths.length+2){
    const value=pathSelect.value;
    pathSelect.innerHTML='<option value="auto">편성 효과에 맞춰 비교</option>'+paths.map(path=>`<option value="${escapeHtml(path.id)}">${escapeHtml(path.nameKo)}</option>`).join('')+'<option value="none">시나리오 아이템 효과 제외</option>';
    pathSelect.value=paths.some(path=>path.id===value)||value==='none'?value:'auto';
  }
  if($('excelRouteField'))$('excelRouteField').hidden=scenario!=='nia';
  const select=$('excelRoutePreset'),difficulty=$('niaDifficultySelect')?.value,plan=$('recommendPlan')?.value;
  const presets=array(ui.excelSupportPresets).filter(preset=>(!preset.difficulty||preset.difficulty===difficulty)&&(!preset.plan||preset.plan===plan));
  if(select&&ui.excelSupportPresets){const previous=select.value;select.innerHTML='<option value="auto">가능한 경로 자동 비교</option>'+presets.map(preset=>`<option value="${escapeHtml(preset.name)}">${escapeHtml(preset.name)}</option>`).join('');if(presets.some(preset=>preset.name===previous))select.value=previous;}
}
function supportSynergyMarkup(result,model){
  if(!model?.supportPeakScenario)return '';
  const rating=model.supportRating,peak=model.supportActionPlan?.peakScenario;
  const selected=new Map(supportRows(result.supports).map(card=>[card.gameId,card.nameKo||card.nameJa||card.name]));
  const rowName=id=>escapeHtml(selected.get(id)||'선택한 카드');
  const axisNames={vocal:'Vo',dance:'Da',visual:'Vi'};
  const actionNames={p_drink_acquire:'드링크 획득',drink_acquire:'드링크 획득',change:'카드 체인지',basic_card_change:'기본 카드 체인지',exam_15:'15장 이상으로 시험 종료',sp_lesson_20:'20장 이상으로 SP 레슨',skill_acquire:'스킬 카드 획득',ssr_card_acquire:'SSR 카드 획득',sr_card_acquire:'SR 카드 획득',a_skill_acquire:'액티브 획득',m_skill_acquire:'멘탈 획득',skill_enhance:'카드 강화',a_skill_enhance:'액티브 강화',m_skill_enhance:'멘탈 강화',delete:'카드 삭제',a_skill_delete:'액티브 삭제',m_skill_delete:'멘탈 삭제',copy:'복제',customize:'커스텀',upgrade:'강화',remove:'삭제',acquire:'카드 획득',drink_exchange:'드링크 교환',consult_skill_card_acquire:'상담에서 스킬 카드 획득',p_item_acquire:'P아이템 획득',p_drink_exchange:'드링크 교환',skills:'스킬 카드 구입',drinks:'드링크 구입'};
  function actionName(kind){
    if(actionNames[kind])return actionNames[kind];
    const match=/^(.+)_card_(acquire_8|acquire|enhance|delete)$/.exec(kind);
    const keywords={motivation:'의욕',vitality:'기력',good_impression:'호인상',focus:'집중',concentration:'집중',good_condition:'호조',full_power:'전력',strength:'강기',preservation:'온존',reserve:'온존'};
    return match&&keywords[match[1]]?keywords[match[1]]+' 카드 '+({acquire_8:'8장 조건 획득',acquire:'획득',enhance:'강화',delete:'삭제'})[match[2]]:'조건에 맞는 카드 효과';
  }
  const routeDrinks=peak?.routeDrinkReceipts,fromCards=model.supportProvidedActions?.p_drink_acquire??0;
  const scenarioItem=peak?.scenarioItem,fromScenario=scenarioItem?.receipts??0;
  const purchases=array(peak?.consultDrinkPurchases);
  const receiptDetails=Number.isFinite(routeDrinks)?`<p>드링크 획득 <strong>${formatNumber(routeDrinks+fromScenario+fromCards)}개</strong> · 경로 ${formatNumber(routeDrinks)}개${fromScenario?' + '+escapeHtml(scenarioItem.nameKo||'시나리오 아이템')+' '+formatNumber(fromScenario)+'개':''} + 서포트 ${formatNumber(fromCards)}개${purchases.length?' · 경로 중 상담 구매 '+formatNumber(purchases.reduce((n,p)=>n+p.count,0))+'개 ('+formatNumber(purchases.reduce((n,p)=>n+p.ppCost,0))+' P포인트)':''}</p>`:'';
  const purchasesByAction=array(peak?.purchases);
  const management=Object.entries(model.cardActionCounts??{}).filter(([key,n])=>['skill_enhance','delete','change','copy','customize'].includes(key)&&n>0)
    .map(([key,n])=>actionName(key)+' '+formatNumber(n)+'회').join(' · ');
  const managementText=management?`<p>이번 편성에서 대상이 확인된 카드 관리 · <strong>${management}</strong></p>`:'';
  const scenarioText=scenarioItem?.status==='conditional_path'?`<p>선택한 시나리오 아이템 · ${escapeHtml(scenarioItem.nameKo)}</p>`:'';
  const links=array(model.supportLinks).filter(link=>link.extraCount&&(link.pointsBeforeCap||link.producedDrinks||link.producedOperationCount>0)).map(link=>{
    const names=array(link.contributors).map(rowName).join(' · ');
    const signed=n=>(n>0?'+':'')+formatNumber(n);
    const outcome=[link.producedDrinks?'드링크 '+signed(link.producedDrinks)+'개':'',link.producedOperationCount?actionName(link.producedOperation)+' '+formatNumber(link.producedOperationCount)+'회':'',link.pointsBeforeCap?(axisNames[link.axis]||'스탯')+' '+signed(link.pointsBeforeCap):''].filter(Boolean).join(' · ');
    return `<li>${names?names+' → ':''}<strong>${rowName(link.receiverId)}</strong> · ${actionName(link.kind)} ${signed(link.extraCount)}회 · ${outcome}</li>`;
  }).join('');
  const score=Number.isFinite(rating?.partialEvaluationPoints)?`<p><strong>비교에 쓴 평가점 ${formatNumber(rating.partialEvaluationPoints)}점</strong> · 상한 적용 후 스탯 ${formatNumber(rating.statEvaluationPoints)}점${Number.isFinite(rating.badgeEvaluationPoints)?' · 와펜 '+formatNumber(rating.badgeEvaluationPoints)+'점 ('+formatNumber(rating.badgeActivationCount)+'회)':''}</p>`:'';
  const purchaseNotes=purchasesByAction.map(p=>{
    const when=p.venue==='interval'?'본선 1라운드 뒤 인터벌':p.week+'주차 '+({consult:'상담',special_training:'특별지도'}[p.venue]??'');
    const cost=p.ppCostRange?p.ppCostRange.min+'~'+p.ppCostRange.max:p.ppCost;
    return when+' · '+actionName(p.action)+' '+p.count+'회에 '+cost+' P포인트';
  });
  const assumptions=[...new Set([...array(peak?.conditions),...array(scenarioItem?.conditions),...purchaseNotes])];
  return `${score}${scenarioText}${receiptDetails}${managementText}${links?'<h4>카드 조합에 따른 발동 차이</h4><ul>'+links+'</ul><p class="easy-small-note">연계 스탯은 상한 적용 전 수치입니다. 상한을 반영한 기여는 각 카드의 효과·선택 이유에서 확인할 수 있습니다.</p>':''}${assumptions.length?expandableMarkup('이번 편성이 전제한 발동·구매 조건',`<ul>${easyAdviceList(assumptions)}</ul>`,'support-peak-conditions'):''}`;
}
function supportEvaluationMarkup(result){
  const summary=result.scoreSummary??{},plan=summary.hifModel?.supportActionPlan,excel=summary.excelSupportCounts;
  const labels={skill_acquire:'카드 획득',p_drink_acquire:'드링크 획득',p_drink_exchange:'드링크 교환',skill_enhance:'강화',delete:'삭제',change:'체인지',basic_card_change:'기본 카드 체인지',ssr_card_acquire:'SSR 획득'};
  const counts=summary.expectedCounts??{};
  const countText=Object.entries(labels).filter(([key])=>number(counts[key])!==null).map(([key,label])=>`${label} ${formatNumber(counts[key])}회`).join(' · ');
  const selection=new Set(supportRows(result.supports).map(card=>card.gameId)),owned=new Map(recordsOf('supportCards').map(card=>[recordId(card),card]));
  const reviewed=array(ui.supportVisualCatalog).filter(card=>card.advice&&owned.has(card.gameId)&&(!summary.plan||summary.plan==='free'||card.plan==='free'||card.plan===summary.plan));
  const candidates=reviewed.map(card=>{const current=owned.get(card.gameId),advice=card.advice;
    const details=`<p>${escapeHtml(advice.summary)}</p><ul>${easyAdviceList(advice.conditions)}</ul><p>${escapeHtml(advice.calculationNote)}</p>${array(advice.sources).map(source=>{const url=safeSourceUrl(source.url);return url?`<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a></p>`:'';}).join('')}`;
    return `<article class="support-review-card">${visualFrame(assetUrl(card.thumbnailUrl,card.imageUrl),(card.nameKo||card.nameJa)+' 그림','easy-support-art')}<div><strong>${escapeHtml(card.nameKo||card.nameJa)}</strong><small>보유 Lv.${escapeHtml(current.level??'미확인')} · ${escapeHtml(uncapOf(current)??'미확인')}돌 · ${selection.has(card.gameId)?'이번 편성에 포함':'이번 편성에서 미선택'}</small>${expandableMarkup('저돌파 역할·활용 조건',details,'support-review-'+card.gameId)}${selection.has(card.gameId)?'':`<button type="button" class="button button-secondary" data-rental-choice="${escapeHtml(card.gameId)}">이 카드 대여로 고정 비교</button>`}</div></article>`;
  }).join('');
  const pro = summary.hajimePro;
  const proLessonCount = activity => array(pro?.selections).filter(row => row.activity === activity).length;
  const basis=pro?`하지메 프로의 일반 레슨 ${proLessonCount('lesson')}회, SP 레슨 ${proLessonCount('sp_lesson')}회, 막판 스퍼트 ${proLessonCount('intensive_lesson')}회를 주차별 속성으로 계산했습니다. SP 출현과 퍼펙트 달성을 가정합니다. 서포트 이벤트를 포함하면 각 카드에서 해금된 고정 능력치·P포인트·체력 회복 보상이 한 번씩 발생하는 조건입니다. 덱 8장 조건의 효과는 실제 덱 구성과 카드 획득 시점, P아이템 효과는 수령 시점과 발동 조건을 확인해야 합니다.`:
    excel?.status==='user_excel_cached_reference'?`제공 엑셀의 「${excel.name}」 횟수로 비교했습니다. 엑셀의 캐시 가정이며 실제 획득 기록은 아닙니다.`:
    summary.hifModel?.supportPeakScenario?'리트로 선택한 경로의 SP 레슨과 발동 조건을 채운 경우입니다. 선발·본선의 스탯 상한을 각각 적용합니다. 본선 라운드 점수는 실제 플레이에서 결정됩니다.':
    plan?.basis==='planned_hif_route_opportunities'?'차입·외출·수업의 카드·드링크 기회와 기본 카드 삭제를 반영한 계획입니다. 카드 종류와 아이템 획득 시점은 별도 조건입니다.':'횟수가 확인되지 않은 효과는 능력치에 합산하지 않았습니다.';
  const evidence=`<p>${escapeHtml(basis)}</p>${supportSynergyMarkup(result,summary.hifModel)}${countText?`<p class="easy-small-note">서포트 추가분을 제외한 경로 행동 · ${escapeHtml(countText)}</p>`:''}<p>각 서포트의 계산 레벨에서 해금되는 효과를 사용합니다. 제공 스킬과 시험 P아이템의 전투 효능은 운영 안내에서 확인하세요.</p>${plan?.limitations?.length?expandableMarkup('행동 횟수의 선택 가정',`<ul>${easyAdviceList(plan.limitations)}</ul>`,'support-action-assumptions'):''}`;
  const reviewedCards=reviewed.length?expandableMarkup(`최신·저돌파 보유 카드 ${reviewed.length}종의 역할과 대조`,`<p>공략에서 확인한 효과와 활용 조건입니다. 일반 HIF의 완돌파 티어를 현재 사본이나 아사리의 순위로 옮기지 않습니다.</p><div class="support-review-grid">${candidates}</div>`,'support-reviewed-candidates'):'';
  return expandableMarkup('서포트 효과 계산 근거',evidence,'support-evaluation-evidence')+reviewedCards;
}
document.getElementById('scenarioSelect')?.addEventListener('change',renderSupportComparisonControls);
document.getElementById('supportActionMode')?.addEventListener('change',renderSupportComparisonControls);
document.getElementById('niaDifficultySelect')?.addEventListener('change',renderSupportComparisonControls);
document.getElementById('eventModeSelect')?.addEventListener('change',renderSupportComparisonControls);
function easySkillList(rows,size=24){return array(rows).map(card=>memorySkillVisualMarkup(card,{size,showJapanese:true})).join('');}
function easyAdviceList(rows){return array(rows).map(row=>`<li>${memoryRichTextMarkup(text(row))}</li>`).join('');}
function nextExamIndex(week){return week<=7?0:week<=13?1:week<=20?2:week<=27?3:4;}
function examRewardInputMarkup(result){
  if(ui.recommendationRequest?.scenario!=='hif')return '';
  const input=(index,key,label,value)=>`<label>${label}<input type="number" min="0" step="1" data-exam-input="${index}:${key}" value="${value??''}" placeholder="미입력"></label>`;
  const rows=[0,1,2].map(index=>{const current=array(ui.hifExamResults).find(row=>row.examIndex===index);return `<article><strong>선발시험 ${index+1}</strong><div class="easy-exam-reward-fields">${input(index,'score','획득 점수',current?.score)}${[['vocal','Vo 상승'],['dance','Da 상승'],['visual','Vi 상승']].map(([key,label])=>input(index,key,label,current?.parameterGains?.[key])).join('')}</div><label class="easy-reward-basis">입력 기준<select data-exam-basis="${index}"><option value="post_bonus"${current?.gainBasis!=='base'?' selected':''}>보상창의 성장 보정 후 상승량</option><option value="base"${current?.gainBasis==='base'?' selected':''}>성장 보정 전 기본 보상</option></select></label></article>`;}).join('');
  const count=array(result.scoreSummary?.hifModel?.examRewards).filter(row=>row.source==='manual_reward_input').length;
  return expandableMarkup(`시험 보상 스탯 입력 · ${count}/3회 반영`,`<p>시험 보상창의 Vo·Da·Vi 상승량을 넣으면 이후 시험과 최종 스탯을 다시 비교합니다. 세 속성을 함께 입력하세요. 0도 입력할 수 있어요.</p><p class="easy-small-note">점수만으로 스탯을 임의 환산하지 않아요. 비워 둔 시험은 최대 보상·균등 배분 참고 가정입니다.</p><div class="easy-exam-reward-grid">${rows}</div><div class="easy-reward-actions"><button type="button" class="button button-secondary" data-apply-exam-rewards>보상 스탯으로 다시 비교</button><button type="button" class="button button-secondary" data-reset-exam-rewards>입력 지우고 다시 비교</button></div><p data-exam-reward-status role="status"></p>`,'exam-reward-inputs');
}
function examScoreOverviewMarkup(result){
  const data=result.examScoreTargets,stages=array(data?.stages);if(!stages.length)return '';
  const rows=stages.map(stage=>{const star=array(stage.rewardTargets).find(row=>row.kind==='star_cap');return `<tr><th>${escapeHtml(stage.label)}</th><td>약 ${formatNumber(stage.pass?.guideScore)}</td><td>약 ${formatNumber(star?.targetScore)}</td></tr>`;}).join('');
  const event=data.status==='normal_reference_event_applicability_unknown';
  return `<section class="easy-exam-scores" id="examScoreTargets"><h3>선발시험에서 몇 점을 목표로 할까요?</h3><p>우선 통과 참고선을 넘기고, 여유가 있으면 스타성 보상 목표를 노리세요.</p><table><thead><tr><th>시험</th><th>통과 참고</th><th>스타성 보상 목표</th></tr></thead><tbody>${rows}</tbody></table><p class="easy-small-note">공략의 대략적인 목표입니다. 실제 통과 기준은 게임 화면의 돌파선이 우선이에요.${event?' 아사리 모드에는 일반 HIF 참고치로 표시합니다.':''}</p>${examRewardInputMarkup(result)}${expandableMarkup('능력치·스타성 보상 기준과 출처',`<ul>${stages.map(stage=>{const observation=array(stage.rewardTargets).find(row=>row.kind==='parameter_cap_observed'),star=array(stage.rewardTargets).find(row=>row.kind==='star_cap');return `<li>${escapeHtml(stage.label)}: 기본 스타성 최대 ${formatNumber(star?.baseReward)} · 능력치 보상 상한 관측 ${formatNumber(observation?.observedSufficientScore)}점 / 기본 합계 ${formatNumber(observation?.baseRewardTotal)}. 관측 점수를 정확한 최소 경계로 확정하지 않습니다.</li>`;}).join('')}</ul><ul>${easyAdviceList(data.limitations)}</ul>${guideSources(array(data.evidenceSources??data.sources).map(source=>source.id),data.evidenceSources??data.sources)}`,'exam-score-sources')}</section>`;
}
function modeGuidanceQuickLinks(result){return `${result.itemConsideration?'<a href="#itemConsideration">P아이템 반영</a>':''}${array(result.examScoreTargets?.stages).length?'<a href="#examScoreTargets">시험 점수 목표</a>':''}${array(result.eventContext?.acquisitionCandidates).length?'<a href="#eventChoices">아사리 추가 카드</a>':''}`;}
function weekAdvice(week){
  return ui.weekChoiceAdvice?.[week.week] ?? week.choiceAdvice;
}
function hifPathSteps(result){
  return array(result?.accountPlaybook?.weekPlan).flatMap(week=>
    array(week.choiceAdvice?.day?.reward?.items).filter(item=>item.preferred&&item.formKey));
}
function hasHifItemPath(result){return hifPathSteps(result).length>0;}
function hifItemPathMarkup(result){
  const rows=hifPathSteps(result).map(item=>{
    return '<li>'+visualFrame(item.imageUrl,item.name+' 게임 이미지','hif-path-icon')+'<strong>'+escapeHtml(item.name)+
      '</strong><small lang="ja">'+escapeHtml(item.gameName)+'</small><p>'+escapeHtml(item.effect)+'</p><small>'+escapeHtml('선발 '+item.fromExamIndex+' 뒤 선택 · '+item.timing)+'</small>'+
      (item.examStart?'<small>'+escapeHtml(item.examStart.timingKo+' · '+item.examStart.textKo)+'</small>':'')+'</li>';
  });
  return '<section class="support-evaluation hif-item-path" id="hifItemPath" tabindex="-1"><h3>HIF 육성 중 아이템</h3><ol>'+rows.join('')+'</ol></section>';
}
function dayRewardMarkup(day,choice){
  let cardMarkup='';
  if(choice?.kind==='legend'){
    const card=choice.detail?.recommended;
    cardMarkup='<section class="day-reward"><h4>합격 뒤 레전드 카드 선택</h4>'+
      (card?'<p>'+memorySkillVisualMarkup(card,{size:28})+' · '+escapeHtml(text(card.reason).split(' · ').slice(0,2).join(' · '))+'</p>':
        '<p>합격하고 카드 선택이 열리면 실제로 뜬 후보를 확인하세요.</p>')+'</section>';
  }
  if(!day.reward)return cardMarkup;
  const reward=day.reward;
  const lines=array(reward.shown).map(item=>'<li><strong>'+escapeHtml(item.name)+'</strong>'+
    (item.recommended?' <span class="day-reward-pick">추천</span>':item.conditional?' <span class="day-reward-pick">보이면 우선</span>':'')+
    (item.formKey&&item.conditional?'':' · '+escapeHtml(item.use))+'</li>').join('');
  return cardMarkup+'<section class="day-reward"><h4>'+escapeHtml(reward.label)+'</h4>'+
    (reward.state?'<p>'+escapeHtml(reward.state)+'</p>':'')+(lines?'<ul>'+lines+'</ul>':'')+'</section>';
}
function weekLiveInputMarkup(week){
  const book=currentPlaybook(personalizedDisplayResult(ui.recommendation));
  const state=playbookLiveStates.get(book)?.get(week.week)??{}, observation=state.observation??{};
  const advice=weekAdvice(week), day=advice?.day, choice=advice?.observedChoice, fields=day?.fields??{};
  const input=(name,label,value,key='data-week-value',max='')=>
    '<label>'+label+'<input type="number" min="0" step="1" '+max+' '+key+'="'+name+'" value="'+escapeHtml(value??'')+'" placeholder="미확인"></label>';
  let contents='';
  if(fields.sp){
    const options=[['','미확인'],['available','떴고 진행 가능'],['vocal','보컬 SP 가능'],['dance','댄스 SP 가능'],
      ['visual','비주얼 SP 가능'],['absent','안 떴음'],['blocked','떴지만 체력 부족']];
    contents+='<label>오늘 SP 레슨 <select data-week-sp>'+options.map(([value,label])=>
      '<option value="'+value+'"'+((state.spLessonAxis??state.spLessonStatus??'')===value?' selected':'')+'>'+label+'</option>').join('')+'</select></label>';
    if(array(advice.activities).some(row=>row.family==='lesson')){
      contents+='<fieldset class="day-reward-offers"><legend>실제로 SP가 뜬 속성</legend>'+
        [['vocal','보컬'],['dance','댄스'],['visual','비주얼']].map(([axis,label])=>
          '<label><input type="checkbox" data-week-sp-attribute="'+axis+'"'+(state.spLessonAttributes?.includes(axis)?' checked':'')+'> '+label+'</label>').join('')+
        '</fieldset>'+input('stamina','현재 체력 (선택)',state.stamina);
    }
  }
  if(choice?.kind==='hif'||choice?.activity==='business')
    contents+=input('pp',choice.kind==='hif'?'R1 보상 수령 후 실제 잔여 P':'현재 P',state.pp);
  if(choice?.activity==='business'||array(advice?.activities).some(row=>row.activity==='outing')&&
    array(advice?.activities).some(row=>row.activity==='supply_gift'))contents+=input('stamina','현재 체력',state.stamina);
  if(choice?.kind==='legend')contents+=legendMidtermInputs(observation);
  if(choice?.kind==='hif')contents+=hifIntervalInputs(observation);
  if(choice?.kind==='nia'){
    if(choice.activity==='business'&&book.weekPlan.some(row=>row.week>week.week&&row.activity.startsWith('audition_')))
      contents+=input('fanVotes','현재 팬 투표',observation.fanVotes,'data-week-observation');
    contents+=niaChoiceInputs(observation,choice.activity);
  }
  if(day?.reward?.items.length){
    contents+='<fieldset class="day-reward-offers"><legend>'+escapeHtml(day.reward.label)+' · 화면에 뜬 보기</legend>'+
      day.reward.items.map(item=>'<label><input type="checkbox" data-week-reward="'+escapeHtml(item.id)+'"'+
        (observation.rewardItemOffers?.includes(item.id)?' checked':'')+'> '+escapeHtml(item.name)+
        (item.gameName?' <small lang="ja">'+escapeHtml(item.gameName)+'</small>':'')+'</label>').join('')+'</fieldset>';
  }
  if(!contents)return '';
  return expandableMarkup('게임 화면의 선택지 입력',contents+
    '<button type="button" class="button button-secondary" data-week-recalculate="'+week.week+'">현재 값으로 비교</button><p data-week-input-status role="status"></p>',
    'week-live-inputs','day-live-inputs');
}
function dayPicksMarkup(picks){
  const group=(label,rows,render)=>rows.length?'<section class="day-pick-group"><h4>'+label+'</h4><ul>'+
    rows.map(row=>'<li>'+render(row)+'<p>'+escapeHtml(row.dayReason??row.reason)+'</p></li>').join('')+'</ul></section>':'';
  const cards=group('스킬 카드',array(picks?.cards),card=>memorySkillVisualMarkup(card,{size:32}));
  const drinks=group('드링크',array(picks?.drinks),drink=>'<span class="day-drink">'+
    visualFrame(drink.imageUrl,drink.name+' 그림','day-drink-art')+'<strong>'+escapeHtml(drink.name)+'</strong></span>');
  return cards||drinks?'<section class="day-picks" aria-label="보이면 우선"><strong class="day-pick-label">보이면 우선</strong><div>'+cards+drinks+'</div></section>':'';
}
function weekActionMarkup(week){
  const advice=weekAdvice(week);
  const day=advice?.day??{kind:'직접 고를 행동',press:week.activityLabel||routeActivityMeta(week).ko,
    why:'',fallback:array(week.alternatives).map(row=>row.label||routeActivityMeta(row).ko).join(' · ')};
  const result=personalizedDisplayResult(ui.recommendation);
  const deckLink=result?.recommendedDeck?.dateLinks?.[week.week] ??
    (!result?.recommendedDeck&&result?.hifGuide?.deck&&day.kind==='고정 일정'?'시험 카드 사용 순서':'');
  const pathLink=day.reward?.items?.some(item=>item.formKey&&item.preferred) && hasHifItemPath(result);
  return '<section class="day-action"><header class="day-action-header">'+activityIconMarkup(day.activity||week.activity)+
    '<div><h4>'+escapeHtml(day.kind)+'</h4><p>'+escapeHtml(day.press)+'</p></div></header>'+
    dayPicksMarkup(day.picks)+'<dl>'+
    [['왜',day.why],['이 편성에서',day.supportChoice],['없으면',day.kind==='고정 일정'&&day.reward?'':day.fallback]]
      .filter(([,value])=>value).map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+escapeHtml(value)+'</dd></div>').join('')+'</dl></section>'+
    dayRewardMarkup(day,advice?.observedChoice)+
    (deckLink||pathLink?'<nav class="day-guide-links" aria-label="이 날짜와 관련된 공략">'+
      (deckLink?'<a data-day-guide href="#recommendedDeck">'+escapeHtml(deckLink)+'</a>':'')+
      (pathLink?'<a data-day-guide href="#hifItemPath">포치 경로와 발동 효과</a>':'')+'</nav>':'')+
    weekLiveInputMarkup(week);
}
function weekDialogMarkup(){
  return '<dialog id="routeDayDialog" class="detail-dialog route-day-dialog" aria-labelledby="routeDayDialogTitle"><form class="dialog-top" method="dialog"><h3 id="routeDayDialogTitle"></h3><button type="submit" class="icon-button" aria-label="날짜별 선택지 닫기" autofocus>×</button></form><div id="routeDayDialogContent"></div></dialog>';
}
function cardCautionsMarkup(book){
  const cards=rows=>rows.map(card=>'<article class="easy-tip-card">'+memorySkillVisualMarkup(card,{size:30,showJapanese:true})+
    '<p>'+memoryRichTextMarkup(text(card.reason))+'</p></article>').join('');
  const avoid=array(book.avoidCards).filter(card=>['conflict','low_priority'].includes(card.category));
  const access=array(book.lockedCards).concat(array(book.unresolvedCards));
  return expandableMarkup('고를 때 주의할 카드',cards(avoid),'card-cautions')+
    expandableMarkup('아직 해금·확인이 필요한 카드',cards(access),'card-access-checks')+
    expandableMarkup('유형 공통의 선택형 참고 카드',cards(array(book.optionalCards)),'optional-character-cards');
}
function ledgerRange(value){if(!value||number(value.min)===null)return '미확인';if(number(value.max)===null)return `${formatNumber(value.min)} 이상 · 상한 미확인`;return value.min===value.max?formatNumber(value.min):`${formatNumber(value.min)}~${formatNumber(value.max)}`;}
function itemConsiderationMarkup(result){
  const data=result.itemConsideration;if(!data?.categories)return '';
  const names={support:'서포트 P아이템',scenario:'시나리오 P아이템',unique:'아이돌 고유 P아이템',event:'이벤트 P아이템'},states={conditional_peak_included:'추천 경로의 발동 반영',partial_included:'확인된 효과 반영',conditional_only:'조건부 범위',partial_reference_only:'일부 규칙만 반영',identity_and_conditions_only:'운영 조건 참고',not_included:'수치 미반영',unavailable:'자료 미연결',not_selected:'선택 안 함'};
  const range=value=>Array.isArray(value)?value[0]===value[1]?formatNumber(value[0]):formatNumber(value[0])+'~'+formatNumber(value[1]):'미확인';
  const itemRows=array(data.categories.support?.items).map(item=>`<article class="easy-item-coverage-row"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.supportName)} · Lv.${formatNumber(item.level)}</small><p>${escapeHtml(item.summary)}</p><p>획득·발동 확인분 ${['vocal','dance','visual'].map(axis=>`${{vocal:'Vo',dance:'Da',visual:'Vi'}[axis]} ${formatNumber(item.included?.stats?.[axis])}`).join(' · ')} / PP ${formatNumber(item.included?.resources?.pp)} · 회복 ${formatNumber(item.included?.resources?.hpRecovery)}</p>${item.rankedProjection?`<p>추천 경로의 발동 ${formatNumber(item.rankedProjection.routeActivationCount)}회 · 드링크 ${formatNumber(item.rankedProjection.resources?.pDrinkAcquisitions)}개 · ${['vocal','dance','visual'].map(axis=>({vocal:'Vo',dance:'Da',visual:'Vi'})[axis]+' '+formatNumber(item.rankedProjection.stats?.[axis])).join(' · ')}</p>`:''}${item.conditional?.ranges?`<p>조건을 채웠을 때의 범위: ${['vocal','dance','visual'].map(axis=>`${{vocal:'Vo',dance:'Da',visual:'Vi'}[axis]} ${range(item.conditional.ranges.stats?.[axis])}`).join(' · ')} / PP ${range(item.conditional.ranges.resources?.pp)} · 회복 ${range(item.conditional.ranges.resources?.hpRecovery)}</p>`:''}<ul>${easyAdviceList(item.conditions)}</ul></article>`).join('');
  const categories=Object.entries(data.categories).filter(([,category])=>category.actualCoverage!=='not_selected').map(([key,category])=>`<article><strong>${names[key]}</strong><span class="easy-state-pill">${escapeHtml(states[category.actualCoverage]||'확인 필요')}</span><p>${escapeHtml(category.summary)}</p></article>`).join('');
  const guidance=array(data.categories.scenario?.choiceGuidance).map(row=>`<li><strong>${escapeHtml(row.when)}</strong> · ${escapeHtml(row.reason)}</li>`).join('');
  return `<section class="easy-item-coverage" id="itemConsideration"><h3>P아이템은 어디까지 반영했나요?</h3><div class="easy-item-coverage-grid">${categories}</div>${expandableMarkup('서포트 P아이템별 반영 수치·발동 조건',itemRows,'item-coverage-supports')}${guidance?expandableMarkup('동선에 맞는 시나리오 P아이템 선택 기준',`<ul>${guidance}</ul><p class="easy-small-note">${data.categories.scenario?.rankedDrinkPath?.receipts>0?'이번 추천은 선발 보상에서 드링크 지급 경로를 고르는 조건입니다.':'실제로 고른 색상·장식·개조는 직접 확인하세요.'}</p>${guideSources(array(data.sources).map(source=>source.id),data.sources)}`,'scenario-item-guidance'):''}</section>`;
}
function memoryCustomizationSummaryMarkup(record){
  const row=array(ui.recommendation?.customizationReadiness?.memories).find(item=>item.memoryId===recordId(record));if(!row)return '';
  const checks=array(row.guide?.required),status={fulfilled:'충족',missing:'미충족',unknown:'미확정',not_specified:'조건 명시 없음'};
  return `<div class="easy-memory-custom"><span>현재 개조</span><strong>${escapeHtml(row.actualSummary)}</strong>${checks.length?`<small>공략의 반입 개조: ${checks.map(check=>escapeHtml(status[check.status]||'미확정')).join(' · ')}</small>`:''}</div>`;
}
function hifTargetAvailabilityLabel(value){return({at_start:'대상 카드가 시작부터 있음',after_selection_1:'대상 카드가 선발 1 후 합류',conditional_during:'대상 카드를 도중에 얻은 후 활용',missing:'대상 카드 확보 조건 미충족',inapplicable:'현재 조건에서 발동 불가',unknown:'발동 대상·조건 확인 필요'})[value]||'발동 조건 확인 필요';}
function hifEffectMarkup(effect,allowChoice=false){
  allowChoice=allowChoice&&$('memorySelectionMode').value==='guide';
  const cards=array(effect.triggerCards),selected=ui.selectedHifEffectIds.includes(effect.effectId),limits=array(effect.activationLimits).filter(value=>number(value)!==null&&number(value)>0);
  const description=text(effect.effectSummary)||text(effect.summary)||text(effect.text)||text(effect.descriptionJa);
  return `<div class="easy-hif-effect">${cards.length?`<div class="easy-hif-triggers"><span>발동할 카드</span>${easySkillList(cards,28)}</div>`:''}<p>${memoryRichTextMarkup(plainGameText(description))}</p><span class="easy-state-pill">${escapeHtml(hifTargetAvailabilityLabel(effect.targetAvailability))}</span>${limits.length?`<p class="easy-small-note">발동 한도 ${escapeHtml([...new Set(limits)].join(' · '))}회 · 실제 카드 사용 조건 확인</p>`:''}${allowChoice&&effect.effectId?`<button type="button" class="button button-secondary" data-hif-effect-choice="${escapeHtml(effect.effectId)}" aria-pressed="${selected}">${selected?'이 어빌리티 필수 조건 해제':'이 어빌리티 포함해 비교'}</button>`:''}</div>`;
}
function memoryHifSummaryMarkup(record){
  const data=ui.recommendation?.hifAbilityGuidance;if(!data||data.status==='unsupported_scenario')return '';
  const row=array(data.selectedMemories).concat(array(data.ownedCandidates)).find(row=>row.memoryId===recordId(record));
  if(!row)return '';
  if(!array(row.hifEffects).length)return '<div class="easy-memory-hif none">HIF 전용 어빌리티 없음</div>';
  return `<div class="easy-memory-hif"><strong>HIF 전용 어빌리티 ${row.hifEffects.length}개</strong>${row.hifEffects.map(effect=>`<small>${escapeHtml(text(effect.effectSummary)||text(effect.summary)||hifTargetAvailabilityLabel(effect.targetAvailability))}</small>`).join('')}</div>`;
}
function hifAbilityGuidanceMarkup(result){
  const data=result.hifAbilityGuidance;if(!data||data.status==='unsupported_scenario')return '';
  const owned=array(data.ownedCandidates),eligible=owned.filter(row=>row.eligible===true),locked=owned.filter(row=>row.eligible!==true);
  const goalMarkup=goal=>`<article class="easy-hif-goal">${memorySkillVisualMarkup(goal.triggerCard,{size:34,showJapanese:true})}<p>${escapeHtml(text(goal.purpose)||'이 카드 사용 후 발동하는 HIF 어빌리티를 비교합니다.')}</p><p class="easy-hif-purpose">${memoryRichTextMarkup(array(goal.abilities).map(ability=>text(ability.summaryKo)||text(ability.effectSummary)).filter(Boolean).join(' · '))}</p>${goal.sourceTiming?.labelKo?`<p class="easy-small-note">${escapeHtml(goal.sourceTiming.labelKo)}</p>`:''}<span class="easy-state-pill">${escapeHtml(hifTargetAvailabilityLabel(goal.targetAvailability))}</span><small>${array(goal.ownedCandidateMemoryIds).length?'해당 어빌리티 사본 '+goal.ownedCandidateMemoryIds.length+'개 보유':'해당 어빌리티 사본 미보유 · 제작 목표'}</small>${expandableMarkup('발동 효과·획득 시점·제작 조건',`<ul>${easyAdviceList(goal.conditions)}</ul>${array(goal.abilities).map(ability=>`<p>${memoryRichTextMarkup(text(ability.summaryKo)||text(ability.effectSummary)||text(ability.descriptionKo)||text(ability.descriptionJa)||text(ability.nameKo)||text(ability.nameJa))}</p>`).join('')}<p>${escapeHtml(text(goal.craftingGoal?.goalKo)||text(goal.craftingGoal?.goal))}</p>`,'hif-goal-'+goal.goalId)}</article>`;
  const primaryGoals=array(data.recommendations).filter(goal=>(goal.recommendation?.priority??'primary')==='primary').map(goalMarkup).join('');
  const secondaryGoals=array(data.recommendations).filter(goal=>(goal.recommendation?.priority??'primary')!=='primary').map(goalMarkup).join('');
  const goals=primaryGoals+(secondaryGoals?expandableMarkup('조건에 따라 고를 다른 제작 목표',`<div class="easy-hif-goal-grid">${secondaryGoals}</div>`,'hif-secondary-goals'):'');
  const eventReference=data.evidenceScope?.sourceEventMonth;
  const candidateRows=rows=>rows.map(candidate=>{
    const memory=recordsOf('memories').find(row=>recordId(row)===candidate.memoryId),record=memory?{...memory,reason:candidate.reason??candidate.defaultSelectionReason??''}:null;
    return `<article class="easy-hif-owned">${record?`<div class="simple-recommend-grid">${recommendedRows([record],0,'memories')}</div>`:memorySkillVisualMarkup({gameId:candidate.carriedSkillId,nameKo:candidate.name},{size:30,showJapanese:true})}<p>${escapeHtml(text(candidate.defaultSelectionReason)||text(candidate.reason)||(candidate.eligible===true?'현재 선택한 반입 스킬·개조 사양과 다른 후보입니다. 효과의 발동 조건을 함께 비교하세요.':'현재 PLv·플랜·전환 등 반입 조건을 확인해야 하는 사본입니다.'))}</p>${array(candidate.hifEffects).map(effect=>hifEffectMarkup(effect,candidate.eligible===true&&effect.applies===true)).join('')}</article>`;
  }).join('');
  return `<section class="easy-hif-abilities" id="hifAbilityGuidance"><h3>HIF 전용 어빌리티는 무엇을 고를까요?</h3><p>${escapeHtml(data.reason)}</p><p class="easy-small-note">반입 스킬과 어빌리티의 발동 대상 카드는 별개예요. 같은 효과를 여러 장 가져가도 중복 발동하지 않습니다.</p>${goals?`<h4>현재 유형 공략의 제작 참고 목표</h4><div class="easy-hif-goal-grid">${goals}</div><p class="easy-small-note">${eventReference?'이전 아사리의 카드 준비 사례입니다.':'일반 HIF의 조건부 사례입니다.'} 현재 아이돌·이번 회차의 완성 덱으로 검증한 결과는 아니에요.</p>`:''}<h4>내 보유 사본에서 비교하기</h4>${eligible.length?candidateRows(eligible):'<p>현재 반입 조건을 확인한 HIF 어빌리티 사본이 없어요.</p>'}${locked.length?expandableMarkup('반입 조건이 남은 다른 HIF 사본',candidateRows(locked),'hif-locked-memories'):''}${expandableMarkup('선정 기준·발동 조건·출처',`<p>반입 스킬·강화·합류 시점·개조가 같은 사본에서는 공략에 맞는 HIF 효과를 함께 비교합니다. 다른 스킬의 사본은 별도 대안으로 표시해요.</p><ul>${easyAdviceList(data.limitations)}</ul>${array(data.sourceCautions).length?'<h4>이 원문에서 우선도를 낮춘 대상</h4>'+array(data.sourceCautions).map(goal=>memorySkillVisualMarkup(goal.triggerCard,{size:26,showJapanese:true})+'<p>'+escapeHtml(goal.purpose)+'</p>').join(''):''}${guideSources(array(data.sources).map(source=>source.id),data.sources)}`,'hif-ability-sources')}</section>`;
}
function customizationReadinessMarkup(result){
  const data=result.customizationReadiness;if(!data)return '';
  const status={fulfilled:'충족',missing:'미충족',unknown:'미확정',not_specified:'조건 명시 없음'};
  const memoryRows=array(data.memories).map(row=>`<article class="easy-custom-row">${memorySkillVisualMarkup(row,{size:30,showJapanese:true})}<p><strong>현재 개조</strong> ${escapeHtml(row.actualSummary)}</p>${array(row.guide?.required).map(check=>`<p><span class="easy-state-pill">${escapeHtml(status[check.status]||'미확정')}</span> ${escapeHtml(check.label)}</p>`).join('')}${array(row.guide?.templateRequirements).map(check=>`<p>후반 완성 사양 · ${escapeHtml(check.label)} · ${escapeHtml(status[check.status]||'미확정')}</p>`).join('')}</article>`).join('');
  const plans=array(data.duringProduce).filter(plan=>plan.currentlyActionable!==false).map(plan=>`<article class="easy-custom-row">${memorySkillVisualMarkup(plan.target,{size:30,showJapanese:true})}<p><strong>${escapeHtml(plan.label)}${plan.targetCount?' '+formatNumber(plan.targetCount)+'회':''}</strong></p><p>${array(plan.timing?.selectionWeeks).length?'선발 '+plan.timing.selectionWeeks.map(week=>formatNumber(week)+'일차').join(' · '):escapeHtml(array(plan.timing?.labels).join(' · '))} · ${escapeHtml(plan.venueLabel||'특별지도')}</p><p>${plan.currentStoredMemoryStatus==='fulfilled'?'반입 메모리에 해당 개조가 확인됩니다.':'해당 공략의 후반 사양을 따를 때 육성 중 추가할 개조입니다.'}</p>${plan.routeIncludesVenueAtTargetWeek===false?'<p class="easy-custom-missing">현재 경로에는 해당 주차의 특별지도가 없어요. 이 사양을 완성하려면 방문을 바꿔야 합니다.</p>':''}<p class="easy-small-note">${plan.minimumProducerLevelInSource?'공략의 카드 준비 조건 PLv '+formatNumber(plan.minimumProducerLevelInSource)+' · ':''}실제 소지 카드·개조 잔여 횟수·P포인트 가격 확인 필요</p></article>`).join('');
  const lockedPlans=array(data.duringProduce).filter(plan=>plan.currentlyActionable===false);
  return `<section class="easy-customization" id="customizationChecklist"><h3>개조가 필요한 운영인지 확인하세요</h3><p>반입할 때 이미 된 개조와 육성 중 추가할 개조를 나눴어요. 필요한 개조가 빠졌으면 공략의 완성 사양으로 보지 않습니다.</p>${data.context?.selectedEventModeId?'<p class="easy-small-note">개조 조건은 일반 HIF 공략의 사양을 참고합니다.</p>':''}${plans?`<h4>육성 중 추가할 개조</h4><div class="easy-custom-grid">${plans}</div>`:''}${lockedPlans.length?expandableMarkup('카드 해금 후 검토할 개조',lockedPlans.map(plan=>`<p>${memorySkillVisualMarkup(plan.target,{size:26,showJapanese:true})} · ${escapeHtml(plan.label)}</p><p>현재 카드의 획득·전환 조건을 충족하지 못해 이번 경로의 추가 개조 안내에서 제외했어요.</p>`).join(''),'locked-customization-plans'):''}${expandableMarkup('선택 메모리의 현재 개조·공략 조건',`<div class="easy-custom-grid">${memoryRows}</div><ul>${easyAdviceList(data.limitations)}</ul>${guideSources(array(data.sources).map(source=>source.id),data.sources)}`,'memory-customization-checks')}</section>`;
}
function produceBudgetMarkup(result){
  const ledger=result.resourceLedger;if(!ledger)return '';
  const summaries=array(ledger.stages).map(stage=>`<article><h4>${escapeHtml(stage.label)}</h4><p>상담 <strong>${formatNumber(stage.activityCounts?.consult??0)}회</strong> · 사시이레 <strong>${formatNumber(stage.activityCounts?.supply_gift??stage.activityCounts?.activity_supply_gift??0)}회</strong></p><dl><div><dt>경로상 P포인트 수입</dt><dd>${ledgerRange(stage.pp?.incomeRange)}</dd></div><div><dt>계획 행동의 지출</dt><dd>${ledgerRange(stage.pp?.spendRange)}</dd></div><div><dt>받을 카드 · 드링크</dt><dd>${ledgerRange(stage.cards?.range)}장 · ${ledgerRange(stage.drinks?.range)}개</dd></div></dl><p class="easy-small-note">${array(stage.pp?.unpricedActions).length?'가격을 모르는 행동 '+formatNumber(array(stage.pp.unpricedActions).length)+'개가 있어요. ':''}현재 잔고는 미확인입니다.</p></article>`).join('');
  const weekly=array(ledger.stages).map(stage=>`<h4>${escapeHtml(stage.label)}</h4><div class="hif-axis-table-wrap"><table class="hif-axis-table"><thead><tr><th>주차·행동</th><th>PP 수입</th><th>PP 지출</th><th>카드·드링크</th></tr></thead><tbody>${array(stage.activityRows).map(row=>`<tr><th>${formatNumber(row.week)} · ${escapeHtml(row.label||row.activity)}</th><td>${number(row.ppIncome)===null?'미확인':formatNumber(row.ppIncome)}</td><td>${row.ppSpendRange?ledgerRange(row.ppSpendRange):formatNumber(row.ppSpend)}</td><td>${ledgerRange(row.cards)}장 · ${ledgerRange(row.drinks)}개</td></tr>`).join('')}</tbody></table></div>`).join('');
  const supportEffects=array(ledger.supportEffects).map(row=>`<li>${memoryRichTextMarkup(row.nameKo||row.name||row.nameJa||row.reason||'서포트 조건 효과')} ${memoryRichTextMarkup(row.note||row.reason||'')}</li>`).join('');
  const items=array(ledger.supportItems).map(item=>`<article class="easy-item-value"><strong>${escapeHtml(item.nameKo||item.name||item.nameJa||item.itemName||item.supportName||'P아이템')}</strong><p>${memoryRichTextMarkup(item.summary||item.reason||item.status||'획득·발동 시점 확인 필요')}</p>${item.conditions?`<ul>${easyAdviceList(item.conditions)}</ul>`:''}${item.limitations?`<ul>${easyAdviceList(item.limitations)}</ul>`:''}</article>`).join('');
  return `<section class="easy-budget"><h3>이 루트에서 쓰고 얻는 것</h3><p class="easy-small-note">가정한 경로의 수지입니다. 선발의 P포인트·드링크는 본선으로 이어지지 않아요.</p><div class="easy-budget-grid">${summaries}</div>${expandableMarkup('주차별 수입·지출',weekly,'weekly-budget')}${expandableMarkup('서포트·P아이템 가치와 발동 조건',`${items}${supportEffects?'<ul>'+supportEffects+'</ul>':''}`,'support-item-values')}${expandableMarkup('아직 계산하지 못한 수지',`<ul>${easyAdviceList(ledger.unknowns)}</ul>${guideSources(array(ledger.sources).map(source=>source.id),ledger.sources)}`,'budget-unknowns')}</section>`;
}
function accountPlaybookMarkup(result){const book=currentPlaybook(result);if(!book)return '';return `<section class="easy-playbook" id="weeklyChoices"><h2>이번 육성은 이렇게</h2>${examScoreOverviewMarkup(result)}${expandableMarkup('P아이템 반영·선택 기준',itemConsiderationMarkup(result),'item-consideration-overview')}${expandableMarkup('이 경로에서 쓰고 얻는 것',produceBudgetMarkup(result),'produce-budget-overview')}${cardCautionsMarkup(book)}${expandableMarkup('운영표의 조건과 출처',`<ul>${easyAdviceList(book.missing)}</ul>${guideSources(array(book.sources).map(source=>source.id),book.sources)}`,'playbook-sources')}</section>`;}

function catalogFreshnessMarkup(){const meta=ui.catalogFreshness;if(!meta)return '';const live=meta.liveMaster;const sources=live?[{title:'신규 카드 공개 마스터',url:live.url},...array(meta.sources)]:array(meta.sources);return `<details class="easy-freshness" data-detail-key="freshness"><summary>${live?'신규 카드 자료 '+escapeHtml(labelTime(live.publishedAt)):'자료 기준 '+escapeHtml(meta.masterSnapshotDate||'미확인')}</summary><p>기본 계산표 기준 ${escapeHtml(meta.masterSnapshotDate||'미확인')} · 공략 확인 ${escapeHtml(meta.checkedAt||'미확인')}</p><ul>${easyAdviceList(meta.notes)}</ul>${sources.map(source=>{const url=safeSourceUrl(source.url);return url?`<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a></p>`:'';}).join('')}</details>`;}
function searchedRentalRows(query){
  const match=normalized(query);if(!match)return '<p class="easy-small-note">추천에 없어도 이름으로 찾아 대여 카드로 지정할 수 있어요.</p>';
  const plan=selectedVariant()?.plan||$('recommendPlan').value,rows=array(ui.supportVisualCatalog).filter(card=>normalized([card.nameKo,card.name,card.nameJa].join(' ')).includes(match)).slice(0,8);
  return rows.length?rows.map(card=>{const owned=recordsOf('supportCards').find(row=>recordId(row)===card.gameId),compatible=!plan||card.plan==='free'||card.plan===plan,advice=card.advice;return `<article class="easy-rental-search-card">${visualFrame(assetUrl(card.thumbnailUrl,card.imageUrl),(card.nameKo||card.name)+' 그림','easy-support-art')}<div><strong>${escapeHtml(card.nameKo||card.name||card.nameJa)}</strong><small>${owned?'보유 Lv.'+owned.level:'현재 미보유'} · ${card.plan==='free'?'공용':plans[card.plan]||'플랜 미확인'}</small>${advice?`<p>${escapeHtml(advice.summary)}</p><p class="easy-coverage-note">조건 효과 일부가 아직 계산되지 않아 낮게 평가될 수 있어요.</p>${expandableMarkup('활용 조건·출처',`<ul>${easyAdviceList(advice.conditions)}</ul><p>${escapeHtml(advice.calculationNote)}</p>${array(advice.sources).map(source=>`<p><a href="${escapeHtml(safeSourceUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a></p>`).join('')}`,'support-advice-'+card.gameId)}`:''}<button type="button" class="button button-secondary" data-rental-choice="${escapeHtml(card.gameId)}"${compatible?'':' disabled'}>${compatible?'이 카드 빌려서 비교':'현재 플랜에서 사용 불가'}</button></div></article>`;}).join(''):'<p>해당 카드 이름을 찾지 못했어요. 한국어·일본어 이름으로 다시 찾아보세요.</p>';
}
function rentalSearchMarkup(){return `<div class="easy-rental-search"><label for="rentalCardSearch">대여 카드 직접 찾기</label><input id="rentalCardSearch" data-rental-search type="search" aria-label="대여 카드 검색" placeholder="한국어 · 일본어 카드 이름" value="${escapeHtml(ui.rentalSearch||'')}"><div data-rental-search-results>${searchedRentalRows(ui.rentalSearch||'')}</div></div>`;}
document.getElementById('recommendOutput').addEventListener('input',event=>{if(event.target.matches('[data-rental-search]')){ui.rentalSearch=event.target.value;event.target.parentElement.querySelector('[data-rental-search-results]').innerHTML=searchedRentalRows(ui.rentalSearch);}});
document.getElementById('recommendOutput').addEventListener('click',event=>{const button=event.target.closest('[data-flow-stage]');if(!button)return;ui.runFlowStageId=button.dataset.flowStage;const data=ui.recommendation?.runFlowGuidance,stage=array(data?.stages).find(row=>row.id===ui.runFlowStageId);if(!stage)return;for(const chip of button.closest('nav').querySelectorAll('[data-flow-stage]'))chip.setAttribute('aria-pressed',String(chip===button));document.getElementById('runFlowDetail').innerHTML=runFlowStageMarkup(stage,data);});
document.getElementById('recommendOutput').addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(!link)return;let node=document.getElementById(link.getAttribute('href').slice(1));while(node){if(node.tagName==='DETAILS')node.open=true;node=node.parentElement;}});
document.getElementById('recommendOutput').addEventListener('click',event=>{
  const button=event.target.closest('[data-route-week]');
  if(button)openPlaybookWeekDialog(button);
  const guide=event.target.closest('[data-day-guide]');
  if(guide){
    const destination=document.getElementById(guide.hash.slice(1));
    if(!destination)return;
    event.preventDefault();
    document.getElementById('routeDayDialog').close();
    requestAnimationFrame(()=>{
      destination.focus({preventScroll:true});
      destination.scrollIntoView({block:'start'});
    });
  }
  if(event.target.id==='routeDayDialog'){
    const dialog=event.target,bounds=dialog.getBoundingClientRect();
    if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();
  }
});

function reloadCardCatalog(retry=true) {
  return loadMemorySkillVisualCatalog({retry, onReady:()=>{
  renderSupportComparisonControls();
  renderEventModeOptions();
  renderMemoryTargets();
  if(ui.state)renderInventory();
  if(ui.recommendation)renderRecommendation();
  if(typeof renderGuideLibrary==='function')renderGuideLibrary();
  if(retry && ui.view==='guides' && typeof initializeIdolGuideBrowser==='function')initializeIdolGuideBrowser();
  if(retry && typeof refreshSkillCatalogOptions==='function')void refreshSkillCatalogOptions();
  }}).catch(()=>{});
}
reloadCardCatalog(false);

document.getElementById('recommendOutput').addEventListener('click',event=>{const button=event.target.closest('[data-event-rental-target]');if(!button||ui.recommending)return;ui.eventRentalSkillId=ui.eventRentalSkillId===button.dataset.eventRentalTarget?'':button.dataset.eventRentalTarget;markRecommendationConditions();$('recommendForm').requestSubmit();});

document.getElementById('recommendOutput').addEventListener('click',event=>{
  const apply=event.target.closest('[data-apply-exam-rewards]'),reset=event.target.closest('[data-reset-exam-rewards]');if((!apply&&!reset)||ui.recommending)return;
  if(reset){ui.hifExamResults=[];markRecommendationConditions();$('recommendForm').requestSubmit();return;}
  const scope=apply.closest('details'),status=scope.querySelector('[data-exam-reward-status]'),results=[];
  for(const examIndex of [0,1,2]){
    const get=key=>number(scope.querySelector(`[data-exam-input="${examIndex}:${key}"]`)?.value),score=get('score'),gains={vocal:get('vocal'),dance:get('dance'),visual:get('visual')};
    const entered=Object.values(gains).some(value=>value!==null);
    if((score!==null&&score<0)||Object.values(gains).some(value=>value!==null&&value<0)){status.textContent='점수와 보상 상승량은 0 이상으로 입력해 주세요.';return;}
    if(entered&&Object.values(gains).some(value=>value===null)){status.textContent=`선발시험 ${examIndex+1}의 Vo·Da·Vi 상승량을 모두 입력해 주세요. 보상이 없는 속성은 0을 넣으세요.`;return;}
    if(!entered&&score===null)continue;
    results.push({examIndex,...(entered?{parameterGains:gains,gainBasis:scope.querySelector(`[data-exam-basis="${examIndex}"]`).value}:{}),...(score!==null?{score}:{})});
  }
  ui.hifExamResults=results;markRecommendationConditions();$('recommendForm').requestSubmit();
});


document.getElementById('recommendOutput').addEventListener('click',async event=>{
  const button=event.target.closest('[data-week-recalculate]');if(!button)return;
  const week=Number(button.dataset.weekRecalculate),scope=button.closest('.easy-details-body'),values={};
  for(const input of scope.querySelectorAll('[data-week-value]'))values[input.dataset.weekValue]=number(input.value);
  const liveState={stamina:values.stamina,maxStamina:values.maxStamina,currentMaxStamina:values.maxStamina,pp:values.pp,stats:{vocal:values.vocal,dance:values.dance,visual:values.visual}};
  const liveBook=currentPlaybook(personalizedDisplayResult(ui.recommendation)),recommendationContextId=liveBook?.recommendationContextId;
  const record=array(liveBook?.weekPlan).find(row=>row.week===week),choice=record&&weekAdvice(record)?.observedChoice;
  try{
    if(choice?.kind==='legend')liveState.observation=readLegendMidtermInputs(scope);
    if(choice?.kind==='hif')liveState.observation=readHifIntervalInputs(scope);
    if(choice?.kind==='nia')liveState.observation={...readNiaChoiceInputs(scope,choice.activity),week,
      difficulty:liveBook.scheduleContext.sourceDifficulty,eventModeId:liveBook.scheduleContext.selectedEventModeId??null};
  }catch(error){scope.querySelector('[data-week-input-status]').textContent=error.message;return;}
  const spValue=scope.querySelector('[data-week-sp]')?.value;
  if(['vocal','dance','visual'].includes(spValue))liveState.spLessonAxis=spValue;
  liveState.spLessonStatus=liveState.spLessonAxis?'available':spValue||null;
  if(scope.querySelector('[data-week-sp-attribute]')&&liveState.spLessonStatus){
    const sp=[...scope.querySelectorAll('[data-week-sp-attribute]:checked')].map(input=>input.dataset.weekSpAttribute);
    if(liveState.spLessonStatus!=='absent'&&!sp.length){
      scope.querySelector('[data-week-input-status]').textContent='게임에서 SP가 뜬 속성을 체크해 주세요.';
      return;
    }
    liveState.spLessonAttributes=liveState.spLessonStatus==='absent'?[]:sp;
  }
  const observation=liveState.observation??={};
  for(const input of scope.querySelectorAll('[data-week-observation]'))
    if(input.dataset.weekObservation)observation[input.dataset.weekObservation]=number(input.value);
  observation.rewardItemOffers=[...scope.querySelectorAll('[data-week-reward]:checked')].map(input=>input.dataset.weekReward).filter(Boolean);
  ui.weekLiveState=liveState;button.disabled=true;scope.querySelector('[data-week-input-status]').textContent='선택지를 비교하고 있어요.';
  if(!recommendationContextId){scope.querySelector('[data-week-input-status]').textContent='편성을 다시 비교한 뒤 날짜별 선택지를 확인해 주세요.';button.disabled=false;return;}
  if(!playbookLiveStates.has(liveBook))playbookLiveStates.set(liveBook,new Map());playbookLiveStates.get(liveBook).set(week,liveState);
  if(!playbookWeekRequests.has(liveBook))playbookWeekRequests.set(liveBook,new Map());
  const requests=playbookWeekRequests.get(liveBook),requestId=(requests.get(week)??0)+1;requests.set(week,requestId);
  const isCurrentRequest=()=>currentPlaybook(personalizedDisplayResult(ui.recommendation))===liveBook&&liveBook.recommendationContextId===recommendationContextId&&requests.get(week)===requestId;
  try{
    const response=await api('/api/week-choices',{method:'POST',body:JSON.stringify({week,liveState,recommendationContextId})});
    if(!isCurrentRequest())return;
    if(response.recommendationContextId!==recommendationContextId)throw new Error('편성 조건이 다른 응답입니다. 편성을 다시 비교해 주세요.');
    ui.weekChoiceAdvice??={};ui.weekExamTargets??={};ui.weekChoiceAdvice[week]=response.weekAdvice;ui.weekExamTargets[week]=response.statTargets;
    const book=currentPlaybook(personalizedDisplayResult(ui.recommendation)),selected=array(book?.weekPlan).find(row=>row.week===week);
    const overview=document.getElementById('dayRouteOverview');if(overview)overview.outerHTML=dayRouteOverviewMarkup(personalizedDisplayResult(ui.recommendation));
    const dialog=document.getElementById('routeDayDialog');
    if(ui.playbookWeek===week&&dialog?.open){
      const content=document.getElementById('routeDayDialogContent');
      const restoreFocus=content.contains(button);
      content.innerHTML=weekActionMarkup(selected);
      const inputs=restoreFocus&&content.querySelector('[data-detail-key="week-live-inputs"]');
      if(inputs){
        inputs.open=true;
        inputs.querySelector('[data-week-input-status]').textContent='입력한 값으로 비교했어요.';
        inputs.querySelector('[data-week-recalculate]').focus({preventScroll:true});
      }
    }
  }catch(error){if(!isCurrentRequest())return;scope.querySelector('[data-week-input-status]').textContent=error.message;button.disabled=false;}
});
