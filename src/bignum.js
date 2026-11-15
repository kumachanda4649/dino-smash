// 版3.5：『見える数字だけ』を大きくする（ダメージ表示と体力の数字）。
// ゲームの計算・バランス・当たり・保存・遊びの記録・試験の数値は元の値のまま。変えるのは、画面に描く数字だけ。
// 倍率はここ1か所（既定は DISPLAY_SCALE）。オプション『数字の大きさ』（そのまま＝1／×100）で切り替える。
export const DISPLAY_SCALE = 100;

let scale = DISPLAY_SCALE;

/** いまの表示倍率（1 か DISPLAY_SCALE）。 */
export function getNumScale() { return scale; }
/** 表示倍率を決める（1 のときは元の数字）。変な値は既定に直す。 */
export function setNumScale(n) { scale = Number(n) === 1 ? 1 : DISPLAY_SCALE; return scale; }

/** 3桁ごとにカンマを入れる（整数）。 */
export function commas(n) {
  const v = Math.trunc(n);
  if (!Number.isFinite(v) || Math.abs(v) >= 1e15) return v.toLocaleString('en-US');      // 特別な値・桁が多すぎる値は従来どおり
  if (v === 0) return Object.is(v, -0) ? '-0' : '0';
  const s = String(Math.abs(v));      // 毎フレーム呼ばれる（体力・得点・ダメージ）ので、toLocaleString より速い手書き（2026-10-25。結果は同じ）
  let out = '';
  for (let i = s.length; i > 0; i -= 3) out = (i - 3 > 0 ? ',' : '') + s.slice(Math.max(0, i - 3), i) + out;
  return v < 0 ? '-' + out : out;
}

/** 元の値 v を、画面に出す整数にする。小数は四捨五入せず、元の値×倍率をそのまま整数にする（切り捨て）。0 より大きい値が 0 に見えないよう、最低 1。 */
export function dispInt(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  if (scale === 1) return Math.trunc(x);
  const r = Math.floor(x * scale + 1e-6);      // 12.34×100 が 1233.99… にならないよう、わずかに足してから切る
  return x > 0 ? Math.max(1, r) : r;
}

/** ダメージ表示用の文字（例 '2,200'）。v は元のダメージ。 */
export function dispDamage(v) { return commas(dispInt(v)); }

/** 体力の数字（現在値）。元の表示は切り上げ（Math.ceil）なので、倍率 1 のときは同じ。 */
export function dispHp(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return commas(0);
  if (scale === 1) return commas(Math.ceil(x));
  return commas(dispInt(x));
}
/** 体力の最大値。 */
export function dispMaxHp(v) { return dispHp(v); }
