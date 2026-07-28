# Substrate Audit — 2026-05-10

Verified live against npm registry on 2026-05-10. Anything not stated here is unverified and must not be load-bearing.

## 1. Strudel package state

Source repo: **codeberg.org/uzu/strudel** (NOT github; older docs may say github). All Strudel packages publish from same maintainer set (daslyfe / yaxupaxo / felixroos). All AGPL-3.0-or-later. Latest publish wave: 2026-01-17/18.

| Package | Version | Notes |
|---|---|---|
| `@strudel/web` | 1.3.0 | Browser bundle entrypoint. Bundles core+mini+tonal+transpiler+webaudio. **Use this in renderer-page**. |
| `@strudel/core` | 1.2.6 | Pattern primitives. Deps: `@kabelsalat/web`, `fraction.js`. |
| `@strudel/mini` | 1.2.6 | Mini-notation parser. |
| `@strudel/webaudio` | 1.3.0 | Web Audio integration. Depends on `superdough` (the audio engine), `supradough`, `@strudel/draw`. |
| `@strudel/transpiler` | 1.2.6 | acorn + escodegen + estree-walker. **Reusable for our validator AST checks.** |
| `@strudel/tonal` | 1.2.6 | Music theory helpers (`@tonaljs/tonal`, `chord-voicings`). |
| `@strudel/repl` | 1.3.0 | Web Component REPL. 5.2MB. Optional preview UI. |
| `@strudel/soundfonts` | 1.3.0 | SoundFont loading. |
| `@strudel/midi` | 1.3.0 | MIDI export. |
| `@strudel/draw` | 1.2.6 | Visualizations. |
| `@strudel/codemirror` | 1.3.0 | Editor extension. |
| `@strudel/hydra` | 1.2.6 | Hydra video integration. |
| `@strudel/csound` | 1.3.0 | Csound bindings. |
| `@strudel/embed` | 1.1.2 | iframe embed. |
| `@strudel/osc` | 1.3.2 | OSC. |
| `@strudel/serial` | 1.2.6 | Web Serial. |
| `@strudel/xen` | 1.2.6 | Xenharmonic. |
| `@strudel/sampler` | 0.2.4 | CLI tool to serve local samples. |

### Render path

Strudel does not publish a Node-headless renderer. The `@strudel/repl` Web Component runs in a browser. The strudel.cc website has an export tab. **Conclusion**: we self-host a static page that loads `@strudel/web`, expose a render API on `window`, and drive it with Playwright. We will:

1. Try `OfflineAudioContext` first (faster than realtime, deterministic). Strudel's `webaudio` engine uses Web Audio nodes; `OfflineAudioContext` is API-compatible if Strudel's scheduler can be coerced to run synchronously. **Open question** — verify in Phase 4 whether Strudel's pattern scheduler supports offline rendering. If not, fall back to (2).
2. Realtime capture in Playwright via `MediaRecorder` or audio routing through the page's `AudioContext.createMediaStreamDestination()`.

### Mini-notation primitives we'll honor

(From the Strudel docs the user has linked + the mini package source — to be re-validated when we install the package locally.)

- Rests `~`, repeats `*`, slow `/`, choices `|`, alternation `<>`, group `[]`, polyrhythm `{}`, euclid `(n, m)`.
- Pattern functions: `s`, `n`, `note`, `freq`, `gain`, `pan`, `room`, `delay`, `lpf`, `hpf`, `bpf`, `cutoff`, `resonance`, `crush`, `distort`, `coarse`, `shape`, `vowel`, `dub`, `attack`, `decay`, `sustain`, `release`, `speed`, `cps`, `setcps`, `bpm`, `setBpm`, `stack`, `cat`, `seq`, `slow`, `fast`, `rev`, `every`, `mask`, `struct`, `degradeBy`, `sometimes`, `chunk`, `swing`, `swingBy`, `iter`, `palindrome`, `range`, `sine`, `saw`, `square`, `tri`, `noise`, `pink`, `brown`.

This list is provisional — Phase 2 (validator) will extract the actual whitelist programmatically from the installed packages.

## 2. Claude Code agent / skill / hook mechanics

Verified at code.claude.com/docs/en (docs.claude.com 301-redirects there).

### Skills (`.claude/skills/<name>/SKILL.md`)

YAML frontmatter (all optional, only `description` recommended):

| Field | Effect |
|---|---|
| `name` | Display name. Default: directory name. Lowercase letters/numbers/hyphens. ≤64 chars. |
| `description` | What/when to use. Capped at 1,536 chars combined with `when_to_use`. |
| `when_to_use` | Trigger phrases. Counts toward 1,536-char cap. |
| `argument-hint` | Autocomplete hint. |
| `arguments` | Named positional args for `$name` substitution. |
| `disable-model-invocation` | Prevent auto-load. Manual `/name` only. |
| `user-invocable` | Hide from `/` menu (Claude-only invocation). |
| `allowed-tools` | Pre-approved tools while skill is active. |
| `model` / `effort` | Override session model/effort for this skill. |
| `context: fork` + `agent: <type>` | Run skill in subagent. |
| `hooks` | Skill-scoped hooks. |
| `paths` | Glob patterns to limit auto-load. |
| `shell` | bash / powershell. |

Body: ≤500 lines recommended. Supporting files in skill dir loaded on demand. Substitutions: `$ARGUMENTS`, `$N`, `$name`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_SKILL_DIR}`. Inline shell injection: `` !`<command>` `` and ` ```! ` blocks (preprocessed, Claude sees only output).

### Subagents (`.claude/agents/<name>.md`)

(Doc returned a large response; full field list captured to file. Key fields confirmed in use across Bowei's other repos: `name`, `description`, `tools` (comma-separated). Other supported fields per dispatch: `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `effort`, `isolation`.) The `description` field is the auto-routing key — Claude reads it to decide when to delegate. Subagent body becomes the agent's system prompt.

### Hooks (`.claude/settings.json`)

Events: `PreToolUse`, `PostToolUse`, `SubagentStop`, `Stop`, `UserPromptSubmit`, `SessionStart`. Configured under `hooks.<event>[].matcher` + `hooks.<event>[].hooks[]`.

Hook input on stdin: JSON with `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input`. For Write/Edit, `tool_input.file_path` is absolute.

Exit codes:
- `0` + JSON to stdout → processed (`hookSpecificOutput.additionalContext` → injected into Claude's context next to tool result).
- `2` → non-blocking error; stderr shown to Claude as feedback. **PostToolUse cannot block** (tool already ran) — it can only inject feedback.
- Other → non-blocking error; stderr → debug log only.

`PreToolUse` can block via `hookSpecificOutput.permissionDecision: "deny"`.

## 3. Audio analysis substrate

| Package | Version | License | Notes |
|---|---|---|---|
| `essentia.js` | 0.1.3 | AGPL-3.0 | WebAssembly. Stale (>1 year publish) but still primary in-browser/Node MIR. **Resample to 44.1kHz** for `RhythmExtractor2013`. |
| `wavefile` | 11.0.0 | MIT | WAV I/O. |
| `playwright` | 1.59.1 | Apache-2.0 | Latest stable; chromium-1217 already cached at `~/Library/Caches/ms-playwright`. |
| `ffmpeg` | 8.1 | LGPL/GPL | Already installed via brew. Used for spectrogram PNG, format conversion. |

LUFS / true-peak: no clean Node package found in 2026 inventory; will implement ITU-R BS.1770-4 directly in `packages/analyzer/src/lufs.ts` (well-specified, ~300 LOC). FAD/CLAP-style embedding: deferred to Phase 9; not on critical path.

## 4. Licensing constraints

- All Strudel packages: AGPL-3.0-or-later.
- essentia.js: AGPL-3.0.
- Whole repo licensed AGPL-3.0-or-later (ADR 0001) to avoid boundary games.
- AGPL viral effect implication: any network deployment of a service using these packages must offer source. Documented in `docs/operations.md`.
- Reference audio in `refs/` is .gitignore'd (never committed). Refs are local-only; analyzer/FAD usage of them stays in-process.

## 5. Known limitations / open questions

1. **OfflineAudioContext compatibility with Strudel scheduler**: needs Phase 4 verification. Realtime fallback always available.
2. **Stem export by orbit**: Strudel's `superdough` engine routes by orbit number; can render same pattern with all-but-one orbit muted to get per-orbit stems. Multi-channel native split not confirmed.
3. **MIDI export** (Phase 11): `@strudel/midi` exports MIDI for live but its file-export is unverified; may need post-process via tonejs/midi.
4. **Sample registry**: Strudel ships default samples (dirt-samples). For deterministic reproduction, we'll vendor a fixed sample set per render (Phase 4).
5. **essentia.js 0.1.3 is old**: if it breaks on Node 22+ we fork or use the WASM module directly via `@mtg-upf/essentia.js-core` — to verify in Phase 5.
6. **CodebergRepo cloning**: `git clone https://codeberg.org/uzu/strudel` works without auth; useful if we need to pin to a specific commit or audit source.

## 6. Decisions

See `docs/adr/` for binding architectural decisions.
