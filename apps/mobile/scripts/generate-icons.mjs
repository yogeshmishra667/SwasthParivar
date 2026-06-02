#!/usr/bin/env node
/**
 * generate-icons.mjs
 *
 * Produces the four launcher / splash / notification assets from a
 * single brand mark — a heart with a centred ECG pulse. No native deps:
 * the rasteriser is plain JS, output is composed with zlib+PNG chunk
 * helpers (same approach as generate-placeholder-assets.mjs which this
 * supersedes for real artwork).
 *
 * Brand colour: #2563EB.
 *
 * Outputs (matches app.json wiring):
 *   icon.png              1024×1024  blue heart on white (rounded square)
 *   adaptive-icon.png     1024×1024  blue heart on transparent (Android
 *                                    OS draws the configured bg behind)
 *   notification-icon.png 96×96      white silhouette on transparent
 *                                    (Android requires monochrome; any
 *                                    other shape renders as a square)
 *   splash.png            1242×2436  white heart on blue (full bleed)
 *
 * Usage (from repo root):
 *   node apps/mobile/scripts/generate-icons.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, "..", "assets", "images");
mkdirSync(OUTPUT_DIR, { recursive: true });

// ── PNG plumbing ─────────────────────────────────────────────────────

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

/** Encode an RGBA pixel buffer (width*height*4 bytes) to PNG. */
const encodePNG = (width, height, rgba) => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Build scanlines with per-row filter byte (0 = none).
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

/**
 * Implicit heart curve: (x² + y² − 1)³ − x²y³ ≤ 0.
 * Coordinate space: heart fits inside [-1.2, 1.2] roughly.
 */
const insideHeart = (x, y) => {
  // The standard implicit form has the heart pointing up at y>0.
  // We flip y so the point sits at the bottom (visual convention).
  const yf = -y;
  const t = x * x + yf * yf - 1;
  return t * t * t - x * x * yf * yf * yf <= 0;
};

/** Rounded-square mask, used for the launcher icon. */
const insideRoundedSquare = (x, y, half = 0.95, radius = 0.22) => {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > half || ay > half) return false;
  const dx = Math.max(0, ax - (half - radius));
  const dy = Math.max(0, ay - (half - radius));
  return dx * dx + dy * dy <= radius * radius;
};

/**
 * ECG pulse cut-out, centred horizontally. Returns true inside the
 * pulse band: a flat line that spikes up then down once near the
 * centre. We use it as a *cut-out* so the band shows the background
 * colour through the heart, evoking a real ECG trace.
 */
const insidePulse = (x, y) => {
  // Confine the pulse to a thin horizontal band crossing the heart.
  const BAND_THICKNESS = 0.045;
  // Plot y_target(x); test |y - y_target| < BAND_THICKNESS.
  // Flat at y=0 outside the spike window, then a sharp up/down spike.
  const SPIKE_START = -0.18;
  const SPIKE_PEAK_UP = -0.06;
  const SPIKE_PEAK_DOWN = 0.06;
  const SPIKE_END = 0.18;
  const SPIKE_HEIGHT = 0.32;
  let yTarget;
  if (x < SPIKE_START || x > SPIKE_END) {
    yTarget = 0;
  } else if (x < SPIKE_PEAK_UP) {
    // Rising edge
    const t = (x - SPIKE_START) / (SPIKE_PEAK_UP - SPIKE_START);
    yTarget = -SPIKE_HEIGHT * t;
  } else if (x < SPIKE_PEAK_DOWN) {
    // Falling edge through zero into the negative spike
    const t = (x - SPIKE_PEAK_UP) / (SPIKE_PEAK_DOWN - SPIKE_PEAK_UP);
    yTarget = -SPIKE_HEIGHT + (SPIKE_HEIGHT - -SPIKE_HEIGHT * 0.5) * t;
  } else {
    // Return to baseline
    const t = (x - SPIKE_PEAK_DOWN) / (SPIKE_END - SPIKE_PEAK_DOWN);
    yTarget = SPIKE_HEIGHT * 0.5 * (1 - t);
  }
  return Math.abs(y - yTarget) < BAND_THICKNESS;
};

// ── Rasteriser ───────────────────────────────────────────────────────

const SAMPLES_PER_AXIS = 4; // 4×4 = 16 samples per pixel (anti-alias)

/**
 * @param {number} w
 * @param {number} h
 * @param {(x: number, y: number) => [r:number,g:number,b:number,a:number]} shader
 *   Pixel shader. x, y are in normalised coords centred at the canvas
 *   centre, scaled so the smaller dimension spans [-1, 1].
 */
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

// ── Brand palette ────────────────────────────────────────────────────

const BRAND_BLUE = [37, 99, 235]; // #2563EB
const WHITE = [255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

// ── Shaders ──────────────────────────────────────────────────────────

/** Launcher icon: rounded blue square, white heart with pulse cut-out. */
const launcherShader = (x, y) => {
  if (!insideRoundedSquare(x, y)) return TRANSPARENT;
  // Scale heart to ~70% of square. Heart's bounding box is roughly
  // [-1.2, 1.2] × [-1, 1.4], so dividing input coords amplifies it.
  const HEART_SCALE = 1.45;
  const hx = x * HEART_SCALE;
  const hy = y * HEART_SCALE + 0.1; // shift down a touch for optical centring
  const inHeart = insideHeart(hx, hy);
  const inPulse = inHeart && insidePulse(hx, hy);
  if (inHeart && !inPulse) return [...WHITE, 255];
  return [...BRAND_BLUE, 255];
};

/**
 * Adaptive icon foreground: blue heart on transparent. The OS lays the
 * configured `backgroundColor` (#2563EB) behind, but with a mask that
 * may crop the corners — so we keep the heart well within the inner
 * 66% of the canvas (Android adaptive-icon safe zone).
 */
const adaptiveShader = (x, y) => {
  const SAFE_SCALE = 1.85; // larger scale = smaller visible shape
  const hx = x * SAFE_SCALE;
  const hy = y * SAFE_SCALE + 0.1;
  if (!insideHeart(hx, hy)) return TRANSPARENT;
  if (insidePulse(hx, hy)) return TRANSPARENT;
  return [...WHITE, 255];
};

/**
 * Notification icon: pure white silhouette on transparent. Android
 * post-Lollipop ignores any non-alpha channel in this asset — any
 * non-white pixel collapses to the system tint colour or, if the asset
 * is full-colour, the OS substitutes a generic square. So: silhouette
 * only, no pulse cut-out at 96px (it'd be unreadable anyway).
 */
const notificationShader = (x, y) => {
  const SCALE = 1.45;
  const hx = x * SCALE;
  const hy = y * SCALE + 0.1;
  return insideHeart(hx, hy) ? [...WHITE, 255] : TRANSPARENT;
};

/**
 * Splash: full-bleed brand blue with a centred white heart and pulse.
 * Splash aspect is portrait (1242×2436 ≈ 0.51), so we centre the heart
 * within the upper-middle band and keep it ≈40% of the screen width.
 */
const splashShader = (x, y) => {
  // x, y are normalised against the smaller dimension (width here).
  // Constrain the heart to ~50% of width by scaling input coords up.
  const HEART_SCALE = 2.4;
  // Shift the heart upward of true centre (looks better above CTA copy
  // that the splash screen typically pairs with).
  const hx = x * HEART_SCALE;
  const hy = (y + 0.35) * HEART_SCALE;
  const inHeart = insideHeart(hx, hy);
  const inPulse = inHeart && insidePulse(hx, hy);
  if (inHeart && !inPulse) return [...WHITE, 255];
  return [...BRAND_BLUE, 255];
};

// ── Run ──────────────────────────────────────────────────────────────

const targets = [
  { name: "icon.png", w: 1024, h: 1024, shader: launcherShader },
  { name: "adaptive-icon.png", w: 1024, h: 1024, shader: adaptiveShader },
  { name: "notification-icon.png", w: 96, h: 96, shader: notificationShader },
  { name: "splash.png", w: 1242, h: 2436, shader: splashShader },
];

console.log("Generating SwasthParivar brand icons…\n");
for (const t of targets) {
  const t0 = Date.now();
  const rgba = rasterise(t.w, t.h, t.shader);
  const png = encodePNG(t.w, t.h, rgba);
  writeFileSync(join(OUTPUT_DIR, t.name), png);
  console.log(
    `  ✔ ${t.name.padEnd(22)} ${`${t.w}×${t.h}`.padStart(11)}  ${png.length.toLocaleString()} bytes  (${Date.now() - t0}ms)`,
  );
}
console.log("\nDone. Verify with:  file apps/mobile/assets/images/*.png");
