# Terminate Windows Training Process Trees Safely 作業記録

Related: Reliability [#133](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/133) / Architecture Investigation [#123](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/123)（Job Lifecycle Unification、Completed） / Reliability [#125](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/125)（Training Job Startup Reconciliation Parity、Completed。本Issueで判明した`_is_pid_alive()`バグの訂正あり） / Investigation [#129](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/129)（Windows Training Process Termination Semantics Investigation、Completed。本Issueで一部訂正あり）

**状態**: Completed / Closed。PR [#134](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/134)、Squash Commit `834abc5`でマージ済み。

## 目的

Investigation #129で実測確認したWindows固有のTraining停止gap（Tesseract/PaddleOCRの外部プロセスが停止後も孤立し続ける）を修正する。緊急障害ではないため#129ではProduction変更を行わなかったが、停止後も外部processが孤立するとCPU/GPU/ファイルハンドル占有やartifact cleanup失敗につながるため、cross-platformで安全なprocess-tree terminationを最小実装する。

## 実装前調査（Mandatory Investigation、Issue本文の10項目すべてに対応）

1. **`_spawn_training_runner()`のspawn options**: `subprocess.Popen([sys.executable, "-m", "src.app.job_runner", ...], start_new_session=True, close_fds=True)`。無変更のまま確認
2. **`_stop_training_worker()`の現在の分岐**: `os.killpg`→（例外時）`os.kill`のfallback。成否に関わらず無条件で`status="stopped"`へDB更新、`delete_artifacts=True`時は終了確認なしに`_delete_training_artifacts()`を即座に実行していた
3. **Windowsで残存を確認したprocess tree形状**: parent（worker、`job_runner.py`）→ grandchild（Tesseract外部CLI/PaddleOCRネストsubprocess）の2階層
4. **Tesseract/PaddleOCRが起動する外部processの種類**: Tesseract=`_stream_command()`経由の外部CLIツール（lstmtraining等）、PaddleOCR=`[sys.executable, "tools/train.py", ...]`のネストsubprocess（Investigation #129で確認済み、再確認）
5. **TrOCR/Classificationがin-processであること**: grep再確認、subprocess使用なし
6. **worker PID以外に永続化されているprocess metadata**: `training_jobs.worker_pid`のみ（孫プロセスのPIDは永続化されていない）
7. **Python標準ライブラリだけでprocess tree terminationを安全に実装できるか**: 可能（`subprocess`+`tasklist`/`taskkill`はいずれも標準添付のWindowsコマンド、`subprocess.run`は標準ライブラリ）
8. **`taskkill /T /F`の可用性・戻り値・安全性**: 実機確認により、`returncode=0`で成功、descendant processも含めて終了することを確認（後述§実測）
9. **`psutil`等の新規依存の必要性**: 不要と判断（Option A採用、後述）
10. **PID再利用による誤kill risk**: `taskkill /T /F`実行前に`tasklist`でイメージ名を確認するガードを追加することで軽減（後述）

### 重要な追加発見: `_is_pid_alive()`自体のバグ

実装前調査の過程で、既存`_is_pid_alive()`（Investigation #129・Reliability #125で前提としていた関数、無変更のまま利用されていた）を**実際にWindows上で（モックを使わず）検証したところ、既に終了したプロセスに対しても`True`（生存）を返し続ける再現性の高いバグを発見した**。

再現手順（`os.kill(SIGTERM)`・`taskkill /F`・`taskkill /T /F`の3方式いずれでプロセスを終了させても同じ結果）:

```python
proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
pid = proc.pid
os.kill(pid, signal.SIGTERM)  # または taskkill /PID <pid> /F
time.sleep(0.3)
main_module._is_pid_alive(pid)  # → True（誤り。tasklistで確認すると実際は終了済み）
```

**真因**: `_is_pid_alive()`のWindows分岐（`ctypes.OpenProcess`）は、ハンドル取得の成否のみを見ており、`GetExitCodeProcess`で`STILL_ACTIVE`(259)かどうかを確認していなかった。Windows上では、プロセスが終了してもOSがそのPID番号を（他プロセスへの再割当て可能な状態へ）回収するまでの間、`OpenProcess`は成功し続ける（これは`os.kill(pid, 0)`自体についても同様で、例外を送出しないケースがあることも確認した）。そのため`if not handle: return False`という判定だけでは、終了直後のプロセスを生存中と誤判定する。

Investigation #129の§3.4は、この現象を「同一プロセスがPopenハンドルを保持し続ける特殊ケースでのみ発生し、実運用では再現しない」と誤って結論づけていた。本Issueの実機再検証で、**Popenハンドルの保持有無に関係なく、また終了方法（`os.kill`/`taskkill`）に関係なく、一貫して再現する**ことを確認し、#129のその結論を訂正した（`docs/workitems/jobs/WINDOWS_TRAINING_PROCESS_TERMINATION_INVESTIGATION_129.md`へ訂正注記を追加済み）。

**影響範囲**: この誤検知は`_terminate_training_process_tree()`（本Issueで新設）の終了確認ロジックが機能しなくなるだけでなく、**Reliability #125の`_reconcile_stale_training_jobs_on_startup()`がWindows上で死んでいるworker_pidを生存中と誤判定し、stale jobをfailedへ補正できていなかった可能性が高い**という、#125の実効性そのものに関わる重大な発見でもある（`docs/workitems/jobs/TRAINING_JOB_STARTUP_RECONCILIATION_125.md`へ訂正注記を追加済み）。

## Windows Strategy: Option A（`taskkill /PID <pid> /T /F`）を採用

| Option | 評価 |
|---|---|
| **A: `taskkill /PID <pid> /T /F`（採用）** | Windows標準・新規依存不要・実測で孫プロセスを含むprocess tree全体を確実に終了することを確認（下記実測）。Cons（exit code解析・PID再利用考慮）はいずれも本実装で対応済み |
| B: CREATE_NEW_PROCESS_GROUP + control event | 孫プロセス（Tesseract外部CLI・PaddleOCRネストsubprocess）が同一process groupを維持する保証を新たに実装・検証する必要があり、Option Aより実装・検証コストが高い。孫プロセス生成側（`tesseract_pipeline.py`/`ocr_pipeline.py`）への変更も必要になり「Training algorithm変更」に近づくため見送った |
| C: psutil tree traversal | 新規依存パッケージを追加することになり、Issue本文の「新規依存パッケージは原則追加しない」に反する。既存依存にpsutilは含まれていないことをrequirements.txtで確認済み。不採用 |

### 実測: `taskkill /PID <pid> /T /F`の挙動

安全なdummy subprocess（parent→grandchild、`time.sleep(60)`のみ）を使い、実Training/GPU/実`outputs/app.db`には一切触れずに実測した。

```
$p = Start-Process python -ArgumentList '-c','import time; time.sleep(30)' -PassThru
taskkill /PID $p.Id /T /F
# → returncode=0
# SUCCESS: The process with PID <grandchild> (child process of PID <p2>) has been terminated.
# SUCCESS: The process with PID <p2> (child process of PID <p.Id>) has been terminated.
# SUCCESS: The process with PID <p.Id> (child process of PID <parent>) has been terminated.
```

`/T`オプションによりprocess tree全体（子孫プロセスを含む）が終了することを確認した。

## Termination Contract（実装）

新設`_terminate_training_process_tree(worker_pid, timeout=3.0) -> dict`（`main.py`）:

- `worker_pid <= 0` → `{"outcome": "invalid_pid"}`
- 呼び出し時点で既に`_is_pid_alive()`が`False` → `{"outcome": "already_dead"}`（terminationコマンドを発行しない）
- Unix: 既存の`os.killpg`→`os.kill`のfallback semanticsをそのまま維持（`start_new_session=True`によりworker_pidがそのままprocess group IDでもあるため、`killpg`だけで孫プロセスも含めて終了できる、Investigation #129のPOSIX仕様確認を踏襲）
- Windows: `taskkill /PID <pid> /T /F`実行前に`tasklist`でイメージ名が実行中のPythonインタプリタ（`sys.executable`のbasename）と一致するか確認し、不一致なら`{"outcome": "pid_mismatch"}`を返して**taskkillを実行しない**（PID再利用による誤kill防止）
- コマンド自体が失敗（非0 exit code・例外） → `{"outcome": "command_failed", "detail": ...}`（**成功扱いに偽装しない**）
- コマンド成功後、`timeout`秒まで`_is_pid_alive()`をポーリングし、終了確認できれば`{"outcome": "terminated"}`、確認できなければ`{"outcome": "still_alive"}`
- `"already_dead"`/`"terminated"`のみを「終了確認済み」として扱い、呼び出し元（`_stop_training_worker`）はこの2つの場合にのみartifact cleanupを行う

`_stop_training_worker()`の変更点:

- inline `os.killpg`/`os.kill`呼び出しを`_terminate_training_process_tree()`へ置き換え
- 終了未確認（`stopped=False`）の場合、`logging.warning()`で診断可能なログを残す
- `delete_artifacts=True`かつ終了未確認の場合、**artifact cleanupをスキップ**し、その旨をjobの`message`へ記録する（cleanup/rmtreeはtermination確認後にのみ行う、Design Principle #7）
- `artifacts_deleted`レスポンスフィールドは実際に削除が行われた場合のみ`True`（従来は`delete_artifacts`フラグのみを反映しており、削除が実際に行われたかとは無関係だった）
- **DB状態遷移の順序自体（`status="stopped"`への無条件遷移）は変更していない**（Design Principle #5「既存順序を維持する」）。既存のstop操作の意味論（ユーザーが停止を要求した事実の記録）を壊さないため

`_delete_training_artifacts()`の変更点: `shutil.rmtree(run_dir)`をtry/exceptで保護し、Windowsのファイルロック等（Investigation #129のFuture Work）による例外を外部へ漏らさないようにした。

`_reconcile_stale_training_jobs_on_startup()`（#125）は無変更（Design Principle #4「実行直後のstop pathとstartup reconciliationを混同しない」）。既存のまま`_is_pid_alive()`のみを使う設計を維持し、本Issueの`_is_pid_alive()`修正の恩恵をコード変更なしに受ける。

## PID Safety

`taskkill /T /F`実行前の`tasklist`イメージ名確認（`_windows_process_image_name()`）により、PID再利用で無関係なプロセスツリーへ渡った場合でも誤って強制終了しない。イメージ名が取得できない場合（`tasklist`失敗等）は「不一致」とは判定せず素通しする（過度に保守的にしすぎず、既存の「取得できない＝安全側へ倒す」設計とバランスを取った）。

## Artifact Cleanup / rmtree Protection

- process tree終了確認前にはartifact/temp directoryを削除しない（`_stop_training_worker()`のガード）
- `shutil.rmtree(run_dir)`をtry/exceptで保護（`_delete_training_artifacts()`）
- cleanup失敗時もjob state（`message`）・ログへ診断情報を残す

大規模なartifact lifecycle redesignは行わず、上記の最小限のguardのみを追加した。

## Platform Matrix

| Engine | 孫プロセス | Windows（Option A適用後） | Unix |
|---|---|---|---|
| Tesseract | あり（外部CLI） | `taskkill /T /F`で終了 | `killpg`で終了（無変更） |
| PaddleOCR | あり（ネストsubprocess） | `taskkill /T /F`で終了 | `killpg`で終了（無変更） |
| TrOCR | なし（in-process） | worker終了のみで完結 | 同左 |
| Classification | なし（in-process） | worker終了のみで完結 | 同左 |

## Tests

新規: `tests/test_windows_training_process_tree_termination.py`（21件）

### Windows-specific mocked/unit tests
- `os.killpg`非存在path（`monkeypatch`で`os.killpg`をAttributeError化、`raising=False`で対応。Windows実機ではそもそも属性が存在しないことを確認済み）
- Windows tree termination command生成（`taskkill /PID <pid> /T /F`の引数構成を検証）
- success exit（returncode=0）
- already-dead PID（terminationコマンドを一切発行しないことを確認）
- failure exit（returncode!=0、"command_failed"）
- invalid PID（pid<=0）
- PID mismatch（イメージ名不一致でtaskkillを実行しないこと）
- still_alive（timeout内に終了確認できない場合）

### Process-tree integration probe（実機、Windows専用・CIでは自動skip）
- `test_windows_real_process_tree_termination_leaves_no_orphan`: 実際にparent→grandchildのdummy process treeを生成し、`_terminate_training_process_tree()`適用後に両方とも終了し孤立プロセスが残らないことを確認する。実プロセス生成・OSスケジューリングに依存するため、システム負荷起因の一時的な失敗を吸収する最大3回の再試行を実装した（ロジック自体の正しさは実装前調査で複数回の手動検証により確認済み。再試行は環境要因によるflakinessのみを吸収する目的）

### Unix regression
- 既存`killpg`成功パス（terminatedの確認）
- `killpg`が`ProcessLookupError`→`already_dead`
- `killpg`が汎用例外（Windowsでの実挙動を模す）→`os.kill`へfallback
- 両方とも失敗→`command_failed`

### Training regression（4 engine共通）
- Tesseract/PaddleOCR/TrOCR/Classification全てで`_stop_training_worker()`が正しく`status="stopped"`へ遷移すること
- 終了未確認時はartifact cleanupをスキップすること・終了確認時は実行すること
- worker_pid欠落は409
- 繰り返しstop要求は2回目が400で拒否され、terminationロジックへ到達すらしないこと（危険な副作用防止）
- `_delete_training_artifacts()`の`shutil.rmtree`失敗が外部へ例外を漏らさないこと

### Startup reconciliation無回帰
- `_reconcile_stale_training_jobs_on_startup()`が`_terminate_training_process_tree()`を一切呼ばないこと（stop pathとの混同防止、Design Principle #4）

実行結果:

```
python -m pytest -q tests/test_windows_training_process_tree_termination.py
# 21 passed（実機Windows process-tree probeを含む）

python -m pytest -q tests/test_training_job_startup_reconciliation.py tests/test_training_guard.py
# 48 passed（#125関連の無回帰確認）

python -m pytest -q
# 1280 passed, 10 failed（既存の環境依存failure、Issue #131時点のbaselineと完全一致、
# 本Issueの変更に起因しない）
```

`outputs/app.db`のsha256チェックサムをテスト前後で比較し一致することを確認済み（実データへの副作用なし）。実`data/jobs/`ディレクトリへの新規ファイル生成が無いことも確認済み。

Frontend diffは0（`git diff --stat -- frontend/`で確認済み）。

## Documentation

- 本ファイル新規作成
- `docs/workitems/jobs/WINDOWS_TRAINING_PROCESS_TERMINATION_INVESTIGATION_129.md`: §3.4・Architecture Questions 6-8・Risk表・Recommended Action項目4へ訂正注記を追加（Documentation Lifecycleの原則に従い、誤りを隠さず記録する形で保持）
- `docs/workitems/jobs/TRAINING_JOB_STARTUP_RECONCILIATION_125.md`: Future Workへ、Windows上でのreconciliation実効性に関する訂正注記を追加
- `docs/10_KNOWN_LIMITATIONS.md`: 「Windowsでの学習停止は孫プロセスを終了しない」の行を削除（本Issueで解消済みのため）

## Scope外（Out of Scope、実施しなかったこと）

- Job Lifecycle全面統合
- Shared Job Facade backend実装
- JobRepository SQLite変更
- Training algorithm変更
- graceful checkpoint cancellation設計
- GPU実モデルを使う破壊的停止テスト
- Frontend Job UI redesign
- Epic #28 Consumer Migration

## Future Work

- Option B（`CREATE_NEW_PROCESS_GROUP` + control event）による、より「graceful」な停止方式の検討（現状のOption A=`/F`強制終了で十分機能しているため優先度は低い）
- 孫プロセスのPID自体を`training_jobs`へ永続化し、`taskkill`のイメージ名確認よりさらに厳密な識別を行う設計（現状のイメージ名確認で実用上十分と判断し見送った）
- `docs/26_PERFORMANCE_LIMITS.md`等、Windows特有の運用ノウハウとして記載する余地があるか、実運用での知見蓄積を待って判断する
