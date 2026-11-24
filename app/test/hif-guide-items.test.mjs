import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {loadCatalog} from '../lib/catalog.mjs';
import {buildHifGuideItems} from '../lib/hif-guide-items.mjs';
import {buildHifRoute} from '../lib/hif-model.mjs';

const catalog = loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog/',import.meta.url))});
function describe(id, plan, options={}) {
  const route = buildHifRoute(catalog,'dance',options);
  const result = {scoreSummary:{scenario:'hif',plan,hifModel:{...route,
    supportActionPlan:{peakScenario:{scenarioItem:{id}}},
    fixedDeckPolicyComparison:{policiesCompared:322}}}};
  return buildHifGuideItems({result,catalog,options});
}

test('all supported HIF stages resolve to matching local game art for each plan',()=>{
  const forms=Object.values(catalog.produceResources.hif.scenarioItemPaths.forms);
  for(const form of forms)for(const gameId of Object.values(form.nativeByPlan)){
    const art=catalog.hifItemVisuals.byGameId[gameId];
    assert.equal(art?.nameJa,form.nameJa,gameId);
    assert.ok(existsSync(new URL('../web'+art.imageUrl,import.meta.url)),art.imageUrl);
  }
});

test('the chosen route returns one replacement form at each selection exam with native image layers',()=>{
  const guide = describe('yellow_robot_wing','anomaly',{producerLevel:54});
  const suffixes = ['','_00-04-2-003_03-03-1-001','_00-04-2-003_03-03-1-001_00-04-4-004'];
  const ids = suffixes.map(suffix=>'customize_pitem-03-04-3-003'+suffix);
  assert.equal(guide.nameKo,'노란 파우치 → 로봇 → 날개 로봇');
  assert.deepEqual(guide.stages.map(row=>row.gameId),ids);
  assert.deepEqual(guide.stages.map(row=>row.replacesGameId),[null,...ids.slice(0,2)]);
  assert.deepEqual(guide.stages.map(row=>row.imageIds),[
    ['03-1-001','04-3-003'],['03-1-001','04-2-003','04-3-003'],['03-1-001','04-2-003','04-3-003','04-4-004'],
  ].map(layers=>layers.map(layer=>'img_general_cstm-pitem_'+layer)));
  assert.deepEqual(guide.stages.map(row=>row.imageId),['04-3-003','04-2-003','04-4-004'].map(layer=>'img_general_cstm-pitem_'+layer));
  assert.deepEqual(guide.stages.map(row=>row.useLimit),[2,2,1]);
  assert.deepEqual(guide.stages.map(row=>row.week),[7,13,20]);
  assert.deepEqual(guide.stages.map(row=>row.effects.map(effect=>effect.selectionMode)),[['random'],['random','random'],['random',undefined]]);
  assert.equal(guide.stages[2].effects[0].maxQuantity,1);
  assert.deepEqual(guide.stages[2].effects[0].drinkIds,['pdrink_00-3-001']);
  assert.equal(guide.stages[2].effects[1].rarityGuaranteed,false);
  assert.equal(guide.stages[2].examStart.textKo,'모든 스킬 카드의 파라미터 상승 수치 +12');
  assert.equal(guide.stages[2].plannedActivationWeeks.length,1);
  assert.ok(!JSON.stringify(guide).includes('322'));
});

test('flower, wing and counseling branches expose distinct trigger and reward behavior',()=>{
  const flower = describe('yellow_robot_flower','sense',{producerLevel:61});
  assert.deepEqual(flower.stages[2].effects.map(effect=>effect.selectionMode),['random','select']);
  assert.equal(flower.stages[2].examStart.textKo,'집중 +3 · 호조 3턴');
  const meditation = describe('yellow_moja_medal','sense',{producerLevel:55});
  assert.equal(meditation.stages[2].trigger,'consult');
  assert.equal(meditation.stages[2].effects[0].maxQuantity,2);
  assert.equal(meditation.stages[2].effects.find(effect=>effect.action==='shop_discount').percent,50);
  assert.equal(meditation.stages[2].effects.find(effect=>effect.action==='shop_discount').category,'remove');
  assert.equal(describe('red_moja_wing','logic').stages[2].examStart.textKo,'호인상 +6 · 의욕 +6 · 고정 원기 +6');
  assert.equal(describe('yellow_robot_wing','anomaly').stages[2].effects[0].maxQuantity,null);
  assert.equal(describe('none','sense'),null);
  assert.equal(describe('yellow_robot_wing','anomaly',{eventModeId:'event'}),null);
});
