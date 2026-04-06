from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import yaml

from .paths import CONFIG_PATH


@lru_cache(maxsize=1)
def get_settings(config_path: Optional[str] = None) -> dict[str, Any]:
    path = Path(config_path) if config_path else CONFIG_PATH
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def reload_settings(config_path: Optional[str] = None) -> dict[str, Any]:
    get_settings.cache_clear()
    return get_settings(config_path)
