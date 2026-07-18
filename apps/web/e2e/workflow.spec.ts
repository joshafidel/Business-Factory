import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * End-to-end sample workflow: topic in → research → draft → QC (all mock
 * provider) → human approval → asset saved. Exercises web, queue, worker,
 * engine, approvals, and storage together.
 */

async function startRun(page: Page, topic: string): Promise<void> {
  await page.goto("/workflows");
  await page.getByRole("link", { name: "Content Brief Pipeline" }).click();
  await page.getByLabel("Input (JSON)").fill(JSON.stringify({ topic }));
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page).toHaveURL(/\/runs\//);
}

async function waitForRunStatus(page: Page, status: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.reload();
        const badge = page.locator("header, div").first();
        void badge;
        return page
          .getByText(status.replaceAll("_", " "), { exact: true })
          .first()
          .isVisible()
          .catch(() => false);
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(true);
}

test("sample workflow pauses for approval and completes after approve", async ({ page }) => {
  await signIn(page, "owner@factory.local");
  const topic = `Approve path ${Date.now()}`;
  await startRun(page, topic);

  // Worker processes research → write → qc, then parks at the gate.
  await waitForRunStatus(page, "AWAITING APPROVAL");

  await page.goto("/approvals?status=PENDING");
  await page.getByRole("link", { name: "Review content draft" }).first().click();
  await page.getByLabel("Comment (optional)").fill("e2e approval");
  await page.getByRole("button", { name: "Approve" }).click();

  // Run resumes and completes; the asset is saved.
  await expect
    .poll(
      async () => {
        await page.goto("/runs?status=COMPLETED");
        return page
          .getByText("Content Brief Pipeline")
          .first()
          .isVisible()
          .catch(() => false);
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(true);

  await page.goto("/assets");
  await expect(page.getByText("Approved content draft").first()).toBeVisible();
});

test("rejecting the approval cancels the run", async ({ page }) => {
  await signIn(page, "reviewer@factory.local");
  const topic = `Reject path ${Date.now()}`;

  // Reviewer cannot start runs; the owner does that part.
  await page.context().clearCookies();
  await signIn(page, "owner@factory.local");
  await startRun(page, topic);
  await waitForRunStatus(page, "AWAITING APPROVAL");
  const runUrl = page.url();

  // Reviewer rejects.
  await page.context().clearCookies();
  await signIn(page, "reviewer@factory.local");
  await page.goto("/approvals?status=PENDING");
  await page.getByRole("link", { name: "Review content draft" }).first().click();
  await page.getByLabel("Comment (optional)").fill("e2e rejection");
  await page.getByRole("button", { name: "Reject" }).click();

  await expect
    .poll(
      async () => {
        await page.goto(runUrl);
        return page
          .getByText("CANCELLED")
          .first()
          .isVisible()
          .catch(() => false);
      },
      { timeout: 30_000, intervals: [2_000] },
    )
    .toBe(true);
});
