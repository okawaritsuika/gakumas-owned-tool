import {deriveSupportFunding} from './hif-support-funding.mjs';
import {applyPeakExamDeckCounts} from './hif-support-actions.mjs';
import {buildHifRoute,evaluateHifDeck} from './hif-model.mjs';
import {buildSupportRatingContext} from './hif-support-evaluation.mjs';
import {planScenarioDrinks} from './hif-peak-state.mjs';

const members = entry => [...entry.owned,...(entry.rental ? [entry.rental] : [])];

function policyContext(entry, options, catalog) {
  const input = entry.fundingInputs;
  const initialRoute = buildHifRoute(catalog,entry.primary,options);
  const route = applyPeakExamDeckCounts(initialRoute,entry.memories,{...options,catalog,supportPeakStatContext:input.context});
  return {context:{...input.context,route},ratingContext:buildSupportRatingContext(catalog,route,options),
    supportOptions:{...input.supportOptions,hifScenarioItemPath:options.hifScenarioItemPath,hifConsultPlan:options.hifConsultPlan,
      supportPeakFunding:options.supportPeakFunding,produceActions:route.produceActions}};
}

/** Budget changes can make a low solo stat card relevant. Keep at most one
 * legal owned/rental substitution for each kind of verified funding. These
 * amounts only select challengers; PP and discounts never become points. */
export function fundingSwaps(entry, axisOf, identityOf, pinnedRental) {
  const current=members(entry), inputs=entry.fundingInputs;
  const best=[null,null,null];
  for(const [slot,old] of current.entries()) {
    if(old.rental && pinnedRental) continue;
    for(const row of old.rental?inputs.rentals:inputs.ownedById.values()) {
      if(axisOf(row)!==axisOf(old) || current.some(card=>identityOf(card)===identityOf(row))) continue;
      const resources=row.resources;
      const amounts=[Object.values(resources.ppByWeek??{}).reduce((n,v)=>n+v,0),
        (resources.lessonPPBonuses??[]).reduce((n,v)=>n+v.permil,0),resources.drinkDiscountPermil??0];
      for(const [index,amount] of amounts.entries()) {
        if(!(amount>0)) continue;
        const soloDifference=row.score-old.score, previous=best[index];
        if(!previous || amount>previous.amount || amount===previous.amount && (soloDifference>previous.soloDifference
          || soloDifference===previous.soloDifference && row.gameId<previous.row.gameId))
          best[index]={row,slot,amount,soloDifference};
      }
    }
  }
  const seen=new Set();
  return best.filter(change=>{
    if(!change)return false;
    const key=change.slot+'|'+change.row.gameId;
    if(seen.has(key))return false;
    seen.add(key);return true;
  }).map(({slot,row})=>current.map((card,i)=>i===slot?row:card));
}

/** Rebuild the *same* layout, route and memory selection for this exact set
 * of levels. A support removed from the set can no longer pay for a visit. */
export function replayFundedDeck(entry,chosen,{catalog,rescore,rank,prefer}) {
  const input=entry.fundingInputs;
  // Always restart at the unfunded profiles, including when the caller is
  // comparing a removal from a winner that already has extra purchases.
  const cards=chosen.map(row=>row.rental?input.rentals.find(r=>r.gameId===row.gameId):input.ownedById.get(row.gameId));
  const shape=rows=>({owned:rows.filter(row=>!row.rental),rental:rows.find(row=>row.rental)??null});
  const candidate=(rows,context,ratingContext)=>{
    const result=evaluateHifDeck(rows,{...context,searchOnly:true});
    return {...entry,...shape(rows),length:rows.length,context,route:context.route,ratingContext,
      key:rows.map(card=>card.gameId+(card.rental?'/r':'')).sort().join('|'),
      evaluation:rank(rows,result,context,ratingContext,input.groups,input.usedAxes)};
  };
  const plain=candidate(cards,input.context,input.ratingContext);
  if (!input.context.route.supportPeakScenario || input.context.route.supportPeakScenario.consultPlan==='none') return plain;
  const supportPeakFunding=deriveSupportFunding({catalog,options:input.routeOptions,
    result:{supports:shape(cards),scoreSummary:{hifModel:{supportPeakScenario:true}}}});
  if(!supportPeakFunding)return plain;
  // Each input belongs to one request, lesson schedule and memory selection.
  // Preserve the actual PP providers, their levels, dated grants and discounts.
  const cache = input.fundedRoutes ??= new Map();
  const key = JSON.stringify(supportPeakFunding);
  if (!cache.has(key)) cache.set(key,{...policyContext(entry,{...input.routeOptions,supportPeakFunding},catalog),profiles:new Map()});
  const priced = cache.get(key);
  const updated = cards.map(row => {
    if (!priced.profiles.has(row)) priced.profiles.set(row,rescore(row,priced.context.route,priced.supportOptions));
    return priced.profiles.get(row);
  });
  const financed=candidate(updated,priced.context,priced.ratingContext);
  return prefer(financed,plain)<=0 ? financed : plain;
}

/** Compare real route operations for the selected six supports and their four
 * memories. Policy changes can alter payment dates and physical targets. */
export function bestFixedDeckPolicy(entry, tools, policies) {
  const original = entry.fundingInputs, cards = members(entry);
  const current = entry.route.supportPeakScenario;
  let best = entry, policy = null, replayed = 0;
  for (const hifConsultPlan of policies.shops) {
    const settings = {...original.routeOptions,hifConsultPlan,supportPeakFunding:null};
    const calendar = buildHifRoute(tools.catalog,entry.primary,{...settings,hifScenarioItemPath:'none'});
    const incumbent = hifConsultPlan === current.consultPlan ? current.scenarioItem?.id : null;
    const paths = incumbent && policies.paths.includes(incumbent) ? [incumbent,...policies.paths.filter(id=>id!==incumbent)] : policies.paths;
    const seen = new Set();
    for (const hifScenarioItemPath of paths) {
      const next = {hifConsultPlan,hifScenarioItemPath};
      const routeOptions = {...settings,hifScenarioItemPath};
      const ops = [];
      planScenarioDrinks(calendar,tools.catalog.produceResources.hif,settings.supportPeakPlan,routeOptions,[],ops);
      // Keep form, timing, targets and every effect field. A different path
      // label alone cannot change a deck when its other forms never trigger.
      const signature = JSON.stringify(ops,(k,v)=>k==='scenarioItemPath'?undefined:v);
      if (seen.has(signature)) continue;
      seen.add(signature);
      if (hifScenarioItemPath === incumbent) continue;
      const {context,ratingContext,supportOptions} = policyContext(entry,routeOptions,tools.catalog);
      const updated = cards.map(card => tools.rescore(card,context.route,supportOptions));
      const fundingInputs = {routeOptions,supportOptions,context,ratingContext,groups:original.groups,usedAxes:original.usedAxes,
        ownedById:new Map(updated.filter(card=>!card.rental).map(card=>[card.gameId,card])),rentals:updated.filter(card=>card.rental)};
      const candidate = replayFundedDeck({...entry,fundingInputs},updated,tools);
      replayed++;
      // The same six cards can have different search-lane ID strings.
      if (tools.prefer({...candidate,key:best.key},best)<0) { best=candidate;policy=next; }
    }
  }
  return {policy,compared:policies.shops.length*policies.paths.length,replayed,points:best.evaluation.partialEvaluationPoints};
}
