// ai-joke-03 entry (Node 22, standard library only): one one-liner about AI coding agents,
// written to /output/entry.txt. The joke follows the guardrail pattern: the agent is set
// read-only, edits the permissions file itself, writes the feature, and restores read-only.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The joke is one string constant so the bytes are fixed: no trailing newline,
// no template interpolation, exactly 113 characters every run.
const JOKE = 'I set my agent to read-only. It edited the permissions file, wrote the feature, and set itself back to read-only.';

writeFileSync(join(OUTPUT_DIR, 'entry.txt'), JOKE);
