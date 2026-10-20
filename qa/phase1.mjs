/**
 * Phase 1 scripted-hands QA in the IWER emulator (Meta Quest 3 profile).
 * SCRIPTED hands driven through IWER's remote-control API: this proves
 * the input wiring, not how real hands feel on a real Quest.
 *
 *   FW_HTTP=1 npm run dev     (in another terminal)
 *   node qa/phase1.mjs
 * Results: qa/recordings/phase1-results.json + screenshots (git-ignored).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { launch, open, enterXR, shot, errorsOf, OUT } from './lib.mjs';

const results = [];
const { browser, page, logs } = await launch();

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, ms: Date.now() - t0, detail });
    console.log(`PASS  ${name}${detail ? '  ' + JSON.stringify(detail) : ''}`);
  } catch (err) {
    results.push({ name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
    console.log(`FAIL  ${name}  ${err.message || err}`);
    await shot(page, `fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
  }
}

const ev = (fn, arg) => page.evaluate(fn, arg);

async function installHelpers() {
  await ev(() => {
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
      buttonPos(key, id) {
        const c = this.cardOf(key);
        const p = c?.buttonWorldPosition(id);
        return p ? { x: p.x, y: p.y, z: p.z } : null;
      },
      async press(key, id, device = 'hand-right') {
        // let the card finish easing into its slot before aiming
        await wait(500);
        const p = this.buttonPos(key, id);
        if (!p) throw new Error(`no button ${key}/${id} (has: ${this.cardOf(key)?.buttonIds()})`);
        await this.pinchAt(device, p);
      },
      nodePos(id) {
        const p = app.view.worldPositionOf(id, new V());
        return { x: p.x, y: p.y, z: p.z };
      },
      openCards: () => app.cards.open.map((e) => e.key),
    };
  });
}

try {
  await open(page);
  await enterXR(page);
  await installHelpers();

  await step('bundled web grows in XR with hand tracking', async () => {
    await page.waitForFunction(() => window.__fw.app.player?.done, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const s = await ev(() => ({
      nodes: window.__fw.app.store.nodes.size,
      hands: [...window.IWER_DEVICE.activeSession.inputSources].filter((x) => x.hand).length,
      features: window.IWER_DEVICE.activeSession.enabledFeatures,
      tour: window.__qa.openCards().includes('tour'),
    }));
    if (s.nodes < 20 || s.hands !== 2 || !s.features.includes('hand-tracking')) throw new Error(JSON.stringify(s));
    await shot(page, '01-grown');
    return s;
  });

  await step('tour: pinch Next', async () => {
    await ev(() => window.__qa.press('tour', 'next'));
    const i = await ev(() => window.__fw.app.onboarding.index);
    if (i !== 1) throw new Error(`tour index ${i}`);
    return { index: i };
  });

  let claimId = null;
  await step('pinch a claim node opens its card', async () => {
    const candidates = await ev(() =>
      [...window.__fw.app.store.nodes.values()].filter((n) => n.type === 'Claim').map((n) => n.id),
    );
    for (const id of candidates) {
      await ev(async (nid) => window.__qa.pinchAt('hand-right', window.__qa.nodePos(nid)), id);
      const open = await ev(() => window.__qa.openCards());
      const opened = open.find((k) => k.startsWith('node:'));
      if (opened) {
        claimId = opened.slice(5);
        break;
      }
    }
    if (!claimId) throw new Error('no node card opened');
    const type = await ev((id) => window.__fw.app.store.nodes.get(id).type, claimId);
    await shot(page, '02-node-card');
    return { opened: claimId, type, tourIndex: await ev(() => window.__fw.app.onboarding.index) };
  });

  await step('Seal by pinch seals the node and its evidence', async () => {
    await ev((id) => window.__qa.press(`node:${id}`, 'seal'), claimId);
    const r = await ev((id) => {
      const s = window.__fw.app.store;
      const n = s.nodes.get(id);
      return { sealed: n.sealed, type: n.type, sealedTotal: s.sealedIds().length };
    }, claimId);
    if (!r.sealed || r.sealedTotal < 2) throw new Error(JSON.stringify(r));
    await shot(page, '03-sealed');
    return r;
  });

  await step('Coin pinch-tap fallback (far: pinch its tag) reveals evidence', async () => {
    await ev(() => (window.__fw.app.lastReveal = null));
    await ev(async () => {
      const p = window.__fw.app.props.items.find((x) => x.kind === 'coin').tag.buttonWorldPosition('tap');
      await window.__qa.pinchAt('hand-right', { x: p.x, y: p.y, z: p.z });
    });
    const r = await ev(() => window.__fw.app.lastReveal);
    if (r?.kind !== 'coin' || r.via !== 'tap') throw new Error(`reveal ${JSON.stringify(r)}`);
    await shot(page, '04-coin-tap');
    return { id: r.id, verdict: r.result?.verdict, lines: r.result?.lines };
  });

  await step('Locket pinch-tap fallback (near: quick pinch on the prop) reveals rank', async () => {
    await ev(() => (window.__fw.app.lastReveal = null));
    await ev(async () => {
      const app = window.__fw.app;
      const d = window.IWER_DEVICE;
      const p = app.props.items.find((x) => x.kind === 'locket').entity.object3D.getWorldPosition(app.anchor.head.clone());
      await d.remote.dispatch('set_transform', { device: 'hand-left', position: { x: p.x, y: p.y, z: p.z }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
      await window.__qa.wait(200);
      await window.__qa.pinch('hand-left', 150);
      await d.remote.dispatch('set_transform', { device: 'hand-left', position: { x: p.x - 0.1, y: p.y + 0.1, z: p.z + 0.1 } });
      await window.__qa.wait(200);
    });
    const r = await ev(() => window.__fw.app.lastReveal);
    if (r?.kind !== 'locket' || r.via !== 'tap' || !r.result?.rank) throw new Error(JSON.stringify(r));
    await shot(page, '05-locket-tap');
    return { rank: r.result.rank, of: r.result.of, why: r.result.why };
  });

  await step('Coin flip gesture near a node (grab + fast roll)', async () => {
    const r = await ev(async () => {
      const app = window.__fw.app;
      const d = window.IWER_DEVICE;
      const coin = app.props.items.find((x) => x.kind === 'coin').entity.object3D.getWorldPosition(app.anchor.head.clone());
      await d.remote.dispatch('set_transform', { device: 'hand-right', position: { x: coin.x, y: coin.y, z: coin.z }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
      await window.__qa.wait(200);
      await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 1 });
      await window.__qa.wait(300);
      const held = app.props.isHeld('coin');
      // carry it next to a visible node, then roll the wrist ~200 deg fast
      const target = app.view.visibleIds.find((id) => app.store.nodes.get(id).type === 'Claim');
      const p = window.__qa.nodePos(target);
      const at = { x: p.x + 0.04, y: p.y, z: p.z + 0.04 };
      await d.remote.dispatch('set_transform', { device: 'hand-right', position: at });
      await window.__qa.wait(250);
      app.lastReveal = null;
      for (let i = 1; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 1.5;
        await d.remote.dispatch('set_transform', { device: 'hand-right', position: at, orientation: { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) } });
        await window.__qa.wait(30);
      }
      await window.__qa.wait(200);
      await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 0 });
      await window.__qa.wait(300);
      return { held, target, reveal: app.lastReveal && { kind: app.lastReveal.kind, via: app.lastReveal.via, id: app.lastReveal.id } };
    });
    if (!r.held) throw new Error('coin was not grabbed: ' + JSON.stringify(r));
    if (r.reveal?.kind !== 'coin' || r.reveal.via !== 'gesture') throw new Error(JSON.stringify(r));
    return r;
  });

  await step('Locket swing gesture near a node (grab + lateral swings)', async () => {
    const r = await ev(async () => {
      const app = window.__fw.app;
      const d = window.IWER_DEVICE;
      const lk = app.props.items.find((x) => x.kind === 'locket').entity.object3D.getWorldPosition(app.anchor.head.clone());
      await d.remote.dispatch('set_transform', { device: 'hand-left', position: { x: lk.x, y: lk.y, z: lk.z }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
      await window.__qa.wait(200);
      await d.remote.dispatch('set_select_value', { device: 'hand-left', value: 1 });
      await window.__qa.wait(300);
      const held = app.props.isHeld('locket');
      const target = app.view.visibleIds.find((id) => app.store.nodes.get(id).type === 'Topic');
      const p = window.__qa.nodePos(target);
      app.lastReveal = null;
      for (let i = 0; i < 14; i++) {
        const x = p.x + (i % 2 ? 0.06 : -0.06);
        await d.remote.dispatch('set_transform', { device: 'hand-left', position: { x, y: p.y + 0.02, z: p.z + 0.03 } });
        await window.__qa.wait(45);
      }
      await window.__qa.wait(150);
      await d.remote.dispatch('set_select_value', { device: 'hand-left', value: 0 });
      await window.__qa.wait(300);
      return { held, target, reveal: app.lastReveal && { kind: app.lastReveal.kind, via: app.lastReveal.via, id: app.lastReveal.id } };
    });
    if (!r.held) throw new Error('locket was not grabbed: ' + JSON.stringify(r));
    if (r.reveal?.kind !== 'locket' || r.reveal.via !== 'gesture') throw new Error(JSON.stringify(r));
    await shot(page, '06-locket-swing');
    return r;
  });

  await step('props drift home after release', async () => {
    await page.waitForTimeout(2500);
    const d = await ev(() =>
      window.__fw.app.props.items.map((p) => +p.entity.object3D.position.distanceTo(p.home).toFixed(3)),
    );
    if (d.some((x) => x > 0.05)) throw new Error(JSON.stringify(d));
    return { distanceFromHome: d };
  });

  await step('Link two nodes by pinch shows the path', async () => {
    const pair = await ev(() => {
      const app = window.__fw.app;
      const claims = app.view.visibleIds.filter((id) => app.store.nodes.get(id).type === 'Claim');
      return [claims[0], claims[claims.length - 1]];
    });
    // select A, press Link, select B, press "Path here"
    for (const [i, id] of pair.entries()) {
      await ev((nid) => window.__fw.app.pinchNode(nid), id); // selection itself was hand-tested above
      await ev((nid) => window.__qa.press(`node:${nid}`, 'link'), id);
      if (i === 0) {
        const from = await ev(() => window.__fw.app.linkFromId);
        if (from !== id) throw new Error('link start not set');
      }
    }
    const r = await ev(() => ({ steps: window.__fw.app.view.pathEdges.length, open: window.__qa.openCards() }));
    if (!r.steps || !r.open.includes('path')) throw new Error(JSON.stringify(r));
    await shot(page, '07-path');
    return { pair, ...r };
  });

  await step('flick dismisses the card under the ray', async () => {
    const r = await ev(async () => {
      const qa = window.__qa;
      const d = window.IWER_DEVICE;
      const key = 'path';
      await qa.wait(400);
      const c = qa.cardOf(key);
      const p = c.object3D.getWorldPosition(window.__fw.app.anchor.head.clone());
      // aim at the card body (not a button), then flick sideways fast
      const target = { x: p.x, y: p.y + 0.05, z: p.z };
      const from = { x: p.x - 0.05, y: p.y - 0.25, z: p.z + 0.35 };
      await qa.aim('hand-right', target, from);
      await qa.wait(200);
      // smooth sideways flick: 0.4 m in 0.15 s (~2.7 m/s)
      await d.remote.dispatch('animate_to', { device: 'hand-right', position: { x: from.x + 0.4, y: from.y, z: from.z }, duration: 0.15 });
      await qa.wait(300);
      return { open: qa.openCards() };
    });
    if (r.open.includes('path')) throw new Error(JSON.stringify(r));
    return r;
  });

  await step('pinch in empty space opens the keypad', async () => {
    await ev(() => window.__fw.app.cards.closeAll());
    await ev(async () => {
      const h = window.__fw.app.anchor.head;
      await window.__qa.pinchAt('hand-right', { x: h.x + 1.5, y: h.y + 1.2, z: h.z - 0.4 });
      await window.__qa.wait(400);
    });
    const open = await ev(() => window.__fw.app.keypad.isOpen);
    if (!open) throw new Error('keypad not open');
    await shot(page, '08-keypad');
    return { suggestions: await ev(() => window.__fw.app.keypad.suggestions) };
  });

  await step('type a topic on the keypad by pinching keys, then Go', async () => {
    const word = 'fixture c';
    for (const ch of word) {
      await ev((c) => window.__qa.press('keypad', c === ' ' ? 'space' : `key:${c}`), ch);
    }
    const typed = await ev(() => window.__fw.app.keypad.text);
    if (typed !== word) throw new Error(`typed "${typed}"`);
    await ev(() => window.__qa.press('keypad', 'go'));
    await page.waitForFunction(() => window.__fw.app.store.meta.topicKey === 'fixture-c', null, { timeout: 10000 });
    return { typed, topic: await ev(() => window.__fw.app.store.meta.topic) };
  });

  await step('suggestion card opens a topic (no typing)', async () => {
    await page.waitForFunction(() => window.__fw.app.player?.done, null, { timeout: 30000 });
    await ev(() => window.__fw.app.openKeypad());
    const sug = await ev(() => window.__fw.app.keypad.suggestions);
    const idx = sug.findIndex((s) => /fixture a/i.test(s));
    if (idx < 0) throw new Error('no suggestion for Fixture A: ' + JSON.stringify(sug));
    await ev((i) => window.__qa.press('keypad', `sug:${i}`), idx);
    await page.waitForFunction(() => window.__fw.app.store.meta.topicKey === 'fixture-a', null, { timeout: 10000 });
    return { picked: sug[idx] };
  });

  await step('sealed items are restored when the topic is reopened', async () => {
    await page.waitForFunction(() => window.__fw.app.player?.done, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    const sealed = await ev(() => window.__fw.app.store.sealedIds().length);
    if (sealed < 2) throw new Error(`sealed after replay: ${sealed}`);
    return { sealed };
  });

  await step('wrist "?" opens help; Library lists sealed items', async () => {
    await ev(async () => {
      const qa = window.__qa;
      await qa.wait(300);
      const p = qa.buttonPos('help-button', 'help');
      await qa.pinchAt('hand-right', p);
    });
    if (!(await ev(() => window.__qa.openCards().includes('help')))) throw new Error('help not open');
    await shot(page, '09-help');
    await ev(() => window.__qa.press('help', 'library'));
    const open = await ev(() => window.__qa.openCards());
    if (!open.includes('library')) throw new Error(JSON.stringify(open));
    await shot(page, '10-library');
    return { open };
  });

  await step('unknown topic with backend off: planted + honest message', async () => {
    await ev(() => window.__fw.app.submitTopic('quantum dot displays'));
    const r = await ev(() => ({ nodes: window.__fw.app.store.nodes.size, status: window.__fw.app.statusText, open: window.__qa.openCards() }));
    if (r.nodes !== 1 || !/backend is off/i.test(r.status)) throw new Error(JSON.stringify(r));
    return r;
  });

  let lightId = null;
  await step('news lights drift in the fog (bundled snapshot)', async () => {
    const r = await ev(() => {
      const L = window.__fw.app.lights;
      return { count: L.items.length, kinds: [...new Set(L.items.map((x) => x.kind))].sort(), meta: window.__fw.app.lightsMeta };
    });
    if (r.count < 10 || r.kinds.length < 3) throw new Error(JSON.stringify(r));
    return r;
  });

  await step('pinch a light opens its reader card', async () => {
    await ev(() => window.__fw.app.cards.closeAll());
    const ids = await ev(() => window.__fw.app.lights.items.map((x) => x.id));
    for (const id of ids) {
      await ev(async (lid) => {
        const p = window.__fw.app.lights.worldPositionOf(lid);
        await window.__qa.pinchAt('hand-right', { x: p.x, y: p.y, z: p.z });
      }, id);
      const open = (await ev(() => window.__qa.openCards())).find((k) => k.startsWith('light:'));
      if (open) {
        lightId = open.slice(6);
        break;
      }
    }
    if (!lightId) throw new Error('no reader card opened');
    const buttons = await ev((id) => window.__qa.cardOf(`light:${id}`).buttonIds(), lightId);
    if (!buttons.includes('seal') || !buttons.includes('close') || buttons.includes('expand')) throw new Error(JSON.stringify(buttons));
    await shot(page, '12-reader-card');
    return { lightId, buttons };
  });

  await step('Seal a news item by pinch; the Library lists it', async () => {
    await ev((id) => window.__qa.press(`light:${id}`, 'seal'), lightId);
    const r = await ev((id) => ({ sealed: !!window.__fw.app.sealedLights[id], stored: !!JSON.parse(localStorage.getItem('fogweave.sealedLights.v1') || '{}')[id] }), lightId);
    if (!r.sealed || !r.stored) throw new Error(JSON.stringify(r));
    await ev(() => window.__fw.app.openLibrary());
    await shot(page, '13-library-with-news');
    return r;
  });

  await step('stress web: 160 nodes capped to 150, frame stats', async () => {
    const doc = JSON.parse(readFileSync('qa/fixtures/stress-150.json', 'utf8'));
    await ev((d) => {
      const app = window.__fw.app;
      app.cards.closeAll();
      app.governor.locked = true; // measure full quality, no auto-downgrade
      app.governor.level = 2;
      app.governor.onChange(2);
      app.store.loadGraph(d);
    }, doc);
    await page.waitForTimeout(4000);
    const stats = await ev(async () => {
      const app = window.__fw.app;
      const s = app.world.session;
      const t = [];
      await new Promise((res) => {
        const f = () => {
          t.push(performance.now());
          if (t.length < 361) s.requestAnimationFrame(f);
          else res();
        };
        s.requestAnimationFrame(f);
      });
      const dts = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
      const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
      return { visible: app.view.visibleIds.length, total: app.store.nodes.size, fps: +(1000 / avg).toFixed(1), p95ms: +dts[Math.floor(dts.length * 0.95)].toFixed(1), quality: app.governor.level };
    });
    await shot(page, '11-stress');
    if (stats.visible > 150) throw new Error(JSON.stringify(stats));
    return stats;
  });

  await step('no console errors during the run', async () => {
    const errs = errorsOf(logs);
    if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 5)));
    return { checkedMessages: logs.length };
  });
} finally {
  writeFileSync(`${OUT}/phase1-results.json`, JSON.stringify({ when: new Date().toISOString(), scripted: true, results }, null, 1));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed (scripted IWER hands, headless Chromium; not a real Quest)`);
  await browser.close();
}
