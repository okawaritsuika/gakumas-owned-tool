import test from 'node:test';
import assert from 'node:assert/strict';
import {computeHifBonuses} from '../lib/hif-bonuses.mjs';
const effect=(type,value)=>({produceEffectType:'ProduceEffectType_'+type,effectValueMin:value,effectValueMax:value});
const master={baseCaps:{selection:{value:3000},final:{value:3000}},panels:[
  {id:'vocal',level:1,splitType:'ProduceSplitType_Unknown',effects:[effect('VocalAddition',20),effect('VocalGrowthRateAddition',20)]},
  {id:'vocal',level:2,splitType:'ProduceSplitType_Unknown',effects:[effect('VocalAddition',40),effect('VocalGrowthRateAddition',40)]},
  {id:'cap',level:6,splitType:'ProduceSplitType_Final',effects:[effect('ParameterLimitUp',200)]},
]};
const raw=rows=>({capturedAt:'2026-11-03T12:00:00Z',growthPanelCapture:{status:'complete',expectedCount:rows.length,exportedCount:rows.length},userProduceGrowthPanelList:rows});
test('HIF uses exact enabled current level and keeps selection/final caps distinct',()=>{
  const actual=computeHifBonuses(raw([{produceGrowthPanelId:'vocal',level:2,enable:true},{produceGrowthPanelId:'cap',level:6,enable:true}]),master);
  assert.equal(actual.status,'current_account');
  assert.equal(actual.common.initialStats.vo,40);assert.equal(actual.common.growthRatePermil.vo,40);
  assert.deepEqual(actual.selection.statCaps,{vo:3000,da:3000,vi:3000});
  assert.deepEqual(actual.final.statCaps,{vo:3200,da:3200,vi:3200});
});
test('disabled and genuinely empty panels do not become maxed bonuses',()=>{
  const disabled=computeHifBonuses(raw([{produceGrowthPanelId:'cap',level:6,enable:false}]),master);
  assert.equal(disabled.status,'current_account');assert.equal(disabled.final.statCaps.vo,3000);
  assert.equal(computeHifBonuses(raw([]),master).common.growthRatePermil.vo,0);
});
test('unread panels, unknown levels and duplicate IDs cannot claim verified HIF bonuses',()=>{
  assert.equal(computeHifBonuses({},master).status,'unknown');
  assert.equal(computeHifBonuses(raw([{produceGrowthPanelId:'cap',level:999,enable:true}]),master).status,'partial');
  const row={produceGrowthPanelId:'vocal',level:2,enable:true};assert.equal(computeHifBonuses(raw([row,row]),master).status,'partial');
});
