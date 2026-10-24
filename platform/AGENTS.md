# LogSpace

Bun, Effect v4, and Datastar, released as one binary. `../CONTRIBUTING.md` has the tour of the
code; the Effect docs are in `node_modules/effect/CLAUDE.md` and `node_modules/effect/ai-docs/`,
and Datastar's at https://data-star.dev/docs.md.

```sh
bun run dev:demo     # a throwaway site with the test posts; prints its URL and admin password
bun run dev          # your own site, configured in .env (see ../CONTRIBUTING.md)
bun run ready        # typecheck, lint, format:check, and test: what CI checks
bun run test         # in-memory database and media storage
bun run test:browser # Playwright, Chromium and WebKit; not run by CI
bun run build && bun scripts/smoke-test.ts dist/logspace
bun scripts/seed.ts  # the test posts, into DATABASE_PATH and MEDIA_DIR
bun run count-lines
```

## Where things go

- `src/app.ts` wires every service and the routes; read it first
- `src/domain/` is pure (no database, files, or HTTP): what posts and settings are, their checks,
  and how pages show them
- `src/commands/` is every write (one method per change), and `src/queries/` every read, straight
  from the database
- `src/services/` talks to the world: SQLite, media files, images (Bun.Image)
- `src/http/` has the routes (`public.tsx`, and `admin.tsx`, whose handlers are in `admin/`: each
  has its route table at the bottom) and the middleware around them; `src/views/` the pages,
  rendered by `src/jsx/` to strings
- `src/main.ts` is the binary's command line (`start`, `setup`, `set-admin-password`, `migrate`,
  `upgrade`, `version`, `help`), with a module per command in `src/cli/`;
  `scripts/setup-test.ts` checks `setup` on a throwaway Linux machine with systemd and Caddy

## Common changes

Where to start, then the tests that cover it. Code is in `src/` and tests in `test/` unless the
path says otherwise.

- A post's fields or checks: `domain/post.ts`, `domain/post-rows.ts`, a new `db/migrations/`
  file, and `docs/posts.md`; `domain.test.ts`, `migrations.test.ts`
- How posts and pages look: `domain/presentation.ts`, `views/` (`post.tsx`, `post-page.tsx`,
  `home.tsx`), `views/styles/`; `public.test.ts`
- Public routes, feeds, and files: `http/public.tsx`, `domain/feeds.ts`,
  `queries/post-media.ts`; `public.test.ts`
- The composer: `views/admin/compose.tsx` and its Datastar in `views/admin/composer-controls.tsx`,
  `domain/compose.ts`, `http/admin/composer.tsx`, `commands/posts.ts`, `services/draft-changes.ts`;
  `admin.test.ts` ("the composer"), `browser/composer.pw.ts`
- Editing and deleting posts: `views/admin/post-form.tsx`, `domain/post-form.ts`,
  `http/admin/posts.tsx`, `commands/posts.ts`; `admin.test.ts`, `content-access.test.ts`
- Site settings and images: `domain/site.ts`, `domain/site-images.ts`, `commands/site-config.ts`,
  `queries/site-files.ts`, `http/admin/config.tsx`, `views/admin/config.tsx`; `config.test.ts`
- Login and sessions: `http/session.ts`, `http/admin/login.tsx`, `views/admin/login.tsx`;
  `admin.test.ts` ("logging in"), `session-lifecycle.test.ts`
- Link previews: `queries/link-previews.ts`, `domain/link-metadata.ts`,
  `services/public-http.ts`; `link-previews.test.ts`
- Headers, CSP, and cross-origin forms: `http/middleware.ts`, `http/pages.ts`; `public.test.ts`,
  `admin.test.ts`, `review.test.ts`
- The binary's commands and `setup`: `main.ts`, `cli/`; `service.test.ts`, `caddyfile.test.ts`,
  `scripts/setup-test.ts`, `scripts/smoke-test.ts`

## Rules

- A PR that changes what goes into the binary (`src/`, `db/`, `public/`, dependencies, the build,
  or anything else in `package.json`, like its scripts) bumps `version` in `package.json` one
  step, and merging it to main releases that version; other PRs (tests, docs, scripts, the
  website) leave it be. CI checks both (`scripts/check-version.ts`
  lists what counts). Below 1.0, bump the minor version for breaking changes (like to the binary's
  commands or environment variables, or what `setup` installs) and the patch version for others
- Scripts are TypeScript, run with Bun, and any that run on a server go in the binary as commands
  (servers have no Bun). The exception is `../website/public/install.sh`, which runs before
  there's a binary
- Handlers read the request, call queries or one command, and pick a response; a change of more
  than one step is one command
- Write services with `Context.Service` and a `layer`, and functions with `Effect.fn` (or
  `Effect.fnUntraced` on hot paths). Expected failures are `Schema.TaggedError`s that callers
  handle; unexpected ones (storage, the database) are defects, a logged 500
- Check unknown input at the boundary with `Schema` (JSON, cookies, files, other sites), and use
  specific types inside. Types are checked, never asserted: no casts (`as const` is fine), `any`,
  or `!` (`bun run lint` checks). The compiler has `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` on: data with a schema leaves an optional key out rather than
  setting it to undefined, and props that callers fill from maybe-missing values are
  `?: T | undefined`
- Time comes from `Clock` or `DateTime`, files and processes from `FileSystem` and
  `ChildProcessSpawner`, and other sites from `HttpClient`, except where Bun's own APIs are the
  point (media storage serves `BunFile`s with sendfile)
- The layers stay apart: `domain/` imports nothing below it, queries never import commands, views
  never import services or queries (URLs and the shapes pages show come from `domain/`), public
  pages and routes never import the admin's, and the admin's handlers share only
  `http/admin/pages.tsx`; `bun run lint` checks
- The only browser JavaScript is Datastar, in `src/views/controls.tsx` and the composer's
  `src/views/admin/composer-controls.tsx`. Its expressions are constant strings; pass values in
  `data-*` attributes. Put `data-ignore` on any HTML made from what someone wrote. Pages get a CSP
  nonce per response, so no inline scripts
- Markup unescaped is `raw()`, only for HTML the app made (Markdown output, CSS, JSON-LD)
- Embed any file the app reads with an `import … with { type: 'file' }` (or `'text'`), so the
  binary has it
- Read the site's settings from `SiteConfigQueries`; never hardcode anything about a site's owner
- Tests drive the app through `test/app.ts`, and reset the database with `app.seedDatabase` in
  `beforeEach`; control async order with promises, not sleeps
- Keep helpers with their one user until a second needs them; comments explain why
- Use Playwright for browsers. Attach PR screenshots with `gh pr create --attach`; never commit
  them
- CI doesn't run the browser tests: after creating a PR, run `bun run test:browser` and report
  the result in the PR
