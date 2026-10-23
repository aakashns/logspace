-- The size of each of a post's images in media storage, and a hash of its contents, read from the
-- file when it's saved (see savePostFile in app/data/media.ts). Pages use them to reserve an image's
-- space before it loads, and to put the hash in its URLs so browsers can keep it for good. There's
-- no foreign key to posts: a new post's files are saved before the post is.
create table post_images (
  post_id text not null,
  name text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  version text not null,
  primary key (post_id, name)
);
