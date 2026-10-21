/**
 * Procedural canvas textures (no image assets): verdict rings, soft
 * glow, fog particles, cloud puffs and the night sky. Created once and shared.
 */
import { CanvasTexture, SRGBColorSpace } from '@iwsdk/core';

const cache = new Map();

function make(key, size, draw) {
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** White ring in one of four styles; tinted per instance. */
export function ringTexture(style) {
  return make(`ring:${style}`, 256, (ctx, s) => {
    const c = s / 2;
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    const ring = (r, w, dash) => {
      ctx.lineWidth = w;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    if (style === 'solid') ring(s * 0.4, s * 0.06);
    else if (style === 'double') {
      ring(s * 0.42, s * 0.035);
      ring(s * 0.33, s * 0.035);
    } else if (style === 'dashed') ring(s * 0.4, s * 0.06, [s * 0.14, s * 0.09]);
    else ring(s * 0.4, s * 0.05, [1, s * 0.09]); // dotted
  });
}

export function glowTexture() {
  return make('glow', 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export function particleTexture() {
  return make('particle', 64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/**
 * A soft cloud puff for the fog banks: many overlapping soft blobs inside a
 * round falloff, so no edge or corner ever shows. Three variants.
 */
export function cloudTexture(variant = 0) {
  return make(`cloud:${variant}`, 256, (ctx, s) => {
    let seed = 13 + variant * 101;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const ang = rnd() * Math.PI * 2;
      const dist = Math.pow(rnd(), 0.7) * s * 0.28;
      const x = s / 2 + Math.cos(ang) * dist * 1.25;
      const y = s / 2 + Math.sin(ang) * dist * 0.8;
      const r = s * (0.07 + 0.16 * rnd());
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.05 + 0.09 * rnd();
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.6, `rgba(255,255,255,${a * 0.45})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
    // round falloff: the puff fades to nothing well before the texture edge
    ctx.globalCompositeOperation = 'destination-in';
    const m = ctx.createRadialGradient(s / 2, s / 2, s * 0.12, s / 2, s / 2, s / 2);
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = m;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'source-over';
  });
}

/**
 * The night sky (equirectangular, for the inside of a dome): near-black at the
 * top, deep blue toward the horizon, a faint band of haze, and many faint far
 * stars (decoration only; the news stars are the bright ones).
 */
export function skyTexture() {
  return make('sky', 2048, (ctx, s) => {
    const h = s / 2;
    ctx.canvas.height = h;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#020308');
    g.addColorStop(0.3, '#050a17');
    g.addColorStop(0.47, '#0c1a33');
    g.addColorStop(0.53, '#111d36');
    g.addColorStop(0.7, '#070d1c');
    g.addColorStop(1, '#030509');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, h);
    // a little noise so the dark gradient shows no bands
    const img = ctx.getImageData(0, 0, s, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const d = (Math.random() - 0.5) * 3;
      img.data[i] += d;
      img.data[i + 1] += d;
      img.data[i + 2] += d;
    }
    ctx.putImageData(img, 0, 0);
    let seed = 29;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // a faint haze band (like a distant galaxy), tilted
    for (let i = 0; i < 90; i++) {
      const x = rnd() * s;
      const y = h * 0.42 + Math.sin((x / s) * Math.PI * 2) * h * 0.08 + (rnd() - 0.5) * h * 0.1;
      const r = 40 + rnd() * 120;
      const b = ctx.createRadialGradient(x, y, 0, x, y, r);
      b.addColorStop(0, `rgba(${110 + rnd() * 40},${130 + rnd() * 30},${190 + rnd() * 40},0.05)`);
      b.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = b;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // far stars: mostly tiny and dim, a few brighter, fewer near the horizon
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * s;
      const y = Math.pow(rnd(), 1.15) * h * 0.92;
      const big = rnd() < 0.03;
      const a = big ? 0.5 + rnd() * 0.4 : 0.12 + rnd() * 0.35;
      ctx.fillStyle = `rgba(${215 + rnd() * 40},${220 + rnd() * 35},255,${a})`;
      ctx.fillRect(x, y, big ? 2 : 1, big ? 2 : 1);
    }
  });
}
