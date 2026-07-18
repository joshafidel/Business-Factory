import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("rejects invalid credentials", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("owner@factory.local");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});

test("redirects unauthenticated visitors to sign-in", async ({ page }) => {
  await page.goto("/agents");
  await expect(page).toHaveURL(/sign-in/);
});

test("owner signs in and sees the dashboard", async ({ page }) => {
  await signIn(page, "owner@factory.local");
  await expect(page.getByText("Factory Demo Org").first()).toBeVisible();
  await expect(page.getByText("Active workflows")).toBeVisible();
});

test("viewer cannot see admin-only controls (RBAC)", async ({ page }) => {
  await signIn(page, "viewer@factory.local");
  await page.goto("/settings");
  // Members list renders, but the add-member form is admin-only.
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Add member")).toHaveCount(0);
  // Audit log requires REVIEWER+; viewer is bounced to overview.
  await page.goto("/audit");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("reviewer can open the approval inbox", async ({ page }) => {
  await signIn(page, "reviewer@factory.local");
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: "Approval Inbox" })).toBeVisible();
});
