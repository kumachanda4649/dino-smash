// 版2.4：ボスの「怒り（第2段階）」。数値・色は全部ここ1か所（world.js・render.js・試験がここを読む）。
//   Nao「ボスの敵は、ヒットポイントが50%下回ると強化するようにしてください エフェクトはオーラのアニメーションをエフェクトを作ったはずです。それを組み合わせてください。」
//   体力が RAGE.at 未満になった瞬間に1回だけ「怒り」へ：短い演出（RAGE.intro 秒・無敵・主人公へ攻撃しない・画面が揺れる・オーラが燃え上がる）のあと、
//   倒れるまで強化とオーラが続く。強化の倍率は難しさ・ライバルで薄める（rageMul）。

export const RAGE = {
  on: true,            // false で怒りなし（陰性対照）
  at: 0.5,             // 体力の割合がこれ未満で怒りに入る
  maxWait: 1.0,        // 吹き飛び中・倒れ中に怒りを待たせる最長の秒数。過ぎたらその場で立て直して入る（2026-10-24）
  intro: 1.25,         // 演出の長さ（秒）。この間は無敵・攻撃しない
  blend: 0.3,          // 怒りに入る瞬間、直前の絵から待機へ溶かす秒数（版2.5）
  shake: 14,           // 演出の画面揺れ
  // 強化（1 が今まで）。ふつうのボス級の値（難しさ hard・ライバルでない）
  atkGap: 0.6,         // 攻撃の間・技ごとの待ち（小さいほど頻繁）
  speed: 1.2,          // 歩く・追う速さ
  spWeight: 1.8,       // 必殺技（ai.moves の sp）を選ぶ重み
  spLock: 0.6,         // 必殺技どうしの待ち（ai.spLock の倍率）
  flinch: 0.7,         // のけぞる長さの倍率（小さいほど固い＝ハイパーアーマーを強く）
  weight: 1.25,        // 重さ（吹き飛びにくい）
  dmg: 1.1,            // 攻撃の威力
};
// 難しさごとの効き（1＝上の値そのまま、0＝強化なし）。ライバルは元々強いので、さらに RAGE_RIVAL を掛ける。
export const RAGE_BY_DIFF = { easy: 0.5, normal: 0.8, hard: 1 };
export const RAGE_RIVAL = 0.5;
// ライバルは必殺技の重みを上げない（もともと技が多い）。咆哮の待ち時間だけ怒り中は短い（rival.js の roarCd × これ）。
export const RAGE_RIVAL_ROAR_CD = 0.75;

/** 倍率を 1 へ薄める。k=0 で 1、k=1 で値そのまま。 */
const thin = (v, k) => Math.max(0.15, 1 + (v - 1) * k);      // 版2.6：スライダーで強さを上げても、倍率が 0 以下にならない下限
/** 怒りの倍率（その敵・その難しさでの実効値）。 */
export function rageMul(diffId, rival, strength = 1) {
  const k = (RAGE_BY_DIFF[diffId] ?? 1) * (rival ? RAGE_RIVAL : 1) * strength;      // 版2.6：strength＝調整スライダー『ボスの怒りの強さ』
  return {
    k,
    atkGap: thin(RAGE.atkGap, k), speed: thin(RAGE.speed, k), spWeight: rival ? 1 : thin(RAGE.spWeight, k),
    spLock: thin(RAGE.spLock, k), flinch: thin(RAGE.flinch, k), weight: thin(RAGE.weight, k), dmg: thin(RAGE.dmg, k),
  };
}

// オーラの色（ボスごとに1つ）。名前は DinoAngerGlow.js（本編）の色の組と同じ。
export const AURA_PALETTES = {
  blue:   { core: [0.88, 0.96, 1.00], mid: [0.30, 0.58, 1.00], tip: [0.16, 0.32, 0.95] },
  flame:  { core: [1.00, 0.93, 0.52], mid: [1.00, 0.55, 0.12], tip: [0.86, 0.20, 0.04] },
  red:    { core: [1.00, 0.62, 0.52], mid: [0.95, 0.12, 0.10], tip: [0.52, 0.00, 0.06] },
  purple: { core: [0.96, 0.82, 1.00], mid: [0.66, 0.30, 0.96], tip: [0.32, 0.10, 0.62] },
  water:  { core: [0.82, 0.98, 1.00], mid: [0.08, 0.76, 0.92], tip: [0.04, 0.38, 0.72] },
  wind:   { core: [0.88, 1.00, 0.90], mid: [0.32, 0.88, 0.42], tip: [0.10, 0.52, 0.24] },
  earth:  { core: [1.00, 0.91, 0.64], mid: [0.82, 0.56, 0.20], tip: [0.46, 0.27, 0.08] },
  abyss:  { core: [0.78, 0.95, 1.00], mid: [0.12, 0.46, 0.86], tip: [0.03, 0.14, 0.46] },      // 版3.0：海のボス（深い海の青）
};
// ボスごとの色（オーラの色としてだけ。技の見た目に元素の炎は出さない）
export const AURA_COLOR = {
  SkeletonRex: 'blue',        // 骸骨：冷たい青白
  Titanosaurus: 'earth',      // 巨体：土の黄土
  Quetzalcoatlus: 'wind',     // 空の主：緑
  Giganotosaurus: 'flame',    // 橙〜黄
  SpinosaurusBoss: 'water',   // 四天王：水色
  Tyrannosaurus: 'red',       // 王：赤
  SpinoRival: 'purple',       // ライバル：紫
  Mosasaurus: 'abyss',        // 版3.0：海の王：深い海の青
};
// 強さ（本編の weak / mid）。R＝輪郭のにじみ幅(px)・L＝炎の高さ(px・体高178基準)・FL＝炎の濃さ・FLK＝ちらつき・STR＝全体の強さ
export const AURA_LEVEL = { weak: { R: 14, L: 24, FL: 0.80, FLK: 0.10, STR: 0.90 }, mid: { R: 15, L: 46, FL: 1.00, FLK: 0.16, STR: 1.00 } };
export const AURA_LEVEL_OF = { default: 'mid' };      // ボスは「中くらい」（高く立ち上がる）
export const AURA_REF_H = 178;
// 重ね方：色をそのまま重ねる強さ（over）と、加算で光らせる強さ（add）。本編は暗い戦闘背景への加算だけだったが、ダイノ・アーツの背景は明るい草原なので、色が出るよう両方を重ねる
export const AURA_BLEND = { over: 0.75, add: 0.6 };
