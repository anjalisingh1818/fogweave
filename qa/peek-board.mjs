// Saves the detective board's canvas at full resolution (a look, not a test).
import { writeFileSync } from 'node:fs';
import { launch, open, OUT } from './lib.mjs';
const { browser, page } = await launch();
try {
  await open(page, { query: '?debug&demo' });
  await page.waitForFunction(() => window.__fw?.app?.lights?.items?.length > 0, null, { timeout: 60000 });
  const url = await page.evaluate(async () => {
    const a = window.__fw.app;
    a.onboarding.finish();
    const rec = await (await fetch('demo/snapshot/agent-run.json')).json();
    const res = rec.events.find((e) => e.type === 'result');
    const run = { results: res.results, items: Object.fromEntries(rec.stars.map((s) => [s.id, { star: s }])), recorded: true, title: 'RECORDED AGENT RUN · 2026-11-17', empty: '' };
    a.openBoard(run);
    return a.cards.get('board').canvas.toDataURL();
  });
  writeFileSync(`${OUT}/board-peek.png`, Buffer.from(url.split(',')[1], 'base64'));
} finally {
  await browser.close();
}
