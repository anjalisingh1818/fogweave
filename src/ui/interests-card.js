/**
 * Interests card (hands only): news types and paper types as toggle chips,
 * free topics with weight up/down, muted topics, a surprise level, "New
 * lights" and "Clear interests". Stored on this device.
 */
import { UI } from '../render/card.js';
import { NEWS_TYPES, PAPER_TYPES, SOURCE_TYPES } from '../interests.js';

export function interestsDraw(app) {
  return (ctx, ui, w, h) => {
    const d = app.interests.data;
    const pad = 40;
    ui.text('INTERESTS', pad, 60, { size: 28, color: '#ffe2a8', weight: 700 });
    ui.text('On this device only. They shape which lights you see, never the evidence labels.', pad, 96, { size: 21, color: UI.dim, maxWidth: w - pad * 2 });
    // news types: 5 x 2 chips
    let y = 120;
    const cw = (w - pad * 2 - 4 * 10) / 5;
    NEWS_TYPES.forEach((t, i) => {
      const on = d.newsTypes.includes(t);
      ui.button(`type:${t}`, t, pad + (i % 5) * (cw + 10), y + Math.floor(i / 5) * 60, cw, 52, () => {
        app.interests.toggleNewsType(t);
        app.interestsChanged();
      }, { size: 21, primary: on });
    });
    y += 132;
    ui.text('Papers', pad, y, { size: 22, color: UI.dim, weight: 600 });
    y += 12;
    Object.entries(PAPER_TYPES).forEach(([c, label], i) => {
      const on = d.paperTypes.includes(c);
      ui.button(`paper:${c}`, label, pad + (i % 5) * (cw + 10), y + Math.floor(i / 5) * 60, cw, 52, () => {
        app.interests.togglePaperType(c);
        app.interestsChanged();
      }, { size: 17, primary: on });
    });
    y += 136;
    ui.text('Topics', pad, y, { size: 22, color: UI.dim, weight: 600 });
    y += 12;
    d.topics.slice(0, 4).forEach((t, i) => {
      const x = pad + (i % 2) * ((w - pad * 2) / 2);
      const yy = y + Math.floor(i / 2) * 60;
      ui.text(`${t.label} ×${t.weight}`, x, yy + 36, { size: 22, maxWidth: (w - pad * 2) / 2 - 150 });
      ui.button(`up:${t.label}`, '+', x + (w - pad * 2) / 2 - 140, yy, 60, 52, () => {
        app.interests.adjustTopic(t.label, 0.5);
        app.interestsChanged();
      }, { size: 24 });
      ui.button(`down:${t.label}`, '−', x + (w - pad * 2) / 2 - 72, yy, 60, 52, () => {
        app.interests.adjustTopic(t.label, -0.5);
        app.interestsChanged();
      }, { size: 24 });
    });
    if (!d.topics.length) ui.text('None yet: add one, or press "More like this" on a light.', pad, y + 34, { size: 21, color: UI.dim });
    y += 128;
    if (d.muted.length) ui.text(`Muted: ${d.muted.join(', ')}`, pad, y, { size: 21, color: UI.dim, maxWidth: w - pad * 2 });
    // open deep sources the reader can add to the feed
    y += 40;
    ui.text('Also show', pad, y + 34, { size: 22, color: UI.dim, weight: 600 });
    Object.entries(SOURCE_TYPES).forEach(([t, label], i) => {
      ui.button(`source:${t}`, label, pad + 150 + i * (cw + 10), y, cw, 52, () => {
        app.interests.toggleSourceType(t);
        app.interestsChanged();
      }, { size: 20, primary: (d.sourceTypes || []).includes(t) });
    });
    if (app.interests.canUndo) {
      ui.button('undo', 'Undo', w - pad - cw, y, cw, 52, () => app.undoInterests(), { size: 20 });
    }
    // surprise level
    const lv = [['Low', 0.05], ['Some', 0.25], ['More', 0.6]];
    ui.text('Surprise', pad, h - 150, { size: 22, color: UI.dim });
    lv.forEach(([l, v], i) => ui.button(`surprise:${l}`, l, pad + 120 + i * 120, h - 186, 110, 52, () => {
      app.interests.setSurprise(v);
      app.drawLights();
      app.cards.get('interests')?.redraw();
    }, { size: 21, primary: Math.abs(d.surprise - v) < 0.01 }));
    const bw = (w - pad * 2 - 30) / 4;
    const by = h - 104;
    ui.button('add', 'Add topic', pad, by, bw, 72, () => app.openKeypad('interest'), { size: 24, primary: true });
    ui.button('reshuffle', 'New lights', pad + bw + 10, by, bw, 72, () => app.reshuffle(), { size: 24 });
    ui.button('clear', 'Clear all', pad + (bw + 10) * 2, by, bw, 72, () => {
      app.interests.clear();
      app.interestsChanged();
    }, { size: 24 });
    ui.button('close', 'Close', pad + (bw + 10) * 3, by, bw, 72, () => app.closeCard('interests'), { size: 24, icon: '✕' });
  };
}
