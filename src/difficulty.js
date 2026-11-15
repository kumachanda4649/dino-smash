// 版3.4（2026-11-03 Nao「今の難易度をノーマルにして、他のバランスを調整して」）：
//   「ふつう（normal）」の行は **基準として固定**（数値は 2026-11-03 時点のまま・触らない。部位別ダメージ・徘徊・面の再編を入れた「いま」の手ごたえ）。
//   やさしい・むずかしいを、ふつうに対して取り直した（docs/難易度調整_2026-11-03.md に前後の表）。
//   やさしい＝初心者でもボスまで進める（ふつうよりはっきり易しい）／むずかしい＝ふつうよりはっきり手ごわいが、版2.0 の「全部 1」ほど理不尽ではない。
//   旧むずかしい（全部 1）は 5-4・6-4・8-1 などで「ふつうでは通るのに むずかしいでは 0%」という崖があったため、ふつうとの差を縮めた。
//   ふつう ≧ むずかしい の単調性は tools/diff_monotone_test.mjs が見張る。
//
// 難しさ3段階の表（1か所）と、面が進むほど強くなる曲線（ワールドごとの倍率・1か所）。
//
// 版2.0（2026-10-12 Nao「今の難易度さっきノーマル言ったけどハードにしてください」）：
//   「むずかしい」＝版1.3 までの「ふつう」の調整（全部 1）。「ふつう」「やさしい」は、それより易しく作り直した。
//   （版1.3 の「むずかしい」の行は、いまの調整より強すぎるので廃止。）
//
//  enemyHp    敵（ライバル以外）の体力の倍率
//  rivalHp    ライバルの体力の倍率
//  atkGap     敵の攻撃の間（クールダウン）の倍率。小さいほど頻繁に攻撃してくる
//  guardMul   敵の読みガードの確率の倍率（0.98 が上限）。ライバルのガード率にも掛ける
//  rivalGauge ライバルの必殺ゲージの溜まりの倍率（溜まりやすい＝技を多く使う）
//  enemyDmg   敵の攻撃の威力の倍率
//  healMul    面クリアの回復の倍率（固定量・コンボ連動の両方と、その上限に掛ける）
//  timeMul    制限時間の倍率（面の表の timeLimit に掛ける）
//  lavaMul    マグマだまりのダメージの倍率（版3.4・やさしい＝半分。ふつう＝1）。池に落ちる回数は敵のノックバックで難しさに関係なく増えるので、固定ダメージが山になっていた
//  summonMul  ボス戦の雑魚呼びの量の倍率（版2.1・Nao「雑魚を呼ぶのは難易度を下げる行為なので、調整に使って」）。
//             ボスの周りに雑魚が居ると、主人公は雑魚を殴ってゲージとコンボを稼げる＝助け舟。やさしい＝多め・ふつう＝今の量・むずかしい＝少なめ
export const DIFFICULTY = {
  easy:   { id: 'easy',   label: 'やさしい',   enemyHp: 0.45, rivalHp: 0.4,  atkGap: 2.2,  guardMul: 0.2,  rivalGauge: 0.35, enemyDmg: 0.33, healMul: 2.0,  timeMul: 1.6,  summonMul: 1.8, parryMul: 2.0, lavaMul: 0.5 },
  normal: { id: 'normal', label: 'ふつう',     enemyHp: 0.8,  rivalHp: 0.8,  atkGap: 1.25, guardMul: 0.7,  rivalGauge: 0.8,  enemyDmg: 0.75, healMul: 1.25, timeMul: 1.15, summonMul: 1, parryMul: 1.25, lavaMul: 1 },
  hard:   { id: 'hard',   label: 'むずかしい', enemyHp: 0.97, rivalHp: 0.9,  atkGap: 1.15, guardMul: 0.75, rivalGauge: 0.9,  enemyDmg: 0.85, healMul: 1.1,  timeMul: 1.06, summonMul: 0.7, parryMul: 1.15, lavaMul: 1.15 },
};
// 倍率ぜんぶ 1 の「素の値」（選べない・試験と World の初期値用）。版3.4 までは「むずかしい」がこの値だった。表の外の基準として残す。
export const DIFFICULTY_RAW = { id: 'raw', label: '素の値', enemyHp: 1, rivalHp: 1, atkGap: 1, guardMul: 1, rivalGauge: 1, enemyDmg: 1, healMul: 1, timeMul: 1, summonMul: 1, parryMul: 1, lavaMul: 1 };
export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];
export const DEFAULT_DIFFICULTY = 'normal';
export function difficultyOf(id) { return id === 'raw' ? DIFFICULTY_RAW : (DIFFICULTY[id] || DIFFICULTY[DEFAULT_DIFFICULTY]); }

/**
 * 版2.0：ワールドごとの曲線。上の難しさの表の値に、ワールドの倍率を掛けて、その面で使う値にする（difficultyFor）。
 * 面が進むほど少しずつ強い。6-4（ワールド6のボス）と 7-1（ライバル）がいちばんきつい。
 *   hp    敵の体力（enemyHp・rivalHp に掛ける）
 *   dmg   敵の攻撃の威力（enemyDmg に掛ける）
 *   gap   攻撃の間（atkGap に掛ける。小さいほど頻繁）
 *   guard 読みガードの確率（guardMul に掛ける）
 *   gauge ライバルの必殺ゲージ（rivalGauge に掛ける）
 *   summon ボス戦の雑魚呼びの量（summonMul に掛ける）。後半ほどきつい＝助け舟を減らす。7-1（ライバル）は 1 対 1 の決戦なので 0（雑魚呼び無し）
 * 「むずかしい」のワールド4 ＝ 版1.3 までの「ふつう」の調整とほぼ同じ（1.0）。ワールド1〜3 はそれより易しい出だし。
 */
export const WORLD_CURVE = {
  1: { hp: 0.80, dmg: 0.80, gap: 1.20, guard: 0.80, gauge: 1, summon: 1.0 },
  2: { hp: 0.90, dmg: 0.90, gap: 1.10, guard: 0.90, gauge: 1, summon: 1.0 },
  3: { hp: 0.95, dmg: 0.95, gap: 1.05, guard: 0.95, gauge: 1, summon: 1.0 },
  4: { hp: 1.00, dmg: 1.00, gap: 1.00, guard: 1.00, gauge: 1, summon: 0.9 },
  5: { hp: 1.10, dmg: 1.08, gap: 0.93, guard: 1.05, gauge: 1, summon: 0.8 },
  6: { hp: 1.22, dmg: 1.18, gap: 0.85, guard: 1.10, gauge: 1, summon: 0.7 },
  7: { hp: 1.35, dmg: 1.30, gap: 0.78, guard: 1.15, gauge: 1.2, summon: 0 },
};
/**
 * 曲線の鍵 → その面の倍率の表。鍵は、陸の面＝元のワールド番号（1〜6）・ライバル戦＝7・海のワールド＝'after:N'（版3.0：ワールド N のあとに入る海は、N と次のワールドの中間。N が 6 なら 6 と同じ＝ライバル戦の曲線は混ぜない）。
 * 海の置き場（stages.js の SEA_AFTER_WORLD）を変えても、曲線は置き場にあわせてついてくる。
 */
export function curveOf(key) {
  if (typeof key === 'string' && key.startsWith('after:')) {
    const n = Math.max(1, Math.min(6, parseInt(key.slice(6), 10) || 1));
    const a = WORLD_CURVE[n], b = WORLD_CURVE[Math.min(6, n + 1)], out = {};
    for (const k of Object.keys(a)) out[k] = +((a[k] + b[k]) / 2).toFixed(4);
    return out;
  }
  return WORLD_CURVE[key] || WORLD_CURVE[1];
}

/** 難しさ id とワールド番号から、その面で使う値（world.js の this.diff）を作る。world を省略すると難しさの表そのまま。 */
export function difficultyFor(id, world) {
  const d = difficultyOf(id);
  if (!world) return d;
  const c = curveOf(world);
  return {
    ...d, world,
    enemyHp: d.enemyHp * c.hp, rivalHp: d.rivalHp * c.hp,
    enemyDmg: d.enemyDmg * c.dmg, atkGap: d.atkGap * c.gap,
    guardMul: d.guardMul * c.guard, rivalGauge: d.rivalGauge * c.gauge, summonMul: d.summonMul * c.summon,
  };
}

// 制限時間（版1.3）。面の表（stages.js）の timeLimit（秒・元のゲームは 180）が正本。0 になっても面は終わらず、体力とゲージが減っていく。
export const TIME_LIMIT = {
  default: 180,
  drainSeconds: 20,         // 0 になってから体力が尽きるまでの目安（秒）。最大体力 ÷ これ ＝ 毎秒の減り
  gaugeDrain: 6,            // 0 になってからのゲージの毎秒の減り
  continueSeconds: 30,      // コンティニューで 0 だったときに戻す秒数（元のゲームどおり）
};

/**
 * 版2.1：ボス戦の雑魚呼びの量（1か所）。量 ＝ 元の数 × 難しさ・ワールドの倍率（diff.summonMul）× 救済（summonAid）。
 *  救済＝主人公が苦しいほど助け舟を増やし、余裕のときは減らす。範囲は aidMin〜aidMax に収める（上限と下限）。
 *    体力が lowHp 以下        → +lowHpPlus
 *    この面で倒れた回数（その場復活）1回ごとに +deathPlus（deathMax 回ぶんまで）
 *    体力が comfyHp 以上       → −comfyMinus
 *  on:false にすると救済は効かない（倍率 1・試験の陰性対照用）。
 */
export const SUMMON = { on: true, aidMin: 0.6, aidMax: 1.8, lowHp: 0.35, lowHpPlus: 0.4, deathPlus: 0.25, deathMax: 3, comfyHp: 0.85, comfyMinus: 0.3 };
/** 救済の倍率。hpRatio＝主人公の体力の割合（0〜1）、deaths＝この面で倒れた回数。 */
export function summonAid(hpRatio, deaths) {
  if (!SUMMON.on) return 1;
  let a = 1;
  if (hpRatio <= SUMMON.lowHp) a += SUMMON.lowHpPlus;
  if (hpRatio >= SUMMON.comfyHp) a -= SUMMON.comfyMinus;
  a += SUMMON.deathPlus * Math.min(deaths, SUMMON.deathMax);
  return Math.min(SUMMON.aidMax, Math.max(SUMMON.aidMin, a));
}
/** 元の数 base から、実際に呼ぶ数（四捨五入）。倍率が 0（ライバル戦）なら 0。 */
export function summonCount(base, summonMul, aid = 1) {
  if (!(base > 0) || !(summonMul > 0)) return 0;
  return Math.max(0, Math.round(base * summonMul * aid));
}
