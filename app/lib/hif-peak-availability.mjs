const indexes=new WeakMap();

export function peakAvailability(catalog,peak,plv) {
  const level=Number.isSafeInteger(plv) && plv>0 ? plv : null;
  if (!peak || !catalog) return {plv:level,cards:[],label:'완성 덱 준비 조건 미확인'};
  let index=indexes.get(catalog);
  if (!index) {
    index=new Map((catalog.skillAdvice?.cards??[]).map(row=>[row.id,row]));
    indexes.set(catalog,index);
  }
  const cards=[];
  const seen=new Set();
  const requirements=[...(peak.requirements??[])];
  for (const row of peak.acquisitions??[]) {
    if (row.source==='representative_acquisition' && !requirements.some(r=>r.gameId===row.id)) {
      requirements.push({gameId:row.id,source:'acquisition',ordinaryMinPlv:row.minPlv});
    }
  }
  for (const req of requirements) {
    if (seen.has(req.gameId)) continue;
    seen.add(req.gameId);
    const row=index.get(req.gameId), unlock=row?.unlock;
    if (!unlock) continue;
    const conversion=unlock.requiresConversionSelection ? unlock.conversionProducerLevel : null;
    const ordinary=req.ordinaryMinPlv??unlock.acquisitionProducerLevel;
    const obtain=req.source==='rental' ? req.rentalMinPlv??unlock.rentalProducerLevel : ordinary;
    const minimum=Math.max(obtain??0,conversion??0);
    // A higher ordinary acquisition threshold alone does not disqualify an
    // already-owned memory. Switch settings and rental limits are separate.
    const locked=level!==null && minimum>level;
    const conditional=locked && req.source==='owned' && !(conversion>level);
    const name=row.nameKo||row.nameJa, substitutes=[];
    if (locked) for (const id of new Set([...(req.substituteIds??[]),unlock.conversionSourceGameId].filter(Boolean))) {
      const alt=index.get(id), u=alt?.unlock;
      if (id===req.gameId || !u || !Number.isInteger(u.acquisitionProducerLevel) || u.acquisitionProducerLevel>level ||
        (u.requiresConversionSelection && (!Number.isInteger(u.conversionProducerLevel) || u.conversionProducerLevel>level))) continue;
      const altName=alt.nameKo||alt.nameJa;
      substitutes.push({id,name:altName===name && alt.nameJa ? altName+' ['+alt.nameJa+']' : altName,
        requiresSwitch:Boolean(u.requiresConversionSelection)});
    }
    const rentalAlternative=locked && req.source!=='rental' && Number.isInteger(unlock.rentalProducerLevel) &&
      unlock.rentalProducerLevel>0 && level>=unlock.rentalProducerLevel && !(conversion>level);
    cards.push({id:req.gameId,name,source:req.source,minimum,requiresSwitch:Boolean(conversion),
      status:level===null ? 'unknown' : conditional ? 'owned_copy_required' : locked ? 'locked' : 'level_met',substitutes,
      rentalAlternative:rentalAlternative ? unlock.rentalProducerLevel : null});
  }
  const blocked=cards.filter(c=>c.status==='locked' || c.status==='owned_copy_required');
  const label=level===null ? '내 PLv 미입력 · 카드 해금 안내 대기'
    : '내 PLv '+level+' · '+(blocked.length ? blocked.map(c=>c.name+' ('+(c.status==='owned_copy_required'?'일반 획득 ':'해금 ')+
        'PLv '+c.minimum+(c.status==='owned_copy_required'?' · 보유 사본 확인':'')+')'+
        (c.substitutes.length?' → 대체 후보 '+c.substitutes.map(s=>s.name+(s.requiresSwitch?'(전환 선택)':'')).join(' / '):'')+
        (c.rentalAlternative?' · PLv '+c.rentalAlternative+' 대여 가능(대여 슬롯 교체 필요)':c.substitutes.length?'':' · 검증된 대체 경로 미확인')).join(' · ')
      : '덱의 PLv 조건 충족 · 반입 사본과 전환 선택 확인 필요');
  return {plv:level,cards,label};
}
