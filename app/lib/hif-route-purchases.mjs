import { supportLessonPPAt } from './hif-support-funding.mjs';

const list = value => Array.isArray(value) ? value : [];
const venueOf = value => ({activity_supply:'supply_gift',activity_supply_gift:'supply_gift',consultation:'consult'}[value] ?? value);
const paidActions = ['acquire','drink_acquire','drink_exchange','upgrade','remove','customize','refresh'];
const customizationPrices = new WeakMap();
function nativeCustomPrices(data) {
  const prices=data.cardCustomizations?.prices;
  if (!prices) return [];
  if (!customizationPrices.has(prices)) customizationPrices.set(prices,
    [...new Set(Object.values(prices).flat().filter(n=>Number.isInteger(n)&&n>0))].sort((a,b)=>a-b));
  return customizationPrices.get(prices);
}

/** One PP use plan per route. Only visits actually on the calendar can
 * supply a purchase, using resources already earned in this produce split. */
export function planHifPurchases(route, data, explicit, generated, options, settled = new Map()) {
  const plan = !options.hifConsultPlan || options.hifConsultPlan==='auto'
    ? (route.activityFocus==='consult'?'drinks':'none') : options.hifConsultPlan;
  const purchases = [];
  if (!['drinks','skills','ssr','upgrade','remove','customize','none'].includes(plan)) throw new RangeError('Unsupported hifConsultPlan');
  if (plan==='none') return {plan,purchases};
  const funding=options.supportPeakFunding;
  let uses=0;
  for (const stage of ['selection','final']) {
    const rows=route.selections.filter(row=>row.stage===stage);
    const reserved=explicit.some(a => {
      const when=a.stage ?? (Number.isInteger(a.fromExamIndex)?a.fromExamIndex>=3?'final':'selection':null);
      return (!when || stage===when) && (a.ppCost>0 || a.cost?.pp>0 || a.action==='drink_exchange'
        || ['consult','interval','special_training'].includes(venueOf(a.venue)) && paidActions.includes(a.action));
    });
    if (reserved) continue;
    const setting=data.settings?.[stage==='selection'?'p_setting-7':'p_setting-8'];
    const initial=typeof options.initialPP==='object'?options.initialPP?.[stage]:stage==='selection'?options.initialPP:null;
    const bonus=options.supportPeakInitialPPGrants?.[stage];
    let balance=Number.isFinite(initial)?initial:(setting?.initialProducePoint??0)+(Number.isFinite(bonus)?bonus:0)+(funding?.initialPP?.[stage]??0);
    let spent=0;
    const firstWeek=rows[0]?.week;
    const priorStory=[...Object.entries(funding?.ppByWeek??{}).map(([week,pp])=>({week:Number(week),pp})),
      ...explicit.filter(a=>a.action==='pp_gain'&&(!a.stage||a.stage===stage)).map(a=>({week:a.week,pp:a.amount}))]
      .filter(entry=>entry.week>=firstWeek && Number.isInteger(entry.pp)&&entry.pp>0).sort((a,b)=>a.week-b.week);
    balance-=rows.filter(row=>row.activity==='outing').reduce((n,row)=>n+(list(data.outing?.choices).find(c=>c.id===row.choiceId)?.ppCost??0),0);
    for (const row of rows) {
      while(priorStory.length&&priorStory[0].week<row.week) balance+=priorStory.shift().pp;
      if (row.main) {
        const base=data.publicLessonPP?.[stage]??0;
        balance+=base+supportLessonPPAt(funding,row,base);
      }
      const venue=venueOf(row.activity);
      if (venue==='supply_gift') balance+=data.gift?.pp??0;
      const effects=generated.filter(a=>a.basis==='conditional_hif_scenario_item' && a.week===row.week);
      balance+=effects.filter(a=>a.action==='pp_gain').reduce((n,a)=>n+a.amount,0);
      if (!(balance>0)) continue;
      const pointBudget=balance;
      let kind,unit,limit=1,extras={};
      if (venue==='consult') {
        if (plan==='drinks') {
          kind='drink_exchange';unit=data.consult.drinkPrices.R;limit=data.consult.retryDrinkPlan?.ordinaryOffers??0;
          extras={rarity:'R'};
        } else if (plan==='skills'||plan==='ssr') {
          const rarity=plan==='ssr'?'SSR':'SR';
          kind='acquire';unit=data.consult.cardPrices[rarity]?.[0];
          // A single specified-rarity offer per visit doesn't require several
          // copies of a particular skill or an unverified entire shop pool.
          extras={rarity,upgradeCount:0,selectableReward:true};
        } else if (plan==='upgrade'||plan==='remove') {
          const gate=plan==='upgrade'?data.consult.enhanceUnlockPLv:data.consult.deleteUnlockPLv;
          if (!Number.isInteger(options.producerLevel)||options.producerLevel<gate) continue;
          kind=plan;unit=data.consult.enhanceDeletePrices[uses]?.max;
          extras={target:'any',...(kind==='remove'?{allowTroubleTarget:true}:{}),purchaseIndex:uses+1,purchasePrices:data.consult.enhanceDeletePrices};
        }
      } else if (venue==='interval' && plan!=='customize') {
        // The final interval has a separate menu and fresh upgrade price.
        // Purchase opportunities are for the second round only.
        if (plan==='skills'||plan==='ssr') {
          const rarity=plan==='skills'?'SR':'SSR',upgradeCount=plan==='skills'?1:0;
          if (!(data.interval.offerSlots?.cards>0)) continue;
          kind='acquire';unit=data.interval.cardPrices[rarity]?.[upgradeCount];
          extras={rarity,upgradeCount,selectableReward:true};
        } else if (plan==='drinks') {
          kind='drink_acquire';unit=data.interval.drinkPrices.R;limit=data.interval.offerSlots?.drinks??0;
          if (!limit) continue;
          const otherPrice=Math.max(...Object.values(data.interval.drinkPrices));
          // A single R may be offered. The other slot has no documented fixed
          // rarity; reserve enough for any of the native R/SR/SSR prices.
          if (limit>=2 && balance>=unit+otherPrice) {
            limit=2;extras={reservedPPCost:unit+otherPrice,ppCostRange:{min:2*unit,max:unit+otherPrice}};
          } else {limit=1;extras={rarity:'R'};}
        } else if (plan==='upgrade') {
          if (!Number.isInteger(options.producerLevel)||options.producerLevel<data.consult.enhanceUnlockPLv) continue;
          kind='upgrade';unit=data.interval.upgradeInitialPrice;limit=setting?.stepIntervalUpgradeProduceCardCount??0;
          extras={target:'any',purchaseIndex:1};
        }
      } else if (plan==='customize' && ['special_training','interval'].includes(venue)) {
        // Resolve against an upgraded card, its current customizations and its
        // next native PP price after the carried cards have been selected.
        kind='customize';
        const prices=nativeCustomPrices(data);
        if (!prices.length || prices[0]>balance) continue;
        unit=prices[0];
        limit=venue==='interval'?setting?.stepIntervalCustomizeProduceCardCount:setting?.customizeProduceCardCount;
        if (!(limit>0))continue;
        extras={target:'any',maxPPCost:Math.min(balance,prices.at(-1)*limit),requiresPricedTarget:true};
      }
      if (!kind || !Number.isFinite(unit) || unit<=0) continue;
      const itemDiscount=venue==='consult'?effects.find(a=>a.action==='shop_discount'&&a.category===kind)?.amount??0:0;
      const discount=Math.max(itemDiscount,venue==='consult'&&kind==='drink_exchange'?funding?.drinkDiscountPermil??0:0);
      const price=Math.floor(unit*(1000-discount)/1000);
      const count=Math.min(limit,Math.floor(balance/price));
      if (!count) continue;
      const ppCost=extras.reservedPPCost??extras.maxPPCost??count*price;
      const sourceIds=venue==='consult'?[...data.consult.sourceIds,...(kind==='drink_exchange'?data.consult.retryDrinkPlan.sourceIds:[])]
        : kind==='customize'?['native-customization','native-hif-card-custom-targets',...data.interval.sourceIds]:data.interval.sourceIds;
      const action={id:`peak:${row.week}:${kind}`,action:kind,quantity:count,week:row.week,stage,fromExamIndex:row.fromExamIndex,
        venue,ppCost,routeBudgetPP:balance+spent,discountPermil:discount,...extras,sourceIds,basis:'conditional_retry_route_purchase',actualAcquisitionConfirmed:false};
      generated.push(action);
      purchases.push({id:action.id,action:kind,count,ppCost,week:row.week,stage,venue,availablePP:pointBudget,
        ...(discount?{discountPermil:discount}:{}),...(action.maxPPCost?{maxPPCost:action.maxPPCost}:{}),
        ...(action.ppCostRange?{ppCostRange:action.ppCostRange}:{}),...(action.rarity?{rarity:action.rarity,upgradeCount:action.upgradeCount}:{} )});
      // A prior chronological target replay reports the actual next native
      // price or a failed target. Later visits retain the unused currency.
      const actual = settled.get(action.id);
      const charge=actual == null ? ppCost : Math.min(ppCost,actual);
      balance-=charge;
      spent+=charge;
      if (venue==='consult'&&(kind==='upgrade'||kind==='remove') && actual!==0) uses+=count;
    }
  }
  return {plan,purchases};
}
