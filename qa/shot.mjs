// Quick look: node qa/shot.mjs [name] [waitMs] [xr]
import { launch, open, enterXR, shot, errorsOf } from './lib.mjs';

const [name = 'look', wait = '12000', xr] = process.argv.slice(2);
const { browser, page, logs } = await launch();
await open(page);
if (xr) await enterXR(page);
await page.waitForTimeout(Number(wait));
console.log(await shot(page, name));
console.log(JSON.stringify(await page.evaluate(() => ({ ...window.__fw.app.governor.stats, nodes: window.__fw.app.store.nodes.size }))));
console.log('errors:', JSON.stringify(errorsOf(logs)));
await browser.close();
