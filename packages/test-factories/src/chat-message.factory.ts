import { faker } from "@faker-js/faker";

// Test factory for `ChatMessage`. Includes a `withSafetyViolation()`
// builder per phase3.md A.7 so integration tests can construct a row
// that mirrors what the Post-Response Safety Filter would have flagged.

export interface ChatMessageFactoryShape {
  id: string;
  clientUuid: string;
  version: number;
  sessionId: string;
  userId: string;
  role: "user" | "assistant" | "system";
  content: string;
  language: "hi" | "en";
  referencedReadings: Record<string, unknown> | null;
  tokensInput: number;
  tokensOutput: number;
  costTier: "template" | "cached" | "sonnet";
  responseLatencyMs: number | null;
  flagged: boolean;
  flagReason: string | null;
  safetyViolations: string[] | null;
  createdAt: Date;
}

export const makeChatMessage = (
  overrides: Partial<ChatMessageFactoryShape> = {},
): ChatMessageFactoryShape => ({
  id: faker.string.uuid(),
  clientUuid: faker.string.uuid(),
  version: 1,
  sessionId: faker.string.uuid(),
  userId: faker.string.uuid(),
  role: "assistant",
  content: "Theek hai aapki sugar 120 hai.",
  language: "hi",
  referencedReadings: null,
  tokensInput: 500,
  tokensOutput: 50,
  costTier: "cached",
  responseLatencyMs: 850,
  flagged: false,
  flagReason: null,
  safetyViolations: null,
  createdAt: new Date(),
  ...overrides,
});

// Convenience builder for the safety-filter-rejected variant. Mirrors
// the row shape `chat.service` produces when filterChatResponse hits.
export const makeFlaggedChatMessage = (
  violations: readonly string[],
  overrides: Partial<ChatMessageFactoryShape> = {},
): ChatMessageFactoryShape =>
  makeChatMessage({
    role: "assistant",
    content: "Yeh sawaal doctor se poochna best rahega.",
    flagged: true,
    flagReason: "safety_filter_rejected",
    safetyViolations: [...violations],
    ...overrides,
  });
