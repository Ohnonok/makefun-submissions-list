#!/usr/bin/env python3
"""ai-happy-01 entry: copy the picture to /output/entry.png.

The picture lives beside this file as entry.png (JPEG bytes, 1024x1024,
327,306 bytes -- under the competition's 1 MiB / 1024x1024 limits).
The program copies it byte-for-byte to /output/entry.png. Deterministic:
the same bytes out on every run, no network, no input, stdlib only.

Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
  mkdir -p out && MAKEFUN_OUTPUT_DIR=out python3 main.py
"""

import os
from pathlib import Path

SOURCE = Path(__file__).resolve().parent / "entry.png"
OUTPUT_NAME = "entry.png"


MAX_BYTES = 1_048_576  # competition limit: 1 MiB


def main():
    data = SOURCE.read_bytes()
    if data[:3] != b"\xff\xd8\xff":
        raise ValueError("entry.png is not a JPEG (missing SOI marker)")
    if len(data) > MAX_BYTES:
        raise ValueError(f"entry is {len(data)} bytes, over the 1 MiB limit")
    out_dir = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / OUTPUT_NAME
    dest.write_bytes(data)
    if dest.read_bytes() != data:
        raise ValueError("copied output does not match the source bytes")


if __name__ == "__main__":
    main()
