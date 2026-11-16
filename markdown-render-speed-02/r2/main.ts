// Driver for the markdown-render-speed-02 harness.
// Reads the case list, renders every document with parse(), and writes the
// HTML strings back out in the same order.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from './parse.js';

function renderAll() {
  const inDir = process.env.MAKEFUN_INPUT_DIR || '/input';
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  const raw = readFileSync(inDir + '/cases.json', 'utf8');
  const cases = JSON.parse(raw);
  const html = new Array(cases.length);
  for (let idx = 0; idx < cases.length; idx++) {
    html[idx] = parse(cases[idx].markdown);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outDir + '/html.json', JSON.stringify(html));
}

renderAll();
