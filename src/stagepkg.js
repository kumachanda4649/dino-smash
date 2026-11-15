// 版3.3（ステージ作成）：ステージパッケージ。面のデータ（足場・敵の波・主人公の初期位置・ギミック・背景・曲・変数）を1つの JSON にまとめる。
// 面エディタ（editor/）・ゲーム（src/game.js）・保存の口（tools/lib/package_server.mjs）・検査が同じこのファイルを使う（画面や DOM は触らない）。
//
// ■ パッケージの形（data/stage_packages/<id>.json）
//   { version:1, id, replaces:null|'1-1'|'S2'…, meta:{ name, author?:'nao', basedOn?, savedAt? },
//     stage:{ name, boss?, final?, hint?, bgm, bg, bgY?, groundY, clearHeal, timeLimit, curve?, bossHp?, platforms:[{x,y,w,kind?}], start?:{x,plat?},
//             waves:[{delay,until?,swarm?,enemies:[{type,from,delay?,x?,plat?}]}], gimmicks:[…], vars:{…} } }
//   replaces＝既存の面の鍵（layout.js の stageKey）。あれば、ゲームはその面をこのパッケージで置き換える（無い面は従来どおり stages.js）。
//   無ければ「ユーザー作の面」。既存の面のあとに U-1, U-2 … として並ぶ。
//   足場は data/stage_layouts.json（面エディタ版3.1）が優先：パッケージを読んだあとで layouts をさらに当てる（従来どおり）。
//
// ■ ギミックの部品（stage.gimmicks）。1種類につき最大1つ。
//   lava      マグマだまり：pools[{x,w,sx?,sw?}]・period（水位の周期・秒）・dmg（主人公が池に入ったダメージ）
//   water     水面と水中：y（水面の高さ）・sink（カメラが下へ続く量）・swimmers（水の敵を出すか）・gaps/pit（海底の裂け目と落ちてはいけない所）
//   cliff     左右の断崖の壁：left・right
//   platforms 足場の見た目：top・face（色）・kind（足場の種類の既定）
//   scroll    縦スクロール：rise（上へ）・sink（下へ。水のある面では water の sink が正）
//   表 GIMMICKS に1行足すと、検証・エディタの入力欄・面への反映の入口ができる（反映そのものは stageFromPackage の applyGimmick）。
//
// ■ 変数（stage.vars）。ステージごとの調整（100＝今の値・10〜300）。最終の値 ＝ グローバル（src/tune.js）× ステージごと。world.js が svn(id) で掛ける。
import { DINOS, PLAYER, isBossLike } from './dinos.js';
import { BGM, BGM_LEGACY } from './sounds.js';
import { GRID, KINDS, RISE_MAX, CAM_FEET, SCREEN_W, stageKey } from './layout.js';

export const PKG_VERSION = 1;
/** 2026-11-15：keepFinal＝公式の最後の面を置き換えるとき final の印を引き継ぐ（false で直す前＝検査の陰性対照） */
export const PKG_FIX = { keepFinal: true };
export const PKG_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
export const KEY_RE2 = /^([1-9]-[1-9]|S[1-9])$/;
export const MAX_PKG_BYTES = 128 * 1024;
export const LIMITS = { waves: 16, enemiesPerWave: 24, platforms: 16, pools: 4, name: 40, hint: 120, gaps: 4 };
export const PREVIEW_PKG_KEY = 'dinoArtsPackagePreview';
export const PKG_DIR = 'data/stage_packages';
export const USER_WORLD_NAME = 'ユーザーの面';

// ---------- 変数（ステージごとのスライダー） ----------
export const VAR_MIN = 10, VAR_MAX = 300;
export const VAR_TABLE = [
  { id: 'hpMul',     group: '敵',       label: '敵の体力',               note: 'この面の敵（ボス含む）の体力。グローバルの「敵の体力」との積' },
  { id: 'dmgMul',    group: '敵',       label: '敵の威力',               note: 'この面の敵の攻撃の威力。グローバルの「敵の攻撃力」との積' },
  { id: 'countMul',  group: '敵',       label: '波ごとの敵の数',         note: '雑魚の数（ボスはそのまま・各波に最低1体）' },
  { id: 'timeMul',   group: '面',       label: '制限時間',               note: 'この面の制限時間（難しさの倍率に重ねる）' },
  { id: 'healMul',   group: '面',       label: 'クリア回復',             note: '面クリアで回復する体力' },
  { id: 'lavaDmg',   group: 'ギミック', label: 'マグマのダメージ',       note: '主人公が池に入ったときのダメージ', gimmick: 'lava' },
  { id: 'lavaSpeed', group: 'ギミック', label: 'マグマの水位の速さ',     note: '大きいほど水位が速く上下する（周期が短くなる）', gimmick: 'lava' },
  { id: 'swimMul',   group: 'ギミック', label: '水の敵の数',             note: '泳ぐ敵（イクチオサウルスなど）の数', gimmick: 'water' },
];
const VAR_BY_ID = Object.fromEntries(VAR_TABLE.map((r) => [r.id, r]));
/** 自分のプロパティだけを見る（'constructor'・'toString'・'__proto__' のような名前が表を素通りしないように。2026-10-25 の変異 fuzz で見つかった）。 */
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export const varRow = (id) => (own(VAR_BY_ID, id) ? VAR_BY_ID[id] : null);

/** 変数を整える：知らない id は捨てる・10〜300 に収める・100（=既定）は持たない。 */
export function cleanVars(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, raw] of Object.entries(v)) {
    if (!own(VAR_BY_ID, k) || raw === null || raw === '' || typeof raw === 'boolean' || typeof raw === 'object') continue;
    if (typeof raw === 'string' && raw.trim() === '') continue;      // 2026-11-15：空白だけの文字列も捨てる（Number(' ') は 0 で、下限の 10 に化けた）
    let n = Math.round(Number(raw));
    if (!Number.isFinite(n)) continue;
    n = Math.min(VAR_MAX, Math.max(VAR_MIN, n));
    if (n !== 100) out[k] = n;
  }
  return out;
}
/** 倍率（100 → 1）。世界の stage.vars から読む（world.js が使う）。 */
export const varMul = (vars, id) => { const v = vars && vars[id]; return v === undefined ? 1 : v / 100; };

// ---------- ギミックの表 ----------
// params の 1 行：{id,label,kind:'num'|'bool'|'color'|'select',min,max,def,int,step,options}
const P = (id, label, o = {}) => ({ id, label, kind: 'num', int: true, ...o });
export const GIMMICKS = {
  lava: {
    label: 'マグマだまり', note: '床の穴。入ると主人公はダメージ、雑魚は溶ける（陸の敵は縁で止まる）。水位が上下して池が広がる',
    params: [P('period', '水位の周期（秒）', { min: 3, max: 30, def: 8, int: false, step: 0.5 }), P('dmg', '池に入ったダメージ', { min: 1, max: 60, def: 14, opt: true })],
    list: { id: 'pools', label: '池', max: 4, item: [P('x', '中心 x', { min: 120, max: 1160, def: 640, step: 10 }), P('w', '幅', { min: 100, max: 300, def: 180, step: 10 }), P('sx', '背景の溶岩の x（省略可）', { min: 0, max: 1280, opt: true }), P('sw', '背景の溶岩の幅（省略可）', { min: 60, max: 400, opt: true })] },
  },
  water: {
    label: '水（水面と水中）', note: '水面より下が水。主人公は泳げる。陸の敵は水に落ちるともがいて消える（自分から落ちた分は数えない）。足場は浮きブロック（浮き石・流木・石板）',
    params: [P('y', '水面の高さ y', { min: 300, max: 700, def: 520, step: 10 }), P('sink', '沈む深さ（カメラが下へ続く量）', { min: 0, max: 900, def: 560, step: 10 }), { id: 'swimmers', label: '水の敵がいる', kind: 'bool', def: true }],
  },
  cliff: {
    label: '左右の断崖', note: '画面の左右を岩の壁でふさぐ（海の面の見た目）',
    params: [{ id: 'left', label: '左の断崖', kind: 'bool', def: true }, { id: 'right', label: '右の断崖', kind: 'bool', def: true }],
  },
  platforms: {
    label: '足場の見た目', note: '足場の色と、足場の種類の既定',
    params: [{ id: 'top', label: '上面の色', kind: 'color', def: '#8aa65a' }, { id: 'face', label: '側面の色', kind: 'color', def: '#4f5f33' }, { id: 'kind', label: '種類の既定', kind: 'select', options: KINDS, def: 'normal' }],
  },
  scroll: {
    label: '縦スクロール', note: '画面が上へ・下へ続く量。足場の高さに合わせて上は自動で増える',
    params: [P('rise', '上へ（rise）', { min: 0, max: RISE_MAX, def: 300, step: 10 }), P('sink', '下へ（sink）', { min: 0, max: 900, def: 0, step: 10 })],
  },
};
export const GIMMICK_TYPES = Object.keys(GIMMICKS);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const isStr = (v, max = 80) => typeof v === 'string' && v.length <= max;
const NAME_OK = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR_OK = /^#[0-9a-fA-F]{6}$/;

function cleanParam(p, v) {
  if (p.kind === 'bool') return v === undefined ? undefined : v === true;
  if (p.kind === 'color') return typeof v === 'string' && COLOR_OK.test(v) ? v : undefined;
  if (p.kind === 'select') return p.options.includes(v) ? v : undefined;
  if (v === undefined || v === null) return undefined;
  if (!num(v)) return undefined;
  const n = p.int === false ? Math.round(v * 100) / 100 : Math.round(v);
  return clampN(n, p.min, p.max);
}

/** ギミック1つを整える。ダメなら null。 */
export function cleanGimmick(g) {
  if (!g || typeof g !== 'object' || !own(GIMMICKS, g.type)) return null;
  const def = GIMMICKS[g.type], out = { type: g.type };
  for (const p of def.params) { const c = cleanParam(p, g[p.id]); if (c !== undefined) out[p.id] = c; else if (p.def !== undefined && !p.opt) out[p.id] = p.def; }
  if (def.list) {
    const raw = Array.isArray(g[def.list.id]) ? g[def.list.id] : [];
    const items = [];
    for (const it of raw.slice(0, def.list.max)) {
      if (!it || typeof it !== 'object') continue;
      const o = {};
      for (const p of def.list.item) { const c = cleanParam(p, it[p.id]); if (c !== undefined) o[p.id] = c; else if (p.def !== undefined && !p.opt) o[p.id] = p.def; }
      items.push(o);
    }
    if (!items.length) return null;      // 池が1つも無いマグマは意味が無い
    out[def.list.id] = items;
  }
  if (g.type === 'water') {
    if (Array.isArray(g.gaps)) {
      const gaps = [];
      for (const x of g.gaps.slice(0, LIMITS.gaps)) if (x && num(x.x0) && num(x.x1) && x.x1 > x.x0) gaps.push({ x0: clampN(Math.round(x.x0), 0, SCREEN_W), x1: clampN(Math.round(x.x1), 0, SCREEN_W) });
      if (gaps.length) out.gaps = gaps;
    }
    if (g.pit && typeof g.pit === 'object' && num(g.pit.y)) { out.pit = { y: clampN(Math.round(g.pit.y), 0, 3000) }; if (num(g.pit.dmg)) out.pit.dmg = clampN(Math.round(g.pit.dmg), 1, 99); }
  }
  return out;
}

export const defaultGimmick = (type) => {
  const def = own(GIMMICKS, type) ? GIMMICKS[type] : null;
  if (!def) return null;
  const g = { type };
  for (const p of def.params) if (p.def !== undefined) g[p.id] = p.def;
  if (def.list) g[def.list.id] = [Object.fromEntries(def.list.item.filter((p) => p.def !== undefined && !p.opt).map((p) => [p.id, p.def]))];
  return g;
};

// ---------- 敵の一覧（エディタの絵つきパレット用） ----------
/** 置ける敵の一覧。主人公は含めない。group: 'grunt'（雑魚）/ 'swim'（水の敵）/ 'boss'（ボス・ライバル）。 */
export function enemyCatalog() {
  const out = [];
  for (const [type, d] of Object.entries(DINOS)) {
    if (type === PLAYER) continue;
    const group = isBossLike(d) ? 'boss' : d.swim ? 'swim' : 'grunt';
    out.push({ type, label: d.label, group, flying: !!d.flying, swim: !!d.swim, hop: !!d.hop, artOf: d.artOf || null });
  }
  const order = { grunt: 0, swim: 1, boss: 2 };
  return out.sort((a, b) => order[a.group] - order[b.group]);
}
export const isSwimmer = (type) => !!(own(DINOS, type) && DINOS[type].swim);
export const isBossType = (type) => !!(own(DINOS, type) && isBossLike(DINOS[type]));

// ---------- 検証 ----------
function cleanBg(bg) {
  const out = {};
  const b = bg && typeof bg === 'object' ? bg : {};
  for (const k of ['back1', 'back2']) if (k in b) out[k] = b[k] === null || b[k] === undefined ? null : (typeof b[k] === 'string' && NAME_OK.test(b[k]) ? b[k] : null);
  for (const k of ['art', 'artDir', 'look']) if (typeof b[k] === 'string' && NAME_OK.test(b[k])) out[k] = b[k];
  if (b.proc === 'sea') out.proc = 'sea';
  for (const k of ['hl', 'wl']) if (num(b[k]) && b[k] > 0 && b[k] < 1) out[k] = b[k];
  if (num(b.hz)) out.hz = clampN(Math.round(b.hz), 0, 1400);
  return out;
}

function cleanEnemy(e, nPlat, warnings, where) {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.type !== 'string' || !own(DINOS, e.type) || e.type === PLAYER) { warnings.push(`${where}: 敵の種類「${e && e.type}」が不明（捨てました）`); return null; }
  if (!['left', 'right', 'top'].includes(e.from)) { warnings.push(`${where}: 出る側「${e.from}」が不正（捨てました）`); return null; }
  const out = { type: e.type, from: e.from };
  if (num(e.delay) && e.delay > 0) out.delay = clampN(Math.round(e.delay * 100) / 100, 0, 30);
  else out.delay = 0;
  if (e.delay === undefined) delete out.delay;
  if (num(e.x)) out.x = clampN(Math.round(e.x), 0, SCREEN_W);
  if (e.plat !== undefined && e.plat !== null) {
    if (Number.isInteger(e.plat) && e.plat >= 0 && e.plat < nPlat) out.plat = e.plat;
    else warnings.push(`${where}: 降りる足場 ${e.plat} が無い（地上に降ります）`);
  }
  return out;
}

function cleanWave(w, nPlat, warnings, wi) {
  if (!w || typeof w !== 'object' || !Array.isArray(w.enemies)) return null;
  const out = { delay: num(w.delay) ? clampN(Math.round(w.delay * 100) / 100, 0, 60) : 1 };
  if (num(w.until) && w.until > 0) out.until = clampN(Math.round(w.until), 0, 24);
  if (w.swarm === true) out.swarm = true;
  out.enemies = [];
  for (const e of w.enemies.slice(0, LIMITS.enemiesPerWave)) {
    const c = cleanEnemy(e, nPlat, warnings, `波${wi + 1}`);
    if (c) out.enemies.push(c);
  }
  if (w.enemies.length > LIMITS.enemiesPerWave) warnings.push(`波${wi + 1}: 敵が多すぎる（上限 ${LIMITS.enemiesPerWave}）。あふれた分は捨てました`);
  return out.enemies.length ? out : null;
}

/**
 * パッケージを検証して、きれいな形にして返す。{ pkg, warnings } か { error }。
 * 方針：形が根本的に違えば error（読み込まない）。細かい不正（知らない敵・足場の番号の誤り）は捨てて warnings に残し、残りで読む。
 */
//   2026-11-15：strict＝保存するとき（受け口 package_server・エディタの保存）。保存のときだけ断る決まり（id「index」・水の敵だけの面で「水の敵がいる」を外す）は、
//   読み込み（loadPackages）では注意にとどめる＝前の版で保存した面が、黙って消えて自作の面の並びがずれないように
export function cleanPackage(raw, { strict = false } = {}) {
  const warnings = [];
  let r = raw;
  if (typeof raw === 'string') { try { r = JSON.parse(raw); } catch (e) { return { error: 'JSON として読めない' }; } }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: '形が違う（オブジェクトでない）' };
  if (r.version !== PKG_VERSION) return { error: `version が ${PKG_VERSION} でない（${r.version}）` };
  if (typeof r.id !== 'string' || !PKG_ID_RE.test(r.id)) return { error: `id「${r.id}」が不正（半角英数と - _ で 32 文字まで）` };
  if (strict && r.id.toLowerCase() === 'index') return { error: 'id「index」は使えません（一覧のファイル index.json と同じ名前になり、保存しても消える）' };      // 2026-11-14
  if (r.replaces !== null && r.replaces !== undefined && !(typeof r.replaces === 'string' && KEY_RE2.test(r.replaces))) return { error: `replaces「${r.replaces}」が不正（面の鍵：1-1〜7-1・S1〜S4）` };
  const s = r.stage;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { error: 'stage が無い' };
  const m = r.meta && typeof r.meta === 'object' ? r.meta : {};
  const meta = {};
  for (const k of ['name', 'basedOn', 'savedAt', 'createdAt']) if (isStr(m[k], LIMITS.name + 40)) meta[k] = m[k];      // 2026-11-14：createdAt＝最初に保存した時刻（自作の面の並びに使う。保存のたびに変わらない）
  if (m.author === 'nao') meta.author = 'nao';

  const st = {};
  st.name = isStr(s.name, LIMITS.name) && s.name.trim() ? s.name.trim() : (meta.name || r.id);
  if (s.boss === true) st.boss = true;
  if (s.final === true && r.replaces) st.final = true;      // 最終面の印は、既存の面の置き換えのときだけ（ユーザー作の面はいつも「最後の面」を自動で決める）
  if (isStr(s.hint, LIMITS.hint) && s.hint) st.hint = s.hint;
  const bgmKey = typeof s.bgm === 'string' ? ((own(BGM_LEGACY, s.bgm) ? BGM_LEGACY[s.bgm] : null) || s.bgm) : '';       // 版3.5：古いキー(area1〜3)は地域名のキーへ読み替える
  st.bgm = own(BGM, bgmKey) ? bgmKey : 'area_jungle';
  st.bg = cleanBg(s.bg);
  if (num(s.bgY)) st.bgY = clampN(Math.round(s.bgY), -400, 400);
  st.groundY = num(s.groundY) ? clampN(Math.round(s.groundY), 400, 1500) : 600;
  st.clearHeal = num(s.clearHeal) ? clampN(Math.round(s.clearHeal), 0, 200) : 25;
  st.timeLimit = num(s.timeLimit) ? clampN(Math.round(s.timeLimit), 30, 999) : 180;
  if (num(s.bossHp)) st.bossHp = clampN(Math.round(s.bossHp * 100) / 100, 0.1, 5);      // 版3.7：ボス級だけの体力の掛け率（省略可。公式面でボスを入れ替えたときの曲線の保ち）
  if (s.curve !== undefined && ((Number.isInteger(s.curve) && s.curve >= 1 && s.curve <= 7) || (typeof s.curve === 'string' && /^after:[1-6]$/.test(s.curve)))) st.curve = s.curve;

  // 足場
  st.platforms = [];
  for (const p of Array.isArray(s.platforms) ? s.platforms.slice(0, LIMITS.platforms) : []) {
    if (!p || !num(p.x) || !num(p.y) || !num(p.w)) { warnings.push('足場の形が不正（捨てました）'); continue; }
    const q = { x: clampN(Math.round(p.x), 0, SCREEN_W - GRID.w), y: clampN(Math.round(p.y), -600, 1500), w: clampN(Math.round(p.w), GRID.w, 480) };
    if (KINDS.includes(p.kind) && p.kind !== 'normal') q.kind = p.kind;
    st.platforms.push(q);
  }
  if (Array.isArray(s.platforms) && s.platforms.length > LIMITS.platforms) warnings.push(`足場が多すぎる（上限 ${LIMITS.platforms}）`);
  const nPlat = st.platforms.length;
  if (s.start && typeof s.start === 'object') {
    st.start = { x: num(s.start.x) ? clampN(Math.round(s.start.x), 40, SCREEN_W - 40) : 150 };
    if (Number.isInteger(s.start.plat) && s.start.plat >= 0 && s.start.plat < nPlat) st.start.plat = s.start.plat;
    else if (s.start.plat !== undefined && s.start.plat !== null) warnings.push('主人公の出発の足場が無い（地面から始めます）');
    if (s.start.carry === true) st.start.carry = true;      // 前の面（海）の深さを引き継ぐ（水のある面だけ意味がある）
  }
  // 波
  st.waves = [];
  const rw = Array.isArray(s.waves) ? s.waves : [];
  rw.slice(0, LIMITS.waves).forEach((w, i) => { const c = cleanWave(w, nPlat, warnings, i); if (c) st.waves.push(c); else warnings.push(`波${i + 1}: 敵が1体も無い／形が不正（捨てました）`); });
  if (rw.length > LIMITS.waves) warnings.push(`波が多すぎる（上限 ${LIMITS.waves}）`);
  if (!st.waves.length) return { error: '敵の波が1つも無い' };
  // ギミック（1種類につき1つ）
  const seen = new Set(), gs = [];
  for (const g of Array.isArray(s.gimmicks) ? s.gimmicks : []) {
    const c = cleanGimmick(g);
    if (!c) { warnings.push(`ギミック「${g && g.type}」が不正（捨てました）`); continue; }
    if (seen.has(c.type)) { warnings.push(`ギミック「${c.type}」が重複（あとのを捨てました）`); continue; }
    seen.add(c.type); gs.push(c);
  }
  if (seen.has('lava') && seen.has('water')) { warnings.push('マグマと水は同じ面に置けません（水を捨てました）'); const i = gs.findIndex((g) => g.type === 'water'); gs.splice(i, 1); }
  st.gimmicks = gs;
  if (!seen.has('water')) {      // 水のない面に水の敵を置いても、泳げず（位置が NaN になり）動かない・倒せない＝クリアできない面になる。水の敵は捨てる（2026-10-25 の変異 fuzz で見つかった）
    let dropped = 0;
    for (const w of st.waves) { const keep = w.enemies.filter((e) => !isSwimmer(e.type)); dropped += w.enemies.length - keep.length; w.enemies = keep; }
    if (dropped) { st.waves = st.waves.filter((w) => w.enemies.length); warnings.push(`水のない面なので、水の敵 ${dropped} 体を捨てました`); if (!st.waves.length) return { error: '水の敵だけの波で、水のギミックが無い（敵が 1 体も残らない）' }; }
  } else if (gs.some((g) => g.type === 'water' && g.swimmers === false) && st.waves.every((w) => w.enemies.every((e) => isSwimmer(e.type)))) {
    // 2026-11-14：「水の敵がいる」を外すと、遊ぶときに水の敵が全部消える（stageFromPackage）。水の敵だけの面では敵が 1 体も残らず、開始 0 秒で CLEAR!（ボス面は落ちた）。保存の前に止める（敵そのものはパッケージに残す＝入れ直せば戻る）
    if (strict) return { error: '「水の敵がいる」を外すと、敵が 1 体も残らない（水の敵だけの面）' };
    warnings.push('「水の敵がいる」が外れていて、敵が 1 体も残らない（水の敵だけの面）。エディタで直してください');
  }
  st.vars = cleanVars(s.vars);
  return { pkg: { version: PKG_VERSION, id: r.id, replaces: r.replaces || null, meta, stage: st }, warnings };
}

// ---------- 面 → パッケージ ----------
const clone = (o) => JSON.parse(JSON.stringify(o));

/** stages.js の面（arrangeStages 後）から、パッケージを作る（書き出し）。replaces を省くと鍵（stageKey）で置き換える面になる。 */
export function packageFromStage(st, { id = null, replaces = undefined, author = null, name = null, basedOn = null } = {}) {
  const key = replaces === undefined ? (st.user ? null : stageKey(st)) : replaces;
  const pid = id || (key ? `official-${String(key).toLowerCase()}` : `user-${Date.now().toString(36)}`);
  const gimmicks = [];
  const s = {
    name: st.name, bgm: st.bgm, bg: clone(st.bg), groundY: st.groundY, clearHeal: st.clearHeal, timeLimit: st.timeLimit,
    platforms: clone(st.platforms || []), waves: clone(st.waves || []),
  };
  if (st.boss) s.boss = true;
  if (st.final) s.final = true;
  if (st.hint) s.hint = st.hint;
  if (st.bgY !== undefined) s.bgY = st.bgY;
  if (st.start) s.start = clone(st.start);
  if (st.curve !== undefined && st.user) s.curve = st.curve;
  if (st.bossHp !== undefined) s.bossHp = st.bossHp;
  // ギミック
  gimmicks.push({ type: 'platforms', top: st.ledge ? st.ledge.top : '#8aa65a', face: st.ledge ? st.ledge.face : '#4f5f33' });
  gimmicks.push({ type: 'scroll', rise: st.rise || 0, ...(st.water ? {} : { sink: st.sink || 0 }) });
  if (st.lava) { const g = { type: 'lava', pools: clone(st.lava.pools), period: st.lava.period ?? 8 }; if (st.lava.dmg !== undefined) g.dmg = st.lava.dmg; gimmicks.push(g); }
  if (st.water) {
    const g = { type: 'water', y: st.water.y, sink: st.sink || 0, swimmers: true };
    if (st.gaps && st.gaps.length) g.gaps = clone(st.gaps);
    if (st.pit) g.pit = clone(st.pit);
    gimmicks.push(g);
    const c = st.cliff || { left: true, right: true };
    gimmicks.push({ type: 'cliff', left: c.left !== false, right: c.right !== false });
  } else if (st.cliff) gimmicks.push({ type: 'cliff', left: st.cliff.left !== false, right: st.cliff.right !== false });
  s.gimmicks = gimmicks;
  s.vars = cleanVars(st.vars);
  const meta = { name: st.name };
  if (author === 'nao') meta.author = 'nao';
  if (basedOn) meta.basedOn = basedOn;
  return { version: PKG_VERSION, id: pid, replaces: key || null, meta, stage: s };
}

// ---------- パッケージ → 面 ----------
const DEFAULT_SEA_BG = { proc: 'sea', look: 'noon', art: 'sea2', wl: 0.4525 };
const DEFAULT_LAVA_BG = { back1: null, back2: 'DBT_Map032', art: 'lava2', artDir: 'tall', hl: 0.569, hz: 300 };
const NEED_FIT_RISE = (platforms, groundY, water) => {
  if (!platforms.length) return 0;
  const base = water ? CAM_FEET : CAM_FEET;
  return Math.max(0, base - Math.min(...platforms.map((p) => p.y)));
};

/**
 * パッケージから、ゲームが読む面を作る。base＝置き換える面（id・world・n・area・label・curve・group をそのまま引き継ぐ）。
 * ユーザー作の面は base に { id, world, n, area, label, curve, user:true } を渡す。パッケージに無い項目は、面にも付かない（書き出し→読み込みで同じになる）。
 */
const SEA_FEET_Y = 680;      // 海の面で、海底に立った足の画面上の高さの限り（画面の高さ 720 の下から 40px）
export function stageFromPackage(pkg, base = {}) {
  const s = pkg.stage;
  const st = {};
  for (const k of ['id', 'world', 'n', 'area', 'label', 'curve', 'group', 'keyId']) if (base[k] !== undefined) st[k] = base[k];
  st.name = s.name;
  if (s.boss) st.boss = true;
  if (s.final) st.final = true;
  // 2026-11-15：公式の最後の面を置き換えるときは、パッケージに final が無くても最後の面の印を引き継ぐ（前は印が落ち、クリアのあと次の面が無い面送りへ進んで止まった）
  if (base.final && !base.user && PKG_FIX.keepFinal) st.final = true;
  if (s.hint) st.hint = s.hint;
  const g = {};
  for (const x of s.gimmicks || []) g[x.type] = x;
  st.bg = clone(s.bg);
  if (s.bgY !== undefined) st.bgY = s.bgY;
  st.groundY = s.groundY;
  const pg = g.platforms;
  st.ledge = { top: pg ? pg.top : '#8aa65a', face: pg ? pg.face : '#4f5f33' };
  st.platforms = clone(s.platforms).map((p) => (pg && pg.kind && pg.kind !== 'normal' && !p.kind ? { ...p, kind: pg.kind } : p));
  if (g.scroll) { st.rise = g.scroll.rise; if (!g.water && g.scroll.sink) st.sink = g.scroll.sink; }
  else st.rise = 0;
  if (s.start) st.start = clone(s.start);
  if (g.lava) {
    st.lava = { pools: clone(g.lava.pools), period: g.lava.period };
    if (g.lava.dmg !== undefined) st.lava.dmg = g.lava.dmg;
    if (!(st.bg.hz > 0)) { const b = { ...DEFAULT_LAVA_BG }; if (!st.bg.art) st.bg = { ...st.bg, ...b }; else st.bg.hz = 300; }
    for (const p of st.lava.pools) { if (p.sx === undefined) p.sx = p.x; if (p.sw === undefined) p.sw = Math.round(p.w * 1.1); }
  }
  if (g.water) {
    st.water = { y: g.water.y };
    // 2026-11-14：海底（groundY）に立った足が画面に入る深さより浅くしない（足が画面の下から 40px の所＝公式の海の面と同じ。1240−680＝560）。
    // 前は 0 まで下げられて、海底の主人公が画面の外（y≈999）になり見えなかった
    st.sink = Math.max(g.water.sink || 0, (st.groundY || 0) - SEA_FEET_Y);
    if (g.water.gaps) st.gaps = clone(g.water.gaps);
    if (g.water.pit) st.pit = clone(g.water.pit);
    if (!st.bg.proc) st.bg = { ...DEFAULT_SEA_BG };
  }
  if (g.water) {      // 海の面の既定は両側の断崖。両側ある（従来の海の面と同じ）なら持たない。断崖のギミックが無ければ、壁なし
    const c = g.cliff ? { left: g.cliff.left !== false, right: g.cliff.right !== false } : { left: false, right: false };
    if (!(c.left && c.right)) st.cliff = c;
  } else if (g.cliff) st.cliff = { left: g.cliff.left !== false, right: g.cliff.right !== false };
  st.bgm = s.bgm;
  st.clearHeal = s.clearHeal;
  st.timeLimit = s.timeLimit;
  if (s.bossHp !== undefined) st.bossHp = s.bossHp;
  st.waves = clone(s.waves);
  if (!g.water) st.waves = st.waves.map((w) => ({ ...w, enemies: w.enemies.filter((e) => !isSwimmer(e.type)) })).filter((w) => w.enemies.length);      // 水のない面に水の敵は置けない（cleanPackage を通さない呼び出しの用心）
  if (g.water && g.water.swimmers === false) st.waves = st.waves.map((w) => ({ ...w, enemies: w.enemies.filter((e) => !isSwimmer(e.type)) })).filter((w) => w.enemies.length);      // 水の敵なし
  if (base.user) {      // ユーザー作の面は、いちばん高い足場に立ったときの足の高さが画面に入るよう rise を増やす（減らさない）
    const need = NEED_FIT_RISE(st.platforms, st.groundY, !!st.water);
    if (need > (st.rise || 0)) st.rise = need;
  }
  const vars = cleanVars(s.vars);
  if (Object.keys(vars).length) st.vars = vars;
  st.pkg = { id: pkg.id, replaces: pkg.replaces || null, user: !!base.user, author: pkg.meta && pkg.meta.author === 'nao' ? 'nao' : null };
  if (base.user) { st.user = true; st.pkgId = pkg.id; if (base.userEnd) st.userEnd = true; }
  return st;
}

/**
 * 面の配列にパッケージを当てる。replaces のあるものは該当の面を置き換え、無いものは「ユーザー作の面」としてあとに並べる（U-1, U-2 …）。
 * 落ちない：壊れたパッケージ・該当の面が無いものは無視して errors に残す。areas（stages.js の AREAS）を渡すと、ユーザー作の面のワールドの名前を足す。
 */
export function applyPackages(stages, pkgs, areas = null) {
  const out = stages.slice();
  const applied = [], errors = [];
  const list = (pkgs || []).filter(Boolean);
  for (const pkg of list.filter((p) => p.replaces)) {
    const i = out.findIndex((s) => !s.user && stageKey(s) === pkg.replaces);
    if (i < 0) { errors.push(`${pkg.id}: 置き換える面「${pkg.replaces}」が無い`); continue; }
    try { out[i] = stageFromPackage(pkg, out[i]); applied.push(pkg.id); } catch (e) { errors.push(`${pkg.id}: ${e.message}`); }
  }
  // 2026-11-14：最初に保存した時刻（createdAt）の順。前は savedAt（保存のたびに今の時刻になる）の順で、U-1 を直して保存すると最後へ回り、最後の面の印（クリアでタイトルへ）も付け替わった
  const made = (p) => p.meta.createdAt || p.meta.savedAt || '';
  const users = list.filter((p) => !p.replaces).sort((a, b) => made(a).localeCompare(made(b)) || a.id.localeCompare(b.id));
  const world = Math.max(0, ...stages.map((s) => s.world || 0)) + 1;
  if (users.length && areas) areas[world] = { name: `WORLD U  ${USER_WORLD_NAME}` };
  users.forEach((pkg, k) => {
    try {
      const base = { id: out.length + 1, world, n: k + 1, area: world, label: `U-${k + 1}`, curve: pkg.stage.curve ?? 4, group: 'user', user: true, userEnd: k === users.length - 1 };
      out.push(stageFromPackage(pkg, base)); applied.push(pkg.id);
    } catch (e) { errors.push(`${pkg.id}: ${e.message}`); }
  });
  return { stages: out, applied, errors };
}

// ---------- ゲーム側の読み込み ----------
export function decodePkgParam(s) {
  try {
    const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch (e) { return null; }
}
export function encodePkgParam(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

/**
 * ファイル（data/stage_packages/index.json の ids と各 <id>.json）と、試し遊び（?package=local＝localStorage／?package=<base64url>）を読む。
 * 読めない・壊れたものは無視（console.warn だけ。例外は出さない）。戻り値 { pkgs, errors }。
 */
export async function loadPackages(params, { fetchImpl = (typeof fetch === 'function' ? fetch : null), storage = null, base = '' } = {}) {
  const pkgs = new Map(), errors = [];
  const take = (raw, from) => {
    const r = cleanPackage(raw);
    if (r.error) { errors.push(`${from}: ${r.error}`); return; }
    pkgs.set(r.pkg.id, r.pkg);
  };
  try {
    if (fetchImpl) {
      const r = await fetchImpl(`${base}${PKG_DIR}/index.json`, { cache: 'no-store' });
      if (r && r.ok) {
        let idx = null; try { idx = JSON.parse(await r.text()); } catch (e) { errors.push('index.json が読めない'); }
        const ids = idx && Array.isArray(idx.ids) ? idx.ids.filter((x) => typeof x === 'string' && PKG_ID_RE.test(x)).slice(0, 200) : [];
        // 2026-11-14：読み込みは並べて行うが、当てるのは index.json の順（前は通信の終わった順で、同じ面を置き換えるパッケージが 2 つあると、どちらが勝つかが毎回変わった）
        const texts = await Promise.all(ids.map(async (id) => {
          try { const f = await fetchImpl(`${base}${PKG_DIR}/${id}.json`, { cache: 'no-store' }); if (f && f.ok) return [id, await f.text()]; errors.push(`${id}: 読めない`); } catch (e) { errors.push(`${id}: 読めない`); }
          return null;
        }));
        for (const t of texts) if (t) take(t[1], t[0]);
      }
    }
  } catch (e) { /* 読めなければ従来どおり */ }
  try {
    const p = params && params.get ? params.get('package') : null;
    if (p) {
      let pv = null;
      if (p === 'local') { const st = storage || localStorage; pv = JSON.parse(st.getItem(PREVIEW_PKG_KEY)); }
      else pv = decodePkgParam(p);
      const arr = pv && Array.isArray(pv.packages) ? pv.packages : pv && pv.id ? [pv] : [];
      for (const x of arr.slice(0, 20)) take(x, '試し遊び');
    }
  } catch (e) { /* 試し遊びが読めなければ無視 */ }
  return { pkgs: [...pkgs.values()], errors };
}

/** 面の配列にファイルと試し遊びのパッケージを反映して返す。 */
export async function loadPackageStages(stages, params, opts = {}) {
  const { pkgs, errors } = await loadPackages(params, opts);
  const r = applyPackages(stages, pkgs, opts.areas || null);
  return { stages: r.stages, applied: r.applied, errors: [...errors, ...r.errors] };
}

// ---------- 新規・複製・ギミックのコピー ----------
const PLAT_STEP = 165, PLAT_GROUND = 600;
const plat = (x, tier, w = 190) => ({ x, y: PLAT_GROUND - PLAT_STEP * tier, w });
/** 新しい面のひな型。kind: 'land'（草原）/ 'lava'（マグマの面）/ 'sea'（海の面）/ 'boss'（ボス面）。 */
export function newStagePackage(kind = 'land', { id = null, name = null, author = null } = {}) {
  const pid = id || `user-${Date.now().toString(36)}`;
  const A = 'Allosaurus', T = 'Triceratops', V = 'VelociraptorR', P = 'Pteranodon';
  const base = {
    name: name || ({ land: '新しい草原の面', lava: '新しいマグマの面', sea: '新しい海の面', boss: '新しいボスの面' }[kind] || '新しい面'),
    bgm: 'area_jungle', bg: { back1: null, back2: 'DBT_Grassland' }, groundY: 600, clearHeal: 25, timeLimit: 180,
    platforms: [plat(260, 1), plat(820, 1), plat(540, 2)],
    start: { x: 150 },
    waves: [
      { delay: 1.0, enemies: [{ type: A, from: 'left' }, { type: A, from: 'right', delay: 0.7 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [{ type: V, from: 'right' }, { type: V, from: 'right', delay: 0.4 }, { type: V, from: 'right', delay: 0.8 }] },
      { delay: 0.6, until: 1, enemies: [{ type: T, from: 'left' }, { type: P, from: 'right', delay: 1.0 }] },
    ],
    gimmicks: [{ type: 'platforms', top: '#8aa65a', face: '#4f5f33' }, { type: 'scroll', rise: 330, sink: 0 }],
    vars: {},
  };
  if (kind === 'lava') {
    base.bg = clone(DEFAULT_LAVA_BG); base.bgm = 'area_volcano';
    base.gimmicks.push({ type: 'lava', pools: [{ x: 640, w: 180, sx: 640, sw: 60 }], period: 8, dmg: 14 });
    base.gimmicks[0] = { type: 'platforms', top: '#a98d6a', face: '#5d4a34' };
  } else if (kind === 'sea') {
    const I = 'Ichthyosaurus';
    base.bg = clone(DEFAULT_SEA_BG); base.bgm = 'area_sea'; base.groundY = 1240;
    base.platforms = [{ x: 100, y: 490, w: 190, kind: 'float' }, { x: 990, y: 490, w: 190, kind: 'float' }, { x: 410, y: 385, w: 190, kind: 'drift' }, { x: 380, y: 880, w: 190, kind: 'reef' }];
    base.start = { x: 150, plat: 0, carry: true };
    base.waves = [
      { delay: 1.0, enemies: [{ type: A, from: 'left', plat: 0 }, { type: I, from: 'right', delay: 0.8 }, { type: I, from: 'left', delay: 1.6 }] },
      { delay: 0.8, until: 1, enemies: [{ type: T, from: 'right', plat: 1 }, { type: I, from: 'left', delay: 1.0 }, { type: I, from: 'right', delay: 1.8 }] },
    ];
    base.gimmicks = [{ type: 'platforms', top: '#d9dfe0', face: '#6d7a85' }, { type: 'scroll', rise: 180 }, { type: 'water', y: 520, sink: 560, swimmers: true }, { type: 'cliff', left: true, right: true }];
  } else if (kind === 'boss') {
    base.boss = true; base.bgm = 'boss1'; base.bg = { back1: null, back2: 'DBT_Ruins' }; base.clearHeal = 40;
    base.platforms = [plat(130, 1), plat(960, 1)];
    base.gimmicks[1] = { type: 'scroll', rise: 300, sink: 0 };
    base.waves = [
      { delay: 2.4, enemies: [{ type: 'SkeletonRex', from: 'right' }] },
      { delay: 9, until: 1, swarm: true, enemies: [{ type: V, from: 'left' }, { type: V, from: 'right', delay: 0.4 }, { type: A, from: 'left', delay: 0.9 }] },
    ];
  }
  const meta = { name: base.name }; if (author === 'nao') meta.author = 'nao';
  const r = cleanPackage({ version: PKG_VERSION, id: pid, replaces: null, meta, stage: base });
  return r.pkg;
}

/** パッケージを複製して新しい面（ユーザー作）にする。 */
export function duplicatePackage(pkg, { id = null, name = null, author = undefined } = {}) {
  const c = clone(pkg);
  c.id = id || `user-${Date.now().toString(36)}`;
  c.replaces = null;
  c.meta = { ...c.meta, name: name || `${pkg.stage.name} のコピー`, basedOn: pkg.replaces || pkg.id };
  delete c.meta.savedAt; delete c.meta.createdAt;      // 写しは新しい面（並びも最初の保存から）
  if (author !== undefined) { if (author === 'nao') c.meta.author = 'nao'; else delete c.meta.author; }
  c.stage.name = c.meta.name;
  delete c.stage.final;
  if (c.stage.curve === undefined) c.stage.curve = undefined;
  return cleanPackage(c).pkg;
}

/** from の面（パッケージの stage）のギミック type を、to の stage へコピーする（同じ種類があれば置き換える）。コピーできたら true。 */
export function copyGimmick(fromStage, toStage, type) {
  const g = (fromStage.gimmicks || []).find((x) => x.type === type);
  if (!g) return false;
  const c = cleanGimmick(clone(g));
  if (!c) return false;
  toStage.gimmicks = (toStage.gimmicks || []).filter((x) => x.type !== type);
  if (type === 'lava') toStage.gimmicks = toStage.gimmicks.filter((x) => x.type !== 'water');
  if (type === 'water') toStage.gimmicks = toStage.gimmicks.filter((x) => x.type !== 'lava');
  toStage.gimmicks.push(c);
  return true;
}

/** 履歴・学習用の要約。 */
export function summarizePackage(pkg) {
  const s = pkg.stage;
  const enemies = s.waves.reduce((a, w) => a + w.enemies.length, 0);
  const types = {};
  for (const w of s.waves) for (const e of w.enemies) types[e.type] = (types[e.type] || 0) + 1;
  return { platforms: s.platforms.length, waves: s.waves.length, enemies, types, gimmicks: (s.gimmicks || []).map((g) => g.type), vars: s.vars || {}, boss: !!s.boss, onPlatform: s.waves.reduce((a, w) => a + w.enemies.filter((e) => e.plat !== undefined).length, 0) };
}

/** 比較用：面を並びの決まった JSON 文字列にする（pkg など読み込みの印は含めない）。 */
export function stageSignature(st) {
  const drop = new Set(['pkg', 'user', 'pkgId', 'userEnd', 'layout']);
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = norm(v[k]); return o; }
    return v;
  };
  const o = {};
  for (const k of Object.keys(st)) if (!drop.has(k)) o[k] = st[k];
  return JSON.stringify(norm(o));
}
/** 面の敵の総数（waves の全 enemies）。 */
export const totalEnemies = (st) => (st.waves || []).reduce((a, w) => a + (w.enemies || []).length, 0);
