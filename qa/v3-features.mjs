// V3-LITE features, scripted IWER hands:
//  - welcome screen until the stars are in; My context is gone from the Menu
//  - a star grows: about 5 closest nodes first, the rest behind group buttons
//    ("+3 People" ...) that bring them in by pinch
//  - Ask the fog: news arrives as stars (one Search group); Clear stars by pinch
//  - Library → Find patterns by pinch (Connect the dots)
//   node qa/v3-features.mjs [offline|live|both]   (default both)
import { writeFileSync } from 'node:fs';
import { launch, open, enterXR, shot, errorsOf, OUT } from './lib.mjs';

const which = process.argv[2] || 'both';
const results = [];

async function handsHelpers(page) {
  await page.evaluate(() => {
    const d = window.IWER_DEVICE;
    const a = window.__fw.app;
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
        if (key === 'help-button') return a.helpButton;
        return a.cards.get(key);
      },
      async press(key, id) {
        await wait(400);
        const p = this.card(key)?.buttonWorldPosition(id);
        if (!p) throw new Error(`no button ${key}/${id} (has ${this.card(key)?.buttonIds()})`);
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
      async menu() {
        const p = a.helpButton.buttonWorldPosition('help');
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
    };
  });
}

async function run(mode) {
  const { browser, context, page, logs } = await launch();
  const ev = (fn, a) => page.evaluate(fn, a);
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      results.push({ mode, name, pass: true, ms: Date.now() - t0, detail });
      console.log(`PASS  [${mode}] ${name}  ${JSON.stringify(detail ?? '').slice(0, 400)}`);
    } catch (err) {
      results.push({ mode, name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
      console.log(`FAIL  [${mode}] ${name}  ${String(err.message || err).slice(0, 400)}`);
      await shot(page, `v3f-fail-${mode}-${name.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
    }
  };
  try {
    if (mode === 'offline') await context.route('http://localhost:8787/**', (r) => r.abort());
    const welcomeAtStart = await (async () => {
      await open(page, { query: mode === 'offline' ? '?debug&demo' : '?debug' });
      return page.evaluate(() => !!document.getElementById('welcome'));
    })();
    await enterXR(page);
    await handsHelpers(page);
    await page.waitForFunction(() => window.__fw.app.mode !== 'starting' && window.__fw.app.lights.items.length > 0, null, { timeout: 150000 });
    await ev(() => {
      window.__fw.app.onboarding.finish();
      window.__fw.app.cards.closeAll();
    });

    await step('welcome screen until the stars are in; Menu has no My context', async () => {
      await page.waitForTimeout(1200);
      const gone = await ev(() => !document.getElementById('welcome') || document.getElementById('welcome').classList.contains('gone'));
      await ev(() => window.__qa.menu());
      await page.waitForTimeout(500);
      const menu = await ev(() => window.__fw.app.cards.get('help')?.buttonIds() || []);
      await ev(() => window.__fw.app.closeCard('help'));
      if (!welcomeAtStart || !gone) throw new Error(JSON.stringify({ welcomeAtStart, gone }));
      if (menu.includes('context') || !menu.includes('library')) throw new Error(`menu: ${menu}`);
      return { welcomeAtStart, gone, menu };
    });

    if (mode === 'offline') {
      await step('a star grows: about 5 closest nodes first; a group button by pinch brings more', async () => {
        const id = await ev(() => {
          const a = window.__fw.app;
          return a.lights.items.find((x) => a.snapshot.expansions[x.id])?.id;
        });
        await ev((x) => window.__fw.app.openLight(x), id);
        await ev((x) => window.__fw.app.expandLight(x), id);
        await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, id, { timeout: 60000 });
        await ev((x) => window.__fw.app.pinchNode(x), id);
        await page.waitForTimeout(600);
        const before = await ev((x) => {
          const a = window.__fw.app;
          const added = a.store.nodes.get(x).addedIds;
          return { added: added.length, shown: added.filter((n) => !a.store.nodes.get(n)?.hidden).length, groups: a.hiddenGroups(x).map((g) => `${g.label} ${g.ids.length}`), chips: a.cards.get(`node:${x}`).buttonIds().filter((b) => b.startsWith('grp:')) };
        }, id);
        if (before.shown > 5 || !before.chips.length) throw new Error(JSON.stringify(before));
        await ev((c) => window.__qa.press(`node:${c.id}`, c.chip), { id, chip: before.chips[0] });
        await page.waitForTimeout(500);
        const after = await ev((x) => {
          const a = window.__fw.app;
          return a.store.nodes.get(x).addedIds.filter((n) => !a.store.nodes.get(n)?.hidden).length;
        }, id);
        await shot(page, 'v3f-offline-groups');
        if (after <= before.shown) throw new Error(`group press showed nothing: ${JSON.stringify({ before, after })}`);
        return { ...before, shownAfterGroup: after };
      });
    }

    let searchIds = [];
    await step('Ask the fog: news about it arrives as stars; Clear stars by pinch', async () => {
      const q = await ev((m) => {
        const a = window.__fw.app;
        if (m !== 'offline') return 'Ukraine';
        // a word from a recorded news item that is not drifting now
        const shown = new Set(a.lights.items.map((x) => x.id));
        const it = a.pool.find((x) => !shown.has(x.id) && /[A-Z][a-z]{5,}/.test(x.headline));
        return it.headline.match(/[A-Z][a-z]{5,}/)[0];
      }, mode);
      await ev((x) => window.__fw.app.askFog(x), q);
      await page.waitForFunction(() => window.__fw.app.searchGroup && window.__fw.app.cards.get('answer'), null, { timeout: 120000 });
      const r = await ev(() => {
        const a = window.__fw.app;
        const g = a.searchGroup;
        return { q: g.q, stars: g.ids.length, flagged: g.ids.filter((id) => a.lights.get(id)?.search).length, sample: g.ids.slice(0, 3).map((id) => `${String(a.lights.get(id)?.date).slice(0, 10)} ${a.lights.get(id)?.headline.slice(0, 50)}`), clear: a.cards.get('answer').buttonIds().includes('clearstars') };
      });
      await shot(page, `v3f-${mode}-search-stars`);
      if (!r.stars || r.flagged !== r.stars || !r.clear) throw new Error(JSON.stringify(r));
      searchIds = await ev(() => window.__fw.app.searchGroup.ids);
      await ev(() => window.__fw.app.sealLight(window.__fw.app.searchGroup.ids[0])); // a sealed one stays
      await ev(() => window.__qa.press('answer', 'clearstars'));
      await page.waitForTimeout(500);
      const left = await ev((ids) => ids.filter((id) => window.__fw.app.lights.get(id)).length, searchIds);
      if (left !== 1) throw new Error(`after Clear: ${left} of ${searchIds.length} left (the sealed one should stay)`);
      return { ...r, afterClear: left };
    });

    await step('Library → Find patterns by pinch: a patterns card with its items', async () => {
      await ev(() => {
        const a = window.__fw.app;
        // seal a few more: drifting stars, and any grown node
        for (const it of a.lights.items.slice(0, 3)) a.sealLight(it.id);
        const grown = [...a.store.nodes.values()].find((n) => n.type === 'NewsItem' && n.addedIds?.length);
        if (grown) a.seal(grown.id);
        a.openLibrary();
      });
      await ev(() => window.__qa.press('library', 'patterns'));
      await page.waitForFunction(() => window.__fw.app.cards.get('patterns') && !window.__fw.app.lastPatterns?.running, null, { timeout: 120000 });
      const r = await ev(() => {
        const a = window.__fw.app;
        const p = a.lastPatterns;
        return { items: a.libraryItems().length, patterns: p.patterns.map((x) => `${x.kind}/${x.label}: ${x.text.slice(0, 60)} (${x.items.length} items, ${x.quotes.length} quotes)`), note: p.note, buttons: a.cards.get('patterns').buttonIds() };
      });
      await shot(page, `v3f-${mode}-patterns`);
      const bad = (await ev(() => window.__fw.app.lastPatterns.patterns.filter((x) => x.items.length < 2 || (x.label === 'inferred' && x.quotes.length < 2)).length));
      if (bad) throw new Error(`patterns without two items or quotes: ${JSON.stringify(r)}`);
      if (!r.patterns.length && !r.note) throw new Error(`no patterns and no note: ${JSON.stringify(r)}`);
      return r;
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

for (const m of which === 'both' ? ['offline', 'live'] : [which]) await run(m);
writeFileSync(`${OUT}/v3-features.json`, JSON.stringify({ when: new Date().toISOString(), scripted: true, results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} passed (scripted IWER hands, headless Chromium; not a real Quest)`);
process.exit(passed === results.length ? 0 : 1);
