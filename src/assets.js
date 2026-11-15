// 画像の読み込み（ブラウザ専用）。恐竜は「その面に出る分だけ」読んで、使わなくなったら手放す
// （高解像度アトラスは数十MBになるため）。
import { DINOS } from './dinos.js';
import { setSeaArt, setSeaPart } from './sea_render.js';
import { setLavaTile } from './lava_render.js';
import { pickPalette, paletteMap, applyPaletteRGBA, applyTintRGBA } from './palette.js';

/** 描画・入力に道を譲る（MessageChannel のメッセージ 1 回ぶん。setTimeout と違い、隠れたタブでも 1 秒に絞られない）。 */
const yieldMain = () => new Promise((res) => { try { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); res(); }; ch.port2.postMessage(0); } catch (e) { setTimeout(res, 0); } });

export class Assets {
  /** px: 仕上げ済みのドット絵（assets/dino_px）を使う。?px=0 で false。pxDir は検査用に差し替えられる（?pxdir=）。 */
  constructor(base = '', { px = true, pxDir = 'assets/dino_px', rivalColor = null, lean = true, webp = true } = {}) {
    this.base = base;
    this.lean = lean;           // 2026-11-15：ドット絵が読めた恐竜は、今の絵（assets/dino）を読まない（?lean=0 で従来どおり両方）
    this.webpOn = webp;         // 2026-11-15：assets/webp_index.json があれば、載っている場所の画像は .webp を先に読む（?webp=0 で PNG／JPG のまま）
    this.webpDirs = [];
    this.usePx = px;
    this.pxDir = pxDir.replace(/\/+$/, '');
    this.motionsPx = {};        // <pxDir>/motions_px.json の dinos（無ければ空＝今の絵のまま）
    this.pxImg = {};            // name -> { motion -> [Image...] }（ドット絵が使える恐竜だけ）
    this.pxFailed = new Set();
    this.motions = null;        // data/motions.json
    this.dino = {};             // name -> { motion -> [Image...] }
    this.dinoLoading = {};      // name -> Promise
    this.cutin = {};            // 版2.7：カットインの連番 kind -> [Image...]（四天王スピノフューリーの目のアップ）
    this.bg = {};               // key -> HTMLCanvasElement（back1 と back2 を重ねた1枚）
    this.bgLoading = {};
    this.bytesLoaded = 0;
    this.rivalColor = rivalColor;   // ?rivalcolor=名前（assets/rival_palette.json の palettes の名前）。省略＝ adopted
    this.rivalPalette = null;       // assets/rival_palette.json（ライバルの色の定義）
    this.rivalInfo = null;          // 読み込み後：{ name, unknown } 置き換えに使った色の名前と、表に無い色の画素数（0 が正常）
  }

  async init() {
    const res = await fetch(`${this.base}data/motions.json`);
    if (!res.ok) throw new Error('data/motions.json が読めません');
    this.motions = await res.json();
    if (this.webpOn) {      // 2026-11-15：WebP に変えた場所の一覧（tools/build_dist.mjs が dist/ に置く。無ければ PNG のまま）
      try { const wi = await fetch(`${this.base}assets/webp_index.json`); if (wi.ok) this.webpDirs = ((await wi.json()).dirs || []).map((d) => (d.endsWith('/') ? d : d + '/')); } catch (e) { /* 無ければ PNG */ }
    }
    try {
      const rp = await fetch(`${this.base}assets/rival_palette.json`);
      if (rp.ok) this.rivalPalette = await rp.json();
    } catch (e) { /* 無ければライバルは主人公と同じ色 */ }
    if (this.usePx) {
      try {
        const r = await fetch(`${this.base}${this.pxDir}/motions_px.json`);
        if (r.ok) this.motionsPx = (await r.json()).dinos || {};
      } catch (e) { /* ドット絵が無ければ今の絵のまま */ }
    }
  }

  /** この恐竜のドット絵が使えるなら { meta, images }。無い・読めなかった・コマ数が違うなら null（今の絵のまま）。 */
  pxOf(name) {
    const meta = this.motionsPx[name], images = this.pxImg[name];
    return meta && images ? { meta, images } : null;
  }

  _seaPart(k) {
    if (!this.seaParts) this.seaParts = {};
    if (!this.seaParts[k]) this.seaParts[k] = this._image(`${this.base}assets/bg/sea/${k}.webp`).then((img) => setSeaPart(k, img)).catch((e) => console.warn(`海の部品の絵が読めない（描画で代用）: ${e.message}`));
    return this.seaParts[k];
  }

  /** 2026-11-15：assets/webp_index.json に載っている場所の PNG／JPG は、同名の .webp を先に読む（読めなければ元の形式）。 */
  _image(url) {
    const rel = this.base && url.startsWith(this.base) ? url.slice(this.base.length) : url;
    if (this.webpDirs.length && /\.png$/i.test(rel) && this.webpDirs.some((d) => rel.startsWith(d))) {
      return this._imageRaw(url.replace(/\.png$/i, '.webp')).catch(() => this._imageRaw(url));
    }
    return this._imageRaw(url);
  }

  _imageRaw(url) {
    return new Promise((ok, ng) => {
      const img = new Image();
      img.onload = async () => {
        // 先に画素へ展開しておく（初回の描画でカクつかない）。ただし枠が隠れているときなど decode が返らない場合は待ちすぎない。
        try { if (img.decode) await Promise.race([img.decode(), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* 続行 */ }
        ok(img);
      };
      img.onerror = () => ng(new Error('画像が読めません: ' + url));
      img.src = url;
    });
  }

  /** 画像を、色の対応表で置き換えた canvas にする（アルファ・位置は変えない）。 */
  _recolor(img, map) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0);
    const id = g.getImageData(0, 0, c.width, c.height);
    const unknown = applyPaletteRGBA(id.data, map);
    g.putImageData(id, 0, 0);
    return { canvas: c, unknown };
  }

  /** 画像を tint（色相・彩度・明るさ）で置き換えた canvas にする。 */
  _tint(img, tint) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0);
    const id = g.getImageData(0, 0, c.width, c.height);
    applyTintRGBA(id.data, tint);
    g.putImageData(id, 0, 0);
    return c;
  }

  /** 2026-10-25：画像を行の帯（BAND 行）ごとに fn で塗り替えた canvas にする。帯ごとに描画へ道を譲る（1 枚まとめて塗ると 0.1 秒ほど止まる）。fn は画素列を受け取り、数（置き換えた未知の色など）を返してよい。 */
  async _paintBands(img, fn) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0);
    const BAND = 96; let sum = 0;
    for (let y = 0; y < c.height; y += BAND) {
      const bh = Math.min(BAND, c.height - y);
      const id = g.getImageData(0, y, c.width, bh);
      sum += fn(id.data) || 0;
      g.putImageData(id, 0, y);
      await yieldMain();
    }
    return { canvas: c, sum };
  }

  /** 色違いの恐竜（artOf：ライバル）：絵は元の恐竜と共有し、ドット絵だけ palette の表で色を置き換える。 */
  async _ensureRecolor(name) {
    const base = DINOS[name].artOf;
    await this.ensureDino(base);
    this.dino[name] = this.dino[base];            // 今の絵（?px=0）は色違いにしない（元の色のまま）
    const src = this.pxImg[base], rp = this.rivalPalette;
    if (DINOS[name].sharedArt) {   // 版3.5：縮小版の雑魚（モササウルス小型）：色は変えず、元の恐竜の絵をそのまま共有
      if (src) this.pxImg[name] = src;
      return;
    }
    if (DINOS[name].tint) {        // 版2.1：強い色違い（R）。表を持たず色相・彩度・明るさで回す
      if (!src || !this.motionsPx[name]) return;
      const tint = DINOS[name].tint, table = {};
      for (const [m, pages] of Object.entries(src)) { const out = []; for (const img of pages) out.push((await this._paintBands(img, (d) => applyTintRGBA(d, tint))).canvas); table[m] = out; }      // 2026-10-25：1 枚ごとに描画へ道を譲る（まとめて塗ると 0.6 秒近く止まり、プレイ中の先読みでカクついた）
      this.pxImg[name] = table;
      return;
    }
    if (!src || !rp || !this.motionsPx[name]) return;
    const pal = pickPalette(rp, this.rivalColor);
    const map = paletteMap(rp, pal);
    const table = {};
    let unknown = 0;
    for (const [m, pages] of Object.entries(src)) { const out = []; for (const img of pages) { const r = await this._paintBands(img, (d) => applyPaletteRGBA(d, map)); unknown += r.sum; out.push(r.canvas); } table[m] = out; }
    this.pxImg[name] = table;
    this.rivalInfo = { name: pal, unknown };
    if (unknown) console.warn(`ライバルの色の表に無い色が ${unknown} 画素ある（assets/rival_palette.json の source が主人公の24色と違う）`);
  }

  /** 恐竜1種ぶん（必要な全モーションのアトラス）を読む。 */
  ensureDino(name) {
    if (this.dinoLoading[name]) return this.dinoLoading[name];      // 色違いは途中で道を譲るので、読み込み中の印を先に見る（this.dino だけ先に入るため）
    if (this.dino[name]) return Promise.resolve();
    if (DINOS[name].artOf) {
      this.dinoLoading[name] = this._ensureRecolor(name).then(() => { delete this.dinoLoading[name]; }, (e) => { delete this.dinoLoading[name]; throw e; });      // 2026-11-14：失敗も印を消す（残すと二度と読み直さない）
      return this.dinoLoading[name];
    }
    const meta = this.motions.dinos[name];
    const jobs = [];
    let table = {};
    // 今の絵（assets/dino）を読む。ドット絵を使えないときの代わり（lean=false のときは常に読む＝従来どおり）
    const loadOrig = () => {
      const tb = {}, js = [];
      for (const m of DINOS[name].motions) {
        const mm = meta.motions[m];
        tb[m] = new Array(mm.pages.length);
        mm.pages.forEach((file, i) => js.push(this._image(`${this.base}assets/dino/${name}/${file}`).then((img) => { tb[m][i] = img; })));
      }
      return Promise.all(js).then(() => tb);
    };
    // ドット絵（任意）。読めない・コマ数が元と違う場合は、その恐竜だけ今の絵のままにする。
    const pxMeta = this.usePx ? this.motionsPx[name] : null;
    let pxJob = null;
    if (pxMeta) {
      const bad = DINOS[name].motions.filter((m) => !pxMeta.motions[m] || pxMeta.motions[m].n !== meta.motions[m].n);
      if (bad.length) { this.pxFailed.add(name); console.warn(`ドット絵を使わない: ${name}（${bad.join(',')} が無い／コマ数が元の絵と違う）`); }
      else {
        const pxTable = {};
        const pxJobs = [];
        for (const m of DINOS[name].motions) {
          const mm = pxMeta.motions[m];
          pxTable[m] = new Array(mm.pages.length);
          mm.pages.forEach((file, i) => pxJobs.push(this._image(`${this.base}${this.pxDir}/${name}/${file}`).then((img) => { pxTable[m][i] = img; })));
        }
        pxJob = Promise.all(pxJobs).then(() => { this.pxImg[name] = pxTable; return true; }).catch((e) => { this.pxFailed.add(name); console.warn(`ドット絵が読めない: ${name} ${e.message}`); return false; });
      }
    }
    // 2026-11-15（軽量化）：ドット絵が読めたら今の絵（assets/dino・約 280MB）は読まない（描くときに使わない）。
    // ドット絵が無い／読めない恐竜だけ今の絵を読む。?lean=0 で従来どおり両方読む。
    if (this.lean) jobs.push((pxJob || Promise.resolve(false)).then((okPx) => (okPx ? {} : loadOrig())).then((tb) => { table = tb; }));
    else { jobs.push(loadOrig().then((tb) => { table = tb; })); if (pxJob) jobs.push(pxJob); }
    // 版2.7：カットインの連番（小さい webp が10枚）。読めなくてもゲームは続く（簡易の暗転で出る）
    const ci = DINOS[name].cutin;
    if (ci && !this.cutin[ci.kind]) {
      const frames = new Array(ci.n);
      jobs.push(Promise.all(Array.from({ length: ci.n }, (_, i) => this._image(`${this.base}${ci.dir}/eye_${String(i).padStart(2, '0')}.webp`).then((img) => { frames[i] = img; })))
        .then(() => { this.cutin[ci.kind] = frames; }).catch((e) => console.warn(`カットインが読めない: ${ci.kind} ${e.message}`)));
    }
    // 2026-11-14：失敗したときも読み込み中の印を消す。前は失敗した約束が残り、通信が戻っても同じ恐竜を二度と読み直さず、面の開始・面送りが NOW LOADING のまま止まった
    this.dinoLoading[name] = Promise.all(jobs).then(() => { this.dino[name] = table; delete this.dinoLoading[name]; }, (e) => { delete this.dinoLoading[name]; throw e; });
    return this.dinoLoading[name];
  }

  /** 背景: back1（地面）と back2（奥）を MZ の戦闘背景と同じ順で重ねて1枚にする。 */
  ensureBg(bg) {
    const key = `${bg.back1 || '-'}|${bg.back2 || '-'}`;
    if (this.bg[key]) return Promise.resolve(key);
    if (this.bgLoading[key]) return this.bgLoading[key];
    const jobs = [];
    const imgs = {};
    if (bg.back1) jobs.push(this._image(`${this.base}assets/bg/back1/${bg.back1}.png`).then((i) => { imgs.b1 = i; }));
    if (bg.back2) jobs.push(this._image(`${this.base}assets/bg/back2/${bg.back2}.png`).then((i) => { imgs.b2 = i; }));
    this.bgLoading[key] = Promise.all(jobs).then(() => {
      const c = document.createElement('canvas');
      c.width = 1000; c.height = 740;
      const g = c.getContext('2d');
      if (imgs.b1) g.drawImage(imgs.b1, 0, 0, 1000, 740);
      if (imgs.b2) g.drawImage(imgs.b2, 0, 0, 1000, 740);
      this.bg[key] = c;
      delete this.bgLoading[key];
      return key;
    }, (e) => { delete this.bgLoading[key]; throw e; });      // 2026-11-14：失敗も印を消す（恐竜と同じ）
    return this.bgLoading[key];
  }

  /** 縦長の背景絵（assets/bg/<artDir>/<art>.webp）を読む。読めなくても進む（海は描画で代用・陸は従来の横長の背景）。タイトルや面エディタも使う。 */
  ensureArt(bg) {
    if (!bg || !bg.art) return Promise.resolve(null);
    const key = `${bg.artDir || 'sea'}/${bg.art}`;
    this.artLoading = this.artLoading || {};
    if (!this.artLoading[key]) this.artLoading[key] = this._image(`${this.base}assets/bg/${key}.webp`).then((img) => { setSeaArt(bg.art, img); return key; }).catch((e) => { delete this.artLoading[key]; console.warn(`背景の縦長の絵が読めない（描画の海／従来の背景で代用）: ${e.message}`); return null; });
    return this.artLoading[key];
  }

  /** 2026-11-15：タイトルの絵（assets/title/<set>/bg.jpg と logo.png）。どの絵があるかは assets/title/art.json に書いてある（無い絵を取りにいって 404 を出さないため）。
   *  読めなくても投げない（無いときは ui.js の代わりの描き方）。結果は this.titleArt[set] = { bg, logo }（無いものは null）。 */
  ensureTitleArt(set) {
    this.titleArt = this.titleArt || {};
    this.titleArtLoading = this.titleArtLoading || {};
    if (!this.titleArtLoading[set]) {
      this.titleArtLoading[set] = (async () => {
        let list = {};
        try { const r = await fetch(`${this.base}assets/title/art.json`); if (r.ok) list = (await r.json()) || {}; } catch (e) { /* 無ければ代わりの描き方 */ }
        const have = list[set] || {};
        const one = (file) => this._image(`${this.base}assets/title/${set}/${file}`).catch((e) => { console.warn(`タイトルの絵が読めない（代わりの描き方）: ${e.message}`); return null; });
        const [bg, logo] = await Promise.all([have.bg ? one('bg.jpg') : null, have.logo ? one('logo.png') : null]);
        this.titleArt[set] = { bg, logo };
        return this.titleArt[set];
      })();
    }
    return this.titleArtLoading[set];
  }

  /** 2026-11-15：エンディングのスタッフロールの絵（assets/ending/sepia_art.jpg＝縦長のセピアの絵・sepia_bg.jpg＝余白の地）。
   *  読めなくても投げない（結果は this.endingArt = { art, bg }・無いものは null。ui.js が無地で代用する）。 */
  ensureEndingArt() {
    if (!this.endingArtLoading) {
      this.endingArt = { art: null, bg: null };
      const one = (file) => this._image(`${this.base}assets/ending/${file}`).catch((e) => { console.warn(`エンディングの絵が読めない（無地で代用）: ${e.message}`); return null; });
      this.endingArtLoading = Promise.all([one('sepia_art.jpg'), one('sepia_bg.jpg')]).then(([art, bg]) => { this.endingArt = { art, bg }; return this.endingArt; });
    }
    return this.endingArtLoading;
  }

  /** この面に必要なものを全部読む。 */
  needFor(stage, player = 'Spinosaurus') {
    const need = new Set([player]);
    for (const w of stage.waves) for (const e of w.enemies) need.add(e.type);
    // ボスのローア召喚など、動的に出る敵
    for (const n of [...need]) if (DINOS[n].summon) need.add(DINOS[n].summon.type);
    return need;
  }

  async ensureStage(stage, player = 'Spinosaurus') {
    const need = this.needFor(stage, player);
    const jobs = [...need].map((n) => this.ensureDino(n));
    jobs.push(this.ensureArt(stage.bg));      // 版3.0：縦長の背景絵（海・火山）／版3.4：陸の全面。読めなければ描画の海／従来の横長の背景
    if (stage.lava) jobs.push(this._image(`${this.base}assets/bg/lava/tile.webp`).then((img) => setLavaTile(img)).catch((e) => console.warn(`溶岩のタイルが読めない（描画の溶岩で代用）: ${e.message}`)));      // 版3.1：溶岩の面のタイル（GPT 画像生成）
    if (stage.bg && stage.bg.proc) for (const k of ['block_float', 'block_drift', 'cliff', 'seabed', 'rift_edge', 'rift_dark', 'rift_flow', 'surface', 'rays', 'cave', 'kelp1', 'kelp2', 'kelp3', 'coral1', 'coral2', 'coral3', 'rock1', 'rock2', 'rock3']) jobs.push(this._seaPart(k));      // 版3.0：浮きブロック・断崖の絵（GPT 画像生成。読めなければ描画で代用）
    if (!(stage.bg && stage.bg.proc)) jobs.push(this.ensureBg(stage.bg));      // 版3.0：描画で作る背景（海）は絵を読まない
    await Promise.all(jobs);
    return need;
  }

  /** 使わない恐竜の画像を手放す。 */
  release(keep) {
    for (const n of Object.keys(this.dino)) if (!keep.has(n)) { delete this.dino[n]; delete this.pxImg[n]; }
  }

  bgKey(bg) { return `${bg.back1 || '-'}|${bg.back2 || '-'}`; }
  images(name, motion) { return this.dino[name] && this.dino[name][motion]; }
}
