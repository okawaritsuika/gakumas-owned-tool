import { buildHifRoute } from './hif-model.mjs';
import { buildCardTargetPlan, resolveCardTargets } from './hif-card-targets.mjs';
import { isScenarioOperation, planScenarioDrinks } from './hif-peak-state.mjs';
import { planHifPurchases } from './hif-route-purchases.mjs';
import { HIF_STAR_POINTS, HIF_STAT_POINTS } from './hif-support-evaluation.mjs';

const auto = value => value == null || value === 'auto';
const isPaid = action => action.basis === 'conditional_retry_route_purchase';
const compatible = (value, plan) => !value || value === 'free' || value === plan;
const selectedId = row => row?.gameId ?? row?.supportCardId ?? row?.id;
const shopPlans = ['none','drinks','skills','ssr','upgrade','remove','customize'];
const triggerKind = {card_enhance:'skill_enhance', skill_change:'change', outing_end:'outing',
  activity_supply_gift_selection:'activity_supply_gift', consult_selection:'consult', special_training_start:'special_training'};

function responses(card, level, plan, options) {
  const latest = new Map(), rules = [];
  for (const ability of card.levelAbilities ?? []) {
    if (ability.level <= level && (!latest.has(ability.order) || ability.level >= latest.get(ability.order).level)) latest.set(ability.order, ability);
  }
  for (const ability of latest.values()) {
    if (!compatible(ability.plan, plan) || ability.scenarioEnum && !/Unknown|HatsuboshiIdolFestival/.test(ability.scenarioEnum)
      || ability.splitEnum && !/_Unknown$/.test(ability.splitEnum) && ability.splitEnum !== options.splitType) continue;
    for (const effect of ability.effects ?? []) if (/^ProduceEffectType_(Vocal|Dance|Visual)Addition$/.test(effect.type)
      && Number.isFinite(effect.min) && effect.min === effect.max && effect.min > 0) {
      rules.push({kind:ability.kind, amount:effect.min, limit:ability.activationLimit > 0 ? ability.activationLimit : Infinity});
    }
  }
  const item = card.p_item?.effect, story = card.events?.find(event => event.effect_type === 'p_item');
  const releaseLevel = Number(String(story?.release).match(/^lv(\d+)$/)?.[1] ?? 0);
  if (story && releaseLevel <= level && options.includeSupportEvents !== false && !item?.restriction
    && (!item?.limit || item.limit.key === 'per_produce') && !options.supportItemAcquisitions?.[card.gameId]) {
    const trigger = item?.trigger, suffix = trigger?.key === 'keyword_card_enhance' ? 'enhance' : trigger?.key === 'keyword_card_acquire' ? 'acquire' : null;
    const kind = suffix && trigger.keyword ? `${trigger.keyword}_card_${suffix}` : triggerKind[trigger?.key];
    if (kind) for (const effect of item.body ?? []) if (effect.key?.startsWith('param_up') && effect.value > 0) {
      rules.push({kind,amount:effect.value,limit:item.limit?.count ?? Infinity});
    }
  }
  return rules;
}

function triggerResponses(catalog, inventory, result, plan, options) {
  const selected = new Map([...(result.supports?.owned ?? []), result.supports?.rental].filter(Boolean).map(row => [selectedId(row), row.level]));
  const owned = new Map((inventory.supportCards ?? []).map(original => {
    const row = {...original.raw,...original}; return [selectedId(row),row];
  }));
  const guide = result.sourceGuideEvidence, allowed = guide?.mode === 'guide' ? new Set(guide.poolGameIds) : null;
  const active = [], alternatives = [];
  for (const card of catalog.supportCards ?? []) {
    if (!compatible(card.plan, plan) || allowed && !allowed.has(card.gameId) && card.gameId !== options.rentalGameId) continue;
    const inDeck = selected.has(card.gameId), record = owned.get(card.gameId);
    const cap = card.maxLevels?.[record?.uncap ?? record?.levelLimitRank];
    const ownLevel = Number.isInteger(cap) && Number.isInteger(record.level) && record.level <= cap && record.level > 0 ? record.level : 0;
    const rentalLevel = !options.rentalGameId || card.gameId === options.rentalGameId ? card.maxLevels?.[4] ?? 0 : 0;
    const level = inDeck ? selected.get(card.gameId) : Math.max(ownLevel,rentalLevel);
    if (!(level > 0)) continue;
    const rules = responses(card,level,plan,options);
    if (inDeck) active.push(...rules); else if (rules.length) alternatives.push(rules);
  }
  return {active,alternatives};
}

function roughCounts(base, operations) {
  const counts = {...base};
  const add = (key,n) => counts[key] = (counts[key] ?? 0) + n;
  for (const op of operations) {
    const n = op.quantity ?? 1;
    if (op.action === 'drink_acquire' || op.action === 'drink_exchange') add('p_drink_acquire',n);
    if (op.action === 'drink_exchange') add('p_drink_exchange',n);
    if (op.action === 'acquire' || op.action === 'copy' && op.countsAsAcquisition) {
      add('skill_acquire',n);
      if (op.rarity === 'SSR') add('ssr_card_acquire',n);
      if (op.action === 'acquire' && op.venue === 'consult') add('consult_skill_card_acquire',n);
    }
    const kind = {upgrade:'skill_enhance',remove:'delete',change:'change',customize:'customize',copy:'copy'}[op.action];
    if (kind) add(kind,n);
    // This is a candidate upper bound. The short list resolves actual cards.
    const suffix = {upgrade:'enhance',remove:'delete',copy:'acquire'}[op.action];
    if (suffix) for (const key of Object.keys(base)) {
      if (/^[am]_skill_|_card_/.test(key) && key.endsWith('_'+suffix) && key !== 'ssr_card_acquire') add(key,n);
    }
    if (op.action === 'change') add('basic_card_change',n);
  }
  return counts;
}

export function automaticHifPolicies(catalog, options, plan) {
  const data = catalog.produceResources?.hif, paths = data?.scenarioItemPaths?.paths;
  const manual = options.produceActions?.length || options.baseLessonGains || options.supportActionMode === 'declared'
    || ['activityChoices','expectedCounts','perAxisCounts','supportItemAcquisitions'].some(key=>Object.keys(options[key]??{}).length);
  if (!paths || manual || options.eventModeId || options.hifMode && options.hifMode !== 'normal'
    || !auto(options.hifConsultPlan) && !auto(options.hifScenarioItemPath) || !data.scenarioDrinkItem?.plans?.[plan]) return null;
  return {paths:auto(options.hifScenarioItemPath) ? [...Object.keys(paths),'none'] : [options.hifScenarioItemPath],
    shops:auto(options.hifConsultPlan) ? shopPlans : [options.hifConsultPlan]};
}

/** Rank menus on the selected focus, then check a few different action mixes
 * against the physical deck. The caller runs a full support search only for
 * the best alternate and compares it to the fully scored starting policy. */
export function chooseHifActionStrategy({catalog,options={},inventory={},result,focus}) {
  const model = result?.scoreSummary?.hifModel, peak = model?.supportActionPlan?.peakScenario;
  const data = catalog.produceResources?.hif;
  const plan = result.scoreSummary.plan ?? result.selectedIdol?.plan;
  const policies = automaticHifPolicies(catalog,options,plan);
  if (!peak || !policies) return null;
  const defaultPath = peak.scenarioItem?.id ?? 'yellow_robot_flower', defaultShop = peak.consultPlan ?? (focus === 'consult' ? 'drinks' : 'none');
  const {paths:pathIds,shops} = policies;
  const {active,alternatives} = triggerResponses(catalog,inventory,result,plan,options);
  const targetWeights = {};
  for (const rule of active) targetWeights[rule.kind] = (targetWeights[rule.kind] ?? 0) + rule.amount;
  for (const rules of alternatives) for (const rule of rules) targetWeights[rule.kind] = Math.max(targetWeights[rule.kind]??0,rule.amount);
  const star = data.star, useStar = options.finalStar == null && options.goal !== 'memory' && options.objective !== 'memory_farming'
    && (options.goal === 'evaluation' || options.objective !== 'stats') && star?.cardAcquisitionBase > 0;
  const value = (rules,counts) => rules.reduce((sum,rule) => sum + rule.amount*Math.min(rule.limit,counts[rule.kind]??0),0);
  const score = counts => {
    let replacement = 0;
    for (const rules of alternatives) replacement = Math.max(replacement,value(rules,counts));
    const badge = useStar ? Math.min(star.cardAcquisitionCap, (counts.skill_acquire??0)+(model.supportProvidedActions?.skill_acquire??0))*star.cardAcquisitionBase*HIF_STAR_POINTS : 0;
    return HIF_STAT_POINTS*(value(active,counts)+replacement)+badge;
  };
  const panels = inventory.hifBonuses?.status === 'current_account' ? inventory.hifBonuses : null;
  const parameters = {...options,supportPeakScenario:true,activityFocus:focus,supportPeakPlan:plan,hifSelectedIdol:result.selectedIdol,
    producerLevel:options.producerLevel??inventory.producerLevel,secondaryAttribute:model.secondaryAttribute,classAttribute:model.classAttribute,
    supportPeakInitialPPGrants:options.supportPeakInitialPPGrants??{selection:panels?.selection?.initialPP,final:panels?.finalOnly?.initialPP}};
  const routeCache = new Map(), mixes = new Map();
  let baseline, choicesConsidered=0;
  for (const shop of shops) {
    const calendar = shop === 'customize' ? 'customize' : 'none';
    if (!routeCache.has(calendar)) {
      const route = buildHifRoute(catalog,model.primaryAttribute??'vocal',{...parameters,hifScenarioItemPath:'none',hifConsultPlan:calendar});
      const inputs = [...(route.produceActions??[]).filter(a=>!isPaid(a)&&!isScenarioOperation(a)),
        ...(peak.cardTargetPlan?.ops??[]).filter(a=>a.venue==='memory')];
      const physical = buildCardTargetPlan(catalog,route,inputs,parameters);
      routeCache.set(calendar,{route,physical,counts:{...route.counts,...physical?.baseline?.counts}});
    }
    const context = routeCache.get(calendar);
    for (const path of pathIds) {
      const ops = [];
      planScenarioDrinks(context.route,data,plan,{...parameters,hifScenarioItemPath:path},[],ops);
      planHifPurchases(context.route,data,[],ops,{...parameters,hifConsultPlan:shop});
      const isDefault = path === defaultPath && shop === defaultShop;
      // Equivalent operation timelines (several paths trigger no selected
      // visits) need only one target replay and one representative policy.
      const key = calendar+'|'+ops.map(a=>[a.week,a.action,a.target,a.rarity,a.quantity,a.amount,a.resultRarity,a.ppCost].join('/')).join('|');
      const counts = roughCounts(context.counts, ops), entry = {context,ops,path,shop,rank:score(counts),isDefault,key};
      if (isDefault) baseline = entry;
      if (!mixes.has(key) || isDefault) mixes.set(key,entry);
      choicesConsidered++;
    }
  }
  if (!baseline) return null;
  const evaluate = row => {
    const resolved = resolveCardTargets(row.context.physical,row.ops,{weights:targetWeights});
    const realized = row.ops.filter(a=>['drink_acquire','drink_exchange'].includes(a.action) || !resolved && a.action==='acquire');
    return score({...roughCounts(row.context.counts,realized),...resolved?.counts});
  };
  const ordered = [...mixes.values()].sort((a,b)=>b.rank-a.rank || Number(b.isDefault)-Number(a.isDefault));
  // Different selectors (e.g. basic and non-trouble) can make equally large
  // nominal changes while only one has a compatible physical target.
  const candidates = new Set(ordered.slice(0,8));
  for (const shop of shops) { const first = ordered.find(row=>row.shop===shop); if(first)candidates.add(first); }
  let best=baseline, bestScore=evaluate(baseline);
  for (const row of candidates) {
    if (row.key===baseline.key) continue;
    const points = evaluate(row);
    if (points>bestScore) { best=row; bestScore=points; }
  }
  return best===baseline?null:{hifConsultPlan:best.shop,hifScenarioItemPath:best.path,choicesConsidered};
}
