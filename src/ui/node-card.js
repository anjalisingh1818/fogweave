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

const DOSSIER_TYPES = new Set(['Place', 'Organisation', 'PublicFigure', 'Topic', 'Technology', 'Event', 'Concept']);
const CONTEXT_TYPES = new Set(['NewsItem', 'Event']);
const LABEL_RANK = { reported: 0, inferred: 1, speculative: 2 };

/** "How it relates": the link to the news (or to what it grew from) in plain words. */
export function relationBrief(app, id) {
  const node = app.store.nodes.get(id);
  if (!node) return null;
  let best = null;
  for (const e of app.store.edges.values()) {
    if (e.from !== id && e.to !== id) continue;
    const otherId = e.from === id ? e.to : e.from;
    const other = app.store.nodes.get(otherId);
    if (!other || other.type === 'ContextNode' || other.type === 'Claim' || other.type === 'Source') continue;
    const score = (otherId === node.addedBy ? 0 : CONTEXT_TYPES.has(other.type) ? 10 : 20) + (LABEL_RANK[e.label] ?? 3);
    if (!best || score < best.score) best = { e, other, incoming: e.to === id, score };
  }
  if (!best) return { text: 'No clear relation found.', label: null };
  const { e, other, incoming } = best;
  const X = other.label;
  const sure = e.label === 'reported';
  const IN = {
    involves: `Involved in: ${X}`,
    happened_in: `Where it happened: ${X}`,
    mentions: `Named in: ${X}`,
    about: `What this is about: ${X}`,
    affects: sure ? `Affected by: ${X}` : `May be affected by: ${X}`,
    depends_on: `${X} depends on it`,
    part_of: `${X} is part of it`,
    competes_with: `Competes with: ${X}`,
    follows: `Came before: ${X}`,
    supports: `Supported by: ${X}`,
    contradicts: `Contradicted by: ${X}`,
    relates_to: `May relate to: ${X}`,
  };
  const OUT = {
    involves: `Involves: ${X}`,
    happened_in: `Happened in: ${X}`,
    mentions: `Names: ${X}`,
    about: `About: ${X}`,
    affects: sure ? `Affects: ${X}` : `May affect: ${X}`,
    depends_on: `Depends on: ${X}`,
    part_of: `Part of: ${X}`,
    competes_with: `Competes with: ${X}`,
    follows: `Follows: ${X}`,
    supports: `Supports: ${X}`,
    contradicts: `Contradicts: ${X}`,
    relates_to: `May relate to: ${X}`,
  };
  const text = (incoming ? IN : OUT)[e.type] || `${REL_TEXT[e.type] || e.type}: ${X}`;
  const ev = e.evidence?.[0];
  let why = '';
  if (sure && ev?.quote) why = `“${ev.quote}” — ${ev.source || ''}`;
  else if (e.reasoning) why = `${e.label === 'speculative' ? 'A guess: ' : 'Reasoning: '}${e.reasoning}`;
  return { text, why, label: e.label || 'reported' };
}

/** Relation types (V3 §7) as plain words, from the related item's side; X = the other news item. */
const NEWS_REL = {
  same_event: (X) => `Same event, another report: ${X}`,
  follow_up: (X) => `A later development of: ${X}`,
  background: (X) => `Background to: ${X}`,
  cause_of: (X) => `May have led to: ${X}`,
  effect_of: (X) => `May be a result of: ${X}`,
  precedent_of: (X) => `An earlier, similar case to: ${X}`,
  similar_pattern: (X) => `A similar pattern to: ${X}`,
  corroborates: (X) => `Confirms what this reports: ${X}`,
  contradicts: (X) => `Disagrees with: ${X}`,
  shares_entity: (X) => `Shares a name with: ${X}`,
  possible_consequence: (X) => `Could follow from: ${X}`,
};

/**
 * "How it relates" for a news item linked to another news item by the
 * Relation Reasoner: the relation in plain words, the reason, and one quote
 * from each item (with its outlet).
 */
export function newsBrief(app, id) {
  if (app.store.nodes.get(id)?.group !== 'related') return null; // only a related item explains itself
  for (const e of app.store.edges.values()) {
    if (!e.relation || (e.from !== id && e.to !== id)) continue;
    const otherId = e.from === id ? e.to : e.from;
    const other = app.store.nodes.get(otherId);
    if (!other) continue;
    const make = NEWS_REL[e.relation];
    const text = make ? make(other.label) : `${e.relation.replace(/_/g, ' ')}: ${other.label}`;
    const ev = e.evidence || [];
    const mine = ev.find((x) => x.side === 'other'); // this card is the related item
    const theirs = ev.find((x) => x.side === 'focus');
    return { text, why: e.reasoning || '', label: e.label || 'inferred', quotes: [mine, theirs].filter(Boolean) };
  }
  return null;
}

/** A paragraph that never runs below `limit` (fewer lines, or none). */
function fit(ui, text, x, y, width, opts, limit) {
  const size = opts.size ?? 36;
  const lh = opts.lineHeight ?? 1.3;
  const room = Math.floor((limit - y - size * 0.25) / (size * lh)) + 1;
  const maxLines = Math.min(opts.maxLines ?? 99, room);
  if (maxLines < 1 || !text) return y;
  return ui.para(text, x, y, width, { ...opts, maxLines });
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
    const groups = app.hiddenGroups(id);
    const limit = h - (groups.length ? 292 : 222); // the button rows start below this
    let y = 76;
    const item = node.type === 'NewsItem' ? app.getItem(id) : null;
    // F9: a news item says what kind of source it is (news / paper / archive ...)
    const typeLabel = item ? sourceType(item).toUpperCase() : (TYPE_STYLE[node.type]?.label || node.type).toUpperCase();
    ui.text(typeLabel, pad, y, { size: 28, color: UI.dim, weight: 600 });
    if (node.type === 'Claim') {
      const v = VERDICT_STYLE[node.verdict || 'unverified'];
      ui.ringIcon(pad + 160, y - 11, 17, v.css, v.ring);
      ui.text(v.label, pad + 190, y, { size: 32, color: v.css, weight: 600 });
    }
    const badge = node.type === 'ContextNode' ? 'PRIVATE · ON DEVICE' : node.sealed ? 'SEALED' : item ? freshnessLabel(app, item) : 'IN THE FOG';
    ui.text(badge, w - pad, y, { size: 24, color: node.sealed ? UI.accent : UI.dim, weight: 600, align: 'right' });
    y += 58;
    y = fit(ui, node.label, pad, y, w - pad * 2, { size: 40, weight: 600, maxLines: 2, lineHeight: 1.16 }, limit);
    if (item) {
      // the real outlet and its date; the aggregator only as "found via"
      ui.text([item.source || node.outlet, item.date ? new Date(item.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '', item.via && item.via !== item.source ? `found via ${item.via}` : ''].filter(Boolean).join(' · '), pad, y + 2, { size: 24, color: UI.dim, maxWidth: w - pad * 2 });
      y += 34;
    }

    if (DOSSIER_TYPES.has(node.type)) {
      // 1. how it relates to the news (or to what it grew from)
      const brief = relationBrief(app, id);
      if (brief) {
        y += 8;
        const style = brief.label ? LABEL_STYLE[brief.label] : null;
        ui.text('HOW IT RELATES', pad, y, { size: 20, color: '#ffe2a8', weight: 700 });
        if (style) ui.text(style.label.toUpperCase(), w - pad, y, { size: 20, color: style.css, weight: 700, align: 'right' });
        y = fit(ui, brief.text, pad, y + 32, w - pad * 2, { size: 27, weight: 600, maxLines: 2 }, limit);
        if (brief.why) y = fit(ui, brief.why, pad, y, w - pad * 2, { size: 22, color: UI.dim, maxLines: 2 }, limit);
      }
      // 2. what it is (real information from the web, with its source)
      const d = node.dossier;
      const overview = d?.overview || node.definition || node.description;
      y += 10;
      if (y + 60 < limit) {
        ui.text('WHAT IT IS', pad, y + 6, { size: 20, color: '#ffe2a8', weight: 700 });
        y += 38;
        if (overview) {
          y = fit(ui, overview, pad, y, w - pad * 2, { size: 24, color: '#d3dae3', maxLines: 3 }, limit);
          const src = d?.overviewSource || (node.definitionUrl ? { url: node.definitionUrl, licence: node.definitionLicence } : null);
          if (src?.url && y + 24 < limit) {
            ui.text(`${src.licence || 'source'} · ${String(src.url).replace('https://', '')}`, pad, y + 2, { size: 19, color: '#8fb7e6', maxWidth: w - pad * 2 });
            y += 30;
          }
        } else {
          const msg =
            d?.kind === 'effect'
              ? 'A possible effect named by the analysis, not a thing with its own encyclopedia entry. How it relates (above) says why it is here.'
              : d && !d.found
                ? d.note || 'Not enough information found in open sources.'
                : 'Looking it up…';
          y = fit(ui, msg, pad, y, w - pad * 2, { size: 23, color: UI.dim, maxLines: 2 }, limit);
        }
      }
      // 3. key facts (each a sourced statement, with its date when known)
      const facts = (d?.facts || []).slice(0, 4);
      if (facts.length && y + 60 < limit) {
        ui.text(d.kind === 'event' ? 'WHAT THE REPORTING SAYS' : 'KEY FACTS', pad, y + 10, { size: 20, color: '#ffe2a8', weight: 700 });
        ui.text(d.kind === 'event' ? 'news' : 'Wikidata', w - pad, y + 10, { size: 19, color: '#8fb7e6', align: 'right' });
        y += 42;
        for (const f of facts) {
          if (y + 24 > limit) break;
          const date = f.date && d.kind !== 'event' && !String(f.value).includes(f.date.slice(0, 4)) ? ` (${f.date})` : '';
          y = fit(ui, `· ${f.label}: ${f.value}${date}`, pad, y, w - pad * 2, { size: 23, maxLines: 2, lineHeight: 1.25 }, limit) + 4;
        }
      }
    } else if (node.type === 'NewsItem' && newsBrief(app, id)) {
      // a related news item: how it relates to the story, with one quote from each
      const brief = newsBrief(app, id);
      const style = LABEL_STYLE[brief.label] || LABEL_STYLE.inferred;
      y += 8;
      ui.text('HOW IT RELATES', pad, y, { size: 20, color: '#ffe2a8', weight: 700 });
      ui.text(style.label.toUpperCase(), w - pad, y, { size: 20, color: style.css, weight: 700, align: 'right' });
      y = fit(ui, brief.text, pad, y + 32, w - pad * 2, { size: 26, weight: 600, maxLines: 2 }, limit);
      if (brief.why) y = fit(ui, brief.why, pad, y, w - pad * 2, { size: 22, color: UI.dim, maxLines: 2 }, limit);
      for (const q of brief.quotes) {
        if (y + 40 > limit) break;
        y = fit(ui, `“${q.quote}” — ${q.source || ''}`, pad + 18, y + 4, w - pad * 2 - 18, { size: 21, color: '#cdd5df', maxLines: 2 }, limit);
      }
      if (node.summary && y + 60 < limit) {
        ui.text('WHAT IT SAYS', pad, y + 14, { size: 20, color: '#ffe2a8', weight: 700 });
        y = fit(ui, node.summary, pad, y + 46, w - pad * 2, { size: 23, color: '#d3dae3', maxLines: 3 }, limit);
      }
    } else if (node.type === 'Claim' && node.quote) y = fit(ui, `“${node.quote}”`, pad, y + 2, w - pad * 2, { size: 29, color: '#cdd5df', maxLines: 2 }, limit);
    else if (node.definition) y = fit(ui, node.definition, pad, y + 2, w - pad * 2, { size: 26, color: '#cdd5df', maxLines: 3 }, limit);
    else if (node.description) y = fit(ui, node.description, pad, y + 2, w - pad * 2, { size: 28, color: UI.dim, maxLines: 1 }, limit);
    else if (node.type === 'NewsItem' && node.summary) y = fit(ui, node.summary, pad, y + 2, w - pad * 2, { size: 26, color: '#cdd5df', maxLines: 2 }, limit);

    if (y + 30 < limit) {
      if (node.explored === 'running') {
        ui.text('Opening the world around it…', pad, y + 26, { size: 23, color: UI.dim });
        y += 34;
      } else if (node.addedIds?.length) {
        const groups = {};
        for (const x of node.addedIds) {
          const g = app.store.nodes.get(x)?.group || 'other';
          groups[g] = (groups[g] || 0) + 1;
        }
        const GROUP_NAMES = { archive: 'older news', news: 'recent news', datasets: 'datasets', filings: 'filings' };
        ui.text(Object.entries(groups).map(([g, c]) => `${c} ${GROUP_NAMES[g] || g}`).join(' · '), pad, y + 26, { size: 22, color: '#ffe2a8', maxWidth: w - pad * 2 });
        y += 34;
      }
    }

    // claims and news: the evidence readout and the labelled links (entities say this in their brief)
    if (!DOSSIER_TYPES.has(node.type) && !newsBrief(app, id)) {
      const read = evidenceReadout(app.store, id);
      if (read) {
        y += 6;
        for (const line of read.lines.slice(0, node.type === 'Claim' ? 3 : 2)) {
          if (y + 34 > limit) break;
          ui.text(line, pad, y + 26, { size: 26, maxWidth: w - pad * 2 });
          y += 36;
        }
        if (read.risk && y + 34 <= limit) {
          ui.text(read.risk, pad, y + 26, { size: 25, color: '#f0c987', maxWidth: w - pad * 2 });
          y += 36;
        }
      }
      const links = whyLinks(app, id).slice(0, 2);
      if (links.length && y + 80 < limit) {
        ui.rule(y + 18);
        y += 54;
        for (const { e, other, incoming } of links) {
          if (y + 30 > limit) break;
          const style = LABEL_STYLE[e.label] || LABEL_STYLE.reported;
          const rel = REL_TEXT[e.type] || e.type;
          const head = incoming ? `${other.label} → ${rel}` : `${rel} → ${other.label}`;
          ui.text(style.label.toUpperCase(), pad, y, { size: 21, color: style.css, weight: 700 });
          ui.text(head, pad + 150, y, { size: 25, maxWidth: w - pad * 2 - 150 });
          const why = e.label === 'reported' ? e.evidence?.[0]?.quote && `“${e.evidence[0].quote}” — ${e.evidence[0].source || ''}` : e.reasoning;
          if (why && y + 62 <= limit) {
            ui.text(why, pad + 150, y + 30, { size: 21, color: UI.dim, maxWidth: w - pad * 2 - 150 });
            y += 28;
          }
          y += 42;
        }
      }
    }

    // small row: trail / show more / pin / collapse / expand a news node
    const small = [];
    if (app.trail.length >= 2) small.push({ id: 'back', label: '‹ Back', on: () => app.back() });
    if (node.type === 'NewsItem' && app.canExpand(id) && !app.getItem(id)?.expanded) small.push({ id: 'expand', label: 'Show related', on: () => app.expandLight(id) });
    small.push({ id: 'pin', label: node.pinned ? 'Unpin' : 'Pin', on: () => app.togglePin(id) });
    if (node.addedIds?.length) small.push({ id: 'collapse', label: 'Collapse', on: () => app.collapse(id) });
    // more around it, by kind: "+3 People", "+4 Places" ... (the closest few are already shown)
    if (groups.length) {
      const chips = groups.slice(0, 3).map((g) => ({ id: `grp:${g.key}`, label: `+${g.ids.length} ${g.label}`, on: () => app.showGroup(id, g.key) }));
      if (groups.length > 1) chips.push({ id: 'grp:all', label: `All ${groups.reduce((s, g) => s + g.ids.length, 0)}`, on: () => app.showGroup(id, 'all') });
      const cw = (w - pad * 2 - 12 * (chips.length - 1)) / Math.max(4, chips.length);
      chips.forEach((b, i) => ui.button(b.id, b.label, pad + i * (cw + 12), h - 270, cw, 58, b.on, { size: 22 }));
    }
    const sw = (w - pad * 2 - 12 * (small.length - 1)) / Math.max(4, small.length);
    small.forEach((b, i) => ui.button(b.id, b.label, pad + i * (sw + 12), h - 200, sw, 58, b.on, { size: 22 }));

    // actions
    const by = h - 122;
    const buttons = [];
    if (node.type !== 'ContextNode') {
      buttons.push(node.sealed ? { id: 'unseal', label: 'Unseal', icon: '◇', on: () => app.unseal(id) } : { id: 'seal', label: 'Seal', icon: '◆', primary: true, on: () => app.seal(id) });
    }
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
