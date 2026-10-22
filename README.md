# LogSpace

LogSpace is a personal website for your posts, pictures, and videos: a feed of text posts, photos, videos, and articles that you write and upload at `/admin`, with an RSS feed, link previews, and a sitemap. It's one small server app with a SQLite database, meant to run on a server of your own. See [logspace.app](https://logspace.app).

The app is in [`platform/`](platform/), built with [Remix 3](https://remix.run) on [Bun](https://bun.com). Each [release](https://github.com/aakashns/logspace/releases) has it as a single binary for Linux and macOS, which also sets up a server to run it. Every change merged to `main` is released, with the version in [`platform/package.json`](platform/package.json), which each pull request bumps: below 1.0, the minor version for breaking changes and the patch version for others.

## Running it locally

With Bun 1.4.4 or later:

```sh
cd platform
bun install
bun run dev
```

Then open http://localhost:44100. To use `/admin`, create `platform/.env` (ignored by git) with the admin secrets (see [Admin](#admin)), and keep the database and media outside the repo, so `git clean -x` can't delete them:

```sh
ADMIN_PASSWORD=<at least 16 characters>
AUTH_SESSION_SECRET=<at least 16 characters, e.g. from openssl rand -base64 32>
DATABASE_PATH=/path/outside/the/repo/app.sqlite
MEDIA_DIR=/path/outside/the/repo/media
```

Bun loads it. `bun run dev` restarts the server when a file changes; reload the page to see the change. `bun run test` runs the tests, and `bun run build` builds the binary for your machine in `platform/dist/logspace`; see [`platform/AGENTS.md`](platform/AGENTS.md) for the rest of the commands and how the app is laid out.

The binary runs on its own, configured by the same environment variables (it doesn't read `.env`); without `DATABASE_PATH`, `MEDIA_DIR`, and `CACHE_DIR`, it keeps its data in `data/` in the folder it's run from. `logspace help` lists them, and the binary's commands: `logspace` (or `logspace start`) starts the server, and the others are below.

## Deployment

LogSpace runs on a Linux server (x64 or arm64, with glibc) as a systemd service behind [Caddy](https://caddyserver.com), which gets its HTTPS certificates. On a fresh server with Caddy installed (as root), ports 80 and 443 (but not the app's port, 44100) open in the firewall, and your domain's DNS pointing at it, download the latest release for the server's CPU (`linux-x64` or `linux-arm64`) and set it up:

```sh
curl -fsSL -o logspace https://github.com/aakashns/logspace/releases/latest/download/logspace-linux-x64
chmod +x logspace
./logspace setup example.com www.example.com
```

`logspace setup` takes the site's domain, then any domains that should redirect to it. It installs the binary at `/usr/local/bin/logspace` (so the downloaded copy can be deleted after) and a systemd service, `logspace`, to run it, creates `/etc/logspace.env` (see [Admin](#admin)) if it's missing, asks for the admin password if there isn't one yet, and replaces any existing site blocks for those domains in `/etc/caddy/Caddyfile` with its own. It saves the domains in `/etc/logspace.domains`, so later runs can leave them out.

The app listens on port 44100. To use another one (if something else on the server has it), set `PORT` in `/etc/logspace.env`, which overrides the service's default, and run `logspace setup` again (without arguments), which restarts the app and points Caddy at the new port. Restarting the service alone would leave Caddy on the old one.

Then log in at `https://example.com/admin` to set up the site (see [Configuration](#configuration)).

To deploy an update, run `logspace upgrade`. It downloads the latest release (or the one given, like `logspace upgrade 0.2.0`), checks it against the release's `SHA256SUMS`, replaces `/usr/local/bin/logspace` with it, and runs its `setup`, which installs its service file and restarts the app. It asks first, unless given `--yes`. It won't go back to an earlier release, since the database may have changed in ways an earlier one doesn't know.

The server applies new database migrations when it starts. To see what they'll be before restarting it, run `logspace migrate --dry-run`, and to apply them without starting it, `logspace migrate` (both as root, for the service's database; elsewhere, they use the database `logspace start` would). `journalctl -u logspace` has its logs, and `logspace version` says which release is installed. The binary loads [sharp](https://sharp.pixelplumbing.com)'s image library from a temporary copy when it starts, so if the server's `/tmp` doesn't allow running code (`noexec`), set `TMPDIR` in `/etc/logspace.env` to a folder that does.

### Configuration

What's particular to your site is set at `/admin/config`: its title, URL (for canonical URLs, the sitemap, the RSS feed, and share links), description, the home page's heading and subheading, a logo for the navbar (the title is shown without one), an icon (LogSpace's is used without one; the home screen icons, which can't be transparent, are on its most common color), and a social preview image for link previews, with its alt text. The title, URL, and description are required: until they're saved, every page sends visitors to the admin login (and the RSS feed, sitemap, `robots.txt`, and web app manifest aren't available), and logging in leads to `/admin/config`, so set them right after the first deploy. Settings are read again from the database in the background as requests come in, so a change made directly in it takes effect within a request or two. [`platform/design/`](platform/design/) has a template for making a social preview image.

### Posts

Posts are written and edited at `/admin`, and their photos and videos are uploaded there too. What a post is made of, and what the `/admin` form checks, is in [`platform/docs/posts.md`](platform/docs/posts.md).

### Database

Posts and the site's configuration are stored in a SQLite database. On the server it's `/var/lib/logspace/app.sqlite`; the service sets `DATABASE_PATH` to it (see [`platform/binary/setup.ts`](platform/binary/setup.ts)). Without `DATABASE_PATH` it's `platform/db/app.sqlite` when running from the repo (ignored by git, but `git clean -x` still deletes it), or `data/app.sqlite` in the folder the binary is run from.

To back up the database, copy it with SQLite's online backup, which is safe while the server is running (copying the file directly can catch it mid-write). Install `sqlite3` with apt if it's missing:

```sh
sqlite3 /var/lib/logspace/app.sqlite ".backup '/root/app-$(date +%F).sqlite'"
```

### Media

Post media (photos, videos, posters, covers) and the site's logo, icon, and social preview image are uploaded at `/admin` and kept in media storage. On the server it's a folder, `/var/lib/logspace/media`, next to the database; the service sets `MEDIA_STORAGE=fs` and `MEDIA_DIR` (see [`platform/binary/setup.ts`](platform/binary/setup.ts)). Files in it are stored under hashed names by `remix/file-storage`, so don't add files to it by hand. Besides the uploaded files, it keeps the resized WebP copies of photos that pages show, made by [sharp](https://sharp.pixelplumbing.com) the first time each is asked for; the size and content hash of each photo are in the database's `post_images` table. Without `MEDIA_DIR` media goes in `platform/media/` when running from the repo (ignored by git, but `git clean -x` deletes it), or `data/media/` in the folder the binary is run from.

Uploads are held in memory until they're saved, up to 100 MB a file and 120 MB per save (`MAX_UPLOAD_*` in `platform/app/lib/constants.ts`), so the server needs that much memory free. Deleting a post in `/admin` deletes its files from media storage too.

Media storage can be an S3 or Cloudflare R2 bucket instead: set `MEDIA_STORAGE=s3` with `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION` (`auto` for R2), `MEDIA_S3_ENDPOINT` (for R2, `https://<account id>.r2.cloudflarestorage.com`), `MEDIA_S3_ACCESS_KEY_ID` and `MEDIA_S3_SECRET_ACCESS_KEY` (the last two in `/etc/logspace.env`). There's no tool yet to copy files from the folder to a bucket. The S3 backend reads a whole file into memory for every request, including each range request a video player makes, so check that's acceptable for the videos you have first.

To back up media, copy the folder, e.g. `cp -a /var/lib/logspace/media /root/media-$(date +%F)`.

### Admin

`/admin`, where you manage the site, is protected by a single password. It needs two secrets, which live in `/etc/logspace.env`, readable only by root and loaded by the service:

- `AUTH_SESSION_SECRET` signs the site's session cookies (for now just the admin one). `logspace setup` generates it.
- `ADMIN_PASSWORD` is the admin password. `logspace setup` asks for it the first time, and `logspace set-admin-password` changes it. Both read it without echoing (so it stays out of shell history), and `set-admin-password` restarts the service.

Both must be at least 16 characters, or `/admin` stays switched off. Use a long random password from a password manager. Changing either one logs out every browser.
