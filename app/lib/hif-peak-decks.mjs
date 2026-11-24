import {hifOutfitTrainingType} from './hif-outfit-routes.mjs';

// Last ordinary and switch unlocks in this edition. The account PLv is used by
// the consumer to explain access, never to choose cards for this benchmark.
export const HIF_PEAK_PLV=90;

const guideChina='https://note.com/ikatarou_0987/n/n02cb5297474d';
const guideTemari='https://www.youtube.com/watch?v=sdUJwNsZ1TE';
const guideHiro='https://note.com/mitubaaaaati/n/nd5fcd1646e44';
const specific={
  'i_card-kcna-3-019':{key:'hold-recovery',source:guideChina,
    memories:['積み重ね','羽ばたけ！','仕切り直し','全身全霊'],switches:['羽ばたけ！','リスキーチャンス']},
  'i_card-ttmr-3-007':{key:'entertainment',source:guideTemari,copyTarget:'至高のエンタメ',switches:[],
    memories:['シュプレヒコール','国民的アイドル','精神統一','至高のエンタメ']},
  'i_card-shro-3-018':{key:'healthy-replay',source:guideHiro,copyTarget:'脚光',
    memories:['シュプレヒコール','脚光','精神統一','国民的アイドル']},
};
// Public option IDs are cross-checked against the native variant and its
// upgrade limit before the vendor patch is applied to the actual memory.
const optionsByCard={
  '存在感':[[31,1]], '脚光':[[17,1]], '立ち位置チェック':[[4,1]], 'スポットライト':[[52,2]],
  '話題沸騰':[[37,1]], 'せのびの魔法':[[27,1]], '届いて！':[[11,1]],
  'キセキの魔法':[[6,1]], 'びしっとキメ顔':[[106,1]], '仕切り直し':[[24,1]],
  '積み重ね':[[4,1],[76,1]], '全身全霊':[[28,1]], '羽ばたけ！':[[35,1]],
  '巻き返し':[[37,1]], 'エンターテイナー':[[2,1]],
};
const alternatives={
  '羽ばたけ！':['輝け！','トレンドリーダー'], '脚光':['至高のエンタメ','コール＆レスポンス'],
  '至高のエンタメ':['シュプレヒコール'], '精神統一':['仕切り直し'],
  'びしっとキメ顔':['輝くキミへ'], '本領発揮':['アイドルになります'], 'リスキーチャンス':['覚悟'],
};
const caches=new WeakMap();
function records(catalog) {
  if(caches.has(catalog)) return caches.get(catalog);
  const cards=catalog.skillAdvice?.cards??[];
  const index={byId:new Map(cards.map(r=>[r.id,r])),byName:new Map(cards.map(r=>[r.nameJa,r])),
    custom:new Map((catalog.skillAdvice?.customizations??[]).map(r=>[r.id,r]))};
  caches.set(catalog,index);
  return index;
}
function optionsFor(record,variant,index,missing) {
  const choices=[];
  for(const [publicId,level] of optionsByCard[record.nameJa]??[]) {
    const id=variant?.customizationIds[variant.publicCustomizationIds.indexOf(publicId)];
    const native=index.custom.get(id), selected=native?.levels?.find(l=>l.level===level);
    // Native EffectAdd for 4 genki is identity-verifiable from its effect ID
    // even in editions without a public-ID alias on this wrapper.
    const genki4=publicId===27 && selected?.growEffects?.some(e=>e.playProduceExamEffectId==='e_effect-exam_block-0004');
    if(!selected || !native.publicIds?.includes(publicId) && !genki4) {
      missing.push(record.nameJa+' 반입 개조 '+publicId+'의 원자료 연결');
      continue;
    }
    choices.push({id,publicId,level});
  }
  return choices;
}
export function buildHifPeakDeck({catalog,card}) {
  const trainingType=hifOutfitTrainingType(catalog,card), index=records(catalog);
  const guides=catalog.deckGuides?.guides??[];
  const guide=guides.find(g=>g.scenario==='hif' && g.trainingType===trainingType);
  const profile=specific[card.gameId];
  // Preservation's published guide gives the stance-change route. The
  // full-power guide supplies its draw, held attacks and finishing core.
  const carryGuide=trainingType==='preservation'
    ? guides.find(g=>g.scenario==='hif' && g.trainingType==='fullPower') : guide;
  const named=profile?.memories ?? carryGuide?.memoryRecommendations?.map(r=>r.nameJa) ?? [];
  const sourceIds=new Set([...(guide?.sourceIds??[]),...(carryGuide?.sourceIds??[])]);
  const sourceUrls=[...(profile?[profile.source]:[]),
    ...(catalog.deckGuides?.sources??[]).filter(s=>sourceIds.has(s.id)).map(s=>s.url)];
  const missing=[],preparedCards=[],selectedSwitchIds=new Set(),preparationRequirements=[];
  if(named.length!==4) missing.push('검증할 반입 카드 네 장');
  const appendRequirement=(record,source,phase,customizations=[])=>{
    const u=record.unlock;
    const substituteIds=(alternatives[record.nameJa]??[]).map(n=>index.byName.get(n)?.id).filter(Boolean);
    preparationRequirements.push({gameId:record.id,nameKo:record.nameKo??record.nameJa,source,phase,
      ordinaryMinPlv:u.acquisitionProducerLevel,rentalMinPlv:u.rentalProducerLevel,
      switchMinPlv:u.switchUnlockProducerLevel??u.conversionProducerLevel,switchFromId:u.conversionSourceGameId,
      substituteIds,customizations});
    if(u.requiresConversionSelection) selectedSwitchIds.add(record.id);
  };
  for(const [i,name] of named.entries()) {
    const record=index.byName.get(name),variant=record?.variants.find(v=>v.upgradeCount===1);
    if(!variant || ![card.plan,'free'].includes(record.plan) || record.status.releaseExcluded ||
      record.status.libraryHidden || !Number.isInteger(record.unlock.acquisitionProducerLevel) ||
      record.unlock.acquisitionProducerLevel>HIF_PEAK_PLV || !variant.sourcePublicId) {
      missing.push(name+' 반입·강화·해금 확인');
      continue;
    }
    const source=i===0?'rental':'owned', phase=i<2?'produce_start':'after_mid_audition';
    const customizations=optionsFor(record,variant,index,missing);
    preparedCards.push({gameId:record.id,source,phase,upgradeCount:1,peakPreparation:true,
      ...(name===profile?.copyTarget?{copyTarget:true}:{}),...(customizations.length?{customizations}:{})});
    appendRequirement(record,source,phase,customizations);
  }
  const switchIds=profile?.switches?.map(n=>index.byName.get(n)?.id) ??
    [...(guide?.examFlow?.steps??[]),...(carryGuide?.examFlow?.steps??[])].flatMap(s=>s.cardIds??[]);
  for(const id of new Set(switchIds)) {
    const record=index.byId.get(id);
    if(record?.unlock.requiresConversionSelection && !selectedSwitchIds.has(id) &&
        !preparedCards.some(p=>p.gameId===record.unlock.conversionSourceGameId)) {
      if(!Number.isInteger(record.unlock.conversionProducerLevel) || record.unlock.conversionProducerLevel>HIF_PEAK_PLV)
        missing.push(record.nameJa+' 전환 해금');
      else appendRequirement(record,'acquisition','before_final_R1');
    }
  }
  return {key:profile?.key??trainingType,sourceScope:profile?'outfit':'trainingType',trainingType,preparedCards,selectedSwitchIds:[...selectedSwitchIds],
    preparationRequirements,sourceUrls,missing};
}
