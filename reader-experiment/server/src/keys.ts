// The server's identity: the seed from DAYLIGHT_SERVER_CODE (or, for v1 delivery, from DAYLIGHT_PAIRING), the values
// derived from it, and the delivery mode (DESIGN.md 3.1, 3.2, 5.1).

import { parsePairing, deriveKeys, encryptFrame, decryptFrame, normalizeRelay } from '../../share/js/daylight-share.js';
import {
  parseServerCode, deriveServerSeed, deriveServerValues, serverItemId, sealBox, openBox,
} from '../client/daylight-server.js';
import type { Env } from './env.ts';
import { ServerError } from './errors.ts';

export type Values = Awaited<ReturnType<typeof deriveServerValues>>;
type PairingKeys = Awaited<ReturnType<typeof deriveKeys>>;
export type Header = Record<string, unknown>;

export interface Delivery {
  mode: 'lab' | 'v1';
  topic: string;
  ackTopic: string;
  seal: (header: Header, body: Uint8Array, nonce?: Uint8Array) => Promise<Uint8Array>;
  openAck: (frame: Uint8Array) => Promise<Header>;
}

export interface Identity {
  seed: Uint8Array;
  values: Values;
  relay: string;
  relayToken: string;
  delivery: Delivery;
  emailAddress: string | null;
  serverUrl: string;
  /** Set when the secrets disagree (v1 delivery with a Server code of another pairing). */
  warning: string | null;
  itemId: (origin: string) => Promise<string>;
}

let cache: { key: string; id: Promise<Identity> } | null = null;

/** The server origin the deploy set (SERVER_URL), without a trailing slash; '' when unknown. */
export function serverOrigin(env: Env): string {
  try { return env.SERVER_URL ? new URL(env.SERVER_URL).origin : ''; } catch { return ''; }
}

export function emailAddressFor(env: Env, values: Values): string | null {
  const domain = (env.DAYLIGHT_EMAIL_DOMAIN ?? '').trim().toLowerCase();
  if (!domain) return null;
  const local = (env.DAYLIGHT_EMAIL_LOCAL ?? '').trim().toLowerCase();
  const name = /^[a-z0-9][a-z0-9.-]{2,39}$/.test(local) ? local : `daylight-${values.emailToken}`;
  return `${name}@${domain}`;
}

async function build(env: Env): Promise<Identity> {
  const wantsV1 = (env.DELIVERY ?? 'lab') === 'v1' && !!env.DAYLIGHT_PAIRING;
  let seed: Uint8Array;
  let relay: string;
  let relayToken = (env.NTFY_TOKEN ?? '').trim();
  let pairingKeys: PairingKeys | null = null;
  let warning: string | null = null;
  if (wantsV1) {
    const pairing = await parsePairing(env.DAYLIGHT_PAIRING!);
    seed = await deriveServerSeed(pairing.secret);
    relay = pairing.relay;
    pairingKeys = await deriveKeys(pairing.secret);
    if (env.DAYLIGHT_SERVER_CODE) {
      try {
        const sc = await parseServerCode(env.DAYLIGHT_SERVER_CODE);
        if (sc.seed.some((b: number, i: number) => b !== seed[i])) warning = 'DAYLIGHT_PAIRING and DAYLIGHT_SERVER_CODE belong to different pairings';
        if (!relayToken && sc.token) relayToken = sc.token;
      } catch { warning = 'DAYLIGHT_SERVER_CODE does not parse'; }
    }
  } else {
    if (!env.DAYLIGHT_SERVER_CODE) throw new ServerError(503, 'NOT_CONFIGURED', { missing: ['DAYLIGHT_SERVER_CODE'] });
    let sc;
    try { sc = await parseServerCode(env.DAYLIGHT_SERVER_CODE); } catch {
      throw new ServerError(503, 'NOT_CONFIGURED', { missing: ['DAYLIGHT_SERVER_CODE'] });
    }
    seed = sc.seed;
    relay = sc.relay;
    if (!relayToken && sc.token) relayToken = sc.token;
  }
  const values = await deriveServerValues(seed, { emailSalt: env.DAYLIGHT_EMAIL_SALT ?? '' });
  const delivery: Delivery = pairingKeys
    ? {
      mode: 'v1',
      topic: pairingKeys.inboxTopic,
      ackTopic: pairingKeys.ackTopic,
      seal: (h, b, n) => encryptFrame(pairingKeys!, 'inbox', h, b as never, n as never),
      openAck: async (f) => (await decryptFrame(pairingKeys!, 'ack', f as never)).header,
    }
    : {
      mode: 'lab',
      topic: values.itemTopic,
      ackTopic: values.ackTopic,
      seal: (h, b, n) => sealBox(values, 'item', h, b as never, n as never),
      openAck: async (f) => (await openBox(values, 'ack', f as never)).header,
    };
  return {
    seed, values, relay: normalizeRelay(relay), relayToken, delivery, warning,
    emailAddress: emailAddressFor(env, values),
    serverUrl: serverOrigin(env),
    itemId: (origin) => serverItemId(seed, origin),
  };
}

/** The identity for this env, built once per isolate (and again when a secret changes). */
export function identity(env: Env): Promise<Identity> {
  const key = [env.DAYLIGHT_SERVER_CODE, env.DAYLIGHT_PAIRING, env.DELIVERY, env.DAYLIGHT_EMAIL_DOMAIN, env.DAYLIGHT_EMAIL_LOCAL,
    env.DAYLIGHT_EMAIL_SALT, env.NTFY_TOKEN, env.SERVER_URL].join('\u0001');
  if (!cache || cache.key !== key) {
    const id = build(env);
    cache = { key, id };
    id.catch(() => { if (cache?.id === id) cache = null; });
  }
  return cache.id;
}
