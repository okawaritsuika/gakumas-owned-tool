'use strict';

const skillAdvice = {
  options: null, rows: [], selectedId: '', detail: null, pageSize: 48, limit: 48,
  loading: null, pending: false, request: 0, detailRequest: 0, compareRequest: 0,
  conditions: new Map(), comparison: null, timer: null, returnFocusId: '',
};
const skillAdviceTypes = {
  concentration: { label: '센스 · 집중 / 각광', plan: 'sense' },
  goodConditionTurns: { label: '센스 · 호조', plan: 'sense' },
  goodImpressionTurns: { label: '로직 · 호인상', plan: 'logic' },
  motivation: { label: '로직 · 의욕', plan: 'logic' },
  strength: { label: '아노말리 · 강기', plan: 'anomaly' },
  fullPower: { label: '아노말리 · 전력', plan: 'anomaly' },
  preservation: { label: '아노말리 · 온존', plan: 'anomaly' },
};
const skillAdviceTierLabels = { core: 'S', recommended: 'A', situational: 'B', low: 'C', avoid: 'D', unrated: '미평가' };
const skillAdviceSourceLabels = { produce: '육성 중 획득', legend: '레전드', default: '시작 덱 기본', support: '서포트 전용', pIdol: 'P아이돌 고유', primaStella: '일번성', trouble: '트러블', unmatched: '카드 연결 미확인' };
const skillAdviceRoleLabels = { score: '화력', draw: '드로', extra_action: '추가행동', stamina: '체력 관리', concentration: '집중', good_condition: '호조', excellent_condition: '절호조', motivation: '의욕', genki: '원기', impression: '호인상', guidance: '지침 전환', full_power: '전력치', hand_buff: '손패 강화', growth: '성장', compression: '덱 압축', turn_extension: '턴 연장', debuff_protection: '약화 방지', recovery: '회복', preserve: '보류', resource: '자원 보조', setup: '초반 준비', finisher: '마무리', trouble: '트러블', legend: '레전드' };

function skillAdviceId(row) { return String(row?.id ?? row?.gameId ?? ''); }
function skillAdviceName(row) { return row?.nameKo || row?.name || row?.nameJa || '이름 확인 필요'; }
function skillAdviceIsLegend(row) { return row?.isLegend === true || row?.card?.isLegend === true || /legend/i.test(row?.rarity || ''); }
function skillAdviceIsTrouble(row) { return /trouble/i.test(row?.category || row?.card?.category || ''); }
function skillAdviceIsOrdinary(row) { return row?.sourceType === 'produce' && !skillAdviceIsLegend(row) && !skillAdviceIsTrouble(row); }
function skillAdviceSourceLabel(row) { return skillAdviceSourceLabels[skillAdviceIsLegend(row) ? 'legend' : skillAdviceIsTrouble(row) ? 'trouble' : row?.sourceType] || '획득 경로 확인'; }
function skillAdviceText(row) { return typeof row === 'string' ? plainGameText(row) : plainGameText(row?.labelKo || row?.label || row?.summaryKo || row?.summary || row?.text || row?.description || row?.reason || row?.name || ''); }
function skillAdviceStrings(rows) { return array(rows).map(skillAdviceText).filter(Boolean); }
function skillAdviceList(rows, empty = '') {
  const items = skillAdviceStrings(rows);
  return items.length ? `<ul>${items.map(row => `<li>${escapeHtml(row)}</li>`).join('')}</ul>` : empty ? `<p class="skill-advice-muted">${escapeHtml(empty)}</p>` : '';
}
function skillAdviceNameMarkup(row) {
  const name = skillAdviceName(row), japanese = row?.nameJa;
  return `<strong>${escapeHtml(name)}</strong>${japanese && japanese !== name ? `<small lang="ja">${escapeHtml(japanese)}</small>` : ''}`;
}
function skillAdviceRating(row) {
  const rating = row?.rating || { tier: 'unrated', basis: skillAdvice.pending ? 'pending' : 'unknown' };
  const tier = rating.performanceTier || rating.tier || 'unrated';
  return { ...rating, tier, label: skillAdviceTierLabels[tier] || '미평가' };
}
function skillAdviceBadge(row) {
  if (!row?.rating && skillAdvice.pending) return '<span class="skill-advice-tier tier-unrated" aria-label="평가 중">평가 중</span>';
  const rating = skillAdviceRating(row), tier = Object.hasOwn(skillAdviceTierLabels, rating.tier) ? rating.tier : 'unrated';
  return `<span class="skill-advice-tier tier-${tier}" aria-label="${tier === 'unrated' ? '미평가' : `${skillAdviceTierLabels[tier]} 티어`}">${escapeHtml(skillAdviceTierLabels[tier])}</span>`;
}
function skillAdviceConditionBadge(row) {
  if (!row?.eligibility) return '';
  const status = row?.eligibility?.status, reasons = skillAdviceStrings(row?.eligibility?.reasons);
  const missing = skillAdviceStrings(row?.missingConditions);
  if (status === 'eligible' && !missing.length) return '';
  const label = status === 'blocked' ? reasons.some(reason => /플랜.*다른|다른.*플랜/.test(reason)) ? '다른 플랜' : reasons.some(reason => /앱의 반입 PLv 비교 기준 미충족/.test(reason)) ? '앱 PLv 기준' : reasons.some(reason => /해금 전|PLv/.test(reason)) ? '해금 전' : '사용 제한' : status === 'restricted' ? '획득 경로 확인' : '조건 확인';
  return `<span class="skill-advice-condition-chip" title="${escapeHtml([...reasons, ...missing].join(' '))}">${label}</span>`;
}
function skillAdviceBasis(row) {
  const rating = skillAdviceRating(row);
  return rating.guideBasis === 'author_preview' ? '출시 전 의견 기반 잠정' : ({ guide: '공략 근거', derived: '효과 기반 잠정', unknown: '미평가', pending: '평가 중' })[rating.basis] || '미평가';
}
function skillAdviceEligibility(row) {
  const status = row?.eligibility?.status;
  if (status === 'blocked' && skillAdviceStrings(row.eligibility.reasons).some(reason => /앱의 반입 PLv 비교 기준 미충족/.test(reason))) return '앱 PLv 비교 기준 미충족';
  return ({ eligible: '사용 조건 확인', blocked: '현재 조건에서 사용 불가', unknown: '사용 조건 확인 필요', restricted: '획득 경로 제한' })[status] || '사용 조건 확인 필요';
}
function skillAdviceCurrentConditions(id = skillAdvice.selectedId) {
  return { customizationState: 'unknown', hifAbilityState: 'unknown', switchState: 'unknown', acquisitionTimingState: 'unknown', ...skillAdvice.conditions.get(skillAdviceConditionKey(id)) };
}
function skillAdviceConditionKey(id = skillAdvice.selectedId) {
  return JSON.stringify({ id, ...skillAdviceContext() });
}
function skillAdviceContext() {
  const scenario = $('skillAdviceScenario').value;
  return {
    scenario, ...(scenario !== 'hif' ? { difficulty: $('skillAdviceDifficulty').value } : {}),
    trainingType: $('skillAdviceType').value,
    producerLevel: number($('skillAdviceLevel').value),
    upgradeCount: Number($('skillAdviceUpgrade').value), purpose: $('skillAdvicePurpose').value,
    stage: $('skillAdviceStage').value,
    strategy: scenario === 'nia' ? $('skillAdviceStrategy').value : 'general',
    ...(scenario === 'hajime' && $('skillAdviceDifficulty').value === 'legend' && $('skillAdviceLegend').value ? { legendCardGameId: $('skillAdviceLegend').value } : {}),
    ...($('skillAdviceIdol').value ? { idolGameId: $('skillAdviceIdol').value } : {}),
  };
}
function skillAdviceDifficultyOptions() {
  const select = $('skillAdviceDifficulty'), previous = select.value, scenario = $('skillAdviceScenario').value;
  const choices = scenario === 'hif' ? [['', '선발·본선']] : scenario === 'nia' ? [['pro', 'PRO'], ['master', 'MASTER']] : [['regular', 'REGULAR'], ['pro', 'PRO'], ['master', 'MASTER'], ['legend', 'LEGEND']];
  select.innerHTML = choices.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  select.value = choices.some(([value]) => value === previous) ? previous : scenario === 'nia' ? 'master' : scenario === 'hajime' ? 'legend' : '';
  select.disabled = scenario === 'hif';
  $('skillAdviceStrategyField').hidden = scenario !== 'nia';
  if (scenario !== 'nia') $('skillAdviceStrategy').value = 'general';
  skillAdviceLegendOptions();
}
function skillAdviceLegendOptions() {
  const select = $('skillAdviceLegend'), previous = select.value;
  const active = $('skillAdviceScenario').value === 'hajime' && $('skillAdviceDifficulty').value === 'legend';
  $('skillAdviceLegendField').hidden = !active;
  const plan = skillAdviceTypes[$('skillAdviceType').value]?.plan;
  const rows = array(skillAdvice.options?.cards).filter(row => row.isLegend && row.sourceType === 'produce' && [plan, 'free'].includes(row.plan));
  select.innerHTML = '<option value="">레전드 스킬 미지정</option>' + rows.map(row => `<option value="${escapeHtml(skillAdviceId(row))}">${escapeHtml(skillAdviceName(row))}</option>`).join('');
  if (active && rows.some(row => skillAdviceId(row) === previous)) select.value = previous;
}
function skillAdviceIdolOptions() {
  const select = $('skillAdviceIdol'), previous = select.value;
  const plan = skillAdviceTypes[$('skillAdviceType').value]?.plan;
  const rows = array(skillAdvice.options?.idolCards).length ? skillAdvice.options.idolCards : typeof recordsOf === 'function' ? recordsOf('idolCards') : [];
  const scenario = $('skillAdviceScenario').value;
  const matching = rows.filter(row => (!plan || row.plan === plan) && !row.excludedScenarios?.includes(scenario));
  select.innerHTML = '<option value="">고유 효과 미지정</option>' + matching.map(row => `<option value="${escapeHtml(skillAdviceId(row))}">${escapeHtml(skillAdviceName(row))}</option>`).join('');
  if (matching.some(row => skillAdviceId(row) === previous)) select.value = previous;
}
function skillAdviceShell() {
  return `<div class="skill-advice-browser">
    <section class="skill-advice-settings" aria-labelledby="skillAdviceHeading">
      <div class="skill-advice-heading"><div><div class="eyebrow">CHOOSE FOR YOUR DECK</div><h2 id="skillAdviceHeading">카드의 역할과 조합을 함께 보세요</h2><p>같은 카드도 해금된 카드 풀과 덱, 개조 상태에 따라 추천도가 달라져요.</p></div><span id="skillAdviceCoverage" class="skill-advice-coverage"></span></div>
      <form id="skillAdviceForm">
        <div class="skill-advice-condition-grid">
          <label>시나리오<select id="skillAdviceScenario"><option value="hif">H.I.F.</option><option value="nia">N.I.A.</option><option value="hajime">初</option></select></label>
          <label>난이도<select id="skillAdviceDifficulty"></select></label>
          <label class="skill-advice-type-field">덱 유형<select id="skillAdviceType">${Object.entries(skillAdviceTypes).map(([value, row]) => `<option value="${value}">${row.label}</option>`).join('')}</select></label>
          <label id="skillAdviceStrategyField" hidden>NIA 육성 방식<select id="skillAdviceStrategy"><option value="general">방식 미지정</option><option value="inflation">팽창 · 카드 확보 중심</option><option value="outing">외출 중심</option></select></label>
          <label id="skillAdviceLegendField" hidden>레전드 스킬<select id="skillAdviceLegend"><option value="">레전드 스킬 미지정</option></select></label>
          <label>프로듀서 레벨<input id="skillAdviceLevel" type="number" min="1" max="90" step="1" placeholder="미확인"></label>
          <label>카드 강화<select id="skillAdviceUpgrade"><option value="0">미강화</option><option value="1" selected>강화 (+)</option></select></label>
          <label>비교할 목적<select id="skillAdvicePurpose"><option value="acquisition">도중에 집을 카드</option><option value="memory">메모리로 가져갈 카드</option><option value="upgrade">강화 우선순위</option><option value="customization">커스텀 우선순위</option></select></label>
          <label>쓰려는 시점<select id="skillAdviceStage"><option value="any">전체 흐름</option><option value="early">초반 · 안정 통과</option><option value="late">후반 · 화력 마무리</option></select></label>
          <label class="skill-advice-idol-field">P아이돌 <small>선택</small><select id="skillAdviceIdol"><option value="">고유 효과 미지정</option></select></label>
        </div>
        <div class="skill-advice-settings-bottom"><p>공략 근거와 효과에서 추론한 잠정 평가를 구분해 표시해요. 미평가는 비추천과 달라요.</p><button id="skillAdviceApply" class="button button-primary" type="submit">이 조건으로 보기</button></div>
      </form>
      <p id="skillAdviceNotice" class="skill-advice-notice" role="status" hidden></p>
    </section>
    <div class="skill-advice-workspace">
      <section class="skill-advice-collection" aria-labelledby="skillAdviceCollectionTitle">
        <div class="skill-advice-collection-heading"><h3 id="skillAdviceCollectionTitle">육성 중 획득하는 스킬</h3><span id="skillAdviceResultCount" role="status"></span></div>
        <div class="skill-advice-search"><label class="sr-only" for="skillAdviceSearch">스킬 이름 검색</label><input id="skillAdviceSearch" type="search" placeholder="한국어 · 일본어 스킬 이름 검색"></div>
        <div class="skill-advice-list-filters">
          <label class="sr-only" for="skillAdvicePlanFilter">카드 플랜</label><select id="skillAdvicePlanFilter"><option value="matching">현재 덱 + 공용</option><option value="all">모든 플랜</option><option value="sense">센스</option><option value="logic">로직</option><option value="anomaly">아노말리</option><option value="free">공용</option></select>
          <label class="sr-only" for="skillAdviceSourceFilter">카드 획득 분류</label><select id="skillAdviceSourceFilter">${Object.entries(skillAdviceSourceLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}<option value="all">전체 카드</option></select>
          <label class="sr-only" for="skillAdviceRatingFilter">티어</label><select id="skillAdviceRatingFilter"><option value="">모든 티어</option>${Object.entries(skillAdviceTierLabels).map(([value, label]) => `<option value="${value}">${value === 'unrated' ? label : `${label} 티어`}</option>`).join('')}</select>
          <label class="sr-only" for="skillAdviceSort">정렬</label><select id="skillAdviceSort"><option value="rating">티어순</option><option value="name">이름순</option></select>
        </div>
        <p class="skill-advice-tier-legend"><span><b>S</b> 핵심</span><span><b>A</b> 우수</span><span><b>B</b> 활용 가능</span><span><b>C</b> 후순위</span><span><b>D</b> 비권장</span><small>사용 조건은 티어와 따로 표시해요.</small></p>
        <p id="skillAdviceEvidenceCoverage" class="skill-advice-evidence-coverage" role="status"></p>
        <div id="skillAdviceList" class="skill-advice-list" aria-busy="false"></div>
        <button id="skillAdviceMore" type="button" class="button button-secondary" hidden>카드 더 보기</button>
      </section>
    </div>
    <dialog id="skillAdviceDialog" class="skill-advice-dialog" aria-label="스킬 카드 상세" aria-labelledby="skillAdviceDetailTitle"><div class="skill-advice-dialog-top"><span>스킬 카드 상세</span><button type="button" data-skill-advice-close aria-label="스킬 카드 상세 닫기">×</button></div><section id="skillAdviceDetail" class="skill-advice-detail" aria-label="선택한 스킬 카드 상세"><p class="skill-advice-placeholder">카드를 고르면 사용 흐름과 함께 쓸 조합을 보여드려요.</p></section></dialog>
  </div>`;
}
function skillAdviceCombinedRows() {
  const evaluations = new Map(skillAdvice.rows.map(row => [skillAdviceId(row), row]));
  return array(skillAdvice.options?.cards).map(row => ({ ...row, ...evaluations.get(skillAdviceId(row)) }));
}
function skillAdviceFilteredRows() {
  const query = normalized($('skillAdviceSearch').value), planFilter = $('skillAdvicePlanFilter').value;
  const currentPlan = skillAdviceTypes[$('skillAdviceType').value]?.plan;
  const source = $('skillAdviceSourceFilter').value, tier = $('skillAdviceRatingFilter').value;
  const rows = skillAdviceCombinedRows().filter(row => {
    const matching = !row.plan || row.plan === 'free' || row.plan === currentPlan;
    let sourceMatches = !source || source === 'all' || row.sourceType === source;
    if (source === 'produce') sourceMatches = skillAdviceIsOrdinary(row);
    else if (source === 'legend') sourceMatches = skillAdviceIsLegend(row);
    else if (source === 'trouble') sourceMatches = skillAdviceIsTrouble(row);
    else if (source === 'unmatched') sourceMatches = !row.gameId;
    return (planFilter === 'all' || planFilter === 'matching' ? planFilter === 'all' || matching : row.plan === planFilter) && sourceMatches && (!tier || skillAdviceRating(row).tier === tier) && (!query || normalized([row.name, row.nameKo, row.nameJa, ...skillAdviceStrings(row.roles)].join(' ')).includes(query));
  });
  const order = Object.keys(skillAdviceTierLabels);
  const nameOrder = (a, b) => skillAdviceName(a).localeCompare(skillAdviceName(b), 'ko');
  rows.sort((a, b) => ((!source || source === 'all') ? Number(!skillAdviceIsOrdinary(a)) - Number(!skillAdviceIsOrdinary(b)) : 0) || ($('skillAdviceSort').value === 'name' ? nameOrder(a, b) : order.indexOf(skillAdviceRating(a).tier) - order.indexOf(skillAdviceRating(b).tier) || nameOrder(a, b)));
  return rows;
}
function renderSkillAdviceList() {
  if (!$('skillAdviceList')) return;
  const list = $('skillAdviceList'), focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.skillAdviceCard : null;
  const rows = skillAdviceFilteredRows(), total = array(skillAdvice.options?.cards).length;
  const source = $('skillAdviceSourceFilter').value;
  $('skillAdviceCollectionTitle').textContent = source === 'produce' ? '육성 중 획득하는 스킬' : !source || source === 'all' ? '전체 스킬 카드' : skillAdviceSourceLabels[source] || '스킬 카드';
  $('skillAdviceResultCount').textContent = skillAdvice.pending ? '변경된 조건으로 확인 중…' : `${rows.length} / ${total}종`;
  const guideCount = rows.filter(row => row.rating?.basis === 'guide').length;
  const derivedCount = rows.filter(row => row.rating?.basis === 'derived').length;
  const unratedCount = rows.filter(row => skillAdviceRating(row).tier === 'unrated').length;
  $('skillAdviceEvidenceCoverage').textContent = skillAdvice.pending ? '공략 근거를 대조하고 있어요.' : `현재 목록: 공략 평가 ${guideCount}장 · 효과 추론 ${derivedCount}장 · 미평가 ${unratedCount}장. 효과 추론은 공략의 직접 평가와 구별해요.`;
  $('skillAdviceList').setAttribute('aria-busy', String(skillAdvice.pending));
  $('skillAdviceList').classList.toggle('is-pending', skillAdvice.pending);
  $('skillAdviceList').innerHTML = rows.slice(0, skillAdvice.limit).map(row => {
    const id = skillAdviceId(row), reasons = skillAdviceStrings(row.reasons), selected = id === skillAdvice.selectedId;
    const evaluation = row.rating?.evaluationContext;
    const evaluationLabel = evaluation?.isSelectedType === false ? skillAdviceTypes[evaluation.trainingType]?.label?.replace(/^(센스|로직|아노말리) · /, '') : '';
    return `<button type="button" class="skill-advice-card${selected ? ' selected' : ''}" data-skill-advice-card="${escapeHtml(id)}" aria-pressed="${selected}" aria-haspopup="dialog" title="${escapeHtml([skillAdviceName(row), reasons[0]].filter(Boolean).join(' · '))}"><span class="skill-advice-card-picture">${visualFrame(assetUrl(row.imageUrl, row.thumbnailUrl), `${skillAdviceName(row)} 카드`, 'skill-advice-card-art')}${skillAdviceBadge(row)}</span><span class="skill-advice-card-copy"><span class="skill-advice-card-name">${skillAdviceNameMarkup(row)}</span>${evaluationLabel ? `<small class="skill-advice-card-context">${escapeHtml(evaluationLabel)} 기준</small>` : ''}<span class="skill-advice-card-badges">${skillAdviceConditionBadge(row)}<span class="skill-advice-basis">${escapeHtml(({ guide: '공략', derived: '잠정', unknown: '미평가', pending: '평가 중' })[skillAdviceRating(row).basis] || '미평가')}</span></span></span></button>`;
  }).join('') || '<p class="skill-advice-empty">일치하는 카드가 없어요. 이름이나 필터를 바꿔 보세요.</p>';
  $('skillAdviceMore').hidden = rows.length <= skillAdvice.limit;
  if (focusedId) [...list.querySelectorAll('[data-skill-advice-card]')].find(button => button.dataset.skillAdviceCard === focusedId)?.focus();
}
function skillAdviceEvidenceMarkup(row) {
  const sourceIndex = new Map(array(skillAdvice.options?.sources).map(source => [source.id, source]));
  const evidence = array(row.evidence);
  if (!evidence.length) return '<p class="skill-advice-muted">이 조건에 맞는 카드별 공략 근거가 부족해요. 효과 기반 평가는 잠정으로 표시합니다.</p>';
  return evidence.map(item => {
    const source = sourceIndex.get(item.sourceId) || {}, url = safeSourceUrl(item.url || source.url);
    const summary = skillAdviceText(item), sourceName = item.author || source.author || source.titleKo || source.title || source.titleJa || '근거 원문';
    const dates = [source.publishedAt || source.published, source.updatedAt || source.updated, source.checkedAt ? `확인 ${source.checkedAt}` : ''].filter(Boolean).join(' · ');
    const original = item.originalGrade ? `원문 등급 ${item.originalGrade}` : item.authorCategory ? `원문 분류: ${item.authorCategory}` : '';
    const builds = [['goodConditionBuild', '호조'], ['concentrationBuild', '집중']].filter(([key]) => item.sourceBuildRatings?.[key]).map(([key, label]) => `${label} ${item.sourceBuildRatings[key]}`);
    const scale = item.authorRatingScale ? Object.entries(item.authorRatingScale).map(([grade, tier]) => `${grade}→${skillAdviceTierLabels[tier] || tier}`).join(' · ') : '';
    return `<article class="skill-advice-evidence">${item.supersededByEvidenceId ? '<small>대체된 과거 기록 · 현재 티어에 미반영</small>' : ''}${item.appliedToRating || original || item.normalizedGrade ? `<small>${item.appliedToRating ? '현재 티어에 반영 · ' : ''}${item.normalizedGrade ? `화면 ${escapeHtml(item.normalizedGrade)} · ` : ''}${escapeHtml(original)}</small>` : ''}${summary ? `<p>${escapeHtml(summary)}</p>` : ''}${builds.length ? `<small>원문의 별도 유형 평가: ${escapeHtml(builds.join(' · '))}. PLv별 획득 평가와 별도 열입니다.</small>` : ''}${scale ? `<small>이 글의 등급 체계와 화면 대응: ${escapeHtml(scale)}</small>` : ''}${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceName)} ↗</a>` : `<span>${escapeHtml(sourceName)}</span>`}${dates ? `<small>${escapeHtml(dates)}</small>` : ''}${item.conditions ? skillAdviceList(item.conditions) : ''}</article>`;
  }).join('');
}
function skillAdviceRelationsMarkup(row) {
  const labels = { required: '이 조합에 필요', required_for_combo: '이 조합에 필요', combo_sequence: '사용 순서', synergy: '함께 쓰면 좋음', alternative: '대체 카드', conflict: '함께 쓰기 주의', slot_competition: '보류·손패 공간 경쟁', resource_support: '자원 보완', timing_and_stamina_competition: '사용 시점·체력 경쟁', setup_for_finisher: '마무리를 위한 준비', alternative_with_different_cost: '조건이 다른 대안', same_conditional_role: '같은 조건부 역할' };
  const rows = array(row.relationships);
  return rows.length ? `<div class="skill-advice-relations">${rows.map(relation => `<article><span class="skill-advice-relation-label">${escapeHtml(relation.label || labels[relation.type] || '관련 카드')}</span><div>${array(relation.cards).map(ref => `<button type="button" data-skill-advice-card="${escapeHtml(skillAdviceId(ref))}" class="skill-advice-related-card">${visualFrame(assetUrl(ref.imageUrl, ref.thumbnailUrl), `${skillAdviceName(ref)} 카드`, 'skill-advice-related-art')}<span class="skill-advice-related-name">${skillAdviceNameMarkup(ref)}</span><span class="skill-advice-related-arrow" aria-hidden="true">↗</span></button>`).join('')}</div>${relation.reason || relation.reasonKo ? `<p>${escapeHtml(relation.reason || relation.reasonKo)}</p>` : ''}</article>`).join('')}</div>` : '<p class="skill-advice-muted">현재 조건에서 확인한 카드 조합이 없어요.</p>';
}
function skillAdviceAssumptionSelect(id, label, value, options) {
  return `<label>${label}<select data-skill-advice-condition="${id}">${options.map(([key, title]) => `<option value="${key}"${key === value ? ' selected' : ''}>${title}</option>`).join('')}</select></label>`;
}
function skillAdviceMetaMarkup(row) {
  const meta = row.meta || {}, rows = [];
  if (meta.unlockProducerLevel > 0) rows.push(['일반 획득 해금', `PLv ${meta.unlockProducerLevel}`]);
  if (meta.rentalUnlockProducerLevel > 0) rows.push(['대여 해금 기준', `PLv ${meta.rentalUnlockProducerLevel} · 자기 보유 메모리 반입의 공식 적용은 미확정`]);
  if (meta.conversionProducerLevel > 0) rows.push(['스킬 스위치 해금', `PLv ${meta.conversionProducerLevel}`]);
  if (meta.requiresSwitch) rows.push(['스킬 스위치', '해금과 선택 상태를 함께 확인']);
  if (meta.maxCustomizeCount != null) rows.push(['선택 강화판의 커스텀 상한', `${meta.maxCustomizeCount}회`]);
  const owners = [...new Set([...array(meta.origin?.idolGameIds), ...array(meta.origin?.primaStellaIdolIds)])].map(id => array(skillAdvice.options?.idolCards).find(idol => skillAdviceId(idol) === id)).filter(Boolean);
  if (meta.origin?.name || meta.origin?.nameKo || meta.origin?.nameJa) rows.push(['얻는 카드·아이돌', skillAdviceName(meta.origin)]);
  else if (owners.length) rows.push(['얻는 P아이돌', owners.map(skillAdviceName).join(' / ')]);
  return rows.length ? `<dl class="skill-advice-meta">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : '';
}
function renderSkillAdviceDetail() {
  const section = $('skillAdviceDetail');
  if (!section) return;
  const row = skillAdvice.detail;
  if (!row) { section.innerHTML = `<p class="skill-advice-placeholder" role="status">${skillAdvice.selectedId ? '선택한 카드의 조건을 확인하고 있어요.' : '카드를 고르면 사용 흐름과 함께 쓸 조합을 보여드려요.'}</p>`; return; }
  const id = skillAdviceId(row), rating = skillAdviceRating(row), conditions = skillAdviceCurrentConditions(id), context = skillAdviceContext();
  const roleLabels = array(row.roles).map(role => typeof role === 'string' ? skillAdviceRoleLabels[role] || role : skillAdviceText(role));
  const effectSummary = Array.isArray(row.effectSummary) ? row.effectSummary : row.effectSummary ? [row.effectSummary] : row.description ? [row.description] : [];
  const eligibilityReasons = skillAdviceStrings(row.eligibility?.reasons), missing = skillAdviceStrings(row.missingConditions);
  section.innerHTML = `<div class="skill-advice-detail-inner">
    <div class="skill-advice-detail-heading">${visualFrame(assetUrl(row.imageUrl, row.thumbnailUrl), `${skillAdviceName(row)} 카드`, 'skill-advice-detail-art')}<div><span class="skill-advice-classification">${escapeHtml(skillAdviceSourceLabel(row))} · ${escapeHtml(plans[row.plan] || '플랜 확인')}</span><h3 id="skillAdviceDetailTitle" tabindex="-1">${skillAdviceNameMarkup(row)}</h3><div class="skill-advice-detail-badges">${skillAdviceBadge(row)}<span class="skill-advice-basis">${escapeHtml(skillAdviceBasis(row))}</span>${skillAdviceConditionBadge(row)}</div>${rating.gradeNote ? `<p class="skill-advice-potential">${escapeHtml(rating.gradeNote)}</p>` : ''}</div></div>
    <div class="skill-advice-eligibility status-${escapeHtml(row.eligibility?.status || 'unknown')}"><strong>${escapeHtml(skillAdviceEligibility(row))}</strong>${skillAdviceList(eligibilityReasons)}</div>
    <section class="skill-advice-section"><h4>이 카드를 넣은 덱은 시험에서 어떻게 쓰나요?</h4>${cardExamDeckMarkup(row, context, skillAdvice.options)}</section>
    ${roleLabels.length ? `<div class="skill-advice-role-tags">${roleLabels.map(label => `<span>${escapeHtml(label)}</span>`).join('')}</div>` : ''}
    ${effectSummary.length ? `<section class="skill-advice-section"><h4>카드의 효과</h4>${skillAdviceList(effectSummary)}</section>` : ''}
    <section class="skill-advice-section"><h4>왜 이 티어인가요?</h4>${skillAdviceList(row.reasons, '이 카드의 현재 조건별 평가 근거가 부족해요.')}</section>
    <section class="skill-advice-section"><h4>언제, 어떤 순서로 쓰나요?</h4>${skillAdviceList(row.usage, '확인된 사용 흐름이 아직 없어요.')}</section>
    <section class="skill-advice-section"><h4>함께 쓰는 카드와 대안</h4>${skillAdviceRelationsMarkup(row)}</section>
    <section class="skill-advice-section"><h4>강화·커스텀 우선순위</h4>${skillAdviceList(row.upgradeAdvice)}${skillAdviceList(row.customizationAdvice, '카드별 커스텀 조건을 확인해 주세요.')}<p class="skill-advice-muted">일반 강화는 1회 기준이에요. 시험 중 일시 강화와 별도로 비교합니다.</p></section>
    <section class="skill-advice-assumptions"><h4>내 카드의 조건 확인</h4>${missing.length ? skillAdviceList(missing) : '<p>아래 상태를 알고 있다면 선택해서 다시 비교할 수 있어요.</p>'}<div class="skill-advice-assumption-grid">
      ${skillAdviceAssumptionSelect('customizationState', '추천에 필요한 커스텀', conditions.customizationState, [['unknown', '미확인'], ['none', '없음'], ['matched', '위 필요 조건과 일치함']])}
      ${context.scenario === 'hif' ? skillAdviceAssumptionSelect('hifAbilityState', '대상 HIF 어빌리티', conditions.hifAbilityState, [['unknown', '미확인'], ['none', '없음'], ['matched', '위 대상·효과와 일치함']]) : ''}
      ${row.meta?.requiresSwitch ? skillAdviceAssumptionSelect('switchState', '이 카드의 스킬 스위치', conditions.switchState, [['unknown', '미확인'], ['enabled', '이 카드로 선택함'], ['disabled', '이 카드로 선택하지 않음']]) : ''}
      ${context.purpose === 'memory' ? skillAdviceAssumptionSelect('acquisitionTimingState', '메모리 합류 시점', conditions.acquisitionTimingState, [['unknown', '미확인'], ['opening', '개막 합류 확인'], ['mid', '중간 합류']]) : ''}
    </div><p class="skill-advice-muted">‘일치함’은 표시된 해당 카드의 커스텀·HIF 대상 효과 조건을 사용자가 대조해 확인했다는 입력이에요. 보유 목록에서 자동으로 확인한 상태와 구분합니다.</p></section>
    ${skillAdviceMetaMarkup(row)}
    <section class="skill-advice-section skill-advice-comparison"><h4>조건을 바꾸면 어떻게 달라지나요?</h4><div class="skill-advice-compare-buttons"><button type="button" data-skill-advice-compare="scenario">시나리오별</button><button type="button" data-skill-advice-compare="level">PLv별</button><button type="button" data-skill-advice-compare="upgrade">강화 전후</button></div><div id="skillAdviceComparisonResult" aria-live="polite"></div></section>
    <details class="skill-advice-sources"><summary>평가 근거와 원문 보기${array(row.evidence).length ? ` · ${row.evidence.length}건` : ''}</summary>${skillAdviceEvidenceMarkup(row)}</details>
  </div>`;
  renderSkillAdviceComparison();
}
async function selectSkillAdviceCard(id, openDetail = true) {
  const option = array(skillAdvice.options?.cards).find(row => skillAdviceId(row) === id || row.gameId === id);
  if (!option) return;
  skillAdvice.selectedId = skillAdviceId(option);
  skillAdvice.comparison = null; skillAdvice.compareRequest++;
  const cached = skillAdvice.rows.find(row => skillAdviceId(row) === skillAdvice.selectedId);
  skillAdvice.detail = !skillAdvice.pending && cached ? { ...option, ...cached } : null;
  renderSkillAdviceList(); renderSkillAdviceDetail();
  if (openDetail) {
    const dialog = $('skillAdviceDialog');
    if (dialog && !dialog.open) { skillAdvice.returnFocusId = skillAdvice.selectedId; dialog.showModal(); }
    if (dialog) dialog.scrollTop = 0;
  }
  const conditions = skillAdviceCurrentConditions();
  if (Object.values(conditions).some(value => value !== 'unknown') || !cached) await refreshSkillAdviceDetail();
}
async function refreshSkillAdviceDetail() {
  if (!skillAdvice.selectedId || skillAdvice.pending) return;
  const request = ++skillAdvice.detailRequest, contextVersion = skillAdvice.request, id = skillAdvice.selectedId;
  skillAdvice.detail = null; skillAdvice.comparison = null; skillAdvice.compareRequest++; renderSkillAdviceDetail();
  try {
    const data = await api('/api/skill-advice', { method: 'POST', body: JSON.stringify({ ...skillAdviceContext(), ...skillAdviceCurrentConditions(id), cardIds: [id] }) });
    if (request !== skillAdvice.detailRequest || contextVersion !== skillAdvice.request || id !== skillAdvice.selectedId) return;
    const row = array(data.cards)[0], option = array(skillAdvice.options.cards).find(card => skillAdviceId(card) === id);
    skillAdvice.detail = row ? { ...option, ...row } : { ...option, reasons: ['현재 조건의 평가 결과를 찾지 못했어요.'] };
    if (row) {
      const index = skillAdvice.rows.findIndex(card => skillAdviceId(card) === id);
      if (index >= 0) skillAdvice.rows[index] = skillAdvice.detail;
      else skillAdvice.rows.push(skillAdvice.detail);
      renderSkillAdviceList();
    }
    renderSkillAdviceDetail();
  } catch (error) {
    if (request !== skillAdvice.detailRequest || contextVersion !== skillAdvice.request || id !== skillAdvice.selectedId) return;
    $('skillAdviceDetail').innerHTML = `<div class="skill-advice-placeholder"><p>${escapeHtml(error.message)}</p><button type="button" class="button button-secondary" data-skill-advice-detail-retry>다시 확인</button></div>`;
  }
}
function skillAdviceComparisonInputs(kind) {
  const context = { ...skillAdviceContext(), ...skillAdviceCurrentConditions(), cardIds: [skillAdvice.selectedId] };
  if (kind === 'scenario') return [['hif', 'H.I.F.'], ['nia', 'N.I.A. MASTER'], ['hajime', '初 LEGEND']].map(([scenario, label]) => {
    const input = { ...context, scenario }; delete input.difficulty;
    if (scenario !== 'hif') input.difficulty = scenario === 'nia' ? 'master' : 'legend';
    if (scenario !== 'nia') input.strategy = 'general';
    if (scenario !== 'hajime') delete input.legendCardGameId;
    if (scenario !== context.scenario || input.difficulty !== context.difficulty) for (const key of ['customizationState', 'hifAbilityState', 'switchState', 'acquisitionTimingState']) input[key] = 'unknown';
    return { label, input };
  });
  if (kind === 'level') {
    const levels = [...new Set([1, 25, 50, 65, 75, 80, 90, context.producerLevel].filter(level => Number.isInteger(level) && level > 0))].sort((a, b) => a - b);
    return levels.map(producerLevel => ({ label: `PLv ${producerLevel}`, input: { ...context, producerLevel,
      ...(producerLevel !== context.producerLevel ? { customizationState: 'unknown', hifAbilityState: 'unknown', switchState: 'unknown', acquisitionTimingState: 'unknown' } : {}) } }));
  }
  return [0, 1].map(upgradeCount => ({ label: upgradeCount ? '강화 (+)' : '미강화', input: { ...context, upgradeCount,
    ...(upgradeCount !== context.upgradeCount ? { customizationState: 'unknown', hifAbilityState: 'unknown', switchState: 'unknown', acquisitionTimingState: 'unknown' } : {}) } }));
}
async function compareSkillAdvice(kind) {
  if (!skillAdvice.detail || skillAdvice.pending) return;
  const request = ++skillAdvice.compareRequest, id = skillAdvice.selectedId, contextVersion = skillAdvice.request;
  skillAdvice.comparison = { kind, pending: true }; renderSkillAdviceComparison();
  try {
    const rows = await Promise.all(skillAdviceComparisonInputs(kind).map(async ({ label, input }) => {
      const data = await api('/api/skill-advice', { method: 'POST', body: JSON.stringify(input) });
      return { label, row: array(data.cards)[0] };
    }));
    if (request !== skillAdvice.compareRequest || id !== skillAdvice.selectedId || contextVersion !== skillAdvice.request) return;
    skillAdvice.comparison = { kind, rows }; renderSkillAdviceComparison();
  } catch (error) {
    if (request !== skillAdvice.compareRequest || id !== skillAdvice.selectedId || contextVersion !== skillAdvice.request) return;
    skillAdvice.comparison = { kind, error: error.message }; renderSkillAdviceComparison();
  }
}
function renderSkillAdviceComparison() {
  const target = $('skillAdviceComparisonResult'); if (!target) return;
  const data = skillAdvice.comparison;
  $('skillAdviceDetail').querySelectorAll('[data-skill-advice-compare]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.skillAdviceCompare === data?.kind)));
  if (!data) { target.innerHTML = '<p class="skill-advice-muted">다른 조건에서도 같은 기준으로 추천 이유와 사용 가능 여부를 비교해요.</p>'; return; }
  if (data.pending) { target.innerHTML = '<p class="skill-advice-muted" role="status">조건별 추천도를 확인하고 있어요.</p>'; return; }
  if (data.error) { target.innerHTML = `<p class="skill-advice-error">${escapeHtml(data.error)}</p>`; return; }
  const title = { scenario: '시나리오별 비교', level: '프로듀서 레벨별 비교', upgrade: '강화 전후 비교' }[data.kind];
  target.innerHTML = `<div class="skill-advice-table-scroll"><table><caption>${title}</caption><thead><tr><th scope="col">조건</th><th scope="col">티어</th><th scope="col">사용 조건·이유</th></tr></thead><tbody>${array(data.rows).map(({ label, row }) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${skillAdviceBadge(row)}<small>${escapeHtml(skillAdviceBasis(row))}</small></td><td><strong>${escapeHtml(skillAdviceEligibility(row))}</strong><p>${escapeHtml(skillAdviceStrings(row?.eligibility?.reasons)[0] || skillAdviceStrings(row?.reasons)[0] || '미평가')}</p></td></tr>`).join('')}</tbody></table></div><p class="skill-advice-muted">시나리오 비교는 HIF·NIA MASTER·初 LEGEND 기준이에요. PLv 표에서는 같은 덱 유형·카드 사양을 유지합니다.</p>`;
}
async function requestSkillAdvice() {
  const form = $('skillAdviceForm'); if (!form || !form.reportValidity()) return;
  clearTimeout(skillAdvice.timer);
  const request = ++skillAdvice.request;
  skillAdvice.detailRequest++; skillAdvice.compareRequest++; skillAdvice.comparison = null;
  skillAdvice.pending = true; skillAdvice.detail = null;
  $('skillAdviceApply').disabled = true; $('skillAdviceApply').textContent = '조건 확인 중…';
  $('skillAdviceNotice').hidden = true; renderSkillAdviceList(); renderSkillAdviceDetail();
  try {
    const data = await api('/api/skill-advice', { method: 'POST', body: JSON.stringify(skillAdviceContext()) });
    if (request !== skillAdvice.request) return;
    skillAdvice.rows = array(data.cards); skillAdvice.pending = false;
    const warnings = skillAdviceStrings(data.warnings);
    $('skillAdviceNotice').textContent = warnings.join(' '); $('skillAdviceNotice').hidden = !warnings.length;
    renderSkillAdviceList();
    const preferred = array(skillAdvice.options?.cards).some(row => skillAdviceId(row) === skillAdvice.selectedId) ? skillAdvice.selectedId : skillAdviceFilteredRows()[0] ? skillAdviceId(skillAdviceFilteredRows()[0]) : '';
    if (preferred) await selectSkillAdviceCard(preferred, false); else renderSkillAdviceDetail();
  } catch (error) {
    if (request !== skillAdvice.request) return;
    skillAdvice.pending = false; skillAdvice.rows = [];
    $('skillAdviceNotice').textContent = error.message; $('skillAdviceNotice').hidden = false;
    renderSkillAdviceList();
    $('skillAdviceDetail').innerHTML = '<p class="skill-advice-placeholder">조건을 다시 확인한 뒤 ‘이 조건으로 보기’를 눌러 주세요.</p>';
  } finally {
    if (request === skillAdvice.request) { skillAdvice.pending = false; $('skillAdviceApply').disabled = false; $('skillAdviceApply').textContent = '이 조건으로 보기'; }
  }
}
function bindSkillAdviceEvents() {
  const content = $('skillAdviceContent');
  const dialog = $('skillAdviceDialog');
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    const buttons = [...$('skillAdviceList').querySelectorAll('[data-skill-advice-card]')];
    (buttons.find(button => button.dataset.skillAdviceCard === skillAdvice.returnFocusId) ||
      buttons.find(button => button.dataset.skillAdviceCard === skillAdvice.selectedId) || $('skillAdviceSearch')).focus();
    skillAdvice.returnFocusId = '';
  });
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  $('skillAdviceForm').addEventListener('submit', event => { event.preventDefault(); requestSkillAdvice(); });
  $('skillAdviceForm').addEventListener('change', event => {
    if (event.target.id === 'skillAdviceScenario') { skillAdviceDifficultyOptions(); skillAdviceIdolOptions(); }
    if (event.target.id === 'skillAdviceType') { skillAdviceIdolOptions(); skillAdviceLegendOptions(); }
    if (event.target.id === 'skillAdviceDifficulty') skillAdviceLegendOptions();
    skillAdvice.limit = skillAdvice.pageSize; clearTimeout(skillAdvice.timer); skillAdvice.timer = setTimeout(requestSkillAdvice, 180);
  });
  for (const id of ['skillAdviceSearch', 'skillAdvicePlanFilter', 'skillAdviceSourceFilter', 'skillAdviceRatingFilter', 'skillAdviceSort']) $(id).addEventListener(id === 'skillAdviceSearch' ? 'input' : 'change', () => { skillAdvice.limit = skillAdvice.pageSize; renderSkillAdviceList(); });
  $('skillAdviceMore').addEventListener('click', () => { skillAdvice.limit += skillAdvice.pageSize; renderSkillAdviceList(); });
  content.addEventListener('click', event => {
    if (event.target.closest('[data-skill-advice-close]')) { dialog.close(); return; }
    const card = event.target.closest('[data-skill-advice-card]');
    if (card) { selectSkillAdviceCard(card.dataset.skillAdviceCard); return; }
    const compare = event.target.closest('[data-skill-advice-compare]');
    if (compare) { compareSkillAdvice(compare.dataset.skillAdviceCompare); return; }
    if (event.target.closest('[data-skill-advice-detail-retry]')) refreshSkillAdviceDetail();
  });
  content.addEventListener('change', event => {
    const condition = event.target.closest('[data-skill-advice-condition]');
    if (!condition || !skillAdvice.selectedId) return;
    skillAdvice.conditions.set(skillAdviceConditionKey(), { ...skillAdviceCurrentConditions(), [condition.dataset.skillAdviceCondition]: condition.value });
    refreshSkillAdviceDetail();
  });
}
async function refreshSkillCatalogOptions() {
  if (skillAdvice.loading) await skillAdvice.loading;
  if (!skillAdvice.options) return;
  try {
    skillAdvice.options = await api('/api/skill-advice/options');
    skillAdviceIdolOptions();
    $('skillAdviceCoverage').textContent = `도감 ${array(skillAdvice.options.cards).length}종 · 공략 범위는 목록에 표시`;
    await requestSkillAdvice();
  } catch { /* Keep the loaded gallery while the local server reconnects. */ }
}
async function initSkillAdvice() {
  if (skillAdvice.options) { renderSkillAdviceList(); return; }
  if (skillAdvice.loading) return skillAdvice.loading;
  skillAdvice.loading = (async () => {
    try {
      const data = await api('/api/skill-advice/options');
      skillAdvice.options = data; $('skillAdviceContent').innerHTML = skillAdviceShell();
      const level = [number(ui.state?.inventory?.producerLevel), number($('producerLevelInput')?.value)].find(value => Number.isInteger(value) && value >= 1 && value <= 90) ?? null;
      $('skillAdviceLevel').value = level != null ? level : '';
      skillAdviceDifficultyOptions(); skillAdviceIdolOptions(); bindSkillAdviceEvents();
      const count = array(data.cards).length;
      $('skillAdviceCoverage').textContent = `도감 ${count}종 · 공략 범위는 목록에 표시`;
      await requestSkillAdvice();
    } catch (error) {
      skillAdvice.options = null;
      $('skillAdviceContent').innerHTML = `<div class="skill-advice-placeholder"><p>${escapeHtml(error.message)}</p><button type="button" class="button button-secondary" id="skillAdviceRetry">스킬 자료 다시 불러오기</button></div>`;
      $('skillAdviceRetry').addEventListener('click', initSkillAdvice);
    } finally { skillAdvice.loading = null; }
  })();
  return skillAdvice.loading;
}
