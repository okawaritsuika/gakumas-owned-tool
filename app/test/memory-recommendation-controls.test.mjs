import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import { buildMemoryReplacements } from '../lib/memory-replacements.mjs';
import { summarizeMemoryEffects } from '../lib/memory-effects.mjs';
import { memoryBattleRoles } from '../lib/recommend.mjs';

const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
function settingsHarness(){
  const fields=new Map(),saved=new Map();
  const field=id=>{
    if(!fields.has(id))fields.set(id,{value:'',checked:false});
    return fields.get(id);
  };
  field('memorySelectionMode').value='guide';
  const context=vm.createContext({$:field,ui:{selectedMemorySkillIds:['core'],selectedHifEffectIds:['effect']},
    array:value=>Array.isArray(value)?value:[],firstNumber:()=>80,number:Number,
    localStorage:{setItem:(key,value)=>saved.set(key,value),getItem:key=>saved.get(key)}});
  for(const [start,end] of [
    ['function recommendationOptions(){','function recommendationConditionsChanged()'],
    ['function saveRecommendationMode(){',"for(const id of ['scenarioSelect','activityFocusSelect','eventModeSelect','memorySelectionMode'])"],
    ['function restoreRecommendationMode(){','\nrestoreRecommendationMode();']
  ])vm.runInContext(app.slice(app.indexOf(start),app.indexOf(end)),context);
  return {field,saved,run:code=>vm.runInContext(code,context)};
}

test('the normal form sends the selected memory mode in each scenario and only applies HIF manual targets in guide mode',()=>{
  assert.match(html,/<select id="memorySelectionMode"[^>]*><option value="guide">공략 기준<\/option><option value="stats">스탯만 보기<\/option>/);
  const {field,run}=settingsHarness();
  for(const scenario of ['hajime','nia','hif']){
    field('scenarioSelect').value=scenario;
    for(const mode of ['guide','stats']){
      field('memorySelectionMode').value=mode;
      const body=run('recommendationOptions()');
      assert.equal(body.scenario,scenario);
      assert.equal(body.memorySelectionMode,mode);
      assert.equal(body.desiredSkillIds?.join(','),scenario==='hif'&&mode==='guide'?'core':undefined);
      assert.equal(body.requiredHifEffectIds?.join(','),scenario==='hif'&&mode==='guide'?'effect':undefined);
    }
  }
});

test('mode survives restoring the settings and old or invalid saved modes retain the guide default',()=>{
  const {field,saved,run}=settingsHarness();
  field('scenarioSelect').value='nia';
  field('memorySelectionMode').value='stats';
  run('saveRecommendationMode()');
  field('scenarioSelect').value='hajime';
  field('memorySelectionMode').value='guide';
  run('restoreRecommendationMode()');
  assert.equal(field('scenarioSelect').value,'nia');
  assert.equal(field('memorySelectionMode').value,'stats');
  for(const old of [{scenario:'hif'},{scenario:'hif',memorySelectionMode:'unknown'}]){
    saved.set('owned-note-recommend-mode',JSON.stringify(old));
    field('memorySelectionMode').value='guide';
    run('restoreRecommendationMode()');
    assert.equal(field('scenarioSelect').value,'hif');
    assert.equal(field('memorySelectionMode').value,'guide');
  }
});

test('the carry checklist uses copy timing, keeps exact details in the dialog and shows a single-slot delta',()=>{
  const context=vm.createContext({array:value=>Array.isArray(value)?value:[],formatNumber:String,
    escapeHtml:String,memoryCopyName:row=>row.name,memoryPhase:row=>({availableAtStart:row.atStart}),
    memoryEffectsOf:row=>row.effects,memoryCopyStatsMarkup:()=>'',assetUrl:()=>'',firstNumber:()=>1,
    expandableMarkup:(title,body)=>title+body,growthPercent:value=>`${value/10}%`});
  vm.runInContext(app.slice(app.indexOf('function carryCopyPhase('),app.indexOf('function supportContributionMarkup(')),context);
  const result={scoreSummary:{scenario:'hif'},memories:[{name:'반짝반짝 색종이+',atStart:false}],memorySelectionReview:{slots:[{
    kind:'replaceable',role:'공격 · 드로우',latestPhase:2,reason:'초기 시험 화력',storedCustomizations:[{description:'정확한 개조'}],
    replacementCards:[{name:'교체 카드',owned:true},{name:'나중에 확보할 카드',owned:false}],
    alternatives:[{memory:{name:'교체 사본+',atStart:true},changes:{initial:{vocal:-5},growth:{dance:20},phaseChanged:true}}],
  }]}};
  const markup=context.finalMemoryPickMarkup(result);
  for(const term of ['선발 1 후 합류','합류 후 공격 · 드로우','같은 역할로 교체 가능','교체 가능한 카드','지금 가진 대안 사본 <small>1장','조건 맞는 보유 사본 없음','초기 Vo -5','성장 Da 2%','합류 시점 변경'])assert.ok(markup.includes(term),term);
  assert.doesNotMatch(markup,/초기 시험 화력|정확한 개조|사본 완성 스탯|메모리 상세/);
  result.memorySelectionReview.slots[0]={kind:'required',replacementCards:[],alternatives:[]};
  const fixed=context.finalMemoryPickMarkup(result);
  assert.match(fixed,/교체 대안 없음/);
  assert.doesNotMatch(fixed,/교체 대안 보기|지금 가진 대안 사본/);
});

test('owned substitutes keep the opening window, native skill role and other three equipped copies',()=>{
  const attackAndDraw='score+=genki;drawCard(1)';
  const skill=(gameId,actions,extra={})=>({gameId,upgradeCount:0,sourceType:'produce',plan:'logic',rentalUnlockProducerLevel:1,actions,...extra});
  const catalog={skillCards:[skill('core',attackAndDraw),skill('sub',attackAndDraw),skill('other',attackAndDraw),
    skill('attack','score+=genki'),skill('finish','score+=goodImpressionTurns;drawCard(1)'),
    skill('late',attackAndDraw),skill('future',attackAndDraw),skill('core',attackAndDraw,{upgradeCount:1}),
    skill('conditional',attackAndDraw,{conditions:'if:genki>=50'}),skill('special',attackAndDraw,{sourceType:'support'}),
    skill('locked',attackAndDraw,{rentalUnlockProducerLevel:80}),skill('b',''),skill('c','')]};
  const copy=(id,skillId,phase=1)=>({id,gameId:id,produceCardPhaseType:phase,
    produceCard:{id:skillId,upgradeCount:0,customizes:[]},abilities:[]});
  const selected=[copy('main','core'),copy('retained','other'),copy('third','b'),copy('fourth','c')];
  const available=[copy('01','core'),copy('02','sub'),copy('03','sub'),copy('04','sub'),copy('05','other'),
    copy('06','core',2),copy('07','attack'),copy('08','finish'),copy('09','locked'),copy('10','late',2),
    {...copy('11','core'),produceCard:{id:'core',upgradeCount:1,customizes:[]}},copy('12','conditional')];
  const options={scenario:'hif',plan:'logic',producerLevel:72};
  const inventory={memories:[...selected,...available]};
  const memories=selected.map(row=>{
    const modelEffects=summarizeMemoryEffects(row,catalog,options);
    return {...row,modelEffects,uniqueKeys:modelEffects.uniqueKeys,battleRoleProfile:memoryBattleRoles({modelEffects})};
  });
  const result={scoreSummary:options,memories,memorySelectionReview:{slots:memories.map((_,index)=>({
    basis:index===0?'opening_candidate':'stat_fill',roleMatches:[],label:'개시 스킬 우선'}))}};
  const compare=desiredSkillIds=>buildMemoryReplacements({result,inventory,catalog,options:{...options,desiredSkillIds}})[0];
  const slot=compare([]);
  assert.equal(slot.kind,'replaceable');
  assert.deepEqual(slot.alternatives.map(row=>row.memory.id),['02']);
  assert.deepEqual(slot.replacementCards.map(({gameId,owned})=>[gameId,owned]),[['sub',true],['late',false],['future',false]]);
  assert.deepEqual(compare(['core']).alternatives,[]);
  assert.deepEqual(compare(['core']).replacementCards,[]);
  assert.deepEqual(result.memories.map(row=>row.id),['main','retained','third','fourth']);
});
