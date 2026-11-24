import { IdolConfig, StageConfig, IdolStageConfig, StageEngine, StagePlayer, STRATEGIES, S, resetRand } from './vendor/gakumas-engine/index.js';
import { SkillCards, PItems, Customizations } from './vendor/gakumas-data/index.js';

const axes = ['vocal', 'dance', 'visual'];
let pending = Promise.resolve();
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const unique = values => [...new Set(values)];
const baseLimitations = [
  '입력한 덱과 시험 조건을 자동 운용한 모형 표본입니다. 계정의 실제 시험 기록은 아닙니다.',
  '최고점은 이번 반복에서 관측한 최고점이며, 이론상 최고점이나 최적 운용을 뜻하지 않습니다.',
  '드링크 사용은 포함하지 않습니다. 입력 덱 밖의 카드 획득·강화와 육성 중 선택은 이 시험 안에서 추정하지 않습니다.',
];

function failure(status, reasons, limitations = []) {
  return { status, scope: 'unavailable', reason: reasons[0], reasons, statistics: null,
    representativeTrace: null, bestTrace: null, limitations: unique([...baseLimitations, ...limitations]) };
}
function usesClearRatio(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.type === 'identifier' && value.name === 'clearRatio') return true;
  return Object.values(value).some(part => Array.isArray(part) ? part.some(usesClearRatio) : usesClearRatio(part));
}
function inspectInput({ loadout, stage, runs, seed, threshold }) {
  const errors = [], unsupported = [];
  if (!loadout || !stage) return { errors: ['전체 시험 덱과 시험 조건이 필요합니다.'], unsupported };
  if (loadout.fullDeckConfirmed !== true && loadout.deckAssumptionConfirmed !== true) errors.push('수집한 전체 시험 덱 또는 명시적으로 확인한 가정 덱이 필요합니다.');
  if (!Array.isArray(loadout.params) || loadout.params.length !== 4 || loadout.params.some(value => !numeric(value) || value < 0) || !(loadout.params[3] > 0)) errors.push('Vo·Da·Vi와 최대 체력의 정확한 수치가 필요합니다.');
  if (!Array.isArray(loadout.skillCardIdGroups) || !loadout.skillCardIdGroups.length || loadout.skillCardIdGroups.some(group => !Array.isArray(group)) || !loadout.skillCardIdGroups.flat().some(Boolean)) errors.push('시험에서 사용하는 전체 스킬 카드 목록이 비어 있습니다.');
  if (!Array.isArray(loadout.pItemIds)) errors.push('P아이템 목록이 필요합니다. 없는 경우 빈 목록을 지정하세요.');
  if (loadout.customizationGroups != null && (!Array.isArray(loadout.customizationGroups) || loadout.customizationGroups.some(group => !Array.isArray(group)))) errors.push('커스터마이즈 목록은 스킬 카드 슬롯별 배열이어야 합니다.');
  if (!stage.turnCounts || axes.some(axis => !Number.isInteger(stage.turnCounts[axis]) || stage.turnCounts[axis] < 0) || axes.reduce((sum, axis) => sum + (stage.turnCounts?.[axis] ?? 0), 0) < 1) errors.push('속성별 시험 턴 수가 올바르지 않습니다.');
  const total = axes.reduce((sum, axis) => sum + (stage.turnCounts?.[axis] ?? 0), 0);
  if ((stage.turnCount != null && stage.turnCount !== total) || (stage.totalTurns != null && stage.totalTurns !== total)) errors.push('전체 턴 수와 속성별 턴 수의 합이 다릅니다.');
  if (!stage.firstTurns || axes.some(axis => !numeric(stage.firstTurns[axis]) || stage.firstTurns[axis] < 0 || stage.firstTurns[axis] > 1) || Math.abs(axes.reduce((sum, axis) => sum + (stage.firstTurns?.[axis] ?? 0), 0) - 1) > 1e-9) errors.push('첫 턴 속성의 확률 합은 1이어야 합니다.');
  if (stage.firstTurns && stage.turnCounts && axes.some(axis => stage.firstTurns[axis] > 0 && stage.turnCounts[axis] === 0)) errors.push('시험에 없는 속성을 첫 턴으로 지정할 수 없습니다.');
  if (!stage.criteria || axes.some(axis => !numeric(stage.criteria[axis]) || stage.criteria[axis] < 0)) errors.push('시험의 속성별 기준값이 필요합니다.');
  if (!Array.isArray(stage.effects)) errors.push('시험 기믹 목록이 필요합니다. 없는 경우 빈 목록을 지정하세요.');
  if (stage.typeMultipliers && axes.some(axis => !numeric(stage.typeMultipliers[axis]) || stage.typeMultipliers[axis] < 0)) errors.push('입력한 속성별 점수 배율이 올바르지 않습니다.');
  if (stage.scenario === 'hif' && !stage.typeMultipliers) unsupported.push('HIF 시험의 정확한 속성별 점수 배율을 입력해야 합니다.');
  if (!Number.isInteger(runs) || runs < 1 || runs > 1000) errors.push('반복 횟수는 1~1,000 사이의 정수여야 합니다.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) errors.push('난수 시드는 0~4,294,967,295 사이의 정수여야 합니다.');
  if (threshold !== null && (!numeric(threshold) || threshold < 0)) errors.push('통과 기준점은 0 이상의 수치여야 합니다.');
  if (loadout.drinkIds?.length || loadout.pDrinkIds?.length || stage.drinkIds?.length) unsupported.push('드링크가 포함된 운용은 아직 지원하지 않습니다.');
  if (loadout.unsupportedEffects?.length || loadout.nativeGrowEffects?.length) unsupported.push('실행할 수 있는 효과로 대응하지 못한 성장·추가 효과가 있습니다.');
  if (errors.length) return { errors, unsupported };
  for (const [groupIndex, group] of (loadout.customizationGroups ?? []).entries()) for (const [cardIndex, custom] of group.entries()) {
    if (custom && Object.values(custom).some(Boolean) && !loadout.skillCardIdGroups[groupIndex]?.[cardIndex]) errors.push('스킬 카드가 없는 슬롯에 커스터마이즈가 지정되어 있습니다.');
  }
  const cards = [], items = [], customs = [];
  for (const [groupIndex, group] of loadout.skillCardIdGroups.entries()) {
    for (const [cardIndex, rawId] of group.entries()) {
      if (!rawId) continue;
      const id = Number(rawId), card = Number.isInteger(id) ? SkillCards.getById(id) : null;
      if (!card) { errors.push('알 수 없는 스킬 카드 ID: ' + rawId); continue; }
      cards.push(card);
      if (card.type !== 'trouble' && !card.actions?.length && !card.effects?.length) unsupported.push('실행할 시험 효과를 확인하지 못한 스킬 카드: ' + card.name);
      const custom = loadout.customizationGroups?.[groupIndex]?.[cardIndex] ?? {};
      if (!custom || Array.isArray(custom) || typeof custom !== 'object') { errors.push('커스터마이즈는 ID와 적용 단계의 대응표여야 합니다.'); continue; }
      for (const [customId, count] of Object.entries(custom)) {
        if (!Number.isInteger(count) || count < 0) { errors.push('커스터마이즈 단계가 올바르지 않습니다: ' + customId); continue; }
        if (count === 0) continue;
        const definition = Customizations.getById(customId);
        if (!definition) { unsupported.push('대응하지 못한 커스터마이즈 ID: ' + customId); continue; }
        if (!card.availableCustomizations.includes(String(customId)) || count > Number(definition.max)) { errors.push('카드에 적용할 수 없는 커스터마이즈 또는 단계: ' + card.name + ' / ' + customId); continue; }
        customs.push(definition);
      }
    }
  }
  for (const rawId of loadout.pItemIds) {
    if (!rawId) continue;
    const item = PItems.getById(Number(rawId));
    if (!item) { errors.push('알 수 없는 P아이템 ID: ' + rawId); continue; }
    items.push(item);
    if (!item.effects?.length) unsupported.push('실행할 시험 효과를 확인하지 못한 P아이템: ' + item.name);
  }
  const plan = loadout.plan ?? cards.find(card => card.plan !== 'free')?.plan;
  if (loadout.generatedBasicCardIds != null && (!Array.isArray(loadout.generatedBasicCardIds) || loadout.generatedBasicCardIds.some(rawId => {
    const card = SkillCards.getById(Number(rawId));
    return !Number.isInteger(Number(rawId)) || !card || card.sourceType !== 'default' || (plan && card.plan !== 'free' && card.plan !== plan);
  }))) errors.push('기본 카드 생성 풀은 같은 플랜의 정확한 기본 카드 ID 목록이어야 합니다.');
  if (plan && cards.some(card => card.plan !== 'free' && card.plan !== plan)) errors.push('선택한 플랜에서 사용할 수 없는 스킬 카드가 포함되어 있습니다.');
  if (plan && items.some(item => item.plan !== 'free' && item.plan !== plan)) errors.push('선택한 플랜에서 사용할 수 없는 P아이템이 포함되어 있습니다.');
  if (new Set(cards.filter(card => card.sourceType === 'pIdol').map(card => card.pIdolId)).size > 1) errors.push('서로 다른 P아이돌의 고유 스킬이 함께 들어 있습니다.');
  if ([cards, items, customs, stage.effects].some(usesClearRatio)) unsupported.push('레슨 클리어 비율을 참조하는 효과는 현재 엔진으로 검증할 수 없습니다.');
  return { errors: unique(errors), unsupported: unique(unsupported) };
}

function quantile(sorted, proportion) {
  const position = (sorted.length - 1) * proportion, lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
function traceOf(result, seed, suppliedCardCount) {
  const turns = [];
  const generatedAtStart = [];
  let turn = null, score = 0;
  const cardLabel = id => ({ id, name: SkillCards.getById(id)?.name ?? String(id) });
  for (const entry of result.logs) {
    const data = entry.data ?? {};
    if (!turn && entry.logType === 'addCardToDeckAtRandom') generatedAtStart.push(cardLabel(data.id));
    if (entry.logType === 'startTurn') {
      turn = { turn: data.num, attribute: data.type, multiplier: data.multiplier, scoreStart: score,
        scoreEnd: score, scoreGain: 0, drawnCards: [], playedCards: [], heldCards: [], decisions: [] };
      turns.push(turn);
    } else if (entry.logType === 'diff' && data.field === S.score) {
      score = data.next;
      if (turn) { turn.scoreEnd = score; turn.scoreGain = score - turn.scoreStart; }
    } else if (turn && entry.logType === 'drawCard') turn.drawnCards.push(cardLabel(data.id));
    else if (turn && entry.logType === 'holdCard') turn.heldCards.push(cardLabel(data.id));
    else if (turn && entry.logType === 'entityStart' && data.type === 'skillCard') turn.playedCards.push(cardLabel(data.id));
    else if (turn && entry.logType === 'hand') {
      const hand = (data.handCards ?? []).map(card => cardLabel(card.id));
      turn.decisions.push({ hand, selectedCard: data.selectedIndex == null ? null : hand[data.selectedIndex] ?? null });
    }
  }
  if (turn) { turn.scoreEnd = result.score; turn.scoreGain = result.score - turn.scoreStart; }
  return { seed, score: result.score, suppliedCardCount, startingDeckCardCount: suppliedCardCount + generatedAtStart.length,
    generatedAtStart, turns };
}

async function runSimulation(input) {
  const { loadout, stage, runs = 20, seed = 610397104, threshold = null } = input ?? {};
  let validation;
  try { validation = inspectInput({ loadout, stage, runs, seed, threshold }); }
  catch (error) { return failure('unsupported', ['카드·효과 자료를 읽지 못했습니다: ' + error.message]); }
  if (validation.errors.length) return failure('invalid_input', validation.errors);
  if (validation.unsupported.length) return failure('unsupported', validation.unsupported);
  const limitations = unique([...baseLimitations, ...(Array.isArray(loadout.assumptions) ? loadout.assumptions : []), ...(Array.isArray(stage.limitations) ? stage.limitations : []),
    '턴 속성의 순서는 공개 엔진의 첫 턴 확률·속성별 횟수·후반 정렬 규칙으로 생성합니다.',
    '커스터마이즈는 연결된 공개 효과 정의를 사용하며, 원본 성장 효과 전체의 게임 내 동작까지 검증한 것은 아닙니다.',
    ...(stage.typeMultipliers ? [] : ['입력 능력치 ÷ 100을 속성별 기본 배율로 사용했습니다.'])]);
  const results = [];
  const warn = console.warn, warnings = [];
  console.warn = (...parts) => warnings.push(parts.map(part => typeof part === 'string' ? part : JSON.stringify(part)).join(' '));
  try {
    for (let index = 0; index < runs; index++) {
      const runSeed = (seed + index) >>> 0;
      resetRand(runSeed);
      const idol = new IdolConfig({ ...loadout,
        skillCardIdGroups: loadout.skillCardIdGroups.map(group => group.map(id => id ? Number(id) : null)),
        pItemIds: loadout.pItemIds.filter(Boolean).map(Number),
      });
      if (loadout.plan) idol.plan = loadout.plan;
      if (loadout.recommendedEffect) idol.recommendedEffect = loadout.recommendedEffect;
      const stageConfig = new StageConfig({ ...stage, type: 'custom', season: stage.season ?? 0, linkTurnCounts: [] });
      const config = new IdolStageConfig(idol, stageConfig);
      config.defaultCardIds = [];
      config.generatedBasicCardIds = loadout.generatedBasicCardIds ?? [];
      if (stage.typeMultipliers) config.typeMultipliers = { ...stage.typeMultipliers };
      const engine = new StageEngine(config), strategy = new STRATEGIES.HeuristicStrategy(engine);
      engine.strategy = strategy;
      const result = await new StagePlayer(engine, strategy).play();
      if (warnings.length) return failure('unsupported', ['시험 중 처리하지 못한 효과가 발견되었습니다.', ...unique(warnings)], limitations);
      if (!numeric(result.score)) return failure('unsupported', ['유효한 시험 점수를 계산하지 못했습니다.'], limitations);
      results.push({ seed: runSeed, result });
    }
  } catch (error) {
    return failure('unsupported', ['입력한 덱의 시험을 끝까지 계산하지 못했습니다: ' + error.message, ...unique(warnings)], limitations);
  } finally { console.warn = warn; }
  const sorted = [...results].sort((a, b) => a.result.score - b.result.score || a.seed - b.seed);
  const scores = sorted.map(row => row.result.score), mean = scores.reduce((sum, value) => sum + value, 0) / runs;
  const median = quantile(scores, 0.5), variance = runs < 2 ? 0 : scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (runs - 1);
  const representative = [...sorted].sort((a, b) => Math.abs(a.result.score - median) - Math.abs(b.result.score - median) || a.seed - b.seed)[0];
  const best = sorted.at(-1);
  return { status: 'simulated', scope: loadout.fullDeckConfirmed === true ? 'supplied_deck_model' : 'conditional_model',
    statistics: { runs, mean, median, min: scores[0], maxObserved: scores.at(-1), p10: quantile(scores, 0.1), p90: quantile(scores, 0.9),
      standardError: runs < 2 ? null : Math.sqrt(variance / runs), threshold, passRate: threshold === null ? null : scores.filter(score => score >= threshold).length / runs },
    sampleScores: results.map(row => ({ seed: row.seed, score: row.result.score })),
    representativeTrace: traceOf(representative.result, representative.seed, loadout.skillCardIdGroups.flat().filter(Boolean).length),
    bestTrace: traceOf(best.result, best.seed, loadout.skillCardIdGroups.flat().filter(Boolean).length), limitations };
}

/** Engine RNG is process-global; serialize complete runs, including async strategies. */
export function simulateBattle(input) {
  const task = pending.then(() => runSimulation(input));
  pending = task.catch(() => {});
  return task;
}
