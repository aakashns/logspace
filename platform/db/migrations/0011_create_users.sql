-- Accounts, as better-auth's `user` and `verification` tables have them (with this database's
-- plural, snake_case names, and dates as UTC ISO text). For now everyone signs up by subscribing
-- at /subscribe. better-auth's `session` and `account` tables come with logging in: an account row
-- is for a password or another site's login, and an email code needs neither.

-- Someone with an account, made once they've entered the code emailed to them.
create table users (
  id text not null primary key,
  name text not null,
  -- Lowercased.
  email text not null unique,
  email_verified integer not null default 0,
  image text,
  created_at text not null,
  updated_at text not null
);

-- A code emailed to someone, waiting to be entered. `identifier` says what it's for and who to,
-- like 'sign-up-otp-ada@example.com', and `value` is what the code proves, as JSON: for signing
-- up, the code's SHA-256 hash, the name typed, and how many wrong codes have been tried.
create table verifications (
  id text not null primary key,
  identifier text not null,
  value text not null,
  expires_at text not null,
  created_at text not null,
  updated_at text not null
);
create index verifications_identifier on verifications (identifier);
