const AXES=['vo','da','vi'];
const zeros=()=>Object.fromEntries(AXES.map(axis=>[axis,0]));
const empty=()=>({initialStats:zeros(),growthRatePermil:zeros(),limitAddition:zeros(),spRatePermil:0,initialPP:0,beforeExamRecoveryPermil:0,shopCardDiscountPermil:0});
const nonnegative=value=>typeof value!=='boolean'&&value!==null&&value!==undefined&&value!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0;
const combine=(a,b)=>({initialStats:Object.fromEntries(AXES.map(axis=>[axis,a.initialStats[axis]+b.initialStats[axis]])),growthRatePermil:Object.fromEntries(AXES.map(axis=>[axis,a.growthRatePermil[axis]+b.growthRatePermil[axis]])),limitAddition:Object.fromEntries(AXES.map(axis=>[axis,a.limitAddition[axis]+b.limitAddition[axis]])),...Object.fromEntries(['spRatePermil','initialPP','beforeExamRecoveryPermil','shopCardDiscountPermil'].map(key=>[key,a[key]+b[key]]))});

/** Account HIF unlocks are separate from an old selection-memory's saved state. */
export function computeHifBonuses(raw,master={}){
  const capture=raw?.growthPanelCapture,rows=raw?.userProduceGrowthPanelList;
  const unknown={status:'unknown',common:null,selectionOnly:null,finalOnly:null,selection:null,final:null,activePanels:[],issues:['계정의 HIF 보너스 패널을 아직 읽지 못했습니다. 상한이나 성장 보너스를 최대값 또는 0으로 확정하지 않습니다.']};
  if(capture?.status!=='complete'||!Array.isArray(rows)||capture.expectedCount!==rows.length||capture.exportedCount!==rows.length)return unknown;
  const issues=[],common=empty(),selectionOnly=empty(),finalOnly=empty(),activePanels=[],seen=new Set();
  for(const row of rows){
    if(typeof row?.produceGrowthPanelId!=='string'||!nonnegative(row.level)||typeof row.enable!=='boolean'||seen.has(row.produceGrowthPanelId)){issues.push('HIF 보너스 패널의 ID·레벨·활성 상태 또는 중복을 확인해 주세요.');continue;}
    seen.add(row.produceGrowthPanelId);
    if(!row.enable)continue;
    const matches=(master.panels??[]).filter(panel=>panel.id===row.produceGrowthPanelId&&Number(panel.level)===Number(row.level));
    if(matches.length!==1){issues.push('활성 패널의 현재 레벨과 원자료가 유일하게 연결되지 않습니다: '+row.produceGrowthPanelId);continue;}
    const panel=matches[0];
    const bucket=panel.splitType==='ProduceSplitType_Unknown'?common:panel.splitType==='ProduceSplitType_Selection'?selectionOnly:panel.splitType==='ProduceSplitType_Final'?finalOnly:null;
    if(!bucket){issues.push('확인되지 않은 HIF 패널 적용 단계입니다.');continue;}
    activePanels.push({id:panel.id,level:Number(row.level),splitType:panel.splitType,descriptionJa:panel.descriptionJa});
    for(const effect of panel.effects??[]){
      const min=effect.effectValueMin,max=effect.effectValueMax;
      if(!nonnegative(min)||Number(min)!==Number(max)){issues.push('범위형 또는 미확인 HIF 패널 효과는 고정값으로 계산하지 않습니다.');continue;}
      const value=Number(min),type=String(effect.produceEffectType).replace(/^ProduceEffectType_/,'');
      const axis={Vocal:'vo',Dance:'da',Visual:'vi'};
      const addition=/^(Vocal|Dance|Visual)Addition$/.exec(type),growth=/^(Vocal|Dance|Visual)GrowthRateAddition$/.exec(type);
      if(addition)bucket.initialStats[axis[addition[1]]]+=value;
      else if(growth)bucket.growthRatePermil[axis[growth[1]]]+=value;
      else if(type==='ParameterLimitUp')for(const a of AXES)bucket.limitAddition[a]+=value;
      else if(type==='LessonSpChangeRatePermilAddition')bucket.spRatePermil+=value;
      else if(type==='ProducePointAdditionDisableTrigger')bucket.initialPP+=value;
      else if(type==='BeforeAuditionRefreshStaminaUp')bucket.beforeExamRecoveryPermil+=value;
      else if(type==='ShopProduceCardPriceDiscountMultiplePermanent')bucket.shopCardDiscountPermil+=value;
      else issues.push('미해석 HIF 패널 효과: '+type);
    }
  }
  const selection=combine(common,selectionOnly),final=combine(common,finalOnly);
  for(const [stage,result]of [['selection',selection],['final',final]]){
    const base=master.baseCaps?.[stage]?.value;
    if(!nonnegative(base)||Number(base)===0){issues.push('HIF 단계별 기본 능력치 상한이 없습니다.');result.statCaps=null;}
    else result.statCaps=Object.fromEntries(AXES.map(axis=>[axis,Number(base)+result.limitAddition[axis]]));
  }
  return {status:issues.length?'partial':'current_account',common,selectionOnly,finalOnly,selection,final,activePanels,
    issues:[...new Set(issues)],capturedAt:raw.capturedAt??null,source:master.source??null,
    applicationNote:'처음부터 진행할 때 공통 초기 효과는 선발에서 한 번만 적용합니다. 과거 선발 메모리의 저장 보너스·현재 본선 세션은 별도입니다.'};
}
