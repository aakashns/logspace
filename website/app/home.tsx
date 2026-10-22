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
          LogSpace — A little space of your own.
        </title>
        <meta
          name="description"
          content="A personal website for your words, photos, and videos. Publish from your browser. Your domain, your content, your little corner of the internet."
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
          content="LogSpace — A little space of your own."
          data-rmx-key="og-title"
        />
        <meta
          property="og:description"
          content="Words, photos, videos, and the days in between. A personal website on your own terms."
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
          content="LogSpace. A little space of your own. A personal website for your words, photos, and videos."
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
            <p class="eyebrow">
              <span aria-hidden="true" /> YOUR OWN CORNER OF THE INTERNET
            </p>
            <h1 id="headline">
              A little space
              <br />
              of your own.
            </h1>
            <p class="lede">
              Words, photos, videos, and the days in between.
              <br class="desktop-break" /> A personal website, on your own
              terms.
            </p>
            <p class="hero-links">
              <a class="primary-link" href="#install">
                Make yourself at home <span aria-hidden="true">↓</span>
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
              <span>mira’s little corner</span>
              <span class="demo-tag">A LOOK INSIDE</span>
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
              A small tour: browse, write, publish. Mira and her posts are
              fictional.
            </figcaption>
          </figure>
          <section class="about" aria-label="Why LogSpace">
            <p>
              <strong>Post whatever feels like you.</strong> A passing thought,
              a photo from a walk, a short video, or a longer story. All
              together in one simple feed.
            </p>
            <p>
              <strong>Write in your browser.</strong> Sign in, add a post, and
              publish. Give your site a name, a welcome message, and a look that
              feels like home.
            </p>
            <p>
              <strong>Keep it yours.</strong> Your domain. Your server. Your
              content. Readers can visit or follow by RSS, without signing up
              for anything.
            </p>
          </section>
          <section
            class="install"
            id="install"
            aria-labelledby="install-heading"
          >
            <p class="eyebrow">SETTLE IN</p>
            <h2 id="install-heading">Your space starts here.</h2>
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
              <code>/admin</code> to make it yours.
            </p>
            <a class="guide-link" href={`${github}#deploy`}>
              Read the deployment guide <span aria-hidden="true">↗</span>
            </a>
            <p class="fine-print">
              A Linux server and a domain are all you need to bring.
              <br />
              Already at home? Update with <code>sudo logspace upgrade</code>.
            </p>
          </section>
        </main>
        <footer>
          <span>A little more of the web, owned by you.</span>
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
