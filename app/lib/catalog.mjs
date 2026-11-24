import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : fallback;
export const normalizePlan = value => ({ Plan1: 'sense', Plan2: 'logic', Plan3: 'anomaly', Common: 'free', Unknown: 'free' })[String(value ?? '').replace(/^ProducePlanType_/, '')] ?? String(value ?? 'free').toLowerCase();
export const normalizeAttribute = value => ({ vo: 'vocal', da: 'dance', vi: 'visual', Vocal: 'vocal', Dance: 'dance', Visual: 'visual', Assist: 'assist' })[String(value ?? '').replace(/^SupportCardType_/, '')] ?? String(value ?? 'free').toLowerCase();

function translationTables(directory) {
  const legacy = path.join(workspace, 'work/rea/localify_analysis/text/gakumas-local/local-files');
  const load = relative => readJson(path.join(directory, relative), readJson(path.join(legacy, relative), {}));
  const names = readJson(path.join(directory, 'names.json'), {});
  const masterSupport = new Map((load('masterTrans/SupportCard.json').data ?? []).map(row => [row.id, row.name]));
  const masterSkills = new Map((load('masterTrans/ProduceCard.json').data ?? []).map(row => [`${row.id}:${row.upgradeCount ?? 0}`, row.name]));
  return {
    supports: load('genericTrans/files/SupportCard.json'), supportsById: new Map([...masterSupport, ...Object.entries(names.supports ?? {})]),
    skills: load('genericTrans/files/PCard.json'), skillsById: new Map([...masterSkills, ...Object.entries(names.skillCards ?? {})]),
    idols: new Map([...(load('masterTrans/IdolCard.json').data ?? []).map(row => [row.id, row.name]), ...Object.entries(names.idolCards ?? {})]),
    characters: new Map([...(load('masterTrans/Character.json').data ?? []).map(row => [row.id, `${row.lastName ?? ''} ${row.firstName ?? ''}`.trim()]), ...Object.entries(names.characters ?? {})]),
  };
}

/** Explicit file loading; importing this module never reads the filesystem. */
export function loadCatalog({ dataDir = path.join(workspace, 'outputs/data'), translationDir = path.join(workspace, 'app/data/translations'), artworkPath = path.join(translationDir, '../artwork.json') } = {}) {
  const read = (name, fallback = {}) => readJson(path.join(dataDir, name + '.json'), fallback);
  // Some generated tables live with the runnable app. The research
  // checkout otherwise reads its raw catalog from outputs/data.
  const readPackagedTable = (name, fallback) => read(name, null) ?? (path.resolve(dataDir) === path.join(workspace, 'outputs/data')
    ? readJson(new URL('../data/catalog/' + name + '.json', import.meta.url), fallback) : fallback);
  const reviewed = read('support_cards_reviewed');
  const milestones = read('support_level_milestones');
  const tables = read('game_tables').tables ?? {};
  const pidols = read('p_idol_stats');
  const links = read('skill_item_master_links');
  const skillKeywordGroups = read('skill_keyword_groups').byVariant ?? {};
  const aliases = read('name_aliases').aliases ?? [];
  const memory = read('memory_abilities');
  const calculationModels = read('calculation_model_presets').data ?? {};
  const hajimeSchedule = read('hajime_schedule');
  const niaSchedule = readPackagedTable('nia_schedule', {});
  const hifRouteModel = read('hif_route_model');
  if (hifRouteModel.selectionExams) calculationModels['score/hifSelectionExams'] = hifRouteModel.selectionExams;
  const trans = translationTables(translationDir);
  const artwork = readJson(artworkPath, { entries: {} });
  const imageFields = (id, upgradeCount = null) => {
    const entry = artwork.entries?.[id] ?? {};
    const variant = upgradeCount == null ? null : entry.variants?.[upgradeCount];
    if (entry.kind === 'skillCard') {
      const icon = variant?.gameIconUrl ?? (variant?.thumbnailKind === 'skill_card_icon' ? variant.thumbnailUrl : null);
      return { imageUrl: icon ?? null, thumbnailUrl: icon ?? null, characterIconUrls: variant?.characterIcons ?? {} };
    }
    return { imageUrl: variant?.imageUrl ?? entry.imageUrl ?? null,
      thumbnailUrl: variant?.thumbnailUrl ?? entry.thumbnailUrl ?? variant?.imageUrl ?? entry.imageUrl ?? null };
  };
  const supportByName = new Map((reviewed.cards ?? []).map(card => [card.name, card]));
  const skillDefinitions = new Map((milestones.skills ?? []).map(row => [`${row.id}:${row.level}`, row]));
  const maxLevels = calculationModels['score/maxLevel']?.table ?? {};
  const skillById = new Map((tables.skill_cards ?? []).map(row => [String(row.id), row]));
  const confirmedAliases = aliases.filter(row => row.status === 'confirmed_mapping');
  const koreanAlias = (entity, id) => confirmedAliases.find(row => row.entity_type === entity && String(row.official_id) === String(id) && /[가-힣]/.test(row.alias))?.alias ?? null;
  const supportCards = (milestones.cards ?? []).map(card => {
    const reviewedCard = supportByName.get(card.name);
    const rarity = String(reviewedCard?.rarity ?? card.rarity.replace('SupportCardRarity_', '')).toUpperCase();
    const levels = card.milestones.map(milestone => {
      const skill = skillDefinitions.get(`${milestone.produceSkillId}:${milestone.produceSkillLevel}`);
      return {
        level: milestone.supportCardLevel, order: milestone.order,
        skillId: milestone.produceSkillId, skillLevel: milestone.produceSkillLevel,
        kind: skill?.kind ?? 'unknown', activationLimit: skill?.activationCount ?? null,
        plan: normalizePlan(skill?.planType), scenarioEnum: skill?.produceType ?? null,
        splitEnum: skill?.produceSplitType ?? null,
        effects: (skill?.parts ?? []).map(part => ({
          type: part.effect?.produceEffectType, min: part.effect?.effectValueMin,
          max: part.effect?.effectValueMax, triggerId: part.triggerId,
          phase: part.trigger?.phaseType, ratePermil: part.activationRatePermil,
        })),
      };
    });
    const nameKo = trans.supportsById.get(card.masterId) ?? trans.supports[card.name] ?? null;
    return {
      id: card.masterId, gameId: card.masterId, internalId: card.id,
      name: nameKo ?? card.name, nameJa: card.name, nameKo, rarity,
      plan: normalizePlan(card.planType), attribute: normalizeAttribute(card.type),
      characterIds: card.characterIds, maxLevels: maxLevels[rarity.toLowerCase()] ?? null,
      ...imageFields(card.masterId),
      levelAbilities: levels, abilities: reviewedCard?.abilities ?? [],
      // The public card list omitted the opening story for this card and
      // shifted the PP and enhancement by one unlock. Native story IDs
      // s_card-3-0100-01..03 and the card's published Lv20/Lv40 table agree.
      events: card.masterId === 's_card-3-0100' ? [
        {release:'initial',effect_type:'p_item',title:'トレーナー会議'},
        {release:'lv20',effect_type:'pp_gain',param_value:40,title:'厳しい指導は誰のため？'},
        {release:'lv40',effect_type:'card_enhance',title:'ナウでヤングに！'},
      ] : reviewedCard?.events ?? [], p_item: reviewedCard?.p_item ?? null, skill_card: reviewedCard?.skill_card ?? null,
      numericalSource: 'support_level_milestones:public_master_transcription',
      sourceConflict: Boolean(reviewedCard?.abilities?.some(row => row.review?.status === 'source_conflict')),
    };
  });
  const idolCards = (pidols.cards ?? []).map(card => {
    const titleKo = trans.idols.get(card.id) ?? null;
    const characterKo = trans.characters.get(card.characterId) ?? null;
    const nameJa = `[${card.title}] ${card.idolName}`;
    const nameKo = titleKo && characterKo ? `[${titleKo}] ${characterKo}` : null;
    return {
      id: card.id, gameId: card.id, internalId: card.publicPIdolId,
      name: nameKo ?? nameJa, nameJa, nameKo, title: titleKo ?? card.title,
      characterId: card.characterId, characterName: characterKo ?? card.idolName,
      characterNameKo: characterKo, characterNameJa: card.idolName,
      ...imageFields(card.id), characterImageUrl: imageFields(card.characterId).thumbnailUrl,
      illustrationVariants: artwork.entries?.[card.id]?.trainingVariants ?? null,
      rarity: card.rarity, plan: card.plan, attribute: null,
      baseStats: card.baseStats, specialTrainingStages: card.specialTrainingStages ?? [],
      characterBonuses: (() => { const bonus = pidols.characterBonuses?.find(row => row.characterId === card.characterId); return bonus ? { characterId: bonus.characterId, trueEndBonuses: bonus.trueEndBonuses ?? [] } : null; })(),
      awakeningStages: card.awakeningStages ?? card.potentialStages ?? [],
      recommendedEffect: card.rawRecommendedEffectCandidate ?? card.recommendedEffect,
      recommendedEffectConflict: card.recommendedEffectPublicRawAgreement === false,
      uniqueIds: card.uniqueIds, uniqueSkillCardIds: card.publicUniqueSkillCardIds, initialDeckId: card.initialDeckId ?? null,
      recommendationEligible: card.release?.recommendationEligibleByAvailabilityEvidence !== false,
    };
  });
  const skillCards = (links.skill_cards ?? []).filter(row => row.master_id).map(link => {
    const source = skillById.get(String(link.source_id)) ?? {};
    const nameKo = trans.skillsById.get(`${link.master_id}:${link.master_upgrade_count ?? 0}`) ?? trans.skills[link.master_name] ?? koreanAlias('skill_card', link.source_id);
    return {
      id: link.master_id, gameId: link.master_id, internalId: link.source_id,
      upgradeCount: link.master_upgrade_count ?? 0,
      ...imageFields(link.master_id, link.master_upgrade_count ?? 0),
      referenceImageUrl: artwork.entries?.[link.master_id]?.variants?.[link.master_upgrade_count ?? 0]?.imageUrl ?? artwork.entries?.[link.master_id]?.imageUrl ?? null,
      name: nameKo ?? source.name ?? link.master_name, nameJa: source.name ?? link.master_name, nameKo,
      rarity: source.rarity, plan: normalizePlan(link.master_scalar?.planType ?? source.plan), attribute: null,
      type: source.type ?? null,
      effectGroupIds: skillKeywordGroups[`${link.master_id}:${link.master_upgrade_count ?? 0}`] ?? null,
      actions: source.actions ?? '', effects: source.effects ?? '', conditions: source.conditions ?? '',
      sourceType: source.sourceType, noDeckDuplication: Boolean(link.master_scalar?.noDeckDuplication),
      costType: link.master_scalar?.costType ?? null, costValue: link.master_scalar?.costValue ?? null,
      stamina: link.master_scalar?.stamina ?? null, forceStamina: link.master_scalar?.forceStamina ?? null,
      unlockProducerLevel: link.master_scalar?.unlockProducerLevel ?? source.unlockPlv,
      rentalUnlockProducerLevel: link.master_scalar?.rentalUnlockProducerLevel ?? null,
      recommendationEligible: link.release_gate?.exclude_from_recommendations !== true,
      identityStatus: link.match_status,
    };
  });
  const memoryAbilities = (memory.abilities ?? []).map(ability => ({
    ...ability, gameId: ability.id, internalId: ability.sourceRowIndex,
    name: ability.summaryKo, nameKo: ability.summaryKo, nameJa: null,
    plan: ability.restrictions?.plan ?? 'free', attribute: null,
    numericalSource: 'memory_abilities:public_master_transcription',
  }));
  const customizations = (links.customizations ?? []).filter(row => row.master_id && row.exclude_from_recommendations !== true).map(row => ({
    id: row.master_id, gameId: row.master_id, internalId: row.source_id,
    name: row.name, nameJa: row.name, nameKo: null,
    equivalentGameIds: row.equivalent_effect_reference_master_ids ?? [],
    levels: row.master_customization_levels ?? [], identityStatus: row.match_status,
  }));
  const index = rows => Object.fromEntries(rows.map(row => [row.gameId, row]));
  return {
    asOf: reviewed.meta?.asOf ?? '2026-11-03', artworkCoverage: artwork.coverage ?? null,
    supportCards, idolCards, skillCards, memoryAbilities, customizations, aliases,
    pItems: (links.p_items ?? []).filter(row => row.master_id && row.release_gate?.exclude_from_recommendations !== true).map(row => ({
      gameId: row.master_id, internalId: row.source_id, nameJa: row.master_name ?? row.name,
      originSupportCardId: row.release_gate?.origin_support_card_id ?? null,
      plan: normalizePlan(row.master_scalar?.planType), identityStatus: row.match_status,
      isUpgraded: row.master_scalar?.isUpgraded === true,
    })),
    memoryMechanicsGraph: memory.mechanicsGraph ?? {},
    memoryEffectDetails: readJson(path.join(translationDir, '../memory_effect_details.json'), {}),
    idolMechanicsGraph: pidols.mechanicsGraph ?? {}, hifGrowthPanels: read('hif_growth_panels'),
    hifMemoryRoles: read('hif_memory_roles'),
    scenarioEvents: read('scenario_events', { sources: [], scenarios: [], events: [] }),
    deckGuides: read('deck_guides', { sources: [], guides: [] }),
    skillAdvice: read('skill_card_advice', { cards: [], unresolvedCards: [], evidence: [], sources: [] }),
    hifExamProfiles: read('hif_exam_profiles', { profiles: [], scoreTables: {}, sources: [] }),
    produceInitialDecks: readPackagedTable('produce_initial_decks', {}),
    playbookPolicies: read('playbook_policies', { policies: [], sources: [] }),
    produceResources: readPackagedTable('produce_resources', { sources: [] }),
    hajimeSchedule, hajimeProMenus: read('hajime_pro_menus'), niaSchedule,
    dataFreshness: read('data_freshness', {}),
    supportAdvice: read('support_advice', { cards: [] }),
    guideSupportProfiles: read('guide_support_profiles', { profiles: [], sources: [] }),
    hifStatTargets: read('hif_stat_targets', { configurations: [], sources: [] }),
    hifExamScoreTargets: read('hif_exam_score_targets', { stages: [], sources: [] }),
    hifAbilityGuidance: read('hif_ability_guidance', { sources: [], profiles: [], abilities: [] }),
    produceFlowGuidance: read('produce_flow_guidance', { sources: [], profiles: [] }),
    multiCreatorGuidance: read('multi_creator_guidance', { sources: [], idolProfiles: [] }),
    idolEffectData: readPackagedTable('pidol_unique_effects', {}),
    memoryCarryReview: read('memory_carry_review', { sources: [], cards: [] }),
    idolRecipePolicies: read('idol_recipe_policies', { sources: [], policies: [] }),
    drinkVisuals: read('drink_visuals', { drinks: [], sources: [] }),
    hifItemVisuals: read('hif_item_visuals', { byGameId: {} }),
    eventModes: read('event_modes', { modes: [], sources: [] }),
    planByCode: {},
    scenarios: [{ id: 'hajime', label: '初' }, { id: 'nia', label: 'N.I.A' }, { id: 'hif', label: 'H.I.F' }].map(scenario => {
      const schedules = calculationModels['score/schedule']?.table?.[scenario.id] ?? {};
      const lessons = calculationModels['score/lesson']?.table?.[scenario.id] ?? {};
      const modeledDifficulties = Object.keys(schedules).filter(key => schedules[key]?.length && Object.keys(lessons[key] ?? {}).length);
      if (scenario.id === 'hajime' && hajimeSchedule.scoringPro?.lessons && !modeledDifficulties.includes('pro')) modeledDifficulties.unshift('pro');
      if (scenario.id === 'hajime' && hajimeSchedule.master?.length === 18 && !modeledDifficulties.includes('master')) {
        modeledDifficulties.splice(modeledDifficulties.includes('pro') ? modeledDifficulties.indexOf('pro')+1 : 0,0,'master');
      }
      const guideDifficulties = scenario.id === 'hajime' ? ['pro', 'master'].filter(key => hajimeSchedule[key]?.length)
        : scenario.id === 'nia' && niaSchedule.pro?.length ? ['pro', 'master'] : [];
      const availableDifficulties = [...new Set([...guideDifficulties, ...modeledDifficulties])];
      const preferred = { hajime: 'legend', nia: 'master', hif: 'none' }[scenario.id];
      return { ...scenario, availableDifficulties, modeledDifficulties, defaultDifficulty: availableDifficulties.includes(preferred) ? preferred : availableDifficulties[0] ?? null,
        difficultyLabels: { regular: '레귤러', pro: '프로', master: '마스터', legend: '레전드', none: '기본' },
        modelNote: scenario.id === 'nia' ? 'NIA는 제공 엑셀의 캐시 프리셋 비교입니다. 난이도별 현행 모델이 아닙니다.' : '난이도별 일정과 레슨 수치가 모두 있는 경우에만 경로 수치를 계산합니다.' };
    }),
    indices: { supportCards: index(supportCards), idolCards: index(idolCards) },
    calculationModels,
    excelPresets: read('excel_model_reference').presets ?? [],
    sourceNotes: [
      '서포트는 보유 레벨에 해당하는 공개 마스터 전사값을 사용합니다. 알려진 출처 차이 59곳을 다른 계산기의 값으로 덮어쓰지 않습니다.',
      '한국어명은 사용자가 제공한 번역 자료·확정 별명에 근거하며, 대응이 없으면 일본어명을 표시합니다.',
      '이 카탈로그는 보유 목록이 아닙니다. 추천 후보는 별도로 읽은 계정 기록에서만 가져옵니다.',
    ],
  };
}
