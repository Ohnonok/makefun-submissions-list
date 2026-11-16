#!/usr/bin/env python3
"""food-picture-01 entry: copy the picture to /output/entry.png.

The picture lives beside this file as entry.png (JPEG bytes under the
name entry.png, which the competition allows -- the file is told apart
by its first bytes; 1024x1024, 284,546 bytes, under the 1 MiB /
1024x1024 limits). It is an ultra hyper-realistic close-up of a curry
ramen bowl: chopsticks lifting a tall, dramatic noodle pull of thick
wavy golden strands, glossy and glistening with rich golden curry
broth coating every strand and dripping off in drops, red chili flakes
speckled on the noodle strands themselves, steam curling up, a halved
ajitama egg with its yolk caught mid-drip and two plump glossy shrimp
spotlit front and centre beside deeply charred glistening chashu, and
crisp distinct condiments (scallion rings, nori, sesame, chili-oil
swirls) on a rich golden curry broth that dominates the bowl -- curry
colour first, no milky white -- on a dark wooden table. No text, no
watermark, no hands, no extra props -- the bowl fills the frame.
(v3: the broth was regenerated as curry -- the v2 milky-white tonkotsu
broth failed the user's curry brief; v3 adds chili speckles on the
noodles and shrimp, and spotlights the egg, chashu and shrimp.)

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


def jpeg_dimensions(data):
    """Return (width, height) from a JPEG's first SOF0/SOF2 marker."""
    if data[:2] != b"\xff\xd8":
        raise ValueError("entry is not a JPEG (missing SOI marker)")
    pos = 2
    while pos + 9 < len(data):
        if data[pos] != 0xFF:
            raise ValueError("corrupt JPEG marker stream")
        marker = data[pos + 1]
        if marker == 0xFF:  # padding byte: skip it, do not treat as a marker
            pos += 1
            continue
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            pos += 2
            continue
        size = struct.unpack(">H", data[pos + 2:pos + 4])[0]
        if size < 2:
            raise ValueError("corrupt JPEG segment size")
        if pos + 2 + size > len(data):
            raise ValueError("corrupt JPEG segment overruns the file")
        if marker in (0xC0, 0xC1, 0xC2):  # SOF0, SOF1, SOF2
            height, width = struct.unpack(">HH", data[pos + 5:pos + 9])
            return width, height
        pos += 2 + size
    raise ValueError("no JPEG SOF marker found")


def main():
    data = SOURCE.read_bytes()
    if len(data) > MAX_BYTES:
        raise ValueError(f"entry is {len(data)} bytes, over the 1 MiB limit")
    if data[-2:] != b"\xff\xd9":
        raise ValueError("entry is not a whole JPEG (missing EOI end marker)")
    width, height = jpeg_dimensions(data)
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
