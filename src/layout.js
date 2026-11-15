// 版3.1：足場の「1ブロック」定義と、面ごとの足場の配置データ（data/stage_layouts.json）の読み込み層。
// 面エディタ（editor/）・ゲーム（src/game.js）・検査（tools/check.mjs）が同じこのファイルを使う（画面や DOM は触らない）。
//
// 1ブロック＝幅 GRID.w(48px) × 高さ GRID.h(24px) の1マス。足場は、横に隣り合うブロック（同じ段・同じ種類）の連なり。
// 配置データの形：{ version:1, stages:{ "<面の鍵>": { blocks:[{gx,gy,kind,g?}], meta:{label,name,author,savedAt} } } }
//   面の鍵＝stageKey(st)：陸の面は「元のワールド番号-面の番号」（1-1〜6-4、ライバル戦 7-1）／海の面は「S1〜S4」。
//   海を入れる場所（SEA_AFTER_WORLD）を変えて表示の番号が変わっても、鍵は変わらない。
//   gx,gy＝格子の座標（x = gx*48、上面の y = gy*24。gy は負でもよい＝高い足場）。kind＝'normal'（陸）／'float' 'drift' 'reef'（海）／'lava_edge'（溶岩の縁）。
//   g＝もとの足場の番号（stages.js の platforms の添字）。面の waves の plat（敵の降りる足場）・start.plat は、この番号で足場を指す。
//     足場を消す・足す・つなぐ、で添字が変わっても、g を頼りに指し直す（指す足場が消えたら plat は外れて地上に降りる）。
// この層は stages.js を書き換えない。読み込み後に applyLayouts でマージするだけ（データが無い・壊れている面は従来どおり）。

import { JUMP_REACH, BIG_REACH, reachGap, canJump, kindOfReach } from './jumpguide.js';

export const GRID = { w: 48, h: 24 };
export const KINDS = ['normal', 'float', 'drift', 'reef', 'lava_edge'];
export const KIND_LABEL = { normal: '地上の足場', float: '海：浮き石', drift: '海：流木', reef: '海：石板', lava_edge: '溶岩の縁' };
export const SCREEN_W = 1280, SCREEN_H = 720;
export const GX_MAX = SCREEN_W / GRID.w - 1;      // 25（ブロックは画面の横の内側だけ）
export const GY_MIN = -60, GY_MAX = 60;
export const MAX_BLOCKS = 240;      // 1面のブロックの上限
// 版3.1（足場の見直し）の決まり。tools/check.mjs が全面に掛ける（数はここ1か所。stages.js の PLAT_STEP と同じ165は editor_test が確かめる）
export const PLAT_STEP = 165;      // 足場の段の刻み（ふつうのジャンプの頂点は約207px）
export const PLAT_MAX_COUNT = 4;   // 1面の足場（陸＝全部／海＝水の上だけ）の上限。コンボの邪魔にならない少なさ
export const PLAT_MAX_W = 200;     // 足場の幅の上限（＝4ブロック192px まで）
export const MAX_BLOCKS_PER_PLATFORM = Math.floor(PLAT_MAX_W / 48);
export const MIN_PLATFORM_BLOCKS = 2;      // 足場の幅 ≥ 80px（check.mjs の規則）＝2ブロック以上

// check.mjs と同じ式・同じ数（check.mjs はここから読む＝1か所）
// 届く基準は src/jumpguide.js の1か所（実際のジャンプの軌道）。高さの上限 JUMP_REACH(190・実際は約207から余裕)・BIG_REACH(360・実際は約401から余裕)と、高さごとの横の上限 reachGap／canJump。
export { JUMP_REACH, BIG_REACH, reachGap, canJump };
export const JUMP_ACTUAL = 207, BIG_ACTUAL = 401;      // 表示用の実際の高さ
export const CAM_FEET = 450, RISE_MAX = 720, SEA_REACH = 150;

/** 面の鍵（保存の宛先）。 */
export function stageKey(st) {
  if (st.user) return `U:${st.pkgId || st.label}`;      // 版3.3：ユーザー作の面（パッケージの中に足場を持つ）。layouts の鍵（KEY_RE）には合わないので、配置データは当たらない
  if (st.keyId) return st.keyId;      // 版3.8：面の再編（世界の並び替え）で表示の番号・難しさの鍵が変わっても、保存の鍵は変えない（arrangeStages が付ける元の「ワールド-面」／海は S1〜S4）
  if (st.group === 'sea' || (typeof st.curve === 'string' && st.curve.startsWith('after:'))) return `S${st.n}`;
  const w = typeof st.curve === 'number' ? st.curve : st.world;
  return `${w}-${st.n}`;
}
export const KEY_RE = /^([1-9]-[1-9]|S[1-9])$/;

/** 届く足場の集合（check.mjs の reachSet と同じ）。reachUp＝JUMP_REACH か BIG_REACH（'normal'|'big' でもよい）。高さと横の上限は jumpguide.js の実際の軌道。 */
export function reachSetOf(plats, st, reachUp) {
  const sea = !!st.water, kind = kindOfReach(reachUp);
  const reach = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    plats.forEach((p, i) => {
      if (reach.has(i)) return;
      let ok = sea ? (p.y >= st.water.y || st.water.y - p.y <= SEA_REACH) : canJump(kind, st.groundY - p.y, 0, true);
      if (!ok) {
        for (const j of reach) {
          const q = plats[j];
          const gapX = Math.max(0, Math.max(p.x - (q.x + q.w), q.x - (p.x + p.w)));
          if (canJump(kind, q.y - p.y, gapX)) { ok = true; break; }
        }
      }
      if (ok) { reach.add(i); grew = true; }
    });
  }
  return reach;
}

const isInt = (v) => Number.isInteger(v);

// ---------- 足場 ⇄ ブロック ----------
/** 足場（x,y,w）を格子に吸着したブロックの並びにする。g＝足場の添字。幅は四捨五入で最低1ブロック。 */
export function platformsToBlocks(platforms) {
  const out = [];
  platforms.forEach((p, g) => {
    const gx = Math.max(0, Math.min(GX_MAX, Math.round(p.x / GRID.w)));
    const n = Math.max(1, Math.min(GX_MAX + 1 - gx, Math.round(p.w / GRID.w)));
    const gy = Math.round(p.y / GRID.h);
    const kind = KINDS.includes(p.kind) ? p.kind : 'normal';
    for (let i = 0; i < n; i++) out.push({ gx: gx + i, gy, kind, g });
  });
  return out;
}

/**
 * ブロックを足場にまとめる。同じ段で隣り合い、同じ種類のブロックは1枚の足場（幅＝ブロック数×48）。離れていれば別の足場。
 * 戻り値 { platforms:[{x,y,w,kind?,gs:[..]}], indexOfG:Map(g→足場の添字) }。並びは、もとの番号 g のある足場を g の小さい順に、新しい足場はそのあとに（上の段が後ろ）。
 */
export function mergeBlocks(blocks) {
  const cell = new Map();
  for (const b of blocks) cell.set(`${b.gx},${b.gy}`, b);      // 同じマスは後のが勝つ
  const list = [...cell.values()].sort((a, b) => a.gy - b.gy || a.gx - b.gx);
  const runs = [];
  for (const b of list) {
    const last = runs[runs.length - 1];
    if (last && last.gy === b.gy && last.kind === b.kind && last.gx1 + 1 === b.gx) { last.gx1 = b.gx; if (b.g !== undefined) last.gs.push(b.g); }
    else runs.push({ gy: b.gy, kind: b.kind, gx0: b.gx, gx1: b.gx, gs: b.g !== undefined ? [b.g] : [] });
  }
  const minG = (r) => (r.gs.length ? Math.min(...r.gs) : Infinity);
  runs.sort((a, b) => (minG(a) === minG(b) ? b.gy - a.gy || a.gx0 - b.gx0 : minG(a) - minG(b)));
  const indexOfG = new Map();
  const platforms = runs.map((r, i) => {
    for (const g of r.gs) if (!indexOfG.has(g)) indexOfG.set(g, i);
    const p = { x: r.gx0 * GRID.w, y: r.gy * GRID.h, w: (r.gx1 - r.gx0 + 1) * GRID.w };
    if (r.kind && r.kind !== 'normal') p.kind = r.kind;
    p.gs = [...new Set(r.gs)];
    return p;
  });
  return { platforms, indexOfG };
}

// ---------- 配置データの検証 ----------
/** 1面ぶんのデータを検証して、きれいな形にして返す。ダメなら { error }。 */
export function cleanEntry(entry) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.blocks)) return { error: 'blocks が配列でない' };
  if (entry.blocks.length > MAX_BLOCKS) return { error: `ブロックが多すぎる（${entry.blocks.length}。上限 ${MAX_BLOCKS}）` };
  const blocks = [];
  for (const b of entry.blocks) {
    if (!b || typeof b !== 'object' || !isInt(b.gx) || !isInt(b.gy)) return { error: 'ブロックの gx・gy が整数でない' };
    if (b.gx < 0 || b.gx > GX_MAX) return { error: `gx が範囲外（${b.gx}。0〜${GX_MAX}）` };
    if (b.gy < GY_MIN || b.gy > GY_MAX) return { error: `gy が範囲外（${b.gy}。${GY_MIN}〜${GY_MAX}）` };
    const kind = b.kind === undefined ? 'normal' : b.kind;
    if (!KINDS.includes(kind)) return { error: `kind「${kind}」が不正` };
    if (b.g !== undefined && !(isInt(b.g) && b.g >= 0 && b.g < 100)) return { error: 'g が不正' };
    const c = { gx: b.gx, gy: b.gy, kind };
    if (b.g !== undefined) c.g = b.g;
    blocks.push(c);
  }
  const m = entry.meta && typeof entry.meta === 'object' ? entry.meta : {};
  const meta = {};
  for (const k of ['label', 'name', 'savedAt']) if (typeof m[k] === 'string') meta[k] = m[k].slice(0, 80);
  if (m.author === 'nao') meta.author = 'nao';
  const out = { blocks, meta };
  // 2026-11-15 決め6：触っていない足場の元の座標（keep＝[{g,x,y,w,kind?}]）。壊れた項目は黙って捨てる（無ければ従来どおり全部格子）
  if (Array.isArray(entry.keep)) {
    const keep = [];
    for (const k of entry.keep.slice(0, 100)) {
      if (!k || typeof k !== 'object' || !(isInt(k.g) && k.g >= 0 && k.g < 100)) continue;
      if (![k.x, k.y, k.w].every((v) => typeof v === 'number' && Number.isFinite(v)) || k.w <= 0 || Math.abs(k.x) > 5000 || Math.abs(k.y) > 5000 || k.w > 5000) continue;
      const c = { g: k.g, x: k.x, y: k.y, w: k.w };
      if (k.kind && k.kind !== 'normal' && KINDS.includes(k.kind)) c.kind = k.kind;
      keep.push(c);
    }
    if (keep.length) out.keep = keep;
  }
  return { entry: out };
}

/** ファイルの中身（文字列か読み込み済みの値）を読む。壊れていれば { stages:{}, error }。 */
export function parseLayoutData(src) {
  let d = src;
  if (typeof src === 'string') { try { d = JSON.parse(src); } catch (e) { return { stages: {}, error: 'JSON として読めない' }; } }
  if (!d || typeof d !== 'object' || !d.stages || typeof d.stages !== 'object' || Array.isArray(d.stages)) return { stages: {}, error: '形が違う（stages が無い）' };
  const stages = {};
  const errors = [];
  for (const [k, v] of Object.entries(d.stages)) {
    if (!KEY_RE.test(k)) { errors.push(`面の鍵「${k}」が不正`); continue; }
    const r = cleanEntry(v);
    if (r.error) errors.push(`${k}: ${r.error}`); else stages[k] = r.entry;
  }
  return { stages, errors: errors.length ? errors : undefined };
}

// ---------- 面へ反映 ----------
/** 1面に配置を反映した新しい面を返す（元の面は変えない）。 */
export function applyEntry(st, entry, opts = {}) {
  const { platforms: merged, indexOfG } = mergeBlocks(entry.blocks);
  const platforms = merged.map((p) => { const q = { x: p.x, y: p.y, w: p.w }; if (p.kind) q.kind = p.kind; return q; });
  const origIn = opts.orig || keepToOrig(entry.keep);      // エディタは doc.orig を直に渡す／配置データ経由（ゲーム・再構築）は entry.keep から
  if (origIn) keepUntouched(platforms, merged, origIn);      // 2026-11-15 決め6：触っていない足場は元の座標のまま
  // 版3.1：high（大ジャンプが要る足場）は作らない。ふつうのジャンプで届かない足場は tools/check.mjs が赤にする（エディタも赤で警告する）
  const remap = (plat) => (plat === undefined || plat === null ? plat : indexOfG.has(plat) ? indexOfG.get(plat) : undefined);
  const waves = (st.waves || []).map((w) => ({ ...w, enemies: (w.enemies || []).map((e) => {
    if (e.plat === undefined) return e;
    const n = { ...e }; const np = remap(e.plat);
    if (np === undefined) delete n.plat; else n.plat = np;
    return n;
  }) }));
  const out = { ...st, platforms, waves };
  if (st.start && st.start.plat !== undefined) {
    const np = remap(st.start.plat);
    out.start = { ...st.start };
    if (np === undefined) delete out.start.plat; else out.start.plat = np;
  }
  if (platforms.length) {      // いちばん高い足場に立ったときの足の高さが画面に入るよう、rise だけ必要なら増やす（減らさない）
    const need = CAM_FEET - Math.min(...platforms.map((p) => p.y));
    if (need > (st.rise || 0)) out.rise = need;      // RISE_MAX を超えるぶんは check.mjs とエディタが赤にする
  }
  out.layout = { key: stageKey(st), author: entry.meta.author || null };
  return out;
}


// ---------- 触っていない足場は元の座標のまま ----------
/**
 * 2026-11-15 決め6（Nao「A 触っていない足場は元の位置のまま保存するよう直す」）：
 * 面エディタで波やギミックだけ直して保存すると、公式の足場まで 48×24 の格子に吸い付いて数px〜20px動いていた（例：1-1 の [260,435,190]→[240,432,192]）。
 * false にすると直す前（全部格子へ吸着）の動きに戻る。
 */
export const PLAT_KEEP_FIX = { on: true };
/**
 * まとめた足場 merged のうち、「元の足場 orig[g] を格子に吸着したブロックそのまま（同じマス・同じ種類・その g だけ）」の連なりは、
 * 吸着前の元の座標（x,y,w）に戻す。動かした・足した・消した・つないだ足場は格子の位置のまま。platforms は書き換える（merged と同じ並び）。
 */
export function keepUntouched(platforms, merged, orig) {
  if (!PLAT_KEEP_FIX.on || !Array.isArray(orig)) return platforms;
  merged.forEach((p, i) => {
    if (p.gs.length !== 1) return;
    const o = orig[p.gs[0]]; if (!o) return;
    const snapped = mergeBlocks(platformsToBlocks([o])).platforms;
    const s = snapped[0];
    if (snapped.length !== 1 || s.x !== p.x || s.y !== p.y || s.w !== p.w || (s.kind || 'normal') !== (p.kind || 'normal')) return;
    platforms[i].x = o.x; platforms[i].y = o.y; platforms[i].w = o.w;
  });
  return platforms;
}
/** 配置データの keep（[{g,x,y,w,kind?}]）を、足場の番号 g で引ける疎な配列にする。無ければ null。 */
export function keepToOrig(keep) {
  if (!Array.isArray(keep) || !keep.length) return null;
  const o = [];
  for (const k of keep) if (k && Number.isInteger(k.g) && k.g >= 0) o[k.g] = k.kind ? { x: k.x, y: k.y, w: k.w, kind: k.kind } : { x: k.x, y: k.y, w: k.w };
  return o;
}
/** エディタの保存用：最終の足場 platforms のうち、格子に吸着すると座標が変わるもの（＝触っていない元の座標を持つもの）を keep にする。吸着で同じなら書かない。 */
export function keepForSave(platforms) {
  if (!PLAT_KEEP_FIX.on) return [];
  const keep = [];
  platforms.forEach((p, g) => {
    const s = mergeBlocks(platformsToBlocks([p])).platforms;
    if (s.length === 1 && s[0].x === p.x && s[0].y === p.y && s[0].w === p.w) return;
    const k = { g, x: p.x, y: p.y, w: p.w };
    if (p.kind && p.kind !== 'normal') k.kind = p.kind;
    keep.push(k);
  });
  return keep;
}
/** 面の配列に配置データを反映する。落ちない：壊れた面のデータは無視して従来のまま。 */
export function applyLayouts(stages, data) {
  const parsed = parseLayoutData(data);
  const applied = [];
  const errors = [...(parsed.error ? [parsed.error] : []), ...(parsed.errors || [])];
  const out = stages.map((st) => {
    const key = stageKey(st);
    const entry = parsed.stages[key];
    if (!entry) return st;
    try { const n = applyEntry(st, entry); applied.push(key); return n; } catch (e) { errors.push(`${key}: ${e.message}`); return st; }
  });
  return { stages: out, applied, errors };
}

// ---------- ゲーム側の読み込み（ブラウザ） ----------
/** base64url の JSON（?layout=...）を読む。読めなければ null。 */
export function decodeLayoutParam(s) {
  try {
    const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    const txt = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(txt);
  } catch (e) { return null; }
}
export function encodeLayoutParam(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const PREVIEW_KEY = 'dinoArtsLayoutPreview';

/**
 * 面の配列に、data/stage_layouts.json と、試し遊びの配置（?layout=local＝localStorage／?layout=<base64url>）を反映して返す。
 * ファイルが無い・壊れている・読めないときは、面をそのまま返す（エラーを出さない）。
 */
export async function loadLayoutStages(stages, params, { fetchImpl = (typeof fetch === 'function' ? fetch : null), storage = null, base = '' } = {}) {
  let cur = stages;
  try {
    if (fetchImpl) {
      const r = await fetchImpl(`${base}data/stage_layouts.json`, { cache: 'no-store' });
      if (r && r.ok) { const txt = await r.text(); cur = applyLayouts(cur, txt).stages; }
    }
  } catch (e) { /* 読めなければ従来どおり */ }
  try {
    const p = params && params.get ? params.get('layout') : null;
    if (p) {
      let pv = null;
      if (p === 'local') { const st = storage || localStorage; pv = JSON.parse(st.getItem(PREVIEW_KEY)); }
      else pv = decodeLayoutParam(p);
      if (pv) cur = applyLayouts(cur, pv && pv.stages ? pv : { version: 1, stages: pv }).stages;
    }
  } catch (e) { /* 試し遊びの配置が読めなければ無視 */ }
  return cur;
}

// ---------- 検査（check.mjs・editor が使う） ----------
/** 配置データを面に当てたあとの面について、エディタが出す警告（赤・黄）を返す。 */
export function inspectPlatforms(st, platforms = st.platforms) {
  const r0 = reachSetOf(platforms, st, JUMP_REACH), r1 = reachSetOf(platforms, st, BIG_REACH);
  return platforms.map((p, i) => ({
    reach: r0.has(i) ? 'normal' : r1.has(i) ? 'big' : 'none',
    narrow: p.w < MIN_PLATFORM_BLOCKS * GRID.w,
  }));
}

/** 配置の要約（履歴・法則の測定用）。platforms は applyEntry 後の足場。 */
export function summarize(st, platforms) {
  const n = platforms.length;
  const widths = platforms.map((p) => p.w);
  const avgW = n ? Math.round(widths.reduce((a, b) => a + b, 0) / n) : 0;
  const ys = [...new Set(platforms.map((p) => p.y))].sort((a, b) => b - a);
  const steps = [];
  const ground = st.groundY;
  let prev = ground;
  for (const y of ys) { steps.push(prev - y); prev = y; }      // 地面→最初の段→次の段…の高さの差
  // 左右対称：x=640 で折り返して、足場の占める横の範囲がどれだけ重なるか（0〜1。同じ段どうしで測る）
  let both = 0, tot = 0;
  for (const p of platforms) {
    const mx0 = SCREEN_W - (p.x + p.w), mx1 = SCREEN_W - p.x;
    tot += p.w;
    for (const q of platforms) if (q.y === p.y) both += Math.max(0, Math.min(mx1, q.x + q.w) - Math.max(mx0, q.x));
  }
  const symmetry = tot ? Math.round(Math.min(1, both / tot) * 100) / 100 : 0;
  // 足場どうしの横の間隔（同じ段の隣り合う足場の隙間）
  const gaps = [];
  for (const y of ys) {
    const row = platforms.filter((p) => p.y === y).sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) gaps.push(row[i].x - (row[i - 1].x + row[i - 1].w));
  }
  // 敵の降りる足場（plat 指定）の数と、地上から出る敵の数
  let onPlat = 0, ground0 = 0;
  for (const w of st.waves || []) for (const e of w.enemies || []) { if (e.plat !== undefined) onPlat++; else ground0++; }
  return { platforms: n, avgW, levels: ys.length, steps, gaps, symmetry, enemiesOnPlatform: onPlat, enemiesOnGround: ground0, start: st.start ? { x: st.start.x } : { x: 150 } };
}
