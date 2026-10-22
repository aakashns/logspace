# LogSpace

Self-host your personal website with blog posts, photos, and videos. Write and publish from your browser. Deploy to your own domain. Free and open source.

[Website & demo](https://logspace.app) · [Changelog](https://github.com/aakashns/logspace/releases) · [Contributing](CONTRIBUTING.md)

## Deploy

You need a Linux server (Ubuntu or Debian, x64 or arm64), [Caddy](https://caddyserver.com/docs/install) installed, and a domain pointing to the server. Open ports 80 and 443; keep port 44100 private.

```sh
curl -fsSL https://logspace.app/install.sh | sh
sudo logspace setup example.com www.example.com
```

Replace the domains with yours. Setup asks for an admin password, starts LogSpace, enables HTTPS, and redirects the second domain to the first. The installer also supports macOS for local use.

## Publish

1. Open `https://example.com/admin` and log in.
2. Save your site title, URL, and description. Add a welcome message, logo, and icon if you like. Your site becomes public once these settings are saved.
3. Choose **New Post**, pick text, photos, video, or article, and publish. Return to `/admin` to edit posts or change settings.

Write in Markdown and upload media directly. Every post has its own link; readers can follow along with RSS. Light and dark themes are built in.

## Updates and backups

```sh
sudo logspace upgrade              # Install the latest release
sudo logspace set-admin-password   # Change your password
journalctl -u logspace             # View server logs
```

Back up before upgrading. On the server, with `sqlite3` installed:

```sh
sudo sqlite3 /var/lib/logspace/app.sqlite ".backup '/root/logspace-backup.sqlite'"
sudo cp -a /var/lib/logspace/media /root/logspace-media-backup
```

Use a fresh destination for each backup, avoid publishing or deleting posts while backing up, and keep a copy off the server. Protect a copy of `/etc/logspace.env` too; it contains your admin secrets. See `logspace help` for configuration options.

## Contribute

[Report a bug](https://github.com/aakashns/logspace/issues) or read [CONTRIBUTING.md](CONTRIBUTING.md) to work on the app or website. Licensed under [MIT](LICENSE).
