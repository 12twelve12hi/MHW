// CI: checks a Send to Daylight app through the status file it writes when launched with -DLSStatusDump
// (AppModel.noteRendered: written on the first render, after every change, and once a second as a heartbeat).
//
//   node ci-app-status.mjs render  <status.json> <seconds> [start ms]       renders within <seconds> of [start] (default:
//                                                                           now), then stays responsive
//   node ci-app-status.mjs storage <status.json> private|shared             where it keeps the pairing and history
//   node ci-app-status.mjs row     <status.json> <url> <status,…> <seconds>  the history row for <url> reaches a status
//   node ci-app-status.mjs main-thread <status.json>                        no storage read or write (UserDefaults, the
//                                                                           outbox, own container or App Group) ran on
//                                                                           the main thread so far (StorageAudit)
//
// Exits 1 with a GitHub error annotation (and the last status) when a check fails.
import { readFileSync } from 'node:fs';

const [command, file, ...args] = process.argv.slice(2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function read() {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function fail(message, status = read()) {
  console.log(`::error::${message}`);
  console.log(`Last status (${file}):\n${status ? JSON.stringify(status, null, 2) : '(none written)'}`);
  process.exit(1);
}

async function waitFor(what, seconds, test, start = Date.now()) {
  for (;;) {
    const status = read();
    if (status && test(status)) return { status, ms: Date.now() - start };
    if (Date.now() - start > seconds * 1000) fail(`${what}: not within ${seconds} s`, status);
    await sleep(100);
  }
}

if (command === 'render') {
  const seconds = Number(args[0] ?? 10);
  const launched = Number(args[1]) || Date.now();
  const { status } = await waitFor('the app shows its window', seconds, (s) => s.firstRenderAt, launched);
  console.log(`First render ${status.firstRenderAt - launched} ms after \`open\` (app model created → rendered: ` +
    `${status.firstRenderAt - status.modelCreatedAt} ms).`);
  console.log(`Storage: ${status.storage}`);
  // Responsive: the heartbeat (a main-thread timer, once a second) keeps advancing.
  await sleep(3500);
  const later = read();
  const advanced = later ? later.heartbeatAt - status.heartbeatAt : 0;
  if (advanced < 2000) fail(`the app's main thread stalled: its heartbeat advanced ${advanced} ms in 3.5 s`, later);
  console.log(`Main thread responsive: heartbeat advanced ${advanced} ms in 3.5 s.`);
} else if (command === 'storage') {
  const want = args[0];
  const { status } = await waitFor('storage settled', 5, (s) => s.storageReady);
  const shared = status.appGroup !== null && status.appGroup !== undefined;
  if (want === 'private' && shared) fail(`expected the app's own storage, but it uses the App Group ${status.appGroup}`, status);
  if (want === 'shared' && !shared) fail(`expected an App Group, but storage is ${status.storage}`, status);
  console.log(`Storage: ${status.storage}`);
} else if (command === 'row') {
  const [url, statuses, seconds] = args;
  const wanted = statuses.split(',');
  const { status, ms } = await waitFor(`the history row for ${url} to be ${wanted.join(' or ')}`, Number(seconds ?? 60),
    (s) => (s.rows ?? []).some((r) => r.url === url && wanted.includes(r.status)));
  const row = status.rows.find((r) => r.url === url);
  console.log(`History row after ${ms} ms: ${row.status} ("${row.label}") · ${row.title}`);
  if (row.status === 'delivered' && row.label !== 'Delivered ✓') fail(`the history shows "${row.label}" for a delivered row`, status);
} else if (command === 'main-thread') {
  const { status } = await waitFor('the app reports its main-thread storage access after its first read', 10,
    (s) => s.loaded === true && Array.isArray(s.mainThreadStorage));
  if (status.mainThreadStorage.length > 0) {
    fail(`storage was touched on the main thread: ${status.mainThreadStorage.join(', ')}`, status);
  }
  console.log(`No storage access on the main thread (storage: ${status.storage}, ${(status.rows ?? []).length} history rows).`);
} else {
  console.error('usage: node ci-app-status.mjs render|storage|row|main-thread <status.json> …');
  process.exit(2);
}
