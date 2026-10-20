-- The Daylight server's state (DESIGN.md 11.1). Applied by the deploy with `wrangler d1 migrations apply`.
CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);                 -- JSON values: digest, ai, lock, cursors, inbox
CREATE TABLE usage (
  day TEXT NOT NULL, kind TEXT NOT NULL,                                      -- 'YYYY-MM-DD'; ai | email_in | email_items | ntfy_msgs | feed_items
  n INTEGER NOT NULL DEFAULT 0, usd_micros INTEGER NOT NULL DEFAULT 0, reserved_micros INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind));
CREATE TABLE outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, token TEXT NOT NULL UNIQUE, fp TEXT NOT NULL,
  origin TEXT NOT NULL, kind TEXT NOT NULL, title TEXT, parts INTEGER NOT NULL, bytes INTEGER NOT NULL,
  state TEXT NOT NULL,                                                        -- queued | sent | delivered | expired | rejected
  created INTEGER NOT NULL, last_publish INTEGER NOT NULL DEFAULT 0, next_part INTEGER NOT NULL DEFAULT 0,
  publishes INTEGER NOT NULL DEFAULT 0, error TEXT);
CREATE INDEX outbox_state ON outbox(state, last_publish);
CREATE TABLE frames (item_id TEXT NOT NULL, i INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (item_id, i));  -- base64, <= 1 MiB chunk each
CREATE TABLE files (                                                          -- hosted large files (bytes in R2 f/)
  id TEXT PRIMARY KEY, fp TEXT NOT NULL, n INTEGER NOT NULL, stored TEXT NOT NULL DEFAULT '[]',
  bytes INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE feeds (
  id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT, site TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('each', 'digest')),
  etag TEXT, last_modified TEXT, next_check INTEGER NOT NULL, last_check INTEGER, last_ok INTEGER,
  errors INTEGER NOT NULL DEFAULT 0, last_error TEXT, floods INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
  new_day TEXT, new_today INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, checked_by_user INTEGER NOT NULL DEFAULT 0);
CREATE INDEX feeds_due ON feeds(paused, next_check);
CREATE TABLE entries (
  feed_id TEXT NOT NULL, key TEXT NOT NULL, url TEXT, title TEXT, author TEXT, published INTEGER, excerpt TEXT,
  first_seen INTEGER NOT NULL,
  state TEXT NOT NULL,                                                        -- baseline | pending | digest | sent | digested | skipped
  item_id TEXT, sent_day TEXT,
  PRIMARY KEY (feed_id, key));
CREATE INDEX entries_state ON entries(state, first_seen);
CREATE TABLE mail (
  id TEXT PRIMARY KEY, received INTEGER NOT NULL, from_addr TEXT, from_domain TEXT, from_name TEXT, subject TEXT,
  size INTEGER NOT NULL,
  state TEXT NOT NULL,                                                        -- queued | running | done | dropped | waiting-paid | failed
  reason TEXT, attempts INTEGER NOT NULL DEFAULT 0, lease INTEGER NOT NULL DEFAULT 0, items TEXT, sent TEXT);
CREATE INDEX mail_state ON mail(state, received);
CREATE INDEX mail_from ON mail(from_addr, received);
CREATE INDEX mail_domain ON mail(from_domain, received);
CREATE TABLE blocked (pattern TEXT PRIMARY KEY, added INTEGER NOT NULL);
CREATE TABLE sources (
  id TEXT PRIMARY KEY, fp TEXT NOT NULL, type TEXT NOT NULL,                  -- 'pdf' (parts in R2 a/) | 'text' (in `text`)
  name TEXT, title TEXT, url TEXT, text TEXT, n INTEGER NOT NULL DEFAULT 0, validated TEXT NOT NULL DEFAULT '[]',
  bytes INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, op TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, lease INTEGER NOT NULL DEFAULT 0, reserved_micros INTEGER NOT NULL,
  reserved_day TEXT, input TEXT NOT NULL,                                     -- <= 64 KiB JSON; long text is a source
  result TEXT, error TEXT, delivered TEXT, expires INTEGER NOT NULL);
CREATE INDEX jobs_state ON jobs(state, created);
CREATE TABLE log (t INTEGER NOT NULL, code TEXT NOT NULL);                    -- last 200 error codes, nothing else
