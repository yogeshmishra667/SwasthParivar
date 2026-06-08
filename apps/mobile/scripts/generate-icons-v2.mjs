#!/usr/bin/env node
/**
 * generate-icons-v2.mjs — second-generation SwasthParivar launcher art.
 *
 * The v1 generator (generate-icons.mjs) produced a generic heart + ECG
 * pulse, which read as "yet another health app". v2 swaps in a more
 * distinctive mark: a three-petal lotus with a saffron tilak above it,
 * plus a faint ECG beat threading the base.
 *
 * Design rationale:
 *   - Lotus: pan-Indian symbol of well-being, family, dignity. Reads
 *     cleanly at 48dp launcher size where heart-shapes look anonymous.
 *   - Tilak (saffron dot): the one color accent. Survives the Android
 *     adaptive-icon circular crop because it sits well within the safe
 *     zone.
 *   - ECG pulse at the base: keeps the medical signal without dominating
 *     the silhouette.
 *
 * Pure JS — no SVG renderer or sharp install required. Same PNG
 * plumbing as v1.
 *
 * Outputs (matches app.json wiring):
 *   icon.png              1024×1024  rounded blue square, white lotus + tilak + pulse
 *   adaptive-icon.png     1024×1024  white lotus on transparent (smaller, inside safe zone)
 *   notification-icon.png 96×96      monochrome white lotus silhouette
 *   splash.png            1024×1024  square blue with large centred lotus
 *                                    (Expo `contain` resize scales it up
 *                                    to fit device width — splashShader
 *                                    makes the lotus ~65% of the canvas
 *                                    so it lands ~60% of screen width
 *                                    on real phones, vs ~10% with the
 *                                    previous full-bleed portrait image.)
 *
 * Usage (from repo root):
 *   pnpm --filter @swasth/mobile icon:build
 *   # or:
 *   node apps/mobile/scripts/generate-icons-v2.mjs
 *
 * The v1 script is preserved alongside this one — the user previews the
 * v2 output and either keeps it (delete v1, rename v2 to generate-icons)
 * or reverts to v1 (`node generate-icons.mjs`). DO NOT delete v1 until
 * v2 is approved.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, "..", "assets", "images");
mkdirSync(OUTPUT_DIR, { recursive: true });

// ── PNG plumbing (copied from v1 for self-contained runs) ────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crcBuf]);
};

const encodePNG = (width, height, rgba) => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowBytes = 1 + width * 4;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const dst = y * rowBytes;
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// ── Shape sampling ───────────────────────────────────────────────────

const insideRoundedSquare = (x, y, half = 0.95, radius = 0.22) => {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > half || ay > half) return false;
  const dx = Math.max(0, ax - (half - radius));
  const dy = Math.max(0, ay - (half - radius));
  return dx * dx + dy * dy <= radius * radius;
};

/**
 * Almond / petal shape. Anchored at `(cx, cy)` with the long axis
 * along the angle `theta` (radians from +x). `length` is the half-axis
 * along the petal, `width` is the half-axis across. Inside =
 * (rotated-xr² / length² + rotated-yr² / width²) ≤ 1 — i.e. a rotated
 * ellipse. At launcher size this reads as a clean petal.
 */
const insidePetal = (x, y, cx, cy, length, width, theta) => {
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const xr = dx * c + dy * s;
  const yr = -dx * s + dy * c;
  return (xr * xr) / (length * length) + (yr * yr) / (width * width) <= 1;
};

const insideCircle = (x, y, cx, cy, r) => {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
};

/**
 * ECG pulse: a thin horizontal band that spikes once. Returns true
 * inside the band. Compared to v1 the band is narrower and the spike
 * shallower — at icon scale subtle reads better than bold.
 */
const insidePulse = (x, y) => {
  const BAND_THICKNESS = 0.035;
  const SPIKE_START = -0.32;
  const SPIKE_PEAK_UP = -0.06;
  const SPIKE_PEAK_DOWN = 0.06;
  const SPIKE_END = 0.32;
  const SPIKE_HEIGHT = 0.18;
  let yTarget;
  if (x < SPIKE_START || x > SPIKE_END) {
    yTarget = 0;
  } else if (x < SPIKE_PEAK_UP) {
    const t = (x - SPIKE_START) / (SPIKE_PEAK_UP - SPIKE_START);
    yTarget = -SPIKE_HEIGHT * t;
  } else if (x < SPIKE_PEAK_DOWN) {
    const t = (x - SPIKE_PEAK_UP) / (SPIKE_PEAK_DOWN - SPIKE_PEAK_UP);
    yTarget = -SPIKE_HEIGHT + 1.5 * SPIKE_HEIGHT * t;
  } else {
    const t = (x - SPIKE_PEAK_DOWN) / (SPIKE_END - SPIKE_PEAK_DOWN);
    yTarget = SPIKE_HEIGHT * 0.5 * (1 - t);
  }
  return Math.abs(y - yTarget) < BAND_THICKNESS;
};

// Three petals: left tilted ≈+50°, centre upright, right tilted ≈-50°.
// All anchored just above the visual centre so the cluster floats high
// on the canvas, leaving room for the pulse at the bottom and the tilak
// above.
const PETAL_CY = -0.05;
const PETAL_LEN = 0.42;
const PETAL_WID = 0.16;

const insideLotus = (x, y) => {
  // Centre petal — vertical, slightly taller than the side petals.
  if (insidePetal(x, y, 0, PETAL_CY, PETAL_LEN + 0.04, PETAL_WID * 0.85, Math.PI / 2)) return true;
  // Right petal — leaning outward to the upper-right.
  if (
    insidePetal(
      x,
      y,
      0.18,
      PETAL_CY + 0.05,
      PETAL_LEN,
      PETAL_WID,
      Math.PI / 2 - 0.9,
    )
  ) {
    return true;
  }
  // Left petal — mirror of right.
  if (
    insidePetal(
      x,
      y,
      -0.18,
      PETAL_CY + 0.05,
      PETAL_LEN,
      PETAL_WID,
      Math.PI / 2 + 0.9,
    )
  ) {
    return true;
  }
  return false;
};

// ── Rasteriser ───────────────────────────────────────────────────────

const SAMPLES_PER_AXIS = 4;

const rasterise = (w, h, shader) => {
  const buf = Buffer.alloc(w * h * 4);
  const scale = 2 / Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES_PER_AXIS; sy++) {
        for (let sx = 0; sx < SAMPLES_PER_AXIS; sx++) {
          const fx = (px + (sx + 0.5) / SAMPLES_PER_AXIS - cx) * scale;
          const fy = (py + (sy + 0.5) / SAMPLES_PER_AXIS - cy) * scale;
          const [sr, sg, sb, sa] = shader(fx, fy);
          r += sr;
          g += sg;
          b += sb;
          a += sa;
        }
      }
      const n = SAMPLES_PER_AXIS * SAMPLES_PER_AXIS;
      const off = (py * w + px) * 4;
      buf[off] = Math.round(r / n);
      buf[off + 1] = Math.round(g / n);
      buf[off + 2] = Math.round(b / n);
      buf[off + 3] = Math.round(a / n);
    }
  }
  return buf;
};

// ── Palette ──────────────────────────────────────────────────────────

const BRAND_BLUE = [37, 99, 235]; // #2563EB
const SAFFRON = [245, 158, 11]; // #F59E0B
const WHITE = [255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

const TILAK_CX = 0;
const TILAK_CY = -0.42;
const TILAK_R = 0.055;

// ── Shaders ──────────────────────────────────────────────────────────

const launcherShader = (x, y) => {
  if (!insideRoundedSquare(x, y)) return TRANSPARENT;
  // Layer order (back→front): tilak, lotus, pulse cut-out.
  if (insideCircle(x, y, TILAK_CX, TILAK_CY, TILAK_R)) return [...SAFFRON, 255];
  if (insideLotus(x, y)) return [...WHITE, 255];
  // Subtle white pulse under the lotus.
  if (insidePulse(x, y - 0.42)) return [255, 255, 255, 110];
  return [...BRAND_BLUE, 255];
};

const adaptiveShader = (x, y) => {
  // Pull the lotus into the inner ~66% (Android adaptive-icon safe
  // zone). We multiply input coords by SAFE_SCALE>1 which shrinks the
  // resulting shape on the canvas.
  const SAFE_SCALE = 1.55;
  const hx = x * SAFE_SCALE;
  const hy = y * SAFE_SCALE;
  if (insideCircle(hx, hy, TILAK_CX, TILAK_CY, TILAK_R)) return [...SAFFRON, 255];
  if (insideLotus(hx, hy)) return [...WHITE, 255];
  return TRANSPARENT;
};

const notificationShader = (x, y) => {
  // Pure-white silhouette only. Drop the tilak (would render as the
  // system tint) and the pulse (unreadable at 96px).
  return insideLotus(x, y) ? [...WHITE, 255] : TRANSPARENT;
};

const splashShader = (x, y) => {
  // x, y normalised against the smaller dimension. The splash is now a
  // SQUARE 1024×1024 canvas (down from 1242×2436) — Expo's `contain`
  // resize mode scales the smaller image up to fit the device width,
  // and the legacy `expo.splash.backgroundColor` paints the strip
  // above and below. Net result: the lotus appears at ~60% of screen
  // width on real phones, vs ~10% with the previous full-bleed image.
  //
  // HEART_SCALE = 0.6 makes the lotus fill ~65% of the canvas width.
  // The y-offset keeps it slightly above visual centre so a future
  // bitmap-text layer ("SwasthParivar") can sit below without clipping.
  const HEART_SCALE = 0.6;
  const hx = x * HEART_SCALE;
  const hy = (y + 0.08) * HEART_SCALE;
  if (insideCircle(hx, hy, TILAK_CX, TILAK_CY, TILAK_R)) return [...SAFFRON, 255];
  if (insideLotus(hx, hy)) return [...WHITE, 255];
  if (insidePulse(hx, hy - 0.42)) return [255, 255, 255, 110];
  return [...BRAND_BLUE, 255];
};

// ── Run ──────────────────────────────────────────────────────────────

const targets = [
  { name: "icon.png", w: 1024, h: 1024, shader: launcherShader },
  { name: "adaptive-icon.png", w: 1024, h: 1024, shader: adaptiveShader },
  { name: "notification-icon.png", w: 96, h: 96, shader: notificationShader },
  { name: "splash.png", w: 1024, h: 1024, shader: splashShader },
];

console.log("Generating SwasthParivar brand icons (v2 — lotus)…\n");
for (const t of targets) {
  const t0 = Date.now();
  const rgba = rasterise(t.w, t.h, t.shader);
  const png = encodePNG(t.w, t.h, rgba);
  writeFileSync(join(OUTPUT_DIR, t.name), png);
  console.log(
    `  ✔ ${t.name.padEnd(22)} ${`${t.w}×${t.h}`.padStart(11)}  ${png.length.toLocaleString()} bytes  (${Date.now() - t0}ms)`,
  );
}
console.log(
  "\nDone. Preview by opening apps/mobile/assets/images/icon.png in Finder " +
    "or by reinstalling the dev build.",
);
