-- A record of each POST /v1/ai reservation until it is settled (DESIGN.md 9.3, 9.5). A call cut short between the
-- reservation and the settlement (Cloudflare ended the request: a CPU kill, or the client went away for longer than
-- waitUntil's 30 s) leaves its hold behind; the first Cron run after `until` keeps it as spent, exactly once.
CREATE TABLE holds (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,                                                          -- the usage day it was reserved on
  micros INTEGER NOT NULL,                                                    -- the reservation (worst case)
  until INTEGER NOT NULL);                                                    -- after this (ms) the call can't still be running
