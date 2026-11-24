// Ordinary mid-run rewards. Each stage grants at most one item.
const bracelet = {id:'pitem_00-3-002-0',name:'하츠보시 팔찌'};
const masterBusiness = {
  company:{id:'pitem_00-3-098-0',name:'N.I.A 토트백',quantity:2,action:'p_drink_acquire'},
  commercial:{id:'pitem_00-3-097-0',name:'N.I.A 스마트폰 링',quantity:1,action:'skill_enhance'},
  municipal:{id:'pitem_00-3-099-0',name:'N.I.A 패스 케이스',quantity:40,action:'pp'},
};
const zeroReward = () => ({id:null,name:null,items:[],actionCounts:{},pp:0,stamina:0,activations:0,notes:[]});

// The caller supplies only the base parameter rewards before either growth bonus.
// The route already includes its base gains; only the challenge increment is added.
export function niaChallengeBonusStats(options, startItems) {
  const rows=options.niaAuditionBaseRewards;
  if(rows==null)return null;
  const axes=['vocal','dance','visual'];
  if(options.scenario!=='nia'||startItems.difficulty!=='master'||options.eventModeId||!Array.isArray(rows)||
    rows.length!==3||rows.some(row=>row!==null&&(!row||typeof row!=='object'||Array.isArray(row)||
      Object.keys(row).length!==3||axes.some(axis=>!Number.isSafeInteger(row[axis])||row[axis]<0)))) {
    throw new RangeError('일반 NIA 마스터의 각 오디션은 미입력 또는 Vo·Da·Vi 기본 보상 3개로 지정해 주세요.');
  }
  const rate=startItems.totals.auditionParameterGrowthRatePermil;
  return Object.fromEntries(axes.map(axis=>[axis,rows.reduce((sum,row)=>sum+(row?Math.floor(row[axis]*rate/1000):0),0)]));
}

export function scenarioRewardCalendar(catalog, scenario, difficulty) {
  if (scenario === 'nia' && ['pro','master'].includes(difficulty)) {
    const weeks=(catalog.niaSchedule?.pro ?? []).filter((_,i)=>difficulty!=='master'||i+1!==catalog.niaSchedule.masterOmitsProWeek);
    const after = (exam,activity) => {
      const mid=weeks.findIndex(menu=>menu.includes(exam));
      return mid<0?[]:weeks.flatMap((menu,i)=>i>mid&&menu.includes(activity)?[i+1]:[]);
    };
    return {business:difficulty==='master'?after('audition_first','business'):[],
      bracelet:after('audition_second','self_lesson')};
  }
  const weeks=scenario==='hajime'&&['pro','master'].includes(difficulty)?catalog.hajimeSchedule?.[difficulty]:null;
  const mid=weeks?.findIndex(menu=>menu.includes('hajime_mid_exam'))??-1;
  return {business:[],bracelet:mid<0?[]:weeks.flatMap((menu,i)=>i>mid&&menu.includes('lesson')?[i+1]:[])};
}

export function scenarioRewardOptions({scenario,route,options,catalog}) {
  const base=options.scenarioRewardBaseCounts??{};
  for(const [key,count] of Object.entries(base)) {
    if(!['skill_enhance','p_drink_acquire'].includes(key)||!Number.isSafeInteger(count)||count<0)
      throw new RangeError('시나리오 보상을 제외한 드링크·강화 횟수는 0 이상의 정수로 입력해 주세요.');
  }
  const enteredVisits=options.scenarioRewardVisits??[], spWeeks=options.scenarioRewardSpWeeks??[];
  const calendar=scenarioRewardCalendar(catalog,scenario,route.difficulty);
  if(!Array.isArray(enteredVisits)||!Array.isArray(spWeeks) || (options.eventModeId &&
    (enteredVisits.length||spWeeks.length||Object.keys(base).length))) throw new RangeError('일반 시나리오의 아이템 조건을 확인해 주세요.');
  if(options.eventModeId)return [zeroReward()];
  const visits=[...enteredVisits];
  for(const check of options.startItemObservations??[]){
    if(!calendar.business.includes(check.week)||!Object.hasOwn(masterBusiness,check.venue))continue;
    const other=visits.find(visit=>visit.week===check.week);
    if(other&&other.venue!==check.venue)throw new RangeError('같은 주의 영업 장소가 서로 다릅니다.');
    if(!other)visits.push({week:check.week,venue:check.venue});
  }
  const distinct = new Set();
  for(const visit of visits){
    if(!calendar.business.includes(visit?.week)||!Object.hasOwn(masterBusiness,visit.venue)||distinct.has(visit.week))
      throw new RangeError('1차 오디션 뒤 영업 주차마다 이용 가능한 장소 한 곳을 선택해 주세요.');
    distinct.add(visit.week);
  }
  if(spWeeks.some(week=>!calendar.bracelet.includes(week))||new Set(spWeeks).size!==spWeeks.length)
    throw new RangeError('팔찌를 얻은 뒤의 SP 레슨 주차를 확인해 주세요.');
  const earnings=(action,count)=>{
    // Excel totals may already include the scenario reward.
    if(scenario==='nia' && !Object.hasOwn(base,action) && !Array.isArray(options.produceActions))return 0;
    return count;
  };
  const first=[zeroReward()];
  for(const [venue,item] of Object.entries(masterBusiness)){
    const weeks=visits.filter(visit=>visit.venue===venue).map(visit=>visit.week).sort((a,b)=>a-b).slice(0,2);
    if(!weeks.length)continue;
    const amount=weeks.length*item.quantity;
    const extra=item.action==='pp'?null:earnings(item.action,amount);
    const detail={id:item.id,name:item.name,weeks,activations:weeks.length,quantity:amount,unit:item.action};
    first.push({...zeroReward(),id:item.id,name:item.name,items:[detail],activations:weeks.length,
      pp:item.action==='pp'?amount:0,actionCounts:extra?{[item.action]:extra}:{},
      notes:extra===0?['프리셋 횟수에 이 보상이 포함됐는지 미확인입니다. 순증 계산에는 아이템 제외 횟수가 필요합니다.']:[]});
  }
  const eligible=route.selections?.filter(row=>row.activity==='sp_lesson').map(row=>row.week);
  const weeklyLessonRoute=Boolean(route.hajimePro||route.hajimeMaster);
  const inferBracelet=options.scenarioRewardSpWeeks==null && weeklyLessonRoute && route.knownUpgradeTargets>0;
  const selectedWeeks=inferBracelet ? eligible.filter(week=>calendar.bracelet.includes(week))
    .slice(0,Math.max(0,route.knownUpgradeTargets-(route.counts.skill_enhance??0))) :
    spWeeks.filter(week=>!weeklyLessonRoute||eligible?.includes(week)).sort((a,b)=>a-b);
  const budget=Number.isFinite(route.counts?.sp_lesson_end)?Math.floor(route.counts.sp_lesson_end):selectedWeeks.length;
  const weeks=selectedWeeks.slice(0,budget);
  if(!weeks.length)return first;
  return first.concat(first.map(reward=>{
    const extra=earnings('skill_enhance',weeks.length);
    const ids=[...reward.items.map(item=>item.id),bracelet.id];
    return {...reward,id:ids.join('+'),name:[reward.name,bracelet.name].filter(Boolean).join(' + '),
      items:[...reward.items,{...bracelet,weeks,activations:weeks.length,quantity:weeks.length,unit:'skill_enhance'}],
      actionCounts:{...reward.actionCounts,...(extra?{skill_enhance:(reward.actionCounts.skill_enhance??0)+extra}:{})},
      activations:reward.activations+weeks.length,stamina:-3*weeks.length,notes:[...reward.notes,
        inferBracelet?'선택 경로의 중간시험 뒤 SP 레슨과 초기 덱의 강화 대상을 사용했습니다. 매회 체력 3을 소모하는 조건입니다.':
          '입력한 주에 SP 레슨을 완료하고 팔찌로 강화할 대상과 체력을 확보하는 조건입니다.',
        ...(extra===0?['기존 강화 합계와의 중복을 확인할 수 없어 순증을 보류했습니다.']:[])]};
  }));
}
