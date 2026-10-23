// clean-html.js: cleans a captured page before it leaves the device (LAB-PLAN F03, "Pages as you see them"), and
// readies a clone for Readability (F10, Clean article: prepareForReadability, at the end of this file).
//
// The one source. The extension's build copies this file, and apple/Shared/GetPage.js inlines it between the lines
// "// BEGIN clean-html" and "// END clean-html"; `node share/js/capture/sync.mjs --check <copy>` keeps every copy
// equal to it. It is a classic script (no import or export, and no globals but cleanHtml and prepareForReadability)
// so both can take it as it is; CommonJS callers (the tests) get them from module.exports.
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


// prepareForReadability(clone): run it on the clone Readability will parse, just before Readability (LAB-PLAN F10,
// Clean article):
//
//   var clone = document.cloneNode(true);
//   prepareForReadability(clone);
//   var article = new Readability(clone).parse();
//
// Readability scores paragraphs, never list items, and keeps the best-scoring element of the page with those of its
// siblings that score well or are paragraphs. So a summary box beside the article's text, such as a live page's "Key
// points" (a heading and a list), goes, though it is the article's own text. This moves each summary box into the
// element that holds the article's paragraphs: to its start when the box comes before it, to its end when after, so
// the reading order stays (boxes keep their order too). -> the number of boxes it moved or made a <div> (0, changing
// nothing, when given the page's own document or no document).
//
// A summary box is a <div>, <section>, <aside> (made a <div>, as Readability drops every <aside>), <ul>, <ol> or <dl>:
// - inside an <article> or <main> (or role="article" or "main"): the box's article;
// - named as one: its class, id or aria-label says key points, key facts, key takeaways, takeaways, summary,
//   highlights, at a glance, in brief or tl;dr (key-points, keyPoints, key_points, keypoints...), or its first heading
//   (<h2> to <h6>) starts with one of them ("Key points", "At a glance"...); a bare list may also be named by the
//   heading just before it, and a bare list named either way takes that heading along;
// - holding a list: a <ul> or <ol> with two items or more, or a <dl> with two <dd> or more; and 25 characters of text;
// - and not navigation, related links, a newsletter or an advertisement. It stays where it is (and Readability drops
//   it as before) when:
//   - it, or an element around it, is a <nav>, <aside>, <footer> or <form>, or has the role navigation, banner,
//     complementary, contentinfo, search, menu, menubar, dialog, alertdialog or form (the box may be an <aside>);
//   - its own class, id or aria-label, or that of an element around it inside its article, names furniture:
//     related, recommend..., read more / next / also, more stories / from / news / on, newsletter, subscri...,
//     sign up, promo..., sponsor..., advert..., ad, ads, outbrain, taboola, share, sharing, social, comment(s),
//     trending, popular, most read / viewed / popular / shared, nav..., menu, breadcrumb, toc, sidebar, widget,
//     footer, masthead, paywall, cookie, banner, teaser, cta, partner, affiliate, shop... or deal;
//   - more than a quarter of its text is links, or half of the items of a list in it or more hold a link (headlines,
//     a table of contents), or an item holds a heading or an <article> (teasers for other stories);
//   - it holds a form control, an iframe, a video, audio, an embed or an object.
// The element that holds the article's paragraphs is found as Readability scores: each <p> of 25 characters or more in
// the box's article, outside summary boxes and furniture, scores 1, plus 1 per comma-separated part, plus 1 per 100
// characters (3 at most), and adds that to its parent, half of it to its grandparent and a sixth, a ninth and a twelfth
// to the three elements above (none above the article); the best-scoring element wins. A box already inside that
// element, or around it, stays where it is (an <aside> one still becomes a <div>).

function prepareForReadability(doc) {
  if (!doc || !doc.body || typeof doc.querySelectorAll !== 'function') return 0;
  if (typeof document !== 'undefined' && doc === document) return 0; // never the live page: this moves its elements
  var SUMMARY_NAME = /(^|-)(key-?(points?|facts|takeaways?)|takeaways?|summary|summaries|highlights|at-?a-?glance|tl-?dr|in-?brief)(-|$)/;
  var SUMMARY_TITLE = /^(key (points?|facts|takeaways?)|(the )?takeaways?|(in )?summary|highlights|at a glance|in brief|tl;? ?dr)\b/;
  var FURNITURE_NAME = new RegExp('(^|-)(related|recommend[a-z]*|read-?(more|next|also)|more-?(stories|from|news|on)'
    + '|newsletters?|subscri[a-z]*|sign-?up|promo[a-z]*|sponsor[a-z]*|advert[a-z]*|ads?|outbrain|taboola|share|sharing'
    + '|social|comments?|trending|popular|most-?(read|viewed|popular|shared)|nav[a-z]*|menus?|breadcrumbs?|toc|sidebar'
    + '|widgets?|footer|masthead|paywall|cookies?|banner|teasers?|cta|partners?|affiliates?|shop[a-z]*|deals?)(-|$)');
  var FURNITURE_TAGS = { nav: 1, aside: 1, footer: 1, form: 1 };
  var FURNITURE_ROLES = { navigation: 1, banner: 1, complementary: 1, contentinfo: 1, search: 1, menu: 1, menubar: 1,
    dialog: 1, alertdialog: 1, form: 1 };
  var NOT_IN_A_BOX = 'form, input, select, textarea, iframe, video, audio, embed, object';
  var COMMAS = /[,\u060C\uFE50\uFE10\uFE11\u2E41\u2E34\u2E32\uFF0C]/; // the commas Readability counts
  var lower = function (s) { return String(s == null ? '' : s).trim().toLowerCase(); };
  var tagOf = function (el) { return lower(el.localName || el.tagName); };
  var textOf = function (el) { return String(el.textContent == null ? '' : el.textContent).replace(/\s+/g, ' ').trim(); };
  var isElement = function (n) { return !!n && n.nodeType === 1; };
  // class, id and aria-label as lowercase words joined by "-": "RenderKeyPoints key_points" -> "render-key-points-key-points"
  var nameOf = function (el) {
    return [el.getAttribute('class'), el.getAttribute('id'), el.getAttribute('aria-label')].join(' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  };
  var hasRole = function (el, roles) {
    var r = lower(el.getAttribute('role')).split(/\s+/);
    for (var i = 0; i < r.length; i++) if (roles[r[i]]) return true;
    return false;
  };
  var heading = function (el) { return isElement(el) && /^h[2-6]$/.test(tagOf(el)) ? el : null; };
  var titled = function (h) { return !!h && SUMMARY_TITLE.test(textOf(h).toLowerCase()); };
  var rootOf = function (el) {
    for (var n = el.parentNode; isElement(n); n = n.parentNode) {
      var tag = tagOf(n);
      if (tag === 'article' || tag === 'main' || hasRole(n, { article: 1, main: 1 })) return n;
    }
    return null;
  };
  // what an element is on its own: 1, a furniture tag or role; 2, a furniture name; 3, both; 0, neither
  var seen = new Map();
  var furnitureOf = function (n) {
    var f = seen.get(n);
    if (f === undefined) {
      f = (FURNITURE_TAGS[tagOf(n)] || hasRole(n, FURNITURE_ROLES) ? 1 : 0) | (FURNITURE_NAME.test(nameOf(n)) ? 2 : 0);
      seen.set(n, f);
    }
    return f;
  };
  // Whether el is furniture or sits in it: tags and roles count up to the top of the document, names only below root.
  // A box may be an <aside> itself (its role and name still count).
  var inFurniture = function (el, root, isBox) {
    var inside = true;
    for (var n = el; isElement(n); n = n.parentNode) {
      if (n === root) inside = false;
      var f = furnitureOf(n);
      if ((isBox && n === el) ? hasRole(n, FURNITURE_ROLES) : (f & 1)) return true;
      if ((f & 2) && inside) return true;
    }
    return false;
  };
  // A list of two items or more, none of them a teaser (a heading or an <article> in it), fewer than half of them with a
  // link
  var holdsList = function (el) {
    var tag = tagOf(el);
    var lists = tag === 'ul' || tag === 'ol' || tag === 'dl' ? [el] : Array.prototype.slice.call(el.querySelectorAll('ul, ol, dl'));
    var found = false;
    for (var i = 0; i < lists.length; i++) {
      var item = tagOf(lists[i]) === 'dl' ? 'dd' : 'li';
      var items = 0;
      var linked = 0;
      for (var c = lists[i].firstElementChild; c; c = c.nextElementSibling) {
        if (tagOf(c) !== item || !textOf(c)) continue;
        if (c.querySelector('h1, h2, h3, h4, h5, h6, article')) return false;
        items++;
        if (c.querySelector('a[href]')) linked++;
      }
      if (items && linked * 2 >= items) return false;
      if (items >= 2) found = true;
    }
    return found;
  };
  var linkShare = function (el, length) {
    var links = el.querySelectorAll('a');
    var linked = 0;
    for (var i = 0; i < links.length; i++) linked += textOf(links[i]).length;
    return length ? linked / length : 0;
  };

  var boxes = [];
  var inBox = function (el) {
    for (var i = 0; i < boxes.length; i++) if (boxes[i].el === el || boxes[i].el.contains(el)) return true;
    return false;
  };
  var all = doc.body.querySelectorAll('div, section, aside, ul, ol, dl');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var tag = tagOf(el);
    var bare = tag === 'ul' || tag === 'ol' || tag === 'dl';
    var own = SUMMARY_NAME.test(nameOf(el));
    var before = bare ? heading(el.previousElementSibling) : null;
    var lead = before && (own || titled(before)) ? before : null;
    var first = el.firstElementChild;
    var named = own || !!lead || (!bare && titled(heading(first) || (first && heading(first.firstElementChild))));
    if (!named || inBox(el)) continue;
    var root = rootOf(el);
    if (!root || inFurniture(el, root, true)) continue;
    var text = textOf(el);
    if (text.length < 25 || !holdsList(el) || linkShare(el, text.length) > 0.25 || el.querySelector(NOT_IN_A_BOX)) continue;
    boxes.push({ el: el, lead: lead, root: root });
  }
  if (!boxes.length) return 0;

  var bodies = [];
  var bodyOf = function (root) {
    for (var b = 0; b < bodies.length; b++) if (bodies[b].root === root) return bodies[b].body;
    var scores = new Map();
    var best = null;
    var ps = root.querySelectorAll('p');
    for (var p = 0; p < ps.length; p++) {
      var t = textOf(ps[p]);
      if (t.length < 25 || inBox(ps[p]) || inFurniture(ps[p], root, false)) continue;
      var score = 1 + t.split(COMMAS).length + Math.min(Math.floor(t.length / 100), 3);
      var n = ps[p].parentNode;
      for (var level = 0; isElement(n) && level < 5; level++) {
        scores.set(n, (scores.get(n) || 0) + score / (level === 0 ? 1 : level === 1 ? 2 : level * 3));
        if (n === root) break;
        n = n.parentNode;
      }
    }
    scores.forEach(function (s, el) { if (!best || s > scores.get(best)) best = el; });
    bodies.push({ root: root, body: best });
    return best;
  };
  // whether b comes after a in the document, neither holding the other (compareDocumentPosition, without relying on
  // every DOM getting it right across branches)
  var follows = function (a, b) {
    var child = a;
    while (child.parentNode && !child.parentNode.contains(b)) child = child.parentNode;
    for (var n = child.nextSibling; n; n = n.nextSibling) if (n === b || (isElement(n) && n.contains(b))) return true;
    return false;
  };
  var asDiv = function (el) {
    var div = el.ownerDocument.createElement('div');
    var names = typeof el.getAttributeNames === 'function'
      ? el.getAttributeNames()
      : Array.prototype.map.call(el.attributes || [], function (a) { return a.name; });
    for (var a = 0; a < names.length; a++) div.setAttribute(names[a], el.getAttribute(names[a]));
    while (el.firstChild) div.appendChild(el.firstChild);
    el.parentNode.replaceChild(div, el);
    return div;
  };

  var changed = 0;
  var starts = []; // per body, the last node moved to its start: the next one goes after it
  var lastAtStart = function (body) {
    for (var b = 0; b < starts.length; b++) if (starts[b].body === body) return starts[b];
    starts.push({ body: body, node: null });
    return starts[starts.length - 1];
  };
  for (var k = 0; k < boxes.length; k++) {
    var box = boxes[k];
    var body = bodyOf(box.root);
    if (!body || box.el.contains(body)) continue;
    var inside = body.contains(box.el);
    var after = !inside && !follows(box.el, body);
    if (tagOf(box.el) === 'aside') box.el = asDiv(box.el);
    else if (inside) continue;
    if (!inside) {
      var nodes = box.lead ? [box.lead, box.el] : [box.el];
      var start = lastAtStart(body);
      for (var m = 0; m < nodes.length; m++) {
        if (after) { body.appendChild(nodes[m]); continue; }
        body.insertBefore(nodes[m], start.node ? start.node.nextSibling : body.firstChild);
        start.node = nodes[m];
      }
    }
    changed++;
  }
  return changed;
}

if (typeof module === 'object' && module && module.exports) module.exports = { cleanHtml: cleanHtml, prepareForReadability: prepareForReadability };
