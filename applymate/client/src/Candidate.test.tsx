import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { voicePrompts } from "@applymate/contracts";
import { ProfilePage, VoicePage } from "./Candidate";
import { Dashboard } from "./Dashboard";
import { workspaceFixture } from "./test/fixtures";

describe("resume-first onboarding and saved voice continuity", () => {
  it("prefills confirmed contact details without asking for them again during onboarding", async () => {
    const data = workspaceFixture();
    render(<ProfilePage data={data} refresh={vi.fn(async () => undefined)} navigate={vi.fn()} />);
    expect(screen.getByLabelText("Full name")).toBeVisible();
    expect(screen.getByLabelText("Contact email")).toHaveValue(data.user.email);
    expect(screen.getByLabelText("Contact email")).not.toBeVisible();
    await userEvent.setup().click(screen.getByText("Already confirmed details (1)"));
    expect(screen.getByLabelText("Contact email")).toBeVisible();
  });

  it("retains the active writing prompt when a saved version updates", async () => {
    const data = workspaceFixture(true);
    const props = { data, refresh: vi.fn(async () => undefined), navigate: vi.fn() };
    const view = render(<VoicePage {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next prompt" }));
    await user.click(screen.getByRole("button", { name: "Next prompt" }));
    const saved = { ...data.voice!, id: crypto.randomUUID(), version: 2 };
    view.rerender(<VoicePage {...props} data={{ ...data, voice: saved }} />);
    expect(screen.getByLabelText(`Your answer: ${voicePrompts[2].title}`)).toHaveValue(saved.answers[2].text);
    expect(screen.getByText("Version 2", { exact: false })).toBeVisible();
  });

  it.each(["fullName", "email", "voice"] as const)("does not claim readiness when %s becomes unconfirmed", async (field) => {
    const data = workspaceFixture(true);
    if (field === "voice") data.voice!.complete = false;
    else data.profile.fields[field].state = "proposed";
    const navigate = vi.fn();
    render(<Dashboard data={data} refresh={vi.fn(async () => undefined)} navigate={navigate} />);
    expect(screen.queryByRole("button", { name: "Find your next opportunity" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Setup completion" })).toHaveAttribute("value", "3");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue your setup" }));
    expect(navigate).toHaveBeenCalledWith(field === "voice" ? "voice" : "profile");
  });
});
