/**
 * web/motion.mjs — the interaction layer's decisions, as pure functions.
 *
 * The DOM wiring lives in site.js. Everything that can be decided without a
 * browser lives here, so it can be tested in Node: the interface has no
 * renderer, and a claim about behaviour that nothing can execute is not a claim.
 */

/**
 * @param {{reduced: boolean, finePointer: boolean, hasObserver: boolean}} env
 * @returns {{reveal: boolean, cursor: boolean, entrance: boolean}}
 */
export function motionPlan(env) {
  const reduced = !!(env && env.reduced);
  return {
    reveal: !reduced && !!(env && env.hasObserver),
    cursor: !reduced && !!(env && env.finePointer),
    entrance: !reduced,
  };
}

/** Stagger, capped. The cap is the point: a 29-work grid must not animate for 3s. */
export function staggerDelayMs(index, stepMs = 70, maxSteps = 4) {
  const i = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return Math.min(i, maxSteps) * stepMs;
}

/** The cursor indicator only speaks over a work, and only for a fine pointer. */
export function cursorLabel(target) {
  if (!target || typeof target.closest !== 'function') return null;
  return target.closest('[data-cursor]') ? 'View work' : null;
}
