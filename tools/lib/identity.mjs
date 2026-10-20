/**
 * tools/lib/identity.mjs
 *
 * The permanent-resolution rules, in one place. The generator, the preview
 * server and the deployment preflight all import this file, so "the printed
 * address is stable" is implemented once instead of asserted three times.
 *
 * The rule the layer exists for:
 *   A public path may be re-pointed at a route. It may NEVER be re-pointed at a
 *   different entity. /q/art/tide-down resolving to another painting is not a
 *   redirect, it is a false claim about which painting the collector is seeing.
 */
import crypto from 'node:crypto';

export const ENTITY_TYPES = ['artist', 'artwork', 'event'];
export const STATUSES = ['active', 'retired'];
export const PUBLIC_PATH = /^\/q(\/[a-z0-9][a-z0-9-]*)+$/;

/**
 * A destination must stay on this site. Anything that could leave the origin,
 * reach another host, or climb the path is refused — no exceptions and no
 * allow-list of hosts, because there is no legitimate reason for a printed
 * artwork label to send a collector somewhere else.
 */
export function isSafeDestination(dest, prefixes = ['/']) {
  if (typeof dest !== 'string') return false;
  if (dest.length === 0 || dest.length > 512) return false;
  if (!dest.startsWith('/')) return false;
  if (dest.startsWith('//')) return false;
  if (/[\s\\]/.test(dest)) return false;
  if (dest.includes('..')) return false;
  if (/%2f|%5c|%2e%2e/i.test(dest)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(dest)) return false;
  return prefixes.some((p) => {
    if (p === '/') return true;
    const base = p.endsWith('/') ? p : p + '/';
    return dest === p || dest.startsWith(base);
  });
}

/**
 * @param {Array} identities  records from data/qr-identities.json
 * @param {{artistId: string, workIds: string[]}} context
 * @returns {string[]} problems; empty means valid
 */
export function validateIdentities(identities, context) {
  const problems = [];
  if (!Array.isArray(identities)) return ['identities is not an array'];
  const seenPaths = new Map();
  const seenIds = new Map();
  const workIds = new Set(context.workIds);

  for (const [i, id] of identities.entries()) {
    const at = 'identities[' + i + ']' + (id && id.qrId ? ' (' + id.qrId + ')' : '');
    if (!id || typeof id !== 'object') { problems.push(at + ' is not an object'); continue; }
    if (!id.qrId || typeof id.qrId !== 'string') problems.push(at + ': qrId missing');
    else if (seenIds.has(id.qrId)) problems.push(at + ': duplicate qrId');
    else seenIds.set(id.qrId, true);

    if (typeof id.publicPath !== 'string' || !PUBLIC_PATH.test(id.publicPath)) {
      problems.push(at + ': publicPath is not a /q/… path: ' + String(id.publicPath));
    } else if (id.publicPath.endsWith('/')) {
      problems.push(at + ': publicPath must not end with a slash');
    } else if (seenPaths.has(id.publicPath)) {
      problems.push(at + ': publicPath already used by ' + seenPaths.get(id.publicPath));
    } else {
      seenPaths.set(id.publicPath, id.qrId || at);
    }

    if (!ENTITY_TYPES.includes(id.entityType)) problems.push(at + ': unknown entityType ' + String(id.entityType));
    if (!STATUSES.includes(id.status)) problems.push(at + ': unknown status ' + String(id.status));
    if (!Number.isInteger(id.revision) || id.revision < 1) problems.push(at + ': revision must be an integer >= 1');
    if (id.ownerId !== context.artistId) problems.push(at + ': ownerId is not the artist');

    if (!isSafeDestination(id.destination)) {
      problems.push(at + ': destination is not a safe same-origin path: ' + String(id.destination));
    }

    if (id.entityType === 'artwork') {
      if (!workIds.has(id.entityId)) problems.push(at + ': entityId is not in the catalogue: ' + String(id.entityId));
      if (id.publicPath !== '/q/art/' + id.entityId) problems.push(at + ': artwork path must be /q/art/<artworkId>');
      if (id.destination !== '/work/' + id.entityId + '/') problems.push(at + ': artwork destination must be /work/<artworkId>/');
    }
    if (id.entityType === 'artist' && id.entityId !== context.artistId) {
      problems.push(at + ': artist entityId is not the artist');
    }
    if (id.entityType === 'event' && id.publicPath.indexOf('/q/event/') !== 0) {
      problems.push(at + ': event path must start /q/event/');
    }
  }
  return problems;
}

/**
 * The pairing digest: public path -> entity. Destinations are deliberately NOT
 * part of it — routes are allowed to move. Entities are not.
 */
export function pairingLines(identities) {
  return [...identities]
    .map((i) => i.publicPath + '\t' + i.entityType + ':' + i.entityId)
    .sort();
}

export function pairingDigest(identities) {
  return crypto.createHash('sha256').update(pairingLines(identities).join('\n') + '\n', 'utf8').digest('hex');
}

/** What changed between a locked pairing set and the current one. */
export function pairingDiff(locked, current) {
  const before = new Map();
  for (const line of locked) {
    const [path, entity] = line.split('\t');
    before.set(path, entity);
  }
  const after = new Map();
  for (const line of pairingLines(current)) {
    const [path, entity] = line.split('\t');
    after.set(path, entity);
  }
  const changes = [];
  for (const [path, entity] of before) {
    if (!after.has(path)) changes.push('removed: ' + path + ' (' + entity + ')');
    else if (after.get(path) !== entity) changes.push('REASSIGNED: ' + path + ' was ' + entity + ', is now ' + after.get(path));
  }
  for (const [path, entity] of after) {
    if (!before.has(path)) changes.push('added: ' + path + ' (' + entity + ')');
  }
  return changes;
}
