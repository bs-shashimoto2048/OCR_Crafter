import platform
import subprocess
from pathlib import Path
from typing import Optional


def _resolve_initial_dir(initial_dir: Optional[str]) -> str:
    if initial_dir:
        candidate = Path(initial_dir).expanduser()
        if candidate.exists() and candidate.is_dir():
            return str(candidate.resolve())
    return str(Path.home())


def _normalize_extensions(extensions: Optional[list[str]]) -> list[str]:
    if not extensions:
        return []

    normalized: list[str] = []
    for ext in extensions:
        if not ext:
            continue
        ext = ext.strip().lower()
        if ext.startswith("."):
            ext = ext[1:]
        if ext:
            normalized.append(ext)
    return normalized


def _select_directory_windows(initial_dir: Optional[str] = None) -> str:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)

    try:
        selected = filedialog.askdirectory(
            title="Select image folder",
            initialdir=_resolve_initial_dir(initial_dir),
        )
        return str(Path(selected).resolve()) if selected else ""
    finally:
        root.destroy()


def _select_file_windows(
    initial_dir: Optional[str] = None,
    extensions: Optional[list[str]] = None,
) -> str:
    import tkinter as tk
    from tkinter import filedialog

    normalized_extensions = _normalize_extensions(extensions)

    filetypes = []
    if normalized_extensions:
        patterns = " ".join(f"*.{ext}" for ext in normalized_extensions)
        filetypes.append(("Supported files", patterns))
    filetypes.append(("All files", "*.*"))

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)

    try:
        selected = filedialog.askopenfilename(
            title="Select file",
            initialdir=_resolve_initial_dir(initial_dir),
            filetypes=filetypes,
        )
        return str(Path(selected).resolve()) if selected else ""
    finally:
        root.destroy()


def _build_applescript(initial_dir: Optional[str]) -> list[str]:
    prompt = 'choose folder with prompt "Select image folder"'
    if initial_dir:
        candidate = Path(initial_dir).expanduser()
        if candidate.exists() and candidate.is_dir():
            path = str(candidate.resolve()).replace('"', '\\"')
            prompt = f'{prompt} default location POSIX file "{path}"'

    return [prompt, "POSIX path of result"]


def select_directory_path(initial_dir: Optional[str] = None) -> str:
    if platform.system() == "Windows":
        return _select_directory_windows(initial_dir)

    script_lines = _build_applescript(initial_dir)
    cmd = ["osascript"]
    for line in script_lines:
        cmd.extend(["-e", line])

    proc = subprocess.run(cmd, capture_output=True, text=True)

    if proc.returncode == 0:
        selected = proc.stdout.strip()
        return str(Path(selected).resolve()) if selected else ""

    stderr = (proc.stderr or "").lower()
    if "(-128)" in stderr or "user canceled" in stderr:
        return ""

    raise RuntimeError(f"failed to open directory dialog: {proc.stderr.strip() or 'unknown error'}")


def _build_file_applescript(
    initial_dir: Optional[str],
    extensions: Optional[list[str]] = None,
) -> list[str]:
    prompt = 'choose file with prompt "Select file"'
    if extensions:
        ext_list = ", ".join([f'"{ext}"' for ext in extensions if ext])
        if ext_list:
            prompt = f"{prompt} of type {{{ext_list}}}"

    if initial_dir:
        candidate = Path(initial_dir).expanduser()
        if candidate.exists() and candidate.is_dir():
            path = str(candidate.resolve()).replace('"', '\\"')
            prompt = f'{prompt} default location POSIX file "{path}"'

    return [prompt, "POSIX path of result"]


def select_file_path(
    initial_dir: Optional[str] = None,
    extensions: Optional[list[str]] = None,
) -> str:
    if platform.system() == "Windows":
        return _select_file_windows(initial_dir, extensions)

    script_lines = _build_file_applescript(initial_dir, extensions=extensions)
    cmd = ["osascript"]
    for line in script_lines:
        cmd.extend(["-e", line])

    proc = subprocess.run(cmd, capture_output=True, text=True)

    if proc.returncode == 0:
        selected = proc.stdout.strip()
        return str(Path(selected).resolve()) if selected else ""

    stderr = (proc.stderr or "").lower()
    if "(-128)" in stderr or "user canceled" in stderr:
        return ""

    raise RuntimeError(f"failed to open file dialog: {proc.stderr.strip() or 'unknown error'}")