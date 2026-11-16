// Driver for markdown-render-speed-02: renders every case in
// /input/cases.json with parse() from parse.js and writes the HTML
// strings, in order, to /output/html.json. Env overrides
// MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR stand in for /input / /output
// outside the container. Deterministic: no clock, no randomness, no
// cross-case state — each case is rendered alone.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8'));
const cases = (Array.isArray(raw) ? raw : raw.cases) as { id: string; markdown: string }[];

const html: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  const md = cases[i].markdown;
  if (typeof md !== 'string') {
    throw new Error(`case ${cases[i].id ?? i} has no markdown string`);
  }
  html[i] = parse(md);
}

mkdirSync(outputDir, { recursive: true });
// Trailing newline: POSIX text-file hygiene; JSON.parse ignores it,
// so the scorer sees the identical array.
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html) + '\n');
