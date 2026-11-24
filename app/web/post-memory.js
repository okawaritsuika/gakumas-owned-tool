'use strict';

const postMemoryUi={choices:null,entries:[],nextId:1,result:null,initialized:false,loading:false,revision:0,inventoryRevision:0,optionsStale:false,optionsLoading:null};
const postKinds={unknown:'종류 미확인',normal:'일반 메모리',hif:'HIF 전용 어빌리티가 있는 메모리',checkpoint:'선발 시험 저장 기록'};
const postNote=value=>text(value)||text(value?.messageKo)||text(value?.message)||'세부 조건 확인 필요';
function renderCollectorMode(){
  const mode=ui.state?.collectorMode;if(!mode)return;
  $('collectorModeTitle').textContent=mode.mode==='collect'?'수집 모드 · 한 번 갱신 후 자동 중지':'일반 모드 · 저장된 보유 목록 사용';
  $('collectorModeMessage').textContent=mode.message;
  $('collectorStartButton').hidden=mode.mode==='collect';$('collectorStopButton').hidden=mode.mode!=='collect';
  if(mode.mode==='normal'&&ui.state?.connection?.status==='waiting'){
    $('connectionTitle').textContent='처음 한 번 보유 목록 수집이 필요해요';
    $('connectionMessage').textContent='수집 모드로 시작하고 게임의 로비에 들어가 주세요. 이후에는 일반 모드로 사용할 수 있습니다.';
  }
}
for(const [id,mode] of [['collectorStartButton','collect'],['collectorStopButton','normal']])$(id).addEventListener('click',async()=>{
  const button=$(id);button.disabled=true;
  try{const collectorMode=await api('/api/collector-mode',{method:'POST',body:JSON.stringify({mode})});ui.stateRequestEpoch++;ui.state={...(ui.state??{inventory:{}}),collectorMode};renderCollectorMode();await loadState(false,true);}
  catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
function newPostMemory(label){return{id:'output-'+postMemoryUi.nextId++,label,kind:'unknown',skillQuery:'',phase:'',customRecipe:'unknown',abilities:[],abilitiesComplete:false,abilityQuery:'',initial:{vo:'',da:'',vi:''},growth:{vo:'',da:'',vi:''},completed:{vo:'',da:'',vi:''},evaluationScore:''};}
function postSkillLabel(card){return (card.nameKo||card.name||card.nameJa)+(card.nameJa&&card.nameJa!==(card.nameKo||card.name)?' / '+card.nameJa:'')+' · '+(card.upgradeCount?'강화 '+card.upgradeCount+'회':'미강화');}
function postAbilityLabel(ability){
  if(ability.choiceLabel)return ability.choiceLabel;
  if(ability.hifOnly)return 'HIF · '+array(ability.triggerCards).map(card=>card.nameKo||card.name||card.nameJa).join('·')+' → '+(ability.effectSummary||ability.name)+' · Lv.'+ability.level;
  return '일반 · '+memoryAbilityLabel({...ability,name:ability.name})+' · Lv.'+ability.level;
}
function postTarget(){return{scenario:$('postTargetScenario').value,plan:$('postTargetPlan').value,trainingType:$('postTargetType').value,
  ...(number($('postTargetLevel').value)!==null?{producerLevel:number($('postTargetLevel').value)}:{}),
  ...($('postTargetIdol').value?{idolGameId:$('postTargetIdol').value}:{}),...($('postTargetEvent').value?{eventModeId:$('postTargetEvent').value}:{})};}
function postEntriesFromDom(){
  for(const card of document.querySelectorAll('[data-output-candidate]')){
    const entry=postMemoryUi.entries.find(row=>row.id===card.dataset.outputCandidate);if(!entry)continue;
    for(const input of card.querySelectorAll('[data-output-field]'))entry[input.dataset.outputField]=input.type==='checkbox'?input.checked:input.value;
    for(const input of card.querySelectorAll('[data-output-stat]')){const [group,axis]=input.dataset.outputStat.split(':');entry[group][axis]=input.value;}
  }
}
function postVector(entry,key,multiplier=1){
  const values=Object.fromEntries(['vo','da','vi'].map(axis=>[axis,number(entry[key][axis])]));
  if(Object.values(values).every(value=>value===null))return undefined;
  if(Object.values(values).some(value=>value===null||value<0))throw new Error(entry.label+'의 '+({initial:'초기 가산',growth:'성장률',completed:'완성 스탯'})[key]+'는 세 속성을 함께 입력해 주세요. 없는 값은 0을 입력합니다.');
  return Object.fromEntries(Object.entries(values).map(([axis,value])=>[axis,value*multiplier]));
}
function postCandidates(){
  return postMemoryUi.entries.map(entry=>{
    const skill=array(postMemoryUi.choices?.skillCards).find(row=>postSkillLabel(row)===entry.skillQuery.trim());
    const recipe=array(postMemoryUi.choices?.ownedCustomRecipes).find(row=>row.key===entry.customRecipe&&row.skillId===skill?.gameId&&row.upgradeCount===skill?.upgradeCount);
    const completed=postVector(entry,'completed'),initial=postVector(entry,'initial'),growth=postVector(entry,'growth',10);
    if(entry.skillQuery&&!skill)throw new Error(entry.label+'의 스킬을 검색 목록에서 정확히 선택해 주세요.');
    return{candidateId:entry.id,kind:entry.kind,produceCard:skill?{id:skill.gameId,upgradeCount:skill.upgradeCount,customizes:recipe?.customizes??[]}:null,
      ...(entry.phase?{produceCardPhaseType:Number(entry.phase)}:{}),abilities:entry.abilities.map(row=>({id:row.id,level:row.level})),
      abilitiesComplete:entry.abilitiesComplete,customizationsComplete:entry.customRecipe==='none'||Boolean(recipe&&recipe.skillId===skill?.gameId&&recipe.upgradeCount===skill?.upgradeCount),
      ...(initial?{confirmedInitialStats:initial}:{}),...(growth?{confirmedGrowthRatePermil:growth}:{}),...(completed?{completedStats:completed}:{}),
      ...(number(entry.evaluationScore)!==null?{evaluationScore:number(entry.evaluationScore)}:{})};
  });
}
function postStatFields(entry,key,label){return `<fieldset class="post-stat-fields"><legend>${label}</legend>${['vo','da','vi'].map(axis=>`<label>${axis.toUpperCase()}<input type="number" min="0" step="${key==='growth'?'0.1':'1'}" data-output-stat="${key}:${axis}" value="${escapeHtml(entry[key][axis])}" placeholder="미확인"></label>`).join('')}</fieldset>`;}
function postEntryMarkup(entry){
  const choices=postMemoryUi.choices,skill=array(choices?.skillCards).find(row=>postSkillLabel(row)===entry.skillQuery.trim());
  const recipes=array(choices?.ownedCustomRecipes).filter(row=>row.skillId===skill?.gameId&&row.upgradeCount===skill?.upgradeCount);
  const selectedAbilities=entry.abilities.map(ability=>`<div class="post-ability-selected"><span>${escapeHtml(postAbilityLabel(ability))}</span><button type="button" data-output-remove-ability="${escapeHtml(ability.id+'|'+ability.level)}" aria-label="어빌리티 선택 해제">×</button></div>`).join('');
  return `<article class="post-candidate-input" data-output-candidate="${entry.id}"><div class="post-candidate-heading"><input aria-label="후보 이름" data-output-field="label" value="${escapeHtml(entry.label)}"><button type="button" class="post-small-button" data-output-remove>후보 지우기</button></div>
    <div class="post-input-pair"><label>메모리 종류<select data-output-field="kind">${Object.entries(postKinds).map(([key,label])=>`<option value="${key}"${entry.kind===key?' selected':''}>${label}</option>`).join('')}</select></label><label>스킬 합류 시점<select data-output-field="phase"><option value="">미확인</option><option value="1"${entry.phase==='1'?' selected':''}>프로듀스 시작부터</option><option value="2"${entry.phase==='2'?' selected':''}>선발 1 / 중간 시험 종료 후</option></select></label></div>
    <label>보상창의 반입 스킬<input type="search" list="postSkillOptions" data-output-field="skillQuery" value="${escapeHtml(entry.skillQuery)}" placeholder="한국어·일본어 스킬명 검색"></label>${skill?`<div class="post-selected-skill">${memorySkillVisualMarkup(skill,{size:30,showJapanese:true})}</div>`:''}
    <label>개조 확인<select data-output-field="customRecipe"><option value="unknown">아직 확인하지 않음</option><option value="none"${entry.customRecipe==='none'?' selected':''}>개조가 없는 후보</option>${recipes.map(row=>`<option value="${row.key}"${entry.customRecipe===row.key?' selected':''}>보유 사본과 같은 개조 · ${escapeHtml(row.label)}</option>`).join('')}</select></label>
    <p class="post-small-note">‘보유 사본과 같은 개조’는 보상창의 종류·횟수가 실제로 같을 때만 고릅니다. 다른 개조는 미확인으로 남기세요.</p>
    <details class="post-input-details"><summary>어빌리티 선택 · 초기·성장·완성 스탯 입력</summary><div><p class="post-small-note">보상창에 표시된 어빌리티를 선택하세요. HIF 효과는 발동 대상 카드 이름으로 찾을 수 있어요.</p>
      <div class="post-add-ability"><input type="search" list="postAbilityOptions" data-output-field="abilityQuery" value="${escapeHtml(entry.abilityQuery)}" placeholder="HIF 대상 카드·어빌리티 효과 검색"><button type="button" class="button button-secondary" data-output-add-ability>추가</button></div><div>${selectedAbilities||'<p class="post-small-note">아직 선택한 어빌리티가 없습니다.</p>'}</div>
      <label class="post-checkbox"><input type="checkbox" data-output-field="abilitiesComplete"${entry.abilitiesComplete?' checked':''}>보상창의 어빌리티 목록을 모두 입력했습니다</label>
      ${postStatFields(entry,'initial','반입 초기 가산 · 직접 확인한 경우만')}${postStatFields(entry,'growth','반입 성장률(%) · 직접 확인한 경우만')}${postStatFields(entry,'completed','완성 Vo·Da·Vi · 기록용')}
      <label>게임에 표시된 평가점(선택)<input type="number" min="0" data-output-field="evaluationScore" value="${escapeHtml(entry.evaluationScore)}" placeholder="모르면 비워 두세요"></label><p class="post-small-note">직접 입력한 초기·성장은 어빌리티 계산값에 다시 더하지 않습니다. 완성 스탯·평가점은 반입 수치로 합산하지 않습니다.</p>
    </div></details></article>`;
}
function renderPostEntries(){
  const opened=new Set([...$('postCandidateInputs').querySelectorAll('[data-output-candidate]')].filter(card=>card.querySelector('details')?.open).map(card=>card.dataset.outputCandidate));
  $('postCandidateInputs').innerHTML=postMemoryUi.entries.map(postEntryMarkup).join('');
  for(const card of $('postCandidateInputs').querySelectorAll('[data-output-candidate]'))if(opened.has(card.dataset.outputCandidate))card.querySelector('details').open=true;
  $('postAddCandidate').disabled=postMemoryUi.entries.length>=12;
}
function postResultStats(row){const axes=['vo','da','vi'];const line=(label,values,percent=false)=>`<tr><th>${label}</th>${axes.map(axis=>`<td>${values?.[axis]==null?'미확인':percent?growthPercent(values[axis]):formatNumber(values[axis])}</td>`).join('')}</tr>`;return `<table class="post-result-stats"><thead><tr><th></th><th>Vo</th><th>Da</th><th>Vi</th></tr></thead><tbody>${line('반입 초기',row.initialStats)}${line('반입 성장',row.growthRatePermil,true)}${line('완성 기록',row.completedStats)}</tbody></table>`;}
function postCandidateName(id){return postMemoryUi.entries.find(row=>row.id===id)?.label||id;}
function markPostResultStale(message='입력이 바뀌었습니다. 제작 목표 보기 또는 남길 메모리 비교를 다시 눌러 주세요.'){postMemoryUi.revision++;if(postMemoryUi.result||postMemoryUi.loading){postMemoryUi.result=null;if($('postMemoryResult'))$('postMemoryResult').innerHTML='';if($('postMemoryStatus'))$('postMemoryStatus').textContent=typeof message==='string'?message:'입력이 바뀌었습니다. 제작 목표 보기 또는 남길 메모리 비교를 다시 눌러 주세요.';}}
function refreshPostTargetIdolOptions(){
  const select=$('postTargetIdol');if(!select)return;
  const selected=select.value,previous=select.selectedOptions[0],label=previous?.dataset.postIdolName||previous?.textContent||'이전에 선택한 P아이돌';
  const idols=recordsOf('idolCards'),missing=selected&&!idols.some(row=>recordId(row)===selected);
  const note=categoryStatus('idolCards')==='complete'?'현재 보유 목록에 없음':'이번 목록에서 미관측';
  select.innerHTML='<option value="">선택하지 않음</option>'+idols.map(row=>`<option value="${escapeHtml(recordId(row))}">${escapeHtml(nameOf(row))}</option>`).join('')+
    (missing?`<option value="${escapeHtml(selected)}" data-post-idol-name="${escapeHtml(label)}">${escapeHtml(label)} · ${note}</option>`:'');
  select.value=selected;
}
function invalidatePostMemoryInventory(){
  postMemoryUi.inventoryRevision++;postMemoryUi.optionsStale=true;
  markPostResultStale('보유 목록이 갱신되었습니다. 개조 사양을 확인하고 제작 목표나 후보 비교를 다시 눌러 주세요.');
  if(!postMemoryUi.initialized)return;
  refreshPostTargetIdolOptions();
  postEntriesFromDom();for(const entry of postMemoryUi.entries)if(!['none','unknown'].includes(entry.customRecipe))entry.customRecipe='unknown';
  if(postMemoryUi.choices)postMemoryUi.choices={...postMemoryUi.choices,ownedCustomRecipes:[]};
  if($('postCandidateInputs')){renderPostEntries();refreshPostMemoryOptions().catch(error=>{if($('postMemoryStatus'))$('postMemoryStatus').textContent=error.message;});}
}
async function refreshPostMemoryOptions(){
  if(postMemoryUi.optionsLoading)return postMemoryUi.optionsLoading;
  const request=(async()=>{
    let choices,revision;
    do{revision=postMemoryUi.inventoryRevision;choices=await api('/api/post-produce-memory-options');}while(revision!==postMemoryUi.inventoryRevision);
    postMemoryUi.choices=choices;postMemoryUi.optionsStale=false;
    if($('postCandidateInputs')){postEntriesFromDom();renderPostEntries();}
    return choices;
  })();postMemoryUi.optionsLoading=request;
  try{return await request;}finally{if(postMemoryUi.optionsLoading===request)postMemoryUi.optionsLoading=null;}
}
function renderPostResult(result){
  const statusLabels={recommended:result.candidates?.length===1?'입력한 한 장의 반입 조건을 확인했어요':'이 후보를 우선 남기세요',tradeoffs:'다음 육성의 목적에 맞춰 고르세요',insufficient_data:'아직 확인할 정보가 있어요',no_compatible_candidates:'현재 사용처와 맞는 후보가 없어요',no_candidates:'생성될 때 확인할 제작 목표'};
  const ownedLabels={new_recipe:'입력된 보유 목록에 같은 제작 사양 없음',improves_existing_copy:'기존 사본보다 확인 항목 개선',equivalent_existing_copy:'동등한 사본 보유',existing_copy_better:'이미 더 나은 사본 보유',tradeoffs_or_unknown:'기존 사본과 장단점·미확인 있음',recipe_unknown:'개조·합류 등 제작 사양 확인 필요'};
  const readyLabels={ready:'앱 반입 비교 조건 충족',locked:'앱 반입 비교 조건 미충족',unknown:'앱 반입 비교 조건 미확인',wrong_plan:'선택 플랜과 다름',unsupported_candidate_kind:'생성 후보 비교 대상 아님'};
  const rows=array(result.candidates).map(row=>{
    const advice=array(result.conditionalAdvice?.items).find(item=>item.candidateId===row.candidateId);
    const effectRows=array(row.hifAssessment?.effects).map(effect=>`<article class="post-hif-effect">${easySkillList(effect.triggerCards,25)}<p>${memoryRichTextMarkup(effect.effectSummary||effect.text||'효과 확인 필요')}</p><small>${escapeHtml(hifTargetAvailabilityLabel(effect.targetAvailability))}${!row.hifAssessment.appliesInTargetScenario?' · 이 시나리오에서 HIF 효과 미발동':''}</small></article>`).join('');
    return `<article class="post-candidate-result${array(result.recommendedCandidateIds).includes(row.candidateId)?' preferred':''}"><h3>${escapeHtml(postCandidateName(row.candidateId))}<span>${escapeHtml(postKinds[row.kind]||'종류 미확인')}</span></h3>${row.skill?memorySkillVisualMarkup({gameId:row.skill.id,name:row.skill.name,nameJa:row.skill.nameJa,upgradeCount:row.skill.upgrade},{size:30,showJapanese:true}):'<p>반입 스킬 미확인</p>'}<p>${escapeHtml(readyLabels[row.carryReadiness?.status]||'조건 확인 필요')} · ${escapeHtml(ownedLabels[row.ownedComparison?.status]||'보유 비교 미확인')}</p>${row.kind!=='checkpoint'&&row.skill?.phase?.availableAtStart!=null?`<p><strong>${row.skill.phase.availableAtStart?'첫 시험부터 덱에 합류':'첫 시험이 끝난 뒤 덱에 합류'}</strong></p>`:''}${row.kind!=='checkpoint'&&result.status==='insufficient_data'&&array(row.unknowns).length?`<p><strong>먼저 확인</strong> · ${escapeHtml(postNote(row.unknowns[0]))}</p>`:''}${postResultStats(row)}${array(row.additionalEffects).length?expandableMarkup('초기·성장 외 어빌리티 '+row.additionalEffects.length+'개','<ul>'+row.additionalEffects.map(effectEntryMarkup).join('')+'</ul>','output-extra-effects-'+row.candidateId):''}${effectRows}${advice?`<div class="post-purpose-advice"><strong>${escapeHtml(advice.when)}</strong><ul>${easyAdviceList(advice.why)}</ul></div>`:''}${expandableMarkup('반입·개조·미확인 조건과 이유',`<ul>${easyAdviceList(array(row.reasons).concat(array(row.unknowns).map(postNote),array(row.sourceAdvice?.creatorGoalAssessments).flatMap(goal=>array(goal.checks).map(check=>(check.passed===true?'충족':check.passed===false?'미충족':'미확인')+' · '+check.reason))))}</ul>`,'output-candidate-'+row.candidateId)}</article>`;
  }).join('');
  const goalMarkup=goal=>{const card=goal.skill??goal.triggerCard;return `<article class="post-creation-goal">${memorySkillVisualMarkup(card,{size:30,showJapanese:true})}<p>${escapeHtml(goal.purpose||'공략의 제작 참고 목표')}</p><small>${goal.kind==='hif_ability'?'이 카드 사용으로 발동하는 HIF 어빌리티':goal.requiredPhase?'스킬 합류 시점·개조 함께 확인':'반입 역할 참고'} · 충족 사본 ${array(goal.ownedFulfilledMemoryIds).length}개</small>${goal.carryUnlockProducerLevel?`<small>앱 비교 PLv 기준 ${goal.carryUnlockProducerLevel}${goal.requiresSwitch?' · 전환 해금·선택 필요':''}</small>`:''}${goal.customizationRequirement?`<p>${escapeHtml(goal.customizationRequirement)}</p>`:''}${goal.kind==='creator_carried_recipe'?`<small>${goal.sourceEventMonth?escapeHtml(goal.sourceEventMonth)+' 원문 · ':''}현재 회차 재현 미검증</small>`:''}${expandableMarkup('이 제작 목표의 조건',`<ul>${easyAdviceList(array(goal.conditions).concat(array(goal.customizationTargets).map(target=>target.labelKo+' · '+target.count+'회')))}</ul>`,'output-goal-'+goal.id)}</article>`;};
  const carryGoals=array(result.creationGoals).filter(goal=>goal.kind==='carried_skill'),otherGoals=array(result.creationGoals).filter(goal=>goal.kind!=='carried_skill');
  const goals=carryGoals.map(goalMarkup).join('')+(otherGoals.length?expandableMarkup('HIF 전용 어빌리티·다른 제작 사양 '+otherGoals.length+'개',`<div class="post-goal-grid">${otherGoals.map(goalMarkup).join('')}</div>`,'output-other-crafting-goals'):'');
  const paths=array(result.recommendation?.choicePaths);
  const decision=paths.length?`<ul class="post-choice-paths">${paths.map(path=>`<li>${escapeHtml(path.when)} <strong>${path.candidateIds.map(id=>escapeHtml(postCandidateName(id))).join(' · ')}</strong></li>`).join('')}</ul>`:'';
  $('postMemoryResult').innerHTML=`<section class="post-choice-verdict"><h2>${escapeHtml(statusLabels[result.status]||'입력한 후보 비교')}</h2>${result.recommendedCandidateIds?.length?`<strong>${result.recommendedCandidateIds.map(id=>escapeHtml(postCandidateName(id))).join(' · ')}</strong>`:''}<p>${escapeHtml(result.recommendation?.reason||'')}</p>${decision}<p class="post-small-note">미선택 생성 후보는 자동 수집하지 않습니다. 입력한 후보와 저장된 보유 사본을 비교한 참고입니다.</p></section><div class="post-result-grid">${rows}</div>${goals?`<section class="post-creation-goals"><h2>생성·재생성에서 노릴 메모리</h2><p>일반 반입 역할과 HIF 전용 어빌리티 목표를 구분했습니다. 생성·발동을 보장하는 목록은 아닙니다.</p><div>${goals}</div></section>`:''}${expandableMarkup('비교 규칙·적용 범위·출처',`<p>${escapeHtml(result.comparisonRules?.numericComparison||'')}</p><p>${escapeHtml(result.comparisonRules?.sourcePriority||'')}</p><ul>${easyAdviceList(result.limitations)}</ul>${guideSources(array(result.sources).map(source=>source.id),result.sources)}`,'output-comparison-sources')}`;
}
async function comparePostMemories(goalsOnly=false){
  if(postMemoryUi.loading)return;postMemoryUi.loading=true;$('postCompareButton').disabled=true;
  const revision=postMemoryUi.revision;
  try{if(postMemoryUi.optionsStale)await refreshPostMemoryOptions();if(revision!==postMemoryUi.revision)return;postEntriesFromDom();const result=await api('/api/post-produce-memory-choice',{method:'POST',body:JSON.stringify({target:postTarget(),candidates:goalsOnly?[]:postCandidates()})});if(revision!==postMemoryUi.revision)return;postMemoryUi.result=result;renderPostResult(result);$('postMemoryStatus').textContent='';}
  catch(error){if(revision===postMemoryUi.revision)$('postMemoryStatus').textContent=error.message;}finally{postMemoryUi.loading=false;$('postCompareButton').disabled=false;}
}
async function openPostMemoryChoice(){
  if(postMemoryUi.initialized){if(postMemoryUi.optionsStale)try{await refreshPostMemoryOptions();}catch(error){if($('postMemoryStatus'))$('postMemoryStatus').textContent=error.message;}return;}
  postMemoryUi.initialized=true;$('postMemoryContent').innerHTML='<p>メモリー選択 · 생성 후보 비교 정보를 불러오고 있어요.</p>';
  try{
    await refreshPostMemoryOptions();
    const choices=postMemoryUi.choices;
    $('postMemoryContent').innerHTML=`<section class="post-memory-intro"><h2>마지막 보상창에서 어느 메모리를 남길까요?</h2><p>다음 육성의 시나리오와 플랜을 고르고, 보상창의 원본을 입력하세요. 재생성했다면 ‘재생성 후보 추가’로 한 장 더 입력하고 ‘남길 메모리 비교’를 누르세요.</p></section><section class="post-target-panel"><h3>이 메모리를 사용할 곳</h3><div class="post-target-grid"><label>시나리오<select id="postTargetScenario"><option value="hif">H.I.F.</option><option value="hajime">初</option><option value="nia">N.I.A.</option></select></label><label>플랜<select id="postTargetPlan"><option value="anomaly">어노말리</option><option value="sense">센스</option><option value="logic">로직</option></select></label><label>육성 유형<select id="postTargetType">${Object.entries(effects).map(([key,label])=>`<option value="${key}">${escapeHtml(label)}</option>`).join('')}</select></label><label>사용할 때 PLv<input id="postTargetLevel" type="number" min="1" step="1" placeholder="미확인"></label><label>P아이돌(선택)<select id="postTargetIdol"><option value="">선택하지 않음</option>${recordsOf('idolCards').map(row=>`<option value="${escapeHtml(recordId(row))}">${escapeHtml(nameOf(row))}</option>`).join('')}</select></label><label>이벤트<select id="postTargetEvent"><option value="">일반 프로듀스</option>${array(ui.eventModes?.modes).map(mode=>`<option value="${mode.id}">${escapeHtml(mode.nameKo||mode.nameJa)}</option>`).join('')}</select></label></div><button type="button" class="button button-secondary" id="postShowGoals">이 조건의 제작 목표 보기</button></section><datalist id="postSkillOptions">${array(choices.skillCards).map(card=>`<option value="${escapeHtml(postSkillLabel(card))}"></option>`).join('')}</datalist><datalist id="postAbilityOptions">${array(choices.abilities).map(ability=>`<option value="${escapeHtml(postAbilityLabel(ability))}"></option>`).join('')}</datalist><div id="postCandidateInputs"></div><div class="post-form-actions"><button type="button" class="button button-secondary" id="postAddCandidate">재생성 후보 추가</button><button type="button" class="button button-primary" id="postCompareButton">남길 메모리 비교</button></div><p id="postMemoryStatus" role="status"></p><div id="postMemoryResult"></div>`;
    const request=ui.recommendationRequest??{};
    $('postTargetScenario').value=request.scenario||$('scenarioSelect').value||'hif';$('postTargetPlan').value=request.plan??selectedVariant()?.plan??$('recommendPlan').value??'anomaly';
    if(!$('postTargetPlan').value)$('postTargetPlan').value='anomaly';
    $('postTargetType').value=request.type??$('strategySelect').value??'fullPower';if(!$('postTargetType').value)$('postTargetType').value='fullPower';
    $('postTargetLevel').value=firstNumber(request.producerLevel,number($('producerLevelInput').value),ui.state?.inventory?.producerLevel)??'';
    $('postTargetIdol').value=request.idolId??$('idolSelect').value??'';$('postTargetEvent').value=request.eventModeId??$('eventModeSelect').value??'';
    const selectedPostIdol=()=>recordsOf('idolCards').find(row=>recordId(row)===$('postTargetIdol').value);
    const syncTarget=()=>{const allowed={sense:['concentration','goodConditionTurns'],logic:['motivation','goodImpressionTurns'],anomaly:['fullPower','strength','preservation']}[$('postTargetPlan').value];for(const option of $('postTargetType').options)option.disabled=!allowed.includes(option.value);if(!allowed.includes($('postTargetType').value))$('postTargetType').value=allowed[0];if($('postTargetScenario').value!=='hif'){$('postTargetEvent').value='';$('postTargetEvent').disabled=true;}else $('postTargetEvent').disabled=false;};
    const syncIdol=()=>{const idol=selectedPostIdol();syncIdolScenarios($('postTargetScenario'),idol);if(idol){$('postTargetPlan').value=planOf(idol);if(effects[idol.recommendedEffect])$('postTargetType').value=idol.recommendedEffect;}syncTarget();};
    $('postTargetIdol').addEventListener('change',syncIdol);
    $('postTargetPlan').addEventListener('change',()=>{const idol=selectedPostIdol();if(idol&&planOf(idol)!==$('postTargetPlan').value)$('postTargetIdol').value='';syncIdol();});$('postTargetScenario').addEventListener('change',syncTarget);syncIdol();
    for(const id of ['postTargetScenario','postTargetPlan','postTargetType','postTargetLevel','postTargetIdol','postTargetEvent']){$(id).addEventListener('change',markPostResultStale);$(id).addEventListener('input',markPostResultStale);}
    postMemoryUi.entries=[newPostMemory('원래 생성된 메모리')];renderPostEntries();
    $('postAddCandidate').addEventListener('click',()=>{postEntriesFromDom();postMemoryUi.entries.push(newPostMemory(postMemoryUi.entries.length?'재생성 후보 '+(postMemoryUi.nextId-1):'원래 생성된 메모리'));markPostResultStale();renderPostEntries();});
    $('postCompareButton').addEventListener('click',()=>comparePostMemories(false));$('postShowGoals').addEventListener('click',()=>comparePostMemories(true));
    $('postCandidateInputs').addEventListener('change',event=>{postEntriesFromDom();if(['skillQuery','customRecipe'].includes(event.target.dataset.outputField))renderPostEntries();});
    $('postCandidateInputs').addEventListener('input',markPostResultStale);$('postCandidateInputs').addEventListener('change',markPostResultStale);
    $('postCandidateInputs').addEventListener('click',event=>{
      const card=event.target.closest('[data-output-candidate]');if(!card)return;postEntriesFromDom();const entry=postMemoryUi.entries.find(row=>row.id===card.dataset.outputCandidate);
      if(event.target.closest('[data-output-remove]')){postMemoryUi.entries=postMemoryUi.entries.filter(row=>row!==entry);markPostResultStale();renderPostEntries();return;}
      const remove=event.target.closest('[data-output-remove-ability]');if(remove){entry.abilities=entry.abilities.filter(row=>row.id+'|'+row.level!==remove.dataset.outputRemoveAbility);markPostResultStale();renderPostEntries();return;}
      if(event.target.closest('[data-output-add-ability]')){const matches=array(choices.abilities).filter(row=>postAbilityLabel(row)===entry.abilityQuery.trim());if(matches.length!==1){toast('효과를 검색 목록에서 정확히 선택해 주세요.',true);return;}const ability=matches[0];if(!entry.abilities.some(row=>row.id===ability.id&&row.level===ability.level))entry.abilities.push(ability);entry.abilityQuery='';markPostResultStale();renderPostEntries();}
    });
    comparePostMemories(true);
  }catch(error){postMemoryUi.initialized=false;$('postMemoryContent').innerHTML='<p>'+escapeHtml(error.message)+'</p>';}
}
document.addEventListener('click',event=>{if(event.target.closest('[data-post-memory-open]')){event.preventDefault();setView('memory-output');}});
renderCollectorMode();
