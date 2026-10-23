# Capture code (the one source)

What the senders run inside a web page before sending it (LAB-PLAN F03 and F10). Each consumer keeps a copy, and CI
checks every copy against this folder with `sync.mjs` (LAB-PLAN 6.3). Only the share lane edits these files; when they
change, each consumer lane re-syncs its own copy.

| File | What | Copied by |
|---|---|---|
| `clean-html.js` | `cleanHtml(document.documentElement.cloneNode(true))`: removes `<template>` elements with their content, cleans a `<noscript>`'s markup, and removes scripts (JSON-LD stays), `on*` attributes, iframe `srcdoc`, `javascript:` links, hidden and password inputs, other inputs' values, textarea text, `selected`, and csrf/token metas; returns `'<!doctype html>\n' + outerHTML`. And `prepareForReadability(clone)`, for Clean article (F10): run on the clone Readability parses, before `new Readability(clone).parse()`, it moves summary boxes ("Key points", summaries, highlights, takeaways, "At a glance" lists) into the element that holds the article's paragraphs, where Readability keeps them, and leaves navigation, related links, newsletters and advertisements where they are (the rules are in its comment); returns how many boxes it moved. A classic script (CommonJS exports for the tests) | the extension's build (whole file); `apple/Shared/ShareExtension/GetPage.js` once it inlines it (between `// BEGIN clean-html` and `// END clean-html`; LAB-PLAN F03, F10: no copy yet) |
| `Readability.js` | Mozilla Readability **0.6.0**, unmodified (`Readability-LICENSE.md`, Apache-2.0). `sync.mjs` checks its SHA-256 on every run | the extension's build; `GetPage.js` once it inlines it (between `// BEGIN Readability` and `// END Readability`; no copy yet) |
| `sync.mjs` | `node sync.mjs --check <file>...` exits 1 when a copy differs; `--write` rewrites the copies. A file named `clean-html.js` or `Readability.js` is a whole copy; any other file holds marked blocks, each the source byte for byte between its marker lines (the markers may be indented, the block is not) | CI: `rx-extension.yml` and `rx-apple.yml` on their own copies |
| `package.json` | `"type": "commonjs"`, so Node reads the two scripts as classic files | — |

Clean article runs, in the page, on one clone: `prepareForReadability(clone)`, then `new Readability(clone).parse()`, then
`cleanHtml` on the article's HTML in a document of its own (`../../README.md`, "Clean article's call order", has the
code for `captureArticle` and `GetPage.js`, neither of which calls `prepareForReadability` yet).

The tests are `../test/clean-html.test.mjs` and `../test/readability.test.mjs` (F10.1), with linkedom as the DOM
(`npm ci` in `share/`).
