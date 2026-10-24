-- Retired composer ids cannot be revived by a stale tab, even after a restart.
create table retired_drafts (id text not null primary key);

-- The cookie is valid only while this server-side session exists and has not expired.
create table admin_sessions (
  id text not null primary key,
  auth text not null,
  expires_at integer not null
);
create index admin_sessions_expiry on admin_sessions (expires_at);

-- One bounded throttle for the site's single admin account, independent of proxy/IP headers.
create table login_throttle (
  id integer not null primary key check (id = 1),
  started_at integer not null,
  attempts integer not null
);
