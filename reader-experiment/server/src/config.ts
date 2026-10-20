// Discovery: the encrypted config frame on the server's config topic (DESIGN.md 4).

import { buildConfigFrame, openBox, SERVER_API } from '../client/daylight-server.js';
import type { Ctx } from './env.ts';
import { iso, randomHex, utcDay, HOUR, MIN } from './env.ts';
import type { Identity } from './keys.ts';
import { publishFrame, poll } from './relay.ts';
import type { Settings, ConfigState } from './settings.ts';
import { relayAfter, saveStmt } from './settings.ts';

/** The 6-hour slot a config publish belongs to (00:03, 06:03, 12:03, 18:03 UTC). */
export const configSlot = (now: number) => Math.floor((now - 3 * MIN) / (6 * HOUR));

export function configDue(id: Identity, s: Settings, now: number): boolean {
  if (!id.serverUrl) return false;
  const c = s.config;
  if (!c) return true;
  if (c.origin !== id.serverUrl || c.delivery !== id.delivery.mode) return true;
  if (c.status < 200 || c.status >= 300) return now - c.at >= 10 * MIN;
  return configSlot(now) !== c.slot;
}

/** Publishes the config frame. -> {status, id} and the settings to store. */
export async function publishConfig(ctx: Ctx, id: Identity, s: Settings): Promise<ConfigState> {
  const frameId = randomHex(16);
  const frame = await buildConfigFrame(id.values, {
    id: frameId, sent: iso(ctx.now), server: id.serverUrl, api: SERVER_API, fingerprint: id.values.fingerprint, delivery: id.delivery.mode,
  });
  const r = await publishFrame(ctx, id, id.values.configTopic, frame);
  const config: ConfigState = { slot: configSlot(ctx.now), origin: id.serverUrl, delivery: id.delivery.mode, at: ctx.now, status: r.status, id: frameId };
  const relay = relayAfter(s.relay, r.status, ctx.now, r.ok);
  await ctx.db.batch([
    saveStmt(ctx, { config, relay }),
    // Config frames count against the server's daily ntfy budget too (5.3).
    ctx.db.stmt(`INSERT INTO usage (day, kind, n) VALUES (?, 'ntfy_msgs', ?) ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n`, utcDay(ctx.now), r.ok ? 1 : 0),
  ]);
  s.config = config; s.relay = relay;
  return config;
}

/** POST /v1/admin/announce: publish now and poll the topic once to prove the Worker reaches the relay. */
export async function announce(ctx: Ctx, id: Identity, s: Settings): Promise<{ published: number; listed: boolean }> {
  const c = await publishConfig(ctx, id, s);
  let listed = false;
  try {
    const entries = await poll(ctx, id, id.values.configTopic, 'all', 50);
    for (const e of entries) {
      if (!e.frame) continue;
      try {
        const { header } = await openBox(id.values, 'config', e.frame);
        if (header.id === c.id) { listed = true; break; }
      } catch { /* junk */ }
    }
  } catch { listed = false; }
  return { published: c.status, listed };
}
