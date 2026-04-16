export const TOUCH_TARGET_MIN = 48;

export const FONT_SIZE = {
  body: 14,
  important: 16,
  number: 20,
  hero: 36,
} as const;

export const LARGE_TEXT_SCALE = 1.3;

export const TIMEOUTS = {
  apiRequestMs: 10_000,
  voiceSilenceMs: 5_000,
  undoToastMs: 5_000,
  offlineBannerThresholdMs: 60 * 60 * 1000,
  profileInactiveMs: 30 * 60 * 1000,
} as const;

export const ANIMATION = {
  save: 200,
  celebrate: 800,
  milestone: 1500,
  transition: 250,
  chart: 300,
} as const;

export const CRITICAL_FULLSCREEN_LOCK_MS = 30_000;
