// A fake of the extension APIs Send to Daylight uses, for node tests. scripting.executeScript runs the real injected
// function against a stubbed page (document, location, fetch and the extension's isolated-world globals), and passes
// arguments and results through JSON like Chrome does.
//
// Lab's capture code (executeScript({files: ['clean-html.js', 'Readability.js']})) has stand-ins here, since the stubbed
// page has no DOM: cleanHtml drops <script> elements (JSON-LD aside) and on* attributes from the page's HTML and marks
// the result (data-fake-clean), prepareForReadability marks the clone it is given (prepared: the number of calls), and
// Readability answers the page's `article` ({title, byline, siteName, content, textContent}, or null) and keeps, in
// the tab's `parsed`, how many times the clone it parsed had been prepared. The real code runs in Chromium
// (test/e2e). A page's `selection` ({text, html}) is what window.getSelection() holds, and `text` its visible text.

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

/** The stand-in for clean-html.js's cleanHtml: the page's HTML without scripts (JSON-LD aside) or on* attributes. */
function fakeCleanHtml(root) {
  const html = String(root?.outerHTML ?? '')
    .replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/^<html/i, '<html data-fake-clean="1"');
  return '<!doctype html>\n' + html;
}

/**
 * popupApi: how the background can tell an open popup: 'contexts' (Chrome's runtime.getContexts), 'views' (Safari's
 * background page: extension.getViews) or null (neither).
 */
export function fakeBrowser({ os = 'mac', version = '1.2.3', native, contextMenus = true, commands = true, omnibox = false, popupApi = 'contexts' } = {}) {
  const local = new Map();
  const tabs = new Map();
  const granted = new Set();
  const alarms = new Map();
  const menus = new Map();
  const opened = [];
  const badge = { text: '', history: [] };
  const listeners = { message: [], installed: [], startup: [], menu: [], command: [], alarm: [], permAdded: [], changed: [], omnibox: [] };
  let nextTab = 100;
  let activeTab = null;
  let requestAnswer = async () => false;
  let contexts = []; // runtime.getContexts's answer: the extension's open pages ({contextType, documentUrl})
  let toolbar = false; // action.getUserSettings's isOnToolbar (Chrome), once pinned() gives the fake that call
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
    const keys = ['document', 'location', '__daylightPdf', 'FileReader', 'fetch', 'window', 'cleanHtml', 'prepareForReadability', 'Readability'];
    const saved = Object.fromEntries(keys.map((k) => [k, globalThis[k]]));
    const outer = isPdf ? '<html><head></head><body><embed type="application/pdf" src="about:blank"></body></html>' : page.html;
    globalThis.location = { href: page.url };
    const sel = page.selection ?? null;
    globalThis.window = {
      getSelection: () => (sel?.text ? {
        rangeCount: 1, isCollapsed: false, toString: () => sel.text, getRangeAt: () => ({ cloneContents: () => ({ html: sel.html ?? '' }) }),
      } : { rangeCount: 0, isCollapsed: true, toString: () => '' }),
    };
    globalThis.document = {
      contentType: page.contentType ?? 'text/html',
      title: page.docTitle ?? (isPdf ? '' : page.title ?? ''),
      documentElement: { outerHTML: outer, cloneNode: () => ({ outerHTML: outer, fake: true }) },
      doctype: !isPdf && page.doctype !== null ? { name: page.doctype ?? 'html', publicId: '', systemId: '' } : null,
      body: { innerText: page.text ?? '', textContent: page.text ?? '' },
      cloneNode: () => ({ fake: true }),
      activeElement: null,
      implementation: {
        createHTMLDocument: () => {
          const body = { innerHTML: '', fake: true, get outerHTML() { return `<body>${this.innerHTML}</body>`; } };
          return {
            body,
            importNode: (n) => n,
            createElement: () => {
              const parts = [];
              return { appendChild: (n) => parts.push(n.html ?? ''), get innerHTML() { return parts.join(''); } };
            },
          };
        },
      },
      querySelectorAll: () => (page.links ?? []).map((l) => ({
        href: l.href, innerText: l.text, textContent: l.text, title: '', getAttribute: () => null, querySelector: () => null,
      })),
    };
    globalThis.__daylightPdf = t.world.pdf;
    globalThis.FileReader = FakeFileReader;
    globalThis.fetch = page.fetch ?? realFetch;
    if (t.world.cleanHtml) {
      globalThis.cleanHtml = fakeCleanHtml;
      globalThis.prepareForReadability = (doc) => { doc.prepared = (doc.prepared ?? 0) + 1; return 0; };
    }
    if (t.world.readability) {
      globalThis.Readability = function Readability(doc) {
        this.parse = () => { t.parsed.push(doc?.prepared ?? 0); return clone(page.article ?? null); };
      };
    }
    try {
      const result = await func(...clone(args));
      t.world.pdf = globalThis.__daylightPdf;
      t.calls.push(func.name);
      return [{ frameId: 0, documentId: `doc-${target.tabId}`, result: result === undefined ? null : clone(result) }];
    } finally {
      for (const k of keys) { if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k]; }
    }
  }

  /** executeScript({files}): Lab's capture code loads into the tab's extension world (stand-ins, see above). */
  async function loadFiles(target, files) {
    const t = tabs.get(target.tabId);
    if (!t) throw new Error(`No tab with id: ${target.tabId}.`);
    if (t.page.scriptable === false) throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.');
    for (const f of files) {
      if (f === 'clean-html.js') t.world.cleanHtml = true;
      else if (f === 'Readability.js') t.world.readability = true;
      else throw new Error(`Could not load file: '${f}'.`);
      t.files.push(f);
    }
    return [{ frameId: 0, documentId: `doc-${target.tabId}`, result: null }];
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
    scripting: { executeScript: async ({ target, func, args = [], files }) => (files ? loadFiles(target, files) : runInPage(target, func, args)) },
    permissions: {
      async contains({ origins = [] }) { return origins.every((o) => granted.has(o)); },
      async request({ origins = [], permissions = [] }) {
        if (!origins.length && permissions.length) return true;
        const ok = await requestAnswer(origins);
        if (ok) { origins.forEach((o) => granted.add(o)); for (const fn of listeners.permAdded) fn({ origins }); }
        return ok;
      },
      onAdded: event(listeners.permAdded),
    },
    alarms: {
      create(name, info) { alarms.set(name, { name, ...info }); },
      async get(name) { return alarms.get(name); },
      async clear(name) { return alarms.delete(name); },
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
    const list = commands === true ? [{ name: 'send-page', shortcut: 'Alt+Shift+D' }] : commands;
    api.commands = { async getAll() { return clone(list); }, onCommand: event(listeners.command) };
  }
  if (omnibox) api.omnibox = { onInputEntered: event(listeners.omnibox) };
  if (popupApi === 'contexts') {
    api.runtime.getContexts = async (filter = {}) => clone(contexts.filter((c) => !filter.contextTypes || filter.contextTypes.includes(c.contextType)));
  }
  if (popupApi === 'views') api.extension = { getViews: () => contexts.map((c) => ({ location: { href: c.documentUrl } })) };

  return {
    api, local, granted, alarms, menus, opened, badge, listeners,
    /** page: {url, title, html?, contentType?, scriptable?, links?, fetch?, docTitle?} -> tab id */
    addTab(page, { active = true, title } = {}) {
      const id = nextTab++;
      tabs.set(id, { tab: { id, url: page.url, title: title ?? page.title ?? page.url, active }, page, world: {}, calls: [], files: [], parsed: [] });
      if (active) activeTab = id;
      return id;
    },
    tabCalls: (id) => tabs.get(id).calls,
    tabFiles: (id) => tabs.get(id).files,
    /** For each Readability parse in the tab, how many times prepareForReadability had run on the clone it parsed. */
    tabParsed: (id) => tabs.get(id).parsed,
    /** Changes a tab's page (its selection, its article, …). */
    setPage: (id, patch) => Object.assign(tabs.get(id).page, patch),
    grant: (origin) => granted.add(origin),
    /** The extension's open pages, as runtime.getContexts lists them: popupOpen(true) opens the toolbar's popup. */
    popupOpen: (open) => {
      contexts = contexts.filter((c) => c.contextType !== 'POPUP');
      if (open) contexts.push({ contextType: 'POPUP', documentUrl: 'chrome-extension://fake-extension-id/popup.html' });
    },
    /** An extension page open in a tab (popup.html?standalone=1, lab.html, …); pageOpen(path, false) closes it. */
    pageOpen: (path, open = true) => {
      const documentUrl = `chrome-extension://fake-extension-id/${path}`;
      contexts = contexts.filter((c) => c.documentUrl !== documentUrl);
      if (open) contexts.push({ contextType: 'TAB', documentUrl });
    },
    onRequest: (fn) => { requestAnswer = fn; },
    /**
     * Chrome's toolbar pin: from the first call, action.getUserSettings() answers {isOnToolbar: on} (without one the
     * fake has no getUserSettings, as before Chrome 91, and Setup check shows no toolbar line).
     */
    pinned: (on) => { toolbar = !!on; api.action.getUserSettings ??= async () => ({ isOnToolbar: toolbar }); },
  };
}
