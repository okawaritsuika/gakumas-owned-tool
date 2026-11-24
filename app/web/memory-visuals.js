(function () {
  'use strict';

  let catalogPromise = null, catalogEpoch = 0, fallbackCatalog = [], cachedIndex = null;
  const emptyRows = [];
  const rows = value => Array.isArray(value) ? value : emptyRows;
  const str = value => typeof value === 'string' ? value : '';
  const normalized = value => str(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
  const html = value => typeof escapeHtml === 'function' ? escapeHtml(value) : String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const localAsset = (...values) => values.find(value => typeof value === 'string' && value.startsWith('/assets/') && !value.includes('\\') && !/[\u0000-\u001f]/.test(value)) ?? '';
  const viewState = () => typeof ui !== 'undefined' && ui && typeof ui === 'object' ? ui : null;
  const memories = () => {
    const owned = typeof recordsOf === 'function' ? rows(recordsOf('memories')) : rows(viewState()?.state?.inventory?.memories);
    return owned.length ? owned : emptyRows;
  };
  const catalog = () => rows(viewState()?.skillVisualCatalog ?? fallbackCatalog);
  const skillOf = memory => memory?.modelEffects?.carriedSkill ?? memory?.effects?.carriedSkill ?? memory?.produceCard ?? memory?.skillCard ?? {};
  const gameIdOf = card => str(card?.gameId) || (typeof card?.id === 'string' && card.id.startsWith('p_card-') ? card.id : '');
  const upgradeOf = card => {
    for (const value of [card?.upgradeCount, card?.upgrade]) if (value !== null && value !== undefined && value !== '' && Number.isInteger(Number(value))) return Number(value);
    return null;
  };
  const familyOf = card => gameIdOf(card) || (card?.internalId != null ? 'public:' + card.internalId : '');
  const namesOf = card => [...new Set([card?.nameKo, card?.name, card?.nameJa, card?.skillNameKo, card?.skillNameJa].filter(value => typeof value === 'string' && value.trim()))];

  function indexFor() {
    const cards = catalog(), owned = memories();
    if (cachedIndex && cachedIndex.cards === cards && cachedIndex.owned === owned && cachedIndex.cardCount === cards.length && cachedIndex.ownedCount === owned.length) return cachedIndex;
    const index = { cards, owned, cardCount: cards.length, ownedCount: owned.length, byGameId: new Map(), byPublicId: new Map(), byAlias: new Map(), byMemoryId: new Map(), ownedByGameId: new Map(), aliases: new Set(), expression: null };
    const addAlias = (alias, card) => {
      const key = normalized(alias);
      if (!key) return;
      if (!index.byAlias.has(key)) index.byAlias.set(key, []);
      if (!index.byAlias.get(key).includes(card)) index.byAlias.get(key).push(card);
      index.aliases.add(key);
      const withoutPunctuation = key.replace(/[!。]+(?=\+?$)/u, '');
      if (withoutPunctuation && withoutPunctuation !== key && withoutPunctuation.length >= 2) {
        if (!index.byAlias.has(withoutPunctuation)) index.byAlias.set(withoutPunctuation, []);
        if (!index.byAlias.get(withoutPunctuation).includes(card)) index.byAlias.get(withoutPunctuation).push(card);
        index.aliases.add(withoutPunctuation);
      }
    };
    const addCard = card => {
      const gameId = gameIdOf(card);
      if (!gameId) return;
      if (!index.byGameId.has(gameId)) index.byGameId.set(gameId, []);
      index.byGameId.get(gameId).push(card);
      if (card.internalId != null) index.byPublicId.set(String(card.internalId), card);
      namesOf(card).forEach(alias => addAlias(alias, card));
    };
    cards.forEach(addCard);
    for (const memory of owned) {
      const skill = skillOf(memory), gameId = gameIdOf(skill);
      for (const id of [memory?.gameId, memory?.id]) if (id != null) index.byMemoryId.set(String(id), memory);
      if (!gameId) continue;
      if (!index.ownedByGameId.has(gameId)) index.ownedByGameId.set(gameId, []);
      index.ownedByGameId.get(gameId).push(memory);
      const upgrade = upgradeOf(skill), candidates = index.byGameId.get(gameId) ?? [];
      const matching = candidates.filter(card => upgrade === null || (upgradeOf(card) ?? 0) === upgrade);
      if (matching.length) {
        for (const card of matching) namesOf({ ...skill, skillNameKo: memory.skillNameKo, skillNameJa: memory.skillNameJa }).forEach(alias => addAlias(alias, card));
      } else addCard({ gameId, upgradeCount: upgrade, nameKo: skill.nameKo || memory.skillNameKo,
        name: skill.name || skill.nameJa || memory.skillNameJa, nameJa: skill.nameJa || memory.skillNameJa, skillImageUrl: memory.skillImageUrl });
    }
    cachedIndex = index;
    return index;
  }

  function hintedUpgrade(ref) {
    const explicit = upgradeOf(ref) ?? upgradeOf(skillOf(ref));
    if (explicit !== null) return explicit;
    const name = typeof ref === 'string' ? ref : [ref?.nameKo, ref?.name, ref?.nameJa].find(Boolean);
    return /\+$/u.test(normalized(name)) ? 1 : null;
  }
  function pickVariant(cards, ref) {
    const upgrade = hintedUpgrade(ref);
    if (upgrade !== null) return cards.find(card => (upgradeOf(card) ?? 0) === upgrade) ?? null;
    return cards.find(card => (upgradeOf(card) ?? 0) === 0) ?? cards[0] ?? null;
  }
  function resolve(ref, index) {
    const object = ref && typeof ref === 'object' ? ref : {}, raw = typeof ref === 'string' || typeof ref === 'number' ? String(ref) : '';
    const explicitMemoryId = object.memoryId ?? object.memory?.gameId ?? object.memory?.id;
    let memory = explicitMemoryId != null ? index.byMemoryId.get(String(explicitMemoryId)) : null;
    const directIds = [object.gameId, object.skillGameId, object.carriedSkillId, skillOf(object)?.id, object.id, raw].filter(value => value != null && value !== '');
    for (const id of directIds) {
      const matches = index.byGameId.get(String(id));
      if (matches) return { card: pickVariant(matches, ref), memory, ambiguous: false, exact: true };
    }
    for (const id of [object.internalId, object.publicId, /^\d+$/.test(String(object.id ?? '')) ? object.id : null, /^\d+$/.test(raw) ? raw : null]) {
      const card = id != null ? index.byPublicId.get(String(id)) : null;
      if (card) return { card, memory, ambiguous: false, exact: true };
    }
    memory = memory ?? directIds.map(id => index.byMemoryId.get(String(id))).find(Boolean);
    if (memory) {
      const skill = skillOf(memory), candidates = index.byGameId.get(gameIdOf(skill));
      return { card: pickVariant(candidates ?? [], { ...skill, ...object }), memory, ambiguous: false, exact: true };
    }
    const aliases = raw ? [raw] : namesOf(object);
    // A precise Japanese name can disambiguate a shared Korean name.
    const japanese = str(object.nameJa);
    if (japanese) aliases.unshift(japanese);
    let ambiguous = false;
    for (const alias of [...new Set(aliases)]) {
      const matches = index.byAlias.get(normalized(alias)) ?? [];
      const families = new Set(matches.map(familyOf));
      if (families.size === 1) return { card: pickVariant(matches, ref), memory: null, ambiguous: false, exact: false };
      if (families.size > 1) ambiguous = true;
    }
    return { card: null, memory: null, ambiguous, exact: false };
  }
  function selectedCharacterId() {
    if (typeof selectedVariant === 'function') return str(selectedVariant()?.characterId);
    return str(viewState()?.selectedCharacterId);
  }
  function imageFor(ref, match, index, options) {
    if (!match.card) return '';
    const object = ref && typeof ref === 'object' ? ref : {}, card = match.card, gameId = gameIdOf(card);
    const character = options.characterId ?? selectedCharacterId();
    const isMemory = Boolean(object.idolImageUrl || object.produceCard || object.modelEffects || object.effects?.carriedSkill);
    const exactMemoryImage = match.memory && gameIdOf(skillOf(match.memory)) === gameId ? match.memory.skillImageUrl : '';
    const owned = index.ownedByGameId.get(gameId) ?? [], upgrade = upgradeOf(card);
    const sameUpgrade = owned.filter(memory => upgrade === null || upgradeOf(skillOf(memory)) === upgrade);
    return localAsset(exactMemoryImage, object.skillImageUrl,
      character ? object.characterIconUrls?.[character] : '', character ? card.characterIconUrls?.[character] : '',
      isMemory ? '' : object.imageUrl, isMemory ? '' : object.thumbnailUrl,
      card.skillImageUrl, card.imageUrl, card.thumbnailUrl,
      ...sameUpgrade.map(memory => memory.skillImageUrl),
      ...(options.characterId !== undefined ? Object.values(card.characterIconUrls ?? {}) : owned.map(memory => memory.skillImageUrl)));
  }

  function memorySkillVisualMarkup(ref, options = {}) {
    const index = indexFor(), match = resolve(ref, index), card = match.card;
    const object = ref && typeof ref === 'object' ? ref : {}, raw = typeof ref === 'string' || typeof ref === 'number' ? String(ref) : '';
    const original = str(options.label) || raw || str(object.nameKo) || str(object.name) || str(object.nameJa) || str(object.gameId) || '이름 미확인 스킬';
    const primary = options.preserveLabel || options.label ? original : str(card?.nameKo) || str(object.nameKo) || str(card?.name) || str(object.name) || str(card?.nameJa) || original;
    const japanese = str(card?.nameJa) || str(object.nameJa), source = imageFor(ref, match, index, options);
    const size = Math.min(36, Math.max(16, Number.isFinite(Number(options.size)) ? Number(options.size) : 20));
    const reason = match.ambiguous ? '같은 이름의 스킬이 여럿입니다. 일본어명이나 정확한 ID가 필요합니다.' : '스킬 그림 미확인';
    const tooltip = options.tooltip === false ? '' : (japanese && japanese !== primary ? japanese : primary);
    const picture = source ? `<span class="memory-skill-icon"><img class="memory-skill-image" src="${html(source)}" alt="" loading="lazy" decoding="async"><span class="memory-skill-image-fallback" aria-hidden="true">?</span></span>` : `<span class="memory-skill-icon is-missing" role="img" aria-label="${html(reason)}" title="${html(reason)}"><span aria-hidden="true">?</span></span>`;
    return `<span class="memory-skill-visual${options.showName === false ? ' icon-only' : ''}${source ? '' : ' image-missing'}" style="--memory-skill-size:${size}px"${tooltip ? ` title="${html(tooltip)}"` : ''}${options.showName === false ? ' aria-hidden="true"' : ''}>${picture}${options.showName === false ? '' : `<span class="memory-skill-label">${html(primary)}${options.showJapanese && japanese && japanese !== primary ? `<span class="memory-skill-japanese" lang="ja">${html(japanese)}</span>` : ''}</span>`}</span>`;
  }

  const regexpEscape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function aliasPattern(value) {
    return [...value].map(char => /\s/u.test(char) ? '\\s+' : char === '+' ? '[+＋]' : char === '!' ? '[!！]' : char === '?' ? '[?？]' : regexpEscape(char)).join('');
  }
  function tokenBoundary(text, start, token) {
    const previous = text.slice(0, start).slice(-1), next = text.slice(start + token.length);
    if (/[가-힣]/u.test(token[0]) && /[가-힣A-Za-z0-9_]/u.test(previous)) return false;
    if (/[가-힣][+＋]?$/u.test(token) && /^[가-힣]/u.test(next)) {
      return /^(?:으로|에서|부터|까지|처럼|보다|에는|으로는|에게|은|는|이|가|을|를|와|과|의|도|만|로|랑|이나|나)(?=$|[\s.,!?。！？，、:;()[\]{}「」])/u.test(next);
    }
    return true;
  }
  function memoryRichTextMarkup(value, options = {}) {
    const text = String(value ?? ''), index = indexFor();
    if (!index.expression && index.aliases.size) index.expression = new RegExp([...index.aliases].sort((a, b) => b.length - a.length || a.localeCompare(b)).map(aliasPattern).join('|'), 'gu');
    if (!index.expression) return html(text);
    index.expression.lastIndex = 0;
    let output = '', offset = 0;
    for (const match of text.matchAll(index.expression)) {
      if (!tokenBoundary(text, match.index, match[0])) continue;
      output += html(text.slice(offset, match.index));
      output += memorySkillVisualMarkup(match[0], { ...options, size: options.size ?? 18, preserveLabel: true, label: match[0] });
      offset = match.index + match[0].length;
    }
    return output + html(text.slice(offset));
  }

  function loadMemorySkillVisualCatalog(options = {}) {
    const config = typeof options === 'function' ? { onReady: options } : options;
    if (!catalogPromise || config.retry === true) {
      const epoch = ++catalogEpoch;
      catalogPromise = (async () => {
        const response = await fetch('/api/catalog', { cache: 'no-store' });
        if (!response.ok) throw new Error('스킬 그림 자료를 불러오지 못했습니다.');
        const payload = await response.json(), cards = rows(payload.skillCards);
        if (epoch !== catalogEpoch) return fallbackCatalog;
        fallbackCatalog = cards;
        const state = viewState();
        if (state) {
          state.visualCatalogVersion = payload.catalogVersion;
          state.skillVisualCatalog = cards;
          state.skillVisualCatalogLoaded = true;
          state.supportVisualCatalog = rows(payload.supportCards);
          state.idolVisualCatalog = rows(payload.idolCards);
          state.catalogFreshness = payload.freshness ?? null;
          state.guideSupportProfiles = payload.guideSupportProfiles ?? null;
          state.drinkVisuals = payload.drinkVisuals ?? null;
          state.eventModes = payload.eventModes ?? null;
          state.excelSupportPresets = rows(payload.excelSupportPresets);
          state.hifScenarioItemPaths = rows(payload.hifScenarioItemPaths);
          state.scenarioRewardWeeks = payload.scenarioRewardWeeks;
        }
        cachedIndex = null;
        return cards;
      })().catch(error => {
        if (epoch === catalogEpoch) catalogPromise = null;
        throw error;
      });
    }
    return typeof config.onReady === 'function' ? catalogPromise.then(cards => { config.onReady(cards); return cards; }) : catalogPromise;
  }

  globalThis.memorySkillVisualMarkup = memorySkillVisualMarkup;
  globalThis.memoryRichTextMarkup = memoryRichTextMarkup;
  globalThis.loadMemorySkillVisualCatalog = loadMemorySkillVisualCatalog;
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('error', event => {
    const image = event.target;
    if (!image?.classList?.contains('memory-skill-image') || !image.parentElement) return;
    const frame = image.parentElement;
    frame.classList.add('is-missing');
    frame.setAttribute('role', 'img');
    frame.setAttribute('aria-label', '스킬 그림 미확인');
    frame.setAttribute('title', '스킬 그림 미확인');
    if (image.getAttribute('src')?.startsWith('/assets/live/')) image.hidden = true;
    else image.remove();
  }, true);
})();
