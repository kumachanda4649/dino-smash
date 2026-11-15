// 入力の読み取り（DOM に触れない）。技の表（moves.js）の「入力」を文字列で書き、ここが履歴から読み取る。
//
// ■ 入力の書き方（技の行の input）
//   'attack'                    ボタンを押す                       （attack=Z / jump=X / special=C。ゲームパッドも同じ名前）
//   'up+attack'                 方向を押しながらボタン             （up down left right、または向き基準の forward back）
//   'down,forward+attack'       コマンド：方向を順に入れてからボタン（↓→+Z）。つなぎは seqGap 秒以内
//   'back>0.6,forward+attack'   溜め：back を0.6秒以上押し続け、離してから forward+ボタン
//   'attack+jump'               同時押し（simulTol 秒以内）
//   'attack>0.6'                ボタンの溜め：0.6秒以上押して、離した瞬間に出る（早く離したら普通の attack 行が出る）
//   'forward,forward'           方向だけ（ダッシュの2度押し）。tapGap 秒以内。間に反対の方向が入ったら2度押しではない（→←→ はダッシュにならない）
//   'down,downforward>0.04,forward+attack'  斜め入りのコマンド（↓↘→+Z）。斜め（downforward）は「↓と前が0.04秒以上いっしょに押された」。
//                               斜めの無い 'down,forward+attack'（↓→+Z）とは、斜めがあるほうが先（入力が複雑なほど優先）で取り違えない。斜めの語: downforward downback upforward upback
//   'down,down+attack'          ↓↓+Z（最後の↓は押したままボタン）。 'forward,back,forward+attack' は前・後・前+Z
//   方向を1つだけ押し続ける入力（'up+attack'）には時間窓を掛けない。コマンド（方向2つ以上）は、最初の方向を押してから最後の方向を押すまでが seqWindow 以内。
//   ボタンのあるコマンドは、さらに最後の方向を押してからボタンまでが lastToButton 以内（2026-11-15 決め7）。
//   forward / back は「その時の向き」基準（このゲームは入力した向きへ向きを変えるので、判定時の向きで読み替える）。
//
// ■ 使い方
//   const r = new CommandReader();
//   毎ステップ  r.feed(時刻, held, pressed)             … 押した瞬間・離した瞬間・方向の区間を記録（ヒットストップ中も呼ぶ）
//   技を決める  r.resolve(候補の行の配列, 向き)         … 成立した行を1つ返す（押したボタンは使い切り＝1回の入力で1回だけ出る）
//   候補の行は { id, parsed: parseInput(input), score } 。score が高い（＝入力が複雑）ほど優先（↓→+Z が →+Z や Z より先）。
// ■ 先行入力: 押してから bufferTime 秒のあいだは、技が出せる状態になった時に使われる（ヒットストップ中の入力も拾う）。

export const BUTTONS = ['attack', 'jump', 'special'];
const ABS_DIRS = ['up', 'down', 'left', 'right'];
// 斜め：2つの方向が同時に押されている間だけ続く「仮想の方向」。↓↘→（波動拳）の ↘ に使う。
//   'downforward>0.04'  … ↓と前が 0.04 秒以上いっしょに押された（短い押し間違いのかぶりは斜めとみなさない）
const DIAG_CH = { downleft: ['down', 'left'], downright: ['down', 'right'], upleft: ['up', 'left'], upright: ['up', 'right'] };
const DIAG_DIRS = ['downforward', 'downback', 'upforward', 'upback'];
const ALL_DIRS = [...ABS_DIRS, 'forward', 'back', ...DIAG_DIRS];
const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };

export const INPUT_DEFAULTS = {
  bufferTime: 0.25,   // 押してからこの秒数は「先行入力」として有効
  simulTol: 0.07,     // 同時押しとみなす時間差
  seqWindow: 0.55,    // コマンドの方向（最初の方向から最後の方向まで。溜めの時間は別に足す）。2026-11-15：ここは前から「最後のボタンまで」と書いてあったが、作り（と上の注記）は最後の方向までだった＝作りに合わせて書き直した（ボタンまでは lastToButton）
  seqGap: 0.18,       // コマンドの方向どうしのつなぎ（前の方向を離してから次を押すまで）
  tapGap: 0.28,       // 同じ方向の2度押しの間隔
  oppTol: 0.05,       // 反対向きの方向（↓と↑）どうしの順の許し：後の方向が先に押されても、この秒数以内なら同時とみなす（'down*,up+jump' の同時押し）
  dirTol: 0.04,       // 方向とボタンの「ほぼ同時」のずれ（方向がボタンより少し遅れて押された場合）
  releaseTol: 0.01,   // 方向をボタンより先に離したとき、まだ押している扱いにする長さ（同じコマ内だけ）。これより前に離したら「方向なし」＋ボタン（昇りのあとの尻尾の締めなど）
  tapOpposite: true,  // 同じ方向の2度押しの間に反対の方向が入ったら2度押しとみなさない（→←→ をダッシュ →→ にしない）。試験が false にして赤を確かめる
  seqToButton: false, // 2026-11-14 の案（判断ボードの決め7 の A）：seqWindow をボタンまで測る。2026-11-15 Nao「その形で直す」（決め7 は下の lastToButton の形）で false に戻した＝方向の窓は前と同じく「最初の方向から最後の方向まで」
  // 2026-11-15（決め7・Nao「その形で直す」）：コマンド（方向 2 つ以上＋ボタン）は、最後の方向を押してからボタンまでがこの秒数以内（最後の方向の溜めの時間は別に足す）。
  //   前は無く、↓→ のあと → を押したまま約 3 秒（記録が消えるまで）たってからの Z でも衝撃波・踏みつけ・咆哮などが出て CP を使った。方向の窓（seqWindow）は前のままなので、
  //   ゆっくり入れた前後前＋攻撃（最初の → から 0.62 秒）も、最後の → のすぐあとに Z を押せば出る。最初の方向を押したままの入力（'down*,up+jump'＝大ジャンプ）には掛けない。null で無し（旧）
  lastToButton: 0.3,
};

function splitHold(tok, src) {
  const m = /^([a-z]+)(\*)?(?:>(\d+(?:\.\d+)?))?$/.exec(tok);
  if (!m) throw new Error(`入力「${src}」: 読めない部分「${tok}」`);
  return [m[1], m[3] ? Number(m[3]) : 0, !!m[2]];
}

/** 入力の文字列を読んで構造にする。書き間違いは例外（check.mjs が全部の行を通して確かめる）。 */
export function parseInput(src) {
  if (typeof src !== 'string' || !src.trim()) throw new Error('入力が空');
  const out = { src, steps: [], btns: [] };
  for (const part of src.split('+').map((s) => s.trim())) {
    if (!part) throw new Error(`入力「${src}」: + の前後が空`);
    const toks = part.split(',').map((s) => s.trim());
    if (toks.length === 1 && BUTTONS.includes(splitHold(toks[0], src)[0])) {
      const [btn, hold, held0] = splitHold(toks[0], src);
      if (held0) throw new Error(`入力「${src}」: * は方向にだけ付ける`);
      if (out.btns.some((b) => b.btn === btn)) throw new Error(`入力「${src}」: ボタン ${btn} が2回`);
      out.btns.push({ btn, hold });
    } else {
      if (out.steps.length) throw new Error(`入力「${src}」: 方向の並びは1か所だけ`);
      for (const tk of toks) {
        const [dir, hold, held] = splitHold(tk, src);
        if (!ALL_DIRS.includes(dir)) throw new Error(`入力「${src}」: 未知の方向/ボタン「${dir}」（方向: ${ALL_DIRS.join(' ')} / ボタン: ${BUTTONS.join(' ')}）`);
        out.steps.push(held ? { dir, hold, held: true } : { dir, hold });
      }
    }
  }
  if (out.btns.length > 3) throw new Error(`入力「${src}」: ボタンが4つ以上`);
  if (out.btns.some((b) => b.hold > 0) && out.btns.length > 1) throw new Error(`入力「${src}」: ボタンの溜めは単独で（他のボタンとの同時押しにしない）`);
  if (!out.btns.length && !out.steps.length) throw new Error(`入力「${src}」: 何も無い`);
  if (!out.btns.length && out.steps[out.steps.length - 1].hold > 0) throw new Error(`入力「${src}」: 方向だけの入力は最後に溜めを置けない`);
  return out;
}

/** 入力の複雑さ（高いほど優先）。 */
export function inputScore(parsed) {
  return parsed.steps.length * 10 + parsed.btns.length * 5 + parsed.btns.reduce((a, b) => a + (b.hold > 0 ? 4 : 0), 0);
}

export class CommandReader {
  constructor(cfg = {}) {
    this.cfg = { ...INPUT_DEFAULTS, ...cfg };
    this.now = 0;
    this.reset();
  }

  reset() {
    this.segs = [];        // 方向の押している区間 {ch,start,end,used}
    this.open = {};        // いま押している方向（ch → seg）
    this.presses = [];     // ボタンの押した記録 {btn,t,rel,heldFor,used,deferred}
    this.btnHeld = {};
    this.btnStart = {};
  }

  /**
   * 2026-11-14：ポーズ・メニュー・コンティニューから遊びに戻るとき。止まっていた間（feed が呼ばれない）の記録を捨て、
   * いま押しているボタンは「前から押したまま」として扱う＝新しい押下にしない。
   * 前は、決定に使ったパッドの A がそのまま噛みつきに、取り消しの B／X がジャンプに化けた。ポーズ前の先行入力・ポーズをまたいだ →→ のダッシュも残らない。
   */
  resume(held) {
    this.reset();
    for (const b of BUTTONS) this.btnHeld[b] = !!(held && held[b]);
  }

  _press(b, now) {
    const ev = { btn: b, t: now, rel: null, heldFor: 0, used: false, deferred: false };
    this.presses.push(ev); this.btnStart[b] = ev;
  }
  _release(b, now) {
    const ev = this.btnStart[b];
    if (ev && ev.rel === null) { ev.rel = now; ev.heldFor = now - ev.t; }
    this.btnStart[b] = null;
  }

  /** 毎ステップ（ヒットストップ中も）呼ぶ。held は押しっぱなし、pressed は押した瞬間（1フレームより短い押しも拾う）。 */
  feed(now, held, pressed) {
    this.now = now;
    held = held || {}; pressed = pressed || {};
    for (const ch of ABS_DIRS) {
      const h = !!held[ch];
      if (h && !this.open[ch]) { const s = { ch, start: now, end: null, used: false }; this.segs.push(s); this.open[ch] = s; }
      else if (!h && this.open[ch]) { this.open[ch].end = now; this.open[ch] = null; }
    }
    for (const [ch, [a, b]] of Object.entries(DIAG_CH)) {
      const h = !!held[a] && !!held[b];
      if (h && !this.open[ch]) { const s = { ch, start: now, end: null, used: false }; this.segs.push(s); this.open[ch] = s; }
      else if (!h && this.open[ch]) { this.open[ch].end = now; this.open[ch] = null; }
    }
    for (const b of BUTTONS) {
      const h = !!held[b], pr = !!pressed[b], was = !!this.btnHeld[b];
      if (pr && was) { this._release(b, now); this._press(b, now); }
      else if ((pr || h) && !was) this._press(b, now);
      if (!h && (was || pr)) this._release(b, now);
      this.btnHeld[b] = h;
    }
    // 古い記録を捨てる
    const cut = now - 3;
    if (this.segs.length > 64 || (this.segs[0] && this.segs[0].end !== null && this.segs[0].end < cut)) this.segs = this.segs.filter((s) => s.end === null || s.end >= cut);
    if (this.presses.length > 64 || (this.presses[0] && (this.presses[0].rel ?? this.presses[0].t) < cut)) this.presses = this.presses.filter((e) => (e.rel ?? e.t) >= cut || e.rel === null);
  }

  _age(ev) { return ev.deferred ? (ev.rel === null ? 0 : this.now - ev.rel) : this.now - ev.t; }

  _chan(dir, facing) {
    if (dir === 'forward') return facing >= 0 ? 'right' : 'left';
    if (dir === 'back') return facing >= 0 ? 'left' : 'right';
    if (dir === 'downforward') return facing >= 0 ? 'downright' : 'downleft';
    if (dir === 'downback') return facing >= 0 ? 'downleft' : 'downright';
    if (dir === 'upforward') return facing >= 0 ? 'upright' : 'upleft';
    if (dir === 'upback') return facing >= 0 ? 'upleft' : 'upright';
    return dir;
  }

  /** 1つの行が今成立しているか。成立なら { T, events, segs } 。 */
  _match(parsed, facing) {
    const cfg = this.cfg;
    const events = [];
    let T = null;
    // ボタン
    if (parsed.btns.length) {
      let tMin = Infinity, tMax = -Infinity;
      for (const spec of parsed.btns) {
        let best = null;
        for (const ev of this.presses) {
          if (ev.btn !== spec.btn || ev.used) continue;
          if (spec.hold > 0) {
            if (ev.rel === null || ev.heldFor < spec.hold || this.now - ev.rel > cfg.bufferTime) continue;
            if (!best || ev.rel > best.rel) best = ev;
          } else {
            if (this._age(ev) > cfg.bufferTime) continue;
            if (!best || ev.t > best.t) best = ev;
          }
        }
        if (!best) return null;
        const tt = spec.hold > 0 ? best.rel : best.t;
        tMin = Math.min(tMin, tt); tMax = Math.max(tMax, tt);
        events.push(best);
      }
      if (events.length > 1 && tMax - tMin > cfg.simulTol) return null;
      T = tMax;
    }
    // 方向
    let segs = [];
    if (parsed.steps.length) {
      const n = parsed.steps.length;
      let holdSum = 0;
      let next = null;
      for (let i = n - 1; i >= 0; i--) {
        const st = parsed.steps[i];
        holdSum += st.hold;
        const ch = this._chan(st.dir, facing);
        let pick = null;
        for (let k = this.segs.length - 1; k >= 0; k--) {
          const s = this.segs[k];
          if (s.ch !== ch) continue;
          if (i === n - 1) {
            if (T === null) {   // 方向だけの入力：押した瞬間が成立の時刻
              if (s.used || this.now - s.start > cfg.bufferTime) continue;
              pick = s; break;
            }
            // 方向とボタンはほぼ同時（方向が少し遅れても可）。ボタンの時刻に方向が押されていればよい
            if (s.start > T + cfg.dirTol) continue;
            if (s.end !== null && s.end < T - cfg.releaseTol) continue;
            if ((Math.min(T, s.end ?? T) - s.start) + cfg.dirTol < st.hold) continue;
            pick = s; break;
          } else {
            const sameCh = s.ch === next.ch;
            const tol = OPPOSITE[s.ch] === next.ch ? cfg.oppTol : 0;      // 反対向き（↓と↑）は、ほぼ同時に押したとき順が前後してもよい
            if (sameCh ? !(s.start < next.start) : !(s.start <= next.start + tol)) continue;
            const gap = sameCh ? cfg.tapGap : cfg.seqGap;
            if (s.end !== null && s.end < next.start - gap) continue;
            // 同じ方向の2度押しの間に反対の方向が入っていたら、2度押しではない（→←→ をダッシュ →→ と取り違えない）
            if (cfg.tapOpposite && sameCh && OPPOSITE[s.ch] && this.segs.some((o) => o.ch === OPPOSITE[s.ch] && o.start > s.start && o.start < next.start)) continue;
            if (((s.end ?? T ?? this.now) - s.start) + 1e-6 < st.hold) continue;
            pick = s; break;
          }
        }
        if (!pick) return null;
        segs.unshift(pick);
        next = pick;
        if (i === n - 1 && T === null) T = pick.start;
      }
      // コマンド全体の速さ（最初の方向を押してから最後の方向を押すまで）。方向を1つだけ押し続けている入力（↑を押しながら攻撃）には窓を掛けない。
      //   例外：最初の方向に * を付けた入力（'down*,up+jump'）は、最初の方向を押し始めてからどれだけたっていても窓を掛けない（しゃがみ続けてから ↑＋ジャンプ）。
      //   押したままの場合はそのまま／離した場合は、離してから次を押すまでが seqGap 以内であること（上のつなぎの検査）で足りる。
      const holdingFirst = !!parsed.steps[0].held;
      //   2026-11-14：ボタンのある行は、最後の方向を押したままでも、ボタンまでが窓の内側であること（前は最後の方向の押し始めまでしか測らず、→ を押したまま約 3 秒（記録が消えるまで）Z が必殺に化けた）
      const last = cfg.seqToButton && T !== null && parsed.btns.length ? Math.max(segs[n - 1].start, T) : segs[n - 1].start;
      if (n > 1 && !holdingFirst && last - segs[0].start > cfg.seqWindow + holdSum + 1e-6) return null;
      //   2026-11-15（決め7）：最後の方向を押してからボタンまで（lastToButton）。方向を押したまま数秒たってからのボタンをコマンドにしない
      if (n > 1 && !holdingFirst && cfg.lastToButton != null && T !== null && parsed.btns.length && T - segs[n - 1].start > cfg.lastToButton + parsed.steps[n - 1].hold + 1e-6) return null;
    }
    return { T, events, segs };
  }

  /**
   * 候補の行（{id, parsed, score}）から、いま成立しているものを1つ選んで消費する。無ければ null。
   * 同時押しの行・溜めの行がある間は、単押しの行をわずかに待つ（誤爆を防ぐ）。
   */
  resolve(cands, facing = 1) {
    const matches = [];
    for (const r of cands) {
      const m = this._match(r.parsed, facing);
      if (m) matches.push({ row: r, m });
    }
    if (!matches.length) return null;
    matches.sort((a, b) => (b.row.score - a.row.score) || (b.m.T - a.m.T));
    const best = matches[0];
    const bp = best.row.parsed;
    // 待つべきか
    for (const spec of bp.btns) {
      if (spec.hold > 0) continue;
      const ev = best.m.events.find((e) => e.btn === spec.btn);
      for (const r2 of cands) {
        if (r2 === best.row) continue;
        const p2 = r2.parsed;
        // 溜め行があり、まだ押している最中 → 離すか溜まるまで待つ
        const charge = p2.btns.find((b) => b.btn === spec.btn && b.hold > 0);
        if (charge && this.btnHeld[spec.btn] && ev && ev.rel === null) { ev.deferred = true; return null; }
        // 同時押しの行があり、相手のボタンがまだ来ていない → 少し待つ
        if (p2.btns.length >= 2 && p2.btns.some((b) => b.btn === spec.btn) && bp.btns.length < 2 && ev && this.now - ev.t < this.cfg.simulTol) {
          const others = p2.btns.filter((b) => b.btn !== spec.btn);
          if (others.every((b) => !this.presses.some((e) => e.btn === b.btn && !e.used && this._age(e) <= this.cfg.bufferTime))) return null;
        }
      }
    }
    for (const ev of best.m.events) ev.used = true;
    if (!bp.btns.length) for (const s of best.m.segs) s.used = true;
    return { id: best.row.id, row: best.row, T: best.m.T };
  }
}
