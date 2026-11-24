'use strict';

function sourceRecipeReadinessMarkup(result){
  const data=result?.sourceRecipeReadiness;if(!data?.recipes?.length)return '';
  const rows=value=>Array.isArray(value)?value:[];
  const esc=value=>typeof escapeHtml==='function'?escapeHtml(value):String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const rich=value=>typeof memoryRichTextMarkup==='function'?memoryRichTextMarkup(String(value??''),{size:18}):esc(value);
  const safeAsset=value=>typeof value==='string'&&value.startsWith('/assets/')&&!/[\\\u0000-\u001f]/.test(value)?value:null;
  const card=value=>typeof memorySkillVisualMarkup==='function'?memorySkillVisualMarkup(value,{size:22,showJapanese:true}):
    `<span class="srr-card">${safeAsset(value?.imageUrl)?`<img src="${esc(value.imageUrl)}" alt="" loading="lazy">`:'<span class="srr-no-image" aria-label="스킬 그림 미확인">?</span>'}<span>${esc(value?.nameKo??value?.name??value?.nameJa??'이름 미확인')}${value?.nameJa&&value.nameJa!==value.nameKo?`<small lang="ja">${esc(value.nameJa)}</small>`:''}</span></span>`;
  const sourceLink=source=>{
    let url;try{url=new URL(source.url);}catch{return esc(source.title??'출처');}
    return ['https:','http:'].includes(url.protocol)?`<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(source.title??'원문 보기')}</a>`:esc(source.title??'출처');
  };
  const statusLabel={matches_known_conditions:'확인된 역할 조건 일치',missing:'반입 조건 미충족',unknown:'반입 조건 미확정'};
  const supportLabel={selected:'편성에 있음',missing:'편성에 없음',level_missing:'명시 최소 레벨 미충족',level_unknown:'현재 레벨 미확인',unknown:'원문 조건 미확인'};
  const recipes=data.recipes.map(recipe=>{
    const missing=rows(recipe.missingNotes),unknown=rows(recipe.unknownNotes),first=missing[0]??unknown[0]??'일부 조건만 대조했습니다.';
    const carry=rows(recipe.carryRoles).map(row=>`<li>${card(row.card)}<span class="srr-status">${esc(statusLabel[row.status]??'조건 확인 필요')}</span><small>${esc(row.currentPhaseLabel)} · ${esc(row.sourcePhaseLabel)}</small>${rows(row.reasons).length?`<p>${rows(row.reasons).map(rich).join(' · ')}</p>`:''}</li>`).join('');
    const hif=rows(recipe.hifRequirements).map(row=>`<li>${card(row.target)}<p>${rich(row.summaryKo??'HIF 능력 조건')}</p><strong class="srr-status">${esc(row.statusText)}</strong>${row.effectSelected?`<small>${esc(row.targetAvailabilityLabel)}</small><small>능력이 붙은 선택 사본: ${rows(row.selectedCarriers).map(ref=>card(ref.card)).join(' · ')}</small>`:''}<small>이 스킬은 HIF 발동 대상입니다. 반입 카드 이름만으로 능력 보유를 판정하지 않습니다.</small></li>`).join('');
    const supports=rows(recipe.supportRequirements).map(row=>`<li>${rows(row.choices).map(ref=>`<span class="srr-card">${safeAsset(ref.imageUrl)?`<img src="${esc(ref.imageUrl)}" alt="" loading="lazy">`:''}<span>${esc(ref.nameKo??ref.name??ref.nameJa??'서포트')} ${ref.nameJa&&ref.nameJa!==ref.nameKo?`<small lang="ja">${esc(ref.nameJa)}</small>`:''}</span></span>`).join(' <span>또는</span> ')}<strong class="srr-status">${esc(supportLabel[row.status]??'미확인')}</strong>${rows(row.selected).length?`<small>현재 편성 ${row.selected.map(ref=>`${ref.rental?'대여 ':''}Lv ${ref.level==null?'미확인':esc(String(ref.level))}`).join(' / ')}</small>`:''}<small>${row.minimumLevel==null?'원문의 필수 최소 레벨 미확정':`원문 최소 레벨 ${esc(String(row.minimumLevel))}`}${row.observedLevel!=null?` · 원문 실전 레벨 ${esc(String(row.observedLevel))} (최소 조건으로 추정하지 않음)`:''}</small><small>${esc(row.acquisitionLabel??'서포트 보상 실제 획득·발동 시점 미확인')}</small></li>`).join('');
    const drinks=rows(recipe.drinkRequirements).map(row=>`<li><span lang="ja">${esc(row.nameJa??'드링크')}</span>${row.perRound!=null?` · 원문 라운드당 ${esc(String(row.perRound))}병`:''}<span class="srr-status">현재 확보 미확인</span></li>`).join('');
    return `<article class="srr-recipe"><h4>${esc(recipe.label)}</h4><p class="srr-short"><strong>${esc(recipe.summary)}</strong> · ${rich(first)}</p><details><summary>반입·HIF·서포트·드링크 조건 보기</summary><div class="srr-body">${carry?`<h5>선택 반입 사본</h5><ul class="srr-cards">${carry}</ul>`:''}${!recipe.sourcePhasesKnown?'<p>현재 사본의 합류와 원문 사본의 합류는 별도입니다. 원문 합류는 미확인입니다.</p>':''}${!recipe.sourceCustomizationsFullyKnown?'<p>원문 사본의 전체 개조 사양은 미확인입니다.</p>':''}${hif?`<h5>원문 HIF 능력과 발동 대상</h5><ul class="srr-cards">${hif}</ul>`:''}${supports?`<h5>원문 서포트 조건</h5><ul class="srr-cards">${supports}</ul>`:''}${drinks?`<h5>원문 드링크 조건</h5><ul class="srr-cards">${drinks}</ul>`:''}${rows(recipe.observedConditions).length?`<h5>원문 적용 조건</h5><ul>${recipe.observedConditions.map(note=>`<li>${rich(note)}</li>`).join('')}</ul>`:''}${unknown.length?`<h5>아직 확인할 것</h5><ul>${unknown.map(note=>`<li>${rich(note)}</li>`).join('')}</ul>`:''}<p class="srr-sources">${rows(recipe.sources).map(sourceLink).join(' · ')}</p></div></details></article>`;
  }).join('');
  return `<section class="source-recipe-readiness"><h3>이 공략 후보에서 아직 필요한 것</h3><p class="srr-intro">${esc(data.summary)}</p>${recipes}<small class="srr-boundary">조건부 원문 후보입니다. 실제 완성·발동·우승과 전체 최적 편성을 확인한 결과가 아닙니다.</small></section>`;
}
