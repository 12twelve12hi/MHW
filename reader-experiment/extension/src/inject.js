// Functions the extension runs inside a tab with scripting.executeScript. Each one is serialised on its own, so it must
// not use anything from this module's scope (only its arguments and the page's globals), and its result must be
// JSON-serialisable (Chrome passes results as JSON values: bytes travel as base64 strings).

/**
 * The page as the user sees it: {url, title, contentType, html?, tooLarge?, length?}. No HTML for PDF documents, and
 * none when it is longer than maxChars UTF-16 units (its UTF-8 size is at least that, so it would be over the cap).
 */
export function capturePage(maxChars) {
  const out = { url: String(location.href), title: String(document.title || ''), contentType: String(document.contentType || '') };
  if (out.contentType === 'application/pdf' || !document.documentElement) return out;
  let html = document.documentElement.outerHTML;
  const dt = document.doctype;
  if (dt) {
    let s = '<!DOCTYPE ' + dt.name;
    if (dt.publicId) s += ' PUBLIC "' + dt.publicId + '"';
    if (dt.systemId) s += (dt.publicId ? '' : ' SYSTEM') + ' "' + dt.systemId + '"';
    html = s + '>\n' + html;
  }
  out.length = html.length;
  if (html.length > maxChars) out.tooLarge = true;
  else out.html = html;
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
