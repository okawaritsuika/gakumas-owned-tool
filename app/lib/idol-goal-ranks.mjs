import { exactGoalReview, goalSources, scopes } from './idol-goal-reviews.mjs';
import { buildIdolRecommendation } from './pidol-recommendation.mjs';

export const goalRankLabels = {
  priority: '우선 추천', recommended: '추천', conditional: '조건부', lower: '후순위',
  case: '공략 사례', fit: '덱 후보', unknown: '미평가',
};

function currentUniqueSkills(card, owned, definitions) {
  const training = owned?.levelLimitRank ?? owned?.uncap ?? owned?.raw?.levelLimitRank;
  if (!Number.isInteger(training) || training < 0) return [];
  const stages = card.specialTrainingStages ?? [];
  if (training > stages.length) return [];
  const passed = [];
  for (let rank = 1; rank <= training; rank++) {
    const matches = stages.filter(stage => stage.rank === rank);
    if (matches.length !== 1) return [];
    passed.push(matches[0]);
  }
  return ['produceCardId', 'secondProduceCardId'].flatMap((field, index) => {
    const effect = index === 0 ? 'IdolCardLevelLimitEffectType_ProduceCardUpgrade' : 'IdolCardLevelLimitEffectType_SecondProduceCardUpgrade';
    const upgrade = passed.filter(stage => stage.effectTypes?.includes(effect)).length;
    const variant = definitions.get(card.uniqueIds?.[field] + ':' + upgrade);
    if (!variant?.nativeRootKnown || !variant.publicDefinitionIdentityVerified) return [];
    const def = variant.publicDefinition;
    if (!Array.isArray(def?.conditions) || def.conditions.length || !Array.isArray(def.actions)) return [];
    const actions = def.actions.filter(group => !group.phase && (!group.conditions || group.conditions.length === 0))
      .flatMap(group => group.actions ?? []);
    const adds = name => actions.some(action => action.type === 'assignment' && action.lhs === name &&
      action.op === '+=' && action.rhs?.type === 'number' && action.rhs.value > 0);
    return [{ name: variant.nameKo || variant.nameJa, attack: adds('score'), extraUse: adds('cardUsesRemaining'),
      senseBuff: adds('concentration') || adds('goodConditionTurns'), once: def.limit === 1 }];
  });
}

function deckFit(scope, goal, card, skills) {
  let skill, source, reason;
  if (scope === 'hajime-pro' && goal === 'clear') {
    skill = skills.find(skill => skill.attack);
    source = 'first'; reason = '별도의 버프를 먼저 쌓지 않아도 기본 득점이 있어 첫 시험의 공격 한 자리를 담당합니다.';
  } else if (['hajime-master', 'hajime-legend', 'nia-pro'].includes(scope) || (scope === 'nia-master' && goal === 'clear')) {
    skill = skills.find(skill => skill.extraUse && skill.once);
    source = { 'hajime-master': 'firstMaster', 'hajime-legend': 'legendDeck', 'nia-pro': 'niaPro', 'nia-master': 'niaMaster' }[scope];
    reason = '사용 횟수를 보충하고 한 번 쓰면 빠져 반복할 카드만 남기기 쉽습니다. 재행동과 덱 압축을 쓰는 경로의 후보입니다.';
  } else if (scope === 'nia-master' && goal === 'score' && card.plan === 'sense') {
    skill = skills.find(skill => skill.senseBuff);
    source = 'niaScore'; reason = '고유 카드로 집중 또는 호조를 마련할 수 있습니다. 카드를 많이 얻어 덱이 두꺼워지는 센스 팽창 경로의 준비 수단입니다.';
  } else if (scope === 'hif' && card.plan === 'sense') {
    skill = skills.find(skill => skill.extraUse);
    source = goal === 'score' ? 'game8' : 'spotlight';
    reason = '사용 횟수를 보충하므로 각광 축에서 다른 카드를 같은 턴에 이어 쓸 수 있습니다. 각광과 드로우 수단을 따로 확보하세요.';
  }
  if (!skill) return null;
  return { rank: 'fit', reason: skill.name + ' · ' + reason, sources: [source, 'kit'] };
}

function reviewedGoal(scope, goal, card, owned, skills, plv) {
  const review = exactGoalReview(scope, goal, card.gameId) ?? deckFit(scope, goal, card, skills);
  if (!review) return { rank: 'unknown', reason: '이 목표·난이도에서 이 사양을 비교할 근거가 부족합니다.', sources: [] };
  const training = owned?.levelLimitRank ?? owned?.uncap;
  const requirements = [];
  if (review.minTraining !== undefined) requirements.push(Number.isInteger(training)
    ? `현재 특훈 ${training} · ${training >= review.minTraining ? '특훈 조건 충족, 육성 중 개조 선택 필요' : '특훈 조건 미충족'}` : '현재 특훈 미확인');
  if (review.minPlv !== undefined) requirements.push(Number.isInteger(plv)
    ? `현재 PLv ${plv} · 작성자 권장 PLv ${review.minPlv}` : `현재 PLv 미확인 · 작성자 권장 PLv ${review.minPlv}`);
  return { rank: review.rank, sourceTier: review.sourceTier, reason: review.reason, requirements, sources: review.sources };
}

export function buildIdolGoalRanks({ catalog, inventory, scope, appliedCustomizations = {}, plv = inventory.producerLevel, eventModeId = '' }) {
  if (!Object.hasOwn(scopes, scope)) throw Object.assign(new Error('시나리오와 난이도를 선택해 주세요.'), { status: 400 });
  if (!appliedCustomizations || typeof appliedCustomizations !== 'object' || Array.isArray(appliedCustomizations) ||
      Object.values(appliedCustomizations).some(id => typeof id !== 'string' || !id)) {
    throw Object.assign(new Error('의상별로 실제 적용한 개조 ID를 지정해 주세요.'), {status:400});
  }
  const ownedById = new Map((inventory.idolCards ?? []).map(card => [card.gameId, card]));
  const definitions = new Map((catalog.multiCreatorGuidance?.uniqueDefinitions?.cards ?? []).map(row => [row.gameId + ':' + row.upgradeCount, row]));
  const verified = new Set((catalog.multiCreatorGuidance?.idolProfiles ?? []).filter(profile => profile.identityVerified).map(profile => profile.idolGameId));
  const scenario = scope.split('-')[0];
  const rows = [];
  for (const card of catalog.idolCards ?? []) {
    const owned = ownedById.get(card.gameId);
    if (card.excludedScenarios?.includes(scenario) ||
        (card.recommendationEligible === false && !card.recommendWhenOwned && !owned)) continue;
    const skills = verified.has(card.gameId) ? currentUniqueSkills(card, owned, definitions) : [];
    rows.push({ id: card.gameId, name: card.nameKo || card.name || card.nameJa, nameJa: card.nameJa,
      characterId: card.characterId, characterName: card.characterName, plan: card.plan, rarity: card.rarity,
      owned: Boolean(owned), thumbnailUrl: owned?.thumbnailUrl || card.thumbnailUrl || null,
      recommendation: buildIdolRecommendation({card, owned, catalog, data:catalog.idolEffectData ?? {}, scope, plv, eventModeId,
        selectedCustomId:Object.hasOwn(appliedCustomizations,card.gameId) ? appliedCustomizations[card.gameId] : null}),
      score: reviewedGoal(scope, 'score', card, owned, skills, inventory.producerLevel),
      clear: reviewedGoal(scope, 'clear', card, owned, skills, inventory.producerLevel) });
  }
  if (Object.keys(appliedCustomizations).some(id => !rows.some(row => row.id === id))) {
    throw Object.assign(new Error('이 시나리오에서 확인할 수 없는 의상의 개조입니다.'), {status:400});
  }
  if (scope==='hif' && !eventModeId) {
    const value=row=>row.recommendation.hif?.rankable ? row.recommendation.value : null;
    rows.sort((a,b)=>{
      const av=value(a),bv=value(b);
      return Number(bv!==null)-Number(av!==null) || (bv??0)-(av??0) || (a.name??a.id).localeCompare(b.name??b.id,'ko');
    });
    let rank=null,previous=null;
    for (const [index,row] of rows.entries()) {
      const score=value(row);
      if (score!==previous) rank=score===null ? null : index+1;
      row.routeRank=rank;
      previous=score;
    }
  }
  return { scope, scopeLabel: scopes[scope], rows, labels: goalRankLabels, sources: goalSources };
}
