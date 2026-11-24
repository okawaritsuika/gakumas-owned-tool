import { knownRank } from './idol-operating-guidance.mjs';
import { scoreIdolEffects } from './pidol-effect-score.mjs';
import { compareHifOutfit } from './hif-outfit-recommendation.mjs';
import { buildHifPeakDeck, HIF_PEAK_PLV } from './hif-peak-decks.mjs';
import { peakAvailability } from './hif-peak-availability.mjs';
import { openHifPeakReview } from './hif-peak-review.mjs';

const upgradeEffects = [
  'IdolCardLevelLimitEffectType_ProduceCardUpgrade',
  'IdolCardLevelLimitEffectType_SecondProduceCardUpgrade',
];
const hifTypeNames = {goodConditionTurns:'호조',concentration:'집중',motivation:'의욕',
  goodImpressionTurns:'호인상',fullPower:'전력',strength:'강기',preservation:'온존'};

function currentState(card, owned) {
  const trainingStages = card.specialTrainingStages ?? [];
  const potentialStages = card.awakeningStages ?? [];
  const training = knownRank(owned, ['levelLimitRank', 'uncap', 'specialTrainingRank'], trainingStages);
  const potential = knownRank(owned, ['potentialRank', 'awakening', 'awakeningRank'], potentialStages);
  const partial = Boolean(owned && (training === null || potential === null));
  const label = owned
    ? [training === null ? '특훈 미확인·기본 스킬' : '특훈 ' + training,
      potential === null ? '개화 미확인·기본 아이템' : '개화 ' + potential].join(' · ')
    : '기본 사양 · 특훈 0 · 개화 0';
  return {training, potential, partial, label,
    trainingEffects: trainingStages.filter(s => s.rank <= (training ?? 0)).flatMap(s => s.effectTypes ?? []),
    changedItem: potentialStages.some(s => s.rank <= (potential ?? 0) && s.effectTypes?.includes('IdolCardPotentialEffectType_InitialProduceItemChange'))};
}

function badSelection(message) {
  throw Object.assign(new Error(message), {status: 400});
}

export function buildIdolRecommendation({card, owned, data, catalog, scope, plv, eventModeId, selectedCustomId, traceHif=false}) {
  const peakMode=scope==='hif' && !eventModeId;
  const state = currentState(card, peakMode ? {
    levelLimitRank:Math.max(0,...(card.specialTrainingStages??[]).map(s=>s.rank)),
    potentialRank:Math.max(0,...(card.awakeningStages??[]).map(s=>s.rank)),
  } : owned);
  const ids = card.uniqueIds ?? {};
  const absent = [];
  const skills = [];
  for (const [i, id] of [ids.produceCardId, ids.secondProduceCardId].entries()) {
    if (!id && i === 1) continue;
    const upgrade = state.trainingEffects.filter(t => t === upgradeEffects[i]).length;
    const skill = data.skills?.[id + ':' + upgrade];
    if (skill?.ownerId === card.gameId) skills.push(skill);
    else absent.push('고유 스킬 ' + (i + 1) + '의 ' + (id ? '효과 정의 ' + id + ':' + upgrade : '게임 ID'));
  }
  const itemId = ids[state.changedItem ? 'afterProduceItemId' : 'beforeProduceItemId'];
  const item = data.items?.[itemId];
  if (!item || item.ownerId !== card.gameId) absent.push('고유 P아이템 ' + (itemId ? '효과 정의 ' + itemId : '게임 ID'));
  const primaId = peakMode && data.primaSkills?.[card.gameId];
  if (primaId) {
    const prima = data.skills?.[primaId + ':0'];
    if (prima) skills.push(prima);
    else absent.push('HIF 본선 프리마 스텔라 스킬 ' + primaId);
  }
  const hasCustomOpportunity = ['hajime-legend','nia-pro','nia-master','hif'].includes(scope);
  const routes = owned && state.training >= 7 && hasCustomOpportunity
    ? skills.flatMap(skill => (skill.customizationIds ?? []).flatMap(id => {
      const option = data.customizations?.[id];
      if (option?.ownerId !== card.gameId || option.skillId !== skill.id || !(skill.maxCustomizeCount > 0)) return [];
      const level = option.levels?.find(level => level.level === 1);
      if (!level) return [];
      const name = option.labelKo || option.text || option.name || id;
      const label = Number.isFinite(level.cost) ? name + ' (' + level.cost + 'P)' : name;
      return [{id, label, option, skillId:skill.id}];
    })) : [];
  const chosen = selectedCustomId ? routes.find(r => r.id === selectedCustomId) : null;
  if (selectedCustomId && !chosen) badSelection('이 의상의 현재 특훈·강화 상태에서 선택할 수 없는 개조입니다.');
  const evidence = eventModeId ? null : data.evidence?.[scope + '/' + card.gameId];
  const direct = evidence && (!evidence.minTraining || state.training >= evidence.minTraining)
    && (!evidence.minPotential || state.potential >= evidence.minPotential)
    && (!evidence.minPlv || (peakMode?HIF_PEAK_PLV:plv) >= evidence.minPlv)
    && (!evidence.requiredCustomId || (!peakMode && chosen?.id === evidence.requiredCustomId));
  const applied = chosen && !peakMode ? [{...chosen.option, skillId:chosen.skillId, level:1}] : [];
  const currentCard = {...card, specialTrainingRank:state.training ?? 0,potentialRank:state.potential ?? 0};
  let result = absent.length
    ? {value:null,basis:'missing',condition:'',
      known:[...skills, item?.ownerId === card.gameId ? item : null].filter(Boolean)
        .map(row=>[row.name,row.text].filter(Boolean).join(' ').replace(/\s+/g,' ')).join(' · '),
      missing:absent.join(' · ')}
    : scoreIdolEffects({skills, item, customizations:applied,
      scope:eventModeId ? 'common' : scope, plan:card.plan, card:currentCard,
      scenarioEvidence:direct ? evidence : null});
  let hifNote = '', availability;
  if (peakMode && !absent.length) {
    const deck=catalog && buildHifPeakDeck({catalog,card:currentCard,skills,item});
    const hif = compareHifOutfit({catalog,card:currentCard,skills,item,plv:HIF_PEAK_PLV,peakDeck:deck,
      preparedCards:deck?.preparedCards,selectedSwitchIds:deck?.selectedSwitchIds,trace:traceHif});
    availability=peakAvailability(catalog,hif.peak,plv);
    if (hif.missing) {
      const retained = Number.isInteger(result.value);
      result = {...result,hif,basis:retained ? 'common' : 'missing',missing:[hif.missing,result.missing].filter(Boolean).join(' · '),
        condition:retained ? '본선 순위 보류 · 공통 점수 참고' : '본선 순위 보류'};
      if (retained) {
        const partial = [['selection','첫 선발'],['final','본선 R1'],['finalR2','본선 R2']].flatMap(([key,label])=>{
          const stage=hif.stages?.[key];
          return Number.isFinite(stage?.delta) ? [label+' '+stage.on+'/'+stage.off] : [];
        });
        hifNote = ['본선 대표 운용의 추천 순위에서 제외합니다.',
          partial.length ? '확인된 부분의 적용/제외 파라미터 · '+partial.join(' · ') : ''].filter(Boolean).join(' ');
      }
    } else {
      result = {...result,hif,value:hif.value,basis:'scenario',missing:''};
      const {selection,final,finalR2} = hif.stages;
      hifNote = '공통 PLv '+HIF_PEAK_PLV+' · '+(hifTypeNames[selection.trainingType] ?? selection.trainingType)+
        ' 완성 덱 · 의상 적용/제외 파라미터 · 첫 선발 '+selection.on+'/'+selection.off+' · 본선 R1 '+final.on+'/'+final.off+
        ' · R2 '+finalR2.on+'/'+finalR2.off+' · 추천 점수는 의상 적용 본선 합계 '+hif.finalParameter+
        ' · 같은 준비에서 고유 효과로 늘어난 본선 파라미터 '+hif.finalContribution;
    }
    if (hif.peak) {
      const hand=availability.cards.filter(c=>c.source==='owned'||c.source==='rental').map(c=>c.name);
      const witness=hif.peak.witness?.finalR2;
      hifNote+=['공통 인터벌 회복 예산 '+hif.peak.budget+'P · 외부 속성 배율 1 · 드링크와 메모리 H.I.F. 어빌리티 미편성',
        hif.peak.sourceScope==='outfit'?'의상별 실전 운용':'육성 타입 공략으로 구성한 의상 덱',
        hand.length?'반입 '+hand.join(', '):'',witness?.verified?'점수에 사용한 R2 · '+
          witness.events.map(e=>e.turn+'턴 '+e.action).join(' / '):'',
        '의상 간 실전 고점 순위 검증 중',availability.label].filter(Boolean).map(s=>' · '+s).join('');
    }
  }
  const condition = [eventModeId ? '기간 이벤트 전용 효과 제외' : '', result.condition].filter(Boolean).join(' · ');
  let displayedEvidence=direct ? {reason:evidence.reason,sources:evidence.sources} : null;
  if (result.hif?.peak) {
    const review=openHifPeakReview(card.gameId);
    const urls=result.hif.peak.sourceUrls??[];
    const sources=[...(displayedEvidence?.sources??[])];
    for (const url of urls) {
      if (typeof url==='string' && /^https?:\/\//.test(url) && URL.canParse(url) && !sources.some(s=>s.url===url))
        sources.push({url,name:'완성 덱 운용 근거 · '+new URL(url).hostname});
    }
    if (review && !sources.some(s=>s.url===review.url)) sources.push({url:review.url,name:'순위 차이 검산 자료'});
    displayedEvidence={reason:[displayedEvidence?.reason,review?.reason].filter(Boolean).join(' '),sources};
  }
  return {...result, condition,
    estimated:result.value !== null && (!direct || state.partial || Boolean(result.hif)),
    evidence:displayedEvidence,
    ...(peakMode?{availability}:{}),
    stateLabel:[(peakMode?'공통 고점 기준 · ':'')+state.label, '고유 P아이템 취득 후', primaId ? '본선 프리마 스텔라 적용' : '',
      applied.length ? '이번 육성 개조 적용' : peakMode?'고유 개조 미적용':'개조 미적용',hifNote].filter(Boolean).join(' · '),
    customizationOptions:peakMode?[]:routes.map(({id,label})=>({id,label})), appliedCustomizationId:peakMode?null:chosen?.id ?? null};
}
