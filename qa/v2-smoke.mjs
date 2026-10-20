// V2 explore loop smoke (live): touch a light -> grows -> touch an entity -> explores. Scripted hands.
import { launch, open, enterXR, shot, errorsOf } from './lib.mjs';

const { browser, page, logs } = await launch();
await open(page);
await enterXR(page);
await page.waitForFunction(() => window.__fw.app.mode !== 'starting', null, { timeout: 150000 });
const r0 = await page.evaluate(() => {
  const a = window.__fw.app;
  a.onboarding.finish();
  a.cards.closeAll();
  return { mode: a.mode, lights: a.lights.items.length, pool: a.pool.length, outside: a.lights.items.filter((x) => x.outside).length };
});
console.log('feed', JSON.stringify(r0));
const id = await page.evaluate(() => window.__fw.app.lights.items.find((x) => x.via === 'wikipedia')?.id || window.__fw.app.lights.items[0].id);
await page.evaluate((lid) => window.__fw.app.openLight(lid), id);
await page.waitForFunction((lid) => window.__fw.app.getItem(lid)?.expanded === true, id, { timeout: 180000 });
const ent = await page.evaluate(() => {
  const a = window.__fw.app;
  const n = [...a.store.nodes.values()].find((x) => ['Organisation', 'Place', 'Technology', 'Topic', 'Event'].includes(x.type) && !x.derived);
  return n?.id;
});
console.log('expanded; exploring', ent);
await page.evaluate((nid) => window.__fw.app.pinchNode(nid), ent);
await page.waitForFunction((nid) => window.__fw.app.store.nodes.get(nid)?.explored === true, ent, { timeout: 180000 });
await page.waitForTimeout(3000);
const r1 = await page.evaluate((nid) => {
  const a = window.__fw.app;
  const n = a.store.nodes.get(nid);
  const groups = {};
  for (const x of n.addedIds) groups[a.store.nodes.get(x)?.group] = (groups[a.store.nodes.get(x)?.group] || 0) + 1;
  return { label: n.label, definition: (n.definition || '').slice(0, 100), added: n.addedIds.length, hidden: a.hiddenCount(nid), groups, visible: a.view.visibleIds.length, trail: a.trail.length, buttons: a.cards.get(`node:${nid}`)?.buttonIds() };
}, ent);
console.log('explore', JSON.stringify(r1));
await shot(page, 'v2-explore');
console.log('errors', JSON.stringify(errorsOf(logs)));
await browser.close();
