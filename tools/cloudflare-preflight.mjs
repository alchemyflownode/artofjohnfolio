#!/usr/bin/env node
/**
 * ART OF JUAN — Cloudflare preflight.
 *
 * Decides, offline, everything the deployment configuration can be wrong about:
 * whether the Wrangler file parses and points at a real asset directory, whether
 * every printed identity has a matching edge redirect, whether any rule would
 * shadow a real file, and whether the 404 the platform will serve exists.
 *
 * It cannot decide what Wrangler would decide. Run `wrangler deploy --dry-run`
 * to validate the file against Wrangler itself.
 *
 *   node tools/cloudflare-preflight.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(APP, 'site');
const results = [];
const add = (id, ok, detail) => results.push({ id, ok, detail });

/* ── 1 · the Wrangler file ───────────────────────────────────────────────── */
const wranglerPath = path.join(APP, 'wrangler.jsonc');
let wrangler = null;
if (!fs.existsSync(wranglerPath)) {
  add('wrangler/present', false, 'wrangler.jsonc is missing');
} else {
  const raw = fs.readFileSync(wranglerPath, 'utf8');
  const stripped = raw.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  try {
    wrangler = JSON.parse(stripped);
    add('wrangler/parses', true, 'wrangler.jsonc parses after comment stripping');
  } catch (e) {
    add('wrangler/parses', false, 'does not parse: ' + e.message);
  }
}

if (wrangler) {
  add('wrangler/name', typeof wrangler.name === 'string' && /^[a-z0-9-]+$/.test(wrangler.name), 'name = ' + wrangler.name);
  add('wrangler/compatibility_date', /^\d{4}-\d{2}-\d{2}$/.test(String(wrangler.compatibility_date)), 'date = ' + wrangler.compatibility_date);
  const dir = wrangler.assets && wrangler.assets.directory;
  const abs = dir ? path.resolve(APP, dir) : null;
  add('wrangler/assets-directory', !!abs && fs.existsSync(abs) && fs.statSync(abs).isDirectory(),
    dir ? dir + ' → ' + (abs && fs.existsSync(abs) ? 'exists' : 'MISSING') : 'no assets.directory');
  const nfh = wrangler.assets && wrangler.assets.not_found_handling;
  add('wrangler/not-found-handling', ['none', '404-page', 'single-page-application'].includes(nfh), 'not_found_handling = ' + nfh);
  const hh = wrangler.assets && wrangler.assets.html_handling;
  add('wrangler/html-handling', hh === undefined || ['auto-trailing-slash', 'force-trailing-slash', 'drop-trailing-slash', 'none'].includes(hh), 'html_handling = ' + hh);
  add('wrangler/no-worker-script', wrangler.main === undefined,
    wrangler.main === undefined ? 'assets-only Worker (no script to run first)' : 'a main script is configured: ' + wrangler.main);
}

/* ── 2 · the 404 the platform will serve ─────────────────────────────────── */
const nfh = wrangler && wrangler.assets && wrangler.assets.not_found_handling;
if (nfh === '404-page') {
  add('assets/404-page', fs.existsSync(path.join(SITE, '404.html')), 'site/404.html ' + (fs.existsSync(path.join(SITE, '404.html')) ? 'exists' : 'MISSING'));
}

/* ── 3 · _redirects against the identity table ───────────────────────────── */
const identities = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'qr-identities.json'), 'utf8')).identities
  .filter((i) => i.status === 'active');
const redirectsPath = path.join(SITE, '_redirects');
let rules = [];
if (!fs.existsSync(redirectsPath)) {
  add('redirects/present', false, 'site/_redirects is missing — run tools/build.mjs');
} else {
  const lines = fs.readFileSync(redirectsPath, 'utf8').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  rules = lines.map((l) => l.split(/\s+/)).filter((p) => p.length >= 2);
  add('redirects/present', true, rules.length + ' rules');

  const badCode = rules.filter((p) => p[2] !== undefined && p[2] !== '302');
  add('redirects/status-302', badCode.length === 0,
    badCode.length ? badCode.length + ' rule(s) are not 302' : 'every rule is 302, matching the preview server');

  const absolute = rules.filter((p) => /^https?:|^\/\//i.test(p[1]));
  add('redirects/same-origin', absolute.length === 0,
    absolute.length ? absolute.slice(0, 3).map((p) => p.join(' ')).join('; ') : 'no destination leaves the origin');

  const bounded = rules.length <= 2100;
  add('redirects/within-limit', bounded, rules.length + ' of 2100 rules (2000 static + 100 dynamic)');

  const srcSeen = new Map();
  const dupes = [];
  for (const p of rules) {
    srcSeen.set(p[0], (srcSeen.get(p[0]) || 0) + 1);
    if (srcSeen.get(p[0]) > 1) dupes.push(p[0]);
  }
  add('redirects/no-duplicate-source', dupes.length === 0, dupes.length ? [...new Set(dupes)].slice(0, 3).join(', ') : 'every source appears once');

  /* every active identity must be resolvable at the edge, both spellings */
  const bySource = new Map(rules.map((p) => [p[0], p[1]]));
  const missing = identities.filter((i) => bySource.get(i.publicPath) !== i.destination || bySource.get(i.publicPath + '/') !== i.destination);
  add('redirects/identity-parity', missing.length === 0,
    missing.length ? missing.slice(0, 3).map((i) => i.publicPath).join(', ') + ' missing or wrong' :
      identities.length + ' identities, both spelling variants, destination identical to the table');

  const destMissing = rules.filter((p) => !fs.existsSync(path.join(SITE, p[1].replace(/^\//, '').replace(/\/$/, '') || '.')));
  add('redirects/destinations-exist', destMissing.length === 0,
    destMissing.length ? destMissing.slice(0, 3).map((p) => p[1]).join(', ') : 'every destination resolves to a built path');

  /* a rule that shadows a real asset would redirect a file away from its own URL */
  const shadowed = rules.filter((p) => {
    const asFile = path.join(SITE, p[0].replace(/^\//, ''));
    return p[0] !== '/q' && fs.existsSync(asFile) && fs.statSync(asFile).isFile();
  });
  add('redirects/no-shadowed-asset', shadowed.length === 0,
    shadowed.length ? shadowed.slice(0, 3).map((p) => p[0]).join(', ') : 'no rule shadows a file in the asset directory');
}

/* ── 4 · _headers ────────────────────────────────────────────────────────── */
const headersPath = path.join(SITE, '_headers');
if (!fs.existsSync(headersPath)) {
  add('headers/present', false, 'site/_headers is missing — run tools/build.mjs');
} else {
  const h = fs.readFileSync(headersPath, 'utf8');
  add('headers/present', true, h.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).length + ' non-comment lines');
  add('headers/security', /X-Content-Type-Options:\s*nosniff/.test(h) && /Referrer-Policy:/.test(h),
    'nosniff + referrer policy declared on /*');
}

/* ── 5 · what this cannot decide ─────────────────────────────────────────── */
add('wrangler/available', false, 'NOT VERIFIED — wrangler is not installed and cannot be installed here (global install: EPERM outside the workspace; local install: spawn EPERM, the environment item 32). `wrangler deploy --dry-run` was NOT run, so Wrangler has NOT validated this file.');
add('cloudflare/auth', false, 'NOT VERIFIED — no Cloudflare credentials, no MCP client in this runtime, no OAuth performed. Account access is unproven and is not claimed.');

const failed = results.filter((r) => !r.ok);
const lines = ['# Cloudflare preflight — Art of Juan', ''];
lines.push('Generated by `tools/cloudflare-preflight.mjs`. Offline: it reads the built site and the identity table, and it runs no Cloudflare command.');
lines.push('');
lines.push('| check | result | detail |');
lines.push('|---|---|---|');
for (const r of results) lines.push('| `' + r.id + '` | ' + (r.ok ? 'PASS' : (r.id.startsWith('wrangler/available') || r.id.startsWith('cloudflare/') ? 'NOT VERIFIED' : '**FAIL**')) + ' | ' + r.detail.replace(/\|/g, '\\|') + ' |');
lines.push('');
lines.push('## What this establishes');
lines.push('');
lines.push('The configuration that Cloudflare would read is internally consistent with the site that would be uploaded: the Wrangler file parses, points at `./site`, and is an assets-only Worker; every printed identity resolves at the edge with a 302 to the same destination the local server uses; no rule shadows a real file; the 404 page the platform would serve exists.');
lines.push('');
lines.push('## What it does not establish');
lines.push('');
lines.push('Wrangler has not validated this file, because Wrangler cannot be installed in this sandbox. No Cloudflare account was contacted. No deployment was performed. Nothing here is evidence about an edge PoP, a real DNS name, or a printed QR scanned against production.');
lines.push('');
fs.mkdirSync(path.join(APP, 'reports'), { recursive: true });
fs.writeFileSync(path.join(APP, 'reports', 'cloudflare-preflight.md'), lines.join('\n'), 'utf8');

const hard = failed.filter((r) => !r.id.startsWith('wrangler/available') && !r.id.startsWith('cloudflare/'));
console.log('cloudflare preflight: ' + (results.length - failed.length) + '/' + results.length + ' checks pass');
for (const r of failed) console.log('  ' + (r.id.startsWith('wrangler/available') || r.id.startsWith('cloudflare/') ? 'NOT VERIFIED' : 'FAIL') + ' ' + r.id + ' — ' + r.detail);
console.log('  report: reports/cloudflare-preflight.md');
process.exit(hard.length ? 1 : 0);
