// Exact variants only. Each scope is an ordinary (non-event) scenario and difficulty.
export const goalSources = {
  hifTier: { name: '학마스 철저공략 · HIF 고득점 비교', url: 'https://sakigames.jp/gakuen-idolmaster/p-idol-tier/' },
  game8: { name: 'Game8 · HIF·하지메 레전드 카드 평가', url: 'https://game8.jp/gakuen-idolmaster/687590' },
  china: { name: '학마스 철저공략 · 가라쿠타로드 치나 운용', url: 'https://sakigames.jp/gakuen-idolmaster/p-idol/garakutarodo-kuramotochina/' },
  spotlight: { name: 'miso · 마오 HIF 본선 클리어', url: 'https://note.com/miso_w97htrk9/n/n537b7897c625' },
  first: { name: '芽茶 · 하지메 프로 입문', url: 'https://note.com/monomotapa_a/n/nc845dc04a133' },
  firstMaster: { name: '芽茶 · 하지메 마스터 압축 덱', url: 'https://note.com/monomotapa_a/n/ne45a26cd55c8' },
  niaPro: { name: '芽茶 · NIA 프로 외출 경로', url: 'https://note.com/monomotapa_a/n/n7fbc076772c3' },
  niaMaster: { name: '芽茶 · NIA 마스터 사시이레 경로', url: 'https://note.com/monomotapa_a/n/n033ba0cca98d' },
  niaScore: { name: 'しゆ·つきひ · NIA 마스터 센스 팽창 덱', url: 'https://note.com/tsukihi_gakmas/n/n39ee296bee82' },
  firstScores: { name: 'さっきー · 하지메 평가 육성 기록', url: 'https://note.com/nvsk_37/n/nb3f016ac9fdc' },
  winter: { name: 'こからいあ · 코토네 NIA SS+ 육성 기록', url: 'https://note.com/kkriaaaaa/n/nca355caed29f' },
  gamushara: { name: 'モリモ · 코토네 NIA 압축 덱', url: 'https://note.com/waterweed/n/n5cff81c88896' },
  kotone: { name: '九龍 · 세계 제일 귀여운 나', url: 'https://note.com/kuryucrew/n/n8dd01355c0ad' },
  saki: { name: '九龍 · Fighting My Way', url: 'https://note.com/kuryucrew/n/nd785e2db6c48' },
  sakiScopes: { name: '九龍 · 사키 사양별 난이도 비교', url: 'https://note.com/kuryucrew/n/na432bcec93dd' },
  legendDeck: { name: 'Game8 · 하지메 레전드 시험 덱', url: 'https://game8.jp/gakuen-idolmaster/752651' },
  mao: { name: '와세다 아이마스 연구회 · 레전드 마오', url: 'https://note.com/wasedaimas/n/n1280f6e7c705' },
  kit: { name: '공개 카드 효과 정의', url: 'https://github.com/gakumas-tools/gakumas-tools' },
};

export const scopes = {
  hif: '일반 HIF', 'hajime-regular': '하지메 레귤러', 'hajime-pro': '하지메 프로',
  'hajime-master': '하지메 마스터', 'hajime-legend': '하지메 레전드',
  'nia-pro': 'NIA 프로', 'nia-master': 'NIA 마스터',
};

const reviews = new Map();
// The four labels describe produce recommendations. A result from one player's run is a case, not a tier.
function review(scopes, goal, ids, rank, reason, source, options = {}) {
  for (const scope of scopes.split(' ')) for (const id of ids.split(' ')) {
    const key = scope + '/' + goal + '/i_card-' + id, prior = reviews.get(key);
    const sources = [...new Set([...(options.sources ?? [source]), ...(prior?.sources ?? [])])];
    reviews.set(key, { ...prior, rank, reason, ...options, sources });
  }
}

// All eligible, identity-matched entries in the November HIF score review. The app
// groups adjacent source tiers and orders ties by name. Keep future IDs unrated.
const hifScoreGroups = [
  ['SS', 'priority', [
    'hmsz-3-018 kcna-3-019 atbm-3-015 jsna-3-017 hski-3-018 shro-3-018 hrnm-3-017 hmsz-3-016',
    'fktn-3-013 shro-3-012 jsna-3-002',
  ].join(' ')],
  ['S+', 'recommended', [
    'kllj-3-022 hmsz-3-020 atbm-3-018 hrnm-3-018 kllj-3-018 hski-3-017 ttmr-3-016 kcna-3-014',
    'ssmk-3-012',
  ].join(' ')],
  ['S', 'recommended', [
    'shro-3-022 ttmr-3-021 ttmr-3-018 hume-3-017 hume-3-016 jsna-3-015 shro-3-016 kcna-3-016',
    'kllj-3-015 amao-3-015 hmsz-3-005 fktn-3-011 ssmk-3-007 kllj-3-006 shro-3-007 amao-3-007',
    'hrnm-3-002',
  ].join(' ')],
  ['A', 'conditional', [
    'jsna-3-021 fktn-3-019 kllj-3-017 jsna-3-016 hmsz-3-014 atbm-3-012 hume-3-009 atbm-3-000',
    'ttmr-3-015 fktn-3-016 hrnm-3-013 amao-3-013 hmsz-3-010 hume-3-012 ttmr-3-011 hski-3-012',
    'ssmk-3-010 amao-3-009 hume-3-006 kcna-3-007 hrnm-3-007 fktn-3-007',
  ].join(' ')],
  ['B', 'lower', [
    'hski-3-022 ssmk-3-018 amao-3-018 hume-3-018 hski-3-019 amao-3-017 ssmk-3-017 hski-3-015',
    'shro-3-014 jsna-3-011 kllj-3-012 kcna-3-012 hmsz-3-000 jsna-3-006 hski-3-011 ttmr-3-009',
    'kcna-3-009 jsna-3-003 shro-3-008 hrnm-3-008 ttmr-3-007 hski-3-008 kllj-3-005 hume-3-005',
    'kcna-3-005 hrnm-3-004 kcna-3-001 fktn-3-002 hrnm-3-001 hume-3-000 kcna-3-000 kllj-3-000',
    'fktn-3-000 ttmr-3-000 hski-3-000',
  ].join(' ')],
  ['C', 'lower', [
    'hume-3-022 kcna-3-018 jsna-3-020 hmsz-3-015 ssmk-3-014 hrnm-3-012 kllj-3-010 kllj-3-008',
    'ssmk-3-002 fktn-3-006 jsna-3-000 hski-3-006 shro-3-002 kcna-3-002 ttmr-3-002 amao-3-002',
    'hski-3-002 kllj-3-001 shro-3-001 amao-3-001 ssmk-3-001 hski-3-001 fktn-3-001 ttmr-3-001',
    'hrnm-3-000 shro-3-000 ssmk-3-000 amao-3-000',
  ].join(' ')],
  ['E', 'lower', [
    'hrnm-2-000 hume-2-000 hmsz-2-000 jsna-2-000 shro-2-000 ssmk-2-000 kcna-2-000 kllj-2-000',
    'amao-2-000 atbm-2-000 fktn-2-000 ttmr-2-000 hski-2-000',
  ].join(' ')],
  ['F', 'lower', [
    'hrnm-1-001 hume-1-001 hmsz-1-001 jsna-1-001 shro-1-001 ssmk-1-001 kcna-1-001 kllj-1-001',
    'amao-1-001 fktn-1-001 ttmr-1-001 hski-1-001 hrnm-1-000 hume-1-000 hmsz-1-000 jsna-1-000',
    'shro-1-000 ssmk-1-000 kcna-1-000 kllj-1-000 amao-1-000 atbm-1-000 fktn-1-000 ttmr-1-000',
    'hski-1-000',
  ].join(' ')],
];
const hifScoreReasons = {
  priority: '작성자가 HIF 본선 고득점을 노릴 때 가장 먼저 고려한 사양입니다. 준비한 덱과 보너스에 따라 도달 점수가 달라집니다.',
  recommended: '주력 스킬·서포트를 갖춘 해당 플랜에서 높은 점수를 노릴 수 있다고 평가한 사양입니다.',
  conditional: '가지고 있는 스킬과 서포트가 이 사양에 맞을 때 상위 점수를 노리는 후보입니다.',
  lower: '작성자의 HIF 고득점 비교에서는 우선순위가 낮습니다. 보유 스킬과 서포트가 잘 맞는 경우에 비교하세요.',
};
for (const [sourceTier, rank, ids] of hifScoreGroups) {
  review('hif', 'score', ids, rank, hifScoreReasons[rank], 'hifTier', { sourceTier });
}

review('hif', 'score', 'hrnm-3-017', 'priority', '재연으로 체력을 회복하고 두 번째 고유 카드로 남은 체력과 누적 사용 장수를 득점에 씁니다. 본선 고득점 공략에서 최상위로 평가했습니다.', 'game8');
review('hif', 'clear', 'hrnm-3-017', 'priority', '회복과 득점을 고유 카드 두 장으로 해결할 수 있어, 작성자가 낮은 PLv에서도 조작이 쉬운 카드로 꼽았습니다.', 'game8');
review('hif', 'score', 'kcna-3-019', 'priority', '전력 턴에 보류한 주력 카드를 다시 손으로 가져와 추가 행동으로 한 번 더 사용합니다. 원문 HIF 고득점 평가 SS.', 'china');
review('hif', 'clear', 'kcna-3-019', 'conditional', '보류 카드 회수는 쉽지만 반복 사용의 체력 비용이 큽니다. 고유 카드 강화와 소비 감소 수단을 확인하세요. 체력이 부족하면 반복 횟수를 줄이세요.', 'china');
review('hif', 'score', 'hmsz-3-016 fktn-3-013 shro-3-012 jsna-3-002 atbm-3-015 hski-3-018 shro-3-018 jsna-3-017', 'priority', '작성자가 게임 내 순위와 운용 경험을 비교해 HIF 고득점 상위권(원문 SS)으로 분류한 사양입니다.', 'hifTier');
review('hif', 'score', 'ssmk-3-012 kllj-3-018 ttmr-3-016 kcna-3-014', 'recommended', '고유 카드와 P아이템의 연계가 강한 사양입니다. 작성자는 주력 스킬과 서포트가 갖춰졌을 때 상위권에 접근하는 그룹(원문 S+)에 두었습니다.', 'hifTier');
review('hif', 'score', 'amao-3-000 shro-3-000 hrnm-3-012', 'lower', 'HIF 고득점을 위해 덱과 서포트를 더 갖춰야 하는 그룹(원문 C)에 속합니다.', 'hifTier');
review('hif', 'score', 'kllj-3-015 amao-3-015 hume-3-016 ssmk-3-007', 'recommended', '작성자는 해당 플랜의 주력 덱을 갖출 때 고득점을 노릴 수 있는 그룹(원문 S)에 이 사양을 넣었습니다.', 'hifTier');
review('hif', 'clear', 'amao-3-000', 'case', 'miso는 각광(脚光)과 국민적 아이돌을 축으로 본선을 클리어했습니다. 각광을 사용하는 원문의 권장 PLv는 75입니다.', 'spotlight', { minPlv: 75 });
review('hif', 'clear', 'jsna-3-017', 'priority', '고유 아이템이 두 턴을 늘려 줍니다. 호인상을 모아 쓰는 데 집중하면 되므로 운용이 쉽다는 평가입니다.', 'hifTier');
review('hif', 'clear', 'kllj-3-018', 'priority', '두 고유 카드로 의욕과 기운을 모은 뒤 마지막 턴에 닿아라!로 득점합니다. 의욕형의 기본 순서를 그대로 따르기 쉽습니다.', 'hifTier');
review('hif', 'clear', 'shro-3-018', 'recommended', '시험 시작부터 고유 카드 두 장이 손에 들어옵니다. 고유 회복으로 체력을 80% 이상 유지하면 추가 행동을 잇기 쉽습니다.', 'hifTier');
review('hif', 'clear', 'hski-3-018', 'recommended', '마지막 세 턴은 강기로 턴을 끝내세요. 고유 공격이 자동으로 이어지므로 손패에서 공격을 매번 찾을 부담이 줄어듭니다.', 'hifTier');
review('hif', 'clear', 'hmsz-3-020', 'recommended', '버프를 비용으로 쓰는 카드를 반복하면 고유 아이템이 기운도 함께 올려 줍니다. 슈프레히코어처럼 반복할 수 있는 카드를 준비하세요.', 'hifTier');
review('hif', 'clear', 'kllj-3-022', 'conditional', '졸음을 유지하면서 호조를 쌓는 압축 덱입니다. 필요한 스킬과 HIF 어빌리티를 갖추기 전에는 다루기 어렵습니다.', 'hifTier');
review('hif', 'clear', 'hrnm-3-018', 'conditional', '액티브를 써서 강기로 간 뒤 고유 카드로 온존에 돌아옵니다. 이 순서를 반복해야 해 작성자는 운용 난도가 높다고 봤습니다.', 'hifTier');

// This source ranks the 123 SSR variants together for ordinary Hajime Legend.
// Retain its original tier even where two adjacent tiers share a recommendation.
const legendScoreGroups = [
  ['SS', 'priority', '레전드에서 가장 높은 그룹입니다. 중간시험부터 쓸 주력 카드와 최종시험의 득점 순서를 준비하세요.', [
    'atbm-3-015 kcna-3-019 hmsz-3-018 jsna-3-017 hski-3-018 hrnm-3-018 shro-3-018 hrnm-3-017 ttmr-3-018',
    'hski-3-017 hume-3-016 jsna-3-015 shro-3-016 kcna-3-016 atbm-3-012 amao-3-015 kcna-3-014 ttmr-3-015',
    'fktn-3-016 shro-3-012 ssmk-3-007 hume-3-006 shro-3-007 kcna-3-007 jsna-3-002 fktn-3-007',
  ].join(' ')],
  ['S', 'recommended', '레전드의 상위 그룹입니다. 해당 플랜의 득점 카드를 갖췄을 때 우선 검토하세요.', [
    'shro-3-022 hmsz-3-020 ttmr-3-021 atbm-3-018 hume-3-018 fktn-3-019 kllj-3-018 hmsz-3-016 hume-3-017',
    'jsna-3-016 ttmr-3-016 hmsz-3-014 kllj-3-015 hume-3-009 shro-3-014 fktn-3-013 hmsz-3-010 hume-3-012',
    'hmsz-3-005 fktn-3-011 ttmr-3-011 kllj-3-006 amao-3-007 hski-3-008 hski-3-000 fktn-3-000',
  ].join(' ')],
  ['A', 'recommended', '레전드에서 주력 덱을 맞춰 활용할 수 있는 그룹입니다.', [
    'hkne-3-000 jsna-3-021 kllj-3-022 ssmk-3-017 kllj-3-017 hmsz-3-015 atbm-3-000 hrnm-3-013 amao-3-013',
    'jsna-3-011 ssmk-3-012 kllj-3-012 kcna-3-012 hmsz-3-000 hski-3-012 jsna-3-006 hski-3-011 ssmk-3-010',
    'kllj-3-008 amao-3-009 kcna-3-009 jsna-3-003 hrnm-3-008 hrnm-3-007 ttmr-3-007 hume-3-005 jsna-3-000',
    'hski-3-006 hume-3-000 kcna-3-000',
  ].join(' ')],
  ['B', 'conditional', '레전드 최종시험에서 점수를 더 올리려면 현재 덱이 이 사양의 득점 조건을 채우는지 확인하세요.', [
    'hski-3-022 jsna-3-020 amao-3-017 hski-3-015 ttmr-3-009 shro-3-008 ssmk-3-002 kllj-3-005 fktn-3-006',
    'hrnm-3-002 shro-3-002 ttmr-3-002 amao-3-002 kcna-3-005 hrnm-3-004 kcna-3-001 fktn-3-002 hski-3-002',
    'hrnm-3-001 ssmk-3-001 hski-3-001 fktn-3-001 ttmr-3-000 kllj-3-000 shro-3-000 hrnm-3-000',
  ].join(' ')],
  ['C', 'lower', '레전드 비교에서 고득점 우선순위가 낮은 그룹입니다.', [
    'hume-3-022 ssmk-3-018 amao-3-018 kcna-3-018 hski-3-019 ssmk-3-014 hrnm-3-012 kllj-3-010 kcna-3-002',
    'kllj-3-001 shro-3-001 amao-3-001 ttmr-3-001 amao-3-000 ssmk-3-000',
  ].join(' ')],
];
for (const [grade, rank, reason, ids] of legendScoreGroups) {
  review('hajime-legend', 'score', ids, rank, reason, 'game8', { sourceTier: grade });
}

review('hajime-legend', 'score', 'hrnm-3-017', 'priority', '원문 레전드 평가 SS. 체력을 회복하며 후반에 두 번째 고유 카드로 득점하는 사양입니다.', 'game8');
review('hajime-legend', 'score', 'kcna-3-014 hume-3-016 shro-3-012 jsna-3-002', 'priority', '레전드용 SSR 비교에서 상위 그룹(원문 SS)에 듭니다. 중간시험과 최종시험에서 쓰는 덱을 함께 준비하세요.', 'game8');
review('hajime-legend', 'score', 'amao-3-015', 'priority', '원문 레전드 평가 SS. 완전무결을 선택하고 호조를 쌓은 다음 국민적 아이돌과 고유 카드를 연결해 집중을 올립니다. 후반에 P아이템을 발동한 뒤 공격합니다.', 'game8', { sources: ['game8', 'mao'] });
review('hajime-legend', 'score', 'hkne-3-000', 'recommended', '앞에서는 집중과 호조를 쌓고 후반에는 P아이템의 득점 보너스를 받습니다. 원문 레전드 평가 A.', 'game8');
review('hajime-legend', 'clear', 'hkne-3-000', 'conditional', '초반 화력이 낮아 집중·호조 준비 턴이 필요합니다. 후반에 쓸 공격을 남길 수 있을 때 선택하세요.', 'game8');
review('hajime-legend', 'score', 'hkne-2-000', 'lower', '호조·집중·절호조를 얻지만 마지막 두 턴에 붙는 고유 아이템 득점이 작습니다.', 'game8', { sourceTier: 'C' });

review('hajime-pro', 'clear', 'fktn-3-001 kcna-3-001', 'priority', '고유 효과로 절호조를 마련해 공격할 수 있습니다. 특히 초반에 절호조 카드를 구하기 어려울 때 유리합니다. 원문은 PLv 25 전후·특훈 3~4를 가정합니다.', 'first');
review('hajime-pro', 'clear', 'shro-3-000', 'priority', '고유 카드로 기운을 모으고 P아이템으로 득점합니다. 초반에 강한 마무리 카드를 따로 확보하기 어려울 때 쓰기 좋습니다. 원문은 PLv 25 전후·특훈 3~4 기준입니다.', 'first');
review('hajime-regular', 'clear', 'jsna-3-000', 'priority', '처음 고르는 SSR 중에서는 강기와 온존을 오가는 것만으로 공격 흐름을 배우기 쉬운 사양으로 소개됐습니다.', 'first');
review('hajime-regular', 'clear', 'kllj-3-000', 'lower', '낮은 PLv에서는 쌓은 호인상을 점수로 바꿀 카드가 적어 P아이템 발동까지 챙기기 어렵습니다.', 'first');
review('hajime-pro', 'clear', 'ssmk-3-002 hume-3-009 jsna-3-000', 'recommended', '고유 카드 자체를 시험의 공격 수단으로 쓸 수 있습니다. 원문의 초반 상시·배포 카드 비교는 PLv 25 전후·특훈 3~4 기준입니다.', 'first');
review('hajime-pro', 'clear', 'hski-3-000', 'recommended', '고유 공격과 액티브 사용 시 한 번 받는 추가 행동으로 득점을 이을 수 있습니다. 호조를 유지하며 득점 턴을 나눠 쓰세요.', 'saki');
review('nia-pro', 'clear', 'hski-3-000', 'conditional', '사양별 후속 공략은 턴 추가 개조 전 C, 개조 후 A로 봤습니다. 특훈 7과 120 P포인트를 준비해야 합니다.', 'sakiScopes', { minTraining: 7 });
review('hajime-legend', 'clear', 'hski-3-000', 'lower', '고유 카드만으로는 시험 화력이 부족하다는 평가입니다. 턴 추가 개조를 해도 별도의 주력 공격이 필요합니다.', 'sakiScopes');
review('hajime-legend nia-pro', 'clear', 'hski-3-006', 'recommended', '먼저 호조를 쌓아 P아이템으로 집중을 얻고 고유 카드의 지속 득점을 남은 턴에 맞춰 사용합니다.', 'sakiScopes');
review('hajime-regular hajime-pro hajime-legend nia-pro', 'clear', 'hski-3-008', 'priority', '호조 4턴 이상에서 고유 공격을 쓰고, 가벼운 발걸음과 P아이템으로 행동을 보충합니다. 원저자의 미보유 효과 기반 평가입니다.', 'sakiScopes');
review('hajime-pro nia-pro', 'clear', 'fktn-3-000', 'recommended', '호인상 6 이상에서 고유 P아이템의 추가 행동을 받아 호인상을 더 쌓습니다. 체력을 확인하고 박수 같은 득점 카드를 사용하세요.', 'kotone');

review('hajime-master', 'clear', 'kcna-3-001 hrnm-3-012', 'priority', '고유 카드의 추가 행동으로 압축한 덱을 끊지 않고 다음 장까지 쓸 수 있습니다. 작성자는 고유 개조 없이 도는 경로에서 이 장점을 높게 봤습니다.', 'firstMaster');
review('hajime-master', 'clear', 'fktn-3-000', 'priority', '덱을 줄인 뒤 호인상 조건을 맞추면 P아이템이 사용 횟수를 한 번 늘려 줍니다. 주력 카드로 이어가기 쉽습니다.', 'firstMaster');
review('hajime-master', 'clear', 'kcna-3-014', 'conditional', '원문의 PLv 55 이하 센스 3장 순환에서는 고유 카드를 마지막까지 남기기 어렵습니다. PLv 61 센부리 소다로 드로우를 확보하면 평가가 올라갑니다.', 'firstMaster');

for (const [scope, source] of [['nia-pro', 'niaPro'], ['nia-master', 'niaMaster']]) {
  review(scope, 'clear', 'hrnm-3-012', 'priority', '고유 공격이 사용 횟수를 보충하고 P아이템이 체력 소비를 줄입니다. 오디션과 영업이 이어질 때 운영이 수월합니다.', source);
  review(scope, 'clear', 'ssmk-3-000', 'conditional', '특훈 7에서 고유 스킬을 지속 득점용으로 개조하는 경로입니다. 해당 개조를 선택할 수 있을 때 활용하세요.', source, { minTraining: 7 });
  review(scope, 'clear', 'kllj-3-015', 'conditional', '전력치가 원하는 시점에 지나치게 높아질 수 있습니다. 전력치와 고유 카드의 발동 시점을 관리할 수 있을 때 선택하세요.', source);
  review(scope, 'clear', 'hrnm-3-004', 'recommended', '기운과 의욕을 보충하면서 체력 부담을 낮출 수 있습니다. 체력이 모자라는 경로에서 안정적인 후보입니다.', source);
}
review('nia-master', 'clear', 'hski-3-015 jsna-3-000', 'priority', '사시이레로 덱을 늘리는 동안 체력 관리가 중요합니다. 작성자는 이 사양의 고유 효과가 체력 부담을 줄인다는 점을 높게 평가했습니다.', 'niaMaster');
review('nia-pro', 'clear', 'shro-3-000', 'recommended', '고유 효과로 시험 화력을 확보합니다. 기운을 쌓은 다음 공격을 연결할 때 득점 카드 수급 부담이 줄어듭니다.', 'niaPro');
review('nia-master', 'score', 'ssmk-3-010 ttmr-3-011 kllj-3-006', 'priority', '센스 팽창 덱에서 고유 효과로 버프를 마련하고 카드 획득으로 팬을 늘립니다. 두 작성자의 2025년 6월 비교에서는 세 사양 모두 평가점 22,000을 넘겼습니다.', 'niaScore');
review('nia-master', 'score', 'jsna-3-002', 'conditional', '같은 2025년 6월 센스 팽창 덱 비교에서 벚꽃 스미카·아이리스 테마리·Campus 리리야보다 적합도가 낮았습니다. 차이는 이 경로에 한정됩니다.', 'niaScore');
review('hajime-pro', 'score', 'ssmk-3-001', 'case', '하지메 프로 초기 환경에서 휴식으로 댄스·비주얼을 올리는 편성으로 S+를 달성한 사례가 있습니다. 2025년 1월 회고에 실린 기록입니다.', 'firstScores');
review('hajime-master', 'score', 'fktn-3-002', 'case', '하지메 마스터 초기 드링크 편성으로 SS를 달성한 2024년 9월 기록이 있습니다.', 'firstScores');
review('hajime-master', 'score', 'kllj-3-000', 'case', '반짝이는 색종이를 포함한 호인상 순환 덱으로 SS를 달성한 2024년 12월 기록이 있습니다.', 'firstScores');
review('nia-pro', 'score', 'fktn-3-006', 'case', '초기 NIA에서 반짝이는 색종이 개조를 우선한 SS+ 사례입니다. 2025년 1월 공략은 PLv 57·특훈 6을 권장하며 2차 오디션 화력을 주의점으로 꼽았습니다.', 'winter');
review('nia-master', 'score', 'fktn-3-016', 'case', 'PLv 42에서 SSS를 달성한 2025년 10월 사례입니다. 외출과 기본 카드 삭제로 덱을 줄여, 존재감·슈프레히코어·고유 카드를 반복했습니다.', 'gamushara');

export function exactGoalReview(scope, goal, id) {
  return reviews.get(scope + '/' + goal + '/' + id);
}
