// Mira's site, the fictional LogSpace site the demo video and screenshots are made from: the
// platform's server on a new temporary database and media directory, seeded by demo-server.ts
// with posts and the illustrations in demo-art/, drawn as PNGs first, since the server can't read
// SVGs.
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
const port = 44119;
export const baseURL = `http://127.0.0.1:${port}`;
export const password = "fictional-demo-password";

export async function startDemoSite() {
  const temporary = await mkdtemp(join(tmpdir(), "logspace-demo-"));
  const browser = await chromium.launch();
  const art = join(temporary, "art");
  await drawArt(browser, art);
  const server = spawn("bun", [join(root, "scripts/demo-server.ts")], {
    cwd: join(root, "../platform"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      LOGSPACE_DEMO: "1",
      LOGSPACE_DEMO_ART: art,
      PORT: String(port),
      ADMIN_PASSWORD: password,
      AUTH_SESSION_SECRET: "fictional-demo-session-secret",
      DATABASE_PATH: join(temporary, "app.sqlite"),
      MEDIA_DIR: join(temporary, "media"),
      CACHE_DIR: join(temporary, "cache"),
      MEDIA_STORAGE: "fs",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  server.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  server.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  async function close() {
    await browser.close();
    server.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", () => resolve());
    });
    await rm(temporary, { recursive: true, force: true });
  }
  try {
    await expect
      .poll(
        async () => {
          if (server.exitCode !== null) throw new Error(logs);
          return fetch(baseURL)
            .then((r) => r.status)
            .catch(() => 0);
        },
        { timeout: 30_000 },
      )
      .toBe(200);
  } catch (error) {
    await close();
    throw error;
  }
  return { browser, temporary, art, close };
}

// Each demo-art/<name>.svg as <dir>/<name>.png, at the size the SVG gives.
async function drawArt(browser: Browser, dir: string) {
  await mkdir(dir);
  const source = join(root, "scripts/demo-art");
  const page = await browser.newPage();
  for (const name of await readdir(source)) {
    if (!name.endsWith(".svg")) continue;
    await page.goto(`file://${join(source, name)}`);
    const svg = page.locator("svg");
    await page.setViewportSize({
      width: Number(await svg.getAttribute("width")),
      height: Number(await svg.getAttribute("height")),
    });
    await svg.screenshot({ path: join(dir, name.replace(/\.svg$/, ".png")) });
  }
  await page.close();
}

// Writes a photo post in the composer, typing at `delay` milliseconds a key.
export async function compose(page: Page, art: string, delay: number) {
  await page
    .getByLabel("Caption", { exact: true })
    .pressSequentially(
      "Took the long way home. Found a view worth keeping.\n\nA little landscape study from my sketchbook.",
      { delay },
    );
  await page
    .locator('input[name="image_uploads"]')
    .setInputFiles(join(art, "long-way-home.png"));
  await expect(page.locator("#composer-media img")).toBeVisible();
  await expect(page.locator("#composer-preview img")).toBeVisible();
}
