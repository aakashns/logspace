# Posts

Posts appear on the home page, newest first, and each one has its own page at `/posts/<id>`.
They're written and edited at `/admin` and stored in the database; their media (photos, videos,
posters, covers) is stored in media storage, under keys like `posts/<id>/photo.jpg`. This is what a
post is made of. The edit post form has these fields and checks them the same way
(`parsePostRecord` in `src/domain/post.ts`), and the test posts in `test/content/posts.json` are written
in this format.

New posts are written in the composer at `/admin/posts/new` (the navbar's plus, once logged in),
which works like X's: type the caption, add photos, a video, or an article (a Markdown file) with
the toolbar's buttons, and the post shows below as it'll look. The type follows from the media,
media is uploaded as it's chosen, and the × by the heading discards the post and what was uploaded
for it. The post is dated when it's posted, at the browser's UTC offset, and each photo's alt text
is its file name; change those on its edit page.

Every post has:

- `id`: 10 random lowercase letters and digits, e.g. `"fc7p7vjhx6"`, made by the composer.
  It's the post's URL (`/posts/fc7p7vjhx6`), and it can't be changed.
- `type`: `"text"`, `"photos"`, `"video"`, or `"article"` (see below). It can't be changed once
  the post is published.
- `date`: when it was posted, with your UTC offset, e.g. `"2026-10-16T18:42:00+05:30"`. Posts
  show this local time.
- `city` (optional): shown after the date, e.g. `"Bengaluru"`.
- `caption`: the text above the media. Optional except for text posts. It's Markdown (`**bold**`,
  `_italic_`, `[links](https://…)`, lists, quotes), except that every `\n` is a line break and
  `\n\n` starts a new paragraph. URLs become links, and HTML is shown as text.

Media is given by the name of one of the post's files, like `photo.jpg`. In the edit form, each
media field also takes a file to upload: it's saved as one of the post's files under its own name (with
dashes for spaces), replacing any file of that name, and the field takes that name. Only photos and
videos can be uploaded.

A photo's size is read from its file when it's saved, so the page reserves its space before it
loads and nothing jumps around. Pages show photos (in posts, covers, and article bodies) resized to
fit the screen, as WebP, and video posters resized to fit the column; the file as uploaded is what
link previews show and article links open.

## text

Just a caption, like a tweet. If it contains a link, the first link gets a preview card with the
page's title, description, and image. Previews are fetched in the background the first time a
link is seen and cached in `link-previews.json` in `CACHE_DIR`; until then the card shows just the domain.

```json
{
  "id": "fc7p7vjhx6",
  "type": "text",
  "date": "2026-10-16T18:42:00+05:30",
  "caption": "Hello! https://remix.run"
}
```

## photos

One or more photos. The feed shows up to four in a grid (and "+N" for the rest); the post page
shows them all. The composer's photo button, and the edit form's Add photos field, take any number
at once and add them after the others. A name a post already has gets a number added
(`image-2.jpg`).

```json
"photos": [{ "file": "hike-1.jpg", "alt": "River in a valley" }]
```

## video

A single video, with an optional `poster` image shown before it plays. Without a poster, phones
show a black box until the video is played. Its `width` and `height` (in pixels) are optional, and
default to the poster's size; with a size, the page reserves space for the video before it loads.

```json
"video": { "file": "clip.mp4", "poster": "clip.jpg", "width": 1920, "height": 1080 }
```

## article

A Markdown article. The feed shows a card with the title, summary, and optional cover image. Its
`body` is stored in its own database column, for search.

```json
"article": {
  "title": "A year of building in public",
  "summary": "One or two sentences for the card and search results.",
  "body": "Notes from a year of weekly updates…",
  "cover": { "file": "cover.jpg", "alt": "Laptop on a desk" }
}
```

In the body, images and links can use the names of the post's files; upload them with the
composer's Upload files link (which lists the files the body uses, and which are missing) or the
edit form's field for the body's files. In the composer, a `# Title` heading at the top of the
Markdown file becomes the title. An image on its own line is shown full width, and if it's a video
(`.mp4`, `.webm`, `.mov`, `.m4v`) it becomes a video player, with the image of the same name as its
poster (`clip.mp4` uses `clip.jpg`):

```markdown
![My desk](desk.jpg)

![A short clip](clip.mp4)
```

HTML in the Markdown is shown as text, not rendered.

## Tips

- Upload photos at full size: pages show copies resized to fit each screen. JPEG, PNG, WebP, and
  AVIF photos are resized; others (like GIFs) are shown as they are.
- A file's type is set from its extension, so keep the usual extensions (`.jpg`, `.png`, `.mp4`,
  …).
- Use MP4 (H.264) for videos so they play everywhere.
- Uploads can be up to 100 MB each and 120 MB in one save (`MAX_UPLOAD_*` in
  `src/domain/constants.ts`); upload bigger sets over more than one save.
- A post's files are only served once it's published (the composer shows them from `/admin`).
  In the composer, taking media out (or replacing it) deletes its file, and discarding the post
  deletes them all; a new post that's left without being published or discarded leaves its files
  unserved in storage.
- Replacing a file under a new name leaves the old one in storage. Deleting a post deletes all its
  files.
