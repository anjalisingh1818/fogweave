/**
 * Content for the node card, reveal cards, path cards and messages.
 * Every number shown comes with what it is made of; every link shows its
 * label (Reported / Inferred / Speculative) and its quote or reasoning.
 */
import { VERDICT_STYLE, TYPE_STYLE, LABEL_STYLE } from '../model/schema.js';
import { sourceType, freshnessLabel } from './reader-card.js';
import { evidenceReadout } from '../model/algorithms.js';
import { UI } from '../render/card.js';

const REL_TEXT = {
  mentions: 'mentioned by',
  about: 'what the story is about',
  reports: 'reported by',
  happened_in: 'happened in',
  involves: 'involves',
  affects: 'affects',
  depends_on: 'depends on',
  part_of: 'part of',
  competes_with: 'competes with',
  follows: 'follows',
  supports: 'supports',
  contradicts: 'contradicts',
  same_as: 'same as your context',
  relates_to: 'may relate to',
};

/** Links that explain why a node is here: impact links first, then others. */
function whyLinks(app, id) {
  const out = [];
  // a news item's effects hang off the event it is about: show those too
  const node = app.store.nodes.get(id);
  const about = node?.type === 'NewsItem' ? [...app.store.edges.values()].filter((e) => e.from === id && e.type === 'about').map((e) => e.to) : [];
  const ids = new Set([id, ...about]);
  for (const e of app.store.edges.values()) {
    if (!ids.has(e.to) && !ids.has(e.from)) continue;
    if (e.type === 'about' && about.length) continue;
    if (e.type === 'mentions' || e.type === 'reports') continue;
    const incoming = ids.has(e.to);
    const other = app.store.nodes.get(incoming ? e.from : e.to);
    if (!other || ids.has(other.id)) continue;
    const rank = { affects: 0, depends_on: 0, contradicts: 1, supports: 1, same_as: 2 }[e.type] ?? 3;
    out.push({ e, other, incoming, rank });
  }
  return out.sort((a, b) => a.rank - b.rank || (a.e.label === 'speculative') - (b.e.label === 'speculative'));
}

export function nodeCardDraw(app, id) {
  return (ctx, ui, w, h) => {
    const node = app.store.nodes.get(id);
    const pad = 48;
    if (!node) {
      ui.text('This item left the fog.', pad, 110, { size: 40, color: UI.dim });
      ui.button('close', 'Close', w - 260, h - 130, 210, 90, () => app.closeCard(`node:${id}`));
      return;
    }
    let y = 76;
    const item = node.type === 'NewsItem' ? app.getItem(id) : null;
    // F9: a news item says what kind of source it is (news / paper / archive ...)
    const typeLabel = item ? sourceType(item).toUpperCase() : (TYPE_STYLE[node.type]?.label || node.type).toUpperCase();
    ui.text(typeLabel, pad, y, { size: 30, color: UI.dim, weight: 600 });
    if (node.type === 'Claim') {
      const v = VERDICT_STYLE[node.verdict || 'unverified'];
      ui.ringIcon(pad + 160, y - 11, 17, v.css, v.ring);
      ui.text(v.label, pad + 190, y, { size: 32, color: v.css, weight: 600 });
    }
    const badge = node.type === 'ContextNode' ? 'PRIVATE · ON DEVICE' : node.sealed ? 'SEALED' : item ? freshnessLabel(app, item) : 'IN THE FOG';
    ui.text(badge, w - pad, y, { size: 26, color: node.sealed ? UI.accent : UI.dim, weight: 600, align: 'right' });
    y += 62;
    y = ui.para(node.label, pad, y, w - pad * 2, { size: 42, weight: 600, maxLines: 2, lineHeight: 1.18 });
    if (item) {
      // the real outlet and its date; the aggregator only as "found via"
      ui.text([item.source || node.outlet, item.date ? new Date(item.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '', item.via && item.via !== item.source ? `found via ${item.via}` : ''].filter(Boolean).join(' · '), pad, y + 2, { size: 24, color: UI.dim, maxWidth: w - pad * 2 });
      y += 34;
    }

    if (node.type === 'Claim' && node.quote) y = ui.para(`“${node.quote}”`, pad, y + 2, w - pad * 2, { size: 29, color: '#cdd5df', maxLines: 2 });
    else if (node.definition) {
      // what it is / where it comes from (open reference, attributed)
      y = ui.para(node.definition, pad, y + 2, w - pad * 2, { size: 26, color: '#cdd5df', maxLines: 3 });
      if (node.origin) y = ui.para(`Origin: ${node.origin}`, pad, y, w - pad * 2, { size: 23, color: UI.dim, maxLines: 2 });
      ui.text(`${node.definitionLicence || 'Wikipedia'} · ${String(node.definitionUrl || '').replace('https://', '')}`, pad, y + 4, { size: 20, color: '#8fb7e6', maxWidth: w - pad * 2 });
      y += 26;
    } else if (node.description) y = ui.para(node.description, pad, y + 2, w - pad * 2, { size: 28, color: UI.dim, maxLines: 1 });
    else if (node.type === 'NewsItem' && node.summary) y = ui.para(node.summary, pad, y + 2, w - pad * 2, { size: 26, color: '#cdd5df', maxLines: 2 });
    if (node.explored === 'running') {
      ui.text('Opening the world around it…', pad, y + 26, { size: 24, color: UI.dim });
      y += 34;
    } else if (node.addedIds?.length) {
      const groups = {};
      for (const x of node.addedIds) {
        const g = app.store.nodes.get(x)?.group || 'other';
        groups[g] = (groups[g] || 0) + 1;
      }
      ui.text(Object.entries(groups).map(([g, c]) => `${c} ${g}`).join(' · '), pad, y + 26, { size: 23, color: '#ffe2a8', maxWidth: w - pad * 2 });
      y += 34;
    } else if (node.explored === true && !node.definition) {
      // say so plainly rather than leaving the card silent
      ui.text('Nothing more found in open sources (Wikipedia, Wikidata, recent news, papers).', pad, y + 26, { size: 22, color: UI.dim, maxWidth: w - pad * 2 });
      y += 34;
    }

    const read = evidenceReadout(app.store, id);
    if (read) {
      y += 6;
      for (const line of read.lines.slice(0, node.type === 'Claim' ? 3 : 2)) {
        ui.text(line, pad, y + 26, { size: 28, maxWidth: w - pad * 2 });
        y += 38;
      }
      if (read.risk) {
        ui.text(read.risk, pad, y + 26, { size: 27, color: '#f0c987', maxWidth: w - pad * 2 });
        y += 38;
      }
    }

    // why it is here: labelled links with quote or reasoning
    const links = whyLinks(app, id).slice(0, 2);
    if (links.length) {
      ui.rule(y + 18);
      y += 54;
      for (const { e, other, incoming } of links) {
        const style = LABEL_STYLE[e.label] || LABEL_STYLE.reported;
        const rel = REL_TEXT[e.type] || e.type;
        const head = incoming ? `${other.label} → ${rel}` : `${rel} → ${other.label}`;
        ui.text(style.label.toUpperCase(), pad, y, { size: 22, color: style.css, weight: 700 });
        ui.text(head, pad + 150, y, { size: 27, maxWidth: w - pad * 2 - 150 });
        const why = e.label === 'reported' ? e.evidence?.[0]?.quote && `“${e.evidence[0].quote}” — ${e.evidence[0].source || ''}` : e.reasoning;
        if (why) {
          ui.text(why, pad + 150, y + 32, { size: 23, color: UI.dim, maxWidth: w - pad * 2 - 150 });
          y += 30;
        }
        y += 44;
      }
    }

    // small row: trail / show more / pin / collapse / expand a news node
    const small = [];
    if (app.trail.length >= 2) small.push({ id: 'back', label: '‹ Back', on: () => app.back() });
    const more = app.hiddenCount(id);
    if (more) small.push({ id: 'more', label: `Show ${Math.min(8, more)} more`, on: () => app.showMore(id) });
    if (node.type === 'NewsItem' && app.canExpand(id) && !app.getItem(id)?.expanded) small.push({ id: 'expand', label: 'Expand', on: () => app.expandLight(id) });
    small.push({ id: 'pin', label: node.pinned ? 'Unpin' : 'Pin', on: () => app.togglePin(id) });
    if (node.addedIds?.length) small.push({ id: 'collapse', label: 'Collapse', on: () => app.collapse(id) });
    const sw = (w - pad * 2 - 12 * (small.length - 1)) / Math.max(4, small.length);
    small.forEach((b, i) => ui.button(b.id, b.label, pad + i * (sw + 12), h - 200, sw, 58, b.on, { size: 22 }));

    // actions
    const by = h - 122;
    const buttons = [];
    if (node.type !== 'ContextNode') {
      buttons.push(node.sealed ? { id: 'unseal', label: 'Unseal', icon: '◇', on: () => app.unseal(id) } : { id: 'seal', label: 'Seal', icon: '◆', primary: true, on: () => app.seal(id) });
    }
    if (node.type === 'NewsItem') buttons.push({ id: 'touch', label: 'Touches me?', on: () => app.touchesMe(id) });
    if (node.type !== 'ContextNode' && node.type !== 'Source') buttons.push({ id: 'ask', label: 'Ask', on: () => app.openAsk(id) });
    const linking = app.linkFromId && app.linkFromId !== id;
    buttons.push({ id: 'link', label: linking ? 'Path here' : app.linkFromId === id ? 'Linking…' : 'Link', primary: linking, on: () => app.link(id) });
    buttons.push({ id: 'close', label: 'Close', icon: '✕', on: () => app.closeCard(`node:${id}`) });
    const bw = (w - pad * 2 - 20 * (buttons.length - 1)) / buttons.length;
    buttons.forEach((b, i) => ui.button(b.id, b.label, pad + i * (bw + 20), by, bw, 88, b.on, { primary: b.primary, icon: buttons.length > 4 ? null : b.icon, size: buttons.length > 4 ? 24 : buttons.length > 3 ? 28 : 32 }));
  };
}

export function pathDraw(app, path, title, note) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text(title, pad, 72, { size: 36, weight: 700, color: UI.accent });
    let y = 128;
    path.nodes.forEach((nid, i) => {
      const n = app.store.nodes.get(nid);
      ui.text(`${i + 1}. ${n?.label || nid}`, pad, y, { size: 30, weight: 600, maxWidth: w - pad * 2 });
      y += 38;
      const e = path.edges[i];
      if (e && y < h - 190) {
        const style = LABEL_STYLE[e.label || 'reported'];
        const why = e.label === 'inferred' ? e.reasoning : e.evidence?.[0]?.quote ? `“${e.evidence[0].quote}”` : '';
        ui.text(`↓ ${style.label}: ${REL_TEXT[e.type] || e.type}`, pad + 28, y, { size: 24, color: style.css, weight: 600, maxWidth: w - pad * 2 - 28 });
        if (why) ui.text(why, pad + 28, y + 28, { size: 22, color: UI.dim, maxWidth: w - pad * 2 - 28 });
        y += why ? 64 : 36;
      }
    });
    ui.text(note, pad, h - 140, { size: 24, color: '#f0c987', maxWidth: w - pad * 2 });
    ui.button('close', 'Close', w - pad - 200, h - 110, 200, 80, () => app.closeCard('path'), { icon: '✕' });
  };
}

export function locketDraw(app, id, imp, scope) {
  return (ctx, ui, w, h) => {
    const node = app.store.nodes.get(id);
    const pad = 44;
    ui.text(imp?.personal ? 'LOCKET · RELEVANCE TO YOU' : 'LOCKET · IMPORTANCE', pad, 72, { size: 30, color: '#e8cf86', weight: 600 });
    ui.para(node?.label || '', pad, 132, w - pad * 2, { size: 38, weight: 600, maxLines: 2 });
    if (!imp) {
      ui.para('Not part of this web yet.', pad, 260, w - pad * 2, { size: 34, color: UI.dim });
    } else {
      ui.text(`${ordinal(imp.rank)} of ${imp.of}`, pad, 272, { size: 72, weight: 700, color: '#f3e2b0' });
      ui.text(scope, pad + 360, 266, { size: 26, color: UI.dim, maxWidth: w - pad - 360 - pad });
      let y = 332;
      for (const why of imp.why) {
        ui.text(`· ${why}`, pad, y, { size: 30, maxWidth: w - pad * 2 });
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
      ui.text(line, pad, y, { size: 30, maxWidth: w - pad * 2 });
      y += 42;
    }
    if (read?.risk) ui.text(read.risk, pad, y + 4, { size: 29, color: '#f0c987', maxWidth: w - pad * 2 });
    ui.button('close', 'Close', w - pad - 200, h - 118, 200, 84, () => app.closeCard('reveal'), { icon: '✕' });
  };
}

export function messageDraw(app, key, title, body, buttons = []) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text(title, pad, 76, { size: 36, weight: 600, color: UI.accent });
    ui.para(body, pad, 140, w - pad * 2, { size: 32, maxLines: 6 });
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
