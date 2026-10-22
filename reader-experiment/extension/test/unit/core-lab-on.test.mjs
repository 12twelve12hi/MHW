// core.test.mjs's v1.1 flows again with Lab on, the default (LAB-PLAN 1.2): sends, retries, relay trouble (429, 413),
// PDFs and their permission, pairing changes, through Lab's send path. A Lab-on regression in them fails here even
// when Lab's own tests (lab-send.test.mjs) pass. What Lab changes on purpose is in core.test.mjs's LAB branches.
//
//   node --test test/unit/core-lab-on.test.mjs
process.env.DLS_TEST_LAB = '1';
await import('./core.test.mjs');
