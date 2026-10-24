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

// The heights of the title bar, the app below it, and the captions below that.
const BAR = 44;
const APP = 540;
const CAPTION = 96;

const site = await startDemoSite();
const { browser, temporary } = site;
try {
  const context = await browser.newContext({
    // A narrow viewport keeps the app’s content close to the edges of the recording.
    viewport: { width: 720, height: APP },
    colorScheme: "light",
    timezoneId: "America/Los_Angeles",
    recordVideo: { dir: temporary, size: { width: 720, height: APP } },
  });
  // Authenticate before the recording starts; only the fictional publishing flow is shown.
  await context.request.post(`${baseURL}/admin/login`, { form: { password } });
  const started = Date.now();
  const page = await context.newPage();
  const video = page.video()!;
  const seconds = () => (Date.now() - started) / 1000;
  // The address bar's URL from each navigation on, as on Mira's own domain.
  const addresses: { start: number; url: string }[] = [];
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const { pathname } = new URL(frame.url());
    const url = `miraellis.com${pathname === "/" ? "" : pathname}`;
    if (addresses.at(-1)?.url === url) return;
    addresses.push({ start: addresses.length ? seconds() : 0, url });
  });
  const cues: { start: number; title: string; text: string }[] = [];
  function explain(title: string, text: string) {
    cues.push({
      start: cues.length ? seconds() : 0,
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
  explain("Browse the feed", "Text posts, photos, and videos appear together.");
  await page.screenshot({ path: join(temporary, "poster.png") });
  await hold(3000);
  await scrollTo(560);
  await hold(2400);
  await scrollTo(1250);
  await hold(2600);
  await page.locator('a.post-link[href="/posts/mirastory1"]').click();
  await expect(page.getByText("No route, no list, no podcast.")).toBeVisible();
  await imagesReady();
  explain(
    "Open a post",
    "Every post has a page of its own, with a link to share.",
  );
  await hold(2600);
  await scrollTo(620);
  await hold(2600);
  await page.getByRole("link", { name: "New Post", exact: true }).click();
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
  const finished = seconds();
  await context.close();

  // Burn the captions into a separate band, so they do not cover the app and
  // remain visible when the video is shared without its WebVTT track. Above the
  // app, a browser's title bar shows where it is.
  const bands = await browser.newPage();
  // A band of the video as a PNG, with `texts` put in by selector as text, so
  // they're never read as HTML.
  async function band(
    name: string,
    height: number,
    html: string,
    texts: Record<string, string>,
  ) {
    await bands.setViewportSize({ width: 720, height });
    await bands.setContent(
      `<html><body style="margin:0;height:${height}px">${html}</body></html>`,
    );
    for (const [selector, text] of Object.entries(texts)) {
      await bands.locator(selector).evaluate((element, text) => {
        element.textContent = text;
      }, text);
    }
    const file = join(temporary, `${name}.png`);
    await bands.screenshot({ path: file });
    return file;
  }
  const captionFiles: string[] = [];
  for (const [index, cue] of cues.entries()) {
    captionFiles.push(
      await band(
        `caption-${index}`,
        CAPTION,
        `<div style="height:100%;background:#161616;color:#dedede;font-family:Arial,sans-serif;display:flex;align-items:center;gap:18px;padding:18px 28px;box-sizing:border-box">
          <span style="color:#a1a1a1;font-size:16px;white-space:nowrap">${index + 1} / ${cues.length}</span>
          <div><div id="title" style="font-size:21px;font-weight:600;margin-bottom:6px"></div><div id="text" style="font-size:17px;color:#b0b0b0"></div></div>
        </div>`,
        { "#title": cue.title, "#text": cue.text },
      ),
    );
  }
  const light = (color: string) =>
    `<span style="width:12px;height:12px;border-radius:50%;background:${color}"></span>`;
  const addressFiles: string[] = [];
  for (const [index, address] of addresses.entries()) {
    addressFiles.push(
      await band(
        `address-${index}`,
        BAR,
        `<div style="height:100%;background:#ececec;border-bottom:1px solid #d4d4d4;box-sizing:border-box;display:flex;align-items:center;position:relative;font-family:system-ui,sans-serif">
          <div style="display:flex;gap:8px;padding-left:16px">${light("#ff5f57")}${light("#febc2e")}${light("#28c840")}</div>
          <div id="url" style="position:absolute;left:50%;transform:translateX(-50%);width:340px;height:26px;border-radius:6px;background:#dcdcdc;color:#4a4a4a;font-size:13px;display:flex;align-items:center;justify-content:center"></div>
        </div>`,
        { "#url": address.url },
      ),
    );
  }
  await bands.close();
  // Each band from its start until the next one's, at its place in the frame.
  const timed = (items: { start: number }[], files: string[], y: number) =>
    items.map((item, index) => ({
      file: files[index]!,
      y,
      start: item.start,
      end: items[index + 1]?.start,
    }));
  const overlays = [
    ...timed(addresses, addressFiles, 0),
    ...timed(cues, captionFiles, BAR + APP),
  ];
  const filters = [
    `[0:v]pad=720:${BAR + APP + CAPTION}:0:${BAR}:color=0x161616[v0]`,
  ];
  for (const [index, overlay] of overlays.entries()) {
    const enabled =
      overlay.end === undefined
        ? `gte(t,${overlay.start})`
        : `between(t,${overlay.start},${overlay.end})`;
    filters.push(
      `[v${index}][${index + 1}:v]overlay=0:${overlay.y}:enable='${enabled}'[v${index + 1}]`,
    );
  }
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      await video.path(),
      ...overlays.flatMap((overlay) => ["-i", overlay.file]),
      "-filter_complex",
      filters.join(";"),
      "-map",
      `[v${overlays.length}]`,
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
  // The poster is the first frame with its bands, as the video starts.
  const poster = join(temporary, "poster-captioned.png");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      addressFiles[0]!,
      "-i",
      join(temporary, "poster.png"),
      "-i",
      captionFiles[0]!,
      "-filter_complex",
      "vstack=inputs=3",
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
