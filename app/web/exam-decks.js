'use strict';

function matchingExamDecks(guides, cardId, context, plan) {
  if (!cardId) return [];
  return array(guides).filter(guide => {
    const flow = guide.examFlow;
    if (!flow || guide.scenario !== context.scenario || guide.plan !== plan) return false;
    if (guide.difficulty && guide.difficulty !== context.difficulty) return false;
    if (guide.trainingType !== 'general' && guide.trainingType !== context.trainingType) return false;
    if (flow.strategy && context.strategy !== 'general' && flow.strategy !== context.strategy) return false;
    if (context.legendCardGameId && flow.legendCardIds?.length && !flow.legendCardIds.includes(context.legendCardGameId)) return false;
    return flow.steps.some(step => step.cardIds.includes(cardId)) || array(guide.memoryRecommendations).some(row => row.gameId === cardId);
  });
}

function examFlowMarkup(guide, cardId = '') {
  const flow = guide.examFlow;
  const carry = cardId && array(guide.memoryRecommendations).find(row => row.gameId === cardId);
  const steps = flow.steps.map(step => {
    const selected = cardId && step.cardIds.includes(cardId);
    return `<li${selected ? ' class="exam-selected-step"' : ''}><strong>${escapeHtml(step.label)}</strong>${selected ? '<small>이 카드를 쓰는 단계</small>' : ''}<p>${escapeHtml(step.body)}</p></li>`;
  }).join('');
  return `<div class="exam-deck-flow">
    ${carry ? `<p><b>이 카드의 반입 역할</b> ${escapeHtml(carry.purpose)}${array(carry.conditions).length ? ' · '+escapeHtml(carry.conditions.join(' / ')) : ''}</p>` : ''}
    <ol>${steps}</ol><p class="exam-deck-fallback"><strong>조건이 안 맞을 때</strong> ${escapeHtml(flow.fallback)}</p>
  </div>`;
}

function examSwitchNote(flow, context, cards) {
  const switches = array(flow.requiredSwitchIds).map(id => array(cards).find(card => card.gameId === id)).filter(Boolean);
  const locked = switches.filter(card => Number.isInteger(context.producerLevel) && context.producerLevel < card.unlock?.conversionProducerLevel);
  if (locked.length) {
    return `현재 PLv ${context.producerLevel}에서 준비할 수 있는 단계부터 보세요. 전체 순서에는 ${locked.map(card => card.nameKo + ' 스위치 PLv' + card.unlock.conversionProducerLevel).join(' · ')} 해금과 선택이 필요합니다.`;
  }
  if (switches.length) return '이 순서에 필요한 스위치 선택을 확인하세요. ' + switches.map(card => card.nameKo + ' PLv' + card.unlock.conversionProducerLevel).join(' · ');
  return '';
}

function cardExamDeckMarkup(card, context, options) {
  const plan = skillAdviceTypes[context.trainingType]?.plan;
  const rows = matchingExamDecks(options?.examDecks, card.gameId, context, plan);
  if (!rows.length) return '<p class="skill-advice-muted">현재 시나리오·덱 유형에서 이 카드를 사용한 시험 순서가 아직 기록되지 않았습니다.</p>';
  return rows.map(guide => {
    const note = examSwitchNote(guide.examFlow, context, options.cards);
    return `<article class="exam-card-example"><h5>${escapeHtml(guide.examFlow.goal)}</h5>
      ${note ? `<p><strong>${escapeHtml(note)}</strong></p>` : ''}
      ${guideList(guide.conditions, 'library-conditions')}${examFlowMarkup(guide, card.gameId)}
      ${guideSources(guide.sourceIds, options.examDeckSources)}</article>`;
  }).join('');
}
