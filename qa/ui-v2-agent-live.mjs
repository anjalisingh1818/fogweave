// The real agent end to end in the emulated headset: real news, real model calls.
// Grow a star, ask what to explore next; seal a few stars, run Find patterns.
// It spends free model quota, so it is run by hand. Not a real Quest.
//   node qa/ui-v2-agent-live.mjs
import { launch, open, enterXR, shot, errorsOf } from './lib.mjs';

const { browser, page, logs } = await launch();
const ev = (fn, a) => page.evaluate(fn, a);
const report = () =>
  ev(() => {
    const r = window.__fw.app.agent;
    return { running: r?.running, thoughts: r?.thoughts.size, chosen: r?.results.map((x) => `${x.kind}: ${x.text}`.slice(0, 150)), dropped: r?.dropped.map((d) => d.why), next: r?.next?.map((n) => n.label), tool: r?.tool, note: r?.note, calls: r?.calls, fps: Math.round(window.__fw.app.governor.stats.fps), q: window.__fw.app.governor.stats.level };
  });

try {
  await open(page, {});
  await enterXR(page);
  await page.waitForFunction(() => window.__fw.app.mode === 'live' && window.__fw.app.lights.items.length > 3, null, { timeout: 150000 });
  const id = await ev(() => {
    const a = window.__fw.app;
    a.onboarding.finish();
    a.cards.closeAll();
    const it = a.lights.items.find((x) => x.via === 'wikipedia' && a.canExpand(x.id)) || a.lights.items.find((x) => a.canExpand(x.id));
    a.openLight(it.id);
    return it.id;
  });
  await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, id, { timeout: 200000 });
  console.log('story:', await ev((x) => window.__fw.app.getItem(x).headline, id));

  let t0 = Date.now();
  await ev((x) => window.__fw.app.cards.get(`light:${x}`).press('next'), id);
  await page.waitForFunction(() => window.__fw.app.nextSteps && !window.__fw.app.nextSteps.running, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await shot(page, 'uiv2live-1-explore-next');
  console.log('NEXT', Math.round((Date.now() - t0) / 1000), 's', JSON.stringify(await ev(() => window.__fw.app.nextSteps)));

  await ev(() => {
    const a = window.__fw.app;
    a.closeAgent();
    a.cards.closeAll();
    for (const n of [...a.store.nodes.values()].filter((x) => x.type === 'NewsItem').slice(0, 3)) a.seal(n.id);
    for (const it of a.lights.items.slice(0, 3)) a.sealLight(it.id);
  });
  t0 = Date.now();
  await ev(() => {
    window.__fw.app.findPatterns();
  });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__fw.app.agent && !window.__fw.app.agent.running, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await shot(page, 'uiv2live-3-patterns-done');
  console.log('PATTERNS', Math.round((Date.now() - t0) / 1000), 's', JSON.stringify(await report()));
  const errs = errorsOf(logs).filter((l) => !/ERR_FAILED|net::|Failed to load resource|AudioContext/.test(l.text));
  console.log('console errors', errs.length, JSON.stringify(errs.slice(0, 2)));
} finally {
  await browser.close();
}
