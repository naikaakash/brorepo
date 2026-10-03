import { afterEach, describe, expect, it, vi } from "vitest";
import { calculate } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("API client", () => {
  it.each([
    {},
    null,
    { result: "4", formattedResult: "4" },
    { result: 4 },
    { result: 4, formattedResult: "NaN" },
    { result: 4, formattedResult: "x".repeat(33) }
  ])("rejects malformed successful responses", async (body) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(calculate("2+2", "RAD", new AbortController().signal)).rejects.toThrow("invalid result");
  });

  it("surfaces HTML responses explicitly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>error</html>"));
    await expect(calculate("2+2", "RAD", new AbortController().signal)).rejects.toThrow("invalid response");
  });

  it("surfaces network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(calculate("2+2", "RAD", new AbortController().signal)).rejects.toThrow("Cannot reach");
  });
});
