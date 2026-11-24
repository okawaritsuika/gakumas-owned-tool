'use strict';

const $ = id => document.getElementById(id);
const collections = {supportCards:'서포트 카드', idolCards:'P아이돌', memories:'메모리'};
const plans = {sense:'센스 (センス)',logic:'로직 (ロジック)',anomaly:'어노말리 (アノマリー)',free:'공용 (フリー)'};
const attributes = {vocal:'보컬 / ボーカル · Vo',dance:'댄스 / ダンス · Da',visual:'비주얼 / ビジュアル · Vi',assist:'보조 / アシスト'};
const effects = {concentration:'집중 (集中)',goodConditionTurns:'호조 (好調)',goodImpressionTurns:'호인상 (好印象)',motivation:'의욕 (やる気)',fullPower:'전력 (全力)',strength:'강기 (強気)',preservation:'온존 (温存)'};
const ui = {view:'inventory',collection:'supportCards',page:1,pageSize:30,state:null,recommendation:null,recommendationVersion:null,recommending:false,fetching:null,stateRequestEpoch:0,toastTimer:null,inventoryCharacterId:'',recommendCharacterId:'',selectedMemorySkillIds:[],selectedHifEffectIds:[],memoryGoalNotice:''};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = value => (typeof value==='number'||typeof value==='string'&&value.trim()!=='') && Number.isFinite(Number(value)) ? Number(value) : null;
const array = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value : '';
function plainGameText(value){return text(value).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/?(?:nobr|color|size|b|i|u|s|font|material|alpha|cspace|mspace|line-height|indent|voffset|pos|space|width|align|mark|lowercase|uppercase|smallcaps|style|noparse|rotate|sub|sup|link)(?:=[^>]*|\s+[^>]*|\s*)>/gi,'');}
const normalized = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g,' ').trim();
const firstNumber = (...values) => values.map(number).find(value => value !== null) ?? null;
const formatNumber = value => number(value) === null ? '미확인' : Number(value).toLocaleString('ko-KR');

function planOf(record){const value=String(record.plan ?? record.planName ?? '').toLowerCase();return ({'センス':'sense','ロジック':'logic','アノマリー':'anomaly','フリー':'free','any':'free','all':'free'})[value] ?? (plans[value] ? value : '');}
function attributeOf(record){const value=String(record.attribute ?? record.parameter_type ?? record.parameterType ?? record.type ?? '').toLowerCase();return ({vo:'vocal',da:'dance',vi:'visual',support:'assist'})[value] ?? (attributes[value] ? value : '');}
function nameOf(record){return text(record.nameKo) || text(record.name) || text(record.nameJa) || text(record.characterName) || (ui.collection==='memories' ? '이름 미확인 메모리' : '이름 미확인 카드');}
function japaneseNameOf(record,primary=nameOf(record)){const value=text(record.nameJa);return value&&value!==primary?value:'';}
function secondaryOf(record){return japaneseNameOf(record)||characterNameOf(record);}
function characterNameOf(record){return text(record.characterNameKo)||text(record.characterName)||text(record.catalog?.characterNameKo)||text(record.catalog?.characterName);}
function characterJaOf(record){const value=text(record.characterNameJa)||text(record.catalog?.characterNameJa);return value&&value!==characterNameOf(record)?value:'';}
function characterKey(record){return text(record.characterId)||text(record.catalog?.characterId)||text(record.raw?.characterId)||normalized(characterNameOf(record)||characterJaOf(record))||'__unmapped';}
function recordId(record){return String(record.id??record.gameId??'');}
function skillOf(record){const card=record.effects?.carriedSkill??record.produceCard??record.skill??{};return text(card.nameKo)||text(record.skillNameKo)||text(card.name)||text(record.skillName)||text(card.nameJa)||text(record.skillNameJa);}
function skillJaOf(record,primary=skillOf(record)){const card=record.effects?.carriedSkill??record.produceCard??record.skill??{};const value=text(card.nameJa)||text(record.skillNameJa);return value&&value!==primary?value:'';}
function bilingualMarkup(primary,japanese,primaryClass='',secondaryClass='name-ja'){return `<span class="${primaryClass}">${escapeHtml(primary)}</span>${japanese&&japanese!==primary?`<span class="${secondaryClass}" lang="ja">${escapeHtml(japanese)}</span>`:''}`;}
function characterMarkup(record,className='card-character'){const primary=characterNameOf(record);const japanese=characterJaOf(record);return primary||japanese?`<div class="${className}">${escapeHtml(primary||japanese)}${primary&&japanese?' / <span lang="ja">'+escapeHtml(japanese)+'</span>':''}</div>`:'';}
function memoryIdolMarkup(record){const primary=text(record.idolNameKo)||text(record.idolName)||text(record.idolNameJa);return primary?`<div class="memory-idol-name"><span>메모리 P아이돌</span>${bilingualMarkup(primary,text(record.idolNameJa),'memory-idol-title')}</div>`:'';}
function memoryOwnerMarkup(record){
  const character=characterNameOf(record)||characterJaOf(record)||'캐릭터 미확인',image=assetUrl(record.characterImageUrl);
  return `<div class="memory-owner" aria-label="메모리를 만든 아이돌">${image?visualFrame(image,character+' 캐릭터 그림','memory-owner-portrait'):''}<div class="memory-owner-copy">${characterMarkup(record,'memory-owner-character')||'<div class="memory-owner-character">캐릭터 미확인</div>'}${memoryIdolMarkup(record)}</div></div>`;
}
function uncapOf(record){return firstNumber(record.uncap,record.levelLimitRank,record.raw?.levelLimitRank);}
function levelOf(record){const level=firstNumber(record.level,record.raw?.level);return level!==null&&level>0?level:null;}
function memoryAbilityLabel(ability){
  const name=text(ability)||text(ability.nameKo)||text(ability.name)||text(ability.description)||'효과명 확인 중';
  const phases={ProduceStart:'시작 시',StartLesson:'레슨 시작 시',EndLesson:'레슨 종료 시',StartAuditionMid1:'1차 중간 오디션 시작',StartAuditionMid2:'2차 중간 오디션 시작',StartAuditionFinal:'최종 오디션 시작',StartExam:'시험 시작',EndExam:'시험 종료'};
  const details=array(ability.branches).map(branch=>{const parts=[];const kind=text(branch.directEffectType).replace(/^ProduceEffectType_/,'');const min=number(branch.directEffectValueMinRaw);const max=firstNumber(branch.directEffectValueMaxRaw,min);const growth=/^(Vocal|Dance|Visual)GrowthRateAddition$/.test(kind);const scalar=/^(Vocal|Dance|Visual|MaxStamina)Addition$|^StaminaRecoverFix$/.test(kind)||growth;
    if(scalar&&min!==null){const divisor=growth?10:1;const value=(min/divisor).toLocaleString('ko-KR',{maximumFractionDigits:2})+(max!==min?'~'+(max/divisor).toLocaleString('ko-KR',{maximumFractionDigits:2}):'');parts.push((min>=0?'+':'')+value+(growth?'%':''));}
    const trigger=text(branch.produceTriggerId);const phase=text(branch.phaseType).replace(/^ProducePhaseType_/,'');const lesson=/lesson_(vocal|dance|visual)(_sp)?/.exec(trigger);if(lesson&&['EndLesson','EndLessonBeforePresent'].includes(phase))parts.push(({vocal:'보컬',dance:'댄스',visual:'비주얼'})[lesson[1]]+(lesson[2]?' SP':'')+' 레슨 종료 시');else if(phases[phase])parts.push(phases[phase]);
    const chance=number(branch.activationRatePermilRaw);if(chance!==null&&chance>0&&chance<1000)parts.push((chance/10).toLocaleString('ko-KR',{maximumFractionDigits:2})+'% 발동');return parts.join(' · ');
  }).filter(Boolean);const scenarios=array(ability.restrictions?.explicitGroupScenarios).map(value=>({hajime:'初',nia:'NIA',hif:'HIF'})[value]).filter(Boolean);return [name,...details,...(scenarios.length?[scenarios.join('·')+' 전용']:[])].join(' · ');
}
function abilityNames(record){return array(record.abilities ?? record.raw?.abilities).filter(ability=>ability!==null&&ability!==undefined).map(ability=>({name:memoryAbilityLabel(ability),level:firstNumber(ability.level,ability.abilityLevel)}));}
function supportAbilityNames(record){
  const direct=array(record.abilities);const milestones=array(record.catalog?.levelAbilities??record.levelAbilities??(direct.some(item=>item&&Array.isArray(item.effects))?direct:undefined));
  if(milestones.length){
    const level=levelOf(record);if(level===null)return [{name:'현재 레벨 미확인 · 효과 수치 확인 전',level:null}];
    const latest=new Map();milestones.forEach((item,index)=>{const at=number(item.level);if(at===null||at>level)return;const key=item.order??item.slot??index;const previous=latest.get(key);if(!previous||at>=Number(previous.level))latest.set(key,item);});
    const kinds={initial_stat:'시작 시',initial_pp:'시작 시',parameter_bonus:'기본 보너스',sp_lesson_rate:'SP 레슨 확률',event_boost:'서포트 이벤트',rest:'휴식 후',rest_end:'휴식 후',after_rest:'휴식 후',lesson_end:'레슨 후',normal_lesson_end:'일반 레슨 후',sp_lesson_end:'SP 레슨 후',outing:'외출 후',outing_end:'외출 후',card_acquire:'스킬 카드 획득 시',card_upgrade:'스킬 카드 강화 시',produce_start:'프로듀스 시작 시'};
    const labels={VocalAddition:['보컬',1],VoAddition:['보컬',1],DanceAddition:['댄스',1],DaAddition:['댄스',1],VisualAddition:['비주얼',1],ViAddition:['비주얼',1],ProducePointAdditionDisableTrigger:['P포인트',1],VocalGrowthRateAddition:['보컬 레슨 보너스',10],DanceGrowthRateAddition:['댄스 레슨 보너스',10],VisualGrowthRateAddition:['비주얼 레슨 보너스',10],LessonVocalSpChangeRatePermilAddition:['보컬 SP 발생률',10],LessonDanceSpChangeRatePermilAddition:['댄스 SP 발생률',10],LessonVisualSpChangeRatePermilAddition:['비주얼 SP 발생률',10],SupportCardEventParameterAdditionValueUp:['서포트 이벤트 능력치',10]};
    const rows=[];for(const item of latest.values()){
      const kind=text(item.kind).replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase();const condition=text(item.conditionName)||text(item.triggerName)||kinds[kind]||'조건 미확인';
      for(const effect of array(item.effects).filter(effect=>effect&&typeof effect==='object')){const known=labels[text(effect.type).replace(/^ProduceEffectType_/,'')];const min=firstNumber(effect.min,effect.value);const max=firstNumber(effect.max,effect.value,min);let detail;
        if(min===null)detail=known?known[0]+' · 수치 미확인':'기타 지원 효과 · 수치 미확인';else{const divisor=known?.[1]??1;const format=value=>(value/divisor).toLocaleString('ko-KR',{maximumFractionDigits:2});const range=min===max?format(min):format(min)+'~'+format(max);detail=known?known[0]+' '+(min>=0?'+':'')+range+(divisor===10?'%':''):'기타 지원 효과 · 원수치 '+range;}
        const chance=number(effect.ratePermil);if(chance!==null&&chance>0&&chance<1000)detail+=' · 발동률 '+(chance/10).toLocaleString('ko-KR',{maximumFractionDigits:2})+'%';rows.push({name:condition+' · '+detail,level:null});
      }
    }
    if(rows.length)return rows;
  }
  const rows=abilityNames(record);const named=rows.filter(row=>row.name!=='효과명 확인 중');const missing=rows.length-named.length;if(missing)named.push({name:'지원 효과 '+missing+'개 · 상세 설명 확인 전',level:null});return named;
}
function recordsOf(key){return array(ui.state?.inventory?.[key]);}
function categoryStatus(key){const inventory=ui.state?.inventory;const status=inventory?.collectionStatus?.[key];const value=typeof status==='string' ? status : status?.status;if(value==='complete')return 'complete';if(value==='partial')return 'partial';if(value==='failed'||value==='error')return 'error';if(['waiting','unknown','not_read'].includes(value))return 'waiting';if(recordsOf(key).length)return 'partial';return ui.state?.connection?.status==='complete' ? 'complete' : ui.state?.connection?.status==='error' ? 'error' : 'waiting';}
function snapshotVersion(){return ui.state?.inventoryVersion??null;}
function rarityOf(record){const value=String(record.rarity ?? '').toUpperCase();return ['SSR','SR','R'].includes(value) ? value : '';}
function labelTime(value){if(!value)return '아직 수집 전';const date=new Date(value);return Number.isNaN(date.valueOf()) ? '수집 시각 미확인' : new Intl.DateTimeFormat('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}).format(date);}

function assetUrl(...values){return values.find(value=>typeof value==='string'&&value.startsWith('/assets/')&&!value.includes('\\'))??'';}
function cardImage(record,kind,full=false){if(kind==='memories')return assetUrl(record.idolImageUrl,record.imageUrl,record.thumbnailUrl);return full?assetUrl(record.imageUrl,record.thumbnailUrl):assetUrl(record.thumbnailUrl,record.imageUrl);}
function visualFrame(url,alt,className=''){const source=assetUrl(url);return `<div class="visual-frame ${className}${source?' has-image':''}">${source?`<img class="asset-image" src="${escapeHtml(source)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`:''}<span class="image-fallback">이미지 미확인</span></div>`;}
function artworkMarkup(record,kind,full=true){const primary=kind==='memories'?(skillOf(record)||nameOf(record)):nameOf(record);const image=visualFrame(cardImage(record,kind,full),primary+' 카드 그림','card-art '+(kind==='supportCards'?'support-art':kind==='idolCards'?'idol-art':'memory-art'));if(kind==='memories'&&assetUrl(record.skillImageUrl))return `<div class="memory-artwork">${image}${visualFrame(record.skillImageUrl,(skillOf(record)||'반입 스킬')+' 스킬 카드','memory-skill-art')}</div>`;return image;}
function growthVector(data){return {vo:firstNumber(data?.vo,data?.vocal),da:firstNumber(data?.da,data?.dance),vi:firstNumber(data?.vi,data?.visual)};}
function growthInfo(record){const current=growthVector(record.currentGrowthRatePermil);const isCurrent=Object.values(current).some(value=>value!==null);const base=record.baseStats?.growthRatePermil??record.catalog?.baseStats?.growthRatePermil??record.growthRatePermil;return {values:isCurrent?current:growthVector(base),isCurrent};}
function growthValues(record){return growthInfo(record).values;}
function growthPercent(value,showSign=true){return value===null?'미확인':(showSign&&value>0?'+':'')+(value/10).toLocaleString('ko-KR',{maximumFractionDigits:2})+'%';}
function growthMarkup(record,compact=false){const {values,isCurrent}=growthInfo(record),label=isCurrent?'현재 성장률':'기본 성장률',japanese=isCurrent?'現在成長率':'基本成長率';return `<div class="growth-block${compact?' compact':''}"><div class="growth-caption">${label} <span lang="ja">/ ${japanese}</span></div><div class="growth-grid">${[['vo','Vo','vocal'],['da','Da','dance'],['vi','Vi','visual']].map(([key,label,attribute])=>`<div class="growth-cell ${attribute}" title="${attributes[attribute]} ${isCurrent?'현재':'기본'} 성장률"><span>${label}</span><strong>${growthPercent(values[key])}</strong></div>`).join('')}</div>${!isCurrent?'<div class="growth-status">현재 보정값 미확인 · 기본값 표시</div>':''}</div>`;}
function growthBreakdownMarkup(record){const breakdown=record.growthBreakdown??record.currentGrowthBreakdown??record.currentGrowthRateBreakdown;if(!breakdown||typeof breakdown!=='object')return '';const definitions=[['base','기본 / 基本'],['awakening','재능개화 / 才能開花'],['trueEnd','트루엔드 / True End'],['scenario','시나리오 보정']];const rows=definitions.filter(([key])=>breakdown[key]&&typeof breakdown[key]==='object').map(([key,label])=>{const values=growthVector(breakdown[key]);return `<tr><th scope="row">${label}</th>${['vo','da','vi'].map(attribute=>`<td>${growthPercent(values[attribute])}</td>`).join('')}</tr>`;});if(!rows.length)return '';const potentialRank=number(breakdown.potentialRank);return `<section class="detail-section growth-breakdown"><h3>성장률 구성 / 成長率の内訳</h3><table><thead><tr><th scope="col">반영 항목</th><th scope="col">Vo</th><th scope="col">Da</th><th scope="col">Vi</th></tr></thead><tbody>${rows.join('')}</tbody></table>${potentialRank!==null?`<p class="growth-breakdown-note">재능개화 ${potentialRank}단계 기준</p>`:''}</section>`;}
function memoryEffectsOf(record){const effects=record.effects;return effects&&typeof effects==='object'&&!Array.isArray(effects)?effects:null;}
function memoryPhase(record){const phase=memoryEffectsOf(record)?.carriedSkill?.phase;return {label:text(phase?.label)||(phase?.availableAtStart===true?'육성 시작 시':phase?.availableAtStart===false?'육성 도중 등장':'등장 시점 미확인'),availableAtStart:phase?.availableAtStart??null};}
function memorySkillEligibilityMarkup(record){const skill=memoryEffectsOf(record)?.carriedSkill;if(!skill)return '<p class="memory-skill-eligibility unknown">반입 스킬 미확인</p>';const known=skill.obtainable===true,blocked=skill.obtainable===false,details=[skill.planCompatible===false?'선택 플랜과 스킬 플랜이 다름':'',skill.levelEligible===false?'앱 비교에 사용하는 PLv 기준 미충족':'',skill.switchEligible===false?'스킬 전환 선택 미충족':'',skill.levelRule?.kind==='memory_carry_tier'?'대여 해금값을 비교에 사용 · 자기 보유의 공식 적용 범위 미확정':''].filter(Boolean);return `<p class="memory-skill-eligibility ${known?'eligible':blocked?'blocked':'unknown'}">${known?'앱 반입 비교 조건 충족':blocked?'앱 반입 비교 조건 미충족':'앱 반입 비교 조건 미확정'}${details.length?' · '+escapeHtml(details.join(' · ')):''}</p>`;}
function memoryHasStatBonus(record,key){
  const values=Object.values(growthVector(memoryEffectsOf(record)?.[key]));
  return values.every(value=>value!==null)&&values.reduce((sum,value)=>sum+value,0)>0;
}
function memoryMetricMarkup(label,data,percent=false){const values=growthVector(data);return `<div class="memory-metric"><div class="memory-metric-label">${label}</div><div class="growth-grid">${[['vo','Vo','vocal'],['da','Da','dance'],['vi','Vi','visual']].map(([key,name,attribute])=>`<div class="growth-cell ${attribute}"><span>${name}</span><strong>${percent?growthPercent(values[key]):values[key]===null?'미확인':(values[key]>0?'+':'')+formatNumber(values[key])}</strong></div>`).join('')}</div></div>`;}
function effectEntryMarkup(effect){
  const name=text(effect.nameKo)||text(effect.name)||text(effect.nameJa)||'효과 이름 미확인',japanese=text(effect.nameJa),description=plainGameText(effect.descriptionKo)||plainGameText(effect.text)||plainGameText(effect.description)||plainGameText(effect.descriptionJa),descriptionJa=plainGameText(effect.descriptionJa);
  const applies=effect.applies,state=applies===true?'적용 가능':applies===false?'현재 조건에 미적용':'조건 미확정';const probability=effect.probability??{},percent=number(probability.percent),rawChance=number(probability.rawPermil),kind=text(probability.kind);const rate=percent!==null&&percent>0&&rawChance!==0&&!['unknown','none','unconditional','not_probability'].includes(kind)?`발동률 ${percent.toLocaleString('ko-KR',{maximumFractionDigits:2})}%`:'';const limit=firstNumber(effect.activationLimit,effect.activationLimitRaw,effect.activationCountRaw);
  const restrictions=array(effect.restrictions).map(restriction=>{if(restriction.kind==='plan')return plans[restriction.required]||'';if(restriction.kind==='scenario')return array(restriction.required).map(scenario=>({hajime:'初',nia:'N.I.A.',hif:'H.I.F.'})[scenario]).filter(Boolean).join(' / ');if(restriction.kind==='produce_split')return ({ProduceSplitType_Selection:'선발',ProduceSplitType_Final:'본선'})[restriction.required]||'적용 단계 미확인';return '';}).filter(Boolean);const trigger=text(effect.trigger?.label);const triggerLabel=trigger&&/[가-힣]/.test(trigger)?trigger:'';const metadata=[triggerLabel,...restrictions,rate,limit>0?'최대 '+limit+'회':''].filter(Boolean);
  return `<li class="memory-effect ${applies===false?'inapplicable':applies===true?'applicable':'unconfirmed'}"><div class="memory-effect-heading">${bilingualMarkup(name,japanese,'memory-effect-name')}<span class="effect-state">${state}</span></div>${description?`<p>${memoryRichTextMarkup(description)}</p>`:''}${descriptionJa&&descriptionJa!==description?`<p class="name-ja" lang="ja">${memoryRichTextMarkup(descriptionJa)}</p>`:''}${metadata.length?`<div class="effect-meta">${escapeHtml([...new Set(metadata)].join(' · '))}</div>`:''}</li>`;
}
function effectIdentity(effect){return [effect.effectId,effect.abilityId,effect.abilityLevel,effect.trigger?.id,effect.nameKo??effect.name,effect.text??effect.descriptionKo??effect.descriptionJa].join('|');}
function memoryMetricsSummaryMarkup(record){const effects=memoryEffectsOf(record);return effects?memoryMetricMarkup('초기 능력치 가산 · 적용 확인분',effects.initialStats)+memoryMetricMarkup('성장 보너스 · 적용 확인분',effects.growthRatePermil,true)+'<p class="memory-calculation-note">조건이 미확정인 효과와 시험 중 발동 효과는 위 수치에 합산하지 않아요.</p>':'<p class="memory-effects-missing">반입 효과와 스킬 등장 시점을 아직 확인하지 못했어요.</p>';}
function memoryEffectsMarkup(record,detail=false,includeMetrics=true){
  const effects=memoryEffectsOf(record);if(!effects)return includeMetrics?memoryMetricsSummaryMarkup(record):'';
  const hif=array(effects.hifEffects).filter(effect=>effect&&typeof effect==='object'),hifKeys=new Set(hif.map(effectIdentity)),conditions=array(effects.conditionalEffects).filter(effect=>effect&&typeof effect==='object'&&!hifKeys.has(effectIdentity(effect))&&(detail||effect.includedInInitialTotals!==true)),issues=array(effects.issues).map(issue=>(text(issue)||text(issue?.messageKo)||reasonText(issue)).split(/:\s+/)[0]).filter(Boolean);const shownHif=detail?hif:hif.slice(0,2),shownConditions=detail?conditions:conditions.slice(0,1);
  return `<div class="memory-effect-summary">${includeMetrics?memoryMetricsSummaryMarkup(record):''}${shownHif.length?`<div class="memory-effect-group"><h3>H.I.F. 효과</h3><ul>${shownHif.map(effectEntryMarkup).join('')}</ul>${!detail&&hif.length>shownHif.length?`<span class="more-effects">그 외 ${hif.length-shownHif.length}개 · 상세에서 확인</span>`:''}</div>`:''}${shownConditions.length?`<div class="memory-effect-group"><h3>${detail?'효과별 발동 조건':'추가 효과 · 발동 조건'}</h3><ul>${shownConditions.map(effectEntryMarkup).join('')}</ul>${!detail&&conditions.length>shownConditions.length?`<span class="more-effects">그 외 ${conditions.length-shownConditions.length}개 · 상세에서 확인</span>`:''}</div>`:''}${issues.length?`<div class="memory-effect-issues">${detail?[...new Set(issues)].map(issue=>`<p>${escapeHtml(issue)}</p>`).join(''):'효과 조건 중 확인이 필요한 항목이 있어요.'}</div>`:''}</div>`;
}
function memoryProduceRecordMarkup(record){const stats=record.stats??record;return `<details class="produce-record"><summary>육성 기록 · 콘테스트용 참고</summary><p>이 메모리를 만든 육성의 완성 기록입니다. 프로듀스 시작 시 반입하는 가산과 별도로 확인하세요.</p><div class="detail-facts">${detailFact(attributes.vocal,firstNumber(stats.vocal,stats.vo,record.raw?.vocal))}${detailFact(attributes.dance,firstNumber(stats.dance,stats.da,record.raw?.dance))}${detailFact(attributes.visual,firstNumber(stats.visual,stats.vi,record.raw?.visual))}${detailFact('완성 평가점',firstNumber(record.power,record.evaluation,record.raw?.power))}</div></details>`;}
function memoryTargetPlan(){return planOf(selectedVariant()??{})||planOf({plan:$('recommendPlan').value});}
function ownedMemorySkillGroups(plan=memoryTargetPlan(),allPlans=false){const groups=new Map();for(const memory of recordsOf('memories')){const skill=memoryEffectsOf(memory)?.carriedSkill,id=text(skill?.id),skillPlan=planOf({plan:skill?.plan});if(!id||!allPlans&&(!plan||!skillPlan||skillPlan!=='free'&&skillPlan!==plan))continue;const upgrade=firstNumber(skill.upgradeCount,skill.upgrade)??-1;if(!groups.has(id))groups.set(id,{id,name:skillOf(memory)||'스킬 이름 미확인',nameJa:skillJaOf(memory),imageUrl:assetUrl(memory.skillImageUrl),upgrade,copies:0,atStart:0,afterMid:0,unknownPhase:0,eligibilities:[]});const group=groups.get(id);group.copies++;if(skill.phase?.availableAtStart===true)group.atStart++;else if(skill.phase?.availableAtStart===false)group.afterMid++;else group.unknownPhase++;group.eligibilities.push(skill.obtainable);if(upgrade>group.upgrade){group.name=skillOf(memory)||group.name;group.nameJa=skillJaOf(memory);group.upgrade=upgrade;}if(!group.imageUrl)group.imageUrl=assetUrl(memory.skillImageUrl);}return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko'));}
function memorySkillPhaseLabel(group){return [group.atStart?'시작 시 '+group.atStart+'개':'',group.afterMid?'중간 이후 '+group.afterMid+'개':'',group.unknownPhase?'획득 시점 미확인 포함':''].filter(Boolean).join(' · ');}
function memorySkillChip(group){const selected=ui.selectedMemorySkillIds.includes(group.id),disabled=!selected&&ui.selectedMemorySkillIds.length>=4,eligibility=group.eligibilities.some(value=>value===true)?'반입 가능 확인':group.eligibilities.every(value=>value===false)?'반입 제한':'반입 조건 미확정';return `<button type="button" class="memory-skill-chip${selected?' selected':''}" data-memory-skill="${escapeHtml(group.id)}" aria-pressed="${selected}"${disabled?' disabled':''} aria-label="${escapeHtml(group.name+(group.nameJa?' / '+group.nameJa:'')+(selected?' 선택 해제':' 필수 스킬로 선택'))}">${visualFrame(group.imageUrl,group.name+' 스킬 그림','memory-target-icon')}<span class="memory-target-copy">${bilingualMarkup(group.name,group.nameJa,'memory-target-name')}<span class="memory-target-phase">${escapeHtml(memorySkillPhaseLabel(group))}</span><span class="memory-target-eligibility">${eligibility}</span></span><span class="memory-target-check" aria-hidden="true">${selected?'✓':'+'}</span></button>`;}
function renderMemoryTargets(){
  const guide=$('memorySelectionMode').value!=='stats',manualTargets=$('scenarioSelect').value==='hif'&&guide;
  $('memorySelectionHint').textContent=guide?'현재 시나리오의 스킬 기준과 반입 수치를 함께 비교합니다.':'반입 초기 스탯 + 선택 경로에서의 성장 예상분';
  $('memoryTargetSection').hidden=!manualTargets;
  if(!manualTargets)return;
  const plan=memoryTargetPlan(),groups=ownedMemorySkillGroups(plan),available=new Set(groups.map(group=>group.id)),retained=ui.selectedMemorySkillIds.filter(id=>available.has(id));if(retained.length!==ui.selectedMemorySkillIds.length){ui.memoryGoalNotice='현재 플랜이나 보유 목록에 맞지 않는 필수 스킬 선택을 해제했어요.';ui.selectedMemorySkillIds=retained;}const selected=groups.filter(group=>ui.selectedMemorySkillIds.includes(group.id)),query=normalized($('memorySkillSearch').value),shown=groups.filter(group=>!query||normalized(group.name+' '+group.nameJa).includes(query));const markup=shown.length?shown.map(memorySkillChip).join(''):`<p class="memory-target-empty">${!plan?'P카드 또는 플랜을 고르면 맞는 보유 스킬을 선택할 수 있어요.':groups.length?'검색한 스킬을 찾지 못했어요.':'이 플랜에 맞는 보유 반입 스킬을 확인하지 못했어요.'}</p>`;writeMarkup('memorySkillGrid',markup,'memorySkillMarkup');writeMarkup('selectedMemorySkills',selected.map(group=>`<button type="button" class="selected-memory-skill" data-memory-skill="${escapeHtml(group.id)}" aria-label="${escapeHtml(group.name+' 필수 선택 해제')}"><span>${memorySkillVisualMarkup({gameId:group.id,nameKo:group.name,nameJa:group.nameJa,upgradeCount:group.upgrade},{size:20})}</span><span aria-hidden="true">×</span></button>`).join(''),'selectedMemorySkillMarkup');$('memoryTargetCount').textContent=ui.selectedMemorySkillIds.length+' / 4';$('memorySkillSearch').disabled=!groups.length;const profile=currentConsideredGuideProfile();$('memoryTargetMode').textContent=selected.length?'선택한 '+selected.length+'개 스킬이 필수 조건입니다. 반입 조건을 확인한 메모리만 충족으로 셉니다.':profile?guideProfileHint(profile):'스탯 보너스 중심 비교 · 핵심 스킬 미지정';$('memoryTargetNotice').hidden=!ui.memoryGoalNotice;$('memoryTargetNotice').textContent=ui.memoryGoalNotice;const hifIds=new Set(recordsOf('memories').flatMap(memory=>array(memoryEffectsOf(memory)?.hifEffects).map(effect=>text(effect.effectId)).filter(Boolean)));$('hifEffectTargetStatus').textContent=ui.selectedHifEffectIds.length?'필수 HIF 효과 '+ui.selectedHifEffectIds.length+'개 · 스킬·개조 조건과 함께 비교':hifIds.size?'보유 HIF 전용 효과 '+hifIds.size+'종 · 추천 결과에서 발동 조건을 확인하세요':categoryStatus('memories')==='complete'?'보유 HIF 전용 효과 없음 · 추천 결과의 제작 목표를 확인하세요':'보유 HIF 전용 효과 미확인';}
function toggleMemorySkill(id){const index=ui.selectedMemorySkillIds.indexOf(id);if(index>=0)ui.selectedMemorySkillIds.splice(index,1);else if(ui.selectedMemorySkillIds.length<4&&ownedMemorySkillGroups().some(group=>group.id===id))ui.selectedMemorySkillIds.push(id);ui.memoryGoalNotice='';renderMemoryTargets();markRecommendationConditions();}
function guideMemoryProfileOf(result){const profile=result?.scoreSummary?.hifModel?.guideMemoryProfile;return profile&&typeof profile==='object'&&!Array.isArray(profile)?profile:null;}
function guideProfileHint(profile){return profile?.tentative===true||profile?.applied!==true?'공략 역할 후보를 우선 비교했습니다. 미확정 조건은 충족으로 판정하지 않았습니다.':'공략의 확인된 반입 역할을 우선 비교합니다. 개막·커스텀·해금 미충족은 아래에서 확인하세요.';}
function currentConsideredGuideProfile(){const profile=guideMemoryProfileOf(ui.recommendation);return (profile?.considered===true||profile?.applied===true)&&ui.recommendationVersion===snapshotVersion()&&!recommendationConditionsChanged()?profile:null;}
function safeSourceUrl(value){try{const url=new URL(text(value));return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function guideRoleImage(role,result){const memory=recordsOf('memories').find(memory=>recordId(memory)===role.memoryId);const icons=role.skillCharacterIconUrls??{};return assetUrl(memory?.skillImageUrl,role.skillImageUrl,icons[result.selectedIdol?.characterId],...Object.values(icons));}
function guideRolePurpose(role,result){
  const copy=array(result.memories).find(memory=>recordId(memory)===String(role.memoryId));
  if(!copy||memoryPhase(copy).availableAtStart===true)return role.purpose;
  const slot=array(result.memorySelectionReview?.slots).find(row=>String(row.memoryId)===recordId(copy));
  return [carryCopyPhase(copy,result.scoreSummary?.scenario),slot?.role].filter(Boolean).join(' · ');
}
function guideMemoryProfileMarkup(result){
  const profile=guideMemoryProfileOf(result);if(!profile)return '';const applied=profile.applied===true,considered=profile.considered===true||applied,tentative=profile.tentative===true||considered&&!applied,mode=profile.applicationMode;const roles=array(profile.roles).filter(role=>role&&typeof role==='object');const counts={fulfilled:firstNumber(profile.fulfilledCount)??roles.filter(role=>role.status==='fulfilled').length,missing:firstNumber(profile.missingCount)??roles.filter(role=>role.status==='missing').length,unknown:firstNumber(profile.unknownCount)??roles.filter(role=>!['fulfilled','missing'].includes(role.status)).length};
  const explanation=considered&&tentative?'공략 역할 후보를 우선 비교했습니다. 미확정 조건은 충족으로 판정하지 않았습니다.':applied?'공략의 확인된 반입 역할을 우선 비교했습니다. 개막 획득·커스텀·해금 조건이 미충족인 역할은 아래에서 확인하세요.':mode==='manual_targets_override'?'직접 지정한 필수 목표를 우선했습니다. 아래 공략 역할은 조건 점검용으로 표시합니다.':mode==='no_verified_role'?'확인된 반입 역할이 없어 공략 역할 우선 비교를 적용하지 않았습니다.':'공략 적용 조건이 확인되지 않아 역할 점검만 표시합니다.';
  const sources=array(profile.sources).filter(source=>source&&typeof source==='object').map(source=>{const url=safeSourceUrl(source.url);const label=(text(source.author)?text(source.author)+' · ':'')+'공략 원문';const dates=[source.published?'게시 '+text(source.published):'',source.updated?'수정 '+text(source.updated):''].filter(Boolean).join(' · ');return `<li>${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} <span aria-hidden="true">↗</span></a>`:`<span>${escapeHtml(label)} · 출처 링크 미확인</span>`}${dates?`<small>${escapeHtml(dates)}</small>`:''}${source.scope?`<p>${escapeHtml(plainGameText(source.scope))}</p>`:''}</li>`;}).join('');
  const conditions=array(profile.conditions).map(plainGameText).filter(Boolean),preparation=array(profile.preparationNotes).map(plainGameText).filter(Boolean),conflicts=array(profile.conflicts).filter(conflict=>conflict&&typeof conflict==='object'&&text(conflict.reason));
  return `<section class="guide-memory-profile"><div class="guide-profile-heading"><div><div class="eyebrow">H.I.F. MEMORY GUIDE</div><h3>${escapeHtml(text(profile.labelKo)||'H.I.F. 공략 역할')}</h3></div><span class="guide-application-badge${considered&&tentative?' tentative':applied?' applied':''}">${considered&&tentative?'공략 역할 후보 · 미확정':applied?'공략 역할 반영 · 조건부':mode==='manual_targets_override'?'직접 지정한 목표 우선':'공략 적용 보류'}</span></div><p class="guide-profile-explanation">${explanation}</p>${effects[profile.trainingType]?`<p class="guide-training-type">육성 유형 ${effects[profile.trainingType]}</p>`:''}${sources?`<ul class="guide-source-list">${sources}</ul>`:'<p class="guide-source-missing">공략 출처와 작성 시기를 확인하지 못했습니다.</p>'}${conditions.length?`<div class="guide-profile-conditions"><h4>적용 조건</h4><ul>${conditions.map(condition=>`<li>${memoryRichTextMarkup(condition)}</li>`).join('')}</ul></div>`:''}<div class="guide-role-counts"><span class="fulfilled">충족 ${counts.fulfilled}</span><span class="missing">미충족 ${counts.missing}</span><span class="unknown">미확정 ${counts.unknown}</span></div><div class="guide-role-list">${roles.map(role=>{const status=['fulfilled','missing'].includes(role.status)?role.status:'unknown',label={fulfilled:'충족',missing:'미충족',unknown:'미확정'}[status],name=text(role.nameKo).trim()||text(role.nameJa)||'반입 역할 이름 미확인',reasons=array(role.reasons).map(plainGameText).filter(Boolean);return `<article class="guide-role ${status}"><div class="guide-role-heading"><div class="guide-role-title">${memorySkillVisualMarkup({...role,imageUrl:guideRoleImage(role,result)},{size:36,showJapanese:true})}</div><span>${label}</span></div>${guideRolePurpose(role,result)?`<p class="guide-role-purpose">${escapeHtml(plainGameText(guideRolePurpose(role,result)))}</p>`:''}${reasons.length?`<ul>${reasons.map(reason=>`<li>${memoryRichTextMarkup(reason)}</li>`).join('')}</ul>`:''}</article>`;}).join('')}</div>${conflicts.length?`<div class="guide-conflicts">${conflicts.map(conflict=>`<p><strong>${conflict.status==='conflict'?'상충 조건':'미확정 조건'}</strong> ${memoryRichTextMarkup(plainGameText(conflict.reason))}</p>`).join('')}</div>`:''}${preparation.length?`<div class="guide-preparation"><h4>첫 H.I.F. 준비 메모</h4><ul>${preparation.map(note=>`<li>${memoryRichTextMarkup(note)}</li>`).join('')}</ul></div>`:''}<p class="guide-readiness-note">역할별 조건 점검 결과입니다. 실전 편성이 완성됐다는 뜻은 아닙니다.</p></section>`;
}
function groupIdols(rows){const groups=new Map();for(const record of rows){const id=characterKey(record);if(!groups.has(id))groups.set(id,{id,name:characterNameOf(record)||characterJaOf(record)||'캐릭터 정보 미확인',nameJa:characterJaOf(record),characterImageUrl:assetUrl(record.characterImageUrl),cards:[]});const group=groups.get(id);group.cards.push(record);if(!group.characterImageUrl)group.characterImageUrl=assetUrl(record.characterImageUrl);}return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko'));}
function characterTileMarkup(group,{selectedId,mode}){
  const active=selectedId===group.id, action=mode==='picker'?'data-recommend-character':'data-inventory-character';
  return '<button type="button" class="character-tile compact'+(active?' selected':'')+'" '+action+'="'+escapeHtml(group.id)+'" aria-pressed="'+active+'" aria-label="'+escapeHtml(group.name+' 선택')+'">'+visualFrame(group.characterImageUrl,group.name,'character-art')+'<span class="character-tile-copy"><span class="character-name">'+escapeHtml(group.name)+'</span></span></button>';
}
function selectedVariant(){return recordsOf('idolCards').find(record=>recordId(record)===$('idolSelect').value);}
function writeMarkup(id,markup,cacheKey){if(ui[cacheKey]!==markup){$(id).innerHTML=markup;ui[cacheKey]=markup;}}

async function api(path,options={},timeoutMs=45000){
  const controller=new AbortController();const timeout=timeoutMs===null?null:setTimeout(()=>controller.abort(),timeoutMs);
  try {const response=await fetch(path,{...options,cache:'no-store',signal:controller.signal,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});let data;try{data=await response.json();}catch(error){if(error.name==='AbortError')throw error;throw new Error('자료를 읽지 못했습니다. 잠시 후 다시 확인해 주세요.');}if(!response.ok){const message=data.message ?? data.error?.message ?? data.error;throw new Error(typeof message==='string'&&/[가-힣]/.test(message) ? message : '요청을 처리하지 못했습니다. 자료와 연결 상태를 확인해 주세요.');}return data;}
  catch(error){if(error.name==='AbortError')throw new Error('처리가 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요.');if(error instanceof TypeError)throw new Error('보유노트 연결을 확인하지 못했습니다. 다시 확인해 주세요.');throw error;}
  finally{clearTimeout(timeout);}
}

function toast(message,isError=false){clearTimeout(ui.toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',isError);$('toast').hidden=false;ui.toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function setView(view){
  const previousView=ui.view;
  document.body.dataset.view=view;const actions=document.querySelector('.heading-actions');document.querySelector(view==='recommend'?'.topbar-actions':'.page-heading').append(actions);
  ui.view=view;const inventory=view==='inventory',guides=view==='guides',output=view==='memory-output',skills=view==='skills';
  $('inventoryView').hidden=!inventory;$('recommendView').hidden=view!=='recommend';$('guidesView').hidden=!guides;$('postMemoryView').hidden=!output;$('skillAdviceView').hidden=!skills;
  $('pageTitle').textContent=inventory?'내 보유 목록':guides?'시나리오별 육성 공략':output?'육성 후 메모리 선택':skills?'스킬 카드 갤러리':'보유 카드로 편성 추천';
  $('pageDescription').textContent=inventory?'보유한 서포트, 아이돌, 메모리를 한곳에서 확인하세요.':guides?'이벤트 보상부터 덱 운영, 메모리 준비까지 찾아보세요.':output?'시험 종료 후 생성·재생성된 후보 중 남길 메모리를 비교합니다.':skills?'육성 중 얻는 스킬을 작은 그림과 S~D 티어로 비교하고, 조합과 사용 조건을 확인하세요.':'육성 목표에 맞는 서포트와 메모리 조합을 찾아보세요.';
  $('breadcrumbCurrent').textContent=inventory?'내 보유 목록':guides?'시나리오 공략':output?'육성 후 메모리':skills?'스킬 카드':'편성 추천';
  document.querySelector('.page-heading .eyebrow').textContent=inventory?'MY COLLECTION':guides?'PRODUCE GUIDEBOOK':output?'MEMORY CHOICE':skills?'SKILL CARD GUIDE':'PRODUCE PLANNER';
  document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  if(output&&typeof openPostMemoryChoice==='function')openPostMemoryChoice();
  if(guides&&typeof initializeIdolGuideBrowser==='function')initializeIdolGuideBrowser();
  if(view==='recommend'||guides)loadState();
  if(skills&&typeof initSkillAdvice==='function')initSkillAdvice();
  if(inventory&&previousView!==view&&ui.collection==='memories')renderInventory();
}
function setCollection(key){
  if(!collections[key])return;ui.collection=key;ui.page=1;$('rarityFilter').value='';$('rarityFilter').hidden=key==='memories';$('attributeFilter').value='';$('attributeFilter').hidden=key!=='supportCards';$('memoryBonusFilter').hidden=key!=='memories';$('memoryOrderNote').hidden=key!=='memories';$('memoryBonusFilter').value='';
  if(key!=='supportCards'&&$('planFilter').value==='free')$('planFilter').value='';
  const sort=$('sortSelect');sort.querySelector('[value="score"]').hidden=key!=='idolCards';
  sort.querySelector('[value="memory-score"]').hidden=key!=='memories';
  for(const value of ['level','uncap'])sort.querySelector('[value="'+value+'"]').hidden=key==='memories';
  sort.value=key==='idolCards'?(ui.idolSort||'score'):key==='memories'?(ui.memorySort||'name'):'name';
  document.querySelectorAll('[data-collection]').forEach(button=>{const active=button.dataset.collection===key;button.classList.toggle(button.classList.contains('summary-card')?'selected':'active',active);if(button.getAttribute('role')==='tab')button.setAttribute('aria-selected',String(active));});setView('inventory');renderInventory();
}

function recommendationUnderReview(){return ui.state?.recommendationReviewRequired===true||ui.state?.connection?.recommendationReviewRequired===true;}
function rememberProducerLevel(){try{const level=number($('producerLevelInput').value);if(Number.isInteger(level)&&level>0)localStorage.setItem('owned-note-producer-level',String(level));else localStorage.removeItem('owned-note-producer-level');}catch{}}
function syncHifControls(){if(typeof syncCompactRecommendControls==='function')syncCompactRecommendControls();renderMemoryTargets();const hif=$('scenarioSelect').value==='hif';$('hifDeckOptions').hidden=!hif;if(typeof renderSupportComparisonControls==='function')renderSupportComparisonControls();const primary=$('targetAttributeSelect').value;for(const option of $('secondaryAttributeSelect').options)option.disabled=primary!=='auto'&&option.value===primary;if(primary!=='auto'&&$('secondaryAttributeSelect').value===primary)$('secondaryAttributeSelect').value='auto';}
function hifStageTable(stage,label){if(!stage)return `<section class="hif-stage"><h3>${label}</h3><p>계정 보너스 미확인</p></section>`;const cap=growthVector(stage.statCaps),initial=growthVector(stage.initialStats),growth=growthVector(stage.growthRatePermil);const row=(name,values,percent=false)=>`<tr><th scope="row">${name}</th>${['vo','da','vi'].map(axis=>`<td>${percent?growthPercent(values[axis]):formatNumber(values[axis])}</td>`).join('')}</tr>`;const sp=number(stage.spRatePermil);return `<section class="hif-stage"><h3>${label}</h3><table><thead><tr><th scope="col">항목</th><th scope="col">Vo</th><th scope="col">Da</th><th scope="col">Vi</th></tr></thead><tbody>${row('능력치 상한',cap)}${row('성장 보너스',growth,true)}${row('초기 가산',initial)}</tbody></table><p>공통 SP 발생률 ${growthPercent(sp)}${number(stage.initialPP)!==null?' · 초기 P포인트 '+formatNumber(stage.initialPP):''}</p></section>`;}
function renderHifProfile(){syncHifControls();const visible=$('scenarioSelect').value==='hif';$('hifProfile').hidden=!visible;if(!visible)return;const profile=ui.state?.inventory?.hifBonuses,known=profile&&profile.status!=='unknown',status=profile?.status==='current_account'?'계정 현재값':known?'일부 미확인':'수집 대기';const final=profile?.final,cap=growthVector(final?.statCaps),addition=growthVector(final?.limitAddition);const caps=`<div class="hif-cap-grid">${[['vo','Vo','vocal'],['da','Da','dance'],['vi','Vi','visual']].map(([axis,label,attribute])=>{const base=cap[axis]!==null&&addition[axis]!==null?cap[axis]-addition[axis]:null;return `<div class="hif-cap ${attribute}"><span>${label} 본선 상한</span><strong>${known?formatNumber(cap[axis]):'미확인'}</strong><small>${known&&base!==null?'기본 '+formatNumber(base)+' + 계정 '+formatNumber(addition[axis]):'계정 반영값 확인 전'}</small></div>`;}).join('')}</div>`;const issues=array(profile?.issues).map(issue=>text(issue)||reasonText(issue)).filter(Boolean);const markup=`<div class="hif-profile-heading"><div><div class="eyebrow">H.I.F. ACCOUNT BONUS</div><h2>H.I.F. 계정 보너스</h2></div><span class="hif-profile-status">${status}</span></div>${caps}${known?memoryMetricMarkup('본선 성장 보너스 · 공통 포함',final?.growthRatePermil,true):'<p class="hif-unknown">패널 보너스가 수집되면 실제 계정의 성장 보너스와 상한을 표시합니다.</p>'}<p class="hif-application-note">${escapeHtml(text(profile?.applicationNote)||'공통 초기 효과는 선발에서 한 번만 적용합니다. 계정 보너스를 읽기 전에는 최대값이나 0으로 확정하지 않아요.')}</p>${known?`<details class="hif-stage-details"><summary>선발·본선 적용값 자세히 보기</summary><div class="hif-stages">${hifStageTable(profile.selection,'선발 합계 · 공통 포함')}${hifStageTable(profile.final,'본선 합계 · 공통 포함')}</div><p class="hif-panel-count">활성 패널 ${array(profile.activePanels).length}개${profile.capturedAt?' · '+escapeHtml(labelTime(profile.capturedAt))+' 수집':''}</p></details>`:''}${issues.length?`<p class="hif-issues">${escapeHtml(issues.join(' '))}</p>`:''}`;const open=$('hifProfile').querySelector('details')?.open??false;writeMarkup('hifProfile',`<details class="account-bonus-details"><summary>HIF 계정 보너스 보기</summary><div>${markup}</div></details>`,'hifProfileMarkup');if(open){const details=$('hifProfile').querySelector('details');if(details)details.open=true;}}
function renderConnection(){
  const connection=ui.state?.connection ?? {};const status=['complete','partial','error'].includes(connection.status)?connection.status:'waiting';
  const descriptions={waiting:['보유정보를 기다리고 있어요','게임에서 수집된 자료가 도착하면 여기에 표시됩니다.'],partial:['확인된 보유정보를 표시하고 있어요','아직 전체 목록이 아닙니다. 수집되지 않은 카드를 미보유로 판단하지 않아요.'],complete:['보유정보가 연결됐어요','수집된 내 카드와 메모리를 바탕으로 확인하고 추천받을 수 있어요.'],error:['보유정보를 확인하지 못했어요','연결 상태를 확인한 뒤 다시 확인해 주세요.']};
  $('connectionBanner').className='connection-banner '+status;$('connectionTitle').textContent=descriptions[status][0];$('connectionMessage').textContent=text(connection.message)||descriptions[status][1];$('captureTime').textContent=labelTime(connection.capturedAt);
  const capturedLevel=number(ui.state?.inventory?.producerLevel);const producerLevel=capturedLevel!==null&&capturedLevel>0?capturedLevel:null;$('playerLevel').hidden=producerLevel===null;if(producerLevel!==null)$('playerLevel').textContent='PLv '+producerLevel;$('producerLevelInput').placeholder=producerLevel===null?'미확인':'PLv '+producerLevel+' · 수집 정보';
  const ids={supportCards:['supportCount','supportCountNote'],idolCards:['idolCount','idolCountNote'],memories:['memoryCount','memoryCountNote']};
  for(const [key,[countId,noteId]] of Object.entries(ids)){const count=recordsOf(key).length;const state=categoryStatus(key);const known=state==='complete'||count>0;$(countId).innerHTML=known?`${count.toLocaleString('ko-KR')}<small>${key==='memories'?'개':'장'}</small>`:'—';$(noteId).textContent=state==='complete'?'보유 목록':count>0?'확인된 표본':state==='error'?'확인 필요':'수집 대기';$(noteId).classList.toggle('confirmed',known);}
  const underReview=recommendationUnderReview(),needsVariant=Boolean(ui.recommendCharacterId&&!$('idolSelect').value),knownLevel=firstNumber(number($('producerLevelInput').value),producerLevel),needsLevel=!Number.isInteger(knownLevel)||knownLevel<1;const canRecommend=recordsOf('supportCards').length>0&&!['waiting','error'].includes(status)&&!needsVariant&&!needsLevel&&!underReview;$('recommendReviewNotice').hidden=!underReview;$('recommendButton').disabled=!canRecommend||ui.recommending;if(!ui.recommending)$('recommendButton').innerHTML=underReview?'추천 계산 검증 중':'편성 추천';$('recommendAvailability').textContent=underReview?'성장률·상한·메모리 계산을 확인하는 동안 추천을 잠시 멈췄어요.':needsVariant?'선택한 캐릭터의 보유 P카드 그림을 골라 주세요.':needsLevel?'세부 설정에서 현재 프로듀서 레벨을 입력해 주세요.':canRecommend?(status==='complete'?'현재 수집된 보유정보를 기준으로 비교합니다.':'부분 목록 기준의 추천입니다. 전체 보유 기준 결과와 다를 수 있어요.'):'서포트 보유정보가 수집되면 추천받을 수 있어요.';
  $('recommendAvailability').hidden=canRecommend&&!underReview;if(needsLevel&&recordsOf('supportCards').length)$('recommendMoreOptions').open=true;
  const recheck=$('recommendRefreshButton');if(recheck)recheck.disabled=$('recommendButton').disabled;
  renderHifProfile();if(typeof renderCollectorMode==='function')renderCollectorMode();
}

function cardBodyMarkup(record,kind){
  const rarity=rarityOf(record),plan=planOf(record),attribute=attributeOf(record);const title=nameOf(record);const japanese=japaneseNameOf(record,title);const level=levelOf(record),uncap=uncapOf(record);let foot;
  if(kind==='idolCards')foot=`<span>특훈 <strong>${uncap===null?'미확인':uncap+'단계'}</strong></span><span>재능개화 <strong>${firstNumber(record.potentialRank,record.awakening,record.raw?.potentialRank)===null?'미확인':firstNumber(record.potentialRank,record.awakening,record.raw?.potentialRank)+'단계'}</strong></span>`;
  else foot=`<span>레벨 <strong>${level===null?'미확인':'Lv.'+level}</strong></span><span>돌파 <strong>${uncap===null?'미확인':uncap+'돌'}</strong></span>`;
  return `${artworkMarkup(record,kind)}${kind==='supportCards'&&attribute?`<div class="attribute-ribbon ${attribute}">${attributes[attribute]}</div>`:''}<div class="card-copy"><div class="card-top">${rarity?`<span class="rarity-badge ${rarity.toLowerCase()}">${rarity}</span>`:''}<span class="plan-chip">${plans[plan]||'플랜 미확인'}</span></div>${bilingualMarkup(title,japanese,'card-title')}${characterMarkup(record)}${kind==='idolCards'?growthMarkup(record):''}<div class="card-metadata">${kind==='idolCards'&&effects[record.recommendedEffect]?`<span class="small-tag">${effects[record.recommendedEffect]}</span>`:''}</div><div class="card-foot">${foot}<span class="card-chevron" aria-hidden="true">›</span></div></div>`;
}
function memoryCopyName(record){
  const card=record.effects?.carriedSkill, stored=record.produceCard??record.raw?.produceCard;
  const name=(skillOf(record)||text(stored?.id)||'반입 스킬').replace(/\s*[+＋]+\s*$/u,'');
  const upgraded=firstNumber(stored?.upgradeCount,card?.upgrade,card?.upgradeCount,record.upgradeCount)>0;
  return name+(upgraded?'+':'');
}
function memoryCopyStatsMarkup(effects){
  const parts=[];
  const axes=[['vo','vocal','보컬'],['da','dance','댄스'],['vi','visual','비주얼']];
  for(const key of ['initialStats','growthRatePermil']){
    const growth=key==='growthRatePermil';
    const values=growthVector(effects?.[key]);
    for(const [axis,asset,label] of axes){
      const value=values[axis];
      if(value===null||value===0)continue;
      const amount=growth?growthPercent(value):(value>0?'+':'')+formatNumber(value);
      const meaning=label+' '+(growth?'성장률':'초기 가산');
      parts.push(`<span class="memory-copy-stat" title="${meaning}"><img src="/assets/ui/recommend/${asset}.png" width="19" height="19" alt="${meaning}"> ${amount}</span>`);
    }
  }
  return parts.length?`<span class="memory-copy-stats">${parts.join(' ')}</span>`:'';
}
function memoryHifConditionMarkup(condition,characterId){
  const cards=array(condition.search?.cards).filter(card=>card?.id);
  if(!cards.length)return escapeHtml(text(condition.text).trim());
  const afterPlay=array(condition.phaseTypes).includes('ProduceExamPhaseType_ExamCardPlayAfter');
  const pictures=cards.map(card=>memorySkillVisualMarkup({gameId:card.id,upgradeCount:card.upgrade},{
    size:36,characterId,label:(card.nameKo||card.name||card.nameJa||card.id).trim(),showName:afterPlay
  })).join(' · ');
  return pictures+(afterPlay?' 사용 후':' '+escapeHtml(text(condition.text).trim()));
}
function memoryHifEffectMarkup(effect,characterId){
  const groups=new Map();
  for(const action of array(effect.actions)){
    const conditions=array(action.conditions);
    const targets=conditions.filter(condition=>condition.search);
    const trigger=(targets.length?targets:conditions).map(condition=>memoryHifConditionMarkup(condition,characterId)).filter(Boolean).join(' · ');
    const limits=array(action.activationLimits).map(limit=>firstNumber(limit.count,limit)).filter(limit=>limit>0);
    const cap=limits.length===1?` (최대 ${limits[0]}회)`:'';
    const label=plainGameText(action.text).replace(/^스킬 카드 드로우 /,'드로우 ').replace(/^스킬 카드 사용 수 /,'사용 수 ');
    if(!label)continue;
    const key=JSON.stringify([trigger,cap]);
    if(!groups.has(key))groups.set(key,{trigger,cap,labels:new Set()});
    groups.get(key).labels.add(label);
  }
  return [...groups.values()].map(({trigger,cap,labels})=>`<span class="memory-hif-rule">
    ${trigger?`<span class="memory-hif-trigger">${trigger}</span>`:''}
    <span class="memory-hif-result">${escapeHtml([...labels].join(' · '))}${cap?` <span class="memory-hif-limit">${escapeHtml(cap.trim())}</span>`:''}</span></span>`).join('')
    ||escapeHtml(text(effect.nameKo)||text(effect.name)||text(effect.nameJa));
}
function memoryCopyCard(record,index){
  const name=memoryCopyName(record),icon=assetUrl(record.skillImageUrl);
  const scores=ui.memorySort==='memory-score'?ui.inventoryMemoryScores?.scores:null;
  const score=scores?.get(recordId(record));
  const scoreLabel=scores?(Number.isFinite(score)?formatNumber(score)+'점':'점수 미산출'):'';
  const effects=memoryEffectsOf(record),character=characterNameOf(record)||characterJaOf(record);
  const hif=array(effects?.hifEffects).filter(Boolean).map(effect=>memoryHifEffectMarkup(effect,text(record.characterId))).filter(Boolean);
  const customs=array(record.customizationLabels).filter(Boolean);
  const title=name.endsWith('+')?escapeHtml(name.slice(0,-1))+'<span class="memory-copy-plus">+ 강화</span>':escapeHtml(name);
  return `<button type="button" class="memory-copy-card" data-record-index="${index}" aria-haspopup="dialog">
    <span class="memory-copy-heading">${icon?`<img class="memory-copy-icon" src="${escapeHtml(icon)}" alt="" loading="lazy">`:''}
      <span class="memory-copy-identity"><span class="memory-copy-title"><strong class="memory-copy-name">${title}</strong>${record.required===true?'<span class="memory-copy-required">필수</span>':''}${scoreLabel?`<span class="memory-copy-score">${scoreLabel}</span>`:''}</span>
      ${character?`<span class="memory-copy-character">${escapeHtml(character)}</span>`:''}</span></span>
    ${memoryCopyStatsMarkup(effects)}
    ${customs.length?`<span class="memory-copy-custom"><b>개조</b><span>${escapeHtml(customs.join(' · '))}</span></span>`:''}
    ${hif.length?`<span class="memory-copy-hif"><b>H.I.F. 발동 효과</b>${[...new Set(hif)].join('')}</span>`:''}</button>`;
}
function compareMemoryCopies(a,b,scores){
  const left=scores?.get(recordId(a))??null,right=scores?.get(recordId(b))??null;
  if(left!==right)return left===null?1:right===null?-1:right-left;
  return memoryCopyName(a).localeCompare(memoryCopyName(b),'ko');
}

function loadInventoryMemoryScores(){
  const option=id=>$(id).value;
  const scenario=option('scenarioSelect');
  const difficulty=scenario==='hajime'?option('hajimeDifficultySelect'):scenario==='nia'?option('niaDifficultySelect'):'';
  const selected=selectedVariant();
  const scope={scenario,difficulty,plan:memoryTargetPlan()||option('planFilter'),idolGameId:selected?.gameId,
    trainingType:option('strategySelect'),eventModeId:option('eventModeSelect'),activityFocus:option('activityFocusSelect'),
    targetAttribute:option('targetAttributeSelect'),secondaryAttribute:scenario==='hif'?option('secondaryAttributeSelect'):'',
    plv:option('producerLevelInput')};
  const params=new URLSearchParams(Object.entries(scope).filter(([,value])=>value&&value!=='auto'));
  if(!['sense','logic','anomaly'].includes(scope.plan))params.delete('plan');
  if(!Number.isSafeInteger(Number(scope.plv))||Number(scope.plv)<1)params.delete('plv');
  const version=snapshotVersion(), key=JSON.stringify([version,params.toString()]);
  if(ui.inventoryMemoryScores?.key===key)return ui.inventoryMemoryScores;
  const scenarioLabel={hajime:'하지메',nia:'N.I.A.',hif:'H.I.F.'}[scenario];
  const label=[scenarioLabel,{regular:'레귤러',pro:'프로',master:'마스터',legend:'레전드'}[difficulty],plans[params.get('plan')]||'사본별 플랜'].filter(Boolean).join(' · ');
  const entry=ui.inventoryMemoryScores={key,label};
  api('/api/inventory-memory-scores?'+params).then(data=>{
    if(version!==data.inventoryVersion){
      if(ui.inventoryMemoryScores===entry)ui.inventoryMemoryScores=null;
      return loadState(false,true);
    }
    entry.scores=new Map(data.scores);
  }).catch(()=>{entry.error=true;}).finally(()=>{
    if(ui.inventoryMemoryScores===entry&&ui.view==='inventory'&&ui.collection==='memories'&&ui.memorySort==='memory-score')renderInventory();
  });
  return entry;
}
function cardMarkup(record,index){
  if(ui.collection==='memories')return memoryCopyCard(record,index);
  return '<button type="button" class="owned-card art-card '+attributeOf(record)+'" data-record-index="'+index+'">'+cardBodyMarkup(record,ui.collection)+'</button>';
}
function filteredRecords(){
  const query=normalized($('searchInput').value),rarity=$('rarityFilter').value,plan=$('planFilter').value,attribute=ui.collection==='supportCards'?$('attributeFilter').value:'',sort=$('sortSelect').value,bonus=ui.collection==='memories'?$('memoryBonusFilter').value:'';
  const rows=recordsOf(ui.collection).filter(record=>{
    if(rarity&&rarityOf(record)!==rarity||plan&&planOf(record)!==plan||attribute&&attributeOf(record)!==attribute)return false;
    if(bonus==='hif'&&!array(memoryEffectsOf(record)?.hifEffects).length)return false;
    if(bonus==='startSkill'&&memoryPhase(record).availableAtStart!==true)return false;
    if(['initialStats','growthRatePermil'].includes(bonus)&&!memoryHasStatBonus(record,bonus))return false;
    if(!query)return true;
    const names=ui.collection==='memories'
      ?[memoryCopyName(record),skillJaOf(record),characterNameOf(record),characterJaOf(record),...array(record.customizationLabels)]
      :[record.nameKo,record.name,record.nameJa,record.characterName,record.characterNameJa,record.idolName,record.idolNameJa,skillOf(record),skillJaOf(record),...array(record.aliases)];
    return normalized(names.join(' ')).includes(query);
  });
  if(ui.collection==='memories'){
    const scores=sort==='memory-score'?ui.inventoryMemoryScores?.scores:null;
    return rows.sort((a,b)=>compareMemoryCopies(a,b,scores));
  }
  rows.sort((a,b)=>{if(sort==='level')return (levelOf(b)??-1)-(levelOf(a)??-1)||nameOf(a).localeCompare(nameOf(b),'ko');if(sort==='uncap')return (uncapOf(b)??-1)-(uncapOf(a)??-1)||nameOf(a).localeCompare(nameOf(b),'ko');return nameOf(a).localeCompare(nameOf(b),'ko');});return rows;
}
function renderInventory(){
  const idols=ui.collection==='idolCards',status=categoryStatus(ui.collection);
  $('collectionStatus').textContent=status==='complete'?'전체 수집':status==='partial'?'부분 수집':status==='error'?'확인 필요':'수집 대기';
  $('inventoryGrid').hidden=idols;
  $('resultCount').closest('.results-caption').hidden=idols;
  if(typeof renderIdolGoalRanks==='function')renderIdolGoalRanks();
  if(idols){$('inventoryEmpty').hidden=true;$('pagination').hidden=true;return;}
  const all=recordsOf(ui.collection);
  if(ui.collection==='memories'){
    ui.memorySort=$('sortSelect').value;
    const wanted=ui.memorySort==='memory-score'&&all.length;
    const entry=wanted&&ui.view==='inventory'?loadInventoryMemoryScores():null;
    $('memoryOrderNote').textContent=entry?' · '+entry.label+' · '+(entry.scores?'반입 비교 점수':entry.error?'점수 불러오기 실패':'점수 계산 중'):' · 초기값 / 성장률(%)';
  }
  const rows=filteredRecords(),count=rows.length;
  ui.page=Math.max(1,Math.min(ui.page,Math.ceil(count/ui.pageSize)||1));const start=(ui.page-1)*ui.pageSize;
  ui.visibleRecords=rows.slice(start,start+ui.pageSize);
  $('inventoryGrid').classList.toggle('memory-collection',ui.collection==='memories');writeMarkup('inventoryGrid',ui.visibleRecords.map(cardMarkup).join(''),'inventoryMarkup');$('inventoryEmpty').hidden=count>0;
  const unit=ui.collection==='memories'?'개':'장';
  if(!all.length&&status!=='complete')$('resultCount').textContent='보유 목록이 아직 수집되지 않았습니다.';
  else $('resultCount').textContent=(status==='complete'?'보유 ':'확인된 ')+all.length.toLocaleString('ko-KR')+unit+(count!==all.length?' · 검색 결과 '+count.toLocaleString('ko-KR')+unit:'');
  const empty=$('inventoryEmpty');empty.querySelector('h2').textContent=all.length?'일치하는 카드가 없어요':status==='complete'?'아직 보유한 항목이 없어요':status==='error'?'이 목록을 확인하지 못했어요':'나의 컬렉션을 기다리는 중';empty.querySelector('p').innerHTML=all.length?'검색어나 필터를 바꿔 다시 찾아보세요.':status==='complete'?'다음에 수집된 보유정보도 이곳에 반영됩니다.':status==='error'?'연결 상태를 확인한 뒤 다시 확인해 주세요.<br>읽지 못한 항목은 미보유로 판단하지 않습니다.':'수집된 보유정보가 도착하면<br>카드와 메모리를 여기에서 확인할 수 있어요.';
  $('pagination').hidden=count<=ui.pageSize;$('pageLabel').textContent=`${ui.page} / ${Math.ceil(count/ui.pageSize)||1}`;$('previousPage').disabled=ui.page===1;$('nextPage').disabled=ui.page*ui.pageSize>=count;
}
function renderRecommendPicker(){if(typeof renderCompactRecommendPicker==='function')renderCompactRecommendPicker();}
function syncIdolScenarios(select, idol) {
  if (!select) return;
  const excluded = array(idol?.excludedScenarios);
  for (const option of select.options) option.disabled = excluded.includes(option.value);
  if (excluded.includes(select.value)) {
    select.value = [...select.options].find(option => !option.disabled)?.value ?? '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
function syncRecommendationTypeOptions(){
  const idol=selectedVariant(),actualPlan=planOf(idol??{}),chosenPlan=actualPlan||$('recommendPlan').value;
  syncIdolScenarios($('scenarioSelect'), idol);
  for(const option of $('recommendPlan').options)option.disabled=Boolean(actualPlan&&option.value&&option.value!==actualPlan);
  if(actualPlan&&$('recommendPlan').value&&$('recommendPlan').value!==actualPlan)$('recommendPlan').value=actualPlan;
  const allowed={sense:['concentration','goodConditionTurns'],logic:['motivation','goodImpressionTurns'],anomaly:['fullPower','strength','preservation']}[chosenPlan];
  for(const option of $('strategySelect').options)option.disabled=Boolean(option.value&&allowed&&!allowed.includes(option.value));
  if(allowed&&$('strategySelect').value&&!allowed.includes($('strategySelect').value))$('strategySelect').value='';
}
function renderIdolOptions(){
  const select=$('idolSelect'),selected=select.value;const options=recordsOf('idolCards').map(record=>`<option value="${escapeHtml(recordId(record))}">${escapeHtml(nameOf(record)+(japaneseNameOf(record)?' / '+japaneseNameOf(record):'')+(characterNameOf(record)?' · '+characterNameOf(record):''))}</option>`).join('');const markup='<option value="">보유 P아이돌에서 자동 선택</option>'+options;
  if(ui.idolOptionsMarkup!==markup){select.innerHTML=markup;ui.idolOptionsMarkup=markup;if([...select.options].some(option=>option.value===selected))select.value=selected;}
  syncRecommendationTypeOptions();renderRecommendPicker();renderConnection();
}
function selectRecommendIdol(id){const record=recordsOf('idolCards').find(item=>recordId(item)===id);if(!record)return;ui.recommendCharacterId=characterKey(record);$('idolSelect').value=id;$('idolSelect').dispatchEvent(new Event('change',{bubbles:true}));}

function renderCatalogStatus() {
  const label = $('catalogStatus'), sync = ui.state?.catalogSync;
  if (!label || !sync) return;
  const date = sync.publishedAt ? new Date(sync.publishedAt).toLocaleDateString('ko-KR') : '';
  const status = { checking: '새 카드 확인 중', offline: '갱신 대기 · 저장된 자료 사용', ready: '자동 갱신' }[sync.status] || '';
  label.textContent = ['카드 자료', date, status].filter(Boolean).join(' · ');
  label.hidden = false;
}
async function loadState(manual=false,force=false){if(ui.fetching&&!force)return ui.fetching;if(manual)$('refreshButton').classList.add('refreshing');
  const epoch=++ui.stateRequestEpoch;
  const request=(async()=>{
    try {
      const next=await api('/api/state');
      if(epoch!==ui.stateRequestEpoch)return;
      if(!next||typeof next!=='object'||!next.inventory)throw new Error('보유정보 형식을 확인하지 못했습니다.');
      const previous=ui.state?snapshotVersion():null, previousCatalog=ui.state?.catalogVersion;
      ui.state=next;
      if(previous!==null&&previous!==snapshotVersion()&&typeof invalidatePostMemoryInventory==='function')invalidatePostMemoryInventory();
      if(next.catalogVersion && previousCatalog && previousCatalog!==next.catalogVersion && typeof reloadCardCatalog==='function')reloadCardCatalog();
      if(next.catalogSync)renderCatalogStatus();
      renderConnection();renderInventory();renderIdolOptions();
      if(ui.recommendation&&!ui.recommending&&ui.renderedRecommendationStale!==recommendationHoldingsChanged())renderRecommendation();
      if(manual)toast('보유정보를 다시 확인했습니다.');
    } catch(error) {
      if(epoch!==ui.stateRequestEpoch)return;
      if(!ui.state){ui.state={connection:{status:'error',message:error.message},inventory:{}};renderConnection();renderInventory();}
      else{$('connectionBanner').className='connection-banner error';$('connectionTitle').textContent='연결을 확인하지 못했어요';$('connectionMessage').textContent='화면에는 마지막으로 확인한 자료를 표시하고 있습니다.';}
      if(manual)toast(error.message,true);
    } finally {
      if(epoch===ui.stateRequestEpoch){ui.fetching=null;$('refreshButton').classList.remove('refreshing');}
    }
  })();ui.fetching=request;return request;
}

function detailFact(label,value){return `<div class="detail-fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? '미확인')}</strong></div>`;}
function openDetail(record){
  $('detailDialog').classList.toggle('memory-detail',category==='memories'); const title=category==='memories'?memoryCopyName(record):nameOf(record),japanese=category==='memories'?skillJaOf(record,title):japaneseNameOf(record,title);$('detailCategory').textContent=collections[category]+' 상세';const rarity=rarityOf(record),plan=planOf(record),attribute=attributeOf(record);let facts='';
  if(category==='supportCards')facts+=detailFact('현재 레벨',levelOf(record)===null?null:'Lv.'+levelOf(record))+detailFact('돌파',uncapOf(record)===null?null:uncapOf(record)+'돌')+detailFact('레벨 상한',firstNumber(record.levelCap,record.maxLevel,record.raw?.levelCap))+detailFact('플랜',plans[plan]);
  if(category==='idolCards'){const growth=record.characterGrowth;facts+=detailFact('특훈',uncapOf(record)===null?null:uncapOf(record)+'단계')+detailFact('재능개화',firstNumber(record.potentialRank,record.awakening,record.raw?.potentialRank))+detailFact('플랜',plans[plan])+detailFact('육성 유형',effects[record.recommendedEffect])+detailFact('호감도 포인트',firstNumber(growth?.dearnessPoint))+detailFact('트루엔드 달성',Array.isArray(growth?.trueEndProduceTypes)?growth.trueEndProduceTypes.length+'종':null)+detailFact('프리마 스텔라',Object.hasOwn(record.raw??{},'primaStellaUpgradedTime')?(record.primaStella?'완료':'미완료'):null);}
  if(category==='memories')facts+=detailFact('반입 스킬 등장 시점',memoryPhase(record).label)+detailFact('플랜',plans[plan]);
  const abilities=category==='supportCards'?supportAbilityNames(record):abilityNames(record),description=plainGameText(record.description)||plainGameText(record.effectDescription),card=record.effects?.carriedSkill??record.produceCard??record.raw?.produceCard??{},customizations=array(card.customizes??record.customizes).filter(item=>item&&typeof item==='object');
  let extra='';if(category==='memories'){extra+=memoryEffectsMarkup(record,true,false);extra+=`<section class="detail-section"><h3>반입 스킬 / 持ち込みスキル</h3><div class="detail-skill">${assetUrl(record.skillImageUrl)?visualFrame(record.skillImageUrl,(skillOf(record)||'반입 스킬')+' 그림','detail-skill-art'):''}<div><p>${escapeHtml(title)}</p>${skillJaOf(record)?`<p class="name-ja" lang="ja">${escapeHtml(skillJaOf(record))}</p>`:''}<p>${firstNumber(card.upgradeCount,card.upgrade,record.upgradeCount)!==null?'강화 '+firstNumber(card.upgradeCount,card.upgrade,record.upgradeCount)+'회':''}${customizations.length?' · 커스텀 '+customizations.length+'종':''}</p>${array(record.customizationLabels).length?`<p>${escapeHtml(record.customizationLabels.join(' · '))}</p>`:''}${card.customizationCalculationStatus==='not_simulated'?'<p class="skill-customization-note">커스텀을 반영한 효과는 검증 중입니다.</p>':''}</div></div></section>`;extra+=`<section class="detail-section"><h3>어빌리티</h3>${abilities.length?`<ul class="ability-list">${abilities.map(ability=>`<li>${escapeHtml(plainGameText(ability.name))}${ability.level!==null?' · Lv.'+ability.level:''}</li>`).join('')}</ul>`:'<p>수집된 어빌리티 정보가 없습니다.</p>'}</section>`;}
  else if(abilities.length)extra+=`<section class="detail-section"><h3>주요 효과</h3><ul class="ability-list">${abilities.map(ability=>`<li>${escapeHtml(plainGameText(ability.name))}</li>`).join('')}</ul></section>`;
  if(category==='memories')extra+=memoryProduceRecordMarkup(record);
  if(description)extra+=`<section class="detail-section"><h3>효과 설명</h3><p>${memoryRichTextMarkup(description)}</p></section>`;
  const detailNote=category==='idolCards'&&record.owned===false?'미보유 의상의 카탈로그 사양입니다.':escapeHtml(labelTime(ui.state?.connection?.capturedAt))+'에 확인한 보유정보 기준입니다. 아직 확인하지 못한 항목은 미확인으로 표시합니다.';
  $('detailContent').innerHTML=`${category==='memories'?'':`<div class="detail-artwork">${artworkMarkup(record,category,true)}</div>`}${category==='supportCards'&&attribute?`<div class="attribute-ribbon ${attribute}">${attributes[attribute]}</div>`:''}<h2 id="detailTitle" class="detail-title">${escapeHtml(title)}</h2>${japanese?`<p class="detail-subtitle name-ja" lang="ja">${escapeHtml(japanese)}</p>`:''}${category==='memories'?`<div class="memory-detail-priority"><div class="memory-skill-phase">${escapeHtml(memoryPhase(record).label)}</div>${memoryMetricsSummaryMarkup(record)}</div>`:''}${characterMarkup(record,'detail-character')}<div class="detail-badges">${rarity?`<span class="rarity-badge ${rarity.toLowerCase()}">${rarity}</span>`:''}<span class="plan-chip">${plans[plan]||'플랜 미확인'}</span>${category!=='supportCards'&&attribute?`<span class="attribute-chip ${attribute}">${attributes[attribute]}</span>`:''}</div>${category==='idolCards'?growthMarkup(record)+growthBreakdownMarkup(record):''}<div class="detail-facts">${facts}</div>${extra}<p class="detail-note">${detailNote}</p>`;
  if(!$('detailDialog').open)$('detailDialog').showModal();
}

function reasonText(value){if(Array.isArray(value))return value.map(reasonText).filter(Boolean).join('\n');if(typeof value==='string')return value;if(value&&typeof value==='object')return text(value.message)||text(value.text)||text(value.reason);return '';}
function rentalOf(entry){const record=entry.card??entry.memory??entry.idol??entry;return entry.isRental===true||record.isRental===true||entry.source==='rental'||record.source==='rental';}
function memoryCarryValues(record){
  const effects=memoryEffectsOf(record)??record.modelEffects??{},original=recordsOf('memories').find(row=>recordId(row)===recordId(record)),initial=growthVector(effects.initialStats),growth=growthVector(effects.growthRatePermil),completed=growthVector(record.produceRecordStats??record.stats??original?.stats??record);
  const initialKnown=['vo','da','vi'].every(axis=>initial[axis]!==null),total=initialKnown?initial.vo+initial.da+initial.vi:null;
  return {initial,growth,completed,total};
}
function memoryFindStatsMarkup(record){
  const {initial,growth,completed,total}=memoryCarryValues(record);
  const row=(label,values,percent=false)=>`<div><span>${label}</span><strong>${[['vo','Vo'],['da','Da'],['vi','Vi']].map(([key,name])=>`${name} ${percent?growthPercent(values[key]):values[key]===null?'미확인':formatNumber(values[key])}`).join(' · ')}</strong></div>`;
  return `<div class="memory-find-stats">${row('반입 초기',initial)}<small>확인된 초기 스탯 합 ${total===null?'미확인':'+'+formatNumber(total)} · 스킬 성능의 종합점수는 아니에요.</small>${row('반입 성장',growth,true)}${row('게임에서 찾을 완성 스탯',completed)}<small>완성 스탯은 반입 수치에 더하지 않아요.</small></div>`;
}
function memoryRoleSummaryMarkup(record){
  const labels={attack:'공격',draw:'드로우',extra_action:'추가 행동',strengthen:'강화'};
  const roles=array(record.battleRoleProfile?.roles).map(role=>labels[role]).filter(Boolean);
  return roles.length?`<p class="memory-role-summary">스킬 역할 · ${escapeHtml(roles.join(' · '))}</p>`:'';
}
function carryCopyPhase(record,scenario){
  const phase=memoryPhase(record);
  if(phase.availableAtStart===true)return '육성 시작 시 합류';
  return scenario==='hif'&&phase.availableAtStart===false?'선발 1 후 합류':phase.label;
}
function carryCopyIcon(record){
  const exact=assetUrl(record.skillImageUrl),bundled=assetUrl(record.skillCard?.thumbnailUrl,record.skillCard?.imageUrl);
  return exact.startsWith('/assets/live/')?bundled||exact:exact||bundled;
}
function carryCopyHeading(record){
  const name=memoryCopyName(record),icon=carryCopyIcon(record);
  const title=name.endsWith('+')?escapeHtml(name.slice(0,-1))+'<span class="memory-copy-plus">+ 강화</span>':escapeHtml(name);
  const upgrade=firstNumber(record.effects?.carriedSkill?.upgrade,record.effects?.carriedSkill?.upgradeCount);
  return `<span class="memory-copy-heading">${icon?`<img class="memory-copy-icon" src="${escapeHtml(icon)}" alt="" loading="lazy">`:''}
    <span class="memory-copy-title"><strong class="memory-copy-name">${title}</strong>${upgrade===0?'<small>미강화</small>':''}</span></span>`;
}
function carryCopyChangesMarkup(changes){
  const axes={vocal:'Vo',dance:'Da',visual:'Vi'};
  const signed=n=>(n>0?'+':'')+formatNumber(n);
  const changesFor=(values,format)=>Object.entries(values??{}).filter(([,value])=>value!==0).map(([axis,value])=>axes[axis]+' '+format(value)).join(' · ');
  const initial=changesFor(changes.initial,signed),growth=changesFor(changes.growth,growthPercent);
  const differences=[initial?'초기 '+initial:'',growth?'성장 '+growth:'',
    changes.genkiRate?`기본 원기 비례 ${changes.genkiRate[0]}배 → ${changes.genkiRate[1]}배`:'',
    changes.upgradeChanged?'강화 변경':'',changes.phaseChanged?'합류 시점 변경':'',
    changes.customizationChanged?'개조 변경':'',changes.hifChanged?'H.I.F. 효과 변경':'',changes.useConditionChanged?'사용 조건·비용 변경':''].filter(Boolean);
  return differences.length?differences.join(' / '):'표시된 반입 수치·조건 동일';
}
function carryCopyDetailMarkup(record){
  const {completed}=memoryCarryValues(record);
  const customs=array(record.storedCustomizations).map(custom=>{
    const label=custom.label||custom.descriptionJa||custom.description||'개조 이름 미확인';
    const count=custom.exactCountKnown?formatNumber(custom.customizeCount)+'단계':'단계 미확인';
    return `<li><strong>${escapeHtml(label)} · ${escapeHtml(count)}</strong>${custom.id?`<small class="carry-copy-custom-id">${escapeHtml(custom.id)}</small>`:''}</li>`;
  }).join('');
  return `<section class="detail-section"><h3>사본 완성 스탯</h3><div class="detail-facts">${[['vo','Vo'],['da','Da'],['vi','Vi']].map(([axis,label])=>detailFact(label,formatNumber(completed[axis]))).join('')}</div></section>
    <section class="detail-section"><h3>사본 개조</h3>${customs?`<ul class="ability-list">${customs}</ul>`:'<p>확인된 개조 없음</p>'}</section>`;
}
function openCarryCopyDetail(record,scenario){
  const dialog=$('detailDialog'),name=memoryCopyName(record),icon=carryCopyIcon(record);
  const hif=array(memoryEffectsOf(record)?.hifEffects).filter(Boolean);
  dialog.classList.add('memory-detail');
  $('detailCategory').textContent='반입 메모리';
  $('detailContent').innerHTML=`<div class="carry-copy-dialog-title">
    ${icon?`<img class="memory-copy-icon" src="${escapeHtml(icon)}" alt="">`:''}<h2 id="detailTitle" class="detail-title">${escapeHtml(name)}</h2></div>
    <div class="memory-skill-phase">${escapeHtml(carryCopyPhase(record,scenario))}</div>${carryCopyDetailMarkup(record)}
    <section class="memory-effect-group"><h3>H.I.F. 효과</h3>${hif.length?`<ul>${hif.map(effectEntryMarkup).join('')}</ul>`:'<p>확인된 H.I.F. 효과가 없어요.</p>'}</section>`;
  if(!dialog.open)dialog.showModal();
}
function finalMemoryPickMarkup(result){
  const rows=array(result.memories),slots=array(result.memorySelectionReview?.slots),scenario=result.scoreSummary?.scenario;
  const labels={required:'교체 대안 없음',replaceable:'같은 역할로 교체 가능',stats:'스탯용 자유 슬롯'};
  const cards=rows.map((record,index)=>{
    const slot=slots[index],replacementCards=array(slot?.replacementCards),alternatives=array(slot?.alternatives);
    const kind=slot?.kind==='replaceable'&&!replacementCards.length?'required':slot?.kind;
    const role=slot?.role&&memoryPhase(record).availableAtStart===false?`합류 후 ${slot.role}`:slot?.role;
    const label=kind==='replaceable'&&!alternatives.length?'현재 대안 사본 없음':labels[kind];
    const card=`<button type="button" class="memory-copy-card" data-carry-copy="${index}" aria-haspopup="dialog">
      ${carryCopyHeading(record)}<span class="memory-copy-character">${escapeHtml(carryCopyPhase(record,scenario))}</span>
      ${label?`<strong class="carry-copy-kind ${kind}">${label}</strong>`:''}
      ${role?`<span class="carry-copy-role">${escapeHtml(role)}</span>`:''}${memoryCopyStatsMarkup(memoryEffectsOf(record))}</button>`;
    const comparisonNote=rows.length===4?'다른 세 장을 그대로 둔 비교입니다.':'나머지 추천 카드를 유지한 비교입니다.';
    const deadline=slot?.latestPhase===1?(scenario==='hif'?'선발 1 전 · 육성 시작 시 합류 필요':'첫 시험 전 · 육성 시작 시 합류 필요'):
      scenario==='hif'?'선발 1 후 합류하는 사본도 사용 가능':'중간 시험 후 합류하는 사본도 사용 가능';
    const owned=alternatives.length?`<ul class="carry-copy-alternatives">${alternatives.map(({memory,changes},i)=>
      `<li><button type="button" data-carry-copy="${index}" data-carry-alternative="${i}" aria-haspopup="dialog">
        ${carryCopyHeading(memory)}<span class="memory-copy-character">${escapeHtml(carryCopyPhase(memory,scenario))}</span>
        <span>${escapeHtml(carryCopyChangesMarkup(changes))}</span></button></li>`).join('')}</ul>`:'<p>조건에 맞는 보유 사본이 없어요.</p>';
    const choices=replacementCards.length?expandableMarkup('교체 대안 보기',`<p>${comparisonNote}</p>
      <h4>교체 가능한 카드</h4>${kind!=='stats'?`<p>${escapeHtml(deadline)}</p>`:''}
      <ul class="carry-replacement-cards">${replacementCards.map(candidate=>`<li>${escapeHtml(candidate.name)}${candidate.minimumUpgrade>0?' · 강화 필요':''}${candidate.owned?'':' <small>조건 맞는 보유 사본 없음</small>'}</li>`).join('')}</ul>
      <h4>지금 가진 대안 사본 <small>${alternatives.length}장</small></h4>${owned}`,'carry-alternatives-'+index):'';
    return `<article class="carry-copy">${card}${choices}</article>`;
  }).join('');
  return `<section class="final-memory-pick" id="mainMemoryPick"><h3>반입 메모리 <small>${rows.length}장</small></h3>
    ${cards?`<div class="final-memory-summary">${cards}</div>`:'<p>현재 조건에서 반입할 사본을 확인하지 못했어요.</p>'}</section>`;
}
function supportContributionMarkup(card){
  const value=card.supportContribution;
  if(value?.comparison!=='remove_one_same_route')return '';
  const signed=n=>Number.isFinite(n)?(n>0?'+':'')+formatNumber(n):'미확인';
  const stats=[['vocal','Vo'],['dance','Da'],['visual','Vi']].map(([axis,label])=>label+' '+signed(value.cappedStatDelta?.[axis])).join(' · ');
  const badge=Number.isFinite(value.badgeEvaluationPoints)?' · 와펜 '+signed(value.badgeEvaluationPoints)+'점':'';
  return `<p class="easy-small-note"><strong>이 카드의 기여 ${signed(value.partialEvaluationPoints)}점</strong><br>${stats}</p><p>같은 경로와 나머지 편성을 고정하고 이 카드 한 장을 뺐을 때의 차이입니다. 스탯 ${signed(value.statEvaluationPoints)}점${badge}. 여러 카드가 함께 만든 효과는 각 카드의 기여에 나타나므로 카드별 점수를 서로 더하면 겹칩니다.</p>`;
}
function recommendedRows(rows,start=0,kind='supportCards',showDetails=true,chooseRental=false){return rows.map((entry,index)=>{
  const nested=entry.card??entry.memory??entry.idol??entry;
  const record={...entry,...nested,imageUrl:nested.imageUrl??entry.imageUrl,thumbnailUrl:nested.thumbnailUrl??entry.thumbnailUrl,idolImageUrl:nested.idolImageUrl??entry.idolImageUrl,skillImageUrl:nested.skillImageUrl??entry.skillImageUrl,baseStats:nested.baseStats??entry.baseStats};
  const memory=kind==='memories',name=memory?(skillOf(record)||entry.displayName||nameOf(record)):(text(record.nameKo)||entry.displayName||nameOf(record));
  const japanese=memory?skillJaOf(record,name):japaneseNameOf(record,name),attribute=attributeOf(record);
  let reason=reasonText(entry.reason??entry.reasons??record.reason);if(rentalOf(entry))reason=reason.replace(/보유 레벨\s*(\d+)/g,'대여 가정 레벨 $1');
  const title=memory?memorySkillVisualMarkup(record,{size:24,showJapanese:true}):bilingualMarkup(name,japanese,'easy-card-name');
  const facts=memory?memorySkillEligibilityMarkup(record)+memoryEffectsMarkup(record):kind==='idolCards'?growthMarkup(record,true):supportContributionMarkup(record);
  const details=`${japanese?`<div class="name-ja" lang="ja">${memory?memorySkillVisualMarkup({...record,nameJa:japanese},{size:18,label:japanese,preserveLabel:true}):escapeHtml(japanese)}</div>`:''}${memory?'':characterMarkup(record)}${facts}${reason?`<p class="detail-raw-reason">${memoryRichTextMarkup(reason)}</p>`:''}`;
  const choose=chooseRental?`<button type="button" class="button button-secondary rental-choice-button" data-rental-choice="${escapeHtml(entry.gameId)}" aria-label="${escapeHtml(name)} 대여로 다시 비교">이 카드로 다시 비교</button>`:'';
  return `<div class="recommended-card visual-recommendation ${attribute}"><div class="recommended-artwork">${artworkMarkup(record,kind)}</div><div class="recommended-content"><div class="recommended-card-title">${title}${rentalOf(entry)?'<span class="rental-badge">대여</span>':''}${levelOf(record)!==null?`<span class="small-tag">${kind==='supportCards'&&record.levelBasis==='uncapMax'&&record.ownedLevel<record.level?'보유 Lv.'+record.ownedLevel+' → ':''}Lv.${levelOf(record)}</span>`:''}</div>${memory?`${memoryOwnerMarkup(record)}${memoryRoleSummaryMarkup(record)}<div class="memory-skill-phase">${escapeHtml(memoryPhase(record).label)}</div>${memoryCustomizationSummaryMarkup(record)}${memoryHifSummaryMarkup(record)}${memoryFindStatsMarkup(record)}`:''}${kind==='supportCards'&&attribute?`<div class="recommend-attribute ${attribute}">${escapeHtml(({vocal:'Vo · 보컬',dance:'Da · 댄스',visual:'Vi · 비주얼',assist:'보조'})[attribute])}</div>`:''}${showDetails?expandableMarkup('효과·선택 이유',details,'card-'+kind+'-'+recordId(record)+'-'+start+'-'+index):''}${choose}</div></div>`;
}).join('');}
function recommendationGroup(title,records,emptyText,supportDeck=false,kind=supportDeck?'supportCards':'idolCards',showDetails=true,footer=''){
  const rows=array(records).filter(entry=>entry&&typeof entry==='object');
  if(!rows.length)return `<section class="recommend-group"><h3>${escapeHtml(title)}</h3><p class="recommend-empty-group">${escapeHtml(emptyText)}</p>${footer}</section>`;
  return `<section class="recommend-group"><h3>${escapeHtml(title)}<small>${supportDeck?'보유 '+rows.filter(entry=>!rentalOf(entry)).length+'장 · 대여 '+rows.filter(rentalOf).length+'장':rows.length+'장'}</small></h3><div class="simple-recommend-grid">${recommendedRows(rows,0,kind,showDetails)}</div>${footer}</section>`;
}
function memoryRequirementsMarkup(result){const requirements=result.memoryRequirements??result.scoreSummary?.hifModel?.memoryRequirements;if(!requirements)return result.scoreSummary?.hifModel?'<div class="memory-requirements unconfirmed"><strong>필수 메모리 조건 충족 여부 미확인</strong></div>':'';const requested=array(requirements.requested),missing=array(requirements.missing??requirements.unmet);const guide=guideMemoryProfileOf(result);if(!requested.length&&(guide?.considered===true||guide?.applied===true))return `<div class="memory-requirements guide-applied"><strong>${guide.applied===true&&guide.tentative!==true?'공략의 확인된 반입 역할을 우선 비교':'공략 역할 후보를 우선 비교'}</strong><p>${guideProfileHint(guide)}</p></div>`;if(!requested.length)return '<div class="memory-requirements unspecified"><strong>스탯 보너스 중심 비교 · 핵심 스킬 미지정</strong><p>반입 스탯을 비교한 후보입니다. 원하는 핵심 스킬을 갖춘 편성으로 확인한 결과는 아니에요.</p></div>';const groups=new Map(ownedMemorySkillGroups('',true).map(group=>[group.id,group]));const targetMarkup=target=>{if(typeof target!=='string')return '지정한 메모리 조건';if(target.startsWith('skill:')){const id=target.slice(6),group=ui.recommendationMemorySkillNames?.[id]??groups.get(id);return group?memorySkillVisualMarkup({gameId:id,nameKo:group.name,nameJa:group.nameJa},{size:22}):'지정한 반입 스킬';}const id=target.startsWith('hif:')?target.slice(4):target;const effect=recordsOf('memories').flatMap(memory=>array(memoryEffectsOf(memory)?.hifEffects)).find(effect=>effect.effectId===id);return effect?bilingualMarkup(text(effect.nameKo)||text(effect.name)||'H.I.F. 필수 효과',text(effect.nameJa),'requirement-skill-name'):'H.I.F. 필수 효과';};return `<div class="memory-requirements ${missing.length?'unmet':'fulfilled'}"><strong>${missing.length?'필수 메모리 조건을 모두 충족하지 못했어요':'필수 메모리 조건 충족 · '+requested.length+'개'}</strong><p>${missing.length?'아래 목표가 빠져 있습니다. 보유 여부와 반입 조건을 확인해 주세요.':'지정한 반입 조건을 충족한 범위에서 비교했습니다. 전체 성능의 최적 편성을 뜻하지는 않아요.'}</p><ul>${(missing.length?missing:requested).map(target=>`<li>${targetMarkup(target)}</li>`).join('')}</ul></div>`;}
function hifComparisonMarkup(result){const model=result.scoreSummary?.hifModel;if(!model)return '';const stats=growthVector(model.cappedStats),caps=growthVector(model.statCaps),discarded=growthVector(model.discardedStats),counts=model.attributeCounts??{};const composition=[['vocal','Vo'],['dance','Da'],['visual','Vi'],['assist','보조']].map(([axis,label])=>number(counts[axis])!==null?`${label} ${counts[axis]}장`:'').filter(Boolean).join(' · ');const templates={'3-3':'3 + 3','4-2':'4 + 2','3-2+assist':'3 + 2 + 보조 1','4-1+assist':'4 + 1 + 보조 1',single_explicit:'단일 속성'};const directions=[model.primaryAttribute?`주속성 ${attributes[model.primaryAttribute]||''}`:'',model.secondaryAttribute?`부속성 ${attributes[model.secondaryAttribute]||''}`:''].filter(Boolean);const unresolved=array(model.unresolved).map(reasonText).filter(Boolean);return `<section class="hif-comparison"><div class="hif-comparison-heading"><h3>H.I.F. 조건부 편성 비교</h3><span>${templates[model.deckTemplate]||'자동 탐색 편성'}</span></div>${composition?`<p class="hif-composition">${escapeHtml(composition)}</p>`:''}${directions.length?`<p class="hif-directions">${escapeHtml(directions.join(' / '))}</p>`:''}<div class="hif-model-stats">${[['vo','Vo','vocal'],['da','Da','dance'],['vi','Vi','visual']].map(([axis,label,attribute])=>`<div class="hif-model-axis ${attribute}"><span>${label} 상한 반영 모형값</span><strong>${formatNumber(stats[axis])}</strong><small>${model.statCapsVerified===true?'계정 상한':'참고 상한'} ${formatNumber(caps[axis])}</small>${discarded[axis]!==null?`<small>상한 초과 제외 ${formatNumber(discarded[axis])}</small>`:''}</div>`).join('')}</div><p class="hif-model-note">미계산 효과가 남아 있는 조건부 비교입니다. 실제 육성 결과나 시험 점수의 예측값으로 확정하지 않아요.</p>${unresolved.length?`<details class="hif-unresolved"><summary>아직 계산하지 못한 효과</summary><ul>${unresolved.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></details>`:''}</section>`;}
function hifAttributeComparisonMarkup(result){const model=result.scoreSummary?.hifModel,rows=array(model?.attributeComparison);if(!model)return '';const rule=model.supportPeakScenario
    ? (model.preparationComparison?.enabled?'설정된 준비 조건을 먼저 적용합니다. ':'')+(model.supportRating?.badgeEvaluationPoints!=null?'각 후보의 선발·본선 상한을 적용한 스탯 평가점과 와펜의 기본 스타성 기여를 비교합니다.':'각 후보의 선발·본선 상한을 적용한 스탯 평가점을 비교합니다.')
    : model.preparationComparison?.enabled?'자동은 준비 목표를 충족한 후보를 우선하고, 그 안에서 상한 반영 스탯 합계를 비교합니다.':'자동은 Vo + Da + Vi의 상한 반영 능력치 합계를 비교합니다.';
  return `<section class="hif-axis-comparison"><h3>자동 선택은 무엇을 비교했나요?</h3><p><strong>${rule}</strong> 시험 점수·스킬 순환·선발 통과 가능성을 모두 계산한 우열 판정은 아닙니다.</p>${model.examAllocationAssumedEqual?'<p>선발 시험의 보상 능력치는 균등 배분을 가정했습니다. 실제 속성별 시험 득점과 배분을 확인한 값이 아닙니다.</p>':''}${rows.length?`<div class="hif-axis-table-wrap"><table class="hif-axis-table"><thead><tr><th scope="col">레슨 중심</th><th scope="col">Vo</th><th scope="col">Da</th><th scope="col">Vi</th><th scope="col">합계</th><th scope="col">다시 비교</th></tr></thead><tbody>${rows.map(row=>`<tr${row.selected?' class="selected"':''}><th scope="row">${escapeHtml(({vocal:'보컬',dance:'댄스',visual:'비주얼'})[row.primaryAttribute]||row.primaryAttribute)}${row.selected?' · 현재':''}</th>${['vocal','dance','visual'].map(axis=>`<td>${formatNumber(row.cappedStats?.[axis])}</td>`).join('')}<td>${formatNumber(row.modeledStatTotal)}</td><td><button type="button" class="axis-choice-button" data-axis-choice="${escapeHtml(row.primaryAttribute)}">이 속성으로 비교</button></td></tr>`).join('')}</tbody></table></div><p class="hif-axis-note">각 행은 해당 속성의 서포트·메모리·동선을 함께 다시 고른 후보입니다. 대여·SP 보조·필수 메모리 조건에 따라서도 선택 순위가 달라집니다.</p>`:''}</section>`;}
function supportUpgradeMarkup(result){
  const comparison=result.supportUpgradeComparison;if(!comparison)return supportLevelPreviewMarkup();if(!comparison.available)return `<section class="support-upgrade-comparison"><h3>레벨업 후 편성 비교</h3><p>${escapeHtml(comparison.reason||'비교할 레벨업 후보를 확인하지 못했습니다.')}</p></section>`;
  const upgrades=array(comparison.upgrades),supports=Array.isArray(comparison.supports)?comparison.supports:[...array(comparison.supports?.owned),...(comparison.supports?.rental?[{...comparison.supports.rental,isRental:true}]:[])],delta=comparison.statDelta??{},hif=comparison.statBasis==='hif_capped_stats';
  return `<section class="support-upgrade-comparison"><h3>현재 돌파 상한까지 레벨업하면</h3><p>${escapeHtml(comparison.assumption)}</p><p>${hif?'상한을 반영한 능력치 모형 차이':'서포트의 능력치 기여 차이'} · 새로 채택되는 보유 카드 ${array(comparison.addedSupportIds).length}장</p><div class="upgrade-stat-grid">${[['vocal','Vo'],['dance','Da'],['visual','Vi']].map(([axis,label])=>`<div><span>${label} ${formatNumber(comparison.currentStats?.[axis])} → ${formatNumber(comparison.upgradedStats?.[axis])}</span><strong>${number(delta[axis])===null?'미확인':(delta[axis]>0?'+':'')+formatNumber(delta[axis])}</strong></div>`).join('')}</div>${upgrades.length?`<p>아래 ${upgrades.length}장의 레벨업을 가정한 편성입니다.</p><div class="upgrade-card-list">${upgrades.map(card=>`<article class="upgrade-card">${visualFrame(assetUrl(card.thumbnailUrl,card.imageUrl),(card.nameKo||card.name||'서포트')+' 그림','upgrade-card-art')}<div><strong>${escapeHtml(card.nameKo||card.name||card.nameJa||'서포트 카드')}</strong><p>Lv.${escapeHtml(card.currentLevel)} → Lv.${escapeHtml(card.targetLevel)} · 현재 ${escapeHtml(card.uncap)}돌</p></div></article>`).join('')}</div>`:'<p>새 편성에 추가로 레벨업해야 할 보유 카드는 없습니다.</p>'}${comparison.unknownCount?`<p>레벨·돌파·상한이 미확인인 ${escapeHtml(comparison.unknownCount)}장은 상한 레벨로 가정하지 않았습니다.</p>`:''}<details class="upgrade-deck-details"><summary>레벨업 후 서포트·메모리 편성 보기</summary>${recommendationGroup('강화 전 서포트 편성',supportRows(comparison.currentSupports),'비교할 편성이 없습니다.',true)}${hifComparisonMarkup({scoreSummary:comparison.scoreSummary})}${recommendationGroup('레벨업 후 서포트 편성',supports,'비교 편성을 확인하지 못했습니다.',true)}${guideMemoryProfileMarkup({scoreSummary:comparison.scoreSummary})}${recommendationGroup('레벨업 후 반입 메모리',comparison.memories,'비교할 메모리가 없습니다.',false,'memories')}</details><p>${escapeHtml(comparison.note)}</p></section>`;
}
function rentalAlternativesMarkup(result){
  const current=array(result.supports).find(rentalOf),rows=array(result.rentalCandidates).filter(row=>row.gameId!==current?.gameId);
  const choices=rows.length?`<div class="simple-recommend-grid rental-alternatives">${recommendedRows(rows.map(row=>({...row,isRental:true})),0,'supportCards',false,true)}</div>`:
    '<p>자동 비교한 다른 후보가 없어요. 아래에서 카드 이름으로 직접 찾을 수 있습니다.</p>';
  return `<details class="rental-options" data-detail-key="rental-options"><summary>대여 대안 보기<span aria-hidden="true">▾</span></summary>
    <p>다른 카드를 고르면 서포트·메모리를 다시 비교해요</p>${choices}
    ${ui.rentalGameId?'<button type="button" class="button button-secondary rental-reset" data-rental-choice="">대여 자동 비교로 돌아가기</button>':''}
    ${rentalSearchMarkup()}</details>`;
}
function recommendationOptions(){
  if(typeof syncCompactRecommendControls==='function')syncCompactRecommendControls();
  const body={scenario:$('scenarioSelect').value,goal:$('goalSelect').value,targetAttribute:$('targetAttributeSelect').value,supportLevelMode:$('supportLevelMode').value,compareSupportUpgrades:$('compareSupportUpgrades').checked,memorySelectionMode:$('memorySelectionMode').value};
  if(body.scenario==='hif'){
    body.secondaryAttribute=$('secondaryAttributeSelect').value||'auto';
    body.deckTemplate=$('deckTemplateSelect').value||'auto';
    if(body.memorySelectionMode==='guide'){
      body.desiredSkillIds=[...ui.selectedMemorySkillIds];
      body.requiredHifEffectIds=[...ui.selectedHifEffectIds];
    }
  }
  body.activityFocus=$('activityFocusSelect').value||'auto';
  if(body.scenario==='hif'&&array(ui.hifExamResults).length)body.hifExamResults=ui.hifExamResults;
  if($('eventModeSelect').value){body.eventModeId=$('eventModeSelect').value;if(ui.eventRentalSkillId)body.eventRentalSkillIds=[ui.eventRentalSkillId];}
  if(body.scenario==='hif'&&!body.eventModeId&&$('supportActionMode')?.value==='route'){
    for(const key of ['hifScenarioItemPath','hifConsultPlan'])if($(key)?.value&&$(key).value!=='auto')body[key]=$(key).value;
  }
  for(const [key,id]of[['idolId','idolSelect'],['plan','recommendPlan'],['type','strategySelect']])if($(id).value)body[key]=$(id).value;
  const producerLevel=firstNumber(number($('producerLevelInput').value),ui.state?.inventory?.producerLevel);if(producerLevel!==null)body.producerLevel=producerLevel;
  if(ui.rentalGameId)body.rentalGameId=ui.rentalGameId;
  if(body.scenario==='hif'&&['guide','unrestricted'].includes($('supportPoolSelect')?.value))body.sourceSupportMode=$('supportPoolSelect').value;
  else if(ui.sourceSupportMode)body.sourceSupportMode=ui.sourceSupportMode;
  if(body.scenario==='hif')body.supportActionMode=$('supportActionMode')?.value||'route';
  if(body.scenario==='hajime')body.difficulty=$('hajimeDifficultySelect')?.value||'legend';
  if(body.scenario==='nia'){
    body.difficulty=$('niaDifficultySelect')?.value||'master';
    body.routePreset=$('excelRoutePreset')?.value||'NIA 通常';
  }
  if(typeof scenarioItemRequestOptions==='function')Object.assign(body,scenarioItemRequestOptions());
  return body;
}
function recommendationConditionsChanged(){return Boolean(ui.recommendationRequest&&JSON.stringify(ui.recommendationRequest)!==JSON.stringify(recommendationOptions()));}
function recommendationHoldingsChanged(){
  const previous=ui.recommendation?.holdingsVersion,current=ui.state?.holdingsVersion;
  return previous?Boolean(current&&previous!==current):ui.recommendationVersion!==snapshotVersion();
}
function markRecommendationConditions(){if(!ui.recommendation||ui.recommending)return;const dirty=recommendationConditionsChanged();if(dirty!==ui.recommendationDirty){ui.recommendationDirty=dirty;renderRecommendation();}}
function renderRecommendation(){
  if(!ui.recommendation)return;
  $('recommendOutput').hidden=false;
  const result=personalizedDisplayResult(ui.recommendation),stale=recommendationHoldingsChanged();
  const warnings=array(result.warnings).map(reasonText).filter(Boolean),assumptions=array(result.assumptions).map(reasonText).filter(Boolean);
  const checked=result.recommendationCache;
  const savedTime=checked?.reused&&checked.checkedAt?`<small>저장 <time datetime="${escapeHtml(checked.checkedAt)}">${escapeHtml(labelTime(checked.checkedAt))}</time></small>`:'';
  const opened=new Set([...$('recommendOutput').querySelectorAll('details[data-detail-key][open]')].map(detail=>detail.dataset.detailKey).concat(array(ui.expandedRecommendationKeys)));
  ui.renderedRecommendationStale=stale;ui.recommendationDirty=recommendationConditionsChanged();
  const proof=forecastOverviewMarkup(result)+activityRouteComparisonMarkup(result)+sourceGuideMarkup(result)+memoryRequirementsMarkup(result)+hifComparisonMarkup(result)+hifAttributeComparisonMarkup(result)+guideMemoryProfileMarkup(result)+
    (warnings.length?`<h3>확인할 조건</h3><ul>${warnings.map(warning=>`<li>${memoryRichTextMarkup(warning)}</li>`).join('')}</ul>`:'')+
    (assumptions.length?`<h3>계산에 둔 가정</h3><ul>${assumptions.map(assumption=>`<li>${memoryRichTextMarkup(assumption)}</li>`).join('')}</ul>`:'');
  const flow=result.runFlowGuidance?.status==='conditional_source_flow'?runFlowGuidanceMarkup(result):personalizedPlanMarkup(result);
  $('recommendOutput').innerHTML=`<div class="recommend-results"><h2>내 카드로 따라가는 육성 안내</h2>
    <div class="recommend-result-tools">${savedTime}<button id="recommendRefreshButton" type="submit" form="recommendForm" class="button button-secondary"${$('recommendButton').disabled?' disabled':''}>다시 추천</button></div>
    ${stale?'<div class="stale-notice" role="status">보유 목록이 바뀌었어요. 다시 추천을 눌러 최신 편성을 확인하세요.</div>':''}
    <nav class="easy-quick-links" aria-label="육성 안내 바로가기"><a href="#mainSupportPick">서포트</a><a href="#mainMemoryPick">반입 메모리</a><a href="#dayRouteOverview">날짜별 동선</a>${modeGuidanceQuickLinks(result)}<a href="#postMemoryView" data-post-memory-open>육성 후 생성 메모리 선택</a></nav>
    <div class="easy-step-heading"><span>1</span><h3>준비 · 지금 가져갈 카드</h3></div>
    <div id="mainSupportPick">${recommendationGroup(result.supportLevelAssumption?.mode==='uncapMax'?'현재 돌파 상한까지 강화할 서포트':'지금 레벨로 가져갈 서포트',result.supports,'현재 조건으로 확인한 조합이 없습니다.',true,'supportCards',false,rentalAlternativesMarkup(result))}</div>
    ${finalMemoryPickMarkup(result)}${dayRouteOverviewMarkup(result)}${weekDialogMarkup()}
    ${recommendedDeckMarkup(result)}${scenarioItemResultMarkup(result)}
    ${typeof sourceRecipeReadinessMarkup==='function'?sourceRecipeReadinessMarkup(result):''}
    <div class="easy-step-heading"><span>2</span><h3>시험 · 카드 쓰는 흐름</h3></div>${typeof idolOperatingGuidanceMarkup==='function'?idolOperatingGuidanceMarkup(result.idolOperatingGuidance):''}${flow}
    ${eventContextMarkup(result)}<div class="easy-step-heading"><span>3</span><h3>진행 · 이번 주 행동과 시험 목표</h3></div>${accountPlaybookMarkup(result)}
    ${expandableMarkup('다음에 만들 메모리 · 파밍 P아이돌',recommendationGroup('메모리 파밍 후보',result.farmingIdols,'확인된 파밍 후보가 없습니다.'),'farming')}
    ${expandableMarkup('경로 비교·예상 스탯·추천 근거',proof,'recommendation-proof')}${catalogFreshnessMarkup()}<section class="post-memory-callout"><h3>육성이 끝나고 생성된 메모리는?</h3><p>원래 생성된 메모리와 재생성 후보의 스킬·개조·일반/HIF 어빌리티를 비교하세요.</p><button type="button" class="button button-secondary" data-post-memory-open>생성·재생성 메모리 고르기</button></section></div>`;
  for(const detail of $('recommendOutput').querySelectorAll('details[data-detail-key]'))detail.open=opened.has(detail.dataset.detailKey);
  ui.expandedRecommendationKeys=[];
}
async function recommend(event){
  event.preventDefault();if(ui.recommending||$('recommendButton').disabled)return;
  const output=$('recommendOutput'),refreshRecommendation=event.submitter?.id==='recommendRefreshButton';
  const body=recommendationOptions(),requestVersion=snapshotVersion();
  ui.expandedRecommendationKeys=[...output.querySelectorAll('details[data-detail-key][open]')].map(detail=>detail.dataset.detailKey);
  ui.recommending=true;output.hidden=false;renderConnection();
  $('recommendButton').innerHTML='<span class="loading-dot" aria-hidden="true"></span> 조합을 비교하고 있어요';
  const recheck=$('recommendRefreshButton');if(recheck&&refreshRecommendation)recheck.textContent='다시 추천 중…';
  if(!ui.recommendation)output.innerHTML='<div class="recommend-empty"><div class="recommend-progress" role="status"><span class="loading-dot" aria-hidden="true"></span>보유 카드와 메모리를 비교하고 있어요. 새 조건은 시간이 걸릴 수 있어요.</div></div>';
  try{
    const result=await api('/api/recommend',{method:'POST',body:JSON.stringify(refreshRecommendation?{...body,refreshRecommendation}:body)},null);
    if(result.inventoryVersion!==snapshotVersion())await loadState(false,true);
    ui.weekChoiceAdvice={};ui.weekExamTargets={};ui.weekLiveState=null;
    ui.recommendationMemorySkillNames=Object.fromEntries(ownedMemorySkillGroups('',true).map(group=>[group.id,{name:group.name,nameJa:group.nameJa}]));
    ui.recommendation=result;ui.recommendationRequest=body;ui.recommendationVersion=result.inventoryVersion??requestVersion;
    startPersonalizedAnalysis(body,ui.recommendationVersion);
  }catch(error){
    if(ui.recommendation)renderRecommendation();
    else output.innerHTML=`<div class="recommend-empty"><div class="recommend-star" aria-hidden="true">!</div><h2>추천 조건을 다시 확인해 주세요</h2><p>${escapeHtml(error.message)}</p></div>`;
    toast(error.message,true);
  }finally{ui.recommending=false;renderConnection();}
}

document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
document.querySelectorAll('[data-collection]').forEach(button=>button.addEventListener('click',()=>setCollection(button.dataset.collection)));
for(const id of ['searchInput','rarityFilter','planFilter','attributeFilter','sortSelect','memoryBonusFilter'])$(id).addEventListener(id==='searchInput'?'input':'change',()=>{
  if(id==='sortSelect'&&ui.collection==='memories'&&ui.inventoryMemoryScores?.error)ui.inventoryMemoryScores=null;
  ui.page=1;renderInventory();
});
$('previousPage').addEventListener('click',()=>{ui.page--;renderInventory();});$('nextPage').addEventListener('click',()=>{ui.page++;renderInventory();});
$('inventoryGrid').addEventListener('click',event=>{const card=event.target.closest('[data-record-index]');if(card)openDetail(ui.visibleRecords[Number(card.dataset.recordIndex)]);});
$('closeDetail').addEventListener('click',()=>$('detailDialog').close());$('detailDialog').addEventListener('click',event=>{if(event.target===$('detailDialog')){const bounds=$('detailDialog').getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)$('detailDialog').close();}});
$('scenarioSelect').addEventListener('change',renderHifProfile);$('recommendPlan').addEventListener('change',()=>{syncRecommendationTypeOptions();renderMemoryTargets();});$('targetAttributeSelect').addEventListener('change',syncHifControls);
$('memorySkillSearch').addEventListener('input',renderMemoryTargets);for(const id of ['memorySkillGrid','selectedMemorySkills'])$(id).addEventListener('click',event=>{const button=event.target.closest('[data-memory-skill]');if(button&&!button.disabled)toggleMemorySkill(button.dataset.memorySkill);});
$('refreshButton').addEventListener('click',()=>loadState(true));$('recommendForm').addEventListener('submit',recommend);$('recommendForm').addEventListener('input',markRecommendationConditions);$('recommendForm').addEventListener('change',markRecommendationConditions);
$('recommendOutput').addEventListener('click',event=>{
  const button=event.target.closest('[data-carry-copy]');if(!button)return;
  const index=Number(button.dataset.carryCopy),result=ui.recommendation,slot=result?.memorySelectionReview?.slots?.[index];
  const record=button.dataset.carryAlternative===undefined?result?.memories?.[index]:slot?.alternatives?.[Number(button.dataset.carryAlternative)]?.memory;
  if(!record)return;
  openCarryCopyDetail({...record,storedCustomizations:record.storedCustomizations??slot?.storedCustomizations},result.scoreSummary?.scenario);
});
$('recommendOutput').addEventListener('click',event=>{const button=event.target.closest('[data-rental-choice]');if(button&&!ui.recommending){ui.rentalGameId=button.dataset.rentalChoice;const profile=array(ui.guideSupportProfiles?.profiles).find(row=>row.idolCardId===$('idolSelect').value&&row.scenario===$('scenarioSelect').value),pool=[...array(profile?.idealSupports),...array(profile?.alternativeSupports)];ui.sourceSupportMode=ui.rentalGameId&&profile&&!pool.some(row=>row.gameId===ui.rentalGameId)?'unrestricted':'';markRecommendationConditions();$('recommendForm').requestSubmit();}});
$('recommendOutput').addEventListener('click',event=>{const button=event.target.closest('[data-axis-choice]');if(button&&!ui.recommending){$('targetAttributeSelect').value=button.dataset.axisChoice;syncHifControls();markRecommendationConditions();$('recommendForm').requestSubmit();}});
$('recommendOutput').addEventListener('click',event=>{const button=event.target.closest('[data-route-choice]');if(button&&!ui.recommending){$('activityFocusSelect').value=button.dataset.routeChoice;markRecommendationConditions();$('recommendForm').requestSubmit();}});
$('recommendOutput').addEventListener('click',event=>{const button=event.target.closest('[data-hif-effect-choice]');if(!button||ui.recommending||button.disabled)return;const id=button.dataset.hifEffectChoice,index=ui.selectedHifEffectIds.indexOf(id);if(index<0)ui.selectedHifEffectIds.push(id);else ui.selectedHifEffectIds.splice(index,1);renderMemoryTargets();markRecommendationConditions();$('recommendForm').requestSubmit();});
$('recommendForm').addEventListener('change',event=>{if(['scenarioSelect','recommendPlan','idolSelect'].includes(event.target.id)&&ui.selectedHifEffectIds.length){ui.selectedHifEffectIds=[];renderMemoryTargets();markRecommendationConditions();}});
$('eventModeSelect').addEventListener('change',()=>{ui.eventRentalSkillId='';ui.hifExamResults=[];markRecommendationConditions();if(ui.recommendation&&!ui.recommending)$('recommendForm').requestSubmit();});
$('recommendForm').addEventListener('change',event=>{if(['scenarioSelect','idolSelect'].includes(event.target.id)&&array(ui.hifExamResults).length){ui.hifExamResults=[];markRecommendationConditions();}});
function saveRecommendationMode(){
  const mode={scenario:$('scenarioSelect').value,activityFocus:$('activityFocusSelect').value,eventModeId:$('eventModeSelect').value,memorySelectionMode:$('memorySelectionMode').value};
  try{localStorage.setItem('owned-note-recommend-mode',JSON.stringify(mode));}catch{}
}
for(const id of ['scenarioSelect','activityFocusSelect','eventModeSelect','memorySelectionMode'])$(id).addEventListener('change',saveRecommendationMode);
$('memorySelectionMode').addEventListener('change',()=>{
  renderMemoryTargets();
  if(ui.recommendation&&!ui.recommending)renderRecommendation();
});
$('recommendForm').addEventListener('change',event=>{if(['scenarioSelect','recommendPlan','idolSelect'].includes(event.target.id)&&ui.rentalGameId){ui.rentalGameId='';ui.sourceSupportMode='';markRecommendationConditions();}});
$('idolSelect').addEventListener('change',()=>{const idol=selectedVariant();if(idol){ui.recommendCharacterId=characterKey(idol);const plan=planOf(idol);if(plan&&plan!=='free')$('recommendPlan').value=plan;$('strategySelect').value=idol.recommendedEffectConflict===false&&effects[idol.recommendedEffect]?idol.recommendedEffect:'';}syncRecommendationTypeOptions();renderRecommendPicker();renderConnection();markRecommendationConditions();});
document.addEventListener('error',event=>{const image=event.target;if(image?.tagName==='IMG'&&image.classList.contains('asset-image')){image.hidden=true;image.closest('.visual-frame')?.classList.remove('has-image');}},true);
document.addEventListener('error', event => {
  const img = event.target;
  if (img?.tagName === 'IMG' && img.getAttribute('src')?.startsWith('/assets/live/')) img.dataset.artRetryAt = String(Date.now() + 300000);
}, true);
document.addEventListener('load', event => {
  const img = event.target;
  if (img?.tagName !== 'IMG' || !img.dataset.artRetryAt) return;
  delete img.dataset.artRetryAt;
  img.hidden = false;
  img.closest('.visual-frame')?.classList.add('has-image');
  const icon = img.closest('.memory-skill-icon');
  if (icon) { icon.classList.remove('is-missing'); icon.removeAttribute('role'); icon.removeAttribute('aria-label'); icon.removeAttribute('title'); }
}, true);
$('importFile').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{if(file.size>50*1024*1024)throw new Error('자료 파일이 너무 큽니다. 50MB 이하의 수집 파일을 선택해 주세요.');let parsed;try{parsed=JSON.parse(await file.text());}catch{throw new Error('보유자료 파일을 읽지 못했습니다. 수집된 JSON 파일을 선택해 주세요.');}await api('/api/import',{method:'POST',body:JSON.stringify(parsed)});await loadState(false,true);toast('보유자료를 불러왔습니다.');}catch(error){toast(error.message,true);}finally{event.target.value='';}});

try{const remembered=number(localStorage.getItem('owned-note-producer-level'));if(Number.isInteger(remembered)&&remembered>0)$('producerLevelInput').value=String(remembered);}catch{}
function restoreRecommendationMode(){
  try{
    const saved=JSON.parse(localStorage.getItem('owned-note-recommend-mode')||'null');
    if(!saved||typeof saved!=='object')return;
    if(['hif','nia','hajime'].includes(saved.scenario))$('scenarioSelect').value=saved.scenario;
    if(['auto','consult','outing','supply_gift'].includes(saved.activityFocus))$('activityFocusSelect').value=saved.activityFocus;
    if(['guide','stats'].includes(saved.memorySelectionMode))$('memorySelectionMode').value=saved.memorySelectionMode;
    ui.rememberedEventModeId=typeof saved.eventModeId==='string'?saved.eventModeId:'';
  }catch{}
}
restoreRecommendationMode();
$('producerLevelInput').addEventListener('input',()=>{rememberProducerLevel();renderConnection();});
renderConnection();renderInventory();loadState();setInterval(()=>{if(!document.hidden&&ui.state?.collectorMode?.mode==='collect')loadState();},3000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadState();});
setInterval(async () => {
  if (document.hidden || !ui.state || ui.fetching) return;
  const now = Date.now();
  for (const img of document.querySelectorAll('img[data-art-retry-at]')) {
    if (Number(img.dataset.artRetryAt) > now) continue;
    img.dataset.artRetryAt = String(now + 300000);
    img.loading = 'eager';
    img.src = img.getAttribute('src').split('?')[0] + '?retry=' + now;
  }
  try {
    const health = await api('/api/health');
    if (health.catalogVersion !== ui.state.catalogVersion) await loadState();
    else if (health.catalogSync) {
      ui.state.catalogSync = health.catalogSync; renderCatalogStatus();
      if (ui.visualCatalogVersion !== health.catalogVersion && typeof reloadCardCatalog === 'function') await reloadCardCatalog();
    }
  } catch { /* Keep the last locally loaded collection visible. */ }
}, 30000);
