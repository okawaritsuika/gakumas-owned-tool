export const sumikaId = 'i_card-ssmk-3-010';
export const chinaId = 'i_card-kcna-3-014';
export const presenceId = 'p_card-01-men-2_037';
export const declarationId = 'p_card-00-men-2_012';
export const spotlightId = 'p_card-01-men-2_011';
export const topicId = 'p_card-01-act-3_184';
export const chorusId = 'p_card-01-act-2_001';
export const presenceCustom = 'p_card_custom-040-g_effect-cost_parameter_buff_reduce-1';
const spotlightCustom = 'p_card_custom-040_070-g_effect-parameter_buff_turn_add-1-g_effect-parameter_buff_turn_add-3';
const vocal20 = 'memory_ability-p_memory_skill-common-p_trigger-produce_start-initial-vocal_addition-03-001-001';

// Same five owned copies for both runs. Both idols are in the inventory before selection.
export function goodConditionFixture(catalog) {
  const ids = [sumikaId, chinaId];
  const copy = (id, customizes = [], abilities = []) => ({
    id: 'owned-' + id, produceCardPhaseType: 1,
    produceCard: {id, upgradeCount: 1, customizes}, abilities,
  });
  const inventory = {producerLevel:80, supportCards:[],
    skillCardSwitchSettings:{[topicId]:true},
    idolCards:ids.map(gameId=>({gameId,levelLimitRank:3,potentialRank:2})),
    memories:[
      copy(chorusId), copy(spotlightId,[{id:spotlightCustom,customizeCount:2}]), copy(topicId),
      copy(presenceId,[{id:presenceCustom,customizeCount:1}]), copy(declarationId,[],[{id:vocal20,level:1}]),
    ]};
  const options = {scenario:'hif',hifMode:'normal',plan:'sense',trainingType:'goodConditionTurns',
    targetAttribute:'vocal',secondaryAttribute:'dance',deckTemplate:'4-2',activityFocus:'consult',
    memorySelectionMode:'guide',compareSupportUpgrades:false};
  return {catalog:{...catalog,supportCards:[]},inventory,options};
}
