# Known issues + gotchas

Battle-tested catalog. Check here before reaching for `pnpm install` again
or hitting an obscure error.

## Playwright Chromium install

**Symptom**: `render failed — playwright: command not found` or similar.

**Cause**: `pnpm exec playwright install chromium` must run from a workspace
package that depends on `playwright`. The root `package.json` doesn't.

**Fix**:
```bash
cd /Users/bowei/CactusStrudel/apps/renderer-page
pnpm exec playwright install chromium
```

(Installer auto-detects which workspace owns playwright by grepping. If you
write a new installer flow, replicate that detection.)

## refs/strudel-monorepo missing

**Symptom**: `Could not resolve "../../refs/strudel-monorepo/packages/vite-plugin-bundle-audioworklet/..."`.

**Cause**: tar excluded refs/strudel-monorepo, or the monorepo was extracted
but never pnpm-installed (so internal symlinks are broken).

**Fix**:
1. Verify the subset is present: `ls refs/strudel-monorepo/packages/vite-plugin-bundle-audioworklet`
2. If yes: `cd refs/strudel-monorepo && pnpm install --prefer-offline`
3. If no: fetch from mac → `rsync -avh --exclude='node_modules' --exclude='.git' bowei@mac.local:CactusStrudel/refs/strudel-monorepo/ refs/strudel-monorepo/`

## CLIProxy 401 Unauthorized

**Symptom**: brain-chat or generate via cliproxy returns 401.

**Cause(s)** ordered by frequency:
1. Wrong API key (was set from the wrong machine's key doc)
2. CLIProxy gateway not running
3. CLIProxy port mismatch (mac mini = 8318, mbp = 8317)

**Diagnose**:
```bash
# Is gateway up?
curl -s http://127.0.0.1:8318/healthz   # or 8317 on mbp

# Is key correct? Test directly:
curl -s -H "Authorization: Bearer YOUR_KEY" http://127.0.0.1:8318/v1/models | head
```

**Fix**: in Settings → CLIProxy → paste correct key → Save → reload. The
correct key is in your local `~/Downloads/CLIProxyAPI-*-Usage.md` doc that
matches the running port.

## Brain "I have no tools" reply

**Symptom**: brain says "我没有访问 X 的工具" despite tool spec being in system message.

**Causes** (ordered):
1. Pilot doc says "you cannot directly mutate files" — overrides new tool spec
2. Multiple system messages — CLIProxy → Anthropic conversion may drop later ones
3. Tool spec not appearing in system context

**Fix**:
1. Consolidate all system messages into ONE in `_brain_memory_messages()` —
   pilot + tool hint + corpus tail concat
2. Update pilot doc when adding new tools — explicit "use the X tool when..."
3. Use OpenAI standard `tools: [...]` parameter, NOT custom `<tool>` tags
   in system prompt

The pilot doc edit history is at `docs/cactus-strudel-opus-pilot.md` —
specifically the "Authority Boundary" section.

## Recent panel horizontal scrollbar

**Symptom**: hovering a piece in main.html Recent shows a fat horizontal
scrollbar at the bottom.

**Cause**: `.recent .item:hover { transform: translateX(4px) }` pushes the
item out, triggering parent overflow.

**Fix**: `.recent` has `overflow-x: hidden` (commit ckpt-21). If you reintroduce
translateX, keep the overflow-x:hidden.

## info-icon tooltip clipped

**Symptom**: hover tooltip on `i` icons gets cut off by ancestor.

**Cause**: was using `::after` pseudo-element which inherits ancestor overflow
clipping.

**Fix**: ckpt-21 moved to a body-level `position:fixed` `#info-tip-popup`
populated by JS. Don't revert to `::after`. New pages need to copy the JS
init block (see main.html `initInfoTip()`).

## Lowercase `i` rendering as uppercase `I`

**Symptom**: `.info-icon` containing literal `i` shows as italic uppercase `I`.

**Cause**: parent element has `text-transform: uppercase` (`<details> summary`
or `nav.top h3`).

**Fix**: `.info-icon` CSS includes:
```css
text-transform: none !important;
font-style: normal;
letter-spacing: 0;
font-family: Georgia, 'Times New Roman', serif;
```

These defeat all ancestor text-transform inheritance.

## Generate hangs / SSE never closes

**Symptom**: `/api/generate` SSE returns but never sends `event: done`.

**Cause(s)**:
1. CLIProxy / direct vendor call took longer than the curl timeout
2. Render step (`pnpm exec tsx auto-render.ts`) hangs on Playwright
3. Extracted code wasn't valid Strudel and `_extract_strudel_code` raised

**Diagnose**:
```bash
# What's the server log say?
tail -30 /tmp/cactus-serve.log

# Is there a render process stuck?
ps aux | grep -E 'tsx|playwright|chromium' | grep -v grep
```

**Fix**: kill stuck render process; consider raising render timeout in
`_render_and_register`.

## Bash subprocess in Claude Code can lose PATH on Mac-Studio

**Symptom**: in Mac-Studio (`jack` user), inline shell function definitions
in Bash tool calls wipe PATH.

**Cause**: zsh function semantics on that machine.

**Fix**: use absolute paths + builtins in any Bash command. Don't define
inline functions. If you need a function, write a small `.sh` file and call it.

## Brain edit `_detect_brain_code_action` only handles filters

**Status**: known limitation. The legacy `_detect_brain_code_action` only
detects "add filter" type asks (lpf/lpq on chord/lead/bass). For arbitrary
code edits, brain should call the new `update_piece_code` tool (when added)
rather than rely on the narrow regex.

## ~/.cactus-strudel/config.json secrets visible to grep

**Fix**: file mode is 0600 (only owner readable). DON'T `cat` it in commands
the user can see in transcripts — it leaks API keys to anyone reading the log.

When showing config to user, ALWAYS go through `/api/settings` which returns
masked keys.

## Empty corpus / 0 backends after a refactor

**Symptom**: post-refactor, `/api/backends` returns all unavailable; corpus
view is empty.

**Causes**:
- removed CLIPROXY_MODEL hardcoded constant but didn't replace references
- changed `_resolve_slot_route` semantics and missed a call site
- ROOT path resolution broke

**Fix**:
- `grep -n CLIPROXY_MODEL\|BACKEND_REGISTRY\|_resolve_slot_route runtime/serve.py`
  and verify each call site
- Check `/api/version` first — if 500, server boot is broken
- Check `python3 -c 'from runtime.user_config import load; print(load())'`

## Don't rebuild tar without testing locally first

**Fix**: spin up a fresh `/tmp/cactus-test/` install BEFORE rsync'ing to mbp.
The install script is universal — it should work from anywhere.

```bash
mkdir -p /tmp/cactus-test
cp /tmp/cactus-strudel-bundle.tar.gz /tmp/cactus-test/
cp /tmp/install-cactus-strudel.command /tmp/cactus-test/
# Edit DEST inside the .command to point at /tmp/cactus-test/CactusStrudel
# Run it. If it works, ship.
```
