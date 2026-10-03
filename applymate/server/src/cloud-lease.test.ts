import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireCloudLease } from "./cloud-lease.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function configure() {
  vi.stubEnv("IDENTITY_ENDPOINT", "http://localhost/identity");
  vi.stubEnv("IDENTITY_HEADER", "test-header");
  vi.stubEnv("APPLYMATE_IDENTITY_CLIENT_ID", "test-client");
  vi.stubEnv("APPLYMATE_LEASE_URL", "https://teststore.blob.core.windows.net/runtime/lease");
}

function responses(statuses: number[], errorCode?: string) {
  return vi.fn(async (input: string | URL) => {
    if (String(input).includes("/identity")) return Response.json({ access_token: "test-token" });
    return new Response(null, { status: statuses.shift() ?? 200, headers: errorCode ? { "x-ms-error-code": errorCode } : {} });
  });
}

describe("exclusive cloud database lease", () => {
  it("acquires, renews, and releases exactly once", async () => {
    configure();
    vi.useFakeTimers();
    const fetch = responses([201, 201, 200, 200]);
    vi.stubGlobal("fetch", fetch);
    const failed = vi.fn();
    const release = await acquireCloudLease(failed);
    await vi.advanceTimersByTimeAsync(20000);
    expect(failed).not.toHaveBeenCalled();
    await release();
    await release();
    expect(fetch).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(40000);
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  it.each([
    [412, undefined], [409, "LeaseIdMissingWithBlobOperation"], [409, "BlobAlreadyExists"]
  ])("allows an existing blob (%s) but still requires exclusive acquisition", async (status, code) => {
    configure();
    vi.stubGlobal("fetch", responses([Number(status), 409], typeof code === "string" ? code : undefined));
    await expect(acquireCloudLease(vi.fn())).rejects.toMatchObject({ code: "DATA_IN_USE" });
  });

  it("does not mask storage authorization failures", async () => {
    configure();
    vi.stubGlobal("fetch", responses([403]));
    await expect(acquireCloudLease(vi.fn())).rejects.toMatchObject({ code: "LEASE_STORAGE" });
  });

  it("stops the runtime when renewal fails", async () => {
    configure();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", responses([201, 201, 409, 200]));
    const failed = vi.fn();
    const release = await acquireCloudLease(failed);
    await vi.advanceTimersByTimeAsync(20000);
    expect(failed).toHaveBeenCalledOnce();
    await release();
  });

  it("rejects missing platform configuration before making requests", async () => {
    vi.stubEnv("IDENTITY_ENDPOINT", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(acquireCloudLease(vi.fn())).rejects.toMatchObject({ code: "LEASE_CONFIG" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
