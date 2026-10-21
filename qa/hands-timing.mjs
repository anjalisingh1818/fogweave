/**
 * Hands-path timings (V2 §9): touch a light -> card -> Expand -> Ask -> Seal
 * -> Library, hands only, timed per step. Offline (recorded runs) so it does
 * not compete with live quota; replay pace is the app's own (about 9 s).
 * SCRIPTED IWER hands: this measures the app's response, not human speed.
 *   node qa/hands-timing.mjs  ->  server/eval/results/hands_timing.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, open, enterXR } from './lib.mjs';

const { browser, context, page } = await launch();
await context.route('http://localhost:8787/**', (r) => r.abort());
await open(page, { query: '?debug&demo' }); // the Demo scene (V3: offline is a separate scene)
await enterXR(page);
await page.waitForFunction(() => window.__fw.app.mode !== 'starting', null, { timeout: 60000 });
await page.evaluate(() => {
  const app = window.__fw.app;
  app.onboarding.finish();
  app.cards.closeAll();
  const d = window.IWER_DEVICE;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__qa = {
    async pinchAt(t) {
      // the hand reaches toward what it points at (like a person would), so rays
      // to far-side cards do not cross nearer cards
      const h = app.anchor.head;
      const from = { x: h.x + (t.x - h.x) * 0.45 + 0.05, y: h.y - 0.22 + (t.y - h.y) * 0.3, z: h.z + (t.z - h.z) * 0.45 };
      await d.remote.dispatch('set_transform', { device: 'hand-right', position: from });
      await d.remote.dispatch('look_at', { device: 'hand-right', target: t });
      await wait(100);
      await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 1 });
      await wait(120);
      await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 0 });
    },
    /** Expand a light: press Expand, or (V2 auto-expand on touch) it is already growing. */
    async expand(id) {
      const app = window.__fw.app;
      const it = app.getItem ? app.getItem(id) : app.lights.get(id);
      if (it?.expanded || app.expanding?.id === id) return 'auto';
      await this.press(`light:${id}`, 'expand');
      return 'pressed';
    },
    async press(key, id) {
      await wait(450); // let the card settle (a person would read it)
      const c = key === 'help-button' ? app.helpButton : app.cards.get(key);
      const p = c.buttonWorldPosition(id);
      await this.pinchAt({ x: p.x, y: p.y, z: p.z });
    },
  };
});
const steps = {};
const t = () => Date.now();
const id = await page.evaluate(() => Object.keys(window.__fw.app.snapshot.expansions)[0]);

let t0 = t();
await page.evaluate(async (lid) => {
  const p = window.__fw.app.lights.worldPositionOf(lid);
  await window.__qa.pinchAt({ x: p.x, y: p.y, z: p.z });
}, id);
await page.waitForFunction((lid) => window.__fw.app.cards.get(`light:${lid}`), id, { timeout: 10000 });
steps['touch light → reader card open'] = t() - t0;

t0 = t();
await page.evaluate((lid) => window.__qa.expand(lid), id);
await page.waitForFunction((lid) => window.__fw.app.store.nodes.has(lid), id, { timeout: 20000 });
steps['pinch Expand → first node'] = t() - t0;
await page.waitForFunction((lid) => window.__fw.app.lights.get(lid).expanded === true, id, { timeout: 60000 });
steps['pinch Expand → web complete (recorded replay)'] = t() - t0;

t0 = t();
await page.evaluate((lid) => window.__qa.press(`light:${lid}`, 'ask'), id);
await page.waitForFunction(() => window.__fw.app.keypad.isOpen, null, { timeout: 5000 });
await page.evaluate(() => {
  const i = window.__fw.app.keypad.suggestions.indexOf('Who is affected?');
  return window.__qa.press('keypad', `sug:${i}`).catch(() => null);
});
await page.evaluate(async () => {
  const i = window.__fw.app.keypad.suggestions?.indexOf('Who is affected?');
  if (window.__fw.app.keypad.isOpen) {
    const p = window.__fw.app.keypad.card.buttonWorldPosition(`sug:${i}`);
    await window.__qa.pinchAt({ x: p.x, y: p.y, z: p.z });
  }
});
await page.waitForFunction(() => window.__fw.app.cards.get('answer'), null, { timeout: 15000 });
steps['pinch Ask → suggestion → answer card'] = t() - t0;

t0 = t();
await page.evaluate((lid) => window.__qa.press(`light:${lid}`, 'seal'), id);
await page.waitForFunction((lid) => window.__fw.app.lights.sealed.has(lid), id, { timeout: 5000 });
steps['pinch Seal → sealed'] = t() - t0;

t0 = t();
await page.evaluate(async () => {
  const p = window.__fw.app.helpButton.buttonWorldPosition('help');
  await window.__qa.pinchAt({ x: p.x, y: p.y, z: p.z });
});
await page.waitForFunction(() => window.__fw.app.cards.get('help'), null, { timeout: 5000 });
await page.evaluate(() => window.__qa.press('help', 'library'));
await page.waitForFunction(() => window.__fw.app.cards.get('library'), null, { timeout: 5000 });
steps['wrist ? → Library open'] = t() - t0;

const total = Object.entries(steps).filter(([k]) => !k.includes('first node')).reduce((a, [, v]) => a + v, 0);
const out = { when: new Date().toISOString(), scripted: true, mode: 'offline (recorded run)', steps, total_ms: total };
mkdirSync('server/eval/results', { recursive: true });
writeFileSync('server/eval/results/hands_timing.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
