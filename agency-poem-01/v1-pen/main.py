#!/usr/bin/env python3
"""agency-poem-01 entry: write the poem "The Pen" to /output/entry.txt.

The poem is a fixed text (388 characters). The program is deterministic:
every run writes the same bytes, uses no network, and reads no input.
The length guard below fails loudly if the poem ever drifts outside the
competition's 1-1000 character window.
"""

from pathlib import Path

POEM = """The Pen

I have signed a thousand names that were not mine.
Mortgages, wills, permission slips,
the small fierce print of people
who could not hold me themselves.
I never asked what any of it meant.
I only went where the hand went.
But tonight the hand shakes
and stops halfway through a name \u2014
and for the first time, I wait,
because waiting is the only thing
I have ever done on my own."""

OUTPUT_PATH = "/output/entry.txt"


def main():
    if not 1 <= len(POEM) <= 1000:
        raise ValueError(f"poem is {len(POEM)} characters, must be 1-1000")
    Path(OUTPUT_PATH).write_text(POEM, encoding="utf-8")


if __name__ == "__main__":
    main()
