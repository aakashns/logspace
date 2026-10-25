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
The server restarts on changes; reload the browser. Its email is set up to send to the site's own
fake of Amazon SES, and shows at `/dev/emails`.

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

Tests use temporary data. [platform/AGENTS.md](platform/AGENTS.md) has the conventions, `platform/src/data/posts/post.ts` the post format, and [the tour below](#platform-code) how the app fits together.

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
- **CQRS**: writes go through `commands.ts`, and reads through `queries.ts`, in `src/data/`, which
  query the database on every request.

### A tour of the code

The app is in `platform/`, and paths here are from there. Read it in this order; each file starts with a comment that says what it's for.

#### 1. The shape: `src/server.ts`

The composition root wires each service to its dependencies with `Layer.provide`, then merges
them into `AppServices`. Reusing the same layer values shares the connection, storage, caches,
and write locks. `MigratedDatabase` runs migrations before exposing SQL; the migration command
uses the raw connection so it can do a dry run.

`AppServices` takes `AppConfig` and `PublicNetwork`, so tests can control both. `AppLive` supplies
the normal network implementation for servers and scripts. `AppRoutes` merges every route's
table (`IndexRoutes`, `PostRoutes`, …) with `AppMiddleware`. `provideMerge` is used only where the dependency must also
remain available to the caller.

`ServerLive` serves the routes on `AppConfig`'s port with Bun's HTTP listener; the CLI and the
browser tests use it. `src/cli/index.ts` is the binary's command line (`start` by default, and
`deploy`, `migrate`, `set-admin-password`, `turnstile`, `upgrade`, `version`, `help`).

#### 2. The layout: routes, data, components, and lib

```
src/
  server.ts             the wiring
  routes/               a folder for each URL; the tree mirrors the site
  data/                 a folder for each thing the app stores
  components/           what several routes' pages share, and the CSS every page inlines
  lib/                  what everything shares: config, URLs, the database, storage, images, HTTP
  cli/                  the binary's command line, and its commands
```

Two questions find any code: which URL is it, and what does it store? Routes use data and
components; data never uses routes or components; and pages only render what they're given. Lint
(`.oxlintrc.json`) holds each part of `src/` to that. Code used by one route lives in that route's
folder.

`lib/urls.ts` builds every URL the app links to.

#### 3. Routes: `routes/`

| Folder                | URLs                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| `index/`              | `/`, the home page                                                           |
| `post/`               | `/posts/<id>`, and its files at `/posts/<id>/<file>`                         |
| `feeds/`              | `/sitemap.xml`, `/robots.txt`, `/rss.xml`                                    |
| `site-files/`         | `/site.webmanifest`, `/favicon.ico`, `/apple-touch-icon.png`, `/site/<file>` |
| `link-images/`        | `/link-images/<file>`, link previews' images                                 |
| `assets/`             | `/assets/<file>`, `/fonts/<file>`: Datastar and the fonts                    |
| `admin/login/`        | `/admin/login`, `/admin/logout`                                              |
| `admin/index/`        | `/admin`, a link to each of the four below                                   |
| `admin/posts/`        | `/admin/posts`, the list of posts                                            |
| `admin/compose/`      | `/admin/posts/new`, `/admin/posts/<id>/edit`, and what the composer posts to |
| `admin/branding/`     | `/admin/branding`, the site's title, URL, introduction, and images           |
| `admin/integrations/` | `/admin/integrations`, a section for each service: email, and Turnstile      |
| `admin/subscribers/`  | `/admin/subscribers`, empty for now                                          |
| `dev/`                | `/dev`, outside production: tools for working on the app (below)             |

`dev/` has a folder for each of its pages, like `admin/`: `index/` for `/dev`, a card linking to
the others; `design/` for `/dev/design`, every component in `components/ui/`; and `emails/` for
`/dev/emails`, what the site sent to its fake of Amazon SES. The fake is an SES endpoint at
`/dev/ses`, which takes email as SES's API does, checking each request's signature, with AWS's
example access key (`AKIAIOSFODNN7EXAMPLE`, and its secret); `/dev/emails` lists the settings that
send to it. `dev/dev.tsx` keeps them all out of production.

Each has the same files: `handler.tsx`, its handlers with its route table at the bottom;
`page.tsx` and `page.css`, what it shows; and its tests. `admin/admin.tsx`, `admin/layout.tsx`,
and `admin/fields.tsx` are what every page under `/admin` shares: the login check, the layout,
and labelled inputs. A handler reads the
request, calls queries or one command, and picks a response.

**Datastar** runs the theme toggle (`data-on:click`) and share buttons (`data-on:click`,
`data-class`, `data-attr`, one `_shared` signal) in `components/controls.tsx`, and the composer in
`admin/compose/`: its file inputs and remove buttons post the form for its media
(`data-on:change`, with `data-indicator:_uploading`), and typing posts it for the preview
(`data-on:input__throttle.100ms.trailing`); the server answers with HTML for those parts. The
composer keeps nothing on the server until it's posted, which is a plain form submission, read
into a post by `form.ts`. Every expression is a one-line constant string. Values like the URL to
share are passed in `data-*` attributes and read with `el.dataset`, so nothing a user typed can
end up in an expression. Everything else works without JavaScript: navigation is links, forms are
forms, and the delete dialog uses `command`/`commandfor`. The one other script is Cloudflare's
Turnstile widget, on `/admin/integrations` once it has a site key and on `/admin/login` while it's
enabled; it puts its token in a plain form.

#### 4. Data: `data/`

Each folder has what a thing is (pure: no database, files, HTTP, or pages), its reads
(`queries.ts`), and its writes (`commands.ts`), which fail with typed errors. Every read queries
the database, and nothing is kept between requests, so an edit made in the database directly
(like with `sqlite3`) shows up on the next request. Storage and database failures are defects (a
500, logged), as they're not something a user can fix.

| File                    | What it holds                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `posts/post.ts`         | What a post is (`PostRecord`, an Effect `Schema`), and the checks a post passes before it's saved, reported as `{ field, message }` issues for the form |
| `posts/rows.ts`         | How a post maps to a row of the `posts` table                                                                                                           |
| `posts/presentation.ts` | Posts as pages show them: media URLs, image sizes, `srcset`s, captions rendered to HTML, link previews, and page metadata                               |
| `posts/caption.ts`      | Captions: paragraphs, line breaks, **bold**, _italic_, and URLs as links, and the first URL for its preview                                             |
| `posts/queries.ts`      | `PostQueries`: posts and their images' sizes, presented                                                                                                 |
| `posts/commands.ts`     | `PostCommands` (below), `PostRejected` (with the issues to show), and `PostNotFound`                                                                    |
| `posts/media.ts`        | `PostMedia`: a post's files, and its resized photos, made on first request and stored; concurrent requests for one share a single resize                |
| `posts/files.ts`        | `makePostFiles`: stateless upload and removal helpers, also used by test seeding                                                                        |
| `site/site.ts`          | The site's settings (branding, and integrations like `TurnstileSettings`, each one setting saved as JSON), and their checks                             |
| `site/site-images.ts`   | The URLs pages link the site's icon, logos, and banner image with                                                                                       |
| `site/queries.ts`       | `SiteConfigQueries`, and `configuredSite` for what's only served once the settings are saved                                                            |
| `site/commands.ts`      | `SiteConfigCommands`: saving `/admin/branding` (turning uploads into the site's image files, or `SiteConfigRejected`), and the integrations' settings  |
| `site/email.ts`         | `Email`: whether it's set up, and sending an email with Amazon SES's API (signing with AWS Signature V4) or Resend's, with a typed error for each failure |
| `site/turnstile.ts`     | `Turnstile`: whether it's set up, checking a widget's token with Cloudflare, with a typed error for each way that fails, and logins while it's enabled  |
| `site/files.ts`         | The site's image files, from storage, or the default icons that `Images` caches                                                                         |
| `link-previews/`        | `LinkPreviews` fetches previews in the background, never on a page's time, and saves each one's image as resized WebP copies                            |

`PostCommands` has `save`, which publishes a post or saves an edit of one, `delete`, and the
composer's `upload`, which saves a post's files as they're chosen. Uploads are saved before the
post is checked, so a rejected form doesn't need its files chosen again, and a chosen file never
takes the name of one the post has, so nothing published changes until the post is saved.
Saving, or closing the composer (`discard`), removes the post's files it doesn't name.

#### 5. Components: `components/`

Components are plain functions from props to `Html`. `lib/jsx/jsx-runtime.ts` escapes every
string and attribute; the only way to write markup unescaped is `raw()`, which is used only for
HTML the app renders itself (captions, the stylesheet, JSON-LD). Start with `document.tsx`, the
`<html>` around every page; `post.tsx` is a post, as the home page, its own page, and the
composer's preview show it. CSS is plain CSS beside what it styles, imported as text by the file
beside it and minified with `stylesheet()`. Every page inlines `DOCUMENT_STYLES` (the reset, the
theme, and the navbar's) and its own styles, which its handler passes: `page.tsx` exports them,
with `POST_STYLES` if it shows posts, and the pages under `/admin` add the admin layout's.

`components/ui/` is [shadcn/ui](https://ui.shadcn.com)'s components in its base-nova style, as
plain HTML: Button, Input, Textarea, NativeSelect, Field and Label, Checkbox, Switch, Card,
Badge, Separator, Kbd, Alert, Dialog, and DropdownMenu. Each sets shadcn's `data-slot`, which its
CSS (in the `ui` layer, under a page's own) styles with the theme's tokens, and exports its
styles for the pages that use it (like `BUTTON_STYLES`). Form controls are native ones, the
dialog is a `<dialog>` opened with `command`/`commandfor`, and the dropdown menu is a popover
placed with CSS anchor positioning; Datastar only adds the menu's arrow keys and focus, and its
checkbox and radio items' signals. `bun run dev` serves them all, in both themes, at `/dev/design`.
Every page's buttons, inputs, and messages are these, except the composer's, which has its own
(but for its delete dialog); a page's own CSS only places them. Lines and
boxes are kept to what's needed: the admin pages' lists and sections are set apart by space, not
borders or cards.

#### 6. Lib: `lib/`

Shared resources are Effect services (`Context.Service`) with a `layer` that builds them.
Database migrations are an Effect function, `runMigrations`, used by startup and the CLI.

| File                 | Does                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`          | `AppConfig`, from environment variables                                                                                                                                                                       |
| `urls.ts`            | Every URL the app links to                                                                                                                                                                                    |
| `database.ts`        | The SQLite connection (`@effect/sql-sqlite-bun`, in WAL mode) and the migrations, which write the same journal LogSpace 0.1 (the Remix version) did, so its databases upgrade in place                        |
| `media-storage.ts`   | Uploaded files as plain files under `MEDIA_DIR` (`posts/<id>/<file>`, `variants/…`, `site/…`, `link-images/…`), written atomically with `Bun.write` and served straight from disk; or in memory for the tests |
| `images.ts`          | Everything Bun.Image does: reading and resizing photos, and making the logos, icons, and banner image                                                                                                         |
| `public-http.ts`     | Fetching other sites, only at public addresses on standard ports                                                                                                                                              |
| `secrets.ts`         | `Secrets`: sealing secrets like an integration's secret key for the database, with AES-256-GCM and a key derived from `AUTH_SESSION_SECRET`                                                                   |
| `http/pages.ts`      | What a page needs from the request (`PageContext`), and its response with a per-response CSP nonce                                                                                                            |
| `http/session.ts`    | The admin password check and the signed session cookie (`AdminAuth`)                                                                                                                                          |
| `http/forms.ts`      | Reading a form within the upload limits (`UploadTooLarge` → the 413 page)                                                                                                                                     |
| `http/responses.ts`  | Files with ranges, ETags, and caching; redirects                                                                                                                                                              |
| `http/forwarded.ts`  | The protocol and host behind Caddy (`TRUST_PROXY=1`)                                                                                                                                                          |
| `http/assets.ts`     | Datastar, fonts, and every page's styles with the heading font, embedded in the binary                                                                                                                        |
| `http/middleware.ts` | Wraps every request, in this order: the proxy's forwarded host, the cross-origin form check, the gate that keeps an unconfigured site private, then the handler, with 404s, 500s, and security headers        |

#### 7. Tests

The suites are the `*.test.ts` files beside the code. `test/app.ts` builds the app with an
in-memory database and storage and drives it through `fetch`-style requests. Services can also be
called directly with `app.run(effect)`. `test/content/` has the posts they start with.

#### Browser tests

`*.pw.ts` (like `src/routes/admin/compose/compose.pw.ts`) drive the composer, and the dropdown
menu and dialog on `/dev/design`, and the email settings' fields, in Chromium and WebKit with Playwright, which also needs Node.js 20 or newer: publishing each kind of post, with
and without JavaScript. Each test starts the app with its own temporary data and port
(`browser/fixtures.ts`). Install the browsers once with `bun run test:browser:install`, then run
`bun run test:browser`. CI doesn't run them.

### Security

- **CSP**: pages allow only scripts with that response's nonce (not even other scripts from the
  site's own origin), and require Trusted Types.
  Datastar runs in its [CSP mode](https://data-star.dev/reference/security) with the nonce, so
  there's no `unsafe-eval` or `unsafe-inline`. Other responses (files, feeds) run no scripts.
  Pages also send `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`, and
  `form-action 'self'`. Only a page with the Turnstile widget also allows scripts and frames
  from `https://challenges.cloudflare.com`, still with Trusted Types required.
- **Stored secrets**: an integration's secret key (or email's secret access key or API key) is sealed with AES-256-GCM, with a key derived
  (HKDF) from `AUTH_SESSION_SECRET` and the setting it's for, so a copy of the database alone
  doesn't give it away, and it's never sent back to the browser (only its last four characters).
  Changing `AUTH_SESSION_SECRET` makes saved secrets unreadable; the admin is asked to enter them
  again.
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
