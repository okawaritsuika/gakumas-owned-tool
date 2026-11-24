import { evaluateSupportItemValue } from './support-item-value.mjs';
import { declaredProduceActionCounts } from './produce-action-counts.mjs';

const axes = ['vocal', 'dance', 'visual'];
const zero = () => ({ vocal: 0, dance: 0, visual: 0 });
const list = value => Array.isArray(value) ? value : [];
const productionIds = { hajime: {regular: 1, pro: 2, master: 3, legend: 6}, nia: {pro: 4, master: 5} };
// Produce.yaml, idolCardParameterGrowthLimit for produce-001 through produce-006.
const parameterCaps = [null, 1000, 1500, 1800, 2000, 2600, 3000];
export function scenarioStatCaps(scenario, difficulty, options) {
  const id = productionIds[scenario]?.[difficulty];
  return Object.fromEntries(axes.map(axis => [axis, options.statCaps?.[axis] ??
    (!options.eventModeId ? parameterCaps[id] ?? null : null)]));
}

const exam = activity => /(?:_exam$|^audition_)/.test(activity ?? '');
const regularVenue = { consultation:'consult', activity_supply:'supply_gift', activity_supply_gift:'supply_gift',
  sp_lesson:'lesson', intensive_lesson:'lesson', self_lesson:'lesson' };
const venue = activity => regularVenue[activity] ?? (/_lesson$/.test(activity ?? '') ? 'lesson' :
  /^class_/.test(activity ?? '') ? 'class' : activity);
const datedVenues = new Set(['consult','outing','supply_gift','special_training','class','lesson','business','rest']);
const businessPlaces = new Set(['company','municipal','commercial','resort']);
const exchangeVenues = new Set(['consult','outing','supply_gift','special_training']);

function menuFor(catalog, scenario, route, characterId) {
  const difficulty = route.difficulty;
  if (scenario === 'nia') {
    return list(catalog.niaSchedule?.pro).filter((_, i) => difficulty !== 'master' ||
      i + 1 !== catalog.niaSchedule.masterOmitsProWeek).map((activities, i) => ({week:i+1, activities}));
  }
  const proMenu = difficulty === 'pro' && catalog.hajimeProMenus?.byCharacter?.[characterId]?.weeks;
  if (proMenu) return proMenu.map(row => ({...row, activities:[...row.activities,
    ...(catalog.hajimeSchedule?.pro?.[row.week - 1]?.includes('rest') ? ['rest'] : [])]}));
  const standard = catalog.hajimeSchedule?.[difficulty];
  if (Array.isArray(standard)) return standard.map((activities,i) => ({week:i+1, activities}));
  return list(catalog.calculationModels?.['score/schedule']?.table?.hajime?.[difficulty])
    .map(row=>row.can_rest ? {...row,activities:[...row.activities,'rest']} : row);
}

const freeCounts = {supply_gift:'activity_supply_gift',outing:'outing',consult:'consult',special_training:'special_training',rest:'rest'};

export function startItemObservationWeeks(catalog,scenario,difficulty) {
  const nia=scenario==='nia' && difficulty==='master';
  if (!nia && !(scenario==='hajime' && difficulty==='legend')) return [];
  return menuFor(catalog,scenario,{difficulty}).flatMap(({week,activities})=>{
    if (!nia) return [{week}];
    const venues=activities.flatMap(activity=>activity==='business' ? ['company','commercial','municipal']
      : exchangeVenues.has(venue(activity)) ? [venue(activity)] : []);
    return venues.length ? [{week,venues}] : [];
  });
}

// Observations describe physical targets at the instant an item fires. They do
// not replace the ordinary drink/skill totals imported with a route preset.
export function startItemObservationActions(catalog,scenario,route,options) {
  const rows=options.startItemObservations;
  if (rows==null) return [];
  if (!Array.isArray(rows) || options.eventModeId) throw new RangeError('일반 시나리오의 주차별 챌린지 관측을 확인해 주세요.');
  const menu=startItemObservationWeeks(catalog,scenario,route.difficulty);
  const seen=new Set();
  return rows.flatMap(row=>{
    const day=menu.find(day=>day.week===row?.week);
    if (!day || seen.has(day.week)) throw new RangeError('챌린지 관측은 가능한 주차마다 한 번씩 입력해 주세요.');
    seen.add(day.week);
    if (day.venues) {
      if (!day.venues.includes(row.venue) || !Number.isSafeInteger(row.basicCardCountBeforeChallenge) || row.basicCardCountBeforeChallenge<0)
        throw new RangeError('그 주에 방문 가능한 장소와 교환 직전의 기본 카드 수를 확인해 주세요.');
      return [{action:'challenge_check',week:day.week,venue:row.venue,basicCardCountBeforeChallenge:row.basicCardCountBeforeChallenge}];
    }
    if (!Array.isArray(row.deckSizes) || !row.deckSizes.length || row.deckSizes.some(n=>!Number.isSafeInteger(n)||n<1))
      throw new RangeError('각 카드 획득 때의 덱 장수를 양의 정수로 입력해 주세요.');
    return row.deckSizes.map(n=>({action:'acquire',week:day.week,quantity:1,deckCardCountAtTrigger:n}));
  });
}
const reportedVenue = action => venue(action.venue ?? action.action);

function changeFreeActivity(route, choices) {
  const counts = {...route.counts};
  const selections = route.selections.map(row=>{
    const chosen = choices.get(row.week);
    if (!chosen || venue(row.activity)===venue(chosen)) return row;
    const previous = freeCounts[venue(row.activity)], next = freeCounts[venue(chosen)];
    if (previous) counts[previous]=Math.max(0,(counts[previous]??0)-1);
    counts[next]=(counts[next]??0)+1;
    return {...row,activity:chosen,axis:null};
  });
  Object.assign(counts, route.explicitCounts);
  return {...route,counts,selections,
    ...(route.hajimePro ? {hajimePro:{...route.hajimePro,selections}} : {}),
    ...(route.hajimeMaster ? {hajimeMaster:{...route.hajimeMaster,selections}} : {})};
}

// Keep lessons, classes and exams fixed. A dated visit takes priority on a free day.
// Search one alternate per week and a few all-day policies only for the finalist.
export function hajimeFreeActivities(catalog, route, selected, options, compare=false) {
  if (!route.selections || options.eventModeId) return compare ? [] : route;
  const menus = menuFor(catalog,'hajime',route,selected?.characterId);
  const fixed = new Map(), flexible=[];
  for (const row of route.selections) {
    if (row.activity && !freeCounts[venue(row.activity)]) continue;
    const menu=menus.find(day=>day.week===row.week);
    const choices=menu?.activities.filter(a=>freeCounts[venue(a)]) ?? [];
    const declared=list(options.produceActions).filter(a=>a.week===row.week && !a.stage && a.venue!=='interval');
    const selection=choices.find(a=>declared.some(action=>reportedVenue(action)===venue(a)));
    if (selection) fixed.set(row.week,selection);
    else if (row.activity && choices.length>1 &&
      (route.difficulty==='legend' || route.hajimePro?.characterMenuSource)) flexible.push({row,choices});
  }
  const actual=fixed.size ? changeFreeActivity(route,fixed) : route;
  if (!compare) return actual;
  const results=new Map();
  const relevant = new Set();
  const triggerVenues={activity_supply_gift_selection:'supply_gift',outing_end:'outing',consult_selection:'consult',special_training_start:'special_training'};
  for (const card of catalog.supportCards ?? []) {
    if (card.plan && selected?.plan && card.plan!=='free' && card.plan!==selected.plan) continue;
    relevant.add(triggerVenues[card.p_item?.effect?.trigger?.key]);
    for (const ability of card.levelAbilities ?? []) {
      const kind=(ability.kind??'').replace(/_hp$/,'');
      if (freeCounts[venue(kind)]) relevant.add(venue(kind));
    }
  }
  if (route.difficulty==='legend' && (options.availableStartItemIds?.length || options.startItemIds?.length)) {
    relevant.add('outing');relevant.add('supply_gift');
  }
  const add=choices=>{
    const variant=changeFreeActivity(actual,choices);
    const key=variant.selections.map(row=>venue(row.activity)).join(',');
    if (!results.has(key)) results.set(key,variant);
  };
  for(const activity of Object.keys(freeCounts)) {
    if(!relevant.has(activity)) continue;
    const swaps=new Map();
    for(const {row,choices} of flexible) {
      const choice=choices.find(a=>venue(a)===activity);
      if(choice && venue(row.activity)!==activity) {
        swaps.set(row.week,choice);
        add(new Map([[row.week,choice]]));
      }
    }
    if(swaps.size>1) add(swaps);
  }
  return [...results.values()];
}

function normalizedSelections(rows) {
  return rows.filter(row => row.activity).map(row => {
    if (exam(row.activity)) return {...row, activity: 'final_exam'};
    if (row.activity === 'class') return {...row, activity: 'class_work_end'};
    if (venue(row.activity) === 'lesson') return {...row, main:row.axis, isSpLesson:row.activity === 'sp_lesson'};
    return row;
  });
}

const countKinds = { consult:'consult', outing:'outing', rest:'rest', activity_supply_gift:'supply_gift',
  special_training:'special_training', class_work_end:'class_work_end', skill_acquire:'acquire',
  skill_enhance:'upgrade', delete:'remove', change:'change', customize:'customize', p_drink_acquire:'drink_acquire' };

// Excel totals are undated. They may inform an early-receipt comparison but cannot establish
// that a trigger happened after a particular week, or that an HP/parameter gate was met.
export function prepareScenarioTimeline(catalog, scenario, route, options, selected) {
  const menu = menuFor(catalog, scenario, route, selected?.characterId);
  const entry = week => menu.find(row => row.week === week);
  const completed = week => menu.filter(row => row.week < week && row.activities.some(exam)).length;
  const horizon = menu.filter(row => row.activities.some(exam)).length || (scenario === 'nia' ? 3 : 2);
  const dated = normalizedSelections(route.selections ?? []);
  if (scenario === 'nia' && !options.eventModeId) {
    // The game's item text says 授業・営業終了時. Business ends at a known date
    // even when the randomly offered locations and their rewards are still unknown.
    for (const row of menu.filter(row=>row.activities.length===1 && row.activities[0]==='business')) {
      dated.push({week:row.week, activity:'class_work_end'});
    }
  }
  const accepted = [], excluded = [];
  const visits = new Map(), businessVisits = new Map(list(options.scenarioRewardVisits).map(row=>[row.week,row.venue]));
  const observations=startItemObservationActions(catalog,scenario,route,options);
  // A dated observation and a detailed description of the same event are two
  // representations of one receipt. Reject ambiguity instead of adding both.
  if (observations.some(o=>list(options.produceActions).some(a=>a.week===o.week && a.action===o.action))) {
    throw new RangeError('같은 주의 챌린지 관측과 동일한 행동을 중복 입력했습니다.');
  }
  const niaChecks=observations.filter(a=>a.action==='challenge_check');
  for (const action of [...list(options.produceActions),...niaChecks]) {
    const specific = reportedVenue(action);
    const place = businessPlaces.has(specific) ? 'business' : specific;
    const scheduled = entry(action.week);
    const planned = dated.find(row => row.week === action.week);
    const outOfRange = action.week != null && (!Number.isInteger(action.week) || action.week < 1 || (menu.length && !scheduled));
    const impossibleVenue = action.action === 'interval' || action.venue === 'interval' || action.venue === 'scenario_item_hif' ||
      ['selection','final'].includes(action.stage) || scenario === 'hajime' && place === 'business';
    const blocked = scheduled && datedVenues.has(place) && !scheduled.activities.some(activity => venue(activity) === place);
    const conflict = scenario==='hajime' && planned?.activity && datedVenues.has(place) &&
      venue(planned.main ? 'lesson' : planned.activity === 'class_work_end' ? 'class' : planned.activity) !== place;
    const examIndex = action.fromExamIndex ?? (scheduled ? completed(action.week) : null);
    const mismatchedTime = scheduled && (examIndex < completed(action.week) ||
      examIndex > completed(action.week) + Number(scheduled.activities.some(exam)));
    if (outOfRange || impossibleVenue || blocked || mismatchedTime || !Number.isInteger(examIndex) || examIndex < 0 || examIndex > horizon) {
      excluded.push({week:action.week ?? null, action:action.action, venue:action.venue ?? null});
    } else {
      if (scheduled && datedVenues.has(place)) {
        if (visits.has(action.week) && visits.get(action.week)!==place ||
          businessVisits.has(action.week) && (place!=='business' || businessPlaces.has(specific) && businessVisits.get(action.week)!==specific)) {
          throw new RangeError(`${action.week}주에 서로 다른 행동 장소를 동시에 선택할 수 없습니다.`);
        }
        visits.set(action.week,place);
        if (businessPlaces.has(specific)) businessVisits.set(action.week,specific);
      }
      if (conflict) excluded.push({week:action.week,action:action.action,venue:action.venue ?? null});
      else accepted.push({...action, fromExamIndex:examIndex});
    }
  }
  const counts = {...route.counts};
  const knownRouteCounts = {...route.knownRouteCounts};
  const minimumCounts = {};
  if (scenario==='nia') {
    for (const [week,place] of visits) {
      const kind=freeCounts[place];
      if (!kind) continue;
      minimumCounts[kind]=(minimumCounts[kind]??0)+1;
      dated.push({week,activity:place,basis:'declared_visit'});
    }
    for (const [kind,count] of Object.entries(minimumCounts)) counts[kind]=Math.max(counts[kind]??0,count);
  }
  if (Array.isArray(options.produceActions)) {
    const declared = declaredProduceActionCounts(accepted, catalog, {examIndex:horizon});
    Object.assign(counts, declared, route.explicitCounts);
    for (const [kind,count] of Object.entries(declared)) knownRouteCounts[kind] = count !== null;
  }
  for (const [kind, amount] of Object.entries(options.scenarioRewardBaseCounts ?? {})) {
    if (['p_drink_acquire','skill_enhance'].includes(kind) && Number.isFinite(amount) && amount >= 0) {
      counts[kind] = amount;
      knownRouteCounts[kind] = true;
    }
  }
  const aggregates = [];
  if (!Array.isArray(options.produceActions)) {
    for (const [kind, action] of Object.entries(countKinds)) {
      const count = Math.floor(counts[kind] ?? 0);
      const scheduled = dated.filter(row => venue(row.activity) === venue(action)).length;
      if (count > scheduled) aggregates.push({action, quantity:count-scheduled, fromExamIndex:0,
        basis:'undated_route_count', unordered:true});
    }
    if (scenario === 'nia') for (const axis of axes) {
      const total = Math.floor(route.perAxis[axis].lesson_end), sp = Math.floor(route.perAxis[axis].sp_lesson_end);
      for (const [quantity, isSpLesson] of [[sp,true],[Math.max(0,total-sp),false]]) if (quantity > 0) {
        aggregates.push({action:'lesson_end', parameter:axis, isSpLesson, quantity, fromExamIndex:0, basis:'undated_route_count', unordered:true});
      }
    }
  }
  if (!dated.some(row=>exam(row.activity)) && !options.eventModeId) for (const row of menu) {
    if (row.activities.some(exam)) dated.push({week:row.week, activity:'final_exam'});
  }
  const produceId = productionIds[scenario]?.[route.difficulty];
  const profile=catalog.produceInitialDecks?.idolProfiles?.find(row=>row.idolCardId===selected?.gameId);
  const deckId=profile?.scenarioDeckIds?.['produce-'+String(produceId).padStart(3,'0')];
  const slots=list(catalog.produceInitialDecks?.decks?.[deckId]?.cardSlots);
  const upgradeVariants=new Set(catalog.skillCards?.filter(card=>card.upgradeCount===1).map(card=>card.gameId));
  const knownUpgradeTargets=slots.filter(slot=>slot.upgradeCount===0 && upgradeVariants.has(slot.cardId)).length;
  const selections=scenario==='nia' ? menu.map(day=>({week:day.week,
    activity:visits.get(day.week) ?? (day.activities.length===1 ? day.activities[0] : null),
    ...(businessVisits.has(day.week) ? {venue:businessVisits.get(day.week)} : {})})) : route.selections;
  const challengeActions=observations.length ? [...accepted,...observations.filter(a=>a.action==='acquire')
    .map(a=>({...a,fromExamIndex:completed(a.week)}))] : accepted;
  return {...route, selections, counts, knownRouteCounts, minimumCounts, produceActions:accepted, challengeActions, excludedProduceActions:excluded, itemSelections:dated, knownExamWeekIndices:
    Object.fromEntries(menu.map(row=>[row.week,completed(row.week)])),
    undatedItemActions:aggregates, examHorizon:horizon, knownUpgradeTargets, upgradeVariants};
}

export function scoreScenarioSupportItem(card, level, route, plan, options, catalog) {
  if (!card.p_item) return null;
  const receipt = options.supportItemAcquisitions?.[card.gameId];
  const event = list(card.events).find(row => row.effect_type === 'p_item');
  const unlock = event?.release === 'initial' ? 1 : Number(/^lv(\d+)$/.exec(event?.release ?? '')?.[1]);
  const assumeEarly = receipt == null && options.includeSupportEvents !== false && Number.isFinite(unlock) && level >= unlock;
  const actions = [...route.produceActions, ...(route.rewardTimeline ?? [])];
  const timeline = {selections:route.itemSelections, produceActions:actions};
  const itemOptions = {...options, produceActions:actions};
  const actual = evaluateSupportItemValue({card, level, plan, route:timeline, options:itemOptions, catalog, examIndex:route.examHorizon});
  // The acquisition input stays untouched. An unlocked story on a favorable planned run
  // can contribute to the comparison without becoming a confirmed receipt in the UI.
  const projected = assumeEarly || receipt?.confirmed === true && receipt.beforeProduce && route.undatedItemActions.length;
  const candidate = projected ? evaluateSupportItemValue({card,level,plan,route:timeline,catalog,examIndex:route.examHorizon,
    options:{...itemOptions,produceActions:[...actions,...route.undatedItemActions],
      supportItemAcquisitions:{[card.gameId]:receipt ?? {confirmed:true,beforeProduce:true}}}}).applied : actual.applied;
  return {...actual, comparison:{basis:assumeEarly?'early_unlocked_story_assumption':projected?'confirmed_receipt_with_undated_plan':'declared_timeline',
    acquisitionAssumed:assumeEarly, total:candidate}};
}

export function evaluateScenarioDeck(cards, context, details = false) {
  const totals = {...context.base}, linked = zero(), supplies = {p_drink_acquire:0,skill_enhance:0};
  const rates = {...context.baseGrowth}, previousGrowth = {...context.baseGrowthStats};
  let utility = context.fixedUtility;
  for (const card of cards) {
    for (const axis of axes) {
      totals[axis] += card.statContribution[axis];
      rates[axis] += card.growthRates[axis];
      previousGrowth[axis] += card.individualGrowth[axis];
    }
    utility += card.utilityScore;
    const item = card.supportItemValue?.comparison.total;
    if (!item) continue;
    supplies.p_drink_acquire += item.resources.pDrinkAcquisitions;
    for (const op of item.operations) if (op.cardAction === 'upgrade' && op.target === 'any') {
      supplies.skill_enhance += op.quantity * op.count;
    }
  }
  const suppliedOpportunities = details ? {...supplies} : null;
  for (const key of ['skill_enhance','p_drink_acquire']) if (!context.separateItemSupply[key]) supplies[key] = 0;
  supplies.skill_enhance = Math.min(supplies.skill_enhance, context.remainingUpgradeTargets);
  for (const card of cards) for (const receiver of card.itemReceivers) {
    const extra = Math.min(supplies[receiver.kind], Math.max(0, receiver.limit - receiver.used));
    linked[receiver.axis] += extra * receiver.amount;
  }
  const capped = zero();
  let score = utility, contribution = utility - context.fixedUtility;
  for (const axis of axes) {
    let growth;
    if (context.bonusRows) {
      context.weeklyGrowthByRate??={vocal:new Map(),dance:new Map(),visual:new Map()};
      const cache=context.weeklyGrowthByRate[axis];
      growth=cache.get(rates[axis]);
      if (growth===undefined) {
        growth=context.bonusRows.reduce((sum,row)=>sum+Math.floor(row[axis]*rates[axis]/1000),0);
        cache.set(rates[axis],growth);
      }
    } else growth=context.gains[axis]*rates[axis]/1000;
    totals[axis] += growth - previousGrowth[axis];
    totals[axis] += linked[axis];
    const cap = context.caps[axis] ?? Infinity;
    capped[axis] = Math.min(cap, totals[axis]);
    score += capped[axis] * context.axisWeights[axis];
    contribution += (capped[axis] - Math.min(cap,context.base[axis])) * context.axisWeights[axis];
  }
  return details ? {score, supportComparisonIndex:Math.round(contribution*100)/100, fixedStats:context.base,
    rawStats:totals,cappedStats:capped,statCaps:context.caps,supportItemActionCounts:supplies,
    supportItemOpportunities:suppliedOpportunities,linkedStatContribution:linked,utilityScore:utility} : score;
}

// In a one-slot comparison the other five supports have the same rates, item
// supply and receiving abilities for every candidate. Sum those inputs once.
export function fixedScenarioSupportGroup(cards, omit) {
  const group={statContribution:zero(),growthRates:zero(),individualGrowth:zero(),utilityScore:0,itemReceivers:[]};
  const item={resources:{pDrinkAcquisitions:0},operations:[]};
  for(const card of cards) {
    if(card===omit) continue;
    for(const axis of axes) {
      group.statContribution[axis]+=card.statContribution[axis];
      group.growthRates[axis]+=card.growthRates[axis];
      group.individualGrowth[axis]+=card.individualGrowth[axis];
    }
    group.utilityScore+=card.utilityScore;
    group.itemReceivers.push(...card.itemReceivers);
    const supplied=card.supportItemValue?.comparison.total;
    if(supplied) {
      item.resources.pDrinkAcquisitions+=supplied.resources.pDrinkAcquisitions;
      item.operations.push(...supplied.operations.filter(op=>op.cardAction==='upgrade' && op.target==='any'));
    }
  }
  if(item.resources.pDrinkAcquisitions || item.operations.length) group.supportItemValue={comparison:{total:item}};
  return group;
}

// Ignore stat caps and weekly rounding, and allow each receiving ability to use
// the largest item supply any six supports could provide. These relaxations
// can only increase the score, so they are safe for screening rental drafts.
export function scenarioRentalScoreCeiling(owned, rentals, context) {
  const cards=[...owned,...rentals];
  const maximum={p_drink_acquire:0,skill_enhance:0};
  for (const card of cards) {
    const item=card.supportItemValue?.comparison.total;
    if (!item) continue;
    maximum.p_drink_acquire=Math.max(maximum.p_drink_acquire,6*item.resources.pDrinkAcquisitions);
    const upgrades=item.operations.reduce((n,op)=>op.cardAction==='upgrade' && op.target==='any' ? n+op.quantity*op.count : n,0);
    maximum.skill_enhance=Math.max(maximum.skill_enhance,6*upgrades);
  }
  maximum.skill_enhance=Math.min(maximum.skill_enhance,context.remainingUpgradeTargets);
  const upperStats=new Map();
  for (const card of cards) {
    const stats=zero();
    for (const axis of axes) stats[axis]=card.statContribution[axis]-card.individualGrowth[axis]
      +context.gains[axis]*card.growthRates[axis]/1000;
    for (const receiver of card.itemReceivers) if (context.separateItemSupply[receiver.kind]) {
      const n=Math.min(maximum[receiver.kind],Math.max(0,receiver.limit-receiver.used));
      stats[receiver.axis]+=n*Math.max(0,receiver.amount);
    }
    upperStats.set(card,stats);
  }
  // For each axis both its uncapped reward and its fixed cap are upper bounds.
  // The smallest of these eight independent optimistic deck scores is still safe.
  const bound=new Map(rentals.map(card=>[card,Infinity]));
  for(let mask=0;mask<8;mask++) {
    const open=axes.filter((_,i)=>!(mask&(1<<i))), capped=axes.filter((_,i)=>mask&(1<<i));
    if(capped.some(axis=>context.caps[axis]==null)) continue;
    const baseline=open.reduce((n,axis)=>n+context.axisWeights[axis]*(context.base[axis]-context.baseGrowthStats[axis]
      +context.gains[axis]*context.baseGrowth[axis]/1000),context.fixedUtility)
      +capped.reduce((n,axis)=>n+context.axisWeights[axis]*context.caps[axis],0);
    const values=new Map(cards.map(card=>[card,open.reduce((n,axis)=>n+upperStats.get(card)[axis]*context.axisWeights[axis],card.utilityScore)]));
    const ranked=owned.toSorted((a,b)=>values.get(b)-values.get(a)).slice(0,6);
    for(const rental of rentals) {
      const top=ranked.filter(card=>card.gameId!==rental.gameId).slice(0,5);
      const upper=top.reduce((n,card)=>n+values.get(card),baseline+values.get(rental));
      bound.set(rental,Math.min(bound.get(rental),upper));
    }
  }
  return rental=>bound.get(rental);
}
