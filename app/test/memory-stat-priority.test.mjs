import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../lib/recommend.mjs';

const scenarios = ['hajime','nia','hif'];
const skill = (id, options = {}) => ({ gameId:id, name:id, plan:'sense', upgradeCount:0,
  rentalUnlockProducerLevel:1, recommendationEligible:true, ...options });
const skills = [skill('one'),skill('two'),skill('three'),skill('plain'),
  skill('action',{actions:'drawCard(1);cardUsesRemaining+=1;concentration+=2'}),
  skill('incompatible',{plan:'logic'}),skill('disabled',{recommendationEligible:false}),
  skill('locked',{rentalUnlockProducerLevel:80}),skill('switch',{requiresSkillCardSwitch:true,unlockProducerLevel:55})];
const fixed = value => ['vo'+value,'VocalAddition',value];
const kinds = [fixed(55),fixed(60),fixed(65),fixed(20),fixed(15),fixed(999),
  ['growth','VocalGrowthRateAddition',30],['dance15','DanceAddition',15],['unique10','VocalAddition',10],['exam','ExamStatusEnchant',1]];
const catalog = { supportCards:[],idolCards:[],skillCards:skills,calculationModels:{},excelPresets:[],
  memoryAbilities:kinds.map(([id])=>({ id,level:1,produceSkillId:id,produceSkillLevel:1,isUniqueActivation:id==='unique10',
    restrictions:id==='exam'?{plan:'free',explicitGroupScenarios:['hif']}:{plan:'free'},
    branches:[{produceEffectId:id,produceTriggerId:'start',phaseType:'ProducePhaseType_ProduceStart',activationRatePermilRaw:0}] })),
  memoryMechanicsGraph:{ ProduceTrigger:[],ProduceEffect:kinds.map(([id,type,value])=>({id,
    produceEffectType:'ProduceEffectType_'+type,effectValueMin:value,effectValueMax:value})) } };
const memory = (id, card, ...abilities) => ({id,produceCard:{id:card,upgradeCount:0},produceCardPhaseType:1,
  abilities:abilities.map(id=>({id,level:1}))});
const anchors = [memory('anchor-1','one','vo65'),memory('anchor-2','two','vo60'),memory('anchor-3','three','vo55')];
const defaultMemories = [...anchors,memory('plain-20','plain','vo20'),memory('action-15','action','vo15','exam')];
function run(scenario, memories = defaultMemories, options = {}, producerLevel = 70) {
  return recommend({catalog,inventory:{producerLevel,memories},options:{scenario,plan:'sense',
    trainingType:'concentration',targetAttribute:'vocal',secondaryAttribute:'dance',activityFocus:'consult',
    deckTemplate:'4-2',baseLessonGains:{vocal:1000,dance:0,visual:0},memorySelectionMode:'stats',
    compareSupportUpgrades:false,...options}});
}
const requested = {desiredSkillIds:['action'],requiredHifEffectIds:['exam']};
const ids = result => result.memories.map(row=>row.id).sort();
const observed = result => ({selected:ids(result), individual:result.memories.map(row=>({id:row.id,score:row.score,roleScore:row.roleScore})),
  statSelection:result.scoreSummary.memoryStatSelection ?? null});
if (process.argv.includes('--snapshot')) {
  console.log(JSON.stringify(Object.fromEntries(scenarios.map(scenario=>[scenario,{
    controls:observed(run(scenario)),requests:observed(run(scenario,defaultMemories,requested))}]))));
} else if (process.argv.includes('--boundary-snapshot')) {
  const legacy={id:'legacy-999',abilities:[{id:'vo999',level:1}]};
  console.log(JSON.stringify(Object.fromEntries(scenarios.map(scenario=>[scenario,{
    legacyVersusVerified:observed(run(scenario,[...defaultMemories,legacy],requested)),
    vacantSlot:observed(run(scenario,[...anchors,legacy])),
    growthAlternative:observed(run(scenario,[...defaultMemories,memory('growth','plain','growth')]))}]))));
} else {
  for (const scenario of scenarios) {
    test(scenario+' selects numeric +20 over requested +15 extra action',()=>{
      for (const options of [{},requested,{...requested,comparisonWeights:{action:100000,training:100000,draw:100000}}]) {
        const result=run(scenario,defaultMemories,options);
        assert.deepEqual(ids(result),['anchor-1','anchor-2','anchor-3','plain-20']);
        assert.equal(result.scoreSummary.memoryStatSelection.score,200);
        assert.ok(result.memories.every(row=>row.roleScore===0));
      }
    });
    test(scenario+' selects aggregate route growth and rejects ineligible copies',()=>{
      const result=run(scenario,[...defaultMemories,memory('growth','plain','growth'),
        memory('wrong-plan','incompatible','vo999'),memory('unavailable','disabled','vo999'),
        memory('above-level','locked','vo999'),memory('switch-off','switch','vo999')],
        {...requested,skillCardSwitchSettings:{switch:false}});
      assert.deepEqual(ids(result),['anchor-1','anchor-2','anchor-3','growth']);
      assert.equal(result.scoreSummary.memoryStatSelection.initialStats.vocal,180);
      assert.equal(result.scoreSummary.memoryStatSelection.routeGrowthStats.vocal,30);
      assert.equal(result.scoreSummary.memoryStatSelection.score,210);
    });
    test(scenario+' breaks equal numeric ties by physical copy ID irrespective of skill and order',()=>{
      const first=memory('a-copy','plain','vo20'), second=memory('b-copy','action','vo20','exam');
      for (const [left,right] of [[first,second],[{...first,produceCard:second.produceCard},{...second,produceCard:first.produceCard}]]) {
        const result=run(scenario,[right,...anchors,left].reverse(),requested);
        assert.deepEqual(ids(result),['a-copy','anchor-1','anchor-2','anchor-3']);
      }
    });
    test(scenario+' retains an eligible high-stat physical copy beyond 32 action/target seeds',()=>{
      const noise=Array.from({length:32},(_,i)=>memory('earlier-'+i,'action','vo15','exam'));
      const memories=[...noise,...anchors,memory('last','plain','vo20')];
      const result=run(scenario,memories,{...requested,allowDuplicateMemorySkillIds:['action'],comparisonWeights:{action:10000}});
      assert.deepEqual(ids(result),['anchor-1','anchor-2','anchor-3','last']);
    });
    test(scenario+' reports unidentified legacy +999 without replacing a verified +20 or filling a missing slot',()=>{
      const legacy={id:'legacy',abilities:[{id:'vo999',level:1}]};
      const incomplete=memory('missing-upgrade','plain','vo999');
      delete incomplete.produceCard.upgradeCount;
      const result=run(scenario,[...anchors,memory('verified-20','plain','vo20'),legacy,incomplete,memory('switch-unknown','switch','vo999'),
        memory('unknown-card','unlisted','vo999'),{id:'unknown-battle-only',abilities:[{id:'exam',level:1}]}]);
      assert.deepEqual(ids(result),['anchor-1','anchor-2','anchor-3','verified-20']);
      assert.deepEqual(result.scoreSummary.memoryStatSelection.missingSkillIdentityMemoryIds,['legacy','unknown-battle-only']);
      assert.deepEqual(result.scoreSummary.memoryStatSelection.unverifiedSkillEligibilityMemoryIds.sort(),
        ['missing-upgrade','switch-unknown','unknown-card']);
      const shortage=run(scenario,[...anchors,legacy,{...memory('absent','plain','vo999'),id:null}]);
      assert.deepEqual(ids(shortage),['anchor-1','anchor-2','anchor-3']);
      assert.equal(shortage.scoreSummary.memoryStatSelection.slots,3);
      const withoutLevel=run(scenario,[legacy,memory('unknown-level','plain','vo999')],{},null);
      assert.deepEqual(ids(withoutLevel),[]);
      assert.deepEqual(withoutLevel.scoreSummary.memoryStatSelection.missingSkillIdentityMemoryIds,['legacy']);
    });
    test(scenario+' matches exhaustive four-copy comparison on a 28-copy pool with skill conflicts and two capped axes',()=>{
      const cardIds=['one','two','three','plain','action'];
      const variants=[['vo20'],['dance15'],['growth'],['vo15','dance15'],['growth','dance15'],['vo20','growth']];
      const memories=Array.from({length:28},(_,i)=>memory('copy-'+String(i).padStart(2,'0'),
        cardIds[i%5],...variants[i%6]));
      const caps={vocal:1036,dance:35,visual:100};
      const actual=run(scenario,memories.slice().reverse(),{...requested,statCaps:caps,selectionStatCaps:caps});
      let best=-Infinity, bestIds=[];
      for(let a=0;a<25;a++)for(let b=a+1;b<26;b++)for(let c=b+1;c<27;c++)for(let d=c+1;d<28;d++){
        const four=[memories[a],memories[b],memories[c],memories[d]];
        if(new Set(four.map(r=>r.produceCard.id)).size!==4)continue;
        const effects=four.flatMap(r=>r.abilities.map(e=>e.id));
        const vocal=effects.reduce((sum,id)=>sum+({vo20:20,vo15:15,growth:30}[id]??0),0);
        const dance=effects.filter(id=>id==='dance15').length*15;
        const score=Math.min(36,vocal)+Math.min(35,dance);
        if(score>best){best=score;bestIds=four.map(r=>r.id);}
      }
      assert.equal(actual.scoreSummary.memoryStatSelection.score,best);
      assert.deepEqual(ids(actual),bestIds);
    });
    test(scenario+' preserves its unique-effect legality while scoring an applicable flat bonus only once',()=>{
      const memories=[memory('a','one','vo65','unique10'),memory('b','two','vo60','unique10'),
        memory('c','three','vo55'),memory('d','plain','vo20'),memory('e','action','vo15')];
      const result=run(scenario,memories,requested);
      assert.deepEqual(ids(result),scenario==='hif'?['a','b','c','d']:['a','c','d','e']);
      assert.equal(result.scoreSummary.memoryStatSelection.score,scenario==='hif'?210:165);
    });
  }
  test('HIF rejects a larger opening bonus that is lost at the selection-stage cap',()=>{
    const result=run('hif',[...anchors,memory('plain-20','plain','vo20'),memory('dance-15','action','dance15')],
      {initialStats:{vocal:1820,dance:0,visual:0},selectionStatCaps:{vocal:3000,dance:3000,visual:3000},
        statCaps:{vocal:5000,dance:5000,visual:5000}});
    assert.deepEqual(ids(result),['anchor-1','anchor-2','anchor-3','dance-15']);
    assert.deepEqual(result.scoreSummary.memoryStatSelection.effectiveStats,{vocal:180,dance:15,visual:0});
  });
}
