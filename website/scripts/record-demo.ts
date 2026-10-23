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
    // A narrow viewport keeps the app’s content close to the edges of the recording.
    viewport: { width: 720, height: 720 },
    colorScheme: "light",
    recordVideo: { dir: temporary, size: { width: 720, height: 720 } },
  });
  // Authenticate before the recording starts; only the fictional publishing flow is shown.
  await context.request.post(`${baseURL}/admin/login`, { form: { password } });
  const started = Date.now();
  const page = await context.newPage();
  const video = page.video()!;
  const cues: { start: number; title: string; text: string }[] = [];
  function explain(title: string, text: string) {
    cues.push({
      start: cues.length ? (Date.now() - started) / 1000 : 0,
      title,
      text,
    });
  }
  // These pauses set the walkthrough’s pace; locators check that each screen is ready.
  const hold = (milliseconds: number) => page.waitForTimeout(milliseconds);
  await page.goto(baseURL);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("main img").first()).toBeVisible();
  await page
    .locator("main img")
    .first()
    .evaluate((image: HTMLImageElement) => image.decode());
  explain(
    "Browse the feed",
    "Text posts, photos, and articles appear together.",
  );
  await page.screenshot({ path: join(temporary, "poster.png") });
  await hold(3200);
  await page.evaluate(() => window.scrollTo({ top: 650, behavior: "smooth" }));
  await hold(2800);
  await page.locator('a.post-link[href="/posts/mirastory1"]').click();
  await expect(
    page.getByRole("heading", { name: "The long way around" }),
  ).toBeVisible();
  explain(
    "Read a blog post",
    "Open an article to read the full text on its own page.",
  );
  await hold(3200);
  await page.goto(`${baseURL}/admin`);
  await expect(
    page.getByRole("link", { name: "New Post", exact: true }),
  ).toBeVisible();
  explain(
    "Manage your site",
    "Sign in to edit posts, change settings, or create a post.",
  );
  await hold(2800);
  await page.getByRole("link", { name: "New Post", exact: true }).click();
  explain("Write a post", "Choose a format, add text or media, then publish.");
  await page.getByLabel("Date", { exact: true }).fill("2026-10-22T10:30");
  await page.getByLabel("UTC offset").fill("-07:00");
  await page.getByLabel("City (optional)").fill("Portland");
  await page
    .getByLabel("Caption", { exact: true })
    .pressSequentially(
      "Made a little space for the things I want to remember.\n\nToday: cold air, warm coffee, and the first page of a new notebook.",
      { delay: 42 },
    );
  await hold(1500);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByText("Made a little space for the things I want to remember.", {
      exact: false,
    }),
  ).toBeVisible();
  explain("Publish and share", "The published post has a URL you can share.");
  await hold(3000);
  await page.goto(baseURL);
  explain(
    "See the new post",
    "New posts appear at the top of your website’s feed.",
  );
  await hold(3200);
  const finished = (Date.now() - started) / 1000;
  await context.close();

  // Burn the captions into a separate band, so they do not cover the app and
  // remain visible when the video is shared without its WebVTT track.
  const captions = await browser.newPage({
    viewport: { width: 720, height: 96 },
  });
  const captionFiles: string[] = [];
  for (const [index, cue] of cues.entries()) {
    await captions.setContent(`<html><body style="margin:0;background:#161616;color:#dedede;font-family:Arial,sans-serif;display:flex;align-items:center;gap:18px;padding:18px 28px;box-sizing:border-box;height:96px">
      <span style="color:#a1a1a1;font-size:16px;white-space:nowrap">${index + 1} / ${cues.length}</span>
      <div><div id="title" style="font-size:21px;font-weight:600;margin-bottom:6px"></div><div id="text" style="font-size:17px;color:#b0b0b0"></div></div>
    </body></html>`);
    await captions.locator("#title").evaluate((element, text) => {
      element.textContent = text;
    }, cue.title);
    await captions.locator("#text").evaluate((element, text) => {
      element.textContent = text;
    }, cue.text);
    const file = join(temporary, `caption-${index}.png`);
    await captions.screenshot({ path: file });
    captionFiles.push(file);
  }
  await captions.close();
  const filters = ["[0:v]pad=720:816:0:0:color=0x161616[base]"];
  for (const [index, cue] of cues.entries()) {
    const input = index === 0 ? "base" : `caption${index - 1}`;
    const end = cues[index + 1]?.start;
    const enabled =
      end === undefined
        ? `gte(t,${cue.start})`
        : `between(t,${cue.start},${end})`;
    filters.push(
      `[${input}][${index + 1}:v]overlay=0:720:enable='${enabled}'[caption${index}]`,
    );
  }
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      await video.path(),
      ...captionFiles.flatMap((file) => ["-i", file]),
      "-filter_complex",
      filters.join(";"),
      "-map",
      `[caption${cues.length - 1}]`,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "22",
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
    .extend({ bottom: 96, background: "#161616" })
    .composite([{ input: captionFiles[0], top: 720, left: 0 }])
    .webp({ quality: 88 })
    .toFile(join(root, "public/demo-poster.webp"));
  const stamp = (seconds: number) =>
    new Date(seconds * 1000).toISOString().slice(11, 23);
  await writeFile(
    join(root, "public/demo.vtt"),
    "WEBVTT\n\n" +
      cues
        .map(
          (cue, index) =>
            `${stamp(cue.start)} --> ${stamp(cues[index + 1]?.start ?? finished)}\n${cue.title}. ${cue.text}\n`,
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
