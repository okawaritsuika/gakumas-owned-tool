'use strict';

(() => {
  const panel = $('idolGoalPanel');
  const scopeSelect = $('idolGoalScope');
  const cache = new Map();
  const customizations = new Map();
  const characterRail = $('inventoryCharacterGrid');
  const updateCharacterArrows = PidolOutfits.bindInventoryRail(characterRail,
    $('inventoryCharacterPrev'), $('inventoryCharacterNext'));
  let version;
  let visibleById = new Map();

  function settingsScope() {
    const scenario = $('scenarioSelect').value;
    if (scenario === 'hajime') return 'hajime-' + $('hajimeDifficultySelect').value;
    if (scenario === 'nia') return 'nia-' + $('niaDifficultySelect').value;
    return 'hif';
  }

  function scopeLabel(scope) {
    return Array.from(scopeSelect.options).find(option => option.value === scope)?.textContent || scope;
  }

  function load(scope) {
    const nextVersion = JSON.stringify([snapshotVersion(), ui.state?.catalogVersion, ui.state?.inventory?.capturedAt]);
    if (version !== nextVersion) {
      cache.clear();
      customizations.clear();
      version = nextVersion;
    }
    const params = new URLSearchParams({scope});
    const plv = Number($('producerLevelInput').value);
    if (Number.isInteger(plv) && plv > 0) params.set('plv', String(plv));
    const eventMode = scope === settingsScope() && $('eventModeSelect').value;
    if (eventMode) params.set('eventModeId', eventMode);
    const choices = customizations.get(scope);
    if (choices?.size) params.set('appliedCustomizations', JSON.stringify(Object.fromEntries(choices)));
    const query = params.toString();
    if (cache.get(scope)?.query === query) return cache.get(scope);
    const entry = { query, rows: null, byId: new Map(), error: null };
    cache.set(scope, entry);
    api('/api/idol-goal-ranks?' + query).then(data => {
      entry.rows = data.rows;
      entry.byId = new Map(data.rows.map(row => [row.id, row]));
    }).catch(error => { entry.error = error.message; }).finally(() => {
      if (cache.get(scope) !== entry) return;
      if (ui.collection === 'idolCards' && scopeSelect.value === scope) renderInventory();
      if ($('recommendIdolDialog').open && settingsScope() === scope) renderCompactRecommendPicker();
    });
    return entry;
  }

  function rowFor(record, scope) {
    const entry = cache.get(scope);
    return entry?.byId.get(record.gameId) || entry?.byId.get(recordId(record));
  }

  function valueOf(row) {
    return Number.isInteger(row?.recommendation?.value) ? row.recommendation.value : -Infinity;
  }

  function compareScores(a,b) {
    if (a && Object.hasOwn(a,'routeRank') || b && Object.hasOwn(b,'routeRank')) {
      const ar=a?.routeRank ?? Infinity, br=b?.routeRank ?? Infinity;
      return ar===br ? 0 : ar-br;
    }
    return valueOf(b)-valueOf(a);
  }

  function customizationMarkup(row) {
    const result = row.recommendation;
    const options = array(result?.customizationOptions);
    if (!row.owned || !options.length) return '';
    const active = result.appliedCustomizationId || '';
    return '<details class="idol-custom-choice"' + (active ? ' open' : '') + '><summary>이번 육성의 개조</summary>' +
      '<label>실제로 선택한 개조<select data-idol-custom="' + escapeHtml(row.id) + '">' +
      '<option value="">육성 시작 · 개조 미적용</option>' + options.map(option =>
        '<option value="' + escapeHtml(option.id) + '"' + (option.id === active ? ' selected' : '') + '>' + escapeHtml(option.label) + '</option>').join('') +
      '</select></label></details>';
  }

  function compareRecords(a,b,sort,entry) {
    const on = sort === 'level' ? levelOf : sort === 'uncap' ? uncapOf : null;
    if (on) {
      const diff = (on(b) ?? -1) - (on(a) ?? -1);
      if (diff) return diff;
    }
    if (sort === 'score') {
      const diff = compareScores(entry.byId.get(a.gameId),entry.byId.get(b.gameId));
      if (diff) return diff;
    }
    return nameOf(a).localeCompare(nameOf(b),'ko') || recordId(a).localeCompare(recordId(b));
  }

  function refresh() {
    panel.hidden = ui.collection !== 'idolCards';
    if (panel.hidden) return;
    const scope = scopeSelect.value, entry = load(scope);
    const ownedOnly = $('idolGoalOwned').value === 'owned';
    const sort = $('sortSelect').value, plan = $('planFilter').value, rarity = $('rarityFilter').value;
    const query = normalized($('searchInput').value);
    const records = new Map(recordsOf('idolCards').map(record=>[record.gameId ?? recordId(record), record]));
    if (!ownedOnly) {
      const catalog = new Map(array(ui.idolVisualCatalog).map(card=>[card.gameId,card]));
      for (const row of entry.rows || []) {
        if (!records.has(row.id)) records.set(row.id, {...(catalog.get(row.id) || row),id:row.id,gameId:row.id,owned:false});
      }
    }
    const matching = [...records.values()].filter(card=>{
      if ((plan && planOf(card)!==plan) || (rarity && rarityOf(card)!==rarity)) return false;
      return !query || normalized([card.nameKo,card.name,card.nameJa,characterNameOf(card),characterJaOf(card),
        card.idolName,card.idolNameJa,skillOf(card),skillJaOf(card),...array(card.aliases)].join(' ')).includes(query);
    });
    const groups = groupIdols(matching);
    const current = groups.find(group=>group.id===ui.inventoryCharacterId) ?? groups[0];
    const changed = current && ui.inventoryCharacterId !== current.id;
    if (current) ui.inventoryCharacterId = current.id;
    ui.idolSort = sort;
    writeMarkup('inventoryCharacterGrid',groups.map(group=>characterTileMarkup(group,{selectedId:current.id,mode:'inventory'})).join(''),'inventoryCharactersMarkup');
    if (changed) characterRail.scrollLeft = 0;
    updateCharacterArrows();
    const cards = (current?.cards || []).sort((a,b)=>compareRecords(a,b,sort,entry));
    visibleById = new Map(cards.map(card=>[card.gameId ?? recordId(card),card]));
    const items = cards.map(record=>{
      const row = rowFor(record,scope);
      const unavailable = array(record.excludedScenarios).includes(scope.split('-')[0]) ? '이 시나리오 참가 불가'
        : entry.error ? '점수 불러오기 실패' : entry.rows ? '의상 점수 자료 미연결' : '점수 불러오는 중';
      return {record,row,mode:'inventory',unavailable,extraHtml:row ? customizationMarkup(row) : ''};
    });
    const key = JSON.stringify([scope,ownedOnly,query,plan,rarity,sort,current?.id]);
    PidolOutfits.renderInventory($('idolGoalList'), items, key);
    $('inventoryVariantHeading').textContent = current ? current.name+' · 의상 '+cards.length+'장' : '의상';
    $('inventoryOutfitControls').hidden = !cards.length;
    const missingCollection = ownedOnly && !records.size && categoryStatus('idolCards')!=='complete';
    const notice = entry.error || (!entry.rows ? '추천 점수를 불러오는 중입니다.' :
      missingCollection ? '보유 목록이 아직 수집되지 않았습니다.' : !cards.length ? '이 조건에 해당하는 의상이 없습니다.' : '');
    $('idolGoalCount').hidden = !notice;
    $('idolGoalCount').textContent = notice;
    $('retryInventoryScores').hidden = !entry.error;
  }

  function retry(scope) {
    cache.delete(scope);
    load(scope);
  }

  scopeSelect.value = settingsScope();
  for (const id of ['scenarioSelect', 'hajimeDifficultySelect', 'niaDifficultySelect', 'eventModeSelect', 'producerLevelInput']) {
    $(id).addEventListener('change', () => {
      if (id !== 'producerLevelInput') {
        scopeSelect.value = settingsScope();
        customizations.clear();
      }
      if (ui.collection === 'idolCards') renderInventory();
      if ($('recommendIdolDialog').open) renderCompactRecommendPicker();
    });
  }

  panel.addEventListener('change', event => {
    if (event.target === scopeSelect) customizations.clear();
    const id = event.target.dataset.idolCustom;
    if (id) {
      const scope = scopeSelect.value;
      const choices = customizations.get(scope) || new Map();
      if (event.target.value) choices.set(id, event.target.value);
      else choices.delete(id);
      customizations.set(scope, choices);
    }
    renderInventory();
  });
  characterRail.addEventListener('click', event=>{
    const button = event.target.closest('[data-inventory-character]');
    if (!button) return;
    ui.inventoryCharacterId = button.dataset.inventoryCharacter;
    refresh();
    characterRail.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
  });
  $('idolGoalList').addEventListener('click',event=>{
    const trigger = event.target.closest('[data-inventory-outfit]');
    const record = trigger && visibleById.get(trigger.dataset.inventoryOutfit);
    if (record) openDetail(record);
  });
  $('retryInventoryScores').addEventListener('click',()=>{retry(scopeSelect.value);refresh();});
  globalThis.idolEffectScores = { load, rowFor, valueOf, compareScores, scopeLabel, settingsScope, retry };
  globalThis.renderIdolGoalRanks = refresh;
  refresh();
})();
