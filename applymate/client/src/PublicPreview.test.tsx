import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "./App";

it("renders the public frontend without contacting an API or accepting private data", () => {
  vi.stubEnv("VITE_PUBLIC_PREVIEW", "true");
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  render(<App />);
  expect(screen.getByText("Public frontend preview")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Meet your next chapter." })).toBeVisible();
  expect(screen.getByRole("link", { name: "View source & local setup" })).toHaveAttribute("href", "https://github.com/naikaakash/brorepo/tree/main");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send sign-in code" })).not.toBeInTheDocument();
  expect(transport).not.toHaveBeenCalled();
});
