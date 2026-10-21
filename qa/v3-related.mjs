// Related news (V3 §2.4-2.5, F1): around a star, OTHER news appears (recent
// and older), each linked by a typed relation with a label and two quotes
// (one from each item); touching one shows "How it relates" with both quotes.
//   node qa/v3-related.mjs [live|offline]   (default live)
import { writeFileSync } from 'node:fs';
import { launch, open, enterXR, shot, errorsOf, OUT } from './lib.mjs';

const mode = process.argv[2] === 'offline' ? 'offline' : 'live';
const results = [];
const { browser, context, page, logs } = await launch();
const ev = (fn, a) => page.evaluate(fn, a);
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, ms: Date.now() - t0, detail });
    console.log(`PASS  [${mode}] ${name}  ${JSON.stringify(detail ?? '').slice(0, 600)}`);
  } catch (err) {
    results.push({ name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
    console.log(`FAIL  [${mode}] ${name}  ${String(err.message || err).slice(0, 600)}`);
    await shot(page, `v3r-fail-${mode}-${name.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
  }
};

const RELATED = () => {
  const a = window.__fw.app;
  const rel = [...a.store.edges.values()].filter((e) => e.relation);
  return rel.map((e) => {
    const otherId = a.store.nodes.get(e.from)?.group === 'related' ? e.from : e.to;
    const o = a.store.nodes.get(otherId) || {};
    return { id: otherId, relation: e.relation, label: e.label, quotes: (e.evidence || []).filter((x) => x.quote).length, date: String(o.date || '').slice(0, 10), older: o.kind === 'archive', title: String(o.label || '').slice(0, 60) };
  });
};

try {
  if (mode === 'offline') await context.route('http://localhost:8787/**', (r) => r.abort());
  await open(page, mode === 'offline' ? { query: '?debug&demo' } : {});
  await enterXR(page);
  await page.waitForFunction(() => window.__fw.app.mode !== 'starting' && window.__fw.app.lights.items.length > 0, null, { timeout: 150000 });
  await ev(() => {
    window.__fw.app.onboarding.finish();
    window.__fw.app.cards.closeAll();
  });

  let rows = [];
  await step('a star grows: other news appears, each with a typed, labelled link and two quotes', async () => {
    const stars = await ev((m) => {
      const a = window.__fw.app;
      return a.lights.items.filter((x) => (m === 'offline' ? a.snapshot.expansions[x.id] : x.via === 'wikipedia' && a.canExpand(x.id))).map((x) => x.id);
    }, mode);
    const seen = [];
    for (const id of stars.slice(0, 4)) {
      await ev((x) => window.__fw.app.openLight(x), id);
      await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, id, { timeout: 200000 });
      rows = await ev(RELATED);
      seen.push({ star: id, related: rows.length });
      if (rows.length >= 2) break;
    }
    await shot(page, `v3r-${mode}-1-related`);
    if (rows.length < 2) throw new Error(`fewer than 2 related news items: ${JSON.stringify(seen)}`);
    const bad = rows.filter((r) => r.quotes < 2 || !r.label);
    if (bad.length) throw new Error(`links without two quotes or a label: ${JSON.stringify(bad)}`);
    const kinds = {};
    for (const r of rows) kinds[r.relation] = (kinds[r.relation] || 0) + 1;
    return { related: rows.length, older: rows.filter((r) => r.older).length, kinds, sample: rows.slice(0, 4).map((r) => `${r.relation}/${r.label} ${r.date} ${r.title}`) };
  });

  await step('touching a related item: its card says how it relates, with both quotes', async () => {
    const id = rows.find((r) => r.relation !== 'shares_entity')?.id || rows[0].id;
    await ev(() => window.__fw.app.cards.closeAll());
    await ev((x) => window.__fw.app.pinchNode(x), id);
    await page.waitForTimeout(500);
    const r = await ev((x) => {
      const c = window.__fw.app.cards.get(`node:${x}`);
      const texts = c.boxes.filter((b) => b.kind !== 'button').map((b) => b.text);
      const boxes = c.boxes.filter((b) => b.w > 0 && b.h > 0);
      let overlaps = 0;
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const p = boxes[i];
          const q = boxes[j];
          if (Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 2 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 2) overlaps++;
        }
      return { how: texts.includes('HOW IT RELATES'), quotes: texts.filter((t) => t.startsWith('“')).length, overlaps, brief: texts[texts.indexOf('HOW IT RELATES') + 2] };
    }, id);
    await shot(page, `v3r-${mode}-2-related-card`);
    if (!r.how || r.quotes < 2 || r.overlaps) throw new Error(JSON.stringify(r));
    return r;
  });

  await step('no console errors', async () => {
    const errs = errorsOf(logs).filter((l) => mode !== 'offline' || !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
    if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
    return { messages: logs.length };
  });
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/v3-related-${mode}.json`, JSON.stringify({ when: new Date().toISOString(), mode, scripted: true, results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} passed (${mode}; scripted IWER hands, headless Chromium; not a real Quest)`);
process.exit(passed === results.length ? 0 : 1);
