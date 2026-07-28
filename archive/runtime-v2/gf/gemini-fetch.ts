// Browser-automate web Gemini Pro (Bowei's tokens / strongest surface)
// to request Strudel code, replacing manual paste/copy. Playwright drives
// a DEDICATED persistent Chrome profile (isolated from daily browsing;
// one-time manual Gemini login persists across runs; headful so it's
// visible/trustable). No native computer-use tool in the Claude Code
// harness — Playwright is the feasible "chrome use". Lives in scripts/
// (outside the tsc -b graph) by design.
//
// Run:  cd ~/CactusStrudel && pnpm -s exec tsx scripts/gemini-fetch.ts
// First run: a Chrome window opens — log into Gemini ONCE, it then
// proceeds automatically. Output: producer-brain/pieces/gemini_auto_<ts>.js
// (repo-relative; the .js source is a small text artifact tracked in git;
//  the rendered .mp3 — produced by auto-render.ts — lands in
//  producer-brain/audio/ which is gitignored).
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

// playwright is a dep of @cactus/renderer (pnpm — not root-resolvable);
// resolve it from there.
const req = createRequire('/Users/bowei/CactusStrudel/packages/renderer/package.json');
const { chromium } = req('playwright') as typeof import('playwright');

const H = homedir();
const PROFILE = `${H}/.cactus-gemini-chrome`;
const PIECES_DIR = '/Users/bowei/CactusStrudel/producer-brain/pieces';
mkdirSync(PIECES_DIR, { recursive: true });
const OUT = `${PIECES_DIR}/gemini_auto_${Date.now()}.js`;
const SHOT = `${H}/Downloads/gemini_auto_debug.png`;

// Minimal Strudel guideline Bowei approved: ONLY the technical reference
// (so web Gemini — no engine to self-heal — doesn't hallucinate APIs).
// ZERO role/craft/aesthetic constraints — let it free
// (feedback_dont_over_govern_specialist_agent).
// PROMPT_EXTRA env var: appends an extra constraint sentence for
// corpus experiments (single-axis variations) — see scripts/corpus-10.sh.
const PROMPT_BASE = `You are composing in Strudel (strudel.cc — a live-coding music language, JavaScript port of TidalCycles). Write an original piece. Full creative freedom: choose the genre, tempo, key, mode, harmonic language, instrumentation, density, arrangement shape, and production style yourself.

Strudel language reference (use ONLY these real APIs — do NOT invent methods):
- pitch: note("<note pattern>"), n("<scale degrees>").scale("<root>:<mode>"), .add()/.sub(), .arp("0 1 2 3") (NUMERIC index pattern only — string modes "up"/"updown" do NOT work), .off(0.25, x=>x.add(7))
- chords: chord("<chord progression>") with any coherent progression/key/mode of your choice; .voicing() provides automatic voicing. Note there is NO apostrophe form (c4'min9 invalid). Explicit note stacks are also valid via note("<[note,note,note] [note,note,note]>").
- structure: stack(...), <a b c>, [a b], *N !N ~ @w, .slow()/.fast(), .every(n,f), .superimpose(f), .layer(f), .jux(rev), .segment(n), .palindrome(), .range(a,b), arrange([length,p1],[length,p2]), .mask("<1 0>"), .struct("x ~ x x")
- reusable patterns: declare with  const name = ...  then reference  name. Do NOT use $-prefixed names — $drums = ... throws ReferenceError.
- signals: sine saw tri perlin rand — .range(a,b).slow(n) into .lpf()/.gain()/.pan() etc.
- sound: .s("<valid sound name>") — safe local synth names include sine, saw, sawtooth, square, triangle, supersaw, piano. GM soundfonts use exact gm_* names. Drum machines require exact .bank("<valid bank>") names and standard drum tags when samples are used. Choose timbres freely; this line is only a validity reference, not a style suggestion.
- shaping: .gain .lpf .lpq .hpf .room .roomsize .delay .delaytime .delayfeedback .attack .decay .sustain .release .pan .crush .shape .vib .clip .detune .speed .coarse; sidechain: kick .duckorbit(N).duckattack(t).duckdepth(d), bed .orbit(N). Ensure duckdepth is a valid fraction (typically between 0.0 and 1.0).
- lead treatment (IF a lead voice is present): avoid bare .vib(depth) with large default values as it causes excessive out-of-tune warbling (specify small depths or use explicit pitch variation if vibrato is desired). Feel free to use any timbre and parallel interval processing.
- tempo: setcpm(<bpm>/4)

Do NOT exist — never emit: .stutter() .subdivide() .mod() .krush() .stut() .quantise() .quantize(); resonance is .lpq() not .q(); soundfont prefix gm_ not gmm_; .arp string modes are silent — numeric only; "superfm" is not a valid sound name.
Do NOT use invalid syntax causing silent tracks:
- Chords: Never use colons for chord quality suffixes (e.g. c3:min9 or bb2:dom9 is invalid; write standard Cm9, Cmaj7, C9, Bb9).
- Arpeggiator: Numeric indices in .arp() must never exceed or equal the number of notes in the chord stack.
- Struct: Only use 'x' and '~' inside .struct(); never write sample names (e.g. bd) inside the struct pattern string.
- Timbre: Only use valid oscillator names for .s(): sine, saw, sawtooth, square, triangle, supersaw (do not use pulse).
- Tempo: Never chain .setcpm(...) on patterns or stacks (e.g. stack(...).setcpm(...) is invalid; always write setcpm(<bpm>/4) on a separate line).



Structure: You can compose structured pieces using arrange([length1, pattern1], [length2, pattern2]) to sequence sections, or stack patterns for continuous loops/grooves. Avoid monotone stacks only when they are not an intentional creative choice.

Output ONLY the complete Strudel code in one ``` code block, ready to paste into strudel.cc. No explanation.`;

const PROMPT_EXTRA = process.env.PROMPT_EXTRA ?? '';
const PROMPT = PROMPT_EXTRA ? `${PROMPT_BASE}\n\nADDITIONAL CONSTRAINT: ${PROMPT_EXTRA}` : PROMPT_BASE;
if (PROMPT_EXTRA) console.log(`[gemini-fetch] PROMPT_EXTRA: ${PROMPT_EXTRA.slice(0, 100)}${PROMPT_EXTRA.length > 100 ? '…' : ''}`);

const log = (m: string) => console.log(`[gemini-fetch] ${m}`);

async function findInput(page: import('playwright').Page) {
  const sels = [
    'div[contenteditable="true"][role="textbox"]',
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"]',
    'textarea',
  ];
  for (const s of sels) {
    const el = page.locator(s).first();
    const has = await el.count().then((c: number) => c > 0).catch(() => false);
    if (has && (await el.isVisible().catch(() => false))) return el;
  }
  return null;
}

(async () => {
  // ATTACH to a Chrome the user launched normally (via ~/CactusStrudel/gl)
  // with --remote-debugging-port. Login happens in that human session →
  // Google's "browser may not be secure" automation block is bypassed
  // (Playwright never launched it). PROFILE is unused now (kept for ref).
  void PROFILE;
  const CDP = 'http://127.0.0.1:9222';
  log(`attaching to your Chrome on ${CDP} (launched via ~/CactusStrudel/gl)…`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP);
  } catch {
    log('NO Chrome on the debug port. Do this ONCE:');
    log('  1) run:   ~/CactusStrudel/gl     (opens a normal Chrome, isolated profile)');
    log('  2) in it: log into Google/Gemini (works — normal Chrome), pick the Pro model');
    log('  3) LEAVE that Chrome open, then run:   ~/CactusStrudel/gf');
    process.exit(1);
  }
  const context = browser.contexts()[0] ?? (await browser.newContext());
  let page = context.pages().find((p) => /gemini\.google\./.test(p.url())) ?? null;
  if (!page) page = await context.newPage();
  page.setDefaultTimeout(60_000);

  try {
    // ALWAYS navigate to /app — otherwise we stay on the prior chat
    // URL and Gemini reuses the same conversation context (it then
    // just regenerates near-identical code, ignoring any guideline
    // updates). Fresh /app navigation forces a new chat thread.
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500); // UI settle
    log('checking Gemini login…');
    let input = await findInput(page);
    if (!input) {
      await page.screenshot({ path: SHOT }).catch(() => {});
      log('Not logged into Gemini in that Chrome. In the gl Chrome window:');
      log('log into Google/Gemini (normal Chrome → login works), then re-run  ~/CactusStrudel/gf');
      process.exit(1);
    }
    log('logged in; chat box found.');

    // Try several "new chat" selectors — Gemini's actual button can be
    // text-only "New chat" (sidebar link), aria-label, data-test-id,
    // or an icon button. Best-effort; if all miss, /app reload usually
    // suffices for a fresh thread anyway.
    const newChatSelectors = [
      '[aria-label="New chat" i]',
      'button[aria-label*="new chat" i]',
      '[role="button"][aria-label*="new chat" i]',
      '[data-test-id*="new-chat"]',
      'a[href$="/app"]:visible',
      'text="New chat"',
      'a:has-text("New chat")',
      'button:has-text("New chat")',
    ];
    let clicked = false;
    for (const sel of newChatSelectors) {
      try {
        const el = page.locator(sel).first();
        const has = await el.count().then((c: number) => c > 0).catch(() => false);
        if (has && (await el.isVisible().catch(() => false))) {
          await el.click({ timeout: 3000 });
          await page.waitForTimeout(1500);
          clicked = true;
          log(`new-chat clicked via: ${sel}`);
          break;
        }
      } catch { /* try next */ }
    }
    if (!clicked) {
      // Fallback: try the role+name pattern
      try {
        const nc = page.getByRole('button', { name: /new chat/i }).first();
        if (await nc.count().then((c: number) => c > 0).catch(() => false)) {
          await nc.click({ timeout: 3000 });
          await page.waitForTimeout(1500);
          clicked = true;
          log('new-chat clicked via getByRole');
        }
      } catch { /* */ }
    }
    if (!clicked) log('WARNING: could not locate "New chat" button — /app reload should suffice for a fresh thread');
    input = (await findInput(page)) ?? input;

    // Select model if GEMINI_MODEL env set (e.g. "3.5 Flash", "3.1 Pro").
    // Web Gemini model menu: 3.1 Flash-Lite / 3.5 Flash / 3.1 Pro.
    const MODEL = process.env.GEMINI_MODEL ?? '';
    if (MODEL) {
      log(`model requested: "${MODEL}"`);
      let modelSet = false;
      for (let attempt = 0; attempt < 3 && !modelSet; attempt++) {
        try {
          const selBtn = page.locator('button, [role="button"]').filter({ hasText: /\b(pro|flash)\b/i }).first();
          const found = await selBtn.count().then((c: number) => c > 0).catch(() => false)
            && await selBtn.isVisible().catch(() => false);
          if (!found) { log(`  model button not found (attempt ${attempt + 1}/3)`); await page.waitForTimeout(1800); continue; }
          const cur = (await selBtn.textContent().catch(() => '') ?? '').trim().slice(0, 30);
          await selBtn.click({ timeout: 4000 });
          await page.waitForTimeout(1300);
          const re = new RegExp(MODEL.replace(/[.\-]/g, '\\$&'), 'i');
          const item = page.locator('[role="menuitem"], [role="option"], [role="menuitemradio"]').filter({ hasText: re }).first();
          if (await item.count().then((c: number) => c > 0).catch(() => false)) {
            await item.click({ timeout: 4000 });
            await page.waitForTimeout(1200);
            modelSet = true;
            log(`  model set: "${MODEL}" (was "${cur}")`);
          } else {
            log(`  menu opened (cur "${cur}") but no item matching "${MODEL}"`);
            await page.keyboard.press('Escape').catch(() => { /* */ });
            await page.waitForTimeout(1000);
          }
        } catch (e) {
          log(`  model-select error a${attempt + 1}: ${(e instanceof Error ? e.message : String(e)).slice(0, 70)}`);
          await page.waitForTimeout(1000);
        }
      }
      if (!modelSet) log(`WARNING: could not set model "${MODEL}" — proceeding with whatever is selected`);
      input = (await findInput(page)) ?? input;
    }

    log('typing Strudel-guideline prompt…');
    await input.click();
    await input.fill(PROMPT).catch(async () => { await input!.type(PROMPT, { delay: 0 }); });
    // fill() on a contenteditable can skip the 'input' events Gemini's
    // UI listens to → the send button stays DISABLED → submit fails
    // (root cause of HOOK-02/04 misses). Nudge with real key events
    // (Space then Backspace = content unchanged) to fire those handlers.
    try {
      await input.press('End');
      await input.press('Space');
      await input.press('Backspace');
    } catch { /* */ }
    await page.waitForTimeout(600);
    // SUBMIT: POLL for the send button to become ENABLED (it is disabled
    // until the input registers content) — up to 12s — then click.
    const sendSelectors = [
      'button[aria-label*="send message" i]',
      'button[aria-label*="send" i]',
      'button[aria-label="Send" i]',
      'button[data-test-id*="send" i]',
      'button[mat-icon-button][aria-label*="send" i]',
    ];
    let sent = false;
    const sendDeadline = Date.now() + 12_000;
    while (Date.now() < sendDeadline && !sent) {
      for (const sel of sendSelectors) {
        try {
          const btn = page.locator(sel).last(); // last = closest to input
          if ((await btn.count().then((c: number) => c > 0).catch(() => false))
            && (await btn.isVisible().catch(() => false))
            && (await btn.isEnabled().catch(() => false))) {
            await btn.click({ timeout: 3000 });
            sent = true;
            log(`submit clicked via: ${sel}`);
            break;
          }
        } catch { /* try next */ }
      }
      if (!sent) await page.waitForTimeout(800);
    }
    if (!sent) {
      log('send button never enabled after 12s — keyboard fallback (Enter)');
      try { await input.focus(); await page.keyboard.press('Enter'); } catch { /* */ }
    }
    log('submitted; waiting for stream to settle + code block (max 4 min)…');

    const start = Date.now();
    let lastLen = -1, stableSince = Date.now(), done = false;
    while (Date.now() - start < 240_000) {
      await page.waitForTimeout(2500);
      // page.evaluate can throw "Execution context destroyed" if a
      // navigation happens mid-poll (HOOK-01 failure) — treat as a
      // transient skip, don't abort the whole fetch.
      let info: { codeCount: number; textLen: number };
      try {
        info = await page.evaluate(() => ({
          codeCount: document.querySelectorAll('code, pre').length,
          textLen: (document.body.innerText || '').length,
        }));
      } catch { continue; }
      if (info.textLen !== lastLen) { lastLen = info.textLen; stableSince = Date.now(); }
      if (info.codeCount > 0 && Date.now() - stableSince > 4000) { done = true; break; }
    }
    if (!done) log('WARNING: stream may not have settled; best-effort extract.');

    const code: string = await page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll('code, pre'))
        .map((e) => (e as HTMLElement).innerText || '')
        .filter((t) => /\b(setcps|setcpm|stack\(|note\(|sound\(|s\("|n\(|arrange\(|\.s\()/.test(t));
      blocks.sort((a, b) => b.length - a.length);
      return blocks[0] || '';
    });

    if (!code || code.length < 40) {
      await page.screenshot({ path: SHOT, fullPage: true }).catch(() => {});
      throw new Error('no Strudel code extracted (selector drift). Window stays open — copy manually. ' + SHOT);
    }
    writeFileSync(OUT, code.trim() + '\n');
    log(`✓ ${code.length} chars → ${OUT}`);
    console.log('\nGEMINI_OUT=' + OUT);
  } catch (e) {
    await page.screenshot({ path: SHOT, fullPage: true }).catch(() => {});
    log('ERROR: ' + (e instanceof Error ? e.message : String(e)));
    log('your Chrome stays open (it is yours) — copy manually if needed: ' + SHOT);
    process.exit(1);
  }
  // NEVER close the user's own Chrome. Just exit — the CDP connection
  // drops and their Chrome (launched via gl) keeps running.
  process.exit(0);
})();
