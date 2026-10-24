# The logspace binary

LogSpace is one program, `logspace`, with its database, media, and pages in it. The
[main README](../README.md) shows how to install it on a server and publish; this is a reference
for running it. To work on it, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Commands

- `logspace start` runs the server; it's the default, with no command.
- `logspace setup [domains]` installs LogSpace as a systemd service behind Caddy, for the site's
  domain and any that redirect to it (or the saved ones), as root.
- `logspace set-admin-password` sets the password for `/admin`, which logs everyone out, as root.
- `logspace migrate` applies the database migrations that haven't run yet, which the server also
  does when it starts; `--dry-run` lists them.
- `logspace upgrade [version]` replaces the binary with the latest release, or the given one.
- `logspace version` prints the version, and `logspace help` the commands and settings.

## Configuration

The server reads environment variables. `logspace setup` writes them for you: the secrets and
`PORT` in `/etc/logspace.env` (readable only by root), and the rest in the service.

| Variable              | Default           | With `setup`                   |
| --------------------- | ----------------- | ------------------------------ |
| `PORT`                | `44100`           | `44100`                        |
| `HOST`                | `::` (everywhere) | `127.0.0.1`, behind Caddy      |
| `DATABASE_PATH`       | `data/app.sqlite` | `/var/lib/logspace/app.sqlite` |
| `MEDIA_DIR`           | `data/media`      | `/var/lib/logspace/media`      |
| `CACHE_DIR`           | `data/cache`      | `/var/cache/logspace`          |
| `ADMIN_PASSWORD`      |                   | asked for by `setup`           |
| `AUTH_SESSION_SECRET` |                   | generated                      |
| `TRUST_PROXY`         | off               | `1`                            |

Relative paths are from the working directory. `/admin` stays switched off until
`ADMIN_PASSWORD` and `AUTH_SESSION_SECRET` are each at least 16 characters; changing either logs
everyone out. Set `TRUST_PROXY=1` only behind a proxy that overwrites the `X-Forwarded-*` headers,
like Caddy. Run only one server for each database and media folder.

Uploaded media is kept as plain files under `MEDIA_DIR`, and the cache holds link previews, which
are fetched again if it's deleted. Back up the database and `MEDIA_DIR` together, as the
[main README](../README.md#updates-and-backups) shows.

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
  fingerprint of the password, so changing it logs everyone out. SQLite records enforce a fixed
  30-day lifetime and logout revocation; changing the signing secret also invalidates cookies.
  At most 100 sessions are retained, with expired/old-credential rows removed on login. Login is
  checked before an upload's body is read, and the login form itself, which anyone can send, is
  read only up to 16 KB.
- **Forms from other sites** are refused (`Sec-Fetch-Site`, else `Origin` against the host), as
  Remix's `cop()` did. Behind Caddy, the host is taken from `X-Forwarded-Host`, which
  Caddy overwrites, before the `Forwarded` header, which it passes through from the browser.
- **Files**: storage keys are built only from checked ids and names, and the fs backend also
  refuses any path outside `MEDIA_DIR`. Uploads are typed by extension, never by what the browser
  claims, and SVG isn't accepted for posts. Site images are re-encoded as PNG or JPEG.
  Unpublished posts' files aren't served. Link previews' images are fetched only over https,
  refused past 10 MB or 25 megapixels (checked from the header, before decoding), and served
  only as WebP that the app re-encoded. Link previews fetch only public addresses on standard
  ports, checking each redirect.

## Credits

Datastar is © Star Federation, MIT licensed (`public/datastar.LICENSE.md`). The composer's and
navbar's plus, image, video, Markdown file, map pin, and × icons are from Phosphor Icons, © 2023 Phosphor Icons, MIT
licensed.
