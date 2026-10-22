# LogSpace

LogSpace is a personal website for your posts, pictures, and videos: a feed of text posts, photos, videos, and articles that you write and upload at `/admin`, with an RSS feed, link previews, and a sitemap. It's one small server app with a SQLite database, meant to run on a server of your own. See [logspace.app](https://logspace.app).

The app is in [`webapp/`](webapp/), built with [Remix 3](https://remix.run), and the scripts to deploy it are in [`scripts/`](scripts/).

## Running it locally

With Node 24:

```sh
cd webapp
npm ci
npm run hmr
```

Then open http://localhost:44100. To use `/admin`, create `webapp/.env` (ignored by git) with the admin secrets (see [Admin](#admin)), and keep the database and media outside the repo, so `git clean -x` can't delete them:

```sh
ADMIN_PASSWORD=<at least 16 characters>
AUTH_SESSION_SECRET=<at least 16 characters, e.g. from openssl rand -base64 32>
DATABASE_PATH=/path/outside/the/repo/app.sqlite
MEDIA_DIR=/path/outside/the/repo/media
```

`npm run dev` and `npm run hmr` load it. `npm test` runs the tests; see [`webapp/AGENTS.md`](webapp/AGENTS.md) for the rest of the commands and how the app is laid out.

## Deployment

LogSpace runs on a Linux server as a systemd service behind [Caddy](https://caddyserver.com), which gets its HTTPS certificates. On a fresh server with Node 24 and Caddy installed (as root), ports 80 and 443 (but not the app's port, 44100) open in the firewall, and your domain's DNS pointing at it:

```sh
git clone <repository URL> /root/work/logspace
cd /root/work/logspace/webapp && npm ci
/root/work/logspace/scripts/install.sh example.com www.example.com
/root/work/logspace/scripts/set-admin-password.sh
```

`scripts/install.sh` takes the site's domain, then any domains that should redirect to it. It installs `scripts/logspace.service` (running the app from the checkout it's in), creates `/etc/logspace.env` (see [Admin](#admin)) if it's missing, and replaces any existing site blocks for those domains in `/etc/caddy/Caddyfile` with ones made from `scripts/Caddyfile`. It saves the domains in `/etc/logspace.domains`, so later runs can leave them out.

The app listens on port 44100. To use another one (if something else on the server has it), set `PORT` in `/etc/logspace.env`, which overrides the service's default, and run `scripts/install.sh` again (without arguments), which restarts the app and points Caddy at the new port. Restarting the service alone would leave Caddy on the old one.

Then log in at `https://example.com/admin` to set up the site (see [Configuration](#configuration)).

To deploy updates:

```sh
cd /root/work/logspace && git pull
cd webapp && npm ci && systemctl restart logspace
```

When `scripts/logspace.service` or `scripts/Caddyfile` changes, or `PORT` in `/etc/logspace.env`, run `scripts/install.sh` again instead of restarting, so the new versions get installed. The server applies new database migrations when it starts. `journalctl -u logspace` has its logs.

### Configuration

What's particular to your site is set at `/admin/config`: its title, URL (for canonical URLs, the sitemap, the RSS feed, and share links), description, the home page's heading and subheading, a logo for the navbar (the title is shown without one), an icon (LogSpace's is used without one; the home screen icons, which can't be transparent, are on its most common color), and a social preview image for link previews, with its alt text. The title, URL, and description are required: until they're saved, every page sends visitors to the admin login (and the RSS feed, sitemap, `robots.txt`, and web app manifest aren't available), and logging in leads to `/admin/config`, so set them right after the first deploy. Settings are read again from the database in the background as requests come in, so a change made directly in it takes effect within a request or two. [`webapp/design/`](webapp/design/) has a template for making a social preview image.

### Posts

Posts are written and edited at `/admin`, and their photos and videos are uploaded there too. What a post is made of, and what the `/admin` form checks, is in [`webapp/docs/posts.md`](webapp/docs/posts.md).

### Database

Posts and the site's configuration are stored in a SQLite database. On the server it's `/var/lib/logspace/app.sqlite`, outside the repo so that `git clean -fdx` can't delete it; the service sets `DATABASE_PATH` to it (see `scripts/logspace.service`). Without `DATABASE_PATH` it's `webapp/db/app.sqlite` (ignored by git, but `git clean -x` still deletes it).

To back up the database, copy it with SQLite's online backup, which is safe while the server is running (copying the file directly can catch it mid-write). Install `sqlite3` with apt if it's missing:

```sh
sqlite3 /var/lib/logspace/app.sqlite ".backup '/root/app-$(date +%F).sqlite'"
```

### Media

Post media (photos, videos, posters, covers) and the site's logo, icon, and social preview image are uploaded at `/admin` and kept in media storage. On the server it's a folder, `/var/lib/logspace/media`, outside the repo like the database; the service sets `MEDIA_STORAGE=fs` and `MEDIA_DIR` (see `scripts/logspace.service`). Files in it are stored under hashed names by `remix/file-storage`, so don't add files to it by hand. Besides the uploaded files, it keeps the resized WebP copies of photos that pages show, made by [sharp](https://sharp.pixelplumbing.com) the first time each is asked for; the size and content hash of each photo are in the database's `post_images` table. Without `MEDIA_DIR` media goes in `webapp/media/` (ignored by git, but `git clean -x` deletes it).

Uploads are held in memory until they're saved, up to 100 MB a file and 200 MB per save (`MAX_UPLOAD_*` in `webapp/app/lib/constants.ts`), so the server needs that much memory free. Deleting a post in `/admin` deletes its files from media storage too.

Media storage can be an S3 or Cloudflare R2 bucket instead: set `MEDIA_STORAGE=s3` with `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION` (`auto` for R2), `MEDIA_S3_ENDPOINT` (for R2, `https://<account id>.r2.cloudflarestorage.com`), `MEDIA_S3_ACCESS_KEY_ID` and `MEDIA_S3_SECRET_ACCESS_KEY` (the last two in `/etc/logspace.env`). There's no tool yet to copy files from the folder to a bucket. The S3 backend reads a whole file into memory for every request, including each range request a video player makes, so check that's acceptable for the videos you have first.

To back up media, copy the folder, e.g. `cp -a /var/lib/logspace/media /root/media-$(date +%F)`.

### Admin

`/admin`, where you manage the site, is protected by a single password. It needs two secrets, which live in `/etc/logspace.env`, readable only by root and loaded by the service:

- `AUTH_SESSION_SECRET` signs the site's session cookies (for now just the admin one). `install.sh` generates it.
- `ADMIN_PASSWORD` is the admin password. Set it, or change it, with `scripts/set-admin-password.sh`, which reads it without echoing (so it stays out of shell history) and restarts the service.

Both must be at least 16 characters, or `/admin` stays switched off. Use a long random password from a password manager. Changing either one logs out every browser.
