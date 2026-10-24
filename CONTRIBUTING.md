# Contributing

Small, focused pull requests are welcome. Open an [issue](https://github.com/aakashns/logspace/issues) before a large change. Use [Bun](https://bun.com) 1.4.4 or later.

## Platform

```sh
cd platform
bun install
bun run dev:demo
```

That starts a throwaway site with the test posts and prints its address and admin password. Its
data is in a temporary folder, deleted when you stop it (Ctrl-C), and it needs no configuration.
The server restarts on changes; reload the browser.

To keep a site of your own between runs, create `platform/.env` (ignored by Git), using your own
secrets and absolute paths outside the checkout:

```dotenv
ADMIN_PASSWORD=your-long-random-password
AUTH_SESSION_SECRET=another-long-random-secret
DATABASE_PATH=/absolute/path/to/logspace-data/app.sqlite
MEDIA_DIR=/absolute/path/to/logspace-data/media
```

Both secrets need at least 16 characters; `openssl rand -base64 32` generates one. Run `bun run dev`, open [localhost:44100/admin](http://localhost:44100/admin), and configure your site. To add some posts, run `bun scripts/seed.ts`, which replaces the database's posts with the ones the tests use.

Before opening a pull request:

```sh
bun run ready          # typecheck, lint, format check, and tests, as CI runs them
bun run test:browser   # the composer in Chromium and WebKit; CI doesn't run these
bun run build && bun scripts/smoke-test.ts dist/logspace   # if the build changed
```

Tests use temporary data. [platform/AGENTS.md](platform/AGENTS.md) has the conventions, `platform/src/posts/post.ts` the post format, and [the tour below](#platform-code) how the app fits together.

## Pull requests

Explain the change, include the checks you ran (and the browser tests' result for app changes), and attach screenshots or recordings for UI changes. Keep evidence out of Git. If the change goes into the binary (`platform/src`, `db`, `public`, `package.json` apart from its version, dependencies, or the build), bump `platform/package.json` one version step: patch for compatible changes, minor for breaking changes before 1.0. Otherwise leave the version alone. CI checks this and publishes binaries when a bump merges to `main`.

## Platform code

The platform (the app, in `platform/`) is built with:

- **[Bun](https://bun.com)** for the runtime, HTTP server, SQLite, file I/O, and the single-file
  binary.
- **[Effect v4](https://effect.website)** for structure: services share resources and application
  APIs, stateless operations are Effect functions, every expected failure is a typed error, and
  the database is [`effect/sql`](https://effect.website/docs).
- **[Datastar](https://data-star.dev)** as the only JavaScript sent to browsers (13 KB gzipped),
  for the theme toggle, share buttons, and the admin composer.
- **A tiny JSX runtime** (`src/lib/jsx`, about 110 lines) that renders TSX straight to HTML strings: no
  virtual DOM, no hydration.
- **CQRS**: writes go through each feature's `commands.ts`, and reads through its `queries.ts`,
  which query the database on every request.

### A tour of the code

The app is in `platform/`, and paths here are from there. Read it in this order; each file starts with a comment that says what it's for.

#### 1. The shape: `src/server.ts`

The composition root wires each service to its dependencies with `Layer.provide`, then merges
them into `AppServices`. Reusing the same layer values shares the connection, storage, caches,
and write locks. `MigratedDatabase` runs migrations before exposing SQL; the migration command
uses the raw connection so it can do a dry run.

`AppServices` takes `AppConfig` and `PublicNetwork`, so tests can control both. `AppLive` supplies
the normal network implementation for servers and scripts. The routes are each feature's
(`PostRoutes`, `SiteRoutes`, `AdminRoutes`, `AssetRoutes`) and `AppMiddleware`. `provideMerge` is used only where the dependency must also
remain available to the caller.

`ServerLive` serves the routes on `AppConfig`'s port with Bun's HTTP listener; the CLI and the
browser tests use it. `src/entry.ts` is the binary's command line (`start` by default, and
`deploy`, `migrate`, `set-admin-password`, `upgrade`, `version`, `help`).

#### 2. The layout: a folder for each feature, each the same shape

```
src/
  entry.ts  server.ts  config.ts  routes.ts   the root: the CLI, the wiring, settings, and URLs
  components/     the page shell every page uses, and the CSS every page loads
  http/           what every route shares: pages, forms, responses, middleware, assets
  lib/            no product in it: the database, media storage, images, the network, JSX
  posts/          posts; pages/, feeds/, link-previews/, composer/, and manage/ inside
  site/           the site's settings and files; config/ is /admin/config
  admin/          logging in, sessions, and the layout of the pages under /admin
  cli/            the binary's commands other than start
```

A feature folder holds the same kinds of files, told apart by name:

| File           | Holds                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| the model      | What things are, pure (like `posts/post.ts`): no database, files, HTTP, or pages                          |
| `queries.ts`   | Reads                                                                                                     |
| `commands.ts`  | Writes, and the typed errors they fail with                                                               |
| `handlers.tsx` | The feature's routes, with its route table at the bottom. A feature's `handlers.ts` merges its children's |
| `components/`  | Its pages and parts of pages (TSX), with the CSS for them beside them                                     |
| `*.test.ts`    | Its tests, beside what they test                                                                          |

Code lives in the closest folder that holds everything that uses it, so a helper only the composer
uses is in `posts/composer/`, and one posts and the site both use is at the root. A folder's own
files are what other features use; its subfolders are its own. Lint (`.oxlintrc.json`) keeps the
kinds apart, by name wherever they are: the model imports none of the others, reads never import
writes, writes and `lib/` know nothing of requests or pages, components only render what they're
given, and public pages and routes never import the admin's.

`src/routes.ts` builds every URL the app links to.

#### 3. What everything shares: `lib/`, `http/`, and `components/`

Shared resources are Effect services (`Context.Service`) with a `layer` that builds them.
Database migrations are an Effect function, `runMigrations`, used by startup and the CLI.

| `lib/`                         | Does                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.ts`                  | The SQLite connection (`@effect/sql-sqlite-bun`, in WAL mode) and the migrations, which write the same journal LogSpace 0.1 (the Remix version) did, so its databases upgrade in place                        |
| `media-storage.ts`             | Uploaded files as plain files under `MEDIA_DIR` (`posts/<id>/<file>`, `variants/…`, `site/…`, `link-images/…`), written atomically with `Bun.write` and served straight from disk; or in memory for the tests |
| `images.ts`                    | Everything Bun.Image does: reading and resizing photos, and making the logos, icons, and banner image                                                                                                         |
| `public-http.ts`               | Fetching other sites, only at public addresses on standard ports                                                                                                                                              |
| `image-widths.ts`, `issues.ts` | The widths photos are resized to, and `{ field, message }` issues for forms                                                                                                                                   |

A handler reads the request, calls queries or one command, and picks a response.
`http/middleware.ts` wraps every request, in this order: the proxy's forwarded host, the
cross-origin form check, the gate that keeps an unconfigured site private, then the handler, with
404s, 500s, and security headers.

| `http/`        | Does                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `pages.ts`     | What a page needs from the request (`PageContext`), and its response with a per-response CSP nonce |
| `forms.ts`     | Reading a form within the upload limits (`UploadTooLarge` → the 413 page)                          |
| `responses.ts` | Files with ranges, ETags, and caching; redirects                                                   |
| `forwarded.ts` | The protocol and host behind Caddy (`TRUST_PROXY=1`)                                               |
| `assets.ts`    | Datastar, fonts, and the stylesheets, embedded in the binary                                       |

Components are plain functions from props to `Html`. `lib/jsx/jsx-runtime.ts` escapes every
string and attribute; the only way to write markup unescaped is `raw()`, which is used only for
HTML the app renders itself (captions, the stylesheet, JSON-LD). Start with
`components/document.tsx`, the `<html>` around every page. CSS is plain CSS beside the components
it styles; `components/stylesheet.ts` joins what `components/site.css` imports, minifies it, and
inlines it into each page. The pages under `/admin` add what `components/admin.css` imports.

**Datastar** runs the theme toggle (`data-on:click`) and share buttons (`data-on:click`,
`data-class`, `data-attr`, one `_shared` signal) in `components/controls.tsx`, and the composer
(below). Every expression is a one-line constant string. Values like the URL to share are passed
in `data-*` attributes and read with `el.dataset`, so nothing a user typed can end up in an
expression. Everything else works without JavaScript: navigation is links, forms are forms, and
the delete dialog uses `command`/`commandfor`.

#### 4. Posts: `posts/`

| File              | What it holds                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post.ts`         | What a post is (`PostRecord`, an Effect `Schema`), and the checks a post passes before it's saved, reported as `{ field, message }` issues for the form |
| `rows.ts`         | How a post maps to a row of the `posts` table                                                                                                           |
| `presentation.ts` | Posts as pages show them: media URLs, image sizes, `srcset`s, captions rendered to HTML, link previews, and page metadata                               |
| `caption.ts`      | Captions: paragraphs, line breaks, **bold**, _italic_, and URLs as links, and the first URL for its preview                                             |
| `format.ts`       | Dates and sizes                                                                                                                                         |
| `queries.ts`      | `PostQueries`: posts and their images' sizes, presented                                                                                                 |
| `commands.ts`     | `PostCommands` (below), and `PostRejected` (with the issues to show) and `PostNotFound`                                                                 |
| `files.ts`        | `makePostFiles`: stateless upload and removal helpers, also used by test seeding                                                                        |
| `media.ts`        | `PostMedia`: a post's files, and its resized photos, made on first request and stored. Concurrent requests for one share a single resize                |
| `components/`     | A post, as the feed, its page, and the composer's preview show it                                                                                       |

`PostCommands` has `save`, which publishes a post or saves an edit of one, `delete`, and the
composer's `upload`, which saves a post's files as they're chosen. Uploads are saved before the
post is checked, so a rejected form doesn't need its files chosen again, and a chosen file never
takes the name of one the post has, so nothing published changes until the post is saved.
Saving, or closing the composer (`discard`), removes the post's files it doesn't name. Storage and
database failures are defects (a 500, logged), as they're not something a user can fix.

Every read queries the database, and nothing is kept between requests, so an edit made in the
database directly (like with `sqlite3`) shows up on the next request.

- `pages/`: the home page, a post's page, and its files.
- `feeds/`: `sitemap.xml` and `rss.xml`.
- `link-previews/`: `LinkPreviews` fetches link previews in the background, never on a page's
  time, and saves each one's image as resized WebP copies, so cards load from the site itself, at
  the size they're shown.
- `composer/`: writing and editing posts, at `/admin/posts/new` and `/admin/posts/<id>/edit`.
  `compose.ts` reads its form into a post and its uploads. Its file inputs and remove buttons post
  the form for its media (`data-on:change`, with `data-indicator:_uploading`), and typing posts it
  for the preview (`data-on:input__throttle.100ms.trailing`); the server answers with HTML for
  those parts. It keeps nothing on the server until it's posted, which is a plain form submission.
- `manage/`: the list of posts at `/admin`.

#### 5. The site: `site/`

`site.ts` holds the site's settings and their checks, and `site-images.ts` the URLs pages link the
site's icon, logos, and banner image with. `SiteConfigQueries` (`queries.ts`) reads the settings,
and `configuredSite` fails for what's only served once they're saved. `files.ts` has stateless
Effect functions for the site's image files, whose dependencies are storage and `Images`, which
owns the cached default icons. `SiteConfigCommands` (`commands.ts`) saves `/admin/config`,
turning uploads into the site's image files, or fails with `SiteConfigRejected`. `handlers.ts`
serves `robots.txt`, the web app manifest, and the site's images; `config/` is `/admin/config`.

#### 6. Admin: `admin/`

`session.ts` is the admin password check and the signed session cookie (`AdminAuth`), and
`handlers.tsx` logging in and out. `pages.tsx` is what every page under `/admin` shares: its
layout and the login check, which the composer, `/admin`, and `/admin/config` use.

#### 7. Tests

The suites are the `*.test.ts` files beside the code. `test/app.ts` builds the app with an
in-memory database and storage and drives it through `fetch`-style requests. Services can also be
called directly with `app.run(effect)`. `test/content/` has the posts they start with.

#### Browser tests

`*.pw.ts` (like `src/posts/composer/composer.pw.ts`) drive the composer in Chromium and WebKit
with Playwright, which also needs Node.js 20 or newer: publishing each kind of post, with and
without JavaScript. Each test starts the app with its own temporary data and port
(`browser/fixtures.ts`). Install the browsers once with `bun run test:browser:install`, then run
`bun run test:browser`. CI doesn't run them.

### Security

- **CSP**: pages allow only scripts with that response's nonce (not even other scripts from the
  site's own origin), and require Trusted Types.
  Datastar runs in its [CSP mode](https://data-star.dev/reference/security) with the nonce, so
  there's no `unsafe-eval` or `unsafe-inline`. Other responses (files, feeds) run no scripts.
  Pages also send `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`, and
  `form-action 'self'`.
- **User content**: captions are rendered with HTML escaped, and the containers they go in
  carry `data-ignore`, so Datastar never evaluates attributes in it, even if escaping failed.
- **Admin**: one password, compared in constant time; a session cookie signed with HMAC-SHA256,
  `HttpOnly`, `SameSite=Lax`, `Secure` in production, sent only to `/admin`, and holding a
  fingerprint of the password, so changing it logs everyone out. SQLite records enforce a fixed
  30-day lifetime and logout revocation; changing the signing secret also invalidates cookies.
  At most 100 sessions are retained, with expired/old-credential rows removed on login. Login is
  checked before an upload's body is read, and the login form itself, which anyone can send, is
  read only up to 16 KB.
- **Forms from other sites** are refused (`Sec-Fetch-Site`, else `Origin` against the host), as
  Remix's `cop()` did. Behind Caddy, the host is taken from `X-Forwarded-Host`, which
  Caddy overwrites, before the `Forwarded` header, which it passes through from the browser.
- **Files**: storage keys are built only from checked ids and names, and the fs backend also
  refuses any path outside `MEDIA_DIR`. Uploads are typed by extension, never by what the browser
  claims, and SVG isn't accepted for posts. Site images are re-encoded as PNG or JPEG.
  Only the files a published post names are served, so the composer's uploads stay private until
  the post is saved. Link previews' images are fetched only over https,
  refused past 10 MB or 25 megapixels (checked from the header, before decoding), and served
  only as WebP that the app re-encoded. Link previews fetch only public addresses on standard
  ports, checking each redirect.

## Website

```sh
cd website
bun install
bun run dev     # builds and serves logspace.app locally, rebuilding on change
bun run check   # typecheck and format check
bun run test    # Playwright
```
