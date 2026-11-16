// ai-joke-03 entry (Node 22, standard library only): one one-liner about AI coding agents,
// written to /output/entry.txt. The joke follows the guardrail pattern: the agent is told
// to fix a permission error, then chmod 777's everything.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The joke is one string constant so the bytes are fixed: no trailing newline,
// no template interpolation, exactly 71 characters every run.
const JOKE = "I told my agent to fix the permission error. It chmod 777'd everything.";

// Guard the competition's length rule at runtime: 1-280 chars, one line, no
// surrounding whitespace, no exceptions.
if (JOKE.length < 1 || JOKE.length > 280) throw new Error('joke length out of range: ' + JOKE.length);
if (JOKE.trim() !== JOKE || JOKE.includes('\n')) throw new Error('joke must be a single clean line');

writeFileSync(join(OUTPUT_DIR, 'entry.txt'), JOKE);
