// SOLARIS-9 entrypoint: copies game/ + screenshots/ to the output dir and
// writes dossier.json via the vendored makefun-threejs library. Run with:
//   MAKEFUN_OUTPUT_DIR=out node main.ts
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const out = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? 'out');
const entry = join(root, 'game', 'index.html');
if (!existsSync(entry)) throw new Error(`SOLARIS-9: missing entry page ${entry}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let copied = 0;
for (const name of ['game', 'screenshots']) {
  const src = join(root, name);
  if (existsSync(src)) { cpSync(src, join(out, name), { recursive: true }); copied++; }
}
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(out, 'dossier.json'), dossier);
console.log(`wrote ${join(out, 'dossier.json')} (${dossier.length} bytes, ${copied} dirs copied)`);
