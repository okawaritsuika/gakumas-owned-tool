import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';
import {buildAccountPlaybook} from '../lib/account-playbook.mjs';
import {hajimeProRoutes} from '../lib/hajime-pro-route.mjs';
import {buildWeekChoiceAdvice} from '../lib/week-choice-advice.mjs';

const source=fs.readFileSync(new URL('../web/playbook.js',import.meta.url),'utf8');
const supportGuidance=fs.readFileSync(new URL('../web/support-action-guidance.js',import.meta.url),'utf8');
const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog',import.meta.url))});
const nativeSchedule=catalog.calculationModels['score/schedule'].table.hif.none;
const escaped=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function resultFixture(){
  return {scoreSummary:{scenario:'hif'},accountPlaybook:{recommendationContextId:'fixture-context',context:{scenario:'hif'},scheduleContext:{sourceScenario:'hif',status:'verified_base_schedule',label:'선발 20일 · 본선 7일',groups:[{stage:'selection',label:'선발',days:20,steps:20},{stage:'final',label:'본선',days:7,steps:9}]},
    weekPlan:nativeSchedule.map(row=>{const activity=row.activities.find(value=>value==='outing')??row.activities[0],displayWeek=row.stage==='final'?row.week-20:row.week,eventPhase=row.stage==='final'?({27:'라운드 1',28:'인터벌',29:'라운드 2'})[row.week]??null:null,displayDay=eventPhase?7:displayWeek;return {week:row.week,stage:row.stage,displayWeek,displayDay,eventPhase,label:eventPhase?'본선 당일 · '+eventPhase:(row.stage==='final'?'본선 ':'선발 ')+displayDay+'일차',activity,activityLabel:activity,alternatives:row.activities.filter(value=>value!==activity).map(activity=>({activity})),choiceAdvice:{fixedActivity:row.fixed}};})}};
}
function renderer(result=resultFixture()){
  const listeners={},label={textContent:''},overview={outerHTML:''};
  const dialog={open:false,scrollTop:100,showModal(){this.open=true;},addEventListener(type,handler){this[type]=handler;}};
  const title={textContent:''},content={innerHTML:''};
  const buttons=result.accountPlaybook.weekPlan.map(row=>({dataset:{routeWeek:String(row.week)},attributes:{},isConnected:true,setAttribute(key,value){this.attributes[key]=value;},focus(options){this.focused=options;}}));
  const output={addEventListener(type,handler){(listeners[type]??=[]).push(handler);}};
  const document={getElementById(id){return ({recommendOutput:output,dayRouteOverview:overview,routeDayDialog:dialog,routeDayDialogTitle:title,routeDayDialogContent:content})[id]??null;},querySelector(selector){return selector==='[data-route-selected-label]'?label:null;},querySelectorAll(selector){return selector==='[data-route-week]'?buttons:[];}};
  const context=vm.createContext({document,ui:{recommendation:result,recommendationRequest:{scenario:result.scoreSummary.scenario},playbookWeek:1},array:value=>Array.isArray(value)?value:[],text:value=>String(value??''),escapeHtml:escaped,safeSourceUrl:value=>value,number:value=>value===null||value===undefined||value===''?null:Number(value),personalizedDisplayResult:value=>value,loadMemorySkillVisualCatalog:()=>Promise.resolve(),matchMedia:()=>({matches:true}),api:async()=>({recommendationContextId:result.accountPlaybook.recommendationContextId,weekAdvice:{recommendations:[]},statTargets:{stages:[]}})});
  vm.runInContext(supportGuidance,context);
  vm.runInContext(source,context);
  const actualWeekActionMarkup=context.weekActionMarkup;
  context.weekActionMarkup=row=>`<p data-detail-week="${row.week}">${row.label}</p>`;
  return {context,listeners,label,overview,buttons,result,actualWeekActionMarkup,dialog,title,content};
}

test('ordinary Hajime and NIA difficulties show reference choices with their own week numbers',async()=>{
  for(const {scenario,difficulty,weeks,milestones} of [
    {scenario:'hajime',difficulty:'pro',weeks:16,milestones:[[6,'막판 스퍼트 레슨'],[7,'중간 시험'],[16,'최종 시험']]},
    {scenario:'hajime',difficulty:'master',weeks:18,milestones:[[7,'막판 스퍼트 레슨'],[8,'중간 시험'],[18,'최종 시험']]},
    {scenario:'hajime',difficulty:'legend',weeks:18,milestones:[[10,'중간 시험'],[18,'최종 시험']]},
    {scenario:'nia',difficulty:'pro',weeks:27,milestones:[[9,'1차 오디션'],[18,'2차 오디션'],[27,'최종 오디션']]},
    {scenario:'nia',difficulty:'master',weeks:26,milestones:[[9,'1차 오디션'],[17,'2차 오디션'],[26,'최종 오디션']]},
  ]){
    const result={scoreSummary:{scenario,difficulty},personalizedPlan:{context:{scenario,producerLevel:{value:70}},
      memoryStages:{atStart:[],afterMid:[],unknown:[]},midgamePlan:{}}};
    const book=buildAccountPlaybook({result,catalog});
    book.weekPlan=book.weekPlan.map(row=>({...row,choiceAdvice:buildWeekChoiceAdvice({book,result,catalog,week:row.week})}));
    result.accountPlaybook=book;
    const r=renderer(result);
    r.context.weekActionMarkup=r.actualWeekActionMarkup;
    const html=r.context.dayRouteOverviewMarkup(result);
    assert.equal((html.match(/data-route-week="/g)??[]).length,weeks);
    assert.match(html,new RegExp(`확인된 ${weeks}주`));
    assert.match(html,/기본 선택지/);
    assert.match(html,/날짜별 추천 행동 한눈에/);
    assert.doesNotMatch(html,/계산한 경로|route-unavailable/);
    for(const [week,label] of milestones)assert.match(html,new RegExp(`data-route-week="${week}"[^>]+aria-label="${week}주차 · ${label}"`));
    const choiceWeek=scenario==='nia'?13:difficulty==='legend'?5:3,button=r.buttons[choiceWeek-1];
    const event={target:{closest:selector=>selector==='[data-route-week]'?button:null}};
    await Promise.all(r.listeners.click.map(handler=>handler(event)));
    assert.equal(r.context.ui.playbookWeek,choiceWeek);
    assert.match(r.content.innerHTML,/외출/);assert.match(r.content.innerHTML,/상담/);
    assert.doesNotMatch(r.content.innerHTML,/data-week-recalculate|경로를 비교/);
  }
});

test('Kanae Pro shows her actual week 5 and 14 menus and the selected SP axis',()=>{
  const route=hajimeProRoutes(catalog,'hkne','vocal',{})[0];
  const result={scoreSummary:{scenario:'hajime',difficulty:'pro',hajimePro:route.hajimePro},
    selectedIdol:{characterId:'hkne'},personalizedPlan:{context:{scenario:'hajime',producerLevel:{value:70}},
      memoryStages:{atStart:[],afterMid:[],unknown:[]},midgamePlan:{}}};
  result.accountPlaybook=buildAccountPlaybook({result,catalog});
  const book=result.accountPlaybook, w5=book.weekPlan[4], w14=book.weekPlan[13], sp=book.weekPlan[3];
  sp.choiceAdvice=buildWeekChoiceAdvice({book,result,catalog,week:sp.week});
  assert.equal(book.scheduleContext.status,'reference_schedule');
  assert.equal(book.scheduleContext.sourceUrl,catalog.hajimeProMenus.byCharacter.hkne.sourceUrl);
  assert.deepEqual([w5.activity,...w5.alternatives.map(row=>row.activity)],['consult','outing','rest']);
  assert.deepEqual([w14.activity,...w14.alternatives.map(row=>row.activity)],['consult','activity_supply','outing','rest']);
  assert.match(w5.alternatives.at(-1).label,/체력 감소/);
  assert.equal(sp.activity,'sp_lesson');
  assert.match(sp.activityLabel,/댄스 SP 레슨/);
  const r=renderer(result);
  assert.match(r.context.dayRouteOverviewMarkup(result),/4주차 · 댄스 레슨/);
  assert.match(r.actualWeekActionMarkup(sp),/SP가 떴다면/);
  assert.match(r.actualWeekActionMarkup(sp),/댄스 일반 레슨/);
  Object.assign(r.context,{supportRows:()=>[],recordsOf:()=>[],supportSynergyMarkup:()=>''});
  const explanation=r.context.supportEvaluationMarkup(result);
  assert.doesNotMatch(explanation,/육성 중 우선할 행동/);
  assert.match(explanation,/^<details [^>]*data-detail-key="support-evaluation-evidence"><summary>서포트 효과 계산 근거<\/summary>/);
  assert.match(explanation,/일반 레슨 1회, SP 레슨 4회, 막판 스퍼트 2회/);
  assert.match(explanation,/덱 8장/);
});

test('the actual HIF route shows 20 selection days and 9 final steps across 7 days with local art and planned axes',()=>{
  const {context,result}=renderer();
  const html=context.dayRouteOverviewMarkup(result);
  assert.equal((html.match(/data-route-week="/g)??[]).length,29);
  assert.match(html,/확인된 20일/);assert.match(html,/확인된 7일 · 9개 일정/);
  assert.doesNotMatch(html,/<details/,'the overview must be open by default');
  assert.match(html,/route-axis-vocal/);assert.match(html,/Vo<small> \+ Da/);
  assert.match(html,/lang="ja">相談/);assert.match(html,/route-alternative-icons/);
  assert.match(html,/data-route-week="21"/);assert.match(html,/실제 진행 날짜를 자동으로 읽은 표는 아니에요/);
  for(const [,url] of html.matchAll(/src="(\/assets\/actions\/[^\"]+)"/g))assert.ok(fs.existsSync(fileURLToPath(new URL('../web'+url,import.meta.url))),url);
});

test('first final shortfalls appear only on matching preparation activities',()=>{
  const {context,result}=renderer();
  context.formatNumber=String;
  result.preparationReadiness={finals:[{examIndex:3,remaining:{vocal:0,dance:35,visual:75}}]};
  const lesson={stage:'final',activity:'vo_lesson_da'};
  const badge=context.routeShortfallMarkup(result,lesson,context.routeActivityMeta(lesson));
  assert.match(badge,/부족 예상.*dance\.png.*alt="댄스".*35/);
  assert.doesNotMatch(badge,/visual\.png|vocal\.png|75/);
  assert.equal(context.routeShortfallMarkup(result,{stage:'selection'},context.routeActivityMeta(lesson)),'');
  assert.equal(context.routeShortfallMarkup(result,{stage:'final'},context.routeActivityMeta('consult')),'');
});

test('final rounds and interval are separate buttons on the same day and still select their exact model step',async()=>{
  const r=renderer(),html=r.context.dayRouteOverviewMarkup(r.result);
  for(const [week,phase] of [[27,'라운드 1'],[28,'인터벌'],[29,'라운드 2']]){
    assert.match(html,new RegExp(`data-route-week="${week}"[^>]+aria-label="본선 당일 · ${phase}`));
    assert.match(html,new RegExp(`data-route-week="${week}"[^>]*>[\\s\\S]*?당일<small>${phase}</small>`));
  }
  const button=r.buttons.find(button=>button.dataset.routeWeek==='28'),event={target:{closest:selector=>selector==='[data-route-week]'?button:null}};
  await Promise.all(r.listeners.click.map(handler=>handler(event)));
  assert.equal(r.context.ui.playbookWeek,28);
  assert.match(r.content.innerHTML,/본선 당일 · 인터벌/);assert.match(r.label.textContent,/본선 당일 · 인터벌/);
});

test('Asari keeps the supplied base schedule and exposes its unverified event override warning',()=>{
  const {context,result}=renderer();result.eventContext={modeId:'asari_2026_10_30',status:'conditional'};
  result.accountPlaybook.scheduleContext={...result.accountPlaybook.scheduleContext,status:'base_schedule_event_override_unverified',warning:'일반 HIF 일정입니다. 아사리 변경 여부는 미확인입니다.'};
  const html=context.dayRouteOverviewMarkup(result);
  assert.match(html,/route-schedule-warning/);assert.match(html,/아사리 변경 여부는 미확인/);
  assert.equal((html.match(/data-route-week="/g)??[]).length,29);
});

test('a partial supplied route is not padded and a scenario mismatch never becomes a fabricated calendar',()=>{
  const {context,result}=renderer();
  result.accountPlaybook.weekPlan=result.accountPlaybook.weekPlan.filter(row=>[3,8,21].includes(row.week));
  let html=context.dayRouteOverviewMarkup(result);
  assert.equal((html.match(/data-route-week="/g)??[]).length,3);assert.doesNotMatch(html,/data-route-week="20"/);
  result.accountPlaybook.scheduleContext.sourceScenario='nia';
  html=context.dayRouteOverviewMarkup(result);
  assert.match(html,/다른 시나리오의 일정으로 대신 표시하지 않습니다/);assert.doesNotMatch(html,/data-route-week=/);
  result.accountPlaybook.weekPlan=[];result.accountPlaybook.scheduleContext.sourceScenario='hif';
  assert.doesNotMatch(context.dayRouteOverviewMarkup(result),/data-route-week=/);
});

test('day-button clicks open the matching modal and restore focus to the date',async()=>{
  const r=renderer(),button=r.buttons.find(button=>button.dataset.routeWeek==='21');
  const event={target:{closest:selector=>selector==='[data-route-week]'?button:null}};
  await Promise.all(r.listeners.click.map(handler=>handler(event)));
  assert.equal(r.context.ui.playbookWeek,21);
  assert.match(r.content.innerHTML,/data-detail-week="21"/);
  assert.equal(r.dialog.open,true);assert.equal(r.dialog.scrollTop,0);
  assert.match(r.title.textContent,/본선 1일차/);
  assert.equal(button.attributes['aria-pressed'],'true');assert.match(r.label.textContent,/본선 1일차/);
  r.dialog.open=false;r.dialog.close();
  assert.deepEqual({...button.focused},{preventScroll:true});
  const next=r.buttons.find(button=>button.dataset.routeWeek==='7');
  await Promise.all(r.listeners.click.map(handler=>handler({target:{closest:selector=>selector==='[data-route-week]'?next:null}})));
  assert.equal(r.context.ui.playbookWeek,7);assert.equal(button.attributes['aria-pressed'],'false');
  assert.equal(r.buttons.find(button=>button.dataset.routeWeek==='7').attributes['aria-pressed'],'true');
  assert.match(r.content.innerHTML,/data-detail-week="7"/);
  assert.equal(r.dialog.open,true);
});

test('live zero HP stays attached to the SP observation day across date changes',async()=>{
  const r=renderer();
  const values={stamina:'0'};
  const scope={querySelectorAll:()=>Object.entries(values).map(([key,value])=>({dataset:{weekValue:key},value})),querySelector:()=>({textContent:''})};
  const button={dataset:{weekRecalculate:'5'},closest:()=>scope};
  const event={target:{closest:selector=>selector==='[data-week-recalculate]'?button:null}};
  await Promise.all(r.listeners.click.map(handler=>handler(event)));
  const fifth=r.result.accountPlaybook.weekPlan.find(row=>row.week===5),sixth=r.result.accountPlaybook.weekPlan.find(row=>row.week===6);
  const lessonAdvice={day:{fields:{sp:true}},activities:[{family:"lesson"}]};
  r.context.ui.weekChoiceAdvice={5:lessonAdvice,6:lessonAdvice};
  assert.match(r.context.weekLiveInputMarkup(fifth),/data-week-value="stamina" value="0"/);
  assert.doesNotMatch(r.context.weekLiveInputMarkup(fifth),/data-week-value="pp"/);
  assert.match(r.context.weekLiveInputMarkup(sixth),/data-week-value="stamina" value=""/);
  r.context.ui.recommendation=resultFixture();
  assert.match(r.context.weekLiveInputMarkup(fifth),/data-week-value="stamina" value=""/);
});

function recalculate(r,week,stamina){
  const status={textContent:''},button={dataset:{weekRecalculate:String(week)},disabled:false};
  const values={stamina:String(stamina),maxStamina:'40',pp:'0',vocal:'0',dance:'0',visual:'0'};
  const scope={querySelectorAll:()=>Object.entries(values).map(([key,value])=>({dataset:{weekValue:key},value})),querySelector:()=>status};
  button.closest=()=>scope;
  const event={target:{closest:selector=>selector==='[data-week-recalculate]'?button:null}};
  return {status,button,completed:Promise.all(r.listeners.click.map(handler=>handler(event)))};
}

test('the latest request for the same recommendation and day wins over delayed success or failure',async()=>{
  for(const oldFails of [false,true]){
    const r=renderer(),pending=[];
    r.context.api=(route,request)=>new Promise((resolve,reject)=>pending.push({resolve,reject,body:JSON.parse(request.body)}));
    const older=recalculate(r,5,3),newer=recalculate(r,5,30),token=r.result.accountPlaybook.recommendationContextId;
    assert.equal(pending[0].body.recommendationContextId,token);assert.equal(pending[1].body.recommendationContextId,token);
    pending[1].resolve({recommendationContextId:token,weekAdvice:{inputStamina:30},statTargets:{inputStamina:30}});await newer.completed;
    if(oldFails)pending[0].reject(new Error('늦게 온 이전 오류'));
    else pending[0].resolve({recommendationContextId:token,weekAdvice:{inputStamina:3},statTargets:{inputStamina:3}});
    await older.completed;
    assert.equal(r.context.ui.weekChoiceAdvice[5].inputStamina,30);
    assert.equal(r.context.ui.weekExamTargets[5].inputStamina,30);
    assert.equal(r.context.ui.weekLiveState.stamina,30);
    assert.notEqual(older.status.textContent,'늦게 온 이전 오류');
  }
});

test('different days keep independent request order and a reply from another context is rejected',async()=>{
  const r=renderer(),pending=[];
  r.context.api=(route,request)=>new Promise(resolve=>pending.push({resolve,body:JSON.parse(request.body)}));
  const fifth=recalculate(r,5,5),sixth=recalculate(r,6,6),token=r.result.accountPlaybook.recommendationContextId;
  pending[1].resolve({recommendationContextId:token,weekAdvice:{inputStamina:6},statTargets:{}});await sixth.completed;
  pending[0].resolve({recommendationContextId:token,weekAdvice:{inputStamina:5},statTargets:{}});await fifth.completed;
  assert.equal(r.context.ui.weekChoiceAdvice[5].inputStamina,5);assert.equal(r.context.ui.weekChoiceAdvice[6].inputStamina,6);
  const mismatched=recalculate(r,5,10);
  pending[2].resolve({recommendationContextId:'another-recommendation',weekAdvice:{inputStamina:10},statTargets:{}});await mismatched.completed;
  assert.equal(r.context.ui.weekChoiceAdvice[5].inputStamina,5);
  assert.match(mismatched.status.textContent,/편성 조건이 다른 응답/);assert.equal(mismatched.button.disabled,false);
});

test('a response for a replaced recommendation never updates the new recommendation day advice',async()=>{
  const r=renderer();let resolve;
  r.context.api=()=>new Promise(done=>{resolve=done;});
  const older=recalculate(r,5,3),token=r.result.accountPlaybook.recommendationContextId;
  r.context.ui.recommendation=resultFixture();
  resolve({recommendationContextId:token,weekAdvice:{inputStamina:3},statTargets:{}});await older.completed;
  assert.equal(r.context.ui.weekChoiceAdvice,undefined);
});

test('all activity families have a distinct existing icon and unknown actions do not become SP lessons',()=>{
  const {context}=renderer();
  const activities=['lesson','sp_lesson','class','consult','outing','supply_gift','activity_supply','rest','final_exam','interval','special_training'];
  const paths=activities.map(activity=>context.routeActivityMeta(activity).imageUrl);
  assert.equal(new Set(paths).size,11);
  for(const url of paths)assert.ok(fs.existsSync(fileURLToPath(new URL('../web'+url,import.meta.url))),url);
  assert.equal(context.routeActivityMeta('unverified_action').family,'unknown');
  assert.match(context.activityIconMarkup('class_vi'),/\/assets\/actions\/class.svg/);
});
