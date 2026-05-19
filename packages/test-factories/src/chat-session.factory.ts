import { faker } from "@faker-js/faker";

// Test factory for `ChatSession`. Mirrors the Prisma model shape but
// stays decoupled from `@prisma/client` so this package can be imported
// from the pure domain-logic test layer as well. Server integration
// tests cast the result through Prisma's `ChatSession` type when
// persisting.

export interface ChatSessionFactoryShape {
  id: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  language: "hi" | "en";
  archivedAt: Date | null;
}

export const makeChatSession = (
  overrides: Partial<ChatSessionFactoryShape> = {},
): ChatSessionFactoryShape => ({
  id: faker.string.uuid(),
  userId: faker.string.uuid(),
  startedAt: faker.date.recent({ days: 1 }),
  endedAt: null,
  language: "hi",
  archivedAt: null,
  ...overrides,
});
