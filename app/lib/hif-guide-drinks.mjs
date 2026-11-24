// Base ProduceDrink rows from the pinned master. The public ID resolves optional local artwork.
const rows = {
  "pdrink_00-1-001": ["img_general_pdrink_1-001","初星水","하츠보시 생수","free","R",0,"1"],
  "pdrink_00-1-004": ["img_general_pdrink_1-004","烏龍茶","우롱차","free","R",0,"2"],
  "pdrink_00-2-001": ["img_general_pdrink_2-001","ミックススムージー","믹스 스무디","free","SR",8,"9"],
  "pdrink_00-2-003": ["img_general_pdrink_2-003","リカバリドリンク","회복 드링크","free","SR",15,"10"],
  "pdrink_00-2-004": ["img_general_pdrink_2-004","フレッシュビネガー","프레시 칵테일","free","SR",0,"11"],
  "pdrink_00-2-008": ["img_general_pdrink_2-008","ブーストエキス","부스트 추출물","free","SR",55,"12"],
  "pdrink_00-2-009": ["img_general_pdrink_2-009","パワフル漢方ドリンク","파워풀 한방 드링크","free","SR",60,"13"],
  "pdrink_00-2-010": ["img_general_pdrink_2-010","センブリソーダ","센부리 소다","free","SR",61,"14"],
  "pdrink_00-3-001": ["img_general_pdrink_3-001","初星ホエイプロテイン","하츠보시 유청 프로틴","free","SSR",0,"18"],
  "pdrink_00-3-005": ["img_general_pdrink_3-005","初星スペシャル青汁","하츠보시 스페셜 녹즙","free","SSR",15,"19"],
  "pdrink_01-1-002": ["img_general_pdrink_1-002","ビタミンドリンク","비타민 드링크","sense","R",0,"3"],
  "pdrink_01-1-003": ["img_general_pdrink_1-003","アイスコーヒー","아이스 커피","sense","R",0,"4"],
  "pdrink_01-2-005": ["img_general_pdrink_2-005","スタミナ爆発ドリンク","스태미나 폭발 드링크","sense","SR",21,"15"],
  "pdrink_01-3-002": ["img_general_pdrink_3-002","厳選初星マキアート","엄선 하츠보시 마키아토","sense","SSR",27,"20"],
  "pdrink_01-3-004": ["img_general_pdrink_3-004","初星ブーストエナジー","하츠보시 부스트 에너지","sense","SSR",26,"21"],
  "pdrink_01-3-012": ["img_general_pdrink_3-012","初星黒酢","하츠보시 흑초","sense","SSR",61,"22"],
  "pdrink_02-1-006": ["img_general_pdrink_1-006","ルイボスティー","루이보스 티","logic","R",0,"5"],
  "pdrink_02-1-008": ["img_general_pdrink_1-008","ホットコーヒー","핫 커피","logic","R",0,"6"],
  "pdrink_02-2-006": ["img_general_pdrink_2-006","おしゃれハーブティー","고급 허브티","logic","SR",21,"16"],
  "pdrink_02-3-006": ["img_general_pdrink_3-006","厳選初星ティー","엄선 하츠보시 티","logic","SSR",27,"23"],
  "pdrink_02-3-007": ["img_general_pdrink_3-007","厳選初星ブレンド","엄선 하츠보시 블렌드","logic","SSR",26,"24"],
  "pdrink_02-3-010": ["img_general_pdrink_3-010","特製ハツボシエキス","특제 하츠보시 추출물","logic","SSR",55,"25"],
  "pdrink_03-1-009": ["img_general_pdrink_1-009","ジンジャーエール","진저 에일","anomaly","R",0,"7"],
  "pdrink_03-1-010": ["img_general_pdrink_1-010","ほうじ茶","호지차","anomaly","R",0,"8"],
  "pdrink_03-2-007": ["img_general_pdrink_2-007","ほっと緑茶","따뜻한 녹차","anomaly","SR",21,"17"],
  "pdrink_03-3-008": ["img_general_pdrink_3-008","厳選初星チャイ","엄선 하츠보시 차이","anomaly","SSR",27,"27"],
  "pdrink_03-3-009": ["img_general_pdrink_3-009","初星スーパーソーダ","하츠보시 슈퍼 소다","anomaly","SSR",26,"26"],
  "pdrink_03-3-011": ["img_general_pdrink_3-011","初星湯","하츠보시 차","anomaly","SSR",60,"28"],
};

export function hifGuideDrink(gameId, catalog) {
  const row = rows[gameId];
  if (!row) return null;
  const [imageId, nameJa, translated, plan, rarity, unlockProducerLevel, publicId] = row;
  const art = catalog.drinkVisuals?.drinks?.find(row => String(row.id) === publicId && row.nameJa === nameJa);
  return { gameId, imageId, imageIdSystem: "native_asset", publicId, nameJa, nameKo: art?.nameKo ?? translated ?? nameJa,
    imageUrl: art?.thumbnailUrl ?? art?.imageUrl ?? null, plan, rarity, unlockProducerLevel };
}
