// 効果音（Web Audio）と曲。?mute=1 のときは音ファイルを読み込みもしない。
// 曲：assets/audio/bgm_loops.json に載っている曲（ElevenLabs で作った地域の曲・エンディング）は、Web Audio の AudioBufferSourceNode の loopStart/loopEnd で
//   途切れなく繰り返す（ブラウザは ogg の LOOPSTART タグを読まないため）。表に無い曲（ボス曲・タイトル）は従来どおり HTMLAudio で曲全体を繰り返す。
// 既定の音量: BGM 0.2、効果音 0.9。M キーで消音の切り替え。
import { SE, BGM, VOLUME, seTrimGain } from './sounds.js';
import { levelGain } from './options.js';
import { tn, TUNE } from './tune.js';

/** 2026-11-15：効果音の読み込みのやり直し。on=false で直す前（1 回きり・やり直しなし＝検査の陰性対照）。wait＝やり直しの間（ミリ秒×回目）・again＝鳴らそうとしたときに読み直すまでの間 */
export const SE_FIX = { on: true, wait: 400, again: 10000 };
/** 2026-11-15：デコードした曲（Web Audio で鳴らすループ表の曲）を持つ数。0 で直す前（全部持ち続ける＝検査の陰性対照）。2＝いまの曲と直前の曲（同じワールドの面どうし・ボス戦のあと戻るときは読み直さない） */
export const BGM_CACHE = { max: 2 };

/** 2026-10-24（Nao「効果音に合成のリミッターがありません…直すなら、音全体に圧縮をかけます。おすすめで」）：音の全体（効果音・咆哮・Web Audio の曲）が通る最後の段。
 *  効果音の同時再生の足し合わせが 1.0 を超えて割れるのを、マスターの圧縮（DynamicsCompressorNode）と、その後ろの安全なソフトクリップ（WaveShaper）で抑える。
 *  オン・オフと強さはここの定数 LIMITER（on:false で無効）と、調整スライダー F2 の『音のリミッター（強さ）』（0% = 無効・既定 100%）。
 *  threshold(dB)・knee(dB)・ratio・attack(秒)・release(秒) は tools/audio_test.mjs の測定（乱入力の模擬プレイ）で決めた。makeupDb は、自動の補正（autoMakeupDb）を打ち消したあとに足す音量（dB。0 = 小さい音は素通し）。
 *  clipAt＝この値までは素通しで、それより上をなめらかに 1.0 へ寄せる（圧縮の attack の間にすり抜けた尖りの最後の砦。合成ピークは 1.0 を超えない）。
 *  HTMLAudio で鳴らす曲（ボス曲・タイトルなど）は Web Audio の外でブラウザが別に混ぜるので、この段を通らない（曲は音量 0.2 倍と小さく、効果音側は 1.0 以下に抑えるので、足し合わせても割れにくい）。 */
export const LIMITER = { on: true, threshold: -4, knee: 4, ratio: 12, attack: 0.002, release: 0.12, makeupDb: 0, clipAt: 0.85 };

/** DynamicsCompressorNode が自動で足す音量の補正（dB）。ブラウザ（Blink・Firefox・WebKit 共通）の実装は『入力 1.0 を圧縮曲線に通した出力』の逆数の 0.6 乗を後ろで掛ける。
 *  そのままだと圧縮の設定ごとに曲まで大きくなる（threshold -8・ratio 12 で約 +3.7dB）ので、同じ式で求めて makeup で打ち消し、小さい音は素通し（±0dB）にする。 */
export function autoMakeupDb(thresholdDb, kneeDb, ratio) {
  const db2 = (d) => 10 ** (d / 20), lin2db = (x) => 20 * Math.log10(x);
  const lt = db2(thresholdDb), kt = db2(thresholdDb + kneeDb);
  const knee = (x, k) => (x < lt ? x : lt + (1 - Math.exp(-k * (x - lt))) / k);
  const slopeAt = (x, k) => { if (x < lt) return 1; const x2 = x * 1.001; return (lin2db(knee(x2, k)) - lin2db(knee(x, k))) / (lin2db(x2) - lin2db(x)); };
  let lo = 0.1, hi = 10000, k = 5;
  for (let i = 0; i < 15; i++) { if (slopeAt(kt, k) < 1 / ratio) hi = k; else lo = k; k = Math.sqrt(lo * hi); }
  const yk = lin2db(knee(kt, k));
  const sat = (x) => (x < kt ? knee(x, k) : db2(yk + (lin2db(x) - lin2db(kt)) / ratio));
  return 0.6 * -lin2db(sat(1));
}

/** 強さ（0〜2。1 = 既定）から圧縮の設定を作る。0 以下は null（無効）。純粋な関数（Node の試験でも使える）。 */
export function limiterParams(strength = 1, L = LIMITER) {
  if (!L.on || !(strength > 0)) return null;
  const s = Math.min(2, strength);
  const threshold = L.threshold - (s > 1 ? (s - 1) * 6 : 0), ratio = Math.min(20, 1 + (L.ratio - 1) * Math.min(s, 1));
  return {
    threshold, knee: L.knee, ratio, attack: L.attack, release: L.release,
    makeup: 10 ** ((L.makeupDb - autoMakeupDb(threshold, L.knee, ratio)) / 20),
  };
}
/** 1.0 に届く前から曲がりはじめるソフトクリップの曲線（|x| ≤ clipAt は素通し・それより上は 1.0 に向かって滑らかに飽和）。 */
export function clipCurve(n = 4097, at = LIMITER.clipAt) {
  const c = new Float32Array(n), span = 1 - at;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    const y = a <= at ? a : at + span * Math.tanh((a - at) / span);
    c[i] = Math.sign(x) * Math.min(1, y);
  }
  return c;
}
/** 最後の段を作る。返す bus に全部をつなぐ。set(strength) で強さを変える（0 = 素通し）。AudioContext が無い環境では呼ばない。 */
export function buildOutput(ctx, strength = 1, L = LIMITER) {
  const bus = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  const make = ctx.createGain();
  const clip = ctx.createWaveShaper();
  clip.curve = clipCurve(4097, L.clipAt);
  comp.connect(make); make.connect(clip); clip.connect(ctx.destination);
  const out = { bus, comp, make, clip, strength: null,
    set(st) {
      const p = limiterParams(st, L);
      const now = p ? st : 0;
      if (out.strength === now) return;
      const wasOff = out.strength === 0 || out.strength === null;
      out.strength = now;
      if (!p) { try { bus.disconnect(); } catch (e) { /* */ } bus.connect(ctx.destination); return; }      // 無効：圧縮もクリップも通さない（直通）
      if (wasOff) { try { bus.disconnect(); } catch (e) { /* */ } bus.connect(comp); }
      comp.threshold.value = p.threshold; comp.knee.value = p.knee; comp.ratio.value = p.ratio; comp.attack.value = p.attack; comp.release.value = p.release;
      make.gain.value = p.makeup;
    } };
  out.set(strength);
  return out;
}

export class AudioSys {
  constructor({ forceMute = false, base = '', ext = null } = {}) {
    this.base = base;
    this.ext = ext || 'ogg';      // 2026-11-15：音の拡張子。ogg を再生できないブラウザ（古い iOS など）で assets/audio/m4a_index.json があれば m4a にする（tools/build_dist.mjs --audio m4a が作る）。?aext=m4a で強制
    this.extForced = !!ext;
    this.extReady = Promise.resolve();
    this.forceMute = forceMute;   // URL の ?mute=1（切り替え不可）
    this.muted = forceMute;
    this.ctx = null;
    this.master = null;
    this.out = null;       // 最後の段（buildOutput）
    this.buffers = {};
    this.last = {};
    this.bgmEl = null;
    this.bgmSrc = null;    // 版3.5：Web Audio の曲（ループ表にある曲）
    this.bgmNode = null;
    this.bgmBufs = {};     // 曲ファイル名 → AudioBuffer
    this.loops = null;     // bgm_loops.json（読み込めなければ {}）
    this.loopsReady = null;
    this.bgmToken = 0;
    this.bgmName = null;
    this.wantBgm = null;
    this.unlocked = false;
    this.loaded = 0;
    this.bgmGain = 1;      // 版2.0：オプションの音量（0〜1。0 なら曲を鳴らさない）
    this.seGain = 1;       // 同・効果音（0 なら鳴らさない）
    this.seCount = 0;      // 実際に鳴らした効果音の数（試験用）
    this.bgmStarts = 0;    // 実際に曲を再生しはじめた回数（試験用）
  }

  /** 版2.0：オプションの音量（段階 0〜5）を反映する。 */
  setLevels(bgmLevel, seLevel) {
    this.bgmGain = levelGain(bgmLevel);
    this.seGain = levelGain(seLevel);
    if (this.master) this.master.gain.value = this.muted ? 0 : VOLUME.se * this.seGain;
    if (this.bgmEl) {
      this.bgmEl.volume = VOLUME.bgm * this.bgmGain;
      if (this.bgmGain === 0) this.bgmEl.pause(); else if (!this.muted && this.unlocked) this._tryPlayEl(this.bgmEl);
    } else if (this.bgmSrc) {
      if (this.bgmGain === 0) this._stopBgm(); else this._applyBgmNode();
    } else if (this.bgmGain > 0 && this.wantBgm && this.unlocked) this._playBgm(this.wantBgm);
  }

  init() {
    if (this.forceMute) return;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : VOLUME.se * this.seGain;
      this.out = buildOutput(this.ctx, this._limiterStrength());      // 最後の段（圧縮＋ソフトクリップ）。効果音・Web Audio の曲がここを通る
      this.master.connect(this.out.bus);
    } catch (e) { this.ctx = null; return; }
    // 2026-11-14：読み込み中（ctx を作る前）に最初の操作があったときは、作ったその場で再開する（前は unlock が先に済み、あとで作った ctx が止まったままだった）
    if (this.unlocked && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.extReady = this._pickExt();
    for (const [name, file] of Object.entries(SE)) this._load(name, file);
    this.loopsReady = this._loadLoops();
  }

  /** 調整スライダー『音のリミッター（強さ）』の倍率（0 = 無効・1 = 既定）。 */
  _limiterStrength() { return tn('limiter'); }
  /** スライダーが動いていたら最後の段へ反映（効果音を鳴らすたびに呼ぶ。TUNE.ver が変わったときだけ作業する）。 */
  _syncLimiter() {
    if (this.out && this._tuneVer !== TUNE.ver) { this._tuneVer = TUNE.ver; this.out.set(this._limiterStrength()); }
  }

  /** 2026-11-15：ogg（Vorbis）を再生できないブラウザなら、m4a（AAC）を使う（m4a_index.json が置いてあるときだけ）。 */
  async _pickExt() {
    if (this.extForced) return;
    try {
      const a = typeof Audio !== 'undefined' ? new Audio() : null;
      if (!a || a.canPlayType('audio/ogg; codecs="vorbis"')) return;
      const r = await fetch(`${this.base}assets/audio/m4a_index.json`);
      if (r.ok) this.ext = 'm4a';
    } catch (e) { /* ogg のまま */ }
  }

  async _loadLoops() {
    try {
      const res = await fetch(`${this.base}assets/audio/bgm_loops.json`);
      if (!res.ok) throw new Error(res.status);
      const j = await res.json();
      this.loops = j && typeof j === 'object' ? j : {};
    } catch (e) { this.loops = {}; }       // 読めなければ曲全体を繰り返す
    return this.loops;
  }

  /** 試験用：いま鳴っている曲の音量（段階を掛けたあと）と、鳴っているか。 */
  get bgmVolume() { return this.bgmEl ? this.bgmEl.volume : (this.bgmNode ? VOLUME.bgm * this.bgmGain : null); }
  get bgmPlaying() { return this.bgmEl ? !this.bgmEl.paused : !!(this.bgmSrc && !this.muted); }

  // 2026-11-15：効果音の読み込みは 3 回までやり直す。それでも読めなければ無音のまま進み、その音を鳴らそうとしたときに
  //   （前に失敗してから 10 秒以上たっていれば）もう一度読む。前は 1 回の通信の失敗で、その効果音がページを読み直すまでずっと鳴らなかった
  async _load(name, file, tries = SE_FIX.on ? 3 : 1) {
    if (!this.seLoading) { this.seLoading = {}; this.seFailedAt = {}; }
    if (this.seLoading[name]) return;
    this.seLoading[name] = true;
    try {
      await this.extReady;
      for (let i = 0; i < tries; i++) {
        try {
          const res = await fetch(`${this.base}assets/audio/se/${file}.${this.ext}`);
          if (!res.ok) throw new Error(res.status);
          const arr = await res.arrayBuffer();
          this.buffers[name] = await new Promise((ok, ng) => this.ctx.decodeAudioData(arr, ok, ng));
          this.loaded++;
          delete this.seFailedAt[name];
          return;
        } catch (e) {
          if (i < tries - 1) await new Promise((r) => setTimeout(r, SE_FIX.wait * (i + 1)));
        }
      }
      this.seFailedAt[name] = Date.now();    // 読めなければ無音のまま進む
    } finally { this.seLoading[name] = false; }
  }
  /** 読めなかった効果音を、鳴らそうとしたときに読み直す（失敗してから SE_FIX.again ミリ秒以上たっていれば）。 */
  _retrySe(name) {
    if (!SE_FIX.on || !this.ctx || !this.seFailedAt || !SE[name]) return;
    const t = this.seFailedAt[name];
    if (t === undefined || this.seLoading[name] || Date.now() - t < SE_FIX.again) return;
    this._load(name, SE[name], 1);
  }

  /** 最初のキー入力・クリックで呼ぶ（ブラウザの自動再生制限の解除）。 */
  //   2026-11-14：一度きりにしない。止まっていればそのつど再開し、ブラウザに断られた曲（パッドだけで始めた・最初の操作が早すぎた）の再生をやり直す
  unlock() {
    const first = !this.unlocked;
    this.unlocked = true;
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (first) { if (this.wantBgm) this._playBgm(this.wantBgm); return; }
    if (this.bgmEl && this.bgmBlocked && !this.muted && this.bgmGain > 0) this._tryPlayEl(this.bgmEl);
  }
  /** 曲（HTMLAudio）を鳴らす。断られたら印を付け、次の操作（unlock）でやり直す。 */
  _tryPlayEl(el) {
    this.bgmBlocked = false;
    const r = el.play();
    if (r && typeof r.catch === 'function') r.catch(() => { if (this.bgmEl === el) this.bgmBlocked = true; });
  }

  se(name, vol = 1, rate = 1) {
    if (this.muted || this.seGain === 0 || !this.ctx || !this.unlocked) return;
    const buf = this.buffers[name] || (typeof name === 'string' && name.startsWith('DR_') ? this.buffers.growl : null);
    if (!buf) { this._retrySe(name); if (typeof name === 'string' && name.startsWith('DR_')) this._retrySe('growl'); return; }
    this._syncLimiter();
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < 0.04) return; // 同じ音の重なりすぎを防ぐ
    this.last[name] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol * seTrimGain(buf === this.buffers[name] ? name : 'growl');      // 2026-10-24：効果音ごとの音量の補正（sounds.js SE_TRIM）
    src.connect(g); g.connect(this.master);
    src.start();
    this.seCount++;
  }

  bgm(name) {
    this.wantBgm = name;
    if (this.forceMute) return;
    if (name === this.bgmName && this.bgmSrc) { this._applyBgmNode(); return; }
    if (name === this.bgmName && this.bgmEl) { if (!this.muted && this.unlocked && this.bgmGain > 0) this._tryPlayEl(this.bgmEl); return; }
    this._stopBgm();
    this.bgmName = name;
    if (name && this.unlocked) this._playBgm(name);
  }

  _playBgm(name) {
    if (this.forceMute || !name || typeof Audio === 'undefined' || this.bgmGain === 0) return;
    const file = BGM[name];
    if (!file) return;
    this._stopBgm();
    if (this.ctx && this.loopsReady) {                 // 版3.5：ループ表にある曲は Web Audio で（表の読み込みを待ってから決める）
      const token = ++this.bgmToken;
      this.bgmName = name;
      this.loopsReady.then(() => {
        if (token !== this.bgmToken || this.wantBgm !== name) return;
        const spec = this.loops && this.loops[file];
        if (spec) this._playLoopBgm(name, file, spec, token); else this._playHtmlBgm(name, file);
      });
      return;
    }
    this._playHtmlBgm(name, file);
  }

  async _playLoopBgm(name, file, spec, token) {
    try {
      let buf = this.bgmBufs[file];
      if (!buf) {
        await this.extReady;
        const res = await fetch(`${this.base}assets/audio/bgm/${file}.${this.ext}`);
        if (!res.ok) throw new Error(res.status);
        const arr = await res.arrayBuffer();
        buf = await new Promise((ok, ng) => this.ctx.decodeAudioData(arr, ok, ng));
        this.bgmBufs[file] = buf;
      }
      this._trimBgmBufs(file);
      if (token !== this.bgmToken || this.wantBgm !== name || this.bgmGain === 0) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = spec.loopStart || 0;
      src.loopEnd = Math.min(spec.loopEnd || buf.duration, buf.duration);
      const g = this.ctx.createGain();
      src.connect(g); g.connect(this.out ? this.out.bus : this.ctx.destination);
      this.bgmSrc = src; this.bgmNode = g; this.bgmName = name;
      this._applyBgmNode();
      src.start(0, src.loopStart);
      if (!this.muted) this.bgmStarts++;
    } catch (e) {
      if (token === this.bgmToken && this.wantBgm === name) this._playHtmlBgm(name, file);   // 読めなければ従来の方法で
    }
  }

  /** 2026-11-15：デコードした曲は、新しく使った順に BGM_CACHE.max 曲まで持つ（いま使う曲は消さない）。前は全部持ち続け、全曲で約 286MB（実ブラウザで測った・48kHz ステレオ）になった。 */
  _trimBgmBufs(file) {
    if (!(BGM_CACHE.max > 0)) return;
    this.bgmOrder = (this.bgmOrder || []).filter((f) => f !== file && this.bgmBufs[f]);
    this.bgmOrder.push(file);
    while (this.bgmOrder.length > BGM_CACHE.max) delete this.bgmBufs[this.bgmOrder.shift()];
  }

  _applyBgmNode() {
    if (this.bgmNode) this.bgmNode.gain.value = this.muted ? 0 : VOLUME.bgm * this.bgmGain;
  }

  _playHtmlBgm(name, file) {
    if (typeof Audio === 'undefined') return;
    this._stopBgm();
    const el = new Audio(`${this.base}assets/audio/bgm/${file}.${this.ext}`);
    el.loop = true;
    el.volume = VOLUME.bgm * this.bgmGain;
    this.bgmEl = el;
    this.bgmName = name;
    if (!this.muted) { this._tryPlayEl(el); this.bgmStarts++; }
  }

  _stopBgm() {
    this.bgmToken++;
    if (this.bgmEl) { try { this.bgmEl.pause(); } catch (e) { /* */ } this.bgmEl = null; }
    if (this.bgmSrc) { try { this.bgmSrc.stop(); this.bgmSrc.disconnect(); this.bgmNode.disconnect(); } catch (e) { /* */ } this.bgmSrc = null; this.bgmNode = null; }
    this.bgmName = null;
  }

  toggleMute() {
    if (this.forceMute) return 'url';
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : VOLUME.se * this.seGain;
    if (this.bgmEl) { if (this.muted || this.bgmGain === 0) this.bgmEl.pause(); else this._tryPlayEl(this.bgmEl); }
    else if (this.bgmSrc) this._applyBgmNode();
    else if (!this.muted && this.wantBgm && this.unlocked && this.bgmGain > 0) this._playBgm(this.wantBgm);
    return this.muted ? 'off' : 'on';
  }
}
