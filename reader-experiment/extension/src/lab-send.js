// Lab's sending rules in the extension (LAB-PLAN 3.3, card X1, Wave 1), as pure helpers: no browser APIs here, so the
// unit tests run them in node, and the background (core.js, lab.js) and the popup share them.
//
//   F01  the toolbar badge from the most recent row (badgeMark)
//   F04  share in place: who gets the countdown and who gets the choices and Send (noCountdown)
//   F07  the rows waiting for a connection (waitingRows, queueRows)
//   F10  Send as: the four modes, the default by context, the mode remembered per site, the clean article's page
//   F34  the right-click menu entries with Lab on and off (menuEntries), and the omnibox's typed address

import { webUrl, findUrl } from './daylight-share.js';
import { LAB_TEXT, SETTLED_STATES, STATE_DIGEST_WINDOW_MS, labUseOn } from './daylight-lab.js';

/** F10's modes, in the menu's order. A selection is never remembered for a site. */
export const SEND_MODES = ['page', 'clean', 'link', 'selection'];
/** The modes remembered per site (lab/sendAs), and how many sites are kept (the most recent first). */
export const REMEMBERED_MODES = ['page', 'clean', 'link'];
export const SEND_AS_SITES = 500;
/** F10's thin-page check: under this many words a clean article is thin (the Reader's PaywallHint.BROWSER_RETRY_WORDS). */
export const THIN_WORDS = 150;
/** F04: the countdown before the card sends (1.5 s). */
export const COUNTDOWN_MS = 1500;
/** F07: passes of flushNetwork are at least this far apart (LAB-PLAN 2.7.1). */
export const FLUSH_GAP_MS = 3 * 60e3;
/** F07's alarm: it exists while a row waits for a connection. */
export const ALARM_OFFLINE = 'dls-offline';

/**
 * The context-menu entries (F34). With Lab off: v1.1's three (page, link, PDF link), with v1.1's ids. With Lab on: six,
 * each shown unless its "Show in the right-click menu" box is unticked (settings.labMenus[entry] === false).
 * -> [{entry, id, title, contexts, targetUrlPatterns?}]
 */
export const MENU_IDS = {
  page: 'dls-page', clean: 'dls-clean', link: 'dls-link', selection: 'dls-selection', image: 'dls-image', pdf: 'dls-pdf-link',
};
export const MENU_ENTRIES = ['page', 'clean', 'link', 'selection', 'image', 'pdf'];
// Match patterns compare against path + query, so these catch ".../paper.pdf" and ".../paper.pdf?download=1".
export const PDF_LINK_PATTERNS = ['*://*/*.pdf', '*://*/*.PDF', '*://*/*.Pdf', '*://*/*.pdf?*', '*://*/*.PDF?*'];

/** v1.1's menu titles: the Lab-off menu is exactly v1.1's, whatever LAB_TEXT says. */
const V11_MENU_TITLES = { page: 'Send page to Daylight', link: 'Send link to Daylight', pdf: 'Send PDF link to Daylight' };

export function menuEntries({ lab = false, menus = {} } = {}) {
  const T = LAB_TEXT.contextMenu;
  const all = {
    page: { contexts: ['page', 'frame'] },
    clean: { contexts: ['page', 'frame'] },
    link: { contexts: ['link'] },
    selection: { contexts: ['selection'] },
    image: { contexts: ['image'] },
    pdf: { contexts: ['link'], targetUrlPatterns: PDF_LINK_PATTERNS },
  };
  if (!lab) return ['page', 'link', 'pdf'].map((entry) => ({ entry, id: MENU_IDS[entry], title: V11_MENU_TITLES[entry], ...all[entry] }));
  return MENU_ENTRIES.filter((e) => menus?.[e] !== false).map((entry) => ({ entry, id: MENU_IDS[entry], title: T[entry], ...all[entry] }));
}

/** The commands (F34): send-page exists in every build; the other three are Lab's. */
export const COMMANDS = { page: 'send-page', selection: 'send-selection', clean: 'send-clean', link: 'send-link' };
export const LAB_COMMANDS = ['send-selection', 'send-clean', 'send-link'];

/** A host as F10 remembers it: the URL's hostname, lowercased, without "www.". '' for anything that isn't a web URL. */
export function siteOf(url) {
  const u = webUrl(url);
  if (!u) return '';
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

/**
 * F10's default by context: a selection, then a PDF tab (the file: no mode), then the mode remembered for the site,
 * then Page. remembered: lab/sendAs ({host: mode}). -> 'selection' | 'pdf' | 'page' | 'clean' | 'link'
 */
export function defaultMode({ selection = false, pdf = false, url = '', remembered = {} } = {}) {
  if (selection) return 'selection';
  if (pdf) return 'pdf';
  const m = remembered?.[siteOf(url)];
  return REMEMBERED_MODES.includes(m) ? m : 'page';
}

/**
 * lab/sendAs after choosing `mode` on the site of `url`: the site moves to the front (an object keeps insertion order),
 * and only the SEND_AS_SITES most recent sites stay. A selection is never remembered. -> the new map (the same one when
 * nothing changes).
 */
export function rememberMode(map, url, mode) {
  const host = siteOf(url);
  if (!host || !REMEMBERED_MODES.includes(mode)) return map ?? {};
  const out = { [host]: mode };
  for (const [h, m] of Object.entries(map ?? {})) {
    if (h === host || Object.keys(out).length >= SEND_AS_SITES) continue;
    out[h] = m;
  }
  return out;
}

/** The words of a text: runs of non-whitespace. */
export const wordCount = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

/**
 * F10's Clean article as the page that is sent (x-cap "clean"):
 *   <!doctype html><html><head><meta charset="utf-8"><title>{title}</title><base href="{url}"><meta name="dl:capture"
 *   content="clean"></head><body><article><h1>{title}</h1><p>{byline} · {site}</p>{content}</article></body></html>
 * The byline line keeps what there is ("{byline}", "{site}", or none). content: Readability's article HTML, cleaned
 * by clean-html.js in the page.
 */
export function cleanArticleHtml({ title = '', url = '', byline = '', site = '', content = '' } = {}) {
  const by = [String(byline ?? '').trim(), String(site ?? '').trim()].filter(Boolean).map(esc).join(' · ');
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>'
    + (webUrl(url) ? `<base href="${escAttr(url)}">` : '') + '<meta name="dl:capture" content="clean"></head><body><article>'
    + `<h1>${esc(title)}</h1>` + (by ? `<p>${by}</p>` : '') + String(content ?? '') + '</article></body></html>';
}

/**
 * F04: no countdown for people who need more time (WCAG 2.2.1): the card opens with the choices and Send, and nothing
 * goes until Send. In the extension: Comfort, or "Always show Options before sending". (A browser tells an extension
 * nothing about screen readers or switch access.)
 */
export const noCountdown = (settings) => !!settings?.comfort || !!settings?.labAlwaysOptions;

/**
 * F04: the popup opens as the share-in-place card: Lab on, F04's Use switch on, and "Send when I click the toolbar
 * button" ticked (off by default).
 */
export const clickToSend = (settings) => labUseOn(settings, 'F04') && !!settings?.labClickSend;

/** F07: a row that waits for a connection: failed with errorCode 'network' (deferred offline, or the network failed). */
export const waitingForConnection = (row) => row?.status === 'failed' && row?.errorCode === 'network';

/** F07's queue (History's "Waiting to send ({n})"): the rows waiting to send (failed), newest first. */
export const queueRows = (rows) => (rows ?? []).filter((r) => r?.status === 'failed');

/**
 * F01's badge for the most recent row, with Lab on: … on its way (sending, sent, or waiting for a connection), ✓ on
 * your Daylight (delivered, whatever its state but a tap), ⌛ waiting for a tap (waiting or held), ! not on its way
 * (failed with a cause other than the network, expired). state: the ledger's {s, t} for the row (shown only for
 * delivered rows), or null. -> a LAB_TEXT.badge mark, or '' for no row.
 */
export function badgeMark(row, state = null) {
  const B = LAB_TEXT.badge;
  if (!row) return '';
  switch (row.status) {
    case 'sending': case 'sent': return B.sending;
    case 'failed': return waitingForConnection(row) ? B.sending : B.error;
    case 'expired': return B.error;
    case 'delivered': return state?.s === 'waiting' || state?.s === 'held' ? B.waiting : B.delivered;
    default: return '';
  }
}

/**
 * Whether the ack topic is worth reading for Lab states (F01): a row delivered within the state digest's 48 hours
 * (2.2.4) has no settled state yet. states: the ledger's {id: {s, t}}.
 */
export function wantsStates(rows, states = {}, now = Date.now()) {
  return (rows ?? []).some((r) => r?.status === 'delivered' && now - (r.delivered ?? 0) <= STATE_DIGEST_WINDOW_MS
    && !SETTLED_STATES.includes(states?.[r.id]?.s));
}

/**
 * F34's omnibox: a typed address, with https:// added to "example.com/story" (as the web sender reads one), or the
 * first URL in the text. -> a web URL, or null.
 */
export function normalizeUserUrl(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  const direct = webUrl(s) ?? findUrl(s);
  if (direct) return direct;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(s)) return webUrl(`https://${s}`);
  return null;
}
