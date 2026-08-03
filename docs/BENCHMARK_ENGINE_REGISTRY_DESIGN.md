# Benchmark Engine Registry Design

Related: Epic [#46](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/46)（Engine UI Generalization） / Refactor [#55](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/55)（BenchmarkView Engine Registry Design、**Completed**・Closed。PR [#56](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/56)をSquash Merge・mainへ反映済み、Merge Commit: `2965df7`） / Refactor [#57](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/57)（BenchmarkCenterViewのEngine表示をRegistryへ移行、**Completed**・Closed。PR [#58](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/58)をSquash Merge・mainへ反映済み、Merge Commit: `89b9f9e`） / [ENGINE_REGISTRY_DESIGN.md](ENGINE_REGISTRY_DESIGN.md) / Engine Registry Core [#49](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/49) / ModelsView Migration [#51](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/51) / TrainingView Migration [#53](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/53)

**本ドキュメントは調査・設計のみを対象とする。実装（Engine Registry変更・`BenchmarkView.jsx`/`BenchmarkCenterView.jsx`変更・TrOCR追加・Backend変更）は一切行わない。**

**状態（2026-08-03）**: **Completed**。本設計は承認され、以下が確定した設計判断として決定した。

- `BenchmarkView.jsx`の`selectedEngines`は**canonical Engine IDではない**。Backend `ENGINE_CATALOG`由来の**Benchmark Variant Key**（`tesseract_model`/`tesseract_base`/`paddleocr_official`/`paddleocr_custom`/`easyocr`）である
- `BenchmarkCenterView.jsx`の`row.engine`は**canonical Engine ID**（`engineRegistry.js`と同じ軸）である
- Runner（BenchmarkView）とCenter（BenchmarkCenterView）は責務・データ軸が異なるため、**無理に統合しない**
- `BenchmarkView.jsx`のVariant Key構造は**Engine Registryへ移さない**（Backend `ENGINE_CATALOG`を正としてBenchmark固有概念のまま維持する）
- `BenchmarkCenterView.jsx`の表示ラベルのみ、Engine Registryへの移行が可能と判断した

**Refactor #57「BenchmarkCenterViewのEngine表示をRegistryへ移行」も完了**（本ドキュメント9章 Migration Plan Phase 1に相当）。PR [#58](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/58)をSquash Merge・mainへ反映済み（Merge Commit: `89b9f9e`）。実施内容:

- Engineフィルタの表示値（`<option>`テキスト）をRegistry化
- 一覧テーブルのEngine表示をRegistry化
- 比較テーブルのEngine表示をRegistry化
- フィルタ内部値（`value`属性・`filters.engine`）はcanonical Engine IDのまま変更していない
- unknown Engineは`getEngineLabel() ?? "不明"`により安全に「不明」表示（既知Engineへのフォールバックなし）
- TrOCRは既存結果の表示対応のみ（機能追加ではない）
- `BenchmarkView.jsx`のVariant Key構造・Backend `ENGINE_CATALOG`は無変更
- CSS・レイアウトの変更なし（文字列表示のみの変更）

- Benchmark RunnerへのTrOCR対応は、主にBackend `ENGINE_CATALOG`側の対応が前提であり、Epic #27（TrOCR本体）の責務である

次のFeatureは「Evaluation UI Generalization」（`OcrEvaluationView`/`BenchmarkView`/`BenchmarkCenterView`が並存し、責務・Engine軸が異なるため、まず調査・設計Issueを作成予定）。`selectedEngines`初期値の再検討・2画面の役割説明改善は8章「UIレビュー」記載のとおりFuture Workのまま。

## 1. 現状

Benchmark関連の画面は独立した2つに分かれている。

| 画面 | ファイル | 目的 | Engineの軸 |
|---|---|---|---|
| Benchmark Runner | `frontend/src/views/BenchmarkView.jsx` | 新規にモデルを実行し、CER/精度/速度を比較するベンチマークを**その場で実行**する | `ENGINE_CATALOG`の**variant key**（後述） |
| Benchmark Center | `frontend/src/views/BenchmarkCenterView.jsx` | プロジェクト内の既存モデル・評価履歴を**横断的に閲覧・比較**する（新規実行なし） | Model Registryの**canonical engine id**（後述） |

両画面とも`App.jsx`から独立してレンダリングされ（`App.jsx:4610-4624`・`4627-4638`）、状態共有は無い。`BenchmarkView`は`App.jsx`が`GET /api/benchmarks/engines`で取得した`engines`propを受け取るが、`BenchmarkCenterView`には`engines`相当のpropは一切渡されず、コンポーネント内部で全データを取得する。

## 2. 問題点

- 「Benchmark Runner」と「Benchmark Center」という名称・運用配下への配置だけでは、初見のユーザーがどちらを使うべきか判断しづらい（Epic #46着手前のUIレビューでも同様の指摘あり）。
- `BenchmarkView.jsx`の`engine`という語（`selectedEngines`・`engines` prop）は、実際には`engineRegistry.js`が扱う**canonical engine id**（tesseract/paddleocr/easyocr/trocr）ではなく、**Benchmark専用のvariant key**（後述3章）を指しており、同じ「engine」という語が画面によって異なる概念を指している。
- `BenchmarkCenterView.jsx`は`row.engine`（canonical engine id）を生の小文字文字列のまま表示しており（例: `"paddleocr"`）、`engineRegistry.js`/`engineResolution.js`のどちらの表示ラベルも利用していない。

## 3. Engineの責務（Engine / Variantの整理）

**最重要の整理**: 2画面は「engine」という同じ語を使いながら、実際には**構造的に異なる2つの軸**を扱っている。

### BenchmarkCenterView.jsx — canonical engine id軸

`row.engine`は`src/app/services/benchmark_center.py::list_comparable_models()`（`benchmark_center.py:94,117`）が`model_registry.py::list_model_infos()`由来の`engine`フィールドをそのまま返したものであり、`resolve_engine_id()`（`model_registry.py:324`）で正規化された**真のengine id**（`"tesseract"`/`"paddleocr"`/`"easyocr"`/`"trocr"`/`"custom"`/`"unknown"`）である。これは`engineRegistry.js`が扱う軸と完全に一致する。

### BenchmarkView.jsx — Benchmark Variant軸

`selectedEngines`（`BenchmarkView.jsx:41-46`）・`engines` prop・`buildRunPayload()`が扱う「engine」は、Backend `ENGINE_CATALOG`（`src/app/services/benchmark.py:44-85`）が定義する**5つの固定variant key**である。

| variant key | 実体のengine id | 意味 | implemented |
|---|---|---|---|
| `tesseract_model` | tesseract | OCR Crafterで学習・登録したTesseractモデル（`.tess.json`） | true |
| `tesseract_base` | tesseract | 学習前ベースライン（`eng.traineddata`、公式モデル） | true |
| `paddleocr_official` | paddleocr | PaddleOCR公式認識モデル | true |
| `paddleocr_custom` | paddleocr | 学習・推論用エクスポート済みの自作PaddleOCRモデル（`.ocr.json`） | true |
| `easyocr` | easyocr | EasyOCR（Benchmark実行経路が未実装のため`implemented: false`） | false |

つまりvariant keyは「**canonical engine id × モデル取得元（自作/公式/ベースライン）**」の直積であり、canonical engine id単体の情報ではない。`tesseract_model`と`tesseract_base`は同じengine（tesseract）だが異なるvariantであり、逆に`paddleocr_official`と`paddleocr_custom`も同様である。この「モデル取得元」という軸（自作 vs 公式 vs ベースライン）は、`engineRegistry.js`の設計方針（エンジン単位の静的設定）にはそもそも存在しない、**Benchmark固有の概念**である。

**責務分担のまとめ**:

| 責務 | 所在 |
|---|---|
| Engine単体の表示名・色・学習可否等の静的情報 | `engineRegistry.js`（Registry） |
| 「どのモデル取得元と比較するか」というBenchmark実行時の選択軸 | Backend `ENGINE_CATALOG`（`benchmark.py`）+ `BenchmarkView.jsx`のvariant key |
| 実行結果の識別子（`engine_key = f"{variant}:{model}"`、`benchmark.py:511`） | Benchmark実行時ランタイム概念（Registry対象外） |

## 4. Engine判定一覧

### BenchmarkView.jsx

| # | 箇所 | 判定内容 | パターン |
|---|---|---|---|
| 1 | `41-46` | `selectedEngines`初期値（variant key 4つの固定オブジェクト） | ハードコード（オブジェクトリテラル） |
| 2 | `74-77` | `tessModels = ocrModels.filter(m => m.name.endsWith(".tess.json"))` | 拡張子判定 |
| 3 | `78-81` | `paddleModels = ocrModels.filter(m => m.name.endsWith(".ocr.json"))` | 拡張子判定 |
| 4 | `97` | `if (selectedEngines.tesseract_model && selectedModel)` | if |
| 5 | `100` | `if (selectedEngines.tesseract_base)` | if |
| 6 | `103` | `if (selectedEngines.paddleocr_official)` | if |
| 7 | `106` | `if (selectedEngines.paddleocr_custom && selectedPaddleModel)` | if |
| 8 | `252` | `engine.key === "tesseract_model" && selectedEngines.tesseract_model ? <select tessModels/> : null` | 三項演算子（文字列リテラル比較） |
| 9 | `262` | `engine.key === "paddleocr_custom" && selectedEngines.paddleocr_custom ? <select paddleModels/> : null` | 三項演算子（文字列リテラル比較） |

`switch`文は無し。canonical engine id（`"tesseract"`等）に対する直接比較は**一切存在しない**（すべてvariant keyへの比較）。

### BenchmarkCenterView.jsx

| # | 箇所 | 判定内容 | パターン |
|---|---|---|---|
| 1 | `159` | `engineOptions = [...new Set(rows.map(r => r.engine))].filter(Boolean).sort()` | データ駆動（ハードコードなし） |
| 2 | `lib/benchmarkCenter.js:37` | `matchesBenchmarkCenterFilters`: `if (filters.engine && row.engine !== filters.engine) return false;` | if（単純な値比較、分岐ではない） |

`if`/`switch`/三項演算子によるEngine**分岐**（描画内容やロジックを変える判定）は存在しない。拡張子判定も存在しない（モデル一覧はBackend `list_comparable_models()`から取得、クライアント側フィルタなし）。

## 5. Registryへ移行可能か

### 完全移行可能

- **`BenchmarkCenterView.jsx`の`row.engine`表示（`345`行目・`458`行目）**: 現状は生の小文字文字列をそのまま表示している。`getEngineLabel(row.engine)`（Registry既存API）へ置換するだけで、他のロジック変更は一切不要。`engineOptions`（`159`行目）も同様に、フィルタドロップダウンの表示テキストのみ`getEngineLabel()`を通せる（value自体はcanonical engine idのまま変更不要）。
- **理由**: この画面の`engine`は既にcanonical engine id軸そのものであり、`engineRegistry.js`の対象と完全に一致するため、置換に他画面のような軸のズレが存在しない。ModelsView Migration（#51）で確立した「表示ラベルのみRegistry化、値・順序・構造は不変」というパターンをそのまま適用できる、最小リスクの移行。

### 一部移行（Registry＋画面ロジックの組み合わせ）

- **`BenchmarkView.jsx`のvariant key表示ラベル**: `engines` prop自体はBackend `ENGINE_CATALOG`由来の`label`（例:「Tesseract（登録モデル）」）を使っており、これ自体は変更不要（Backend文言のため対象外）。ただし、variant keyから対応するcanonical engine id（`tesseract_model`→`tesseract`等）への**マッピングさえ画面側に用意すれば**、`getEngineColor()`等のRegistry情報（表示色等、実UIでは未使用だが将来使う場合）をvariant単位の表示へ付加することは可能。ただしBackend側の`label`文言と重複するため、今回は必要性なしと判断する。
- **モデル候補フィルタ（`.tess.json`/`.ocr.json`拡張子判定）**: `getEngineDownloadType()`等、既存Registryのフィールドは「ダウンロード方式」の粒度であり拡張子そのものを持たない（ModelsView Migrationレビューで指摘済みの既知のギャップ、[ENGINE_REGISTRY_DESIGN.md](ENGINE_REGISTRY_DESIGN.md) 11章参照）。Registryに`fileExtensions`相当のフィールドを追加すれば、variant key→engine idマッピングと組み合わせて拡張子判定をRegistry駆動化できる可能性はあるが、現時点のRegistryスキーマでは実現できない（一部移行、Registry拡張が前提）。

### 移行不可（Benchmark固有概念）

- **`selectedEngines`のvariant key構造そのもの**: 「どのモデル取得元と比較するか」（自作/公式/ベースライン）は、エンジン単位の静的設定を扱う`engineRegistry.js`の設計方針（[ENGINE_REGISTRY_DESIGN.md](ENGINE_REGISTRY_DESIGN.md) 2章）に存在しない概念であり、Registryへ持ち込むべきではない。これはBackend `ENGINE_CATALOG`が正であり、そのままBackend駆動で運用を続けるべき。
- **`engine_key`（`variant:model`形式のランタイム識別子）**: Benchmark実行1回ごとに生成される実行結果の識別子であり、静的なEngine設定とは無関係。
- **Leaderboard・比較機能（`engineKeys`・`purpose_picks`等）**: 現状すでに`engine_key`文字列の一致判定のみで完結しており、Engine識別の知識を一切必要としない（**既にRegistry非依存で正しく汎用化されている**、移行対象ではなく現状維持が適切）。
- **`BenchmarkCenterView.jsx`の`model_name`キーによるグルーピング**: Engineではなくモデル単位の比較であり、Registry対象外。

## 6. BenchmarkViewとBenchmarkCenterViewの差

| 観点 | BenchmarkView（Runner） | BenchmarkCenterView（Center） |
|---|---|---|
| 役割 | 新規ベンチマーク実行（推論を都度実行し計測） | 既存モデル・評価履歴の横断閲覧（実行なし） |
| Engineの軸 | Variant key（`tesseract_model`等） | Canonical engine id |
| データ取得元 | `benchmarks.json`（実行結果の蓄積） | `model_registry.py`・評価履歴 |
| Engineリストの出所 | Backend `ENGINE_CATALOG`（固定5件、`App.jsx`経由でprop） | 画面内部でモデル一覧から動的抽出 |
| キー軸 | `engine_key`（variant+model） | `model_name` |

**重複**: どちらも「複数モデルの指標を横並びで比較する」という体験（leaderboard的なテーブル、CER/精度の比較列）を提供しており、初見のユーザーには機能が重複しているように見える。

**将来的な統合可能性**: 低いと判断する。理由は、両画面が扱う「Engine」の軸が構造的に異なる（variant key vs canonical engine id）ため、単純にUIを統合すると軸の混同（例: 比較テーブルの「Engine」列が画面によって意味が変わる）を招く。統合するとすれば、「新規実行」と「既存モデル閲覧」という目的の違いを維持したまま、共通の表示コンポーネント（テーブル・チャート）のみ共有化する方向が現実的だが、これは本Featureのスコープを超える将来検討事項とする。

## 7. TrOCR対応

| 項目 | 現状 | TrOCR追加時 |
|---|---|---|
| Engine選択（BenchmarkView） | `engines`propの`.map()`によるチェックボックス描画は完全に汎用的（`BenchmarkView.jsx:230`）。**Backend `ENGINE_CATALOG`にvariant keyを1件追加するだけでチェックボックスは自動的に増える**（フロントエンド変更不要） | Backend側で`trocr_model`等のvariant key追加が必須（Epic #27の責務。現状`ENGINE_CATALOG`に一切存在しない） |
| 表示名 | variant keyの`label`はBackend文言（`ENGINE_CATALOG[].label`）であり、フロントエンドでの追加作業は不要 | 同上（Backendが`label`を用意すれば自動反映） |
| 実行設定 | `profile_keys`（PSM/Whitelist等）もBackend側定義であり、フロントは`profile_keys`の有無で表示を切り替える汎用ロジックのみ（要追加確認だが、既存の`tesseract_model`/`tesseract_base`のPSM表示等から見て、これも概ね汎用的と推測される） | Backend側でTrOCR用`profile_keys`定義が必要 |
| 結果表示・Leaderboard | `engine_key`文字列ベースで完全に汎用（本調査で確認済み） | **フロントエンド変更不要** |
| 比較機能 | 同上、`engineKeys`は`results`から動的抽出 | **フロントエンド変更不要** |
| BenchmarkCenterView全般 | `engineOptions`が完全にデータ駆動（`159`行目） | モデル登録時にBackendが`engine: "trocr"`を持つモデルをRegistryへ書き込みさえすれば、**フロントエンド変更不要**で自動的にTrOCR行が表示される |

**結論**: `BenchmarkView.jsx`・`BenchmarkCenterView.jsx`とも、フロントエンド側は既に驚くほど汎用化されており、TrOCR追加の障害は**フロントエンドではなくBackend（`ENGINE_CATALOG`へのvariant key追加、Benchmark実行経路の実装）に集中している**。これはEpic #27（TrOCR本体）の責務であり、本Epic #46のスコープ外。

## 8. UIレビュー

- **分かりにくい導線**: 「Benchmark Runner」（運用配下）と「Benchmark Center」（運用配下）という2画面が並存し、名称・配置だけでは目的の違い（新規実行 vs 既存閲覧）が伝わりにくい。改善案: メニュー上のラベルまたは各画面冒頭に一言説明（「ここでは新規に実行して比較します」/「ここでは既存モデルを横断的に閲覧します」）を追加する（本Featureでは未実施、Scope外）。
- **重複表示**: 両画面ともCER/精度指標の比較テーブルを持つが、データソース（都度実行 vs 既存履歴）が異なることが画面上で明示されていない。
- **Engine依存**: `BenchmarkView.jsx`はBackend駆動で汎用的、`BenchmarkCenterView.jsx`は生のengine文字列表示のみが弱点（5章「完全移行可能」で解消見込み）。
- **Tesseract依存**: `selectedEngines`の初期値（`BenchmarkView.jsx:44`）が`tesseract_base: true`のみtrueで他はfalseという初期選択になっており、初見時にTesseract以外のEngineが実行対象外に見える（構造的な偏りではなく初期値の選択のみ）。
- **将来TrOCR追加時の障害**: フロントエンドには実質的な障害は無い（7章参照）。障害はBackendの`ENGINE_CATALOG`・Benchmark実行経路の未実装のみ。

**改善案（Future Work、本Featureでは未実施）**:
1. `BenchmarkCenterView.jsx`の`row.engine`表示を`getEngineLabel()`経由へ置換（5章「完全移行可能」、次のFeatureで対応）。
2. **Future Work**: 2画面（Runner/Center）の役割の違いをUI上に一言説明として明示する。
3. **Future Work**: `selectedEngines`初期値の妥当性（Tesseract baseのみ既定ON）を再検討する。

## 9. Migration Plan（将来Feature向けの叩き台）

1. **Phase 1（低リスク）**: `BenchmarkCenterView.jsx`の`row.engine`表示ラベルのみ`getEngineLabel()`へ置換（5章「完全移行可能」）。値・フィルタ・ソート・CSV/Markdownエクスポートの生値は現状維持（後方互換のため）。
2. **Phase 2（判断が必要）**: `BenchmarkView.jsx`のモデル候補フィルタ（`.tess.json`/`.ocr.json`）をRegistry駆動にするかどうかは、Registryへ`fileExtensions`相当のフィールドを追加するかの判断とセットで決定する（本ドキュメントでは判断しない）。
3. **対象外のまま維持**: `selectedEngines`のvariant key構造、`engine_key`ランタイム識別子、Leaderboard/比較ロジック（いずれもBenchmark固有概念、または既に汎用化済みのためRegistry化の必要なし）。
4. TrOCR対応はBackend（Epic #27）の`ENGINE_CATALOG`拡張が前提条件であり、本Epic（#46）側の対応は不要（7章）。

## 10. Scope外

- Engine Registry（`engineRegistry.js`）の変更
- `BenchmarkView.jsx`/`BenchmarkCenterView.jsx`の実装変更
- TrOCR追加（Backend・Frontendとも）
- Evaluation画面（`OcrEvaluationView.jsx`）の変更
- Backend変更（`ENGINE_CATALOG`拡張を含む）
- CSS変更
