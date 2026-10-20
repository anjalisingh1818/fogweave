/**
 * Shared Playwright helpers for scripted emulator QA.
 * These drive the IWER emulator's hands programmatically: they are
 * SCRIPTED hands, not a person and not a real Quest.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

export const BASE = process.env.FW_URL || 'http://localhost:8081/';
export const OUT = 'qa/recordings';

export async function launch({ width = 1280, height = 800, gpu = true } = {}) {
  mkdirSync(OUT, { recursive: true });
  const args = gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [];
  const browser = await chromium.launch({ headless: true, args });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width, height },
    recordVideo: process.env.FW_VIDEO ? { dir: OUT, size: { width, height } } : undefined,
  });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: String(e) }));
  return { browser, context, page, logs };
}

export async function open(page, { fresh = true, query = '?debug' } = {}) {
  await page.goto(BASE + query);
  if (fresh) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + query);
  }
  await page.waitForFunction(() => window.__fw?.app && window.IWER_DEVICE, null, { timeout: 30000 });
}

/** Enter the emulated immersive session with hand tracking. */
export async function enterXR(page) {
  await page.evaluate(async () => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
    for (let i = 0; i < 20 && !d.activeSession; i++) {
      try {
        d.grantOfferedSession();
      } catch {
        // not offered yet
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!d.activeSession) throw new Error('XR session did not start');
  });
  await page.waitForTimeout(800);
}

export async function shot(page, name) {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

export const errorsOf = (logs) =>
  logs.filter((l) => l.type === 'error' || l.type === 'pageerror').filter((l) => !/X4122|X4008|favicon/.test(l.text));
