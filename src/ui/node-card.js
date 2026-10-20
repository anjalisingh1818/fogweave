/**
 * Content for the node card, reveal cards and status line.
 * Every number shown is accompanied by what it is made of.
 */
import { VERDICT_STYLE } from '../model/schema.js';
import { evidenceReadout } from '../model/algorithms.js';
import { UI } from '../render/card.js';

const TYPE_LABEL = { Topic: 'Topic', Claim: 'Claim', Source: 'Source', Entity: 'Entity' };

export function nodeCardDraw(app, id) {
  return (ctx, ui, w, h) => {
    const node = app.store.nodes.get(id);
    if (!node) {
      ui.text('This item left the fog.', 48, 110, { size: 40, color: UI.dim });
      ui.button('close', 'Close', w - 260, h - 130, 210, 90, () => app.closeCard(`node:${id}`));
      return;
    }
    const pad = 48;
    let y = 78;
    // header: type, verdict ring + label
    ui.text(TYPE_LABEL[node.type].toUpperCase(), pad, y, { size: 30, color: UI.dim, weight: 600 });
    if (node.type === 'Claim') {
      const v = VERDICT_STYLE[node.verdict || 'unverified'];
      ui.ringIcon(pad + 210, y - 11, 17, v.css, v.ring);
      ui.text(v.label, pad + 240, y, { size: 32, color: v.css, weight: 600 });
    }
    ui.text(node.sealed ? 'SEALED' : 'IN THE FOG', w - pad, y, {
      size: 28,
      color: node.sealed ? UI.accent : UI.dim,
      weight: 600,
      align: 'right',
    });
    y += 66;
    y = ui.para(node.label, pad, y, w - pad * 2, { size: 46, weight: 600, maxLines: 2 });
    y += 4;

    if (node.type === 'Claim' && node.quote) {
      y = ui.para(`“${node.quote}”`, pad, y, w - pad * 2, { size: 31, color: '#cdd5df', maxLines: 2 });
    } else if (node.summary) {
      y = ui.para(node.summary, pad, y, w - pad * 2, { size: 31, color: '#cdd5df', maxLines: 3 });
    } else if (node.type === 'Source') {
      y = ui.para([node.domain, node.date].filter(Boolean).join(' · ') || 'No details', pad, y, w - pad * 2, { size: 31, color: '#cdd5df', maxLines: 2 });
    }

    const read = evidenceReadout(app.store, id);
    if (read) {
      ui.rule(y - 8);
      y += 34;
      for (const line of read.lines.slice(0, 3)) {
        ui.text(line, pad, y, { size: 30, color: UI.text, maxWidth: w - pad * 2 });
        y += 40;
      }
      if (read.risk) {
        ui.text(read.risk, pad, y, { size: 29, color: '#f0c987', maxWidth: w - pad * 2 });
        y += 40;
      }
    }

    // actions
    const by = h - 128;
    const bw = (w - pad * 2 - 40) / 3;
    if (node.sealed) {
      ui.button('unseal', 'Unseal', pad, by, bw, 92, () => app.unseal(id), { icon: '◇' });
    } else {
      ui.button('seal', 'Seal', pad, by, bw, 92, () => app.seal(id), { primary: true, icon: '◆' });
    }
    const linking = app.linkFromId && app.linkFromId !== id;
    ui.button('link', linking ? 'Path here' : app.linkFromId === id ? 'Linking…' : 'Link', pad + bw + 20, by, bw, 92, () => app.link(id), {
      primary: linking,
    });
    ui.button('close', 'Close', pad + (bw + 20) * 2, by, bw, 92, () => app.closeCard(`node:${id}`), { icon: '✕' });
  };
}

export function locketDraw(app, id, imp, scope) {
  return (ctx, ui, w, h) => {
    const node = app.store.nodes.get(id);
    const pad = 44;
    ui.text('LOCKET · IMPORTANCE', pad, 72, { size: 30, color: '#e8cf86', weight: 600 });
    ui.para(node?.label || '', pad, 132, w - pad * 2, { size: 38, weight: 600, maxLines: 2 });
    if (!imp) {
      ui.para('Not part of this web yet.', pad, 260, w - pad * 2, { size: 34, color: UI.dim });
    } else {
      ui.text(`${ordinal(imp.rank)} of ${imp.of}`, pad, 272, { size: 72, weight: 700, color: '#f3e2b0' });
      ui.text(scope, pad + 360, 266, { size: 28, color: UI.dim, maxWidth: w - pad - 360 - pad });
      let y = 332;
      for (const why of imp.why) {
        ui.text(`· ${why}`, pad, y, { size: 31 });
        y += 42;
      }
    }
    ui.button('close', 'Close', w - pad - 200, h - 118, 200, 84, () => app.closeCard('reveal'), { icon: '✕' });
  };
}

export function coinDraw(app, id, read) {
  return (ctx, ui, w, h) => {
    const node = app.store.nodes.get(id);
    const pad = 44;
    ui.text('COIN · EVIDENCE', pad, 72, { size: 30, color: '#9cc7ff', weight: 600 });
    let y = ui.para(node?.label || '', pad, 132, w - pad * 2, { size: 38, weight: 600, maxLines: 2 });
    if (read?.verdict) {
      const v = VERDICT_STYLE[read.verdict];
      ui.ringIcon(pad + 22, y + 8, 22, v.css, v.ring);
      ui.text(v.label, pad + 62, y + 22, { size: 44, weight: 700, color: v.css });
      y += 80;
    } else y += 20;
    for (const line of read?.lines || []) {
      ui.text(line, pad, y, { size: 31, maxWidth: w - pad * 2 });
      y += 42;
    }
    if (read?.risk) ui.text(read.risk, pad, y + 4, { size: 30, color: '#f0c987', maxWidth: w - pad * 2 });
    ui.button('close', 'Close', w - pad - 200, h - 118, 200, 84, () => app.closeCard('reveal'), { icon: '✕' });
  };
}

export function messageDraw(app, key, title, body, buttons = []) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text(title, pad, 76, { size: 36, weight: 600, color: UI.accent });
    ui.para(body, pad, 140, w - pad * 2, { size: 33, maxLines: 6 });
    const all = [...buttons, { id: 'close', label: 'Close', onPress: () => app.closeCard(key) }];
    const bw = Math.min(260, (w - pad * 2 - 20 * (all.length - 1)) / all.length);
    all.forEach((b, i) => ui.button(b.id, b.label, w - pad - (all.length - i) * (bw + 20) + 20, h - 118, bw, 84, b.onPress, { primary: !!b.primary }));
  };
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
