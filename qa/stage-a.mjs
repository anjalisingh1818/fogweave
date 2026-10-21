// Stage A e2e (V2 master §3: F3, F4, F5, F9; F6 is qa/no-third-party.mjs).
//
// Desktop (flat page, real mouse events from Playwright):
//   click a light -> compact reader card -> Details -> the light grows into the
//   web -> click an entity node -> node card -> it opens up (explore).
// Hands (IWER emulator, scripted pinches): the same flow.
// Layout (F3/F4): reader card compact and with details at three viewport
//   sizes: no drawn box overlaps another, everything stays inside the card,
//   the card fits on screen, and it does not cover the light it belongs to.
// Labels (F9): source-type badge, LIVE / SNAPSHOT (date), the real outlet.
//
//   node qa/stage-a.mjs [offline|live]     (default offline: the bundled snapshot)
// Screenshots: qa/recordings/stageA-*.png; results: stageA-results.json.
import { writeFileSync } from 'node:fs';
import { launch, open, enterXR, shot, errorsOf, OUT } from './lib.mjs';

const mode = process.argv[2] === 'live' ? 'live' : 'offline';
const results = [];
const VIEWPORTS = [
  [1280, 800],
  [1024, 768],
  [800, 600],
];

async function setup(page, context) {
  if (mode === 'offline') await context.route('http://localhost:8787/**', (r) => r.abort());
  await open(page, mode === 'offline' ? { query: '?debug&demo' } : {});
  await page.waitForFunction(() => window.__fw?.app && window.__fw.app.mode !== 'starting' && window.__fw.app.lights.items.length > 0, null, { timeout: 150000 });
  await page.evaluate(() => {
    const a = window.__fw.app;
    a.onboarding.finish();
    a.cards.closeAll();
    a.interests.clear();
    // helpers shared by both flows
    const V = a.anchor.head.constructor;
    window.__sa = {
      screenOf(v) {
        const cam = window.__fw.world.camera;
        cam.updateMatrixWorld();
        const p = v.clone().project(cam);
        const r = window.__fw.world.renderer.domElement.getBoundingClientRect();
        return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, front: p.z < 1 };
      },
      light(id) {
        return this.screenOf(a.lights.worldPositionOf(id, new V()));
      },
      node(id) {
        return this.screenOf(a.view.worldPositionOf(id, new V()));
      },
      button(key, id) {
        const c = a.cards.get(key);
        const p = c?.buttonWorldPosition(id);
        return p ? this.screenOf(p) : null;
      },
      /** layout check of one card: overlaps, out-of-card boxes, on-screen rect */
      layout(key, coverId = null) {
        const c = a.cards.get(key);
        if (!c) return { missing: key };
        const W = c.canvas.width;
        const H = c.canvas.height;
        const boxes = c.boxes.filter((b) => b.w > 0 && b.h > 0);
        const overlaps = [];
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const p = boxes[i];
            const q = boxes[j];
            const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
            const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
            if (ox > 2 && oy > 2) overlaps.push(`${p.kind}:${p.text} × ${q.kind}:${q.text}`);
          }
        }
        const outside = boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > W + 1 || b.y + b.h > H + 1).map((b) => `${b.kind}:${b.text}`);
        c.object3D.updateMatrixWorld(true);
        const corners = [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
        ].map(([u, v]) => this.screenOf(c.object3D.localToWorld(new V(u * c.width, v * c.height, 0))));
        const rect = { x0: Math.min(...corners.map((p) => p.x)), x1: Math.max(...corners.map((p) => p.x)), y0: Math.min(...corners.map((p) => p.y)), y1: Math.max(...corners.map((p) => p.y)) };
        const vw = innerWidth;
        const vh = innerHeight;
        const onScreen = rect.x0 >= -1 && rect.y0 >= -1 && rect.x1 <= vw + 1 && rect.y1 <= vh + 1;
        let covers = null;
        if (coverId) {
          const s = a.lights.get(coverId) ? this.light(coverId) : this.node(coverId);
          covers = s.x > rect.x0 && s.x < rect.x1 && s.y > rect.y0 && s.y < rect.y1;
        }
        return { overlaps, outside, onScreen, covers, rect: Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, Math.round(v)])), share: +(((rect.x1 - rect.x0) * (rect.y1 - rect.y0)) / (vw * vh)).toFixed(2), texts: c.boxes.filter((b) => b.kind !== 'button').map((b) => b.text) };
      },
    };
  });
}

function step(flow, name, fn) {
  return async (page) => {
    const t0 = Date.now();
    try {
      const detail = await fn(page);
      results.push({ flow, name, pass: true, ms: Date.now() - t0, detail });
      console.log(`PASS  [${flow}] ${name}  ${JSON.stringify(detail ?? '').slice(0, 220)}`);
    } catch (err) {
      results.push({ flow, name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
      console.log(`FAIL  [${flow}] ${name}  ${String(err.message || err).slice(0, 300)}`);
      await shot(page, `stageA-fail-${flow}-${name.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
    }
  };
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);

/** A light that can grow into the web in this mode, chosen near the middle of the view. */
async function pickLight(page) {
  return ev(page, async (m) => {
    const a = window.__fw.app;
    let ok = a.lights.items.filter((x) => (m === 'offline' ? a.snapshot?.expansions?.[x.id] : x.via === 'wikipedia'));
    if (m === 'offline') {
      // prefer a light whose recorded web holds a node that can open up offline
      const rich = [];
      for (const x of ok) {
        const rec = await fetch(`demo/snapshot/${a.snapshot.expansions[x.id]}`).then((r) => r.json()).catch(() => null);
        if (rec?.events?.some((e) => e.type === 'node' && a.snapshot.explores?.[e.node.id])) rich.push(x);
      }
      // on screen first: the feed is a random draw, so the rich ones may be out of view
      const onScreen = (x) => {
        const s = window.__sa.light(x.id);
        return s.front && s.x > 60 && s.x < innerWidth - 60 && s.y > 60 && s.y < innerHeight - 60;
      };
      if (rich.some(onScreen)) ok = rich;
    }
    const vis = ok.map((x) => ({ id: x.id, s: window.__sa.light(x.id) })).filter((x) => x.s.front && x.s.x > 60 && x.s.x < innerWidth - 60 && x.s.y > 60 && x.s.y < innerHeight - 60);
    vis.sort((p, q) => Math.abs(p.s.x - innerWidth / 2) - Math.abs(q.s.x - innerWidth / 2));
    return vis[0]?.id || null;
  }, mode);
}

async function mouseClick(page, where) {
  if (!where) throw new Error('nothing to click');
  await page.mouse.move(where.x, where.y, { steps: 4 });
  await page.waitForTimeout(250); // hover: the light stops for the pointer
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function entityToExplore(page) {
  return ev(page, (m) => {
    const a = window.__fw.app;
    // explorable entities first; offline only recorded ones can open up, so any entity will do to test the click
    const all = [...a.store.nodes.values()].filter((x) => ['Organisation', 'Place', 'Technology', 'Topic', 'Event', 'PublicFigure'].includes(x.type) && !x.hidden);
    const ents = [...all.filter((x) => a.canExplore(x.id)), ...all.filter((x) => !a.canExplore(x.id))];
    const rec = ents;
    // not behind an open card (a person would not click through a card either)
    const rects = a.cards.open.map((e) => window.__sa.layout(e.key).rect);
    const free = (s) => !rects.some((r) => s.x > r.x0 - 12 && s.x < r.x1 + 12 && s.y > r.y0 - 12 && s.y < r.y1 + 12);
    // and not sitting on top of another node on screen (nobody can click a node hidden behind a hub)
    const others = a.view.visibleIds.map((id) => ({ id, s: window.__sa.node(id) }));
    const clear = (id, s) => !others.some((o) => o.id !== id && Math.hypot(o.s.x - s.x, o.s.y - s.y) < 18);
    const vis = (rec.length ? rec : ents).map((x) => ({ id: x.id, s: window.__sa.node(x.id) })).filter((x) => x.s.front && x.s.x > 30 && x.s.x < innerWidth - 30 && x.s.y > 30 && x.s.y < innerHeight - 30 && free(x.s) && clear(x.id, x.s));
    return vis[0]?.id || null;
  }, mode);
}

// ------------------------------------------------------------- desktop (mouse)
async function desktopFlow() {
  const { browser, context, page, logs } = await launch({ width: 1280, height: 800 });
  try {
    await setup(page, context);
    let lightId;
    let nodeId;
    await step('desktop', 'F5 click a light with the mouse: compact reader card opens', async (p) => {
      for (let tries = 0; tries < 4 && !lightId; tries++) {
        const id = await pickLight(p);
        await mouseClick(p, await ev(p, (x) => window.__sa.light(x), id));
        if (await ev(p, (x) => !!window.__fw.app.cards.get(`light:${x}`), id)) lightId = id;
      }
      if (!lightId) throw new Error('mouse click on a light did not open its card');
      const lay = await ev(p, (x) => window.__sa.layout(`light:${x}`, x), lightId);
      await shot(p, 'stageA-desktop-1-reader-compact');
      if (lay.overlaps.length || lay.outside.length || !lay.onScreen || lay.covers) throw new Error(JSON.stringify(lay));
      return { lightId, share: lay.share, rect: lay.rect };
    })(page);

    await step('desktop', 'F9 labels: source type, LIVE or SNAPSHOT (date), real outlet', async (p) => {
      const r = await ev(p, (x) => {
        const a = window.__fw.app;
        const it = a.getItem(x);
        return { texts: window.__sa.layout(`light:${x}`).texts, source: it.source, via: it.via };
      }, lightId);
      const t = r.texts.join(' | ');
      const typeOk = /\b(NEWS|PAPER|ARCHIVE|FILING|DATASET)\b/.test(t);
      const freshOk = mode === 'live' ? /\bLIVE\b/.test(t) : /SNAPSHOT \d{1,2} \w{3} \d{4}/.test(t);
      const outletOk = r.source && t.includes(r.source.slice(0, 20));
      if (!typeOk || !freshOk || !outletOk) throw new Error(JSON.stringify({ typeOk, freshOk, outletOk, t: t.slice(0, 300) }));
      return { badge: t.match(/(LIVE|SNAPSHOT [^|]+)/)?.[0], outlet: r.source, via: r.via };
    })(page);

    await step('desktop', 'F3 Details by mouse: card grows, no overlap; Hide shrinks it', async (p) => {
      await mouseClick(p, await ev(p, (x) => window.__sa.button(`light:${x}`, 'details'), lightId));
      await p.waitForTimeout(300);
      const big = await ev(p, (x) => ({ h: window.__fw.app.cards.get(`light:${x}`).height, lay: window.__sa.layout(`light:${x}`, x) }), lightId);
      await shot(p, 'stageA-desktop-2-reader-details');
      if (big.h < 0.4 || big.lay.overlaps.length || big.lay.outside.length || !big.lay.onScreen) throw new Error(JSON.stringify(big));
      await mouseClick(p, await ev(p, (x) => window.__sa.button(`light:${x}`, 'details'), lightId));
      const small = await ev(p, (x) => window.__fw.app.cards.get(`light:${x}`).height, lightId);
      if (small > 0.3) throw new Error(`did not shrink: ${small}`);
      return { details: big.h, compact: small, shareDetails: big.lay.share };
    })(page);

    await step('desktop', 'F3 Move by mouse: the card switches sides', async (p) => {
      const before = await ev(p, (x) => window.__fw.app.cards.entry(`light:${x}`).side, lightId);
      await mouseClick(p, await ev(p, (x) => window.__sa.button(`light:${x}`, 'move'), lightId));
      await p.waitForTimeout(700);
      const after = await ev(p, (x) => ({ side: window.__fw.app.cards.entry(`light:${x}`).side, lay: window.__sa.layout(`light:${x}`) }), lightId);
      if (after.side !== -before || !after.lay.onScreen) throw new Error(JSON.stringify({ before, after }));
      await mouseClick(p, await ev(p, (x) => window.__sa.button(`light:${x}`, 'move'), lightId));
      await p.waitForTimeout(700);
      return { from: before, to: after.side };
    })(page);

    await step('desktop', 'F5 the light grows into the web; click an entity node: its card opens (and it opens up where it can)', async (p) => {
      await p.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, lightId, { timeout: 200000 });
      // close the reader card with the mouse, as a person would, so it hides nothing
      await mouseClick(p, await ev(p, (x) => window.__sa.button(`light:${x}`, 'close'), lightId));
      if (await ev(p, (x) => !!window.__fw.app.cards.get(`light:${x}`), lightId)) throw new Error('Close by mouse did not close the reader card');
      await p.waitForTimeout(1500); // let the web settle
      const misses = [];
      for (let tries = 0; tries < 4; tries++) {
        const id = await entityToExplore(p);
        if (!id) break;
        const at = await ev(p, (x) => window.__sa.node(x), id);
        await mouseClick(p, at);
        misses.push({
          id,
          at: [Math.round(at.x), Math.round(at.y)],
          hovered: await ev(p, () => window.__fw.app.view.hoveredId ?? null),
          probe: await ev(p, ({ x, y, id }) => {
            const a = window.__fw.app;
            const cam = window.__fw.world.camera;
            const r = window.__fw.world.renderer.domElement.getBoundingClientRect();
            const V = a.anchor.head.constructor;
            const o = new V().setFromMatrixPosition(cam.matrixWorld);
            const t = new V(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1, 0.5).unproject(cam);
            const ray = { origin: o, direction: t.sub(o).normalize(), distanceToPoint(pt) { const v = pt.clone().sub(this.origin); const along = v.dot(this.direction); return v.sub(this.direction.clone().multiplyScalar(along)).length(); } };
            const sc = a.view.root.getWorldScale(new V()).x;
            const info = (nid) => ({ d: +ray.distanceToPoint(a.view.worldPositionOf(nid, new V())).toFixed(4), r: +((a.view.hitRadius.get(nid) ?? 0) * sc).toFixed(4) });
            return { pick: a.view.pickAlongRay(ray, null), target: info(id), hub: a.view.hoveredId ? info(a.view.hoveredId) : null };
          }, { x: at.x, y: at.y, id }),
        });
        if (await ev(p, (x) => !!window.__fw.app.cards.get(`node:${x}`), id)) {
          nodeId = id;
          break;
        }
      }
      if (!nodeId) throw new Error('mouse click on an entity node did not open its card ' + JSON.stringify(misses));
      const can = await ev(p, (x) => window.__fw.app.canExplore(x), nodeId);
      if (can) await p.waitForFunction((x) => window.__fw.app.store.nodes.get(x)?.explored === true, nodeId, { timeout: 200000 });
      const r = await ev(p, (x) => {
        const a = window.__fw.app;
        const n = a.store.nodes.get(x);
        return { node: n.label, added: (n.addedIds || []).length, lay: window.__sa.layout(`node:${x}`, x) };
      }, nodeId);
      await shot(p, 'stageA-desktop-3-node');
      if ((can && !r.added) || r.lay.overlaps.length || !r.lay.onScreen) throw new Error(JSON.stringify(r));
      return { node: r.node, explorable: can, added: r.added, cardShare: r.lay.share, covers: r.lay.covers };
    })(page);

    await step('desktop', 'F5 aimed picking: a node inside a neighbour hit sphere opens on click', async (p) => {
      await ev(p, () => window.__fw.app.cards.closeAll());
      await p.waitForTimeout(800);
      // a node whose screen point is covered first by another node's (enlarged) hit sphere
      const c = await ev(p, () => {
        const a = window.__fw.app;
        const w = window.__fw.world;
        const V = a.anchor.head.constructor;
        const out = [];
        for (const id of a.view.visibleIds) {
          const s = window.__sa.node(id);
          if (!s.front || s.x < 20 || s.y < 20 || s.x > innerWidth - 20 || s.y > innerHeight - 20) continue;
          const cam = w.camera;
          const o = new V().setFromMatrixPosition(cam.matrixWorld);
          const r = w.renderer.domElement.getBoundingClientRect();
          const t = new V(((s.x - r.left) / r.width) * 2 - 1, -((s.y - r.top) / r.height) * 2 + 1, 0.5).unproject(cam);
          const ray = { origin: o, direction: t.sub(o).normalize(), distanceToPoint(pt) { const v = pt.clone().sub(this.origin); const al = v.dot(this.direction); return v.sub(this.direction.clone().multiplyScalar(al)).length(); } };
          // the first sphere along the ray (what a plain raycast would return)
          const sc = a.view.root.getWorldScale(new V()).x;
          let first = null;
          let firstT = Infinity;
          for (const nid of a.view.hitOrder) {
            const c0 = a.view.worldPositionOf(nid, new V());
            const rad = (a.view.hitRadius.get(nid) ?? 0) * sc;
            const along = c0.clone().sub(o).dot(ray.direction);
            const d = ray.distanceToPoint(c0);
            if (d > rad || along < 0) continue;
            const tt = along - Math.sqrt(rad * rad - d * d);
            if (tt < firstT) {
              firstT = tt;
              first = nid;
            }
          }
          if (first && first !== id && a.view.pickAlongRay(ray, first) === id) out.push({ id, first, s });
        }
        return out[0] || null;
      });
      if (!c) return { skipped: 'no overlapping pair in this web (nothing to test)' };
      await mouseClick(p, c.s);
      const opened = await ev(p, () => window.__fw.app.cards.open.map((e) => e.key));
      if (!opened.includes(`node:${c.id}`)) throw new Error(JSON.stringify({ wanted: c.id, coveredBy: c.first, opened }));
      return { opened: c.id, coveredBy: c.first };
    })(page);

    await step('desktop', 'no console errors', async () => {
      const errs = errorsOf(logs).filter((l) => mode !== 'offline' || !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
      if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
      return { messages: logs.length };
    })(page);
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------- F3/F4 layout at three sizes
async function layoutSizes() {
  for (const [w, h] of VIEWPORTS) {
    const { browser, context, page } = await launch({ width: w, height: h });
    try {
      await setup(page, context);
      await step('layout', `F3/F4 reader card at ${w}x${h}: compact and details, three lights`, async (p) => {
        const out = await ev(p, async () => {
          const a = window.__fw.app;
          // the longest headlines and summaries are the hardest case
          const items = [...a.lights.items].sort((x, y) => `${y.headline}${y.summary}`.length - `${x.headline}${x.summary}`.length).slice(0, 3);
          const res = [];
          for (const it of items) {
            for (const details of [false, true]) {
              a.cards.closeAll();
              a.readerDetails = new Set(details ? [it.id] : []);
              a.settings ??= null;
              a.openLight(it.id);
              a.expanding?.controller?.abort?.();
              await new Promise((r) => setTimeout(r, 450));
              const lay = window.__sa.layout(`light:${it.id}`, it.id);
              res.push({ id: it.id, details, overlaps: lay.overlaps, outside: lay.outside, onScreen: lay.onScreen, covers: lay.covers, share: lay.share });
            }
          }
          return res;
        });
        await shot(p, `stageA-layout-${w}x${h}`);
        const bad = out.filter((r) => r.overlaps.length || r.outside.length || !r.onScreen || r.covers);
        if (bad.length) throw new Error(JSON.stringify(bad).slice(0, 600));
        return { checked: out.length, maxShare: Math.max(...out.map((r) => r.share)) };
      })(page);
    } finally {
      await browser.close();
    }
  }
}

// ------------------------------------------------------------- hands (IWER)
async function handsFlow() {
  const { browser, context, page, logs } = await launch({ width: 1280, height: 800 });
  try {
    await setup(page, context);
    await enterXR(page);
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
        async press(key, id) {
          await wait(400);
          const p = a.cards.get(key)?.buttonWorldPosition(id);
          if (!p) throw new Error(`no button ${key}/${id}`);
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
      };
    });
    let lightId;
    await step('hands', 'F5 pinch a light: compact reader card; pinch Details', async (p) => {
      const ids = await ev(p, (m) => window.__fw.app.lights.items.filter((x) => (m === 'offline' ? window.__fw.app.snapshot?.expansions?.[x.id] : x.via === 'wikipedia')).map((x) => x.id), mode);
      for (const id of ids) {
        await ev(p, (x) => window.__qa.pinchLight(x), id);
        if (await ev(p, (x) => !!window.__fw.app.cards.get(`light:${x}`), id)) {
          lightId = id;
          break;
        }
      }
      if (!lightId) throw new Error('no reader card opened by pinch');
      await ev(p, (x) => window.__qa.press(`light:${x}`, 'details'), lightId);
      const h = await ev(p, (x) => window.__fw.app.cards.get(`light:${x}`).height, lightId);
      await shot(p, 'stageA-hands-1-reader-details');
      if (h < 0.4) throw new Error(`Details by pinch did not grow the card (${h})`);
      return { lightId, height: h };
    })(page);
    await step('hands', 'F5 pinch an entity node: it opens up', async (p) => {
      await p.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, lightId, { timeout: 200000 });
      await ev(p, () => window.__fw.app.cards.closeAll());
      await p.waitForTimeout(1500);
      // explorable entities; in a dense web a nearer node can catch the ray, so try them in turn
      const ids = await ev(p, (m) => {
        const a = window.__fw.app;
        const ents = [...a.store.nodes.values()].filter((x) => ['Organisation', 'Place', 'Technology', 'Topic', 'Event'].includes(x.type) && !x.derived && !x.hidden && a.canExplore(x.id));
        return (m === 'offline' ? ents.filter((x) => a.snapshot.explores?.[x.id]) : ents).map((x) => x.id);
      }, mode);
      if (!ids.length) throw new Error('no entity to explore');
      let byHand = false;
      let id = null;
      const tried = [];
      for (const cand of ids.slice(0, 4)) {
        for (let k = 0; k < 2 && !byHand; k++) {
          await ev(p, () => window.__fw.app.cards.closeAll());
          await ev(p, (x) => window.__qa.pinchNode(x), cand);
          byHand = await ev(p, (x) => !!window.__fw.app.cards.get(`node:${x}`), cand);
          if (!byHand) {
            tried.push({ cand, opened: await ev(p, () => window.__fw.app.cards.open.map((e) => e.key)) });
            await ev(p, () => window.__fw.app.keypad.isOpen && window.__fw.app.keypad.close());
          }
        }
        if (byHand) {
          // live data: some entities have nothing in open sources; then try the next one
          await p.waitForFunction((x) => window.__fw.app.store.nodes.get(x)?.explored === true, cand, { timeout: 200000 });
          if (mode === 'live' && !(await ev(p, (x) => (window.__fw.app.store.nodes.get(x).addedIds || []).length, cand))) {
            tried.push({ cand, empty: true });
            byHand = false;
            continue;
          }
          id = cand;
          break;
        }
      }
      if (!byHand) throw new Error('pinch on a node did not open its card ' + JSON.stringify(tried));
      await p.waitForFunction((x) => window.__fw.app.store.nodes.get(x)?.explored === true, id, { timeout: 200000 });
      const added = await ev(p, (x) => (window.__fw.app.store.nodes.get(x).addedIds || []).length, id);
      await shot(p, 'stageA-hands-2-node-explored');
      if (!added) throw new Error('explore added nothing');
      return { node: id, added, nearMisses: tried.length };
    })(page);
    await step('hands', 'no console errors', async () => {
      const errs = errorsOf(logs).filter((l) => mode !== 'offline' || !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
      if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
      return { messages: logs.length };
    })(page);
  } finally {
    await browser.close();
  }
}

await desktopFlow();
await layoutSizes();
await handsFlow();
writeFileSync(`${OUT}/stageA-results.json`, JSON.stringify({ when: new Date().toISOString(), mode, scripted: true, results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} passed (${mode}; Playwright mouse on the flat page + scripted IWER hands; not a real Quest)`);
process.exit(passed === results.length ? 0 : 1);
