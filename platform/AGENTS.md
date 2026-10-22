# LogSpace

A Remix 3 app on Bun, released as one binary. See `.agents/skills/remix/SKILL.md` for Remix.

```sh
bun run dev          # restarts on change; reload the browser
bun run test         # in-memory database and media storage
bun run typecheck && bun run lint && bun run format:check
bun run build && binary/smoke-test.sh dist/logspace
../scripts/count-lines.sh
```

## Where things go

- `app/routes.ts` → `app/router.ts` → `app/actions/**/controller.tsx`, with each page beside its controller
- `app/data/` owns state; `app/lib/` and `app/ui/` are shared and never import pages
- Posts: `data/posts/model.ts` (pure checks) → `presentation.ts` (pure, what pages show) → `store.ts` (database) → `mutations.ts` (one function per change, which controllers call)

## Rules

- Controllers read the request, call `app/data/`, and pick a response; changes of more than one step are one data function
- Pure modules and browser code (`*/public/`) import no database, storage, sharp, or server code; `bun run lint` checks
- Check unknown input at the boundary and use specific types inside; expected failures are results, unexpected ones throw
- Keep helpers with their one user until a second needs them; comments explain why
- Use Node's APIs, not Bun's (except `server.ts` and `binary/`). Find files from `import.meta.url`, and tell `binary/build.ts` about any new folder the app reads
- Give everything in `<head>` a stable `data-rmx-key`. A later `css()` wins whatever the specificity, and nested selectors must start with `&`
- Read the site's settings with `getSiteConfig()`; never hardcode anything about a site's owner
- Tests run through `router.fetch` (`test/client.ts`) and reset the database with `seedDatabase()` in `beforeEach`; control async order with promises, not sleeps
- Use Playwright for browsers. Attach PR screenshots with `gh pr create --attach`; never commit them
