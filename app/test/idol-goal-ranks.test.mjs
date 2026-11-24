import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildIdolGoalRanks } from '../lib/idol-goal-ranks.mjs';

const catalog = loadCatalog({ dataDir: fileURLToPath(new URL('../data/catalog/', import.meta.url)) });
const ranks = (scope, owned = [], producerLevel) => buildIdolGoalRanks({
  scope, catalog, inventory: { producerLevel, idolCards: owned },
});
const byId = (result, id) => result.rows.find(row => row.id === id);

test('score, ease, scenario and exact P-card remain independent', () => {
  const hif = ranks('hif'), china = byId(hif, 'i_card-kcna-3-019');
  assert.equal(china.score.rank, 'priority');
  assert.equal(china.clear.rank, 'conditional');
  assert.notEqual(byId(hif, 'i_card-kcna-3-014').score.rank, china.score.rank);
  assert.equal(byId(ranks('hajime-master'), china.id).score.rank, 'unknown');
  assert.throws(() => ranks('asari'), /난이도/);
});

test('middle source tiers, low rarities and easy-to-play reviews retain their own scopes', () => {
  const hif = ranks('hif'), legend = ranks('hajime-legend');
  const temari = 'i_card-ttmr-3-011';
  assert.deepEqual([byId(hif, temari).score.sourceTier, byId(legend, temari).score.sourceTier], ['A', 'S']);
  assert.equal(byId(hif, 'i_card-hski-1-000').score.sourceTier, 'F');
  assert.equal(byId(legend, 'i_card-hski-1-000').score.rank, 'unknown');
  assert.equal(byId(hif, 'i_card-kllj-3-018').clear.rank, 'priority');
  assert.equal(byId(hif, 'i_card-kllj-3-022').clear.rank, 'conditional');
  assert.deepEqual(byId(hif, 'i_card-hrnm-3-017').score.sources, ['game8', 'hifTier']);
});

test('ordinary HIF assigns competition ranks to attained final estimates and leaves unverified rows unranked', () => {
  const {rows}=ranks('hif',[],72);
  const comparable=rows.filter(row=>row.recommendation.hif.rankable);
  assert.ok(comparable.length>0 && comparable.length<rows.length);
  for (const [i,row] of rows.entries()) {
    if (i>=comparable.length) {
      assert.equal(row.routeRank,null);
      assert.ok(row.recommendation.missing);
    } else {
      assert.equal(row.routeRank,1+comparable.filter(r=>r.recommendation.value>row.recommendation.value).length);
      assert.ok(row.recommendation.estimated);
    }
  }
  assert.ok(ranks('hajime-legend').rows.every(row=>!Object.hasOwn(row,'routeRank')));
});

test('scenarios, future variants and unknown eligibility follow the current catalog', () => {
  const fixture = { idolCards: [
    { gameId: 'kanae', excludedScenarios: ['hif','nia'], recommendationEligible: false },
    { gameId: 'unpublished', recommendationEligible: false },
    { gameId: 'live-reference', recommendationEligible: false, recommendWhenOwned: true },
    { gameId: 'newly-published', recommendationEligible: true },
  ] };
  const inventory = { idolCards: [{ gameId: 'kanae' }] };
  const build = scope => buildIdolGoalRanks({scope, catalog: fixture, inventory});
  assert.deepEqual(build('hif').rows.map(r => r.id), ['live-reference', 'newly-published']);
  assert.deepEqual(build('hajime-pro').rows.map(r => r.id), ['kanae', 'live-reference', 'newly-published']);
  assert.equal(build('hajime-pro').rows[1].clear.rank, 'unknown');
});

test('unknown or insufficient training is explicit for sourced custom strategies', () => {
  const id = 'i_card-ssmk-3-000';
  const clear = levelLimitRank => byId(ranks('nia-master', [{ gameId:id, levelLimitRank }]), id).clear;
  assert.match(clear(undefined).requirements[0], /미확인/);
  assert.match(clear(6).requirements[0], /미충족/);
  assert.match(clear(7).requirements[0], /개조 선택 필요/);
  assert.equal(clear(6).rank, 'conditional');
});

test('an inferred deck fit requires a verified current skill and a matching route', () => {
  const id = 'i_card-hrnm-3-012';
  assert.equal(byId(ranks('hajime-master', [{ gameId:id }]), id).score.rank, 'unknown');
  const withTraining = [{ gameId:id, levelLimitRank: 3 }];
  const fit = byId(ranks('hajime-master', withTraining), id).score;
  assert.equal(fit.rank, 'fit');
  assert.ok(fit.sources.includes('kit'));
  assert.equal(byId(ranks('hajime-regular', withTraining), id).score.rank, 'unknown');
  const mao = byId(ranks('hif', [], 70), 'i_card-amao-3-000');
  assert.equal(mao.clear.rank, 'case');
  assert.match(mao.clear.requirements[0], /PLv 70.*PLv 75/);
});
