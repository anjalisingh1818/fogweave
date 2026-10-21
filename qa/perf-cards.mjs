// Steady-state frame time with several cards open (scripted, emulator, not a Quest).
import { launch, open, enterXR } from './lib.mjs';
const { browser, context, page } = await launch();
await context.route('http://localhost:8787/**', (r) => r.abort());
await open(page);
await enterXR(page);
await page.waitForFunction(() => window.__fw.app.mode !== 'starting', null, { timeout: 60000 });
const measure = () => page.evaluate(async () => {
  const app = window.__fw.app, s = app.world.session, t = [];
  await new Promise((res) => { const f = () => { t.push(performance.now()); if (t.length < 241) s.requestAnimationFrame(f); else res(); }; s.requestAnimationFrame(f); });
  const d = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
  return { avg: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), cards: app.cards.open.length, level: app.governor.level };
});
await page.evaluate(() => { const a = window.__fw.app; a.onboarding.finish(); a.cards.closeAll(); a.governor.locked = true; a.governor.level = 2; a.governor.onChange(2); });
await page.waitForTimeout(2000);
console.log('no cards', JSON.stringify(await measure()));
await page.evaluate(() => { const a = window.__fw.app; a.openLibrary(); a.openNotes(); a.openLightsPanel(); a.openSettings(); a.openLight(a.lights.items[0].id); });
await page.waitForTimeout(3000);
console.log('5 cards ', JSON.stringify(await measure()));
await browser.close();
