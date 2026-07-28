# SampleEvaluation

モデル評価（[../manual/05_モデル評価.md](../manual/05_モデル評価.md)）が参照する評価Datasetの構成例です。**実データは含まれていません**。

## 評価Dataset構成（例）

```text
評価用フォルダ/
├── images/
│   ├── sample_001.png
│   ├── sample_002.png
│   └── ...
└── labels.csv
```

## labels.csv（正解ラベルCSV）の形式

```csv
filename,text
sample_001.png,CHYBkt
sample_002.png,TY12lt
```

- `filename`: 画像フォルダ内のファイル名と一致させる（拡張子含む）
- `text`: 実際の表記どおり（case-sensitive。大文字・小文字を区別して評価されます）

## 評価実行時に保存される情報（Evaluation Profile）

評価を実行すると、以下の条件がEvaluation Profileとして実験カルテへ保存されます。

```json
{
  "dataset_path": "評価用フォルダのパス",
  "image_count": 50,
  "preprocess_mode": "training",
  "engine": "tesseract",
  "psm": 7,
  "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-",
  "evaluation_hash": "e5f6a7b8"
}
```

- `evaluation_hash`（Evaluation Hash）は上記条件から算出されるハッシュ値です。**同じEvaluation Hashを持つ評価同士のみ、CERを直接比較できます**
- `preprocess_mode`は「学習時前処理（training・既定）」「手動設定（manual）」「前処理なし（none）」のいずれかです

## 評価結果（例）

```json
{
  "cer": 0.05,
  "cer_percent": 5.0,
  "char_accuracy": 0.95,
  "char_accuracy_percent": 95.0,
  "accuracy_percent": 88.0
}
```

各指標の意味は [../manual/06_評価結果の見方.md](../manual/06_評価結果の見方.md) を参照してください。
