# LogSpace

Bun, Effect v4, and Datastar, released as one binary. `../CONTRIBUTING.md` has the tour of the
code; the Effect docs are in `node_modules/effect/CLAUDE.md` and `node_modules/effect/ai-docs/`,
and Datastar's at https://data-star.dev/docs.md.

```sh
bun run dev:demo     # a throwaway site with the test posts; prints its URL and admin password
bun run ready        # what CI checks
bun run test:browser # Playwright; CI doesn't run it
bun run build && bun scripts/smoke-test.ts dist/logspace
```

## Rules

- A PR that changes what goes into the binary bumps `version` in `package.json` one step (minor
  for breaking changes to the binary's commands, environment variables, or what `setup`
  installs; patch otherwise), and merging it releases that version. `scripts/check-version.ts`
  says what counts
- Scripts that run on a server go in the binary as commands (servers have no Bun), except
  `../website/public/install.sh`, which runs before there's a binary
- Handlers read the request, call queries or one command, and pick a response; a change of more
  than one step is one command
- Write services with `Context.Service` and a `layer` only for shared state, resources, or
  application APIs; functions are `Effect.fn` (or `Effect.fnUntraced` on hot paths). Expected
  failures are `Schema.TaggedError`s that callers handle; unexpected ones (storage, the database)
  are defects, a logged 500
- Check unknown input at the boundary with `Schema` (JSON, cookies, files, other sites)
- Time comes from `Clock` or `DateTime`, files and processes from `FileSystem` and
  `ChildProcessSpawner`, and other sites from `HttpClient`, except where Bun's own APIs are the
  point (media storage serves `BunFile`s with sendfile)
- The only browser JavaScript is Datastar. Its expressions are short constant strings (an action
  like `@post(...)`, a signal); anything more is the server's job, not JavaScript in the markup.
  Pass values in `data-*` attributes, and put `data-ignore` on any HTML made from what someone
  wrote
- Markup unescaped is `raw()`, only for HTML the app made (captions, CSS, JSON-LD)
- Embed any file the app reads with an `import … with { type: 'file' }` (or `'text'`), so the
  binary has it
- Read the site's settings from `SiteConfigQueries`; never hardcode anything about a site's owner
- Tests reset the database with `app.seedDatabase` in `beforeEach`, and control async order with
  promises, not sleeps
- Keep helpers with their one user until a second needs them; comments explain why
- Attach PR screenshots with `gh pr create --attach`; never commit them. After creating a PR, run
  `bun run test:browser` and report the result in it
