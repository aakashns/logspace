-- Browsers that get a notification of each new post, each by its subscription with its push
-- service (Apple's, Google's, Mozilla's, or Microsoft's), as PushSubscription.toJSON() gives it.
create table push_subscriptions (
  -- Where the push service takes messages for the browser, which says who it is.
  endpoint text not null primary key,
  -- The browser's P-256 public key and 16-byte secret, base64url, which messages are encrypted
  -- for.
  p256dh text not null,
  auth text not null,
  -- The site's public key it subscribed with (see src/lib/web-push.ts). One made with a key the
  -- site no longer has can't be sent to.
  application_server_key text not null,
  created_at text not null,
  -- The last notification sent to it: when, and why it wasn't taken, with how many in a row
  -- weren't, if it wasn't.
  last_sent_at text,
  last_error text,
  failures integer not null default 0
);
