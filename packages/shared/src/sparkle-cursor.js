// Plain JS on purpose: the retiring vanilla pages load this straight from the
// browser with no build step, while apps/web imports it through the exports map.
// Keep it dependency-free and DOM-only.

// Palette members that read against Soft Blush. Soft Blush itself is the page
// background, so it is deliberately absent; white is the twinkle highlight.
const PALETTE = ['#f48498', '#e78f8e', '#f2ccc3', '#acd8aa', '#ffffff'];

const STAR = 'polygon(50% 0%, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0% 50%, 39% 39%)';

const GRAVITY = 0.0002; // px per ms squared

const between = (min, max) => min + Math.random() * (max - min);

export function startSparkleCursor(options = {}) {
  if (typeof document === 'undefined') return () => {};

  const {
    colors = PALETTE,
    maxSparkles = 500,
    spawnDistance = 12,
    lifetime = 750,
    minSize = 5,
    maxSize = 12,
  } = options;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '2147483000',
  });

  const sparkles = [];
  for (let i = 0; i < maxSparkles; i += 1) {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      opacity: '0',
      clipPath: STAR,
      willChange: 'transform, opacity',
    });
    layer.appendChild(el);
    sparkles.push({ el, age: lifetime, x: 0, y: 0, vx: 0, vy: 0, size: 0, angle: 0, spin: 0 });
  }
  document.body.appendChild(layer);

  let next = 0;
  let lastX = null;
  let lastY = null;
  let travelled = 0;
  let frame = 0;
  let previous = 0;

  function spawn(x, y) {
    let sparkle = sparkles.find((candidate) => candidate.age >= lifetime);
    if (!sparkle) {
      sparkle = sparkles[next];
      next = (next + 1) % sparkles.length;
    }
    sparkle.age = 0;
    sparkle.x = x;
    sparkle.y = y;
    sparkle.vx = between(-0.03, 0.03);
    sparkle.vy = between(-0.04, 0.01);
    sparkle.size = between(minSize, maxSize);
    sparkle.angle = between(0, 360);
    sparkle.spin = between(-0.35, 0.35);
    sparkle.el.style.width = `${sparkle.size}px`;
    sparkle.el.style.height = `${sparkle.size}px`;
    sparkle.el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
  }

  function tick(now) {
    const delta = Math.min(now - previous, 64);
    previous = now;
    let alive = 0;

    for (const sparkle of sparkles) {
      if (sparkle.age >= lifetime) continue;
      sparkle.age += delta;
      if (sparkle.age >= lifetime) {
        sparkle.el.style.opacity = '0';
        continue;
      }
      alive += 1;

      sparkle.vy += GRAVITY * delta;
      sparkle.x += sparkle.vx * delta;
      sparkle.y += sparkle.vy * delta;
      sparkle.angle += sparkle.spin * delta;

      const t = sparkle.age / lifetime;
      const scale = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      sparkle.el.style.opacity = `${1 - t * t}`;
      sparkle.el.style.transform =
        `translate3d(${sparkle.x - sparkle.size / 2}px, ${sparkle.y - sparkle.size / 2}px, 0)` +
        ` rotate(${sparkle.angle}deg) scale(${scale})`;
    }

    frame = alive ? requestAnimationFrame(tick) : 0;
  }

  function onPointerMove(event) {
    if (event.pointerType === 'touch' || reduceMotion.matches) return;

    const { clientX: x, clientY: y } = event;
    if (lastX === null || lastY === null) {
      lastX = x;
      lastY = y;
      return;
    }

    travelled += Math.hypot(x - lastX, y - lastY);
    lastX = x;
    lastY = y;
    if (travelled < spawnDistance) return;
    travelled = 0;

    spawn(x, y);
    if (!frame) {
      previous = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true });

  return function stop() {
    window.removeEventListener('pointermove', onPointerMove);
    if (frame) cancelAnimationFrame(frame);
    layer.remove();
  };
}
