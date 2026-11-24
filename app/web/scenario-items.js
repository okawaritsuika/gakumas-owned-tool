'use strict';

(() => {
  const panel=$('scenarioItemSettings');
  let currentKey='', menu=null, rewardKey='', loading=false;
  function context(){
    const scenario=$('scenarioSelect').value, idolId=$('idolSelect').value;
    const difficulty=scenario==='nia'?$('niaDifficultySelect').value:$('hajimeDifficultySelect').value;
    const normal=!$('eventModeSelect').value && ['nia','hajime'].includes(scenario);
    return {scenario,difficulty,idolId,normal,key:JSON.stringify([normal,scenario,difficulty,idolId,ui.state?.catalogVersion])};
  }
  const option=(val,label)=>'<option value="'+escapeHtml(val)+'">'+escapeHtml(label)+'</option>';
  const numInput=(id,label)=>'<label class="form-field">'+label+'<input type="number" id="'+id+'" min="0" step="1" placeholder="미확인"></label>';
  const venueNames={consult:'상담',outing:'외출',supply_gift:'활동 지급',special_training:'특별지도',company:'기업 회장',commercial:'상업 시설',municipal:'지자체 회장'};
  function observationSettings(c,weeks){
    if(!weeks?.length)return '';
    const nia=c.scenario==='nia';
    return '<details><summary>'+ (nia?'기본 카드 교환 조건':'17장 이상 덱의 카드 획득 조건')+'</summary><p>'+
      (nia?'확인한 주차의 방문 장소와 챌린지 교환 직전에 남아 있던 기본 카드 수를 입력하세요.':
      '확인한 주차에 카드를 한 장씩 얻었을 때의 덱 장수를 입력하세요. 같은 주에 여러 번 얻었다면 쉼표로 구분하세요.')+
      '</p>'+weeks.map(({week,venues})=>'<div class="form-row" data-check-week="'+week+'">'+
        (nia?'<label>'+week+'주 장소 <select data-check-venue>'+option('','미확인')+venues.map(v=>option(v,venueNames[v])).join('')+
          '</select></label><label>남은 기본 카드 <input data-check-count type="number" min="0" step="1" placeholder="미확인"></label>':
          '<label>'+week+'주 획득 시 덱 장수 <input data-check-sizes type="text" placeholder="예: 16, 17"></label>')+'</div>').join('')+'</details>';
  }

  function drawStart(c){
    const root=$('startItemSettings');
    if(c.difficulty==='pro'){root.replaceChildren();return;}
    if(!c.idolId){root.textContent='시작 아이템의 해금 상태를 지정하려면 육성할 P아이돌을 선택해 주세요.';return;}
    if(!menu){root.textContent=loading?'선택 가능한 아이템을 불러오는 중입니다.':'';return;}
    if(!menu.groups.length){root.textContent=menu.notes.join(' ');return;}
    root.innerHTML='<h4>시작 전 챌린지 P아이템</h4><div class="form-row"><label class="form-field">이 아이돌의 해금 슬롯<select id="itemSlotCount">'+option('','미확인')+
      [0,1,2,3].map(n=>option(n,n+'칸')).join('')+'</select></label><label class="form-field">선택 방식<select id="startItemMode">'+option('auto','가용 후보 자동 비교')+option('fixed','직접 지정')+
      '</select></label>'+numInput('itemDearnessLevel','이 아이돌의 친애도 레벨')+'</div><label><input type="checkbox" id="limitStartOffers"> 게임 화면에 제시된 후보만 비교</label><div id="startItemGroups"></div>'+observationSettings(c,menu.observationWeeks);
    for(const group of menu.groups){
      const row=document.createElement('div');row.dataset.slotGroup=group.number;
      const choices=group.items;
      row.innerHTML='<div data-offers hidden><strong>'+group.number+'칸 후보</strong> '+choices.map(item=>'<label><input type="checkbox" data-offer value="'+escapeHtml(item.id)+'"> '+escapeHtml(item.name)+'</label>').join(' ')+'</div>'+
        '<label class="form-field" data-fixed hidden>'+group.number+'칸 아이템<select data-picked>'+option('','비워 두기')+choices.map(item=>option(item.id,item.name)).join('')+'</select></label>';
      $('startItemGroups').append(row);
    }
    syncStartSelection();
  }
  function syncStartSelection(){
    if(!$('itemSlotCount'))return;
    const count=$('itemSlotCount').value, limited=$('limitStartOffers').checked, fixed=$('startItemMode').value==='fixed';
    for(const row of $('startItemGroups').children){
      row.hidden=count!=='' && Number(row.dataset.slotGroup)>Number(count);
      row.querySelector('[data-offers]').hidden=!limited;
      row.querySelector('[data-fixed]').hidden=!fixed;
      const select=row.querySelector('[data-picked]');
      const offered=new Set([...row.querySelectorAll('[data-offer]:checked')].map(input=>input.value));
      for(const item of select.options)item.disabled=Boolean(item.value&&limited&&!offered.has(item.value));
      if(select.selectedOptions[0]?.disabled)select.value='';
    }
  }
  function drawRewards(c){
    const weeks=ui.scenarioRewardWeeks?.[c.scenario+'-'+c.difficulty];
    const key=c.key+JSON.stringify(weeks);
    if(key===rewardKey)return;
    rewardKey=key;
    const root=$('rewardItemSettings');
    if(!weeks||!weeks.business.length&&!weeks.bracelet.length){root.replaceChildren();return;}
    const visits=weeks.business.map(week=>'<label>'+week+'주 <select data-visit="'+week+'">'+option('','미확인')+option('company','기업 회장')+option('commercial','상업 시설')+option('municipal','지자체 회장')+'</select></label>').join(' ');
    const audition=c.scenario==='nia'&&c.difficulty==='master'?'<details><summary>챌린지로 늘어나는 오디션 보상 계산</summary>'+
      '<p>선택한 경로의 기본 스탯에 챌린지 추가분이 들어 있지 않을 때 사용하세요. 계산기에서 성장률과 챌린지 보너스를 제외한 각 오디션의 기본 보상을 입력하면 추가분을 비교합니다.</p>'+
      ['1차','2차','최종'].map((stage,i)=>'<fieldset data-audition="'+i+'"><legend>'+stage+' 오디션</legend><div class="form-row">'+
        ['Vo','Da','Vi'].map(axis=>numInput('audition'+i+axis,axis)).join('')+'</div></fieldset>').join('')+'</details>':'';
    root.innerHTML=audition+'<h4>중간 보상 P아이템</h4>'+
      (visits?'<p>1차 합격 뒤 입장 조건을 충족하는 영업 장소를 지정하세요. 스마트폰 링을 비교할 때는 그 주에 강화할 카드가 있어야 합니다.</p>'+visits:'')+
      '<p><label><input type="checkbox" id="knownBraceletWeeks"> 팔찌 획득 뒤 SP 레슨에서 체력 3과 강화 대상을 확보하는 주차 지정</label></p>'+
      '<div id="braceletWeeks" hidden>'+weeks.bracelet.map(week=>'<label><input type="checkbox" data-bracelet="'+week+'"> '+week+'주</label>').join(' ')+'</div>'+
      (c.scenario==='nia'?'<p>프리셋에 아이템 보상이 이미 들어 있을 수 있습니다. 아래에 보상을 뺀 기본 횟수를 입력하면 아이템 추가분을 합산합니다.</p><div class="form-row">'+
        numInput('baseDrinkReceipts','기본 드링크 획득 횟수')+numInput('baseEnhancements','기본 강화 횟수')+'</div>':'');
  }
  async function sync(){
    const c=context();
    panel.hidden=!c.normal;
    if(c.key!==currentKey){
      currentKey=c.key;menu=null;loading=false;
      drawStart(c);
    }
    if(!c.normal)return;
    drawRewards(c);
    if(!panel.open||c.difficulty==='pro'||!c.idolId||menu||loading)return;
    loading=true;drawStart(c);
    const query=new URLSearchParams({scenario:c.scenario,difficulty:c.difficulty,idolId:c.idolId});
    try{
      const response=await fetch('/api/scenario-start-items?'+query);
      const data=await response.json();
      if(c.key!==currentKey)return;
      if(!response.ok)throw new Error(data.error);
      menu=data;loading=false;drawStart(c);
    }catch(error){
      if(c.key!==currentKey)return;
      loading=false;$('startItemSettings').textContent=error.message||'시작 아이템 목록을 불러오지 못했습니다.';
    }
  }
  function requestOptions(){
    const c=context(), body={};
    if(!c.normal||currentKey!==c.key)return body;
    if(menu&&$('itemSlotCount')){
      if($('itemDearnessLevel').value!=='')body.startItemDearnessLevel=Number($('itemDearnessLevel').value);
      if($('itemSlotCount').value!=='')body.startItemSlotCount=Number($('itemSlotCount').value);
      const rows=[...$('startItemGroups').children].filter(row=>!row.hidden);
      if($('limitStartOffers').checked)body.availableStartItemIds=rows.flatMap(row=>[...row.querySelectorAll('[data-offer]:checked')].map(input=>input.value));
      if($('startItemMode').value==='fixed'){
        body.startItemIds=rows.map(row=>row.querySelector('[data-picked]').value).filter(Boolean);
        // Explicitly picking an offered item in the game confirms its availability.
        if(body.startItemSlotCount==null&&!body.availableStartItemIds)body.availableStartItemIds=[...body.startItemIds];
      }
    }
    const visits=[...panel.querySelectorAll('[data-visit]')].filter(input=>input.value).map(input=>({week:Number(input.dataset.visit),venue:input.value}));
    if(visits.length)body.scenarioRewardVisits=visits;
    const checks=[];
    for(const row of panel.querySelectorAll('[data-check-week]')){
      const week=Number(row.dataset.checkWeek),venue=row.querySelector('[data-check-venue]'),count=row.querySelector('[data-check-count]'),sizes=row.querySelector('[data-check-sizes]')?.value.trim();
      if(venue && (venue.value||count.value!==''))checks.push({week,venue:venue.value,basicCardCountBeforeChallenge:number(count.value)});
      if(sizes)checks.push({week,deckSizes:sizes.split(',').map(n=>number(n.trim()))});
    }
    if(checks.length)body.startItemObservations=checks;
    if($('knownBraceletWeeks')?.checked)body.scenarioRewardSpWeeks=[...panel.querySelectorAll('[data-bracelet]:checked')].map(input=>Number(input.dataset.bracelet));
    for(const [id,action] of [['baseDrinkReceipts','p_drink_acquire'],['baseEnhancements','skill_enhance']]){
      const val=$(id)?.value;
      if(val!=null&&val!=='')(body.scenarioRewardBaseCounts??={})[action]=Number(val);
    }
    const rewards=[...panel.querySelectorAll('[data-audition]')].map(field=>{
      const inputs=[...field.querySelectorAll('input')];
      if(!inputs.some(input=>input.value!==''))return null;
      return Object.fromEntries(inputs.map((input,i)=>[['vocal','dance','visual'][i],number(input.value)]));
    });
    if(rewards.some(Boolean))body.niaAuditionBaseRewards=rewards;
    return body;
  }
  function resultMarkup(result){
    const plan=result.scenarioStartItemPlan, model=result.scoreSummary?.nonHifModel;
    if(hasHifItemPath(result))return hifItemPathMarkup(result);
    if(!model&&!plan?.groups?.length)return '';
    const list=(items)=>items.map(item=>escapeHtml(item.name)).join(' · ');
    const bonus=(totals)=>plan.scenario==='nia'?'오디션 보너스 +'+formatNumber(totals.auditionParameterGrowthRatePermil/10)+'%':'레슨 PERFECT 상한 +'+formatNumber(totals.lessonLimitUpScore);
    let copy='';
    if(plan?.groups?.length){
      copy+=plan.selectedItems.length?'<p><strong>시작 전 선택</strong> '+list(plan.selectedItems)+' · '+bonus(plan.totals)+'</p>':
        '<p>시작 전 선택 '+(plan.status==='conditional'?'· 해금 슬롯 미확인':'· 적용한 아이템 없음')+'</p>';
      if(plan.recommendedItems.length && plan.recommendedItemIds.join()!==plan.selectedItemIds.join())
        copy+='<p>상한 후보 · '+list(plan.recommendedItems)+' · '+bonus(plan.recommendedTotals)+'</p>';
      const effects=plan.appliedEffects;
      const growth=['vocal','dance','visual'].map((axis,i)=>effects?.growthRatePermil[axis]?[['Vo','Da','Vi'][i],formatNumber(effects.growthRatePermil[axis]/10)+'%'].join(' +'):'').filter(Boolean);
      if(effects?.initialPP)growth.push('시작 P포인트 +'+formatNumber(effects.initialPP));
      if(effects?.routePP)growth.push('육성 중 P포인트 +'+formatNumber(effects.routePP));
      for(const [axis,label] of [['vocal','Vo'],['dance','Da'],['visual','Vi']]){
        if(effects?.routeStats?.[axis])growth.push('육성 중 '+label+' +'+formatNumber(effects.routeStats[axis]));
      }
      if(growth.length)copy+='<p>편성 계산에 반영 · '+growth.join(' · ')+'</p>';
      if(effects?.actions?.skill_acquire)copy+='<p>선택한 경로에서 시작 아이템으로 스킬 획득 '+formatNumber(effects.actions.skill_acquire)+'회</p>';
      if(effects?.actions?.delete)copy+='<p>기본 카드 삭제 '+formatNumber(effects.actions.delete)+'회 · 같은 주에 확보한 교환 대상과 발동 한도를 적용했습니다.</p>';
      const audition=model?.niaChallengeBonusStats;
      if(audition)copy+='<p>오디션 기본 보상에 따른 챌린지 추가분 · '+['vocal','dance','visual'].map((a,i)=>['Vo','Da','Vi'][i]+' +'+formatNumber(audition[a])).join(' · ')+' (오디션별 내림 가정)</p>';
      const details=plan.selectedItems.map(item=>'<li><strong>'+escapeHtml(item.name)+'</strong> '+escapeHtml(plainGameText(item.descriptionJa))+'</li>').join('');
      copy+='<p>'+escapeHtml(plan.notes.join(' '))+'</p>'+(details?'<details><summary>선택 아이템의 발동 조건·비용</summary><ul>'+details+'</ul></details>':'');
    }else if(plan?.status==='unavailable'||plan?.status==='idol_required')copy+='<p>'+escapeHtml(plan.notes.join(' '))+'</p>';
    const reward=model?.scenarioReward;
    if(reward?.items?.length)copy+='<p><strong>육성 중 선택</strong> '+reward.items.map(item=>escapeHtml(item.name)+' ('+item.weeks.join('·')+'주, '+item.activations+'회)').join(' + ')+'</p><p>'+escapeHtml(reward.notes.join(' '))+'</p>';
    if(model?.targetAxis||result.scoreSummary?.excelSupportCounts?.name){
      const axis={vocal:'보컬',dance:'댄스',visual:'비주얼'}[model?.targetAxis];
      copy+='<p>비교에 채택한 경로 · '+[result.scoreSummary.excelSupportCounts?.name,axis].filter(Boolean).map(escapeHtml).join(' · ')+'</p>';
    }
    if(model?.cappedStats){
      const axes=['vocal','dance','visual'];
      copy+='<p>'+(model.routeModelAvailable?'경로에서 계산한 능력치':'확인된 능력치 부분합')+' / 상한 · '+axes.map((axis,i)=>['Vo','Da','Vi'][i]+' '+formatNumber(Math.round(model.cappedStats[axis]))+' / '+formatNumber(model.statCaps[axis])).join(' · ')+'</p>';
    }
    if(Number.isFinite(model?.score))copy+='<p>같은 난이도·목표의 편성 비교 지수 <strong>'+formatNumber(Math.round(model.score*100)/100)+'</strong> · 상한을 적용한 능력치와 경로 자원을 반영합니다.</p>';
    return copy?'<section class="support-evaluation"><h3>아이템 선택과 능력치</h3>'+copy+'</section>':'';
  }
  panel.addEventListener('toggle',sync);
  panel.addEventListener('change',()=>{
    syncStartSelection();
    if($('braceletWeeks'))$('braceletWeeks').hidden=!$('knownBraceletWeeks').checked;
    markRecommendationConditions();
  });
  for(const id of ['scenarioSelect','idolSelect','eventModeSelect','hajimeDifficultySelect','niaDifficultySelect'])$(id).addEventListener('change',sync);
  Object.assign(globalThis,{syncScenarioItemControls:sync,scenarioItemRequestOptions:requestOptions,scenarioItemResultMarkup:resultMarkup});
  sync();
})();
