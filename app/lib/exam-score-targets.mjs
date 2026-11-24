import { resolveHifExamRewards } from './hif-model.mjs';
const list = value => Array.isArray(value) ? value : [];
const validScore = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const idolIdOf = (candidate, result) => candidate?.selectedIdol?.gameId ?? candidate?.selectedIdol?.id ?? result?.selectedIdol?.gameId ?? result?.selectedIdol?.id ?? null;

/** Source-based goals only. Native NPC rows are evidence, never a fixed passing line. */
export function buildExamScoreTargets({ candidate = null, result = {}, catalog = {}, examIndex = null, options = {}, eventModeId = null } = {}) {
  if (examIndex !== null && (!Number.isInteger(examIndex) || examIndex < 0 || examIndex > 4)) throw new RangeError('시험 번호는 0~4입니다.');
  const reference = catalog.hifExamScoreTargets;
  const idolCardId = idolIdOf(candidate, result);
  const profile = list(catalog.hifExamProfiles?.profiles).find(row => row.idolCardId === idolCardId);
  const scenario = options.scenario ?? result.scoreSummary?.scenario ?? candidate?.scoreSummary?.scenario ?? null;
  const selectedMode = eventModeId ?? options.eventModeId ?? result.eventContext?.modeId ?? result.eventContext?.eventModeId ?? result.eventContext?.mode?.id ?? null;
  const isEvent = selectedMode !== null && !['normal', 'none', 'standard', 'normal_hif'].includes(selectedMode);
  const limitations = [...list(reference?.limitations)];
  const unavailable = message => ({ status: 'unavailable', scope: 'normal_hif_community_reference', asOf: reference?.asOf ?? null,
    idolCardId, stages: [], evidenceSources: list(reference?.sources), limitations: [...limitations, message] });
  if (scenario && scenario !== 'hif') return unavailable('HIF 선발시험 참고치입니다. 다른 시나리오에는 적용하지 않습니다.');
  if (!reference?.stages?.length) return unavailable('점수 목표의 출처 카탈로그를 읽지 못했습니다.');
  if (!profile) return unavailable('선택한 P아이돌과 HIF 시험을 정확히 연결하지 못했습니다.');
  const crossChecked = list(reference.nativeCrossCheckedIdolCardIds).includes(idolCardId);
  if (!crossChecked) limitations.push('공략의 수치는 일반 HIF 참고치입니다. 이 P아이돌의 실제 돌파선을 따로 검증한 값이 아닙니다.');
  if (isEvent) limitations.push('선택한 이벤트에서 같은 점수 경계가 유지되는지는 미확인입니다. 일반 HIF 참고치로만 표시합니다.');
  const stages = list(reference.stages).filter(row => examIndex === null || row.examIndex === examIndex).map(row => {
    const rewardInput=resolveHifExamRewards(catalog,options).find(reward=>reward.examIndex===row.examIndex);
    const exam = list(profile.examStages).find(exam => exam.stage === 'selection' && exam.order === row.examIndex + 1);
    const border = list(catalog.hifExamProfiles?.npcGroups?.[exam?.npcGroupId]).find(npc => npc.produceExamBattleNpcMobId === 'npc_hif_border');
    return {
      examIndex: row.examIndex, label: row.label, stage: 'selection', order: row.examIndex + 1,
      status: isEvent ? 'normal_reference_event_applicability_unknown' : 'community_reference',
      applicability: isEvent ? 'normal_hif_reference_only' : 'normal_hif', appliesToSelectedMode: isEvent ? null : true,
      pass: { ...structuredClone(row.pass), rule: 'displayed_breakthrough_line', actualDisplayedThreshold: null,
        nativeRankThreshold: validScore(exam?.rankThreshold), passed: null,
        label: '통과 참고 목표', instruction: '게임 화면에 표시된 돌파선 이상을 우선 확인하세요.' },
      rewardTargets: structuredClone(list(row.rewardTargets)),
      enteredResult:{score:rewardInput?.score??null,parameterGains:rewardInput?.source==='manual_reward_input'?rewardInput.parameterGains:null,
        gainBasis:rewardInput?.source==='manual_reward_input'?rewardInput.basis:null,source:'manual_input_not_automatic_capture',
        observedScoreToParametersApplied:false},
      modeledParameterReward:rewardInput??null,
      native: { difficultyId: profile.difficultyId ?? null, npcGroupId: exam?.npcGroupId ?? null,
        rankThreshold: validScore(exam?.rankThreshold), isStaticNpcScore: exam?.isStaticNpcScore ?? null,
        baseScore: validScore(exam?.baseScore), rawNativeNpcBorder: border ? { scoreMin: validScore(border.scoreMin), scoreMax: validScore(border.scoreMax) } : null,
        rawNativeNpcBorderIsPassingThreshold: false, exactPassingScore: null, accountSpecificCrossChecked: crossChecked },
      notes: ['통과 참고 목표와 최대 보상 목표는 서로 다릅니다.', '표시된 보상은 기본값이며 실제 보정 후 보장 수량이 아닙니다.',
        '입력한 점수만으로 파라미터 상승을 역산하지 않습니다. 미입력 보상은 최대 보상 참고 조건이며 입력한 post_bonus 값에는 성장률을 다시 적용하지 않습니다.',
        ...(isEvent ? ['이벤트 적용 여부 미확인: 일반 HIF 참고치'] : [])],
      sourceIds: [...new Set([...list(row.pass?.sourceIds), ...list(row.rewardTargets).flatMap(target => list(target.sourceIds))])],
    };
  });
  if (examIndex !== null && examIndex >= 3) limitations.push('본선은 선발 1·2·3의 목표를 재사용하지 않습니다. 본선 점수 목표는 이번 자료에서 미확정입니다.');
  const nativeSources = list(catalog.hifExamProfiles?.sources).filter(source => ['master-IdolCard', 'master-ProduceStepAuditionDifficulty', 'master-ProduceExamBattleNpcGroup'].includes(source.id));
  return { status: stages.length ? isEvent ? 'normal_reference_event_applicability_unknown' : 'community_reference' : 'unavailable_for_final',
    scope: 'normal_hif_community_reference', asOf: reference.asOf, idolCardId, selectedEventModeId: selectedMode,
    actualExamScoreCaptured: false, actualPassingLineCaptured: false, projectedExamScore: null,
    stages, limitations, evidenceSources: [...list(reference.sources), ...nativeSources] };
}
