// A stat award never creates another action.
import { supportItemOperation } from './hif-support-operations.mjs';
import { physicalSupportLinks } from './hif-support-operation-network.mjs';
const zero = () => ({ vocal: 0, dance: 0, visual: 0 });
const axes = ['vocal', 'dance', 'visual'];
const skillReceipt = kind => kind === 'skill_acquire' || kind === 'a_skill_acquire' || kind === 'm_skill_acquire'
  || kind.endsWith('_card_acquire');

function itemAction(trigger) {
  const keyword = ({ preservation: 'reserve', fullPower: 'full_power', goodConditionTurns: 'good_condition',
    goodImpressionTurns: 'good_impression' })[trigger?.keyword] ?? trigger?.keyword;
  if (keyword && ['keyword_card_acquire', 'keyword_card_enhance'].includes(trigger?.key))
    return keyword + (trigger.key === 'keyword_card_acquire' ? '_card_acquire' : '_card_enhance');
  return ({ skill_change: 'change', card_enhance: 'skill_enhance', skill_acquire: 'skill_acquire',
    card_acquire: 'skill_acquire', card_delete: 'delete', pdrink_acquire: 'p_drink_acquire' })[trigger?.key];
}

// The route evaluator checked acquisition and trigger-state conditions. It
// applied matching route actions already. These listeners consume only NEW
// support actions, with the same produce-wide limit across both stages.
export function itemResponse(item, peak,catalog,providerId,physicalTargets=false) {
  const kind = itemAction(item?.effect?.trigger);
  const delta = peak?.perActivation;
  const isSkill = kind === 'skill_acquire' || kind?.endsWith('_card_acquire');
  const eligible = isSkill ? peak?.supportReceiptEligibility ?? peak?.supportEventEligibility : peak?.supportEventEligibility;
  // A copied or item-awarded skill can arrive after the opening support
  // stories. Its actual week, not the opening receipt gate, decides eligibility.
  if (!kind || !delta || !(eligible?.selection || eligible?.final || physicalTargets&&Object.values(peak?.supportEligibilityByWeek??{}).some(Boolean))) return null;
  if (kind === 'p_drink_acquire' && delta.resources.pDrinkAcquisitions) return null;
  const operations=(delta.operations??[]).filter(op=>op.cardAction).map(op=>supportItemOperation(op,catalog,providerId));
  if (!axes.some(axis => delta.stats[axis]) && !Object.values(delta.resources).some(Boolean) && !operations.length) return null;
  return {
    kind, eligible, stats: delta.stats, resources: delta.resources, limit: item.effect.limit?.count ?? Infinity,
    routeCount: peak.total.activationCount, routeSelection: peak.byStage.selection.activationCount, operations,
    eligibleByWeek:peak.supportEligibilityByWeek, routeActivations:peak.eligibleRouteActions??peak.total.activations,
    selfCount: 0, selfSelection: 0,
  };
}

function additionalItemUses(response, selection, final) {
  const early = response.eligible.selection ? selection[response.kind] ?? 0 : 0;
  const late = response.eligible.final ? final[response.kind] ?? 0 : 0;
  const count = Math.min(response.limit, response.routeCount + early + late) - response.routeCount;
  const selectionCount = Math.min(response.limit, response.routeSelection + early) - response.routeSelection;
  return { count, selection: selectionCount, final: count - selectionCount };
}

export function ownItemUses(response, byStage) {
  if (!response) return null;
  const uses = additionalItemUses(response, byStage.selection, byStage.final);
  response.selfCount = uses.count;
  response.selfSelection = uses.selection;
  return uses;
}

function addCount(map, kind, count) {
  if (count) map[kind] = (map[kind] ?? 0) + count;
}

export function extraDeckSizeTriggers(peak, totalSkills, earlySkills) {
  const extra = { selection: 0, final: 0 };
  if (!Array.isArray(peak?.examDeckSizes) || !totalSkills) return extra;
  for (const [i, size] of peak.examDeckSizes.entries()) {
    if (!Number.isInteger(size) || size >= 15) continue;
    const beforeFinal = (peak.examStages?.[i] ?? (i < 3 ? 'selection' : 'final')) === 'selection';
    if (size + (beforeFinal ? earlySkills : totalSkills) >= 15) extra[beforeFinal ? 'selection' : 'final']++;
  }
  return extra;
}

// A class can change a nonstarter instead when a story uses its old target.
// It remains one class operation. Move displaced basic triggers from the final
// stage to selection only when all earlier flexible targets were reassigned.
export function allocateStoryChanges(peak, stories) {
  const free = peak ? peak.remainingBasicCards ?? 0 : stories;
  const flexible = peak?.reassignableBasicChanges ?? 0;
  const change = Math.min(stories, free + flexible);
  const basic = Math.min(change, free);
  const moved = Math.max(0, change - basic - (peak?.reassignableBasicChangesByStage?.selection ?? flexible));
  return { change, basic, earlyBasic: basic + moved };
}

// Compile the singleton on the same finite deck used by the combination.
// This makes a typed upgrade from one's own event part of the card itself.
export function resolveSoloSupport(card,peak) {
  if(!peak?.cardTargetPlan?.baseline)return;
  const data=physicalSupportLinks([card],peak,true);
  for(const e of card.dynamicEffects){
    const used=Math.min(e.maxCount,Math.max(0,e.routeCount+(data.provided[e.kind]??0)));
    const early=Math.min(used,Math.max(0,e.routeSelection+(data.selection[e.kind]??0)));
    const earlierGain=Math.floor(e.amount*early)-Math.floor(e.amount*e.usedCountByStage.selection);
    data.byStage.selection[e.axis]+=earlierGain;
    data.byStage.final[e.axis]+=Math.floor(e.amount*used)-Math.floor(e.amount*e.usedCount)-earlierGain;
    e.usedCount=used;e.usedCountByStage={selection:early,final:used-early};
  }
  for(const axis of axes){
    for(const stage of ['selection','final'])card.fixedStatsByStage[stage][axis]+=data.byStage[stage][axis];
    card.fixedStats[axis]+=data.byStage.selection[axis]+data.byStage.final[axis];
  }
  card.resources.pp+=data.resources.pp;card.resources.stamina+=data.resources.hpRecovery;
  if(card.itemResponse){card.itemResponse.selfCount=data.soloUses.count;card.itemResponse.selfSelection=data.soloUses.selection;}
  card.providedActions=data.provided;card.providedActionsByStage={selection:data.selection,final:data.final};
  if(card.resources.pDrinkAcquisitions!==undefined)card.resources.pDrinkAcquisitions=data.provided.p_drink_acquire??0;
}

export function deckSupportLinks(cards, peak, explain = false) {
  const physical=physicalSupportLinks(cards,peak,explain);
  if(physical){
    const byStage={selection:{...physical.byStage.selection},final:{...physical.byStage.final}};
    const links=explain?[...physical.links]:null;
    for(const card of cards)for(const effect of card.dynamicEffects??[]){
      const used=Math.min(effect.maxCount,Math.max(0,effect.routeCount+(physical.provided[effect.kind]??0)));
      const early=Math.min(used,Math.max(0,effect.routeSelection+(physical.selection[effect.kind]??0)));
      const oldEarly=effect.usedCountByStage.selection;
      const extra=Math.floor(effect.amount*used)-Math.floor(effect.amount*effect.usedCount);
      const extraEarly=Math.floor(effect.amount*early)-Math.floor(effect.amount*oldEarly);
      byStage.selection[effect.axis]+=extraEarly;byStage.final[effect.axis]+=extra-extraEarly;
      if(explain&&(extra||extraEarly))links.push({receiverId:card.gameId,kind:effect.kind,source:'ability',
        extraCount:used-effect.usedCount,extraCountByStage:{selection:early-oldEarly,final:used-effect.usedCount-early+oldEarly},
        axis:effect.axis,pointsBeforeCap:extra,producedDrinks:0,
        contributors:[...(physical.providers.get(effect.kind)??[])].filter(id=>id!==card.gameId).sort()});
    }
    return {provided:physical.provided,byStage,resources:physical.resources,links,
      ...(explain?{targetResolution:physical.targetResolution,operations:physical.operations,unresolved:physical.unresolved,examDeckSizes:physical.examDeckSizes,lessonDeckSizes:physical.lessonDeckSizes}:{})};
  }
  const provided = {}, selection = {}, final = {};
  const uniqueSkills = new Set();
  let changeStories = 0;
  const links = explain ? [] : null;
  const contributors = explain ? new Map() : null;
  const linkedDrinkProviders = explain ? new Set() : null;
  function recordProvider(kind, card) {
    if (!card.gameId) return;
    if (!contributors.has(kind)) contributors.set(kind, new Set());
    contributors.get(kind).add(card.gameId);
  }
  for (const card of cards) {
    changeStories += card.basicChangeStories ?? 0;
    const duplicate = card.providedSkillKey && uniqueSkills.has(card.providedSkillKey);
    for (const [kind, count] of Object.entries(card.providedActions ?? {})) {
      if (duplicate && skillReceipt(kind)) continue;
      if (card.basicChangeStories && (kind === 'change' || kind === 'basic_card_change')) {
        if (explain) recordProvider(kind, card);
        continue;
      }
      addCount(provided, kind, count);
      if (explain && count > 0) recordProvider(kind, card);
      const early = card.providedActionsByStage ? card.providedActionsByStage.selection[kind] ?? 0 : count;
      addCount(selection, kind, early);
      addCount(final, kind, count - early);
    }
    if (card.providedSkillKey) uniqueSkills.add(card.providedSkillKey);
  }
  if (changeStories) {
    const changes = allocateStoryChanges(peak, changeStories);
    addCount(provided, 'change', changes.change);
    addCount(selection, 'change', changes.change);
    addCount(provided, 'basic_card_change', changes.basic);
    addCount(selection, 'basic_card_change', changes.earlyBasic);
    addCount(final, 'basic_card_change', changes.basic - changes.earlyBasic);
  }
  if (peak?.examDeckSizes && provided.skill_acquire) {
    const exams = extraDeckSizeTriggers(peak, provided.skill_acquire, selection.skill_acquire ?? 0);
    addCount(provided, 'exam_15', exams.selection + exams.final);
    addCount(selection, 'exam_15', exams.selection);
    addCount(final, 'exam_15', exams.final);
  }
  const byStage = { selection: zero(), final: zero() };
  const resources = { hpRecovery: 0, pp: 0 };
  function recordLink(card, kind, extraCount, extraEarly, axis, pointsBeforeCap, source, producedDrinks = 0) {
    const providerKind = kind === 'exam_15' ? 'skill_acquire' : kind;
    const ids = [...(contributors.get(providerKind) ?? [])].filter(id =>
      id !== card.gameId || (kind === 'p_drink_acquire' && linkedDrinkProviders.has(id)));
    links.push({ receiverId: card.gameId ?? null, kind, source, extraCount, axis, pointsBeforeCap, producedDrinks,
      extraCountByStage: { selection: extraEarly, final: extraCount - extraEarly },
      contributors: ids.sort() });
  }
  function respond(card) {
    const response = card.itemResponse;
    const uses = additionalItemUses(response, selection, final);
    const extra = uses.count - response.selfCount;
    const early = uses.selection - response.selfSelection;
    for (const axis of axes) {
      byStage.selection[axis] += early * response.stats[axis];
      byStage.final[axis] += (extra - early) * response.stats[axis];
      if (explain && response.stats[axis] && (extra || early))
        recordLink(card, response.kind, extra, early, axis, extra * response.stats[axis], 'item');
    }
    resources.hpRecovery += extra * response.resources.hpRecovery;
    resources.pp += extra * response.resources.pp;
    const bottles = response.resources.pDrinkAcquisitions;
    addCount(provided, 'p_drink_acquire', extra * bottles);
    addCount(selection, 'p_drink_acquire', early * bottles);
    addCount(final, 'p_drink_acquire', (extra - early) * bottles);
    if (explain && bottles && (extra || early)) {
      recordLink(card, response.kind, extra, early, null, 0, 'item', extra * bottles);
      linkedDrinkProviders.add(card.gameId);
      recordProvider('p_drink_acquire', card);
    }
  }
  for (const card of cards)
    if (card.itemResponse && card.itemResponse.kind !== 'p_drink_acquire') respond(card);
  for (const card of cards) {
    if (card.itemResponse?.kind === 'p_drink_acquire') respond(card);
    for (const effect of card.dynamicEffects ?? []) {
      const supplied = provided[effect.kind] ?? 0;
      const earlySupplied = selection[effect.kind] ?? 0;
      const routeCount = effect.routeCount ?? effect.usedCount - (card.providedActions?.[effect.kind] ?? 0);
      const soloEarly = effect.usedCountByStage?.selection ?? effect.usedCount;
      const routeEarly = effect.routeSelection ?? soloEarly - (card.providedActionsByStage?.selection[effect.kind] ?? 0);
      const limit = effect.maxCount ?? Infinity;
      const combined = Math.min(limit, Math.max(0, routeCount) + supplied);
      const early = Math.min(combined, Math.max(0, routeEarly) + earlySupplied);
      const extra = Math.floor(effect.amount * combined) - Math.floor(effect.amount * effect.usedCount);
      const extraEarly = Math.floor(effect.amount * early) - Math.floor(effect.amount * soloEarly);
      byStage.selection[effect.axis] += extraEarly;
      // May be negative when an earlier event uses the last shared charge.
      byStage.final[effect.axis] += extra - extraEarly;
      if (explain && (extra || extraEarly))
        recordLink(card, effect.kind, combined - effect.usedCount, early - soloEarly, effect.axis, extra, 'ability');
    }
  }
  return { provided, byStage, resources, links };
}
