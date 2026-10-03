import { describe, expect, it, vi } from "vitest";
import { z } from "@applymate/contracts";
import { ApiClient, cancelled, savedSchema } from "./api";
import { deferred } from "./test/fixtures";

describe("validated, cancellable API transport", () => {
  it("sends same-origin mutations and leaves multipart boundaries to the browser", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ saved: true }));
    vi.stubGlobal("fetch", fetcher);
    const client = new ApiClient();
    expect(await client.request("/profile", savedSchema, { method: "PUT", body: { revision: 1 } })).toEqual({ saved: true });
    expect(fetcher).toHaveBeenCalledWith("/api/profile", expect.objectContaining({
      credentials: "same-origin", method: "PUT", body: '{"revision":1}',
      headers: { "X-Applymate-Request": "1", "Content-Type": "application/json" }
    }));
    const body = new FormData();
    body.append("resume", new File(["synthetic text"], "resume.txt"));
    await client.request("/documents", savedSchema, { method: "POST", body });
    expect(fetcher.mock.calls[1][1]?.body).toBe(body);
    expect(fetcher.mock.calls[1][1]?.headers).not.toHaveProperty("Content-Type");
  });

  it.each([Response.json({ saved: false }), new Response("<html>not JSON</html>")])("rejects a malformed success instead of inventing data", async (response) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));
    await expect(new ApiClient().request("/profile", savedSchema)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("surfaces API and authentication errors and reports an unreachable server", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const client = new ApiClient();
    client.onUnauthorized = vi.fn();
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: "PROFILE_CHANGED", message: "Reopen your profile." } }, { status: 409 }));
    await expect(client.request("/profile", savedSchema)).rejects.toMatchObject({ code: "PROFILE_CHANGED", status: 409, message: "Reopen your profile." });
    fetcher.mockResolvedValueOnce(Response.json({ message: "Verify a new code.", code: "EXPIRED" }, { status: 401 }));
    await expect(client.request("/workspace", savedSchema)).rejects.toMatchObject({ code: "EXPIRED" });
    expect(client.onUnauthorized).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValueOnce(new TypeError("network failure"));
    await expect(client.request("/workspace", savedSchema)).rejects.toMatchObject({ code: "OFFLINE" });
  });

  it("discards late responses, including stale 401s after an identity reset", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const client = new ApiClient();
    client.onUnauthorized = vi.fn();
    const stale = client.request("/workspace", savedSchema);
    const staleError = stale.catch((error: unknown) => error);
    client.reset();
    const current = client.request("/workspace", savedSchema);
    second.resolve(Response.json({ saved: true }));
    expect(await current).toEqual({ saved: true });
    first.resolve(Response.json({ message: "Old session expired." }, { status: 401 }));
    expect(cancelled(await staleError)).toBe(true);
    expect(client.onUnauthorized).not.toHaveBeenCalled();
  });

  it("cancels requests when the caller leaves and times out stalled reads without retrying", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted.", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const client = new ApiClient();
    const controller = new AbortController();
    const leaving = client.request("/workspace", z.object({}), { signal: controller.signal });
    const leavingError = leaving.catch((error: unknown) => error);
    controller.abort();
    expect(cancelled(await leavingError)).toBe(true);
    const stalled = client.request("/workspace", z.object({}));
    const assertion = expect(stalled).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(60000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("downloads only the expected document type and releases the temporary object URL", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:synthetic-download");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("%PDF-synthetic", { headers: { "Content-Type": "application/pdf" } }))
      .mockResolvedValueOnce(new Response("<html>not a document</html>", { headers: { "Content-Type": "text/html" } }));
    vi.stubGlobal("fetch", fetcher);
    const client = new ApiClient();
    await client.download("/packages/example/export/resume/pdf", "resume.pdf", "application/pdf");
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-download");
    await expect(client.download("/packages/example/export/resume/pdf", "resume.pdf", "application/pdf")).rejects.toMatchObject({ code: "INVALID_DOWNLOAD" });
    expect(click).toHaveBeenCalledTimes(1);
  });
});
