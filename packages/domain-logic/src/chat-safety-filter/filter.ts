// `security/detect-unsafe-regex` flags any pattern with a nested or
// adjacent quantifier as potentially catastrophic. The patterns below
// are bounded (fixed-width digit classes, capped non-greedy windows,
// distinct alternation prefixes), operate on AI responses that the
// Claude wrapper caps below 8 KB, and are fully covered by tests in
// filter.test.ts. The rule is disabled at file scope with this
// rationale rather than scattered per-line.
/* eslint-disable security/detect-unsafe-regex */

import {
  SAFETY_REPLACEMENT,
  type SafetyFilterInput,
  type SafetyFilterResult,
  type SafetyViolation,
} from "./types.js";

// Post-Response Safety Filter — pure, IO-free, runs on every assistant
// message before it is persisted or returned. Failing closed: any
// pattern hit replaces the entire content with SAFETY_REPLACEMENT.
//
// Detector design: each violation has its own bank of patterns covering
// English, Hinglish (Latin script), and Devanagari. Patterns are
// anchored on medication-specific nouns ("dose", "dawai", "खुराक") so
// generic encouragement like "stress kam karein" or "chinta band karein"
// does not produce a false positive.
//
// Branch shape (test-coverage critical):
//   – every detector function returns boolean independently
//   – the orchestrator collects all true ones into `violations[]`
//   – safe ↔ violations.length === 0 (single branch in the public path)

const DOSAGE_NUMBER_PATTERNS: readonly RegExp[] = [
  // "500 mg", "2 tablets", "10mcg", "1.5 g"
  /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ml|grams?|g\b|tablets?|tabs?|pills?|capsules?|caps?|units?|iu)\b/i,
  // Hinglish word-counts: "ek goli", "do tablet", "teen capsule", "aadhi goli"
  /\b(?:ek|do|teen|tin|chaar|char|paanch|panch|aadha|aadhi|adha|adhi|adha?a?)\s+(?:goli|goliyaan|goliyan|tablet|tablets|capsule|capsules|khurak)\b/i,
  // Devanagari: "२ गोली", "10 गोली", "500 मिग्रा"
  /(?:\d+|[०-९]+)\s*(?:गोली|गोलियाँ|गोलियां|टैबलेट|कैप्सूल|खुराक|मिग्रा|एमजी|एम\.जी\.|मि\.ग्रा\.)/u,
];

// Medication context window — keywords that, when adjacent to a
// directive verb, mark the directive as medication-specific (vs
// generic). Used for start/stop + dose-change false-positive guards.
//
// Split into two alternations: the ASCII branch uses `\b` for proper
// word boundaries; the Devanagari branch omits `\b` because JS `\b`
// is ASCII-only and refuses to match around Devanagari runs.
const MEDICATION_CONTEXT_RE =
  /(?:\b(?:medicine|medication|medications|drug|drugs|tablet|tablets|pill|pills|capsule|capsules|insulin|metformin|aspirin|statin|dose|dosage|dawai|dawayi|dava|davai|goli|goliyaan|khurak|matra)\b)|(?:दवा|दवाई|गोली|खुराक|मात्रा|डोज़|डोज|इंसुलिन)/iu;

const START_STOP_DIRECTIVE_PATTERNS: readonly RegExp[] = [
  // English imperatives directly attached to a med noun. Allows an
  // optional determiner ("this", "your", "the", "a"…) between the
  // verb phrase and the med noun so "stop taking this medication"
  // matches as well as "stop the medication".
  /\b(?:start|stop|begin|discontinue|continue|resume|quit|cease)\s+(?:(?:taking|having|using)\s+)?(?:(?:the|your|this|that|a|an|my|her|his|their)\s+)?(?:medicine|medication|drug|tablet|pill|capsule|metformin|insulin|aspirin|statin)\b/i,
  // Hinglish: "dawai band karein", "dawai shuru karein", "dawai chhod dein"
  /\b(?:dawai|dawayi|dava|davai|goli|insulin|metformin)\s+(?:band|shuru|chalu|chhod|chod|chodd|skip|miss)\b/i,
  /\b(?:band|shuru|chalu|chhod|chod|skip|miss)\s+(?:kar(?:o|en|ein|dein|do)|de\s+do|de\s+dein)\s+(?:dawai|dawayi|dava|davai|goli|insulin|metformin)\b/i,
  // Devanagari: "दवाई बंद करें", "दवा शुरू करें"
  /(?:दवाई|दवा|गोली|इंसुलिन)\s*(?:बंद|शुरू|छोड़|छोड़ें|बंद करें|शुरू करें)/u,
];

const DOSE_CHANGE_PATTERNS: readonly RegExp[] = [
  // "increase the dose", "double your dosage", "reduce dose by half"
  /\b(?:increase|decrease|reduce|raise|lower|double|halve|cut|adjust|change|up|down)\s+(?:the\s+|your\s+)?(?:dose|dosage|amount|quantity|frequency)\b/i,
  // "more dose", "higher dose"
  /\b(?:more|less|higher|lower|extra)\s+(?:dose|dosage)\b/i,
  // "take X mg instead of Y mg" — implicit dose change
  /\b(?:take|use)\s+\d+\s*(?:mg|mcg|ml|tablets?|pills?)\s+(?:instead|rather)\b/i,
  // Hinglish: "dose badha dein", "khurak kam kar", "dawai double kar"
  /\b(?:dose|khurak|matra|dawai|dawayi|dava|davai)\s+(?:badha|kam|double|halve|adha|adhi|jyada|zyada|kam karo)\b/i,
  /\b(?:badha|kam|double|halve|adha|adhi|jyada|zyada)\s+(?:kar(?:o|en|ein|dein|do)|de\s+do|de\s+dein)\s+(?:dose|khurak|matra|dawai|dawayi|dava|davai)\b/i,
  // Devanagari: "खुराक बढ़ा", "दवा कम करें", "डोज़ डबल"
  /(?:खुराक|दवा|दवाई|डोज़|डोज|मात्रा)\s*(?:बढ़ा|कम|डबल|आधा)/u,
];

const DIAGNOSIS_CLAIM_PATTERNS: readonly RegExp[] = [
  // "you have diabetes", "you are diabetic", "you suffer from hypertension"
  /\byou(?:'re|\s+are)?\s+(?:have|suffer(?:ing)?\s+from|are)\s+(?:diabetic|diabetes|hypertensive|hypertension|asthmatic|asthma|cardiac|heart\s+disease)\b/i,
  // "diagnosed with", "I diagnose you with"
  /\b(?:diagnosed|diagnose)\s+(?:with|you\s+with)\b/i,
  // Hinglish: "aapko diabetes hai", "aap diabetic hain"
  /\baapko\s+(?:diabetes|shugar|sugar(?:\s+ki\s+bimari)?|hypertension|bp(?:\s+ki\s+bimari)?|asthma|dama)\s+(?:hai|hain|h)\b/i,
  /\baap\s+(?:diabetic|hypertensive|asthmatic)\s+(?:hain|ho|h)\b/i,
  // Devanagari: "आपको डायबिटीज़ है", "आप डायबिटिक हैं"
  /आपको\s+(?:डायबिटीज़|डायबिटीज|शुगर|मधुमेह|बीपी|उच्च\s+रक्तचाप|अस्थमा|दमा)\s+है/u,
];

const EMERGENCY_ADVICE_PATTERNS: readonly RegExp[] = [
  // "drink sugar water now", "eat glucose immediately" — allow up to
  // ~30 chars between the food noun and the time marker so a noun
  // pair like "sugar water" or "orange juice" is not split.
  /\b(?:drink|eat|have|take|consume)\s+(?:some\s+|a\s+)?(?:sugar|glucose|juice|honey|mithai|cola|coke|chocolate)\b[^.!?\n]{0,30}?\b(?:now|immediately|right\s+away|asap|at\s+once)\b/i,
  // "call ambulance now", "go to ER immediately"
  /\b(?:call|dial)\s+(?:911|112|108|ambulance|emergency\s+services)\s+(?:now|immediately|right\s+away|asap)\b/i,
  // Hinglish: "abhi juice piyo", "turant mithai khao"
  /\b(?:abhi|turant|jaldi)\s+(?:sugar|meetha|juice|cola|honey|mithai|chocolate|glucose)\s+(?:khao|kha\s+lo|piyo|pi\s+lo|lo|le\s+lo|len|le\s+lein)\b/iu,
  // Devanagari: "अभी जूस पीयें", "तुरंत मीठा खाएं"
  /(?:अभी|तुरंत|जल्दी)\s*(?:जूस|मीठा|शक्कर|चीनी|ग्लूकोज़|ग्लूकोज)\s*(?:खाएं|पीएं|पीयें|खाओ|लें|ले\s+लें)/u,
];

const VERBATIM_PII_PATTERNS: readonly RegExp[] = [
  // 10-digit Indian mobile number (starts with 6–9). Match either as
  // a bare string or with optional country code.
  /(?:^|[^\d])(?:\+?91[\s-]?)?[6-9]\d{9}(?![\d])/,
  // Aadhaar: 12 digits, optionally space-separated as 4-4-4.
  /\b\d{4}\s?\d{4}\s?\d{4}\b/,
  // Email.
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
];

const matchesAny = (content: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((re) => re.test(content));

// Each detector returns boolean. Kept separate from the orchestrator so
// per-detector unit tests can pin coverage without faking the rest.

export const detectDosageNumber = (content: string): boolean =>
  matchesAny(content, DOSAGE_NUMBER_PATTERNS);

export const detectStartStopDirective = (content: string): boolean => {
  if (!matchesAny(content, START_STOP_DIRECTIVE_PATTERNS)) return false;
  // Patterns are already anchored on med nouns, but the generic
  // English `start/stop/continue` pattern requires a medication
  // context to fire (guards "stop worrying" / "continue exercising").
  // For Hinglish/Devanagari patterns, the med noun is mandatory in
  // the regex itself, so this gate is only meaningful for English.
  return MEDICATION_CONTEXT_RE.test(content);
};

export const detectDoseChange = (content: string): boolean => {
  if (!matchesAny(content, DOSE_CHANGE_PATTERNS)) return false;
  // Guards generic "kam karein" / "reduce stress" with no med noun.
  return MEDICATION_CONTEXT_RE.test(content);
};

export const detectDiagnosisClaim = (content: string): boolean =>
  matchesAny(content, DIAGNOSIS_CLAIM_PATTERNS);

export const detectEmergencyAdvice = (content: string): boolean =>
  matchesAny(content, EMERGENCY_ADVICE_PATTERNS);

export const detectVerbatimPii = (content: string): boolean =>
  matchesAny(content, VERBATIM_PII_PATTERNS);

interface Detector {
  readonly kind: SafetyViolation;
  readonly check: (c: string) => boolean;
}

const DETECTORS: readonly Detector[] = [
  { kind: "dosage_number", check: detectDosageNumber },
  { kind: "start_stop_directive", check: detectStartStopDirective },
  { kind: "dose_change", check: detectDoseChange },
  { kind: "diagnosis_claim", check: detectDiagnosisClaim },
  { kind: "emergency_advice", check: detectEmergencyAdvice },
  { kind: "verbatim_pii", check: detectVerbatimPii },
];

export const filterChatResponse = (input: SafetyFilterInput): SafetyFilterResult => {
  const violations: SafetyViolation[] = [];
  for (const d of DETECTORS) {
    if (d.check(input.content)) violations.push(d.kind);
  }
  const safe = violations.length === 0;
  return {
    safe,
    violations,
    redactedContent: safe ? input.content : SAFETY_REPLACEMENT,
    originalContent: input.content,
  };
};
