// clean-html.js: cleans a captured page before it leaves the device (LAB-PLAN F03, "Pages as you see them").
//
// The one source. The extension's build copies this file, and apple/Shared/GetPage.js inlines it between the lines
// "// BEGIN clean-html" and "// END clean-html"; `node share/js/capture/sync.mjs --check <copy>` keeps every copy
// equal to it. It is a classic script (no import or export) so both can take it as it is; CommonJS callers (the
// tests) get it from module.exports.
//
// Run it on a clone, never on the live page:
//
//   cleanHtml(document.documentElement.cloneNode(true))   ->   '<!doctype html>\n' + the cleaned clone's outerHTML
//
// (Given an element that is still in a document, it clones it first.) On the clone it:
// - removes every <script> whose type, trimmed and lowercased, is not application/ld+json;
// - removes every attribute whose name starts with "on", in any case;
// - removes srcdoc from iframes;
// - removes the href of links (a, area) that start with javascript: (ignoring case, spaces and control characters);
// - removes <input type=hidden> and <input type=password>, clears other inputs' value, empties <textarea> and drops
//   `selected` from options;
// - removes <meta> elements whose name or property contains "csrf" or "token" (in any case).

function cleanHtml(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return '';
  if (root.isConnected) root = root.cloneNode(true);
  var lower = function (s) { return String(s == null ? '' : s).trim().toLowerCase(); };
  var isJavascriptUrl = function (href) {
    return String(href == null ? '' : href).replace(/[\u0000- ]+/g, '').toLowerCase().indexOf('javascript:') === 0;
  };
  var drop = function (el) { if (el.parentNode) el.parentNode.removeChild(el); };
  var all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var tag = lower(el.localName || el.tagName);
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
    if (tag === 'textarea') el.textContent = '';
    if (tag === 'option') el.removeAttribute('selected');
    if (tag === 'iframe') el.removeAttribute('srcdoc');
    if ((tag === 'a' || tag === 'area') && isJavascriptUrl(el.getAttribute('href'))) el.removeAttribute('href');
    var names = typeof el.getAttributeNames === 'function'
      ? el.getAttributeNames()
      : Array.prototype.map.call(el.attributes || [], function (a) { return a.name; });
    for (var j = 0; j < names.length; j++) if (/^on/i.test(names[j])) el.removeAttribute(names[j]);
  }
  return '<!doctype html>\n' + root.outerHTML;
}

if (typeof module === 'object' && module && module.exports) module.exports = { cleanHtml: cleanHtml };
