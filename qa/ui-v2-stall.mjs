// A live star whose stream never answers must not block the other stars: it gives
// up, says so, can be tried again, and the next star grows.
//   node qa/ui-v2-stall.mjs      (needs the local backend)
import { launch, open, errorsOf } from './lib.mjs';

const { browser, context, page, logs } = await launch();
const ev = (fn, a) => page.evaluate(fn, a);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail ?? '').slice(0, 300)}`);
};

try {
  let hang = true;
  await context.route('**/expand', (route) => {
    if (hang) return; // never answers
    return route.continue();
  });
  await open(page, {});
  await page.waitForFunction(() => window.__fw.app.mode === 'live' && window.__fw.app.lights.items.length > 1, null, { timeout: 120000 });
  const [a, b] = await ev(() => {
    const app = window.__fw.app;
    app.onboarding.finish();
    app.cards.closeAll();
    app.client.stallMs = 1500;
    return app.lights.items.filter((x) => app.canExpand(x.id)).slice(0, 2).map((x) => x.id);
  });

  await ev((x) => window.__fw.app.openLight(x), a);
  await page.waitForTimeout(400);
  const during = await ev((x) => ({ exp: window.__fw.app.getItem(x)?.expanded, researching: !!window.__fw.app.researching }), a);
  check('while it waits, the star is growing', during.exp === 'running' && during.researching, during);

  await page.waitForFunction(() => !window.__fw.app.researching, null, { timeout: 8000 });
  const after = await ev((x) => ({ exp: window.__fw.app.getItem(x)?.expanded, nodes: window.__fw.app.store.nodes.size, status: window.__fw.app.statusCard.boxes.map((t) => t.text).join(' ') }), a);
  check('it gives up by itself and is not marked as grown', after.exp === false && after.nodes === 0, after);

  hang = false;
  await ev(() => (window.__fw.app.client.stallMs = 70000));
  await ev((x) => window.__fw.app.openLight(x), b);
  await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, b, { timeout: 200000 });
  const next = await ev(() => window.__fw.app.store.nodes.size);
  check('the next star grows', next > 1, { nodes: next });

  await ev((x) => window.__fw.app.closeStar(x), b);
  await ev((x) => window.__fw.app.openLight(x), a);
  await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, a, { timeout: 200000 });
  const retry = await ev(() => window.__fw.app.store.nodes.size);
  check('touching the first star again grows it', retry > 1, { nodes: retry });

  const errs = errorsOf(logs).filter((l) => !/ERR_FAILED|net::|Failed to load resource|AudioContext/.test(l.text));
  check('no console errors', !errs.length, errs.slice(0, 2));
} finally {
  await browser.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
