const github = "https://github.com/aakashns/logspace";

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
        <title data-rmx-key="title">
          LogSpace — Self-host your personal website
        </title>
        <meta
          name="description"
          content="Self-host your personal website with blog posts, photos, and videos. Write and publish from your browser."
          data-rmx-key="description"
        />
        <link
          rel="canonical"
          href="https://logspace.app/"
          data-rmx-key="canonical"
        />
        <meta name="theme-color" content="#111113" data-rmx-key="theme" />
        <meta property="og:type" content="website" data-rmx-key="og-type" />
        <meta
          property="og:title"
          content="LogSpace — Self-host your personal website"
          data-rmx-key="og-title"
        />
        <meta
          property="og:description"
          content="Self-host your personal website with blog posts, photos, and videos."
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
          content="LogSpace. Self-host your personal website with blog posts, photos, and videos."
          data-rmx-key="og-alt"
        />
        <meta
          name="twitter:card"
          content="summary_large_image"
          data-rmx-key="twitter"
        />
        <link
          rel="icon"
          href="/icon.svg"
          type="image/svg+xml"
          data-rmx-key="icon"
        />
        <link rel="stylesheet" href="/style.css" data-rmx-key="style" />
        <script src="/site.js" defer data-rmx-key="script" />
      </head>
      <body>
        <a class="skip-link" href="#main">
          Skip to content
        </a>
        <header class="site-header">
          <a class="brand" href="/" aria-label="LogSpace home">
            <img src="/icon.svg" width="25" height="25" alt="" />
            LogSpace
          </a>
          <nav aria-label="Main navigation">
            <a href={`${github}#deploy`}>Docs</a>
            <a href={`${github}/releases`}>Changelog</a>
            <a href={github}>
              GitHub <span aria-hidden="true">↗</span>
            </a>
          </nav>
        </header>
        <main id="main">
          <section class="hero" aria-labelledby="headline">
            <h1 id="headline">
              Self-host your personal website with blog posts, photos, and
              videos
            </h1>
            <p class="lede">
              Write and publish from your browser. Run it on your own server and
              domain.
            </p>
            <p class="hero-links">
              <a class="primary-link" href="#install">
                Install LogSpace <span aria-hidden="true">↓</span>
              </a>
              <span>Free &amp; open source</span>
            </p>
          </section>
          <figure class="demo">
            <div class="demo-bar">
              <span class="window-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>Example website</span>
              <span class="demo-tag">DEMO</span>
            </div>
            <video
              controls
              playsInline
              preload="none"
              poster="/demo-poster.webp"
              width="1280"
              height="900"
              aria-label="LogSpace demo: explore Mira’s site and publish a new post"
              aria-describedby="demo-caption"
            >
              <source src="/demo.mp4" type="video/mp4" />
              <track
                kind="captions"
                src="/demo.vtt"
                srcLang="en"
                label="English"
                default
              />
              <a href="/demo.mp4">Watch the LogSpace demo</a>
            </video>
            <figcaption id="demo-caption">
              Demo: browse posts and publish a new one. The profile and posts
              are fictional.
            </figcaption>
          </figure>
          <section class="about" aria-label="Features">
            <p>
              <strong>Posts, photos, and videos.</strong> Publish short updates
              or longer blog posts, upload media, and display them in a single
              feed.
            </p>
            <p>
              <strong>Browser-based editing.</strong> Write in Markdown, edit
              published posts, and change your site’s title, description, and
              images.
            </p>
            <p>
              <strong>RSS and shareable links.</strong> Every post has its own
              URL. Readers can subscribe with an RSS reader without an account.
            </p>
          </section>
          <section
            class="install"
            id="install"
            aria-labelledby="install-heading"
          >
            <h2 id="install-heading">Install LogSpace</h2>
            <p>On your Linux server, install LogSpace:</p>
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
              Point your domain to the server and install Caddy, then run{" "}
              <code>sudo logspace setup yourdomain.com</code>. Open{" "}
              <code>/admin</code> to configure your site and publish posts.
            </p>
            <a class="guide-link" href={`${github}#deploy`}>
              Read the deployment guide <span aria-hidden="true">↗</span>
            </a>
            <p class="fine-print">
              Update with <code>sudo logspace upgrade</code>.
            </p>
          </section>
        </main>
        <footer>
          <span>LogSpace is free and open source.</span>
          <span>
            <a href={github}>Source</a>
            <span aria-hidden="true"> · </span>
            <a href={`${github}/blob/main/LICENSE`}>MIT license</a>
          </span>
        </footer>
      </body>
    </html>
  );
}
