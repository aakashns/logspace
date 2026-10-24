# LogSpace's app

The server, its pages, and the `logspace` binary, built with:

- **[Bun](https://bun.com)** for the runtime, HTTP server, SQLite, file I/O, and the single-file
  binary.
- **[Effect v4](https://effect.website)** for structure: every dependency is a service provided by
  a layer, every expected failure is a typed error, and the database is
  [`effect/sql`](https://effect.website/docs).
- **[Datastar](https://data-star.dev)** as the only JavaScript sent to browsers (13 KB gzipped),
  for the theme toggle, share buttons, and the admin composer.
- **A tiny JSX runtime** (`src/jsx`, 91 lines) that renders TSX straight to HTML strings: no
  virtual DOM, no hydration.
- **CQRS**: writes go through `src/commands`, reads through `src/queries`, which keep in-memory
  views of the data that are rebuilt only when it changes.

```sh
bun install
bun run dev          # http://localhost:44100, restarts on change
bun run test         # in-memory database and media
bun run typecheck && bun run lint && bun run format:check
bun run build && bun scripts/smoke-test.ts dist/logspace
bun scripts/seed.ts  # fills DATABASE_PATH and MEDIA_DIR with the test posts
```

The server is configured with environment variables: `PORT`, `DATABASE_PATH`, `MEDIA_DIR`,
`CACHE_DIR`, `ADMIN_PASSWORD`, `AUTH_SESSION_SECRET`, `TRUST_PROXY`, and `MEDIA_STORAGE=fs|memory`.
Without them, data goes in `data/` in the working directory. `AGENTS.md` has the conventions, and
`docs/posts.md` what a post is made of.

## A tour of the code

Read it in this order; each file starts with a comment that says what it's for.

### 1. The shape: `src/app.ts`

The composition root, and the best map of the app. It wires every service into one layer and
shows what depends on what:

```
AppConfig ─┬─ Database ── Migrations
           └─ MediaStorage, Images, AdminAuth, Assets

queries/  (the read side):  SiteConfigQueries, PostQueries, SiteFiles, PostMedia, LinkPreviews
commands/ (the write side): PostFiles, PostCommands, SiteConfigCommands
http/     (the routes):     PublicRoutes, AdminRoutes, and AppMiddleware around them all
```

`src/main.ts` is the binary's command line (`start` by default, and `setup`, `migrate`,
`set-admin-password`, `upgrade`, `version`, `help`); `src/cli/start.ts` serves `app.ts`'s routes
with Bun's HTTP server.

### 2. What things are: `src/domain/` (pure)

No database, files, or HTTP: lint fails if anything here imports them (`.oxlintrc.json`).

| File                                                                     | What it holds                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post.ts`                                                                | What a post is (`PostRecord`, an Effect `Schema`), and the checks a post passes before it's saved, reported as `{ field, message }` issues for the form |
| `post-rows.ts`                                                           | How a post maps to a row of the `posts` table                                                                                                           |
| `presentation.ts`                                                        | Posts as pages show them: media URLs, image sizes, `srcset`s, captions rendered to HTML, and page metadata                                              |
| `markdown.ts`                                                            | Captions (tweet-like Markdown) and article bodies (with images and videos from the post's files)                                                        |
| `site.ts`                                                                | The site's settings, and their checks                                                                                                                   |
| `post-form.ts`                                                           | Reading the admin post form into a post and its uploads                                                                                                 |
| `feeds.ts`                                                               | `sitemap.xml`, `rss.xml`, and `robots.txt`                                                                                                              |
| `images.ts`, `links.ts`, `link-metadata.ts`, `format.ts`, `constants.ts` | Image widths, URLs in text, link-preview parsing, dates and sizes, and limits                                                                           |

`src/routes.ts` builds every URL the app links to.

### 3. Talking to the world: `src/services/`

Each is an Effect service (`Context.Service`) with a `layer` that builds it.

| Service            | Does                                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.ts`      | The SQLite connection (`@effect/sql-sqlite-bun`, in WAL mode) and the migrations, which write the same journal LogSpace 0.1 (the Remix version) did, so its databases upgrade in place       |
| `media-storage.ts` | Uploaded files as plain files under `MEDIA_DIR` (`posts/<id>/<file>`, `variants/…`, `site/…`), written atomically with `Bun.write` and served straight from disk; or in memory for the tests |
| `images.ts`        | Everything Bun.Image does: reading and resizing photos, and making the logo, icons, and banner image                                                                                         |

### 4. Writes: `src/commands/`

Every change to the data is one method here, which validates, writes, and then marks the data
changed. They fail with typed errors (`commands/errors.ts`): `PostRejected` (with the issues to
show), `PostNotFound`, and `SiteConfigRejected`. Storage and database failures are defects (a 500,
logged), as they're not something a user can fix.

- `posts.ts`: `publish`, `edit`, `delete`. Uploads are saved before the post is checked, so a
  rejected form doesn't need its files chosen again.
- `post-files.ts`: saving one upload (with its image size and hash in `post_images`) and removing
  a post's files.
- `site-config.ts`: saving `/admin/config`, turning uploads into the site's image files.

### 5. Reads: `src/queries/`

Every read queries the database: `PostQueries` reads posts and their images' sizes and presents
them (URLs, sizes, rendered captions), and `SiteConfigQueries` reads the site's settings. Nothing
is kept between requests, so an edit made in the database directly (like with `sqlite3`) shows up
on the next request.

`post-media.ts` serves a post's files and its resized photos, which are made on first request
and stored. Concurrent requests for one share a single resize. `link-previews.ts` fetches link
previews in the background, never on a page's time.

### 6. HTTP: `src/http/`

Routes are Effect `HttpRouter` routes: `public.tsx` (pages, feeds, files) and `admin.tsx`
(everything under `/admin`). The route table is at the bottom of each file. A handler reads
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

### 7. Pages: `src/views/` and `src/jsx/`

Components are plain functions from props to `Html`. `jsx-runtime.ts` escapes every string and
attribute; the only way to write markup unescaped is `raw()`, which is used only for HTML the app
renders itself (Markdown output, the stylesheet, JSON-LD). Start with `document.tsx`, the
`<html>` around every page. CSS is plain CSS in `views/styles/`, joined and minified by
`stylesheet.ts`, and inlined into each page. The admin pages add `admin.css`.

**Datastar** is in `controls.tsx` only: the theme toggle (`data-on:click`) and share buttons
(`data-on:click`, `data-class`, `data-attr`, one `_shared` signal). Every expression is a
constant string. Values like the URL to share are passed in `data-*` attributes and read with
`el.dataset`, so nothing a user typed can end up in an expression. Everything else works without
JavaScript: navigation is links, forms are forms, and the delete dialog uses
`command`/`commandfor`.

### 8. Tests: `test/`

`test/app.ts` builds the app with an in-memory database and storage and drives it through
`fetch`-style requests. Services can also be called directly with `app.run(effect)`. The suites
are `public.test.ts`, `admin.test.ts`, `config.test.ts`,
`domain.test.ts`, `migrations.test.ts`, and `caddyfile.test.ts`.

## Security

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
  fingerprint of the password, so changing it logs everyone out. Login is checked before an
  upload's body is read, and the login form itself, which anyone can send, is read only up to
  16 KB.
- **Forms from other sites** are refused (`Sec-Fetch-Site`, else `Origin` against the host), as
  Remix's `cop()` did. Behind Caddy, the host is taken from `X-Forwarded-Host`, which
  Caddy overwrites, before the `Forwarded` header, which it passes through from the browser.
- **Files**: storage keys are built only from checked ids and names, and the fs backend also
  refuses any path outside `MEDIA_DIR`. Uploads are typed by extension, never by what the browser
  claims, and SVG isn't accepted for posts. Site images are re-encoded as PNG or JPEG.
  Unpublished posts' files aren't served.

Datastar is © Star Federation, MIT licensed (`public/datastar.LICENSE.md`). The composer's and
navbar's plus, image, video, Markdown file, map pin, and × icons are from Phosphor Icons, © 2023 Phosphor Icons, MIT
licensed.
