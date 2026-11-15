// 版1.1b：主人公の必殺技（cost のある行・ダッシュ体当たり・衝撃波）が敵をひるませる・気絶させる長さの倍率。1 で元どおり。前 1.0 → 後 0.5。
// 版1.1b：衝撃波系（咆哮・急降下の着地・床を走る衝撃波・叩きつけの輪など、体から離れて広がる判定）の範囲の倍率。判定の箱・輪の大きさ・衝撃波の走る距離がいっしょに変わる。1 で元どおり。前 1.0 → 後 0.5。
export let PLAYER_WAVE_RANGE = 0.5;
export function setPlayerWaveRange(v) { PLAYER_WAVE_RANGE = v; }      // 試験用
// 版1.2：咆哮だけ、さらに範囲を縮める倍率（主人公用・敵用の1か所ずつ）。上の PLAYER_WAVE_RANGE（衝撃波系ぜんぶ）に重ねて掛かる＝主人公の咆哮は 元 × 0.5 × 0.5。
//   主人公用＝技の表の咆哮の当たり（roar:true）の箱・咆哮の輪／敵用＝ティラノの咆哮の輪・ライバルの咆哮の輪（判定）・スケルトンの召喚の輪。判定の箱（輪）と見た目の輪を同じ倍率で縮める。1 で元どおり。前 1.0 → 後 0.5。
export let PLAYER_ROAR_SCALE = 0.5;
export function setPlayerRoarScale(v) { PLAYER_ROAR_SCALE = v; }      // 試験用
export let ENEMY_ROAR_SCALE = 0.5;
export function setEnemyRoarScale(v) { ENEMY_ROAR_SCALE = v; }      // 試験用
// 版1.1b：衝撃波系だけを繰り返してはめ続けられないための歯止め（全部の敵に効く）。
//   immuneT＝衝撃波系に当たった敵が、同じ系統の衝撃でひるまない・浮かない秒数（ダメージは chip 倍だけ入る）／afterT＝飛ばされて倒れた敵が動けるようになってから、さらに同じ系統を受け付けない秒数（倒れている間にタイマーが切れて、立った瞬間にまた飛ばされるのを防ぐ）
//   costStep・costWin・costMax＝ゲージを使う衝撃波系（family:'wave'）は、costWin 秒以内に使った回数 n に応じて消費が (1+costStep×n) 倍（n は costMax まで）
export const WAVE_LOCK = { immuneT: 1.5, afterT: 2.0, chip: 0.3, costStep: 0.5, costWin: 4.0, costMax: 4 };
export let PLAYER_SPECIAL_STUN = 0.5;
export function setPlayerSpecialStun(v) { PLAYER_SPECIAL_STUN = v; }      // 試験用（陰性対照）
// 版1.1c：主人公の必殺技がひるませる確率（ひるむときの長さは上の PLAYER_SPECIAL_STUN 倍）。1 で必ずひるむ・0 で一度もひるまない。通常技は確定のまま。
export let PLAYER_SPECIAL_STUN_CHANCE = 0.4;
export function setPlayerSpecialStunChance(v) { PLAYER_SPECIAL_STUN_CHANCE = v; }      // 試験用（陰性対照）
// 版2.4：敵の突進（until:'wall'）が主人公に当たらずに壁へ激突したとき、目を回す確率。1 で必ず・0 で一度も回さない。主人公に当たった（ダメージ・ガード）突進は、壁に当たっても目を回さない。
export let ENEMY_CRASH_STUN_CHANCE = 0.5;
// 版2.4：敵が「ダウン」（吹き飛んで着地したあと地面に倒れる）までに必要なヒット数（ダウン値）。倒れるのは、その敵に当てた累計ヒット数が need 以上のときだけ。足りなければ着地でよろけて立つ（吹き飛び・打ち上げ・コンボのつながりは今までどおり）。
//   forgetT＝当てられずに動けるまま過ごすと累計を忘れる秒数。体力（倒すまでの量）・ボス級の重さ／アーマーはこの値とは別（ボス級はもともと着地で倒れない）。need=1 で版2.3 までと同じ（吹き飛んだら必ず倒れる）。
export const ENEMY_DOWN = { need: 17, forgetT: 2.5 };      // 版2.6：20 → 17。打ち上げを半分の高さにしたら、敵が着地するまでに当てられるヒットが減り、『倒れるまでのヒット数が約2倍』(v24_test W9)が 2.55 倍に開いた。比を前（2.2 倍）に戻す値
export function setEnemyDownNeed(v) { ENEMY_DOWN.need = v; }      // 試験用（陰性対照・前後の比べ）
export function setEnemyCrashStunChance(v) { ENEMY_CRASH_STUN_CHANCE = v; }      // 試験用（陰性対照）
// 主人公の技の表。1つの技 = 1つの行。ここに行を足せば技が増える（コードは触らない）。
//
// ■ 行の項目
//   name        技の名前（表示・検査用。ポーズの技表にそのまま出る）
//   desc        技表に出るひとこと説明（日本語・1行。技を足したら必ず書く＝tools/pause_test.mjs が見ている）。
//               技表（src/movelist.js）はこの表から自動で作る：分類は action 行→「移動とガード」、cost>0→「必殺」、ctx:'air'→「空中」、それ以外→「地上」。コマンド・ゲージ量・出せる条件も input/cost/from/requires から読む
//   input       入力。書き方は src/commands.js の先頭を見る
//                 'attack' / 'up+attack' / 'down,forward+attack'（↓→+Z）/ 'down,downforward>0.04,forward+attack'（↓↘→+Z）
//                 'forward,forward'（→→）/ 'down,down+attack'（↓↓+Z）/ 'back>0.6,forward+attack'（溜め）/ 'attack+jump'（同時押し）/ 'attack>0.6'（ボタン溜め）
//   ctx         出せる場所: 'ground'（地上）/ 'air'（空中）/ 'any'
//   from        null=いつでも / ['bite'] = その技の直後（またはその技のキャンセル）だけ＝連続技のつなぎ
//   requires    追加の条件: 'platform'（足場の上）/ 'airjump'（空中ジャンプが残っている）/ 'dash'（ダッシュ中＝→→の直後0.5秒）/ 'guard'（ガード成立の直後約0.17秒）
//   fromHurt    true なら、やられて動けない間（被弾の硬直）からも出せる（咆哮）
//   priority    入力の複雑さに足す優先度（同じ入力の行が重なるとき、大きいほど先）
//   cost        ゲージ消費（0〜100）。cost>0 は「CP必殺」＝ガード貫通・必殺の相殺扱い。急降下のように「消費だけ」したいときは cost でなく energy を使う
//   energy      'dive'＝出した瞬間に tune.js の DIVE_CP×スライダー diveCp だけ CP を使う（足りないと出ない）。必殺扱いにはならない
//   frames      使うコマ。assets/motion_map.js の MOVE_FRAMES のキー（省略時は行の名前）。コマの差し替えは motion_map.js の1行
//   t           各区間の秒数（コマの区間 MOVE_FRAMES の f と同じ数）
//   lunge/vx/vy/sfx/ev/until/pose   区間ごとの設定 {区間番号: 値}
//                 lunge=前へ進む距離px、vx=前向き速度、vy=縦の速さ（正=下。毎コマこの速さに固定＝急降下）、sfx=効果音、ev=イベント名、
//                 until='wall'（壁に当たるまで）/ 'ground'（着地するまで）、
//                 pose={tilt:体の傾き(rad・向き基準・正=頭が下), jitter:震え(px), spin:{from,to}=区間内で緩急つきに回す(rad・正=前方宙返り)}  … 専用の絵が無い技を傾きと震えで見せる（描画だけ）
//   inv/float   区間番号の配列（無敵／重力を切って空中でまっすぐ）
//   hits        当たり判定の配列 [{ at: 区間番号, box: [x0, x1, y0, y1], dmg, kb, stun, gauge, stop, shake, sfx, spark, bounce, breakGuard, both, launch, rise }]
//                 box は体の大きさ基準: x=体の半幅の倍数（前向き・中心から）、y=体高の倍数（地面から上が＋、足より下は−）
//                 stop=ヒットストップ(秒)  bounce=当てた側が浮く速さ（空中で当てたときだけ）  both=前後両方
//                 rise=true … 昇りの当たり。空中で当てると自分も敵もいっしょに上へ運ばれ、ある高さで「頂点の静止」に入る
//                 launch={vx,vy,grav, float, spike, bounce, facing}  吹き飛ばしの向きと強さ
//                   vx: 敵を「主人公から遠ざかる向き」へ飛ばす速さ（負なら引き寄せ。facing:true なら主人公の向き基準）
//                   vy: 負=上、正=下。 grav: 重力の倍率（小さいほどふわっと） float: 浮かせる（ボスは浮かない）
//                   spike: 叩き落とし（地面で跳ね返って追撃できる。ボスには効かない） bounce: 地面で跳ね返る強さ（0〜1）
//   proj        飛び道具（ev で 'spawnWave' を出す区間で生まれる）{ speed, life, w, h, hit:{…hits と同じ項目} }
//   cancel      { when: 'hit'|'recovery'|'both', into: [技の id…] }  いつ・どの技へ打ち切れるか（当たった後／後半）
//   cat         技表の分類を指定する（'move' など。省略すると action 行→移動、cost>0→必殺、ctx:'air'→空中、残り→地上）
//   action      技ではなく動作の行: 'jump'（ジャンプ）/ 'airjump'（空中ジャンプ）/ 'drop'（足場から降りる）/ 'dash'（ダッシュ）/ 'fall'（空中で素早く落ちる）
//
// 新しい技の足し方: ① MOVE_FRAMES（motion_map.js）に同じ名前でコマの区間を足す ② ここに1行足す ③ node tools/check.mjs
// 同じ入力の行が重なる場合は「入力が複雑なほど」「from がある行ほど」優先される。
import { parseInput } from './commands.js';
import { DIVE_CP } from './tune.js';      // 2026-11-15：技表の急降下の説明・CP 欄の数字を DIVE_CP から作る（Nao「おすすめで」＝説明を動きに合わせる）

// 必殺（ゲージ技）は、ほとんどの地上技の途中からキャンセルで出せる。
const SPECIALS = ['roar', 'shockwave', 'maul', 'special'];
// 空中の技どうしのつなぎ（昇り・締め・急降下）。
// 版2.8：空中で連打すると 噛みつき → 右の爪 → 左の爪 → 噛みつき … と循環する（昇りは riseClawR・riseClawL、ふつうの空中は airClawR・airClawL）。
const AIR_FOLLOW = ['rise', 'riseClawR', 'riseClawL', 'airTail', 'air', 'airClawR', 'airClawL', 'spike', 'dive', 'airjump', 'special'];

export const PLAYER_MOVES = {
  // ---- 動作 ----
  jump:    { name: 'ジャンプ', desc: 'ジャンプする。足場にも乗れる。水の中では上へ泳ぎ、水面の近くなら水面を突き破って飛び出す（水の中は ←→↑↓ で泳ぐ）。', input: 'jump', ctx: 'ground', action: 'jump' },
  drop:    { name: '足場から降りる', desc: '足場の上から、下の段へ降りる。', input: 'down+jump', ctx: 'ground', requires: 'platform', action: 'drop' },
  // 大ジャンプ（↓を押した状態から ↑＋ジャンプ）：深くしゃがんで力をため、ふつうの約1.9倍の高さまで跳ぶ（高い足場へ）。
  // ↓＋ジャンプ（足場から降りる）とは、↑ が押されているかで区別する（↑ を足すと大ジャンプが優先・↑ が無ければ降りる）。
  // 入力は 'down*,up+jump'（* は押したままでよい）＝↓を押してから、↑ とジャンプを押す（↓を押したまま ↑＋ジャンプ／↓→↑ とすばやく入れてジャンプ、どちらでも出る）。
  bigJump: {
    name: '大ジャンプ', desc: '↓を押してから ↑＋ジャンプ。深くしゃがんでためてから、ふつうの倍近く高く跳ぶ。高い足場へ。', input: 'down*,up+jump', ctx: 'ground', from: null, cost: 0, priority: 5,
    cat: 'move', frames: 'bigJump', t: [0.17, 0.017], ev: { 1: 'bigJump' }, sfx: { 0: 'whoosh' },
    pose: { 0: { tilt: 0.1, jitter: 1.2 } },
    cancel: null,
  },
  // 空中で攻撃が当たると1回ぶん戻る。（ジャンプボタンで追う旧来のやり方。上を押しながら攻撃する「昇り」が本線）
  airjump: { name: '空中ジャンプ', desc: '空中でもう一度跳ぶ。最初は使えず、空中で攻撃を当てると、もう一度だけ跳べる（最大1回）。', input: 'jump', ctx: 'air', requires: 'airjump', action: 'airjump' },
  // 空中で ↓＋ジャンプ：その場から素早く落ちる（急降下の足早版。攻撃は出さない）。
  fall:    { name: '素早く降りる', desc: '空中で素早く真下へ落ちる（攻撃は出ない）。', input: 'down+jump', ctx: 'air', action: 'fall' },
  // ダッシュ：←← / →→。最高速が上がり、約0.5秒で元に戻る。この間に攻撃ボタンを押すとダッシュ攻撃。
  dash:    { name: 'ダッシュ', desc: '素早く2回で走り出す。約0.5秒のあいだ攻撃で体当たりになる。', input: 'forward,forward', ctx: 'ground', action: 'dash' },

  // ---- 地上の連続技（攻撃ボタン1つ）：噛みつき → 爪 → 爪（少し浮かせる・前の段が当たったときだけ）→ 尻尾のなぎ払い（壁へ飛ばす）----
  bite: {
    name: 'かみつき', desc: 'ふつうの噛みつき。当てながら連打すると 爪 → 爪 → 尻尾 とつながる。', input: 'attack', ctx: 'ground', from: null, cost: 0,
    frames: 'bite', t: [0.11, 0.10, 0.19], lunge: { 1: 26 }, sfx: { 1: 'bite' },
    hits: [{ part: 'mouth', at: 1, box: [0.25, 1.75, 0, 1.05], dmg: 9, kb: 230, stun: 0.34, gauge: 6, stop: 0.05, sfx: 'bite', spark: 'bite' }],
    cancel: { when: 'both', into: ['scratch', 'launcher', 'uppercut', 'trip', 'jump', 'bigJump', ...SPECIALS] },
  },
  scratch: {
    name: '右の爪', desc: '手前の腕で斜め下へ引っかく。続けて左の爪へつながる。', input: 'attack', ctx: 'ground', from: ['bite'], cost: 0,
    // 版2.4：腕を頭の上まで振りかぶる（0）→ 体ごと踏み込んで振り抜く（1）→ 振り抜いた形で一瞬止める＝当たり（2）→ 戻り（3）。合計 0.36 秒は元のまま
    frames: 'scratch', t: [0.06, 0.04, 0.07, 0.19], lunge: { 1: 30 }, sfx: { 1: 'scratch' }, ev: { 1: 'clawR' },
    hits: [{ part: 'claw', at: 2, box: [0.25, 1.75, 0, 1.05], dmg: 9, kb: 260, stun: 0.34, gauge: 6, stop: 0.08, shake: 5, sfx: 'scratch', spark: 'slash' }],
    cancel: { when: 'both', into: ['scratch2', 'launcher', 'uppercut', 'trip', 'jump', 'bigJump', ...SPECIALS] },
  },
  // 3段目：もう一度爪。頭を少し上げて下から掬い上げ、敵を少し浮かせる（前の段が当たったときだけ出る＝fromHit）。
  // 2段目と見分けがつくように、絵の区間（アーチ状の弧が焼き込まれた11〜13コマを避けて 3〜9→9〜10→14〜）・体を頭上がりに傾ける・当たりの前進・威力が違う。
  scratch2: {
    name: '左の爪（浮かせ）', desc: '奥の腕で下から掬い上げ、敵を少し浮かせる。', input: 'attack', ctx: 'ground', from: ['scratch'], fromHit: true, cost: 0,
    // 版2.4：奥の腕を低く引く（0）→ 踏み込んで頭の高さまで掬い上げる（1）→ 振り上げた形で一瞬止める＝当たり（2）→ 戻り（3）。合計 0.35 秒は元のまま
    frames: 'scratch2', t: [0.05, 0.05, 0.09, 0.16], lunge: { 0: 6, 1: 34 }, sfx: { 1: 'scratch' }, ev: { 1: 'clawL' },
    pose: { 0: { tilt: 0.05 }, 1: { tilt: -0.08 }, 2: { tilt: -0.08 }, 3: { tilt: -0.03 } },   // 絵（ScratchL2）が低く引いて掬い上げるので、傾きは控えめ
    hits: [{ part: 'claw', at: 2, box: [0.25, 1.75, 0, 1.15], dmg: 10, kb: 0, stun: 0.5, gauge: 7, stop: 0.09, shake: 5, sfx: 'scratch', spark: 'slash',
      launch: { vx: 110, vy: -260, grav: 0.55, float: true } }],
    cancel: { when: 'both', into: ['finisher', 'launcher', 'uppercut', 'trip', 'jump', 'bigJump', ...SPECIALS] },
  },
  // 締め（方向なし）：尻尾のなぎ払い。敵を横へ一直線に吹き飛ばす（壁で跳ね返る）。
  finisher: {
    name: '尻尾のなぎ払い', desc: '尻尾で横へ薙ぎ払い、敵を壁まで吹き飛ばす締め。', input: 'attack', ctx: 'ground', from: ['scratch2'], cost: 0,
    frames: 'finisher', t: [0.15, 0.11, 0.30], lunge: { 0: 30, 1: 70 }, sfx: { 1: 'scratch' }, ev: { 1: 'finisherFx' },
    pose: { 0: { turn: true }, 1: { turn: true }, 2: { turn: true } },   // 尻尾は絵の後ろ側に伸びるので、敵に背を向けて（絵を反転して）振る＝尻尾の先が敵に届く
    hits: [{ part: 'tail', at: 1, box: [0.2, 2.0, -0.05, 1.15], dmg: 14, kb: 0, stun: 0.5, gauge: 10, stop: 0.12, shake: 9, sfx: 'scratch', spark: 'big',
      launch: { vx: 1240, vy: -160, grav: 0.5 } }],
    cancel: { when: 'hit', into: ['bite', 'launcher', 'uppercut', ...SPECIALS, 'jump', 'bigJump'] },
  },

  // ---- 地上の単発 ----
  // 下段テイルウィップ（↓＋攻撃）：低くかがんで尻尾で足元をなぎ払う（元のゲームの下段回し蹴りに当たる）。当たると敵が少し浮く。
  // 尻尾は絵の後ろ側に伸びるので、締めと同じく敵に背を向けて（絵を反転して）振る。
  trip: {
    name: '下段テイルウィップ', desc: '低くかがんで尻尾で足元をなぎ払う。当たると敵が少し浮く。', input: 'down+attack', ctx: 'ground', from: null, cost: 0,
    frames: 'trip', t: [0.14, 0.16, 0.24], lunge: { 1: 30 }, sfx: { 1: 'scratch' },
    pose: { 0: { turn: true }, 1: { turn: true }, 2: { turn: true } },
    hits: [{ part: 'tail', at: 1, box: [0.3, 2.1, -0.05, 0.42], dmg: 8, kb: 0, stun: 0.5, gauge: 6, stop: 0.07, shake: 4, sfx: 'scratch', spark: 'slash',
      launch: { vx: 160, vy: -330, grav: 0.55, float: true } }],
    cancel: { when: 'both', into: ['launcher', 'uppercut', 'bite', 'jump', 'bigJump', ...SPECIALS] },
  },
  // 打ち上げ（↑＋攻撃）：敵を浮かせ、自分も跳び上がる。このあと上を押したまま攻撃を続けると「昇り」。
  launcher: {
    name: '打ち上げ', desc: '敵を浮かせて自分も跳ぶ。上を押したまま攻撃で「昇り」へ。', input: 'up+attack', ctx: 'ground', from: null, cost: 0,
    frames: 'launcher', t: [0.10, 0.14, 0.22], sfx: { 1: 'scratch' }, ev: { 1: 'hopUp' },
    // 絵（Uplift・本物の突き上げ）が頭を上げるので傾きは掛けない
    hits: [{ part: 'mouth', at: 1, box: [0.1, 1.55, 0, 1.3], dmg: 7, kb: 0, stun: 0.5, gauge: 6, stop: 0.09, shake: 5, sfx: 'scratch', spark: 'slash',
      launch: { vx: 110, vy: -540, grav: 0.5, float: true } }],
    cancel: { when: 'both', into: AIR_FOLLOW },
  },
  // 頭突きの突き上げ（↑↑＋攻撃）：打ち上げより強く真上へ。空中コンボの起点。
  uppercut: {
    name: '頭突きの突き上げ', desc: '真上へ強く突き上げる。空中コンボの起点。', input: 'up,up+attack', ctx: 'ground', from: null, cost: 0,
    frames: 'uppercut', t: [0.09, 0.12, 0.24], sfx: { 1: 'scratch' }, ev: { 1: 'hopUp' },
    // 絵（Uplift・本物の突き上げ）が頭を上げるので傾きは掛けない
    hits: [{ part: 'mouth', at: 1, box: [0.0, 1.4, 0, 1.5], dmg: 11, kb: 0, stun: 0.5, gauge: 8, stop: 0.1, shake: 6, sfx: 'scratch', spark: 'big',
      launch: { vx: 70, vy: -640, grav: 0.5, float: true } }],
    cancel: { when: 'both', into: AIR_FOLLOW },
  },
  // ガード（↓を押し続ける）が成立した直後に攻撃：尻尾を回して突進する。前後どちらの敵にも当たる。
  guardSpin: {
    name: '尻尾の回転（ガード返し）', desc: 'ガードが決まった直後に、尻尾を回して突進。前後の敵を吹き飛ばさず、その場で長くよろけさせる＝噛みつき・打ち上げでコンボにつなげる。', input: 'down+attack', ctx: 'ground', requires: 'guard', priority: 10, cost: 0,
    frames: 'guardSpin', t: [0.07, 0.24, 0.20], vx: { 1: 520 }, inv: [0, 1], sfx: { 1: 'scratch' }, ev: { 1: 'finisherFx' },
    pose: { 1: { tilt: -0.08 } },
    hits: [{ part: 'area', fit: true, at: 1, box: [-2.0, 2.0, -0.05, 1.1], both: true, dmg: 13, kb: 60, stun: 1.0, gauge: 10, stop: 0.1, shake: 7, sfx: 'scratch', spark: 'big' }],      // 版2.4：吹き飛ばさない。その場で長めによろけさせ、噛みつきの4段・打ち上げ・昇りへつなげる
    cancel: { when: 'recovery', into: ['bite', 'launcher', 'uppercut', ...SPECIALS] },
  },
  // 踏みつけ（↓→＋攻撃）：跳び上がって踏みつける3連。最後は敵を地面へ叩きつける。
  // ↓↘→（斜めが入る）は衝撃波（shockwave）になる。斜めの無い ↓→ だけがこの技。
  stomp: {
    name: '跳び上がり踏みつけ', desc: '跳び上がって3連で踏みつけ、最後は敵を地面へ叩きつける。4秒以内に続けて出すほど CP が増える（最大3倍）。', input: 'down,forward+attack', ctx: 'ground', from: null, cost: 12, family: 'wave',
    frames: 'stomp', t: [0.08, 0.18, 0.11, 0.11, 0.40], ev: { 1: 'hopUp' }, vx: { 1: 360, 2: 300, 3: 200 },   // 跳びながら前へ進む（足が敵の真上に来る＝絵の形の判定のため）
     float: [2, 3], vy: { 4: 1500 }, until: { 4: 'ground' },
    sfx: { 1: 'scratch', 4: 'bite' },   // 絵（Stomp・本物の跳び上がり踏みつけ）が体を傾けるので pose は掛けない
    hits: [
      { part: 'low', overhead: true, at: 2, box: [-0.6, 1.7, -1.2, 0.6], dmg: 6, kb: 0, stun: 0.5, gauge: 5, stop: 0.05, sfx: 'bite', spark: 'bite' },
      { part: 'low', overhead: true, at: 3, box: [-0.6, 1.7, -1.2, 0.6], dmg: 6, kb: 0, stun: 0.5, gauge: 5, stop: 0.05, sfx: 'bite', spark: 'bite' },
      { part: 'low', overhead: true, at: 4, box: [-0.5, 1.5, -1.2, 0.7], lock: true, dmg: 12, kb: 0, stun: 0.5, gauge: 8, stop: 0.12, shake: 9, sfx: 'ram', spark: 'big',
        launch: { vx: 60, vy: 1100, grav: 1, spike: true, bounce: 0.6 } },
    ],
    cancel: { when: 'recovery', into: ['bite', 'launcher', 'uppercut', ...SPECIALS] },
  },

  // ---- 必殺（ゲージ）----
  // 咆哮（↓↓＋攻撃）：出ている間は無敵。自分を中心に全方位の敵を水平に強く吹き飛ばし（壁で跳ね返る）、ガードも貫く。やられている最中からも出せる。
  roar: {
    name: '咆哮', desc: '無敵の咆哮。周りの敵を吹き飛ばし、ガードも崩す。地上でよろけている間でも出せる。4秒以内に続けて出すほど CP が増える（最大3倍）。', input: 'down,down+attack', ctx: 'ground', from: null, cost: 30, fromHurt: true, family: 'wave',
    frames: 'roar', t: [0.16, 0.24, 0.34], inv: [0, 1], sfx: { 0: 'special' }, ev: { 1: 'roarFx' },
    pose: { 1: { jitter: 2 } },   // 絵（Roar・本物の咆哮）が胸を張って頭を上げる。吠えている間だけ小さく震わせる
    // breakGuard: true は「主人公の咆哮」の表。主人公のゲージ技は敵のガードを貫く（world.js の isPlayerCpMove）ので、この印は主人公の咆哮にだけ効く。
    //   敵として読み替えるライバルの咆哮は、rival.js の RIVAL_READ.roar の guardable:true がこの印を外す（2026-10-25 Nao「咆哮はガードできるようにして」）＝ライバルの咆哮はガードできる。主人公のこの表は書き換えない。（独立監査 中-4：表の定義を直後に消す構造に見えて紛らわしいため、場所を明記）
    hits: [{ part: 'area', at: 1, box: [-4.6, 4.6, -0.2, 2.2], both: true, wave: true, roar: true, disk: true, dmg: 12, kb: 0, stun: 0.6, gauge: 0, stop: 0.12, shake: 14, sfx: 'quake', spark: 'big', breakGuard: true,
      launch: { vx: 1150, vy: -170, grav: 0.55 } }],
    cancel: null,
  },
  // 衝撃波（↓↘→＋攻撃）：体重ごと地面を叩き、衝撃波が床を走る（飛び道具）。
  shockwave: {
    name: '地を這う衝撃波', desc: '体重ごと地面を叩き、衝撃波が床を走る飛び道具。4秒以内に続けて出すほど CP が増える（最大3倍）。', input: 'down,downforward>0.04,forward+attack', ctx: 'ground', from: null, cost: 40, family: 'wave',
    frames: 'shockwave', t: [0.20, 0.16, 0.32], lunge: { 0: 10 }, sfx: { 1: 'slam' }, ev: { 1: 'spawnWave' },
    pose: { 0: { tilt: -0.18 }, 1: { tilt: 0.42, jitter: 2 } },
    hits: [{ part: 'claw', at: 1, box: [0.2, 1.6, -0.05, 0.45], lock: true, dmg: 10, kb: 0, stun: 0.5, gauge: 0, stop: 0.1, shake: 10, sfx: 'quake', spark: 'big',
      launch: { vx: 320, vy: -260, grav: 0.5, float: true } }],
    proj: { speed: 960, life: 0.9, w: 70, h: 54, hit: { wave: true, dmg: 14, kb: 0, stun: 0.5, gauge: 0, stop: 0.07, shake: 6, sfx: 'quake', spark: 'big',
      launch: { vx: 760, vy: -330, grav: 0.55, float: true } } },
    cancel: null,
  },
  // 噛みつき振り回し（前・後・前＋攻撃）：噛みついて首を大きく振り回す多段の大技（つかまずに当てる）。ボスにも効く。
  maul: {
    name: '噛みつき振り回し', desc: '噛みついて首を振り回す多段の大技。ボスにも効く。', input: 'forward,back,forward+attack', ctx: 'ground', from: null, cost: 60,
    frames: 'maul', t: [0.22, 0.14, 0.14, 0.14, 0.14, 0.14, 0.22, 0.34], lunge: { 0: 90 }, inv: [0, 1, 2, 3, 4, 5, 6], sfx: { 0: 'special', 1: 'bite', 3: 'bite', 6: 'bite' },
    pose: { 2: { tilt: -0.1 }, 3: { tilt: 0.1 }, 4: { tilt: -0.1 }, 5: { tilt: 0.1 }, 6: { jitter: 3 } },   // 首振りは絵（Maul・動画の振り回し）。傾きは添えるだけ
    hits: [
      { fit: true, at: 1, box: [-0.6, 2.3, -0.05, 1.3], dmg: 6, kb: 0, stun: 0.55, gauge: 3, stop: 0.05, shake: 4, sfx: 'bite', spark: 'bite' },
      { fit: true, at: 2, box: [-0.6, 2.3, -0.05, 1.3], dmg: 6, kb: 0, stun: 0.55, gauge: 3, stop: 0.05, shake: 4, sfx: 'bite', spark: 'slash' },
      { fit: true, at: 3, box: [-0.6, 2.3, -0.05, 1.3], dmg: 6, kb: 0, stun: 0.55, gauge: 3, stop: 0.05, shake: 4, sfx: 'bite', spark: 'bite' },
      { fit: true, at: 4, box: [-0.6, 2.3, -0.05, 1.3], dmg: 6, kb: 0, stun: 0.55, gauge: 3, stop: 0.05, shake: 4, sfx: 'bite', spark: 'slash' },
      { fit: true, at: 5, box: [-0.6, 2.3, -0.05, 1.3], dmg: 8, kb: 0, stun: 0.55, gauge: 3, stop: 0.06, shake: 5, sfx: 'bite', spark: 'bite' },
      { fit: true, at: 6, box: [-0.6, 2.6, -0.05, 1.4], dmg: 16, kb: 0, stun: 0.5, gauge: 6, stop: 0.16, shake: 14, sfx: 'ram', spark: 'big', breakGuard: true,
        launch: { vx: 1300, vy: -240, grav: 0.5 } },
    ],
    cancel: null,
  },

  // ---- ダッシュ攻撃（→→＋攻撃）：ダッシュ中に攻撃ボタン。体当たりで敵を壁まで飛ばす（ゲージ不要）。----
  dashAttack: {
    name: 'ダッシュ体当たり', desc: 'ダッシュからの体当たり。敵を壁まで飛ばす（敵のガードを貫く）。', input: 'attack', ctx: 'ground', requires: 'dash', priority: 30, cost: 0,
    frames: 'special', t: [0.08, 0.40, 0.28], vx: { 1: 1150 }, inv: [0], float: [1], until: { 1: 'wall' }, sfx: { 0: 'whoosh' }, ev: { 1: 'ramTrail' },
    // 版1.2：突進は正面のガードで止められる（breakGuard を外した）。ただし Nao 10-20 の決定（ゲージ技・ダッシュ体当たりは敵のガードを貫く）で、主人公のダッシュ体当たりは world.js の isPlayerCpMove により敵のガードを貫く（ガードされず、はじかれない）。止められてはじかれるのは敵の突進（独立監査 軽微-1 で説明を実装に合わせた）
    hits: [{ part: 'body', at: 1, box: [-0.1, 1.9, -0.05, 1.2], dmg: 16, kb: 0, stun: 0.5, gauge: 8, stop: 0.12, shake: 11, sfx: 'ram', spark: 'big',
      launch: { vx: 1500, vy: -130, grav: 0.35 } }],
    cancel: null,
  },

  // ---- 空中 ----
  // 昇り（上を押しながら攻撃）：当てるたびに自分も敵もいっしょに上へ運ばれる。ジャンプボタン不要。コンボが長い・高いほど浮きが弱い。
  // 一定の高さに来ると頂点で二人とも止まり（約0.55秒）、そのあいだに2〜3発入る。
  rise: {
    name: '昇りかみつき', desc: '上を押しながら攻撃。当てるたびに敵と一緒に昇る。', input: 'up+attack', ctx: 'air', from: null, cost: 0,
    frames: 'rise', t: [0.06, 0.13, 0.10], sfx: { 1: 'bite' },
    hits: [{ part: 'mouth', at: 1, box: [0.2, 1.75, -0.1, 1.25], dmg: 7, kb: 160, stun: 0.3, gauge: 5, stop: 0.05, sfx: 'bite', spark: 'bite', bounce: -640, rise: true }],
    cancel: { when: 'both', into: AIR_FOLLOW },
  },
  // 空中の締め（方向なし）：昇りのあとに上を離して攻撃 → 尻尾のなぎ払い。敵を横へ一直線に吹き飛ばす。
  airTail: {
    name: '空中の尻尾なぎ払い', desc: '昇りのあと上を離して攻撃。尻尾で敵を横へ吹き飛ばす。', input: 'attack', ctx: 'air', from: ['rise', 'riseClawR', 'riseClawL'], cost: 0,
    frames: 'airTail', t: [0.07, 0.12, 0.22], sfx: { 1: 'scratch' }, ev: { 1: 'finisherFx' },
    pose: { 0: { tilt: -0.1, turn: true }, 1: { tilt: -0.16, turn: true }, 2: { tilt: -0.08, turn: true } },   // 地上と同じ絵（Tail）を、空中では体を少し（頭上がりに）傾けて使う
    hits: [{ part: 'tail', at: 1, box: [0.2, 2.1, -0.1, 1.25], dmg: 13, kb: 0, stun: 0.5, gauge: 10, stop: 0.12, shake: 9, sfx: 'scratch', spark: 'big', bounce: -160,
      launch: { vx: 1240, vy: -110, grav: 0.4 } }],
    cancel: { when: 'both', into: ['air', 'airClawR', 'airjump', 'spike', 'dive', 'special'] },
  },
  // 空中攻撃。当たると自分も少し浮き、敵も一緒に運ばれ、空中ジャンプが戻る（コンボが長いほど浮きが弱い）。
  air: {
    name: '空中かみつき', desc: '空中のふつうの噛みつき。当てると、もう一度だけ空中ジャンプができる。', input: 'attack', ctx: 'air', from: null, cost: 0,
    frames: 'air', t: [0.06, 0.14, 0.12], sfx: { 1: 'bite' },
    hits: [{ part: 'mouth', at: 1, box: [0.2, 1.7, -0.1, 1.15], dmg: 8, kb: 200, stun: 0.3, gauge: 5, stop: 0.05, sfx: 'bite', spark: 'bite', bounce: -420 }],
    cancel: { when: 'both', into: ['air', 'airClawR', 'airjump', 'spike', 'dive', 'special', 'rise', 'riseClawR'] },
  },
  // ---- 版2.8：空中の爪（連打の循環）。Nao「右黒左黒噛み付く右黒左黒噛み付く」＝右の爪→左の爪→噛みつきの順。
  // 当たり（箱）・威力・浮かせ・昇りの働き（bounce・rise）・動きの長さは、昇り（rise）・空中かみつき（air）と同じ。絵は地上の爪（ScratchR2・ScratchL2）で、空中では体の傾きだけ調整する。
  riseClawR: {
    name: '昇り右の爪', desc: '昇りのあと、上を押したまま攻撃を続けると右の爪。当てるたびに一緒に昇る。', input: 'up+attack', ctx: 'air', from: ['rise'], cost: 0,
    frames: 'scratch', t: [0.035, 0.025, 0.13, 0.10], sfx: { 1: 'scratch' }, ev: { 1: 'clawR' },
    pose: { 0: { tilt: -0.12 }, 1: { tilt: -0.2 }, 2: { tilt: -0.2 }, 3: { tilt: -0.1 } },
    hits: [{ part: 'claw', at: 2, box: [0.2, 1.75, -0.1, 1.25], dmg: 7, kb: 160, stun: 0.3, gauge: 5, stop: 0.05, sfx: 'scratch', spark: 'slash', bounce: -640, rise: true }],
    cancel: { when: 'both', into: AIR_FOLLOW },
  },
  riseClawL: {
    name: '昇り左の爪', desc: '右の爪のあと、上を押したまま攻撃を続けると左の爪。', input: 'up+attack', ctx: 'air', from: ['riseClawR'], cost: 0,
    frames: 'scratch2', t: [0.035, 0.025, 0.13, 0.10], sfx: { 1: 'scratch' }, ev: { 1: 'clawL' },
    pose: { 0: { tilt: -0.05 }, 1: { tilt: -0.14 }, 2: { tilt: -0.14 }, 3: { tilt: -0.06 } },
    hits: [{ part: 'claw', at: 2, box: [0.2, 1.75, -0.1, 1.25], dmg: 7, kb: 160, stun: 0.3, gauge: 5, stop: 0.05, sfx: 'scratch', spark: 'slash', bounce: -640, rise: true }],
    cancel: { when: 'both', into: AIR_FOLLOW },
  },
  airClawR: {
    name: '空中右の爪', desc: '空中のかみつきのあと、攻撃を続けると右の爪。', input: 'attack', ctx: 'air', from: ['air'], cost: 0,
    frames: 'scratch', t: [0.035, 0.025, 0.14, 0.12], sfx: { 1: 'scratch' }, ev: { 1: 'clawR' },
    pose: { 0: { tilt: -0.12 }, 1: { tilt: -0.2 }, 2: { tilt: -0.2 }, 3: { tilt: -0.1 } },
    hits: [{ part: 'claw', at: 2, box: [0.2, 1.7, -0.1, 1.15], dmg: 8, kb: 200, stun: 0.3, gauge: 5, stop: 0.05, sfx: 'scratch', spark: 'slash', bounce: -420 }],
    cancel: { when: 'both', into: ['air', 'airClawL', 'airjump', 'spike', 'dive', 'special', 'rise', 'riseClawR'] },
  },
  airClawL: {
    name: '空中左の爪', desc: '右の爪のあと、攻撃を続けると左の爪。そのあとは噛みつきへ戻る。', input: 'attack', ctx: 'air', from: ['airClawR'], cost: 0,
    frames: 'scratch2', t: [0.035, 0.025, 0.14, 0.12], sfx: { 1: 'scratch' }, ev: { 1: 'clawL' },
    pose: { 0: { tilt: -0.05 }, 1: { tilt: -0.14 }, 2: { tilt: -0.14 }, 3: { tilt: -0.06 } },
    hits: [{ part: 'claw', at: 2, box: [0.2, 1.7, -0.1, 1.15], dmg: 8, kb: 200, stun: 0.3, gauge: 5, stop: 0.05, sfx: 'scratch', spark: 'slash', bounce: -420 }],
    cancel: { when: 'both', into: ['air', 'airjump', 'spike', 'dive', 'special', 'rise', 'riseClawR'] },
  },
  // 空中の締め（下）：前方宙返りの勢いで尻尾を真上から振り下ろし、着地して地面を打つ。叩き落とした敵は地面で跳ね返り、もう一度拾える。
  // 回転は絵を1枚だけ回す（pose.spin：頭が前下へ一回転・緩急・薄い残像）。尻尾の振り下ろしは動画のコマ（頭上→途中→水平→地面）。
  // 時間配分（秒）：ため0.05 → 回転0.32 → 尻尾が頭上0.05 → 振り下ろし0.05 → 叩きつけ（当たり・着地まで落ちる・最大0.35）→ 止め0.10（着地の衝撃）→ 戻り0.08
  spike: {
    name: '宙返り尻尾叩きつけ', desc: '空中コンボの最中（昇りなどで敵に当てている間）に ↓＋攻撃。宙返りして尻尾を叩きつけ、敵を地面へ落とす。コンボ中でない空中の ↓＋攻撃は急降下になる。出すと、続けて出す踏みつけ・咆哮・衝撃波の CP が増える。', combo: true, input: 'down+attack', ctx: 'air', from: null, cost: 0, family: 'wave',
    frames: 'spike', t: [0.05, 0.32, 0.05, 0.05, 0.35, 0.10, 0.08], vy: { 4: 1500 }, until: { 4: 'ground' }, sfx: { 1: 'whoosh', 4: 'slam' }, ev: { 5: 'diveLand' },
    pose: { 0: { tilt: -0.2 }, 1: { spin: { from: -0.2, to: Math.PI * 2 } } },
    hits: [{ part: 'body', overhead: true, at: 4, box: [-0.3, 2.0, -1.4, 0.8], lock: true, dmg: 12, kb: 0, stun: 0.5, gauge: 8, stop: 0.14, shake: 10, sfx: 'ram', spark: 'big', bounce: -300,
      launch: { vx: 70, vy: 1100, grav: 1, spike: true, bounce: 0.6 } }],
    cancel: { when: 'both', into: ['air', 'airjump', 'special'] },
  },
  // 急降下の踏みつけ（空中で ↓↓＋攻撃）：頭を下にして真下へ突っ込む。下にいた敵は叩き落とし、着地の衝撃で周りの敵を浮かせる。
  dive: {
    name: '急降下の踏みつけ', desc: `空中で ↓＋攻撃（コンボ中でないとき）／↓↓＋攻撃（いつでも。コンボ中・空中の技の途中からもキャンセルして出せる。宙返りの叩きつけの最中を除く）。真下へ突っ込み、着地で周りの敵を浮かせる。出した瞬間に CP を ${DIVE_CP} 使う（足りないと出ない。ガードは貫かない）。出すと、続けて出す踏みつけ・咆哮・衝撃波の CP が増える。`, altInput: 'down+attack', altWhen: 'コンボ中でない空中', input: 'down,down+attack', ctx: 'air', from: null, cost: 0, energy: 'dive', family: 'wave',
    frames: 'dive', t: [0.07, 0.70, 0.30], float: [0], vy: { 1: 1550 }, until: { 1: 'ground' }, sfx: { 1: 'whoosh' }, ev: { 2: 'diveLand' },
    // 絵（Stomp・足を下へ向けた踏みつけ）が体を傾けるので pose は掛けない
    hits: [
      { part: 'low', overhead: true, at: 1, box: [-0.5, 1.4, -1.2, 0.6], lock: true, dmg: 14, kb: 0, stun: 0.5, gauge: 8, stop: 0.1, shake: 9, sfx: 'ram', spark: 'big',
        launch: { vx: 60, vy: 1000, grav: 1, spike: true, bounce: 0.55 } },
      { at: 2, overhead: true, box: [-2.6, 2.6, -0.1, 0.55], both: true, wave: true, disk: true, dmg: 10, kb: 0, stun: 0.5, gauge: 5, stop: 0.1, shake: 12, sfx: 'quake', spark: 'big',
        launch: { vx: 280, vy: -430, grav: 0.5, float: true } },
    ],
    cancel: { when: 'recovery', into: ['bite', 'launcher', 'uppercut', ...SPECIALS] },
  },

  // ---- 体当たり：ゲージを使う（Cボタン）。コンボ中に出すと敵を壁へまっすぐ飛ばす締め。空中でも出せる。壁で跳ね返り、拾える。
  special: {
    name: '体当たり', desc: '体当たり。コンボの締めに。空中でも出せる。', input: 'special', ctx: 'any', from: null, cost: 50,
    frames: 'special', t: [0.10, 0.42, 0.30], vx: { 1: 1250 }, inv: [0, 1], float: [1], until: { 1: 'wall' }, sfx: { 0: 'special' }, ev: { 1: 'ramTrail' },
    hits: [{ part: 'body', at: 1, box: [-0.1, 1.9, -0.05, 1.2], dmg: 22, kb: 0, stun: 0.5, gauge: 0, stop: 0.15, shake: 13, sfx: 'ram', spark: 'big',      // 版1.2：体当たり（C）も突進＝ガードで止められる
      launch: { vx: 1650, vy: -140, grav: 0.35 } }],
    cancel: null,
  },
};

/** 表の1行を、world.js が動かす形（phases・hits）に展開する。 */
export function expandRow(id, row, frameMap = {}) {
  const def = {
    id, name: row.name || id, input: row.input, parsed: parseInput(row.input),
    ctx: row.ctx || 'any', from: row.from || null, fromHit: !!row.fromHit, requires: row.requires || null, cost: row.cost || 0, energy: row.energy || null, family: row.family || null, fromHurt: !!row.fromHurt,
    priority: row.priority || 0, chainWindow: row.chainWindow ?? 0.35, action: row.action || null, proj: row.proj || null,
    frames: row.frames || id, cancel: row.cancel ? { when: row.cancel.when || 'both', into: [...(row.cancel.into || [])] } : null,
    hits: {}, phases: [],
  };
  if (row.action) return def;
  const t = row.t || [];
  const phases = t.map((dur) => ({ dur }));
  const fm = frameMap[def.frames];
  if (fm) {
    if (fm.f.length !== phases.length) throw new Error(`技 ${id}: コマの区間数(${fm.f.length})と t の数(${phases.length})が違う`);
    fm.f.forEach((fr, i) => { phases[i].m = fr[0]; phases[i].from = fr[1]; phases[i].to = fr[2]; });
  }
  // 版3.0 第2段：水の中で出す用のコマ（MOVE_FRAMES の「<コマの名前>Water」）。あれば def.waterFrames に持ち、world.startMove が泳いでいる間だけ使う。
  const wf = frameMap[def.frames + 'Water'];
  if (wf) {
    if (wf.f.length !== phases.length) throw new Error(`技 ${id}: 水中のコマの区間数(${wf.f.length})と t の数(${phases.length})が違う`);
    def.waterFrames = wf.f.map((fr) => ({ m: fr[0], from: fr[1], to: fr[2] }));
  }
  const at = (map, apply) => { for (const [i, v] of Object.entries(map || {})) { if (!phases[i]) throw new Error(`技 ${id}: 区間 ${i} が無い`); apply(phases[i], v); } };
  at(row.lunge, (p, v) => { p.lunge = v; });
  at(row.vx, (p, v) => { p.vx = v; });
  at(row.vy, (p, v) => { p.vy = v; });
  at(row.sfx, (p, v) => { p.sfx = v; });
  at(row.ev, (p, v) => { p.ev = v; });
  at(row.until, (p, v) => { p.until = v; });
  at(row.pose, (p, v) => { p.pose = v; });
  for (const i of row.inv || []) { if (!phases[i]) throw new Error(`技 ${id}: inv の区間 ${i} が無い`); phases[i].inv = true; }
  for (const i of row.float || []) { if (!phases[i]) throw new Error(`技 ${id}: float の区間 ${i} が無い`); phases[i].float = true; }
  (row.hits || []).forEach((h, k) => {
    if (!phases[h.at]) throw new Error(`技 ${id}: hits[${k}].at=${h.at} の区間が無い`);
    if (phases[h.at].hit) throw new Error(`技 ${id}: 区間 ${h.at} に当たりが2つある（1区間に1つ）`);
    const { at: _at, box, ...rest } = h;
    const name = `h${k}`;
    def.hits[name] = { x0: box[0], x1: box[1], y0: box[2], y1: box[3], ...rest };
    phases[h.at].hit = name;
  });
  if (def.cancel && (def.cancel.when === 'recovery' || def.cancel.when === 'both') && phases.length) phases[phases.length - 1].cancel = true;
  def.phases = phases;
  return def;
}

export function expandMoves(rows, frameMap = {}) {
  const out = {};
  for (const [id, row] of Object.entries(rows)) out[id] = expandRow(id, row, frameMap);
  return out;
}
