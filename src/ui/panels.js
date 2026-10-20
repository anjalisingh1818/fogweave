/**
 * Phase 3 cards: answers (with citations), workspace panels (Notes, Lights),
 * settings, the story timeline, the daily briefing, export and insights.
 * Hands only: every action is a pinchable button; typing uses the keypad.
 */
import { UI } from '../render/card.js';
import { LIGHT_KINDS, ageMark } from '../render/lights.js';
import { LABEL_STYLE } from '../model/schema.js';
import { settings } from '../config.js';
import { speech } from '../audio.js';

export const ASK_SUGGESTIONS = ['What changes because of this?', 'Who is affected?', 'What happened before this?', 'Is this reliable?'];

function pinRow(app, key, ui, w, y) {
  const e = app.cards.entry(key);
  const pad = 44;
  ui.button('pin', e?.pinned ? 'Unpin' : 'Pin', w - pad - 330, y, 150, 64, () => app.cards.setPinned(key, !e?.pinned), { size: 26, primary: !e?.pinned });
  ui.button('move', 'Move', w - pad - 170, y, 150, 64, () => app.cards.move(key), { size: 26 });
}

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
    ui.button('close', 'Close', w - pad - 200, by, 200, 80, () => app.closeCard('answer'), { icon: '✕', size: 28 });
  };
}

export function notesDraw(app) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text('NOTES', pad, 66, { size: 28, color: UI.accent, weight: 700 });
    pinRow(app, 'notes', ui, w, 26);
    let y = 130;
    const notes = app.notes;
    if (!notes.length) ui.para('Type short notes with the keypad. They stay on this device and go into the Evidence Pack.', pad, y, w - pad * 2, { size: 28, color: UI.dim, maxLines: 3 });
    notes.slice(-6).forEach((n, i) => {
      const idx = notes.length - Math.min(6, notes.length) + i;
      ui.text(`· ${n.text}`, pad, y + 30, { size: 27, maxWidth: w - pad * 2 - 80 });
      ui.button(`rm:${idx}`, '✕', w - pad - 64, y, 60, 50, () => app.removeNote(idx), { size: 24 });
      y += 60;
    });
    ui.button('add', 'Add note', pad, h - 110, 240, 80, () => app.openKeypad('note'), { primary: true, size: 28 });
    ui.button('close', 'Close', w - pad - 200, h - 110, 200, 80, () => app.closeCard('notes'), { icon: '✕', size: 28 });
  };
}

export function lightsPanelDraw(app) {
  return (ctx, ui, w, h) => {
    const pad = 44;
    ui.text('LIGHTS · MOST RELEVANT', pad, 66, { size: 28, color: '#ffe2a8', weight: 700 });
    pinRow(app, 'lights', ui, w, 26);
    const items = [...app.lights.items].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0)).slice(0, 7);
    let y = 112;
    for (const it of items) {
      const k = LIGHT_KINDS[it.kind] || LIGHT_KINDS.breaking;
      ui.button(`open:${it.id}`, '', pad, y, w - pad * 2, 62, () => app.openLight(it.id), { size: 22 });
      ui.text(`${k.label} · ${ageMark(app.lights.ageDays(it))}`, pad + 16, y + 40, { size: 21, color: k.css, weight: 700 });
      ui.text(it.headline, pad + 190, y + 40, { size: 24, maxWidth: w - pad * 2 - 210 });
      y += 70;
    }
    ui.button('reshuffle', 'New lights', pad, h - 104, 240, 76, () => app.reshuffle(), { primary: true, size: 28 });
    ui.button('close', 'Close', w - pad - 200, h - 104, 200, 76, () => app.closeCard('lights'), { icon: '✕', size: 28 });
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

export function briefingDraw(app) {
  return (ctx, ui, w, h) => {
    const b = app.briefing;
    const pad = 44;
    if (!b) return;
    const left = Math.max(0, Math.ceil((b.endsAt - Date.now()) / 60000));
    if (b.done) {
      ui.text('BRIEFING DONE', pad, 70, { size: 30, color: UI.accent, weight: 700 });
      ui.para(`You looked at ${b.items.length} items and kept ${b.sealedCount}. Your Library has them.`, pad, 130, w - pad * 2, { size: 30, maxLines: 3 });
      ui.button('library', 'Library', pad, h - 110, 240, 80, () => app.openLibrary(), { primary: true, size: 28 });
      ui.button('close', 'Close', w - pad - 200, h - 110, 200, 80, () => app.endBriefing(), { icon: '✕', size: 28 });
      return;
    }
    const it = b.items[b.i];
    ui.text(`MORNING BRIEFING · ${b.i + 1} OF ${b.items.length} · ${left} MIN LEFT`, pad, 66, { size: 25, color: UI.accent, weight: 700 });
    if (it.outside) ui.text('OUTSIDE YOUR BUBBLE', w - pad, 66, { size: 22, color: '#9fe3ff', weight: 700, align: 'right' });
    let y = ui.para(it.headline, pad, 118, w - pad * 2, { size: 32, weight: 600, maxLines: 2 }) + 4;
    const thread = app.impactThread(it.id);
    if (thread.length) {
      ui.text('Possible effects (reported or inferred only):', pad, y + 20, { size: 23, color: UI.dim });
      y += 52;
      for (const t of thread.slice(0, 3)) {
        const s = LABEL_STYLE[t.label];
        ui.text(`${s.label}: ${t.text}`, pad, y, { size: 24, color: s.css, maxWidth: w - pad * 2 });
        y += 34;
      }
    } else ui.text('No grounded effects mapped yet. Expand it to look.', pad, y + 20, { size: 24, color: UI.dim, maxWidth: w - pad * 2 });
    const by = h - 110;
    const bw = (w - pad * 2 - 40) / 3;
    const kept = app.lights.sealed.has(it.id);
    ui.button('seal', kept ? 'Kept' : 'Keep', pad, by, bw, 80, () => app.briefingKeep(), { primary: !kept, disabled: kept, icon: '◆', size: 28 });
    ui.button('next', b.i + 1 < b.items.length ? 'Next' : 'Finish', pad + bw + 20, by, bw, 80, () => app.briefingNext(), { size: 28 });
    ui.button('stop', 'End', pad + (bw + 20) * 2, by, bw, 80, () => app.endBriefing(), { size: 28 });
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
