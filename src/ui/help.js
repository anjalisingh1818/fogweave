/**
 * Help card (opened from the small "?" on the left wrist), the Library
 * card, and the colour/ring legend. Large type, short lines.
 */
import { VERDICT_STYLE } from '../model/schema.js';
import { UI } from '../render/card.js';

export function helpDraw(app) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text('HOW TO READ THE FOG', pad, 70, { size: 30, color: UI.dim, weight: 600 });
    let y = 128;
    for (const key of ['supported', 'mixed', 'contradicted', 'unverified']) {
      const v = VERDICT_STYLE[key];
      ui.ringIcon(pad + 20, y - 12, 18, v.css, v.ring);
      ui.text(`${v.label}`, pad + 56, y, { size: 32, color: v.css, weight: 600 });
      ui.text(`${v.ring} ring`, pad + 360, y, { size: 28, color: UI.dim });
      y += 48;
    }
    y += 6;
    ui.text('Translucent = fog (this session). Solid = sealed.', pad, y, { size: 29 });
    y += 54;
    const tips = [
      'Pinch a node: open its card',
      'Pinch empty space: name a topic',
      'Coin (tap or flip near a node): evidence',
      'Locket (tap or swing near a node): importance',
      'Link two nodes: the path between them',
      'Flick a card away, or press Close',
    ];
    for (const t of tips) {
      ui.text(`· ${t}`, pad, y, { size: 29, color: '#d6dce4' });
      y += 40;
    }
    const bw = (w - pad * 2 - 40) / 3;
    const by = h - 118;
    ui.button('library', `Library (${app.store.sealedIds().length})`, pad, by, bw, 84, () => app.openLibrary(), { size: 30 });
    ui.button('tour', 'Tour', pad + bw + 20, by, bw, 84, () => app.startOnboarding(true), { size: 30 });
    ui.button('close', 'Close', pad + (bw + 20) * 2, by, bw, 84, () => app.closeCard('help'), { size: 30, icon: '✕' });
  };
}

export function libraryDraw(app) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    const sealed = [...app.store.nodes.values()].filter((n) => n.sealed);
    ui.text('LIBRARY · WHAT YOU SEALED', pad, 70, { size: 30, color: UI.accent, weight: 600 });
    ui.text(app.store.meta.topic || '', pad, 118, { size: 32, color: UI.dim, maxWidth: w - pad * 2 });
    let y = 172;
    if (!sealed.length) {
      ui.para('Nothing sealed yet. Open a node card and press Seal to keep it.', pad, y, w - pad * 2, { size: 32, color: UI.dim });
    }
    const order = { Topic: 0, Claim: 1, Entity: 2, Source: 3 };
    sealed.sort((a, b) => order[a.type] - order[b.type]);
    for (const n of sealed.slice(0, 8)) {
      if (n.type === 'Claim') {
        const v = VERDICT_STYLE[n.verdict || 'unverified'];
        ui.ringIcon(pad + 14, y - 11, 12, v.css, v.ring);
      } else ui.text(n.type === 'Source' ? '◇' : '•', pad + 4, y, { size: 30, color: UI.dim });
      ui.text(n.label, pad + 40, y, { size: 29, maxWidth: w - pad * 2 - 40 });
      y += 42;
    }
    if (sealed.length > 8) ui.text(`+ ${sealed.length - 8} more`, pad + 40, y, { size: 28, color: UI.dim });
    ui.button('close', 'Close', w - pad - 200, h - 118, 200, 84, () => app.closeCard('library'), { icon: '✕' });
  };
}
