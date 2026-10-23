// Functions the extension runs inside a tab with scripting.executeScript. Each one is serialised on its own, so it must
// not use anything from this module's scope (only its arguments and the page's globals), and its result must be
// JSON-serialisable (Chrome passes results as JSON values: bytes travel as base64 strings).

/**
 * The page as the user sees it: {url, title, contentType, html?, tooLarge?, length?}. No HTML for PDF documents, and
 * none when it is longer than maxChars UTF-16 units (its UTF-8 size is at least that, so it would be over the cap).
 * opts (Lab, LAB-PLAN F03 and F10; absent in a Lab-off capture, which is v1.1's byte for byte):
 *   clean: the HTML is clean-html.js's cleanHtml(document.documentElement.cloneNode(true)) (injected first with
 *          executeScript({files: ['clean-html.js']})): no scripts but JSON-LD, no on* attributes, no form contents;
 *          the size cap applies to the cleaned page. {error} when cleanHtml isn't loaded.
 *   words: also `words`, the page's visible text in words (F10's Review).
 */
export function capturePage(maxChars, opts) {
  const out = { url: String(location.href), title: String(document.title || ''), contentType: String(document.contentType || '') };
  if (out.contentType === 'application/pdf' || !document.documentElement) return out;
  let html;
  if (opts && opts.clean) {
    if (typeof cleanHtml !== 'function') { out.error = 'clean-html.js is not loaded'; return out; }
    html = cleanHtml(document.documentElement.cloneNode(true)); // eslint-disable-line no-undef
  } else {
    html = document.documentElement.outerHTML;
    const dt = document.doctype;
    if (dt) {
      let s = '<!DOCTYPE ' + dt.name;
      if (dt.publicId) s += ' PUBLIC "' + dt.publicId + '"';
      if (dt.systemId) s += (dt.publicId ? '' : ' SYSTEM') + ' "' + dt.systemId + '"';
      html = s + '>\n' + html;
    }
  }
  out.length = html.length;
  if (html.length > maxChars) out.tooLarge = true;
  else out.html = html;
  if (opts && opts.words) {
    const text = String((document.body && (document.body.innerText || document.body.textContent)) || '');
    out.words = text.trim() ? text.trim().split(/\s+/).length : 0;
  }
  return out;
}

/**
 * What the popup needs to know about a tab before it offers anything (Lab, F04 and F10): {url, title, contentType,
 * selection: true when text is selected}. Its answering at all says the extension can read the page.
 */
export function pageInfo() {
  let selection = false;
  try {
    const sel = window.getSelection ? window.getSelection() : null;
    selection = !!(sel && !sel.isCollapsed && String(sel.toString() || '').trim());
    if (!selection) {
      const a = document.activeElement;
      selection = !!(a && typeof a.selectionStart === 'number' && a.selectionEnd > a.selectionStart && /^(TEXTAREA|INPUT)$/.test(a.tagName));
    }
  } catch (e) { selection = false; }
  return { url: String(location.href), title: String(document.title || ''), contentType: String(document.contentType || ''), selection };
}

/**
 * The selection (Lab, F11's explicit paths and F10's Selection mode): {url, title, text, html}. html is the selected
 * markup, copied into an inert document (nothing in it loads or runs); a selection inside a text field gives its text
 * only. Empty text: nothing is selected.
 */
export function captureSelection() {
  const out = { url: String(location.href), title: String(document.title || ''), text: '', html: '' };
  try {
    const sel = window.getSelection ? window.getSelection() : null;
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      out.text = String(sel.toString() || '');
      const doc = document.implementation.createHTMLDocument('');
      const box = doc.createElement('div');
      for (let i = 0; i < sel.rangeCount; i++) box.appendChild(doc.importNode(sel.getRangeAt(i).cloneContents(), true));
      out.html = box.innerHTML;
    }
    if (!out.text.trim()) {
      const a = document.activeElement;
      if (a && typeof a.selectionStart === 'number' && a.selectionEnd > a.selectionStart && /^(TEXTAREA|INPUT)$/.test(a.tagName)) {
        out.text = String(a.value || '').slice(a.selectionStart, a.selectionEnd);
        out.html = '';
      }
    }
  } catch (e) { out.error = String((e && e.message) || e); }
  return out;
}

/**
 * Clean article (Lab, F10): Mozilla Readability on a clone of the document (Readability.js and clean-html.js injected
 * first), its article HTML cleaned by cleanHtml in an inert document. Before Readability parses the clone,
 * clean-html.js's prepareForReadability moves the page's summary boxes ("Key points", a heading and a list beside the
 * article's text) into the text, where Readability keeps them (F10.1; share/README.md, "Clean article's call order").
 * -> {url, title, contentType, articleTitle, byline, site, content, words} | {…, empty: true, words: 0} (nothing to
 * extract) | {…, error}
 */
export function captureArticle() {
  const out = { url: String(location.href), title: String(document.title || ''), contentType: String(document.contentType || '') };
  if (out.contentType === 'application/pdf') return out;
  if (typeof Readability !== 'function' || typeof cleanHtml !== 'function' || typeof prepareForReadability !== 'function') { // eslint-disable-line no-undef
    out.error = 'Readability is not loaded';
    return out;
  }
  try {
    const clone = document.cloneNode(true);
    prepareForReadability(clone); // eslint-disable-line no-undef
    const article = new Readability(clone).parse(); // eslint-disable-line no-undef
    if (!article || !article.content) { out.empty = true; out.words = 0; return out; }
    const doc = document.implementation.createHTMLDocument('');
    doc.body.innerHTML = article.content;
    let content = cleanHtml(doc.body); // eslint-disable-line no-undef
    const head = '<!doctype html>\n<body>';
    if (content.indexOf(head) === 0 && content.slice(-7) === '</body>') content = content.slice(head.length, -7);
    const text = String(article.textContent || '').trim();
    out.articleTitle = String(article.title || '');
    out.byline = String(article.byline || '');
    out.site = String(article.siteName || '');
    out.content = content;
    out.words = text ? text.split(/\s+/).length : 0;
  } catch (e) { out.error = String((e && e.message) || e); }
  return out;
}

/**
 * Downloads a PDF from inside the page (same origin, with the user's cookies) and keeps it in the extension's isolated
 * world for pdfChunk. -> {size, type, disposition, magic} | {tooLarge, size} | {error}
 */
export async function pdfStart(url, maxBytes) {
  try {
    const res = await fetch(url || location.href, { credentials: 'include' });
    if (!res.ok) return { error: 'HTTP ' + res.status };
    const declared = Number(res.headers.get('content-length'));
    if (declared > maxBytes) {
      try { await res.body?.cancel(); } catch { /* nothing to cancel */ }
      return { tooLarge: true, size: declared };
    }
    // Without a Content-Length, read only until it goes over maxBytes (size is then the bytes read: a lower bound).
    let blob;
    const reader = res.body?.getReader?.();
    if (reader) {
      const parts = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          reader.cancel().catch(() => {});
          return { tooLarge: true, size };
        }
        parts.push(value);
      }
      blob = new Blob(parts, { type: res.headers.get('content-type') || '' });
    } else {
      blob = await res.blob();
      if (blob.size > maxBytes) return { tooLarge: true, size: blob.size };
    }
    const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
    let magic = false;
    for (let i = 0; i + 4 < head.length; i++) {
      if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) { magic = true; break; }
    }
    if (!magic) return { error: 'not a PDF' };
    globalThis.__daylightPdf = blob;
    return { size: blob.size, type: res.headers.get('content-type') || '', disposition: res.headers.get('content-disposition') || '' };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/** Base64 of bytes [offset, offset + length) of the PDF that pdfStart kept, or null. */
export async function pdfChunk(offset, length) {
  const blob = globalThis.__daylightPdf;
  if (!blob) return null;
  const part = blob.slice(offset, offset + length);
  if (part.size === 0) return '';
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => resolve(null);
    r.readAsDataURL(part);
  });
}

export function pdfEnd() {
  try { delete globalThis.__daylightPdf; } catch { globalThis.__daylightPdf = undefined; }
  return true;
}

/** The text of the first link to url in the page (for "Send link to Daylight"; Chrome doesn't pass link text). */
export function linkText(url) {
  try {
    for (const a of document.querySelectorAll('a[href]')) {
      if (a.href === url) {
        const t = (a.innerText || a.textContent || a.getAttribute('aria-label') || a.title || '').replace(/\s+/g, ' ').trim();
        if (t) return t.slice(0, 300);
        const img = a.querySelector('img[alt]');
        if (img && img.alt.trim()) return img.alt.trim().slice(0, 300);
      }
    }
  } catch { /* ignore */ }
  return '';
}
