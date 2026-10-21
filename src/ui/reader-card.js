/**
 * Reader card for a news light. Compact by default: source type, LIVE or
 * SNAPSHOT (date), headline, the real outlet and date, one summary line, and
 * the buttons. "Details" grows the card to show the key claims with short
 * verbatim quotes, the link, and Listen; "Hide details" shrinks it again.
 *
 * Layout is a top-down flow into the space above the button rows, so text can
 * never run under a button or the link (every drawn box is recorded on the card
 * and checked by qa/stage-a.mjs at three viewport sizes).
 *
 * Show related grows the item into the web (live, or a recorded run in the Demo scene).
 * Ask answers from the web with citations (live; recorded answers offline).
 */
import { UI } from '../render/card.js';
import { LIGHT_KINDS, ageMark } from '../render/lights.js';
import { speech } from '../audio.js';
import { settings } from '../config.js';

export const READER_SIZE = { compact: { width: 0.46, height: 0.25 }, details: { width: 0.46, height: 0.52 } };

const SOURCE_TYPES = { paper: 'PAPER', archive: 'ARCHIVE', filing: 'FILING', dataset: 'DATASET', news: 'NEWS' };
const VIA_NAMES = { wikipedia: 'Wikipedia Current events', gdelt: 'GDELT', hackernews: 'Hacker News', arxiv: 'arXiv' };

/** news / paper / archive / filing / dataset */
export function sourceType(it) {
  if (it.sourceType && SOURCE_TYPES[it.sourceType]) return it.sourceType;
  if (SOURCE_TYPES[it.kind] && it.kind !== 'news') return it.kind; // paper, archive, filing, dataset
  return 'news';
}

/** "LIVE", or "SNAPSHOT 20 Oct 2026" (when the snapshot was recorded). */
export function freshnessLabel(app, it) {
  if (app.lightsMeta?.kind === 'fixture') return 'TEST FIXTURE';
  if (it.live) return 'LIVE';
  const d = app.lightsMeta?.generatedAt || it.recordedAt;
  return d ? `SNAPSHOT ${shortDate(d)}` : 'SNAPSHOT';
}

export function readerDraw(app, id) {
  return (ctx, ui, w, h) => {
    const it = app.getItem(id);
    const pad = 40;
    if (!it) {
      ui.text('This light has faded.', pad, 100, { size: 36, color: UI.dim });
      ui.button('close', 'Close', w - pad - 200, h - pad - 76, 200, 76, () => app.closeCard(`light:${id}`), { icon: '✕', size: 28 });
      return;
    }
    const details = !!app.readerDetails?.has(id);
    const kind = LIGHT_KINDS[it.kind] || LIGHT_KINDS.breaking;
    const sealed = app.lights.sealed.has(id);

    // ---- bottom block, laid out from the bottom up
    const rowH = 76;
    const byMain = h - pad - rowH;
    const smallH = 54;
    const bySmall = byMain - 14 - smallH;
    const noteY = bySmall - 16; // baseline of the one-line status note
    const limit = noteY - 30; // nothing above may reach below this

    // ---- top block, flowing down
    let y = 62;
    const type = SOURCE_TYPES[sourceType(it)];
    ctx.font = `700 24px ${UI.font}`;
    const chipW = ctx.measureText(type).width + 28;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect?.(pad, y - 28, chipW, 38, 10);
    ctx.fill();
    ui.text(type, pad + 14, y, { size: 24, color: UI.text, weight: 700 });
    ui.text(`${kind.label} · ${ageMark(app.lights.ageDays(it))}`, pad + chipW + 14, y, { size: 26, color: kind.css, weight: 600 });
    const badge = sealed ? 'SEALED' : freshnessLabel(app, it);
    // move the card out of the way (next slot in VR; the other side on a flat page)
    ui.button('move', '⇄', w - pad - 58, y - 34, 58, 46, () => app.cards.move(`light:${id}`), { size: 26 });
    ui.text(badge, w - pad - 72, y, { size: 24, color: badge === 'SEALED' ? UI.accent : badge === 'LIVE' ? '#9fe3ff' : badge === 'TEST FIXTURE' ? '#f0c987' : UI.dim, weight: 700, align: 'right' });
    y += 52;
    y = fitPara(ui, it.headline, pad, y, w - pad * 2, { size: 38, weight: 600, maxLines: 2, lineHeight: 1.18 }, limit);
    // the real outlet first; the aggregator that found it second
    const via = it.via && it.via !== it.source ? ` · found via ${VIA_NAMES[it.via] || it.via}` : '';
    if (y + 26 <= limit) {
      ui.text(`${it.source || 'unknown source'} · ${shortDate(it.date)}${via}`, pad, y + 4, { size: 25, color: UI.dim, maxWidth: w - pad * 2 });
      y += 40;
    }
    if (it.outside && y + 24 <= limit) {
      ui.text('Outside your usual interests', pad, y + 2, { size: 22, color: '#9fe3ff' });
      y += 32;
    }
    if (it.summary) y = fitPara(ui, it.summary, pad, y + 4, w - pad * 2, { size: 27, color: '#d3dae3', maxLines: details ? 3 : 1 }, limit) + 4;

    if (details) {
      ui.rule(y - 10, pad, w - pad);
      y += 22;
      if (it.claimsLoading) {
        ui.text('Reading the article for key claims…', pad, y, { size: 26, color: UI.dim });
        y += 38;
      }
      for (const c of (it.claims || []).slice(0, 3)) {
        const before = y;
        y = fitPara(ui, `• ${c.text}`, pad, y, w - pad * 2, { size: 26, maxLines: 2 }, limit - (c.quote ? 34 : 0));
        if (y === before) break; // no room left
        if (c.quote) y = fitPara(ui, `“${c.quote}”`, pad + 26, y, w - pad * 2 - 26, { size: 23, color: UI.dim, maxLines: 1 }, limit);
        y += 6;
      }
      if (it.claimsNote) y = fitPara(ui, it.claimsNote, pad, y + 4, w - pad * 2, { size: 22, color: '#f0c987', maxLines: 2 }, limit);
      if (it.url && y + 30 <= limit) {
        ui.text(shortUrl(it.url), pad, y + 8, { size: 24, color: '#8fb7e6', maxWidth: w - pad * 2 });
        y += 38;
      }
    }

    // ---- status note (one line)
    const can = app.canExpand(id);
    const note = it.expanded === 'running' ? 'Finding what it relates to…' : it.expanded ? 'Related items are around it: touch one to see how it relates.' : can ? 'Show related: what it connects to, older news included.' : 'Showing related items needs the live engine (no recorded run for this star).';
    ui.text(note, pad, noteY, { size: 22, color: UI.dim, maxWidth: w - pad * 2 });

    // ---- small row
    const small = [];
    if (details && speech.available() && settings.audio.readAloud) {
      small.push({ id: 'listen', label: speech.speaking() ? 'Stop' : 'Listen', on: () => (speech.speaking() ? speech.stop() : speech.speak([it.headline, it.summary, ...(it.claims || []).map((c) => c.text)].filter(Boolean).join('. '))) });
    }
    const mates = app.storyMates(id).length;
    if (details && mates) small.push({ id: 'story', label: `Story +${mates}`, on: () => app.openTimeline(id) });
    small.push({ id: 'more', label: 'More like this', on: () => app.likeLight(id, true) });
    small.push({ id: 'less', label: 'Less like this', on: () => app.likeLight(id, false) });
    const gap = 10;
    const sw = (w - pad * 2 - gap * (small.length - 1)) / small.length;
    small.forEach((b, i) => ui.button(b.id, b.label, pad + i * (sw + gap), bySmall, sw, smallH, b.on, { size: small.length > 4 ? 19 : 22 }));

    // ---- main row: Seal, Expand, Ask, Details, Close
    const mw = (w - pad * 2 - gap * 4) / 5;
    const x = (i) => pad + i * (mw + gap);
    if (sealed) ui.button('unseal', 'Unseal', x(0), byMain, mw, rowH, () => app.unsealLight(id), { icon: '◇', size: 26 });
    else ui.button('seal', 'Seal', x(0), byMain, mw, rowH, () => app.sealLight(id), { primary: true, icon: '◆', size: 26 });
    const expLabel = it.expanded === 'running' ? 'Finding…' : it.expanded ? 'Related ✓' : 'Show related';
    ui.button('expand', expLabel, x(1), byMain, mw, rowH, () => app.expandLight(id), { disabled: !can || !!it.expanded || app.researching, size: 22, primary: can && !it.expanded });
    ui.button('ask', 'Ask', x(2), byMain, mw, rowH, () => app.openAsk(id), { size: 26 });
    ui.button('details', details ? 'Hide ▴' : 'Details ▾', x(3), byMain, mw, rowH, () => app.toggleReaderDetails(id), { size: 24 });
    ui.button('close', 'Close', x(4), byMain, mw, rowH, () => app.closeCard(`light:${id}`), { icon: '✕', size: 26 });
  };
}

/** A paragraph that never extends below `limit` (fewer lines, or none). */
function fitPara(ui, text, x, y, width, opts, limit) {
  const size = opts.size ?? 36;
  const lh = opts.lineHeight ?? 1.3;
  const room = Math.floor((limit - y - size * 0.25) / (size * lh)) + 1;
  const maxLines = Math.min(opts.maxLines ?? 99, room);
  if (maxLines < 1) return y;
  return ui.para(text, x, y, width, { ...opts, maxLines });
}

function shortDate(d) {
  if (!d) return 'date unknown';
  const t = new Date(d);
  return Number.isNaN(+t) ? String(d).slice(0, 10) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/\/$/, '').slice(0, 64);
  } catch {
    return url.slice(0, 64);
  }
}
