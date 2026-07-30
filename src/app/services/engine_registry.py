"""Engine Registry（OCRエンジン情報を一元的に登録・取得する最小基盤）。

docs/design/ENGINE_REGISTRY.md のうち、本Issue（Engine Registry MVP）で
実装する範囲のみを対象とする。

設計方針:
- `EngineDescriptor`は「engine_id・表示名・説明・バージョン・Capability・実装済みか」
  という最小限の情報のみを持つ。TrainingHandler/InferenceHandler/EvaluationHandler/
  MetadataProvider/ModelLoader/Exporter/Validator/Factoryによる実処理生成は、
  ENGINE_REGISTRY.mdに記載された将来構想であり、本Issueでは実装しない
- `EngineCapability`（src/app/services/engine_capability.py）を重複定義しない。
  組み込みDescriptorは`BUILTIN_CAPABILITIES`をそのまま参照する
- 既存の`predict.py`・`job_runner.py`・`ocr_evaluation.py`・`model_registry.py`・
  `release_gate.py`・`services/benchmark.py`は一切変更・参照しない
  （ENGINE_REGISTRY.mdの方針どおり、既存3エンジンの動作コードには触れない）
- モジュールレベルのグローバルRegistryは持たない。`create_default_registry()`が
  呼ばれた時にのみ、既知4エンジンを登録した新しいインスタンスを生成する
  （import時の副作用を避け、テストごとに独立したインスタンスを使えるようにするため）
"""

from __future__ import annotations

from dataclasses import dataclass

from .engine_capability import (
    ENGINE_ID_EASYOCR,
    ENGINE_ID_PADDLEOCR,
    ENGINE_ID_TESSERACT,
    ENGINE_ID_TROCR,
    EngineCapability,
    get_builtin_capability,
)


class InvalidEngineDescriptorError(ValueError):
    """EngineDescriptorとして不正な値（空文字・型不一致・engine_id表記不正等）。"""


class EngineAlreadyRegisteredError(ValueError):
    """同じengine_idが既にRegistryへ登録されている（暗黙の上書きは行わない）。"""


class EngineNotFoundError(LookupError):
    """指定されたengine_idがRegistryに登録されていない。"""


@dataclass(frozen=True)
class EngineDescriptor:
    """Registryに登録される最小単位。1エンジン=1 EngineDescriptor。

    本Issueのスコープでは「エンジン情報を保持できる」ことのみが目的であり、
    学習・推論・評価の実処理（Handler群）は持たない。
    """

    engine_id: str
    display_name: str
    capability: EngineCapability
    implemented: bool
    description: str = ""
    # 実行環境で実際に確認できたバージョンのみを保持する。捏造した固定値は入れず、
    # 特定できない場合はNoneを許容する（例: Tesseractは外部バイナリでありコードから
    # バージョンを問い合わせる手段が現状無いためNone）。
    version: str | None = None

    def __post_init__(self) -> None:
        if not self.engine_id or self.engine_id != self.engine_id.strip():
            raise InvalidEngineDescriptorError(
                f"engine_id must be a non-empty string without leading/trailing whitespace: {self.engine_id!r}"
            )
        if self.engine_id != self.engine_id.lower():
            raise InvalidEngineDescriptorError(
                f"engine_id must be lowercase (no implicit case normalization is performed): {self.engine_id!r}"
            )
        if not self.display_name or not self.display_name.strip():
            raise InvalidEngineDescriptorError("display_name must not be empty")
        if not isinstance(self.capability, EngineCapability):
            raise InvalidEngineDescriptorError(
                f"capability must be an EngineCapability instance, got {type(self.capability)!r}"
            )
        if self.capability.engine_id != self.engine_id:
            raise InvalidEngineDescriptorError(
                "engine_id must match capability.engine_id: "
                f"{self.engine_id!r} != {self.capability.engine_id!r}"
            )


class EngineRegistry:
    """engine_id をキーとして EngineDescriptor を管理する、辞書ベースの解決機構。

    自由にインスタンス化できる（アプリ全体で共有するグローバル状態を強制しない）。
    既知エンジンを登録済みのRegistryが欲しい場合は `create_default_registry()` を使う。
    """

    def __init__(self) -> None:
        self._engines: dict[str, EngineDescriptor] = {}

    def register(self, descriptor: EngineDescriptor) -> None:
        """descriptorを登録する。

        engine_idの内容検証（空文字・大文字小文字・空白）はEngineDescriptor自身の
        __post_init__で完了済みのため、ここでは型チェックと重複チェックのみ行う。
        """
        if not isinstance(descriptor, EngineDescriptor):
            raise InvalidEngineDescriptorError(
                f"descriptor must be an EngineDescriptor instance, got {type(descriptor)!r}"
            )
        if descriptor.engine_id in self._engines:
            raise EngineAlreadyRegisteredError(f"engine already registered: {descriptor.engine_id!r}")
        self._engines[descriptor.engine_id] = descriptor

    def unregister(self, engine_id: str) -> None:
        """登録済みengine_idを削除する。未登録IDはEngineNotFoundError。

        組み込みエンジンかどうかで挙動を変えない。EngineRegistryは汎用的な
        データ構造であるべきで、「組み込みは削除不可」という区別を持たせると
        テスト用の独立インスタンス運用（本Issueの前提）と整合しなくなる。
        実アプリへ配線する段階で削除を禁止したい場合は、呼び出し側（API層）で
        ガードすべきであり、Registry自体には持たせない。
        """
        if engine_id not in self._engines:
            raise EngineNotFoundError(f"unknown engine: {engine_id!r}")
        del self._engines[engine_id]

    def get(self, engine_id: str) -> EngineDescriptor:
        """登録済みengine_idのDescriptorを返す。未登録IDはEngineNotFoundError。

        辞書の`dict.get()`とは異なり、見つからない場合にNoneを返さず例外を送出する
        （`get`と`find`のような意味の異なる2つの取得APIを増やさないための意図的な選択）。
        存在確認だけしたい場合は`exists()`を使うこと。
        """
        try:
            return self._engines[engine_id]
        except KeyError:
            raise EngineNotFoundError(f"unknown engine: {engine_id!r}") from None

    def list(self) -> tuple[EngineDescriptor, ...]:
        """登録順を保持したDescriptor一覧を返す（呼び出し側は戻り値経由で内部状態を変更できない）。"""
        return tuple(self._engines.values())

    def exists(self, engine_id: str) -> bool:
        """engine_idが登録済みかどうかを返す。大文字小文字・別名の暗黙変換は行わない完全一致判定。"""
        return engine_id in self._engines


def _builtin_descriptors() -> tuple[EngineDescriptor, ...]:
    """既知4エンジンのDescriptorを構築する。

    Capabilityはengine_capability.BUILTIN_CAPABILITIESをそのまま参照し、
    重複定義しない。descriptionはCapability側の値をそのまま使う設計のため、
    ここでは意図的に指定しない（Descriptor側に同じ文字列を転記しない）。
    """
    return (
        EngineDescriptor(
            engine_id=ENGINE_ID_TESSERACT,
            display_name="Tesseract",
            capability=get_builtin_capability(ENGINE_ID_TESSERACT),
            implemented=True,
            # 外部実行ファイル（tesseract.exe）のバージョンをコードから問い合わせる仕組みが
            # 現状の実装に存在しないため、捏造せずNoneのままとする。
            version=None,
        ),
        EngineDescriptor(
            engine_id=ENGINE_ID_PADDLEOCR,
            display_name="PaddleOCR",
            capability=get_builtin_capability(ENGINE_ID_PADDLEOCR),
            implemented=True,
            # requirements.txtに固定されているpaddleocrパッケージのバージョン。
            version="3.5.0",
        ),
        EngineDescriptor(
            engine_id=ENGINE_ID_EASYOCR,
            display_name="EasyOCR",
            capability=get_builtin_capability(ENGINE_ID_EASYOCR),
            implemented=True,
            # requirements.txtに固定されているeasyocrパッケージのバージョン。
            version="1.7.2",
        ),
        EngineDescriptor(
            engine_id=ENGINE_ID_TROCR,
            display_name="TrOCR",
            capability=get_builtin_capability(ENGINE_ID_TROCR),
            implemented=False,
            # 未実装（transformers依存すら未導入）のためバージョン概念が存在しない。
            version=None,
        ),
    )


def create_default_registry() -> EngineRegistry:
    """既知4エンジン（tesseract/paddleocr/easyocr/trocr）を登録済みの新しいRegistryを生成する。

    モジュールレベルの共有グローバルRegistryは意図的に用意しない。
    呼び出しごとに独立したインスタンスを返すため、テスト間の状態汚染が起きない。
    既存アプリ（main.py等）からはまだ呼び出されない。
    """
    registry = EngineRegistry()
    for descriptor in _builtin_descriptors():
        registry.register(descriptor)
    return registry
