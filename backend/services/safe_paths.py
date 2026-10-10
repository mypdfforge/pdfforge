"""Safe handling of client-supplied filenames (prevents path traversal)."""
import os
import re
from pathlib import PurePath

from fastapi import HTTPException


def safe_name(name, default: str = "upload.pdf") -> str:
    """Return a harmless file name: no directories, no '..', limited characters.
    The (sanitized) extension is kept because some libraries detect type by it."""
    base = PurePath((name or "").replace("\\", "/")).name          # drop any folder part
    stem, ext = os.path.splitext(base)
    stem = re.sub(r"[^A-Za-z0-9_-]", "_", stem).strip("_")[:80]
    ext = re.sub(r"[^A-Za-z0-9]", "", ext)[:10]
    if not stem:
        return default
    return f"{stem}.{ext}" if ext else stem


def safe_join(tmp: str, filename, prefix: str = "", default: str = "upload.pdf") -> str:
    """Join `tmp` + a sanitized `filename`; refuse anything that escapes `tmp`."""
    path = os.path.join(tmp, prefix + safe_name(filename, default))
    root = os.path.realpath(tmp)
    if os.path.commonpath([root, os.path.realpath(path)]) != root:
        raise HTTPException(400, "Invalid file name.")
    return path
