// Stage B e2e (V2 master §7): F7 interests (visible change, undo, kept on the
// device), opt-in datasets with their badge, and older news when a node opens
// up (open deep sources). Scripted IWER hands; live or offline.
//   node qa/stage-b.mjs [offline|live]   (default offline)
import { writeFileSync } from 'node:fs';
import { launch, open, enterXR, shot, errorsOf, OUT } from './lib.mjs';

const mode = process.argv[2] === 'live' ? 'live' : 'offline';
const results = [];

async function handsHelpers(page) {
  await page.evaluate(() => {
    const d = window.IWER_DEVICE;
    const a = window.__fw.app;
    const V = a.anchor.head.constructor;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__qa = {
      async pinchAt(t) {
        const h = a.anchor.head;
        const from = { x: h.x + (t.x - h.x) * 0.45 + 0.05, y: h.y - 0.22 + (t.y - h.y) * 0.3, z: h.z + (t.z - h.z) * 0.45 };
        await d.remote.dispatch('set_transform', { device: 'hand-right', position: from });
        await d.remote.dispatch('look_at', { device: 'hand-right', target: t });
        await wait(250);
        await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 1 });
        await wait(220);
        await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 0 });
        await wait(200);
      },
      card(key) {
        if (key === 'status') return a.statusCard;
        if (key === 'help-button') return a.helpButton;
        return a.cards.get(key);
      },
      async press(key, id) {
        await wait(400);
        const p = this.card(key)?.buttonWorldPosition(id);
        if (!p) throw new Error(`no button ${key}/${id} (has ${this.card(key)?.buttonIds()})`);
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
      async pinchLight(id) {
        const p = a.lights.worldPositionOf(id, new V());
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
      async pinchNode(id) {
        const p = a.view.worldPositionOf(id, new V());
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
      async help() {
        const p = a.helpButton.buttonWorldPosition('help');
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
    };
  });
}

async function boot(page, context, { clear = true } = {}) {
  if (mode === 'offline') await context.route('http://localhost:8787/**', (r) => r.abort());
  await open(page, { fresh: false });
  await enterXR(page);
  await handsHelpers(page);
  await page.waitForFunction(() => window.__fw.app.mode !== 'starting' && window.__fw.app.lights.items.length > 0, null, { timeout: 150000 });
  await page.evaluate((c) => {
    const a = window.__fw.app;
    a.onboarding.finish();
    a.cards.closeAll();
    if (c) a.interests.clear();
  }, clear);
}

const step = (page, name, fn) =>
  (async () => {
    const t0 = Date.now();
    try {
      await page.evaluate(() => window.__fw.app.keypad.isOpen && window.__fw.app.keypad.close());
      const detail = await fn();
      results.push({ name, pass: true, ms: Date.now() - t0, detail });
      console.log(`PASS  [${mode}] ${name}  ${JSON.stringify(detail ?? '').slice(0, 220)}`);
    } catch (err) {
      results.push({ name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
      console.log(`FAIL  [${mode}] ${name}  ${String(err.message || err).slice(0, 300)}`);
      await shot(page, `stageB-fail-${name.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
    }
  })();

const { browser, context, page, logs } = await launch();
const ev = (fn, a) => page.evaluate(fn, a);
const lightsNow = () => ev(() => window.__fw.app.lights.items.map((x) => x.id).sort());
const settle = () => page.waitForFunction(() => !window.__fw.app.statusText.startsWith('Looking'), null, { timeout: 150000 });
try {
  await boot(page, context);
  let liked;
  let before;

  await step(page, 'F7 More like this by pinch: the lights change, with a notice and Undo', async () => {
    before = await lightsNow();
    // a light that has topic tags to learn from
    const ids = await ev(() => window.__fw.app.lights.items.filter((x) => (x.tags || []).some((t) => ['technology', 'science', 'business', 'climate', 'health', 'space', 'politics', 'world', 'culture', 'sports'].includes(t))).map((x) => x.id));
    for (const id of ids) {
      await ev(() => window.__fw.app.cards.closeAll());
      await ev((x) => window.__qa.pinchLight(x), id);
      if (await ev((x) => !!window.__fw.app.cards.get(`light:${x}`), id)) {
        liked = id;
        break;
      }
    }
    if (!liked) throw new Error('no taggable light opened by pinch');
    await ev((x) => window.__qa.press(`light:${x}`, 'more'), liked);
    // Undo shows for 12 s after the press, and again after the fresh lights arrive
    await page.waitForFunction(() => window.__fw.app.statusCard.buttonIds().includes('undo'), null, { timeout: 60000 }).catch(() => {});
    const r = await ev(() => ({ notice: window.__fw.app.notice?.text, undo: window.__fw.app.statusCard.buttonIds().includes('undo'), types: window.__fw.app.interests.data.newsTypes }));
    const after = await lightsNow();
    const changed = after.filter((x) => !before.includes(x)).length;
    await shot(page, `stageB-${mode}-1-more-like-this`);
    if (!r.notice?.startsWith('More like this') || !r.undo || !r.types.length || !changed) throw new Error(JSON.stringify({ ...r, changed }));
    return { ...r, changed };
  });

  await step(page, 'F7 Undo by pinch on the status bar: interests and lights come back', async () => {
    await ev(() => window.__fw.app.cards.closeAll());
    await page.waitForFunction(() => window.__fw.app.statusCard.buttonIds().includes('undo'), null, { timeout: 150000 });
    await ev(() => window.__qa.press('status', 'undo'));
    await settle();
    await page.waitForTimeout(500);
    const types = await ev(() => window.__fw.app.interests.data.newsTypes);
    const after = await lightsNow();
    const restored = after.filter((x) => before.includes(x)).length / before.length;
    if (types.length || restored < 0.75) throw new Error(JSON.stringify({ types, restored }));
    return { types, restoredShare: +restored.toFixed(2) };
  });

  await step(page, 'F7 interests are kept on this device (after a reload)', async () => {
    await ev((x) => window.__fw.app.likeLight(x, true), liked);
    const types = await ev(() => window.__fw.app.interests.data.newsTypes);
    await boot(page, context, { clear: false });
    const kept = await ev(() => window.__fw.app.interests.data.newsTypes);
    const matching = await ev(() => window.__fw.app.lights.items.filter((x) => (x.tags || []).some((t) => window.__fw.app.interests.data.newsTypes.includes(t))).length);
    if (JSON.stringify(kept) !== JSON.stringify(types)) throw new Error(JSON.stringify({ types, kept }));
    return { kept, matchingLights: matching };
  });

  await step(page, 'datasets: off by default; Interests → Also show → Datasets adds dataset lights (badge DATASET)', async () => {
    await ev(() => window.__fw.app.interests.clear());
    await ev(() => window.__fw.app.drawLights());
    const none = await ev(() => window.__fw.app.lights.items.filter((x) => (x.sourceType || x.kind) === 'dataset').length);
    await ev(() => window.__qa.help());
    await ev(() => window.__qa.press('help', 'interests'));
    await ev(() => window.__qa.press('interests', 'source:dataset'));
    await settle();
    await page.waitForTimeout(500);
    const ds = await ev(() => window.__fw.app.lights.items.filter((x) => (x.sourceType || x.kind) === 'dataset').map((x) => x.id));
    if (none || !ds.length) throw new Error(JSON.stringify({ before: none, after: ds.length }));
    await ev(() => window.__fw.app.cards.closeAll());
    await ev((x) => window.__fw.app.openLight(x), ds[0]); // the badge, not the aim, is under test here
    await page.waitForTimeout(400);
    const texts = await ev((x) => window.__fw.app.cards.get(`light:${x}`).boxes.map((b) => b.text).join(' | '), ds[0]);
    await shot(page, `stageB-${mode}-2-dataset-light`);
    if (!texts.includes('DATASET')) throw new Error(texts.slice(0, 300));
    return { datasetLights: ds.length, badge: 'DATASET' };
  });

  await step(page, 'open deep sources: a node opens up with older news (dated) next to recent news', async () => {
    await ev(() => {
      window.__fw.app.interests.clear();
      window.__fw.app.cards.closeAll();
    });
    // offline: a recorded focus with older and recent news; live: try entities until one has older news
    const target = await ev(async (m) => {
      const a = window.__fw.app;
      if (m === 'offline') return a.snapshot.focusWithOldAndNew?.[0] || null;
      return null;
    }, mode);
    let found = null;
    if (mode === 'offline') {
      if (!target) throw new Error('the snapshot records no focus with older and recent news');
      // grow the light whose web holds the target, then open the target
      const light = await ev(async (t) => {
        const a = window.__fw.app;
        for (const [id, f] of Object.entries(a.snapshot.expansions)) {
          const rec = await fetch(`demo/snapshot/${f}`).then((r) => r.json());
          if (rec.events.some((e) => e.type === 'node' && e.node.id === t)) return id;
        }
        return null;
      }, target);
      if (!light) throw new Error(`no recorded light holds ${target}`);
      await ev(async (id) => {
        const a = window.__fw.app;
        if (!a.lights.get(id)) {
          const it = a.pool.find((x) => x.id === id);
          a.lights.setItems([it, ...a.lights.items.slice(0, 15)]);
        }
        a.openLight(id);
        if (!a.getItem(id).expanded) await a.expandLight(id);
      }, light);
      await page.waitForFunction((id) => window.__fw.app.getItem(id)?.expanded === true, light, { timeout: 120000 });
      await ev(() => window.__fw.app.cards.closeAll());
      await ev((x) => window.__fw.app.pinchNode(x), target);
      await page.waitForFunction((x) => window.__fw.app.store.nodes.get(x)?.explored === true, target, { timeout: 120000 });
      found = target;
    } else {
      const lid = await ev(() => window.__fw.app.lights.items.find((x) => x.via === 'wikipedia' && window.__fw.app.canExpand(x.id))?.id);
      await ev((id) => window.__fw.app.openLight(id), lid);
      await page.waitForFunction((id) => window.__fw.app.getItem(id)?.expanded === true, lid, { timeout: 200000 });
      const cands = await ev(() => [...window.__fw.app.store.nodes.values()].filter((x) => ['Place', 'Organisation', 'Topic', 'Event'].includes(x.type) && !x.derived && window.__fw.app.canExplore(x.id)).map((x) => x.id));
      for (const c of cands.slice(0, 4)) {
        await ev(() => window.__fw.app.cards.closeAll());
        await ev((x) => window.__fw.app.pinchNode(x), c);
        await page.waitForFunction((x) => window.__fw.app.store.nodes.get(x)?.explored === true, c, { timeout: 200000 });
        if (await ev((x) => (window.__fw.app.store.nodes.get(x).addedIds || []).some((n) => window.__fw.app.store.nodes.get(n)?.group === 'archive'), c)) {
          found = c;
          break;
        }
      }
      if (!found) throw new Error(`no older news for ${cands.slice(0, 4).join(', ')}`);
    }
    const r = await ev((x) => {
      const a = window.__fw.app;
      const added = (a.store.nodes.get(x).addedIds || []).map((n) => a.store.nodes.get(n)).filter(Boolean);
      const old = added.filter((n) => n.group === 'archive');
      const recent = added.filter((n) => n.group === 'news');
      const edges = [...a.store.edges.values()].filter((e) => old.some((n) => n.id === e.from) && e.to === x);
      return { focus: a.store.nodes.get(x).label, older: old.map((n) => `${String(n.date).slice(0, 10)} ${n.label.slice(0, 40)}`), recent: recent.length, labelled: edges.every((e) => e.label === 'reported' && e.evidence?.[0]?.quote) };
    }, found);
    await shot(page, `stageB-${mode}-3-older-news`);
    if (!r.older.length || !r.labelled) throw new Error(JSON.stringify(r));
    return r;
  });

  await step(page, 'no console errors', async () => {
    const errs = errorsOf(logs).filter((l) => mode !== 'offline' || !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
    if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
    return { messages: logs.length };
  });
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/stageB-results-${mode}.json`, JSON.stringify({ when: new Date().toISOString(), mode, scripted: true, results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} passed (${mode}; scripted IWER hands, headless Chromium; not a real Quest)`);
process.exit(passed === results.length ? 0 : 1);
