/**
 * Cards: answers (with citations),
 * settings, the story timeline, export and insights.
 * Hands only: every action is a pinchable button; typing uses the keypad.
 */
import { UI } from '../render/card.js';
import { LIGHT_KINDS } from '../render/lights.js';
import { LABEL_STYLE } from '../model/schema.js';
import { settings } from '../config.js';
import { speech } from '../audio.js';

export const ASK_SUGGESTIONS = ['What changes because of this?', 'Who is affected?', 'What happened before this?', 'Is this reliable?'];

export function answerDraw(app, a) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text(a.local ? 'ANSWER · FROM THE EVIDENCE' : a.recorded ? `ANSWER · RECORDED ${String(a.recorded).slice(0, 10)}` : 'ANSWER', pad, 66, { size: 26, color: '#9cc7ff', weight: 700 });
    let y = ui.para(a.question, pad, 118, w - pad * 2, { size: 32, weight: 600, maxLines: 2 }) + 8;
    if (a.refused || !a.answerable) {
      y = ui.para(a.text, pad, y + 10, w - pad * 2, { size: 30, color: a.refused ? '#f0c987' : UI.text, maxLines: 4 });
    } else {
      for (const s of a.sentences) {
        if (y > h - 260) break;
        const marks = s.cites.map((c) => `[${c.slice(1)}]`).join('');
        const guess = s.kind === 'guess';
        y = ui.para(`${s.text} ${marks}${guess ? ' (guess)' : ''}`, pad, y, w - pad * 2, { size: 27, color: guess ? UI.dim : UI.text, maxLines: 3 }) + 4;
      }
    }
    // citation chips: pinch to see where it comes from
    const cites = Object.entries(a.citations || {}).slice(0, 6);
    const cw = (w - pad * 2 - 20 * 2) / 3;
    cites.forEach(([id, c], i) => {
      const x = pad + (i % 3) * (cw + 20);
      const yy = h - 250 + Math.floor(i / 3) * 66;
      const label = `${id.slice(1)} · ${c.source ? hostOf(c.source) : c.node || c.edge ? 'the web' : ''}`;
      ui.button(`cite:${id}`, label, x, yy, cw, 56, () => app.showCitation(a, id), { size: 22 });
    });
    if (!cites.length && a.answerable) ui.text('No citations returned.', pad, h - 220, { size: 24, color: UI.dim });
    const by = h - 110;
    const sealed = app.sealedAnswers.some((x) => x.question === a.question && x.text === a.text);
    ui.button('seal', sealed ? 'Kept' : 'Keep', pad, by, 200, 80, () => app.keepAnswer(a), { primary: !sealed, disabled: sealed || a.refused, icon: '◆', size: 28 });
    if (speech.available() && settings.audio.readAloud) ui.button('listen', 'Listen', pad + 220, by, 200, 80, () => speech.speak(`${a.question}. ${a.text}`), { size: 28 });
    // Ask the fog: the news it found arrived as stars
    const g = app.searchGroup;
    if (g && g.q === a.question) {
      const n = g.ids.length;
      ui.text(n ? `${n} star${n === 1 ? '' : 's'} about this came in front of you.` : 'No news stars found for this.', pad, by - 22, { size: 22, color: UI.dim, maxWidth: w - pad * 2 });
      if (n) ui.button('clearstars', 'Clear stars', w - pad - 420, by, 200, 80, () => app.clearSearch(), { size: 26 });
    }
    ui.button('close', 'Close', w - pad - 200, by, 200, 80, () => app.closeCard('answer'), { icon: '✕', size: 28 });
  };
}

export function settingsDraw(app) {
  const rows = [
    ['gentle', 'Gentle motion', () => settings.comfort.gentle, (v) => (settings.comfort.gentle = v)],
    ['ambient', 'Ambient sound', () => settings.audio.enabled, (v) => app.setAmbient(v)],
    ['readAloud', `Read aloud${speech.available() ? '' : ' (not available here)'}`, () => settings.audio.readAloud, (v) => (settings.audio.readAloud = v)],
    ['voice', `Voice input (optional)${app.voiceAvailable() ? '' : ' (not available here)'}`, () => settings.voice.enabled, (v) => (settings.voice.enabled = v)],
    ['fog', 'Props and paths include the fog', () => settings.layers.includeFog, (v) => (settings.layers.includeFog = v)],
  ];
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text('SETTINGS', pad, 66, { size: 28, color: UI.accent, weight: 700 });
    let y = 104;
    for (const [id, label, get, set] of rows) {
      const on = !!get();
      ui.text(label, pad, y + 44, { size: 28, maxWidth: w - pad * 2 - 200 });
      ui.button(`t:${id}`, on ? 'On' : 'Off', w - pad - 170, y, 170, 66, () => {
        set(!on);
        app.saveSettings();
        app.cards.get('settings')?.redraw();
      }, { primary: on, size: 28 });
      y += 82;
    }
    ui.button('tour', 'Tour', pad, h - 104, 200, 76, () => {
      app.closeCard('settings');
      app.startOnboarding();
    }, { size: 28 });
    ui.button('close', 'Close', w - pad - 200, h - 104, 200, 76, () => app.closeCard('settings'), { icon: '✕', size: 28 });
  };
}

export function timelineDraw(app, id) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    const items = app.storyMates(id, { includeSelf: true });
    ui.text(`SAME STORY · ${items.length} ITEMS · OLDEST FIRST`, pad, 66, { size: 26, color: UI.accent, weight: 700 });
    ui.text('Grouped by text similarity: related, not necessarily the same event.', pad, 104, { size: 22, color: UI.dim, maxWidth: w - pad * 2 });
    let y = 128;
    for (const it of items.slice(0, 6)) {
      const k = LIGHT_KINDS[it.kind] || LIGHT_KINDS.breaking;
      ui.button(`open:${it.id}`, '', pad, y, w - pad * 2, 62, () => app.openLight(it.id), { size: 22, primary: it.id === id });
      ui.text(`${String(it.date || '').slice(0, 10)}`, pad + 16, y + 40, { size: 22, color: k.css, weight: 700 });
      ui.text(it.headline, pad + 190, y + 40, { size: 24, maxWidth: w - pad * 2 - 210 });
      y += 70;
    }
    ui.button('close', 'Close', w - pad - 200, h - 104, 200, 76, () => app.closeCard('timeline'), { icon: '✕', size: 28 });
  };
}

export function exportDraw(app, r) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text('EVIDENCE PACK', pad, 66, { size: 28, color: UI.accent, weight: 700 });
    let y = 116;
    const lines = [
      `${r.counts.news} news · ${r.counts.claims} claims · ${r.counts.links} links · ${r.counts.answers} answers · ${r.counts.notes} notes`,
      `File: ${r.filename}`,
      r.validation
        ? `Checked on the server: ${r.validation.triples} RDF triples; SHACL ${r.validation.shacl.conforms ? 'conforms' : `found ${r.validation.shacl.violations} problem(s)`}`
        : 'Not checked: the validation server is unreachable (the pack is still complete).',
      r.validation ? `SPARQL: ${r.validation.sparql.single_source_claims.length} single-source claims, ${r.validation.sparql.contradicted_claims.length} contradicted, ${r.validation.sparql.two_hop_chains.length} two-hop chains` : '',
      r.downloaded ? 'Saved to your downloads.' : 'The browser blocked the download; try again from the flat page.',
      'Links and short quotes only. Your context is never included.',
    ].filter(Boolean);
    for (const l of lines) {
      y = ui.para(l, pad, y, w - pad * 2, { size: 26, maxLines: 2 }) + 6;
    }
    ui.button('close', 'Close', w - pad - 200, h - 104, 200, 76, () => app.closeCard('export'), { icon: '✕', size: 28 });
  };
}

const PATTERN_KIND = {
  shared: 'SHARED NAME',
  same_actor: 'SAME ACTOR',
  recurring: 'RECURRING',
  sequence: 'SEQUENCE',
  contrast: 'CONTRAST',
  common_theme: 'COMMON THEME',
};

/** Connect the dots: patterns across the Library, each with its items and a quote from each. */
export function patternsDraw(app, r) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text('PATTERNS IN YOUR LIBRARY', pad, 66, { size: 26, color: UI.accent, weight: 700 });
    let y = 104;
    const limit = h - 130;
    (r.patterns || []).forEach((p, i) => {
      if (y + 90 > limit) return;
      const style = LABEL_STYLE[p.label] || LABEL_STYLE.inferred;
      ui.text(PATTERN_KIND[p.kind] || p.kind.toUpperCase(), pad, y, { size: 20, color: '#ffe2a8', weight: 700 });
      ui.text(style.label.toUpperCase(), pad + 260, y, { size: 20, color: style.css, weight: 700 });
      ui.button(`show:${i}`, 'Show', w - pad - 250, y - 30, 120, 50, () => app.showPattern(p), { size: 22 });
      ui.button(`note:${i}`, 'Note', w - pad - 120, y - 30, 120, 50, () => app.addNote(`Pattern: ${p.text}`), { size: 22 });
      y = ui.para(p.text, pad, y + 34, w - pad * 2, { size: 25, weight: 600, maxLines: 2 }) + 2;
      const names = p.items.map((id) => app.itemLabel(id)).map((s) => (s.length > 34 ? `${s.slice(0, 33)}…` : s));
      y = ui.para(names.join(' · '), pad, y, w - pad * 2, { size: 21, color: UI.dim, maxLines: 2 }) + 2;
      const q = (p.quotes || [])[0];
      if (q && y + 30 < limit) y = ui.para(`“${q.quote}”`, pad, y, w - pad * 2, { size: 21, color: '#c8d3e0', maxLines: 1 }) + 2;
      y += 22;
    });
    if (!(r.patterns || []).length && !r.running) y = ui.para('No shared names among your items yet.', pad, y, w - pad * 2, { size: 25, color: UI.dim, maxLines: 2 }) + 8;
    if (r.note) ui.para(r.note, pad, Math.min(y, limit - 10), w - pad * 2 - 230, { size: 21, color: UI.dim, maxLines: 2 });
    ui.button('close', 'Close', w - pad - 200, h - 104, 200, 76, () => app.closeCard('patterns'), { icon: '✕', size: 28 });
  };
}

export function insightsDraw(app, list) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text('NOTICED IN THE WEB', pad, 66, { size: 26, color: '#f0c987', weight: 700 });
    let y = 96;
    list.slice(0, 5).forEach((ins, i) => {
      ui.button(`ins:${i}`, ins.text, pad, y, w - pad * 2, 66, () => app.showInsight(ins), { size: 24 });
      y += 78;
    });
    ui.button('close', 'Close', w - pad - 200, h - 104, 200, 76, () => app.closeCard('insights'), { icon: '✕', size: 28 });
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}
