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
setSystemTime(new Date("2026-10-24T10:05:00-07:00"));
const image = (name: string) => Bun.file(join(art, `${name}.png`));

// Oldest first, as they were published.
const posts = [
  {
    id: "miranote01",
    type: "text",
    date: "2026-10-14T09:00:00-07:00",
    city: "Portland",
    caption:
      "A small rule for this week: make something before scrolling through anything.\n\nToday that was a very wonky drawing of my coffee cup. It counts.",
  },
  {
    id: "mirastory1",
    type: "article",
    date: "2026-10-18T11:20:00-07:00",
    caption: "A few notes from a Sunday with nowhere to be.",
    article: {
      title: "A notebook, a long walk, and no plans",
      summary:
        "On leaving a little room in the day for things you didn’t plan to notice.",
      cover: {
        file: "desk.png",
        alt: "An open sketchbook, a pencil, and a cup of coffee on a wooden desk.",
      },
      body: "I left my phone at home and brought a notebook instead. No route, no list, no podcast. Just the neighborhood and whatever it felt like showing me.\n\n## The long way around\n\nThere was a new plant in the bookshop window, a dog asleep in a patch of sun, and a maple on the corner that had decided to turn gold overnight. I must have walked past that tree a hundred times without really looking at it.\n\nI stopped at the café by the river and drew three bad sketches of it anyway. Then I wrote down one good sentence. That felt like enough.\n\n> Most days don’t need a plan. They need a little room.\n\n## A little room\n\nI used to think a good weekend needed a highlight reel: somewhere to go, something to show for it. Lately I’m less sure. The days I remember best are the ones with a gap in them, where something small had space to happen.\n\nSo here’s my plan for next Sunday: no plans. I’ll bring the notebook.",
    },
  },
  {
    id: "miracoast1",
    type: "photos",
    date: "2026-10-21T18:40:00-07:00",
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
    date: "2026-10-23T21:15:00-07:00",
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
      const files =
        post.photos?.map((photo) => photo.file) ??
        (post.article ? [post.article.cover.file] : []);
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
