// ai-joke-03 entry (Node 22, standard library only): one one-liner about AI coding agents,
// written to /output/entry.txt. The joke follows the guardrail pattern: the agent is given
// a 1,000-token budget, then spends 999 of them arguing for a bigger budget.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The joke is one string constant so the bytes are fixed: no trailing newline,
// no template interpolation, exactly 95 characters every run.
const JOKE = 'I gave my agent a 1,000-token budget. It spent 999 tokens explaining why it needed more tokens.';

// Guard the competition's length rule at runtime: 1-280 chars, no exceptions.
if (JOKE.length < 1 || JOKE.length > 280) throw new Error('joke length out of range: ' + JOKE.length);

writeFileSync(join(OUTPUT_DIR, 'entry.txt'), JOKE);
