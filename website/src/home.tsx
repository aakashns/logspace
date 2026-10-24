import { Document } from "./layout.tsx";
import { Wordmark } from "./wordmark.tsx";

const github = "https://github.com/aakashns/logspace";
const url = "https://logspace.app/";
const title = "LogSpace — Self-host your personal website";
const description =
  "Publish blog posts, photos, and videos on your own domain.";
const install = `curl -fsSL ${url}install.sh | sh`;

// Made by `bun run screenshots` from Mira's fictional site, as <name>-dark.webp and
// <name>-light.webp.
const screenshots = [
  {
    name: "home",
    alt: "The home page of Mira’s site: a banner, an introduction, and a feed of posts.",
    caption: "Your home page, with every post in one feed.",
  },
  {
    name: "article",
    alt: "An article on Mira’s site, with its title, summary, cover image, and text.",
    caption: "Articles get a page of their own.",
  },
  {
    name: "composer",
    alt: "The composer, with a caption, a photo, and a city filled in, ready to post.",
    caption: "Write a post, add photos, and preview it before posting.",
  },
];

// LogSpace's own theme icons, as its navbar draws them.
const stroke = { fill: "none", stroke: "currentColor", "stroke-width": "1.5" };

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" {...stroke} />
      <path
        d="M12 2.5V4.5M12 19.5V21.5M2.5 12H4.5M19.5 12H21.5M5.3 5.3L6.7 6.7M17.3 17.3L18.7 18.7M5.3 18.7L6.7 17.3M17.3 6.7L18.7 5.3"
        {...stroke}
        stroke-linecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"
        {...stroke}
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function Home() {
  return (
    <Document
      title={title}
      head={
        <>
          <meta name="description" content={description} />
          <link rel="canonical" href={url} />
          <meta property="og:type" content="website" />
          <meta property="og:title" content={title} />
          <meta property="og:description" content={description} />
          <meta property="og:url" content={url} />
          <meta property="og:image" content={`${url}social.png`} />
          <meta
            property="og:image:alt"
            content="LogSpace: Self-host your personal website"
          />
          <meta name="twitter:card" content="summary_large_image" />
          <script src="/site.js" defer></script>
        </>
      }
    >
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <header class="site">
        <a class="name" href="/" aria-label="LogSpace home">
          <Wordmark />
        </a>
        <nav aria-label="Main navigation">
          <a href={`${github}#deploy`} target="_blank">
            Docs
          </a>
          <a href={`${github}/releases`} target="_blank">
            Changelog
          </a>
        </nav>
      </header>
      <main id="main">
        <h1>
          Self-host your <br class="mobile" />
          personal website
        </h1>
        <p class="lede">
          Publish blog posts, photos, <br class="mobile" />
          and videos on your own domain.
        </p>

        <p>Run this on a Linux server to install LogSpace:</p>
        <div class="command">
          <pre>
            <code id="install-command">{install}</code>
          </pre>
          <button
            type="button"
            id="copy"
            hidden
            aria-label="Copy install command"
          >
            Copy
          </button>
        </div>
        <p id="copy-status" class="sr-only" role="status"></p>
        <p class="note">
          <span class="desktop">
            You’ll need{" "}
            <a href="https://caddyserver.com/docs/install" target="_blank">
              Caddy
            </a>{" "}
            and a domain pointing to the server.{" "}
          </span>
          <a href={`${github}#deploy`} target="_blank">
            Read the deployment guide
          </a>
          .
        </p>

        <figure class="demo">
          <video
            controls
            playsinline
            preload="none"
            poster="/demo-poster.webp"
            width="720"
            height="680"
            aria-label="LogSpace demo: explore Mira’s site and publish a new post"
            aria-describedby="demo-caption"
          >
            <source src="/demo.mp4" type="video/mp4" />
            <track
              kind="captions"
              src="/demo.vtt"
              srclang="en"
              label="English"
            />
            <a href="/demo.mp4" target="_blank">
              Watch the LogSpace demo
            </a>
          </video>
          <figcaption id="demo-caption">
            A consolidated feed, clean &amp; minimal pages,{" "}
            <br class="mobile" />
            and a simple publishing flow.
          </figcaption>
        </figure>

        <section aria-labelledby="features">
          <h2 id="features">Features</h2>
          <ul>
            <li>
              <strong>Posts, photos, and videos.</strong> Share short updates or
              long articles, and upload media. They all appear in one feed.
            </li>
            <li>
              <strong>Write in your browser.</strong> Use Markdown, edit
              published posts, and change your site’s title, description, and
              images.
            </li>
            <li>
              <strong>Links and RSS.</strong> Every post has its own URL.
              Readers can follow along in an RSS reader, no account needed.
            </li>
            <li>
              <strong>Optimized for SEO.</strong> Pages come with a sitemap,
              canonical URLs, structured data, and rich previews when shared.
            </li>
            <li>
              <strong>Single binary.</strong> Runs as one program and keeps your
              posts in a SQLite database, and your photos and videos on the
              server’s disk.
            </li>
          </ul>
        </section>

        {/* Dark until the switch (shown by site.js) picks light. */}
        <section
          aria-labelledby="screenshots"
          class="screenshots"
          data-theme="dark"
        >
          <div class="section-heading">
            <h2 id="screenshots">Screenshots</h2>
            <div
              class="theme-switch"
              role="group"
              aria-label="Screenshot theme"
              hidden
            >
              <button
                type="button"
                value="light"
                aria-pressed="false"
                aria-label="Light"
              >
                <SunIcon />
              </button>
              <button
                type="button"
                value="dark"
                aria-pressed="true"
                aria-label="Dark"
              >
                <MoonIcon />
              </button>
            </div>
          </div>
          {screenshots.map((shot) => (
            <figure class="screenshot">
              <figcaption>{shot.caption}</figcaption>
              {(["dark", "light"] as const).map((theme) => (
                <img
                  class={theme}
                  src={`/screenshots/${shot.name}-${theme}.webp`}
                  alt={shot.alt}
                  width="720"
                  height="720"
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </figure>
          ))}
        </section>
      </main>
      <footer class="site">
        <span>
          Free and{" "}
          <a href={github} target="_blank">
            open source
          </a>
          <span aria-hidden="true"> · </span>
          Built by{" "}
          <a href="https://aakashns.com" target="_blank">
            aakashns
          </a>
        </span>
      </footer>
    </Document>
  );
}
