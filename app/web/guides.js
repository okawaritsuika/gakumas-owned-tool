'use strict';

const guideLibrary={scenario:'hif',kind:'events',limit:24,data:null,loading:null};
const scenarioLabels={hajime:'初',nia:'N.I.A.',hif:'H.I.F.',common:'공통'};
const eventCategoryLabels={activity:'외출',school:'수업',business:'영업',opening:'프로듀스 시작'};
const guideTypeLabels={concentration:'집중',goodConditionTurns:'호조',motivation:'의욕',goodImpressionTurns:'호인상',fullPower:'전력',strength:'강기',preservation:'온존',general:'공통'};
function guideRichText(value){const content=plainGameText(value);return typeof memoryRichTextMarkup==='function'?memoryRichTextMarkup(content):escapeHtml(content);}
function guideBilingualText(primary,japanese,className=''){return `<span class="${className}">${guideRichText(primary)}</span>${japanese&&japanese!==primary?`<span class="name-ja" lang="ja">${guideRichText(japanese)}</span>`:''}`;}
function guideList(items,className=''){const rows=array(items).map(plainGameText).filter(Boolean);return rows.length?`<ul class="${className}">${rows.map(item=>`<li>${guideRichText(item)}</li>`).join('')}</ul>`:'';}
function guideSources(ids,sources){const rows=array(sources).filter(source=>array(ids).includes(source.id));return rows.length?`<div class="library-sources">${rows.map(source=>{const url=safeSourceUrl(source.url),date=[(source.published||source.publishedAt)?'게시 '+(source.published||source.publishedAt):'',source.updated?'수정 '+source.updated:'',source.checkedAt?'확인 '+source.checkedAt:''].filter(Boolean).join(' · ');return `<div>${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title||source.author||'근거 원문')} ↗</a>`:escapeHtml(source.title||'출처')} ${date?`<small>${escapeHtml(date)}</small>`:''}</div>`;}).join('')}</div>`:'';}
function guideMemoryRecommendations(guide){const rows=array(guide.memoryRecommendations);return rows.length?`<div class="library-memory-list">${rows.map(memory=>{const name=text(memory.nameKo)||text(memory.nameJa)||'메모리 후보',owned=recordsOf('memories').filter(record=>{const skill=memoryEffectsOf(record)?.carriedSkill;return memory.gameId?skill?.id===memory.gameId:memory.nameJa?skillJaOf(record)===memory.nameJa:skillOf(record)===memory.nameKo;}),skillVisual=typeof memorySkillVisualMarkup==='function'?memorySkillVisualMarkup(memory,{size:32,showJapanese:true}):bilingualMarkup(name,text(memory.nameJa),'library-memory-name');return `<article class="library-memory"><div>${skillVisual}<span class="library-memory-owned">${categoryStatus('memories')==='complete'||owned.length?`같은 스킬 보유 ${owned.length}개`:'보유 여부 미확인'} · 개시·강화·커스텀 조건 별도 확인</span>${memory.purpose?`<p>${guideRichText(memory.purpose)}</p>`:''}${guideList(memory.conditions)}</div></article>`;}).join('')}</div>`:'<p class="library-empty-note">이 공략에서 확정한 반입 스킬 목록이 없습니다. 준비 순서와 원문 조건을 확인하세요.</p>';}
function libraryEventMarkup(event,sources) {
  const comparator = eventComparisonMarkup(event);
  const choices = array(event.choices).map((choice,index) => {
    const outcomes = array(choice.successRewards).length || array(choice.failureRewards).length;
    const rewards = outcomes ? array(choice.rewards).filter(line => !/^\d+% 확률로 (성공|실패):/.test(line)) : choice.rewards;
    const probability = choice.successProbability;
    const result = (heading, rows) => array(rows).length ? `<h5>${heading}</h5>${guideList(rows,'choice-rewards')}` : '';
    const condition = array(choice.conditions).filter(line => !array(choice.costs).includes(line) && !(outcomes && line.startsWith('현재 단계의 성공률 ')));
    return `<article class="event-choice"><div><span class="choice-number">${index+1}</span><div>${guideBilingualText(text(choice.labelKo)||text(choice.labelJa)||'선택지',text(choice.labelJa),'choice-title')}</div></div>
      ${guideList(rewards,'choice-rewards')}${result('성공 시'+(Number.isFinite(probability)?' · '+probability+'%':''),choice.successRewards)}${result('실패 시'+(Number.isFinite(probability)?' · '+(100-probability)+'%':''),choice.failureRewards)}
      ${guideList(condition,'choice-conditions')}${comparator?`<label class="event-offer"><input type="checkbox" data-event-offer value="${index}"> 이 보기가 게임에 뜸</label>`:''}</article>`;
  }).join('');
  return `<details class="library-event" data-event-id="${escapeHtml(event.id)}"><summary>
    <span class="library-category">${escapeHtml(scenarioLabels[event.scenario]||event.scenario)} · ${escapeHtml(eventCategoryLabels[event.category]||'육성 이벤트')}${['nia','hajime'].includes(event.scenario)&&!guideRowDifficulty(event)?' · 난이도 미지정':''}</span>
    <strong>${guideRichText(event.titleKo||event.titleJa||'이벤트')}</strong>${event.titleJa&&event.titleKo?`<span class="name-ja" lang="ja">${guideRichText(event.titleJa)}</span>`:''}
    <span class="library-choice-count">선택지 ${array(event.choices).length}개</span></summary>
    <div class="library-event-body">${guideList(event.conditions,'library-conditions')}${comparator}<div class="event-choices">${choices}</div>
    ${guideList(event.notes,'library-notes')}${array(event.dialogueExampleKo).length?`<details class="event-dialogue-examples"><summary>게임 대사 예시 보기</summary><p>같은 조건과 보상의 대사 예시입니다. 캐릭터에 따라 문구가 달라질 수 있어요.</p>${guideList(event.dialogueExampleKo)}${guideList(event.eventNamesJa)}</details>`:''}
    ${guideSources(event.sourceIds,sources)}</div></details>`;
}
function libraryDeckMarkup(guide, sources, memoryOnly) {
  const flow = !memoryOnly && guide.examFlow;
  const title = text(guide.titleKo) || '육성 공략';
  const context = [scenarioLabels[guide.scenario], { regular:'레귤러', pro:'프로', master:'마스터', legend:'레전드' }[guide.difficulty],
    plans[guide.plan], guideTypeLabels[guide.trainingType]].filter(Boolean).join(' · ');
  const sections = [['초반 준비', guide.opening], ['중반 운영', guide.midgame], ['마무리', guide.finish], ['주의할 점', guide.pitfalls]]
    .filter(([, items]) => array(items).length);
  const guideSteps = sections.length ? `<div class="library-deck-steps">${sections.map(([label, items]) =>
    `<section><h4>${label}</h4>${guideList(items)}</section>`).join('')}</div>` : '';
  const farming = array(guide.farmingNotes).length ? `<section class="library-farming"><h4>메모리 제작·파밍 순서</h4>${guideList(guide.farmingNotes)}</section>` : '';
  const carry = memoryOnly ? `<h4>반입 메모리 후보</h4>${guideMemoryRecommendations(guide)}${farming}` :
    array(guide.memoryRecommendations).length ? `<details class="library-inline-memory"><summary>반입할 카드와 필요한 개조</summary>${guideMemoryRecommendations(guide)}${farming}</details>` : '';
  return `<details class="easy-guide-entry" data-guide-id="${escapeHtml(guide.id || '')}"><summary>${guideRichText(flow ? flow.goal : title)}
    <small>${escapeHtml(context)} · ${memoryOnly ? '반입 메모리·파밍' : '덱 운영'}</small></summary><article class="library-deck">
    ${guideList(guide.conditions, 'library-conditions')}
    ${flow ? examFlowMarkup(guide) : guide.summary ? `<p class="library-summary">${guideRichText(guide.summary)}</p>` : ''}
    ${memoryOnly ? '' : flow && guideSteps ? `<details class="library-inline-memory"><summary>원문 공략의 준비 순서와 세부 조건</summary>${guideSteps}</details>` : guideSteps}
    ${carry}${guideSources(guide.sourceIds,sources)}</article></details>`;
}
const eventDifficultyLabels = {
  '初 · 레귤러': 'regular', '初 · PRO': 'pro', '初 · 마스터': 'master', '初 · 레전드': 'legend',
  'NIA · PRO': 'pro', 'NIA · 마스터': 'master'
};
function activeGuideDifficulty(scenario) {
  const field = $('guideDifficulty');
  field.hidden = scenario === 'hif' || scenario === 'all';
  for (const option of field.options) {
    option.hidden = scenario === 'nia' && ['regular', 'legend'].includes(option.value);
  }
  if (field.selectedOptions[0]?.hidden) field.value = '';
  return field.hidden ? '' : field.value;
}
function guideRowDifficulty(row) {
  return row.difficulty || array(row.conditions).map(label => eventDifficultyLabels[label]).find(Boolean);
}
function guideRowsForDifficulty(rows, difficulty) {
  if (!difficulty) return rows;
  const specific = [], unspecified = [];
  for (const row of rows) {
    const value = guideRowDifficulty(row);
    if (value === difficulty) specific.push(row);
    else if (!value) unspecified.push(row);
  }
  return specific.concat(unspecified);
}
function scenarioWalkthrough(scenario, difficulty) {
  const hajime = {regular:'레귤러는 6주차에 중간시험, 13주차에 최종시험을 봅니다.',pro:'프로는 7주차에 중간시험, 16주차에 최종시험을 봅니다.',master:'마스터는 8주차에 중간시험, 18주차에 최종시험을 봅니다.',legend:'레전드는 10주차에 중간시험, 18주차에 최종시험을 봅니다.'};
  const nia = {pro:'프로는 9·18·27주차에 오디션이 열립니다.',master:'마스터는 9·17·26주차에 오디션이 열립니다.'};
  if (scenario === 'hajime') return [
    ['다음 시험', hajime[difficulty] || '난이도를 고르면 중간·최종 시험 주차를 볼 수 있어요.'],
    ['시험 전 선택', '레슨과 수업에서 부족한 속성을 올리세요. 체력을 쓰는 선택은 다음 레슨에 쓸 체력을 남길 수 있는지 먼저 보세요.'],
    ['시험 덱', difficulty==='legend'?'중간시험에 합격하면 제시된 레전드 카드 중 한 장을 고릅니다. 편성 결과의 중간시험 날짜에서 실제 후보와 현재 덱을 입력하세요.':'덱 운영법에서 내 플랜을 고르고, 준비할 카드와 점수를 낼 카드를 확인하세요.']
  ];
  if (scenario === 'nia') return [
    ['다음 오디션', nia[difficulty] || '프로는 9·18·27주차, 마스터는 9·17·26주차에 오디션이 열립니다.'],
    ['영업일', '게임에 열린 장소부터 확인하세요. 드링크가 필요하면 드링크 보상, 주력 카드를 보완하려면 강화 카드 보상을 보고 체력·P 비용을 비교하세요.'],
    ['입장 전', '편성 결과의 오디션 날짜에 현재 팬 투표수와 화면의 입장 조건을 입력하세요. 들어갈 수 있는 후보 중 원하는 순서로 고릅니다.']
  ];
  if (scenario === 'hif') return [
    ['선발', '20일 동안 다음 시험을 준비합니다. 회복이 급하면 외출, P포인트·카드·드링크가 필요하면 사시이레, 원하는 카드를 강화하거나 지울 비용이 있으면 상담을 살펴보세요.'],
    ['본선 준비', '본선 첫 6일 동안 레슨·수업에서 부족한 속성을 보완하고, 덱 운영법에서 라운드에 쓸 카드를 확인하세요.'],
    ['본선 당일', '7일째에 라운드 1 → 인터벌 → 라운드 2를 이어서 진행합니다. 인터벌에서는 R1 보상까지 받은 잔액과 지금 진열된 가격으로 R2용 상품을 고르세요.']
  ];
  return [];
}
function renderGuideLibrary() {
  const data=guideLibrary.data;
  if(!data)return;
  const scenario=guideLibrary.scenario, events=guideLibrary.kind==='events', dataset=events?data.events:data.decks;
  const difficulty=activeGuideDifficulty(scenario), query=normalized($('guideSearch').value), plan=$('guidePlan').value, category=$('guideCategory').value;
  const planNames={sense:'센스',logic:'로직',anomaly:'어노말리'};
  const rows=guideRowsForDifficulty(array(events?dataset?.events:dataset?.guides),difficulty).filter(row=>{
    if(scenario!=='all' && row.scenario!==scenario && row.scenario!=='common')return false;
    if(guideLibrary.kind==='memories' && !array(row.memoryRecommendations).length && !array(row.farmingNotes).length)return false;
    if(events && category && row.category!==category)return false;
    const eventPlans=array(row.conditions).filter(value=>Object.values(planNames).includes(value));
    if(plan && (events?eventPlans.length && !eventPlans.includes(planNames[plan]):row.plan!==plan && row.plan!=='free'))return false;
    return !query || normalized(JSON.stringify(row)).includes(query);
  });
  if (guideLibrary.kind==='decks') rows.sort((a,b)=>Number(Boolean(b.examFlow))-Number(Boolean(a.examFlow)));
  $('guideCategory').hidden=!events;
  $('guideResultCount').textContent=`${events?'이벤트':guideLibrary.kind==='memories'?'메모리 공략':'덱 운영 공략'} ${rows.length}개 · ${Math.min(rows.length,guideLibrary.limit)}개 표시`;
  const freshness=typeof ui!=='undefined'?ui.catalogFreshness:null, checkedAt=freshness?.checkedAt||dataset?.asOf;
  $('guideUpdatedAt').textContent=[checkedAt?'자료 검토 '+checkedAt:'',freshness?.masterSnapshotDate?'원자료 '+freshness.masterSnapshotDate:''].filter(Boolean).join(' · ');
  const steps=scenarioWalkthrough(scenario,difficulty);
  const notes=array(data.events?.scenarios).find(row=>row.id===scenario)?.notes??[];
  const overview=steps.length?`<h3>일반 ${escapeHtml(scenarioLabels[scenario])} 진행 순서</h3><dl class="guide-progression">${steps.map(([title,body])=>`<div><dt>${title}</dt><dd>${body}</dd></div>`).join('')}</dl>`:'';
  const scope=events?`<details class="event-dialogue-examples"><summary>자료 범위와 보상 표 읽는 법</summary>${guideList(notes)}${guideList(data.events?.notes)}</details>`:'';
  $('guideScenarioNotes').innerHTML=overview+(difficulty&&events?'<p>선택한 난이도로 확인된 이벤트를 먼저 표시합니다. ‘난이도 미지정’은 실제 메뉴와 보상·비용이 일치할 때 참고하세요.</p>':'')+scope;
  $('guideLibraryResults').innerHTML=rows.slice(0,guideLibrary.limit).map(row=>events?libraryEventMarkup(row,dataset?.sources):libraryDeckMarkup(row,dataset?.sources,guideLibrary.kind==='memories')).join('')||'<p class="library-no-results">현재 조건에 맞는 공략이 없습니다. 시나리오나 검색어를 바꿔 보세요.</p>';
  $('guideShowMore').hidden=rows.length<=guideLibrary.limit;
}
async function loadGuideLibrary(){if(guideLibrary.data){renderGuideLibrary();return;}if(guideLibrary.loading)return guideLibrary.loading;guideLibrary.loading=(async()=>{try{const [data]=await Promise.all([api('/api/guides'),typeof loadMemorySkillVisualCatalog==='function'?loadMemorySkillVisualCatalog().catch(()=>null):Promise.resolve(null)]);guideLibrary.data=data;if(typeof ui!=='undefined'&&!array(ui.skillVisualCatalog).length)ui.skillVisualCatalog=array(data.skillCards);renderGuideLibrary();}catch(error){$('guideResultCount').textContent='공략 자료를 불러오지 못했어요.';$('guideLibraryResults').innerHTML=`<p class="library-no-results">${escapeHtml(error.message)}</p><button type="button" class="button button-secondary" data-retry-guides>다시 불러오기</button>`;}finally{guideLibrary.loading=null;}})();return guideLibrary.loading;}
document.querySelectorAll('[data-guide-scenario]').forEach(button=>button.addEventListener('click',()=>{guideLibrary.scenario=button.dataset.guideScenario;guideLibrary.limit=24;document.querySelectorAll('[data-guide-scenario]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});renderGuideLibrary();}));
document.querySelectorAll('[data-guide-kind]').forEach(button=>button.addEventListener('click',()=>{guideLibrary.kind=button.dataset.guideKind;guideLibrary.limit=24;document.querySelectorAll('[data-guide-kind]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});renderGuideLibrary();}));
for(const id of ['guideSearch','guidePlan','guideCategory','guideDifficulty'])$(id).addEventListener(id==='guideSearch'?'input':'change',()=>{guideLibrary.limit=24;renderGuideLibrary();});
$('guideShowMore').addEventListener('click',()=>{guideLibrary.limit+=24;renderGuideLibrary();});
$('guideLibraryResults').addEventListener('click',event=>{if(event.target.closest('[data-retry-guides]'))loadGuideLibrary();});
$('guideLibraryResults').addEventListener('input', event=>{
  const element=event.target.closest('[data-event-id]');
  if(!element)return;
  const row=guideLibrary.data?.events?.events?.find(item=>item.id===element.dataset.eventId);
  updateEventComparison(element,row);
});
document.querySelector('[data-view="guides"]').addEventListener('click',loadGuideLibrary);
