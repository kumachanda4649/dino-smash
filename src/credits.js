// エンディングのスタッフロールの中身（ここだけ直せば画面が変わる）。
// 2026-11-15：Nao「くれじっとにはつかったAIや素材など、ライセンスも書いておいて。製作者はねここしゃん」。
// 書いてよいのは「このリポジトリの記録で使ったと確かめられた物」だけ。記録で確かめられない物は推測で足さない。
//   block = { h: 見出し, n: [名前・説明の行…] }。行の頭が「※」の行は小さい字（ライセンス・補足）。
//   1 行は全角 28 文字くらいまで（画面の右の余白に収まる幅。tools/ending_roll_test.mjs が はみ出しを検査する）。
// 出典（記録の場所）は各ブロックの下に書いておく。

export const CREDITS_TITLE = { en: 'DINO SMASH', jp: 'ダイノ・スマッシュ' };

export const CREDITS = [
  { h: '製作', n: ['ねここしゃん'] },
  // 出典：STATE.md「ゲームの名前を変える」（11-15）・Nao 依頼文
  { h: 'プログラム', n: ['Claude（Anthropic）'] },
  // 出典：STATE.md 動画の作り手＝Claude（決定事項）・ゲームの名前の決定＝Claude
  { h: 'コードのレビュー', n: ['GPT（OpenAI Codex）'] },
  // 出典：STATE.md「GPT（Codex の gpt-6.1-sol・-s read-only・定額）の監修と検算」
  { h: '背景・敵・エンディングの絵', n: ['OpenAI 画像生成（GPT Image）', '※Codex 内蔵／Image API で生成'] },
  // 出典：STATE.md「背景は GPT の縦長 1 枚絵」・海の敵 4 種・エンディングの絵は OpenAI Image API(edit)
  { h: '恐竜のアニメーション', n: ['Google Flow（動画生成）'] },
  // 出典：STATE.md 決定事項「動画の作り手＝…Google Flow」
  { h: '音楽・効果音・咆哮', n: ['ElevenLabs', '※Music／Sound Effects で生成'] },
  // 出典：docs/音の出どころ.md（結論・一覧）
  { h: '効果音（一部）', n: ['RPG Maker MZ 標準素材', '※RPGツクールMZ の利用規約の範囲で使用'] },
  // 出典：docs/音の出どころ.md「一時復元」・src/sounds.js の SE_SET='orig'
  { h: '本編『RPG1』の素材', n: ['恐竜の絵の一部・曲・咆哮の一部'] },
  // 出典：README.md（copy_assets.mjs・RPG1 からコピー）・docs/音の出どころ.md
  { h: 'フォント', n: ['遊ぶ機械に入っている文字を使用', '※ゲームには文字ファイルを入れていません'] },
  // 出典：src/render.js FONT_JP／FONT_EN（システムの文字）。同梱のフォントは無い
  { h: 'ありがとう', n: ['最後まで遊んでくれた あなた'] },
];
