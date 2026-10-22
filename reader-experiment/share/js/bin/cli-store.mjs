// The command line's storage (LAB-PLAN F09): the protocol's storage adapter on files, and a lock that works across
// processes. The JS reference's own lock (one promise chain per storage object) works only inside one process, so two
// daylight-send runs at once (from a script, or one of them in --wait) would lose rows without these:
//
// - FileStorage keeps each key in its own JSON file and writes it by atomic rename, so a reader never sees half a file;
// - FileLock is an exclusive lock file (O_EXCL), held around each read-modify-write of the outbox. Its holder touches
//   it every 10 s while it holds it; a lock untouched for 60 s is stale (its process died) and the next run takes it
//   over. Locks are short: a run never holds it while it waits (--wait polls under the lock, then lets go).

import { promises as fsp, readFileSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const LOCK_STALE_MS = 60000;
export const LOCK_HEARTBEAT_MS = 10000;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The protocol's storage adapter ({get, set, remove, keys}) on a folder: key k is the file
 * encodeURIComponent(k) + '.json', mode 0600. set() writes a temporary file and renames it over the key's file.
 * A file that does not parse reads as missing.
 */
export class FileStorage {
  constructor(dir) { this.dir = dir; }

  _file(key) { return path.join(this.dir, encodeURIComponent(String(key)) + '.json'); }

  async get(key) {
    let text;
    try {
      text = await fsp.readFile(this._file(key), 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return undefined;
      throw e;
    }
    try { return JSON.parse(text); } catch { return undefined; }
  }

  async set(key, value) {
    await fsp.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const file = this._file(key);
    const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fsp.writeFile(tmp, JSON.stringify(value), { mode: 0o600, flush: true });
      await fsp.rename(tmp, file);
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
  }

  async remove(key) { await fsp.rm(this._file(key), { force: true }); }

  async keys() {
    let names;
    try {
      names = await fsp.readdir(this.dir);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    return names.filter((n) => n.endsWith('.json')).map((n) => decodeURIComponent(n.slice(0, -5)));
  }
}

/**
 * An exclusive lock file. run(fn) takes it, runs fn and lets it go. Taking it waits while another process holds it
 * and keeps touching it; a lock file older than staleMs is moved aside and taken over (if the one moved aside turns
 * out to be a lock taken in the meantime, it is put back).
 */
export class FileLock {
  constructor(file, { staleMs = LOCK_STALE_MS, heartbeatMs = LOCK_HEARTBEAT_MS, pollMs = 50 } = {}) {
    this.file = file; this.staleMs = staleMs; this.heartbeatMs = heartbeatMs; this.pollMs = pollMs;
    this.token = null; this._beat = null; this.waited = 0;
  }

  async acquire() {
    if (this.token) throw new Error('daylight-send: the lock is already held by this run');
    await fsp.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const token = `${process.pid}:${randomBytes(8).toString('hex')}`;
    const started = Date.now();
    for (;;) {
      try {
        const fh = await fsp.open(this.file, 'wx', 0o600);
        try { await fh.writeFile(token); } finally { await fh.close(); }
        this.token = token;
        this.waited = Date.now() - started;
        this._beat = setInterval(() => { this._heartbeat().catch(() => {}); }, this.heartbeatMs);
        this._beat.unref?.();
        return;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
      if (await this._breakIfStale()) continue;
      await pause(this.pollMs + Math.floor(Math.random() * this.pollMs));
    }
  }

  async _heartbeat() {
    if (!this.token) return;
    if ((await fsp.readFile(this.file, 'utf8')) !== this.token) return;
    const now = new Date();
    await fsp.utimes(this.file, now, now);
  }

  /** -> true when there is no lock file any more (gone, or moved aside as stale). */
  async _breakIfStale() {
    let seen, st;
    try {
      st = await fsp.stat(this.file);
      seen = await fsp.readFile(this.file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return true;
      throw e;
    }
    if (Date.now() - st.mtimeMs <= this.staleMs) return false;
    const aside = `${this.file}.stale.${process.pid}.${randomBytes(4).toString('hex')}`;
    try {
      await fsp.rename(this.file, aside);
    } catch (e) {
      if (e.code === 'ENOENT') return true;
      throw e;
    }
    try {
      const moved = await fsp.readFile(aside, 'utf8');
      const mst = await fsp.stat(aside);
      if (moved !== seen || Date.now() - mst.mtimeMs <= this.staleMs) {
        // Someone took the lock between our look and the move: give it back (unless a newer one exists already).
        await fsp.link(aside, this.file).catch(() => {});
      }
    } catch { /* nothing to give back */ }
    await fsp.rm(aside, { force: true });
    return true;
  }

  /** Lets the lock go: removes the lock file when it is still this run's. Safe to call from a signal handler. */
  release() {
    if (this._beat) clearInterval(this._beat);
    this._beat = null;
    if (!this.token) return;
    try { if (readFileSync(this.file, 'utf8') === this.token) unlinkSync(this.file); } catch { /* already gone */ }
    this.token = null;
  }

  async run(fn) {
    await this.acquire();
    try { return await fn(); } finally { this.release(); }
  }
}
