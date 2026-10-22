// extension.e2e.mjs's v1.1 flows again with Lab on, the default (LAB-PLAN 1.2): pairing, sending pages, PDFs and
// links, the menus and the shortcut, Delivered ✓, relay trouble (429 with Retry now, 413, Cancel) and pairing changes,
// through Lab's popup and send path. What Lab changes on purpose is in extension.e2e.mjs's LAB branches.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/extension-lab-on.e2e.mjs
process.env.DLS_E2E_LAB = '1';
await import('./extension.e2e.mjs');
