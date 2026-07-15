# 17. データフロー全体図

画像の入力から学習・評価までの一連の流れを1枚で示す。根拠は `src/app/main.py` の各エンドポイントと `src/app/services/` の実装。

## 全体フロー

```mermaid
flowchart TD
    PHOTO["元写真（大きな画像）"] --> DPP["検出前処理（YOLO専用）<br/>detection_preprocess.py<br/>回転・クロップ・リサイズ・明るさ"]
    DPP --> YOLO["YOLO検出<br/>POST /image-builder/detect<br/>(ultralytics)"]
    YOLO --> BBOX["Bounding Box選択・編集<br/>Step3（Tab / Undo / Redo）"]
    BBOX --> INV["座標を元画像へ逆変換<br/>invert_detection_bbox"]
    INV --> CROP["元画像からクロップ出力<br/>POST /image-builder/export<br/>※検出前処理画像は保存しない"]

    CROP --> IMPORT["画像取り込み<br/>POST /images/import<br/>data/projects/&lt;id&gt;/raw/"]
    IMPORT --> OPP["OCR前処理<br/>preprocess.py（settings.yaml pipelines）<br/>grayscale→照明ムラ補正→…→手動マスク→二値化→…"]
    OPP --> INTERIM["interim/ 中間画像"]
    OPP --> PROC["processed/ 最終画像（single / wide）"]

    PROC --> OCR["OCR推論<br/>POST /preprocess/preview・/predict<br/>EasyOCR / PaddleOCR / Tesseract / カスタム"]
    OCR --> DICT["辞書近似候補<br/>candidateDictionary.js<br/>（重み付きLevenshtein・表示のみ）"]
    OCR --> CAND["OCR候補表示（最大3モデル）"]
    DICT --> LABEL
    CAND --> LABEL["ラベル保存<br/>PUT /labels/{name}<br/>annotations/master.csv"]

    LABEL --> DS["OCRデータセット作成<br/>POST /api/ocr/dataset/create<br/>（path\ttext 形式）"]
    FIX["OCR修正ログ<br/>POST /api/ocr/log/save<br/>outputs/ocr_logs/predictions.jsonl"] --> DS2["ログ由来データセット<br/>POST /api/ocr/dataset/from_logs"]
    OCR --> FIX
    DS --> TRAIN["学習ジョブ（別プロセス）<br/>POST /api/ocr/train/start (PaddleOCR)<br/>POST /api/tesseract/train/start"]
    DS2 --> TRAIN
    TRAIN --> MODEL["モデル登録<br/>models/*.ocr.json（+inference export）<br/>models/*.tess.json"]
    MODEL --> OCR
    MODEL --> EVAL["モデル評価<br/>POST /api/ocr/evaluate<br/>学習前後を同一入力で比較（case-sensitive）"]
```

## 補足（フロー上の重要な不変条件）

| 箇所 | 不変条件 | 根拠 |
|---|---|---|
| 検出前処理 → クロップ | クロップは**必ず元画像から**。検出前処理画像を学習画像として保存しない | `training_image_builder.py`（`export_selected_crops`）、`docs/15_CHANGELOG_AI.md` |
| YOLOモデル解決 | 「絶対/相対パス実在 → プロジェクト内 `data/projects/<id>/models/yolo/` → 共通 `models/yolo/`（リポジトリ直下）→ 名前をそのまま ultralytics へ（ビルトインは自動DL）」の順 | `training_image_builder.py`（`_resolve_model_name` / `COMMON_YOLO_MODELS_DIR`） |
| 検出前処理 / OCR前処理 | 完全に独立（モジュール・設定・保存が別） | `detection_preprocess.py` / `preprocess.py` |
| OCR前処理 | 元画像（raw/）は変更しない。手動マスク・照明補正は派生画像にのみ作用 | `preprocess.py`, `manual_mask.py` |
| 辞書候補 | 表示のみ。OCRエンジンの学習・推論内部へ注入しない | `candidateDictionary.js` |
| ラベル | `master.csv` が唯一の正解。評価でGTを大文字化しない（case-sensitive） | `labels.py`, `ocr_evaluation.py` |
| 学習ジョブ | APIプロセスと分離（`job_runner.py` をPopen）。状態は SQLite `training_jobs` | `main.py`, `db.py` |
| 推論モデル | export済み（inference）モデルのみ使用可（`STRICT_OCR_EXPORT_REQUIRED=True`） | `predict.py` |

## 永続化ポイント一覧

```mermaid
flowchart LR
    subgraph FS["data/projects/<project_id>/"]
        RAW["raw/ 元画像"]
        INT["interim/ 中間画像"]
        PRC["processed/ 最終画像"]
        ANN["annotations/<br/>master.csv・manual_masks.json"]
        MDL["models/<br/>*.pt・*.ocr.json・*.tess.json・ocr_runs/"]
        OUT["outputs/<br/>ocr_logs/predictions.jsonl・ocr_dataset/・評価結果"]
    end
    DB[("outputs/app.db<br/>training_jobs (SQLite)")]
    LS[("ブラウザ localStorage<br/>前処理パラメータ・辞書・UI設定")]
```

- どの矢印がどのAPIかは `docs/06_API_REFERENCE.md`、ファイル形式は `docs/07_DATABASE.md` を参照。
