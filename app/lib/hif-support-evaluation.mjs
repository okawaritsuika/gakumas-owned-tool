// Coefficients in the public normal-HIF produce rating reference. Only the
// modeled stat and badge terms are usable for comparing support choices.
export const HIF_STAT_POINTS = 2;
export const HIF_STAR_POINTS = 7.5;

export function buildSupportRatingContext(catalog, route, options) {
  if (!options.supportPeakScenario || options.finalStar != null || options.goal === 'memory'
    || options.objective === 'memory_farming' || (options.objective === 'stats' && options.goal !== 'evaluation')) return null;

  const rule = catalog.produceResources?.hif?.star;
  const routeReceipts = route.counts?.skill_acquire;
  if (!Number.isInteger(routeReceipts) || routeReceipts < 0
    || !Number.isInteger(rule?.cardAcquisitionCap) || rule.cardAcquisitionCap <= 0
    || !Number.isFinite(rule.cardAcquisitionBase) || rule.cardAcquisitionBase <= 0) return null;

  return { routeReceipts, activationCap: rule.cardAcquisitionCap, baseStarPerReceipt: rule.cardAcquisitionBase };
}

/** One shared badge across selection and final. Only acquisitions trigger it.
 * The route owns non-support receipts, the deck evaluator owns support grants. */
export function partialSupportRating(statSum, suppliedAcquisitions, context) {
  const statPoints = statSum * HIF_STAT_POINTS;
  if (!context) return statPoints;
  const count = Math.min(context.activationCap, context.routeReceipts + suppliedAcquisitions);
  return statPoints + count * context.baseStarPerReceipt * HIF_STAR_POINTS;
}
