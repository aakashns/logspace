import { Wordmark } from "./wordmark.tsx";

const github = "https://github.com/aakashns/logspace";
const title = "LogSpace — Self-host your personal website";
const description =
  "Publish blog posts, photos, and videos on your own domain.";

export function HomePage() {
  return () => (
    <html lang="en">
      <head>
        <meta charset="utf-8" data-rmx-key="charset" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
          data-rmx-key="viewport"
        />
        <title data-rmx-key="title">{title}</title>
        <meta
          name="description"
          content={description}
          data-rmx-key="description"
        />
        <link
          rel="canonical"
          href="https://logspace.app/"
          data-rmx-key="canonical"
        />
        <meta name="theme-color" content="#161616" data-rmx-key="theme" />
        <meta property="og:type" content="website" data-rmx-key="og-type" />
        <meta property="og:title" content={title} data-rmx-key="og-title" />
        <meta
          property="og:description"
          content={description}
          data-rmx-key="og-description"
        />
        <meta
          property="og:url"
          content="https://logspace.app/"
          data-rmx-key="og-url"
        />
        <meta
          property="og:image"
          content="https://logspace.app/social.png"
          data-rmx-key="og-image"
        />
        <meta
          property="og:image:alt"
          content="LogSpace: Self-host your personal website"
          data-rmx-key="og-alt"
        />
        <meta
          name="twitter:card"
          content="summary_large_image"
          data-rmx-key="twitter"
        />
        <link
          rel="icon"
          href="/favicon.ico"
          sizes="32x32"
          data-rmx-key="icon-ico"
        />
        <link
          rel="icon"
          href="/icon.svg"
          type="image/svg+xml"
          data-rmx-key="icon"
        />
        <link
          rel="apple-touch-icon"
          href="/apple-touch-icon.png"
          data-rmx-key="apple-touch-icon"
        />
        <link
          rel="preload"
          href="/fonts/instrument-sans-latin-600.woff2"
          as="font"
          type="font/woff2"
          crossorigin="anonymous"
          data-rmx-key="font"
        />
        <link rel="stylesheet" href="/style.css" data-rmx-key="style" />
        <script src="/site.js" defer data-rmx-key="script" />
      </head>
      <body>
        <a class="skip-link" href="#main">
          Skip to content
        </a>
        <header class="site">
          <a class="name" href="/" aria-label="LogSpace home">
            <Wordmark />
          </a>
          <nav aria-label="Main navigation">
            <a href={`${github}#deploy`}>Docs</a>
            <a href={`${github}/releases`}>Changelog</a>
            <a href={github}>GitHub</a>
          </nav>
        </header>
        <main id="main">
          <h1>Self-host your personal website</h1>
          <p class="lede">{description}</p>

          <p>Run this command on a Linux server to install LogSpace:</p>
          <div class="command">
            <pre>
              <code id="install-command">
                curl -fsSL https://logspace.app/install.sh | sh
              </code>
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
          <p id="copy-status" class="sr-only" role="status" />
          <p class="note">
            You’ll need Caddy and a domain pointing to the server.{" "}
            <a href={`${github}#deploy`}>Read the deployment guide</a>.
          </p>

          <figure class="demo">
            <video
              controls
              playsInline
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
                srcLang="en"
                label="English"
              />
              <a href="/demo.mp4">Watch the LogSpace demo</a>
            </video>
            <figcaption id="demo-caption">
              A consolidated feed, clean & minimal pages, and a simple
              publishing flow.
            </figcaption>
          </figure>

          <section aria-labelledby="features">
            <h2 id="features">Features</h2>
            <ul>
              <li>
                <strong>Posts, photos, and videos.</strong> Share short updates
                or long articles, and upload media. They all appear in one feed.
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
                <strong>Single binary.</strong> LogSpace runs as one program and
                keeps your posts in a SQLite database. Store media on the
                server’s disk or in any S3-compatible storage, like Cloudflare
                R2 or MinIO.
              </li>
            </ul>
          </section>
        </main>
        <footer class="site">
          <span>
            Free and <a href={github}>open source</a>
            <span aria-hidden="true"> · </span>
            <a href={`${github}/blob/main/LICENSE`}>MIT License</a>
          </span>
          <span>
            Built by <a href="https://aakashns.com">aakashns</a>
          </span>
        </footer>
      </body>
    </html>
  );
}
