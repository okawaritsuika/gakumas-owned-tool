import { readHifIdolConcentration } from './hif-concentration-carry.mjs';

const CHINA = 'i_card-kcna-3-014';
const COURAGE = 'p_card-01-ido-3_150';
const CHORUS = 'p_card-01-act-2_001';
const SPOTLIGHT = 'p_card-01-men-2_011';
const THINKING = 'p_card-01-men-0_025';
const STEP = 'p_card-01-act-0_023';
const STAGING = 'p_card-01-act-0_022';
const FOCUS_CARDS = [THINKING, 'p_card-01-men-2_037', 'p_card-01-men-2_038',
  'p_card-01-men-1_024', 'p_card-01-men-1_008'];
const SPOTLIGHT_CUSTOM = 'p_card_custom-040_070-g_effect-parameter_buff_turn_add-1-g_effect-parameter_buff_turn_add-3';
const GOOD_CONDITION = 'effect_group-visible-exam_parameter_buff-000';
const list = value => Array.isArray(value) ? value : [];
const idOf = row => row?.gameId ?? row?.id;
const valueIn = (card, name) => Number(card?.actions?.match(new RegExp('(?:^|; )' + name + '\\+=(\\d+)'))?.[1] ?? 0);
const label = card => card?.nameKo?.trim() || card?.nameJa || card?.name;
const using = card => {
  const name = label(card), last = name.charCodeAt(name.length - 1);
  const final = last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 : 0;
  return name + (final && final !== 8 ? '으로' : '로');
};
const isClass = row => /^class(?:_|$)/.test(row.activity);
const dayLabel = days => days.join('·') + '일차';

function exactCustomEffect(card, effectType) {
  return list(card?.customizes).filter(row => row.exactCountKnown === true)
    .flatMap(row => list(row.growEffects)).filter(effect => !effect.unresolved && !effect.playProduceExamTriggerId &&
      !effect.playEffectProduceExamTriggerId && effect.effectType === 'ProduceCardGrowEffectType_' + effectType)
    .reduce((sum, effect) => sum + (effect.value ?? 0), 0);
}

function attachedHifEffect(effects, sourceAbilities, card) {
  for (const effect of effects) {
    if (effect.applies !== true || effect.duplicateOfMemoryId) continue;
    const native = sourceAbilities.find(row => row.abilityId === effect.abilityId && row.level === effect.abilityLevel &&
      row.effectId === effect.effectId);
    const trigger = native?.trigger;
    if (trigger?.timing !== 'after_card_use' || !trigger.startsAtEachExam || trigger.unlockAtTurn !== 1 ||
      !trigger.conditions?.length || !trigger.conditions.every(condition => condition.known === true) ||
      trigger.cardIds?.length !== 1 || trigger.cardIds[0] !== card.gameId ||
      (trigger.upgradeCounts?.length && !trigger.upgradeCounts.includes(card.upgradeCount))) continue;
    const limit = trigger.perExamActivationLimit > 0 ? ` (시험당 최대 ${trigger.perExamActivationLimit}회)` : '';
    return effect.effectSummary + limit;
  }
  return '';
}

function chinaHifDeck({ result, catalog, inventory, options }) {
  const plan = result.personalizedPlan;
  if (!plan || !result.selectedIdol?.ownershipVerified) return null;
  const chosen = catalog.idolCards?.find(row => idOf(row) === CHINA);
  const owned = inventory.idolCards?.find(row => idOf(row) === CHINA) ?? result.selectedIdol.owned;
  if (chosen?.uniqueIds?.produceCardId !== COURAGE || !owned) return null;
  const level = plan.context.producerLevel.value;
  const growth = readHifIdolConcentration(catalog, chosen, owned);
  const variants = new Map(list(catalog.skillCards).map(card => [idOf(card) + ':' + card.upgradeCount, card]));
  const variant = (id, upgrade = 0) => variants.get(id + ':' + upgrade);
  const ref = (row, provenance) => {
    const card = variant(row.gameId, row.upgradeCount);
    return card && { ...card, ...row, nameKo: label(card), imageUrl: row.imageUrl || card.characterIconUrls?.kcna ||
      card.thumbnailUrl || card.imageUrl, provenance };
  };
  const unique = plan.uniqueCards.find(row => row.gameId === COURAGE && row.identityVerified);
  const courage = unique && ref({ ...unique, upgradeCount: unique.variantVerified ? unique.upgradeCount : 0 }, '고유 카드');
  if (!courage) return null;
  const initial = plan.initialDeck.masterCards.filter(row => row.variantVerified).map(row => ref(row, '기본 덱')).filter(Boolean);
  const carries = (phase, provenance) => list(plan.memoryStages[phase])
    .filter(row => row.obtainable === true && Number.isInteger(row.upgradeCount)).map(row => ref(row, provenance)).filter(Boolean);
  const opening = [...carries('atStart', '개시 반입'), ...initial];
  const joined = carries('afterMid', '선발 1 뒤 반입');
  const openingCard = id => opening.find(row => row.gameId === id);
  const laterCard = id => joined.find(row => row.gameId === id);
  const weekPlan = list(result.accountPlaybook?.weekPlan);
  const schedule = list(catalog.calculationModels?.['score/schedule']?.table?.hif?.[plan.context.difficulty || 'none']);
  const exams = schedule.filter(row => row.stage === 'selection' && row.activities.some(a => a === 'final_exam' || a === 'mid_exam'));
  const first = exams[0]?.week, second = exams[1]?.week;
  const earlyClassDays = list(catalog.produceResources?.hif?.class?.earlyWeeks);
  const firstClasses = weekPlan.filter(row => row.week < first && isClass(row) && earlyClassDays.includes(row.week)).map(row => row.week);
  const secondClasses = weekPlan.filter(row => row.week > first && row.week < second && isClass(row)).map(row => row.week);
  const consult = catalog.produceResources?.hif?.consult;
  const upgradeDays = (after, before) => level != null && level >= consult?.enhanceUnlockPLv
    ? weekPlan.filter(row => row.week > after && row.week < before && row.activity === 'consult').map(row => row.week) : [];
  const access = id => {
    const card = variant(id), unlock = catalog.memoryEffectDetails?.tables?.ProducerLevelUnlocks?.[id];
    const minimum = unlock?.level ?? card?.unlockProducerLevel;
    const needsSwitch = unlock?.type === 'ProducerLevelUnlockType_ProduceCardConversion' || card?.requiresSkillCardSwitch;
    const switchOn = (options.skillCardSwitchSettings ?? inventory.skillCardSwitchSettings)?.[id] === true;
    return { minimum, eligible: card?.sourceType === 'produce' && card.recommendationEligible !== false &&
      card.effectGroupIds?.includes(GOOD_CONDITION) &&
      ['sense', 'free'].includes(card.plan) && level != null && minimum != null && level >= minimum && (!needsSwitch || switchOn) };
  };
  const chorusAccess = access(CHORUS);
  const preChorus = openingCard(CHORUS), postChorus = laterCard(CHORUS);
  // The standard card cannot share a deck with the same skill joining later.
  const offer = !preChorus && !postChorus && chorusAccess.eligible && firstClasses.length > 0;
  const initialUpgradeDays = upgradeDays(firstClasses[0], first);
  const acquireAt = days => dayLabel(days) + ' 수업의 호조 카드 획득(체력 5)에서 제시되면 고르세요.';
  const upgradeAt = days => dayLabel(days) + ' 상담에서 카드를 보유하고 강화 비용을 낼 수 있을 때 적용하세요.';
  const focusSource = (cards, needed) => FOCUS_CARDS.flatMap(id => cards.filter(card => card.gameId === id))
    .map(card => ({ card, gain: valueIn(card, 'concentration') + exactCustomEffect(card, 'LessonBuffAdd'),
      goodCost: card.costType === 'ExamCostType_ExamParameterBuff'
        ? Math.max(0, card.costValue - exactCustomEffect(card, 'CostParameterBuffReduce')) : 0 }))
    .find(row => row.gain >= needed && !row.card.conditions && (!row.goodCost || openingCard(STEP) || openingCard(SPOTLIGHT)));

  const views = {};
  function view(observation) {
    const groups = { core: [], picks: [], alternatives: [] }, shown = new Set();
    const add = (group, card, timing, effect, use, badges = [], extra = {}) => {
      if (!card || shown.has(card.gameId)) return;
      shown.add(card.gameId);
      groups[group].push({ gameId: card.gameId, upgradeCount: card.upgradeCount, nameKo: label(card),
        nameJa: card.nameJa, imageUrl: card.imageUrl ?? card.characterIconUrls?.kcna ?? card.thumbnailUrl,
        timing, effect, use, badges, ...extra });
    };
    const confirmed = ['base', 'plus'].includes(observation) && offer
      ? ref({ gameId: CHORUS, upgradeCount: Number(observation === 'plus') }, '획득 확인') : null;
    const chorus = preChorus || confirmed;
    const laterChorus = chorus || postChorus;
    const chorusCost = card => Math.max(0, card.costValue - exactCustomEffect(card, 'CostLessonBuffReduce'));
    const beforeCost = chorus ? chorusCost(chorus) : null;
    const supplier = beforeCost > 0 ? focusSource(opening, beforeCost) : null;
    const early = chorus && (beforeCost === 0 || supplier);
    const spotlight = openingCard(SPOTLIGHT), step = openingCard(STEP), staging = openingCard(STAGING);
    const fallback = spotlight || step;
    const lateItem = growth.late?.turns === 3 ? growth.late : null;
    const lateText = lateItem ? `마지막 3턴의 턴 시작마다 고유 P아이템으로 남은 호조의 ${lateItem.permil / 10}%만큼 집중을 얻어요.` : '';
    const mainUse = '호조를 모은 마지막 득점 턴.'+(unique.variantVerified && unique.upgradeCount===0?' 체력 3 필요.':'');
    const customBadge = (card, from, useBefore) => {
      if (card.upgradeCount !== 1 || !card.provenance) return [];
      const data = catalog.produceResources?.hif?.cardCustomizations;
      const custom = data?.variants?.[SPOTLIGHT + ':1'];
      if (!custom?.ids.includes(SPOTLIGHT_CUSTOM) || !data.prices[SPOTLIGHT_CUSTOM]) return [];
      const effects = catalog.memoryEffectDetails?.tables;
      const values = [1, 2].map(count => list(effects?.ProduceCardCustomize?.[SPOTLIGHT_CUSTOM + ':' + count]?.produceCardGrowEffectIds)
        .map(id => effects.ProduceCardGrowEffect?.[id]).find(row => row?.effectType === 'ProduceCardGrowEffectType_ParameterBuffTurnAdd')?.value);
      if (values.some(value => !Number.isInteger(value))) return [];
      const existing = list(card.customizes).find(row => row.id === SPOTLIGHT_CUSTOM);
      if (existing && !existing.exactCountKnown) return [];
      const used = list(card.customizes).reduce((sum, row) => sum + row.customizeCount, 0);
      if (!Number.isInteger(used)) return [];
      const count = existing?.customizeCount ?? 0;
      if (count === 2) return [{ type: '개조 완료', detail: `호조 지속 +${values[1]}턴 · 2회 반입 완료` }];
      if (!Number.isInteger(level)) return [];
      const days = weekPlan.filter(row => row.week > from && row.week < useBefore &&
        [row,...list(row.alternatives)].some(day=>day.activity==='special_training')).map(row => row.week);
      // Before the first exam, the sole guidance slot is day 1 and can only
      // modify an already carried card. Later visits include days 12 and 19.
      if (!days.length || used >= custom.max) return [];
      const next = count + 1, cost = data.prices[SPOTLIGHT_CUSTOM][count];
      if (!Number.isInteger(cost)) return [];
      return [{ type: '개조 추천', label:`호조 지속 +${values[count]}턴`, detail: `${dayLabel(days)} 특별지도 선택 시 · ${cost}P (${next}회차)` }];
    };
    const spotlightNote = card => {
      const gain = valueIn(card, 'goodConditionTurns') + exactCustomEffect(card, 'ParameterBuffTurnAdd');
      return `호조 +${gain}턴. 다음 턴 2장, 그다음 턴 1장 추가로 뽑아요.`;
    };
    const spotlightBadges = (card,from,deadline) => {
      const upgrades=upgradeDays(from,deadline);
      return card.upgradeCount===0 && upgrades.length ? [{type:'강화 우선',label:from?'선발 2 전':'선발 1 전',
        detail:'호조 +5 → +6턴. '+upgradeAt(upgrades)}] : customBadge(card,from,deadline);
    };
    add('core', courage, '마무리', '남은 호조에 비례해 득점하고 호조를 모두 써요.', mainUse, [], { source: courage.provenance });
    let order, reason = '';
    if (early) {
      const start = supplier ? `${using(supplier.card)} 집중 ${supplier.gain} 확보` : label(chorus) + ' 비용 0';
      order = [start, label(chorus), label(courage)];
      if (supplier) add('core', supplier.card, '선발 1 초반', `집중 +${supplier.gain}.`,
        `${supplier.goodCost ? '호조 ' + supplier.goodCost + '턴을 모은 뒤, ' : ''}슈프레히콜 직전.`,
        [], { source: supplier.card.provenance });
      if (step && !spotlight && supplier) add('alternatives', step, '선발 1 · 초반 집중이 부족할 때',
        '호조 +2턴.', '집중이 모자라 슈프레히콜을 쓸 수 없는 초반.',
        [], { source: step.provenance });
    } else {
      order = fallback ? [`${using(fallback)} 호조`, ...(spotlight ? ['추가 드로우'] : staging ? [label(staging)] : []),
        ...(chorus && lateItem ? [`후반 ${label(chorus)}`] : []), label(courage)] : [`호조 확보 후 ${label(courage)}`];
      if (fallback) add('alternatives', fallback, '선발 1 초반',
        spotlight ? spotlightNote(spotlight) : '집중을 쓰지 않고 호조 +2턴.',
        '첫 시험 초반, 슈프레히콜을 쓰기 어려울 때.',
        spotlight ? spotlightBadges(spotlight,0,first) : [], { source: fallback.provenance });
      if (staging && !spotlight) add('alternatives', staging, '선발 1 중간 득점',
        '이 공격에 호조 효과 2배.', '호조 2턴 이상에서 고유 카드로 마무리하기 전.', [], { source: staging.provenance });
      reason = postChorus ? `${label(postChorus)}는 선발 1이 끝난 뒤에 합류해요.` :
        !chorus && Number.isInteger(chorusAccess.minimum) && level != null && level < chorusAccess.minimum ? `슈프레히콜 일반 획득은 PLv ${chorusAccess.minimum}부터예요.` :
        !chorus && observation === 'missed' ? '선발 1 전 슈프레히콜 미획득.' :
        !chorus && !offer ? '첫 선발 전 슈프레히콜을 확보할 경로가 확인되지 않았어요.' :
        chorus && !lateItem ? `선발 1에서 필요한 집중 ${beforeCost}을 마련할 경로가 확인되지 않았어요.` : '';
    }
    if (laterChorus) {
      const card = laterChorus, cost = chorusCost(card), timing = early ? '선발 1 · 집중 확보 직후' :
        postChorus && !chorus ? '선발 2부터 · 집중을 모은 뒤' : '선발 1 · 마지막 3턴';
      const laterSupplier = !chorus && cost > 0 ? focusSource([...opening, ...joined], cost) : null;
      const useLate = !early && !laterSupplier && lateItem;
      const badges = [];
      const baseCost = variant(CHORUS)?.costValue;
      const reduced = exactCustomEffect(card, 'CostLessonBuffReduce');
      if (early && supplier && card.upgradeCount > 0 && !focusSource(opening, baseCost-reduced))
        badges.push({ type: '강화 필수', label:'선발 1 초반', detail: `확보 완료 · 집중 ${supplier.gain}으로 바로 쓰는 조건` });
      if (reduced > 0) badges.push({ type: early && supplier && !focusSource(opening, card.costValue) ? '개조 필수' : '개조 완료', label:'집중 비용 감소',
        detail: `집중 비용 -${reduced} · 반입 완료` });
      const enhancement = preChorus ? upgradeDays(0, first) : postChorus ? upgradeDays(first, second) : initialUpgradeDays;
      if (card.upgradeCount === 0 && enhancement.length) badges.push({ type: '강화 우선', label:postChorus?'선발 2 전':'선발 1 전',
        detail: `집중 비용 3 → 2, 호조 +2 → +3턴. ${preChorus ? '' : '먼저 카드를 얻었다면 '}${upgradeAt(enhancement)}` });
      if (early || useLate || laterSupplier || cost === 0) add('core', card, timing,
        `호조 +${valueIn(card, 'goodConditionTurns')}턴과 추가 행동 1회.`,
        `${laterSupplier ? using(laterSupplier.card) + ' 집중을 확보한 뒤, ' : ''}${useLate ? '고유 P아이템 발동 뒤 ' : ''}집중 ${cost} 이상.`, badges,
        { source: card.provenance });
    } else if (offer && observation === 'pending') {
      add('picks', variant(CHORUS), '선발 1 전', '호조 +2턴과 추가 행동 1회.',
        '집중 3 이상에서 사용. '+acquireAt(firstClasses),
        initialUpgradeDays.length ? [{ type: '강화 우선', label:'선발 1 전', detail: `집중 비용 3 → 2. ${dayLabel(firstClasses.filter(day => day < initialUpgradeDays.at(-1)))} 수업에서 얻었다면 ${upgradeAt(initialUpgradeDays)}` }] : []);
    }
    const laterSpotlight = spotlight || laterCard(SPOTLIGHT);
    if (laterSpotlight) {
      const atStart = Boolean(spotlight), from = atStart ? 0 : first;
      const useBefore = atStart ? first : second;
      const badges = spotlightBadges(laterSpotlight,from,useBefore);
      const when = atStart && early && supplier ? `초반 집중이 부족하면 호조를 먼저 쌓고, ${lateItem ? '마지막 3턴에 집중 ' + beforeCost + ' 이상에서 ' : '집중이 모이면 '}${label(chorus)}로 이어가세요. ` : '';
      add('core', laterSpotlight, atStart ? '득점 턴 전에' : '선발 2부터', spotlightNote(laterSpotlight),
        when || '추가 드로우를 받을 수 있게 득점 턴보다 먼저.', badges, { source: laterSpotlight.provenance });
    } else if (access(SPOTLIGHT).eligible && secondClasses.length && catalog.produceResources?.hif?.class?.lateChangeCards > 0) {
      const upgrades = upgradeDays(secondClasses[0], second);
      add('picks', variant(SPOTLIGHT), '선발 2 전', spotlightNote(variant(SPOTLIGHT)),
        dayLabel(secondClasses) + ' 수업에서 제시되면 교체. 득점 턴보다 먼저 사용.',
        upgrades.length ? [{ type: '강화 우선', label:'선발 2 전', detail: '호조 +5 → +6턴. ' + upgradeAt(upgrades) }] : []);
    }

    // An HIF effect is credited on a card only in a window where this plan
    // actually plays an exact trigger card. A carried skill and its ability
    // can have different timings.
    const firstPlayable = new Set([COURAGE, ...(early || chorus && lateItem ? [CHORUS] : []),
      ...(supplier ? [supplier.card.gameId] : []), ...(spotlight ? [SPOTLIGHT] : []),
      ...(!spotlight && fallback ? [fallback.gameId, staging?.gameId] : [])]);
    const hifEffects = list(result.hifAbilityGuidance?.selectedMemories)
      .filter(memory => memory.eligible === true).flatMap(memory => list(memory.hifEffects));
    for (const card of [...groups.core, ...groups.alternatives]) {
      const knownVariant = card.gameId !== COURAGE || unique.variantVerified;
      const effect = knownVariant && attachedHifEffect(hifEffects, list(catalog.hifAbilityGuidance?.abilities), card);
      if (effect) card.hif = `${firstPlayable.has(card.gameId) ? '선발 1부터' : '선발 2부터'} · H.I.F. 이 카드 사용 후 ${effect}`;
    }
    return { order, reason, late: lateText, groups };
  }
  for (const id of offer ? ['pending', 'missed', 'base', 'plus'] : ['pending']) views[id] = view(id);
  const dateLinks = Object.fromEntries([
    [first, '선발 1 카드 사용 순서'],
    ...(offer ? firstClasses.map(day => [day, '슈프레히콜 획득 준비']) : []),
    ...(!openingCard(SPOTLIGHT) && !laterCard(SPOTLIGHT) && access(SPOTLIGHT).eligible
      ? secondClasses.map(day => [day, '스포트라이트 교체 준비']) : []),
  ]);
  return { characterId: 'kcna', stageLabel: '선발 1', views, dateLinks, observation: offer ? {
    label: '선발 1 전 슈프레히콜', choices: [
      { id: 'pending', label: '아직 확인 전' }, { id: 'missed', label: '후보에 나오지 않음' },
      { id: 'base', label: '슈프레히콜 획득' }, { id: 'plus', label: '슈프레히콜+ 확보' },
    ],
  } : null };
}

const recipes = { hif: { [CHINA]: chinaHifDeck } };

export function buildRecommendedDeck({ result = {}, catalog = {}, inventory = {}, options = {} } = {}) {
  const scenario = result.scoreSummary?.scenario ?? options.scenario;
  const recipe = recipes[scenario]?.[idOf(result.selectedIdol)];
  if (!recipe || options.eventModeId || (options.hifMode ?? 'normal') !== 'normal' ||
      result.eventContext?.mode || result.scoreSummary?.plan !== 'sense') return null;
  return recipe({ result, catalog, inventory, options });
}
