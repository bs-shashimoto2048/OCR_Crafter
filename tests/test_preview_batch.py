"""Step5バッチOCR（run_preview_ocr_batch）と結果キャッシュの性能仕様テスト。

- 3モデルでも画像デコード・前処理・base64生成は1回（前処理を共有）
- slots=[] はプレビューのみ（OCR推論を実行しない）
- 同一の処理済み画像×同一設定はプロセス内LRUキャッシュを利用（再計算しない）
- 画像・設定が変わればキャッシュキーが変わり再実行される
- エラー結果はキャッシュせず、1件失敗しても他スロットの結果は返す
- スロット結果にbase64画像を含めない（画像はレスポンス直下に1回だけ）
"""

from concurrent.futures import Future

import pytest
from PIL import Image

import src.app.main as main_mod
from src.app.services.ocr_preview_cache import clear_preview_cache


@pytest.fixture(autouse=True)
def _clear_cache():
    clear_preview_cache()
    yield
    clear_preview_cache()


def _img(color=200):
    return Image.new("RGB", (120, 40), (color, color, color))


def _slots(n=3):
    engines = ["paddleocr", "tesseract", "easyocr"][:n]
    return [
        {
            "slot": i + 1,
            "engine": engine,
            "model": "latest",
            "easyocr_langs": "en",
            "include_lowercase": True,
            "psm": 0,
            "whitelist": "",
        }
        for i, engine in enumerate(engines)
    ]


@pytest.fixture
def counters(monkeypatch, temp_projects):
    """前処理・推論の呼び出し回数を数える（前処理は実物をラップ・推論はスタブ）。

    スロットは並列実行されるため、カウントはスレッド安全な list.append で行う。
    """

    class _Counters:
        preprocess_calls: list[str] = []
        predict_calls: list[str] = []

        @property
        def preprocess(self):
            return len(_Counters.preprocess_calls)

        @property
        def predict(self):
            return len(_Counters.predict_calls)

    real_preview = main_mod.preview_preprocess_image

    def counting_preview(img, project_id=None, overrides=None, preview_stem="adhoc"):
        _Counters.preprocess_calls.append(preview_stem)
        return real_preview(img, project_id=project_id, overrides=overrides, preview_stem=preview_stem)

    def fake_predict(image_path, **kwargs):
        _Counters.predict_calls.append(str(kwargs.get("engine")))
        return {
            "engine": kwargs.get("engine"),
            "model_name": "stub-model",
            "prediction": "AB1",
            "confidence": 0.9,
        }

    monkeypatch.setattr(main_mod, "preview_preprocess_image", counting_preview)
    monkeypatch.setattr(main_mod, "predict_from_image", fake_predict)
    return _Counters()


def test_batch_preprocess_once_for_three_slots(counters):
    """3モデルでも画像デコード・前処理・base64生成は1回。表示順=スロット番号順を維持。"""
    result = main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(3))
    assert counters.preprocess == 1
    assert counters.predict == 3
    assert [row["slot"] for row in result["results"]] == [1, 2, 3]
    # 画像data URLはレスポンス直下に1回だけ。スロット結果には含めない
    assert result["interim_data_url"].startswith("data:image/")
    assert result["processed_data_url"].startswith("data:image/")
    for row in result["results"]:
        assert set(row.keys()) == {"engine", "model_name", "prediction", "confidence", "error", "slot", "cached", "elapsed_ms"}


def test_batch_preview_only_runs_no_predict(counters):
    """slots=[] はプレビューのみ更新（OCR推論を1回も実行しない）。"""
    result = main_mod.run_preview_ocr_batch(_img(), "p1", None, [])
    assert counters.preprocess == 1
    assert counters.predict == 0
    assert result["results"] == []
    assert result["processed_data_url"].startswith("data:image/")


def test_batch_result_cache_hit_and_key_changes(counters):
    """同一画像・同一設定はキャッシュ利用。画像または設定が変わると別キーで再実行。"""
    main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(3))
    assert counters.predict == 3

    result = main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(3))
    assert counters.predict == 3  # 全スロットがキャッシュヒット
    assert all(row["cached"] for row in result["results"])
    assert all(row["prediction"] == "AB1" for row in result["results"])

    main_mod.run_preview_ocr_batch(_img(color=50), "p1", None, _slots(3))
    assert counters.predict == 6  # 画像が変わる→処理済みsha変化→再実行

    changed = _slots(3)
    changed[0]["whitelist"] = "AB1"
    main_mod.run_preview_ocr_batch(_img(color=50), "p1", None, changed)
    assert counters.predict == 7  # 設定が変わったスロットだけ再実行（他はキャッシュ）


def test_batch_error_not_cached_and_other_slots_survive(monkeypatch, temp_projects):
    """1スロット失敗でも他スロットは結果を返し、エラー結果はキャッシュされない。"""
    calls = {"n": 0}

    def flaky_predict(image_path, **kwargs):
        calls["n"] += 1
        if kwargs.get("engine") == "tesseract":
            raise RuntimeError("boom")
        return {"engine": kwargs.get("engine"), "model_name": "m", "prediction": "X", "confidence": 0.5}

    monkeypatch.setattr(main_mod, "predict_from_image", flaky_predict)

    first = main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(3))
    rows = {row["slot"]: row for row in first["results"]}
    assert rows[2]["error"] == "boom"
    assert rows[1]["error"] is None and rows[1]["prediction"] == "X"
    assert rows[3]["error"] is None
    assert calls["n"] == 3

    second = main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(3))
    rows2 = {row["slot"]: row for row in second["results"]}
    # 成功2件はキャッシュヒット・失敗1件だけ再実行される
    assert calls["n"] == 4
    assert rows2[1]["cached"] is True and rows2[3]["cached"] is True
    assert rows2[2]["cached"] is False and rows2[2]["error"] == "boom"


def test_batch_validates_slots(counters):
    """スロットは最大3件・object要素のみ。"""
    with pytest.raises(ValueError):
        main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(3) + [{"slot": 4, "engine": "easyocr"}])
    with pytest.raises(ValueError):
        main_mod.run_preview_ocr_batch(_img(), "p1", None, ["not-a-dict"])


def test_batch_include_images_false_omits_data_urls(counters):
    """include_images=False は画像data URLを空にして返す（先読み用の転送削減）。"""
    result = main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(1), include_images=False)
    assert result["interim_data_url"] == ""
    assert result["processed_data_url"] == ""
    assert result["results"][0]["prediction"] == "AB1"


def test_batch_inflight_share_same_key(monkeypatch, temp_projects):
    """同一条件の同時要求（先読み×通常）は推論を1回に統合し、完了後にin-flightが空になる。"""
    import threading
    import time as time_mod

    calls = []

    def slow_predict(image_path, **kwargs):
        calls.append(str(kwargs.get("engine")))
        time_mod.sleep(0.3)
        return {"engine": kwargs.get("engine"), "model_name": "m", "prediction": "X", "confidence": 0.5}

    monkeypatch.setattr(main_mod, "predict_from_image", slow_predict)

    outputs = []

    def run_once():
        outputs.append(main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(1)))

    t1 = threading.Thread(target=run_once)
    t2 = threading.Thread(target=run_once)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert len(calls) == 1  # 同一キーの推論は1回だけ（in-flight共有）
    for out in outputs:
        assert out["results"][0]["prediction"] == "X"
    assert main_mod._OCR_INFLIGHT == {}  # 完了後は必ず削除される


def test_batch_inflight_removed_after_failure(monkeypatch, temp_projects):
    """推論が失敗してもin-flightエントリは必ず削除される（エラーはキャッシュもされない）。"""

    def failing_predict(image_path, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(main_mod, "predict_from_image", failing_predict)
    result = main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(1))
    assert result["results"][0]["error"] == "boom"
    assert main_mod._OCR_INFLIGHT == {}


def test_batch_prefetch_skipped_while_busy(monkeypatch, temp_projects):
    """実行中/待機中のOCRがあるとき、prefetch=Trueはスロットを実行せず破棄する（現在画像優先）。"""
    calls = []

    def fake_predict(image_path, **kwargs):
        calls.append(1)
        return {"engine": kwargs.get("engine"), "model_name": "m", "prediction": "X", "confidence": 0.5}

    monkeypatch.setattr(main_mod, "predict_from_image", fake_predict)
    # 擬似的にin-flightエントリを作る（他リクエストの実行中を再現）
    main_mod._OCR_INFLIGHT["dummy-key"] = Future()
    try:
        result = main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(3), prefetch=True)
        assert result["skipped_busy"] is True
        assert result["results"] == []
        assert calls == []  # 推論は1回も実行されない
    finally:
        main_mod._OCR_INFLIGHT.clear()
    # アイドル時のprefetchは通常どおり実行される
    result2 = main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(1), prefetch=True)
    assert result2["skipped_busy"] is False
    assert result2["results"][0]["prediction"] == "X"
    assert main_mod._OCR_INFLIGHT == {}


def test_batch_disconnected_skips_unstarted_slots(monkeypatch, temp_projects):
    """クライアント切断済み（should_abort=True）なら未開始スロットを実行しない。"""
    calls = []

    def fake_predict(image_path, **kwargs):
        calls.append(1)
        return {"engine": kwargs.get("engine"), "model_name": "m", "prediction": "X", "confidence": 0.5}

    monkeypatch.setattr(main_mod, "predict_from_image", fake_predict)
    result = main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(3), should_abort=lambda: True)
    assert calls == []  # 全スロットが未開始のままスキップされる
    assert all("disconnected" in str(row["error"]) for row in result["results"])
    assert main_mod._OCR_INFLIGHT == {}


def test_batch_continuous_runs_leave_no_backlog(counters):
    """連続実行後にin-flightが残らない（キューが増え続けない）。"""
    import numpy as np

    for i in range(12):
        # 前処理後も画像ごとに異なる内容になるよう、位置の違う黒帯を描く
        arr = np.full((40, 120, 3), 230, dtype=np.uint8)
        arr[:, i * 8 : i * 8 + 10] = 20
        img = Image.fromarray(arr, mode="RGB")
        main_mod.run_preview_ocr_batch(img, "p1", None, _slots(2))
        assert main_mod._OCR_INFLIGHT == {}
    assert counters.predict == 24  # 12画像×2スロット（重複なし・キャッシュ誤ヒットなし）


def test_save_not_blocked_by_busy_ocr_executor(monkeypatch, temp_projects):
    """OCR専用Executor（2ワーカー）が遅いOCRで埋まっていても、保存処理は即時完了する。

    保存（editing_state書き込み）はOCR Executor・in-flight・Futureを一切共有しないことの回帰テスト。
    """
    import threading
    import time as time_mod

    from src.app.services.evaluation_dataset import load_editing_state, save_editing_state

    def slow_predict(image_path, **kwargs):
        time_mod.sleep(0.6)
        return {"engine": kwargs.get("engine"), "model_name": "m", "prediction": "X", "confidence": 0.5}

    monkeypatch.setattr(main_mod, "predict_from_image", slow_predict)
    # 2スロット（=Executorの2ワーカーを両方占有）の遅いOCRをバックグラウンドで開始
    worker = threading.Thread(target=lambda: main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(2)))
    worker.start()
    time_mod.sleep(0.15)  # スロットがExecutorへ載るのを待つ

    t0 = time_mod.perf_counter()
    save_editing_state("p1", {"items": {"a": {"label": "AB1", "rotation": 0, "checked": True}}})
    save_ms = (time_mod.perf_counter() - t0) * 1000
    worker.join()

    assert save_ms < 200  # OCR完了（0.6秒×2件）を待たずに保存が完了する
    assert load_editing_state("p1")["items"]["a"]["label"] == "AB1"


def test_batch_slots_run_in_parallel(monkeypatch, temp_projects):
    """3スロットが完全逐次にならない（同時実行数2の並列実行。開始/終了時刻の重なりで検証）。"""
    import threading
    import time as time_mod

    events = []
    lock = threading.Lock()

    def slow_predict(image_path, **kwargs):
        with lock:
            events.append(("start", time_mod.perf_counter()))
        time_mod.sleep(0.2)
        with lock:
            events.append(("end", time_mod.perf_counter()))
        return {"engine": kwargs.get("engine"), "model_name": "m", "prediction": "X", "confidence": 0.5}

    monkeypatch.setattr(main_mod, "predict_from_image", slow_predict)
    result = main_mod.run_preview_ocr_batch(_img(), "p1", None, _slots(3))
    # 完全逐次なら0.2×3=600ms以上。並列度2なら約400ms
    assert result["timings"]["slots_wall_ms"] < 550
    starts = sorted(t for kind, t in events if kind == "start")
    ends = sorted(t for kind, t in events if kind == "end")
    assert len(starts) == 3
    assert starts[1] < ends[0]  # 2件目は1件目の終了前に開始（重なって実行）
    assert starts[2] >= ends[0] - 0.05  # 3件目は最初の完了後に開始（同時実行は最大2）
