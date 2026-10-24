-- Retired composer ids cannot be revived by a stale tab, even after a restart.
create table retired_drafts (id text not null primary key);

-- The cookie is valid only while this server-side session exists and has not expired.
create table admin_sessions (
  id text not null primary key,
  auth text not null,
  expires_at integer not null
);
create index admin_sessions_expiry on admin_sessions (expires_at);
