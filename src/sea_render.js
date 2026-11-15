// 版3.0：海の描画（背景・足場・水の重ね）。絵のファイルは使わず、描画で作る（空・水面・海中・海底・光の筋・海藻）。
// アンモナイト・巨大な渦巻きの飾りは入れない。world の座標（カメラの平行移動のあと）で呼ぶ。動きは time（秒）で決め、乱数は使わない（ちらつかない）。
import { SEA_PARTS_META as PM } from './sea_parts_meta.js';
const W = 1280, H = 720;

/** 海の見た目（面の bg.look）。空の上・下／海の浅い所・深い所／海底の砂。 */
export const SEA_LOOKS = {
  shore: { skyTop: '#5fb0ea', skyBot: '#d3edf8', seaTop: '#34a0d0', seaDeep: '#0b3560', sand: '#d8c690', rays: 0.17 },
  noon:  { skyTop: '#3f9fe6', skyBot: '#c4e6f7', seaTop: '#2c8fd2', seaDeep: '#0a2f5e', sand: '#d2c288', rays: 0.2 },
  deep:  { skyTop: '#5c7fa6', skyBot: '#adc8d9', seaTop: '#2776a4', seaDeep: '#051a33', sand: '#a9a27e', rays: 0.13 },
  dusk:  { skyTop: '#3a3d70', skyBot: '#f2a67c', seaTop: '#2d6593', seaDeep: '#061428', sand: '#b3a07a', rays: 0.12 },
};

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const lookOf = (st) => SEA_LOOKS[(st.bg && st.bg.look)] || SEA_LOOKS.shore;

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- 縦長の背景絵（assets/bg/sea/seaN.webp＝1280×1920。空→水面→海中が1枚）。bg.wl＝絵の高さに対する水面の位置（0〜1）。読めていなければ描画の海で代用。
const ART = {}, ART_H = 1920;
export function setSeaArt(key, img) {
  let top = '#000', bot = '#000';
  try {      // 絵の上下の端の色（絵の外を同じ色で延ばす）
    const c = document.createElement('canvas'); c.width = 1; c.height = 2; const g = c.getContext('2d');
    g.drawImage(img, 0, 0, img.width, 4, 0, 0, 1, 1); g.drawImage(img, 0, img.height - 4, img.width, 4, 0, 1, 1, 1);
    const a = g.getImageData(0, 0, 1, 2).data; top = `rgb(${a[0]},${a[1]},${a[2]})`; bot = `rgb(${a[4]},${a[5]},${a[6]})`;
  } catch (e) { /* 端の色は黒のまま */ }
  ART[key] = { img, top, bot };
}
const artOf = (st) => { const k = st.bg && st.bg.art; return k ? ART[k] || null : null; };
/** 縦長の絵（陸の面の背景にも使う：火山）。bg＝面の bg。読めていなければ null。 */
export const tallArtOf = (bg) => (bg && bg.art ? ART[bg.art] || null : null);
/** 陸の面の縦長の背景絵：絵の地平線（高さ hl）を世界の y＝hz に合わせて置く。camY は 0 か負。絵の上下の外は端の色で延ばす。 */
export function drawTallArt(ctx, art, bg, offsetX, camY) {
  const ty = (bg.hz ?? 300) - (bg.hl ?? 0.7) * ART_H - camY;
  if (ty > 0) { ctx.fillStyle = art.top; ctx.fillRect(offsetX, 0, W, ty + 1); }
  ctx.drawImage(art.img, offsetX, ty, W, ART_H);
  if (ty + ART_H < H) { ctx.fillStyle = art.bot; ctx.fillRect(offsetX, ty + ART_H - 1, W, H - ty - ART_H + 1); }
}

/** 空・水面・海中・光の筋・海底（と裂け目）。足場・敵より後ろ。 */
export function drawSeaBackdrop(ctx, world, time) {
  const st = world.stage, wy = world.water.y, gy = world.groundY, look = lookOf(st);
  const cam = world.camY || 0, y0 = cam - 40, y1 = cam + H + 40;
  const art = artOf(st);
  if (art) {      // 絵の海：水面の位置を絵の水面に合わせて置く。絵の上下の外は端の色で延ばす。海底の砂・裂け目だけ描画（落ちる所は遊びの仕掛け）
    const ty = wy - (st.bg.wl ?? 0.46) * ART_H;
    if (y0 < ty) { ctx.fillStyle = art.top; ctx.fillRect(0, y0, W, ty - y0 + 1); }
    ctx.drawImage(art.img, 0, ty, W, ART_H);
    if (y1 > ty + ART_H) { ctx.fillStyle = art.bot; ctx.fillRect(0, ty + ART_H - 1, W, y1 - ty - ART_H + 1); }
    if (PARTS.rays && y1 > wy) {      // 水中の光の筋（GPT の絵・加算）。背景絵の光に、ゆっくり揺れる光を重ねる
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 * (0.8 + 0.2 * Math.sin(time * 0.7));
      ctx.drawImage(PARTS.rays, Math.sin(time * 0.22) * 22 - 20, wy, W + 40, ART_H); ctx.restore();
    }
    if (y1 > wy) drawSeabed(ctx, world, look, time, y0, y1);
    return;
  }
  // 空（水面より上）
  if (y0 < wy) {
    const g = ctx.createLinearGradient(0, wy - 900, 0, wy);
    g.addColorStop(0, look.skyTop); g.addColorStop(1, look.skyBot);
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, Math.min(y1, wy) - y0);
    // 雲（カメラの半分の速さで動く＝奥行き）
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 7; i++) {
      const cx = ((hash(i + 1) * (W + 400) + time * (6 + i * 1.5)) % (W + 400)) - 200, cyy = wy - 330 - hash(i + 9) * 520 + cam * 0.5;
      const sc = 0.7 + hash(i + 20) * 0.9;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(cx + (k - 1.5) * 46 * sc, cyy + (k % 2 ? -8 : 0) * sc, 60 * sc, 26 * sc, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    // 太陽（夕焼けは低く大きく）
    const sx = look === SEA_LOOKS.dusk ? 980 : 260, sy = look === SEA_LOOKS.dusk ? wy - 130 : wy - 520 + cam * 0.4;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, look === SEA_LOOKS.dusk ? 190 : 150);
    sg.addColorStop(0, look === SEA_LOOKS.dusk ? 'rgba(255,230,170,0.95)' : 'rgba(255,255,230,0.9)'); sg.addColorStop(0.3, 'rgba(255,240,190,0.35)'); sg.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 190, 0, Math.PI * 2); ctx.fill();
    // 遠くの島（水平線のシルエット）
    ctx.fillStyle = look === SEA_LOOKS.dusk ? 'rgba(40,40,80,0.4)' : 'rgba(90,140,170,0.3)';
    for (let i = 0; i < 3; i++) {
      const bx = 80 + i * 470 + hash(i + 40) * 160, bw = 150 + hash(i + 50) * 150, bh = 22 + hash(i + 60) * 30;
      ctx.beginPath(); ctx.moveTo(bx - bw / 2, wy); ctx.quadraticCurveTo(bx - bw * 0.2, wy - bh * 1.6, bx, wy - bh); ctx.quadraticCurveTo(bx + bw * 0.25, wy - bh * 1.3, bx + bw / 2, wy); ctx.closePath(); ctx.fill();
    }
  }
  // 海中（水面より下）
  if (y1 > wy) {
    const top = Math.max(y0, wy);
    const g = ctx.createLinearGradient(0, wy, 0, gy + 160);
    g.addColorStop(0, look.seaTop); g.addColorStop(1, look.seaDeep);
    ctx.fillStyle = g; ctx.fillRect(0, top, W, y1 - top);
    // 光の筋（水面から斜めに差す）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const x = hash(i + 70) * W + Math.sin(time * 0.35 + i * 1.7) * 50, wd = 50 + hash(i + 80) * 90, sk = 170 + hash(i + 90) * 120, len = 760 + hash(i + 95) * 360;
      const a = look.rays * (0.6 + 0.4 * Math.sin(time * 0.8 + i * 2.1));
      const lg = ctx.createLinearGradient(0, wy, 0, wy + len);
      lg.addColorStop(0, `rgba(200,240,255,${a})`); lg.addColorStop(1, 'rgba(200,240,255,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.moveTo(x - wd / 2, wy); ctx.lineTo(x + wd / 2, wy); ctx.lineTo(x + wd / 2 + sk + wd * 0.6, wy + len); ctx.lineTo(x - wd / 2 + sk - wd * 0.6, wy + len); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    drawSeabed(ctx, world, look, time, y0, y1);
  }
}

function solidRanges(world) {
  const out = []; let x = 0;
  for (const g of [...world.gaps].sort((a, b) => a.x0 - b.x0)) { if (g.x0 > x) out.push([x, g.x0]); x = Math.max(x, g.x1); }
  if (x < W) out.push([x, W]);
  return out;
}

/** 海底の部品が絵（GPT）で揃っているか。揃っていなければ従来の描画。 */
const haveBed = () => !!(PARTS.seabed);
const havePropArt = () => !!(PARTS.kelp1 && PARTS.kelp2 && PARTS.kelp3 && PARTS.coral1 && PARTS.coral2 && PARTS.coral3 && PARTS.rock1 && PARTS.rock2 && PARTS.rock3);
/** 裂け目の縁の岩のぎざぎざの幅（砂はこの分だけ裂け目から引く）。縁の絵が無ければ 0。 */
export const riftDelta = () => (PARTS.rift_edge ? PM.rift_edge.delta : 0);
/** 縁の岩の絵の横幅（砂の断面をおおう幅）。縁の絵が無ければ 0。試験用。 */
export const riftEdgeWidth = () => (PARTS.rift_edge ? PM.rift_edge.w : 0);
/** 裂け目の絵の見た目の左右の端（当たり判定の幅 g.x0〜g.x1 の外側に、縁の岩の分だけ広がる）。試験用。 */
export const riftSpan = (g) => ({ x0: g.x0 - riftDelta(), x1: g.x1 + riftDelta() });

/** 海底の砂・岩・海藻・サンゴと、海底の裂け目（底なしの穴）。絵（GPT）があれば絵、無ければ描画。当たり判定は world の gaps・pit のまま（見た目だけ）。 */
function drawSeabed(ctx, world, look, time, y0, y1) {
  const gy = world.groundY;
  if (y1 < gy - 260) return;
  const bottom = Math.max(y1, gy + 700);
  const dl = riftDelta();
  // 裂け目：奈落（砂よりずっと暗い）
  for (const g of world.gaps) {
    if (PARTS.rift_dark) {
      const x0 = g.x0 - dl, x1 = g.x1 + dl;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, gy, x1 - x0, bottom - gy); ctx.clip();
      ctx.drawImage(PARTS.rift_dark, x0, gy, x1 - x0, bottom - gy);
      if (PARTS.rift_flow) {      // 下へ引く流れ（裂け目の中は泳いで上がれない）：絵の筋を下へ流す（加算）。上下は黒に落ちているので、つなぎ目は見えない
        const sc = (x1 - x0) / PARTS.rift_flow.width, fh = PARTS.rift_flow.height * sc, off = (time * 120) % fh;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
        for (let ty = gy - fh + off; ty < bottom; ty += fh) ctx.drawImage(PARTS.rift_flow, x0, ty, x1 - x0, fh);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
      const dg = ctx.createLinearGradient(0, gy, 0, bottom); dg.addColorStop(0, 'rgba(0,4,12,0)'); dg.addColorStop(0.5, 'rgba(0,3,9,0.35)'); dg.addColorStop(1, 'rgba(0,0,0,0.8)');
      ctx.fillStyle = dg; ctx.fillRect(x0, gy, x1 - x0, bottom - gy);
      ctx.restore();
      continue;
    }
    const ag = ctx.createLinearGradient(0, gy, 0, bottom);
    ag.addColorStop(0, 'rgba(2,10,24,0.55)'); ag.addColorStop(0.35, 'rgba(1,5,14,0.95)'); ag.addColorStop(1, '#000');
    ctx.fillStyle = ag; ctx.fillRect(g.x0, gy - 8, g.x1 - g.x0, bottom - gy + 8);
    // 下へ引く流れ：下へ流れる白い筋で知らせる
    ctx.save(); ctx.strokeStyle = 'rgba(190,225,255,0.38)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let k = 0; k < Math.floor((g.x1 - g.x0) / 34); k++) {
      const x = g.x0 + 20 + k * 34 + (hash(k + 3) - 0.5) * 12, run = 420, yy = gy + 20 + ((time * (170 + hash(k + 8) * 90) + hash(k + 5) * run) % run);
      const a = 1 - (yy - gy) / (run + 20); ctx.globalAlpha = Math.max(0, a) * 0.9;
      ctx.beginPath(); ctx.moveTo(x, yy - 22); ctx.lineTo(x, yy); ctx.stroke();
    }
    ctx.restore();
  }
  drawCaveRock(ctx, world);      // 右端の洞窟の岩壁（砂が根元をおおう）
  // 砂の地面（裂け目を除く）
  for (const [a0, b0] of solidRanges(world)) {
    const a = a0 > 0 ? a0 + dl : a0, b = b0 < W ? b0 - dl : b0;      // 裂け目に接する側は、縁の岩のぎざぎざの分だけ引く
    if (b <= a) continue;
    if (haveBed()) {
      const bed = PARTS.seabed, top = gy - PM.seabed.surf;
      ctx.save(); ctx.beginPath(); ctx.rect(a, top - 4, b - a, bottom - top + 8); ctx.clip();
      ctx.drawImage(bed, 0, top, W, PM.seabed.h);
      const [r, g2, b2] = PM.seabed.bot;
      if (top + PM.seabed.h < bottom) { ctx.fillStyle = `rgb(${r},${g2},${b2})`; ctx.fillRect(a, top + PM.seabed.h - 1, b - a, bottom - top - PM.seabed.h + 2); }
      ctx.restore();
      continue;
    }
    const sg = ctx.createLinearGradient(0, gy - 6, 0, gy + 360);
    sg.addColorStop(0, look.sand); sg.addColorStop(0.18, '#8f8460'); sg.addColorStop(1, '#2b2a2a');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.moveTo(a, bottom); ctx.lineTo(a, gy);
    for (let x = a; x <= b; x += 24) ctx.lineTo(x, gy - 3 + Math.sin(x * 0.045) * 4);
    ctx.lineTo(b, gy); ctx.lineTo(b, bottom); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(a, gy - 6, b - a, 3);
  }
  // 裂け目の縁の岩（左は絵のまま・右は左右反転）：砂の断面の上に重ねる
  if (PARTS.rift_edge) {
    const e = PARTS.rift_edge, ew = PM.rift_edge.w, eh = PM.rift_edge.h, [r, g2, b2] = PM.rift_edge.bot;
    for (const g of world.gaps) {
      for (const side of [-1, 1]) {
        ctx.save(); ctx.translate(side < 0 ? g.x0 : g.x1, 0); ctx.scale(-side, 1);
        ctx.drawImage(e, -ew, gy - 4, ew, eh);
        if (gy - 4 + eh < bottom) { ctx.fillStyle = `rgb(${r},${g2},${b2})`; ctx.fillRect(-ew, gy - 4 + eh - 1, ew, bottom - gy - eh + 6); }
        ctx.restore();
      }
    }
  }
  // 岩・海藻・サンゴ（位置は固定）
  if (havePropArt()) { drawProps(ctx, world, time, dl); return; }
  for (let i = 0; i < 26; i++) {
    const x = hash(i * 3 + 1) * W;
    if (world.gaps.some((g) => x > g.x0 - 18 - dl && x < g.x1 + 18 + dl)) continue;
    const kind = hash(i * 3 + 2);
    if (kind < 0.3) {      // 岩
      const rw = 26 + hash(i + 5) * 46, rh = 14 + hash(i + 6) * 24;
      ctx.fillStyle = '#4c4b52'; ctx.beginPath(); ctx.ellipse(x, gy + 2, rw, rh, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.beginPath(); ctx.ellipse(x - rw * 0.2, gy - rh * 0.4, rw * 0.5, rh * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    } else if (kind < 0.8) {      // 海藻（ゆらゆら）
      const n = 3 + Math.floor(hash(i + 7) * 3), hgt = 60 + hash(i + 8) * 90;
      ctx.strokeStyle = i % 2 ? '#2f8f5a' : '#3aa15f'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      for (let k = 0; k < n; k++) {
        const bx = x + (k - n / 2) * 9, sw = Math.sin(time * 1.4 + i + k * 0.9) * 14;
        ctx.beginPath(); ctx.moveTo(bx, gy); ctx.quadraticCurveTo(bx + sw, gy - hgt * 0.5, bx + sw * 1.6, gy - hgt * (0.8 + k * 0.05)); ctx.stroke();
      }
    } else {      // サンゴ（枝）
      ctx.strokeStyle = i % 2 ? '#e0708a' : '#e8955a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + k * 16, gy - 30 - hash(i + k + 11) * 22); ctx.stroke(); ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x + k * 16, gy - 32 - hash(i + k + 11) * 22, 5, 0, Math.PI * 2); ctx.fill(); }
    }
  }
}

/** 海底の飾り（絵）。9 か所に、海藻（ゆれる）・サンゴ・岩を固定の位置・大きさで置く。裂け目の上には置かない。 */
export const PROP_SLOTS = 9;
export function propList() {
  const out = [];
  for (let i = 0; i < PROP_SLOTS; i++) {
    const r = hash(i * 7 + 3), kind = r < 0.42 ? 'kelp' : r < 0.72 ? 'coral' : 'rock';
    const name = kind + (1 + Math.floor(hash(i * 5 + 1) * 3)), sc = (kind === 'rock' ? 0.6 : 0.55) + hash(i + 40) * 0.4;
    out.push({ i, kind, name, sc, x: ((i + 0.5) / PROP_SLOTS) * W + (hash(i + 17) - 0.5) * 60, flip: hash(i + 29) < 0.5 });
  }
  return out;
}
function drawProps(ctx, world, time, dl) {
  const gy = world.groundY;
  for (const p of propList()) {
    const m = PM[p.name], img = PARTS[p.name], w = m.w * p.sc, h = m.h * p.sc;
    if (world.gaps.some((g) => p.x + w / 2 > g.x0 - dl - 14 && p.x - w / 2 < g.x1 + dl + 14)) continue;
    if (p.x - w / 2 < 40 || p.x + w / 2 > W - 40) continue;      // 左右の断崖にかぶらない
    ctx.save(); ctx.translate(p.x, gy + 6); if (p.flip) ctx.scale(-1, 1);
    if (p.kind === 'kelp') {      // 海藻は根元を固定して、上ほど大きく揺らす（細い横帯に切って、ずらして描く）
      const n = 10, sh = img.height / n;
      for (let k = 0; k < n; k++) {      // k=0 が上
        const t = 1 - (k + 0.5) / n, sway = Math.sin(time * 1.3 + p.i * 1.7 + t * 2.2) * 9 * p.sc * t * t;
        ctx.drawImage(img, 0, k * sh, img.width, sh + 1, -w / 2 + sway, -h + k * sh * p.sc, w, (sh + 1) * p.sc);
      }
    } else ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }
}

/** 足場（岸・岩・流木・海中の岩棚）。stage.platforms の kind で見た目を変える。 */
export function drawSeaPlatforms(ctx, stage, time, shakeOf = null) {      // shakeOf(i)＝足場 i のゆれの大きさ（足場ゆらしの予兆。版2.8b）
  const L = stage.ledge || { top: '#cdbd8e', face: '#6f6248' };
  for (let pi = 0; pi < stage.platforms.length; pi++) {
    const p = stage.platforms[pi];
    const amp = shakeOf ? shakeOf(pi) : 0;
    const x = p.x + (amp ? Math.sin(time * 95) * amp : 0), y = p.y + (amp ? Math.sin(time * 71 + 1) * amp * 0.5 : 0), w = p.w;
    switch (p.kind) {
      case 'float': default: drawFloatBlock(ctx, x, y, w, time, 'block_float'); break;      // 浮き石の板（絵があれば絵）
      case 'drift': { if (PARTS.block_drift) { drawFloatBlock(ctx, x, y, w, time, 'block_drift'); break; }      // 流木：丸太が水に浮かぶ（上面が足場）
        const bob = Math.sin(time * 1.6 + x * 0.01) * 1.2;
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + 30, w * 0.48, 7, 0, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createLinearGradient(0, y, 0, y + 28);
        g.addColorStop(0, '#a77d4c'); g.addColorStop(1, '#6a4a2b');
        ctx.fillStyle = g; rr(ctx, x, y - 2 + bob, w, 28, 13); ctx.fill();
        ctx.strokeStyle = 'rgba(40,24,10,0.45)'; ctx.lineWidth = 2;
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 10, y + 3 + i * 5.5 + bob); ctx.lineTo(x + w - 10, y + 3 + i * 5.5 + bob); ctx.stroke(); }
        ctx.fillStyle = '#c79a62'; ctx.beginPath(); ctx.ellipse(x + 8, y + 12 + bob, 8, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(70,40,15,0.6)'; ctx.beginPath(); ctx.ellipse(x + 8, y + 12 + bob, 4, 7, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; rr(ctx, x + 18, y + bob, w - 36, 3, 1.5); ctx.fill();
        break;
      }
      case 'reef': { if (PARTS.block_float) { drawFloatBlock(ctx, x, y, w, time, 'block_float'); break; }      // 海中の岩棚：砂をかぶった岩（上面が足場）
        const g = ctx.createLinearGradient(0, y, 0, y + 46);
        g.addColorStop(0, '#8e8567'); g.addColorStop(1, '#3f3a39');
        ctx.fillStyle = g; rr(ctx, x, y + 2, w, 44, 16); ctx.fill();
        ctx.fillStyle = '#cbbd8a'; rr(ctx, x - 3, y - 4, w + 6, 14, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; rr(ctx, x + 8, y - 2, w - 16, 3, 1.5); ctx.fill();
        for (let i = 0; i < w / 60; i++) { const cx = x + 20 + i * 60; ctx.strokeStyle = i % 2 ? '#e0708a' : '#e8955a'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx, y - 3); ctx.lineTo(cx + 3, y - 20); ctx.stroke(); }
        break;
      }
    }
    walkRim(ctx, x, y + (p.kind === 'drift' || p.kind === 'float' ? -2 : 0), w, p.kind);      // 版3.1：上面（歩ける面）の縁取り＝淡い光・黒い輪郭・白い線。背景の海・空となじまない
  }
}

/** 版3.1：足場の上面（歩ける面）を一目で分かるようにする縁取り（当たり判定は変えない。上面の y に重ねるだけ）。 */
function walkRim(ctx, x, y, w, kind) {
  const bob = kind === 'drift' ? 0 : 0;
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,240,0.85)'; ctx.shadowBlur = 9;
  ctx.strokeStyle = 'rgba(10,20,30,0.85)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 2, y + 1 + bob); ctx.lineTo(x + w + 2, y + 1 + bob); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x + 2, y - 1 + bob); ctx.lineTo(x + w - 2, y - 1 + bob); ctx.stroke();
}

/**
 * 面送りのスクロール用：1面ぶんの海を、画面の横 offX の位置に静止画のように描く（world が無いとき）。camY＝その面の出発の足場に合わせたカメラの高さ。
 */
//   layer：'all'＝全部（前と同じ）／'back'＝主人公より後ろ（背景・足場）／'front'＝主人公より前（水の膜・左右の断崖）。
//   2026-11-15：面送りは back → 主人公 → front の順に描く（前は全部のあとに主人公を描き、本番と逆に主人公が断崖の岩・水の膜より前に出た）
export function drawSeaStatic(ctx, st, offX, camY, time, layer = 'all') {
  const fake = { stage: st, water: st.water, groundY: st.groundY, gaps: st.gaps || [], camY };
  ctx.save();
  ctx.beginPath(); ctx.rect(offX, 0, W, H); ctx.clip();
  ctx.translate(offX, -camY);
  if (layer !== 'front') { drawSeaBackdrop(ctx, fake, time); drawSeaPlatforms(ctx, st, time); }
  if (layer !== 'back') drawWaterOverlay(ctx, fake, time);
  ctx.restore();
}
/** 面送り用：陸の面の左右の断崖（ステージパッケージの cliff ギミック）を、主人公より前に描く。本番（drawWorld）と同じく敵・主人公より前。 */
export function drawLandCliffsStatic(ctx, st, offX, camY) {
  if (!st.cliff) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(offX, 0, W, H); ctx.clip();
  ctx.translate(offX, -camY);
  drawLandCliffs(ctx, { stage: st, groundY: st.groundY, camY });
  ctx.restore();
}

/** 水の重ね（敵・足場の上に半透明で重ねる）：海中の色の膜と、水面の波の線。 */
export function drawWaterOverlay(ctx, world, time) {
  const wy = world.water.y, cam = world.camY || 0, bot = cam + H + 30, top = Math.max(wy, cam - 30);
  if (bot > top) {
    const g = ctx.createLinearGradient(0, wy, 0, world.groundY + 160);
    g.addColorStop(0, 'rgba(70,175,235,0.22)'); g.addColorStop(1, 'rgba(6,36,84,0.5)');
    ctx.fillStyle = g; ctx.fillRect(0, top, W, bot - top);
  }
  if (wy > cam - 30 && wy < cam + H + 30) {
    if (PARTS.surface) {      // 水面の波（GPT の絵）。1 枚と左右反転の 1 枚を交互に並べて（つなぎ目なし）、ゆっくり流す
      const sf = PARTS.surface, m = PM.surface, sp = time * 16, n0 = Math.floor(sp / W);
      for (let n = n0; n <= n0 + 1; n++) {
        ctx.save(); ctx.translate(n * W - sp + (n & 1 ? W : 0), wy - m.crest + 1 + Math.sin(time * 1.1) * 0.8); if (n & 1) ctx.scale(-1, 1);
        ctx.globalAlpha = 0.95; if (SURF_FILTER[(world.stage && world.stage.bg && world.stage.bg.look)]) ctx.filter = SURF_FILTER[world.stage.bg.look]; ctx.drawImage(sf, 0, 0, W, m.h); ctx.restore();
      }
    } else {
    // 水面の下の明るい帯
    const bg = ctx.createLinearGradient(0, wy, 0, wy + 34);
    bg.addColorStop(0, 'rgba(255,255,255,0.28)'); bg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = bg; ctx.fillRect(0, wy, W, 34);
    // 波の線
    ctx.lineJoin = 'round';
    for (const [amp, lw, a, ph, off] of [[3.2, 3.5, 0.9, 1, 0], [2.2, 2, 0.5, -1.3, 7]]) {
      ctx.strokeStyle = `rgba(240,252,255,${a})`; ctx.lineWidth = lw;
      ctx.beginPath();
      for (let x = -8; x <= W + 8; x += 16) {
        const y = wy + off + Math.sin(x * 0.032 + time * 2.3 * ph) * amp + Math.sin(x * 0.012 - time * 1.2 * ph) * amp * 0.7;
        if (x === -8) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    }
  }
  drawSeaCliffs(ctx, world, time);      // 左右の断崖（敵・主人公より前）
}

// ---- 部品の絵（GPT 画像生成から切り出した透過 PNG）。読めていなければ描画で代用。
const PARTS = {};
export function setSeaPart(key, img) { PARTS[key] = img; }
/** 読めている部品の絵の名前（試験用）。 */
export const seaPartKeys = () => Object.keys(PARTS);

/** 水面の絵の色あい（背景の暗さにあわせて、深い海・夕暮れは彩度と明るさを落とす）。 */
const SURF_FILTER = { deep: 'saturate(0.5) brightness(0.7)', dusk: 'saturate(0.85) brightness(0.88)' };

/**
 * 版3.7 洞窟の置き方：洞窟は「右端の海底の岩壁」の一部（水に浮かせない）。絵（縦 768）の下端を、砂の面（groundY）より sink だけ下に置く＝砂が岩の根元をおおう（岩は砂に埋まる）。
 * 横は右端にそろえる。洞窟の穴の中心は絵の meta（hx・hy＝絵の中の座標）から。出口の判定（右端）は変えない。
 */
export const CAVE = { sink: 100 };
/** 洞窟の岩壁の絵の世界座標の矩形と、穴の中心。絵が読めていなければ null。試験用。 */
export function caveRect(world) {
  if (!PARTS.cave) return null;
  const m = PM.cave, c = PARTS.cave, x = W - c.width, y = world.groundY + CAVE.sink - c.height;
  return { x, y, w: c.width, h: c.height, bottom: y + c.height, hx: x + m.hx, hy: y + m.hy, hw: m.hw, hh: m.hh };
}
/** 洞窟の岩壁を描く（海底の砂より先＝砂が根元をおおう。飾り・敵・主人公より後ろ）。水面より上は描かない。 */
function drawCaveRock(ctx, world) {
  const r = caveRect(world);
  if (!r) return;
  const wy = world.water.y;
  ctx.save(); ctx.beginPath(); ctx.rect(r.x - 2, wy, r.w + 4, r.bottom - wy + 2); ctx.clip();
  const lk = world.stage && world.stage.bg && world.stage.bg.look; if (CAVE_FILTER[lk]) ctx.filter = CAVE_FILTER[lk];
  ctx.drawImage(PARTS.cave, r.x, r.y);
  ctx.restore();
}
/** 洞窟の岩壁の色あい（背景の暗さにあわせる。無指定の面は絵のまま）。 */
const CAVE_FILTER = { deep: 'brightness(0.8)', dusk: 'brightness(0.92)' };

/** 浮きブロック（float）：絵があれば3分割（両端は固定・まん中は横に伸ばす）で幅に合わせる。無ければ描画の石の板。 */
function drawFloatBlock(ctx, x, y, w, time, part = 'block_float') {
  const bob = Math.sin(time * 1.5 + x * 0.013) * 1.3;
  // 水面にうつる影・浮かぶ光
  const gl = ctx.createRadialGradient(x + w / 2, y + 52, 4, x + w / 2, y + 52, w * 0.55);
  gl.addColorStop(0, 'rgba(120,230,255,0.28)'); gl.addColorStop(1, 'rgba(120,230,255,0)');
  ctx.save(); ctx.scale(1, 0.32); ctx.translate(0, (y + 52) / 0.32 - (y + 52)); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x + w / 2, y + 52, w * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  const img = PARTS[part];
  if (img) {
    const ih = 60, capS = img.width * 0.2, capD = Math.min(34, w * 0.3), oy = y - 7 + bob;
    ctx.drawImage(img, 0, 0, capS, img.height, x - 10, oy, capD + 10, ih);
    ctx.drawImage(img, capS, 0, img.width - capS * 2, img.height, x + capD, oy, w - capD * 2, ih);
    ctx.drawImage(img, img.width - capS, 0, capS, img.height, x + w - capD, oy, capD + 10, ih);
    return;
  }
  const g = ctx.createLinearGradient(0, y, 0, y + 54);
  g.addColorStop(0, '#dfe7ea'); g.addColorStop(0.25, '#9fb0bb'); g.addColorStop(1, '#4f5d6b');
  ctx.fillStyle = g; ctx.beginPath();
  ctx.moveTo(x + 4, y + 2 + bob); ctx.lineTo(x + w - 4, y + 2 + bob);
  ctx.quadraticCurveTo(x + w + 6, y + 22 + bob, x + w * 0.82, y + 46 + bob); ctx.quadraticCurveTo(x + w * 0.5, y + 62 + bob, x + w * 0.18, y + 46 + bob); ctx.quadraticCurveTo(x - 6, y + 22 + bob, x + 4, y + 2 + bob);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(30,45,60,0.35)'; ctx.lineWidth = 2;
  for (let i = 1; i < Math.max(3, w / 70); i++) { const lx = x + (w * i) / Math.max(3, w / 70); ctx.beginPath(); ctx.moveTo(lx, y + 8 + bob); ctx.lineTo(lx + 6, y + 30 + bob); ctx.stroke(); }
  ctx.fillStyle = '#f1f6f7'; rr(ctx, x - 3, y - 5 + bob, w + 6, 16, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; rr(ctx, x + 8, y - 3 + bob, w - 16, 3, 1.5); ctx.fill();
  ctx.fillStyle = 'rgba(140,235,255,0.55)';
  for (let i = 0; i < 4; i++) { const bx = x + w * (0.2 + 0.2 * i) + Math.sin(time * 2 + i) * 3, by = y + 58 + ((time * 22 + i * 17) % 26) + bob; ctx.beginPath(); ctx.arc(bx, by, 2.2, 0, Math.PI * 2); ctx.fill(); }
}

/**
 * 左右の断崖の壁（陸地は無い。左右の端は岩の断崖でふさぐ）。右の断崖には、水中の洞窟（出口）がある。敵・主人公より前に重ねる（画面の端を隠す）。
 * 絵（cliff）があればそれを縦に敷く（つなぎ目は上下反転で隠す）。無ければ描画の岩。
 */
export function drawSeaCliffs(ctx, world, time) {
  const wy = world.water.y, cam = world.camY || 0, y0 = cam - 40, y1 = cam + H + 40, cw = 58;
  const img = PARTS.cliff;
  const cs = world.stage && world.stage.cliff;      // 版3.3：ステージパッケージの断崖の指定（left・right）。無ければ両側（従来）
  for (const side of [-1, 1]) {
    if (cs && ((side < 0 && cs.left === false) || (side > 0 && cs.right === false))) continue;
    const x0 = side < 0 ? 0 : W;
    ctx.save(); ctx.translate(x0, 0); ctx.scale(-side, 1);      // 左は右向き・右は左右反転
    if (img) {
      const sc = 70 / img.width, th = img.height * sc, sw = img.width;
      const k0 = Math.floor((y0 - wy) / th), k1 = Math.ceil((y1 - wy) / th);
      for (let k = k0; k <= k1; k++) {
        ctx.save(); const ty = wy + k * th; if (k & 1) { ctx.translate(0, ty + th); ctx.scale(1, -1); } else ctx.translate(0, ty);
        ctx.drawImage(img, 0, 0, sw, img.height, 0, 0, sw * sc, th); ctx.restore();
      }
    } else {
      const g = ctx.createLinearGradient(0, 0, cw, 0); g.addColorStop(0, '#2b3441'); g.addColorStop(0.7, '#56657a'); g.addColorStop(1, '#8da0b4');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-4, y0);
      for (let y = Math.floor(y0 / 40) * 40; y <= y1 + 40; y += 40) ctx.lineTo(cw - 14 + hash(y * 0.05 + 3) * 22, y);
      ctx.lineTo(-4, y1 + 40); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(15,20,30,0.45)'; ctx.lineWidth = 2;
      for (let y = Math.floor(y0 / 90) * 90; y <= y1; y += 90) { ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(cw - 18 + hash(y) * 14, y + 24 + hash(y + 1) * 30); ctx.stroke(); }
    }
    ctx.restore();
  }
  // 水の中は少し暗く・水際に白いあわ
  const dep = ctx.createLinearGradient(0, wy, 0, wy + 400); dep.addColorStop(0, 'rgba(10,40,80,0.15)'); dep.addColorStop(1, 'rgba(2,12,30,0.55)');
  ctx.fillStyle = dep; ctx.fillRect(0, Math.max(wy, y0), cw - 10, y1 - Math.max(wy, y0)); ctx.fillRect(W - cw + 10, Math.max(wy, y0), cw - 10, y1 - Math.max(wy, y0));
  if (wy > y0 && wy < y1) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; for (const bx of [cw - 14, W - cw + 14]) { ctx.beginPath(); ctx.ellipse(bx, wy + 3 + Math.sin(time * 2 + bx) * 1.5, 16, 4, 0, 0, Math.PI * 2); ctx.fill(); } }
  // 右の洞窟（出口）：絵があれば岩壁は背景側（drawCaveRock）で描いてあるので、ここは面を片づけたあとに光る矢印だけ。絵が無ければ従来の暗い穴
  const cr = caveRect(world);
  const ty0 = cr ? cr.hy - 115 : wy + 120, th0 = 230;
  if (ty0 < y1 && ty0 + th0 > y0) {
    ctx.save();
    if (!cr) {
    const hg = ctx.createLinearGradient(W - cw - 6, 0, W, 0); hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(0.5, 'rgba(0,6,16,0.92)'); hg.addColorStop(1, '#000');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.moveTo(W - cw - 6, ty0 + th0); ctx.lineTo(W - cw - 6, ty0 + 60); ctx.quadraticCurveTo(W - cw - 6, ty0, W - cw + 40, ty0); ctx.lineTo(W, ty0); ctx.lineTo(W, ty0 + th0); ctx.closePath(); ctx.fill();
    }
    if (world.phase === 'clear') {
      const a = 0.5 + 0.5 * Math.sin(time * 6);
      ctx.fillStyle = `rgba(150,240,255,${0.35 + 0.5 * a})`;
      for (let i = 0; i < 3; i++) { const ax = W - 150 + i * 34 + (a * 8); ctx.beginPath(); ctx.moveTo(ax, ty0 + th0 / 2 - 22); ctx.lineTo(ax + 26, ty0 + th0 / 2); ctx.lineTo(ax, ty0 + th0 / 2 + 22); ctx.closePath(); ctx.fill(); }
    }
    ctx.restore();
  }
}

/**
 * 版3.3：陸の面の左右の断崖の壁（ステージパッケージの cliff ギミック）。海の断崖と同じ岩の絵（無ければ描画の岩）を、足を置く線（groundY）から上下へ敷く。
 * 水の膜・泡・洞窟は付けない。敵・主人公より前に重ねる。
 */
export function drawLandCliffs(ctx, world) {
  const cs = world.stage && world.stage.cliff;
  if (!cs) return;
  const cam = world.camY || 0, y0 = cam - 40, y1 = cam + H + 40, cw = 58, wy = world.groundY, img = PARTS.cliff;
  for (const side of [-1, 1]) {
    if ((side < 0 && cs.left === false) || (side > 0 && cs.right === false)) continue;
    ctx.save(); ctx.translate(side < 0 ? 0 : W, 0); ctx.scale(-side, 1);
    if (img) {
      const sc = 70 / img.width, th = img.height * sc, sw = img.width;
      const k0 = Math.floor((y0 - wy) / th), k1 = Math.ceil((y1 - wy) / th);
      for (let k = k0; k <= k1; k++) {
        ctx.save(); const ty = wy + k * th; if (k & 1) { ctx.translate(0, ty + th); ctx.scale(1, -1); } else ctx.translate(0, ty);
        ctx.drawImage(img, 0, 0, sw, img.height, 0, 0, sw * sc, th); ctx.restore();
      }
    } else {
      const g = ctx.createLinearGradient(0, 0, cw, 0); g.addColorStop(0, '#2b3441'); g.addColorStop(0.7, '#56657a'); g.addColorStop(1, '#8da0b4');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-4, y0);
      for (let y = Math.floor(y0 / 40) * 40; y <= y1 + 40; y += 40) ctx.lineTo(cw - 14 + hash(y * 0.05 + 3) * 22, y);
      ctx.lineTo(-4, y1 + 40); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}
