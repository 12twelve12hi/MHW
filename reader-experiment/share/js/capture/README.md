# Capture code (the one source)

What the senders run inside a web page before sending it (LAB-PLAN F03 and F10). Each consumer keeps a copy, and CI
checks every copy against this folder with `sync.mjs` (LAB-PLAN 6.3). Only the share lane edits these files; when they
change, each consumer lane re-syncs its own copy.

| File | What | Copied by |
|---|---|---|
| `clean-html.js` | `cleanHtml(document.documentElement.cloneNode(true))`: removes `<template>` elements with their content, cleans a `<noscript>`'s markup, and removes scripts (JSON-LD stays), `on*` attributes, iframe `srcdoc`, `javascript:` links, hidden and password inputs, other inputs' values, textarea text, `selected`, and csrf/token metas; returns `'<!doctype html>\n' + outerHTML`. A classic script (CommonJS export for the tests) | the extension's build (whole file); `apple/Shared/GetPage.js` (between `// BEGIN clean-html` and `// END clean-html`) |
| `Readability.js` | Mozilla Readability **0.6.0**, unmodified (`Readability-LICENSE.md`, Apache-2.0). `sync.mjs` checks its SHA-256 on every run | the extension's build; `GetPage.js` (between `// BEGIN Readability` and `// END Readability`) |
| `sync.mjs` | `node sync.mjs --check <file>...` exits 1 when a copy differs; `--write` rewrites the copies. A file named `clean-html.js` or `Readability.js` is a whole copy; any other file holds marked blocks, each the source byte for byte between its marker lines (the markers may be indented, the block is not) | CI: `rx-extension.yml` and `rx-apple.yml` on their own copies |
| `package.json` | `"type": "commonjs"`, so Node reads the two scripts as classic files | — |

The tests are `../test/clean-html.test.mjs` (with linkedom as the DOM: `npm ci` in `share/`).
