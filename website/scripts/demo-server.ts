// Runs only from record-demo.ts, which supplies a new temporary database and media directory.
import { readFile } from "node:fs/promises";
import {
  Effect,
  Layer,
} from "../../platform/node_modules/effect/dist/index.js";
import sharp from "../../platform/node_modules/sharp";
import { AppServices } from "../../platform/src/app.ts";
import { PostCommands } from "../../platform/src/commands/posts.ts";
import { SiteConfigCommands } from "../../platform/src/commands/site-config.ts";
import { AppConfig } from "../../platform/src/config.ts";

if (
  !process.env.LOGSPACE_DEMO ||
  !process.env.DATABASE_PATH?.includes("logspace-demo-")
) {
  throw new Error(
    "Start this through bun run demo; it requires isolated temporary storage.",
  );
}

const art = await sharp(
  await readFile(new URL("./demo-art.svg", import.meta.url)),
)
  .png()
  .toBuffer();
const posts = [
  {
    id: "mirawalk01",
    type: "photos",
    date: "2026-10-20T17:40:00-07:00",
    city: "Portland",
    caption:
      "Took the long way home. Found a view worth keeping.\n\nA little landscape study from my sketchbook.",
    photos: [
      {
        file: "long-way-home.png",
        alt: "An original illustration of green mountains, a winding lake, and a pale autumn sun.",
      },
    ],
  },
  {
    id: "miranote01",
    type: "text",
    date: "2026-10-19T09:00:00-07:00",
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
      body: "I left my phone at home and brought a notebook instead.\n\n## The long way around\n\nThere was a new plant in the bookshop window, a dog asleep in a patch of sun, and a tree that had decided to turn gold overnight.\n\nI drew three bad sketches and wrote down one good sentence. That felt like enough.\n\n## A little room\n\nMaybe a good day doesn’t need a highlight reel. Maybe it just needs a little room to happen.",
    },
  },
];

await Effect.runPromise(
  Effect.gen(function* () {
    yield* (yield* SiteConfigCommands).save({
      siteTitle: "Mira Ellis",
      siteUrl: "https://mira.example",
      siteDescription:
        "Field notes, small adventures, and things worth keeping.",
      heroHeading: "Hi, I’m Mira.",
      heroSubheading:
        "I draw, take the long way home, and collect little moments. This is where I keep them.",
      socialImageAlt: "",
    });
    let commands = yield* PostCommands;
    for (let post of posts) {
      let uploads =
        post.id === "mirawalk01"
          ? [{ name: "long-way-home.png", file: new Blob([art]) }]
          : [];
      yield* commands.publish({ post, uploads, issues: [] });
    }
  }).pipe(Effect.provide(AppServices.pipe(Layer.provide(AppConfig.layer)))),
);

process.argv = [process.argv[0], process.argv[1], "start"];
await import("../../platform/src/main.ts");
