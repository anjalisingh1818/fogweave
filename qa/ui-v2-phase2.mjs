// Phase 2 on the Demo scene: text that fits on bigger cards, quotes one pinch away,
// the label's meaning on the card, older news further away, your constellation, and
// sounds that start only after a gesture. It can check that a sound was made, not
// how it sounds. Not a real Quest.
//   node qa/ui-v2-phase2.mjs
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
    await shot(page, `uiv2p2-fail-${name.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
  }
};
const overlaps = (key) =>
  ev((k) => {
    const c = window.__fw.app.cards.get(k);
    const boxes = c.boxes.filter((b) => b.w > 0 && b.h > 0);
    const bad = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i];
        const q = boxes[j];
        if (Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 2 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 2) bad.push(`${p.text} / ${q.text}`);
      }
    const out = boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > c.canvas.width || b.y + b.h > c.canvas.height).map((b) => b.text);
    return { bad, out, texts: c.boxes.map((b) => b.text) };
  }, key);

try {
  await open(page, { query: '?debug&demo' });
  await page.waitForFunction(() => window.__fw.app.mode === 'offline' && window.__fw.app.lights.items.length > 0, null, { timeout: 60000 });
  await ev(() => {
    const a = window.__fw.app;
    a.onboarding.finish();
    a.cards.closeAll();
    a.governor.locked = true;
    Object.assign(window.__fw.settings.quality, { level: 2, labels: 22, particles: 300, fogSheets: true, glow: 1, maxNodes: 60 });
  });
  const id = await ev(() => window.__fw.app.lights.items.find((x) => window.__fw.app.snapshot.expansions[x.id]).id);

  // count the sounds without hearing them
  await ev(() => {
    const am = window.__fw.app.ambient;
    window.__sounds = [];
    for (const k of ['chime', 'pluck', 'tick', 'bell', 'shimmer', 'whoosh']) {
      const f = am[k].bind(am);
      am[k] = (...x) => {
        window.__sounds.push(k);
        return f(...x);
      };
    }
  });

  await step('no sound before a gesture; the first click starts it', async () => {
    const before = await ev(() => window.__fw.app.ambient.on);
    await page.mouse.click(640, 700);
    await page.waitForTimeout(300);
    const after = await ev(() => window.__fw.app.ambient.on);
    if (before || !after) throw new Error(JSON.stringify({ before, after }));
    return { before, after };
  });

  await step('the news card: bigger text, nothing overlaps or runs off, two lines of summary', async () => {
    await ev((x) => window.__fw.app.openLight(x), id);
    await page.waitForTimeout(600);
    const r = await overlaps(`light:${id}`);
    await shot(page, 'uiv2p2-1-news-card');
    if (r.bad.length || r.out.length) throw new Error(JSON.stringify(r));
    return { boxes: r.texts.length };
  });

  await step('a growing web plays its sounds', async () => {
    await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, id, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const s = await ev(() => window.__sounds);
    if (!s.includes('chime') || !s.includes('pluck')) throw new Error(JSON.stringify(s));
    return { chime: s.filter((x) => x === 'chime').length, plucks: s.filter((x) => x === 'pluck').length };
  });

  await step('older news sits further away and says its year; the story itself does not move', async () => {
    const r = await ev((x) => {
      const a = window.__fw.app;
      const v = a.view;
      const rows = [...a.store.nodes.values()].filter((n) => n.type === 'NewsItem' && v.state.has(n.id)).map((n) => ({ id: n.id, date: String(n.date || '').slice(0, 10), depth: v.state.get(n.id).depth || 0 }));
      return { rows, story: v.state.get(x).depth || 0, from: new Date(v.depthFrom).toISOString().slice(0, 10) };
    }, id);
    const older = r.rows.filter((n) => n.date && Date.parse(n.date) < Date.parse(r.from) - 30 * 86400000);
    if (r.story !== 0 || older.some((n) => n.depth <= 0)) throw new Error(JSON.stringify(r));
    const sorted = [...older].sort((p, q) => p.date.localeCompare(q.date));
    for (let i = 1; i < sorted.length; i++) if (sorted[i].depth > sorted[i - 1].depth + 1e-6) throw new Error(`newer news is further: ${JSON.stringify(sorted)}`);
    await ev((n) => window.__fw.app.view.showGroup?.(n), id);
    await shot(page, 'uiv2p2-2-time-as-depth');
    return { story: r.story, older: sorted.map((n) => `${n.date}:${n.depth.toFixed(2)}`) };
  });

  await step('a node card says what its label means, and fits', async () => {
    const n = await ev((x) => {
      const a = window.__fw.app;
      const k = a.store.nodes.get(x).addedIds.find((q) => {
        const m = a.store.nodes.get(q);
        return m && !m.hidden && !['Claim', 'Source'].includes(m.type);
      });
      a.pinchNode(k);
      return k;
    }, id);
    await page.waitForTimeout(700);
    const r = await overlaps(`node:${n}`);
    await shot(page, 'uiv2p2-3-node-card');
    if (r.bad.length || r.out.length) throw new Error(JSON.stringify({ bad: r.bad, out: r.out }));
    return { node: n, meaning: r.texts.filter((t) => /^(Reported|Inferred|Speculative): /.test(t)) };
  });

  await step('a related news card: quotes one pinch away, in and out, with no overlap', async () => {
    const n = await ev((x) => {
      const a = window.__fw.app;
      a.cards.closeAll();
      const related = [...a.store.edges.values()].filter((e) => (e.from === x || e.to === x) && (e.evidence || []).filter((q) => q.quote).length >= 2).map((e) => (e.from === x ? e.to : e.from));
      return related.find((k) => a.store.nodes.get(k)?.type === 'NewsItem') || null;
    }, id);
    if (!n) return { skipped: 'this recorded story has no related news with two quotes' };
    await ev((k) => window.__fw.app.pinchNode(k), n);
    await page.waitForTimeout(600);
    const count = () => ev((k) => window.__fw.app.cards.get(`node:${k}`).boxes.filter((b) => b.text.startsWith('“')).length, n);
    const closed = await count();
    await ev((k) => window.__fw.app.cards.get(`node:${k}`).press('quotes'), n);
    await page.waitForTimeout(250);
    const opened = await count();
    const r = await overlaps(`node:${n}`);
    await shot(page, 'uiv2p2-4-quotes-open');
    if (closed || opened < 2 || r.bad.length || r.out.length) throw new Error(JSON.stringify({ closed, opened, bad: r.bad, out: r.out }));
    return { closed, opened };
  });

  await step('Seal: the item flies up and a star joins your constellation', async () => {
    const before = await ev(() => window.__fw.app.constellation.stars.size);
    const r = await ev((x) => {
      const a = window.__fw.app;
      a.cards.closeAll();
      a.sealLight(x);
      return { comets: a.fx.list.filter((f) => f.kind === 'comet').length, stars: a.constellation.stars.size, bell: window.__sounds.includes('bell') };
    }, id);
    await page.waitForTimeout(1200);
    if (before !== 0 || r.stars < 1 || !r.comets || !r.bell) throw new Error(JSON.stringify({ before, ...r }));
    return { before, ...r };
  });

  await step('more seals grow one connected shape, in view and within the budget', async () => {
    const r = await ev(() => {
      const a = window.__fw.app;
      for (const it of a.lights.items.slice(0, 7)) a.sealLight(it.id);
      return a.constellation.stars.size;
    });
    await page.waitForTimeout(1800);
    const shape = await ev(() => {
      const c = window.__fw.app.constellation;
      const cam = window.__fw.app.world.camera;
      const stars = [...c.stars.values()];
      const inView = stars.filter((s) => {
        const p = c.worldPositionOf(s.id).project(cam);
        return Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1;
      }).length;
      return { stars: stars.length, withParent: stars.filter((s) => s.parent).length, inView, lines: c.lines.geometry.drawRange.count / 2 };
    });
    await shot(page, 'uiv2p2-5-constellation');
    if (shape.stars !== r || shape.withParent < shape.stars - 1 || shape.lines < 1 || shape.inView < shape.stars) throw new Error(JSON.stringify(shape));
    return shape;
  });

  await step('the constellation comes back after a reload, in the same place', async () => {
    const before = await ev(() => [...window.__fw.app.constellation.stars.values()].map((s) => [s.id, +s.yaw.toFixed(4)]).sort());
    await page.reload();
    await page.waitForFunction(() => window.__fw?.app?.mode === 'offline' && window.__fw.app.lights.items.length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    const after = await ev(() => [...window.__fw.app.constellation.stars.values()].map((s) => [s.id, +s.yaw.toFixed(4)]).sort());
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(JSON.stringify({ before: before.length, after: after.length }));
    return { stars: after.length, flying: await ev(() => window.__fw.app.fx.list.filter((f) => f.kind === 'comet').length) };
  });

  await step('touching a constellation star opens it; a click there is not "empty fog"', async () => {
    const r = await ev(() => {
      const a = window.__fw.app;
      a.cards.closeAll();
      const star = [...a.constellation.stars.keys()][0];
      a.constellation.onSelect(star);
      const c = a.world.renderer.domElement;
      const p = a.constellation.worldPositionOf(star).project(a.world.camera);
      const b = c.getBoundingClientRect();
      const empty = a.isEmptyAt(b.left + ((p.x + 1) / 2) * b.width, b.top + ((1 - p.y) / 2) * b.height, c);
      return { cards: a.cards.open.map((e) => e.key), empty };
    });
    if (!r.cards.length || r.empty) throw new Error(JSON.stringify(r));
    return r;
  });

  await step('Unseal: the star leaves the constellation', async () => {
    return ev(() => {
      const a = window.__fw.app;
      const before = a.constellation.stars.size;
      const k = Object.keys(a.sealedLights)[0];
      a.unsealLight(k);
      const after = a.constellation.stars.size;
      if (after !== before - 1 || a.constellation.stars.has(k)) throw new Error(JSON.stringify({ before, after }));
      return { before, after };
    });
  });

  await step('Calm mode: softer, with no flying lights', async () => {
    return ev(() => {
      const a = window.__fw.app;
      a.fx.list.length = 0;
      window.__fw.settings.comfort.gentle = true;
      const it = a.lights.items.find((x) => !a.lights.sealed.has(x.id));
      a.sealLight(it.id);
      const comets = a.fx.list.filter((f) => f.kind === 'comet').length;
      window.__fw.settings.comfort.gentle = false;
      if (comets) throw new Error(`${comets} comets`);
      return { comets, soft: a.ambient.soft };
    });
  });

  await step('no console errors', async () => {
    const errs = errorsOf(logs).filter((l) => !/ERR_FAILED|net::|Failed to load resource|AudioContext/.test(l.text));
    if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
    return { messages: logs.length };
  });
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/ui-v2-phase2.json`, JSON.stringify({ when: new Date().toISOString(), results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} passed (Playwright on the flat page, Demo scene)`);
process.exit(passed === results.length ? 0 : 1);
