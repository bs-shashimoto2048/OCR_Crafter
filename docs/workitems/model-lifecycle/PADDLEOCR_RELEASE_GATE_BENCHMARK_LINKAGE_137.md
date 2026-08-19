# PaddleOCR Release Gate Benchmark Linkage 作業記録

Related: Bug [#137](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/137) / Feature [#117](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/117)（Model Card / Deployment Package Multi-engine Parity、Completed。本Issueの起点となったFuture Work） / Feature [#104](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/104)（TrOCR Release Gate Integration、既存パターンの参照元）

**状態**: Completed / Closed。PR [#138](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/138)、Squash Commit `a7cbe04`でマージ済み。

## 目的

Issue #117のFuture Workで記録された、PaddleOCR Release GateとBenchmark結果のlinkage gapを修正する。`release_gate.py::_latest_benchmark_result()`が`paddleocr_custom`/`paddleocr_official`のBenchmark行を一切マッチングしない既存gapを、既存contractに沿って最小修正する。

## 実装前調査（Mandatory Investigation、Issue本文の9項目すべてに対応）

### 1. `release_gate.py::_latest_benchmark_result()`の現在実装

`engine == "tesseract_model"`（直接文字列一致）と`engine == "trocr"`（`_resolve_trocr_benchmark_model_ref()`経由の`model_dir`解決）の2分岐のみ実装されており、**PaddleOCR（`paddleocr_custom`/`paddleocr_official`）向けの分岐が一切存在しない**ことを確認した。この関数は該当する行が無ければ`None`を返すのみで、例外もログも出さない（静かに機能しないタイプのgap）。

### 2. `release_manager.py`側のmodel identity/engine判定

`list_releases()`（`release_manager.py`）は`*.tess.json`/`*.ocr.json`/`*.trocr.json`の3種類のsidecarファイルのみをRelease候補として列挙する（`paths.models.glob(...)`）。**「official」（事前学習済み、`.ocr.json`を持たない）PaddleOCRモデルはそもそもRelease候補として一度も列挙されない**ことを確認した（`release_manager.py`/`release_gate.py`に`official`という文字列は一切出現しない）。

### 3. Benchmark result persistence schemaとmodel field

`benchmark.py::normalize_engine_spec()`が`spec["model"]`を正規化する。`paddleocr_custom`の場合、`model`フィールドには**`.ocr.json`ファイル名がそのまま**入る（`.strip()`のみ、他の変換なし）。これは`tesseract_model`の`model`フィールド（`.tess.json`ファイル名そのもの）と**完全に同じ規約**である。

### 4. PaddleOCR official modelのBenchmark runner/build path

`_build_paddleocr_runner()`（`paddleocr_official`用）は`OFFICIAL_PADDLEOCR_REC_MODELS`から選ばれたモデル名文字列を扱う。`.ocr.json`sidecarとは無関係であり、Release Gateの`model`パラメータ（常に`.ocr.json`ファイル名）と一致することは原理的にない。

### 5. PaddleOCR custom modelのregistry/model_ref path

`_build_paddleocr_custom_runner()`（`paddleocr_custom`用）を確認した: `model_name = str(spec.get("model") or "")` をそのまま `resolve_ocr_model_meta(project_id=project_id, model=model_name, engine="paddleocr", inference_ready_only=True)` へ渡している。**Benchmark実行時の`model`とRelease Gateの`model`は、同じ`.ocr.json`ファイル名という同一の識別子である**ことを確認した。

### 6. `.ocr.json` sidecar contract

`resolve_ocr_model_meta()`（`model_registry.py`）: `model`パラメータを`paths.models / Path(normalized_model).name`として解決し、`.ocr.json`で終わることを要求する。TrOCRのような別識別子（`model_dir`）への変換は行われない。

### 7. `resolve_ocr_model_meta()`等のexisting resolver

上記の通り、`resolve_ocr_model_meta()`はBenchmark実行時の`.ocr.json`解決に使われている既存resolverである。ただし本Issueの修正（`_latest_benchmark_result()`側でのBenchmark result lookup）には、この resolver を呼び出す必要はない。理由: Release Gate側の`model`引数もBenchmark result行の`model`フィールドも**すでに同一の`.ocr.json`ファイル名という文字列**であり、TrOCRのように異なる識別子体系間の変換が必要な場面ではないため（§8で詳述）。

### 8. Tesseract/TrOCRでRelease GateとBenchmarkがどう接続されているか

- Tesseract: `engine == "tesseract_model" and row_model == model`という直接文字列一致（resolverなし）
- TrOCR: `engine == "trocr"`かつ`_resolve_trocr_benchmark_model_ref()`（`list_trocr_models()`経由でsidecar名→`model_dir`を解決）という間接一致（Benchmark実行時の識別子=`model_dir`、Release Gateの識別子=sidecar名、という2つの異なる識別子体系を橋渡しするresolverが必要）
- **PaddleOCR custom**: §3・§5で確認した通り、Benchmark実行時の識別子とRelease Gateの識別子は最初から同一（`.ocr.json`ファイル名）であるため、**Tesseractと同じ直接一致パターンで足りる**（TrOCRのような橋渡しresolverは不要）

### 9. Model Card #117でどこまでbenchmark情報を扱っているか

Model Card（`release_manager.py`のModel Card生成ロジック、Issue #117）はBenchmark結果を一切表示しない（全engine共通で未実装、Issue #117で確認済み・意図的にparity gapではないと整理済み）。本Issueのスコープ（Release Gate評価ルールの`max_benchmark_rank`/`max_failed`）とは無関係であることを再確認した。

## 実装内容（Identity Mapping）

`_latest_benchmark_result()`へ`engine == "paddleocr_custom"`の分岐を追加した。既存の`tesseract_model`分岐と全く同じ「直接文字列一致」パターンであり、新しいresolver・parallel registryは一切追加していない（Issue本文の「既存Resolver再利用、新規parallel registry禁止」を、既存resolverすら不要という形で満たした）。

```python
if engine == "paddleocr_custom" and row_model == model:
    return {**row, "benchmark_id": item.get("benchmark_id")}
```

`engine == "paddleocr_official"`は**意図的に対象外のまま**とした。理由:

- official modelはRelease候補になり得ない（§2）ため、Release Gateの`model`引数（常にsidecarファイル名）と一致することは原理的にない
- 仮に将来何らかの理由でofficial行の`model`フィールドとRelease候補のsidecar名が偶然同じ文字列になったとしても、それは全く異なるモデル（事前学習済み vs 自作学習済み）を指しており、**誤って接続してはならない**（Issue本文「表示名だけの曖昧一致は禁止」「別モデルの結果へ誤fallbackしない」に該当）

## Missing Benchmark Evidence（既存policyの維持）

`bench is None`の場合の既存処理（`RESULT_UNVERIFIED`、メッセージ「このモデルを含むBenchmarkがありません」）は無変更のまま。PaddleOCR custom modelにマッチするBenchmark結果が無い場合、この既存policyがそのまま適用される（本Issue以前は「PaddleOCRは常にこの状態だった」というバグが、「実際に評価対象が無い場合のみこの状態になる」という正しい挙動へ変わる）。

## No Benchmark Semantic Changes（無変更の確認）

- CER計算: 無変更（`benchmark.py`は一切変更していない）
- Benchmark execution: 無変更
- runner build-once semantics: 無変更
- Benchmark API schema: 無変更（`release_gate.py`のみ変更）
- Benchmark UI: 無変更（`frontend/`はdiff 0）

## Tests

新規: `tests/test_release_gate_paddleocr_benchmark.py`（9件）

- PaddleOCR custom modelがBenchmark結果と接続できない既存gapの再現確認（修正前の状態を検証するテストとしても機能する）
- `paddleocr_custom`の直接一致によるBenchmark linkage正常化（`max_benchmark_rank`/`max_failed`ともにPASSすることを確認）
- `max_failed`のFAIL判定（既存policyがPaddleOCRでも正しく機能すること）
- 同じengineで別モデル（別`.ocr.json`ファイル名）の結果へ誤って接続しないこと
- **`paddleocr_official`のBenchmark行が、名前が偶然一致してもcustom modelへ接続されないこと**（official/customの識別が曖昧一致にならないことの直接確認）
- 複数Benchmark結果がある場合に、既存の「新しい順から最初に一致した行を採用する」semanticsがPaddleOCRでも維持されること
- Tesseract/TrOCRの既存Benchmark linkageが本Issueの変更後も無回帰であることの確認
- `_model_engine()`（Allowed Engines判定）が無変更のままPaddleOCRを正しく識別することの確認

実行結果:

```
python -m pytest -q tests/test_release_gate_paddleocr_benchmark.py
# 9 passed

python -m pytest -q tests/test_release_gate.py tests/test_release_gate_trocr.py tests/test_releases.py tests/test_production_auth.py
# 48 passed（Tesseract/TrOCR/Model Card関連の無回帰確認）

python -m pytest -q
# 1289 passed, 10 failed（既存の環境依存failureのみ、Issue #133時点のbaselineと完全一致、
# 本Issueの変更に起因しない）
```

`outputs/app.db`のsha256チェックサムをテスト前後で比較し一致することを確認済み（実データへの副作用なし）。Frontend diffは0（`git diff --stat -- frontend/`で確認済み）。

## Documentation

- 本ファイル新規作成
- `docs/workitems/model-lifecycle/MODEL_CARD_DEPLOYMENT_MULTI_ENGINE_PARITY_117.md`: Future Workの該当項目（`_latest_benchmark_result()`のPaddleOCR gap）を解決済みへ更新

## Scope外（Out of Scope、実施しなかったこと）

- Model CardへのBenchmark表示追加
- Benchmark architecture統合
- Release Gate全面再設計
- model_registry.py全面再設計
- Canonical Metadata Consumer Migration
- UI redesign

## Future Work

特になし。本Issueの修正により、Issue #117で発見されたRelease Gate Benchmark linkageの既知gapは解消された。
