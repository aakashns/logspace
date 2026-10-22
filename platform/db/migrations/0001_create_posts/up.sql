-- One row per post. The fields every post has get their own columns; the rest of the post (its
-- photos, video, or article) is JSON in `details`, in the same shape as posts.json.
create table posts (
  id text primary key not null check (length(id) = 10),
  type text not null check (type in ('text', 'photos', 'video', 'article')),
  date text not null,
  city text,
  caption text,
  details text not null default '{}' check (json_valid(details)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
