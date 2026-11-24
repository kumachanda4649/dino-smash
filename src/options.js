// 版2.0：オプション画面の設定（原作『ミスティックアーツ』のオプションに倣う）。
// 項目と値の範囲・保存と読み込みを1か所にまとめる。画面の描画は ui.js、反映は game.js。
//
// 原作との対応（根拠は STATE.md「オプション画面」）：
//   LEVEL         難しさ（原作のタイトルメニューの難易度）  → ダイノ：既存の3段階（difficulty.js）。保存は従来の dinoArtsDifficulty
//   SKIP          原作の意味は資料で確かめられず、Nao 判断で不採用（作らない）
//   BGM / SE      原作は on/off（0x51A5A0 / 0x51A5B0）           → ダイノ：音量 0〜5（0＝鳴らさない・5＝いままでの音量）
//   STAGE SELECT  原作は option bit1（ポーズ画面でステージを選べる） → ダイノ：スタートする面を 1-1〜8-4（全 32 面。版3.8 から海は 4-1〜4-4）から選ぶ
//   CP FREE       原作は option bit2（必殺ゲージが常に満タン＝原作では MP FREE）→ ダイノ：主人公の CP ゲージが常に満タンで消費なし（内部の名前 mpFree・保存のキーは互換のためそのまま）
//   COLLISION     原作は option bit0（当たり判定の箱を描くデバッグ表示、と読める）→ ダイノ：当たり判定（絵の形）の枠を表示
import { DISPLAY_SCALE } from './bignum.js';
import { stageKey } from './layout.js';
export const LEVEL_MAX = 5;          // BGM・SE の段階（0〜5）
export const STORAGE_KEY = 'dinoArtsOptions';
export const CMD_KEY = 'dinoArtsCmd';      // 2026-11-20：操作 A/B の控え（古い版のオプション保存が cmd を落としても戻せるように）

// 版3.7の公式面の並び。旧セーブの stage はこの並びでの配列番号。
const LEGACY_STAGE_KEYS = [1, 2, 3, 4, 'sea', 5, 6].flatMap((world) =>
  [1, 2, 3, 4].map((n) => world === 'sea' ? `S${n}` : `${world}-${n}`));
LEGACY_STAGE_KEYS.push('7-4');      // 旧最終面のライバル戦は、再編後にワールド内の4面目へ移動

export const DEFAULT_OPTIONS = Object.freeze({ bgm: LEVEL_MAX, se: LEVEL_MAX, stage: 0, mpFree: false, collision: false, playlog: true, numScale: DISPLAY_SCALE, cmd: 'sf' });      // cmd（2026-11-19）：操作方法 'sf'＝A（方向を順に入れる）／'tekken'＝B（方向＋ボタン）

/** 画面に並べる行（順番どおり）。kind: choice=難しさ / level=0〜5 / bool / stage / action */
export const OPTION_ROWS = [
  { id: 'level',     en: 'LEVEL',        jp: '難しさ',               kind: 'choice' },
  { id: 'bgm',       en: 'BGM',          jp: '曲の音量',             kind: 'level', pause: true, help: '0 で鳴らさない' },
  { id: 'se',        en: 'SE',           jp: '効果音の音量',         kind: 'level', pause: true, help: '0 で鳴らさない' },
  { id: 'stage',     en: 'STAGE SELECT', jp: 'スタートする面',       kind: 'stage', help: '選んだ面からはじまる（遊んだ回は「STAGE SELECT」の印が出る）' },
  { id: 'mpFree',    en: 'CP FREE',      jp: 'CP消費なし',            kind: 'bool',  pause: true, help: '主人公の CP ゲージが常に満タンで、技を出してもガードしても減らない（遊んだ回は「CP FREE」の印が出る）' },
  { id: 'collision', en: 'COLLISION',    jp: '当たり判定を見る',     kind: 'bool',  pause: true, help: '体と攻撃の当たる範囲を色つきの枠で表示（遊びの途中は H キーでも切り替え）' },
  { id: 'playlog',   en: 'PLAY LOG',     jp: '遊びの記録',           kind: 'bool',  help: '遊んだ内容（入力・技・ダメージなど）を、このパソコンの中だけに記録する。難しさや技の調整に使う（個人情報は入らない）' },
  { id: 'numScale', en: 'NUMBERS',      jp: '数字の大きさ',         kind: 'scale', help: 'ダメージと体力の「見える数字」だけを大きくする（×100）。中身の強さや計算は変わらない' },
  { id: 'cmd',       en: 'COMMAND',      jp: '技の入れ方',           kind: 'scale', pause: true, help: 'A＝方向を順に入れる（↓↓＋攻撃 など）　B＝方向を押しながらボタン（↓＋体当たり など）。B でも A の入れ方は使える' },
  { id: 'back',      en: 'EXIT',         jp: 'もどる',               kind: 'action', pause: true },
];

/** ポーズメニューの中のオプション：戦闘中に変えて意味のある行だけ（難しさ・スタートする面は次のゲームから効くので出さない）。 */
export const PAUSE_OPTION_ROWS = OPTION_ROWS.filter((r) => r.pause);

// 2026-11-15：null・真偽値・配列やオブジェクト・空白だけの文字列は既定へ（前は Number() で null→0・true→1 になり、壊れた保存で BGM が 0＝無音になった）
const clampInt = (v, a, b, d) => {
  if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'object' || (typeof v === 'string' && v.trim() === '')) return d;
  const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d;
};

/** どんな値が来ても、範囲内の設定に直す（壊れた保存・古い保存でも落ちない）。 */
export function normalizeOptions(o, stageCount = 32) {
  const s = (o && typeof o === 'object') ? o : {};
  return {
    bgm: clampInt(s.bgm, 0, LEVEL_MAX, DEFAULT_OPTIONS.bgm),
    se: clampInt(s.se, 0, LEVEL_MAX, DEFAULT_OPTIONS.se),
    stage: clampInt(s.stage, 0, Math.max(0, stageCount - 1), 0),
    mpFree: s.mpFree === true,
    collision: s.collision === true,
    playlog: s.playlog !== false,      // 版2.3：遊びの記録（既定 ON。明示的に false のときだけ OFF）
    numScale: s.numScale === 1 ? 1 : DISPLAY_SCALE,      // 版3.5：数字の大きさ（1＝そのまま／DISPLAY_SCALE＝×100）。1 のときだけそのまま、ほかは既定の×100
    cmd: s.cmd === 'tekken' ? 'tekken' : 'sf',      // 2026-11-19：操作方法 A/B（知らない値は A）
  };
}

/** 保存から読む。読めない・無いときは既定。storage を差し替えられる（試験用）。 */
export function loadOptions(stages = 32, storage) {
  const stageCount = Array.isArray(stages) ? stages.length : stages;
  try {
    const st = storage || localStorage;
    const raw = st.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const options = normalizeOptions(saved, stageCount);
      // 2026-11-20 監査：古い版（cmd を知らない）がオプションを保存し直すと cmd が消える。そのときは控え（CMD_KEY）から戻す
      if (!(saved && typeof saved === 'object' && 'cmd' in saved)) { try { options.cmd = st.getItem(CMD_KEY) === 'tekken' ? 'tekken' : 'sf'; } catch (e) { /* */ } }
      if (Array.isArray(stages)) {
        const key = typeof saved?.stageKey === 'string' ? saved.stageKey : LEGACY_STAGE_KEYS[options.stage];
        if (key !== undefined) options.stage = Math.max(0, stages.findIndex((s) => stageKey(s) === key));
      }
      return options;
    }
  } catch (e) { /* 読めなくても遊べる */ }
  const def = normalizeOptions(null, stageCount);
  try { if ((storage || localStorage).getItem(CMD_KEY) === 'tekken') def.cmd = 'tekken'; } catch (e) { /* */ }      // 2026-11-24：本体の保存が無く控えだけあるときも、操作 B を戻す
  return def;
}

export function saveOptions(o, storage, stages) {
  const selected = stages?.[o.stage];
  const key = selected && stageKey(selected);
  // 旧版のランチャーも同じ保存を読むので、番号は旧順で残す。
  const saved = key ? { ...o, stage: Math.max(0, LEGACY_STAGE_KEYS.indexOf(key)), stageKey: key } : o;
  try {
    const st = storage || localStorage;
    st.setItem(STORAGE_KEY, JSON.stringify(saved));
    // 2026-11-20：操作 A/B の控え（古い版に消されても戻せる）。2026-11-24：控えが書けなくても本体は保存できたので true（別の try）
    try { if (o.cmd === 'tekken' || o.cmd === 'sf') st.setItem(CMD_KEY, o.cmd); } catch (e) { /* */ }
    return true;
  } catch (e) { return false; }      // 覚えられなくてよい
}

/** 値を1段動かす（←→）。dir=+1/-1。戻り値は新しい設定（変わらなければ同じ値のコピー）。bool は ←→どちらでも反転。 */
export function stepOption(o, id, dir, stageCount = 32) {
  const n = { ...o };
  switch (id) {
    case 'bgm': case 'se': n[id] = clampInt(o[id] + dir, 0, LEVEL_MAX, o[id]); break;
    case 'stage': n.stage = clampInt(o.stage + dir, 0, stageCount - 1, o.stage); break;
    case 'mpFree': case 'collision': case 'playlog': n[id] = !o[id]; break;
    case 'numScale': n.numScale = o.numScale === 1 ? DISPLAY_SCALE : 1; break;
    case 'cmd': n.cmd = o.cmd === 'tekken' ? 'sf' : 'tekken'; break;      // 2026-11-19：操作方法 A⇔B
    default: break;
  }
  return n;
}

/** 音量の倍率（0〜1）。段階 5 が「いままでの音量」。 */
export const levelGain = (n) => clampInt(n, 0, LEVEL_MAX, LEVEL_MAX) / LEVEL_MAX;
