// 版3.1：面エディタの「ジャンプのガイド」の計算（画面や DOM は触らない）。
// 数は src/world.js のジャンプの定数（重力 GRAV・初速 JUMP_V と BIG_JUMP.v・歩く速さ PLAYER_SPEED）から取る＝独自に決め打ちしない。
// 動かし方は world.js と同じ（1/60秒の刻みで、縦は「重力を足してから位置を進める」、横は空中の操作で目標の速さへ寄る）。
// 実際のキー入力で測った高さ・距離と ±5% で合うことは、tools/editor_test.mjs が確かめる。
//
//   ふつうのジャンプ：飛び出しの横の速さ＝歩く速さ（PLAYER_SPEED=380）。空中で動き続けると、横の速さは PLAYER_SPEED×0.9 へ 1/6 ずつ寄る（src/world.js playerFree）。
//   大ジャンプ：↓を押してから ↑＋ジャンプ。飛び出しの瞬間は止まっていて（ため）、飛び出しの次の1コマだけ目標 0.85倍・係数 0.2 で寄り、重力も 0.4倍（技の最中）。
//             そのあとはふつうの空中の操作（0.9倍・1/6）。縦の初速は BIG_JUMP.v。
//   着地：落ちている途中で足の高さが足場の上面を越えた所。足場の左右は 10px の余裕がある（world.js landingSurface）。
import { GRAV, JUMP_V, BIG_JUMP, PLAYER_SPEED, AIR_ATTACK_GRAV } from './world.js';

export const DT = 1 / 60;
// 検査を実際の軌道に合わせた（Nao「実際に合わせて」）：検査・エディタ・主人公の届きの基準は、この下の reachGap／canJump の1か所。layout.js の reachSetOf・check.mjs・面エディタが使う。
//   高さの上限＝頂点（207・401）から安全の余裕を引いた値（変えない：ふつう190・大360）。横の上限＝高さごとの実際の軌道（足場の左右の着地の余裕 LAND_TOL を含む）。
//   敵（HOP）の跳びは別の表（world.js の hopEdge・HOP の定数）で、ここは使わない。
export const JUMP_REACH = 190, BIG_REACH = 360;
export const AIR_VX = PLAYER_SPEED * 0.9;          // 空中で動き続けたときの横の最高速（342）
export const AIR_RATE = 1 / 6;                      // 1コマで目標へ寄る割合（dt×10）
export const MOVE_VX = PLAYER_SPEED * 0.85, MOVE_RATE = 0.2;      // 技（大ジャンプ）の飛び出しの1コマ
export const LAND_TOL = 10;                         // 足場の左右の着地の余裕（px）
export const BODY = { w: 230, h: 145 };             // 主人公の体の大きさ（世界の px。world.js の p.bw・p.bh）
export const RULER_Y = [50, 100];                   // ものさしの目盛り（高さ px）

/**
 * 1回のジャンプの軌道。kind＝'normal'|'big'、dir＝+1(右)|-1(左)。
 * 戻り値 pts＝[{t, x, up}]（x＝出発点からの横の距離 dir 向きに正、up＝出発の足の高さからの上向きの高さ）。up が −limit を下回るまで。
 */
export function trajectory(kind, dir = 1, limit = 520) {
  const big = kind === 'big';
  let x = 0, up = 0, vx = big ? 0 : PLAYER_SPEED, vy = big ? BIG_JUMP.v : JUMP_V;      // 画面の上向きは vy が負
  const pts = [{ t: 0, x: 0, up: 0 }];
  for (let f = 0; f < 600; f++) {
    if (f > 0) {
      if (big && f === 1) vx += (MOVE_VX - vx) * MOVE_RATE;
      else vx += (AIR_VX - vx) * AIR_RATE;
    }
    vy += GRAV * (big && f === 1 ? AIR_ATTACK_GRAV : 1) * DT;      // 大ジャンプの飛び出しの次の1コマだけ、技の最中の空中の重力（0.4倍）
    x += vx * DT; up -= vy * DT;
    pts.push({ t: (f + 1) * DT, x: dir * x, up });
    if (f > 5 && up < -limit) break;
  }
  return pts;
}

const cache = new Map();
/** 軌道の数値（右向き）。apexUp＝頂点の高さ／apexDx＝頂点までの横／landDx＝同じ高さへ戻るまでの横／apexT・airT＝秒。 */
export function stats(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const pts = trajRight(kind);
  let ia = 0;
  pts.forEach((p, i) => { if (p.up > pts[ia].up) ia = i; });
  const land = crossDown(pts, ia, 0);
  const s = { apexUp: pts[ia].up, apexDx: pts[ia].x, apexT: pts[ia].t, landDx: land.x, airT: land.t };
  cache.set(kind, s);
  return s;
}

function crossDown(pts, from, h) {      // 頂点のあと、高さ h を下へ越える点（直線で補う）
  for (let i = Math.max(from, 1); i < pts.length; i++) {
    if (pts[i].up <= h && pts[i - 1].up > h) {
      const a = pts[i - 1], b = pts[i], k = (a.up - h) / (a.up - b.up);
      return { x: a.x + (b.x - a.x) * k, t: a.t + (b.t - a.t) * k };
    }
  }
  const l = pts[pts.length - 1]; return { x: l.x, t: l.t };
}

/**
 * 出発点の h(px) 上にある足場の上面へ着地できる横の距離の最大。h が頂点より高ければ null（届かない）。
 * h が負（足場が出発点より低い）でもよい（その高さまで落ちるまでに進む距離）。
 */
const trajCache = new Map();
function trajRight(kind) { if (!trajCache.has(kind)) trajCache.set(kind, trajectory(kind, 1)); return trajCache.get(kind); }
export function maxDx(kind, h) {
  const pts = trajRight(kind), st = stats(kind);
  if (h > st.apexUp) return null;
  const ia = pts.findIndex((p) => p.up === st.apexUp);
  return crossDown(pts, ia, h).x;
}

/** 左右どちらの向きでも同じ（鏡）。 */
export const apexUp = (kind) => stats(kind).apexUp;

/**
 * 乗れる範囲の外周（頂点から出発の高さまで、右半分）。[{dx, up}]。左は dx を反転。
 * 頂点から下へ、足場の高さ h ごとの「着地できる最大の横」。下限 floor（負の高さ）まで。
 */
export function envelope(kind, floor = 0, step = 4) {
  const st = stats(kind), out = [];
  for (let h = st.apexUp; h >= floor - 1e-6; h -= step) out.push({ dx: maxDx(kind, h), up: h });
  const last = out[out.length - 1];
  if (!last || last.up > floor) out.push({ dx: maxDx(kind, floor), up: floor });
  return out;
}

export const REACH_CAP = { normal: JUMP_REACH, big: BIG_REACH };
/** reachSetOf などが受ける「高さの数（JUMP_REACH／BIG_REACH）」か種類の名前から、種類（'normal'|'big'）にする。 */
export const kindOfReach = (r) => (r === 'big' || (typeof r === 'number' && r > JUMP_REACH) ? 'big' : 'normal');

/**
 * 足場の上面が出発点の up(px) 上にあるとき、足場の端どうしの横の隙間がいくつまでなら跳び移れるか（検査の基準）。
 * ＝その高さへ着地できる最大の横 maxDx（実際の軌道）＋足場の左右の着地の余裕 LAND_TOL。高さの上限（JUMP_REACH／BIG_REACH）を超えるなら null。
 * 下の足場（up が負）は、その高さまで落ちる間に進む距離（-500 より下は -500 の値で代用＝短めに見る）。
 */
export function reachGap(kind, up) {
  if (up > REACH_CAP[kind]) return null;
  const d = maxDx(kind, Math.max(up, -500));
  return d === null ? null : d + LAND_TOL;
}
/** 1回の跳びで届くか（検査の式）。gap＝足場の端どうしの隙間、fromGround＝出発点が地面（横の制限なし）。 */
export function canJump(kind, up, gap, fromGround = false) {
  if (up > REACH_CAP[kind]) return false;
  if (fromGround) return true;
  const g = reachGap(kind, up);
  return g !== null && gap <= g;
}

/**
 * 出発点 src から足場 plat の上面へ跳び移れるか。
 *   src＝{x, y, w?, ground?}（w が無ければ点。ground:true なら地面＝横の制限なし。検査と同じ）。plat＝{x, y, w}。y は世界の座標（下向きに大きい）。
 *   check＝検査（tools/check.mjs・reachSetOf）と同じ判定（canJump）：'normal'|'big'|'none'。高さは JUMP_REACH(190)・BIG_REACH(360)、横は高さごとの実際の軌道。
 *   phys＝高さの余裕を引かない素の軌道で届くか（足場の左右 10px の余裕を含む）。check との違いは高さの余裕だけ。
 */
export function judge(src, plat) {
  const sw = src.w || 0;
  const gap = Math.max(0, Math.max(plat.x - (src.x + sw), src.x - (plat.x + plat.w)));
  const up = src.y - plat.y;
  let check = 'none';
  for (const kind of ['normal', 'big']) if (canJump(kind, up, gap, !!src.ground)) { check = kind; break; }
  let phys = 'none';
  const g2 = Math.max(0, gap - LAND_TOL), g2s = src.ground ? 0 : g2;
  for (const kind of ['normal', 'big']) {
    const d = maxDx(kind, up);
    if (d !== null && g2s <= d) { phys = kind; break; }
  }
  return { check, phys, gap, up };
}

/** 逆向き：点 (tx, ty)（足の位置）に乗るために跳べる出発の範囲。高さ h 下から、横 ±maxDx(h)。[{up, dx}] を kind ごとに返す。 */
export function sourceBand(kind, floor = 0) {
  return envelope(kind, floor);
}

/** 目盛り（高さ px）と名前。ものさし用。 */
export function rulerMarks() {
  return [
    { up: RULER_Y[0], label: '50px' }, { up: RULER_Y[1], label: '100px' },
    { up: Math.round(stats('normal').apexUp), label: 'ふつうのジャンプの最大', kind: 'normal' },
    { up: Math.round(stats('big').apexUp), label: '大ジャンプの最大', kind: 'big' },
  ];
}
