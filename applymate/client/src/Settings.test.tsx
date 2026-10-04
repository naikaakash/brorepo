import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./Settings";
import { workspaceFixture } from "./test/fixtures";

describe("account deletion", () => {
  it("offers explicit Microsoft reauthentication without deleting on navigation", async () => {
    const data = workspaceFixture(true);
    data.capabilities.localOnly = false;
    data.capabilities.mailMode = "microsoft";
    const deleted = vi.fn();
    render(<SettingsPage data={data} refresh={vi.fn()} navigate={vi.fn()} deleted={deleted} />);
    const link = screen.getByRole("link", { name: "Verify Microsoft sign-in again" });
    const logout = new URL(link.getAttribute("href")!, "https://applymate.test");
    expect(logout.pathname).toBe("/.auth/logout");
    const login = new URL(logout.searchParams.get("post_logout_redirect_uri")!, logout.origin);
    expect(login.pathname).toBe("/.auth/login/aad");
    expect(login.searchParams.get("post_login_redirect_uri")).toBe("/#settings");
    expect(screen.getByRole("button", { name: "Permanently delete account" })).toBeDisabled();
    expect(deleted).not.toHaveBeenCalled();
  });

  it("retains data on stale sign-in and deletes only after a new explicit confirmation succeeds", async () => {
    const data = workspaceFixture(true);
    data.capabilities.localOnly = false;
    data.capabilities.mailMode = "microsoft";
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: "REAUTHENTICATE", message: "Verify Microsoft sign-in again. Nothing was deleted." } }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ deleted: true }));
    vi.stubGlobal("fetch", fetcher);
    const deleted = vi.fn();
    render(<SettingsPage data={data} refresh={vi.fn()} navigate={vi.fn()} deleted={deleted} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(screen.getByRole("button", { name: "Permanently delete account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was deleted.");
    expect(deleted).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Permanently delete account" }));
    await vi.waitFor(() => expect(deleted).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenLastCalledWith("/api/account", expect.objectContaining({
      method: "DELETE", body: JSON.stringify({ confirmation: "DELETE" })
    }));
  });
});
