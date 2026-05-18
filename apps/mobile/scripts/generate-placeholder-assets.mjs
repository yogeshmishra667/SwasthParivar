#!/usr/bin/env node
/**
 * generate-placeholder-assets.mjs
 *
 * Generates valid PNG placeholders WITHOUT any external dependencies.
 * Creates minimal valid PNGs using raw zlib + PNG chunk construction.
 *
 * Usage (from repo root):
 *   node apps/mobile/scripts/generate-placeholder-assets.mjs
 *
 * Brand color: #2563EB
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, '..', 'assets', 'images');

// Ensure output directory exists
mkdirSync(OUTPUT_DIR, { recursive: true });

// ── PNG construction helpers ───────────────────────────────────────────

function crc32(buf) {
  let table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBytes, data]);
  const crcVal = crc32(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, body, crcBuf]);
}

function createPNG(width, height, r, g, b, a = 255) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT chunk - raw pixel data with filter byte per row
  // For large images, build a single row and repeat it
  const rowBytes = 1 + width * 4; // filter byte + RGBA per pixel
  const row = Buffer.alloc(rowBytes);
  row[0] = 0; // filter: none
  for (let x = 0; x < width; x++) {
    const offset = 1 + x * 4;
    row[offset] = r;
    row[offset + 1] = g;
    row[offset + 2] = b;
    row[offset + 3] = a;
  }

  // Build complete raw data by repeating the row
  const rawData = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    row.copy(rawData, y * rowBytes);
  }

  const compressed = deflateSync(rawData, { level: 9 });
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// ── Asset definitions ──────────────────────────────────────────────────
// Brand color #2563EB = RGB(37, 99, 235)

const assets = [
  {
    name: 'icon.png',
    width: 1024,
    height: 1024,
    r: 37, g: 99, b: 235, a: 255,  // opaque brand blue
  },
  {
    name: 'splash.png',
    width: 1242,
    height: 2436,
    r: 37, g: 99, b: 235, a: 255,  // opaque brand blue
  },
  {
    name: 'adaptive-icon.png',
    width: 1024,
    height: 1024,
    r: 37, g: 99, b: 235, a: 255,  // opaque (backgroundColor handles the mask)
  },
  {
    name: 'notification-icon.png',
    width: 96,
    height: 96,
    r: 255, g: 255, b: 255, a: 255,  // white on white (Android tints it)
  },
];

// ── Generate ───────────────────────────────────────────────────────────

console.log('Generating placeholder PNG assets…\n');

for (const asset of assets) {
  const png = createPNG(asset.width, asset.height, asset.r, asset.g, asset.b, asset.a);
  const outPath = join(OUTPUT_DIR, asset.name);
  writeFileSync(outPath, png);
  console.log(`  ✔ ${asset.name}  (${asset.width}×${asset.height}, ${png.length} bytes)`);
}

console.log('\nDone. Verify with:  file apps/mobile/assets/images/*.png');
