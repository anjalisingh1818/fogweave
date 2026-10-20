// Debug probe: flick detection samples (scripted hands).
import { launch, open, enterXR } from './lib.mjs';

const { browser, page } = await launch();
await open(page);
await enterXR(page);
await page.waitForFunction(() => window.__fw.app.player?.done, null, { timeout: 30000 });
const out = await page.evaluate(async () => {
  const d = window.IWER_DEVICE;
  const app = window.__fw.app;
  const sys = window.__fw.system;
  const Hovered = window.__fw.Hovered;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  app.cards.show('path', { width: 0.42, height: 0.22, draw: () => {} });
  await wait(700);
  const c = app.cards.get('path').object3D.getWorldPosition(app.anchor.head.clone());
  const target = { x: c.x, y: c.y + 0.05, z: c.z };
  const from = { x: c.x - 0.05, y: c.y - 0.25, z: c.z + 0.35 };
  await d.remote.dispatch('set_transform', { device: 'hand-right', position: from });
  await d.remote.dispatch('look_at', { device: 'hand-right', target });
  await wait(300);
  const frames = [];
  const calls = [];
  const orig = app.dismissHoveredCard.bind(app);
  app.dismissHoveredCard = () => { const before = app.cards.open.map((e) => e.key); const r = orig(); calls.push({ t: performance.now().toFixed(1), r, before, after: app.cards.open.map((e) => e.key) }); return r; };
  const origShow = app.cards.show.bind(app.cards);
  app.cards.show = (k, o) => { calls.push({ show: k, t: performance.now().toFixed(1), stack: new Error().stack.split(String.fromCharCode(10)).slice(2, 5).join('|') }); return origShow(k, o); };
  let running = true;
  const grip = sys.player.gripSpaces.right;
  const V = app.anchor.head.constructor;
  const loop = () => {
    if (!running) return;
    frames.push({ t: +performance.now().toFixed(1), x: +grip.getWorldPosition(new V()).x.toFixed(3), hov: app.cards.get('path')?.entity.hasComponent(Hovered) ?? 'closed' });
    app.world.session.requestAnimationFrame(loop);
  };
  app.world.session.requestAnimationFrame(loop);
  await d.remote.dispatch('animate_to', { device: 'hand-right', position: { x: from.x + 0.4, y: from.y, z: from.z }, duration: 0.15 });
  await wait(300);
  running = false;
  return { calls, open: app.cards.open.map((e) => e.key), hist: sys._wrist.right.length, histL: sys._wrist.left.length, session: !!app.world.session, xrSession: !!app.world.xrSession, cooldown: sys._flickCooldown, now: performance.now(), grip: !!sys.player.gripSpaces?.right, frames: frames.slice(0, 6) };
});
console.log(JSON.stringify(out));
await browser.close();
