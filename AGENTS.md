# LogSpace

Two projects, each with its own `package.json`, `bun install`, and rules; run commands from the
one you're changing.

- `platform/`: the app and the `logspace` binary (Bun, Effect, Datastar). Read
  `platform/AGENTS.md` first: its commands, where each kind of change goes, and the rules. Start a
  site to try with `bun run dev:demo`, and check a change with `bun run ready`.
- `website/`: logspace.app, a static site on Cloudflare, and `public/install.sh`, the installer.
  `bun run dev` serves it, `bun run check` typechecks and checks formatting, and `bun run test`
  runs Playwright. Its demo video and screenshots run the platform's server
  (`scripts/demo-server.ts`), so a platform change can break them.

`.github/workflows/release.yml` checks `platform/` on every PR and releases the binary when
`platform/package.json`'s version changes on main. `README.md` is for people running LogSpace;
`CONTRIBUTING.md` is for working on it, with the tour of the code.
