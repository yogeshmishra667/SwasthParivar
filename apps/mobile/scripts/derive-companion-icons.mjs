#!/usr/bin/env node
/**
 * derive-companion-icons.mjs
 *
 * The launcher art (`assets/images/icon.png`) is a hand-designed PNG —
 * a family-of-figures inside a heart, white strokes on the brand-blue
 * (#2563EB) rounded square. Splash is its bigger sibling and is also
 * hand-designed.
 *
 * The other two PNGs Expo needs (`adaptive-icon.png`, `notification-icon.png`)
 * have different rules and CANNOT be the same artwork as icon.png:
 *
 *   - adaptive-icon (Android): the OS masks the foreground to a circle
 *     or squircle and paints `adaptiveIcon.backgroundColor` (configured
 *     in app.json — currently #2563EB) BEHIND it. So the foreground
 *     must be on TRANSPARENT, with the artwork sized to fit the inner
 *     66% safe zone of a 1024×1024 canvas. If you ship icon.png as the
 *     foreground you get an opaque blue-square-inside-circle Frankenstein.
 *
 *   - notification-icon (Android post-Lollipop): the OS strips colour
 *     and re-tints whatever silhouette you provide. So this asset must
 *     be PURE white on transparent at 96×96, or it renders as a
 *     featureless square in the status bar (which is what we had
 *     before this fix).
 *
 * Strategy: read icon.png, chroma-key the brand-blue background to
 * transparent (distance in RGB space against #2563EB, threshold 80 —
 * wide enough to catch antialiased edges of the white strokes but
 * narrow enough not to bleed into the saffron tilak). That gives us
 * the "foreground only" mask once. We then:
 *
 *   - Centre-crop the masked image into the inner 66% of a 1024×1024
 *     transparent canvas → adaptive-icon.png.
 *   - Downsample the masked image to 96×96 via box-filter, then
 *     binarise every non-transparent pixel to pure white → notification-icon.png.
 *
 * Run with:  pnpm --filter @swasth/mobile icon:derive
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const IMG_DIR = join(__dirname, "..", "assets", "images");

const SRC_PATH = join(IMG_DIR, "icon.png");
const ADAPTIVE_PATH = join(IMG_DIR, "adaptive-icon.png");
const NOTIFICATION_PATH = join(IMG_DIR, "notification-icon.png");

const BRAND_R = 0x25; // 37
const BRAND_G = 0x63; // 99
const BRAND_B = 0xeb; // 235
// Squared distance threshold — pixels within ~80 units of brand blue
// (Euclidean) get keyed to transparent. Captures the antialiased edges
// of the white strokes too, otherwise they'd leave a faint blue halo.
const KEY_THRESHOLD_SQ = 80 * 80;

const src = PNG.sync.read(readFileSync(SRC_PATH));
const { width: W, height: H, data: srcRGBA } = src;

if (W !== H) {
  console.warn(`Warning: source icon is ${W}×${H} (expected square). Continuing.`);
}

// 1. Build the masked source — RGBA buffer same size as the input,
//    with brand-blue pixels alpha-zeroed.
const masked = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H * 4; i += 4) {
  const r = srcRGBA[i];
  const g = srcRGBA[i + 1];
  const b = srcRGBA[i + 2];
  const a = srcRGBA[i + 3];
  const dr = r - BRAND_R;
  const dg = g - BRAND_G;
  const db = b - BRAND_B;
  const distSq = dr * dr + dg * dg + db * db;
  if (a === 0 || distSq <= KEY_THRESHOLD_SQ) {
    masked[i] = 0;
    masked[i + 1] = 0;
    masked[i + 2] = 0;
    masked[i + 3] = 0;
  } else {
    masked[i] = r;
    masked[i + 1] = g;
    masked[i + 2] = b;
    masked[i + 3] = a;
  }
}

// ── adaptive-icon.png — masked content in the inner 66% safe zone ──

const ADAPTIVE_SIZE = 1024;
// Android's official adaptive-icon safe zone is 66% of foreground, but
// aggressive launchers (Pixel circular, OneUI on Samsung) crop more
// tightly — the heart's top edges were getting clipped on real devices.
// 50% is conservative enough that the artwork survives every launcher
// mask shape (circle, squircle, teardrop, square-with-rounded-corners).
const SAFE_ZONE_RATIO = 0.5;
// Compute the bounding box of the non-transparent pixels in the masked
// source so we can pack the artwork tightly into the safe zone instead
// of inheriting whatever padding icon.png happened to have.
let bbMinX = W;
let bbMinY = H;
let bbMaxX = -1;
let bbMaxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (masked[(y * W + x) * 4 + 3] > 0) {
      if (x < bbMinX) bbMinX = x;
      if (y < bbMinY) bbMinY = y;
      if (x > bbMaxX) bbMaxX = x;
      if (y > bbMaxY) bbMaxY = y;
    }
  }
}
const bbW = Math.max(1, bbMaxX - bbMinX + 1);
const bbH = Math.max(1, bbMaxY - bbMinY + 1);

// Largest scale that keeps the bbox inside the safe zone.
const safePx = Math.floor(ADAPTIVE_SIZE * SAFE_ZONE_RATIO);
const scale = Math.min(safePx / bbW, safePx / bbH);
const drawW = Math.round(bbW * scale);
const drawH = Math.round(bbH * scale);
const offsetX = Math.floor((ADAPTIVE_SIZE - drawW) / 2);
const offsetY = Math.floor((ADAPTIVE_SIZE - drawH) / 2);

const adaptive = new PNG({ width: ADAPTIVE_SIZE, height: ADAPTIVE_SIZE });
// Pre-fill transparent (Buffer.alloc gives zero bytes which is already
// (0,0,0,0)). Then nearest-neighbour sample the masked source.
for (let dy = 0; dy < drawH; dy++) {
  const sy = bbMinY + Math.floor(dy / scale);
  for (let dx = 0; dx < drawW; dx++) {
    const sx = bbMinX + Math.floor(dx / scale);
    const sIdx = (sy * W + sx) * 4;
    if (masked[sIdx + 3] === 0) continue;
    const dIdx = ((offsetY + dy) * ADAPTIVE_SIZE + (offsetX + dx)) * 4;
    adaptive.data[dIdx] = masked[sIdx];
    adaptive.data[dIdx + 1] = masked[sIdx + 1];
    adaptive.data[dIdx + 2] = masked[sIdx + 2];
    adaptive.data[dIdx + 3] = masked[sIdx + 3];
  }
}
writeFileSync(ADAPTIVE_PATH, PNG.sync.write(adaptive));

// ── notification-icon.png — 96×96 white silhouette ──

const NOTIF_SIZE = 96;
const notif = new PNG({ width: NOTIF_SIZE, height: NOTIF_SIZE });
// Box-filter downsample from the masked bbox into a transparent 96×96.
// Same safe-zone packing as adaptive (the masked art looks lost in a
// 96px canvas if we pad it like icon.png did).
const notifSafeRatio = 0.85;
const notifSafePx = Math.floor(NOTIF_SIZE * notifSafeRatio);
const notifScale = Math.min(notifSafePx / bbW, notifSafePx / bbH);
const notifDrawW = Math.round(bbW * notifScale);
const notifDrawH = Math.round(bbH * notifScale);
const notifOffsetX = Math.floor((NOTIF_SIZE - notifDrawW) / 2);
const notifOffsetY = Math.floor((NOTIF_SIZE - notifDrawH) / 2);

// Box filter: each destination pixel averages over the source pixels
// it covers. Antialiased edges become semi-transparent — Android then
// tints those edges with the system colour, giving a clean silhouette.
const stepX = bbW / notifDrawW;
const stepY = bbH / notifDrawH;
for (let dy = 0; dy < notifDrawH; dy++) {
  const sy0 = bbMinY + dy * stepY;
  const sy1 = bbMinY + (dy + 1) * stepY;
  for (let dx = 0; dx < notifDrawW; dx++) {
    const sx0 = bbMinX + dx * stepX;
    const sx1 = bbMinX + (dx + 1) * stepX;
    let aSum = 0;
    let count = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
      if (sy < 0 || sy >= H) continue;
      for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
        if (sx < 0 || sx >= W) continue;
        aSum += masked[(sy * W + sx) * 4 + 3];
        count++;
      }
    }
    const avgA = count > 0 ? Math.round(aSum / count) : 0;
    if (avgA === 0) continue;
    const dIdx = ((notifOffsetY + dy) * NOTIF_SIZE + (notifOffsetX + dx)) * 4;
    notif.data[dIdx] = 255;
    notif.data[dIdx + 1] = 255;
    notif.data[dIdx + 2] = 255;
    notif.data[dIdx + 3] = avgA;
  }
}
writeFileSync(NOTIFICATION_PATH, PNG.sync.write(notif));

console.log("Derived companion icons from icon.png:");
console.log(
  `  ✔ adaptive-icon.png      ${ADAPTIVE_SIZE}×${ADAPTIVE_SIZE}  (white art on transparent, ${Math.round(SAFE_ZONE_RATIO * 100)}% safe zone)`,
);
console.log(`  ✔ notification-icon.png  ${NOTIF_SIZE}×${NOTIF_SIZE}      (pure-white silhouette on transparent)`);
