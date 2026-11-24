import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';

const support=(id,value,attribute='vocal')=>({id,gameId:id,name:id,attribute,plan:'free',maxLevels:{0:40,4:60},levelAbilities:[{order:1,level:1,kind:'initial_stat',effects:[{type:`ProduceEffectType_${attribute==='dance'?'Dance':'Vocal'}Addition`,min:value,max:value}]}]});
const catalog={supportCards:[...Array.from({length:6},(_,i)=>support('support-'+i,i+1,i<3?'vocal':'dance')),support('rental',50)],idolCards:[{id:'idol',gameId:'idol',name:'테스트 아이돌',plan:'sense',baseStats:{growthRatePermil:{vo:100}}}],skillCards:[],memoryAbilities:[],calculationModels:{},excelPresets:[]};

test('saved recommendations survive restart, support date choices and refresh only for the matching conditions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gakumas-recommendations-'));
  const snapshotPath = path.join(dir, 'inventory.json');
  const raw = { schemaVersion: 1, producerLevel: 80, capturedAt: '2026-11-03T10:00:00Z', capture: {},
    userSupportCardList: [{ supportCardId: 'support-0', level: 25, levelLimitRank: 0 }],
    userIdolCardList: [{ idolCardId: 'idol', levelLimitRank: 0, potentialRank: 0 }] };
  const settings = { scenario: 'hif', idolId: 'idol', activityFocus: 'consult', targetAttribute: 'vocal' };
  let server, base;
  async function start() {
    server = createAppServer({ snapshotPath, catalog });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (!server?.listening) return;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  async function post(route, body) {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  }
  try {
    await start();
    await post('/api/import', raw);
    const [first, concurrent] = await Promise.all([post('/api/recommend', settings), post('/api/recommend', settings)]);
    assert.ok([first, concurrent].some(result => result.recommendationCache.reused === false));
    assert.equal(first.recommendationCache.checkedAt, concurrent.recommendationCache.checkedAt);
    await stop();
    await start();
    const saved = await post('/api/recommend', settings);
    assert.deepEqual(saved.recommendationCache, { reused: true, checkedAt: first.recommendationCache.checkedAt });
    const token = saved.accountPlaybook.recommendationContextId;
    assert.notEqual(token, first.accountPlaybook.recommendationContextId);
    const { weekAdvice } = await post('/api/week-choices', { week: 1, recommendationContextId: token, liveState: { pp: 0 } });
    assert.equal(weekAdvice.week, 1);
    assert.equal(weekAdvice.liveResources.pp, 0);
    const refreshed = await post('/api/recommend', { ...settings, refreshRecommendation: true });
    assert.equal(refreshed.recommendationCache.reused, false);
    assert.ok(refreshed.recommendationCache.checkedAt > saved.recommendationCache.checkedAt);
    const updated = await post('/api/recommend', settings);
    assert.deepEqual(updated.recommendationCache, { reused: true, checkedAt: refreshed.recommendationCache.checkedAt });
    assert.equal((await post('/api/recommend', { ...settings, targetAttribute: 'dance' })).recommendationCache.reused, false);
    await post('/api/import', { ...raw, producerLevel: 81 });
    assert.equal((await post('/api/recommend', settings)).recommendationCache.reused, false);
  } finally {
    await stop();
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('gakumas-recommendations-'));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('guide listings work before collection and preserve current recommendation and memory artwork when comparing upgrades',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gakumas-guides-'));
  const filename=path.join(dir,'inventory.json');
  const c=structuredClone(catalog);
  c.scenarioEvents={sources:[{id:'events',title:'이벤트 자료',url:'https://example.test/events'}],scenarios:[{id:'hif',label:'H.I.F.'}],events:[{id:'event',scenario:'hif',titleKo:'이벤트',choices:[{labelKo:'체력 회복',rewards:['체력 +10']}],sourceIds:['events']}]};
  c.deckGuides={sources:[{id:'deck',title:'덱 공략',url:'https://example.test/deck'}],guides:[{id:'guide',scenario:'hif',titleKo:'덱 운영',sourceIds:['deck']}]};
  c.skillCards=[{gameId:'skill',upgradeCount:0,name:'스킬',nameKo:'스킬',nameJa:'スキル',plan:'sense',rentalUnlockProducerLevel:1,unlockProducerLevel:1,recommendationEligible:true,imageUrl:'/assets/skill.webp'}];
  c.idolCards[0].imageUrl='/assets/idol.webp';
  const server=createAppServer({snapshotPath:filename,catalog:c});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    const initial=await(await fetch(base+'/api/state')).json();
    assert.equal(initial.connection.status,'waiting');
    const response=await fetch(base+'/api/guides');
    assert.equal(response.status,200);
    const guides=await response.json();
    assert.deepEqual(guides.events,c.scenarioEvents);
    assert.deepEqual(guides.decks,c.deckGuides);
    assert.equal(guides.skillCards[0].imageUrl,'/assets/skill.webp');
    assert.deepEqual(await(await fetch(base+'/api/state')).json(),initial);
    await assert.rejects(fs.stat(filename),{code:'ENOENT'});
    const lists={userSupportCardList:Array.from({length:6},(_,i)=>({supportCardId:'support-'+i,level:25,levelLimitRank:0})),userIdolCardList:[{idolCardId:'idol',levelLimitRank:0,potentialRank:0}],userCharacterList:[],
      userMemoryList:[{userMemoryId:'memory',idolCardId:'idol',produceCard:{id:'skill',upgradeCount:0},produceCardPhaseType:1,abilities:[]}]};
    const raw={schemaVersion:1,producerLevel:80,capturedAt:'2026-11-03T10:00:00Z',capture:{collections:Object.fromEntries(Object.entries(lists).map(([name,rows])=>[name,{status:'complete',expectedCount:rows.length,exportedCount:rows.length}]))},...lists};
    assert.equal((await post('/api/import',raw)).status,200);
    const settings={scenario:'hajime',plan:'sense',targetAttribute:'vocal'};
    const baseline=await(await post('/api/recommend',settings)).json();
    const upgraded=await(await post('/api/recommend',{...settings,compareSupportUpgrades:true})).json();
    const {supportUpgradeComparison:comparison,...current}=upgraded;
    assert.deepEqual(current.personalizedPlan.supportUpgradePlan.upgrades,comparison.upgrades);
    assert.notEqual(current.accountPlaybook.recommendationContextId,baseline.accountPlaybook.recommendationContextId);
    assert.deepEqual({...current,accountPlaybook:{...current.accountPlaybook,recommendationContextId:baseline.accountPlaybook.recommendationContextId},
      recommendationCache:baseline.recommendationCache,personalizedPlan:{...current.personalizedPlan,supportUpgradePlan:null}},baseline);
    const removed=await post('/api/personalized',{scenario:'hif',runs:0});
    assert.equal(removed.status,410);
    assert.equal((await removed.json()).code,'removed_by_user_choice');
    assert.equal(comparison.available,true);
    assert.equal(comparison.upgrades[0].targetLevel,40);
    assert.equal(current.memories[0].skillImageUrl,'/assets/skill.webp');
    assert.equal(comparison.memories[0].gameId,'memory');
    assert.equal(comparison.memories[0].skillImageUrl,current.memories[0].skillImageUrl);
    assert.equal(comparison.memories[0].idolImageUrl,current.memories[0].idolImageUrl);
    assert.equal((await(await fetch(base+'/api/state')).json()).inventory.supportCards[0].level,25);
  } finally {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('gakumas-guides-'));
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test('HTTP workflow waits for collection, imports a real schema, lists ownership and recommends owned-only selections',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gakumas-server-'));
  const filename=path.join(dir,'inventory.json');
  const server=createAppServer({snapshotPath:filename,catalog});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const initial=await(await fetch(base+'/api/state')).json();
    assert.equal(initial.connection.status,'waiting');
    assert.equal(initial.inventory.counts.supportCards,null);
    const lists={userSupportCardList:Array.from({length:6},(_,i)=>({supportCardId:'support-'+i,level:25,levelLimitRank:0})),userIdolCardList:[{idolCardId:'idol',levelLimitRank:0,potentialRank:0}],userCharacterList:[],userMemoryList:[]};
    const raw={schemaVersion:1,capturedAt:'2026-11-03T10:00:00Z',capture:{collections:Object.fromEntries(Object.entries(lists).map(([name,rows])=>[name,{status:'complete',expectedCount:rows.length,exportedCount:rows.length}]))},...lists};
    const rejected=await fetch(base+'/api/import',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://unrelated.example'},body:JSON.stringify(raw)});
    assert.equal(rejected.status,403);
    const imported=await fetch(base+'/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(raw)});
    assert.equal(imported.status,200);
    const current=await(await fetch(base+'/api/state')).json();
    assert.equal(current.inventory.counts.supportCards,6);
    assert.equal(current.inventory.supportCards[0].level,25);
    const chosen=await(await fetch(base+'/api/recommend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:'hif',goal:'evaluation',type:'concentration',targetAttribute:'vocal'})})).json();
    assert.equal(chosen.selectedIdol.gameId,'idol');
    assert.equal(chosen.supports.length,6);
    assert.equal(chosen.supports.filter(row=>row.isRental).length,1);
    assert.ok(chosen.supports.filter(row=>!row.isRental).every(row=>lists.userSupportCardList.some(owned=>owned.supportCardId===row.gameId)));
    assert.ok(chosen.supports.some(row=>row.attribute==='vocal'));
    assert.ok(chosen.supports.some(row=>row.attribute==='dance'));
    assert.equal(chosen.scoreSummary.trainingType,'concentration');
    assert.equal(chosen.scoreSummary.targetAttribute,'vocal');
    assert.equal(chosen.scoreSummary.gameFinalScorePredicted,false);
    const cached=await(await fetch(base+'/api/week-choices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({week:1,
      recommendationContextId:chosen.accountPlaybook.recommendationContextId})})).json();
    assert.equal(cached.context.source,'recommend');
    assert.equal(cached.context.idolGameId,'idol');
    assert.deepEqual(cached.weekAdvice.liveResources,{stamina:null,currentMaxStamina:null,pp:null});
  } finally {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('gakumas-server-'));
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test('week-choice API uses the source-based recommendation without battle execution, preserves live values and invalidates changed ownership',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gakumas-week-choices-'));
  const filename=path.join(dir,'inventory.json'),c=structuredClone(catalog);
  const readCatalog=name=>fs.readFile(new URL('../data/catalog/'+name,import.meta.url),'utf8').then(JSON.parse);
  [c.produceResources,c.hifStatTargets,c.hifExamProfiles]=await Promise.all(['produce_resources.json','hif_stat_targets.json','hif_exam_profiles.json'].map(readCatalog));
  [c.eventModes,c.drinkVisuals,c.hifExamScoreTargets]=await Promise.all(['event_modes.json','drink_visuals.json','hif_exam_score_targets.json'].map(readCatalog));
  const schedule=Array.from({length:29},(_,i)=>({week:i+1,stage:i<20?'selection':'final',
    activities:[7,13,20].includes(i+1)?['mid_exam']:[27,29].includes(i+1)?['final_exam']:i+1===8?['outing','consult','supply_gift']:['consult']}));
  c.calculationModels={'score/schedule':{table:{hif:{none:schedule}}},'score/paramCap':{table:{hif:{none:3200}}}};
  c.idolCards[0]={...c.idolCards[0],plan:'anomaly',baseStats:{stamina:30,baseVoDaVi:{vo:100,da:100,vi:100},growthRatePermil:{vo:0,da:0,vi:0}},specialTrainingStages:[],awakeningStages:[]};
  c.skillCards=[0,1].map(upgradeCount=>({gameId:'owned-skill',name:'보유 스킬',nameJa:'保有スキル',plan:'anomaly',rarity:'SR',sourceType:'produce',
    upgradeCount,unlockProducerLevel:1,rentalUnlockProducerLevel:1,recommendationEligible:true,actions:'fullPowerCharge+=2'}));
  c.skillCards.push({gameId:'late-card',name:'75레벨 카드',plan:'anomaly',sourceType:'produce',rarity:'SR',upgradeCount:0,unlockProducerLevel:75,rentalUnlockProducerLevel:75,recommendationEligible:true},
    {gameId:'switch-card',name:'전환 카드',plan:'anomaly',sourceType:'produce',rarity:'SSR',upgradeCount:0,unlockProducerLevel:80,rentalUnlockProducerLevel:80,requiresSkillCardSwitch:true,recommendationEligible:true});
  c.memoryEffectDetails={tables:{ProducerLevelUnlocks:{'late-card':{level:75,type:'ProducerLevelUnlockType_ProduceCard'},'switch-card':{level:80,type:'ProducerLevelUnlockType_ProduceCardConversion'}}}};
  c.playbookPolicies={sources:[],policies:[{id:'event-access-test',scenario:'hif',plan:'anomaly',trainingType:'fullPower',
    cards:[{gameId:'late-card',action:'take',conditions:{minProducerLevel:75}},{gameId:'switch-card',action:'take',conditions:{minProducerLevel:80}}],
    drinks:[{id:'future-drink',name:'75레벨 드링크',conditions:{minProducerLevel:75},reason:'선택지에서 확인할 드링크'}],activityRules:[],cardManagement:[]}]};
  const profile=c.hifExamProfiles.profiles.find(row=>row.idolCardId==='i_card-kllj-3-015');
  c.hifExamProfiles.profiles=[{...profile,idolCardId:'idol'}];
  const server=createAppServer({snapshotPath:filename,catalog:c});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const lists={userSupportCardList:Array.from({length:6},(_,i)=>({supportCardId:'support-'+i,level:25,levelLimitRank:0})),
    userIdolCardList:[{idolCardId:'idol',levelLimitRank:0,potentialRank:0}],userCharacterList:[],
    userMemoryList:[{userMemoryId:'owned-copy',idolCardId:'idol',produceCard:{id:'owned-skill',upgradeCount:0,customizes:[]},produceCardPhaseType:1,abilities:[],
      vocal:444,dance:555,visual:666}]};
  const raw={schemaVersion:1,producerLevel:70,capturedAt:'2026-11-03T10:00:00Z',capture:{collections:Object.fromEntries(Object.entries(lists).map(([name,rows])=>[name,{status:'complete',expectedCount:rows.length,exportedCount:rows.length}]))},...lists};
  try{
    const uncached=await post('/api/week-choices',{week:8});assert.equal(uncached.status,409);assert.equal((await uncached.json()).code,'recommend_first');
    const published=await(await fetch(base+'/api/catalog')).json();
    assert.deepEqual(published.eventModes,c.eventModes);assert.deepEqual(published.drinkVisuals,c.drinkVisuals);
    assert.equal((await post('/api/import',raw)).status,200);
    const response=await post('/api/recommend',{scenario:'hif',idolId:'idol',plan:'anomaly',type:'fullPower',targetAttribute:'dance'});assert.equal(response.status,200);
    const saved=await response.json();
    const weekChoices=body=>post('/api/week-choices',{recommendationContextId:saved.accountPlaybook.recommendationContextId,...body});
    assert.match(saved.accountPlaybook.recommendationContextId,/^[a-f\d-]{36}$/);
    const initialVersion=(await(await fetch(base+'/api/state')).json()).inventoryVersion;
    assert.match(initialVersion,/^[a-f\d]{64}$/);
    assert.equal((await(await fetch(base+'/api/post-produce-memory-options')).json()).inventoryVersion,initialVersion);
    assert.equal(saved.accountPlaybook.lockedCards.find(card=>card.gameId==='late-card').category,'locked');
    assert.equal(saved.accountPlaybook.drinks[0].available,false);
    assert.deepEqual(saved.memories[0].produceRecordStats,{vocal:444,dance:555,visual:666,stamina:null});
    assert.equal(saved.scoreSummary.gameFinalScorePredicted,false);
    assert.equal(saved.candidates,undefined);
    assert.equal(saved.examScoreTargets.stages.length,3);
    assert.equal(saved.accountPlaybook.weekPlan.length,29);
    assert.ok(saved.accountPlaybook.weekPlan.every(row=>row.choiceAdvice&&row.nextExamTargets));
    for(const [week,index] of [[7,0],[8,1],[13,1],[14,2],[20,2],[21,3],[27,3],[28,4],[29,4]]){
      assert.equal(saved.accountPlaybook.weekPlan.find(row=>row.week===week).nextExamTargets.stages[0].examIndex,index);
    }
    const empty=await(await weekChoices({week:8})).json();
    assert.equal(empty.recommendationContextId,saved.accountPlaybook.recommendationContextId);
    assert.equal(empty.scoreTargets.stages[0].examIndex,1);
    assert.equal(empty.scoreTargets.stages[0].pass.passed,null);
    assert.deepEqual(empty.weekAdvice.liveResources,{stamina:null,currentMaxStamina:null,pp:null});
    assert.equal(empty.statTargets.stages[0].axes.vocal.value,saved.accountPlaybook.weekPlan.find(row=>row.week===8).nextExamTargets.stages[0].axes.vocal.value);
    assert.equal(empty.statTargets.stages[0].axes.vocal.valueSource,'conditional_projection');
    const zeroResponse=await weekChoices({week:8,liveState:{stamina:0,maxStamina:40,pp:0,stats:{vocal:0,dance:null},consultPrices:{upgrade:80}}});
    assert.equal(zeroResponse.status,200);
    const zero=await zeroResponse.json();
    assert.deepEqual(zero.weekAdvice.liveResources,{stamina:0,currentMaxStamina:40,pp:0});
    assert.equal(zero.statTargets.stages[0].axes.vocal.value,0);
    assert.equal(zero.statTargets.stages[0].axes.vocal.valueSource,'direct_input');
    assert.equal(zero.statTargets.stages[0].axes.vocal.remainingToCriterion,340);
    assert.equal(zero.statTargets.stages[0].axes.dance.value,null);
    assert.equal(zero.statTargets.stages[0].axes.visual.value,null);
    assert.equal(zero.statTargets.stages[0].axes.vocal.currentMark,null);
    const consult=zero.weekAdvice.activities.find(row=>row.activity==='consult');
    assert.equal(consult.canVisit,true);
    assert.ok(consult.choices.some(choice=>choice.action==='upgrade'&&choice.canChoose===false));
    assert.ok(zero.weekAdvice.activities.find(row=>row.activity==='outing').choices.some(choice=>choice.costs.pp===0&&choice.canChoose===true&&choice.rewards.staminaRecovery===24));
    assert.equal(zero.context.source,'recommend');
    const removed=await post('/api/personalized',{scenario:'hif',runs:128});
    assert.equal(removed.status,410);assert.equal((await removed.json()).code,'removed_by_user_choice');
    const retained=await(await weekChoices({week:8})).json();
    assert.deepEqual(retained,empty);
    const timestampOnly={...raw,capturedAt:'2026-11-04T01:00:00Z'};
    await fs.writeFile(filename,JSON.stringify(timestampOnly));
    assert.equal((await weekChoices({week:8})).status,200);
    assert.equal((await(await fetch(base+'/api/state')).json()).inventoryVersion,initialVersion);
    const changed=structuredClone(timestampOnly);changed.userSupportCardList[0].level=26;
    await fs.writeFile(filename,JSON.stringify(changed));
    const stale=await weekChoices({week:8});assert.equal(stale.status,409);assert.equal((await stale.json()).reason,'inventory_changed');
    assert.notEqual((await(await fetch(base+'/api/state')).json()).inventoryVersion,initialVersion);
    assert.equal((await post('/api/recommend',{scenario:'hif',type:'fullPower',targetAttribute:'dance',sourceSupportMode:'unsupported'})).status,400);
    assert.equal((await post('/api/recommend',{scenario:'nia',memorySelectionMode:'unsupported'})).status,400);
    assert.equal((await post('/api/recommend',{scenario:'hif',type:'fullPower',targetAttribute:'dance',activityFocus:'unsupported'})).status,400);
    const eventOptions={scenario:'hif',idolId:'idol',plan:'anomaly',type:'fullPower',targetAttribute:'dance',eventModeId:c.eventModes.modes[0].id,eventRentalSkillIds:['owned-skill']};
    const eventResponse=await post('/api/recommend',eventOptions);assert.equal(eventResponse.status,200);
    const event=await eventResponse.json();
    assert.equal(event.eventContext.status,'pending_rules');
    assert.equal(event.eventContext.recommendationApplied,false);
    assert.equal(event.eventContext.selectedSkills[0].owned,false);
    assert.equal(event.eventContext.selectedSkills[0].statBonus.vocal,null);
    assert.equal(event.eventContext.verifiedUnlockRuleApplication.appearanceApplied,true);
    assert.equal(event.accountPlaybook.takeCards.find(card=>card.gameId==='late-card').access.eligible,true);
    assert.equal(event.accountPlaybook.takeCards.find(card=>card.gameId==='late-card').access.producerLevelWaivedByEvent,true);
    assert.equal(event.accountPlaybook.drinks[0].available,true);
    assert.equal(event.accountPlaybook.drinks[0].ownershipKnown,false);
    assert.equal(event.personalizedPlan.context.producerLevel.value,70);
    assert.equal(event.accountPlaybook.lockedCards.find(card=>card.gameId==='switch-card').category,'locked');
    assert.equal(event.examScoreTargets.stages[0].status,'normal_reference_event_applicability_unknown');
    assert.deepEqual(event.memories.map(memory=>memory.id),saved.memories.map(memory=>memory.id));
    assert.deepEqual(event.memories[0].produceRecordStats,saved.memories[0].produceRecordStats);
    assert.equal((await(await fetch(base+'/api/state')).json()).inventory.counts.memories,1);
    const invalidEvent=await post('/api/recommend',{...eventOptions,eventRentalSkillIds:['owned-skill','another']});
    assert.equal(invalidEvent.status,400);assert.equal((await invalidEvent.json()).code,'invalid_event_selection');
    const forged=await(await post('/api/recommend',{scenario:'hif',idolId:'idol',type:'fullPower',targetAttribute:'dance',
      eventUnlockOverrides:{validated:true,producerLevelUnlock:true,memoryRentalProducerLevelUnlock:true}})).json();
    assert.equal(forged.accountPlaybook.lockedCards.find(card=>card.gameId==='late-card').category,'locked');
    assert.equal(forged.accountPlaybook.drinks[0].available,false);
    assert.equal((await post('/api/week-choices',{week:0})).status,400);
    assert.equal((await post('/api/week-choices',{week:8,liveState:{pp:'0'}})).status,400);
    assert.equal((await post('/api/week-choices',{week:8,liveState:{stats:{vocal:false}}})).status,400);
    assert.equal((await post('/api/import',raw)).status,200);
    assert.equal((await weekChoices({week:8})).status,409);
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gakumas-week-choices-'));
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test('week-choice contexts stay isolated across clients and evicted or missing tokens never fall back to the latest recommendation',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gakumas-week-context-'));
  const filename=path.join(dir,'inventory.json'),c=structuredClone(catalog);
  c.idolCards=['synthetic-a','synthetic-b'].map(gameId=>({...c.idolCards[0],id:gameId,gameId}));
  const lists={userSupportCardList:Array.from({length:6},(_,i)=>({supportCardId:'support-'+i,level:25,levelLimitRank:0})),
    userIdolCardList:c.idolCards.map(card=>({idolCardId:card.gameId,levelLimitRank:0,potentialRank:0})),userCharacterList:[],userMemoryList:[]};
  const raw={schemaVersion:1,producerLevel:70,capturedAt:'2026-11-05T00:00:00Z',
    capture:{collections:Object.fromEntries(Object.entries(lists).map(([name,rows])=>[name,{status:'complete',expectedCount:rows.length,exportedCount:rows.length}]))},...lists};
  const server=createAppServer({snapshotPath:filename,catalog:c});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const recommendFor=async idolId=>{
    const response=await post('/api/recommend',{scenario:'hif',idolId,type:'concentration',activityFocus:'consult'});
    assert.equal(response.status,200);return response.json();
  };
  try{
    assert.equal((await post('/api/import',raw)).status,200);
    const a=await recommendFor('synthetic-a'),b=await recommendFor('synthetic-b');
    const tokenA=a.accountPlaybook.recommendationContextId,tokenB=b.accountPlaybook.recommendationContextId;
    assert.notEqual(tokenA,tokenB);
    for(const [recommendationContextId,idolGameId] of [[tokenA,'synthetic-a'],[tokenB,'synthetic-b']]){
      const response=await post('/api/week-choices',{week:1,recommendationContextId});assert.equal(response.status,200);
      const body=await response.json();assert.equal(body.context.idolGameId,idolGameId);assert.equal(body.recommendationContextId,recommendationContextId);
    }
    const missing=await post('/api/week-choices',{week:1});assert.equal(missing.status,409);
    assert.equal((await missing.json()).reason,'recommendation_context_required');
    const unrelated=await post('/api/week-choices',{week:1,recommendationContextId:'unknown-context'});assert.equal(unrelated.status,409);
    assert.equal((await unrelated.json()).reason,'recommendation_context_expired');
    let latest=b;
    for(let i=0;i<16;i++)latest=await recommendFor(i%2?'synthetic-a':'synthetic-b');
    const evicted=await post('/api/week-choices',{week:1,recommendationContextId:tokenA});assert.equal(evicted.status,409);
    assert.equal((await evicted.json()).reason,'recommendation_context_expired');
    const newest=latest.accountPlaybook.recommendationContextId;
    assert.equal((await post('/api/week-choices',{week:1,recommendationContextId:newest})).status,200);
    assert.equal((await post('/api/import',raw)).status,200);
    assert.equal((await post('/api/week-choices',{week:1,recommendationContextId:newest})).status,409);
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gakumas-week-context-'));
    await fs.rm(dir,{recursive:true,force:true});
  }
});
