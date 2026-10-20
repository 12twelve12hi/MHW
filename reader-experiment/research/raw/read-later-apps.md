# Read-later apps survey: raw research notes

Researcher angle: Instapaper (+ Send to Kindle digests, Kobo), Matter, GoodLinks, Raindrop.io, Wallabag, Karakeep (ex-Hoarder), Linkwarden, Fabric, legacy Pocket and Omnivore.
Project context: "Send to Daylight" companion apps for the Daylight DC-1 (Android 13, 10.5" grayscale LivePaper tablet, Wacom pen).
Compiled: 2026-10-20.

## IMPORTANT: research-method limitations (read first)

- WebFetch is non-functional in this environment (every host fails with `getaddrinfo ENOTFOUND`), and the egress proxy answers HTTP 403 to CONNECT for every host I probed with curl (hn.algolia.com, apps.apple.com, play.google.com, chromewebstore.google.com, addons.mozilla.org, github.com, mobileread.com, instapaper.com, wallabag.org, docs.karakeep.app, youtube.com, reddit.com, kobo, getpocket.com, wikipedia ...). The proxy status endpoint recorded `connect_rejected ... 403 (policy denial)` for hn.algolia.com. Per the proxy README I did NOT try to route around this.
- WebSearch's own crawler also refuses reddit.com and theverge.com ("domains not accessible to our user agent").
- Therefore EVERYTHING below comes from WebSearch result summaries (which are synthesised by the search tool from the pages it lists) plus the page titles/URLs/snippets it returned. I could not open any page myself. Where a quote is in quotation marks it is text the search tool reproduced from the source page; treat exact wording as "as relayed by search tool", not independently verified. Where the search tool flagged a conflict or low-quality source I say so.
- allowed_domains filters worked for: news.ycombinator.com, mobileread.com, lemmy.*, macrumors.com, talk.macpowerusers.com, macstories.net, blog.instapaper.com, instapaper.com, getmatter.com. HN and MobileRead threads came back as titles+URLs+summaries, which is the best "voice of users" available.
- Reddit content: not reachable at all. HN, MacRumors forums, MPU Talk (talk.macpowerusers.com), MobileRead and Lemmy used as substitutes.
- Confidence labels: [DOC] = vendor docs/blog as relayed; [PRESS] = journalism; [USER] = forum/HN/user voice; [BLOG] = third-party blog/SEO (lower trust).

