// 版2.6：調整スライダー（デバッグモード）の表と、いまの値。
// Nao「今の状態を100としてパーセンテージでスライダーで指定できるようにしてください。調整のものは、しばらくそういうモードを作っておく。」
//
// ■ 増やし方：下の TUNE_TABLE に1行足すだけ（画面のスライダーは表から自動で作る）。効かせる側は world.js などで tn('id') を掛ける。
//   id     半角英数（保存・記録のキー）
//   label  画面に出す名前
//   group  画面の見出し
//   note   一言（何に掛かるか）
//   min / max  省略すると 10〜300（%）
// ■ 意味：100 が「いまの既定の値」。120 なら 1.2 倍。高さのように二乗で効くものは、割合が見た目の高さにそのまま効くように平方根で掛ける（world.js 側で sqrt）。
// ■ 値は localStorage（dinoArtsTune）に保存する。試験（Node）は保存を読まないので、いつも 100%。
export const TUNE_MIN = 10, TUNE_MAX = 300;

/** 2026-10-23：急降下を出した瞬間に減る CP（ゲージは 0〜100。体当たり=50・咆哮=30 なので、体当たりの 3/10）。調整スライダー diveCp の 100% = この値。
 *  必殺ではない（技の表の cost は 0 のまま＝ガード貫通・必殺の相殺には使わない）。連続使用を抑えるためだけの消費。 */
export const DIVE_CP = 15;

export const TUNE_TABLE = [
  { id: 'liftHeight',   group: 'コンボ・吹き飛び', label: '打ち上げの高さ',          note: '↑+Z などで敵を打ち上げる高さ（見た目の高さの割合）' },
  { id: 'riseLift',     group: 'コンボ・吹き飛び', label: '昇りの浮き',              note: '↑を押しながら殴るときの、主人公と敵の浮き（お手玉）' },
  { id: 'wallBounce',   group: 'コンボ・吹き飛び', label: '壁の反射',                note: '壁に当たって跳ね返る勢い' },
  { id: 'wallDmg2',     group: 'コンボ・吹き飛び', label: '壁の2回目以降のダメージ',  note: '同じ吹き飛び中の2回目以降の激突ダメージ（50%・25%に掛ける）' },
  { id: 'comboWindow',  group: 'コンボ・吹き飛び', label: 'コンボの切れる時間',      note: '何も当たらない時間がこれを超えるとコンボが切れる' },
  { id: 'hpGrunt',      group: '敵',               label: '敵の体力（雑魚）',        note: '次に出る敵から効く' },
  { id: 'hpBoss',       group: '敵',               label: '敵の体力（ボス・ライバル）', note: '次に出る敵から効く' },
  { id: 'enemyDmg',     group: '敵',               label: '敵の攻撃力',              note: '' },
  { id: 'enemyGap',     group: '敵',               label: '敵の攻撃の間隔',          note: '大きいほどゆっくり攻めてくる' },
  { id: 'guardChance',  group: '敵',               label: '敵のガードの確率',        note: '' },
  { id: 'downNeed',     group: '敵',               label: 'ダウンまでの量',          note: '敵が倒れるまでに必要なヒット数' },
  { id: 'rivalGauge',   group: '敵',               label: 'ライバルのゲージの溜まり', note: '' },
  { id: 'rageStrength', group: '敵',               label: 'ボスの怒りの強さ',        note: '怒りの強化の効き（0に近いほど強化なし）' },
  { id: 'summonCount',  group: '敵',               label: '雑魚呼びの数',            note: 'ボス戦で呼ぶ雑魚の量' },
  { id: 'chaseHop',     group: '敵',               label: '跳べる敵の跳びの間隔',    note: '足場を追って跳ぶ敵の、跳びと跳びの間（大きいほどゆっくり登る）' },
  { id: 'chaseWait',    group: '敵',               label: '足場の下で待つ時間',      note: '重い敵・ボスが足場の真下で待ってから足場をゆらすまで' },
  { id: 'counterChance', group: '敵',             label: 'ボスのカウンター確率',    note: '10 コンボ以上のとき、ヒットごとにボスが必殺カウンターを出す確率（100% = 10 コンボで約 15%）' },
  { id: 'counterStep',   group: '敵',             label: 'カウンター確率の上がり幅', note: '1 コンボ増えるごとに増える確率（100% = +5%）' },
  { id: 'counterMax',    group: '敵',             label: 'カウンター確率の上限',    note: '確率はこれ以上に上がらない（100% = 80%。125% 以上で確定になる）' },
  { id: 'chainStop',      group: '敵',             label: '玉突きでカウンターが止まる確率', note: '反撃（必殺カウンター）の最中のボスに、飛ばした雑魚がぶつかったとき反撃が止まる確率（100% = 30%・0% で止まらない）' },
  { id: 'cpGain',       group: '主人公',           label: 'CP の溜まり',             note: '' },
  { id: 'diveCp',      group: '主人公',           label: '急降下の CP 消費',        note: '空中の急降下（↓＋攻撃／↓↓＋攻撃）を出した瞬間に減る CP。必殺ではない（ガードを貫かない・必殺に勝たない）' },
  { id: 'cpGuardCost',  group: '主人公',           label: 'CP のガード消費',         note: '' },
  { id: 'parryWindow',  group: '主人公',           label: 'パリィの猶予',            note: '' },
  { id: 'limiter',     group: '音',               label: '音のリミッター（強さ）',   note: '効果音を重ねたときの音割れを抑える圧縮（src/audio.js の LIMITER）。0% = 無効。100% = 既定。曲は大きく変わらない', min: 0, max: 200 },
];

/**
 * 版3.2：足場の上の主人公を追う敵の待ち・間隔（Nao「アルゴリズム点検して早くついびできるようにしてください」）。追尾の定数はここに集める（world.js の HOP・QUAKE・FLY が読む）。
 *   hopWait      1回目の跳びの前の立ち止まり(秒)（原作どおり）／ hopWaitChain  連続して跳ぶときの2回目以降の立ち止まり
 *   hopCool      1つの追跡の最後の跳びのあと、次に跳ぶまでの間隔（原作の 2.2〜3.0 秒）／ hopCoolChain  まだ上の足場へ続く跳びのあとの間隔
 *   landCd       跳んで着地した直後に攻撃が出るまでの最低の秒（予兆の分と合わせて、追いつかれてから最初の被弾まで 1 秒以上の余裕にする）
 *   quakeWait    重い敵が足場の真下で待つ秒（旧 3.5）／ bossWait ボスが足場の主人公に届かないまま待つ秒（旧 4.0）／ runMul 足場の真下へ歩く速さの倍率・runMin その下限(px/秒)／hopRunMul 跳べる敵が跳ぶ場所へ近づく駆け足の倍率／enterRush 主人公が足場の上にいるとき跳べない重い敵が入ってくる速さの倍率／bossRunMul ボスが足場の真下へ寄る速さの倍率
 *   flyFollow    飛ぶ敵が主人公の面の高さへ寄る強さ（旧 3.0）／ flyArrive 高さを合わせてから急降下に入るまでの最低の秒（急降下の予告 0.55 秒と合わせて 1 秒）
 */
export const CHASE = {
  hopWait: 0.4, hopWaitChain: 0.15, hopCool: [2.2, 3.0], hopCoolChain: 1.0, landCd: 0.7,
  quakeWait: 2.5, bossWait: 2.5, runMul: 2.8, runMin: 260, hopRunMul: 2.0, enterRush: 1.8, bossRunMul: 1.4,
  flyFollow: 4.5, flyArrive: 0.45,
};

/** カウンター改：ボスのカウンター（旧コンボ破り）の確率。コンボが breakAt(world.js bossTune) 以上のとき、主人公の攻撃が当たるたびに抽選する。
 *  数えるのはそのボス個体への被弾数だけ（世界のコンボは使わない）。確率 = base + step × (被弾数 − breakAt)、上限 max。調整スライダーの 100% = この値。 */
export const COUNTER = { base: 0.15, step: 0.05, max: 0.8, win: 1.6, chainStop: 0.30, pendMax: 1.5 };      // pendMax＝カウンターの予約を出せないまま持ち続ける最長の秒数（過ぎたら捨てる。2026-10-24）      // chainStop＝反撃（完全アーマー）の最中のボスに玉突き（飛ばした雑魚）がぶつかったとき反撃が止まる確率（Nao 10-18「30パーセントくらい」。スライダー『玉突きでカウンターが止まる確率』の 100% = この値）。      // win＝ボス個体の被弾数（cbN）の猶予秒。ヒットの間がこれ以上あくと数え直し。コンボが切れたとき（endCombo）も数え直す

// 2026-11-15：プロトタイプの無い入れ物にする。前は Object.fromEntries の普通のオブジェクトで、保存に 'constructor'・'toString'・'valueOf' のような名前があると
//   継承したものを表の行と取り違えて通し、TUNE.pct に入って保存・記録・調整の回数（ver）まで漏れた（stagepkg.js の own() と同じ穴）
const BY_ID = Object.assign(Object.create(null), Object.fromEntries(TUNE_TABLE.map((r) => [r.id, r])));
export const TUNE_KEY = 'dinoArtsTune';

/** いまの割合（%）。1つの場所に持つ。ver は変わるたびに増える（World が見て、難しさ由来の値を作り直す）。 */
export const TUNE = { pct: {}, ver: 0 };

export const tuneRow = (id) => BY_ID[id] || null;
export const tuneBounds = (id) => { const r = BY_ID[id] || {}; return [r.min ?? TUNE_MIN, r.max ?? TUNE_MAX]; };
/** 倍率（100% → 1）。表に無い id・未設定は 1。 */
export function tn(id) { const v = TUNE.pct[id]; return v === undefined ? 1 : v / 100; }
/** 高さのような二乗で効くものの倍率（割合の平方根）。 */
export function tnSqrt(id) { return Math.sqrt(tn(id)); }
export function tunePct(id) { return TUNE.pct[id] === undefined ? 100 : TUNE.pct[id]; }

/** 割合を決める（範囲に丸める）。変わったら true。 */
export function setTune(id, pct) {
  if (typeof id !== 'string' || !BY_ID[id]) return false;
  if (pct === null || pct === '' || typeof pct === 'boolean' || typeof pct === 'object') return false;
  if (typeof pct === 'string' && pct.trim() === '') return false;      // 2026-11-15：空白だけの文字列も無視する（Number(' ') は 0 で、下限の 10% に化けた）      // 点検と監修：null・空文字・真偽値・配列/オブジェクトは Number() で 0/1 になり、保存データが壊れていると 10% に化けた（無視する）
  const [lo, hi] = tuneBounds(id);
  let v = Math.round(Number(pct));
  if (!Number.isFinite(v)) return false;
  v = Math.min(hi, Math.max(lo, v));
  if (tunePct(id) === v) return false;
  if (v === 100) delete TUNE.pct[id]; else TUNE.pct[id] = v;
  TUNE.ver++;
  return true;
}
export function resetTune() { const had = Object.keys(TUNE.pct).length > 0; TUNE.pct = {}; if (had) TUNE.ver++; return had; }
/** 100% でないものだけ { id: % }（記録・コピー用）。 */
export function tuneChanged() { return { ...TUNE.pct }; }
/** 全項目の { id: % }（コピー用）。 */
export function tuneAll() { const o = {}; for (const r of TUNE_TABLE) o[r.id] = tunePct(r.id); return o; }
/** 保存の文字列 → 反映（壊れていたら無視）。 */
export function loadTune(storage) {
  try {
    const s = storage && storage.getItem(TUNE_KEY);
    if (!s) return false;
    const o = JSON.parse(s);
    if (!o || typeof o !== 'object') return false;
    let any = false;
    for (const [k, v] of Object.entries(o)) if (setTune(k, v)) any = true;
    return any;
  } catch (e) { return false; }
}
export function saveTune(storage) { try { if (storage) storage.setItem(TUNE_KEY, JSON.stringify(TUNE.pct)); } catch (e) { /* 保存できなくても遊べる */ } }
