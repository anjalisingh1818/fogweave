/**
 * Help card (opened from the small "?" on the left wrist), the Library
 * card, and the legend: claim verdicts (colour + ring) and link labels.
 * Large type, short lines.
 */
import { VERDICT_STYLE, LABEL_STYLE } from '../model/schema.js';
import { UI } from '../render/card.js';

export function helpDraw(app) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text('HOW TO READ THE FOG', pad, 66, { size: 28, color: UI.dim, weight: 600 });
    let y = 116;
    for (const key of ['supported', 'mixed', 'contradicted', 'unverified']) {
      const v = VERDICT_STYLE[key];
      ui.ringIcon(pad + 18, y - 11, 16, v.css, v.ring);
      ui.text(v.label, pad + 50, y, { size: 29, color: v.css, weight: 600 });
      ui.text(`${v.ring} ring`, pad + 330, y, { size: 25, color: UI.dim });
      y += 42;
    }
    y += 4;
    for (const key of ['reported', 'inferred', 'speculative']) {
      const s = LABEL_STYLE[key];
      ctx.strokeStyle = s.css;
      ctx.lineWidth = 5;
      ctx.setLineDash(key === 'reported' ? [] : key === 'inferred' ? [18, 12] : [3, 12]);
      ctx.beginPath();
      ctx.moveTo(pad, y - 10);
      ctx.lineTo(pad + 36, y - 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ui.text(s.label, pad + 50, y, { size: 28, color: s.css, weight: 600 });
      ui.text(s.note, pad + 230, y, { size: 25, color: UI.dim, maxWidth: w - pad - 230 - pad });
      y += 40;
    }
    ui.text('Translucent = fog (this session). Solid = sealed.', pad, y + 6, { size: 26 });
    y += 52;
    const tips = [
      'Pinch a light: read it · Expand: grow it into the web',
      'Pinch a node: its links, quotes and reasoning',
      'Coin: evidence · Locket: relevance to you',
      '“Touches me?” on a news node: a grounded thread, or no',
      'Pinch empty space: find a light · Flick a card away',
    ];
    for (const t of tips) {
      ui.text(`· ${t}`, pad, y, { size: 25, color: '#d6dce4', maxWidth: w - pad * 2 });
      y += 34;
    }
    const n = app.store.sealedIds().length + Object.keys(app.sealedLights || {}).length;
    const bw = (w - pad * 2 - 60) / 4;
    const by = h - 112;
    ui.button('library', `Library ${n}`, pad, by, bw, 80, () => app.openLibrary(), { size: 27 });
    ui.button('context', 'My context', pad + bw + 20, by, bw, 80, () => app.openContext(), { size: 27, primary: true });
    ui.button('tour', 'Tour', pad + (bw + 20) * 2, by, bw, 80, () => app.startOnboarding(true), { size: 27 });
    ui.button('close', 'Close', pad + (bw + 20) * 3, by, bw, 80, () => app.closeCard('help'), { size: 27, icon: '✕' });
  };
}

export function libraryDraw(app) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    const sealed = [...app.store.nodes.values()].filter((n) => n.sealed);
    const lights = Object.values(app.sealedLights || {});
    ui.text('LIBRARY · WHAT YOU SEALED', pad, 70, { size: 30, color: UI.accent, weight: 600 });
    ui.text('Kept on this device. Export arrives with the Evidence Pack.', pad, 110, { size: 24, color: UI.dim, maxWidth: w - pad * 2 });
    let y = 164;
    for (const it of lights.slice(0, 4)) {
      ui.text('✦', pad + 4, y, { size: 28, color: '#ffe2a8' });
      ui.text(it.headline, pad + 40, y, { size: 27, maxWidth: w - pad * 2 - 40 });
      y += 38;
    }
    if (lights.length > 4) {
      ui.text(`+ ${lights.length - 4} more news items`, pad + 40, y, { size: 25, color: UI.dim });
      y += 38;
    }
    if (!sealed.length && !lights.length) {
      ui.para('Nothing sealed yet. Open a light or a node and press Seal to keep it.', pad, y, w - pad * 2, { size: 30, color: UI.dim });
    }
    const order = { Claim: 0, NewsItem: 1, Event: 2, Source: 9 };
    const rest = sealed.filter((n) => n.type !== 'NewsItem' || !app.sealedLights?.[n.id]).sort((a, b) => (order[a.type] ?? 5) - (order[b.type] ?? 5));
    const shown = Math.max(0, 6 - Math.min(4, lights.length));
    for (const n of rest.slice(0, shown)) {
      if (n.type === 'Claim') {
        const v = VERDICT_STYLE[n.verdict || 'unverified'];
        ui.ringIcon(pad + 14, y - 10, 11, v.css, v.ring);
      } else ui.text(n.type === 'Source' ? '◇' : '•', pad + 4, y, { size: 28, color: UI.dim });
      ui.text(n.label, pad + 40, y, { size: 27, maxWidth: w - pad * 2 - 40 });
      y += 38;
    }
    if (rest.length > shown) ui.text(`+ ${rest.length - shown} more`, pad + 40, y, { size: 25, color: UI.dim });
    ui.button('close', 'Close', w - pad - 200, h - 112, 200, 80, () => app.closeCard('library'), { icon: '✕' });
  };
}
