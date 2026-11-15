// 版1.2：敵のガード（ライバル以外）。ガード率の表は GUARD_TABLE の1か所。
//
//  ■ 何をするか
//    主人公が地上の攻撃を出し始め、それが自分の正面で届く距離に来たら、表の prob の確率で「見てから」構える（react 秒後・ready 秒で効く）。
//    1回の攻撃につき1度だけ抽選する（構えているあいだに続けて出された攻撃は、続けて防ぐ＝hold 秒まで）。構えを解いたあとは cd 秒は構えない。
//    守るのは正面だけ：構えているあいだ向きを変えない（背後に回られたら通る）・空中からの攻撃は通る（world.js の playerHitsEnemy）。
//    ガードを崩す技（咆哮・噛みつき振り回しの最後の一撃）は従来どおり崩して当たる。敵の突進（体当たり）は崩せず、止められてはじかれる（版1.2）。ただし主人公のゲージ技とダッシュ体当たりは、Nao 10-20 の決定で敵のガードを貫く（world.js の isPlayerCpMove。独立監査 軽微-1 で説明を実装に合わせた）。
//    ボスのハイパーアーマーは従来どおり（構えているのは待機中だけ。技の最中は構えない）。
//  ■ 絵
//    構えの絵がある恐竜（トリケラトプス・アンキロサウルス）は d.guard の Guard。無い恐竜（アロサウルス・スケルトン・ギガノト・ティラノ）は待機の1コマを
//    低く・後ろへ少し引いた見せ方（render.js の drawEntity）。新しい絵は発注していない。
//  ■ そのほか
//    プテラノドンは飛んでいるので持たない（表に無い）。ライバルは RIVAL_TUNE.guard（src/rival.js）で別に持つ（確率 0.85）。
//    トリケラトプスの「突進の前に構えて待つ」・アンキロサウルスの「近づくと盾を構える」は従来の構え（stance）で、この層とは別に残してある。

/** ガード率の表（1か所）。prob＝攻撃を見て構える確率／react＝見てから構え始めるまで／ready＝構えてから効くまで（秒）／dur＝構えを解く最短（秒）／hold＝殴られ続けるあいだ構え続ける上限（秒）／cd＝解いてから次に構えるまで（秒）。 */
export const GUARD_TABLE = {
  Allosaurus:     { prob: 0.30, react: 0.03, ready: 0.03, dur: [0.5, 0.8], hold: 1.0, cd: [0.7, 1.4] },
  Triceratops:    { prob: 0.85, react: 0.03, ready: 0.03, dur: [0.7, 1.1], hold: 1.6, cd: [0.4, 0.9] },
  Ankylosaurus:   { prob: 0.95, react: 0.03, ready: 0.03, dur: [0.8, 1.3], hold: 2.0, cd: [0.3, 0.7] },
  SkeletonRex:    { prob: 0.35, react: 0.03, ready: 0.03, dur: [0.5, 0.8], hold: 1.0, cd: [0.8, 1.5] },
  Giganotosaurus: { prob: 0.40, react: 0.03, ready: 0.03, dur: [0.5, 0.9], hold: 1.2, cd: [0.8, 1.5] },
  Tyrannosaurus:  { prob: 0.45, react: 0.03, ready: 0.03, dur: [0.5, 0.9], hold: 1.2, cd: [0.7, 1.4] },
  // 版2.0：新しい敵（ケツァルコアトルスは飛んでいるので持たない＝プテラノドンと同じ）
  Mammoth:        { prob: 0.75, react: 0.03, ready: 0.03, dur: [0.6, 1.0], hold: 1.4, cd: [0.6, 1.2] },
  Titanosaurus:   { prob: 0.25, react: 0.03, ready: 0.03, dur: [0.5, 0.9], hold: 1.0, cd: [1.0, 1.8] },
  SpinosaurusBoss: { prob: 0.50, react: 0.03, ready: 0.03, dur: [0.5, 0.9], hold: 1.2, cd: [0.7, 1.4] },
  // 版2.1：一覧の恐竜。素早い小型は構えない（ほぼ無し）／尾のこぶの盾役エウオプロはガード高め／色違い R は元より少し高い
  VelociraptorR:   { prob: 0.12, react: 0.03, ready: 0.03, dur: [0.4, 0.7], hold: 0.8, cd: [1.0, 1.8] },
  TroodonR:        { prob: 0.08, react: 0.03, ready: 0.03, dur: [0.4, 0.7], hold: 0.8, cd: [1.0, 1.8] },
  EuoplocephalusR: { prob: 0.90, react: 0.03, ready: 0.03, dur: [0.8, 1.3], hold: 2.0, cd: [0.3, 0.8] },
  AllosaurusR:     { prob: 0.40, react: 0.03, ready: 0.03, dur: [0.5, 0.8], hold: 1.0, cd: [0.6, 1.2] },
  TriceratopsR:    { prob: 0.90, react: 0.03, ready: 0.03, dur: [0.7, 1.1], hold: 1.6, cd: [0.4, 0.9] },
  AnkylosaurusR:   { prob: 0.97, react: 0.03, ready: 0.03, dur: [0.8, 1.3], hold: 2.0, cd: [0.3, 0.7] },
};

/**
 * 版2.8（Nao「防御ができるキャラは固定しようかなと思っていて、アンキロとかトリケラトプスとか防御優先の恐竜と、あとボスだけにしましょう。爽快感優先で。」）
 * 読みガードをする敵は、防御優先の恐竜（アンキロ・トリケラ・エウオプロ・色違い R）とボス級、それにマンモス（Nao「マンモスはガード入れて」＝0.50→トリケラ寄りの 0.75）だけ。上の表の数値はそのまま（アロ・アロR・ラプトル・トロオドンの率も残してある）。
 * 元に戻すには GUARD_FILTER.on を false にする（この1か所）。ライバル（src/rival.js）はボス級として別に持つ。プテラノドン・ケツァルは飛ぶので元から無し。
 */
export const GUARD_WHO = new Set(['Ankylosaurus', 'AnkylosaurusR', 'Triceratops', 'TriceratopsR', 'EuoplocephalusR',
  'Mammoth', 'SkeletonRex', 'Titanosaurus', 'Giganotosaurus', 'SpinosaurusBoss', 'Tyrannosaurus']);
export const GUARD_FILTER = { on: true };
/** 敵 type の実際のガード設定（ガードしない敵は null）。 */
export function guardCfgOf(type) { return GUARD_FILTER.on && !GUARD_WHO.has(type) ? null : (GUARD_TABLE[type] || null); }

/** 試験用のつまみ。on＝この層を動かす／stance＝従来の構え（トリケラの待ち・アンキロの近づき）を動かす。 */
export const GUARD_TUNE = { on: true, stance: true };
export function setEnemyGuard(on) { GUARD_TUNE.on = on; }
export function setGuardStance(on) { GUARD_TUNE.stance = on; }

/** 主人公の攻撃が届く距離（中心どうし）。口先＋突進で寄ってくるぶんの余裕。 */
export function guardReach(e, p) { return p.bw * 0.875 + e.bw * 0.25 + 130; }

/** 技 def が崩しを持つか（咆哮・噛みつき振り回し・コンボ破りの技）。 */
export function breaksGuard(def) {
  if (!def) return false;
  if (Object.values(def.hits || {}).some((h) => h.breakGuard)) return true;
  return !!(def.proj && def.proj.hit && def.proj.hit.breakGuard);
}

/** 突進系（壁まで進む区間がある技）＝ダッシュ体当たり・体当たり・トリケラやギガノトの突進。止められたときの、はじかれ方が大きい。 */
export function isChargeMove(def) { return !!def && (def.phases || []).some((ph) => ph.until === 'wall'); }

/**
 * 敵の頭（aiTick）の前に呼ぶ。この層が構えているあいだは true を返し、ほかの AI は動かさない（その場で構える）。
 * ライバル・飛ぶ敵・表に無い敵は何もしない（false）。
 */
export function guardTick(w, e, dt) {
  if (!GUARD_TUNE.on) return false;
  const cfg = guardCfgOf(e.type);
  if (!cfg || e.rival || e.d.flying) return false;
  const s = e.gS || (e.gS = { active: false, hold: 0, dur: 0, plan: -1, seen: null, cdUntil: 0 });
  const p = w.player;
  if (s.active && !e.guarding) s.active = false;          // 外から解かれた（ひるみ・崩され）
  if (e.guarding && !s.active) return false;             // 従来の構え（stance）のあいだは、この層は口を出さない

  const alive = w.playerAlive();
  const pm = alive && p.state === 'move' && p.move && p.onGround && Object.keys(p.move.def.hits || {}).length > 0 ? p.move : null;
  const dist = Math.abs(p.x - e.x);
  const front = (p.x - e.x) * e.facing > 0;
  const near = dist <= guardReach(e, p) && w.sameLevel(e, p);

  if (s.active) {
    s.hold += dt; e.vx = 0;
    // 殴られ続けているあいだは構え続ける（hold まで）。止んだら dur を過ぎた時点で解く
    const keep = !!pm && front && near && s.hold < cfg.hold;
    if (s.hold >= s.dur && !keep) { w.setGuard(e, false); s.active = false; s.cdUntil = w.time + w.guardRand(cfg.cd[0], cfg.cd[1]); return false; }
    holdGuardAnim(w, e, dt);
    return true;
  }

  if (!e.onGround || !alive) { s.plan = -1; return false; }
  if (!pm) { s.plan = -1; s.seen = null; return false; }
  if (front && near && s.seen !== pm && w.time >= s.cdUntil) {
    s.seen = pm;                                          // 1回の攻撃につき1度だけ抽選
    if (w.guardRng() < Math.min(0.98, cfg.prob * w.diff.guardMul)) s.plan = cfg.react;
  }
  if (s.plan >= 0) {
    s.plan -= dt;
    if (s.plan <= 0) {
      s.plan = -1;
      if (front && near) {
        w.setGuard(e, true); e.guardReady = cfg.ready; e.vx = 0;
        s.active = true; s.hold = 0; s.dur = w.guardRand(cfg.dur[0], cfg.dur[1]);
        w.stats.enemyGuards = (w.stats.enemyGuards || 0) + 1;
        holdGuardAnim(w, e, dt);
        return true;
      }
    }
  }
  return false;
}

/** 構えの絵：構えのコマがある恐竜はそれ、無ければ待機の1コマ（render.js が低く・後ろへ引いて描く）。 */
function holdGuardAnim(w, e, dt) {
  if (e.d.guard) { w.applyGuardAnim(e, dt); return; }
  e.guardT += dt;
  const a = e.d.anim.idle;
  if (a && (!e.anim || e.anim.key !== 'gI')) e.anim = { key: 'gI', motion: a[0], from: a[1], to: a[1], dur: 1, loop: false, t: 0 };
}

/** 版1.3：難しさ（src/difficulty.js の guardMul）を掛けた、実際に使うガード率（上限 0.98）。 */
export function effectiveGuardProb(w, prob) { return Math.min(0.98, prob * w.diff.guardMul); }
