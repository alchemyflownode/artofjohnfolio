#!/usr/bin/env node
/**
 * Lock the public-path -> entity pairing.
 *
 * Running this is a deliberate act. The lock is what makes "a painting's printed
 * code can never silently become a different painting" enforceable: the preflight
 * and the deployment checks compare the current pairing digest against the locked
 * one and name any path that was reassigned.
 *
 *   node tools/lock-identities.mjs           # show the current digest
 *   node tools/lock-identities.mjs --write   # refresh the lock (deliberate)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairingDigest, pairingLines, pairingDiff } from './lib/identity.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = path.join(APP, 'data', 'qr-identity-lock.json');
const identities = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'qr-identities.json'), 'utf8')).identities;
const digest = pairingDigest(identities);

if (process.argv.includes('--write')) {
  const prev = fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : null;
  const changes = prev ? pairingDiff(prev.pairs, identities) : ['(first lock)'];
  const doc = {
    schema: 'aoj.qr-lock/v1',
    $comment: 'The record of which public path belongs to which entity. Refreshed only by running tools/lock-identities.mjs --write, which is a human act. A reassignment shows up here before it shows up in the world.',
    algorithm: 'sha256 of sorted "publicPath\\tentityType:entityId" lines, trailing newline',
    epoch: prev ? prev.epoch + 1 : 1,
    digest,
    count: identities.length,
    pairs: pairingLines(identities),
    history: (prev && prev.history ? prev.history : []).concat([{ epoch: prev ? prev.epoch + 1 : 1, digest, changes }]),
  };
  fs.writeFileSync(LOCK, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log('locked ' + identities.length + ' pairings, epoch ' + doc.epoch);
  for (const c of changes) console.log('  ' + c);
} else {
  const prev = fs.existsSync(LOCK) ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : null;
  console.log('current digest: ' + digest);
  if (!prev) console.log('no lock file yet — run with --write once, deliberately');
  else console.log('locked digest:  ' + prev.digest + (prev.digest === digest ? '  (match)' : '  (DIFFERS)'));
  if (prev) for (const c of pairingDiff(prev.pairs, identities)) console.log('  ' + c);
}
