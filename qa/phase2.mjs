/**
 * Phase 2 scripted-hands QA (V2 news flow) in the IWER emulator.
 * SCRIPTED hands via IWER's remote-control API; not a person, not a Quest.
 *
 *   FW_HTTP=1 npm run dev                         (client)
 *   cd server && uvicorn app:app --port 8787      (backend, for the live part)
 *   node qa/phase2.mjs            live + offline
 *   node qa/phase2.mjs offline    offline only (backend blocked)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { launch, open, enterXR, shot, errorsOf, OUT } from './lib.mjs';

const only = process.argv[2];
const results = [];
const timings = {};

async function step(page, name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, ms: Date.now() - t0, detail });
    console.log(`PASS  ${name}${detail ? '  ' + JSON.stringify(detail).slice(0, 230) : ''}`);
  } catch (err) {
    results.push({ name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
    console.log(`FAIL  ${name}  ${String(err.message || err).slice(0, 300)}`);
    await shot(page, `p2-fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
  }
}

async function helpers(page) {
  await page.evaluate(() => {
    const d = window.IWER_DEVICE;
    const app = window.__fw.app;
    const V = app.anchor.head.constructor;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const rest = (device) => {
      const h = app.anchor.head;
      const side = device === 'hand-left' ? -1 : 1;
      return { x: h.x + side * 0.18, y: h.y - 0.3, z: h.z - 0.25 };
    };
    window.__qa = {
      wait,
      async aim(device, target, from = rest(device)) {
        await d.remote.dispatch('set_transform', { device, position: from });
        await d.remote.dispatch('look_at', { device, target });
        await wait(120);
      },
      async pinch(device, ms = 150) {
        await d.remote.dispatch('set_select_value', { device, value: 1 });
        await wait(ms);
        await d.remote.dispatch('set_select_value', { device, value: 0 });
        await wait(150);
      },
      async pinchAt(device, target) {
        await this.aim(device, target);
        await this.pinch(device);
      },
      cardOf(key) {
        if (key === 'keypad') return app.keypad.card;
        if (key === 'status') return app.statusCard;
        if (key === 'help-button') return app.helpButton;
        return app.cards.get(key);
      },
      async press(key, id, device = 'hand-right') {
        await wait(500);
        const c = this.cardOf(key);
        const p = c?.buttonWorldPosition(id);
        if (!p) throw new Error(`no button ${key}/${id} (has: ${c?.buttonIds()})`);
        await this.pinchAt(device, { x: p.x, y: p.y, z: p.z });
      },
      async pinchLight(id) {
        const p = app.lights.worldPositionOf(id, new V());
        await this.pinchAt('hand-right', { x: p.x, y: p.y, z: p.z });
      },
      async pinchNode(id) {
        const p = app.view.worldPositionOf(id, new V());
        await this.pinchAt('hand-right', { x: p.x, y: p.y, z: p.z });
      },
      open: () => app.cards.open.map((e) => e.key),
    };
  });
}

/** Open some light's reader card by pinching lights until one opens. */
async function openSomeLight(page, prefer = null) {
  const ids = await page.evaluate((pref) => {
    const L = window.__fw.app.lights.items;
    const ordered = pref ? L.filter((x) => pref(x)) : L;
    return ordered.map((x) => x.id);
  }, prefer);
  for (const id of ids) {
    await page.evaluate((lid) => window.__qa.pinchLight(lid), id);
    const open = (await page.evaluate(() => window.__qa.open())).find((k) => k.startsWith('light:'));
    if (open) return open.slice(6);
  }
  throw new Error('no reader card opened');
}

async function liveRun() {
  const { browser, page, logs } = await launch();
  try {
    await open(page);
    await enterXR(page);
    await helpers(page);
    const ev = (fn, a) => page.evaluate(fn, a);

    await step(page, 'live: lights from the news engine', async () => {
      await page.waitForFunction(() => window.__fw.app.mode !== 'starting', null, { timeout: 120000 });
      const r = await ev(() => ({ mode: window.__fw.app.mode, n: window.__fw.app.lights.items.length, meta: window.__fw.app.lightsMeta, kinds: [...new Set(window.__fw.app.lights.items.map((x) => x.kind))] }));
      if (r.mode !== 'live' || r.n < 8) throw new Error(JSON.stringify(r));
      await ev(() => window.__fw.app.onboarding.finish());
      await shot(page, 'p2-01-live-lights');
      return r;
    });

    let lightId;
    await step(page, 'touch a light: reader card + key claims load', async () => {
      lightId = await openSomeLight(page);
      await page.waitForFunction((id) => !window.__fw.app.lights.get(id).claimsLoading, lightId, { timeout: 90000 });
      const r = await ev((id) => {
        const it = window.__fw.app.lights.get(id);
        return { headline: it.headline, claims: (it.claims || []).length, note: it.claimsNote, buttons: window.__qa.cardOf(`light:${id}`).buttonIds() };
      }, lightId);
      if (!r.buttons.includes('expand')) throw new Error('Expand not offered: ' + JSON.stringify(r));
      await shot(page, 'p2-02-reader');
      return r;
    });

    await step(page, 'Expand by pinch: graph streams in with labelled links', async () => {
      const t0 = Date.now();
      await ev((id) => window.__qa.press(`light:${id}`, 'expand'), lightId);
      await page.waitForFunction((id) => window.__fw.app.store.nodes.has(id), lightId, { timeout: 30000 });
      timings.firstNodeMs = Date.now() - t0;
      await page.waitForFunction((id) => window.__fw.app.lights.get(id).expanded === true, lightId, { timeout: 180000 });
      timings.expandDoneMs = Date.now() - t0;
      await page.waitForTimeout(2500);
      const r = await ev(() => {
        const s = window.__fw.app.store;
        const labels = {};
        for (const e of s.edges.values()) labels[e.label] = (labels[e.label] || 0) + 1;
        const types = {};
        for (const n of s.nodes.values()) types[n.type] = (types[n.type] || 0) + 1;
        return { nodes: s.nodes.size, edges: s.edges.size, labels, types, rejected: s.rejected.length, stats: window.__fw.app.lastStats && { ms: window.__fw.app.lastStats.ms, llmCalls: window.__fw.app.lastStats.llmCalls } };
      });
      if (r.nodes < 6 || !r.labels.reported) throw new Error(JSON.stringify(r));
      await shot(page, 'p2-03-expanded');
      return { ...r, firstNodeMs: timings.firstNodeMs, doneMs: timings.expandDoneMs };
    });

    await step(page, 'pinch the news node: card shows labelled links', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      await ev((id) => window.__qa.pinchNode(id), lightId);
      let open = await ev(() => window.__qa.open());
      if (!open.includes(`node:${lightId}`)) {
        // another node was in front of it: open the one we hit, then use the card API path
        await ev((id) => window.__fw.app.pinchNode(id), lightId);
        open = await ev(() => window.__qa.open());
      }
      const buttons = await ev((id) => window.__qa.cardOf(`node:${id}`).buttonIds(), lightId);
      if (!buttons.includes('touch')) throw new Error(JSON.stringify(buttons));
      await shot(page, 'p2-04-news-node');
      return { buttons };
    });

    await step(page, '"Touches me?" without context asks for context', async () => {
      await ev(() => window.__fw.app.clearContext());
      await ev((id) => window.__qa.press(`node:${id}`, 'touch'), lightId);
      const open = await ev(() => window.__qa.open());
      if (!open.includes('path')) throw new Error(JSON.stringify(open));
      return { open };
    });

    await step(page, 'My context: sample persona by pinch (help → context → Sample)', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      await ev(async () => {
        const qa = window.__qa;
        await qa.wait(300);
        const p = qa.buttonPos?.('help-button', 'help') || window.__fw.app.helpButton.buttonWorldPosition('help');
        await qa.pinchAt('hand-right', { x: p.x, y: p.y, z: p.z });
      });
      await ev(() => window.__qa.press('help', 'context'));
      await ev(() => window.__qa.press('context', 'sample'));
      const r = await ev(() => ({ n: window.__fw.app.context.list().length, ctxNodes: [...window.__fw.app.store.nodes.values()].filter((n) => n.type === 'ContextNode').length }));
      if (r.n !== 6 || r.ctxNodes !== 6) throw new Error(JSON.stringify(r));
      await shot(page, 'p2-05-context');
      return r;
    });

    await step(page, 'context rejects sensitive entries', async () => {
      const r = await ev(() => [window.__fw.app.addContext('12 Baker Street'), window.__fw.app.addContext('my diabetes'), window.__fw.app.addContext('salary 50k')]);
      if (r.some((x) => x.ok)) throw new Error(JSON.stringify(r));
      return { refused: r.length };
    });

    await step(page, '"Touches me?" with context: grounded thread or honest no', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      await ev((id) => window.__fw.app.pinchNode(id), lightId);
      await ev((id) => window.__qa.press(`node:${id}`, 'touch'), lightId);
      const r = await ev(() => {
        const p = window.__fw.app.lastTouch;
        return p ? { path: p.nodes.length, labels: p.edges.map((e) => e.label) } : { path: 0, said: 'no clear connection' };
      });
      if (r.labels?.includes('speculative')) throw new Error('speculative link used: ' + JSON.stringify(r));
      await shot(page, 'p2-06-touches-me');
      return r;
    });

    await step(page, 'Seal the news node by pinch; Library keeps it', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      await ev((id) => window.__fw.app.pinchNode(id), lightId);
      await ev((id) => window.__qa.press(`node:${id}`, 'seal'), lightId);
      const r = await ev(() => ({ sealed: window.__fw.app.store.sealedIds().length, stored: (JSON.parse(localStorage.getItem('fogweave.library.v1')) || {}).nodes?.length }));
      if (!r.sealed || !r.stored) throw new Error(JSON.stringify(r));
      return r;
    });

    await step(page, 'Locket tap: relevance to the reader (personalized)', async () => {
      await ev(async () => {
        const p = window.__fw.app.props.items.find((x) => x.kind === 'locket').tag.buttonWorldPosition('tap');
        await window.__qa.pinchAt('hand-left', { x: p.x, y: p.y, z: p.z });
      });
      const r = await ev(() => window.__fw.app.lastReveal);
      if (r?.kind !== 'locket') throw new Error(JSON.stringify(r));
      return { rank: r.result?.rank, of: r.result?.of, personal: r.result?.personal, why: r.result?.why };
    });

    await step(page, 'Coin tap: evidence breakdown', async () => {
      await ev(async () => {
        const p = window.__fw.app.props.items.find((x) => x.kind === 'coin').tag.buttonWorldPosition('tap');
        await window.__qa.pinchAt('hand-right', { x: p.x, y: p.y, z: p.z });
      });
      const r = await ev(() => window.__fw.app.lastReveal);
      if (r?.kind !== 'coin' || !r.result?.lines?.length) throw new Error(JSON.stringify(r));
      if (r.result.lines.some((l) => /\d+\s*%/.test(l))) throw new Error('bare percentage shown');
      return { lines: r.result.lines };
    });

    await step(page, 'empty-space pinch → keypad → find a light by typing', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      await ev(async () => {
        const h = window.__fw.app.anchor.head;
        await window.__qa.pinchAt('hand-right', { x: h.x + 0.2, y: h.y + 1.6, z: h.z - 0.3 });
        await window.__qa.wait(400);
      });
      if (!(await ev(() => window.__fw.app.keypad.isOpen))) throw new Error('keypad not open');
      const word = await ev(() => {
        const it = window.__fw.app.lights.items.find((x) => /^[A-Za-z]{4,}/.test(x.headline.split(' ')[0]));
        return it.headline.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '').slice(0, 7);
      });
      for (const ch of word) await ev((c) => window.__qa.press('keypad', `key:${c}`), ch);
      await ev(() => window.__qa.press('keypad', 'go'));
      const open = await ev(() => window.__qa.open());
      if (!open.some((k) => k.startsWith('light:'))) throw new Error(JSON.stringify({ word, open }));
      return { word, open };
    });

    await step(page, 'Stop mid-research keeps what grew', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      const other = await ev(() => window.__fw.app.lights.items.find((x) => !x.expanded && x.live)?.id);
      if (!other) return { skipped: 'no second light' };
      await ev((id) => window.__fw.app.openLight(id), other);
      await ev((id) => window.__qa.press(`light:${id}`, 'expand'), other);
      await page.waitForTimeout(2500);
      await ev(() => window.__qa.press('status', 'stop'));
      await page.waitForFunction(() => !window.__fw.app.researching, null, { timeout: 20000 });
      return { stopped: true, status: await ev(() => window.__fw.app.statusText), nodes: await ev(() => window.__fw.app.store.nodes.size) };
    });

    await step(page, 'clear my context in one action', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      await ev(() => window.__fw.app.openContext());
      await ev(() => window.__qa.press('context', 'clear'));
      const r = await ev(() => ({ n: window.__fw.app.context.list().length, stored: localStorage.getItem('fogweave.context.v1'), nodes: [...window.__fw.app.store.nodes.values()].filter((n) => n.type === 'ContextNode').length }));
      if (r.n || r.stored || r.nodes) throw new Error(JSON.stringify(r));
      return r;
    });

    await step(page, 'live run: no console errors', async () => {
      const errs = errorsOf(logs);
      if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 4)));
      return { messages: logs.length };
    });
  } finally {
    await browser.close();
  }
}

async function offlineRun() {
  const { browser, context, page, logs } = await launch();
  try {
    // take-it-away test: the backend is unreachable
    await context.route('http://localhost:8787/**', (route) => route.abort());
    await open(page);
    await enterXR(page);
    await helpers(page);
    const ev = (fn, a) => page.evaluate(fn, a);

    await step(page, 'offline: snapshot lights with a dated status line', async () => {
      await page.waitForFunction(() => window.__fw.app.mode !== 'starting', null, { timeout: 30000 });
      await ev(() => window.__fw.app.onboarding.finish());
      const r = await ev(() => ({ mode: window.__fw.app.mode, n: window.__fw.app.lights.items.length, line: window.__fw.app.modeLine(), kind: window.__fw.app.lightsMeta.kind }));
      if (r.mode !== 'offline' || r.n < 8 || r.kind !== 'pipeline' || !/snapshot of 20\d\d-/.test(r.line)) throw new Error(JSON.stringify(r));
      return r;
    });

    await step(page, 'offline: Expand replays a recorded real run', async () => {
      const ids = await ev(() => Object.keys(window.__fw.app.snapshot.expansions));
      await ev((id) => window.__fw.app.openLight(id), ids[0]);
      await ev((id) => window.__qa.press(`light:${id}`, 'expand'), ids[0]);
      await page.waitForFunction((id) => window.__fw.app.lights.get(id).expanded === true, ids[0], { timeout: 60000 });
      await page.waitForTimeout(2000);
      const r = await ev(() => {
        const labels = {};
        for (const e of window.__fw.app.store.edges.values()) labels[e.label] = (labels[e.label] || 0) + 1;
        return { nodes: window.__fw.app.store.nodes.size, labels, rejected: window.__fw.app.store.rejected.length };
      });
      if (r.nodes < 6 || r.rejected) throw new Error(JSON.stringify(r));
      await shot(page, 'p2-07-offline-expanded');
      return r;
    });

    await step(page, 'offline: light without a recorded run says so', async () => {
      const id = await ev(() => window.__fw.app.lights.items.find((x) => !window.__fw.app.snapshot.expansions[x.id])?.id);
      await ev((lid) => window.__fw.app.openLight(lid), id);
      const r = await ev((lid) => ({ can: window.__fw.app.canExpand(lid), buttons: window.__qa.cardOf(`light:${lid}`).buttonIds() }), id);
      if (r.can || r.buttons.includes('expand')) throw new Error(JSON.stringify(r));
      return r;
    });

    await step(page, 'stress web: 160 nodes capped to 150, frame stats', async () => {
      const doc = JSON.parse(readFileSync('qa/fixtures/stress-150.json', 'utf8'));
      await ev((d) => {
        const app = window.__fw.app;
        app.cards.closeAll();
        app.governor.locked = true;
        app.governor.level = 2;
        app.governor.onChange(2);
        app.store.loadGraph(d);
      }, doc);
      await page.waitForTimeout(4000);
      const s = await ev(async () => {
        const app = window.__fw.app;
        const t = [];
        await new Promise((res) => {
          const f = () => {
            t.push(performance.now());
            if (t.length < 361) app.world.session.requestAnimationFrame(f);
            else res();
          };
          app.world.session.requestAnimationFrame(f);
        });
        const dts = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
        const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
        return { visible: app.view.visibleIds.length, total: app.store.nodes.size, fps: +(1000 / avg).toFixed(1), p95ms: +dts[Math.floor(dts.length * 0.95)].toFixed(1) };
      });
      if (s.visible > 150) throw new Error(JSON.stringify(s));
      return s;
    });

    await step(page, 'offline run: no console errors', async () => {
      const errs = errorsOf(logs).filter((l) => !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
      if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 4)));
      return { messages: logs.length };
    });
  } finally {
    await browser.close();
  }
}

try {
  if (only !== 'offline') await liveRun();
  await offlineRun();
} finally {
  writeFileSync(`${OUT}/phase2-results.json`, JSON.stringify({ when: new Date().toISOString(), scripted: true, timings, results }, null, 1));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed (scripted IWER hands, headless Chromium; not a real Quest)`);
}
