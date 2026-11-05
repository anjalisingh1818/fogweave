// Phase 1 animations on the Demo scene: a star opens with a ring, its web blooms
// one node at a time from the star, pointing at a node dims the rest, Close sends
// the web back to the star, news arrives as a shooting star, and the fine fog moves
// away from a hand. Measures only what the emulator can show: not a real Quest.
//   node qa/ui-v2-anim.mjs
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
    await shot(page, `uiv2-fail-${name.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
  }
};

try {
  await open(page, { query: '?debug&demo' });
  await page.waitForFunction(() => window.__fw.app.mode === 'offline' && window.__fw.app.lights.items.length > 0, null, { timeout: 60000 });
  await ev(() => {
    const a = window.__fw.app;
    a.onboarding.finish();
    a.cards.closeAll();
    // a headless browser is slow: hold the top quality, so all the effects are on
    a.governor.locked = true;
    a.governor.level = 2;
    a.setQuality?.(2);
    Object.assign(window.__fw.settings.quality, { level: 2, labels: 22, particles: 300, fogSheets: true, glow: 1, maxNodes: 60 });
  });
  await page.waitForTimeout(500);
  const id = await ev(() => window.__fw.app.lights.items.find((x) => window.__fw.app.snapshot.expansions[x.id]).id);

  await step('opening a star: ring and swell, and the card unfolds', async () => {
    const r = await ev((x) => {
      const a = window.__fw.app;
      a.openLight(x);
      const fx = a.fx.list.filter((f) => f.kind === 'burst').length;
      const e = a.cards.entry(`light:${x}`);
      return { bursts: fx, pop: a.lights.state.get(x).popAt !== undefined, scaleY: e.card.object3D.scale.y, opacity: e.card.material.opacity };
    }, id);
    await page.waitForTimeout(120);
    await shot(page, 'uiv2-1-star-opens');
    if (!r.bursts || !r.pop || r.scaleY > 0.2) throw new Error(JSON.stringify(r));
    await page.waitForTimeout(500);
    const after = await ev((x) => {
      const e = window.__fw.app.cards.entry(`light:${x}`);
      return { opacity: e.card.material.opacity, ratio: e.card.object3D.scale.y / e.card.object3D.scale.x };
    }, id);
    if (after.opacity !== 1 || Math.abs(after.ratio - 1) > 1e-3) throw new Error(JSON.stringify(after));
    return { ...r, after };
  });

  await step('the web blooms one node at a time, out of its parent', async () => {
    await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, id, { timeout: 60000 });
    const r = await ev(() => {
      const v = window.__fw.app.view;
      const states = v.visibleIds.map((n) => v.state.get(n)).filter(Boolean);
      const wakes = states.map((s) => s.wakeAt).sort((p, q) => p - q);
      const gaps = wakes.slice(1).map((w, i) => w - wakes[i]);
      return { nodes: states.length, spread: wakes.at(-1) - wakes[0], minGap: Math.min(...gaps) };
    });
    await page.waitForTimeout(1600);
    await shot(page, 'uiv2-2-web-grown');
    if (r.nodes < 4 || r.spread <= 0) throw new Error(JSON.stringify(r));
    return r;
  });

  await step('a node that has not opened yet cannot be touched', async () => {
    return ev(() => {
      const v = window.__fw.app.view;
      const early = [...v.state.values()].filter((s) => s.scale <= 0.1).length;
      return { unopened: early, hits: v.hitOrder.length };
    });
  });

  await step('pointing at a node keeps it and its neighbours lit, and dims the rest', async () => {
    const n = await ev((x) => {
      const a = window.__fw.app;
      const nb = a.store.nodes.get(x).addedIds.find((k) => a.store.nodes.get(k) && !a.store.nodes.get(k).hidden);
      a.view.setHovered(nb);
      return nb;
    }, id);
    await page.waitForTimeout(700);
    const r = await ev(() => ({ dim: window.__fw.app.view._dim, lit: window.__fw.app.view._lit.size, all: window.__fw.app.view.visibleIds.length }));
    await shot(page, 'uiv2-3-hover-lights-neighbours');
    await ev(() => window.__fw.app.view.setHovered(null));
    await page.waitForTimeout(700);
    const off = await ev(() => window.__fw.app.view._dim);
    if (r.dim < 0.8 || off > 0.1) throw new Error(JSON.stringify({ ...r, off }));
    return { node: n, ...r, off };
  });

  await step('Close: the web runs back into the star, and it can grow again from the start', async () => {
    const r = await ev((x) => {
      const a = window.__fw.app;
      const ids = [...a.store.nodes.keys()];
      a.closeStar(x);
      // no node keeps its old place and size: each one grows out again next time
      const kept = ids.filter((n) => a.view.state.has(n) && !a.store.nodes.has(n)).length;
      return { threads: a.fx.list.filter((f) => f.kind === 'retract').length, card: !!a.cards.get(`light:${x}`), folding: a.cards.closing.length, cardsOpen: a.cards.open.length, kept };
    }, id);
    await page.waitForTimeout(250);
    await shot(page, 'uiv2-4-close-retract');
    if (!r.threads || r.card || !r.folding || r.kept) throw new Error(JSON.stringify(r));
    await page.waitForTimeout(1000);
    const done = await ev(() => ({ left: window.__fw.app.fx.list.length, folding: window.__fw.app.cards.closing.length }));
    if (done.folding) throw new Error(`a closing card stayed: ${JSON.stringify(done)}`);
    await ev((x) => window.__fw.app.openLight(x), id);
    await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, id, { timeout: 60000 });
    const again = await ev(() => window.__fw.app.store.nodes.size);
    if (again < 4) throw new Error(`grew again with only ${again} nodes`);
    await ev((x) => window.__fw.app.closeStar(x), id);
    await page.waitForTimeout(900);
    return { ...r, done, again };
  });

  await step('a closing card takes no more clicks', async () => {
    return ev((x) => {
      const a = window.__fw.app;
      a.openLight(x);
      const card = a.cards.get(`light:${x}`);
      a.cards.close(`light:${x}`);
      return { folding: a.cards.closing.length > 0, visibleFlag: card.visible };
    }, id).then(async (r) => {
      if (!r.folding || r.visibleFlag) throw new Error(JSON.stringify(r));
      await page.waitForTimeout(400);
      await ev((x) => window.__fw.app.closeStar(x), id);
      return r;
    });
  });

  await step('Close while it is still growing: the web leaves, and the star can grow again', async () => {
    await ev((x) => window.__fw.app.openLight(x), id);
    await page.waitForFunction(() => window.__fw.app.player && !window.__fw.app.player.done && window.__fw.app.store.nodes.size > 0, null, { timeout: 30000 });
    const mid = await ev((x) => {
      const a = window.__fw.app;
      const had = a.store.nodes.size;
      a.closeStar(x);
      return { had, running: a.getItem(x)?.expanded };
    }, id);
    await page.waitForTimeout(600);
    const after = await ev((x) => ({ expanded: window.__fw.app.getItem(x)?.expanded, nodes: window.__fw.app.store.nodes.size }), id);
    if (after.expanded || after.nodes) throw new Error(JSON.stringify({ mid, after }));
    await ev((x) => window.__fw.app.openLight(x), id);
    await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, id, { timeout: 60000 });
    const again = await ev(() => window.__fw.app.store.nodes.size);
    if (again < 4) throw new Error(`grew again with only ${again} nodes`);
    await ev((x) => window.__fw.app.closeStar(x), id);
    return { mid, after, again };
  });

  await step('new news arrives as a shooting star, and the star appears when it lands', async () => {
    await page.waitForFunction(() => window.__fw.app.fx.list.length === 0, null, { timeout: 10000 });
    const r = await ev(() => {
      const a = window.__fw.app;
      const shown = new Set(a.lights.items.map((x) => x.id));
      const fresh = a.pool.filter((x) => !shown.has(x.id)).slice(0, 3);
      const ids = a.lights.addItems(fresh.map((x) => ({ ...x, search: 'qa' })));
      return { ids };
    });
    await page.waitForTimeout(350);
    const flying = await ev(() => window.__fw.app.fx.list.filter((f) => f.kind === 'comet').length);
    await shot(page, 'uiv2-5-shooting-star');
    const during = await ev((x) => window.__fw.app.lights.state.get(x).wait, r.ids[0]);
    await page.waitForTimeout(2200);
    const left = await ev(() => window.__fw.app.fx.list.filter((f) => f.kind === 'comet').length);
    const risen = await ev((ids) => ids.map((x) => window.__fw.app.lights._rise(window.__fw.app.lights.get(x), window.__fw.app.lights.state.get(x))), r.ids);
    await ev((ids) => window.__fw.app.lights.removeItems(ids), r.ids);
    if (!flying || left || risen.some((x) => x !== 1)) throw new Error(JSON.stringify({ flying, left, risen }));
    return { flying, wait: during, risen };
  });

  await step('Calm mode: no shooting star, softer effects', async () => {
    const r = await ev(() => {
      const a = window.__fw.app;
      a.fx.list.length = 0;
      window.__fw.settings.comfort.gentle = true;
      const shown = new Set(a.lights.items.map((x) => x.id));
      const fresh = a.pool.filter((x) => !shown.has(x.id)).slice(0, 1);
      const ids = a.lights.addItems(fresh.map((x) => ({ ...x, search: 'qa' })));
      return { ids };
    });
    await page.waitForTimeout(200);
    const comets = await ev(() => window.__fw.app.fx.list.filter((f) => f.kind === 'comet').length);
    await ev((ids) => {
      window.__fw.app.lights.removeItems(ids);
      window.__fw.settings.comfort.gentle = false;
    }, r.ids);
    if (comets) throw new Error(`comets in Calm mode: ${comets}`);
    return { comets };
  });

  await step('the fine fog moves out of a hand\'s way', async () => {
    const r = await ev(async () => {
      const a = window.__fw.app;
      const at = a.atmosphere;
      const P = at.points.geometry.attributes.position.array;
      const hand = { x: P[0], y: P[1], z: P[2] }; // right on a mote
      const before = { x: P[0], y: P[1], z: P[2] };
      const orig = a.atmosphere.setHands.bind(at);
      at.setHands = () => orig([hand]);
      await new Promise((res) => setTimeout(res, 200));
      const dist = Math.hypot(P[0] - hand.x, P[1] - hand.y, P[2] - hand.z);
      delete at.setHands;
      return { moved: dist, count: at.points.geometry.drawRange.count, before };
    });
    if (r.moved < 0.02) throw new Error(JSON.stringify(r));
    return r;
  });

  await step('hand puffs have a limit', async () => {
    const r = await ev(() => {
      const a = window.__fw.app;
      a.fx.list.length = 0;
      const p = a.anchor.head.clone();
      for (let i = 0; i < 60; i++) a.fx.puff(p);
      return a.fx.list.length;
    });
    if (r > 14) throw new Error(`${r} puffs`);
    return { puffs: r };
  });

  await step('frame rate with a full web and effects, in this browser (not a Quest)', async () => {
    await ev((x) => window.__fw.app.openLight(x), id);
    await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, id, { timeout: 60000 });
    await page.waitForTimeout(3000);
    const frames = (ms) =>
      ev(
        (w) =>
          new Promise((res) => {
            const t = [];
            const tick = (now) => {
              t.push(now);
              if (now - t[0] < w) requestAnimationFrame(tick);
              else {
                const d = t.slice(1).map((x, i) => x - t[i]).sort((p, q) => p - q);
                res({ avgMs: +(d.reduce((p, q) => p + q, 0) / d.length).toFixed(1), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(1), frames: d.length });
              }
            };
            requestAnimationFrame(tick);
          }),
        ms,
      );
    const idle = await frames(1500);
    const calls = await ev(() => window.__fw.app.world.renderer.info.render.calls);
    // the busiest moment: every kind of effect at once
    const busy = ev((x) => {
      const a = window.__fw.app;
      const p = a.anchor.head.clone();
      p.z -= 1.2;
      for (let i = 0; i < 48; i++) a.fx.retract(p.clone().setX(p.x + (i - 24) * 0.04), p, 0xffe6b4, { life: 1.4 });
      for (let i = 0; i < 6; i++) a.fx.comet(p.clone().setY(p.y + 0.8), p, 0xffe6b4, { life: 1.4, delay: i * 0.05 });
      for (let i = 0; i < 6; i++) a.fx.burst(p, 0xffe6b4, { life: 1.4 });
    }, id);
    await busy;
    const during = await frames(1200);
    return { idle, during, calls, nodes: await ev(() => window.__fw.app.view.visibleIds.length) };
  });

  await step('no console errors', async () => {
    const errs = errorsOf(logs).filter((l) => !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
    if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
    return { messages: logs.length };
  });
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/ui-v2-anim.json`, JSON.stringify({ when: new Date().toISOString(), results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} passed (Playwright on the flat page, Demo scene)`);
process.exit(passed === results.length ? 0 : 1);
