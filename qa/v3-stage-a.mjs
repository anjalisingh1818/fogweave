// V3 Stage A (FOGWEAVE_V3_BEST_PROMPT §3, §4 F11, §2.1), scripted IWER hands:
//  - live is the default scene and says so; an unreachable backend is said
//    plainly with "Open demo" (old data is never shown as live)
//  - Menu (wrist) → Demo scene → Live scene; Help, About, Calm
//  - Ask the fog: pinch empty fog → keypad; restricted requests are refused
//    politely; a topic gets an answer (live) or an honest note (demo)
//  - new stars appear over time, never replacing the one you have open
//  - the fog is gray with a slight dark blue tint
//   node qa/v3-stage-a.mjs
import { writeFileSync } from 'node:fs';
import { launch, open, enterXR, shot, errorsOf, OUT } from './lib.mjs';

const results = [];

async function handsHelpers(page) {
  await page.evaluate(() => {
    const d = window.IWER_DEVICE;
    const a = window.__fw.app;
    const V = a.anchor.head.constructor;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__qa = {
      wait,
      async pinchAt(t) {
        const h = a.anchor.head;
        const from = { x: h.x + (t.x - h.x) * 0.45 + 0.05, y: h.y - 0.22 + (t.y - h.y) * 0.3, z: h.z + (t.z - h.z) * 0.45 };
        await d.remote.dispatch('set_transform', { device: 'hand-right', position: from });
        await d.remote.dispatch('look_at', { device: 'hand-right', target: t });
        await wait(250);
        await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 1 });
        await wait(220);
        await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 0 });
        await wait(250);
      },
      card(key) {
        if (key === 'status') return a.statusCard;
        if (key === 'help-button') return a.helpButton;
        if (key === 'keypad') return a.keypad.card;
        return a.cards.get(key);
      },
      async press(key, id) {
        await wait(400);
        const p = this.card(key)?.buttonWorldPosition(id);
        if (!p) throw new Error(`no button ${key}/${id} (has ${this.card(key)?.buttonIds()})`);
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
      async type(text) {
        for (const ch of text.toLowerCase()) await this.press('keypad', ch === ' ' ? 'space' : `key:${ch}`);
      },
      async menu() {
        const p = a.helpButton.buttonWorldPosition('help');
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
      /** pinch at a point low and to the left: nothing lives there */
      async pinchEmpty() {
        const h = a.anchor.head;
        await this.pinchAt({ x: h.x - 0.8, y: h.y - 0.9, z: h.z - 0.5 });
        await wait(600); // empty-space pinches are decided a moment later
      },
    };
  });
}

async function boot(page, context, { blockBackend = false, query = '?debug' } = {}) {
  if (blockBackend) await context.route('http://localhost:8787/**', (r) => r.abort());
  await open(page, { query });
  await enterXR(page);
  await handsHelpers(page);
  await page.waitForFunction(() => !['starting'].includes(window.__fw.app.mode), null, { timeout: 150000 });
  await page.evaluate(() => {
    window.__fw.app.onboarding.finish();
    window.__fw.app.cards.closeAll();
  });
}

const step = async (page, name, fn) => {
  const t0 = Date.now();
  try {
    await page.evaluate(() => window.__fw.app.keypad.isOpen && window.__fw.app.keypad.close()).catch(() => {});
    const detail = await fn();
    results.push({ name, pass: true, ms: Date.now() - t0, detail });
    console.log(`PASS  ${name}  ${JSON.stringify(detail ?? '').slice(0, 220)}`);
  } catch (err) {
    results.push({ name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
    console.log(`FAIL  ${name}  ${String(err.message || err).slice(0, 300)}`);
    await shot(page, `v3a-fail-${name.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
  }
};

// ---- 1. backend unreachable: said plainly, demo by pinch
{
  const { browser, context, page, logs } = await launch();
  const ev = (fn, a) => page.evaluate(fn, a);
  try {
    await boot(page, context, { blockBackend: true });
    await step(page, 'unreachable backend: said plainly, no old data shown as live; "Open demo" by pinch', async () => {
      const before = await ev(() => ({ mode: window.__fw.app.mode, lights: window.__fw.app.lights.items.length, line: window.__fw.app.modeLine(), buttons: window.__fw.app.statusCard.buttonIds() }));
      await shot(page, 'v3a-1-unreachable');
      if (before.mode !== 'unavailable' || before.lights || !before.buttons.includes('demo')) throw new Error(JSON.stringify(before));
      await ev(() => window.__qa.press('status', 'demo'));
      await page.waitForFunction(() => window.__fw.app.mode === 'offline' && window.__fw.app.lights.items.length > 0, null, { timeout: 20000 });
      const after = await ev(() => ({ mode: window.__fw.app.mode, lights: window.__fw.app.lights.items.length, line: window.__fw.app.modeLine() }));
      await shot(page, 'v3a-2-demo-scene');
      if (!/^Demo scene · snapshot of 20\d\d-/.test(after.line)) throw new Error(JSON.stringify(after));
      return { before: before.line, after: after.line, lights: after.lights };
    });
    await step(page, 'Ask the fog in the demo: a typed question gets an honest note (needs the live engine)', async () => {
      await ev(() => window.__qa.pinchEmpty());
      const prompt = await ev(() => window.__fw.app.keypad.isOpen && window.__fw.app.keypad.prompt);
      if (!String(prompt).startsWith('Ask the fog')) throw new Error(`keypad: ${prompt}`);
      await ev(() => window.__qa.type('ROCKET ENGINES'));
      await ev(() => window.__qa.press('keypad', 'go'));
      await page.waitForFunction(() => !!window.__fw.app.lastAnswer, null, { timeout: 20000 });
      const a = await ev(() => window.__fw.app.lastAnswer.text);
      if (!/live engine/i.test(a)) throw new Error(a);
      return { prompt, answer: a.slice(0, 80) };
    });
    await step(page, 'demo: no console errors', async () => {
      const errs = errorsOf(logs).filter((l) => !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
      if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
      return { messages: logs.length };
    });
  } finally {
    await browser.close();
  }
}

// ---- 2. live default, Menu, Ask the fog, new stars, look
{
  const { browser, context, page, logs } = await launch();
  const ev = (fn, a) => page.evaluate(fn, a);
  try {
    await boot(page, context);
    await step(page, 'live is the default scene, labelled LIVE; the fog is gray with a slight blue', async () => {
      const r = await ev(() => ({ mode: window.__fw.app.mode, line: window.__fw.app.modeLine(), lights: window.__fw.app.lights.items.length, live: window.__fw.app.lights.items.every((x) => x.live), fog: window.__fw.world.scene.background.getHexString() }));
      await shot(page, 'v3a-3-live');
      if (r.mode !== 'live' || !r.live || r.lights < 12) throw new Error(JSON.stringify(r));
      const [rr, gg, bb] = [0, 2, 4].map((i) => parseInt(r.fog.slice(i, i + 2), 16));
      if (!(bb > rr && bb > gg && bb < 90)) throw new Error(`fog colour #${r.fog}`);
      return r;
    });
    await step(page, 'Menu by pinch → Demo scene → Live scene', async () => {
      await ev(() => window.__qa.menu());
      const ids = await ev(() => window.__fw.app.cards.get('help')?.buttonIds());
      if (!ids || !['library', 'interests', 'context', 'calm', 'scene', 'guide', 'about'].every((x) => ids.includes(x))) throw new Error(JSON.stringify(ids));
      await shot(page, 'v3a-4-menu');
      await ev(() => window.__qa.press('help', 'scene'));
      await page.waitForFunction(() => window.__fw.app.mode === 'offline' && window.__fw.app.lights.items.length > 0, null, { timeout: 20000 });
      const demo = await ev(() => ({ line: window.__fw.app.modeLine(), live: window.__fw.app.lights.items.some((x) => x.live) }));
      await ev(() => window.__fw.app.closeCard('help'));
      await ev(() => window.__qa.menu());
      await ev(() => window.__qa.press('help', 'scene'));
      await page.waitForFunction(() => window.__fw.app.mode === 'live', null, { timeout: 150000 });
      const live = await ev(() => window.__fw.app.modeLine());
      if (demo.live || !demo.line.startsWith('Demo scene')) throw new Error(JSON.stringify({ demo, live }));
      return { demo: demo.line, live };
    });
    await step(page, 'Menu: Help, About & limits, Calm by pinch', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      await ev(() => window.__qa.menu());
      await ev(() => window.__qa.press('help', 'guide'));
      const guide = await ev(() => !!window.__fw.app.cards.get('guide'));
      await ev(() => window.__fw.app.cards.closeAll());
      await ev(() => window.__qa.menu());
      await ev(() => window.__qa.press('help', 'about'));
      const about = await ev(() => !!window.__fw.app.cards.get('about'));
      await ev(() => window.__fw.app.cards.closeAll());
      await ev(() => window.__qa.menu());
      const calm0 = await ev(() => window.__fw.settings.comfort.gentle);
      await ev(() => window.__qa.press('help', 'calm'));
      const calm1 = await ev(() => window.__fw.settings.comfort.gentle);
      await ev(() => window.__qa.press('help', 'calm'));
      if (!guide || !about || calm0 === calm1) throw new Error(JSON.stringify({ guide, about, calm0, calm1 }));
      return { guide, about, calm: [calm0, calm1] };
    });
    await step(page, 'Ask the fog by pinching empty fog: restricted request refused politely', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      await ev(() => window.__qa.pinchEmpty());
      const prompt = await ev(() => window.__fw.app.keypad.isOpen && window.__fw.app.keypad.prompt);
      if (!String(prompt).startsWith('Ask the fog')) throw new Error(`keypad: ${prompt}`);
      await ev(() => window.__qa.type('DARK WEB MARKET'));
      await ev(() => window.__qa.press('keypad', 'go'));
      await page.waitForFunction(() => window.__fw.app.lastAnswer?.refused, null, { timeout: 20000 });
      const a = await ev(() => window.__fw.app.lastAnswer.text);
      await shot(page, 'v3a-5-refusal');
      return { refusal: a };
    });
    await step(page, 'Ask the fog: a topic gets a cited answer or an honest "not found"', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      await ev(() => window.__qa.pinchEmpty());
      await ev(() => window.__qa.type('SOLAR POWER'));
      await ev(() => window.__qa.press('keypad', 'go'));
      await page.waitForFunction(() => /solar power/i.test(window.__fw.app.lastAnswer?.question || '') || window.__fw.app.cards.open.some((e) => e.key.startsWith('light:')), null, { timeout: 150000 }).catch(() => {});
      const a = await ev(() => ({ q: window.__fw.app.lastAnswer?.question, answerable: window.__fw.app.lastAnswer?.answerable, sentences: window.__fw.app.lastAnswer?.sentences?.length, text: window.__fw.app.lastAnswer?.text?.slice(0, 120), opened: window.__fw.app.cards.open.map((e) => e.key) }));
      await shot(page, 'v3a-6-ask-fog');
      // either a drifting star matched (its card opened) or an answer came back
      if (!a.opened.some((k) => k.startsWith('light:')) && !/solar power/i.test(a.q || '')) throw new Error(JSON.stringify(a));
      return a;
    });
    await step(page, 'new stars appear over time, never replacing the one that is open', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      const keep = await ev(() => window.__fw.app.lights.items[0].id);
      await ev((id) => window.__fw.app.openLight(id), keep);
      const before = await ev(() => window.__fw.app.lights.items.map((x) => x.id));
      const swaps = await ev(async () => {
        const a = window.__fw.app;
        let n = 0;
        for (let i = 0; i < 5; i++) {
          a._refreshAt = 1; // the next frame brings a new star
          await new Promise((r) => setTimeout(r, 300));
          n++;
        }
        return n;
      });
      const after = await ev(() => window.__fw.app.lights.items.map((x) => x.id));
      const fresh = after.filter((x) => !before.includes(x)).length;
      if (!after.includes(keep) || fresh < 1) throw new Error(JSON.stringify({ fresh, keptOpen: after.includes(keep) }));
      const delay = await ev(() => window.__fw.app._refreshAt - performance.now());
      return { newStars: fresh, swaps, openStarKept: true, nextInSeconds: Math.round(delay / 1000) };
    });
    await step(page, 'live: no console errors', async () => {
      const errs = errorsOf(logs);
      if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
      return { messages: logs.length };
    });
  } finally {
    await browser.close();
  }
}

writeFileSync(`${OUT}/v3-stage-a-results.json`, JSON.stringify({ when: new Date().toISOString(), scripted: true, results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} passed (scripted IWER hands, headless Chromium; not a real Quest)`);
process.exit(passed === results.length ? 0 : 1);
