import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { scoreIdolEffects } from '../lib/pidol-effect-score.mjs';
import SkillCards from '../lib/vendor/gakumas-data/data/skillCards.js';

const read = file => readFileSync(new URL('../data/catalog/' + file, import.meta.url));
const sources = JSON.parse(read('pidol_unique_effects.json'));
const master = JSON.parse(gunzipSync(read('live-master.json.gz'))).tables;
const stats = JSON.parse(read('p_idol_stats.json')).cards;
const owner = id => master.IdolCard.find(card => card.id === id);

function inputs(card, plus = 1) {
  const stages = stats.find(s => s.id === card.id)?.specialTrainingStages;
  return {
    skills: [card.produceCardId, card.secondProduceCardId].filter(Boolean).map(id => sources.skills[id + ':' + plus]),
    item: sources.items[plus ? card.afterProduceItemId : card.beforeProduceItemId],
    card: { gameId: card.id, specialTrainingRank: plus ? 3 : 0, specialTrainingStages: stages },
    scope: 'hajime-legend',
    plan: { ProducePlanType_Plan1: 'sense', ProducePlanType_Plan2: 'logic', ProducePlanType_Plan3: 'anomaly' }[card.planType],
  };
}

test('current and before-awakening variants of all ordinary outfits can use known effects independent of tiers', () => {
  for (const card of master.IdolCard) {
    for (const plus of [0, 1]) {
      const args = inputs(card, plus);
      const result = scoreIdolEffects(args);
      assert.equal(result.missing, '', card.id);
      assert.ok(Number.isInteger(result.value), card.id);
      assert.ok(result.known.includes(args.skills[0].name));
      assert.equal(scoreIdolEffects({ ...args, scenarioEvidence: { tier: 'SS', rank: 'priority' } }).value, result.value);
    }
  }
});

test('LEGEND calculation gates 標 before the skill and keeps FMW customization out until purchased', () => {
  const mao = inputs(owner('i_card-amao-3-018'));
  const score = scoreIdolEffects(mao);
  assert.equal(score.value, 78);
  assert.match(score.condition, /사용 전 호조 8/);
  const saki = inputs(owner('i_card-hski-3-000'));
  assert.equal(scoreIdolEffects(saki).value, 77);
  const option = sources.customizations['p_card_custom-p_card-01-ido-3_013-1'];
  const purchased = scoreIdolEffects({ ...saki, customizations: [option] });
  assert.equal(purchased.basis, 'scenario');
  assert.equal(purchased.value, 82);
  const extraUse = sources.customizations['p_card_custom-p_card-01-ido-3_013-2'];
  assert.equal(scoreIdolEffects({ ...saki, customizations: [extraUse] }).value, 83);
});

test('named item needs a supplied card; Campus Saki training grants a LEGEND follow-up', () => {
  const args = inputs(owner('i_card-hski-3-008'));
  assert.equal(scoreIdolEffects(args).value, 105);
  const noChange = { ...args, card: { ...args.card, specialTrainingRank: 0 } };
  assert.equal(scoreIdolEffects(noChange).value, 94);
  const item = structuredClone(args.item);
  item.definition.effects[0].conditions[0].right.value = 987654;
  assert.equal(scoreIdolEffects({ ...args, item }).value, 94);
});

test('all observed customizations have an applicable definition on their own + skill', () => {
  for (const option of Object.values(sources.customizations)) {
    const args = inputs(owner(option.ownerId));
    assert.ok(Number.isInteger(scoreIdolEffects({ ...args, customizations: [option] }).value), option.id);
  }
});

test('HIF-final Prima and recovered native mechanics contribute only with their selected definitions', () => {
  for (const [ownerId,skillId] of Object.entries(sources.primaSkills)) {
    const args=inputs(owner(ownerId));
    args.scope='hif';
    args.skills.push(sources.skills[skillId+':0']);
    const result=scoreIdolEffects(args);
    assert.ok(Number.isInteger(result.value),ownerId+': '+result.missing);
  }
  const args=inputs(owner('i_card-hkne-3-000'));
  const actual=scoreIdolEffects(args);
  const before={...args.item,mechanics:null};
  assert.notEqual(actual.value,scoreIdolEffects({...args,item:before}).value);
  assert.match(actual.condition,/전반.*후반/);
});

test('unresolved core holds the score and unknown operations cannot hide behind a false gate', () => {
  const args = inputs(owner('i_card-hski-3-000'));
  for (const item of [{ ...args.item, definition: null },
  { ...args.item, definition: { effects: [{ conditions: [{ type: 'number', value: 0 }], actions: [{ type: 'call', name: 'unmappedEffect' }] }] } }]) {
    const result = scoreIdolEffects({ ...args, item });
    assert.equal(result.value, null);
    assert.equal(result.basis, 'missing');
    assert.ok(result.known.includes(args.skills[0].name));
    assert.ok(result.missing.length > 0);
  }
});

function currentLilja(id) {
  const card=owner(id), args=inputs(card);
  if (card.secondProduceCardId) {
    args.skills[1]=sources.skills[card.secondProduceCardId+':0'];
    args.item=sources.items[card.beforeProduceItemId];
  }
  return {...args,scope:'hif'};
}
const drawPlay=(turn,id)=>['draw','play'].map(kind=>({turn,kind,id}));
const ordinary=(id,publicId,count=1)=>({id,count,definition:SkillCards.getById(publicId)});

test('full power earned by the skill counts at the next start; final-turn reservations never pay',()=>{
  const args=currentLilja('i_card-kllj-3-010'), id=args.skills[0].id;
  assert.equal(scoreIdolEffects(args).value,58);
  for (const [turnCount,expectedScore,expectedGenki] of [[1,0,0],[2,23,8],[3,23,16]]) {
    const result=scoreIdolEffects({...args,referencePath:{turnCount,events:drawPlay(1,id)}}).path;
    assert.equal(result.missing,'');
    assert.equal(result.marginalParameter,expectedScore);
    assert.equal(result.withOutfit.genki,expectedGenki);
  }
});

test('identified draws and plays have separate direct counters; a free replay executes the exact card',()=>{
  const args=currentLilja('i_card-kllj-3-018'), [first,second]=args.skills.map(r=>r.id);
  const cards=[ordinary('distance',678,4),ordinary('finisher',152)];
  const events=[...drawPlay(1,first),...drawPlay(2,second),...drawPlay(2,'distance'),...drawPlay(3,'distance'),
    ...drawPlay(4,'distance')];
  const run=extra=>scoreIdolEffects({...args,referencePath:{turnCount:5,cards,events:[...events,...extra]}});
  const noFinish=run([]), notDrawn=run([{turn:5,kind:'play',id:'finisher'}]), withFinish=run(drawPlay(5,'finisher'));
  assert.equal(noFinish.value,16);
  assert.equal(noFinish.path.marginalParameter,0);
  const trace=noFinish.path.withOutfit.trace;
  assert.deepEqual(trace.filter(x=>x.kind==='trigger' && x.source===445).map(x=>x.turn),[3]);
  assert.deepEqual(trace.filter(x=>x.kind==='replay').map(x=>[x.turn,x.id]),[[4,first]]);
  assert.deepEqual(trace.filter(x=>x.kind==='counter'&&x.source===820).map(x=>x.counter),[1,2,3,4,5]);
  assert.equal(noFinish.path.withOutfit.motivation,19);
  assert.ok(noFinish.path.withOutfit.genki>=7);
  assert.equal(notDrawn.path.withOutfit.trace.at(-1).reason,'손패에 없음');
  assert.equal(notDrawn.path.marginalParameter,0);
  assert.equal(withFinish.value,noFinish.value);
  assert.equal(withFinish.path.withOutfit.genki,0);
  assert.equal(withFinish.path.withOutfit.parameter,260);
  assert.equal(withFinish.path.withoutOutfit.parameter,45);
  assert.equal(withFinish.path.marginalParameter,215);
  const unavailable=scoreIdolEffects({...args,referencePath:{turnCount:1,cards,events:drawPlay(1,'finisher')}}).path;
  assert.equal(unavailable.withOutfit.trace.at(-1).reason,'사용 전 조건 미충족');
});

test('other logic costumes distinguish retained genki, internal conversion, and a used external converter',()=>{
  for (const [id,expected] of [['i_card-hume-3-000',0],['i_card-kcna-3-000',6]]) {
    const args=inputs(owner(id)), events=drawPlay(1,args.skills[0].id);
    const path=scoreIdolEffects({...args,referencePath:{turnCount:1,events}}).path;
    assert.equal(path.missing,'');
    assert.equal(path.marginalParameter,expected);
    assert.ok(path.withOutfit.genki>0);
  }
  const hiro=inputs(owner('i_card-shro-3-000'),0);
  const closing=scoreIdolEffects({...hiro,referencePath:{turnCount:3,events:drawPlay(1,hiro.skills[0].id)}}).path;
  assert.ok(closing.marginalParameter>0);
  assert.deepEqual(closing.withOutfit.trace.filter(x=>x.kind==='trigger').map(x=>x.turn),[2,3]);
});

test('the item and replay keep independent lesson limits, and a replay cannot trigger twice in one turn',()=>{
  const args=currentLilja('i_card-kllj-3-018'), first=args.skills[0].id;
  // Synthetic multiple-line card isolates the per-turn cap independently of
  // draw order. Its card definition is never part of the default score grid.
  const gain={type:'assignment',lhs:'motivation',op:'+=',rhs:{type:'number',value:1}};
  const many={id:'test-multi-gain',definition:{id:9001,type:'mental',conditions:[],cost:[],effects:[],
    actions:[{actions:Array.from({length:12},()=>gain)}]}};
  const events=[...drawPlay(1,first),...drawPlay(2,many.id),...drawPlay(3,many.id),...drawPlay(4,many.id)];
  const path=scoreIdolEffects({...args,referencePath:{turnCount:4,cards:[many],events}}).path;
  assert.equal(path.missing,'');
  const trace=path.withOutfit.trace;
  assert.deepEqual(trace.filter(x=>x.kind==='replay').map(x=>x.turn),[2,3]);
  assert.deepEqual(trace.filter(x=>x.kind==='trigger' && x.source===445).map(x=>x.turn),[2,2]);
  assert.equal(path.marginalParameter,0);
  const unexpected=scoreIdolEffects({...args,referencePath:{turnCount:2,cards:[],events:drawPlay(3,first)}});
  assert.equal(unexpected.path.marginalParameter,null);
  assert.ok(unexpected.path.missing);
  assert.equal(unexpected.value,16);
});

test('a hand-gated replay needs the unused partner and cannot take a second paid action',()=>{
  const args=currentLilja('i_card-hrnm-3-017'), [first,second]=args.skills.map(r=>r.id);
  const result=scoreIdolEffects(args);
  assert.equal(result.value,72);
  const attempt=events=>scoreIdolEffects({...args,referencePath:{turnCount:1,initial:{goodConditionTurns:16,concentration:8},events}}).path;
  const both=[{turn:1,kind:'draw',id:first},{turn:1,kind:'draw',id:second}];
  const order=(a,b)=>[{turn:1,kind:'play',id:a},{turn:1,kind:'play',id:b}];
  const withPartner=attempt([...both,...order(first,second)]).withOutfit.trace;
  assert.equal(withPartner.filter(x=>x.kind==='replay').length,1);
  assert.equal(withPartner.at(-1).reason,'사용권 없음');
  const spent=attempt([...both,...order(second,first)]).withOutfit.trace;
  assert.equal(spent.filter(x=>x.kind==='replay').length,0);
  const absent=attempt(drawPlay(1,first)).withOutfit.trace;
  assert.equal(absent.filter(x=>x.kind==='replay').length,0);
});

test('named growth scores only on a later hit; final replay growth has no subsequent recipient',()=>{
  const args=inputs(owner('i_card-hski-3-018'),0);
  assert.equal(scoreIdolEffects({...args,scope:'hif'}).value,171);
  const once=structuredClone(args.item);
  once.definition.effects[0].limit=1;
  assert.equal(scoreIdolEffects({...args,scope:'hif',item:once}).value,171);
  const noBonus=structuredClone(args.item);
  noBonus.definition.effects[0].actions[0].rhs.value=0;
  assert.ok(scoreIdolEffects({...args,scope:'hif',item:noBonus}).value<171);
});
