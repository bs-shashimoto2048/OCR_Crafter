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
};
