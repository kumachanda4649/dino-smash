import { Assets } from './assets.js';
import { AudioSys } from './audio.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { TouchPad } from './touchpad.js';
import { CMD_STYLE } from './moves.js';

const params = new URLSearchParams(location.search);
if (params.get('cmd') === 'tekken') CMD_STYLE.style = 'tekken';      // 2026-11-18 試作：鉄拳型の入れ方を足す（?cmd=tekken）
if (params.get('editor') === '1') {
  location.replace('editor/index.html');      // 版3.1：面エディタの入り口（遊ぶ人の邪魔にならないよう、画面には出さず URL だけ）。ゲームは起動しない
} else {
  const canvas = document.getElementById('game');
  const assets = new Assets('', { px: params.get('px') !== '0', pxDir: params.get('pxdir') || 'assets/dino_px', rivalColor: params.get('rivalcolor'), lean: params.get('lean') !== '0', webp: params.get('webp') !== '0' });      // 2026-11-15：?lean=0 でドット絵と今の絵を両方読む（従来）／?webp=0 で WebP を使わず PNG のまま   // ?px=0 で今の絵に戻す／?rivalcolor=whiteblue でライバルの色を試す
  const audio = new AudioSys({ forceMute: params.get('mute') === '1', base: '', ext: params.get('aext') });
  const input = new Input(window);
  const game = new Game({ canvas, assets, audio, input, params });
  // 2026-11-15：スマホのバーチャルコントローラー（?touch=1 で出す／?touch=0 で出さない／指定なしは初めて指で触れたとき）。縦向きになったらプレイ中は止める
  const touchpad = new TouchPad({ input, params, onPortrait: () => { if (game.state === 'play') game.setState('pause'); } });
  // 最初のクリックでも音のロックを解く（iPhone などは指を離したとき・クリックでないと解けないので、それも拾う）
  window.addEventListener('pointerdown', () => audio.unlock());
  window.addEventListener('touchend', () => audio.unlock(), { passive: true });
  window.addEventListener('click', () => audio.unlock());
  window.addEventListener('keydown', () => audio.unlock());      // 2026-11-14：キーでも、押したその場（ブラウザが「操作」と認める場面）で解く。前は描画のコマの中だけで、厳しいブラウザでは解けないことがあった
  game.boot().catch((e) => {
    console.error(e);
    const el = document.getElementById('err');
    if (el) { el.style.display = 'block'; el.textContent = '起動に失敗しました: ' + e.message + '\n（index.html は http サーバ経由で開いてください）'; }
  });
}
