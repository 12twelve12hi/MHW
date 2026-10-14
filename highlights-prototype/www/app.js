/* Save passage prototype: Christine's proposal for the Daylight Reader's highlight menu.
   Plain JavaScript with no build step, written for Chromium 101 (the DC-1's system WebView).
   index.html loads content.js (the sample text) and then this file. */
(() => {
  'use strict';

  const C = window.PROTO_CONTENT;

  // Timings and sizes from the Reader (ViewerCore, SelectionStrip, DlPressed); see the research notes in README.md.
  const LONG_PRESS_MS = 400;      // Android 13's long-press timeout, which the Reader uses for selecting text
  const HOLD_MS = 450;            // holding a category button opens its options
  const GROW_WINDOW_MS = 6000;    // tapping a fresh sentence within this grows it to the paragraph
  const PEEK_HOLD_MS = 320;       // two still fingers held this long peek under the notes (shorter is the Reader's undo)
  const SLOP = { touch: 10, pen: 6, mouse: 4 };
  const MAX_RECORD_MS = 10 * 60 * 1000;

  const FORMATS = [
    { id: 'highlight', label: 'Highlight' },
    { id: 'underline', label: 'Underline' },
    { id: 'squiggly', label: 'Squiggly' },
    { id: 'dash', label: 'Dash' },
    { id: 'strike', label: 'Strike' },
  ];
  const SHADES = [1, 2, 3, 4];

  // The Reader's own symbol picker sets (marks/Symbols.kt GLYPHS, marks/EmojiCatalog.kt GROUPS).
  const GLYPHS = ['○', '●', '◐', '□', '■', '◇', '◆', '△', '▲', '▽', '▼', '☆', '★', '✓', '✗', '?', '‽', '§', '¶', '†', '‡', '※',
    '→', '↺', '↔', '≡', '∞', '≈', '≠', '∴', '✎', '⚑', '⚐', '♡', '♥', '♪', '☼', '☾', '⌘', '❂', '❦', '!'];
  const EMOJI_GROUPS = [
    ['Marks', ['⭐', '🌟', '✅', '❌', '❓', '❗', '⚠️', '💡', '📌', '📍', '🔖', '🏷️', '🎯', '🔑', '🔒', '🔍', '💬', '💭', '🗯️', '📝', '✏️', '🖊️', '📎', '🧷']],
    ['Study', ['📚', '📖', '📓', '📒', '📕', '📗', '📘', '📙', '🗂️', '📁', '🗓️', '⏰', '⏳', '🧠', '🔬', '🧪', '🧮', '📐', '📏', '📊', '📈', '📉', '🗺️', '🧭']],
    ['People', ['👍', '👎', '👏', '🙏', '💪', '👀', '🤔', '😀', '😂', '😍', '😮', '😢', '😡', '😴', '🤯', '🥳', '🙌', '✋', '👉', '☝️', '🫶', '🤝', '🧑‍🏫', '🧑‍💻']],
    ['Hearts', ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💯', '🔥', '✨', '💥', '⚡', '🌈', '☀️', '🌙', '☁️', '❄️', '🌊', '🌱', '🌸']],
    ['Things', ['🏠', '🏫', '🏛️', '⚖️', '🛠️', '⚙️', '🧩', '🎵', '🎨', '🎬', '📷', '💻', '📱', '☎️', '✉️', '📦', '💰', '🧾', '🍎', '☕', '🍀', '🐝', '🦉', '🐢']],
    ['Signs', ['➕', '➖', '✖️', '➗', '♾️', '🔁', '🔄', '⏩', '⏪', '🔼', '🔽', '▶️', '⏸️', '🆗', '🆕', '🔝', '🔚', '🔜', '🚩', '🏁', '⛔', '🚫', '♻️', '🔰']],
  ];
  const NEW_CATEGORY_SYMBOLS = ['!', '✓', '♥', '○', '※', '§', '¶', '→', '◆', '♪', '☼', '∞'];

  const ICONS = {
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.75"/>',
    plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>',
    play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/>',
    close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>',
    check: '<path d="M5.5 12.5l4.5 4.5 8.5-9.5" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>',
    trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>',
    note: '<path d="M4 2.5h10l4.5 4.5v14.5H4z" fill="var(--paper)" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 2.5V7h4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7.5 12h7.5M7.5 16h5" stroke="currentColor" stroke-width="1.4"/>',
  };

  // ---------------------------------------------------------------- helpers

  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => performance.now();

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') {
          for (const s of Object.keys(v)) {
            if (s.startsWith('--')) el.style.setProperty(s, v[s]);
            else el.style[s] = typeof v[s] === 'number' ? v[s] + 'px' : v[s];
          }
        } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : String(kid));
    }
    return el;
  }

  function icon(name, size = 24) {
    const span = document.createElement('span');
    span.style.display = 'inline-grid';
    span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[name]}</svg>`;
    return span;
  }

  function fmtTime(ms) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // A symbol safe to store and draw: the first grapheme of what was typed, with whitespace, control and bidi
  // characters removed and at most 32 UTF-16 units (core-data HighlightSymbols.sanitize, EmojiCatalog.firstSymbol).
  function firstSymbol(input) {
    if (!input) return null;
    let clean = '';
    for (const ch of input) {
      const cp = ch.codePointAt(0);
      if (/\s/u.test(ch) || cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue;
      if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200e || cp === 0x200f || cp === 0x61c) continue;
      if (cp === 0xfeff || cp === 0xfffd) continue;
      clean += ch;
    }
    if (!clean) return null;
    let first = clean;
    try {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const it = seg.segment(clean)[Symbol.iterator]().next();
      if (!it.done) first = it.value.segment;
    } catch (e) { first = Array.from(clean)[0]; }
    if (first.length > 32) first = Array.from(first).slice(0, 8).join('');
    return /^[‍︀-️]+$/.test(first) ? null : first;
  }

  // ---------------------------------------------------------------- state

  const STORE_KEY = 'hlproto:v1';
  const DEFAULT_SETTINGS = {
    mode: 'christine',      // 'original' is today's Reader, 'christine' is the proposal
    level: 2,               // Original mode: the gray level new highlights use (the Reader remembers the last one)
    view: 'regular',
    textSize: 20,
    sentence: true,
    hints: true,
    ink: 'gray',
    theme: 'system',
    symbolSide: 'right',
    lastCategoryId: 'star',
  };
  let S = null;
  const ui = {
    sheet: null, quick: null, menu: null, panel: null, picker: null, expanded: null, panelFilter: 'all',
    markPop: null, noteSheet: null, chip: null, recbar: null, more: false,
  };
  const isOrig = () => S.settings.mode === 'original';

  function freshCategories() {
    return [
      { id: 'star', name: 'Star', symbol: '★', gray: 2, format: 'highlight' },
      { id: 'question', name: 'Question', symbol: '?', gray: 3, format: 'squiggly' },
    ];
  }

  function seedPassages() {
    const out = [];
    let t = Date.now() - 60000;
    for (const s of C.samples) {
      const r = findQuote(s.quote);
      if (!r) continue;
      out.push({ id: uid(), start: r[0], end: r[1], categoryId: s.category, ownFormat: null, note: s.note || '', voice: null, created: t++ });
    }
    return out;
  }

  // Original mode keeps the Reader's own model: a gray level, a look, an optional symbol of its own.
  function seedOriginal() {
    const out = [];
    let t = Date.now() - 60000;
    for (const s of C.samples) {
      const r = findQuote(s.quote);
      if (!r) continue;
      out.push({ id: uid(), start: r[0], end: r[1], level: s.category === 'question' ? 3 : 2, style: 'band', symbol: null, note: s.note || '', ink: null, voice: null, created: t++ });
    }
    return out;
  }

  function seedState() {
    return { categories: freshCategories(), passages: seedPassages(), orig: seedOriginal(), settings: Object.assign({}, DEFAULT_SETTINGS), introSeen: {} };
  }

  function loadState() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw || !Array.isArray(raw.categories) || !raw.categories.length || !Array.isArray(raw.passages)) return seedState();
    raw.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
    const ok = (p) => p && p.start >= 0 && p.end < W.length && p.start <= p.end;
    raw.passages = raw.passages.filter(ok);
    raw.orig = Array.isArray(raw.orig) ? raw.orig.filter(ok) : seedOriginal();
    if (!raw.introSeen || typeof raw.introSeen !== 'object') raw.introSeen = {};
    return raw;
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ categories: S.categories, passages: S.passages, orig: S.orig, settings: S.settings, introSeen: S.introSeen }));
    } catch (e) { /* storage may be blocked; the prototype still works for this visit */ }
  }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }

  function snapshot() { return JSON.stringify({ categories: S.categories, passages: S.passages, orig: S.orig }); }
  function restore(snap) {
    const v = JSON.parse(snap);
    S.categories = v.categories;
    S.passages = v.passages;
    S.orig = v.orig;
    save();
    if (ui.sheet) closeSheet();
    if (ui.noteSheet) closeNoteSheet(true);
    closeMarkPopover();
    hideChip();
    renderAll();
  }

  const byId = (id) => S.passages.find((p) => p.id === id) || S.orig.find((p) => p.id === id);
  const curList = () => (isOrig() ? S.orig : S.passages);
  const catById = (id) => S.categories.find((c) => c.id === id);
  const catOf = (p) => catById(p.categoryId) || S.categories[0];
  // A passage either follows its category's default formatting (ownFormat null) or has its own one-time choice.
  function effFormat(p) {
    if (p.ownFormat == null) return catOf(p).format || null;
    return p.ownFormat === 'none' ? null : p.ownFormat;
  }
  const hasNote = (p) => !!((p.note && p.note.trim()) || p.voice);

  // Recorded audio lives in IndexedDB (localStorage can't hold it), with a memory copy for this visit.
  const audioMem = new Map();
  let dbPromise = null;
  function idb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open('hlproto', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('audio');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
    return dbPromise;
  }
  async function putAudio(id, blob) {
    audioMem.set(id, blob);
    const db = await idb();
    if (!db) return;
    try { db.transaction('audio', 'readwrite').objectStore('audio').put(blob, id); } catch (e) { /* memory copy only */ }
  }
  async function getAudio(id) {
    if (audioMem.has(id)) return audioMem.get(id);
    const db = await idb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction('audio').objectStore('audio').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  // ---------------------------------------------------------------- the text

  const reader = $('#reader');
  const pageEl = $('#page');
  const textEl = $('#text');
  const under = $('#layer-under');
  const over = $('#layer-over');
  const uiLayer = $('#layer-ui');
  const overlayRoot = $('#overlay-root');

  // Containers inside the layers, so the selection can redraw without touching the passages.
  const marksUnder = h('div');
  const selUnder = h('div');
  const marksOver = h('div');
  const marksUi = h('div');
  const selUi = h('div');
  const quickUi = h('div');
  under.append(marksUnder, selUnder);
  over.append(marksOver);
  uiLayer.append(marksUi, selUi, quickUi);

  const W = []; // words: { i, p, s, text, el }
  const P = []; // paragraphs: { start, end, el }
  let introEl = null;

  function buildText() {
    textEl.textContent = '';
    introEl = h('div');
    textEl.append(introEl);
    textEl.append(h('h1', null, C.chapter), h('p', { class: 'byline' }, C.byline));
    C.paragraphs.forEach((para, pi) => {
      const p = h('p', { 'data-p': pi });
      const start = W.length;
      for (const part of para.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { p.append(' '); continue; }
        const span = h('span', { class: 'w' });
        span.textContent = part;
        W.push({ i: W.length, p: pi, s: 0, text: part, el: span });
        p.append(span);
      }
      P.push({ start, end: W.length - 1, el: p });
      textEl.append(p);
    });
    let sid = 0;
    for (const para of P) {
      for (let i = para.start; i <= para.end; i++) {
        W[i].s = sid;
        if (/[.!?]["'”’)\]]*$/.test(W[i].text) || i === para.end) sid++;
      }
    }
    $('#book-title').textContent = C.book;
    $('#book-meta').textContent = C.chapter;
  }

  function sentenceRange(i) {
    let a = i, b = i;
    while (a > 0 && W[a - 1].s === W[i].s) a--;
    while (b < W.length - 1 && W[b + 1].s === W[i].s) b++;
    return [a, b];
  }
  function paragraphRange(i) { const para = P[W[i].p]; return [para.start, para.end]; }

  function findQuote(q) {
    const toks = q.split(/\s+/).filter(Boolean);
    outer: for (let i = 0; i + toks.length <= W.length; i++) {
      for (let k = 0; k < toks.length; k++) if (W[i + k].text !== toks[k]) continue outer;
      return [i, i + toks.length - 1];
    }
    return null;
  }

  const quoteOf = (p) => W.slice(p.start, p.end + 1).map((w) => w.text).join(' ');

  // ---------------------------------------------------------------- geometry

  function origin() { const r = pageEl.getBoundingClientRect(); return { x: r.left, y: r.top }; }
  function column() {
    const o = origin();
    const r = textEl.getBoundingClientRect();
    return { left: r.left - o.x, right: r.right - o.x };
  }

  // The visual lines a word range covers, in page coordinates, one rect per line.
  function lineRects(a, b) {
    const o = origin();
    const out = [];
    for (let pi = W[a].p; pi <= W[b].p; pi++) {
      const s = Math.max(a, P[pi].start), e = Math.min(b, P[pi].end);
      if (s > e) continue;
      const range = document.createRange();
      range.setStart(W[s].el.firstChild, 0);
      range.setEnd(W[e].el.firstChild, W[e].el.firstChild.length);
      const lines = [];
      for (const r of range.getClientRects()) {
        if (r.width <= 0 || r.height <= 0) continue;
        const cy = (r.top + r.bottom) / 2;
        let L = null;
        for (const l of lines) if (Math.abs(l.cy - cy) < r.height / 2) { L = l; break; }
        if (!L) lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, cy });
        else {
          L.left = Math.min(L.left, r.left); L.right = Math.max(L.right, r.right);
          L.top = Math.min(L.top, r.top); L.bottom = Math.max(L.bottom, r.bottom);
        }
      }
      lines.sort((m, n) => m.top - n.top);
      for (const L of lines) out.push({ left: L.left - o.x, top: L.top - o.y, width: L.right - L.left, height: L.bottom - L.top });
    }
    return out;
  }

  // The word under a point, or the nearest one within maxD px (weighted to prefer the same line).
  function wordNear(x, y, maxD = Infinity) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.classList && el.classList.contains('w')) return W.findIndex((w) => w.el === el);
      if (el === textEl) break;
    }
    let best = -1, bestD = Infinity;
    for (const para of P) {
      const r = para.el.getBoundingClientRect();
      const pdy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
      if (pdy > 80) continue;
      for (let i = para.start; i <= para.end; i++) {
        const wr = W[i].el.getBoundingClientRect();
        const dy = y < wr.top ? wr.top - y : (y > wr.bottom ? y - wr.bottom : 0);
        const dx = x < wr.left ? wr.left - x : (x > wr.right ? x - wr.right : 0);
        const d = dy * 4 + dx;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return bestD <= maxD ? best : -1;
  }

  // ---------------------------------------------------------------- drawing passages

  function box(cls, rect, extra) {
    const el = h('div', { class: cls });
    el.style.left = rect.left + 'px';
    el.style.top = rect.top + 'px';
    el.style.width = rect.width + 'px';
    if (rect.height != null) el.style.height = rect.height + 'px';
    if (extra) for (const k of Object.keys(extra)) el.style.setProperty(k, extra[k]);
    return el;
  }

  function drawLook(fmt, gray, L) {
    const bottom = L.top + L.height;
    if (fmt === 'highlight') marksUnder.append(box('band', L, { '--band': `var(--band-${gray})` }));
    else if (fmt === 'underline') marksOver.append(box('line-mark', { left: L.left, top: bottom - 3, width: L.width }));
    else if (fmt === 'dash') marksOver.append(box('line-mark dash', { left: L.left, top: bottom - 3, width: L.width }));
    else if (fmt === 'squiggly') marksOver.append(box('line-mark squiggly', { left: L.left, top: bottom - 3.5, width: L.width }));
    else if (fmt === 'strike') marksOver.append(box('line-mark', { left: L.left, top: L.top + L.height * 0.54 - 0.75, width: L.width }));
  }

  function stamp(voice) {
    const s = h('span', { class: 'stamp', 'aria-hidden': 'true' });
    const bins = downsample(voice.waveform || [], 9);
    for (const v of bins) s.append(h('i', { style: { height: Math.max(2, Math.round(v * 9)) + 'px' } }));
    return s;
  }

  function renderMarks() {
    marksUnder.textContent = '';
    marksOver.textContent = '';
    marksUi.textContent = '';
    if (isOrig()) { renderOriginalMarks(); return; }
    const col = column();
    const left = S.settings.symbolSide === 'left';
    const slots = new Map();
    const list = S.passages.slice().sort((p, q) => p.start - q.start || p.created - q.created);
    for (const p of list) {
      const lines = lineRects(p.start, p.end);
      p._lines = lines;
      if (!lines.length) continue;
      const cat = catOf(p);
      const fmt = effFormat(p);
      for (const L of lines) drawLook(fmt, cat.gray, L);

      // The category symbol sits in the margin, level with the passage's first line.
      const first = lines[0];
      const key = Math.round(first.top / 4);
      const n = slots.get(key) || 0;
      slots.set(key, n + 1);
      const x = left ? col.left - 36 - n * 26 : col.right + 10 + n * 26;
      const y = first.top + first.height / 2 - 14;
      marksUi.append(h('button', {
        class: 'sym', type: 'button', style: { left: x, top: y },
        'aria-label': `${cat.name}. Open this passage`, title: cat.name,
        onclick: () => openSheet(p.id, 'symbol'),
      }, cat.symbol));

      // In the regular view, a note or voice note shows as a small mark under the symbol.
      if (S.settings.view === 'regular' && hasNote(p)) {
        const ind = h('button', {
          class: 'sym-note', type: 'button', style: { left: x, top: y + 30 },
          'aria-label': 'Open my note', onclick: () => { ui.expanded = p.id; renderMarks(); },
        });
        if (p.note && p.note.trim()) ind.append(icon('note', 18));
        if (p.voice) ind.append(stamp(p.voice));
        marksUi.append(ind);
      }
    }
    renderNotes(list, col);
    renderFocus();
  }

  // The passage open in the sheet gets an ink bar beside it, so it's clear what the sheet is editing.
  function renderFocus() {
    if (!ui.sheet) return;
    const p = byId(ui.sheet.pid);
    if (!p || !p._lines || !p._lines.length) return;
    const col = column();
    const a = p._lines[0], b = p._lines[p._lines.length - 1];
    const x = S.settings.symbolSide === 'left' ? col.right + 8 : col.left - 12;
    marksUnder.append(box('focus-bar', { left: x, top: a.top, width: 3, height: b.top + b.height - a.top }));
  }

  // ---------------------------------------------------------------- annotations view: note boxes over the text

  function noteSummary(p) {
    const parts = [];
    if (p.note && p.note.trim()) parts.push(p.note.trim());
    return parts.join('\n');
  }

  function voiceLine(v) {
    return h('div', { class: 'xvoice' }, icon('mic', 16), h('span', null, `Voice note, ${fmtTime(v.durationMs)}`));
  }

  function renderNotes(list, col) {
    const annotations = S.settings.view === 'annotations';
    const colW = col.right - col.left;
    const pageW = pageEl.clientWidth;
    const placed = [];
    for (const p of list) {
      const expanded = ui.expanded === p.id;
      if (!(expanded || (annotations && hasNote(p)))) continue;
      if (!p._lines || !p._lines.length) continue;
      const el = expanded ? noteCard(p) : notePreview(p);
      const w = expanded ? Math.min(440, pageW - 16) : clamp(Math.round(colW * 0.62), 220, 400);
      el.style.width = w + 'px';
      marksUi.append(el);
      const ht = el.offsetHeight;
      const first = p._lines[0];
      let x = clamp(col.right + 40 - w, 8, pageW - w - 8);
      let y = first.top - ht - 3;
      if (!expanded) {
        for (const q of placed) {
          const hits = x < q.x + q.w && q.x < x + w && y < q.y + q.h + 4 && q.y < y + ht + 4;
          if (hits) y = q.y - ht - 6;
        }
        placed.push({ x, y, w, h: ht });
      } else {
        const visTop = reader.getBoundingClientRect().top - origin().y + 8;
        if (y < visTop) y = Math.min(visTop, first.top + first.height + 6);
      }
      el.style.left = x + 'px';
      el.style.top = Math.max(0, y) + 'px';
    }
  }

  function notePreview(p) {
    const el = h('button', { class: 'xnote', type: 'button', 'aria-label': 'Open this note' });
    const text = noteSummary(p) || (p.voice && p.voice.transcript) || '';
    if (text) el.append(h('div', { class: 'xtext' }, text));
    if (p.voice) el.append(voiceLine(p.voice));
    el.addEventListener('click', () => { ui.expanded = p.id; renderMarks(); });
    return el;
  }

  function noteCard(p) {
    const cat = catOf(p);
    const el = h('div', { class: 'xnote expanded', role: 'dialog', 'aria-label': 'My note' });
    el.append(h('div', { class: 'xhead' }, h('span', { class: 'chip-sym' }, cat.symbol), h('span', null, cat.name)));
    el.append(h('p', { class: 'xquote' }, '“' + quoteOf(p) + '”'));
    if (p.note && p.note.trim()) el.append(h('div', { class: 'xtext' }, p.note.trim()));
    if (p.voice) {
      const pl = playerRow(p.voice);
      el.append(pl);
      if (p.voice.transcript) el.append(h('div', { class: 'xtext', style: { marginTop: '8px' } }, p.voice.transcript));
    }
    el.append(h('div', { class: 'xactions' },
      h('button', { class: 'btn small', type: 'button', onclick: () => { ui.expanded = null; openSheet(p.id, 'card'); } }, 'Edit'),
      h('button', { class: 'btn small primary', type: 'button', onclick: () => { ui.expanded = null; stopPlayer(); renderMarks(); } }, 'Close')));
    return el;
  }

  // ---------------------------------------------------------------- selection

  const sel = { a: -1, b: -1, anchor: -1, focus: -1, fresh: null, dragging: null };
  const hasSel = () => sel.a >= 0;
  const knobStart = h('div', { class: 'handle-knob', 'data-kind': 'start', hidden: true });
  const knobEnd = h('div', { class: 'handle-knob', 'data-kind': 'end', hidden: true });
  const stemStart = h('div', { class: 'handle-stem', hidden: true });
  const stemEnd = h('div', { class: 'handle-stem', hidden: true });
  selUi.append(stemStart, stemEnd, knobStart, knobEnd);

  function setSel(anchor, focus) {
    sel.anchor = anchor;
    sel.focus = focus;
    sel.a = Math.min(anchor, focus);
    sel.b = Math.max(anchor, focus);
    renderSelection();
  }

  function clearSel() {
    sel.a = sel.b = sel.anchor = sel.focus = -1;
    sel.fresh = null;
    sel.dragging = null;
    renderSelection();
    closeQuick();
  }

  function renderSelection() {
    selUnder.textContent = '';
    const show = hasSel();
    for (const el of [knobStart, knobEnd, stemStart, stemEnd]) el.hidden = !show;
    if (!show) return;
    const lines = lineRects(sel.a, sel.b);
    if (!lines.length) return;
    for (const L of lines) selUnder.append(box('sel-rect', L));
    const a = lines[0], b = lines[lines.length - 1];
    place(stemStart, a.left - 0.75, a.top, a.height);
    place(stemEnd, b.left + b.width - 0.75, b.top, b.height);
    place(knobStart, a.left, a.top - 8);
    place(knobEnd, b.left + b.width, b.top + b.height + 8);
  }

  function place(el, x, y, height) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (height != null) el.style.height = height + 'px';
  }

  // ---------------------------------------------------------------- gestures on the page

  let g = null;            // the pointer being tracked on the page
  let dragOffset = { x: 0, y: 0 };
  let lastPt = null;
  let autoRAF = null;

  const isUiTarget = (t) => !!(t.closest && t.closest('.popover, .sym, .sym-note, .handle-knob, .xnote, .intro, button, input, textarea, a'));

  reader.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) { cancelGesture(); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isUiTarget(e.target)) return;
    const word = wordNear(e.clientX, e.clientY, 24);
    g = { id: e.pointerId, type: e.pointerType || 'touch', x0: e.clientX, y0: e.clientY, word, moved: false, long: false, timer: null };
    if (word >= 0 && !ui.sheet && !ui.noteSheet) g.timer = setTimeout(onLongPress, LONG_PRESS_MS);
  });

  reader.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const d = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
    const slop = SLOP[g.type] || SLOP.touch;
    if (sel.dragging === 'press' || sel.dragging === 'drag') {
      if (d > slop) g.moved = true;
      lastPt = { x: e.clientX, y: e.clientY };
      updateDrag();
      return;
    }
    if (d <= slop) return;
    g.moved = true;
    clearTimeout(g.timer);
    g.timer = null;
    // A mouse or the pen selects as it drags; a finger drag scrolls.
    if ((g.type === 'mouse' || g.type === 'pen') && g.word >= 0 && !ui.sheet && !ui.noteSheet) {
      startDrag('drag');
      lastPt = { x: e.clientX, y: e.clientY };
      updateDrag();
    } else if (g.type === 'touch') {
      g = null;
    }
  });

  reader.addEventListener('pointerup', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const gg = g;
    g = null;
    clearTimeout(gg.timer);
    if (sel.dragging === 'press' || sel.dragging === 'drag') {
      finishDrag(sel.dragging === 'press' && !gg.moved);
      return;
    }
    if (!gg.moved && !gg.long) onTap(e.clientX, e.clientY);
  });

  reader.addEventListener('pointercancel', (e) => {
    if (!g || e.pointerId !== g.id) return;
    clearTimeout(g.timer);
    const wasPress = sel.dragging === 'press' && !g.moved;
    g = null;
    if (sel.dragging === 'press' || sel.dragging === 'drag') finishDrag(wasPress);
  });

  reader.addEventListener('scroll', () => hideChip(), { passive: true });

  reader.addEventListener('contextmenu', (e) => {
    if (!(e.target.closest && e.target.closest('input, textarea'))) e.preventDefault();
  });

  function cancelGesture() {
    if (g) clearTimeout(g.timer);
    g = null;
  }

  function onLongPress() {
    if (!g) return;
    g.timer = null;
    g.long = true;
    startDrag('press');
  }

  function startDrag(how) {
    closeQuick();
    closeMarkPopover();
    hideChip();
    if (ui.expanded) { ui.expanded = null; renderMarks(); }
    dragOffset = { x: 0, y: 0 };
    sel.fresh = null;
    setSel(g.word, g.word);
    sel.dragging = how;
    try { reader.setPointerCapture(g.id); } catch (e) { /* not every pointer can be captured */ }
    lastPt = { x: g.x0, y: g.y0 };
    if (!autoRAF) autoRAF = requestAnimationFrame(autoScroll);
  }

  function updateDrag() {
    if (!lastPt) return;
    const w = wordNear(lastPt.x + dragOffset.x, lastPt.y + dragOffset.y);
    if (w >= 0 && w !== sel.focus) setSel(sel.anchor, w);
  }

  function finishDrag(liftedInPlace) {
    sel.dragging = null;
    lastPt = null;
    if (liftedInPlace && sel.a === sel.b && S.settings.sentence) {
      const r = sentenceRange(sel.a);
      setSel(r[0], r[1]);
      sel.fresh = { kind: 'sentence', at: now() };
    }
    showQuick();
  }

  // While dragging a selection near the top or bottom of the page, scroll the text.
  function autoScroll() {
    if (!sel.dragging || !lastPt) { autoRAF = null; return; }
    const r = reader.getBoundingClientRect();
    const edge = 44;
    let dy = 0;
    if (lastPt.y < r.top + edge) dy = -Math.ceil((r.top + edge - lastPt.y) / 3);
    else if (lastPt.y > r.bottom - edge) dy = Math.ceil((lastPt.y - (r.bottom - edge)) / 3);
    if (dy) {
      reader.scrollTop += dy;
      updateDrag();
    }
    autoRAF = requestAnimationFrame(autoScroll);
  }

  function onTap(x, y) {
    if (ui.sheet) { closeSheet(); return; }
    if (ui.noteSheet) { closeNoteSheet(); return; }
    if (ui.markPop) { closeMarkPopover(); return; }
    if (ui.menu) { closeMenu(); return; }
    if (ui.expanded) { ui.expanded = null; stopPlayer(); renderMarks(); return; }
    hideChip();
    const w = wordNear(x, y, 14);
    if (hasSel()) {
      if (w >= sel.a && w <= sel.b) {
        // Tapping a fresh sentence grows it to the paragraph, as in the Reader.
        if (sel.fresh && sel.fresh.kind === 'sentence' && now() - sel.fresh.at < GROW_WINDOW_MS) {
          const r = paragraphRange(w);
          if (r[0] !== sel.a || r[1] !== sel.b) {
            setSel(r[0], r[1]);
            sel.fresh = { kind: 'paragraph', at: now() };
            showQuick();
          }
        }
        return;
      }
      clearSel();
      return;
    }
    if (w >= 0) {
      const p = passageAt(w);
      if (p) {
        if (isOrig()) openMarkPopover(p.id);
        else openSheet(p.id, 'tap');
      }
    }
  }

  function passageAt(w) {
    let best = null;
    for (const p of curList()) {
      if (w < p.start || w > p.end) continue;
      if (!best || (p.end - p.start) < (best.end - best.start) || ((p.end - p.start) === (best.end - best.start) && p.created > best.created)) best = p;
    }
    return best;
  }

  // Selection handles: drag either end word by word.
  let hd = null;
  for (const knob of [knobStart, knobEnd]) {
    knob.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!hasSel()) return;
      try { knob.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      closeQuick();
      const kind = knob.dataset.kind;
      const lines = lineRects(sel.a, sel.b);
      const o = origin();
      const L = kind === 'start' ? lines[0] : lines[lines.length - 1];
      const tx = o.x + (kind === 'start' ? L.left + 2 : L.left + L.width - 2);
      const ty = o.y + L.top + L.height / 2;
      dragOffset = { x: tx - e.clientX, y: ty - e.clientY };
      sel.anchor = kind === 'start' ? sel.b : sel.a;
      sel.focus = kind === 'start' ? sel.a : sel.b;
      sel.fresh = null;
      sel.dragging = 'handle';
      hd = { id: e.pointerId };
      lastPt = { x: e.clientX, y: e.clientY };
      if (!autoRAF) autoRAF = requestAnimationFrame(autoScroll);
    });
    knob.addEventListener('pointermove', (e) => {
      if (!hd || e.pointerId !== hd.id) return;
      lastPt = { x: e.clientX, y: e.clientY };
      updateDrag();
    });
    const end = (e) => {
      if (!hd || e.pointerId !== hd.id) return;
      hd = null;
      sel.dragging = null;
      lastPt = null;
      showQuick();
    };
    knob.addEventListener('pointerup', end);
    knob.addEventListener('pointercancel', end);
  }

  // Touch: once a selection drag has started, the finger moves the selection instead of scrolling.
  // Two still fingers held on the page in the annotations view hide the note boxes until they lift.
  const peek = { timer: null, on: false, pts: null };
  reader.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      cancelGesture();
      if (sel.dragging === 'press' || sel.dragging === 'drag') finishDrag(false);
      peek.pts = Array.from(e.touches).map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
      clearTimeout(peek.timer);
      peek.timer = setTimeout(() => {
        peek.timer = null;
        if (S.settings.view !== 'annotations' || isOrig()) return;
        peek.on = true;
        document.body.classList.add('peek');
      }, PEEK_HOLD_MS);
    } else if (e.touches.length > 2) {
      endPeek();
    }
  }, { passive: true });
  reader.addEventListener('touchmove', (e) => {
    if (sel.dragging) { e.preventDefault(); return; }
    if (peek.pts && peek.timer) {
      for (const t of Array.from(e.touches)) {
        const s = peek.pts.find((q) => q.id === t.identifier);
        if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 14) { endPeek(); break; }
      }
    }
    if (peek.on) e.preventDefault();
  }, { passive: false });
  const touchEnd = (e) => { if (e.touches.length < 2) endPeek(); };
  reader.addEventListener('touchend', touchEnd);
  reader.addEventListener('touchcancel', touchEnd);
  function endPeek() {
    clearTimeout(peek.timer);
    peek.timer = null;
    peek.pts = null;
    if (peek.on) { peek.on = false; document.body.classList.remove('peek'); }
  }
  // On a computer, hold Alt to peek.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && S.settings.view === 'annotations' && !isOrig()) { document.body.classList.add('peek'); e.preventDefault(); }
    if (e.key === 'Escape') { if (window.protoHandleBack()) e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt') document.body.classList.remove('peek'); });
  window.addEventListener('blur', () => document.body.classList.remove('peek'));

  // ---------------------------------------------------------------- press and hold on buttons

  function attachHold(el, onTap, onHold) {
    let timer = null, held = false, id = null, x0 = 0, y0 = 0;
    const cancel = () => { clearTimeout(timer); timer = null; id = null; el.classList.remove('pressed'); };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      id = e.pointerId; held = false; x0 = e.clientX; y0 = e.clientY;
      try { el.setPointerCapture(id); } catch (err) { /* ignore */ }
      el.classList.add('pressed');
      timer = setTimeout(() => {
        timer = null;
        held = true;
        el.classList.remove('pressed');
        el.classList.add('held');
        setTimeout(() => el.classList.remove('held'), 140);
        onHold();
      }, HOLD_MS);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id || !timer) return;
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > 14) cancel();
    });
    el.addEventListener('pointerup', (e) => {
      if (e.pointerId !== id) return;
      const wasHeld = held;
      const live = !!timer;
      cancel();
      if (!wasHeld && live) onTap();
    });
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.shiftKey ? onHold : onTap)(); }
      if (e.key === 'ContextMenu') { e.preventDefault(); onHold(); }
    });
  }

  // A category's button shows its symbol wearing the category's formatting.
  function catButton(c, opts) {
    const fmt = c.format;
    const b = h('button', {
      type: 'button',
      class: 'cat' + (fmt ? ' look-' + fmt : ''),
      'aria-label': `${c.name}${opts.pressed != null ? '' : '. Tap to save, hold for options'}`,
      'aria-pressed': opts.pressed == null ? null : String(!!opts.pressed),
      title: opts.titleName ? c.name : null,
      'data-cat': c.id,
    }, h('span', { class: 'glyph look', style: { '--band': `var(--band-${c.gray})` } }, h('span', { class: 'g' }, c.symbol)));
    attachHold(b, opts.onTap, opts.onHold);
    return b;
  }

  // ---------------------------------------------------------------- Save passage: quick select

  function showQuick() {
    closeQuick();
    if (!hasSel() || ui.sheet || ui.noteSheet) return;
    if (isOrig()) { showStrip(); return; }
    const lines = lineRects(sel.a, sel.b);
    if (!lines.length) return;
    const editBtn = h('button', { type: 'button', class: 'cat ghost', 'aria-label': 'Edit or add a category' }, icon('pencil', 24));
    attachHold(editBtn, () => editOpen(), () => editOpen());
    const pop = h('div', { class: 'popover', role: 'dialog', 'aria-label': 'Save passage' },
      h('h3', null, 'Save passage'),
      h('div', { class: 'rule' }),
      h('div', { class: 'cat-row' },
        S.categories.map((c) => catButton(c, { onTap: () => quickSave(c), onHold: () => holdOpen(c) })),
        editBtn),
      S.settings.hints ? h('div', { class: 'meta hint' }, 'Tap to save. Hold for a note and formatting.') : null);
    quickUi.append(pop);
    ui.quick = pop;
    placeNear(pop, lines, 24);
  }

  // Put a popover 8px below some lines (plus room for a handle), or above them if there's no room,
  // at least 16px from the sides of the screen (DlLayoutMath.popoverPosition).
  function placeNear(pop, lines, gap) {
    const o = origin();
    const rr = reader.getBoundingClientRect();
    const sheetH = ui.sheet || ui.noteSheet ? (ui.sheet || ui.noteSheet).el.offsetHeight : 0;
    const visTop = rr.top - o.y, visBottom = Math.min(rr.bottom, window.innerHeight - sheetH) - o.y;
    const visLeft = rr.left - o.x, visRight = rr.right - o.x;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const top = lines[0].top;
    const last = lines[lines.length - 1];
    const bottom = last.top + last.height;
    let minL = Infinity, maxR = -Infinity;
    for (const L of lines) { minL = Math.min(minL, L.left); maxR = Math.max(maxR, L.left + L.width); }
    let y = bottom + gap;
    if (y + ph > visBottom - 8) y = top - gap + 2 - ph;
    if (y < visTop + 8) y = clamp(bottom + gap, visTop + 8, Math.max(visTop + 8, visBottom - ph - 8));
    const x = clamp((minL + maxR) / 2 - pw / 2, visLeft + 16, Math.max(visLeft + 16, visRight - 16 - pw));
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
  }

  function closeQuick() {
    if (ui.quick) { ui.quick.remove(); ui.quick = null; }
  }

  function upsertPassage(c) {
    let p = S.passages.find((q) => q.start === sel.a && q.end === sel.b);
    if (p) {
      p.categoryId = c.id;
      p.ownFormat = c.format ? null : 'none';
    } else {
      p = { id: uid(), start: sel.a, end: sel.b, categoryId: c.id, ownFormat: c.format ? null : 'none', note: '', voice: null, created: Date.now() };
      S.passages.push(p);
    }
    S.settings.lastCategoryId = c.id;
    return p;
  }

  function quickSave(c) {
    if (!hasSel()) return;
    const before = snapshot();
    const p = upsertPassage(c);
    clearSel();
    save();
    // A category with no default formatting asks each time.
    if (!c.format) { openSheet(p.id, 'nodefault'); return; }
    renderMarks();
    toast(`Saved to ${c.symbol} ${c.name}.`, [
      { label: 'Add note', run: () => openSheet(p.id, 'note') },
      { label: 'Undo', run: () => restore(before) },
    ]);
  }

  function holdOpen(c) {
    if (!hasSel()) return;
    const p = upsertPassage(c);
    clearSel();
    save();
    openSheet(p.id, 'hold');
  }

  function editOpen() {
    if (!hasSel()) return;
    const c = catById(S.settings.lastCategoryId) || S.categories[0];
    const p = upsertPassage(c);
    clearSel();
    save();
    openSheet(p.id, 'edit');
  }

  // ---------------------------------------------------------------- Save passage: hold / edit view

  function openSheet(pid, via) {
    const p = byId(pid);
    if (!p) return;
    if (ui.sheet) closeSheet(true);
    closeQuick();
    closeMenu();
    closePanel();
    if (hasSel()) clearSel();
    ui.expanded = null;
    const isNew = !['tap', 'symbol', 'panel', 'card'].includes(via);
    const r = {};
    const el = h('div', { class: 'sheet', role: 'dialog', 'aria-label': isNew ? 'Save passage' : 'Edit passage' });

    el.append(h('div', { class: 'sheet-head' }, h('h2', null, isNew ? 'Save passage' : 'Edit passage')));

    // Categories (selected = the passage's), plus "add".
    r.cats = h('div', { class: 'cat-row', role: 'group', 'aria-label': 'Category' });
    // The category's name, editable in place.
    r.name = h('input', { type: 'text', id: 'cat-name', maxlength: '40', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done', 'aria-label': 'Category name' });
    r.name.addEventListener('input', () => {
      catOf(p).name = r.name.value;
      saveSoon();
      refreshCatButtons(r, p);
    });
    r.name.addEventListener('change', () => {
      const c = catOf(p);
      c.name = c.name.trim() || 'Untitled';
      r.name.value = c.name;
      save();
    });
    r.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') r.name.blur(); });
    r.delCat = h('button', { type: 'button', class: 'btn quiet small', onclick: () => askDeleteCategory(r, p) }, 'Delete category');
    r.confirm = h('div');
    el.append(h('section', null,
      r.cats,
      h('div', { class: 'name-row' }, h('label', { class: 'name-field' }, r.name, icon('pencil', 20)), r.delCat),
      r.confirm));

    // Notes.
    r.noteBtn = h('button', { type: 'button', class: 'btn', onclick: () => showTextNote(r, p) }, 'Add text note');
    r.voiceBtn = h('button', { type: 'button', class: 'btn' }, icon('mic', 20), h('span', null, 'Add voice note'));
    // Recording starts on the press, as in the Reader.
    r.voiceBtn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (!p.voice && !rec) startRecording(p, sheetHost(r, p));
    });
    r.voiceBtn.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !p.voice && !rec) { e.preventDefault(); startRecording(p, sheetHost(r, p)); }
    });
    r.noteArea = h('textarea', { class: 'note-area', id: 'note-text', rows: '2', placeholder: 'Type a note', 'aria-label': 'Text note' });
    r.noteArea.value = p.note || '';
    r.noteArea.hidden = !(p.note && p.note.length);
    r.noteArea.addEventListener('input', () => {
      p.note = r.noteArea.value;
      grow(r.noteArea);
      saveSoon();
      updateSheet(r, p);
      if (S.settings.view === 'annotations') renderMarks();
    });
    r.voiceArea = h('div');
    el.append(h('section', null, h('div', { class: 'note-buttons' }, r.noteBtn, r.voiceBtn), r.noteArea, r.voiceArea));

    // Formatting.
    r.defaultBox = h('button', { type: 'button', class: 'checkbox', role: 'checkbox', 'aria-checked': 'true', onclick: () => toggleDefault(r, p) },
      h('span', { class: 'box' }, icon('check', 18)), h('span', { class: 'label' }, 'Set as default for category'));
    r.chips = FORMATS.map((f) => {
      const chip = h('button', { type: 'button', class: 'chip look-' + f.id, 'aria-pressed': 'false', 'data-format': f.id, onclick: () => pickFormat(r, p, f.id) },
        h('span', { class: 'look' }, f.label));
      return chip;
    });
    r.formatNote = h('div', { class: 'meta', style: { marginTop: '6px' } });
    r.shades = SHADES.map((g) => h('button', { type: 'button', class: 'shade', 'aria-pressed': 'false', 'aria-label': `Shade ${g}`, style: { '--band': `var(--band-${g})` }, onclick: () => pickShade(r, p, g) }));
    r.shadeRow = h('div', { class: 'shade-row' }, h('span', { class: 'meta' }, 'Shade'), r.shades);
    el.append(h('section', null,
      h('div', { class: 'format-head' }, h('span', { class: 'counter' }, 'Select formatting'), r.defaultBox),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Formatting' }, r.chips),
      r.shadeRow,
      r.formatNote));

    // Symbol.
    r.symbolBtn = h('button', { type: 'button', class: 'symbol-btn', 'aria-label': 'Select symbol', onclick: () => {
      const c = catOf(p);
      openPicker({ current: c.symbol, choose: (sym) => { c.symbol = sym; save(); buildCatRow(r, p); updateSheet(r, p); renderMarks(); } });
    } });
    el.append(h('section', null, h('div', { class: 'symbol-row' }, h('span', { class: 'counter' }, 'Select symbol'), r.symbolBtn,
      h('span', { class: 'meta' }, 'Opens the symbol and emoji menu'))));

    el.append(h('div', { class: 'sheet-foot' },
      h('button', { type: 'button', class: 'btn quiet', onclick: () => removePassage(p) }, 'Remove highlight'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => closeSheet() }, 'Done')));

    overlayRoot.append(el);
    ui.sheet = { el, pid, r, via };
    $('#toast').classList.add('raised');
    buildCatRow(r, p);
    renderVoiceArea(r, p);
    updateSheet(r, p);
    r.name.value = catOf(p).name;
    if (via === 'note') showTextNote(r, p);

    // Keep the passage in view above the sheet.
    const ro = new ResizeObserver(() => fitSheet());
    ro.observe(el);
    ui.sheet.ro = ro;
    fitSheet(true);
    renderMarks();
  }

  function fitSheet(scroll) {
    if (!ui.sheet) return;
    const hgt = ui.sheet.el.offsetHeight;
    pageEl.style.paddingBottom = (hgt + 48) + 'px';
    document.documentElement.style.setProperty('--sheet-h', hgt + 'px');
    if (!scroll) return;
    const p = byId(ui.sheet.pid);
    if (!p) return;
    const lines = lineRects(p.start, p.end);
    if (!lines.length) return;
    const o = origin();
    const rr = reader.getBoundingClientRect();
    const sheetTop = window.innerHeight - hgt;
    const top = o.y + lines[0].top;
    const bottom = o.y + lines[lines.length - 1].top + lines[lines.length - 1].height;
    const room = sheetTop - rr.top;
    if (top < rr.top + 8 || bottom > sheetTop - 16) {
      const want = rr.top + Math.max(16, Math.min(room * 0.2, room - (bottom - top) - 16));
      reader.scrollTop += top - want;
    }
  }

  function closeSheet() {
    if (!ui.sheet) return;
    if (rec) stopRecording(true);
    stopPlayer();
    const { el, ro, pid } = ui.sheet;
    if (ro) ro.disconnect();
    const p = byId(pid);
    if (p) {
      const c = catOf(p);
      c.name = (c.name || '').trim() || 'Untitled';
      if (p.note) p.note = p.note.replace(/\s+$/, '');
    }
    el.remove();
    ui.sheet = null;
    $('#toast').classList.remove('raised');
    closePicker();
    pageEl.style.paddingBottom = '';
    document.documentElement.style.setProperty('--sheet-h', '0px');
    save();
    renderMarks();
  }

  function buildCatRow(r, p) {
    r.cats.textContent = '';
    for (const c of S.categories) {
      r.cats.append(catButton(c, { pressed: c.id === p.categoryId, titleName: true, onTap: () => assignCategory(r, p, c), onHold: () => assignCategory(r, p, c) }));
    }
    const add = h('button', { type: 'button', class: 'cat ghost', 'aria-label': 'Add a category', title: 'Add a category', onclick: () => addCategory(r, p) }, icon('plus', 26));
    r.cats.append(add);
  }

  function refreshCatButtons(r, p) {
    buildCatRow(r, p);
  }

  function updateSheet(r, p) {
    const c = catOf(p);
    const eff = effFormat(p);
    const followsDefault = p.ownFormat == null;
    for (const b of r.cats.querySelectorAll('.cat[data-cat]')) b.setAttribute('aria-pressed', String(b.dataset.cat === p.categoryId));
    if (document.activeElement !== r.name) r.name.value = c.name;
    r.delCat.hidden = S.categories.length < 2;
    const hasText = !r.noteArea.hidden;
    r.noteBtn.textContent = hasText ? 'Text note' : 'Add text note';
    r.noteBtn.classList.toggle('pressed', false);
    r.noteBtn.setAttribute('aria-pressed', String(hasText));
    r.voiceBtn.lastChild.textContent = p.voice ? 'Voice note' : (rec ? 'Recording' : 'Add voice note');
    r.voiceBtn.setAttribute('aria-pressed', String(!!p.voice || !!rec));
    r.defaultBox.setAttribute('aria-checked', String(followsDefault));
    for (const chip of r.chips) chip.setAttribute('aria-pressed', String(chip.dataset.format === eff));
    for (const chip of r.chips) chip.style.setProperty('--band', `var(--band-${c.gray})`);
    r.shadeRow.hidden = eff !== 'highlight';
    r.shades.forEach((s, i) => s.setAttribute('aria-pressed', String(c.gray === i + 1)));
    const sym = `${c.symbol} ${c.name.trim() || 'this category'}`;
    if (followsDefault) {
      r.formatNote.textContent = eff
        ? `This is ${sym}'s formatting. Tapping ${c.symbol} in Save passage uses it.`
        : `${sym} has no default formatting, so it asks each time.`;
    } else {
      r.formatNote.textContent = eff ? 'Just for this passage.' : 'No formatting on this passage, only its symbol.';
    }
    r.symbolBtn.textContent = c.symbol;
  }

  function assignCategory(r, p, c) {
    const prev = effFormat(p);
    p.categoryId = c.id;
    p.ownFormat = c.format ? null : (prev || 'none');
    S.settings.lastCategoryId = c.id;
    save();
    r.name.value = c.name;
    r.confirm.textContent = '';
    updateSheet(r, p);
    renderMarks();
  }

  function addCategory(r, p) {
    const used = new Set(S.categories.map((c) => c.symbol));
    const symbol = NEW_CATEGORY_SYMBOLS.find((s) => !used.has(s)) || '●';
    const gray = SHADES.find((g) => !S.categories.some((c) => c.gray === g)) || ((S.categories.length % 4) + 1);
    const c = { id: uid(), name: 'New category', symbol, gray, format: null };
    S.categories.push(c);
    buildCatRow(r, p);
    assignCategory(r, p, c);
    r.name.focus();
    r.name.select();
  }

  function askDeleteCategory(r, p) {
    const c = catOf(p);
    const others = S.categories.filter((x) => x.id !== c.id);
    if (!others.length) return;
    const to = others[0];
    const count = S.passages.filter((q) => q.categoryId === c.id).length;
    r.confirm.textContent = '';
    r.confirm.append(h('div', { class: 'confirm' },
      h('div', null, `Delete ${c.symbol} ${c.name}? ${count === 1 ? 'Its passage moves' : `Its ${count} passages move`} to ${to.symbol} ${to.name}.`),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small', onclick: () => { r.confirm.textContent = ''; } }, 'Keep it'),
        h('button', { type: 'button', class: 'btn small primary', onclick: () => {
          const before = snapshot();
          for (const q of S.passages) if (q.categoryId === c.id) { const eff = effFormat(q); q.categoryId = to.id; q.ownFormat = eff === (to.format || null) ? null : (eff || 'none'); }
          S.categories = others;
          if (S.settings.lastCategoryId === c.id) S.settings.lastCategoryId = to.id;
          r.confirm.textContent = '';
          save();
          buildCatRow(r, p);
          updateSheet(r, p);
          renderMarks();
          toast('Category deleted.', [{ label: 'Undo', run: () => restore(before) }]);
        } }, 'Delete category'))));
  }

  function toggleDefault(r, p) {
    const c = catOf(p);
    const eff = effFormat(p);
    if (p.ownFormat == null) {
      p.ownFormat = eff || 'none';           // keep the look, just for this passage
    } else {
      c.format = eff;                          // this look becomes the category's preset
      p.ownFormat = null;
    }
    save();
    buildCatRow(r, p);
    updateSheet(r, p);
    renderMarks();
  }

  function pickFormat(r, p, f) {
    const c = catOf(p);
    const next = effFormat(p) === f ? null : f;
    if (p.ownFormat == null) c.format = next; else p.ownFormat = next || 'none';
    save();
    buildCatRow(r, p);
    updateSheet(r, p);
    renderMarks();
  }

  function pickShade(r, p, gray) {
    catOf(p).gray = gray;
    save();
    buildCatRow(r, p);
    updateSheet(r, p);
    renderMarks();
  }

  function showTextNote(r, p) {
    r.noteArea.hidden = false;
    updateSheet(r, p);
    grow(r.noteArea);
    r.noteArea.focus();
    const n = r.noteArea.value.length;
    try { r.noteArea.setSelectionRange(n, n); } catch (e) { /* ignore */ }
  }

  function grow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(72, ta.scrollHeight + 3) + 'px';
  }

  function removePassage(p) {
    const before = snapshot();
    S.passages = S.passages.filter((q) => q.id !== p.id);
    save();
    closeSheet();
    toast('Highlight removed.', [{ label: 'Undo', run: () => restore(before) }]);
  }

  // ---------------------------------------------------------------- voice notes

  let rec = null;
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Where a recording shows: the Christine sheet's voice area, or Original mode's recording bar.
  function sheetHost(r, p) {
    return { render(problem) { renderVoiceArea(r, p, problem); updateSheet(r, p); } };
  }

  async function startRecording(p, host) {
    const state = { pid: p.id, host, started: Date.now(), peaks: [], chunks: [], simulated: false, transcript: '', interim: '', timer: null };
    rec = state;
    host.render();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no getUserMedia');
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (rec === state) rec = null;
      host.render('nomic');
      return;
    }
    if (rec !== state) { state.stream.getTracks().forEach((t) => t.stop()); return; }
    const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
    const mime = (window.MediaRecorder && types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t))) || '';
    try {
      state.mr = mime ? new MediaRecorder(state.stream, { mimeType: mime }) : new MediaRecorder(state.stream);
      state.mr.ondataavailable = (e) => { if (e.data && e.data.size) state.chunks.push(e.data); };
      state.mr.start(250);
    } catch (err) {
      state.stream.getTracks().forEach((t) => t.stop());
      rec = null;
      host.render('nomic');
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      state.ac = new AC();
      const src = state.ac.createMediaStreamSource(state.stream);
      state.an = state.ac.createAnalyser();
      state.an.fftSize = 1024;
      src.connect(state.an);
      state.buf = new Uint8Array(state.an.fftSize);
    } catch (err) { state.an = null; }
    if (SpeechRec) {
      try {
        const sr = new SpeechRec();
        sr.continuous = true;
        sr.interimResults = true;
        sr.lang = navigator.language || 'en-US';
        sr.onresult = (e) => {
          let fin = '', inter = '';
          for (let i = 0; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) fin += t; else inter += t;
          }
          state.transcript = fin;
          state.interim = inter;
          if (state.tEl) state.tEl.textContent = (fin + ' ' + inter).trim() || 'Listening…';
        };
        sr.onerror = () => { state.srFailed = true; };
        sr.onend = () => { if (rec === state && !state.srFailed) { try { sr.start(); } catch (e) { /* ended */ } } };
        sr.start();
        state.sr = sr;
      } catch (err) { state.sr = null; }
    }
    state.timer = setInterval(() => tickRecording(state), 100);
    host.render();
  }

  function startPretend(p, host) {
    const state = { pid: p.id, host, started: Date.now(), peaks: [], chunks: [], simulated: true, transcript: '', interim: '', phase: Math.random() * 6 };
    rec = state;
    state.timer = setInterval(() => tickRecording(state), 100);
    host.render();
  }

  function tickRecording(state) {
    let peak;
    if (state.simulated) {
      state.phase += 0.35;
      peak = Math.max(0.05, Math.abs(Math.sin(state.phase) * 0.6 + Math.sin(state.phase * 2.7) * 0.3) * (0.6 + Math.random() * 0.4));
    } else if (state.an) {
      state.an.getByteTimeDomainData(state.buf);
      let m = 0;
      for (let i = 0; i < state.buf.length; i++) m = Math.max(m, Math.abs(state.buf[i] - 128));
      peak = Math.min(1, (m / 128) * 1.6);
    } else peak = 0.2;
    state.peaks.push(peak);
    const elapsed = Date.now() - state.started;
    if (state.timerEl) state.timerEl.textContent = fmtTime(elapsed);
    if (state.waveEl) {
      const bars = state.waveEl.children;
      const recent = state.peaks.slice(-bars.length);
      const hmax = state.waveEl.clientHeight || 22;
      for (let i = 0; i < bars.length; i++) {
        const v = recent[i - (bars.length - recent.length)] || 0;
        bars[i].style.height = Math.max(2, Math.round(v * hmax)) + 'px';
      }
    }
    if (elapsed >= MAX_RECORD_MS) stopRecording(true);
  }

  function stopRecording(keep) {
    const state = rec;
    if (!state) return;
    rec = null;
    clearInterval(state.timer);
    const durationMs = Date.now() - state.started;
    const p = byId(state.pid);
    const finish = (blob) => {
      if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
      if (state.ac) { try { state.ac.close(); } catch (e) { /* closed */ } }
      if (state.sr) { try { state.sr.stop(); } catch (e) { /* stopped */ } }
      const voice = {
        id: uid(),
        durationMs,
        waveform: downsample(state.peaks, 64),
        transcript: ((state.transcript || '') + ' ' + (state.interim || '')).trim(),
        hasAudio: !!blob,
        simulated: state.simulated,
      };
      if (blob) putAudio(voice.id, blob);
      if (!p) return;
      if (keep) {
        p.voice = voice;
        save();
        toast('Saved my voice note.');
      } else {
        toast('Recording discarded.', [{ label: 'Undo', run: () => { p.voice = voice; save(); state.host.render(); renderMarks(); } }]);
      }
      state.host.render();
      renderMarks();
      if (ui.markPop && ui.markPop.pid === p.id) renderMarkPopover();
    };
    // The bar goes away at once; the audio file finishes in the background.
    state.host.render();
    if (state.mr && state.mr.state !== 'inactive') {
      state.mr.onstop = () => finish(state.chunks.length ? new Blob(state.chunks, { type: state.mr.mimeType || 'audio/webm' }) : null);
      try { state.mr.stop(); } catch (e) { finish(null); }
    } else {
      finish(null);
    }
  }

  function downsample(arr, n) {
    if (!arr.length) return new Array(n).fill(0.1);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i * arr.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * arr.length) / n));
      let m = 0;
      for (let k = a; k < b && k < arr.length; k++) m = Math.max(m, arr[k]);
      out.push(m);
    }
    const max = Math.max(0.05, ...out);
    return out.map((v) => Math.round((v / max) * 100) / 100);
  }

  function renderVoiceArea(r, p, problem) {
    r.voiceArea.textContent = '';
    if (rec && rec.pid === p.id) {
      const timerEl = h('span', { class: 'timer' }, fmtTime(Date.now() - rec.started));
      const waveEl = h('div', { class: 'wave' });
      for (let i = 0; i < 40; i++) waveEl.append(h('i'));
      rec.timerEl = timerEl;
      rec.waveEl = waveEl;
      r.voiceArea.append(h('div', { class: 'recorder', role: 'group', 'aria-label': 'Recording a voice note' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Discard this recording', onclick: () => stopRecording(false) }, icon('close', 20)),
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
        timerEl,
        waveEl,
        h('button', { type: 'button', class: 'btn primary', onclick: () => stopRecording(true) }, 'Stop')));
      if (rec.simulated) r.voiceArea.append(h('div', { class: 'meta', style: { marginTop: '6px' } }, 'Pretend recording: this screen can’t use the microphone, so nothing is captured.'));
      if (rec.sr || SpeechRec) {
        rec.tEl = h('div', { class: 'meta', style: { marginTop: '6px' } }, 'Listening…');
        r.voiceArea.append(rec.tEl);
      }
      return;
    }
    if (problem === 'nomic') {
      r.voiceArea.append(h('div', { class: 'confirm' },
        h('div', null, 'I need the microphone to record a voice note. If you turned it down, allow it for this app in Android settings.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', onclick: () => startPretend(p, sheetHost(r, p)) }, 'Pretend to record'))));
      return;
    }
    if (!p.voice) return;
    const v = p.voice;
    r.voiceArea.append(playerRow(v, () => {
      const before = snapshot();
      p.voice = null;
      save();
      renderVoiceArea(r, p);
      updateSheet(r, p);
      renderMarks();
      toast('Voice note removed.', [{ label: 'Undo', run: () => restore(before) }]);
    }));
    const ta = h('textarea', { class: 'note-area', id: 'voice-transcript', rows: '2', placeholder: 'Transcript. Type to add or correct it.', 'aria-label': 'Transcript' });
    ta.value = v.transcript || '';
    ta.addEventListener('input', () => { v.transcript = ta.value; grow(ta); saveSoon(); if (S.settings.view === 'annotations') renderMarks(); });
    r.voiceArea.append(h('div', { class: 'field-label' }, h('span', { class: 'counter' }, 'Transcript preview'), h('span', { class: 'meta' }, 'Editable')), ta);
    requestAnimationFrame(() => grow(ta));
    if (!v.transcript) {
      r.voiceArea.append(h('div', { class: 'meta', style: { marginTop: '6px' } },
        SpeechRec ? 'I didn’t catch any words. Type what you said if you like.'
          : 'Speech-to-text isn’t connected in this prototype, so type what you said if you like.'));
    }
  }

  // ---------------------------------------------------------------- playback

  let player = null;
  function stopPlayer() {
    if (!player) return;
    try { player.audio.pause(); } catch (e) { /* ignore */ }
    if (player.url) URL.revokeObjectURL(player.url);
    if (player.btn) player.btn.replaceChildren(icon('play', 22));
    if (player.bars) for (const b of player.bars) b.classList.remove('unplayed');
    player = null;
  }

  function playerRow(v, onDelete) {
    const bars = downsample(v.waveform || [], 32);
    const waveEl = h('div', { class: 'wave' }, bars.map((x) => h('i', { style: { height: Math.max(2, Math.round(x * 22)) + 'px' } })));
    const btn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Play my voice note' }, icon('play', 22));
    const row = h('div', { class: 'player' }, btn, waveEl, h('span', { class: 'timer' }, fmtTime(v.durationMs)),
      onDelete ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete my voice note', title: 'Delete voice note', onclick: () => { stopPlayer(); onDelete(); } }, icon('trash', 20)) : null);
    btn.addEventListener('click', async () => {
      if (player && player.vid === v.id) { stopPlayer(); return; }
      stopPlayer();
      if (!v.hasAudio) {
        toast(v.simulated ? 'That was a pretend recording, so there’s nothing to play.' : 'This sample has no audio.');
        return;
      }
      const blob = await getAudio(v.id);
      if (!blob) { toast('I can’t find that recording on this device.'); return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const els = Array.from(waveEl.children);
      player = { vid: v.id, audio, url, btn, bars: els };
      btn.replaceChildren(icon('pause', 22));
      els.forEach((b) => b.classList.add('unplayed'));
      audio.addEventListener('timeupdate', () => {
        const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : v.durationMs / 1000;
        const k = Math.round((audio.currentTime / dur) * els.length);
        els.forEach((b, i) => b.classList.toggle('unplayed', i >= k));
      });
      audio.addEventListener('ended', stopPlayer);
      audio.play().catch(() => { stopPlayer(); toast('I couldn’t play that recording here.'); });
    });
    return row;
  }

  // ================================================================ Original mode: today's Reader
  // Modelled on the Reader's SelectionStrip, MarkPopover, NotePeekCard, NoteSheet and VoiceRecorderBar.

  const LEVEL_SYMBOLS = ['○', '★', '?', '✓'];   // Symbols.BUILT_IN
  const LEVEL_PCT = [14, 27, 41, 53];
  const LOOKS = [['band', 'Highlight'], ['underline', 'Underline'], ['strike', 'Strike out'], ['squiggly', 'Squiggly']];
  const levelSym = (p) => p.symbol || LEVEL_SYMBOLS[p.level - 1];
  const hasOrigNote = (p) => !!((p.note && p.note.trim()) || (p.ink && p.ink.strokes && p.ink.strokes.length));

  function renderOriginalMarks() {
    const col = column();
    const list = S.orig.slice().sort((p, q) => p.start - q.start || p.created - q.created);
    const rightSlots = new Map();
    for (const p of list) {
      const lines = lineRects(p.start, p.end);
      p._lines = lines;
      if (!lines.length) continue;
      for (const L of lines) {
        if (p.style === 'note') marksOver.append(box('line-mark dotted', { left: L.left, top: L.top + L.height - 2.5, width: L.width }));
        else drawLook(p.style === 'band' ? 'highlight' : p.style, p.level, L);
      }
      const first = lines[0], last = lines[lines.length - 1];
      // The symbol sits in the margin left of the first line (SymbolPlacement on PDF pages).
      if (p.style !== 'note') {
        marksUi.append(h('button', {
          class: 'sym small', type: 'button', style: { left: col.left - 22, top: first.top + first.height / 2 - 10 },
          'aria-label': 'Open this highlight', onclick: () => openMarkPopover(p.id),
        }, h('span', { class: 'g' }, levelSym(p))));
      }
      // The note glyph sits in the right margin level with the first line; the voice stamp by the last line.
      const slot = (L) => { const k = Math.round(L.top / 4); const n = rightSlots.get(k) || 0; rightSlots.set(k, n + 1); return n; };
      if (hasOrigNote(p)) {
        const n = slot(first);
        marksUi.append(h('button', {
          class: 'note-glyph', type: 'button', style: { left: col.right + 8 + n * 36, top: first.top + first.height / 2 - 12 },
          'aria-label': 'Peek at my note', onclick: () => { ui.expanded = p.id; renderMarks(); },
        }, icon('note', 18)));
      }
      if (p.voice) {
        const n = slot(last);
        marksUi.append(h('button', {
          class: 'stamp-btn', type: 'button', style: { left: col.right + 6 + n * 36, top: last.top + last.height / 2 - 12 },
          'aria-label': 'Peek at my voice note', onclick: () => { ui.expanded = p.id; renderMarks(); },
        }, stamp(p.voice)));
      }
    }
    if (ui.expanded) {
      const p = S.orig.find((q) => q.id === ui.expanded);
      if (p && p._lines && p._lines.length) {
        const card = peekCard(p);
        marksUi.append(card);
        placeNear(card, p._lines, 8);
      }
    }
  }

  // NotePeekCard: the quote, the note, then "Open my note".
  function peekCard(p) {
    const el = h('div', { class: 'popover peek-card', role: 'dialog', 'aria-label': 'My note' });
    el.append(h('p', { class: 'xquote clamp2' }, '“' + quoteOf(p) + '”'));
    if (p.note && p.note.trim()) el.append(h('div', { class: 'body clamp6' }, p.note.trim()));
    else if (p.ink && p.ink.strokes && p.ink.strokes.length) el.append(inkThumb(p.ink, 120));
    if (p.voice) {
      el.append(playerRow(p.voice));
      if (p.voice.transcript) el.append(h('div', { class: 'meta clamp2' }, p.voice.transcript));
    }
    el.append(h('button', { type: 'button', class: 'btn wide', onclick: () => { ui.expanded = null; openNoteSheet(p.id); } }, hasOrigNote(p) ? 'Open my note' : 'Add a note'));
    return el;
  }

  // LevelSwatch: a 34px square in the level's gray, with the symbol on a paper inset.
  function levelSwatch(level, opts) {
    const sym = opts.sym || LEVEL_SYMBOLS[level - 1];
    const b = h('button', {
      type: 'button', class: 'swatch' + (opts.selected ? ' on' : ''),
      'aria-label': `Gray level ${level}, ${LEVEL_PCT[level - 1]} percent, ${sym}`,
      'aria-pressed': opts.pressed == null ? null : String(!!opts.pressed),
      onclick: opts.onTap,
    }, h('span', { class: 'sq', style: { '--band': `var(--band-${level})` } }, h('span', { class: 'in' }, h('span', { class: 'g' }, sym))));
    return b;
  }

  function stripBtn(label, onTap, extra) {
    return h('button', Object.assign({ type: 'button', class: 'strip-btn', onclick: onTap }, extra || {}), label);
  }

  function showStrip() {
    const lines = lineRects(sel.a, sel.b);
    if (!lines.length) return;
    const lv = S.settings.level;
    const mic = h('button', { type: 'button', class: 'strip-btn icon', 'aria-label': 'Highlight and record a voice note', title: 'Highlight and record a voice note' }, icon('mic', 24));
    // Recording starts on the press, as in the Reader.
    mic.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; e.preventDefault(); stripMic(); });
    mic.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stripMic(); } });
    const more = stripBtn(ui.more ? 'Less' : 'More', () => { ui.more = !ui.more; showQuick(); }, { 'aria-expanded': String(ui.more) });
    const row1 = h('div', { class: 'strip-row' },
      [1, 2, 3, 4].map((l) => levelSwatch(l, { selected: l === lv, onTap: () => stripCreate(l, 'band') })),
      h('span', { class: 'vrule', 'aria-hidden': 'true' }),
      mic,
      stripBtn('Note', stripNote),
      stripBtn('Copy', stripCopy),
      more);
    const pop = h('div', { class: 'popover strip', role: 'toolbar', 'aria-label': 'Selection' }, row1);
    if (ui.more) {
      pop.append(h('div', { class: 'rule' }), h('div', { class: 'strip-row' },
        stripBtn('Underline', () => stripCreate(S.settings.level, 'underline')),
        stripBtn('Strike out', () => stripCreate(S.settings.level, 'strike')),
        stripBtn('Squiggly', () => stripCreate(S.settings.level, 'squiggly')),
        stripBtn('Define', notInPrototype),
        stripBtn('Look up', notInPrototype)));
    }
    quickUi.append(pop);
    ui.quick = pop;
    placeNear(pop, lines, 24);
  }

  function notInPrototype() { toast('Define and Look up aren’t part of this prototype.'); }

  function newOrig(level, style) {
    const p = { id: uid(), start: sel.a, end: sel.b, level, style, symbol: null, note: '', ink: null, voice: null, created: Date.now() };
    S.orig.push(p);
    return p;
  }

  function stripCreate(level, style) {
    if (!hasSel()) return;
    const before = snapshot();
    if (style === 'band') S.settings.level = level;   // a swatch tap also remembers the level
    const p = newOrig(level, style);
    clearSel();
    ui.more = false;
    save();
    renderMarks();
    showFreshChip(p, before);
  }

  function stripNote() {
    if (!hasSel()) return;
    const p = newOrig(S.settings.level, 'note');
    clearSel();
    save();
    renderMarks();
    openNoteSheet(p.id, 'type');
  }

  function stripCopy() {
    if (!hasSel()) return;
    const text = W.slice(sel.a, sel.b + 1).map((w) => w.text).join(' ');
    const done = () => { clearSel(); toast('Copied.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    const ta = h('textarea', { style: { position: 'fixed', top: '-1000px' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing more to try */ }
    ta.remove();
    done();
  }

  function stripMic() {
    if (!hasSel() || rec) return;
    const p = newOrig(S.settings.level, 'band');
    clearSel();
    save();
    renderMarks();
    startRecording(p, recBarHost(p));
  }

  // FreshMarkChip: "Note · Undo" next to a new highlight for 3 seconds.
  function showFreshChip(p, before) {
    hideChip();
    if (!p._lines || !p._lines.length) return;
    const chip = h('div', { class: 'popover fresh-chip', role: 'group', 'aria-label': 'New highlight' },
      stripBtn('Note', () => { hideChip(); openNoteSheet(p.id, 'type'); }),
      h('span', { class: 'vrule short', 'aria-hidden': 'true' }),
      stripBtn('Undo', () => { hideChip(); restore(before); }));
    quickUi.append(chip);
    ui.chip = chip;
    const last = p._lines[p._lines.length - 1];
    placeNear(chip, [last], 8);
    ui.chipTimer = setTimeout(hideChip, 3000);
  }

  function hideChip() {
    clearTimeout(ui.chipTimer);
    if (ui.chip) { ui.chip.remove(); ui.chip = null; }
  }

  // MarkPopover: tap a highlight to change it. Changes apply at once; a tap outside closes it.
  function openMarkPopover(pid) {
    closeMarkPopover();
    closeQuick();
    hideChip();
    ui.expanded = null;
    if (!S.orig.find((p) => p.id === pid)) return;
    ui.markPop = { pid, el: null };
    renderMarks();
    renderMarkPopover();
  }

  function renderMarkPopover() {
    if (!ui.markPop) return;
    const p = S.orig.find((q) => q.id === ui.markPop.pid);
    if (ui.markPop.el) ui.markPop.el.remove();
    if (!p) { ui.markPop = null; return; }
    const isNote = p.style === 'note';
    const restyle = (fn) => { fn(); save(); renderMarks(); renderMarkPopover(); };
    const el = h('div', { class: 'popover markpop', role: 'dialog', 'aria-label': isNote ? 'My note' : 'My highlight' });
    el.append(h('p', { class: 'quote1' }, '“' + quoteOf(p) + '”'));
    el.append(h('button', { type: 'button', class: 'btn wide', onclick: () => openNoteSheet(p.id) }, hasOrigNote(p) ? 'Open my note' : 'Add a note'));
    if (!isNote) {
      el.append(h('div', { class: 'style-row' },
        [1, 2, 3, 4].map((l) => levelSwatch(l, { selected: l === p.level, onTap: () => restyle(() => { p.level = l; }) })),
        h('span', { class: 'label' }, 'Symbol'),
        h('button', { type: 'button', class: 'symbox-hit', 'aria-label': 'Change the symbol', onclick: () => openPicker({
          current: levelSym(p),
          choose: (sym) => restyle(() => { p.symbol = sym; }),
          reset: { label: 'Use the level’s symbol', run: () => restyle(() => { p.symbol = null; }) },
        }) }, h('span', { class: 'symbox' }, h('span', { class: 'g' }, levelSym(p))))));
      el.append(h('div', { class: 'seg wide', role: 'group', 'aria-label': 'Look' },
        LOOKS.map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(p.style === id), onclick: () => restyle(() => { p.style = id; }) }, label))));
    }
    if (p.voice) {
      el.append(playerRow(p.voice, () => {
        const before = snapshot();
        p.voice = null;
        save();
        renderMarks();
        renderMarkPopover();
        toast('Voice note removed.', [{ label: 'Undo', run: () => restore(before) }]);
      }));
    } else {
      const micRow = h('button', { type: 'button', class: 'mic-row' }, icon('mic', 24), h('span', null, 'Record a voice note'));
      micRow.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        if (rec) return;
        closeMarkPopover();
        startRecording(p, recBarHost(p));
      });
      el.append(micRow);
    }
    el.append(h('div', { class: 'rule' }), h('button', { type: 'button', class: 'btn quiet', onclick: () => deleteOriginal(p) }, isNote ? 'Delete note' : 'Delete highlight'));
    quickUi.append(el);
    ui.markPop.el = el;
    if (p._lines && p._lines.length) placeNear(el, p._lines, 10);
  }

  function closeMarkPopover() {
    if (!ui.markPop) return;
    if (ui.markPop.el) ui.markPop.el.remove();
    ui.markPop = null;
    stopPlayer();
  }

  function deleteOriginal(p) {
    const before = snapshot();
    S.orig = S.orig.filter((q) => q.id !== p.id);
    save();
    closeMarkPopover();
    if (ui.noteSheet) closeNoteSheet(true);
    renderMarks();
    toast(p.style === 'note' ? 'Note removed.' : 'Highlight removed.', [{ label: 'Undo', run: () => restore(before) }]);
  }

  // NoteSheet: the quote, "Type it | Write it", then Delete note and Done.
  function openNoteSheet(pid, tab) {
    const p = S.orig.find((q) => q.id === pid);
    if (!p) return;
    closeMarkPopover();
    hideChip();
    if (ui.noteSheet) closeNoteSheet(true);
    ui.expanded = null;
    const mode = tab || (p.ink && p.ink.strokes && p.ink.strokes.length && !(p.note && p.note.trim()) ? 'write' : 'type');
    const el = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'My note' });
    overlayRoot.append(el);
    ui.noteSheet = { el, pid, mode };
    $('#toast').classList.add('raised');
    renderNoteSheet();
    const ro = new ResizeObserver(() => { if (ui.noteSheet) pageEl.style.paddingBottom = (el.offsetHeight + 48) + 'px'; });
    ro.observe(el);
    ui.noteSheet.ro = ro;
    renderMarks();
    const lines = lineRects(p.start, p.end);
    const o = origin();
    const rr = reader.getBoundingClientRect();
    const sheetTop = window.innerHeight - el.offsetHeight;
    if (lines.length) {
      const top = o.y + lines[0].top;
      if (top < rr.top + 8 || top > sheetTop - 60) reader.scrollTop += top - (rr.top + 40);
    }
  }

  function renderNoteSheet() {
    const ns = ui.noteSheet;
    const p = S.orig.find((q) => q.id === ns.pid);
    const el = ns.el;
    el.textContent = '';
    const quote = h('p', { class: 'xquote clamp2', title: 'Show all of it' }, '“' + quoteOf(p) + '”');
    quote.addEventListener('click', () => quote.classList.toggle('clamp2'));
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'How to write the note', style: { marginTop: '12px' } },
      [['type', 'Type it'], ['write', 'Write it']].map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(ns.mode === id), onclick: () => { ns.mode = id; renderNoteSheet(); } }, label)));
    el.append(h('div', { class: 'sheet-head' }, h('h2', null, 'My note')), quote, seg);
    if (ns.mode === 'type') {
      const ta = h('textarea', { class: 'note-area', id: 'orig-note', placeholder: 'Type a note', 'aria-label': 'My note', style: { minHeight: '96px' } });
      ta.value = p.note || '';
      ta.addEventListener('input', () => { p.note = ta.value; grow(ta); saveSoon(); });
      el.append(ta);
      requestAnimationFrame(() => { grow(ta); ta.focus(); });
    } else {
      el.append(inkPad(p));
    }
    el.append(h('div', { class: 'sheet-foot' },
      h('button', { type: 'button', class: 'btn quiet', onclick: () => {
        const before = snapshot();
        p.note = '';
        p.ink = null;
        if (p.style === 'note' && !p.voice) S.orig = S.orig.filter((q) => q.id !== p.id);
        save();
        closeNoteSheet(true);
        toast('Note removed.', [{ label: 'Undo', run: () => restore(before) }]);
      } }, 'Delete note'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => closeNoteSheet() }, 'Done')));
  }

  function closeNoteSheet(quiet) {
    const ns = ui.noteSheet;
    if (!ns) return;
    if (ns.ro) ns.ro.disconnect();
    ns.el.remove();
    ui.noteSheet = null;
    $('#toast').classList.remove('raised');
    pageEl.style.paddingBottom = '';
    const p = S.orig.find((q) => q.id === ns.pid);
    // A note anchor with nothing in it goes away, as an empty note does in the Reader.
    if (p && p.style === 'note' && !hasOrigNote(p) && !p.voice) S.orig = S.orig.filter((q) => q.id !== p.id);
    else if (p && p.note) p.note = p.note.replace(/\s+$/, '');
    save();
    renderMarks();
    if (!quiet && p && hasOrigNote(p)) toast('Saved my note.');
  }

  // "Write it": a simple handwriting pad for the pen or a finger.
  function inkPad(p) {
    const wrap = h('div', { class: 'inkpad' });
    const cv = h('canvas', { 'aria-label': 'Handwriting area' });
    const height = Math.round(clamp(window.innerHeight * 0.4, 200, 420));
    cv.style.height = height + 'px';
    wrap.append(cv);
    const undo = h('button', { type: 'button', class: 'btn small' }, 'Undo');
    const clear = h('button', { type: 'button', class: 'btn small' }, 'Clear');
    wrap.append(h('div', { class: 'ink-tools' }, undo, clear, h('span', { class: 'meta', style: { alignSelf: 'center' } }, 'Write with the pen or a finger.')));
    let ink = p.ink && p.ink.strokes ? p.ink : null;
    let cur = null;
    const redraw = () => drawInk(cv, ink);
    requestAnimationFrame(() => {
      const w = cv.clientWidth || 560;
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(height * dpr);
      if (!ink) ink = { w, h: height, strokes: [] };
      redraw();
    });
    const pt = (e) => {
      const r = cv.getBoundingClientRect();
      const k = ink.w / r.width;
      return [Math.round((e.clientX - r.left) * k * 10) / 10, Math.round((e.clientY - r.top) * k * 10) / 10];
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!ink) return;
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      cur = { id: e.pointerId, pts: [pt(e)] };
      ink.strokes.push(cur.pts);
      redraw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cur || e.pointerId !== cur.id) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs) cur.pts.push(pt(ev));
      redraw();
    });
    const end = (e) => {
      if (!cur || e.pointerId !== cur.id) return;
      cur = null;
      p.ink = ink;
      saveSoon();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    undo.addEventListener('click', () => { if (ink && ink.strokes.length) { ink.strokes.pop(); p.ink = ink; saveSoon(); redraw(); } });
    clear.addEventListener('click', () => { if (ink) { ink.strokes = []; p.ink = ink; saveSoon(); redraw(); } });
    return wrap;
  }

  function drawInk(cv, ink) {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!ink || !ink.strokes) return;
    const k = cv.width / ink.w;
    ctx.save();
    ctx.scale(k, k);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#111111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of ink.strokes) {
      if (!s.length) continue;
      ctx.beginPath();
      ctx.moveTo(s[0][0], s[0][1]);
      if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function inkThumb(ink, maxH) {
    const cv = h('canvas', { class: 'ink-thumb', 'aria-label': 'My handwritten note' });
    const k = Math.min(1, maxH / ink.h);
    const w = Math.round(ink.w * k), hh = Math.round(ink.h * k);
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(hh * dpr);
    cv.style.width = w + 'px';
    cv.style.height = hh + 'px';
    drawInk(cv, ink);
    return cv;
  }

  // VoiceRecorderBar: × · ● 0:07 · waveform · Stop, along the bottom while recording.
  function recBarHost(p) {
    return { render(problem) { renderRecBar(p, problem); } };
  }

  function renderRecBar(p, problem) {
    if (ui.recbar) { ui.recbar.remove(); ui.recbar = null; }
    if (rec && rec.pid === p.id) {
      const timerEl = h('span', { class: 'timer' }, fmtTime(Date.now() - rec.started));
      const waveEl = h('div', { class: 'wave' });
      for (let i = 0; i < 20; i++) waveEl.append(h('i'));
      rec.timerEl = timerEl;
      rec.waveEl = waveEl;
      rec.tEl = null;
      const bar = h('div', { class: 'recbar', role: 'group', 'aria-label': 'Recording a voice note' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove this recording', onclick: () => stopRecording(false) }, icon('close', 18)),
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
        timerEl, waveEl,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn primary', onclick: () => stopRecording(true) }, 'Stop'));
      if (rec.simulated) bar.append(h('div', { class: 'meta', style: { flexBasis: '100%', padding: '0 0 6px 14px' } }, 'Pretend recording: this screen can’t use the microphone, so nothing is captured.'));
      overlayRoot.append(bar);
      ui.recbar = bar;
      return;
    }
    if (problem === 'nomic') {
      const bar = h('div', { class: 'recbar', role: 'alert' },
        h('div', { class: 'msg' }, 'I need the microphone to record a voice note.'),
        h('button', { type: 'button', class: 'btn small', onclick: () => startPretend(p, recBarHost(p)) }, 'Pretend to record'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => renderRecBar(p) }, icon('close', 18)));
      overlayRoot.append(bar);
      ui.recbar = bar;
    }
  }

  // The Notes panel: rows with their gray and symbol, the quote wearing its look, then the note.
  function renderNotesPanel(el) {
    const list = S.orig.slice().sort((p, q) => p.start - q.start);
    const f = ui.panelFilterOrig || 'all';
    const shown = f === 'all' ? list : list.filter((p) => p.style !== 'note' && 'L' + p.level === f);
    el.append(h('div', { class: 'panel-head' }, h('h2', null, 'Notes'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: closePanel }, icon('close', 22))));
    const filter = (id, label) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(f === id), onclick: () => { ui.panelFilterOrig = id; renderPanel(); } }, label);
    el.append(h('div', { class: 'filter-row' }, filter('all', `All ${list.length}`),
      [1, 2, 3, 4].map((l) => filter('L' + l, [h('span', { class: 'mini-swatch', style: { '--band': `var(--band-${l})` } }, h('span', null, LEVEL_SYMBOLS[l - 1])), String(list.filter((p) => p.style !== 'note' && p.level === l).length)]))));
    if (!shown.length) {
      el.append(h('div', { class: 'empty' }, h('div', { class: 'label' }, 'Nothing marked yet.'), h('div', { class: 'meta' }, 'Long-press a word, then tap a gray.')));
      return;
    }
    for (const p of shown) {
      const meta = [];
      if (p.note && p.note.trim()) meta.push(p.note.trim());
      else if (p.ink && p.ink.strokes && p.ink.strokes.length) meta.push('My handwritten note');
      if (p.voice) meta.push(`Voice note, ${fmtTime(p.voice.durationMs)}`);
      const look = p.style === 'band' ? 'highlight' : (p.style === 'note' ? 'dash' : p.style);
      el.append(h('button', { type: 'button', class: 'prow', onclick: () => { closePanel(); revealPassage(p); openMarkPopover(p.id); } },
        h('span', { class: 'lead' }, p.style === 'note' ? icon('note', 20) : h('span', { class: 'mini-swatch', style: { '--band': `var(--band-${p.level})` } }, h('span', null, levelSym(p)))),
        h('span', null,
          h('span', { class: 'pquote look-' + look }, h('span', { class: 'look', style: { '--band': `var(--band-${p.level})` } }, quoteOf(p))),
          meta.length ? h('div', { class: 'meta pnote' }, meta.join(' · ')) : null)));
    }
  }

  // ---------------------------------------------------------------- symbol picker

  // The Reader's symbol picker (SymbolPickerSheet): glyphs first, then emoji groups, or type any emoji.
  function openPicker(opts) {
    closePicker();
    const choose = (s) => {
      const clean = firstSymbol(s);
      if (!clean) return false;
      closePicker();
      opts.choose(clean);
      return true;
    };
    const cur = opts.current;
    const current = h('span', { class: 'picker-current', 'aria-label': 'Current symbol' }, cur);
    const input = h('input', { type: 'text', id: 'symbol-input', placeholder: 'Or type any emoji', 'aria-label': 'Or type any emoji', autocomplete: 'off' });
    const err = h('div', { class: 'meta', hidden: true }, 'That isn’t a symbol I can use. Try another.');
    const use = () => { if (!choose(input.value)) err.hidden = false; };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') use(); });
    const grid = (list) => h('div', { class: 'grid' }, list.map((s) => h('button', { type: 'button', 'aria-label': s, 'aria-pressed': String(s === cur), onclick: () => choose(s) }, h('span', null, s))));
    const el = h('div', { class: 'sheet top', role: 'dialog', 'aria-label': 'Choose a symbol', style: { height: '72%' } },
      h('div', { class: 'sheet-head' }, h('h2', null, 'Choose a symbol'), current,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: closePicker }, icon('close', 22))),
      h('div', { class: 'type-row' }, input, h('button', { type: 'button', class: 'btn', onclick: use }, 'Use')),
      err,
      opts.reset ? h('button', { type: 'button', class: 'btn quiet', style: { marginTop: '4px' }, onclick: () => { closePicker(); opts.reset.run(); } }, opts.reset.label) : null,
      h('div', { class: 'picker-section counter' }, 'Glyphs'),
      grid(GLYPHS),
      EMOJI_GROUPS.map(([title, list]) => [h('div', { class: 'picker-section counter' }, 'Emoji · ' + title), grid(list)]));
    overlayRoot.append(el);
    ui.picker = el;
  }

  function closePicker() {
    if (ui.picker) { ui.picker.remove(); ui.picker = null; }
  }

  // ---------------------------------------------------------------- saved passages panel

  function openPanel() {
    closePanel();
    closeMenu();
    const el = h('aside', { class: 'panel', role: 'dialog', 'aria-label': 'Saved passages' });
    ui.panel = el;
    overlayRoot.append(el);
    renderPanel();
  }

  function renderPanel() {
    const el = ui.panel;
    if (!el) return;
    el.textContent = '';
    if (isOrig()) { renderNotesPanel(el); return; }
    const list = S.passages.slice().sort((p, q) => p.start - q.start);
    if (ui.panelFilter !== 'all' && !catById(ui.panelFilter)) ui.panelFilter = 'all';
    const shown = ui.panelFilter === 'all' ? list : list.filter((p) => p.categoryId === ui.panelFilter);
    el.append(h('div', { class: 'panel-head' }, h('h2', null, 'Saved passages'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: closePanel }, icon('close', 22))));
    const filter = (id, label) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(ui.panelFilter === id), onclick: () => { ui.panelFilter = id; renderPanel(); } }, label);
    el.append(h('div', { class: 'filter-row' }, filter('all', `All ${list.length}`),
      S.categories.map((c) => filter(c.id, `${c.symbol} ${c.name} ${list.filter((p) => p.categoryId === c.id).length}`))));
    if (!shown.length) {
      el.append(h('div', { class: 'empty' }, h('div', { class: 'label' }, 'Nothing saved here yet.'), h('div', { class: 'meta' }, 'Long-press a word to start.')));
      return;
    }
    for (const p of shown) {
      const c = catOf(p);
      const fmt = effFormat(p);
      const meta = [];
      if (p.note && p.note.trim()) meta.push(p.note.trim());
      if (p.voice) meta.push(`Voice note, ${fmtTime(p.voice.durationMs)}`);
      el.append(h('button', { type: 'button', class: 'prow', onclick: () => { closePanel(); revealPassage(p); openSheet(p.id, 'panel'); } },
        h('span', { class: 'psym' }, c.symbol),
        h('span', null,
          h('span', { class: 'pquote' + (fmt ? ' look-' + fmt : '') }, h('span', { class: 'look', style: { '--band': `var(--band-${c.gray})` } }, quoteOf(p))),
          meta.length ? h('div', { class: 'meta pnote' }, meta.join(' · ')) : null)));
    }
  }

  function closePanel() {
    if (ui.panel) { ui.panel.remove(); ui.panel = null; }
  }

  function revealPassage(p) {
    const lines = lineRects(p.start, p.end);
    if (!lines.length) return;
    const o = origin();
    const rr = reader.getBoundingClientRect();
    reader.scrollTop += (o.y + lines[0].top) - (rr.top + 80);
  }

  // ---------------------------------------------------------------- settings menu

  function openMenu() {
    closeMenu();
    closePanel();
    const btn = $('#open-settings');
    btn.setAttribute('aria-expanded', 'true');
    const el = h('div', { class: 'menu', role: 'menu', 'aria-label': 'Prototype settings' });
    ui.menu = el;
    overlayRoot.append(el);
    renderMenu();
  }

  function renderMenu() {
    const el = ui.menu;
    if (!el) return;
    el.textContent = '';
    const st = S.settings;
    const toggle = (label, key) => h('button', { type: 'button', class: 'mrow', role: 'menuitemcheckbox', 'aria-checked': String(!!st[key]),
      onclick: () => { st[key] = !st[key]; save(); applySettings(); renderMenu(); } }, h('span', null, label), h('span', { class: 'switch', 'aria-hidden': 'true' }));
    const seg = (label, key, opts) => h('div', { class: 'mrow' }, h('span', null, label),
      h('div', { class: 'seg', role: 'group', 'aria-label': label }, opts.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(st[key] === v),
        onclick: () => { st[key] = v; save(); applySettings(); renderMenu(); } }, l))));
    el.append(
      h('button', { type: 'button', class: 'mrow', role: 'menuitem', onclick: () => { closeMenu(); S.introSeen[st.mode] = false; save(); renderIntro(); reader.scrollTop = 0; } }, 'How to try it'),
      h('div', { class: 'rule' }),
      toggle('Long-press picks the sentence', 'sentence'),
      isOrig() ? null : toggle('Show hints', 'hints'),
      isOrig() ? null : seg('Symbol side', 'symbolSide', [['right', 'Right'], ['left', 'Left']]),
      h('div', { class: 'mrow' }, h('span', null, 'Text size'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Text size' },
          h('button', { type: 'button', 'aria-label': 'Smaller text', onclick: () => { st.textSize = clamp(st.textSize - 2, 16, 28); save(); applySettings(); renderMenu(); } }, 'A−'),
          h('button', { type: 'button', 'aria-label': 'Larger text', onclick: () => { st.textSize = clamp(st.textSize + 2, 16, 28); save(); applySettings(); renderMenu(); } }, 'A+'))),
      seg('Highlight ink', 'ink', [['gray', 'Grays'], ['lavender', 'Lavender']]),
      seg('Theme', 'theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]),
      h('div', { class: 'rule' }),
      confirmRow('Clear my highlights', 'Tap again to clear them', () => {
        const before = snapshot();
        if (isOrig()) S.orig = []; else S.passages = [];
        save(); closeMenu(); renderAll();
        toast('Highlights cleared.', [{ label: 'Undo', run: () => restore(before) }]);
      }),
      confirmRow('Reset the demo', 'Tap again to reset', () => {
        const before = snapshot();
        const fresh = seedState();
        S.categories = fresh.categories;
        S.passages = fresh.passages;
        S.orig = fresh.orig;
        S.settings.lastCategoryId = 'star';
        S.settings.level = 2;
        save(); closeMenu(); renderAll();
        toast('Back to the starting demo.', [{ label: 'Undo', run: () => restore(before) }]);
      }),
      h('div', { class: 'rule' }),
      h('div', { class: 'meta' }, (isOrig()
        ? 'Original: today\u2019s Reader highlight menus, for comparison. Symbols are drawn as on PDF pages. '
        : 'Christine: the proposed Save passage menu. ') + 'Each design keeps its own highlights. ' + buildLabel()));
  }

  function confirmRow(label, again, run) {
    let armed = false;
    const b = h('button', { type: 'button', class: 'mrow', role: 'menuitem' }, label);
    b.addEventListener('click', () => {
      if (armed) { run(); return; }
      armed = true;
      b.textContent = again;
      setTimeout(() => { armed = false; if (b.isConnected) b.textContent = label; }, 3000);
    });
    return b;
  }

  function closeMenu() {
    if (ui.menu) { ui.menu.remove(); ui.menu = null; $('#open-settings').setAttribute('aria-expanded', 'false'); }
  }

  let BUILD = null;
  function buildLabel() {
    if (!BUILD) return 'Local build.';
    return `Build ${BUILD.build} · ${String(BUILD.sha || '').slice(0, 7)}.`;
  }

  // ---------------------------------------------------------------- toast

  let toastTimer = null;
  function toast(msg, actions, ms) {
    const t = $('#toast');
    t.textContent = '';
    t.append(h('span', { class: 'msg' }, msg));
    for (const a of actions || []) {
      t.append(h('button', { type: 'button', class: 'btn quiet', onclick: () => { hideToast(); a.run(); } }, a.label));
    }
    t.classList.toggle('raised', !!(ui.sheet || ui.noteSheet));
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || ((actions && actions.length) ? 8000 : 4000));
  }
  function hideToast() { clearTimeout(toastTimer); $('#toast').hidden = true; }

  // ---------------------------------------------------------------- intro, settings, view

  function renderIntro() {
    introEl.textContent = '';
    const mode = S.settings.mode;
    if (S.introSeen[mode]) return;
    const items = mode === 'original' ? [
      'This is today’s Reader, for comparison. Switch to Christine at the top left to try the proposal.',
      'Long-press a word. Lift to take the sentence, or keep your finger down and drag to choose words. Tap the selection again for the whole paragraph.',
      'In the strip, tap a gray to highlight. Note, Copy and More are next to it; More has Underline, Strike out and Squiggly.',
      'Tap a highlight to change its gray, symbol or look, add a note or a voice note, or delete it.',
    ] : [
      'This is Christine’s proposal. Switch to Original at the top left to compare it with today’s Reader.',
      'Long-press a word. Lift to take the sentence, or keep your finger down and drag to choose words. Tap the selection again for the whole paragraph.',
      'In Save passage, tap ★ or ? to save with that category’s formatting. Hold one to add a note, change the formatting or pick a symbol. The pencil edits categories, and + adds one.',
      'Switch to Annotations to see notes over the text. Tap a note to open it. Hold two fingers still on the page to see the text underneath.',
    ];
    introEl.append(h('div', { class: 'intro' },
      h('h2', null, mode === 'original' ? 'Original: today’s highlight menus' : 'Christine: the Save passage menu'),
      h('ul', null, items.map((t) => h('li', null, t))),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn quiet', onclick: () => { S.introSeen[mode] = true; save(); renderIntro(); } }, 'Got it'))));
  }

  function applySettings() {
    const st = S.settings;
    const root = document.documentElement;
    root.style.setProperty('--read-size', st.textSize + 'px');
    root.style.setProperty('--read-line', Math.round(st.textSize * 1.5) + 'px');
    if (st.theme === 'system') delete root.dataset.theme; else root.dataset.theme = st.theme;
    if (st.ink === 'lavender') root.dataset.ink = 'lavender'; else delete root.dataset.ink;
    pageEl.classList.toggle('sym-left', !isOrig() && st.symbolSide === 'left');
    $('#mode-original').setAttribute('aria-pressed', String(isOrig()));
    $('#mode-christine').setAttribute('aria-pressed', String(!isOrig()));
    $('#view-seg').hidden = isOrig();
    document.body.classList.toggle('mode-original', isOrig());
    document.body.classList.toggle('mode-christine', !isOrig());
    $('#view-regular').setAttribute('aria-pressed', String(st.view === 'regular'));
    $('#view-annotations').setAttribute('aria-pressed', String(st.view === 'annotations'));
    document.body.classList.toggle('annotations', !isOrig() && st.view === 'annotations');
    scheduleRender();
  }

  function setView(v) {
    if (S.settings.view === v) return;
    S.settings.view = v;
    ui.expanded = null;
    save();
    applySettings();
    if (v === 'annotations') {
      if (!S.passages.some(hasNote)) toast('No notes yet. Hold a category in Save passage to add one.');
      else if (S.settings.hints) toast('Tap a note to open it. Hold two fingers still on the page to see underneath.');
    }
  }

  // Close everything that belongs to one design before showing the other.
  function closeEverything() {
    if (rec) stopRecording(true);
    closePicker();
    if (ui.sheet) closeSheet();
    if (ui.noteSheet) closeNoteSheet();
    closeMarkPopover();
    hideChip();
    closeMenu();
    closePanel();
    stopPlayer();
    ui.expanded = null;
    ui.more = false;
    if (hasSel()) clearSel();
    hideToast();
  }

  function setMode(m) {
    if (S.settings.mode === m) return;
    closeEverything();
    S.settings.mode = m;
    save();
    applySettings();
    renderIntro();
    renderMarks();
  }

  function renderAll() {
    renderIntro();
    renderMarks();
    renderSelection();
    if (ui.quick) showQuick();
    if (ui.panel) renderPanel();
  }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderMarks();
      renderSelection();
      if (ui.quick && !sel.dragging) showQuick();
    });
  }

  // Back (Android) and Escape close the top-most thing first. Returns true when something closed.
  window.protoHandleBack = () => {
    if (ui.picker) { closePicker(); return true; }
    if (rec && ui.recbar) { stopRecording(true); return true; }
    if (ui.sheet) { closeSheet(); return true; }
    if (ui.noteSheet) { closeNoteSheet(); return true; }
    if (ui.markPop) { closeMarkPopover(); return true; }
    if (ui.chip) { hideChip(); return true; }
    if (ui.menu) { closeMenu(); return true; }
    if (ui.panel) { closePanel(); return true; }
    if (ui.expanded) { ui.expanded = null; stopPlayer(); renderMarks(); return true; }
    if (hasSel()) { clearSel(); return true; }
    return false;
  };

  // Taps outside the menu or panel close them.
  document.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (ui.menu && !ui.menu.contains(t) && !t.closest('#open-settings')) closeMenu();
    if (ui.panel && !ui.panel.contains(t) && !t.closest('#open-panel') && !t.closest('.sheet') && !t.closest('.popover')) closePanel();
  }, true);

  // ---------------------------------------------------------------- boot

  const NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  if (NATIVE) document.documentElement.classList.add('native');

  buildText();
  S = loadState();
  applySettings();
  renderIntro();
  renderMarks();

  $('#mode-original').addEventListener('click', () => setMode('original'));
  $('#mode-christine').addEventListener('click', () => setMode('christine'));
  $('#view-regular').addEventListener('click', () => setView('regular'));
  $('#view-annotations').addEventListener('click', () => setView('annotations'));
  $('#open-panel').addEventListener('click', () => (ui.panel ? closePanel() : openPanel()));
  $('#open-settings').addEventListener('click', () => (ui.menu ? closeMenu() : openMenu()));

  if (window.ResizeObserver) new ResizeObserver(scheduleRender).observe(textEl);
  window.addEventListener('resize', scheduleRender);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleRender);

  fetch('build.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((b) => { BUILD = b; if (ui.menu) renderMenu(); }).catch(() => {});

  if (!NATIVE && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // For automated checks.
  window.__proto = { S: () => S, W, sel, ui, wordNear, lineRects };
})();
