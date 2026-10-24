-- Posts are text, photos, or a video: articles and their Markdown bodies are gone (no site has
-- any). SQLite can't change a check constraint, so the table is made again without them.
create table new_posts (
  id text primary key not null check (length(id) = 10),
  type text not null check (type in ('text', 'photos', 'video')),
  date text not null,
  city text,
  caption text,
  details text not null default '{}' check (json_valid(details)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

insert into new_posts (id, type, date, city, caption, details, created_at, updated_at)
select id, type, date, city, caption, details, created_at, updated_at from posts;

drop table posts;

alter table new_posts rename to posts;
