'use strict';

(() => {
  const iconRoot='/assets/ui/recommend/';
  const planNames={sense:'센스',logic:'로직',anomaly:'어노말리'};
  const trainingTypes={sense:['concentration','goodConditionTurns'],logic:['motivation','goodImpressionTurns'],anomaly:['fullPower','strength','preservation']};
  const trainingNames={concentration:'집중',goodConditionTurns:'호조',motivation:'의욕',goodImpressionTurns:'호인상',fullPower:'전력',strength:'강기',preservation:'온존'};
  const dialog=$('recommendIdolDialog');
  let pickerCharacterId='',automaticSelection=false,revealOnOpen='';

  $('strategySelect').innerHTML='<option value="">자동</option>'+Object.entries(trainingNames).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');

  function choiceMarkup(control,choice){
    const selected=$(control).value===choice.value;
    const picture=choice.icon?`<img class="recommend-choice-icon" src="${escapeHtml(choice.icon)}" alt="" draggable="false">`:'<span class="recommend-choice-auto" aria-hidden="true">↔</span>';
    return `<button type="button" class="recommend-icon-choice${choice.tone?' '+choice.tone:''}${selected?' selected':''}" data-recommend-control="${control}" data-value="${choice.value}" aria-pressed="${selected}" aria-label="${escapeHtml(choice.label)}">${picture}<span>${escapeHtml(choice.label)}</span></button>`;
  }
  function renderChoices(id,control,choices){
    $(id).style.setProperty('--recommend-choice-count',String(choices.length));
    writeMarkup(id,choices.map(choice=>choiceMarkup(control,choice)).join(''),id+'Markup');
  }

  function syncCompactRecommendControls(){
    const selectedPlan=planOf(selectedVariant()??{}),plan=trainingTypes[selectedPlan]?selectedPlan:'';
    $('recommendPlan').value=plan;
    for(const option of $('recommendPlan').options)option.disabled=option.value!==plan;
    const allowed=trainingTypes[plan]??[];
    if(!allowed.includes($('strategySelect').value))$('strategySelect').value='';
    for(const option of $('strategySelect').options){option.disabled=Boolean(option.value&&!allowed.includes(option.value));option.hidden=option.disabled;}
    const badge=plan?`<img src="${iconRoot}plan-${plan}.png" alt=""><span>${planNames[plan]}</span><small>자동 적용</small>`:'<span>아이돌에 맞춰 자동 적용</span>';
    writeMarkup('recommendPlanBadge',badge,'recommendPlanBadgeMarkup');
    renderChoices('recommendStrategyChoices','strategySelect',[{value:'',label:plan?'자동':'아이돌에 맞추기',icon:plan?iconRoot+'plan-'+plan+'.png':''},...allowed.map(value=>({value,label:trainingNames[value],icon:iconRoot+value+'.png'}))]);
    $('recommendStrategyChoices').classList.toggle('is-auto-only',!plan);
    renderChoices('recommendAttributeChoices','targetAttributeSelect',[{value:'auto',label:'자동'},...Object.entries({vocal:'보컬',dance:'댄스',visual:'비주얼'}).map(([value,label])=>({value,label,icon:iconRoot+value+'.png',tone:value}))]);
    renderChoices('recommendActivityChoices','activityFocusSelect',[{value:'auto',label:'자동'},...Object.entries({consult:'상담',outing:'외출',supply_gift:'사시이레'}).map(([value,label])=>({value,label,icon:'/assets/actions/'+value+'.svg'}))]);
    const hif=$('scenarioSelect').value==='hif';$('recommendActivityField').hidden=!hif;document.querySelector('.recommend-attribute-activity-row').classList.toggle('single-field',!hif);
  }

  function renderCompactRecommendPicker(){
    const selected=selectedVariant();
    ui.recommendCharacterId=selected?characterKey(selected):'';
    if(selected)automaticSelection=false;
    const summary=selected?`<span class="recommend-selected-art">${artworkMarkup(selected,'idolCards')}</span><span class="recommend-selected-copy">${bilingualMarkup(nameOf(selected),japaneseNameOf(selected),'variant-name')}<small>클릭해서 아이돌 변경</small></span>`:`<span class="recommend-idol-placeholder"><span aria-hidden="true">${automaticSelection?'↔':'＋'}</span>${automaticSelection?'전체 보유에서 자동 선택':'캐릭터 선택'}</span>`;
    writeMarkup('openRecommendPicker',summary+'<span class="recommend-select-arrow" aria-hidden="true">›</span>','recommendCompactSelectionMarkup');
    $('openRecommendPicker').setAttribute('aria-label',selected?nameOf(selected)+' · 아이돌 변경':'캐릭터 선택');
    syncCompactRecommendControls();
    if(dialog.open)renderPickerDialog();
  }

  function renderPickerDialog(){
    const scores = globalThis.idolEffectScores, scope = scores.settingsScope();
    const entry = scores.load(scope);
    const scopeName = scores.scopeLabel(scope) + ($('eventModeSelect').value ? ' · 일반 효과 기준' : '');
    $('recommendIdolScoreScope').textContent = scopeName + (entry.error ? ' · ' + entry.error : entry.rows ? ' · 추천 점수순' : ' · 점수 불러오는 중');
    $('retryPickerScores').hidden = !entry.error;
    const groups=groupIdols(recordsOf('idolCards'));
    if(!groups.some(group=>group.id===pickerCharacterId))pickerCharacterId=groups[0]?.id??'';
    const current=groups.find(group=>group.id===pickerCharacterId);
    const characters=groups.map(group=>characterTileMarkup(group,{selectedId:pickerCharacterId,mode:'picker'}));
    writeMarkup('recommendCharacterGrid',characters.join('')||'<p class="picker-waiting">보유 목록을 불러오면 아이돌을 선택할 수 있어요.</p>','recommendDialogCharactersMarkup');
    $('recommendVariantSection').hidden=!current;
    $('recommendVariantHeading').textContent=current?current.name+'의 의상':'보유 의상';
    const cards=current?[...current.cards].sort((a,b)=>scores.compareScores(scores.rowFor(a,scope),scores.rowFor(b,scope))||nameOf(a).localeCompare(nameOf(b),'ko')):[];
    const selectedId=$('idolSelect').value;
    const entries=cards.map(record=>{
      const row=scores.rowFor(record,scope);
      const unavailable=entry.error?'점수를 불러오지 못했습니다.':!entry.rows?'점수 불러오는 중':
        array(record.excludedScenarios).includes(scope.split('-')[0])?'이 시나리오 참가 불가':'의상 점수 자료 미연결';
      return {record,row,mode:'picker',selected:recordId(record)===selectedId,unavailable:row?'':unavailable};
    });
    PidolOutfits.render($('recommendVariantGrid'),entries,{key:scope+'/'+pickerCharacterId,revealId:revealOnOpen});
    if(entry.rows)revealOnOpen='';
    $('recommendAutoIdol').disabled=!groups.length;
    $('recommendAutoIdol').setAttribute('aria-pressed',String(automaticSelection));
    updateRailButtons($('recommendCharacterGrid'));
  }
  function openPicker(){
    const selected=selectedVariant();
    if(selected)pickerCharacterId=characterKey(selected);
    revealOnOpen=selected?recordId(selected):'';
    dialog.showModal();
    renderPickerDialog();
    requestAnimationFrame(()=>{
      const rail=$('recommendCharacterGrid'), active=rail.querySelector('[aria-pressed="true"]');
      if(active){
        const bounds=rail.getBoundingClientRect(), tile=active.getBoundingClientRect();
        if(tile.left<bounds.left)rail.scrollLeft+=tile.left-bounds.left;
        else if(tile.right>bounds.right)rail.scrollLeft+=tile.right-bounds.right;
      }
      updateRailButtons(rail);
    });
  }
  function updateRailButtons(rail){
    const remaining=rail.scrollWidth-rail.clientWidth-rail.scrollLeft;
    for(const button of dialog.querySelectorAll(`[data-recommend-rail="${rail.id}"]`))button.disabled=Number(button.dataset.direction)<0?rail.scrollLeft<=2:remaining<=2;
  }

  function enableDrag(rail){
    let drag=null,suppressClickUntil=0;
    rail.addEventListener('pointerdown',event=>{
      if(event.pointerType!=='mouse'||event.button!==0)return;
      drag={id:event.pointerId,x:event.clientX,scroll:rail.scrollLeft,moved:false};
    });
    rail.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      const distance=event.clientX-drag.x;
      if(!drag.moved&&Math.abs(distance)>6){drag.moved=true;rail.classList.add('is-dragging');rail.setPointerCapture(event.pointerId);}
      if(drag.moved){rail.scrollLeft=drag.scroll-distance;event.preventDefault();}
    });
    const finish=event=>{
      if(!drag||event.pointerId!==drag.id)return;
      if(drag.moved)suppressClickUntil=performance.now()+150;
      if(rail.hasPointerCapture(event.pointerId))rail.releasePointerCapture(event.pointerId);
      rail.classList.remove('is-dragging');drag=null;updateRailButtons(rail);
    };
    rail.addEventListener('pointerup',finish);
    rail.addEventListener('pointercancel',finish);
    rail.addEventListener('lostpointercapture',()=>{rail.classList.remove('is-dragging');drag=null;});
    rail.addEventListener('click',event=>{if(performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
    rail.addEventListener('dragstart',event=>event.preventDefault());
    rail.addEventListener('wheel',event=>{
      if(event.ctrlKey||Math.abs(event.deltaX)>=Math.abs(event.deltaY)||rail.scrollWidth<=rail.clientWidth)return;
      const next=Math.max(0,Math.min(rail.scrollWidth-rail.clientWidth,rail.scrollLeft+event.deltaY));
      if(next!==rail.scrollLeft){rail.scrollLeft=next;event.preventDefault();}
    },{passive:false});
    rail.addEventListener('scroll',()=>updateRailButtons(rail),{passive:true});
    new ResizeObserver(()=>updateRailButtons(rail)).observe(rail);
  }

  $('openRecommendPicker').addEventListener('click',openPicker);
  $('retryPickerScores').addEventListener('click',()=>{idolEffectScores.retry(idolEffectScores.settingsScope());renderPickerDialog();});
  $('closeRecommendPicker').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{
    if(event.target===dialog){const bounds=dialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();}
    const button=event.target.closest('[data-recommend-rail]');
    if(button){
      const rail=$(button.dataset.recommendRail), [first,second]=rail.children;
      if(!second)return;
      const step=second.getBoundingClientRect().left-first.getBoundingClientRect().left;
      const page=Math.max(1,Math.round(rail.clientWidth/step));
      rail.scrollBy({left:Number(button.dataset.direction)*page*step,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    }
  });
  $('recommendCharacterGrid').addEventListener('click',event=>{
    const button=event.target.closest('[data-recommend-character]');if(!button)return;
    pickerCharacterId=button.dataset.recommendCharacter;
    revealOnOpen='';
    renderPickerDialog();
    $('recommendCharacterGrid').querySelector(`[data-recommend-character="${CSS.escape(pickerCharacterId)}"]`)?.focus({preventScroll:true});
  });
  $('recommendVariantGrid').addEventListener('click',event=>{
    const button=event.target.closest('[data-recommend-idol]');if(!button)return;
    selectRecommendIdol(button.dataset.recommendIdol);dialog.close();
  });
  $('recommendAutoIdol').addEventListener('click',()=>{
    automaticSelection=true;ui.recommendCharacterId='';$('idolSelect').value='';$('idolSelect').dispatchEvent(new Event('change',{bubbles:true}));dialog.close();
  });
  $('recommendForm').addEventListener('click',event=>{
    const button=event.target.closest('[data-recommend-control]');if(!button)return;
    const control=$(button.dataset.recommendControl);control.value=button.dataset.value;control.dispatchEvent(new Event('change',{bubbles:true}));
  });
  for(const id of ['strategySelect','targetAttributeSelect','activityFocusSelect','scenarioSelect','idolSelect'])$(id).addEventListener('change',syncCompactRecommendControls);
  enableDrag($('recommendCharacterGrid'));
  globalThis.syncCompactRecommendControls=syncCompactRecommendControls;
  globalThis.renderCompactRecommendPicker=renderCompactRecommendPicker;
  renderCompactRecommendPicker();
})();
