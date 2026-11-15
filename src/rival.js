// ライバル（色違いのスピノサウルス）＝最終面の敵。主人公と同じ技の表（src/moves.js）を、敵用に「読み替える層」で使う。
//
//  ■ この層がやること（主人公の表 PLAYER_MOVES の行は1つも書き換えない。コピーして、読み替えだけ足す）
//     ・RIVAL_READ に書いた技だけを使う（ジャンプ・ダッシュなどの動作の行と、ガード返しは AI が別に扱う）。
//     ・予兆：最初の区間（構え）を長くして「構え・光」を出す（tele=true。描画は赤い光と「!」）。構えの間は無敵にしない。
//     ・威力：dmgMul で主人公の体力（100）に合う大きさにする。咆哮は飛び越えられる低さにする（box）。
//     ・使うゲージ：ライバル自身のゲージ（world の e.gauge）。表の cost がそのまま消費。
//  ■ 敵の頭（AI）＝ rivalAI。距離と状況で技を選ぶ。
//     近い＝4段コンボ（噛む→爪→爪→尻尾）／足払い／打ち上げ（主人公が空中のとき）／必殺（噛みつき振り回し）
//     遠い＝ダッシュ体当たり・衝撃波・ダッシュ接近・跳び込み（空中から急降下の踏みつけ）
//     囲まれた／被弾が続く＝咆哮（被弾の硬直中からも出す）
//     主人公の攻撃をときどきガードする。必殺はゲージ（ライバル用）が貯まったときだけ。
//  ■ 理不尽にならないための上限（RIVAL_TUNE）
//     ・技の前に必ず構え（予兆）がある。
//     ・連続の上限：地上のつなぎは4つまで・空中は5発まで。上限か外れたら必ず休む（restAfterString）。
//     ・同じ技を3回続けて出さない（sameMoveMax=2）。技ごとの再使用までの間（mcd）。
//     ・つなぎの途中の当たりは、主人公の硬直が切れるまで次が当たる（逃げられる）。つなぎの最後の当たりのあとは長い無敵（world の hurtPlayer）。
import { expandMoves } from './moves.js';

// 版1.1b：数値はここ1か所。戻すときは RIVAL_TUNE_V11（直前の版1.1 の値）を Object.assign で上書きすればよい（tools/v11b_test.mjs はそうして前後を比べる）。
export const RIVAL_TUNE_V11 = {
  speed: 250, dashMul: 2.6, dashT: 0.5, approachDashRatio: 5.5, dashCd: 1.8,
  gaugeStart: 60, gaugeRegen: 10, gaugeOnHit: 1.5, gaugeOnHurt: 1.3, gaugeFlat: 3,
  stringMax: 4, airStringMax: 6, sameMoveMax: 3,
  restAfterString: [0.35, 0.75], gap: [0.15, 0.45], followUp: 0.95,
  guard: { react: 0.14, ready: 0.1, prob: 0.6, dur: [0.5, 0.9], cd: [1.2, 2.2], maxHold: 0, learn: 0, counterProb: 0, counterDelay: 0.06, airOpen: 0, noTurn: 0 },
  escapeProb: 0.9, dmgBoost: 1.3,
  wakeInv: 0, wakeProb: 0, wakeRoar: 0.6, wakeRange: 3.2,
  noAct: 0.18,
  w: { roar: 0.5, roarForced: 9, launcherAir: 6, launcher: 1.2, uppercutAir: 2, uppercut: 0.5, bite: 4, trip: 1.1, maul: 2.2, stomp: 1.0, shockwave: 2.6, shockwaveFar: 2.6, special: 3.0, dashAttack: 2.4, jump: 1.2 },
  mcd: { bite: 0, scratch: 0, scratch2: 0, finisher: 0, trip: 1.2, launcher: 2.0, uppercut: 3.5, stomp: 2.5, roar: 4.5, shockwave: 3.0, maul: 5,
    dashAttack: 2.8, special: 5, rise: 0, airTail: 0, air: 0.6, spike: 1.5, dive: 1.5, jump: 3, guardSpin: 0 },
};

export const RIVAL_TUNE = {
  speed: 250,             // 歩く速さ（主人公は380）
  dashMul: 3.0, dashT: 0.55,
  approachDashRatio: 3.2, // 版1.1b：体の半幅のこの倍数より遠いとダッシュで詰める（前 5.5）
  dashCd: 0.9,            // ダッシュの再使用（前 1.8）
  gaugeStart: 100, gaugeRegen: 35,      // ライバルのゲージ（0〜100）。時間で貯まり、当てた・当てられたときにも増える（版1.1b：主人公の約5倍）
  gaugeOnHit: 2.2, gaugeOnHurt: 2.2, gaugeFlat: 5,   // 当てた・当てられたとき：技の gauge×倍率 ＋ 定数
  stringMax: 4,           // 地上のつなぎ（噛む→爪→爪→尻尾）
  airStringMax: 6,        // 打ち上げ→昇り→…→締め（最初の1発を含む）
  sameMoveMax: 3,         // 同じ技を続けて出していい回数（つなぎは別）（据え置き）
  restAfterString: [0.15, 0.4],      // 前 0.35〜0.75
  gap: [0.05, 0.2],       // つなぎでない技と技のあいだ（前 0.15〜0.45）
  followUp: 1.0,          // つなぎの続きを出す確率
  // ガード：主人公の技を見てから react 秒で構える（正面だけ・空中からの攻撃は通る）。構えは ready 秒で効く。
  //   prob＝構える確率／dur＝構えを解く最短／maxHold＝主人公が殴り続けるあいだ構え続ける上限／cd＝解いてから次に構えるまで
  //   learn＝同じ攻撃を続けて受けたら、次は必ずガード（0で無効）／counterProb＝ガードが決まった直後にガード返し（尻尾の回転）／airOpen＝1なら空中からの攻撃は守れない（0で守れる）／noTurn＝1なら構えているあいだ向きを変えない（背後へ回られたら背中を向けたまま）
  guard: { react: 0.03, ready: 0.04, prob: 0.85, dur: [0.4, 0.7], cd: [0.4, 0.7], maxHold: 0.9, learn: 1, counterProb: 0.9, counterDelay: 0.06, airOpen: 1, noTurn: 1 },
  // 版2.4（Nao「咆哮が連続して出てしまっている・必殺技ゲージの減りをもっと早く」）
  roarCd: 7.0,            // 咆哮を1回出したら、どの経路（AI の選択・被弾の切り返し・起き上がり・コンボ破り・登場）でも、この秒数は出さない。怒り中は RAGE_RIVAL_ROAR_CD 倍
  costMul: { roar: 1.9, shockwave: 2.0, maul: 1.65, special: 1.9, stomp: 1.5 },      // ゲージの消費の倍率（溜まる速さは今のまま）。技の表（主人公の消費）はそのまま
  escapeProb: 1.0,        // 被弾の硬直中に咆哮で切り返す確率（ゲージがあるとき）
  dmgBoost: 1.3,          // 版1.1：威力の倍率（主人公の体力100に対して理不尽なくらい）
  wakeInv: 0.3,           // 起き上がった直後の無敵（秒）。倒れている間は元から当たらない。前 0.6（版2.4・Nao「無敵な時に技をすぐ撃ってくるのはまずい」）。技を出し始めたら無敵はその場で切れる（world.js startMove）
  wakeProb: 0.4,          // 起き上がった直後に切り返す確率（前 0.95）（咆哮 wakeRoar／ゲージ不足なら尻尾の回転）
  wakeRoar: 0.7,          // 切り返しが咆哮になる確率（ゲージがあるとき）
  wakeRange: 3.2,         // 切り返すのは、主人公が体の半幅のこの倍数より近いとき
  noAct: 0.08,            // 選べる技が無いときの待ち（前 0.18）
  // 技を選ぶ重み（大きいほどよく出す）
  w: { roar: 5, roarForced: 12, launcherAir: 16, launcher: 2.2, uppercutAir: 6, uppercut: 0.9, bite: 2.6, trip: 1.8, maul: 12, stomp: 2.2, shockwave: 7, shockwaveFar: 16, special: 12, dashAttack: 5, jump: 1.2 },
  mcd: {                  // 技ごとの再使用までの間（秒）。前→後：trip 1.2→0.6／launcher 2.0→0.9／uppercut 3.5→1.8／stomp 2.5→1.2／roar 4.5→2.4／shockwave 3.0→1.0／maul 5→2.2／dashAttack 2.8→1.2／special 5→2.2／spike 1.5→0.8／dive 1.5→0.7
    bite: 0, scratch: 0, scratch2: 0, finisher: 0, trip: 0.6, launcher: 0.9, uppercut: 1.2, stomp: 1.2, roar: 1.6, shockwave: 1.0, maul: 1.4,
    dashAttack: 1.2, special: 1.4, rise: 0, airTail: 0, air: 0.4, spike: 0.8, dive: 0.7, jump: 2.2, guardSpin: 0,
  },
};

/** 2026-10-25：ライバルの噛みつき・尾の技は、絵の頭ぜんたい・尾の軌跡に当たりを合わせる（Nao「他の敵も同様なことが起こってないか確認・修正」）。 */
const WIDE_PART = { mouth: 'maw', tail: 'tailext' };

/** 読み替え：技 id → { windup=構えの最短秒, dmgMul=威力の倍率, box=当たりの大きさの差し替え(最初の当たり) }。ここに無い技は敵として使わない。 */
export const RIVAL_READ = {
  bite:       { windup: 0.24, dmgMul: 0.8, wide: true },      // wide＝2026-10-25 頭ぜんたい（maw）・尾を振る（tailswing）の部位にする（主人公の表は書き換えない）
  scratch:    { windup: 0.18, dmgMul: 0.8 },
  scratch2:   { windup: 0.18, dmgMul: 0.8 },
  finisher:   { windup: 0.22, dmgMul: 0.85, wide: true },
  trip:       { windup: 0.26, dmgMul: 0.9, wide: true },
  launcher:   { windup: 0.32, dmgMul: 0.9, wide: true },      // wide＝2026-10-26（独立監査 中-1）：打ち上げ・アッパー・昇りも頭の円（maw）にする。主人公の表の mouth は立ち姿の外へ動いたマス（背中・首）も含み、ライバルでは背中に 55〜63% 当たっていた（Nao「背中に当たり判定はいらん」）
  uppercut:   { windup: 0.36, dmgMul: 0.9, wide: true },
  stomp:      { windup: 0.36, dmgMul: 0.9 },
  roar:       { windup: 0.48, dmgMul: 0.85, ring: true, guardable: true },      // guardable＝2026-10-25 Nao「咆哮はガードできるようにして」：主人公の咆哮の breakGuard を引き継がない（ガードで止められる）   // 床を走る輪だけが当たり（輪は低い＝跳べば避けられる）。箱は使わない
  shockwave:  { windup: 0.44, dmgMul: 0.9 },
  maul:       { windup: 0.48, dmgMul: 0.5, part: 'maw' },      // 2026-10-25 Nao「尻尾に当たり判定いる？」：首を振る技の当たりは頭（maw）だけ。尾・背中は含めない
  dashAttack: { windup: 0.4, dmgMul: 0.9 },
  special:    { windup: 0.44, dmgMul: 0.8 },
  guardSpin:  { windup: 0.16, dmgMul: 0.9, part: 'tailswingH', launch: { vx: 1000, vy: -220, grav: 0.5 }, kb: 0, stun: 0.5 },   // 版1.1b：ガード返し（尻尾の回転）。ガードが決まった直後・起き上がり直後の切り返し専用（AI が選ぶ。ふだんの選択肢には入れない）
  rise:       { windup: 0.11, dmgMul: 0.8, wide: true },
  airTail:    { windup: 0.16, dmgMul: 0.85, wide: true },
  air:        { windup: 0.14, dmgMul: 0.9, wide: true },
  spike:      { windup: 0.24, dmgMul: 0.9, landRing: true },   // 2026-10-24：着地の輪（床の輪2本）も当たり。叩きつけの当たりの次のコマで出る輪の線が当たる
  dive:       { windup: 0.32, dmgMul: 0.9, ring: true },   // 着地の衝撃（箱だった）は着地で出る輪の線が当たり
};

/** 主人公の技の表（PLAYER_MOVES）を敵用に読み替えて展開する。rows は書き換えない。 */
export function rivalMoves(rows, frameMap, read = RIVAL_READ) {
  const out = {};
  for (const [id, rd] of Object.entries(read)) {
    const src = rows[id];
    if (!src) throw new Error(`rival: 技の表に「${id}」が無い`);
    const r = structuredClone(src);
    r.t[0] = Math.max(r.t[0], rd.windup);  // 予兆（構え）を長くする
    const dm = rd.dmgMul * RIVAL_TUNE.dmgBoost;
    for (const h of r.hits || []) h.dmg = Math.max(1, Math.round(h.dmg * dm));
    if (r.proj && r.proj.hit) r.proj.hit.dmg = Math.max(1, Math.round(r.proj.hit.dmg * dm));
    if (rd.landRing && r.hits && r.hits[0]) r.hits.push({ at: r.hits[0].at + 1, box: [-2.6, 2.6, -0.1, 0.55], both: true, wave: true, ring: true, dmg: Math.max(1, Math.round(6 * dm)), kb: 300, stun: 0.4, stop: 0.08, shake: 8, sfx: 'quake' });      // 着地の輪（diveLand）の当たり。箱は使わず輪の線が当たる
    if (rd.box && r.hits && r.hits[0]) r.hits[0].box = [...rd.box];
    if (rd.launch && r.hits && r.hits[0]) { r.hits[0].launch = { ...rd.launch }; r.hits[0].kb = rd.kb ?? r.hits[0].kb; r.hits[0].stun = rd.stun ?? r.hits[0].stun; }      // 版2.4：主人公のガード返しは吹き飛ばさなくなったが、ライバルの尻尾の回転は従来どおり吹き飛ばす（敵側は変えない）
    // 部位を持たない（箱の）当たり：ring＝床を走る輪の線に置き換える／part＝その部位に置き換える（主人公側の表は書き換えない）
    for (const h of r.hits || []) {
      if (rd.wide && h.part) h.part = h.part.split('+').map((q) => WIDE_PART[q] || q).join('+');
      if (rd.guardable) delete h.breakGuard;
      if (h.part && h.part !== 'area') continue;
      if (rd.ring) { h.ring = true; delete h.part; }
      else if (rd.part) h.part = rd.part;
    }
    r.cancel = null;                                              // 敵のつなぎは AI が決める（表のキャンセルは使わない）
    out[id] = r;
  }
  const defs = expandMoves(out, frameMap);
  for (const def of Object.values(defs)) {
    const ph0 = def.phases[0];
    ph0.tele = true;          // 予兆：赤い光と「!」（描画は e.tele を見る）
    delete ph0.inv;           // 構えのあいだは無敵にしない（咆哮・噛みつき振り回し・体当たりの出だし）
  }
  return defs;
}

// ---------------------------------------------------------------------------------------------
//  頭（AI）。world.js の aiTick から、state==='idle' のときだけ呼ばれる。
// ---------------------------------------------------------------------------------------------
const lerp = (a, b, t) => a + (b - a) * t;
const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

function newState() {
  return { mcd: {}, hist: [], log: [], string: 0, jumpCd: 2.0, guardCd: 1.5, dashCd: 0, guardPlan: -1, seenMove: null, guardHold: 0, guardDur: 0, air: null,
    pStarts: [], rStrings: [], rLast: -9, counterAt: -1, counterDone: false };
}

/** この技を今出せるか（技の表の ctx・cost・from・requires と、技ごとの間）。 */
/** 版2.4：ライバルが技 def を出すときのゲージ消費（技の表の cost × RIVAL_TUNE.costMul）。 */
export function rivalCostOf(id, def) { return def.cost * ((RIVAL_TUNE.costMul && RIVAL_TUNE.costMul[id]) || 1); }
export function rivalCan(e, s, id) {
  const def = e.d.moves[id];
  if (!def) return false;
  if (id === 'roar' && (e.roarCd || 0) > 0) return false;      // 版2.4：咆哮は経路を問わず共通の待ち時間
  if (def.ctx === 'ground' && !e.onGround) return false;
  if (def.ctx === 'air' && e.onGround) return false;
  if (rivalCostOf(id, def) > e.gauge) return false;
  if ((s.mcd[id] || 0) > 0) return false;
  if (def.from) { const c = e.chain; if (!(c && c.t > 0 && def.from.includes(c.id))) return false; if (def.fromHit && !c.conn) return false; }
  return true;
}

/**
 * 受けた攻撃を覚える（world.js の playerHitsEnemy から、通った当たりのたびに呼ぶ）。0.9秒以上あいたら「別の連続攻撃」。
 * 連続攻撃は、技の名前の並び（同じ技の多段は1つにまとめる）で持つ。
 */
export function rivalReceived(w, e, name) {
  const s = e.aiS || (e.aiS = newState());
  const gap = w.time - s.rLast; s.rLast = w.time;
  if (gap > 0.9 || !s.rStrings.length) { s.rStrings.push([name]); if (s.rStrings.length > 4) s.rStrings.shift(); return; }
  const cur = s.rStrings[s.rStrings.length - 1];
  if (cur[cur.length - 1] !== name) cur.push(name);
}

/**
 * 主人公の技の始まりを見て、「同じ攻撃を続けて受けたか」を返す（true なら次は必ずガードする）。
 *  ・直前に受けた連続攻撃2つが同じ並びで、いままたその最初の技から始まった（「2回続けて受けたら3回目は必ず」）
 *  ・同じ技が3回続けて始まった（受けていなくても、構えを読む）
 */
function learnPlayer(w, s, name, T) {
  if (!T.guard.learn) return false;
  s.pStarts.push(name); if (s.pStarts.length > 12) s.pStarts.shift();
  const n = s.pStarts.length;
  let forced = n >= 3 && s.pStarts[n - 1] === name && s.pStarts[n - 2] === name && s.pStarts[n - 3] === name;
  const L = s.rStrings;
  if (w.time - s.rLast > 0.9 && L.length >= 2) {            // 新しい連続攻撃の始まり
    const a = L[L.length - 1], b = L[L.length - 2];
    if (a.join() === b.join() && a[0] === name) forced = true;
  }
  return forced;
}

function repeatBlocked(s, id) {
  const h = s.hist, n = RIVAL_TUNE.sameMoveMax;
  if (h.length < n) return false;
  for (let i = 1; i <= n; i++) if (h[h.length - i] !== id) return false;
  return true;
}

function begin(w, e, s, id) {
  const def = e.d.moves[id];
  e.gauge -= rivalCostOf(id, def);
  s.mcd[id] = RIVAL_TUNE.mcd[id] || 0;
  const fromChain = !!(e.chain && e.chain.t > 0 && e.chain.conn);     // 当たったあとの続き（地上の爪・尻尾、空中の昇り・締め）
  s.string = fromChain ? s.string + 1 : 1;
  s.hist.push(id); if (s.hist.length > 8) s.hist.shift();
  s.log.push(id); if (s.log.length > 600) s.log.shift();
  e.fromChain = fromChain;      // つなぎとして始めた技か（試験が読む）
  e.chain = null;
  e.vx = 0;
  w.startMove(e, id);
}

function beginGuard(w, e, s) {
  const g = RIVAL_TUNE.guard;
  w.setGuard(e, true);
  s.guardHold = 0; s.guardDur = w.rand(g.dur[0], g.dur[1]);
  s.guardReadyAt = w.time + w.rand(g.cd[0], g.cd[1]) + s.guardDur;      // 時刻で持つ（のけぞり・技の最中も時間は進む）
  s.guardBlocked = false; s.counterDone = false; s.counterAt = -1;
  e.vx = 0;
}

export function rivalAI(w, e, dt) {
  const T = RIVAL_TUNE, p = w.player;
  const s = e.aiS || (e.aiS = newState());
  for (const k of Object.keys(s.mcd)) if (s.mcd[k] > 0) s.mcd[k] -= dt;
  s.jumpCd -= dt; s.dashCd -= dt;
  if (e.dashT > 0) e.dashT = Math.max(0, e.dashT - dt);
  if (e.chain) { e.chain.t -= dt; if (e.chain.t <= 0) { e.chain = null; s.string = 0; } }
  if (e.recentT > 0) { e.recentT -= dt; if (e.recentT <= 0) e.recent = 0; }
  const hw = e.bw / 2, dx = p.x - e.x, dist = Math.abs(dx), ratio = dist / hw, alive = w.playerAlive();
  if (dist > 30 && !(e.guarding && T.guard.noTurn)) e.facing = dx >= 0 ? 1 : -1;      // 版1.1b：構えているあいだは向きを変えない（背後からの攻撃は通る）
  if (!alive) { e.vx = 0; if (e.guarding) w.setGuard(e, false); w.loopAnim(e, 'idle'); return; }
  if (!e.onGround) { airAI(w, e, s, dt, p, dx, ratio); return; }
  s.air = null;

  // ---- 起き上がった直後（無敵のあいだ）：咆哮か尻尾の回転で切り返す。起き攻めは通さない ----
  if (e.wakeFresh) {
    e.wakeFresh = false;
    if (ratio < T.wakeRange && alive && w.rand() < T.wakeProb) {
      s.mcd.roar = 0; s.mcd.guardSpin = 0;
      const id = (rivalCan(e, s, 'roar') && w.rand() < T.wakeRoar) ? 'roar' : (rivalCan(e, s, 'guardSpin') ? 'guardSpin' : (rivalCan(e, s, 'roar') ? 'roar' : null));
      if (id) { s.wokeWith = id; w.stats.rivalWakeCounters = (w.stats.rivalWakeCounters || 0) + 1; begin(w, e, s, id); return; }
    }
  }
  const pm = p.state === 'move' ? p.move : null;
  // ---- ガード中 ----
  if (e.guarding) {
    s.guardHold += dt; e.guardT += dt; e.vx = 0;
    w.holdAnim(e, 'guard');
    // ガードが決まった直後：ガード返し（尻尾の回転）
    if (s.guardBlocked && !s.counterDone) {
      s.counterDone = true;
      if (T.guard.counterProb > 0 && ratio < 2.6 && w.rand() < T.guard.counterProb) s.counterAt = s.guardHold + T.guard.counterDelay;
    }
    if (s.counterAt >= 0 && s.guardHold >= s.counterAt) {
      s.counterAt = -1;
      s.mcd.guardSpin = 0;
      if (rivalCan(e, s, 'guardSpin') && !repeatBlocked(s, 'guardSpin')) { w.setGuard(e, false); w.stats.rivalCounters = (w.stats.rivalCounters || 0) + 1; begin(w, e, s, 'guardSpin'); return; }
    }
    // 主人公が殴り続けているあいだは構え続ける（上限 maxHold）
    const keep = pm && ratio < 2.6 && s.guardHold < T.guard.maxHold;
    if (s.guardHold >= s.guardDur && !keep) { w.setGuard(e, false); e.cd = s.guardBlocked ? 0 : Math.max(e.cd, 0.1); }
    return;
  }
  // ---- 主人公の技を見てからよく構える（同じ攻撃を続けて受けたら、次は必ず構える） ----
  if (pm !== s.seenMove) {
    s.seenMove = pm;
    let forced = false;
    if (pm) forced = learnPlayer(w, s, pm.name, T);
    s.guardPlan = (pm && ratio < 2.4 && (((s.guardReadyAt ?? 0) <= w.time && w.rand() < Math.min(0.98, T.guard.prob * w.diff.guardMul)) || forced)) ? T.guard.react : -1;
    if (forced) w.stats.rivalLearnGuards = (w.stats.rivalLearnGuards || 0) + 1;
  }
  if (s.guardPlan >= 0) {
    s.guardPlan -= dt;
    if (s.guardPlan <= 0) { s.guardPlan = -1; if (ratio < 2.6) { beginGuard(w, e, s); return; } }
  }

  // ---- 間合い取り（技と技のあいだ）----
  if (e.cd > 0) { approach(w, e, s, ratio, 1.25); return; }

  // ---- つなぎ ----
  if (e.chain && e.chain.t > 0) {
    const c = e.chain;
    const ups = Object.keys(e.d.moves).filter((id) => e.d.moves[id].from && e.d.moves[id].from.includes(c.id) && rivalCan(e, s, id) && !repeatBlocked(s, id));
    if (c.conn && ups.length && s.string < T.stringMax && w.rand() < T.followUp) { begin(w, e, s, ups[0]); return; }
    e.chain = null; s.string = 0;
    e.cd = (c.conn ? w.rand(T.restAfterString[0], T.restAfterString[1]) : w.rand(T.gap[0], T.gap[1])) * w.diff.atkGap * w.rageGap(e);
    return;
  }

  // ---- 足場：主人公が足場の下にいれば降りる／上にいれば跳び上がる ----
  const below = p.y - e.y;                                       // 正＝主人公のほうが低い
  if (below > 100 && e.sup && e.sup !== 'ground') {
    e.dropIgnore = e.sup; e.onGround = false; e.sup = null; e.vy = 80; e.vx = 0; s.air = { t: 0, rises: 0 }; return;
  }
  if (below < -110 && s.jumpCd <= 0 && ratio < 3.2) {
    s.jumpCd = RIVAL_TUNE.mcd.jump * 0.5; e.vy = -1060; e.vx = e.facing * Math.min(220, dist * 1.2); e.onGround = false; e.sup = null; s.air = { t: 0, rises: 0 };
    w.sfx('jump', 0.7); w.dust(e.x, e.y, 4, 30); return;
  }
  // 主人公が無敵（直前に被弾した直後・咆哮の最中・起き上がり）のあいだは仕掛けない。間合いだけ取って待つ。
  if (!w.playerVulnerable() && p.state !== 'hurt') { e.cd = 0.12; approach(w, e, s, ratio, 1.6); return; }

  // ---- 選ぶ ----
  const pAir = !p.onGround && w.groundY - p.y > 60;
  const opts = [];
  const add = (id, wt, ok = true) => { if (ok && wt > 0 && rivalCan(e, s, id) && !repeatBlocked(s, id)) opts.push({ id, w: wt }); };
  const surround = w.enemies.filter((o) => o !== e && o.state !== 'dying' && !o.dead && Math.abs(o.x - e.x) < hw * 2.4).length >= 2;
  const pounded = (e.recent || 0) >= 3;
  const W = T.w;
  add('roar', surround || pounded ? W.roarForced : W.roar, ratio < 5);
  add('launcher', pAir ? W.launcherAir : W.launcher, ratio < (pAir ? 2.2 : 1.5));
  add('uppercut', pAir ? W.uppercutAir : W.uppercut, ratio < 1.5);
  add('bite', W.bite, ratio < 1.55 && !pAir);
  add('trip', W.trip, ratio < 1.9 && !pAir);
  add('maul', W.maul, ratio < 1.6 && !pAir);
  add('stomp', W.stomp, ratio >= 1.2 && ratio < 3.2 && !pAir);
  add('shockwave', ratio >= 3.2 ? W.shockwaveFar : W.shockwave, ratio >= 2.4 && ratio < 9 && !pAir);     // 距離を取られたら衝撃波を連発
  add('special', W.special, ratio >= 1.6 && ratio < 6);
  // ダッシュ体当たり：ダッシュの直後だけ出せる行（requires:'dash'）なので、出す直前に dashT を立てる
  if (ratio >= 3 && ratio < 6.5 && !pAir && !(s.mcd.dashAttack > 0) && !repeatBlocked(s, 'dashAttack')) opts.push({ id: 'dashAttack', w: W.dashAttack });
  if (s.jumpCd <= 0 && ratio >= 2.2 && ratio < 4.5 && !pAir) opts.push({ id: 'jump', w: W.jump });
  if (!opts.length) { e.cd = T.noAct; approach(w, e, s, ratio, 1.25); return; }
  let r = w.rand(0, opts.reduce((a, o) => a + o.w, 0)), pick = opts[0];
  for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
  if (pick.id === 'jump') { jumpIn(w, e, s); return; }
  if (pick.id === 'dashAttack') e.dashT = 0.3;
  begin(w, e, s, pick.id);
}

/** 技のないとき：相手との間合いを want（体の半幅の倍数）に寄せる。遠いときはダッシュで寄る。 */
function approach(w, e, s, ratio, want) {
  const T = RIVAL_TUNE;
  if (ratio > T.approachDashRatio && s.dashCd <= 0 && !(e.dashT > 0)) { e.dashT = T.dashT; s.dashCd = T.dashCd; w.sfx('whoosh', 0.5, 0.9); }
  if (ratio > want) {
    const dashing = e.dashT > 0;
    e.vx = e.facing * w.spdOf(e) * (dashing ? T.dashMul : 1);
    w.loopAnim(e, dashing ? 'dash' : 'walk');
    if (dashing) {
      e.ghostT = (e.ghostT || 0) - 1 / 60;
      if (e.ghostT <= 0 && e.anim) { e.ghostT = 0.045; w.fx.push({ type: 'ghost', who: e.type, motion: e.anim.motion, frame: w.frameOf(e), x: e.x, y: e.y, facing: e.facing, t: 0, dur: 0.24 }); }
    }
  } else if (ratio < 0.55) {            // 重なってしまったら、少し下がって間合いを取り直す
    e.vx = -e.facing * w.spdOf(e) * 0.6;
    w.loopAnim(e, 'walk');
  } else { e.vx = 0; w.loopAnim(e, 'idle'); }
}

function jumpIn(w, e, s) {
  s.jumpCd = RIVAL_TUNE.mcd.jump;
  e.vy = -1010; e.vx = e.facing * w.spdOf(e) * 1.3; e.onGround = false; e.sup = null;
  s.air = { t: 0, rises: 0 };
  s.log.push('jump');
  w.sfx('jump', 0.7); w.dust(e.x, e.y, 4, 30);
}

/** 空中：打ち上げが当たったら昇りでつなぐ（昇り→昇り→尻尾か叩きつけ）。跳び込みなら、相手が下にいれば急降下の踏みつけ。 */
function airAI(w, e, s, dt, p, dx, ratio) {
  const T = RIVAL_TUNE;
  s.air = s.air || { t: 0, rises: 0 };
  s.air.t += dt;
  const want = Math.abs(dx) > e.bw * 0.25 ? sgn(dx) : 0;
  e.vx = lerp(e.vx, want * w.spdOf(e) * 1.1, Math.min(1, dt * 6));
  e.steer = want;
  w.holdAnim(e, e.vy < 0 ? 'jump' : 'fall');
  if (e.cd > 0) return;
  const c = e.chain && e.chain.t > 0 ? e.chain : null;
  const below = p.y - e.y;                              // 正＝主人公のほうが低い
  const near = ratio < 1.9 && Math.abs(below) < e.bh * 1.1;
  if (c && c.conn) {
    if (s.string < T.airStringMax && near) {
      let id = null;
      if (s.air.rises < 2 && rivalCan(e, s, 'rise')) { id = 'rise'; s.air.rises++; }
      else if (c.id === 'rise' && rivalCan(e, s, 'airTail') && w.rand() < 0.6) id = 'airTail';
      else if (rivalCan(e, s, 'spike')) id = 'spike';
      if (id) { begin(w, e, s, id); return; }
    }
    if (s.string >= T.airStringMax || !near) { e.chain = null; s.string = 0; e.cd = w.rand(T.restAfterString[0], T.restAfterString[1]); }
    return;
  }
  if (c && !c.conn) { e.chain = null; s.string = 0; }
  if (e.vy > -50) {
    if (ratio < 1.5 && below > 40 && rivalCan(e, s, 'dive') && !repeatBlocked(s, 'dive')) { begin(w, e, s, 'dive'); return; }
    if (near && rivalCan(e, s, 'air') && !repeatBlocked(s, 'air')) { begin(w, e, s, 'air'); return; }
  }
}

/** 被弾の硬直中の咆哮での切り返し（ゲージがあるとき）。world.js の hurt 状態から呼ぶ。出したら true。 */
export function rivalHurtEscape(w, e, dt) {
  const s = e.aiS || (e.aiS = newState());
  e.hurtT = (e.hurtT || 0) + dt;
  if (w.isHeld(e)) return false;      // 版2.4：主人公の必殺技を受けている間は、のけぞり中の咆哮で切り返さない
  if (!e.escRoll || e.hurtT < 0.14 || !(e.hurtT < 0.5)) return false;
  e.escRoll = false;
  if (!rivalCan(e, s, 'roar')) return false;
  const p = w.player;
  e.facing = p.x >= e.x ? 1 : -1;
  e.stunT = 0;
  begin(w, e, s, 'roar');
  return true;
}

/** 被弾したとき（world.js の stagger から）：咆哮で切り返すかをその場で決める。 */
export function rivalOnHurt(w, e) {
  e.hurtT = 0;
  e.escRoll = (e.recent || 0) >= 2 && e.gauge >= (e.d.moves.roar ? rivalCostOf('roar', e.d.moves.roar) : 30) && w.rand() < RIVAL_TUNE.escapeProb;
}
