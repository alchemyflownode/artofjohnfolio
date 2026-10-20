#!/usr/bin/env node
/**
 * ART OF JUAN — local preview server.
 *
 * Dependency-free and loopback-only. Its one interesting job is the resolution
 * layer: a request for a printed identity (/q/...) gets a real HTTP 302 from
 * data/qr-identities.json, not a page that asks a script to redirect.
 *
 *   node tools/serve.mjs            # http://127.0.0.1:8080
 *   node tools/serve.mjs --port=9000
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(APP, 'site');

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(hit.indexOf('=') + 1) : fallback;
};

const siteCfg = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'site.json'), 'utf8'));
const PORT = Number(arg('port', process.env.PORT || siteCfg.previewPort || 8080));
const HOST = '127.0.0.1';

const identities = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'qr-identities.json'), 'utf8')).identities;
const redirects = new Map();
for (const id of identities) {
  if (id.status !== 'active') continue;
  redirects.set(id.publicPath, id.destination);
  redirects.set(id.publicPath + '/', id.destination);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.vcf': 'text/vcard; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
};

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body), ...extra });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const raw = req.url || '/';
  const url = raw.split('?')[0].split('#')[0];

  /* 1. the permanent layer, before anything touches the filesystem */
  if (redirects.has(url)) {
    const to = redirects.get(url);
    res.writeHead(302, { location: to, 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' });
    res.end('302 ' + url + ' -> ' + to + '\n');
    log(req, 302, to);
    return;
  }

  /* 2. static files */
  let rel = decodeURIComponent(url);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.endsWith('/')) rel += 'index.html';

  const abs = path.normalize(path.join(SITE, rel));
  if (!abs.startsWith(SITE + path.sep) && abs !== path.join(SITE, 'index.html')) {
    send(res, 403, 'text/plain; charset=utf-8', '403\n');
    log(req, 403);
    return;
  }

  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) {
      const notFound = path.join(SITE, '404.html');
      const body = fs.existsSync(notFound) ? fs.readFileSync(notFound) : '404\n';
      send(res, 404, 'text/html; charset=utf-8', body, { 'cache-control': 'no-store' });
      log(req, 404);
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const immutable = abs.startsWith(path.join(SITE, 'assets')) && ext !== '.html';
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': immutable ? 'public, max-age=3600' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    });
    log(req, 200);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(abs).pipe(res);
  });
});

let quiet = false;
function log(req, status, extra) {
  if (quiet) return;
  const mark = status === 302 ? '↳' : status >= 400 ? '!' : '·';
  console.log('  ' + mark + ' ' + status + ' ' + (req.method || 'GET') + ' ' + (req.url || '/') + (extra ? ' → ' + extra : ''));
}

server.on('error', (err) => {
  console.error('server error: ' + err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ART OF JUAN — local preview');
  console.log('  http://' + HOST + ':' + PORT + '/');
  console.log('  ' + identities.length + ' printed identities resolve here (HTTP 302)');
  console.log('  serving ' + SITE);
  console.log('  ctrl-c to stop');
  console.log('');
});
