// clean-html.js: cleans a captured page before it leaves the device (LAB-PLAN F03, "Pages as you see them").
//
// The one source. The extension's build copies this file, and apple/Shared/GetPage.js inlines it between the lines
// "// BEGIN clean-html" and "// END clean-html"; `node share/js/capture/sync.mjs --check <copy>` keeps every copy
// equal to it. It is a classic script (no import or export, and no global but cleanHtml) so both can take it as it
// is; CommonJS callers (the tests) get it from module.exports.
//
// Run it on a clone, never on the live page:
//
//   cleanHtml(document.documentElement.cloneNode(true))   ->   '<!doctype html>\n' + the cleaned clone's outerHTML
//
// (Given an element that is still in a document, it clones it first; given nothing, or a <template>, it returns ''.)
// On the clone it:
// - removes every <template> with its content: querySelectorAll never reaches a template's content, but cloneNode
//   copies it and outerHTML writes it out, and nothing in a template is ever shown;
// - cleans what a <noscript> holds: with scripting on (any real page) its content is one text node that outerHTML
//   writes out as it is, and that a reader without scripting parses as elements, so that text is parsed in an inert
//   template, cleaned by these same rules, and put back (emptied when it cannot be parsed);
// - removes every <script> whose type, trimmed and lowercased, is not application/ld+json;
// - removes every attribute whose name starts with "on", in any case;
// - removes srcdoc from iframes;
// - removes the href (and an SVG link's xlink:href) of links (a, area) that start with javascript: (ignoring case,
//   spaces and control characters);
// - removes <input type=hidden> and <input type=password>, clears other inputs' value, empties <textarea> and drops
//   `selected` from options;
// - removes <meta> elements whose name or property contains "csrf" or "token" (in any case).

function cleanHtml(root) {
  var lower = function (s) { return String(s == null ? '' : s).trim().toLowerCase(); };
  if (!root || typeof root.querySelectorAll !== 'function' || lower(root.localName || root.tagName) === 'template') return '';
  if (root.isConnected) root = root.cloneNode(true);
  var isJavascriptUrl = function (href) {
    return String(href == null ? '' : href).replace(/[\u0000- ]+/g, '').toLowerCase().indexOf('javascript:') === 0;
  };
  var drop = function (el) { if (el.parentNode) el.parentNode.removeChild(el); };
  // A <noscript>'s markup as text (scripting on): parsed in an inert template (no scripts run, nothing loads), cleaned,
  // and serialised again (template.innerHTML is its content's markup). The box itself is walked too, for DOMs such as
  // linkedom that keep a template's children apart from its content; a browser finds nothing there.
  // -> the cleaned markup, or ''.
  var cleanMarkup = function (el, markup, depth) {
    var doc = el.ownerDocument;
    var box = doc && typeof doc.createElement === 'function' ? doc.createElement('template') : null;
    if (!box || !box.content || typeof box.content.querySelectorAll !== 'function' || depth > 8) return '';
    box.innerHTML = markup;
    clean(box.content, false, depth + 1);
    clean(box, false, depth + 1);
    return String(box.innerHTML == null ? '' : box.innerHTML);
  };
  var clean = function (node, withSelf, depth) {
    var all = (withSelf ? [node] : []).concat(Array.prototype.slice.call(node.querySelectorAll('*')));
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var tag = lower(el.localName || el.tagName);
      if (tag === 'template') { drop(el); continue; }
      if (tag === 'script' && lower(el.getAttribute('type')) !== 'application/ld+json') { drop(el); continue; }
      if (tag === 'meta') {
        var named = lower(el.getAttribute('name')) + ' ' + lower(el.getAttribute('property'));
        if (named.indexOf('csrf') >= 0 || named.indexOf('token') >= 0) { drop(el); continue; }
      }
      if (tag === 'input') {
        var type = lower(el.getAttribute('type'));
        if (type === 'hidden' || type === 'password') { drop(el); continue; }
        el.removeAttribute('value');
      }
      if (tag === 'noscript' && !el.firstElementChild) {
        var markup = String(el.textContent == null ? '' : el.textContent);
        if (markup.indexOf('<') >= 0) el.textContent = cleanMarkup(el, markup, depth);
      }
      if (tag === 'textarea') el.textContent = '';
      if (tag === 'option') el.removeAttribute('selected');
      if (tag === 'iframe') el.removeAttribute('srcdoc');
      if (tag === 'a' || tag === 'area') {
        if (isJavascriptUrl(el.getAttribute('href'))) el.removeAttribute('href');
        if (isJavascriptUrl(el.getAttribute('xlink:href'))) el.removeAttribute('xlink:href');
      }
      var names = typeof el.getAttributeNames === 'function'
        ? el.getAttributeNames()
        : Array.prototype.map.call(el.attributes || [], function (a) { return a.name; });
      for (var j = 0; j < names.length; j++) if (/^on/i.test(names[j])) el.removeAttribute(names[j]);
    }
  };
  clean(root, true, 0);
  return '<!doctype html>\n' + root.outerHTML;
}

if (typeof module === 'object' && module && module.exports) module.exports = { cleanHtml: cleanHtml };
