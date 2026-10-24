import { expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  baseURL,
  compose,
  password,
  root,
  startDemoSite,
} from "./demo-site.ts";

const site = await startDemoSite();
try {
  const context = await site.browser.newContext({
    viewport: { width: 720, height: 720 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    timezoneId: "America/Los_Angeles",
  });
  await context.request.post(`${baseURL}/admin/login`, { form: { password } });
  const page = await context.newPage();
  const output = join(root, "public/screenshots");
  await mkdir(output, { recursive: true });
  // The top of the page as it is, at twice its size, as WebP.
  async function shoot(name: string) {
    await page.evaluate(() =>
      Promise.all([
        document.fonts.ready,
        ...Array.from(
          document.querySelectorAll<HTMLImageElement>("main img"),
          (image) => image.decode().catch(() => {}),
        ),
      ]),
    );
    const png = await page.screenshot();
    await new Bun.Image(png)
      .webp({ quality: 82 })
      .write(join(output, `${name}.webp`));
  }

  await page.goto(baseURL);
  await shoot("home");

  await page.goto(`${baseURL}/posts/mirastory1`);
  await expect(
    page.getByRole("heading", {
      name: "A notebook, a long walk, and no plans",
    }),
  ).toBeVisible();
  await shoot("article");

  await page.goto(`${baseURL}/admin/posts/new`);
  await compose(page, site.art, 0);
  await page.mouse.move(0, 0);
  await shoot("composer");
  await context.close();
  console.log("Saved public/screenshots/ using fictional content.");
} finally {
  await site.close();
}
