# Posts

Posts appear on the home page, newest first, and each one has its own page at `/posts/<id>`.
They're written and edited at `/admin` and stored in the database; their media (photos, videos,
posters, covers) is stored in media storage, under keys like `posts/<id>/photo.jpg`. This is what a
post is made of. The `/admin` post form has these fields and checks them the same way
(`parsePostRecord` in `app/data/posts/model.ts`), and the test posts in `test/content/posts.json` are written
in this format.

Every post has:

- `id`: 10 random lowercase letters and digits, e.g. `"fc7p7vjhx6"`, made by the new post form.
  It's the post's URL (`/posts/fc7p7vjhx6`), and it can't be changed.
- `type`: `"text"`, `"photos"`, `"video"`, or `"article"` (see below). It can't be changed once
  the post is published.
- `date`: when it was posted, with your UTC offset, e.g. `"2026-10-16T18:42:00+05:30"`. Posts
  show this local time.
- `city` (optional): shown after the date, e.g. `"Bengaluru"`.
- `caption`: the text above the media. Optional except for text posts. It's Markdown (`**bold**`,
  `_italic_`, `[links](https://…)`, lists, quotes), except that every `\n` is a line break and
  `\n\n` starts a new paragraph. URLs become links, and HTML is shown as text.

Media is given by the name of one of the post's files, like `photo.jpg`. In the form, each media
field also takes a file to upload: it's saved as one of the post's files under its own name (with
dashes for spaces), replacing any file of that name, and the field takes that name. Only photos and
videos can be uploaded.

A photo's size is read from its file when it's saved, so the page reserves its space before it
loads and nothing jumps around. Pages show photos (in posts, covers, and article bodies) resized to
fit the screen, as WebP, and video posters resized to fit the column; the file as uploaded is what
link previews show and article links open.

## text

Just a caption, like a tweet. If it contains a link, the first link gets a preview card with the
page's title, description, and image. Previews are fetched in the background the first time a
link is seen and cached in `tmp/link-previews.json`; until then the card shows just the domain.

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
shows them all. The form's Add photos field takes any number at once and adds them after the
others.

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

In the body, images and links can use the names of the post's files; upload them with the form's
field for the body's files. An image on its own line is shown full width, and if it's a video
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
  `app/lib/constants.ts`); upload bigger sets over more than one save.
- A post's files are only served once it's published. Files uploaded with a form that wasn't saved
  are kept, so the form comes back with their names filled in, but a new post that's never
  published leaves them unserved in storage.
- Replacing a file under a new name leaves the old one in storage. Deleting a post deletes all its
  files.
