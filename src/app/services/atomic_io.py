"""原子的ファイル書き込みとプロセス間ファイルロック（成果物・レジストリの整合性保証）。

- atomic_write_*: 同一ディレクトリの一時ファイルへ書き込み → os.replace（原子的リネーム）。
  途中失敗（プロセスクラッシュ・ディスクフル）で半端な内容が正式パスへ残らない
- file_lock: レジストリJSON（jobs.json / releases.json / experiments.json 等）の
  read-modify-write をプロセス間で排他する（uvicorn多重起動・CLI併用時の二重採番防止）。
  Windows=msvcrt.locking / POSIX=fcntl.flock。同一プロセス内はthreading.Lockを併用する
"""

from __future__ import annotations

import json
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

_INPROC_LOCKS: dict[str, threading.RLock] = {}
_INPROC_GUARD = threading.Lock()


def _tmp_path(path: Path) -> Path:
    # 同一ディレクトリに作る（別ボリュームだと os.replace が原子的でなくなるため）
    return path.parent / f".{path.name}.tmp.{os.getpid()}.{threading.get_ident()}"


def atomic_write_bytes(path: Path | str, data: bytes) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = _tmp_path(target)
    try:
        with tmp.open("wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)


def atomic_write_text(path: Path | str, text: str, encoding: str = "utf-8") -> None:
    atomic_write_bytes(path, text.encode(encoding))


def atomic_write_json(path: Path | str, payload: Any, indent: int = 2) -> None:
    atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=indent))


def atomic_replace(tmp_source: Path | str, target: Path | str) -> None:
    """一時パスへ生成済みの成果物（ZIP等）を正式パスへ原子的に置き換える。"""
    os.replace(str(tmp_source), str(target))


def _inproc_lock(key: str) -> threading.RLock:
    with _INPROC_GUARD:
        if key not in _INPROC_LOCKS:
            _INPROC_LOCKS[key] = threading.RLock()
        return _INPROC_LOCKS[key]


_LOCK_DEPTH: dict[tuple[str, int], int] = {}


@contextmanager
def file_lock(path: Path | str, timeout: float = 30.0) -> Iterator[None]:
    """`<path>.lock` によるプロセス間排他（+同一プロセス内はRLockで再入可能に排他）。

    レジストリのread-modify-write全体を囲んで使う。同一スレッドの再入時は
    OSレベルのロックを二重取得しない（深さ管理）。timeout超過はTimeoutError。
    """
    lock_path = Path(str(path) + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    key = str(lock_path.resolve())
    depth_key = (key, threading.get_ident())
    inproc = _inproc_lock(key)
    inproc.acquire()
    with _INPROC_GUARD:
        depth = _LOCK_DEPTH.get(depth_key, 0)
        _LOCK_DEPTH[depth_key] = depth + 1
    handle = None
    try:
        if depth == 0:
            handle = lock_path.open("a+b")
            deadline = time.monotonic() + timeout
            while True:
                try:
                    if os.name == "nt":
                        import msvcrt

                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError(f"ファイルロックの取得がタイムアウトしました: {lock_path}")
                    time.sleep(0.02)
        yield
    finally:
        with _INPROC_GUARD:
            _LOCK_DEPTH[depth_key] = max(0, _LOCK_DEPTH.get(depth_key, 1) - 1)
            if _LOCK_DEPTH[depth_key] == 0:
                _LOCK_DEPTH.pop(depth_key, None)
        if handle is not None:
            try:
                if os.name == "nt":
                    import msvcrt

                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
            handle.close()
        inproc.release()
