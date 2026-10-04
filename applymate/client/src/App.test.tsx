import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api";
import { deferred, workspaceFixture } from "./test/fixtures";

afterEach(() => {
  api.reset();
  window.history.replaceState(null, "", "/");
});

describe("live workspace rather than a mock dashboard", () => {
  it.each([false, true])("boots cloud authentication without requesting private data before consent (authenticated=%s)", async (authenticated) => {
    const data = workspaceFixture();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (String(path).endsWith("/capabilities")) return Response.json({ ...data.capabilities, localOnly: false, mailMode: "microsoft" });
      if (String(path).endsWith("/session")) return Response.json({ user: null, authenticated });
      throw new Error(`Unexpected private request: ${String(path)}`);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    await screen.findByRole("heading", { name: "Meet your next chapter." });
    if (authenticated) {
      expect(screen.getByRole("checkbox")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open my online workspace" })).toBeDisabled();
    } else {
      expect(screen.getByRole("link", { name: "Continue with Microsoft" })).toHaveAttribute("href", "/.auth/login/aad?post_login_redirect_uri=/");
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shows the unavailable backend and retries without claiming a working account", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("unavailable"));
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach ApplyMate");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    const data = workspaceFixture();
    fetcher.mockImplementation(async (path) => Response.json(String(path).endsWith("/capabilities") ? data.capabilities : { user: null }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Meet your next chapter." })).toBeInTheDocument();
  });

  it("does not replace a newly saved profile with an older workspace response", async () => {
    window.location.hash = "profile";
    const original = workspaceFixture(true);
    const updated = structuredClone(original);
    updated.profile.revision = 1;
    updated.profile.fields.fullName.value = "Taylor Example";
    const older = deferred<Response>();
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (path, options) => {
      if (String(path).endsWith("/capabilities")) return Response.json(original.capabilities);
      if (String(path).endsWith("/session")) return Response.json({ user: original.user });
      if (String(path).endsWith("/profile") && options?.method === "PUT") return Response.json({ saved: true });
      if (String(path).endsWith("/workspace")) {
        reads++;
        if (reads === 2) return older.promise;
        return Response.json(reads === 1 ? original : updated);
      }
      throw new Error(`Unexpected test request: ${String(path)}`);
    }));
    render(<App />);
    await screen.findByRole("heading", { name: "Your candidate profile" });
    await waitFor(() => expect(reads).toBe(2));
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Full name"));
    await user.type(screen.getByLabelText("Full name"), "Taylor Example");
    await user.click(screen.getByRole("button", { name: "Save confirmed profile" }));
    await screen.findByText("Revision 1");
    await act(async () => { older.resolve(Response.json(original)); });
    expect(screen.getByText("Revision 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("Taylor Example");
  });
});
