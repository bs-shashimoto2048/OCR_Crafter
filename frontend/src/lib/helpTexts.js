// 画面共通のヘルプ文言（InfoTooltip用）。
// OCR初心者向けに専門用語を説明する。追加・修正はこのファイルへ集約する。
// 形式: { title: 見出し（省略可）, body: 本文（\nで改行表示） }

export const HELP_TEXTS = {
  cer: {
    title: "CER（Character Error Rate / 文字誤り率）",
    body: "OCR結果と正解文字列との差を文字単位で評価する指標です。\n低いほど性能が高くなります。\n例: 10% → 5% になれば改善しています。",
  },
  charAccuracy: {
    title: "文字正解率",
    body: "CERから算出される文字単位の認識率（1 - CER）です。\n高いほど良い指標です。",
  },
  exactMatch: {
    title: "完全一致率",
    body: "OCR結果が1文字も間違わず正解と完全一致した割合です。\n実運用でそのまま利用できる割合を示します。",
  },
  cerImprovement: {
    title: "CER改善",
    body: "学習前（ベースモデル）と比較してCERがどれだけ改善したかを示します。\nマイナス方向ほど改善です。",
  },
  improvedRegressed: {
    title: "改善・同等・悪化",
    body: "学習前（ベースモデル）と画像ごとに比較した結果です。\n改善: 編集距離が減少\n同等: 編集距離が変わらない\n悪化: 編集距離が増加",
  },
  perfectTransition: {
    title: "完全一致の増減",
    body: "学習前は不一致だったが学習後に完全一致になった件数（へ改善）と、\n学習前は完全一致だったが学習後に不一致になった件数（から悪化）です。",
  },
  confusionTop: {
    title: "混同TOP5",
    body: "OCRで特に誤認識が多かった文字の組み合わせです。\n例: 0→O は、数字の0をアルファベットのOとして認識しています。",
  },
  cerRelativeImprovement: {
    title: "CER相対改善率",
    body: "学習前（ベースモデル）のCERに対して、学習後にCERが何%改善したかを示します。\n計算式: (学習前CER - 学習後CER) ÷ 学習前CER\n高いほど良い指標です。",
  },
  confusionCompare: {
    title: "混同比較",
    body: "誤認識が多かった文字の組み合わせを、モデル間で比較します。\n全モデルの合計件数が多い順に並び、棒が短いモデルほどその誤認識が少ないことを示します。\n∅→1 は挿入（余分な文字）、Y→∅ は脱落（読み飛ばし）です。",
  },
  iteration: {
    title: "Iteration",
    body: "学習時に実施した更新回数です。\n一般的には多いほど十分に学習していますが、過学習になる場合もあります。",
  },
  baseModel: {
    title: "ベースモデル",
    body: "学習開始時に使用した元となるOCRモデルです。\n例: eng = 既存英語モデル / 独自学習モデル = 以前作成したモデル",
  },
  whitelist: {
    title: "Whitelist",
    body: "OCRが認識対象とする文字集合です。\n例: A〜Z・0〜9 のみ認識する、などの設定です。",
  },
  ocrPreprocess: {
    title: "OCR前処理",
    body: "OCR実行前に実施した画像処理です。\n例: グレースケール化・二値化・閾値変更 など",
  },
  parentModel: {
    title: "親モデル",
    body: "このモデルの学習開始時に使用した直前のモデルです。\nモデルの派生関係を追跡するために使用します。\nベースモデルから直接学習した場合は「なし」または未記録です。",
  },
  trainValTest: {
    title: "Train / Val / Test",
    body: "学習用（Train）・検証用（Validation）・テスト用（Test）へ分けた画像枚数です。\n分割が異なるモデル同士は、Iterationなど単一条件の効果を比較できません。",
  },
  augmentation: {
    title: "Augmentation",
    body: "学習画像へ回転・ぼかし・明るさ変更などを加えてデータを増やす手法です。\n過学習の抑制に有効ですが、強すぎると精度が下がる場合があります。",
  },
  charset: {
    title: "Charset",
    body: "学習対象とした文字の集合です。\nCharsetが異なるモデル同士は認識できる文字が異なるため、単純な性能比較はできません。",
  },
  singleConditionCompare: {
    title: "単一条件比較",
    body: "前モデルから1つの学習条件だけを変更した比較です。\n性能変化の原因を判断しやすい実験です。",
  },
  splitSeed: {
    title: "Split Seed",
    body: "データ分割（シャッフル）に使う乱数の種です。\n同じ画像集合・同じ比率・同じSeedなら、Train / Validation / Testの割り当てが完全に同じになります（再現性の保証）。",
  },
  splitMethod: {
    title: "分割方式",
    body: "画像単位=1枚ずつ独立に分割（枚数は指定比率へ厳密一致）。\nグループ単位=同じ元画像・Series由来の画像を同じ分割へまとめる方式（現在は未実装）。",
  },
  multiConditionChange: {
    title: "複数条件変更",
    body: "前モデルから2つ以上の学習条件が変更された比較です。\n性能が変化しても、どの条件が要因かは特定できません。",
  },
};
