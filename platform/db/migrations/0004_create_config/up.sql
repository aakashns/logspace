-- The site's configuration, set at /admin/config: one row per setting that's been saved, keyed
-- by the setting's name (see app/data/config.ts). A setting without a row has its default.
create table config (
  key text primary key not null,
  value text not null
);
