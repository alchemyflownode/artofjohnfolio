# Art of Juan

The public portfolio of **Juan Pabrua** — 29 works on record, each with its own page and a permanent
address that a printed QR code resolves to.

This repository contains everything needed to **build, maintain and deploy** the public website. It
contains nothing else: no internal tooling, no planning documents, no credentials, no analytics.

---

## Quick start

No dependencies. No build tool. No framework.

```bash
node tools/build.mjs        # regenerate site/ from data/
node tools/serve.mjs        # preview at http://127.0.0.1:8080
```

`site/` is the deployable artifact. It is a complete static website: open `site/index.html` directly and
everything works, with or without JavaScript.

## What is here

| path | what it is |
|---|---|
| `site/` | the built website — HTML, images, CSS, scripts, vCard, `_redirects`, `_headers` |
| `data/` | the catalogue: artist, 29 works, QR identities, site configuration, image manifest |
| `web/` | the authored stylesheet, enhancement module, motion decisions, favicon |
| `tools/` | the generator, the identity rules, the preview server, the deploy preflight |
| `wrangler.jsonc` | Cloudflare Workers static assets configuration |

## The three printed addresses

Every work has a permanent path. A QR code beside a painting encodes the path, **never a page route**,
so the website can be redesigned or moved without reprinting a label.

| type | encodes | resolves to |
|---|---|---|
| artist | `/q/juan` | `/` |
| artwork | `/q/art/<artworkId>` | `/work/<artworkId>/` |
| exhibition | `/q/event/<slug>` | supported by the schema; none published |

`data/qr-identities.json` is the table. `site/_redirects` is generated from it on every build, so the
host and the local preview server resolve the same path to the same page. `tools/lock-identities.mjs`
records which path belongs to which work; **a path may never be moved to a different painting.**

## Adding or editing a work

1. Add or edit an entry in `data/catalogue.json` → `works[]`. Only `artworkId`, `titleStatus`,
   `sourceFile`, `order` and `kind` are required. **Leave `year`, `medium`, `dimensions` and `story`
   as `null`** unless the artist has supplied them — the page then states, in one sentence, which facts
   are missing, and the structured data omits them. A guessed year is a false record.
2. Add the identity to `data/qr-identities.json`: `publicPath: "/q/art/<id>"` → `destination:
   "/work/<id>/"`. The build refuses anything else.
3. `node tools/build.mjs`, then `node tools/cloudflare-preflight.mjs`.

Available states are a closed set (`available`, `reserved`, `sold`, `unavailable`, `unknown`). Only
`unknown` is used today, because no availability has been recorded.

## Deploying to Cloudflare

The Worker has **no script**: every request is a static asset, and the printed paths are 302s from
`site/_redirects`. The 404 page is `site/404.html`.

```bash
npx wrangler deploy --dry-run     # validate the configuration
npx wrangler deploy               # publish
```

`node tools/cloudflare-preflight.mjs` checks, offline, that the configuration and the built site agree
before you deploy: the Wrangler file parses, the asset directory exists, every printed identity has a
matching redirect in both path spellings, no rule shadows a real file, and the 404 exists.

### Assigning the domain

`data/site.json` has `canonicalOrigin: null`, so absolute URLs currently use a preview origin and the
HTML marks itself `aoj:origin-state=preview`. Set a real origin and rebuild; that activates canonical
links, `sitemap.xml` and the robots `Sitemap` line.

## Source images

The full-resolution originals are **not** in this repository. They carry camera and software metadata
(EXIF) that belongs to the artist, and the published derivatives already contain everything the site
needs. Re-deriving the image sizes therefore requires the artist's archive; editing text, metadata and
layout does not.

## Contact

Public contact is **Instagram (@artofjuan)** and the downloadable contact card at
`/contact/juan-pabrua.vcf`. No phone number and no email address are published. Enquiries go directly
to the artist.

## Copyright

All paintings, images, text and the artist's motto are © Juan Pabrua. All rights reserved. Nothing in
this repository grants a licence to reproduce the artwork. The site code is provided so the portfolio
can be maintained; that is not a licence to the work it displays.
