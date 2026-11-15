// 遊んだ記録（プレイログ）。Nao さんや息子さんが実際に遊んだ記録から、難しさや技の調整を考えるための仕組み（版2.3）。
//
// ■ 何を残すか（1行 = 1つの出来事の JSON。キーは短く、時刻 t は「この遊びの始まりからの秒」・ミリ秒まで）
//   session  起動：版・難しさ・オプション・面・入力機器（パッド／キーボード）・自動プレイの印 auto・調整スライダー tune（版2.6：100% でない項目だけ {id:%}。調整していなければ無い）
//   tune     遊びの途中で調整スライダーを動かした：{id, pct, all:{100% でない項目の全部}}（全部を100%に戻したときは {all:{}}）
//   in       入力：{a:動作, d:1押した/0離した, s:'k'キーボード/'p'パッド}。ポーズ中などは st を付ける（コマンドの調べには使わない）
//   move     出た技（主人公）：{id:技の表の id, air, cx:キャンセルで出た}
//   cmdmiss  コマンドを出そうとして出なかったらしい所：{btn, seq:"down@-180 right@-90", got:代わりに出た技, near:{id,k,n}}
//   hit      当たり：{by:'p'|敵の種類, to:相手, mv:技, dmg, combo, res:'hit'|'kill'|'guard'|'chip'}。壁・叩きつけ・玉突きは mv が wall/spike/chain/crash
//   hurt     主人公が受けた攻撃：{by:敵, mv:技, dmg, hp, res:'hit'|'guard'|'gbreak'|'parry'}（版2.5：guard の dmg は CP が 0 のときの削り。parry＝パリィ）
//   clash    相殺：{a,am,b,bm,kind}   breaker  ボスのカウンター（旧コンボ破り）：{by,mv,combo}   counterRoll  カウンターの抽選：{by,combo,p,hit}   chainRoll  玉突きで反撃中のボスが止まるかの抽選：{to,p,hit}   combo  コンボの終わり：{n}
//   cutin    版2.7：ボスの必殺技の目のカットインが出た：{by:敵, mv:技}   quake  版2.8b：足場ゆらし：{by:敵, k:'tele'(予兆の始まり・ex=敵のx・px=主人公のx)|'fire'(揺らした・hit=当たったか), plat:足場の添字}（被弾は hurt の mv='quake'）   eruption  版2.7：ギガノト咆哮のあと噴火して火山弾が降る：{by:敵, n:弾の数}（火山弾の被弾は hurt の mv='volcano'）
//   rage     ボスが怒り（体力50%未満の第2段階）に入った：{by:敵, hp, max}（時刻 t がその瞬間）
//   stage    面：{k:'start'|'clear'|'down'|'continue'|'timeup'|'gameover', ...}   pause/resume/movelist  ポーズ・技表
//   end      この遊びの終わり：{why, dur, score, ...}
//   個人情報は入れない（名前・場所・端末の識別子なし）。パッドの機種名（短い）だけ入れる。
//
// ■ 送り方：まとめて送る（3秒ごと・または一定の行数・ページを閉じるとき）。送り先は同じ場所の /__api/playlog（play.cmd のサーバ・127.0.0.1 のみ）。
//   サーバが記録に対応していない（404・405・403）なら、その遊びの記録は捨てる（ゲームは止まらない）。つながらないだけなら溜めて再送する。
//   🔴版2.3b：再送は諦めない（間隔は最大 48 秒のまま続ける。溜められるのは memMax 行まで・古い行から捨てる）。以前は 5 回失敗すると「この遊びは捨てる」にして、
//   Chrome の keepalive 枠（未消費の応答が溜まると本文の合計 64KB 前後で fetch が失敗する）で一時的に失敗しただけで、その遊びの残りが全部消えていた。
//   fetch は keepalive なし・応答を読み切る・15 秒で打ち切る。ページを閉じるときに送れなかった分は localStorage に少しだけ（60KB まで）残し、次の起動で送り直す。
//   遊びを閉じる／次の遊びを始めるとき、まだ送れていない行は捨てずに元の識別子のまま送り続ける（orphans）。
// ■ 重くしない：1つの出来事は小さな文字列を1つ作るだけ（記録が止まっているときは何もしない）。cpuMs に使った時間を足していて、試験が見ている。

export const LOG_URL = '/__api/playlog';
export const PENDING_KEY = 'dinoArtsPlayLogPending';
export const GAME_ACTIONS = ['left', 'right', 'up', 'down', 'attack', 'jump', 'special'];
const DIRS = ['left', 'right', 'up', 'down'];
const BTNS = ['attack', 'jump', 'special'];
const OPP = { left: 'right', right: 'left' };

export const PLAYLOG_TUNE = {
  flushSec: 3,          // この秒数ごとにまとめて送る
  flushLines: 300,      // これだけ溜まったらすぐ送る
  memMax: 2000,         // 送れずに溜められる最大の行数（超えたら古い行から捨てる）
  backoff: [3, 6, 12, 24, 48],      // つながらないときの再送の間隔（秒）。使い切ったら最後の間隔（48 秒）のまま続ける（諦めない）
  batchLines: 400,      // 1回に送る最大の行数（残りは次の回に回す）
  batchBytes: 200000,   // 1回に送る最大の大きさ（文字数。受け口の上限 512KB より十分小さく）
  orphanMax: 4,         // 終わった遊びの送り残しを同時に持つ数（超えたら古い順に捨てる）
  timeoutMs: 15000,     // 1回の送信がこれを超えたら失敗とみなす（応答が来ないまま「送信中」で止まらないように）
  pendingMax: 60000,    // ページを閉じるとき localStorage に残す最大の大きさ（文字数）
  cmdWindow: 0.6,       // 方向を押してからボタンまで、これ以内の方向の押下を「コマンドの入力」とみなす
  cmdGap: 0.35,         // 方向どうし・方向からボタンまでの間隔がこれ以内に続いたものだけを「コマンドの入力」とみなす
  cmdWait: 0.45,        // ボタンを押してから、技が出るのを待つ秒数（先行入力の 0.25 より長く）
};

const r3 = (v) => Math.round(v * 1000) / 1000;

function newSid() {
  let s = '';
  try {
    const a = new Uint8Array(8); crypto.getRandomValues(a);
    for (const b of a) s += b.toString(36).padStart(2, '0');
  } catch (e) { for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 36).toString(36); }
  return s.slice(0, 12);
}
const pad2 = (n) => String(n).padStart(2, '0');
export function stampOf(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/**
 * 送り手（ブラウザ用）。戻り値 'ok'（受け取られた）/ 'off'（サーバが記録に対応していない）/ 'fail'（つながらない・一時的な失敗）。
 * unload=true のときは sendBeacon（ページを閉じる途中でも送れる）。
 */
export function statusToResult(status) {
  if (status === 200) return 'ok';
  if (status === 404 || status === 405 || status === 403 || status === 501) return 'off';      // この受け口は記録に対応していない（以後送らない）
  if (status >= 500 || status === 408 || status === 429) return 'fail';      // 一時的な失敗
  return 'drop';      // 400・413 など：この1回分だけ受け付けられない（続きは送る）
}
export function makeTransport(base = '', { timeoutMs = PLAYLOG_TUNE.timeoutMs } = {}) {
  return async (sid, ts, seq, body, unload = false) => {
    const url = `${base}${LOG_URL}?sid=${sid}&ts=${ts}&n=${seq}`;
    let timer = null;
    try {
      if (unload && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        return navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' })) ? 'ok' : 'fail';
      }
      // keepalive は付けない：Chrome は keepalive の未完了ぶん（応答を読み切っていないものを含む）の本文を合計 64KB までしか持てず、超えると fetch が TypeError で失敗する
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (ac) timer = setTimeout(() => ac.abort(), timeoutMs);
      const r = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' }, cache: 'no-store', ...(ac ? { signal: ac.signal } : null) });
      try { await r.arrayBuffer(); } catch (e) { /* 応答の本文は使わない。読み切って接続を返す */ }
      return statusToResult(r.status);
    } catch (e) { return 'fail'; }
    finally { if (timer) clearTimeout(timer); }
  };
}

export class PlayLog {
  /**
   * @param send  (sid, ts, seq, body, unload) => Promise<'ok'|'off'|'fail'>
   * @param clock 秒を返す関数（ブラウザは performance.now()/1000）
   * @param storage localStorage 相当（無くてもよい）
   */
  constructor({ send = null, clock = () => Date.now() / 1000, storage = null, tune = {} } = {}) {
    this.send = send; this.clock = clock; this.storage = storage;
    this.tune = { ...PLAYLOG_TUNE, ...tune };
    this.active = false;
    this.cpuMs = 0; this.count = 0; this.dropped = 0; this.sentLines = 0; this.sentBatches = 0;
    this.off = false;            // サーバが記録に対応していない（この遊びは捨てる）
    this.orphans = [];           // 終わった遊びの送り残し：{ sid, ts, seq, lines:[], failN, retryAt, inflight }
    this.reset();
  }

  reset() {
    this.sid = null; this.ts = null; this.t0 = 0; this.seq = 0;
    this.buf = []; this.inflight = false; this.lastFlush = 0; this.failN = 0; this.retryAt = 0;
    this.prevHeld = {}; this.pend = []; this.dirHist = [];
    this.moveInfo = null; this.facing = () => 1; this.btnHeld = {};
  }

  /** 新しい遊びを始める。meta は session 行に入る（版・難しさ・オプション・面など）。moveRows は技の表（コマンドの失敗の推測用）。 */
  begin(meta = {}, { moveRows = null, facing = null } = {}) {
    if (this.active) this.end('restart');
    this._stash();
    this.reset();
    this.off = false;
    this.sid = newSid(); this.ts = stampOf();
    this.t0 = this.clock(); this.lastFlush = this.t0;
    this.active = true;
    this.moveInfo = moveRows ? this._moveInfo(moveRows) : null;
    if (facing) this.facing = facing;
    this._line(0, 'session', meta);
    this._resendPending();
    return this.sid;
  }

  _moveInfo(rows) {
    const info = {};
    for (const r of rows) {
      const p = r.parsed || (r.def && r.def.parsed);
      if (!p) continue;
      info[r.id] = { steps: p.steps.map((s) => s.dir), btns: p.btns.map((b) => b.btn) };
    }
    return info;
  }

  _line(t, type, data) {
    if (this.off) return;      // 記録に対応していないサーバ：溜めない
    const o = { t: r3(t), e: type };
    if (data) for (const k in data) o[k] = data[k];
    this.buf.push(JSON.stringify(o));
    this.count++;
    if (this.buf.length > this.tune.memMax) { const n = this.buf.length - this.tune.memMax; this.buf.splice(0, n); this.dropped += n; }
  }

  /** 出来事を1つ記録する。 */
  ev(type, data) {
    if (!this.active) return;
    const t1 = performance_now();
    const t = this.clock() - this.t0;
    if (type === 'move') this._onMove(t, data);
    this._line(t, type, data);
    this.cpuMs += performance_now() - t1;
  }

  /** 毎フレーム 1 回：入力の変化を記録。held=いま押している動作 {left:true…}、edge=このフレームで押された動作、padHeld/keyHeld=出どころ、st=場面（play 以外なら st を付ける）。 */
  input(held, edge, padHeld, keyHeld, st) {
    if (!this.active) return;
    const t1 = performance_now();
    const t = this.clock() - this.t0;
    const menu = !!st && st !== 'play';
    for (const a of GAME_ACTIONS) {
      const now = !!held[a], was = !!this.prevHeld[a], ed = !!(edge && edge[a]);
      // 押した：押している状態になった、または押した瞬間の記録がある（1フレームより短いタップは held に出ない）
      if (ed || (now && !was)) {
        const o = { a, d: 1, s: (keyHeld && keyHeld[a]) ? 'k' : (padHeld && padHeld[a]) ? 'p' : (now ? 'k' : 'k') };
        if (menu) o.st = st;
        this._line(t, 'in', o);
        if (!menu) this._onPress(t, a);
        if (now) this.btnHeld[a] = true;
      }
      // 離した（短いタップは同じフレームで離れている）
      if (!now && (was || ed)) {
        const o = { a, d: 0 };
        if (menu) o.st = st;
        this._line(t, 'in', o);
        this.btnHeld[a] = false;
      }
      this.prevHeld[a] = now;
    }
    this._tickPending(t);
    this.cpuMs += performance_now() - t1;
  }

  /** 毎フレーム 1 回：送る時刻なら送る。 */
  tick() {
    this._drainOrphans();
    if (!this.active) return;
    const now = this.clock();
    if (this.buf.length >= this.tune.flushLines || (now - this.lastFlush >= this.tune.flushSec && this.buf.length)) this.flush();
  }

  // ---- コマンドの失敗の推測 ----
  _onPress(t, a) {
    if (DIRS.includes(a)) { this.dirHist.push({ t, a }); if (this.dirHist.length > 24) this.dirHist.shift(); return; }
    if (!BTNS.includes(a)) return;
    const w = this.tune.cmdWindow, gap = this.tune.cmdGap;
    // ボタンから時間をさかのぼり、方向の押下どうしの間隔が cmdGap 以内に続くあいだだけを「コマンドの入力」とみなす（ゆっくり歩いて向きを変えただけのものは入れない）
    const seq = [];
    let prev = t;
    for (let i = this.dirHist.length - 1; i >= 0; i--) {
      const h = this.dirHist[i];
      if (t - h.t > w || prev - h.t > gap) break;
      prev = h.t;
      seq.unshift(h);
    }
    this.pend.push({ t, btn: a, seq, res: null, facing: this.facing() });
    if (this.pend.length > 8) this.pend.shift();
  }

  _onMove(t, d) {
    const info = this.moveInfo && this.moveInfo[d.id];
    for (const p of this.pend) {
      if (p.res || t - p.t > this.tune.cmdWait + 0.2) continue;
      if (info && info.btns.length && !info.btns.includes(p.btn)) continue;
      if (info && !info.btns.length) continue;
      p.res = d.id; break;
    }
  }

  _tickPending(t) {
    if (!this.pend.length) return;
    const keep = [];
    for (const p of this.pend) {
      const waiting = !p.res && (t - p.t) < this.tune.cmdWait;
      const heldOn = !p.res && this.btnHeld[p.btn] && (t - p.t) < 3;      // 溜め技などボタンを押している間はまだ待つ
      if (waiting || heldOn) { keep.push(p); continue; }
      this._judge(p);
    }
    this.pend = keep;
  }

  /** ボタンの前に方向が2つ以上あって、コマンド技が出なかった（または別の技が出た）なら、いちばん近いコマンドを推測して cmdmiss を残す。 */
  _judge(p) {
    if (!this.moveInfo || p.seq.length < 2) return;
    const got = p.res ? this.moveInfo[p.res] : null;
    if (got && got.steps.length >= 2) return;                     // コマンド技が出た＝成功
    let best = null;
    for (const [id, m] of Object.entries(this.moveInfo)) {
      if (m.steps.length < 2 || !m.btns.includes(p.btn)) continue;
      const need = m.steps.filter((s) => !/^(down|up)(forward|back)$/.test(s));      // 斜めは「下＋前」の同時押しなので、方向の並びからは外す
      if (need.length < 2) continue;
      let k = 0;
      for (const fac of [1, -1]) {
        const req = need.map((s) => (s === 'forward' ? (fac >= 0 ? 'right' : 'left') : s === 'back' ? (fac >= 0 ? 'left' : 'right') : s));
        let i = 0;
        for (const h of p.seq) if (i < req.length && h.a === req[i]) i++;
        if (i > k) k = i;
      }
      if (k >= 2 && k >= need.length - 1) {
        const score = k / need.length + need.length * 0.01;
        if (!best || score > best.score) best = { id, k, n: need.length, score };
      }
    }
    if (!best) return;
    // 並びの順序が全く合わない（k が 1 で、ただ方向を押しただけ）ものは、k が need-1 以上のものだけ残している
    const seq = p.seq.map((h) => `${h.a}@${Math.round((h.t - p.t) * 1000)}`).join(' ');
    this._line(p.t, 'cmdmiss', { btn: p.btn, seq, got: p.res || null, near: { id: best.id, k: best.k, n: best.n } });
  }

  // ---- 送る ----
  /** 溜めた行から、1回に送ってよい分（batchLines 行・batchBytes 文字まで）を取り出す。 */
  _take(buf) {
    let n = 0, bytes = 0;
    while (n < buf.length && n < this.tune.batchLines && (n === 0 || bytes + buf[n].length + 1 <= this.tune.batchBytes)) { bytes += buf[n].length + 1; n++; }
    return buf.splice(0, n);
  }

  _gap(failN) { const b = this.tune.backoff; return b[Math.min(Math.max(failN, 1), b.length) - 1]; }

  flush(unload = false) {
    if (!this.sid || !this.buf.length || this.off) { if (this.off) this.buf = []; return Promise.resolve(); }
    if (this.inflight && !unload) return Promise.resolve();
    if (!unload && this.retryAt && this.clock() < this.retryAt) return Promise.resolve();
    if (!this.send) { this.buf = []; return Promise.resolve(); }
    const lines = unload ? this.buf.splice(0, this.buf.length) : this._take(this.buf);
    const seq = ++this.seq;
    const body = lines.join('\n') + '\n';
    this.lastFlush = this.clock();
    this.inflight = !unload;
    const sid = this.sid, ts = this.ts;
    const done = (res) => {
      if (sid !== this.sid || !this.active) { this._orphanResult({ sid, ts, lines }, res); return; }      // 送っている間に次の遊びが始まった：結果は元の遊びのものとして扱う（新しい遊びの溜めに混ぜない）
      this.inflight = false;
      if (res === 'ok') { this.failN = 0; this.retryAt = 0; this.sentLines += lines.length; this.sentBatches++; return; }
      if (res === 'off') { this.off = true; this.buf = []; return; }       // 記録に対応していないサーバ：この遊びは捨てる
      if (res === 'drop') { this.dropped += lines.length; return; }          // この1回分だけ受け付けられなかった：捨てて続ける
      // 一時的な失敗：先頭へ戻して再送（諦めない。間隔は最大のまま続ける。溜めるのは memMax 行まで）
      this.failN++;
      this.buf = lines.concat(this.buf);
      if (this.buf.length > this.tune.memMax) { const n = this.buf.length - this.tune.memMax; this.buf.splice(0, n); this.dropped += n; }
      this.retryAt = this.clock() + this._gap(this.failN);
    };
    if (unload) {
      // 閉じる途中：結果は待てない。送れたとみなす（beacon は渡した時点で成功を返す）。失敗なら localStorage へ
      const r = this.send(sid, ts, seq, body, true);
      Promise.resolve(r).then((res) => { if (res !== 'ok' && res !== 'off') this._savePending(sid, ts, seq, body); });
      return Promise.resolve();
    }
    return Promise.resolve(this.send(sid, ts, seq, body, false)).then(done, () => done('fail'));
  }

  /** 終わる（または次の遊びが始まる）ときに送れていない行を、元の識別子のまま送り続ける列へ移す。 */
  _stash() {
    if (!this.sid || !this.buf.length || this.off) return;
    this.orphans.push({ sid: this.sid, ts: this.ts, seq: this.seq, lines: this.buf, failN: this.failN, retryAt: this.retryAt, inflight: false });
    this.buf = [];
    while (this.orphans.length > this.tune.orphanMax) { const o = this.orphans.shift(); this.dropped += o.lines.length; }
  }

  /** 送っている間に遊びが替わったときの結果の受け取り。 */
  _orphanResult({ sid, ts, lines }, res) {
    if (res === 'ok') { this.sentLines += lines.length; this.sentBatches++; return; }
    if (res === 'drop' || res === 'off') { this.dropped += lines.length; return; }
    let o = this.orphans.find((x) => x.sid === sid);
    if (!o) { o = { sid, ts, seq: 1000, lines: [], failN: 0, retryAt: 0, inflight: false }; this.orphans.push(o); }
    o.lines = lines.concat(o.lines); o.failN++; o.retryAt = this.clock() + this._gap(o.failN);
    while (this.orphans.length > this.tune.orphanMax) { const x = this.orphans.shift(); this.dropped += x.lines.length; }
  }

  /** 毎フレーム：送り残しがあれば、間隔を守って1つずつ送る。 */
  _drainOrphans() {
    if (!this.orphans.length || !this.send) return;
    const now = this.clock();
    if (this.orphans.some((x) => x.inflight)) return;
    const o = this.orphans.find((x) => now >= x.retryAt);
    if (!o) return;
    if (!o.lines.length) { this.orphans.splice(this.orphans.indexOf(o), 1); return; }
    const lines = this._take(o.lines);
    const seq = ++o.seq;
    o.inflight = true;
    const fin = (res) => {
      o.inflight = false;
      if (res === 'ok') { o.failN = 0; o.retryAt = 0; this.sentLines += lines.length; this.sentBatches++; }
      else if (res === 'drop') this.dropped += lines.length;
      else if (res === 'off') { this.dropped += lines.length + o.lines.length; o.lines = []; }
      else { o.lines = lines.concat(o.lines); o.failN++; o.retryAt = this.clock() + this._gap(o.failN); }
      if (!o.lines.length) { const i = this.orphans.indexOf(o); if (i >= 0) this.orphans.splice(i, 1); }
    };
    Promise.resolve(this.send(o.sid, o.ts, seq, lines.join('\n') + '\n', false)).then(fin, () => fin('fail'));
  }

  _savePending(sid, ts, seq, body) {
    try {
      if (!this.storage) return;
      const max = this.tune.pendingMax;
      // 2026-11-15：新しい行から 1 行ずつ、保存の形（JSON。" や改行はエスケープで長くなる）の長さを数えて足し、max に収まる所まで残す。
      //   前は本文の文字数と JSON の長さを同じ尺度で削り、削りすぎて 6 回で打ち切った（約 26 万字の本文で 6 万字まで残せるのに 4500 字だけ）。1 行も入らないときは残さない（前は空の本文を残し、次の起動で送っていた）
      const lines = body.split('\n');
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      let len = JSON.stringify({ sid, ts, seq, body: '' }).length, n = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        const add = JSON.stringify(lines[i] + '\n').length - 2;
        if (len + add > max) break;
        len += add; n++;
      }
      if (!n) return;
      const s = JSON.stringify({ sid, ts, seq, body: lines.slice(lines.length - n).join('\n') + '\n' });
      if (s.length > max) return;
      this.storage.setItem(PENDING_KEY, s);
    } catch (e) { /* 残せなくてよい */ }
  }

  _resendPending() {
    try {
      if (!this.storage || !this.send) return;
      const raw = this.storage.getItem(PENDING_KEY);
      if (!raw) return;
      this.storage.removeItem(PENDING_KEY);
      const o = JSON.parse(raw);
      if (!o || typeof o.body !== 'string' || !o.sid || !o.ts) return;
      Promise.resolve(this.send(o.sid, o.ts, (o.seq || 0) + 1, o.body, false)).catch(() => {});
    } catch (e) { /* 送り直せなくてよい */ }
  }

  /** この遊びを閉じる。why: restart / title / quit / ending / gameover-quit / close。 */
  end(why, data = {}) {
    if (!this.active) return Promise.resolve();
    this.ev('end', { why, ...data, lines: this.count, dropped: this.dropped, cpuMs: r3(this.cpuMs) });
    // 判定待ちのボタン押しも確定させる
    this._tickPending(1e9);
    const p = this.flush(why === 'close');
    this.active = false;
    if (why !== 'close') this._stash();      // 送り切れなかった分（送信中・間隔待ち・1回の上限で残った分）は捨てず、元の識別子のまま送り続ける
    return p;
  }
}

// performance.now が無い環境（古い node など）でも動くように
function performance_now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
