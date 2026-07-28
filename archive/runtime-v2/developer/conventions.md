# Conventions

What you'll be judged against. Bowei enforces these across all changes.

## Code

### Atomic writes for any mutation of persistent state

```python
# Wrong — leaves a half-written file if SIGTERM mid-write
open(MANIFEST, 'w').write(body)

# Right
self._atomic_write_text(MANIFEST, body)
```

Helpers already exist:
- `_atomic_write_text(path, content)` — tmp + os.replace
- `_rewrite_jsonl(path, items)` — atomic JSONL rewrite
- `_write_manifest_entries(rows)` — atomic corpus rewrite
- `_write_bridge_tasks(tasks)` — atomic tasks.jsonl

Single-append (e.g. logging) doesn't need atomicity:
```python
with open(REVISIONS, 'a') as f:
    f.write(json.dumps(rev) + '\n')
```

### Single source of truth for backend registry

`BACKEND_REGISTRY` in `runtime/serve.py` is the ONLY place that knows about
backend slots, vendor mapping, or model names. Don't duplicate.

`BACKEND_SLOTS` is the iteration order — first entry = default for new users.

### Schema_v2 for corpus entries

Every new corpus entry must go through `_build_corpus_entry()`. That helper
guarantees `schema_version`, `i` (monotonic), `name`, `source` (slot key),
`genre_code`, `category`, `extra` fields. Never hand-build a corpus row.

### No raw vendor model names in UI

UI never sees `gpt-5.5(high)` or `claude-opus-4-7(xhigh)`. Only the short
label (`GPT 5.5`, `Opus 4.7`). Models live in `BACKEND_REGISTRY`.

### Env > config > defaults precedence

Anything user-configurable goes through `user_config.load()`. Don't read env
vars directly in feature code; the loader composites all 3 layers.

## UI

### Top nav — identical across pages

`nav.top` CSS block is copy-pasted across `main.html`, `data.html`,
`spine.html`, `settings.html`. Same padding (clamp-vh-based), gradient,
backdrop-filter, sticky, z-index. **Do not redesign per page** — sync any
change to all 4.

The active tab gets the gold gradient + `border-bottom:2px solid var(--gold)`.

### Color identity

- `--gold #d4af37` = USER (chat input, score, "you", category accent)
- `#d6c89c` 米色 = AI / Opus brain (assistant replies, AI metadata, brain info-icons)
- `#141416` 黑炭 = code block backgrounds
- Tokyo Night palette = code syntax highlighting

Don't reverse user/AI colors. Don't mix gold + 米色 in the same component.

### info-icon for hidden details

Reusable component for "nice-to-have but cluttery" metadata. Pattern:

```html
<span class="info-icon" data-tip="multi-line\ntooltip text">i</span>
```

The popup is a single body-level `position:fixed` div positioned by JS — it
escapes any ancestor `overflow:hidden`. Already wired in main.html + data.html
+ spine.html + settings.html.

Use info-icon for: SHA hashes, internal IDs, build timestamps, lengthy
explainers, file paths. Never for actionable controls.

### Per-backend color palette

Synced between `BACKEND_META` (data.html for trajectory cards) AND
`.c-meta .m-backend[data-src=…]` (data.html for piece pill tags). Don't
update one without the other:

| Slot | Color | Vendor identity |
|---|---|---|
| gpt-5.5 | `#a855f7` | purple — OpenAI |
| gpt-5.5x | `#6d28d9` | deep purple — OpenAI xhigh |
| agy-cli | `#2dd4bf` | turquoise — Antigravity |
| opus-4.7 | `#fb923c` | orange — Anthropic |
| gemini-flash | `#38bdf8` | sky — Google fast |
| gemini-pro | `#1d4ed8` | deep blue — Google deep |
| grok-build | `#94a3b8` | silver-grey — xAI |

Per-category palette (data.html `.traj-row .batch[data-batch=…]::before`):
mint / orange / amber / sky / lavender / pink / grey for club/bass/jazz/
melodic/downtempo/experimental/uncategorized.

### Settings input UX

Password fields with already-saved keys:
- Field shows EMPTY value (not the masked sentinel) on load
- Placeholder = "✓ key saved — type new key to replace"
- On save: if user typed something → use it. If empty AND `dataset.hasKey` → send mask sentinel to preserve. If empty AND no saved → send empty (clear).

Test buttons:
- Send INLINE form values (not what's saved) so user can verify before committing.
- Backend's `/api/settings/test-backend` accepts `inline: {api_key, base_url}` and uses those if provided.

## Workflow

### Checkpoint before architectural changes

Any change touching:
- BACKEND_REGISTRY structure
- `_resolve_slot_route` semantics
- corpus schema
- Settings UI structure
- Brain tool surface
- nav.top structure

…starts with `bash bin/checkpoint-create N-name "<short>"`.

Numbering: `<N>-<kebab-description>` where N continues the latest sequence
(check `.latest`).

### Smoke test pattern

After backend changes:
```bash
# 1. compile-check
python3 -m py_compile runtime/serve.py

# 2. restart server
pid=$(lsof -nP -iTCP:8765 -sTCP:LISTEN -t | head -1)
[ -n "$pid" ] && kill "$pid" && sleep 1
python3 runtime/serve.py >/tmp/cactus-serve.log 2>&1 & disown
sleep 2

# 3. probe key endpoints
curl -s http://localhost:8765/api/version
curl -s http://localhost:8765/api/backends | python3 -m json.tool | head -20
```

### Terse responses

User-facing reply convention:
- Lead with verdict (what changed, did it work)
- Then 1-3 bullet details
- Quote file:line references where applicable
- Cite specific tests run
- No `🎉` / no marketing. Direct, honest, includes caveats.

### Honest gaps

If a fix is 95% but has a known gap, say so. Don't claim done. Bowei prefers
"here's the gap, decide if you want it fixed" over hidden risks.

## Don'ts

- Don't write to `producer-brain/kernel/*.md` from feature code paths. The
  Settings UI Kernel disclosure is the only allowed mutation surface.
- Don't add per-slot env vars for new backends — use `BACKEND_REGISTRY`.
- Don't add new "modes" without consolidating with existing ones. Currently
  we have agy/cliproxy/direct routes — adding a 4th needs a strong reason.
- Don't reintroduce the old `gf` web-scrape path (archive-gf/ is the museum).
- Don't add API keys to env defaults — always start from empty.
- Don't sudo. Ever. Without explicit Bowei ask.
