# Examples

このフォルダは、OCR Crafterが実際に生成・保存するDataset・評価Dataset・Experimentの**構造を説明するためのサンプル**です。

- **実データ（画像・モデル等）は含まれていません**。すべてMarkdownによる構造・項目の説明のみです
- 記載内容は実際のソースコード（`src/app/services/dataset_registry.py`・`experiment_tracker.py`等）を確認した上で、実装されている項目のみを記載しています

## 収録内容

| ファイル | 内容 |
|---|---|
| [SampleDataset.md](SampleDataset.md) | Dataset Managerが管理するDatasetの実際のフォルダ構成・meta.json項目 |
| [SampleEvaluation.md](SampleEvaluation.md) | 評価Datasetの構成と、モデル評価が参照する項目 |
| [SampleExperiment.md](SampleExperiment.md) | 実験カルテ（Experiment）に保存される項目とModelとの関連 |

各画面の完全な仕様は [../16_SCREEN_SPEC.md](../16_SCREEN_SPEC.md)、操作しながら学びたい場合は [../tutorial/](../tutorial/01_Tesseractチュートリアル.md) を参照してください。
