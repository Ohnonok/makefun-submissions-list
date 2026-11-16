// Phoenix Unbound — ai-excited-01 entry program.
// Copies the generated entry image to the grader output directory.
// Node 22, stdlib only. No network, no deletion of the output dir
// (/output is a mount point in the grader; mkdir + copy only).
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const dest = join(out, "entry.png");

mkdirSync(out, { recursive: true });
copyFileSync(join(here, "entry.png"), dest);

// Guard against a truncated copy: the grader must receive the whole image.
const { size } = statSync(dest);
if (size === 0) throw new Error("entry.png copied but empty");
console.log(`wrote ${dest} (${size} bytes)`);
