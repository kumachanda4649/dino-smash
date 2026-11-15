// 描画（Canvas 2D）。エフェクトはドット絵にせず、Canvas で描く滑らかな光・衝撃波・土ぼこり・画面揺れ。
// 恐竜に炎のエフェクトは使わない（体の力だけ）。
import { DINOS, isBossLike } from './dinos.js';
import { W, H, animFrame, visFacing, yawOf, swimTilt, SWIPE_FX, QUAKE } from './world.js';
import { drawSeaBackdrop, drawSeaPlatforms, drawWaterOverlay, drawLandCliffs, drawTallArt, tallArtOf } from './sea_render.js';
import { drawLava, drawLavaHitbox } from './lava_render.js';      // 版3.0：海
import { clamp, lerp } from './util.js';
import { dispDamage } from './bignum.js';      // 版3.5：ダメージ表示の倍率
import { drawAura, auraColorOf } from './aura.js';
import { RAGE } from './rage.js';
import { HIT_TUNE, ringBandCells, waveCells, RING_LIVE_U, pillarWidth } from './shape.js';

const BG_SCALE = 1.28;                  // 1000x740 の戦闘背景を横 1280 に合わせる
const BG_H = 740 * BG_SCALE;            // 947
const TW = 1000, TH = 700;              // 色重ね用の作業キャンバス

let tint = null;
function tintCanvas() {
  if (!tint) {
    tint = document.createElement('canvas');
    tint.width = TW; tint.height = TH;
  }
  return tint;
}

export const FONT_JP = '"Yu Gothic UI","Meiryo","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';
export const FONT_EN = '"Arial Black","Impact","Segoe UI",sans-serif';

/**
 * 縁取り文字。
 * 2026-10-25：同じ文字・同じ書式が続けて描かれるとき（HUD の「SCORE」「CP ゲージ」「STAGE …」など毎フレーム同じ文字）は、
 * 3 回目から作り置きの絵（スプライト）を貼る。strokeText が毎フレーム 10 回ほど呼ばれ、ソフト描画で CPU の約 8% を使っていたため。
 * 見た目が変わらないよう、貼るのは「変形なし・位置が整数・透明度 1・影なし」のときだけ（それ以外は従来どおり直接描く）。
 * 文字が毎フレーム変わるもの（得点・体力の数字）は 3 回続かないので作り置きにならない。
 */
export const TEXT_SPRITES = { on: true, hits: 0, makes: 0 };
const spriteMap = new Map();      // key → { n, cv, ox, oy }
const TEXT_SPRITE_MAX = 300;
function drawText(ctx, str, x, y, o) {
  ctx.save();
  ctx.font = o.font || `bold ${o.size || 28}px ${FONT_JP}`;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.base || 'alphabetic';
  // 2026-11-14：描く側の透明度（フェード）に掛け合わせる。前は 1 で上書きしていたので、STAGE の表示・コンボの評価・ゲームオーバー・エンディングのフェードで
  // 帯だけ薄くなり文字は最後まで不透明だった（作り置きの絵の経路は描く側の透明度が効くので、経路によって食い違っていた）
  ctx.globalAlpha = (o.alpha ?? 1) * ctx.globalAlpha;
  ctx.lineJoin = 'round';
  if (o.shadow) { ctx.shadowColor = o.shadow; ctx.shadowBlur = o.glow || 12; }
  if (o.stroke !== null) {
    ctx.lineWidth = o.lw || Math.max(3, (o.size || 28) / 6);
    ctx.strokeStyle = o.stroke || '#10131c';
    if (o.maxW) ctx.strokeText(str, x, y, o.maxW); else ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = o.color || '#fff';
  if (o.maxW) ctx.fillText(str, x, y, o.maxW); else ctx.fillText(str, x, y);      // 2026-11-14：maxW＝この幅を超える文字は横に詰めて収める（長い面の名前・技表の説明など。前ははみ出し・重なった）
  ctx.restore();
}
export function text(ctx, str, x, y, o = {}) {
  if (TEXT_SPRITES.on && typeof document !== 'undefined' && !(typeof window !== 'undefined' && window.__NO_TEXT_SPRITES) && !o.shadow && (o.alpha === undefined || o.alpha === 1) && Number.isInteger(x) && Number.isInteger(y) && str.length <= 40) {
    const m = ctx.getTransform();
    if (m.a === 1 && m.d === 1 && m.b === 0 && m.c === 0 && Number.isInteger(m.e) && Number.isInteger(m.f) && ctx.globalCompositeOperation === 'source-over') {
      const font = o.font || `bold ${o.size || 28}px ${FONT_JP}`, lw = o.lw || Math.max(3, (o.size || 28) / 6);
      const key = `${str}${font}${o.align || 'left'}${o.base || 'alphabetic'}${o.stroke === null ? 'n' : (o.stroke || '#10131c')}${lw}${o.color || '#fff'}${o.maxW || ''}`;
      let e = spriteMap.get(key);
      if (!e) { if (spriteMap.size > TEXT_SPRITE_MAX) spriteMap.clear(); e = { n: 0, cv: null }; spriteMap.set(key, e); }
      e.n++;
      if (e.n >= 3) {
        if (!e.cv) {      // 作る：文字の大きさを測り、縁取りの太さのぶん余白を取った canvas に、原点(ox,oy)を基準に描く
          const c0 = document.createElement('canvas').getContext('2d');
          c0.font = font; c0.textAlign = o.align || 'left'; c0.textBaseline = o.base || 'alphabetic';
          const tm = c0.measureText(str), pad = Math.ceil(lw) + 4;
          const asc = Math.ceil(tm.actualBoundingBoxAscent || (o.size || 28)) + pad, desc = Math.ceil(tm.actualBoundingBoxDescent || (o.size || 28) * 0.3) + pad;
          const left = Math.ceil(tm.actualBoundingBoxLeft || 0) + pad, right = Math.ceil(tm.actualBoundingBoxRight || tm.width) + pad;
          const cv = document.createElement('canvas'); cv.width = Math.max(1, left + right); cv.height = Math.max(1, asc + desc);
          drawText(cv.getContext('2d'), str, left, asc, o);
          e.cv = cv; e.ox = left; e.oy = asc; TEXT_SPRITES.makes++;
        }
        TEXT_SPRITES.hits++;
        ctx.drawImage(e.cv, x - e.ox, y - e.oy);
        return;
      }
    }
  }
  drawText(ctx, str, x, y, o);
}

// ---------- 背景・足場 ----------
// 版2.3：縦スクロール。背景の絵は元の1画面ぶん（高さ BG_H）しか無いので、カメラが上がって絵の上端が見えるようになったら、
// 絵の上端の数行を縦に引き伸ばして（ぼかして）空を延ばし、やわらかい雲を足す。雲はカメラの半分の速さで動く（視差）。絵そのものは世界といっしょに動く（地面の線と足場がずれない）。
const SKY_EXT_H = 760;
const BG_FADE = 70;                       // 絵の上端のこの高さ(画面px)は、延ばした空へなめらかにつなぐ
const skyCache = new WeakMap();
/** 空の延長（引き伸ばしてぼかした帯）と、上端をなめらかに溶かした背景、空の明るさ（雲を描くか決める）。背景ごとに1回だけ作る。 */
function skyOf(c) {
  let r = skyCache.get(c);
  if (r) return r;
  const ext = document.createElement('canvas');
  ext.width = W; ext.height = SKY_EXT_H;
  const x = ext.getContext('2d');
  // 上端の数行を、まず小さく縮めて（横のすじを均す）から、大きく引き伸ばしてぼかす
  const tiny = document.createElement('canvas');
  tiny.width = 40; tiny.height = 6;
  const tx = tiny.getContext('2d');
  tx.imageSmoothingQuality = 'high';
  tx.drawImage(c, 0, 0, 1000, 10, 0, 0, 40, 6);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  try { x.filter = 'blur(14px)'; } catch (e) { /* フィルタが無い環境は引き伸ばしだけ */ }
  x.drawImage(tiny, 0, 0, 40, 6, -40, -40, W + 80, SKY_EXT_H + 80);
  x.filter = 'none';
  // 上へ行くほど少しだけ澄んだ空色に寄せる（ぼかした帯が単調にならないように）
  const g = x.createLinearGradient(0, 0, 0, SKY_EXT_H);
  g.addColorStop(0, 'rgba(150,200,255,0.22)'); g.addColorStop(1, 'rgba(150,200,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, SKY_EXT_H);
  // 明るさ（上端の帯の平均）：暗い背景（密林の梢・遺跡の闇）に白い雲は合わないので、明るい空のときだけ雲を出す
  let lum = 0;
  try { const d = x.getImageData(0, SKY_EXT_H - 30, W, 1).data; let n = 0; for (let i = 0; i < d.length; i += 16) { lum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; } lum /= n; } catch (e) { lum = 200; }
  // 上端をなめらかに溶かした背景（上 BG_FADE ぶんの不透明度を 0→1）
  const faded = document.createElement('canvas');
  faded.width = 1000; faded.height = 740;
  const f = faded.getContext('2d');
  f.drawImage(c, 0, 0, 1000, 740, 0, 0, 1000, 740);
  const fh = BG_FADE / (BG_H / 740);
  const gg = f.createLinearGradient(0, 0, 0, fh);
  gg.addColorStop(0, 'rgba(0,0,0,1)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
  f.globalCompositeOperation = 'destination-out';      // 上端ほど消す（destination-in は絵の外まで消してしまうので使わない）
  f.fillStyle = gg; f.fillRect(0, 0, 1000, fh);
  r = { ext, faded, lum };
  skyCache.set(c, r);
  return r;
}
const CLOUDS = [[120, 0.12, 260, 38], [470, 0.30, 340, 46], [880, 0.20, 300, 40], [1120, 0.45, 230, 32], [260, 0.58, 320, 42], [700, 0.66, 280, 36], [980, 0.82, 260, 34]];
function drawSkyClouds(ctx, top, camY) {
  // top＝絵の上端の画面 y（これより上を空として描く）。雲は世界より遅れて動く（視差）
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, Math.max(0, top)); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  const par = -camY * 0.5;
  for (const [cx, u, w, h] of CLOUDS) {
    const y = top - u * SKY_EXT_H * 0.9 + par * 0.4;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(cx + (k - 1) * w * 0.28, y + (k === 1 ? -h * 0.2 : 0), w * (k === 1 ? 0.34 : 0.26), h * (k === 1 ? 0.7 : 0.5), 0, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

export function drawBackground(ctx, assets, stage, offsetX = 0, camY = 0) {
  if (stage.bg && stage.bg.proc) return;      // 版3.0：描画で作る背景（海）は、カメラの中（drawWorld）で描く
  const art = stage.bg && stage.bg.art ? tallArtOf(stage.bg) : null;
  if (art) { drawTallArt(ctx, art, stage.bg, offsetX, camY); return; }      // 版3.0（背景の描き直し）：縦長の1枚絵（火山）。読めていなければ従来の背景
  const c = assets.bg[assets.bgKey(stage.bg)];
  if (!c) { ctx.fillStyle = '#222'; ctx.fillRect(offsetX, 0, W, H); return; }
  const y = H - BG_H + (stage.bgY || 0) - camY;       // camY は 0 か負（上へ）。絵は世界といっしょに下へ動く
  if (y > -BG_FADE) {      // 絵の上端が見えている：その上は延ばした空。上端はなめらかに溶かす
    const sky = skyOf(c);
    ctx.drawImage(sky.ext, 0, 0, W, SKY_EXT_H, offsetX, y - SKY_EXT_H, W, SKY_EXT_H);
    if (y > 0 && sky.lum > 150) drawSkyClouds(ctx, y, camY);
    ctx.drawImage(sky.ext, 0, SKY_EXT_H - BG_FADE - 6, W, BG_FADE + 6, offsetX, y - 6, W, BG_FADE + 6);      // 溶かす帯の下地（延ばした空の下端）
    ctx.drawImage(sky.faded, 0, 0, 1000, 740, offsetX, y, W, BG_H);
    return;
  }
  ctx.drawImage(c, 0, 0, 1000, 740, offsetX, y, W, BG_H);
}

const LAVA_EDGE_LEDGE = { top: '#e4642a', face: '#5a1e12' };
export function drawPlatforms(ctx, stage, offsetX = 0, shakeOf = null, time = 0) {      // 版2.8b：shakeOf(i)＝足場 i のゆれの大きさ（足場ゆらしの予兆）
  const L0 = stage.ledge || { top: '#9aa', face: '#556' };
  for (let pi = 0; pi < stage.platforms.length; pi++) {
    const p = stage.platforms[pi];
    const L = p.kind === 'lava_edge' ? LAVA_EDGE_LEDGE : L0;      // 版3.1：溶岩の縁の足場（面エディタの種類。見た目だけ赤熱した岩）
    const amp = shakeOf ? shakeOf(pi) : 0;
    const x = p.x + offsetX + (amp ? Math.sin(time * 95) * amp : 0), y = p.y + (amp ? Math.sin(time * 71 + 1) * amp * 0.5 : 0), w = p.w, t = 30;
    // 影（足場の下の地面・背景に落ちる、濃いめの影）
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + t + 26, w * 0.5, 10, 0, 0, Math.PI * 2); ctx.fill();
    // 側面（はっきりした輪郭＋下へ暗くなる）
    const g = ctx.createLinearGradient(0, y, 0, y + t);
    g.addColorStop(0, L.face); g.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = L.face;
    roundRect(ctx, x, y + 6, w, t, 10); ctx.fill();
    ctx.fillStyle = g;
    roundRect(ctx, x, y + 6, w, t, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(12,8,4,0.85)'; ctx.lineWidth = 3;
    roundRect(ctx, x, y + 6, w, t, 10); ctx.stroke();
    // 下面の暗い縁（背景から足場の底を切り離す）
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, x + 3, y + t - 2, w - 6, 8, 4); ctx.fill();
    // 上面＝歩ける面：淡い光の縁・明るい面・黒い輪郭・白いハイライト線
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,235,0.8)'; ctx.shadowBlur = 10;
    ctx.fillStyle = L.top;
    roundRect(ctx, x - 4, y - 5, w + 8, 16, 8); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(ctx, x - 4, y - 5, w + 8, 16, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(12,8,4,0.9)'; ctx.lineWidth = 3;
    roundRect(ctx, x - 4, y - 5, w + 8, 16, 8); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    roundRect(ctx, x + 6, y - 3, w - 12, 4, 2); ctx.fill();
    // 岩のすじ
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
      const lx = x + (w * i) / 5 + ((i * 37) % 11) - 5;
      ctx.beginPath(); ctx.moveTo(lx, y + 12); ctx.lineTo(lx + 6, y + 6 + t - 6); ctx.stroke();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// ---------- 恐竜の1コマ ----------
/** 足（接地線）が (x,y) に来るように描く。rot は体の中心まわり。 */
/**
 * ドット絵（assets/dino_px）の表示倍率＝整数。元の絵の画面上の体高（待機の高さ × DINOS.scale）にいちばん近い整数倍（最低1）。
 * 例：スピノは 128px のドット絵 → 145px に近いので ×1。ぼかさずに拡大する倍率は整数だけ。
 */
export function pxScaleOf(assets, type) {
  const px = assets.pxOf(type);
  if (!px) return 0;
  if (DINOS[type].pxScale) return DINOS[type].pxScale;      // 版3.5：縮小版の雑魚（モササウルス小型）は小数倍率を固定で持つ
  const origH = assets.motions.dinos[type].idle.h * DINOS[type].scale;
  return Math.max(1, Math.round(origH / px.meta.idle.h));
}

/** ドット絵で1コマ描く（補間なし・整数倍・位置も整数）。描けなければ false。 */
function drawFramePx(ctx, assets, type, motion, frame, x, y, facing, o) {
  const px = assets.pxOf(type);
  if (!px) return false;
  const meta = px.meta.motions[motion], imgs = px.images[motion];
  if (!meta || !imgs) return false;
  const fr = meta.frames[clamp(frame, 0, meta.n - 1)];
  const img = imgs[fr[0]];
  if (!img) return false;
  const s = pxScaleOf(assets, type) * (o.scaleMul || 1);
  const flip = facing !== DINOS[type].artFacing;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  if (o.rot) {
    const bh = px.meta.idle.h * s;
    ctx.translate(0, -bh / 2); ctx.rotate(o.rot); ctx.translate(0, bh / 2);
  }
  if (flip) ctx.scale(-1, 1);
  if (o.sx !== undefined && o.sx !== 1) ctx.scale(o.sx, 1);      // 版2.7：縦の軸で回している間の横幅（足元の中心まわり）
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  ctx.drawImage(img, fr[1], fr[2], fr[3], fr[4], Math.round(-meta.anchorX * s), Math.round(-meta.ground * s), fr[3] * s, fr[4] * s);
  ctx.restore();
  return true;
}

export function drawFrame(ctx, assets, type, motion, frame, x, y, facing, o = {}) {
  if (assets.usePx && assets.pxOf(type) && drawFramePx(ctx, assets, type, motion, frame, x, y, facing, o)) return true;
  const d = DINOS[type];
  const meta = assets.motions.dinos[type].motions[motion];
  const imgs = assets.images(type, motion);
  if (!imgs || !meta) return false;
  const fr = meta.frames[clamp(frame, 0, meta.n - 1)];
  const img = imgs[fr[0]];
  if (!img) return false;
  const s = d.scale * ((d.motionScale && d.motionScale[motion]) || 1) * (o.scaleMul || 1);
  const flip = facing !== d.artFacing;
  ctx.save();
  ctx.translate(x, y);
  if (o.rot) {
    const bh = assets.motions.dinos[type].idle.h * d.scale * (o.scaleMul || 1);
    ctx.translate(0, -bh / 2); ctx.rotate(o.rot); ctx.translate(0, bh / 2);
  }
  if (flip) ctx.scale(-1, 1);
  if (o.sx !== undefined && o.sx !== 1) ctx.scale(o.sx, 1);      // 版2.7：縦の軸で回している間の横幅
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  ctx.drawImage(img, fr[1], fr[2], fr[3], fr[4], -meta.anchorX * s, -meta.ground * s, fr[3] * s, fr[4] * s);
  ctx.restore();
  return true;
}

/** 色を重ねた同じ絵（被弾の白・予兆の赤）。 */
function drawSilhouette(ctx, assets, type, motion, frame, x, y, facing, o, color, alpha) {
  const tc = tintCanvas();
  const tg = tc.getContext('2d');
  tg.setTransform(1, 0, 0, 1, 0, 0);
  tg.globalCompositeOperation = 'source-over';
  tg.clearRect(0, 0, TW, TH);
  const ox = TW / 2, oy = TH * 0.72;
  drawFrame(tg, assets, type, motion, frame, ox, oy, facing, { rot: o.rot, scaleMul: o.scaleMul, sx: o.sx });
  tg.globalCompositeOperation = 'source-atop';
  tg.fillStyle = color;
  tg.fillRect(0, 0, TW, TH);
  tg.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(tc, x - ox, y - oy);
  ctx.restore();
}

function supportBelow(world, e) {
  let best = world.groundY;
  for (const p of world.platforms) {
    if (e.x >= p.x - 10 && e.x <= p.x + p.w + 10 && p.y >= e.y - 6 && p.y < best) best = p.y;
  }
  return best;
}

function drawShadow(ctx, world, e) {
  if (world.water && (e.swim || (e.d && e.d.swim) || e.state === 'drown')) return;      // 版3.0：水の中・水面の影は描かない
  const sy = supportBelow(world, e);
  const h = Math.max(0, sy - e.y);
  const a = 0.38 * (1 - clamp(h / 320, 0, 1));
  if (a <= 0.02) return;
  const w = e.bw * 0.46 * (1 - clamp(h / 700, 0, 0.4));
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath(); ctx.ellipse(e.x, sy + 3, w, Math.max(7, w * 0.14), 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawStars(ctx, e, time) {
  const cx = e.x, cy = e.y - e.bh - 10;
  for (let i = 0; i < 3; i++) {
    const a = time * 4 + (i * Math.PI * 2) / 3;
    const sx = cx + Math.cos(a) * 46, sy = cy + Math.sin(a) * 12;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(a * 2);
    ctx.fillStyle = '#ffe14a'; ctx.strokeStyle = '#7a5a00'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) { const r = k % 2 ? 5 : 12; const t = (k * Math.PI) / 5; ctx.lineTo(Math.cos(t) * r, Math.sin(t) * r); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

function drawWarning(ctx, e, time, big) {
  const x = e.x, y = e.y - e.bh - (big ? 40 : 26);
  const pulse = 1 + Math.sin(time * 28) * 0.12;
  ctx.save();
  ctx.translate(x, y); ctx.scale(pulse * (big ? 1.5 : 1), pulse * (big ? 1.5 : 1));
  ctx.fillStyle = '#ff3b30'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillRect(-3.5, -12, 7, 14);
  ctx.beginPath(); ctx.arc(0, 8, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** 版2.7：技の表の aura（{phases, boost}）の区間にいるときのオーラの強さ。最初の区間（ため）は 0.35→boost へ燃え上がる。それ以外は null。 */
export function auraBurnOf(e) {
  if (e.state !== 'move' || !e.move) return null;
  const a = e.move.def.aura;
  if (!a || !a.phases.includes(e.move.i)) return null;
  const ph = e.move.def.phases[e.move.i];
  return e.move.i === a.phases[0] ? a.boost * (0.35 + 0.65 * clamp(e.move.pt / ph.dur, 0, 1)) : a.boost;
}

/**
 * 版2.7：回転なぎ払いの白い竜巻の弧と、まわりの風。尻尾の先の軌道（足元の中心まわりの扁平な円）に沿って、後ろへ細く消える光の帯を高さを変えて3本。
 * front=false は奥側（体より後ろ・描く前）、true は手前側（体の前・描いたあと）。滑らかな描画（ドット絵にしない）。
 */
function drawWhirl(ctx, e, yw, time, front) {
  const R = e.bw * 0.62, dirn = Math.sign(e.move.def.phases[e.move.i].pose.yaw.to - e.move.def.phases[e.move.i].pose.yaw.from) || 1;
  const levels = [[0.52, 0.92, 0.9], [0.38, 1.0, 1.0], [0.24, 1.08, 0.9], [0.10, 1.16, 0.7]];       // [高さ（体高の割合）, 半径の倍率, 濃さ]
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const [hk, rk, ak] of levels) {
    const cy = e.y - e.bh * hk, rx = R * rk, ry = rx * 0.17;
    const N = 30, span = 2.4;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const a0 = yw.a - dirn * span * t0, a1 = yw.a - dirn * span * t1;
      const am = (a0 + a1) / 2, depth = Math.sin(am);       // 手前（>0）か奥（<0）か
      if ((depth >= 0) !== front) continue;
      const px0 = e.x - e.facing * rx * Math.cos(a0), py0 = cy + ry * Math.sin(a0);
      const px1 = e.x - e.facing * rx * Math.cos(a1), py1 = cy + ry * Math.sin(a1);
      const fade = Math.pow(1 - t0, 1.6) * ak;
      ctx.strokeStyle = `rgba(190,232,255,${0.55 * fade})`; ctx.lineWidth = 36 * (1 - t0 * 0.7) * rk;
      ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px1, py1); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * fade})`; ctx.lineWidth = 13 * (1 - t0 * 0.8) * rk;
      ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px1, py1); ctx.stroke();
    }
    // 先端の光
    const dd = Math.sin(yw.a);
    if ((dd >= 0) === front) {
      const hx = e.x - e.facing * rx * Math.cos(yw.a), hy = cy + ry * dd;
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 34 * rk);
      g.addColorStop(0, `rgba(255,255,255,${0.85 * ak})`); g.addColorStop(1, 'rgba(160,220,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 34 * rk, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/** 版2.7：体のまわりを走る黄色い稲妻（ギガノト咆哮のため）。20fps で形が変わる。 */
function drawBolts(ctx, e, time, boost) {
  const seed = Math.floor(time * 20);
  const rnd = (n) => { const v = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453; return v - Math.floor(v); };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const N = Math.round(10 * Math.min(1.5, boost));
  for (let i = 0; i < N; i++) {
    let x = e.x + (rnd(i) - 0.5) * e.bw * 0.95, y = e.y - e.bh * (0.1 + 0.8 * rnd(i + 50));
    const pts = [[x, y]];
    for (let k = 0; k < 5; k++) { x += (rnd(i * 7 + k) - 0.5) * 60; y += (rnd(i * 11 + k + 90) - 0.7) * 50; pts.push([x, y]); }
    for (const [w, c] of [[7, 'rgba(255,200,40,0.35)'], [2.5, 'rgba(255,255,200,0.95)']]) {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([px, py], j) => (j ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawEntity(ctx, assets, world, e, time, opts = {}) {
  if (!e.anim) return;
  const frame = animFrame(e.anim, assets.motions.dinos[e.type].motions[e.anim.motion].n);
  let x = e.x, y = e.y;
  const vf = visFacing(e);
  if (e.guardShake > 0) x += Math.sin(time * 90) * 3;
  if (e.shakeX) x += e.shakeX;      // 版1.3：被弾・相殺で硬直している間の震え
  if (e.quake && e.state === 'idle') y -= Math.abs(Math.sin(e.quake.t / QUAKE.tele * Math.PI * QUAKE.stomps)) * 12;      // 版2.8b：足場ゆらしの予兆＝前足で地面を踏み鳴らす（体が持ち上がっては落ちる）
  // 歩きの動きが無いので、走り・歩きは待機を速回しして体を上下にゆらす（動作表 assets/motion_map.js の run / walk）
  const k = e.anim.key;
  if ((k === 'run' || k === 'dash' || k === 'walk') && e.anim.motion !== 'Run' && e.anim.motion !== 'Walk' && e.onGround && e.state !== 'bullet') y -= Math.abs(Math.sin(time * (e.isPlayer ? 13 : 9))) * (e.isPlayer ? 5 : 3);
  let spinAng = null, spinDir = 0;
  let rot = e.state === 'dying' ? e.rot : (e.state === 'bullet' ? (e.bul ? e.bul.rot : 0) : 0);
  // ジャンプ中は進行方向へ少し傾ける（ジャンプの動きが無いための代用）
  if (e.isPlayer && (k === 'jump' || k === 'fall')) rot = clamp(e.vy / 2200, -0.28, 0.28) * e.facing;
  if (e.isPlayer && e.swim && e.state === 'idle') rot = swimTilt(e);      // 版3.0：泳ぎは進む向き（上下）へ体を傾ける（world.js の entRot と同じ値）
  if (e.state === 'drown') rot = e.rot || 0;      // 版3.0：水に落ちてもがく
  // 専用の動きが無い技は、傾きと震えで見せる（motion_map.js の代用）。値は技の表の pose（区間ごと）：tilt 正=頭が下 / jitter=震え(px)
  if ((e.isPlayer || e.rival) && e.move) {     // 技の表で動くもの（主人公とライバル）
    const ph = e.move.def.phases[e.move.i];
    if (ph && ph.pose) {
      if (ph.pose.tilt !== undefined) rot = ph.pose.tilt * vf;
      if (ph.pose.spin) {   // 回転（宙返り）：区間の中で from→to(rad・正=頭が下＝前方宙返り) を緩急つきで回す。出だしゆっくり→加速→終わりで減速
        const u = clamp(e.move.pt / ph.dur, 0, 1), k = 0.5 - 0.5 * Math.cos(Math.PI * u);
        spinAng = ph.pose.spin.from + (ph.pose.spin.to - ph.pose.spin.from) * k;
        rot = spinAng * e.facing;
        spinDir = (ph.pose.spin.to - ph.pose.spin.from) * e.facing;
      }
      if (ph.pose.jitter) { x += Math.sin(time * 97) * ph.pose.jitter; y += Math.cos(time * 83) * ph.pose.jitter * 0.5; }
    }
  }
  if (e.state === 'rage') { x += Math.sin(e.rageT * 70) * 3; y += Math.cos(e.rageT * 63) * 1.5; }      // 版2.4：怒りの演出は力をためて震える
  let alpha;
  if (e.isPlayer && e.inv > 0 && e.state !== 'revive' && Math.floor(time * 18) % 2 === 0) alpha = 0.45;
  if (e.state === 'revive' && e.inv > 0 && Math.floor(time * 12) % 2 === 0) alpha = 0.6;
  // 版2.5：怒りの演出で体の大きさを変えない（旧：×1.05 まで膨らんで戻る＝戻りが「縮み」に見えた）。震えとオーラで見せる。
  const scaleMul = opts.scaleMul;
  // 版1.2：構えの絵が無い恐竜（アロ・スケルトン・ギガノト・ティラノ）のガードは、待機の1コマを低く・後ろへ少し引いて見せる
  // 版2.5：体の大きさは変えず（旧：×0.93 が1コマで効いて「一瞬縮む」）、後ろへ引く・傾けるだけを 0.12 秒でなめらかに。
  if (e.guarding && !e.isPlayer && !e.rival && !e.d.guard) { const gk = clamp((e.guardT || 0) / 0.12, 0, 1); x -= e.facing * e.bw * 0.05 * gk; rot += 0.04 * vf * gk; }
  // 版1.2：はじかれ中は体を後ろへ反らせる
  if (e.repelT > 0 && e.state === 'hurt') rot -= 0.1 * vf;
  const yw = yawOf(e);      // 版2.7：縦の軸で回している間（フューリーのなぎ払い）
  const o = { rot, scaleMul, alpha, sx: yw ? yw.sx : undefined };
  if (spinAng !== null) {   // 回転の残像（薄い2枚・少し前の角度）
    const u = clamp(e.move.pt / e.move.def.phases[e.move.i].dur, 0, 1);
    for (const [back, al] of [[0.22, 0.2], [0.11, 0.32]]) {
      const ph = e.move.def.phases[e.move.i].pose.spin;
      const k0 = 0.5 - 0.5 * Math.cos(Math.PI * clamp(u - back, 0, 1));
      if (u - back < 0) continue;
      drawFrame(ctx, assets, e.type, e.anim.motion, frame, x, y, vf, { ...o, rot: (ph.from + (ph.to - ph.from) * k0) * e.facing, alpha: al });
    }
  }
  // 版2.4：怒りのオーラ（絵の後ろに加算で重ねる・体の中は塗らない）。倒れる（dying）と消える。
  const burn = auraBurnOf(e);      // 版2.7：必殺技の力をためている間は、怒っていなくてもオーラが燃え上がる（四天王のフューリー）
  if ((e.rage || burn) && e.state !== 'dying' && !e.dead && !opts.noAura) {
    const age = Math.max(0, (world.time || 0) - (e.rageAt || 0));
    const rb = !e.rage ? 0 : e.state === 'rage' ? 0.9 + 0.6 * Math.sin(Math.min(1, e.rageT / RAGE.intro) * Math.PI * 0.5) : 0.9 * Math.exp(-Math.max(0, age - RAGE.intro) * 2.2);
    const boost = Math.max(rb, burn || 0);
    drawAura(ctx, x, y, (c, ox, oy) => drawFrame(c, assets, e.type, e.anim.motion, frame, ox, oy, vf, { ...o, alpha: undefined }),
      { key: e.id, maskKey: `${e.type}|${e.anim.motion}|${frame}|${vf}|${Math.round((o.rot || 0) * 100)}|${o.scaleMul || 1}|${Math.round((o.sx || 1) * 10)}`, bw: e.bw, bh: e.bh, time, color: (burn && e.move.def.aura.color) || auraColorOf(e.type), boost });
  }
  if (burn && e.move.def.aura.bolts) drawBolts(ctx, e, time, burn);      // 版2.7：黄色い稲妻（ギガノト咆哮のため）
  if (yw) drawWhirl(ctx, e, yw, time, false);      // 版2.7：白い竜巻の弧（奥側＝体の後ろ）
  // 版2.5：怒りに入る瞬間は、直前の絵（のけぞり・咆哮など）から待機へ RAGE.blend 秒かけて溶かす（頭の高さが1コマで 14% 落ちて「縮む」のを防ぐ）
  if (e.state !== 'rage') e.lastPose = { motion: e.anim.motion, frame };
  if (e.state === 'rage' && e.lastPose && e.lastPose.motion !== e.anim.motion && e.rageT < RAGE.blend) {
    drawFrame(ctx, assets, e.type, e.anim.motion, frame, x, y, vf, o);
    drawFrame(ctx, assets, e.type, e.lastPose.motion, e.lastPose.frame, x, y, vf, { ...o, alpha: (o.alpha === undefined ? 1 : o.alpha) * (1 - e.rageT / RAGE.blend) });
  } else drawFrame(ctx, assets, e.type, e.anim.motion, frame, x, y, vf, o);
  if (yw) drawWhirl(ctx, e, yw, time, true);      // 手前側（体の前）
  if (e.flash > 0) drawSilhouette(ctx, assets, e.type, e.anim.motion, frame, x, y, vf, o, '#ffffff', clamp(e.flash / 0.12, 0, 1) * 0.85);
  if (e.wakeInv > 0) drawSilhouette(ctx, assets, e.type, e.anim.motion, frame, x, y, vf, o, '#9fe8ff', 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(time * 40)));      // 版1.1b：起き上がりの無敵は水色の明滅
  if (e.tele) {
    const a = 0.18 + 0.16 * (0.5 + 0.5 * Math.sin(time * 26));
    drawSilhouette(ctx, assets, e.type, e.anim.motion, frame, x, y, vf, o, '#ff3b30', a);
  }
  if (e.tele) drawWarning(ctx, e, time, isBossLike(e.d));
  if (e.state === 'stun') drawStars(ctx, e, time);
  if (e.isPlayer) drawPlayerAura(ctx, e, time);
  if (e.guarding && e.guardT > 0.1 && !e.isPlayer) {
    // 防御の気配（正面に薄い光の盾）
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.1 * Math.sin(time * 14);
    ctx.fillStyle = '#9fe8ff';
    const sx = e.x + e.facing * e.bw * 0.46;
    ctx.beginPath(); ctx.ellipse(sx, e.y - e.bh * 0.5, 14, e.bh * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/** 主人公の気配：ガードの光の盾／頂点で止まっている間の淡い光／ダッシュの風。 */
function drawPlayerAura(ctx, e, time) {
  if (e.guarding) {
    const fl = e.guardFlash > 0 ? 1 : 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sx = e.x + e.facing * e.bw * 0.46, sy = e.y - e.bh * 0.5;
    const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, e.bh * 0.62);
    g.addColorStop(0, `rgba(190,245,255,${0.45 + fl * 0.4})`); g.addColorStop(0.6, `rgba(120,215,255,${0.22 + fl * 0.3})`); g.addColorStop(1, 'rgba(120,215,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(sx, sy, 34, e.bh * 0.58, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  if (e.hangT > 0) {
    const u = clamp(e.hangT / 0.55, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cx = e.x, cy = e.y - e.bh * 0.5, r = e.bh * (0.95 + 0.1 * Math.sin(time * 18));
    const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    g.addColorStop(0, `rgba(210,250,255,${0.25 * u})`); g.addColorStop(1, 'rgba(120,230,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/** 床を走る衝撃波：低くのびる光の楔と、後ろへ流れる光の筋。 */
function drawWaves(ctx, world, time) {
  for (const w of world.waves) {
    const u = w.t / w.life, a = 1 - u * u;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(w.x, w.y);
    ctx.scale(w.dir, 1);
    const L = 150 + 40 * Math.sin(time * 30), H0 = w.h * (1.05 + 0.08 * Math.sin(time * 40));
    const g = ctx.createLinearGradient(-L, 0, 24, 0);
    g.addColorStop(0, 'rgba(255,200,120,0)'); g.addColorStop(0.55, `rgba(255,236,170,${0.55 * a})`); g.addColorStop(1, `rgba(255,255,255,${0.95 * a})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-L, 3); ctx.quadraticCurveTo(-L * 0.3, -H0 * 0.5, 22, -H0); ctx.quadraticCurveTo(46, -H0 * 0.35, 40, 3); ctx.closePath(); ctx.fill();
    const g2 = ctx.createRadialGradient(18, -H0 * 0.35, 2, 18, -H0 * 0.35, H0);
    g2.addColorStop(0, `rgba(255,255,255,${0.8 * a})`); g2.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = g2; ctx.beginPath(); ctx.ellipse(18, -H0 * 0.35, H0 * 0.9, H0 * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,250,220,${0.6 * a})`; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) { ctx.lineWidth = 3 - i * 0.5; ctx.beginPath(); ctx.moveTo(-30 - i * 40, -6 - i * 9); ctx.lineTo(-90 - i * 60, -6 - i * 9); ctx.stroke(); }
    ctx.restore();
  }
}

// ---------- エフェクト ----------
function starburst(ctx, x, y, r, n, inner, color, lw) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * inner, Math.sin(a) * r * inner); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke();
  }
  ctx.restore();
}

export function drawFx(ctx, assets, world) {
  ctx.save();
  for (const f of world.fx) {
    const u = f.t / f.dur;
    switch (f.type) {
      case 'spark': {
        ctx.globalCompositeOperation = 'lighter';
        const s = f.size || 1;
        const a = 1 - u;
        if (f.kind === 'slash') {
          ctx.strokeStyle = `rgba(190,240,255,${a})`; ctx.lineCap = 'round';
          for (let i = 0; i < 3; i++) {
            ctx.lineWidth = (7 - i * 2) * (1 - u * 0.6);
            ctx.beginPath();
            const r = (46 + i * 14 + u * 28) * s;
            ctx.arc(f.x - f.dir * 14, f.y + 8, r, -1.2 + i * 0.1, 0.25 + i * 0.1);
            ctx.stroke();
          }
        }
        const col = f.kind === 'hurt' ? [255, 150, 110] : f.kind === 'guard' ? [170, 235, 255] : f.kind === 'wall' ? [255, 245, 200] : f.kind === 'parry' ? [255, 255, 255] : [255, 236, 170];
        const R = (f.kind === 'parry' ? 170 : f.kind === 'big' || f.kind === 'wall' ? 110 : f.kind === 'guard' ? 55 : 70) * s * (0.5 + u * 0.7);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, R * 0.8);
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.4, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.7})`); g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(f.x, f.y, R * 0.8, 0, Math.PI * 2); ctx.fill();
        starburst(ctx, f.x, f.y, R * 1.15, f.kind === 'parry' ? 20 : f.kind === 'big' ? 14 : 9, 0.25 + u * 0.3, `rgba(255,255,255,${a})`, f.kind === 'big' ? 5 : 3);
        break;
      }
      case 'kin': {      // 版1.3：相殺の「キン」。金色の十字の閃光が、横に長い線へ伸びて消える
        const s = f.size || 1, a = 1 - u * u;
        const hl = (26 + 190 * (1 - Math.pow(1 - u, 2))) * s, vl = (46 * (1 - u * 0.7)) * s, th = (11 * (1 - u)) * s + 1.5;
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 44 * s);
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.35, `rgba(255,214,90,${a * 0.7})`); g.addColorStop(1, 'rgba(255,190,40,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, 44 * s, 0, Math.PI * 2); ctx.fill();
        for (const [dx, dy, len, t] of [[1, 0, hl, th], [-1, 0, hl, th], [0, 1, vl, th * 0.8], [0, -1, vl, th * 0.8]]) {
          ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(dx ? 0 : Math.PI / 2);
          const L = len * (dx || dy);
          const lg = ctx.createLinearGradient(0, 0, L, 0);
          lg.addColorStop(0, `rgba(255,255,255,${a})`); lg.addColorStop(0.5, `rgba(255,224,110,${a * 0.8})`); lg.addColorStop(1, 'rgba(255,200,60,0)');
          ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(0, -t); ctx.lineTo(L, 0); ctx.lineTo(0, t); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        break;
      }
      case 'ring': {
        const r = lerp(f.r0, f.r1, 1 - Math.pow(1 - u, 2));
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = f.color; ctx.globalAlpha = (1 - u) * 0.9; ctx.lineWidth = f.w * (1 - u * 0.6);
        ctx.beginPath();
        if (f.flat) ctx.ellipse(f.x, f.y - 6, r, r * 0.16, 0, 0, Math.PI * 2);
        else ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'ember': {      // 版3.5：溶岩のしぶき（滑らかに光る粒）
        ctx.globalCompositeOperation = 'lighter';
        const r = f.r * (1 - u * 0.5) * 2.2, a = 0.95 * (1 - u * u);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, `rgba(255,${Math.round(235 - 60 * f.hot)},${Math.round(160 - 90 * f.hot)},${a})`); g.addColorStop(0.45, `rgba(255,120,30,${a * 0.7})`); g.addColorStop(1, 'rgba(255,70,10,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'drop': {      // 版3.0：水しぶきの水滴
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(225,247,255,${0.85 * (1 - u)})`;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - u * 0.4), 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'bubble': {      // 版3.0：水中の泡
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = `rgba(230,250,255,${0.7 * (1 - u)})`; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${0.25 * (1 - u)})`; ctx.fill();
        break;
      }
      case 'dust': {
        ctx.globalCompositeOperation = 'source-over';
        const r = f.r * (0.6 + u * 1.2);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        const a = 0.5 * (1 - u);
        g.addColorStop(0, `rgba(235,222,190,${a})`); g.addColorStop(1, 'rgba(235,222,190,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'streak': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255,255,255,${(1 - u) * 0.7})`; ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const yy = f.y + (i - 2.5) * 22, len = 90 + i * 12;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(f.x - f.dir * (40 + u * 80), yy); ctx.lineTo(f.x - f.dir * (40 + u * 80 + len), yy); ctx.stroke();
        }
        break;
      }
      case 'arc': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(200,245,255,${1 - u})`; ctx.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          ctx.lineWidth = (14 - i * 3) * (1 - u * 0.5);
          ctx.beginPath();
          ctx.arc(f.x - f.dir * 40, f.y + 20, (95 + i * 20 + u * 60) * f.size, f.dir > 0 ? -1.3 : Math.PI - 0.4, f.dir > 0 ? 0.4 : Math.PI + 1.3);
          ctx.stroke();
        }
        break;
      }
      case 'swipe': {    // 版2.4：爪の斬撃。3本線の光る弧が、爪の先の動きに沿って振り抜かれる（滑らかな描画・ドット絵にしない）
        ctx.globalCompositeOperation = 'lighter';
        const ease = (v) => 1 - Math.pow(1 - Math.min(1, Math.max(0, v)), 2.4);
        const head = f.a0 + (f.a1 - f.a0) * ease(u / 0.42);
        const tail = f.a0 + (f.a1 - f.a0) * ease((u - 0.16) / 0.72);
        const fade = u < 0.4 ? 1 : Math.max(0, 1 - Math.pow((u - 0.4) / 0.6, 1.5));
        if (fade <= 0 || Math.abs(head - tail) < 0.02) break;
        const N = 28;
        for (let li = 0; li < 3; li++) {
          const r = f.r * (0.84 + li * 0.16), wmax = f.w * (li === 1 ? 1.15 : 0.9);
          const pts = [];
          for (let k = 0; k <= N; k++) {
            const s = k / N, ang = tail + (head - tail) * s;
            const th = wmax * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.65)), 1.1);
            pts.push([f.x + f.dir * Math.cos(ang) * r, f.y + Math.sin(ang) * r, th, ang]);
          }
          for (const [wm, col, op] of [[3.0, `rgba(20,110,230,${0.38 * SWIPE_FX.glow * fade})`, 'source-over'], [2.0, `rgba(90,200,255,${0.4 * SWIPE_FX.glow * fade})`, 'lighter'], [1.2, `rgba(170,240,255,${0.7 * SWIPE_FX.glow * fade})`, 'lighter'], [0.6 * SWIPE_FX.core, `rgba(255,255,255,${0.95 * SWIPE_FX.glow * fade})`, 'lighter']]) {
            ctx.globalCompositeOperation = op; ctx.fillStyle = col; ctx.beginPath();
            for (let k = 0; k <= N; k++) { const [px, py, th, ang] = pts[k]; ctx.lineTo(px + f.dir * Math.cos(ang) * th * wm * 0.5, py + Math.sin(ang) * th * wm * 0.5); }
            for (let k = N; k >= 0; k--) { const [px, py, th, ang] = pts[k]; ctx.lineTo(px - f.dir * Math.cos(ang) * th * wm * 0.5, py - Math.sin(ang) * th * wm * 0.5); }
            ctx.closePath(); ctx.fill();
          }
        }
        // 爪の先の光
        const hx = f.x + f.dir * Math.cos(head) * f.r, hy = f.y + Math.sin(head) * f.r;
        const gg = ctx.createRadialGradient(hx, hy, 0, hx, hy, f.w * 3.2 * SWIPE_FX.tip);
        gg.addColorStop(0, `rgba(255,255,255,${0.9 * SWIPE_FX.tipA * fade})`); gg.addColorStop(1, 'rgba(120,220,255,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(hx, hy, f.w * 3.2 * SWIPE_FX.tip, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'mark': {      // 版2.7：ダウンバーストの目印。地面の白い輪（最初は主人公を追い、固定されると細く光って柱を待つ）
        const locked = f.t >= f.follow, pulse = 0.6 + 0.4 * Math.sin(f.t * 22), k = 1 - u;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = locked ? `rgba(255,255,255,${0.55 + 0.4 * pulse})` : 'rgba(170,225,255,0.6)'; ctx.lineWidth = locked ? 6 : 4;
        for (const rr of [78, 58]) { ctx.beginPath(); ctx.ellipse(f.x, f.y - 4, rr * (locked ? 1 : 1.12), rr * 0.2 * (locked ? 1 : 1.12), 0, 0, Math.PI * 2); ctx.stroke(); }
        if (locked) {
          const g = ctx.createLinearGradient(0, f.y - 700, 0, f.y); g.addColorStop(0, 'rgba(210,240,255,0)'); g.addColorStop(1, `rgba(210,240,255,${0.28 * pulse * k * 2})`);
          ctx.fillStyle = g; ctx.fillRect(f.x - 70, f.y - 700, 140, 700);
        }
        break;
      }
      case 'pillar': {      // 版2.7：風の柱。上から落ちてきて、らせん状の白い帯が走り、消えていく（当たり＝幅 w の全高）
        const fall = clamp(u / 0.18, 0, 1), top = f.y - 800, bot = lerp(top, f.y, 1 - Math.pow(1 - fall, 2));
        const a = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3, w = pillarWidth(f.w, u);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(f.x - w / 2, 0, f.x + w / 2, 0);
        g.addColorStop(0, 'rgba(120,200,255,0)'); g.addColorStop(0.2, `rgba(150,215,255,${0.55 * a})`); g.addColorStop(0.5, `rgba(255,255,255,${0.95 * a})`); g.addColorStop(0.8, `rgba(150,215,255,${0.55 * a})`); g.addColorStop(1, 'rgba(120,200,255,0)');
        ctx.fillStyle = g; ctx.fillRect(f.x - w / 2, top, w, bot - top);
        ctx.strokeStyle = `rgba(255,255,255,${0.85 * a})`; ctx.lineWidth = 10; ctx.lineCap = 'round';
        for (let k = 0; k < 6; k++) { const yy = bot - ((k * 120 + f.t * 900) % 720); if (yy < top) continue; ctx.beginPath(); ctx.ellipse(f.x, yy, w * 0.62, w * 0.14, 0, Math.PI * 0.08, Math.PI * 0.92); ctx.stroke(); }
        ctx.globalAlpha = 1;
        break;
      }
      case 'rock': {      // 版2.8：飛び散る岩（滑らかな描画）。ぎざぎざの多角形・暗い縁・明るい面。止まったら端で薄くなって消える
        const a = clamp((f.dur - f.t) / 0.4, 0, 1), s = f.size;
        ctx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.translate(f.x, f.y - s * 0.4); ctx.rotate(f.rot); ctx.globalAlpha = a;
        const pts = [];
        for (let i = 0; i < 7; i++) { const ang = (i / 7) * Math.PI * 2, r = s * (0.7 + 0.45 * Math.abs(Math.sin(f.seed * 12.9 + i * 4.1))); pts.push([Math.cos(ang) * r, Math.sin(ang) * r * 0.82]); }
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
        ctx.fillStyle = '#5d5047'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#2a211c'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.lineTo(pts[2][0] * 0.4, pts[2][1] * 0.4); ctx.closePath();
        ctx.fillStyle = '#8f7d6c'; ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
        break;
      }
      case 'crack': {      // 版2.8：地面のひび。中心から左右へ伸び（最初の 0.12 秒）、しばらく残って薄くなる。暗い線の上に細い明るい縁
        const grow = clamp(f.t / 0.12, 0, 1), a = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
        ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'round';
        for (const pass of [0, 1]) {
          ctx.strokeStyle = pass === 0 ? `rgba(12,6,4,${0.95 * a})` : `rgba(255,236,190,${0.6 * a})`;
          for (const [x0, y0, x1, y1, w] of f.segs) {
            const dx = Math.abs(x0 - f.x);
            if (dx > 240 * grow) continue;
            ctx.lineWidth = (pass === 0 ? 5.5 : 2.2) * (0.5 + w);
            ctx.beginPath(); ctx.moveTo(x0, y0 + (pass ? -1.5 : 0)); ctx.lineTo(x1, y1 + (pass ? -1.5 : 0)); ctx.stroke();
          }
        }
        break;
      }
      case 'ghost': {
        ctx.globalCompositeOperation = 'lighter';
        drawFrame(ctx, assets, f.who, f.motion, f.frame, f.x, f.y, f.facing, { alpha: 0.4 * (1 - u) });
        break;
      }
      default: break;
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  // 数字・文字
  for (const t of world.texts) {
    const u = t.t / t.dur;
    const pop = u < 0.15 ? 0.6 + u / 0.15 * 0.6 : 1.2 - Math.min(0.2, (u - 0.15) * 0.5);
    ctx.save();
    let tx = t.x;
    if (t.num !== undefined) {      // 版3.5：桁が増えても画面の端で切れない（ダメージの数字だけ。幅を測って画面の内側へ寄せる）
      ctx.font = `900 ${t.size}px ${FONT_EN}`;
      const half = ctx.measureText(dispDamage(t.num)).width * 0.6 + 8;
      tx = clamp(tx, half, W - half);
    }
    ctx.translate(tx, t.y); ctx.scale(pop, pop);
    text(ctx, t.num !== undefined ? dispDamage(t.num) : t.str, 0, 0, { size: t.size, color: t.color, align: 'center', font: `900 ${t.size}px ${FONT_EN}`, alpha: clamp(2 - u * 2, 0, 1), lw: 6 });
    ctx.restore();
  }
}

// ---------- 世界全体 ----------
export function drawWorld(ctx, assets, world, view = {}) {
  const time = view.time || 0;
  const shake = world.shake;
  ctx.save();
  if (shake > 0.3) ctx.translate((Math.random() - 0.5) * shake * 1.6, (Math.random() - 0.5) * shake * 1.2);
  const camY = world.camY || 0;      // 版2.3：縦スクロール（0 か負）。背景は自分でずらし、世界のものはまとめてずらす
  drawBackground(ctx, assets, world.stage, 0, camY);
  if (world.eruption) drawEruption(ctx, world.eruption, camY);      // 版2.7：背景の火山の噴火（光と煙）
  ctx.save();
  ctx.translate(0, -camY);
  const shakeOf = (i) => (world.platforms[i] ? world.quakeAmp(world.platforms[i]) : 0);      // 版2.8b：足場ゆらしの予兆のゆれ
  if (world.water) drawSeaBackdrop(ctx, world, time);      // 版3.0：海の背景（空・水面・海中・海底）
  if (world.lava) drawLava(ctx, world, time);      // 版3.0：マグマだまり（床の穴）と、背景から落ちる溶岩の滝
  if (world.water) drawSeaPlatforms(ctx, world.stage, time, shakeOf); else drawPlatforms(ctx, world.stage, 0, shakeOf, time);
  // 影
  for (const e of world.enemies) {
    if (e.state === 'dying') continue;
    if (e.state === 'enter' && (e.x < -e.bw * 0.5 || e.x > W + e.bw * 0.5)) continue;
    drawShadow(ctx, world, e);
  }
  if (world.player) drawShadow(ctx, world, world.player);
  // 敵（足の位置が奥のものから）
  const order = [...world.enemies].sort((a, b) => (a.state === 'dying') - (b.state === 'dying') || a.y - b.y);
  for (const e of order) drawEntity(ctx, assets, world, e, time, { noAura: view.noAura });
  if (world.player) drawEntity(ctx, assets, world, world.player, time);
  drawWaves(ctx, world, time);
  if (!world.water && world.stage.cliff) drawLandCliffs(ctx, world);      // 版3.3：陸の面の断崖（ステージパッケージのギミック）
  if (world.water) drawWaterOverlay(ctx, world, time);      // 版3.0：水の膜と水面の波（敵・足場の上に重ねる）
  if (world.bombs && world.bombs.length) drawBombs(ctx, world, time);      // 版2.7：火山弾
  // 空中ジャンプが残っている印（空中で当てると戻る）：頭の上で脈打つ青い矢印
  const pl = world.player;
  if (pl && pl.airJumps > 0 && !pl.onGround && pl.state !== 'down' && pl.state !== 'downed') {
    const pulse = 0.55 + 0.45 * Math.sin(time * 14);
    ctx.save();
    ctx.translate(pl.x, pl.y - pl.bh - 26 - Math.sin(time * 10) * 3);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#7df0ff'; ctx.strokeStyle = '#0b3a52'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    for (const dy of [0, -12]) { ctx.beginPath(); ctx.moveTo(-15, dy + 8); ctx.lineTo(0, dy - 6); ctx.lineTo(15, dy + 8); ctx.lineTo(8, dy + 8); ctx.lineTo(0, dy); ctx.lineTo(-8, dy + 8); ctx.closePath(); ctx.stroke(); ctx.fill(); }
    ctx.restore();
  }
  // 版2.3：くわえられている間の「左右を交互に連打」の表示（頭の上に ← → と、抜けるまでの目盛り）
  if (pl && pl.state === 'grabbed' && pl.grab) {
    const g = pl.grab, bx = clamp(pl.x, 150, W - 150), by = Math.max(60, pl.y - pl.bh - 70);
    const flick = Math.floor(time * 10) % 2 === 0;
    ctx.save();
    ctx.translate(bx, by);
    ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = '#2a0d0d';
    ctx.fillStyle = flick ? '#ffd24a' : '#ffffff';
    ctx.strokeText('← →', 0, 0); ctx.fillText('← →', 0, 0);
    const n = g.need, pw = 22, gap = 6, tw = n * pw + (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      const px = -tw / 2 + i * (pw + gap);
      ctx.fillStyle = i < g.got ? '#7df0ff' : 'rgba(20,20,30,0.75)';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.fillRect(px, 24, pw, 12); ctx.strokeRect(px, 24, pw, 12);
    }
    ctx.restore();
  }
  drawFx(ctx, assets, world);
  if (view.debug) drawDebug(ctx, world);
  if (view.hitbox) drawHitbox(ctx, world);
  ctx.restore();      // カメラ
  ctx.restore();
  // 画面の端を少し暗く
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.55, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (world.flashFx) {
    ctx.save();
    ctx.globalAlpha = 1 - world.flashFx.t / world.flashFx.dur;
    ctx.fillStyle = world.flashFx.color; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (world.cutin) drawCutin(ctx, assets, world.cutin);      // 版2.7：カットイン（画面を止めて目のアップの帯が横切る）
}

/**
 * 版2.7：目のカットイン（四天王スピノフューリー）。本編の動画から切り出した目のアップ（assets/fx/spino_fury_eye の連番・横長の帯）を、
 * 画面中央を横切る帯で見せる。出だしは上下の黒帯が閉じて帯が開き、終わりで閉じる。画面全体は少し暗くなる。絵が無いときも暗転と光る目の簡易版を出す。
 */
export function drawCutin(ctx, assets, c) {
  const u = clamp(c.t / c.dur, 0, 1);
  const k0 = clamp(u / 0.16, 0, 1), k1 = clamp((1 - u) / 0.14, 0, 1), k = Math.min(k0, k1), ek = 1 - Math.pow(1 - k, 2.2);
  const imgs = assets && assets.cutin && assets.cutin[c.kind];
  const bandH = W / (c.aspect || 3.86), cy = H * 0.47, h = bandH * ek;
  ctx.save();
  ctx.fillStyle = `rgba(0,0,12,${0.5 * ek})`; ctx.fillRect(0, 0, W, H);
  // 帯（上下へ開く）
  ctx.beginPath(); ctx.rect(0, cy - h / 2, W, h); ctx.clip();
  const idx = imgs && imgs.length ? Math.min(imgs.length - 1, Math.floor(u * imgs.length)) : -1;
  if (idx >= 0 && imgs[idx]) {
    const zoom = 1.0 + 0.05 * (1 - u);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(imgs[idx], (W - W * zoom) / 2, cy - (bandH * zoom) / 2, W * zoom, bandH * zoom);
  } else {
    ctx.fillStyle = '#071a3a'; ctx.fillRect(0, cy - bandH / 2, W, bandH);
    for (const sx of [W * 0.34, W * 0.66]) { const g = ctx.createRadialGradient(sx, cy, 0, sx, cy, 90); g.addColorStop(0, 'rgba(210,255,255,1)'); g.addColorStop(0.4, 'rgba(60,230,255,0.85)'); g.addColorStop(1, 'rgba(0,160,255,0)'); ctx.fillStyle = g; ctx.fillRect(sx - 90, cy - 90, 180, 180); }
  }
  ctx.restore();
  // 帯の上下の縁（光る線）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const sgn of [-1, 1]) {
    const y = cy + sgn * h / 2;
    const g = ctx.createLinearGradient(0, y - 5, 0, y + 5);
    g.addColorStop(0, 'rgba(120,220,255,0)'); g.addColorStop(0.5, `rgba(190,245,255,${0.9 * ek})`); g.addColorStop(1, 'rgba(120,220,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, y - 5, W, 10);
  }
  ctx.restore();
}

/** 版2.7：背景の火山の噴火。山頂から広がる橙の光・立ちのぼる煙のかたまり・飛び散る火の粉。滑らかな描画（ドット絵にしない）。 */
function drawEruption(ctx, er, camY) {
  const u = er.t / er.dur, a = u < 0.12 ? u / 0.12 : Math.max(0, 1 - (u - 0.12) / 0.88);
  const x = er.x, y = er.y - camY;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const R = 220 + 160 * Math.min(1, u * 3);
  const g = ctx.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, `rgba(255,240,170,${0.85 * a})`); g.addColorStop(0.3, `rgba(255,150,50,${0.5 * a})`); g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  // 光の柱
  const gp = ctx.createLinearGradient(0, y - 360, 0, y);
  gp.addColorStop(0, 'rgba(255,170,70,0)'); gp.addColorStop(1, `rgba(255,200,110,${0.55 * a})`);
  ctx.fillStyle = gp; ctx.fillRect(x - 38 - 20 * u, y - 360, 76 + 40 * u, 360);
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 9; i++) {      // 煙のかたまり（上へ昇って広がる）
    const k = Math.min(1, u * 1.4 + i * 0.05), px = x + Math.sin(i * 2.3) * 70 * k, py = y - 30 - 260 * k * (0.5 + 0.1 * i), r = 40 + 70 * k + i * 6;
    const gs = ctx.createRadialGradient(px, py, 0, px, py, r);
    gs.addColorStop(0, `rgba(70,55,55,${0.55 * a})`); gs.addColorStop(1, 'rgba(50,40,40,0)');
    ctx.fillStyle = gs; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {      // 火の粉
    const ang = -Math.PI / 2 + (i - 7) * 0.16, sp = 160 + (i % 5) * 60, tt = er.t * 0.8 + i * 0.03;
    ctx.fillStyle = `rgba(255,${170 + (i % 3) * 30},80,${0.8 * a})`;
    ctx.beginPath(); ctx.arc(x + Math.cos(ang) * sp * tt, y + Math.sin(ang) * sp * tt + 260 * tt * tt, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** 版2.7：火山弾。予告＝地面の赤い印（点滅しながら縮む・落ちる直前に濃くなる）／落下＝尾を引く燃える岩石が斜め上から落ちる。 */
function drawBombs(ctx, world, time) {
  ctx.save();
  for (const b of world.bombs) {
    if (b.state === 'wait') continue;
    if (b.state === 'mark') {
      const k = b.t / b.warn, pulse = 0.5 + 0.5 * Math.sin(b.t * (14 + 20 * k));      // 点滅は火山弾自身の経過（b.t）で進める＝ポーズ中は止まる（実時間だとポーズの画面でも点滅して、絵の比べ検査が揺れた。2026-10-25）
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,70,40,${0.5 + 0.4 * k})`; ctx.lineWidth = 5;
      const rr = b.r * (2.0 - 0.3 * k);      // 2026-10-24：着地の輪（半径 b.r×1.7 まで広がる）にも当たりを付けたので、予告の赤い楕円も最後は b.r×1.7（輪の外縁）まで
      ctx.beginPath(); ctx.ellipse(b.x, b.y - 4, rr, rr * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(255,60,30,${(0.12 + 0.25 * k) * (0.6 + 0.4 * pulse)})`;
      ctx.beginPath(); ctx.ellipse(b.x, b.y - 4, rr, rr * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(0,0,0,${0.18 * k})`; ctx.beginPath(); ctx.ellipse(b.x, b.y - 2, rr * 0.7, rr * 0.15, 0, 0, Math.PI * 2); ctx.fill();
    } else if (b.state === 'fall') {
      const k = Math.min(1, b.t / b.fall), sx = b.x - 260, sy = b.y - 760;
      const x = sx + (b.x - sx) * k * k, y = sy + (b.y - sy) * k * k;
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(x - 120 * (1 - k * 0.3), y - 300 * 0.45, x, y);
      g.addColorStop(0, 'rgba(255,120,30,0)'); g.addColorStop(1, 'rgba(255,200,90,0.8)');
      ctx.strokeStyle = g; ctx.lineWidth = 26; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - 120 * (1 - k * 0.3), y - 135 * (1 - k * 0.2)); ctx.lineTo(x, y); ctx.stroke();
      const gb = ctx.createRadialGradient(x, y, 0, x, y, 34);
      gb.addColorStop(0, 'rgba(255,255,220,1)'); gb.addColorStop(0.45, 'rgba(255,150,40,0.9)'); gb.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.fillStyle = gb; ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#3a2418'; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/** 当たり判定の確認表示（?hitbox=1 または H キー）：緑＝体（絵の不透明画素から作ったマス）／赤＝いま出ている攻撃の当たる部位／橙の枠＝コンボ中の空中の敵に対する余裕ぶんの膨らみ。 */
function drawHitbox(ctx, world) {
  ctx.save();
  const cells = (a, fill, stroke) => {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1;
    for (let i = 0; i < a.length; i += 4) { ctx.fillRect(a[i], a[i + 1], a[i + 2] - a[i], a[i + 3] - a[i + 1]); ctx.strokeRect(a[i] + 0.5, a[i + 1] + 0.5, a[i + 2] - a[i] - 1, a[i + 3] - a[i + 1] - 1); }
  };
  for (const e of [world.player, ...world.enemies]) {
    if (!e || e.state === 'dying' || !e.anim) continue;
    const b = world.bodyCells(e);
    if (b) cells(b, 'rgba(60,255,120,0.16)', 'rgba(60,255,120,0.55)');
    else { const hb = world.hurtBox(e); ctx.strokeStyle = '#3cff7a'; ctx.strokeRect(hb.x0, hb.y0, hb.x1 - hb.x0, hb.y1 - hb.y0); }
    if (e.move) {
      const ph = e.move.def.phases[e.move.i];
      if (ph && ph.hit && !e.move.def.hits[ph.hit].ring && !e.move.def.hits[ph.hit].disk) {
        const hit = e.move.def.hits[ph.hit];
        const a = world.partCells(e, hit.part);
        if (a) cells(a, 'rgba(255,60,50,0.30)', 'rgba(255,60,50,0.9)');
        else { const bx = world.hitBox(e, hit); ctx.fillStyle = 'rgba(255,60,50,0.18)'; ctx.fillRect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0); ctx.strokeStyle = 'rgba(255,60,50,0.9)'; ctx.strokeRect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0); }
        if (e.isPlayer && world.combo > 0 && HIT_TUNE.airPad > 0) {
          const pa = world.partCells(e, hit.part, HIT_TUNE.airPad);
          if (pa) { ctx.strokeStyle = 'rgba(255,170,40,0.55)'; for (let i = 0; i < pa.length; i += 4) ctx.strokeRect(pa[i] + 0.5, pa[i + 1] + 0.5, pa[i + 2] - pa[i] - 1, pa[i + 3] - pa[i + 1] - 1); }
        }
      }
    }
  }
  // 絵の外へ出る攻撃：床を走る輪の線（当たり判定そのもの）・敵の衝撃波の楔
  for (const f of world.fx) {
    if (f.type !== 'ring' || !f.hit || f.hit.owner.dead) continue;
    const u = f.t / f.dur;
    if (u >= RING_LIVE_U) continue;
    cells(ringBandCells(f, u), 'rgba(255,60,50,0.35)', 'rgba(255,60,50,0.9)');
  }
  for (const w of world.waves) if (w.owner) cells(waveCells(w), 'rgba(255,60,50,0.30)', 'rgba(255,60,50,0.9)');
  for (const rs of world.roars || []) {      // 版3.5：咆哮の円盤（口を中心に同心円に広がる当たり）
    const r = world.roarRadius(rs, rs.hitT);
    if (r <= 0) continue;
    ctx.fillStyle = 'rgba(255,60,50,0.16)'; ctx.strokeStyle = 'rgba(255,60,50,0.95)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(rs.cx, rs.cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(rs.cx, rs.cy, 3, 0, Math.PI * 2); ctx.stroke();
  }
  if (world.lava) drawLavaHitbox(ctx, world);      // 版3.1：溶岩の当たり（足の線での池の幅）
  ctx.restore();
}

function drawDebug(ctx, world) {
  ctx.save();
  ctx.lineWidth = 2;
  const all = [world.player, ...world.enemies];
  for (const e of all) {
    if (!e || e.state === 'dying') continue;
    const hb = world.hurtBox(e);
    ctx.strokeStyle = '#3cff7a';
    ctx.strokeRect(hb.x0, hb.y0, hb.x1 - hb.x0, hb.y1 - hb.y0);
    if (e.move) {
      const ph = e.move.def.phases[e.move.i];
      if (ph && ph.hit) {
        const b = world.hitBox(e, e.move.def.hits[ph.hit]);
        ctx.strokeStyle = '#ff3b30';
        ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      }
    }
    ctx.fillStyle = '#fff'; ctx.font = '12px monospace';
    ctx.fillText(`${e.type} ${e.state}${e.move ? ':' + e.move.name + e.move.i : ''} hp${Math.round(e.hp)}`, e.x - 40, e.y - e.bh - 6);
  }
  ctx.restore();
}
