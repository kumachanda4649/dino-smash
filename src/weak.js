// ボスの部位別ダメージ（2026-11-02 Nao「ティタノサウルスは頭以外のダメージを2分の1。他のボスも弱点とそうでない場所でダメージの入り方を変える」）。
// 描画なし・DOM に触れない。
//
//  ■ 仕組み：当たった所（接点）の体のマス → 部位 → 倍率。部位は手で当たりの箱を描かず、
//     「待機の先頭コマの体のマスク」を、外枠に対する割合（0〜1）で描いた多角形で部位に塗り分けたもの（下の WEAK）から決める。
//     待機以外のコマ（噛みつきで頭が突き出す・尾を振る…）は、そのマスの中心にいちばん近い待機のマスの部位を引き継ぐ
//     （首を伸ばした頭は頭のまま）。割合で描くので、原画のマスク・ドット絵版のマスクのどちらでも同じ部位になる。
//  ■ 倍率 m：その部位に当たったダメージにかける倍率。weak:true の部位は「弱点」で、当たると数字が大きく色が変わる（world.js）。
//  ■ マスクの無い技・箱だけで当たる攻撃は部位が分からないので倍率 1（world.js 側）。
import { bodyRects } from './shape.js';

const P = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];      // 長方形（割合）

/**
 * 部位表。base＝どの部位にも入らない所（既定の部位）。zones は上から順に最初に当たった部位。
 * 座標 [fx, fy]＝待機の先頭コマの体の外枠に対する割合（左上が 0,0・絵の向きのまま。スケルトンだけ絵が右向き）。
 * 倍率は実在の特徴に立脚（恐竜の絵は復元イメージ）：ティタノ＝頭が小さく的、首から後ろは分厚い皮と筋肉の巨体（Nao 指定 頭 1.0・それ以外 0.5）。
 */
export const WEAK = {
  Titanosaurus: {
    note: '頭だけが急所。首から後ろの巨体は分厚く、半分しか入らない（Nao 指定）',
    base: { name: '胴・首・脚・尾', m: 0.5 },
    zones: [
      { name: '頭', m: 1.0, weak: true, poly: P(0, 0, 0.12, 0.16) },
    ],
  },
  SkeletonRex: {
    note: '骨だけの体。頭蓋骨を砕くと効く。脚の細い骨は折れやすい。あばら骨は隙間だらけで衝撃が逃げる',
    base: { name: '尾', m: 0.8 },
    zones: [
      { name: '頭蓋骨', m: 1.2, weak: true, poly: P(0.76, 0, 1, 0.52) },
      { name: '脚の骨', m: 1.0, poly: P(0.22, 0.66, 0.78, 1) },
      { name: 'あばら・背骨', m: 0.7, poly: P(0.36, 0, 0.78, 0.66) },
    ],
  },
  Tyrannosaurus: {
    note: 'ティラノ。巨大な頭（強い顎）が急所。分厚い胴・太い脚・長い尾は効きにくい',
    base: { name: '尾', m: 0.65 },
    zones: [
      { name: '頭', m: 1.15, weak: true, poly: P(0, 0.05, 0.2, 0.55) },
      { name: '脚', m: 0.85, poly: P(0.22, 0.62, 0.55, 1) },
      { name: '胴・小さな腕', m: 0.75, poly: P(0.2, 0, 0.55, 0.62) },
    ],
  },
  Giganotosaurus: {
    note: 'ギガノト。細長い頭は的が小さい代わり、首の付け根〜のど元〜胸が急所。尾・脚は効きにくい',
    base: { name: '尾', m: 0.6 },
    zones: [
      { name: '首・胸（のど元）', m: 1.2, weak: true, poly: P(0.14, 0, 0.38, 0.7) },
      { name: '頭', m: 1.0, poly: P(0, 0, 0.14, 0.55) },
      { name: '脚', m: 0.7, poly: P(0.38, 0.55, 0.62, 1) },
      { name: '胴', m: 0.8, poly: P(0.38, 0, 0.62, 0.55) },
    ],
  },
  Quetzalcoatlus: {
    note: 'ケツァル。細く長いくちばしと頭が急所。翼の膜は薄く、胴・脚は軽くて柔らかい',
    base: { name: '胴', m: 0.75 },
    zones: [
      { name: '頭・くちばし', m: 1.2, weak: true, poly: P(0, 0, 0.42, 0.34) },
      { name: '翼', m: 1.0, poly: P(0, 0.34, 0.38, 0.7) },
      { name: '翼', m: 1.0, poly: P(0.62, 0, 1, 0.72) },
      { name: '脚', m: 0.75, poly: P(0.3, 0.72, 0.7, 1) },
    ],
  },
  SpinosaurusBoss: {
    note: 'スピノ四天王。背びれ（血管が通る帆）が急所。頭は 1.0。胴・脚・尾は筋肉質で効きにくい',
    base: { name: '尾', m: 0.75 },
    zones: [
      { name: '背びれ', m: 1.2, weak: true, poly: P(0.28, 0, 0.66, 0.4) },
      { name: '頭', m: 1.0, poly: P(0, 0.05, 0.2, 0.52) },
      { name: '脚', m: 0.7, poly: P(0.2, 0.68, 0.62, 1) },
      { name: '胴', m: 0.7, poly: P(0.2, 0.3, 0.62, 0.68) },
    ],
  },
  Mosasaurus: {
    note: 'モササウルス。長い口先と下あご・のどが急所。背中は硬いうろこ、ひれと尾は効きにくい',
    base: { name: '胴（うろこ）', m: 0.65 },
    zones: [
      { name: '頭・口先', m: 1.2, weak: true, poly: P(0, 0, 0.42, 0.5) },
      { name: '前ひれ', m: 0.8, poly: P(0.4, 0.55, 0.62, 1) },
      { name: '尾びれ', m: 0.7, poly: P(0.76, 0.35, 1, 1) },
    ],
  },
  SpinoRival: {
    note: 'ライバル（スピノ）。頭が急所。背びれは 0.9、胴・脚・尾は 0.7〜0.8（主人公と同じ体つきの対等な相手なので差は控えめ）',
    base: { name: '尾', m: 0.8 },
    zones: [
      { name: '頭', m: 1.1, weak: true, poly: P(0, 0.05, 0.2, 0.52) },
      { name: '背びれ', m: 0.9, poly: P(0.28, 0, 0.66, 0.4) },
      { name: '脚', m: 0.7, poly: P(0.2, 0.68, 0.62, 1) },
      { name: '胴', m: 0.8, poly: P(0.2, 0.3, 0.62, 0.68) },
    ],
  },
};

const inPoly = (x, y, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/** 待機のどのマスからも FAR マスより離れた所（尻尾の大振りの先・残像など）は、部位が分からないので base 扱い（尻尾の振りが頭の弱点にならない）。 */
const FAR = 8;
const idleCache = new Map(), zoneCache = new Map();
const KEY = (ix, iy) => (ix + 4000) * 8192 + (iy + 4000);

/** 待機の先頭コマの各マスを部位に塗り分けた格子（部位番号 0＝base・1〜＝zones の順）。マスの中心を g で割って丸めた座標が鍵。 */
function idleLabels(dm, dmKey, spec) {
  const ck = dmKey;
  let r = idleCache.get(ck);
  if (r) return r;
  const b = bodyRects(dm, 'Idle', 0);
  r = { g: 8, map: new Map(), n: 0 };
  if (b) {
    const g = b.g;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const c of b.rects) { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[2]); y1 = Math.max(y1, c[3]); }
    const w = x1 - x0, h = y1 - y0;
    r.g = g;
    for (const c of b.rects) {
      const cx = (c[0] + c[2]) / 2, cy = (c[1] + c[3]) / 2, fx = (cx - x0) / w, fy = (cy - y0) / h;
      let z = 0;
      for (let k = 0; k < spec.zones.length; k++) if (inPoly(fx, fy, spec.zones[k].poly)) { z = k + 1; break; }
      r.map.set(KEY(Math.round(cx / g), Math.round(cy / g)), z);
      r.n++;
    }
  }
  idleCache.set(ck, r);
  return r;
}

/** マス (cx,cy)（anchor・ground 基準の相対）にいちばん近い待機のマスの部位番号（見つからなければ 0＝base）。 */
function nearestZone(lab, cx, cy, far) {
  const ix = Math.round(cx / lab.g), iy = Math.round(cy / lab.g);
  for (let rad = 0; rad <= far; rad++) {
    let best = -1, bd = 1e9;
    for (let a = -rad; a <= rad; a++) for (let c = -rad; c <= rad; c++) {
      if (Math.max(Math.abs(a), Math.abs(c)) !== rad) continue;
      const v = lab.map.get(KEY(ix + a, iy + c));
      if (v !== undefined) { const d = a * a + c * c; if (d < bd) { bd = d; best = v; } }
    }
    if (best >= 0) return best;
  }
  return 0;
}

/** そのコマの体のマス（bodyRects と同じ順）ごとの部位番号の配列（Uint8Array）。部位表の無い種・マスクの無いコマは null。 */
export function zonesOfFrame(dm, dmKey, type, motion, frame) {
  const spec = WEAK[type];
  if (!spec) return null;
  const k = `${dmKey}|${motion}|${frame}`;
  if (zoneCache.has(k)) return zoneCache.get(k);
  const b = bodyRects(dm, motion, frame);
  let out = null;
  if (b) {
    const lab = idleLabels(dm, dmKey, spec);
    out = new Uint8Array(b.rects.length);
    for (let i = 0; i < b.rects.length; i++) {
      const c = b.rects[i];
      out[i] = nearestZone(lab, (c[0] + c[2]) / 2, (c[1] + c[3]) / 2, spec.far || FAR);
    }
  }
  zoneCache.set(k, out);
  return out;
}

/** 部位番号 → { name, m, weak }（0＝base）。 */
export function zoneInfo(type, z) {
  const spec = WEAK[type];
  if (!spec) return null;
  if (!z) return { name: spec.base.name, m: spec.base.m, weak: false };
  const q = spec.zones[z - 1];
  return { name: q.name, m: q.m, weak: !!q.weak };
}

/** 種ごとの部位表の覚え書き（検査・ドキュメント用）。 */
export const weakTypes = () => Object.keys(WEAK);
