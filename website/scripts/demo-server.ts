// Runs only from demo-site.ts, which supplies a new temporary database and media directory, and
// the illustrations drawn as PNGs (LOGSPACE_DEMO_ART).
import { setSystemTime } from "bun:test";
import { join } from "node:path";
import {
  Effect,
  Layer,
} from "../../platform/node_modules/effect/dist/index.js";
import { AppLive } from "../../platform/src/app.ts";
import { PostCommands } from "../../platform/src/commands/posts.ts";
import { SiteConfigCommands } from "../../platform/src/commands/site-config.ts";
import { AppConfig } from "../../platform/src/config.ts";

const art = process.env.LOGSPACE_DEMO_ART;
if (
  !art ||
  !process.env.LOGSPACE_DEMO ||
  !process.env.DATABASE_PATH?.includes("logspace-demo-")
) {
  throw new Error(
    "Start this through bun run demo; it requires isolated temporary storage.",
  );
}
// The morning after the latest post, in Portland, whenever the demo is made: it's when the
// composer's post is dated.
setSystemTime(new Date("2026-10-24T17:05:00Z"));
const image = (name: string) => Bun.file(join(art, `${name}.png`));

// Oldest first, as they were published.
const posts = [
  {
    id: "miranote01",
    type: "text",
    date: "2026-10-14T16:00:00Z",
    city: "Portland",
    caption:
      "A small rule for this week: make something before scrolling through anything.\n\nToday that was a very wonky drawing of my coffee cup. It counts.",
  },
  {
    id: "mirastory1",
    type: "photos",
    date: "2026-10-18T18:20:00Z",
    caption:
      "Left my phone at home and brought a notebook instead. **No route, no list, no podcast.**\n\nDrew three bad sketches of the maple by the river, then wrote down *one* good sentence. That felt like enough.",
    photos: [
      {
        file: "desk.png",
        alt: "An open sketchbook, a pencil, and a cup of coffee on a wooden desk.",
      },
    ],
  },
  {
    id: "miracoast1",
    type: "photos",
    date: "2026-10-22T01:40:00Z",
    city: "Cannon Beach",
    caption:
      "A weekend at the coast. Wind, salt, and a lighthouse that looked exactly like the ones I drew as a kid.",
    photos: [
      {
        file: "cliffs.png",
        alt: "An illustration of the sun setting over the sea between two cliffs.",
      },
      {
        file: "lighthouse.png",
        alt: "An illustration of a red and white lighthouse on a rocky island.",
      },
      {
        file: "sailboat.png",
        alt: "An illustration of a sailboat on a calm sea at dusk.",
      },
    ],
  },
  {
    id: "miranote02",
    type: "text",
    date: "2026-10-24T04:15:00Z",
    city: "Portland",
    caption:
      "Finished the sketchbook I started in June. Every page, even the wonky ones.\n\nStarting a new one tomorrow ✏️",
  },
];

await Effect.runPromise(
  Effect.gen(function* () {
    yield* (yield* SiteConfigCommands).update(
      {
        siteTitle: "Mira Ellis",
        siteUrl: "https://miraellis.com",
        siteDescription:
          "Field notes, small adventures, and things worth keeping.",
        heroHeading: "Hi, I’m Mira.",
        heroSubheading:
          "I draw, take the long way home, and collect little moments. This is where I keep them.",
        bannerImageAlt:
          "An illustration of layered hills at dawn in soft pinks and purples.",
      },
      { bannerImage: image("banner") },
      [],
    );
    const commands = yield* PostCommands;
    for (const post of posts) {
      const files = post.photos?.map((photo) => photo.file) ?? [];
      const uploads = files.map((name) => ({
        name,
        file: image(name.replace(/\.png$/, "")),
      }));
      yield* commands.publish({ post, uploads, issues: [] });
    }
  }).pipe(Effect.provide(AppLive.pipe(Layer.provide(AppConfig.layer)))),
);

process.argv = [process.argv[0]!, process.argv[1]!, "start"];
await import("../../platform/src/main.ts");
