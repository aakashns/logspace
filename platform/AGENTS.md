# LogSpace

Bun, Effect v4, and Datastar, released as one binary. `README.md` is the tour of the code; the
Effect docs are in `node_modules/effect/CLAUDE.md` and `node_modules/effect/ai-docs/`, and
Datastar's at https://data-star.dev/docs.md.

```sh
bun run dev          # restarts on change; reload the browser
bun run test         # in-memory database and media storage
bun run typecheck && bun run lint && bun run format:check
bun run build && bun scripts/smoke-test.ts dist/logspace
bun scripts/seed.ts  # the test posts, into DATABASE_PATH and MEDIA_DIR
bun run count-lines
```

## Where things go

- `src/app.ts` wires every service and the routes; read it first
- `src/domain/` is pure (no database, files, or HTTP): what posts and settings are, their checks,
  and how pages show them
- `src/commands/` is every write (one method per change), and `src/queries/` every read, from
  read models kept in memory until the data changes (`src/services/data-version.ts`)
- `src/services/` talks to the world: SQLite, media files, images (Bun.Image)
- `src/http/` has the routes (`public.tsx`, `admin.tsx`, each with its route table at the bottom)
  and the middleware around them; `src/views/` the pages, rendered by `src/jsx/` to strings
- `src/main.ts` is the binary's command line (`start`, `setup`, `set-admin-password`, `migrate`,
  `upgrade`, `version`, `help`), with a module per command in `src/cli/`;
  `scripts/setup-test.ts` checks `setup` on a throwaway Linux machine with systemd and Caddy, as
  CI's Linux runners are

## Rules

- Every PR bumps `version` in `package.json` one step (CI checks), and merging it to main releases
  that version. Below 1.0, bump the minor version for breaking changes (like to the binary's
  commands or environment variables, or what `setup` installs) and the patch version for others
- Scripts are TypeScript, run with Bun, and any that run on a server go in the binary as commands
  (servers have no Bun). The exception is `../website/public/install.sh`, which runs before
  there's a binary
- Handlers read the request, call queries or one command, and pick a response; a change of more
  than one step is one command. Every command calls `DataVersion.changed` after it writes
- Write services with `Context.Service` and a `layer`, and functions with `Effect.fn` (or
  `Effect.fnUntraced` on hot paths). Expected failures are `Schema.TaggedError`s that callers
  handle; unexpected ones (storage, the database) are defects, a logged 500
- Check unknown input at the boundary with `Schema`, and use specific types inside
- The layers stay apart: `domain/` imports nothing below it, queries never import commands, and
  views never import services; `bun run lint` checks
- The only browser JavaScript is Datastar, in `src/views/controls.tsx`. Its expressions are
  constant strings; pass values in `data-*` attributes. Put `data-ignore` on any HTML made from
  what someone wrote. Pages get a CSP nonce per response, so no inline scripts
- Markup unescaped is `raw()`, only for HTML the app made (Markdown output, CSS, JSON-LD)
- Embed any file the app reads with an `import … with { type: 'file' }` (or `'text'`), so the
  binary has it
- Read the site's settings from `SiteConfigQueries`; never hardcode anything about a site's owner
- Tests drive the app through `test/app.ts`, and reset the database with `app.seedDatabase` in
  `beforeEach`; control async order with promises, not sleeps
- Keep helpers with their one user until a second needs them; comments explain why
- Use Playwright for browsers. Attach PR screenshots with `gh pr create --attach`; never commit
  them
