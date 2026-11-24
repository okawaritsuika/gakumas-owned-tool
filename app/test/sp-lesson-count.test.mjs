import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../lib/catalog.mjs';
import { recommend } from '../lib/recommend.mjs';
import { buildHifRoute } from '../lib/hif-model.mjs';

const catalog = loadCatalog();
const owned = catalog.supportCards.find(card => card.gameId === 's_card-2-0001');
const rental = catalog.supportCards.find(card => card.plan === 'free' && card !== owned);
const testCatalog = { ...catalog, supportCards: [owned, rental] };
const inventory = { supportCards: [{ gameId: owned.gameId, level: 5, uncap: 0 }] };

function estimate(difficulty, spLessons) {
  const options = { scenario: 'hajime', difficulty, targetAttribute: 'vocal',
    supportLevelMode: 'current', rentalGameId: rental.gameId };
  if (spLessons !== undefined) options.expectedCounts = { sp_lesson_end: spLessons };
  const result = recommend({catalog: testCatalog, inventory, options});
  return [result.scoreSummary.expectedCounts.sp_lesson_end, result.supports.owned[0].statContribution.vocal];
}

// Weekly vocal rewards for the selected route, with no starting challenge item.
// Each pair is [ordinary PERFECT, SP PERFECT]. Single entries are fixed weeks.
const vocalLessons = {
  legend:[[80,110],[114,150],[184,230],[290,340],[474,540]],
  pro:[[0],[60,90],[90],[110,170],[120,200],[150,220],[145]],
};
for (const [difficulty, lessons] of Object.entries(vocalLessons)) {
  for (const count of [0, undefined, 1]) {
    test(`${difficulty} vocal SP bonus with ${count ?? 'unspecified'} SP lessons`, () => {
      const expectedCount = count ?? lessons.filter(row=>row.length===2).length;
      let remaining=expectedCount;
      const growth=lessons.reduce((sum,[normal,sp])=>{
        if (sp!==undefined && remaining>0) {
          remaining--;
          return sum+Math.floor(sp*23/1000);
        }
        return sum+Math.floor(normal*23/1000);
      },0);
      assert.deepEqual(estimate(difficulty, count), [expectedCount, growth+7*expectedCount]);
    });
  }
}

for (const count of [0, 1]) {
  test(`HIF respects the same ${count}-SP total across axes, stages, and scheduled triggers`, () => {
    const route = buildHifRoute(catalog, 'vocal', {primaryLessonCount: 2, expectedCounts: {sp_lesson_end: count}});
    assert.equal(Object.values(route.perAxis).reduce((n, row) => n + row.sp_lesson_end, 0), count);
    assert.equal(Object.values(route.stages).reduce((n, stage) => n + stage.counts.sp_lesson_end, 0), count);
    assert.equal(route.selections.filter(row => row.main && row.isSpLesson !== false).length, count);
  });
}

for(const [difficulty,max] of [['pro',4],['legend',5]]) {
  test(`${difficulty} schedules the declared axis and rejects more SP results than possible`,()=>{
    const run=options=>recommend({catalog:testCatalog,inventory,options:{scenario:'hajime',difficulty,targetAttribute:'vocal',
      supportLevelMode:'current',rentalGameId:rental.gameId,...options}});
    assert.throws(()=>run({expectedCounts:{sp_lesson_end:max+1}}),RangeError);
    const result=run({expectedCounts:{sp_lesson_end:2},perAxisCounts:{visual:{sp_lesson_end:2},vocal:{sp_lesson_end:0}}});
    const sp=result.scoreSummary.nonHifModel.selections.filter(row=>row.activity==='sp_lesson');
    assert.deepEqual(sp.map(row=>row.axis),['visual','visual']);
  });
}
