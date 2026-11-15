// ゲームの中身（DOM に触れない）。物理・戦闘・敵AI・波の進行・演出イベント。
// 描画は render.js、入力と場面は game.js。Node でも動く（tools/sim_test.mjs が使う）。
import { DINOS, PLAYER, isBossLike } from './dinos.js';
import { clamp, sign, lerp, mulberry32, rectsOverlap } from './util.js';
import { CommandReader, inputScore } from './commands.js';
import { zonesOfFrame, zoneInfo } from './weak.js';
import { bodyRects, partRects, toWorld, cellsOverlap, boxToCells, bboxOf, ringBandCells, waveCells, ringRadius, diskCells, RING_LIVE_U, HIT_TUNE, pillarWidth } from './shape.js';
import { ENEMY_DOWN, ENEMY_CRASH_STUN_CHANCE, PLAYER_SPECIAL_STUN, PLAYER_SPECIAL_STUN_CHANCE, PLAYER_WAVE_RANGE, PLAYER_ROAR_SCALE, ENEMY_ROAR_SCALE, WAVE_LOCK } from './moves.js';
import { rivalAI, rivalHurtEscape, rivalOnHurt, rivalReceived, RIVAL_TUNE } from './rival.js';
import { difficultyOf, difficultyFor, TIME_LIMIT, summonAid, summonCount } from './difficulty.js';
import { RAGE, rageMul, RAGE_RIVAL_ROAR_CD } from './rage.js';
import { guardTick, GUARD_TUNE, breaksGuard, isChargeMove } from './guard.js';
import { TUNE, tn, tnSqrt, CHASE, COUNTER, DIVE_CP } from './tune.js';
const SPECIAL_MOVES = ['roar', 'shockwave', 'maul', 'special'];      // 主人公の CP 必殺（技の表 src/moves.js の SPECIALS と同じ）

/**
 * 版1.2：ガードされた攻撃の側がはじかれる量（1か所）。dist＝後ろへ下がる距離(px)・stun＝硬直(秒)。
 * light＝ふつうの攻撃／charge＝突進（ダッシュ体当たり・体当たり・敵の突進）。絵は Damage の最初の数コマ（動作表の repel）＋後ろ向きの短い移動。
 */
export const REPEL = { on: true, light: { dist: 24, stun: 0.3 }, charge: { dist: 96, stun: 0.5 } };      // on＝試験用のつまみ（false なら、はじかれなし＝版1.1c までの動き）

const CLASH_EARLY = 0.1;       // 突進どうしの相殺でも、主人公だけこの秒数早く動ける
// 版2.4：主人公のガードが決まったとき、攻撃してきた敵は「目の前で硬直」（遠くへ滑らない＝反撃がつながる）。gLight＝ふつうの攻撃／gCharge＝突進（長め）。ハイパーアーマーも効かない。dist＝体の重なりを解く程度の後退(px)・stun＝硬直(秒)。
REPEL.gLight = { dist: 6, stun: 0.6 };
REPEL.gCharge = { dist: 10, stun: 0.8 };
REPEL.clash = { dist: 54, freeze: 0.16, slide: 0.16, early: 0.1, jitter: 4.5 };
// 版1.3：相殺（元のゲームの数値＝止まる約0.16秒＋逆向きに滑る約0.16秒・後退約36px(640×480基準)×1.5＝54px）。
//   dist＝後退(px)／freeze＝止まって震える秒／slide＝滑る秒／early＝相殺のあと主人公だけ早く動ける秒（止まる時間から引く）／jitter＝止まっている間の震え(px)
/**
 * 版1.3：相殺のつまみ（1か所）。on＝試験用に切れる／pad＝相殺だけの当たりの余裕(px)。
 * 方針：ふつうの攻撃どうし・必殺技どうしは相殺して両方はじかれる／必殺技はふつうの攻撃に勝ってそのまま当たる／輪・衝撃波（ring・wave・breakGuard の当たり）は相殺しない。
 */
export const DIVE_OVER = { on: true, feetGap: 0.02 };      // 版3.5：feetGap＝主人公の足が敵の足元より体高のこの倍率以上高ければ「上から」。on=false で旧挙動（陰性対照）
// 版3.5：咆哮の円盤の大きさの補正。中心を体の真ん中から口（前へ約80px）に移したので、前への届きが伸びて後ろが縮む。左右の届きの平均が前の版（箱）と同じになるよう円を少し小さくする（実測：前の版 335・円盤 k=1 で平均 355）
export const ROAR_DISK = { k: 0.88 };
export const GRUNT_FIX = { on: true };      // 2026-11-14：足場の上の主人公を待つ間に雑魚の構えを解く（false で旧＝検査の陰性対照）
export const BOSS_FIX = { on: true };      // 2026-11-14：怒りで切った技の速さ・くわえ中に力尽きたときのつかみ・CLEAR! 後の被弾の直し（false で旧＝検査の陰性対照）
export const WEAK_ON = { on: true, scaled: false };      // 2026-11-02：部位別ダメージのつまみ（false で全部位 1 倍＝旧挙動。陰性対照・難易度の前後比べ用）。scaled＝接点からマスまでの上限を絵の倍率に合わせる（2026-11-14 の候補の直し）。
//   2026-11-15：既定は false（11-02 の作り＝「体のマスから離れた接点は部位を決めない」の 24px 固定）に戻した。部位の線引きは Nao の判断待ちで、この上限もその中に入るため（見張り役の決まり：判断待ちを決めない・前の作業を戻さない）。
//   true にすると、ティタノへの体当たりが体の隙間に当たっても部位が付く（boss_weak_test W10）。ボス戦 480 戦では勝ち負け・時間ともほぼ同じ（460 戦が同じ結果）
/** 2026-11-15：次の面が無い面をクリアしたらエンディングへ（false で直す前＝出口へ歩いて、無い面への面送りで止まる） */
export const PKG_LAST = { on: true };
export const CLASH = { on: true, pad: 10, lead: 0.08, once: true };      // once（2026-11-15）＝アーマー中のボスの振りと必殺の相殺は、同じ 2 つの技のあいだで 1 回だけ（false で直す前＝毎コマ）      // lead＝先に当たりそうな攻撃を見た時点で、相手の攻撃が始まる直前（この秒数以内）なら、当たりにせず相殺にする（振りの出だしのずれを許す）
/** 版1.3：被弾の震え（描画だけ）。amp＝最初の振れ(px)・毎フレーム ×decay で減衰。 */
export const HURT_JITTER = { on: true, amp: 3.5, decay: 0.8 };
/**
 * 版1.3：ゲージの溜まり方（1か所）。作者「回復量が大きい・無双できてしまう」への対応＝命中での溜まりとコンボ倍率を下げた（必殺の消費はそのまま）。
 * 溜まり＝命中のゲージ値 × hit × (1 + min(comboMax, コンボ数 ÷ comboDiv))／milestone＝10コンボごとの加算。
 * 前（版1.2まで）＝hit 1・comboMax 2（最大3倍）・comboDiv 15・milestone 8。同じ遊び方で必殺を撃てる回数が約6割になる（tools/v13_test.mjs で測る）。
 */
export const GAUGE_TUNE = { hit: 0.75, comboMax: 1, comboDiv: 25, milestone: 5 };
export const GAUGE_TUNE_V12 = { hit: 1, comboMax: 2, comboDiv: 15, milestone: 8 };
/** 版1.3：面クリアの回復＝max(その面の clearHeal, 最大体力 × その面の最大コンボ × perCombo)。係数はここ1か所。 */
export const CLEAR_HEAL = { perCombo: 0.008, capFrac: 0.4 };      // capFrac＝コンボ連動の回復の上限（最大体力に対する割合・ふつうのとき。難しさの healMul が掛かる）

export const W = 1280, H = 720;
export const GRAV = 2600;
const BULLET_GRAV = 1000;
export const JUMP_V = -1060;
/**
 * 版2.3：大ジャンプ（↓を押した状態から ↑＋ジャンプ）。v＝飛び出しの縦の速さ(px/s)。ふつうのジャンプ(JUMP_V)の約1.9倍（約390px）の高さまで上がる。
 * ため（しゃがみ）の長さは技の表 bigJump の区間 0。
 */
export const BIG_JUMP = { v: -1440 };
/**
 * 版3.0：水（海の面）。面の water {y} より下が水（体の中心が水面より下＝水の中）。水の中では、主人公も敵も時間の流れが slow 倍（動きが少しゆっくり＝水中は敵も遅い）。
 * 主人公（スピノ）は泳げる：重力でなく浮力と水の抵抗で動く。↑↓←→で上下左右へ泳ぎ、何も押さなければ水面へゆっくり浮かんで、中心が水面の float 下で止まる。
 * ジャンプボタンで上へ蹴る（stroke）。水面から breachBand 以内なら、水面を突き破って飛び出す（breach）。
 *   swimV 横の最高速／upV・downV 上・下の最高速（px/s）／accel 目標の速さへ寄る係数(1/s)／drag 操作していない間の水の抵抗(1/s)
 *   float 何も押さないとき、体の中心が水面からこの深さで止まる（浮力のばね）／stroke ジャンプボタンの上への速さ／breach 水面近くでの飛び出しの速さ／breachBand 飛び出せる水面からの深さ
 *   airG 水の外で泳ぐ敵が落ちる重力（px/s²）／moveDrag 技の最中の横の抵抗／trenchPull 海底の裂け目の中（海底の線より下）で下へ引く流れの強さ(px/s²。↑で泳ぐ力より強い)／noMoves 水の中で使えない技（急降下・大ジャンプ・足場から降りる など）
 */
export const WATER = { trenchFix: true, slow: 0.8, swimV: 330, upV: 290, downV: 320, accel: 7, drag: 2.4, moveDrag: 7, trenchPull: 3200, float: 60, stroke: -640, breach: -1300, breachBand: 150, airG: 2000,
  noMoves: ['bigJump', 'drop', 'fall', 'dive', 'airjump'] };
/**
 * 版3.0：陸の敵が水に落ちたとき（drown）。もがきながら（被弾の動きを回す）水面でゆれて、近い画面の端へ流されていき、絵が画面の外へ出てから消える（倒した扱い＝点・コンボ）。
 *   speed 流される速さ(px/s)・accel 加速／maxT 最長の秒（これを超えたらその場で消す）
 */
export const DROWN = { speed: 230, accel: 160, maxT: 7 };
/**
 * 版3.0：落ちてはいけない所（面の pit {y, dmg}：足が y を超えたら）に落ちたとき。ダメージを受けて、最後に立っていた足場の上から降ってきて復帰する。
 *   dmg 既定のダメージ（体力 100 のとき）／inv 復帰後の無敵(秒)／stun 降りてくる間の硬直(秒)
 */
export const PIT = { dmg: 12, inv: 2.0, stun: 0.8 };
/** 版3.0（背景の描き直し）：マグマだまり（火山の 4-2・4-3）。dmg＝主人公が池に入ったときの1回のダメージ／spill＝水位が最高のとき池が左右へ広がる量（描画 lava_render.js の LAVA_SPILL と同じ値）／bossPerSec＝ボスが池にいる間に毎秒減る体力の割合（倒れない）／period＝水位が上下する1周の秒（面の lava.period で上書き） */
export const LAVA = { dmg: 14, spill: 40, bossPerSec: 0.05, period: 8 };
/** 版3.5：マグマだまりに落ちた主人公は、溶岩の表面で一瞬のけぞり（flinch）→ 近い縁の外の地面へ放物線で弾かれ（dur・高さ h）→ 着地して硬直（stiff）→ 操作可能。着地点は、池の最高水位の縁から past[0]〜past[1] px 先（margin＝縁との最低の余白）。無敵は操作できるようになってから inv 秒。 */
export const LAVA_BOUNCE = { flinch: 0.08, dur: 0.7, stiff: 0.25, h: 220, past: [60, 120], margin: 40, inv: 1.5 };
/**
 * 版3.3：陸の敵は池・水を避ける（Nao「敵が池を避ける」「溶けた分は点やコンボやCPを入れない」）。
 *   margin    池の縁（水位が最高のときの縁）から、さらにこの幅(px)の手前で止まる（敵の体の幅の 12% も足す）
 *   hopAfter  縁で止められてから、この秒数たっても主人公が池の向こうにいるなら、池を跳び越す（ボス・重い敵は跳ばない＝待つ）
 *   edgeInset 海の面：足場の端からこの幅(px)内で止まる（その先に乗れる足場が無いとき）
 *   hopVx・hopMaxT  池を跳び越えるときの横の速さの上限(px/s)・滞空の最大(秒)。池の幅に合わせて跳ぶ高さを決める
 * 避けるのは「自分で歩いて／走って入る」ときだけ。主人公の技で吹き飛ばされて落ちた・溶けた分は従来どおり（点・コンボに数える）。
 */
export const HAZARD = { margin: 14, bodyFrac: 0.12, hopAfter: 1.6, edgeInset: 3, hopVx: 420, hopMaxT: 1.15 };
/**
 * 版2.3：縦のスクロール（カメラ）。camY＝画面の上端の世界 y（0 が元の1画面、負で上へ。面の rise で下限 -rise）。
 * 足が支えられている足場の高さに合わせて落ち着く（足を画面の y=feetY に置く。地面なら 0）。空中の間は最後に立っていた足場に合わせたまま、
 * 頭が上端から topMargin 以内に近づくか、足が下端から bottomMargin 以内に来たら、その分だけ追う。落ちるときは下を先に見せる（fallFeetY）。
 * follow＝追いかけの速さ（1/秒）。
 */
export const CAM = { feetY: 450, topMargin: 100, bottomMargin: 80, fallFeetY: 540, follow: 7 };
/**
 * 海の面の移り：海から海への面の移り。前の面を水の中で出たなら、次の面（start.carry）は同じ深さの水の中、左端の少し内側から始める。
 * sea＝前の面を出た時点の { wet, depth（足の y － 水面）, camY }。戻り値＝次の面での { x, y（足の世界 y）, cam }。引き継がないとき null。
 * 深さが海底の下・足場の上面（立ててしまう高さ）にかかるときは、近い安全な水中へずらす。カメラは、頭と足が画面に入る位置で始める（updateCamera と同じ式）。
 */
export const SEA_ENTRY_X = 90;
export function seaEntry(st, sea, bh = 150) {
  if (!st || !st.water || !st.start || !st.start.carry || !sea || !sea.wet) return null;
  const wy = st.water.y, x = SEA_ENTRY_X;
  let y = wy + Math.max(sea.depth, bh * 0.5 + 24);      // 体の中心が水面より下
  const floor = (st.groundY || 0) - 6;
  for (let k = 0; k < 3; k++) {
    for (const p of st.platforms || []) {
      if (x >= p.x - 24 && x <= p.x + p.w + 24 && y > p.y - 40 && y < p.y + 24) y = p.y + 24;      // 足場の上面にかかる（降りて乗ってしまう）→ すぐ下の水中へ
    }
  }
  y = Math.min(y, floor);
  for (const p of st.platforms || []) {
    if (x >= p.x - 24 && x <= p.x + p.w + 24 && y > p.y - 40 && y < p.y + 24) y = p.y - 60;      // 海底に押された先も上面にかかるなら、足場の上の水中へ
  }
  y = Math.max(y, wy + bh * 0.5 + 8);
  const rise = st.rise || 0, sink = st.sink || 0, lim = (v) => clamp(v, -rise, sink);
  const pl = st.platforms && st.platforms[st.start.plat];
  const anchor = lim((pl ? pl.y : st.groundY) - CAM.feetY);
  let cam = lim(Math.max(Math.min(anchor, y - bh - CAM.topMargin), y - (H - CAM.bottomMargin)));
  const hi = y - bh - 40, lo = y - (H - 40);
  cam = lim(clamp(cam, Math.min(lo, hi), Math.max(lo, hi)));
  return { x, y, cam, anchor };
}

/**
 * 版3.3：カットインの止まり（約0.5秒）の間に押した入力を、止まり明けに出す（Nao「２はまかせた」＝カットイン中の先行入力の取りこぼし）。
 * 先行入力は「押してから 0.25 秒以内」だけ有効で、止まりは 0.5 秒あるため、止まりの前半に押したものは明けた時には切れていた。
 * 以前の直し（時計全体を止める）は、止まりの間の押下がすべて同じ時刻になり、↓↓＋攻撃の順番が壊れて下段の尾になった。
 * 今回は入力の履歴（reader）の時計だけを rate 倍の速さで進める：順番も間隔の比も保たれる（↓↓＋攻撃は咆哮のまま・↓＋攻撃は下段尾のまま）。
 * 止まりの間に押したものは、明けて最大 (0.25 - 止まりの分) 秒、先行入力として生きている。ふつうのヒットストップ（カットインでない止まり）は従来どおり。
 */
export const CUTIN_INPUT = { rate: 0.1 };
/** 版3.3：面の変数（stage.vars＝ステージごとのスライダー。100＝今の値）を倍率にする。 */
const svar = (st, id) => { const v = st && st.vars && st.vars[id]; return v === undefined ? 1 : v / 100; };
export const PLAYER_SPEED = 380;
const MAX_ENEMIES = 6;
const TAU = Math.PI * 2;
/** 版2.2：ボス撃破の「衝撃の輪」。ボスを倒した瞬間、残っている雑魚を輪が届いた順に吹き飛ばして画面の外へ出す。
 *  countAsHits＝true にすると、吹き飛ばした雑魚をヒット数（コンボ）に数える（既定 false＝数えない。Nao 未回答のため既定は数えない側）。 */
export const BOSS_PURGE = { on: true, countAsHits: false, ringDur: 0.9, ringMax: 1700, speed: 1500, maxT: 3.0, hardT: 5.0 };
/**
 * 版2.6：コンボの切れ方（Nao「敵をまたいだ連鎖は残す。ただ、吹き飛び中の敵がいるだけでは保たない」）。
 *   window  何かが当たってから、次に何かが当たるまでの猶予（秒）。当たり＝攻撃・壁・玉突き・叩きつけ（どれも当たるたびに猶予を戻す）。吹き飛び中の敵がいても、画面の外の敵がいても、猶予は延びない。
 *           前の版は 1.5 秒＋「吹き飛び中の敵が1体でもいれば無命中でも保つ」で、打ち上げの滞空（3秒近く）ぶんだけ切れなかった。原作の猶予は 0.26〜0.48 秒（敵ごと）。
 *           ここは 1.0 秒：打ち上げた敵を追って次を当てるまで（昇りの連打の間隔 0.2〜0.5 秒＋追いつく時間）に足り、何もしなければ1秒で切れる。スライダー「コンボの切れる時間」(comboWindow)で動かせる。
 */
export const COMBO = { window: 1.0 };
/**
 * 版2.6：打ち上げ（launch の float）の高さ。Nao「打ち上げは、半分ぐらいにする必要があるかもしれません」。
 *   heightMul  打ち上げの高さ（見た目の高さ）の倍率。0.5＝前の半分。高さ ∝ 初速²/重力 なので、重力を h^-gravShare 倍（h=0.5・gravShare=0.95 なら 1.93 倍）・初速を h^((1-gravShare)/2) 倍（0.98 倍）にして実現する。
 *              初速をほとんど落とさない＝昇り始めの速さが前と同じで、昇りのコンボの間合い（juggle_test）が変わらない。重力は 1.93 倍でも打ち上げの技の grav(0.5) を掛けて 0.97（<1＝combo_test 5 の『軽い重力』）。ボス級にも同じ倍率（比が保たれる）
 *   gravShare  高さの減らし方のうち重力で受け持つ割合（1 なら重力だけ・0 なら初速だけ）。0.95＝juggle_test が前と同等で、重力が 1 を超えない最大に近い値
 *   minWeightV 縦の初速を割る重さの下限。軽い雑魚（重さ 0.6〜0.9）でも重さ 1 と同じ高さまで（前は 0.6 で 1.7 倍の初速→画面の外へ）
 */
export const LAUNCH = { heightMul: 0.5, minWeightV: 1, gravShare: 0.95 };
/** 版2.6：壁の激突。reflect＝跳ね返る速さの割合（原作 0.4。前は 0.72）／repeat＝同じ吹き飛びの中の2回目・3回目以降のダメージの割合（最初の一撃は 1）。 */
export const WALL = { reflect: 0.5, boss: 0.35, repeat: [1, 0.5, 0.25] };
/**
 * 版2.6：跳べる敵（Nao「飛べる敵を作りましょう」）。原作は、主人公が64px(×1.5)以上高いと縦 -11px/f（約1.9倍の跳び＝約 224px）で跳び上がり、間隔は 2.2〜3.0 秒。
 *   seeDy  主人公がこれ以上高いと追う  reach  1回の跳びで上がれる高さ(px)  vy  跳びの初速  wait  跳ぶ前の立ち止まり(秒)  cool  跳んだあと次に跳ぶまで(秒)  maxVx  跳びの横の速さの上限
 * 辞書の d.hop を持つ敵（アロ・色違いアロ・ラプトル・トロオドン）が跳ぶ。重い敵（アンキロ・エウオプロ・マンモス・トリケラ）は跳ばず、足場の下で待つと「足場ゆらし」(QUAKE) をする。
 */
/**
 * 版3.2：足場から足場へ「上へ跳ぶだけ」の道の表（面の読み込みで一度だけ作る）。足場は 3〜4 枚なので全部の組を総当たりで最短にする。
 *   跳ぶ力 vyFor(rise)＝必要な高さ＋HOP.clear の初速（弱い跳びは HOP.vy）／flightT(rise)＝足場の上面を下りながら通り抜けるまでの秒／hopEdge＝1回の跳びで行けるか（高さが 50〜HOP.reach・横のすき間が跳びで届く）。
 *   戻り値 next[s + 1][g]＝足場 s（-1 は地面）から足場 g へ行く最短の道の最初の足場の添字（無ければ -1）。最短＝跳びの回数が少ない道（同じなら足場の中心の横の移動が短い道）。
 */
export const HOP_G = 2600;
export const hopVy = (rise) => -Math.max(-HOP.vy, Math.sqrt(2 * HOP_G * (rise + HOP.clear)));
export const hopFlightT = (rise) => { const v = hopVy(rise); return (-v + Math.sqrt(v * v - 2 * HOP_G * rise)) / HOP_G; };
export const SEP_DY = 40;      // 版3.5：敵どうしが押し合う（separateEnemies）のは、足元の高さの差がこれ以内のときだけ
export const SUP_PAD = 10;      // 足場の端から外へ、接地が保たれる幅(px)（physicsBody・landingSurface と同じ 10）
/**
 * 2026-10-29（Nao「原作のように、操作キャラをターゲットしていない距離のときは、敵が自由に徘徊するように」）：雑魚の徘徊。
 *   主人公が aggro（px。縦は dyMul 倍に縮めて測る）より遠いあいだは、雑魚は待機で立ち尽くさず、その場の周り（home から radius 以内・足場の端 edgePad の内側・壁/穴/池の手前まで）を
 *   ゆっくり（speed の speedMul 倍）歩いたり立ち止まったり向きを変えたりする。aggro 内に入る／被弾など動けない状態になる（hitT 秒）と即ターゲット（従来の接近・攻撃）。
 *   lose（px）より遠い状態が loseT 秒続くと、ターゲットをやめて徘徊へ戻る（aggro〜lose の間は今の状態を保つ＝境目で行ったり来たりしない）。
 *   対象＝ tier:'grunt' の地上の walker/charger/tank/multi。ボス級・ライバル・飛ぶ敵・泳ぐ敵は対象外（既存の挙動を壊さない）。乱数は this.rand（シード式）。
 *   on:false で従来（常にターゲット）に戻る（検査の陰性対照・ボットの前後比較に使う）。
 */
export const WANDER = { on: true, escape: true, unstick: true, aggro: 640, lose: 800, loseT: 3, hitT: 6, dyMul: 0.6, speedMul: 0.4, radius: 280, edgePad: 24, walkT: [1.2, 3.2], standT: [0.8, 2.6] };
/**
 * 2026-11-15：恐竜ごとの追いかけ方（Nao「空中ブロックやジャンプを使って追撃するキャラと、今回の修正のようにするキャラを恐竜べつに分けてほしい。」）。
 * 追撃型（dinos.js の PURSUIT_TYPE が 'jump'・跳ぶ絵のある種）は、主人公が足場の上・池の向こうなど歩いては届かない所にいるあいだ、
 * 索敵（WANDER.aggro）の外でも徘徊せずにターゲットし、跳び上がる／降りる／池を跳び越えて追う。徘徊型は今までどおり。
 * range＝追う横の距離の上限（px）。on:false で全員が徘徊型（2026-11-14 の動き＝検査の陰性対照）。
 */
export const PURSUIT = { on: true, range: 1280 };
export const HOP_INSET = 45;     // 跳び出しの位置(足場の端から 20px 内)＋着地の位置(端から 25px 内)
export function hopEdge(A, B, groundY) {
  const rise = (A ? A.y : groundY) - B.y;
  if (rise < 50 || rise > HOP.reach) return false;
  if (!A) return true;                                                       // 地面からは歩いて足場の下まで行ける
  const gap = Math.max(0, A.x - (B.x + B.w), B.x - (A.x + A.w));
  return gap <= HOP.maxVx * hopFlightT(rise) * 0.9 - HOP_INSET;      // 点検と監修：跳ぶ位置は足場の端から 20px 内・着地点は 25px 内なので、その分(45px)を引く（旧は 0.8 倍だけで、離れが大きい足場は「届く」のに跳ぶ位置へ近づけず永久に止まった）
}
export function hopRoutes(platforms, groundY) {
  const P = platforms, n = P.length, INF = 1e18;
  const w = (a, b) => 10000 + (a < 0 ? 0 : Math.abs((P[a].x + P[a].w / 2) - (P[b].x + P[b].w / 2)));
  const next = [];
  for (let s = -1; s < n; s++) {
    const dist = new Array(n).fill(INF), first = new Array(n).fill(-1);
    for (let b = 0; b < n; b++) if (b !== s && hopEdge(s < 0 ? null : P[s], P[b], groundY)) { dist[b] = w(s, b); first[b] = b; }
    for (let it = 0; it < n; it++) for (let a = 0; a < n; a++) {
      if (dist[a] >= INF || a === s) continue;
      for (let b = 0; b < n; b++) if (b !== s && b !== a && hopEdge(P[a], P[b], groundY) && dist[a] + w(a, b) < dist[b]) { dist[b] = dist[a] + w(a, b); first[b] = first[a]; }
    }
    next.push(first);
  }
  return next;
}
export const FLY_CLIMB = 520;      // 版2.8b：飛ぶ敵が主人公の面の高さへ上がる・下がる速さの上限(px/秒)
export const HOP = { seeDy: 100, reach: 250, clear: 19, vy: -1080, wait: CHASE.hopWait, waitChain: CHASE.hopWaitChain, cool: CHASE.hopCool, coolChain: CHASE.hopCoolChain, landCd: CHASE.landCd, airDecay: 0.5, grace: 0.5, maxVx: 400 };      // 版3.2：待ち・間隔は src/tune.js の CHASE（連続して跳ぶ2回目以降は短い）
/** 版2.6：足場ゆらし。足場の上の主人公へ届く手が無い敵（重くて跳べない・届かない高さ）が、真下で待つこと wait 秒を超えたら、地面を踏み鳴らして足場を揺らし、主人公を跳ね上げる。 */
export const QUAKE = { wait: CHASE.quakeWait, tele: 0.8, stomps: 3, dmg: 8, kb: 220, stun: 0.45, pop: -520, cool: 5.0, minDy: 90, bossWait: CHASE.bossWait, bossDmg: 14, bossCool: 6.0 };
/* 版2.8b：ボス（飛ばない・ライバル以外）は、足場の上の主人公に自分の技が当たらないまま bossWait 秒たつと、その足場の真下で足場ゆらしを出す（足場を安全地帯にしない）。技が主人公に届けば（当たっても、ガードされても）数え直す。 */
/* 版2.8b：足場ゆらしが当たるのは「敵の真上にある足場」の上の主人公だけ（足場の左右の端の内側に足元がある）。横の距離の一律の範囲（旧 range 360px）はやめた。待ちは、敵がその足場の下（左右の範囲の中）に来てから数え、動作・突進・被弾・目回しの間は数えない。 */
/** 版2.6：ボスの入場（歩いて入る）。入りきるまでが limitT 秒（5秒）を超えるボス（ティタノ約12秒。ほかは 3.7 秒まで）だけ、出現位置を近づけて maxT 秒で入りきる（歩く速さは変えない）。 */
export const CONTINUE_CP = 50;      // 版2.8b：その場で復活（continueHere）したときの CP の最低値（満タン 100 の半分）
// 版2.8：歩いて入るのに limitT 秒を超えるボス（ティタノ）は、画面の外から出して歩く速さを上げ、maxT 秒で入る（版2.6 は出現位置を画面の近くにしたため、画面の中に急に現れていた）。stepT＝入場中の地響き（足音・揺れ・土ぼこり）の間隔。
export const ENTER = { maxT: 4, limitT: 5, stepT: 0.42 };
const JUGGLE = { grav: 0.5, lift: -400, push: 90, ceiling: 470, vMax: 800 };   // お手玉：空中の敵を殴るたびの浮き（軽い重力・上向きの速さ・横に押す速さ・高さの上限）
export const AIR_ATTACK_GRAV = 0.4;        // 主人公が空中で技を出している間の重力の倍率
const DASH_T = 0.5, DASH_MUL = 1.9;   // ダッシュ：最高速が DASH_MUL 倍になり、DASH_T 秒で元に戻る
const GUARD_OK_T = 0.17;            // ガード成立のあと、この秒数（約10コマ）のあいだに攻撃すると「ガード返し」
/**
 * 版2.5：ガードと CP ゲージ（Nao「ガードしている間は CP ゲージが減っていくように」）。数値はここ1か所。
 *   hold   ガードを構えている間の毎秒の減り（満タン 100）
 *   block  攻撃を受け止めた1回の減り／charge＝突進（isChargeMove）を受け止めたとき／wave＝輪・衝撃波を受け止めたとき
 *   chipRate  CP が 0 のとき、受け止めても通る削り（本来のダメージの割合）。最低 1
 *   empty  'chip'＝CP 0 でもガードはできて削りが通る（採用）／'open'＝CP 0 ではガードできない（切り替え用・採用していない）
 * CP FREE（旧 CP FREE）のときは減らない・削りも通らない。ガード返しの発動にゲージは使わない。
 */
export const CP_GUARD = { hold: 9, block: 4, charge: 8, wave: 3, chipRate: 0.25, empty: 'chip' };
/**
 * 版2.5：パリィ（Nao「攻撃のタイミングとガードのタイミングが合えば、パリィ状態になり、相手は確定でぴよる」）。
 *   window  ガードを押し始めてから、この秒数以内に受け止めたらパリィ（難しさの parryMul を掛ける＝やさしいは広い）
 *   relock  ガードを離してから、この秒数のあいだに押し直しても窓は開かない（連打で取れない）
 *   stun    攻撃してきた敵が目を回す秒数（確定・ハイパーアーマーも貫く）／stunHeavy＝ボス級・ライバル
 *   cpGain  パリィで CP が回復する量（減らない）
 */
/** 版2.5：爪の斬撃（fx swipe）の光の強さ（Nao「少し光りすぎ」）。形・向き・出るタイミングは変えない。版2.4 は dur 0.34・widthFrac 0.075・glow 1・core 1（芯の太さ）・tip 1（先端の玉の大きさ）・tipA 1。 */
export const SWIPE_FX = { dur: 0.26, widthFrac: 0.06, widthMin: 11, glow: 0.6, core: 0.6, tip: 0.62, tipA: 0.6 };
// 2026-11-15 Nao「↓ を押し直したときだけ受付を開く（決まりどおりにする）」＝パリィの受付は ↓ を押した瞬間だけ開く。on=false で直す前（↓ を押したまま技・着地・やられが終わるたびに受付がもう一度開く）
export const PARRY_EDGE = { on: true };
// 2026-11-15 Nao「A 水に入ったら急降下を止めて泳ぎに戻す」＝水の上で出した急降下（until ground の下向きの技）は、水に入ったら止めてふつうに水に入ったときと同じ泳ぎに戻す（WATER.noMoves と揃える）。vyMax＝そのとき残す下向きの速さの上限（ふつうの「落下」の技と同じ 1100）。on=false で直す前（海底まで一直線）
export const DIVE_WATER_FIX = { on: true, vyMax: 1100, names: ['dive', 'spike'] };
// 2026-11-15 Nao「おすすめで」（決め8 の 2）＝CP FREE の主人公は、衝撃波系の「続けて出すほど増える消費」（WAVE_LOCK）で出せなくならない。on=false で直す前（5 回目は必要 CP 120 で満タンでも出ない）
export const CP_FREE_WAVE_FIX = { on: true };
export const PARRY = { window: 0.15, relock: 0.3, stun: 1.8, stunHeavy: 1.0, cpGain: 8, hitstop: 0.14, stateOk: ['idle', 'move', 'hurt', 'stun'] };      // stateOk（2026-11-15）＝パリィで目を回させてよい撃った側の状態（null で直す前＝状態を見ない）
const HANG_ALT = 170, HANG_T = 0.55;   // 昇りの途中、地面からこの高さに来ると、二人がこの秒数だけ頂点で止まる

/** 絵を描く向き。技の区間の pose.turn（尻尾は絵の後ろ側に伸びるので敵に背を向けて振る）のあいだだけ、向きを反転して描く。 */
export function visFacing(e) {
  if ((e.isPlayer || e.rival) && e.move) { const ph = e.move.def.phases[e.move.i]; if (ph && ph.pose && ph.pose.turn) return -e.facing; }
  const y = yawOf(e);       // 版2.7：縦の軸で回している間は、cos が負のあいだ向きが入れ替わる
  if (y && y.flip) return -e.facing;
  return e.facing;
}

/** 版2.7：縦の軸で体を回す動き（四天王スピノフューリーのなぎ払い）。区間の pose.yaw {from,to,ease}（rad・区間の中で回す）。足元の中心まわりに、横幅が |cos| 倍（下限 YAW_MIN）・cos が負のあいだは向きが逆。回っていなければ null。 */
export const YAW_MIN = 0.16;
export function yawOf(e) {
  if (!e.move || e.state !== 'move') return null;
  const ph = e.move.def.phases[e.move.i];
  const y = ph && ph.pose && ph.pose.yaw;
  if (!y) return null;
  let u = Math.min(1, Math.max(0, e.move.pt / ph.dur));
  if (y.win) u = Math.min(1, Math.max(0, (u - y.win[0]) / (y.win[1] - y.win[0])));      // 回転の専用アニメ化：区間のうち角度が進む割合
  if (y.ease === 'in') u = u * u; else if (y.ease === 'out') u = 1 - (1 - u) * (1 - u);
  const a = y.from + (y.to - y.from) * u, c = Math.cos(a);
  if (y.art) return { a, c, flip: false, sx: 1, art: true };      // 回転の専用アニメ化：絵そのものが回る（専用アニメ）＝横幅を縮めず向きも反転しない。角度は竜巻の弧・土ぼこり用
  return { a, c, flip: c < 0, sx: Math.max(YAW_MIN, Math.abs(c)) };
}

/** 版3.0：泳いでいる主人公の体の傾き（rad・正＝頭が下）。上へ泳ぐと頭が上、下へ泳ぐと頭が下。render.js も同じ値を使う。 */
export function swimTilt(e) { return Math.max(-0.55, Math.min(0.55, e.vy / 650)) * e.facing; }

/** アニメ区間 {motion,from,to,dur,loop,t} の今のコマ番号。from>to なら逆再生。 */
export function animFrame(a, n) {
  const span = Math.abs(a.to - a.from) + 1;
  const dirn = a.to >= a.from ? 1 : -1;
  let k;
  if (a.loop) k = Math.floor((((a.t / a.dur) % 1) + 1) % 1 * span);
  else k = Math.min(span - 1, Math.floor(Math.min(a.t / a.dur, 1) * span));
  if (k > span - 1) k = span - 1;
  return clamp(a.from + dirn * k, 0, n - 1);
}

const r1 = (v) => Math.round(v * 10) / 10;      // 版2.3：記録用の丸め

export const AIR_COMBO_T = 0.8;      // 版2.4：空中で当てたあと、空中コンボが続いているとみなす秒数（当てるたびに延びる・着地で終わる）

/**
 * 版2.4：ガードできるのは「正面から、ほぼ水平に来る攻撃」だけ（主人公・敵・ライバル共通・ここ1か所）。上から来る攻撃は通る。
 *   vyDown＝攻撃側が下向きにこの速さ(px/s)を超えて動いている（急降下・落下しながらの攻撃）／footGap＝攻撃側の足元がガード側の足元よりこの高さ(px)より上／hitHigh＝当たった所が、ガード側の体の高さ（上端）のこの割合より上。
 *   このほか：攻撃側が空中（飛ぶ敵は除く）・技の当たりに overhead:true の印（踏みつけ・叩きつけ・急降下）がある攻撃は、上から来る扱い。
 */
export const GUARD_ABOVE = { vyDown: 250, footGap: 60, hitHigh: 1.0, ringAtSpawn: true };      // ringAtSpawn（2026-11-15）＝床を走る輪の「上から来るか」は、輪を出したときの撃った側の様子で決める（false で直す前＝当たったときの様子）

export class World {
  constructor({ motions, stages, seed = 20261011, playerMoves = null }) {
    this.motions = motions;
    this.stages = stages;
    this.rng = mulberry32(seed);
    this.stunRng = mulberry32((seed ^ 0x5bd1e995) >>> 0);      // 版1.1c：必殺技のひるみの抽選専用（ほかの乱数の並びを変えない・種が同じなら同じ結果）
    this.crashRng = mulberry32((seed ^ 0x7f4a7c15) >>> 0);      // 版2.4：敵の突進が壁に当たったときの目回しの抽選専用（ほかの乱数の並びを変えない・種が同じなら同じ結果）
    this.counterRng = mulberry32((seed ^ 0x3a6f19b5) >>> 0);      // カウンター改：ボスのカウンター（コンボ破り）の抽選専用（ほかの乱数の並びを変えない・種が同じなら同じ結果）
    this.chainRng = mulberry32((seed ^ 0x6d2b79f5) >>> 0);      // 版3.8：玉突きが反撃中のボスを止めるかの抽選専用（ほかの乱数の並びを変えない・種が同じなら同じ結果）
    this.guardRng = mulberry32((seed ^ 0x2c1b3c6d) >>> 0);      // 版1.2：敵のガードの抽選専用（ほかの乱数の並びを変えない）
    this.nextId = 0;
    this._tuneVer = TUNE.ver;      // 版2.6：調整スライダーが動いたら難しさ由来の値を作り直す
    this.mpFree = false;      // 版2.0：オプション CP FREE（主人公のゲージが常に満タンで消費なし）
    this.logHook = null;      // 版2.3：遊んだ記録（src/playlog.js）への通知。null なら記録しない
    this.events = [];
    this.reader = new CommandReader();
    this.setPlayerMoves(playerMoves || DINOS[PLAYER].moves);
    this.fx = [];
    this.bombs = []; this.eruption = null;      // 版2.7：火山弾（ギガノト咆哮のあと降ってくる）と、背景の火山の噴火の演出
    this.rtime = 0;     // 版3.3：入力の読み取り（reader）の時計。ふつうは time と同じ速さ。カットインの間だけ CUTIN_INPUT.rate 倍
    this.cutin = null;     // 版2.7：カットイン {t, dur, kind}（画面を止めて目のアップを見せる。実時間で進む）
    this.waves = [];       // 床を走る衝撃波（飛び道具）
    this.roars = [];       // 版3.5：主人公の咆哮の円盤（同心円に広がる当たり）
    this.texts = [];
    this.player = null;
    this.enemies = [];
    this.water = null; this.gaps = []; this.pit = null; this.sink = 0;      // 版3.0：海の面（水面・海底の裂け目・落ちてはいけない所・カメラの下方向）。陸の面は全部 null/空
    this.score = 0;
    this.stageStartScore = 0;
    this.combo = 0; this.comboT = 0; this.maxCombo = 0; this.stageMaxCombo = 0; this.comboDmg = 0;      // 版3.5：comboDmg＝このコンボで与えたダメージの合計（表示だけ。計算には使わない）
    // 版2.0：World の既定は「むずかしい」（＝版1.3 までの「ふつう」と同じ全部 1）で、ワールドの曲線も掛けない（試験の前提を保つ）。
    // ゲーム本体（game.js）は、選んだ難しさを setDifficulty で入れ、useCurve=true にして、面ごとのワールドの曲線（difficulty.js の WORLD_CURVE）を掛ける。
    this.diffId = 'raw'; this.useCurve = false;      // 版3.4：初期値は倍率ぜんぶ 1 の「素の値」（選べる「むずかしい」は別の値になった）
    this.diff = difficultyOf('raw');      // 版1.3：難しさ（src/difficulty.js）
    this.shake = 0; this.hitstop = 0;
    this.slow = null;          // {t, scale}
    this.purge = null;         // 版2.2：ボス撃破の衝撃の輪（{x,y,t}）
    this.flashFx = null;       // {t, dur, color}
    this.timeScale = 1;
    this.time = 0;
    this.phase = 'none';
    this.continues = 0;
    this.stats = { kills: 0, slams: 0, chains: 0, juggles: 0, launchers: 0, airJumps: 0 };
    // ボス戦の長いコンボへの歯止め（試験が値を変えて陰性対照にする）
    this.bossTune = { ceil: 0.6, comboFrom: 20, comboSlope: 0.03, comboMin: 0.4, airHits: 8, noHang: true,
      // 版1.1：ボス級（ボス・ライバル）の重み
      breakAt: 10,        // 主人公のコンボがこのヒット数以上のとき、ヒットのたびに確率でボスがカウンターの技で切り返す（カウンター改：旧＝届いたら確定）。0 で無効（陰性対照）
      counterBase: COUNTER.base, counterStep: COUNTER.step, counterMax: COUNTER.max,      // カウンターの確率：breakAt コンボで base、1 コンボ増えるごとに step 足す、上限 max（1 = 確定）
      breakWin: COUNTER.win,      // ヒットの間がこの秒数あくと数え直し（値は src/tune.js の COUNTER.win）
      breakLock: 1.5,     // 切り返しのあと、次の切り返しが出るまで
      breakWindup: 0.06,  // カウンター改：予告なし。技の絵の立ち上がり（最初の区間）だけ残す秒数
      armor: true,        // 攻撃の動作に入ってから攻撃が終わるまでは、のけぞらず・吹き飛ばない（ハイパーアーマー）
      flinchMul: 0.6,     // ボス級ののけぞりの長さの倍率
    };
  }

  /** 主人公の技の表（src/moves.js を展開したもの）を差し替える。技を足す試験にも使う。 */
  setPlayerMoves(defs) {
    this.playerDefs = defs;
    this.playerRows = Object.entries(defs).map(([id, def]) => ({ id, def, parsed: def.parsed, score: inputScore(def.parsed) + (def.from ? 3 : 0) + (def.priority || 0) }));
  }

  // ---- 小物 ----
  rand(a = 0, b = 1) { return a + (b - a) * this.rng(); }
  guardRand(a = 0, b = 1) { return a + (b - a) * this.guardRng(); }
  sfx(name, vol = 1, rate = 1) { this.events.push({ type: 'sfx', name, vol, rate }); }
  /** 恐竜ごとの咆哮（うなり growl の差し替え先。割り当てが無い種は従来の 'growl'）。 */
  roarOf(e) { return (e && e.d && e.d.roar) || 'growl'; }
  emit(ev) { this.events.push(ev); }
  /** 版2.3：遊んだ記録への通知（logHook が無ければ何もしない＝遊びの結果は変えない・乱数も使わない）。呼ぶ側は if (this.logHook) で囲む。 */
  lg(type, d) { this.logHook(type, d); }
  size(type) {
    const d = DINOS[type], info = this.motions.dinos[type].idle;
    return { bw: info.w * d.scale, bh: info.h * d.scale };
  }
  nFrames(type, motion) { return this.motions.dinos[type].motions[motion].n; }
  frameOf(e) { return animFrame(e.anim, this.nFrames(e.type, e.anim.motion)); }

  makeEntity(type, x, y) {
    const d = DINOS[type];
    const s = this.size(type);
    return {
      id: ++this.nextId, type, d, isPlayer: type === PLAYER,
      x, y, vx: 0, vy: 0, facing: 1,
      hp: d.hp, maxHp: d.hp, bw: s.bw, bh: s.bh,
      state: 'idle', t: 0, anim: null, onGround: true, sup: 'ground', dropIgnore: null,
      flash: 0, tele: false, move: null, cd: 0.6, rot: 0, guarding: false, guardT: 0,
      wallHit: 0, stunT: 0, aiS: null, landed: false, dead: false, inv: 0,
      // ライバル（色違いのスピノ）だけが使う：ゲージ・つなぎ・ダッシュ・被弾の数え
      rival: !!d.rival, gauge: d.rival ? RIVAL_TUNE.gaugeStart : 0, chain: null, dashT: 0, steer: 0, recent: 0, recentT: 0,
      cbN: 0, cbT: 0, cbLock: 0, breaking: false, breakPending: false, dropRoar: false,
      rage: null, roarCd: 0, heldBy: null,      // 版2.4：怒り（null か倍率の表）・ライバルの咆哮の待ち・主人公の必殺技を受けている技
    };
  }

  // ---- アニメ ----
  loopAnim(e, name, period) {
    const a = e.d.anim[name];
    if (!a) return;
    const dur = period || a[3];
    if (e.anim && e.anim.key === name) { e.anim.dur = dur; return; }
    e.anim = { key: name, motion: a[0], from: a[1], to: a[2], dur, loop: true, t: 0 };
  }
  onceAnim(e, name, dur) {
    const a = e.d.anim[name];
    if (!a) return;
    e.anim = { key: name + '#', motion: a[0], from: a[1], to: a[2], dur: dur || a[3], loop: false, t: 0 };
  }
  holdAnim(e, name) {
    const a = e.d.anim[name];
    if (!a) return;
    if (e.anim && e.anim.key === name) return;
    e.anim = { key: name, motion: a[0], from: a[1], to: a[1], dur: 1, loop: false, t: 0 };
  }
  tickAnim(e, dt) { if (e.anim) e.anim.t += dt; }

  /** 最初から遊び直す（タイトルから）。 */
  resetRun() {
    this.score = 0; this.stageStartScore = 0; this.combo = 0; this.comboT = 0; this.comboDmg = 0; this.maxCombo = 0;
    this.continues = 0; this.stats = { kills: 0, slams: 0, chains: 0, juggles: 0, launchers: 0, airJumps: 0 }; this.time = 0;
  }

  // ---- 面の開始 ----
  startStage(index, { carry = null, revive = false } = {}) {
    const st = this.stages[index];
    this.stageIndex = index;
    this.stage = st;
    this.refreshDiff();
    this.groundY = st.groundY;
    this.platforms = st.platforms.map((p) => ({ ...p }));
    this.hopNext = hopRoutes(this.platforms, st.groundY); this.hopNextFor = this.platforms; this.hopNextN = this.platforms.length; this.hopSig = []; for (const q of this.platforms) this.hopSig.push(q.x, q.y, q.w);      // 版3.2：跳べる敵の道の表（面の読み込みで一度だけ）
    this.rise = st.rise || 0; this.camY = 0; this.camAnchor = 0;      // 版2.3：縦スクロール（面の rise ぶんだけ上へ高い）
    this.water = st.water ? { y: st.water.y } : null;      // 版3.0：海の面。水面（世界 y）。これより下が水
    this.gaps = (st.gaps || []).map((g) => ({ x0: g.x0, x1: g.x1 }));      // 版3.0：海底（地面）が無い所＝落ちると奈落
    this.pit = st.pit ? { y: st.pit.y, dmg: st.pit.dmg ?? PIT.dmg } : null;      // 版3.0：足がこの y を超えたら「落ちてはいけない所」（ダメージ→上から降りて復帰）
    this.sink = st.sink || 0;      // 版3.0：カメラが下へ続く量（0＝従来）
    this.lava = null;
    if (st.lava) {
      const dmg0 = (st.lava.dmg ?? LAVA.dmg) * svar(st, 'lavaDmg');
      this.lava = {
        pools: st.lava.pools.map((p) => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, cx: p.x, sx: p.sx, sw: p.sw })),
        dmg0,
        dmg: Math.max(1, Math.round(dmg0 * (this.diff.lavaMul ?? 1))),
        period: (st.lava.period ?? LAVA.period) / svar(st, 'lavaSpeed'),
      };
    }
    this.lavaT = 0;      // 水位は lavaT で上下する
    this.enemies = [];
    this.fx = []; this.texts = []; this.waves = []; this.roars = [];
    this.shake = 0; this.hitstop = 0; this.slow = null; this.purge = null; this.flashFx = null; this.timeScale = 1; this.cutin = null; this.bombs = []; this.eruption = null;
    this.combo = 0; this.comboT = 0; this.comboDmg = 0; this.stageMaxCombo = 0;
    this.timeMax = this.timeLimitOf(st); this.timeLeft = this.timeMax;
    this.stageT = 0;
    this.bossSpawned = false;
    this.stageContinues0 = this.continues || 0;      // 版2.1：この面で倒れた回数（雑魚呼びの救済）の起点
    this.reader.reset();
    this.practice = null;
    this.stageStartScore = this.score;
    this.exitRequested = false;
    this.endingRequested = false; this.titleRequested = false;
    this.introDur = st.boss ? 2.4 : 1.3;
    const p = this.makeEntity(PLAYER, 150, this.groundY);
    p.gauge = carry ? carry.gauge : 0;
    p.hp = carry ? carry.hp : p.maxHp;
    p.chain = null; p.airJumps = 0; p.jumpCut = false; p.downT = 0;
    p.dashT = 0; p.guardOkT = 0; p.guarding = false; p.hangT = 0; p.hangUsed = false; p.guardHoldT = 0; p.parryOpen = false; p.parryLockT = 0;
    if (st.start) {      // 版3.0：面の出発点（足場の上など）。省略は従来どおり（x=150・地面）
      const pl = st.start.plat !== undefined && st.start.plat !== null ? this.platforms[st.start.plat] : null;
      p.x = st.start.x ?? 150;
      if (pl) { p.y = pl.y; p.sup = pl; } else { p.y = this.groundY; p.sup = 'ground'; }
    }
    p.swim = false; p.wet = false; p.safe = { x: p.x, sup: p.sup }; p.safeDry = this.water ? { x: p.x, sup: p.sup } : null;
    this.player = p;
    if (this.rise || this.sink) this.camY = this.camAnchor = clamp(this.supportTop(p) - CAM.feetY, -this.rise, this.sink);      // 版3.0：出発点の足場に合わせて始める
    const ent = seaEntry(st, carry && carry.sea, p.bh);      // 海の面の移り：海から海＝前の面の深さのまま水の中から始める
    this.seaEntered = null;
    if (ent) {
      p.x = ent.x; p.y = ent.y; p.sup = null; p.onGround = false; p.vx = 0; p.vy = 0; p.facing = 1;
      p.swim = true; p.wet = true;
      const sp = st.platforms[st.start.plat];
      if (sp) { p.safe = { x: st.start.x ?? 150, sup: this.platforms[st.start.plat] }; p.safeDry = { x: st.start.x ?? 150, sup: this.platforms[st.start.plat] }; }
      this.camAnchor = ent.anchor; this.camY = ent.cam;
      this.seaEntered = { x: ent.x, y: ent.y, depth: ent.y - st.water.y };
    }
    this.director = { next: 0, timer: 0, queue: [] };
    this.phase = 'intro';
    this.phaseT = 0;
    if (revive) {
      p.hp = p.maxHp; p.gauge = 0;
      p.state = 'revive'; p.t = 0; p.inv = 2.5;
      this.onceAnim(p, 'revive');
    } else {
      this.loopAnim(p, 'idle');
    }
    this.emit({ type: 'bgm', name: st.bgm });
    this.emit({ type: 'stageStart', index, boss: !!st.boss, revive });
    if (this.logHook) this.lg('stage', { k: 'start', i: index + 1, label: st.label, revive: !!revive, hp: Math.round(p.hp), tl: this.timeMax, ...(st.vars ? { vars: st.vars } : {}), ...(st.pkg ? { pkg: st.pkg.id } : {}) });      // 版3.3：面の変数（ステージごとのスライダー）とパッケージ id も記録
  }

  setDifficulty(id) { this.diffId = id; this.refreshDiff(); }
  /** 版2.0：いまの難しさ（と、useCurve ならいまの面のワールドの曲線）から this.diff を作り直す。 */
  refreshDiff() {
    const d = this.useCurve && this.stage ? difficultyFor(this.diffId, this.stage.curve ?? this.stage.world) : difficultyOf(this.diffId);      // 版3.0：面の curve（曲線の鍵）が優先。省略はワールド番号
    // 版2.6：調整スライダー（src/tune.js）の割合を掛ける（元の表は書き換えない）
    this.diff = { ...d, enemyDmg: d.enemyDmg * tn('enemyDmg') * this.svn('dmgMul'), atkGap: d.atkGap * tn('enemyGap'), guardMul: d.guardMul * tn('guardChance'),
      rivalGauge: d.rivalGauge * tn('rivalGauge'), summonMul: d.summonMul * tn('summonCount'), parryMul: (d.parryMul || 1) * tn('parryWindow') };
    if (this.lava) this.lava.dmg = Math.max(1, Math.round(this.lava.dmg0 * (this.diff.lavaMul ?? 1)));
  }
  /** 版1.3：その面の制限時間（秒）＝面の表の timeLimit（無ければ TIME_LIMIT.default）× 難しさの timeMul。 */
  timeLimitOf(st) { return Math.round((st.timeLimit ?? TIME_LIMIT.default) * this.diff.timeMul * svar(st, 'timeMul')); }      // 版3.3：× この面の変数（制限時間）
  /** 版1.3：制限時間。0 になっても面は終わらず、体力とゲージが少しずつ減る（体力は約 drainSeconds 秒で尽きる）。 */
  tickTimer(dt) {
    if (this.practice || this.phase !== 'fight') return;
    const p = this.player;
    if (!p || p.state === 'down' || p.state === 'downed' || p.state === 'revive') return;
    if (this.timeLeft > 0) { this.timeLeft = Math.max(0, this.timeLeft - dt); if (this.timeLeft === 0 && this.logHook) this.lg('stage', { k: 'timeup', i: this.stageIndex + 1, label: this.stage.label }); return; }
    this.lastHurtSrc = { by: 'time', mv: null };
    p.gauge = Math.max(0, p.gauge - TIME_LIMIT.gaugeDrain * dt);
    p.hp = Math.max(0, p.hp - (p.maxHp / TIME_LIMIT.drainSeconds) * dt);
    if (p.hp <= 0) this.hurtPlayer(0, -p.facing, 0, 0, 0);
  }

  /** 版1.3：やられたあと「続ける」を選んだとき：その場で復活（面の頭に戻さない）。倒した敵は倒れたまま・残りの敵はそのまま。短い無敵。 */
  continueHere() {
    const p = this.player;
    this.continues++;
    p.hp = p.maxHp; p.gauge = this.mpFree ? 100 : Math.max(p.gauge || 0, CONTINUE_CP); p.state = 'revive';      // 版2.8b：復活は CP を半分（50）まで回復。もともと多ければ減らさない（Nao「コンティニューのときは CP を半分で回復して復活」）
    p.t = 0; p.inv = 2.0; p.vx = 0; p.vy = 0;
    p.move = null; p.chain = null; p.tele = false; p.guarding = false; p.hangT = 0; p.dashT = 0; p.rp = null; p.repelT = 0; p.shakeAmp = 0;
    this.onceAnim(p, 'revive');
    p.rr = null;
    // 2026-11-14：海底の裂け目の中（奈落の手前・下）で倒れたときは、奈落から戻すのと同じ足場の上で復活する（前は沈んだ所で復活し、直後に FALL! のダメージを受けた）
    if (WATER.trenchFix && this.pit && (p.y > this.pit.y - 4 || (this.water && this.gaps.length && this.inGap(p.x) && p.y > this.groundY - 10))) {
      const spot = this.pitSafeSpot(p);
      p.x = spot.x; p.y = spot.supY; p.onGround = true; p.sup = spot.safe.sup && spot.safe.sup !== 'ground' ? spot.safe.sup : 'ground'; p.dropIgnore = null; p.swim = false; p.wet = this.inWater(p);
      this.camAnchor = clamp(spot.supY - CAM.feetY, -(this.rise || 0), this.sink || 0); this.camY = this.camAnchor;
    }
    const rd = this.playerDefs && this.playerDefs.roar;      // 版2.4：復活は咆哮から（既存の咆哮の絵）。終わるまで操作は受けない
    if (rd && rd.phases && rd.phases.length) { p.rr = { def: rd, i: 0, pt: 0 }; this.reviveRoarEnter(p, 0); }
    if (this.logHook) this.lg('stage', { k: 'continue', i: this.stageIndex + 1, label: this.stage.label, n: this.continues });
    this.phase = 'fight'; this.phaseT = 0;
    this.slow = null; this.purge = null; this.timeScale = 1; this.hitstop = 0; this.cutin = null; this.bombs = []; this.eruption = null;
    this.endCombo();
    if (this.timeLeft <= 0) this.timeLeft = TIME_LIMIT.continueSeconds;
    this.emit({ type: 'bgm', name: this.stage.bgm });
  }

  /** 版2.4：復活の咆哮の区間に入る。絵は技の表の咆哮と同じ。輪の合図（roarFx）で光の輪を出し、近くの敵を押し返す（ダメージ・ヒット数・ゲージ・コンボは動かさない）。 */
  reviveRoarEnter(p, i) {
    const rr = p.rr, ph = rr.def.phases[i];
    rr.i = i;
    p.anim = { key: 'rv' + i, motion: ph.m || rr.def.motion, from: ph.from, to: ph.to, dur: ph.dur, loop: false, t: 0 };
    if (ph.sfx) this.sfx(ph.sfx);
    if (ph.ev === 'roarFx') {
      this.moveEvent(p, 'roarFx', ph);
      const reach = 560 * PLAYER_WAVE_RANGE * PLAYER_ROAR_SCALE + p.bw * 0.5;
      for (const t of this.enemies) {
        if (!(t.state === 'idle' || t.state === 'move' || t.state === 'hurt' || t.state === 'stun')) continue;
        if (t.breaking && t.state === 'move') continue;      // カウンター改：カウンターの最中は咆哮でも止まらない
        if (Math.abs(t.x - p.x) > reach || Math.abs(t.y - p.y) > 400) continue;
        const dir = sign(t.x - p.x) || p.facing;
        t.move = null; t.tele = false; t.guarding = false; t.moveV = null; t.rp = null; t.repelT = 0;
        t.state = 'hurt'; t.stunT = 0.5; t.vx = dir * 900 / (t.d.weight || 1);
        this.onceAnim(t, 'hurt', 0.5);
      }
    }
  }

  /** やられたあと「続ける」を選んだとき：その面の最初から（版1.2まで。試験用に残す）。 */
  continueStage() {
    this.continues++;
    this.score = this.stageStartScore;
    this.startStage(this.stageIndex, { carry: null, revive: true });
  }

  // ---- 足場 ----
  /** 海の面の移り：面を出る時点の水の中の状態（次の面へ引き継ぐ）。水の面で、体の中心が水面より下（海底や海中の石板に立っていても）なら wet。 */
  seaCarry() {
    const p = this.player;
    if (!this.water || !p) return null;
    return { wet: this.inWater(p), depth: p.y - this.water.y, camY: this.camY, y: p.y };
  }
  supportTop(e) { return e.sup === 'ground' || !e.sup ? this.groundY : e.sup.y; }
  /** 版3.0：海底（地面）が無い所（裂け目）か。 */
  inGap(x) { for (const g of this.gaps) if (x > g.x0 && x < g.x1) return true; return false; }
  /** 版3.0：体の中心が水面より下か（水の中）。水の無い面は常に false。 */
  inWater(e) { return !!this.water && e.y - e.bh * 0.5 > this.water.y; }
  /** 版3.0：飛ぶ・浮く敵の高さの基準。海の面は水面の少し上（足場の高さ）、陸の面は地面。 */
  /** 版3.2：主人公が立っている面（足場）が地面（海は水面）より高い px。飛ぶ敵の入場の高さに足す。主人公が空中・足場に立っていなければ 0。 */
  flyRefLift() {
    const p = this.player;
    if (!p || !p.onGround || !p.sup) return 0;
    const g0 = this.water ? this.water.y : this.groundY;
    return Math.max(0, g0 - (this.water ? Math.min(this.supportTop(p), g0) : this.supportTop(p)));
  }
  /** 版3.2：跳べない重い雑魚（突進・盾・複数技の歩く敵）か。主人公が足場の上にいるとき、入場と足場の下への移動を速くする対象。 */
  heavyRush(d) {
    const t = d.ai && d.ai.type;
    return this.flyRefLift() > 0 && !d.hop && !d.flying && !d.swim && d.tier !== 'boss' && !d.rival && (t === 'charger' || t === 'tank' || t === 'multi');
  }
  flyBaseY() { return this.water ? this.water.y - 60 : this.groundY; }
  /** 版3.0：水面をまたいだときの水しぶき。k＝勢い（0〜1）。輪（水面にそって広がる）と、はねる水滴。 */
  splash(x, k = 1) {
    const w = this.water;
    if (!w) return;
    k = clamp(k, 0.2, 1);
    this.ring(x, w.y, { r0: 14, r1: 70 + 120 * k, dur: 0.45, color: '#e8fbff', flat: true, w: 7 });
    for (let i = 0; i < 6 + Math.round(10 * k); i++) this.fx.push({ type: 'drop', x: x + this.rand(-30, 30) * (0.5 + k), y: w.y, vx: this.rand(-140, 140) * (0.5 + k), vy: -this.rand(200, 520) * (0.4 + k), r: this.rand(2, 5), t: 0, dur: this.rand(0.5, 0.9) });
    this.sfx('splash', 0.35 + 0.5 * k, 0.9 + 0.2 * (1 - k));
  }
  /** 版3.0：水中の泡（見た目だけ）。x,y の近くから n 個、ゆっくり浮かぶ。 */
  bubbles(x, y, n = 3, spread = 20) {
    for (let i = 0; i < n; i++) this.fx.push({ type: 'bubble', x: x + this.rand(-spread, spread), y: y + this.rand(-spread, spread), vy: -this.rand(40, 110), r: this.rand(2.5, 6), t: 0, dur: this.rand(0.8, 1.6) });
  }

  landingSurface(e, py) {
    let best = null;
    if (py <= this.groundY + 2 && e.y >= this.groundY && !this.inGap(e.x)) best = { y: this.groundY, ref: 'ground' };
    for (const p of this.platforms) {
      if (e.dropIgnore === p || e.noPlat) continue;
      if (e.x < p.x - 10 || e.x > p.x + p.w + 10) continue;
      if (py <= p.y + 2 && e.y >= p.y && (!best || p.y < best.y)) best = { y: p.y, ref: p };
    }
    return best;
  }

  physicsBody(e, dt) {
    if (e.d.swim) { this.swimBody(e, dt); return; }      // 版3.0：水の中を泳ぐ敵
    if (e.d.flying && !e.landed) {
      e.x += e.vx * dt; e.y += e.vy * dt;
      this.clampWalls(e);
      return;
    }
    // 版3.0：水の中（空中で、体の中心が水面より下）では重力でなく水の抵抗。落ちる勢いは水に入るとすぐ弱まり、泳ぎの上下の速さは playerFree が決める
    const wet = !!this.water && !e.onGround && this.inWater(e);
    if (wet) {
      if (!e.swimCtl) e.vy *= Math.exp(-WATER.drag * dt);      // 泳ぎの操作で上下に動いている間は、抵抗をかけない（操作の速さがそのまま出る）
      if (e.isPlayer && e.state === 'move') e.vx *= Math.exp(-WATER.moveDrag * dt);      // 技の最中は、踏み込みの横の勢いも水の抵抗でおさまる（地上のように止まる）
      // 海底の裂け目の中は、下へ引く強い流れ（泳いで上がれない）＝落ちてはいけない所（pit）へ。
      // 2026-11-14：力尽きた主人公（down・downed）は奈落の判定の外なので、流れも掛けない（前は底の無いまま沈み続け、GAME OVER の画面から消えた）
      const dead = e.isPlayer && (e.state === 'down' || e.state === 'downed');
      if (this.gaps.length && e.y > this.groundY - 10 && this.inGap(e.x) && !(dead && WATER.trenchFix)) e.vy += WATER.trenchPull * dt;
    } else if (!e.onGround) e.vy += GRAV * (e.gravMul ?? 1) * dt;
    const py = e.y, px = e.x;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    // 2026-11-14：海の面で、海底の線より下にいてよいのは裂け目の中だけ。裂け目から横へ出ようとしたら縁を壁にする（前は砂の下を潜って横へ泳ぎ続けられた）。
    // ほかの道（技の踏み込み等）で砂の下にいたら海底の上へ戻す。力尽きた主人公は奈落の高さで止める。つまみ WATER.trenchFix（false で旧）
    if (WATER.trenchFix && e.isPlayer && this.water && !e.onGround) {      // 裂け目の無い海の面（4-2 など）でも、何かの拍子に海底の下へ出たら海底の上へ戻す（下から海底の線を越えても着地しないので、前は砂の下に居続けた）
      // 前のコマですでに海底の線より下にいたときだけ（上から海底へ降りてきた着地は、下の landingSurface→onLand に任せる。
      // 2026-11-15 見直し：前は降りてきた着地もここで横取りして onLand を飛ばし、空中ジャンプ・昇りの静止・ボスの空中の数が着地で戻らなかった）
      if (py > this.groundY + 2 && e.y > this.groundY + 1 && !this.inGap(e.x)) {
        const g = this.gaps.find((q) => px > q.x0 && px < q.x1);
        if (g) { e.x = clamp(e.x, g.x0 + 1, g.x1 - 1); e.vx = 0; }
        else { e.y = this.groundY; e.vy = 0; e.onGround = true; e.sup = 'ground'; this.onLand(e, 0); }      // 砂の下から戻したときも着地として扱う（空中の数などを戻す）
      }
      if (this.pit && (e.state === 'down' || e.state === 'downed') && e.y > this.pit.y) { e.y = this.pit.y; e.vy = 0; }
    }
    if (e.dropIgnore && e.y > e.dropIgnore.y + 16) e.dropIgnore = null;
    if (e.onGround) {
      const p = e.sup;
      if (p && p !== 'ground' && (e.x < p.x - 10 || e.x > p.x + p.w + 10)) { e.onGround = false; e.sup = null; }
      else if ((!p || p === 'ground') && this.gaps.length && this.inGap(e.x)) { e.onGround = false; e.sup = null; }      // 版3.0：海底の裂け目へ踏み出した
      else { e.y = this.supportTop(e); e.vy = 0; }
    } else if (e.vy >= 0) {
      const s = this.landingSurface(e, py);
      if (s) {
        const impact = e.vy;
        e.y = s.y; e.vy = 0; e.onGround = true; e.sup = s.ref;
        this.onLand(e, impact);
      }
    }
    this.clampWalls(e);
  }

  /**
   * 版3.0：泳ぐ敵（d.swim）の動き。速さ（vx・vy）は AI（aiSwimmer）か技の移動（moveV）が決める。ここは位置を進めて、水の外では落とし、水面・海底の内に収める。
   *  ・体の中心が水面より上（水の外）では重力 WATER.airG で落ちる（水面から飛び出して噛みつく技の最中は、技が重力を持つ＝moveV.g）。
   *  ・水から出てよいのは飛び出しの技（moveV.g がある間）だけ。それ以外は、体の中心が水面の下 0.2 体高より上へは行かない。
   *  ・足（e.y）は海底（groundY）より下へ行かない（裂け目の上は、落ちてはいけない所 pit の手前まで）。
   */
  swimBody(e, dt) {
    const w = this.water;
    if (!w) { e.x += e.vx * dt; e.y += e.vy * dt; this.clampWalls(e); return; }
    const arc = !!(e.moveV && e.moveV.g);
    const cy0 = e.y - e.bh * 0.5;
    const air0 = cy0 < w.y;
    if (air0 && !(e.state === 'move' && e.moveV)) e.vy += WATER.airG * dt;
    else if (!air0 && (e.state === 'hurt' || e.state === 'stun')) e.vy *= Math.exp(-WATER.drag * dt);
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (!arc) {
      const topC = w.y + e.bh * 0.2;
      if (e.y - e.bh * 0.5 < topC && e.vy < 0 && !air0) { e.y = topC + e.bh * 0.5; e.vy = 0; }
    }
    const floorY = this.inGap(e.x) ? (this.pit ? this.pit.y - 4 : this.groundY + 400) : this.groundY - 2;
    if (e.y > floorY) { e.y = floorY; if (e.vy > 0) e.vy = 0; }
    const air1 = e.y - e.bh * 0.5 < w.y;
    if (e.wasAir === undefined) e.wasAir = air0;
    if (air1 !== e.wasAir) {
      if (Math.abs(e.vy) > 160) this.splash(e.x, Math.abs(e.vy) / 900);
      e.wasAir = air1;
    }
    this.clampWalls(e);
  }

  clampWalls(e) {
    e.wallHit = 0;
    if (e.state === 'enter' || e.state === 'dying' || e.state === 'bullet') return;
    const lim = e.bw * 0.33;
    if (e.x < lim) { e.x = lim; e.wallHit = -1; if (e.vx < 0) e.vx = 0; }
    else if (e.x > W - lim) { e.x = W - lim; e.wallHit = 1; if (e.vx > 0) e.vx = 0; }
  }

  onLand(e, impact) {
    if (e.state === 'drop') {
      e.state = 'idle'; e.cd = 0.5; e.vx = 0;
      this.dust(e.x, e.y, 10, e.bw * 0.35);
      this.ring(e.x, e.y, { r0: 20, r1: e.bw * 0.7, dur: 0.4, color: '#ffe9b0', flat: true });
      this.shakeAdd(Math.min(10, 4 + e.bw / 90));
      this.sfx('land', 0.8);
      if (e.dropRoar) { e.dropRoar = false; e.noPlat = false; e.facing = this.player.x >= e.x ? 1 : -1; this.startMove(e, 'roar', { windup: 0.4 }); this.shakeAdd(16); }
    } else if (e.isPlayer && impact > 500) {
      this.dust(e.x, e.y, 5, e.bw * 0.25);
      this.sfx('land', 0.35, 1.3);
    }
    if (e.isPlayer) { e.airJumps = 0; e.hangUsed = false; e.hangT = 0; e.bossAir = 0; }     // 空中ジャンプは空中で当てたときだけ戻る。着地で使い切り。頂点の静止も着地で使い切り
  }

  // ---- 演出の小物 ----
  shakeAdd(a) { this.shake = Math.min(26, Math.max(this.shake, a)); }
  addHitstop(t) { this.hitstop = Math.max(this.hitstop, t); }
  spark(x, y, kind, dir = 1, size = 1) { this.fx.push({ type: 'spark', kind, x, y, dir, size, t: 0, dur: kind === 'parry' ? 0.5 : kind === 'big' ? 0.38 : 0.26 }); }
  ring(x, y, o) { this.fx.push({ type: 'ring', x, y, r0: o.r0 || 10, r1: o.r1 || 120, t: 0, dur: o.dur || 0.4, color: o.color || '#fff', flat: !!o.flat, w: o.w || 6 }); }
  dust(x, y, n, spread) {
    for (let i = 0; i < n; i++) {
      this.fx.push({ type: 'dust', x: x + this.rand(-spread, spread), y: y - this.rand(0, 8),
        vx: this.rand(-120, 120), vy: this.rand(-160, -30), r: this.rand(8, 20), t: 0, dur: this.rand(0.35, 0.7) });
    }
  }
  popup(x, y, str, o = {}) {
    this.texts.push({ x, y, vy: o.vy ?? -60, t: 0, dur: o.dur || 0.8, str, size: o.size || 26, color: o.color || '#fff', ...(o.num !== undefined ? { num: o.num } : null) });      // 版3.5：num＝ダメージの元の値（描くときだけ表示倍率をかける。str は元の数字のまま）
  }
  flashScreen(color, dur) { this.flashFx = { t: 0, dur, color }; }

  addCombo(n = 1) {
    for (let i = 0; i < n; i++) {
      this.combo++;
      if (this.combo % 10 === 0) this.comboMilestone();
    }
    this.comboT = this.comboWindow();
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    if (this.combo > this.stageMaxCombo) this.stageMaxCombo = this.combo;
  }
  /** 版2.6：コンボが切れるまでの猶予（秒）。 */
  comboWindow() { return COMBO.window * tn('comboWindow'); }
  /** コンボ数によるスコア倍率（20で2倍、60で4倍まで）。 */
  scoreMul() { return 1 + Math.min(3, this.combo * 0.05); }
  /** コンボ数によるゲージの溜まりやすさ（15で2倍、30で3倍まで）。 */
  gaugeMul() { return 1 + Math.min(GAUGE_TUNE.comboMax, this.combo / GAUGE_TUNE.comboDiv); }
  addScore(base) { const v = Math.round(base * this.scoreMul()); this.score += v; return v; }      // 2026-11-14：実際に足した点を返す（撃破の浮き数字に使う）
  addGauge(v) { const p = this.player; if (p) p.gauge = Math.min(100, p.gauge + v * GAUGE_TUNE.hit * this.gaugeMul() * tn('cpGain')); }

  /** 10コンボごとの小さな演出。 */
  comboMilestone() {
    const p = this.player;
    if (!p) return;
    this.ring(p.x, p.y - p.bh * 0.5, { r0: 30, r1: 260, dur: 0.5, color: '#7df0ff', w: 8 });
    this.ring(p.x, p.y, { r0: 30, r1: 360, dur: 0.6, color: '#ffe14a', flat: true, w: 8 });
    this.popup(p.x, p.y - p.bh - 36, this.combo + ' HIT!!', { color: '#7df0ff', size: 40, dur: 1.0 });
    p.gauge = Math.min(100, p.gauge + GAUGE_TUNE.milestone);
    this.sfx('powerup', 0.8);
    this.shakeAdd(6);
    this.flashScreen('rgba(160,240,255,0.22)', 0.2);
  }

  /** コンボが途切れた：評価とまとめ点。 */
  endCombo() {
    const n = this.combo;
    if (n >= 5) {
      const bonus = Math.round(n * 60 * (1 + n / 20));
      const rating = n >= 50 ? 'LEGENDARY!!!' : n >= 35 ? 'EXCELLENT!!!' : n >= 20 ? 'AMAZING!!' : n >= 10 ? 'GREAT!' : 'NICE!';
      this.score += bonus;
      this.emit({ type: 'comboEnd', n, bonus, rating, dmg: this.comboDmg || 0 });
      this.sfx(n >= 20 ? 'clear' : 'powerup', 0.7);
    }
    if (this.logHook && n > 0) this.lg('combo', { n });
    this.combo = 0; this.comboT = 0; this.comboDmg = 0;
    for (const o of this.enemies) { o.breakPending = false; o.cbN = 0; o.cbT = 0; }      // カウンター改：コンボが終わったら、仕掛ける予定のカウンターも、ボス側の被弾数の数え直しも消える（レビュー7）
  }

  // ---- 敵の登場 ----
  /** plat＝面の platforms の添字。指定すると、その足場の上へ上から降りてくる（x は足場の幅の内側に収める）。 */
  spawnEnemy(type, from, x, plat) {
    const e = this.makeEntity(type, 0, this.groundY);
    const d = e.d;
    if (isBossLike(d)) this.bossSpawned = true;
    const lim = e.bw * 0.33;
    if (from === 'top' && d.swim && this.water) from = (x ?? W / 2) < W / 2 ? 'left' : 'right';      // 点検と監修：泳ぐ敵は水の中へ横から入る（上から落とすと着地の高さが NaN で入場のまま下がり続けた）
    if (this.water && (from === 'left' || from === 'right') && !d.swim && !d.flying) {      // 版3.0（背景の描き直し）：陸地は無い。陸の敵は、浮きブロック（plat。省略は、その側のいちばん外のブロック）の上へ上から降りてくる。降りる位置は、ブロックの外側寄り（左から＝左寄り・右から＝右寄り）
      let pi = plat !== undefined && plat !== null ? plat : this.platforms.indexOf(this.shoreFor(from));
      if (pi < 0) pi = 0;
      const pl = this.platforms[pi];
      if (pl) { x = pl.x + pl.w * (from === 'left' ? 0.3 : 0.7); plat = pi; from = 'top'; }
    }
    if (from === 'left' || from === 'right') {
      e.state = 'enter';
      e.facing = from === 'left' ? 1 : -1;
      e.x = from === 'left' ? -e.bw * 0.5 - 40 : W + e.bw * 0.5 + 40;
      e.vx = e.facing * d.speed * (d.tier === 'boss' ? 1.6 : 1.5) * (this.heavyRush(d) ? CHASE.enterRush : 1);      // 版3.2：主人公が足場の上にいるとき、跳べない重い敵は駆け足で入ってくる
      e.enterTo = from === 'left' ? lim + 24 : W - lim - 24;
      if (isBossLike(d) && ENTER.maxT > 0 && Math.abs(e.enterTo - e.x) > Math.abs(e.vx) * ENTER.limitT) {      // 版2.6：歩いて入るのに ENTER.limitT 秒を超えるボス（ティタノ）だけ、出現位置を近づけて ENTER.maxT 秒で入りきる（歩く速さは変えない）
        e.vx = sign(e.vx) * Math.abs(e.enterTo - e.x) / ENTER.maxT;      // 出現位置は画面の外のまま、速く歩いて入る（歩きの絵の周期は下で速さに合わせて縮める＝足は滑らない）
      }
      if (d.swim && this.water) {      // 版3.0：泳ぐ敵は水の中（水面の少し下）から入ってくる。深さは敵ごとに少しずらす
        e.y = this.water.y + e.bh * 0.5 + (d.tier === 'boss' ? 150 : 90) + this.rand(0, 160); e.vx = e.facing * d.speed * 1.2;
        e.y = Math.min(e.y, this.groundY - 4);
      } else if (d.flying) { e.y = this.flyBaseY() - d.ai.altitude + this.rand(-30, 30) - this.flyRefLift();      // 版3.2：入ってくる高さも、主人公の立つ面（足場）の高さ基準
         e.vx = e.facing * d.speed * 1.2; }
      else if (this.water) {      // 版3.0：海の面では、陸の敵は岸（足場）を歩いて入ってくる。plat＝足場の添字（省略は、その側のいちばん外の足場）
        const pl = plat !== undefined && plat !== null ? this.platforms[plat] : this.shoreFor(from);
        if (pl) { e.y = pl.y; e.sup = pl; e.onGround = true; }
      }
      const wk = d.anim.walk;   // 本物の歩き（Walk。ライバルは走りの Run）は、入場の速さ（移動速度の1.2〜1.6倍）に合わせて1周を縮める＝足が滑らない
      this.loopAnim(e, 'walk', wk && (wk[0] === 'Walk' || wk[0] === 'Run') ? wk[3] * d.speed / Math.abs(e.vx) : undefined);
    } else { // top: 上から落ちてくる
      e.state = 'drop';
      e.x = clamp(x ?? this.rand(300, 980), lim + 20, W - lim - 20);
      const pl = plat !== undefined && plat !== null ? this.platforms[plat] : null;
      if (pl) e.x = clamp(x ?? pl.x + pl.w / 2, pl.x + 24, pl.x + pl.w - 24);
      if (!pl && this.lava && !d.flying && !isBossLike(d)) e.x = this.outsideLavaX(e, e.x, lim + 20, W - lim - 20);      // 版3.3：池の真上から落とさない（池の外の近い側へずらす）
      e.y = this.enterTopY(e, pl);      // 版2.3：画面の上の外（カメラ基準）から降りる。足場へ降りるときは、足場の上にも十分な高さを取る
      e.onGround = false; e.sup = null; e.vy = 60;
      e.facing = this.player && this.player.x > e.x ? 1 : -1;
      this.loopAnim(e, 'idle');
      if (d.rival) { e.dropRoar = true; e.vy = 320; e.x = W / 2; e.noPlat = true; this.holdAnim(e, 'fall'); }      // 版1.1：ライバルは上から中央へ降りてきて、着地してすぐ咆哮から始まる
      if (d.flying) { e.state = 'enter'; e.facing = 1; e.vx = 0; e.y = this.camY - 80; e.enterTo = e.x; e.fallIn = true; }
    }
    { const k = (e.rival ? this.diff.rivalHp : this.diff.enemyHp) * (isBossLike(d) ? tn('hpBoss') * ((this.stage && this.stage.bossHp) ?? 1) : tn('hpGrunt')) * this.svn('hpMul'); if (k !== 1) e.hp = e.maxHp = Math.max(1, Math.round(e.maxHp * k)); }      // 版1.3：難しさ（版2.6：調整スライダー）
    this.enemies.push(e);
    return e;
  }

  /** 版3.0：from（'left'/'right'）の側の、いちばん外にある足場（岸）。無ければ null。 */
  shoreFor(from) {
    let best = null;
    for (const p of this.platforms) {
      if (p.y >= this.water.y) continue;      // 水面より下の足場には出さない
      if (!best || (from === 'left' ? p.x < best.x : p.x + p.w > best.x + best.w)) best = p;
    }
    return best;
  }
  /** 版2.3：上から降りてくる敵の出だしの y。絵の下端が、いまの画面の上端（カメラ）より上＝画面の外。足場へ降りるなら足場より上でもある。 */
  enterTopY(e, pl) {
    let y = this.camY - e.bh - 60;
    if (pl) y = Math.min(y, pl.y - e.bh - 60);
    return y;
  }
  /** 版2.3：世界の点 (x,y)（絵の外接の半径 r）がいまの画面（カメラ）に少しでも入っているか。 */
  inView(x, y, r = 0) { return x + r > 0 && x - r < W && y + r > this.camY && y - r < this.camY + H; }

  aliveCount() { let n = 0; for (const e of this.enemies) if (e.state !== 'dying' && !e.dead) n++; return n; }
  minionCount() { let n = 0; for (const e of this.enemies) if (e.d.tier !== 'boss' && e.state !== 'dying' && !e.dead) n++; return n; }

  /** 版3.3：この面の変数（ステージごとのスライダー）の倍率。100% → 1。最終値 ＝ グローバル（tn）× ステージごと（svn）。 */
  svn(id) { return svar(this.stage, id); }
  /**
   * 版3.3：波ごとの敵の数（変数 countMul）と水の敵の数（swimMul）。ボス級はそのまま、雑魚は各波に最低 1 体。
   * 増やすときは同じ顔ぶれを左右交互に足す（scaleSummon と同じ）。倍率が 1 のときは元の並びをそのまま返す。
   */
  scaleWaveCounts(list) {
    const km = this.svn('countMul'), ks = this.svn('swimMul');
    if (km === 1 && ks === 1) return list;
    const groups = [[], [], []];      // 雑魚・水の敵・ボス級
    for (const e of list) groups[isBossLike(DINOS[e.type]) ? 2 : DINOS[e.type].swim ? 1 : 0].push(e);
    const out = [];
    groups.forEach((g, gi) => {
      const k = gi === 2 ? 1 : gi === 1 ? km * ks : km;
      if (!g.length || k === 1) { out.push(...g); return; }
      const n = Math.max(1, Math.round(g.length * k));
      for (let i = 0; i < n; i++) {
        if (i < g.length) out.push(g[i]);
        else { const s0 = g[i % g.length]; out.push({ ...s0, from: s0.from === 'left' ? 'right' : s0.from === 'right' ? 'left' : s0.from, delay: +((s0.delay || 0) + 0.6 * Math.ceil(i / g.length)).toFixed(2) }); }
      }
    });
    return out;
  }

  /** 版2.1：ボス戦の雑魚呼びの倍率（難しさ×ワールド×救済）。いまの主人公の体力と、この面で倒れた回数で決まる。 */
  summonScale() {
    const p = this.player;
    return this.diff.summonMul * summonAid(p ? p.hp / p.maxHp : 1, Math.max(0, (this.continues || 0) - (this.stageContinues0 || 0)));
  }
  /** 雑魚呼びの波（ボス面の2つ目以降の波）の敵の一覧を、倍率に合わせて減らす／増やす（増やすときは同じ顔ぶれを左右交互に足す）。 */
  scaleSummon(specs, k) {
    const n = summonCount(specs.length, k, 1);
    if (n <= specs.length) return specs.slice(0, n);
    const out = specs.slice();
    for (let i = specs.length; i < n; i++) { const s = specs[i % specs.length]; out.push({ ...s, from: s.from === 'left' ? 'right' : s.from === 'right' ? 'left' : s.from, delay: +((s.delay || 0) + 0.6 * Math.ceil(i / specs.length)).toFixed(2) }); }
    return out;
  }

  // ---- 波の進行 ----
  updateDirector(dt) {
    const dir = this.director, st = this.stage;
    // ボス戦：ボスを倒したら、まだ出ていない群れの波は打ち切る
    if (st.boss && this.bossSpawned && !this.enemies.some((e) => isBossLike(e.d) && e.state !== 'dying' && !e.dead)) {
      dir.next = st.waves.length; dir.queue.length = 0;
    }
    if (this.purge) return;      // 版2.2：衝撃の輪の間は新しい敵を出さない
    for (const q of dir.queue) q.t -= dt;
    for (let i = dir.queue.length - 1; i >= 0; i--) {
      if (dir.queue[i].t <= 0 && this.aliveCount() < MAX_ENEMIES) {
        const s = dir.queue[i].spec;
        this.spawnEnemy(s.type, s.from, s.x, s.plat);
        dir.queue.splice(i, 1);
      }
    }
    if (dir.next < st.waves.length && dir.queue.length === 0) {
      const w = st.waves[dir.next];
      if (this.aliveCount() <= (w.until ?? 0)) {
        dir.timer += dt;
        if (dir.timer >= w.delay) {
          const list = this.scaleWaveCounts((st.boss && dir.next >= 1) ? this.scaleSummon(w.enemies, this.summonScale()) : w.enemies);      // 版2.1：ボス面の2つ目以降の波＝雑魚呼び。難しさ・ワールド・救済で量を変える
          for (const en of list) dir.queue.push({ t: en.delay || 0, spec: en });
          dir.next++; dir.timer = 0;
        }
      } else dir.timer = 0;
    }
  }

  /**
   * 練習場（URL の ?practice=Triceratops,Allosaurus&gauge=100&hp=600）：波を止めて、指定の敵だけを出し続ける。敵が全滅したら少し間をおいて出し直し、
   * ゲージも gauge まで戻す。hp を付けると敵の体力がその値（的）。技の練習と動画撮影用。面クリアにならない。
   */
  startPractice(types, gauge = 0, hp = 0, hpr = 1) {
    // 2026-11-15（開発用の入口）：DINOS 自身が持つ名前だけ（'constructor'・'toString'・'__proto__' を通さない＝前は NOW LOADING のまま落ちた）。体力は有限の数だけ（Infinity を入れない）
    const own = (t) => typeof t === 'string' && Object.prototype.hasOwnProperty.call(DINOS, t);
    const fin = (v, d, hi) => (Number.isFinite(v) ? Math.min(hi, v) : d);
    this.practice = { types: types.filter((t) => own(t) && t !== PLAYER), gauge: fin(gauge, 0, 100), hp: fin(hp, 0, 1e6), hpr: fin(hpr, 1, 1), wait: 0 };
    gauge = this.practice.gauge;
    this.director.next = 999; this.director.queue.length = 0;
    this.enemies = [];
    if (gauge > 0) this.player.gauge = Math.max(this.player.gauge, gauge);
    this.spawnPractice();
  }
  spawnPractice() {
    const pr = this.practice;
    // 画面の左右の外から交互に歩いて入ってくる（左右から囲まれる場面を作れる）
    pr.types.forEach((t, i) => { const e = this.spawnEnemy(t, i % 2 === 0 ? 'right' : 'left'); if (pr.hp > 0) e.hp = e.maxHp = pr.hp; if (pr.hpr < 1) e.hp = Math.max(1, Math.round(e.maxHp * pr.hpr)); });
  }
  updatePractice(dt) {
    const pr = this.practice;
    if (!pr || this.phase === 'gameover') return;
    if (this.aliveCount() === 0 && !this.enemies.some((e) => e.state === 'dying')) {
      pr.wait += dt;
      if (pr.wait > 0.9) { pr.wait = 0; this.spawnPractice(); if (pr.gauge > 0) this.player.gauge = Math.max(this.player.gauge, pr.gauge); }
    } else pr.wait = 0;
  }

  allWavesDone() {
    if (this.practice || this.purge) return false;
    return this.director.next >= this.stage.waves.length && this.director.queue.length === 0 && this.aliveCount() === 0;
  }

  // ---- 1歩進める ----
  update(dt, inp) {
    if (!Number.isFinite(dt)) return;      // 2026-10-25：NaN・Infinity の時間が来ても、状態を壊さない（座標が NaN のまま二度と戻らなくなるため）。ゲーム本体は 0〜0.05 秒に丸めて渡す
    if (dt > 0.1) {      // 2026-10-25：1 コマで大きく時間が飛んだら（タブを隠したあとの復帰など。ゲーム本体は 0.05 秒に丸めて渡すので普段は来ない）、0.05 秒ずつに分けて進める＝1 歩で敵が壁の外まで歩いたり抜けたりしない。押した瞬間（pressed）は最初の一歩だけ
      const n = Math.min(1200, Math.ceil(dt / 0.05));
      for (let i = 0; i < n; i++) this.update(dt / n, i === 0 ? inp : { held: inp.held, pressed: {} });
      return;
    }
    this.time += dt;
    // 入力は毎ステップ（ヒットストップ中も）記録する。先行入力（押してから0.25秒）は技が出せる状態になった時に使われる。
    this.rtime += dt * (this.cutin ? CUTIN_INPUT.rate : 1);      // 版3.3：カットインの止まりの間は、入力の時計をゆっくり進める（順番は保つ）＝止まりの間に押した入力が、止まり明けに出る
    this.reader.feed(this.rtime, inp.held, inp.pressed);
    { const dn = !!(inp.held && inp.held.down); if (dn && !this._dnHeld) this.downEdge = true; else if (!dn) this.downEdge = false; this._dnHeld = dn; }      // 2026-11-15 ↓ を押した瞬間の記録（ヒットストップ中の押下も逃さない。主人公が 1 歩動いたら下で消す）
    this.updateFx(dt);
    if (this.cutin) { this.cutin.t += dt; if (this.cutin.t >= this.cutin.dur) this.cutin = null; }      // 版2.7：カットインの時間（ヒットストップと同じ長さだけ画面が止まる）
    this.tickJitter(dt, this.hitstop > 0);
    if (this.hitstop > 0) { this.hitstop -= dt; return; }
    if (this.slow) {
      this.slow.t -= dt;
      this.timeScale = this.slow.scale;
      if (this.slow.t <= 0) { this.slow = null; this.timeScale = 1; }
    }
    this.phaseT += dt;
    if (this.phase !== 'gameover') this.stageT += dt;
    // 版2.6：吹き飛び中の敵がいるだけではコンボを保たない（何も当たらない時間が猶予を超えたら切れる）。壁・玉突き・叩きつけの当たりは addCombo が猶予を戻す。
    this.comboHeld = false;
    if (this.combo > 0) { this.comboT -= dt; if (this.comboT <= 0) this.endCombo(); }
    if (this._tuneVer !== TUNE.ver) { this._tuneVer = TUNE.ver; this.refreshDiff(); }

    if (this.phase === 'intro' || this.phase === 'fight' || this.phase === 'clear') this.updateDirector(dt);
    if (this.practice) this.updatePractice(dt);

    this.tickTimer(dt);
    // 版3.0：水の中では、主人公も敵も時間の流れが WATER.slow 倍（動きが少しゆっくり。水中は敵も遅い）
    const wk = (e) => (this.water && this.inWater(e) ? WATER.slow : 1);
    this.updatePlayer(dt * (this.player ? wk(this.player) : 1), inp);
    this.downEdge = false;
    this.updateWaves(dt);
    this.updateShocks();
    this.updateRoars();
    this.updateBombs(dt);
    this.updatePurge(dt);
    for (const e of this.enemies) { e.hx0 = e.x; this.updateEnemy(e, dt * wk(e)); }
    this.separateEnemies(dt);
    if (this.lava) { for (const e of this.enemies) this.containHazard(e); this.lavaTick(dt); }      // 版3.0：マグマだまり／版3.4：押し合い・水位の上昇で池に入れられそうな敵は、溶ける前に縁の外へ戻す
    this.enemies = this.enemies.filter((e) => !e.dead);

    this.updatePhase(dt);
    this.updateCamera(dt);
  }

  /**
   * 版2.3：縦のカメラ。足場に合わせて落ち着く位置（anchor）に向かってなめらかに動き、頭が上へ・足が下へ出ないように必ず追う。
   * 面の rise が 0 なら camY は動かない（元の1画面）。
   */
  updateCamera(dt) {
    const rise = this.rise || 0, sink = this.sink || 0, p = this.player;
    if ((!rise && !sink) || !p) { this.camY = 0; return; }
    const lim = (v) => clamp(v, -rise, sink);      // 版3.0：下へ続く面（sink）では camY が正にもなる
    if (p.onGround && p.sup) this.camAnchor = lim(this.supportTop(p) - CAM.feetY);
    let target = this.camAnchor;
    const feetLo = p.vy > 200 && !p.onGround ? CAM.fallFeetY : H - CAM.bottomMargin;
    target = Math.min(target, p.y - p.bh - CAM.topMargin);      // 頭が見える
    target = Math.max(target, p.y - feetLo);                    // 足が見える（落ちるときは下を先に見せる）
    target = lim(target);
    this.camY += (target - this.camY) * (1 - Math.exp(-CAM.follow * dt));
    // 必ず映す範囲（頭と足）は、なめらかさよりも優先
    const hi = p.y - p.bh - 40, lo = p.y - (H - 40);
    this.camY = lim(clamp(this.camY, Math.min(lo, hi), Math.max(lo, hi)));
    if (Math.abs(this.camY - target) < 0.05) this.camY = target;
  }

  updatePhase(dt) {
    const p = this.player;
    switch (this.phase) {
      case 'intro':
        if (this.phaseT >= this.introDur) { this.phase = 'fight'; this.phaseT = 0; }
        if (this.allWavesDone() && this.playerAlive()) this.onClear();      // 夜間デバッグ：倒れた主人公は面をクリアできない（相打ちで CLEAR! と GAME OVER が同時に出ていた）。つづけて復活したあとにクリアになる
        break;
      case 'fight':
        if (this.allWavesDone() && this.playerAlive()) this.onClear();
        break;
      case 'clear':
        // 2026-11-15：次の面が無い面（最後の面の印が落ちたパッケージなど）も、最後の面と同じくエンディングへ（前は出口へ歩くと、無い面への面送りで止まった）
        if (this.isLastStage()) {
          if (this.phaseT > 3.2) { this.endingRequested = true; }
        } else if (this.stage.userEnd) {      // 版3.3：ユーザー作の面の最後の面。クリアしたらタイトルへ戻る（エンディングは出さない）
          if (this.phaseT > 3.2) this.titleRequested = true;
        } else if (this.phaseT > 1.0 && p.x >= W - 95 && p.state !== 'down' && p.state !== 'downed') {
          this.exitRequested = true;
        }
        break;
      case 'gameover':
        break;
      default: break;
    }
    if (p.state === 'downed' && this.phase !== 'gameover' && p.downT > 1.2) {
      this.phase = 'gameover'; this.phaseT = 0;
      if (this.logHook) this.lg('stage', { k: 'gameover', i: this.stageIndex + 1, label: this.stage.label, dur: r1(this.stageT), maxCombo: this.stageMaxCombo, score: this.score, left: Math.round(this.timeLeft) });
    }
  }

  onClear() {
    this.endCombo();
    this.phase = 'clear'; this.phaseT = 0;
    const p = this.player;
    const hm = this.diff.healMul, byCombo = Math.min(Math.round(p.maxHp * this.stageMaxCombo * CLEAR_HEAL.perCombo), Math.round(p.maxHp * CLEAR_HEAL.capFrac)) * hm;
    const heal = Math.round(Math.max(Math.round((this.stage.clearHeal || 0) * hm), Math.round(byCombo)) * this.svn('healMul'));      // 版1.3：その面の最大コンボに比例（固定量を下限に）・版3.3：× この面の変数（クリア回復）
    p.hp = Math.min(p.maxHp, p.hp + heal);
    this.score += 1000 + Math.round(p.hp * 10);
    this.sfx('clear');
    this.emit({ type: 'banner', text: this.isLastStage() ? 'ALL CLEAR!' : 'CLEAR!' });
    this.stageClearedAt = this.time;
    this.waves = this.waves.filter((q) => !q.owner);      // 版3.8b：最後の敵が撃った衝撃波が残っていると、クリア後の主人公に当たって死に、クリアが GAME OVER に巻き戻っていた（敵の衝撃波だけ消す。主人公の波は残す）
    if (this.logHook) this.lg('stage', { k: 'clear', i: this.stageIndex + 1, label: this.stage.label, dur: r1(this.stageT), maxCombo: this.stageMaxCombo, hp: Math.round(p.hp), score: this.score, kills: this.stats.kills, left: Math.round(this.timeLeft) });
  }

  // ======== 主人公 ========
  updatePlayer(dt, inp) {
    const p = this.player;
    p.t += dt;
    p.gravMul = 1;
    p.swim = !!this.water && !p.onGround && this.inWater(p);      // 版3.0：泳いでいる（水の中で、足がどこにも着いていない）
    p.swimCtl = false;
    if (p.airJuggleT > 0) { p.airJuggleT -= dt; if (p.state === 'hurt' && !p.onGround) p.gravMul = 0.5; }   // ライバルに打ち上げられた間は、ふわっと昇る
    if (p.inv > 0) p.inv -= dt;
    if (p.flash > 0) p.flash -= dt;
    if (p.repelT > 0) p.repelT -= dt;
    this.tickRepel(p, dt);
    if (this.mpFree) p.gauge = 100;      // 版2.0：CP FREE（原作の「ゲージが常に満タン」）
    if (p.gauge > 100) p.gauge = 100;
    if (p.state !== 'idle') p.guarding = false;
    if (p.guardOkT > 0) p.guardOkT -= dt;
    if (p.parryLockT > 0) p.parryLockT -= dt;
    if (p.guardFlash > 0) p.guardFlash -= dt;
    switch (p.state) {
      case 'idle': this.playerFree(p, dt, inp); break;
      case 'move': this.updateMove(p, dt, inp); break;
      case 'grabbed': this.updateGrabbed(p, dt, inp); break;
      case 'hurt': {
        p.stunT -= dt;
        if (p.lavaArc) { this.tickLavaArc(p, dt); this.tickAnim(p, dt); if (p.stunT <= 0) { p.lavaArc = null; p.state = 'idle'; p.chain = null; } break; }      // 版3.5：溶岩から弾かれている間は操作できない
        if (p.slamArm && !p.onGround) p.vx = p.slamArm.vx;      // 版2.3：壁へ叩きつけられる飛びの間は、横の速さを落とさない
        else if (!p.rp) p.vx -= sign(p.vx) * Math.min(Math.abs(p.vx), 1800 * dt);      // 版1.3：相殺ではじかれ中は tickRepel が速さを決める
        this.tickAnim(p, dt);
        // やられている最中でも、咆哮（fromHurt の行）だけは出せる（無敵の全方位で切り返す）
        const rescue = this.resolvePlayerMove(p, 'hurt', null);
        if (rescue) { this.runPlayerRow(p, rescue, true); break; }
        if (p.stunT <= 0) { p.state = 'idle'; p.chain = null; }
        break;
      }
      case 'down':
        p.downT += dt;
        p.vx -= sign(p.vx) * Math.min(Math.abs(p.vx), 900 * dt);
        this.tickAnim(p, dt);
        if (p.anim && p.anim.t >= p.anim.dur && (p.onGround || p.swim)) { p.state = 'downed'; this.loopAnim(p, 'downed'); }      // 版3.0：水の中なら、沈みきらなくても倒れた姿になる
        break;
      case 'downed':
        p.downT += dt; p.vx = 0; this.tickAnim(p, dt); break;
      case 'revive':
        p.vx = 0;
        if (p.rr) {
          const rr = p.rr; rr.pt += dt;
          while (p.rr && rr.pt >= rr.def.phases[rr.i].dur) {
            rr.pt -= rr.def.phases[rr.i].dur;
            if (rr.i + 1 >= rr.def.phases.length) { p.rr = null; p.state = 'idle'; this.loopAnim(p, 'idle'); break; }
            this.reviveRoarEnter(p, rr.i + 1);
          }
          if (p.rr) p.anim.t = rr.pt;
          break;
        }
        this.tickAnim(p, dt);
        if (p.anim.t >= p.anim.dur) { p.state = 'idle'; }
        break;
      default: break;
    }
    // 頂点の静止：昇りの途中で二人が止まる（重力を切り、縦の速さを0へ寄せる）。この間は殴り放題。
    if (p.airHitT > 0) p.airHitT = p.onGround ? 0 : Math.max(0, p.airHitT - dt);      // 版2.4：空中で当てている間（空中コンボ中）の印。着地で消える
    if (p.hangT > 0) {
      p.hangT -= dt;
      if (!p.onGround && p.state !== 'hurt' && p.state !== 'down') { p.gravMul = 0; p.vy *= Math.exp(-dt * 10); }
    }
    if (!p.lavaArc) this.physicsBody(p, dt);
    if (this.water || this.pit || this.lava) this.tickWaterPlayer(p, dt);      // 版3.0：水しぶき・泡・最後に立っていた場所の記録・落ちてはいけない所
    if (p.slamArm) this.tickSlam(p);
    // 走りの土ぼこり
    if (p.state === 'idle' && p.onGround && Math.abs(p.vx) > 100) {
      p.dustT = (p.dustT || 0) - dt;
      if (p.dustT <= 0) { p.dustT = 0.14; this.dust(p.x - p.facing * p.bw * 0.2, p.y, 1, 10); }
    }
  }

  doJump(p, noCut = false) {
    if (this.water && this.inWater(p)) { this.swimStroke(p); return; }      // 版3.0：水の中のジャンプ＝上へ泳ぐ（水面の近くなら飛び出す）
    p.vy = JUMP_V; p.onGround = false; p.sup = null; p.jumpCut = noCut;
    this.sfx('jump', 0.8); this.dust(p.x, p.y, 4, 30);
  }

  /** 版3.0：水の中でジャンプボタン。上へ蹴って泳ぐ。体の中心が水面から breachBand 以内なら、水面を突き破って飛び出す（水の外のふつうのジャンプの高さ）。海底に立っていても上へ泳ぎ出す。 */
  swimStroke(p) {
    const w = this.water, depth = (p.y - p.bh * 0.5) - w.y;
    const breach = depth <= WATER.breachBand;
    p.vy = breach ? WATER.breach : WATER.stroke; p.onGround = false; p.sup = null; p.jumpCut = true;
    this.stats.strokes = (this.stats.strokes || 0) + 1;
    if (breach) { this.stats.breaches = (this.stats.breaches || 0) + 1; this.sfx('dive', 0.7, 1.1); }
    else this.sfx('bubble', 0.5, 1.2);
    this.bubbles(p.x, p.y - p.bh * 0.3, breach ? 6 : 4, 26);
  }

  /** 版3.0：水の中の主人公の毎コマの仕事。水に入る・出るの水しぶき、泳いでいる間の泡、最後に立っていた場所の記録、落ちてはいけない所（pit）。 */
  tickWaterPlayer(p, dt) {
    if (this.water) {
      const wet = this.inWater(p);
      if (wet !== p.wet) { if (Math.abs(p.vy) > 120 || wet) this.splash(p.x, Math.abs(p.vy) / 900); p.wet = wet; this.stats.wetChanges = (this.stats.wetChanges || 0) + 1; }
      if (wet && !p.onGround && (Math.abs(p.vx) > 60 || Math.abs(p.vy) > 60)) {
        p.bubT = (p.bubT || 0) - dt;
        if (p.bubT <= 0) { p.bubT = 0.22; this.bubbles(p.x - p.facing * p.bw * 0.3, p.y - p.bh * 0.5, 1, 14); }
      }
      p.baseY = p.onGround ? this.supportTop(p) : (wet ? this.water.y + WATER.float + p.bh * 0.5 : (p.baseY ?? this.groundY));      // 版3.0：空中コンボの「高さ」の基準
    }
    if (p.onGround && (p.state === 'idle' || p.state === 'move')) {      // 最後に立っていた場所（落ちたあと、ここの上から降りてくる）。裂け目の縁は避ける
      if (p.sup !== 'ground' || (!this.inGap(p.x - 60) && !this.inGap(p.x + 60) && !this.inLava(p.x, 90))) {
        p.safe = { x: p.x, sup: p.sup };
        if (this.water && p.y < this.water.y) p.safeDry = { x: p.x, sup: p.sup };
      }
    }
    if (this.pit && p.y > this.pit.y && p.state !== 'down' && p.state !== 'downed' && p.state !== 'revive' && p.state !== 'grabbed' && this.phase !== 'gameover') this.pitFall(p);
  }

  /**
   * 版3.0：落ちてはいけない所（pit）に落ちた。ダメージを受けて、最後に立っていた足場の上へ、画面の上から降りてくる（海の面では、水の上の足場を優先）。
   * 降りてくる間は硬直・無敵（PIT.stun・PIT.inv）。体力が尽きたときはそのまま倒れる（倒れる姿は復帰の場所で）。
   */
  /** 2026-11-14：落ちてはいけない所から戻す先（最後に立っていた足場。海の面では水の上の足場を優先）。pitFall と復活（continueHere）が使う。 */
  /** 2026-11-15：クリアしたらエンディングへ行く面か＝最後の面の印（final）がある・次の面が無い（自作の最後の面 userEnd はタイトルへ戻るので除く）。クリアの帯「ALL CLEAR!」・GO の矢印もこれで決める */
  isLastStage() {
    const st = this.stage;
    if (!st) return false;
    return !!st.final || (PKG_LAST.on && !st.userEnd && !!this.stages && !this.stages[this.stageIndex + 1]);
  }

  pitSafeSpot(p) {
    const safe = (this.water && p.safeDry) || p.safe || { x: 150, sup: 'ground' };
    const supY = !safe.sup || safe.sup === 'ground' ? this.groundY : safe.sup.y;
    const lo = safe.sup && safe.sup !== 'ground' ? safe.sup.x + 30 : 80, hi = safe.sup && safe.sup !== 'ground' ? safe.sup.x + safe.sup.w - 30 : W - 80;
    return { safe, supY, x: clamp(safe.x, Math.min(lo, hi), Math.max(lo, hi)) };
  }

  pitFall(p, lava = null) {      // lava＝{dmg}：マグマだまりに落ちた（落ちてはいけない所と同じ復帰）
    const pit = lava || this.pit, spot = this.pitSafeSpot(p), supY = spot.supY;
    if (lava) { this.stats.lavaFalls = (this.stats.lavaFalls || 0) + 1; if (this.logHook) this.lg('lava', { to: 'player', x: Math.round(p.x), hp: Math.round(p.hp), dmg: pit.dmg, mv: 'lava' }); this.ring(p.x, this.groundY, { r0: 20, r1: 150, dur: 0.5, color: '#ff8a2a', flat: true, w: 6 }); this.sfx('hurt'); this.popup(clamp(p.x, 120, W - 120), this.camY + H - 150, 'LAVA!', { color: '#ffb04a', size: 34 }); }
    else {
      this.stats.pitFalls = (this.stats.pitFalls || 0) + 1;
      if (this.logHook) this.lg('pit', { x: Math.round(p.x), hp: Math.round(p.hp), dmg: pit.dmg });
      this.sfx('hurt'); this.sfx('splash', 0.6, 0.8);
      this.popup(clamp(p.x, 120, W - 120), this.camY + H - 120, 'FALL!', { color: '#ff8a7a', size: 34 });
    }
    this.hurtPlayer(this.phase === 'clear' ? Math.min(pit.dmg, Math.max(0, p.hp - 1)) : pit.dmg, 0, 0, PIT.stun, PIT.inv);      // 点検と監修：クリアしたあとは落ちても倒れない（体力 1 は残す。倒れると GAME OVER→復活→もう一度 CLEAR! でクリア点が二重に入った）
    // 復帰の場所へ：足場の上、画面の上の外から降りてくる。カメラは降りる先に合わせて切り替える
    p.x = spot.x;
    this.camAnchor = clamp(supY - CAM.feetY, -(this.rise || 0), this.sink || 0);
    this.camY = clamp(this.camAnchor - 120, -(this.rise || 0), this.sink || 0);
    p.y = Math.min(this.camY - 4, supY - 120); p.vx = 0; p.vy = 0; p.onGround = false; p.sup = null; p.dropIgnore = null; p.wet = this.inWater(p);
    p.swim = false; p.chain = null; p.move = null;
    if (p.state === 'hurt') { p.stunT = PIT.stun; p.rp = null; p.repelT = 0; }
  }


  /** 版3.5：マグマだまりに落ちた主人公。溶岩の表面で一瞬のけぞり、近い池の縁の外の地面へ放物線で弾かれる（LAVA_BOUNCE）。安全な着地点が無い配置は従来の復帰（pitFall）。 */
  lavaFall(p) {
    const B = LAVA_BOUNCE, land = this.lavaLanding(p.x);
    if (!land) { this.pitFall(p, { dmg: this.lava.dmg }); if (this.logHook) this.lg('lava', { to: 'player', mv: 'lava', rec: 'drop' }); return; }
    const x0 = p.x, dir = land.x >= x0 ? 1 : -1;
    this.stats.lavaFalls = (this.stats.lavaFalls || 0) + 1;
    const dead = p.hp - this.lava.dmg <= 0 && this.phase !== 'clear';
    if (this.logHook) this.lg('lava', { to: 'player', x: Math.round(p.x), hp: Math.round(p.hp), dmg: this.lava.dmg, mv: 'lava', rec: dead ? 'down' : 'arc' });
    this.lavaBurst(x0, 1);
    this.sfx('hurt', 0.8, 1.0); this.sfx('splash', 0.8, 1.9);      // 「ジュッ」＝水しぶきの音を高く短く
    this.popup(clamp(x0, 120, W - 120), this.groundY - 170, 'LAVA!', { color: '#ffb04a', size: 34 });
    const total = B.flinch + B.dur + B.stiff;
    this.hurtPlayer(this.phase === 'clear' ? Math.min(this.lava.dmg, Math.max(0, p.hp - 1)) : this.lava.dmg, 0, 0, total, total + B.inv);
    if (p.state === 'hurt') {
      p.facing = -dir; p.vx = 0; p.vy = 0; p.rp = null; p.repelT = 0; p.swim = false; p.chain = null; p.move = null; p.shakeAmp = 0;
      p.lavaArc = { t: 0, x0, y0: p.y, x1: land.x, y1: this.groundY, dir, landed: false };
      this.onceAnim(p, 'hurt', 0.5);
    } else { p.x = land.x; p.y = this.groundY; p.onGround = true; p.sup = 'ground'; }      // 体力が尽きた：溶岩の外に倒れる
  }
  /** 版3.5：溶岩から弾かれる動きを 1 コマ進める。位置は式で決める（のけぞり→放物線→着地→硬直）。 */
  tickLavaArc(p, dt) {
    const a = p.lavaArc, B = LAVA_BOUNCE; a.t += dt;
    if (a.t < B.flinch) { p.x = a.x0; p.y = a.y0; p.vy = 0; p.onGround = true; return; }
    if (a.landed) { p.x = a.x1; p.y = a.y1; p.vx = p.vy = 0; p.onGround = true; p.sup = 'ground'; return; }      // 着地後の硬直中は接地・位置・速度を固定（毎コマ空中に戻さない）
    const s = clamp((a.t - B.flinch) / B.dur, 0, 1);
    p.x = a.x0 + (a.x1 - a.x0) * s; p.y = a.y0 + (a.y1 - a.y0) * s - B.h * 4 * s * (1 - s);
    p.vy = ((a.y1 - a.y0) - B.h * 4 * (1 - 2 * s)) / B.dur;      // カメラが「落ちている」と判断できるよう、縦の速さを式の微分で入れる
    p.vx = (a.x1 - a.x0) / B.dur; p.onGround = false; p.sup = null;
    if (s >= 1 && !a.landed) {
      a.landed = true; p.vx = 0; p.vy = 0; p.x = a.x1; p.y = a.y1; p.onGround = true; p.sup = 'ground';
      this.dust(p.x, p.y, 8, 34); this.ring(p.x, p.y, { r0: 14, r1: 70, dur: 0.35, color: '#ffd9a0', flat: true, w: 5 });
      this.sfx('land', 0.7, 1.0); this.shakeAdd(5);
    }
  }
  /** 版3.5：溶岩のしぶき（滑らかに光る粒。恐竜の体には付けない）。 */
  lavaBurst(x, k = 1) {
    const y = this.groundY;
    this.ring(x, y, { r0: 20, r1: 150, dur: 0.5, color: '#ff8a2a', flat: true, w: 6 });
    this.ring(x, y, { r0: 8, r1: 90, dur: 0.35, color: '#ffe9a0', flat: true, w: 4 });
    for (let i = 0; i < Math.round(26 * k); i++) this.fx.push({ type: 'ember', x: x + this.rand(-34, 34), y: y - this.rand(0, 14), vx: this.rand(-230, 230), vy: -this.rand(260, 760), r: this.rand(2.5, 7), t: 0, dur: this.rand(0.55, 1.1), hot: this.rand(0, 1) });
  }
  /**
   * 版3.5：池に落ちた主人公の着地点（地面の x）。落ちた池の、近い側の縁（水位が最高のときの縁）から past[0]〜past[1] px 外。
   * 別の池の上・壁・海底の裂け目に当たる点は避け、近い側がだめなら反対側。どちらも無ければ null（従来の復帰）。
   */
  lavaLanding(x) {
    const B = LAVA_BOUNCE, L = this.lava; if (!L) return null;
    const pool = L.pools.find((q) => Math.abs(x - q.cx) < this.lavaReach(q, 1) + 1) || L.pools[0];
    const reach = this.lavaReach(pool, 1), lim = (this.player ? this.player.bw * 0.33 : 40) + 10;
    const sides = x < pool.cx ? [-1, 1] : [1, -1];
    const offs = []; for (let o = B.past[0] + 10; o <= B.past[1]; o += 10) offs.push(o); offs.push(B.past[0]);
    for (const sd of sides) for (const o of offs) {
      const lx = pool.cx + sd * (reach + o);
      if (lx < lim || lx > W - lim) continue;
      if (L.pools.some((q) => Math.abs(lx - q.cx) < this.lavaReach(q, 1) + B.margin)) continue;
      if (this.gaps.length && (this.inGap(lx - 30) || this.inGap(lx + 30))) continue;
      return { x: lx };
    }
    return null;
  }

  // ---- 版3.0（背景の描き直し）：マグマだまり ----
  /** 池 pool の、いまの水位 ph（0〜1）での半幅。描画（lava_render.js）と同じ式＝見た目と当たりが対応する。 */
  lavaReach(pool, ph) { return (pool.x1 - pool.x0) / 2 + LAVA.spill * ph; }
  /** 水位（0〜1）：lavaT で なめらかに上下する（lava_render.js の lavaPhase と同じ式）。 */
  lavaPhaseNow() { const L = this.lava; return L ? 0.5 - 0.5 * Math.cos((2 * Math.PI * this.lavaT) / Math.max(1, L.period)) : 0; }
  /** 床の x（margin px ぶん広げて）が、いまの池の中か。 */
  inLava(x, margin = 0) {
    if (!this.lava) return false;
    const ph = this.lavaPhaseNow();
    return this.lava.pools.some((p) => Math.abs(x - p.cx) < this.lavaReach(p, ph) + margin);
  }
  /** 毎コマ：床に立つ主人公・敵が池に入ったか。主人公は 1 回 lava.dmg ダメージ＋最後に立っていた所へ復帰。雑魚は溶けて消える（倒した扱い）。ボスは体力が減るだけ（倒れない）。飛ぶ敵・空中は平気。 */
  lavaTick(dt) {
    this.lavaT += dt;
    const p = this.player;
    if (p && !p.lavaArc && p.onGround && p.sup === 'ground' && !['down', 'downed', 'revive', 'grabbed'].includes(p.state) && this.phase !== 'gameover' && this.inLava(p.x)) this.lavaFall(p);
    for (const e of this.enemies) {
      if (e.dead || e.d.flying || e.d.swim || !e.onGround || e.sup !== 'ground' || e.state === 'dying' || e.state === 'drop' || !this.inLava(e.x)) continue;
      if (isBossLike(e.d)) {
        e.hp = Math.max(1, e.hp - e.maxHp * LAVA.bossPerSec * dt); e.flash = Math.max(e.flash || 0, 0.08);
        e.lavaT = (e.lavaT || 0) - dt; if (e.lavaT <= 0) { e.lavaT = 0.4; this.stats.lavaBurns = (this.stats.lavaBurns || 0) + 1; if (this.logHook) this.lg('lava', { to: e.type, mv: 'lava', k: 0 }); }
        continue;
      }
      this.lavaDefeat(e);
    }
  }
  lavaDefeat(e) {
    if (e.dead) return;
    e.dead = true; e.state = 'dying';
    const mine = !!e.byPlayer;      // 版3.3：主人公の技で吹き飛ばされて落ちた分だけ数える。自分から入って溶けた分は、点・撃破数・コンボ・CP に入れない
    // 2026-11-14：ほかの撃破と同じく、コンボを足してから点（前は点が先で、倍率がコンボ 1 つぶん低かった）。浮き数字は実際に入った点（前は倍率の掛かる前の素点）
    let got = 0;
    if (mine) { this.stats.kills++; this.stats.lavaMelts = (this.stats.lavaMelts || 0) + 1; this.addCombo(1); got = this.addScore(e.d.score); }
    else this.stats.selfMelts = (this.stats.selfMelts || 0) + 1;
    this.ring(e.x, this.groundY, { r0: 16, r1: e.bw * 0.7, dur: 0.45, color: '#ffb04a', flat: true, w: 5 });
    this.popup(clamp(e.x, 100, W - 100), this.groundY - 70, mine ? '+' + got : '自滅', mine ? { color: '#ffb04a', size: 24, dur: 1.0 } : { color: '#b8a89a', size: 18, dur: 0.8 });
    this.sfx('hit', 0.6, 0.7);
    if (this.logHook) this.lg('lava', { to: e.type, mv: 'lava', k: mine ? 1 : 0, self: mine ? 0 : 1 });
  }
  // ---- 版3.3：陸の敵が池・水の縁で止まる ----
  /** 池の「入ってはいけない帯」（水位が最高のときの縁＋余白）。e の体の幅を見て広げる。 */
  lavaZones(e) {
    if (!this.lava) return [];
    const m = HAZARD.margin + (e ? e.bw * HAZARD.bodyFrac : 0);
    return this.lava.pools.map((p) => ({ x0: p.cx - this.lavaReach(p, 1) - m, x1: p.cx + this.lavaReach(p, 1) + m }));
  }
  /** x が帯の中なら、近い側の外へずらした x を返す（lo〜hi に収める）。 */
  outsideLavaX(e, x, lo, hi) {
    for (const z of this.lavaZones(e)) {
      if (x > z.x0 && x < z.x1) { const l = z.x0, r = z.x1; x = (x - l < r - x) ? l : r; }
    }
    return clamp(x, lo, hi);
  }
  /** 版3.4：自分の足で動いている陸の敵（主人公の技で飛ばされた分は除く）が池の縁の内側へ入ってしまったら、縁の外へ戻す。押し合い（separateEnemies）・水位の上昇・技の踏み込みなど、avoidHazards の外の経路の最後の網。 */
  containHazard(e) {
    if (e.dead || e.d.flying || e.d.swim || isBossLike(e.d) || e.rival || e.hazHop || e.byPlayer) return;
    if (e.sup !== 'ground' || !e.onGround) return;
    if (!(e.state === 'idle' || e.state === 'move' || e.state === 'stun')) return;
    const x0 = e.hx0 ?? e.x;
    for (const z of this.lavaZones(e)) {
      if (!(e.x > z.x0 && e.x < z.x1)) continue;
      let edge;
      if (x0 <= z.x0) edge = z.x0; else if (x0 >= z.x1) edge = z.x1;
      else if (this.inLava(e.x, 12)) edge = (e.x - z.x0 < z.x1 - e.x) ? z.x0 : z.x1;      // 帯の中から水位に呑まれそうなとき：近い側の外へ
      else continue;      // 帯の中の、まだ溶岩でない所：avoidHazards が歩いて出す
      e.x = edge; e.vx = 0; this.stats.hazardPushes = (this.stats.hazardPushes || 0) + 1;
    }
  }
  /** 海の面：足場 pl の外 x（pl の端から少し外）の下に、水面より上で乗れる別の足場があるか。 */
  landingBelow(pl, x) {
    for (const q of this.platforms) {
      if (q === pl || q.y <= pl.y || q.y >= this.water.y - 20) continue;
      if (x >= q.x - 4 && x <= q.x + q.w + 4) return true;
    }
    return false;
  }
  /**
   * 毎コマ、敵の AI が動いたあと：陸の敵（歩く・走る・跳べる雑魚。ボス・泳ぐ・飛ぶ敵は対象外）が自分から池に入る／水に落ちる位置へ進んだら、その縁で止める。
   * px＝このコマの初めの x。すでに帯の中にいる（出現・吹き飛びのあと）なら何もしない＝従来どおり溶ける。
   * 縁で hopAfter 秒止められ、主人公が池の向こうにいて跳べる雑魚なら、池を跳び越す（待ちぼうけを作らない）。
   */
  avoidHazards(e, px, dt) {
    if ((!this.lava && !this.water) || e.dead || e.d.flying || e.d.swim || isBossLike(e.d) || e.rival) return;
    if (e.state !== 'idle' && e.state !== 'move') return;
    if (!e.onGround) {      // 跳び越えの最中：横の速さを保つ
      if (e.hazHop) e.vx = e.hazHop.vx;
      return;
    }
    if (e.hazHop) e.hazHop = null;
    let blocked = 0;
    if (this.lava && e.sup === 'ground') {
      for (const z of this.lavaZones(e)) {
        if (px <= z.x0 && e.x > z.x0) { e.x = z.x0; blocked = 1; e.hazZone = z; }
        else if (px >= z.x1 && e.x < z.x1) { e.x = z.x1; blocked = -1; e.hazZone = z; }
      }
      if (!blocked && e.state === 'idle' && !this.inLava(e.x)) {      // 帯の中の、まだ溶岩でない所に立っている（起き上がった・出てきたばかり）。水位が上がって呑まれる前に、近い側の外へ歩いて出る
        const zi = this.lavaZones(e).find((z) => e.x > z.x0 && e.x < z.x1);
        if (zi) { const d = (e.x - zi.x0 < zi.x1 - e.x) ? -1 : 1; e.facing = d; e.x = px + d * Math.max(e.d.speed, 90) * 1.2 * dt; e.vx = 0; this.loopAnim(e, 'walk');      /* 版3.5：AI の歩き（px からの動き）を捨てて出る側へ。跳べる敵の追尾（池の向こうの足場へ歩く）が出る歩きと逆向きで、帯の縁の内側で 1 コマごとに行ったり来たりした */ this.stats.hazardSteps = (this.stats.hazardSteps || 0) + 1; return; }
      }
    } else if (this.water && e.sup && e.sup !== 'ground') {
      const pl = e.sup, lo = pl.x + HAZARD.edgeInset, hi = pl.x + pl.w - HAZARD.edgeInset;
      if (e.x < lo && px >= lo && !this.landingBelow(pl, pl.x - 20)) { e.x = lo; blocked = -1; }
      else if (e.x > hi && px <= hi && !this.landingBelow(pl, pl.x + pl.w + 20)) { e.x = hi; blocked = 1; }
    }
    // 版3.5：池の向こうに主人公がいる跳べる敵は、池の縁（帯の外 140px 以内）にいるあいだ「縁で止められている」とみなす。縁に先に着いた敵（甲羅の敵など）に押し返されて縁まで行けない後ろの列でも、跳び越える数え（hazWait）が進む
    let near = 0;
    if (!blocked && this.lava && e.d.hop && e.sup === 'ground' && e.state === 'idle' && this.player && this.playerAlive()) {
      const pxp = this.player.x;
      for (const z of this.lavaZones(e)) {
        if (z.x1 <= e.x && e.x - z.x1 < 140 && pxp < z.x0 - 20) { near = -1; e.hazZone = z; e.hazT = this.time; break; }
        if (z.x0 >= e.x && z.x0 - e.x < 140 && pxp > z.x1 + 20) { near = 1; e.hazZone = z; e.hazT = this.time; break; }
      }
    }
    let at = blocked || near;      // 縁にいる向き（止められたコマ、または止められて 1.2 秒以内でまだ縁のそば＝突進の構え・ガードで立ち止まっている間も待ちに数える）
    const zh = e.hazZone;
    if (!at && zh && this.time - (e.hazT ?? -9) < 1.2) { if (Math.abs(e.x - zh.x0) < 10) at = 1; else if (Math.abs(e.x - zh.x1) < 10) at = -1; }
    if (!at) { if (e.hazWait > 0) e.hazWait = Math.max(0, e.hazWait - dt * 2); return; }
    e.hazWait = (e.hazWait || 0) + dt;
    if (blocked) {
      e.hazT = this.time;
      this.stats.hazardStops = (this.stats.hazardStops || 0) + 1;
      if (e.state === 'idle') { e.vx = 0; e.facing = blocked; if (!e.guarding) this.loopAnim(e, 'idle'); }
      else if (e.state === 'move') { e.vx = 0; }
    }
    // 池を跳び越える（縁で待たされて、主人公が向こう側にいるとき）
    const p = this.player;
    const tgx = e.hopPlan && e.d.hop && p ? e.hopPlan.tx : (p ? p.x : e.x);      // 版3.5：跳べる敵は、主人公の x でなく、跳ぶ道の最初の足場（hopAI の目的地）が池の向こうなら跳び越える。主人公が池の真上の足場にいると、道は池の向こう側の足場から回るのに、池のこちら側で止まっていた
    if (e.state === 'idle' && !(e.wn && e.wn.act) && this.lava && e.hazZone && e.hazWait >= HAZARD.hopAfter && p && this.playerAlive() && e.d.tier === 'grunt' && e.d.ai.type !== 'tank' && (tgx - e.x) * at > 0 && Math.abs(tgx - e.x) > (e.hazZone.x1 - e.hazZone.x0) * 0.5) {
      const far = at > 0 ? e.hazZone.x1 + 12 : e.hazZone.x0 - 12, T = clamp(Math.abs(far - e.x) / (HAZARD.hopVx * 0.9), 2 * Math.abs(HOP.vy) / HOP_G, HAZARD.hopMaxT), vx = (far - e.x) / T;      // 跳ぶ高さは、池の幅に合わせて少し高く（滞空 T 秒で向こう岸へ）
      if (Math.abs(vx) <= HAZARD.hopVx && far > 60 && far < W - 60) {
        e.vy = -T * HOP_G / 2; e.vx = vx; e.onGround = false; this.setGuard(e, false); e.sup = null; e.hazWait = 0; e.hazHop = { vx };
        this.holdAnim(e, 'hop'); this.dust(e.x, e.y, 4, e.bw * 0.2); this.sfx('jump', 0.5, 0.8);
        this.stats.hazardHops = (this.stats.hazardHops || 0) + 1;
      }
    }
  }

  /** 空中ジャンプ：空中で攻撃を当てるたびに1回戻る。コンボが長いほど浮きが弱い。 */
  doAirJump(p) {
    p.airJumps = Math.max(0, p.airJumps - 1);
    p.vy = JUMP_V * (0.3 + 0.7 * this.liftScale() * this.altScale(p.y) * tnSqrt('riseLift'));
    p.jumpCut = true;
    this.stats.airJumps++;
    this.sfx('jump', 0.9, 1.3);
    this.ring(p.x, p.y, { r0: 14, r1: 90, dur: 0.3, color: '#7df0ff', flat: true, w: 5 });
    this.dust(p.x, p.y, 3, 24);
    this.popup(p.x, p.y - p.bh - 8, 'JUMP!', { size: 20, color: '#7df0ff', dur: 0.5 });
  }

  /** コンボが長いほど浮きが弱くなる（8コンボを過ぎたら1コンボごとに2%、最小35%）。無限に昇れないようにする補正。 */
  liftScale() { return clamp(1 - Math.max(0, this.combo - 8) * 0.02, 0.35, 1); }
  /** 高い所ほど昇る力が弱い（地面から約230pxまでは全力、約420pxでほぼ0）。画面の外まで昇らない天井。 */
  altScale(y) { return clamp(1 - ((this.liftBase() - y) - 230) / 190, 0.08, 1); }
  /** 版3.0：空中コンボの「高さ」の基準。陸の面は地面。海の面は、最後に立っていた足場（水の中なら、浮かぶ水面の高さ）＝海底の深さでは測らない。 */
  liftBase() { const p = this.player; return this.water && p && p.baseY !== undefined ? p.baseY : this.groundY; }
  /** 空中で技を出している間の重力の倍率（コンボが長いほど落ちやすい）。 */
  airGrav() { return AIR_ATTACK_GRAV + Math.min(0.5, this.combo * 0.01); }

  // ---- 技の表から、いま出せる行を選ぶ ----
  rowEligible(r, p, mode, cur) {
    const d = r.def;
    // 版3.0：泳いでいる間（水の中で足が着いていない）は、地上の技がそのまま出る（噛みつき→爪→爪→尻尾・打ち上げ・足払い・必殺）。空中の技の行・水の中で使えない行（急降下・大ジャンプ・足場から降りる など）は出ない
    const wet = !!this.water && p.isPlayer && !p.onGround && this.inWater(p);
    if (wet && (d.ctx === 'air' || WATER.noMoves.includes(r.id))) return false;
    if (r.id === 'bigJump' && this.water && p.isPlayer && this.inWater(p)) return false;      // 点検と監修：海底・水中の岩棚に立っているときも、水の中では大ジャンプ不可（wet は足が着いていないときだけだった）
    if (d.ctx === 'ground' && !p.onGround && !wet) return false;
    if (d.ctx === 'air' && p.onGround) return false;
    if (this.moveCost(d, p) > p.gauge) return false;
    if (d.requires === 'platform' && !(p.onGround && p.sup && p.sup !== 'ground')) return false;
    if (d.requires === 'airjump' && !(p.airJumps > 0)) return false;
    if (d.requires === 'dash' && !(p.dashT > 0)) return false;
    // ダッシュ中でも ↑/↓ を押している攻撃は、ダッシュ攻撃でなく打ち上げ・足払い等のつもり（体当たりに化けさせない）
    if (d.requires === 'dash' && (this.reader.open.up || this.reader.open.down)) return false;
    if (d.requires === 'guard' && !(p.guardOkT > 0)) return false;
    if (mode === 'hurt' && !d.fromHurt) return false;
    if (mode === 'cancel' && !cur.def.cancel.into.includes(r.id)) return false;
    const prev = mode === 'cancel' ? cur.name : (p.chain ? p.chain.id : null);
    if (d.from && !(prev && d.from.includes(prev))) return false;
    // fromHit：前の技が当たったときだけ続けられる（引っかきの3段目）
    if (d.fromHit && !(mode === 'cancel' ? cur.connected : (p.chain && p.chain.conn))) return false;
    return true;
  }

  /** mode: 'neutral'（何もしていない）/ 'cancel'（技の途中で打ち切る。cur=いまの技）。成立した行 {id,row} か null。 */
  resolvePlayerMove(p, mode, cur) {
    const cand = this.playerRows.filter((r) => this.rowEligible(r, p, mode, cur));
    if (!cand.length) return null;
    const pick = this.reader.resolve(cand, p.facing);
    // 版2.4：空中の ↓＋攻撃は、空中コンボの最中だけ宙返りの尻尾叩きつけ（spike）。コンボ中でない空中では急降下（dive）。↓↓＋攻撃はいつでも急降下。
    if (pick && pick.id === 'spike' && !this.inAirCombo(p, mode, cur)) {
      const dr = this.playerRows.find((r) => r.id === 'dive');
      if (dr && (mode !== 'cancel' || cur.def.cancel.into.includes('dive')) && this.moveCost(dr.def, p) <= p.gauge) return this.diveOrDeny(p, { ...pick, id: 'dive', row: dr });
    }
    return pick && pick.id === 'dive' ? this.diveOrDeny(p, pick) : pick;
  }

  /** 2026-10-23：急降下は CP が足りないと出さない。入力は使い切り（resolve が消費済み）なので、他の技へ化けず、押しっぱなしで繰り返し鳴ることもない。 */
  diveOrDeny(p, pick) {
    if (p !== this.player || this.energyCost(pick.row.def, p) <= p.gauge) return pick;
    this.sfx('cancel', 0.8);
    this.popup(p.x, p.y - p.bh - 8, 'CP 不足', { size: 20, color: '#8fb4ff', dur: 0.6 });
    if (this.logHook) this.lg('diveDeny', { g: Math.round(p.gauge) });
    return null;
  }

  /** 版2.4：空中コンボの最中か。＝空中にいて、空中で敵に当ててから AIR_COMBO_T 秒以内（当てるたびに延びる・着地で終わり）／空中の技の途中で、その技が当たっているとき。 */
  inAirCombo(p, mode = 'neutral', cur = null) {
    if (p.onGround) return false;
    return p.airHitT > 0 || (mode === 'cancel' && !!cur && !!cur.connected);
  }

  /** 版1.1b：ゲージを使う衝撃波系は、短い間に続けて出すほど消費が増える（はめ防止）。 */
  moveCost(d, p) {
    if (!(d.cost > 0) || d.family !== 'wave') return d.cost;
    if (CP_FREE_WAVE_FIX.on && this.mpFree && p === this.player) return d.cost;      // 2026-11-15 Nao「おすすめで」：CP FREE（常に満タン・減らない）の主人公は、続けて出しても消費が増えない＝満タンで出せなくならない
    const n = Math.min(WAVE_LOCK.costMax, (p.waveUses || []).filter((t) => this.time - t < WAVE_LOCK.costWin).length);
    return Math.round(d.cost * (1 + WAVE_LOCK.costStep * n));
  }

  /** 2026-10-23：技の「消費だけ」の CP（energy）。急降下＝DIVE_CP×スライダー。cost（必殺扱い）とは別。CP FREE の主人公は0。 */
  energyCost(d, p) {
    if (!d || d.energy !== 'dive') return 0;
    if (this.mpFree && p === this.player) return 0;
    return Math.round(DIVE_CP * tn('diveCp'));
  }

  runPlayerRow(p, pick, fromCancel) {
    const d = pick.row.def;
    if (this.logHook && p === this.player) this.lg('move', { id: pick.id, air: !p.onGround ? 1 : 0, cx: fromCancel ? 1 : 0 });
    if (!(this.mpFree && p === this.player)) p.gauge -= this.moveCost(d, p);
    p.gauge = Math.max(0, p.gauge - this.energyCost(d, p));      // 2026-10-23：急降下の消費（必殺ではないので cost には入れない）      // 版2.0：オプションの CP FREE＝主人公のゲージ消費なし
    if (d.family === 'wave') { p.waveUses = (p.waveUses || []).filter((t) => this.time - t < WAVE_LOCK.costWin); p.waveUses.push(this.time); }
    p.chain = null;
    if (fromCancel) { p.move = null; p.tele = false; p.state = 'idle'; }
    switch (d.action) {
      case 'jump': this.doJump(p, fromCancel); break;
      case 'airjump': this.doAirJump(p); break;
      case 'drop': p.dropIgnore = p.sup; p.onGround = false; p.sup = null; p.vy = 80; break;
      case 'fall':   // 空中で ↓+ジャンプ：落下の速さを上げる（頭を下げる演出は描画側）
        p.vy = Math.max(p.vy, 1100); p.jumpCut = true;
        this.sfx('whoosh', 0.5, 1.2);
        break;
      case 'dash':
        p.dashT = DASH_T;
        this.sfx('whoosh', 0.6, 0.9);
        this.dust(p.x - p.facing * p.bw * 0.25, p.y, 4, 14);
        this.ring(p.x, p.y, { r0: 14, r1: 70, dur: 0.25, color: '#fff3c4', flat: true, w: 4 });
        break;
      default: this.startMove(p, pick.id);
    }
  }

  playerFree(p, dt, inp) {
    const dir = (inp.held.right ? 1 : 0) - (inp.held.left ? 1 : 0);
    const victory = this.phase === 'clear' && this.phaseT < 2.0;
    if (p.dashT > 0) p.dashT = Math.max(0, p.dashT - dt);
    // ダッシュ：最高速が上がり、DASH_T 秒かけて元に戻る（終わりの0.12秒でなめらかに）
    const dashMul = p.dashT > 0 ? 1 + (DASH_MUL - 1) * Math.min(1, p.dashT / 0.12) : 1;
    // ガード：地上で↓を押し続けている間。その場に立ち止まり（向きは変えられる）、正面の攻撃を防ぐ。
    { // 版2.5：構えている間は CP が減る。押し始めの短い窓がパリィ（押し直しの直後は窓が開かない）
      const wasG = !!p.guarding;
      let want = p.onGround && !!inp.held.down && !victory;
      if (want && CP_GUARD.empty === 'open' && !this.mpFree && p.gauge <= 0) want = false;
      p.guarding = want;
      if (want && !wasG) { p.guardHoldT = 0; p.parryOpen = !(p.parryLockT > 0) && (!PARRY_EDGE.on || !!this.downEdge); }      // 2026-11-15 Nao「↓ を押し直したときだけ受付を開く」：押したまま技・着地・やられが終わって構えに戻ったときは開かない（downEdge＝↓ を押した瞬間。update で記録）
      else if (want) { p.guardHoldT += dt; if (!this.mpFree) p.gauge = Math.max(0, p.gauge - CP_GUARD.hold * tn('cpGuardCost') * dt); }
      else if (wasG) p.parryLockT = PARRY.relock;
    }
    if (p.swim) {
      // 版3.0：泳ぎ。←→で横へ・↑↓で上下へ泳ぐ（ゆっくり）。何も押さないと、浮力で水面近く（中心が水面の WATER.float 下）へ浮かんで漂う。ジャンプは上へ蹴る（doJump→swimStroke）
      const up = !!inp.held.up, dn = !!inp.held.down;
      const depth = (p.y - p.bh * 0.5) - this.water.y;
      p.vx = lerp(p.vx, dir * WATER.swimV, Math.min(1, dt * WATER.accel));
      if (dir) p.facing = dir;
      if (up && !dn) { p.vy = lerp(p.vy, -WATER.upV, Math.min(1, dt * WATER.accel)); p.swimCtl = true; }
      else if (dn && !up) { p.vy = lerp(p.vy, WATER.downV, Math.min(1, dt * WATER.accel)); p.swimCtl = true; }
      else p.vy += clamp(-(depth - WATER.float) * 10, -240, 240) * dt;
    } else if (p.onGround) {
      if (p.guarding) { p.vx = 0; if (dir) p.facing = dir; }
      else if (dir) { p.vx = dir * PLAYER_SPEED * dashMul; p.facing = dir; } else p.vx = 0;
    } else {
      if (dir) { p.vx = lerp(p.vx, dir * PLAYER_SPEED * 0.9, Math.min(1, dt * 10)); p.facing = dir; }
      else p.vx *= 1 - Math.min(1, dt * 2.2);
    }
    if (p.chain) { p.chain.t -= dt; if (p.chain.t <= 0) p.chain = null; }
    // ジャンプ・攻撃・体当たり・コマンドは、すべて技の表の行（入力の読み取りは commands.js）
    const pick = this.resolvePlayerMove(p, 'neutral', null);
    if (pick) this.runPlayerRow(p, pick, false);
    if (!p.onGround && !p.jumpCut && p.vy < -300 && !inp.held.jump && !p.swim && !(this.water && this.inWater(p))) { p.vy *= 0.5; p.jumpCut = true; }
    if (p.onGround) p.jumpCut = false;
    if (p.state === 'idle') {
      // アニメ選択
      if (p.swim) this.loopAnim(p, Math.abs(p.vx) > 30 || Math.abs(p.vy) > 40 ? 'swim' : 'swimIdle');      // 版3.0：泳ぎ（泳ぎの絵が無いので、走りと待機を傾けて代用＝motion_map.js）
      else if (!p.onGround) { this.holdAnim(p, p.vy < 0 ? 'jump' : 'fall'); }
      else if (p.guarding) this.holdAnim(p, 'guard');
      else if (dir) this.loopAnim(p, p.dashT > 0 ? 'dash' : 'run');
      else if (victory) this.loopAnim(p, 'victory');
      else if (p.hp / p.maxHp <= 0.25) this.loopAnim(p, 'weak');
      else this.loopAnim(p, 'idle');
      this.tickAnim(p, dt);
      // ダッシュの残像
      if (p.dashT > 0.12 && p.onGround && Math.abs(p.vx) > 250 && p.anim) {
        p.ghostT = (p.ghostT || 0) - dt;
        if (p.ghostT <= 0) {
          p.ghostT = 0.045;
          this.fx.push({ type: 'ghost', who: p.type, motion: p.anim.motion, frame: this.frameOf(p), x: p.x, y: p.y, facing: p.facing, t: 0, dur: 0.24 });
        }
      }
    }
  }

  // ======== 動き（主人公・敵 共通の phase 実行器） ========
  startMove(e, name, opt = null) {
    let def = (e.isPlayer ? this.playerDefs : e.d.moves)[name];
    if (!def || !def.phases || !def.phases.length) return;
    // opt.windup＝最初の区間（予兆の構え）をこの秒数に縮める（コンボ破り・登場の咆哮）
    if (e.isPlayer && e.swim && def.waterFrames && def.waterFrames.length === def.phases.length) def = { ...def, phases: def.phases.map((x, i) => ({ ...x, ...def.waterFrames[i] })) };      // 版3.0 第2段：泳いでいる間は水の中用のコマ（噛みつき）
    if (opt && opt.windup && def.phases[0].dur > opt.windup) def = { ...def, phases: def.phases.map((x, i) => (i === 0 ? { ...x, dur: opt.windup } : x)) };
    e.move = { name, def, i: 0, pt: 0, hit: new Set(), connected: false };
    e.state = 'move';
    if (e.rival) e.wakeInv = 0;      // 版2.4：技を出し始めたら、起き上がりの無敵はその場で切れる（無敵のまま技を撃たない）
    if (e.rival && name === 'roar') e.roarCd = RIVAL_TUNE.roarCd * (e.rage ? RAGE_RIVAL_ROAR_CD : 1);      // 版2.4：咆哮は、どの経路で出しても共通の待ち時間
    e.guarding = false;
    if (e.isPlayer) e.dashT = 0;     // 技を出したらダッシュは使い切り（体当たりの連発・技のあとの最高速の復活を防ぐ）
    this.enterPhase(e, 0);
  }

  enterPhase(e, i) {
    const m = e.move;
    const ph = m.def.phases[i];
    m.i = i; m.pt = 0; m.hit.clear(); m.stepT = undefined;
    if (ph && ph.stopOnHit && !e.isPlayer) { m.connected = false; m.touched = false; }      // 版2.7：突進を2回続ける技（ギガノトクラッシュ）では、前の突進が当たった印を持ち越さない
    if (!ph) return;
    const motion = ph.m || m.def.motion;
    if (ph.loop) {
      const [a, b, fps] = ph.loop;
      e.anim = { key: 'mv' + i, motion, from: a, to: b, dur: (Math.abs(b - a) + 1) / fps, loop: true, t: 0 };
    } else {
      e.anim = { key: 'mv' + i, motion, from: ph.from, to: ph.to, dur: ph.dur, loop: false, t: 0 };
    }
    e.tele = !!ph.tele;
    if (ph.sfx) this.sfx(ph.sfx === 'growl' ? this.roarOf(e) : ph.sfx, ph.tele ? 0.9 : 1);
    if (ph.ev) this.moveEvent(e, ph.ev, ph);
  }

  endMove(e) {
    const wasName = e.move ? e.move.name : null;
    const wasDef = e.move ? e.move.def : null;
    const wasConn = !!(e.move && e.move.connected);
    e.move = null; e.tele = false;
    if (e.isPlayer) {
      e.state = 'idle';
      if (wasName) e.chain = { id: wasName, t: wasDef.chainWindow ?? 0.35, conn: wasConn };   // 直後なら連続技の次の行が出せる
    } else if (e.rival) {
      // ライバル：当たったなら、つなぎの続きをすぐ出せる（rival.js が決める）。外れたら間をおく。
      e.state = 'idle'; e.moveV = null; e.steer = 0;
      e.chain = wasName ? { id: wasName, t: 0.5, conn: wasConn } : null;
      e.cd = wasConn ? 0 : this.rand(RIVAL_TUNE.gap[0], RIVAL_TUNE.gap[1]) * this.diff.atkGap * this.rageGap(e);
    } else {
      e.state = 'idle';
      e.moveV = null;
      const cdr = e.d.ai && e.d.ai.cooldown;
      e.cd = (cdr ? this.rand(cdr[0], cdr[1]) : 0.8) * this.diff.atkGap * this.rageGap(e);
      if (e.d.ai && (e.d.ai.type === 'flyer' || e.d.ai.type === 'swimmer')) { e.vx = 0; e.vy = 0; }
    }
  }

  updateMove(e, dt, inp) {
    const m = e.move;
    if (!m) { e.state = 'idle'; return; }
    const ph = m.def.phases[m.i];
    const isP = e.isPlayer;
    const tm = isP || e.rival;       // 技の表で動くもの（主人公とライバル）：空中の技・浮く・縦の速さ固定が効く
    // 2026-11-15 Nao「A 水に入ったら急降下を止めて泳ぎに戻す」：水の上で出した急降下は、体が水に入ったら止める（前は海底まで一直線＝4-3 では裂け目の上から出すと奈落へ）。縦の速さは落下の技の上限まで落として、あとはふつうに水に入ったときと同じ（水の抵抗・泳ぎ）
    // 2026-11-15 確かめの指摘：止めるのは Nao「急降下を止める」の急降下(dive)と、同じ原因の尻尾叩きつけ(spike)だけ。跳び上がり踏みつけ(stomp)など、ほかの「着地まで降りる区間」は止めない（頼まれていない）
    if (DIVE_WATER_FIX.on && isP && DIVE_WATER_FIX.names.includes(m.name) && ph.until === 'ground' && ph.vy > 0 && this.water && this.inWater(e)) {
      e.vy = Math.min(e.vy, DIVE_WATER_FIX.vyMax); e.gravMul = 1;
      this.endMove(e); e.chain = null;
      if (this.logHook) this.lg('diveWater', { y: Math.round(e.y) });
      this.stats.diveWater = (this.stats.diveWater || 0) + 1;
      return;
    }
    m.pt += dt;
    e.anim.t = m.pt;
    if (tm) e.gravMul = ph.float ? 0 : (e.onGround ? 1 : (isP ? this.airGrav() : 0.5));

    if (ph.fly !== undefined && e.d.flying) e.moveV = ph.fly ? { vx: 0, vy: ph.fly } : null;      // 版2.7：飛ぶ敵の区間の縦の速さ（ダウンバーストの帰り）
    // 移動
    if (e.moveV && e.moveV.g) e.moveV.vy += e.moveV.g * dt;      // 版3.0：水面から飛び出す技の弧（重力）
    if (e.d.flying && e.moveV) {
      e.vx = e.moveV.vx; e.vy = e.moveV.vy;
      // 地面すれすれで水平に抜ける
      const floorY = Math.max(e.aiS && e.aiS.ref !== undefined ? e.aiS.ref : this.groundY, this.player && e.aiS && e.aiS.ref !== undefined ? this.player.y : 0);      // 版2.8b：飛ぶ敵の急降下は、主人公の立つ面（最上段なら最上段）の高さですれすれで抜ける
      const fy = this.water ? this.water.y - 10 : floorY - e.bh * 0.35;      // 版3.0：海の面では、飛ぶ敵の急降下は水面まで（水に潜らない）
      if (!e.d.swim && e.y > fy && e.vy > 0) { e.y = fy; e.moveV.vy = 0; e.vy = 0; }
    } else if (e.onGround || !tm) {
      let vx = 0;
      if (ph.vx) vx = ph.vx * e.facing;
      else if (ph.lunge) vx = (ph.lunge / ph.dur) * e.facing;
      if (ph.lungeStop && vx && !isP && this.player && Math.abs(this.player.x - e.x) < ph.lungeStop * e.bw && (this.player.x - e.x) * e.facing > 0) vx = 0;      // 版2.3：もう主人公の目の前なら、それ以上詰めない（通り抜けない）
      if (e.onGround) e.vx = vx;
      else if (vx) e.vx = vx;
    } else {
      // 空中の技：体当たりのダッシュ中は保つ。それ以外は横へ操作できる（お手玉で敵を追うため）。押していなければ勢いは少しずつ落ちる。
      if (ph.vx) e.vx = ph.vx * e.facing;
      else if (ph.lunge) e.vx = (ph.lunge / ph.dur) * e.facing;
      else {
        const dir = inp ? (inp.held.right ? 1 : 0) - (inp.held.left ? 1 : 0) : (e.steer || 0);
        if (dir) e.vx = lerp(e.vx, dir * (isP ? PLAYER_SPEED : this.spdOf(e)) * 0.85, Math.min(1, dt * 12));
        else e.vx *= 1 - Math.min(1, dt * 1.5);
      }
    }
    if (e.d.flying && !e.moveV) { e.vx = 0; e.vy = 0; }
    if (tm && ph.float) e.vy = 0;
    if (tm && ph.vy !== undefined && !e.onGround) { e.vy = ph.vy; e.gravMul = 0; }   // 急降下：空中のあいだ毎コマ縦の速さを固定

    if (ph.pose && ph.pose.yaw && !tm && e.onGround) {      // 版2.7：回転なぎ払い中は、足元で土ぼこりが続けて舞う
      e.sweepDustT = (e.sweepDustT || 0) - dt;
      if (e.sweepDustT <= 0) { e.sweepDustT = 0.06; const yw = yawOf(e); this.dust(e.x - e.facing * Math.cos(yw.a) * e.bw * 0.4, e.y, 2, 60); }
    }
    if (ph.step && !tm && e.onGround) {      // 版2.8：走っている間の一歩ごと（ティラノの突進）：足音・画面の揺れ・土ぼこり・近くの地上の主人公のよろけ
      m.stepT = (m.stepT === undefined ? ph.step * 0.4 : m.stepT) - dt;
      if (m.stepT <= 0) { m.stepT += ph.step; this.stepTremor(e, ph); }
    }
    if (ph.hit) this.processHit(e, m, ph);
    if (e.move !== m) return;       // 版1.2：ガードされてはじかれた（repel で動きが消えた）。あとの処理で idle に戻さない
    if ((tm && ph.inv) || ph.ghost) this.ramGhost(e, dt);      // 版2.8：ghost＝敵の突進にも残像（ティラノの突進）

    // キャンセル：技の行の cancel（いつ・どの技へ）に従って打ち切る。入力は表の行どうしで読み取る。
    if (isP && m.def.cancel) {
      const c = m.def.cancel;
      const hitIdx = m.def.phases.findIndex((x) => x.hit);
      const winHit = m.connected && hitIdx >= 0 && m.i >= hitIdx;
      const winRec = !!ph.cancel;
      const open = (c.when === 'hit' && winHit) || (c.when === 'recovery' && winRec) || (c.when === 'both' && (winHit || winRec));
      if (open && m.pt >= 0.03) {
        const dir = (inp.held.right ? 1 : 0) - (inp.held.left ? 1 : 0);
        if (dir) e.facing = dir;
        const pick = this.resolvePlayerMove(e, 'cancel', m);
        if (pick) { this.runPlayerRow(e, pick, true); return; }
      }
    }

    // 区間の終わり
    let end = m.pt >= ph.dur;
    let crash = false;
    if (ph.until === 'wall' && e.wallHit && m.pt > 0.05) { end = true; crash = true; }
    if (ph.until === 'ground' && e.onGround && m.pt > 0.04) end = true;     // 急降下は着地で次の区間へ
    if (ph.wallStop && e.wallHit && m.pt > 0.05) end = true;      // 版2.8：壁に着いたら次の区間へ（自爆しない・突進の最後が壁に着く技）
    if (ph.until === 'water' && this.water && this.inWater(e) && m.pt > 0.25) end = true;      // 版3.0：水面から飛び出した敵は、水へ戻ったところで次の区間へ
    if (ph.stopOnHit && (m.connected || m.touched) && m.pt > 0.02) end = true;      // 版2.3：当たった（ガードされた）ところで止まる＝体当たりが主人公を通り抜けない
    if (end) {
      if (crash && !tm) { this.crash(e, m.connected || m.touched); return; }     // 突進の壁激突＝弱点（ライバルは技の表の体当たりなので自爆しない）
      const over = Math.max(0, m.pt - ph.dur);
      let nx = m.i + 1;
      // 版2.3：onlyGrab＝くわえた（つかんだ）ときだけ進む区間／onlyMiss＝外れたときだけ進む区間
      while (nx < m.def.phases.length && ((m.def.phases[nx].onlyGrab && !m.grabbed) || (m.def.phases[nx].onlyMiss && m.grabbed))) nx++;
      if (nx >= m.def.phases.length) { this.endMove(e); return; }
      this.enterPhase(e, nx);
      m.pt = over; e.anim.t = over;
    }
  }

  ramGhost(e, dt) {
    e.ghostT = (e.ghostT || 0) - dt;
    if (e.ghostT <= 0 && e.anim) {
      e.ghostT = 0.035;
      this.fx.push({ type: 'ghost', who: e.type, motion: e.anim.motion, frame: this.frameOf(e), x: e.x, y: e.y, facing: e.facing, t: 0, dur: 0.28 });
    }
  }

  moveEvent(e, ev, ph) {
    const p = this.player;
    switch (ev) {
      case 'rushFin': {   // 版2.3：スピノラッシュ（旧スピノフューリー）の最後の爪。大きな弧と土煙
        this.fx.push({ type: 'arc', x: e.x + e.facing * e.bw * 0.55, y: e.y - e.bh * 0.5, dir: e.facing, t: 0, dur: 0.34, size: 2.0 });
        this.dust(e.x + e.facing * e.bw * 0.4, e.y, 8, 90); this.shakeAdd(10);
        break;
      }
      case 'furyCut': case 'cutIn': {   // 版2.7：必殺技の目のカットイン（四天王・ティタノ・ケツァル共通）。画面が止まり、目のアップの帯が横切る（約0.5秒）
        const dur = (ph && ph.cutDur) || 0.5;
        this.cutin = { t: 0, dur, kind: (e.d.cutin && e.d.cutin.kind) || 'cut', aspect: (e.d.cutin && e.d.cutin.aspect) || 3.86, who: e.type };
        this.addHitstop(dur);
        this.flashScreen('rgba(255,255,255,0.4)', 0.14); this.shakeAdd(9);
        this.stats.cutins = (this.stats.cutins || 0) + 1;
        if (this.logHook) this.lg('cutin', { by: e.type, mv: e.move ? e.move.name : null });
        break;
      }
      case 'furyRoar': {   // 版2.7：フューリーの咆哮。地を這う衝撃の輪（跳べば越えられる・輪の絵がそのまま当たり）と、体のまわりの光の輪
        const rings = [], ES = ENEMY_ROAR_SCALE * 1.15;
        for (let k = 0; k < 3; k++) rings.push({ r0: (30 + k * 30) * ES, r1: (640 + k * 90) * ES, dur: 0.55 + k * 0.1, color: k === 0 ? '#e8fbff' : '#a8dcff', flat: true, w: 9 });
        for (let k = 0; k < 2; k++) rings.push({ r0: 30 + k * 26, r1: 330 + k * 90, dur: 0.5 + k * 0.1, color: k === 0 ? '#ffffff' : '#9fe0ff', w: 9 - k * 2, flat: false, ax: e.x + e.facing * e.bw * 0.3, ay: e.y - e.bh * 0.62 });      // 2026-10-24：体のまわりの光の輪も当たり（床の輪と同じ1回の判定を共有）
        this.spawnShock(e, rings, e.move.def.hits.shock);
        this.dust(e.x - 120 * ES, e.y, 8, 200 * ES); this.dust(e.x + 120 * ES, e.y, 8, 200 * ES);
        this.shakeAdd(14); this.flashScreen('rgba(190,235,255,0.25)', 0.2);
        break;
      }
      case 'quakeWave': {   // 版2.7：ティタノクエイク。足を叩きつけるたびに、地面を走る土色の輪（輪の絵がそのまま当たり判定）と土煙・揺れ
        const rings = [], SS = (e.d.stompScale || 1) * (ph.big || 1);
        for (let k = 0; k < 3; k++) rings.push({ r0: (40 + k * 30) * SS, r1: (560 + k * 80) * (1 + (SS - 1) * 0.3), dur: 0.7 + k * 0.1, color: k === 0 ? '#fff6b0' : k === 1 ? '#ffe27a' : '#d9b27a', flat: true, w: 11 });
        this.spawnShock(e, rings, e.move.def.hits[ph.hit]);
        this.dust(e.x - 180, e.y, 14, 280 * (ph.big || 1)); this.dust(e.x + 180, e.y, 14, 280 * (ph.big || 1));
        this.spark(e.x - e.facing * 40, e.y - 10, 'big', e.facing, 1.2);
        this.shakeAdd(ph.big ? 24 : 18); this.flashScreen('rgba(255,236,150,0.28)', 0.2);
        break;
      }
      case 'gigaRing': {   // 版2.7：ギガノト咆哮。咆哮のたびに、地面を走る黄白の衝撃の輪（輪の絵がそのまま当たり判定・跳べば越える）が広がる
        const rings = [], B = ph.big || 1;
        for (let k = 0; k < 3; k++) rings.push({ r0: (30 + k * 25) * B, r1: (560 + k * 70) * B, dur: 0.55 + k * 0.1, color: k === 0 ? '#ffffff' : k === 1 ? '#fff0a0' : '#ffd24a', flat: true, w: 9 + (B > 1 ? 3 : 0) });
        rings.push({ r0: 20, r1: 220 * B, dur: 0.4, color: '#fff7c0', w: 8, ax: e.x + e.facing * e.bw * 0.3, ay: e.y - e.bh * 0.62 });      // 2026-10-24：口の高さの光の輪も当たり
        this.spawnShock(e, rings, e.move.def.hits[ph.hit]);
        this.dust(e.x - 100, e.y, 6, 160 * B); this.dust(e.x + 100, e.y, 6, 160 * B);
        this.shakeAdd(B > 1 ? 20 : 12);
        if (ph.erupt) this.startEruption(e);
        break;
      }
      case 'dbRise':   // 版2.7：ダウンバースト。高く舞い上がって画面の上へ消える
        e.moveV = { vx: 0, vy: -1300 };
        this.ring(e.x, e.y, { r0: 20, r1: 200, dur: 0.4, color: '#e8f7ff', w: 8 });
        break;
      case 'dbMark': {   // 目印（地面の白い輪）。最初の約0.5秒は主人公を追い、そのあと固定される＝離れればかわせる
        e.moveV = null;      // 画面の上で止まって待つ
        const f = { type: 'mark', x: this.player.x, y: this.groundY, t: 0, dur: ph.dur + 0.5, follow: 0.35, owner: e };
        this.fx.push(f); e.dbMark = f;
        break;
      }
      case 'dbSlam': {   // 風の柱が落ちる。柱は絵のとおりの当たり（幅 w・地面から画面の上まで）
        const m = e.dbMark, x = m ? m.x : this.player.x;
        e.x = x;
        this.fx.push({ type: 'pillar', x, y: this.groundY, t: 0, dur: 0.6, w: 110, hit: { owner: e, hit: e.move.def.hits[ph.hit], seen: new Set() } });
        this.shakeAdd(14); this.flashScreen('rgba(220,245,255,0.3)', 0.16);
        break;
      }
      case 'dbImpact': {   // 柱が地面に着いて広がる輪（跳べば越える）と土煙
        const rings = [{ r0: 30, r1: 520, dur: 0.6, color: '#ffffff', flat: true, w: 12 }, { r0: 30, r1: 640, dur: 0.75, color: '#bfe8ff', flat: true, w: 9 }];
        this.spawnShock(e, rings, e.move.def.hits[ph.hit], this.groundY);
        this.dust(e.x - 100, this.groundY, 12, 240); this.dust(e.x + 100, this.groundY, 12, 240);
        this.sfx('quake'); this.shakeAdd(22);
        break;
      }
      case 'sweepDust':   // 版2.7：なぎ払いの1回転ごと：足元の土ぼこりと、少しの揺れ（絵は描画の白い竜巻の弧）
        this.dust(e.x - e.bw * 0.34, e.y, 5, 90); this.dust(e.x + e.bw * 0.34, e.y, 5, 90); this.shakeAdd(7);
        break;
      case 'sweepFin': {   // 版2.7：なぎ払いの最後の一撃。地面を走る白い輪と大きな土煙
        {      // 2026-10-24：白い輪と光の輪も当たり（finRing）。なぎ払いの当たり（最後の一撃 fin の箱＝体の半幅 × fin.x1）の中にいる主人公は最後の一撃の当たりで受けるので、輪はその外へ出てから当たる（輪が先に当たって一撃目の威力が変わらないように）
          // 2026-10-26（独立監査 重大-1）：届き方 reach を 1.9 の固定にしていたため、なぎ払いを 1.45 に広げた版3.7 のあとは reach(417px) が輪の最大半径(360・300)より大きくなり、hitFrom=1＝最後の輪が全距離で1回も当たらなかった。fin の表の値から取る
          const finHit = e.move?.def?.hits?.fin, reach = ((finHit && finHit.x1) || 1.9) * e.bw / 2, from = (r0, r1) => (r1 > reach ? 1 - Math.sqrt(1 - (reach - r0) / (r1 - r0)) : 1);
          const rg = [{ r0: 30, r1: 360, dur: 0.5, color: '#ffffff', flat: true, w: 12 }, { r0: 40, r1: 300, dur: 0.4, color: '#bfe8ff', w: 8, ay: e.y - e.bh * 0.3 }];
          for (const r of rg) r.hitFrom = from(r.r0, r.r1);
          this.spawnShock(e, rg, e.move.def.hits.finRing);
        }
        this.dust(e.x - e.bw * 0.4, e.y, 10, 120); this.dust(e.x + e.bw * 0.4, e.y, 10, 120);
        this.shakeAdd(16); this.flashScreen('rgba(255,255,255,0.3)', 0.16);
        break;
      }
      case 'dragSlam': this.dragSlam(e); break;
      case 'tyrantSlam': {   // 版2.8：タイランレックスクラッシュの叩きつけ。くわえた主人公を地面へ叩きつける（dragSlam）＋岩の飛び散りと地面のひび
        const grabbed = !!(e.move && e.move.grabbed && p.grab && p.grab.owner === e);
        this.dragSlam(e);
        if (grabbed) this.crunchImpact(p.x, e, 1.25);
        break;
      }
      case 'crunchFx': {   // 版2.8：外れた・ガードされたときの大きな噛み砕き。口の先の地面に岩が飛び散り、ひびが入る
        const mp = this.mouthPoint(e);
        this.crunchImpact(clamp(mp.x + e.facing * 30, 60, W - 60), e, 1.0);
        break;
      }
      case 'tyrantRoar': {   // 版2.8：締めの咆哮（当たり判定なし＝殴り返せる隙）。光の輪と土ぼこりだけ
        this.ring(e.x + e.facing * e.bw * 0.3, e.y - e.bh * 0.62, { r0: 30, r1: 300, dur: 0.5, color: '#fff3c4', w: 8 });
        this.ring(e.x, e.y, { r0: 30, r1: 360, dur: 0.6, color: '#ffe9a8', flat: true, w: 8 });
        this.dust(e.x - e.bw * 0.3, e.y, 5, 120); this.dust(e.x + e.bw * 0.3, e.y, 5, 120);
        this.shakeAdd(8);
        break;
      }
      case 'finisherFx':
        this.fx.push({ type: 'arc', x: e.x + e.facing * e.bw * 0.55, y: e.y - e.bh * 0.5, dir: e.facing, t: 0, dur: 0.3, size: 1.5 });
        break;
      case 'clawR': case 'clawL': {   // 版2.4：爪を振り抜く瞬間。光る斬撃の弧・少しの画面の揺れ
        const R = ev === 'clawR';
        this.fx.push({ type: 'swipe', x: e.x + e.facing * e.bw * 0.12, y: e.y - e.bh * (R ? 0.62 : 0.5), dir: e.facing, r: e.bh * (R ? 0.78 : 0.7), w: Math.max(SWIPE_FX.widthMin, e.bh * SWIPE_FX.widthFrac),
          a0: R ? -2.25 : 1.75, a1: R ? 0.55 : -0.95, t: 0, dur: SWIPE_FX.dur });
        this.shakeAdd(R ? 5 : 6);
        break;
      }
      case 'swimLunge': {   // 版3.0：泳ぐ敵が、主人公めがけて水の中を一直線に突っ込む（上下左右）。水の外へは出られない（出るのは breachUp だけ）
        const tx = p.x, ty = p.y - p.bh * 0.5;
        const dx = tx - e.x, dy = ty - (e.y - e.bh * 0.5);
        const L = Math.hypot(dx, dy) || 1;
        const sp = (ph && ph.speed) || 600;
        e.moveV = { vx: (dx / L) * sp, vy: (dy / L) * sp };
        e.facing = dx >= 0 ? 1 : -1;
        break;
      }
      case 'swimStop': e.moveV = null; break;      // 版3.0：突っ込み・飛び出しの終わり（その場で止まる）
      case 'swimBack': e.moveV = { vx: -e.facing * 140, vy: 40 }; break;      // 版3.0：少し下がって構える（体当たりの前）
      case 'breachDive': {   // 版3.0：水面から飛び出す前に、少し沈んで後ろへ引く
        e.moveV = { vx: -e.facing * 90, vy: 220 };
        this.bubbles(e.x, e.y - e.bh * 0.5, 5, e.bw * 0.25);
        break;
      }
      case 'breachUp': {   // 版3.0：水面を突き破って、主人公の高さ（体の中ほど）まで跳び上がる弧。重力 WATER.airG で落ちる（技の最後の区間は、水へ戻るまで）
        const w = this.water;
        if (!w) break;
        const cy = e.y - e.bh * 0.5;
        const apexC = clamp(p.y - p.bh * 0.55, w.y - 430, w.y - 50);
        const H = Math.max(90, cy - apexC), g = WATER.airG;
        const vy0 = -Math.sqrt(2 * g * H), tUp = -vy0 / g, dx = p.x - e.x;
        e.moveV = { vx: clamp(dx / (tUp * 1.1), -460, 460), vy: vy0, g };
        e.facing = dx >= 0 ? 1 : -1;
        this.stats.breachesE = (this.stats.breachesE || 0) + 1;
        if (this.logHook) this.lg('breach', { by: e.type });
        break;
      }
      case 'dive': {
        const tx = p.x, ty = p.y - p.bh * 0.55;
        const dx = tx - e.x, dy = ty - e.y;
        const L = Math.hypot(dx, dy) || 1;
        const sp = (ph && ph.speed) || 760;      // 版2.0：技の区間の speed（ケツァルコアトルスのつつきは速い）
        e.moveV = { vx: (dx / L) * sp, vy: Math.max(120, (dy / L) * sp) };
        e.facing = dx >= 0 ? 1 : -1;
        break;
      }
      case 'bigJump':      // 版2.3：大ジャンプの跳び出し（ためが終わった瞬間）。ふつうのジャンプの約1.9倍の高さ。途中で離してもそのまま上がりきる（jumpCut）
        e.vy = BIG_JUMP.v; e.onGround = false; e.sup = null; e.jumpCut = true;
        this.dust(e.x, e.y, 9, 46);
        this.ring(e.x, e.y, { r0: 16, r1: 120, dur: 0.32, color: '#fff3c4', flat: true, w: 7 });
        this.sfx('jump', 1, 0.8);
        break;
      case 'hopUp':
        e.vy = -720; e.onGround = false; e.sup = null; e.jumpCut = true;
        this.dust(e.x, e.y, 5, 30);
        break;
      case 'roarFx': {   // 咆哮：自分を中心に全方位へ広がる光の輪と衝撃
        const cy = e.y - e.bh * 0.5;
        const R = e.isPlayer ? PLAYER_WAVE_RANGE * PLAYER_ROAR_SCALE : ENEMY_ROAR_SCALE;      //版1.1b：主人公の輪は範囲と同じ倍率（見た目と判定をそろえる）／版1.2：咆哮はさらに PLAYER_ROAR_SCALE 倍
        const rh = e.rival ? this.ringHitOf(e) : null;
        if (rh) {   // ライバルの咆哮：床を走る輪だけを描き、その輪の線がそのまま当たり判定（空中の円は描かない＝跳べば避けられる）／版1.2：ENEMY_ROAR_SCALE 倍
          const ES = ENEMY_ROAR_SCALE;
          this.spawnShock(e, [{ r0: 30 * ES, r1: 640 * ES, dur: 0.5, color: '#fff3c4', flat: true, w: 10 }, { r0: 50 * ES, r1: 560 * ES, dur: 0.42, color: '#ffe9a8', flat: true, w: 8 }], rh);
        } else if (e.isPlayer && this.roarHitOf(e)) {
          this.spawnRoar(e);      // 版3.5：主人公の咆哮＝口（頭）を中心に同心円に広がる輪。輪の先端がそのまま当たりの半径
        } else {
          for (let k = 0; k < 3; k++) this.ring(e.x, cy, { r0: (40 + k * 20) * R, r1: (560 + k * 110) * R, dur: 0.42 + k * 0.1, color: k === 0 ? '#ffffff' : k === 1 ? '#ffe9a8' : '#ffc27a', w: 14 - k * 3 });
          this.ring(e.x, e.y, { r0: 30 * R, r1: 640 * R, dur: 0.5, color: '#fff3c4', flat: true, w: 10 });
        }
        this.dust(e.x - 140 * R, e.y, 8, 200 * R); this.dust(e.x + 140 * R, e.y, 8, 200 * R);
        this.flashScreen('rgba(255,236,190,0.30)', 0.22);
        this.shakeAdd(16);
        break;
      }
      case 'spawnWave': {   // 床を走る衝撃波（飛び道具）を出す。足場の上なら足場の上だけを走る。
        const pr = e.move && e.move.def.proj;
        if (!pr) break;
        const sup = e.sup && e.sup !== 'ground' ? e.sup : null;
        const RW = e.isPlayer ? PLAYER_WAVE_RANGE : 1;      // 版1.1b：主人公の衝撃波が床を走る距離（時間）
        this.waves.push({ x: e.x + e.facing * e.bw * 0.45, y: e.y, dir: e.facing, speed: pr.speed, life: pr.life * RW, t: 0, w: pr.w, h: pr.h, hit: pr.hit, seen: new Set(), sup, dustT: 0, owner: e.rival ? e : null, cp: !!(e.isPlayer && this.isPlayerCpMove(e.move)) });      // cp＝発射した技が主人公の CP 必殺か（着弾までに技が終わっても貫通を覚えておく。2026-10-23）
        this.ring(e.x + e.facing * e.bw * 0.4, e.y, { r0: 20 * RW, r1: 150 * RW, dur: 0.35, color: '#fff3c4', flat: true, w: 9 });
        this.dust(e.x + e.facing * e.bw * 0.45, e.y, 6, 40);
        this.shakeAdd(8);
        break;
      }
      case 'diveLand': {
        if (e.isPlayer && this.roarHitOf(e)) {      // 版3.5：主人公の急降下の着地＝輪の先端がそのまま当たりの横幅
          this.spawnLandShock(e);
          this.sfx('slam'); this.sfx('quake', 0.6);
          this.shakeAdd(14); this.flashScreen('rgba(255,230,180,0.25)', 0.18);
          break;
        }
        const RD = e.isPlayer ? PLAYER_WAVE_RANGE : 1;      // 版1.1b：主人公の着地の輪も範囲と同じ倍率
        const rings = [{ r0: 24 * RD, r1: 360 * RD, dur: 0.5, color: '#ffffff', flat: true, w: 12 }, { r0: 24 * RD, r1: 520 * RD, dur: 0.6, color: '#ffc27a', flat: true, w: 9 }];
        const rh = e.rival ? this.ringHitOf(e) : null;
        if (rh) this.spawnShock(e, rings, rh);       // ライバルの着地の衝撃：輪の線が当たり判定
        else for (const r of rings) this.ring(e.x, e.y, r);
        this.dust(e.x - 100 * RD, e.y, 8, 160 * RD); this.dust(e.x + 100 * RD, e.y, 8, 160 * RD);
        this.sfx('slam'); this.sfx('quake', 0.6);
        this.shakeAdd(14); this.flashScreen('rgba(255,230,180,0.25)', 0.18);
        break;
      }
      case 'diveEnd':
        e.moveV = { vx: (e.moveV ? e.moveV.vx : 0) * 0.35, vy: -280 };
        break;
      case 'roarSummon': {
        const s = e.d.summon;
        this.spawnShock(e, [{ r0: 30 * ENEMY_ROAR_SCALE, r1: 520 * ENEMY_ROAR_SCALE, dur: 0.7, color: '#bfe8ff', flat: true }, { r0: 30 * ENEMY_ROAR_SCALE, r1: 420 * ENEMY_ROAR_SCALE, dur: 0.6, color: '#ffffff', ay: e.y - e.bh * 0.5 }], e.move && e.move.def.hits.shock);      // 版1.2：敵の咆哮の輪は ENEMY_ROAR_SCALE 倍／2026-10-25：技の表に shock（輪の当たり）があれば、描かれた輪がそのまま当たり（スケルトンレックスの咆哮）
        this.shakeAdd(10);
        if (s) {
          const n = summonCount(s.n, this.summonScale(), 1);      // 版2.1：スケルトンレックスの咆哮の雑魚呼びも、難しさ・ワールド・救済で量を変える
          for (let i = 0; i < n; i++) {
            if (this.aliveCount() >= MAX_ENEMIES) break;
            this.spawnEnemy(s.type, i % 2 === 0 ? 'left' : 'right');
          }
        }
        break;
      }
      case 'roarShock': {   // 地を這う衝撃の輪（ティラノの咆哮）：輪の絵がそのまま当たり判定（spawnShock）
        const rings = [], ES = ENEMY_ROAR_SCALE;      // 版1.2：輪（＝当たり判定）は ENEMY_ROAR_SCALE 倍
        for (let k = 0; k < 3; k++) rings.push({ r0: (30 + k * 30) * ES, r1: (640 + k * 90) * ES, dur: 0.55 + k * 0.1, color: k === 0 ? '#fff3c4' : '#ffd08a', flat: true, w: 9 });
        this.spawnShock(e, rings, e.move.def.hits.shock);
        this.dust(e.x - 120 * ES, e.y, 8, 200 * ES); this.dust(e.x + 120 * ES, e.y, 8, 200 * ES);
        this.shakeAdd(14);
        break;
      }
      case 'slamWave': {    // 叩きつけの輪（ギガノトの尻尾）
        const rings = [];
        for (let k = 0; k < 3; k++) rings.push({ r0: 30 + k * 30, r1: 720 + k * 100, dur: 0.6 + k * 0.1, color: k === 0 ? '#ffffff' : '#ffc27a', flat: true, w: 10 });
        this.spawnShock(e, rings, e.move.def.hits.slam);
        this.dust(e.x - 150, e.y, 10, 220); this.dust(e.x + 150, e.y, 10, 220);
        this.shakeAdd(18); this.flashScreen('rgba(255,230,180,0.35)', 0.25);
        break;
      }
      case 'stompWave': {   // 版2.0：ティタノサウルスの踏みつけ。地面を走る重い輪（輪の絵がそのまま当たり判定）
        const rings = [];
        const SS = e.d.stompScale || 1;      // 版2.1：体が大きい敵は輪の出だしを体の外へ（広がる先は 3割だけ増やす＝画面からあふれて逃げ場が無くならない）
        for (let k = 0; k < 3; k++) rings.push({ r0: (40 + k * 30) * SS, r1: (560 + k * 80) * (1 + (SS - 1) * 0.3), dur: 0.7 + k * 0.1, color: k === 0 ? '#fff3c4' : '#d9b27a', flat: true, w: 11 });
        this.spawnShock(e, rings, e.move.def.hits.wave, e.y);
        this.dust(e.x - 180, e.y, 12, 260); this.dust(e.x + 180, e.y, 12, 260);
        this.shakeAdd(22); this.flashScreen('rgba(255,230,180,0.3)', 0.2);
        break;
      }
      case 'gustWave': {    // 版2.0：ケツァルコアトルスの羽ばたきの風。浮いたまま、真下の地面から左右へ走る風の輪を2つ（跳べば越えられる）
        const gy = this.groundY;
        const rings = [
          { r0: 30, r1: 640, dur: 0.75, color: '#e8f7ff', flat: true, w: 9 },
          { r0: 50, r1: 700, dur: 0.95, color: '#bfe4f5', flat: true, w: 7 },
        ];
        this.spawnShock(e, rings, e.move.def.hits.wind, gy);
        this.dust(e.x - 120, gy, 8, 200); this.dust(e.x + 120, gy, 8, 200);
        this.shakeAdd(10);
        break;
      }
      default: break;
    }
  }

  // ---- 版2.7：ギガノト咆哮のあとの噴火と火山弾（環境の演出。ギガノト自身が火を吐くのではない） ----
  /** 咆哮を吠え終えた瞬間：背景の火山が噴火し（光と煙）、少し遅れて火山弾が何個か降る。落ちる場所は落ちる 0.6〜0.8 秒前に地面の赤い印で予告する。怒り中は弾が増える。 */
  startEruption(e) {
    const cfg = e.d.eruption;
    if (!cfg) return;
    const p = this.player, n = e.rage ? cfg.countRage : cfg.count;
    this.eruption = { t: 0, dur: cfg.dur, x: cfg.vx * W, y: cfg.vy * H, owner: e };
    this.flashScreen('rgba(255,170,70,0.22)', 0.3); this.shakeAdd(10);
    this.sfx('explode', 0.7);
    for (let i = 0; i < n; i++) {
      const warn = this.rand(cfg.warn[0], cfg.warn[1]);
      const x = i === 0 ? clamp(p.x + this.rand(-100, 100), 90, W - 90) : this.rand(90, W - 90);
      this.bombs.push({ x, y: this.groundY, delay: cfg.start + i * cfg.gap, warn, fall: cfg.fall, t: 0, state: 'wait', owner: e, r: cfg.r, hit: cfg.hit });
    }
    this.stats.eruptions = (this.stats.eruptions || 0) + 1;
    if (this.logHook) this.lg('eruption', { by: e.type, n });
  }
  /** 火山弾の進み：待つ→予告の印（warn 秒）→落ちる（fall 秒）→着弾（小さな衝撃。主人公が着弾の幅の中にいればダメージ。ガード・パリィ不可）。 */
  updateBombs(dt) {
    if (this.eruption) { this.eruption.t += dt; if (this.eruption.t >= this.eruption.dur) this.eruption = null; }
    if (!this.bombs.length) return;
    const p = this.player;
    for (const b of this.bombs) {
      b.t += dt;
      if (b.state === 'wait' && b.t >= b.delay) { b.state = 'mark'; b.t = 0; }
      else if (b.state === 'mark' && b.t >= b.warn) { b.state = 'fall'; b.t = 0; this.sfx('whoosh', 0.5, 0.7); }
      else if (b.state === 'fall' && b.t >= b.fall) {
        b.state = 'done'; b.t = 0;
        this.ring(b.x, b.y, { r0: 10, r1: b.r * 1.7, dur: 0.32, color: '#ffd9a0', flat: true, w: 8 });
        const bref = { owner: b.owner, hit: b.hit, seen: new Set() };      // 2026-10-24：着地の輪も当たり（描いた輪の線が当たる）。中心の箱と1回の着弾で1回だけ
        { const f = this.fx[this.fx.length - 1]; f.hit = bref; f.hitT = 0; }
        this.dust(b.x, b.y, 6, 70); this.spark(b.x, b.y - 20, 'big', 1, 0.9);
        this.sfx('slam', 0.6, 1.3); this.shakeAdd(8);
        this.stats.bombLands = (this.stats.bombLands || 0) + 1;
        if (p && this.playerVulnerable() && !b.owner.dead) {
          const box = { x0: b.x - b.r, x1: b.x + b.r, y0: b.y - 150, y1: b.y + 10 };
          const body = this.bodyCells(p) || boxToCells(this.hurtBox(p));
          const ov = cellsOverlap(boxToCells(box), body);
          if (ov) { bref.seen.add(p.id); this.stats.bombHits = (this.stats.bombHits || 0) + 1; this.enemyHitsPlayer(b.owner, b.hit, ov.box, ov.box, { srcX: b.x }); }
        }
      }
    }
    this.bombs = this.bombs.filter((b) => b.state !== 'done');
  }

  // ---- 当たり判定 ----
  hurtBox(e) {
    const w = e.bw * e.d.hurt.w;
    return { x0: e.x - w / 2, x1: e.x + w / 2, y0: e.y - e.bh * e.d.hurt.y1, y1: e.y - e.bh * e.d.hurt.y0 };
  }
  hitBox(e, hit) {
    const hw = e.bw / 2;
    let x0, x1;
    const wk = hit.wave && e.isPlayer ? PLAYER_WAVE_RANGE * (hit.roar ? PLAYER_ROAR_SCALE : 1) : 1;      // 版1.1b：主人公の衝撃波系は範囲 PLAYER_WAVE_RANGE 倍／版1.2：咆哮（roar:true）はさらに PLAYER_ROAR_SCALE 倍
    const hx0 = hit.x0 * wk, hx1 = hit.x1 * wk;
    if (hit.both) { x0 = e.x + hx0 * hw; x1 = e.x + hx1 * hw; }
    else if (e.facing === 1) { x0 = e.x + hx0 * hw; x1 = e.x + hx1 * hw; }
    else { x0 = e.x - hx1 * hw; x1 = e.x - hx0 * hw; }
    const r = { x0, x1, y0: e.y - hit.y1 * e.bh, y1: e.y - hit.y0 * e.bh };
    if (hit.fit && e.anim && !this.noShape) {      // 版3.5：絵からはみ出さない（箱を、そのコマの絵の外枠＋fitPad に切り詰める）
      const c = this.bodyCells(e);
      if (c && c.length) {
        const bb = bboxOf(c), pd = HIT_TUNE.fitPad;
        const q = { x0: Math.max(r.x0, bb.x0 - pd), x1: Math.min(r.x1, bb.x1 + pd), y0: Math.max(r.y0, bb.y0 - pd), y1: Math.min(r.y1, bb.y1 + pd) };
        if (q.x1 > q.x0 && q.y1 > q.y0) return q;
      }
    }
    return r;
  }
  enemyHittable(t) {
    return t.state === 'idle' || t.state === 'move' || t.state === 'hurt' || t.state === 'stun' || t.state === 'bullet';
  }
  playerVulnerable() {
    const p = this.player;
    if (p.inv > 0 || this.purge) return false;      // 版2.2：衝撃の輪の間は攻撃されない
    if (BOSS_FIX.on && this.phase === 'clear') return false;      // 2026-11-14：CLEAR! のあとは攻撃されない。前はボスを倒す前に出ていた火山弾などが着弾し、出口へ歩く主人公がのけぞった（体力 1 は残る）
    if (p.state === 'down' || p.state === 'downed' || p.state === 'revive' || p.state === 'grabbed') return false;      // 版2.3：くわえられている間は、ほかの攻撃を受けない
    if (p.state === 'move' && p.move) { const ph = p.move.def.phases[p.move.i]; if (ph && ph.inv) return false; }
    return true;
  }

  processHit(e, m, ph) {
    const hit = m.def.hits[ph.hit];
    if (!hit || hit.ring || hit.disk) return;       // ring＝床を走る輪。輪を出すイベント（spawnShock）が当たり判定を持つ／版3.5：disk＝中心から同心円に広がる円盤（咆哮）。roarFx が円盤を出す
    const box = this.hitBox(e, hit);
    if (m.clashVoid) return;          // 版1.3：相殺で主人公をはじいたボスの振り。この振りの主人公への当たりは無効
    if (CLASH.on && this.clashable(hit) && !(!e.isPlayer && this.diveOverCharge(e, m, this.player))) { this.tryClash(e, m, hit, box); if (e.move !== m || m.clashVoid) return; }
    if (e.isPlayer) {
      for (const t of this.enemies) {
        if (m.hit.has(t.id) || !this.enemyHittable(t) || this.enemyInvuln(t)) continue;
        const ov = this.contact(e, hit, box, t);
        if (ov && CLASH.on && this.clashable(hit) && this.lookClash(e, m, t, (ov.box.x0 + ov.box.x1) / 2, (ov.box.y0 + ov.box.y1) / 2)) break;      // 版1.3：相手の攻撃が始まる直前なら相殺
        if (ov) { m.hit.add(t.id); this.playerHitsEnemy(e, t, hit, ov.box, ov.box); if (e.move !== m) break; }      // 版1.2：ガードされてはじかれたら、この技の残りの当たりは出ない
      }
    } else {
      const p = this.player;
      if (!m.hit.has(p.id) && this.playerVulnerable() && !this.diveOverCharge(e, m, p)) {      // 版3.5：上から急降下してくる主人公には、敵の突進は当たらない（急降下が勝つ）
        const ov = this.contact(e, hit, box, p);
        if (ov && CLASH.on && this.clashable(hit) && this.lookClash(e, m, p, (ov.box.x0 + ov.box.x1) / 2, (ov.box.y0 + ov.box.y1) / 2)) return;      // 版1.3：相手の攻撃が始まる直前なら相殺
        if (ov) { m.hit.add(p.id); if (this.enemyHitsPlayer(e, hit, ov.box, ov.box)) m.connected = true; else m.touched = true; }      // touched＝ガードに止められた（stopOnHit の区間は、止められても止まる）
      }
    }
  }

  // ---- 版1.3：相殺（主人公と敵の攻撃がぶつかる） ----
  /** 相殺する当たりか。輪・衝撃波（wave・lock＝衝撃波系の印）・ガードを崩す当たり（咆哮・振り回しの最後の一撃・コンボ破り）は相殺しない。 */
  clashable(hit) { return !!hit && !hit.ring && !hit.wave && !hit.lock && !hit.breakGuard; }
  /** 必殺技（ゲージを使う技・ダッシュ体当たり）か。 */
  isSpecialMove(m) { return !!m && (m.def.cost > 0 || m.name === 'dashAttack' || this.isEnemySpecialDef(m.def)); }
  /** 主人公のゲージを使う必殺技（敵のガードを貫く・敵の必殺を打ち消せる側）。 */
  isPlayerCpMove(m) { return !!m && (m.def.cost > 0 || m.name === 'dashAttack'); }
  /** 敵の必殺技（special 印・カットイン付き）。主人公の通常攻撃では打ち消されない＝相殺で「必殺×ふつう」になり、必殺はそのまま当たる（ボス・敵種の別なく共通の1か所）。 */
  isEnemySpecialDef(def) { return !!def && (!!def.special || !!def.cutin || (def.phases || []).some((ph) => ph.ev === 'cutIn' || ph.ev === 'furyCut')); }
  /** 版3.5：敵の突進（until:'wall'）で、必殺（special・カットイン・ライバルのゲージ技）でないもの。急降下に潰される側。 */
  isPlainCharge(e, m) { return !!m && !e.isPlayer && isChargeMove(m.def) && !this.isEnemySpecialDef(m.def) && !(e.rival && m.def.cost > 0); }
  /** 版3.5：主人公が急降下（dive）の降りている途中（着地前）か。 */
  isDiving(p) {
    const m = p && p.move;
    return !!m && m.name === 'dive' && m.i <= 1 && !p.onGround && p.y < this.groundY - 6;
  }
  /** 版3.5：敵 e の突進 m に対し、主人公 p が上から急降下してきている（足が敵の足元より十分高い）。このとき突進は主人公に当たらず・相殺にもならない。 */
  diveOverCharge(e, m, p) { return DIVE_OVER.on && this.isPlainCharge(e, m) && this.isDiving(p) && p.y < e.y - e.bh * DIVE_OVER.feetGap; }
  /** 相手 o が「いま当たる区間」の相殺する当たりを持っていれば、その当たり。 */
  activeClashHit(o) {
    if (!o || o.state !== 'move' || !o.move || o.dead) return null;
    const ph = o.move.def.phases[o.move.i];
    const h = ph && ph.hit ? o.move.def.hits[ph.hit] : null;
    return this.clashable(h) ? h : null;
  }
  /**
   * 攻撃 e（技 m の当たり hit）が、相手（主人公なら敵、敵なら主人公）のいま当たる区間の攻撃の部位と重なっていれば相殺する。
   * ふつう×ふつう・必殺×必殺＝両方はじかれる（ダメージ 0・ヒット数もゲージも増えない・全体のヒットストップなし）／必殺×ふつう＝ふつうの側が消えて、必殺はそのまま当たる。
   * ボス級のハイパーアーマー中は、ボスははじかれず、その振りの主人公への当たりが無効になる。
   */
  tryClash(e, m, hit, box) {
    const opps = e.isPlayer ? this.enemies : (this.player ? [this.player] : []);
    for (const o of opps) {
      const oh = this.activeClashHit(o);
      if (!oh || m.hit.has(o.id) || o.move.hit.has(e.id) || this.clashedPair(m, o, o.move, e) || !this.sameLevel(e, o)) continue;
      const pad = CLASH.pad;
      let a = this.partCells(e, hit.part, pad);
      if (!a) a = boxToCells({ x0: box.x0 - pad, x1: box.x1 + pad, y0: box.y0 - pad, y1: box.y1 + pad });
      let b = this.partCells(o, oh.part, 0);
      if (!b) b = boxToCells(this.hitBox(o, oh));
      const ov = cellsOverlap(a, b);
      if (!ov) continue;
      this.resolveClash(e, m, o, o.move, ov.cx, ov.cy);
      return;
    }
  }
  /**
   * 攻撃 e が相手 t の体に当たろうとしているとき、t の攻撃が始まる直前（CLASH.lead 秒以内に当たりの区間に入る）で、
   * その攻撃も e の体に届くなら、当たりにせず相殺にする（二人の振りの出だしが数コマずれても、先に当たった側だけが一方的に勝たない）。
   */
  lookClash(e, m, t, cx, cy) {
    if (!t.move || t.state !== 'move' || t.dead) return false;
    const tm = t.move, ph = tm.def.phases[tm.i], nx = tm.def.phases[tm.i + 1];
    if (!ph || ph.hit || !nx || !nx.hit) return false;
    const h = tm.def.hits[nx.hit];
    if (!this.clashable(h) || ph.dur - tm.pt > CLASH.lead || tm.hit.has(e.id) || m.hit.has(t.id)) return false;
    const b = this.hitBox(t, h), pad = CLASH.pad;
    const pb = { x0: b.x0 - pad, x1: b.x1 + pad, y0: b.y0 - pad, y1: b.y1 + pad };
    const body = this.bodyCells(e);
    if (!(body ? cellsOverlap(boxToCells(pb), body) : rectsOverlap(pb, this.hurtBox(e)))) return false;
    // 2026-11-15：同じ 2 つの技の相殺がもう起きていたら、当たりは前と同じく止める（true）が、「キン」・効果音・数は出し直さない
    //   （当たりの止め方まで 1 回にすると、ボスの技の出だしの間に必殺が早く当たり、遊びの手ごたえが変わった＝見直しで 1440 組中 18 組）
    if (this.clashedPair(m, t, tm, e)) return true;
    this.resolveClash(e, m, t, tm, cx, cy);
    return true;
  }
  /** 2026-11-15：技 m（e の）と技 om（o の）のあいだで、すでに相殺が起きたか（アーマー中のボスの振りと必殺の相殺を 1 回にする印）。 */
  clashedPair(m, o, om, e) {
    if (!CLASH.once) return false;
    return !!((m.clashed && m.clashed.has(o.id)) || (om && om.clashed && om.clashed.has(e.id)));
  }
  resolveClash(e, m, o, om, cx, cy) {
    const sE = this.isSpecialMove(m), sO = this.isSpecialMove(om);
    this.stats.clashes = (this.stats.clashes || 0) + 1;
    if (this.logHook) this.lg('clash', { a: e.isPlayer ? 'p' : e.type, am: m.name, b: o.isPlayer ? 'p' : o.type, bm: om.name, kind: sE !== sO ? 'sp' : (sE ? 'sp2' : 'nm') });
    if (sE !== sO) {
      // 必殺×ふつう：ふつうの側の攻撃が消える（ハイパーアーマー中のボスは消えない）。必殺は何も変わらず、そのまま当たる
      const [lo, lm] = sE ? [o, om] : [e, m];
      this.kin(cx, cy, 0.6);
      if (!lo.isPlayer && this.isArmored(lo)) {
        // 2026-11-15：アーマー中のボスの振りは消えないので、同じ 2 つの技のあいだの相殺は 1 回だけにする（前は当たりの記録が付かず、重なっている間ずっと
        //   「キン」・効果音・相殺の数が毎コマ出た＝ギガノトの薙ぎ払い×噛みつき振り回しで 1 回のやり取りに 10 回）。当たりの記録（hit）は触らない＝必殺はそのまま当たり、ボスの振りも今までどおり
        if (CLASH.once) { (m.clashed || (m.clashed = new Set())).add(o.id); (om.clashed || (om.clashed = new Set())).add(e.id); }
        return;
      }
      if (lo.isPlayer) { lo.move = null; lo.tele = false; lo.state = 'idle'; lo.chain = null; lo.hangT = 0; }
      else this.endMove(lo);
      return;
    }
    m.hit.add(o.id); om.hit.add(e.id);
    this.kin(cx, cy, 1);
    for (const [x, xm, y] of [[e, m, o], [o, om, e]]) {
      const away = sign(x.x - y.x) || -x.facing;
      this.repel(x, away, isChargeMove(xm.def) ? 'charge' : 'clash', cx, cy, { clash: true });
      if (!x.isPlayer && x.move === xm && this.isArmored(x)) xm.clashVoid = true;      // はじかれなかった（アーマー中のボス）：この振りの主人公への当たりは無効
    }
    // 切り返し：主人公だけ約0.1秒早く動け、その先のガード返し（↓＋攻撃）の窓を立てる
    const p = this.player;
    if (p.state === 'hurt' && p.repelT > 0) p.guardOkT = Math.max(p.guardOkT, p.stunT + GUARD_OK_T);
  }
  /** 「キン」の閃光（Canvas）と効果音。 */
  kin(x, y, size = 1) {
    this.fx.push({ type: 'kin', x, y, size, t: 0, dur: 0.26 });
    this.sfx('clash', size < 1 ? 0.6 : 0.95, 1.35);
  }

  // ---- 絵の外へ出る攻撃（床を走る輪・衝撃波）：描いている形がそのまま当たり ----
  /** この技の「輪」の当たり（hit.ring）。無ければ null。 */
  ringHitOf(e) {
    const hs = e.move && e.move.def.hits;
    if (!hs) return null;
    for (const h of Object.values(hs)) if (h.ring) return h;
    return null;
  }
  /**
   * 床を走る輪を出す。輪は描画の ring（fx）で、その fx に当たりを持たせる：広がる速さ・線の太さ・消える時間は絵と同じ。
   * 輪の線が主人公の体（絵の形）に触れたときだけ当たる。1回の技で1回だけ（複数の輪のどれかに触れたら、それで終わり）。
   */
  /** y：輪を出す高さ（省略は e.y＝足元。飛んでいる敵が地面へ出すときは groundY を渡す）。 */
  spawnShock(e, rings, hit, y = e.y) {
    const ref = hit && hit.ring ? { owner: e, hit, seen: new Set() } : null;     // ring でない当たり（箱）は輪に当たりを持たせない（processHit の箱が働く）
    // 2026-11-15：輪を出したときの撃った側の様子（ガードで「上から来る攻撃」かを見る）。前は当たったときの様子で見ていて、輪を出したあとに撃った側が打ち上げられると、
    //   床を走ってくる輪がガードもパリィもできなくなった（ティラノの咆哮の輪・ギガノトの薙ぎ払い・ティタノの踏みつけ など）
    if (ref) ref.src = { d: e.d, onGround: e.onGround, vy: e.vy, y: e.y };
    for (const r of rings) { this.ring(r.ax ?? e.x, r.ay ?? y, r); if (!ref) continue; const f = this.fx[this.fx.length - 1]; f.hit = ref; f.hitT = (r.hitFrom || 0) * r.dur; }      // hitFrom＝この輪は広がりの割合 u がこの値に届いてから当たる（既定 0＝出た瞬間から）
  }
  // ---- 版3.5：主人公の咆哮＝口を中心に同心円に広がる円盤の当たり ----
  /** 技の表で disk:true の当たり（咆哮・急降下の着地の衝撃）。 */
  roarHitOf(e) {
    const hs = e.move && e.move.def.hits;
    if (!hs) return null;
    for (const h of Object.values(hs)) if (h.disk) return h;
    return null;
  }
  /** 咆哮の中心＝口（頭）の位置。絵の「口」の部位のマスの重心（無ければ体の中ほど）。 */
  roarCenter(e) {
    const c = this.partCells(e, 'mouth');
    if (c && c.length) {
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < c.length; i += 4) { sx += (c[i] + c[i + 2]) / 2; sy += (c[i + 1] + c[i + 3]) / 2; n++; }
      if (n) return { x: sx / n, y: sy / n };
    }
    return { x: e.x, y: e.y - e.bh * 0.5 };
  }
  /** 咆哮の円盤を出す。見た目の輪（3本）と当たりの半径は同じ式（ringRadius）。最大の半径＝技の表の箱の端（hit.x1 × 範囲倍率 × 体の半幅）＝前の版の届き方のまま。 */
  spawnRoar(e) {
    const hit = this.roarHitOf(e), m = e.move;
    const rmax = Math.max(20, hit.x1 * PLAYER_WAVE_RANGE * PLAYER_ROAR_SCALE * (e.bw / 2) * ROAR_DISK.k);
    const c = this.roarCenter(e);
    const defs = [[0.06, 0.72, 0.42, '#ffffff', 14], [0.09, 0.86, 0.52, '#ffe9a8', 11], [0.12, 1.0, 0.62, '#ffc27a', 8]];
    const rings = [];
    for (const [a, b, dur, color, w] of defs) { this.ring(c.x, c.y, { r0: rmax * a, r1: rmax * b, dur, color, w }); rings.push(this.fx[this.fx.length - 1]); }
    this.ring(e.x, e.y, { r0: rmax * 0.08, r1: rmax * 1.0, dur: 0.5, color: '#fff3c4', flat: true, w: 10 });      // 床の輪（見た目）
    this.roars.push({ owner: e, move: m, hit, cx: c.x, cy: c.y, rmax, rings, hitT: 0, seen: new Set() });
    this.dust(e.x - rmax * 0.9, e.y, 8, rmax * 1.2); this.dust(e.x + rmax * 0.9, e.y, 8, rmax * 1.2);
  }
  /** 急降下の着地の衝撃：足元から床を左右へ広がる輪（見た目の床の輪2本）。輪の先端が当たりの横幅（高さは技の表の箱のまま）。最大＝技の表の箱の端（前の版の届き方のまま）。 */
  spawnLandShock(e) {
    const hit = this.roarHitOf(e), m = e.move;
    const rmax = Math.max(20, hit.x1 * PLAYER_WAVE_RANGE * (e.bw / 2));
    const rings = [];
    for (const [a, b, dur, color, w] of [[0.08, 0.7, 0.5, '#ffffff', 12], [0.08, 1.0, 0.6, '#ffc27a', 9]]) { this.ring(e.x, e.y, { r0: rmax * a, r1: rmax * b, dur, color, flat: true, w }); rings.push(this.fx[this.fx.length - 1]); }
    this.roars.push({ owner: e, move: m, hit, cx: e.x, cy: e.y, rmax, rings, hitT: 0, floor: true, seen: new Set() });
    this.dust(e.x - rmax * 0.55, e.y, 8, rmax * 0.9); this.dust(e.x + rmax * 0.55, e.y, 8, rmax * 0.9);
  }
  /** 着地の衝撃の当たりの箱：足元から左右へ r、高さは技の表の箱（hit.y0〜y1 × 主人公の体高）。 */
  floorBox(rs, r) { const e = rs.owner, h = rs.hit; return { x0: rs.cx - r, x1: rs.cx + r, y0: rs.cy - h.y1 * e.bh, y1: rs.cy - h.y0 * e.bh }; }      // 高さは着地した足元（rs.cy）に固定：回復中に飛び立っても衝撃は床に残る（2026-10-23）
  /** 円盤の半径＝いま見えている輪の先端（見えなくなった輪は数えない）。 */
  roarRadius(rs, t) {
    let r = 0;
    for (const f of rs.rings) { const u = t / f.dur; if (u < RING_LIVE_U) r = Math.max(r, ringRadius(f, u)); }
    return r;
  }
  /** 円盤の当たりを進める（ヒットストップで絵だけ先に進んだぶんも 1/240 秒刻みで取り戻す）。 */
  updateRoars() {
    const p = this.player;
    if (!this.roars.length) return;
    for (const rs of this.roars) {
      const f0 = rs.rings[rs.rings.length - 1];      // 時間の基準＝いちばん長く残る輪（短い輪は先に消えて時間が止まる）
      if (rs.done || !p || rs.owner !== p) { rs.done = true; continue; }
      let t = rs.hitT;
      const tEnd = f0.t;
      const m = rs.move;
      if (!rs.floor && !(p.move === m)) { rs.done = true; continue; }      // 咆哮：技が途切れたら（やられたなど）止める。着地の衝撃は輪が消えるまで広がる
      while (t < tEnd) {
        t = Math.min(tEnd, t + 1 / 240);
        const r = this.roarRadius(rs, t);
        if (r <= 0) continue;
        const bbox = { x0: rs.cx - r, x1: rs.cx + r, y0: rs.cy - r, y1: rs.cy + r };
        const disk = rs.floor ? boxToCells(this.floorBox(rs, r)) : diskCells(rs.cx, rs.cy, r, null);
        for (const e of this.enemies) {
          if (rs.seen.has(e.id) || m.hit.has(e.id) || !this.enemyHittable(e) || this.enemyInvuln(e)) continue;      // rs.seen＝この輪が当てた敵（技の区間が変わると m.hit は消えるので、同じ輪が同じ敵に2度当たらないよう輪ごとに覚える。2026-10-23）
          const body = this.bodyCells(e) || boxToCells(this.hurtBox(e));
          const ov = cellsOverlap(disk, body);
          if (!ov) continue;
          m.hit.add(e.id); rs.seen.add(e.id);
          this.playerHitsEnemy(p, e, rs.hit, ov.box, ov.box, 0, m);
          if (!rs.floor && p.move !== m) break;
        }
        if (!rs.floor && p.move !== m) { rs.done = true; break; }
      }
      rs.hitT = t;
      if (tEnd >= rs.rings[rs.rings.length - 1].dur * RING_LIVE_U) rs.done = true;
    }
    this.roars = this.roars.filter((r) => !r.done);
  }
  /** 風の柱の、いまの当たりの幅＝見えている柱の幅（shape.js の pillarWidth。描画と同じ式）。 */
  pillarHitWidth(f, u) { return pillarWidth(f.w, u); }
  /** 輪の当たりを進める（ヒットストップで絵だけ先に進んだぶんも 1/240 秒刻みで取り戻す＝輪が体をすり抜けない）。 */
  updateShocks() {
    const p = this.player;
    if (!p) return;
    for (const f of this.fx) {
      if (f.type === 'pillar' && f.hit) {      // 版2.7：風の柱（ダウンバースト）。落ちきってから消えかけるまでの間、柱の幅の全高が当たり
        const u = f.t / f.dur, ref = f.hit;
        if (u >= 0.18 && u <= 0.7 && !ref.seen.has(p.id) && !ref.owner.dead && this.playerVulnerable()) {
          const body = this.bodyCells(p) || boxToCells(this.hurtBox(p));
          const pw = this.pillarHitWidth(f, u), ov = cellsOverlap(boxToCells({ x0: f.x - pw / 2, x1: f.x + pw / 2, y0: f.y - 800, y1: f.y }), body);
          if (ov) { ref.seen.add(p.id); this.enemyHitsPlayer(ref.owner, ref.hit, ov.box, ov.box, { srcX: f.x }); }
        }
        continue;
      }
      if (f.type !== 'ring' || !f.hit) continue;
      const ref = f.hit;
      let t = f.hitT || 0;
      if (ref.seen.has(p.id) || ref.owner.dead) { f.hitT = f.t; continue; }
      const body = this.bodyCells(p) || boxToCells(this.hurtBox(p));
      const bb = bboxOf(body);
      while (t < f.t) {
        t = Math.min(f.t, t + 1 / 240);
        const u = t / f.dur;
        if (u >= RING_LIVE_U) { t = f.t; break; }            // 線がほぼ消えたあとは当たらない
        if (!this.playerVulnerable()) continue;
        const band = ringBandCells(f, u, bb);
        if (!band.length) continue;
        const ov = cellsOverlap(band, body);
        if (ov) {
          ref.seen.add(p.id);
          this.enemyHitsPlayer(ref.owner, ref.hit, ov.box, ov.box, { srcX: f.x, atkAt: GUARD_ABOVE.ringAtSpawn ? ref.src : null });
          break;
        }
      }
      f.hitT = t;
    }
  }

  // ---- 絵の形に合わせた当たり判定（src/shape.js） ----
  /** 絵の情報。ブラウザでドット絵を描いているときは artHook がそちらのマスク・倍率を返す。 */
  art(type) {
    if (this.artHook) { const a = this.artHook(type); if (a) return a; }
    const d = DINOS[type];
    return { dm: this.motions.dinos[type], key: type, scaleOf: (m) => d.scale * ((d.motionScale && d.motionScale[m]) || 1) };
  }
  /** いま描かれている向きの傾き（render.js の drawEntity と同じ決め方）。 */
  entRot(e) {
    let rot = e.state === 'dying' ? e.rot : (e.state === 'bullet' ? (e.bul ? e.bul.rot : 0) : 0);
    const k = e.anim && e.anim.key;
    if (e.isPlayer && (k === 'jump' || k === 'fall')) rot = clamp(e.vy / 2200, -0.28, 0.28) * e.facing;
    if (e.isPlayer && e.swim && e.state === 'idle') rot = swimTilt(e);      // 版3.0：泳ぎは進む向き（上下）へ体を傾ける
    if (e.state === 'drown') rot = e.rot || 0;      // 版3.0：水に落ちてもがく
    if ((e.isPlayer || e.rival) && e.move) {
      const ph = e.move.def.phases[e.move.i];
      if (ph && ph.pose) {
        if (ph.pose.tilt !== undefined) rot = ph.pose.tilt * visFacing(e);
        if (ph.pose.spin) {
          const u = clamp(e.move.pt / ph.dur, 0, 1), kk = 0.5 - 0.5 * Math.cos(Math.PI * u);
          rot = (ph.pose.spin.from + (ph.pose.spin.to - ph.pose.spin.from) * kk) * e.facing;
        }
      }
    }
    return rot || 0;
  }
  _xform(e, a, pad) {
    const m = e.anim.motion, s = a.scaleOf(m);
    const yw = yawOf(e);
    return { x: e.x, y: e.y, flip: visFacing(e) !== e.d.artFacing, s, rot: this.entRot(e), pivotH: a.dm.idle.h * s, pad, sx: yw ? yw.sx : 1 };
  }
  /** 体の判定（世界座標の箱の配列）。マスクが無ければ null。 */
  bodyCells(e, pad = 0) {
    if (!e.anim || this.noShape) return null;
    const a = this.art(e.type);
    const b = bodyRects(a.dm, e.anim.motion, this.frameOf(e));
    return b ? toWorld(b.rects, this._xform(e, a, pad)) : null;
  }
  /** 攻撃の部位の判定。part が 'area'・未指定・マスク無しなら null（技の表の箱を使う）。 */
  partCells(e, part, pad = 0) {
    if (!part || part === 'area' || !e.anim || this.noShape) return null;
    const a = this.art(e.type);
    const r = partRects(a.dm, a.key, e.d.artFacing, e.anim.motion, this.frameOf(e), part);
    return r ? toWorld(r, this._xform(e, a, pad)) : null;
  }
  /**
   * 2026-11-02（Nao「ティタノは頭以外 2分の1・ほかのボスも弱点とそうでない所で入り方を変える」）：接点 (cx,cy)（世界座標）が t の体のどの部位か。
   * 部位表（src/weak.js）の無い種・マスクの無いコマ・接点が体のマスに無い（箱だけの当たり）ときは null＝倍率 1。返り値 { name, m, weak }。
   */
  weakZone(t, cx, cy) {
    if (!t.anim || this.noShape || !WEAK_ON.on) return null;
    const a = this.art(t.type), motion = t.anim.motion, fr = this.frameOf(t);
    const zs = zonesOfFrame(a.dm, a.key, t.type, motion, fr);
    if (!zs) return null;
    const b = bodyRects(a.dm, motion, fr);
    if (!b) return null;
    const w = toWorld(b.rects, this._xform(t, a, 0));
    let best = -1, bd = 1e18;
    for (let k = 0; k < zs.length; k++) {
      const x = w[k * 4], y = w[k * 4 + 1], X = w[k * 4 + 2], Y = w[k * 4 + 3];
      const dx = cx < x ? x - cx : (cx > X ? cx - X : 0), dy = cy < y ? y - cy : (cy > Y ? cy - Y : 0), d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = k; if (d === 0) break; }
    }
    // 体のマスから離れた接点は部位を決めない。接点は「重なったマスどうしの平均」なので、広い当たり（体当たり）では体の隙間（脚のあいだ等）に落ちる。
    // 2026-11-14：隙間は絵の倍率ぶん広がる（ティタノ 2.4 倍で 32〜37px）ので、上限 24px も倍率に合わせる（前は固定で、ティタノの体当たりが ×0.5 でなく ×1 で入った）
    const lim = 24 * (WEAK_ON.scaled ? Math.max(1, a.scaleOf(motion)) : 1);
    if (best < 0 || bd > lim * lim) return null;
    return zoneInfo(t.type, zs[best]);
  }
  /** 攻撃 e の当たり hit が、対象 t の体に当たっているか。当たれば { box: 接点の枠 }。 */
  contact(e, hit, box, t) {
    const body = this.bodyCells(t);
    if (!body) return rectsOverlap(box, this.hurtBox(t)) ? { box } : null;
    // コンボ中に空中の敵を殴るときだけ、攻撃を少し膨らませる（HIT_TUNE.airPad）
    const air = e.isPlayer && this.combo > 0 && !t.onGround && t.state !== 'idle';
    const pad = air ? HIT_TUNE.airPad : 0;
    let atk = this.partCells(e, hit.part, pad);
    if (!atk) { const b = box; atk = boxToCells({ x0: b.x0 - pad, x1: b.x1 + pad, y0: b.y0 - pad, y1: b.y1 + pad }); }
    const ov = cellsOverlap(atk, body);
    return ov ? { box: { x0: ov.cx - 1, x1: ov.cx + 1, y0: ov.cy - 1, y1: ov.cy + 1 } } : null;
  }
  /** 床を走る衝撃波 w（描画の楔の形）が t の体に当たっているか。 */
  waveHitsBody(w, t) {
    const body = this.bodyCells(t);
    if (!body) return rectsOverlap({ x0: w.x - w.w / 2, x1: w.x + w.w / 2, y0: w.y - w.h, y1: w.y + 4 }, this.hurtBox(t)) ? { box: { x0: w.x - 1, x1: w.x + 1, y0: w.y - 1, y1: w.y + 1 } } : null;
    const ov = cellsOverlap(waveCells(w), body);
    return ov ? { box: { x0: ov.cx - 1, x1: ov.cx + 1, y0: ov.cy - 1, y1: ov.cy + 1 } } : null;
  }
  /** 箱 box（衝撃波など）が t の体に当たっているか。 */
  rectHitsBody(box, t) {
    const body = this.bodyCells(t);
    if (!body) return rectsOverlap(box, this.hurtBox(t)) ? { box } : null;
    const ov = cellsOverlap(boxToCells(box), body);
    return ov ? { box: { x0: ov.cx - 1, x1: ov.cx + 1, y0: ov.cy - 1, y1: ov.cy + 1 } } : null;
  }

  isFront(t, srcX) { return (srcX - t.x) * t.facing > 0; }

  /** 版2.4：def（ガードする側）にとって、atk（攻撃側）の当たり hit（当たった所の高さ cy）は「上から来る攻撃」か。上からはガードできない。 */
  guardOverhead(def, atk, hit, cy) {
    if (hit && hit.overhead) return true;
    if (hit && hit.ground) return false;      // 版2.7：地面を走る輪が出どころ（技を出した敵が空にいても、輪は正面からガードできる＝ダウンバーストの着地の輪）
    const fl = !!(atk.d && atk.d.flying);
    if (!fl && !atk.onGround) return true;
    if ((atk.vy || 0) > GUARD_ABOVE.vyDown) return true;
    // 2026-10-26（独立監査 中-2）：足元が主人公より footGap 以上高い＝上から来る攻撃、は空を飛ぶ敵（ケツァル・プテラの急降下）の見方。水の中を泳ぐ敵（swim）は、上の方を泳いでいるだけで「頭の上から落ちてくる」わけではないので除く（前は !swim が無く、60px 以上上から噛みつくとガード・パリィが無条件で貫通するはずだった）
    if (!(atk.d && atk.d.swim) && atk.y < def.y - GUARD_ABOVE.footGap) return true;
    if (cy < def.y - def.bh * GUARD_ABOVE.hitHigh) return true;
    return false;
  }

  /** 技の途中で無敵の区間にいるライバル（咆哮・噛みつき振り回し・体当たり。構えのあいだは無敵でない）。 */
  enemyInvuln(t) {
    if (t.state === 'rage') return true;       // 版2.4：怒りの演出の間は無敵
    if (t.rival && t.wakeInv > 0) return true;       // 版1.1b：起き上がった直後は無敵（倒れている間はそもそも当たらない）＝起き攻めが通らない
    if (!t.rival || t.state !== 'move' || !t.move) return false;
    const ph = t.move.def.phases[t.move.i];
    return !!(ph && ph.inv);
  }

  /** byWave: 衝撃波が当てたときは波の進む向き（±1）。吹き飛ぶ向きを波に合わせ、空中ジャンプや浮きは主人公に与えない。 */
  playerHitsEnemy(p, t, hit, box, hb, byWave = 0, mv = undefined, waveCp = false) {
    const m = mv !== undefined ? mv : p.move;      // 版3.5：mv＝当てた技（着地の衝撃は技が終わったあとも広がり続けるので、技を明示して渡す）
    t.byPlayer = true;      // 版3.3：最後に動かしたのは主人公（池・水に落ちたとき数える）
    // 版1.1b：主人公の必殺技（ゲージを使う技・ダッシュ体当たり・衝撃波）が敵をひるませる・気絶させる長さは PLAYER_SPECIAL_STUN 倍（moves.js の1か所）
    // 版1.1c：必殺技は PLAYER_SPECIAL_STUN_CHANCE の確率でだけひるませる（外れなら 0＝ひるみ・気絶なし。ダメージと吹き飛ばしは入る）。通常技は 1（確定）
    const isSpecial = !!(byWave || (m && (m.def.cost > 0 || m.name === 'dashAttack')));
    const spStun = isSpecial ? (this.stunRng() < PLAYER_SPECIAL_STUN_CHANCE ? PLAYER_SPECIAL_STUN : 0) : 1;
    if (isSpecial) { const st = this.stats; st.spHits = (st.spHits || 0) + 1; if (spStun > 0) st.spStuns = (st.spStuns || 0) + 1; }
    const dir = byWave || sign(t.x - p.x) || p.facing;
    const cx = (Math.max(box.x0, hb.x0) + Math.min(box.x1, hb.x1)) / 2;
    const cy = (Math.max(box.y0, hb.y0) + Math.min(box.y1, hb.y1)) / 2;
    // ガード（正面からだけ。体当たりは崩す）
    // 守るのは正面だけ：攻撃してきた側が正面にいて、しかも当たった所が正面側（体の中心より後ろ寄りでない）のとき
    // 版1.1b：ライバルは構えが早く効き（guard.ready）、空中から来る攻撃は守れない（読めば崩せる）。ほかの敵は従来どおり。
    // 版1.2：空中からの攻撃は全員の守りをすり抜ける（ライバルは従来どおり RIVAL_TUNE.guard.airOpen で切り替えられる）。昇り・打ち上げは跳びながら当てるので空中の攻撃
    const rg = t.rival ? RIVAL_TUNE.guard : null;
    const airAtk = (rg ? !!rg.airOpen : true) && !byWave && this.guardOverhead(t, p, hit, cy);      // 版2.4：空中だけでなく、上から来る攻撃（高さ・下向きの速さ・印）は全員の守りをすり抜ける
    // ガード貫通（Nao 10-20「提案どおりに進めて」）：主人公のゲージを使う必殺技（cost>0・ダッシュ体当たり）は敵のガードを貫く＝ガードされず、はじかれず、ダメージは通常どおり
    const pierce = this.isPlayerCpMove(m) || !!(byWave && waveCp);      // 波は発射元の技を覚えている（waveCp）＝発射後に主人公が被弾して技が終わっても貫通する
    if (pierce && t.guarding && this.isFront(t, p.x)) { this.setGuard(t, false); this.stats.guardPierced = (this.stats.guardPierced || 0) + 1; }
    if (!pierce && t.guarding && t.guardT > (rg ? rg.ready : (t.guardReady ?? 0.1)) && !airAtk && this.isFront(t, p.x) && (cx - t.x) * t.facing > -t.bw * 0.15 && !hit.breakGuard) {
      this.sfx('guard'); this.spark(cx, cy, 'guard', dir);
      t.flash = 0.1; t.guardShake = 0.2;
      if (isSpecial && m) t.heldBy = m;      // 版2.4：必殺技をガードしている間も、ガード返しなどで割り込まない
      if (t.rival) { if (t.aiS) t.aiS.guardBlocked = true; this.stats.rivalGuards = (this.stats.rivalGuards || 0) + 1; }
      this.stats.guardedHits = (this.stats.guardedHits || 0) + 1;
      if (this.logHook) this.lg('hit', { by: 'p', to: t.type, mv: byWave ? 'wave' : (m ? m.name : null), dmg: Math.max(1, Math.round(hit.dmg * 0.1)), combo: this.combo, res: 'guard', ...(t.hp - Math.max(1, Math.round(hit.dmg * 0.1)) <= 0 ? { k: 1 } : null) });
      t.hp -= Math.max(1, Math.round(hit.dmg * 0.1));
      this.addHitstop(0.04);
      if (t.hp <= 0) { this.defeat(t, dir); return; }
      // 版1.2：ガードされた攻撃の側（主人公）ははじかれる。ガードを崩す技（咆哮・噛みつき振り回し）は、はじかれずに続けて崩す
      if (m && !byWave && !breaksGuard(m.def)) this.repel(p, sign(p.x - t.x) || -p.facing, isChargeMove(m.def) ? 'charge' : 'light', cx, cy);
      return;
    }
    // 版1.1b：衝撃波系に当たった敵は waveImmune のあいだ、同じ系統の衝撃ではひるまない・浮かない（ダメージは少しだけ）
    const isWave = !!(byWave || hit.wave || hit.lock);      // lock＝範囲は変えないが、衝撃波系の連発で敵を固めないための印（技の表）
    if (isWave && t.waveImmune > 0) {
      const cd = Math.max(1, Math.round(hit.dmg * WAVE_LOCK.chip));
      if (this.logHook) this.lg('hit', { by: 'p', to: t.type, mv: byWave ? 'wave' : (m ? m.name : null), dmg: cd, combo: this.combo, res: 'chip', ...(t.hp - cd <= 0 ? { k: 1 } : null) });
      this.spark(cx, cy, 'bite', dir, 0.8); this.popup(cx, cy - 30, String(cd), { size: 16, color: '#ccc', num: cd });
      t.hp -= cd; t.flash = 0.04; if (m) m.connected = true;
      this.stats.waveChips = (this.stats.waveChips || 0) + 1;
      if (t.hp <= 0) this.defeat(t, dir);
      return;
    }
    if (isWave) { t.waveImmune = WAVE_LOCK.immuneT; t.waveFlag = true; }
    if (t.guarding && hit.breakGuard) { t.guarding = false; if (spStun > 0) t.stunT = 1.2 * spStun; this.popup(t.x, t.y - t.bh, 'GUARD BREAK!', { color: '#ffd24a', size: 30 }); }
    if (m) m.connected = true;
    if (isSpecial && m) {
      t.heldBy = m;      // 版2.4：主人公の必殺技を受けている間（この技が終わるまで）、受けた敵は切り返しなどで割り込めない
      if (t.state === 'move' && t.tele && !t.isPlayer && !t.breaking) { t.move = null; t.tele = false; t.state = 'idle'; t.cd = Math.max(t.cd, 0.3); t.breaking = false; }      // 構えの途中（まだ当たりが出ていない）の反撃は潰れる
    }
    if (t.rival && m) rivalReceived(this, t, m.name);       // 版1.1b：受けた攻撃を覚える（同じ攻撃を続けて受けたら次は必ずガード）
    const L = hit.launch || null;
    const boss = t.d.tier === 'boss';
    const airborne = t.state === 'bullet' && !t.onGround && t.y < this.groundY - 8;
    const jug = t.state === 'bullet' && t.bul ? (t.bul.juggle || 0) : 0;
    // ボスは長いコンボほど1発が効きにくい（20ヒットを超えたら1ヒットごとに3%、最小40%）＝無反撃の長いコンボで削り切れない
    const bossMul = (boss || t.rival) ? Math.max(this.bossTune.comboMin, 1 - Math.max(0, this.combo - this.bossTune.comboFrom) * this.bossTune.comboSlope) : 1;
    const mul = (t.state === 'stun' ? 1.5 : 1) * (airborne ? Math.max(0.45, 1 - jug * 0.06) : 1) * bossMul;
    const zn = this.weakZone(t, cx, cy), zm = zn ? zn.m : 1;      // 2026-11-02：部位別ダメージ（弱点は強く・それ以外は弱く）
    const dmg = Math.max(1, Math.round(hit.dmg * mul * zm));
    if (zn) { const st = this.stats; st.zoneHits = (st.zoneHits || 0) + 1; st.zoneNom = (st.zoneNom || 0) + hit.dmg * mul; st.zoneApp = (st.zoneApp || 0) + dmg; if (zn.weak) st.weakHits = (st.weakHits || 0) + 1; }
    const heavy = !!L, weak = !!zn?.weak;
    this.sfx(hit.sfx || 'hit');
    this.spark(cx, cy, hit.spark || 'bite', dir, heavy ? 1.4 : 1);
    this.addCombo(1);
    this.comboDmg = (this.comboDmg || 0) + dmg;      // 版3.5：表示だけ
    this.addScore(50 + dmg * 3);
    this.addGauge(hit.gauge || 0);
    // 停止と揺れは最大値を採るので、この一撃の弱点ぶんを先に足す。カウンター中は時間を止めない。
    if (!(t.breaking && t.state === 'move')) {
      const stop = (hit.stop ?? (heavy ? 0.1 : 0.05)) + Math.min(0.03, this.combo * 0.0015);
      this.addHitstop(stop + (weak ? 0.02 : 0));
    }
    this.shakeAdd((hit.shake || (heavy ? 6 : 3)) + (weak ? 2 : 0));
    if (heavy) this.flashScreen('rgba(255,255,255,0.18)', 0.12);
    if (weak) {      // 弱点ヒットは大きな赤橙の数字で示す
      this.popup(cx, cy - 34, String(dmg), { size: 32, color: '#ff6a3a', num: dmg, dur: 0.95 });
    } else this.popup(cx, cy - 30, String(dmg), { size: zn && zm < 1 ? 18 : 22, color: zn && zm < 1 ? '#aab4c0' : (heavy ? '#ffd24a' : '#fff'), num: dmg });      // 効きにくい部位は小さく灰色
    // 空中で当てるたび、空中ジャンプが1回戻る（階段を上るように上へつなげる）。自分も少し浮く。
    // 浮かないボス（地面に立ったまま）は、胴の6割より上へは昇れない：主人公だけが頭の上へ浮いて殴り続ける、を防ぐ
    // さらに、着地せずにボスへ入れた当たりが airHits 発を超えたら、もう昇れない（空中で張りつき続けない）
    const bossGround = (boss || t.rival) && !(airborne && t.y < this.groundY - t.bh * 0.4);      // ボス級は少し浮くだけ（胴の4割まで）なら、まだ「地面のボス」として扱う
    if (bossGround && !p.onGround && !byWave) p.bossAir = (p.bossAir || 0) + 1;
    const bossCeil = bossGround && (p.y < t.y - t.bh * this.bossTune.ceil || (p.bossAir || 0) > this.bossTune.airHits);
    if (!p.onGround && !byWave) {
      p.airHitT = AIR_COMBO_T;
      if (p.airJumps < 1) { p.airJumps = 1; this.ring(p.x, p.y - p.bh * 0.5, { r0: 10, r1: 60, dur: 0.25, color: '#7df0ff', w: 4 }); }
      if (hit.bounce && !bossCeil) {
        if (p.hangT > 0) p.vy = 0;                                    // 頂点の静止中は昇らない（その場で止まって殴る）
        else { p.vy = hit.bounce * this.liftScale() * this.altScale(p.y) * tnSqrt('riseLift'); p.jumpCut = true; }
      }
      // 昇りの当たりで一定の高さに来たら、二人そろって頂点で止まる（1回の跳躍につき1度）
      if (hit.rise && !(bossGround && this.bossTune.noHang) && !(p.hangT > 0) && !p.hangUsed && this.liftBase() - p.y >= HANG_ALT) {
        p.hangT = HANG_T; p.hangUsed = true; p.vy = 0; p.jumpCut = true;
        this.stats.hangs = (this.stats.hangs || 0) + 1;
        this.ring(p.x, p.y - p.bh * 0.5, { r0: 20, r1: 150, dur: 0.5, color: '#bff6ff', w: 6 });
        this.sfx('powerup', 0.5, 1.4);
      }
    }
    // 版3.5：上からの急降下が敵の突進（必殺でないもの）に当たったら、突進を潰す（アーマーを破って技を終わらせ、ひるませる）
    if (DIVE_OVER.on && m && m.name === 'dive' && !byWave && this.isPlainCharge(t, t.move) && this.isDiving(p)) { this.endMove(t); this.stats.diveCrush = (this.stats.diveCrush || 0) + 1; }
    const heavy2 = this.isHeavy(t), armored = heavy2 && this.isArmored(t);
    if (this.logHook) this.lg('hit', { by: 'p', to: t.type, mv: byWave ? 'wave' : (m ? m.name : null), dmg, combo: this.combo, res: t.hp - dmg <= 0 ? 'kill' : 'hit', sp: isSpecial ? 1 : 0, ...(heavy ? { lc: 1 } : null) });
    t.hp -= dmg; t.flash = armored ? 0.04 : 0.12;      // アーマー中の白い光は短く
    t.downHits = (t.downHits || 0) + 1; t.downIdle = 0;      // 版2.4：ダウン値（当てた累計ヒット数）
    if (heavy2) { t.cbN = (t.cbN || 0) + 1; t.cbT = this.bossTune.breakWin; }
    if (t.rival) { t.recent = (t.recent || 0) + 1; t.recentT = 1.6; t.gauge = Math.min(100, t.gauge + (RIVAL_TUNE.gaugeOnHurt * (hit.gauge || 0) + RIVAL_TUNE.gaugeFlat) * this.diff.rivalGauge); }
    if (t.hp <= 0) { this.defeat(t, dir); return; }
    if (heavy2) this.counterRoll(t);
    if (heavy2 && this.tryBreaker(t)) return;
    if (L && !armored && !(boss && L.spike)) {
      const away = L.facing ? p.facing : dir;
      this.launch(t, L.vx * away, L.vy, true, L.grav ?? 1, L);
      if (t.bul) t.bul.spStun = spStun;
      this.sfx('launch');
    } else if (t.state === 'bullet') {
      if (airborne) this.juggle(t, dir, p);
      else this.launch(t, dir * Math.max(Math.abs(t.vx) * 0.6, 760), -300, true);
    } else {
      if (spStun > 0) this.stagger(t, (hit.stun || 0.3) * spStun, (hit.kb || 0) * dir);
      else if (!this.isArmored(t)) t.vx = (hit.kb || 0) * dir;      // 版1.1c：ひるまなかった（動作は止まらない・押し返されるだけ）
    }
  }

  /**
   * コンボ破り：ボス級が、主人公のコンボを約 breakAt ヒット受けたら、必殺技（d.breaker）で主人公を吹き飛ばして切り返す。
   * 動ける状態（待機・のけぞり・目を回し）なら割り込んで出す。攻撃の動作中・吹き飛び中なら、動けるようになってから出す（breakPending）。
   * 出したあと breakLock 秒はもう出ない。出したら true。
   */
  tryBreaker(t, fromIdle = false) {
    const bt = this.bossTune, id = this.counterMove(t);
    if (!bt.breakAt || !id || t.breaking || t.dead || t.state === 'dying') return false;
    if (!t.breakPending) return false;      // カウンター改：抽選に当たった（counterRoll が立てた）ときだけ出す
    if (t.cbLock > 0) return false;
    if (!this.playerAlive()) return false;
    if (this.isHeld(t)) return false;      // 版2.4：必殺技を受けている間は切り返さない（終わってから）
    if (this.playerInSpecial()) return false;      // カウンター改：主人公が自分の必殺（咆哮・振り回し・体当たり等）を出している最中は割り込まない（終わってから）
    if (t.rival && id === 'roar' && t.roarCd > 0) return false;      // 版2.4：咆哮の待ち時間
    if (t.state === 'rage' || t.state === 'enter' || t.state === 'drop' || t.state === 'drown') return false;
    if (t.state === 'move' && t.move && (t.move.def.special || t.move === t.heldBy)) return false;      // 自分の必殺技の最中は、終わってから（カットイン付きの大技を途中で潰さない）
    // カウンター改：予告なし・どの状態からでも（のけぞり・目回し・吹き飛び・打ち上げ・倒れ・空中・ふつうの技の途中）強制的に立て直して出す
    if (t.state === 'bullet') { t.bul = null; t.rot = 0; t.vx = 0; if (t.vy < 0) t.vy = 0; }
    if (t.state === 'fallen') { t.sub = null; t.rot = 0; t.vx = 0; }
    if (!t.onGround && !t.d.flying) t.vy = 0;      // 空中に打ち上げられていても、着地を待たずその場で技に入る
    t.moveV = null; t.rp = null; t.repelT = 0; t.stunT = 0; t.shakeAmp = 0;
    t.breakPending = false; t.cbN = 0; t.cbT = 0;
    t.breaking = true; t.guarding = false; t.vx = 0; t.chain = null;
    t.facing = this.player.x >= t.x ? 1 : -1;
    this.startMove(t, id, { windup: bt.breakWindup });
    if (!t.move) { t.breaking = false; return false; }
    t.tele = false;      // カウンター改：予告なし（赤い光・「!」は出さない）。立ち上がりの数コマだけ絵の都合で残る
    t.cbLock = bt.breakLock + t.move.def.phases.reduce((a, x) => a + x.dur, 0);
    this.stats.breakers = (this.stats.breakers || 0) + 1;
    this.stats.counters = (this.stats.counters || 0) + 1;
    if (this.logHook) this.lg('breaker', { by: t.type, mv: id, combo: this.combo });
    this.popup(clamp(t.x, 140, W - 140), t.y - t.bh - 60, 'COUNTER!', { color: '#ff6a4a', size: 34, dur: 0.9 });
    this.shakeAdd(8); this.sfx('powerup', 0.9, 1.9); this.sfx('quake', 0.7);      // 合図は技の出始めと同時：文字・揺れ・高い音
    return true;
  }

  /** カウンター改：カウンターで出す技の id（表 d.counter。無ければ d.breaker）。カットイン付きの必殺技（special）は使わない。 */
  counterMove(t) {
    const d = t.d, id = d.counter || d.breaker, def = id && d.moves && d.moves[id];
    if (!def) return null;
    if (def.special || def.cutin) return (d.breaker && d.moves[d.breaker] && !d.moves[d.breaker].special) ? d.breaker : null;
    return id;
  }
  /** カウンターの確率：コンボ breakAt で base、1 コンボ増えるごとに step、上限 max（調整スライダーで 3 つとも変えられる）。 */
  counterP(combo) {
    const bt = this.bossTune, n = Math.max(0, combo - bt.breakAt);
    const mx = clamp(bt.counterMax * tn('counterMax'), 0, 1);
    return clamp(bt.counterBase * tn('counterChance') + bt.counterStep * tn('counterStep') * n, 0, mx);
  }
  /**
   * 2026-10-24（Nao「おすすめで」）：壁への激突・叩きつけ・玉突きで受けたダメージも、ボスのカウンターの数（cbN）と抽選に入れる。
   * 直接殴らずに玉突き・壁で削り続けてもカウンターが出ないことがないように。割り込みは updateEnemy の tryBreaker に任せる（吹き飛びの途中の処理を壊さない）。
   * 玉突きで反撃中のボスが止まる確率（chainStop 30%）は変えない。
   */
  countBossHit(t) {
    if (!this.isHeavy(t) || t.dead || t.hp <= 0) return;
    t.cbN = (t.cbN || 0) + 1; t.cbT = this.bossTune.breakWin;
    this.counterRoll(t);
  }
  /** カウンター改：ボス級が主人公の攻撃を受けるたびに、コンボが breakAt 以上なら確率でカウンターを仕掛ける（専用乱数）。待ち時間の間・出している最中・すでに仕掛ける予定のときは引かない。 */
  counterRoll(t) {
    const bt = this.bossTune;
    if (!bt.breakAt || !this.counterMove(t) || t.dead || t.breaking || t.breakPending || t.cbLock > 0) return false;
    const combo = t.cbN;      // Nao 10-18「おすすめで」：数えるのはそのボス個体への被弾数だけ（世界のコンボ this.combo は使わない。雑魚で稼いだコンボでボスへの1発目から抽選されない）
    if (combo < bt.breakAt) return false;
    const pr = this.counterP(combo), r = this.counterRng(), hit = r < pr;
    this.stats.counterRolls = (this.stats.counterRolls || 0) + 1;
    if (this.logHook) this.lg('counterRoll', { by: t.type, combo, p: Math.round(pr * 1000) / 1000, hit: hit ? 1 : 0 });
    if (hit) { t.breakPending = true; t.breakPendAt = this.time; }
    return hit;
  }
  /** 主人公が自分の必殺（CP 技：咆哮・振り回し・体当たり等）の最中か。 */
  playerInSpecial() { const p = this.player; return !!(p && p.state === 'move' && p.move && SPECIAL_MOVES.includes(p.move.name)); }

  /** ボス級ののけぞらない・吹き飛ばない（ハイパーアーマー）など、ボス級かどうか。 */
  isHeavy(t) { return t.d.tier === 'boss' || !!t.rival; }

  /**
   * ハイパーアーマー：技の表の armor の区間（突進など）、およびボス級が攻撃の動作に入ってから最後の当たり・イベントの区間が終わるまで。
   * アーマー中はのけぞらず・吹き飛ばない（ダメージは入る・ヒット数は数える）。最後の戻りの区間は殴れば止まる。
   */
  isArmored(t) {
    if (t.breaking && t.state === 'move') return true;      // カウンター改：カウンターの最中は完全なハイパーアーマー（その技が終わるまで、主人公の攻撃・必殺・打ち上げ・ひるみで中断されない）
    if (t.state === 'move' && t.move) {
      const m = t.move, ph = m.def.phases[m.i];
      if (ph && ph.armor) return true;
      if (ph && ph.open) return false;      // 版2.8：締めの咆哮など、必ず殴れる隙の区間（どの枝の戻りでも）
      if (this.bossTune.armor && this.isHeavy(t)) {
        let last = -1;
        m.def.phases.forEach((x, i) => { if (x.hit || x.ev) last = i; });
        if (m.i <= last) return true;
      }
    }
    return false;
  }

  /**
   * 版1.2：ガードされた攻撃の側をはじく。REPEL の dist(px) だけ後ろへ下がり、stun 秒のあいだ動けない（Damage の最初の数コマ＝動作表の repel）。
   * 主人公の攻撃が敵のガードに止められたとき・敵の攻撃が主人公のガードに止められたとき、どちらにも使う。away＝はじかれる向き（±1）。
   * ふつうの攻撃(light)はボス級のハイパーアーマー中ははじかれない（従来どおり）。突進(charge)は貫いてはじく。
   */
  repel(e, away, kind, cx, cy, opt = null) {
    const R = REPEL[kind];
    if (!REPEL.on || !R || e.dead || e.state === 'dying' || e.state === 'bullet') return;
    if (!e.isPlayer && kind !== 'charge' && kind !== 'gCharge' && kind !== 'gLight' && this.isArmored(e)) return;
    const clash = !!(opt && opt.clash);       // 版1.3：相殺ではじかれる。全体のヒットストップ・輪・CLANG! は出さない（キンの閃光は呼び出し側）
    let stun = R.stun, rp = null;
    if (kind === 'clash') {
      // 約0.16秒止まって震える→約0.16秒かけて逆向きに滑る。主人公だけ止まる時間が early 秒短い（早く動ける）
      const fr = Math.max(0, R.freeze - (e.isPlayer ? R.early : 0));
      stun = fr + R.slide;
      rp = { freeze: fr, slide: R.slide, slideT: R.slide, v0: 2 * R.dist / R.slide, away };
    } else if (clash && e.isPlayer && CLASH_EARLY > 0) stun = Math.max(0.1, stun - CLASH_EARLY);
    const v0 = Math.sqrt(2 * (e.isPlayer ? 1800 : 1500) * R.dist);       // 硬直中の摩擦（updatePlayer 1800・updateEnemy 1500 px/s²）で R.dist だけ滑って止まる速さ
    e.move = null; e.tele = false; e.moveV = null; e.chain = null; e.guarding = false; e.breaking = false;
    if (e.isPlayer) { e.hangT = 0; e.dashT = 0; e.inv = 0; }
    if (e.rival) { e.escRoll = false; if (e.aiS) e.aiS.string = 0; }       // 硬直中に咆哮で切り返さない（はじかれた硬直は守る）
    e.state = 'hurt'; e.stunT = stun; e.vx = rp ? 0 : away * v0; e.repelT = stun; e.rp = rp;
    if (e.d && e.d.flying) e.vy = 0;       // 夜間デバッグ：飛ぶ敵が急降下の途中ではじかれると、降下の速さが残って地面の下まで沈んだ（stagger と同じく縦の速さを止める）
    if (kind === 'clash') e.shakeAmp = R.jitter;
    this.onceAnim(e, 'repel', stun);
    this.stats.repels = (this.stats.repels || 0) + 1;
    if (clash) return;
    this.spark(cx ?? e.x, cy ?? e.y - e.bh * 0.5, 'big', away, kind === 'charge' ? 1.1 : 0.7);
    this.ring(cx ?? e.x, cy ?? e.y - e.bh * 0.5, { r0: 8, r1: kind === 'charge' ? 90 : 56, dur: 0.22, color: '#bff6ff', w: 5 });
    this.sfx('slam', 0.5, 1.4);
    this.shakeAdd(kind === 'charge' ? 8 : 3);
    if (kind === 'charge') this.addHitstop(0.06);
    this.popup(clamp(e.x, 100, W - 100), e.y - e.bh - 16, 'CLANG!', { size: 22, color: '#ffd24a', dur: 0.5 });
  }

  /** 版1.3：相殺ではじかれている間の動き（止まる→逆向きに滑る）。はじかれ中でなければ捨てる。 */
  tickRepel(e, dt) {
    const r = e.rp;
    if (!r) return;
    if (!(e.repelT > 0) || e.state !== 'hurt') { e.rp = null; return; }
    if (r.freeze > 0) { r.freeze -= dt; e.vx = 0; return; }
    r.slide -= dt;
    e.vx = r.slide > 0 ? r.away * r.v0 * (r.slide / r.slideT) : 0;
    if (r.slide <= 0) e.rp = null;
  }

  /** 版1.3：被弾して硬直している間だけ、描画を震わせる（毎フレーム符号反転×decay で減衰）。ヒットストップ中は減衰させず、震えたまま止まる。 */
  tickJitter(dt, stopped) {
    const list = this.player ? [this.player, ...this.enemies] : this.enemies;
    for (const e of list) {
      if (!(e.shakeAmp > 0)) { e.shakeX = 0; continue; }
      if (e.state !== 'hurt' && e.state !== 'stun') { e.shakeAmp = 0; e.shakeX = 0; continue; }
      e.jSign = -(e.jSign || 1);
      e.shakeX = e.jSign * e.shakeAmp;
      if (!stopped) { e.shakeAmp *= Math.pow(HURT_JITTER.decay, dt * 60); if (e.shakeAmp < 0.3) e.shakeAmp = 0; }
    }
  }

  stagger(t, stun, kbV) {
    if (this.isArmored(t)) return;
    if (this.isHeavy(t)) stun *= this.bossTune.flinchMul * (t.rage ? t.rage.flinch : 1);
    t.move = null; t.tele = false; t.guarding = false;
    t.state = 'hurt'; t.stunT = stun; t.vx = kbV; t.moveV = null;
    t.rp = null; t.repelT = 0; if (HURT_JITTER.on) t.shakeAmp = HURT_JITTER.amp;      // 版1.3：被弾の震え
    if (t.rival) { t.chain = null; if (t.aiS) t.aiS.string = 0; rivalOnHurt(this, t); }
    if (t.d.flying) { t.vx = kbV * 0.6; t.vy = 0; }
    this.onceAnim(t, 'hurt', Math.max(0.2, stun));
  }

  /** 吹き飛ばし。spec は技の表の launch（float=浮かせる / spike=叩き落とし / bounce=地面で跳ね返る強さ）。 */
  launch(t, vx, vy, byPlayer, grav = 1, spec = {}) {
    const boss = t.d.tier === 'boss';
    if (byPlayer) t.byPlayer = true;      // 版3.3
    const wt = (t.d.weight || 1) * (t.rage ? t.rage.weight : 1);      // 版1.1b：重さで初速を割る（ボス級の耐性は重さに一本化）
    t.state = 'bullet'; t.move = null; t.tele = false; t.guarding = false; t.moveV = null; t.chain = null;
    const heavyT = boss || t.rival;
    // 版2.6：縦の初速は重さ 1 未満でも 1 と同じ（軽い雑魚が画面の外へ消えない）。打ち上げ（float）の高さは前の LAUNCH.heightMul 倍（雑魚だけ）
    const wtV = Math.max(wt, LAUNCH.minWeightV);
    let gk = 1;
    t.vx = vx / wt; t.vy = vy / wtV;
    if (spec.float && vy < 0) {      // 打ち上げの高さを heightMul×スライダー 倍にする。高さ ∝ 初速²/重力。重力を h^-gravShare 倍・初速を h^((1-gravShare)/2) 倍にすると高さがちょうど h 倍（h=0.5 なら重力 1.5 倍・初速 0.87 倍）
      const h = LAUNCH.heightMul * tn('liftHeight');
      t.vy *= Math.pow(h, (1 - LAUNCH.gravShare) / 2);
      gk = Math.pow(h, -LAUNCH.gravShare);
    }
    t.onGround = false; t.sup = null; t.landed = false;
    const spin = spec.float ? sign(vx || 1) * 5 : spec.spike ? sign(vx || 1) * 3 : sign(vx) * this.rand(9, 13);
    t.bul = { rot: 0, rotV: boss ? 0 : spin, hit: new Set(), boss, from: byPlayer ? 'p' : 'e', gravMul: grav * gk, juggle: 0,
      up: !!spec.float, soft: heavyT && !!spec.float, spike: !!spec.spike, slammed: false, restitution: spec.bounce ?? 0.32 };
    t.rot = 0;
    if (spec.float) this.stats.launchers++;
    this.holdAnim(t, 'launched');
    if (Math.abs(vx) > 300) this.fx.push({ type: 'streak', x: t.x, y: t.y - t.bh * 0.5, dir: sign(vx), t: 0, dur: 0.35 });
    this.dust(t.x, t.y, spec.float ? 8 : 6, t.bw * 0.2);
  }

  /**
   * お手玉：空中の敵を殴るたびに少し浮く。主人公が上へ昇っているときは、敵の上向きの速さを主人公に合わせて足す
   * （二人そろって上へ運ばれる）。コンボが長いほど浮きが弱く・落下が速くなる（無限には昇れない）。
   */
  juggle(t, dir, p) {
    const b = t.bul;
    this.stats.juggles++;
    b.juggle = (b.juggle || 0) + 1;
    b.wallN = 0;      // 版2.6：殴り直したら、壁の激突の数え直し
    const ls = this.liftScale() * this.altScale(t.y);       // 長いコンボ・高い所ほど浮きが弱い
    // 敵の重さは主人公の空中攻撃中の重力に合わせる（置いていかれず、離れずに昇れる）。コンボが長いほど落ちやすい。
    b.gravMul = Math.min(1.5, Math.max(JUGGLE.grav + 0.06 * b.juggle + 0.012 * this.combo, (this.airGrav() * GRAV / BULLET_GRAV) * 0.95));
    const wt = (t.d.weight || 1) * (t.rage ? t.rage.weight : 1);
    let vy = JUGGLE.lift * ls / Math.max(wt, LAUNCH.minWeightV) * tnSqrt('riseLift');      // 版1.1b：重いほど浮かない（版2.6：軽い敵も重さ 1 と同じまで・スライダー『昇りの浮き』）
    const hv = this.isHeavy(t);
    if (hv) vy = (this.groundY - t.y) < t.bh * 0.3 ? vy * 0.4 : 0;     // ボス級は浮きにくい：少し浮くだけ・それ以上は持ち上がらない（主人公が頭の上へ昇って殴り続けない）
    else if (p && !p.onGround) vy = Math.max(-JUGGLE.vMax, Math.min(vy, p.vy - 50 * ls));   // 主人公の上向きの速さに少し足す＝二人そろって昇る（版2.6：足す速さに上限）
    const hang = p && p.hangT > 0;                              // 頂点の静止中は敵もその場に止まる（重力は updateBullet が切る）
    t.vy = hang ? -20 : vy;
    t.vx = hang ? dir * 30 : dir * (JUGGLE.push + Math.min(60, b.juggle * 10)) / wt;
    b.rotV = dir * this.rand(6, 10);
    b.up = true; b.spike = false;
    b.hit.clear();
    this.fx.push({ type: 'streak', x: t.x, y: t.y - t.bh * 0.5, dir, t: 0, dur: 0.25 });
  }

  /** 叩き落とした敵が地面に着いた瞬間：追加ダメージと衝撃。跳ね返ってもう一度拾える。 */
  spikeSlam(t, vy) {
    const b = t.bul;
    b.slammed = true;
    const dmg = Math.round(10 + vy / 70);
    this.stats.slams++;
    this.addCombo(1);
    this.addScore(300);
    if (b.from === 'p') this.addGauge(5);
    this.sfx('slam'); this.sfx('quake', 0.6);
    const RS = b.from === 'p' ? PLAYER_WAVE_RANGE : 1;      // 版1.1b：主人公が叩きつけた着地の輪
    this.ring(t.x, t.y, { r0: 20 * RS, r1: 260 * RS, dur: 0.4, color: '#fff3c4', flat: true, w: 8 });
    this.dust(t.x, t.y, 10, t.bw * 0.4 * RS);
    this.shakeAdd(Math.min(16, 6 + vy / 150));
    this.addHitstop(0.08);
    this.popup(clamp(t.x, 120, W - 120), t.y - t.bh - 24, 'SMASH!', { color: '#ffd24a', size: 34 });
    if (this.logHook) this.lg('hit', { by: b.from === 'p' ? 'p' : 'e', to: t.type, mv: 'spike', dmg, combo: this.combo, res: t.hp - dmg <= 0 ? 'kill' : 'hit' });
    this.comboDmg = (this.comboDmg || 0) + dmg;      // 版3.8：叩きつけのダメージも TOTAL に（表示だけ）
    t.hp -= dmg; t.flash = 0.15;
    if (t.hp <= 0) this.defeat(t, sign(t.vx) || 1);
    else this.countBossHit(t);
  }

  // ---- 床を走る衝撃波（飛び道具）：当たった敵を浮かせて前へ飛ばす。1つの波は1体に1回だけ。足場の端・画面の端・時間切れで消える。 ----
  updateWaves(dt) {
    if (!this.waves.length) return;
    const p = this.player;
    for (const w of this.waves) {
      w.t += dt;
      w.x += w.dir * w.speed * dt;
      w.dustT -= dt;
      if (w.dustT <= 0) { w.dustT = 0.04; this.dust(w.x - w.dir * 20, w.y, 1, 14); }
      const box = { x0: w.x - w.w / 2, x1: w.x + w.w / 2, y0: w.y - w.h, y1: w.y + 4 };
      if (w.owner) {   // ライバルの衝撃波：主人公に当たる（跳べば越えられる高さ）。ほかの敵には当たらない。
        if (!w.seen.has(p.id) && this.playerVulnerable()) {
          const ov = this.waveHitsBody(w, p);       // 敵の衝撃波：描いている楔の形がそのまま当たり
          if (ov) { w.seen.add(p.id); this.enemyHitsPlayer(w.owner, w.hit, ov.box, ov.box, { srcX: w.x - w.dir * 40, wave: true }); w.speed *= 0.93; }
        }
        if (w.sup && (w.x < w.sup.x - 10 || w.x > w.sup.x + w.sup.w + 10)) w.t = w.life;
        if (w.x < -40 || w.x > W + 40) w.t = w.life;
        continue;
      }
      for (const t of this.enemies) {
        if (w.seen.has(t.id) || !this.enemyHittable(t) || this.enemyInvuln(t)) continue;
        const ov = this.rectHitsBody(box, t);
        if (!ov) continue;
        w.seen.add(t.id);
        this.stats.waveHits = (this.stats.waveHits || 0) + 1;
        this.playerHitsEnemy(p, t, w.hit, ov.box, ov.box, w.dir, undefined, w.cp);
        w.speed *= 0.93;
      }
      if (w.sup && (w.x < w.sup.x - 10 || w.x > w.sup.x + w.sup.w + 10)) w.t = w.life;
      if (w.x < -40 || w.x > W + 40) w.t = w.life;
    }
    this.waves = this.waves.filter((w) => w.t < w.life);
  }

  // ---- 弾（吹き飛ばされた敵） ----
  /**
   * 版3.0：吹き飛ばされた泳ぐ敵。水の外では重力で飛び、水に入ると抵抗で勢いが落ちて、止まったら泳ぎに戻る（水の中には「倒れて起き上がる」が無い）。
   * 壁・玉突きは陸の敵と同じ。海底より下へは行かない。
   */
  updateSwimBullet(t, dt) {
    const b = t.bul, wet = this.inWater(t);
    if (!wet) t.vy += BULLET_GRAV * (b.gravMul ?? 1) * dt;
    else { const k = Math.exp(-WATER.drag * 1.3 * dt); t.vx *= k; t.vy *= k; b.rotV *= Math.exp(-2.5 * dt); }
    t.x += t.vx * dt; t.y += t.vy * dt;
    if (!b.boss) b.rot += b.rotV * dt;
    const r = t.bw * 0.36;
    if (t.x - r < 0 && t.vx < 0) this.wallSlam(t, -1, r);
    else if (t.x + r > W && t.vx > 0) this.wallSlam(t, 1, r);
    if (t.dead || t.state !== 'bullet') return;
    if (t.y > this.groundY - 2 && !this.inGap(t.x)) { t.y = this.groundY - 2; if (t.vy > 0) t.vy = 0; }
    if (Math.abs(t.vx) >= 350) {
      for (const o of this.enemies) {
        if (o === t || b.hit.has(o.id)) continue;
        if (!(o.state === 'idle' || o.state === 'move' || o.state === 'hurt' || o.state === 'stun' || (o.state === 'bullet' && Math.abs(o.vx) < 300))) continue;
        if (!this.bodiesTouch(t, o)) continue;
        b.hit.add(o.id);
        this.chainHit(t, o);
        if (t.dead || t.state !== 'bullet') return;
      }
    }
    if (wet && Math.hypot(t.vx, t.vy) < 240) this.settleSwim(t);
  }
  /** 版3.0：吹き飛びが水の中で止まった。ボス級は少し目を回すか立て直し、雑魚は少しのけぞって泳ぎに戻る。 */
  settleSwim(t) {
    const boss = t.bul && (t.bul.boss || t.bul.soft);
    const spStun = (t.bul && t.bul.spStun != null) ? t.bul.spStun : 1;
    t.bul = null; t.rot = 0; t.vx = 0; t.vy = 0; t.moveV = null;
    this.loopAnim(t, 'idle');
    if (boss && spStun > 0) { t.state = 'stun'; t.stunT = 0.6 * spStun; this.holdAnim(t, 'launched'); return; }
    if (boss) { t.state = 'idle'; t.cd = 0.3; return; }
    t.downHits = 0;
    t.state = 'hurt'; t.stunT = 0.5; this.onceAnim(t, 'hurt', 0.5);
  }

  updateBullet(t, dt) {
    if (t.d.swim && this.water) { this.updateSwimBullet(t, dt); return; }
    const b = t.bul;
    // 頂点の静止：主人公が止まっている間、持ち上げられた敵（b.up）も重力を切ってその場に浮く
    const hangNow = this.player && this.player.hangT > 0 && b.up && !b.spike && b.from === 'p';
    t.vy += BULLET_GRAV * (hangNow ? 0 : (b.gravMul ?? 1)) * dt;
    if (hangNow) { t.vy *= Math.exp(-dt * 8); t.vx *= Math.exp(-dt * 4); }
    t.x += t.vx * dt; t.y += t.vy * dt;
    if (!b.boss) b.rot += b.rotV * dt;
    const r = t.bw * 0.36;
    if (t.x - r < 0 && t.vx < 0) this.wallSlam(t, -1, r);
    else if (t.x + r > W && t.vx > 0) this.wallSlam(t, 1, r);
    if (t.dead || t.state !== 'bullet') return;
    let onFloor = false;
    if (t.y >= this.groundY) {
      t.y = this.groundY;
      if (t.vy > 380) {
        if (b.spike && !b.slammed) { this.spikeSlam(t, t.vy); if (t.dead || t.state !== 'bullet') return; }
        t.vy = -t.vy * (b.restitution ?? 0.32); b.restitution = 0.32; b.rotV *= 0.7;
        this.dust(t.x, t.y, 4, t.bw * 0.2);
        if (t.vy < -150) this.sfx('land', 0.5, 0.8);
      } else {
        t.vy = 0; onFloor = true;
        t.vx -= sign(t.vx) * Math.min(Math.abs(t.vx), (b.boss ? 1500 : 1100) * dt);
        b.rotV *= 1 - Math.min(1, dt * 6);
        if (!b.boss) { const tgt = Math.round(b.rot / TAU) * TAU; b.rot += (tgt - b.rot) * Math.min(1, dt * 9); }
        if (Math.abs(t.vx) > 250 && (b.dustT = (b.dustT || 0) - dt) <= 0) { b.dustT = 0.06; this.dust(t.x, t.y, 1, t.bw * 0.2); }
      }
    }
    // 玉突き
    if (Math.abs(t.vx) >= 350) {
      for (const o of this.enemies) {
        if (o === t || b.hit.has(o.id)) continue;
        if (!(o.state === 'idle' || o.state === 'move' || o.state === 'hurt' || o.state === 'stun' || (o.state === 'bullet' && Math.abs(o.vx) < 300))) continue;
        if (!this.bodiesTouch(t, o)) continue;
        b.hit.add(o.id);
        this.chainHit(t, o);
        if (t.dead || t.state !== 'bullet') return;
      }
    }
    if (onFloor && Math.abs(t.vx) < 230) this.settle(t);
  }

  /** 2体の体が（絵の形で）触れているか。玉突き用。マスが無いときだけ従来の箱。 */
  bodiesTouch(a, b) {
    return !!cellsOverlap(this.bodyCells(a) || boxToCells(this.hurtBox(a)), this.bodyCells(b) || boxToCells(this.hurtBox(b)));
  }

  chainHit(t, o) {
    const dirn = sign(t.vx) || 1;
    const spd = Math.abs(t.vx);
    const dmg = Math.round(8 + spd / 90);
    const cx = (t.x + o.x) / 2, cy = o.y - o.bh * 0.5;
    this.stats.chains++;
    this.addCombo(1);
    this.addScore(300);
    if (t.bul && t.bul.from === 'p') this.addGauge(4);
    this.sfx('launch', 0.9, 1.1); this.sfx('hit', 0.8);
    this.spark(cx, cy, 'big', dirn, 1.3);
    this.popup(cx, cy - 40, 'CHAIN!', { color: '#7df0ff', size: 32 });
    this.addHitstop(0.08); this.shakeAdd(Math.min(14, spd / 120));
    if (this.logHook) this.lg('hit', { by: t.bul && t.bul.from === 'p' ? 'p' : 'e', to: o.type, mv: 'chain', dmg, combo: this.combo, res: o.hp - dmg <= 0 ? 'kill' : 'hit' });
    if (t.byPlayer || (t.bul && t.bul.from === 'p')) o.byPlayer = true;      // 版3.3：玉突きの先も、主人公の技が元なら主人公のぶん
    this.comboDmg = (this.comboDmg || 0) + dmg;      // 版3.8：玉突きのダメージも TOTAL に（表示だけ）
    o.hp -= dmg; o.flash = 0.14;
    if (o.hp <= 0) { this.defeat(o, dirn); }
    else if (o.breaking && o.state === 'move' && !this.chainStops(o)) { /* 版3.8：反撃（完全アーマー）の最中のボスは、玉突きでは基本止まらない（ダメージとヒット数は入る） */ }
    else this.launch(o, dirn * spd * 0.85, -280, false);       // 飛ばされる側の重さは launch が割る
    if (o.hp > 0) this.countBossHit(o);
    t.vx *= clamp(0.75 - 0.12 * ((o.d.weight || 1) / (t.d.weight || 1) - 1), 0.35, 0.9);      // 重い相手にぶつかると、ぶつけた側が失う勢いが大きい
  }

  /** 玉突きで反撃中のボスが止まる確率（既定 COUNTER.chainStop = 30%。スライダー 100% = 既定）。 */
  chainStopP() { return clamp(COUNTER.chainStop * tn('chainStop'), 0, 1); }
  /** 版3.8（Nao 決定）：反撃（完全アーマー）の最中のボスに玉突きがぶつかったとき、止めるか。専用乱数で抽選し、遊びの記録に残す。 */
  chainStops(o) {
    const pr = this.chainStopP(), hit = this.chainRng() < pr;
    this.stats.chainRolls = (this.stats.chainRolls || 0) + 1;
    if (hit) { this.stats.chainStops = (this.stats.chainStops || 0) + 1; o.breaking = false; }      // 止める：反撃は中断（待ち時間 cbLock はそのまま残る）
    if (this.logHook) this.lg('chainRoll', { to: o.type, p: Math.round(pr * 1000) / 1000, hit: hit ? 1 : 0 });
    return hit;
  }

  wallSlam(t, side, r) {
    const spd = Math.abs(t.vx);
    const b = t.bul;
    if (spd > 380) {
      const rep = b.wallN || 0;      // 版2.6：同じ吹き飛びの中の2回目・3回目以降は、ダメージだけ減らす（音・揺れ・止めは同じ）
      b.wallN = rep + 1;
      const rk = rep === 0 ? 1 : Math.min(1, WALL.repeat[Math.min(rep, WALL.repeat.length - 1)] * tn('wallDmg2'));
      const dmg = Math.max(1, Math.round((6 + spd / 55) * (b.boss ? 1.5 : 1) * rk));
      this.stats.slams++;
      this.stats.wallBangs = (this.stats.wallBangs || 0) + 1;      // 2026-11-14：壁の激突だけの数（ALL CLEAR 画面の「壁ドン」。slams は叩きつけの着地・敵の自爆も数える）
      this.addCombo(1);
      this.addScore(300);
      if (b.from === 'p') this.addGauge(5);
      this.sfx('slam');
      if (spd > 800) this.sfx('quake', 0.7);
      const wx = side < 0 ? 0 : W;
      this.spark(wx + (side < 0 ? 24 : -24), t.y - t.bh * 0.5, 'wall', side, 1 + spd / 1500);
      this.ring(wx, t.y - t.bh * 0.5, { r0: 10, r1: 150 + spd / 8, dur: 0.35, color: '#fff7d6', w: 8 });
      this.dust(wx + (side < 0 ? 40 : -40), t.y, 8, 40);
      this.shakeAdd(Math.min(24, spd / 65));
      this.addHitstop(0.06 + Math.min(0.08, spd / 20000));
      this.popup(clamp(t.x, 120, W - 120), t.y - t.bh - 20, spd > 800 ? 'SLAM!!' : 'SLAM!', { color: '#ffd24a', size: spd > 800 ? 40 : 30 });
      if (this.logHook) this.lg('hit', { by: b.from === 'p' ? 'p' : 'e', to: t.type, mv: 'wall', dmg, combo: this.combo, res: t.hp - dmg <= 0 ? 'kill' : 'hit' });
      this.comboDmg = (this.comboDmg || 0) + dmg;      // 版3.8：壁激突のダメージも TOTAL に（表示だけ）
      t.hp -= dmg; t.flash = 0.15;
      if (t.hp <= 0) { this.defeat(t, side); return; }
      this.countBossHit(t);
    }
    t.x = side < 0 ? r : W - r;
    t.vx = -t.vx * (b.boss ? WALL.boss : Math.min(0.95, WALL.reflect * tn('wallBounce')));
    b.rotV *= -0.8;
  }

  settle(t) {
    const boss = t.bul && (t.bul.boss || t.bul.soft);     // ボス級の打ち上げ（小さく浮くだけ）は、倒れずに目を回す
    const spStun = (t.bul && t.bul.spStun != null) ? t.bul.spStun : 1;
    t.bul = null; t.rot = 0; t.vx = 0; t.vy = 0; t.onGround = true; t.sup = 'ground'; t.y = this.groundY;
    if (boss && spStun > 0) { t.state = 'stun'; t.stunT = 0.6 * spStun; this.holdAnim(t, 'launched'); return; }
    if (boss) { t.state = 'idle'; t.cd = 0.3; return; }      // 版1.1c：ひるまなかったボス級は目を回さず立つ
    if (ENEMY_DOWN.need > 1 && (t.downHits || 0) < Math.max(1, Math.round(ENEMY_DOWN.need * tn('downNeed')))) {      // 版2.4：ダウン値が足りない＝倒れずに、着地でよろけて立つ
      t.state = 'hurt'; t.stunT = 0.4; t.landed = true; t.rp = null; t.repelT = 0;
      this.onceAnim(t, 'hurt', 0.4);
      return;
    }
    t.downHits = 0;
    t.state = 'fallen'; t.sub = 'down'; t.subT = 0; t.landed = true;
    this.onceAnim(t, 'down');
  }

  // ---- 倒れる：くるくる回りながら画面の外へ ----
  defeat(t, dir) {
    if (t.state === 'dying') return;
    const boss = isBossLike(t.d);
    t.hp = 0; t.state = 'dying'; t.move = null; t.tele = false; t.guarding = false; t.moveV = null; t.bul = null;
    t.onGround = false; t.sup = null;
    const d = dir || sign(t.vx) || 1;
    t.vx = d * (boss ? 760 : 880 + this.rand(0, 280));
    t.vy = boss ? -640 : -520 - this.rand(0, 120);
    t.dyingRotV = d * (boss ? 5 : this.rand(11, 15));
    t.rot = t.rot || 0;
    this.holdAnim(t, 'launched');
    this.stats.kills++;
    const got = this.addScore(t.d.score);
    this.sfx('enemyDown');
    this.spark(t.x, t.y - t.bh * 0.5, 'big', d, boss ? 2.2 : 1.4);
    this.ring(t.x, t.y - t.bh * 0.5, { r0: 20, r1: boss ? 420 : 200, dur: 0.5, color: '#ffe7a0', w: 9 });
    this.addHitstop(boss ? 0.2 : 0.08);
    this.shakeAdd(boss ? 20 : 8);
    this.popup(t.x, t.y - t.bh - 10, '+' + got, { color: '#ffd24a', size: boss ? 38 : 26, dur: 1.1 });      // 2026-11-14：実際に入った点（前は倍率の掛かる前の素点で、コンボ 80 なら +500 と出て 2000 入った）
    if (boss) {
      this.slow = { t: 1.4, scale: 0.35 };
      this.flashScreen('rgba(255,255,255,0.8)', 0.5);
      this.sfx('explode');
      this.emit({ type: 'bgm', name: null });
      this.startPurge(t);
    }
  }

  updateDying(t, dt) {
    t.vy += BULLET_GRAV * 0.6 * dt;
    t.x += t.vx * dt; t.y += t.vy * dt;
    t.rot += t.dyingRotV * dt;
    if (t.purged) {
      // 版2.2：衝撃の輪で飛ばされた雑魚＝残像を引き、絵の端まで画面の外に出てから消す（画面の中では消さない）
      t.ghostT = (t.ghostT || 0) - dt;
      if (t.ghostT <= 0 && t.anim) { t.ghostT = 0.04; this.fx.push({ type: 'ghost', who: t.type, motion: t.anim.motion, frame: this.frameOf(t), x: t.x, y: t.y, facing: t.facing, t: 0, dur: 0.3 }); }
      if (this.purge && this.purge.t > BOSS_PURGE.maxT && Math.abs(t.vx) < 2600) t.vx = t.purgeDir * 2600;      // 時間切れ：出切らない雑魚は勢いを足して押し出す
      const m = this.purgeMargin(t);
      if (t.x < -m || t.x > W + m || t.y > this.camY + H + m + 200) t.dead = true;
      return;
    }
    if (t.x < -t.bw || t.x > W + t.bw || t.y > this.camY + H + t.bh + 200) t.dead = true;
  }

  // ---- 版2.2：ボス撃破の衝撃の輪 ----
  /** 絵の端まで画面の外に出たと言える余白（セルの対角の半分。回転しても届く）。 */
  purgeMargin(e) {
    const dm = this.motions.dinos[e.type].idle;
    const s = e.d.scale * 1.1;
    return Math.max(e.bw, Math.hypot(dm.cellW, dm.cellH) * s * 0.5) + 20;
  }
  /** ボス級が倒れた瞬間に呼ぶ。他のボス級が残っていれば何もしない（最後の1体が倒れたとき）。残っている雑魚がいなければ従来どおり。 */
  startPurge(boss) {
    if (!BOSS_PURGE.on || this.practice) return;
    if (this.enemies.some((e) => e !== boss && isBossLike(e.d) && e.state !== 'dying' && !e.dead)) return;
    if (!this.enemies.some((e) => e !== boss && !isBossLike(e.d) && !e.dead && e.state !== 'dying')) return;
    const x = boss.x, y = boss.y - boss.bh * 0.5;
    this.purge = { x, y, t: 0 };
    if (this.stage.boss) { this.director.next = this.stage.waves.length; this.director.queue.length = 0; }
    // 輪は見た目と当たりで同じ大きさ（描画 'ring' の広がり方と同じ式で半径を決める）
    const R = BOSS_PURGE.ringMax, D = BOSS_PURGE.ringDur;
    this.ring(x, y, { r0: 30, r1: R, dur: D, color: '#ffffff', w: 16 });
    this.ring(x, y, { r0: 30, r1: R * 0.93, dur: D * 1.05, color: '#ffe9a8', w: 10 });
    this.ring(x, boss.y, { r0: 30, r1: R * 1.1, dur: D, color: '#fff3c4', flat: true, w: 12 });
    this.sfx('quake', 0.8);
  }
  purgeRadius() {
    const u = Math.min(1, this.purge.t / BOSS_PURGE.ringDur);
    return lerp(30, BOSS_PURGE.ringMax, 1 - Math.pow(1 - u, 2));
  }
  updatePurge(dt) {
    const pg = this.purge;
    if (!pg) return;
    pg.t += dt;
    const r = this.purgeRadius(), late = pg.t > BOSS_PURGE.maxT;
    let pending = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.purged) { pending = true; continue; }
      if (e.state === 'dying' || isBossLike(e.d)) continue;
      pending = true;
      if (late || Math.hypot(e.x - pg.x, (e.y - e.bh * 0.5) - pg.y) <= r) this.purgeLaunch(e);
    }
    if (!pending && pg.t >= BOSS_PURGE.ringDur) this.purge = null;
    else if (pg.t > BOSS_PURGE.hardT) {             // 最後の安全弁：画面の外にいる者だけ消す。画面の中の者には勢いを足し続ける
      for (const e of this.enemies) if (e.purged && !e.dead) {
        e.vx = e.purgeDir * 4000;
        if (e.x < -this.purgeMargin(e) || e.x > W + this.purgeMargin(e)) e.dead = true;
      }
    }
  }
  purgeLaunch(t) {
    const pg = this.purge;
    let d = sign(t.x - pg.x);
    if (!d || Math.abs(t.x - pg.x) < 40) d = t.x < W / 2 ? -1 : 1;
    t.purged = true; t.purgeDir = d;
    t.hp = 0; t.state = 'dying'; t.move = null; t.tele = false; t.guarding = false; t.moveV = null; t.bul = null; t.stunT = 0;
    t.onGround = false; t.sup = null;
    t.vx = d * (BOSS_PURGE.speed + this.rand(0, 400));
    t.vy = -420 - this.rand(0, 260);
    t.dyingRotV = d * this.rand(14, 22);
    t.rot = t.rot || 0;
    this.holdAnim(t, 'launched');
    this.stats.kills++;
    const got = this.addScore(t.d.score);
    if (BOSS_PURGE.countAsHits) this.addCombo(1);
    this.sfx('enemyDown');
    this.spark(t.x, t.y - t.bh * 0.5, 'big', d, 1.4);
    this.shakeAdd(4);
    this.popup(t.x, t.y - t.bh - 10, '+' + got, { color: '#ffd24a', size: 26, dur: 1.1 });      // 2026-11-14：実際に入った点
  }

  // ---- 壁に激突（突進のあとの自爆）：弱点になる ----
  crash(e, hitHero = false) {
    const boss = e.d.tier === 'boss';
    const side = e.wallHit || e.facing;
    this.shakeAdd(16);
    this.sfx('slam'); this.sfx('quake', 0.7);
    const wx = side < 0 ? 0 : W;
    this.spark(wx + (side < 0 ? 30 : -30), e.y - e.bh * 0.5, 'wall', side, 1.6);
    this.ring(wx, e.y - e.bh * 0.5, { r0: 10, r1: 260, dur: 0.45, color: '#fff7d6', w: 10 });
    this.dust(wx + (side < 0 ? 50 : -50), e.y, 10, 50);
    this.addHitstop(0.1);
    this.popup(clamp(e.x, 140, W - 140), e.y - e.bh - 20, 'CRASH!', { color: '#7df0ff', size: 34 });
    if (this.logHook) this.lg('hit', { by: 'e', to: e.type, mv: 'crash', dmg: boss ? 28 : 14, combo: this.combo, res: e.hp - (boss ? 28 : 14) <= 0 ? 'kill' : 'hit' });
    e.hp -= boss ? 28 : 14; e.flash = 0.15;
    this.stats.slams++;
    if (e.hp <= 0) { this.defeat(e, side); return; }
    e.move = null; e.tele = false; e.moveV = null;
    // 版2.4：主人公に当たった（ダメージ・ガード）突進は、壁に当たっても目を回さない。当たらなかった突進だけ、ENEMY_CRASH_STUN_CHANCE の確率で目を回す（外れたら短くよろけて通常に戻る）
    const dizzy = !hitHero && this.crashRng() < ENEMY_CRASH_STUN_CHANCE;
    if (!dizzy) {
      e.state = 'hurt'; e.stunT = 0.35; e.vx = -side * 120; e.vy = 0; e.repelT = 0; e.rp = null;
      this.onceAnim(e, 'hurt', 0.35);
      return;
    }
    e.state = 'stun'; e.stunT = boss ? 2.0 : 1.8; e.vx = 0; e.vy = 0;
    this.loopAnim(e, 'stun');
  }

  // ======== 敵 ========
  /**
   * 版3.0：陸の敵が水に落ちた（体の中心が水面より下）。泳げないので、もがきながら水面でゆれ、近い画面の端へ流されていく。絵が画面の外へ出きったら消える（倒した扱い＝点・コンボ・撃破数）。
   * もがいている間は殴れない（enemyHittable の外）。泳ぐ敵・入場中の敵は対象外。
   */
  startDrown(e) {
    e.state = 'drown'; e.move = null; e.moveV = null; e.tele = false; e.guarding = false; e.bul = null; e.rp = null; e.repelT = 0;
    e.breaking = false; e.breakPending = false; e.chain = null; e.heldBy = null; e.quake = null; e.hopFly = null; e.hopPlan = null;
    e.onGround = false; e.sup = null; e.drownT = 0; e.rot = 0; e.drownMine = !!e.byPlayer;      // 版3.3：主人公の技で落とした分だけ数える
    e.drownDir = e.x < W / 2 ? -1 : 1;
    e.vx = e.drownDir * DROWN.speed * 0.5; e.vy = Math.min(Math.max(e.vy, 0), 700);
    this.loopAnim(e, 'hurt', 0.45);
    this.splash(e.x, 0.55 + Math.abs(e.vy) / 1400);
    this.stats.drownStarts = (this.stats.drownStarts || 0) + 1;
    if (this.logHook) this.lg('drown', { to: e.type, x: Math.round(e.x) });
  }
  updateDrown(e, dt) {
    e.drownT += dt; e.t += dt;
    this.tickAnim(e, dt);
    e.vx = clamp(e.vx + e.drownDir * DROWN.accel * dt, -DROWN.speed * 1.4, DROWN.speed * 1.4);
    e.x += e.vx * dt;
    const goalY = this.water.y + e.bh * 0.65 + Math.sin(e.drownT * 5) * 6;      // 水面でもがく（体の中心が水面の少し下）
    e.y += (goalY - e.y) * Math.min(1, dt * 4);
    e.rot = Math.sin(e.drownT * 9) * 0.2;
    e.bubT = (e.bubT || 0) - dt;
    if (e.bubT <= 0) { e.bubT = 0.18; this.bubbles(e.x, this.water.y + 6, 1, e.bw * 0.2); }
    const m = this.purgeMargin(e);      // 絵の端まで画面の外へ出たら消える（画面の中では消さない）
    if (e.x < -m || e.x > W + m || e.drownT > DROWN.maxT) this.drownDefeat(e);
  }
  drownDefeat(e) {
    if (e.dead) return;
    e.dead = true; e.state = 'dying';
    const mine = !!e.drownMine;      // 版3.3：自分から水に落ちた分は、点・撃破数・コンボ・CP に入れない
    let got = 0;      // 2026-11-14：溶岩と同じ（コンボを足してから点・浮き数字は実際に入った点）
    if (mine) { this.stats.kills++; this.stats.drowns = (this.stats.drowns || 0) + 1; this.addCombo(1); got = this.addScore(e.d.score); }
    else this.stats.selfDrowns = (this.stats.selfDrowns || 0) + 1;
    this.popup(clamp(e.x, 100, W - 100), this.water.y - 40, mine ? '+' + got : '自滅', mine ? { color: '#9fe8ff', size: 24, dur: 1.0 } : { color: '#b8c8d0', size: 18, dur: 0.8 });
    if (this.logHook) this.lg('drown', { to: e.type, k: mine ? 1 : 0, self: mine ? 0 : 1 });
  }

  updateEnemy(e, dt) {
    const px0 = e.x;
    if (this.water && !e.d.swim && e.state !== 'drown' && e.state !== 'dying' && e.state !== 'enter' && !e.dead && !(e.d.flying && (e.state === 'idle' || e.state === 'move')) && this.inWater(e)) this.startDrown(e);      // 版3.0：泳げない敵が水に落ちた（飛ぶ敵は、自分で飛んでいるあいだは溺れない。吹き飛ばされて落ちたら溺れる）
    if (e.state === 'drown') { this.updateDrown(e, dt); return; }
    if (e.downHits > 0) { if (e.state === 'idle' || e.state === 'move') { e.downIdle = (e.downIdle || 0) + dt; if (e.downIdle > ENEMY_DOWN.forgetT) e.downHits = 0; } else e.downIdle = 0; }      // 版2.4：当てられずに動けるまま過ごすと忘れる
    e.t += dt;
    if (e.state !== 'idle' && e.state !== 'move' && e.state !== 'enter' && e.state !== 'drop') { const w = e.wn || (e.wn = { aggro: false, outT: 0, hitUntil: -1, act: false, ph: 'stand', t: 0, dir: 1, home: e.x }); w.hitUntil = this.time + WANDER.hitT; }      // 2026-10-29：被弾・目回し・吹き飛びなど動けなくなったら、徘徊をやめて主人公へ向かう（hitT 秒）
    if (e.flash > 0) e.flash -= dt;
    if (e.guardShake > 0) e.guardShake -= dt;
    if (e.repelT > 0) e.repelT -= dt;
    this.tickRepel(e, dt);
    if (e.rival) e.gravMul = 1;
    if (e.wakeInv > 0) e.wakeInv -= dt;
    if (e.waveImmune > 0) e.waveImmune -= dt;
    if (e.waveFlag && (e.state === 'idle' || e.state === 'move')) { e.waveFlag = false; e.waveImmune = Math.max(e.waveImmune || 0, WAVE_LOCK.afterT); }      // 動けるようになったところから afterT 秒
    if (e.rival && e.state !== 'dying' && e.state !== 'drop') e.gauge = Math.min(100, e.gauge + RIVAL_TUNE.gaugeRegen * this.diff.rivalGauge * dt);      // 版1.1b：ゲージの時間回復は技の最中・のけぞり中も進む
    if (e.cbLock > 0) e.cbLock -= dt;
    if (this.isBigBoss(e)) this.bossPerchTick(e, dt);
    if (e.state !== 'idle') e.perchT = 0;      // 版2.8b：足場ゆらしの待ちは、動作・突進・被弾・目回しの間は数えず、idle に戻るたびに数え直す
    if (e.roarCd > 0) e.roarCd -= dt;
    if (e.heldBy && !this.isHeld(e)) e.heldBy = null;
    if (RAGE.on && !e.rage && isBossLike(e.d)) this.tryRage(e);
    if (e.cbT > 0) { e.cbT -= dt; if (e.cbT <= 0 && !e.breakPending) e.cbN = 0; }
    if (e.breaking && e.state !== 'move') e.breaking = false;
    if (e.breakPending && this.time - (e.breakPendAt ?? this.time) > COUNTER.pendMax) { e.breakPending = false; e.cbN = 0; e.cbT = 0; this.stats.pendDrops = (this.stats.pendDrops || 0) + 1; }      // 2026-10-24（Nao「おすすめで」）：出せないまま古くなったカウンターの予約は捨てる（あとから突然出ない）
    if (e.breakPending) this.tryBreaker(e, true);
    switch (e.state) {
      case 'enter': this.updateEnter(e, dt); break;
      case 'drop':
        this.tickAnim(e, dt);
        this.physicsBody(e, dt);
        break;
      case 'rage': this.updateRage(e, dt); break;
      case 'idle':
        e.byPlayer = false;      // 版3.3：自分で動けるようになったら、もう「主人公に飛ばされた」ではない
        e.cd -= dt;
        if (!this.isHeld(e)) this.aiTick(e, dt);      // 版2.4：必殺技を受けている間は動かない（新しい技を始めない）
        if (e.state === 'idle') { this.tickAnim(e, dt); this.physicsBody(e, dt); }
        break;
      case 'move':
        this.updateMove(e, dt, null);
        if (e.state === 'move') this.physicsBody(e, dt);
        break;
      case 'hurt':
        if (e.rival && rivalHurtEscape(this, e, dt)) break;     // 被弾の硬直中に咆哮で切り返す（ゲージがあるとき）
        e.stunT -= dt;
        this.tickAnim(e, dt);
        if (e.rp) { /* 相殺ではじかれ中：tickRepel が速さを決める */ }
        else if (!e.d.flying || e.landed) e.vx -= sign(e.vx) * Math.min(Math.abs(e.vx), 1500 * dt);
        else e.vx -= sign(e.vx) * Math.min(Math.abs(e.vx), 900 * dt);
        this.physicsBody(e, dt);
        if (e.stunT <= 0) { e.state = 'idle'; e.cd = 0.3; e.vx = 0; }
        break;
      case 'stun':
        e.stunT -= dt; e.vx = 0;
        if (e.anim) this.tickAnim(e, dt);
        this.physicsBody(e, dt);
        if (e.stunT <= 0) { e.state = 'idle'; e.cd = 0.5; }
        break;
      case 'bullet':
        this.tickAnim(e, dt);
        this.updateBullet(e, dt);
        break;
      case 'fallen': this.updateFallen(e, dt); break;
      case 'dying': this.updateDying(e, dt); break;
      default: break;
    }
    if (e.state === 'idle' || e.state === 'move') this.avoidHazards(e, px0, dt);      // 版3.3：池・水の縁で止まる
  }

  // ---- 版2.4：ボスの怒り（第2段階）。数値は src/rage.js ----
  /** 主人公の必殺技を受けている最中か（その技が続いている間）。 */
  isHeld(e) { const p = this.player; return !!(e.heldBy && p && p.state === 'move' && p.move === e.heldBy); }
  /** 攻撃の間の倍率（怒り中は短い）。 */
  rageGap(e) { return e.rage ? e.rage.atkGap : 1; }
  /** 歩く速さ（怒り中は速い）。 */
  spdOf(e) { return e.d.speed * (e.rage ? e.rage.speed : 1); }
  /** 体力が RAGE.at を下回ったら怒りの演出に入る（1回だけ）。動ける状態になるのを待つ・必殺技を受けている最中・くわえている最中は待つ。 */
  tryRage(e) {
    if (e.rageDone || e.dead || !(e.hp > 0) || !(e.hp / e.maxHp < RAGE.at) || e.breaking) return;      // カウンター改：カウンターの最中は怒りの演出に入らない（終わってから）
    if (!(e.state === 'idle' || e.state === 'hurt' || e.state === 'stun' || e.state === 'move')) {
      // 2026-10-24（Nao「おすすめで」）：吹き飛び中・倒れ中は待つが、待ち続けて来ないことがないように、maxWait 秒たったらその場で立て直して怒りに入る（倒す前に必ず1回は出る）
      if (e.state !== 'bullet' && e.state !== 'fallen') return;
      if (e.rageWaitAt == null) e.rageWaitAt = this.time;
      if (this.time - e.rageWaitAt < RAGE.maxWait) return;
      if (this.isHeld(e) || (this.player && (this.player.state === 'grabbed' || this.player.slamArm))) return;
      this.stats.rageForced = (this.stats.rageForced || 0) + 1;
      e.bul = null; e.rot = 0; e.vx = 0; if (e.vy < 0) e.vy = 0; e.sub = null;
    }
    e.rageWaitAt = null;
    if (this.isHeld(e)) return;
    if (e.state === 'move' && this.player && this.player.state === 'grabbed') return;
    if (this.player && this.player.slamArm) return;
    e.rageDone = true; e.rageAt = this.time;
    e.rage = rageMul(this.diffId, e.rival, tn('rageStrength'));
    e.move = null; e.tele = false; e.guarding = false; e.breaking = false; e.breakPending = false; e.chain = null;
    if (BOSS_FIX.on) e.moveV = null;      // 2026-11-14：技の速さも消す（ほかの中断＝パリィ・のけぞり・打ち上げ・カウンター・はじきと同じ）。前は飛ぶ・泳ぐボスが、次の技の構えのあいだ前の技の速さで 200〜370px 流された
    e.state = 'rage'; e.rageT = 0; e.vx = 0; e.rp = null; e.repelT = 0;
    e.wakeFresh = false; e.wakeInv = 0;      // 起き上がった直後の切り返しは、怒りの演出のあとに持ち越さない
    if (e.d.flying) e.vy = 0;
    e.facing = this.player && this.player.x >= e.x ? 1 : -1;
    this.holdAnim(e, 'idle');
    this.sfx('bossRoar2', 1, 0.8);
    this.shakeAdd(RAGE.shake);
    this.flashScreen('rgba(255,80,60,0.28)', 0.25);
    this.ring(e.x, e.y - e.bh * 0.5, { r0: 20, r1: e.bh * 1.2, dur: 0.7, color: '#ffe0c0', w: 6 });
    this.popup(clamp(e.x, 140, W - 140), e.y - e.bh - 70, 'RAGE!', { color: '#ff6a4a', size: 34, dur: 1.1 });
    this.stats.rages = (this.stats.rages || 0) + 1;
    if (this.logHook) this.lg('rage', { by: e.type, hp: Math.round(e.hp), max: e.maxHp });
  }
  updateRage(e, dt) {
    e.rageT += dt;
    e.vx = 0;
    if (e.d.flying) e.vy = 0;
    if (this.player && this.player.x !== e.x) e.facing = this.player.x >= e.x ? 1 : -1;
    this.tickAnim(e, dt);
    if (!e.d.flying) this.physicsBody(e, dt);
    if (Math.floor(e.rageT * 12) !== Math.floor((e.rageT - dt) * 12)) this.shakeAdd(RAGE.shake * 0.5);
    if (e.rageT >= RAGE.intro) { e.state = 'idle'; e.cd = 0.35; e.rageT = 0; this.sfx('powerup', 0.7, 0.8); }
  }

  updateEnter(e, dt) {
    this.tickAnim(e, dt);
    if (e.fallIn) { // 空を飛ぶ敵が上から入ってくる
      e.y += 380 * dt;
      const target = this.flyBaseY() - e.d.ai.altitude - this.flyRefLift();      // 版3.2：主人公が足場の上にいるなら、降りてくる先もその面の高さ（地面の高さまで降りてから上がり直さない）
      if (e.y >= target) { e.y = target; e.state = 'idle'; e.fallIn = false; e.vx = 0; e.vy = 0; this.loopAnim(e, 'idle'); }
      return;
    }
    e.x += e.vx * dt;
    if (isBossLike(e.d) && !e.d.flying && (e.facing === 1 ? e.x < e.enterTo : e.x > e.enterTo)) {      // 版2.8：入場中の地響き。体が画面の外にいるうちから、足音・小さな揺れ・画面の端の土ぼこりで「来る」と分かる
      e.enterStepT = (e.enterStepT === undefined ? ENTER.stepT * 0.3 : e.enterStepT) - dt;
      if (e.enterStepT <= 0) {
        e.enterStepT += ENTER.stepT;
        const hw = e.bw * 0.5, inside = e.x + hw > 0 && e.x - hw < W, near = inside ? 1 : 0.6;
        this.sfx('step', 0.5 * near, 0.85);
        this.shakeAdd(inside ? 4 : 2.5);
        this.dust(inside ? e.x : (e.facing === 1 ? 4 : W - 4), e.y, inside ? 4 : 3, 70);
        this.stats.enterSteps = (this.stats.enterSteps || 0) + 1;
      }
    }
    if ((e.vx > 0 && e.x >= e.enterTo) || (e.vx < 0 && e.x <= e.enterTo)) {
      e.state = 'idle'; e.vx = 0; e.cd = 0.5;
      this.loopAnim(e, 'idle');
    }
  }

  updateFallen(e, dt) {
    e.subT += dt;
    this.tickAnim(e, dt);
    e.vx = 0;
    if (e.sub === 'down' && e.anim.t >= e.anim.dur) { e.sub = 'downed'; e.subT = 0; this.loopAnim(e, 'downed'); }
    else if (e.sub === 'downed' && e.subT > 0.7) {
      e.sub = 'getup'; e.subT = 0;
      if (e.d.anim.getup) this.onceAnim(e, 'getup');
      else { // 倒れた動きを逆再生で起き上がる
        const a = e.d.anim.down;
        e.anim = { key: 'rev', motion: a[0], from: a[2], to: a[1], dur: 0.8, loop: false, t: 0 };
      }
    } else if (e.sub === 'getup' && e.anim.t >= e.anim.dur) {
      e.state = 'idle'; e.cd = e.rival ? 0 : 0.6; e.landed = !!e.d.flying; this.loopAnim(e, 'idle');
      if (e.rival) { e.wakeInv = RIVAL_TUNE.wakeInv; e.wakeFresh = true; this.stats.rivalWakes = (this.stats.rivalWakes || 0) + 1; }      // 版1.1b：起き上がり直後の無敵＋切り返し
    }
  }

  separateEnemies(dt) {
    const g = this.enemies.filter((e) => e.state === 'idle' && !e.d.flying && e.onGround);
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j];
        if (Math.abs(a.y - b.y) > SEP_DY) continue;      // 版3.5：高さの違う敵（足場の上と地面・別の足場）は重ならない＝押し合わない。押し合うと、縦に並んだ足場の端で降りる歩きと押し返しが釣り合い、足場の上に居座った（動画のバグ）
        const need = (a.bw + b.bw) * 0.2;
        const dx = b.x - a.x;
        if (Math.abs(dx) < need) {
          const push = (need - Math.abs(dx)) * 0.5 * Math.min(1, dt * 8);
          const s = dx >= 0 ? 1 : -1;
          if (a.d.tier !== 'boss') a.x -= s * push;
          if (b.d.tier !== 'boss') b.x += s * push;
        }
      }
    }
  }

  // ---- AI ----
  playerAlive() { const s = this.player.state; return s !== 'down' && s !== 'downed'; }

  setGuard(e, on) {
    if (on && !e.guarding) { e.guarding = true; e.guardT = 0; e.guardReady = undefined; }
    if (!on && e.guarding) { e.guarding = false; e.guardT = 0; }
  }
  applyGuardAnim(e, dt) {
    const g = e.d.guard;
    e.guardT += dt;
    if (e.guardT < g.raise[2]) {
      if (!e.anim || e.anim.key !== 'gR') e.anim = { key: 'gR', motion: g.motion, from: g.raise[0], to: g.raise[1], dur: g.raise[2], loop: false, t: 0 };
    } else if (!e.anim || e.anim.key !== 'gH') {
      e.anim = { key: 'gH', motion: g.motion, from: g.hold, to: g.hold, dur: 1, loop: false, t: 0 };
    }
  }

  /**
   * 版2.3：足場の上にいる地上の敵が、足場より低い所にいる主人公へ降りていく。足場の縁まで歩いて、そのまま歩いて降りる（飛び降りる動きは無い）。
   * 降りる向き＝主人公のいる側（ほぼ真下なら近い縁）。これが無いと、上の足場の敵が主人公の頭の上で行ったり来たりしたまま降りてこない。
   * ボス級・ライバル・飛ぶ敵・足場を使わない敵（noPlat）は対象外。降りている最中は true を返し、ほかの AI を動かさない。
   */
  descendAI(e) {
    const p = this.player, t = e.d.ai.type;
    if (!p || !(t === 'walker' || t === 'charger' || t === 'tank' || t === 'multi')) return false;
    if (e.d.flying || e.rival || isBossLike(e.d) || e.noPlat) return false;
    // 版3.5：縁を踏み出して宙に出た間は、降りる向きと速さを握ったまま（着地まで）。握らないと、宙に出た途端に追尾（aiWalker など）が主人公の側へ引き戻して、縁の上で 1 コマごとに乗る・落ちるを繰り返した（敵が足場の縁から動かない）
    if (!e.onGround) {
      if (e.stepOff && this.time - e.stepOff.t < 1.2) { e.facing = e.stepOff.d; e.vx = e.stepOff.d * e.d.speed; this.loopAnim(e, 'walk'); return true; }
      return false;
    }
    e.stepOff = null;
    if (!e.sup || e.sup === 'ground' || !this.playerAlive()) { e.leaveT = 0; return false; }
    const need = this.mustLeave(e);
    if (!need) {
      if (e.leaveSup === e.sup && this.time - (e.leaveT || 0) < 0.8) { /* 降り始めたら少しは続ける（主人公の足場が一瞬変わるたびに戻らない） */ }
      else { e.leaveSup = null; return false; }
    } else { e.leaveSup = e.sup; e.leaveT = this.time; }
    if (!e.descendD || e.descendSup !== e.sup) {      // 降りる向きはこの足場に乗っているあいだ変えない（真下で行ったり来たりしない）
      e.descendD = this.exitSide(e);
      e.descendSup = e.sup;
    }
    const d = e.descendD, sp = e.sup;
    e.facing = d; e.vx = d * e.d.speed;
    // 版3.5：縁を越えて接地が切れるコマ（x が足場の外 SUP_PAD の外）に入るなら、降りる向きを握る
    if (d < 0 ? e.x - Math.abs(e.vx) * 0.034 < sp.x - SUP_PAD : e.x + Math.abs(e.vx) * 0.034 > sp.x + sp.w + SUP_PAD) e.stepOff = { d, t: this.time };
    this.loopAnim(e, 'walk');
    return true;
  }
  /** 版3.5：足場の上の歩く敵が、この足場を降りないと主人公に近づけないか。主人公が 110px 以上低い／主人公が別の足場にいて、跳んで追う手（hopAI）が無い、のとき true。 */
  mustLeave(e) {
    const p = this.player;
    if (p.y > e.y + 110) return true;
    if (!(p.onGround && p.sup && p.sup !== e.sup)) return false;      // 主人公が空中・同じ足場：ふつうの追尾
    if (e.d.hop && p.y < e.y - HOP.seeDy && this.hopPlan(e, p.sup)) return false;      // 跳んで上がれる：hopAI が追う
    return true;      // 同じ高さ・高い別の足場や地面：足場の上を行ったり来たりせず、降りて下から追う（届かない敵は足場の真下で足場ゆらし）
  }
  /** 版3.5：降りる縁（-1＝左・+1＝右）。縁の外へ体が出られること（画面の壁にふさがれていない）・海の面なら下に乗れる足場があること・池の真上に降りないこと、を満たす側のうち、主人公のいる側（ほぼ真下なら近い縁）。 */
  exitSide(e) {
    const p = this.player, sp = e.sup, lim = e.bw * 0.33;
    const dxp = p.x - e.x;
    const pref = Math.abs(dxp) > 50 ? sign(dxp) : (e.x - sp.x < sp.w / 2 ? -1 : 1);
    const ok = (d) => {
      const edge = d < 0 ? sp.x - SUP_PAD : sp.x + sp.w + SUP_PAD;
      if (d < 0 ? !(lim < edge - 3) : !(W - lim > edge + 3)) return 0;      // 壁にふさがれた縁（体が縁の外まで出られない）
      if (this.water && !this.landingBelow(sp, d < 0 ? sp.x - 20 : sp.x + sp.w + 20)) return 0;      // 海：下に乗れる足場が無い縁は水
      if (this.lava && this.lavaZones(e).some((z) => (d < 0 ? sp.x - 30 : sp.x + sp.w + 30) > z.x0 && (d < 0 ? sp.x - 30 : sp.x + sp.w + 30) < z.x1)) return 1;      // 池の真上：降りられるが、ほかの縁があればそちら
      return 2;
    };
    const a = ok(pref), b = ok(-pref);
    return b > a ? -pref : pref;
  }

  /**
   * 版2.6：足場の上の主人公を追って跳び上がる（d.hop を持つ敵）。主人公が HOP.seeDy 以上高いとき、跳んで届く足場（上がる高さ ≦ HOP.reach）のうち
   * 主人公の高さを超えないものを選び、その下まで歩いて、足場に着地するように横の速さを決めて跳ぶ。足場の上からさらに上の足場へ（低い足場→中段）も同じ。
   * 跳ぶ前に HOP.wait 秒立ち止まり、跳んだあとは HOP.cool 秒は次を跳ばない（原作の 2.2〜3.0 秒）。空中にいる間は、この関数が絵と横の速さを持つ（true を返す）。
   * 届く足場が無い（主人公が高すぎる）ときは false を返し、足場ゆらし（perchAI）に任せる。
   */
  hopAI(e, dt) {
    const p = this.player;
    if (!e.d.hop || !p || e.rival || isBossLike(e.d) || e.noPlat || e.d.flying) return false;
    if (e.hopCd > 0) e.hopCd -= dt;
    if (!e.onGround) {
      if (!e.hopFly) return false;
      this.holdAnim(e, 'hop');
      e.vx = e.hopFly.vx;
      return true;
    }
    if (e.hopFly) { e.hopFly = null; e.cd = Math.max(e.cd, HOP.landCd); }      // 版3.2：跳んで着地した直後は、すぐには攻撃に出ない（予兆の分と合わせて追いつかれてから 1 秒の余裕）
    if (!this.playerAlive() || !(p.y < e.y - HOP.seeDy)) { e.hopWait = 0; e.hopPlan = null; e.hopChain = false; e.hopGoal = null; return false; }      // 追う理由が無くなった（主人公が倒れた・同じ高さか下に降りた）
    // 版3.2：目標の足場＝主人公が立っている足場。主人公が足場の上で跳ねている・足場の縁で一瞬浮いた間（HOP.grace 秒）は、直前の目標を保つ（普通の歩き AI に戻して跳ぶ位置から引き戻されない）。もっと長く空中なら立ち止まりを少しずつ減らす
    if (p.onGround && p.sup && p.sup !== 'ground') { e.hopGoal = p.sup; e.hopGoalT = this.time; }
    const goal = p.onGround && p.sup && p.sup !== 'ground' ? p.sup : (e.hopGoal && this.time - e.hopGoalT < HOP.grace ? e.hopGoal : null);
    if (!p.onGround && !goal) { e.hopWait = Math.max(0, (e.hopWait || 0) - dt * HOP.airDecay); e.hopPlan = null; return false; }      // 空中ジャンプのたびには跳ばない
    const plan = goal ? this.hopPlan(e, goal) : null;
    if (!plan) { e.hopWait = 0; e.hopPlan = null; return false; }
    if (e.sup === 'ground' && e.hazWait > HAZARD.hopAfter + 0.6) { e.hopPlan = null; return false; }      // 版3.5：跳ぶ道の最初の足場へ歩く途中の池の縁で、跳び越えられないまま 2.2 秒以上止められたら、その道を諦める（ふつうの追尾＋足場ゆらしに任せる）。主人公が池のあいだの島の真上の足場にいるとき、反対側の足場への道を歩こうとして縁に張りついたまま動かなかった
    e.hopPlan = plan;
    const dx = plan.tx - e.x;
    e.facing = dx >= 0 ? 1 : -1;
    if (Math.abs(dx) > plan.reachX) {      // 跳べる距離まで歩いて近づく（足場の上にいるなら、その足場の縁を越えない）
      const own = e.sup && e.sup !== 'ground' ? e.sup : null;
      const wx = own ? clamp(plan.tx, own.x + 20, own.x + own.w - 20) : plan.tx;
      e.hopWait = 0;
      if (Math.abs(wx - e.x) < 6) { e.vx = 0; this.loopAnim(e, 'idle'); }
      else { e.facing = wx >= e.x ? 1 : -1; e.vx = e.facing * e.d.speed * (Math.abs(wx - e.x) > 90 ? CHASE.hopRunMul : 1); this.loopAnim(e, 'walk'); }      // 版3.2：跳ぶ場所が遠いときは駆け足で近づく
      return true;
    }
    e.vx = 0; this.loopAnim(e, 'idle');
    e.hopWait = (e.hopWait || 0) + dt;
    if (e.hopWait >= (e.hopChain ? HOP.waitChain : HOP.wait) && !(e.hopCd > 0)) {
      const vx = clamp(dx / plan.t, -HOP.maxVx, HOP.maxVx);
      e.vy = plan.vy; e.vx = vx; e.onGround = false; e.sup = null; e.hopWait = 0;
      // 版3.2：主人公の足場にまだ着かない（続けて上の足場へ跳ぶ）ときは短い間隔と短い立ち止まり。主人公の足場に着く跳びのあとだけ原作の間隔（2.2〜3.0 秒）
      const lastHop = plan.pl === goal;
      e.hopChain = !lastHop;
      e.hopCd = lastHop ? this.rand(HOP.cool[0], HOP.cool[1]) * tn('chaseHop') : HOP.coolChain * tn('chaseHop');
      e.hopFly = { vx, to: plan.pl };
      this.holdAnim(e, 'hop');
      this.stats.hops = (this.stats.hops || 0) + 1;
      this.dust(e.x, e.y, 4, e.bw * 0.2);
      this.sfx('jump', 0.5, 0.8);
    }
    return true;
  }
  /**
   * 版2.6：跳んで上がる先の足場を選ぶ。主人公の立っている足場（goal）までの、上へ跳ぶだけの道（足場から足場へ。1回の跳びで届く高さ HOP.reach 以内・横の離れが跳びで届く範囲）を
   * 幅優先で探し、その最初の一歩の足場を返す。{pl, tx（着地したい x）, reachX（その手前この距離まで近づけば跳べる）, t（着地までの秒）}。道が無ければ null。
   * 主人公と同じ高さの別の足場には上がらない（上がっても追えず、降りて上がり直す往復になる）。
   */
  hopPlan(e, goal) {
    if (!goal) return null;
    const start = e.sup && e.sup !== 'ground' ? e.sup : null;
    if (start === goal) return null;
    const gi = this.platforms.indexOf(goal), si = start ? this.platforms.indexOf(start) : -1;
    { const P = this.platforms; let stale = this.hopNextFor !== P || this.hopNextN !== P.length;      // 足場の配列が差し替わったとき（面エディタ・試験）は作り直す。点検と監修：同じ配列の中で足場の座標を書き換えたときも（確保なしで x・y・w を見比べる）
      if (!stale) { const sg = this.hopSig; for (let i = 0; i < P.length; i++) if (sg[i * 3] !== P[i].x || sg[i * 3 + 1] !== P[i].y || sg[i * 3 + 2] !== P[i].w) { stale = true; break; } }
      if (stale) { this.hopNext = hopRoutes(P, this.groundY); this.hopNextFor = P; this.hopNextN = P.length; this.hopSig = []; for (const q of P) this.hopSig.push(q.x, q.y, q.w); } }
    if (gi < 0 || (start && si < 0)) return null;
    const fi = this.hopNext[si + 1][gi];      // 版3.2：面の読み込みで作った最短の道の最初の足場
    if (fi < 0) return null;
    const found = this.platforms[fi];
    const rise = (start ? start.y : e.y) - found.y;
    const t = hopFlightT(rise);
    // 版2.8b：着地点は、いま立っている所に近い足場の内側（端から 25px 内）。主人公の x を狙うと、足場の縁を越えられず届かない足場（最上段）が出た
    const lo = found.x + 25, hi = found.x + found.w - 25;
    const tx = lo >= hi ? found.x + found.w / 2 : clamp(e.x, lo, hi);
    return { pl: found, tx, reachX: HOP.maxVx * t * 0.9, t, vy: hopVy(rise) };
  }

  /**
   * 版2.6：足場ゆらし（跳べない敵・届かない高さの主人公への手）。足場の上の主人公の真下で待つこと QUAKE.wait 秒を超えたら、
   * QUAKE.tele 秒の予兆（足場が小刻みに揺れ・ほこりが落ち・敵が前足で踏み鳴らす）のあとで地面を踏み鳴らし、同じ足場にいる主人公を跳ね上げてダメージ（ガード不可）。
   * 版2.8b：当たるのは「敵の真上にある足場」の上の主人公だけ。待ちは敵がその足場の左右の範囲の中に来てから数え、突進・技・被弾・目回し（idle でない間）は数えず、idle に戻るたびに数え直す。
   * 膠着（足場に居座って何もしない）を防ぐ最後の手。ボス・ライバル・飛ぶ敵は対象外。
   */
  isBigBoss(e) { return isBossLike(e.d) && !e.rival && !e.d.flying && !e.noPlat; }
  /** ボスが足場の上の主人公に届かないまま過ごした秒数を数える（技が届く・主人公が足場にいない・ボスの動きが止まっているあいだは数え直し）。 */
  bossPerchTick(e, dt) {
    const p = this.player;
    if (!p || e.state === 'dying' || e.state === 'enter' || e.state === 'drop' || e.state === 'rage' || e.dead) { e.bossPerchT = 0; return; }
    if (this.time - (e.hitPlayerT ?? -1e9) < 0.05 || this.quakePlatform(e, p) === null) { e.bossPerchT = Math.max(0, (e.bossPerchT || 0) - dt * 2); if (this.time - (e.hitPlayerT ?? -1e9) < 0.05) e.bossPerchT = 0; return; }
    e.bossPerchT = (e.bossPerchT || 0) + dt;
  }
  quakePlatform(e, p) {
    if (!p || !p.onGround || !p.sup || p.sup === 'ground') return null;
    const pl = p.sup;
    if (!(pl.y < e.y - QUAKE.minDy)) return null;
    const half = this.isBigBoss(e) ? e.bw * 0.35 : 0;      // ボスは体の幅が足場にかかっていれば真下とみなす
    if (e.x + half < pl.x || e.x - half > pl.x + pl.w) return null;      // 敵がその足場の真下にいない
    if (p.x < pl.x - SUP_PAD || p.x > pl.x + pl.w + SUP_PAD) return null;      // 点検と監修：足場の外 10px までは接地が保たれる（physicsBody）＝そこに立つ主人公も足場の上。外すと端の外が安全地帯になった
    return pl;
  }
  /** 足場 pl が今ゆれているか（予兆中）。ゆれの大きさ（0〜）を返す。描画用。 */
  quakeAmp(pl) {
    for (const e of this.enemies) {
      const q = e.quake;
      if (q && q.pl === pl && e.state === 'idle' && this.time - q.last < 0.3) return 1.2 + 2.8 * Math.min(1, q.t / QUAKE.tele);
    }
    return 0;
  }
  perchAI(e, dt) {
    const p = this.player;
    if (e.quakeCd > 0) e.quakeCd -= dt;
    if (e.quake) {
      if (this.time - e.quake.last > 0.3) { e.quake = null; e.tele = false; }      // のけぞり等で中断された
      else return this.tickQuake(e, dt);
    }
    if (this.isBigBoss(e)) {      // ボスは自分の技を出し続ける。技が届かないまま bossWait 秒たったときだけ、足場ゆらしを割り込ませる
      if (!(e.bossPerchT >= QUAKE.bossWait * tn('chaseWait')) || e.quakeCd > 0 || !e.onGround || !this.playerAlive()) return false;
      const bpl = this.quakePlatform(e, p);
      if (!bpl) return false;
      e.quake = { t: 0, last: this.time, pl: bpl, stomps: 0, crumb: 0, boss: true, edge: p.x < bpl.x || p.x > bpl.x + bpl.w }; e.tele = true; e.vx = 0; e.facing = p.x >= e.x ? 1 : -1;
      this.loopAnim(e, 'idle'); this.sfx(this.roarOf(e), 0.8);
      if (this.logHook) this.lg('quake', { by: e.type, k: 'tele', plat: this.platforms.indexOf(bpl), ex: Math.round(e.x), px: Math.round(p.x), boss: 1 });
      return true;
    }
    if (!p || e.rival || isBossLike(e.d) || e.d.flying || e.noPlat || !e.onGround || !this.playerAlive()) { e.perchT = 0; return false; }
    const pl = this.quakePlatform(e, p);
    if (e.hopPlan && e.d.hop) { e.perchT = Math.max(0, (e.perchT || 0) - dt * 2); return false; }      // 跳べる敵は、跳ぶ手があるうちは待つだけ
    const goal = p.onGround && p.sup && p.sup !== 'ground' ? p.sup : null;
    if (!pl) {
      e.perchT = Math.max(0, (e.perchT || 0) - dt * 2);
      // 版2.8b：地面にいる重い敵は、足場の上の主人公の足場の下（左右の範囲の中）まで歩いて行く（突進で壁まで走って遠くから待たない）
      if (goal && e.sup === 'ground' && goal.y < e.y - QUAKE.minDy && p.x >= goal.x - SUP_PAD && p.x <= goal.x + goal.w + SUP_PAD) {
        const tx = clamp(e.x, goal.x + 16, goal.x + goal.w - 16);      // 版3.2：足場の下の「いちばん近い所」まで（主人公の x まで行かない）。足場の真下に入れば待ちが始まる
        if (Math.abs(tx - e.x) < 8) { e.vx = 0; this.loopAnim(e, 'idle'); }
        else { e.facing = tx >= e.x ? 1 : -1; e.vx = e.facing * Math.max(this.spdOf(e) * CHASE.runMul, CHASE.runMin); this.loopAnim(e, 'walk'); }      // 版3.2：足場の真下へ向かう速さを上げる（待ちの前に駆けつける・突進ではない）
        return true;
      }
      return false;
    }
    e.perchT = (e.perchT || 0) + dt;
    if (e.perchT < QUAKE.wait * tn('chaseWait') || e.quakeCd > 0) { e.vx = 0; e.facing = p.x >= e.x ? 1 : -1; this.loopAnim(e, 'idle'); return true; }      // 真下で待つ（待つあいだは突進・攻撃に出ない）
    if (e.perchT >= QUAKE.wait * tn('chaseWait') && !(e.quakeCd > 0)) {
      e.quake = { t: 0, last: this.time, pl, stomps: 0, crumb: 0, edge: p.x < pl.x || p.x > pl.x + pl.w }; e.tele = true; e.vx = 0; e.facing = p.x >= e.x ? 1 : -1;
      this.loopAnim(e, 'idle'); this.sfx(this.roarOf(e), 0.8);
      if (this.logHook) this.lg('quake', { by: e.type, k: 'tele', plat: this.platforms.indexOf(pl), ex: Math.round(e.x), px: Math.round(p.x) });
      return true;
    }
    return false;
  }
  tickQuake(e, dt) {
    const q = e.quake, p = this.player, pl = q.pl;
    q.t += dt; q.last = this.time; e.vx = 0;
    e.tele = true;
    if (Math.floor(q.t * 14) !== Math.floor((q.t - dt) * 14)) this.shakeAdd(2.5);
    // 予兆：足場が小刻みに揺れ（描画は quakeAmp）・天井からほこりがぱらぱら落ち・敵が前足で地面を踏み鳴らす（QUAKE.stomps 回）
    q.crumb -= dt;
    if (q.crumb <= 0) {
      q.crumb = 0.05;
      const x = pl.x + this.rand(0, pl.w);
      this.fx.push({ type: 'dust', x, y: pl.y + 34, vx: this.rand(-18, 18), vy: this.rand(40, 120), r: this.rand(5, 11), t: 0, dur: this.rand(0.45, 0.8) });
    }
    const k0 = Math.floor((q.t - dt) / QUAKE.tele * QUAKE.stomps), k1 = Math.floor(q.t / QUAKE.tele * QUAKE.stomps);
    if (k1 > k0 && k1 <= QUAKE.stomps) { this.dust(e.x + e.facing * e.bw * 0.3, e.y, 4, e.bw * 0.2); this.sfx('quake', 0.35); this.shakeAdd(5); }
    if (q.t < QUAKE.tele) return true;
    e.quake = null; e.tele = false; e.perchT = 0; e.bossPerchT = 0; e.quakeCd = q.boss ? QUAKE.bossCool : QUAKE.cool; e.cd = Math.max(e.cd, 1.2);
    this.sfx('quake', 0.9); this.shakeAdd(14); this.addHitstop(0.06);
    this.ring(pl.x + pl.w / 2, pl.y, { r0: 20, r1: pl.w / 2, dur: 0.5, color: '#ffe9b0', flat: true, w: 8 });      // 輪は足場の幅だけ
    this.dust(e.x, e.y, 10, e.bw * 0.4);
    this.dust(pl.x + pl.w / 2, pl.y, Math.max(6, Math.round(pl.w / 30)), pl.w / 2);
    this.stats.quakes = (this.stats.quakes || 0) + 1;
    const hit = !!(p && this.playerAlive() && p.onGround && p.sup === pl && p.x >= pl.x - (q.edge ? SUP_PAD : 0) && p.x <= pl.x + pl.w + (q.edge ? SUP_PAD : 0) && p.y < e.y - 60 && this.playerVulnerable());
    if (this.logHook) this.lg('quake', { by: e.type, k: 'fire', plat: this.platforms.indexOf(pl), hit, px: Math.round(p ? p.x : 0) });
    if (hit) {
      const dmg = Math.max(1, Math.round((q.boss ? QUAKE.bossDmg : QUAKE.dmg) * this.diff.enemyDmg));
      if (this.logHook) this.lg('hurt', { by: e.type, mv: 'quake', dmg, hp: Math.round(p.hp), res: 'hit' });
      this.popup(p.x, p.y - p.bh - 20, 'QUAKE!', { color: '#ffd24a', size: 30 });
      this.hurtPlayer(dmg, sign(p.x - e.x) || 1, QUAKE.kb, QUAKE.stun, 1.3);
      if (p.state === 'hurt') { p.vy = QUAKE.pop; p.onGround = false; p.sup = null; }
    }
    return true;
  }

  aiTick(e, dt) {
    const t = e.d.ai.type;
    if (e.hazHop && !e.onGround) { this.holdAnim(e, 'hop'); e.vx = e.hazHop.vx; return; }      // 版3.3：池を跳び越えている最中は、横の速さを AI に渡さない
    if (guardTick(this, e, dt)) return;       // 版1.2：敵の読みガード（src/guard.js）。構えているあいだはほかの AI を動かさない
    if (this.wanderAI(e, dt)) return;         // 2026-10-29：主人公が遠いあいだの徘徊（雑魚のみ）
    // 版2.6：hopAI＝足場の上の主人公へ跳び上がる／perchAI＝足場ゆらし（跳べない・届かないときの最後の手）。
    // 2026-11-14：この 3 つが動いている間は、地上で向き合ったときの構えを解く（前はアンキロ・トリケラが盾の構えのまま 25 秒以上足場の下で足踏みし、突進の構えの待ちも止まった）
    if (this.descendAI(e) || this.hopAI(e, dt) || this.perchAI(e, dt)) { this.dropStance(e); return; }
    if (t === 'walker') this.aiWalker(e, dt);
    else if (t === 'charger') this.aiCharger(e, dt);
    else if (t === 'tank') this.aiTank(e, dt);
    else if (t === 'flyer') this.aiFlyer(e, dt);
    else if (t === 'swimmer') this.aiSwimmer(e, dt);      // 版3.0：海
    else if (t === 'boss' || t === 'multi') this.aiBoss(e, dt);       // 版2.0：multi＝雑魚のまま技を複数持つ（マンモス）
    else if (t === 'rival') rivalAI(this, e, dt);
  }

  /** 2026-11-14：地上で向き合ったときの構え（tank の盾・charger の突進の待ち）を解く。反応して構えるガード（guard.js の gS.active）は別の管理なので触らない。つまみ GRUNT_FIX.on（false で旧）。 */
  dropStance(e) {
    if (!GRUNT_FIX.on) return;
    if (e.guarding && !(e.gS && e.gS.active)) this.setGuard(e, false);
    if (e.aiS && e.aiS.phase === 'wait') e.aiS.phase = 'approach';
  }
  /** 徘徊の対象か（地上の雑魚。ボス級・ライバル・飛ぶ・泳ぐ・足場を使わない敵は対象外）。 */
  wanderable(e) {
    const d = e.d, t = d.ai && d.ai.type;
    return d.tier === 'grunt' && !d.flying && !d.swim && !e.rival && !e.noPlat && d.speed > 0 && (t === 'walker' || t === 'charger' || t === 'tank' || t === 'multi');
  }
  /**
   * 2026-11-15：追撃型の敵が、いま主人公を追うべきか（索敵の外でも）。
   * 追撃型＝d.pursuit==='jump' かつ跳ぶ絵のある種（d.hop）。追う条件＝主人公が歩いては届かない所にいる：
   *  ①主人公が足場の上にいて、跳んで上がる道がある（hopPlan。高さの差は hopAI が動く 100px 以上）
   *  ②敵が足場の上にいて、主人公のいる所へ足場を降りないと近づけない（mustLeave。降りる動きは descendAI）
   *  ③敵が地面にいて、主人公との間に溶岩の池がある（縁で止まって、跳び越える）
   * かつ横の距離が PURSUIT.range 以内。つまみ PURSUIT.on（false で全員が徘徊型）。
   */
  pursuing(e) {
    const p = this.player, d = e.d;
    if (!PURSUIT.on || !p || d.pursuit !== 'jump' || !d.hop || !e.onGround || e.noPlat || !this.playerAlive()) return false;
    if (Math.abs(p.x - e.x) > PURSUIT.range) return false;
    const sup = e.sup && e.sup !== 'ground' ? e.sup : null;
    const pl = p.onGround && p.sup && p.sup !== 'ground' ? p.sup : null;
    if (pl && pl !== sup && p.y < e.y - HOP.seeDy && this.hopPlan(e, pl)) return true;      // ①（足場の上の敵が、さらに上の足場へ跳ぶ道も同じ）
    if (sup) return this.mustLeave(e);
    if (e.sup !== 'ground') return false;
    for (const z of this.lavaZones(e)) if ((e.x <= z.x0 && p.x >= z.x1) || (e.x >= z.x1 && p.x <= z.x0)) return true;
    return false;
  }
  /** x に立てるか（徘徊の歩く先。足場の端・画面の端・海底の裂け目・溶岩の池の手前で false）。 */
  wanderOk(e, x) {
    const sp = e.sup, pad = WANDER.edgePad;
    if (sp && sp !== 'ground') return x >= sp.x + pad && x <= sp.x + sp.w - pad;
    const lim = e.bw * 0.33 + 8;
    if (x < lim || x > W - lim) return false;
    if (this.gaps.length && (this.inGap(x - pad) || this.inGap(x + pad))) return false;
    for (const z of this.lavaZones(e)) if (x > z.x0 - pad && x < z.x1 + pad) return false;
    return true;
  }
  /**
   * 2026-11-14：x が wanderOk の「立てない帯」にどれだけ入り込んでいるか（px・0＝立てる）。wanderOk と同じ境目（0 のときだけ wanderOk が true）。
   * 帯の中では、近い方の帯の外までの距離。池の縁・足場の端に押し出されて帯の中に立った敵が、帯から抜ける向きへは歩けるようにするために使う。
   */
  wanderOver(e, x) {
    const sp = e.sup, pad = WANDER.edgePad;
    if (sp && sp !== 'ground') return Math.max(0, sp.x + pad - x) + Math.max(0, x - (sp.x + sp.w - pad));
    const lim = e.bw * 0.33 + 8;
    let v = Math.max(0, lim - x) + Math.max(0, x - (W - lim));
    for (const g of this.gaps) {
      const a = x - pad, b = x + pad;
      if ((a > g.x0 && a < g.x1) || (b > g.x0 && b < g.x1)) v += Math.min(x - (g.x0 - pad), g.x1 + pad - x);
    }
    for (const z of this.lavaZones(e)) if (x > z.x0 - pad && x < z.x1 + pad) v += Math.min(x - (z.x0 - pad), z.x1 + pad - x);
    return v;
  }
  /**
   * 2026-10-29：雑魚の徘徊。戻り値＝徘徊の動きをした（この AI で今コマは終わり）。ターゲット中・対象外・宙にいる間は false（従来の AI）。
   */
  wanderAI(e, dt) {
    const w = e.wn || (e.wn = { aggro: false, outT: 0, hitUntil: -1, act: false, ph: 'stand', t: 0, dir: 1, home: e.x });
    w.act = false;
    const p = this.player;
    if (!WANDER.on || !p || !this.wanderable(e) || !e.onGround || e.hazHop) return false;
    const dist = Math.hypot(p.x - e.x, (p.y - e.y) * WANDER.dyMul);
    if (this.time < w.hitUntil) { w.aggro = true; w.outT = 0; }
    else if (dist < WANDER.aggro) { w.aggro = true; w.outT = 0; }
    else if (this.pursuing(e)) { w.aggro = true; w.outT = 0; }      // 2026-11-15：追撃型は、主人公が歩いては届かない所にいるあいだ、索敵の外でもターゲットのまま
    else if (w.aggro) {
      if (dist > WANDER.lose) { w.outT += dt; if (w.outT >= WANDER.loseT) { w.aggro = false; w.ph = 'stand'; w.t = this.rand(0.3, 1.2); w.home = e.x; } }
      else w.outT = 0;
    }
    if (w.aggro) return false;
    w.act = true;
    if (e.guarding) this.setGuard(e, false);
    if (e.aiS && e.aiS.phase === 'wait') { e.aiS.phase = 'approach'; }      // 突進の構え（charger）の途中だったら、構えをやめる
    w.t -= dt;
    const spd = e.d.speed * WANDER.speedMul;
    // 2026-11-14：歩いてよい一歩＝行き先に立てる、または今より帯から抜ける向き（池の縁に押し出されて立った敵が、どちらへも歩けず固まっていた）
    // WANDER.escape=false で直す前の動きに戻る（検査の陰性対照用）
    const stepOk = (to) => this.wanderOk(e, to) || (WANDER.escape && this.wanderOver(e, to) < this.wanderOver(e, e.x));
    // 徘徊の範囲＝home から radius の内側、または home へ近づく一歩（radius の外に出た敵が、戻る一歩も範囲の外として打ち切られ固まっていた）
    const inRange = (to) => Math.abs(to - w.home) <= WANDER.radius || (WANDER.escape && Math.abs(to - w.home) < Math.abs(e.x - w.home));
    if (w.ph === 'walk') {
      const nx = e.x + w.dir * 14;
      // 2026-11-14：歩いているのに進まない（隣の敵に押し返される separateEnemies など）ときは、足踏みを続けず立ち止まって向きを変える。0.5 秒で歩く量の 1/4 未満なら「進まない」
      w.pt = (w.pt || 0) + dt;
      let blocked = false;
      if (w.pt >= 0.5) { blocked = WANDER.unstick && w.px !== undefined && Math.abs(e.x - w.px) < spd * 0.5 * 0.25; w.pt = 0; w.px = e.x; }
      if (blocked || !stepOk(nx) || !inRange(nx)) { w.ph = 'stand'; w.t = this.rand(0.4, 1.2); w.dir = -w.dir; e.vx = 0; }      // 壁・足場の端・穴・池・徘徊の範囲の端で折り返す
      else if (w.t <= 0) { w.ph = 'stand'; w.t = this.rand(WANDER.standT[0], WANDER.standT[1]); e.vx = 0; }
      else { e.facing = w.dir; e.vx = w.dir * spd; }
    }
    if (w.ph === 'stand') {
      e.vx = 0;
      if (w.t <= 0) {
        const r = this.rand();
        if (r < 0.65) {
          const back = Math.abs(e.x - w.home) > WANDER.radius * 0.6 ? Math.sign(w.home - e.x) : 0;
          let dir = back || (this.rand() < 0.5 ? -1 : 1);
          if (!stepOk(e.x + dir * 14)) dir = -dir;
          if (stepOk(e.x + dir * 14)) { w.ph = 'walk'; w.pt = 0; w.px = e.x; w.dir = dir; w.t = this.rand(WANDER.walkT[0], WANDER.walkT[1]); e.facing = dir; }
          else w.t = this.rand(WANDER.standT[0], WANDER.standT[1]);
        } else if (r < 0.85) { e.facing = -e.facing; w.t = this.rand(WANDER.standT[0], WANDER.standT[1]); }      // 立ち止まって向きを変える
        else w.t = this.rand(WANDER.standT[0], WANDER.standT[1]);
      }
    }
    if (Math.abs(e.vx) > 5) {
      const wk = e.d.anim.walk, per = wk ? wk[3] * e.d.speed / Math.abs(e.vx) : undefined;      // 足が滑らないよう、歩く速さに合わせて1周を伸ばす（歩きの絵が無い種は待機の速回し代用＝既存の仕組みのまま）
      this.loopAnim(e, 'walk', per);
    } else this.loopAnim(e, 'idle');
    return true;
  }

  sameLevel(e, p) { return Math.abs(p.y - e.y) < e.bh * 0.75; }

  aiWalker(e, dt) {
    const p = this.player, a = e.d.ai;
    const dx = p.x - e.x, dist = Math.abs(dx);
    if (dist > 24) e.facing = dx >= 0 ? 1 : -1;
    const atk = a.range * (e.bw / 2);
    const same = this.sameLevel(e, p);
    const alive = this.playerAlive();
    if (e.onGround && alive && dist <= atk && same && e.cd <= 0) { e.vx = 0; this.startMove(e, 'bite'); return; }
    if (e.onGround) {
      e.vx = (alive && (dist > atk * 0.85 || !same)) ? e.facing * e.d.speed : 0;
      // 版2.6：上の足場へ跳び上がるのは hopAI（aiTick の頭）に移した
    }
    if (!e.onGround) this.holdAnim(e, 'hop');
    else if (Math.abs(e.vx) > 5) this.loopAnim(e, 'walk');
    else this.loopAnim(e, 'idle');
  }

  aiCharger(e, dt) {
    const p = this.player, a = e.d.ai;
    const s = e.aiS || (e.aiS = { phase: 'approach', wait: 0 });
    const dx = p.x - e.x, dist = Math.abs(dx);
    if (s.phase === 'approach') {
      if (dist > 24) e.facing = dx >= 0 ? 1 : -1;
      e.vx = this.playerAlive() ? e.facing * e.d.speed : 0;
      this.loopAnim(e, 'walk');
      if (e.cd <= 0 && dist < 760 && this.playerAlive() && e.onGround) {
        s.phase = 'wait'; s.wait = this.rand(a.waitMin, a.waitMax); this.setGuard(e, GUARD_TUNE.stance); e.vx = 0;
      }
    } else {
      e.vx = 0;
      if (dist > 24) e.facing = dx >= 0 ? 1 : -1;   // 立ち止まって相手を見る
      if (!e.guarding && GUARD_TUNE.stance) this.setGuard(e, true);
      if (e.guarding) this.applyGuardAnim(e, dt);
      s.wait -= dt;
      if (s.wait <= 0) { this.setGuard(e, false); s.phase = 'approach'; e.facing = (p.x - e.x) >= 0 ? 1 : -1; this.startMove(e, 'charge'); e.cd = 1.2; }
    }
  }

  aiTank(e, dt) {
    const p = this.player, a = e.d.ai;
    const s = e.aiS || (e.aiS = { turnT: 0 });
    const dx = p.x - e.x, dist = Math.abs(dx);
    const want = dx >= 0 ? 1 : -1;
    if (want !== e.facing && dist > 8) {      // 版3.5：30→8。真後ろ（30px 以内）に主人公が回り込むと、向きを変えず・殴らず・動かず、いつまでも固まった
      s.turnT += dt;
      if (s.turnT >= a.turnDelay) { e.facing = want; s.turnT = 0; this.setGuard(e, false); }
    } else s.turnT = 0;
    const front = want === e.facing || dist <= 8;      // 版3.5：真上に重なったら向きに関わらず前＝殴る
    const hw = e.bw / 2;
    const alive = this.playerAlive();
    const same = this.sameLevel(e, p);
    if (front && alive && e.onGround && dist <= a.range * hw && same && e.cd <= 0) {
      this.setGuard(e, false); e.vx = 0; this.startMove(e, 'bite'); return;
    }
    const guardNow = GUARD_TUNE.stance && front && alive && dist < a.guardDist * hw && same;
    this.setGuard(e, guardNow);
    if (e.guarding) this.applyGuardAnim(e, dt);
    const slow = e.guarding ? 0.45 : 1;
    e.vx = (alive && dist > a.range * hw * 0.9 && front) ? e.facing * e.d.speed * slow : 0;
    if (!e.guarding) this.loopAnim(e, Math.abs(e.vx) > 5 ? 'walk' : 'idle');
  }

  aiFlyer(e, dt) {
    const a = e.d.ai;
    const s = e.aiS || (e.aiS = {
      baseY: this.flyBaseY() - a.altitude + this.rand(-40, 40), dir: e.x < W / 2 ? 1 : -1,
      diveT: this.rand(1.4, a.diveEvery[1]), phase: this.rand(0, 6.28),
    });
    const p = this.player;
    if (e.landed) e.landed = false;   // 地面から飛び立つ（下の lerp で舞い上がる）
    s.phase += dt * 2.4;
    e.x += s.dir * e.d.speed * dt;
    if (e.x > W - 140) s.dir = -1;
    if (e.x < 140) s.dir = 1;
    e.facing = s.dir;
    // 版2.8b：飛ぶ敵は、主人公が最後に立っていた面（地面か足場）の高さを基準に飛ぶ（最上段に立っても上がってきて攻撃する）。空中にいる間は直前の面のまま
    // 版3.0：海の面の基準は水面（海底ではない）。水の中の足場（海中の岩棚・海底）に立っても、飛ぶ敵は水の中へ下がらない
    const g0 = this.water ? this.water.y : this.groundY;
    const ref0 = s.ref;
    if (p && p.onGround && p.sup) s.ref = this.water ? Math.min(this.supportTop(p), g0) : this.supportTop(p);
    if (s.ref === undefined) s.ref = g0;
    if (Math.abs(s.ref - (ref0 === undefined ? g0 : ref0)) >= 80) s.diveT = Math.min(s.diveT, 0.5);      // 版3.2：主人公が別の高さの面に移ったら、急降下の順番を早める（高さを合わせたあと、予告つきで来る）
    const target = s.baseY - (g0 - s.ref) + Math.sin(s.phase) * a.wave;
    e.y += clamp((target - e.y) * Math.min(1, dt * CHASE.flyFollow), -FLY_CLIMB * dt, FLY_CLIMB * dt);
    s.arriveT = Math.abs(target - e.y) < 60 ? (s.arriveT || 0) + dt : 0;      // 版3.2：主人公の高さに合わせてからの秒
    e.vx = 0; e.vy = 0;
    this.loopAnim(e, 'idle');
    s.diveT -= dt;
    if (s.diveT <= 0 && this.playerAlive() && s.arriveT >= CHASE.flyArrive) {      // 版3.2：高さを合わせて CHASE.flyArrive 秒たってから（急降下の予告 0.55 秒と合わせて、追いついてから当たるまで 1 秒以上）
      s.diveT = this.rand(a.diveEvery[0], a.diveEvery[1]);
      e.facing = p.x >= e.x ? 1 : -1;
      let id = 'dive';
      if (a.moves) {      // 版2.0：技を複数持つ飛ぶ敵（ケツァルコアトルス）。重みで選び、同じ技はしばらく続けない
        const mcd = s.mcd || (s.mcd = {});
        const cands = a.moves.filter((m) => (mcd[m.id] ?? 0) <= this.time);
        const pool = cands.length ? cands : a.moves;
        const tw = pool.reduce((x, m) => x + m.w, 0);
        let r = this.rand(0, tw), pick = pool[0];
        for (const m of pool) { r -= m.w; if (r <= 0) { pick = m; break; } }
        mcd[pick.id] = this.time + pick.cd;
        id = pick.id;
      }
      this.startMove(e, id);
    }
  }

  /**
   * 版3.0：泳ぐ敵（d.swim・ai.type 'swimmer'）。水の中を、主人公と同じ深さへ泳いで近づき（水の上に主人公がいるときは水面のすぐ下で待ち）、間合いに入ったら技を出す。
   *  ・技は ai.moves の重み付き抽選（range＝2点間の距離÷体の半幅／cd＝同じ技をもう一度出すまで／air＝主人公が水の上にいるときだけ使う）。
   *  ・水面から飛び出して噛みつく（breach）は、主人公が水の上（足場・空中）にいるときの手。それ以外の技は、主人公が水の中（か、水面すれすれ）のとき。
   *  ・水の外へ出られるのは breach の間だけ（swimBody）。水の中の速さは world.update が WATER.slow 倍にする（水中は敵も遅い）。
   */
  aiSwimmer(e, dt) {
    const p = this.player, a = e.d.ai, w = this.water;
    if (!w) return;
    const s = e.aiS || (e.aiS = { phase: this.rand(0, 6.28), gap: this.rand(a.gap[0], a.gap[1]) + 0.5, mcd: {} });
    s.phase += dt * 1.9;
    s.gap -= dt;
    for (const k of Object.keys(s.mcd)) if (s.mcd[k] > 0) s.mcd[k] -= dt;
    const alive = this.playerAlive(), hw = e.bw / 2;
    const cy = e.y - e.bh * 0.5, pc = p.y - p.bh * 0.5, pWet = this.inWater(p);
    const minC = w.y + e.bh * 0.2 + 12, maxC = this.groundY - e.bh * 0.5 - 6;
    let tc = alive ? (pWet ? pc : minC + 24) : minC + 90;      // 目標の深さ＝水の中の主人公と同じ深さ／水の上なら水面のすぐ下で待つ
    tc = clamp(tc, minC, maxC) + Math.sin(s.phase) * a.wave;
    const dx = p.x - e.x, dist = Math.abs(dx);
    if (dist > 30) e.facing = dx >= 0 ? 1 : -1;
    const stand = a.stand * hw, spd = this.spdOf(e);
    let tx = p.x;
    const tdx = tx - e.x, tdist = Math.abs(tdx);
    let tvx = 0;
    if (alive) { if (tdist > stand * 1.05) tvx = sign(tdx) * spd; else if (tdist < stand * 0.55 && tx === p.x) tvx = -sign(tdx) * spd * 0.5; }
    e.vx = lerp(e.vx, tvx, Math.min(1, dt * 3.5));
    if (cy >= w.y) e.vy = lerp(e.vy, clamp((tc - cy) * 2.6, -spd * 0.9, spd * 0.9), Math.min(1, dt * 3.5));      // 水の外（飛び出したあと等）は重力に任せる
    this.loopAnim(e, 'walk');
    // 重なりすぎないように、近い泳ぐ仲間と少し離れる
    for (const o of this.enemies) {
      if (o === e || !o.d.swim || o.state === 'dying' || o.dead) continue;
      const ox = e.x - o.x, oy = e.y - o.y;
      if (Math.abs(ox) < (e.bw + o.bw) * 0.3 && Math.abs(oy) < (e.bh + o.bh) * 0.35) { e.vx += (ox >= 0 ? 1 : -1) * 90 * dt * 4; e.vy += (oy >= 0 ? 1 : -1) * 70 * dt * 4; }
    }
    if (s.gap > 0 || e.cd > 0 || !alive || !(cy >= w.y)) return;
    const ratio = Math.hypot(dx, pc - cy) / hw;
    const reachable = pWet || pc > w.y - 40;      // 水の中の主人公、または水面すれすれ
    const cands = a.moves.filter((m) => (s.mcd[m.id] ?? 0) <= 0 && ratio >= m.range[0] && ratio <= m.range[1] && (m.air ? !pWet && dist < hw * 3.2 : reachable));
    if (!cands.length) { s.gap = 0.25; return; }
    const tw = cands.reduce((x, m) => x + m.w, 0);
    let r = this.rand(0, tw), pick = cands[0];
    for (const m of cands) { r -= m.w; if (r <= 0) { pick = m; break; } }
    s.mcd[pick.id] = pick.cd * this.rageGap(e);
    s.gap = this.rand(a.gap[0], a.gap[1]) * this.diff.atkGap * this.rageGap(e);
    e.facing = dx >= 0 ? 1 : -1;
    this.startMove(e, pick.id);
  }

  aiBoss(e, dt) {
    const p = this.player, a = e.d.ai;
    const s = e.aiS || (e.aiS = { gap: (this.rand(a.gap[0], a.gap[1]) + 0.6) * this.diff.atkGap, mcd: {}, spCd: a.spLock ? a.spLock * 0.8 : 0 });
    if (s.spCd > 0) s.spCd -= dt;      // 版2.3：必殺技（sp）を出したあと、spLock 秒はほかの必殺技を出さない
    const dx = p.x - e.x, dist = Math.abs(dx), hw = e.bw / 2;
    if (dist > 30) e.facing = dx >= 0 ? 1 : -1;
    s.gap -= dt;
    for (const k of Object.keys(s.mcd)) if (s.mcd[k] > 0) s.mcd[k] -= dt;
    const alive = this.playerAlive();
    // 近づく
    // 版3.2：主人公が上の足場に立っているときは、足場の真下に入るまで（足場ゆらしの待ちが数え始まる位置）駆け足で寄る。主人公の真横の間合いで立ち止まっても、上の足場には技が届かない
    const above = alive && e.onGround && this.isBigBoss(e) && p.onGround && p.sup && p.sup !== 'ground' && p.sup.y < e.y - QUAKE.minDy && p.x >= p.sup.x && p.x <= p.sup.x + p.sup.w;
    if (above && this.quakePlatform(e, p) === null) { e.facing = dx >= 0 ? 1 : -1; e.vx = e.facing * this.spdOf(e) * CHASE.bossRunMul; this.loopAnim(e, 'walk'); }
    else if (alive && dist > hw * 1.15 && e.onGround && !(above && this.quakePlatform(e, p) !== null)) { e.vx = e.facing * this.spdOf(e); this.loopAnim(e, 'walk'); }
    else { e.vx = 0; this.loopAnim(e, 'idle'); }
    if (s.gap > 0 || !alive || !e.onGround) return;
    const ratio = dist / hw;
    const cands = a.moves.filter((m) =>
      (s.mcd[m.id] ?? 0) <= 0 && ratio >= m.range[0] && ratio <= m.range[1] && !(m.sp && s.spCd > 0) &&
      (!m.hpBelow || e.hp / e.maxHp <= m.hpBelow) && (!m.minion || this.minionCount() === 0));
    if (!cands.length) { s.gap = 0.25; return; }
    const prio = cands.find((m) => m.minion);
    let pick = prio;
    if (!pick) {
      const wOf = (m) => m.w * (m.sp && e.rage ? e.rage.spWeight : 1);      // 版2.4：怒り中は必殺技を選びやすい
      const tw = cands.reduce((x, m) => x + wOf(m), 0);
      let r = this.rand(0, tw);
      pick = cands[0];
      for (const m of cands) { r -= wOf(m); if (r <= 0) { pick = m; break; } }
    }
    s.mcd[pick.id] = pick.cd * (e.rage ? e.rage.atkGap : 1);      // 版2.4：怒り中は技ごとの待ちも短い
    if (pick.sp) s.spCd = (a.spLock || 0) * (e.rage ? e.rage.spLock : 1);
    s.gap = this.rand(a.gap[0], a.gap[1]) * this.diff.atkGap * this.rageGap(e);
    this.startMove(e, pick.id);
  }

  // ---- 主人公が打たれる ----
  /**
   * 敵の技が主人公に当たった。戻り値＝ダメージが入ったか（ガードされたら false）。
   * opt.srcX / opt.wave：衝撃波（飛び道具）の当たり。ガードされても撃った側は弾かれない。
   */
  enemyHitsPlayer(e, hit, box, hb, opt = {}) {
    const p = this.player;
    e.hitPlayerT = this.time;      // 版2.8b：ボスの足場ゆらしの待ちを数え直す（技が主人公に届いた）
    const srcX = opt.srcX ?? e.x;
    const dir = sign(p.x - srcX) || e.facing;
    // コンボ破りの技：ガードを崩し、主人公を高く遠くへ吹き飛ばす
    const dmgK = this.diff.enemyDmg * (e.rage ? e.rage.dmg : 1);
    if (dmgK !== 1) hit = { ...hit, dmg: Math.max(1, Math.round(hit.dmg * dmgK)) };      // 版1.3：難しさ
    const brk = !!e.breaking;
    if (brk) hit = { ...hit, breakGuard: true, kb: Math.max(hit.kb || 0, 760), stun: Math.max(hit.stun || 0, 0.8) };
    const cx = (Math.max(box.x0, hb.x0) + Math.min(box.x1, hb.x1)) / 2;
    const cy = (Math.max(box.y0, hb.y0) + Math.min(box.y1, hb.y1)) / 2;
    // ガード（↓押し続け）：正面の攻撃は防ぎ、相手を弾く。直後の約0.17秒に攻撃ボタンでガード返し。
    // ライバルの咆哮・体当たりなどガードを崩す技（breakGuard）は、ガードを崩して当たる。
    if (p.guarding && p.onGround && this.isFront(p, srcX) && !this.guardOverhead(p, opt.atkAt || e, hit, cy)) {      // 版2.4：上から来る攻撃はガードできない（opt.atkAt＝床を走る輪は、輪を出したときの撃った側の様子で見る）
      if (hit.breakGuard) {      // 版2.3：ガードを崩す当たり（breakGuard）は敵の技にも効く（四天王の必殺技）。従来は (e.rival || brk) だけで、その2つは breakGuard を持つ技だけが出す
        p.guarding = false;
        if (this.logHook) this.lg('hurt', { by: e.type, mv: e.move ? e.move.name : (hit.mv || null), dmg: hit.dmg, hp: Math.round(p.hp), res: 'gbreak', ...(e.rival ? { rv: 1 } : null) });
        this.popup(p.x, p.y - p.bh, 'GUARD BREAK!', { color: '#ff8a7a', size: 28 });
      } else if (p.parryOpen && !hit.noParry && p.guardHoldT <= PARRY.window * (this.diff.parryMul || 1)) {      // 版2.7：noParry＝この当たりはパリィできない（なぎ払いの2発目以降）
        this.parry(e, cx, cy, dir, opt);      // 版2.5：パリィ（ダメージ 0・CP は減らない・敵は確定で目を回す）
        return false;
      } else {
        // 版2.5：受け止めると CP が減る。CP が 0 のときは削りが通る（CP FREE のときは減らない）
        let chip = 0;
        if (!this.mpFree) {
          if (p.gauge <= 0) chip = Math.max(1, Math.round(hit.dmg * CP_GUARD.chipRate));
          else p.gauge = Math.max(0, p.gauge - (opt.wave ? CP_GUARD.wave : isChargeMove(e.move && e.move.def) ? CP_GUARD.charge : CP_GUARD.block) * tn('cpGuardCost'));
        }
        if (chip > 0) {
          this.stats.guardChips = (this.stats.guardChips || 0) + 1;
          if (p.hp - chip <= 0) { if (this.logHook) this.lg('hurt', { by: e.type, mv: e.move ? e.move.name : (hit.mv || null), dmg: chip, hp: Math.round(p.hp), res: 'hit', ...(e.rival ? { rv: 1 } : null) }); this.hurtPlayer(chip, dir, 300, 0.5); return true; }
          p.hp -= chip; p.flash = 0.15;
          this.popup(p.x + p.facing * 60, p.y - p.bh * 0.7, 'CP 0', { size: 18, color: '#ff9a8a', dur: 0.6 });
        }
        this.sfx('guard'); this.spark(cx, cy, 'guard', dir);
        p.guardOkT = GUARD_OK_T; p.guardFlash = 0.18;
        this.stats.guards = (this.stats.guards || 0) + 1;
        if (this.logHook) this.lg('hurt', { by: e.type, mv: e.move ? e.move.name : (hit.mv || null), dmg: chip, hp: Math.round(p.hp), res: 'guard', ...(e.rival ? { rv: 1 } : null) });
        // 版1.2：ガードされた攻撃の側（敵）ははじかれる。近接の攻撃だけ（輪・衝撃波は撃った側がはじかれない）。突進は大きくはじかれ、ハイパーアーマーも貫く
        if (!opt.wave && opt.srcX === undefined && !hit.noRepel) this.repel(e, -dir, isChargeMove(e.move && e.move.def) ? 'gCharge' : 'gLight', cx, cy);      // 版2.4：目の前で硬直（遠くへはじかれない）
        this.addHitstop(0.05);
        this.popup(p.x + p.facing * 60, p.y - p.bh * 0.9, 'GUARD', { size: 20, color: '#9fe8ff', dur: 0.5 });
        return false;
      }
    }
    if (hit.grab) { this.startGrab(e, hit, cx, cy); return true; }      // 版2.3：つかみ（引きずり込み）
    this.sfx('hurt'); this.sfx(hit.sfx || 'hit', 0.8);
    this.spark(cx, cy, 'hurt', dir, 1.2);
    if (e.rival) {
      // ライバルの技：吹き飛ばし（launch）は、主人公を弱めに押す・浮かせる形に読み替える（主人公には「弾」の状態が無い）。
      // つなぎの途中の当たりは、次の技が当たるまで無敵を付けない（硬直が切れたあとの次の当たりは、ガード・跳び・咆哮で逃げられる）。つなぎの最後の当たりのあとは長く無敵。
      const L = hit.launch || null;
      const kb = L ? clamp(Math.abs(L.vx) * 0.4, 220, 560) : (hit.kb || 240);
      const stun = (!e.onGround || !p.onGround) ? Math.max(hit.stun || 0.35, 0.55) : (hit.stun || 0.35);   // 空中のつなぎは、次の技までの間（約0.4秒）より長く硬直させる
      const s = e.aiS;
      const last = (L && !L.float) || !!(s && s.string >= RIVAL_TUNE.stringMax && e.onGround) || !!(s && s.string >= RIVAL_TUNE.airStringMax - 1);
      this.lastHurtSrc = { by: e.type, mv: e.move ? e.move.name : (hit.mv || null) };
      this.hurtPlayer(hit.dmg, dir, brk ? 760 : kb, stun, (last || brk) ? 1.3 : 0.1);
      if (this.logHook) this.lg('hurt', { by: e.type, mv: e.move ? e.move.name : (hit.mv || null), dmg: hit.dmg, hp: Math.round(p.hp), res: 'hit', rv: 1, ...(brk ? { brk: 1 } : null) });
      if (brk && p.state === 'hurt') { p.onGround = false; p.sup = null; p.vy = -560; p.airJuggleT = stun + 0.2; this.sfx('launch'); }
      else if (p.state === 'hurt' || p.state === 'down') {
        if (L && L.vy < 0) { p.onGround = false; p.sup = null; p.vy = Math.min(L.vy * 0.9, (e.vy || 0) * 0.9); p.airJuggleT = stun + 0.2; }
        else if (L && L.vy > 0) { p.onGround = false; p.sup = null; p.vy = Math.min(L.vy * 0.6, 900); }
        else if (!p.onGround) { p.vy = Math.min(p.vy, -300); p.airJuggleT = stun + 0.2; }   // 空中で当たった（昇り）：高さを保つ
      }
      if (hit.bounce && !e.onGround && !opt.wave) { e.vy = hit.bounce * 0.45; e.jumpCut = true; }       // 昇りの当たり：ライバルも少し上へ
      e.gauge = Math.min(100, e.gauge + (RIVAL_TUNE.gaugeOnHit * (hit.gauge || 0) + RIVAL_TUNE.gaugeFlat) * this.diff.rivalGauge);
      return true;
    }
    this.lastHurtSrc = { by: e.type, mv: e.move ? e.move.name : (hit.mv || null) };
    this.hurtPlayer(hit.dmg, dir, hit.kb || 240, hit.stun || 0.35, brk ? 1.3 : (hit.inv ?? 1.5));      // 版2.3：inv＝被弾後の無敵（つなぎの当たりは短い）
    if (hit.slam && p.state === 'hurt') this.armSlam(p, dir, hit.slam, hit.stun || 1.0);
    if (this.logHook) this.lg('hurt', { by: e.type, mv: e.move ? e.move.name : (hit.mv || null), dmg: hit.dmg, hp: Math.round(p.hp), res: 'hit', ...(brk ? { brk: 1 } : null) });
    if (brk && p.state === 'hurt') { p.onGround = false; p.sup = null; p.vy = -560; p.airJuggleT = (hit.stun || 0.8) + 0.2; this.sfx('launch'); }
    return true;
  }

  // ---- 版2.3：四天王の必殺技（スピノフューリーの壁叩きつけ・引きずり込みのつかみ） ----
  /** 打ち上げられた主人公が壁まで飛ぶ（壁に着いたら追加ダメージ）。壁までの距離に合わせて飛ぶ時間を決める＝壁の近くでも遠くでも届く。 */
  /** 版2.5：パリィ。受け止めた敵は確定で目を回す（stun 状態＝頭の上に星）。ハイパーアーマーも貫く。 */
  parry(e, cx, cy, dir, opt = {}) {
    const p = this.player, heavy = this.isHeavy(e);
    this.stats.parries = (this.stats.parries || 0) + 1;
    p.guardOkT = GUARD_OK_T + 0.1; p.guardFlash = 0.3;
    if (!this.mpFree) p.gauge = Math.min(100, p.gauge + PARRY.cpGain);
    if (this.logHook) this.lg('hurt', { by: e.type, mv: e.move ? e.move.name : null, dmg: 0, hp: Math.round(p.hp), res: 'parry', ...(e.rival ? { rv: 1 } : null) });
    // 2026-11-15：目を回させるのは、撃った側が待機・技の途中・のけぞり・目を回し中のときだけ。前は状態を見ずに stun にしていて、床を走る輪を出したあとに
    //   怒りの演出（1.25 秒・無敵）に入ったボスが約 0.1 秒で演出を切られた／吹き飛び中（bullet）の敵が空中で止まった／倒れている敵がすぐ起きた
    if (!e.dead && e.state !== 'dying' && (!PARRY.stateOk || PARRY.stateOk.includes(e.state))) {
      const t = heavy ? PARRY.stunHeavy : PARRY.stun;
      e.move = null; e.tele = false; e.moveV = null; e.chain = null; e.guarding = false; e.breaking = false; e.breakPending = false;
      if (e.rival) { e.escRoll = false; if (e.aiS) e.aiS.string = 0; }
      e.state = 'stun'; e.stunT = t; e.vx = 0; e.vy = Math.min(e.vy || 0, 0); e.rp = null; e.repelT = 0; e.shakeAmp = 0;
      this.loopAnim(e, 'stun');
    }
    this.spark(cx, cy, 'parry', dir, 1.5);
    this.ring(cx, cy, { r0: 10, r1: 130, dur: 0.3, color: '#ffffff', w: 8 });
    this.flashScreen('#ffffff', 0.16);
    this.sfx('guard', 1, 1.8); this.sfx('powerup', 0.55, 2.0);
    this.addHitstop(PARRY.hitstop); this.shakeAdd(4);
    this.popup(clamp(p.x + p.facing * 40, 140, W - 140), p.y - p.bh - 24, 'PARRY!', { size: 40, color: '#ffffff', dur: 0.9 });
  }
  armSlam(p, dir, spec, stun) {
    const lim = p.bw * 0.33;
    const wallX = dir > 0 ? W - lim : lim;
    const dist = Math.abs(wallX - p.x);
    const t = clamp(dist / 1700, 0.42, 0.8);
    p.onGround = false; p.sup = null; p.vy = -GRAV * t / 2;
    p.slamArm = { dir, vx: dir * (dist * 1.08 / t), wallX, dmg: Math.max(1, Math.round(spec.dmg * this.diff.enemyDmg)), src: this.lastHurtSrc || null };      // 版2.8：src＝壁の叩きつけのダメージを遊びの記録へ残すための、打った敵と技
    p.stunT = Math.max(p.stunT, t + 0.6);
    this.sfx('launch');
    this.fx.push({ type: 'streak', x: p.x, y: p.y - p.bh * 0.5, dir, t: 0, dur: 0.35 });
  }
  /** 壁に着いたか（飛んでいる間だけ）。着いたら追加ダメージと衝撃。 */
  tickSlam(p) {
    const a = p.slamArm;
    if (!a) return;
    if (p.state !== 'hurt') { p.slamArm = null; return; }
    if (Math.abs(p.x - a.wallX) < 8 || p.wallHit === a.dir) {
      p.slamArm = null;
      if (this.logHook) this.lg('hurt', { by: a.src ? a.src.by : null, mv: a.src ? a.src.mv : 'wall', dmg: a.dmg, hp: Math.round(Math.max(0, p.hp - a.dmg)), res: 'hit' });      // 版2.8：壁の叩きつけのダメージも記録に残す（前は漏れていた）
      this.hurtPlayer(a.dmg, -a.dir, 140, 0.7, 1.3);
      const wx = a.dir < 0 ? 0 : W;
      this.spark(wx + (a.dir < 0 ? 30 : -30), p.y - p.bh * 0.5, 'wall', a.dir, 1.6);
      this.ring(wx, p.y - p.bh * 0.5, { r0: 10, r1: 240, dur: 0.45, color: '#fff7d6', w: 10 });
      this.dust(wx + (a.dir < 0 ? 50 : -50), p.y, 10, 50);
      this.sfx('slam'); this.sfx('quake', 0.7);
      this.shakeAdd(18); this.addHitstop(0.1);
      this.popup(clamp(p.x, 140, W - 140), p.y - p.bh - 20, 'WALL SLAM!', { color: '#ff8a7a', size: 30 });
      this.stats.wallSlams = (this.stats.wallSlams || 0) + 1;
    } else if (p.onGround && Math.abs(p.vx) < 60) p.slamArm = null;
  }
  /** 敵 e の口の先（世界座標）。口の部位の、向いている側の端の少し内側。コマが替わっても大きく跳ばない（端の帯の高さの平均）。部位が取れなければ前方の低い位置。 */
  mouthPoint(e) {
    const c = this.partCells(e, 'mouth');
    if (c && c.length) {
      const b = bboxOf(c), tipX = e.facing > 0 ? b.x1 : b.x0;
      let sy = 0, n = 0;
      for (let i = 0; i < c.length; i += 4) { const edge = e.facing > 0 ? c[i + 2] : c[i]; if (Math.abs(edge - tipX) <= 40) { sy += (c[i + 1] + c[i + 3]) / 2; n++; } }
      return { x: tipX - e.facing * 24, y: n ? sy / n : (b.y0 + b.y1) / 2 };
    }
    return { x: e.x + e.facing * e.bw * 0.45, y: e.y - e.bh * 0.2 };
  }
  /** 口でくわえた：主人公は 'grabbed'（動けない・ほかの攻撃を受けない）。左右を交互に押すと抜けられる。 */
  startGrab(e, hit, cx, cy) {
    const p = this.player, m = e.move, spec = (m && m.def.grab) || { need: 6, tick: 0.4, tickDmg: 2 };
    this.sfx('hurt'); this.sfx(hit.sfx || 'hit', 0.8);
    this.spark(cx, cy, 'hurt', e.facing, 1.3);
    this.lastHurtSrc = { by: e.type, mv: m ? m.name : (hit.mv || null) };
    if (this.logHook) this.lg('hurt', { by: e.type, mv: m ? m.name : (hit.mv || null), dmg: hit.dmg, hp: Math.round(Math.max(0, p.hp - hit.dmg)), res: 'hit' });      // 版2.8：つかみ（くわえ）のダメージも遊びの記録に残す（前は漏れていた）
    if (p.hp - hit.dmg <= 0) { this.hurtPlayer(hit.dmg, e.facing, 300, 0.5); return; }
    p.hp -= hit.dmg; p.flash = 0.15; p.move = null; p.tele = false; p.hangT = 0; p.dashT = 0; p.guarding = false; p.chain = null;
    for (const o of this.enemies) { o.cbN = 0; o.breakPending = false; }
    this.endCombo();
    this.shakeAdd(10); this.addHitstop(0.08);
    p.state = 'grabbed'; p.vx = 0; p.vy = 0; p.onGround = false; p.sup = null; p.inv = 0; p.rp = null; p.repelT = 0; p.slamArm = null;
    p.facing = -e.facing;
    p.grab = { owner: e, move: m, need: spec.need, got: 0, last: 0, pl: false, pr: false, tickT: 0, tick: spec.tick, tickDmg: spec.tickDmg, t: 0 };
    if (m) m.grabbed = true;
    this.holdAnim(p, 'hurt');
    this.popup(clamp(p.x, 140, W - 140), p.y - p.bh - 50, '← → 連打!', { color: '#ffd24a', size: 26, dur: 1.2 });
    this.stats.grabs = (this.stats.grabs || 0) + 1;
  }
  /** つかみの間の主人公：口の位置に固定・交互連打の数え・かじられるダメージ。 */
  updateGrabbed(p, dt, inp) {
    const g = p.grab, e = g && g.owner;
    if (!g || e.dead || e.state === 'dying' || !e.move || e.move !== g.move) { this.releaseGrab(p, 'lost'); return; }
    g.t += dt;
    p.gravMul = 0; p.vx = 0; p.vy = 0;
    const mp = this.mouthPoint(e), ty = Math.min(this.groundY, mp.y + p.bh * 0.45);
    const k = g.t === dt ? 1 : 1 - Math.exp(-dt * 30);      // 最初のコマは口へ一気に・以降は口の動きに少し遅れてなめらかに追う（コマが替わるたびに跳ばない）
    p.x += (mp.x - p.x) * k; p.y += (ty - p.y) * k;
    p.facing = -e.facing;
    this.tickAnim(p, dt);
    // 左右を交互に押す：押した瞬間（押していなかった→押した）が、前に数えた向きと違うときだけ1回
    const L = !!(inp && inp.held.left), R = !!(inp && inp.held.right);
    if (L && !g.pl && g.last !== -1) { g.got++; g.last = -1; }
    if (R && !g.pr && g.last !== 1) { g.got++; g.last = 1; }
    g.pl = L; g.pr = R;
    if (g.got >= g.need) { this.escapeGrab(p); return; }
    const ph = e.move.def.phases[e.move.i];
    if (ph && ph.hold) {
      g.tickT += dt;
      if (g.tickT >= g.tick) {
        g.tickT -= g.tick;
        const d = Math.max(1, Math.round(g.tickDmg * this.diff.enemyDmg * (e.move.def.grab && e.move.def.grab.rage && e.rage ? e.rage.dmg : 1)));
        const d0 = p.hp; p.hp = Math.max(1, p.hp - d); p.flash = 0.1;      // かじられるだけでは倒れない（倒れるのは叩きつけ）
        if (this.logHook) this.lg('hurt', { by: e.type, mv: e.move.name, dmg: d0 - p.hp, hp: Math.round(p.hp), res: 'hit' });      // 版2.8：かじりのダメージも記録に残す（前は漏れていた）
        this.popup(p.x, p.y - p.bh - 10, String(d), { size: 18, color: '#ff9a8a', num: d });
        this.sfx('bossBite', 0.5, 1.2); this.shakeAdd(4);
      }
    }
  }
  /** 抜けた：口から飛び出して離れる。敵は叩きつけを飛ばして戻りの動きへ。 */
  escapeGrab(p) {
    const g = p.grab, e = g.owner;
    const dir = sign(p.x - e.x) || -e.facing;
    p.grab = null;
    p.state = 'hurt'; p.stunT = 0.3; p.vx = dir * 420; p.vy = -380; p.onGround = false; p.sup = null; p.inv = 0.8; p.gravMul = 1;
    this.onceAnim(p, 'hurt', 0.3);
    this.sfx('powerup', 0.7, 1.5); this.spark(p.x, p.y - p.bh * 0.5, 'guard', dir, 1.2);
    this.popup(clamp(p.x, 140, W - 140), p.y - p.bh - 40, 'ESCAPE!', { color: '#9fe8ff', size: 30, dur: 0.9 });
    this.stats.grabEscapes = (this.stats.grabEscapes || 0) + 1;
    const m = e.move;
    if (m) { const ri = m.def.phases.findIndex((x) => x.rec); if (ri >= 0) { m.escaped = true; this.enterPhase(e, ri); } }
  }
  /** 敵が動作をやめた・倒れたなどで、つかみが解けた。 */
  releaseGrab(p, why) {
    p.grab = null;
    p.state = 'hurt'; p.stunT = 0.25; p.vx = 0; p.vy = 0; p.onGround = false; p.sup = null; p.inv = 0.8; p.gravMul = 1;
    this.onceAnim(p, 'hurt', 0.25);
  }
  /** 叩きつけ：口から主人公を地面へ叩きつける。 */
  dragSlam(e) {
    const p = this.player, m = e.move;
    if (!m || !m.grabbed || !p.grab || p.grab.owner !== e) return;
    const dir = e.facing;
    p.grab = null;
    const gs = m.def.grab || {};
    const d = Math.max(1, Math.round((gs.slamDmg || 14) * this.diff.enemyDmg * (gs.rage && e.rage ? e.rage.dmg : 1)));      // 版2.8：slamDmg＝叩きつけの強さ／rage＝怒り中は rage.dmg 倍
    p.x = clamp(e.x + dir * e.bw * 0.42, 60, W - 60); p.y = this.groundY; p.onGround = true; p.sup = 'ground'; p.vy = 0; p.gravMul = 1;
    this.lastHurtSrc = { by: e.type, mv: m.name };
    if (this.logHook) this.lg('hurt', { by: e.type, mv: m.name, dmg: d, hp: Math.round(Math.max(0, p.hp - d)), res: 'hit' });      // 版2.8：叩きつけのダメージも記録に残す（前は漏れていた）
    this.hurtPlayer(d, dir, 220, 0.9, 1.3);
    this.ring(p.x, this.groundY, { r0: 20, r1: 220, dur: 0.5, color: '#ffffff', flat: true, w: 12 });
    this.ring(p.x, this.groundY, { r0: 20, r1: 320, dur: 0.6, color: '#ffc27a', flat: true, w: 9 });
    this.dust(p.x - 60, this.groundY, 8, 120); this.dust(p.x + 60, this.groundY, 8, 120);
    this.sfx('slam'); this.sfx('quake', 0.6);
    this.shakeAdd(20); this.flashScreen('rgba(255,230,180,0.3)', 0.2);
    this.popup(clamp(p.x, 140, W - 140), p.y - p.bh - 30, 'SLAM!', { color: '#ff8a7a', size: 32 });
    this.stats.dragSlams = (this.stats.dragSlams || 0) + 1;
  }

  /** 版2.8：突進の一歩。足音・揺れ・土ぼこり・地面の小さな輪。主人公が地上で近く（ph.stumbleR px 以内）にいて、動ける状態（ガード中・攻撃中・やられ中でない）なら、少しよろける（ダメージなし・約 0.22 秒）。跳んでいれば影響なし。 */
  stepTremor(e, ph) {
    const p = this.player;
    this.sfx('step', 0.8, 0.9 + this.rand(0, 0.15));
    this.shakeAdd(ph.stepShake || 6);
    this.dust(e.x - e.facing * e.bw * 0.1, e.y, 5, 90); this.dust(e.x + e.facing * e.bw * 0.1, e.y, 3, 80);
    this.ring(e.x + e.facing * e.bw * 0.1, e.y, { r0: 10, r1: 150, dur: 0.3, color: '#d9c8a0', flat: true, w: 5 });
    this.stats.steps = (this.stats.steps || 0) + 1;
    if (!p || !this.playerAlive() || !p.onGround || p.state !== 'idle' || p.guarding || p.inv > 0) return;
    if (p.y < e.y - QUAKE.minDy) return;      // 点検と監修：よろけるのは地上の主人公だけ（足場の上＝足元から 90px 以上高い所は影響なし。仕様の「跳べばかわせる」と同じ）
    if (Math.abs(p.x - e.x) > (ph.stumbleR || 330) || (this.time || 0) < (p.stumbleUntil || 0)) return;
    const dir = sign(p.x - e.x) || -e.facing;
    p.state = 'hurt'; p.stunT = 0.22; p.vx = dir * 190; p.rp = null; p.repelT = 0; p.move = null; p.tele = false; p.chain = null;
    p.stumbleUntil = (this.time || 0) + 0.7;
    this.onceAnim(p, 'hurt', 0.22);
    this.stats.stumbles = (this.stats.stumbles || 0) + 1;
  }
  /** 版2.8：叩きつけ・噛み砕きの衝撃：地面を走る輪・大きな土ぼこり・岩の飛び散り・地面のひび・画面の揺れ。 */
  crunchImpact(x, e, k = 1) {
    const gy = this.groundY;
    this.ring(x, gy, { r0: 20, r1: 260 * k, dur: 0.5, color: '#fff3d0', flat: true, w: 11 });
    this.ring(x, gy, { r0: 20, r1: 380 * k, dur: 0.65, color: '#d9b27a', flat: true, w: 8 });
    this.dust(x - 80, gy, 9, 150 * k); this.dust(x + 80, gy, 9, 150 * k); this.dust(x, gy, 6, 100 * k);
    const n = Math.round(11 * k);
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + this.rand(-1.15, 1.15), sp = this.rand(380, 820) * (0.8 + 0.3 * k);
      this.fx.push({ type: 'rock', x: x + this.rand(-40, 40), y: gy - 12, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rot: this.rand(0, 6.28), vr: this.rand(-9, 9), size: this.rand(11, 26) * (0.9 + 0.2 * k), seed: this.rand(0, 1000), t: 0, dur: this.rand(1.1, 1.6), bounces: 0 });
    }
    const pts = [];
    for (let side = -1; side <= 1; side += 2) {      // 割れ目：中心から左右へ、ぎざぎざに伸びる（枝つき）
      let cx = x, cy = gy + 2;
      const len = this.rand(150, 230) * k, segs = 7;
      for (let s = 0; s < segs; s++) {
        const nx = cx + side * (len / segs) * this.rand(0.7, 1.3), ny = clamp(cy + this.rand(-9, 9), gy - 6, gy + 18);
        pts.push([cx, cy, nx, ny, 1 - s / segs]);
        if (s % 2 === 1) pts.push([nx, ny, nx + side * this.rand(18, 42), ny + this.rand(-16, 16), 0.5 * (1 - s / segs)]);
        cx = nx; cy = ny;
      }
    }
    this.fx.push({ type: 'crack', x, y: gy, segs: pts, t: 0, dur: 1.8 });
    this.shakeAdd(22 * Math.min(1.2, k)); this.flashScreen('rgba(255,230,180,0.22)', 0.16);
    this.stats.crunches = (this.stats.crunches || 0) + 1;
  }

  hurtPlayer(dmg, dir, kb, stun, inv = 1.5) {
    const p = this.player;
    if (this.phase === 'clear') dmg = Math.min(dmg, Math.max(0, p.hp - 1));      // API レビュー問題1：クリアしたあとは何に当たっても倒れない（体力 1 は残す）。壁の叩きつけ・地割れ・つかみなどで倒れると updatePhase が phase を gameover に書き換え、続けるで onClear が二重に走ってクリア点が二重に入った。溶岩・穴と同じ扱い
    p.hp = Math.max(0, p.hp - dmg);
    p.flash = 0.15; p.move = null; p.tele = false;
    p.hangT = 0; p.dashT = 0; p.guarding = false;
    for (const o of this.enemies) { o.cbN = 0; o.breakPending = false; }      // 主人公が被弾してコンボが切れたら、コンボ破りの数え直し
    this.endCombo();
    this.shakeAdd(8); this.addHitstop(0.07);
    p.chain = null;
    if (p.hp <= 0) {
      if (this.logHook) this.lg('stage', { k: 'down', i: this.stageIndex + 1, label: this.stage.label, dur: r1(this.stageT), by: this.lastHurtSrc ? this.lastHurtSrc.by : null, mv: this.lastHurtSrc ? this.lastHurtSrc.mv : null, maxCombo: this.stageMaxCombo, left: Math.round(this.timeLeft) });
      p.state = 'down'; p.vx = dir * 300; p.vy = -380; p.onGround = false; p.sup = null; p.downT = 0;
      if (BOSS_FIX.on) { p.grab = null; p.slamArm = null; }      // 2026-11-14：くわえられたまま（時間切れの体力減少で）力尽きたら、つかみを解く。前は残ったつかみで、倒れた主人公にもう一度叩きつけ（倒れの記録・効果音が二重・GAME OVER が約 2.4 秒遅れる）
      p.lavaArc = null;      // 版3.8b：溶岩から弾かれている最中に（時間切れの体力減少などで）力尽きたとき、弧の印が残ると物理が止まって倒れたまま GAME OVER に進めなかった
      this.onceAnim(p, 'down');
      this.sfx('playerDown');
      this.emit({ type: 'bgm', name: null });
    } else {
      p.state = 'hurt'; p.stunT = stun; p.vx = dir * kb; p.inv = inv;
      p.rp = null; p.repelT = 0; if (HURT_JITTER.on) p.shakeAmp = HURT_JITTER.amp;
      this.onceAnim(p, 'hurt', Math.max(0.25, stun));
    }
  }

  // ---- 効果の更新 ----
  updateFx(dt) {
    for (const f of this.fx) {
      f.t += dt;
      if (f.type === 'mark' && f.t < f.follow && this.player) f.x += (this.player.x - f.x) * Math.min(1, dt * 6);      // 版2.7：目印は最初のあいだ主人公を追う
      if (f.type === 'rock') {      // 版2.8：飛び散る岩：重力で落ち、地面で 2 回まで弾み、止まったら少し残って消える
        f.rot += f.vr * dt;
        if (f.rest) continue;
        f.vy += 1500 * dt; f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.y >= this.groundY - 2 && f.vy > 0) {
          f.y = this.groundY - 2; f.bounces++;
          if (f.bounces > 2 || f.vy < 160) { f.rest = true; f.vx = 0; f.vy = 0; f.vr = 0; f.t = Math.max(f.t, f.dur - 0.5); }
          else { f.vy *= -0.38; f.vx *= 0.6; f.vr *= 0.5; }
        }
      }
      if (f.type === 'dust') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 200 * dt; f.vx *= 1 - Math.min(1, dt * 3); }
      else if (f.type === 'ember') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 1100 * dt; f.vx *= 1 - Math.min(1, dt * 1.2); }      // 版3.5：溶岩のしぶき
      else if (f.type === 'drop') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 1500 * dt; }      // 版3.0：水しぶきの水滴
      else if (f.type === 'bubble') { f.y += f.vy * dt; f.x += Math.sin(f.t * 7 + f.r) * 14 * dt; if (this.water && f.y < this.water.y) f.t = f.dur; }      // 版3.0：水中の泡（水面で消える）
    }
    this.fx = this.fx.filter((f) => f.t < f.dur);
    if (this.fx.length > 400) this.fx.splice(0, this.fx.length - 400);
    for (const t of this.texts) { t.t += dt; t.y += t.vy * dt; t.vy *= 1 - Math.min(1, dt * 2); }
    this.texts = this.texts.filter((t) => t.t < t.dur);
    this.shake *= Math.exp(-dt * 9);
    if (this.shake < 0.2) this.shake = 0;
    if (this.flashFx) { this.flashFx.t += dt; if (this.flashFx.t >= this.flashFx.dur) this.flashFx = null; }
  }

  // ---- 読み取り用の状態（window.__game 用） ----
  snapshot() {
    const p = this.player;
    return {
      stage: this.stageIndex + 1, phase: this.phase, score: this.score, combo: this.combo,
      camY: +this.camY.toFixed(1), rise: this.rise || 0, sink: this.sink || 0, water: this.water ? this.water.y : null, platforms: this.platforms.map((q) => ({ x: q.x, y: q.y, w: q.w })),      // 版2.3：カメラと足場（読み取り用）
      player: p ? { x: Math.round(p.x), y: Math.round(p.y), hp: p.hp, gauge: Math.round(p.gauge), state: p.state, onGround: p.onGround, airJumps: p.airJumps,
        move: p.move ? p.move.name : null, phase: p.move ? p.move.i : null, vx: Math.round(p.vx), vy: Math.round(p.vy), facing: p.facing,
        dash: p.dashT > 0, guard: !!p.guarding, hang: p.hangT > 0, swim: !!p.swim, wet: !!p.wet, grab: p.grab ? { got: p.grab.got, need: p.grab.need } : null } : null,
      enemyCount: this.aliveCount(),
      bombs: this.bombs.map((b) => ({ x: Math.round(b.x), state: b.state })),      // 版2.7：火山弾（読み取り用）
      purge: this.purge ? { t: +this.purge.t.toFixed(2), r: Math.round(this.purgeRadius()) } : null,      // 版2.2：衝撃の輪（読み取り用）
      waves: this.waves.map((w) => ({ x: Math.round(w.x), y: Math.round(w.y), dir: w.dir })),
      enemies: this.enemies.map((e) => ({ type: e.type, x: Math.round(e.x), y: Math.round(e.y), vx: Math.round(e.vx), vy: Math.round(e.vy), hp: e.hp, state: e.state, tele: !!e.tele, move: e.move ? e.move.name : null, counter: !!e.breaking, guard: !!e.guarding, wake: (e.wakeInv || 0) > 0, rage: !!e.rage, gauge: Math.round(e.gauge || 0), purged: !!e.purged })),
    };
  }
}
