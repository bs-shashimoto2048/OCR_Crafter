# SampleExperiment

実験管理（[../manual/01_はじめに.md](../manual/01_はじめに.md)）に自動記録される実験カルテの内容例です。**実データは含まれていません**。

## Experimentに保存される内容（例）

Tesseract学習が完了すると、以下のような内容が自動的に実験カルテ（`EXP-0001`形式）として記録されます。

```json
{
  "experiment_id": "EXP-0001",
  "started_at": "2026-07-20T09:55:00",
  "finished_at": "2026-07-20T10:00:00",
  "duration_seconds": 300,
  "models": ["sample_model.tess.json"],
  "experiment_name": "サンプル実験",
  "parent_model_id": "",
  "note": "",
  "model_engine": "tesseract",
  "dataset_id": "DS0001",
  "dataset_name": "サンプルDataset",
  "dataset_hash": "a1b2c3d4",
  "training": {
    "iterations": 1000,
    "charset": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789klt+-",
    "split_ratio": {"train": 0.7, "val": 0.2, "test": 0.1},
    "split_seed": 42,
    "counts": {"train": 84, "val": 24, "test": 12}
  },
  "tags": [],
  "favorite": false
}
```

- `experiment_id`: `EXP-0001`形式。モデルの管理No（`M0001`形式）とは独立した番号です
- `models`: このExperimentで生成されたモデルファイル名
- `dataset_id` / `dataset_name` / `dataset_hash`: 学習に使ったDataset（Dataset Manager）の情報をそのまま引き継いだもの
- `training`: 学習条件（イテレーション数・charset・分割比率・分割件数等）
- `tags` / `favorite`: 実験管理画面から後から編集できる項目

評価を実行すると、評価結果（CER等）が同じExperimentへ追記されます。

## Modelとの関連

| 関連の向き | 確認できる場所 |
|---|---|
| ExperimentからModelを見る | 実験一覧の「生成モデル」列（管理Noバッジ）。クリックでモデルカルテへ遷移 |
| ModelからExperimentを見る | モデルカルテの「このモデルを作成したExperiment」リンク |
| ExperimentからDatasetを見る | 実験一覧の「Dataset」列。クリックでDataset Manager詳細へ遷移 |
| DatasetからExperimentを見る | Dataset詳細画面の「使用Experiment」一覧 |

このように、Dataset・Experiment・Modelは互いにリンクされており、「どのDatasetから」「どんな条件で」「どのモデルが」作られたかを後から追跡できます。詳細は [../manual/07_モデル管理.md](../manual/07_モデル管理.md) を参照してください。
