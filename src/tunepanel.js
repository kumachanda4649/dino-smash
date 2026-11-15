// 版2.6：調整スライダーのパネル（デバッグモード）。表は src/tune.js の TUNE_TABLE（1行足せばスライダーが増える）。
//   開閉：URL ?debug=1（最初から開く）／F2／パッドの Back+Y。Esc でも閉じる。
//   中身：今の値を 100% とした割合（10〜300%）。「100%に戻す」・値は localStorage に保存・「開いている間はゲームを止める」の切り替え・現在値のコピー。
//   マウス：スライダーをドラッグ（行の左の名前をダブルクリックでその行だけ100%）。キーボード：パネルの ＋/− ボタン。
//   パッド（ゲームを止めているとき）：十字キー↑↓で行・←→で ∓10%・A でその行を100%・B／Back+Y で閉じる。止めていないときは、パッドはゲームの操作のまま。
// DOM を使うのでブラウザ専用。Node の試験は World 側（tune.js）だけを使う。
import { TUNE_TABLE, TUNE_MIN, TUNE_MAX, TUNE, tuneBounds, tunePct, setTune, resetTune, saveTune, tuneChanged, tuneAll } from './tune.js';

const PAUSE_KEY = 'dinoArtsTunePause';
const CSS = `
#tunepanel{position:fixed;top:0;right:0;bottom:0;width:360px;max-width:92vw;z-index:20;box-sizing:border-box;padding:10px 12px 14px;overflow:auto;
  background:rgba(8,12,24,.93);color:#dfe8ff;font:13px/1.45 "Yu Gothic UI","Meiryo",sans-serif;border-left:2px solid #4a6aa8;display:none;user-select:none}
#tunepanel.on{display:block}
#tunepanel h1{margin:0 0 4px;font-size:15px;color:#ffe14a}
#tunepanel .sub{color:#9fb4e0;margin-bottom:8px;font-size:12px}
#tunepanel .bar{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 8px}
#tunepanel button{font:inherit;color:#dfe8ff;background:#22345a;border:1px solid #4a6aa8;border-radius:4px;padding:3px 9px;cursor:pointer}
#tunepanel button:hover{background:#2f4a80}
#tunepanel label.chk{display:flex;align-items:center;gap:6px;cursor:pointer}
#tunepanel h2{margin:12px 0 4px;font-size:13px;color:#7df0ff;border-bottom:1px solid #2c3d66}
#tunepanel .row{display:grid;grid-template-columns:1fr auto;gap:0 6px;padding:3px 4px;border-radius:4px;margin:1px 0}
#tunepanel .row.sel{background:#1c2c52;outline:1px solid #7df0ff}
#tunepanel .row .nm{grid-column:1;cursor:pointer}
#tunepanel .row .nm small{display:block;color:#8196c4;font-size:11px;line-height:1.25}
#tunepanel .row .val{grid-column:2;text-align:right;min-width:3.6em;font-variant-numeric:tabular-nums;color:#9bf5a8}
#tunepanel .row.chg .val{color:#ffd24a;font-weight:bold}
#tunepanel .row .ctl{grid-column:1 / 3;display:flex;align-items:center;gap:4px}
#tunepanel .row input[type=range]{flex:1;min-width:0}
#tunepanel .row .st{padding:0 7px}
#tunepanel .msg{min-height:1.3em;color:#9bf5a8;font-size:12px}
#tunepanel textarea{width:100%;height:5em;margin-top:6px;box-sizing:border-box;font:11px/1.3 monospace;display:none}
`;

export class TunePanel {
  /** onChange(id, pct)＝値が動いたとき（遊びの記録へ）／onToggle(open)＝開閉したとき。 */
  constructor({ doc = document, storage = null, onChange = null, onToggle = null } = {}) {
    this.doc = doc; this.storage = storage; this.onChange = onChange; this.onToggle = onToggle;
    this.open = false;
    this.pauseGame = true;
    try { const v = storage && storage.getItem(PAUSE_KEY); if (v === '0') this.pauseGame = false; } catch (e) { /* 既定のまま */ }
    this.sel = 0;
    this.rows = [];          // { id, el, range, out }
    this.root = null;
    this.padBack = false; this.padPrev = {};
  }

  build() {
    if (this.root) return;
    const d = this.doc;
    const st = d.createElement('style'); st.textContent = CSS; d.head.appendChild(st);
    const root = d.createElement('div'); root.id = 'tunepanel';
    const mk = (tag, cls, txt) => { const e = d.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
    root.appendChild(mk('h1', '', '調整スライダー（デバッグ）'));
    root.appendChild(mk('div', 'sub', '今の値を 100% とした割合（10〜300%）。F2 か Esc で閉じる。値は保存されます。ゲームを止めているあいだは、矢印キー／十字キーで操作できます（↑↓＝行・←→＝±10%・Enter／Z／A＝その行を100%）。'));
    const bar = mk('div', 'bar');
    const bReset = mk('button', '', '100%に戻す'); bReset.onclick = () => { if (resetTune()) { this.afterBulk('全部 100% に戻しました'); } else this.say('すでに全部 100% です'); };
    const bCopy = mk('button', '', '現在値をコピー'); bCopy.onclick = () => this.copy();
    bar.append(bReset, bCopy);
    root.appendChild(bar);
    const lbl = mk('label', 'chk'); const chk = d.createElement('input'); chk.type = 'checkbox'; chk.checked = this.pauseGame;
    chk.onchange = () => { this.pauseGame = chk.checked; try { if (this.storage) this.storage.setItem(PAUSE_KEY, this.pauseGame ? '1' : '0'); } catch (e) { /* 保存できなくてよい */ } this.say(this.pauseGame ? '開いている間はゲームを止めます' : '開いたままゲームが動きます'); };
    this.chk = chk;
    lbl.append(chk, d.createTextNode('開いている間はゲームを止める'));
    root.appendChild(lbl);
    this.msg = mk('div', 'msg'); root.appendChild(this.msg);
    let group = null;
    TUNE_TABLE.forEach((r, i) => {
      if (r.group !== group) { group = r.group; root.appendChild(mk('h2', '', group)); }
      const row = mk('div', 'row');
      const nm = mk('div', 'nm', r.label); if (r.note) nm.appendChild(mk('small', '', r.note));
      nm.title = 'ダブルクリックでこの行だけ 100%'; nm.ondblclick = () => this.setRow(i, 100);
      nm.onclick = () => this.select(i);
      const out = mk('div', 'val', '100%');
      const ctl = mk('div', 'ctl');
      const [lo, hi] = tuneBounds(r.id);
      const range = d.createElement('input'); range.type = 'range'; range.min = lo; range.max = hi; range.step = 5; range.value = 100; range.tabIndex = -1;
      range.oninput = () => { this.setRow(i, Number(range.value), false); };
      range.onchange = () => { try { range.blur(); } catch (e) { /* なくてよい */ } };      // スライダーが矢印キーを奪ったままにならないように
      const mn = mk('button', 'st', '−'); mn.tabIndex = -1; mn.onclick = () => this.setRow(i, tunePct(r.id) - 10);
      const pl = mk('button', 'st', '＋'); pl.tabIndex = -1; pl.onclick = () => this.setRow(i, tunePct(r.id) + 10);
      ctl.append(mn, range, pl);
      row.append(nm, out, ctl);
      root.appendChild(row);
      this.rows.push({ id: r.id, el: row, range, out });
    });
    this.ta = mk('textarea'); this.ta.readOnly = true; root.appendChild(this.ta);
    d.body.appendChild(root);
    this.root = root;
    this.refresh();
  }

  say(t) { if (this.msg) this.msg.textContent = t; }

  select(i) { this.sel = (i + this.rows.length) % this.rows.length; this.rows.forEach((r, k) => r.el.classList.toggle('sel', k === this.sel)); }

  /** 表示を値に合わせる。 */
  refresh() {
    this.rows.forEach((r, k) => {
      const v = tunePct(r.id);
      r.range.value = v; r.out.textContent = v + '%';
      r.el.classList.toggle('chg', v !== 100);
      r.el.classList.toggle('sel', k === this.sel);
    });
  }

  /** i 行目を pct% にする（保存・記録つき）。 */
  setRow(i, pct, redraw = true) {
    const r = this.rows[i]; if (!r) return;
    const moved = setTune(r.id, pct);
    if (redraw || !moved) this.refresh(); else { const v = tunePct(r.id); r.out.textContent = v + '%'; r.el.classList.toggle('chg', v !== 100); }
    if (moved) { saveTune(this.storage); if (this.onChange) this.onChange(r.id, tunePct(r.id)); }
  }

  afterBulk(text) { saveTune(this.storage); this.refresh(); this.say(text); if (this.onChange) this.onChange('*', 100); }

  /** 現在値のコピー用の文字列（後で既定値へ焼き込むときに読む）。 */
  text() {
    const all = tuneAll(), ch = tuneChanged();
    const lines = ['// ダイノ・スマッシュ 調整スライダーの現在値（%・100 が既定）', '// 100 でないもの: ' + (Object.keys(ch).length ? JSON.stringify(ch) : 'なし')];
    for (const r of TUNE_TABLE) lines.push(`${r.id}: ${all[r.id]}   // ${r.label}`);
    return lines.join('\n');
  }
  copy() {
    const t = this.text();
    const fallback = () => { this.ta.style.display = 'block'; this.ta.value = t; this.ta.select(); let ok = false; try { ok = this.doc.execCommand('copy'); } catch (e) { /* 下の文面 */ } this.say(ok ? 'コピーしました' : '下の枠を選んでコピーしてください'); };
    try {
      const nav = this.doc.defaultView && this.doc.defaultView.navigator;
      if (nav && nav.clipboard && nav.clipboard.writeText) nav.clipboard.writeText(t).then(() => this.say('コピーしました'), fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  toggle(force) {
    this.build();
    const want = force === undefined ? !this.open : !!force;
    if (want === this.open) return;
    this.open = want;
    this.root.classList.toggle('on', want);
    if (want) { this.refresh(); this.say(''); }
    if (this.onToggle) this.onToggle(want);
  }

  /** ゲームを止めるか（開いていて、止める設定のとき）。 */
  get paused() { return this.open && this.pauseGame; }

  /** 毎フレーム：パッドの Back+Y で開閉。止めているあいだは十字キー・A・B で操作。edge＝ゲームの入力の押した瞬間。 */
  update(edge, navigatorLike = (typeof navigator !== 'undefined' ? navigator : null)) {
    let pads = [];
    try { pads = navigatorLike && navigatorLike.getGamepads ? Array.from(navigatorLike.getGamepads() || []).filter((p) => p && p.connected !== false) : []; } catch (e) { pads = []; }
    const b = (i) => pads.some((p) => p.buttons && p.buttons[i] && p.buttons[i].pressed);
    const combo = b(8) && b(3);
    if (combo && !this.padPrev.combo) this.toggle();
    this.padPrev = { combo };
    if (!this.open) return false;
    if (edge.pause) { edge.pause = false; this.toggle(false); return true; }      // Esc は先にパネルを閉じる（同時にポーズへ入らない）
    if (!this.pauseGame) return false;
    if (edge.up) this.select(this.sel - 1);
    else if (edge.down) this.select(this.sel + 1);
    else if (edge.left) this.setRow(this.sel, tunePct(this.rows[this.sel].id) - 10);
    else if (edge.right) this.setRow(this.sel, tunePct(this.rows[this.sel].id) + 10);
    else if (edge.attack || edge.confirm) this.setRow(this.sel, 100);
    else if (edge.jump) this.toggle(false);
    return true;
  }
}
export { TUNE_MIN, TUNE_MAX, TUNE };
