/**
 * The detective board: what the thinking agent found, pinned up.
 * Stories are paper notes along the bottom; each finding is a sticky note above,
 * tied by red string to the stories its quotes come from. A merged finding (two
 * ideas that combine into one, Graph of Thoughts) sits on top, tied by gold
 * string to the two findings it joins. Every string is a real quote, checked by
 * code: pinch a finding to read its quotes at the bottom.
 */
import { UI, roundRect } from '../render/card.js';
import { LABEL_STYLE } from '../model/schema.js';

const KIND = {
  shared: 'SHARED NAME',
  same_actor: 'SAME ACTOR',
  recurring: 'RECURRING',
  sequence: 'SEQUENCE',
  contrast: 'CONTRAST',
  common_theme: 'COMMON THEME',
  background: 'BACKGROUND',
  precedent: 'PRECEDENT',
  trigger: 'POSSIBLE TRIGGER',
};
const RED = '#d4483b';
const GOLD = '#f2c46d';
const PAPER = '#ece3cf';
const STICKY = '#f3d98b';
const STICKY_MERGED = '#ffcf6e';
const INK = '#1d1a16';

export const kindLabel = (p) => (p.merged ? `MERGED · ${KIND[p.kind] || String(p.kind).toUpperCase()}` : KIND[p.kind] || String(p.kind).toUpperCase());

/** Where everything sits, in canvas pixels (also used by the tests). */
export function boardLayout(board, w, h) {
  const pad = 44;
  const top = 108;
  const bottom = h - 268;
  const results = board.results.slice(0, 4);
  const merged = results.find((p) => p.merged);
  const plain = results.filter((p) => p !== merged);
  const notes = [];
  const rowY = merged ? top + 168 : top + 30;
  const fw = Math.min(400, (w - pad * 2 - 30 * (plain.length - 1)) / Math.max(1, plain.length));
  const fx0 = (w - (plain.length * fw + (plain.length - 1) * 30)) / 2;
  plain.forEach((p, i) => notes.push({ p, i: board.results.indexOf(p), x: fx0 + i * (fw + 30), y: rowY, w: fw, h: 138 }));
  if (merged) notes.push({ p: merged, i: board.results.indexOf(merged), x: (w - 560) / 2, y: top + 12, w: 560, h: 130, merged: true });
  const ids = [...new Set(results.flatMap((p) => p.items || []))].slice(0, 5);
  const iw = Math.min(330, (w - pad * 2 - 24 * (ids.length - 1)) / Math.max(1, ids.length));
  const ix0 = (w - (ids.length * iw + (ids.length - 1) * 24)) / 2;
  const items = ids.map((id, i) => ({ id, x: ix0 + i * (iw + 24), y: bottom - 176, w: iw, h: 162 }));
  return { pad, top, bottom, notes, items };
}

export function boardDraw(app, board) {
  return (ctx, ui, w, h) => {
    const L = boardLayout(board, w, h);
    const { pad, top, bottom } = L;
    ui.text(board.recorded ? `DETECTIVE BOARD · ${board.recorded}` : 'DETECTIVE BOARD', pad, 66, { size: 26, color: UI.accent, weight: 700 });
    ui.text('Red string: a finding and the stories it quotes.   Gold: two findings merged into one.', w - pad, 66, { size: 19, color: UI.dim, align: 'right', maxWidth: w - pad * 2 - 380 });
    // the board itself: dark cork
    roundRect(ctx, pad - 10, top - 10, w - pad * 2 + 20, bottom - top + 20, 18);
    ctx.fillStyle = '#2b2219';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#4a3a29';
    ctx.stroke();
    for (let k = 0; k < 140; k++) {
      // cork grain: fixed, so the board does not flicker on redraw
      const x = pad + ((k * 977) % (w - pad * 2));
      const y = top + ((k * 593) % (bottom - top));
      ctx.fillStyle = k % 2 ? 'rgba(255,220,170,0.05)' : 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, y, 5, 3);
    }
    if (!L.notes.length) {
      ui.para(board.empty || 'Nothing pinned yet: no finding held up.', pad + 20, top + 80, w - pad * 2 - 40, { size: 26, color: '#e9dcc4', maxLines: 3 });
    }
    const itemAt = new Map(L.items.map((it) => [it.id, it]));
    const noteOf = new Map(L.notes.map((n) => [n.p.thought, n]));
    const sel = board.results[board.sel] || null;
    // strings first, behind the notes
    const string = (x1, y1, x2, y2, color, on) => {
      ctx.strokeStyle = color;
      ctx.globalAlpha = on ? 0.95 : 0.3;
      ctx.lineWidth = on ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2, Math.max(y1, y2) + 26, x2, y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    for (const n of L.notes) {
      const on = n.p === sel || (sel?.merged || []).includes(n.p.thought);
      const covered = new Set();
      if (n.merged) {
        for (const tid of n.p.merged || []) {
          const parent = noteOf.get(tid);
          if (!parent) continue;
          for (const id of parent.p.items || []) covered.add(id);
          string(n.x + n.w / 2, n.y + n.h - 8, parent.x + parent.w / 2, parent.y + 10, GOLD, n.p === sel);
        }
      }
      for (const id of n.p.items || []) {
        const it = itemAt.get(id);
        if (it && !covered.has(id)) string(n.x + n.w / 2, n.y + n.h - 8, it.x + it.w / 2, it.y + 12, RED, on);
      }
    }
    // findings: sticky notes
    for (const n of L.notes) {
      const isSel = n.p === sel;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = n.merged ? STICKY_MERGED : STICKY;
      ctx.fillRect(n.x, n.y, n.w, n.h);
      ctx.restore();
      if (isSel) {
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#fff4d0';
        ctx.strokeRect(n.x - 4, n.y - 4, n.w + 8, n.h + 8);
      }
      pin(ctx, n.x + n.w / 2, n.y + 10, n.merged ? '#9a6a12' : RED);
      ui.text(kindLabel(n.p), n.x + 16, n.y + 40, { size: 18, color: '#6a4a12', weight: 700, maxWidth: n.w - 32 });
      ui.para(n.p.text, n.x + 16, n.y + 68, n.w - 32, { size: 21, color: INK, weight: 600, maxLines: 3, lineHeight: 1.15 });
      ui.button(`f:${n.i}`, '', n.x, n.y, n.w, n.h, () => app.boardSelect(n.i), { size: 18 });
    }
    // stories: paper notes
    for (const it of L.items) {
      const info = board.labels[it.id] || {};
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = PAPER;
      ctx.fillRect(it.x, it.y, it.w, it.h);
      ctx.restore();
      const lit = sel && (sel.items || []).includes(it.id);
      if (lit) {
        ctx.lineWidth = 5;
        ctx.strokeStyle = RED;
        ctx.strokeRect(it.x - 3, it.y - 3, it.w + 6, it.h + 6);
      }
      pin(ctx, it.x + it.w / 2, it.y + 12, RED);
      ui.para(info.label || it.id, it.x + 14, it.y + 52, it.w - 28, { size: 21, color: INK, weight: 600, maxLines: 3, lineHeight: 1.15 });
      const meta = [String(info.date || '').slice(0, 10), info.source].filter(Boolean).join(' · ');
      ui.text(meta, it.x + 14, it.y + it.h - 16, { size: 18, color: '#5c5346', maxWidth: it.w - 28 });
      ui.button(`i:${it.id}`, '', it.x, it.y, it.w, it.h, () => app.boardOpenItem(it.id), { size: 18 });
    }
    // the chosen finding's evidence: its quotes, word for word
    let y = bottom + 46;
    if (sel) {
      const style = LABEL_STYLE[sel.label] || LABEL_STYLE.inferred;
      ui.text(kindLabel(sel), pad, y, { size: 19, color: '#ffe2a8', weight: 700 });
      ui.text(style.label.toUpperCase(), pad + 380, y, { size: 19, color: style.css, weight: 700 });
      ui.text(sel.merged ? 'Rests on both findings it joins' : `${(sel.quotes || []).length} quotes, each found word for word in its source`, w - pad, y, { size: 19, color: UI.dim, align: 'right' });
      y += 34;
      for (const q of (sel.quotes || []).slice(0, 3)) {
        const src = board.labels[q.id]?.label || '';
        y = ui.para(`“${q.quote}”  ${src ? `(${src.slice(0, 40)}${src.length > 40 ? '…' : ''})` : ''}`, pad, y, w - pad * 2, { size: 20, color: '#c8d3e0', maxLines: 1 }) + 2;
      }
    }
    const by = h - 104;
    if (sel) ui.button('show', 'Show in the fog', pad, by, 300, 76, () => app.boardShow(), { primary: true, size: 26 });
    ui.para(board.recorded ? 'Recording of a real run.' : 'Inferred: reasoned from the quotes, checked by code.', pad + (sel ? 330 : 0), by + 46, w - pad * 2 - 560, { size: 20, color: board.recorded ? '#f0c987' : UI.dim, maxLines: 1 });
    ui.button('close', 'Close', w - pad - 200, by, 200, 76, () => app.closeBoard(), { icon: '✕', size: 28 });
  };
}

function pin(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(x - 3, y - 3, 3, 0, Math.PI * 2);
  ctx.fill();
}
