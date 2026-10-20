// The window's link to the Rust side (src-tauri/src/main.rs), through Tauri's global API (app.withGlobalTauri).
// Rust keeps to what a web page can't do: the tray, files named on the command line, the clipboard, the global
// hotkey, notifications, start at login, and a folder of JSON files that holds the pairing and the outbox.

const tauri = () => {
  const t = globalThis.__TAURI__;
  if (!t?.core?.invoke) throw new Error('Send to Daylight must run inside its app.');
  return t;
};

export const invoke = (cmd, args) => tauri().core.invoke(cmd, args);
export const listen = (event, fn) => tauri().event.listen(event, (e) => fn(e.payload));

/** The daylight-share storage adapter: each key is a JSON file in the app's data folder. */
export function appStorage(log = console) {
  return {
    async get(key) {
      const s = await invoke('kv_get', { key });
      return s == null ? undefined : JSON.parse(s);
    },
    async set(key, value) {
      try {
        await invoke('kv_set', { key, value: JSON.stringify(value) });
      } catch (e) {
        // The copy of an item's content kept for re-sends is best effort: without it the item is still sent once.
        if (String(key).startsWith('outbox/')) { log.warn?.('Send to Daylight: could not keep a copy for re-sending', e); return; }
        throw e;
      }
    },
    async remove(key) { await invoke('kv_remove', { key }); },
  };
}

export const bridge = {
  /** -> {version, e2e: {pair, status}, sendTo: {path, exists}, autostart} */
  info: () => invoke('app_info'),
  /** Things to do that arrived from outside: files (Send To), pairing links, the clipboard (hotkey or tray). */
  takeActions: () => invoke('take_actions'),
  /** A file offered on the command line (Send To): Rust answers with raw bytes (an ArrayBuffer). */
  readFile: async (path, max) => new Uint8Array(await invoke('read_file', { path, max })),
  notify: (title, body) => invoke('notify', { title, body }),
  showWindow: () => invoke('show_window'),
  hideWindow: () => invoke('hide_window'),
  /** -> the accelerator now registered ('' = off). Throws when Windows won't give us that combination. */
  setHotkey: (accel) => invoke('set_hotkey', { accel }),
  readClipboard: () => invoke('read_clipboard'),
  setAutostart: (enabled) => invoke('set_autostart', { enabled }),
  addSendTo: () => invoke('add_send_to'),
  e2eStatus: (json) => invoke('e2e_status', { json }),
  onWake: (fn) => listen('dls://wake', fn),
  onTick: (fn) => listen('dls://tick', fn),
  onAutostart: (fn) => listen('dls://autostart', fn),
};
