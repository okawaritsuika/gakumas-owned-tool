'use strict';

function hifIntervalInputs(observation={}){
  const list=values=>Array.isArray(values)?values.join(', ')||'없음':'';
  const offers=values=>Array.isArray(values)?values.map(row=>(row.drinkId??('[카드] '+row.cardId))+' '+row.price).join(', ')||'없음':'';
  const future=Array.isArray(observation.futureShops)?observation.futureShops.map(page=>
    offers(page.offers)+(Number.isInteger(page.nextRefreshCost)?' | '+page.nextRefreshCost:'')).join('\n'):'';
  const field=(key,label,value,placeholder,numeric=false)=>`<label>${label}<input data-hif-interval="${key}" ${numeric?'type="number" min="0" step="1"':'type="text"'} value="${escapeHtml(value??'')}" placeholder="${escapeHtml(placeholder)}"></label>`;
  return `<fieldset><legend>R1 종료 후 인터벌</legend><p>현재 P에는 R1 보상까지 포함한 잔액을 입력하세요. 빈 목록을 확인했으면 ‘없음’, 확인 전이면 빈칸으로 두세요.</p>
    ${field('heldDrinkIds','현재 보유 음료',list(observation.heldDrinkIds),'이름을 쉼표로 구분')}
    ${field('freeSlots','빈 음료 칸',observation.freeSlots,'미확인',true)}
    ${field('desiredDrinkIds','R2에 보유하고 싶은 음료',list(observation.desiredDrinkIds),'같은 음료가 2개 필요하면 이름을 두 번 입력')}
    ${field('desiredCardIds','추가로 사고 싶은 스킬 카드(선택)',list(observation.desiredCardIds),'카드 이름을 쉼표로 구분')}
    ${field('offers','현재 구매 가능한 진열 상품과 P 가격 · 카드 이름 앞에는 [카드] 입력',offers(observation.offers),'음료A 75, [카드] 카드B 100')}
    ${field('nextRefreshCost','다음 새로고침 비용(P)',observation.nextRefreshCost,'미확인',true)}
    <details><summary>새로고침 뒤의 조건부 계획 비교</summary><label>가정할 진열을 갱신 순서대로 한 줄씩 입력하세요. 다음 갱신 비용은 | 뒤에 적으세요.
    <textarea data-hif-interval="futureShops" rows="2" placeholder="음료B 100 | 10&#10;음료C 100">${escapeHtml(future)}</textarea></label></details></fieldset>`;
}

function readHifIntervalInputs(scope){
  const read=key=>scope.querySelector(`[data-hif-interval="${key}"]`)?.value?.trim()??'';
  const amount=value=>/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
  const ids=value=>value==='없음'?[]:value?value.split(',').map(id=>id.trim()):null;
  const offers=value=>{
    const entries=ids(value);
    if(!entries) return null;
    return entries.map(entry=>{
      const parts=entry.match(/^(.+)\s+(\d+)$/);
      const name=(parts?parts[1]:entry).trim(),price=parts?amount(parts[2]):null;
      return name.startsWith('[카드]')?{cardId:name.slice(4).trim(),price}:{drinkId:name,price};
    });
  };
  const observation={heldDrinkIds:ids(read('heldDrinkIds')),freeSlots:amount(read('freeSlots')),
    desiredDrinkIds:ids(read('desiredDrinkIds')),offers:offers(read('offers')),nextRefreshCost:amount(read('nextRefreshCost'))};
  if(read('desiredCardIds')) observation.desiredCardIds=ids(read('desiredCardIds'));
  const future=read('futureShops');
  if(future) observation.futureShops=future.split(/\r?\n/).map(line=>{
    const [stock,cost='']=line.split('|');
    return {offers:offers(stock.trim()),nextRefreshCost:amount(cost.trim())};
  });
  return observation;
}

function hifIntervalResult(result){
  if(!result) return '';
  return `<p>${escapeHtml(result.summary)}</p>${result.conditional?`<p>${escapeHtml(result.conditional.summary)}</p>`:''}`;
}
