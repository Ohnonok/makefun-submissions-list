#!/usr/bin/env python3
"""news-image-01 entry: copy the picture to /output/entry.png.

The picture lives beside this file as entry.png (PNG, 1024x1024,
102,198 bytes -- under the competition's 1 MiB / 1024x1024 limits).
It is a newspaper front page summing up Friday 13 November 2026:
NVIDIA CEO resigns, Ukraine's 1,200-drone attack, the Gulf flashpoint,
Microsoft outage day 2, FAA grounds US flights, China's Pacific drills,
plus a bottom ticker. All text was rendered with PIL, so every label
is crisp and correctly spelled.

The program copies it byte-for-byte to /output/entry.png. Deterministic:
the same bytes out on every run, no network, no input, stdlib only.

Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
  mkdir -p out && MAKEFUN_OUTPUT_DIR=out python3 main.py
"""

import os
import struct
from pathlib import Path

SOURCE = Path(__file__).resolve().parent / "entry.png"
OUTPUT_NAME = "entry.png"

MAX_BYTES = 1_048_576  # competition limit: 1 MiB
MAX_DIM = 1024  # competition limit: 1024x1024 pixels


def main():
    data = SOURCE.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("entry.png is not a PNG (missing PNG signature)")
    if len(data) > MAX_BYTES:
        raise ValueError(f"entry is {len(data)} bytes, over the 1 MiB limit")
    # IHDR: width/height are big-endian uint32 at bytes 16..24.
    width, height = struct.unpack(">II", data[16:24])
    if width > MAX_DIM or height > MAX_DIM:
        raise ValueError(f"entry is {width}x{height}, over the 1024x1024 limit")
    out_dir = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / OUTPUT_NAME
    dest.write_bytes(data)
    if dest.read_bytes() != data:
        raise ValueError("copied output does not match the source bytes")


if __name__ == "__main__":
    main()
