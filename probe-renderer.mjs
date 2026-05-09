import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const RENDERER_DIR = '/Users/bowei/cactus-strudel/apps/renderer-page';
const port = 5180;
const baseUrl = `http://localhost:${port}`;

const server = spawn('pnpm', ['exec', 'vite', '--port', String(port), '--strictPort'], {
  cwd: RENDERER_DIR,
  stdio: 'pipe',
});
server.stdout.on('data', (b) => process.stdout.write('[vite] ' + b));
server.stderr.on('data', (b) => process.stderr.write('[vite-err] ' + b));

await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext();
const page = await context.newPage();

page.on('console', (msg) => console.log(`[page-${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}\n${err.stack}`));
page.on('requestfailed', (req) => console.error(`[reqfail] ${req.url()} ${req.failure()?.errorText}`));

await page.goto(baseUrl, { waitUntil: 'networkidle' });

// Wait some, then capture state
await new Promise((r) => setTimeout(r, 8000));

const state = await page.evaluate(() => ({
  ready: window.__cactusReady,
  err: window.__cactusInitError,
  log: window.__cactusBootLog,
  versions: window.__cactusVersions,
  pageBody: document.querySelector('#status')?.textContent,
}));
console.log('STATE:', JSON.stringify(state, null, 2));

await browser.close();
server.kill();
process.exit(0);
