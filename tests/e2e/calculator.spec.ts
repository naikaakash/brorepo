import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("uses the real backend for scientific math, history, and errors", async ({ page }) => {
  const input = page.getByLabel("Mathematical expression");
  await page.getByRole("button", { name: "DEG", exact: true }).click();
  await input.fill("sin(30)+sqrt(81)");
  const response = page.waitForResponse((value) => value.url().endsWith("/api/calculate"));
  await input.press("Enter");
  expect((await response).status()).toBe(200);
  await expect(page.getByLabel("Result", { exact: true })).toHaveText("9.5");
  await expect(page.getByRole("button", { name: /sin\(30\).*9.5/ })).toBeVisible();

  await page.getByRole("button", { name: "RAD", exact: true }).click();
  await input.fill("cos(pi)+2^3^2");
  await input.press("Enter");
  await expect(page.getByLabel("Result", { exact: true })).toHaveText("511");
  await page.getByRole("button", { name: /sin\(30\).*9.5/ }).click();
  await expect(input).toHaveValue("sin(30)+sqrt(81)");
  await expect(page.getByRole("button", { name: "DEG", exact: true })).toHaveAttribute("aria-pressed", "true");

  await input.fill("1/0");
  await input.press("Enter");
  await expect(page.getByText("Cannot divide by zero.")).toBeVisible();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.press("Escape");
  await expect(input).toHaveValue("");
  await expect(page.getByLabel("Result", { exact: true })).toHaveText("0");

  await page.reload();
  await expect(page.getByText("Your calculations will appear here.")).toBeVisible();
});

test("keypad uses normal numeric rows and edits at the cursor", async ({ page }) => {
  const input = page.getByLabel("Mathematical expression");
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByRole("button", { name: "add", exact: true }).click();
  await page.getByRole("button", { name: "3", exact: true }).click();
  await page.getByRole("button", { name: "calculate", exact: true }).click();
  await expect(page.getByLabel("Result", { exact: true })).toHaveText("10");

  await input.fill("12+3");
  await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(1, 2));
  await page.getByRole("button", { name: "9", exact: true }).click();
  await expect(input).toHaveValue("19+3");
  await page.getByRole("button", { name: "backspace", exact: true }).click();
  await expect(input).toHaveValue("1+3");
});

async function tabTo(page: Page, target: Locator, backwards = false) {
  for (let step = 0; step < 60; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
  }
  await expect(target).toBeFocused();
}

test("every keypad key works with Enter and Space without losing keyboard focus", async ({ page }) => {
  test.setTimeout(60_000);
  const input = page.getByLabel("Mathematical expression");
  const snapshot = await page.locator("body").ariaSnapshot();
  expect(snapshot).not.toMatch(/- (menubar|menu|grid|tree|tablist|listbox)\b/);
  await tabTo(page, input);
  const keys = [
    ["sin", "sin("], ["cos", "cos("], ["tan", "tan("], ["pi", "pi"], ["e", "e"],
    ["inverse sine", "asin("], ["inverse cosine", "acos("], ["inverse tangent", "atan("],
    ["power", "^"], ["square root", "sqrt("], ["ln", "ln("], ["log", "log("],
    ["(", "("], [")", ")"], ["factorial", "!"],
    ["AC: clear expression", ""], ["backspace", ""], ["percent", "%"], ["divide", "/"],
    ["7", "7"], ["8", "8"], ["9", "9"], ["multiply", "*"],
    ["4", "4"], ["5", "5"], ["6", "6"], ["subtract", "-"],
    ["1", "1"], ["2", "2"], ["3", "3"], ["add", "+"], ["0", "0"], [".", "."]
  ];
  let expression = "";
  for (const [name, inserted] of keys) {
    const button = page.getByRole("button", { name, exact: true });
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS("outline-style", "solid");
    if (name === "AC: clear expression" || name === "backspace") {
      await tabTo(page, input, true);
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("12");
      await tabTo(page, button);
      expression = "12";
    }
    for (const activation of ["Enter", "Space"]) {
      await page.keyboard.press(activation);
      expression = name === "AC: clear expression" ? ""
        : name === "backspace" ? expression.slice(0, -1) : expression + inserted;
      await expect(input).toHaveValue(expression);
      await expect(button).toBeFocused();
      if (name === "AC: clear expression" && activation === "Enter") {
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Enter");
        await expect(input).toHaveValue("!");
        await page.keyboard.press("Tab");
      }
    }
  }

  const calculate = page.getByRole("button", { name: "calculate", exact: true });
  await page.keyboard.press("Tab");
  await expect(calculate).toBeFocused();
  await tabTo(page, input, true);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("2+2");
  await tabTo(page, calculate);
  for (const [index, activation] of ["Enter", "Space"].entries()) {
    await page.keyboard.press(activation);
    await expect(page.getByLabel("Result", { exact: true })).toHaveText("4");
    await expect(page.locator(".history-list button")).toHaveCount(index + 1);
    await expect(calculate).toBeFocused();
  }
});

test("header, modes, input, and history are keyboard-operable", async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "BroCalc home" })).toBeFocused();
  await Promise.all([page.waitForEvent("domcontentloaded"), page.keyboard.press("Enter")]);
  await tabTo(page, page.getByRole("link", { name: "Source" }));
  await context.route("https://github.com/naikaakash/brorepo", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Source</title>" }));
  const opened = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const source = await opened;
  await expect(source).toHaveURL("https://github.com/naikaakash/brorepo");
  await source.close();
  await page.keyboard.press("Tab");
  const theme = await page.locator("html").getAttribute("data-theme");
  if (theme !== "light" && theme !== "dark") throw new Error("The page has no recognized theme.");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme === "light" ? "dark" : "light");
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.keyboard.press("Tab");
  const rad = page.getByRole("button", { name: "RAD", exact: true });
  const deg = page.getByRole("button", { name: "DEG", exact: true });
  await expect(rad).toBeFocused();
  for (const activation of ["Enter", "Space"]) {
    await page.keyboard.press("Tab");
    await expect(deg).toBeFocused();
    await page.keyboard.press(activation);
    await expect(deg).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press(activation);
    await expect(rad).toHaveAttribute("aria-pressed", "true");
  }
  const input = page.getByLabel("Mathematical expression");
  await tabTo(page, input);
  await page.keyboard.type("8");
  await expect(input).toHaveValue("8");
  await page.keyboard.press("Backspace");
  await expect(input).toHaveValue("");
  for (const activation of ["Enter", "Space"]) {
    await page.keyboard.type("2^3");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Result", { exact: true })).toHaveText("8");
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("");
    const history = page.locator(".history-list button").first();
    await tabTo(page, history);
    await page.keyboard.press(activation);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("2^3");
    const clearHistory = page.getByRole("button", { name: "Clear history" });
    await tabTo(page, clearHistory);
    await page.keyboard.press(activation);
    await expect(page.getByText("Your calculations will appear here.")).toBeVisible();
    await tabTo(page, input);
    await page.keyboard.press("Escape");
  }
});

test("recovers from an unavailable API without inventing an answer", async ({ page }) => {
  await page.route("**/api/calculate", (route) => route.abort());
  await page.getByLabel("Mathematical expression").fill("2+2");
  await page.getByRole("button", { name: "calculate", exact: true }).click();
  await expect(page.getByText("Cannot reach the calculator API. Check your connection and try again.")).toBeVisible();
  await expect(page.getByLabel("Result", { exact: true })).toHaveText("—");
});

test("clear cancels pending work and permits another calculation", async ({ page }) => {
  let releaseFirst!: () => void;
  const held = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let requests = 0;
  await page.route("**/api/calculate", async (route) => {
    requests += 1;
    if (requests === 1) {
      await held;
      await route.fulfill({ json: { result: 4, formattedResult: "4" } });
    } else {
      await route.fulfill({ json: { result: 9, formattedResult: "9" } });
    }
  });
  const input = page.getByLabel("Mathematical expression");
  await input.fill("2+2");
  await input.press("Enter");
  await expect(page.getByLabel("Result", { exact: true })).toHaveText("Calculating…");
  await page.getByRole("button", { name: "AC: clear expression" }).click();
  await input.fill("3*3");
  await input.press("Enter");
  await expect(page.getByLabel("Result", { exact: true })).toHaveText("9");
  releaseFirst();
  await expect(page.getByLabel("Result", { exact: true })).toHaveText("9");
  await expect(page.getByRole("button", { name: /2\+2.*4/ })).toHaveCount(0);
});

test("timeout is visible and allows retry", async ({ page }) => {
  await page.clock.install();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/calculate", async (route) => {
    await held;
    await route.fulfill({ json: { result: 4, formattedResult: "4" } });
  });
  await page.getByLabel("Mathematical expression").fill("2+2");
  await page.getByRole("button", { name: "calculate", exact: true }).click();
  await page.clock.fastForward(8001);
  await expect(page.getByText("The calculation timed out. Please try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "calculate", exact: true })).toBeEnabled();
  release();
});

test("keeps source access, complete results, and both themes usable at narrow widths", async ({ page }) => {
  await expect(page.getByRole("link", { name: "Source" })).toBeVisible();
  await page.getByLabel("Mathematical expression").fill("170!");
  await page.getByLabel("Mathematical expression").press("Enter");
  await expect(page.getByLabel("Result", { exact: true })).toHaveText(/^7\.2574156153\d*e\+306$/);
  for (const theme of ["light", "dark"] as const) {
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await toggle.count()) await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.getByLabel("Result", { exact: true }).evaluate((element) =>
      element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
});

test("passes automated accessibility checks in both themes", async ({ page }) => {
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByLabel("Mathematical expression").fill("2^3");
  await page.getByLabel("Mathematical expression").press("Enter");
  await expect(page.getByLabel("Result", { exact: true })).toHaveText("8");
  for (const theme of ["light", "dark"] as const) {
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await toggle.count()) await toggle.click();
    const results = await new AxeBuilder({ page }).withTags([
      "wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"
    ]).analyze();
    expect(results.violations).toEqual([]);
  }
});
