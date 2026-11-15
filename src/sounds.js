// 効果音と曲の表。ファイルは assets\audio\se\ と assets\audio\bgm\ にある。
// 版3.5：ツクール標準素材(RTP)は使わない（2026-10-20 だけ Nao 指示で効果音を一時復元＝下の SE_SET）。標準だった効果音は DA_*（ElevenLabs で作り直したオリジナル）、標準だった曲は地域名のキー(area_*)の曲に替えた。
//   出どころの表は docs/音の出どころ.md。ボス曲・タイトル・Dino_* の効果音は RPG1 用に作ったオリジナル（RPG1 から複製・tools/copy_assets.mjs）。
//   曲のループ点は assets/audio/bgm_loops.json（曲ごとの loopStart/loopEnd 秒・src/audio.js が Web Audio で繰り返す）。表に無い曲は曲全体を繰り返す。
// 既定の音量: BGM 0.2、効果音 0.9（audio.js）。
/** 恐竜の種ごとの咆哮（RPG1 の Dino_Roar_Dxxx_<種名>_Battle.ogg → assets/audio/se/DR_<種名>.ogg）。割り当てが無い種は growl（DA_Growl）のまま。 */
export const ROAR_SE = {
  DR_Giganotosaurus: 'DR_Giganotosaurus',         // D001 ギガノトサウルス
  DR_SpinosaurusElite: 'DR_SpinosaurusElite',     // D002 スピノサウルス（四天王個体）
  DR_Mosasaurus: 'DR_Mosasaurus',                 // D003 モササウルス
  DR_Titanosaurus: 'DR_Titanosaurus',             // D004 ティタノサウルス
  DR_Quetzalcoatlus: 'DR_Quetzalcoatlus',         // D005 ケツアルコアトルス
  DR_Triceratops: 'DR_Triceratops',               // D006 トリケラトプス
  DR_Allosaurus: 'DR_Allosaurus',                 // D007 アロサウルス
  DR_Pteranodon: 'DR_Pteranodon',                 // D008 プテラノドン
  DR_Spinosaurus: 'DR_Spinosaurus',               // D009 スピノサウルス
  DR_Tyrannosaurus: 'DR_Tyrannosaurus',           // D010 ティラノサウルス
  DR_Velociraptor: 'DR_Velociraptor',             // D012 ヴェロキラプトル
  DR_Ankylosaurus: 'DR_Ankylosaurus',             // D015 アンキロサウルス
  DR_Carnotaurus: 'DR_Carnotaurus',               // D017 カルノタウルス
  DR_Iguanodon: 'DR_Iguanodon',                   // D019 イグアノドン
  DR_Suchomimus: 'DR_Suchomimus',                 // D022 スコミムス
  DR_Therizinosaurus: 'DR_Therizinosaurus',       // D024 テリジノサウルス
  DR_Dimetrodon: 'DR_Dimetrodon',                 // D028 ディメトロドン
  DR_Compsognathus: 'DR_Compsognathus',           // D034 コンプソグナトゥス
  DR_Allocentrosaurus: 'DR_Allocentrosaurus',     // D037 アロケントロサウルス
  DR_Troodon: 'DR_Troodon',                       // D039 トロオドン
  DR_Albertosaurus: 'DR_Albertosaurus',           // D042 アルバートサウルス
  DR_Euoplocephalus: 'DR_Euoplocephalus',         // D043 エウオプロケファルス
  DR_Hypsilophodon: 'DR_Hypsilophodon',           // D051 ヒプシロフォドン
  DR_Eoraptor: 'DR_Eoraptor',                     // D030 エオラプトル
  DR_Ichthyosaurus: 'DR_Ichthyosaurus',           // 新規 イクチオサウルス（版3.x 咆哮4種・ElevenLabs 生成）
  DR_Mammoth: 'DR_Mammoth',                       // 新規 マンモス（版3.x 咆哮4種・ElevenLabs 生成）
  DR_SkeletonRex: 'DR_SkeletonRex',               // 新規 スケルトンレックス（版3.x 咆哮4種・ElevenLabs 生成）
};

/** 効果音の切替（Nao 2026-10-20「音が微妙です。とりあえず昔のバージョンに効果音はすべて戻して」）。
 *  'orig' = ツクールMZ標準素材(RTP)の効果音（一時復元・既定）／'new' = 版3.5以降の作り直し DA_*。曲・咆哮(DR_*)・Dino_* は切替の対象外。
 *  配布前は 'new' に戻して、復元した標準素材 22 本を assets/audio/se から外す（node tools/audio/se_set.mjs new）。 */
export const SE_SET = 'new';

/** 版3.5以降の作り直し（ElevenLabs）。 */
export const SE_NEW = {
  hit: 'DA_Hit',
  launch: 'DA_Launch',
  ram: 'DA_Ram',
  jump: 'DA_Jump',
  hurt: 'DA_Hurt',
  playerDown: 'DA_PlayerDown',
  enemyDown: 'DA_EnemyDown',
  guard: 'DA_Guard',
  clash: 'DA_Guard',
  growl: 'DA_Growl',
  screech: 'DA_Screech',
  whoosh: 'DA_Whoosh',
  quake: 'DA_Quake',
  clear: 'DA_Applause',
  powerup: 'DA_Powerup',
  decide: 'DA_Decide',
  cursor: 'DA_Cursor',
  cancel: 'DA_Cancel',
  explode: 'DA_Explode',
  land: 'DA_Land',
  splash: 'DA_Splash',      // 版3.0：水に入る・水から出る
  dive: 'DA_Dive',          // 版3.0：水の中へ潜る・水面を突き破る
  bubble: 'DA_Bubble',      // 版3.0：水中の動き
};

/** 版3.4まで使っていたツクールMZ標準素材(RTP)。SE_SET='orig' の間だけ使う（git の 014e94d^ から復元・MZ のインストール先と MD5 一致）。 */
export const SE_ORIG = {
  hit: 'Blow2',
  launch: 'Blow8',
  ram: 'Blow10',
  jump: 'Jump1',
  hurt: 'Damage2',
  playerDown: 'Collapse3',
  enemyDown: 'Down2',
  guard: 'Parry',
  clash: 'Parry',
  growl: 'Growl',
  screech: 'Cry1',
  whoosh: 'Slash3',
  quake: 'Earth3',
  clear: 'Applause1',
  powerup: 'Powerup',
  decide: 'Decision1',
  cursor: 'Cursor1',
  cancel: 'Cancel1',
  explode: 'Explosion2',
  land: 'Fall',
  splash: 'Splash',
  dive: 'Dive',
  bubble: 'Water1',
};

export const SE = {
  bite: 'Dino_Btl_Attack_Bite',
  scratch: 'Dino_Btl_Attack_Scratch',
  slam: 'Dino_Btl_Attack_BodySlam',
  special: 'Dino_Roar_D009_Spinosaurus_Battle',
  whoosh2: 'DA_Whoosh2',    // 版3.7：風を切るの別案（whoosh は残す・まだどこにも当てていない）
  bossBite: 'Dino_Btl_Attack_BodySlam',
  bossRoar: 'Dino_Roar_SkeletonRex_Battle',
  bossRoar2: 'Dino_Roar_D010_Tyrannosaurus_Battle',
  bossRoar3: 'Dino_Roar_D001_Giganotosaurus_Battle',
  step: 'Dino_Foot_Large_Stone_Walk_01',
  ...(SE_SET === 'orig' ? SE_ORIG : SE_NEW),
  ...ROAR_SE,
};

export const BGM = {
  title: 'BGM_Title',
  // 雑魚面の曲は「地域名」のキー（ワールドの並びを入れ替えても結び付きが変わらない。stages.js の bgm はこのキー）
  area_jungle: 'DB_JungleMorning',      // 密林（版3.8：本編の「密林」の曲から切り出し。Nao の判断ボード回答）
  area_plains: 'DB_WindDeparture',      // 大平原（版3.8：本編の「草原」の曲から切り出し）
  area_cliffsky: 'BGM_AreaCliffSky',    // 断崖と空
  area_volcano: 'BGM_AreaVolcano',      // 火山と荒野
  area_ruins: 'BGM_AreaRuins',          // 古代遺跡
  area_arena: 'BGM_AreaArena',          // 溶岩の闘技場
  area_sea: 'DB_HolyLake',              // 海（版3.0／版3.8：本編の「湖」の曲から切り出し）
  // 版3.8：差し替え前の生成曲（戻し用。ステージメーカーの曲の選択肢にも出る＝聞き比べて選び直せる）
  area_jungle_gen: 'BGM_AreaJungle',
  area_plains_gen: 'BGM_AreaPlains',
  area_sea_gen: 'BGM_AreaSea',
  boss1: 'BGM_BossSkeleton',
  boss2: 'BGM_BossChuubosu1',
  boss3: 'BGM_LastBossDragon',
  boss4: 'BGM_BossShitennou1',     // 版2.0：5-4 四天王
  boss5: 'BGM_BossChuubosu2',      // 版2.0：2-4 ティタノサウルス
  boss6: 'BGM_Battleboss01',       // 版2.0：3-4 ケツァルコアトルス
  boss7: 'BGM_BossShitennou2',     // 版3.0：海のボス（四天王モササウルス）
  ending: 'BGM_Ending',
};

/** 古い曲のキー（版3.4まで）→ 今のキー。ステージパッケージ（data/stage_packages）などに残っていても読めるようにする。 */
export const BGM_LEGACY = { area1: 'area_jungle', area2: 'area_volcano', area3: 'area_sea' };

export const VOLUME = { bgm: 0.2, se: 0.9 };

/** 効果音ごとの音量の補正（dB。負＝小さく）。Nao 2026-10-24「打撃音が決定音より約 10dB 大きい→釣り合いを考えて（お任せ）」。
 *  打撃・衝撃は約 6〜11dB 下げ（目標の大きさ −17.5dB）、咆哮は大きすぎるものだけ下げ（目標 −11dB・上げない）、決定・カーソル・取消・クリア・パワーアップは触らない。
 *  「大きさ」＝ 0.4 秒の窓で最大の RMS（tools/audio/se_levels.mjs が測る・--gen でこの表を作り直せる）。キーは SE のキー（SE_SET の 'orig'/'new' どちらでも同じ表）。
 *  調整はこの表の数字だけ（audio.js の se() が掛ける）。 */
export const SE_TRIM = {
  bite: -10.5,
  scratch: -7.5,
  slam: -10.5,
  special: -3.5,
  whoosh2: -8,
  bossBite: -10.5,
  bossRoar: -2,
  bossRoar2: -5.5,
  bossRoar3: -5,
  step: -11.5,
  hit: -7.5,
  launch: -6,
  ram: -9.5,
  jump: -8,
  hurt: -8,
  playerDown: -11,
  enemyDown: -8.5,
  guard: -8.5,
  clash: -8.5,
  growl: -7.5,
  whoosh: -9,
  quake: -11,
  explode: -9.5,
  land: -9,
  splash: -4,
  DR_Giganotosaurus: -5,
  DR_SpinosaurusElite: -5.5,
  DR_Mosasaurus: -8,
  DR_Titanosaurus: -3,
  DR_Quetzalcoatlus: -3,
  DR_Triceratops: -3,
  DR_Allosaurus: -1,
  DR_Pteranodon: -1.5,
  DR_Spinosaurus: -3.5,
  DR_Tyrannosaurus: -5.5,
  DR_Velociraptor: -2,
  DR_Ankylosaurus: -5,
  DR_Carnotaurus: -6,
  DR_Iguanodon: -5,
  DR_Suchomimus: -4,
  DR_Therizinosaurus: -5.5,
  DR_Dimetrodon: -1.5,
  DR_Compsognathus: -1.5,
  DR_Allocentrosaurus: -4,
  DR_Troodon: -2.5,
  DR_Albertosaurus: -2.5,
  DR_Euoplocephalus: -5.5,
  DR_Hypsilophodon: -3,
  DR_Eoraptor: -3.5,
  DR_Ichthyosaurus: -3,
  DR_Mammoth: -3.5,
  DR_SkeletonRex: -3.5,
};
/** SE のキー → 掛ける倍率（表に無ければ 1）。 */
export const seTrimGain = (name) => { const d = SE_TRIM[name]; return d ? Math.pow(10, d / 20) : 1; };
