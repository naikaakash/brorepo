import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { sampleJob, sampleResume, writingSample } from "../server/src/fixtures.js";
import { voicePrompts } from "@applymate/contracts";

export { sampleJob, sampleResume, writingSample };

export async function login(page: Page, email = `synthetic-${randomUUID()}@example.test`) {
  await page.goto("/");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("checkbox", { name: /I understand this is a local evaluation/ }).check();
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByRole("heading", { name: "Check your code" })).toBeVisible();
  await page.getByRole("button", { name: "Open local email preview" }).click();
  await expect(page.getByLabel("Verification code", { exact: true })).toHaveValue(/^\d{6}$/);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Good things start here.");
  return email;
}

export async function navigate(page: Page, label: string) {
  const toggle = page.getByRole("button", { name: "Open navigation" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
  await page.waitForFunction((name) => document.querySelector('.nav-link[aria-current="page"]')?.textContent?.trim().startsWith(name), label);
}

export async function inspect(page: Page, stage: string, info?: TestInfo) {
  await test.step(`Check ${stage} at the actual viewport`, async () => {
    expect(await page.locator("iframe").count()).toBe(0);
    const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect.soft(size.scroll, `${stage}: horizontal overflow`).toBeLessThanOrEqual(size.width + 1);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]).analyze();
    expect.soft(result.violations.map((violation) => ({
      id: violation.id, impact: violation.impact,
      nodes: violation.nodes.map((node) => ({ target: node.target, reason: node.failureSummary }))
    })), `${stage}: automated accessibility findings`).toEqual([]);
    if (info && process.env.APPLYMATE_CAPTURE_DIR) {
      await page.screenshot({ path: join(process.env.APPLYMATE_CAPTURE_DIR, `${info.project.name}-${stage}.png`), fullPage: true, animations: "disabled" });
    }
  });
}

export async function uploadText(page: Page, text = sampleResume, name = "synthetic-resume.txt") {
  await page.getByLabel("Resume file").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  await page.getByRole("button", { name: "Upload resume", exact: true }).click();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("Taylor Reed");
}

export async function voiceBaseline(page: Page) {
  for (let index = 0; index < 3; index++) {
    await page.getByLabel(`Your answer: ${voicePrompts[index].title}`, { exact: true }).fill(writingSample);
    if (index < 2) await page.getByRole("button", { name: "Next prompt" }).click();
  }
  await page.getByRole("button", { name: "Save voice profile" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set your direction");
}

export async function downloadBytes(page: Page, name: string) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  if (!stream) throw new Error("The browser did not provide the downloaded document.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return { bytes: Buffer.concat(chunks), filename: download.suggestedFilename() };
}
