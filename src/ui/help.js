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
    const n = app.store.sealedIds().length + Object.keys(app.sealedLights || {}).length + (app.sealedAnswers?.length || 0);
    const bw = (w - pad * 2 - 60) / 4;
    const rows = [
      [
        ['library', `Library ${n}`, () => app.openLibrary()],
        ['notes', 'Notes', () => app.openNotes()],
        ['lights', 'Lights', () => app.openLightsPanel()],
        ['context', 'My context', () => app.openContext(), true],
      ],
      [
        ['briefing', 'Briefing', () => app.startBriefing()],
        ['settings', 'Settings', () => app.openSettings()],
        ['tour', 'Tour', () => app.startOnboarding(true)],
        ['close', 'Close', () => app.closeCard('help')],
      ],
    ];
    rows.forEach((row, r) =>
      row.forEach(([id, label, on, primary], i) => ui.button(id, label, pad + i * (bw + 20), h - 200 + r * 92, bw, 80, on, { size: 26, primary: !!primary })),
    );
  };
}

export function libraryDraw(app) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    const sealed = [...app.store.nodes.values()].filter((n) => n.sealed);
    const lights = Object.values(app.sealedLights || {});
    ui.text('LIBRARY · WHAT YOU SEALED', pad, 70, { size: 30, color: UI.accent, weight: 600 });
    const e = app.cards.entry('library');
    ui.button('pin', e?.pinned ? 'Unpin' : 'Pin', w - pad - 330, 26, 150, 64, () => app.cards.setPinned('library', !e?.pinned), { size: 26 });
    ui.button('move', 'Move', w - pad - 170, 26, 150, 64, () => app.cards.move('library'), { size: 26 });
    ui.text('Kept on this device. Export makes an Evidence Pack (links and short quotes only).', pad, 120, { size: 23, color: UI.dim, maxWidth: w - pad * 2 });
    let y = 170;
    for (const a of (app.sealedAnswers || []).slice(-2)) {
      ui.text('?', pad + 8, y, { size: 28, color: '#9cc7ff', weight: 700 });
      ui.text(a.question, pad + 40, y, { size: 27, maxWidth: w - pad * 2 - 40 });
      y += 38;
    }
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
    ui.button('export', 'Export pack', pad, h - 112, 280, 80, () => app.exportPack(), { primary: true, size: 28 });
    ui.button('close', 'Close', w - pad - 200, h - 112, 200, 80, () => app.closeCard('library'), { icon: '✕' });
  };
}
