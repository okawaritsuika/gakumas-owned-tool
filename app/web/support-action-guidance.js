(() => {
  'use strict';
  const list = value => Array.isArray(value) ? value : [];
  const axes = {vocal:'보컬',dance:'댄스',visual:'비주얼'};
  const actions = {
    skill_acquire:'필요한 스킬 카드가 보이면 우선 확보하세요.', ssr_card_acquire:'시험에 쓸 SSR 스킬 카드가 보이면 우선 확보하세요.',
    consult_skill_card_acquire:'상담에서 필요한 스킬 카드를 교환하세요.',
    p_drink_acquire:'필요한 드링크가 보이면 우선 확보하세요.', p_drink_exchange:'상담에서 필요한 드링크를 우선 교환하세요.',
    skill_enhance:'강화 기회가 나오면 시험에 쓸 핵심 카드부터 강화하세요.',
    delete:'삭제 기회가 나오면 루프에 필요 없는 카드를 먼저 빼세요.',
    change:'체인지 기회가 나오면 덱에 필요 없는 카드부터 바꾸세요.',
    basic_card_change:'체인지 기회가 나오면 덱에 필요 없는 기본 카드부터 바꾸세요.',
    customize:'커스텀 기회가 나오면 시험에 쓸 핵심 카드를 선택하세요.',
    consult:'상담 기회가 나오면 우선 이용하세요.', outing:'외출할 기회가 나오면 우선 선택하세요.',
    special_training:'특별 지도가 열리면 우선 선택하세요.', rest:'휴식할 기회가 나오면 우선 선택하세요.',
  };
  const keywords = {concentration:'집중',good_condition:'호조',perfect_condition:'절호조',good_impression:'호인상',motivation:'의욕',
    vitality:'원기',full_power:'전력',reserve:'온존',aggressive:'강기',full_power_value:'전력치'};
  function actionText(kind, scenario, lessonAxis) {
    if (actions[kind]) return actions[kind];
    if (kind==='activity_supply_gift') return scenario==='hif' ? '사시이레가 제시되면 우선 선택하세요.' : '활동 지급이 제시되면 우선 선택하세요.';
    if (kind==='class_work_end') return scenario==='nia' ? '영업 기회가 나오면 우선 참여하세요.' : '수업이 제시되면 우선 선택하세요.';
    if (kind==='lesson_end') return axes[lessonAxis] ? axes[lessonAxis]+' 레슨이 열리면 우선 선택하세요.' : null;
    if (kind==='sp_lesson_20') return '덱 장수 조건을 채운 뒤 SP 레슨이 열리면 우선 선택하세요.';
    if (kind==='sp_lesson_end') return (axes[lessonAxis] ? axes[lessonAxis]+' ' : '')+'SP 레슨이 열리면 우선 선택하세요.';
    const typed=/^([am])_skill_(acquire|enhance|delete)$/.exec(kind);
    if (typed) {
      const category=typed[1]==='a'?'액티브':'멘탈';
      return {acquire:`필요한 ${category} 스킬 카드가 보이면 우선 확보하세요.`,
        enhance:`강화 기회가 나오면 시험에 쓸 ${category} 카드부터 강화하세요.`,
        delete:`삭제 기회가 나오면 루프에 필요 없는 ${category} 카드를 먼저 빼세요.`}[typed[2]];
    }
    const keyword=/^(.+)_card_(acquire|enhance)(_8)?$/.exec(kind);
    if (keyword && keywords[keyword[1]] && keyword[2]==='enhance') return '강화 기회가 나오면 '+keywords[keyword[1]]+' 효과가 있는 카드부터 강화하세요.';
    if (keyword && keywords[keyword[1]]) return keywords[keyword[1]]+(keyword[3] ?
      ' 카드 보유 조건을 채운 뒤 필요한 스킬 카드를 확보하세요.' : ' 효과가 있는 스킬 카드가 보이면 우선 확보하세요.');
    return null;
  }

  function actionGroup(kind) {
    if (kind==='consult_skill_card_acquire') return kind;
    if (kind==='skill_acquire'||/_card_acquire(?:_8)?$|^[am]_skill_acquire$/.test(kind)) return 'skill_acquire';
    if (kind.endsWith('skill_enhance')||kind.endsWith('_card_enhance')) return 'skill_enhance';
    if (kind.endsWith('delete')) return 'delete';
    if (kind==='basic_card_change') return 'change';
    if (kind==='sp_lesson_20') return 'sp_lesson_end';
    return kind;
  }

  // Random starter changes from a HIF story or a reward grant a trigger
  // without giving the player a target choice.
  function canChooseChange(kind, summary, activations) {
    if (!['change','basic_card_change'].includes(kind)||!summary.hifModel) return true;
    const weeks=new Set(list(activations).map(row=>row.week).filter(Number.isInteger));
    return list(summary.hifModel.produceActions).some(op=>op.action==='change' && !op.providerId &&
      (!weeks.size||weeks.has(op.week)) && (kind!=='basic_card_change'||op.basicCard===true||op.sourceType==='default') &&
      (!op.basis&&!op.source || op.venue==='class_work_end'&&op.basis==='planned_route_opportunity'));
  }

  function actionEvidence(card, ability, effect, axis, summary) {
    const model=summary.hifModel??summary.nonHifModel;
    const kind=['sp_lesson_hp','sp_lesson_hp_all'].includes(ability.kind)?'sp_lesson_end':ability.kind;
    const lessonAxis=Object.keys(axes).find(axis=>String(effect.triggerId).includes('lesson_'+axis));
    const verb=kind==='p_drink_acquire' && summary.expectedCounts?.p_drink_exchange>0 ?
      actions.p_drink_exchange : actionText(kind,summary.scenario,lessonAxis);
    if (!verb||!canChooseChange(kind,summary)) return null;
    let count=summary.expectedCounts?.[kind];
    if (lessonAxis && ['sp_lesson_end','lesson_end'].includes(kind)) {
      const activities=kind==='sp_lesson_end'?['sp_lesson']:['lesson','normal_lesson','sp_lesson'];
      count=model?.perAxisCounts?.[lessonAxis]?.[kind] ??
        list(model?.selections).filter(row=>activities.includes(row.activity)&&row.axis===lessonAxis).length;
    }
    const dynamic=list(card.dynamicEffects).find(row=>row.kind===kind&&row.axis===axis&&row.amount===effect.min);
    if (summary.hifModel && dynamic) {
      count=dynamic.usedCount+list(model.supportLinks).filter(link=>link.receiverId===card.gameId &&
        link.source==='ability'&&link.kind===kind&&link.axis===axis).reduce((n,link)=>n+link.extraCount,0);
    } else if (!summary.hifModel && ['skill_enhance','p_drink_acquire'].includes(kind)) {
      const receiver=list(card.itemReceivers).find(row=>row.kind===kind&&row.axis===axis&&row.amount===effect.min);
      if (receiver) count=receiver.used+(model?.supportItemActionCounts?.[kind]??0);
    }
    if (!Number.isFinite(count)||count<=0) return null;
    count=ability.activationLimit>0?Math.min(ability.activationLimit,count):count;
    return {key:verb===actions.p_drink_exchange?'p_drink_exchange':actionGroup(kind),text:verb,count};
  }

  function itemAdvice(card, summary) {
    const value=card.supportItemValue;
    if (!value || value.status==='unsupported' || value.acquisitionConfirmed!==true) return null;
    const total=value.applied;
    if (!(total?.activationCount>0)) return null;
    const trigger=value.triggerMeta??card.p_item?.effect?.trigger??{};
    const keyword=({preservation:'reserve',strength:'aggressive',fullPower:'full_power',goodConditionTurns:'good_condition',
      goodImpressionTurns:'good_impression'})[trigger.keyword]??trigger.keyword;
    const kind=({param_sp_lesson_end:'sp_lesson_end',param_lesson_end:'lesson_end',class_work_end:'class_work_end',consult_selection:'consult',
      outing_end:'outing',activity_supply_gift_selection:'activity_supply_gift',special_training_start:'special_training',
      skill_change:'change',card_enhance:'skill_enhance',card_delete:'delete',card_acquire:'skill_acquire',
      skill_acquire:'skill_acquire',pdrink_acquire:'p_drink_acquire',keyword_card_acquire:keyword+'_card_acquire',
      keyword_card_enhance:keyword+'_card_enhance'})[trigger.key];
    const verb=kind&&actionText(kind,summary.scenario,trigger.param);
    const grants=Object.entries(axes).filter(([axis])=>total.stats?.[axis]>0);
    if (!verb||!grants.length||!canChooseChange(kind,summary,total.activations)) return null;
    const [axis]=grants.sort(([a],[b])=>total.stats[b]-total.stats[a])[0];
    const condition=card.p_item?.effect?.condition;
    const extra=list(value.conditions).find(text=>text.startsWith('추가 조건: '));
    if (condition && (!extra||/미확인|확인 필요/.test(extra))) return null;
    const gate=condition ? (axes[condition.param]??'발동')+' 조건을 채운 뒤 ' : '';
    return {key:actionGroup(kind),axis,points:total.stats[axis],text:gate+verb};
  }

  globalThis.supportActionGuidance = function supportActionGuidance(result) {
    const summary=result?.scoreSummary;
    if (!summary) return [];
    const supports=Array.isArray(result.supports)?result.supports:[...list(result.supports?.owned),result.supports?.rental];
    const candidates=[];
    for (const card of supports.filter(Boolean)) {
      const latest=new Map();
      for (const ability of list(card.levelAbilities)) if (Number.isFinite(ability.level)&&ability.level<=card.level &&
        (!latest.has(ability.order)||latest.get(ability.order).level<=ability.level)) latest.set(ability.order,ability);
      for (const ability of latest.values()) {
        if (ability.plan && ability.plan!=='free' && ability.plan!==summary.plan) continue;
        const scenario=({ProduceType_FirstStar:'hajime',ProduceType_NextIdolAudition:'nia',ProduceType_HatsuboshiIdolFestival:'hif'})[ability.scenarioEnum];
        if (scenario && scenario!==summary.scenario || ability.splitEnum && !ability.splitEnum.endsWith('_Unknown')) continue;
        for (const effect of list(ability.effects)) {
          const axis=/^ProduceEffectType_(Vocal|Dance|Visual)Addition$/.exec(effect.type)?.[1].toLowerCase();
          const recovery=effect.type==='ProduceEffectType_StaminaRecoverFix';
          if ((!axis&&!recovery)||!Number.isFinite(effect.min)||effect.min<=0||effect.min!==effect.max) continue;
          const action=actionEvidence(card,ability,effect,axis,summary);
          if (!action) continue;
          candidates.push({key:action.key,axis,points:effect.min*action.count,text:action.text});
        }
      }
      const item=itemAdvice(card,summary);
      if (item) candidates.push(item);
    }
    // Prefer an action supported by several selected cards. Keep recovery in
    // its own unit and use verified parameter headroom when choosing examples.
    const groups=new Map(), model=summary.hifModel??summary.nonHifModel;
    for (const row of candidates) {
      const group=groups.get(row.key)??{stats:{},recovery:0,rows:[]};
      if (row.axis) group.stats[row.axis]=(group.stats[row.axis]??0)+row.points;
      else group.recovery+=row.points;
      group.rows.push(row);
      groups.set(row.key,group);
    }
    for (const group of groups.values()) {
      group.points=0;
      for (const [axis,gain] of Object.entries(group.stats)) {
        const raw=model?.rawStats?.[axis], capped=model?.cappedStats?.[axis];
        const excess=Number.isFinite(raw)&&Number.isFinite(capped)?Math.max(0,raw-capped):0;
        group.stats[axis]=Math.max(0,gain-excess)*(summary.axisWeights?.[axis]??1);
        group.points+=group.stats[axis];
      }
      const useful=group.rows.filter(row=>row.axis ? group.stats[row.axis]>0 : !group.points);
      group.example=useful.sort((a,b)=>b.points-a.points)[0];
    }
    const ranked=[...groups.values()].filter(group=>group.points>0||group.recovery>0)
      .sort((a,b)=>b.points-a.points||b.recovery-a.recovery);
    const firstTwo=ranked.slice(0,2).map(group=>group.example.text);
    let combined;
    if (firstTwo.includes(actions.p_drink_exchange) && firstTwo.includes(actions.p_drink_acquire)) {
      combined='필요한 드링크를 우선 확보하고, 상담에서는 드링크를 교환하세요.';
    } else {
      const axis=Object.keys(axes).find(axis=>firstTwo.includes(actionText('lesson_end',summary.scenario,axis)) &&
        firstTwo.includes(actionText('sp_lesson_end',summary.scenario,axis)));
      if (axis) combined=axes[axis]+' 레슨을 고르고, SP 레슨이 열리면 우선 선택하세요.';
    }
    return combined ? [combined,...ranked.slice(2,3).map(group=>group.example.text)] : firstTwo;
  };
})();
