import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const install = "curl -fsSL https://logspace.app/install.sh | sh";

test("landing page, links, and responsive layout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A little spaceof your own.",
  );
  await expect(page.getByRole("link", { name: "Changelog" })).toHaveAttribute(
    "href",
    "https://github.com/aakashns/logspace/releases",
  );
  await page.getByRole("link", { name: "Make yourself at home" }).click();
  await expect(
    page.getByRole("heading", { name: "Your space starts here." }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#install-command")).toHaveText(install);
  expect(errors).toEqual([]);
});

test("copy succeeds, or gives a selectable fallback when access is denied", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Copy install command" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    install,
  );
  await expect(page.getByRole("status")).toContainText("copied");
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("Permission denied");
    };
  });
  await page.getByRole("button", { name: "Copy install command" }).click();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(install);
  await expect(page.getByRole("status")).toContainText("highlighted");
});

test("works without JavaScript and does not auto-play video", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:8787");
  await expect(page.locator("#install-command")).toHaveText(install);
  await expect(
    page.getByRole("button", { name: "Copy install command" }),
  ).toBeHidden();
  await expect(page.locator("video")).toHaveAttribute("controls", "");
  await expect(page.locator("video")).not.toHaveAttribute("autoplay");
  await context.close();
});

test("demo loads, plays, and seeks with captions available", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const video = page.locator("video");
  await video.evaluate(async (video: HTMLVideoElement) => {
    video.muted = true;
    await video.play();
  });
  await expect
    .poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0);
  expect(
    await video.evaluate((video: HTMLVideoElement) => video.duration),
  ).toBeGreaterThan(15);
  await video.evaluate((video: HTMLVideoElement) => {
    video.pause();
    video.currentTime = 10;
  });
  await expect
    .poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThanOrEqual(10);
  const captions = await request.get("/demo.vtt");
  expect(await captions.text()).toContain("WEBVTT");
  const poster = await request.get("/demo-poster.webp");
  expect(poster.headers()["content-type"]).toContain("image/webp");
});

test("serves the exact installer and rejects missing paths", async ({
  request,
}) => {
  const response = await request.get("/install.sh");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  expect(await response.text()).toBe(
    await readFile(new URL("../public/install.sh", import.meta.url), "utf8"),
  );
  expect((await request.get("/not-a-page")).status()).toBe(404);
});
