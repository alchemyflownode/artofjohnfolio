#!/usr/bin/env node
/**
 * ART OF JUAN — static site generator.
 *
 * Deterministic and dependency-free. Reads data/*.json and writes HTML, the
 * stylesheet, the scripts, the vCard, robots.txt and the two Cloudflare control
 * files (_redirects, _headers) into site/. It never reads the clock, never
 * iterates a hash map, and never invents a value: a field the catalogue does not
 * hold is rendered as a deliberate absence, in the page and in the structured
 * data alike.
 *
 *   node tools/build.mjs                                  # build ./site
 *   node tools/build.mjs --origin=https://artofjuan.com   # assign the domain
 *
 * With no origin, absolute URLs use the preview origin and the HTML says so
 * (meta[name="aoj:origin-state"]). Assigning a real origin also emits canonical
 * links, sitemap.xml and the robots Sitemap line.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIdentities, isSafeDestination } from './lib/identity.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback = null) {
  const hit = process.argv.slice(2).find((a) => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  if (eq > -1) return hit.slice(eq + 1);
  const i = process.argv.indexOf(hit);
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(APP, rel), 'utf8'));
const artist = readJSON('data/artist.json');
const catalogue = readJSON('data/catalogue.json');
const qr = readJSON('data/qr-identities.json');
const images = readJSON('data/images.json');
const site = readJSON('data/site.json');

/* The output directory and origin are per-run, because the determinism and
   canonical witnesses build the same data twice into different places. */
let OUT = path.resolve(APP, 'site');
let ORIGIN = (site.canonicalOrigin || site.previewOrigin).replace(/\/+$/, '');
let originState = site.canonicalOrigin ? 'canonical' : 'preview';
let SILENT = false;

function setTarget(opts = {}) {
  OUT = path.resolve(APP, opts.out || 'site');
  const chosen = opts.origin || site.canonicalOrigin;
  originState = chosen ? 'canonical' : 'preview';
  ORIGIN = (chosen || site.previewOrigin).replace(/\/+$/, '');
  SILENT = !!opts.silent;
  return { out: OUT, origin: ORIGIN, originState };
}
const say = (...a) => { if (!SILENT) console.log(...a); };

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const web = (rec) => '/' + rec.file.replace(/^site\//, '');

const works = [...catalogue.works].sort((a, b) => a.order - b.order);
const states = catalogue.availabilityStates.members;
const titleOf = (w) => (w.title == null ? 'Untitled' : w.title);
const isUntitled = (w) => w.titleStatus === 'untitled';
const hrefOf = (w) => '/work/' + w.artworkId + '/';
const archiveNo = (w) => String(w.order).padStart(2, '0');
const stateOf = (w) => states[w.availability];
const kindOf = (w) => (catalogue.kinds[w.kind || 'painting'] || catalogue.kinds.painting).label;
const kindShort = (w) => (w.kind && w.kind !== 'painting' ? kindOf(w) + ' ' : '');
const img = (w) => images.images[w.artworkId];
const qrOf = (entityType, entityId) =>
  qr.identities.find((i) => i.entityType === entityType && i.entityId === entityId) || null;

/* ── refuse to build a lie ───────────────────────────────────────────────────
   These are preconditions, not style checks. If one fires, the data is
   inconsistent and emitting pages would publish the inconsistency. */
function validate() {
  const problems = validateIdentities(qr.identities, {
    artistId: artist.artistId,
    workIds: works.map((w) => w.artworkId),
  });
  const ids = new Set();
  for (const w of works) {
    if (ids.has(w.artworkId)) problems.push('duplicate artworkId: ' + w.artworkId);
    ids.add(w.artworkId);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(w.artworkId)) problems.push('artworkId is not url-safe: ' + w.artworkId);
    if (!images.images[w.artworkId]) problems.push('no derived image for ' + w.artworkId);
    if (!(w.availability in states)) problems.push('unknown availability "' + w.availability + '" on ' + w.artworkId);
    if (w.titleStatus === 'titled' && w.title == null) problems.push('titleStatus=titled but title is null: ' + w.artworkId);
    if (w.titleStatus === 'untitled' && w.title != null) problems.push('titleStatus=untitled but title is set: ' + w.artworkId);
  }
  if (qr.identities.length !== works.length + 1) {
    problems.push('identity count ' + qr.identities.length + ' != works + 1 (' + (works.length + 1) + ')');
  }
  if (site.analytics && site.analytics.enabled) problems.push('analytics is enabled, which the the brief has not authorised');
  if (problems.length) {
    console.error('BUILD REFUSED — the data cannot be published as it stands:');
    for (const p of problems) console.error('  · ' + p);
    process.exit(1);
  }
}

/* ── fragments ───────────────────────────────────────────────────────────── */
function imgTag(w, opts) {
  const im = img(w);
  const thumb = web(im.thumb);
  const card = web(im.card);
  const full = web(im.full);
  const set = im.full.file === im.card.file
    ? thumb + ' 560w, ' + card + ' ' + im.card.w + 'w'
    : thumb + ' 560w, ' + card + ' ' + im.card.w + 'w, ' + full + ' ' + im.full.w + 'w';
  const alt = isUntitled(w)
    ? 'Untitled painting from the Juan Pabrua archive — no title is recorded'
    : w.title + ', a painting by Juan Pabrua';
  return (
    '<img src="' + card + '"' +
    ' srcset="' + set + '"' +
    ' sizes="' + opts.sizes + '"' +
    ' width="' + im.card.w + '" height="' + im.card.h + '"' +
    ' alt="' + esc(alt) + '"' +
    ' loading="' + (opts.eager ? 'eager' : 'lazy') + '"' +
    ' decoding="async"' +
    (opts.eager ? ' fetchpriority="high"' : '') +
    '>'
  );
}

const NOT_RECORDED = '<span class="absent">Not recorded</span>';

/**
 * A plate in the discovery sequence. The rhythm is deterministic: every sixth
 * work opens a run, runs edge to edge; the rest sit in pairs, with one offset
 * plate breaking the pairs in the middle of each run. No uniform thumbnail grid.
 */
function plate(w, index, opts = {}) {
  const m = index % 6;
  const variant = m === 0 ? ' plate--bleed' : m === 3 ? ' plate--offset' : ' plate--pair';
  const sizes = m === 0
    ? '100vw'
    : '(min-width: 900px) 46vw, 92vw';
  return (
    '<figure class="plate' + variant + '" data-reveal>' +
      '<a href="' + hrefOf(w) + '" data-cursor>' +
        '<div class="plate__frame">' +
          imgTag(w, { sizes, eager: !!opts.eager }) +
          '<span class="plate__view" aria-hidden="true">View work</span>' +
        '</div>' +
        '<figcaption>' +
          '<span class="plate__title' + (isUntitled(w) ? ' plate__title--untitled' : '') + '">' + esc(titleOf(w)) + '</span>' +
          '<span class="plate__fact">' + kindShort(w) + archiveNo(w) + '</span>' +
        '</figcaption>' +
      '</a>' +
    '</figure>'
  );
}

function page(opts) {
  const p = opts.path;
  const url = ORIGIN + p;
  const ogImage = ORIGIN + opts.og;
  const canonical = originState === 'canonical' ? '<link rel="canonical" href="' + esc(url) + '">' : '';
  const ld = opts.jsonLd
    ? '<script type="application/ld+json">' +
      JSON.stringify(opts.jsonLd).replace(/</g, '\\u003c') +
      '</script>'
    : '';
  return (
    '<!doctype html>\n' +
    '<html lang="' + site.defaultLocale + '">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + esc(opts.title) + '</title>\n' +
    '<meta name="description" content="' + esc(opts.description) + '">\n' +
    '<meta name="aoj:origin-state" content="' + originState + '">\n' +
    '<meta name="aoj:build-schema" content="aoj.build/v1">\n' +
    '<meta property="og:type" content="' + (opts.ogType || 'website') + '">\n' +
    '<meta property="og:site_name" content="Art of Juan">\n' +
    '<meta property="og:title" content="' + esc(opts.title) + '">\n' +
    '<meta property="og:description" content="' + esc(opts.description) + '">\n' +
    '<meta property="og:url" content="' + esc(url) + '">\n' +
    '<meta property="og:image" content="' + esc(ogImage) + '">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    canonical + '\n' +
    '<link rel="stylesheet" href="/assets/site.css">\n' +
    '<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">\n' +
    '<script>document.documentElement.classList.add("js")</script>\n' +
    ld + '\n' +
    '</head>\n' +
    '<body>\n' +
    '<a class="skip" href="#main">Skip to content</a>\n' +
    (opts.plain ? '' : masthead(opts.current)) +
    (opts.opening || '') +
    '<main id="main">\n' + opts.body + '\n</main>\n' +
    (opts.plain ? '' : colophon()) +
    '<script type="module" src="/assets/site.js"></script>\n' +
    '</body>\n</html>\n'
  );
}

/**
 * The header is first in the DOM (so the banner landmark is correct for a
 * screen reader) and second on screen: `.opening` carries `order: -1`. That is
 * how the painting gets there before the menu without hiding the menu from
 * anybody.
 */
function masthead(current) {
  const link = (href, key, label) =>
    '<a href="' + href + '"' + (current === key ? ' aria-current="page"' : '') + '>' + label + '</a>';
  return (
    '<header class="masthead">' +
      '<div class="frame masthead__inner">' +
        '<a class="brandmark" href="/" aria-label="Art of Juan — home">' +
          '<span class="brandmark__name">Art of Juan</span>' +
          '<span class="brandmark__tag">Juan Pabrua</span>' +
        '</a>' +
        '<nav class="nav" aria-label="Primary">' +
          link('/work/', 'works', 'Works') +
          link('/about/', 'about', 'Artist') +
          link('/contact/', 'contact', 'Contact') +
        '</nav>' +
      '</div>' +
    '</header>'
  );
}

function colophon() {
  const instagram = artist.links.find((l) => l.id === 'instagram');
  return (
    '<footer class="colophon">' +
      '<div class="frame colophon__grid">' +
        '<div>' +
          '<p class="colophon__mark">Art of Juan</p>' +
          '<p>' + esc(artist.displayName) + ' — ' + esc(artist.role) + '</p>' +
        '</div>' +
        '<div>' +
          '<p>' + esc(artist.motto) + '</p>' +
        '</div>' +
        '<div>' +
          '<p><a href="' + esc(instagram.href) + '" rel="me noopener">Instagram ' + esc(instagram.handle) + '</a></p>' +
          '<p class="colophon__fine">No tracking, no cookies, no third-party requests.</p>' +
        '</div>' +
      '</div>' +
    '</footer>'
  );
}

/**
 * One sentence, built from what the catalogue owns and nothing else. When every
 * field is empty the sentence says exactly which facts are missing — which is a
 * true statement about the record, not an apology and not a placeholder.
 */
function captionOf(w) {
  const missing = [];
  if (w.titleStatus === 'untitled') missing.push('title');
  if (w.year == null) missing.push('date');
  if (w.medium == null) missing.push('medium');
  if (w.dimensions == null) missing.push('size');
  const known = [];
  if (w.medium) known.push(w.medium);
  if (w.dimensions) known.push(w.dimensions);
  if (w.year) known.push(String(w.year));
  const parts = [];
  if (missing.length === 0) {
    parts.push(known.join(' · ') + '.');
  } else {
    const list = missing.length === 1
      ? missing[0]
      : missing.slice(0, -1).join(', ') + ' or ' + missing[missing.length - 1];
    parts.push('No ' + list + ' is recorded for this work.');
  }
  parts.push(w.availability === 'unknown'
    ? 'Availability is not recorded.'
    : stateOf(w).label + '.');
  return parts.join(' ');
}

function openingWork() {
  return works[0];
}

function opening() {
  const w = openingWork();
  return (
    '<section class="opening" aria-label="Opening">' +
      '<figure class="opening__plate">' +
        imgTag(w, { sizes: '100vw', eager: true }) +
      '</figure>' +
      '<div class="opening__caption">' +
        '<h1 class="opening__mark">Art of Juan</h1>' +
        '<span class="opening__title">' + esc(titleOf(w)) + '</span>' +
        '<a class="opening__scroll" href="#main">Scroll</a>' +
      '</div>' +
    '</section>'
  );
}

/* ── shared blocks ───────────────────────────────────────────────────────── */
const heroWork = works[0];
const instagram = artist.links.find((l) => l.id === 'instagram');

/** The motto with its last clause italic — the sentence turns on "So I paint it". */
function mottoHtml() {
  const parts = (artist.motto.match(/[^.]+\./g) || [artist.motto]).map((s) => s.trim());
  return parts
    .map((s, i) => (i === parts.length - 1 ? '<em>' + esc(s) + '</em>' : esc(s)))
    .join(' ');
}

const homeBody = () => `
<section class="voice" id="curiosity" aria-labelledby="voice-title">
  <div class="frame">
    <p class="eyebrow" id="voice-title">The reason</p>
    <p class="voice__text" data-reveal>${mottoHtml()}</p>
    <p class="voice__note">Not a statement about painting. A description of how one gets made: something is noticed, it lands, and the paper follows.</p>
  </div>
</section>

<section class="story" id="connection" aria-labelledby="story-title">
  <div class="frame story__grid">
    <div>
      <p class="eyebrow">The artist</p>
      <h2 class="story__title" id="story-title">${esc(artist.displayName)}</h2>
      <p class="story__role">Watercolour · Drawing · Graphic design</p>
      <div class="story__body prose">
        ${artist.story.map((p) => '<p>' + esc(p) + '</p>').join('\n        ')}
      </div>
    </div>
    <figure class="story__plate" data-reveal>
      ${imgTag(works[1], { sizes: '(min-width: 900px) 44vw, 92vw' })}
      <figcaption>${esc(titleOf(works[1]))} — ${esc(captionOf(works[1]))}</figcaption>
    </figure>
  </div>
</section>

<section class="gallery" id="discovery" aria-labelledby="gallery-title">
  <div class="frame">
    <div class="gallery__head">
      <div>
        <p class="eyebrow">The work</p>
        <h2 class="gallery__title" id="gallery-title">Paintings</h2>
      </div>
      <p class="gallery__note">${works.length} works on record. Each has its own page and a permanent address, and each is given the whole screen when you open it.</p>
    </div>
    <div class="plates">
      ${works.slice(0, 6).map((w, i) => plate(w, i)).join('\n      ')}
    </div>
    <p class="more"><a class="btn btn--ghost" href="/work/">All ${works.length} works</a></p>
  </div>
</section>

<section class="closing" id="relationship" aria-labelledby="closing-title">
  <div class="frame">
    <h2 class="closing__title" id="closing-title">If a painting stays with you</h2>
    <p class="closing__body">Write about it. Enquiries go to the artist directly — no form, no account, no mailing list. If you would rather keep a record of the contact, save the card.</p>
    <div class="closing__actions">
      <a class="btn btn--solid" href="${esc(instagram.href)}" rel="me noopener">Message on Instagram</a>
      <a class="btn btn--ghost" href="/contact/juan-pabrua.vcf">Save contact card</a>
    </div>
  </div>
</section>`;

function homeLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VisualArtist',
        '@id': ORIGIN + '/#artist',
        name: artist.displayName,
        alternateName: artist.brand,
        url: ORIGIN + '/',
        jobTitle: artist.role,
        sameAs: artist.links.map((l) => l.href),
      },
      {
        '@type': 'WebSite',
        '@id': ORIGIN + '/#website',
        name: site.name,
        url: ORIGIN + '/',
        about: { '@id': ORIGIN + '/#artist' },
        inLanguage: site.defaultLocale,
      },
    ],
  };
}

/* ── the body of work ────────────────────────────────────────────────────── */
const archiveBody = () => `
<section class="gallery" style="padding-top:clamp(2.5rem,6vw,4rem)">
  <div class="frame">
    <div class="gallery__head">
      <div>
        <p class="eyebrow">${works.length} works · one archive</p>
        <h1 class="gallery__title">Works</h1>
      </div>
      <p class="gallery__note">Paintings, sketches and studies, each labelled as what it is. The titles are the ones the artist gave the files. Where a date, medium or size is not recorded, the page says so rather than guessing.</p>
    </div>
    <div class="plates">
      ${works.map((w, i) => plate(w, i)).join('\n      ')}
    </div>
    <div class="index-list">
      ${works.map((w) => {
        const untitled = isUntitled(w);
        return '<a class="index-row" href="' + hrefOf(w) + '">' +
          '<span class="index-row__no">' + archiveNo(w) + '</span>' +
          '<span class="index-row__title' + (untitled ? ' plate__title--untitled' : '') + '">' + esc(titleOf(w)) + '</span>' +
          '<span class="index-row__state">' + esc(stateOf(w).label) + '</span>' +
          '</a>';
      }).join('\n      ')}
    </div>
  </div>
</section>`;

/* ── a work: the wall label, not a product page ──────────────────────────── */
function workLd(w) {
  const im = img(w);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'VisualArtwork',
    '@id': ORIGIN + hrefOf(w) + '#artwork',
    name: titleOf(w),
    url: ORIGIN + hrefOf(w),
    image: {
      '@type': 'ImageObject',
      contentUrl: ORIGIN + web(im.full),
      width: im.full.w,
      height: im.full.h,
    },
    creator: {
      '@type': 'VisualArtist',
      '@id': ORIGIN + '/#artist',
      name: artist.displayName,
      url: ORIGIN + '/',
    },
    isPartOf: { '@type': 'Collection', name: catalogue.series[0].name },
  };
  /* Only record what the catalogue holds. No empty strings, no nulls, no
     placeholder text — a consumer must be able to tell absence from a value. */
  if (w.medium) ld.artMedium = w.medium;
  if (w.year) ld.dateCreated = String(w.year);
  if (w.dimensions) ld.size = w.dimensions;
  if (w.story) ld.description = w.story;
  /* No `offers`, no `price`, no `availability` here at all. A machine reading
     this page must not learn something the catalogue does not hold. */
  return ld;
}

function workBody(w) {
  const idx = works.indexOf(w);
  const prev = works[idx - 1] || null;
  const next = works[idx + 1] || null;
  const ident = qrOf('artwork', w.artworkId);
  const untitled = isUntitled(w);
  const pager = (target, dir) => target
    ? '<a href="' + hrefOf(target) + '"><span class="pager__dir">' + dir + '</span><span class="pager__title">' + esc(titleOf(target)) + '</span></a>'
    : '<span></span>';
  return `
<article class="work">
  <div class="frame">
    <figure class="work__figure" data-reveal>
      ${imgTag(w, { sizes: '(min-width: 1100px) 1100px, 92vw', eager: true })}
    </figure>
    <div class="work__text">
      <div class="work__label">
        <p class="eyebrow">${kindOf(w)} ${archiveNo(w)}</p>
        <h1 class="work__title${untitled ? ' work__title--untitled' : ''}">${esc(titleOf(w))}</h1>
        <p class="work__caption">${esc(captionOf(w))}</p>

        <div class="work__account">
          <h2>The account</h2>
          ${w.story
            ? '<p>' + esc(w.story) + '</p>'
            : '<p class="absent">No account of this work is recorded yet.</p>'}
        </div>

        <p class="work__enquire"><a href="${esc(instagram.href)}" rel="me noopener">Enquire about this painting</a></p>

        <p class="record">
          <span>Permanent record</span>
          <a href="${esc(ident.publicPath)}">${esc(ident.publicPath)}</a>
        </p>
      </div>
    </div>

    <nav class="pager" aria-label="Paintings">
      ${pager(prev, '← Previous')}
      ${pager(next, 'Next →')}
    </nav>
  </div>
</article>`;
}

/* ── the artist ──────────────────────────────────────────────────────────── */
const aboutBody = () => `
<section class="artist">
  <div class="frame">
    <div class="artist__head">
      <p class="eyebrow">The artist</p>
      <h1 class="artist__title">${esc(artist.displayName)}</h1>
      <p class="artist__role">Watercolour · Drawing · Graphic design</p>
    </div>

    <div class="artist__body prose">
      ${artist.story.map((p) => '<p>' + esc(p) + '</p>').join('\n      ')}
    </div>

    <p class="artist__quote" data-reveal>“${esc(artist.motto)}”</p>

    <div class="artist__record prose">
      <h2>The record</h2>
      <p>${works.length} paintings are on this site. Four carry the title their file carried; the rest are <em>Untitled</em>. No date, medium, size or account is recorded for any of them yet — the page shows that gap instead of filling it, because a guessed year is not a memory.</p>
      ${artist.inPreparation && artist.inPreparation.length
        ? artist.inPreparation.map((x) => '<p>A ' + esc(x.what.toLowerCase()) + ' is ' + esc(x.status) + '.</p>').join('\n      ')
        : ''}
    </div>
  </div>
</section>`;

/* ── contact ─────────────────────────────────────────────────────────────── */
const contactBody = () => `
<section class="contact">
  <div class="frame contact__grid">
    <div>
      <p class="eyebrow">Enquiries · commissions</p>
      <h1 class="contact__title">Contact</h1>
      <p class="contact__body">Write to the artist directly. If a particular painting brought you here, name it or give its number — every work has a page and an address.</p>
    </div>
    <div>
      <ul class="contact-list">
        ${artist.contactMethods.map((m) => m.kind === 'download'
          ? '<li><a href="' + esc(m.href) + '" download><span class="contact-label">' + esc(m.label) + '</span><span class="contact-value">' + esc(m.value) + '</span></a></li>'
          : '<li><a href="' + esc(m.href) + '" rel="me noopener"><span class="contact-label">' + esc(m.label) + '</span><span class="contact-value">' + esc(m.value) + '</span></a></li>').join('\n        ')}
      </ul>
      <p class="contact__note">Instagram and the contact card are the public channels. A phone number and an email address are not published, because neither has been approved for publication.</p>
    </div>
  </div>
</section>`;

function contactLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: 'Contact — Art of Juan',
    url: ORIGIN + '/contact/',
    mainEntity: {
      '@type': 'VisualArtist',
      '@id': ORIGIN + '/#artist',
      name: artist.displayName,
      sameAs: artist.links.map((l) => l.href),
    },
  };
}

/* ── the printable label sheet — an artist tool, not a public page ───────── */
function sheetDocument() {
  const rows = qr.identities.map((i) => {
    const w = i.entityType === 'artwork' ? works.find((x) => x.artworkId === i.entityId) : null;
    const label = w ? titleOf(w) : artist.displayName;
    const kind = i.entityType === 'artwork' ? 'work' : 'artist';
    return '<tr><td><code>' + esc(i.publicPath) + '</code></td><td>' + esc(label) + '</td><td>' + kind + '</td><td><code>' + esc(i.destination) + '</code></td></tr>';
  }).join('\n        ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Art of Juan — printed destinations</title>
<style>
body{font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#14120e;background:#f7f3ec;margin:2rem;max-width:70rem}
h1{font-family:"Iowan Old Style",Palatino,Georgia,serif;font-size:1.6rem;margin:0 0 .3rem}
p.note{color:#6b6457;margin:0 0 1.5rem;max-width:60ch}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid #ddd3c1}
th{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#6b6457}
code{font-family:ui-monospace,Consolas,monospace;font-size:.85rem}
</style></head>
<body>
<h1>Printed destinations</h1>
<p class="note">What each QR encodes (left) and where it resolves today (right). Only the left column is permanent. An artist tool: this file is not part of the published site.</p>
<table>
  <thead><tr><th>Encodes</th><th>Work</th><th>Kind</th><th>Resolves to</th></tr></thead>
  <tbody>
        ${rows}
  </tbody>
</table>
</body></html>
`;
}

/* ── Cloudflare Workers static assets ────────────────────────────────────────
   Two control files live in the asset directory and are parsed by the platform,
   not served to a visitor. They are GENERATED from the identity table so they
   cannot drift from it: a printed path that resolves locally resolves on the
   edge with the same status code. */
function redirectsFile() {
  const lines = [
    '# Generated by tools/build.mjs from data/qr-identities.json — do not edit.',
    '# Format: [source] [destination] [code]. 302 matches the local preview server.',
    '',
  ];
  for (const i of qr.identities) {
    if (i.status !== 'active') continue;
    if (!isSafeDestination(i.destination)) continue;
    lines.push(i.publicPath + ' ' + i.destination + ' 302');
    lines.push(i.publicPath + '/ ' + i.destination + ' 302');
  }
  return lines.join('\n') + '\n';
}

function headersFile() {
  return [
    '# Generated by tools/build.mjs — do not edit.',
    '',
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Frame-Options: DENY',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=604800',
    '',
  ].join('\n');
}

/* ── vCard 4.0 ───────────────────────────────────────────────────────────── */
function vcard() {
  const escv = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCARD',
    'VERSION:4.0',
    'KIND:individual',
    'FN:' + escv(artist.displayName),
    'N:' + escv('Pabrua') + ';' + escv('Juan') + ';;;',
    'ORG:' + escv(artist.brand),
    'TITLE:' + escv(artist.role),
    'URL:' + (ORIGIN + '/'),
    'X-SOCIALPROFILE;TYPE=instagram:' + escv(artist.links.find((l) => l.id === 'instagram').href),
    'NOTE:' + escv('Art of Juan — ' + works.length + ' works on record. Enquiries by Instagram.'),
    'END:VCARD',
    '',
  ];
  return lines.join('\r\n');
}

/* ── files ───────────────────────────────────────────────────────────────── */
function files() {
  const out = new Map();
  const add = (p, body) => out.set(p, body);

  /* `extraHead` support: page() places it nowhere yet, so splice it in. */
  const pageWithHead = (opts) => {
    const html = page(opts);
    return opts.extraHead ? html.replace('</head>', opts.extraHead + '\n</head>') : html;
  };

  add('index.html', page({
    path: '/',
    current: null,
    opening: opening(),
    title: 'Art of Juan — Juan Pabrua',
    description: 'Juan Pabrua paints in watercolour. The paintings, the reason behind them, and a permanent address for each. Enquiries go to the artist.',
    og: web(img(heroWork).card),
    jsonLd: homeLd(),
    body: homeBody(),
  }));

  add('work/index.html', page({
    path: '/work/',
    current: 'works',
    title: 'The archive — Art of Juan',
    description: works.length + ' works by Juan Pabrua. Titles, media and dates only where the catalogue records them.',
    og: web(img(works[2] || heroWork).card),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'The archive — Art of Juan',
      url: ORIGIN + '/work/',
      hasPart: works.map((w) => ({ '@type': 'VisualArtwork', name: titleOf(w), url: ORIGIN + hrefOf(w) })),
    },
    body: archiveBody(),
  }));

  for (const w of works) {
    add('work/' + w.artworkId + '/index.html', page({
      path: hrefOf(w),
      current: 'works',
      ogType: 'article',
      title: titleOf(w) + ' — Art of Juan',
      description: isUntitled(w)
        ? 'Untitled work from the archive of Juan Pabrua. Year, medium and dimensions are not recorded.'
        : w.title + ', a painting by Juan Pabrua. Year, medium and dimensions are not recorded.',
      og: web(img(w).card),
      jsonLd: workLd(w),
      body: workBody(w),
    }));
  }

  add('about/index.html', page({
    path: '/about/',
    current: 'about',
    title: 'Juan Pabrua — Art of Juan',
    description: 'Juan Pabrua: drawing, graphic design and experimental watercolour. The reason the paintings exist, in his own words.',
    og: web(img(works[1] || heroWork).card),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      name: 'Juan Pabrua — Art of Juan',
      url: ORIGIN + '/about/',
      mainEntity: { '@type': 'VisualArtist', '@id': ORIGIN + '/#artist' },
    },
    body: aboutBody(),
  }));

  add('contact/index.html', page({
    path: '/contact/',
    current: 'contact',
    title: 'Contact — Art of Juan',
    description: 'Enquiries, commissions and acquisitions. Instagram and a downloadable contact card; no phone number is published.',
    og: web(img(works[3] || heroWork).card),
    jsonLd: contactLd(),
    body: contactBody(),
  }));

  add('contact/juan-pabrua.vcf', vcard());
  add('_redirects', redirectsFile());
  add('_headers', headersFile());
  for (const ident of qr.identities) {
    const w = ident.entityType === 'artwork' ? works.find((x) => x.artworkId === ident.entityId) : null;
    const label = w ? titleOf(w) : artist.displayName;
    const dir = ident.publicPath.replace(/^\//, '');
    out.set(dir + '/index.html', pageWithHead(redirectArgs(ident, label)));
  }

  add('404.html', page({
    path: '/404.html',
    title: 'Not found — Art of Juan',
    description: 'That page is not here.',
    og: web(img(heroWork).card),
    plain: true,
    body:
      '<section class="arrival"><div class="arrival__inner">' +
        '<p class="eyebrow">404</p>' +
        '<h1>This page is not here</h1>' +
        '<p>The paintings are.</p>' +
        '<p style="margin-top:1.5rem"><a class="btn btn--solid" href="/work/">See the work</a></p>' +
      '</div></section>',
  }));

  add('robots.txt', [
    '# Canonical origin: ' + (site.canonicalOrigin || 'UNASSIGNED (this build is a preview)'),
    '# No sitemap is published against a guessed host. Assign canonicalOrigin in data/site.json',
    '# and rebuild: robots.txt, canonical links and sitemap.xml all follow it.',
    'User-agent: *',
    'Allow: /',
    '',
  ].join('\n'));

  if (originState === 'canonical') {
    const urls = ['/', '/work/', '/about/', '/contact/']
      .concat(works.map(hrefOf));
    add('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) => '  <url><loc>' + esc(ORIGIN + u) + '</loc></url>').join('\n') +
      '\n</urlset>\n');
    add('robots.txt', 'User-agent: *\nAllow: /\nSitemap: ' + ORIGIN + '/sitemap.xml\n');
  }

  return out;
}

function redirectArgs(ident, label) {
  const w = ident.entityType === 'artwork' ? works.find((x) => x.artworkId === ident.entityId) : null;
  return {
    path: ident.publicPath + '/',
    title: label + ' — Art of Juan',
    description: 'Permanent address ' + ident.publicPath + ' for ' + label + '.',
    og: web(img(w || heroWork).card),
    plain: true,
    body:
      '<section class="arrival"><div class="arrival__inner">' +
        '<p class="eyebrow">' + (w ? 'A painting' : 'Art of Juan') + '</p>' +
        '<h1>' + esc(label) + '</h1>' +
        '<p><a class="btn btn--solid" href="' + esc(ident.destination) + '">Continue</a></p>' +
      '</div></section>',
    extraHead: '<meta http-equiv="refresh" content="0; url=' + esc(ident.destination) + '">',
  };
}

/* ── write ───────────────────────────────────────────────────────────────── */
function writeAll() {
  validate();
  fs.mkdirSync(OUT, { recursive: true });

  const emitted = files();
  let changed = 0;

  for (const name of ['site.css', 'site.js', 'motion.mjs', 'favicon.svg']) {
    const src = path.join(APP, 'web', name);
    if (fs.existsSync(src)) emitted.set('assets/' + name, fs.readFileSync(src, 'utf8'));
  }

  for (const [rel, body] of [...emitted.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dest = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const prev = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
    if (prev !== body) {
      fs.writeFileSync(dest, body, 'utf8');
      changed += 1;
    }
  }

  /* Delete generated pages that this build no longer produces. Confined to
     markup/text under OUT; never touches assets/. */
  const produced = new Set([...emitted.keys()]);
  const stale = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(OUT, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (rel === 'assets') continue;
        walk(full);
      } else if (/\.(html|xml|txt|vcf|json)$/.test(entry.name) && !produced.has(rel)) {
        stale.push(rel);
        fs.unlinkSync(full);
      }
    }
  };
  walk(OUT);

  const report = {
    schema: 'aoj.build/v1',
    originState,
    origin: ORIGIN,
    canonicalOrigin: site.canonicalOrigin,
    works: works.length,
    identities: qr.identities.length,
    pages: [...produced].filter((p) => p.endsWith('.html')).length,
    availabilityStatesUsed: [...new Set(works.map((w) => w.availability))].sort(),
    note: 'Pure function of data/: no timestamp, no run statistics, no paths outside the build. Two runs on the same data produce the same bytes.',
  };
  const reports = path.join(APP, 'reports');
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(path.join(reports, 'build-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');

  /* The printed-destination sheet is an ARTIST TOOL, not a public page. It is
     written beside the print report, outside the published site, because the
     the brief forbids exposing engineering surfaces to a visitor. */
  const sheet = sheetDocument();
  const sheetPath = path.join(reports, 'identity-sheet.html');
  if (!fs.existsSync(sheetPath) || fs.readFileSync(sheetPath, 'utf8') !== sheet) {
    fs.writeFileSync(sheetPath, sheet, 'utf8');
  }

  say('built ' + report.pages + ' pages, ' + qr.identities.length + ' identities, origin=' +
    originState + ' (' + ORIGIN + ')');
  say('  ' + changed + ' file(s) changed, ' + stale.length + ' stale removed → ' + path.relative(APP, OUT));
  return report;
}

/**
 * Build the site. Callable in-process so the acceptance suite can build the same
 * data twice (determinism) and build once with an assigned origin (canonical).
 * @param {{out?: string, origin?: string}} opts
 */
export function build(opts = {}) {
  setTarget(opts);
  return writeAll();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  build({ out: arg('out', 'site'), origin: arg('origin', null) });
  process.exit(0);
}
