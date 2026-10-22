# LogSpace

A Remix 3 app on Bun, released as one binary. See `.agents/skills/remix/SKILL.md` for Remix.

```sh
bun run dev          # restarts on change; reload the browser
bun run test         # in-memory database and media storage
bun run typecheck && bun run lint && bun run format:check
bun run build && bun binary/smoke-test.ts dist/logspace
bun scripts/count-lines.ts
```

## Where things go

- `app/routes.ts` → `app/router.ts` → `app/actions/**/controller.tsx`, with each page beside its controller
- `app/data/` owns state; `app/lib/` and `app/ui/` are shared and never import pages
- Posts: `data/posts/model.ts` (pure checks) → `presentation.ts` (pure, what pages show) → `store.ts` (database) → `mutations.ts` (one function per change, which controllers call)
- `binary/main.ts` is the binary's command line (`start`, `setup`, `set-admin-password`, `migrate`, `upgrade`, `version`, `help`), with a module per command; `binary/setup-test.ts` checks `setup` on a throwaway Linux machine with systemd and Caddy, as CI's Linux runners are

## Rules

- Every PR bumps `version` in `package.json` one step (CI checks), and merging it to main releases that version. Below 1.0, bump the minor version for breaking changes (like to the binary's commands or environment variables, or what `setup` installs) and the patch version for others
- Scripts are TypeScript, run with Bun, including any that run on a server, which go in the binary as commands (servers have no Bun)
- Controllers read the request, call `app/data/`, and pick a response; changes of more than one step are one data function
- Pure modules and browser code (`*/public/`) import no database, storage, sharp, or server code; `bun run lint` checks
- Check unknown input at the boundary and use specific types inside; expected failures are results, unexpected ones throw
- Keep helpers with their one user until a second needs them; comments explain why
- Use Node's APIs, not Bun's (except `server.ts` and `binary/`). Find files from `import.meta.url`, and tell `binary/build.ts` about any new folder the app reads
- Give everything in `<head>` a stable `data-rmx-key`. A later `css()` wins whatever the specificity, and nested selectors must start with `&`
- Read the site's settings with `getSiteConfig()`; never hardcode anything about a site's owner
- Tests run through `router.fetch` (`test/client.ts`) and reset the database with `seedDatabase()` in `beforeEach`; control async order with promises, not sleeps
- Use Playwright for browsers. Attach PR screenshots with `gh pr create --attach`; never commit them
