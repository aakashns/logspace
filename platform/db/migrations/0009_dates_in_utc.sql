-- Post dates are UTC, like 2026-10-16T13:12:00Z, rather than local times with a UTC offset like
-- 2026-10-16T18:42:00+05:30. SQLite reads the offset and converts.
update posts set date = strftime('%Y-%m-%dT%H:%M:%SZ', date);
