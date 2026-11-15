// 面のデータ（コードと混ぜない）。あとで面エディタを作るときは、このファイルの形をそのまま読み書きする。
//
// 版2.0：ワールド制（マリオ方式）。ワールド1〜6は各4面（1〜3 が雑魚の面・4 がボス）、ワールド7はライバルの最終決戦1面だけ。全25面。
// 表示は「STAGE 1-1」形式（label）。配列の添字は 0〜24（通し番号 id は 1〜25）。
//
// 画面は 1280x720。座標は左上が原点、y は下向き。
// world / n    : ワールド番号と、その中の番号（label = `${world}-${n}`）。area は world と同じ（古い呼び名）。
// groundY      : 地面の線（足の位置）。
// bg           : 戦闘背景。back1=battlebacks1（地面）、back2=battlebacks2（奥の景色）のファイル名（拡張子なし）。
//                DBT_ で始まる背景は1枚で全面を覆うので back1 は null。 bgY=背景の縦ずらし(px、省略可)。
//                アンモナイト・巨大な渦巻きが写る背景は使わない（DBT_DimensionalCape・DBT_Map074・DBT_Map073・DBT_Watergate・海の背景は不採用）。
// platforms    : 浮いた足場。{x, y, w}  y=上面。下からすり抜けて乗れる。ふつうの足場はジャンプ1回で届く高さ(地面から約190px以内)。
//                版3.1：足場は小さく（幅 170〜190）・少なく（陸の面は 2〜4 枚）・段の刻みはふつうのジャンプの届く高さ（PLAT_STEP＝165px）。大ジャンプが要る足場（high:true）は作らない（check.mjs が全面を確かめる）。
// ledge        : 足場の色（上面 top・側面 face）。
// bgm          : sounds.js の BGM 名。
// waves        : 敵の波。順に出る。「群れ」の波（同じ側から続けて4体など）は、まとめて吹き飛ばして玉突きにするためのもの。
//    delay  : 波が始まる条件（前の波の生き残りが until 体以下）になってから出るまでの秒
//    until  : 前の波の生き残りがこの数以下になったら次の波を始める（省略=0＝全滅してから）
//    swarm  : true なら群れの波（検査用の印。check.mjs が「各面に群れの波が1つ以上ある」を確かめる）
//    enemies: {type, from:'left'|'right'|'top', x?, delay?}
//              left/right は画面の外から歩いて入ってくる。top は x の位置へ上から落ちてくる。
//              delay は波の開始からの時間差（秒）。
// clearHeal    : 面クリアで回復する体力。
// bossHp       : （版3.7・省略可）その面のボス級（isBossLike）だけの体力の掛け率。雑魚の体力は変えない。ボスを別の面へ入れ替えたとき、面の難しさの曲線（体力の山）を保つために使う。
// timeLimit    : 制限時間（秒・省略は 180＝元のゲームどおり。難しさの timeMul が掛かる）。0 になっても面は終わらず、体力とゲージが少しずつ減っていく（ボス面も同じ）。
// 面が進むほど強くなる曲線（ワールドごとの倍率）は src/difficulty.js の WORLD_CURVE（1か所）。この表は「敵の数と組み合わせ」だけを持つ。
// 版3.5：敵の出方（波の顔ぶれ）は、RPG1 の 06_world §5-1「野生出現表」の地域の順（草原→山→湿地→火山のふもと→砂漠→ジャングル）にならって、アロサウルスに偏らないよう組み直した。
//   決まり（tools/mix_test.mjs が全部検査する・対応表と根拠は STATE.md「版3.5（敵の出方の再編）」）：同じ種は通常3面のうち2面まで／主役種は40%まで／隣の面と3種以上違う／色違い・新9種・マンモスを後半に偏らせない。
//   動かさないもの：波の骨組み（出る側・足場の段・位置・間隔）・敵の総数・ガードする敵・重い敵の数・新しい雑魚の初登場の面。波の中身を変えるときは、この試験が赤にならないよう種だけ入れ替える。
export const SCREEN = { w: 1280, h: 720 };

/** ワールドの名前（HUD に出す）。版3.0：並べ替えたあとの番号で arrangeStages が埋める（海のワールドを入れる場所を変えると番号が変わるため）。 */
export const AREAS = {};

const A = 'Allosaurus', T = 'Triceratops', K = 'Ankylosaurus', P = 'Pteranodon', M = 'Mammoth';
// 版2.1：恐竜アニメ担当の一覧から。V あばれラプトル・O トロオドン（素早い群れ）・E エウオプロケファルス（盾役）・AR/TR/KR 強い色違い（後半の雑魚）
const V = 'VelociraptorR', O = 'TroodonR', E = 'EuoplocephalusR', AR = 'AllosaurusR', TR = 'TriceratopsR', KR = 'AnkylosaurusR';
// 版3.4：アクション揃い一覧から。CO コンプソグナトゥス・HY ヒプシロフォドン（小型・素早い）／SU スコミムス／DM ディメトロドン／IG イグアノドン／CA カルノタウルス／AC アロケントロサウルス／AB アルバートサウルス・TH テリジノサウルス（大型・重い）
const CO = 'CompsognathusR', HY = 'Hypsilophodon', SU = 'Suchomimus', DM = 'DimetrodonR', IG = 'IguanodonR', CA = 'Carnotaurus', AC = 'AllocentrosaurusR', AB = 'Albertosaurus', TH = 'Therizinosaurus';
const EO = 'Eoraptor';   // 版3.6：本編の新しい出荷物（草原の小型）。波の骨組みは変えず、跳べる小型の枠（V・O）の種だけ差し替え
/** 同じ側から間隔をあけて n 体（群れ）。 */
const column = (type, from, n, gap = 0.5, t0 = 0) =>
  Array.from({ length: n }, (_, i) => ({ type, from, delay: +(t0 + i * gap).toFixed(2) }));
const one = (type, from, delay = 0, x) => (x === undefined ? { type, from, delay } : { type, from, delay, x });

// 足場の型。版3.1：足場は「小さく・少なく・ふつうのジャンプで登れる刻み」（Nao 10-14「足場は小さく　通常の最大のジャンプをしたときに乗れるくらいの高さの刻みにして。あまり足場が多いと。コンボの邪魔になる。」）。
//   刻み PLAT_STEP＝1段の高さ（地面→L→M→T が全部この間隔）。ふつうのジャンプの頂点は約207px・check.mjs の届く目安は190px。刻み165pxはその内側（大ジャンプが要る段は作らない）。
//   足場の幅は PLAT_W（L・M＝190／T＝170。以前の6〜7割）。主人公の体幅の約1.5〜2倍あるので、足場の上でコンボを続けられる。
//   型は 4枚（L 2枚・M 1枚・T 1枚）。配列の順は L, L, M, T（面の waves の plat がこの添字を指す）。a だけ T の無い3枚（1-1 のやさしい配置）。
//   段どうしの横のすき間は 50〜90px（すき間が小さいので、真下から跳べば足場の端に引っかかって乗れる）。
//   high（大ジャンプが要る足場）の印は、もう使わない（check.mjs が、全面がふつうのジャンプで届くことを確かめる）。
export const PLAT_STEP = 165, PLAT_W = { L: 190, M: 190, T: 170 }, PLAT_GROUND = 600;
const pf = (x, tier, w) => ({ x, y: PLAT_GROUND - PLAT_STEP * tier, w });
const Lp = (x) => pf(x, 1, PLAT_W.L), Mp = (x) => pf(x, 2, PLAT_W.M), Tp = (x) => pf(x, 3, PLAT_W.T);
const PL = {
  a: [Lp(260), Lp(820), Mp(540)],
  b: [Lp(130), Lp(950), Mp(400), Tp(640)],
  c: [Lp(270), Lp(800), Mp(520), Tp(300)],
  d: [Lp(150), Lp(930), Mp(690), Tp(470)],
  e: [Lp(90), Lp(990), Mp(330), Tp(580)],
  f: [Lp(180), Lp(910), Mp(600), Tp(420)],
  // ボス面・ライバル戦：L 2枚（＋M 1枚）だけ。ボスの技と主人公のコンボの邪魔にならない少なさ
  boss2: [Lp(130), Lp(960)],
  boss3: [Lp(250), Lp(800), Mp(520)],
};

// 陸の面（ワールド1〜6）とライバル戦。版3.0：番号・ラベル・通し番号は、下の arrangeStages が海のワールドを入れて付け直す（ここに書いてある id・world・label は並べ替え前の値）。
const LAND = [
  // ================= ワールド1：密林（スケルトンレックス） =================
  {
    id: 1, world: 1, n: 1, area: 1, label: '1-1', name: '密林の入口',
    bg: { back1: null, back2: 'DBT_Grassland', art: 't_grassland', artDir: 'tall', hl: 0.872, hz: 600 }, groundY: 600,
    ledge: { top: '#8aa65a', face: '#4f5f33' },
    platforms: PL.a, rise: 330,
    bgm: 'area_jungle', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: A, from: 'left' }, { type: A, from: 'right', delay: 0.7 }] },
      { delay: 0.8, swarm: true, enemies: [...column(CO, 'right', 2, 0.4), ...column(V, 'right', 2, 0.4, 0.8)] },      // 版3.4：やさしい配置に、跳べる小型のコンプソ2体を混ぜる（4体のまま）。版3.5：3つ目の波のアロ1体もコンプソに（アロ4・コンプソ3・ラプトル2）
      { delay: 0.6, until: 1, enemies: [{ type: A, from: 'top', x: 560 }, { type: CO, from: 'top', plat: 1, delay: 0.3 }, { type: A, from: 'left', delay: 0.9 }] },
    ],
  },
  {
    id: 2, world: 1, n: 2, area: 1, label: '1-2', name: '滝のそばの広場',
    bg: { back1: null, back2: 'DBT_Jungle', art: 't_jungle', artDir: 'tall', hl: 0.8602, hz: 600 }, groundY: 600,
    ledge: { top: '#7f9b5a', face: '#46512f' },
    platforms: PL.b, rise: 600,
    bgm: 'area_jungle', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, swarm: true, enemies: [...column(EO, 'left', 2, 0.4), { type: P, from: 'right', delay: 2 }] },
      { delay: 0.8, enemies: [{ type: T, from: 'right' }, { type: O, from: 'top', plat: 0, delay: 1 }] },
      { delay: 0.6, until: 1, swarm: true, enemies: [{ type: O, from: 'top', x: 360 }, { type: V, from: 'top', x: 640, delay: 0.25 }, { type: EO, from: 'top', x: 920, delay: 0.5 }, { type: P, from: 'left', delay: 1.4 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: V, from: 'top', plat: 2, delay: 0 }, { type: HY, from: 'top', plat: 3, delay: 0.4 }] },
    ],
  },
  {
    id: 3, world: 1, n: 3, area: 1, label: '1-3', name: '沼地の根もと',
    bg: { back1: null, back2: 'DBT_Swamp', art: 't_swamp', artDir: 'tall', hl: 0.8522, hz: 600 }, groundY: 600,
    ledge: { top: '#6c8a4a', face: '#34402a' },
    platforms: PL.c, rise: 600,
    bgm: 'area_jungle', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, swarm: true, enemies: [{ type: K, from: 'left' }, ...column(DM, 'right', 2, 0.5, 0.6)] },
      { delay: 0.8, until: 1, enemies: [{ type: T, from: 'right' }, { type: P, from: 'left', delay: 1.2 }, { type: P, from: 'right', delay: 2 }] },
      { delay: 0.6, until: 1, swarm: true, enemies: [...column(CO, 'left', 2, 0.4), ...column(O, 'right', 2, 0.4, 0.2)] },
      { delay: 0.6, enemies: [{ type: K, from: 'right' }, { type: EO, from: 'top', plat: 1, delay: 0.8 }, { type: A, from: 'left', delay: 1.4 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: CO, from: 'top', plat: 2, delay: 0 }] },
    ],
  },
  {
    id: 4, world: 1, n: 4, area: 1, label: '1-4', name: '骨の神殿', boss: true,
    bg: { back1: null, back2: 'DBT_Ruins', art: 't_ruins', artDir: 'tall', hl: 0.84755, hz: 540 }, groundY: 540,      // 2026-10-29 Nao「1-4 は足元の線がもう少し高いはず」：背景の絵の床は y≈545 で手前の壁へ落ちる。足の線を 600→540（-60）に上げ、足場も同じ -60 で動かして地面との段差(165)を保つ。背景の絵の置きは不変（hz を 540 に下げ、hl を 0.8788→0.84755 にして、絵の位置は 0.1px 以内で同じ。検査が hz≦groundY を求めるため）
    ledge: { top: '#b49a62', face: '#6b5a36' },
    platforms: PL.boss2.map((q) => ({ ...q, y: q.y - 60 })), rise: 300,
    bgm: 'boss1', clearHeal: 40, timeLimit: 180,
    waves: [
      { delay: 2.4, enemies: [{ type: 'SkeletonRex', from: 'right' }] },
    ],
  },

  // ================= ワールド2：大平原（ティタノサウルス）。マンモスが登場 =================
  {
    id: 5, world: 2, n: 1, area: 2, label: '2-1', name: '朝の平原',
    bg: { back1: null, back2: 'DBT_Map118', art: 't_map118', artDir: 'tall', hl: 0.7914, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#9bb35f', face: '#566a35' },
    platforms: PL.b, rise: 600,
    bgm: 'area_plains', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: TR, from: 'left' }, { type: A, from: 'right', delay: 0.7 }, { type: EO, from: 'top', plat: 0, delay: 1.5 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [...column(O, 'right', 2, 0.35), { type: CO, from: 'left', delay: 1.5 }] },
      { delay: 0.6, until: 1, enemies: [{ type: K, from: 'right' }, { type: A, from: 'top', x: 560 }, { type: V, from: 'top', plat: 1, delay: 0.9 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: EO, from: 'top', plat: 2, delay: 0 }, { type: CO, from: 'top', plat: 3, delay: 0.4 }] },
    ],
  },
  {
    id: 6, world: 2, n: 2, area: 2, label: '2-2', name: '小川のほとり',
    bg: { back1: null, back2: 'DBT_Map111', art: 't_map111', artDir: 'tall', hl: 0.7647, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#8aa968', face: '#475f3a' },
    platforms: PL.d, rise: 600,
    bgm: 'area_plains', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: M, from: 'left' }, { type: IG, from: 'right', delay: 0.8 }, { type: O, from: 'top', plat: 1, delay: 1.6 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [...column(HY, 'right', 2, 0.4), { type: O, from: 'top', plat: 0, delay: 0.2 }] },
      { delay: 0.6, until: 1, enemies: [{ type: TR, from: 'right' }, { type: P, from: 'left', delay: 1 }, { type: P, from: 'right', delay: 1.8 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: A, from: 'top', plat: 2, delay: 0 }, { type: HY, from: 'top', plat: 3, delay: 0.4 }] },
    ],
  },
  {
    id: 7, world: 2, n: 3, area: 2, label: '2-3', name: 'マンモスの丘',
    bg: { back1: null, back2: 'DBT_Map109', art: 't_map109', artDir: 'tall', hl: 0.8127, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#7f9a5a', face: '#3f4f2f' },
    platforms: PL.f, rise: 600,
    bgm: 'area_plains', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: M, from: 'left' }, { type: KR, from: 'right', delay: 0.8 }, { type: IG, from: 'left', delay: 1.6 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [...column(V, 'left', 2, 0.4), { type: CO, from: 'right', delay: 0.3 }, { type: CO, from: 'top', plat: 1, delay: 0.7 }] },
      { delay: 0.6, until: 1, enemies: [{ type: M, from: 'right' }, { type: E, from: 'left', delay: 0.8 }, { type: P, from: 'left', delay: 1.8 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: HY, from: 'top', plat: 2, delay: 0 }, { type: EO, from: 'top', plat: 3, delay: 0.4 }] },
    ],
  },
  {
    id: 8, world: 2, n: 4, area: 2, label: '2-4', name: '巨竜の平原', boss: true,
    bg: { back1: null, back2: 'DBT_Map009', art: 't_map009', artDir: 'tall', hl: 0.7887, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#a2b86a', face: '#566a35' },
    platforms: PL.boss3, rise: 300,
    bgm: 'boss5', clearHeal: 40, timeLimit: 180,
    waves: [
      { delay: 2.6, enemies: [{ type: 'Titanosaurus', from: 'right' }] },
      { delay: 9, until: 1, swarm: true, enemies: [{ type: O, from: 'left' }, { type: O, from: 'left', delay: 0.4 }, { type: O, from: 'top', plat: 0, delay: 0.8 }, ...column(A, 'right', 2, 0.45, 0.3)] },
      { delay: 12, until: 1, swarm: true, enemies: [{ type: M, from: 'left' }, { type: HY, from: 'right', delay: 0.6 }, { type: HY, from: 'right', delay: 1 }, { type: HY, from: 'top', plat: 1, delay: 1.4 }] },
    ],
  },

  // ================= ワールド3：断崖と空（ケツァルコアトルス） =================
  {
    id: 9, world: 3, n: 1, area: 3, label: '3-1', name: '岩山のふもと',
    bg: { back1: null, back2: 'DBT_Map020', art: 't_map020', artDir: 'tall', hl: 0.7727, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#b9a98c', face: '#6d6552' },
    platforms: PL.e, rise: 600,
    bgm: 'area_cliffsky', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: T, from: 'left' }, { type: V, from: 'top', plat: 1, delay: 0.8 }, { type: O, from: 'top', plat: 0, delay: 1.8 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [...column(CO, 'left', 2, 0.45), { type: SU, from: 'right', delay: 0.3 }] },
      { delay: 0.6, until: 1, enemies: [{ type: E, from: 'right' }, { type: M, from: 'left', delay: 0.8 }, { type: HY, from: 'right', delay: 1.6 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: EO, from: 'top', plat: 2, delay: 0 }, { type: CO, from: 'top', plat: 3, delay: 0.4 }, { type: HY, from: 'top', plat: 1, delay: 0.8 }] },
    ],
  },
  {
    id: 10, world: 3, n: 2, area: 3, label: '3-2', name: '断崖の高台',
    bg: { back1: null, back2: 'DBT_Map088', art: 't_map088', artDir: 'tall', hl: 0.7576, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#c9d3dc', face: '#7b8896' },
    platforms: PL.f, rise: 600,
    bgm: 'area_cliffsky', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: TR, from: 'left' }, { type: DM, from: 'right', delay: 0.8 }, { type: P, from: 'left', delay: 1.8 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [...column(A, 'left', 2, 0.4), { type: O, from: 'top', plat: 1, delay: 0.3 }, { type: P, from: 'right', delay: 1.6 }] },
      { delay: 0.6, until: 1, enemies: [{ type: M, from: 'right' }, { type: T, from: 'left', delay: 1 }, { type: P, from: 'right', delay: 1.6 }, { type: P, from: 'left', delay: 2.4 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: V, from: 'top', plat: 2, delay: 0 }, { type: O, from: 'top', plat: 3, delay: 0.4 }, { type: EO, from: 'top', plat: 1, delay: 0.8 }] },
    ],
  },
  {
    id: 11, world: 3, n: 3, area: 3, label: '3-3', name: '雲の見晴らし台',
    bg: { back1: null, back2: 'DBT_Map068', art: 't_map068', artDir: 'tall', hl: 0.822, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#c9c3b2', face: '#7b7668' },
    platforms: PL.d, rise: 600,
    bgm: 'area_cliffsky', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, swarm: true, enemies: [{ type: P, from: 'left' }, { type: P, from: 'right', delay: 0.8 }, ...column(SU, 'right', 2, 0.4, 1.2)] },
      { delay: 0.8, until: 1, enemies: [{ type: CA, from: 'left' }, { type: E, from: 'right', delay: 0.6 }, { type: P, from: 'right', delay: 1.6 }] },
      { delay: 0.6, until: 1, swarm: true, enemies: [{ type: AR, from: 'left', delay: 0 }, { type: A, from: 'left', delay: 0.4 }, { type: HY, from: 'right', delay: 0.2 }, { type: HY, from: 'top', plat: 1, delay: 0.55 }, { type: P, from: 'left', delay: 1.4 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: CO, from: 'top', plat: 2, delay: 0 }, { type: HY, from: 'top', plat: 3, delay: 0.4 }, { type: CO, from: 'top', plat: 1, delay: 0.8 }] },
    ],
  },
  {
    id: 12, world: 3, n: 4, area: 3, label: '3-4', name: '空の回廊', boss: true,
    bg: { back1: null, back2: 'DBT_Mountain', art: 't_mountain', artDir: 'tall', hl: 0.7994, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#b7a98a', face: '#6c6450' },
    platforms: PL.boss3, rise: 300,
    bgm: 'boss6', clearHeal: 40, timeLimit: 180,
    waves: [
      { delay: 2.6, enemies: [{ type: 'Quetzalcoatlus', from: 'top', x: 640 }] },
      { delay: 9.0, until: 1, swarm: true, enemies: [{ type: V, from: 'left' }, { type: V, from: 'top', plat: 0, delay: 0.45 }, { type: A, from: 'left', delay: 0.9 }, { type: CO, from: 'right', delay: 0.3 }, { type: CO, from: 'top', plat: 1, delay: 0.7 }, { type: HY, from: 'right', delay: 1.1 }] },
      { delay: 12.0, until: 1, swarm: true, enemies: [{ type: TR, from: 'left' }, ...column(O, 'right', 3, 0.4, 0.6)] },
    ],
  },

  // ================= ワールド4：火山と荒野（ギガノトサウルス） =================
  {
    id: 13, world: 4, n: 1, area: 4, label: '4-1', name: '荒野の岩場',
    bg: { back1: null, back2: 'DBT_DesertRuins', art: 't_wasteland', artDir: 'tall', hl: 0.8628, hz: 600 }, groundY: 600,
    ledge: { top: '#c58a55', face: '#7a4e2c' },
    platforms: PL.e, rise: 600,
    bgm: 'area_volcano', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, swarm: true, enemies: [{ type: V, from: 'left', delay: 0 }, { type: A, from: 'left', delay: 0.45 }, ...column(AC, 'right', 2, 0.45, 0.2), { type: SU, from: 'left', delay: 1.2 }] },
      { delay: 0.8, until: 1, enemies: [{ type: TR, from: 'left' }, { type: IG, from: 'right', delay: 0.6 }, { type: M, from: 'left', delay: 1.4 }, { type: E, from: 'right', delay: 2 }] },
      { delay: 0.6, until: 1, enemies: [{ type: T, from: 'left' }, ...column(P, 'right', 2, 0.8, 0.8), { type: O, from: 'left', delay: 1.4 }] },
      { delay: 0.6, until: 1, enemies: [{ type: V, from: 'top', plat: 0 }, { type: O, from: 'top', plat: 1, delay: 0.25 }] },
      // 版2.3：4体→2体（高台の波の2体ぶん）。群れ(swarm)ではなくなった（群れの波は最初の波にある）
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: HY, from: 'top', plat: 2, delay: 0 }, { type: EO, from: 'top', plat: 3, delay: 0.4 }] },
    ],
  },
  {
    id: 14, world: 4, n: 2, area: 4, label: '4-2', name: '煙る火山のふもと',
    bg: { back1: null, back2: 'DBT_Map032', art: 'lava2', artDir: 'tall', hl: 0.569, hz: 300 }, bgY: 150, groundY: 600,      // 版3.0：縦長の背景絵（art＝assets/bg/tall。hl＝絵の高さに対する地平線の位置・hz＝その地平線を置く世界 y）。読めなければ back2 の絵
    lava: { pools: [{ x: 640, w: 180, sx: 640, sw: 60 }], period: 8 },      // 版3.0：マグマだまり（床の穴）。入ると主人公も敵もダメージ（主人公 14／雑魚は溶ける／ボスは体力が減る）。水位が上下して池が広がる。版3.1：sx・sw＝背景の絵の溶岩が地平線（hz）を横切る位置と幅（絵から測った値）。そこから溶岩の川が床の上を手前の池まで流れる
    ledge: { top: '#a98d6a', face: '#5d4a34' },
    platforms: PL.d, rise: 600,
    bgm: 'area_volcano', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: M, from: 'left' }, { type: E, from: 'right', delay: 0.6 }, { type: O, from: 'top', plat: 0, delay: 1.6 }, { type: IG, from: 'left', delay: 2.8 }, { type: AR, from: 'right', delay: 2.2 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [{ type: AR, from: 'left', delay: 0 }, { type: CO, from: 'left', delay: 0.4 }, { type: AC, from: 'right', delay: 0.3 }, { type: CA, from: 'right', delay: 0.7 }, { type: DM, from: 'right', delay: 1.1 }] },
      { delay: 0.6, until: 1, enemies: [{ type: KR, from: 'right' }, { type: DM, from: 'left', delay: 0.8 }, { type: E, from: 'right', delay: 1.6 }, { type: O, from: 'top', plat: 1, delay: 2 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: O, from: 'top', plat: 2, delay: 0 }, { type: EO, from: 'top', plat: 3, delay: 0.4 }, { type: CO, from: 'top', plat: 1, delay: 0.8 }] },
    ],
  },
  {
    id: 15, world: 4, n: 3, area: 4, label: '4-3', name: '溶岩の裂け目',
    bg: { back1: null, back2: 'DBT_Map034', art: 'lava3', artDir: 'tall', hl: 0.5762, hz: 300 }, bgY: 150, groundY: 600,
    lava: { pools: [{ x: 420, w: 140, sx: 363, sw: 60 }, { x: 860, w: 140, sx: 912, sw: 60 }], period: 9 },
    ledge: { top: '#7a5f58', face: '#34242a' },
    platforms: PL.f, rise: 600,
    bgm: 'area_volcano', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, swarm: true, enemies: [{ type: TR, from: 'left' }, ...column(V, 'right', 2, 0.4, 0.5), { type: CA, from: 'right', delay: 1.3 }, { type: DM, from: 'right', delay: 1.75 }, { type: P, from: 'left', delay: 1.8 }, { type: SU, from: 'left', delay: 2.2 }] },
      { delay: 0.8, until: 1, enemies: [{ type: CO, from: 'top', plat: 0 }, { type: TH, from: 'right', delay: 1 }, { type: KR, from: 'right', delay: 1.6 }] },
      { delay: 0.6, until: 1, swarm: true, enemies: [{ type: P, from: 'left' }, { type: P, from: 'right', delay: 0.8 }, { type: HY, from: 'right', delay: 1.2 }, { type: SU, from: 'left', delay: 1.4 }, { type: CO, from: 'right', delay: 1.8 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: HY, from: 'top', plat: 2, delay: 0 }, { type: CO, from: 'top', plat: 3, delay: 0.4 }, { type: V, from: 'top', plat: 1, delay: 0.8 }] },
    ],
  },
  {
    // 2026-10-11 Nao「ティラノのほうが強そう」＝ギガノトは6面ぶん前のボス。曲・背景・足場・群れの波は旧8面の火山の頂のまま。
    id: 16, world: 4, n: 4, area: 4, label: '4-4', name: '火山の頂', boss: true,
    bg: { back1: null, back2: 'DBT_Volcano', art: 't_volcano', artDir: 'tall', hl: 0.7723, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#6a4f58', face: '#2a1d24' },
    platforms: PL.boss3, rise: 300,
    bgm: 'boss3', clearHeal: 40, timeLimit: 180,
    bossHp: 0.90,      // 版3.8：四天王のあと（6-4）に置いたティラノの体力の掛け率（1273 × 0.90 × 位置の曲線 1.10 ＝ 約 1260。前のスピノ約 1200 → ティラノ → ギガノト約 1560 と山が続く）
    waves: [
      { delay: 2.6, enemies: [{ type: 'Tyrannosaurus', from: 'right' }] },      // 版3.7：ティラノ（本編では高山の野生最強格＝四天王より一段下）は四天王の前のボス。ギガノトは 7-4 へ
      { delay: 9.0, until: 1, swarm: true, enemies: [{ type: AR, from: 'left', delay: 0 }, { type: O, from: 'top', plat: 0, delay: 0.45 }, { type: V, from: 'left', delay: 0.9 }, ...column(AC, 'right', 2, 0.45, 0.3)] },
      { delay: 12.0, until: 1, swarm: true, enemies: [{ type: T, from: 'left' }, { type: V, from: 'right', delay: 0.6 }, { type: V, from: 'right', delay: 1 }, { type: V, from: 'top', plat: 1, delay: 1.4 }] },
    ],
  },

  // ================= ワールド5：古代遺跡（スピノサウルス四天王） =================
  {
    id: 17, world: 5, n: 1, area: 5, label: '5-1', name: '砂の遺跡',
    bg: { back1: null, back2: 'DBT_DesertRuins', art: 't_desertruins', artDir: 'tall', hl: 0.782, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#d9a85d', face: '#8c6532' },
    platforms: PL.d, rise: 600,
    bgm: 'area_ruins', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: TR, from: 'left' }, { type: AB, from: 'left', delay: 2 }] },      // 版3.9：遺跡（WORLD5）は雑魚を約 3〜4 割減らした（Nao「雑魚がいると攻略が楽になる。あまり登場させんほうがいい」）。種は残し、重なった体数だけ減らす
      { delay: 0.8, until: 1, swarm: true, enemies: [{ type: KR, from: 'right' }, { type: DM, from: 'left', delay: 0.5 }, ...column(O, 'left', 1, 0.35, 0.85)] },
      { delay: 0.6, until: 1, enemies: [{ type: P, from: 'left' }, { type: EO, from: 'top', plat: 1, delay: 1.2 }] },      // 2 体になるので群れ（swarm・3 体以上）の印は外す（この面の群れは前の波に残る）
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: SU, from: 'top', plat: 2, delay: 0 }, { type: O, from: 'top', plat: 3, delay: 0.4 }] },
    ],
  },
  {
    id: 18, world: 5, n: 2, area: 5, label: '5-2', name: '風化した大門',
    bg: { back1: null, back2: 'DBT_Map056', art: 't_map056', artDir: 'tall', hl: 0.7647, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#d2b27a', face: '#86693c' },
    platforms: PL.e, rise: 600,
    bgm: 'area_ruins', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, swarm: true, enemies: [...column(V, 'left', 1, 0.4), ...column(HY, 'right', 1, 0.35, 0.2), { type: O, from: 'top', plat: 1, delay: 1.8 }] },
      { delay: 0.8, until: 1, enemies: [{ type: TH, from: 'left' }, { type: CA, from: 'right', delay: 0.6 }] },
      { delay: 0.6, until: 1, enemies: [{ type: AB, from: 'right' }, { type: TH, from: 'left', delay: 0.8 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: SU, from: 'top', plat: 2, delay: 0 }, { type: CO, from: 'top', plat: 3, delay: 0.4 }] },
    ],
  },
  {
    id: 19, world: 5, n: 3, area: 5, label: '5-3', name: '苔むした神殿',
    bg: { back1: null, back2: 'DBT_Map047', art: 't_map047', artDir: 'tall', hl: 0.8621, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#7f9a78', face: '#38483a' },
    platforms: PL.f, rise: 600,
    bgm: 'area_ruins', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: K, from: 'left' }, { type: M, from: 'left', delay: 1.4 }, { type: P, from: 'right', delay: 2 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [{ type: A, from: 'left', delay: 0 }, ...column(V, 'left', 1, 0.4, 0.4), { type: CO, from: 'top', plat: 0, delay: 0.2 }] },
      { delay: 0.6, until: 1, enemies: [{ type: CA, from: 'left' }, { type: KR, from: 'right', delay: 0.6 }, { type: TH, from: 'right', delay: 1.4 }] },
      { delay: 0.6, until: 1, swarm: true, enemies: [{ type: AC, from: 'top', x: 520 }, { type: EO, from: 'top', plat: 1, delay: 0.25 }, { type: P, from: 'left', delay: 1.4 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: A, from: 'top', plat: 2, delay: 0 }, { type: HY, from: 'top', plat: 1, delay: 0.8 }] },
    ],
  },
  {
    id: 20, world: 5, n: 4, area: 5, label: '5-4', name: '四天王の祭壇', boss: true,
    bg: { back1: null, back2: 'DBT_Map046', art: 't_map046', artDir: 'tall', hl: 0.7687, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#cfae78', face: '#7a6038' },
    platforms: PL.boss3, rise: 300,
    bgm: 'boss4', clearHeal: 40, timeLimit: 180,
    waves: [
      { delay: 2.6, enemies: [{ type: 'SpinosaurusBoss', from: 'right' }] },
      { delay: 10.0, until: 1, swarm: true, enemies: [{ type: EO, from: 'top', plat: 0, delay: 0 }, { type: V, from: 'left', delay: 0.45 }, { type: O, from: 'top', plat: 1, delay: 0.3 }] },
      { delay: 12.0, until: 1, swarm: true, enemies: [{ type: AB, from: 'left' }, ...column(AC, 'right', 2, 0.45, 0.6)] },
    ],
  },

  // ================= ワールド6：溶岩の闘技場（ティラノサウルス） =================
  {
    id: 21, world: 6, n: 1, area: 6, label: '6-1', name: '闘技場の入口',
    bg: { back1: null, back2: 'DBT_Map044', art: 't_map044e1', artDir: 'tall', hl: 0.783, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#d1b283', face: '#7d6240' },
    platforms: PL.c, rise: 600,
    bgm: 'area_arena', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: AB, from: 'left' }, { type: TR, from: 'right', delay: 0.6 }] },      // 版3.9：闘技場（WORLD7）も雑魚を約 3 割減らした（遺跡と同じ Nao の指示）
      { delay: 0.8, until: 1, swarm: true, enemies: [...column(V, 'left', 1, 0.4), { type: HY, from: 'top', plat: 1, delay: 0.8 }, ...column(SU, 'right', 1, 0.35, 0.2), { type: CO, from: 'right', delay: 1.8 }] },
      { delay: 0.6, until: 1, enemies: [{ type: M, from: 'right' }, { type: CA, from: 'left', delay: 0.8 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: O, from: 'top', plat: 2, delay: 0 }, { type: CO, from: 'top', plat: 3, delay: 0.8 }] },
    ],
  },
  {
    id: 22, world: 6, n: 2, area: 6, label: '6-2', name: '大闘技場',
    bg: { back1: null, back2: 'DBT_Colosseum', art: 't_colosseum', artDir: 'tall', hl: 0.7767, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#d6b88a', face: '#80643f' },
    platforms: PL.b, rise: 600,
    bgm: 'area_arena', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, swarm: true, enemies: [{ type: KR, from: 'left' }, { type: IG, from: 'left', delay: 1 }, ...column(DM, 'left', 1, 0.4, 1.4)] },
      { delay: 0.8, until: 1, enemies: [{ type: K, from: 'left' }, { type: TH, from: 'left', delay: 1.4 }, { type: P, from: 'right', delay: 2 }] },
      { delay: 0.6, until: 1, swarm: true, enemies: [{ type: P, from: 'left' }, { type: O, from: 'top', plat: 1, delay: 1 }, { type: V, from: 'top', plat: 0, delay: 1.2 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: AR, from: 'top', plat: 2, delay: 0 }, { type: O, from: 'top', plat: 3, delay: 0.4 }, { type: EO, from: 'top', plat: 1, delay: 0.8 }] },
    ],
  },
  {
    id: 23, world: 6, n: 3, area: 6, label: '6-3', name: '煮えたぎる穴',
    bg: { back1: null, back2: 'DBT_Map035', art: 't_map035', artDir: 'tall', hl: 0.8034, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#7c5d57', face: '#3a2528' },
    platforms: PL.f, rise: 600,
    bgm: 'area_arena', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: AB, from: 'left' }, { type: TH, from: 'right', delay: 0.8 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [{ type: A, from: 'left', delay: 0 }, { type: AR, from: 'left', delay: 0.4 }, ...column(SU, 'left', 1, 0.4, 0.8), { type: HY, from: 'top', plat: 1, delay: 0.2 }, { type: M, from: 'right', delay: 1.4 }] },
      { delay: 0.6, until: 1, enemies: [{ type: T, from: 'right', delay: 0.6 }, { type: CA, from: 'left', delay: 1.4 }, { type: P, from: 'right', delay: 1.8 }] },
      { delay: 0.6, until: 1, swarm: true, enemies: [{ type: IG, from: 'left', delay: 0 }, { type: SU, from: 'left', delay: 0.35 }, { type: AR, from: 'right', delay: 0.15 }, { type: TH, from: 'right', delay: 1.4 }] },
      // 版2.3：高台の波（中段・最上段の足場へ上から降りてくる。敵の数は前の版と同じ＝この波の数だけ、この面の地上の群れ（column）を減らしてある。delay 2.5 は、前の波の生き残りが減ってから登る時間。降りる・跳び上がる動きは既存の歩く敵のまま）
      { delay: 2.5, until: 1, enemies: [{ type: HY, from: 'top', plat: 2, delay: 0 }, { type: CO, from: 'top', plat: 1, delay: 0.8 }] },
    ],
  },
  {
    id: 24, world: 6, n: 4, area: 6, label: '6-4', name: '溶岩の闘技場', boss: true,
    bg: { back1: null, back2: 'DBT_Volcano', art: 't_lava', artDir: 'tall', hl: 0.8762, hz: 600 }, groundY: 600,
    ledge: { top: '#7c5d57', face: '#3a2528' },
    platforms: PL.boss2, rise: 300,
    bgm: 'boss2', clearHeal: 40, timeLimit: 180,
    bossHp: 1.27,      // 版3.7：この面のボスだけの体力の掛け率（ギガノト 1005 × 1.27 ＝ 1277。四天王・ティラノのあとのボスとして曲線を保つ）
    waves: [
      { delay: 2.4, enemies: [{ type: 'Giganotosaurus', from: 'right' }] },      // 版3.7：ギガノト（本編のラスボス＝決勝の闘技場の王者）は四天王（ティタノ・ケツァル・モサ・スピノ）のあと。ティラノは 4-4 へ
      // ボスだけになって9秒たつと群れが来る。まとめて吹き飛ばしてボスにぶつける（ボスを倒すと打ち切り）。
      { delay: 9.0, until: 1, swarm: true, enemies: [...column(AR, 'left', 2, 0.45), { type: CA, from: 'left', delay: 0.9 }] },
      { delay: 12.0, until: 1, enemies: [{ type: CO, from: 'top', plat: 1 }, { type: P, from: 'left', delay: 1 }] },      // 2 体になるので swarm の印は外す（群れは前の波に残る）
    ],
  },

  // ================= ワールド8：最終決戦（8-1〜8-3 は決戦への道・8-4 がライバル）。エンディングは 8-4 のあと =================
  // 版3.8（面の再編）：ボスは各ワールドの 4 面目。最終ワールドも 3 面の雑魚面＋ボス（ライバル）。背景は手持ちの縦長の絵の流用（生成なし）。
  {
    id: 25, world: 7, n: 1, area: 7, label: '7-1', name: '果ての荒野',
    bg: { back1: null, back2: 'DBT_Map032', art: 't_map032', artDir: 'tall', hl: 0.7834, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#a8805a', face: '#5e4630' },
    platforms: PL.e, rise: 600,
    bgm: 'area_volcano', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: TH, from: 'left' }, { type: IG, from: 'right', delay: 0.6 }, { type: KR, from: 'left', delay: 1.4 }, { type: AB, from: 'right', delay: 2.0 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [...column(V, 'left', 3, 0.4), ...column(CO, 'right', 3, 0.35, 0.2), { type: P, from: 'left', delay: 1.8 }] },
      { delay: 0.6, until: 1, enemies: [{ type: AB, from: 'right' }, { type: KR, from: 'left', delay: 0.8 }, { type: P, from: 'right', delay: 1.6 }] },
      { delay: 0.6, until: 1, swarm: true, enemies: [{ type: HY, from: 'left' }, { type: HY, from: 'top', plat: 0, delay: 0.4 }, { type: EO, from: 'right', delay: 0.2 }, { type: EO, from: 'top', plat: 1, delay: 0.6 }] },
      { delay: 2.5, until: 1, enemies: [{ type: HY, from: 'top', plat: 2, delay: 0 }, { type: EO, from: 'top', plat: 3, delay: 0.4 }, { type: CO, from: 'top', plat: 1, delay: 0.8 }] },
    ],
  },
  {
    id: 26, world: 7, n: 2, area: 7, label: '7-2', name: '暗き火山の裾',
    bg: { back1: null, back2: 'DBT_Map034', art: 't_map034', artDir: 'tall', hl: 0.7371, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#6b5a50', face: '#322a26' },
    platforms: PL.f, rise: 600,
    bgm: 'area_volcano', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: AR, from: 'left' }, { type: KR, from: 'right', delay: 0.6 }, { type: CA, from: 'left', delay: 1.4 }, { type: TH, from: 'right', delay: 2.0 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [{ type: V, from: 'left', delay: 0 }, { type: O, from: 'top', plat: 0, delay: 0.45 }, ...column(AC, 'right', 2, 0.45, 0.2)] },
      { delay: 0.6, until: 1, enemies: [{ type: TH, from: 'right' }, { type: E, from: 'left', delay: 0.8 }, { type: P, from: 'left', delay: 1.6 }, { type: P, from: 'right', delay: 2.4 }, { type: SU, from: 'left', delay: 3.0 }] },
      { delay: 0.6, until: 1, swarm: true, enemies: [{ type: O, from: 'left' }, { type: O, from: 'left', delay: 0.4 }, { type: O, from: 'top', plat: 1, delay: 0.8 }, ...column(SU, 'right', 3, 0.5, 0.2)] },
      { delay: 2.5, until: 1, enemies: [{ type: V, from: 'top', plat: 2, delay: 0 }, { type: O, from: 'top', plat: 3, delay: 0.4 }, { type: HY, from: 'top', plat: 1, delay: 0.8 }] },
    ],
  },
  {
    id: 27, world: 7, n: 3, area: 7, label: '7-3', name: '決闘の中庭',
    bg: { back1: null, back2: 'DBT_Map044', art: 't_map044', artDir: 'tall', hl: 0.8154, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#c9a468', face: '#7a5f36' },
    platforms: PL.d, rise: 600,
    bgm: 'area_arena', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: AB, from: 'left' }, { type: AC, from: 'right', delay: 0.8 }, { type: AR, from: 'left', delay: 1.6 }, { type: TR, from: 'right', delay: 2.4 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [{ type: A, from: 'left' }, { type: CO, from: 'right', delay: 0.2 }, { type: CO, from: 'right', delay: 0.6 }, { type: CO, from: 'top', plat: 1, delay: 1 }, { type: SU, from: 'right', delay: 1.2 }, { type: DM, from: 'left', delay: 1.6 }] },
      { delay: 0.6, until: 1, enemies: [{ type: M, from: 'left' }, { type: CA, from: 'right', delay: 0.6 }, { type: E, from: 'left', delay: 1.4 }, { type: O, from: 'top', plat: 0, delay: 2 }] },
      { delay: 0.6, until: 1, swarm: true, enemies: [{ type: IG, from: 'left', delay: 0 }, { type: AR, from: 'right', delay: 0.15 }, { type: SU, from: 'left', delay: 0.35 }, { type: DM, from: 'right', delay: 0.5 }, { type: AC, from: 'right', delay: 1.4 }] },
      { delay: 2.5, until: 1, enemies: [{ type: EO, from: 'top', plat: 2, delay: 0 }, { type: CO, from: 'top', plat: 3, delay: 0.4 }, { type: O, from: 'top', plat: 1, delay: 0.8 }] },
    ],
  },
  {
    // 最終面：色違いのスピノサウルス（ライバル）。主人公と同じ技の表（src/moves.js）を敵用に読み替えて使う（src/rival.js）。
    id: 28, world: 7, n: 4, area: 7, label: '7-4', name: '宿命の対決',
    boss: true, final: true,
    bg: { back1: null, back2: 'DBT_Tower', art: 't_tower', artDir: 'tall', hl: 0.7687, hz: 600 }, bgY: 150, groundY: 600,
    ledge: { top: '#8a7a6e', face: '#3c322c' },
    platforms: PL.boss3, rise: 300,
    bgm: 'boss3', clearHeal: 0, timeLimit: 180,
    waves: [
      { delay: 2.6, enemies: [{ type: 'SpinoRival', from: 'top', x: 640 }] },
    ],
  },
];

// ================= 版3.0（第1段）：海のワールド（雑魚3面＋ボス。背景の描き直し＝浮きブロックだけ・縦長の絵）=================
// 海の面の決まり（陸の面との違い）
//   🔴版3.0（背景の描き直し）：陸地（岸・陸の地面）は無い。足場は「海に浮かぶブロック」だけ。左右の端は岩の断崖の壁（描画）でふさぐ。
//   water {y}    : 水面の世界 y。これより下が水（体の中心が水面より下＝水の中）。水の中では主人公が泳げる（world.js の WATER）。陸の敵は水に落ちるともがいて流されて画面の外へ消える（倒した扱い）。
//   groundY      : 海底の線（水の下の地面）。画面の高さ（720）より深い。camera が下へ続く量は sink（px・camY は -rise 〜 +sink）。
//   start {x,plat,carry}: 主人公の出発点（足場の添字）。carry:true＝前の面が水の中で終わったら、その深さのまま水中の左端から泳いで入る（水の外で終わったときは x・plat の足場の上。world.js の seaEntry）。hint＝面の説明の1行（開始のバナーの下に出す。省略可）。
//   gaps [{x0,x1}]: 海底が無い所（裂け目）。pit {y,dmg}: 足が y を超えたら「落ちてはいけない所」＝ダメージを受けて、最後に立っていた足場の上から降りてきて復帰する。
//   platforms    : 海に浮かぶブロックだけ（横は画面の内側）。y が水面より上＝水の上のブロック、下＝海中のブロック。kind＝見た目（float 浮き石の板／drift 流木／reef 海中の石板）。上面だけ歩ける（下からは通り抜けて上へ乗れる）。
//   bg           : { proc:'sea', look, art } ＝縦長の1枚絵（art＝assets/bg/sea の絵。空→水面→海中が1枚）。絵が無いときは描画の海で代用（空・水面・海中・海底・光の筋）。アンモナイト・巨大な渦巻きの飾りは入れない。
//   敵           : 陸の敵（アロ・ラプトルなど）は、浮きブロックの上へ上から降りてくる（left/right ＋ plat＝足場の添字、省略は、その側のいちばん外のブロック）。泳ぐ敵（イクチオサウルス・モササウルス）は水の中から入る（left/right）。海の面は、水の敵を陸の敵より多くする。
//   出口         : 面を片づけたら、画面の右端へ。海をくぐって（潜って）右の断崖の水中の洞窟から出ていく（右端なら、水中でも浮きブロックの上でもよい）。
const I = 'Ichthyosaurus', MO = 'Mosasaurus', IR = 'IchthyosaurusR', MS = 'MosasaurusSmall';      // 版3.5：IR＝強い色違い・MS＝モササウルス（小型の雑魚）
const onPlat = (list, plat) => list.map((e) => ({ ...e, plat }));
const SEA_LEDGE = { top: '#d9dfe0', face: '#6d7a85' };
const SEA = [
  {
    n: 1, group: 'sea', name: '浮き石の海', hint: '足場は海に浮かぶブロックだけ。水に入ると泳げる：←→↑↓で泳ぎ、ジャンプで上へ。水面の近くなら、水面を突き破ってブロックへ飛び乗れる。出口は右の断崖の水中の洞窟。',
    bg: { proc: 'sea', look: 'shore', art: 'sea1', wl: 0.461 }, water: { y: 520 }, groundY: 1240, sink: 560, rise: 180,
    ledge: SEA_LEDGE, start: { x: 150, plat: 0, carry: true },
    platforms: [
      { x: 110, y: 490, w: 190, kind: 'float' },
      { x: 980, y: 490, w: 190, kind: 'float' },
      { x: 410, y: 385, w: 190, kind: 'drift' },
      { x: 380, y: 880, w: 190, kind: 'reef' },
      { x: 700, y: 1000, w: 190, kind: 'reef' },
    ],
    bgm: 'area_sea', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: A, from: 'left', plat: 0 }, { type: I, from: 'right', delay: 0.8 }, { type: I, from: 'left', delay: 1.6 }, { type: I, from: 'right', delay: 2.4 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [{ type: V, from: 'right', plat: 1, delay: 0 }, { type: V, from: 'right', plat: 1, delay: 0.4 }, { type: I, from: 'left', delay: 1.4 }, { type: I, from: 'right', delay: 2 }, { type: MS, from: 'left', delay: 2.6 }] },
      { delay: 0.6, until: 1, enemies: [{ type: T, from: 'left', plat: 0 }, { type: I, from: 'right', delay: 1 }, { type: MS, from: 'right', delay: 1.8 }, { type: I, from: 'left', delay: 2.4 }] },
      // 高い所の波（ブロックの上へ上から降りてくる）
      { delay: 2.5, until: 1, enemies: [{ type: A, from: 'top', plat: 2 }, { type: AR, from: 'top', plat: 1, delay: 0.4 }, { type: I, from: 'left', delay: 1 }, { type: I, from: 'right', delay: 1.6 }, { type: MS, from: 'left', delay: 2.2 }] },
    ],
  },
  {
    n: 2, group: 'sea', name: '流木の浮島',
    bg: { proc: 'sea', look: 'noon', art: 'sea2', wl: 0.4525 }, water: { y: 540 }, groundY: 1240, sink: 560, rise: 400,
    ledge: SEA_LEDGE, start: { x: 150, plat: 0, carry: true },
    platforms: [
      { x: 100, y: 490, w: 190, kind: 'float' },
      { x: 990, y: 490, w: 190, kind: 'float' },
      { x: 380, y: 330, w: 170, kind: 'drift' },
      { x: 640, y: 170, w: 160, kind: 'drift' },
      { x: 330, y: 930, w: 190, kind: 'reef' },
      { x: 720, y: 1010, w: 190, kind: 'reef' },
    ],
    bgm: 'area_sea', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, swarm: true, enemies: [{ type: V, from: 'left', plat: 0, delay: 0 }, { type: V, from: 'left', plat: 0, delay: 0.4 }, { type: I, from: 'right', delay: 1.2 }, { type: MS, from: 'left', delay: 1.8 }, { type: I, from: 'right', delay: 2.4 }] },
      { delay: 0.8, until: 1, enemies: [{ type: KR, from: 'right', plat: 1 }, { type: I, from: 'left', delay: 1 }, { type: IR, from: 'right', delay: 2 }, { type: MS, from: 'left', delay: 2.8 }] },
      { delay: 0.6, until: 1, swarm: true, enemies: [{ type: O, from: 'top', plat: 2 }, { type: V, from: 'top', plat: 3, delay: 0.25 }, { type: I, from: 'left', delay: 1.4 }, { type: IR, from: 'right', delay: 2.2 }, { type: I, from: 'right', delay: 3 }] },
      { delay: 2.5, until: 1, enemies: [{ type: O, from: 'top', plat: 2 }, { type: O, from: 'top', plat: 3, delay: 0.4 }, { type: MS, from: 'left', delay: 1 }, { type: I, from: 'right', delay: 1.6 }, { type: IR, from: 'left', delay: 2.2 }] },
    ],
  },
  {
    n: 3, group: 'sea', name: '海底の裂け目',
    bg: { proc: 'sea', look: 'deep', art: 'sea3', wl: 0.468 }, water: { y: 520 }, groundY: 1240, sink: 720, rise: 180,
    gaps: [{ x0: 500, x1: 780 }], pit: { y: 1470, dmg: 14 },
    ledge: SEA_LEDGE, start: { x: 150, plat: 0, carry: true },
    platforms: [
      { x: 100, y: 470, w: 190, kind: 'float' },
      { x: 990, y: 470, w: 190, kind: 'float' },
      { x: 360, y: 310, w: 160, kind: 'float' },
      { x: 760, y: 310, w: 160, kind: 'float' },
      { x: 150, y: 1000, w: 190, kind: 'reef' },
      { x: 890, y: 1000, w: 190, kind: 'reef' },
    ],
    bgm: 'area_sea', clearHeal: 25, timeLimit: 180,
    waves: [
      { delay: 1.0, enemies: [{ type: E, from: 'left', plat: 0 }, { type: AR, from: 'right', plat: 1, delay: 0.7 }, { type: IR, from: 'right', delay: 1.2 }, { type: I, from: 'left', delay: 1.8 }, { type: MS, from: 'right', delay: 2.4 }] },
      { delay: 0.8, until: 1, swarm: true, enemies: [{ type: O, from: 'right', plat: 1, delay: 0 }, { type: O, from: 'right', plat: 1, delay: 0.4 }, { type: MS, from: 'left', delay: 1.4 }, { type: IR, from: 'right', delay: 2 }, { type: I, from: 'left', delay: 2.6 }] },
      { delay: 0.6, until: 1, enemies: [{ type: P, from: 'left' }, { type: P, from: 'right', delay: 0.6 }, { type: I, from: 'left', delay: 1.4 }, { type: IR, from: 'right', delay: 2 }, { type: MS, from: 'left', delay: 2.6 }, { type: IR, from: 'right', delay: 3.2 }] },
      { delay: 2.5, until: 1, enemies: [{ type: A, from: 'top', plat: 2 }, { type: A, from: 'top', plat: 3, delay: 0.4 }, { type: IR, from: 'left', delay: 1 }, { type: MS, from: 'right', delay: 1.6 }, { type: IR, from: 'left', delay: 2.2 }] },
    ],
  },
  {
    n: 4, group: 'sea', name: '四天王の海', boss: true,
    bg: { proc: 'sea', look: 'dusk', art: 'sea4', wl: 0.4212 }, water: { y: 520 }, groundY: 1240, sink: 560, rise: 180,
    ledge: SEA_LEDGE, start: { x: 150, plat: 0, carry: true },
    platforms: [
      { x: 110, y: 470, w: 190, kind: 'float' },
      { x: 980, y: 470, w: 190, kind: 'float' },
      { x: 555, y: 420, w: 170, kind: 'float' },
      { x: 300, y: 960, w: 190, kind: 'reef' },
      { x: 760, y: 960, w: 190, kind: 'reef' },
    ],
    bgm: 'boss7', clearHeal: 40, timeLimit: 180,
    waves: [
      { delay: 2.4, enemies: [{ type: MO, from: 'right' }] },
      // ボスだけになって9秒たつと群れが来る（ボスを倒すと打ち切り）。
      { delay: 9, until: 1, swarm: true, enemies: [{ type: I, from: 'left' }, { type: I, from: 'right', delay: 0.45 }, { type: I, from: 'left', delay: 0.9 }, { type: I, from: 'right', delay: 1.35 }] },
      { delay: 12, until: 1, swarm: true, enemies: [...onPlat(column(V, 'right', 2, 0.4), 1), { type: P, from: 'left', delay: 1.0 }, { type: I, from: 'left', delay: 1.4 }, { type: I, from: 'right', delay: 2.0 }, { type: I, from: 'left', delay: 2.6 }, { type: I, from: 'right', delay: 3.2 }] },
    ],
  },
];

/**
 * 版3.0：海のワールドを入れる場所（1か所）。この番号のワールドの「あと」に入る（6＝ワールド6のあと＝ライバル戦の前）。
 * 変えると、海のワールドの前後のワールド番号・面のラベル（W-N）・通し番号・ワールドの名前（AREAS）・ステージセレクト・難しさの曲線が全部ついてくる
 * （曲線は「そのワールドと次のワールドの中間」＝difficulty.js の curveOf('after:N')）。ライバル戦（final）は、いつも最後。
 */
export const SEA_AFTER_WORLD = 3;

/**
 * 版3.8（面の再編）：世界の並び。数字＝陸の元のワールド番号（LAND の world）・'sea'＝海。ボスは各ワールドの 4 面目で、四天王（ティタノ・ケツァル・モサ・スピノ）が連続し、そのあとティラノ→ギガノト→ライバルの順。
 *   並び＝密林(スケルトン)→大平原(ティタノ)→断崖と空(ケツァル)→海(モサ)→古代遺跡(スピノ)→火山と荒野(ティラノ)→溶岩の闘技場(ギガノト)→最終決戦(ライバル)。
 *   各ワールドのボスはそのワールドの景色のまま（海のモサ・祭壇のスピノ・火山の頂のティラノ・溶岩の闘技場のギガノト）で、食い違いが出ない。
 * 難しさの曲線（WORLD_CURVE）は「位置」で決める（DIFF_KEYS）。前と同じ位置の曲線（1.0→1.05→1.10→1.22→1.35）をそのまま使うので、面の難しさの山は動かない。
 */
export const WORLD_ORDER = [1, 2, 3, 'sea', 5, 4, 6, 7];
export const DIFF_KEYS = [1, 2, 3, 4, 'after:4', 5, 6, 7];

/** ワールドの名前（番号なし）。AREAS（HUD に出す「WORLD n  名前」）は、並べ替えたあとの番号で作る。 */
const GROUP_NAME = { 1: '密林', 2: '大平原', 3: '断崖と空', 4: '火山と荒野', 5: '古代遺跡', 6: '溶岩の闘技場', sea: '海', 7: '最終決戦' };

/**
 * 陸の面（land＝世界 1〜6 とライバル戦）と海の面（sea）を、afterWorld のあとに海を入れて並べ、ワールド番号・n・ラベル・通し番号・難しさの曲線の鍵（curve）を付ける。
 * 曲線の鍵：陸の面＝元のワールド番号（並べ替えても変わらない）／海＝'after:N'／ライバル戦＝7。
 */
export function arrangeStages(land, sea, afterWorld = SEA_AFTER_WORLD, names = GROUP_NAME, areas = null, order = null, diffKeys = DIFF_KEYS) {
  // order を渡すと、その並び（WORLD_ORDER）で並べる。難しさの鍵 curve は「位置」（diffKeys）・保存の鍵 keyId は元の「ワールド-面」（位置が変わっても変わらない）。
  //   order を省くと（古い試験）、afterWorld のあとに海を入れる従来の並び（curve は元のワールド番号）。
  const seq = order
    ? order.flatMap((k) => (k === 'sea' ? sea : land.filter((s) => s.world === k)))
    : [...land.filter((s) => s.world <= afterWorld), ...sea, ...land.filter((s) => s.world > afterWorld)];
  let w = 0, last = null;
  return seq.map((st, i) => {
    const key = st.group ?? st.world;
    if (key !== last) { w++; last = key; if (areas) areas[w] = { name: `WORLD ${w}  ${names[key]}` }; }
    const keyId = st.keyId ?? (st.group === 'sea' ? `S${st.n}` : `${st.world}-${st.n}`);
    const curve = st.curve ?? (order ? diffKeys[w - 1] : (st.group === 'sea' ? `after:${afterWorld}` : key));
    return { ...st, id: i + 1, world: w, area: w, label: `${w}-${st.n}`, curve, keyId };
  });
}

export const LAND_STAGES = LAND, SEA_STAGES = SEA, GROUP_NAMES = GROUP_NAME;      // 試験用（並べ替えを別の場所で試す）
export const STAGES = arrangeStages(LAND, SEA, SEA_AFTER_WORLD, GROUP_NAME, AREAS, WORLD_ORDER);

/** 'W-N'（ワールド表記）・'N'（通し番号）・数値のどちらも受けて、面の添字（0 始まり）を返す。読めなければ -1。 */
export function stageIndexOf(spec, stages = STAGES) {
  if (spec === null || spec === undefined || spec === '') return -1;
  const s = String(spec).trim();
  if (s.startsWith('pkg:')) return stages.findIndex((st) => st.pkgId === s.slice(4) || (st.pkg && st.pkg.id === s.slice(4)));      // 版3.3：?stage=pkg:<パッケージの id>
  const byLabel = stages.findIndex((st) => st.label === s);      // 版3.3：U-1 などユーザー作の面のラベルも受ける
  if (byLabel >= 0) return byLabel;
  const m = /^(\d+)\s*[-_.]\s*(\d+)$/.exec(s);
  if (m) {
    const w = Number(m[1]), n = Number(m[2]);
    return stages.findIndex((st) => st.world === w && st.n === n);
  }
  if (/^\d+$/.test(s)) { const k = Number(s); return k >= 1 && k <= stages.length ? k - 1 : -1; }
  return -1;
}
