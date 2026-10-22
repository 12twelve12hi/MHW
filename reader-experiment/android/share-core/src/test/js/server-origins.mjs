// Reads server addresses as the JS reference does, for ServerVectorsTest.hostsMatchWhatwg.
//   node server-origins.mjs <daylight-server.js> <json file: [address, …]>
//   -> prints [{config, manual}] in the same order: `config` is checkConfig's `server` for a config frame naming the
//      address (null when it refuses it); `manual` is the origin setManualUrl would store (null when it refuses it).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [, , lib, file] = process.argv;
const ds = await import(pathToFileURL(lib).href);
const sent = '2026-10-22T10:00:00.000Z';
const out = JSON.parse(readFileSync(file, 'utf8')).map((server) => {
  const c = ds.checkConfig({ v: 1, kind: 'config', id: '', sent, server, api: 1, fingerprint: '5138e08d' }, { now: Date.parse(sent) });
  let manual = null;
  try {
    // setManualUrl's own reading (server/client/daylight-server.js), before it asks the address for /v1/hello.
    const u = new URL(String(server).trim());
    if (u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) manual = u.origin;
  } catch { /* refused */ }
  return { config: c ? c.server : null, manual };
});
console.log(JSON.stringify(out));
