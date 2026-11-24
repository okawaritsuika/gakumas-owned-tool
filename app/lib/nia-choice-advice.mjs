// A weekly "business" slot does not identify the venues rolled for that run.
const venues = {
  company: {label:'기업 이벤트 회장', masterCost:0, reward:'drink'},
  municipal: {label:'지자체 이벤트 회장', masterCost:5, reward:'pp'},
  commercial: {label:'상업 시설', masterCost:5, reward:'upgradedCard'},
  resort: {label:'리조트 시설', masterCost:0, reward:'stamina'},
};
// The guide lists major auditions in ordinary MASTER only.
const masterAuditions = {
  'melo-bang': {activity:'audition_first', label:'メロBang!', requirements:{fanVotes:13000}},
  galaxy: {activity:'audition_second', label:'GAL★AXYミュージック', requirements:{fanVotes:25000}},
  finale: {activity:'audition_final', label:'FINALE', requirements:{fanVotes:62000, affection:17, runNumber:3}},
};
const proAuditions = {
  'melo-bang': {...masterAuditions['melo-bang'], requirements:{fanVotes:9000}},
  galaxy: masterAuditions.galaxy,
  finale: {...masterAuditions.finale, requirements:{...masterAuditions.finale.requirements, fanVotes:57000}},
  quartet: {activity:'audition_final', label:'QUARTET', requirements:{fanVotes:40000, affection:14, runNumber:2}},
  'idol-big-up': {activity:'audition_final', label:'iDOLBigUp!', requirements:{fanVotes:28000}},
};
const auditionTable = (difficulty, eventModeId) => eventModeId ? {} :
  difficulty === 'master' ? masterAuditions : difficulty === 'pro' ? proAuditions : {};
export function niaAuditionTarget(difficulty, eventModeId, activity) {
  const [id, rule] = Object.entries(auditionTable(difficulty,eventModeId)).find(([, row]) => row.activity === activity) ?? [];
  return rule ? {id, ...rule} : null;
}
const requirementNames = {fanVotes:'팬 투표', affection:'친애도', runNumber:'육성 회차'};
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const check = (available, needed) => needed === null ? null : needed === 0 ? true :
  number(available) === null ? null : available >= needed;
const all = checks => checks.includes(false) ? false : checks.includes(null) ? null : true;
const unconfirmed = reason => ({status:'unconfirmed', choices:[], recommendation:null, reason});

const rewardNames = {card:'일반 카드', upgradedCard:'강화된 카드', drink:'드링크', pp:'P포인트', stamina:'체력 회복'};

function venueChoice(offer, state, ordinaryMaster, eventModeId) {
  if (!Object.hasOwn(venues, offer.id)) return null;
  const venue = venues[offer.id];
  const stamina = number(Object.hasOwn(offer, 'staminaCost') ? offer.staminaCost : ordinaryMaster ? venue.masterCost : null);
  const pp = number(Object.hasOwn(offer, 'ppCost') ? offer.ppCost : ordinaryMaster ? 0 : null);
  // Official NIA help lists the four reward profiles. Event changes need an observed profile.
  const ordinaryRewards = venue.reward === 'upgradedCard' ? ['upgradedCard'] : ['card',venue.reward];
  const types = Object.hasOwn(offer, 'rewardTypes') ? offer.rewardTypes : !eventModeId ? ordinaryRewards : null;
  const confirmed = Array.isArray(types) && types.every(type => Object.hasOwn(rewardNames, type));
  const rewards = confirmed ? types : [];
  const bonus = rewards.includes('pp') ? number(offer.ppReward) : null;
  const recovery = rewards.includes('stamina') ? number(offer.staminaRecovery) : null;
  return {id:offer.id, label:venue.label, canChoose:all([check(state.stamina, stamina),check(state.pp, pp)]),
    costs:{stamina,pp}, rewardTypes:confirmed ? rewards : null, rewards:{card:rewards.includes('upgradedCard') ? 'upgraded' : rewards.includes('card') ? 'normal' : null,
      drink:confirmed ? rewards.includes('drink') : null, hasPP:confirmed ? rewards.includes('pp') : null, pp:bonus,
      recoversStamina:confirmed ? rewards.includes('stamina') : null, staminaRecovery:recovery},
    costText:[`체력 비용 ${stamina ?? '미확인'} · P 비용 ${pp ?? '미확인'}`],
    rewardText:confirmed ? rewards.map(type => rewardNames[type] + (type === 'pp' && bonus !== null ? ` +${bonus}P` :
      type === 'stamina' && recovery !== null ? ` +${recovery}` : '')) : ['현재 보상 미확인']};
}

function auditionChoice(offer, state, activity, table) {
  const menuName = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
  const known = Object.entries(table)
    .find(([id, rule]) => [id,menuName(rule.label)].some(name => name === menuName(offer.id) || name === menuName(offer.label)))?.[1];
  if (known && activity !== known.activity) return null;
  const checks = [], costText = [], unmet = [];
  // An explicit empty map means the visible menu was checked and has no gates.
  if ((!known || Object.hasOwn(offer, 'requirements')) && !record(offer.requirements)) checks.push(null);
  for (const [criteria, label] of Object.entries(requirementNames)) {
    const hasObserved = record(offer.requirements) && Object.hasOwn(offer.requirements, criteria);
    const baseline = known?.requirements[criteria];
    if (!hasObserved && baseline === undefined) continue;
    const observed = hasObserved ? number(offer.requirements[criteria]) : 0;
    const needed = observed === null ? null : Math.max(observed, baseline ?? 0);
    const met = check(state[criteria], needed);
    checks.push(met);
    if (met === false) unmet.push({criteria, needed, current:state[criteria]});
    costText.push(`${label} ${needed ?? '미확인'} 이상 · 현재 ${number(state[criteria]) ?? '미확인'}`);
  }
  if (record(offer.requirements) && Object.keys(offer.requirements).some(key => !Object.hasOwn(requirementNames, key))) checks.push(null);
  if (Object.hasOwn(offer, 'otherConditionsMet')) {
    checks.push(typeof offer.otherConditionsMet === 'boolean' ? offer.otherConditionsMet : null);
    costText.push(`기타 조건 ${offer.otherConditionsMet === true ? '충족' : offer.otherConditionsMet === false ? '미달' : '미확인'}`);
  }
  return {id:offer.id, label:offer.label || known?.label || offer.id, canChoose:all(checks), unmet, costText, rewardText:[]};
}

export function buildNiaChoiceAdvice({scenario, difficulty, eventModeId, week, activity, observation} = {}) {
  const isBusiness = activity === 'business';
  if (scenario !== 'nia' || !['master','pro'].includes(difficulty) ||
      (!isBusiness && !['audition_first','audition_second','audition_final'].includes(activity))) {
    return {status:'not_applicable', choices:[], recommendation:null, reason:'NIA 영업·오디션 주차에만 적용합니다.'};
  }
  const state = observation;
  if (!record(state) || !Number.isSafeInteger(week) || week < 1 || state.week !== week ||
      state.difficulty !== difficulty || (state.eventModeId || null) !== (eventModeId || null)) {
    return unconfirmed('현재 모드·난이도·주차에서 제시된 선택지 미확인');
  }
  const offers = isBusiness ? state.venueOffers : state.auditionOffers;
  if (!Array.isArray(offers) || !offers.length) return unconfirmed(isBusiness ? '현재 열린 영업 장소 미확인' : '현재 오디션 후보 미확인');
  const ordinaryMaster = difficulty === 'master' && !eventModeId;
  const choices = offers.filter(offer => record(offer) && typeof offer.id === 'string' && offer.id.trim())
    .map(offer => isBusiness ? venueChoice(offer, state, ordinaryMaster, eventModeId) :
      auditionChoice(offer, state, activity, auditionTable(difficulty,eventModeId))).filter(Boolean);
  const eligible = choices.filter(choice => choice.canChoose === true && (!isBusiness || choice.rewardTypes !== null));
  let samePriority = [];
  if (isBusiness) {
    const preferred = choice => Number(choice.rewardTypes.includes(state.priority));
    const quantity = choice => state.priority === 'pp' ? choice.rewards.pp : state.priority === 'stamina' ? choice.rewards.staminaRecovery : null;
    const compare = (a,b) => preferred(b) - preferred(a) ||
      Number(quantity(b) !== null) - Number(quantity(a) !== null) || (quantity(b) ?? 0) - (quantity(a) ?? 0) ||
      a.costs.stamina - b.costs.stamina || a.costs.pp - b.costs.pp;
    eligible.sort(compare);
    samePriority = eligible.slice(1).filter(row => compare(eligible[0],row) === 0);
  }
  const recommendation = eligible[0] ?? null;
  if (!recommendation && (!choices.length || choices.some(choice => choice.canChoose === null || choice.canChoose === true && choice.rewardTypes === null))) {
    return {...unconfirmed('선택 조건, 현재 자원 또는 보상 미확인'), choices};
  }
  if (!recommendation) return {status:'unavailable',choices,recommendation:null,reason:'확인한 후보 중 조건을 만족하는 선택지가 없습니다.'};
  if (!isBusiness) return {status:'recommended',choices,recommendation,reason:'입장 조건을 충족한 후보 중 직접 입력한 선호 순서가 가장 앞섭니다.'};
  const goal = Object.hasOwn(rewardNames,state.priority) ? rewardNames[state.priority] : null;
  const hasGoal = recommendation.rewardTypes.includes(state.priority);
  const reason = !goal ? '현재 갈 수 있는 장소에서 체력 비용, P 비용 순으로 아낄 수 있는 곳입니다.' :
    hasGoal ? `원한 보상인 ${goal}을 받을 수 있습니다.` : `현재 갈 수 있고 보상을 확인한 장소에는 ${goal} 보상이 없어 비용이 적은 대안을 골랐습니다.`;
  const tradeoff = samePriority.length ? ` ${samePriority.map(row=>row.label).join(' · ')}도 같은 우선순위입니다. 추가로 받을 보상을 비교하세요.` : '';
  return {status:'recommended',choices,recommendation,reason:`${reason} ${recommendation.costText[0]}. 받을 보상은 ${recommendation.rewardText.join(' · ') || '없음'}입니다.${tradeoff}`};
}
