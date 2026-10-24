import { Document } from "./layout.tsx";
import { Wordmark } from "./wordmark.tsx";

const github = "https://github.com/aakashns/logspace";
const url = "https://logspace.app/";
const title = "LogSpace — Self-host your personal website";
const description =
  "Publish blog posts, photos, and videos on your own domain.";
const install = `curl -fsSL ${url}install.sh | sh`;

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
          You’ll need{" "}
          <a href="https://caddyserver.com/docs/install" target="_blank">
            Caddy
          </a>{" "}
          and a domain pointing to the server.{" "}
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
            height="816"
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
              <strong>Single binary.</strong> Runs as one program and keeps your
              posts in a SQLite database, and your photos and videos on the
              server’s disk.
            </li>
          </ul>
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
