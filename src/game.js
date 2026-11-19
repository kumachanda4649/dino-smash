// 場面の管理（タイトル → 面 → 面送りのスクロール → エンディング）、固定刻みのループ、描画の呼び出し。
// window.__game は「読むだけ」の状態（遊びを代わりに進める仕組みは作らない）。
import { World, W, H, CAM, seaEntry } from './world.js';
import { STAGES, AREAS, stageIndexOf } from '../stages.js';
import { loadLayoutStages } from './layout.js';
import { loadPackageStages } from './stagepkg.js';
import { DINOS, isBossLike } from './dinos.js';
import { pxScaleOf, drawWorld, drawBackground, drawPlatforms, drawEntity, drawFx } from './render.js';
import { drawSeaStatic, drawLandCliffsStatic } from './sea_render.js';
import { drawLavaStatic } from './lava_render.js';
import { drawHud, drawBanners, drawToast, TOAST_Y, drawLoading, drawTitle, drawPause, drawGameOver, drawEnding, drawPadBadge, drawOptions, STAGE_HINT, drawControls, TITLE_ART, TITLE_SETS, ENDING_ROLL, endingRollSec } from './ui.js';

/** 2026-11-15：知らせ（toast）の描き方。on=false で直す前（戦闘中は 2 回重ねて描き、残り時間の上に出す＝検査の陰性対照） */
export const TOAST_FIX = { on: true };
/** 2026-11-15：面送りの重ね順。on=false で直す前（海の水の膜・断崖より主人公が前・陸の面の断崖は描かない＝検査の陰性対照） */
export const TRANS_FIX = { on: true };
/** 2026-11-15：タイトルへ戻るときにポーズ・オプションの印を戻す／面の頭で押しっぱなしのボタンを新しい押下にしない。on=false で直す前（検査の陰性対照） */
export const TITLE_FIX = { on: true };
import { easeInOut, clamp } from './util.js';
import { DIFFICULTY_ORDER, DEFAULT_DIFFICULTY } from './difficulty.js';
import { setNumScale } from './bignum.js';
import { OPTION_ROWS, PAUSE_OPTION_ROWS, loadOptions, saveOptions, stepOption } from './options.js';
import { buildMoveList } from './movelist.js';
import { CMD_STYLE } from './moves.js';
import { PlayLog, makeTransport } from './playlog.js';
import { VERSION } from './util.js';
import { TUNE, TUNE_TABLE, loadTune, tuneChanged } from './tune.js';
import { TunePanel } from './tunepanel.js';

const STEP = 1 / 60;
const TITLE_ITEMS = 3;      // タイトルの項目の数（スタート・オプション・操作説明）

export class Game {
  constructor({ canvas, assets, audio, input, params }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.audio = audio;
    this.input = input;
    this.params = params;
    let saved = null; try { saved = localStorage.getItem('dinoArtsDifficulty'); } catch (e) { /* なくてよい */ }
    const want = params.get('diff') || saved;
    this.difficulty = DIFFICULTY_ORDER.includes(want) ? want : DEFAULT_DIFFICULTY;       // 版1.3：難しさ（URL の ?diff=easy|normal|hard が先、次に前回の選択）
    this.debug = params.get('debug') === '2';      // 版2.6：?debug=1 は調整スライダーのパネルを開く。昔の『判定・状態の文字を重ねる表示』は ?debug=2（H キーで出す当たり判定の枠とは別）
    this.debugPanel = params.get('debug') === '1' || params.get('debug') === '2';
    this.stages = STAGES;
    this.opts = loadOptions(STAGES);                         // オプションの開始面を面固有の鍵で復元する
    // URL でも指定できる（保存はしない）。2026-11-14：前は this.opts を書き換えるだけで、オプションを何か 1 つ変えると CP FREE ごと保存され、次から URL なしでも ON になった。
    // 保存されていた値を覚えておき、保存するときはそちらを書く（オプションで CP FREE そのものを切り替えたら、その選んだ値を保存する）
    this.urlMpFree = false;
    if (params.get('mpfree') === '1' || params.get('cpfree') === '1') { this.savedMpFree = this.opts.mpFree; this.opts.mpFree = true; this.urlMpFree = true; }
    // 2026-11-19：操作方法 A/B（オプションの COMMAND・保存する）。URL の ?cmd=tekken|sf はその回だけ（保存しない＝CP FREE と同じ扱い）
    this.urlCmd = false;
    { const uc = params.get('cmd'); if (uc === 'tekken' || uc === 'sf') { this.savedCmd = this.opts.cmd; this.opts.cmd = uc; this.urlCmd = true; } }
    CMD_STYLE.style = this.opts.cmd;
    setNumScale(this.opts.numScale);                           // 版3.5：数字の大きさ（表示だけ）
    this.hitbox = params.get('hitbox') === '1' || this.opts.collision;     // 当たり判定（絵の形）を色付きの枠で表示。H キーでも切り替え。オプションの COLLISION でも
    this.run = { mpFree: false, stageSel: false };           // 版2.0：この回に使った補助（HUD に印を出す）
    this.titleSel = 0;                                       // タイトルの項目（0=スタート 1=オプション 2=操作説明）
    this.optSel = 0;                                         // オプションの行
    this.rep = null;                                         // ←→ の押しっぱなし（連打）
    this.pauseView = 'menu';                                 // 版2.1：ポーズメニュー（menu / moves=技表 / confirm=タイトルへの確認）
    this.pauseSel = 0; this.pauseYes = false;
    this.optFromPause = false;                               // オプションをポーズメニューから開いているか
    this.moveList = buildMoveList();                         // 技表は技の表から自動で作る
    this.moveCat = 0; this.moveCur = 0;
    let store = null; try { store = localStorage; } catch (e) { /* 使えなくてよい */ }
    this.plog = new PlayLog({ clock: () => performance.now() / 1000, send: makeTransport(''), storage: store });      // 版2.3：遊んだ記録（src/playlog.js）
    this.fstat = { frames: 0, sum: 0, max: 0, slow: 0 };      // 記録の「重くなっていないか」を見るためのフレーム時間
    const tq = params.get('title');      // 2026-11-15：タイトルの見た目の切り替え（?title=old＝前のタイトル／a・b＝新しいタイトルの絵の組）。比べ用
    if (tq === 'old') TITLE_ART.style = 'old'; else if (tq && TITLE_SETS[tq]) { TITLE_ART.style = 'new'; TITLE_ART.set = tq; }
    this.audio.setLevels(this.opts.bgm, this.opts.se);
    // 版2.6：調整スライダー（デバッグモード）。保存してある割合を読み、F2／?debug=1／パッドの Back+Y でパネルを開く。値の元の表は src/tune.js
    loadTune(store);
    this.tune = new TunePanel({ storage: store, onChange: (id, pct) => { if (this.plog.active) this.plog.ev('tune', id === '*' ? { all: tuneChanged() } : { id, pct, all: tuneChanged() }); } });
    this.world = null;
    this.state = 'loading';
    this.loadingLabel = 'NOW LOADING…';
    this.time = 0;
    this.endT = 0;
    this.endPhase = 'result';      // 'roll'（スタッフロール）→'result'（ALL CLEAR の画面）。直接 state='ending' にする検査は従来どおり result
    this.banners = [];
    this.toast = null;
    this.hud = { hpLag: 100, bossLag: 0, scoreShown: 0, comboPop: 0, lastCombo: 0, result: null };
    this.titleBgStage = Math.max(1, this.stages.findIndex((s, i) => i >= 1 && !(s.bg && s.bg.proc)));       // タイトルの背景は2面（密林）。版3.0：描画で作る背景（海）の面は使わない（海を入れる場所を替えても崩れない）
    this.k = 1;
    this.acc = 0;
    this.last = 0;
    this.trans = null;
    this.prevState = 'play';
    this._expose();
  }

  // ---- 読むだけの状態 ----
  _expose() {
    const g = this;
    if (this.params.get('still') === '1') window.__still = this;      // 判定の枠の静止画づくり専用（tools/audit/stills.mjs）。?still=1 のときだけ。遊びの試験（play.mjs）は使わない
    window.__game = {
      get state() { return g.state; },
      get stage() { return g.world && g.world.player ? g.world.stageIndex + 1 : 0; },
      get stageLabel() { return g.world && g.world.player && g.world.stage ? g.world.stage.label : ''; },
      get phase() { return g.world ? g.world.phase : 'none'; },
      get score() { return g.world ? g.world.score : 0; },
      get combo() { return g.world ? g.world.combo : 0; },
      get player() { return g.world && g.world.player ? g.world.snapshot().player : null; },
      get enemyCount() { return g.world && g.world.player ? g.world.aliveCount() : 0; },
      get enemies() { return g.world && g.world.player ? g.world.snapshot().enemies : []; },
      get snapshot() { return g.world && g.world.player ? g.world.snapshot() : null; },
      get muted() { return g.audio.muted; },
      get options() { return { ...g.opts }; },
      get run() { return { ...g.run }; },
      get difficulty() { return g.difficulty; },
      get hitbox() { return g.hitbox; },
      get titleSel() { return g.titleSel; },
      get optSel() { return g.optSel; },
      get pause() { return { view: g.pauseView, sel: g.pauseSel, yes: g.pauseYes, cat: g.moveCat, cur: g.moveCur, fromPause: g.optFromPause }; },
      get moveListInfo() { const m = g.moveList; return { count: m.count, total: m.total, cats: m.cats.map((c) => ({ id: c.id, n: c.entries.length })) }; },
      get audioStats() { const a = g.audio; return { seCount: a.seCount, bgmStarts: a.bgmStarts, seGain: a.seGain, bgmGain: a.bgmGain, bgmVolume: a.bgmVolume, bgmPlaying: a.bgmPlaying, bgmName: a.bgmName, bgmWebAudio: !!a.bgmSrc, limiter: a.out ? a.out.strength : null }; },
      get playlog() { const l = g.plog; return { active: l.active, sid: l.sid, count: l.count, sentLines: l.sentLines, sentBatches: l.sentBatches, off: l.off, dropped: l.dropped, cpuMs: l.cpuMs, buffered: l.buf.length, inflight: l.inflight, failN: l.failN, frames: g.fstat.frames, frameSumMs: g.fstat.sum, frameMaxMs: g.fstat.max }; },
      get stageInfo() { const s = g.world && g.world.stage; return s ? { label: s.label, name: s.name, pkgId: s.pkgId || (s.pkg && s.pkg.id) || null, user: !!s.user, vars: s.vars ? { ...s.vars } : {}, waves: s.waves.length, enemies: s.waves.reduce((a, w) => a + w.enemies.length, 0), lava: !!s.lava, water: !!s.water, platforms: s.platforms.length, start: s.start || null, timeMax: g.world.timeMax, lavaDmg: g.world.lava ? g.world.lava.dmg : 0 } : null; },      // 版3.3：面の概要（読むだけ）
      get stageLabels() { return g.stages.map((s) => s.label); },
      get pkgInfo() { return g.pkgInfo || { applied: [], errors: [] }; },
      get tune() { return { ...TUNE.pct }; },          // 版2.6：調整スライダーの、100% でない項目だけ（読むだけ）
      get tuneIds() { return TUNE_TABLE.map((r) => r.id); },
      get tuneOpen() { return g.tune.open; },
      get px() { const a = g.assets; return !!(a.usePx && a.pxOf('Spinosaurus')); },          // ドット絵で描いているか
      get pxCount() { const a = g.assets; return a.usePx ? Object.keys(a.pxImg).length : 0; },
    };
  }

  // ---- 起動 ----
  async boot() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play') this.setState('pause'); if (document.hidden) this.plog.flush(); });
    window.addEventListener('pagehide', () => { this.logEnd('close'); });
    const pk = await loadPackageStages(STAGES, this.params, { areas: AREAS });      // 版3.3：ステージパッケージ（data/stage_packages/・?package=）があれば、その面を置き換え／ユーザー作の面を足す。無い・壊れているときは従来どおり
    this.pkgInfo = { applied: pk.applied, errors: pk.errors };
    this.stages = await loadLayoutStages(pk.stages, this.params);
    if (this.stages.length !== STAGES.length) this.opts.stage = loadOptions(this.stages).stage;      // ユーザー作の面を追加してから、その面の鍵も解決する
    this.world = new World({ motions: null, stages: this.stages });
    this.world.useCurve = true;      // 版2.0：ワールドごとの強さの曲線を掛ける
    requestAnimationFrame((t) => this.frame(t));       // 読み込み中の表示を回す
    await this.assets.init();
    this.resize();                       // ドット絵の有無が分かったので解像度を決め直す
    this.world.motions = this.assets.motions;
    // 絵の形の判定は、描いている絵（ドット絵が使えるなら、そちらのマスクと整数倍）に合わせる
    this.world.artHook = (type) => { const a = this.assets, px = a.usePx && a.pxOf(type); return px ? { dm: px.meta, key: type + '#px', scaleOf: () => pxScaleOf(a, type) } : null; };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) this.hitbox = !this.hitbox;      // 2026-11-15：Ctrl+H（ブラウザの履歴）では切り替えない（F キーの全画面と同じ）
      if (e.code === 'F2' && !e.repeat) { e.preventDefault(); this.tune.toggle(); }      // 版2.6：調整スライダーの開閉
    });
    if (this.debugPanel) this.tune.toggle(true);
    this.audio.init();
    const wantIdx = stageIndexOf(this.params.get('stage'), this.stages);      // 版2.0：?stage=2-4（ワールド表記）か ?stage=8（通し番号）
    if (wantIdx >= 0) {
      await this.startGame(wantIdx, { stageSel: false });
    } else {
      this.loadingLabel = 'NOW LOADING…';
      await Promise.all([TITLE_ART.style === 'old' ? null : this.assets.ensureTitleArt(TITLE_ART.set), this.assets.ensureDino('Spinosaurus'), this.assets.ensureBg(this.stages[this.titleBgStage].bg), this.assets.ensureBg(this.stages[0].bg), this.assets.ensureArt(this.stages[this.titleBgStage].bg), this.assets.ensureArt(this.stages[0].bg)]);
      this.state = 'title';
      this.audio.bgm('title');
    }
  }

  resize() {
    const k = Math.min(window.innerWidth / W, window.innerHeight / H);
    const cssW = Math.floor(W * k), cssH = Math.floor(H * k);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let bw = Math.min(2560, Math.max(640, Math.round(cssW * dpr)));
    // ドット絵を使うときは、描画の解像度を元の大きさ(1280)の整数倍にして、ぼかさずに引き伸ばす（画面側の拡大も補間なし）
    const pxOn = this.assets.usePx && Object.keys(this.assets.motionsPx).length > 0;
    if (pxOn && cssW * dpr >= W) bw = W * Math.min(2, Math.max(1, Math.round((cssW * dpr) / W)));
    this.canvas.style.imageRendering = pxOn ? 'pixelated' : '';
    this.canvas.width = bw;
    this.canvas.height = Math.round((bw * H) / W);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.k = this.canvas.width / W;
  }

  setState(s) {
    if (s === 'pause') { if (this.plog.active) this.plog.ev('pause', { st: this.state, auto: document.hidden ? 1 : 0 }); this.prevState = this.state; this.pauseView = 'menu'; this.pauseSel = 0; this.pauseYes = false; this.rep = null; this.optFromPause = false; }
    this.state = s;
  }

  /** 版2.0：タイトルの「スタート」。オプションの STAGE SELECT で選んだ面からはじまる。 */
  startFromTitle() { return this.startGame(this.opts.stage, { stageSel: this.opts.stage > 0 }); }

  /** 2026-11-14：面の素材を読む。一時的な失敗（通信・読み込みの取りこぼし）は少し待って 2 回までやり直す。それでも読めなければ投げる。 */
  async loadStage(stage, tries = 3) {
    let err = null;
    for (let i = 0; i < tries; i++) {
      try { return await this.assets.ensureStage(stage); } catch (e) { err = e; console.warn(`面の素材が読めない（${i + 1}/${tries}）: ${e && e.message}`); }
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    throw err;
  }
  /** 読めなかったときはタイトルへ戻して知らせる（前は NOW LOADING のまま操作を受け付けず、ページの読み直しが要った）。 */
  loadFailed() {
    this.trans = null;
    this.toTitle('loadfail');
    this.showToast('読み込みに失敗しました。もう一度スタートしてください', 4);
  }

  async startGame(stageIndex = 0, { stageSel = false } = {}) {
    this.run = { mpFree: this.opts.mpFree, stageSel };
    this.hud.result = null;
    this.trans = null;
    this.state = 'loading';
    this.loadingLabel = 'NOW LOADING…';
    try { await this.loadStage(this.stages[stageIndex]); } catch (e) { this.loadFailed(); return; }
    this.world.setDifficulty(this.difficulty);
    this.world.resetRun();
    this.world.mpFree = this.run.mpFree;      // 版2.0：CP FREE
    this.banners = [];
    this.logBegin(stageIndex);
    this.world.startStage(stageIndex);
    if (TITLE_FIX.on && this.world.reader) this.world.reader.resume(this.input.heldNow);      // 2026-11-15：タイトルで決めたボタン（パッドの A＝決定と攻撃）を押したままでも、面の頭で噛みつかない
    const pr = this.params.get('practice');         // 練習場：?practice=Triceratops,Allosaurus&gauge=100&hp=600（技の練習・動画撮影用）
    if (pr) {
      const types = pr.split(',').filter((t) => Object.prototype.hasOwnProperty.call(DINOS, t));      // 2026-11-15：'constructor' などの名前を通さない（前は読み込みで落ちて NOW LOADING のまま）
      await Promise.all(types.map((t) => this.assets.ensureDino(t)));
      this.world.startPractice(types, Number(this.params.get('gauge')) || 0, Number(this.params.get('hp')) || 0, Number(this.params.get('hpr')) || 1);   // hpr＝敵の体力の割合（0〜1。体力が減ってから出す技の撮影用）
    }
    const sw = Number(this.params.get('skipwaves')) || 0;      // 開発用：?skipwaves=N＝最初の N 個の波を飛ばして始める（高台の波の撮影用。遊びの経路には使わない）
    if (sw > 0) this.world.director.next = Math.max(0, Math.min(Math.floor(sw), this.world.stage.waves.length - 1));      // 2026-11-15：整数にする（前は 1.5 などで波が読めず毎コマ例外）
    this.hud.hpLag = this.world.player.hp;
    this.hud.scoreShown = 0;
    this.state = 'play';
    this.afterStageStart();
  }

  afterStageStart() {
    // 次の面の素材を先に読んでおく。使わない恐竜は手放す。
    const idx = this.world.stageIndex;
    const cur = this.assets.needFor(this.stages[idx]);
    if (this.world.practice) for (const t of this.world.practice.types) cur.add(t);     // 練習場の敵は手放さない
    const nxt = this.stages[idx + 1];
    if (!nxt) { this.assets.release(cur); return; }
    const keep = new Set([...cur, ...this.assets.needFor(nxt)]);
    this.assets.release(keep);
    this.assets.ensureStage(nxt).catch(() => {});
  }

  toTitle(why = 'title') {
    this.logEnd(why);
    this.state = 'title';
    this.trans = null;      // 2026-11-14：面送りの途中でタイトルへ戻っても、古い面送りを残さない
    this.banners = [];
    // 2026-11-15：ポーズ・オプションの印も戻す。前は面送りの読み込みがポーズから開いたオプションの最中に失敗すると「ポーズから開いた」印（optFromPause）と
    //   prevState='transition' が残り、タイトルのオプションがポーズ用の短い行になり、Esc でタイトルなのにポーズへ→もう一度 Esc で面送り（trans 無し）へ戻って毎コマ例外で止まった
    if (TITLE_FIX.on) { this.optFromPause = false; this.prevState = 'play'; this.pauseView = 'menu'; this.rep = null; }
    this.audio.bgm('title');
    this.assets.ensureBg(this.stages[this.titleBgStage].bg); this.assets.ensureArt(this.stages[this.titleBgStage].bg);
    this.assets.ensureDino('Spinosaurus');
    if (this.assets.ensureEndingArt) this.assets.ensureEndingArt();      // 2026-11-15：スタッフロールの絵を先に読んでおく（読めなくても進む）
  }

  /** 版1.3：難しさを1段動かす（タイトルで ←→）。選んだ値は次回のために覚えておく（覚えられなくても遊べる）。 */
  stepDifficulty(dir) {
    const i = clamp(DIFFICULTY_ORDER.indexOf(this.difficulty) + dir, 0, DIFFICULTY_ORDER.length - 1);
    if (DIFFICULTY_ORDER[i] === this.difficulty) return;
    this.difficulty = DIFFICULTY_ORDER[i];
    this.audio.se('cursor');
    try { localStorage.setItem('dinoArtsDifficulty', this.difficulty); } catch (e) { /* 覚えられなくてよい */ }
  }

  // ---- 版2.0：オプション画面 ----
  openOptions() { this.state = 'options'; this.optSel = 0; this.rep = null; }

  // ---- 2026-11-15：操作説明の画面（タイトルの「操作説明」から開く。前はタイトルの下の帯に長い説明を出していた） ----
  openControls() { this.state = 'controls'; this.rep = null; }
  closeControls() { this.audio.se('cancel'); this.state = 'title'; }
  updateControls(edge) {
    // B（ジャンプ）・Esc・Back+B（タイトルへ）で閉じる。A・Enter・Start（決定）でも閉じる。閉じるだけで、同じ押下でスタートは決まらない（次のコマからタイトル）
    if (edge.title || edge.jump || edge.pause || edge.confirm) this.closeControls();
  }

  closeOptions() {
    this.rep = null; this.audio.se('cancel');
    if (this.optFromPause) { this.optFromPause = false; this.state = 'pause'; this.pauseView = 'menu'; return; }      // ポーズメニューから来たなら、メニューへ
    this.state = 'title';
  }

  /** いま画面に並べるオプションの行（ポーズメニューの中では戦闘中に意味のある行だけ）。 */
  optRows() { return this.optFromPause ? PAUSE_OPTION_ROWS : OPTION_ROWS; }

  /** 行の値を dir だけ動かす（保存・反映つき）。 */
  changeOption(row, dir) {
    if (row.id === 'level') { this.stepDifficulty(dir); return; }
    const before = this.opts;
    this.opts = stepOption(before, row.id, dir, this.stages.length);
    if (JSON.stringify(before) === JSON.stringify(this.opts)) return;
    if (row.id === 'mpFree') this.urlMpFree = false;      // 自分で選んだ CP FREE は保存する
    if (row.id === 'cmd') this.urlCmd = false;      // 2026-11-19：自分で選んだ操作方法は保存する
    saveOptions({ ...this.opts, ...(this.urlMpFree ? { mpFree: this.savedMpFree } : null), ...(this.urlCmd ? { cmd: this.savedCmd } : null) }, undefined, this.stages);
    if (row.id === 'cmd') { CMD_STYLE.style = this.opts.cmd; if (this.world) this.world.setPlayerMoves(this.world.playerDefs); }      // 戦闘中（ポーズから）に変えても、その場で効く
    if (this.plog.active) this.plog.ev('opt', { id: row.id, v: this.opts[row.id] });
    if (row.id === 'bgm' || row.id === 'se') this.audio.setLevels(this.opts.bgm, this.opts.se);
    if (row.id === 'collision') this.hitbox = this.opts.collision;
    if (row.id === 'numScale') setNumScale(this.opts.numScale);
    if (row.id === 'mpFree' && this.optFromPause && this.world) {      // 戦闘中に切り替えたら、その場で効かせる。使った回は印が付く（途中で切っても印は残る）
      this.world.mpFree = this.opts.mpFree;
      if (this.opts.mpFree) this.run = { ...this.run, mpFree: true };
    }
    this.audio.se('cursor');
  }

  updateOptions(dt, edge) {
    const rows = this.optRows(), row = rows[this.optSel];
    if (edge.up) { this.optSel = (this.optSel + rows.length - 1) % rows.length; this.audio.se('cursor'); this.rep = null; return; }
    if (edge.down) { this.optSel = (this.optSel + 1) % rows.length; this.audio.se('cursor'); this.rep = null; return; }
    // 戻る：Esc・T・パッドのジャンプ（B／X キー）。パッドの Start は「決定」と「ポーズ」が同時に立つので、決定のほうとして扱う
    if (edge.title || edge.jump || (edge.pause && !edge.confirm)) { this.closeOptions(); return; }
    const dir = edge.left ? -1 : edge.right ? 1 : 0;
    if (dir) {
      this.changeOption(row, dir);
      this.rep = (row.kind === 'level' || row.kind === 'stage' || row.kind === 'choice') ? { dir, t: 0.4 } : null;
      return;
    }
    if (this.rep) {      // 押しっぱなしで連打（面の選択を速く動かす）
      const held = this.input.heldNow;
      if ((this.rep.dir < 0 && held.left && !held.right) || (this.rep.dir > 0 && held.right && !held.left)) {
        this.rep.t -= dt;
        if (this.rep.t <= 0) { this.rep.t = 0.07; this.changeOption(row, this.rep.dir); }
      } else this.rep = null;
    }
    if (edge.confirm) {
      if (row.kind === 'action') this.closeOptions();
      else if (row.kind === 'bool') this.changeOption(row, 1);
      else this.audio.se('decide');
    }
  }

  // ---- 版2.1：ポーズメニュー（Esc／Start で開閉。つづける・技表・オプション・タイトルへもどる） ----
  resumeFromPause() { if (this.plog.active) this.plog.ev('resume', {}); this.backToPlay(); this.audio.se('cancel'); this.rep = null; }
  /** 2026-11-14：ポーズから遊び（面送り中なら面送り）へ戻す。戻すのに使ったボタン（A＝決定と攻撃・B／X＝取り消しとジャンプ）を、新しい押下として技に渡さない。 */
  backToPlay() {
    this.state = this.prevState === 'transition' && (this.trans || !TITLE_FIX.on) ? 'transition' : 'play';      // 2026-11-15：面送りが無いのに面送りへは戻さない（updateTransition が trans を読んで落ちる）
    if (this.world && this.world.reader) this.world.reader.resume(this.input.heldNow);
  }

  updatePause(dt, edge) {
    const items = 4;
    if (this.pauseView === 'confirm') {
      if (edge.left || edge.right || edge.up || edge.down) { this.pauseYes = !this.pauseYes; this.audio.se('cursor'); }
      else if (edge.pause || edge.jump) { this.pauseView = 'menu'; this.audio.se('cancel'); }      // Start は pause と confirm が同時に立つので、取り消しを先に見る
      else if (edge.title) { this.toTitle('quit'); }                                                  // T／Back+B をもう一度＝はい
      else if (edge.confirm) { if (this.pauseYes) { this.audio.se('decide'); this.toTitle('quit'); } else { this.pauseView = 'menu'; this.audio.se('cancel'); } }
      return;
    }
    if (this.pauseView === 'moves') { this.updateMoves(dt, edge); return; }
    if (edge.pause || edge.jump) { this.resumeFromPause(); return; }
    if (edge.up) { this.pauseSel = (this.pauseSel + items - 1) % items; this.audio.se('cursor'); return; }
    if (edge.down) { this.pauseSel = (this.pauseSel + 1) % items; this.audio.se('cursor'); return; }
    if (edge.title) { this.pauseView = 'confirm'; this.pauseYes = false; this.audio.se('decide'); return; }      // T／Back+B：確認つきでタイトルへ
    if (edge.confirm) {
      this.audio.se('decide');
      switch (this.pauseSel) {
        case 0: if (this.plog.active) this.plog.ev('resume', {}); this.backToPlay(); break;
        case 1: if (this.plog.active) this.plog.ev('movelist', {}); this.pauseView = 'moves'; this.moveCat = 0; this.moveCur = 0; this.rep = null; break;
        case 2: this.optFromPause = true; this.state = 'options'; this.optSel = 0; this.rep = null; break;
        default: this.pauseView = 'confirm'; this.pauseYes = false; break;
      }
    }
  }

  /** 技表：← → で分類、↑ ↓ で技を見る（押しっぱなしで連続）。Esc／Start／B／T でメニューへ。 */
  updateMoves(dt, edge) {
    if (edge.pause || edge.jump || edge.title) { this.pauseView = 'menu'; this.rep = null; this.audio.se('cancel'); return; }
    const cats = this.moveList.cats, n = cats.length;
    const len = () => cats[this.moveCat].entries.length;
    if (edge.left || edge.right) {
      this.moveCat = (this.moveCat + (edge.right ? 1 : n - 1)) % n; this.moveCur = 0; this.rep = null; this.audio.se('cursor'); return;
    }
    const mv = (d) => { this.moveCur = clamp(this.moveCur + d, 0, len() - 1); this.audio.se('cursor'); };
    const dir = edge.up ? -1 : edge.down ? 1 : 0;
    if (dir) { mv(dir); this.rep = { dir, t: 0.4 }; return; }
    if (this.rep) {
      const held = this.input.heldNow;
      if ((this.rep.dir < 0 && held.up && !held.down) || (this.rep.dir > 0 && held.down && !held.up)) {
        this.rep.t -= dt;
        if (this.rep.t <= 0) { this.rep.t = 0.07; mv(this.rep.dir); }
      } else this.rep = null;
    }
  }

  // ---- 版2.3：遊んだ記録 ----
  /** 記録してよいか：オプション ON・URL が ?playlog=0 でない・古い版の写し（/v/…/）でない・練習場でない・自動操作（試験）は ?playlog=1 のときだけ。 */
  logAllowed() {
    if (true || !this.opts.playlog || this.params.get('playlog') === '0' || this.params.get('practice')) return false;
    try { if (/^\/v\//.test(location.pathname)) return false; if (location.protocol !== 'http:' && location.protocol !== 'https:') return false; } catch (e) { return false; }
    if (this.autoDriven() && this.params.get('playlog') !== '1') return false;
    return true;
  }

  autoDriven() { try { return !!navigator.webdriver; } catch (e) { return false; } }

  logBegin(stageIndex) {
    this.world.logHook = null;
    if (!this.logAllowed()) { if (this.plog.active) this.plog.end('restart'); return; }
    this.fstat = { frames: 0, sum: 0, max: 0, slow: 0 };
    const o = this.opts, st = this.stages[stageIndex], inp = this.input;
    const q = {}; for (const k of ['stage', 'diff', 'mpfree', 'cpfree', 'hitbox', 'px']) if (this.params.has(k)) q[k] = this.params.get(k);
    const tc = tuneChanged();      // 版2.6：どの調整（割合）で遊んだか。100% でないものだけ session 行に残す
    this.plog.begin({
      ...(Object.keys(tc).length ? { tune: tc } : null),
      v: VERSION, diff: this.difficulty, start: stageIndex + 1, label: st ? st.label : null,
      opts: { mpFree: this.run.mpFree ? 1 : 0, stageSel: this.run.stageSel ? 1 : 0, bgm: o.bgm, se: o.se, collision: o.collision ? 1 : 0 },
      dev: inp.padConnected ? 'pad' : 'key', pad: inp.padConnected ? inp.padName : null,
      auto: this.autoDriven() ? 1 : 0, q, px: this.assets.usePx ? 1 : 0,
    }, { moveRows: this.world.playerRows, facing: () => (this.world && this.world.player ? this.world.player.facing : 1) });
    this.world.logHook = (type, d) => this.plog.ev(type, d);
  }

  logEnd(why) {
    if (!this.plog.active) return;
    const w = this.world, fs = this.fstat;
    this.world.logHook = null;
    this.plog.end(why, {
      score: w ? w.score : 0, maxCombo: w ? w.maxCombo : 0, continues: w ? w.continues : 0, stage: w && w.player ? w.stageIndex + 1 : 0,
      stats: w ? { ...w.stats } : null, frames: fs.frames, avgMs: fs.frames ? Math.round(fs.sum / fs.frames * 100) / 100 : 0, maxMs: Math.round(fs.max), slow: fs.slow,
    });
  }

  showToast(t, sec = 1.6) { this.toast = { text: t, t: sec }; }

  // ---- 1フレーム ----
  frame(ts) {
    requestAnimationFrame((t) => this.frame(t));
    const dtReal = clamp((ts - (this.last || ts)) / 1000, 0, 0.05);
    const rawMs = (ts - (this.last || ts));
    this.last = ts;
    this.time += dtReal;
    this.input.poll(dtReal);
    const edge = this.input.edge;
    if (this.plog.active) {      // 版2.3：遊びの記録（入力の変化・送る時刻の確認）。記録が止まっているときは何もしない
      const fs = this.fstat; fs.frames++; fs.sum += rawMs; if (rawMs > fs.max) fs.max = rawMs; if (rawMs > 50) fs.slow++;
      const inp = this.input;
      if (inp.padChange) this.plog.ev('pad', { on: inp.padChange === 'on' ? 1 : 0, name: inp.padName });
      this.plog.input(inp.heldNow, edge, inp.padHeld, inp.keyHeld, this.state);
      this.plog.tick();
    } else if (this.plog.orphans.length) this.plog.tick();      // 版2.3b：終わった遊びの送り残しは、タイトルなど記録していないあいだも送り続ける
    if (this.input.takeAnyEdge()) this.audio.unlock();
    if (this.input.padChange === 'on') this.showToast('ゲームパッドが つながりました');
    else if (this.input.padChange === 'off') this.showToast('ゲームパッドが 外れました');
    if (edge.mute) {
      const r = this.audio.toggleMute();
      this.showToast(r === 'url' ? 'URL の ?mute=1 で消音中です' : r === 'off' ? '消音 ON' : '消音 OFF');
    }
    if (this.toast) { this.toast.t -= dtReal; if (this.toast.t <= 0) this.toast = null; }

    this.tune.update(edge);      // 版2.6：パッドの Back+Y で開閉。開いていて『止める』設定なら、このフレームのゲームの更新は飛ばす（描画は続く）
    if (!this.tune.paused) switch (this.state) {
      case 'title':
        if (edge.up || edge.down) { this.titleSel = (this.titleSel + (edge.down ? 1 : TITLE_ITEMS - 1)) % TITLE_ITEMS; this.audio.se('cursor'); }
        else if (edge.left || edge.right) { this.stepDifficulty(edge.right ? 1 : -1); }
        else if (edge.confirm) {
          this.audio.se('decide');
          if (this.titleSel === 1) this.openOptions(); else if (this.titleSel === 2) this.openControls(); else this.startFromTitle();
        }
        break;
      case 'options': this.updateOptions(dtReal, edge); break;
      case 'controls': this.updateControls(edge); break;
      case 'play': this.updatePlay(dtReal, edge); break;
      case 'pause': this.updatePause(dtReal, edge); break;
      case 'transition': this.updateTransition(dtReal, edge); break;
      case 'ending':
        this.endT += dtReal;
        if (this.world.player) { this.world.loopAnim(this.world.player, 'victory'); }
        if (this.endPhase === 'roll') {
          // 2026-11-15：スタッフロール。決定・Esc・Z（パッドの A・B・Start）の「押し直し」1 回で、すぐ今までの終わり方（ALL CLEAR）へ。
          //   押しっぱなしのボタンは edge にならないので飛ばない。始まって skipLock 秒は受けない（戦闘の連打の取りこぼし防止）
          const skip = edge.confirm || edge.pause || edge.attack || edge.jump;
          if ((skip && this.endT > ENDING_ROLL.skipLock) || this.endT >= endingRollSec()) { if (skip) this.audio.se('decide'); this.endPhase = 'result'; this.endT = 0; }
        } else if (this.endT > 2.2 && (edge.confirm || edge.pause)) { this.audio.se('decide'); this.toTitle('ending'); }
        break;
      default: break;
    }
    // 2026-11-14：ポーズ中（ポーズから開いたオプション・調整パネルの停止も）は、HUD とバナーの時間も止める。前は面の開始直後にポーズすると、再開したときには「STAGE」の表示やコンボの評価が消えていた
    const frozen = this.tune.paused || this.state === 'pause' || (this.state === 'options' && this.optFromPause);
    if (!frozen) {
      this.updateHud(dtReal);
      for (const b of this.banners) b.t += dtReal;
      this.banners = this.banners.filter((b) => b.t < b.dur);
    }
    this.render();
  }

  updatePlay(dtReal, edge) {
    const w = this.world;
    if (edge.pause && w.phase !== 'gameover') { this.drainEvents(); this.audio.se('cancel'); this.setState('pause'); return; }      // 2026-11-14：面の開始の曲・バナーを、ポーズの前に出しておく（最初のコマでポーズすると、再開までタイトルの曲が鳴り続けた）
    this.acc += dtReal * w.timeScale;
    let n = 0, first = true;
    while (this.acc >= STEP && n < 5) {
      w.update(STEP, this.input.snapshot(first));
      first = false;
      this.acc -= STEP; n++;
    }
    if (n >= 5) this.acc = 0;
    this.drainEvents();
    if (w.phase === 'gameover') {
      // 2026-11-15：Nao「A やられる前から押していた A は数えない（離して押し直したら決まる）」。A の連打では決めず、Enter・Start はすぐ決まる（input.js の CONFIRM_A_FIX）
      if (this.input.deliberateConfirm && w.phaseT > 0.6) { this.audio.se('decide'); w.continueHere(); w.reader.resume(this.input.heldNow); this.banners = []; this.hud.hpLag = w.player.hp; this.drainEvents(); }      // 2026-11-14：つづけるに使った A を、復活の直後の噛みつきにしない
      else if ((edge.pause || edge.title) && w.phaseT > 0.6) { this.toTitle('gameover-quit'); }
    }
    if (w.exitRequested) this.beginTransition();
    else if (w.endingRequested) this.beginEnding();
    else if (w.titleRequested) { w.titleRequested = false; this.toTitle('user-clear'); }      // 版3.3：ユーザー作の面を最後まで遊んだ
  }

  drainEvents() {
    const w = this.world;
    for (const ev of w.events) {
      switch (ev.type) {
        case 'sfx': this.audio.se(ev.name, ev.vol ?? 1, ev.rate ?? 1); break;
        case 'bgm': this.audio.bgm(ev.name); break;
        case 'stageStart': {
          const st = this.stages[ev.index];
          if (ev.revive) break;
          const boss = ev.boss && st.waves[0] && st.waves[0].enemies[0] && DINOS[st.waves[0].enemies[0].type] ? st.waves[0].enemies[0].type : null;      // 2026-11-14：敵の無いボス面（作った面）でも落ちない（前は waves[0] が無いと例外）
          if (boss) {
            this.banners.push({ kind: 'warn', text: 'WARNING', sub: `STAGE ${st.label}　` + DINOS[boss].label + ' があらわれた', t: 0, dur: 2.4 });
          } else {
            this.banners.push({ kind: 'stage', text: `STAGE ${st.label}`, sub: st.name, hint: st.hint || null, t: 0, dur: (STAGE_HINT.show && st.hint) ? 3.2 : 1.6 });      // 2026-11-15：説明を出さない（STAGE_HINT.show=false）ときは帯も短いまま      // 版3.0：hint＝面の説明の1行（海の最初の面：泳ぎかた）
          }
          break;
        }
        case 'banner': this.banners.push({ kind: 'clear', text: ev.text, t: 0, dur: 2.2 }); break;
        case 'comboEnd': this.hud.result = { n: ev.n, bonus: ev.bonus, rating: ev.rating, dmg: ev.dmg || 0, t: 0 }; break;
        default: break;
      }
    }
    w.events.length = 0;
  }

  // ---- 面送りのスクロール ----
  beginTransition() {
    const w = this.world, p = w.player;
    const next = w.stageIndex + 1;
    this.state = 'transition';
    const sea = w.seaCarry();      // 海の面の移り：水の中で面を出たなら、その深さを次の面へ引き継ぐ
    const tr = this.trans = { t: 0, dur: 1.9, from: w.stageIndex, to: next, p0: p.x, ready: false, hp: p.hp, gauge: p.gauge, sea };
    // 2026-11-14：この面送りの読み込みだけがこの面送りを進める（タイトルへ戻って始め直した別の面送りを、古い読み込みが進めない）。読めなければタイトルへ
    this.loadStage(this.stages[next]).then(() => { if (this.trans === tr) tr.ready = true; }, () => { if (this.trans === tr) this.loadFailed(); });
    w.exitRequested = false;
    this.banners = [];
  }

  updateTransition(dtReal, edge) {
    const tr = this.trans, w = this.world, p = w.player;
    if (!tr && TITLE_FIX.on) { this.state = 'play'; return; }      // 2026-11-15：面送りが無いのに面送りの画面にいる（来ないはずだが、来ても毎コマ例外で止めない）
    if (edge.pause) { this.audio.se('cancel'); this.setState('pause'); return; }
    if (!tr.ready) return;               // 次の面の素材待ち
    tr.t += dtReal;
    w.loopAnim(p, tr.sea && tr.sea.wet && tr.t < tr.dur * 0.5 + (this.stages[tr.to].water ? tr.dur : 0) ? 'swim' : 'run', 0.46);      // 海の面の移り：水の中から出たときは泳ぎの姿で移る
    p.facing = 1;
    w.tickAnim(p, dtReal);
    w.updateFx(dtReal);
    p.dustT = (p.dustT || 0) - dtReal;
    if (tr.t >= tr.dur) {
      const keep = { hp: tr.hp, gauge: tr.gauge, sea: tr.sea };
      w.startStage(tr.to, { carry: keep });
      // 2026-11-15：押しっぱなしのボタンを、次の面の頭で新しい押下にしない（startStage がコマンドの記録を空にするので、前は面の頭のイントロで噛みつきが出た）
      if (TITLE_FIX.on && w.reader) w.reader.resume(this.input.heldNow);
      this.trans = null;
      this.state = 'play';
      this.acc = 0;
      this.drainEvents();
      this.afterStageStart();
    }
  }

  beginEnding() {
    if (this.plog.active) this.plog.ev('ending', { score: this.world.score, continues: this.world.continues });
    this.state = 'ending';
    this.endT = 0;
    this.endPhase = ENDING_ROLL.on ? 'roll' : 'result';      // 2026-11-15：先にスタッフロール→そのあと今までの「ALL CLEAR」の画面
    if (this.assets.ensureEndingArt) this.assets.ensureEndingArt();
    this.banners = [];
    this.audio.bgm('ending');
  }

  updateHud(dt) {
    const h = this.hud, w = this.world;
    if (!w || !w.player) return;
    const p = w.player;
    if (p.hp > h.hpLag) h.hpLag = p.hp; else h.hpLag = Math.max(p.hp, h.hpLag - 55 * dt);
    const boss = w.enemies.find((e) => isBossLike(e.d) && e.state !== 'dying');
    if (boss) { if (h.bossLag === 0 || boss.hp > h.bossLag) h.bossLag = boss.hp; else h.bossLag = Math.max(boss.hp, h.bossLag - 120 * dt); } else h.bossLag = 0;
    h.scoreShown += (w.score - h.scoreShown) * Math.min(1, dt * 8);
    if (Math.abs(w.score - h.scoreShown) < 1) h.scoreShown = w.score;
    if (w.combo > h.lastCombo) h.comboPop = 0.22;
    h.lastCombo = w.combo;
    if (h.comboPop > 0) h.comboPop = Math.max(0, h.comboPop - dt);
    // 新しいコンボが表示されたら、同じ場所に出る前の評価を消す。
    if (w.combo >= 2) h.result = null;
    else if (h.result) { h.result.t += dt; if (h.result.t > 2.6) h.result = null; }
  }

  // ---- 描画 ----
  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, W, H);
    const view = { time: this.time, debug: this.debug, hitbox: this.hitbox, noAura: this.params.get('noaura') === '1' || window.__noAura === true };
    switch (this.state) {
      case 'loading': drawLoading(ctx, this, this.loadingLabel); break;
      case 'title': drawTitle(ctx, this); break;
      case 'controls': drawControls(ctx, this); break;
      case 'options':
        if (this.optFromPause) this.drawPlayLayer(ctx, view);       // ポーズメニューから開いたときは、戦闘の画面の上に重ねる
        drawOptions(ctx, this);
        break;
      case 'play':
      case 'pause': {
        this.drawPlayLayer(ctx, view);
        if (this.world.phase === 'gameover' && this.state === 'play') drawGameOver(ctx, this);
        if (this.state === 'pause') drawPause(ctx, this);
        break;
      }
      case 'transition':
        this.drawTransition(ctx);
        drawHud(ctx, this);
        if (!this.trans || !this.trans.ready) drawLoading(ctx, this, 'NOW LOADING…');
        break;
      case 'ending': drawEnding(ctx, this); break;
      default: break;
    }
    if (this.state === 'title' || this.state === 'options' || this.state === 'controls' || this.state === 'ending') drawPadBadge(ctx, this, W - 30, 64);      // 2026-11-14：版の表示（右上 y≈17〜41）の下へ。前は同じ所に重なっていた
    else if (this.state !== 'loading') drawPadBadge(ctx, this, W - 40, H - 44);
    // 2026-11-15：知らせは ここで 1 回だけ描く（前は戦闘中、drawPlayLayer の drawBanners でも描いて 2 枚重なっていた）。戦闘中・面送り中は HUD の下へ
    if (this.toast && this.toast.t > 0) drawToast(ctx, this.toast, this.toastTop());
    const nt = Object.keys(TUNE.pct).length;      // 版2.6：調整スライダーが 100% でない間は、隅に印を出す（調整した状態で遊んでいると分かるように）
    if (nt > 0 && this.state !== 'loading') {
      ctx.save(); ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(8, H - 34, 190, 26);
      ctx.fillStyle = '#ffd24a'; ctx.fillText(`調整中 ${nt} 項目 (F2)`, 16, H - 15); ctx.restore();
    }
  }

  /** 2026-11-15：知らせ（toast）を置く高さ。画面ごとに、見出し・残り時間・メニューに重ならない所（ui.js の TOAST_Y） */
  toastTop() {      // 名前に注意：drawBanners(this) は game.toastY（値）を読む（TOAST_FIX を切ったときの直す前の描き方）。ここを toastY にすると関数を渡してしまう
    if (!TOAST_FIX.on) return TOAST_Y.top;
    const s = this.state;
    if (s === 'play' || s === 'transition') return TOAST_Y.play;
    if (s === 'pause') return this.pauseView === 'moves' ? TOAST_Y.moves : TOAST_Y.pause;
    if (s === 'options') return TOAST_Y.options;
    if (s === 'ending' || s === 'controls') return TOAST_Y.edge;
    return TOAST_Y.top;
  }

  drawPlayLayer(ctx, view) {
    const inTrans = (this.state === 'pause' || this.state === 'options') && this.prevState === 'transition';
    if (inTrans) this.drawTransition(ctx); else drawWorld(ctx, this.assets, this.world, view);
    drawHud(ctx, this);
    drawBanners(ctx, TOAST_FIX.on ? { banners: this.banners } : this);      // 知らせ（toast）は render の最後で 1 回だけ描く
  }

  drawTransition(ctx) {
    const tr = this.trans, w = this.world;
    if (!tr) return;
    const u = easeInOut(clamp(tr.t / tr.dur, 0, 1));
    const camX = u * W;
    const A = this.stages[tr.from], B = this.stages[tr.to];
    const p = w.player;
    // 出口を越えた瞬間の足元とカメラから、次の面の開始位置までつなぐ。
    const bA = { cam: w.camY, y: p.y - w.camY };
    const startY = B.platforms[B.start?.plat]?.y ?? B.groundY;
    const startCam = clamp(startY - CAM.feetY, -(B.rise || 0), B.sink || 0);
    const bB = { cam: startCam, y: startY - startCam };
    // 海から海へ泳いで入る場合は、次の面の開始位置を海中の引き継ぎ先にする。
    const ent = tr.sea && tr.sea.wet ? seaEntry(B, tr.sea, w.player.bh) : null;
    if (ent) { bB.cam = ent.cam; bB.y = ent.y - ent.cam; }
    const fix = TRANS_FIX.on;
    const drawStageAt = (st, b, offX, lavaAt) => {
      if (st.water) { drawSeaStatic(ctx, st, offX, b.cam, this.time, fix ? 'back' : 'all'); return; }
      drawBackground(ctx, this.assets, st, offX, b.cam);
      ctx.save();
      ctx.translate(0, -b.cam);
      drawLavaStatic(ctx, st, offX, this.time, lavaAt);
      drawPlatforms(ctx, st, offX);
      ctx.restore();
    };
    // 2026-11-15：主人公より前に重ねるもの（海の水の膜・左右の断崖／陸の面の断崖）。本番の drawWorld と同じ重ね順にする
    const drawFrontAt = (st, b, offX) => {
      if (st.water) drawSeaStatic(ctx, st, offX, b.cam, this.time, 'front');
      else drawLandCliffsStatic(ctx, st, offX, b.cam);
    };
    // 2026-11-14：溶岩の水位は、出ていく面＝止まった世界の時計、入る面＝面の開始と同じ 0（前は実時間で、面送りの始まりと終わりに池の幅が跳んだ）
    drawStageAt(A, bA, -camX, w.lava ? { t: w.lavaT || 0, period: w.lava.period } : null);
    drawStageAt(B, bB, W - camX, { t: 0 });
    const v = clamp(tr.t / tr.dur, 0, 1);
    const endX = ent ? ent.x : B.start?.x ?? 150;
    const worldX = tr.p0 + (W + endX - tr.p0) * v;
    const sx = worldX - camX;
    tr.draw = { sx, sy: bA.y + (bB.y - bA.y) * u, edgeX: sx - (W - camX), swim: !!ent };      // 海の面の移り：検査が読む（次の面の左端からの位置）
    if (!(tr.sea && tr.sea.wet)) { ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.beginPath(); ctx.ellipse(sx, tr.draw.sy + 3, p.bw * 0.46, 9, 0, 0, Math.PI * 2); ctx.fill(); }      // 水の中では足元の影を出さない
    ctx.save();
    ctx.translate(sx - p.x, tr.draw.sy - p.y);
    drawEntity(ctx, this.assets, w, p, this.time);
    ctx.restore();
    if (fix) { drawFrontAt(A, bA, -camX); drawFrontAt(B, bB, W - camX); }
  }
}
