const boostTargets = new Map([
  ['ProduceEffectType_SupportCardEventParameterAdditionValueUp', 'param_boost'],
  ['ProduceEffectType_SupportCardEventProducePointAdditionValueUp', 'pp_gain'],
  ['ProduceEffectType_SupportCardEventStaminaRecoverUp', 'hp_recovery'],
]);

export const isStoryRewardBoost = type => boostTargets.has(type);

function unlockedAbilities(card, level) {
  const latest = new Map();
  for (const ability of card.levelAbilities ?? []) {
    if (ability.level <= level && (!latest.has(ability.order) || latest.get(ability.order).level < ability.level))
      latest.set(ability.order, ability);
  }
  return latest.values();
}

function storyBoosts(abilities, plan) {
  const boosts = { param_boost: 0, pp_gain: 0, hp_recovery: 0 };
  for (const ability of abilities) {
    if (ability.scenarioEnum && !['ProduceType_Unknown', 'ProduceType_FirstStar'].includes(ability.scenarioEnum)) continue;
    if (ability.splitEnum && ability.splitEnum !== 'ProduceSplitType_Unknown') continue;
    if (ability.plan && ability.plan !== 'free' && ability.plan !== plan) continue;
    for (const effect of ability.effects ?? []) {
      const target = boostTargets.get(effect.type);
      if (!target || boosts[target] === null) continue;
      const fixed = Number.isFinite(effect.min) && effect.min === effect.max;
      const unconditionalStart = effect.triggerId === 'p_trigger-produce_start-no_description' &&
        effect.phase === 'ProducePhaseType_ProduceStart' && [0, 1000].includes(effect.ratePermil);
      boosts[target] = fixed && unconditionalStart ? Math.max(boosts[target], effect.min) : null;
    }
  }
  return boosts;
}

function fixedReward(card, event) {
  if (Number.isFinite(event.param_value)) return event.param_value;
  // The reviewed card list omits these amounts; the native story table
  // specifies them for these individual card IDs.
  if (event.param_value != null) return null;
  if (event.effect_type === 'hp_recovery' && ['s_card-3-0019', 's_card-3-0020'].includes(card.gameId)) return 7;
  if (event.effect_type === 'pp_gain') {
    if (/^s_card-1-00(?:0\d|1[012])$/.test(card.gameId)) return 10;
    if (card.gameId === 's_card-2-0014') return 25;
  }
  return null;
}

export function evaluateHajimeProSupportStories(card, level, { includeSupportEvents = true, plan, abilities } = {}) {
  const stats = { vocal: 0, dance: 0, visual: 0 }, resources = { pp: 0, stamina: 0 };
  const result = { stats, resources, status: 'disabled', unscoredEffects: 0, scoredEffects: 0, reasons: [] };
  if (!includeSupportEvents) return result;
  result.status = 'conditional_unlocked_story_rewards';
  const boosts = storyBoosts(abilities ?? unlockedAbilities(card, level), plan);
  for (const event of card.events ?? []) {
    const unlock = event.release === 'initial' ? 1 : Number(/^lv(\d+)$/.exec(event.release)?.[1]);
    if (!Number.isFinite(unlock) || !Number.isFinite(level)) { result.unscoredEffects++; continue; }
    if (level < unlock) continue;
    const kind = event.effect_type, amount = fixedReward(card, event);
    if (amount === null || !Number.isFinite(boosts[kind]) || (kind === 'param_boost' && !Object.hasOwn(stats, event.param_type))) {
      result.unscoredEffects++;
      continue;
    }
    const reward = Math.floor(amount * (1000 + boosts[kind]) / 1000);
    if (kind === 'param_boost') stats[event.param_type] += reward;
    else resources[kind === 'pp_gain' ? 'pp' : 'stamina'] += reward;
    result.scoredEffects++;
  }
  if (result.scoredEffects) result.reasons.push('레벨로 해금한 고정 보상 이벤트가 각각 한 번 발생한다고 가정했습니다.');
  if (result.unscoredEffects) result.reasons.push('획득 이후의 스킬·P아이템 효과나 수치가 확인되지 않은 이벤트 보상은 별도입니다.');
  return result;
}
