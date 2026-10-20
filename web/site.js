/* =============================================================================
   ART OF JUAN — site.js (module)
   Enhancement only. Nothing here is required to read the site, reach a painting,
   or contact the artist; with this file blocked the page is complete, static and
   fully visible. The decisions are imported from motion.mjs so they can be tested
   without a browser — see tests/run.mjs (the checks).
   ========================================================================== */
import { motionPlan, cursorLabel } from './motion.mjs';

const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

const plan = motionPlan({
  reduced: reduce,
  finePointer: fine,
  hasObserver: 'IntersectionObserver' in window,
});

/* ── reveal, once per element, never load-bearing ────────────────────────── */
const targets = document.querySelectorAll('[data-reveal]');
if (!plan.reveal) {
  Array.prototype.forEach.call(targets, (el) => el.classList.add('is-in'));
} else {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  Array.prototype.forEach.call(targets, (el) => io.observe(el));
}

/* ── the cursor indicator: desktop, fine pointer, motion permitted ───────── */
if (plan.cursor) {
  const marker = document.createElement('div');
  marker.className = 'cursor-view';
  marker.setAttribute('aria-hidden', 'true');
  marker.textContent = 'View work';
  let shown = false;

  const move = (event) => {
    marker.style.left = event.clientX + 'px';
    marker.style.top = event.clientY + 'px';
    const label = cursorLabel(event.target);
    if (label && !shown) { shown = true; marker.classList.add('is-on'); }
    if (!label && shown) { shown = false; marker.classList.remove('is-on'); }
  };

  document.body.appendChild(marker);
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerdown', () => {
    shown = false;
    marker.classList.remove('is-on');
  }, { passive: true });
}

/* ── copy the permanent record path ──────────────────────────────────────── */
Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), (btn) => {
  btn.addEventListener('click', () => {
    const text = btn.getAttribute('data-copy');
    const label = btn.querySelector('[data-copy-label]') || btn;
    const done = (ok) => {
      const original = label.textContent;
      label.textContent = ok ? 'Copied' : 'Select the address';
      window.setTimeout(() => { label.textContent = original; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    } else {
      done(false);
    }
  });
});
