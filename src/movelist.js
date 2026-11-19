// 版2.1：ポーズメニューの「技表」の中身を、技の表（moves.js の PLAYER_MOVES）から自動で作る。DOM に触れない。
// 手書きの一覧は持たない。技の行を足すと技表も増える（表示名＝name・説明＝desc は技の行に1か所）。
// 例外は「基本操作」（いどう・ガード）だけ：ガードは「↓を押し続ける」で、技の行ではないため、ここに2行だけ持つ。
import { PLAYER_MOVES, TEKKEN_INPUT, tekkenOn } from './moves.js';
import { parseInput } from './commands.js';
import { DIVE_CP } from './tune.js';      // 2026-11-15：急降下の CP 欄に出す数字（出した瞬間に減る量。調整スライダー 100% のとき）

/** 分類（表示の順）。 */
export const MOVE_CATS = [
  { id: 'ground', jp: '地上' },
  { id: 'air', jp: '空中' },
  // 2026-11-15（Nao「おすすめで」＝説明を動きに合わせる）：note＝分類の下に出す一言。必殺は CP が足りないと別の技が出る（↓↓＋攻撃は CP29 なら足払い、↓↘→＋攻撃は 12〜39 なら踏みつけ・11 以下なら噛みつき、前・後・前＋攻撃は 59 なら噛みつき）
  { id: 'special', jp: '必殺（CP）', note: 'CP が足りないときは、別の技が出るものがある（咆哮→足払い／衝撃波→踏みつけか噛みつき／噛みつき振り回し→噛みつき）' },      // 取り込みの見直し：体当たりは当てはまらないので「ものがある」。「4秒以内に続けて出すほど CP が増える」は各技の説明にあるので一言からは外す（幅に詰められて小さくなっていた）
  { id: 'move', jp: '移動とガード' },
];

/** ボタン名 → 表示（キーボード／パッド）。 */
export const BUTTON_LABEL = {
  attack: { jp: '攻撃', key: 'Z', pad: 'A' },
  jump: { jp: 'ジャンプ', key: 'X', pad: 'B' },
  special: { jp: '体当たり', key: 'C', pad: 'X・Y' },
};

const ARROW = { up: '↑', down: '↓', left: '←', right: '→', forward: '→', back: '←', downforward: '↘', downback: '↙', upforward: '↗', upback: '↖' };

/** 基本操作（技の行ではないもの）。 */
export const BASICS = [
  { id: 'walk', name: 'いどう', cmd: '← →', key: '← →', pad: '十字 / スティック', cost: 0, cond: '', desc: '左右に歩く。入力した向きへ向きが変わる。' },
  { id: 'guard', name: 'ガード', cmd: '↓ 押し続け', key: '↓', pad: '十字の下', cost: 0, cond: '', desc: '正面の攻撃を防ぐ。上から来る攻撃（踏みつけ・急降下など）はガードできない。構えている間は CP が減る（0 だと削りが通る）。決まった直後に攻撃で「尻尾の回転」。' },
  { id: 'parry', name: 'パリィ', cmd: '↓ を押した直後', key: '↓', pad: '十字の下', cost: 0, cond: '', desc: '↓ を押してすぐ（約0.15〜0.3秒・難しさで変わる）に攻撃を受け止めると、敵が確定で目を回す。押しっぱなしでは受付は開き直さない。上から来る攻撃は受けられない。CP は減らず少し回復。' },
];

/** 技の行の分類。 */
export function catOf(row) {
  if (row.cat) return row.cat;      // 行が分類を指定してもよい（大ジャンプは技の行だが「移動」）
  if (row.action) return 'move';
  if ((row.cost || 0) > 0) return 'special';
  if (row.ctx === 'air') return 'air';
  return 'ground';
}

/** 入力の文字列 → 表示。cmd＝矢印と「＋攻撃」など／key・pad＝使うボタン（キーボード／パッド）。 */
export function formatInput(src) {
  const parsed = parseInput(src);
  const groups = src.split('+').map((s) => s.trim());
  const parts = [];
  const keys = [], pads = [];
  for (const g of groups) {
    const toks = g.split(',').map((s) => s.trim());
    if (toks.length === 1 && BUTTON_LABEL[toks[0].split('>')[0]]) {
      const [b, hold] = toks[0].split('>');
      const L = BUTTON_LABEL[b];
      parts.push(L.jp + (hold ? '（長押し）' : ''));
      keys.push(L.key); pads.push(L.pad);
      continue;
    }
    const arrows = toks.map((t) => {
      const [d0, hold] = t.split('>');
      const star = d0.endsWith('*'), d = star ? d0.slice(0, -1) : d0;      // * は「押したままでよい」
      const a = ARROW[d] ?? d;
      return hold && Number(hold) >= 0.3 ? `${a}（溜め）` : star ? `${a}（押したまま）` : a;
    });
    parts.push(arrows.join(' '));
  }
  return { cmd: parts.join(' ＋ '), key: keys.join(' + '), pad: pads.join(' + '), parsed };
}

const REQ_JP = { platform: '足場の上で', airjump: '空中ジャンプが残っているとき', dash: 'ダッシュ中に', guard: 'ガードが決まった直後に' };

/** 出せる条件（短い日本語）。無ければ ''。 */
export function condOf(row, rows = PLAYER_MOVES) {
  const c = [];
  if (row.requires && REQ_JP[row.requires]) c.push(REQ_JP[row.requires]);
  if (row.from && row.from.length) {
    c.push(`${row.from.map((id) => (rows[id] && rows[id].name) || id).join('・')} のあと` + (row.fromHit ? '（当てたとき）' : ''));
  }
  if (row.combo === true) c.push('空中コンボの最中に');
  if (row.altInput) { const a = formatInput(row.altInput); c.push(`${row.altWhen || ''}は ${a.cmd} でも`); }
  if (row.fromHurt) c.push('地上でよろけている間でも');      // 2026-11-15：空中でやられているときは出せない
  return c.join('／');
}

/** 技表を作る。rows を差し替えられる（試験：行を足すと技表も増える）。 */
export function buildMoveList(rows = PLAYER_MOVES) {
  const cats = MOVE_CATS.map((c) => ({ ...c, note: c.note || '', entries: [] }));
  const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
  for (const [id, row] of Object.entries(rows)) {
    // 2026-11-18 試作：鉄拳型のときは、鉄拳型の入れ方を表に出し、前の入れ方は条件の欄に「でも」で添える
    const tk = tekkenOn() && TEKKEN_INPUT[id];
    const f = formatInput(tk || row.input);
    let cond = condOf(tk ? { ...row, altInput: null } : row, rows);
    // 2026-11-20 監査：B の表では A の入れ方を「でも」で添える。もう一つの入れ方（急降下の「コンボ中でない空中は ↓＋攻撃 でも」）の条件も落とさない
    if (tk) cond = [cond, `${formatInput(row.input).cmd} でも`, row.altInput ? `${row.altWhen || ''}は ${formatInput(row.altInput).cmd} でも` : null].filter(Boolean).join('／');
    byId[catOf(row)].entries.push({
      id, name: row.name || id, desc: row.desc || '', cat: catOf(row),
      cmd: f.cmd, key: f.key, pad: f.pad, cost: row.cost || (row.energy === 'dive' ? DIVE_CP : 0), cond,
    });
  }
  byId.move.entries.unshift(...BASICS.map((b) => ({ ...b, cat: 'move', basic: true })));
  // 2026-11-20 監査：B の「方向＋体当たり」は、CP が足りないと別の技に化けず「CP 不足」で止まる（world.js tekkenOrDeny）。一言を B 用に
  if (tekkenOn()) byId.special.note = 'CP が足りないとき：B の入れ方（方向＋体当たり）は「CP 不足」で出ない。A の入れ方は別の技が出るものがある（咆哮→足払い／衝撃波→踏みつけか噛みつき／噛みつき振り回し→噛みつき）';
  const moves = cats.reduce((n, c) => n + c.entries.filter((e) => !e.basic).length, 0);
  return { cats, count: moves, total: cats.reduce((n, c) => n + c.entries.length, 0) };
}
