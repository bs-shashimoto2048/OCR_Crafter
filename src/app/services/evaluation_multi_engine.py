"""Multi-engine Evaluation API Integration（Issue #79）。

**目的は新しい評価ロジックを作ることではない。** 既存の`EvaluationDispatcher`（Issue #67）・
`EvaluationRunner`（Issue #69）・4つのEngine Predictor（Tesseract/PaddleOCR/EasyOCR/TrOCR、
Issue #71/#73/#75/#77）を、`POST /api/ocr/evaluate`から利用可能にするComposition Root
（`build_predictor()`）と、複数エンジンの評価実行をオーケストレーションする薄いService
（`run_multi_engine_evaluation()`）を提供するだけである。

```text
POST /api/ocr/evaluate（main.py）
        ↓
run_multi_engine_evaluation()（本モジュール。Composition Root + Orchestration）
        ↓
EvaluationDispatcher（target単位で都度生成） → build_predictor()で解決したPredictor
        ↓
EvaluationRunner.run()（target単位）
        ↓
OcrEvaluationResult → 本モジュールでlegacy互換の応答shapeへ変換
```

## 既存API調査の結論（実コード追跡）

既存`POST /api/ocr/evaluate`（`main.py::api_ocr_evaluate`）は`ocr_evaluation.py::evaluate_ocr()`を
呼ぶのみであり、これは**Tesseract専用のモノリシック実装**である。`build_recognizer()`は
`engine != "tesseract"`を`ValueError`で拒否するため、既存の呼び出し方では他Engineへ到達できない
（＝既存の呼び出し元は100%`engine="tesseract"`のみである。他Engine指定は既存コードで既に
HTTP 400になっており、今回の変更前後でこの点の後方互換に影響はない）。

`evaluate_ocr()`の核となる特徴（本Issueで壊してはならない既存契約）:

- **複数target横断の比較機能**（base/trained 2モデル比較、`comparison`ブロック）
- **評価前処理planはtarget横断で共有**（`resolve_evaluation_preprocess_plan()`。
  `training`/`training_individual`モードはTesseract学習後モデルの`training_preprocess`
  メタデータに依存する、Tesseract固有の概念）
- **`rows[]`は画像単位、`results[]`はtarget単位**という2軸構造

## 統合方針（実コード調査の結果として決定）

既存`evaluate_ocr()`・`build_recognizer()`・`ocr_evaluation.py`全体は**一切変更しない**
（Tesseract legacy挙動への回帰リスクをゼロにするため）。代わりに、`main.py`側で
リクエストのtarget集合を見て経路を分岐する。

```python
if all(t.engine == "tesseract" for t in req.targets):
    result = evaluate_ocr(...)          # 既存経路。1バイトも変更しない
else:
    result = run_multi_engine_evaluation(...)  # 本モジュール（新規）
```

**この分岐は既存の呼び出し元に対して完全に後方互換である**: 既存の呼び出し元は
必ず`engine="tesseract"`のみを指定する（他Engineは既存コードで既に拒否されていたため）。
したがって既存の全呼び出しは無条件に`if`分岐の`True`側（完全に無変更の`evaluate_ocr()`）を
通り、応答は1バイトも変わらない。`else`側（本モジュール）は、これまで`ValueError`で
拒否されていた「非Tesseractエンジンを含むリクエスト」という**新規にのみ到達可能な経路**で
あり、既存の後方互換に影響しない。

`else`側では、リクエストに1つでも非Tesseractエンジンが含まれる場合、**target集合全体
（Tesseractを含む）**を本モジュールのDispatcher/Runner経由の新経路で処理する（Tesseract
targetも`TesseractEvaluationPredictor`経由になるが、Issue #71で既存`build_recognizer()`＋
`recognize_line()`と出力が完全一致することを検証済みのため、退行リスクはない）。これにより
「mixed tesseract + 非tesseractリクエスト」を扱う際に2つの異なる集計ロジックを1レスポンス内で
併存させる複雑さを避けられる。

## preprocessing方針（実コード調査の結果として再判断）

既存`evaluate_ocr()`内の`_prepare_eval_input()`は、前処理plan適用後に必ず
`preprocess_ocr_image(..., image_shape=[1, 48, 320], strong=False)`（Tesseract CRNN学習
パイプライン向けの固定canvas正規化: グレースケール・48×320）を通す。これは各Predictor
Issue（#71/#73/#75/#77）が明記した契約「Predictorは前処理を一切実行しない・image引数は
前処理済みパスをそのまま渡す」の「前処理」がTesseract固有の入力整形を意味しているとは
考えにくく、PaddleOCR/EasyOCR/TrOCRへこの固定canvas正規化を強制するのは**Predictorへ
engine非依存前処理を押し込む**ことになり、各Predictor Issueの原則に反する。

したがって、本モジュールの新経路では**`preprocess_ocr_image()`によるTesseract固有の入力
整形を一切行わない**。評価前処理は以下の2モードのみをサポートする（`training`/
`training_individual`はTesseract学習後モデルの`training_preprocess`メタデータに依存する
概念であり、他Engineには存在しないため本Issueのscope外とし、明示的に`ValueError`で拒否する）。

- `none`（既定）: 画像を一切加工せず、解決済みの元画像パスをそのままPredictorへ渡す
- `manual`: 既存`preprocess.py::apply_eval_preprocess()`（grayscale/binarize、Engine非依存の
  単純な画像変換）のみを適用し、結果を一時ファイルへ保存してPredictorへ渡す

## Composition Root

Predictorは**API requestごと**に、実際にリクエストされたtargetの分だけ構築する
（グローバルなmutable Registry・プロセス全体で共有するSingletonは新設しない）。
`EvaluationDispatcher`もtargetごとに個別のインスタンスを生成する（同一engine_idで
異なるmodel/optionsを指定した複数targetを同時に扱えるようにするため。単一Dispatcherへ
複数Predictorを同一engine_idで`register()`すると2件目が例外になるため、この設計を
意図的に避けている）。

TrOCR/PaddleOCR/EasyOCR/Tesseractいずれのbuild-once契約も壊さない: 各Predictorの構築
（重量物のload）はtargetあたり1回のみで、そのtargetに属する全Sample（評価対象画像全件）で
同一インスタンスを再利用する（`EvaluationRunner.run()`が`resolve()`をRunあたり1回だけ
呼ぶ既存契約をそのまま利用）。

## Request/Responseの互換性

`OcrEvalTarget.engine`/`.model`/`.options`は既存Schema（Issue #63で追加済み）のまま
一切変更していない。`options`はこれまで未使用（legacy `build_recognizer()`は読まない）
だったため、各Predictorへのengine固有オプション（EasyOCRの`languages`、PaddleOCRの
`language`/`use_angle_cls`、TrOCRの`device`/`local_files_only`、Tesseractの
`charset`/`psm`個別上書き）を`options`へ渡す形は、既存のドキュメント化された意図
（`OcrEvalTarget.options`のdocstring）通りの後方互換な利用である。新しいRequest
フィールドは追加していない。

Responseは新経路専用の応答shapeを返す（既存`evaluate_ocr()`のレスポンス形状とは別。
新経路は既存呼び出し元が到達できなかった経路のため、既存Response契約への影響はない）。
`OcrEvaluationResult`をそのまま返さず、legacy応答のキー命名（`targets`/`rows`/`count`等）に
できるだけ寄せた辞書へ変換し、UI等が将来対応しやすいようにする。`comparison`は
base/trained概念がEngine横断では一般化しないため、本Issueでは常に`None`とする
（Future Work）。
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Optional

from .easyocr_evaluation_predictor import EasyOCREvaluationPredictor
from .engine_registry import create_default_registry, resolve_engine_id
from .evaluation_dispatcher import (
    EnginePredictor,
    EvaluationDispatcher,
    UnknownEvaluationEngineError,
    UnsupportedEvaluationEngineError,
)
from .evaluation_runner import EvaluationInputSample, EvaluationRunner
from .ocr_evaluation import _read_gt_csv, _resolve_image  # 既存の純粋関数を再利用（変更しない）
from .paddleocr_evaluation_predictor import PaddleOCREvaluationPredictor
from .preprocess import apply_eval_preprocess, parse_eval_preprocess
from .tesseract_evaluation_predictor import TesseractEvaluationPredictor
from .trocr_evaluation_predictor import TrOCREvaluationPredictor

_UNSUPPORTED_PREPROCESS_MODES = {"training", "training_individual"}

_KNOWN_ENGINE_BUILDERS = {"tesseract", "paddleocr", "easyocr", "trocr"}


def validate_engine_supported(engine: str) -> str:
    """canonical engine名を解決し、Backend Registry上でEvaluation対応かを検証する。

    `EvaluationDispatcher.resolve()`と同じ判定順序（Unknown→Unsupported）を、
    Predictor構築より前に行う（TrOCR/PaddleOCR等のPredictor構築は重量物のロードを
    伴うため、無効なengine名に対して無駄なロードを発生させないための事前検証）。
    Dispatcher自体もtargetごとに新規生成するため、ここで使うRegistryはこの検証専用の
    使い捨てインスタンスでよい（モジュールレベルの共有Registryは持たない設計方針に合わせる）。
    """
    registry = create_default_registry()
    normalized = resolve_engine_id(engine, registry=registry)
    if normalized is None:
        raise UnknownEvaluationEngineError(f"unknown evaluation engine: {engine!r}")
    descriptor = registry.get(normalized)
    if not descriptor.capability.supports_evaluation:
        raise UnsupportedEvaluationEngineError(f"engine does not support evaluation: {normalized!r}")
    return normalized


def _resolve_option(options: dict[str, Any], key: str, default: Any) -> Any:
    """`options[key]`を「未指定」と「明示的なfalsy値」を区別して解決する。

    マージ前レビューMajor #1の是正: `options.get(key) or default`はPythonの`or`演算子が
    `0`・`""`等のfalsy値を「未指定」と誤認し、既存Schemaが認める正当な値（`psm=0`・
    `charset=""`=「空文字=whitelistなし」、`OcrEvaluateRequest.charset`のdocstring参照）を
    サイレントにdefaultへ書き換えてしまっていた。

    ルール（既存Schemaの意味を優先し、新しい優先順位を推測で追加しない）:
    - キー自体が存在しない → default（未指定として扱う。既存`OcrEvalTarget.options`の
      「未指定時は既存OcrEvaluateRequestレベルのcharset/psmが適用される」という
      docstring通りの既存後方互換ルール）
    - キーが存在し値が`None` → default扱い（`options`辞書全体の既定値`{}`同様、
      「明示的にNoneを指定する」ことと「未指定」を区別する意味が既存Schema上存在しないため、
      Noneは他Predictor（例: TrOCRの`device`）と同じく「未指定」として扱う）
    - キーが存在し値がfalsyでも`None`以外（`0`・`""`等） → その値をそのまま保持する
    """
    if key not in options:
        return default
    value = options[key]
    if value is None:
        return default
    return value


def build_predictor(
    engine: str,
    *,
    project_id: Optional[str],
    model: str,
    options: dict[str, Any],
    default_charset: str,
    default_psm: int,
) -> EnginePredictor:
    """canonical engine名から対応するEvaluation Predictorを構築する（build-once）。

    呼び出し前に`validate_engine_supported()`でUnknown/Unsupportedの判定を済ませておく想定
    （本関数は既知の4エンジン以外を渡された場合、防御的に`ValueError`を送出する）。

    `options`はEngine固有の追加設定（既存`OcrEvalTarget.options`、未指定時は空dict）。
    各Predictorが実際に使わないキーは単純に無視される（Predictor側はkwargsの形状を
    検証しない既存契約のまま）。
    """
    normalized = str(engine or "").strip().lower()
    if normalized == "tesseract":
        return TesseractEvaluationPredictor(
            project_id,
            model=model,
            charset=str(_resolve_option(options, "charset", default_charset)),
            psm=int(_resolve_option(options, "psm", default_psm)),
        )
    if normalized == "paddleocr":
        return PaddleOCREvaluationPredictor(
            project_id=project_id,
            model=model,
            language=str(options.get("language") or "en"),
            use_angle_cls=bool(options.get("use_angle_cls") or False),
        )
    if normalized == "easyocr":
        languages = options.get("languages")
        return EasyOCREvaluationPredictor(
            project_id=project_id,
            languages=list(languages) if languages else None,
        )
    if normalized == "trocr":
        return TrOCREvaluationPredictor(
            project_id=project_id,
            model=model,
            device=options.get("device"),
            local_files_only=bool(options.get("local_files_only") or False),
        )
    # validate_engine_supported()を経由していれば到達しない防御的分岐。
    raise ValueError(f"unsupported engine for evaluation: {normalized}")


def _prepare_input_path(image_path: Path, manual_preprocess: Optional[dict[str, Any]]) -> tuple[Path, bool]:
    """評価入力パスを解決する。戻り値は(パス, 一時ファイルか)。

    `manual_preprocess`が指定されなければ画像を一切加工せず元パスをそのまま返す
    （Tesseract固有のOCR入力整形=`preprocess_ocr_image()`は行わない。上記モジュール
    docstring「preprocessing方針」参照）。
    """
    if not manual_preprocess:
        return image_path, False
    from PIL import Image

    with Image.open(image_path) as opened:
        processed = apply_eval_preprocess(opened.convert("RGB"), manual_preprocess)
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
    tmp_path = Path(tmp.name)
    tmp.close()
    processed.save(tmp_path)
    return tmp_path, True


def run_multi_engine_evaluation(
    project_id: Optional[str],
    image_dir: str,
    gt_csv: str,
    targets: list[dict[str, Any]],
    charset: str,
    psm: int,
    eval_preprocess: Optional[dict[str, Any]] = None,
    preprocess_mode: Optional[str] = None,
) -> dict[str, Any]:
    """複数Engine（Tesseract/PaddleOCR/EasyOCR/TrOCR）を横断する評価を実行する。

    既存`evaluate_ocr()`（Tesseract専用）は一切呼ばない・変更しない。target集合に
    非Tesseractエンジンが1つでも含まれる場合にのみ、本関数が呼ばれる想定
    （`main.py::api_ocr_evaluate`の分岐、モジュールdocstring参照）。
    """
    image_root = Path(image_dir or "").expanduser()
    if not image_root.exists() or not image_root.is_dir():
        raise FileNotFoundError(f"評価用画像フォルダが見つかりません: {image_dir}")

    gt = _read_gt_csv(gt_csv)

    if not targets:
        raise ValueError("評価対象モデルがありません")

    normalized_mode = str(preprocess_mode or "").strip().lower()
    if not normalized_mode:
        normalized_mode = "manual" if eval_preprocess is not None else "none"
    if normalized_mode in _UNSUPPORTED_PREPROCESS_MODES:
        raise ValueError(
            f"preprocess_mode={normalized_mode!r} は非Tesseractエンジンを含む評価では"
            "未対応です（Tesseract学習後モデルのtraining_preprocessメタデータに依存する"
            "概念のため）。'none'または'manual'を指定してください。"
        )
    manual_preprocess: Optional[dict[str, Any]] = None
    if normalized_mode == "manual" and eval_preprocess is not None:
        parsed = parse_eval_preprocess(eval_preprocess)
        if parsed["grayscale"] or parsed["binarize"]:
            manual_preprocess = parsed

    # 全targetのengineをPredictor構築より前に検証する（Unknown/Unsupportedなtargetが
    # 1つでもあれば、他のtarget用の重量Predictor（TrOCR/PaddleOCR等）を無駄にロードしない）。
    parsed_targets: list[dict[str, Any]] = []
    for target in targets:
        engine = str((target or {}).get("engine") or "tesseract").strip().lower()
        model = str((target or {}).get("model") or "latest").strip()
        options = dict((target or {}).get("options") or {})
        validate_engine_supported(engine)
        parsed_targets.append({"engine": engine, "model": model, "options": options})

    # target単位でPredictorをbuild-once（グローバルSingletonは持たない。本request限り）。
    resolved_targets: list[dict[str, Any]] = []
    for parsed_target in parsed_targets:
        engine = parsed_target["engine"]
        model = parsed_target["model"]
        options = parsed_target["options"]
        # Dispatcherはtargetごとに新規生成する（同一engineで複数target=複数modelを
        # 同時に扱えるようにするため。register()の「同一キー二重登録禁止」制約を回避）。
        dispatcher = EvaluationDispatcher()
        predictor = build_predictor(
            engine,
            project_id=project_id,
            model=model,
            options=options,
            default_charset=charset,
            default_psm=psm,
        )
        dispatcher.register(engine, predictor)
        runner = EvaluationRunner(dispatcher)
        resolved_targets.append(
            {"engine": engine, "model": model, "options": options, "predictor": predictor, "runner": runner}
        )

    rows_out: list[dict[str, Any]] = []
    skipped_missing = 0
    per_target_samples: list[list[EvaluationInputSample]] = [[] for _ in resolved_targets]
    per_target_images: list[list[str]] = [[] for _ in resolved_targets]
    temp_paths: list[Path] = []

    try:
        for name, expected in gt.items():
            image_path = _resolve_image(image_root, name)
            if image_path is None:
                skipped_missing += 1
                continue
            input_path, is_temp = _prepare_input_path(image_path, manual_preprocess)
            if is_temp:
                temp_paths.append(input_path)
            for index, _entry in enumerate(resolved_targets):
                per_target_samples[index].append(
                    EvaluationInputSample(image=str(input_path), ground_truth=expected)
                )
                per_target_images[index].append(name)

        if not any(per_target_samples):
            raise ValueError(
                "評価対象の画像が見つかりませんでした。正解CSVの filename と画像フォルダ内のファイル名が"
                "一致しているか（拡張子・フォルダ）を確認してください。"
            )

        # target単位でRunnerを1回だけ実行する（build-once・Sample Failure Boundaryは
        # EvaluationRunnerの既存契約をそのまま利用。ここでは呼び出すだけで変更しない）。
        target_results = []
        for index, entry in enumerate(resolved_targets):
            samples = per_target_samples[index]
            result = entry["runner"].run(engine_id=entry["engine"], samples=samples, model_ref=entry["model"])
            target_results.append(result)
    finally:
        for tmp_path in temp_paths:
            tmp_path.unlink(missing_ok=True)

    # rows: 画像単位・target横断（既存evaluate_ocr()と同じ2軸構造に寄せる）。
    image_count = len(per_target_images[0]) if per_target_images else 0
    for row_index in range(image_count):
        image_name = per_target_images[0][row_index]
        expected = gt[image_name]
        results_for_row: list[dict[str, Any]] = []
        for target_index, entry in enumerate(resolved_targets):
            sample_result = target_results[target_index].samples[row_index]
            results_for_row.append(
                {
                    "model_label": f"{entry['engine']}:{entry['model']}",
                    "engine": entry["engine"],
                    "model": entry["model"],
                    "prediction": sample_result.prediction,
                    "confidence": sample_result.confidence,
                    "match": sample_result.exact_match,
                    "edit_distance": sample_result.edit_distance,
                    "error": sample_result.error,
                }
            )
        rows_out.append({"image": image_name, "expected": expected, "results": results_for_row})

    targets_summary: list[dict[str, Any]] = []
    for entry, result in zip(resolved_targets, target_results):
        metrics = result.metrics
        cer = metrics.cer
        targets_summary.append(
            {
                "label": f"{entry['engine']}:{entry['model']}",
                "engine": entry["engine"],
                "model": entry["model"],
                "is_base": False,
                "total": metrics.sample_count,
                "correct": metrics.exact_match_count,
                "accuracy": metrics.exact_match_rate,
                "accuracy_percent": round(metrics.exact_match_rate * 100.0, 2) if metrics.exact_match_rate is not None else None,
                "mismatch_count": metrics.sample_count - metrics.exact_match_count,
                "cer": cer,
                "cer_percent": round(cer * 100.0, 2) if cer is not None else None,
                "char_accuracy": metrics.character_accuracy,
                "char_accuracy_percent": (
                    round(metrics.character_accuracy * 100.0, 2) if metrics.character_accuracy is not None else None
                ),
                "confusions": [
                    {"kind": c.kind, "from": c.expected, "to": c.predicted, "count": c.count}
                    for c in result.confusions[:10]
                ],
                "confusions_full": [
                    {"kind": c.kind, "from": c.expected, "to": c.predicted, "count": c.count}
                    for c in result.confusions
                ],
                "mismatches": [
                    {"image": s.image, "expected": s.ground_truth, "prediction": s.prediction}
                    for s in result.samples
                    if s.exact_match is False
                ],
                "warnings": result.warnings,
                "engine_details": result.engine_details,
            }
        )

    return {
        "project_id": project_id,
        "image_dir": str(image_root.resolve()),
        "gt_csv": str(Path(gt_csv).expanduser().resolve()),
        "charset": charset,
        "psm": int(psm),
        "count": image_count,
        "gt_count": len(gt),
        "skipped_missing_image": skipped_missing,
        "preprocess_mode": normalized_mode,
        "eval_preprocess": manual_preprocess,
        "targets": targets_summary,
        "rows": rows_out,
        # base/trained比較はEngine横断では一般化しないため、本Issueでは実装しない（Future Work）。
        "comparison": None,
    }
