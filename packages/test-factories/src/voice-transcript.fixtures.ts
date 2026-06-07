export interface VoiceFixture {
  label: string;
  transcript: string;
  confidence: number;
  capturedAtHourLocal: number;
  expectedValue: number | null;
  expectedAccept: boolean;
  notes?: string;
}

/**
 * Phase 4 Feature E — cardiac + respiratory transcripts. The clock
 * hour is meaningless for these surfaces (no fasting/post-meal type
 * inference) but kept for shape parity with the glucose fixtures so
 * one test harness can iterate over both.
 */
export interface NumericVoiceFixture {
  label: string;
  transcript: string;
  confidence: number;
  expectedValue: number | null;
  expectedAccept: boolean;
  notes?: string;
}

export const VOICE_FIXTURES: readonly VoiceFixture[] = [
  {
    label: "colloquial-sava-sau",
    transcript: "meri sugar sava sau hai",
    confidence: 0.92,
    capturedAtHourLocal: 7,
    expectedValue: 125,
    expectedAccept: true,
  },
  {
    label: "colloquial-dhai-sau",
    transcript: "aaj sugar dhai sau aayi",
    confidence: 0.88,
    capturedAtHourLocal: 13,
    expectedValue: 250,
    expectedAccept: true,
  },
  {
    label: "devanagari-derh-sau",
    transcript: "sugar डेढ़ सौ hai",
    confidence: 0.85,
    capturedAtHourLocal: 13,
    expectedValue: 150,
    expectedAccept: true,
  },
  {
    label: "digit-140",
    transcript: "sugar 140 hai aaj",
    confidence: 0.95,
    capturedAtHourLocal: 13,
    expectedValue: 140,
    expectedAccept: true,
  },
  {
    label: "noisy-no-intent",
    transcript: "TV pe khabar mein 200 bola",
    confidence: 0.7,
    capturedAtHourLocal: 13,
    expectedValue: 200,
    expectedAccept: true,
    notes: "currently parses; refine intent gating in future",
  },
  {
    label: "past-tense-rejected",
    transcript: "kal sugar 140 thi",
    confidence: 0.9,
    capturedAtHourLocal: 13,
    expectedValue: null,
    expectedAccept: false,
  },
  {
    label: "uncertainty-shayad",
    transcript: "shayad sugar 140 hai",
    confidence: 0.9,
    capturedAtHourLocal: 13,
    expectedValue: 140,
    expectedAccept: true,
    notes: "requires strong confirmation",
  },
  {
    label: "empty",
    transcript: "",
    confidence: 0.5,
    capturedAtHourLocal: 13,
    expectedValue: null,
    expectedAccept: false,
  },
];

// ─────────────────────────────────────────────────────────────
// Cardiac transcripts (HR in bpm). Intent keywords: dhadkan, dil,
// pulse, heart rate. Valid range: HR_VALID_MIN..HR_VALID_MAX (30..250).
// ─────────────────────────────────────────────────────────────

export const CARDIAC_VOICE_FIXTURES: readonly NumericVoiceFixture[] = [
  {
    label: "cardiac-hindi-explicit",
    transcript: "dil ki dhadkan 85 hai",
    confidence: 0.92,
    expectedValue: 85,
    expectedAccept: true,
  },
  {
    label: "cardiac-pulse-digit",
    transcript: "pulse 78 hai aaj",
    confidence: 0.9,
    expectedValue: 78,
    expectedAccept: true,
  },
  {
    label: "cardiac-english",
    transcript: "heart rate is 95",
    confidence: 0.88,
    expectedValue: 95,
    expectedAccept: true,
  },
  {
    label: "cardiac-colloquial-ek-sau-bees",
    transcript: "dhadkan ek sau bees hai",
    confidence: 0.85,
    expectedValue: 120,
    expectedAccept: true,
  },
  {
    label: "cardiac-out-of-range-high",
    transcript: "dhadkan 280 hai",
    confidence: 0.95,
    expectedValue: null,
    expectedAccept: false,
    notes: "above HR_VALID_MAX=250 → out_of_range",
  },
  {
    label: "cardiac-past-tense-rejected",
    transcript: "kal dhadkan 90 thi",
    confidence: 0.9,
    expectedValue: null,
    expectedAccept: false,
  },
  {
    label: "cardiac-no-intent-tv",
    transcript: "TV pe khabar mein 85 bola",
    confidence: 0.7,
    expectedValue: null,
    expectedAccept: false,
    notes: "no cardiac intent keyword → no_intent",
  },
  {
    label: "cardiac-uncertainty-shayad",
    transcript: "shayad dhadkan 90 hai",
    confidence: 0.9,
    expectedValue: 90,
    expectedAccept: true,
    notes: "requires strong confirmation",
  },
];

// ─────────────────────────────────────────────────────────────
// Respiratory transcripts (peak flow in L/min). Intent keywords:
// peak flow, saans, breath. Valid range: PEAK_FLOW_VALID_MIN..MAX
// (50..800).
// ─────────────────────────────────────────────────────────────

export const RESPIRATORY_VOICE_FIXTURES: readonly NumericVoiceFixture[] = [
  {
    label: "respiratory-english-explicit",
    transcript: "peak flow is 450",
    confidence: 0.92,
    expectedValue: 450,
    expectedAccept: true,
  },
  {
    label: "respiratory-hindi-colloquial",
    transcript: "peak flow do sau hai",
    confidence: 0.88,
    expectedValue: 200,
    expectedAccept: true,
  },
  {
    label: "respiratory-hindi-saans",
    transcript: "saans 480 hai aaj",
    confidence: 0.9,
    expectedValue: 480,
    expectedAccept: true,
  },
  {
    label: "respiratory-out-of-range-low",
    transcript: "peak flow 30 hai",
    confidence: 0.95,
    expectedValue: null,
    expectedAccept: false,
    notes: "below PEAK_FLOW_VALID_MIN=50 → out_of_range",
  },
  {
    label: "respiratory-past-tense-rejected",
    transcript: "kal peak flow 400 tha",
    confidence: 0.9,
    expectedValue: null,
    expectedAccept: false,
  },
  {
    label: "respiratory-no-intent",
    transcript: "TV pe 400 bola",
    confidence: 0.7,
    expectedValue: null,
    expectedAccept: false,
    notes: "no respiratory intent keyword → no_intent",
  },
  {
    label: "respiratory-uncertainty",
    transcript: "shayad peak flow 450 hai",
    confidence: 0.9,
    expectedValue: 450,
    expectedAccept: true,
    notes: "requires strong confirmation",
  },
];
