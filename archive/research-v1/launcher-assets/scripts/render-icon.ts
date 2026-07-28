// Render runtime/icon.svg → icon.png (1024×1024) via headless Chromium.
// Outside tsc graph; resolves playwright from packages/renderer.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(root, 'packages/renderer/package.json'));
const { chromium } = req('playwright') as typeof import('playwright');

const svg = readFileSync(path.join(root, 'runtime/icon.svg'), 'utf8');
const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:transparent">${svg.replace(/width="1024"/, 'width="1024"').replace(/height="1024"/, 'height="1024"')}</body></html>`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const svgEl = page.locator('svg').first();
  await svgEl.screenshot({ path: path.join(root, 'runtime/icon.png'), omitBackground: true });
  await browser.close();
  console.log('icon.png written (1024×1024)');
  process.exit(0);
})();
