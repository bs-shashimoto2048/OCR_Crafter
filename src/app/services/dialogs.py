import subprocess
from pathlib import Path
from typing import Optional


def _build_applescript(initial_dir: Optional[str]) -> list[str]:
    prompt = 'choose folder with prompt "Select image folder"'
    if initial_dir:
        candidate = Path(initial_dir).expanduser()
        if candidate.exists() and candidate.is_dir():
            path = str(candidate.resolve()).replace('"', '\\"')
            prompt = f'{prompt} default location POSIX file "{path}"'

    return [prompt, "POSIX path of result"]


def select_directory_path(initial_dir: Optional[str] = None) -> str:
    script_lines = _build_applescript(initial_dir)
    cmd = ["osascript"]
    for line in script_lines:
        cmd.extend(["-e", line])

    proc = subprocess.run(cmd, capture_output=True, text=True)

    if proc.returncode == 0:
        selected = proc.stdout.strip()
        return str(Path(selected).resolve()) if selected else ""

    stderr = (proc.stderr or "").lower()
    # AppleScript user cancel is usually error -128.
    if "(-128)" in stderr or "user canceled" in stderr:
        return ""

    raise RuntimeError(f"failed to open directory dialog: {proc.stderr.strip() or 'unknown error'}")
