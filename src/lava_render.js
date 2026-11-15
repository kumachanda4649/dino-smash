// 版3.1（マグマだまりを背景とつなぐ）：火山の面の「溶岩の川と池」の描画。
// 見た目の筋書き＝火口から流れ出た溶岩が背景の斜面を伝い、地平線（hz）で背景の絵から床の上の「川」になり、手前で広がって「池」になる。池は床の穴で、足がその中に入ると痛い。
//   ・川＝地平線から池まで、床の奥から手前へ（遠近でゆるやかに太る）。池＝足を置く線（groundY）で幅が最大。この線での幅＝当たりの半幅（world.js の lavaReach）。見える溶岩の所だけ当たる。
//   ・溶岩の面は GPT 画像生成のタイル（assets/bg/lava/tile.webp・縦横に連続）を、奥から手前へ流れるように動かして貼る。無ければ描画の溶岩で代用。
//   ・水位（lavaPhase 0〜1）：高いほど池が左右へ広がり、手前のふちが前へ出る（当たりも同じだけ広がる）。
// アンモナイト・巨大な渦巻きの飾りは入れない。炎・火花を恐竜の体に付けない（環境の演出だけ）。world の座標（カメラの平行移動のあと）で呼ぶ。動きは time（秒）で決め、乱数は使わない（ちらつかない）。
export const LAVA_SPILL = 40;      // 水位が最高のとき、池が左右へ広がる量(px)。world.js の当たりと同じ値を使う

/** 水位（0＝低い・1＝高い）。t＝面の経過秒・period＝1周の秒。なめらかに上下する。 */
export const lavaPhase = (t, period) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / Math.max(1, period));

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

// 溶岩の面のタイル（GPT 画像生成）
const TILE = { img: null, pats: new WeakMap() };
export function setLavaTile(img) { TILE.img = img; TILE.pats = new WeakMap(); }
export const lavaTileReady = () => !!TILE.img;
const patternOf = (ctx) => {
  if (!TILE.img) return null;
  let p = TILE.pats.get(ctx);
  if (!p) { p = ctx.createPattern(TILE.img, 'repeat'); TILE.pats.set(ctx, p); }
  return p;
};

// 版3.5（川は手前の画面の下端まで・見切れる）：溶岩は「地平線の川の続き」として床の上を手前へ流れ、画面の下端で見切れる帯になる。先端は無い（丸い行き止まりを作らない）。
//   帯の半幅は、足を置く線（groundY）で rx＝当たりの半幅。奥へ行くほど細く（地平線で k 倍）、手前ほど太い（遠近＝消失点 hzv からの距離に比例）。水位は rx の増減＝帯の幅の増減。
export const LAVA_HORIZON_K = 0.45;      // 地平線での帯の幅 ÷ 足の線での幅
/** 消失点の y（帯の幅が 0 になる高さ）。hz で k 倍・groundY で 1 倍になる直線から決まる。 */
export const lavaVanishY = (groundY, hz, k = LAVA_HORIZON_K) => (hz - k * groundY) / (1 - k);
/** 足の線での半幅 rx の池を、高さ y で見たときの半幅（遠近）。y=groundY で rx。当たり（足の線）はこの式の y=groundY。 */
export const lavaHalfWidthAt = (rx, y, groundY, hz) => { const v = lavaVanishY(groundY, hz); return Math.max(0, rx * (y - v) / (groundY - v)); };

/**
 * 川の輪郭（世界の座標）。pool＝{x0,x1,cx,sx,sw}（sx＝背景の絵の溶岩が地平線を横切る中心 x）。yEnd＝帯を描く下の端（画面の下端より下）。
 * 返り値 { rx, yTop, yEnd, poly（閉じた多角形）, nL（左の点の数）, xcAt(y), hwAt(y) }。rx＝足の線（groundY）での半幅＝当たりの半幅。
 */
export function lavaOutline(pool, groundY, hz, ph, yEnd = groundY + 130) {
  const rx = (pool.x1 - pool.x0) / 2 + LAVA_SPILL * ph, cx = pool.cx, sx = pool.sx ?? cx;
  const yTop = hz, span = Math.max(40, groundY - yTop);
  const xcAt = (y) => sx + (cx - sx) * smooth((y - yTop) / span);
  const hwAt = (y) => lavaHalfWidthAt(rx, y, groundY, hz);
  const left = [], right = [], N = 40, ye = Math.max(yEnd, groundY + 20);
  for (let i = 0; i <= N; i++) { const y = yTop + (ye - yTop) * (i / N), xc = xcAt(y), hw = hwAt(y); left.push([xc - hw, y]); right.push([xc + hw, y]); }
  return { rx, yTop, yEnd: ye, poly: [...left, ...right.reverse()], nL: left.length, xcAt, hwAt };
}

const sidePath = (o, side) => { const p = new Path2D(), n = o.nL; for (let i = 0; i < n; i++) { const q = side < 0 ? o.poly[i] : o.poly[o.poly.length - 1 - i]; i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]); } return p; };
const pathOf = (o) => { const p = new Path2D(); o.poly.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p; };

/** 溶岩の面の流れの帯を描く（輪郭の中に貼る前の、生の帯。idx で模様をずらす）。ctx は主画面でも作り置きの絵でもよい。 */
function drawStrips(ctx, pat, o, idx, time, yTop, yBot, span0, xcAt, hwAt) {
  let v = time * 70;      // 流れ（元の絵の画素での進み＝手前ほど速く見える）
  const step = 3;
  for (let y = yTop; y < yBot + step; y += step) {
    const t = (y - yTop) / span0, s = 0.2 + 0.38 * t, fore = 0.62, xc = xcAt(y), hw = hwAt(y) + 8;
    const u0 = 300 + idx * 521, th = TILE.img.height, vm = ((v % th) + th) % th;
    pat.setTransform(new DOMMatrix([s, 0, 0, s * fore, xc - s * u0, y - s * fore * vm]));
    ctx.globalAlpha = smooth((y - yTop) / 26);      // 地平線の所は背景の絵の溶岩へなめらかにつなぐ
    ctx.fillStyle = pat; ctx.fillRect(xc - hw, y, hw * 2, step + 1);
    v += step / (s * fore);
  }
  ctx.globalAlpha = 1;
}

/**
 * 2026-10-25：流れの帯の作り置き。帯は時間で動くが、流れは遅い（画面で 1 秒に 8〜25px）ので 30 回/秒で描き直せば動きは同じに見える。
 * 作り置きの絵は池の輪郭（clip）の中にだけ貼られるので、水位で池が広がる最大（LAVA_SPILL）まで余分に描いておけば、水位が変わっても描き直しは要らない。
 * 描き直す条件：30 分の 1 秒が進んだ／帯の位置・大きさ（面・川・カメラの下端）が変わった。ブラウザ以外（Node）や大きすぎるときは null（従来どおり毎フレーム直接描く）。
 */
export const LAVA_CACHE = { on: true, fps: 30 };
const SURFS = new WeakMap();
function surfaceFor(pool, pat, groundY, hz, idx, time, yTop, yBot, span0) {
  if (typeof document === 'undefined') return null;
  const yBotQ = Math.ceil(yBot / 64) * 64;      // カメラが少し動いても作り直さない（下端は 64px 単位に切り上げ）
  const rxFull = (pool.x1 - pool.x0) / 2 + LAVA_SPILL, sx = pool.sx ?? pool.cx, cx = pool.cx;
  const hwFull = (y) => lavaHalfWidthAt(rxFull, y, groundY, hz);
  const hwMax = hwFull(yBotQ) + 10;
  const bx0 = Math.max(-64, Math.floor(Math.min(sx, cx) - hwMax - 2)), bx1 = Math.min(1344, Math.ceil(Math.max(sx, cx) + hwMax + 2));
  const by0 = Math.floor(yTop), by1 = Math.ceil(yBotQ + 4);
  const w = bx1 - bx0, h = by1 - by0;
  if (!(w > 0 && h > 0) || w > 1500 || h > 1700) return null;
  const tq = Math.floor(time * LAVA_CACHE.fps) / LAVA_CACHE.fps;
  const key = `${TILE.img.src || TILE.img.width}|${groundY}|${hz}|${idx}|${sx}|${cx}|${rxFull}|${yTop}|${yBotQ}`;
  let S = SURFS.get(pool);
  if (!S || S.key !== key) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    S = { cv, key, t: NaN, bx0, by0 };
    SURFS.set(pool, S);
  }
  if (S.t !== tq) {
    const c2 = S.cv.getContext('2d');
    c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, w, h);
    c2.setTransform(1, 0, 0, 1, -bx0, -by0);
    const xcAt = (y) => sx + (cx - sx) * smooth((y - yTop) / Math.max(40, groundY - yTop));
    drawStrips(c2, pat, null, idx, tq, yTop, yBotQ, span0, xcAt, hwFull);
    S.t = tq;
  }
  return S;
}

/** 川を 1 本描く（足場・敵より後ろ）。idx＝何番目の川か（模様をずらす）。yEnd＝帯の下の端（既定＝画面の下端より下）。 */
export function drawLavaPool(ctx, pool, groundY, hz, time, ph, idx = 0, yEnd = groundY + 130, cache = true) {
  const o = lavaOutline(pool, groundY, hz, ph, yEnd), cx = pool.cx, { rx, yTop } = o, yBot = o.yEnd;
  const rim = pathOf(o), L = sidePath(o, -1), R = sidePath(o, 1), span0 = Math.max(40, groundY - yTop);
  ctx.save();
  // 床に映る溶岩の光（川の両岸のまわり。奥ほど細く手前ほど太い）
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [lw, al] of [[64, 0.05], [38, 0.07], [20, 0.09]]) { ctx.strokeStyle = `rgba(255,110,30,${al + 0.03 * ph})`; ctx.lineWidth = lw; ctx.stroke(L); ctx.stroke(R); }
  ctx.restore();
  // 岩のふち（川の岸）。奥ほど細く手前ほど太い（遠近）。上端と下端は閉じない
  const P = o.poly, n = o.nL;
  for (const [col, wMul] of [['#1d110e', 1.0], ['#3a241b', 0.55]]) {
    ctx.strokeStyle = col;
    for (let i = 0; i < n - 1; i++) for (const side of [-1, 1]) {
      const a = side < 0 ? P[i] : P[P.length - 1 - i], b = side < 0 ? P[i + 1] : P[P.length - 2 - i];
      ctx.lineWidth = (5 + 19 * Math.min(1.5, Math.max(0, (b[1] - yTop) / span0))) * wMul;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  // 溶岩の面（輪郭の中だけ）
  ctx.save(); ctx.clip(rim);
  const pat = patternOf(ctx);
  if (pat) {
    const surf = LAVA_CACHE.on && cache ? surfaceFor(pool, pat, groundY, hz, idx, time, yTop, yBot, span0) : null;
    if (surf) ctx.drawImage(surf.cv, surf.bx0, surf.by0);      // 2026-10-25：流れの帯は 30 回/秒だけ描き直した絵を貼る（毎フレーム 150 本の帯をパターンで塗ると、ソフト描画で 3 倍重かった）
    else drawStrips(ctx, pat, o, idx, time, yTop, yBot, span0, o.xcAt, o.hwAt);
  } else {
    const g = ctx.createLinearGradient(0, yTop, 0, yBot);
    g.addColorStop(0, '#ff8a22'); g.addColorStop(0.5, '#ff7a1c'); g.addColorStop(1, '#ffb52e');
    ctx.fillStyle = g; ctx.fillRect(cx - rx * 2 - 40, yTop, rx * 4 + 80 + 400, yBot - yTop + 2);
  }
  // 奥ほど赤く暗く（背景の絵の溶岩の色へなじませる）
  const dg = ctx.createLinearGradient(0, yTop, 0, groundY);
  dg.addColorStop(0, 'rgba(110,22,4,0.55)'); dg.addColorStop(0.55, 'rgba(110,22,4,0.2)'); dg.addColorStop(1, 'rgba(110,22,4,0)');
  ctx.fillStyle = dg; ctx.fillRect(0, yTop, 1280, groundY - yTop + 2);
  // 面の明るさのゆらぎ（上から重ねる光）と泡
  ctx.globalCompositeOperation = 'lighter';
  const sh = ctx.createLinearGradient(0, yTop, 0, yBot), k = 0.08 + 0.04 * Math.sin(time * 1.7 + idx) + 0.05 * ph;
  sh.addColorStop(0, `rgba(255,150,40,${k})`); sh.addColorStop(1, `rgba(255,200,90,${k * 1.4})`);
  ctx.fillStyle = sh; ctx.fillRect(0, yTop, 1280, yBot - yTop + 2);
  for (let i = 0; i < 9; i++) {
    const t = (time * 0.6 + hash(i + 60 + idx * 5)) % 1, y = groundY - 30 + (hash(i + 80 + idx * 5) - 0.35) * 150, bx = o.xcAt(y) + (hash(i + 70 + idx * 5) - 0.5) * o.hwAt(y) * 1.6, r = 1.5 + t * 5;
    ctx.fillStyle = `rgba(255,235,150,${0.7 * (1 - t)})`; ctx.beginPath(); ctx.ellipse(bx, y - t * 5, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // 溶岩の端の焦げた光（足の線での位置が当たりの端）／川の上の熱と火の粉（環境の演出だけ）
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(255,150,50,${0.4 + 0.2 * ph})`; ctx.lineWidth = 3; ctx.stroke(L); ctx.stroke(R);
  const hg = ctx.createRadialGradient(cx, groundY - 10, 10, cx, groundY - 10, rx * 1.5);
  hg.addColorStop(0, `rgba(255,130,40,${0.26 + 0.16 * ph})`); hg.addColorStop(1, 'rgba(255,130,40,0)');
  ctx.fillStyle = hg; ctx.fillRect(cx - rx * 1.6, groundY - 150, rx * 3.2, 230);
  for (let i = 0; i < 8; i++) {
    const t = (time * 0.5 + hash(i + idx * 13) * 3) % 1.6 / 1.6, ex = cx + (hash(i + 100) - 0.5) * rx * 1.5 + Math.sin(time * 2 + i) * 8, ey = groundY - 10 - t * 150;
    ctx.fillStyle = `rgba(255,190,80,${0.8 * (1 - t)})`; ctx.beginPath(); ctx.arc(ex, ey, 2.2 * (1 - t) + 0.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

/** 世界の描画から呼ぶ（カメラの平行移動のあと）。 */
export function drawLava(ctx, world, time) {
  const L = world.lava; if (!L) return;
  const ph = lavaPhase(world.lavaT || 0, L.period), hz = (world.stage.bg && world.stage.bg.hz) || 300;
  const yEnd = Math.max(world.groundY + 130, (world.camY || 0) + 720 + 30);      // 帯は画面の下端（カメラが上下しても下端）の外まで続く＝下端で見切れる
  L.pools.forEach((p, i) => drawLavaPool(ctx, p, world.groundY, hz, time, ph, i, yEnd));
}

/** 面送りのスクロール用：1面ぶんを横 offX に静止画のように描く。 */
//   2026-11-14：at＝{ t, period }（水位の時計）を渡せば、その位相で描く。面送りでは、出ていく面＝止まった世界の lavaT と周期、入る面＝0（面の開始と同じ）。
//   前は実時間（time）で位相を出していたので、面送りの始まりと終わりで池の幅が最大 40px 跳んだ（本番は面の開始で lavaT＝0 から数える）
export function drawLavaStatic(ctx, st, offX, time, at = null) {
  if (!st.lava) return;
  const period = (at && at.period) || (st.lava.period ?? 8), ph = lavaPhase(at ? at.t : time, period), hz = (st.bg && st.bg.hz) || 300;
  ctx.save(); ctx.translate(offX, 0);
  st.lava.pools.map((p) => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, cx: p.x, sx: p.sx, sw: p.sw })).forEach((p, i) => drawLavaPool(ctx, p, st.groundY, hz, time, ph, i, Math.max(st.groundY + 130, 750), false));      // 面送りの静止画は毎回プールの物を作り直すので、作り置きは使わない
  ctx.restore();
}

/** ?hitbox=1 / H キー：溶岩の当たり（足を置く線での池の幅）を赤い枠で出す。見える溶岩の端と重なる。 */
export function drawLavaHitbox(ctx, world) {
  const L = world.lava; if (!L) return;
  const ph = world.lavaPhaseNow(), gy = world.groundY;
  ctx.save();
  for (const p of L.pools) {
    const r = world.lavaReach(p, ph);
    ctx.fillStyle = 'rgba(255,60,50,0.34)'; ctx.fillRect(p.cx - r, gy - 26, r * 2, 30);
    ctx.strokeStyle = 'rgba(255,60,50,0.95)'; ctx.lineWidth = 2; ctx.strokeRect(p.cx - r, gy - 26, r * 2, 30);
    ctx.fillStyle = '#ffe0d8'; ctx.font = 'bold 13px monospace'; ctx.fillText('LAVA', p.cx - 18, gy - 32);
  }
  ctx.restore();
}
