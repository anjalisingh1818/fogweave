/**
 * The Menu (opened from the small button on the left wrist), the Help card
 * (how to read the fog), About & limits, and the Library with notes.
 * Large type, short lines, every action a pinch.
 */
import { VERDICT_STYLE, LABEL_STYLE } from '../model/schema.js';
import { UI } from '../render/card.js';
import { settings } from '../config.js';

/** Menu: Library, Interests, Calm, Demo / Live scene, Help, About, Settings. */
export function menuDraw(app) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text('MENU', pad, 70, { size: 30, color: UI.accent, weight: 700 });
    ui.text(app.modeLine(), pad, 116, { size: 24, color: UI.dim, maxWidth: w - pad * 2 });
    const n = app.store.sealedIds().length + Object.keys(app.sealedLights || {}).length + (app.sealedAnswers?.length || 0);
    const demo = app.mode === 'offline';
    const items = [
      ['library', `Library ${n}`, () => app.openLibrary(), true],
      ['interests', 'Interests', () => app.openInterests()],
      ['calm', settings.comfort.gentle ? 'Calm: on' : 'Calm: off', () => app.toggleCalm()],
      ['scene', demo ? 'Live scene' : 'Demo scene', () => (demo ? app.enterLive() : app.enterDemo())],
      ['guide', 'Help', () => app.openGuide()],
      ['about', 'About & limits', () => app.openAbout()],
      ['settings', 'Settings', () => app.openSettings()],
      ['close', 'Close', () => app.closeCard('help')],
    ];
    const cols = 3;
    const bw = (w - pad * 2 - (cols - 1) * 18) / cols;
    const bh = 96;
    const top = 160;
    items.forEach(([id, label, on, primary], i) => {
      ui.button(id, label, pad + (i % cols) * (bw + 18), top + Math.floor(i / cols) * (bh + 18), bw, bh, on, { size: 27, primary: !!primary });
    });
    const y = top + 3 * (bh + 18) + 40;
    ui.para(demo ? 'Demo scene: a dated snapshot of real runs. Nothing here is live.' : 'Pinch empty fog to ask about any topic or past news.', pad, y, w - pad * 2, { size: 23, color: UI.dim, maxLines: 2 });
  };
}

/** Help: what the colours, rings and link styles mean, and the gestures. */
export function guideDraw(app) {
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
    ui.text('Translucent = in the fog (this session). Solid = sealed in your Library.', pad, y + 6, { size: 25, maxWidth: w - pad * 2 });
    y += 52;
    const tips = [
      'Touch a star: its card · Show related: the web around it',
      'Touch a node: how it relates, and what it is',
      'Pinch empty fog: ask about any topic or past news',
      'Seal: keep it in your Library · Flick a card away',
      'Coin: evidence · Locket: relevance to you',
    ];
    for (const t of tips) {
      ui.text(`· ${t}`, pad, y, { size: 25, color: '#d6dce4', maxWidth: w - pad * 2 });
      y += 34;
    }
    ui.button('close', 'Close', w - pad - 200, h - 112, 200, 80, () => app.closeCard('guide'), { icon: '✕' });
  };
}

/** About & limits: what FogWeave is, and what it cannot do (docs/KNOWN_LIMITS.md). */
export function aboutDraw(app) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text('ABOUT & LIMITS', pad, 66, { size: 28, color: UI.accent, weight: 700 });
    const lines = [
      'FogWeave shows where every statement comes from and how well it is supported. It is a research aid, not advice.',
      'Effects and links marked Inferred or Speculative are reasoning, and can be wrong. Check the sources.',
      'Free news sources and free AI models are limited: this is not "all news", and archives are partial.',
      '"Deep web" here means open sources search engines rarely show, never secrets or anything behind a login.',
      'Your interests and Library stay on this device.',
      'Tested with emulated hands; real headset timing may differ.',
    ];
    let y = 120;
    for (const l of lines) {
      y = ui.para(`· ${l}`, pad, y, w - pad * 2, { size: 25, color: '#d6dce4', maxLines: 3 }) + 10;
    }
    ui.button('close', 'Close', w - pad - 200, h - 112, 200, 80, () => app.closeCard('about'), { icon: '✕' });
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
    const limit = h - 300; // keep clear of the notes and the buttons
    for (const a of (app.sealedAnswers || []).slice(-2)) {
      if (y > limit) break;
      ui.text('?', pad + 8, y, { size: 28, color: '#9cc7ff', weight: 700 });
      ui.text(a.question, pad + 40, y, { size: 27, maxWidth: w - pad * 2 - 40 });
      y += 38;
    }
    for (const it of lights.slice(0, 4)) {
      if (y > limit) break;
      ui.text('✦', pad + 4, y, { size: 28, color: '#ffe2a8' });
      ui.text(it.headline, pad + 40, y, { size: 27, maxWidth: w - pad * 2 - 40 });
      y += 38;
    }
    if (lights.length > 4 && y <= limit) {
      ui.text(`+ ${lights.length - 4} more news items`, pad + 40, y, { size: 25, color: UI.dim });
      y += 38;
    }
    if (!sealed.length && !lights.length) {
      y = ui.para('Nothing sealed yet. Open a star or a node and press Seal to keep it.', pad, y, w - pad * 2, { size: 28, color: UI.dim, maxLines: 2 });
    }
    const order = { Claim: 0, NewsItem: 1, Event: 2, Source: 9 };
    const rest = sealed.filter((n) => n.type !== 'NewsItem' || !app.sealedLights?.[n.id]).sort((a, b) => (order[a.type] ?? 5) - (order[b.type] ?? 5));
    let shown = 0;
    for (const n of rest) {
      if (y > limit) break;
      if (n.type === 'Claim') {
        const v = VERDICT_STYLE[n.verdict || 'unverified'];
        ui.ringIcon(pad + 14, y - 10, 11, v.css, v.ring);
      } else ui.text(n.type === 'Source' ? '◇' : '•', pad + 4, y, { size: 28, color: UI.dim });
      ui.text(n.label, pad + 40, y, { size: 27, maxWidth: w - pad * 2 - 40 });
      y += 38;
      shown++;
    }
    if (rest.length > shown) ui.text(`+ ${rest.length - shown} more`, pad + 40, Math.min(y, limit + 30), { size: 25, color: UI.dim });
    // notes live in the Library (and go into the Evidence Pack)
    const notes = app.userNotes || [];
    ui.rule(h - 262, pad, w - pad);
    ui.text(`NOTES ${notes.length}`, pad, h - 222, { size: 24, color: UI.accent, weight: 700 });
    notes.slice(-2).forEach((nt, i) => {
      const idx = notes.length - Math.min(2, notes.length) + i;
      ui.text(`· ${nt.text}`, pad + 150, h - 222 + i * 40, { size: 24, maxWidth: w - pad * 2 - 150 - 70 });
      ui.button(`rm:${idx}`, '✕', w - pad - 56, h - 252 + i * 40, 56, 38, () => app.removeNote(idx), { size: 20 });
    });
    if (!notes.length) ui.text('Short notes, by keypad or suggestion cards.', pad + 150, h - 222, { size: 22, color: UI.dim, maxWidth: w - pad * 2 - 150 });
    const bw = (w - pad * 2 - 60) / 4;
    ui.button('note', 'Add note', pad, h - 112, bw, 80, () => app.openKeypad('note'), { size: 24 });
    ui.button('patterns', 'Find patterns', pad + bw + 20, h - 112, bw, 80, () => app.findPatterns(), { size: 24 });
    ui.button('export', 'Export pack', pad + (bw + 20) * 2, h - 112, bw, 80, () => app.exportPack(), { primary: true, size: 24 });
    ui.button('close', 'Close', pad + (bw + 20) * 3, h - 112, bw, 80, () => app.closeCard('library'), { icon: '✕', size: 24 });
  };
}
