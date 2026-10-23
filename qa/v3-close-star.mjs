// Close on a star's news card: its web leaves the fog and it is a star again.
// Sealed items stay; touching the star again grows it again.
//   node qa/v3-close-star.mjs
import { writeFileSync } from 'node:fs';
import { launch, open, shot, errorsOf, OUT } from './lib.mjs';

const results = [];
const { browser, page, logs } = await launch();
const ev = (fn, a) => page.evaluate(fn, a);
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, ms: Date.now() - t0, detail });
    console.log(`PASS  ${name}  ${JSON.stringify(detail ?? '').slice(0, 400)}`);
  } catch (err) {
    results.push({ name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
    console.log(`FAIL  ${name}  ${String(err.message || err).slice(0, 400)}`);
    await shot(page, `v3cs-fail-${name.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
  }
};
const webOf = (id) =>
  ev((x) => {
    const a = window.__fw.app;
    return { nodes: a.store.nodes.size, star: a.store.nodes.has(x), expanded: a.getItem(x)?.expanded ?? null, card: !!a.cards.get(`light:${x}`) };
  }, id);

try {
  await open(page, { query: '?debug&demo' });
  await page.waitForFunction(() => window.__fw.app.mode === 'offline' && window.__fw.app.lights.items.length > 0, null, { timeout: 60000 });
  await ev(() => {
    window.__fw.app.onboarding.finish();
    window.__fw.app.cards.closeAll();
  });
  const id = await ev(() => window.__fw.app.lights.items.find((x) => window.__fw.app.snapshot.expansions[x.id]).id);
  let kept = null;

  await step('touch a star: its web grows in the fog', async () => {
    await ev((x) => window.__fw.app.openLight(x), id);
    await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, id, { timeout: 60000 });
    // keep one node of the web
    kept = await ev((x) => {
      const a = window.__fw.app;
      const k = a.store.nodes.get(x).addedIds.find((n) => a.store.nodes.get(n) && !a.store.nodes.get(n).hidden);
      a.seal(k);
      return k;
    }, id);
    const r = await webOf(id);
    await shot(page, 'v3cs-1-grown');
    if (r.nodes < 4 || !r.star || !r.card) throw new Error(JSON.stringify(r));
    return { ...r, sealed: kept };
  });

  await step('Close on the news card (by mouse): the web leaves, the sealed node stays', async () => {
    const p = await ev((x) => {
      const card = window.__fw.app.cards.get(`light:${x}`);
      const w = card.buttonWorldPosition('close');
      const v = w.clone().project(window.__fw.app.world.camera);
      const r = window.__fw.app.world.renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    }, id);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(300);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(800);
    const r = await webOf(id);
    const sealedStays = await ev((k) => !!window.__fw.app.store.nodes.get(k)?.sealed, kept);
    // closing a card is not a click on the fog: no "Ask about a topic" option
    const option = await ev(() => !!window.__fw.app._askOption && window.__fw.app._askOption.style.display !== 'none');
    if (option) throw new Error('the Ask option appeared after Close');
    await shot(page, 'v3cs-2-closed');
    if (r.card || r.expanded || !sealedStays) throw new Error(JSON.stringify({ ...r, sealedStays }));
    // only the sealed node (and anything sealed with it) is left of the web
    const left = await ev(() => [...window.__fw.app.store.nodes.values()].filter((n) => !n.sealed).length);
    return { ...r, sealedStays, unsealedLeft: left };
  });

  await step('the star is still drifting, and touching it grows it again', async () => {
    const inSky = await ev((x) => !!window.__fw.app.lights.get(x), id);
    await ev((x) => window.__fw.app.openLight(x), id);
    await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, id, { timeout: 60000 });
    const r = await webOf(id);
    if (!inSky || r.nodes < 4) throw new Error(JSON.stringify({ inSky, ...r }));
    return { inSky, ...r };
  });

  await step('no console errors', async () => {
    const errs = errorsOf(logs).filter((l) => !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
    if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
    return { messages: logs.length };
  });
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/v3-close-star.json`, JSON.stringify({ when: new Date().toISOString(), results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} passed (Playwright mouse on the flat page)`);
process.exit(passed === results.length ? 0 : 1);
