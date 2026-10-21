/**
 * Procedural canvas textures (no image assets): verdict rings, soft
 * glow, fog particles and fog sheets. Created once and shared.
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

/** Soft cloudy blob used for slow drifting fog sheets. */
export function fogSheetTexture() {
  return make('fogsheet', 256, (ctx, s) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 46; i++) {
      const x = s * (0.2 + 0.6 * rnd());
      const y = s * (0.3 + 0.4 * rnd());
      const r = s * (0.08 + 0.18 * rnd());
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
}
