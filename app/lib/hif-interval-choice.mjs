const isAmount=value=>Number.isSafeInteger(value)&&value>=0;
const isId=value=>typeof value==='string'&&value.trim().length>0;
const idList=value=>Array.isArray(value)&&value.every(isId);
const offerList=value=>Array.isArray(value)&&value.every(row=>(isId(row?.drinkId)!==isId(row?.cardId))&&isAmount(row.price));

function neededDrinks(desired,held){
  const remaining=[...desired];
  for(const id of held){
    const index=remaining.indexOf(id);
    if(index>=0) remaining.splice(index,1);
  }
  return remaining;
}

// For this many refreshes, the least expensive eligible copies maximize the desired item count.
// Pay all refresh fees up front in the calculation so the chronological purchases stay affordable.
function basket(input,needed,stock,refreshSpend,refreshCount,startingP=input.postR1P){
  const missingDrinkIds=[...needed],missingCardIds=[...(input.desiredCardIds??[])],purchases=[];
  let remainingP=startingP-refreshSpend,remainingSlots=input.freeSlots;
  for(const item of [...stock].sort((a,b)=>a.price-b.price)){
    if(item.price>remainingP) break;
    if(item.drinkId&&remainingSlots===0) continue;
    const missing=item.drinkId?missingDrinkIds:missingCardIds;
    const index=missing.indexOf(item.drinkId??item.cardId);
    if(index<0) continue;
    purchases.push(item);
    missing.splice(index,1);
    remainingP-=item.price;
    if(item.drinkId) remainingSlots--;
  }
  purchases.sort((a,b)=>a.page-b.page||a.offerIndex-b.offerIndex);
  return {purchases,refreshCount,refreshSpend,remainingP,remainingSlots,
    missingDrinkIds,missingCardIds,allDesired:!missingDrinkIds.length&&!missingCardIds.length};
}

const pageOffers=(offers,page)=>offers.map(({drinkId,cardId,price},offerIndex)=>({
  ...(isId(drinkId)?{drinkId}:{cardId}),price,page,offerIndex
}));
const itemLabel=row=>`${row.drinkId??('카드 '+row.cardId)}(${row.price}P)`;
const describePurchases=purchases=>purchases.map(itemLabel).join(', ');

export function recommendHifInterval(input={}){
  if(!isAmount(input?.postR1P)||!isAmount(input.freeSlots)||!idList(input.heldDrinkIds)||
    !idList(input.desiredDrinkIds)||!idList(input.desiredCardIds??[])||!offerList(input.offers)){
    return {status:'unconfirmed',summary:'인터벌 미확인 · R1 보상 반영 후의 실잔액, 보유 음료·빈칸, 원하는 상품과 현재 진열 가격을 확인하세요.',current:null,conditional:null};
  }
  const needed=neededDrinks(input.desiredDrinkIds,input.heldDrinkIds);
  const stock=pageOffers(input.offers,0);
  const current=basket(input,needed,stock,0,0);
  const summary=current.purchases.length
    ?`지금 구매 가능 · ${describePurchases(current.purchases)} · 구매 후 ${current.remainingP}P, 빈칸 ${current.remainingSlots}개`
    :!current.allDesired?'현재 진열·잔액·빈칸으로 구매할 수 있는 목표 상품이 없습니다.':'목표 수량을 이미 충족했습니다.';
  if(current.allDesired) return {status:'confirmed',summary,current,conditional:null};

  let best=current,fee=input.nextRefreshCost,refreshSpend=0;
  let minimumP=null;
  const considerFullBasket=(page,fees)=>{
    const full=basket(input,needed,stock,fees,page,Infinity);
    if(full.allDesired){
      const total=full.purchases.reduce((sum,item)=>sum+item.price,fees);
      minimumP=minimumP===null?total:Math.min(total,minimumP);
    }
  };
  considerFullBasket(0,0);
  const future=Array.isArray(input.futureShops)?input.futureShops:[];
  for(const [index,page] of future.entries()){
    if(!isAmount(fee)||!offerList(page?.offers)) break;
    refreshSpend+=fee;
    fee=page.nextRefreshCost;
    stock.push(...pageOffers(page.offers,index+1));
    considerFullBasket(index+1,refreshSpend);
    if(refreshSpend>input.postR1P) continue;
    const candidate=basket(input,needed,stock,refreshSpend,index+1);
    if(candidate.purchases.length>best.purchases.length||
      (candidate.purchases.length===best.purchases.length&&candidate.remainingP>best.remainingP)) best=candidate;
  }
  const missing=[...current.missingDrinkIds,...current.missingCardIds.map(id=>'카드 '+id)];
  let detail=`남은 목표 상품(${missing.join(', ')})이 갱신 뒤 진열되면 그때의 가격·잔액·빈칸을 다시 확인하세요.`;
  if(isAmount(input.nextRefreshCost)) detail+=` 다음 갱신 비용은 ${input.nextRefreshCost}P입니다.`;
  if(future.length){
    const steps=best.purchases.map(row=>`${row.page?`${row.page}회 갱신 후`:'현재'} ${itemLabel(row)}`).join(', ');
    detail=best.allDesired?'가정한 진열과 가격이면 목표 상품을 모두 확보할 수 있습니다.':'입력된 진열·비용·빈칸에서 목표 상품 전체 확보는 확인되지 않았습니다.';
    if(minimumP!==null&&minimumP>input.postR1P) detail=`가정한 진열에서 전부 확보하려면 ${minimumP}P가 필요해 ${minimumP-input.postR1P}P 부족합니다.`;
    if(best!==current) detail+=` ${steps}. 갱신 ${best.refreshCount}회에 ${best.refreshSpend}P, 구매 후 ${best.remainingP}P.`;
  }
  return {status:'confirmed',summary,current,conditional:{summary:`조건부 계획 · ${detail}`,plan:future.length?best:null,minimumP}};
}
