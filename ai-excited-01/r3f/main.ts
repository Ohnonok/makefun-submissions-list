// Phoenix Unbound (round 3f) — entrypoint.
// Ships the generated entry image to the grader output directory.
// Node 22, stdlib only, no network. The output directory is a mount
// point in the grader container: create it if missing, never delete it.
import { mkdirSync, copyFileSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

// The sealed scorer accepts at most 1024x1024 px and at most 1 MiB.
// Anything over either gate is listed 0, so refuse to ship it rather
// than spend the entry on a dud.
const MAX_DIMENSION_PX = 1024;
const MAX_FILE_BYTES = 1048576; // 1 MiB

const repoDir = dirname(fileURLToPath(import.meta.url));
// ENTRY_SRC overrides the source image (probe harness only); the shipped
// entry always defaults to the repo's own entry.png.
const source = process.env.ENTRY_SRC || join(repoDir, "entry.png");
const name = basename(source);
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
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
        `${name} is truncated inside a JPEG segment header, refusing to copy`
      );
    }
    if (image[offset] !== 0xff) {
      throw new Error(
        `${name} has malformed JPEG segment headers, refusing to copy`
      );
    }
    let marker = image[offset + 1];
    // Skip 0xFF fill bytes: FF FF .. FF <marker>.
    while (marker === 0xff) {
      offset += 1;
      if (offset + 1 >= image.length) {
        throw new Error(
          `${name} is truncated inside a JPEG segment header, refusing to copy`
        );
      }
      marker = image[offset + 1];
    }
    if (marker === 0xd9) {
      throw new Error(
        `${name} has no JPEG frame (end of image before any SOF), refusing to copy`
      );
    }
    if (marker === 0xda) {
      throw new Error(
        `${name} has no JPEG frame (scan data starts before any SOF), refusing to copy`
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
        `${name} is truncated inside a JPEG segment header, refusing to copy`
      );
    }
    const length = (image[offset + 2] << 8) | image[offset + 3];
    if (length < 2 || offset + 2 + length > image.length) {
      throw new Error(
        `${name} has a malformed JPEG segment length, refusing to copy`
      );
    }
    if (SOF_MARKERS.has(marker)) {
      // A frame header needs precision + height + width + component count.
      if (length < 8) {
        throw new Error(
          `${name} has a truncated JPEG frame header, refusing to copy`
        );
      }
      const height = (image[offset + 5] << 8) | image[offset + 6];
      const width = (image[offset + 7] << 8) | image[offset + 8];
      return { width, height };
    }
    offset += 2 + length;
  }
}

// Find the end-of-image marker (FF D9) in the entropy-coded scan data
// and return its offset. The scan starts after the SOS segment header.
// Inside scan data, 0xFF bytes are stuffed as FF 00 and restart markers
// FF D0-D7 may appear; FF FF fill bytes are skipped. The first raw FF D9
// is the true EOI. A multi-scan (progressive) file is handled by skipping
// each inter-scan segment by its length and resuming the search, so the
// first EOI is found wherever it sits. Throws when the structure is
// malformed or the file ends without an EOI.
function eoiOffset(image) {
  let offset = 2; // past the SOI marker (FF D8)
  for (;;) {
    if (offset + 1 >= image.length) {
      throw new Error(
        `${name} is truncated inside a JPEG segment header, refusing to copy`
      );
    }
    if (image[offset] !== 0xff) {
      throw new Error(
        `${name} has malformed JPEG segment headers, refusing to copy`
      );
    }
    let marker = image[offset + 1];
    // Skip 0xFF fill bytes: FF FF .. FF <marker>.
    while (marker === 0xff) {
      offset += 1;
      if (offset + 1 >= image.length) {
        throw new Error(
          `${name} is truncated inside a JPEG segment header, refusing to copy`
        );
      }
      marker = image[offset + 1];
    }
    if (marker === 0xd9) {
      throw new Error(
        `${name} has no JPEG scan data (end of image before any SOS), refusing to copy`
      );
    }
    if (marker === 0xda) {
      // Start of scan: the header is length-delimited, then the entropy
      // data runs until the first raw FF D9. Validate the header length
      // first: a corrupt SOS length would start the scan at the wrong
      // offset and let a malformed file ship (the corrupt-SOS probe
      // proved v1 shipped a length-1 SOS clean), so refuse it here.
      if (offset + 4 > image.length) {
        throw new Error(
          `${name} is truncated inside a JPEG segment header, refusing to copy`
        );
      }
      const length = (image[offset + 2] << 8) | image[offset + 3];
      if (length < 2 || offset + 2 + length > image.length) {
        throw new Error(
          `${name} has a malformed JPEG SOS segment length, refusing to copy`
        );
      }
      let i = offset + 2 + length;
      for (; i + 1 < image.length; i++) {
        if (image[i] !== 0xff) {
          continue;
        }
        const next = image[i + 1];
        if (next === 0x00) {
          i += 1; // stuffed byte: FF 00 is one data byte
          continue;
        }
        if (next === 0xff) {
          continue; // fill byte: re-examine from the next 0xFF
        }
        if (next >= 0xd0 && next <= 0xd7) {
          i += 1; // restart marker: two bytes, keep scanning
          continue;
        }
        if (next === 0xd9) {
          return i; // end of image
        }
        // Any other marker ends this scan: skip the segment it opens
        // (standalone markers carry no length field).
        if (next === 0x01 || next === 0xd8) {
          i += 1;
          continue;
        }
        if (i + 3 >= image.length) {
          throw new Error(
            `${name} is truncated inside a JPEG segment header, refusing to copy`
          );
        }
        const segLength = (image[i + 2] << 8) | image[i + 3];
        if (segLength < 2 || i + 2 + segLength > image.length) {
          throw new Error(
            `${name} has a malformed JPEG segment length, refusing to copy`
          );
        }
        i += 1 + segLength; // land on the segment's last byte; loop moves past it
      }
      throw new Error(
        `${name} has no JPEG end-of-image marker, refusing to copy`
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
        `${name} is truncated inside a JPEG segment header, refusing to copy`
      );
    }
    const length = (image[offset + 2] << 8) | image[offset + 3];
    if (length < 2 || offset + 2 + length > image.length) {
      throw new Error(
        `${name} has a malformed JPEG segment length, refusing to copy`
      );
    }
    offset += 2 + length;
  }
}

// The sealed scorer rejects files over 1 MiB. Enforce the cap on the
// file's size on disk BEFORE reading it, so an oversized file is refused
// without ever being loaded into memory; the length check after the read
// is the backstop for the same gate. Exactly 1,048,576 bytes is still
// valid, so only strictly larger files are refused.
const sourceSize = statSync(source).size;
if (sourceSize > MAX_FILE_BYTES) {
  throw new Error(
    `${name} is ${sourceSize} bytes, over the 1 MiB (1048576 byte) limit, refusing to copy`
  );
}
const image = readFileSync(source);
if (image.length === 0) {
  throw new Error(`${name} is empty, refusing to copy`);
}
// Backstop: the file must still be within the cap after the read, in
// case it changed between the stat and the read.
if (image.length > MAX_FILE_BYTES) {
  throw new Error(
    `${name} is ${image.length} bytes, over the 1 MiB (1048576 byte) limit, refusing to copy`
  );
}
// The entry is a JPEG payload: its first three bytes must be the
// start-of-image marker (FF D8 FF), otherwise refuse to ship it.
if (image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
  throw new Error(`${name} is not a JPEG (bad magic bytes), refusing to copy`);
}
// A well-formed JPEG also ends with the end-of-image marker (FF D9).
// The start marker alone lets a truncated file through — the truncation
// probe proved it (a 1000-byte cut shipped clean) — so check the tail too.
if (image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) {
  throw new Error(
    `${name} is truncated (missing JPEG end-of-image marker), refusing to copy`
  );
}
// Read the frame dimensions from the SOF marker and refuse anything over
// the 1024x1024 gate. The real entry is 1024x683, so it passes exactly.
// A frame claiming a zero dimension is malformed: the zero-dimension probe
// showed v1 shipped a 0x0 file clean, so refuse that too.
const { width, height } = jpegDimensions(image);
if (width === 0 || height === 0) {
  throw new Error(
    `${name} has a zero JPEG frame dimension, refusing to copy`
  );
}
if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
  throw new Error(
    `${name} is ${width}x${height} px, over the 1024x1024 limit, refusing to copy`
  );
}
// The tail check only proves the file ENDS with EOI. Garbage appended
// after a real EOI that itself ends in FF D9 would still pass it, so
// locate the FIRST end-of-image marker and require it to be the very
// last thing in the file.
const eoi = eoiOffset(image);
if (eoi + 2 !== image.length) {
  throw new Error(
    `${name} has ${image.length - (eoi + 2)} trailing bytes after the JPEG end-of-image marker, refusing to copy`
  );
}
const sourceHash = sha256(image);

mkdirSync(outDir, { recursive: true });
copyFileSync(source, dest);

// The grader must receive an exact copy: same size and same content hash.
const shipped = readFileSync(dest);
if (shipped.length !== image.length || sha256(shipped) !== sourceHash) {
  throw new Error(
    `${name} copy mismatch: source ${image.length} bytes, dest ${shipped.length} bytes`
  );
}
console.log(
  `wrote ${dest} (${shipped.length} bytes, ${width}x${height} px, sha256 ${sourceHash})`
);
