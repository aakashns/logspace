# LogSpace

Self-host your personal website with blog posts, photos, and videos. Write and publish from your browser. Deploy to your own domain. Free and open source.

[Website & demo](https://logspace.app) · [Changelog](https://github.com/aakashns/logspace/releases) · [Contributing](CONTRIBUTING.md)

## Deploy

You need a Linux server (Ubuntu or Debian, x64 or arm64), [Caddy](https://caddyserver.com/docs/install) installed, and a domain pointing to the server. Open ports 80 and 443; keep port 44100 private.

```sh
curl -fsSL https://logspace.app/install.sh | sh
sudo logspace deploy example.com www.example.com
```

Replace the domains with yours. Deploy asks for an admin password, starts LogSpace, enables HTTPS, and redirects the second domain to the first. The installer also supports macOS for local use.

## Publish

1. Open `https://example.com/admin` and log in.
2. Save your site title, URL, and description. Add a welcome message, logo, and icon if you like. Your site becomes public once these settings are saved.
3. Choose **New Post**, write something, add photos or a video if you like, and publish. Return to `/admin` to edit posts or change settings.

Write like a tweet, with **bold**, *italic*, and links that turn clickable on their own, and upload media directly. Every post has its own link; readers can follow along with RSS. Light and dark themes are built in.

## Updates and backups

```sh
sudo logspace upgrade              # Install the latest release
sudo logspace deploy               # Then restart with it (saved domains)
sudo logspace set-admin-password   # Change your password
sudo logspace turnstile off        # If Cloudflare Turnstile locks you out of /admin
journalctl -u logspace             # View server logs
logspace help                      # All commands and settings
```

Back up before upgrading. On the server, with `sqlite3` installed:

```sh
sudo sqlite3 /var/lib/logspace/app.sqlite ".backup '/root/logspace-backup.sqlite'"
sudo cp -a /var/lib/logspace/media /root/logspace-media-backup
```

Use a fresh destination for each backup, avoid publishing or deleting posts while backing up, and keep a copy off the server. Protect a copy of `/etc/logspace.env` too; it contains your admin secrets.

## Configuration

`logspace deploy` configures everything; change these only to run LogSpace another way. The server reads environment variables, which deploy puts in the service and, for the secrets and port, in `/etc/logspace.env` (readable only by root).

| Variable              | Default           | With `deploy`                  |
| --------------------- | ----------------- | ------------------------------ |
| `PORT`                | `44100`           | `44100`                        |
| `HOST`                | `::` (everywhere) | `127.0.0.1`, behind Caddy      |
| `DATABASE_PATH`       | `data/app.sqlite` | `/var/lib/logspace/app.sqlite` |
| `MEDIA_DIR`           | `data/media`      | `/var/lib/logspace/media`      |
| `CACHE_DIR`           | `data/cache`      | `/var/cache/logspace`          |
| `ADMIN_PASSWORD`      |                   | asked for by `deploy`          |
| `AUTH_SESSION_SECRET` |                   | generated                      |
| `TRUST_PROXY`         | off               | `1`                            |

Relative paths are from the working directory. `/admin` stays off until `ADMIN_PASSWORD` and `AUTH_SESSION_SECRET` are each at least 16 characters, and changing either logs everyone out. Set `TRUST_PROXY=1` only behind a proxy that overwrites `X-Forwarded-*` headers, like Caddy. Run only one server for each database and media folder. The cache holds link previews, which are fetched again if it's deleted.

## Security

Pages run no scripts but LogSpace's own, under a strict Content Security Policy, and what you write is escaped. The admin is one password, with sessions that last 30 days and end when you log out or change the password. Forms sent from other sites are refused. Uploads are typed by their extension and stored only under `MEDIA_DIR`, and unpublished posts' files aren't served. Link previews fetch only public addresses, and their images are re-encoded before they're served. [CONTRIBUTING.md](CONTRIBUTING.md#security) has the details.

## Contribute

[Report a bug](https://github.com/aakashns/logspace/issues) or read [CONTRIBUTING.md](CONTRIBUTING.md) to work on the app or website. Licensed under [MIT](LICENSE). Includes [Datastar](https://data-star.dev), © Star Federation, and icons from [Phosphor Icons](https://phosphoricons.com), © 2023 Phosphor Icons, both MIT licensed.
