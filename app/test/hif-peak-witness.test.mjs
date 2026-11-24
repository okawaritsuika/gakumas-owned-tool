import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../lib/catalog.mjs';
import {buildIdolRecommendation} from '../lib/pidol-recommendation.mjs';
import {evaluateHifPeakWitness} from '../lib/hif-peak-witness.mjs';

const catalog=loadCatalog({dataDir:fileURLToPath(new URL('../data/catalog/',import.meta.url))});
const cases=[
  ['i_card-kcna-3-019','moveToTop'],
  ['i_card-ttmr-3-007','reservation'],
  ['i_card-shro-3-018','replay'],
];
for (const [id,necessaryEvent] of cases) {
  test(id+' proves the published loop in the actual scored finals',()=>{
    const card=catalog.idolCards.find(r=>r.gameId===id);
    const args={card,catalog,data:catalog.idolEffectData,scope:'hif'};
    const result=buildIdolRecommendation({...args,plv:72,traceHif:true});
    const other=buildIdolRecommendation({...args,plv:90});
    assert.equal(result.value,other.value);
    assert.equal(result.value,result.hif.stages.final.on+result.hif.stages.finalR2.on);
    assert.ok(result.hif.peak.bothRoundsDemonstrated.total<=result.value);
    assert.ok(result.hif.peak.highestMeasured.total>=result.value);
    for (const stage of ['final','finalR2']) {
      const side=result.hif.stages[stage].comparison.withOutfit;
      const witness=evaluateHifPeakWitness({card,stage,side});
      assert.deepEqual(witness,result.hif.peak.witness[stage]);
      assert.deepEqual(witness,other.hif.peak.witness[stage]);
      if (stage==='finalR2' || witness.verified) {
        assert.deepEqual(witness.missing,[]);
        assert.equal(witness.verified,true);
      } else assert.ok(witness.missing.length);
      const erased={...side,trace:side.trace.filter(e=>e.kind!==necessaryEvent)};
      assert.equal(evaluateHifPeakWitness({card,stage,side:erased}).verified,false);
      if (necessaryEvent==='moveToTop') {
        const secondPass=witness.events.at(-1);
        const cutoff=side.trace.findIndex(e=>e.kind==='resolvedCard' && e.turn===secondPass.turn && e.parameter===secondPass.parameter && e.id===secondPass.id);
        const truncated=evaluateHifPeakWitness({card,stage,side:{...side,trace:side.trace.slice(0,cutoff)}});
        assert.ok(truncated.missing.includes('다시 쓴 ②로 회수한 공격에서 추가 득점 반복'));
      }
    }
  });
}
