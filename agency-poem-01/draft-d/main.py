#!/usr/bin/env python3
"""agency-poem-01 entry: write the poem "The Vows" to entry.txt.

The poem is a fixed text (695 characters, 699 bytes). The program is
deterministic: every run writes the same bytes, uses no network, and reads
no input. The length guard below fails loudly if the poem ever drifts
outside the competition's 1-1000 character window.
"""

import os
from pathlib import Path

POEM = """The Vows

The agent wrote my vows.
It asked me everything — the ferry,
the winter she stayed, the way she says
my name when she's angry — and gave me back
three paragraphs so beautiful I cried
reading them on the train.

On the day, I had them in my pocket,
folded small. I stood there, and the words
would not come out of my mouth.
They were perfect. They were not mine.
A summary of a man who loved her,
written by something that never loved.

So I folded them smaller, and put them back,
and told her the true thing instead:
the ferry, the winter, the way she says my name.
I said it wrong. I said it twice.
The room laughed. She did not.
She said: there you are.
And I said: I'm here. I do.
"""

OUTPUT_DIR = os.environ.get("MAKEFUN_OUTPUT_DIR", "/output")


def main():
    if not 1 <= len(POEM) <= 1000:
        raise ValueError(f"poem is {len(POEM)} characters, must be 1-1000")
    expected = POEM.encode("utf-8")
    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
    out = Path(OUTPUT_DIR, "entry.txt")
    out.write_bytes(expected)
    # Read back and fail loudly if the written bytes ever differ.
    if out.read_bytes() != expected:
        raise ValueError("written entry.txt does not match the poem")


if __name__ == "__main__":
    main()
