// F6: the client makes no third-party requests (it must work offline).
// Loads the app, enters XR with hands and then with controllers (their
// visuals are what IWSDK would fetch from a CDN), and lists every request
// that leaves localhost. The backend (localhost:8787) and the app's own
// news links are not requests the page makes on its own.
//   node qa/no-third-party.mjs [offline]
import { writeFileSync } from 'node:fs';
import { launch, open, enterXR, OUT } from './lib.mjs';

const offline = process.argv[2] === 'offline';
const { browser, context, page } = await launch();
const external = [];
const failed = [];
context.on('request', (r) => {
  const u = r.url();
  if (!/^(https?:\/\/(localhost|127\.0\.0\.1)|data:|blob:)/.test(u)) external.push(u);
});
context.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
if (offline) await context.route('http://localhost:8787/**', (r) => r.abort());

await open(page);
await enterXR(page);
await page.waitForTimeout(3000);
// controllers too: their models are the other remote asset IWSDK knows about
await page.evaluate(async () => {
  const d = window.IWER_DEVICE;
  d.primaryInputMode = 'controller';
});
await page.waitForTimeout(3000);
const mic = await page.evaluate(() => window.__fwMicRequested || false);

const result = { external: [...new Set(external)], failedNonBackend: failed.filter((f) => !f.includes('localhost:8787')), micRequestedAtLoad: mic };
writeFileSync(`${OUT}/no-third-party.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
console.log(result.external.length ? `FAIL  ${result.external.length} third-party request(s)` : 'PASS  no third-party requests');
await browser.close();
process.exit(result.external.length ? 1 : 0);
