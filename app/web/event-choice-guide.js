'use strict';

// Match the Korean reward lines shipped with the event catalogue. Keep the original
// wording in the result, including success chances, random targets and card rarity.
const eventGoals = {
  recover: ['체력 회복', /체력.*회복/],
  card: ['스킬 카드 획득', /스킬 카드.*획득/],
  upgraded: ['강화된 카드 획득', /강화된.*스킬 카드.*획득/],
  strengthen: ['덱에 있는 카드 강화', /카드.*강화$/],
  change: ['덱에 있는 카드 교체', /카드.*체인지$/],
  remove: ['덱에 있는 카드 제거', /카드.*제거$/],
  drink: ['드링크 획득', /드링크.*획득/],
  pp: ['P포인트 확보', /P포인트\s*\+/],
  vocal: ['보컬 올리기', /보컬\s*\+/],
  dance: ['댄스 올리기', /댄스\s*\+/],
  visual: ['비주얼 올리기', /비주얼\s*\+/],
  vocalLesson: ['보컬 레슨 시작', /보컬 일반 레슨 시작/],
  danceLesson: ['댄스 레슨 시작', /댄스 일반 레슨 시작/],
  visualLesson: ['비주얼 레슨 시작', /비주얼 일반 레슨 시작/],
  votes: ['팬 투표수 확보', /팬 투표수\s*\+/],
  maxStamina: ['최대 체력 올리기', /최대 체력\s*\+/],
  leave: ['추가 도전 종료', /아무것도 하지 않고 프로듀스로 돌아감/]
};

function eventChoiceCosts(choice) {
  if (!Array.isArray(choice.costs)) return null;
  const costs = { pp: 0, stamina: 0, trouble: 0 };
  for (const line of choice.costs) {
    const payment = /^(P포인트|체력) (\d+) 소비$/.exec(line);
    const trouble = /^졸음 (\d+)장 획득$/.exec(line);
    if (payment) costs[payment[1] === '체력' ? 'stamina' : 'pp'] += Number(payment[2]);
    else if (trouble) costs.trouble += Number(trouble[1]);
    else return null;
  }
  return costs;
}

function compareEventChoices(event, { goal, offered, stamina, pp }) {
  if (!offered.size) return '게임 화면에서 보상과 비용이 일치하는 보기를 체크하세요.';
  if (!Object.hasOwn(eventGoals, goal)) return '지금 필요한 보상을 고르세요.';
  const [label, matchesGoal] = eventGoals[goal];
  const ready = [], pending = [], blocked = [];
  event.choices.forEach((choice, i) => {
    if (!offered.has(i)) return;
    const rewards = choice.rewards.filter(line => matchesGoal.test(line));
    if (!rewards.length) return;
    const costs = eventChoiceCosts(choice);
    if (!costs) { pending.push(`${i + 1}번의 비용 확인 필요`); return; }
    const needs = [], missing = [];
    for (const [needed, current, name] of [[costs.pp, pp, 'P포인트'], [costs.stamina, stamina, '체력']]) {
      if (!needed) continue;
      if (!Number.isInteger(current) || current < 0) missing.push(`현재 ${name} 입력 필요`);
      else if (current < needed) needs.push(`${name} ${needed} 필요 · 현재 ${current}`);
    }
    if (needs.length) blocked.push(`${i + 1}번 · ${needs.join(', ')}`);
    else if (missing.length) pending.push(`${i + 1}번 · ${missing.join(', ')}`);
    else ready.push({rewards,costs,text:`${i + 1}번 · ${rewards.join(' / ')} (${choice.costs.join(' · ') || '추가 비용 없음'})`});
  });
  // Compare amounts only for a single unconditional reward with the same units.
  // A success/failure pair, a random target or a different unit remains visible.
  function betterForGoal(a,b) {
    const keys=['pp','stamina','trouble'];
    if (!keys.every(key => a.costs[key] <= b.costs[key])) return false;
    if (a.rewards.join('\n') === b.rewards.join('\n')) return keys.some(key => a.costs[key] < b.costs[key]);
    const fixed = lines => lines.length === 1 && /^(?:공통: )?(보컬|댄스|비주얼|P포인트|팬 투표수|최대 체력) \+(\d+)$/.exec(lines[0]);
    const x=fixed(a.rewards), y=fixed(b.rewards);
    return Boolean(x && y && x[1]===y[1] && Number(x[2])>Number(y[2]));
  }
  const suggested = ready.filter(row => !ready.some(other => betterForGoal(other,row)));
  const message = ready.length ? [`${label}에 맞는 선택`, ...suggested.map(row => row.text)] :
    [pending.length ? '입력을 보완하면 비교할 수 있어요.' : blocked.length ? '입력한 자원으로는 원하는 보상을 받을 수 없어요.' : '체크한 보기에서 원하는 보상을 찾지 못했어요.'];
  if (suggested.length < ready.length) message.push('같은 보상은 비용이 적은 쪽을, 확정 수치가 다르면 비용 부담이 같거나 더 적으면서 수치가 큰 쪽을 골랐어요. 함께 받는 보상은 각 보기에서 확인하세요.');
  if (suggested.length > 1) message.push('같은 목표를 충족하는 보기입니다. 받을 수치와 소비할 자원을 비교하세요.');
  if (pending.length) message.push('확인 필요 · ' + pending.join(' / '));
  if (blocked.length) message.push('비용 부족 · ' + blocked.join(' / '));
  return message.join('\n');
}

function eventComparisonMarkup(event) {
  const choices = event.choices;
  const goals = Object.entries(eventGoals).filter(([, [,pattern]]) => choices.some(choice => choice.rewards.some(line => pattern.test(line))));
  if (!goals.length) return '';
  const costs = choices.map(eventChoiceCosts);
  const input = (key, label) => costs.some(cost => cost?.[key] > 0) ?
    `<label>${label} <input type="number" step="1" min="0" data-event-resource="${key}" placeholder="미확인"></label>` : '';
  return `<section class="event-decision"><h4>지금 어떤 보기를 고를까요?</h4>
    <p>게임에 뜬 보기와 아래 보상·비용을 대조하고, 일치하는 보기만 체크하세요.</p>
    <div class="event-decision-fields"><label>필요한 보상 <select data-event-goal><option value="">목표 선택</option>
    ${goals.map(([id, [label]]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
    ${input('stamina', '현재 체력')}${input('pp', '현재 P포인트')}</div>
    <p class="event-decision-result" data-event-verdict role="status">게임 화면에서 보상과 비용이 일치하는 보기를 체크하세요.</p></section>`;
}

function updateEventComparison(eventElement, event) {
  const output = eventElement.querySelector('[data-event-verdict]');
  if (!output || !event) return;
  const resource = key => {
    const field = eventElement.querySelector(`[data-event-resource="${key}"]`);
    return field && field.value !== '' && field.validity.valid ? field.valueAsNumber : null;
  };
  output.textContent = compareEventChoices(event, {
    goal: eventElement.querySelector('[data-event-goal]').value,
    offered: new Set([...eventElement.querySelectorAll('[data-event-offer]:checked')].map(field => Number(field.value))),
    stamina: resource('stamina'), pp: resource('pp')
  });
}
