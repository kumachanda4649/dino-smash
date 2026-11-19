// 画面上部の表示（体力・ゲージ・スコア・面）、バナー、タイトル、ポーズ、やられ、エンディング、読み込み。
// 台詞は入れない（台詞は別の担当）。
import { W, H } from './world.js';
import { text, drawBackground, drawFrame, FONT_JP, FONT_EN } from './render.js';
import { clamp, VERSION } from './util.js';
import { DIVE_CP } from './tune.js';      // 2026-11-15：タイトルの急降下の説明に CP の数字を出す
import { tekkenOn } from './moves.js';      // 2026-11-18 試作：鉄拳型の入れ方の表示
import { difficultyOf, DIFFICULTY_ORDER } from './difficulty.js';
import { AREAS } from '../stages.js';
import { DINOS, isBossLike } from './dinos.js';
import { animFrame } from './world.js';
import { LEVEL_MAX } from './options.js';
import { CREDITS, CREDITS_TITLE } from './credits.js';
import { CONFIRM_A_FIX } from './input.js';      // 2026-11-15：ゲームオーバーの案内の文を A の押し直しに合わせる
import { dispHp, dispMaxHp, dispDamage, DISPLAY_SCALE } from './bignum.js';      // 版3.5：体力の数字の倍率

function bar(ctx, x, y, w, h, ratio, lag, colors, opts = {}) {
  ctx.save();
  ctx.fillStyle = 'rgba(8,10,18,0.78)';
  ctx.strokeStyle = '#e8edf7'; ctx.lineWidth = 3;
  const sk = 10;
  const path = (ww) => { ctx.beginPath(); ctx.moveTo(x + sk, y); ctx.lineTo(x + ww, y); ctx.lineTo(x + ww - sk, y + h); ctx.lineTo(x, y + h); ctx.closePath(); };
  path(w); ctx.fill();
  ctx.save(); path(w); ctx.clip();
  if (lag > ratio) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(x, y, w * lag, h); }
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
  ctx.fillStyle = g; ctx.fillRect(x, y, w * clamp(ratio, 0, 1), h);
  ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(x, y, w * clamp(ratio, 0, 1), h * 0.35);
  ctx.restore();
  if (opts.glow) { ctx.shadowColor = opts.glow; ctx.shadowBlur = 16; }
  path(w); ctx.stroke();
  ctx.restore();
}

function hpColors(r) {
  if (r > 0.5) return ['#7bf26a', '#2a9d3a'];
  if (r > 0.25) return ['#ffe45c', '#d99a12'];
  return ['#ff6a5c', '#b3221a'];
}

export function drawHud(ctx, game) {
  const w = game.world, p = w.player;
  if (!p) return;
  const hud = game.hud;
  const time = game.time;
  // 上の帯
  const g = ctx.createLinearGradient(0, 0, 0, 96);
  g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 96);

  // 名前と体力
  text(ctx, DINOS[p.type].label, 38, 28, { size: 20, color: '#fff3c4' });
  const hr = p.hp / p.maxHp;
  bar(ctx, 34, 36, 430, 26, hr, hud.hpLag / p.maxHp, hpColors(hr));
  text(ctx, `${dispHp(p.hp)} / ${dispMaxHp(p.maxHp)}`, 52, 58, { size: 18, font: `900 18px ${FONT_EN}`, color: "#fff" });      // 版3.5：現在値／最大値（表示だけ倍率つき）
  // 必殺ゲージ
  const ready = p.gauge >= p.d.cost;
  bar(ctx, 34, 68, 300, 14, p.gauge / 100, 0, ready ? ['#7df0ff', '#1b8fd6'] : ['#6aa7ff', '#2a4fb3'], { glow: ready ? '#7df0ff' : null });
  // 体当たりに必要な位置の目印
  ctx.fillStyle = '#fff'; ctx.fillRect(34 + 300 * (p.d.cost / 100) - 1, 66, 2, 18);
  text(ctx, ready ? 'CP  体当たり OK!  [C]' : 'CP ゲージ', 344, 81, { size: 15, color: ready ? '#7df0ff' : '#cfe0ff', alpha: ready ? 0.7 + 0.3 * Math.sin(time * 10) : 1 });

  // 面
  const st = w.stage;
  text(ctx, `STAGE ${st.label}`, W / 2, 34, { size: 30, font: `900 30px ${FONT_EN}`, align: 'center', color: '#ffffff' });
  text(ctx, `${AREAS[st.world].name}　${st.name}`, W / 2, 58, { size: 17, align: 'center', color: '#d8e6ff', maxW: 330 });      // 2026-11-14：長い名前（自作の面は 40 文字まで）が体力の帯・得点に重ならないよう、幅 330 に収める

  // 版1.3：制限時間（中央上）と難しさ（隅）
  if (w.timeMax > 0 && !w.practice) {
    const left = Math.ceil(w.timeLeft), low = w.timeLeft <= 30, out = w.timeLeft <= 0;
    const blinkT = out ? 0.6 + 0.4 * Math.sin(time * 14) : 1;
    text(ctx, out ? 'TIME UP' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, W / 2, 96, { size: out ? 30 : 28, font: `900 28px ${FONT_EN}`, align: 'center', color: out ? '#ff5a4a' : low ? '#ffb15a' : '#ffffff', alpha: blinkT, shadow: '#000', glow: out ? 10 : 0 });
  }
  text(ctx, difficultyOf(game.difficulty).label, W - 40, 84, { size: 16, align: 'right', color: '#cfe0ff', alpha: 0.85 });
  drawAssistBadges(ctx, game, W - 40, 106);

  // スコア
  text(ctx, 'SCORE', W - 40, 26, { size: 16, align: 'right', color: '#ffe08a' });
  text(ctx, String(Math.floor(hud.scoreShown)).padStart(8, '0'), W - 40, 62, { size: 38, font: `900 38px ${FONT_EN}`, align: 'right', color: '#fff' });

  // ボスの体力
  const boss = w.enemies.find((e) => isBossLike(e.d) && e.state !== 'dying');
  if (boss) {
    const r = boss.hp / boss.maxHp;
    const bw = 700, bx = (W - bw) / 2;
    text(ctx, boss.d.label, bx, 104, { size: 20, color: '#ffd9d2' });
    text(ctx, `${dispHp(boss.hp)} / ${dispMaxHp(boss.maxHp)}`, bx + bw, 104, { size: 20, font: `900 20px ${FONT_EN}`, align: 'right', color: '#fff', maxW: 300 });      // 版3.5：ボスの体力の数字。2026-11-15：自作の面で体力がとても大きい（×100 で 10 桁）と残り時間に重なったので、幅 300 に収める
    bar(ctx, bx, 112, bw, 20, r, hud.bossLag / boss.maxHp, ['#ff7a5c', '#b3221a']);
    if (boss.d.rival) {   // ライバルのゲージ（必殺・咆哮・体当たり・衝撃波に使う）。主人公のゲージと同じ使い道を敵の側に見せる
      text(ctx, '必殺ゲージ', bx, 150, { size: 13, color: '#e4d2ff' });
      bar(ctx, bx + 92, 141, 250, 9, clamp(boss.gauge / 100, 0, 1), clamp(boss.gauge / 100, 0, 1), ['#c79bff', '#6b3fb0']);
    }
  }

  // コンボ：「12 HIT!」と、残り時間の細い帯（飛んでいる敵がいるあいだは満タンのまま点滅）
  const comboOffset = boss ? 72 : 0;      // 数字が弾んでもボスの体力欄を隠さない
  if (w.combo >= 2) {
    const pop = hud.comboPop > 0 ? 1 + hud.comboPop * 1.8 : 1;
    const big = w.combo >= 20 ? '#ff9ad8' : w.combo >= 10 ? '#ffd24a' : w.combo >= 5 ? '#7df0ff' : '#ffffff';
    ctx.save();
    ctx.translate(W - 44, 168 + comboOffset);
    ctx.scale(pop, pop);
    ctx.rotate(-0.06);
    const label = 'HIT!';
    ctx.font = `900 40px ${FONT_EN}`;
    const lw2 = ctx.measureText(label).width;
    text(ctx, label, 0, 0, { size: 40, font: `900 40px ${FONT_EN}`, align: 'right', color: '#fff', lw: 8 });
    text(ctx, String(w.combo), -lw2 - 10, 0, { size: 96, font: `900 96px ${FONT_EN}`, align: 'right', color: big, lw: 12, shadow: big, glow: w.combo >= 10 ? 18 : 0 });
    ctx.restore();
    const mul = w.scoreMul();
    text(ctx, 'SCORE x' + mul.toFixed(2).replace(/0$/, ''), W - 44, 198 + comboOffset, { size: 18, align: 'right', color: '#ffe9a8' });
    if (w.comboDmg > 0) text(ctx, `TOTAL ${dispDamage(w.comboDmg)}`, W - 44, 238 + comboOffset, { size: 24, font: `900 24px ${FONT_EN}`, align: 'right', color: '#ffd9a0', lw: 5 });      // 版3.5：このコンボの合計ダメージ（表示だけ）
    const u = clamp(w.comboT / w.comboWindow(), 0, 1);      // 版2.6：吹き飛び中でも保持しない（comboHeld は常に false）。猶予は COMBO.window × スライダー
    const on = true;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W - 44 - 220, 206 + comboOffset, 220, 7);
    ctx.fillStyle = on ? (u < 0.3 ? '#ff6a5c' : '#ffffff') : '#bfeaff'; ctx.fillRect(W - 44 - 220 * u, 207 + comboOffset, 220 * u, 5);
  }
  // 途切れたあとの評価とまとめ点
  if (hud.result) {
    const r = hud.result, u = r.t / 2.6;
    const a = u > 0.75 ? (1 - u) / 0.25 : 1;
    const pop = r.t < 0.2 ? 0.5 + r.t / 0.2 * 0.7 : 1.2 - Math.min(0.2, (r.t - 0.2) * 0.4);
    const col = r.n >= 35 ? '#ff9ad8' : r.n >= 20 ? '#ffd24a' : r.n >= 10 ? '#7df0ff' : '#ffffff';
    ctx.save(); ctx.globalAlpha = a; ctx.translate(W - 44, 150 + comboOffset); ctx.scale(pop, pop);
    text(ctx, r.rating, 0, 0, { size: 46, font: `900 46px ${FONT_EN}`, align: 'right', color: col, lw: 9, shadow: col, glow: 14 });
    text(ctx, `${r.n} HITS   +${r.bonus.toLocaleString('en-US')}`, 0, 34, { size: 26, font: `900 26px ${FONT_EN}`, align: 'right', color: '#fff', lw: 6 });
    if (r.dmg > 0) text(ctx, `TOTAL ${dispDamage(r.dmg)}`, 0, 64, { size: 24, font: `900 24px ${FONT_EN}`, align: 'right', color: '#ffd9a0', lw: 5 });      // 版3.5：このコンボの合計ダメージ
    ctx.restore();
  }

  // GO →
  // 2026-11-14：面送りの間（止まった前の面の HUD を描いている）と、クリアでタイトルへ戻る自作の最後の面では出さない
  const inTrans = game.state === 'transition' || ((game.state === 'pause' || game.state === 'options') && game.prevState === 'transition');
  if (w.phase === 'clear' && !(w.isLastStage ? w.isLastStage() : st.final) && !st.userEnd && !inTrans && w.phaseT > 1.6) {      // 2026-11-15：次の面が無い面（エンディングへ行く）でも出さない
    const on = Math.floor(time * 2.5) % 2 === 0;
    if (on) {
      ctx.save();
      ctx.translate(W - 120, H / 2 - 40);
      const sh = Math.sin(time * 8) * 8;
      text(ctx, 'GO', 0 + sh, 0, { size: 70, font: `900 70px ${FONT_EN}`, align: 'right', color: '#ffe14a', lw: 10, shadow: '#ff9a00', glow: 18 });
      ctx.fillStyle = '#ffe14a'; ctx.strokeStyle = '#10131c'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(14 + sh, -52); ctx.lineTo(80 + sh, -24); ctx.lineTo(14 + sh, 4); ctx.lineTo(30 + sh, -24); ctx.closePath();
      ctx.stroke(); ctx.fill();
      ctx.restore();
    }
  }
  if (game.audio && game.audio.muted) text(ctx, '♪ OFF', W - 40, H - 20, { size: 16, align: 'right', color: '#ffb0a8' });
}

/** 2026-11-15：面の頭の STAGE の帯に、面の説明（stages の hint）を出すか。Nao「説明いらないかな。」＝既定は出さない（true で 2026-11-14 の折り返しの形で出る）。 */
export const STAGE_HINT = { show: false };

export function drawBanners(ctx, game) {
  for (const b of game.banners) {
    const u = b.t / b.dur;
    if (b.kind === 'stage') {
      const slide = u < 0.18 ? (1 - u / 0.18) : u > 0.82 ? -(u - 0.82) / 0.18 : 0;
      const a = u < 0.1 ? u / 0.1 : u > 0.85 ? (1 - u) / 0.15 : 1;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(slide * 500, 0);
      // 版3.0：面の説明（hint）。2026-11-14：画面の幅に収まらなければ 2 行に折り返す（4-1 の説明は 81 文字＝約 1620px で、左右とも約 170px はみ出して読めなかった）
      // 2026-11-15：Nao「説明いらないかな。」（判断ボード「面の説明が画面からはみ出す（4-1）」への△）＝面の頭の帯に説明を出さない。データ（stages の hint）は消さない。STAGE_HINT.show=true で前どおり出る（黒い帯の高さも説明の行数に合う）
      let hint = STAGE_HINT.show && b.hint ? wrapJp(ctx, b.hint, 20, W - 80) : [];
      if (hint.length > 3) hint = [hint[0], hint[1], hint.slice(2).join('')];      // 自作の面の説明は 120 文字まで。3 行に収め、それ以上は 3 行目に詰める（maxW）
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 260, W, hint.length ? 156 + (hint.length - 1) * 26 : 120);
      text(ctx, b.text, W / 2, 330, { size: 78, font: `900 78px ${FONT_EN}`, align: 'center', color: '#fff', lw: 10 });
      if (b.sub) text(ctx, b.sub, W / 2, 366, { size: 24, align: 'center', color: '#ffe9a8' });
      hint.forEach((ln, k) => text(ctx, ln, W / 2, 402 + k * 26, { size: 20, align: 'center', color: '#bfeaff', maxW: W - 80 }));
      ctx.restore();
    } else if (b.kind === 'warn') {
      const a = u < 0.08 ? u / 0.08 : u > 0.88 ? (1 - u) / 0.12 : 1;
      ctx.save(); ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = 'rgba(120,0,0,0.55)'; ctx.fillRect(0, 250, W, 150);
      ctx.beginPath(); ctx.rect(0, 250, W, 150); ctx.clip();
      ctx.strokeStyle = 'rgba(255,60,40,0.55)'; ctx.lineWidth = 14;
      const off = (b.t * 220) % 70;
      for (let x = -200; x < W + 200; x += 70) { ctx.beginPath(); ctx.moveTo(x + off, 250); ctx.lineTo(x + off + 100, 400); ctx.stroke(); }
      ctx.restore();
      const blink = Math.floor(b.t * 6) % 2 === 0 ? 1 : 0.35;
      text(ctx, 'WARNING', W / 2, 340, { size: 92, font: `900 92px ${FONT_EN}`, align: 'center', color: '#ff4a3a', lw: 12, alpha: a * blink, shadow: '#ff0000', glow: 24 });
      if (b.sub) text(ctx, b.sub, W / 2, 380, { size: 26, align: 'center', color: '#ffd9d2', alpha: a });
    } else if (b.kind === 'clear') {
      const pop = u < 0.15 ? 0.4 + (u / 0.15) * 0.8 : 1.2 - Math.min(0.2, (u - 0.15) * 0.4);
      const a = u > 0.8 ? (1 - u) / 0.2 : 1;
      ctx.save(); ctx.translate(W / 2, 320); ctx.scale(pop, pop); ctx.rotate(-0.04);
      text(ctx, b.text, 0, 0, { size: 130, font: `900 130px ${FONT_EN}`, align: 'center', color: '#ffe14a', lw: 16, alpha: a, shadow: '#ff9a00', glow: 26 });
      ctx.restore();
    }
  }
  if (game.toast && game.toast.t > 0) drawToast(ctx, game.toast, game.toastY);
}

/** 知らせ（パッドの接続・消音など）。y＝帯の上の端。
 *  2026-11-15：戦闘中は HUD（残り時間 y≈76〜96・ボスの名前と体力 y≈86〜132）の下へ出す（game.js が y を決める）。前は y=78〜118 で残り時間・ボスの名前に約 1.6 秒かぶった */
export function drawToast(ctx, toast, y = TOAST_Y.top) {
  const a = clamp(toast.t / 0.4, 0, 1);
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.font = `22px ${FONT_JP}`;
  const tw = ctx.measureText(toast.text).width + 40;
  ctx.fillRect(W / 2 - tw / 2, y, tw, 40);
  ctx.restore();
  text(ctx, toast.text, W / 2, y + 28, { size: 22, align: 'center', color: '#fff', alpha: a });
}
/** 知らせの帯の上の端：top＝タイトル・読み込み中（前と同じ）／play＝戦闘中・面送り（HUD の下。ライバルの必殺ゲージ y≈141〜150 より下）
 *  2026-11-15：pause＝ポーズのメニュー（選んだ項目の説明 y≈558〜580 と下の帯 y≈644 のあいだ）／moves＝技表（一覧の下の注記 y≈602〜622 と下の帯 y≈664 のあいだ）／
 *  options＝オプション（説明文の下）／edge＝エンディング（画面のいちばん上。「ALL CLEAR!」より上）。前はどの画面も top で、オプションの「OPTION」・エンディングの「ALL CLEAR!」の見出しを隠した */
export const TOAST_Y = { top: 78, play: 156, pause: 592, moves: 625, options: 632, edge: 8 };

export function drawLoading(ctx, game, label) {
  ctx.fillStyle = '#0b0e16'; ctx.fillRect(0, 0, W, H);
  const a = game.time * 4;
  ctx.save(); ctx.translate(W / 2, H / 2 - 20);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = `rgba(255,225,120,${((i / 10) + (a % 1)) % 1})`;
    const t = (i / 10) * Math.PI * 2;
    ctx.beginPath(); ctx.arc(Math.cos(t) * 34, Math.sin(t) * 34, 6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  text(ctx, label || 'NOW LOADING…', W / 2, H / 2 + 70, { size: 26, align: 'center', color: '#e8edf7' });
}

/** 操作の説明の文（タイトルの下の帯＝style:'old'・操作説明の画面の両方がこれを使う。1字も減らさない） */
function helpTexts() {
  const L0 = '↑を押したまま連打で昇りコンボ。締めは ↑を離して攻撃＝尻尾のなぎ払い　（空中コンボ中）↓+攻撃＝尻尾の叩きつけ';      // 2026-11-15：地上の ↓+攻撃（足払い）と取り違えないよう「空中コンボ中」と書く
  const L1 = '←→ 移動（素早く2回でダッシュ、ダッシュ中に攻撃で体当たり）　地上で当てながら攻撃を連打すると4段コンボ';      // 2026-11-15：当てたときだけつながる
  const guard = '↑+攻撃 打ち上げ　地上の ↓+攻撃 足払い　↓を押し続けてガード（CP消費）・押してすぐ受け止めるとパリィ';
  let L2 = `↓↓+攻撃 咆哮（周り全部を吹き飛ばす）　↓↘→+攻撃 衝撃波　前・後・前+攻撃 噛みつき振り回し　空中 ↓↓+攻撃 急降下（CPを${DIVE_CP}使う）`;      // 2026-11-15：技表の「CP を 15 使う」とそろえる（取り込みの見直し）
  if (tekkenOn()) L2 = `【操作B】↓+体当たり 咆哮　↘+体当たり 衝撃波　↑+体当たり 噛みつき振り回し　↘+攻撃 踏みつけ　↗+攻撃 頭突き　空中 ↓+体当たり 急降下（CPを${DIVE_CP}使う）`;      // 2026-11-20：急降下の CP を A の文とそろえる      // 2026-11-18 試作（前の入れ方も使える）
  const K = 'キーボード： ←→↑↓ いどう　Z 攻撃　X ジャンプ　C 体当たり　Enter 決定　Esc ポーズ　M 消音　F 全画面';
  const P = 'ゲームパッド： 十字/左スティック いどう　A 攻撃　B ジャンプ　X・Y 体当たり　Start ポーズ・決定　Back+A 消音　Back+B タイトルへ';
  const SND = '音が鳴らないときは、キーを1回押すか画面をクリックしてください（ブラウザの決まりで、最初に1回の操作が要ることがあります）';
  return { L0, L1, guard, L2, K, P, SND };
}

export function drawTitle(ctx, game) {
  if (TITLE_ART.style !== 'old') { drawTitleNew(ctx, game); return; }      // 2026-11-15：新しいタイトル。'old' は直す前の絵（下の帯つき。比べ用・検査の陰性対照）
  const { assets, world } = game;
  const t = game.time;
  const stage = game.stages[game.titleBgStage];
  drawBackground(ctx, assets, stage);
  ctx.fillStyle = 'rgba(8,12,20,0.38)'; ctx.fillRect(0, 0, W, H);
  // 主人公（大きく）
  const sp = 'Spinosaurus';
  const meta = assets.motions.dinos[sp].motions.Idle;
  const fr = animFrame({ from: 0, to: 20, dur: 1.4, loop: true, t }, meta.n);
  ctx.save();
  ctx.globalAlpha = 1;
  drawFrame(ctx, assets, sp, 'Idle', fr, 380, 690, 1, { scaleMul: 2.5 });
  ctx.restore();
  // 影
  // タイトル
  ctx.save();
  ctx.translate(W / 2 + 120, 220);
  ctx.rotate(-0.025);
  const font = `900 104px ${FONT_JP}`;
  ctx.font = font; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  ctx.lineWidth = 22; ctx.strokeStyle = '#1a1020';
  ctx.strokeText('ダイノ・アーツ', 0, 0);
  const g = ctx.createLinearGradient(0, -90, 0, 20);
  g.addColorStop(0, '#fff7c2'); g.addColorStop(0.5, '#ffc93a'); g.addColorStop(1, '#ff8a1e');
  ctx.shadowColor = 'rgba(255,170,40,0.9)'; ctx.shadowBlur = 24;
  ctx.fillStyle = g; ctx.fillText('ダイノ・アーツ', 0, 0);
  ctx.restore();
  text(ctx, VERSION, W - 20, 36, { size: 24, align: 'right', color: '#ffe9a8', shadow: '#000', glow: 6 });   // 版（隅）
  text(ctx, '（仮）', W / 2 + 120 + 330, 230, { size: 40, color: '#ffe9a8', align: 'center' });
  text(ctx, '敵を殴って、壁に叩きつけろ。', W / 2 + 120, 290, { size: 28, align: 'center', color: '#fff' });

  const blink = 0.55 + 0.45 * Math.sin(t * 4);
  { // 版2.0：タイトルの項目（↑↓で選ぶ・Enter／Start／A で決定）。「オプション」は原作と同じく、ここから入る
    const cx = W / 2 + 120, sel = game.titleSel;
    const item = (label, y, size, on) => text(ctx, `${on ? '▶ ' : '　 '}${label}${on ? ' ◀' : '　　'}`, cx, y, on
      ? { size, align: 'center', color: '#ffffff', alpha: blink, shadow: '#3aa0ff', glow: 16 }
      : { size, align: 'center', color: '#cfd8ea', alpha: 0.9 });
    item('スタート', 388, 44, sel === 0);
    const r = game.run, o = game.opts, notes = [];
    if (o.stage > 0) notes.push(`${game.stages[o.stage].label} から`);
    if (o.mpFree) notes.push('CP FREE');
    if (notes.length) text(ctx, notes.join('　'), cx, 412, { size: 16, align: 'center', color: '#ffb15a' });
    item('オプション', 446, 36, sel === 1);
    item('操作説明', 484, 32, sel === 2);      // 2026-11-15：3 つ目の項目（開くと操作説明の画面）。ほかの位置は前のまま、2 つ上へ詰めた
    const d = difficultyOf(game.difficulty), i = DIFFICULTY_ORDER.indexOf(d.id);
    text(ctx, `${i > 0 ? '◀' : '　'}  難しさ： ${d.label}  ${i < DIFFICULTY_ORDER.length - 1 ? '▶' : '　'}`, cx, 518, { size: 24, align: 'center', color: d.id === 'hard' ? '#ff9a8a' : d.id === 'easy' ? '#9fffb0' : '#ffe9a8', shadow: '#000', glow: 6 });
  }

  // 操作（キーボードとパッドを並べて）
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 196, W, 196);
  const { L0, L1, guard, L2, K, P, SND } = helpTexts();
  text(ctx, L0, W / 2, H - 168, { size: 17, align: 'center', color: '#7df0ff', maxW: W - 40 });
  text(ctx, L1, W / 2, H - 144, { size: 17, align: 'center', color: '#fff', maxW: W - 40 });
  text(ctx, guard, W / 2, H - 120, { size: 17, align: 'center', color: '#fff', maxW: W - 40 });
  text(ctx, L2, W / 2, H - 96, { size: 17, align: 'center', color: '#ffe9a8', maxW: W - 40 });
  text(ctx, K, W / 2, H - 70, { size: 16, align: 'center', color: '#cfe0ff' });
  text(ctx, P, W / 2, H - 42, { size: 16, align: 'center', color: '#9fffb0' });
  text(ctx, SND, W / 2, H - 16, { size: 13, align: 'center', color: '#9fb0cc' });
}

/** 2026-11-15：タイトルの見た目のつまみ（Nao「タイトルもっとおしゃれに。操作説明は開けば分かればいい」）。
 *  style:'new'＝新しいタイトル（下の帯なし。絵の口 assets/title/<set>/bg.jpg・logo.png）／'old'＝直す前のタイトル（下の帯の長い説明つき。比べ用・検査の陰性対照）。
 *  URL の ?title=old|a|b で切り替える。絵が無いときは canvas の代わりの描き方。 */
export const TITLE_ART = { style: 'new', set: 'a' };
/** 絵の組ごとの置き場所。logo＝中心(cx,cy)・幅w・傾きrot／hero＝主人公の足元(x,y)と倍率／menu＝メニューの板の左上(x,y)と幅w。絵に合わせてここの数字を変える */
export const TITLE_SETS = {
  a: { logo: { cx: 640, cy: 168, w: 760, rot: 0 }, hero: { x: 330, y: 690, scale: 2.5 }, menu: { x: 884, y: 404, w: 340 } },
  b: { logo: { cx: 400, cy: 172, w: 700, rot: 0 }, hero: { x: 930, y: 690, scale: 2.5 }, menu: { x: 56, y: 404, w: 340 } },
};
export const TITLE_MENU = ['スタート', 'オプション', '操作説明'];

function panelRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.lineWidth = 1.5; ctx.strokeStyle = stroke; ctx.stroke(); }
}

function drawTitleNew(ctx, game) {
  const { assets } = game;
  const t = game.time;
  const S = TITLE_SETS[TITLE_ART.set] || TITLE_SETS.a;
  const art = (assets.titleArt && assets.titleArt[TITLE_ART.set]) || null;
  if (!art && assets.ensureTitleArt && !(assets.titleArtLoading && assets.titleArtLoading[TITLE_ART.set])) assets.ensureTitleArt(TITLE_ART.set);      // 組を途中で変えたときだけ（普段は起動のときに読み済み）。読めなくても投げない
  // 背景：絵が読めればそれ。無ければ今の面の背景＋上下に暗いグラデーション
  if (art && art.bg) ctx.drawImage(art.bg, 0, 0, W, H);
  else {
    drawBackground(ctx, assets, game.stages[game.titleBgStage]);
    ctx.fillStyle = 'rgba(8,12,20,0.22)'; ctx.fillRect(0, 0, W, H);
    const gt = ctx.createLinearGradient(0, 0, 0, 300); gt.addColorStop(0, 'rgba(4,6,14,0.72)'); gt.addColorStop(1, 'rgba(4,6,14,0)');
    ctx.fillStyle = gt; ctx.fillRect(0, 0, W, 300);
    const gb = ctx.createLinearGradient(0, 380, 0, H); gb.addColorStop(0, 'rgba(4,6,14,0)'); gb.addColorStop(1, 'rgba(4,6,14,0.78)');
    ctx.fillStyle = gb; ctx.fillRect(0, 380, W, H - 380);
  }
  // 主人公（今の待機の動き）
  const sp = 'Spinosaurus';
  const meta = assets.motions.dinos[sp].motions.Idle;
  const fr = animFrame({ from: 0, to: 20, dur: 1.4, loop: true, t }, meta.n);
  ctx.save(); ctx.globalAlpha = 1;
  drawFrame(ctx, assets, sp, 'Idle', fr, S.hero.x, S.hero.y, 1, { scaleMul: S.hero.scale });
  ctx.restore();
  // ロゴ：絵があればそれ。無ければ落ち着いた字（太い字＋細い縁＋控えめな光）
  const L = S.logo;
  let bottom;
  if (art && art.logo) {
    const iw = art.logo.naturalWidth || art.logo.width || 1, ih = art.logo.naturalHeight || art.logo.height || 1;
    const w = L.w, h = w * ih / iw;
    ctx.save(); ctx.translate(L.cx, L.cy); ctx.rotate(L.rot || 0);
    ctx.drawImage(art.logo, -w / 2, -h / 2, w, h);
    ctx.restore();
    bottom = L.cy + h / 2;
  } else {
    const name = 'ダイノ・スマッシュ', fs = 84;
    ctx.save();
    ctx.translate(L.cx, L.cy + 30); ctx.rotate(L.rot || 0);
    ctx.font = `900 ${fs}px ${FONT_JP}`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    try { ctx.letterSpacing = '8px'; } catch (e) { /* 字間が付かなくてもよい */ }
    ctx.shadowColor = 'rgba(255,205,130,0.38)'; ctx.shadowBlur = 20;
    ctx.lineWidth = 14; ctx.strokeStyle = '#120d1c'; ctx.strokeText(name, 0, 0);
    ctx.shadowBlur = 0;
    const g = ctx.createLinearGradient(0, -fs * 0.85, 0, fs * 0.1);
    g.addColorStop(0, '#fffaf0'); g.addColorStop(0.55, '#f1dfb0'); g.addColorStop(1, '#d6a548');
    ctx.fillStyle = g; ctx.fillText(name, 0, 0);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(120,76,20,0.85)'; ctx.strokeText(name, 0, 0);
    ctx.restore();
    bottom = L.cy + 30 + 22;
  }
  // キャッチコピー（ロゴの下に小さく）と細い飾り線
  const tagY = Math.round(bottom + 46);
  text(ctx, '敵を殴って、壁に叩きつけろ。', L.cx, tagY, { size: 22, align: 'center', color: '#fff' });
  ctx.fillStyle = 'rgba(255,225,160,0.55)'; ctx.fillRect(L.cx - 250, tagY - 38, 500, 1.5);
  text(ctx, VERSION.split('（')[0] + (tekkenOn() ? '　操作B' : ''), W - 20, 28, { size: 16, align: 'right', color: '#ffe9a8' });      // 版（右上に小さく。中身の説明は出さず「ver 4.0」だけ＝タイトルに長い文を出さない）
  // メニュー：薄い半透明の板の上に小さく
  const M = S.menu, o = game.opts, sel = game.titleSel, rh = 40;
  const notes = [];
  if (o.stage > 0) notes.push(`${game.stages[o.stage].label} から`);
  if (o.mpFree) notes.push('CP FREE');
  const hasNotes = notes.length > 0, mh = 14 + TITLE_MENU.length * rh + (hasNotes ? 26 : 0) + 46 + 8;
  panelRect(ctx, M.x, M.y, M.w, mh, 10, 'rgba(8,12,24,0.58)', 'rgba(255,255,255,0.16)');
  const blink = 0.85 + 0.15 * Math.sin(t * 4), mx = M.x + M.w / 2;
  TITLE_MENU.forEach((label, i) => {
    const y = M.y + 14 + i * rh, on = sel === i;
    if (on) { panelRect(ctx, M.x + 10, y, M.w - 20, rh - 4, 6, 'rgba(110,190,255,0.24)', 'rgba(140,210,255,0.55)'); }
    text(ctx, label, mx, y + 28, on ? { size: 26, align: 'center', color: '#fff', alpha: blink } : { size: 24, align: 'center', color: '#cfd8ea', alpha: 0.9 });
    if (on) text(ctx, '▶', M.x + 30, y + 27, { size: 20, align: 'center', color: '#8fd0ff', alpha: blink });
  });
  let yy = M.y + 14 + TITLE_MENU.length * rh;
  if (hasNotes) { text(ctx, notes.join('　'), mx, yy + 18, { size: 16, align: 'center', color: '#ffb15a' }); yy += 26; }
  const d = difficultyOf(game.difficulty), i = DIFFICULTY_ORDER.indexOf(d.id);
  text(ctx, `${i > 0 ? '◀' : '　'}  難しさ： ${d.label}  ${i < DIFFICULTY_ORDER.length - 1 ? '▶' : '　'}`, mx, yy + 32, { size: 20, align: 'center', color: d.id === 'hard' ? '#ff9a8a' : d.id === 'easy' ? '#9fffb0' : '#ffe9a8' });
  text(ctx, helpTexts().SND, W / 2, H - 10, { size: 12, align: 'center', color: '#9fb0cc', alpha: 0.85 });
}

/** 文を、幅 maxW に収まるように折り返す（区切りの空白・読点・句点のあとで折る。1字も減らさない）。 */
function wrapHelp(ctx, str, maxW) {
  const toks = str.match(/[^　 、。]+[　 、。]*|[　 、。]+/g) || [str];
  const out = []; let cur = '';
  for (const tk of toks) {
    if (cur && ctx.measureText(cur + tk).width > maxW) { out.push(cur.replace(/[　 ]+$/, '')); cur = tk; } else cur += tk;
  }
  if (cur) out.push(cur.replace(/[　 ]+$/, ''));
  return out;
}

/** 2026-11-15：操作説明の画面（前はタイトルの下の帯に出していた文を、見出しで分けて並べた物）。B / Esc でもどる。 */
export function drawControls(ctx, game) {
  drawBackground(ctx, game.assets, game.stages[game.titleBgStage]);
  ctx.fillStyle = 'rgba(8,12,20,0.84)'; ctx.fillRect(0, 0, W, H);
  panelRect(ctx, 36, 88, W - 72, H - 88 - 62, 12, 'rgba(14,20,36,0.7)', 'rgba(255,255,255,0.14)');
  text(ctx, '操作説明', 60, 66, { size: 44, color: '#fff' });
  const { L0, L1, guard, L2, K, P, SND } = helpTexts();
  const strip = (s, head) => s.replace(new RegExp(`^${head}：\\s*`), '');
  const sections = [
    { head: '動きと技', hc: '#7df0ff', items: [[L0, '#7df0ff'], [L1, '#fff'], [guard, '#fff'], [L2, '#ffe9a8']] },
    { head: 'キーボード', hc: '#cfe0ff', items: [[strip(K, 'キーボード'), '#cfe0ff']] },
    { head: 'ゲームパッド', hc: '#9fffb0', items: [[strip(P, 'ゲームパッド'), '#9fffb0']] },
  ];
  const SZ = 23, LH = 33, X = 76, MAXW = W - 2 * X - 20;
  ctx.save(); ctx.font = `bold ${SZ}px ${FONT_JP}`;
  let y = 128;
  for (const sec of sections) {
    ctx.fillStyle = sec.hc; ctx.fillRect(X - 20, y - 20, 6, 24);
    text(ctx, sec.head, X, y, { size: 26, color: sec.hc });
    y += 42;
    for (const [s, col] of sec.items) {
      for (const ln of wrapHelp(ctx, s, MAXW)) { text(ctx, ln, X, y, { size: SZ, color: col }); y += LH; }
      y += 6;
    }
    y += 10;
  }
  ctx.restore();
  text(ctx, SND, X, y + 6, { size: 19, color: '#9fb0cc' });
  text(ctx, 'B / Esc でもどる', W / 2, H - 20, { size: 24, align: 'center', color: '#fff' });
}

/** パッドが つながっている間、隅に小さく出す（つないだ／外した の知らせは game.js の toast）。 */
export function drawPadBadge(ctx, game, x, y) {
  const inp = game.input;
  if (!inp || !inp.padConnected) return;
  text(ctx, '● ゲームパッド接続中', x, y, { size: 15, align: 'right', color: '#9fffb0', alpha: 0.85 });
}

/** 版2.1：ポーズメニュー（つづける／技表／オプション／タイトルへもどる）。技表とタイトルの確認はその上の別の見え方。 */
export const PAUSE_ITEMS = [
  { id: 'resume', en: 'CONTINUE', jp: 'つづける', help: '戦闘にもどる（Esc / Start でも）' },
  { id: 'moves', en: 'MOVE LIST', jp: '技表', help: '出せる技と、コマンド・CP の量を見る' },
  { id: 'option', en: 'OPTION', jp: 'オプション', help: '音量・CP 消費なし・当たり判定の表示・技の入れ方を戦闘中に変える' },
  { id: 'title', en: 'TITLE', jp: 'タイトルへもどる', help: '今の遊びを終えてタイトルへ（確認が出ます）' },
];

export function drawPause(ctx, game) {
  if (game.pauseView === 'moves') { drawMoveList(ctx, game); return; }
  ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(0, 0, W, H);
  text(ctx, 'PAUSE', W / 2, 188, { size: 96, font: `900 96px ${FONT_EN}`, align: 'center', color: '#fff', lw: 12 });
  const t = game.time, x0 = 380, x1 = W - 380, y0 = 236, rh = 74;
  const confirm = game.pauseView === 'confirm';
  ctx.fillStyle = 'rgba(10,16,30,0.82)'; ctx.fillRect(x0 - 30, y0 - 16, x1 - x0 + 60, PAUSE_ITEMS.length * rh + 30);
  ctx.strokeStyle = 'rgba(232,237,247,0.55)'; ctx.lineWidth = 3; ctx.strokeRect(x0 - 30, y0 - 16, x1 - x0 + 60, PAUSE_ITEMS.length * rh + 30);
  PAUSE_ITEMS.forEach((it, i) => {
    const y = y0 + i * rh, on = i === game.pauseSel && !confirm;
    if (on) {
      const g = ctx.createLinearGradient(x0 - 26, 0, x1 + 26, 0);
      g.addColorStop(0, 'rgba(58,160,255,0.5)'); g.addColorStop(1, 'rgba(58,160,255,0.08)');
      ctx.fillStyle = g; ctx.fillRect(x0 - 26, y, x1 - x0 + 52, rh - 8);
    }
    const base = y + 44;
    text(ctx, on ? '▶' : '', x0 - 14, base, { size: 28, color: '#7df0ff', alpha: 0.6 + 0.4 * Math.sin(t * 8) });
    text(ctx, it.jp, x0 + 30, base, { size: 34, color: on ? '#ffffff' : i === game.pauseSel ? '#ffe9a8' : '#cfd8ea' });
    text(ctx, it.en, x1 - 4, base - 2, { size: 20, font: `900 20px ${FONT_EN}`, align: 'right', color: on ? '#ffe14a' : '#7f8ba5' });
  });
  if (!confirm) text(ctx, PAUSE_ITEMS[game.pauseSel].help, W / 2, y0 + PAUSE_ITEMS.length * rh + 44, { size: 20, align: 'center', color: '#e8edf7' });
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 76, W, 76);
  text(ctx, '↑ ↓ 選ぶ　Enter / A 決定　Esc / Start / B 再開　　M・Back+A 消音　F 全画面　T・Back+B タイトルへ', W / 2, H - 44, { size: 18, align: 'center', color: '#cfe0ff' });
  const pad = game.input.padConnected ? `ゲームパッド接続中：${game.input.padName || ''}` : 'ゲームパッドは つながっていません（つないだら ボタンを1回押す）';
  text(ctx, pad, W / 2, H - 18, { size: 15, align: 'center', color: game.input.padConnected ? '#9fffb0' : '#9fb0cc' });
  if (confirm) drawPauseConfirm(ctx, game);
}

function drawPauseConfirm(ctx, game) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
  const bx = 300, by = 240, bw = W - 600, bh = 240;
  ctx.fillStyle = 'rgba(12,18,34,0.96)'; ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 4; ctx.strokeRect(bx, by, bw, bh);
  text(ctx, 'タイトルへもどりますか？', W / 2, by + 74, { size: 38, align: 'center', color: '#fff' });
  text(ctx, '今の遊びは、ここで終わります（スコアやコンボは引き継がれません）', W / 2, by + 112, { size: 18, align: 'center', color: '#cfd8ea' });
  [['はい', true, W / 2 - 130], ['いいえ', false, W / 2 + 130]].forEach(([label, v, cx]) => {
    const on = game.pauseYes === v;
    if (on) { ctx.fillStyle = 'rgba(58,160,255,0.45)'; ctx.fillRect(cx - 100, by + 140, 200, 56); }
    ctx.strokeStyle = on ? '#7df0ff' : 'rgba(207,216,234,0.4)'; ctx.lineWidth = 3; ctx.strokeRect(cx - 100, by + 140, 200, 56);
    text(ctx, label, cx, by + 180, { size: 30, align: 'center', color: on ? '#fff' : '#9fb0cc' });
  });
  text(ctx, '← → で選ぶ　Enter / A 決定　Esc / Start / B やめる', W / 2, by + bh - 14, { size: 15, align: 'center', color: '#9fb0cc' });
}

/** 版2.1：技表。技の表（moves.js）から game.moveList（movelist.js）が自動で作る。← → で分類、↑ ↓ で見る。 */
function drawMoveList(ctx, game) {
  const t = game.time, ml = game.moveList, cat = ml.cats[game.moveCat], list = cat.entries;
  ctx.fillStyle = '#060a14'; ctx.fillRect(0, 0, W, H);      // 後ろの戦闘画面（HUD）が透けて文字に重ならないよう、塗りつぶす
  text(ctx, 'MOVE LIST', 88, 74, { size: 54, font: `900 54px ${FONT_EN}`, color: '#ffe14a', lw: 8, shadow: '#ff9a00', glow: 12 });
  text(ctx, '技表', 440, 70, { size: 28, color: '#fff3c4' });
  text(ctx, `全 ${ml.count} 技`, W - 60, 70, { size: 22, align: 'right', color: '#9fb0cc' });
  // 分類のタブ
  const tabW = (W - 120) / ml.cats.length;
  ml.cats.forEach((c, i) => {
    const x = 60 + i * tabW, on = i === game.moveCat;
    ctx.fillStyle = on ? 'rgba(58,160,255,0.5)' : 'rgba(30,40,64,0.7)'; ctx.fillRect(x + 4, 96, tabW - 8, 46);
    ctx.strokeStyle = on ? '#7df0ff' : 'rgba(207,216,234,0.3)'; ctx.lineWidth = on ? 3 : 2; ctx.strokeRect(x + 4, 96, tabW - 8, 46);
    text(ctx, `${c.jp}（${c.entries.length}）`, x + tabW / 2, 128, { size: 24, align: 'center', color: on ? '#fff' : '#9fb0cc' });
  });
  text(ctx, '◀', 38, 128, { size: 22, align: 'center', color: '#7df0ff', alpha: 0.6 + 0.4 * Math.sin(t * 6) });
  text(ctx, '▶', W - 38, 128, { size: 22, align: 'center', color: '#7df0ff', alpha: 0.6 + 0.4 * Math.sin(t * 6) });
  // 見出し
  const px0 = 70, px1 = W - 70, hy = 176;
  const cName = px0 + 20, cCmd = 520, cBtn = 880, cGauge = px1 - 16;
  text(ctx, '技', cName, hy, { size: 16, color: '#7f8ba5' });
  text(ctx, 'コマンド', cCmd, hy, { size: 16, color: '#7f8ba5' });
  text(ctx, 'ボタン（キー ／ パッド）', cBtn, hy, { size: 16, color: '#7f8ba5' });
  text(ctx, 'CP', cGauge, hy, { size: 16, align: 'right', color: '#7f8ba5' });
  // 一覧（見える行だけ。選んだ行が見える所までスクロール）
  const rowH = 82, vis = 5, y0 = 190;
  const top = clamp(game.moveCur - Math.floor(vis / 2), 0, Math.max(0, list.length - vis));
  ctx.save(); ctx.beginPath(); ctx.rect(px0 - 10, y0 - 4, px1 - px0 + 20, vis * rowH + 4); ctx.clip();
  for (let k = 0; k < vis && top + k < list.length; k++) {
    const i = top + k, e = list[i], y = y0 + k * rowH, on = i === game.moveCur;
    ctx.fillStyle = on ? 'rgba(58,160,255,0.28)' : (k % 2 ? 'rgba(20,28,48,0.55)' : 'rgba(14,20,36,0.55)');
    ctx.fillRect(px0, y, px1 - px0, rowH - 6);
    if (on) { ctx.strokeStyle = '#7df0ff'; ctx.lineWidth = 2; ctx.strokeRect(px0 + 1, y + 1, px1 - px0 - 2, rowH - 8); }
    text(ctx, e.name, cName, y + 34, { size: 27, color: on ? '#fff' : '#e8edf7' });
    // 2026-11-14：欄の幅に収める（「大ジャンプ」のコマンドがボタンの欄に、「いどう」のボタンが CP の欄に重なっていた）
    text(ctx, e.cmd, cCmd, y + 36, { size: 28, color: '#7df0ff', font: `bold 28px ${FONT_JP}`, maxW: cBtn - cCmd - 20 });
    if (e.key) text(ctx, `${e.key}  ／  ${e.pad}`, cBtn, y + 34, { size: 24, color: '#ffe9a8', maxW: cGauge - 100 - cBtn });
    const free = game.opts.mpFree && e.cost > 0;
    if (e.cost > 0) {
      text(ctx, String(e.cost), cGauge - (free ? 78 : 0), y + 34, { size: 28, font: `900 28px ${FONT_EN}`, align: 'right', color: free ? '#6b7a99' : '#ffb15a' });
      if (free) text(ctx, 'FREE', cGauge, y + 33, { size: 20, font: `900 20px ${FONT_EN}`, align: 'right', color: '#9fffb0' });
    } else text(ctx, '—', cGauge, y + 34, { size: 24, align: 'right', color: '#6b7a99' });
    const cond = e.cond ? `【${e.cond}】` : '';
    if (cond) text(ctx, cond, cName, y + 62, { size: 17, color: '#ffb15a' });
    const dx = cName + (cond ? measureJp(ctx, cond, 17) + 10 : 0);
    text(ctx, e.desc, dx, y + 62, { size: 18, color: on ? '#fff' : '#b9c6df', maxW: px1 - 12 - dx });      // 2026-11-14：長い説明（急降下の踏みつけ＝約 2570px まで）が切れていた。行の幅に詰める
  }
  ctx.restore();
  // スクロールの印
  if (list.length > vis) {
    const sx = px1 + 22, sh = vis * rowH - 10, th = Math.max(30, sh * vis / list.length);
    ctx.fillStyle = 'rgba(207,216,234,0.25)'; ctx.fillRect(sx, y0, 6, sh);
    ctx.fillStyle = '#7df0ff'; ctx.fillRect(sx, y0 + (sh - th) * (list.length > vis ? top / (list.length - vis) : 0), 6, th);
    if (top > 0) text(ctx, '▲', W / 2, y0 - 8, { size: 16, align: 'center', color: '#7df0ff' });
    if (top + vis < list.length) text(ctx, '▼', W / 2, y0 + vis * rowH + 14, { size: 16, align: 'center', color: '#7df0ff' });
  }
  text(ctx, `${game.moveCur + 1} / ${list.length}`, px1, y0 + vis * rowH + 18, { size: 18, align: 'right', color: '#9fb0cc' });
  text(ctx, '矢印は、いま向いている側が →（前）　↓↘→ は「↓を押し、斜めを通り、→」', px0, y0 + vis * rowH + 18, { size: 16, color: '#9fb0cc' });
  // 2026-11-15：分類の一言（必殺＝CP が足りないときは別の技が出る・続けて出すほど CP が増える）。行の下・下の帯の上に 1 行、幅に収める
  const catNote = (game.moveList.cats[game.moveCat] || {}).note;
  if (catNote) text(ctx, catNote, px0, y0 + vis * rowH + 42, { size: 15, color: '#ffb15a', maxW: px1 - px0 });
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 56, W, 56);
  text(ctx, '← → 分類　↑ ↓ 技を見る（押しっぱなしで速く）　Esc / Start / B もどる', W / 2, H - 22, { size: 18, align: 'center', color: '#cfe0ff' });
}

function measureJp(ctx, str, size) {
  ctx.save(); ctx.font = `bold ${size}px ${FONT_JP}`; const w = ctx.measureText(str).width; ctx.restore(); return w;
}
/** 2026-11-14：日本語の 1 行を、幅 maxW の行に分ける（句読点・括弧・中黒の後ろで切れればそこで切る）。同じ文字列は覚えておく（毎フレーム測らない）。 */
const wrapCache = new Map();
export function wrapJp(ctx, str, size, maxW) {
  const key = `${size}|${maxW}|${str}`;
  if (wrapCache.has(key)) return wrapCache.get(key);
  const lines = [];
  let rest = String(str);
  while (rest.length && lines.length < 6) {
    if (measureJp(ctx, rest, size) <= maxW) { lines.push(rest); rest = ''; break; }
    let n = 1;
    while (n < rest.length && measureJp(ctx, rest.slice(0, n + 1), size) <= maxW) n++;
    let cut = n;
    for (let k = n; k > n * 0.5; k--) if ('。、）」・！？ '.includes(rest[k - 1])) { cut = k; break; }
    lines.push(rest.slice(0, cut)); rest = rest.slice(cut);
  }
  if (rest.length && lines.length) lines[lines.length - 1] += rest;      // 6 行を超える分は最後の行へ（maxW で詰める）
  if (wrapCache.size > 200) wrapCache.clear();
  wrapCache.set(key, lines);
  return lines;
}

/** ゲームオーバーの案内の文。A は離して押し直したときだけ決まる（CONFIRM_A_FIX）ので、そう書く。つまみを切ると前の文。 */
export function gameOverGuide() {
  return CONFIRM_A_FIX.on ? 'Enter / Start か、A を離して押し直すと つづける' : 'Enter / Start / A で つづける（その場で復活）';
}

export function drawGameOver(ctx, game) {
  const w = game.world;
  const a = clamp(w.phaseT / 0.8, 0, 1);
  ctx.fillStyle = `rgba(10,0,0,${0.55 * a})`; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = a;
  text(ctx, 'やられた…', W / 2, 290, { size: 96, align: 'center', color: '#ff6a5c', lw: 12 });
  const blink = 0.55 + 0.45 * Math.sin(game.time * 5);
  text(ctx, gameOverGuide(), W / 2, 372, { size: 32, align: 'center', color: '#fff', alpha: blink });
  text(ctx, 'Esc・Back+B でタイトルへ　　つづけた回数: ' + w.continues, W / 2, 416, { size: 22, align: 'center', color: '#cfd8ea' });
  ctx.restore();
}

/** 2026-11-15：エンディングのスタッフロール（Nao「セピア調にして、エンディングのスタッフロールみたいな感じにして、クレジットを流して」「余ったところにスタッフロール」）。
 *  on=false で旧＝すぐ「ALL CLEAR!」の画面（比べ用・検査の陰性対照）。speed＝流れる速さ（px/秒）・hold＝流れ終わってから絵だけ見せる秒・skipLock＝始まってからボタンで飛ばせるまでの秒（連打の取りこぼし防止）。 */
export const ENDING_ROLL = { on: true, speed: 56, hold: 4, skipLock: 0.5 };
export const ROLL_ART_W = 480;      // 縦長の絵（720×1080 を高さ 720 に）の幅。画面の左に置く
const ROLL_X0 = 540, ROLL_X1 = W - 40, ROLL_CX = (ROLL_X0 + ROLL_X1) / 2;      // 絵の右の余白（ここにだけ字を流す）
const ROLL_COL = { head: '#c4a06a', name: '#f4e8cb', note: '#d2bd96' };

/** 流れる字の並び（y は先頭からの距離）。{ y, str, size, color, font, kind }。total＝全体の高さ。 */
export function endingRollItems() {
  const items = []; let y = 0;
  items.push({ y: y += 64, str: CREDITS_TITLE.en, size: 64, color: '#f7ecd0', kind: 'title', en: true });
  items.push({ y: y += 46, str: CREDITS_TITLE.jp, size: 28, color: ROLL_COL.name, kind: 'title' });
  y += 90;
  for (const b of CREDITS) {
    items.push({ y: y += 30, str: b.h, size: 22, color: ROLL_COL.head, kind: 'head' });
    for (const s of b.n) {
      const note = s.startsWith('※');
      items.push({ y: y += note ? 30 : 44, str: s, size: note ? 20 : 32, color: note ? ROLL_COL.note : ROLL_COL.name, kind: note ? 'note' : 'name' });
    }
    y += 62;
  }
  return { items, total: y };
}

/** 流れ終わるまでの秒（最後の字が画面の上へ消えるまで）。 */
export function endingRollScrollSec() { return (endingRollItems().total + H + 60) / ENDING_ROLL.speed; }
/** スタッフロール全体の秒（流れる＋絵だけの時間）。 */
export function endingRollSec() { return endingRollScrollSec() + ENDING_ROLL.hold; }

export function drawEndingRoll(ctx, game) {
  const { assets } = game;
  const t = game.endT;
  if (assets.ensureEndingArt && !assets.endingArtLoading) assets.ensureEndingArt();      // 普段は toTitle で読み済み。読めなくても投げない
  const ea = assets.endingArt || {};
  ctx.save();
  ctx.fillStyle = '#1c130b'; ctx.fillRect(0, 0, W, H);
  if (ea.bg) ctx.drawImage(ea.bg, 0, 0, W, H);
  if (ea.art) ctx.drawImage(ea.art, 0, 0, ROLL_ART_W, H);      // 左に、高さいっぱい。字は絵の上に重ねない
  else { ctx.fillStyle = '#3a2a1a'; ctx.fillRect(0, 0, ROLL_ART_W, H); }
  const g = ctx.createLinearGradient(ROLL_ART_W - 2, 0, ROLL_ART_W + 46, 0);      // 絵と余白の境目をなじませる
  g.addColorStop(0, 'rgba(18,11,6,0.0)'); g.addColorStop(0.18, 'rgba(18,11,6,0.55)'); g.addColorStop(1, 'rgba(18,11,6,0.0)');
  ctx.fillStyle = g; ctx.fillRect(ROLL_ART_W - 2, 0, 48, H);
  // 字は余白の中だけ
  ctx.beginPath(); ctx.rect(ROLL_X0 - 20, 0, W - ROLL_X0 + 20, H); ctx.clip();
  const { items } = endingRollItems();
  const scroll = Math.max(0, t - 0.8) * ENDING_ROLL.speed;
  for (const it of items) {
    const y = Math.round(H + 20 + it.y - scroll);
    if (y < -60 || y > H + 60) continue;
    const a = clamp(Math.min((y - 30) / 90, (H - 12 - y) / 70), 0, 1);      // 上と下の端でなめらかに消える
    if (a <= 0) continue;
    text(ctx, it.str, ROLL_CX, y, { size: it.size, font: it.en ? `900 ${it.size}px ${FONT_EN}` : `bold ${it.size}px ${FONT_JP}`, align: 'center', color: it.color, alpha: a, maxW: ROLL_X1 - ROLL_X0, stroke: null, shadow: 'rgba(0,0,0,0.85)', glow: 6 });
  }
  ctx.restore();
  // 最初の暗転からの明るさ
  if (t < 1.6) { ctx.fillStyle = `rgba(0,0,0,${(1 - t / 1.6).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  if (t > 0.4) text(ctx, 'A / Enter でスキップ', W - 28, H - 24, { size: 18, align: 'right', color: '#eadcb8', alpha: 0.72, stroke: null });
}

export function drawEnding(ctx, game) {
  if (game.endPhase === 'roll') { drawEndingRoll(ctx, game); return; }
  const { assets, world } = game;
  const t = game.endT;
  drawBackground(ctx, assets, game.stages[game.stages.length - 1]);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
  // 主人公の勝ちポーズ（Victory の動き）
  const sp = 'Spinosaurus';
  const meta = assets.motions.dinos[sp].motions.Victory;
  const fr = animFrame({ from: 0, to: 63, dur: 4.2, loop: true, t }, meta.n);
  drawFrame(ctx, assets, sp, 'Victory', fr, W / 2, 640, 1, { scaleMul: 2.0 });
  const a = clamp(t / 1.2, 0, 1);
  ctx.save(); ctx.globalAlpha = a;
  text(ctx, 'ALL CLEAR!', W / 2, 150, { size: 120, font: `900 120px ${FONT_EN}`, align: 'center', color: '#ffe14a', lw: 14, shadow: '#ff9a00', glow: 24 });
  text(ctx, `SCORE  ${String(world.score).padStart(8, '0')}`, W / 2, 226, { size: 44, font: `900 44px ${FONT_EN}`, align: 'center', color: '#fff' });
  text(ctx, `最大コンボ ${world.maxCombo}　　壁ドン ${world.stats.wallBangs || 0}　　玉突き ${world.stats.chains}　　つづけた回数 ${world.continues}`, W / 2, 268, { size: 24, align: 'center', color: '#e8f0ff' });
  drawAssistBadges(ctx, game, W / 2, 360, 'center', '（この回は「%」を使いました）');
  if (t > 2.2) {
    const blink = 0.55 + 0.45 * Math.sin(game.time * 4);
    text(ctx, 'Enter / Start / A でタイトルへ', W / 2, 322, { size: 32, align: 'center', color: '#fff', alpha: blink });
  }
  ctx.restore();
}

/** 版2.0：CP FREE・STAGE SELECT で遊んだ回の小さな印（HUD の右上・エンディング）。原作も、これらの補助を使うとクリアの記録に数えない作りなので、それと分かるようにする。 */
export function drawAssistBadges(ctx, game, x, y, align = 'right', fmt = null) {
  const r = game.run;
  if (!r) return;
  const names = [];
  if (r.mpFree) names.push('CP FREE');
  if (r.stageSel) names.push('STAGE SELECT');
  if (!names.length) return;
  const label = fmt ? fmt.replace('%', names.join(' / ')) : names.join('  ');
  text(ctx, label, x, y, { size: 15, font: fmt ? undefined : `900 15px ${FONT_EN}`, align, color: '#ffb15a', alpha: 0.95, shadow: '#000', glow: 4 });
}

/** 版2.0：オプション画面（原作『ミスティックアーツ』のオプションに倣った項目）。 */
export function drawOptions(ctx, game) {
  const { assets } = game;
  const t = game.time;
  if (!game.optFromPause) drawBackground(ctx, assets, game.stages[game.titleBgStage]);      // ポーズメニューから開いたときは、戦闘の画面（game.js が先に描いてある）の上に重ねる
  ctx.fillStyle = game.optFromPause ? 'rgba(8,12,20,0.82)' : 'rgba(8,12,20,0.72)'; ctx.fillRect(0, 0, W, H);
  text(ctx, 'OPTION', W / 2, 96, { size: 70, font: `900 70px ${FONT_EN}`, align: 'center', color: '#ffe14a', lw: 10, shadow: '#ff9a00', glow: 16 });
  text(ctx, 'オプション', W / 2, 132, { size: 24, align: 'center', color: '#fff3c4' });
  text(ctx, VERSION, W - 20, 36, { size: 24, align: 'right', color: '#ffe9a8', shadow: '#000', glow: 6 });

  const rows = game.optRows(), o = game.opts;
  const x0 = 250, x1 = W - 250, y0 = 168, rh = rows.length > 9 ? 42 : rows.length > 8 ? 46 : rows.length > 7 ? 52 : 58;      // 版2.3：行が8本になったので、行の間をわずかに詰める（下の説明文と帯に重ならないように）
  ctx.fillStyle = 'rgba(10,16,30,0.78)'; ctx.fillRect(x0 - 24, y0 - 16, x1 - x0 + 48, rows.length * rh + 30);
  ctx.strokeStyle = 'rgba(232,237,247,0.55)'; ctx.lineWidth = 3; ctx.strokeRect(x0 - 24, y0 - 16, x1 - x0 + 48, rows.length * rh + 30);
  rows.forEach((row, i) => {
    const y = y0 + i * rh, on = i === game.optSel;
    if (on) {
      const g = ctx.createLinearGradient(x0 - 20, 0, x1 + 20, 0);
      g.addColorStop(0, 'rgba(58,160,255,0.45)'); g.addColorStop(1, 'rgba(58,160,255,0.08)');
      ctx.fillStyle = g; ctx.fillRect(x0 - 20, y, x1 - x0 + 40, rh - 6);
    }
    const base = y + (rh < 50 ? 32 : 36);
    text(ctx, on ? '▶' : '', x0 - 16, base, { size: 26, color: '#7df0ff', alpha: 0.6 + 0.4 * Math.sin(t * 8) });
    text(ctx, row.en, x0 + 20, base, { size: 28, font: `900 28px ${FONT_EN}`, color: on ? '#ffffff' : '#cfd8ea' });
    text(ctx, row.jp, x0 + 290, base - 2, { size: 18, color: on ? '#fff3c4' : '#9fb0cc' });
    const vx = x1 - 10;
    const val = optionValue(game, row, o);
    if (val) {
      const arrows = on && row.kind !== 'bool' && row.kind !== 'action';
      text(ctx, val.text, vx - 36, base, { size: val.size || 26, font: val.font, align: 'right', color: val.color, maxW: val.maxW });
      if (arrows) {
        text(ctx, '◀', vx - 36 - (val.w || 150), base, { size: 20, align: 'right', color: '#7df0ff' });
        text(ctx, '▶', vx, base, { size: 20, align: 'right', color: '#7df0ff' });
      }
    }
  });
  const row = rows[game.optSel];
  text(ctx, row.help || (row.id === 'level' ? 'やさしい・ふつう・むずかしい（面が進むほど強くなる曲線は共通）' : 'Enter / A で前の画面へ'), W / 2, y0 + rows.length * rh + 44, { size: 18, align: 'center', color: '#e8edf7', maxW: W - 40 });      // 2026-11-20：長い説明（COMMAND）でも画面の幅に収める
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 56, W, 56);
  text(ctx, '↑ ↓ 項目　← → 値（押しっぱなしで速く）　Enter / A 決定　Esc / T / B もどる　　設定は自動で保存されます', W / 2, H - 22, { size: 17, align: 'center', color: '#cfe0ff' });
}

function optionValue(game, row, o) {
  const onoff = (v) => ({ text: v ? 'ON' : 'OFF', color: v ? '#9fffb0' : '#9fb0cc', font: `900 26px ${FONT_EN}`, w: 40 });
  switch (row.id) {
    case 'level': { const d = difficultyOf(game.difficulty); return { text: d.label, color: d.id === 'hard' ? '#ff9a8a' : d.id === 'easy' ? '#9fffb0' : '#ffe9a8', w: 110 }; }
    case 'mpFree': return onoff(o.mpFree);
    case 'collision': return onoff(o.collision);
    case 'playlog': return onoff(o.playlog);
    case 'cmd': return { text: o.cmd === 'tekken' ? 'B　方向＋ボタン' : 'A　順に入れる', color: o.cmd === 'tekken' ? '#9fe8ff' : '#fff', size: 24, w: 230 };
    case 'numScale': return { text: o.numScale === 1 ? 'そのまま' : '×' + DISPLAY_SCALE, color: o.numScale === 1 ? '#cfd8ea' : '#ffe14a', size: 26, w: 150 };
    case 'bgm': case 'se': {
      const n = o[row.id];
      return { text: n === 0 ? 'OFF' : '■'.repeat(n) + '□'.repeat(LEVEL_MAX - n), color: n === 0 ? '#ff9a8a' : '#7df0ff', size: 26, w: 140 };
    }
    case 'stage': { const st = game.stages[o.stage] || game.stages[0]; const nm = st.user && st.name.length > 12 ? st.name.slice(0, 12) + '…' : st.name; return { text: `${st.label}　${nm}${st.user ? '（ユーザー作）' : ''}`, color: st.user ? '#9fe8ff' : o.stage > 0 ? '#ffb15a' : '#fff', size: 24, w: 310, maxW: 280 }; }      // 2026-11-14：値は項目名「スタートする面」の右に収める（自作の面の長い名前が項目名に重なっていた）      // 版3.3：ユーザー作の面は印つき
    default: return null;
  }
}
