// Production smoke test: serve dist/ (npx vite preview --port 4173), backend blocked.
//   node qa/prod-smoke.mjs [url] [screenshot]   -> status, snapshot, debug hooks absent, console errors
import { chromium } from 'playwright';
const url = process.argv[2] || 'https://localhost:4173/?debug';
const b = await chromium.launch({ args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
await ctx.route('http://localhost:8787/**', (r) => r.abort());
const p = await ctx.newPage();
const logs = [];
p.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
p.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const res = await p.goto(url, { waitUntil: 'load' });
await p.waitForTimeout(20000);
const snap = await p.evaluate(() => fetch('demo/snapshot/index.json').then((r) => r.ok));
await p.screenshot({ path: process.argv[3] || 'qa/recordings/prod-smoke.png' });
const errs = logs.filter((l) => /^(error|pageerror)/.test(l) && !/ERR_FAILED|net::|Failed to load resource/.test(l));
console.log(JSON.stringify({ status: res.status(), snapshot: snap, hasFw: await p.evaluate(() => 'window.__fw' in window || !!window.__fw), errors: errs.slice(0, 5), messages: logs.length }));
await b.close();
