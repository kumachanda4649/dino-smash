// キーボードとゲームパッド（Gamepad API）を、同じ「動作名」にそろえる。
// 動作: left right up down attack jump special confirm pause mute title
const KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyZ: 'attack', KeyX: 'jump', KeyC: 'special',
  Enter: 'confirm', NumpadEnter: 'confirm', Escape: 'pause', KeyM: 'mute', KeyT: 'title',
};
export const ACTIONS = ['left', 'right', 'up', 'down', 'attack', 'jump', 'special', 'confirm', 'pause', 'mute', 'title'];

/** 2026-11-15：Nao「A やられる前から押していた A は数えない（離して押し直したら決まる）」。
 *  パッドの A は攻撃と決定を兼ねるので、やられた直後も攻撃のつもりで A を連打していると「つづける」が決まっていた。
 *  A を離してから gap 秒たってからの押下だけを「押し直し」とみなす（連打の間は 0.1 秒前後）。false で旧＝A の押下はすぐ決定（検査の陰性対照）。 */
export const CONFIRM_A_FIX = { on: true, gap: 0.35 };
/** 2026-11-15：poll() に dt を渡さない（undefined・NaN）ときは、前の poll からの実時間で A を離していた時間を数える。false で旧＝dt なしは 0 秒（検査の陰性対照）。 */
export const POLL_REALTIME_FIX = { on: true };
/** 2026-11-15：スマホ向けのバーチャルコントローラー。on:false で、画面から来る入力を読まない（検査の陰性対照）。表示の出し方は src/touchpad.js（?touch=1 で出す／?touch=0 で出さない） */
export const TOUCH_PAD = { on: true };
const nowSec =() => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;

/** F キーで全画面の切り替え（ブラウザの F11 でもよい）。 */
export function toggleFullscreen(doc = document) {
  try {
    // 全画面の要求は Promise を返し、拒否されると「Uncaught (in promise)」がコンソールに出る。拒否も握りつぶす
    const r = doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) { /* 全画面にできなくても遊べる */ }
}

function shortPadName(id) {
  const s = String(id || '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  return s.length > 28 ? s.slice(0, 28) : s;
}

// ---- ゲームパッド ----
// 標準配置（mapping === 'standard'：Xbox・DualSense・Switch Pro など）の番号:
//   0=下ボタン(A/×/B) 1=右(B/○/A) 2=左(X/□/Y) 3=上(Y/△/X) 8=Back/Select/- 9=Start/Options/+ 12〜15=十字キー（上下左右）
// 標準でないパッドでも、ボタン 0〜3 と十字キー（ハット＝軸9）と左スティック（軸0・1）は読む。
const STICK_ON = 0.4, STICK_KEEP = 0.28;        // 遊び（デッドゾーン）：入るのは 0.4 以上、いったん入ったら 0.28 まで戻っても押している扱い（ガタつき防止）
const SECTOR_ON = 0.38, SECTOR_KEEP = 0.30;     // 斜めの境目：成分が 0.38（約22.5度）以上なら、その軸も押している（斜め＝上下と左右の両方）

/** 左スティック → 4方向。斜めは「両方」押している扱い。prev は前のフレームの状態（ガタつき防止）。 */
export function stickToDirs(ax, ay, prev = {}) {
  ax = Number.isFinite(ax) ? ax : 0; ay = Number.isFinite(ay) ? ay : 0;
  const mag = Math.hypot(ax, ay);
  const nx = mag ? ax / mag : 0, ny = mag ? ay / mag : 0;
  // 方向ごとの判定：入るのは 0.4 以上、その方向をすでに押しているときだけ 0.28 まで粘る（バネで戻るときの行き過ぎで、反対方向を拾わない）
  const on = (d, comp) => mag >= (prev[d] ? STICK_KEEP : STICK_ON) && comp > (prev[d] ? SECTOR_KEEP : SECTOR_ON);
  return { left: on('left', -nx), right: on('right', nx), up: on('up', -ny), down: on('down', ny) };
}

/** ハット（十字キーが軸9に出るパッド）の値 → 4方向。-1=上 … 1=左上、約1.29=ニュートラル。 */
export function hatToDirs(v) {
  if (!Number.isFinite(v) || v > 1.1 || v < -1.1) return {};
  const i = Math.round((v + 1) * 3.5);   // 0上 1右上 2右 3右下 4下 5左下 6左 7左上
  return { up: i === 0 || i === 1 || i === 7, right: i >= 1 && i <= 3, down: i >= 3 && i <= 5, left: i >= 5 && i <= 7 };
}

/** 2026-11-15：休止の位置がずれている軸（ハンドル・ペダルなどは触っていなくても -1 のことがある）を中立として扱う。
 *  on＝使う（false で直す前＝全部の軸をそのまま読む・検査の陰性対照）／off＝初めて見たときにこれより外れていたら「ずれた休止」／keep＝休止の値からこの幅の中は中立／center＝これより真ん中へ戻ったら、ふつうの軸に戻す */
export const PAD_BASE = { on: true, off: 0.5, keep: 0.3, center: 0.15 };
const padKey = (pad) => `${pad.index}|${pad.id}`;
function restAxis(base, k, v) {
  if (!base) return v;
  if (base[k] === undefined) base[k] = Math.abs(v) > PAD_BASE.off ? v : 0;
  if (base[k] !== 0) {
    if (Math.abs(v) < PAD_BASE.center) base[k] = 0;      // 真ん中へ戻った＝ふつうの軸
    else if (Math.abs(v - base[k]) < PAD_BASE.keep) return 0;      // まだ休止の位置
  }
  return v;
}

/** パッドの一覧 → 動作の押下状態（out に書く）。戻り値は次のフレームへ持ち越すスティックの状態。
 *  bases（Input が持つ）を渡すと、パッドごとに休止の位置がずれた軸を中立にする（渡さなければ前と同じ＝試験の読み方）。 */
export function readPads(pads, prevStick, out, bases = null) {
  let stick = {};
  for (const pad of pads) {
    const b = (i) => !!(pad.buttons && pad.buttons[i] && pad.buttons[i].pressed);
    const std = pad.mapping === 'standard';
    // 休止のずれを見るのは、標準配置でない機器だけ（標準配置のパッドの休止は 0。最初に見たときにスティックを倒していても、取り違えて読まなくしない）
    const base = bases && !std ? (bases[padKey(pad)] || (bases[padKey(pad)] = {})) : null;
    const ax = restAxis(base, 'x', (pad.axes && pad.axes[0]) || 0), ay = restAxis(base, 'y', (pad.axes && pad.axes[1]) || 0);
    const sd = stickToDirs(ax, ay, prevStick);
    const hat = (!std && pad.axes && pad.axes.length > 9) ? hatToDirs(pad.axes[9]) : {};
    const dir = (name, bi) => !!(sd[name] || hat[name] || (std && b(bi)));
    out.left = out.left || dir('left', 14);
    out.right = out.right || dir('right', 15);
    out.up = out.up || dir('up', 12);
    out.down = out.down || dir('down', 13);
    stick = { left: stick.left || sd.left, right: stick.right || sd.right, up: stick.up || sd.up, down: stick.down || sd.down };
    if (std && b(8)) {
      // Back/Select を押しながら: A=消音、B=タイトルへ。ほかのボタンは無効（誤爆しない）
      out.mute = out.mute || b(0);
      out.title = out.title || b(1);
      continue;
    }
    out.attack = out.attack || b(0);
    out.jump = out.jump || b(1);
    out.special = out.special || b(2) || b(3);
    out.confirm = out.confirm || b(9) || b(0);
    out.pause = out.pause || b(9);
  }
  for (const a of ACTIONS) out[a] = !!out[a];
  return stick;
}

export class Input {
  constructor(target) {
    this.keyHeld = {};
    this.keyEdge = {};
    this.padHeld = {};
    this.padPrev = {};
    this.edge = {};      // この描画フレームで「押された」もの
    this.heldNow = {};
    this.padConnected = false;
    this.padName = '';
    this.padChange = null;   // 'on' / 'off'：このフレームでつながった／外れた
    this.stickState = {};
    this.anyEdge = false; // 何か押された（音のロック解除用）
    if (target) {
      target.addEventListener('keydown', (e) => {
        if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { toggleFullscreen(); return; }
        const a = KEYS[e.code];
        if (!a) return;
        e.preventDefault();
        if (!e.repeat && !this.keyHeld[a]) this.keyEdge[a] = true;
        this.keyHeld[a] = true;
        this.anyEdge = true;
      });
      target.addEventListener('keyup', (e) => {
        const a = KEYS[e.code];
        if (!a) return;
        e.preventDefault();
        this.keyHeld[a] = false;
      });
      target.addEventListener('blur', () => { this.keyHeld = {}; });
    }
  }

  /** 画面に出すバーチャルコントローラー（src/touchpad.js）から呼ぶ。held＝いま押している動作、tap＝押して離すまでが 1 コマより短い動作も拾う印。 */
  setTouch(held, tap) {
    this.touchHeld = held || {};
    if (tap) for (const a of Object.keys(tap)) if (tap[a]) { this.touchLatch = this.touchLatch || {}; this.touchLatch[a] = true; }
  }

  /** パッドを読み、そこへタッチの入力を重ねる（キー・パッドと混ざっても、どれかが押していれば押している）。 */
  _pollPad() {
    this._pollPadRaw();
    const live = TOUCH_PAD.on ? this.touchHeld : null, latch = TOUCH_PAD.on ? this.touchLatch : null;
    this.touchLatch = null;
    this.touchActive = false;
    if (!live && !latch) return;
    const has = (a) => !!((live && live[a]) || (latch && latch[a]));
    for (const a of ACTIONS) if (has(a)) { this.padHeld[a] = true; this.touchActive = true; }
    // パッドの A／Start と同じ扱い：攻撃は決定を兼ね、Start はポーズと決定
    if (has('attack')) { this.padHeld.confirm = true; this.padAHeld = true; }
    if (has('pause')) { this.padHeld.confirm = true; this.padStartHeld = true; }
  }

  _pollPadRaw() {
    const pads = [];
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      let list = [];
      try { list = Array.from(navigator.getGamepads() || []); } catch (e) { list = []; }
      for (const p of list) if (p && p.connected !== false) pads.push(p);
    }
    const was = this.padConnected;
    this.padConnected = pads.length > 0;
    // 名前の表示は、標準配置（standard）のパッドがあればそちらを先に
    const std = pads.find((p) => p.mapping === 'standard');
    this.padName = pads.length ? shortPadName((std || pads[0]).id) : '';
    this.padChange = was === this.padConnected ? null : (this.padConnected ? 'on' : 'off');
    this.padHeld = {};
    this.padAHeld = false; this.padStartHeld = false;
    // 2026-11-15：休止の位置がずれた軸を覚える入れ物（外したパッドの分は捨てる）。前はハンドル・ペダルなどをつなぐと、休止の軸 -1 が ← ↑ の押しっぱなしになった
    if (!this.padBases) this.padBases = {};
    for (const k of Object.keys(this.padBases)) if (!pads.some((p) => padKey(p) === k)) delete this.padBases[k];
    if (!pads.length) { this.stickState = {}; return; }
    // つないである全部のパッドを重ねる（先に見つけた1台だけにしない）
    const out = {};
    this.stickState = readPads(pads, this.stickState || {}, out, PAD_BASE.on ? this.padBases : null);
    this.padHeld = out;
    // 攻撃と兼ねる A（Back を押している間は決定にならない）と、兼ねない Start を分けて覚える
    for (const p of pads) {
      const b = (i) => !!(p.buttons && p.buttons[i] && p.buttons[i].pressed);
      if (p.mapping === 'standard' && b(8)) continue;
      if (b(0)) this.padAHeld = true;
      if (b(9)) this.padStartHeld = true;
    }
  }

  /** 描画フレームの頭で1回呼ぶ。edge（押した瞬間）と heldNow を確定する。 */
  poll(dt) {
    const tNow = nowSec();
    if (POLL_REALTIME_FIX.on && !Number.isFinite(dt)) dt = this._pollT == null ? 0 : Math.max(0, tNow - this._pollT);
    else if (!Number.isFinite(dt)) dt = 0;
    this._pollT = tNow;
    this._pollPad();
    this.edge = {};
    this.heldNow = {};
    // 2026-11-15：A を離してからの経過（aIdle）。A の押した瞬間に、その直前の離していた長さ（aGap）を残す
    const aEdge = this.padAHeld && !this.aPrev;
    this.aGap = aEdge ? (this.aIdle ?? 99) : 0;
    this.aIdle = this.padAHeld ? 0 : (this.aIdle ?? 99) + dt;
    this.aPrev = this.padAHeld;
    const startEdge = this.padStartHeld && !this.startPrev;
    this.startPrev = this.padStartHeld;
    this.aEdge = aEdge;
    for (const a of ACTIONS) {
      const padOn = !!this.padHeld[a];
      const padEdge = padOn && !this.padPrev[a];
      this.heldNow[a] = !!this.keyHeld[a] || padOn;
      this.edge[a] = !!this.keyEdge[a] || padEdge;
      if (padEdge) this.anyEdge = true;
    }
    // 「決める」意志のある決定：Enter・Start はすぐ、A は押し直し（離してから gap 秒以上）だけ。つまみを切ると edge.confirm のまま
    this.deliberateConfirm = !CONFIRM_A_FIX.on ? this.edge.confirm
      : !!(this.keyEdge.confirm || startEdge || (aEdge && this.aGap >= CONFIRM_A_FIX.gap));
    this.padPrev = { ...this.padHeld };
    this.keyEdge = {};
  }

  /** シミュレーションの1歩ぶんの入力。edge を使えるのは最初の1歩だけ。 */
  snapshot(withEdge) {
    const s = { held: { ...this.heldNow }, pressed: withEdge ? { ...this.edge } : {} };
    return s;
  }

  takeAnyEdge() { const v = this.anyEdge; this.anyEdge = false; return v; }
}

/** テスト・ボット用の入力（DOM なし）。 */
export function emptySnap() {
  const held = {}, pressed = {};
  for (const a of ACTIONS) { held[a] = false; pressed[a] = false; }
  return { held, pressed };
}
