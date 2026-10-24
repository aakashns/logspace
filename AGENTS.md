# LogSpace

Two projects, each with its own `package.json`, `bun install`, and rules; run commands from the
one you're changing.

- `platform/`: the app and the `logspace` binary. Read `platform/AGENTS.md` first.
- `website/`: logspace.app, and `public/install.sh`, the installer. Its demo video and
  screenshots run the platform's server (`scripts/demo-server.ts`), so a platform change can
  break them.
