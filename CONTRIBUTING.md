# Contributing

Small, focused pull requests are welcome. Open an [issue](https://github.com/aakashns/logspace/issues) before a large change. Use [Bun](https://bun.com) 1.4.4 or later.

## App

```sh
cd platform
bun install
```

Create `platform/.env` (ignored by Git), using your own secrets and absolute paths outside the checkout:

```dotenv
ADMIN_PASSWORD=your-long-random-password
AUTH_SESSION_SECRET=another-long-random-secret
DATABASE_PATH=/absolute/path/to/logspace-data/app.sqlite
MEDIA_DIR=/absolute/path/to/logspace-data/media
```

Both secrets need at least 16 characters; `openssl rand -base64 32` generates one. Run `bun run dev`, open [localhost:44100/admin](http://localhost:44100/admin), and configure your site. The server restarts on changes; reload the browser. To start with some posts, run `bun scripts/seed.ts`, which replaces the database's posts with the ones the tests use.

```sh
bun run typecheck && bun run lint && bun run format:check
bun run test
bun run build && bun scripts/smoke-test.ts dist/logspace
```

Tests use temporary data. The app is [Bun](https://bun.com), [Effect](https://effect.website), and [Datastar](https://data-star.dev): [platform/README.md](platform/README.md) is a tour of the code, [platform/AGENTS.md](platform/AGENTS.md) has the conventions, and [posts.md](platform/docs/posts.md) the post format.

## Website

The Remix 3 landing page and installer live in `website/`. From the repository root:

```sh
cd website
bun install
bun run dev
```

Open [localhost:8787](http://localhost:8787). Run `bun run check`, `bun run build`, and `bun run test` before submitting; install Chromium once with `bunx playwright install chromium`.

For Cloudflare Workers, set the project root to `website`, build command to `bun run build`, and deploy command to `bun run deploy`. Add `logspace.app` as a custom domain after deployment. Local deployment uses `bunx wrangler login` followed by `bun run deploy`. The website serves `/install.sh`; the publishing app still runs on your Linux server.

The demo records the real app with fictional content in temporary storage. With the app's dependencies installed and FFmpeg available, run `bun run demo` from `website` to regenerate it.

## Pull requests

Explain the change, include relevant checks, and attach screenshots or recordings for UI changes. Keep evidence out of Git. Bump `platform/package.json` one version step: patch for compatible changes, minor for breaking changes before 1.0. CI checks this and publishes binaries when the PR merges to `main`.
