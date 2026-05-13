export interface VoiceFixture {
  label: string;
  transcript: string;
  confidence: number;
  capturedAtHourLocal: number;
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
