# SampleDataset

Dataset Manager（[../manual/02_学習データ作成.md](../manual/02_学習データ作成.md)）が一覧化するDatasetの、実際のフォルダ構成と記録項目の例です。**実データは含まれていません**。

## フォルダ構成（例）

Datasetは、プロジェクトの `outputs/ocr_dataset/` （またはOCR修正ログからの再作成の場合は `outputs/ocr_dataset_from_logs/`）配下に、実行日時を含むフォルダ名で作成されます。

```text
data/projects/<project_id>/outputs/ocr_dataset/<実行時刻のフォルダ名>/
├── meta.json          # Dataset Managerが読む記録（下記参照）
├── charset.txt         # 学習対象文字セット
├── train.txt            # 学習用ラベル一覧
├── val.txt               # 検証用ラベル一覧
├── test.txt              # テスト用ラベル一覧
├── train/images/       # 学習用画像
├── val/images/            # 検証用画像
└── test/images/           # テスト用画像
```

Dataset Managerの一覧・詳細画面は、この `meta.json` を各フォルダから読み取って表示しています（Datasetをまとめる専用のデータベースファイルがあるわけではありません）。

## meta.jsonの主な項目（例）

```json
{
  "display_name": "サンプルDataset",
  "created_at": "2026-07-20T10:00:00",
  "comment": "",
  "charset": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-",
  "train_ratio": 0.7,
  "val_ratio": 0.2,
  "test_ratio": 0.1,
  "input_count": 120,
  "counts": {"train": 84, "val": 24, "test": 12},
  "skipped": {"charset_out_of_range": 3},
  "preprocess_config_version": 2,
  "preprocess_config_saved_at": "2026-07-19T09:00:00",
  "training_preprocess_hash": "a1b2c3d4"
}
```

- `charset` / `train_ratio` / `val_ratio` / `test_ratio` / `input_count`: OCRデータ作成時に指定した設定
- `counts`: 実際に分割された画像枚数
- `skipped`: charset外文字などの理由で除外されたサンプル数
- `preprocess_config_version` / `preprocess_config_saved_at` / `training_preprocess_hash`: このDatasetを作った時点の前処理設定のスナップショット情報

## Dataset ID（DS0001形式）

Dataset Managerの一覧・詳細画面上でのみ使われる管理番号です。フォルダ自体にはDataset IDは含まれず、`data/dataset_ids.json`（全プロジェクト共通の登録簿）でフォルダパスとDataset IDが対応付けられます。

## 関連情報

- 使用モデル一覧・使用Experiment一覧は、Dataset詳細画面でオンデマンドに集計されます（`meta.json`自体には保存されません）
- 詳しい作成手順は [../manual/02_学習データ作成.md](../manual/02_学習データ作成.md) を参照してください
