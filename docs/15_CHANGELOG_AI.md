# AI仕様変更履歴

Gitコミットログではなく、**「なぜ現在の仕様になっているか」**をAIエージェント向けに整理した履歴。
根拠は各コミット（ハッシュ併記）・`CHANGELOG.md`・`docs/13_QA_STATUS.md`。

```mermaid
timeline
    title 2026-07 の主要な仕様確立
    07-07〜08 : Tesseract統合・charset仕様確定 : 削除系の安全ガード強化
    07-09〜10 : ラベル編集/OCR修正の作業導線刷新 : マルチモデル比較
    07-13 : ダッシュボード刷新 : YOLO検出前処理と元画像クロップ : 仮想スクロール+サムネイルAPI
    07-14 : 照明ムラ補正・手動マスク補正 : 小文字制御・OCR候補辞書
```

---

## 2026-07

### モデル比較のモデル識別色（固定3色）

**概要**
比較中の各モデルへ表示順で固定色を割り当て（1番目=ブルー#60a5fa / 2番目=オレンジ#fb923c / 3番目=パープル#c084fc）、凡例・推奨モデルの管理No・主要指標カードの上端アクセント線＋管理No・テーブル列ヘッダー・混同比較のラベル＋横棒・指標別結果のモデル名（同率併記も各自の色）・総合勝利数のラベル＋横棒へ統一適用した。色は `lib/modelCompare.js` の `COMPARE_MODEL_COLORS` / `compareModelColor(index)` / `buildCompareColorMap(models)` に集約し、各セクションは同じマップを共有する（コンポーネントへのハードコード禁止）。

**変更理由**
全セクションで管理Noが同色だったため、主要指標カード・混同棒グラフ・総合勝利数の対応関係を目で追う必要があった。固定色でセクション間の対応を一目で分かるようにした。

**注意事項**
- **色は管理Noへ永続保存しない**。現在の比較配列（表示順）に対する割り当てで、同一セッション内は同一入力→同一出力のため再描画でも不変。比較対象を入れ替えたら表示順で再割り当てされる
- **モデル識別色と評価結果の良否色（最良=緑/悪化=赤/改善=緑）は役割を分離**。指標値そのものの色は従来を維持し、総合勝利数の最多も棒を緑にせず「最多」ラベルで示す
- 色覚差対応: 色だけに依存せず、管理No表示・表示順・棒グラフ左のラベル・カードのアクセント線を必ず併用する

**影響範囲**
`lib/modelCompare.js`（COMPARE_MODEL_COLORS/compareModelColor/buildCompareColorMap）、`ModelsView.jsx`（renderCompare）、`frontend/tests/modelCompare.test.mjs`

---

### モデル比較の「比較ダッシュボード」化と同率最良ルールの変更

**概要**
モデル比較パネルを「読む比較表」から「見る比較ダッシュボード」へ再設計。固定領域（評価条件不一致の警告 → 推奨モデル=管理No主体＋理由チップ → 主要3指標カード=CER/文字正解率/完全一致率を22px太字＋**最良との差分**（最良=「最良」、劣る側=`+1.9pt`等））＋スクロール領域（改善・悪化比較 → 評価条件 → 混同比較=**横棒グラフ・合計降順・TOP8/全件展開** → 指標別結果 → 総合勝利数=横棒 → モデル詳細情報=初期折り畳み）の2層構成。**同率最良の扱いを変更**: 従来の「タイ=勝者なし」をやめ、`buildWinLoss` は同率最良の全モデルを winners へ併記し**各モデルへ1勝ずつ**与える（推奨モデル判定はこの勝利数を使用）。最良値の表現もセル全体の緑背景からエメラルド文字＋小「最良」表示へ変更。

**変更理由**
文字が小さく表が密集し、どのモデルを採用すべきかの判断に時間がかかっていた。数値の重要度に応じた文字サイズ（主要数値22px＞値15px＞ラベル13px）、最良との差分の明示、混同の棒グラフ化で「見て判断」できるようにした。同率最良を「勝者なし」にすると実際には最良のモデルが指標別結果から消えて誤解を招くため、併記＋各1勝ルールへ統一した（`frontend/tests/modelCompare.test.mjs` にテストあり）。評価条件が異なる比較は誤判断のもとのため、警告を最上部へ出す。

**注意事項**
- API変更なし（既存のlocalStorage評価履歴のみで動作）。旧履歴（CER・混同なし）は「未記録」「—」表示、管理No未付与は短縮名フォールバック
- 狭い幅では主要3指標カードを**縦積みにせず横スクロールの3列比較**にする（固定領域の高さを一定に保ち、下の詳細分析の最低高150pxを確保するため）
- `buildWinLoss` の `winner`（単独最良時のみ設定）は後方互換のため残している。新規UIは `winners` 配列を使うこと

**影響範囲**
`lib/modelCompare.js`（`buildWinLoss`勝利ルール変更 / `formatBestDiff` / `buildConditionComparison` 新規 / `buildConfusionComparison` にtotal・Infinity対応）、`ModelsView.jsx`（renderCompare全面刷新）、`lib/helpTexts.js`（CER相対改善率・混同比較を追加）、`frontend/tests/modelCompare.test.mjs`

---

### モデルカルテの「数字主役ダッシュボード」化と共通InfoTooltip

**概要**
モデルカルテを「①最新評価（CER=32pxエメラルドの最大表示）→②評価サマリー（改善/同等/悪化＋完全一致の増減をカード化・数字をラベルより大きく）→③混同TOP5（縦2行チップ）→④評価条件→⑤モデル情報→⑥評価履歴」の順へ再構成。④⑤はラベル13px/値15px太字のメリハリ、セクション見出し16px、余白を拡大（space-y-3・px-3 py-3）。**カルテからBest CER/Best Char Acc/Best Accuracy/Recommended等の比較バッジを削除**（一覧・比較画面のみ表示）。専門用語（CER・文字正解率・完全一致率・CER改善・改善/同等/悪化・混同・Iteration・ベースモデル・Whitelist・OCR前処理）へ**?ヘルプアイコン**を追加した。

**変更理由**
情報量は十分だが文字が小さく全項目が同じ重要度で並び、モデルの状態を瞬時に把握できなかった。情報量は減らさず優先順位（良いのか→なぜ→条件→素性→履歴）で読めるレイアウトへ変更。カルテは**このモデル自身の状態だけ**を示す画面であり、順位・Best・Recommended等の「他モデルとの比較で意味を持つ情報」は比較画面へ集約する——という役割分担を明確化した。

**注意事項**
- ツールチップは共通コンポーネント `components/InfoTooltip.jsx`（ホバー=CSS group-hover / クリック=state・外側クリックで閉じる）。**説明文は `lib/helpTexts.js` の `HELP_TEXTS` へ集約**し、追加・修正はこのファイルだけで行う
- CER改善・改善/同等/悪化の比較対象は**学習前（ベースモデル）**（前回評価ではない）。ヘルプ文言もその意味で記載している
- 旧形式の評価履歴（CER等未記録）は従来どおり「未記録」フォールバック。CER未記録時の最大表示は完全一致率で代替

**影響範囲**
`ModelsView.jsx`（renderDetail・SpecRow/SectionTitle/SummaryStatCard）、`components/InfoTooltip.jsx`（新規）、`lib/helpTexts.js`（新規）

---

### モデル管理No（M0001形式）の導入

**概要**
全モデルへ管理No（`model_id`: M0001, M0002, ...）を追加。採番は**モデル作成日時順・OCR Crafter全体（全プロジェクト横断）で一意・削除後も再利用しない**。登録簿は `data/model_ids.json`（`{"counter": n, "models": {"<project_id>/<モデル名>": "M0001"}}`）で、`list_model_infos`（`/models/info`）の呼び出し時に未登録モデルを作成日時順で一括採番する（既存モデルの初回移行も同じ経路・後方互換）。UIはモデル一覧（名前の左）・モデルカルテ（名前の横＋モデル情報欄）・モデル比較（列ヘッダー/推奨モデル/勝敗表/勝利数を管理No主体、ファイル名はツールチップとカード下部の補助表示）・検索（管理Noでも部分一致）・評価CSV（`model_id` 列）へ反映。

**変更理由**
`tess_20260715_130148.tess.json` のような長いファイル名が比較テーブルの列幅を潰し、どのモデルか判別しづらかった。短く安定した識別子を人間の参照用に導入した（ファイル名・エイリアスは従来どおり保持。管理Noは表示・検索用でありモデル解決・推論には使わない）。

**注意事項**
- 登録簿からエントリを削除しないこと（削除済みモデルの番号が別モデルへ再利用されてしまう）
- 採番はサーバー側のみで行う（フロントで生成しない）。`model_id` 未付与（旧レスポンス・ベース疑似モデル eng 等）はUI側で従来表示へフォールバックし、評価CSVでは空欄
- テストでは `PROJECTS_DIR` の親（=一時data root）へ登録簿が書かれるため実データを汚さない

**影響範囲**
`model_registry.py`（`assign_model_ids` / `list_model_infos`）、ModelsView、`lib/modelEval.js`（`matchesModelSearch`）、App.jsx（評価CSV）、`tests/test_model_ids.py`

---

### YOLO検出前処理追加（4b1a212）

**概要**
学習画像作成のYOLO検出の直前にのみ適用する前処理（回転・クロップ・リサイズ・明るさ等）を追加。`src/app/services/detection_preprocess.py` として **OCR前処理（`preprocess.py`）から完全に独立**したモジュールで実装。

**変更理由**
検出対象（チューブ全体の写真）とOCR対象（切り出した文字列画像）では前処理の要件が異なるため。OCR前処理（二値化等）を検出に流用すると検出精度が落ち、逆に検出用の調整をOCR側へ混ぜると学習入力が変わってしまう。

**注意事項**
設定の保存も別（localStorage `ocr_detection_preprocess_by_project_v1`）。**両者の設定・保存・処理系を共有してはならない。**

**影響範囲**
`/image-builder/*` API、TrainingImageBuilderView、`detection_preprocess.py`、`tests/test_detection_bbox_inversion.py`

---

### 学習画像は元画像から切り出す仕様（a150ce4）

**概要**
Step4のクロップ出力は、検出前処理後の画像ではなく**元画像**から切り出す。検出時のBBox座標は `invert_detection_bbox`（リサイズ逆変換→クロップオフセット復元→回転逆変換→クランプ）で元画像座標へ逆変換する。

**変更理由**
検出前処理（縮小・明るさ変更等）を経た画像を学習画像として保存すると、解像度・色情報が劣化した画像で学習することになるため。検出前処理はあくまで「検出のための一時加工」に限定した。

**注意事項**
座標の丸め誤差を防ぐため、適用側と逆変換側は同一の `detection_preprocess_geometry` を共有している。逆変換に失敗するBBoxは `skipped_invalid_bbox` として報告しスキップする。

**影響範囲**
`training_image_builder.py`（`export_selected_crops`）、`detection_preprocess.py`

---

### Bounding Box Undo / Redo・Tab移動（5739c54）

**概要**
Step3のBBox編集に Undo/Redo と、Tabキーによる次BBoxへのフォーカス移動を追加。

**変更理由**
BBoxの誤削除・誤移動からの復帰手段がなく、大量のBBoxを1つずつマウス選択する操作が非効率だったため。キーボード中心の高速編集を可能にした。

**注意事項**
Undo/Redo はBBox編集操作を対象とした画面内履歴（ブラウザのUndoとは独立）。

**影響範囲**
TrainingImageBuilderView（Step3）

---

### Bounding Box編集仕様変更: 選択と有効/無効の分離（63e8637、d5c7936）

**概要**
Step3で「BBoxの選択（編集対象にする）」と「有効/無効（出力対象にするか）」を分離。**有効/無効の切替は一覧右端のチェックボックスのみ**で行い、画像クリックでは変更しない。画像上のCtrl+スクロール拡大縮小はカーソルが画像上にある場合のみ動作（d5c7936）。

**変更理由**
画像クリックで有効/無効がトグルされる旧仕様では、編集のためにクリックしただけで出力対象が意図せず変わる誤操作が発生したため。「Step3は編集画面」という位置づけを明確化し、移動・サイズ変更・追加・削除は編集モードON時のみ許可する。

**注意事項**
この操作体系（クリック=選択、チェックボックス=有効/無効）を崩す変更は禁止。

**影響範囲**
TrainingImageBuilderView(Step3)

---

### OCR候補辞書（ec3ada8 → e3ed703 で配置変更）

**概要**
ユーザーが用意した1行1候補のテキストファイル（正解候補一覧）から、OCR結果に近い文字列を上位3件（設定可）提示しクリック採用できる機能。混同文字（O↔0, B↔8等=コスト0.4）・大小文字差（0.2）を軽くした重み付きLevenshtein距離＋末尾suffix（kt/lt等）加点で順位付け。

**変更理由**
OCR結果が完全一致しない場合の手入力を減らすため。辞書は学習・推論内部へは注入せず「推論後の補助表示」に限定（OCRエンジンの挙動を変えないため）。localStorageへプロジェクト別保存とし、ブラウザではローカルファイルパスを永続参照できない制約に対応した。
当初は前処理設定画面に配置したが、**ラベル編集時に使う機能なのに別画面へ移動して最下部までスクロールする導線が悪い**ため、ラベル編集画面右サイドバーへ移設した（e3ed703）。

**注意事項**
純関数として `frontend/src/lib/candidateDictionary.js` に実装（将来のバッチ推論流用を想定）。設定UIは2箇所に置かない（設定元はラベル編集のみ）。

**影響範囲**
LabelingView、`lib/candidateDictionary.js`、`frontend/tests/candidateDictionary.test.mjs`

---

### OCR小文字制御（51fdfcd）

**概要**
EasyOCR/PaddleOCRの推論に「小文字を出力に含める」設定（`include_lowercase`、既定ON）を追加。EasyOCRは `readtext(allowlist=...)` でエンジン側制限、PaddleOCR 3.5 は**実行時whitelistが存在しない**ため出力後の英字大文字化（削除ではなく変換、長さ維持）で実現。

**変更理由**
同じ外国語モデルでも案件により「大文字英数字のみ（CHYB12）」と「小文字混在（CHYBkt）」の両方が必要なため。ラテン文字言語のみ適用し、日本語等には英数字allowlistを適用しない（誤った制限を防ぐ）。従来はvalidation層が常に大文字化していたため、ON時は検証も大小文字保持（`text_case="keep"`）へ拡張した。

**注意事項**
Tesseractは既存charset/whitelist仕様の対象外。API未指定時は `true`（後方互換）。

**影響範囲**
`predict.py`、`services/latin_case.py`、`services/ocr_pipeline.py`（validate_ocr_result）、全推論API、前処理設定/ラベル編集/推論/OCR修正/バッチ推論の各画面、`tests/test_lowercase_control.py`

---

### 仮想スクロール（56e6997）

**概要**
画像取込み画面の一覧/カード表示を `@tanstack/react-virtual` で仮想化し、`GET /images` にページング（offset/limit/検索/未ラベルフィルタ）を追加。

**変更理由**
1000枚超の画像でDOMが数千ノードになり一覧がフリーズ気味だったため。表示範囲のみレンダリングして初期表示と切替を高速化した（1000枚プロジェクトで一覧API 72msを実測記録）。

**注意事項**
仮想スクロール・React.memo・Lazy Load は性能の前提。見た目変更時もこれらの仕組みを変更しないこと（82226b8 のカードUI改善もこの制約下で実施）。

**影響範囲**
ImagesView、`GET /images`

---

### サムネイルAPI（56e6997 → 80ca9e4 で修正）

**概要**
`GET /images/{name}/thumbnail` を追加。元画像のmtimeをキーにしたディスクキャッシュで縮小画像（数百バイト〜）を返す。フロントは `<img loading="lazy">` の直接参照。

**変更理由**
一覧でフル解像度画像を読むと帯域・デコード負荷が大きいため。初回29ms/キャッシュ後21ms・784B程度を実測。
当初フロントに自前の同時リクエスト制限（セマフォ）を実装したが、**React StrictModeの二重マウントでスロットが解放されず全サムネイルが0件になる障害**が発生。自前制御を廃止し、ブラウザの接続管理に任せる方式へ変更した（80ca9e4）。これが現在「直接 img src + lazy」の理由。

**注意事項**
回転時は対象画像のみ `imageVersions[name]` でキャッシュキーを進める（全件再取得しない）。フロント側に同時リクエスト制御を再実装しないこと。

**影響範囲**
`main.py`（thumbnailエンドポイント）、ImagesView、`tests/test_thumbnail_api.py`

---

### 手動マスク補正（2f15b09 → e86d5b7 で操作改善）

**概要**
OCR前処理に、画像上の不要な黒塊・影を矩形ドラッグまたは黒領域ポイントクリック（scipy 8近傍連結成分）で指定し、白/周辺背景色で塗りつぶす機能。マスクは画像単位で `annotations/manual_masks.json` にサーバー保存（矩形=正規化座標、領域=行RLE）。

**変更理由**
照明ムラ補正後も残る局所的な黒ブロックが誤認識の原因になるため。**影の位置は画像ごとに異なる**ためプロジェクト共通ではなく画像単位保存とし、正規化座標でリサイズ・表示倍率に依存しない設計にした。文字誤削除を防ぐため、候補は必ずプレビュー＋明示確定（自動確定しない）、25%超は警告。
既定方式は当初「矩形」だったが、実運用では黒塊クリックの方が速いため「黒領域ポイント指定」を既定に変更し、Enter確定/Esc取消を追加した（e86d5b7）。

**注意事項**
元画像は変更しない。適用タイミングは二値化前/後を選択（白埋め=後、背景色埋め=前が推奨ペア）。マスクは学習へ注入しない。

**影響範囲**
`services/manual_mask.py`、`services/preprocess.py`（manual_mask_pre/post工程）、`settings.yaml` pipelines、PreprocessView/ManualMaskEditor、`tests/test_manual_mask.py`

---

### 照明ムラ補正（194c094）

**概要**
前処理のグレースケール直後に照明ムラ補正工程（`illumination`）を追加。方式は Gaussian背景補正 / Rolling Ball（形態学近似）/ Retinex の3種、背景サイズ・強度（元画像ブレンド）を調整可能。

**変更理由**
チューブ端の影・照明の偏りが二値化後に黒帯として残り、先頭ゴースト文字（例: `ASRJVZE`→実際は`SRJVLt`）の原因になっていたため。実画像比較で Gaussian が最も安定して影を除去できたことを確認して採用。cv2依存を増やさないため scipy ベースで実装。

**注意事項**
既存プロジェクトへ影響しないよう既定OFF。

**影響範囲**
`services/preprocess.py`、`settings.yaml`、PreprocessPanel、LabelingViewの前処理サマリ、`tests/test_illumination_correction.py`

---

### ダッシュボード刷新（f9d1882 → c76d233 → 97046b0）

**概要**
ダッシュボードを「プロジェクトランチャー」として再設計。プロジェクトのプレビュー画像・件数などのメトリクス表示（`_build_project_summary` が image_stage / updated_at 等を返す）と、続きから作業するためのクイックアクションを追加。

**変更理由**
複数プロジェクト運用時に「どのプロジェクトがどこまで進んでいるか」を開かずに判断できず、毎回プロジェクトを開いて確認する手間があったため。

**影響範囲**
DashboardView、`GET /projects`（summaries）

---

### OCR修正画面改善（7a4f051、7ef6e39 ほか）

**概要**
OCR修正（RapidOCR）画面をレビューフロー向けに再構成。中央=元画像→OCR候補→修正入力→文字別ヒートマップ→操作ボタンの縦動線、右=OCR情報（表示専用）+折り畳み推論設定、左=状態フィルタ付き画像一覧。キーボード中心（Enter確定/Shift+Enter保留/Ctrl+←→移動）。

**変更理由**
大量画像のOCR結果を「見て・直して・次へ」を最短で回すため。設定変更は例外的な操作なので折り畳みへ退避し、修正入力とヒートマップを常時見える位置に固定した。Tesseract選択時は大小文字を区別して扱う（`keepCase`。筆記体 k/l/t の修正・保存を可能にするため）。

**注意事項**
推論結果は画像×設定のキャッシュで再利用（同一画像の再推論を避ける）。修正確定は `POST /api/ocr/log/save` でログ保存され、OCRデータセット再生成（from_logs）の入力になる。

**影響範囲**
RapidOCRView、`/api/ocr/log/*`

---

### Tesseract Confidence の取得不能= null 扱い（fix: correct Tesseract confidence extraction and display）

**概要**
Tesseract の Confidence を「内部値 0.0〜1.0 / 取得不能= null / UI表示 `--`」へ統一。TSV解析（`parse_tsv_words`）と集約（`aggregate_word_confidences`、複数wordは文字数加重平均）を関数分離し、predict・評価・全画面へ null を伝播。

**変更理由**
ラベル編集のOCR候補で Tesseract だけ常に 0.0% になる不具合の修正。端から端まで実測した結果、抽出・変換・表示は正しく、**Tesseract 5.3.3 の LSTM が `tessedit_char_whitelist` 指定時に信頼度を計算せず生TSVの時点で conf=0.000000 を返す**ことが根本原因だった（whitelist無しでは 60.9 等の実値。TSV/hOCR・PSM・OEM・lstm_choice_mode を変えても同様）。本アプリのTesseract推論は常にwhitelistを使うため、この「偽の0」を本当の0%と区別して取得不能（null）として扱う。whitelist未指定時の conf=0 は実測値として 0.0 のまま保持する。

**注意事項**
数値を人工補正しない（最低50%化・倍率調整等は禁止）。whitelist無しで再推論した信頼度を元の認識結果へ混ぜない（設定不一致のため）。フロントの `confidence || 0` パターンは null を 0% に偽装するため禁止（`formatConfidencePercent` を使用）。

**影響範囲**
`tesseract_pipeline.py`（recognize_line の戻り値が `Optional[float]` に）、`predict.py`、`ocr_evaluation.py`、`lib/confidence.js`（新設）、LabelingView / RapidOCRView / InferenceView / OcrBatchView の表示、`tests/test_tesseract_confidence.py`

---

### OCR学習UIのジョブ状態連動と二重起動防止（fix: align OCR training UI with actual job state）

**概要**
学習画面をジョブ実態と一致させた。UI状態を7状態（idle/preparing/training/stopping/completed/failed/cancelled、日本語表示）へ整理し、主ボタンを状態連動化。実行中は設定をfieldsetで編集ロック。バックエンドは同一プロジェクトのアクティブジョブ存在時に開始APIを **409** で拒否し、`GET /api/ocr/train/active` で再読込時に実行中ジョブへ再接続する。ログは「サマリー＋重要イベント＋折り畳み詳細ログ（ターミナル形式）」へ再構成。

**変更理由**
学習実行中（lstmtraining起動済み）でも「次アクション: OCR学習開始」が有効表示され、二重起動の危険と現在状態の判断不能があったため。根本原因は「次アクション」ボタンが `ocrNextAction = dataset準備の有無` のみで決まりジョブ状態を見ていなかったこと。また生ログのカード表示は学習状況の把握に機能していなかった。進捗・ETAはTesseractの `At iteration a/b/c`（bが累積学習iteration）とログ時刻から算出し、根拠がない段階では表示しない（0%やダミーETAの偽装禁止）。

**注意事項**
バックエンドのジョブ状態値（queued/running/completed/failed/stopped）とDBスキーマは不変。runningでもiterationログ出現までは「学習準備中」と表示する。`stopping` はフロント側の停止要求中フラグで表現（バックエンドの中間状態は追加していない）。学習アルゴリズム・停止処理は無変更。
（同日修正: 旧変数 `statusText` の参照が左カード上部に1箇所残り `ReferenceError` で画面全体が消える不具合が発生。状態ラベルは `UI_TRAINING_STATE_LABELS` を唯一のソースとする `statusLabel` へ統一し、未知状態は「状態不明」表示＋console警告（idleへ偽装しない）。再発防止としてvite `ssrLoadModule` によるTrainingViewの状態別レンダリングテストと、画面単位のError Boundary（`ViewErrorBoundary`、1画面の例外でアプリ全体を消さない）を追加。）
（同日レイアウト再設計: 画面全体の横スクロール発生・左カラム潰れ・右カラムの巨大空白・重要イベントが読めない問題を修正。35%/65%カラム（1400px未満は縦積み）＋各カラム `min-w-0`＋ページ縦スクロールのみへ変更。左は「実行概要（日本語2列）→実行時設定（ジョブスナップショット・読み取り専用）→▶次回学習の設定（折り畳み）→実行操作」へ再構成し、完了ジョブ閲覧中に過去ジョブのログと現在の編集設定が混同されないよう分離。重要イベントは `summarizeEventText` で短い日本語種別＋詳細行の縦型タイムラインへ整形（生ログ・パスは詳細ログのみ）。進捗バーは状態色（完了=緑）。左右の状態重複表示は右サマリーへ集約。）
（同日高さ配分修正: ページ縦スクロール方式ではログ追加のたびに画面が揺れ、左設定が下へ伸び続けるため、デスクトップは表示領域高さへ固定し内部スクロールへ変更。スクロール対象は「次回学習の設定」「重要イベント」「詳細ログ」の3箇所のみで、実行操作はFlex末尾固定（position:fixed不使用）。詳細ログ開時は右ペイン内で高さ分割（約45%）し右カード全体を伸ばさない。重要イベントは最下部付近を見ている時のみ自動追従（過去ログ閲覧中は動かさない）。`tabular-nums`・`scrollbar-gutter: stable`・1行省略で数値/ログ更新による画面揺れを防止。開閉状態はReact stateで保持しポーリングで失われない。縦積み時はページ縦スクロールを許可。）
（同日ビューポート内封じ込め修正: 上記の初回実装で使った `calc(100vh - 175px)` の固定px差し引きは、タイトル行・ワークフロー・余白・倍率などで実際の差分が変わり実画面で高さが合わなかったため**廃止**。App の `main` をOCR学習画面表示中のみ `h-dvh` + flex-col + overflow-hidden とし、「タイトル行/ワークフロー=shrink-0 → section=flex-1 min-h-0 → 学習グリッド=flex-1 + `grid-rows-[minmax(0,1fr)]` → 左右カード=min-h-0+overflow-hidden」の**親Flex残り高さ継承**へ変更（html/body/#root は height:100% 済み）。また「次回学習の設定」「詳細ログ」の折り畳みは `<details>` をFlexコンテナ化していたが、ChromiumはdetailsのコンテンツをUAシャドウのスロットへ包むため本文へ高さが伝わらず内部スクロールが効かなかった——これが「設定内部がスクロールできない」根本原因。React state制御のアコーディオン（button＋Flex本文＋`hidden`切替。閉時も本文はマウント維持しスクロール位置・入力状態を保持）へ置換。内部スクロール3領域へ `overscroll-behavior: contain` を追加しホイールのページ伝播を防止。2カラム切替は1400px→**xl(1280px)** へ引き下げ（1366×768でも2カラム＋ページスクロールなしを保証。縦積みは幅不足時のみで高さ不足では発生しない）。低い画面で次回学習設定の高さを確保するため、実行時設定を折り畳み（初期閉・1行サマリー）、学習方式の固定表示は実行概要と重複するため切替可能なallモードのみ表示、作成済みデータ情報は1行省略表示へ短縮（情報自体は削除しない）。ヘッドレスブラウザ実測で 1920×1080 / 1366×768 とも documentElement.scrollHeight == clientHeight（ページスクロールなし）と各内部領域の scrollHeight > clientHeight（スクロール可）を確認済み。）
（同日導線改善: 旧構成「共通設定→1. データ準備」では、OCRタイプ（データ準備内）の変更で最大イテレーション（共通設定内）の名称・説明・扱いが変わるのに設定順が逆で、変更後に画面上部へ戻る必要があった。セクションを「学習設定（OCRタイプ/学習データ作成方法/演算デバイス）→プロジェクト設定（旧・共通設定）→データ準備（再学習オプション。新規作成時は説明文のみ）→エンジン固有設定」へ再編し、依存関係が上から下へ流れる導線にした。「共通設定」は内容が曖昧なため「プロジェクト設定」へ改名。セクション番号（1.〜のみ付番されていた不揃い）は分類ブランチ含め全廃し見出しのみとした。高さ制御・Flex構造・内部スクロール・状態管理は無変更。）
（同日プロジェクト設定調整: ①サイドバー表示時にデータ分割の3入力欄が横に潰れて値が読めなかったため、プロジェクト設定の2カラムを等幅→左3:右2（`minmax(0,3fr)_minmax(0,2fr)`）へ変更し、各入力へ `min-w-0` を追加。②データ分割の入力ステップを0.01→0.1へ変更（min 0/max 1）。スピナー・矢印キー操作で 0.30000000000000004 のような浮動小数点誤差が表示されないよう、`lib/ratio.js normalizeRatioInput` で状態更新時に小数第1位へ丸める（入力途中の"0."等は妨げない）。合計1.00の検証は厳密比較から許容誤差1e-4へ変更（0.7+0.2+0.1=0.9999…対策。`summarizeRatios` へ切り出しnode:testを追加）。③Tesseractの最大イテレーション既定値を30→1500へ（Fine-tuning向け。30はEpoch前提の値でTesseractのiterationとしては小さすぎた）。OCRタイプ切替時に「既定値のままの場合のみ」相互切替し、ユーザー変更済み・保存済みの値は上書きしない（charset既定切替と同じ方式）。PaddleOCR等のEpoch既定30は不変。補足説明も「1500はFine-tuning向けの初期値」へ更新。）
（同日フォーム視認性改善: 入力欄・セレクトの背景が `bg-card/80` でカード背景（#343b44）とほぼ同色になり、入力可能領域が判別できなかった。個別指定を増やさず共通クラス側を更新: `.app-input`/`.app-select` を「通常=slate-600/60背景＋slate-500枠 / hover=slate-400枠 / focus=シアン枠＋ring / disabled=暗背景・低コントラスト・not-allowed・opacity-70 / readOnly=disabledと区別し文字は通常どおり読める暗め背景」へ変更（`:read-only:not(:disabled)` はselectにも:read-onlyが一致するため.app-inputのみに適用）。`html { color-scheme: dark }` で数値スピナーとselectドロップダウンをダーク描画し視認可能に、チェックボックスは accent-color シアン。Button variant は secondary=明るめslate＋枠線（入力欄・カードと同化しない）、danger=赤枠＋暗赤背景（bg-red-900/40。破壊的操作を色で区別）へ変更し、primary（アクセント青）は維持。演算デバイスの選択式ボタンは未選択=slate-700/70背景の弱発光、無効=発光なしの暗背景で「未選択」と「無効」を区別。レイアウト・サイズ・フォームロジック・API値は無変更。共通クラス変更のため全画面のフォームに適用される（統一デザイン維持）。）
（2026-07-17 CER主指標への評価体系刷新とモデル比較ダッシュボード: 完全一致率（Accuracy）だけでは1文字違いも完全失敗となりモデル改善量を測れないため、CERを主指標に刷新（Accuracyは業務指標=「そのまま使える割合」として併記・廃止しない）。①【CER】`levenshtein_ops`（DP+バックトレースの純Python実装・追加依存なし）で編集距離とアラインメントを算出し、**CER=全画像の編集距離総和÷全画像の正解文字数総和のマイクロ平均**（画像ごとのCER平均は明示的に不採用。テストで平均値と異なることを検証）。文字正解率=1-CER。比較の正規化は完全一致評価と同じcase-sensitive・trimのみ。②【混同集計】アラインメント操作（置換 sub/脱落 del/挿入 ins）をCounter集計しTOP10を応答へ（脱落・挿入は∅表記で表示）。③【改善判定】comparisonで画像単位の編集距離を学習前と比較し改善/同等/悪化を集計、matchの遷移から完全一致へ改善/から悪化を集計。CER差=学習後-学習前（負=改善）・相対改善率=(学習前-学習後)/学習前。④【応答拡張】targets へ cer/cer_percent/char_accuracy/edit_distance_total/ref_length_total/confusions、comparison へ base_cer/trained_cer/cer_delta/cer_delta_pt/cer_relative_improvement/improved/unchanged/regressed/perfect_fixed/perfect_regressed、rows.results へ edit_distance/sub_count/del_count/ins_count を追加（既存フィールド不変=後方互換）。⑤【UI】評価結果カードをCER中心へ（CER学習前→後・文字正解率・完全一致率・CER改善pt/相対・改善/同等/悪化・完全一致増減＋混同ランキング）。評価履歴・モデルカルテ・モデル一覧もCER主表示（旧履歴=CER未記録はAccuracyフォールバック・「未記録」表示）。⑥【モデル比較刷新】`lib/modelCompare.js`: 9指標の比較テーブル（最良値緑ハイライト・CER/悪化系は最小が最良）・混同比較（旧形式はnull=−表示）・勝敗表（単独最良のみ勝者・タイは勝者なし）・🏆推奨モデル（勝利数最多→CER最小→文字正解率。**Accuracy単独で決めない**・理由表示）。⑦【バッジ6種】Best CER/Best Char Acc/Best Accuracy/Recommended（CER→文字正解率→Accuracy→悪化件数の優先順）/Latest Best（同一評価実行内の最良。実行単位判定のため履歴の評価日時を実行内で共有する形へ変更）/Baseline（🔵）。⑧【CSV】明細へ編集距離・置換/脱落/挿入件数・学習前比（improved/unchanged/regressed）、サマリへCER/文字正解率/編集距離総和、混同集計セクションを追加。⑨【履歴保存】cer/char_accuracy/cer_delta/cer_relative_improvement/improved/unchanged/regressed/perfect_fixed/perfect_regressed/confusions（TOP5）を追記（形式互換の追加。旧エントリは未記録表示）。）
（2026-07-17 モデル管理画面へ「モデルカルテ」を追加: モデル詳細がAccuracy表示のみで、評価画面へ遷移しないと性能差・評価条件が分からなかった。①【保存データ拡張】評価実行時にlocalStorage履歴エントリへ correct_count/total_count/misrecognized_count/improvement_rate（=comparison.improvement_rate×100・学習前比%）/improvement_count（=comparison.correct_delta・正解数の学習前との差分）/dataset（表示名）/whitelist（モード）を追記（既存のpercent/at/preは不変=形式互換の追加。ベースモデル側の改善系はnull）。旧形式エントリは `lib/modelEval.js` の正規化で欠損をnull化し「未記録」表示（エラーにしない）。②【モデルカルテ】モデル詳細を「モデル情報（学習画像数・モデルサイズを追加）→最新評価（認識率大表示＋バー・正解/総数・誤認識件数・改善率/改善件数）→評価条件（データセット・画像数・OCR前処理・Whitelist・評価日時）→評価履歴（残り高で内部スクロール・sticky header・前処理列付き）」の構成へ。上部は不足時のみ内部スクロール（flex 0 1 auto）で履歴がflex-1。③【一覧強化】評価列をAccuracy+正解/総数+改善率+評価日時の2行表示へ（一覧だけで比較可能）。④【推奨バッジ】評価履歴から自動判定（手動設定なし）: 🟢推奨=最新評価のAccuracyが評価済みモデル中最高 / 🏆Best Accuracy=全履歴の最高Accuracy保持 / 🔴ベースライン=eng系ベース名（predict.pyのエイリアスと対応）。⑤【モデルサイズ】`/models/info` へ `model_size_mb` を追加（tesseract=traineddata実体・分類=.ptのstat。実体なし/PaddleOCRはnull）。⑥ `formatSignedValue` はNumber(null)===0で"+0"になる罠を明示的なnullチェックで回避（テストが検出）。）
（2026-07-17 モデル評価画面の前処理追加とビューポート追従レイアウト: ①【評価前処理】従来の評価は `preprocess_ocr_image`（OCR入力整形）のみでStep5前処理は未適用だった。`POST /api/ocr/evaluate` へ `eval_preprocess`（グレースケール・二値化=なし/大津/固定しきい値）と `preprocess_source`（none/step5/custom）を追加し、**Step5と共通の `apply_eval_preprocess` を共用**（処理定義・型・バリデーションを複製しない。適用順もStep5と共通=元画像→評価前処理→OCR入力整形）。未指定・全設定OFFは従来動作（画像パスをそのまま渡す・応答互換）。評価データセットの回転は**作成時に画像へ焼き込み済み（構造A）**のため評価時は回転しない（二重回転防止・実装確認済み）。応答へ**サーバーが実際に適用した値**をechoし、結果表示・履歴はこの値を使う（UI選択中の値ではない=評価後に設定を変えても過去結果の表示条件は不変）。②【UI】OCR評価条件セクション（OCRプロファイル=前処理なし/Step5既定/カスタム・Step5同期チェック・使用中サマリー・詳細設定（上書き）アコーディオン=button+aria-expanded/aria-controls・Step5同期時は参照表示＋[上書きを有効化]）。「保存済みプロファイル」は該当する保存データが存在しないため実装していない（実データに基づく3択のみ）。アコーディオン内に小型プレビュー（サンプル選択＋手動[プレビュー更新]。バッチAPI slots=[] を流用）。③【履歴】localStorage履歴のエントリへ `pre: {source, summary}` を追加（形式互換の追記。旧履歴は「未記録」表示・エラーにしない）。履歴テーブルへ前処理列を追加（サマリー＋ツールチップ）。④【ビューポート追従】App fitViewportへocr-evalを追加（xl以上でページスクロールなし・左右カード下端が揃う）。左パネルは「上部=内部スクロール／下部=評価を実行＋履歴の固定表示」の二段構成（低い画面でも実行ボタンへ到達可能）、詳細設定（上書き）本文はmin-h 120px/max-h 40vhの内部スクロール。右パネルは誤認識一覧だけが残り高で伸縮する内部スクロール（thead sticky・縦横対応・列最小幅）。全内部スクロールへ `overscroll-behavior: contain`＋`scrollbar-gutter: stable`。xl未満は通常フロー（lg以上2カラム/未満縦積み）。1920×1080・1600×900・1366×768・1536×864（ズーム125%相当）・1080×1920（縦置き）で確認。⑤評価実行中はボタン下に状態表示＋アニメーションバー（評価APIが同期処理のため段階別進捗（前処理中n/N等）は未実装=既知の制約）。）
（2026-07-17 「保存して次へ」まで重くなる問題の調査と保存/OCR分離の徹底: 区間計測の結果、**サーバー側の保存はOCRの影響を受けていない**ことを確認した——保存API処理は実測10ms前後（保存関数単体5ms・payload約17KB/230枚。当初の500ms計測はWindows上のcurlプロセス起動オーバーヘッドで、`time_total`では10ms）。OCR3モデル連続実行中も保存は10〜17msで不変、OCR中のCPU使用率は32コアで約12%（飽和なし）。**保存経路はOCR専用Executor・in-flight・Futureを一切共有しない**（sync def=FastAPI標準スレッドプール・広域ロックなし・イベントループ上のfuture.result()なし）ことをコード確認し、「OCR専用Executorが遅い推論で満杯でも保存が200ms以内に完了する」回帰テストを追加。4条件マトリクス（workers 2/1×先読みON/OFF・12枚連続）では全条件でsave平均10〜11ms/最大15msと差がなく、OCRは**A（workers=2＋先読みON）が平均86msで最良**（B=648ms/C=335ms/D=765ms・3秒超は全条件0回）のため現構成を維持（先読みは既定ONのまま。in-flight共有とbusy破棄で二重実行は発生しない）。残る体感遅延への対策として、①Step5サムネイル（evaluation/crop・directory-image）を `Cache-Control: private, max-age=300` へ変更（rotationがURLに含まれるためキャッシュ安全。従来のno-cacheでは仮想一覧の行再マウントごとに再取得され、ブラウザの同一オリジン同時接続枠（HTTP/1.1で6本）を長時間のOCRリクエストと奪い合い、保存POSTが順番待ちになり得た——「OCR中だけ保存が遅い」症状のフロント側要因）②辞書候補の類似度計算をuseDeferredValueでOCR候補表示より低優先へ分離（クリック・入力の応答を優先）③保存中はボタンを「保存中...」表示にし、保存完了後はOCRを待たず即操作可能へ復帰（保存チェーンにOCR・プレビュー・先読みを含まないことを明確化）④切断チェックのタイムアウトを1.0s→0.2sへ短縮。最終実測（20枚連続・先読み並走）: save平均25ms/最大107ms・OCR平均65ms（先読みキャッシュヒット）/最大855ms・3秒超0回。）
（2026-07-17 連続作業時にOCRが周期的に重くなる問題の根本修正: 数枚ごとに数秒詰まる症状。【計測で特定した根本原因】バッチAPIが「リクエスト毎に `asyncio.to_thread`（無制限）＋リクエスト毎に新規ThreadPoolExecutor(2)生成」だったため、**同時推論数に上限がなく**、先読みと現在画像の二重実行・Abort済みリクエストの残骸（サーバー側は完走する）が数リクエスト重なると全推論がCPU競合で一斉に遅くなり（実測: 6同時要求で全件20.3〜21.1秒。単発なら約1秒）、掃けると再び軽くなる＝周期的なスパイクになっていた（32コア環境でtorch24スレッド×cv2 32スレッド×無制限並列）。【修正】①**プロセス共有の `_STEP5_OCR_EXECUTOR`（max_workers=2）**へ全スロット推論をsubmitし、リクエスト横断で同時推論数を2に制限（リクエスト毎のPool生成を廃止。torch/cv2のスレッド数自体は計測の上で変更せず=単発性能を維持）。②**in-flight共有**: 同一キャッシュキー（処理済み画像sha256+設定）の推論が実行中なら新規開始せず同じFutureを待つ（先読み×現在画像の二重実行を推論1回に統合。dict+Lockで管理し所有者が成功・失敗・キャンセルで必ず削除）。③**現在画像優先**: runOcr開始時に進行中の先読みをAbort。先読み要求（`prefetch=true`）はサーバー側で実行中/待機中のOCRがあれば破棄（skipped_busy）し、フロントも発火時に「同じ画像に留まっている・現在OCRが実行中でない・未キャッシュ」を再判定（`shouldPrefetchNext`。対象は常に次の1画像・連鎖禁止）。④**クライアント切断対応**: `request.is_disconnected()` を画像デコード前・各スロット実行前に確認し、切断済みなら未開始スロットを実行しない（キュー内Futureはキャンセル。実行中の推論のみ完走=最大2件）。⑤UIは待機（OCR待機中...）と推論中（OCR認識中...）を区別表示。【実測（修正前→後）】連続12枚（先読み並走）: 550〜1050msの二重実行揺れ→**1168〜1398msで一定・スパイクなし・重複推論ゼロ**。6同時要求: 全件20.3〜21.1秒（wall 21.7秒）→**1.3〜3.4秒の順次処理（wall 4.3秒）**。20枚連続処理でRSS 874MB一定（増加なし・LRUは文字列のみ保持）。in-flight共有・切断スキップ・先読み破棄・連続実行での残骸ゼロはpytestで回帰テスト化。）
（2026-07-17 Step5のOCRをラベル編集と同等速度へ改善し自動OCRを復活: 前回の性能対策（手動実行化・スロット逐次実行）でStep5のOCRがラベル編集より大幅に遅く（体感約7秒）、毎回ボタンを押す導線も不便だった。【経路比較で特定した原因】ラベル編集は `/preprocess/preview`（**sync def=FastAPIスレッドプール実行**）へ3スロットを3並行リクエストで投げるため実際に並列実行される（実測3モデルwall 825ms）。一方Step5のバッチは `async def`＋ブロッキング処理で**イベントループを塞ぎ**（他のプレビュー・一覧リクエストも後ろに並ぶ）、さらにスロットを**逐次実行**していたため3モデル合計時間の単純合算（実測: paddle171+tess299+easy527≒997ms＋前処理・通信。重いモデル構成では約7秒）になっていた。【修正】①バッチのスロット実行を**同時実行数2のThreadPoolExecutor**へ変更（スロット順にsubmit=paddle+tesseractが先行しeasyocrが後段。表示順・結果順はスロット順のまま。無制限並列はCPU競合のため2に制限）。実測: 3スロットwall 997ms→700ms・HTTP合計1036ms（ラベル編集3並行825msとほぼ同等・目標2秒以内）。②エンドポイントを `asyncio.to_thread` でワーカースレッド実行にし、イベントループを塞がない（ラベル編集と同等の並行性）。③**自動OCR復活（既定ON）**: 画像選択・前へ/次へ・保存して次へ・90°/180°回転・前処理/設定変更後に300msデバウンスで1回だけ自動実行。実行前に必ずフロントLRUキャッシュを確認しヒット時はAPIを呼ばない（`shouldAutoRunOcr`）。旧バージョンで明示的にOFF保存した設定は尊重（未保存=ON/false=OFF）。Step5初期表示でも1回実行。④保存して次へは「保存成功→移動→次画像の自動OCR」の順（移動によるrunKey変化が起点のため保存失敗時は移動もOCRも起きない）。⑤バッチ応答が画像も運ぶため自動OCR時はプレビュー単独リクエストを発行しない（反映済みプレビューキー `lastPreviewKeyRef` で重複取得を防止）。⑥現在画像のOCR完了後に表示一覧の次の1画像だけ**先読み**（自動ON・未キャッシュ時のみ・include_images=falseで転送削減・結果はキャッシュ投入のみでUI不変）。⑦`timings`（preprocess_ms/slots_wall_ms）と行別`elapsed_ms`をバッチ応答へ追加（性能調査用）。並列性はモック推論の開始/終了時刻で回帰テスト（2件目が1件目の終了前に開始・3件目は最初の完了後=同時2）。実測比較（cursive・ウォーム）: 1モデル Step5 421ms ≒ ラベル編集433ms / 3モデル Step5 1036ms ≒ ラベル編集825ms（差はStep5の並列度2制限による意図的なもの）/ キャッシュヒット358ms。）
（2026-07-17 Step5の性能改善（OCRワークフロー最適化）: Step5の3モデルOCR追加後にアプリ全体の操作が重くなった問題の計測・修正。【計測で特定した根本原因】①画像切替・回転・前処理変更・設定変更の**たびに**最大3モデルのOCRが自動実行されていた（1回の操作で3リクエスト・実測約1.5秒のCPU推論。連続操作でリクエストが積み上がる）②3リクエストそれぞれで同じ画像のデコード・回転・Step5前処理・共通前処理・中間/最終画像のbase64生成を繰り返し、同一のdata URLを3通信分転送していた③同一画像・同一設定へ戻っても毎回再計算（結果キャッシュなし）④一覧行のmemoが `state={itemState[key] || {}}`（毎レンダー新オブジェクト）とインラインのonToggleCheckedで無効化されており、ラベル1文字入力ごとに表示中の全行が再描画されていた。【修正】①**OCR自動実行を廃止（既定）**: 変更時は候補を「要再実行」表示にするだけで、[OCR再実行]押下時のみ推論。「画像・設定変更後にOCRを自動実行」（既定OFF・`autoRun`として `ocr_eval_preview_slots_by_project_v1` へ保存）をONにした場合も連続操作終了後（300msデバウンス）に1回だけ。②**プレビューとOCR推論を分離**: 新API `POST /api/ocr/preview-file/batch`（`slots_json=[]`でプレビューのみ）。前処理変更・回転・画像切替は中間/最終画像のプレビューだけ非同期更新し、OCRは実行しない。③**前処理1回＋複数モデル**: バッチAPIで画像デコード〜base64生成を1回だけ行い全スロットで共有。スロットは番号順に**逐次実行（同時実行数1）**としCPUエンジン（Tesseract/EasyOCR CPU）同士の競合を回避（表示順=計算順=スロット順）。④**OCR結果キャッシュ**: サーバー側は「処理済み画像sha256（元画像・回転・全前処理を反映）＋engine/model/language/小文字/PSM/whitelist」キーのプロセス内LRU（128件・エラーはキャッシュしない）。フロント側は実行条件キーのLRU（30件）で、同一条件へ戻ると即表示。作成画像・CSVには無関係（OCR候補プレビュー専用）。⑤**base64重複削減**: バッチ応答は中間/最終画像をトップレベルに1回だけ含め、スロット結果はprediction/confidence/engine/model_name/errorのみ。フロントもpreviewImagesとocrResultsを分離保持。⑥**再レンダリング削減**: 一覧行へ渡すstateを共有の凍結空オブジェクトに、チェック切替をuseCallbackへ安定化し、ラベル入力・OCR更新・設定変更で対象行以外が再描画されないようにした。⑦**editing_state保存最適化**: 保存内容はラベル・回転・評価対象・現在画像・フィルタ・データセット名・取得方法のみ（OCR候補・base64・ローディング状態は保存しない）。直前保存とJSON差分がなければ書き込みしない。⑧**キャンセル**: プレビュー・OCRともAbortControllerで旧リクエストを中止（画像移動・再変更・実行中の画像移動）。サーバー側で開始済みの推論は中断不可だが同時実行1のため影響は限定的（既知の制約に記載）。【実測（cursive・ウォーム）】3モデルOCR: 修正前 約1550ms×操作のたび → 修正後 手動時のみ1251ms・同一条件再実行518ms（キャッシュ）。前処理変更/回転/画像切替1回: 修正前3リクエスト（OCR3回）→ 修正後1リクエスト（プレビューのみ・OCR0回・約550ms）。画像10件連続切替のOCR実行数: 30回→0回。EasyOCRの入力アレイ化（cv2.imreadパッチ回避）は維持。）
（2026-07-17 Step5追加改善（OCR専用前処理・最大3モデル比較・回転導線）: ①【Step5専用OCR前処理】グレースケール・二値化を右パネル「評価データOCR前処理」（評価画像情報と評価データOCR設定の間）へ追加。**OCR候補生成用の推論入力にのみ適用し、評価用データセットのimages/・ground_truth.csv・metadata・Step4画像・フォルダ元画像へは一切反映しない**（適用箇所は `/api/ocr/preview-file` の `eval_preprocess_json` のみで、データセット作成処理とは完全に無関係=構造的に混入しない）。処理順は「回転後の評価画像→Step5専用前処理→プロジェクト共通OCR前処理→推論」で、中間・最終画像プレビューへ即時反映される。実装は既存共通処理 `_op_grayscale`/`_op_threshold`（大津=cv2/np共通・固定しきい値）を再利用する `apply_eval_preprocess` アダプター（アルゴリズム複製なし）。二値化ONはグレースケールOFFでも内部でグレー変換する（UIのグレースケールONとは別概念）。既定=全OFF・大津・127。保存は `ocr_eval_preprocess_settings_by_project_v1`（プロジェクト共通OCR前処理・YOLO検出前処理・OCRモデル設定と混在させない）。②【最大3モデル比較】Step5専用OCR設定を3スロット化（各スロット: 有効/Engine/Model/Language/小文字/Tesseract PSM/whitelist。エンジンに無い設定は非表示・実効設定は既定値へ正規化）。保存は `ocr_eval_preview_slots_by_project_v1`、旧単一キーは読み込み時にモデル1へ自動移行（旧キーは温存）。実行はスロット番号順を維持（Confidence順へ並べ替えない）・重複設定は拡張 `predictSignature`（+PSM/whitelist。未指定=空扱いで既存ラベル編集の判定と互換）でスキップ表示・1件失敗しても他スロットは表示（行単位エラー）。Esc=スロット順で最初に成功した候補。辞書候補は全スロット結果を入力に既存ロジックで統合。preview-file APIへ `psm`（Tesseract。未指定=7）と `whitelist`（Tesseract=whitelist・検証charsetも追従 / EasyOCR=allowlist上書き）を追加（未指定=従来動作）。③【回転導線】回転ボタンを右パネルからOCR候補見出し行（[↻90°][↺180°][OCR再実行]）へ移動し、「画像確認→回転→候補更新→採用」を1視線範囲で完結。右パネルは現在角度の表示のみ残す。回転は300msデバウンスで自動再実行し、連打時はcancelledガードで最後の回転状態だけを反映（ラベル入力値保持）。押下時は300msの発光フィードバック（90°=青/180°=紫）。前回実装のビューポート内固定は維持（右パネル中段=内部スクロール・下部作成ボタン=常時表示。1920×1080/1600×900/1366×768で確認）。）
（2026-07-17 EasyOCR「too many values to unpack (expected 2)」の根本修正: Step5・ラベル編集のOCR候補でEasyOCRだけが継続失敗する不具合。根本原因は**ultralytics（YOLO検出）がWindowsで `cv2.imread` をグローバルにモンキーパッチ**し（`ultralytics/utils/__init__.py`、非ASCIIパス対応目的）、その実装が「グレースケール指定でも常に3次元 (H,W,1) を返す」（`im[..., None] if im.ndim == 2`）こと。easyocrはパス入力時に内部で `cv2.imread(path, IMREAD_GRAYSCALE)` を使い2次元を前提とするため、**サーバープロセスで一度でもYOLO検出を実行する（=ultralyticsが遅延importされる）と以後のEasyOCRが必ず** `get_image_list` の `maximum_y, maximum_x = img.shape` で失敗していた。単発の再現が困難だったのはultralyticsのimportが遅延（初回検出時）でプロセス状態に依存するため。修正は `_run_easyocr` で**readtextへパスではなく自前読込の2次元グレースケールnumpy配列を渡す**（easyocrのnumpy分岐は次元を正しく処理し、認識入力は従来のグレースケール読込と同一。cv2.imreadパッチの有無・順序に依存しなくなり、cv2.imreadが非ASCIIパスでNoneを返す潜在問題も回避）。ultralytics側のパッチ解除は同パッチに依存するYOLO側の挙動を変えるため行わない。PaddleOCR/Tesseractはcv2.imreadに依存せず無影響。回帰テストはダミーReaderでreadtext入力が2次元ndarrayであることを検証。）
（2026-07-17 Step5のUI・OCR設定改善: ①【Step5専用OCR設定】OCR候補の設定がラベル編集（前処理画面の推論設定）と共有で、片方の変更が他方へ影響していた。Step5専用の設定（Engine=PaddleOCR/Tesseract/EasyOCR・Model・Language・小文字トグル）を右パネルへ追加し、localStorage `ocr_eval_preview_settings_by_project_v1`（プロジェクト別・新キー）へ保存して完全独立させた（`lib/evalOcrSettings.js`。stateは入力途中の値を保持し正規化は保存時とリクエスト生成時のみ=空欄が即既定値へ戻らない）。前処理はプロジェクト共通のOCR前処理設定を引き続き適用（エンジン設定のみ独立）。比較スロット（モデル2/3）は前処理画面の共有設定に依存するためStep5からは外し、Step5専用設定の1候補＋辞書候補構成へ変更。②【ビューポート内固定】ページ全体スクロールを廃止（App fitViewportへstep5を追加。xl未満は従来の高さ計算で互換）。スクロールは左一覧とOCR候補領域のみ。中央は「画像45%→OCR候補40%（grow）→入力欄=内容高さ」を固定pxでなくflex-basis割合で配分（最低高さのみガード）。右パネルは固定幅280px・内部のみスクロールで、データセット名・作成ボタン・Step4へ戻るは下部固定（常時見える）。③【画面揺れ防止】スクロール領域へ `scrollbar-gutter:stable`、OCR候補行エリアへ最小高さ、ボタン高さ固定（h-8統一）、カウンタはtabular-nums維持、長いパスはtruncate+title表示。1920×1080/1600×900/1366×768で全ゾーン表示とページスクロールなしを確認。）
（2026-07-16 評価データ作成の入力元拡張（Step5フォルダ取得モード）: Step5の評価画像を「Step4出力」に加えて「任意フォルダの画像」からも作成できるようにした。設計判断: ①取得方法はStep5上部のラジオで切替（Step4=従来動作のまま・フォルダ=追加機能）。一覧・件数集計・OCR候補・辞書候補・ショートカット・保存系は既存共通部品（`components/labeling/` と `filterEvalItems` 等の純ロジック）をアイテム形状を揃えて共用し、フォルダ画像のキーは予約接頭辞 `__dir__/<filename>` でStep4キー（`<export_id>/<filename>`）と衝突させない（editing_stateのitemsを両モードで共存保持でき、切替でラベルが消えない）。②フォルダ一覧は**フォルダ直下のみ**（サブフォルダ対象外・対応形式 PNG/JPG/JPEG/BMP/TIF/TIFF/WEBP=既存 `IMAGE_EXTENSIONS`）。プレビュー・OCR・作成の解決は `resolve_directory_image_path` でファイル名のパス区切り・非画像拡張子を拒否（任意パス読み出しへの拡大を防ぐ）。③任意画像はEXIF Orientation付きがあり得るため、読込時に**1回だけ** `exif_transpose` を適用（EXIF方針は既存Step2修正と同一）。作成時も評価パイプラインがEXIFを解釈しない前提で「回転またはEXIFありはPNG焼き込み・無回転かつEXIFなしはバイト等価コピー」とし、ブラウザ表示と評価入力の向きを一致させる。焼き込みで拡張子が変わるため出力名は `<元stem>.png`（衝突時は `_2` 連番）。④metadataへ `source: step4|directory` を追加し、directory時は `source_directory` も保存（従来の `training_image_builder` はstep4と同義。この値を読む処理は無く互換影響なし）。step4とdirectoryの混在作成はsourceが一意にならないため拒否。⑤editing_stateへ `sourceMode`/`directoryPath` を追加保存し、リロード時にフォルダ一覧を自動再取得して復元（旧state=キー無しはstep4で従来動作）。⑥フォルダ画像のOCR候補は `/api/ocr/preview-file` へ `source_directory`+`filename`+`rotation` 入力を追加して対応（前処理・推論は既存共通のまま）。）
（2026-07-16 評価データセットとモデル評価の統合（Phase3）: Step5で作成した評価データセットをモデル評価画面から直接選択できるようにし、手動パス指定を不要にした。設計判断: ①一覧は `GET /api/evaluation/datasets`（`evaluation/` 直下のmetadata.json由来・作成日時降順）。「手動指定」を選択肢に残し従来のパス指定と完全共存（image_dir/gt_csv入力はデータセット選択時のみ「詳細設定」へ折り畳み。既存の評価実行API・パラメータは不変）。②学習データ重複チェックは「評価データが学習に使われた画像を含むと精度が過大評価される」問題の警告用で、判定優先順位を sha256完全一致 → 元画像+BBoxID一致 → ファイル名一致 とした。回転焼き込みした評価画像はsha256が変わるため、学習画像sha→Step4マニフェスト逆引きで(元画像, bbox_id)を復元して照合する（Phase1でマニフェストを確定情報として保存した理由の1つ）。学習データの探索は `outputs/ocr_dataset/*/{train,val,test}`・上限2万ファイル・警告のみで評価はブロックしない。③評価結果へdataset_id/名前/枚数/作成日時を紐付け、履歴は既存localStorage `ocr_model_eval_history_by_project_v1` の形式を変えず（後方互換）、ラベル値のみデータセットID優先へ（手動指定時は従来どおりフォルダ名）。BCERは学習時メトリクスでモデル評価APIは算出しないため履歴はAccuracy表示。④削除は既存 `safe_rmtree`（allowed_roots=`evaluation/` のみ・ID形式検証でトラバーサル防止）でCSV・metadata・画像・editing_stateを一括削除。名前変更はディレクトリ改名+metadata内ID更新のみで、CSV・画像参照が相対のため壊れない（renameでCSVを読み戻す互換テストあり）。⑤Step5作成完了後の[モデル評価へ]は作成レスポンスのパスを直接渡して自動選択（一覧再取得の待ちに依存しない）。）
（2026-07-16 Step5への既存ラベル編集機能の共通化（Phase2）: 既存LabelingView（1470行・App密結合）を全面書き換えず、再利用可能な小単位へ段階的に切り出して両画面で共用した。共通化: `components/labeling/` に CandidateParts（DiffText・CandidateRow・CandidateMessageRow・DictionaryCandidatesSection・OcrRerunButton・StageImage・renderedImageWidth）/ LabelMainInput（幅追従38px入力欄＋配置切替。配置保存はストレージキーをパラメータ化し既存 `ocr_label_text_align_by_project_v1` とStep5用 `ocr_eval_label_text_align_by_project_v1` を分離）/ SoftKeyboardPanel / useLabelingShortcuts（Enter・Ctrl+S・Ctrl+←→・Esc・Alt+1〜5）、`lib/ocrCandidates.js`（engineLabelOf・lowercaseLabelOf・重複スロット判定predictSignature）。LabelingViewは同JSXの移設置換のみで挙動不変（ヘッドレス画面で回帰確認）。新API `POST /api/ocr/preview-file` は `/preprocess/preview` をコピーせず、前処理は新設 `preview_preprocess_image`（既存 `_process_image` 共通利用・raw非依存のため手動マスクなし）、推論は既存 `_attach_preview_prediction` を共通利用。入力はアップロード画像またはマニフェスト記載の評価候補（export_id+filename+rotation）のみで任意パス不可。Step5のOCR候補は「Step4クロップ（EXIF反映済）→ユーザー回転（サーバー適用）→OCR前処理→推論」の順で回転後画像を入力とし、回転・画像切替はデバウンスで自動再取得（古いレスポンスは破棄・ラベル値保持）。保存はStep5=評価用editing_state（master.csvへ書かない）で、保存して次へは既存 `decideNextImageIndex` を共通利用し「表示中（Series/未入力フィルタ適用後）の評価対象チェック済み一覧」基準（Series外へ移動しない・保存失敗時は移動しない）。OCR結果はeditng_stateへ保存せず再実行で復元（巨大state防止）。）
（2026-07-16 学習画像作成Step5「評価用データ作成」Phase1: モデル評価用の正解データ作成をStep4出力から行えるようにした。段階実装のPhase1で、OCR候補・辞書候補等の既存ラベル編集共通化はPhase2、モデル評価画面のデータセット選択はPhase3。設計判断: ①Step4出力と元画像・BBox・Seriesの対応関係は**出力時に確定情報としてマニフェスト保存**（`image_builder_exports/<export_id>/manifest.json`+state.json。出力フォルダにも複製。画像名からの推測をしない。project_id未指定の旧呼び出しは従来動作）。②評価データは学習データと完全分離（`evaluation/<dataset_id>/` へコピー。回転0/90/180/270は評価用コピーへのみ焼き込み、Step4学習画像はバイト不変をテストで担保。EXIFはStep4クロップ生成時に反映済みのため再解釈しない）。③CSVは既存モデル評価の読込仕様（`_read_gt_csv`: 1列目=画像名/2列目=正解・utf-8-sig・ヘッダー既知キースキップ・case-sensitive）へ**完全互換**で、生成CSVを実際に`_read_gt_csv`で読み戻す互換テストを追加。未入力ラベルがあると作成拒否（空文字をCSVへ出さない）。データセット名は英数字/-/_のみ・重複拒否・失敗時は不完全ディレクトリを残さない。④途中状態（ラベル・回転・評価対象・フィルタ・データセット名・現在画像）はlocalStorageではなくプロジェクト配下 `evaluation/editing_state.json` へ保存（画像単位の状態が多いため。2MB上限）。⑤一覧は@tanstack/react-virtualの仮想スクロール（既存依存）で1000件対応、行はmemo化し回転・入力は対象行のみ再描画（回転はURLパラメータでその場適用しサーバー側ファイルは不変）。⑥「保存して次へ」は既存の`decideNextImageIndex`を共通利用（未入力のみフィルタで1件飛ばさない）。）
（2026-07-16 Step2に検出対象Seriesの複数選択を追加: モデルの一部class（例: tubeのみ）だけを学習画像化したい場合に、検出後にStep3で手動削除する手間があった。①`GET /image-builder/yolo-models/classes` を新設（モデルのclass一覧。解決規則は検出APIと同一で未取得標準モデルは409・自動DLなし。モデル読込が発生するため解決パス＋更新時刻でプロセス内キャッシュ）。②Step2のモデル選択直下へチェックボックス群（すべて選択/すべて解除・多数時は内部スクロール・初期=全選択・モデル変更で新モデルのclass一覧へ入れ替え=旧選択破棄）。③detectへ `series_json` を追加し、推論後にclass名で絞り込み→ID振り直し（連番仕様維持）→重複統合。レスポンスへ `inference_count`（推論生検出数）/`series_filtered_count`/`selected_series` を追加し、サマリーで「推論検出数→Series絞込後→重複統合後」を区別表示。`raw_count` は統合前件数の後方互換キーとして維持（未指定時は従来と同値）。0件選択は検出実行を無効化＋API側も400。カスタムパス指定はclass一覧を事前取得できないためSeries絞り込み対象外（全class対象＝従来動作）。Step3見出しへ「検出Series」スナップショットを表示し、Step3には選択SeriesのBBoxのみが渡る。`series_json`未指定=完全に従来動作（後方互換）。実測: TrmRead×001.pngで未指定14件/tube指定1件/nmb指定13件/空配列400。）
（2026-07-16 Seriesフィルタ適用時の削除後自動選択の修正: Step3でSeriesフィルタ絞り込み中にBBoxを削除すると、削除後の自動選択が**全BBox配列**基準（`nextSelectionAfterDelete(detections, ...)`）だったため、一覧に表示されていない別SeriesのBBoxが選択され「一覧に無いのに編集パネル・画像だけ選択が切り替わる」不整合が起きていた。修正: ①自動選択の基準を**表示中の一覧**（`filteredDetections`）へ変更（`lib/bboxSelection.js` へ切り出しテスト追加。次の番号→無ければ前の番号→残0件なら選択解除。フィルタ外は選択しない）。②一覧クリックを画像クリックと同じ選択ロジック（`handleBoxSelect`＋`focusBboxCard`）へ統一。③Undo/Redoのスナップショットへ選択状態（selectedUiIds/focusedBboxId）を追加し、削除のUndoで削除前の選択状態まで復元（履歴形式は `{rows, selectedUiIds, focusedBboxId}`。セッション内stateのため互換影響なし）。④Series変更時は表示中BBoxのみへ選択・フォーカスを絞る（前Seriesの選択を持ち越さない）。）
（2026-07-16 Step3の作業特化レイアウトへの全面改修: Step3は最も長時間使う画面だが、画像よりUI情報量が多く・編集ボタンが一覧の全行に混在し・視線移動が大きかった。機能は変えずUIのみ再構成: ①画像領域を約78%へ拡大し、編集パネルは初期22%・ドラッグで18〜35%可変（`ocr_image_builder_step3_panel_v1` へ保存）。②xl以上はビューポート内固定（App fitViewportへstep3を追加）でページスクロールなし・スクロールは一覧のみ。ズーム100%は画像をビューポートへフィット表示（スクロールなしで最大表示。ビューポート実寸を測定してmax-width/height指定——wrapper w-maxとmax-width:100%の循環参照を避けるため）、ズーム操作時は従来の実寸×倍率。③既存機能のボタンを画像上部の横一列ツールバーへ移設（編集モード/Undo/Redo/コピー/貼り付け/追加=ダブルクリック追加と同一生成ロジックを中央座標で呼ぶ/すべて選択/選択解除/削除/？）。④一覧は「チェック＋#id＋色分けConfidence」のみへ簡素化（全行の編集/削除ボタンを廃止し、選択中パネルへ集約。行クリックで画像側と選択連動・画像クリックで一覧自動スクロール=従来のfocusBboxCardを維持）。⑤Confidence色分け（0.9緑/0.7水色/0.5黄/0.3オレンジ/未満赤。`confidenceToneClass`）。⑥操作説明は？ボタン開閉へ（初期閉）。⑦最下部に高さ固定のステータスバー（検出数/有効/無効/選択中/表示/ズーム/ファイル名。tabular-numsで揺れ防止）。※「画像 n/m」はこの画面が1画像単位のワークフローのため対象外。Undo/Redo・ショートカット・BBox編集・Step遷移などの既存機能・状態管理は無変更。）
（2026-07-16 Step2で画像が90°回転する不具合の修正: 根本原因はサーバー側の画像デコード（`_decode_image_bytes`）が**EXIF Orientationを無視**していたこと。Step1のプレビューはブラウザの`<img>`（object URL）でEXIFが自動適用され正しい向き、Step2以降はサーバー生成画像（resize-preview / detect の image_data_url）が生ピクセルのままで、スマホ縦撮り等のEXIF付き画像が90°倒れて表示されていた（Step1とStep2で画像取得経路が異なることが不一致の原因。ユーザーは検出前処理の回転ボタンで手動補正していた）。修正: デコード時に `ImageOps.exif_transpose` で**1回だけ**EXIFを反映し、以降のStep1〜4・YOLO検出・Step4クロップ（同じ`_decode_image_bytes`を使用）はすべて同じ向きのピクセル・座標系を使用（途中で再解釈しない）。YOLOへ渡る画像サイズもブラウザ表示と一致（実測: Orientation=6の640×320 JPEGがpreview/detectとも320×640）。検出前処理の回転は自動補正とは別のユーザー操作として維持（EXIF反映後の画像を基準に回転）。EXIFなし・Orientation=1の画像は従来と完全に同一動作（回帰テストで担保）。）
（2026-07-16 YOLOモデル取得経路の分離とStep1画像保持の修正: ①【画像解除バグ】Step1で選択した画像が「次へ」でStep2へ進むと解除される不具合の根本原因は、学習画像作成のStep1〜4が別view id（image-builder-step1〜4）で、画面単位ErrorBoundaryの `key={activeView}` によりStep遷移のたびにビュー全体が再マウントされ全state（選択画像・検出結果）が消えていたこと（ErrorBoundary導入時のリグレッション）。`viewBoundaryKey()` でStep1〜4を単一key "image-builder" へまとめ再マウントを防止。クリア条件を「別画像選択（旧検出結果もクリア）/ プロジェクト切替（全クリア）/ リサイズ設定変更（座標系が変わるため検出結果のみ）」に限定し、Step移動では維持。画像未保持時は検出ボタンを無反応にせず理由を表示。②【取得経路の分離】project/common/builtinを独立処理へ分離（`resolve_project_yolo_model` 等＋`resolve_yolo_model(model_source=...)`）。指定取得元の中だけで解決し暗黙フォールバック禁止（見つからない=404）。検出APIは `model_source` を受け取り実行中の外部通信（ultralytics自動ダウンロード）を廃止——未取得標準モデルは409。標準モデルは専用API `POST /image-builder/yolo-models/builtin/download`（許可リスト制・任意名/URL拒否・取得済み再DLなし・進行中409・不完全ファイル残さない）でのみ取得し、保存先は `models/yolo/builtin/`（旧自動DLのリポジトリ直下ファイルは取得済みとして互換認識）。UIは取得元ごとのoptgroup表示＋使用モデルカードに状態（取得済み/未取得）と[取得]ボタン（確認ダイアログ・取得中無効）。localStorage `ocr_image_builder_last_state_v1` へ `modelSource` を追加（既存フィールドの形式不変・旧データは自動補完）。）
（2026-07-16 YOLOモデル取得元と検出実行情報の明示: 復旧修正の仕上げとして、どのモデルが使われたかを利用者が一目で判断できるようにした。①yolo-modelsへ `models`（{name, source, path}。source=project/common/builtin、pathはリポジトリ相対でbuiltinはnull、同名はproject優先で重複表示なし）を追加、②detectレスポンスへ `model_name` / `model_source`（path/project/common/builtin）/ `inference_time_ms`（YOLO推論のみ）/ `total_time_ms`（デコード〜整形の全体）/ `preprocess_applied`（既存noop判定使用。設定が存在するだけではONにしない）を追加（既存キーは全て維持）、③Step2セレクトへ[プロジェクト/共通/標準]プレフィックス＋「使用モデル」情報カード（取得元・相対パス省略表示。絶対パスは常時表示せずTooltipのみ）、④検出成功後（0件含む）の結果サマリー（件数・処理時間・使用モデル・取得元・前処理ON/OFF。0件は正常完了と付記しエラー表示にしない。失敗時はサマリーを消し使用モデル付きエラーで区別）、⑤検出成功時のスナップショット（detectRunInfo）をstateへ保持しStep3見出し付近へ「検出モデル: 名前（取得元）」を表示——検出後にモデル選択を変更してもStep3表示は検出時点の値のまま。推論処理・BBOX形式・座標変換・Step3/Step4仕様・モデル解決順は不変。）
（2026-07-16 YOLO検出の復旧: 学習画像作成Step2で「検出が動作しない（0件）」不具合を修正。根本原因は複合: ①ユーザーの学習済みYOLOモデルを置いたリポジトリ直下 `models/yolo/` が一覧API・モデル名解決の検索対象外（プロジェクト内 `data/projects/<id>/models/yolo/` のみ）だった、②フロントが「保存済み選択が一覧に無い場合は黙って items[0]=汎用ビルトイン(yolo11n)へフォールバック」しており、COCO汎用モデルはチューブ画像で0件のため、エラーなしで「検出しない」ように見えた。修正: 共通 `models/yolo` を一覧・解決へ追加（`COMMON_YOLO_MODELS_DIR`。優先順=パス実在→プロジェクト内→共通→ultralytics自動解決、後方互換）、暗黙フォールバックを廃止し「（見つかりません）」表示＋警告＋検出実行時の明示エラーへ変更、モデル読込失敗は「YOLOモデルが見つかりません…」の明示メッセージ（0件との混同防止）、0件は「検出結果: 0件（正常終了）」表示、画像/プロジェクト切替後の古いレスポンスは連番ガードで破棄（正常レスポンスは破棄しない）。実測: TrmRead_yolo26s×tube_20260710で前処理OFF14件/ON19件、汎用yolo11nは同画像0件。）
（同日PaddleOCR学習パラメータのラベル日本語化: 「保存間隔（epoch）/ Train num_workers / Eval num_workers」の3列で長いラベルが折り返され、入力欄の上端が揃わず段差が出ていた。表示ラベルのみ「エポック数 / 学習ワーカー数 / 評価ワーカー数」へ変更し、`whitespace-nowrap` で折り返しを禁止。内部キー（save_epoch_step / train・eval num_workers）・API送信値・初期値は不変で、各ラベルへInfoHintを追加し内部キーと意味を明示。※1列目「エポック数」の実体はチェックポイント保存のエポック間隔（save_epoch_step）であり学習回数（プロジェクト設定）とは別項目——InfoHintにその旨を記載（ラベル名はユーザー指定）。）

**影響範囲**
`main.py`（409ガード・activeエンドポイント）、`db.py`（`fetch_active_training_job`）、TrainingView、App.jsx（jobInfo/再接続/開始ロック）、`lib/trainingLog.js`、`tests/test_training_guard.py`、`frontend/tests/trainingLog.test.mjs`

---

### そのほか同月に確立した仕様

| 仕様 | 理由 | コミット |
|---|---|---|
| CORS許可を明示オリジン化＋未処理例外のJSON 500化 | `allow_origins=["*"]`+credentialsの無効な組合せを排除。500応答にCORSヘッダが付かずブラウザで原因が見えない問題を解消 | 106af9d |
| プロジェクト切替時の画像一覧混在防止 | 切替直後の1フレームで旧一覧+新プロジェクトIDのURLが生成され404が多発したため、一覧に所有プロジェクトIDタグを付与し不一致時は描画しない | fd8b2b3, 7156c7d |
| 「保存して次へ」は1件だけ進む | 保存処理と画面側の両方が前進して2件飛ぶ不具合。次画像は保存前に画像名で確定する方式Aへ集約（未編集フィルタでも飛ばさない） | a1d25ad |
| 回転操作は90°/180°の2ボタン | 任意角度指定より2アクションの方が実運用（上下逆・横向き）に速い | 9246152 |
| charset仕様の確定（`A-Z0-9klt`） | 学習対象文字/推論whitelist/評価whitelistを別概念として分離。評価はcase-sensitive完全一致 | `docs/12_TESSERACT_CHARSET_SPEC.md`, CHANGELOG |
| 削除系の安全ガード | モデルメタの空パスがCWD再帰削除に化ける重大バグの修正以降、`safe_rmtree`/models配下検証/allowed_rootsの多重ガードを維持 | ea4daf6, 2c438ca, CHANGELOG |
| 画像配信は `Cache-Control: no-cache`（毎回再検証・変更なしは304） | 回転で画像更新後、リロードでURLの `v=` が初期値へ戻ると、`max-age` やヒューリスティックキャッシュが古い向きの画像を再検証なしで表示する実害があったため（792.png で発生）。`max-age` へ戻さないこと | `main.py` の /file・/interim・/processed・/thumbnail |
