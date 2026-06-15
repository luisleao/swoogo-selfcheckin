import { expect, test } from "@playwright/test";

test("loads the unauthenticated sign-in route", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Swoogo Check-in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("loads a mocked authenticated admin route", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "swoogo.auth.mockUser",
      JSON.stringify({
        displayName: "Smoke Admin",
        email: "smoke@example.com",
        memberships: [
          {
            active: true,
            eventId: "demo-event",
            roles: ["event_admin"],
            scope: {
              allowedAreaIds: [],
              allowedGateIds: [],
              allowedQueueIds: [],
              allowedSessionIds: [],
            },
          },
        ],
        uid: "smoke-admin",
      })
    );
    window.localStorage.setItem("swoogo.event.selected", "demo-event");
  });

  await page.goto("/admin/event");

  await expect(page.getByRole("heading", { name: "Event configuration" })).toBeVisible();
  await expect(page.getByLabel("Selected event")).toHaveValue("demo-event");
});
