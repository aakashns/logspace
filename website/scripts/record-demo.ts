import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "logspace-demo-"));
const port = 44119;
const baseURL = `http://127.0.0.1:${port}`;
const password = "fictional-demo-password";
const server = spawn("bun", [join(root, "scripts/demo-server.ts")], {
  cwd: join(root, "../platform"),
  env: {
    ...process.env,
    NODE_ENV: "production",
    LOGSPACE_DEMO: "1",
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
const browser = await chromium.launch();
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
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
    recordVideo: { dir: temporary, size: { width: 1280, height: 900 } },
  });
  // Authenticate before the recording starts; only the fictional publishing flow is shown.
  await context.request.post(`${baseURL}/admin/login`, { form: { password } });
  const page = await context.newPage();
  const video = page.video()!;
  await page.goto(baseURL);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("main img").first()).toBeVisible();
  await page
    .locator("main img")
    .first()
    .evaluate((image: HTMLImageElement) => image.decode());
  const started = Date.now();
  const cues: { start: number; end: number; text: string }[] = [];
  // Pauses here set the pace of the recording, not the readiness of the app.
  async function hold(text: string, milliseconds: number) {
    const start = (Date.now() - started) / 1000;
    await page.waitForTimeout(milliseconds);
    cues.push({ start, end: (Date.now() - started) / 1000, text });
  }
  await page.screenshot({ path: join(temporary, "poster.png") });
  await hold("This example website uses a fictional profile and posts.", 3000);
  await page.evaluate(() => window.scrollTo({ top: 650, behavior: "smooth" }));
  await hold("Text posts, photos, and articles appear in one feed.", 2800);
  await page.locator('a[data-post-link][href="/posts/mirastory1"]').click();
  await expect(
    page.getByRole("heading", { name: "The long way around" }),
  ).toBeVisible();
  await hold("Open an article to read the full post.", 2600);
  await page.goto(`${baseURL}/admin`);
  await page.getByRole("link", { name: "New Post", exact: true }).click();
  await page.getByLabel("Date", { exact: true }).fill("2026-10-22T10:30");
  await page.getByLabel("UTC offset").fill("-07:00");
  await page.getByLabel("City (optional)").fill("Portland");
  await page
    .getByLabel("Caption", { exact: true })
    .pressSequentially(
      "Made a little space for the things I want to remember.\n\nToday: cold air, warm coffee, and the first page of a new notebook.",
      { delay: 42 },
    );
  await hold("Create a text post in the admin page.", 1000);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Made a little space for the things I want to remember.", {
      exact: false,
    }),
  ).toBeVisible();
  await hold("Click Publish to save the post at its own URL.", 2000);
  await page.goto(baseURL);
  await hold("The new post appears at the top of the feed.", 3000);
  await context.close();
  const recording = await video.path();
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      recording,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "24",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      join(root, "public/demo.mp4"),
    ],
    { stdio: "ignore" },
  );
  const sharp = createRequire(
    new URL("../../platform/package.json", import.meta.url),
  )("sharp");
  await sharp(join(temporary, "poster.png"))
    .webp({ quality: 88 })
    .toFile(join(root, "public/demo-poster.webp"));
  const stamp = (seconds: number) =>
    new Date(seconds * 1000).toISOString().slice(11, 23);
  await writeFile(
    join(root, "public/demo.vtt"),
    "WEBVTT\n\n" +
      cues
        .map(
          (cue) => `${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`,
        )
        .join("\n"),
  );
  console.log(
    "Recorded public/demo.mp4, demo-poster.webp, and demo.vtt using fictional content.",
  );
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null) resolve();
    else server.once("exit", () => resolve());
  });
  await rm(temporary, { recursive: true, force: true });
}
