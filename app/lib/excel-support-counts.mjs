// The supplied workbook contains cached NIA/初 route assumptions, not HIF
// observations. Only counters with an exact native support-ability counterpart
// are connected here; item-only exam counts and unknown deck conditions stay out.
const labels = {
  class_work_end: ['授業'], consult: ['相談'], outing: ['お出かけ'], rest: ['休む'],
  activity_supply_gift: ['活動支給/差し入れ'], special_training: ['特別指導'], exam_end: ['試験終了時'],
  skill_acquire: ['スキル獲得'], a_skill_acquire: ['Aスキル獲得'], m_skill_acquire: ['Mスキル獲得'],
  ssr_card_acquire: ['SSRカード獲得'], vitality_card_acquire: ['元気カード獲得'],
  good_condition_card_acquire: ['好調カード獲得'], concentration_card_acquire: ['集中カード獲得'],
  good_impression_card_acquire: ['好印象カード獲得'], motivation_card_acquire: ['やる気カード獲得'],
  reserve_card_acquire: ['温存カード獲得'], skill_enhance: ['スキル強化'],
  a_skill_enhance: ['Aスキル強化'], m_skill_enhance: ['Mスキル強化'],
  delete: ['削除'], a_skill_delete: ['Aスキル削除'], m_skill_delete: ['Mスキル削除'],
  change: ['変換', 'チェンジ'], p_drink_exchange: ['Pドリンク交換'], p_drink_acquire: ['Pドリンク獲得'],
  p_item_acquire: ['Pアイテム獲得'], customize: ['カスタマイズ'], sp_lesson_20: ['SPレッスン（20枚）'],
};

const countValue = input => (typeof input === 'number' || typeof input === 'string' && input.trim() !== '')
  && Number.isFinite(Number(input)) && Number(input) >= 0 ? Number(input) : null;

export function niaPresetScope(name) {
  const plan = {センス:'sense',ロジック:'logic',アノマリー:'anomaly'}[name.split('：').at(-1)] ?? null;
  return {difficulty:name.includes('マスター')?'master':null, plan};
}

export function eligibleNiaPresets(catalog,difficulty,plan) {
  return (catalog.excelPresets??[]).filter(row=>{
    if(!row.name.startsWith('NIA'))return false;
    const scope=niaPresetScope(row.name);
    return (!scope.difficulty||difficulty===scope.difficulty)&&(!scope.plan||plan===scope.plan);
  }).map(row=>row.name);
}

/** Read cached scenario counters without turning missing/未実装 into zero. */
export function resolveExcelSupportCounts(catalog, { scenario, routePreset } = {}) {
  if (scenario !== 'nia') return { preset: null, counts: {}, unconfirmed: [], source: { status: 'not_applicable', scenario } };
  const requested = routePreset === undefined ? 'NIA 通常' : routePreset;
  if (typeof requested !== 'string' || !requested.startsWith('NIA')) throw new RangeError('routePreset must be an NIA preset');
  const preset = (catalog.excelPresets ?? []).find(row => row.name === requested);
  if (!preset && routePreset !== undefined) throw new RangeError('No such routePreset in the supplied Excel reference');
  if (!preset) return { preset: null, counts: {}, unconfirmed: [], source: { status: 'preset_missing', name: requested } };
  const counts = {}, unconfirmed = [], cells = {};
  for (const [kind, names] of Object.entries(labels)) {
    const rows = (preset.values ?? []).filter(row => names.includes(row.label));
    const values = rows.map(row => countValue(row.value));
    if (rows.length && values.every(value => value !== null) && values.every(value => value === values[0])) {
      counts[kind] = values[0];
      cells[kind] = rows.map(row => ({ label: row.label, sourceCell: row.sourceCell ?? null }));
    } else unconfirmed.push({ kind, labels: names, reason: !rows.length ? 'missing' : values.includes(null) ? 'not_numeric' : 'conflicting_values' });
  }
  return { preset, counts, unconfirmed, source: { status: 'user_excel_cached_reference', name: preset.name,
    sourceCell: preset.sourceCell ?? null, cells, recalculated: false, actualAccountActionsConfirmed: false,
    scope: 'NIA 원본 프리셋의 경로 가정. HIF·기간 이벤트에 자동 적용하지 않음.' } };
}
