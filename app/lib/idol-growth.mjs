const AXES = ['vo', 'da', 'vi'];
const ZERO = () => ({ vo: 0, da: 0, vi: 0 });
const rankValue = value => value === null || value === undefined || value === '' || typeof value === 'boolean'
  ? null : Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const vector = value => value && AXES.every(axis => rankValue(value[axis]) !== null)
  ? Object.fromEntries(AXES.map(axis => [axis, Number(value[axis])])) : null;
const add = (...values) => Object.fromEntries(AXES.map(axis => [axis, values.reduce((sum, item) => sum + (item?.[axis] ?? 0), 0)]));

/** Native ProduceType enum constants, read from the user's unchanged metadata.
 * SHA256 0951bf01ae553d59c426230b26d2f2b8baef10386ca3bd49f3d22b3123b29869
 * Type21054, fields93200..93202, default data offsets21980728..21980730.
 * IL2CPP31 compressed signed integer bytes02/04/06 decode to1/2/3.
 * These are enum identities, not fitted growth-rate constants.
 */
export const TRUE_END_PRODUCE_TYPES = Object.freeze({
  1: 'ProduceType_FirstStar',
  2: 'ProduceType_NextIdolAudition',
  3: 'ProduceType_HatsuboshiIdolFestival',
});
const enumName = value => Object.values(TRUE_END_PRODUCE_TYPES).includes(value)
  ? value : TRUE_END_PRODUCE_TYPES[rankValue(value)] ?? null;

/**
 * Pure calculation of card-list growth bonuses from observed account state.
 * card.characterBonuses is the matching p_idol_stats characterBonuses row.
 * owned.characterGrowth is the actual matching UserCharacter record.
 * Missing state returns current=null, keeping a separately labelled known sum.
 * Support/memory/produce-event bonuses are outside these persistent card stats.
 */
export function computeIdolGrowth(card, owned = {}) {
  const account = { ...(owned.raw ?? {}), ...owned };
  const base = vector(card?.baseStats?.growthRatePermil);
  const potentialRank = rankValue(account.potentialRank ?? account.awakeningRank ?? account.awakening);
  const character = account.characterGrowth ?? null;
  const characterBonuses = card?.characterBonuses ?? null;
  const issues = [];
  const issue = (code, message) => issues.push({ code, message });
  let awakening = null, trueEnd = null, awakeningSource = null;
  const appliedTrueEndBonuses = [];

  if (!base) issue('base_growth_unknown', '기본 성장률 자료를 확인하지 못했습니다.');
  if (potentialRank === null) issue('potential_rank_unknown', '보유 재능개화 단계를 확인하지 못했습니다.');
  else if (potentialRank === 0) {
    awakening = ZERO();
    awakeningSource = 'observed_rank_zero';
  } else {
    const stages = card?.awakeningStages ?? card?.potentialStages ?? [];
    const prefix = Array.from({ length: Math.min(potentialRank, 100) }, (_, index) =>
      stages.filter(stage => rankValue(stage.rank) === index + 1));
    const complete = potentialRank <= 100 && prefix.every(matches => matches.length === 1);
    const selected = complete ? prefix.at(-1)[0] : null;
    const cumulative = vector(selected?.cumulativeDeltaArithmetic?.growthRatePermil);
    const deltas = complete ? prefix.map(matches => vector(matches[0].growthRatePermilDelta)) : [];
    if (!selected) issue('potential_stage_unknown', '보유 개화 단계에 대응하는 연속 단계 자료가 없습니다.');
    else if (cumulative) {
      if (deltas.every(Boolean) && AXES.some(axis => add(...deltas)[axis] !== cumulative[axis])) {
        issue('potential_stage_conflict', '개화 누적값과 단계별 증가량이 일치하지 않습니다.');
      } else {
        awakening = cumulative;
        awakeningSource = 'exact_rank_cumulative_delta';
      }
    } else if (deltas.every(Boolean)) {
      awakening = add(...deltas);
      awakeningSource = 'sum_of_incremental_stage_deltas';
    } else issue('potential_growth_unknown', '개화 성장률 증가량을 확인하지 못했습니다.');
  }

  const observedTrueEnds = character?.trueEndProduceTypes;
  if (character && card?.characterId && character.characterId !== card.characterId) {
    issue('character_identity_mismatch', 'P아이돌과 캐릭터 성장 기록의 ID가 다릅니다.');
  } else if (!Array.isArray(observedTrueEnds)) {
    issue('true_end_state_unknown', '캐릭터의 True End 달성 목록을 확인하지 못했습니다.');
  } else if (observedTrueEnds.length === 0) {
    trueEnd = ZERO();
  } else if (!characterBonuses || (card?.characterId && characterBonuses.characterId !== card.characterId)) {
    issue('true_end_rules_unknown', '해당 캐릭터의 True End 보너스 자료가 없습니다.');
  } else {
    const requested = [...new Set(observedTrueEnds.map(enumName))];
    let valid = !requested.includes(null);
    if (!valid) issue('true_end_type_unknown', '확인되지 않은 True End 시나리오 코드가 있습니다.');
    for (const scenarioEnum of requested.filter(Boolean)) {
      const matches = (characterBonuses.trueEndBonuses ?? []).filter(row => row.scenarioEnum === scenarioEnum);
      const delta = matches.length === 1 ? vector(matches[0].growthRatePermilDelta) : null;
      if (!delta) {
        valid = false;
        issue('true_end_bonus_unknown', '달성한 True End의 성장률 보너스를 유일하게 확인하지 못했습니다.');
        continue;
      }
      appliedTrueEndBonuses.push({ scenarioEnum, scenario: matches[0].scenario ?? null,
        growthRatePermilDelta: delta, sourceRowIndex: matches[0].sourceRowIndex ?? null });
    }
    if (valid) trueEnd = add(...appliedTrueEndBonuses.map(row => row.growthRatePermilDelta));
  }
  const complete = Boolean(base && awakening && trueEnd);
  return {
    currentGrowthRatePermil: complete ? add(base, awakening, trueEnd) : null,
    growthStatus: !base ? 'unknown' : complete ? 'current_card' : 'partial',
    growthBreakdown: {
      unit: 'permil', base, awakening, trueEnd,
      knownTotal: base ? add(base, awakening, trueEnd) : null,
      potentialRank, awakeningRank: potentialRank, awakeningSource,
      trueEndProduceTypes: Array.isArray(observedTrueEnds) ? [...observedTrueEnds] : null,
      appliedTrueEndBonuses,
      excludedAdjustments: [
        { kind: 'affection', reason: '친애도 포인트만으로 성장률 추가분을 추정하지 않습니다.' },
        { kind: 'training', reason: '특훈의 초기 스탯·체력·SP 효과를 성장률 증가로 바꾸지 않습니다.' },
        { kind: 'produce_bonuses', reason: '서포트·메모리·시나리오 보너스는 이 카드 보유 성장률과 별도로 계산합니다.' },
      ],
      source: 'p_idol_stats.baseStats + exact owned potentialRank + observed character True End clears',
      issues,
    },
  };
}
