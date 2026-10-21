// Node information (V3 §2.5): around a star, every place, organisation,
// public figure, topic and event explains itself: how it relates, what it is
// (from the web, with its source), key facts. Effects named by the analysis
// say they are effects; nothing is left as an empty card.
//   node qa/v3-dossier.mjs [offline|live]   (offline = the Demo scene)
import { writeFileSync } from 'node:fs';
import { launch, open, enterXR, shot, errorsOf, OUT } from './lib.mjs';

const mode = process.argv[2] === 'live' ? 'live' : 'offline';
const results = [];
const { browser, context, page, logs } = await launch();
const ev = (fn, a) => page.evaluate(fn, a);
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, ms: Date.now() - t0, detail });
    console.log(`PASS  [${mode}] ${name}  ${JSON.stringify(detail ?? '').slice(0, 400)}`);
  } catch (err) {
    results.push({ name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
    console.log(`FAIL  [${mode}] ${name}  ${String(err.message || err).slice(0, 500)}`);
    await shot(page, `v3d-fail-${mode}-${name.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
  }
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

  let star;
  await step('a star grows; every node around it gets real information', async () => {
    star = await ev((m) => {
      const a = window.__fw.app;
      return a.lights.items.find((x) => (m === 'offline' ? a.snapshot.expansions[x.id] : x.via === 'wikipedia' && a.canExpand(x.id)))?.id;
    }, mode);
    if (!star) throw new Error('no star that can grow');
    await ev((id) => window.__fw.app.openLight(id), star);
    await page.waitForFunction((id) => window.__fw.app.getItem(id)?.expanded === true, star, { timeout: 200000 });
    // dossiers arrive in one batch after the web has grown
    await page.waitForFunction(() => [...window.__fw.app.store.nodes.values()].filter((n) => ['Place', 'Organisation', 'PublicFigure', 'Topic', 'Technology', 'Event', 'Concept'].includes(n.type)).every((n) => n.dossier || !n.dossierLoading), null, { timeout: 60000 });
    await page.waitForTimeout(500);
    const r = await ev(() => {
      const a = window.__fw.app;
      const ents = [...a.store.nodes.values()].filter((n) => ['Place', 'Organisation', 'PublicFigure', 'Topic', 'Technology', 'Event', 'Concept'].includes(n.type));
      const rows = ents.map((n) => ({
        label: n.label,
        type: n.type,
        kind: n.dossier?.kind || (n.derived ? 'effect' : 'thing'),
        overview: !!(n.dossier?.overview || n.definition),
        facts: (n.dossier?.facts || []).length,
        said: n.dossier?.kind === 'effect' ? 'effect' : n.dossier?.found === false ? 'not enough information' : n.dossier ? 'information' : 'nothing',
      }));
      return { nodes: rows.length, rows };
    });
    const things = r.rows.filter((x) => x.kind !== 'effect');
    const informed = things.filter((x) => x.overview).length;
    const silent = r.rows.filter((x) => x.said === 'nothing');
    if (silent.length) throw new Error(`no answer at all for: ${silent.map((x) => x.label).join(', ')}`);
    if (!things.length || informed / things.length < 0.5) throw new Error(JSON.stringify({ informed, of: things.length, rows: r.rows }).slice(0, 600));
    return { nodes: r.nodes, thingsWithInformation: `${informed}/${things.length}`, withFacts: things.filter((x) => x.facts).length, effects: r.rows.length - things.length, sample: things.filter((x) => x.overview).slice(0, 4).map((x) => `${x.type}: ${x.label} (${x.facts} facts)`) };
  });

  await step('touching a node by pinch: its card shows How it relates, What it is, Key facts; no overlaps', async () => {
    const ids = await ev(() => {
      const a = window.__fw.app;
      return [...a.store.nodes.values()].filter((n) => ['Place', 'Organisation', 'PublicFigure', 'Topic', 'Technology', 'Event'].includes(n.type) && (n.dossier?.overview || n.definition) && (n.dossier?.facts || []).length).map((n) => n.id);
    });
    if (!ids.length) throw new Error('no node with information and facts');
    const out = [];
    for (const id of ids.slice(0, 4)) {
      await ev(() => window.__fw.app.cards.closeAll());
      await ev((x) => window.__fw.app.pinchNode(x), id);
      await page.waitForTimeout(500);
      const r = await ev((x) => {
        const a = window.__fw.app;
        const c = a.cards.get(`node:${x}`);
        const texts = c.boxes.filter((b) => b.kind !== 'button').map((b) => b.text);
        const boxes = c.boxes.filter((b) => b.w > 0 && b.h > 0);
        let overlaps = 0;
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const p = boxes[i];
            const q = boxes[j];
            if (Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 2 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 2) overlaps++;
          }
        return { node: a.store.nodes.get(x).label, sections: ['HOW IT RELATES', 'WHAT IT IS', 'KEY FACTS', 'WHAT THE REPORTING SAYS'].filter((s) => texts.includes(s)), overlaps };
      }, id);
      out.push(r);
    }
    await shot(page, `v3d-${mode}-node-card`);
    const bad = out.filter((r) => r.overlaps || !r.sections.includes('HOW IT RELATES') || !r.sections.includes('WHAT IT IS'));
    if (bad.length) throw new Error(JSON.stringify(bad));
    return out;
  });

  await step('no console errors', async () => {
    const errs = errorsOf(logs).filter((l) => mode !== 'offline' || !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
    if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
    return { messages: logs.length };
  });
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/v3-dossier-${mode}.json`, JSON.stringify({ when: new Date().toISOString(), mode, scripted: true, results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} passed (${mode}; scripted IWER hands, headless Chromium; not a real Quest)`);
process.exit(passed === results.length ? 0 : 1);
