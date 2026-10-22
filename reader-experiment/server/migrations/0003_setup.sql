-- Setup without the DAYLIGHT_SERVER_CODE secret (DESIGN.md 3.5). The deploy keeps one row here: the Worker's name
-- (random, daylight-<12 hex>) and, until an app uses it, the one-time setup link it reads from Cloudflare. The app that
-- is given the link sends its Server code, which the Worker keeps here in place of the secret.
CREATE TABLE setup (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  worker TEXT NOT NULL,                                                       -- daylight-<12 hex>
  link TEXT,                                                                  -- https://<worker host>/setup#SETUP-…; NULL once used
  code TEXT,                                                                  -- the Server code an app sent; NULL until then
  created INTEGER NOT NULL,                                                   -- when this link was made (ms)
  claimed INTEGER);                                                           -- when an app used it (ms)
