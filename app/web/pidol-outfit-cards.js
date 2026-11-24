'use strict';

(() => {
  const galleries = new WeakMap();

  function outfitName(record) {
    const name = nameOf(record);
    return name.match(/^[\[【]([^\]】]+)[\]】]/u)?.[1] || name;
  }

  // Keep the API's complete wording in the disclosure. Short labels allow
  // both the trigger and its threshold to fit on a narrow comparison card.
  function compactCondition(condition) {
    return (condition || '')
      .replace('기간 이벤트 전용 효과 제외 · ', '')
      .replace('고유 사용 전 호조 4 이상 · 변환된 가벼운 발걸음 사용 후 아이템 1회 가정', '호조 4턴부터 사용 · 변환한 가벼운 발걸음 1회 가정')
      .replace('고유 사용 전 호조 8턴 이상 필요 · 시작 호조 8턴인 비교 상태 ⅓', '사용 전 호조 8턴 이상 · 시작 호조 8턴 비중 ⅓')
      .replace(/제외 후 직접 (.+) 증가 (\d+)회마다 재연 · 환산 카드는 실제 사용 시 득점/, '제외 후 직접 $1↑ $2회마다 재연 · 환산 시 득점')
      .replace('실제 선택한 고유 개조 반영 · 추가 효과는 남은 행동에 따라 달라집니다.', '선택한 개조 적용 · 남은 행동에 따라 변동')
      .replace('전반에는 버프 증가·득점 감소, 후반에는 득점 증가·버프 감소', '전반 버프↑ 득점↓ · 후반 득점↑ 버프↓')
      .replace('고유 스킬·아이템 효과를 함께 반영합니다.', '고유 스킬·아이템 적용')
      .replace(/(상태|필요)·/g, '$1 · ');
  }

  function evidenceMarkup(result, record) {
    if (!result) return '';
    const sources = (result.evidence?.sources || []).filter(source => /^https?:\/\//i.test(source.url));
    const notes = [result.stateLabel, result.condition, result.evidence?.reason];
    if (!result.evidence || result.value === null) notes.push(result.known);
    if (result.missing) notes.push(result.missing);
    const texts = notes.filter(Boolean).map(note => '<p>' + escapeHtml(note) + '</p>').join('');
    const links = sources.map(s => '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(s.name || s.url) + '</a>').join('');
    const japanese = japaneseNameOf(record);
    const translation = japanese ? '<small lang="ja">' + escapeHtml(japanese) + '</small>' : '';
    return '<details class="outfit-evidence"><summary>점수 근거</summary><div>' + texts + links + translation + '</div></details>';
  }

  function cardMarkup({record, row, mode, selected, extraHtml, unavailable}) {
    const result = row?.recommendation;
    const id = row?.id || record.gameId || recordId(record);
    const title = outfitName(record), scored = Number.isInteger(result?.value);
    const basis=result?.basis==='common' ? '공통 기준' : result?.hif?.peak ? '완성 덱 고점' : '시나리오 기준';
    const tags = scored ? [basis, result.estimated ? '추정' : ''].filter(Boolean) : [];
    if (result?.condition?.startsWith('기간 이벤트 전용 효과 제외')) tags.push('이벤트 효과 제외');
    const status = result ? '점수 보류' : (unavailable || '점수 확인 중');
    const badge = scored ? '<strong class="outfit-score" aria-label="추천 점수 ' + result.value + '점">' +
      result.value + '<span>점</span></strong>' : '<strong class="outfit-score outfit-unscored">' + escapeHtml(status) + '</strong>';
    const condition = scored ? compactCondition(result.condition) : result?.missing;
    const action = mode === 'picker' ? 'data-recommend-idol="' + escapeHtml(recordId(record)) +
      '" aria-pressed="' + Boolean(selected) + '"' : 'data-inventory-outfit="' + escapeHtml(id) + '"';
    const actionLabel = [title, scored ? result.value + '점' : status, ...tags, condition,
      mode === 'picker' ? '선택' : '상세 보기'].filter(Boolean).join(' · ');
    const art = visualFrame(assetUrl(record.imageUrl, record.catalog?.imageUrl, row?.thumbnailUrl, record.thumbnailUrl), '', 'outfit-art');
    const meta = [rarityOf(record), {sense:'센스',logic:'로직',anomaly:'어노말리',free:'공용'}[planOf(record)]].filter(Boolean).join(' · ');
    return '<article class="pidol-outfit-card' + (selected ? ' is-selected' : '') + '" data-score-id="' + escapeHtml(id) + '"' +
      (scored ? ' data-score-value="' + result.value + '"' : '') + '>' +
      '<button type="button" class="outfit-main" ' + action + ' aria-label="' + escapeHtml(actionLabel) + '">' +
      art + (selected ? '<span class="outfit-selected-mark">선택됨</span>' : '') +
      '<span class="outfit-copy"><span class="outfit-score-row">' + badge +
      '<small class="outfit-tags">' + escapeHtml(tags.join(' · ')) + '</small></span>' +
      '<strong class="outfit-title">' + escapeHtml(title) + '</strong>' +
      '<span class="outfit-condition">' + escapeHtml(condition || '') + '</span>' +
      '<small class="outfit-meta">' + escapeHtml(meta + (row?.owned === false ? ' · 미보유' : '')) + '</small></span></button>' +
      evidenceMarkup(result,record) + (extraHtml || '') + '</article>';
  }

  function columnsFor(grid) {
    const width = grid.clientWidth;
    if (window.matchMedia('(max-width: 600px)').matches || width < 400) return 1;
    if (width < 595) return 2;
    if (width < 738) return 3;
    return width < 1100 ? 4 : 5;
  }

  function showPage(grid, state) {
    state.columns = columnsFor(grid);
    const pages = Math.ceil(state.entries.length / state.columns);
    state.page = Math.max(0, Math.min(pages - 1, state.page));
    grid.style.setProperty('--outfit-columns', state.columns);
    const start = state.page * state.columns;
    writeCards(grid, state, state.entries.slice(start, start + state.columns));
    state.prev.disabled = state.page === 0;
    state.next.disabled = state.page + 1 >= pages;
    state.label.textContent = pages ? (state.page + 1) + ' / ' + pages : '0 / 0';
    state.label.setAttribute('aria-label', pages ? '전체 ' + pages + '페이지 중 ' + (state.page + 1) + '페이지' : '의상 없음');
  }

  function writeCards(grid, state, entries) {
    const cards = entries.map(cardMarkup).join('');
    if (state.markup !== cards || (cards && !grid.firstElementChild)) {
      const open = [...grid.querySelectorAll('.outfit-evidence[open]')].map(d => d.closest('article').dataset.scoreId);
      grid.innerHTML = cards;
      for (const detail of grid.querySelectorAll('.outfit-evidence')) {
        if (open.includes(detail.closest('article').dataset.scoreId)) detail.open = true;
      }
      state.markup = cards;
    }
  }

  function bindGallery(grid) {
    const control = name => document.querySelector('[data-outfit-' + name + '="' + CSS.escape(grid.id) + '"]');
    const state = {entries:[],page:0,columns:1,prev:control('prev'),label:control('page'),next:control('next')};
    galleries.set(grid,state);
    grid.classList.add('pidol-outfit-grid');
    function step(direction) {
      state.page += direction;
      showPage(grid,state);
    }
    state.prev.addEventListener('click', () => step(-1));
    state.next.addEventListener('click', () => step(1));
    grid.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight'].includes(event.key) || !event.target.closest('.outfit-main')) return;
      const current = [...grid.querySelectorAll('.outfit-main')].indexOf(event.target.closest('.outfit-main'));
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? -1 : 1);
      const buttons = grid.querySelectorAll('.outfit-main');
      buttons[Math.min(current,buttons.length-1)]?.focus({preventScroll:true});
    });
    let gesture, preventClick = false;
    grid.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || event.target.closest('details')) return;
      preventClick = false;
      gesture = {id:event.pointerId,x:event.clientX,y:event.clientY};
    });
    grid.addEventListener('pointermove', event => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) && !grid.hasPointerCapture(event.pointerId)) {
        grid.setPointerCapture(event.pointerId);
        preventClick = true;
      }
    });
    grid.addEventListener('pointerup', event => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const dx = event.clientX - gesture.x;
      if (preventClick && Math.abs(dx) >= 34) step(dx < 0 ? 1 : -1);
      gesture = null;
    });
    grid.addEventListener('pointercancel', () => {gesture = null; preventClick = false;});
    grid.addEventListener('click', event => {
      if (preventClick && event.detail > 0) {event.preventDefault(); event.stopImmediatePropagation();}
      preventClick = false;
    },true);
    grid.addEventListener('dragstart', event => event.preventDefault());
    new ResizeObserver(() => {
      if (!grid.clientWidth || state.columns === columnsFor(grid)) return;
      state.page = Math.floor(state.page * state.columns / columnsFor(grid));
      showPage(grid,state);
    }).observe(grid);
    return state;
  }

  function render(grid, entries, {key, revealId} = {}) {
    const state = galleries.get(grid) || bindGallery(grid);
    if (state.key !== key) state.page = 0;
    state.key = key;
    state.entries = entries;
    if (revealId) {
      const i = entries.findIndex(e => [e.row?.id,e.record.gameId,recordId(e.record)].includes(revealId));
      if (i >= 0) state.page = Math.floor(i / columnsFor(grid));
    }
    showPage(grid,state);
  }

  function bindInventoryRail(rail, prev, next) {
    const update = () => {
      prev.disabled = rail.scrollLeft <= 1;
      next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1;
    };
    const step = direction => {
      const card = rail.firstElementChild;
      if (!card) return;
      const width = card.getBoundingClientRect().width + parseFloat(getComputedStyle(rail).columnGap);
      const count = Math.max(1, Math.floor((rail.clientWidth + 12) / width));
      rail.scrollBy({left: direction * count * width,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    rail.addEventListener('scroll', update, {passive:true});
    new ResizeObserver(update).observe(rail);

    let drag = null, suppressClick = false;
    rail.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick = false;
      if (event.pointerType !== 'mouse' || rail.scrollWidth <= rail.clientWidth ||
          event.target === rail || event.target.closest('details')) return;
      drag = {id:event.pointerId, x:event.clientX, y:event.clientY, left:rail.scrollLeft, moved:false};
    });
    rail.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved) {
        if (Math.abs(dy) > 7 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
        if (Math.abs(dx) <= 7 || Math.abs(dx) <= Math.abs(dy)) return;
        drag.moved = true;
        suppressClick = true;
        rail.setPointerCapture(event.pointerId);
        rail.classList.add('is-dragging');
      }
      rail.scrollLeft = drag.left - dx;
      event.preventDefault();
    });
    const finish = event => {
      if (drag?.id !== event.pointerId) return;
      if (event.type === 'pointerleave' && drag.moved) return;
      drag = null;
      rail.classList.remove('is-dragging');
    };
    for (const type of ['pointerup','pointercancel','pointerleave','lostpointercapture']) rail.addEventListener(type, finish);
    rail.addEventListener('click', event => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    rail.addEventListener('dragstart', event => event.preventDefault());
    rail.addEventListener('wheel', event => {
      if (event.ctrlKey || event.deltaX || !event.deltaY) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail.clientWidth : 1;
      const left = rail.scrollLeft;
      rail.scrollLeft += event.deltaY * unit;
      if (rail.scrollLeft !== left) event.preventDefault();
    }, {passive:false});
    return update;
  }

  function renderInventory(grid, entries, key) {
    let state = galleries.get(grid);
    if (!state) {
      grid.classList.add('pidol-outfit-grid');
      state = {update:bindInventoryRail(grid, document.querySelector('[data-outfit-prev="idolGoalList"]'),
        document.querySelector('[data-outfit-next="idolGoalList"]'))};
      galleries.set(grid, state);
    }
    const left = state.key === key ? grid.scrollLeft : 0;
    writeCards(grid, state, entries);
    grid.scrollLeft = left;
    state.key = key;
    state.update();
  }

  globalThis.PidolOutfits = {render, renderInventory, bindInventoryRail};
})();
