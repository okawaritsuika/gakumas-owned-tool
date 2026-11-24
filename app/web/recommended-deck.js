'use strict';

const recommendedDeckChoices = new WeakMap();
const deckSections = [['core', '핵심 카드'], ['picks', '육성 중 우선 픽'], ['alternatives', '대체 카드']];

function recommendedDeckViewMarkup(deck, choice) {
  const view = deck.views[choice] ?? deck.views.pending;
  const order = view.order.map(escapeHtml).join(' <span aria-hidden="true">→</span> ');
  const groups = deckSections.filter(([id]) => view.groups[id]?.length).map(([id, title]) =>
    `<section class="deck-group" data-deck-group="${id}"><h4>${title}</h4><div class="deck-cards">
      ${view.groups[id].map(card => `<article class="deck-card" data-deck-card="${escapeHtml(card.gameId)}">
        <div class="deck-card-heading">
          ${memorySkillVisualMarkup(card, { size: 34, characterId: deck.characterId })}
          <span class="deck-card-timing">${escapeHtml(card.timing)}</span>
        </div>${card.source ? `<small class="deck-card-source">${escapeHtml(card.source)}</small>` : ''}
        <dl class="deck-card-guide">
          ${card.effect ? `<div><dt>효과</dt><dd>${escapeHtml(card.effect)}</dd></div>` : ''}
          ${card.use ? `<div><dt>사용</dt><dd>${escapeHtml(card.use)}</dd></div>` : ''}
        </dl>
        ${card.skipPick ? `<p class="deck-skip">${escapeHtml(card.skipPick)}</p>` : ''}
        ${card.badges?.length ? `<ul class="deck-card-badges">${card.badges.map(badge => `<li>
          <strong class="${badge.type.includes('필수')?'deck-required':badge.type.startsWith('개조')?'deck-customize':'deck-enhance'}">${escapeHtml([badge.type,badge.label].filter(Boolean).join(' · '))}</strong>
          <span>${escapeHtml(badge.detail)}</span></li>`).join('')}</ul>` : ''}
        ${card.hif ? `<p class="deck-card-hif">${escapeHtml(card.hif)}</p>` : ''}
      </article>`).join('')}
    </div></section>`).join('');
  return `<p class="deck-order"><strong>${escapeHtml(deck.stageLabel)}</strong> <span>${order}</span></p>
    ${view.reason ? `<p class="deck-reason">${escapeHtml(view.reason)}</p>` : ''}
    ${view.late ? `<p class="deck-late">${escapeHtml(view.late)}</p>` : ''}${groups}`;
}

function guideDeckBadges(card) {
  const {enhancement,customization,neededBy}=card;
  const deadline=neededBy?.label ? neededBy.label+' 전' : '';
  const badges=[];
  if((enhancement?.priority || enhancement?.kind==='required') && enhancement.availableWeeksBeforeDeadline?.length){
    badges.push({type:enhancement.kind==='required'?'강화 필수':'강화 우선',label:deadline,
      detail:(card.upgradeCount==null?'미강화라면 ':'')+enhancement.detail});
  }
  if(customization?.availableWeeksBeforeDeadline?.length && Number.isInteger(customization.nextPrice) && customization.nextEffect){
    const week=customization.availableWeeksBeforeDeadline[0];
    badges.push({type:customization.kind==='required'?'개조 필수':'개조 추천',label:customization.nextEffect,
      detail:[deadline,week+'일차 특별지도 선택 시',customization.nextPrice+'P',card.upgradeCount===1?'':'강화 후'].filter(Boolean).join(' · ')});
  }
  return badges;
}

function recommendedDeckMarkup(result) {
  const deck = result.recommendedDeck;
  if (!deck) {
    const guide=result.hifGuide?.deck;
    if (!guide) return '';
    const groups=Object.fromEntries(deckSections.map(([key])=>[key,array(guide.groups[key]).map(card=>({...card,
      timing:card.neededBy?.label,
      source:card.acquisition?.status==='if_offered'&&!card.skipPick?'보이면 우선':'',
      effect:card.reason,
      use:card.deckUse??card.timing,
      badges:guideDeckBadges(card),
    }))]));
    return '<section id="recommendedDeck" class="recommended-deck" tabindex="-1"><h3>추천 덱</h3>'+
      recommendedDeckViewMarkup({stageLabel:'사용 순서',views:{pending:{order:guide.order??[],groups}}},'pending')+'</section>';
  }
  const choice = recommendedDeckChoices.get(deck) ?? 'pending';
  const observation = deck.observation;
  return `<section id="recommendedDeck" class="recommended-deck" aria-labelledby="recommendedDeckTitle" tabindex="-1">
    <div class="deck-heading"><h3 id="recommendedDeckTitle">추천 덱</h3>
      ${observation ? `<label for="deckPickStatus">${escapeHtml(observation.label)}
        <select id="deckPickStatus">${observation.choices.map(option => `<option value="${escapeHtml(option.id)}"${choice === option.id ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>
      </label>` : ''}
    </div>
    <div class="deck-view" aria-live="polite">${recommendedDeckViewMarkup(deck, choice)}</div>
  </section>`;
}

document.addEventListener('change', event => {
  const target = event.target;
  if (target.id !== 'deckPickStatus') return;
  const deck = ui.recommendation?.recommendedDeck;
  if (!deck?.observation?.choices.some(row => row.id === target.value)) return;
  recommendedDeckChoices.set(deck, target.value);
  target.closest('.recommended-deck').querySelector('.deck-view').innerHTML = recommendedDeckViewMarkup(deck, target.value);
});
