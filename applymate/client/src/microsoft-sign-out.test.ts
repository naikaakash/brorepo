import { afterEach, describe, expect, it, vi } from "vitest";
import { microsoftSignOut } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("Microsoft session recovery", () => {
  it.each(["/", "/.auth/login/aad?post_login_redirect_uri=%2F%23settings"])("clears the session before navigating to %s even when Azure returns an empty page", async (destination) => {
    const assign = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("window", { location: { assign } });
    vi.stubGlobal("fetch", fetcher);
    await microsoftSignOut(destination);
    expect(fetcher).toHaveBeenCalledWith("/.auth/logout", expect.objectContaining({ credentials: "same-origin", signal: expect.any(AbortSignal) }));
    expect(assign).toHaveBeenCalledWith(destination);
    expect(fetcher.mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0]);
  });

  it("reports a failed logout without pretending the rejected session has been cleared", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(microsoftSignOut()).rejects.toThrow("Microsoft sign-out failed");
    expect(assign).not.toHaveBeenCalled();
  });
});
