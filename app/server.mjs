import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { loadCatalog } from './lib/catalog.mjs';
import { createLiveCatalog } from './lib/live-catalog.mjs';
import { createLiveArtworkCache } from './lib/live-artwork.mjs';
import { loadInventory, importSnapshot } from './lib/inventory.mjs';
import { buildWeekChoiceAdvice } from './lib/week-choice-advice.mjs';
import { buildExamStatTargets } from './lib/exam-stat-targets.mjs';
import { buildExamScoreTargets } from './lib/exam-score-targets.mjs';
import { describeStoredCustomizations, storedCustomizationLabel } from './lib/customization-readiness.mjs';
import { buildInventoryMemoryScores } from './lib/inventory-memory-scores.mjs';
import { buildEventUnlockOverrides } from './lib/event-context.mjs';
import { createCollectorMode } from './lib/collector-mode.mjs';
import { buildPostProduceMemoryChoice, buildPostMemoryChoiceOptions } from './lib/post-produce-memory-choice.mjs';
import { buildIdolOperatingGuidance } from './lib/idol-operating-guidance.mjs';
import { buildIdolGoalRanks } from './lib/idol-goal-ranks.mjs';
import { buildSkillAdvice, buildSkillAdviceOptions } from './lib/skill-advice.mjs';
import { createRecommendationCache } from './lib/recommendation-cache.mjs';
import { buildScenarioStartItemPlan } from './lib/scenario-start-items.mjs';
import { scenarioRewardCalendar } from './lib/scenario-reward-items.mjs';
import { startItemObservationWeeks } from './lib/non-hif-support.mjs';
import { niaPresetScope } from './lib/excel-support-counts.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
function defaultCatalog() {
  const localData = path.join(appDir, 'data/catalog');
  return loadCatalog({
    ...(process.env.GAKUMAS_CATALOG_DIR ? { dataDir: process.env.GAKUMAS_CATALOG_DIR } : existsSync(localData) ? { dataDir: localData } : {}),
    translationDir: path.join(appDir, 'data/translations'),
  });
}
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 32 * 1024 * 1024) throw Object.assign(new Error('파일 크기가 너무 큽니다.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON 파일 내용을 읽을 수 없습니다.'), { status: 400 }); }
}

function inventoryVersionOf(inventory, catalogVersion) {
  const content = { catalogVersion, producerLevel: inventory.producerLevel, supportCards: inventory.supportCards,
    idolCards: inventory.idolCards, memories: inventory.memories, characters: inventory.characters,
    hifBonuses: inventory.hifBonuses, skillCardSwitchSettings: inventory.skillCardSwitchSettings,
    complete: inventory.complete, collectionStatus: inventory.collectionStatus };
  return createHash('sha256').update(JSON.stringify(content, (key, value) =>
    ['capturedAt', 'readAt'].includes(key) ? undefined : value)).digest('hex');
}

function holdingsVersionOf({ inventory, raw }) {
  if (!raw) return null;
  const groups = ['supportCards', 'idolCards', 'memories', 'characters'].map(key =>
    [...inventory[key]].sort((a, b) => String(a.id).localeCompare(String(b.id))).map(row => row.raw ?? row));
  const panels = (Array.isArray(raw.userProduceGrowthPanelList) ? [...raw.userProduceGrowthPanelList] : []).sort((a, b) =>
    String(a.produceGrowthPanelId).localeCompare(String(b.produceGrowthPanelId)));
  return createHash('sha256').update(JSON.stringify([groups, inventory.producerLevel, inventory.skillCardSwitchSettings,
    inventory.collectionStatus, panels, raw.growthPanelCapture?.status], (key, value) =>
    ['capturedAt', 'readAt'].includes(key) ? undefined : value)).digest('hex');
}

function inventoryCustomizationLabels(skill, catalog) {
  return describeStoredCustomizations(skill, catalog).flatMap((custom, index) => {
    const description = storedCustomizationLabel(custom, skill.customizes[index].nameJa);
    return description ? [description + (custom.customizeCount !== null ? ' (' + custom.customizeCount + '회)' : '')] : [];
  });
}

export function createAppServer({ snapshotPath = path.join(appDir, 'data/inventory.json'), catalog: fixedCatalog,
  catalogStore = fixedCatalog ? null : createLiveCatalog({ appDir, loadBase: defaultCatalog, cacheDir: path.join(path.dirname(snapshotPath), 'live-catalog') }),
  webDir = path.join(appDir, 'web'), recommendationReviewRequired = false } = {}) {
  const collectorMode = createCollectorMode({ snapshotPath, installationPath:path.join(appDir,'data/installation.json') });
  const artwork = createLiveArtworkCache({ cacheDir: path.join(path.dirname(snapshotPath), 'live-artwork'), webDir });
  const fixed = { catalog: fixedCatalog, version: 'bundled' };
  let active, views;
  const playbookContexts = new Map(), maxPlaybookContexts = 16;
  const pendingRecommendations = new Map();
  let calculationQueue = Promise.resolve();
  let activeWorker = null, closing = false;
  const computeRecommendation = workerData => new Promise((resolve, reject) => {
    const interrupted = () => new Error('추천 계산이 중단됐습니다. 다시 확인해 주세요.');
    if (closing) { reject(interrupted()); return; }
    const worker = new Worker(new URL('./lib/recommendation-worker.mjs', import.meta.url), { workerData, execArgv: [] });
    activeWorker = worker;
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', () => {
      if (activeWorker === worker) activeWorker = null;
      reject(interrupted());
    });
  });
  const registerRecommendation = ({ result, stages, checkedAt, scenario }, reused, state) => {
    const recommendationContextId = randomUUID();
    const book = { ...result.accountPlaybook, recommendationContextId };
    playbookContexts.set(recommendationContextId, { book, result, candidate: { ...result, stages }, resourceLedger: result.resourceLedger,
      inventoryVersion: result.inventoryVersion, context: { source: 'recommend', capturedAt: result.inventoryCapturedAt,
        idolGameId: result.selectedIdol?.gameId ?? null, scenario,
        eventModeId: result.eventContext.modeId } });
    while (playbookContexts.size > maxPlaybookContexts) playbookContexts.delete(playbookContexts.keys().next().value);
    return { ...result, accountPlaybook: book, holdingsVersion: holdingsVersionOf(state), recommendationCache: { reused, checkedAt } };
  };
  const nextExamIndex = week => week <= 7 ? 0 : week <= 13 ? 1 : week <= 20 ? 2 : week <= 27 ? 3 : 4;
  const catalogViews = edition => {
    if (active === edition) return views;
    const { catalog } = edition;
    const publicCatalog = {
    catalogVersion: edition.version,
    supportCards: (catalog.supportCards ?? []).map(card => {
      const advice = catalog.supportAdvice?.cards?.find(row => row.gameId === card.gameId);
      return advice ? { ...card, advice } : card;
    }), idolCards: catalog.idolCards ?? [],
    skillCards: catalog.skillCards ?? [], memoryAbilities: catalog.memoryAbilities ?? [],
    freshness: catalog.dataFreshness ?? {}, supportAdvice: catalog.supportAdvice ?? { cards: [] },
    guideSupportProfiles: catalog.guideSupportProfiles ?? { profiles: [], sources: [] },
    eventModes: catalog.eventModes ?? { modes: [], sources: [] },
    hifScenarioItemPaths: Object.entries(catalog.produceResources?.hif?.scenarioItemPaths?.paths ?? {}).map(([id,path])=>({ id, nameKo:path.nameKo })),
    scenarioRewardWeeks:Object.fromEntries(['hajime','nia'].flatMap(scenario=>['pro','master'].map(difficulty=>
      [scenario+'-'+difficulty,scenarioRewardCalendar(catalog,scenario,difficulty)]))),
    excelSupportPresets: (catalog.excelPresets ?? []).filter(preset => preset.name.startsWith('NIA')).map(preset => ({ name: preset.name,...niaPresetScope(preset.name) })),
    drinkVisuals: catalog.drinkVisuals ?? { drinks: [], sources: [] },
    scenarios: catalog.scenarios ?? [{ id: 'hajime', label: '初' }, { id: 'nia', label: 'NIA' }, { id: 'hif', label: 'HIF' }],
    };
    active = edition;
    playbookContexts.clear();
    views = { publicCatalog, recommendationCache: createRecommendationCache({ appDir, snapshotPath, catalog }) };
    return views;
  };
  const server = http.createServer(async (request, response) => {
    const json = (code, body) => {
      response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    try {
      const port = server.address()?.port;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (!allowedHosts.has(request.headers.host)) return json(403, { error: '이 도구는 현재 컴퓨터에서만 사용할 수 있습니다.' });
      if (request.headers.origin && ![...allowedHosts].some(host => request.headers.origin === `http://${host}`)) {
        return json(403, { error: '다른 웹사이트에서 요청할 수 없습니다.' });
      }
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      await collectorMode.ready;
      const edition = catalogStore?.current ?? fixed;
      const { catalog, version: catalogVersion } = edition;
      const { publicCatalog, recommendationCache } = catalogViews(edition);
      if (request.method === 'GET' && url.pathname === '/api/health') return json(200, { ok: true, appId: 'gakumas-owned-tool', catalogVersion, catalogSync: catalogStore?.syncStatus });
      if (request.method === 'GET' && url.pathname.startsWith('/assets/live/')) {
        const img = await artwork.get(url.pathname, catalog);
        if (!img) return json(404, { error: '공개 그림을 아직 확인할 수 없습니다.' });
        response.writeHead(200, { 'Content-Type': img.contentType, 'X-Content-Type-Options': 'nosniff',
          'Cache-Control': img.provisional ? 'private, max-age=300' : 'private, max-age=86400' });
        return response.end(img.bytes);
      }
      if (request.method === 'GET' && url.pathname === '/api/collector-mode') return json(200, await collectorMode.status());
      if (request.method === 'POST' && url.pathname === '/api/collector-mode') {
        const input = await readJsonBody(request);
        return json(200, await collectorMode.setMode(input.mode));
      }
      if (request.method === 'POST' && url.pathname === '/api/shutdown') {
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
          return json(400, { error: '보유노트 종료 파일로 요청해 주세요.' });
        }
        const input = await readJsonBody(request);
        if (input?.appId !== 'gakumas-owned-tool') return json(400, { error: '종료할 보유노트를 확인하지 못했습니다.' });
        await collectorMode.setMode('normal');
        response.once('finish', () => { server.close(); server.closeAllConnections(); });
        return json(200, { ok: true, message: '보유노트를 종료했습니다.' });
      }
      if (request.method === 'GET' && url.pathname === '/api/catalog') return json(200, publicCatalog);
      if (request.method === 'GET' && url.pathname === '/api/scenario-start-items') {
        const scenario = url.searchParams.get('scenario'), difficulty = url.searchParams.get('difficulty');
        const selectedIdol = catalog.idolCards.find(card => card.gameId === url.searchParams.get('idolId'));
        if (!selectedIdol || selectedIdol.excludedScenarios?.includes(scenario)
          || !(scenario === 'hajime' && ['master','legend'].includes(difficulty) || scenario === 'nia' && difficulty === 'master')) {
          return json(400, {error:'해당 P아이돌과 난이도에서 시작 아이템 선택을 확인할 수 없습니다.'});
        }
        return json(200, {...buildScenarioStartItemPlan({ catalog, selectedIdol, options:{scenario,difficulty} }),
          observationWeeks:startItemObservationWeeks(catalog,scenario,difficulty)});
      }
      if (request.method === 'GET' && url.pathname === '/api/skill-advice/options') return json(200, buildSkillAdviceOptions({ catalog }));
      if (request.method === 'GET' && url.pathname === '/api/idol-goal-ranks') {
        const { inventory } = await loadInventory(snapshotPath, catalog);
        const applied = url.searchParams.get('appliedCustomizations');
        let appliedCustomizations;
        if (applied !== null) {
          try { appliedCustomizations = JSON.parse(applied); }
          catch { return json(400, {error:'의상별 개조 입력 형식을 확인해 주세요.'}); }
        }
        const input = url.searchParams.get('plv');
        if (input !== null && (!/^\d+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) < 1)) {
          return json(400, {error:'PLv는 1 이상의 정수로 입력해 주세요.'});
        }
        return json(200, buildIdolGoalRanks({ catalog, inventory, scope: url.searchParams.get('scope') ?? 'hif',
          appliedCustomizations, plv:input === null ? inventory.producerLevel : Number(input), eventModeId:url.searchParams.get('eventModeId') ?? '' }));
      }
      if (request.method === 'GET' && url.pathname === '/api/inventory-memory-scores') {
        const options = Object.fromEntries(['scenario','difficulty','plan','trainingType','eventModeId','idolGameId',
          'targetAttribute','secondaryAttribute','activityFocus'].map(key => [key, url.searchParams.get(key) || undefined]));
        const { scenario, difficulty, plan, targetAttribute, secondaryAttribute, activityFocus } = options;
        const validDifficulty = { hajime:['regular','pro','master','legend'], nia:['pro','master'], hif:[] };
        const axes = ['vocal','dance','visual'];
        const plv = url.searchParams.get('plv');
        if (!Object.hasOwn(validDifficulty, scenario) || difficulty && !validDifficulty[scenario].includes(difficulty) ||
            plan && !['sense','logic','anomaly'].includes(plan) ||
            [targetAttribute, secondaryAttribute].some(axis => axis && !axes.includes(axis)) ||
            activityFocus && !['auto','balanced','consult','outing','supply_gift'].includes(activityFocus) ||
            plv !== null && (!/^\d+$/.test(plv) || !Number.isSafeInteger(Number(plv)) || Number(plv) < 1)) {
          return json(400, {error:'현재 메모리 비교 조건을 확인해 주세요.'});
        }
        options.producerLevel = plv === null ? undefined : Number(plv);
        const { inventory } = await loadInventory(snapshotPath, catalog);
        return json(200, {inventoryVersion:inventoryVersionOf(inventory, catalogVersion),
          scores:buildInventoryMemoryScores({inventory, catalog, options})});
      }
      if (request.method === 'POST' && url.pathname === '/api/skill-advice') {
        const input = await readJsonBody(request);
        return json(200, buildSkillAdvice({ catalog, input }));
      }
      if (request.method === 'POST' && url.pathname === '/api/idol-operating-guidance') {
        const input = await readJsonBody(request), idol = catalog.idolCards.find(row=>row.gameId===input.idolGameId);
        if (!idol || !['hif','hajime','nia'].includes(input.scenario)) return json(400,{error:'운영을 확인할 P아이돌과 시나리오를 선택해 주세요.'});
        if (idol.excludedScenarios?.includes(input.scenario)) return json(400, { error: '선택한 P아이돌은 현재 이 시나리오에 참가할 수 없습니다.' });
        if (input.producerLevel!=null&&(!Number.isInteger(input.producerLevel)||input.producerLevel<1)) return json(400,{error:'검토할 PLv는 1 이상의 정수로 입력해 주세요.'});
        if (input.difficulty!=null&&!['regular','pro','master'].includes(input.difficulty)) return json(400,{error:'난이도를 목록에서 선택해 주세요.'});
        if (input.trainingType!=null&&!({sense:['concentration','goodConditionTurns'],logic:['motivation','goodImpressionTurns'],anomaly:['fullPower','strength','preservation']}[idol.plan]??[]).includes(input.trainingType)) return json(400,{error:'P아이돌의 플랜에 맞는 육성 유형을 선택해 주세요.'});
        const { inventory } = await loadInventory(snapshotPath,catalog), owned = inventory.idolCards.find(row=>row.gameId===idol.gameId);
        const options = {scenario:input.scenario,plan:idol.plan,trainingType:input.trainingType,difficulty:input.difficulty??null,producerLevel:input.producerLevel??inventory.producerLevel,eventModeId:input.scenario==='hif'?input.eventModeId||null:null,idolGameId:idol.gameId};
        options.eventUnlockOverrides=buildEventUnlockOverrides({catalog,options,context:options});
        return json(200,buildIdolOperatingGuidance({result:{selectedIdol:{...idol,ownershipVerified:Boolean(owned),owned},scoreSummary:{scenario:options.scenario,plan:idol.plan,trainingType:options.trainingType}},catalog,inventory,options}));
      }
      if (request.method === 'GET' && url.pathname === '/api/post-produce-memory-options') {
        const { inventory } = await loadInventory(snapshotPath, catalog);
        const choices = buildPostMemoryChoiceOptions({ catalog });
        const nativeAbilities = new Map((catalog.memoryAbilities ?? []).map(row => [row.gameId+':'+row.level, row]));
        const seen = new Set(), ownedCustomRecipes = [];
        for (const memory of inventory.memories) {
          const skill = memory.effects?.carriedSkill;
          if (!skill?.id || !Array.isArray(skill.customizes)) continue;
          const details = describeStoredCustomizations(skill, catalog);
          if (!details.length || details.some(row => row.status !== 'resolved')) continue;
          const key = JSON.stringify([skill.id,skill.upgrade,details.map(row=>[row.id,row.customizeCount]).sort()]);
          if (seen.has(key)) continue;seen.add(key);
          ownedCustomRecipes.push({ key:'recipe-'+ownedCustomRecipes.length, skillId:skill.id, upgradeCount:skill.upgrade,
            label:details.map(row=>row.description+' ('+row.customizeCount+'회)').join(' · '),
            customizes:details.map(row=>({id:row.id,customizeCount:row.customizeCount})),
            source:'observed_owned_recipe_user_must_confirm_same_candidate_customizations' });
        }
        return json(200, { ...choices, abilities: choices.abilities.map(row=>({ ...row,
          branches:nativeAbilities.get(row.id+':'+row.level)?.branches??[], restrictions:nativeAbilities.get(row.id+':'+row.level)?.restrictions??{} })),
          skillCards:publicCatalog.skillCards.map(({gameId,nameKo,nameJa,name,upgradeCount,imageUrl,thumbnailUrl,characterIconUrls,plan})=>({gameId,nameKo,nameJa,name,upgradeCount,imageUrl,thumbnailUrl,characterIconUrls,plan})),
          ownedCustomRecipes, inventoryVersion: inventoryVersionOf(inventory, catalogVersion), candidateCollectionCaptured:false });
      }
      if (request.method === 'POST' && url.pathname === '/api/post-produce-memory-choice') {
        const input = await readJsonBody(request);
        if (!Array.isArray(input.candidates) || input.candidates.length > 12 || input.candidates.some(row=>!row||typeof row!=='object'||Array.isArray(row))) return json(400,{error:'생성된 메모리 후보를 12개 이내로 입력해 주세요.'});
        const target = Object.fromEntries(['scenario','plan','trainingType','producerLevel','idolGameId','eventModeId'].filter(key=>input.target?.[key]!=null).map(key=>[key,input.target[key]]));
        if (!['hif','hajime','nia'].includes(target.scenario)||!['sense','logic','anomaly'].includes(target.plan)) return json(400,{error:'이 메모리를 사용할 시나리오와 플랜을 선택해 주세요.'});
        if (target.producerLevel!=null&&(!Number.isInteger(target.producerLevel)||target.producerLevel<1)) return json(400,{error:'사용할 때의 PLv는 1 이상의 정수로 입력해 주세요.'});
        const targetIdol = target.idolGameId ? catalog.idolCards.find(row=>row.gameId===target.idolGameId) : null;
        if (target.idolGameId && !targetIdol) return json(400,{error:'사용할 P아이돌을 목록에서 선택해 주세요.'});
        if (targetIdol && targetIdol.plan !== target.plan) return json(400,{error:'선택한 P아이돌과 플랜이 다릅니다. P아이돌에 맞는 플랜을 선택해 주세요.'});
        if (targetIdol?.excludedScenarios?.includes(target.scenario)) return json(400, { error: '선택한 P아이돌은 현재 이 시나리오에 참가할 수 없습니다.' });
        const { inventory } = await loadInventory(snapshotPath, catalog);
        const options = { ...target, candidatesCaptured:false, eventUnlockOverrides:buildEventUnlockOverrides({catalog,options:target,context:{scenario:target.scenario,plan:target.plan,trainingType:target.trainingType}}) };
        return json(200,buildPostProduceMemoryChoice({candidates:input.candidates.map(row=>({...row,inputSource:'manual_candidate_input',kindSource:'manual_input'})),target,catalog,inventory,options}));
      }
      if (request.method === 'GET' && url.pathname === '/api/guides') return json(200, {
        events: catalog.scenarioEvents ?? { sources: [], scenarios: [], events: [] },
        decks: catalog.deckGuides ?? { sources: [], guides: [] },
        skillCards: (catalog.skillCards ?? []).map(({ gameId, nameKo, nameJa, upgradeCount, imageUrl, thumbnailUrl, characterIconUrls }) =>
          ({ gameId, nameKo, nameJa, upgradeCount, imageUrl, thumbnailUrl, characterIconUrls })),
      });
      if (request.method === 'GET' && url.pathname === '/api/state') {
        const state = await loadInventory(snapshotPath, catalog);
        catalogStore?.checkMissing(state.inventory);
        const memories = state.inventory.memories.map(memory => ({ ...memory,
          customizationLabels: inventoryCustomizationLabels(memory.effects?.carriedSkill, catalog) }));
        return json(200, { connection: state.connection, inventory: { ...state.inventory, memories }, inventoryVersion: inventoryVersionOf(state.inventory, catalogVersion), holdingsVersion: holdingsVersionOf(state), catalogVersion, catalogSync: catalogStore?.syncStatus,
          scenarios: publicCatalog.scenarios, recommendationReviewRequired, collectorMode: await collectorMode.status() });
      }
      if (request.method === 'POST' && url.pathname === '/api/import') {
        const raw = await readJsonBody(request);
        const inventory = await importSnapshot(snapshotPath, raw, catalog);
        catalogStore?.checkMissing(inventory);
        playbookContexts.clear();
        return json(200, { ok: true, inventory, message: '보유정보를 불러왔습니다.' });
      }
      if (request.method === 'POST' && url.pathname === '/api/week-choices') {
        const input = await readJsonBody(request);
        if (!Number.isInteger(input.week) || input.week < 1 || input.week > 29) return json(400, { error: '현재 주차를 1~29 사이로 지정해 주세요.' });
        const liveState = input.liveState ?? {};
        if (typeof liveState !== 'object' || Array.isArray(liveState)) return json(400, { error: '현재 체력·P포인트는 항목별 숫자로 입력해 주세요.' });
        const validNumber = value => value == null || typeof value === 'number' && Number.isFinite(value) && value >= 0;
        if (['stamina', 'maxStamina', 'currentMaxStamina', 'pp'].some(key => !validNumber(liveState[key]))) return json(400, { error: '현재 체력·최대 체력·P포인트는 0 이상의 숫자 또는 미확인 값이어야 합니다.' });
        if (liveState.stats != null && (typeof liveState.stats !== 'object' || Array.isArray(liveState.stats) || ['vocal', 'dance', 'visual'].some(axis => !validNumber(liveState.stats[axis])))) {
          return json(400, { error: '현재 보컬·댄스·비주얼은 0 이상의 숫자 또는 미확인 값이어야 합니다.' });
        }
        if (typeof input.recommendationContextId !== 'string' || !input.recommendationContextId) return json(409,
          { error: '먼저 공략과 보유 카드로 편성을 추천해 주세요.', code: 'recommend_first', reason: 'recommendation_context_required' });
        const cached = playbookContexts.get(input.recommendationContextId);
        if (!cached) return json(409, { error: '이 편성의 날짜별 비교가 만료됐습니다. 편성을 다시 비교해 주세요.',
          code: 'recommend_first', reason: 'recommendation_context_expired' });
        const currentState = await loadInventory(snapshotPath, catalog);
        if (cached.inventoryVersion !== inventoryVersionOf(currentState.inventory, catalogVersion)) {
          playbookContexts.delete(input.recommendationContextId);
          return json(409, { error: '보유 목록이 바뀌었습니다. 편성을 다시 비교해 주세요.', code: 'recommend_first', reason: 'inventory_changed' });
        }
        const { book, result, candidate, resourceLedger, context } = cached;
        const statTargets = buildExamStatTargets({ candidate, result, catalog, currentStats: liveState.stats, examIndex: nextExamIndex(input.week) });
        const weekAdvice = buildWeekChoiceAdvice({ book, result, candidate, resourceLedger, catalog, week: input.week,
          liveState: { ...liveState, currentMaxStamina: liveState.maxStamina ?? liveState.currentMaxStamina }, statTargets });
        const scoreTargets = buildExamScoreTargets({ result, candidate, catalog, examIndex: nextExamIndex(input.week),
          options: { scenario: result.scoreSummary?.scenario, eventModeId: context.eventModeId } });
        return json(200, { weekAdvice, statTargets, scoreTargets, context, recommendationContextId: input.recommendationContextId });
      }
      if (request.method === 'POST' && url.pathname === '/api/personalized') {
        return json(410, { code: 'removed_by_user_choice', error: '요청에 따라 전투 시뮬레이션을 제외했습니다. 공략과 스탯 계획을 바탕으로 편성을 추천합니다.' });
      }
      if (request.method === 'POST' && url.pathname === '/api/recommend') {
        if (recommendationReviewRequired) return json(409, { error: '成長率・能力値上限・メモリー計算を検証中です。 현재 성장률·능력치 상한·메모리 계산을 검증하고 있습니다.' });
        const { refreshRecommendation, ...input } = await readJsonBody(request);
        if(input.supportLevelMode!=null&&!['current','uncapMax'].includes(input.supportLevelMode))
          return json(400,{error:'보유 서포트의 계산 레벨을 현재 레벨 또는 현재 돌파 상한으로 지정해 주세요.'});
        if(input.hifConsultPlan!=null&&!['auto','none','drinks','skills','ssr','upgrade','remove','customize'].includes(input.hifConsultPlan))
          return json(400,{error:'HIF P포인트 사용처를 목록에서 선택해 주세요.'});
        if(input.hifScenarioItemPath!=null&&!['auto','none'].includes(input.hifScenarioItemPath)
          &&!Object.hasOwn(catalog.produceResources?.hif?.scenarioItemPaths?.paths??{},input.hifScenarioItemPath))
          return json(400,{error:'HIF 시나리오 아이템 경로를 목록에서 선택해 주세요.'});
        if (input.memorySelectionMode != null && !['guide','stats','opening'].includes(input.memorySelectionMode)) {
          return json(400, { error: '반입 메모리 비교 방식을 확인해 주세요.' });
        }
        if (input.supportActionMode != null && !['route', 'declared'].includes(input.supportActionMode)) {
          return json(400, { error: '서포트 행동 횟수는 경로 기회 반영 또는 직접 입력만으로 지정해 주세요.' });
        }
        if (input.sourceSupportMode != null && !['auto', 'guide', 'unrestricted'].includes(input.sourceSupportMode)) {
          return json(400, { error: '서포트 비교 방식은 공략 기준 또는 전체 보유 카드 비교로 지정해 주세요.' });
        }
        if (input.activityFocus != null && !['auto', 'consult', 'outing', 'supply_gift', 'balanced'].includes(input.activityFocus)) {
          return json(400, { error: '활동 비교 방식은 자동·상담·외출·차입·균형 중에서 지정해 주세요.' });
        }
        const state = await loadInventory(snapshotPath, catalog);
        const inventoryVersion = inventoryVersionOf(state.inventory, catalogVersion);
        const cacheKey = await recommendationCache.key(input, inventoryVersion, state.inventory.warnings);
        if (refreshRecommendation !== true) {
          const saved = await recommendationCache.read(cacheKey);
          if (saved) return json(200, registerRecommendation(saved, true, state));
        }
        let calculation = pendingRecommendations.get(cacheKey);
        if (!calculation) {
          calculation = calculationQueue.then(async () => {
            const entry = await computeRecommendation({ input, inventory: state.inventory, catalog, inventoryVersion });
            if (!entry.failure) await recommendationCache.save(cacheKey, entry);
            return entry;
          });
          calculationQueue = calculation.catch(() => {});
          if (cacheKey) pendingRecommendations.set(cacheKey, calculation);
        }
        let entry;
        try { entry = await calculation; }
        finally { if (pendingRecommendations.get(cacheKey) === calculation) pendingRecommendations.delete(cacheKey); }
        if (entry.failure) return json(400, entry.failure);
        return json(200, registerRecommendation(entry, false, state));
      }
      if (request.method !== 'GET') return json(404, { error: '요청한 기능을 찾을 수 없습니다.' });
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filename = path.resolve(webDir, '.' + relative);
      const remainder = path.relative(webDir, filename);
      if (remainder.startsWith('..') || path.isAbsolute(remainder)) return json(403, { error: '파일을 열 수 없습니다.' });
      if (!contentTypes[path.extname(filename)]) return json(404, { error: '파일을 찾을 수 없습니다.' });
      let content;
      try { content = await fs.readFile(filename); } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'EISDIR') return json(404, { error: '파일을 찾을 수 없습니다.' });
        throw error;
      }
      response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filename)], 'X-Content-Type-Options': 'nosniff' });
      response.end(content);
    } catch (error) {
      json(error.status ?? 400, { error: error.message ?? '요청을 처리하지 못했습니다.' });
    }
  });
  if (catalogStore) server.once('listening', () => { void catalogStore.refresh(); });
  server.once('close', () => {
    closing = true;
    catalogStore?.close();
    activeWorker?.terminate();
    collectorMode.dispose();
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.GAKUMAS_PORT ?? 43127);
  const snapshotPath = process.env.GAKUMAS_SNAPSHOT ?? path.join(appDir, 'data/inventory.json');
  const server = createAppServer({ snapshotPath });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '이미 도구가 실행 중이거나 해당 주소를 사용 중입니다.' : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`학마스 보유 도구: http://127.0.0.1:${port}`));
}
