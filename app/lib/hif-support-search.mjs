// Shortlist combinations by the actions one support can supply to another.
// Link values only seed the search. The deck evaluator applies the actual
// conditions, shared charges, rounding and stage caps for every comparison.
import { possibleCardOperationTriggers } from './hif-card-targets.mjs';
import { cardHoldingKeywords } from './produce-action-counts.mjs';

// Rental and owned versions of a card share an identity. A greedy draft is
// usually sufficient; if two axes compete for an identity, augmenting paths
// assign the remaining slots using every eligible owned copy.
export function completeRentalDeck(pool, rental, quotas, mixed, axisOf, identityOf, first = null) {
  const slots = [], counts = {}, used = new Set([identityOf(rental)]);
  const occupied = [rental];
  if (first) {
    if (used.has(identityOf(first)) || !quotas[axisOf(first)]) return [];
    occupied.push(first);
    used.add(identityOf(first));
  }
  for (const card of occupied) counts[axisOf(card)] = (counts[axisOf(card)] ?? 0) + 1;
  if (Object.keys(counts).some(axis => counts[axis] > (quotas[axis] ?? 0))) return [];
  const wanted = 6 - occupied.length;
  const available = pool.filter(card => !used.has(identityOf(card)) && (quotas[axisOf(card)] ?? 0) > (counts[axisOf(card)] ?? 0));
  const greedy = [];
  if (mixed && occupied.every(card => axisOf(card) === axisOf(rental))) {
    const other = available.find(card => axisOf(card) !== axisOf(rental));
    if (!other) return [];
    greedy.push(other);
    used.add(identityOf(other));
    counts[axisOf(other)] = (counts[axisOf(other)] ?? 0) + 1;
  }
  for (const card of available) {
    if (greedy.length === wanted) break;
    const axis = axisOf(card);
    if (used.has(identityOf(card)) || (counts[axis] ?? 0) >= quotas[axis]) continue;
    greedy.push(card);
    used.add(identityOf(card));
    counts[axis] = (counts[axis] ?? 0) + 1;
  }
  const prefix = first ? [first] : [];
  if (greedy.length === wanted || mixed) return [...prefix, ...greedy];
  for (const [axis, quota] of Object.entries(quotas))
    for (let i = occupied.filter(card => axisOf(card) === axis).length; i < quota; i++) slots.push(axis);
  const assigned = [], slotByIdentity = new Map();
  function fill(slot, visited) {
    for (const card of available) {
      const identity = identityOf(card);
      if (axisOf(card) !== slots[slot] || visited.has(identity)) continue;
      visited.add(identity);
      if (!slotByIdentity.has(identity) || fill(slotByIdentity.get(identity), visited)) {
        slotByIdentity.set(identity, slot);
        assigned[slot] = card;
        return true;
      }
    }
    return false;
  }
  for (let slot = 0; slot < slots.length; slot++) fill(slot, new Set());
  return [...prefix, ...assigned.filter(Boolean)];
}

function operationFamilies(operations) {
  const amounts = new Map();
  for (const op of operations ?? [])
    for (const key of new Set(possibleCardOperationTriggers(op))) amounts.set(key,(amounts.get(key)??0)+(op.quantity??1));
  return amounts;
}

export function groupSupportEffects(cards, peak) {
  const examDeckSizes = Array.isArray(peak) ? peak : peak?.examDeckSizes;
  const plan = peak?.cardTargetPlan, baseline = plan?.baseline;
  const sizeProviders = [];
  const copyHoldings = new Map();
  const cardDefinitions = plan ? [...plan.start, ...plan.ops.map(op => op.card),
    ...cards.flatMap(card => (card.supportOperations ?? []).map(op => op.card))].filter(card => card?.gameId && card.noDeckDuplication === false) : [];
  const groups = new Map();
  function group(kind) {
    if (!groups.has(kind)) groups.set(kind, { providers: [], receivers: [] });
    return groups.get(kind);
  }
  for (const card of cards) {
    const supplied=operationFamilies(card.supportOperations);
    for (const [kind,count] of Object.entries(card.providedActions??{}))
      supplied.set(kind,Math.max(count,supplied.get(kind)??0));
    const sizeOperations = (card.supportOperations ?? []).filter(op => op.action === 'acquire' || op.action === 'copy');
    const sizeGain = Math.max(sizeOperations.reduce((sum,op) => sum+(op.quantity??1),0),card.providedActions?.skill_acquire??0);
    if (sizeGain > 0) sizeProviders.push({card,count:sizeGain});
    for (const op of sizeOperations.filter(op => op.action === 'copy')) {
      const possible = cardDefinitions.filter(target => (!op.gameId || op.gameId === target.gameId)
        && (!op.rarity || op.rarity.toUpperCase() === target.rarity) && (!['active','mental','trouble'].includes(op.target) || target.type === op.target));
      for (const key of new Set(possible.flatMap(target => target.keywords ?? []))) {
        if (!copyHoldings.has(key)) copyHoldings.set(key,new Map());
        const entries = copyHoldings.get(key);
        entries.set(card,(entries.get(card) ?? 0) + (op.quantity ?? 1));
      }
    }
    for (const [kind, count] of supplied) {
      if (count > 0) group(kind).providers.push({ card, count });
    }
    for (const effect of card.dynamicEffects ?? []) {
      const remaining = (effect.maxCount ?? Infinity) - effect.usedCount;
      if (remaining > 0 && effect.amount > 0) {
        group(effect.kind).receivers.push({ card, remaining, points: effect.amount });
      }
    }
    const item = card.itemResponse;
    if (item) {
      const remaining = item.limit - item.routeCount - item.selfCount;
      const points = Object.values(item.stats).reduce((sum, amount) => sum + amount, 0);
      const outputs=operationFamilies(item.operations);
      if (item.resources.pDrinkAcquisitions) outputs.set('p_drink_acquire',item.resources.pDrinkAcquisitions);
      if (remaining > 0 && (points||outputs.size)) group(item.kind).receivers.push({ card, remaining, points, outputs });
    }
  }
  for (const [kind, limit, sizes] of [['exam_15',15,examDeckSizes],['sp_lesson_20',20,baseline?.lessonDeckSizes]]) {
    if (!groups.has(kind)) continue;
    const family = groups.get(kind);
    family.providers = sizeProviders;
    family.deficits = (sizes ?? []).filter(n => Number.isInteger(n) && n < limit).map(n => limit-n);
    if (!family.deficits.length) family.providers = [];
  }
  if (baseline) for (const keyword of cardHoldingKeywords) {
    const family = groups.get(keyword + '_card_acquire_8');
    if (!family) continue;
    const first = plan.start.filter(card => card.keywords?.includes(keyword)).length;
    const heldAtReceipt = baseline.actions.filter(action => action.triggerCounts.skill_acquire > 0)
      .map(action => action.keywordCardCountsAfter?.[keyword]).filter(Number.isInteger);
    if (Math.max(first,...heldAtReceipt) >= 8) {
      family.providers = groups.get('skill_acquire')?.providers ?? [];
    } else {
      // Only cards with this keyword can bridge the held-card deficit. A
      // different acquisition can trigger the reward after the threshold.
      const suppliers = new Map((groups.get(keyword + '_card_acquire')?.providers ?? []).map(row => [row.card,row.count]));
      for (const [card,count] of copyHoldings.get(keyword) ?? []) suppliers.set(card, Math.max(count,suppliers.get(card) ?? 0));
      family.providers = [...suppliers].map(([card,count]) => ({card,count}));
      family.deficits = [first,...heldAtReceipt].map(n => 8-n);
    }
  }
  else for (const keyword of cardHoldingKeywords) {
    const family = groups.get(keyword + '_card_acquire_8');
    if (family) family.providers = [];
  }
  return groups;
}

export function linkedSupportStarts(groups, allowed, fits, soloPoints) {
  const starts = [];
  const partners = new Set();
  const strongest = (rows, value, limit = 3) => {
    // Keep both current-level and lendable examples of each role. A max-level
    // rental at the top of one list cannot occupy the rental slot twice.
    const ranked = rows.filter(entry => allowed.has(entry.card)).sort((a, b) => value(b) - value(a)
      || soloPoints(b.card) - soloPoints(a.card) || a.card.gameId.localeCompare(b.card.gameId));
    const seen = new Set();
    const distinct = ranked.filter(entry => {
      if (seen.has(entry.card)) return false;
      seen.add(entry.card);
      return true;
    });
    return [...distinct.filter(entry => !entry.card.rental).slice(0, limit), ...distinct.filter(entry => entry.card.rental).slice(0, limit)];
  };
  const followers=new Map();
  function receiversFor(kind) {
    if (!followers.has(kind)) followers.set(kind,strongest(groups.get(kind)?.receivers??[],entry=>entry.points));
    return followers.get(kind);
  }
  for (const family of groups.values()) {
    if (!family.providers.length || !family.receivers.length) continue;
    const providers = strongest(family.providers, entry => entry.count, family.deficits ? 5 : 3);
    const receivers = strongest(family.receivers, entry => entry.points + Math.max(0,...Array.from(entry.outputs??[],
      ([kind,n])=>n*(receiversFor(kind)[0]?.points??0))));
    for (const entry of [...providers, ...receivers]) partners.add(entry.card);
    let best;
    function consider(cards, bonus) {
      if (bonus <= 0 || !fits(cards)) return;
      const solo = cards.reduce((sum, card) => sum + soloPoints(card), 0);
      if (!best || bonus > best.bonus || bonus === best.bonus && solo > best.solo) best = { cards, bonus, solo };
    }
    if (family.deficits) {
      // Fill only until another actual exam threshold can be reached. Try
      // either reserving the rental for later or using the largest provider.
      const byQuantity = [...providers].sort((a, b) => b.count - a.count || soloPoints(b.card) - soloPoints(a.card));
      for (const target of receivers) for (const order of [providers, byQuantity]) {
        const cards = [target.card], own = family.providers.find(row => row.card === target.card)?.count ?? 0;
        let receipts = own, rewarded = 0;
        for (const source of order) {
          if (!fits([...cards, source.card])) continue;
          cards.push(source.card);
          receipts += source.count;
          const crossed = Math.min(target.remaining, family.deficits.filter(needed => own < needed && needed <= receipts).length);
          if (crossed > rewarded) consider([...cards], crossed * target.points);
          rewarded = crossed;
          if (crossed >= target.remaining || receipts >= Math.max(...family.deficits)) break;
        }
      }
    } else for (const source of providers) for (const target of receivers) {
      const count = Math.min(source.count, target.remaining);
      const pair = [source.card, target.card];
      consider(pair, count * target.points);
      for (const [kind,n] of target.outputs??[]) for (const listener of receiversFor(kind)) {
        const cards = pair.includes(listener.card) ? pair : [...pair, listener.card];
        consider(cards, count * target.points + Math.min(count * n, listener.remaining) * listener.points);
      }
    }
    if (best) starts.push(best);
  }
  const keyOf = cards => cards.map(card => card.gameId + (card.rental ? '/r' : '/o')).sort().join('|');
  starts.sort((a, b) => b.bonus - a.bonus || b.solo - a.solo || keyOf(a.cards).localeCompare(keyOf(b.cards)));
  const seen = new Set();
  const distinct = starts.filter(({ cards }) => {
    const key = keyOf(cards);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4).map(entry => entry.cards);
  return { starts: distinct, partners };
}
