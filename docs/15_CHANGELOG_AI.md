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
