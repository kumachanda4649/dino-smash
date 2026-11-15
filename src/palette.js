// ライバル（色違いのスピノサウルス）の色の置き換え。DOM に触れない純粋な関数（tools/rival_test.mjs が Node で試験する）。
// 定義は assets/rival_palette.json の1か所：source=主人公の24色、palettes.<名前>.colors=置き換え先の24色、adopted=採用する名前。
// 置き換えるのは不透明画素の色だけ（アルファ・位置は変えない＝形は主人公と同じ）。

const hexToRgb = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const pack = (r, g, b) => (r << 16) | (g << 8) | b;

/** 使う色の名前。want（URL の ?rivalcolor=）が表にあればそれ、無ければ adopted。 */
export function pickPalette(rp, want) {
  return want && rp.palettes[want] ? want : rp.adopted;
}

/** 24色の対応表 Map(元の色 → 新しい色)（どちらも 0xRRGGBB の整数）。 */
export function paletteMap(rp, name) {
  const pal = rp.palettes[name];
  if (!pal) throw new Error(`ライバルの色「${name}」が rival_palette.json に無い`);
  if (rp.source.length !== pal.colors.length) throw new Error(`色の数が違う（元 ${rp.source.length}・新 ${pal.colors.length}）`);
  const m = new Map();
  rp.source.forEach((s, i) => { const a = hexToRgb(s), b = hexToRgb(pal.colors[i]); m.set(pack(...a), pack(...b)); });
  return m;
}

/** RGBA の画素列（Uint8ClampedArray など）を、その場で置き換える。表に無い色の画素の数を返す（0 が正常）。 */
export function applyPaletteRGBA(data, map) {
  let unknown = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const to = map.get(pack(data[i], data[i + 1], data[i + 2]));
    if (to === undefined) { unknown++; continue; }
    data[i] = (to >> 16) & 255; data[i + 1] = (to >> 8) & 255; data[i + 2] = to & 255;
  }
  return unknown;
}

// ---- 版2.1：強い色違い（R 版）の色。表を持たず、画素の色を HSL で回す（色相 hue 度・彩度 sat 倍・明るさ light 倍）。同じ色は同じ結果（キャッシュ）。
const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const hslToRgb = (h, s, l) => {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
};
/** 1色（r,g,b）を tint で置き換えた [r,g,b]。 */
export function tintColor(r, g, b, tint) {
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToRgb(h + (tint.hue || 0), Math.min(1, s * (tint.sat ?? 1)), Math.min(1, l * (tint.light ?? 1)));
}
/** RGBA の画素列をその場で tint に置き換える（アルファ・位置は変えない）。置き換えた異なる色の数を返す。 */
export function applyTintRGBA(data, tint) {
  const cache = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let to = cache.get(key);
    if (to === undefined) { const c = tintColor(data[i], data[i + 1], data[i + 2], tint); to = (c[0] << 16) | (c[1] << 8) | c[2]; cache.set(key, to); }
    data[i] = (to >> 16) & 255; data[i + 1] = (to >> 8) & 255; data[i + 2] = to & 255;
  }
  return cache.size;
}
