// Ask the fog on the flat page (mouse + keyboard): a click on the fog (not on a
// star) shows a small "Ask about a topic" option; pressing it opens Ask the fog;
// the computer keyboard types into it; Enter brings a cited answer and news as
// stars. A click on a star still opens the star.
//   node qa/v3-ask-click.mjs
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
    await shot(page, `v3ac-fail-${name.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
  }
};

try {
  await open(page, { query: '?debug&demo' });
  await page.waitForFunction(() => window.__fw.app.mode === 'offline' && window.__fw.app.lights.items.length > 0, null, { timeout: 60000 });
  await ev(() => {
    window.__fw.app.onboarding.finish();
    window.__fw.app.cards.closeAll();
  });
  await page.waitForTimeout(800);

  // a screen point in the fog, away from stars and nodes; and one on a star
  const pts = await ev(() => {
    const a = window.__fw.app;
    const c = a.world.renderer.domElement;
    const r = c.getBoundingClientRect();
    let fog = null;
    for (let y = r.height * 0.55; y < r.height * 0.9 && !fog; y += 20) for (let x = r.width * 0.25; x < r.width * 0.75 && !fog; x += 20) if (a.isEmptyAt(x, y, c)) fog = { x, y };
    const p = a.lights.worldPositionOf(a.lights.items[0].id, new a.anchor.head.constructor()).project(a.world.camera);
    return { fog, star: { x: ((p.x + 1) / 2) * r.width + r.left, y: ((1 - p.y) / 2) * r.height + r.top, id: a.lights.items[0].id } };
  });

  await step('a click on a star still opens the star (not the search)', async () => {
    await ev((id) => window.__fw.app.lights.pull([], 0), pts.star.id);
    await page.mouse.move(pts.star.x, pts.star.y);
    await page.waitForTimeout(300);
    await page.mouse.click(pts.star.x, pts.star.y);
    await page.waitForTimeout(700);
    const r = await ev(() => ({ keypad: window.__fw.app.keypad.isOpen, cards: window.__fw.app.cards.open.map((e) => e.key) }));
    if (r.keypad) throw new Error(`search opened on a star click: ${JSON.stringify(r)}`);
    await ev(() => window.__fw.app.cards.closeAll());
    return r;
  });

  const option = () => ev(() => {
    const b = window.__fw.app._askOption;
    if (!b || b.style.display === 'none') return null;
    const r = b.getBoundingClientRect();
    return { text: b.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  await step('a click on the fog shows a small "Ask about a topic" option', async () => {
    if (!pts.fog) throw new Error('no fog point found');
    await page.mouse.move(pts.fog.x, pts.fog.y);
    await page.waitForTimeout(300);
    await page.mouse.click(pts.fog.x, pts.fog.y);
    await page.waitForTimeout(600);
    const o = await option();
    const keypad = await ev(() => window.__fw.app.keypad.isOpen);
    await shot(page, 'v3ac-1-ask-option');
    if (!o || keypad) throw new Error(JSON.stringify({ o, keypad }));
    return o;
  });

  await step('pressing the option opens Ask the fog', async () => {
    const o = await option();
    await page.mouse.click(o.x, o.y);
    await page.waitForTimeout(600);
    const r = await ev(() => ({ keypad: window.__fw.app.keypad.isOpen, prompt: window.__fw.app.keypad.prompt }));
    await shot(page, 'v3ac-2-ask-opened');
    if (!r.keypad || !/^Ask the fog/.test(r.prompt)) throw new Error(JSON.stringify(r));
    return r;
  });

  await step('the computer keyboard types; Enter: a cited answer and news as stars', async () => {
    // a word from a recorded news item that is not drifting now (the Demo scene searches the recording)
    const word = await ev(() => {
      const a = window.__fw.app;
      const shown = new Set(a.lights.items.map((x) => x.id));
      const it = a.pool.find((x) => !shown.has(x.id) && /[A-Z][a-z]{5,}/.test(x.headline));
      return it.headline.match(/[A-Z][a-z]{5,}/)[0];
    });
    await page.keyboard.type(word, { delay: 40 });
    const typed = await ev(() => window.__fw.app.keypad.text);
    if (typed !== word) throw new Error(`typed "${typed}", expected "${word}"`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__fw.app.cards.get('answer') && window.__fw.app.searchGroup, null, { timeout: 30000 });
    const r = await ev(() => ({ q: window.__fw.app.searchGroup.q, stars: window.__fw.app.searchGroup.ids.length, keypadClosed: !window.__fw.app.keypad.isOpen }));
    await shot(page, 'v3ac-3-answer-and-stars');
    if (!r.stars || !r.keypadClosed) throw new Error(JSON.stringify(r));
    return { typed, ...r };
  });

  await step('the option goes away by itself; Escape closes the search', async () => {
    await page.mouse.click(pts.fog.x, pts.fog.y);
    await page.waitForTimeout(600);
    const shown = !!(await option());
    await page.waitForTimeout(5600);
    const gone = !(await option());
    if (!shown || !gone) throw new Error(JSON.stringify({ shown, gone }));
    await page.mouse.click(pts.fog.x, pts.fog.y);
    await page.waitForTimeout(600);
    const o = await option();
    await page.mouse.click(o.x, o.y);
    await page.waitForTimeout(600);
    const opened = await ev(() => window.__fw.app.keypad.isOpen);
    await page.keyboard.press('Escape');
    const closed = await ev(() => !window.__fw.app.keypad.isOpen);
    if (!opened || !closed) throw new Error(JSON.stringify({ opened, closed }));
    return { opened, closed };
  });

  await step('no console errors', async () => {
    const errs = errorsOf(logs).filter((l) => !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
    if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
    return { messages: logs.length };
  });
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/v3-ask-click.json`, JSON.stringify({ when: new Date().toISOString(), results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} passed (Playwright mouse and keyboard on the flat page)`);
process.exit(passed === results.length ? 0 : 1);
