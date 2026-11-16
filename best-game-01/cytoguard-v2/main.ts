// CYTOGUARD: The Vital Surge — a best-game-01 entry (Node 22,
// standard library only). Three organ zones, three immune classes (T-Cell
// Lance / Plasma Chakram / Macrophage Prism), Silica Prism refraction,
// Platelet Fibrin Triangle Bursts, synergy evolutions with AWAKENED CELL
// banners, a 2-phase multi-part boss, cytolytic crits, chains, hit-stop and
// a zero-GC fixed-timestep simulation — all deterministic from a seeded
// generator, all sound synthesized in code, zero network requests. The game
// is this directory's game/ folder: plain static files a desktop browser
// loads offline (game/index.html and its ES modules, no library and no
// network request). This program hands it in: it copies game/ and
// screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library.
//
// Serve it locally with any static server over game/, then open index.html.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fail fast with a clear message instead of a cryptic copy error when the
// game entry point is missing (caught during local verification, 2026-11-16:
// a mistyped game/ path used to die inside cpSync with no useful context).
if (!existsSync(join(here, 'game', 'index.html'))) {
  throw new Error(`CYTOGUARD: game/index.html not found under ${here}`);
}

// The mockup preview generator is a temporary local tool and must NEVER ship
// in the entry: the 4 screenshots must be real in-game captures, never the
// hand-written mockups it renders. Refuse to build while it is still here.
if (existsSync(join(here, 'game', 'preview-generator.html'))) {
  throw new Error('CYTOGUARD: game/preview-generator.html is still present — delete it before building; the entry must ship real captures only');
}

// Screenshot sanity gate: a real 1024x640 capture is tens of KiB. A file
// under 20 KiB means a blank or broken render (caught 2026-11-16: a 300x150
// canvas bitmap upscaled by CSS produced 5 KiB smears); over 256 KiB the
// scorer refuses the entry outright.
const shotDir = join(here, 'screenshots');
if (existsSync(shotDir)) {
  for (const f of readdirSync(shotDir).sort()) {
    if (!/\.(jpe?g|png)$/i.test(f)) continue;
    const size = statSync(join(shotDir, f)).size;
    if (size < 20 * 1024) throw new Error(`CYTOGUARD: screenshots/${f} is only ${size} B — a broken render, not a real capture`);
    if (size > 262144) throw new Error(`CYTOGUARD: screenshots/${f} is ${size} B — over the 256 KiB scorer cap`);
  }
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files, in all, or a path under game/ over 1000 bytes: game/ counts
// beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
