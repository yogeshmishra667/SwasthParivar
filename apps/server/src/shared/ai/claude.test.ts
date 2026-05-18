import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@swasth/shared-types";
import { __setClaudeClientForTests, generateResponse, type PatientContext } from "./claude.js";

// In-memory Redis stand-in. We only exercise the keys/commands the
// wrapper actually uses (GET / SET / INCR / INCRBY / EXPIRE / DEL),
// not the full ioredis surface.
const fakeStore = new Map<string, string>();
const fakeTtls = new Map<string, number>();

vi.mock("../redis.js", () => ({
  redis: {
    get: vi.fn((k: string) => Promise.resolve(fakeStore.get(k) ?? null)),
    set: vi.fn((k: string, v: string, _ex?: string, ttl?: number) => {
      fakeStore.set(k, v);
      if (ttl) fakeTtls.set(k, ttl);
      return Promise.resolve("OK");
    }),
    incr: vi.fn((k: string) => {
      const next = Number.parseInt(fakeStore.get(k) ?? "0", 10) + 1;
      fakeStore.set(k, String(next));
      return Promise.resolve(next);
    }),
    incrby: vi.fn((k: string, by: number) => {
      const next = Number.parseInt(fakeStore.get(k) ?? "0", 10) + by;
      fakeStore.set(k, String(next));
      return Promise.resolve(next);
    }),
    expire: vi.fn((k: string, ttl: number) => {
      fakeTtls.set(k, ttl);
      return Promise.resolve(1);
    }),
    del: vi.fn((k: string) => {
      const had = fakeStore.delete(k);
      fakeTtls.delete(k);
      return Promise.resolve(had ? 1 : 0);
    }),
  },
}));

// Quiet the flag service — it would otherwise try to talk to real
// Redis on import. Override after the redis mock is in place.
vi.mock("../flags/index.js", () => ({
  setFlag: vi.fn(() => Promise.resolve(undefined)),
}));

const ctx: PatientContext = {
  anonymizedId: "anon_abc",
  ageRange: "60_69",
  conditions: ["diabetes"],
  recentReadings: [{ type: "fasting", value: 120, measuredAtIso: "2026-05-18T07:00:00.000Z" }],
  language: "hi",
  condition: "diabetes",
};

const baseInput = {
  tier: "cached" as const,
  systemPrompt: "You are a friendly assistant for diabetes patients.",
  patientContext: ctx,
  userMessage: "Aaj ki sugar 120 thi.",
  userId: "user_123",
  sessionId: "sess_456",
  requestId: "req_789",
};

type FakeResult =
  | { kind: "ok"; tokensInput?: number; tokensOutput?: number; text?: string }
  | { kind: "abort" }
  | { kind: "throw"; err: unknown };

const makeFakeClient = (result: FakeResult): Anthropic => {
  return {
    messages: {
      create: vi.fn(async (_params: unknown, opts?: { signal?: AbortSignal }) => {
        if (result.kind === "abort") {
          // Hang forever until the abort signal fires. The wrapper's
          // AbortController timeout will trigger it.
          await new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener("abort", () => {
              reject(new Anthropic.APIUserAbortError({ message: "aborted" }));
            });
          });
          // Unreachable — the `await` above always rejects.
          throw new Error("unreachable");
        }
        if (result.kind === "throw") throw result.err;
        return {
          content: [{ type: "text", text: result.text ?? "Theek hai aapki sugar 120 hai." }],
          usage: {
            input_tokens: result.tokensInput ?? 500,
            output_tokens: result.tokensOutput ?? 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as unknown as Anthropic.Message;
      }),
    },
  } as unknown as Anthropic;
};

beforeEach(async () => {
  fakeStore.clear();
  fakeTtls.clear();
  vi.useFakeTimers();
  const { setFlag } = await import("../flags/index.js");
  vi.mocked(setFlag).mockClear();
});

afterEach(() => {
  __setClaudeClientForTests(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("generateResponse — happy path", () => {
  it("returns content + usage and resets the circuit on success", async () => {
    // Pre-existing failure count should be cleared after a successful call.
    fakeStore.set(`ai_circuit:fail_count:test`, "2");
    __setClaudeClientForTests(makeFakeClient({ kind: "ok" }));

    const result = await generateResponse(baseInput);

    expect(result.content).toBe("Theek hai aapki sugar 120 hai.");
    expect(result.tokensInput).toBe(500);
    expect(result.tokensOutput).toBe(50);
    expect(fakeStore.has(`ai_circuit:fail_count:test`)).toBe(false);
  });

  it("uses sonnet model when tier is sonnet", async () => {
    const fake = makeFakeClient({ kind: "ok" });
    __setClaudeClientForTests(fake);
    await generateResponse({ ...baseInput, tier: "sonnet" });
    // The vi.fn spy preserves identity even when read off the mocked
    // object — unbound-method false positive on a test double.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const createSpy = fake.messages.create as ReturnType<typeof vi.fn>;
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-6" }),
      expect.anything(),
    );
  });

  it("uses haiku model when tier is cached", async () => {
    const fake = makeFakeClient({ kind: "ok" });
    __setClaudeClientForTests(fake);
    await generateResponse({ ...baseInput, tier: "cached" });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const createSpy = fake.messages.create as ReturnType<typeof vi.fn>;
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5" }),
      expect.anything(),
    );
  });

  it("places cache_control on the patient-context system block", async () => {
    const fake = makeFakeClient({ kind: "ok" });
    __setClaudeClientForTests(fake);
    await generateResponse(baseInput);

    const calls = (fake.messages.create as ReturnType<typeof vi.fn>).mock.calls;
    const callArgs = calls[0]?.[0] as {
      system: { type: string; text: string; cache_control?: unknown }[];
    };
    expect(Array.isArray(callArgs.system)).toBe(true);
    expect(callArgs.system[0]).toEqual({
      type: "text",
      text: baseInput.systemPrompt,
    });
    expect(callArgs.system[1]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("does not include raw userId in metadata sent to Claude", async () => {
    const fake = makeFakeClient({ kind: "ok" });
    __setClaudeClientForTests(fake);
    await generateResponse(baseInput);
    const calls = (fake.messages.create as ReturnType<typeof vi.fn>).mock.calls;
    const callArgs = calls[0]?.[0] as { metadata: { user_id: string } };
    expect(callArgs.metadata.user_id).toBe(ctx.anonymizedId);
    expect(callArgs.metadata.user_id).not.toBe(baseInput.userId);
  });
});

describe("generateResponse — circuit breaker", () => {
  it("throws CHAT_CIRCUIT_OPEN when open_until is in the future", async () => {
    fakeStore.set("ai_circuit:open_until:test", String(Date.now() + 60_000));
    __setClaudeClientForTests(makeFakeClient({ kind: "ok" }));

    await expect(generateResponse(baseInput)).rejects.toMatchObject({
      code: "CHAT_CIRCUIT_OPEN",
    });
  });

  it("opens the breaker after 5 consecutive failures within the window", async () => {
    const fake = makeFakeClient({
      kind: "throw",
      err: new Anthropic.InternalServerError(500, { type: "error" }, "boom", new Headers()),
    });
    __setClaudeClientForTests(fake);

    for (let i = 0; i < 5; i += 1) {
      await expect(generateResponse(baseInput)).rejects.toBeInstanceOf(
        Anthropic.InternalServerError,
      );
    }
    // 5th failure should have flipped the breaker into the open state.
    expect(fakeStore.get("ai_circuit:open_until:test")).toBeDefined();
    expect(fakeStore.has("ai_circuit:fail_count:test")).toBe(false);
  });
});

describe("generateResponse — hard timeout", () => {
  it("aborts after CHAT_HARD_TIMEOUT_MS and raises CHAT_UPSTREAM_TIMEOUT", async () => {
    __setClaudeClientForTests(makeFakeClient({ kind: "abort" }));

    // Attach the rejection handler before advancing timers so the
    // rejection is never observed as unhandled by vitest's tracker.
    const assertion = expect(generateResponse(baseInput)).rejects.toMatchObject({
      code: "CHAT_UPSTREAM_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(12_500);
    await assertion;
  });
});

describe("generateResponse — spend cap", () => {
  it("flips ai_chat_tier3_enabled off when daily spend exceeds the cap", async () => {
    // Pre-load almost the full cap in cents (default 50 USD → 5000c).
    fakeStore.set(`ai_spend:${new Date().toISOString().slice(0, 10)}`, "4990");
    __setClaudeClientForTests(
      makeFakeClient({ kind: "ok", tokensInput: 100_000, tokensOutput: 100_000 }),
    );

    const { setFlag } = await import("../flags/index.js");
    await generateResponse({ ...baseInput, tier: "sonnet" });

    expect(setFlag).toHaveBeenCalledWith("ai_chat_tier3_enabled", false, "system:spend_cap");
  });

  it("does not flip the flag when spend stays under the cap", async () => {
    __setClaudeClientForTests(makeFakeClient({ kind: "ok", tokensInput: 500, tokensOutput: 50 }));

    const { setFlag } = await import("../flags/index.js");
    await generateResponse(baseInput);
    expect(setFlag).not.toHaveBeenCalled();
  });
});

describe("generateResponse — input shape guards", () => {
  it("compile-time refuses extra PII fields on PatientContext", () => {
    // This test exists for documentation. The compile-time guard runs
    // when the project typechecks; a runtime assertion is impossible
    // since TS types are erased. Adding a `phone` field below would
    // fail `pnpm typecheck`.
    const guard: PatientContext = {
      anonymizedId: "anon_xyz",
      ageRange: "70_plus",
      conditions: ["diabetes", "hypertension"],
      recentReadings: [],
      language: "en",
      condition: "multi",
    };
    expect(guard.anonymizedId).toBe("anon_xyz");
  });

  it("DomainError is thrown when CLAUDE_API_KEY unset and tests don't override", async () => {
    // No client override; env.CLAUDE_API_KEY is empty in test mode.
    __setClaudeClientForTests(null);
    await expect(generateResponse(baseInput)).rejects.toBeInstanceOf(DomainError);
  });
});
