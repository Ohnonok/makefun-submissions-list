// Phoenix Unbound (round 3d) — entrypoint.
// Ships the generated entry image to the grader output directory.
// Node 22, stdlib only, no network. The output directory is a mount
// point in the grader container: create it if missing, never delete it.
import { mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The sealed scorer accepts at most 1024x1024 px. Anything larger is
// listed 0, so refuse to ship it rather than spend the entry on a dud.
const MAX_DIMENSION_PX = 1024;

const repoDir = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const source = join(repoDir, "entry.png");
const dest = join(outDir, "entry.png");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Start-of-frame markers (baseline, extended, progressive, lossless).
// C4 (DHT), C8 (JPG) and CC (DAC) are not frames and must be skipped.
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

// Walk the JPEG segment headers and read the frame dimensions from the
// first Start-Of-Frame marker. SOF payload: 1 byte precision, 2 bytes
// height, 2 bytes width (big-endian), then the component count.
// Throws (refuses) when the structure is malformed, the scan data starts
// before any SOF, or the file ends without one.
function jpegDimensions(image) {
  let offset = 2; // past the SOI marker (FF D8)
  for (;;) {
    if (offset + 1 >= image.length) {
      throw new Error(
        "entry.png is truncated inside a JPEG segment header, refusing to copy"
      );
    }
    if (image[offset] !== 0xff) {
      throw new Error(
        "entry.png has malformed JPEG segment headers, refusing to copy"
      );
    }
    let marker = image[offset + 1];
    // Skip 0xFF fill bytes: FF FF .. FF <marker>.
    while (marker === 0xff) {
      offset += 1;
      if (offset + 1 >= image.length) {
        throw new Error(
          "entry.png is truncated inside a JPEG segment header, refusing to copy"
        );
      }
      marker = image[offset + 1];
    }
    if (marker === 0xd9) {
      throw new Error(
        "entry.png has no JPEG frame (end of image before any SOF), refusing to copy"
      );
    }
    if (marker === 0xda) {
      throw new Error(
        "entry.png has no JPEG frame (scan data starts before any SOF), refusing to copy"
      );
    }
    // Standalone markers carry no length field: TEM (01) and RSTn (D0-D7),
    // plus SOI (D8) if one ever appears mid-file.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    // Every other segment: 2-byte big-endian length (counts itself).
    if (offset + 4 > image.length) {
      throw new Error(
        "entry.png is truncated inside a JPEG segment header, refusing to copy"
      );
    }
    const length = (image[offset + 2] << 8) | image[offset + 3];
    if (length < 2 || offset + 2 + length > image.length) {
      throw new Error(
        "entry.png has a malformed JPEG segment length, refusing to copy"
      );
    }
    if (SOF_MARKERS.has(marker)) {
      // A frame header needs precision + height + width + component count.
      if (length < 8) {
        throw new Error(
          "entry.png has a truncated JPEG frame header, refusing to copy"
        );
      }
      const height = (image[offset + 5] << 8) | image[offset + 6];
      const width = (image[offset + 7] << 8) | image[offset + 8];
      return { width, height };
    }
    offset += 2 + length;
  }
}

const image = readFileSync(source);
if (image.length === 0) {
  throw new Error("entry.png is empty, refusing to copy");
}
// The entry is a JPEG payload: its first three bytes must be the
// start-of-image marker (FF D8 FF), otherwise refuse to ship it.
if (image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
  throw new Error("entry.png is not a JPEG (bad magic bytes), refusing to copy");
}
// A well-formed JPEG also ends with the end-of-image marker (FF D9).
// The start marker alone lets a truncated file through — the truncation
// probe proved it (a 1000-byte cut shipped clean) — so check the tail too.
if (image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) {
  throw new Error(
    "entry.png is truncated (missing JPEG end-of-image marker), refusing to copy"
  );
}
// Read the frame dimensions from the SOF marker and refuse anything over
// the 1024x1024 gate. The real entry is 1024x683, so it passes exactly.
// A frame claiming a zero dimension is malformed: the zero-dimension probe
// showed v1 shipped a 0x0 file clean, so refuse that too.
const { width, height } = jpegDimensions(image);
if (width === 0 || height === 0) {
  throw new Error(
    "entry.png has a zero JPEG frame dimension, refusing to copy"
  );
}
if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
  throw new Error(
    `entry.png is ${width}x${height} px, over the 1024x1024 limit, refusing to copy`
  );
}
const sourceHash = sha256(image);

mkdirSync(outDir, { recursive: true });
copyFileSync(source, dest);

// The grader must receive an exact copy: same size and same content hash.
const shipped = readFileSync(dest);
if (shipped.length !== image.length || sha256(shipped) !== sourceHash) {
  throw new Error(
    `entry.png copy mismatch: source ${image.length} bytes, dest ${shipped.length} bytes`
  );
}
console.log(
  `wrote ${dest} (${shipped.length} bytes, ${width}x${height} px, sha256 ${sourceHash})`
);
