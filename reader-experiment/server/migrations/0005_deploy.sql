-- What the deploy knows about the Worker's secrets (DESIGN.md 12.3). Written only by CI (scripts/secrets.mjs), never
-- read by the Worker. One row: the Worker it is about and whether that Worker may hold DAYLIGHT_PAIRING. A v1 deploy
-- sets pairing = 1 before it uploads the pairing code; a deploy whose secret listing shows the Worker without it sets
-- 0. A Lab deploy whose listing keeps failing reads it, and fails only when the Worker may still hold the code.
CREATE TABLE deploy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  worker TEXT NOT NULL,                                                       -- daylight-<12 hex>
  pairing INTEGER NOT NULL,                                                   -- 1: may hold DAYLIGHT_PAIRING; 0: shown not to
  at INTEGER NOT NULL);                                                       -- when this was recorded (ms)
