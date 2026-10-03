import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("App", () => {
  it("calculates through the backend and records session history", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result: 4, formattedResult: "4" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByLabelText("Mathematical expression");
    await user.type(input, "2+2{Enter}");

    expect(await screen.findByText("= 4")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/calculate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expression: "2+2", angleMode: "RAD" })
      })
    );
  });

  it("switches angle mode and reports API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Tangent is undefined at this angle." } }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "DEG" }));
    await user.type(screen.getByLabelText("Mathematical expression"), "tan(90)");
    await user.click(screen.getByRole("button", { name: "calculate" }));

    expect(await screen.findByText("Tangent is undefined at this angle.")).toBeInTheDocument();
  });

  it("clears with Escape", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText("Mathematical expression");

    await user.type(input, "123{Escape}");
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("keeps calculate focusable while blocking duplicate pending requests", async () => {
    let complete!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockReturnValue(new Promise<Response>((resolve) => { complete = resolve; }));
    render(<App />);
    const input = screen.getByLabelText("Mathematical expression");
    const button = screen.getByRole("button", { name: "calculate" });
    fireEvent.change(input, { target: { value: "2+2" } });
    button.focus();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
    fireEvent.click(button);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete(new Response(JSON.stringify({ result: 4, formattedResult: "4" })));
    });
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(button).toHaveFocus();
  });

  it("discards an older response after the expression changes", async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 9, formattedResult: "9" })));
    render(<App />);
    const input = screen.getByLabelText("Mathematical expression");
    fireEvent.change(input, { target: { value: "2+2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const firstSignal = fetchMock.mock.calls[0][1]?.signal;
    fireEvent.change(input, { target: { value: "3*3" } });
    expect(firstSignal?.aborted).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("= 9");
    await act(async () => {
      resolveFirst(new Response(JSON.stringify({ result: 4, formattedResult: "4" })));
    });
    expect(screen.getByLabelText("Result")).toHaveTextContent("9");
    expect(screen.queryByText("= 4")).not.toBeInTheDocument();
  });

  it("invalidates pending work when the angle mode changes", async () => {
    let complete!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>((resolve) => { complete = resolve; }));
    render(<App />);
    const input = screen.getByLabelText("Mathematical expression");
    fireEvent.change(input, { target: { value: "sin(30)" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "DEG" }));
    await act(async () => {
      complete(new Response(JSON.stringify({ result: -0.988, formattedResult: "-0.988" })));
    });
    expect(screen.getByLabelText("Result")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "calculate" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByText("Your calculations will appear here.")).toBeInTheDocument();
  });

  it("times out even if a transport ignores cancellation", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>(() => {}));
    render(<App />);
    const input = screen.getByLabelText("Mathematical expression");
    fireEvent.change(input, { target: { value: "2+2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    act(() => vi.advanceTimersByTime(8001));
    expect(screen.getByText("The calculation timed out. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "calculate" })).toHaveAttribute("aria-disabled", "false");
  });

  it("keeps keypad input within the same limit as typed input", () => {
    render(<App />);
    const input = screen.getByLabelText("Mathematical expression");
    fireEvent.change(input, { target: { value: "1".repeat(256) } });
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(input).toHaveValue("1".repeat(256));
    expect(screen.getByText("Expression must be 256 characters or fewer.")).toBeInTheDocument();
  });
});
