-- Indexes that keep reads bounded (DESIGN.md 11.1, 15.2).
-- mail(received): the hourly cleanup and "Recent mail" (newest 30) read only the rows they need.
CREATE INDEX mail_received ON mail(received);
-- entries(feed_id, state, sent_day): a feed's articles sent today, for the feed list and 'each' sending, without
-- visiting every 'sent' entry of every feed (up to 180 days of them).
CREATE INDEX entries_sent ON entries(feed_id, state, sent_day);
