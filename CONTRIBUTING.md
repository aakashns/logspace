# Contributing

Small, focused pull requests are welcome. Open an [issue](https://github.com/aakashns/logspace/issues) before a large change. Use [Bun](https://bun.com) 1.4.4 or later.

## App

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

Tests use temporary data. Install the browsers once with `bun run test:browser:install`. The app is [Bun](https://bun.com), [Effect](https://effect.website), and [Datastar](https://data-star.dev): [platform/README.md](platform/README.md) is a tour of the code, [platform/AGENTS.md](platform/AGENTS.md) has the conventions and where common changes go, and [posts.md](platform/docs/posts.md) the post format.

## Website

```sh
cd website
bun install
bun run dev     # builds and serves logspace.app locally, rebuilding on change
bun run check   # typecheck and format check
bun run test    # Playwright
```

## Pull requests

Explain the change, include the checks you ran (and the browser tests' result for app changes), and attach screenshots or recordings for UI changes. Keep evidence out of Git. If the change goes into the binary (`platform/src`, `db`, `public`, `package.json` apart from its version, dependencies, or the build), bump `platform/package.json` one version step: patch for compatible changes, minor for breaking changes before 1.0. Otherwise leave the version alone. CI checks this and publishes binaries when a bump merges to `main`.
