import { expect } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
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
  const output = join(root, "public/screenshots");
  await rm(output, { recursive: true, force: true });
  await mkdir(output);
  for (const theme of ["dark", "light"] as const) {
    const context = await site.browser.newContext({
      viewport: { width: 720, height: 720 },
      deviceScaleFactor: 2,
      colorScheme: theme,
      timezoneId: "America/Los_Angeles",
    });
    const page = await context.newPage();
    // The top of the page as it is, at twice its size, as <name>-<theme>.webp.
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
        .write(join(output, `${name}-${theme}.webp`));
    }

    // The public pages as readers see them, logged out.
    await page.goto(baseURL);
    await shoot("home");

    await page.goto(`${baseURL}/posts/mirastory1`);
    await expect(
      page.getByText("No route, no list, no podcast."),
    ).toBeVisible();
    await shoot("post");

    await context.request.post(`${baseURL}/admin/login`, {
      form: { password },
    });
    await page.goto(`${baseURL}/admin/posts/new`);
    await compose(page, site.art, 0);
    await page.mouse.move(0, 0);
    await shoot("composer");
    await context.close();
  }
  console.log("Saved public/screenshots/ using fictional content.");
} finally {
  await site.close();
}
