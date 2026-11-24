import { chinaHifGuide } from './hif-china-guide-data.mjs';
import { liljaHifGuide } from './hif-lilja-guide-data.mjs';
import { hifGuideDrink } from './hif-guide-drinks.mjs';
import { buildHifGuideSupports } from './hif-guide-supports.mjs';
import { buildHifGuideItems } from './hif-guide-items.mjs';

const profiles = new Map([chinaHifGuide, liljaHifGuide].map(profile => [profile.idolId, profile]));
const examWeeks = { 'selection-1': 7, 'selection-2': 13, 'selection-3': 20, 'final-r1': 27, 'final-r2': 29 };
const examLabels = { 'selection-1': '선발 1', 'selection-2': '선발 2', 'selection-3': '선발 3', 'final-r1': '본선 R1', 'final-r2': '본선 R2' };
const track = {
  goodCondition: { name: '호조', effect: 'effect_group-visible-exam_parameter_buff-000' },
  motivation: { name: '의욕', effect: 'effect_group-visible-exam_card_play_aggressive-000' },
};
const channelLabels = {
  supply_gift: '사시이레', outing: '외출', consult: '상담 교환',
  class_acquire: '수업 카드 획득', class_change: '수업 셀렉트 체인지', interval: '본선 인터벌 교환',
};
const list = value => Array.isArray(value) ? value : [];
const idOf = row => row?.gameId ?? row?.id;
const unlocked = (minimum, level) => Number.isInteger(minimum) &&
  (minimum === 0 || Number.isInteger(level) && level >= minimum);
const rarityAtLeast = (rarity, minimum) => ['R', 'SR', 'SSR'].includes(rarity) &&
  ['R', 'SR', 'SSR'].indexOf(rarity) >= ['R', 'SR', 'SSR'].indexOf(minimum);
const examInfo = id => ({ id, label: examLabels[id], week: examWeeks[id] });
const nextExam = week => Object.keys(examWeeks).find(id => week <= examWeeks[id]);
const isClass = activity => activity.startsWith('class_');

function activityGuide(activity, week, data, cardTrack) {
  const earlyClass = isClass(activity) && list(data.class?.earlyWeeks).includes(week);
  const channel = earlyClass ? 'class_acquire' : isClass(activity) ? 'class_change' : activity;
  if (!channelLabels[channel]) return { activity, channel: null, cards: [], drinks: [] };
  const operation = channel === 'class_change' ? 'change' : 'acquire';
  const label = isClass(activity) ? channelLabels[channel] + ' · ' + cardTrack.name : channelLabels[channel];
  const condition = earlyClass ? '체력 5를 내는 ' + cardTrack.name + ' 카드 획득을 선택할 때'
    : channel === 'class_change' ? '체력 5를 내는 ' + cardTrack.name + ' 셀렉트 체인지에서 실제 교체할 카드가 있을 때'
    : channel === 'outing' ? '실제 외출 보상 선택지에서'
    : ['consult', 'interval'].includes(channel) ? '실제 진열과 표시 가격을 확인하고 교환할 수 있을 때'
    : '사시이레 보상에 제시될 때';
  return { activity, channel, label, operation, condition, cards: [], drinks: [] };
}

function channelVariants(variants, family, rarity, channel, data) {
  const prices = channel === 'consult' ? data.consult?.cardPrices : channel === 'interval' ? data.interval?.cardPrices : null;
  if (prices) return Object.keys(prices[rarity] ?? {}).filter(key => Number.isFinite(prices[rarity][key]) && variants.has(family + ':' + key)).map(Number);
  if (channel === 'class_acquire') return [0];
  // The actual upgrade state of an unobserved random reward is left open.
  return null;
}

function acquisitionAccess(card, level, catalog, switches, plan) {
  const rule = catalog.memoryEffectDetails?.tables?.ProducerLevelUnlocks?.[card.gameId];
  const minimum = rule?.level ?? card.unlockProducerLevel;
  const requiresSwitch = rule?.type === 'ProducerLevelUnlockType_ProduceCardConversion' || card.requiresSkillCardSwitch === true;
  const switchedToOther = list(catalog.skillAdvice?.switchPairs).some(pair => pair.beforeGameId === card.gameId &&
    unlocked(pair.unlockProducerLevel, level) && switches?.[pair.afterGameId] === true);
  return { minimum, requiresSwitch, eligible: card.sourceType === 'produce' && card.recommendationEligible !== false &&
    [plan, 'free'].includes(card.plan) && unlocked(minimum, level) && (!requiresSwitch || switches?.[card.gameId] === true) && !switchedToOther };
}

function matchesChannel(row, guide, cardTrack) {
  const { channel } = guide;
  return row.profile.channels.includes(channel) &&
    (!['class_acquire', 'class_change', 'outing'].includes(channel) ||
      row.card.effectGroupIds?.includes(cardTrack.effect) || row.profile.observedTrackChannels?.includes(channel));
}

function photo(card, character) {
  return { gameId: card.gameId, nameKo: (card.nameKo || card.name || card.nameJa)?.trim(),
    nameJa: card.nameJa, imageId: 'img_general_skillcard_' + card.gameId.slice(10), imageIdSystem: 'native_asset',
    publicId: card.internalId == null ? null : String(card.internalId),
    imageUrl: card.characterIconUrls?.[character] ?? card.thumbnailUrl ?? card.imageUrl ?? null, rarity: card.rarity };
}

function carriedCards(plan) {
  const rows = (phase, availableAfterWeek) => list(plan.memoryStages?.[phase]).filter(row => row.obtainable === true).map(row => ({
    ...row, kind: 'memory', phase, availableAfterWeek, verifiedUpgrade: Number.isInteger(row.upgradeCount),
  }));
  return [...rows('atStart', 0), ...rows('afterMid', examWeeks['selection-1'])];
}

function ownedSource(row, plan, carried) {
  const unique = list(plan.uniqueCards).find(card => card.gameId === row.gameId && card.identityVerified);
  if (unique && row.channels.includes('unique')) return { ...unique, kind: 'unique', availableAfterWeek: 0, verifiedUpgrade: unique.variantVerified };
  const initial = list(plan.initialDeck?.masterCards).find(card => card.gameId === row.gameId && card.variantVerified);
  if (initial && row.channels.includes('initial')) return { ...initial, kind: 'initial', availableAfterWeek: 0, verifiedUpgrade: true,
    checkAfterAutomaticRemoval: true };
  return carried.find(card => card.gameId === row.gameId);
}

function customizationFields(row, receipt, variants, specialTraining, catalog) {
  const custom = row.customization;
  if (!custom) return null;
  const data = catalog.produceResources?.hif?.cardCustomizations;
  const legal = data?.variants?.[row.gameId + ':1'];
  if (!legal?.ids.includes(custom.id) || !variants.has(row.gameId + ':1') || !Array.isArray(data.prices?.[custom.id])) return null;
  const exact = list(receipt?.customizes).find(record => record.id === custom.id);
  const slotsUsed = list(receipt?.customizes).reduce((used, record) =>
    record.exactCountKnown && Number.isInteger(record.customizeCount) ? used + record.customizeCount : NaN, 0);
  const prices = data.prices[custom.id];
  const count = !list(receipt?.customizes).every(record=>record.exactCountKnown && Number.isInteger(record.customizeCount))
    ? null : exact?.customizeCount ?? 0;
  return { ...custom, requiresUpgradeCount: 1, prices, maxPerCard: legal.max, carriedCount: receipt ? count : null,
    nextPrice: count !== null && slotsUsed < legal.max ? prices[count] ?? null : null,
    nextEffect:custom.steps?.[count] ?? custom.label, availableWeeksBeforeDeadline: specialTraining,
    canApplyOnlyAfterAcquisition: true };
}

function timedSources(row, days) {
  if (!row.access.eligible) return [];
  return days.flatMap(day => day.activities.flatMap(activity => {
    const offer = activity.cards.find(card => card.gameId === row.card.gameId);
    return offer ? [{ week: day.week, stage: day.stage, displayDay: day.displayDay, planned: activity.planned,
      activity: activity.activity, channel: activity.channel, label: activity.label,
      operation: activity.operation, condition: activity.condition, upgradeCounts: offer.upgradeCounts,
      meetsDeadline: day.week < examWeeks[row.profile.neededBy] }] : [];
  }));
}

function canOffer(row, day) {
  if (row.skipPick) return false;
  const source = row.source;
  if (source?.kind === 'initial' || source?.kind === 'unique') return false;
  if (source?.kind === 'memory' && (source.availableAfterWeek < examWeeks[row.profile.neededBy] ||
    source.availableAfterWeek < day.week || row.card.noDeckDuplication)) return false;
  const { fromExam, throughExam } = row.profile;
  return (!fromExam || examWeeks[day.exam.id] >= examWeeks[fromExam]) &&
    (!throughExam || examWeeks[day.exam.id] <= examWeeks[throughExam]);
}

function priorityFor(row, week, exam) {
  if (week === 1) return row.dayOnePriority ?? 100;
  const today = examWeeks[exam];
  const target = examWeeks[row.neededBy] ?? today;
  if (target === today) return 0;
  if (target < today) return 1;
  return 2;
}

function buildDays({ schedule, planned, cards, drinks, cardTrack, data, variants, itemPath }) {
  return schedule.map(native => {
    const { week, stage } = native;
    const displayDay = stage === 'final' ? Math.min(week - 20, 7) : week;
    const eventPhase = { 27: 'round_1', 28: 'interval', 29: 'round_2' }[week] ?? null;
    const day = { week, stage, displayDay, eventPhase, exam: examInfo(nextExam(week)) };
    const order = (a, b) => priorityFor(a.profile, week, day.exam.id) - priorityFor(b.profile, week, day.exam.id);
    const availableCards = cards.filter(row => row.access.eligible && canOffer(row, day)).sort(order);
    const availableDrinks = drinks.filter(row => (!row.profile.fromExam || examWeeks[day.exam.id] >= examWeeks[row.profile.fromExam]) &&
      (!row.profile.throughExam || examWeeks[day.exam.id] <= examWeeks[row.profile.throughExam])).sort(order);
    const chosen = planned.get(week);
    const activities = list(native.activities).map(activity => {
      const guide = activityGuide(activity, week, data, cardTrack);
      const { channel } = guide;
      for (const row of availableCards) {
        if (!matchesChannel(row, guide, cardTrack)) continue;
        const { card, profile } = row;
        if (week === 1 && channel === 'supply_gift' && !Number.isFinite(profile.dayOnePriority)) continue;
        const upgradeCounts = channelVariants(variants, card.gameId, card.rarity, channel, data);
        if (upgradeCounts?.length === 0) continue;
        const variant = upgradeCounts?.length === 1 ? variants.get(card.gameId + ':' + upgradeCounts[0]) ?? card : card;
        guide.cards.push({ ...photo(variant, row.character), upgradeCounts, unlockProducerLevel: row.access.minimum,
          role: profile.role, reason: profile.dayReason ?? profile.reason, timing: profile.timing, neededBy: examInfo(profile.neededBy), availability: 'if_offered' });
      }
      for (const { drink, profile } of availableDrinks) {
        if (!channel || !profile.channels.includes(channel)) continue;
        if (week === 1 && channel === 'supply_gift' && !Number.isFinite(profile.dayOnePriority)) continue;
        if (channel === 'supply_gift' && !rarityAtLeast(drink.rarity, data.gift?.drinkMinimumRarity ?? 'SR')) continue;
        guide.drinks.push({ ...drink, reason: profile.dayReason ?? profile.reason, timing: profile.timing,
          neededBy: examInfo(profile.neededBy), availability: 'if_offered' });
      }
      return { ...guide, planned: chosen === activity, availability: 'unobserved' };
    });
    const itemRewards = list(itemPath?.stages).filter(stage => stage.plannedActivationWeeks?.includes(week))
      .map(({ gameId, trigger, timingKo, useLimit, effects }) => ({ gameId, trigger, timingKo, useLimit, effects, availability: 'if_item_active' }));
    return { ...day, plannedActivity: chosen ?? null, activities, itemRewards };
  });
}

/** After-the-recommendation guide for the selected normal HIF route. */
export function buildHifGuide({ result, inventory = {}, catalog, options = {} }) {
  const plan = result.personalizedPlan;
  const score = result.scoreSummary;
  if (!plan || (score?.scenario ?? options.scenario) !== 'hif' || options.eventModeId ||
    result.eventContext?.mode || result.accountPlaybook?.scheduleContext?.selectedEventModeId ||
    (options.hifMode ?? 'normal') !== 'normal') return null;
  const level = plan.context.producerLevel.value;
  const guideOptions = { ...options, producerLevel: level };
  const input = { result, inventory, catalog, options: guideOptions };
  const supportGuide = buildHifGuideSupports(input);
  const itemPath = buildHifGuideItems(input);
  const profile = profiles.get(idOf(result.selectedIdol));
  const schedule = list(catalog.calculationModels?.['score/schedule']?.table?.hif?.[score?.difficulty ?? 'none']);
  if (!profile || !result.selectedIdol?.ownershipVerified || score?.plan !== profile.plan || !schedule.length) {
    return { version: 1, idolGameId: idOf(result.selectedIdol) ?? null, deck: null, days: [], itemPath,
      supports: supportGuide?.supports ?? [], deckManagement: supportGuide?.deckManagement ?? null };
  }
  const data = catalog.produceResources?.hif;
  if (!data) return null;
  const planned = new Map(list(result.accountPlaybook?.weekPlan ?? score.hifModel?.selections).map(row => [row.week, row.activity]));
  const variants = new Map(list(catalog.skillCards).map(card => [card.gameId + ':' + (card.upgradeCount ?? 0), card]));
  const switches = options.skillCardSwitchSettings ?? inventory.skillCardSwitchSettings;
  const character = result.selectedIdol.characterId;
  const carried = carriedCards(plan);
  const pinned = new Set([...list(options.desiredSkillIds),
    ...list(result.hifAbilityGuidance?.selectedMemories).filter(memory=>memory.eligible===true)
      .flatMap(memory=>list(memory.hifEffects).flatMap(effect=>list(effect.triggerCards).map(card=>card.gameId)))]);
  const cards = profile.cards.flatMap(row => {
    const source = ownedSource(row, plan, carried);
    const card = variants.get(row.gameId + ':0');
    if (!card) return [];
    const access = acquisitionAccess(card, level, catalog, switches, profile.plan);
    const skip = row.skipIfCarried;
    const skipPick = skip && !pinned.has(row.gameId) &&
      skip.gameIds.every(gameId=>carried.some(memory=>memory.gameId===gameId && memory.phase==='atStart'))
      ? skip.text : null;
    return source || access.eligible ? [{ card, profile: row, access, source, character, skipPick }] : [];
  });
  const drinks = profile.drinks.flatMap(row => {
    const drink = hifGuideDrink(row.gameId, catalog);
    return drink && [profile.plan, 'free'].includes(drink.plan) && unlocked(drink.unlockProducerLevel, level)
      ? [{ drink, profile: row }] : [];
  });
  const days = buildDays({ schedule, planned, cards, drinks, cardTrack: track[profile.keyword], data, variants, itemPath });
  const groups = { core: [], picks: [], alternatives: [] };
  for (const row of cards) {
    const { profile: target, card, source, skipPick } = row;
    const opportunities = timedSources(row, days);
    if (!source && !opportunities.length && !skipPick) continue;
    const deadline = examWeeks[target.neededBy];
    const availableByDeadline = !!source && source.availableAfterWeek < deadline;
    const variant = variants.get(card.gameId + ':' + source?.upgradeCount) ?? card;
    const firstPossibleWeek = source && (availableByDeadline || !opportunities.length) ? source.availableAfterWeek : opportunities[0]?.week;
    const preparation = (activity, sameDay = false) => days.filter(day => day.week < deadline &&
      (day.week > firstPossibleWeek || sameDay && opportunities.some(op=>op.week===day.week&&op.activity===activity)) &&
      day.activities.some(row => row.activity === activity)).map(day => day.week);
    const enhancement = target.enhancement && { ...target.enhancement,
      confirmedUpgradeCount: source?.verifiedUpgrade ? source.upgradeCount : null,
      availableWeeksBeforeDeadline: target.channels.includes('unique') || !unlocked(data.consult?.enhanceUnlockPLv, level) ||
        !variants.has(card.gameId + ':1') || source?.upgradeCount > 0 ? [] : preparation('consult', !source),
    };
    const specialTraining = Number.isInteger(level) && !['initial','unique'].includes(source?.kind)
      ? preparation('special_training').filter(week=>
        source?.verifiedUpgrade && source.upgradeCount===1 && source.availableAfterWeek<week ||
        enhancement?.availableWeeksBeforeDeadline.some(upgradeWeek=>upgradeWeek<week) ||
        opportunities.some(op=>op.week<week&&op.upgradeCounts?.includes(1)))
      : [];
    const group = skipPick ? 'alternatives' : target.group === 'picks' && availableByDeadline ? 'core' : target.group;
    groups[group].push({ ...photo(variant, character), roleKey: target.roleKey, role: target.role, reason: target.reason,
      timing: target.timing, deckUse:target.deckUse, skipPick, neededBy: examInfo(target.neededBy), availableByDeadline,
      upgradeCount: source?.verifiedUpgrade ? source.upgradeCount : null, unlockProducerLevel: row.access.minimum ?? null,
      acquisition: { status: availableByDeadline ? source.kind : skipPick ? 'covered_by_carry' : opportunities.length ? 'if_offered' : 'joins_after_deadline',
        source: source ? { kind: source.kind, phase: source.phase ?? null, memoryId: source.memoryId ?? null,
          availableAfterWeek: source.availableAfterWeek,
          firstExam: examInfo(source.availableAfterWeek === 0 ? 'selection-1' : 'selection-2'),
          checkAfterAutomaticRemoval: source.checkAfterAutomaticRemoval ?? false } : null,
        opportunities },
      enhancement: enhancement ?? null,
      customization: customizationFields(target, source, variants, specialTraining, catalog),
    });
  }
  const finisher = groups.core.find(row => row.roleKey === 'finisher');
  const order = profile.order ? [...profile.order.slice(0, -1), finisher
    ? `${finisher.nameKo}가 손에 있으면 마지막 유효 득점 턴에 사용`
    : '기운이 쌓인 후반에 보유한 기운 환산 카드로 득점'] : null;
  return { version: 1, idolGameId: profile.idolId, producerLevel: level,
    deck: { groups, order }, days, itemPath, supports: supportGuide?.supports ?? [],
    deckManagement: supportGuide?.deckManagement ?? null };
}
