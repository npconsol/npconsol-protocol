export const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

// Damped spring: x'' = -k (x - 1) - c x'. Fixed 1/120 s steps, semi-implicit Euler.
export function spring(step, { k = 170, c = 21, done } = {}) {
  let x = 0, v = 0, last = 0, acc = 0, raf = 0;
  const dt = 1 / 120;
  const frame = (t) => {
    if (!last) last = t;
    acc += Math.min((t - last) / 1000, 0.05); last = t;
    while (acc >= dt) { v += (-k * (x - 1) - c * v) * dt; x += v * dt; acc -= dt; }
    step(x);
    if (Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.0015) { step(1); if (done) done(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

export function initReveal() {
  const nodes = [...document.querySelectorAll('[data-reveal]')];
  if (reduced.matches || !('IntersectionObserver' in window)) { nodes.forEach((n) => n.classList.add('is-in')); return; }
  document.documentElement.classList.add('js-reveal');
  const run = (el, delay) => setTimeout(() => {
    el.classList.add('is-in');
    spring((x) => {
      el.style.opacity = Math.min(1, Math.max(0, x));
      el.style.transform = `translate3d(0,${(1 - x) * 28}px,0)`;
    }, { done: () => { el.style.opacity = ''; el.style.transform = ''; } });
  }, delay);
  const io = new IntersectionObserver((entries) => {
    const fresh = entries.filter((e) => e.isIntersecting);
    fresh.forEach((e, i) => { io.unobserve(e.target); run(e.target, i * 70); });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  nodes.forEach((n) => io.observe(n));
}

export function initProgress() {
  const bar = document.querySelector('[data-progress]');
  if (!bar) return;
  let queued = false;
  const paint = () => {
    queued = false;
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`;
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
  addEventListener('resize', paint);
  paint();
}

export function initParallax() {
  const root = document.querySelector('[data-parallax]');
  if (!root) return;
  const layers = [...root.querySelectorAll('[data-depth]')].map((el) => ({ el, d: parseFloat(el.dataset.depth) || 0 }));
  let px = 0, py = 0, tx = 0, ty = 0, raf = 0, sy = 0;
  const loop = () => {
    px += (tx - px) * 0.08; py += (ty - py) * 0.08;
    for (const { el, d } of layers) {
      el.style.transform = `translate3d(${px * d * 26}px,${py * d * 26 + sy * d * 0.12}px,0)`;
    }
    raf = (Math.abs(tx - px) > 0.001 || Math.abs(ty - py) > 0.001) ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => { if (!raf && !reduced.matches) raf = requestAnimationFrame(loop); };
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2; kick();
  }, { passive: true });
  addEventListener('scroll', () => {
    sy = Math.min(scrollY, innerHeight * 1.2);
    if (!reduced.matches) { for (const { el, d } of layers) el.style.transform = `translate3d(${px * d * 26}px,${py * d * 26 + sy * d * 0.12}px,0)`; }
  }, { passive: true });
}

export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('.spot');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', `${e.clientX - r.left}px`);
    t.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

const ease = (t) => 1 - Math.pow(1 - t, 3);

// Count a node's number toward `to`; flash when it moves after first paint.
export function countTo(el, to, fmt) {
  if (!Number.isFinite(to)) { el.textContent = '—'; el._v = undefined; return; }
  const first = el._v === undefined;
  const from = first ? 0 : el._v;
  el._v = to;
  if (el._raf) cancelAnimationFrame(el._raf);
  if (!first && from !== to) {
    el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth;
    if (!reduced.matches) el.classList.add(to > from ? 'flash-up' : 'flash-down');
  }
  if (reduced.matches || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = first ? 900 : 650;
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = fmt(from + (to - from) * ease(p));
    if (p < 1) el._raf = requestAnimationFrame(tick); else el.textContent = fmt(to);
  };
  el._raf = requestAnimationFrame(tick);
}
