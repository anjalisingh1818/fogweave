/**
 * Reader card for a news light: headline, source, date, our own short
 * summary, 2-3 key claims with short verbatim quotes, and the link. The text
 * is always on the card (read-aloud, later, is only an extra).
 *
 * Expand grows the item into the web (live, or a recorded run offline).
 * Ask answers from the web with citations (live; recorded answers offline).
 * Listen reads the card aloud where the browser can; Story lists related items.
 */
import { UI } from '../render/card.js';
import { LIGHT_KINDS, ageMark } from '../render/lights.js';
import { speech } from '../audio.js';
import { settings } from '../config.js';

export function readerDraw(app, id) {
  return (ctx, ui, w, h) => {
    const it = app.lights.get(id);
    const pad = 48;
    if (!it) {
      ui.text('This light has faded.', pad, 110, { size: 40, color: UI.dim });
      ui.button('close', 'Close', w - pad - 220, h - 128, 220, 92, () => app.closeCard(`light:${id}`));
      return;
    }
    const kind = LIGHT_KINDS[it.kind] || LIGHT_KINDS.breaking;
    const sealed = app.lights.sealed.has(id);
    let y = 76;
    ui.text(`${kind.label.toUpperCase()} · ${ageMark(app.lights.ageDays(it))}`, pad, y, { size: 30, color: kind.css, weight: 600 });
    const badge = app.lightsMeta?.kind === 'fixture' ? 'TEST FIXTURE' : sealed ? 'SEALED' : it.live ? 'LIVE' : 'SNAPSHOT';
    ui.text(badge, w - pad, y, { size: 26, color: badge === 'SEALED' ? UI.accent : badge === 'TEST FIXTURE' ? '#f0c987' : UI.dim, weight: 700, align: 'right' });
    y += 64;
    y = ui.para(it.headline, pad, y, w - pad * 2, { size: 42, weight: 600, maxLines: 2, lineHeight: 1.2 });
    ui.text([it.source, it.date?.slice(0, 10), it.via ? `via ${it.via}` : ''].filter(Boolean).join(' · '), pad, y + 2, { size: 27, color: UI.dim, maxWidth: w - pad * 2 });
    y += 50;
    if (it.summary) y = ui.para(it.summary, pad, y, w - pad * 2, { size: 30, color: '#d3dae3', maxLines: 3 }) + 4;
    ui.rule(y - 14);
    y += 26;
    if (it.claimsLoading) {
      ui.text('Reading the article for key claims…', pad, y, { size: 28, color: UI.dim });
      y += 40;
    }
    for (const c of (it.claims || []).slice(0, 3)) {
      if (y > h - 330) break;
      y = ui.para(`• ${c.text}`, pad, y, w - pad * 2, { size: 28, maxLines: 2 });
      if (c.quote) y = ui.para(`“${c.quote}”`, pad + 28, y, w - pad * 2 - 28, { size: 24, color: UI.dim, maxLines: 1 });
      y += 6;
    }
    if (it.claimsNote) ui.text(it.claimsNote, pad, Math.min(y + 4, h - 300), { size: 24, color: '#f0c987', maxWidth: w - pad * 2 });
    if (it.url) ui.text(shortUrl(it.url), pad, h - 270, { size: 25, color: '#8fb7e6', maxWidth: w - pad * 2 });
    // small row: read aloud, same story, touches me
    const small = [];
    if (speech.available() && settings.audio.readAloud) {
      small.push({ id: 'listen', label: speech.speaking() ? 'Stop' : 'Listen', on: () => (speech.speaking() ? speech.stop() : speech.speak([it.headline, it.summary, ...(it.claims || []).map((c) => c.text)].filter(Boolean).join('. '))) });
    }
    const mates = app.storyMates(id).length;
    if (mates) small.push({ id: 'story', label: `Story +${mates}`, on: () => app.openTimeline(id) });
    if (it.expanded === true) small.push({ id: 'touch', label: 'Touches me?', on: () => app.touchesMe(id) });
    small.push({ id: 'more', label: 'More like this', on: () => app.likeLight(id, true) });
    small.push({ id: 'less', label: 'Less', on: () => app.likeLight(id, false) });
    const sw = small.length > 4 ? 150 : 200;
    small.forEach((b, i) => ui.button(b.id, b.label, pad + i * (sw + 12), h - 244, sw, 58, b.on, { size: small.length > 4 ? 20 : 24 }));
    if (it.outside) ui.text('Outside your usual interests', w - pad, 112, { size: 22, color: '#9fe3ff', align: 'right' });
    const can = app.canExpand(id);
    const note = it.expanded === 'running' ? 'Growing into the web…' : it.expanded ? 'In the web: pinch its node for links and effects.' : can ? 'Expand shows what it connects to and may affect.' : 'Expand needs the live engine (no recorded run for this light).';
    ui.text(note, pad, h - 152, { size: 24, color: UI.dim, maxWidth: w - pad * 2 });

    const by = h - 122;
    const bw = (w - pad * 2 - 60) / 4;
    if (sealed) ui.button('unseal', 'Unseal', pad, by, bw, 88, () => app.unsealLight(id), { icon: '◇', size: 30 });
    else ui.button('seal', 'Seal', pad, by, bw, 88, () => app.sealLight(id), { primary: true, icon: '◆', size: 30 });
    const expLabel = it.expanded === 'running' ? 'Growing' : it.expanded ? 'Expanded' : 'Expand';
    ui.button('expand', expLabel, pad + (bw + 20), by, bw, 88, () => app.expandLight(id), { disabled: !can || !!it.expanded || app.researching, size: 30, primary: can && !it.expanded });
    ui.button('ask', 'Ask', pad + (bw + 20) * 2, by, bw, 88, () => app.openAsk(id), { size: 30 });
    ui.button('close', 'Close', pad + (bw + 20) * 3, by, bw, 88, () => app.closeCard(`light:${id}`), { icon: '✕', size: 30 });
  };
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/\/$/, '').slice(0, 64);
  } catch {
    return url.slice(0, 64);
  }
}
