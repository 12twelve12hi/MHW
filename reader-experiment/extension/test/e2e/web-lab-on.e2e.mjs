// web.e2e.mjs's v1.1 flows again with Lab on, the default (LAB-PLAN 1.2): pairing from links and typed codes, sending
// links, PDFs and a 5 MB file, the Shortcut's and the share sheet's forms, a file over 9 MB, offline use, pairing
// changes and Delivered ✓, through Lab's send path (smart intake, the timeline's rows). What Lab changes on purpose is
// in web.e2e.mjs's LAB branches.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node --test test/e2e/web-lab-on.e2e.mjs
process.env.DLS_WEB_E2E_LAB = '1';
await import('./web.e2e.mjs');
