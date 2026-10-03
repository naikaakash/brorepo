import { describe, expect, it, vi } from "vitest";
import { connectionSchema, z } from "@applymate/contracts";
import { Gateway } from "./gateway.js";
import type { Transport } from "./gateway.js";
import { metadata } from "./store.js";

const schema = z.object({ ok: z.literal(true) }).strict();
const connection = (provider: "openai" | "gemini" = "openai") => connectionSchema.parse({
  ...metadata(), provider, model: "fixture-model", suffix: "test", testedAt: null, status: "connected"
});
const completed = (text = '{"ok":true}') => ({
  status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }]
});
const key = "synthetic-test-key-not-a-credential";

describe("bounded provider transport without real provider calls", () => {
  it.each(["openai", "gemini"] as const)("uses %s structured output, fixed endpoints, and header-only credentials", async (provider) => {
    const transport = vi.fn<Transport>().mockResolvedValue(Response.json(provider === "openai" ? completed() : {
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "private reasoning", thought: true }, { text: '{"ok":true}' }] } }]
    }));
    const result = await new Gateway(transport).run(connection(provider), key, "Check the data.", { sample: "untrusted document" }, schema);
    expect(result).toEqual({ ok: true });
    const [url, options] = transport.mock.calls[0];
    expect(String(url)).toBe(provider === "openai" ? "https://api.openai.com/v1/responses" :
      "https://generativelanguage.googleapis.com/v1beta/models/fixture-model:generateContent");
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(options?.headers);
    expect(headers.get(provider === "openai" ? "Authorization" : "x-goog-api-key")).toBe(provider === "openai" ? `Bearer ${key}` : key);
    const body = String(options?.body);
    expect(body).not.toContain(key);
    expect(body).toContain("untrusted data");
    const parsed = JSON.parse(body);
    if (provider === "openai") {
      expect(parsed.store).toBe(false);
      expect(parsed.text.format.strict).toBe(true);
      expect(parsed.text.format.schema.additionalProperties).toBe(false);
    } else {
      expect(parsed.generationConfig.responseMimeType).toBe("application/json");
      expect(parsed.generationConfig.responseJsonSchema.additionalProperties).toBe(false);
    }
  });
  it.each([401, 403, 429, 500])("reports HTTP %s without echoing provider payloads or retrying", async (status) => {
    const transport = vi.fn<Transport>().mockResolvedValue(Response.json({ error: "do-not-disclose-provider-detail" }, { status }));
    const work = new Gateway(transport).run(connection(), key, "Check.", {}, schema);
    await expect(work).rejects.toMatchObject({ code: "PROVIDER_REJECTED", status: 502 });
    await expect(work).rejects.not.toThrow("do-not-disclose-provider-detail");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    { raw: { status: "incomplete", output: [] }, code: "MODEL_INCOMPLETE" },
    { raw: { ...completed(), output: [{ type: "message", content: [{ type: "refusal" }, { type: "output_text", text: '{"ok":true}' }] }] }, code: "MODEL_INCOMPLETE" },
    { raw: completed("not JSON"), code: "MODEL_FORMAT" },
    { raw: completed('{"ok":false}'), code: "MODEL_SCHEMA" },
    { raw: completed('{"ok":true,"extra":"unrequested"}'), code: "MODEL_SCHEMA" }
  ])("fails closed on $code", async ({ raw, code }) => {
    const transport = vi.fn<Transport>().mockResolvedValue(Response.json(raw));
    await expect(new Gateway(transport).run(connection(), key, "Check.", {}, schema)).rejects.toMatchObject({ code });
  });
  it("bounds inputs and streaming responses and surfaces network/body interruptions", async () => {
    const transport = vi.fn<Transport>();
    const gateway = new Gateway(transport);
    await expect(gateway.run(connection(), key, "Check.", "x".repeat(60001), schema)).rejects.toMatchObject({ code: "MODEL_INPUT_LIMIT" });
    expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValueOnce(new Response(new Uint8Array(1024 * 1024 + 1)));
    await expect(gateway.run(connection(), key, "Check.", {}, schema)).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_LIMIT" });
    transport.mockRejectedValueOnce(new TypeError("network unavailable"));
    await expect(gateway.run(connection(), key, "Check.", {}, schema)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    transport.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error("interrupted")); } })));
    await expect(gateway.run(connection(), key, "Check.", {}, schema)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    transport.mockResolvedValueOnce(Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }));
    await expect(gateway.run(connection("gemini"), key, "Check.", {}, schema)).rejects.toMatchObject({ code: "MODEL_INCOMPLETE" });
  });
});
