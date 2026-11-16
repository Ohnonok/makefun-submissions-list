// Phoenix Unbound — ai-excited-01 entry.
// Deterministic: copies the generated artwork (entry.png) to the output dir.
// Node 22 stdlib only. No randomness, no network, no clock reads.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
const SOURCE = new URL("./entry.png", import.meta.url);

if (!existsSync(SOURCE)) {
  throw new Error("entry.png missing next to main.ts");
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const dest = join(OUTPUT_DIR, "entry.png");
copyFileSync(SOURCE, dest);
const { size } = statSync(dest);
if (size === 0) throw new Error("entry.png copied but empty");
console.log("wrote", dest, `(${size} bytes)`);
