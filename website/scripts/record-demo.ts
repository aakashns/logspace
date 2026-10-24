import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
  baseURL,
  compose,
  password,
  root,
  startDemoSite,
} from "./demo-site.ts";

const site = await startDemoSite();
const { browser, temporary } = site;
try {
  const context = await browser.newContext({
    // A narrow viewport keeps the app’s content close to the edges of the recording.
    viewport: { width: 720, height: 720 },
    colorScheme: "dark",
    timezoneId: "America/Los_Angeles",
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
  const scrollTo = (top: number) =>
    page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), top);
  async function imagesReady() {
    await page.evaluate(() =>
      Promise.all([
        document.fonts.ready,
        ...Array.from(
          document.querySelectorAll<HTMLImageElement>("main img"),
          (image) => image.decode().catch(() => {}),
        ),
      ]),
    );
  }
  await page.goto(baseURL);
  await imagesReady();
  explain(
    "Browse the feed",
    "Text posts, photos, and articles appear together.",
  );
  await page.screenshot({ path: join(temporary, "poster.png") });
  await hold(3000);
  await scrollTo(560);
  await hold(2400);
  await scrollTo(1250);
  await hold(2600);
  await page.locator('a.post-link[href="/posts/mirastory1"]').click();
  await expect(
    page.getByRole("heading", {
      name: "A notebook, a long walk, and no plans",
    }),
  ).toBeVisible();
  await imagesReady();
  explain(
    "Read a blog post",
    "Open an article to read the full text on its own page.",
  );
  await hold(2600);
  await scrollTo(620);
  await hold(2600);
  await page.getByRole("link", { name: "Compose", exact: true }).click();
  await expect(page.getByLabel("Caption", { exact: true })).toBeFocused();
  explain(
    "Write a post",
    "Type a caption, add photos, and see a preview as you write.",
  );
  await hold(800);
  await compose(page, site.art, 42);
  await hold(1200);
  await scrollTo(900);
  await hold(2400);
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/posts\//);
  await imagesReady();
  explain("Publish and share", "The published post has a URL you can share.");
  await hold(3000);
  await page.goto(baseURL);
  await imagesReady();
  explain(
    "See the new post",
    "New posts appear at the top of your website’s feed.",
  );
  await hold(1200);
  await scrollTo(560);
  await hold(2600);
  explain(
    "Light or dark",
    "Readers can switch themes, or follow their system’s setting.",
  );
  await hold(800);
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  // Off the button, so its tooltip goes.
  await page.mouse.move(0, 360);
  await hold(1800);
  await scrollTo(1200);
  await hold(2800);
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
  // The poster is the first frame with its caption below, as the video starts.
  const poster = join(temporary, "poster-captioned.png");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      join(temporary, "poster.png"),
      "-i",
      captionFiles[0]!,
      "-filter_complex",
      "vstack",
      poster,
    ],
    { stdio: "ignore" },
  );
  await new Bun.Image(await Bun.file(poster).bytes())
    .webp({ quality: 88 })
    .write(join(root, "public/demo-poster.webp"));
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
  await site.close();
}
