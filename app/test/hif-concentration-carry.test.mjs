import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { summarizeMemoryEffects } from '../lib/memory-effects.mjs';
import { createHifConcentrationCarry } from '../lib/hif-concentration-carry.mjs';

const catalog = loadCatalog({
  dataDir:fileURLToPath(new URL('../data/catalog', import.meta.url)),
  translationDir:fileURLToPath(new URL('../data/translations', import.meta.url)),
});
const settings = { scenario:'hif', plan:'sense', trainingType:'goodConditionTurns', producerLevel:80 };
const sakura = 'i_card-ssmk-3-010', sky = 'i_card-kcna-3-014';
const create = (gameId, potentialRank = 2, overrides = {}) => createHifConcentrationCarry({
  catalog, selectedIdol:{gameId, owned:{levelLimitRank:3, potentialRank}}, options:{...settings, ...overrides},
});
function memory(name, phase = 1, customizes = [], abilities = []) {
  const card = catalog.skillCards.find(row => row.nameJa === name);
  assert.ok(card, name);
  const raw = { produceCard:{id:card.gameId, upgradeCount:card.upgradeCount, customizes}, produceCardPhaseType:phase, abilities };
  return { id:name + '-' + phase + '-' + customizes.length, raw,
    modelEffects:summarizeMemoryEffects({...raw, raw}, catalog, {...settings, skillCardSwitchSettings:{[card.gameId]:true}}) };
}
const presenceCustom = [{id:'p_card_custom-040-g_effect-cost_parameter_buff_reduce-1',customizeCount:1}];
const moodCustom = [{id:'p_card_custom-040_070-g_effect-parameter_buff_turn_add-1-g_effect-parameter_buff_turn_add-3',customizeCount:2}];
const vocal20 = 'memory_ability-p_memory_skill-common-p_trigger-produce_start-initial-vocal_addition-03-001-001';
const presence = memory('存在感+',1,presenceCustom), declaration = memory('アイドル宣言+',1,[],[{id:vocal20,level:1}]);
const ordinary = [memory('シュプレヒコール+'), memory('スポットライト+',1,moodCustom), memory('話題沸騰+',2)];

test('an early recurring P-item drain and a last-three-turn conversion lead to different fourth slots', () => {
  const consumer = create(sakura), late = create(sky), withPresence = [...ordinary,presence], withDraw = [...ordinary,declaration];
  assert.deepEqual(consumer.evaluate(withDraw), { priority:0,firstSelection:'uncovered',laterExams:'uncovered' });
  assert.deepEqual(consumer.evaluate(withPresence), { priority:2,firstSelection:'memory',laterExams:'memory' });
  const why = consumer.explain(withPresence,[...withPresence,declaration]);
  assert.match(why.reason, /존재감.*개시 합류.*강화 \+1.*호조 비용 1→0/);
  assert.match(why.reason, /아이돌 선언.*즉시 집중 공급이 없/);
  assert.match(why.reason, /집중 3 이상.*2회 간격.*집중 1/);
  assert.match(why.reason, /2만큼 집중.*1회/);
  assert.match(why.reason, /슈프레히콜.*집중 2/);
  assert.ok(why.alternatives[0].reason.includes('아이돌 선언'));
  assert.equal(late.evaluate(withPresence).priority,late.evaluate(withDraw).priority);
  assert.equal(late.evaluate(withDraw).firstSelection, 'last_turns_only');
  const whyLate = late.explain(withDraw,[...withDraw,presence]);
  assert.match(whyLate.reason, /존재감.*호조 비용 1→0.*아이돌 선언/);
  assert.match(whyLate.reason, /마지막 3턴.*30%.*그 전 턴/);
  assert.match(whyLate.reason, /초기 보컬 반입 수치는 선택한 아이돌 선언\+ 사본 \+20, 제외한 존재감\+ 사본 0/);
  const unknown = memory('存在感+',1,presenceCustom,[{id:'unverified',level:1}]);
  assert.match(late.explain(withDraw,[...withDraw,unknown]).reason, /아이돌 선언\+ 사본 \+20, 제외한 존재감\+ 사본 미확인/);
  const missingRaw = {...presence,raw:{...presence.raw,abilities:undefined}};
  assert.match(late.explain(withDraw,[...withDraw,missingRaw]).reason, /제외한 존재감\+ 사본 미확인/);
  assert.match(whyLate.alternatives[0].reason, /고유 아이템 발동 전/);
  assert.equal(create(sky,0).evaluate(withDraw).firstSelection,'uncovered');
  assert.match(create(sky,0).explain(withDraw).reason, /20%/);
});

test('another qualified copy funds the role once, with the phase and exact customization respected', () => {
  const model = create(sakura), alternative = memory('精神統一+');
  assert.equal(model.evaluate([...ordinary,alternative]).priority,model.evaluate([...ordinary,presence,alternative]).priority);
  assert.equal(model.inspectCandidate(alternative).gain,6);
  const mid = memory('存在感+',2,presenceCustom);
  assert.deepEqual(model.evaluate([...ordinary,mid]),{priority:1,firstSelection:'uncovered',laterExams:'memory'});
  assert.match(model.explain([...ordinary,mid]).reason, /중간 이후 합류/);
  assert.equal(model.inspectCandidate(memory('存在感')).goodCost,2);
  assert.equal(model.inspectCandidate(memory('存在感+')).goodCost,1);
  assert.equal(model.inspectCandidate(presence).goodCost,0);
  assert.equal(model.inspectCandidate(memory('存在感+',0,presenceCustom)).verified,false);
  assert.equal(model.inspectCandidate(memory('存在感+',1,[{...presenceCustom[0], customizeCount:12}])).verified,false);
  assert.equal(model.inspectCandidate(memory('アイドル宣言+',1,presenceCustom)).verified,false);
  assert.equal(model.inspectCandidate(memory('話題沸騰+',2)).isSupplier,false);
  assert.equal(model.evaluate([memory('成功への道筋+')]).firstSelection,'uncovered'); // one use for a recurring drain
});

test('native effects distinguish early supply, the training variant and unsupported scenarios', () => {
  const clear = create('i_card-ssmk-3-000');
  assert.equal(clear.evaluate(ordinary).firstSelection,'native_skill');
  const noPotential = createHifConcentrationCarry({catalog, selectedIdol:{gameId:sky,owned:{levelLimitRank:3}},options:settings});
  assert.equal(noPotential.evaluate(ordinary).priority,0);
  assert.match(noPotential.explain(ordinary).reason,/재능개화 단계/);
  const before = create(sakura,0).explain([...ordinary,presence]);
  assert.equal(before.selectedIdol.recurring.threshold,8);
  const lowTraining = createHifConcentrationCarry({catalog,selectedIdol:{gameId:sakura,owned:{levelLimitRank:2,potentialRank:2}},options:settings});
  assert.equal(lowTraining.explain([]).selectedIdol.unique[0].gain,1);
  for (const options of [{scenario:'nia'}, {hifMode:'asari'}, {trainingType:'concentration'}, {memorySelectionMode:'stats'},
    {memorySelectionMode:'opening'}, {desiredSkillIds:['p_card-01-men-2_037']}]) assert.equal(create(sky,2,options).active,false);
});
