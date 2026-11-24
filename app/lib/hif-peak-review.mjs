// Post-calculation observations. These are displayed after the route and its
// score have been chosen and do not participate in readiness or sorting.
const openReviews={
  'i_card-jsna-3-002':{
    reason:'팬 서비스로 연장한 턴에 낸 공격 효율을 같은 조건의 실전 기록과 대조 중입니다.',
    url:'https://sakigames.jp/gakuen-idolmaster/p-idol/campus-mode-juuousena/'},
  'i_card-ttmr-3-011':{
    reason:'카드를 제외해 쌓은 호조를 마무리 공격으로 환산하는 효율에서 큰 순위 차이가 남았습니다.',
    url:'https://sakigames.jp/gakuen-idolmaster/p-idol/ameagarinoairisu-tsukimuratemari/'},
  'i_card-kllj-3-015':{
    reason:'턴 종료 시 전력 10 이상을 맞춰 보류와 다음 턴 전력을 반복해서 얻는 효율을 대조 중입니다.',
    url:'https://sakigames.jp/gakuen-idolmaster/p-idol/atmosphere-katsuragiririya/'},
};
export function openHifPeakReview(id) {
  return openReviews[id]??null;
}
