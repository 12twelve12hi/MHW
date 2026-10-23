# Article fixtures (F10.1)

The pages `../../readability.test.mjs` runs Clean article on (LAB-PLAN F10.1: "On Readability's test pages plus ten news
fixtures, Clean article keeps at least 90% of the expected body text and drops navigation and footers").
`decoys/` holds four more pages, for the step Clean article runs before Readability.

## `readability/`: Mozilla Readability's own test pages

Twenty of the 128 pages in `test/test-pages/` of [mozilla/readability](https://github.com/mozilla/readability), tag
`0.6.0` (commit `04fd32f72b448c12b02ba6c40928b67e510bac49`), the release vendored in `share/js/capture/`. Each folder
holds that page's `source.html` and `expected.html` (Readability's own expected output), copied unmodified.
`pages.json` lists them with their SHA-256, and the test checks every file against it.

They are Apache-2.0 like the rest of that repository: `readability/LICENSE.md` is its licence notice, kept next to
them. The upstream pages include copies of third-party web pages, which Readability's authors collected as test cases.

The subset has twelve of Readability's structural cases and eight real-world pages:

- structural: `basic-tags-cleaning`, `hidden-nodes`, `missing-paragraphs`, `ol`, `remove-script-tags`,
  `reordering-paragraphs`, `replace-brs`, `rtl-1`, `social-buttons`, `svg-parsing`, `title-and-h1-discrepancy` and
  `visibility-hidden`;
- real-world: `001`, `daringfireball-1`, `ehow-1`, `ietf-1`, `keep-tabular-data`, `medium-2`, `mozilla-2` and
  `v8-blog`.

All 128 upstream pages were measured the same way while choosing the subset (Oct 22, with linkedom). Every one kept at
least 95% of its expected body.

## `news/`: ten news-style pages written for this test

`<name>.html` is a whole page and `<name>.txt` is the body Clean article must keep: paragraphs, subheadings, list items
and table rows, one per block, separated by blank lines. Every word in them was written for this test. The
publications, places, people, companies and events are made up, and no text comes from a real news site.

Each page has a different structure: semantic `<article>` markup, a `<div>` layout with advertisements between
paragraphs, `<main>` with sections and a pull quote, a table layout, a live blog, comments and a cookie notice, JSON-LD
with share buttons, an opinion column with a drop cap, and an explainer with a table and a numbered list.

Convention: everything that is not the article sits in `nav`, the page's own `body > header`, `footer`, `aside`,
`form`, `.comments` or `.cookie-banner`. The test checks that none of those regions holds text from the body. Every
line of their text with 3 words or more must be missing from the clean article.

Known results (Oct 23):

- Every page keeps 100% of its body.
- `storm-warning-live` has a "Key points" box, a heading and a list next to the live entries. Readability alone drops
  it (87% of the body). `prepareForReadability` (`share/js/capture/clean-html.js`), which Clean article runs on the
  clone before Readability, moves it to the start of the entries, so it is kept, first, as on the page. It moves
  nothing on the other nine pages: their Clean article is exactly Readability's, and the test checks that.
- `lumen-leaf-ereader` has an advertisement inside the article's text. Readability keeps that advertisement's text.
  F10.1 asks only for navigation and footers to go, so the test does not count it.

## `decoys/`: four pages whose summary-like boxes are not the article

Written for this test in the same way and under the same convention as `news/` (made-up publications, places, people
and events). Each article has its body, `<name>.txt`, and beside it, as `storm-warning-live`'s Key points are, boxes
named or titled like summaries that hold a list but are not the article's text. `prepareForReadability` must leave
each where it is, so Readability drops it:

- `harbour-bridge-repairs`: navigation, an "At a glance" box with `role="navigation"` whose items are links to parts of
  the page, and related links, a "Highlights" box whose items are links to other stories;
- `market-hall-newsletter`: a newsletter, a "Key points, every Friday" box named `key-points-signup` with a sign-up
  form;
- `river-festival-sponsored`: an advertisement, a "Takeaways" box named `takeaways ad-slot`, labelled Advertisement,
  with an `ad-label` paragraph inside;
- `valley-night-buses`: a weather box, "At a glance: the weekend's weather", marked only by `role="complementary"`;
  other news, an "In brief" box where two items of five are links but links are nearly half of its text; and teasers,
  a "Highlights" box whose items are `<article>` cards with a headline and no link (a script opens them).

The test checks that Clean article keeps the body and none of each box's lines, and that the same boxes, once turned
into plain summary boxes (no role, a `key-points` class, nothing named inside, no links, forms, iframes or media, no
headings or articles in the items), are moved and kept: so each page tests what keeps its boxes out, not its markup.
It also checks variants with one marker left, each of which must keep its box out alone: the "At a glance" box with
only its role or only its links, the newsletter with only its sign-up name, only its form (named `key-points-box`, or
named by its heading alone) or an iframe in place of the form, and the advertisement with only its class, its
aria-label or its `ad-label` paragraph.
