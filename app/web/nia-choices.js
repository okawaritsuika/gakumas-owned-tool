function niaNumberField(name, label, value) {
  return `<label>${escapeHtml(label)} <input type="number" min="0" step="1" data-nia-field="${name}" value="${escapeHtml(value ?? '')}"></label>`;
}

function niaAuditionInput(offer = {}) {
  const gates = offer.requirements ?? {};
  const condition = offer.otherConditionsMet;
  return `<fieldset data-nia-audition><legend>제시된 오디션</legend>
    <label>오디션 이름 <input data-nia-id placeholder="예: メロBang!" value="${escapeHtml(offer.id ?? '')}"></label>
    ${niaNumberField('fanVotes', '필요 팬 투표', gates.fanVotes)}
    ${niaNumberField('affection', '필요 친애도', gates.affection)}
    ${niaNumberField('runNumber', '최소 육성 회차', gates.runNumber)}
    <label><input type="checkbox" data-nia-gates ${offer.requirements ? 'checked' : ''}> 화면의 전체 입장 조건을 확인함</label>
    <label>기타 입장 조건 <select data-nia-other>
    ${[['','없음'],['true','충족'],['false','미달'],['unknown','미확인']].map(([value,label]) =>
      `<option value="${value}" ${value === (condition === null ? 'unknown' : String(condition ?? '')) ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <button type="button" class="button button-secondary" data-nia-remove>후보 지우기</button></fieldset>`;
}

function niaChoiceInputs(observation = {}, activity) {
  if (activity === 'business') {
    const rows = [['company','기업 이벤트 회장'],['municipal','지자체 이벤트 회장'],['commercial','상업 시설'],['resort','리조트 시설']];
    const rewards = [['card','일반 카드'],['drink','드링크'],['pp','P포인트'],['upgradedCard','강화 카드'],['stamina','체력 회복']];
    const priorities = [['','체력·P 비용 절약'],...rewards];
    return `<p>이번 주 게임에 열린 장소를 체크하세요. 일반 마스터는 공략의 기본 비용을 사용합니다. 프로·이벤트는 비용 0도 입력하세요. 이벤트는 실제 보상까지 체크하세요.</p>
      <label>우선할 보상 <select data-nia-priority>${priorities.map(([id,name]) =>
        `<option value="${id}" ${observation.priority === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
      ${rows.map(([id,label]) => {
        const offer = observation.venueOffers?.find(row => row.id === id);
        return `<fieldset data-nia-venue="${id}"><legend><label><input type="checkbox" data-nia-open ${offer ? 'checked' : ''}> ${label}</label></legend>
          ${niaNumberField('staminaCost','체력 비용',offer?.staminaCost)} ${niaNumberField('ppCost','P 비용',offer?.ppCost)}
          <details ${Array.isArray(offer?.rewardTypes) ? 'open' : ''}><summary>화면에서 확인한 보상</summary>
          ${rewards.map(([type,title]) => `<label><input type="checkbox" data-nia-reward="${type}" ${offer?.rewardTypes?.includes(type) ? 'checked' : ''}> ${title}</label>`).join('')}
          ${niaNumberField('ppReward','P 보상량',offer?.ppReward)}
          ${niaNumberField('staminaRecovery','체력 회복량',offer?.staminaRecovery)}</details></fieldset>`;
      }).join('')}`;
  }
  const offers = observation.auditionOffers?.length ? observation.auditionOffers : [{}];
  return `<p>게임에 제시된 후보를 선호 순서대로 입력하세요. 기본 조건이 확인되지 않은 후보는 화면의 입장 조건도 입력하세요.</p>
    <div data-nia-current>${niaNumberField('fanVotes','현재 팬 투표',observation.fanVotes)}
    ${niaNumberField('affection','현재 친애도',observation.affection)} ${niaNumberField('runNumber','현재 육성 회차',observation.runNumber)}</div>
    <div data-nia-offers>${offers.map(niaAuditionInput).join('')}</div><button type="button" class="button button-secondary" data-nia-add>후보 추가</button>`;
}

document.addEventListener('click', event => {
  if (event.target.closest('[data-nia-add]')) event.target.closest('[data-nia-add]').previousElementSibling.insertAdjacentHTML('beforeend', niaAuditionInput());
  if (event.target.closest('[data-nia-remove]')) event.target.closest('[data-nia-audition]').remove();
});

function niaFields(scope) {
  const values = {};
  for (const input of scope.querySelectorAll('[data-nia-field]')) {
    if (input.value !== '' || input.validity.badInput) values[input.dataset.niaField] = input.validity.valid ? input.valueAsNumber : null;
  }
  return values;
}

function readNiaChoiceInputs(scope, activity) {
  if (activity === 'business') {
    const opened = [...scope.querySelectorAll('[data-nia-venue]')].filter(row => row.querySelector('[data-nia-open]').checked);
    return {priority:scope.querySelector('[data-nia-priority]').value, venueOffers:opened.map(row => {
      const rewardTypes = [...row.querySelectorAll('[data-nia-reward]:checked')].map(input => input.dataset.niaReward);
      return {id:row.dataset.niaVenue, ...niaFields(row), ...(rewardTypes.length ? {rewardTypes} : {})};
    })};
  }
  const auditionOffers = [];
  for (const row of scope.querySelectorAll('[data-nia-audition]')) {
    const id = row.querySelector('[data-nia-id]').value.trim();
    if (!id) continue;
    const offer = {id};
    const gates = niaFields(row), complete = row.querySelector('[data-nia-gates]').checked;
    if (complete || Object.keys(gates).length) offer.requirements = gates;
    const other = row.querySelector('[data-nia-other]').value;
    if (other) offer.otherConditionsMet = other === 'unknown' ? null : other === 'true';
    if (Object.keys(gates).length && !complete && offer.otherConditionsMet !== false) offer.otherConditionsMet = null;
    auditionOffers.push(offer);
  }
  return {...niaFields(scope.querySelector('[data-nia-current]')), auditionOffers};
}

function niaChoiceResult(result) {
  if (!result) return '';
  const recommendation = result.recommendation;
  const choices = (result.choices ?? []).map(choice => {
    const details = [...choice.costText, ...choice.rewardText].join(' · ');
    return `<li>${escapeHtml(choice.label)} · ${choice.canChoose === true ? '선택 가능' : choice.canChoose === false ? '조건 미달' : '미확인'}
      ${details ? `<small>${escapeHtml(details)}</small>` : ''}</li>`;
  });
  return `${recommendation ? `<p><strong>추천 · ${escapeHtml(recommendation.label)}</strong></p>` : ''}
    <p>${escapeHtml(result.reason)}</p>${choices.length ? `<ul>${choices.join('')}</ul>` : ''}`;
}
