// 絵の形に合わせた当たり判定（描画なし・DOM に触れない）。
//
//  ■ 体の判定（やられ判定）＝各恐竜・各モーション・各コマの絵の不透明画素から前処理で作ったマスク
//     （tools/build_motions.mjs → data/motions.json 等の motions[m].mask。8画素格子の占有を行ごとの連続区間で持つ）。
//  ■ 攻撃の判定＝技ごとの「当たる部位」（mouth 口 / claw 爪 / tail 尻尾 / foot 足 / body 体 / area 範囲＝技の表の箱）。
//     部位の場所は手で箱を描かず、そのコマのマスクから機械で拾う：
//       ・立ち姿（待機の先頭コマ）の外へ伸びた・動いたマス（ext）
//       ・技の向きの先端側のマス（front：いちばん前の端から数マスぶん）
//     部位ごとにこの2つを高さの帯で絞る（下の PARTS）。当たる区間（コマ）は技の表のまま。
//  ■ 余裕（HIT_TUNE.airPad）＝コンボ中の空中の敵への当たりだけ、攻撃のマスを数 px 膨らませる。厳密にするとお手玉・昇りが
//     つながりにくくなるので、1か所に置いた設定。数値は人が遊んで決める。
export const HIT_TUNE = {
  airPad: 24,       // コンボ中に空中の敵へ当てるときの膨らみ（画面 px）。0 で完全に厳密。既定 24＝juggle_test の通し 40/40（0〜16 では 38/40・20 で 39/40）
  frontCells: 3,    // 先端の帯の幅（マス数）
  flatRise: 20,     // 2026-10-24（Nao「地面を走る輪が低空の主人公には当たるように。十分高いジャンプは避けられる」）：床を走る輪（flat）の当たりを、線の上に足した高さ（px）。足が床から 20px 以内の低い跳び（跳び出し・着地ぎわ）には当たり、それより高く跳べばかわせる（40px だと v27_test の小跳びで避けられなくなったので 20px）
  fitPad: 16,       // 版3.5：技の表の fit:true の箱（尾の回転・噛みつき振り回し）を、そのコマの絵の外枠（体のマスの外接箱）にこの px だけ広げた所までに切り詰める
};

// 検査用：環境変数 DINO_AIRPAD で余裕の値を差し替える（Node のときだけ。ブラウザでは無視される）
if (typeof process !== 'undefined' && process.env && process.env.DINO_AIRPAD !== undefined) HIT_TUNE.airPad = Number(process.env.DINO_AIRPAD);
if (typeof process !== 'undefined' && process.env && process.env.DINO_FLATRISE !== undefined) HIT_TUNE.flatRise = Number(process.env.DINO_FLATRISE);      // 検査用（2026-10-24）：床の輪の低空の高さを差し替える

// 部位ごとの選び方（立ち姿の体高に対する割合・地面から）：
//   band＝高さの帯 / ext＝立ち姿の外へ伸びた・動いたマスを使う / front＝いちばん前の端の帯 / rear＝いちばん後ろの端の帯 / low＝そのコマでいちばん下のマス
//   mouth 口（頭の先）・claw 爪（腕の先）・tail 尻尾（動いたマスと後ろの端）・low 地面を打つ部位（足・尻尾が地面に着く所）
const PARTS = {
  mouth: { band: [0.40, 9], ext: true, front: true },
  claw:  { band: [0.10, 0.85], ext: true, front: true },
  tail:  { band: [0, 9], ext: true, rear: true },
  sweep: { band: [0, 0.62], ext: true, rear: true, rearCells: 14 },   // 版2.7：回転なぎ払い。尻尾の先だけでなく付け根まで（後ろの端から 14 マスぶん）が当たる。体の中ほどの高さまで
  spin:  { band: [0, 0.50], any: true, all: true, ext: true, xr: [40, 160], ref: [0, 39], plus: 'tailext' },   // 回転の専用アニメ化：回転なぎ払い（専用アニメ Spin）。絵が本当に回るので、そのコマの形のまま当たる。ただし ①立ち姿の外へ動いた所だけ（構えの姿勢では当たらない＝回り出してから）②尻尾の高さ（体高の半分まで・旧 sweep は 0.62）④構えの姿勢（Spin の最初と最後のコマ）の外へ動いた所だけ ③体の中心から左右 40〜160px（旧 sweep の届き方に合わせた）
  // 2026-10-25（Nao「スケルトンレックスの攻撃範囲狭すぎ。しっぽを振り回すところもまともに当たり判定がない」）：
  skull: { band: [0.5, 9], ext: true, front: true, rearCells: 16 },   // 頭ぜんたい（口の先だけでなく、頭蓋骨の後ろまで 16 マス）。噛みつきで、絵の頭に判定が重なる
  bonesweep: { band: [0, 0.8], all: true, ext: true, rearAlso: 18 },   // 骨の尻尾の回転なぎ払い（BoneSweep）：立ち姿の外に出た絵のマスぜんぶ（尻尾の軌跡・残像まで）と、尻尾の付け根（後ろの端から 18 マス）
  tailext: { band: [0, 0.8], ext: true, rear: true, any: true, plus: 'tail' },   // 尾の振り（小さい体・短い尾）：立ち姿の外に出た尾のマスぜんぶ（前へ振った分も）＋後ろの端 3 マス。tail は後ろ側へ出た分だけだった。tailswing のように付け根まで広げない
  tailswing: { band: [0, 0.8], all: true, ext: true, rearAlso: 18 },   // 尾を大きく振る技（ティラノの whip・ギガノトの sweep）。bonesweep と同じ選び方
  // 2026-10-25（Nao「他の敵も同様なことが起こっていないか確認・修正」）：口の先だけだった噛みつき・体当たりの判定を、頭ぜんたいに広げる（絵に合わせる）。
  maw: { maw: 0.32 },   // 2026-10-25 改：口先の円だけ（背中・尾を含めない）。広い版は mawL・mawXL   // 頭ぜんたい＝そのコマでいちばん前に出ているマス（口先）から体高の 0.32 倍の半径のマス。小さい頭にも大きい頭にも同じ式
  mawL:  { maw: 0.46 },   // ギガノト charge・crush（頭・角・前方を広く）
  mawXL: { maw: 0.62 },   // 水中の大型（モササウルス）の頭ぜんたい
  spinbody: { band: [0, 0.62], all: true, ext: true, ref: [0], plus: 'tailext' },   // 回転（フューリー）：構えの姿勢（Spin のコマ 0＝立ち姿）の外へ回り出た絵のマスぜんぶ（体高 0.62 まで）＋尾の振り。旧 spin は「回転の全コマ 0〜39 の和」の外だけを拾っていたので、ほぼ何も拾えず尾の先の数マスだけだった（2026-10-25 Nao「回転中の当たり判定がおかしい」）。2026-10-25 Nao「回転中の当たり判定がおかしい」＝旧 spin は『回転の全コマの和の外』を尾として拾い、尾の先の数マスだけだった
  fin:   { band: [0.62, 9], all: true },   // 背びれ（スピノ系）：立ち姿の体高の 0.62 倍より高いマスぜんぶ
  tailswingH: { band: [0, 1.2], all: true, ext: true, rearAlso: 18 },   // 尾を振る技の回転の上部まで（絵のあるマスぜんぶ・高さ 1.2 体高まで）。ギガノト sweep・ライバル guardSpin
  fronthalf: { half: 'front', frac: 0.6 },   // 水中の長い体（モササウルス）：体の前 60%（頭ぜんたい＋前半）
  rearhalf:  { half: 'rear', frac: 0.6, plus: 'tailext' },   // 体の後ろ 60%＋尾の振り
  low:   { low: 4 },
  head:  { band: [0.45, 9], ext: true, front: true, rear: true, any: true },   // 首を振り回す技：頭は前にも後ろにも来る＝立ち姿の外の高い所と、前後の端
};
PARTS.foot = PARTS.low;

const decodeCache = new Map();

/** 'a-b,c-d/…' → マスの矩形 [x0,y0,x1,y1]（絵の画素・コマの左上が原点）の配列と、(i,j) の占有判定 */
function decode(str, g) {
  const key = str + '|' + g;
  let r = decodeCache.get(key);
  if (r) return r;
  const rows = str === '' ? [] : str.split('/');
  const occ = new Set();
  const cells = [];
  rows.forEach((row, j) => {
    if (!row) return;
    for (const run of row.split(',')) {
      const [s, e] = run.split('-').map(Number);
      for (let i = s; i < e; i++) { occ.add(j * 1000 + i); cells.push([i, j]); }
    }
  });
  r = { occ, cells, g };
  decodeCache.set(key, r);
  return r;
}

/**
 * 絵の1コマのマスク（体）。anchor・ground 基準の相対座標（絵の画素・上が負）の矩形配列を返す。
 * dm = motions.dinos[type]（恐竜1種ぶん）。
 */
export function bodyRects(dm, motion, frame) {
  const m = dm.motions[motion];
  if (!m || !m.mask) return null;
  const f = Math.max(0, Math.min(m.n - 1, frame));
  const g = m.mask.g;
  const d = decode(m.mask.f[f], g);
  const out = new Array(d.cells.length);
  for (let k = 0; k < d.cells.length; k++) {
    const [i, j] = d.cells[k];
    out[k] = [i * g - m.anchorX, j * g - m.ground, (i + 1) * g - m.anchorX, (j + 1) * g - m.ground];
  }
  return { rects: out, g, d, m, f };
}

/** 立ち姿（待機の先頭コマ）の中に (x,y)（anchor・ground 基準の相対）があるか。1マス分広げて見る。 */
function makeIdleTest(dm, motion = 'Idle', frames = [0]) {      // 回転の専用アニメ化：motion・frames を指定すると、その動きの指定コマ（の和）を「立ち姿」とみなす（Spin の構えの姿勢）
  const m = dm.motions[motion];
  if (!m || !m.mask) return () => false;
  const g = m.mask.g;
  const ds = frames.map((f) => decode(m.mask.f[Math.max(0, Math.min(m.n - 1, f))], g));
  return (x, y) => {
    const ci = Math.floor((x + m.anchorX) / g), cj = Math.floor((y + m.ground) / g);
    for (const d of ds) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (d.occ.has((cj + b) * 1000 + ci + a)) return true;
    return false;
  };
}

const partCache = new Map();
/** 部位 maw・mawL・mawXL の口先（円の中心）を選ぶときの高さの下限（体高に対する割合）。0 にすると下限なし（旧）。 */
export const MAW_TIP_MIN_V = (typeof process !== 'undefined' && process.env && process.env.DINO_MAW_TIP_MIN_V !== undefined) ? Number(process.env.DINO_MAW_TIP_MIN_V) : 0.15;

/**
 * そのコマの「当たる部位」のマス（anchor・ground 基準・絵の向きのまま）。
 * artFacing=-1 なら絵は左向き（前＝-x）。空にならない（先端の帯は必ずある）。
 */
export function partRects(dm, dmKey, artFacing, motion, frame, part) {
  const key = `${dmKey}|${motion}|${frame}|${part}`;
  let r = partCache.get(key);
  if (r) return r;
  if (part.includes('+')) {   // 'mouth+low' ＝ くちばしと足、のように複数の部位をまとめて当たりにする
    const parts = part.split('+').map((s) => partRects(dm, dmKey, artFacing, motion, frame, s));
    if (parts.some((p) => !p)) return null;
    r = [...new Set(parts.flat())];
    partCache.set(key, r);
    return r;
  }
  const b = bodyRects(dm, motion, frame);
  if (!b) return null;
  if (part === 'body' || part === 'area' || !PARTS[part]) { r = b.rects; partCache.set(key, r); return r; }
  const P = PARTS[part];
  if (P.maw) {
    // 2026-10-25（Nao「背中に当たり判定はいらん」）：従来の mouth は「立ち姿の外へ動いたマス」も含み、体当たりの首・背中の盛り上がりを拾っていた。maw は口先の円だけ（2026-10-26 独立監査 軽微-2：使われていなかった keepMouth の分岐を削除）
    const uu = (c) => (c[0] + c[2]) / 2 * (artFacing === -1 ? -1 : 1);
    // 口先＝いちばん前のマス。ただし地面すれすれ（体高の MAW_TIP_MIN_V 倍より低い）のマスは除く＝前足の爪・足先が鼻先より前に出るコマで、円の中心が足先へ飛ぶのを防ぐ。該当が無ければ全マスから選ぶ
    const Hh = dm.idle.h, high = b.rects.filter((c) => -((c[1] + c[3]) / 2) / Hh >= MAW_TIP_MIN_V);
    const pool = high.length ? high : b.rects;
    let tip = pool[0];
    for (const c of pool) if (uu(c) > uu(tip) || (uu(c) === uu(tip) && c[1] < tip[1])) tip = c;
    const cx = (tip[0] + tip[2]) / 2, cy = (tip[1] + tip[3]) / 2, R = P.maw * dm.idle.h;
    r = b.rects.filter((c) => Math.hypot((c[0] + c[2]) / 2 - cx, (c[1] + c[3]) / 2 - cy) <= R);
    partCache.set(key, r);
    return r;
  }
  if (P.half) {
    const uu = (c) => (c[0] + c[2]) / 2 * (artFacing === -1 ? -1 : 1);
    let a = 1e9, z = -1e9;
    for (const c of b.rects) { const v = uu(c); if (v < a) a = v; if (v > z) z = v; }
    const cut = P.half === 'front' ? z - (z - a) * P.frac : a + (z - a) * P.frac;
    const sel = b.rects.filter((c) => (P.half === 'front' ? uu(c) >= cut : uu(c) <= cut));
    r = P.plus ? [...new Set([...sel, ...partRects(dm, dmKey, artFacing, motion, frame, P.plus)])] : sel;
    partCache.set(key, r);
    return r;
  }
  if (P.low) {
    let ymax = -1e9;
    for (const c of b.rects) ymax = Math.max(ymax, c[3]);
    r = b.rects.filter((c) => c[3] > ymax - P.low * b.g);
    partCache.set(key, r);
    return r;
  }
  const inIdle = P.ref ? makeIdleTest(dm, motion, P.ref) : makeIdleTest(dm);
  const H = dm.idle.h;
  const u = (x) => x * (artFacing === -1 ? -1 : 1);                      // 前向きを正にした横位置
  const cand = b.rects.filter((c) => { const v = -((c[1] + c[3]) / 2) / H; return v >= P.band[0] && v <= P.band[1]; });
  const pool = cand.length ? cand : b.rects;
  let umax = -1e9, umin = 1e9;
  for (const c of pool) { const cu = u((c[0] + c[2]) / 2); if (cu > umax) umax = cu; if (cu < umin) umin = cu; }
  const fr = (P.rearCells || HIT_TUNE.frontCells) * b.g;
  const sel = new Set();
  for (const c of pool) {
    const cu = u((c[0] + c[2]) / 2);
    if (P.all) { const ax = Math.abs((c[0] + c[2]) / 2); if ((!P.xr || (ax >= P.xr[0] && ax <= P.xr[1])) && !(P.ext && inIdle((c[0] + c[2]) / 2, (c[1] + c[3]) / 2))) sel.add(c); if (P.rearAlso && cu <= umin + P.rearAlso * b.g) sel.add(c); continue; }
    if (P.front && cu >= umax - fr) sel.add(c);
    if (P.rear && cu <= umin + fr) sel.add(c);
    if (P.ext && !inIdle((c[0] + c[2]) / 2, (c[1] + c[3]) / 2) && (P.any || (P.front ? cu > 0 : P.rear ? cu < 0 : true))) sel.add(c);
  }
  r = P.plus ? [...new Set([...sel, ...partRects(dm, dmKey, artFacing, motion, frame, P.plus)])] : [...sel];      // plus＝従来の部位も含める（狭まらない）
  partCache.set(key, r);
  return r;
}

/**
 * 絵の相対矩形を世界の座標へ（反転・倍率・回転・位置）。x,y は足元。rot は体の中心まわり（pivotH＝体高）。
 * 結果は Float64Array [x0,y0,x1,y1,…]。回転があるときはマスの中心を回して同じ大きさの箱で近似する。
 */
export function toWorld(rects, { x, y, flip, s, rot = 0, pivotH = 0, pad = 0, sx = 1 }) {
  const out = new Float64Array(rects.length * 4);
  const co = Math.cos(rot), si = Math.sin(rot);
  const py = -pivotH / 2;
  for (let k = 0; k < rects.length; k++) {
    const c = rects[k];
    let x0 = c[0] * s * sx, x1 = c[2] * s * sx, y0 = c[1] * s, y1 = c[3] * s;      // 版2.7：sx＝縦の軸で回している間の横幅（足元の中心まわりに縮める）
    if (flip) { const t = -x0; x0 = -x1; x1 = t; }
    if (rot) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
      const dx = cx, dy = cy - py;
      const rx = dx * co - dy * si, ry = dx * si + dy * co + py;
      x0 = rx - hx; x1 = rx + hx; y0 = ry - hy; y1 = ry + hy;
    }
    out[k * 4] = x + x0 - pad; out[k * 4 + 1] = y + y0 - pad; out[k * 4 + 2] = x + x1 + pad; out[k * 4 + 3] = y + y1 + pad;
  }
  return out;
}

export function bboxOf(a) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < a.length; i += 4) { if (a[i] < x0) x0 = a[i]; if (a[i + 1] < y0) y0 = a[i + 1]; if (a[i + 2] > x1) x1 = a[i + 2]; if (a[i + 3] > y1) y1 = a[i + 3]; }
  return { x0, y0, x1, y1 };
}

/** 2つの箱の集まりが重なるか。重なれば接点（重なった箱の平均の中心）と重なりの外枠を返す。 */
export function cellsOverlap(a, b) {
  if (!a.length || !b.length) return null;
  const A = bboxOf(a), B = bboxOf(b);
  if (A.x0 >= B.x1 || A.x1 <= B.x0 || A.y0 >= B.y1 || A.y1 <= B.y0) return null;
  let n = 0, sx = 0, sy = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] >= B.x1 || a[i + 2] <= B.x0 || a[i + 1] >= B.y1 || a[i + 3] <= B.y0) continue;
    for (let j = 0; j < b.length; j += 4) {
      const ox0 = Math.max(a[i], b[j]), ox1 = Math.min(a[i + 2], b[j + 2]), oy0 = Math.max(a[i + 1], b[j + 1]), oy1 = Math.min(a[i + 3], b[j + 3]);
      if (ox0 < ox1 && oy0 < oy1) { n++; sx += (ox0 + ox1) / 2; sy += (oy0 + oy1) / 2; if (ox0 < x0) x0 = ox0; if (ox1 > x1) x1 = ox1; if (oy0 < y0) y0 = oy0; if (oy1 > y1) y1 = oy1; }
    }
  }
  return n ? { n, cx: sx / n, cy: sy / n, box: { x0, y0, x1, y1 } } : null;
}

// ---- 絵の外へ出る攻撃（輪・波）：画面に描いている形をそのまま当たりにする ----
/** 風の柱（ダウンバースト）の、いま見えている幅。描画（render.js の 'pillar'）と当たり（world.js の updateShocks）が同じ式を使う＝見た目の柱の幅がそのまま当たりの幅（2026-10-24）。 */
export const pillarWidth = (w, u) => w * (0.78 + 0.22 * Math.sin(u * 40));
/** 描画（render.js の 'ring'）が使う広がり方。 */
export const ringRadius = (f, u) => f.r0 + (f.r1 - f.r0) * (1 - Math.pow(1 - u, 2));
/** 輪の線が見えている間（線の濃さ＝(1-u)*0.9 が 0.12 を割るまで）だけ当たる。 */
export const RING_LIVE_U = 0.87;
/**
 * 描いている輪（fx の ring）の線そのもの。u＝経過の割合。線の太さ＝描画と同じ w*(1-0.6u)。
 * flat の輪は縦を 0.16 倍に潰した楕円で、中心は (x, y-6)。線に沿って小さな四角を並べて返す（Float64Array）。
 * bbox（{x0,x1,y0,y1}）を渡すと、その枠の近くの点だけ作る。
 */
export function ringBandCells(f, u, bbox = null) {
  const r = ringRadius(f, u), rx = r, ry = r * (f.flat ? 0.16 : 1);
  const lw = f.w * (1 - u * 0.6), ht = Math.max(lw, 4) / 2;
  const cx = f.x, cy = f.y - 6;
  const rise = f.flat ? HIT_TUNE.flatRise : 0;      // 床の輪は線の上に flatRise だけ高さを足す（低空の主人公に当たる）
  if (bbox) {   // 粗い足切り：枠の四隅・最近点で、輪の線に届くか
    const nx0 = (bbox.x0 - cx) / rx, nx1 = (bbox.x1 - cx) / rx, ny0 = (bbox.y0 - cy) / ry, ny1 = (bbox.y1 + rise - cy) / ry;
    const near = Math.hypot(Math.max(nx0, 0, -nx1), Math.max(ny0, 0, -ny1));
    const far = Math.hypot(Math.max(Math.abs(nx0), Math.abs(nx1)), Math.max(Math.abs(ny0), Math.abs(ny1)));
    const tol = (ht + 2) / Math.min(rx, ry);
    if (near > 1 + tol || far < 1 - tol) return new Float64Array(0);
  }
  const step = Math.max(0.004, (ht * 1.2) / Math.max(rx, 1));
  const out = [];
  for (let a = 0; a < Math.PI * 2; a += step) {
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    if (bbox && (x < bbox.x0 - ht || x > bbox.x1 + ht || y < bbox.y0 - ht - 0 || y > bbox.y1 + ht + rise)) continue;
    out.push(x - ht, y - ht - rise, x + ht, y + ht);
  }
  return Float64Array.from(out);
}

// 床を走る衝撃波の絵（render.js drawWaves）：低くのびる光の楔。尾の薄い所は含めず、明るい部分（先端から後ろへ 100px）を当たりにする。
const WEDGE_TAIL = 150, WEDGE_REACH = 100;
const bez = (p0, c, p1, t) => ({ x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x, y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y });
/** 楔の輪郭を (前向きを正にした横位置, 地面からの高さ) の組で返す。H0＝描画の高さ（w.h*1.05）。 */
export function wedgeProfile(H0) {
  const pts = [];
  for (let i = 0; i <= 16; i++) pts.push(bez({ x: -WEDGE_TAIL, y: 3 }, { x: -WEDGE_TAIL * 0.3, y: -H0 * 0.5 }, { x: 22, y: -H0 }, i / 16));
  for (let i = 1; i <= 8; i++) pts.push(bez({ x: 22, y: -H0 }, { x: 46, y: -H0 * 0.35 }, { x: 40, y: 3 }, i / 8));
  return pts;
}
/** 衝撃波 w（x,y=足元,dir,h）の楔を世界の座標のマスにする。 */
export function waveCells(w) {
  const pts = wedgeProfile(w.h * 1.05);
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const xl = Math.min(a.x, b.x), xr = Math.max(a.x, b.x);
    if (xr < -WEDGE_REACH) continue;
    const top = Math.min(a.y, b.y);
    const wx0 = w.dir > 0 ? w.x + xl : w.x - xr, wx1 = w.dir > 0 ? w.x + xr : w.x - xl;
    out.push(wx0, w.y + top, wx1, w.y + 3);
  }
  return Float64Array.from(out);
}

/** 箱（rectsOverlap 用の {x0,x1,y0,y1}）を1つのマスとして扱う配列にする。 */
export function boxToCells(b) { return new Float64Array([b.x0, b.y0, b.x1, b.y1]); }

/**
 * 版3.5：円盤（咆哮の衝撃など、中心から同心円に広がる当たり）。中心 (cx,cy)・半径 r の円を、高さ step の横帯の積み重ねで返す（Float64Array）。
 * bbox（{x0,x1,y0,y1}）を渡すと、その枠に掛かる帯だけ作る。
 */
export function diskCells(cx, cy, r, bbox = null, step = 6) {
  if (!(r > 0)) return new Float64Array(0);
  const out = [];
  const ya = bbox ? Math.max(cy - r, bbox.y0 - step) : cy - r, yb = bbox ? Math.min(cy + r, bbox.y1 + step) : cy + r;
  for (let y = ya; y < yb; y += step) {
    const ym = Math.min(Math.max(cy, y), y + step);      // 帯の中でいちばん円の中心に近い高さ＝その帯でいちばん広い所
    const dy = Math.abs(ym - cy);
    if (dy >= r) continue;
    const hw = Math.sqrt(r * r - dy * dy);
    out.push(cx - hw, y, cx + hw, y + step);
  }
  return Float64Array.from(out);
}
