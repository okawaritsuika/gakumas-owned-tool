import { canAddMemoryCopy, memoryBattleRoles, sumMemoryFixedEffects } from './recommend.mjs';
import { summarizeMemoryEffects } from './memory-effects.mjs';
import { findHifMemoryProfile, hifGuideConflicts } from './hif-memory-profile.mjs';
import { idolRecipeContext } from './idol-recipe-policy.mjs';
import { buildHifAbilityTargetContext, fulfilledHifEffectIds } from './hif-ability-guidance.mjs';

const roleLabels = { attack: '공격', draw: '드로우', extra_action: '추가 행동', strengthen: '강화' };
const skillOf = row => row.modelEffects.carriedSkill;
const upgradeOf = skill => skill?.upgrade ?? skill?.upgradeCount;
const effectCode = skill => `${skill?.actions ?? ''};${skill?.effects ?? ''}`;
const resourceAttack = skill => /\bscore\s*\+=\s*(genki|goodImpressionTurns|motivation|concentration)\b(?:\s*\*\s*(\d+(?:\.\d+)?))?/.exec(effectCode(skill));
const customKey = skill => JSON.stringify((skill?.customizes ?? []).map(row => [row.id, row.customizeCount]).sort());
const hifKey = row => JSON.stringify(row.modelEffects.hifEffects.map(effect => [effect.effectId, effect.abilityLevel, effect.applies]).sort());

function keepsRole(original, alternate, roles, guideRole) {
  const before = skillOf(original), after = skillOf(alternate);
  if (guideRole?.customizationRequirement || guideRole?.customizationCriteria || guideRole?.exactCustomizations?.length ||
      guideRole?.deckCondition || guideRole?.preferredUpgrade > upgradeOf(after)) return false;
  if (!roles.length || !roles.every(role => alternate.battleRoleProfile.roles.includes(role))) return false;
  if (after.conditions && after.conditions !== before.conditions) return false;
  const costType = alternate.skillCard.costType;
  if (costType && costType !== 'ExamCostType_Unknown' && costType !== original.skillCard?.costType) return false;
  if (alternate.battleRoleProfile.activationConditions.some(condition => !original.battleRoleProfile?.activationConditions?.includes(condition))) return false;
  if (alternate.battleRoleProfile.hasDelayedEffects && !original.battleRoleProfile?.hasDelayedEffects) return false;
  return !roles.includes('attack') || resourceAttack(before)?.[1] === resourceAttack(after)?.[1];
}

function differences(original, alternate, previous, next) {
  const before = skillOf(original), after = skillOf(alternate);
  const beforeAttack = resourceAttack(before), afterAttack = resourceAttack(after);
  const genkiRate = beforeAttack?.[1] === 'genki' && afterAttack?.[1] === 'genki' && beforeAttack[2] !== afterAttack[2]
    ? [Number(beforeAttack[2] ?? 1), Number(afterAttack[2] ?? 1)] : null;
  const statDelta = Object.fromEntries(['initial', 'growth'].map(key => [key,
    Object.fromEntries(Object.keys(next[key]).map(axis => [axis, next[key][axis] - previous[key][axis]]))]));
  return { ...statDelta, genkiRate, skillChanged: before?.id !== after.id, upgradeChanged: upgradeOf(before) !== upgradeOf(after),
    phaseChanged: before?.phase?.code !== after.phase.code, customizationChanged: customKey(before) !== customKey(after),
    hifChanged: hifKey(original) !== hifKey(alternate),
    useConditionChanged: before?.conditions !== after.conditions || (original.skillCard?.costType ?? null) !== (alternate.skillCard?.costType ?? null) ||
      (original.skillCard?.costValue ?? null) !== (alternate.skillCard?.costValue ?? null) };
}

/** Review single-slot substitutions after the recommendation has been selected. */
export function buildMemoryReplacements({result, inventory, catalog, options, memoryArtwork = row => row}) {
  const selected = result.memories;
  if (!selected?.length) return [];
  const { scenario, plan, trainingType } = result.scoreSummary;
  const context = idolRecipeContext({result, catalog, inventory, options: {...options, scenario, plan, trainingType}});
  const profile = scenario === 'hif' ? findHifMemoryProfile(catalog, {...context, selectedIdol: result.selectedIdol}) : null;
  const skills = new Map(catalog.skillCards.map(card => [`${card.gameId}:${card.upgradeCount ?? 0}`, card]));
  const selectedIds = new Set(selected.map(row => String(row.id)));
  const duplicates = new Set((options.allowDuplicateMemorySkillIds ?? []).map(String));
  const statsOnly = result.memorySelectionReview.selectionMode === 'stats';
  const requiredSkills = new Set(statsOnly ? [] : options.desiredSkillIds ?? []);
  const fulfilledHif = memories => new Set(fulfilledHifEffectIds(memories,
    buildHifAbilityTargetContext({memories, result, catalog, inventory, options: context})));
  const requestedHif = statsOnly ? [] : options.requiredHifEffectIds ?? [];
  const carriesHif = (memories, id) => memories.some(row =>
    row.modelEffects.hifEffects.some(effect => effect.effectId === id && effect.applies === true));
  const carriedHif = requestedHif.filter(id => carriesHif(selected, id));
  const requiredHif = selected.some(row => row.modelEffects.hifEffects.some(effect => effect.applies === true))
    ? [...fulfilledHif(selected)] : [];
  const previous = sumMemoryFixedEffects(selected);
  const conflicts = memories => hifGuideConflicts(profile, memories).filter(conflict => conflict.status === 'conflict').map(conflict => conflict.cardIds.join('|'));
  const existingConflicts = new Set(conflicts(selected));
  const checkCarry = original => {
    const modelEffects = summarizeMemoryEffects(original, catalog, context);
    const skill = modelEffects.carriedSkill;
    const skillCard = skills.get(`${skill?.id}:${upgradeOf(skill)}`);
    if (skill?.obtainable !== true || skill.phase?.availableAtStart == null || !skillCard || skillCard.recommendationEligible === false) return null;
    const row = { id: original.id, gameId: original.gameId, raw: original.raw, modelEffects, skillCard, uniqueKeys: modelEffects.uniqueKeys };
    return { ...row, battleRoleProfile: memoryBattleRoles(row) };
  };
  const candidates = (inventory.memories ?? []).filter(row => row.id != null && !selectedIds.has(String(row.id))).map(checkCarry).filter(Boolean);
  const catalogCarries = new Map();

  return selected.map((memory, index) => {
    const slot = result.memorySelectionReview.slots[index], skill = skillOf(memory);
    const retained = selected.filter((_, i) => i !== index);
    const free = ['slot_fill', 'stat_fill'].includes(slot.basis);
    const roles = memory.battleRoleProfile?.roles ?? [];
    const guideRole = slot.roleMatches.find(role => role.status === 'fulfilled' || role.status === 'unknown');
    const recipe = guideRole && profile?.carryRoles?.find(role => role.gameId === guideRole.gameId);
    const role = free ? '' : skill?.phase?.availableAtStart === true && guideRole?.purpose ? guideRole.purpose :
      (roles.length ? roles.map(key => roleLabels[key]).join(' · ') : slot.label);
    const requestedSkill = requiredSkills.has(skill?.id) && !retained.some(row => skillOf(row)?.id === skill.id);
    const chosenForHif = slot.basis === 'hif_copy';
    const latestPhase = recipe?.requiredAcquisitionPhaseForEarlyRole ?? skill?.phase?.code ?? (free ? 2 : null);
    const accepts = candidate => {
      const alternate = skillOf(candidate);
      if (!skill?.id || alternate.id === skill.id || ![1, 2].includes(latestPhase) || alternate.phase.code > latestPhase ||
          !canAddMemoryCopy(retained, candidate, scenario, duplicates) ||
          (alternate.noDeckDuplication && retained.some(row => skillOf(row)?.id === alternate.id))) return false;
      if (!free && !keepsRole(memory, candidate, roles, recipe)) return false;
      if (chosenForHif && hifKey(memory) !== hifKey(candidate)) return false;
      const lineup = selected.map((row, i) => i === index ? candidate : row);
      if (conflicts(lineup).some(conflict => !existingConflicts.has(conflict))) return false;
      if (carriedHif.some(id => !carriesHif(lineup, id))) return false;
      if (requiredHif.length) {
        const fulfilled = fulfilledHif(lineup);
        if (requiredHif.some(id => !fulfilled.has(id))) return false;
      }
      return true;
    };
    const owned = (requestedSkill ? [] : candidates.filter(accepts)).map(candidate => {
      const lineup = selected.map((row, i) => i === index ? candidate : row);
      return { candidate, changes: differences(memory, candidate, previous, sumMemoryFixedEffects(lineup)) };
    }).sort((a, b) => {
      const distance = ({changes}) => Object.values(changes.initial).reduce((sum, n) => sum + Math.abs(n), 0) +
        Object.values(changes.growth).reduce((sum, n) => sum + Math.abs(n), 0);
      return distance(a) - distance(b) || String(a.candidate.id).localeCompare(String(b.candidate.id));
    });
    const cards = new Map();
    const addCard = (candidate, owned) => {
      const {skillCard: card} = candidate, id = card.gameId;
      if (cards.has(id) || cards.size >= 3) return false;
      const base = skills.get(`${id}:0`) ?? card;
      cards.set(id, { gameId: id, name: (base.nameKo || base.name || base.nameJa || id).replace(/\s*[+＋]\s*$/u,'').trim(),
        owned, minimumUpgrade: owned ? null : upgradeOf(skillOf(candidate)) });
      return true;
    };
    const alternatives = owned.filter(({candidate}) => addCard(candidate, true)).map(({candidate, changes}) => ({memory:memoryArtwork(candidate), changes}));
    if (!requestedSkill && !free && roles.length && [1, 2].includes(latestPhase) && cards.size < 3) {
      // A catalog entry describes a skill that could fill the role by the deadline.
      // Its hypothetical join date and unrecorded memory effects never become an owned copy.
      if (!catalogCarries.has(latestPhase)) catalogCarries.set(latestPhase, catalog.skillCards.filter(card => card.sourceType === 'produce').map(card => checkCarry({
        produceCard: {id: card.gameId, upgradeCount: card.upgradeCount ?? 0}, produceCardPhaseType: latestPhase, abilities: [],
      })).filter(Boolean).sort((a, b) => upgradeOf(skillOf(a)) - upgradeOf(skillOf(b))));
      for (const candidate of catalogCarries.get(latestPhase)) {
        if (cards.size === 3) break;
        if (!cards.has(skillOf(candidate).id) && accepts(candidate)) addCard(candidate, false);
      }
    }
    return { memoryId: memory.id, role, kind: free ? 'stats' : cards.size ? 'replaceable' : 'required',
      latestPhase, replacementCards: [...cards.values()], alternatives };
  });
}
