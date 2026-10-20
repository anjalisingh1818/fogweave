/**
 * V2 acceptance (FOGWEAVE_V2_DELTA §12.5), all with SCRIPTED IWER hands
 * (pinches aimed at real targets), live and with the backend blocked.
 *   node qa/v2-accept.mjs [offline]
 * -> qa/recordings/v2-accept-results.json (+ screenshots). Not a real Quest.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { launch, open, enterXR, shot, errorsOf, OUT } from './lib.mjs';

const only = process.argv[2];
const results = [];

async function helpers(page) {
  await page.evaluate(() => {
    const d = window.IWER_DEVICE;
    const app = window.__fw.app;
    const V = app.anchor.head.constructor;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__qa = {
      wait,
      async pinchAt(t) {
        // the hand reaches toward what it points at, like a person would
        const h = app.anchor.head;
        const from = { x: h.x + (t.x - h.x) * 0.45 + 0.05, y: h.y - 0.22 + (t.y - h.y) * 0.3, z: h.z + (t.z - h.z) * 0.45 };
        await d.remote.dispatch('set_transform', { device: 'hand-right', position: from });
        await d.remote.dispatch('look_at', { device: 'hand-right', target: t });
        // human-length aim and pinch (~250 ms each): headless frames can take 100 ms
        // while the web grows, and a 140 ms pinch could fall between two frames
        await wait(250);
        await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 1 });
        await wait(220);
        await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 0 });
        await wait(160);
      },
      card(key) {
        if (key === 'status') return app.statusCard;
        if (key === 'help-button') return app.helpButton;
        if (key === 'keypad') return app.keypad.card;
        return app.cards.get(key);
      },
      async press(key, id) {
        await wait(450);
        const p = this.card(key)?.buttonWorldPosition(id);
        if (!p) throw new Error(`no button ${key}/${id} (has ${this.card(key)?.buttonIds()})`);
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
      async pinchLight(id) {
        const p = app.lights.worldPositionOf(id, new V());
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
      async pinchNode(id) {
        const p = app.view.worldPositionOf(id, new V());
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
      async help() {
        const p = app.helpButton.buttonWorldPosition('help');
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
    };
  });
}

async function run(mode) {
  const { browser, context, page, logs } = await launch();
  const ev = (fn, a) => page.evaluate(fn, a);
  const t = {};
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      // each step starts clean: a keypad left open by an earlier step would swallow pinches
      await ev(() => window.__fw.app.keypad.isOpen && window.__fw.app.keypad.close());
      const detail = await fn();
      results.push({ mode, name, pass: true, ms: Date.now() - t0, detail });
      console.log(`PASS  [${mode}] ${name}  ${JSON.stringify(detail ?? '').slice(0, 200)}`);
    } catch (err) {
      results.push({ mode, name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
      console.log(`FAIL  [${mode}] ${name}  ${String(err.message || err).slice(0, 260)}`);
      await shot(page, `v2a-fail-${mode}-${name.replace(/\W+/g, '-').slice(0, 40)}`).catch(() => {});
    }
  };
  try {
    if (mode === 'offline') await context.route('http://localhost:8787/**', (r) => r.abort());
    await open(page);
    await enterXR(page);
    await helpers(page);
    await page.waitForFunction(() => window.__fw.app.mode !== 'starting', null, { timeout: 150000 });
    await ev(() => {
      window.__fw.app.onboarding.finish();
      window.__fw.app.cards.closeAll();
      window.__fw.app.interests.clear();
    });
    let lightId;

    await step('1 see lights; touch one: reader card opens', async () => {
      const n = await ev(() => window.__fw.app.lights.items.length);
      if (n < 12 || n > 20) throw new Error(`lights ${n}`);
      const ids = await ev((m) => {
        const a = window.__fw.app;
        return a.lights.items.filter((x) => (m === 'offline' ? a.snapshot.expansions[x.id] : x.via === 'wikipedia')).map((x) => x.id);
      }, mode);
      for (const id of ids) {
        await ev((lid) => window.__qa.pinchLight(lid), id);
        if (await ev((lid) => !!window.__fw.app.cards.get(`light:${lid}`), id)) {
          lightId = id;
          break;
        }
      }
      if (!lightId) throw new Error('no reader card opened by pinch');
      return { lights: n, opened: lightId, mode: await ev(() => window.__fw.app.mode) };
    });

    let focus;
    await step('2 expand: entities, related news/papers/parts/origin/impact with labelled links', async () => {
      await page.waitForFunction((lid) => window.__fw.app.getItem(lid)?.expanded === true, lightId, { timeout: 200000 });
      // explore an entity of this story (shared ones first)
      focus = await ev((m) => {
        const a = window.__fw.app;
        const ents = [...a.store.nodes.values()].filter((x) => ['Organisation', 'Place', 'Technology', 'Topic', 'Event'].includes(x.type) && !x.derived);
        const rec = m === 'offline' ? ents.filter((x) => a.snapshot.explores?.[x.id]) : ents;
        return (rec[0] || ents[0])?.id;
      }, mode);
      if (!focus) throw new Error('no entity to explore');
      await ev(() => window.__fw.app.cards.closeAll());
      await ev((nid) => window.__qa.pinchNode(nid), focus);
      if (!(await ev((nid) => window.__fw.app.cards.get(`node:${nid}`), focus))) {
        await ev(() => window.__fw.app.keypad.isOpen && window.__fw.app.keypad.close());
        await ev((nid) => window.__fw.app.pinchNode(nid), focus); // occluded: same handler
      }
      await page.waitForFunction((nid) => window.__fw.app.store.nodes.get(nid)?.explored === true, focus, { timeout: 200000 });
      const r = await ev((nid) => {
        const a = window.__fw.app;
        const n = a.store.nodes.get(nid);
        const groups = {};
        for (const x of n.addedIds || []) groups[a.store.nodes.get(x)?.group || 'other'] = (groups[a.store.nodes.get(x)?.group || 'other'] || 0) + 1;
        const labels = {};
        for (const e of a.store.edges.values()) labels[e.label] = (labels[e.label] || 0) + 1;
        return { focus: n.label, definition: !!n.definition, groups, labels, unlabelled: [...a.store.edges.values()].filter((e) => !e.label).length };
      }, focus);
      if (!Object.keys(r.groups).length || r.unlabelled) throw new Error(JSON.stringify(r));
      await shot(page, `v2a-${mode}-explore`);
      return r;
    });

    await step('3 touch a neighbour, expand again; go back with the breadcrumb', async () => {
      const nb = await ev((nid) => {
        const a = window.__fw.app;
        return (a.store.nodes.get(nid).addedIds || []).find((x) => !a.store.nodes.get(x).hidden && a.canExplore(x));
      }, focus);
      if (!nb) throw new Error('no explorable neighbour (offline: the snapshot must record one)');
      await ev(() => window.__fw.app.cards.closeAll());
      await ev((x) => window.__qa.pinchNode(x), nb);
      if (!(await ev((x) => window.__fw.app.cards.get(`node:${x}`), nb))) {
        // the node was still settling and the pinch missed: a missed pinch opens the keypad, close it like a user would
        await ev(() => window.__fw.app.keypad.isOpen && window.__fw.app.keypad.close());
        await ev((x) => window.__fw.app.pinchNode(x), nb);
      }
      await page.waitForFunction((x) => window.__fw.app.store.nodes.get(x)?.explored === true, nb, { timeout: 200000 }).catch(() => {});
      const trail = await ev(() => window.__fw.app.trail.length);
      await ev(() => window.__fw.app.cards.closeAll()); // the node card can sit in front of the status bar
      await ev(() => window.__qa.press('status', 'back'));
      const r = await ev(() => ({ focus: window.__fw.app.view.focusId, trail: window.__fw.app.trail.length }));
      if (r.focus !== focus) {
        const dbg = await ev(() => {
          const a = window.__fw.app;
          const p = a.statusCard.buttonWorldPosition('back');
          return { buttons: a.statusCard.buttonIds(), researching: a.researching, status: a.statusText, back: p && [p.x, p.y, p.z].map((v) => +v.toFixed(2)), card: a.statusCard.mesh && [a.statusCard.mesh.getWorldPosition(new p.constructor()).toArray().map((v) => +v.toFixed(2)), a.statusCard.mesh.visible], open: a.cards.open.map((e) => e.key), keypad: a.keypad.isOpen };
        });
        throw new Error(JSON.stringify({ ...r, expected: focus, trailBefore: trail, dbg }));
      }
      return { neighbour: nb, trailBefore: trail, ...r };
    });

    await step('4 add an interest + paper type: lights change; remove: they change back', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      const before = await ev(() => window.__fw.app.lights.items.map((x) => x.id).sort());
      await ev(() => window.__qa.help());
      await ev(() => window.__qa.press('help', 'interests'));
      await ev(() => window.__qa.press('interests', 'type:space'));
      await ev(() => window.__qa.press('interests', 'paper:cs.RO'));
      await page.waitForFunction(() => !window.__fw.app.statusText.startsWith('Looking'), null, { timeout: 150000 });
      const withI = await ev(() => window.__fw.app.lights.items.map((x) => x.id).sort());
      const matched = await ev(() => window.__fw.app.lights.items.filter((x) => (x.tags || []).some((t) => t === 'space' || t === 'cs.RO')).length);
      await ev(() => window.__qa.press('interests', 'type:space'));
      await ev(() => window.__qa.press('interests', 'paper:cs.RO'));
      await page.waitForFunction(() => !window.__fw.app.statusText.startsWith('Looking'), null, { timeout: 150000 });
      const after = await ev(() => window.__fw.app.lights.items.map((x) => x.id).sort());
      const changed = withI.filter((x) => !before.includes(x)).length;
      const restored = after.filter((x) => before.includes(x)).length / before.length;
      if (!changed || restored < 0.75) throw new Error(JSON.stringify({ changed, restored, matched }));
      await shot(page, `v2a-${mode}-interests`);
      return { changed, matchingInterest: matched, restoredShare: +restored.toFixed(2) };
    });

    await step('5 one node shared by two items; a labelled relation between two different nodes', async () => {
      // explore a few more entities by pinch until two items meet at one node (data-dependent live)
      for (let k = 0; k < 3; k++) {
        const hasShared = await ev(() => {
          const a = window.__fw.app;
          const m = new Map();
          for (const e of a.store.edges.values()) if (a.store.nodes.get(e.from)?.type === 'NewsItem' && ['mentions', 'about'].includes(e.type)) m.set(e.to, (m.get(e.to) || 0) + 1);
          return [...m.values()].some((c) => c >= 2);
        });
        if (hasShared) break;
        const next = await ev(() => {
          const a = window.__fw.app;
          return [...a.store.nodes.values()].find((x) => !x.explored && a.canExplore(x.id) && !x.hidden && ['Place', 'Organisation', 'Technology'].includes(x.type))?.id;
        });
        if (!next) break;
        await ev(() => window.__fw.app.cards.closeAll());
        await ev((x) => window.__fw.app.pinchNode(x), next);
        await page.waitForFunction((x) => window.__fw.app.store.nodes.get(x)?.explored === true, next, { timeout: 200000 }).catch(() => {});
      }
      const r = await ev(() => {
        const a = window.__fw.app;
        const byEntity = new Map();
        for (const e of a.store.edges.values()) {
          if (a.store.nodes.get(e.from)?.type !== 'NewsItem' || !['mentions', 'about'].includes(e.type)) continue;
          if (!byEntity.has(e.to)) byEntity.set(e.to, new Set());
          byEntity.get(e.to).add(e.from);
        }
        const shared = [...byEntity].find(([, s]) => s.size >= 2);
        const rel = [...a.store.edges.values()].find((e) => !['mentions', 'about', 'reports'].includes(e.type) && a.store.nodes.get(e.from)?.type !== 'NewsItem' && a.store.nodes.get(e.to)?.type !== 'ContextNode');
        return {
          shared: shared && { entity: a.store.nodes.get(shared[0])?.label, items: shared[1].size },
          relation: rel && `${a.store.nodes.get(rel.from)?.label} --${rel.type}/${rel.label}--> ${a.store.nodes.get(rel.to)?.label}`,
        };
      });
      if (!r.shared || !r.relation) throw new Error(JSON.stringify(r));
      return r;
    });

    await step('6 seal items and export the Evidence Pack', async () => {
      await ev(() => window.__fw.app.cards.closeAll());
      // seal the story (its news node in the web) and the entity, both by pinch on their cards
      for (const nid of [lightId, focus]) {
        await ev(() => window.__fw.app.cards.closeAll());
        await ev((x) => window.__fw.app.pinchNode(x, { fromTrail: true }), nid);
        await ev((x) => window.__qa.press(`node:${x}`, 'seal'), nid);
      }
      await ev(() => window.__fw.app.cards.closeAll());
      await ev(() => window.__fw.app.openLibrary());
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), ev(() => window.__qa.press('library', 'export'))]);
      const path = `${OUT}/v2-pack-${mode}.zip`;
      await dl.saveAs(path);
      const names = Object.keys(unzipSync(new Uint8Array(readFileSync(path)))).sort();
      const r = await ev(() => window.__fw.app.lastExport);
      if (!names.includes('pack.jsonld') || !r.counts.news) throw new Error(JSON.stringify({ names, counts: r.counts }));
      if (mode === 'live' && !r.validation?.shacl?.conforms) throw new Error('SHACL ' + JSON.stringify(r.validation?.shacl).slice(0, 200));
      return { names, counts: r.counts, shacl: r.validation ? r.validation.shacl.conforms : 'not validated offline (says so)' };
    });

    await step('no console errors', async () => {
      const errs = errorsOf(logs).filter((l) => mode !== 'offline' || !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
      if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
      return { messages: logs.length };
    });
  } finally {
    await browser.close();
  }
}

try {
  if (only !== 'offline') await run('live');
  await run('offline');
} finally {
  writeFileSync(`${OUT}/v2-accept-results.json`, JSON.stringify({ when: new Date().toISOString(), scripted: true, results }, null, 1));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed (scripted IWER hands, headless Chromium; not a real Quest)`);
}
