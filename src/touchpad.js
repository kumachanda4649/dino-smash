// スマホ用のバーチャルコントローラー（2026-11-15）。画面の上に半透明で重ね、Input（src/input.js）へ「1 つの入力元」として渡す。
//   左：十字キー（8 方向。指をすべらせると方向が変わる＝↓↘→ のコマンドが指で入る）
//   右：A 攻撃（Z）・B ジャンプ（X）・X 体当たり（C）。複数の指を同時に（移動しながら攻撃）
//   右上：Start（ポーズ・決定）／左上：全画面（できる機器だけ）
// 出し方：?touch=1 で必ず出す（PC でも・マウスの指も受ける）／?touch=0 で出さない／指定なしは「初めて画面に指で触れたとき」に出す
//   （マウスとキーボードの PC では出ない）。画面の形は 1280×720 とは無関係に、見えている画面（ビューポート）の隅へ置く。
import { toggleFullscreen } from './input.js';

/** 置き場所は、画面の短い辺 u に対する割合。ここだけ変えれば配置が変わる。 */
export const PAD_LAYOUT = {
  dpad: { x: 0.26, y: 0.27, r: 0.21 },          // 中心：左から x·u／下から y·u、半径 r·u
  buttons: {
    attack: { x: 0.14, y: 0.19, r: 0.1, label: 'A', sub: '攻撃' },       // 右から x·u／下から y·u
    jump: { x: 0.34, y: 0.11, r: 0.1, label: 'B', sub: 'ジャンプ' },
    special: { x: 0.31, y: 0.37, r: 0.1, label: 'X', sub: '体当たり' },
  },
  start: { w: 0.18, h: 0.1, top: 0.03, right: 0.015 },      // 16:9 より横長の画面では、ゲーム画面の外（右の黒い余白）に収まり、スコアを隠さない
  fs: { s: 0.13, top: 0.03, left: 0.03 },
  hitScale: 1.18,                                   // 指の当たりは見た目より少し広く
  dead: 0.22, deadKeep: 0.14,                       // 十字キーの遊び（半径比）：入るのは 0.22、入ったあとは 0.14 まで戻っても押している扱い
  keepDeg: 28,                                      // 方向の境目のガタつき防止（普通は 22.5 度）
};

const DIR8 = [['right'], ['right', 'down'], ['down'], ['left', 'down'], ['left'], ['left', 'up'], ['up'], ['right', 'up']];   // 画面の角度（右 0 度・下 90 度）順
const ARROWS = { up: '▲', down: '▼', left: '◀', right: '▶' };

/** 十字キーの中心からの位置 → 方向（配列）。prev は前の結果の番号（-1＝なし）。 */
export function padDirIndex(dx, dy, r, prev = -1) {
  const d = Math.hypot(dx, dy);
  if (d < r * (prev >= 0 ? PAD_LAYOUT.deadKeep : PAD_LAYOUT.dead)) return -1;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI; if (deg < 0) deg += 360;
  if (prev >= 0) {
    let diff = Math.abs(deg - prev * 45); if (diff > 180) diff = 360 - diff;
    if (diff <= PAD_LAYOUT.keepDeg) return prev;
  }
  return Math.round(deg / 45) % 8;
}

export function wantTouchUi(params, win = window) {
  const t = params.get('touch');
  if (t === '0') return 'off';
  if (t === '1') return 'on';
  const coarse = !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches && win.matchMedia('(hover: none)').matches);
  return coarse ? 'on' : 'auto';
}

export class TouchPad {
  constructor({ input, params, root = document.body, win = window, onPortrait = null }) {
    this.input = input; this.win = win; this.root = root; this.onPortrait = onPortrait;
    this.mode = wantTouchUi(params, win);
    this.force = params.get('touch') === '1';
    this.shown = false;
    this.ptr = new Map();            // pointerId → { zone, dir }
    this.held = {};
    this.btnEls = {};
    this.dirIdx = -1;
    if (this.mode === 'off') return;
    this._build();
    this._listen();
    if (this.mode === 'on') this.show();
    win.__touchpad = this;
  }

  // ---- 配置（ビューポートの隅） ----
  layout() {
    const w = this.win.innerWidth, h = this.win.innerHeight, u = Math.min(w, h), L = PAD_LAYOUT;
    const sa = this._safe();
    const out = { w, h, u, buttons: {} };
    out.dpad = { cx: L.dpad.x * u + sa.left, cy: h - L.dpad.y * u - sa.bottom, r: L.dpad.r * u };
    for (const [k, b] of Object.entries(L.buttons)) out.buttons[k] = { cx: w - b.x * u - sa.right, cy: h - b.y * u - sa.bottom, r: b.r * u };
    out.start = { x: w - L.start.right * u - L.start.w * u - sa.right, y: L.start.top * u + sa.top, w: L.start.w * u, h: L.start.h * u };
    out.fs = { x: L.fs.left * u + sa.left, y: L.fs.top * u + sa.top, w: L.fs.s * u, h: L.fs.s * u };
    return out;
  }
  _safe() {
    // ノッチ・ホームバーを避ける余白（env(safe-area-inset-*)）。取れなければ 0
    const z = { top: 0, left: 0, right: 0, bottom: 0 };
    try {
      const d = this.win.document;
      if (!this._probe) {
        const p = d.createElement('div');
        p.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;left:0;top:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
        d.body.appendChild(p); this._probe = p;
      }
      const cs = this.win.getComputedStyle(this._probe);
      return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    } catch (_) { return z; }
  }

  _build() {
    const d = this.win.document;
    const css = d.createElement('style');
    css.textContent = `
      #tp { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 50; pointer-events: none; display: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: none; font-family: sans-serif; }
      #tp.show { display: block; }
      #tp .tp-btn, #tp .tp-dpad { position: absolute; box-sizing: border-box; color: #fff; border: 2px solid rgba(255,255,255,0.55); background: rgba(20,30,50,0.28); opacity: 0.55; transition: transform 60ms, opacity 60ms, background 60ms; text-align: center; }
      #tp .tp-btn { border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; text-shadow: 0 1px 3px #000; }
      #tp .tp-btn b { font-size: calc(var(--u) * 0.075); }
      #tp .tp-btn i { font-style: normal; font-size: calc(var(--u) * 0.032); margin-top: 2px; opacity: 0.9; }
      #tp .tp-btn.on { opacity: 0.95; background: rgba(255,200,80,0.55); border-color: #fff; transform: scale(0.9); }
      #tp .tp-rect { border-radius: 10px; font-size: calc(var(--u) * 0.04); font-weight: bold; display: flex; align-items: center; justify-content: center; }
      #tp .tp-dpad { border-radius: 50%; }
      #tp .tp-dpad.on { opacity: 0.8; }
      #tp .tp-arrow { position: absolute; width: 30%; height: 30%; display: flex; align-items: center; justify-content: center; font-size: calc(var(--u) * 0.06); border-radius: 50%; color: rgba(255,255,255,0.85); }
      #tp .tp-arrow.on { background: rgba(255,200,80,0.7); color: #fff; }
      #tp .tp-knob { position: absolute; width: 34%; height: 34%; border-radius: 50%; background: rgba(255,255,255,0.35); border: 2px solid rgba(255,255,255,0.7); left: 33%; top: 33%; }
      #tp-rot { display: none; position: fixed; inset: 0; z-index: 60; background: #05070c; color: #fff; font: bold 22px/1.6 sans-serif; text-align: center; align-items: center; justify-content: center; flex-direction: column; }
      body.tp-ui #tp-rot.portrait { display: flex; }
    `;
    d.head.appendChild(css);
    const root = d.createElement('div'); root.id = 'tp';
    const mk = (cls, parent = root) => { const e = d.createElement('div'); e.className = cls; parent.appendChild(e); return e; };
    this.dpadEl = mk('tp-dpad');
    this.arrowEls = {};
    const pos = { up: ['35%', '2%'], down: ['35%', '68%'], left: ['2%', '35%'], right: ['68%', '35%'] };
    for (const k of Object.keys(pos)) { const a = mk('tp-arrow', this.dpadEl); a.textContent = ARROWS[k]; a.style.left = pos[k][0]; a.style.top = pos[k][1]; this.arrowEls[k] = a; }
    this.knobEl = mk('tp-knob', this.dpadEl);
    for (const [k, b] of Object.entries(PAD_LAYOUT.buttons)) {
      const e = mk('tp-btn'); e.innerHTML = `<b>${b.label}</b><i>${b.sub}</i>`; this.btnEls[k] = e;
    }
    this.startEl = mk('tp-btn tp-rect'); this.startEl.textContent = 'START'; this.startEl.style.borderRadius = '10px';
    this.fsEl = mk('tp-btn tp-rect'); this.fsEl.textContent = '⛶';
    const canFs = !!(d.documentElement && d.documentElement.requestFullscreen) && !(this.win.navigator && /iPhone|iPod/.test(this.win.navigator.userAgent));
    if (!canFs) this.fsEl.style.display = 'none';
    this.canFs = canFs;
    d.body.appendChild(root);
    const rot = d.createElement('div'); rot.id = 'tp-rot'; rot.innerHTML = '<div style="font-size:64px">⟳</div><div>画面を 横 にしてください</div><div style="font-size:15px;opacity:.7">ダイノ・スマッシュは 横向きで あそびます</div>';
    d.body.appendChild(rot);
    this.el = root; this.rotEl = rot;
    this._applyLayout();
  }

  _applyLayout() {
    if (!this.el) return;
    const lay = this.layout(), px = (n) => `${Math.round(n)}px`;
    this.el.style.setProperty('--u', px(lay.u));
    const place = (e, cx, cy, r) => { e.style.left = px(cx - r); e.style.top = px(cy - r); e.style.width = e.style.height = px(r * 2); };
    place(this.dpadEl, lay.dpad.cx, lay.dpad.cy, lay.dpad.r);
    for (const k of Object.keys(lay.buttons)) place(this.btnEls[k], lay.buttons[k].cx, lay.buttons[k].cy, lay.buttons[k].r);
    const rect = (e, r) => { e.style.left = px(r.x); e.style.top = px(r.y); e.style.width = px(r.w); e.style.height = px(r.h); };
    rect(this.startEl, lay.start); rect(this.fsEl, lay.fs);
    const portrait = lay.h > lay.w;
    this.rotEl.classList.toggle('portrait', portrait);
    if (portrait !== this._portrait) { this._portrait = portrait; if (portrait && this.shown) { this._releaseAll(); if (this.onPortrait) this.onPortrait(); } }
  }

  show() {
    if (this.shown) return;
    this.shown = true;
    this.el.classList.add('show');
    this.win.document.body.classList.add('tp-ui');
    this._applyLayout();
  }

  // ---- 指の受け付け ----
  _listen() {
    const w = this.win;
    const accept = (e) => e.pointerType === 'touch' || e.pointerType === 'pen' || (this.force && e.pointerType === 'mouse');
    // 初めて指で触れたら出す
    w.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !this.shown) this.show(); }, true);
    w.addEventListener('touchstart', () => { if (!this.shown) this.show(); }, { capture: true, passive: true });
    w.addEventListener('pointerdown', (e) => {
      if (!this.shown || !accept(e) || this._portrait) return;
      const zone = this._hit(e.clientX, e.clientY);
      if (!zone) return;
      e.preventDefault();
      const rec = { zone, dir: -1 };
      this.ptr.set(e.pointerId, rec);
      try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (_) { /* 捕まえられなくても動く */ }
      this._track(rec, e, true);
      this._sync();
    }, { passive: false });
    w.addEventListener('pointermove', (e) => {
      const rec = this.ptr.get(e.pointerId); if (!rec) return;
      e.preventDefault();
      this._track(rec, e, false); this._sync();
    }, { passive: false });
    const up = (e) => {
      const rec = this.ptr.get(e.pointerId); if (!rec) return;
      this.ptr.delete(e.pointerId);
      if (rec.zone === 'fs' && e.type === 'pointerup') { toggleFullscreen(); try { const o = w.screen && w.screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); } catch (_) { /* 固定できない機器もある */ } }
      this._sync();
    };
    w.addEventListener('pointerup', up, true); w.addEventListener('pointercancel', up, true);
    w.addEventListener('blur', () => this._releaseAll());
    w.document.addEventListener('visibilitychange', () => { if (w.document.hidden) this._releaseAll(); });
    w.addEventListener('resize', () => this._applyLayout());
    w.addEventListener('orientationchange', () => this._applyLayout());
    // 長押しのメニュー・選択・拡大の抑止
    w.addEventListener('contextmenu', (e) => { if (this.shown) e.preventDefault(); });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) w.document.addEventListener(t, (e) => e.preventDefault());
    w.document.addEventListener('dblclick', (e) => { if (this.shown) e.preventDefault(); });
    w.document.addEventListener('touchmove', (e) => { if (this.shown && e.cancelable) e.preventDefault(); }, { passive: false });
  }

  _hit(x, y) {
    const lay = this.layout(), s = PAD_LAYOUT.hitScale;
    const inRect = (r, m = 0) => x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m;
    if (inRect(lay.start, 6)) return 'start';
    if (this.canFs && inRect(lay.fs, 6)) return 'fs';
    for (const [k, b] of Object.entries(lay.buttons)) if (Math.hypot(x - b.cx, y - b.cy) <= b.r * s) return k;
    const dp = lay.dpad;
    if (Math.hypot(x - dp.cx, y - dp.cy) <= dp.r * 1.3) return 'dpad';
    return null;
  }

  _track(rec, e, first) {
    const lay = this.layout();
    if (rec.zone === 'dpad') {
      rec.dir = padDirIndex(e.clientX - lay.dpad.cx, e.clientY - lay.dpad.cy, lay.dpad.r, rec.dir);
      rec.fx = e.clientX - lay.dpad.cx; rec.fy = e.clientY - lay.dpad.cy;
    } else if (rec.zone in lay.buttons) {
      // 指をすべらせて隣のボタンへ移れる（A から B へ）。どのボタンの上でもなければ離した扱い
      let hit = null;
      for (const [k, b] of Object.entries(lay.buttons)) if (Math.hypot(e.clientX - b.cx, e.clientY - b.cy) <= b.r * PAD_LAYOUT.hitScale) { hit = k; break; }
      if (hit !== rec.zone) { if (hit) rec.zone = hit; else rec.off = true; }
      if (hit) rec.off = false;
    }
    if (first && this.win.navigator && this.win.navigator.vibrate && rec.zone !== 'fs') { try { this.win.navigator.vibrate(8); } catch (_) { /* 振動できない機器 */ } }
  }

  _releaseAll() { this.ptr.clear(); this._sync(); }

  /** 押している指の全部から、いま押している動作を決めて Input へ渡す。 */
  _sync() {
    const held = {}, tap = {};
    let dirIdx = -1, fx = 0, fy = 0;
    for (const rec of this.ptr.values()) {
      if (rec.zone === 'dpad') {
        if (rec.dir >= 0) for (const a of DIR8[rec.dir]) held[a] = true;
        if (rec.dir >= 0) { dirIdx = rec.dir; fx = rec.fx; fy = rec.fy; }
      } else if (rec.zone === 'start') held.pause = true;
      else if (rec.zone in PAD_LAYOUT.buttons && !rec.off) held[rec.zone] = true;
    }
    for (const a of Object.keys(held)) if (!this.held[a]) tap[a] = true;      // 新しく押された動作は、1 コマより短くても拾う
    this.held = held; this.dirIdx = dirIdx;
    this.input.setTouch(held, tap);
    // 見た目
    for (const k of Object.keys(this.arrowEls)) this.arrowEls[k].classList.toggle('on', !!held[k]);
    this.dpadEl.classList.toggle('on', dirIdx >= 0);
    const lay = this.layout(), r = lay.dpad.r, m = Math.hypot(fx, fy) || 1, c = Math.min(m, r * 0.55) / m;
    this.knobEl.style.transform = dirIdx >= 0 ? `translate(${Math.round(fx * c)}px, ${Math.round(fy * c)}px)` : '';
    for (const k of Object.keys(this.btnEls)) this.btnEls[k].classList.toggle('on', !!held[k]);
    this.startEl.classList.toggle('on', !!held.pause);
    this.fsEl.classList.toggle('on', [...this.ptr.values()].some((p) => p.zone === 'fs'));
  }

  /** 検査用：いまの配置と押している動作。 */
  info() { return { shown: this.shown, held: { ...this.held }, layout: this.layout(), portrait: !!this._portrait, pointers: this.ptr.size }; }
}
