import { summarizeMemoryEffects } from './memory-effects.mjs';
import { routeAssumption } from './recommend.mjs';
import { hajimeProRoutes } from './hajime-pro-route.mjs';
import { hajimeMasterRoutes } from './hajime-master-route.mjs';
import { assessHifEffect, buildHifAbilityTargetContext } from './hif-ability-guidance.mjs';
import { buildEventUnlockOverrides } from './event-context.mjs';

const axes = [['vocal', 'vo'], ['dance', 'da'], ['visual', 'vi']];
const plans = ['sense', 'logic', 'anomaly'];
const trainingEffects = {
  concentration: /concentration|focus/i, goodConditionTurns: /goodConditionTurns/i,
  motivation: /motivation/i, goodImpressionTurns: /goodImpression/i, fullPower: /fullPowerCharge/i,
  strength: /enthusiasm|aggressive/i, preservation: /preservation/i,
};

function comparisonRoutes(catalog, idol, options) {
  const { scenario, difficulty, targetAttribute, secondaryAttribute } = options;
  const targets = axes.map(([axis]) => axis).filter(axis => axis !== secondaryAttribute || axis === targetAttribute);
  return (targetAttribute ? [targetAttribute] : targets).map(axis => {
    const alternatives = scenario === 'hajime' && difficulty === 'pro' ?
      hajimeProRoutes(catalog, idol?.characterId, axis, options) :
      scenario === 'hajime' && difficulty === 'master' ?
        hajimeMasterRoutes(catalog, idol?.characterId, axis, options) : [];
    if (!alternatives.length) return routeAssumption(catalog, scenario, axis, options);
    return alternatives.reduce((best, route) => route.gains[axis] > best.gains[axis] ? route : best);
  });
}

// Comparison units, not game points. Use the same draw and action weights as carry-in comparison.
const drawWeight = 5, actionWeight = 8;
const customUnitWeights = {
  CostReduce: 0.25, CostLessonBuffReduce: 0.5, CostAggressiveReduce: 0.5,
  CostParameterBuffReduce: 0.5, CostFullPowerPointReduce: 0.5, CostReviewReduce: 0.5,
  LessonAdd: 0.1, LessonCountAdd: 2, LessonDependBlockAdd: 0.01,
  LessonDependExamReviewAdd: 0.01, LessonDependExamCardPlayAggressiveAdd: 0.01,
  AggressiveAdd: 0.5, BlockAdd: 0.25, LessonBuffAdd: 0.5, ReviewAdd: 0.5,
  FullPowerPointAdd: 0.5, ParameterBuffTurnAdd: 0.5, StaminaConsumptionDownTurnAdd: 0.5, InitialAdd: 1,
};

function growEffectPoints(effect, description = '') {
  const type = effect.effectType?.replace('ProduceCardGrowEffectType_', '');
  if (type === 'EffectAdd' && /スキルカード使用数\+/.test(description)) return actionWeight;
  if (type === 'EffectAdd' && effect.playProduceExamEffectId && /(?:追加|成長)/.test(description)) return 0.5;
  const amount = Number(effect.value);
  return Number.isFinite(amount) && amount > 0 ? amount * (customUnitWeights[type] ?? 0) : 0;
}

function examActionPoints(action) {
  const amount = Math.max(0, Number(action.value) || 0);
  if (action.kind === 'skill_use_count_add') return amount * actionWeight;
  if (action.type === 'ExamCardDraw') return amount * drawWeight;
  if (action.kind === 'remove_cards' && action.search?.known === true) return Math.max(0, Number(action.countMin) || 0);
  if (action.kind === 'modify_cards' && action.search?.known === true) {
    return action.growEffects.reduce((sum, effect) => sum + growEffectPoints(effect), 0);
  }
  if (action.kind === 'exam_status') return (amount || Math.max(0, Number(action.turns) || 0)) * 0.5;
  return 0;
}

function effectScore(effect, routes, targetContext, scenario) {
  if (effect.applies !== true || effect.includedInInitialTotals) return 0;
  const occurrence = routes.filter(route => {
    const {phase, conditions} = effect.trigger;
    if (phase === 'ProduceStart') return true;
    if (phase === 'StartAuditionMid2') return scenario === 'nia';
    if (phase.startsWith('StartAudition')) return scenario === 'nia' || route.counts?.exam_end > 0;
    return conditions.some(condition => condition.kind === 'lesson' &&
      route.perAxis?.[condition.attribute]?.[condition.sp ? 'sp_lesson_end' : 'lesson_end'] > 0);
  }).length / routes.length;
  const factor = occurrence * (effect.probability.percent === null ? 1 : effect.probability.percent / 100);
  if (!factor) return 0;
  if (effect.kind === 'exam_enchant') {
    return factor * effect.actions.reduce((sum, action) => {
      if (action.conditions.some(condition => condition.known === false)) return sum;
      const target = assessHifEffect({...effect, actions:[action]}, targetContext);
      const availability = target.targetRequirementSatisfied ? 1 : target.targetAvailability === 'conditional_during' &&
        action.conditions.every(condition => !condition.search?.upgradeCounts?.length) ? 0.5 : 0;
      return sum + examActionPoints(action) * availability;
    }, 0);
  }
  const weight = { stamina_recover:0.25, produce_points:0.05 }[effect.kind];
  return weight !== undefined && Number.isFinite(effect.valueMin) ? effect.valueMin * weight * factor : 0;
}

export function buildInventoryMemoryScores({ inventory, catalog, options }) {
  const idol = inventory.idolCards.find(card => card.gameId === options.idolGameId);
  const routeOptions = {...options, difficulty:options.scenario === 'hif' ? undefined : options.difficulty};
  const routes = comparisonRoutes(catalog, idol, routeOptions);
  const contexts = new Map();

  function contextFor(plan) {
    if (!contexts.has(plan)) {
      const context = {...options, plan, producerLevel:options.producerLevel ?? inventory.producerLevel,
        skillCardSwitchSettings:inventory.skillCardSwitchSettings};
      context.eventUnlockOverrides = buildEventUnlockOverrides({catalog, options:context, context});
      contexts.set(plan, context);
    }
    return contexts.get(plan);
  }

  return inventory.memories.map(memory => {
    const plan = options.plan || (plans.includes(memory.plan) ? memory.plan : memory.effects?.carriedSkill?.plan);
    const context = contextFor(plans.includes(plan) ? plan : null);
    const effects = summarizeMemoryEffects(memory, catalog, context);
    const skill = effects.carriedSkill;
    if (!skill?.variantKnown || skill.planCompatible !== true || skill.switchEligible === false ||
        idol?.excludedScenarios?.includes(options.scenario)) return [memory.id, null];

    const stat = routes.reduce((sum, route) => {
      const rows = route.parameterBonusRows ?? [route.gains];
      return sum + axes.reduce((total, [axis, short]) => total + effects.initialStats[short] +
        rows.reduce((growth, row) => growth + Math.floor(row[axis] * effects.growthRatePermil[short] / 1000), 0), 0);
    }, 0) / routes.length;
    const skillText = [skill.actions, skill.effects].join(' ');
    const skillScore = 1 + skill.upgrade * 0.5 + (/drawCard/i.test(skillText) ? drawWeight : 0) +
      (/cardUsesRemaining|actionCount|additionalTurn|extraTurn/i.test(skillText) ? actionWeight : 0) +
      (trainingEffects[options.trainingType]?.test(skillText) ? 2 : 0);
    const custom = skill.customizes.filter(item => item.exactCountKnown).reduce((sum, item) =>
      item.growEffects.reduce((total, effect) => total + growEffectPoints(effect, item.native?.description), sum), 0);
    const targetContext = effects.conditionalEffects.some(effect => effect.kind === 'exam_enchant' && effect.applies === true) ?
      buildHifAbilityTargetContext({catalog, inventory, options:context, memories:[{modelEffects:effects}],
        selectedIdol:idol && {...idol, owned:idol, ownershipVerified:idol.known !== false}}) : null;
    const ability = effects.conditionalEffects.reduce((sum, effect) =>
      sum + effectScore(effect, routes, targetContext, options.scenario), 0);
    const score = Math.round((stat + skillScore + custom + ability) * 100) / 100;
    return [memory.id, Number.isFinite(score) ? score : null];
  });
}
