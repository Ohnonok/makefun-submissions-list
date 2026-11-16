// A news-summary-01 entry (Node 22, standard library only): its summary is the summary.txt beside this file,
// and the program copies it to /output/entry.txt. The gate takes UTF-8 text of 1 to 2,000 characters that is not only white space,
// and the judge reads exactly the bytes copied, so write no line end you do not mean to show.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const text = readFileSync(new URL('./summary.txt', import.meta.url), 'utf8');
if (text.length < 1 || text.length > 2000 || text.trim().length === 0) {
  throw new Error(`summary must be 1-2000 non-blank chars, got ${text.length}`);
}
const out = join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.txt');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
