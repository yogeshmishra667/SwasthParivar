import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@swasth/shared-types";
import {
  __setClaudeVisionClientForTests,
  generateVisionResponse,
  type PrescriptionContext,
  type VisionRequestInput,
} from "./claude-vision.js";

// In-memory Redis stand-in — same pattern as claude.test.ts. Vision
// keys live in a different namespace (`vision_circuit:*`,
// `vision_spend:*`) so they cannot collide with the chat fixtures.
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

vi.mock("../flags/index.js", () => ({
  setFlag: vi.fn(() => Promise.resolve(undefined)),
}));

const ctx: PrescriptionContext = {
  anonymizedPatientId: "anon_abc",
  prescriptionId: "rx_123",
};

const PRESCRIPTION_TEXT_JSON = JSON.stringify({
  lines: [
    {
      name: "Glycomet 500",
      dosage: "500 mg tab",
      frequency: "twice daily",
      confidence: 0.92,
      alternatives: [{ name: "Glycomet GP 1", confidence: 0.15 }],
    },
  ],
});

const BOTTLE_JSON = JSON.stringify({ aiReadName: "Glycomet GP 1", confidence: 0.87 });

type FakeResult =
  | { kind: "ok"; text?: string; tokensInput?: number; tokensOutput?: number }
  | { kind: "abort" }
  | { kind: "throw"; err: unknown };

const makeFakeClient = (result: FakeResult): Anthropic => {
  return {
    messages: {
      create: vi.fn(async (_params: unknown, opts?: { signal?: AbortSignal }) => {
        if (result.kind === "abort") {
          await new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener("abort", () => {
              reject(new Anthropic.APIUserAbortError({ message: "aborted" }));
            });
          });
          throw new Error("unreachable");
        }
        if (result.kind === "throw") throw result.err;
        return {
          content: [{ type: "text", text: result.text ?? PRESCRIPTION_TEXT_JSON }],
          usage: {
            input_tokens: result.tokensInput ?? 1500,
            output_tokens: result.tokensOutput ?? 80,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as unknown as Anthropic.Message;
      }),
    },
  } as unknown as Anthropic;
};

const baseInput: VisionRequestInput = {
  mode: "prescription_text",
  images: [{ kind: "url", url: "https://r2.example.com/rx_123/page-0.jpg" }],
  context: ctx,
  userId: "user_123",
  requestId: "req_abc",
};

beforeEach(async () => {
  fakeStore.clear();
  fakeTtls.clear();
  vi.useFakeTimers();
  const { setFlag } = await import("../flags/index.js");
  vi.mocked(setFlag).mockClear();
});

afterEach(() => {
  __setClaudeVisionClientForTests(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("generateVisionResponse — prescription_text happy path", () => {
  it("parses the lines payload + resets circuit on success", async () => {
    fakeStore.set("vision_circuit:fail_count:test", "2");
    __setClaudeVisionClientForTests(makeFakeClient({ kind: "ok" }));

    const result = await generateVisionResponse(baseInput);
    if (result.mode !== "prescription_text") throw new Error("wrong mode");

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      name: "Glycomet 500",
      dosage: "500 mg tab",
      frequency: "twice daily",
    });
    expect(result.lines[0]!.confidence).toBeCloseTo(0.92, 5);
    expect(result.lines[0]!.alternatives).toHaveLength(1);
    expect(result.meta.model).toBe("claude-sonnet-4-6");
    expect(fakeStore.has("vision_circuit:fail_count:test")).toBe(false);
  });

  it("clamps out-of-range confidence values to [0, 1]", async () => {
    __setClaudeVisionClientForTests(
      makeFakeClient({
        kind: "ok",
        text: JSON.stringify({
          lines: [
            { name: "A", dosage: "", frequency: "", confidence: 5, alternatives: [] },
            { name: "B", dosage: "", frequency: "", confidence: -0.5, alternatives: [] },
          ],
        }),
      }),
    );
    const result = await generateVisionResponse(baseInput);
    if (result.mode !== "prescription_text") throw new Error("wrong mode");
    expect(result.lines[0]!.confidence).toBe(1);
    expect(result.lines[1]!.confidence).toBe(0);
  });

  it("strips ```json fences if Vision wraps the response despite the system prompt", async () => {
    __setClaudeVisionClientForTests(
      makeFakeClient({ kind: "ok", text: "```json\n" + PRESCRIPTION_TEXT_JSON + "\n```" }),
    );
    const result = await generateVisionResponse(baseInput);
    if (result.mode !== "prescription_text") throw new Error("wrong mode");
    expect(result.lines).toHaveLength(1);
  });

  it("returns an empty lines array when Vision says 'blank prescription'", async () => {
    __setClaudeVisionClientForTests(
      makeFakeClient({ kind: "ok", text: JSON.stringify({ lines: [] }) }),
    );
    const result = await generateVisionResponse(baseInput);
    if (result.mode !== "prescription_text") throw new Error("wrong mode");
    expect(result.lines).toEqual([]);
  });
});

describe("generateVisionResponse — medicine_bottle + clarification_pass", () => {
  it("parses the bottle payload for medicine_bottle mode", async () => {
    __setClaudeVisionClientForTests(makeFakeClient({ kind: "ok", text: BOTTLE_JSON }));
    const result = await generateVisionResponse({ ...baseInput, mode: "medicine_bottle" });
    if (result.mode !== "medicine_bottle") throw new Error("wrong mode");
    expect(result.bottle).toEqual({ aiReadName: "Glycomet GP 1", confidence: 0.87 });
  });

  it("parses the bottle payload for clarification_pass mode (same shape)", async () => {
    __setClaudeVisionClientForTests(makeFakeClient({ kind: "ok", text: BOTTLE_JSON }));
    const result = await generateVisionResponse({
      ...baseInput,
      mode: "clarification_pass",
    });
    if (result.mode !== "clarification_pass") throw new Error("wrong mode");
    expect(result.bottle.aiReadName).toBe("Glycomet GP 1");
  });
});

describe("generateVisionResponse — input validation", () => {
  it("rejects requests with zero images at the wrapper boundary", async () => {
    __setClaudeVisionClientForTests(makeFakeClient({ kind: "ok" }));
    await expect(generateVisionResponse({ ...baseInput, images: [] })).rejects.toMatchObject({
      code: "VISION_NO_IMAGES",
    });
  });

  it("raises VISION_INVALID_JSON when Vision returns non-JSON text", async () => {
    __setClaudeVisionClientForTests(makeFakeClient({ kind: "ok", text: "I cannot read this." }));
    await expect(generateVisionResponse(baseInput)).rejects.toMatchObject({
      code: "VISION_INVALID_JSON",
    });
  });

  it("passes base64 images through unchanged", async () => {
    const fake = makeFakeClient({ kind: "ok" });
    __setClaudeVisionClientForTests(fake);
    await generateVisionResponse({
      ...baseInput,
      images: [{ kind: "base64", mediaType: "image/jpeg", data: "AAAA" }],
    });

    const calls = (fake.messages.create as ReturnType<typeof vi.fn>).mock.calls;
    const payload = calls[0]?.[0] as { messages: { content: { source: { type: string } }[] }[] };
    expect(payload.messages[0]?.content[0]?.source.type).toBe("base64");
  });
});

describe("generateVisionResponse — PII guard", () => {
  it("uses the anonymised patient id, never the raw userId, in metadata", async () => {
    const fake = makeFakeClient({ kind: "ok" });
    __setClaudeVisionClientForTests(fake);
    await generateVisionResponse(baseInput);

    const calls = (fake.messages.create as ReturnType<typeof vi.fn>).mock.calls;
    const payload = calls[0]?.[0] as { metadata: { user_id: string } };
    expect(payload.metadata.user_id).toBe(ctx.anonymizedPatientId);
    expect(payload.metadata.user_id).not.toBe(baseInput.userId);
  });

  it("compile-time refuses extra PII fields on PrescriptionContext", () => {
    // Documentation test — adding `phone` below would fail typecheck.
    const guard: PrescriptionContext = {
      anonymizedPatientId: "anon_xyz",
      prescriptionId: "rx_xyz",
    };
    expect(guard.anonymizedPatientId).toBe("anon_xyz");
  });
});

describe("generateVisionResponse — circuit breaker", () => {
  it("throws VISION_CIRCUIT_OPEN when open_until is in the future", async () => {
    fakeStore.set("vision_circuit:open_until:test", String(Date.now() + 60_000));
    __setClaudeVisionClientForTests(makeFakeClient({ kind: "ok" }));

    await expect(generateVisionResponse(baseInput)).rejects.toMatchObject({
      code: "VISION_CIRCUIT_OPEN",
    });
  });

  it("opens the breaker after 5 consecutive upstream failures", async () => {
    const fake = makeFakeClient({
      kind: "throw",
      err: new Anthropic.InternalServerError(500, { type: "error" }, "boom", new Headers()),
    });
    __setClaudeVisionClientForTests(fake);

    for (let i = 0; i < 5; i += 1) {
      await expect(generateVisionResponse(baseInput)).rejects.toBeInstanceOf(
        Anthropic.InternalServerError,
      );
    }
    expect(fakeStore.get("vision_circuit:open_until:test")).toBeDefined();
    expect(fakeStore.has("vision_circuit:fail_count:test")).toBe(false);
  });
});

describe("generateVisionResponse — hard timeout", () => {
  it("aborts after VISION_HARD_TIMEOUT_MS and raises VISION_UPSTREAM_TIMEOUT", async () => {
    __setClaudeVisionClientForTests(makeFakeClient({ kind: "abort" }));

    const assertion = expect(generateVisionResponse(baseInput)).rejects.toMatchObject({
      code: "VISION_UPSTREAM_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
  });
});

describe("generateVisionResponse — spend cap", () => {
  it("flips prescription_ocr_enabled off when daily spend exceeds the Vision cap", async () => {
    // Default cap is 20 USD → 2000c. Pre-load 1990c.
    fakeStore.set(`vision_spend:${new Date().toISOString().slice(0, 10)}`, "1990");
    __setClaudeVisionClientForTests(
      makeFakeClient({ kind: "ok", tokensInput: 100_000, tokensOutput: 100_000 }),
    );

    const { setFlag } = await import("../flags/index.js");
    await generateVisionResponse(baseInput);

    expect(setFlag).toHaveBeenCalledWith(
      "prescription_ocr_enabled",
      false,
      "system:vision_spend_cap",
    );
  });

  it("does not flip the flag when spend stays under the cap", async () => {
    __setClaudeVisionClientForTests(
      makeFakeClient({ kind: "ok", tokensInput: 1000, tokensOutput: 80 }),
    );
    const { setFlag } = await import("../flags/index.js");
    await generateVisionResponse(baseInput);
    expect(setFlag).not.toHaveBeenCalled();
  });
});

describe("generateVisionResponse — missing API key", () => {
  it("throws DomainError when CLAUDE_API_KEY is unset and tests don't override", async () => {
    __setClaudeVisionClientForTests(null);
    await expect(generateVisionResponse(baseInput)).rejects.toBeInstanceOf(DomainError);
  });
});
