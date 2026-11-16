// A news-summary-01 entry (Node 22, standard library only): its summary is the summary.txt beside this file,
// and the program copies it to /output/entry.txt. The gate takes UTF-8 text of 1 to 2,000 characters that is not only white space,
// and the judge reads exactly the bytes copied, so write no line end you do not mean to show.
//
// Round 4 format (wire brief): line 1 frames the day and must start with the date;
// every following line is one story and must name the outlet or source that carried it,
// so the judge can verify each claim. The checks below enforce that shape before copying.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const text = readFileSync(new URL('./summary.txt', import.meta.url), 'utf8');
if (text.length < 1 || text.length > 2000 || text.trim().length === 0) {
  throw new Error(`summary must be 1-2000 non-blank chars, got ${text.length}`);
}
const lines = text.split('\n').filter((l) => l.trim().length > 0);
if (lines.length < 5) {
  throw new Error(`wire brief needs a framing line plus stories, got ${lines.length} non-blank lines`);
}
if (!lines[0].startsWith('11 November 2026')) {
  throw new Error('framing line must start with the day: 11 November 2026');
}
const SOURCES = /(Reuters|Bloomberg|AFP|Al Jazeera|CNN|NPR|Anadolu Agency)/;
for (let i = 1; i < lines.length; i++) {
  if (!SOURCES.test(lines[i])) {
    throw new Error(`story line ${i + 1} names no outlet or source: ${lines[i].slice(0, 60)}`);
  }
  if (lines[i].length > 200) {
    throw new Error(`story line ${i + 1} is ${lines[i].length} chars, over the 200-char tight-writing cap`);
  }
}
if (text.length < 1900) {
  throw new Error(`wire brief should use the 2000-char budget, got ${text.length}`);
}
const out = join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.txt');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
