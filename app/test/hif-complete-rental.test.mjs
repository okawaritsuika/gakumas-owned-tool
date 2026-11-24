import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadInventory } from '../lib/inventory.mjs';
import { loadCatalog } from '../lib/catalog.mjs';
import { createLiveCatalog } from '../lib/live-catalog.mjs';
import { recommend } from '../lib/recommend.mjs';
import { recommendInParallel } from '../lib/recommendation-parallel.mjs';

const catalog = loadCatalog();
const options = { scenario: 'hif', plan: 'sense', targetAttribute: 'dance', secondaryAttribute: 'visual',
  classAttribute: 'vocal', deckTemplate: '4-2', activityFocus: 'consult', memorySelectionMode: 'stats',
  sourceSupportMode: 'unrestricted', allowAssist: false, supportLevelMode: 'current' };
function fixture(dance, count, ownedCount) {
  const cards = Array.from({length: count}, (_, i) => {
    const attribute = dance.includes(i) ? 'dance' : 'visual';
    const stat = attribute === 'dance' ? 'Dance' : 'Visual';
    return {gameId: 's'+i, name: 's'+i, attribute, plan: 'free', maxLevels: {0:40, 4:60},
      levelAbilities: [{level:1, kind:'initial_stat', order:1, activationLimit:1,
        effects:[{type:'ProduceEffectType_'+stat+'Addition', min:i+1, max:i+1}]}]};
  });
  return {catalog:{...catalog,supportCards:cards}, inventory:{supportCards:cards.slice(0,ownedCount).map(c=>({gameId:c.gameId,level:40,uncap:0}))}};
}

for (const peak of [false,true]) for (const template of ['4-2','3-3']) {
  test('legal HIF '+template+' full deck, peak='+peak, () => {
    const dance = template==='4-2' ? peak ? [0,1,2,6] : [0,1,2,3] : [0,1,2];
    const data=fixture(dance,peak && template==='4-2' ? 8 : 7,7);
    const out=recommend({...data,options:{...options,supportPeakScenario:peak,deckTemplate:template}});
    assert.equal(out.supports.owned.length,5);
    const ids=[...out.supports.owned,out.supports.rental].map(c=>c.gameId);
    assert.equal(new Set(ids).size,6);
    assert.equal(out.scoreSummary.supportComparisonIndex,template==='3-3'?24:peak?27:23);
  });
}
test('HIF partial deck reports the quota and respects pinned rental and identity conflicts', () => {
  const data=fixture([0,1,2,3],7,7);
  for (const i of [1,2,3]) data.catalog.supportCards[i].name='s0';
  const out=recommend({...data,options:{...options,supportPeakScenario:false,rentalGameId:'s0'}});
  assert.equal(out.supports.rental.gameId,'s0');
  assert.equal(out.supports.owned.length,2);
  assert.match(out.warnings.join(' '),/4-2/);
});

test('parallel HIF activity search preserves every sequential route result and final choice', async () => {
  const args={...fixture([0,1,2,3,7],8,7),
    options:{...options,activityFocus:'auto',memorySelectionMode:'guide',producerLevel:65,supportPeakScenario:true}};
  const serial=recommend(args);
  const parallel=await recommendInParallel(args);
  assert.equal(parallel.activityRouteComparison.evaluatedDistinctRoutes,3);
  assert.deepEqual(JSON.parse(JSON.stringify(parallel)),JSON.parse(JSON.stringify(serial)));
});

test('full-pool retry reassigns an identity shared across two slot attributes', async () => {
  const {completeRentalDeck}=await import('../lib/hif-support-search.mjs');
  const card=(name,attribute)=>({name,attribute});
  const pool=[card('shared','dance'),card('shared','visual'),card('da-a','dance'),
    card('da-b','dance'),card('da-c','dance'),card('vi-a','visual')];
  const rental=card('rental','dance');
  const deck=completeRentalDeck(pool,rental,{dance:4,visual:2},false,c=>c.attribute,c=>c.name);
  assert.equal(deck.length,5);
  assert.ok(deck.some(row=>row.name==='shared' && row.attribute==='visual'));
  assert.equal(new Set([...deck,rental].map(c=>c.name)).size,6);
});

test('automatic author shortlist expands after an incomplete deck; an explicit guide restriction is preserved', () => {
  const data = fixture([0,1,2,3],7,7);
  const idol = {gameId:'test-idol',name:'test-idol',plan:'sense',recommendationEligible:true};
  data.inventory.idolCards=[{gameId:idol.gameId}];
  data.catalog.idolCards=[idol];
  data.catalog.guideSupportProfiles={profiles:[{id:'test-guide',scenario:'hif',idolGameId:idol.gameId,plan:'sense',
    idealSupports:[{gameId:'s0',attribute:'dance'}],alternativeSupports:[]}],sources:[]};
  function run(sourceSupportMode) {
    return recommend({...data,options:{...options,idolGameId:idol.gameId,sourceSupportMode,supportPeakScenario:false}});
  }
  const auto=run('auto');
  assert.equal(auto.supports.owned.length,5);
  assert.equal(auto.sourceGuideEvidence.automaticPoolExpansion.reason,'incomplete_guide_deck');
  assert.equal(run('guide').sourceGuideEvidence.completeSixCardDeck,false);
});

const copiedInventory=process.env.HIF_REGRESSION_INVENTORY_COPY;
test('copied inventory HIF rental counterexamples',
  {skip:copiedInventory ? false : 'Set HIF_REGRESSION_INVENTORY_COPY to a private copy of the reference inventory.'}, async t => {
  const appDir=fileURLToPath(new URL('..',import.meta.url));
  const store=createLiveCatalog({appDir,cacheDir:path.dirname(copiedInventory),loadBase:()=>loadCatalog()});
  const live=store.current.catalog; store.close();
  const { inventory }=await loadInventory(copiedInventory,live);
  const cases=[
    ['Sena','i_card-jsna-3-000','sense','strength',12154],
    ['China','i_card-kcna-3-019','anomaly','fullPower',12144],
    ['Misuzu','i_card-hmsz-3-000','anomaly','preservation',12262]
  ];
  for (const [name,idolGameId,plan,trainingType,points] of cases) await t.test(name+' same-priority complete rental regression',t=>{
    const settings={...options,supportPeakScenario:false,producerLevel:72,goal:'evaluation',idolGameId,plan,trainingType,
      ...(name==='Misuzu'?{targetAttribute:'vocal',secondaryAttribute:'dance',classAttribute:'visual',deckTemplate:'3-3',activityFocus:'supply_gift'}:{})};
    const start=performance.now(), out=recommend({inventory,catalog:live,options:settings});
    const m=out.scoreSummary.hifModel;
    t.diagnostic(JSON.stringify({name,ms:Math.round(performance.now()-start),owned:out.supports.owned.map(c=>c.gameId),rental:out.supports.rental?.gameId,
      points:m.supportRating.partialEvaluationPoints,sp:m.spProviderCoverage,route:[m.primaryLessonCount,m.lessonPattern]}));
    assert.equal(out.supports.owned.length,5); assert.equal(m.spProviderCoverage.covered,m.spProviderCoverage.required);
    assert.ok(m.supportRating.partialEvaluationPoints>=points);
    const pinnedId=name==='Misuzu'?'s_card-3-0057':'s_card-3-0069';
    const pinned=recommend({inventory,catalog:live,options:{...settings,rentalGameId:pinnedId}});
    assert.equal(pinned.supports.rental.gameId,pinnedId);
    assert.ok(m.supportRating.partialEvaluationPoints>=pinned.scoreSummary.hifModel.supportRating.partialEvaluationPoints);
  });
  await t.test('peak motivation retains a funded deck for the pinned rental',t=>{
    const settings={...options,plan:'logic',trainingType:'motivation',idolGameId:'i_card-kcna-3-000',
      goal:'evaluation',producerLevel:72,supportPeakScenario:true,hifConsultPlan:'drinks',
      hifScenarioItemPath:'yellow_robot_flower',rentalGameId:'s_card-3-0069'};
    const start=performance.now(), out=recommend({inventory,catalog:live,options:settings}), m=out.scoreSummary.hifModel;
    t.diagnostic(JSON.stringify({ms:Math.round(performance.now()-start),points:m.supportRating.partialEvaluationPoints,
      owned:out.supports.owned.map(c=>c.gameId),rental:out.supports.rental.gameId,lesson:[m.primaryLessonCount,m.lessonPattern]}));
    assert.equal(out.supports.rental.gameId,settings.rentalGameId);
    assert.ok(m.supportRating.partialEvaluationPoints>=13921);
  });
});
