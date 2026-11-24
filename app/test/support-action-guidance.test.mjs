import test from 'node:test';
import assert from 'node:assert/strict';
import '../web/support-action-guidance.js';

const guide=globalThis.supportActionGuidance;
const effect=(axis,min,triggerId)=>({type:'ProduceEffectType_'+axis+'Addition',min,max:min,triggerId});
const ability=(order,kind,axis,n,extra={})=>({order,level:1,kind,effects:[effect(axis,n)],...extra});
const card=(name,levelAbilities,extra={})=>({gameId:name,name,level:45,levelAbilities,...extra});
const opts=(supports,counts,model={},extra={})=>({supports,scoreSummary:{scenario:'hajime',plan:'logic',
  expectedCounts:counts,nonHifModel:model,...extra}});

test('recommended actions use selected supports only and separate ordinary acquisition from a consultation exchange',()=>{
  const ordinary=card('일반 획득',[ability(1,'skill_acquire','Vocal',3)]);
  const shop=card('상담 교환',[ability(1,'consult_skill_card_acquire','Dance',10)]);
  const outside=card('다른 대여',[ability(1,'delete','Dance',500)]);
  const result=opts({owned:[ordinary],rental:shop,rentalCandidates:[outside]},
    {skill_acquire:7,consult_skill_card_acquire:1,delete:10});
  const lines=guide(result);
  assert.equal(lines.length,2);
  assert.deepEqual(lines,['필요한 스킬 카드가 보이면 우선 확보하세요.','상담에서 필요한 스킬 카드를 교환하세요.']);
  assert.deepEqual(guide({...result,supports:[ordinary,shop]}),lines);
});

test('SP priorities change with the difficulty-specific axis count, while missing NIA axis counts stay unknown',()=>{
  const sp=card('정말! 차가워!',[
    ability(1,'sp_lesson_end','Dance',13,{effects:[effect('Dance',13,'p_trigger-end_lesson-lesson_dance_sp')]}),
    ability(1,'sp_lesson_end','Dance',99,{level:50}),
  ]);
  const alternate=card('보완 카드',[ability(1,'delete','Visual',32)]);
  const advice=weeks=>guide(opts([sp,alternate],{sp_lesson_end:4,delete:1},{selections:[
    ...weeks.map(week=>({week,activity:'sp_lesson',axis:'dance'})),{week:14,activity:'sp_lesson',axis:'visual'}]}));
  assert.equal(advice([4,12])[0],'삭제 기회가 나오면 루프에 필요 없는 카드를 먼저 빼세요.');
  assert.equal(advice([5,11,15])[0],'댄스 SP 레슨이 열리면 우선 선택하세요.');
  const nia=opts([sp],{sp_lesson_end:4},{},{scenario:'nia',excelSupportCounts:{name:'NIA 通常'}});
  assert.deepEqual(guide(nia),[]);
  nia.scoreSummary.nonHifModel.perAxisCounts={dance:{sp_lesson_end:2}};
  assert.deepEqual(guide(nia),['댄스 SP 레슨이 열리면 우선 선택하세요.']);
});

test('rank actual enhancement and deletion opportunities, apply unlocks, eligibility and per-run limits',()=>{
  const support=card('편성 카드',[
    ability(1,'skill_enhance','Dance',9,{activationLimit:3}),ability(2,'delete','Visual',10),
    ability(3,'consult','Dance',300,{plan:'sense'}),ability(4,'outing','Vocal',500,{scenarioEnum:'ProduceType_NextIdolAudition'}),
    ability(5,'change','Dance',99,{level:55}),
  ],{levelBasis:'uncapMax',ownedLevel:30});
  const result=opts([support],{skill_enhance:2,delete:2,consult:10,outing:10,change:5},{supportItemActionCounts:{skill_enhance:3}});
  support.itemReceivers=[{kind:'skill_enhance',axis:'dance',amount:9,used:2,limit:3}];
  const lines=guide(result);
  assert.deepEqual(lines,['강화 기회가 나오면 시험에 쓸 핵심 카드부터 강화하세요.','삭제 기회가 나오면 루프에 필요 없는 카드를 먼저 빼세요.']);
  result.scoreSummary.nonHifModel.rawStats={dance:190,visual:50};
  result.scoreSummary.nonHifModel.cappedStats={dance:150,visual:50};
  assert.equal(guide(result).length,1);
});

test('HIF uses the selected receiver and deck links and never uses the acquisition count for shop exchange',()=>{
  const selected=card('연계 카드',[ability(1,'ssr_card_acquire','Dance',5),ability(2,'consult_skill_card_acquire','Dance',20),
    ability(3,'delete','Visual',11)],{
    dynamicEffects:[{kind:'ssr_card_acquire',axis:'dance',amount:5,usedCount:1}],
  });
  const result=opts([selected],{ssr_card_acquire:1,skill_acquire:15,delete:1},{},{scenario:'hif',hifModel:{
    supportLinks:[{source:'ability',receiverId:'연계 카드',kind:'ssr_card_acquire',axis:'dance',extraCount:2}],
  }});
  assert.deepEqual(guide(result),['시험에 쓸 SSR 스킬 카드가 보이면 우선 확보하세요.','삭제 기회가 나오면 루프에 필요 없는 카드를 먼저 빼세요.']);
  result.scoreSummary.hifModel.supportLinks=[];
  assert.equal(guide(result)[0],'삭제 기회가 나오면 루프에 필요 없는 카드를 먼저 빼세요.');
});

test('P-item advice distinguishes early receipt assumptions, confirmed acquisition, missing triggers and upper bounds',()=>{
  const stats={activationCount:3,stats:{visual:75}};
  const item=card('곧 실전이네요',[],{p_item:{name:'素敵なお仕事',effect:{condition:{key:'param_gte',param:'visual'}}},
    supportItemValue:{triggerMeta:{key:'skill_change'},itemName:'素敵なお仕事',conditions:['추가 조건: 비주얼 400 이상'],
      acquisitionConfirmed:false,applied:{activationCount:0,stats:{}},comparison:{acquisitionAssumed:true,total:stats}}});
  const run=()=>guide(opts([item],{}));
  assert.deepEqual(run(),[]);
  item.supportItemValue.acquisitionConfirmed=true;
  item.supportItemValue.applied={activationCount:2,stats:{visual:50}};
  assert.equal(run()[0],'비주얼 조건을 채운 뒤 체인지 기회가 나오면 덱에 필요 없는 카드부터 바꾸세요.');
  item.supportItemValue.acquisitionConfirmed=false;
  item.supportItemValue.comparison={total:stats,acquisitionAssumed:false};
  item.supportItemValue.potential={early:stats};
  assert.deepEqual(run(),[]);
  assert.deepEqual(guide({}),[]);
});

test('drink acquisition and consultation exchange produce different playable instructions; zero and unknown counts stay silent',()=>{
  const drinks=card('드링크 대여',[ability(1,'p_drink_acquire','Dance',7)]);
  const shop=card('교환 대여',[ability(1,'p_drink_exchange','Vocal',6)]);
  assert.deepEqual(guide(opts([drinks],{p_drink_acquire:4})),['필요한 드링크가 보이면 우선 확보하세요.']);
  assert.deepEqual(guide(opts([drinks],{p_drink_acquire:4,p_drink_exchange:1})),['상담에서 필요한 드링크를 우선 교환하세요.']);
  assert.deepEqual(guide(opts([shop],{p_drink_acquire:4,p_drink_exchange:1})),['상담에서 필요한 드링크를 우선 교환하세요.']);
  assert.deepEqual(guide(opts([shop],{p_drink_acquire:4})),[]);
  assert.deepEqual(guide(opts([shop],{p_drink_exchange:0})),[]);
  assert.deepEqual(guide(opts([shop,drinks],{p_drink_acquire:4,p_drink_exchange:1})),['상담에서 필요한 드링크를 우선 교환하세요.']);
  const item=card('드링크 아이템',[],{supportItemValue:{triggerMeta:{key:'pdrink_acquire'},
    comparison:{acquisitionAssumed:true,total:{activationCount:2,stats:{visual:20}}}}});
  assert.deepEqual(guide(opts([item,shop],{p_drink_exchange:1})),
    ['상담에서 필요한 드링크를 우선 교환하세요.']);
});

test('HIF distinguishes selectable changes and venue choices from automatic random starter changes',()=>{
  const changes=card('스토리 보유',[ability(1,'basic_card_change','Vocal',20),ability(2,'activity_supply_gift','Dance',7)],{
    supportOperations:[{action:'change',source:'support_story',target:'starter'}]});
  const result=opts([changes],{basic_card_change:2,activity_supply_gift:1},{},{scenario:'hif',hifModel:{
    produceActions:[{action:'change',basis:'conditional_hif_scenario_item',target:'starter'}]}});
  assert.deepEqual(guide(result),['사시이레가 제시되면 우선 선택하세요.']);
  const selected={action:'change',basicCard:false,sourceType:'normal',week:10,venue:'class_work_end',basis:'planned_route_opportunity'};
  result.scoreSummary.hifModel.produceActions.push(selected);
  assert.deepEqual(guide(result),['사시이레가 제시되면 우선 선택하세요.']);
  selected.basicCard=true;
  selected.sourceType='default';
  assert.equal(guide(result)[0],'체인지 기회가 나오면 덱에 필요 없는 기본 카드부터 바꾸세요.');
});

test('P-items name the required keyword of an enhancement and the attribute of an ordinary lesson',()=>{
  const item=key=>card('선택한 아이템의 카드',[],{supportItemValue:{acquisitionConfirmed:true,
    triggerMeta:key,applied:{activationCount:1,stats:{vocal:5}}}});
  assert.deepEqual(guide(opts([item({key:'keyword_card_enhance',keyword:'goodImpressionTurns'}),item({key:'param_lesson_end',param:'visual'})],{})),
    ['강화 기회가 나오면 호인상 효과가 있는 카드부터 강화하세요.','비주얼 레슨이 열리면 우선 선택하세요.']);
});

test('generic and typed enhancement produce one instruction, preserving the more valuable target',()=>{
  const selected=card('이름이 화면에 나오지 않는 카드',[ability(1,'skill_enhance','Vocal',5),
    ability(2,'m_skill_enhance','Visual',15)]);
  const result=opts([selected],{skill_enhance:3,m_skill_enhance:2});
  assert.deepEqual(guide(result),['강화 기회가 나오면 시험에 쓸 멘탈 카드부터 강화하세요.']);
});

test('an SP and a regular lesson on the same axis share a single instruction',()=>{
  const selected=card('레슨 서포트',[
    ability(1,'sp_lesson_end','Vocal',12,{effects:[effect('Vocal',12,'end_lesson_vocal_sp')]}),
    ability(2,'lesson_end','Vocal',9,{effects:[effect('Vocal',9,'end_lesson_vocal')]}),
    ability(3,'delete','Visual',2)]);
  const result=opts([selected],{delete:1},{perAxisCounts:{vocal:{sp_lesson_end:2,lesson_end:3},dance:{lesson_end:3}}});
  assert.deepEqual(guide(result),['보컬 레슨을 고르고, SP 레슨이 열리면 우선 선택하세요.','삭제 기회가 나오면 루프에 필요 없는 카드를 먼저 빼세요.']);
  selected.levelAbilities[1].effects[0].triggerId='end_lesson_dance';
  assert.deepEqual(guide(result),['댄스 레슨이 열리면 우선 선택하세요.','보컬 SP 레슨이 열리면 우선 선택하세요.']);
});
