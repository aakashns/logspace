-- Push notifications are gone (0.7.15 had them, as 0012, which has no file now): the table of
-- browsers subscribed, and the switch for the bell, saved in config.
drop table if exists push_subscriptions;

delete from config where key = 'pushNotifications';
