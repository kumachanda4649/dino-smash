// 怒りのオーラ（版2.4）。本編 RPG1 の DinoAngerGlow.js（PIXI のフィルタ）と同じ見た目を、Canvas 2D で再現する。
//   ・恐竜の絵そのもの（毎コマのアルファ）から光を作る：①輪郭の外側のにじみ（体の外側だけ） ②体の上側の縁から炎のように揺らめいて立ち上がる光。
//   ・シェーダーの式は本編と同じ（輪郭＝周りの平均／炎の舌＝真下を12点見て体があれば土台→ノイズを引く→ノイズを時間で上へ流す）。
//     違うのは CPU で解くこと：絵のアルファを粗い格子（0.35〜0.5 倍）に落として画素ごとに計算し、滑らかに拡大して「加算」で重ねる（ドット絵にはしない）。
//   ・体の中は塗らない。絵の後ろ（体の下の層）に足す。重さは auraStats に積む（試験が見る）。
import { AURA_PALETTES, AURA_COLOR, AURA_LEVEL, AURA_LEVEL_OF, AURA_REF_H, AURA_BLEND } from './rage.js';

export const auraStats = { reused: 0, frames: 0, ms: 0, maxMs: 0, cells: 0, ph: [0, 0, 0, 0, 0] };      // ph＝段階ごとの累計 ms（絵を写す／格子へ落とす／ぼかし／画素の計算／重ねる）

// ---- 小さい値ノイズ（本編の h21 / vn の代わり。表引き）----
const NT = 256;
const NTAB = new Float32Array(NT * NT);
{ let a = 12345; for (let i = 0; i < NTAB.length; i++) { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; NTAB[i] = a / 4294967296; } }
const h2 = (ix, iy) => NTAB[((iy & 255) << 8) | (ix & 255)];
function vn(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- 作業用の入れ物（大きくなるときだけ作り直す）----
let SC = null, MC = null;
const CACHE = new Map();      // 敵ごとの前回の結果（1コマおきに計算して、間のコマは前回の光を使う＝炎は 30fps で揺らめく）
/** 2026-11-15：作り置きを持つ敵の数（新しく使った順）。0 で直す前（上限なし＝検査の陰性対照） */
export const AURA_CACHE = { max: 16 };
/** 試験用：いま作り置きを持っている敵の数 */
export const auraCacheSize = () => CACHE.size;
const BUF = { A: null, T1: null, T2: null, WIDE: null, RIM: null };
function ensure(rw, rh, gw, gh) {
  if (!SC) { SC = document.createElement('canvas'); MC = document.createElement('canvas'); }
  if (SC.width !== rw || SC.height !== rh) { SC.width = rw; SC.height = rh; SC._ctx = SC.getContext('2d', { willReadFrequently: true }); }
  if (MC.width !== gw || MC.height !== gh) { MC.width = gw; MC.height = gh; MC._ctx = MC.getContext('2d', { willReadFrequently: true }); }
  const n = gw * gh;
  if (!BUF.A || BUF.A.length < n) for (const k of Object.keys(BUF)) BUF[k] = new Float32Array(n);
}

/** 箱ぼかし（横→縦）を2回＝ガウスに近い。r は格子の半径。範囲 [xa..xb]×[ya..yb] の中だけ計算する（外は 0 のまま）。 */
function blur(src, dst, tmp, w, h, r, xa, xb, ya, yb) {
  r = Math.max(1, Math.round(r));
  const inv = 1 / (2 * r + 1);
  for (let pass = 0; pass < 2; pass++) {
    const s = pass === 0 ? src : dst;
    for (let y = ya; y <= yb; y++) {
      const o = y * w; let acc = 0;
      for (let x = xa - r; x <= xa + r; x++) acc += s[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = xa; x <= xb; x++) {
        tmp[o + x] = acc * inv;
        acc += s[o + Math.min(w - 1, x + r + 1)] - s[o + Math.max(0, x - r)];
      }
    }
    for (let x = xa; x <= xb; x++) {
      let acc = 0;
      for (let y = ya - r; y <= ya + r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = ya; y <= yb; y++) {
        dst[y * w + x] = acc * inv;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
}

/** 光を重ねる：まず色をそのまま（明るい背景でも色が出る）、その上に加算（光って見える）。 */
function blit(ctx, ent, x, y) {
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = AURA_BLEND.over;
  ctx.drawImage(ent.oc, 0, 0, ent.gw, ent.gh, x - ent.ox, y - ent.oy, ent.RW, ent.RH);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = AURA_BLEND.add;
  ctx.drawImage(ent.oc, 0, 0, ent.gw, ent.gh, x - ent.ox, y - ent.oy, ent.RW, ent.RH);
  ctx.restore();
}

/**
 * ctx の (x, y)（足元）に、怒りのオーラを加算で描く。
 *  drawBody(c, ox, oy)：作業キャンバス c の (ox, oy) に、いま描いているのと同じ絵を描く関数（絵の形＝アルファを取る）。
 *  opt: { bw, bh, time, boost(0〜1.5・演出中の燃え上がり), color(名前), level }
 */
export function drawAura(ctx, x, y, drawBody, opt) {
  const t0 = performance.now();
  let tp = t0; const lap = (i) => { const t = performance.now(); auraStats.ph[i] += t - tp; tp = t; };
  // 1コマおき：前回の光をそのまま、いまの位置に重ねる（体の絵は 15fps で変わるので、輪郭のずれは見えない）
  const key = opt.key ?? 0;
  let ent = CACHE.get(key);
  // 2026-11-15：新しく使った順に AURA_CACHE.max 体ぶんまで持つ（鍵は敵の番号＝面をまたいで増え続ける。前は消す道が無く、怒った敵・オーラ技を出した敵ごとに作業キャンバスが 1 枚ずつ残った）
  if (ent && AURA_CACHE.max > 0) { CACHE.delete(key); CACHE.set(key, ent); }
  if (!ent) {
    ent = { oc: document.createElement('canvas'), n: 0, valid: false }; ent.ctx = ent.oc.getContext('2d'); CACHE.set(key, ent);
    if (AURA_CACHE.max > 0) while (CACHE.size > AURA_CACHE.max) CACHE.delete(CACHE.keys().next().value);
  }
  ent.n++;
  if (ent.valid && ent.n % 2 === 0 && !opt.noCache) {
    blit(ctx, ent, x, y);
    auraStats.reused++;
    return;
  }
  const OC = ent.oc; OC._ctx = ent.ctx;
  const pal = AURA_PALETTES[opt.color] || AURA_PALETTES.blue;
  const lv = AURA_LEVEL[opt.level || AURA_LEVEL_OF.default];
  const k = Math.min(1.35, Math.max(0.9, opt.bh / 240 * (AURA_REF_H / 178)));
  const boost = opt.boost || 0;
  const R = lv.R * k, L = lv.L * k * (1.15 + 1.1 * boost), STR = Math.min(1.35, lv.STR * (1 + 0.3 * boost));
  const Lmax = lv.L * k * (1.15 + 1.1 * 1.5);      // 領域の大きさは最大の燃え上がりで決める（演出中も同じ大きさ＝輪郭の計算を使い回せる）
  const padSide = Math.ceil(R * 1.8 + Lmax * 0.35 + 14), padBot = Math.ceil(R * 1.8 + 10);
  const RW = Math.ceil(Math.max(opt.bw * 1.5, 320) + padSide * 2), padTop = Math.ceil(opt.bh * 1.25 + Lmax * 1.5 + 14);
  const RH = padTop + padBot;
  const G = Math.min(0.5, Math.sqrt(24000 / (RW * RH)));      // 格子の細かさ（総数 2.4 万まで）
  const gw = Math.max(8, Math.round(RW * G)), gh = Math.max(8, Math.round(RH * G));
  ensure(RW, RH, gw, gh);
  const ox = RW / 2, oy = padTop;
  const n = gw * gh;
  const rg = R * G;
  const swMax = Math.ceil(L * 0.2 * G) + 1, ringPad = Math.ceil(rg * 1.7) + 2;
  // 体の形（輪郭の計算）は、絵のコマ・向き・傾き・大きさが同じなら前回のものを使い回す（体の絵は 15fps でしか変わらない）
  const mk = `${opt.maskKey ?? ''}|${RW}|${RH}|${gw}|${gh}|${R.toFixed(1)}`;
  if (!(opt.maskKey !== undefined && ent.maskKey === mk && ent.A && ent.A.length === n)) {
    // ① 絵のアルファを取る
    const sg = SC._ctx;
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = 'source-over'; sg.globalAlpha = 1; sg.clearRect(0, 0, RW, RH);
    drawBody(sg, ox, oy);
    lap(0);
    const mg = MC._ctx;
    mg.setTransform(1, 0, 0, 1, 0, 0); mg.clearRect(0, 0, gw, gh);
    mg.imageSmoothingEnabled = true; mg.imageSmoothingQuality = 'low';
    mg.drawImage(SC, 0, 0, RW, RH, 0, 0, gw, gh);
    const id = mg.getImageData(0, 0, gw, gh).data;
    if (!ent.A || ent.A.length !== n) { ent.A = new Float32Array(n); ent.WIDE = new Float32Array(n); ent.RIM = new Float32Array(n); ent.RING = new Float32Array(n); }
    const A = ent.A;
    for (let i = 0; i < n; i++) A[i] = id[i * 4 + 3] / 255;
    lap(1);
    // ② 輪郭のにじみ：広い平均（soft）と狭い平均（tight）。体のある範囲（行・列）の中だけ計算する
    let r0 = gh, r1 = -1, c0 = gw, c1 = -1;
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) if (A[gy * gw + gx] > 0.04) { if (gy < r0) r0 = gy; if (gy > r1) r1 = gy; if (gx < c0) c0 = gx; if (gx > c1) c1 = gx; }
    if (r1 < 0) { r0 = 0; r1 = -1; c0 = 0; c1 = -1; }
    Object.assign(ent, { r0, r1, c0, c1 });
    const bx0 = Math.max(0, c0 - ringPad), bx1 = Math.min(gw - 1, c1 + ringPad), by0 = Math.max(0, r0 - ringPad), by1 = Math.min(gh - 1, r1 + ringPad);
    ent.WIDE.fill(0); ent.RIM.fill(0); BUF.T1.fill(0, 0, n); BUF.T2.fill(0, 0, n);
    if (r1 >= 0) {
      blur(A, ent.WIDE, BUF.T1, gw, gh, rg * 0.55, bx0, bx1, by0, by1);
      blur(A, ent.RIM, BUF.T2, gw, gh, rg * 0.25, bx0, bx1, by0, by1);
    }
    // 輪郭の光の強さ（体のアルファとは別に、位置ごとに決まる値）も、体の形が同じなら使い回す
    ent.RING.fill(0);
    for (let gy = by0; gy <= by1; gy++) for (let gx = bx0; gx <= bx1; gx++) {
      const i = gy * gw + gx, wv = ent.WIDE[i];
      if (wv > 0.002) ent.RING[i] = Math.pow(Math.min(1, wv * 2.2), 1.15) * 0.75 + Math.pow(Math.min(1, ent.RIM[i] * 1.6), 1.4) * 0.5;
    }
    ent.maskKey = mk;
    lap(2);
  }
  const A = ent.A, r0 = ent.r0, r1 = ent.r1, c0 = ent.c0, c1 = ent.c1;
  // ③ 炎の舌
  const T = opt.time, Lg = L * G, FL = lv.FL, FLK = lv.FLK;
  const flk = 1 + FLK * (vn(T * 6, 1.7) - 0.5) * 2;
  if (OC.width !== gw || OC.height !== gh) { OC.width = gw; OC.height = gh; }
  if (!OC._img || OC._img.width !== gw || OC._img.height !== gh) OC._img = OC._ctx.createImageData(gw, gh);
  const out = OC._img, od = out.data; od.fill(0);
  const C0 = pal.core, C1 = pal.mid, C2 = pal.tip;
  const inv = 1 / G;
  const ya = Math.max(0, r0 - Math.ceil(Lg * 1.25) - 1), yb = Math.min(gh - 1, r1 + ringPad);
  const xa = Math.max(0, c0 - ringPad - swMax), xb = Math.min(gw - 1, c1 + ringPad + swMax);
  const WIDE = ent.WIDE, RIM = ent.RIM;
  for (let gy = ya; gy <= yb; gy++) {
    const Py = gy * inv;
    const swayV = (vn(Py / (L * 0.9) + 3.0, T * 1.1) - 0.5) * L * 0.4 * G;
    const wob = Math.sin(Py / (L * 0.62) + T * 3.3) * L * 0.14 + Math.sin(Py / (L * 0.31) - T * 5.1) * L * 0.05;
    const qy = Py / (L * 0.42) + T * 1.9;
    for (let gx = xa; gx <= xb; gx++) {
      const i = gy * gw + gx;
      const a = A[i];
      if (a > 0.92) continue;                      // 体の中は塗らない
      const out_ = 1 - a;
      // 輪郭のにじみ
      const ring = ent.RING[i];
      // 炎の舌：真下を12点見て体を探し、近いほど強い土台にする。そこからノイズを引く＝先がギザギザの舌になる
      let base = 0;
      for (let s = 1; s <= 12; s++) {
        const tt = s / 12;
        const sx = Math.round(gx + swayV * tt), sy = Math.round(gy + Lg * 1.25 * tt);
        if (sx < 0 || sx >= gw || sy < 0 || sy >= gh) continue;
        const v = A[sy * gw + sx] * (1 - tt);
        if (v > base) base = v;
      }
      let iF = 0, v = -1;
      if (base > 0) {
        const qx = (gx * inv + wob) / (L * 0.21);
        const nz = 0.62 * vn(qx, qy) + 0.38 * vn(qx * 2.1 + 5.2, qy * 2.1 + T * 1.3);
        v = base - nz * 0.95 + 0.06;
        iF = Math.min(1, Math.max(0, smooth(0, 0.30, v) * FL * 0.92)) * out_;
      }
      const iR = Math.min(1, Math.max(0, ring * 0.85)) * out_;
      let inten = iR > iF ? iR : iF;
      if (inten < 0.004) continue;
      // 色：輪郭は芯寄り、炎は根元が本体色・先へ行くほど暗い
      const rt = smooth(0.35, 1.0, iR), ft = smooth(0.0, 0.5, v);
      const sum = iR + iF + 0.0001;
      const o = i * 4;
      for (let c = 0; c < 3; c++) {
        const colR = C1[c] + (C0[c] - C1[c]) * rt, colF = C2[c] + (C1[c] - C2[c]) * ft;
        od[o + c] = ((colR * iR + colF * iF) / sum) * 255;
      }
      inten = Math.min(1, Math.max(0, inten * flk));
      od[o + 3] = Math.min(1, inten * STR) * 255;
    }
  }
  OC._ctx.putImageData(out, 0, 0);
  lap(3);
  Object.assign(ent, { valid: true, gw, gh, RW, RH, ox, oy });
  blit(ctx, ent, x, y);
  lap(4);
  const dt = performance.now() - t0;
  auraStats.frames++; auraStats.ms += dt; auraStats.maxMs = Math.max(auraStats.maxMs, dt); auraStats.cells = n;
}

/** ボスの種類ごとの色の名前（色の表は rage.js の AURA_COLOR）。 */
export const auraColorOf = (type) => AURA_COLOR[type] || 'blue';
