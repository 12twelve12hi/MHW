// A fake of the extension APIs Send to Daylight uses, for node tests. scripting.executeScript runs the real injected
// function against a stubbed page (document, location, fetch and the extension's isolated-world globals), and passes
// arguments and results through JSON like Chrome does.

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

class FakeFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
      this.onload?.();
    }, (e) => { this.error = e; this.onerror?.(); });
  }
}

function event(list) {
  return { addListener: (fn) => list.push(fn), removeListener: (fn) => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }, hasListeners: () => list.length > 0 };
}

export function fakeBrowser({ os = 'mac', version = '1.2.3', native, contextMenus = true, commands = true } = {}) {
  const local = new Map();
  const tabs = new Map();
  const granted = new Set();
  const alarms = new Map();
  const menus = new Map();
  const opened = [];
  const badge = { text: '', history: [] };
  const listeners = { message: [], installed: [], startup: [], menu: [], command: [], alarm: [], permAdded: [], changed: [] };
  let nextTab = 100;
  let activeTab = null;
  let requestAnswer = async () => false;
  const realFetch = globalThis.fetch;

  function notify(changes) {
    if (Object.keys(changes).length) for (const fn of listeners.changed) fn(changes, 'local');
  }

  async function runInPage(target, func, args) {
    const t = tabs.get(target.tabId);
    if (!t) throw new Error(`No tab with id: ${target.tabId}.`);
    const page = t.page;
    if (page.scriptable === false) throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.');
    const isPdf = page.contentType === 'application/pdf';
    const saved = { document: globalThis.document, location: globalThis.location, pdf: globalThis.__daylightPdf, FileReader: globalThis.FileReader, fetch: globalThis.fetch };
    globalThis.location = { href: page.url };
    globalThis.document = {
      contentType: page.contentType ?? 'text/html',
      title: page.docTitle ?? (isPdf ? '' : page.title ?? ''),
      documentElement: { outerHTML: isPdf ? '<html><head></head><body><embed type="application/pdf" src="about:blank"></body></html>' : page.html },
      doctype: !isPdf && page.doctype !== null ? { name: page.doctype ?? 'html', publicId: '', systemId: '' } : null,
      querySelectorAll: () => (page.links ?? []).map((l) => ({
        href: l.href, innerText: l.text, textContent: l.text, title: '', getAttribute: () => null, querySelector: () => null,
      })),
    };
    globalThis.__daylightPdf = t.world.pdf;
    globalThis.FileReader = FakeFileReader;
    globalThis.fetch = page.fetch ?? realFetch;
    try {
      const result = await func(...clone(args));
      t.world.pdf = globalThis.__daylightPdf;
      t.calls.push(func.name);
      return [{ frameId: 0, documentId: `doc-${target.tabId}`, result: result === undefined ? null : clone(result) }];
    } finally {
      globalThis.document = saved.document;
      globalThis.location = saved.location;
      globalThis.__daylightPdf = saved.pdf;
      globalThis.FileReader = saved.FileReader;
      globalThis.fetch = saved.fetch;
    }
  }

  const api = {
    runtime: {
      id: 'fake-extension-id',
      lastError: undefined,
      getManifest: () => ({ version }),
      getPlatformInfo: async () => ({ os }),
      getURL: (p) => `chrome-extension://fake-extension-id/${p}`,
      onInstalled: event(listeners.installed),
      onStartup: event(listeners.startup),
      onMessage: event(listeners.message),
      sendNativeMessage: native ? async (app, msg) => native(app, msg) : undefined,
      async sendMessage(msg) {
        for (const fn of listeners.message) {
          let resolve;
          const p = new Promise((r) => { resolve = r; });
          const keep = fn(clone(msg), { id: 'fake-extension-id', url: 'chrome-extension://fake-extension-id/popup.html' }, (r) => resolve(clone(r)));
          if (keep === true) return p;
        }
        return undefined;
      },
    },
    storage: {
      local: {
        async get(keys) {
          const out = {};
          const list = keys == null ? [...local.keys()] : Array.isArray(keys) ? keys : [keys];
          for (const k of list) if (local.has(k)) out[k] = clone(local.get(k));
          return out;
        },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: clone(local.get(k)), newValue: clone(v) };
            local.set(k, clone(v));
          }
          notify(changes);
        },
        async remove(keys) {
          const changes = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) {
            if (local.has(k)) { changes[k] = { oldValue: clone(local.get(k)) }; local.delete(k); }
          }
          notify(changes);
        },
      },
      onChanged: event(listeners.changed),
    },
    action: {
      async setBadgeText({ text }) { badge.text = text; badge.history.push(text); },
      async setBadgeBackgroundColor() {},
      async setBadgeTextColor() {},
      async openPopup() { opened.push('popup'); },
    },
    tabs: {
      async get(id) { const t = tabs.get(id); if (!t) throw new Error(`No tab with id: ${id}.`); return { ...t.tab }; },
      async query() { return activeTab != null ? [{ ...tabs.get(activeTab).tab }] : []; },
      async create(p) { opened.push(p.url); return { id: 9999, url: p.url }; },
    },
    scripting: { executeScript: async ({ target, func, args = [] }) => runInPage(target, func, args) },
    permissions: {
      async contains({ origins = [] }) { return origins.every((o) => granted.has(o)); },
      async request({ origins = [] }) {
        const ok = await requestAnswer(origins);
        if (ok) { origins.forEach((o) => granted.add(o)); for (const fn of listeners.permAdded) fn({ origins }); }
        return ok;
      },
      onAdded: event(listeners.permAdded),
    },
    alarms: {
      create(name, info) { alarms.set(name, { name, ...info }); },
      async get(name) { return alarms.get(name); },
      onAlarm: event(listeners.alarm),
    },
  };
  if (contextMenus) {
    api.contextMenus = {
      async removeAll() { menus.clear(); },
      create(props, cb) { menus.set(props.id, props); cb?.(); return props.id; },
      onClicked: event(listeners.menu),
    };
  }
  if (commands) {
    api.commands = { async getAll() { return [{ name: 'send-page', shortcut: 'Alt+Shift+D' }]; }, onCommand: event(listeners.command) };
  }

  return {
    api, local, granted, alarms, menus, opened, badge, listeners,
    /** page: {url, title, html?, contentType?, scriptable?, links?, fetch?, docTitle?} -> tab id */
    addTab(page, { active = true, title } = {}) {
      const id = nextTab++;
      tabs.set(id, { tab: { id, url: page.url, title: title ?? page.title ?? page.url, active }, page, world: {}, calls: [] });
      if (active) activeTab = id;
      return id;
    },
    tabCalls: (id) => tabs.get(id).calls,
    grant: (origin) => granted.add(origin),
    onRequest: (fn) => { requestAnswer = fn; },
  };
}
