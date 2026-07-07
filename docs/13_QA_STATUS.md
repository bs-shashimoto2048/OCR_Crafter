# 13_QA_STATUS（品質保証フェーズ結果と既知課題 / 2026-07-07）

## QA実施結果

### Tesseract E2E動作確認（全9工程 PASS）

専用プロジェクト `e2e` で実APIに対して一気通貫を確認（合成画像10枚・混在ラベル）:

| 工程 | 結果 | 確認内容 |
|---|---|---|
| データセット作成 | ✅ | charset=A-Z0-9klt / text_case=keep / `CHYBkt` 非改変 |
| from_logs | ✅ | /api/ocr/log/save → from_logs、混在ラベル保持 |
| 学習 | ✅ | 200イテレーションで completed、skipped集計動作 |
| モデル登録 | ✅ | .tess.json 生成、/models・info・latest 反映 |
| モデル管理 | ✅ | 詳細表示フィールド、.traineddata ダウンロード(15.4MB) |
| モデル評価 | ✅ | eng vs latest 比較・comparison算出（30%→60%で学習効果も確認） |
| バッチ推論 | ✅ | /predict ループ・/api/ocr/predict/batch とも tesseract 動作 |
| RapidOCR | ✅ | apply_preprocess=false 推論＋確定ログ保存 |
| モデル削除 | ✅ | メタ+実体dir削除、modelsルート無傷（安全ガード動作） |

### docs整理

- 旧「a-z whitelist / 英小文字のみ」記述: usage.md に残存なし（新charset仕様反映済み）
- usage.md: download APIの .tess.json 対応、モデル管理/バッチ推論のTesseract対応、削除安全ガードを追記
- 消失していた `11_TESSERACT_CHECKLIST.md` / `12_TESSERACT_CHARSET_SPEC.md` を新仕様＋実践知見（box/LF/tsvの過去バグ再発チェック込み）で再作成

### 正式ベースライン評価（outputs/ocr_eval/baseline_eng_20260707/）

- single(kt/lt 100枚): **41.0%**（kt 70% / lt 12%） / mixed(CHYBkt形式 40枚): **12.5%**（kt 25% / lt 0%）
- 事故復旧前の最終評価と数値が完全一致 → 復旧コードの再現性を確認

## 既知課題（優先度順）

### A. コード（code-review 残指摘・PLAUSIBLE級）

1. **delete_model のガード深さ**: メタが `models/ocr_runs` 等の共有親ディレクトリを指すと配下の他モデル成果物ごと削除可能（発生には異常/手編集メタが前提）。モデル個別サブディレクトリ深さの検証追加が望ましい。
2. **相対パスメタの解決**: メタ内相対パスはプロセスCWD基準で resolve され、削除スキップ（fail-safe側）になる。`(models_root / raw)` フォールバック解決の追加余地。
3. **rmtree封じ込めの実装が3方式併存**: `safe_rmtree`（project_paths）/ allowed_roots（main._cleanup_failed_ocr_dataset）/ relative_to（main._delete_training_artifacts）。`safe_rmtree` への統一が望ましい。
4. **rmtree(ignore_errors=True) の部分失敗が非検知**: Windowsのファイルロック中削除で実体が中途半端に残ってもAPIは成功を返す。

### B. 復旧関連の未回収資産

5. **旧データ未復元**: 旧cursiveプロジェクトの実画像（CHYBkt等）・過去の学習済みモデル2つ・旧評価出力は消失のまま。**7/3のShadowCopy（GUI「以前のバージョン」）に旧 data/・画像/・.env が残っている可能性**があり、必要ならユーザーのGUI操作で回収可能。
6. **未復元ドキュメント**: AGENTS.md / PROJECT_OVERVIEW.md / docs 00〜10（5/14版の一部は VS Code Local History に残存）。
7. **requirements.txt が UTF-16**: pip で直接使えない（インストール時はUTF-8変換が必要）。UTF-8での再保存を推奨。
8. **paddleocrOfficialTooltip.js は再作成版**: 原文消失のため文言は新規作成。要確認。

### C. 後始末（ユーザー判断待ち）

9. 一時退避フォルダの削除可否: `.venv_broken_20260707/`・`C:\recovery_ocr/`・`../ocr_crafter_after_incident_backup_20260707/`・`../ocr_crafter_recovery_backup_20260707/`・`../ocr_crafter_salvage_20260707/`・`C:\Users\...\workspace_codex\shadow_*.{ps1,cmd,txt}`。
10. `.git` の dangling blob 約9,850個: リモートpush完了後も追加サルベージ用に保持中。回収不要と判断したら `git gc` 解禁を検討（現状は実行禁止のまま）。

### D. 改善案（新機能ではなく品質向上）

11. **自動テストの恒久化**: 今回のE2E・安全ガードテストは一時スクリプト。`tests/` としてリポジトリに取り込み、回帰テスト化する。
12. **学習の高速化**: lstmf生成が1枚ずつ tesseract サブプロセス起動（500枚≈2分）。並列化余地あり。
13. **精度改善**（旧finetune_v1の知見）: lt系の比率増強（`l` 脱落が最弱点）、イテレーション増（3000→5000+）、実画像の学習混入、I/1/l対比サンプル。
14. **評価UIの拡充**: 誤認識パターン集計（expected→prediction別件数）の画面表示。
