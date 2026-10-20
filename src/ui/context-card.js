/**
 * "My context" card: the reader's few coarse context items, with remove
 * buttons, add (keypad), a clearly labelled fictional sample persona, and
 * one-action "Clear my context". States plainly where the data lives.
 */
import { UI } from '../render/card.js';
import { CONTEXT_KINDS } from '../context.js';

export function contextDraw(app) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text('MY CONTEXT', pad, 70, { size: 30, color: '#ffd36e', weight: 700 });
    if (app.context.sample) ui.text('SAMPLE PERSONA · FICTIONAL', w - pad, 70, { size: 24, color: '#f0c987', weight: 700, align: 'right' });
    ui.para('Stored on this device only. Sent only with a request that needs it, never kept on the server.', pad, 118, w - pad * 2, { size: 25, color: UI.dim, maxLines: 2 });
    let y = 200;
    const items = app.context.list();
    if (!items.length) {
      ui.para('Add a few coarse things (city, field, tools you use, interests) so FogWeave can show how news may touch you.', pad, y, w - pad * 2, { size: 29, maxLines: 3 });
    }
    const colW = (w - pad * 2 - 20) / 2;
    items.forEach((it, i) => {
      const x = pad + (i % 2) * (colW + 20);
      const yy = y + Math.floor(i / 2) * 78;
      ui.text(it.label, x, yy + 30, { size: 29, weight: 600, maxWidth: colW - 80 });
      ui.text(CONTEXT_KINDS[it.kind] || it.kind, x, yy + 58, { size: 21, color: UI.dim, maxWidth: colW - 80 });
      ui.button(`rm:${it.id}`, '✕', x + colW - 66, yy + 4, 62, 56, () => app.removeContext(it.id), { size: 26 });
    });
    const by = h - 118;
    const bw = (w - pad * 2 - 60) / 4;
    ui.button('add', 'Add', pad, by, bw, 84, () => app.openKeypad('context'), { primary: true, size: 30 });
    ui.button('sample', 'Sample', pad + bw + 20, by, bw, 84, () => app.useSamplePersona(), { size: 30 });
    ui.button('clear', 'Clear all', pad + (bw + 20) * 2, by, bw, 84, () => app.clearContext(), { size: 28, disabled: !items.length });
    ui.button('close', 'Close', pad + (bw + 20) * 3, by, bw, 84, () => app.closeCard('context'), { icon: '✕', size: 28 });
  };
}
