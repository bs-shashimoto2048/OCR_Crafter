# Engine Registry Design

Related: Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46)（Engine UI Generalization） / Feature [#47](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/47)（Engine Registry Design、**Completed**・Closed。PR [#48](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/48)をSquash Merge・mainへ反映済み、Merge Commit: `57ca74e`） / Epic [#28](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/28)（Unified Model Metadata Infrastructure、完了済み） / Epic [#27](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/27)（TrOCR本体）

**本ドキュメントは設計のみを対象とする。実装（`EngineRegistry`本体・UI変更・TrOCR追加・Models API変更・Resolver変更）は一切行わない。実装は後続Feature（Engine Registry Core等）で個別に着手する。**

**状態（2026-08-03）**: Feature #47・Feature #49・Refactor #51（ModelsView Migration）・Refactor [#53](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/53)「TrainingViewをEngine Registryへ移行」はいずれも**Completed**（PR [#54](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/54)をSquash Merge・mainへ反映済み、Merge Commit: `cb6a8ce`）。`TrainingView.jsx`のOCRタイプ選択肢・Engine表示名・学習可否・デバイス対応可否・エンジン固有設定パネル・ジョブスナップショットをRegistry経由へ移行し、UIの見た目は変更していない（既存レンダリング回帰テスト44件が無修正のまま全件成功）。PR #54マージ前レビューで指摘されたRegistry内部状態の不変性（Major #1）も、`Object.freeze()`＋配列Getterのコピー返却により修正済み。詳細は7章「TrainingView」・11章「Future Work」・[docs/workitems/engine-ui/TRAININGVIEW_MIGRATION.md](workitems/engine-ui/TRAININGVIEW_MIGRATION.md)参照。次のFeatureは「Benchmark画面をEngine Registryへ移行」。

## 1. 背景・目的

Epic #28完了後のUIレビューで、モデル管理・学習・評価画面においてOCRエンジン（Tesseract/PaddleOCR/EasyOCR、将来TrOCR）ごとの`if`/`switch`/三項演算子によるハードコード分岐が広範に存在し、TrOCR追加時にこれらを個別に改修する必要があることが判明した。本Featureでは、実装前に以下を明らかにする。

1. 現状のEngine判定箇所を漏れなく洗い出す
2. 既にデータ駆動で書かれている実装（`engineResolution.js`等）の構造を確認する
3. `EngineRegistry`（フロントエンド、新設予定・未実装）へ集約すべき情報を整理する
4. 画面ごとにRegistry化できる箇所・できない箇所を切り分ける
5. `EngineRegistry`・Models API・`ModelMetadata`の責務境界を明確にする
6. TrOCR追加が実際に「Registryへ追加するだけ」で済むかを検証する

## 2. 設計方針

- `EngineRegistry`は**フロントエンド専用の静的設定データ**（JSオブジェクト、API呼び出しなし）とする。既存のバックエンド`src/app/services/engine_registry.py`/`engine_capability.py`（後述4章）とは別実装とし、今回は両者を統合しない（Scope外）。
- `EngineRegistry`が扱うのは「エンジン単位の静的な能力・表示情報」のみ。特定モデルインスタンスの情報（`model_id`・`created_at`・`dataset_id`等）は一切持たない（3章参照）。
- 既存の`frontend/src/lib/engineResolution.js`（id正規化＋ラベル表）を**廃止・置換するのではなく、Registryの一部として吸収・拡張する**方向で設計する（互換性維持、呼び出し側の破壊的変更を避ける）。
- `custom`（分類モデル）は`engine`値のドメインとしては実質的にOCRエンジンと同列に扱われている箇所が多い（`ModelsView`・`InferenceView`・`PreprocessView`・`OcrBatchView`・`RapidOCRView`等）ため、Registryには`custom`も1エントリとして含める設計とする。ただし`training_family`（OCR系/分類系の軸）とは別概念であることを明示する（7章参照）。
- 移行は**画面単位・関心事単位で段階的に行う**（Epic #28の「1 Issue = 1 Consumer」原則を踏襲）。1度に全画面を書き換えない。
- Registryへ移行しても、画面固有のフィールド構成（例: Tesseractの PSM 入力、PaddleOCRのバッチ設定）そのものは無くならない。Registryが解決するのは「どのエンジンで何が可能か（bool/文字列/配列）」の一元管理であり、「エンジンごとに異なるフォームを描画する」というUIの複雑さ自体を消すものではない（7章・8章で画面ごとに明記）。

## 3. 責務境界（EngineRegistry / Models API / ModelMetadata）

3層は扱う軸が異なるため、責務は重複しない。

| 層 | 軸 | 内容 | 実体 |
|---|---|---|---|
| **EngineRegistry**（本Feature設計対象、未実装） | エンジン単位（静的） | 表示名・表示順・アイコン・色・学習可否・評価可否・推論可否・ダウンロード方式・モデル形式・ファイル拡張子・デフォルト評価方式等（4章） | フロントエンドの静的JSオブジェクト。I/Oなし |
| **Models API**（Epic #28 #44で実装済み） | モデルインスタンス単位（動的、Facade） | `list_models()`/`get_model()`/`exists()`/`create_metadata()`/`save_metadata()`。Catalog/Factory/Writerへの薄い橋渡しのみ | `src/app/services/models_api.py`（バックエンド） |
| **ModelMetadata**（Feature #32で実装済み） | モデルインスタンス単位（Canonical Schema） | `model_id`/`engine_id`/`display_name`/`model_type`/`created_at`/`artifact_path`/`dataset_id`/`experiment_id`/`preprocess_version`/`source`/`extra` | `src/app/services/model_metadata.py`（バックエンド） |

- Models APIが返す`ModelMetadata.engine_id`は**値そのもの**（例: `"tesseract"`）であり、その値が「学習可能か」「どのアイコンで表示するか」といったUI上の意味づけは一切持たない。その意味づけを与えるのがEngineRegistryである。
- 既存の`GET /models/info`（`model_registry.py::list_model_infos()`）が返す約30項目のモデルインスタンス情報も同様に、EngineRegistryの対象外（モデルインスタンス単位のデータであり、エンジン単位の静的能力ではない）。
- したがってEngineRegistryの設計・実装は、Models API・ModelMetadata・`/models/info`のいずれにも変更を要求しない。3層は独立に進化できる。
- 一方、バックエンドに既に存在する`src/app/services/engine_capability.py::EngineCapability`（`supports_training`/`supports_cuda`/`supported_export_formats`等、9カテゴリの豊富なフィールドを持つ）は、フロントエンドEngineRegistryが将来的に必要とする情報の多くを**既に構造化済み**である（4.3章）。ただし現状どのAPIエンドポイントからも公開されていない（`main.py`にEngineCapability/BUILTIN_CAPABILITIESを返す経路は無し）。本Featureはこれを利用可能にする変更（新規エンドポイント追加等）を行わない（Models API変更・Resolver変更は禁止のため）。将来的にバックエンドをSource of TruthとしてフロントエンドEngineRegistryを生成・検証する方向性はあり得るが、それは本Feature後の別Issueで判断する（9章）。

## 4. Engine判定箇所の洗い出し

### 4.1 洗い出し方針

`frontend/src`全体（`App.jsx`・`views/`・`components/`・`lib/`）を対象に、`engine ===`等の比較・`switch`・三項演算子・ハードコードされたエンジン一覧・拡張子判定・ラベル/アイコン/色テーブル・学習/評価/推論可否判定・ダウンロード判定を悉皆調査した。

### 4.2 独立して重複しているラベルテーブル（最優先で統合すべき箇所）

同じ「engine id → 表示ラベル」の対応表が、**独立に6箇所**存在し、しかもうち4箇所は`trocr`を含んでいない（TrOCRモデルが存在した場合、画面によって正しく表示される/されないが分かれる）。

| # | ファイル | 内容 | `trocr`収録 |
|---|---|---|---|
| 1 | `frontend/src/lib/engineResolution.js:26-31` | `ENGINE_DISPLAY_LABELS`（tesseract/paddleocr/easyocr/trocr。`custom`は非対応、呼び出し側が個別に上乗せ） | ○ |
| 2 | `frontend/src/components/ResultBadge.jsx:1-9` | `ENGINE_LABELS`（easyocr/paddleocr/tesseract。`custom`・`trocr`なし） | × |
| 3 | `frontend/src/lib/ocrCandidates.js:5-14` | `ENGINE_LABELS`（tesseract/paddleocr/easyocr/custom。`trocr`なし） | × |
| 4 | `frontend/src/views/PreprocessView.jsx:74-75` | `engineNames`（custom/easyocr/paddleocr/tesseract。`trocr`なし） | × |
| 5 | `frontend/src/views/RapidOCRView.jsx:647-652` | `ENGINE_DISPLAY`（custom/easyocr/paddleocr/tesseract。`trocr`なし） | × |
| 6 | `frontend/src/views/ModelsView.jsx:118-122` / `frontend/src/views/InferenceView.jsx:59-62` | `engineResolution.js`の表を再利用しつつ`if (engine==="custom") return "カスタム"`を個別に上乗せするラッパーが2箇所独立に存在 | ○（委譲先経由） |

### 4.3 判定パターン別の一覧（代表箇所。全量はPart Aの調査結果を参照）

| 用途カテゴリ | 判定パターン | 代表箇所 |
|---|---|---|
| **学習可否** | ハードコード3択`<select>`（学習可能=paddleocr/tesseract、推論専用=easyocr、`trocr`なし） | `TrainingView.jsx:679-681` |
| **学習可否（Hardware）** | `!isTesseractEngine && ocrEngine!=="easyocr"`等の3エンジン限定bool分岐（CPU固定/GPU可否） | `TrainingView.jsx:708-769` |
| **評価可否・デフォルトwhitelist** | `EVAL_OCR_ENGINES = ["paddleocr","tesseract","easyocr"]`（`custom`・`trocr`除外の明示的ホワイトリスト） | `frontend/src/lib/evalOcrSettings.js:9` |
| **評価可否（画面遷移）** | Tesseractのときのみ評価画面の対象モデルを事前選択、他エンジンは無言で機能しない | `App.jsx:4431-4434` |
| **推論可否（リクエスト組立）** | `custom/paddleocr/tesseract/easyocr/trocr`の5分岐（全5identityを扱う唯一の箇所） | `App.jsx:3471-3533` |
| **推論可否（一覧フィルタ）** | `training_family`/`engine`複合条件のモデル一覧`useMemo`4種（easyocr/trocr用の一覧は無い） | `App.jsx:512-551` |
| **ダウンロード方式・拡張子判定** | `.pt`/`.tess.json`/それ以外(`.ocr.json`扱い)の3分岐、`trocr`分岐なし | `ModelsView.jsx:531-535` |
| **ダウンロード方式・拡張子判定** | `.tess.json`/`.ocr.json`のfilename判定でモデル一覧を分離 | `BenchmarkView.jsx:74-81` |
| **表示可否（小文字トグル）** | `(engine==="easyocr"\|\|engine==="paddleocr") && isLatinCaseLangs(langs)`の2エンジン限定判定。6箇所以上から参照される事実上の共通ロジック | `frontend/src/lib/lowercase.js:25-28` |
| **リリース昇格ポリシーwhitelist** | `["tesseract","paddleocr"]`固定の許可エンジンチェックボックス（easyocr/trocrは昇格対象に永久に含められない） | `ReleasesView.jsx:598-614` |
| **保存済み設定の正規化whitelist** | `["custom","easyocr","paddleocr","tesseract"]`（`trocr`が欠落。TrOCRを選択して保存してもリロード時に`easyocr`へ巻き戻る） | `frontend/src/lib/preprocessUiState.js:106-108` |
| **システムヘルスチェック表示** | Tesseract/PaddleOCRのみの固定行（EasyOCR/TrOCRの行が無い） | `OperationsView.jsx:23-33`、`SetupWizard.jsx:176-222` |
| **推奨エンジン（プロジェクトテンプレート）** | `"tesseract"`か`"paddleocr"`かの2値前提の三項演算子（3箇所で重複） | `ProjectCreateModal.jsx:11,28,120-122` |
| **推論結果の表示切替（言語行等）** | `engine==="paddleocr"?"PaddleOCR 言語":"EasyOCR 言語"`等の2エンジン限定ラベル分岐 | `InferenceView.jsx:315,425` |
| **評価画面の設定値切替** | Tesseract限定（PSM表示）・EasyOCR限定（モデル名の代わりに言語表示）の個別特例 | `EvaluationDatasetBuilder.jsx:1032-1048`、`LabelingView.jsx:598-606` |
| **Benchmark実行対象** | `tesseract_model`/`tesseract_base`/`paddleocr_official`/`paddleocr_custom`という、エンジンIDとは別軸の固定4値セット | `BenchmarkView.jsx:41-46` |

### 4.4 命名衝突（設計上の注意点）

`OcrEvaluationView.jsx:297,596`の`whitelist`モード選択に`<option value="custom">`が存在する。これは「ホワイトリストをこの画面で手動指定する」という意味の`"custom"`であり、`engine`ドメインの`"custom"`（分類モデル）とは無関係の別概念である。Registry設計・実装時にこの2つの`"custom"`を混同しないよう、命名または扱う変数を明確に区別する必要がある（Scope外だが将来の実装Featureへの申し送り事項として記録する）。

## 5. 既存のデータ駆動実装の調査

| ファイル | 実態 | Registryへの活用可否 |
|---|---|---|
| `frontend/src/lib/engineResolution.js` | `KNOWN_ENGINE_IDS`（4件の配列）と`ENGINE_DISPLAY_LABELS`（id→ラベルのみ）の2つ。表示順・アイコン・色・可否フラグ等は一切持たない。`custom`は意図的に非対応（呼び出し側が個別ラップ） | **id一覧とラベルはそのまま流用可能**。それ以外（表示順・アイコン・色・可否・拡張子等）は新規設計が必要 |
| `frontend/src/lib/trocrModelMetadata.js` | Registryではなく、`GET /models/info`の結果を`engine==="trocr"`でフィルタする単機能の抽出・検証モジュール（モデルインスタンス一覧の絞り込み、モデル単位のデータ） | Registry対象外（3章の「Models API/ModelMetadata」の軸に属する）。ただし「登録済みモデル選択 or 手動参照」という二択UIパターンは、Registry導入後に他エンジンへ一般化する際の参考実装になる |
| `frontend/src/views/InferenceView.jsx` | テーブル参照ではなく、5分岐（custom/paddleocr/tesseract/trocr/easyocr）の手書き三項演算子チェーンが2箇所（`resolvedModelName`とフィールド描画）に**独立に**存在し、同期を人手で保つ必要がある構造。唯一TrOCRを含む全5 identityに対応済みの画面だが、それは表構造ではなく個別分岐の追加によるもの | Registryが**置き換えるべき**対象。ここから機械的に抽出できる共通テーブルは存在しない（ゼロから設計が必要） |
| `frontend/src/views/BenchmarkCenterView.jsx` | `engineOptions`はデータ（実際のBenchmark結果行）から`[...new Set(rows.map(r=>r.engine))]`で動的生成。ラベル変換なし（生の`engine`文字列がそのまま表示される、例: `paddleocr`であって`PaddleOCR`ではない） | 最もRegistry親和性が高い実装パターン（新エンジン追加が自動対応）。Registry導入後は生文字列表示をラベル表示に置き換えるだけで恩恵を受けられる、最小リスクの適用箇所 |

**結論**: 「データが動的」と「表示が正しい」は別軸である。`BenchmarkCenterView`はデータ駆動だがラベルが無い、`InferenceView`はラベルも全エンジン対応だが手書き分岐でデータ駆動ではない。EngineRegistryは両方を同時に満たすことを目指す設計とする。

## 6. EngineRegistryデータ構造案

以下は設計案であり、本Featureでは実装しない。

```js
// 実装Featureでの配置案: frontend/src/config/engineRegistry.js（未実装）
export const ENGINE_REGISTRY = {
  tesseract: {
    id: "tesseract",
    label: "Tesseract",          // engineResolution.jsのENGINE_DISPLAY_LABELSを流用
    order: 1,
    family: "ocr",               // "ocr" | "classification"（isOcrFamily()の置換用）
    icon: null,                  // 案。既存UIにアイコン表現が無いため要検討
    color: null,                 // 案。tailwindトークン等、要検討
    trainable: true,
    evaluable: true,
    inferable: true,
    hardware: { cpuOnly: true, gpuSupported: false },
    downloadStrategy: "single_file",   // "single_file" | "zip" | "directory" | "none"
    modelFormat: "tess_traineddata",
    fileExtensions: [".tess.json", ".traineddata"],
    supportsLowercaseToggle: false,
    defaultEvalWhitelist: null,        // 既存 TESSERACT 系デフォルト値を移設する案
  },
  paddleocr: {
    id: "paddleocr", label: "PaddleOCR", order: 2, family: "ocr",
    trainable: true, evaluable: true, inferable: true,
    hardware: { cpuOnly: false, gpuSupported: true },
    downloadStrategy: "zip", modelFormat: "paddle_inference",
    fileExtensions: [".ocr.json"],
    supportsLowercaseToggle: true,
  },
  easyocr: {
    id: "easyocr", label: "EasyOCR", order: 3, family: "ocr",
    trainable: false, evaluable: true, inferable: true,
    hardware: { cpuOnly: false, gpuSupported: true },
    downloadStrategy: "none", modelFormat: null, fileExtensions: [],
    supportsLowercaseToggle: true,
  },
  trocr: {
    id: "trocr", label: "TrOCR", order: 4, family: "ocr",
    trainable: false,   // バックエンド未実装のため現状false（Epic #27完了後に見直す）
    evaluable: false,   // 同上
    inferable: true,    // InferenceViewで既に稼働中
    hardware: { cpuOnly: false, gpuSupported: true },
    downloadStrategy: "directory_or_ref",  // HFモデルID/ローカルパス参照
    modelFormat: "safetensors",
    fileExtensions: [],  // ファイル名規約に依らないため空
    supportsLowercaseToggle: false,
  },
  custom: {
    id: "custom", label: "カスタム（分類）", order: 5, family: "classification",
    trainable: true, evaluable: true, inferable: true,
    hardware: { cpuOnly: false, gpuSupported: true },
    downloadStrategy: "single_file", modelFormat: "pytorch_pt",
    fileExtensions: [".pt"],
    supportsLowercaseToggle: false,
  },
};
```

- `family`フィールドの導入により、`isOcrFamily()`（`["ocr","tesseract"].includes(training_family)`という`training_family`側の別軸ホワイトリスト）と`engineLabelOf`（`engine`側のホワイトリスト）という**2つの独立した軸の判定**を、Registryの1エントリから両方導出できるようにする（ただし`training_family`は既存データ（`.tess.json`等）にそのまま保存されている実データ値でもあるため、完全な一本化にはLegacy側データとの整合確認が必要。7章のModelsViewの項で詳述）。
- `defaultEvalWhitelist`・`icon`・`color`は具体値は今回決定しない（実装Featureで既存定数（`TESSERACT_WHITELIST_DEFAULT`等）の移設方針を含めて確定する）。
- 上記は最低限の項目（Issue本文の12項目）をすべて含む。実装Feature側で過不足を精査する前提の**叩き台**である。

## 7. 画面ごとの整理（Registry化できる箇所・できない箇所）

### ModelsView.jsx

**状態（2026-08-03）**: **Completed**。Refactor [#51](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/51)「ModelsView Migration」により、PR [#52](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/52)をSquash Merge・mainへ反映済み（Merge Commit: `185090c`）。

- **移行済み**: `engineLabelOf()`をRegistry `getEngineLabel()`参照へ置換（既存表示ラベルは完全維持）。Engine列へ`getEngineDisplayName()`（`title`属性）・`getEngineColor()`（`data-engine-color`属性）を追加。`handleDownload()`のフォールバックファイル名判定を`getEngineDownloadType()`起点の`fallbackDownloadName()`へ置換。**UIの見た目・レイアウトは変更していない**（既存レンダリング回帰テスト24件＋新規15件、計39件で確認済み）。
- **未移行（意図的にScope外）**: `isOcrFamily()`/`familyLabelOf()`（`training_family`の`["ocr","tesseract"]`固定ホワイトリスト）は、当初4.2/7章で「Registry化できる」候補として挙げていたが、本Featureでは対象外とした（Issue #51の明示的なScope外指定）。次のFeature以降での判断とする。
- **Engine色（`data-engine-color`）は非表示のDOM属性としてのみ実装**: 実際に色付き表示するUI（バッジ・アイコン等）はまだ存在しない。実表示への適用は将来のUI改善Featureの対象（6章「具体値は今回決定しない」を参照。色の実際の値自体も暫定）。
- **Download処理の既知の制約**: `downloadType`はtesseract/customがともに`"single_file"`で同値のため、`downloadType`単独ではこの2エンジンを判別できない。`fallbackDownloadName()`は`engine === "tesseract"`という個別のengine id判定を追加で残しており、Registry単体でのDownload処理の完全な一般化には至っていない（11章「Future Work」参照）。
- **できない（Registry対象外のまま）**: 「モデルカルテ」詳細・比較ビューが参照する`ocr_training_params`・`dataset_split_counts`・`model_size_mb`等、約15項目のモデルインスタンス固有データ（3章の通りModels API/ModelMetadataの軸）。「モデル評価」ボタンがTesseractのみ対象モデルを事前設定する遷移ロジック（`App.jsx:4431-4434`）は、Registryの`evaluable`フラグだけでは解決しない——評価画面（`OcrEvaluationView`）自体が他エンジンに未対応であるため、Registry側を直しても評価画面側の一般化が別途必要（後述）。

### TrainingView.jsx

**状態（2026-08-03）**: **Completed**。Refactor [#53](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/53)「TrainingViewをEngine Registryへ移行」により実装。PR [#54](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/54)をSquash Merge・mainへ反映済み（Merge Commit: `cb6a8ce`）。詳細は[TRAININGVIEW_MIGRATION.md](workitems/engine-ui/TRAININGVIEW_MIGRATION.md)参照。

- **移行済み**: 学習エンジン`<select>`の3択ハードコード→`getTrainingSelectableEngines()`（新設）で動的生成。エンジン表示名（`engineDisplayLabel`等）→`getEngineLabel()`。学習可否（epochs入力disabled・実行操作ブロック表示ゲート）→`isEngineTrainingSupported()`（新設）へ一本化。デバイス選択ボタンのselectable条件→`getEngineSupportedDevices()`/`isEngineDeviceSupported()`（新設）。エンジン固有設定パネルの分岐→`getEngineTrainingPanel()`（新設、"paddleocr"/"tesseract"/"unsupported"の明示的な値。暗黙のPaddleOCRフォールバックを廃止）。ジョブスナップショットのラベル・フィールドレイアウト→`getEngineLabel()`/`getEngineSnapshotType()`（新設）。**UIの見た目・既存3Engineの挙動は変更していない**（既存レンダリング回帰テスト44件が無修正のまま全件成功）。TrOCRは`trainingSupported=false`／`trainingSelectable=false`のまま（選択肢に表示しない）。
- **Registry内部状態の不変性（PR #54マージ前レビューMajor #1、修正済み）**: `ENGINE_REGISTRY`の各エントリ・`supportedDevices`配列を`Object.freeze()`し、`getEngineSupportedDevices()`は呼び出しごとに新しい配列のコピーを返すよう変更した。呼び出し側が戻り値を変更してもRegistry内部状態・以降の呼び出し結果へ影響しない（テストで確認済み）。
- **意図的にRegistry化しなかった（Future Work、11章参照）**: Tesseract固有の「デバイス選択UI自体を常時ロックする」挙動（`isTesseractEngine`直接比較のまま）。「最大イテレーション/学習回数」等の用語切替、OCRタイプ`<option>`の補足文言（学習UI固有の説明文であり汎用Engine capabilityではないため）。
- **できない（Registry対象外）**: 「エンジン固有設定」パネルの実際のフォーム内容（Tesseractの PSM/Charset/Whitelist、PaddleOCRのBatch/Workers/AMP等）はエンジンごとに全く異なる入力項目であり、Registryは「どの専用コンポーネントを描画するか」の分岐先を提供できても、フォーム自体をデータ化して消せるものではない（設計方針2章の通り）。

### OcrEvaluationView.jsx

- **Registry化できる**: デフォルトwhitelist（`TESSERACT_WHITELIST_DEFAULT`固定引き渡し、`App.jsx:4820`）→ Registry `defaultEvalWhitelist`。将来的な対象モデル一覧のフィルタ条件（現状Tesseract固定）→ Registry `evaluable`フラグでの絞り込みへ置換可能。
- **できない（Registry対象外、より大きな課題）**: 画面全体がTesseract固有語彙（"eng.traineddata"、PSM等）で構成されており、PaddleOCR/EasyOCRにすら対応していない。これは**TrOCR以前の一般化課題**であり、Registryの導入だけでは解決しない。本画面の一般化は、Registry移行とは別の、より大きなFeature（Evaluation画面の多エンジン対応）として切り出すべきである（9章）。

### BenchmarkView.jsx

- **Registry化できる**: モデル一覧の拡張子フィルタ（`.tess.json`/`.ocr.json`、4.3表）→ Registry `fileExtensions`。
- **できない（Registry対象外）**: `selectedEngines`は`tesseract_model`/`tesseract_base`/`paddleocr_official`/`paddleocr_custom`という、**エンジンIDとは異なる軸**（「公式モデルか学習済みモデルか」というバリアント軸）の固定4値である。フラットな`ENGINE_REGISTRY`（エンジンID単位）ではこの軸を素直に表現できず、Registryに「バリアント」という第2軸を持たせるか、本画面はエンジンID単位のRegistryとは別に独自のバリアント一覧を持ち続けるかの判断が必要（本Featureでは判断せず、実装Feature側の検討事項として申し送る）。

### BenchmarkCenterView.jsx

- **Registry化できる**: 現状生のengine文字列をそのまま表示している箇所（フィルタの`<option>`テキスト、結果行の表示）→ Registry `label`に置換するだけで完了する、最小リスクの適用箇所。
- **できない**: 特になし。本画面は既にエンジン集合をデータから動的導出しており、Registry導入は「表示の質」を上げるのみで構造変更を伴わない。

## 8. TrOCR追加時の検証（「Registryへ追加するだけ」で済むか）

画面ごとに結論が異なる。**Registry導入だけで「追加するだけ」を達成できる画面と、それでも別途一般化Featureが必要な画面がある**——これは楽観的すぎる前提を持たないための重要な確認結果である。

| 画面 | Registry導入後、TrOCR追加が「Registryへ1エントリ追加するだけ」で済むか |
|---|---|
| `BenchmarkCenterView.jsx` | **済む**。既にデータ駆動、ラベルもRegistry参照に変えれば追加コード不要 |
| `ModelsView.jsx` | **概ね済む**（一覧・フィルタ・ダウンロード判定はRegistry化で対応可能）。ただし「モデルカルテ」詳細のエンジン固有項目表示は元々TrOCR分の項目自体が存在しないため対象外（表示すべき項目が無いので実質問題にならない） |
| `TrainingView.jsx` | **済まない**。TrOCR学習自体がバックエンド未実装（Epic #27の責務）のため、Registryの`trainable`フラグを`true`にしても学習は動かない。UIとしては「学習エンジン一覧に出さない」ことがRegistry化で自動的に保証される（`trainable:false`のまま追加すれば安全）が、これは「TrOCR学習を追加するだけで使える」という意味ではなく「TrOCR学習が使えるようになるまで安全に除外され続ける」という意味 |
| `InferenceView.jsx` | **済まない（現状のまま）**。この画面は既にTrOCRに対応しているが、それは手書きの5分岐によるものであり、Registry駆動ではない。Registry導入の効果を得るには、本画面の2つの並行ternaryチェーン（`resolvedModelName`とフィールド描画）自体をRegistry参照型に**書き換える**必要がある。書き換えを行わない限り、Registryにエントリを追加しても本画面の挙動には何の影響も与えない（現状のハードコードが優先されたまま） |
| `OcrEvaluationView.jsx` | **済まない**。4章・7章の通り、TrOCR以前にPaddleOCR/EasyOCR分の一般化がそもそも出来ていない画面であり、Registry導入は前提条件にすらならない |
| `BenchmarkView.jsx` | **済まない**。`selectedEngines`がエンジンID単位ではないバリアント軸の固定4値であるため、Registryへ`trocr`を追加しても本画面のUIには反映されない（本画面自体の改修が必要） |

**結論**: Registry導入は「TrOCR追加時の変更範囲を最小化する」ための土台として有効だが、「Registryに1行追加するだけで全画面に反映される」状態に**今回の設計だけでは到達しない**。`InferenceView`・`OcrEvaluationView`・`BenchmarkView`は、Registry導入に加えて画面自体のRegistry参照型への書き換え（＝実装Feature側の作業）が別途必要であることを明記する。

## 9. 移行対象一覧・移行優先順位

Epic #28の「1 Issue = 1 Consumer」原則を踏襲し、1度に全画面を移行しない。以下は実装Feature着手時の参考順位（本Featureでは着手しない）。

| 優先度 | 対象 | 理由 |
|---|---|---|
| 1 | 4.2章の重複ラベルテーブル6箇所の統合（`engineResolution.js`をRegistryへ拡張し、`ResultBadge.jsx`/`ocrCandidates.js`/`PreprocessView.jsx`/`RapidOCRView.jsx`の独自コピーを置換） | 最小リスク・即効性が高い。現状`trocr`ラベルが画面によって表示されない実バグを解消する |
| 2 | `BenchmarkCenterView.jsx`のラベル表示置換 | 既にデータ駆動、変更箇所が1点のみ |
| 3 | `ModelsView.jsx`（`engineLabelOf`/`familyLabelOf`/`isOcrFamily`/ダウンロード拡張子判定） | 影響範囲が同一ファイル内に閉じている |
| 4 | `frontend/src/lib/lowercase.js`（`lowercaseToggleApplicable`）・`frontend/src/lib/evalOcrSettings.js`（`EVAL_OCR_ENGINES`）のRegistry参照化 | 小規模・機械的な置換 |
| 5 | `TrainingView.jsx`（学習エンジン`<select>`・デバイス選択可否） | 規模はやや大きいが1ファイルに閉じる |
| 6 | `InferenceView.jsx`（2つの並行ternaryチェーンのRegistry駆動への書き換え） | 最もTrOCR対応が進んでいる画面であるため回帰リスクが高く、慎重な設計・テストが必要 |
| 7 | `OcrEvaluationView.jsx`・`BenchmarkView.jsx`の構造的一般化 | Registry単体では解決しない、独立した大きめのFeature（8章参照）として切り出すべき |
| 8（低優先） | `ReleasesView.jsx`のallowedEngines、`OperationsView.jsx`/`SetupWizard.jsx`のヘルスチェック表、`ProjectCreateModal.jsx`/`projectTemplates.js`の推奨エンジン三項演算子 | 利用頻度・影響範囲ともに小さく、いつ着手してもよい |

## 10. Scope外

- `EngineRegistry`本体の実装（`frontend/src/config/engineRegistry.js`等の新規作成）
- 上記いずれの画面のUI変更・リファクタリング
- TrOCRモデルの追加・学習実装（Epic #27の責務）
- Models API・`ModelMetadata`・Metadata Reader/Writer/Catalog/Factoryの変更
- Inference Resolver・Evaluation・Deployment連携（Epic #28の後続Issue）
- バックエンド`engine_registry.py`/`engine_capability.py`とフロントエンドEngineRegistryの統合（3章で触れた将来検討事項。新規APIエンドポイント追加が必要になるため、本Featureのスコープ外かつ別Issueで判断する）
- `OcrEvaluationView.jsx`のTesseract以外のエンジンへの一般化そのもの（7章・8章で「Registry単体では解決しない」と整理したが、その一般化自体の設計・実装は本Featureの対象外）

## 11. Future Work（ModelsView Migrationレビューで残った事項）

PR [#52](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/52)のマージ前レビューで挙がったMinor・Suggestionは、いずれも今回のFeatureでは対応していない。**以下は「未実装」であり、実装済みと誤解しないこと。**

- **`fallbackDownloadName()`の`engine === "tesseract"`直接比較**: Registryの`getEngineDownloadType()`等が内部で行うid正規化（trim・小文字化）を経由しない、生の文字列比較のまま残っている。実データは常に正規化済み小文字のため現状の機能影響はないが、一貫性の観点で改善余地がある。
- **`downloadType`の粒度不足**: tesseract/customが同じ`"single_file"`のため、両者を区別するには`engine === "tesseract"`という個別判定が今なお必要。`fileExtensions`/`modelFormat`相当のフィールドをRegistryへ追加すれば、この最後のハードコード分岐も解消できる（6章のデータ構造案で当初想定していたが、Engine Registry Core（Feature #49）では未実装のまま）。
- **`engineRegistry.js`（Feature #49実装）の`getEngineLabel()`ドキュメントコメント**: 「表示名取得と同じ値を返す」と記載しているが、`custom`エントリでは`label`（カスタム）と`displayName`（カスタム（分類））が異なり、ModelsView Migrationはこの差異を実際に利用している。コメントが実態と不整合なまま残っている。
- **Issue/PR本文への`isOcrFamily()`未移行の明記漏れ**: コード自体は正しく無変更だが、Issue #51・PR #52本文には明記されていなかった（本ドキュメント7章「ModelsView.jsx」へ記録することで対応）。
- **ラベルテーブル統合（9章の優先順位1）が未着手のまま**: `ResultBadge.jsx`・`ocrCandidates.js`・`PreprocessView.jsx`・`RapidOCRView.jsx`の独自ラベルテーブル（4.2章）は、ModelsView Migrationでは対象外のまま残っている。9章の推奨順位ではModelsView移行（優先度3）より先に行うべき項目だったが、実際にはModelsView移行が先行した。次のFeatureで改めて優先度を判断する。

これらはいずれも動作上のバグではなく、設計・実装の継続的な改善事項として記録する。次のFeature（TrainingView Migration等）着手時に、対応するかどうかを個別に判断する。

### Refactor #53「TrainingView Migration」で残った事項

PR [#54](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/54)のマージ前レビューで挙がったMajor #1（Registry内部状態の不変性）は`Object.freeze()`＋配列Getterのコピー返却により対応済み（PR #54で修正・Squash Merge済み）。**以下のMinor・Suggestion相当の事項は今回のFeatureでは対応していない。「未実装」であり、実装済みと誤解しないこと。**

- **Tesseractの「デバイス選択UI常時ロック」挙動が未Registry化**: `TrainingView.jsx`の`isTesseractEngine`（`ocrEngine === "tesseract"`直接比較）が、デバイスボタンの`clickable`/`selected`/`fixedCpu`判定に残っている。`supportedDevices`のみからの一般化は、EasyOCR（対応デバイス0件）との区別が難しく回帰リスクが高いため、意図的に見送った（詳細は[TRAININGVIEW_MIGRATION.md](workitems/engine-ui/TRAININGVIEW_MIGRATION.md)「デバイス対応」参照）。
- **OCRタイプ`<option>`の補足文言（`TRAINING_ENGINE_OPTION_SUFFIX`）はTrainingView.jsx内のローカル定数のまま**: 「（学習可）」「（推論専用）」等の学習UI固有の説明文はRegistryへ追加していない。Registryへ統合するかどうかは未判断。
- **「最大イテレーション/学習回数」等の用語切替も`isTesseractEngine`直接比較のまま**: 表示名・学習可否・デバイス・設定パネル・スナップショットは移行済みだが、この用語切替は対象外とした（プレゼンテーション上の言い回しであり、Engine capabilityの一部ではないと判断したため）。
- **EasyOCRの`supportedDevices`と学習未対応状態の意味を明確化する余地**: `supportedDevices=[]`は「学習における対応デバイス」というTraining専用スコープであり、`src/app/services/engine_capability.py`の`supports_cpu=True`/`supports_cuda=True`（推論としては両デバイス対応）とは別概念。この区別はコードコメントに記載済みだが、フィールド名（`supportedDevices`）だけでは読み取りにくく、将来Backend Capability全体との対応表だと誤解される恐れがある（PR #54レビューMinor）。
- **Registry Getterの戻り値ポリシーを今後も維持すること**: 配列を返すGetter（`getEngineSupportedDevices()`等）は必ず呼び出しごとに新しいコピーを返し、Registry内部オブジェクトへの参照を外部へ漏らさない（`getEngineEntry()`の戻り値はfrozen）。Registryへ新しい配列・オブジェクト型フィールドを追加する際は、同じ方針（freeze＋コピー返却）を踏襲すること。
- **ラベルテーブル統合（9章の優先順位1）は本Featureでも未着手のまま**（ModelsView Migration時点から継続）。

### 開発上の注意事項: テストファイル追加時の`package.json`登録

`frontend/package.json`の`npm test`スクリプトはテストファイルを明示列挙する方式であり、glob等による自動検出は行われない。Feature #49（Engine Registry Core）で新規作成した`tests/engineRegistry.test.mjs`がこの登録から漏れており、Refactor #51（ModelsView Migration）完了時点までの2回の完了報告で「npm test全通過」と報告した内容には、実際にはこの13件が含まれていなかった（Refactor #53で登録漏れを修正し、以降は`npm test`の実測件数に含まれている）。**新規テストファイルを追加する場合は、`frontend/package.json`の`test`スクリプトへの追記を必ず行うこと。** `node --test <ファイル名>`単体では成功していても、`npm test`（CI等が実行する経路）には反映されない点に注意する。
