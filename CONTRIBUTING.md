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

Tests use temporary data. [platform/AGENTS.md](platform/AGENTS.md) has the conventions and where common changes go, [posts.md](platform/docs/posts.md) the post format, and [the tour below](#platform-code) how the app fits together.

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
- **A tiny JSX runtime** (`src/jsx`, about 110 lines) that renders TSX straight to HTML strings: no
  virtual DOM, no hydration.
- **CQRS**: writes go through `src/commands`, and reads through `src/queries`, which query the
  database on every request.

### A tour of the code

The app is in `platform/`, and paths here are from there. Read it in this order; each file starts with a comment that says what it's for.

#### 1. The shape: `src/app.ts`

The composition root wires each service to its dependencies with `Layer.provide`, then merges
them into `AppServices`. Reusing the same layer values shares the connection, storage, caches,
and write locks. `MigratedDatabase` runs migrations before exposing SQL; the migration command
uses the raw connection so it can do a dry run.

`AppServices` takes `AppConfig` and `PublicNetwork`, so tests can control both. `AppLive` supplies
the normal network implementation for servers and scripts. The routes are `PublicRoutes`,
`AdminRoutes`, and `AppMiddleware`. `provideMerge` is used only where the dependency must also
remain available to the caller.

`src/main.ts` is the binary's command line (`start` by default, and `setup`, `migrate`,
`set-admin-password`, `upgrade`, `version`, `help`). `src/server.ts` supplies Bun's HTTP listener
and closes draft streams before HTTP shutdown. The CLI and browser tests use this same server.

#### 2. What things are: `src/domain/` (pure)

No database, files, or HTTP: lint fails if anything here imports them (`.oxlintrc.json`).

| File                                                                     | What it holds                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post.ts`                                                                | What a post is (`PostRecord`, an Effect `Schema`), and the checks a post passes before it's saved, reported as `{ field, message }` issues for the form |
| `post-rows.ts`                                                           | How a post maps to a row of the `posts` table                                                                                                           |
| `presentation.ts`                                                        | Posts as pages show them: media URLs, image sizes, `srcset`s, captions rendered to HTML, link previews, and page metadata                               |
| `markdown.ts`                                                            | Captions (tweet-like Markdown) and article bodies (with images and videos from the post's files)                                                        |
| `site.ts`                                                                | The site's settings, and their checks                                                                                                                   |
| `site-images.ts`                                                         | The URLs pages link the site's icon, logos, and banner image with                                                                                       |
| `post-form.ts`                                                           | Reading the admin post form into a post and its uploads                                                                                                 |
| `feeds.ts`                                                               | `sitemap.xml`, `rss.xml`, and `robots.txt`                                                                                                              |
| `images.ts`, `links.ts`, `link-metadata.ts`, `format.ts`, `constants.ts` | Image widths, URLs in text, link-preview parsing, dates and sizes, and limits                                                                           |

`src/routes.ts` builds every URL the app links to.

#### 3. Talking to the world: `src/services/`

Shared resources are Effect services (`Context.Service`) with a `layer` that builds them.
Database migrations are an Effect function, `runMigrations`, used by startup and the CLI.

| Service            | Does                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.ts`      | The SQLite connection (`@effect/sql-sqlite-bun`, in WAL mode) and the migrations, which write the same journal LogSpace 0.1 (the Remix version) did, so its databases upgrade in place                        |
| `media-storage.ts` | Uploaded files as plain files under `MEDIA_DIR` (`posts/<id>/<file>`, `variants/…`, `site/…`, `link-images/…`), written atomically with `Bun.write` and served straight from disk; or in memory for the tests |
| `images.ts`        | Everything Bun.Image does: reading and resizing photos, and making the logos, icons, and banner image                                                                                                         |
| `draft-changes.ts` | Word that the composer's draft changed, and which tab changed it, for every open composer to follow (kept in memory; the draft is in the database)                                                            |

#### 4. Writes: `src/commands/`

Every change to the data is one method here, which validates, writes, and then marks the data
changed. They fail with typed errors (`commands/errors.ts`): `PostRejected` (with the issues to
show), `PostNotFound`, and `SiteConfigRejected`. Storage and database failures are defects (a 500,
logged), as they're not something a user can fix.

- `posts.ts`: `publish`, `edit`, `delete`, and the composer's `saveDraft`, `updateFiles`, and
  `discard`. Uploads are saved before the post is checked, so a rejected form doesn't need its
  files chosen again. The composer's one draft is a row in `drafts`, and the commands that change
  it tell `DraftChanges`. Post changes run one at a time, so run one server process per data
  directory.
- `post-files.ts`: `makePostFiles` captures SQL, storage, and images for stateless upload and
  removal helpers, also used by test seeding. `PostCommands` owns the lock around writes.
- `site-config.ts`: saving `/admin/config`, turning uploads into the site's image files.

#### 5. Reads: `src/queries/`

Every read queries the database: `PostQueries` reads posts and their images' sizes and presents
them (URLs, sizes, rendered captions), and `SiteConfigQueries` reads the site's settings. Nothing
is kept between requests, so an edit made in the database directly (like with `sqlite3`) shows up
on the next request.

`post-media.ts` serves a post's files and its resized photos, which are made on first request
and stored. Concurrent requests for one share a single resize. `link-previews.ts` fetches link
previews in the background, never on a page's time, and saves each one's image as resized WebP
copies, so cards load from the site itself, at the size they're shown.

`site-files.ts` exports stateless Effect functions for the site's image files. Their dependencies
are storage and `Images`, which owns the cached default icons.

#### 6. HTTP: `src/http/`

Routes are Effect `HttpRouter` routes: `public.tsx` (pages, feeds, files) and `admin.tsx`
(everything under `/admin`), with the route table at the bottom of each. The admin's handlers
are in `admin/`, a module for each part (`login.tsx`, `config.tsx`, `posts.tsx`, and
`composer.tsx`), which share only `admin/pages.tsx`: the admin layout and the login check. A
handler reads
the request, calls queries or one command, and picks a response. `middleware.ts` wraps every request,
in this order: the proxy's forwarded host, the cross-origin form check, the gate that keeps an
unconfigured site private, then the handler, with 404s, 500s, and security headers.

| File           | Does                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `pages.ts`     | What a page needs from the request (`PageContext`), and its response with a per-response CSP nonce |
| `session.ts`   | The admin password check and the signed session cookie (`AdminAuth`)                               |
| `forms.ts`     | Reading a form within the upload limits (`UploadTooLarge` → the 413 page)                          |
| `responses.ts` | Files with ranges, ETags, and caching; redirects                                                   |
| `forwarded.ts` | The protocol and host behind Caddy (`TRUST_PROXY=1`)                                               |
| `assets.ts`    | Datastar, fonts, and the stylesheets, embedded in the binary                                       |

#### 7. Pages: `src/views/` and `src/jsx/`

Components are plain functions from props to `Html`. `jsx-runtime.ts` escapes every string and
attribute; the only way to write markup unescaped is `raw()`, which is used only for HTML the app
renders itself (Markdown output, the stylesheet, JSON-LD). Start with `document.tsx`, the
`<html>` around every page. CSS is plain CSS in `views/styles/`, joined and minified by
`stylesheet.ts`, and inlined into each page. The admin pages add `admin.css`.

**Datastar** is in `controls.tsx` and `admin/composer-controls.tsx` only: the theme toggle
(`data-on:click`) and share buttons (`data-on:click`, `data-class`, `data-attr`, one `_shared`
signal) in the first, and in the second the composer's controls (uploads, the preview, saving the
draft, and `ComposerUpdates`, a stream of the draft's changes from the server). Every expression
is a constant string. Values like the URL to share are passed in `data-*` attributes and read with
`el.dataset`, so nothing a user typed can end up in an expression. Everything else works without
JavaScript: navigation is links, forms are forms, and the delete dialog uses
`command`/`commandfor`.

#### 8. Tests: `test/`

`test/app.ts` builds the app with an in-memory database and storage and drives it through
`fetch`-style requests. Services can also be called directly with `app.run(effect)`. The suites
are the `*.test.ts` files; `platform/AGENTS.md` lists which cover each common change.

#### Browser tests

`browser/*.pw.ts` drive the composer in Chromium and WebKit with Playwright, which also needs
Node.js 20 or newer: publishing each kind of post, drafts through reloads and other tabs, and
recovering from failed requests and a restarted server. Each test starts the app with its own
temporary data and port. Install the browsers once with `bun run test:browser:install`, then run
`bun run test:browser`. CI doesn't run them.

### Security

- **CSP**: pages allow only scripts with that response's nonce (not even other scripts from the
  site's own origin), and require Trusted Types.
  Datastar runs in its [CSP mode](https://data-star.dev/reference/security) with the nonce, so
  there's no `unsafe-eval` or `unsafe-inline`. Other responses (files, feeds) run no scripts.
  Pages also send `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`, and
  `form-action 'self'`.
- **User content**: Markdown is rendered with raw HTML escaped, and the containers it goes in
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
  Unpublished posts' files aren't served. Link previews' images are fetched only over https,
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
