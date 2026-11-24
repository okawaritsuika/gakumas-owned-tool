function legendMidtermInputs(observation = {}) {
  const observed = observation ?? {};
  const idsText = ids => escapeHtml(Array.isArray(ids) ? ids.join('\n') : '');
  return `<fieldset><legend>하지메 LEGEND 중간시험</legend>
    <label>시험 결과 <select data-legend-passed>
      <option value="">미확인</option>
      <option value="yes"${observed.midtermPassed === true ? ' selected' : ''}>합격</option>
      <option value="no"${observed.midtermPassed === false ? ' selected' : ''}>불합격</option>
    </select></label>
    <label>실제로 제시된 레전드 카드 <textarea rows="3" data-legend-offers placeholder="카드 이름이나 게임 ID를 한 줄에 하나씩">${idsText(observed.offeredCardIds)}</textarea></label>
    <label>현재 덱의 카드 (선택) <textarea rows="2" data-legend-deck placeholder="카드 이름이나 게임 ID를 한 줄에 하나씩">${idsText(observed.deckCardIds)}</textarea></label>
  </fieldset>`;
}

function readLegendMidtermInputs(scope) {
  const catalog = typeof ui !== 'undefined' && Array.isArray(ui.skillVisualCatalog) ? ui.skillVisualCatalog : [];
  const readCards = selector => scope.querySelector(selector).value.split(/[\n,]/).map(text => text.trim()).filter(Boolean).map(text => {
    const matches = catalog.filter(card => [card.gameId, card.nameKo, card.nameJa, card.name].includes(text));
    const ids = [...new Set(matches.map(card => card.gameId))];
    return ids.length === 1 ? ids[0] : text;
  });
  const passed = scope.querySelector('[data-legend-passed]').value;
  return { midtermPassed: passed === '' ? null : passed === 'yes', offeredCardIds: readCards('[data-legend-offers]'),
    deckCardIds: readCards('[data-legend-deck]') };
}

function legendMidtermResult(result) {
  if (!result) return '';
  if (result.status === 'inactive') return `<p>${escapeHtml(result.reason)}</p>`;
  if (!result.recommended) return `<p>레전드 카드 선택 미확인 · ${escapeHtml(result.reason)}</p>`;
  const alternatives = (result.candidates ?? []).slice(1);
  return `<p>레전드 카드 추천 <strong>${escapeHtml(result.recommended.name)}</strong></p><p>${escapeHtml(result.reason)}</p>
    ${alternatives.length?`<details><summary>같이 제시된 카드와 비교</summary><ul>${alternatives.map(card=>`<li><strong>${escapeHtml(card.name)}</strong> · ${escapeHtml(card.reason)}</li>`).join('')}</ul></details>`:''}`;
}
