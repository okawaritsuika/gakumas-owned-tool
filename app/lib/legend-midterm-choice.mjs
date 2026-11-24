import { buildSkillAdvice } from './skill-advice.mjs';

const trainingPlans = { concentration: 'sense', goodConditionTurns: 'sense', motivation: 'logic',
  goodImpressionTurns: 'logic', strength: 'anomaly', fullPower: 'anomaly', preservation: 'anomaly' };
const tiers = ['core', 'recommended', 'situational', 'low', 'avoid', 'unrated'];
const noChoice = (status, reason) => ({ status, reason, recommended: null, candidates: [] });

export function buildLegendMidtermChoice({ catalog = {}, scenario, difficulty, plan, trainingType, deckCardIds, observation } = {}) {
  if (scenario !== 'hajime' || (difficulty && difficulty !== 'legend') || observation?.midtermPassed === false)
    return noChoice('inactive', '하지메 LEGEND 중간시험 합격 시에만 열립니다.');
  if (difficulty !== 'legend' || observation?.midtermPassed !== true)
    return noChoice('unknown', '난이도와 중간시험 합격 여부를 확인해 주세요.');
  if (!Array.isArray(observation.offeredCardIds) || !observation.offeredCardIds.length)
    return noChoice('unknown', '중간시험 합격 후 실제로 제시된 레전드 카드가 미확인입니다.');

  const type = ({ goodCondition: 'goodConditionTurns', good_condition: 'goodConditionTurns',
    goodImpression: 'goodImpressionTurns', good_impression: 'goodImpressionTurns', full_power: 'fullPower',
    enthusiasm: 'strength' })[trainingType] ?? trainingType;
  const selectedPlan = trainingPlans[type] ?? plan;
  const byGameId = new Map((catalog.skillAdvice?.cards ?? []).map(card => [card.gameId, card]));
  const offeredIds = [...new Set(observation.offeredCardIds)];
  const offered = offeredIds.map(id => byGameId.get(id)).filter(card =>
    card?.status?.isLegend && card.status.identityVerified !== false && !card.status.releaseExcluded &&
    card.sourceType === 'produce' && (!selectedPlan || selectedPlan === 'free' || ['free', selectedPlan].includes(card.plan)));
  if (!offered.length) return noChoice('unknown', '제시 목록에서 현재 플랜에 맞는 레전드 카드 ID를 확인해 주세요.');

  const assessed = Object.hasOwn(trainingPlans, type) ? buildSkillAdvice({ catalog, input: {
    scenario, difficulty, trainingType: type, purpose: 'acquisition', stage: 'late', upgradeCount: 0,
    cardIds: offered.map(card => card.id ?? card.gameId)
  } }).cards : [];
  const deck = observation.deckCardIds ?? deckCardIds;
  const deckRoles = new Set((Array.isArray(deck) ? deck : []).flatMap(id =>
    byGameId.get(id)?.variants?.find(variant => variant.upgradeCount === 0)?.roles ?? []));
  const candidates = offered.map(card => {
    const assessment = assessed.find(row => row.gameId === card.gameId);
    const tier = assessment?.rating.tier ?? 'unrated';
    const roles = card.variants?.find(variant => variant.upgradeCount === 0)?.roles ?? [];
    const addedRoles = deckRoles.size ? roles.filter(role => !deckRoles.has(role)) : [];
    const reason = assessment ? [assessment.rating.label, assessment.reasons[0]].filter(Boolean).join(' · ') :
      '육성 유형 미확인. 비교 근거가 같으면 게임 제시 순서를 따릅니다.';
    return { gameId: card.gameId, name: assessment?.name ?? card.nameKo ?? card.nameJa ?? card.gameId, tier, reason, addedRoles };
  }).sort((a, b) => tiers.indexOf(a.tier) - tiers.indexOf(b.tier) || b.addedRoles.length - a.addedRoles.length);
  const unverified = offeredIds.length - candidates.length;
  const reason = candidates[0].reason + (unverified ? ` · 입력한 후보 중 ${unverified}장은 현재 플랜의 레전드 카드로 확인되지 않았습니다.` : '');
  return { status: 'recommended', recommended: candidates[0], candidates, reason };
}
