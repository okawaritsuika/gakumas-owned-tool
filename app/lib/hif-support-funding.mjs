export function supportLessonPPAt(funding, row, base) {
  const rate=(funding?.lessonPPBonuses??[]).filter(b=>(!b.axis||b.axis===row.main)&&(!b.spOnly||row.isSpLesson!==false))
    .reduce((sum,b)=>sum+b.permil,0);
  return Math.floor(base*rate/1000);
}

/** A shopping budget belongs to these exact support copies and levels. Raw
 * progress PP includes conditional item gains, which cannot fund themselves. */
export function deriveSupportFunding({result,catalog,options={}}) {
  if (!result?.scoreSummary?.hifModel?.supportPeakScenario || !catalog?.produceResources?.hif
    || options.supportActionMode==='declared' || options.eventModeId || options.hifMode && options.hifMode!=='normal') return null;
  const cards=[...(result.supports?.owned??[]),result.supports?.rental].filter(Boolean);
  const funding={providerIds:[],providers:[],initialPP:{selection:0,final:0},ppByWeek:{},lessonPPBonuses:[],drinkDiscountPermil:0};
  for(const card of cards){
    const resource=card.resources;
    if(!resource || !card.gameId || !Number.isInteger(card.level)) continue;
    const fixed=Object.entries(resource.ppByWeek??{}).filter(([week,n])=>Number.isInteger(Number(week))&&Number(week)>=0&&Number.isInteger(n)&&n>0);
    const lesson=(resource.lessonPPBonuses??[]).filter(b=>(b.axis==null||['vocal','dance','visual'].includes(b.axis))
      && Number.isInteger(b.permil)&&b.permil>0);
    const discount=Number.isInteger(resource.drinkDiscountPermil)&&resource.drinkDiscountPermil>0&&resource.drinkDiscountPermil<=1000?resource.drinkDiscountPermil:0;
    if(!fixed.length&&!lesson.length&&!discount) continue;
    funding.providers.push({gameId:card.gameId,level:card.level,rental:card.rental===true});
    funding.providerIds.push(card.gameId);
    for(const [week,amount] of fixed){
      if(Number(week)===0) funding.initialPP.selection+=amount;
      else funding.ppByWeek[week]=(funding.ppByWeek[week]??0)+amount;
    }
    funding.lessonPPBonuses.push(...lesson);
    // Overlap of several price modifiers has no verified universal stacking
    // order. The best individual reduction is realizable in that same menu.
    funding.drinkDiscountPermil=Math.max(funding.drinkDiscountPermil,discount);
  }
  return funding.providers.length?funding:null;
}
