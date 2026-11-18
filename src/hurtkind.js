// くらい音を「受けた攻撃の種類」で選ぶ（Nao 2026-11-15「相手の攻撃次第」「必殺技なら重い音に」）。
//   必殺・大技 → hurtHeavy ／ とがった攻撃（噛みつき・爪・引っかき・くちばし）→ hurtSharp ／ それ以外（体当たり・突進・踏みつけ・尻尾・衝撃波・頭突き）→ hurtBlunt
//   つまみ HURT_BY_KIND.on（sounds.js）。false なら従来どおり（主人公は 'hurt'、敵は技の命中音のまま）。
//   溶岩・奈落・水など「攻撃でないダメージ」はここを通らない（world.js が 'hurt' を直接鳴らす）。ガード・パリィの音も変えない。
import { HURT_BY_KIND } from './sounds.js';

/** 部位が尻尾でも口でもなく、技の名前で「ぶつかる」と決める技（ライバル・主人公の頭突き・打ち上げ・尻尾の回転）。 */
const BLUNT_MOVES = new Set(['launcher', 'uppercut', 'guardSpin', 'trip', 'finisher', 'airTail']);
/** 口の部位で当てるが「噛む」ではない技（マンモスの牙の突き・翼竜のくちばしの突き／急降下）。hurtSharp のまま。 */
const NOT_BITE = new Set(['gore', 'peck', 'dive']);
/** 命中音のうち、くらい音に置き換えてよい物（攻撃の当たり音）。quake（地ひびき）・whoosh（風）などの専用の音はそのまま。 */
const REPLACEABLE = new Set(['hit', 'bite', 'scratch', 'slam', 'ram', 'bossBite']);

/** 技の定義 def が必殺・大技か（敵の special・カットイン、ゲージ技 cost>0＝主人公の CP 必殺とライバルのゲージ技）。 */
export function isSpecialDef(def) {
  return !!def && (!!def.special || !!def.cutin || def.cost > 0 || (def.phases || []).some((ph) => ph.ev === 'cutIn' || ph.ev === 'furyCut'));
}

/** 当たり hit（part・sfx）と技の名前から 'hurtSharp' | 'hurtBlunt' | 'hurtHeavy' を返す。heavy＝必殺・大技（呼び側が渡す）。 */
export function hurtKindOf(def, name, hit, heavy = false) {
  if (heavy || isSpecialDef(def)) return 'hurtHeavy';
  const part = (hit && hit.part) || '', sfx = (hit && hit.sfx) || '';
  if (BLUNT_MOVES.has(name)) return 'hurtBlunt';
  if (/tail|rearhalf/.test(part)) return 'hurtBlunt';
  if (/^(ram|quake|whoosh|slam)$/.test(sfx)) return 'hurtBlunt';
  if (/low/.test(part) && !/maw|mouth|claw/.test(part)) return 'hurtBlunt';
  // 2026-11-18：噛みつき（口の当たり・噛みつきの命中音）は爪と分けて hurtBite。前は爪と同じ hurtSharp＝引っかきの音が鳴っていた（Nao）
  //   口の部位（maw・mouth）で決める。命中音 bossBite はボスの打撃全般に使われている（骨のなぎ払い・首振り）ので見ない。口の部位でも牙の突き・くちばしは爪側
  if (HURT_BY_KIND.bite && !/claw/.test(part) && /maw|mouth/.test(part) && !NOT_BITE.has(name)) return 'hurtBite';
  if (HURT_BY_KIND.bite && /^(bite|bossBite)$/.test(name) && !/claw/.test(part)) return 'hurtBite';      // 技の名前が噛みつき（骨のティラノは頭蓋 skull・モササウルスは前半身 fronthalf で当てている）
  if (/claw|maw|mouth|skull|fronthalf/.test(part)) return 'hurtSharp';
  return 'hurtBlunt';
}

/** 主人公がくらったときの音のキー（つまみが切れていれば従来の 'hurt'）。 */
export function playerHurtSfx(def, name, hit, heavy = false) {
  return HURT_BY_KIND.on ? hurtKindOf(def, name, hit, heavy) : 'hurt';
}

/** 敵がくらったときに鳴らす音の並び [[キー, 音量]…]。命中音（hit.sfx）が当たり音なら置き換え、専用の音ならそのまま＋必殺だけ重い音を重ねる。 */
export function enemyHurtSfx(def, name, hit, heavy = false, vol = 1) {
  const base = (hit && hit.sfx) || 'hit';
  if (!HURT_BY_KIND.on) return [[base, vol]];
  const k = hurtKindOf(def, name, hit, heavy);
  if (REPLACEABLE.has(base)) return [[k, vol]];
  return k === 'hurtHeavy' ? [[base, vol], [k, vol]] : [[base, vol]];
}