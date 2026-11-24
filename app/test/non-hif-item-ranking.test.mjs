import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recommend} from '../lib/recommend.mjs';
import {evaluateScenarioDeck,fixedScenarioSupportGroup,scenarioRentalScoreCeiling} from '../lib/non-hif-support.mjs';

const read = name => JSON.parse(readFileSync(new URL('../data/catalog/'+name+'.json',import.meta.url)));
const routes = {hajimeSchedule:read('hajime_schedule'),hajimeProMenus:read('hajime_pro_menus'),niaSchedule:read('nia_schedule'),
  calculationModels:read('calculation_model_presets').data};
const card = (gameId,extra={}) => ({gameId,name:gameId,attribute:'vocal',plan:'free',maxLevels:[40,45,50,55,60],
  levelAbilities:[],events:[],...extra});
const ability = (kind,amount,axis='Vocal',limit=0) => ({level:1,order:1,kind,activationLimit:limit,
  effects:[{type:'ProduceEffectType_'+axis+'Addition',min:amount,max:amount}]});
const withItem = (id,trigger,body,condition,limit) => card(id,{events:[{release:'initial',effect_type:'p_item'}],
  p_item:{name:id,effect:{trigger:{key:trigger},body,...(condition?{condition}:{}),...(limit?{limit:{key:'per_produce',count:limit}}:{})}}});
const anchors = Array.from({length:4},(_,i)=>card('anchor'+i,{levelAbilities:[ability('initial_stat',40,'Dance')]}));
function run(scenario,difficulty,owned,rentals,options={},extra={}) {
  const registry={...routes,idolCards:[{gameId:'idol',characterId:'hkne',plan:'sense'}],skillCards:[],memoryAbilities:[],
    excelPresets:[],supportCards:[...owned,...rentals],...extra};
  return recommend({catalog:registry,inventory:{supportCards:owned.map(c=>({gameId:c.gameId,level:40,uncap:0})),
    idolCards:[{gameId:'idol'}]},options:{scenario,difficulty,idolGameId:'idol',plan:'sense',goal:'evaluation',
    targetAttribute:'vocal',supportLevelMode:'current',...options}});
}

test('an acquired change item flips a non-HIF rental at the observed parameter and produce cap',()=>{
  const teacher=withItem('teacher','skill_change',[{key:'param_up',param:'visual',value:25}],
    {key:'param_gte',param:'visual',threshold:400},3);
  const alternative=card('alternative',{levelAbilities:[ability('initial_stat',40,'Visual')]});
  const owned=[...anchors,card('neutral')];
  for(const [scenario,difficulty] of [['nia','pro'],['nia','master'],['hajime','pro'],['hajime','legend'],['hajime','master']]){
    const action=visual=>({action:'change',fromExamIndex:0,statsBefore:{visual}});
    const options={targetAttribute:'auto',supportItemAcquisitions:{teacher:{confirmed:true,beforeProduce:true}},
      produceActions:[399,400,400,400,400].map(action)};
    const result=run(scenario,difficulty,owned,[teacher,alternative],options);
    assert.equal(result.supports.rental.gameId,'teacher');
    assert.equal(result.supports.rental.supportItemValue.applied.activationCount,3);
    assert.equal(result.supports.rental.statContribution.visual,75);
    const absent=run(scenario,difficulty,owned,[teacher,alternative],{...options,supportItemAcquisitions:{teacher:{confirmed:false}}});
    assert.equal(absent.supports.rental.gameId,'alternative');
  }
});

test('a dated HIF interval or an action after the final week cannot supply an ordinary item',()=>{
  const teacher=withItem('teacher','skill_change',[{key:'param_up',param:'visual',value:25}]);
  for(const [scenario,difficulty] of [['nia','pro'],['hajime','pro']]){
    const result=run(scenario,difficulty,[...anchors,card('neutral')],[teacher],{rentalGameId:'teacher',
      supportItemAcquisitions:{teacher:{confirmed:true,beforeProduce:true}},produceActions:[
        {week:2,action:'change',venue:'interval',fromExamIndex:0},
        {week:39,action:'change',fromExamIndex:0},
        {week:2,action:'change',fromExamIndex:2},
        {week:2,action:'change',fromExamIndex:0},
      ]});
    assert.equal(result.scoreSummary.nonHifModel.excludedProduceActions.length,3);
    assert.equal(result.supports.rental.supportItemValue.applied.activationCount,1);
  }
});

test('planned drinks change other supports and stop at the recipient cap',()=>{
  const supplier=withItem('source','card_enhance',[{key:'random_pdrink_count',count:2}]);
  const receiver=card('receiver',{levelAbilities:[ability('p_drink_acquire',16,'Visual',3)]});
  const competitor=card('competitor',{levelAbilities:[ability('initial_stat',35,'Visual')]});
  const pins=[...anchors,receiver,competitor];
  for(const [scenario,difficulty] of [['nia','master'],['hajime','pro']]){
    const result=run(scenario,difficulty,pins,[supplier],{rentalGameId:'source',produceActions:[{action:'upgrade',quantity:2,fromExamIndex:0}]});
    assert.equal(result.supports.rental.supportItemValue.acquisitionConfirmed,false);
    assert.equal(result.supports.rental.supportItemValue.comparison.acquisitionAssumed,true);
    assert.ok(result.supports.owned.some(row=>row.gameId==='receiver'));
    assert.equal(result.scoreSummary.nonHifModel.supportItemActionCounts.p_drink_acquire,4);
    assert.equal(result.scoreSummary.nonHifModel.linkedStatContribution.visual,48);
  }
});

test('NIA admits several actions in one visit and rejects conflicting visits in the same week',()=>{
  const visit=(venue,week)=>({venue,week,action:'acquire'});
  const compare=(produceActions,extra={})=>run('nia','master',[],[],{produceActions,...extra});
  assert.throws(()=>compare([visit('consult',6),visit('outing',6)]),RangeError);
  assert.throws(()=>compare([visit('commercial',12)],{scenarioRewardVisits:[{week:12,venue:'company'}]}),RangeError);
  const result=compare([visit('consult',6),visit('consult',6)]);
  assert.equal(result.scoreSummary.expectedCounts.skill_acquire,2);
  const teacher=withItem('teacher','consult_selection',[{key:'param_up',param:'visual',value:25}]);
  const observed=run('nia','master',[],[teacher],{produceActions:[visit('consult',6),visit('consult',6)],
    supportItemAcquisitions:{teacher:{confirmed:true,beforeProduce:true}}});
  assert.equal(observed.supports.rental.supportItemValue.applied.activationCount,1);
});

test('the Hajime finalist may select an offered outing for its equipped item, and keeps dated visits binding',()=>{
  const item=withItem('outing','outing_end',[{key:'param_up',param:'visual',value:70}]);
  const options={rentalGameId:'outing',supportItemAcquisitions:{outing:{confirmed:true,beforeProduce:true}}};
  const result=run('hajime','legend',[],[item],options);
  const selections=result.scoreSummary.nonHifModel.selections;
  assert.equal(selections.find(day=>day.week===5).activity,'outing');
  assert.equal(result.supports.rental.supportItemValue.applied.activationCount,selections.filter(day=>day.activity==='outing').length);
  const forced=run('hajime','legend',[],[item],{...options,produceActions:[{action:'change',week:5,venue:'consult'}]});
  assert.equal(forced.scoreSummary.nonHifModel.selections.find(day=>day.week===5).activity,'consult');
});

test('a known saturated axis can change the chosen rental',()=>{
  const vo=card('vo',{levelAbilities:[ability('initial_stat',90)]});
  const vi=card('vi',{levelAbilities:[ability('initial_stat',70,'Visual')]});
  const result=run('nia','master',[...anchors,card('neutral')],[vo,vi],
    {targetAttribute:'auto',initialStats:{vocal:2000},statCaps:{vocal:2000,dance:2000,visual:2000}});
  assert.equal(result.supports.rental.gameId,'vi');
  assert.equal(result.scoreSummary.nonHifModel.cappedStats.vocal,2000);
});

test('a saturated axis may require replacing all five owned cards in a pinned rental draft',()=>{
  const vocal=Array.from({length:5},(_,i)=>card('vo'+i,{levelAbilities:[ability('initial_stat',90)]}));
  const visual=Array.from({length:5},(_,i)=>card('vi'+i,{levelAbilities:[ability('initial_stat',70,'Visual')]}));
  const result=run('nia','master',[...vocal,...visual],[card('fixed')],{rentalGameId:'fixed',targetAttribute:'auto',
    initialStats:{vocal:2600}});
  assert.equal(result.supports.rental.gameId,'fixed');
  assert.deepEqual(result.supports.owned.map(row=>row.gameId).sort(),visual.map(row=>row.gameId));
  assert.equal(result.scoreSummary.nonHifModel.cappedStats.visual,350);
});

test('the last of eight rental alternatives can enter through an item-supported owned replacement',()=>{
  const ownOnly={maxLevels:{0:40}};
  const core=Array.from({length:5},(_,i)=>card('core'+i,{...ownOnly,levelAbilities:[ability('initial_stat',20)]}));
  const receiver=card('receiver',{...ownOnly,levelAbilities:[ability('initial_stat',18),
    {...ability('p_drink_acquire',10,'Vocal',1),order:2}]});
  const fixed=[130,125,120,115,110,105,102,100,90].map(n=>card('r'+n,{levelAbilities:[ability('initial_stat',n)]}));
  const source=withItem('source','card_enhance',[{key:'random_pdrink_count',count:1}]);
  source.levelAbilities=[ability('initial_stat',85)];
  const options={targetAttribute:'auto',produceActions:[{action:'upgrade',fromExamIndex:0}]};
  const result=run('nia','master',[...core,receiver],[...fixed,source],options);
  const all=[result.supports.rental,...result.supports.rentalCandidates];
  assert.equal(all.length,9);
  assert.equal(all.at(-1).gameId,'source');
  assert.equal(all.at(-1).modeledDeckScore,193);
  // The same attainable score must survive the screen for a tie on the boundary.
  source.levelAbilities=[ability('initial_stat',82)];source.gameId='a-source';
  const tie=run('nia','master',[...core,receiver],[...fixed,source],options);
  assert.equal(tie.supports.rentalCandidates.at(-1).gameId,'a-source');
});

test('grouped substitutions and score ceilings respect weekly floors, item links, caps and rental duplicates',()=>{
  const vec=(vocal=0,dance=0,visual=0)=>({vocal,dance,visual});
  const ctx={base:vec(95,80),baseGrowth:vec(19),baseGrowthStats:vec(2),gains:vec(180,80,40),
    bonusRows:[vec(90,40,20),vec(90,40,20)],caps:vec(150,100,210),axisWeights:vec(1,.6,1),
    fixedUtility:3,remainingUpgradeTargets:3,separateItemSupply:{skill_enhance:true,p_drink_acquire:true}};
  const profile=i=>({gameId:String(i),statContribution:vec(i*7,12-i,i),growthRates:vec(10*i,10),
    individualGrowth:vec(2*Math.floor(90*i*10/1000)),utilityScore:i/3,
    supportItemValue:{comparison:{total:{resources:{pDrinkAcquisitions:i%3},operations:[]}}},
    itemReceivers:[{kind:'p_drink_acquire',axis:'dance',amount:i,limit:3,used:i%2}]});
  const owned=Array.from({length:7},(_,i)=>profile(i)),rentals=[profile(4),profile(8)];
  const ceiling=scenarioRentalScoreCeiling(owned,rentals,ctx);
  for(const rental of rentals) for(const first of owned) for(const second of owned) {
    const deck=[...owned.filter(c=>![first,second].includes(c) && c.gameId!==rental.gameId).slice(0,5),rental];
    if (deck.length!==6) continue;
    const score=evaluateScenarioDeck(deck,ctx);
    const grouped=evaluateScenarioDeck([fixedScenarioSupportGroup(deck,deck[1]),deck[1]],ctx);
    assert.ok(Math.abs(grouped-score)<1e-8);
    assert.ok(score<=ceiling(rental)+1e-8);
  }
});
