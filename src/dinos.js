// 恐竜データ（主人公と敵）。コードと数値を混ぜないための表。
//
// 絵は左向きが基本。artFacing: -1=絵が左向き / +1=絵が右向き（Ankylosaurus と SkeletonRex は右向き）。
// scale は「元のコマ→画面」の倍率（画面を見て調整してよい）。
// hurt は体の芯だけの当たり判定（w=体幅に対する割合、y0〜y1=体高に対する割合・地面から上へ）。
//
// どの動作にどのコマを当てるかは assets/motion_map.js にまとめてある（anim と主人公の技のコマ）。
// ここには「技の長さ・当たり・移動」だけを書く。敵の技のコマは本物のモーションなのでここに直接ある。
//
// 動き（moves）は phases の並び。各 phase:
//   m: モーション名（省略時は move.motion） / from→to: コマ番号 / dur: 秒
//   hit: hits の鍵（この phase のあいだ判定が出る。1回の phase で同じ相手には1回だけ）
//   tele: 予兆（光る・「!」）  inv: 無敵  lunge: この phase で前へ進む距離(px)
//   vx: 前向き速度(px/s)  until:'wall' 壁に当たるまで dur を最大とする  loop:[a,b,fps] その範囲を回す
//   cancel: 次の入力で打ち切ってよい  ev: イベント名  sfx: 効果音名  float: 重力を切る（空中でまっすぐ）
// hits のボックスは体の大きさを単位にする: x0,x1=体の半幅の倍数（前向き・中心から）、y0,y1=体高の倍数（地面から）。
// both:true は前後両方（回転技）。
// hit の part（当たる部位）: mouth 口 / claw 爪 / tail 尻尾 / low 足元 / body 体 / area（省略時＝上の箱）。絵の形の判定は src/shape.js。
// part は 'mouth+low' のように + でつないで複数にできる。ring:true の当たりは、床を走る輪（描画の ring）の線そのものが判定（箱なし・world.js の spawnShock）。
// hit の主な項目: dmg 威力 / kb 後ろへ押す速さ / stun 硬直 / gauge ゲージ増加 / stop ヒットストップ(秒)
//   launch {vx,vy,grav} 横へ吹き飛ばす / up 打ち上げ / bounce 当てた側が少し浮く / breakGuard / shake 画面揺れ
import { ANIM, MOVE_FRAMES } from '../assets/motion_map.js';
import { PLAYER_MOVES, expandMoves } from './moves.js';
import { rivalMoves, RIVAL_TUNE } from './rival.js';

export const FPS = 15;

export const DINOS = {
  Spinosaurus: {
    label: 'スピノサウルス', artFacing: -1, scale: 1.2,
    motions: ['Idle', 'Bite', 'Scratch', 'Charge', 'Damage', 'Down', 'Downed', 'Revive', 'Victory', 'Weak', 'FlipSlam', 'Run', 'Roar', 'Uplift', 'Stomp', 'Guard', 'Tail', 'Maul', 'ScratchR', 'ScratchL', 'TailLow', 'ScratchR2', 'ScratchL2', 'Swim', 'BiteWater'],
    // Revive だけ別寸法（0.2933倍で畳まれている）。待機の 0.3534 との比で戻す。
    motionScale: { Revive: 1.2049 },
    hurt: { w: 0.46, y0: 0.0, y1: 0.86 },
    hp: 100,
    moves: expandMoves(PLAYER_MOVES, MOVE_FRAMES.Spinosaurus),   // 主人公の技は表 src/moves.js（1技1行）
    cost: PLAYER_MOVES.special.cost,   // 体当たりのゲージ消費（表の special 行）
  },

  Allosaurus: {
    label: 'アロサウルス', artFacing: -1, scale: 1.15,
    motions: ['Idle', 'Bite', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 50, score: 500, speed: 150, tier: 'grunt', hop: true,      // 版2.6：hop＝足場の上の主人公へ跳び上がる（world.js hopAI）
    ai: { type: 'walker', range: 1.45, cooldown: [0.7, 1.5] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.55, y0: 0, y1: 0.95, dmg: 9, kb: 260, stun: 0.3, sfx: 'bite' } },
        phases: [
          { from: 0, to: 24, dur: 0.5, tele: true },
          { from: 24, to: 34, dur: 0.16, hit: 'bite', sfx: 'bite', lunge: 70 },
          { from: 34, to: 56, dur: 0.42 },
        ],
      },
    },
  },

  Triceratops: {
    label: 'トリケラトプス', artFacing: -1, scale: 1.15,
    motions: ['Idle', 'Charge', 'Guard', 'Damage', 'Down', 'Downed', 'Revive', 'Weak', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 80, score: 800, speed: 85, tier: 'grunt',
    ai: { type: 'charger', waitMin: 1.4, waitMax: 2.6 },
    guard: { motion: 'Guard', raise: [18, 27, 0.25], hold: 30, lower: [48, 59, 0.3] },
    moves: {
      charge: {
        motion: 'Charge', hits: { ram: { part: 'maw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 15, kb: 520, stun: 0.4, sfx: 'ram' } },
        phases: [
          { from: 0, to: 10, dur: 0.8, tele: true, sfx: 'growl' },
          { from: 14, to: 24, dur: 1.5, hit: 'ram', vx: 800, until: 'wall', loop: [14, 24, 22], armor: true },
          { from: 28, to: 38, dur: 0.45, vx: 300, armor: true },
          { from: 40, to: 57, dur: 0.55 },
        ],
      },
    },
  },

  Ankylosaurus: {
    label: 'アンキロサウルス', artFacing: 1, scale: 0.9,
    motions: ['Idle', 'Guard', 'Bite', 'Damage', 'Down', 'Downed', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.95 },
    hp: 120, score: 1000, speed: 62, tier: 'grunt',
    ai: { type: 'tank', range: 1.1, cooldown: [1.2, 2.2], guardDist: 3.2, turnDelay: 0.8 },
    guard: { motion: 'Guard', raise: [8, 17, 0.22], hold: 28, lower: [42, 50, 0.28] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.5, y0: 0, y1: 1.0, dmg: 11, kb: 300, stun: 0.3, sfx: 'bite' } },
        phases: [
          { from: 0, to: 24, dur: 0.55, tele: true },
          { from: 24, to: 38, dur: 0.2, hit: 'bite', sfx: 'bite', lunge: 40 },
          { from: 38, to: 55, dur: 0.45 },
        ],
      },
    },
  },

  Pteranodon: {
    label: 'プテラノドン', artFacing: -1, scale: 1.35,
    motions: ['Idle', 'Charge', 'Down', 'Downed', 'Revive', 'Weak'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.95 },
    hp: 30, score: 600, speed: 190, tier: 'grunt', flying: true,
    ai: { type: 'flyer', altitude: 230, wave: 55, diveEvery: [2.6, 4.2] },
    moves: {
      dive: {
        motion: 'Charge', hits: { peck: { part: 'maw+low', overhead: true, x0: 0.1, x1: 1.4, y0: 0, y1: 1.1, dmg: 8, kb: 320, stun: 0.3, sfx: 'bite' } },
        phases: [
          { from: 0, to: 21, dur: 0.55, tele: true, sfx: 'screech' },
          { from: 21, to: 33, dur: 0.7, hit: 'peck', ev: 'dive', loop: [24, 33, 20] },
          { from: 36, to: 54, dur: 0.5, ev: 'diveEnd' },
        ],
      },
    },
  },

  SkeletonRex: {
    label: 'スケルトンレックス', artFacing: 1, scale: 1.45, boss: true,
    motions: ['Idle', 'Bite', 'BoneSweep', 'Roar', 'Walk'],
    hurt: { w: 0.42, y0: 0.0, y1: 0.95 },
    hp: 700, score: 8000, speed: 78, tier: 'boss', breaker: 'sweep', counter: 'sweep',
    ai: { type: 'boss', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 1.0 },
      { id: 'sweep', range: [0, 1.7], w: 2.2, cd: 2.2 },
      { id: 'roar', range: [0, 99], w: 0, cd: 9, minion: true },
    ], gap: [0.5, 1.1] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'skull', x0: 0.2, x1: 1.55, y0: 0, y1: 1.0, dmg: 12, kb: 380, stun: 0.4, sfx: 'bossBite' } },      // 2026-10-25：口の先だけでなく頭ぜんたい（skull）
        phases: [
          { from: 0, to: 16, dur: 0.65, tele: true, sfx: 'bossRoar' },
          { from: 16, to: 30, dur: 0.2, hit: 'bite', sfx: 'bossBite', lunge: 90 },
          { from: 30, to: 35, dur: 0.5 },
        ],
      },
      sweep: {
        motion: 'BoneSweep', hits: { sweep: { part: 'bonesweep', x0: -1.7, x1: 1.7, y0: 0, y1: 0.9, dmg: 14, kb: 480, stun: 0.5, sfx: 'bossBite', both: true } },
        phases: [
          { from: 0, to: 5, dur: 0.65, tele: true, sfx: 'growl' },
          { from: 5, to: 19, dur: 0.75, hit: 'sweep', sfx: 'whoosh' },
          { from: 19, to: 22, dur: 0.5 },
        ],
      },
      roar: {
        motion: 'Roar', hits: { shock: { ring: true, dmg: 6, kb: 300, stun: 0.3, inv: 0.2, sfx: 'quake', both: true } },      // 2026-10-25：咆哮の輪（描かれている）に当たり。小ダメージ＋押し返し
        phases: [
          { from: 0, to: 25, dur: 0.9, tele: true },
          { from: 25, to: 40, dur: 0.7, ev: 'roarSummon', sfx: 'bossRoar' },
          { from: 40, to: 63, dur: 0.7 },
        ],
      },
    },
    summon: { type: 'Allosaurus', n: 3 },
  },

  // 2026-10-11 Nao「ティラノのほうが強そう」＝9面のボスに移し、ギガノト（体力1500・攻撃の間 0.35〜0.8秒）より体力・攻撃の頻度・威力を上に調整した（歩く速さ88は歩きの絵の周期に合わせてあるので変えない）。
  Tyrannosaurus: {
    label: 'ティラノサウルス', artFacing: -1, scale: 1.45, boss: true,
    motions: ['Idle', 'Bite', 'Tailwhip', 'Roar', 'Damage', 'Walk'],
    hurt: { w: 0.42, y0: 0.0, y1: 0.95 },
    // 版2.8：目のカットインは、本編の動画（鮮やかな緑のドット絵）ではなく、ゲームのティラノの絵（くすんだ黄緑の絵画調）から作る（tools/make_tyrant_eye.py）。色と質感が合わないため。
    cutin: { kind: 'tyrantCrush', dir: 'assets/fx/tyrant_eye', n: 10, aspect: 960 / 249 },
    hp: 1830, score: 30000, speed: 88, tier: 'boss', breaker: 'roar', counter: 'roar',
    ai: { type: 'boss', spLock: 5.0, moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 0.55 },
      { id: 'whip', range: [0, 1.9], w: 2.6, cd: 1.5 },
      { id: 'roar', range: [0, 99], w: 1.2, cd: 5.5 },
      { id: 'tyrantCrush', range: [0.3, 99], w: 1.4, cd: 18, sp: true },      // 版2.8：必殺技（タイランレックスクラッシュ）。出す頻度はギガノトの必殺技と同じ（重み 1.4・間隔 18 秒・必殺技どうし 5 秒あける）
    ], gap: [0.25, 0.6] },
    moves: {
      // ---- 版2.8：タイランレックスクラッシュ（本編の必殺技。動画「タイランレックスクラッシュ.webm」の流れ）
      //  ①予兆 0.9秒（オーラが燃え上がる・赤い光と「!」）②目のカットイン（約0.5秒止まる）③地響きの突進（一歩ごとに地面が揺れ、近くの地上の主人公がよろける・足元に土ぼこり。2026-10-26 から突進の当たりは全身（body）＝跳んでもかわせない。かわし方はガード・パリィ・距離。独立監査 軽微-1 で説明を実装に合わせた）
      //  ④大口を開けて迫り、噛みつく（パリィできる）。当たれば一度くわえて（左右の連打で抜けられる）地面へ叩きつける＝岩が飛び散り、地面にひびが入る。ガードされた・外れたときは、ガードを崩す大きな噛み砕き（岩とひび）
      //  ⑤締めの咆哮（殴り返せる隙）。全部受けると 40（突進 10＋噛みつき 6＋かじり 2×3＋叩きつけ 18）。怒り中は rage.dmg 倍（叩きつけ・かじりも）。恐竜の技なので炎・元素のエフェクトは付けない（岩・土ぼこり・ひびだけ）。
      tyrantCrush: {
        label: 'タイランレックスクラッシュ', motion: 'Roar', special: true,
        aura: { phases: [0], boost: 1.5, color: 'earth' },
        grab: { need: 6, tick: 0.4, tickDmg: 2, slamDmg: 18, rage: true },
        hits: {
          ram: { part: 'body', x0: 0.2, x1: 1.5, y0: 0, y1: 0.95, dmg: 10, kb: 40, stun: 0.5, inv: 0.05, noRepel: true, sfx: 'ram' },
          maw: { part: 'body', x0: 0.0, x1: 1.8, y0: 0, y1: 1.0, dmg: 6, kb: 0, stun: 0.1, grab: true, noRepel: true, sfx: 'bossBite' },
          crunch: { part: 'body', x0: 0.0, x1: 1.8, y0: 0, y1: 1.0, dmg: 16, kb: 40, stun: 1.0, inv: 1.3, breakGuard: true, noParry: true, slam: { dmg: 6 }, sfx: 'bossBite' },
        },
        phases: [
          { from: 0, to: 36, dur: 0.9, tele: true, sfx: 'bossRoar2' },
          { from: 36, to: 36, dur: 0.06, tele: true, ev: 'cutIn', sfx: 'powerup' },
          { m: 'Walk', from: 0, to: 20, dur: 1.6, hit: 'ram', vx: 700, stopOnHit: true, wallStop: true, loop: [0, 20, 44], armor: true, step: 0.24, ghost: true, sfx: 'ram' },
          { m: 'Bite', from: 6, to: 24, dur: 0.45, tele: true, sfx: 'growl' },
          { m: 'Bite', from: 24, to: 34, dur: 0.22, hit: 'maw', stopOnHit: true, lunge: 110, lungeStop: 0.3, sfx: 'bossBite' },
          { m: 'Bite', from: 10, to: 24, dur: 0.3, onlyMiss: true, tele: true, sfx: 'growl' },
          { m: 'Bite', from: 24, to: 36, dur: 0.24, onlyMiss: true, hit: 'crunch', ev: 'crunchFx', lunge: 90, lungeStop: 0.3, sfx: 'bossBite' },
          { m: 'Bite', from: 24, to: 34, dur: 0.4, onlyGrab: true, hold: true },
          { m: 'Bite', from: 34, to: 50, dur: 0.9, onlyGrab: true, hold: true },
          { m: 'Roar', from: 36, to: 44, dur: 0.14, onlyGrab: true, hold: true },
          { m: 'Bite', from: 20, to: 30, dur: 0.25, onlyGrab: true, ev: 'tyrantSlam' },
          { m: 'Roar', from: 36, to: 60, dur: 0.9, rec: true, open: true, ev: 'tyrantRoar', sfx: 'bossRoar2' },
        ],
      },
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.55, y0: 0, y1: 1.0, dmg: 16, kb: 420, stun: 0.4, sfx: 'bossBite' } },
        phases: [
          { from: 0, to: 24, dur: 0.65, tele: true, sfx: 'growl' },
          { from: 24, to: 34, dur: 0.2, hit: 'bite', sfx: 'bossBite', lunge: 100 },
          { from: 34, to: 60, dur: 0.55 },
        ],
      },
      whip: {
        motion: 'Tailwhip', hits: { whip: { part: 'tailswing', x0: -1.9, x1: 1.9, y0: 0, y1: 0.95, dmg: 17, kb: 540, stun: 0.5, sfx: 'whoosh', both: true } },
        phases: [
          { from: 0, to: 28, dur: 0.85, tele: true, sfx: 'growl' },
          { from: 28, to: 42, dur: 0.38, hit: 'whip', sfx: 'whoosh' },
          { from: 42, to: 63, dur: 0.5 },
        ],
      },
      roar: {
        motion: 'Roar', hits: { shock: { ring: true, dmg: 13, kb: 450, stun: 0.5, sfx: 'quake', both: true } },
        phases: [
          { from: 0, to: 40, dur: 1.1, tele: true },
          { from: 40, to: 56, dur: 0.8, hit: 'shock', ev: 'roarShock', sfx: 'bossRoar2' },
          { from: 56, to: 63, dur: 0.4 },
        ],
      },
    },
  },

  Giganotosaurus: {
    label: 'ギガノトサウルス', artFacing: -1, scale: 1.5, boss: true,
    motions: ['Idle', 'Bite', 'Charge', 'TailSweep', 'Damage', 'Walk'],
    cutin: { kind: 'gigaRoar', dir: 'assets/fx/giga_roar_eye', n: 10, aspect: 720 / 225 },
    // 版2.7：咆哮を吠え終えると背景の火山が噴火し、火山弾が降る（環境の演出。ギガノト自身は炎を出さない）。vx,vy＝火山の位置（画面に対する割合）／warn＝落ちる前に地面へ赤い印を出す秒／count（怒り中 countRage）
    eruption: { vx: 0.48, vy: 0.2, dur: 3.2, count: 4, countRage: 6, start: 0.45, gap: 0.4, warn: [0.6, 0.8], fall: 0.22, r: 62, hit: { mv: 'volcano', dmg: 3, kb: 260, stun: 0.4, inv: 0.5, overhead: true, noParry: true, sfx: 'hit' } },      // 版2.7：ギガノト咆哮の目（顔）のカットイン（本編の動画 ギガノト咆哮.webm から切り出し）
    hurt: { w: 0.42, y0: 0.0, y1: 0.95 },
    hp: 1400, score: 20000, speed: 96, tier: 'boss', breaker: 'sweep', counter: 'sweep',
    ai: { type: 'boss', spLock: 5.0, moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 0.7 },
      { id: 'charge', range: [1.8, 99], w: 3, cd: 3.0 },
      { id: 'sweep', range: [0, 2.2], w: 1.8, cd: 4.0, hpBelow: 0.7 },
      { id: 'gigaRoar', range: [0, 99], w: 1.4, cd: 18, sp: true },      // 版2.7：必殺技（ギガノト咆哮・ギガノトクラッシュ）
      { id: 'crush', range: [0.3, 3.5], w: 1.6, cd: 15, sp: true },
    ], gap: [0.35, 0.8] },
    moves: {
      // ---- 版2.7：ギガノト咆哮（本編の必殺技）。①黄色い稲妻をまとって力をためる 0.8秒（オーラ・稲妻・赤い光）②顔のカットイン（約0.5秒止まる）③もう一度ため 0.4秒
      //  ④咆哮：衝撃の輪が4回、続けて広がる（地面を走る輪・跳べば越える・当たるたびに押し返される）。最後の輪だけ大きく、ガードを崩す（パリィできるのは最初の輪だけ）⑤鼻息（ここは殴れる隙）。輪の合計 20（4＋4＋4＋8）＋火山弾 4 発×3（怒り中 6 発）＝約 32。
      //  ⑥吠え終えた瞬間に背景の火山が噴火し、火山弾（燃える岩石）が降る（eruption）。今の「叩きつけ付きの薙ぎ払い（sweep）」はコンボ破りのまま。
      gigaRoar: {
        motion: 'Charge', special: true,
        aura: { phases: [0, 1, 2], boost: 1.5, bolts: true, color: 'earth' },      // 黄色い稲妻（体に炎は付けない：オーラの色は土の黄土）
        hits: {
          g1: { ring: true, dmg: 4, kb: 380, stun: 0.35, inv: 0.15, sfx: 'quake', both: true },
          g2: { ring: true, dmg: 4, kb: 380, stun: 0.35, inv: 0.15, sfx: 'quake', both: true, noParry: true },
          g3: { ring: true, dmg: 4, kb: 380, stun: 0.35, inv: 0.15, sfx: 'quake', both: true, noParry: true },
          g4: { ring: true, dmg: 8, kb: 800, stun: 0.9, inv: 1.0, sfx: 'quake', both: true, noParry: true },      // 2026-10-25（Nao「咆哮はガードできるようにして」）：最後の大きな輪の breakGuard を外した（ガードで止められる。押し返し・気絶の強さはそのまま）
        },
        phases: [
          { from: 0, to: 11, dur: 0.8, tele: true, sfx: 'bossRoar3' },
          { from: 11, to: 11, dur: 0.06, tele: true, ev: 'cutIn', sfx: 'powerup' },
          { m: 'Bite', from: 0, to: 11, dur: 0.4 },
          { m: 'Bite', from: 14, to: 16, dur: 0.34, hit: 'g1', ev: 'gigaRing', sfx: 'bossRoar3' },
          { m: 'Bite', from: 16, to: 17, dur: 0.3, hit: 'g2', ev: 'gigaRing', sfx: 'special' },
          { m: 'Bite', from: 17, to: 18, dur: 0.3, hit: 'g3', ev: 'gigaRing', sfx: 'special' },
          { m: 'Bite', from: 18, to: 18, dur: 0.4, hit: 'g4', ev: 'gigaRing', big: 1.3, erupt: true, sfx: 'bossRoar2' },
          { m: 'Bite', from: 19, to: 38, dur: 0.9 },
        ],
      },
      // ---- 版2.7：ギガノトクラッシュ（本編のスキル「ダブルチャージ・ファング」の 1.5 倍の強さ＝突進 2 回→大きな噛みつき）。動画は無いので既存の絵で。
      //  ①予兆 0.9秒（オーラ・赤い光）②突進（当たった所で止まる＝通り抜けない・ガードされたら四天王と同じく目の前で硬直。2026-10-25 から突進 r1・r2 の当たりは頭ぜんたい mawL＝地面から 139〜203px の高さ。主人公の跳びの頂点は約 207px なので、450px 以下の近さでは跳んでもかわせない＝実測の安全窓 0。かわし方はガード・パリィ・距離。r1・r2 を足元 low に戻すか頭を保つかは Nao の判断待ち。独立監査 重大-2・tools/audit_fix_test.mjs）
      //  ③後ろへ引いてもう一度突進 ④構えてから大きな噛みつき（ガードを崩して壁まで吹き飛ばす）。パリィできるのは最初の突進だけ。合計 40（9＋10＋15＋壁 6）。
      crush: {
        motion: 'Charge', special: true,
        aura: { phases: [0], boost: 1.3 },
        hits: {
          r1: { part: 'low+mawL', x0: 0.2, x1: 1.5, y0: 0, y1: 0.95, dmg: 9, kb: 40, stun: 0.5, inv: 0.05, sfx: 'ram' },
          r2: { part: 'low+mawL', x0: 0.2, x1: 1.5, y0: 0, y1: 0.95, dmg: 10, kb: 40, stun: 0.5, inv: 0.05, noParry: true, sfx: 'ram' },
          fin: { part: 'mawL', x0: 0.2, x1: 1.7, y0: 0, y1: 1.0, dmg: 15, kb: 40, stun: 1.0, inv: 1.3, breakGuard: true, noParry: true, slam: { dmg: 6 }, sfx: 'bossBite' },
        },
        phases: [
          { from: 0, to: 11, dur: 0.9, tele: true, sfx: 'bossRoar3' },
          { from: 14, to: 19, dur: 0.9, hit: 'r1', vx: 1000, stopOnHit: true, loop: [16, 19, 18], armor: true, sfx: 'ram' },
          { from: 36, to: 44, dur: 0.3, vx: -260 },
          { from: 14, to: 19, dur: 0.9, hit: 'r2', vx: 1000, stopOnHit: true, loop: [16, 19, 18], armor: true, sfx: 'ram' },
          { m: 'Bite', from: 0, to: 11, dur: 0.3, tele: true, sfx: 'growl' },
          { m: 'Bite', from: 11, to: 19, dur: 0.22, hit: 'fin', ev: 'rushFin', sfx: 'bossBite', lunge: 90, lungeStop: 0.3 },
          { m: 'Bite', from: 19, to: 38, dur: 0.8 },
        ],
      },
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.55, y0: 0, y1: 1.0, dmg: 14, kb: 420, stun: 0.4, sfx: 'bossBite' } },
        phases: [
          { from: 0, to: 11, dur: 0.55, tele: true, sfx: 'growl' },
          { from: 11, to: 19, dur: 0.2, hit: 'bite', sfx: 'bossBite', lunge: 140 },
          { from: 19, to: 38, dur: 0.5 },
        ],
      },
      charge: {
        motion: 'Charge', hits: { ram: { part: 'mawL', x0: 0.2, x1: 1.5, y0: 0, y1: 1.0, dmg: 18, kb: 600, stun: 0.5, sfx: 'ram' } },
        phases: [
          { from: 0, to: 11, dur: 0.85, tele: true, sfx: 'bossRoar3' },
          { from: 14, to: 19, dur: 1.7, hit: 'ram', vx: 980, until: 'wall', loop: [16, 19, 18], armor: true },
          { from: 36, to: 55, dur: 0.6 },
        ],
      },
      sweep: {
        motion: 'TailSweep', hits: {
          spin: { part: 'tailswingH', x0: -1.9, x1: 1.9, y0: 0, y1: 0.95, dmg: 14, kb: 520, stun: 0.5, sfx: 'whoosh', both: true },
          slam: { ring: true, dmg: 18, kb: 560, stun: 0.5, sfx: 'quake', both: true },
        },
        phases: [
          { from: 0, to: 6, dur: 0.55, tele: true, sfx: 'growl' },
          { from: 6, to: 38, dur: 1.0, hit: 'spin', sfx: 'whoosh' },
          { from: 38, to: 47, dur: 0.35 },
          { from: 47, to: 60, dur: 0.45, hit: 'slam', ev: 'slamWave', sfx: 'quake' },
          { from: 60, to: 87, dur: 0.7 },
        ],
      },
    },
  },

  // ================= 版2.0：新しい雑魚とボス（絵は本編 RPG1/img/battle_motion のコピー）。歩き（Walk）の絵が無いので歩きは待機の速回しで代用（assets/motion_map.js に「代用」の理由つき）=================

  // 雑魚：マンモス（重い・突進と牙）。体力は元の値 150 → 雑魚の倍率 3 で 450（トリケラの 240・アンキロの 360 より多い）。
  Mammoth: {
    label: 'マンモス', artFacing: -1, scale: 1.2,
    motions: ['Idle', 'Bite', 'Tackle', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.95 },
    hp: 150, score: 1200, speed: 70, tier: 'grunt',
    ai: { type: 'multi', moves: [
      { id: 'gore', range: [0, 1.5], w: 3, cd: 1.2 },
      { id: 'rush', range: [2.0, 99], w: 3, cd: 4.5 },
    ], gap: [0.6, 1.4] },
    moves: {
      gore: {   // 牙のなぎ上げ
        motion: 'Bite', hits: { gore: { part: 'maw', x0: 0.2, x1: 1.5, y0: 0, y1: 1.0, dmg: 14, kb: 380, stun: 0.35, sfx: 'bite' } },
        phases: [
          { from: 0, to: 26, dur: 0.65, tele: true, sfx: 'growl' },
          { from: 28, to: 44, dur: 0.24, hit: 'gore', sfx: 'bite', lunge: 60 },
          { from: 48, to: 62, dur: 0.5 },
        ],
      },
      rush: {   // 突進（壁に当たると目を回す）
        motion: 'Tackle', hits: { ram: { part: 'maw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 18, kb: 560, stun: 0.45, sfx: 'ram' } },
        phases: [
          { from: 0, to: 16, dur: 0.85, tele: true, sfx: 'growl' },
          { from: 20, to: 30, dur: 1.5, hit: 'ram', vx: 720, until: 'wall', loop: [22, 30, 20], armor: true },
          { from: 32, to: 40, dur: 0.5, vx: 260, armor: true },
          { from: 44, to: 62, dur: 0.6 },
        ],
      },
    },
  },

  // 2-4 ボス：ティタノサウルス（巨体・重い・ゆっくり・一撃が大きい）。尻尾の動きは本編に無いので、首のなぎ払いと踏みつけ（前足を上げて叩きつけ→地面の輪）で組む。
  Titanosaurus: {
    label: 'ティタノサウルス', artFacing: -1, scale: 2.4, stompScale: 2, boss: true,   // 版2.1：Nao「大きさを2倍・高さも横幅も」＝scale 1.2→2.4（画面で約554×274→約1108×548）。stompScale＝踏みつけの輪の出だしを体の大きさに合わせる倍率
    motions: ['Idle', 'Bite', 'Charge', 'Down', 'Downed', 'Walk'],
    cutin: { kind: 'titanoQuake', dir: 'assets/fx/titano_quake_eye', n: 10, aspect: 3.0 },      // 版2.7：ティタノクエイクの目のカットイン（本編の動画 ティタノクエイク.webm から切り出し）
    hurt: { w: 0.5, y0: 0.0, y1: 0.7 },
    hp: 900, score: 12000, speed: 52, tier: 'boss', breaker: 'stomp', counter: 'stomp',
    ai: { type: 'boss', spLock: 5.0, moves: [
      { id: 'neck', range: [0, 1.6], w: 3, cd: 1.6 },
      { id: 'stomp', range: [0, 99], w: 2.4, cd: 4.2 },
      { id: 'quake', range: [0, 99], w: 1.6, cd: 17, sp: true },      // 版2.7：必殺技ティタノクエイク
    ], gap: [0.7, 1.5] },
    moves: {
      // ---- 版2.7：ティタノクエイク（本編の必殺技・土＋衝撃）。①力をためる 0.8秒（オーラが燃え上がる・赤い光）②目のカットイン（約0.5秒止まる）③足を高く上げて3回叩きつける：
      //  地面を走る土色の輪が3つ（輪の絵がそのまま当たり。跳べば越える・離れても輪が広がるので跳ぶのが答え）。最後の1回は大きい輪でガードを崩して壁まで吹き飛ばす。
      //  ④首を上げて咆哮（ここは殴れる隙）。パリィは最初の輪だけ。合計 36（8＋8＋14＋壁 6）。
      quake: {
        motion: 'Charge', special: true,
        aura: { phases: [0, 1, 8], boost: 1.5 },
        hits: {
          q1: { ring: true, dmg: 8, kb: 420, stun: 0.4, inv: 0.2, sfx: 'quake', both: true },
          q2: { ring: true, dmg: 8, kb: 420, stun: 0.4, inv: 0.2, sfx: 'quake', both: true, noParry: true },
          q3: { ring: true, dmg: 14, kb: 40, stun: 1.0, inv: 1.3, sfx: 'quake', both: true, breakGuard: true, noParry: true, slam: { dmg: 6 } },
        },
        phases: [
          { from: 0, to: 18, dur: 0.8, tele: true, sfx: 'bossRoar' },
          { from: 18, to: 18, dur: 0.06, tele: true, ev: 'cutIn', sfx: 'powerup' },
          { from: 19, to: 31, dur: 0.4 },
          { from: 33, to: 38, dur: 0.22, hit: 'q1', ev: 'quakeWave', sfx: 'quake' },
          { from: 19, to: 31, dur: 0.42 },
          { from: 33, to: 38, dur: 0.22, hit: 'q2', ev: 'quakeWave', sfx: 'quake' },
          { from: 19, to: 31, dur: 0.46 },
          { from: 33, to: 38, dur: 0.3, hit: 'q3', ev: 'quakeWave', big: 1.25, sfx: 'quake' },
          { m: 'Bite', from: 24, to: 30, dur: 0.7, sfx: 'bossRoar2' },
          { from: 39, to: 61, dur: 0.6 },
        ],
      },
      neck: {   // 首のなぎ払い：長い首を前へ叩きつける（遅い・重い）
        motion: 'Bite', hits: { neck: { part: 'body', x0: 0.1, x1: 1.3, y0: 0, y1: 0.42, dmg: 17, kb: 520, stun: 0.5, sfx: 'bossBite' } },   // 版2.1：体を2倍にしたら、首を振り抜く高さが主人公の頭の上（約260px）を通って口の判定が当たらなくなったので、首が前をなぎ払う範囲（前 0.1〜1.3 半幅＝約55〜720px・高さ 0.42 体高＝約230px）の中にある体の絵（前脚・胸・首のつけ根）に当てる
        phases: [
          { from: 0, to: 24, dur: 1.0, tele: true, sfx: 'growl' },
          { from: 24, to: 39, dur: 0.32, hit: 'neck', sfx: 'whoosh', lunge: 60 },
          { from: 39, to: 53, dur: 0.7 },
        ],
      },
      stomp: {  // 巨体の踏みつけ：前足を高く上げ、叩きつけて地面を走る輪を出す
        motion: 'Charge', hits: {
          slam: { part: 'low', overhead: true, x0: 0.2, x1: 1.5, y0: 0, y1: 0.55, dmg: 20, kb: 600, stun: 0.55, sfx: 'quake' },
          wave: { ring: true, dmg: 16, kb: 520, stun: 0.5, sfx: 'quake', both: true },
        },
        phases: [
          { from: 0, to: 30, dur: 1.3, tele: true, sfx: 'bossRoar' },
          { from: 31, to: 34, dur: 0.12, hit: 'slam', sfx: 'quake' },
          { from: 35, to: 38, dur: 0.18, hit: 'wave', ev: 'stompWave', sfx: 'quake' },
          { from: 39, to: 61, dur: 0.9 },
        ],
      },
    },
  },

  // 3-4 ボス：ケツァルコアトルス（空を飛ぶ。浮く時間が長く、急降下・つつき・羽ばたきの風）。
  Quetzalcoatlus: {
    label: 'ケツァルコアトルス', artFacing: -1, scale: 1.7, boss: true, flying: true,
    motions: ['Idle', 'Bite', 'Charge', 'FlyStart', 'Damage', 'Down', 'Downed', 'Revive'],
    cutin: { kind: 'downburst', dir: 'assets/fx/downburst_eye', n: 10, aspect: 640 / 166 },      // 版2.7：ダウンバーストの目のカットイン（本編の動画 ダウンバースト.webm から切り出し）
    hurt: { w: 0.5, y0: 0.0, y1: 0.95 },
    hp: 1000, score: 14000, speed: 130, tier: 'boss', breaker: 'gust', counter: 'gust',
    ai: { type: 'flyer', altitude: 250, wave: 40, diveEvery: [3.0, 4.6], hover: true, moves: [
      { id: 'dive', w: 3, cd: 2.5 },
      { id: 'peck', w: 3, cd: 2.0 },
      { id: 'gust', w: 2.2, cd: 4.0 },
      { id: 'downburst', w: 1.6, cd: 16 },      // 版2.7：必殺技ダウンバースト
    ] },
    moves: {
      // ---- 版2.7：ダウンバースト（本編の必殺技・風＋衝撃）。①翼を打ってため 0.9秒（オーラ・赤い光）②目のカットイン（約0.5秒止まる）③高く舞い上がって画面の上へ
      //  ④地面に白い輪の目印（最初の約0.5秒は主人公を追い、そのあと固定される＝離れればかわせる）⑤風の柱が落ちる（柱の幅の全高が当たり・上から落ちるのでガードできない＝overhead・ガードを崩す印も付き・パリィ不可）
      //  ⑥柱が着地して広がる輪（跳べば越える・パリィは輪だけ可）⑦空から戻って咆哮（ここは殴れる隙）。合計 36（柱 22＋輪 14）。
      downburst: {
        motion: 'FlyStart', special: true,
        aura: { phases: [0, 1, 6], boost: 1.5 },
        hits: {
          pillar: { ring: true, pillar: true, overhead: true, dmg: 22, kb: 360, stun: 0.9, inv: 0.3, sfx: 'quake', breakGuard: true, noParry: true },
          impact: { ring: true, ground: true, dmg: 14, kb: 460, stun: 0.5, inv: 0.5, sfx: 'whoosh', both: true },
        },
        phases: [
          { from: 0, to: 16, dur: 0.9, tele: true, sfx: 'screech' },
          { from: 16, to: 16, dur: 0.06, tele: true, ev: 'cutIn', sfx: 'powerup' },
          { from: 16, to: 22, dur: 0.4, ev: 'dbRise', sfx: 'whoosh' },
          { from: 22, to: 22, dur: 0.9, ev: 'dbMark' },
          { from: 22, to: 22, dur: 0.45, hit: 'pillar', ev: 'dbSlam', sfx: 'quake' },
          { from: 22, to: 22, dur: 0.3, hit: 'impact', ev: 'dbImpact', sfx: 'whoosh' },
          { from: 16, to: 22, dur: 0.7, sfx: 'screech', fly: 520 },      // 空から戻ってくる（縦の速さ）
        ],
      },
      dive: {   // 急降下：高く構えてから、主人公めがけて一直線に降りる（地面すれすれで抜ける）
        motion: 'Charge', hits: { dive: { part: 'maw+low', overhead: true, x0: 0.0, x1: 1.3, y0: 0, y1: 1.1, dmg: 15, kb: 520, stun: 0.5, sfx: 'bossBite' } },
        phases: [
          { from: 0, to: 21, dur: 1.0, tele: true, sfx: 'screech' },
          { from: 33, to: 51, dur: 0.85, hit: 'dive', ev: 'dive', loop: [36, 51, 20], speed: 820 },
          { from: 54, to: 63, dur: 0.55, ev: 'diveEnd' },
        ],
      },
      peck: {   // つつき：短く構えて、低く素早く突っ込む（急降下より速くて浅い）
        motion: 'Bite', hits: { peck: { part: 'maw+low', x0: 0.0, x1: 1.5, y0: 0, y1: 1.1, dmg: 11, kb: 380, stun: 0.4, sfx: 'bite' } },
        phases: [
          { from: 0, to: 15, dur: 0.55, tele: true, sfx: 'screech' },
          { from: 15, to: 36, dur: 0.6, hit: 'peck', ev: 'dive', speed: 1050 },
          { from: 39, to: 49, dur: 0.5, ev: 'diveEnd' },
        ],
      },
      gust: {   // 羽ばたきの風：空中でその場に浮いたまま大きく羽ばたき、地面を走る風の輪を2つ出す（跳べば越えられる）
        motion: 'FlyStart', hits: { wind: { ring: true, dmg: 12, kb: 460, stun: 0.5, sfx: 'whoosh', both: true } },
        phases: [
          { from: 0, to: 16, dur: 0.9, tele: true, sfx: 'screech' },
          { from: 16, to: 22, dur: 0.45, hit: 'wind', ev: 'gustWave', sfx: 'whoosh' },
          { from: 22, to: 26, dur: 0.6 },
        ],
      },
    },
  },

  // 5-4 ボス：スピノサウルス四天王。主人公と同じ系統の技（噛みつき・爪・ダッシュ体当たり）を、大きく強く。ライバル（最終面）とは別の個性＝正面から押してくる近接の三枚。
  SpinosaurusBoss: {
    label: 'スピノサウルス四天王', artFacing: -1, scale: 1.5, boss: true,
    motions: ['Idle', 'Bite', 'Charge', 'Scratch', 'Damage', 'Down', 'Downed', 'Revive', 'Walk', 'Drag', 'Spin'],
    cutin: { kind: 'spinoFury', dir: 'assets/fx/spino_fury_eye', n: 10, aspect: 640 / 166 },      // 版2.7：フューリーの目のカットイン（本編の動画 スピノフューリー.webm の目のアップ 0.5 秒を切り出した連番）
    hurt: { w: 0.46, y0: 0.0, y1: 0.86 },
    hp: 1700, score: 25000, speed: 95, tier: 'boss', breaker: 'claw', counter: 'claw',
    // 版2.3：必殺技を2つ。版2.7：スピノフューリーを本編の動画どおりに作り直し（fury＝力をため→目のカットイン→咆哮の輪→回転なぎ払い→仁王立ちの咆哮）、旧スピノフューリーは rush＝スピノラッシュとして残す（出す頻度は下げた）
    // sp＝必殺技の印（どれかを出したら spLock 秒は、ほかの必殺技を出さない）
    ai: { type: 'boss', spLock: 5.0, moves: [
      { id: 'bite', range: [0, 1.6], w: 3, cd: 0.6 },
      { id: 'claw', range: [0, 1.7], w: 2.6, cd: 1.0 },
      { id: 'dash', range: [2.0, 99], w: 3, cd: 3.2 },
      { id: 'fury', range: [0.3, 1.8], w: 2.4, cd: 14, sp: true },      // なぎ払いが届く間合い（尻尾の長さ＋回りながら前へ進む）だけで出す
      { id: 'rush', range: [0.3, 3.2], w: 1.0, cd: 16, sp: true },      // 版2.7：旧フューリー（体当たり→噛み・爪の連続）。頻度は w 2.2→1.0・cd 13→16
      { id: 'drag', range: [0.3, 2.6], w: 2.0, cd: 11, sp: true },
    ], gap: [0.3, 0.7] },
    moves: {
      // ---- 版2.7：スピノフューリー（本編の動画どおり）。
      //  ①力をためる 0.75秒（怒りのオーラが燃え上がる・赤い光と「!」）②目のカットイン（画面が約0.5秒止まる）③咆哮（地を這う衝撃の輪・跳べば越える・小ダメージで押す）
      //  ④回転なぎ払い（体を縦の軸で3回転・尻尾が前にも後ろにも当たる・6回の通り道）⑤仁王立ちの咆哮（ここは殴れる隙）。
      //  なぎ払いの当たり：絵の形（部位 sweep＝尻尾の付け根まで）。多段（4）で、最後の一撃だけガードを崩して壁まで吹き飛ばす。ガードは最後の一撃までは止まる（CP が減る）が、
      //  はじき返さない（noRepel）。パリィできるのは最初の一撃だけ（noParry は2発目以降）。かわし方：尻尾の高さ（体の中ほどまで）を跳び越える／届く範囲（尻尾の長さ＋前へ進む分）の外へ出る／咆哮の輪も跳ぶ。
      //  合計 37（輪 3＋なぎ払い 4×5＋最後 10＋壁 4・体力 100・ふつうの倍率前）。
      fury: {
        motion: 'Charge', special: true,
        aura: { phases: [0, 1, 2, 9], boost: 1.5 },      // 描画：オーラが燃え上がる区間（ため・カットイン・咆哮・締めの咆哮）
        hits: {
          shock: { ring: true, dmg: 3, kb: 240, stun: 0.3, inv: 0.2, sfx: 'quake' },
          finRing: { ring: true, dmg: 4, kb: 240, stun: 0.3, inv: 0.2, sfx: 'quake', both: true },      // 2026-10-24：最後の一撃の白い輪・光の輪の当たり（描いた輪の線が当たる）
          sw: { part: 'area', x0: -1.45, x1: 1.45, y0: 0, y1: 0.58, both: true, dmg: 4, kb: 70, stun: 0.3, inv: 0.05, noRepel: true, noParry: true, sfx: 'whoosh' },
          sw1: { part: 'area', x0: -1.45, x1: 1.45, y0: 0, y1: 0.58, both: true, dmg: 4, kb: 70, stun: 0.3, inv: 0.05, noRepel: true, sfx: 'whoosh' },      // 最初の一撃だけパリィできる
          fin: { part: 'area', x0: -1.45, x1: 1.45, y0: 0, y1: 0.58, both: true, dmg: 10, kb: 40, stun: 1.0, inv: 1.3, breakGuard: true, noRepel: true, noParry: true, slam: { dmg: 4 }, sfx: 'ram' },
        },
        phases: [
          { from: 0, to: 24, dur: 0.75, tele: true, sfx: 'growl' },
          { from: 24, to: 24, dur: 0.06, tele: true, ev: 'furyCut', sfx: 'powerup' },
          { m: 'Bite', from: 24, to: 32, dur: 0.55, hit: 'shock', ev: 'furyRoar', sfx: 'special' },
          // 回転の専用アニメ化（版2.7 のあと）：回転は「専用のアニメ Spin」（Flow の動画から作った40コマの一周＝左向き→背中→右向き→正面→左向き）。前半（0〜19）と後半（20〜39）を3回続ける。
          //  yaw は絵の角度の記録（白い竜巻の弧と土ぼこりの位置に使う）。art:true＝絵そのものが回るので、横に縮めたり反転したりしない。win＝その区間のうち角度が進む割合（残りは構えの姿勢）。
          { m: 'Spin', from: 0, to: 19, dur: 0.30, hit: 'sw1', lunge: 26, lungeStop: 0.32, sfx: 'whoosh', pose: { yaw: { from: 0, to: Math.PI, art: true, win: [0.15, 1] } } },
          { m: 'Spin', from: 20, to: 39, dur: 0.26, hit: 'sw', lunge: 22, lungeStop: 0.32, ev: 'sweepDust', sfx: 'whoosh', pose: { yaw: { from: Math.PI, to: Math.PI * 2, art: true, win: [0, 0.75] } } },
          { m: 'Spin', from: 0, to: 19, dur: 0.22, hit: 'sw', lunge: 20, lungeStop: 0.32, sfx: 'whoosh', pose: { yaw: { from: Math.PI * 2, to: Math.PI * 3, art: true, win: [0.15, 1] } } },
          { m: 'Spin', from: 20, to: 39, dur: 0.22, hit: 'sw', lunge: 20, lungeStop: 0.32, ev: 'sweepDust', sfx: 'whoosh', pose: { yaw: { from: Math.PI * 3, to: Math.PI * 4, art: true, win: [0, 0.75] } } },
          { m: 'Spin', from: 0, to: 19, dur: 0.24, hit: 'sw', lunge: 22, lungeStop: 0.32, sfx: 'whoosh', pose: { yaw: { from: Math.PI * 4, to: Math.PI * 5, art: true, win: [0.15, 1] } } },
          { m: 'Spin', from: 20, to: 39, dur: 0.30, hit: 'fin', lunge: 26, lungeStop: 0.32, ev: 'sweepFin', sfx: 'ram', pose: { yaw: { from: Math.PI * 5, to: Math.PI * 6, art: true, win: [0, 0.75] } } },
          { m: 'Bite', from: 24, to: 32, dur: 0.6, sfx: 'bossRoar3' },
          { m: 'Bite', from: 40, to: 63, dur: 0.4 },
        ],
      },
      // ---- 版2.3：旧スピノフューリー（版2.7 から スピノラッシュ）。予兆→体当たりで詰める→噛み・爪・噛み・爪→最後の爪で打ち上げて壁へ叩きつける。
      // 当たるたびに次の当たりまで硬直が続く（つなぎ）。ガードは最初の数発を止めるが、2発目の噛み（breakGuard）で崩れる。最初の体当たり ram は 2026-10-26 から顔と背びれ（maw+fin）＝跳んでも当たる（Nao 選択 B）。
      rush: {
        motion: 'Charge', special: true,
        hits: {
          ram: { part: 'maw+fin', x0: 0.2, x1: 1.5, y0: 0, y1: 0.95, dmg: 6, kb: 40, stun: 0.55, inv: 0.05, sfx: 'ram' },
          b1: { part: 'maw+mouth+fin', x0: 0.2, x1: 1.6, y0: 0, y1: 1.0, dmg: 5, kb: 40, stun: 0.5, inv: 0.05, sfx: 'bossBite' },
          c1: { part: 'claw', x0: 0.1, x1: 1.7, y0: 0, y1: 0.95, dmg: 4, kb: 40, stun: 0.5, inv: 0.05, sfx: 'scratch' },
          b2: { part: 'maw+mouth+fin', x0: 0.2, x1: 1.6, y0: 0, y1: 1.0, dmg: 5, kb: 40, stun: 0.5, inv: 0.05, breakGuard: true, sfx: 'bossBite' },
          c2: { part: 'claw', x0: 0.1, x1: 1.7, y0: 0, y1: 0.95, dmg: 4, kb: 40, stun: 0.7, inv: 0.05, sfx: 'scratch' },
          fin: { part: 'claw', x0: 0.1, x1: 1.8, y0: 0, y1: 1.0, dmg: 8, kb: 40, stun: 1.0, inv: 1.3, breakGuard: true, slam: { dmg: 5 }, sfx: 'ram' },
        },
        phases: [
          { from: 0, to: 24, dur: 0.9, tele: true, sfx: 'bossRoar3' },
          { from: 32, to: 48, dur: 0.5, hit: 'ram', vx: 1100, stopOnHit: true, loop: [36, 48, 22], armor: true },
          { m: 'Bite', from: 24, to: 36, dur: 0.24, hit: 'b1', sfx: 'bossBite', lunge: 70, lungeStop: 0.3 },
          { m: 'Scratch', from: 32, to: 44, dur: 0.26, hit: 'c1', sfx: 'scratch', lunge: 50, lungeStop: 0.3 },
          { m: 'Bite', from: 24, to: 36, dur: 0.24, hit: 'b2', sfx: 'bossBite', lunge: 70, lungeStop: 0.3 },
          { m: 'Scratch', from: 32, to: 44, dur: 0.26, hit: 'c2', sfx: 'scratch', lunge: 50, lungeStop: 0.3 },
          { m: 'Scratch', from: 12, to: 31, dur: 0.34, sfx: 'growl' },
          { m: 'Scratch', from: 32, to: 44, dur: 0.3, hit: 'fin', ev: 'rushFin', sfx: 'ram', lunge: 60, lungeStop: 0.3 },
          { m: 'Scratch', from: 44, to: 63, dur: 0.7 },
        ],
      },
      // ---- 版2.3：引きずり込み。地面すれすれに低く構え（予兆は長い）、大きく噛みついて主人公をくわえ、引きずって地面へ叩きつける。
      // くわえられている間は左右を交互に連打すると早く抜けられる（grab.need 回）。抜ければ叩きつけは無し。跳べば（低い口の下を越える）かわせる。
      drag: {
        motion: 'Drag', special: true,
        // 独立監査 中-1 の検討（2026-10-26）：つかみの部位 maw+mouth は、口先の円（maw）より首・あご側へ 13% 広い。ただしどれも体の中心より前のマス（背中・尾・背びれの判定は 0）で、近距離（間合い 40px）でもくわえる設計（v23_test）に必要。maw だけにすると 40px でつかみが 0 になる（実測）ので、前方限定のこの部位を残した
        grab: { need: 6, tick: 0.4, tickDmg: 2 },
        hits: { grab: { part: 'maw+mouth', x0: 0.0, x1: 1.7, y0: 0, y1: 0.6, dmg: 4, kb: 0, stun: 0.1, breakGuard: true, grab: true, sfx: 'bossBite' } },
        phases: [
          { from: 0, to: 9, dur: 1.1, tele: true, sfx: 'growl' },
          { from: 10, to: 17, dur: 0.34, lunge: 190, lungeStop: 0.45, armor: true },
          { from: 18, to: 22, dur: 0.2, hit: 'grab', stopOnHit: true, lunge: 80, lungeStop: 0.45, sfx: 'bossBite' },
          { from: 23, to: 31, dur: 0.55, onlyMiss: true },
          { from: 23, to: 31, dur: 0.4, onlyGrab: true, hold: true },
          { from: 32, to: 44, dur: 1.0, onlyGrab: true, hold: true, vx: 110 },
          { from: 45, to: 47, dur: 0.12, onlyGrab: true, hold: true },
          { from: 48, to: 52, dur: 0.26, onlyGrab: true, ev: 'dragSlam' },
          { from: 53, to: 64, dur: 0.7, onlyGrab: true, rec: true },
        ],
      },
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.6, y0: 0, y1: 1.0, dmg: 16, kb: 430, stun: 0.4, sfx: 'bossBite' } },
        phases: [
          { from: 0, to: 24, dur: 0.6, tele: true, sfx: 'growl' },
          { from: 24, to: 36, dur: 0.2, hit: 'bite', sfx: 'bossBite', lunge: 110 },
          { from: 40, to: 63, dur: 0.5 },
        ],
      },
      claw: {   // 爪の振り下ろし（ふつうより大きく）。コンボ破りにも使う
        motion: 'Scratch', hits: { claw: { part: 'claw', x0: 0.1, x1: 1.7, y0: 0, y1: 0.95, dmg: 15, kb: 460, stun: 0.45, sfx: 'scratch' } },
        phases: [
          { from: 0, to: 30, dur: 0.6, tele: true, sfx: 'growl' },
          { from: 32, to: 44, dur: 0.22, hit: 'claw', sfx: 'scratch', lunge: 80 },
          { from: 44, to: 63, dur: 0.5 },
        ],
      },
      dash: {   // ダッシュ体当たり（壁まで走る・ガードは崩せず止められる）
        motion: 'Charge', hits: { ram: { part: 'maw+fin', x0: 0.2, x1: 1.5, y0: 0, y1: 0.95, dmg: 19, kb: 620, stun: 0.5, sfx: 'ram' } },
        phases: [
          { from: 0, to: 24, dur: 0.8, tele: true, sfx: 'bossRoar3' },
          { from: 32, to: 48, dur: 1.6, hit: 'ram', vx: 1000, until: 'wall', loop: [36, 48, 22], armor: true },
          { from: 52, to: 63, dur: 0.6 },
        ],
      },
    },
  },

  // ================= 版2.1：恐竜アニメ担当の「使ってよい恐竜の一覧」から（絵は本編の出荷済み。歩きは待機の速回しで代用→Flow の歩きができたら差し替え）=================
  // 雑魚：あばれラプトル（素早い・軽い・群れで来る。噛みつきとひっかく）
  VelociraptorR: {
    label: 'あばれラプトル', artFacing: -1, scale: 1.5,
    motions: ['Idle', 'Bite', 'Claw', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 30, score: 400, speed: 140, tier: 'grunt', hop: true,      // 版2.6：跳べる雑魚
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 0.9 },
      { id: 'claw', range: [0, 1.4], w: 2.5, cd: 1.1 },
    ], gap: [0.4, 0.9] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.5, y0: 0, y1: 0.95, dmg: 7, kb: 240, stun: 0.25, sfx: 'bite' } },
        phases: [
          { from: 0, to: 19, dur: 0.4, tele: true },
          { from: 20, to: 27, dur: 0.14, hit: 'bite', sfx: 'bite', lunge: 90 },
          { from: 28, to: 55, dur: 0.45 },
        ],
      },
      claw: {
        motion: 'Claw', hits: { claw: { part: 'claw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 6, kb: 220, stun: 0.25, sfx: 'scratch' } },
        phases: [
          { from: 0, to: 13, dur: 0.4, tele: true },
          { from: 14, to: 21, dur: 0.14, hit: 'claw', sfx: 'scratch', lunge: 70 },
          { from: 22, to: 50, dur: 0.45 },
        ],
      },
    },
  },

  // 雑魚：トロオドン（いちばん軽くて速い。噛みつきとひっかくの小技を素早く）
  TroodonR: {
    label: 'トロオドン', artFacing: -1, scale: 1.5,
    motions: ['Idle', 'Bite', 'Claw', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 25, score: 350, speed: 150, tier: 'grunt', hop: true,      // 版2.6：跳べる雑魚
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 0.8 },
      { id: 'claw', range: [0, 1.4], w: 2.5, cd: 1.0 },
    ], gap: [0.35, 0.8] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.5, y0: 0, y1: 0.95, dmg: 6, kb: 220, stun: 0.25, sfx: 'bite' } },
        phases: [
          { from: 0, to: 11, dur: 0.35, tele: true },
          { from: 12, to: 21, dur: 0.14, hit: 'bite', sfx: 'bite', lunge: 90 },
          { from: 22, to: 40, dur: 0.4 },
        ],
      },
      claw: {
        motion: 'Claw', hits: { claw: { part: 'claw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 5, kb: 200, stun: 0.25, sfx: 'scratch' } },
        phases: [
          { from: 0, to: 17, dur: 0.4, tele: true },
          { from: 18, to: 26, dur: 0.16, hit: 'claw', sfx: 'scratch', lunge: 70 },
          { from: 27, to: 40, dur: 0.4 },
        ],
      },
    },
  },

  // 雑魚：エウオプロケファルス（尾のこぶの盾役。ガード高め・重い・ゆっくり）
  EuoplocephalusR: {
    label: 'エウオプロケファルス', artFacing: -1, scale: 0.95,
    motions: ['Idle', 'Bite', 'Charge', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.95 },
    hp: 110, score: 900, speed: 55, tier: 'grunt',
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 1.4 },
      { id: 'charge', range: [2.0, 99], w: 2, cd: 5.0 },
    ], gap: [0.8, 1.6] },
    moves: {
      bite: {
        motion: 'Bite', hits: {   // 頭の噛みつき（2026-10-25 Nao「尾に当たり判定はいらん」：尾のこぶの叩き落とし club の当たりは外した。動きだけ残す）
          bite: { part: 'maw', x0: 0.2, x1: 1.5, y0: 0, y1: 1.0, dmg: 8, kb: 260, stun: 0.3, sfx: 'bite' },
        },
        phases: [
          { from: 0, to: 14, dur: 0.6, tele: true },
          { from: 15, to: 20, dur: 0.16, hit: 'bite', sfx: 'bite', lunge: 40 },
          { from: 21, to: 27, dur: 0.22, sfx: 'whoosh' },
          { from: 28, to: 48, dur: 0.5 },
        ],
      },
      charge: {
        motion: 'Charge', hits: { ram: { part: 'maw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 14, kb: 480, stun: 0.4, sfx: 'ram' } },
        phases: [
          { from: 0, to: 8, dur: 0.8, tele: true, sfx: 'growl' },
          { from: 9, to: 21, dur: 1.5, hit: 'ram', vx: 520, until: 'wall', loop: [12, 21, 20], armor: true },
          { from: 24, to: 41, dur: 0.7, vx: 200, armor: true },
        ],
      },
    },
  },

  // ================= 版3.4：恐竜アニメ担当の「アクション揃い一覧」（2026-10-14）から新しい雑魚9種。絵は本編の出荷済み（右向きの5種は tools/roster/import_roster.py が左右反転して取り込み＝artFacing:-1 のまま）。
  //  歩きの絵が無いので歩きは待機の速回しで代用（motion_map.js に理由つき・Flow の歩きができたら差し替える）。弱り・喜びは使わない。ガードはしない（GUARD_WHO に入れない）。scale は「体の実際の大きさ順」になるよう待機の高さから決めた（tools/roster_test.mjs が順を検査する）。 =================
  // 雑魚：コンプソグナトゥス（いちばん小さい・軽い・素早い群れ。噛みつきとひっかく）
  CompsognathusR: {
    label: 'コンプソグナトゥス', artFacing: -1, scale: 1.17, motionScale: { Walk: 1.04 },   // 版3.7 歩きの大きさ
    motions: ['Idle', 'Bite', 'Claw', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 20, score: 300, speed: 165, tier: 'grunt', hop: true,
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 0.8 },
      { id: 'claw', range: [0, 1.4], w: 2.5, cd: 1.0 },
    ], gap: [0.35, 0.8] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.5, y0: 0, y1: 0.95, dmg: 5, kb: 220, stun: 0.25, sfx: 'bite' } },
        phases: [
          { from: 0, to: 16, dur: 0.38, tele: true },
          { from: 17, to: 26, dur: 0.15, hit: 'bite', sfx: 'bite', lunge: 90 },
          { from: 27, to: 42, dur: 0.35 },
        ],
      },
      claw: {
        motion: 'Claw', hits: { claw: { part: 'claw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 4, kb: 200, stun: 0.25, sfx: 'scratch' } },
        phases: [
          { from: 0, to: 18, dur: 0.4, tele: true },
          { from: 19, to: 25, dur: 0.14, hit: 'claw', sfx: 'scratch', lunge: 70 },
          { from: 26, to: 42, dur: 0.35 },
        ],
      },
    },
  },

  // 雑魚：ヒプシロフォドン（小型・素早い・軽い。小走りの群れ）
  Hypsilophodon: {
    label: 'ヒプシロフォドン', artFacing: -1, scale: 1.37,
    motions: ['Idle', 'Bite', 'Claw', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 28, score: 380, speed: 160, tier: 'grunt', hop: true,
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 0.9 },
      { id: 'claw', range: [0, 1.4], w: 2.5, cd: 1.0 },
    ], gap: [0.35, 0.85] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.5, y0: 0, y1: 0.95, dmg: 6, kb: 230, stun: 0.25, sfx: 'bite' } },
        phases: [
          { from: 0, to: 22, dur: 0.42, tele: true },
          { from: 23, to: 32, dur: 0.15, hit: 'bite', sfx: 'bite', lunge: 85 },
          { from: 33, to: 49, dur: 0.38 },
        ],
      },
      claw: {
        motion: 'Claw', hits: { claw: { part: 'claw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 5, kb: 210, stun: 0.25, sfx: 'scratch' } },
        phases: [
          { from: 0, to: 15, dur: 0.4, tele: true },
          { from: 16, to: 20, dur: 0.13, hit: 'claw', sfx: 'scratch', lunge: 70 },
          { from: 21, to: 34, dur: 0.35 },
        ],
      },
    },
  },

  // 雑魚：ディメトロドン（帆の背中・低く構えた中型。噛みつきと体当たり）
  DimetrodonR: {
    label: 'ディメトロドン', artFacing: -1, scale: 1.045,
    motions: ['Idle', 'Bite', 'Charge', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 60, score: 800, speed: 90, tier: 'grunt',
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 1.2 },
      { id: 'charge', range: [2.0, 99], w: 2, cd: 5.0 },
    ], gap: [0.6, 1.3] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.55, y0: 0, y1: 0.95, dmg: 10, kb: 260, stun: 0.3, sfx: 'bite' } },
        phases: [
          { from: 0, to: 19, dur: 0.5, tele: true },
          { from: 20, to: 27, dur: 0.16, hit: 'bite', sfx: 'bite', lunge: 70 },
          { from: 28, to: 37, dur: 0.4 },
        ],
      },
      charge: {   // 体当たり（壁まで突進。当たれば目を回さず、外れて壁にぶつかると確率で目を回す＝既存の突進の仕組み）
        motion: 'Charge', hits: { ram: { part: 'maw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 14, kb: 480, stun: 0.4, sfx: 'ram' } },
        phases: [
          { from: 0, to: 15, dur: 0.8, tele: true, sfx: 'growl' },
          { from: 16, to: 37, dur: 1.5, hit: 'ram', vx: 540, until: 'wall', loop: [19, 37, 22], armor: true },
          { from: 38, to: 47, dur: 0.5, vx: 220, armor: true },
          { from: 48, to: 57, dur: 0.5 },
        ],
      },
    },
  },

  // 雑魚：イグアノドン（親指のスパイク・ゆっくり重い。噛みつきと体当たり）
  IguanodonR: {
    label: 'イグアノドン', artFacing: -1, scale: 1.145,
    motions: ['Idle', 'Bite', 'Charge', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.95 },
    hp: 90, score: 1000, speed: 75, tier: 'grunt',
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 1.3 },
      { id: 'charge', range: [2.0, 99], w: 2, cd: 5.0 },
    ], gap: [0.7, 1.5] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.55, y0: 0, y1: 0.95, dmg: 11, kb: 300, stun: 0.3, sfx: 'bite' } },
        phases: [
          { from: 0, to: 19, dur: 0.55, tele: true },
          { from: 20, to: 28, dur: 0.18, hit: 'bite', sfx: 'bite', lunge: 60 },
          { from: 29, to: 46, dur: 0.45 },
        ],
      },
      charge: {
        motion: 'Charge', hits: { ram: { part: 'maw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 16, kb: 520, stun: 0.4, sfx: 'ram' } },
        phases: [
          { from: 0, to: 6, dur: 0.8, tele: true, sfx: 'growl' },
          { from: 7, to: 38, dur: 1.5, hit: 'ram', vx: 580, until: 'wall', loop: [9, 27, 22], armor: true },
          { from: 39, to: 41, dur: 0.45, vx: 240, armor: true },
          { from: 42, to: 43, dur: 0.3 },
        ],
      },
    },
  },

  // 雑魚：カルノタウルス（角の突進型。噛みつきと速い体当たり）
  Carnotaurus: {
    label: 'カルノタウルス', artFacing: -1, scale: 1.15,
    motions: ['Idle', 'Bite', 'Charge', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 80, score: 1100, speed: 105, tier: 'grunt',
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 1.2 },
      { id: 'charge', range: [2.0, 99], w: 3, cd: 4.5 },
    ], gap: [0.6, 1.3] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.55, y0: 0, y1: 0.95, dmg: 13, kb: 300, stun: 0.3, sfx: 'bite' } },
        phases: [
          { from: 0, to: 17, dur: 0.5, tele: true },
          { from: 18, to: 27, dur: 0.17, hit: 'bite', sfx: 'bite', lunge: 70 },
          { from: 28, to: 42, dur: 0.42 },
        ],
      },
      charge: {
        motion: 'Charge', hits: { ram: { part: 'maw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 18, kb: 540, stun: 0.4, sfx: 'ram' } },
        phases: [
          { from: 0, to: 12, dur: 0.75, tele: true, sfx: 'growl' },
          { from: 13, to: 28, dur: 1.5, hit: 'ram', vx: 780, until: 'wall', loop: [16, 28, 24], armor: true },
          { from: 29, to: 33, dur: 0.45, vx: 280, armor: true },
          { from: 34, to: 38, dur: 0.4 },
        ],
      },
    },
  },

  // 雑魚：スコミムス（ワニに似た長い口と大きな爪。噛みつきとひっかく・足が速い）
  Suchomimus: {
    label: 'スコミムス', artFacing: -1, scale: 1.176,
    motions: ['Idle', 'Bite', 'Claw', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 55, score: 700, speed: 130, tier: 'grunt', hop: true,
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 1.1 },
      { id: 'claw', range: [0, 1.4], w: 2.5, cd: 1.2 },
    ], gap: [0.5, 1.1] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.6, y0: 0, y1: 0.95, dmg: 11, kb: 280, stun: 0.3, sfx: 'bite' } },
        phases: [
          { from: 0, to: 22, dur: 0.5, tele: true },
          { from: 23, to: 31, dur: 0.16, hit: 'bite', sfx: 'bite', lunge: 80 },
          { from: 32, to: 48, dur: 0.42 },
        ],
      },
      claw: {
        motion: 'Claw', hits: { claw: { part: 'claw', x0: 0.2, x1: 1.5, y0: 0, y1: 0.95, dmg: 9, kb: 260, stun: 0.3, sfx: 'scratch' } },
        phases: [
          { from: 0, to: 21, dur: 0.5, tele: true },
          { from: 22, to: 28, dur: 0.16, hit: 'claw', sfx: 'scratch', lunge: 70 },
          { from: 29, to: 39, dur: 0.4 },
        ],
      },
    },
  },

  // 雑魚：エオラプトル（版3.6・本編の草原の小さな肉食。ふつうの小型で噛みつきとひっかく・足が速い・跳べる）
  Eoraptor: {
    label: 'エオラプトル', artFacing: -1, scale: 1.2,
    motions: ['Idle', 'Bite', 'Claw', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 26, score: 360, speed: 155, tier: 'grunt', hop: true,
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 1.0 },
      { id: 'claw', range: [0, 1.4], w: 2.5, cd: 1.1 },
    ], gap: [0.4, 0.95] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.55, y0: 0, y1: 0.95, dmg: 6, kb: 240, stun: 0.28, sfx: 'bite' } },
        phases: [
          { from: 0, to: 26, dur: 0.45, tele: true },
          { from: 27, to: 32, dur: 0.16, hit: 'bite', sfx: 'bite', lunge: 85 },
          { from: 33, to: 51, dur: 0.4 },
        ],
      },
      claw: {
        motion: 'Claw', hits: { claw: { part: 'claw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 5, kb: 220, stun: 0.28, sfx: 'scratch' } },
        phases: [
          { from: 0, to: 15, dur: 0.42, tele: true },
          { from: 16, to: 21, dur: 0.15, hit: 'claw', sfx: 'scratch', lunge: 65 },
          { from: 22, to: 34, dur: 0.38 },
        ],
      },
    },
  },

  // 雑魚：アロケントロサウルス（背のトゲの中型の肉食。噛みつきとひっかく）
  AllocentrosaurusR: {
    label: 'アロケントロサウルス', artFacing: -1, scale: 1.28, motionScale: { Walk: 1.01 },   // 版3.7 歩きの大きさ
    motions: ['Idle', 'Bite', 'Claw', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 75, score: 900, speed: 110, tier: 'grunt',
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 1.2 },
      { id: 'claw', range: [0, 1.4], w: 2.5, cd: 1.3 },
    ], gap: [0.5, 1.2] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.55, y0: 0, y1: 0.95, dmg: 12, kb: 280, stun: 0.3, sfx: 'bite' } },
        phases: [
          { from: 0, to: 13, dur: 0.55, tele: true },
          { from: 15, to: 25, dur: 0.18, hit: 'bite', sfx: 'bite', lunge: 70 },
          { from: 26, to: 40, dur: 0.45 },
        ],
      },
      claw: {
        motion: 'Claw', hits: { claw: { part: 'claw', x0: 0.2, x1: 1.45, y0: 0, y1: 0.95, dmg: 10, kb: 260, stun: 0.3, sfx: 'scratch' } },
        phases: [
          { from: 0, to: 26, dur: 0.6, tele: true },
          { from: 27, to: 35, dur: 0.2, hit: 'claw', sfx: 'scratch', lunge: 55 },
          { from: 36, to: 46, dur: 0.42 },
        ],
      },
    },
  },

  // 雑魚：アルバートサウルス（大型の肉食・重い。噛みつきと体当たり）
  Albertosaurus: {
    label: 'アルバートサウルス', artFacing: -1, scale: 1.305,
    motions: ['Idle', 'Bite', 'Charge', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.9 },
    hp: 130, score: 1600, speed: 95, tier: 'grunt',
    ai: { type: 'multi', moves: [
      { id: 'bite', range: [0, 1.5], w: 3, cd: 1.3 },
      { id: 'charge', range: [2.0, 99], w: 2.5, cd: 5.0 },
    ], gap: [0.7, 1.5] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.2, x1: 1.6, y0: 0, y1: 1.0, dmg: 15, kb: 340, stun: 0.35, sfx: 'bite' } },
        phases: [
          { from: 0, to: 19, dur: 0.6, tele: true, sfx: 'growl' },
          { from: 20, to: 27, dur: 0.18, hit: 'bite', sfx: 'bite', lunge: 80 },
          { from: 28, to: 49, dur: 0.5 },
        ],
      },
      charge: {
        motion: 'Charge', hits: { ram: { part: 'maw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 19, kb: 560, stun: 0.45, sfx: 'ram' } },
        phases: [
          { from: 0, to: 16, dur: 0.85, tele: true, sfx: 'growl' },
          { from: 17, to: 34, dur: 1.5, hit: 'ram', vx: 620, until: 'wall', loop: [20, 34, 22], armor: true },
          { from: 35, to: 38, dur: 0.45, vx: 250, armor: true },
          { from: 39, to: 44, dur: 0.4 },
        ],
      },
    },
  },

  // 雑魚：テリジノサウルス（長い爪の大型・重い。爪の振り下ろしと、爪を前に構えて這うような体当たり）
  Therizinosaurus: {
    label: 'テリジノサウルス', artFacing: -1, scale: 1.47,
    motions: ['Idle', 'Claw', 'Charge', 'Damage', 'Down', 'Downed', 'Revive', 'Walk'],
    hurt: { w: 0.5, y0: 0.0, y1: 0.95 },
    hp: 150, score: 1800, speed: 70, tier: 'grunt',
    ai: { type: 'multi', moves: [
      { id: 'claw', range: [0, 1.5], w: 3, cd: 1.4 },
      { id: 'charge', range: [2.0, 99], w: 2.5, cd: 5.0 },
    ], gap: [0.8, 1.6] },
    moves: {
      claw: {
        motion: 'Claw', hits: { claw: { part: 'claw', x0: 0.1, x1: 1.6, y0: 0, y1: 1.0, dmg: 16, kb: 360, stun: 0.4, sfx: 'scratch' } },
        phases: [
          { from: 0, to: 13, dur: 0.65, tele: true, sfx: 'growl' },
          { from: 14, to: 19, dur: 0.18, hit: 'claw', sfx: 'scratch', lunge: 70 },
          { from: 20, to: 35, dur: 0.5 },
        ],
      },
      charge: {
        motion: 'Charge', hits: { ram: { part: 'maw+claw', x0: 0.2, x1: 1.4, y0: 0, y1: 0.95, dmg: 20, kb: 560, stun: 0.45, sfx: 'ram' } },
        phases: [
          { from: 0, to: 17, dur: 0.9, tele: true, sfx: 'growl' },
          { from: 18, to: 34, dur: 1.5, hit: 'ram', vx: 560, until: 'wall', loop: [25, 33, 20], armor: true },
          { from: 35, to: 40, dur: 0.45, vx: 220, armor: true },
          { from: 41, to: 44, dur: 0.35 },
        ],
      },
    },
  },

  // ================= 版3.0（第1段）：海のエリア。水の中を泳ぐ敵（flying＋swim：重力でなく水の中の位置で動く。AI は world.js の aiSwimmer）。絵は本編の出荷済み（待機・噛みつき・ダメージ・尾ひれ攻撃・ダウン・倒れた状態・復活の7本）。泳ぎは待機の絵で代用（第2段で Flow の泳ぎに差し替え）=================
  // 雑魚：イクチオサウルス（イルカに似た細身の海の爬虫類。素早く、噛みつき・尾ひれ・水面からの飛び出し噛みつき）
  Ichthyosaurus: {
    label: 'イクチオサウルス', artFacing: -1, scale: 0.85, flying: true, swim: true,
    motions: ['Idle', 'Bite', 'TailAttack', 'Damage'],      // 本編の Down（沈んで泡になる）・Revive・Downed（透明の1コマ）は使わない＝泳ぐ敵は倒れた状態に入らない（吹き飛んで画面の外へ消える）
    hurt: { w: 0.7, y0: 0.05, y1: 0.95 },
    hp: 40, score: 700, speed: 235, tier: 'grunt',
    ai: { type: 'swimmer', stand: 0.95, wave: 14, gap: [0.5, 1.2], moves: [
      { id: 'bite', range: [0, 2.1], w: 3, cd: 1.2 },
      { id: 'tail', range: [0, 1.1], w: 1.6, cd: 2.0 },
      { id: 'breach', range: [0, 3.6], w: 3, cd: 4.5, air: true },      // air＝主人公が水の上（足場の上・空中）にいるときだけ
    ] },
    moves: {
      bite: {   // 噛みつき：うねりながら構え→大きく口を開ける→主人公めがけて水中を一直線に突っ込んで噛む
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.1, x1: 1.2, y0: 0, y1: 1.0, dmg: 9, kb: 280, stun: 0.3, sfx: 'bite' } },
        phases: [
          { from: 0, to: 14, dur: 0.5, tele: true, sfx: 'growl' },
          { from: 15, to: 24, dur: 0.18 },
          { from: 25, to: 33, dur: 0.3, hit: 'bite', ev: 'swimLunge', speed: 620, sfx: 'bite' },
          { from: 34, to: 42, dur: 0.4, ev: 'swimStop' },
        ],
      },
      tail: {   // 尾ひれ：近づかれたら体をひねって尾ひれで払う（前の水を切る）
        motion: 'TailAttack', hits: { tail: { part: 'tailext', x0: -0.5, x1: 1.0, y0: 0, y1: 1.1, dmg: 8, kb: 320, stun: 0.3, sfx: 'scratch' } },
        phases: [
          { from: 0, to: 22, dur: 0.55, tele: true, sfx: 'growl' },
          { from: 23, to: 26, dur: 0.2, hit: 'tail', sfx: 'scratch' },
          { from: 27, to: 47, dur: 0.6, ev: 'swimStop' },
        ],
      },
      breach: {   // 水面から飛び出して噛みつく：いったん沈んで構え→水面を突き破って跳び上がり（主人公の高さまで）→空中で噛む→水へ戻る
        motion: 'Bite', hits: { bite: { part: 'maw', x0: 0.1, x1: 1.25, y0: 0, y1: 1.05, dmg: 11, kb: 330, stun: 0.35, sfx: 'bite' } },
        phases: [
          { from: 0, to: 14, dur: 0.5, tele: true, ev: 'breachDive', sfx: 'growl' },
          { from: 15, to: 24, dur: 0.22, ev: 'breachUp', sfx: 'whoosh' },
          { from: 25, to: 33, dur: 0.4, hit: 'bite', sfx: 'bite' },
          { from: 34, to: 34, dur: 1.4, until: 'water', hit: 'bite' },      // 2026-10-25（Nao「当たり判定がなくない？」）：跳び上がって空中にいる間（見えている飛び出し）にも噛みつきの当たりを出す。前は水面から出る瞬間の 0.4 秒だけで、跳んでいる間は当たりが無かった
          { from: 35, to: 42, dur: 0.4, ev: 'swimStop' },
        ],
      },
    },
  },

  // 7-4 ボス：モササウルス（四天王。巨大な海の王。噛みつき・尾ひれ・水面から飛び出して噛みつく・水中の体当たり）
  Mosasaurus: {
    label: 'モササウルス', artFacing: -1, scale: 2.0, boss: true, flying: true, swim: true,
    motions: ['Idle', 'Bite', 'TailAttack', 'Damage'],      // 本編の Down（沈んで泡になる）・Revive・Downed（透明の1コマ）は使わない＝泳ぐ敵は倒れた状態に入らない（吹き飛んで画面の外へ消える）
    hurt: { w: 0.72, y0: 0.05, y1: 0.95 },
    hp: 1600, score: 22000, speed: 150, tier: 'boss', breaker: 'tail', counter: 'tail',
    ai: { type: 'swimmer', stand: 1.1, wave: 20, gap: [0.45, 1.0], moves: [
      { id: 'bite', range: [0, 2.0], w: 3, cd: 1.0 },
      { id: 'tail', range: [0, 1.2], w: 2.4, cd: 1.8 },
      { id: 'breach', range: [0, 3.4], w: 3, cd: 5.0, air: true },
      { id: 'rush', range: [1.2, 99], w: 2.2, cd: 5.5 },      // 離れているとき：水を割って一直線の体当たり
    ] },
    moves: {
      bite: {
        motion: 'Bite', hits: { bite: { part: 'fronthalf', x0: 0.1, x1: 1.15, y0: 0, y1: 1.0, dmg: 15, kb: 420, stun: 0.4, sfx: 'bossBite' } },
        phases: [
          { from: 0, to: 7, dur: 0.6, tele: true, sfx: 'bossRoar' },
          { from: 8, to: 11, dur: 0.14 },
          { from: 12, to: 14, dur: 0.26, hit: 'bite', ev: 'swimLunge', speed: 520, sfx: 'bossBite' },
          { from: 15, to: 21, dur: 0.5, ev: 'swimStop' },
        ],
      },
      tail: {   // 尾ひれ叩き：尾を高く振り上げて前へ叩きつける（前の上下に広く当たる）
        motion: 'TailAttack', hits: { tail: { part: 'rearhalf', x0: -0.6, x1: 1.1, y0: 0, y1: 1.3, dmg: 16, kb: 480, stun: 0.45, sfx: 'scratch' } },
        phases: [
          { from: 0, to: 11, dur: 0.7, tele: true, sfx: 'bossRoar' },
          { from: 12, to: 14, dur: 0.15 },
          { from: 15, to: 18, dur: 0.22, hit: 'tail', sfx: 'scratch' },
          { from: 19, to: 27, dur: 0.6, ev: 'swimStop' },
        ],
      },
      breach: {   // 水面からの飛び出し噛みつき：沈んで構え→水面を突き破って大きく跳ぶ→空中で噛む→水面に落ちる（着水の波）
        motion: 'Bite', hits: { bite: { part: 'fronthalf', x0: 0.1, x1: 1.2, y0: 0, y1: 1.05, dmg: 18, kb: 460, stun: 0.45, sfx: 'bossBite' } },
        phases: [
          { from: 0, to: 7, dur: 0.7, tele: true, ev: 'breachDive', sfx: 'bossRoar' },
          { from: 8, to: 11, dur: 0.22, ev: 'breachUp', sfx: 'whoosh' },
          { from: 12, to: 14, dur: 0.45, hit: 'bite', sfx: 'bossBite' },
          { from: 15, to: 15, dur: 1.5, until: 'water', hit: 'bite' },      // 2026-10-25：同上（空中にいる間も噛みつきの当たり）
          { from: 16, to: 21, dur: 0.5, ev: 'swimStop' },
        ],
      },
      rush: {   // 体当たり：少し下がって構え→主人公めがけて水中を一直線
        motion: 'Bite', hits: { ram: { part: 'fronthalf', x0: 0.0, x1: 1.2, y0: 0, y1: 1.0, dmg: 17, kb: 560, stun: 0.5, sfx: 'ram' } },
        phases: [
          { from: 0, to: 7, dur: 0.8, tele: true, ev: 'swimBack', sfx: 'bossRoar3' },
          { from: 12, to: 14, dur: 0.7, hit: 'ram', ev: 'swimLunge', speed: 760, armor: true },
          { from: 15, to: 21, dur: 0.6, ev: 'swimStop' },
        ],
      },
    },
  },

  // ライバル＝最終面の敵。主人公スピノと同じ絵（artOf：色だけ assets/rival_palette.json で置き換える）・同じ技の表（src/rival.js が敵用に読み替える）。
  // 吹き飛ばし・壁・玉突き・打ち上げ・空中で拾うは、ほかの敵と同じく効く（tier:'rival'＝ボスの「打ち上げが効かない」にはしない。体力は多め）。
  SpinoRival: {
    label: 'ライバル スピノサウルス', artFacing: -1, scale: 1.2, artOf: 'Spinosaurus', rival: true,
    motions: ['Idle', 'Bite', 'Scratch', 'Charge', 'Damage', 'Down', 'Downed', 'Revive', 'Victory', 'Weak', 'FlipSlam', 'Run', 'Roar', 'Uplift', 'Stomp', 'Guard', 'Tail', 'Maul', 'ScratchR', 'ScratchL', 'TailLow', 'ScratchR2', 'ScratchL2', 'Swim', 'BiteWater'],
    motionScale: { Revive: 1.2049 },
    hurt: { w: 0.46, y0: 0.0, y1: 0.86 },
    hp: 780, score: 50000, speed: RIVAL_TUNE.speed, tier: 'rival', breaker: 'roar', counter: 'roar',
    ai: { type: 'rival' },
    moves: rivalMoves(PLAYER_MOVES, MOVE_FRAMES.Spinosaurus),   // 主人公の表を敵用に読み替えたもの（表の行は書き換えない）
  },
};

/**
 * 版2.1：「強い色違い」（本編の R 版）。絵・当たりの形・技の表は元の恐竜と同じ（artOf）で、色だけ tint で置き換え、体力・威力・速さを少し上げる。
 * 技の表は元の恐竜のものを写して dmg を掛けるので、元の恐竜の技を直せば色違いにも効く。
 */
function variantOf(base, { label, tint, hpMul, dmgMul, speedMul, score }) {
  const d = JSON.parse(JSON.stringify(DINOS[base]));
  d.label = label; d.artOf = base; d.tint = tint; d.variantOf = base;
  d.hp = Math.round(d.hp * hpMul); d.speed = Math.round(d.speed * speedMul); d.score = score;
  for (const mv of Object.values(d.moves)) for (const h of Object.values(mv.hits || {})) if (h.dmg) h.dmg = Math.round(h.dmg * dmgMul);
  return d;
}
// 色は assets の絵を見て決めた（hue＝色相を回す度数・sat＝彩度の倍率・light＝明るさの倍率）。後半ワールドの雑魚。
DINOS.AllosaurusR = variantOf('Allosaurus', { label: 'アロサウルスR', tint: { hue: 245, sat: 1.0, light: 0.8 }, hpMul: 1.4, dmgMul: 1.3, speedMul: 1.1, score: 900 });
DINOS.TriceratopsR = variantOf('Triceratops', { label: 'トリケラトプスR', tint: { hue: 120, sat: 1.0, light: 0.85 }, hpMul: 1.4, dmgMul: 1.3, speedMul: 1.1, score: 1100 });
DINOS.AnkylosaurusR = variantOf('Ankylosaurus', { label: 'アンキロサウルスR', tint: { hue: 180, sat: 1.0, light: 0.85 }, hpMul: 1.35, dmgMul: 1.25, speedMul: 1.1, score: 1300 });

// 版3.5：海の敵を増やす。①イクチオサウルスR＝強い色違い（青→赤橙・体力×1.4・威力×1.3）。②モササウルス（小型）＝ボスのモササウルスの縮小版の雑魚（絵・コマは同じ・体高はイクチオの約1.4倍・体力はボスの約1/8・速い・突進と水面からの飛び出し噛みつき）。
DINOS.IchthyosaurusR = variantOf('Ichthyosaurus', { label: 'イクチオサウルスR', tint: { hue: 150, sat: 1.05, light: 0.92 }, hpMul: 1.4, dmgMul: 1.3, speedMul: 1.1, score: 1000 });
export const MOSA_SMALL = { scale: 1.1, pxScale: 0.6, hp: 45, speed: 270, score: 1500, dmg: { bite: 11, tail: 10, breach: 13, rush: 14 } };
function smallMosasaur() {
  const d = JSON.parse(JSON.stringify(DINOS.Mosasaurus));
  d.label = 'モササウルス（小型）'; d.artOf = 'Mosasaurus'; d.sharedArt = true;
  d.scale = MOSA_SMALL.scale; d.pxScale = MOSA_SMALL.pxScale;
  delete d.boss; delete d.breaker;
  d.tier = 'grunt'; d.hp = MOSA_SMALL.hp; d.speed = MOSA_SMALL.speed; d.score = MOSA_SMALL.score;
  d.ai = { type: 'swimmer', stand: 0.95, wave: 16, gap: [0.4, 0.9], moves: [
    { id: 'bite', range: [0, 2.0], w: 3, cd: 1.0 },
    { id: 'tail', range: [0, 1.2], w: 1.6, cd: 1.8 },
    { id: 'breach', range: [0, 3.4], w: 3, cd: 4.5, air: true },
    { id: 'rush', range: [1.2, 99], w: 2.6, cd: 4.5 },
  ] };
  const mv = d.moves, T = MOSA_SMALL.dmg;
  mv.bite.hits.bite.dmg = T.bite; mv.tail.hits.tail.dmg = T.tail; mv.breach.hits.bite.dmg = T.breach; mv.rush.hits.ram.dmg = T.rush;
  for (const k of ['bite', 'tail', 'breach', 'rush']) for (const h of Object.values(mv[k].hits)) { h.kb = Math.round(h.kb * 0.75); h.sfx = h.sfx === 'bossBite' ? 'bite' : h.sfx; }
  for (const ph of mv.bite.phases.concat(mv.tail.phases, mv.breach.phases, mv.rush.phases)) if (ph.sfx && /^boss/.test(ph.sfx)) ph.sfx = ph.sfx === 'bossBite' ? 'bite' : 'growl';
  mv.bite.phases.find((p) => p.ev === 'swimLunge').speed = 600;
  mv.rush.phases.find((p) => p.ev === 'swimLunge').speed = 800;
  return d;
}
DINOS.MosasaurusSmall = smallMosasaur();

export const PLAYER = 'Spinosaurus';

/**
 * 版1.1：体力の倍率（1か所）。雑魚（tier:'grunt'）は約3倍、ボス級（boss・rival）は約3分の2。
 * 各恐竜の hp は版1.0 の値（元の値）で書いてあり、ここで掛けた値が d.hp になる（元の値は d.hpBase）。
 */
export const HP_SCALE = { grunt: 3, boss: 0.67, rival: 0.67 };
/**
 * 版1.1b：恐竜の重さ（1か所）。吹き飛ばしの初速（横・縦とも）・お手玉の浮きと押し・玉突きで飛ばされる勢いを、この値で割る。
 * 1 が基準（アロサウルス＝以前の雑魚の飛び方）。大きいほど吹っ飛びにくく・浮きにくい。
 * 版1.1 の launchResist（ボス級の横の耐性 0.45〜0.55）と bossTune.liftMul（打ち上げ 0.35・吹き飛び縦 0.3）は、この重さに一本化した。
 * 前の版1.1 の値の目安：スケルトン 横0.5 縦0.3、ティラノ 横0.5 縦0.3、ギガノト 横0.45 縦0.3、ライバル 横0.55 縦0.3、雑魚 1。
 */
export const WEIGHT = { Pteranodon: 0.9, Allosaurus: 1.0, Triceratops: 1.25, Ankylosaurus: 1.5, SkeletonRex: 2.4, Giganotosaurus: 2.8, Tyrannosaurus: 3.2, SpinoRival: 1.7,
  Mammoth: 2.0, Titanosaurus: 4.5, Quetzalcoatlus: 1.4, SpinosaurusBoss: 2.6,   // 版2.0
  VelociraptorR: 0.7, TroodonR: 0.6, EuoplocephalusR: 1.7, AllosaurusR: 1.1, TriceratopsR: 1.35, AnkylosaurusR: 1.6,   // 版2.1
  CompsognathusR: 0.6, Hypsilophodon: 0.8, DimetrodonR: 1.2, IguanodonR: 1.6, Carnotaurus: 1.5, Suchomimus: 1.1, AllocentrosaurusR: 1.3, Albertosaurus: 1.9, Therizinosaurus: 2.0,   // 版3.4
  Eoraptor: 0.65,   // 版3.6（コンプソ0.6・トロオドン0.6・ヴェロキ0.7の間）
  IchthyosaurusR: 1.05, MosasaurusSmall: 1.3 };   // 版3.5
for (const [k, d] of Object.entries(DINOS)) d.weight = WEIGHT[k] ?? 1;
/**
 * 2026-11-15：地上の雑魚の「追いかけ方」（1か所）。Nao（判断ボード「溶岩の縁で固まる雑魚（6-2・6-3）」への △）
 * 「空中ブロックやジャンプを使って追撃するキャラと、今回の修正のようにするキャラを恐竜べつに分けてほしい。」
 *   'jump'   ＝追撃型。主人公が足場の上・池の向こう（歩いては届かない所）にいるときは、索敵（640px）の外でも徘徊せず、
 *              足場へ跳び上がる・足場から降りる・池を跳び越えるで近づいて攻める（world.js の wanderAI → hopAI／descendAI／池の跳び越え）。
 *              跳ぶ絵（anim.hop）を持つ種に限る（d.hop が無い種に 'jump' を付けても追撃しない）。
 *   'wander' ＝徘徊型。2026-11-14 の徘徊の直しのまま、主人公が索敵の外なら、その場の周りを歩いて待つ。
 * 入れ替えるにはこの表を書き換える（追撃型にしたい種は、跳ぶ絵のある種＝hop: true の種だけ）。表に無い種（ボス・ライバル・飛ぶ・泳ぐ）は触れない。
 */
export const PURSUIT_TYPE = {
  Allosaurus: 'jump', AllosaurusR: 'jump', VelociraptorR: 'jump', TroodonR: 'jump', CompsognathusR: 'jump', Hypsilophodon: 'jump', Suchomimus: 'jump', Eoraptor: 'jump',      // 小さく身軽な獣脚類（と足の速い小型の草食竜）：跳ぶ絵がある
  Triceratops: 'wander', TriceratopsR: 'wander', Ankylosaurus: 'wander', AnkylosaurusR: 'wander', EuoplocephalusR: 'wander', AllocentrosaurusR: 'wander',      // 角竜・鎧竜：重い四足
  Mammoth: 'wander', Therizinosaurus: 'wander', IguanodonR: 'wander', DimetrodonR: 'wander', Carnotaurus: 'wander', Albertosaurus: 'wander' };      // 大柄・四足気味の重い種（跳ぶ絵が無い）
for (const [k, d] of Object.entries(DINOS)) d.pursuit = PURSUIT_TYPE[k] ?? 'wander';
for (const d of Object.values(DINOS)) {
  if (d.hp === undefined || !d.tier) continue;
  d.hpBase = d.hp;
  d.hp = Math.max(1, Math.round(d.hp * (HP_SCALE[d.tier] ?? 1)));
}

/** 絵・コマ数・体の大きさを借りる元の恐竜名（色違いのライバルは主人公のもの）。 */
export const artOf = (type) => DINOS[type].artOf || type;
/** ボス扱いの表示（体力ゲージ・登場の WARNING・倒したときの演出）をする敵。 */
export const isBossLike = (d) => d.tier === 'boss' || !!d.rival;

/**
 * 恐竜の種ごとの咆哮（うなり growl の差し替え先）。
 * 正本は RPG1 の js/plugins/DinoBattleProto.js（ROAR_SPECIES D001〜D051）および docs/spec/12_assets.md §6-3。
 * 色違い（*R・SpinoRival）と小型（MosasaurusSmall）は元の種の咆哮を使う。
 * 本編の D001〜D051 に割り当てが無い種（Ichthyosaurus / IchthyosaurusR / Mammoth / SkeletonRex）は、版3.x（咆哮4種）で新しく作った咆哮を入れる（ElevenLabs 生成・新規）。
 * IchthyosaurusR は Ichthyosaurus の咆哮を流用する。
 */
export const ROAR_SPECIES = {
  Giganotosaurus: 'DR_Giganotosaurus',         // D001 ギガノトサウルス
  SpinosaurusBoss: 'DR_SpinosaurusElite',      // D002 スピノサウルス（四天王個体）
  Mosasaurus: 'DR_Mosasaurus',                 // D003 モササウルス
  MosasaurusSmall: 'DR_Mosasaurus',            // D003 モササウルス（小型は元の種の咆哮）
  Titanosaurus: 'DR_Titanosaurus',             // D004 ティタノサウルス
  Quetzalcoatlus: 'DR_Quetzalcoatlus',         // D005 ケツアルコアトルス
  Triceratops: 'DR_Triceratops',               // D006 トリケラトプス
  TriceratopsR: 'DR_Triceratops',              // D006 トリケラトプス（色違い）
  Allosaurus: 'DR_Allosaurus',                 // D007 アロサウルス
  AllosaurusR: 'DR_Allosaurus',                // D007 アロサウルス（色違い）
  Pteranodon: 'DR_Pteranodon',                 // D008 プテラノドン
  Spinosaurus: 'DR_Spinosaurus',               // D009 スピノサウルス
  SpinoRival: 'DR_Spinosaurus',                // D009 スピノサウルス（色違いのライバル）
  Tyrannosaurus: 'DR_Tyrannosaurus',           // D010 ティラノサウルス
  VelociraptorR: 'DR_Velociraptor',            // D012 ヴェロキラプトル（色違い）
  Ankylosaurus: 'DR_Ankylosaurus',             // D015 アンキロサウルス
  AnkylosaurusR: 'DR_Ankylosaurus',            // D015 アンキロサウルス（色違い）
  Carnotaurus: 'DR_Carnotaurus',               // D017 カルノタウルス
  IguanodonR: 'DR_Iguanodon',                  // D019 イグアノドン（色違い）
  Suchomimus: 'DR_Suchomimus',                 // D022 スコミムス
  Therizinosaurus: 'DR_Therizinosaurus',       // D024 テリジノサウルス
  DimetrodonR: 'DR_Dimetrodon',                 // D028 ディメトロドン（色違い）
  CompsognathusR: 'DR_Compsognathus',          // D034 コンプソグナトゥス（色違い）
  AllocentrosaurusR: 'DR_Allocentrosaurus',    // D037 アロケントロサウルス（色違い）
  TroodonR: 'DR_Troodon',                      // D039 トロオドン（色違い）
  Albertosaurus: 'DR_Albertosaurus',           // D042 アルバートサウルス
  EuoplocephalusR: 'DR_Euoplocephalus',        // D043 エウオプロケファルス（色違い）
  Hypsilophodon: 'DR_Hypsilophodon',           // D051 ヒプシロフォドン
  Eoraptor: 'DR_Eoraptor',                     // D030 エオラプトル
  Ichthyosaurus: 'DR_Ichthyosaurus',           // 新規 イクチオサウルス
  IchthyosaurusR: 'DR_Ichthyosaurus',          // 新規 イクチオサウルス（色違い・流用）
  Mammoth: 'DR_Mammoth',                       // 新規 マンモス
  SkeletonRex: 'DR_SkeletonRex',               // 新規 スケルトンレックス
};
for (const [k, d] of Object.entries(DINOS)) d.roar = ROAR_SPECIES[k] || null;
/** 種名から咆哮の効果音キーを返す（割り当てが無い種は従来の 'growl'）。 */
export const roarOf = (type) => (DINOS[type] && DINOS[type].roar) || 'growl';

// ---- assets/motion_map.js の内容を合流させる ----
for (const [name, d] of Object.entries(DINOS)) {
  d.anim = ANIM[name] || {};
  const mf = name === PLAYER ? null : MOVE_FRAMES[name];
  if (mf) {
    for (const [mv, spec] of Object.entries(mf)) {
      const def = d.moves[mv];
      if (!def) throw new Error(`motion_map: ${name} に技 ${mv} が無い`);
      if (spec.f.length !== def.phases.length) throw new Error(`motion_map: ${name}.${mv} のコマ数(${spec.f.length})が phase 数(${def.phases.length})と違う`);
      spec.f.forEach((fr, i) => { def.phases[i].m = fr[0]; def.phases[i].from = fr[1]; def.phases[i].to = fr[2]; });
    }
  }
}

// 使う全モーション（アセット表）
export function allMotionRefs() {
  const out = [];
  for (const [name, d] of Object.entries(DINOS)) for (const m of d.motions) out.push([name, m]);
  return out;
}
