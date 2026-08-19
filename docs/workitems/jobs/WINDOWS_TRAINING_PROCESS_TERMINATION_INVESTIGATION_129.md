# Windows Training Process Termination Semantics Investigation 作業記録

Related: Investigation [#129](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/129) / Architecture Investigation [#123](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/123)（Job Lifecycle Unification、Completed。§7 Cancellation Semantics・§13 Risk Analysisで本項目を高リスクとして特定） / Reliability [#125](https://github.com/bs-shashimoto2048/OCR_Crafter/issues/125)（Training Job Startup Reconciliation Parity、Completed）

**状態**: Completed / Closed（Investigation / Documentation only。Production cancellation semanticsは無変更）。PR [#130](https://github.com/bs-shashimoto2048/OCR_Crafter/pull/130)、Squash Commit `de15d16`でマージ済み。

## 目的

Architecture Investigation #123で高リスク項目として残った、Windows環境におけるTraining subprocess停止挙動（`os.killpg` / `os.kill` / `start_new_session=True`）を実機（開発機=Windows 11）で実測し、現行実装の安全性・確実性を判断する。Production cancellation実装はいきなり変更せず、契約差・実挙動・必要な最小修正有無を確定する。

## 1. Current Spawn Contract

`main.py::_spawn_training_runner(job_type, job_id)`（無変更、コード全文確認済み）:

```python
def _spawn_training_runner(job_type: str, job_id: str) -> int:
    repo_root = Path(__file__).resolve().parents[2]
    process = subprocess.Popen(
        [sys.executable, "-m", "src.app.job_runner", job_type, job_id],
        cwd=str(repo_root),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
    return int(process.pid)
```

- `start_new_session=True`はPOSIXでは`setsid()`相当（新しいsessionのleaderかつ新しいprocess group（`pgid == pid`）になる）。**Python公式ドキュメント上、Windowsではこのオプションは効果を持たない**（POSIX専用機能）
- `Popen`オブジェクト自体は関数を抜けると同時に参照が失われる（`process.pid`のみを返す）。**この設計により、後で`_stop_training_worker()`が呼ばれる時点では、spawn時のPopenオブジェクトの参照・ハンドルは既にGC済み**（§3で実測により重要性を確認）
- `worker_pid`は`training_jobs.worker_pid`カラム（INTEGER）にのみ保存。他のprocess metadata（起動時刻以外の識別情報、親子関係等）は保持しない

## 2. Current Stop Contract

`main.py::_stop_training_worker(job_id, expected_family, delete_artifacts)`（無変更、コード全文確認済み）:

```python
stopped = False
try:
    os.killpg(worker_pid, signal.SIGTERM)
    stopped = True
except ProcessLookupError:
    stopped = False
except Exception:
    try:
        os.kill(worker_pid, signal.SIGTERM)
        stopped = True
    except ProcessLookupError:
        stopped = False

current = fetch_training_job(job_id) or job
...
if delete_artifacts:
    removed = _delete_training_artifacts(current)  # training_family=="ocr"なら shutil.rmtree(run_dir) をtry/exceptなしで実行
    ...
upsert_training_job({**current, "status": "stopped", "worker_pid": None, ...})  # 実際の終了確認をせず無条件に確定
```

- `os.killpg`が失敗した場合の`except Exception:`は**AttributeErrorも含む広い捕捉**であり、Windowsで`os.killpg`自体が存在しないケースを暗黙にfallbackへ流す設計になっている（意図的かは不明だが、結果的に機能している）
- DB状態更新（`status="stopped"`）は、killpg/killの成否（`stopped`変数）に関わらず**常に実行される**。実際にプロセスが終了したかどうかの確認（wait/poll）は無い
- `delete_artifacts=True`の場合、`_delete_training_artifacts()`内の`training_family=="ocr"`分岐（`shutil.rmtree(run_dir)`）は**try/exceptで囲まれていない**（`model_path`/`log_path`の削除は個別にtry/exceptで囲まれているが、`run_dir`本体の削除は素通し）

## 3. Platform Behavior（Windows実機測定）

安全なdummy subprocess（`time.sleep(60)`）を使い、実Training/GPU/Tesseractには一切触れずに、開発機（Windows 11、Python 3.10.11）で直接測定した。probe scriptは一時ディレクトリ（scratchpad）で完結させ、実行後は生成したdummyプロセスのみを`taskkill`で明示的に後始末した（実`outputs/app.db`・実プロジェクトデータへは一切触れていない）。

### 3.1 `os.killpg`の存在確認

```python
>>> import os
>>> 'killpg' in dir(os)
False
```

**Windows Python (3.10.11、pyenv-win) には`os.killpg`が定義されていない**。`_stop_training_worker()`が`os.killpg(worker_pid, signal.SIGTERM)`を呼ぶと`AttributeError: module 'os' has no attribute 'killpg'`が発生し、`except Exception:`で捕捉されて`os.kill()`へfallbackする。**Windows上では`os.killpg`の一次経路は常にdeadで、fallbackのみが実行される。**

### 3.2 `os.kill(pid, SIGTERM)`の実効性（child本体）

`start_new_session=True`でspawnした子プロセス（`child_pid`）に対して`os.kill(child_pid, signal.SIGTERM)`を実行し、`tasklist`で客観的に生死を確認した。

```
os.kill(child_pid, signal.SIGTERM) → 例外なし
+0.2s: tasklist上でchildは消滅（プロセス終了を確認）
```

**Windowsの`os.kill(pid, signal.SIGTERM)`は、CPython実装内部で`TerminateProcess()`相当を呼び出し、対象プロセス本体を確実に終了させる**（`SIGTERM`という値自体はWindowsにネイティブなシグナルではないが、CPythonが特殊値（`CTRL_C_EVENT`/`CTRL_BREAK_EVENT`）以外はプロセス強制終了として扱う実装になっているため）。既存fallbackはworker本体の終了という意味では機能する。

### 3.3 孫プロセス（grandchild）の生死 — 最重要の発見

同じ`child_pid`が、自身でさらに孫プロセス（dummyのsleep(60)、Tesseract外部CLIツール/PaddleOCRのネストされた学習subprocessを模擬）をspawnしている状態で、上記と同じ`os.kill(child_pid, SIGTERM)`を実行した。

```
spawn直後:              child=alive, grandchild=alive
os.killpg(child, TERM):  AttributeError（fallbackへ）
os.kill(child, TERM):    例外なし
  +0.2s: child=消滅,  grandchild=alive
  +1.0s: child=消滅,  grandchild=alive
  +2.0s: child=消滅,  grandchild=alive
```

**孫プロセスは終了せず、孤立プロセス（orphan）として実行を継続する。** これは`os.kill()`がシグナルを送る対象PIDそのものにしか作用せず、プロセスツリー全体には作用しないためであり、Windows固有の欠落ではなく`os.kill`という単一PID対象APIの一般的な性質そのものである（後述§4でLinuxとの対比を整理する）。

### 3.4 `_is_pid_alive()`相当ロジックの追加検証（zombieに見える誤検知の原因究明）

投資調査の過程で、`_is_pid_alive()`相当ロジック（`os.kill(pid, 0)` + Windows時`ctypes.OpenProcess`フォールバック）が、`tasklist`ではプロセス消滅済みと分かっているPIDに対して`True`（生存）を誤報告するケースを発見した。追加のprobeで原因を特定した:

- **同一プロセス内で`Popen`オブジェクトへの参照を保持し続けている場合**（例: probe scriptが`proc = subprocess.Popen(...)`の`proc`をローカル変数として持ち続けたまま`is_pid_alive`を呼ぶ）、対象PIDに対する内部ハンドルが生き続けるため、`ctypes.OpenProcess`がterminate後も一時的に成功し続け、**`proc.wait()`を呼んでも解消しない**
- **`_spawn_training_runner()`の実装（`process.pid`のみを返し、`Popen`オブジェクトへの参照を保持しない）を忠実に再現したprobeでは、この誤検知は再現しなかった**（terminate直後から`tasklist`と完全に一致してFalseを返した）

**結論**: これは`_is_pid_alive()`自体のバグではなく、「同一プロセスが対象PIDのPopenハンドルを保持し続けている」という特殊な条件でのみ起きる現象であり、実運用の`_spawn_training_runner()`→（時間を置いて別リクエストで）`_stop_training_worker()`という呼び出しパターンでは再現しないことを確認した。誤解のまま放置すると「Windowsで停止済みJobがreconciliationで誤ってrunning扱いされ続ける」という誤った懸念につながりかねないため、明確に切り分けて記録する。

## 4. Unix Comparison

CI（GitHub Actions、`ubuntu-latest`。`.github/workflows/ci.yml`で確認済み）はLinux環境だが、本Investigationのスコープ上、Linux実機での直接probeは実施していない（開発機がWindowsのみのため）。PythonおよびPOSIX仕様上、以下は文書化された既知の契約であり、推測ではなく確立された仕様に基づく:

- `start_new_session=True`はLinuxで`setsid()`を呼び出し、子プロセスを**新しいsessionのleaderかつ新しいprocess group（`pgid == 自身のpid`）**にする
- 子プロセスがさらに`subprocess.Popen()`で孫プロセスを生成する際、孫プロセス側で明示的に`start_new_session`/`preexec_fn`でprocess groupを変更しない限り、**孫プロセスは親と同じprocess groupを継承する**（`_stream_command()`・`ocr_pipeline.py`の該当箇所はいずれも`start_new_session`等を指定していないことを確認済み、§5参照）
- `os.killpg(pgid, SIGTERM)`は、**指定したprocess group ID に属する全プロセスへSIGTERMを送る**

**結論**: Linux上では`os.killpg(worker_pid, SIGTERM)`（worker_pidがそのままprocess group IDになる）が、worker本体だけでなく、その時点で実行中の孫プロセス（Tesseract外部CLIツール・PaddleOCRのネスト学習subprocess）も含めて終了させる、と判断できる。Windowsではこの一次経路（`os.killpg`）自体が存在せず、fallbackの`os.kill`は単一PIDにしか作用しないため、**同じコードが2つのOSで実質的に異なる強さのcancellationを提供している**、という非対称性が本Investigationの中心的な発見である。

## 5. Descendant Process Behavior（Engine別）

`grep`で全training実行経路の`subprocess`/`Popen`呼び出しを確認した。

| Engine/Family | 孫プロセスの有無 | 該当コード |
|---|---|---|
| **Tesseract** | **あり**。`_stream_command()`が外部Tesseractツール（`lstmtraining`/`text2image`等のCLI）を`subprocess.Popen`（`start_new_session`等の指定なし）でブロッキング実行する | `tesseract_pipeline.py:288` |
| **PaddleOCR** | **あり**。学習ループ本体を`[sys.executable, "tools/train.py", ...]`としてネストした`subprocess.Popen`（同上、明示的なprocess group変更なし）で起動し、標準出力をストリーミング監視（OOM検知等）しながらブロッキング待機する。エクスポート（推論形式変換）ステップも同様に別のネストsubprocessを起動する | `ocr_pipeline.py:1582`（export）, `ocr_pipeline.py:2062`（train本体） |
| **TrOCR** | **なし**。`trocr_training_core.py`にsubprocess/Popenの使用は無く、学習ループは`job_runner.py`プロセス内でPyTorchを直接実行する（in-process） | `trocr_training_core.py`（grep確認: 該当なし） |
| **Classification** | **なし**。`_run_training_job()`（`main.py`）はコールバック経由でepoch進捗を受け取りながらin-processで学習する（subprocess無し） | `main.py:2573` |

**結論**: Tesseract・PaddleOCRの2 engineは、学習中に外部プロセス（孫プロセス）を保持する。これらのjobを停止する際、Windows環境では`_stop_training_worker()`のfallback（`os.kill(worker_pid)`）がworker本体（`job_runner.py`）のみを終了させ、孫プロセス（実際にCPU/GPUを使用している側）は終了せず孤立プロセスとして動作し続ける可能性がある。TrOCR・Classificationはこの問題の対象外（worker本体を終了させれば学習ループ自体が止まる）。

## 6. Current User-visible Contract

- Endpoint: `POST /api/{tesseract,ocr,trocr}/train/stop/{job_id}` / `POST /train/stop/{job_id}`（いずれも`_stop_training_worker()`を呼ぶ）
- Success response: `{"job_id", "project_id", "training_family", "status": "stopped", "stopped": bool, "artifacts_deleted": bool, "removed": {...}}`。**`stopped`フィールドはkillpg/killが例外を投げなかったかどうかを示すのみで、孫プロセスを含めた実際の終了確認ではない**
- Status transition: `queued`/`running` → `stopped`（無条件、§2参照）
- Stopped jobの再開可否: 明示的な「再開」APIは無い（`training_jobs`のjob_idは使い捨て、新規`train/start`で別job_idとして再学習する運用。Job System Bのような`retry_job()`相当は無い）
- Artifact partial state: `delete_artifacts=False`（既定）の場合、`run_dir`・部分チェックポイントはそのまま残る。孫プロセスが生存し続けている場合、UIが「停止済み」と表示した後もそのプロセスが同じ`run_dir`へ書き込みを続ける可能性があり、**後から別のjobがGPUリソース確保に失敗したり、`_delete_training_artifacts()`（`delete_artifacts=True`時）が`shutil.rmtree(run_dir)`実行中に「使用中のファイル」エラー（Windowsのファイルロック）でtry/except無しに例外を投げる可能性がある**（§2の実装確認・`docs/10_KNOWN_LIMITATIONS.md`の既存の`rmtree`関連既知課題とも整合する新たなシナリオ）

## Architecture Questions（10問回答）

1. **Windowsで`os.killpg`は現行コード通り機能するか。** — 機能しない。`os.killpg`自体が存在せず`AttributeError`となり、常にfallbackへ流れる（§3.1）
2. **fallback `os.kill`だけで十分か。** — worker本体の終了には十分（§3.2）。ただしTesseract/PaddleOCRの孫プロセスには一切作用せず、不十分（§3.3、§5）
3. **process tree全体を終了する必要があるか。** — Tesseract/PaddleOCRについては必要。TrOCR/Classificationは不要（worker本体の終了で完結する、§5）
4. **Windowsでは`CREATE_NEW_PROCESS_GROUP`等が必要か。** — 対応する場合、`subprocess.CREATE_NEW_PROCESS_GROUP`（`creationflags`）でspawnし、停止時に`os.kill(pid, signal.CTRL_BREAK_EVENT)`を使うWindows流の代替経路が考えられる。ただしこれは孫プロセス（ネストされた`subprocess.Popen`）が同じprocess groupに属することが前提であり、Windows上でのprocess group継承の挙動は本Investigationでは未実測（Future Work）
5. **`CTRL_BREAK_EVENT`等のgraceful signalを使う価値があるか。** — 理論上は#4と組み合わせて価値があるが、Python公式ドキュメント上`CTRL_BREAK_EVENT`はコンソールプロセスグループ全体へのイベント送出であり、対象プロセスがコンソールイベントハンドラを持たない場合の既定動作（プロセス終了）に依存する。本Investigationのスコープでは実装・実測しない（Production変更禁止のため）
6. **強制停止は`Popen` objectを保持しない現行設計でも安全に実装可能か。** — 現行のworker本体終了については安全に実装できている（`worker_pid`のみで足りる、§3.4で誤解を切り分け済み）。孫プロセスを含めた終了には、孫プロセスのPIDも永続化するか、process group／Job Object（Windows）等のOS機構を使う設計変更が必要
7. **persisted PIDだけでprocess identityを安全に判断できるか（PID再利用含む）。** — 本Investigationでは新たな検証はしていない（Issue #125で`_is_pid_alive()`の既存挙動を前提として利用しており、PID再利用の理論的リスクは既存のまま）。§3.4の誤検知はPID再利用ではなく同一プロセス内ハンドル保持が原因であり、別の懸念であることを確認した
8. **startup reconciliation #125との整合は取れているか。** — 整合している。`_reconcile_stale_training_jobs_on_startup()`はサーバ起動直後（新しいプロセス）に判定するため、§3.4で見つかった「同一プロセスがハンドルを保持し続ける」ケースには該当しない。ただし、Windowsで孫プロセスが生存し続けるケースについて、reconciliation・stop双方とも孫プロセスの存在は検知・対処していない（新たなgapとして§ Recommended Actionへ記録）
9. **engineごとに停止方式を変える必要があるか。** — 変える場合は必要になる（Tesseract/PaddleOCRのみprocess tree対応が必要、TrOCR/Classificationは現状のままで良い）。ただし本Investigationでは実装しない
10. **cross-platform helperへ切り出すべきか。** — 将来対応する場合は価値がある（`_is_pid_alive()`が既にこのパターンを一部体現している）。本Investigationでは新設しない

## Reliability / Security Risks

| Risk | 評価 |
|---|---|
| Windowsで孫プロセス（Tesseract外部CLI/PaddleOCR学習subprocess）が停止後も実行を継続する | **確認済み・高**。GPU/CPU/ディスクを占有し続け、ユーザーには「停止済み」と表示されるため気づかれにくい |
| `delete_artifacts=True`時、生存中の孫プロセスと`shutil.rmtree(run_dir)`の競合 | **理論的・中**。実際のファイルロック競合は本Investigationでは意図的に再現していない（実Training/GPU破壊的テストを避けるためIssue本文で明示的にOut of Scope）が、コード上`try/except`が無いことを確認済み |
| 孤立した孫プロセスが後続jobのGPU/ポート/ファイルロックと衝突する | **理論的・中**。実測はしていないが、`_reject_if_training_active()`はDB状態のみに基づくため、孤立プロセスの存在自体は考慮されない |
| `_is_pid_alive()`相当ロジックの誤検知 | **調査済み・低（実運用では発現しない）**。§3.4の通り、実運用の呼び出しパターンでは再現しないことを確認した |

## Recommended Action

1. **現行実装（`os.killpg`→`os.kill`のfallback）は、worker本体の終了という最小契約は満たしており、緊急の破壊的修正は不要と判断する**（Architecture Investigation #123の方針＝いきなり大きな変更をしない、と整合）
2. **Tesseract/PaddleOCRの孫プロセスがWindows上で停止後も残り得るという事実は、reliability gapとして次の小規模Issueへ分割することを推奨する**。候補: `[Bug] Windows Training Stop: descendant process cleanup for Tesseract/PaddleOCR` — 対応案としては、(a) `subprocess.CREATE_NEW_PROCESS_GROUP`をworker spawn時に付与し、孫プロセス生成側でも同一process groupを維持したまま、停止時にWindows用のprocess tree終了（例: `taskkill /T /F /PID <worker_pid>`相当、またはWindows Job Objectへ紐付けてJob Object全体を終了）へ切り替える、(b) 孫プロセスのPIDも`training_jobs`へ記録し停止時に個別終了する、等。いずれも新たな実装Issueでの設計判断が必要
3. **`delete_artifacts=True`時の`shutil.rmtree(run_dir)`をtry/exceptで保護し、ファイルロック等の失敗を安全に扱う**（Windows固有の既知課題`docs/10_KNOWN_LIMITATIONS.md`の`rmtree`関連項目と合わせて別Bug Issueで検討可能）
4. `_is_pid_alive()`自体の修正は不要（§3.4で誤解であることを確認済み）

本Issueでは上記1-3のいずれも実装しない（Investigation/Documentation onlyの原則、Issue本文の明示的指示通り）。次Issue自体もこのIssue内では作成しない。

## Tests / Verification

Production変更は無いため、既存full suiteの再実行は必須ではないが、確認のため実行した。

```
python -m pytest -q
# 1259 passed, 10 failed（既存の環境依存failure、Issue #125/#127時点のbaselineと一致）
```

probeスクリプトは再現手順として本ドキュメントへ結果を記録する方式を採用し、pytestの永続テストとしては追加しない。理由: (1) 対象がOS固有のプロセス終了挙動であり、Linux上で動くCIでは意味のある検証にならない、(2) `taskkill`/`tasklist`への依存や実プロセスの生成・終了を伴うためCI実行の安定性（flakiness）リスクが高い、(3) 既存の`tests/test_recovery_atomicity.py`等は`_is_pid_alive()`をmonkeypatchで固定する既存の設計（deterministic mock優先の既存方針）に既に沿っており、実プロセスでの検証は本調査で1回限り実施すれば十分と判断した。

参考のため、実行したprobe scriptの要旨をここに残す（実行環境: Windows 11、Python 3.10.11、pyenv-win。一時ディレクトリのみ使用・実行後は生成したdummyプロセスを全てtaskkillで後始末済み）。

```python
# 孫プロセスを生成するdummy worker（Tesseract外部CLI/PaddleOCRネストsubprocessを模擬）
import subprocess, sys, time
grandchild = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
print(f"GRANDCHILD_PID={grandchild.pid}")
time.sleep(60)

# 呼び出し側（_spawn_training_runner/_stop_training_workerの契約を模擬）
def spawn_like_production():
    process = subprocess.Popen([sys.executable, CHILD_SCRIPT], start_new_session=True, ...)
    return int(process.pid)  # Popenオブジェクトへの参照は保持しない

pid = spawn_like_production()
# ...（別のタイミングで）
try:
    os.killpg(pid, signal.SIGTERM)   # Windows: AttributeError
except Exception:
    os.kill(pid, signal.SIGTERM)     # worker本体は終了するが、grandchildは残る
```

Production変更が無いことを`git diff --stat main -- src/ frontend/src/`で確認した。

## Scope外（Out of Scope、実施しなかったこと）

- Job Lifecycle全面統合
- Shared Job Facade
- JobRepository SQLite変更
- Training algorithm変更
- GPU実モデルを使った破壊的停止テスト
- Frontend Job UI変更
- Epic #28 Consumer Migration
- 孫プロセス終了・`shutil.rmtree`保護等の実装（次Issue候補として記録するのみ）

## Future Work

- 推奨Issue: Windows環境でのTesseract/PaddleOCR孫プロセス終了対応（§Recommended Action 2）
- 推奨Issue: `delete_artifacts=True`時の`shutil.rmtree(run_dir)`のtry/except保護（§Recommended Action 3、`docs/10_KNOWN_LIMITATIONS.md`の既存rmtree課題と合わせて検討）
- Linux実機での同等probe実行（現状はPOSIX仕様からの妥当な推論のみ。CI環境で安全に実行できる形でのフォローアップがあれば検証を強化できる）
- `persisted PIDだけでprocess identityを安全に判断できるか（PID再利用リスク）`は本Investigationでは深掘りしていない
