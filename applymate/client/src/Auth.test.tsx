import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { policyVersion } from "@applymate/contracts";
import { Auth } from "./Auth";
import { api } from "./api";
import { deferred } from "./test/fixtures";

afterEach(() => api.reset());
async function requestCode() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email address"), "learner@example.test");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
  return user;
}
const letter = () => Response.json({ code: "123456", expiresAt: "2026-10-03T01:00:00Z", notice: "No email delivered." });

describe("passwordless sign-in interface", () => {
  it("requires consent and signs in using the real transport contract without browser persistence", async () => {
    const signedIn = vi.fn(async () => undefined);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ success: true })).mockResolvedValueOnce(letter())
      .mockResolvedValueOnce(Response.json({ user: { id: "synthetic-user", email: "learner@example.test" }, token: "synthetic-session-token" }));
    vi.stubGlobal("fetch", fetcher);
    render(<Auth mailMode="local" signedIn={signedIn} />);
    expect(screen.getByRole("button", { name: "Send sign-in code" })).toBeDisabled();
    const user = await requestCode();
    await screen.findByRole("heading", { name: "Check your code" });
    expect(screen.getByLabelText("Verification code")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Open local email preview" }));
    await waitFor(() => expect(screen.getByLabelText("Verification code")).toHaveValue("123456"));
    await user.click(screen.getByRole("button", { name: "Verify and continue" }));
    await waitFor(() => expect(signedIn).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls[2][1]?.headers).toHaveProperty("X-Applymate-Consent", policyVersion);
    expect(fetcher.mock.calls[2][1]?.body).toBe('{"email":"learner@example.test","otp":"123456"}');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("prevents a pending code request or preview from switching accounts underneath the response", async () => {
    const sent = deferred<Response>();
    const preview = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(sent.promise).mockReturnValueOnce(preview.promise);
    vi.stubGlobal("fetch", fetcher);
    render(<Auth mailMode="local" signedIn={vi.fn(async () => undefined)} />);
    const user = await requestCode();
    expect(screen.getByLabelText("Email address")).toHaveAttribute("readonly");
    await user.type(screen.getByLabelText("Email address"), ".wrong");
    expect(screen.getByLabelText("Email address")).toHaveValue("learner@example.test");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { sent.resolve(Response.json({ success: true })); });
    await screen.findByRole("heading", { name: "Check your code" });
    await user.click(screen.getByRole("button", { name: "Open local email preview" }));
    expect(screen.getByRole("button", { name: "Use another email" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Use another email" }));
    await user.type(screen.getByLabelText("Verification code"), "111111");
    expect(screen.getByLabelText("Verification code")).toHaveValue("");
    await act(async () => { preview.resolve(letter()); });
    await waitFor(() => expect(screen.getByLabelText("Verification code")).toHaveValue("123456"));
    await user.click(screen.getByRole("button", { name: "Use another email" }));
    expect(screen.getByLabelText("Email address")).toHaveValue("learner@example.test");
    expect(screen.getByLabelText("Email address")).toHaveFocus();
  });

  it("clears a superseded code and shows an explicit verification failure in delivered-mail mode", async () => {
    const signedIn = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json({ message: "The code is invalid or expired.", code: "INVALID_OTP" }, { status: 400 })));
    render(<Auth mailMode="smtp" signedIn={signedIn} />);
    const user = await requestCode();
    await screen.findByRole("heading", { name: "Check your code" });
    expect(screen.queryByRole("button", { name: "Open local email preview" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Request a new code" }));
    await waitFor(() => expect(screen.getByLabelText("Verification code")).toHaveValue(""));
    await user.type(screen.getByLabelText("Verification code"), "654321");
    await user.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The code is invalid or expired.");
    expect(signedIn).not.toHaveBeenCalled();
  });
});
