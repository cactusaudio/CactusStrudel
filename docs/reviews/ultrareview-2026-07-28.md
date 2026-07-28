# CactusStrudel Ultrareview and remediation blueprint — 2026-07-28

## Verdict

CactusStrudel v3 has converged on the right product topology, but it is not
landing-ready or acceptance-complete.

The good part is substantial: there is one editable Producer UI, one local
application boundary, one direct CLIProxy settings path, immutable revision
identity, exact rating targets, a bounded active workspace, and a much clearer
developer entry topology. The old multi-product/research graph is no longer
competing with the live product.

The remaining gap is not “more features.” The system still needs one runtime
owner, one shared revision-usability decision, and recoverable external-effect
commit protocols. Without those, green structural tests can coexist with
split-brain recovery, an audio file whose bytes no longer match its rating
identity, or a promoted unusable revision. Source/build/served identities are
now implemented and independently counterexample-tested in the local tree;
reproduction from HEAD still awaits an intentional landing unit.

This review therefore replaces the earlier overconfident closure language with:

- **one P0**: runtime ownership and fencing;
- **P1 consistency gaps** across render commit, revision usability,
  generation/Brain effects, and restart-level operation identity;
- **a landed GUI P1 correction** covering eight reproduced product-state
  failures;
- **landed effective-source and controlled-build receipts** for both web
  surfaces, including live served-byte readback;
- **a product-ready Pro collaboration skill** with durable recovery;
- **a phased blueprint** that closes invariants before adding product breadth.

Musical quality remains a human listening decision. No validator, feature
extractor, model report, or test suite is treated as evidence that a piece is
good.

## Evidence language

Every material conclusion uses one of four evidence classes:

| Mark | Meaning |
|---|---|
| `[R]` | reproduced with a focused fault injection, browser journey, or live readback |
| `[S]` | determined from the current source and contracts |
| `[J]` | product or architecture judgment, not a defect claim |
| `[X]` | refuted or superseded by better evidence |

The review distinguishes:

1. candidate source supplied to an external reviewer;
2. changes actually present in the primary working tree;
3. generated build bytes;
4. bytes served by the running process;
5. deterministic test evidence;
6. a real model/render journey;
7. Bowei’s listening and product acceptance.

None substitutes for the next.

## Reviewed baseline and live readback

The source snapshot was taken from:

- repository: `/Users/bowei/CactusStrudel`;
- branch: `codex/cactusstrudel-v3`;
- HEAD: `95f85f60596cc226c477543a873e3c4ec95e32fb`;
- source state: a large intentional v3 cutover above an older committed
  baseline;
- latest bounded readback: 535 compact Git status rows and 1,085
  source-attestation status entries;
- staging state: none;
- publication state: no commit, push, pull request, or deployment performed.

`bin/catch-up` and the live health route at the final review baseline reported:

- local server online at `127.0.0.1:8765`;
- 51 pieces and 51 immutable revisions;
- 4 human ratings;
- 53 truth jobs and 4 generation batches;
- provenance: 49 `legacy_unknown`, 2 native;
- prompt-kernel hash `3b14f2697c862db9`;
- no active Brain job;
- Agent draft `claude-opus-5` has a non-stale passing Test, but no Applied
  Agent revision;
- five exact generation profiles;
- no active handoff.

The current reconciliation readback reports 51 matched revisions, no
filesystem-only promoted receipt, no invalid receipt, and no registered row
without a valid receipt. That describes current data. It does not remove the
fault windows below.

## Review coverage

This was a source, runtime, data, GUI, product-state, Agent, renderer,
repository, documentation, build, archive, and operator-workflow review.

The active source capsule deliberately excluded Git internals, dependencies,
build caches, live databases, browser state, runtime state, and local-only bulk.
The review inspected active text/source comprehensively and used targeted
readbacks for live state. It did not pretend to byte-review every file inside
the roughly 3.5 GB machine-local archive or every historical audio binary.

Three independent ChatGPT Pro conversations reviewed separate seams:

- runtime, data, Agent and renderer:
  <https://chatgpt.com/c/6a68c3d4-8894-83e8-bc72-5e6d92f6ebe5>
- GUI, product flow and client state:
  <https://chatgpt.com/c/6a68c486-0ed4-83e8-ad45-e3ed327e362d>
- repository, build, documentation and delivery:
  <https://chatgpt.com/c/6a68c4ef-a0e4-83e8-9053-b65704c85d4b>

Their conclusions were treated as candidates. Codex checked contradictory
claims against source, ran patches in isolated combined snapshots, rejected
unsound runtime and repository candidates, requested narrow corrections, and
promoted only locally confirmed work.

## Source capsules and external artifacts

### Primary source capsule

- file:
  `/Users/bowei/Downloads/CactusStrudel-Pro-ultrareview-20260728-95f85f6.zip`
- bytes: 402,132
- SHA-256:
  `bdc3ef92a3690c1c271831383f70f920bcaee76c2a5c68cf2df7370dddc2ee22`
- payload files: 174
- ZIP entries: 223
- manifest SHA-256:
  `4555a5f0649f07a7c4467328cdc758ef5b5d7a30f6e3125ce918bdc9b4fd8828`
- manifest format: `zip-members-v1`

### Supplement

The first capsule omitted four large docs/data files and eight frozen-GUI
screenshots required by existing tests. This was reported to Pro as a capsule
gap, not misrepresented as a repository failure.

- file:
  `/Users/bowei/Downloads/CactusStrudel-Pro-ultrareview-supplement-20260728-95f85f6.zip`
- bytes: 2,475,722
- SHA-256:
  `4f3620fafc13f172e96b965093fb240ae26ba842499e7161c668b176811476ff`
- manifest payloads: 12
- manifest SHA-256:
  `d33c5cda2a8ca90b3739d892ab5eb0a3804c7e9be211ea70813b6d3bd1da02aa`

### CLIProxy contract supplied separately

- file:
  `/Users/bowei/Downloads/CLIProxyAPI-MacBook-Air-LAN-API-Key-Usage.md`
- bytes: 8,965
- SHA-256:
  `1ca8fd06f61e6219d4851f4eee61228f442427baadb13b1bcd6b9454ba55e815`

The product contract extracted from it is direct native CLIProxy on port 8318,
no historical 84xx shim, exact model/effort/orchestration identity, and the
Draft → Catalog → Test → Apply settings lifecycle.

### Pre-rebuild GUI baseline

The pre-v3 GUI was frozen before the Producer UI cutover:

- archive:
  `archive/gui/ui-v2-baseline-20260728-95f85f6/`
- local annotated tag: `ui-v2-baseline-20260728-95f85f6`
- tag target: `95f85f60596cc226c477543a873e3c4ec95e32fb`
- contents: four HTML sources, four upload assets, three masked API snapshots,
  eight screenshots, manifest and restore note;
- manifest readback: 19/19 payload SHA-256 values match.

`probe-renderer.mjs` was already a separate Bowei worktree modification, was
excluded from this GUI snapshot, and remains untouched.

### Accepted GUI delivery

- report:
  `/Users/bowei/Downloads/CactusStrudel-gui-product-ultrareview-addendum-2026-07-28.md`
- report SHA-256:
  `4af62963f9ce2cdc46c5ae1fbf703b8e310e48365f534896e5c8f65394d967b4`
- patch:
  `/Users/bowei/Downloads/CactusStrudel-gui-p1-corrected-2026-07-28.patch`
- patch bytes: 65,321
- patch SHA-256:
  `e611a057263756e3cb38c7e7e01df06b127b94f1abfa0c258c0fe713e4c43156`

The 13-file GUI patch was applied to an isolated combined snapshot first and
then, after review, to the primary working tree with `apply_patch`.

### Rejected runtime systems candidate

- corrected artifact ZIP:
  `/Users/bowei/Downloads/CactusStrudel-corrected-artifacts.zip`
- ZIP bytes: 40,641
- ZIP SHA-256:
  `8110a4f23e372841b6e754b298e001ee1bd095b8d9bff32d216079d404a7fe68`
- patch bytes: 205,386
- patch SHA-256:
  `8e4a76ab6a974449af1d2f0d4919c94d7e346be1834dc2f825ae93ba66812d19`

The corrected bundle has three unique members, passes ZIP integrity, and its
manifest matches every member byte-for-byte. Its nullable-receipt claim was
explicitly retracted after Codex pointed to the strict `NOT NULL UNIQUE`
schema.

The 21-file, 3,211-insertion patch was not landed. Independent fault injection
showed that it regressed the stronger landed reverse-identity reconciliation,
did not run graceful close/drain on ordinary `SIGTERM`, still orphaned promoted
assets on a legal display-name collision, and still allowed rating mutated
audio bytes under the old database SHA. Its Brain migration also defaulted
legacy dispatch/effect state into either permanently queued work or replayable
unknown effects, while owner/attempt checks were bypassed when callers omitted
both tokens. Passing 39 Agent, 20 RuntimeTruth and 56 API tests did not close
those product contracts. The strict tool-argument validator is a useful
standalone idea, but was not mixed into the primary tree from this rejected
systems patch.

### Rejected repository candidates

The initial repository fingerprint patch was not landed:

- bundle:
  `/Users/bowei/Downloads/CactusStrudel-repo-systems-ultrareview-bundle-2026-07-28.zip`
- bundle bytes: 61,532
- bundle SHA-256:
  `d966e6fada0f46f51ab0b6888bab59de21a07537330bd13638a6b881096313a5`
- candidate patch SHA-256:
  `44364f2b703fbfb43012b67cef2792d064d293848c1babd58246175ad609fab9`

It excluded the generated state document and detected ordinary dirty content,
but it collapsed HEAD/index/worktree/untracked identities, missed
`assume-unchanged` content, mixed some build output into “source,” omitted
lock/builder/served identities, and launched one Git process per dirty file.
On this tree its median runtime was 5.568 seconds versus about 0.060 seconds
for a batched content-hash implementation. Passing its own four tests did not
make its model correct.

The second repository bundle was also not landed:

- bundle:
  `/Users/bowei/Downloads/CactusStrudel-repo-systems-corrective-second-pass-2026-07-28.zip`
- bundle bytes: 112,089
- bundle SHA-256:
  `c40289ca60859691db0fe78d74777f513a782147f8cc4b73646780900801cf2c`
- build-receipt patch SHA-256:
  `1290dcd51abc8a1255bb352a1790bce360ec90cd8ac19a356927bb695b2087da`
- source-attestation patch SHA-256:
  `928be48d63c01a17d516b6a3a3b5ff4890999d540668be8cb8c8751241680c91`

It separated normal `MM`, `AD` and staged/untracked cases and was fast, but
flag-only `assume-unchanged`/`skip-worktree` changes still produced identical
index and landing identities. More seriously, its public receipt `write`
command could pair changed source with old `dist` and then report `valid`.
Those are ordinary-operation counterexamples to the two core claims.

The third repository bundle split the two concerns cleanly:

- bundle:
  `/Users/bowei/Downloads/CactusStrudel-repo-systems-counterexample-fix-2026-07-28.zip`
- bundle bytes: 61,473
- bundle SHA-256:
  `e38e328153b531076ab41ba58ec90c433e5810e1157f4fdb90f18078f4421e29`
- source-attestation patch SHA-256:
  `77cb3acc98e3c558b54af404d7e1226aa84d63e5b9c127e110ee009f22fd94ed`
- first controlled-build patch SHA-256:
  `c6a11aa9f9058ea2ee56e188be57916792e5190d2a419561ff5830fcfa78be05`

Its source-attestation half was accepted: it batches Git reads, keeps path,
mode, object ID, stage and raw index flags visible, separates effective source
from landing metadata, and passed 14 counterexample tests. Its build half was
rejected after an independent symlink counterexample: changing bytes behind a
task-input symlink changed the built output without changing the claimed input
identity.

The fourth, narrow replacement corrected that exact defect:

- bundle:
  `/Users/bowei/Downloads/CactusStrudel-repo-systems-0002-symlink-correction-2026-07-28.zip`
- bundle bytes: 26,160
- bundle SHA-256:
  `883b636f50767c0ef2ebc98ca27a96d14369f61bb40dd83db7cf386780278e4e`
- replacement patch bytes: 74,057
- replacement patch SHA-256:
  `f267e7263788ff1b80fbf6daa5c79400541f1ba31845a80568ba787044bd2271`
- regression file SHA-256:
  `cd9101d3a174f2203ca07d0cf87b50ca9c125f7f88bf4d6208fea45cad14e3f5`

ZIP structure, CRC, manifest and SHA inventory all passed. The replacement
rejects any task-input symlink before touching intent or output, rescans inputs
before publication, and binds current source/lock/builder/command identity to
the exact output tree. It was accepted only after the full patch passed in an
isolated copy and both build receipts plus a real served-byte comparison passed
in the primary tree.

## Architecture assessment

### What is now right

The live product can be explained without reading the whole repository:

```text
Producer UI
  → local HTTP/SSE adapter
  → V3Application
       ├─ immutable piece/revision truth
       ├─ generation batches and child jobs
       ├─ Brain jobs and tool receipts
       ├─ Agent and generation settings revisions
       ├─ normalized UI event projection
       └─ validator → realtime renderer → immutable assets
```

The strongest decisions are:

- a piece is stable library identity;
- a revision is immutable rendered identity;
- a score binds to revision ID and audio SHA;
- preview creates a revision instead of silently replacing the editor base;
- promotion changes the active pointer;
- generation and Brain jobs pin the settings revision they use;
- the Agent path calls native CLIProxy directly;
- active topology is three apps and three packages;
- historical systems are outside workspace/discovery;
- `AGENTS.md` is the sole cross-agent entry contract;
- `CLAUDE.md` is a thin adapter;
- there is intentionally no singular `AGENT.md`.

### Where the design still lies to itself

Several interfaces look singular at the UI level but are not yet singular at
the commit boundary:

- two server processes can recover and mutate the same state root;
- asset rename and database registration are separate;
- receipt verification exists, but list/serve/score/promote do not all consume
  one shared usability decision;
- external Brain effects and their durable receipts can split;
- a browser-page operation intent survives an uncertain response, but not a
  browser restart.

The repository now does have a tested effective-source → controlled-build →
served-byte chain. That closes local attribution; it does not make the old HEAD
commit reproduce the large uncommitted v3 cutover.

These are the seams to close. Replacing the whole architecture would add risk
without fixing them.

## Priority matrix

| ID | Area | Evidence | Current state |
|---|---|---|---|
| RT-OWNER-001 | runtime owner | `[R]` | fixed in source/tests |
| DT-001 | render commit | `[R]` | open P1 |
| DT-002 | reverse reconciliation | `[R]` | fixed in source/tests |
| DT-003 | exact heard bytes | `[R]` | open P1 |
| DT-004 | promotion usability | `[R]` | open P1 |
| GEN-TERM-001 | generation finalization | `[S]` | open P1 |
| BJ-QUEUE-001 | Brain queued recovery | `[R]` | open P1 |
| BJ-EFFECT-001 | Brain effect receipt | `[R]` | open P1 |
| UI-P1-001…008 | GUI identity/state/layout | `[R]/[S]` | fixed locally |
| IDEM-001 | restart-level operation receipt | `[S]` | partially fixed; open P1 |
| RS-001 | HEAD reproduces reviewed source | `[R]` | open landing boundary |
| RS-002 | effective source identity | `[R]` | fixed locally |
| BUILD-UI-001 | UI build/served identity | `[R]` | fixed locally |
| BUILD-RND-001 | renderer build identity | `[R]` | fixed locally |

## P0 — acquire one runtime owner before touching state

### RT-OWNER-001

`[R]` The server constructs `V3Application` before binding its HTTP port.
Construction initializes stores and immediately runs recovery. A second launch
can therefore interrupt jobs in the same state root before it discovers that
the port is already occupied. Fault injection produced the impossible
combination: one owner interrupted work while another owner later promoted its
result.

This is a product-data bug, not a hypothetical multi-server deployment.
Double-clicking twice, a stale old process, or a restart race is enough.

Required design:

1. derive the state root without constructing application services;
2. acquire a non-blocking state-root owner lock first;
3. assign an owner epoch before migrations or recovery;
4. run migrations and reconciliation only under that owner;
5. accept HTTP work only after recovery finishes;
6. add owner epoch and attempt checks to job/effect finalization;
7. on shutdown, stop accepting work, request cancellation where supported,
   drain for a bounded interval, then close stores and release ownership;
8. fault-test two processes against one state root and a late worker from an
   older epoch.

The useful lifecycle is:

```text
owner_acquired
  → migrated
  → recovering
  → accepting
  → quiescing
  → closed
```

Do not build a cluster coordinator. One local lock, one epoch, and explicit
late-worker rejection are sufficient.

Landed after this review (same working tree): the fault was reproduced in an
isolated temporary state root, then closed by `runtime/v3/owner.py`.
`serve.py` acquires the non-blocking `owner.lock` flock before binding and
before `V3Application` exists; a losing launch exits with code 3 before any
store or schema work, even on a free port. The lease persists a monotonic
epoch in `owner.json`, walks the lifecycle above, fences every store mutation
(new dispatch refused while quiescing; finalization/publication fails closed
after release), stamps `owner_epoch` into job/brain events, and SIGINT/SIGTERM
share one bounded quiesce→cancel→drain→close→release path.
`tests/v3_api/test_runtime_owner.py` pins two-process double launch, same-root
state untouchedness, late-finalize refusal, drain escalation, SIGTERM
closed/released, and restart epoch monotonicity.

## P1 — runtime, data and external effects

### DT-001 — asset promotion can outrun registration

`[R]` The render path promotes a completed asset directory before registering
the version in SQLite. Injecting a database failure after rename leaves a
complete promoted orphan.

Blueprint:

1. persist a content-bound commit intent;
2. verify staging against that intent;
3. promote the exact directory;
4. finalize version, job and model-run rows idempotently;
5. on restart, adopt only an exact intent/receipt match;
6. retain anything else as explicit orphan evidence.

### DT-002 — database-to-filesystem reconciliation

`[R]` The former scan walked filesystem receipts toward database rows but could
not report the reverse case: a registered row whose asset or receipt was
missing.

This review added `registered_without_valid_receipt` to the runtime truth
service, legacy reconciliation counts, docs, and focused tests. A later
fault injection found that receipt SHA alone could still call a crossed
database row `matched`; the landed comparison now also requires equal
`piece_id`, version ID, `asset_dir`, and job ID. Crossed rows are reported as
`registered_receipt_identity_mismatch` and remain in
`registered_without_valid_receipt`. The current readback reports zero such
rows. This closes observability, not the DT-001 commit window.

### DT-003 — serve and score the verified bytes

`[R]` After mutating a committed MP3, receipt verification reports drift, but
the static route can still serve the changed bytes and scoring can still bind a
rating to the old database SHA.

Introduce one `RevisionUsability` result consumed by every product read or
mutation:

```text
usable =
  database revision exists
  AND receipt parses
  AND receipt identity matches database identity
  AND source/audio bytes match receipt
  AND revision lifecycle permits the requested action
```

List may expose an unusable revision with a reason. Playback, scoring,
promotion, and Brain context must not treat it as valid heard truth.

### DT-004 — promotion accepts unusable targets

`[R]` A `legacy_partial` or missing-asset revision can still become current.
Promotion must call the shared usability seam and reject targets whose exact
rendered identity is not available.

### GEN-TERM-001 — parent can terminalize before late child commit

`[S]` An exceptional batch path can mark the parent terminal while a child
still holds an external render/model result and later commits it.

Blueprint:

- persist child dispatch intents before work starts;
- stop dispatch on cancellation/failure;
- drain or explicitly abandon all allocated children;
- derive the parent terminal summary only from durable child terminal rows;
- reject late commits from the wrong owner epoch or attempt;
- make restart reconciliation finish the same state machine.

### BJ-QUEUE-001 — queued Brain work can strand on restart

`[R]` A Brain row can be durably queued before runner submission. Recovery
queries running/cancel-requested work, so a stop in that gap can leave the row
queued forever.

Persist dispatch intent and either submit it under the current owner or mark it
reconciliation-required. Recovery must cover queued dispatches, not only work
that already began.

### BJ-EFFECT-001 — external effect and tool receipt can split

`[R]` A mutating Brain tool can finish its external effect and then fail while
writing the tool receipt. Generic job failure does not describe reality and a
blind replay can duplicate the effect.

Use an effect state machine:

```text
planned → executing → effect_observed → finalized
                      ↘ reconciliation_required
```

The effect identity, target identity, input hash, output identity, owner epoch
and attempt belong in the durable row. Recovery reconciles the observed effect
before retrying.

### IDEM-001 — page-lifetime reconciliation is not restart recovery

The accepted GUI patch now creates a `MutationIntent` for generation, preview,
Brain and score. An unknown response can be reconciled with the same method,
path, canonical body and idempotency key; changing any captured request field
is rejected before fetch. The user can also abandon that intent and start a
new one explicitly.

This closes accidental duplicate clicks and same-page uncertainty. It does not
survive a browser process restart. The server still needs a compact operation
receipt/readback route so a restored UI can ask for the exact prior outcome
before creating a new durable operation.

## Landed GUI correction

The GUI change is an invariant repair, not a cosmetic redesign.

### 1. Audition identity versus editor identity

When B is selected, score, prompt receipt and Brain context follow B, while the
editor and External DAW still use A or its draft. The UI now says this
explicitly:

- Editing A / Editing A draft;
- Auditioning A / Auditioning B;
- External DAW copies A code or A draft.

The editor is not silently switched to B.

### 2. Draft recovery and internal navigation

The Agent Settings link now uses SPA navigation for ordinary clicks while
preserving modified-click browser behavior. Per-piece editor drafts persist in
session storage as `{baseRevisionId, code}` and are cleared when promoted or
identical to the A source. They do not masquerade as durable revisions.

### 3. Reachable 900-pixel workspace

The global 1050-pixel minimum was removed. Below 1049 pixels, Studio owns
horizontal overflow and retains a 928-pixel minimum working canvas, so the
Brain column is reachable rather than clipped. This is a bounded reachability
fix, not a claim of full compact-screen redesign.

### 4. Editor line-rail synchronization

Textarea and line rail now share an exact line height, top padding, and
scrollTop. The reproduced `textarea.scrollTop=894.5` versus
`lineRail.scrollTop=0` drift is closed.

### 5. Late-response ownership

- generation and Brain clear only the exact composer value they submitted;
- score locks while submitted or outcome-unknown;
- Library metadata responses remain bound to their captured piece;
- Agent Discover/Test/Apply/Discard accept ordered bootstrap readback as
  authority;
- preview accepts only the one exact own-SSE insertion proven by revision ID
  and a single epoch increment.

### 6. Research and Activity truth

Research cohort identity now includes exact route. Unknown orchestration or
repair provenance no longer collapses into a standard first-shot cohort.
Activity and Studio use consistent active-state interpretation.

### 7. Route-roundtrip ownership

Every real route change now goes through the store’s sole `setRoute()` entry
and increments `workspaceEpoch`. A deferred preview or promotion captured in
Studio is therefore rejected after Studio → Library → Studio even when all
visible piece/A/B fields happen to return to their old values.

### 8. Agent Settings operation ownership

Discover/Test/Apply/Discard ownership now lives in the store as an exact
candidate fingerprint plus nonce. Component unmount cannot erase the lock, a
later local edit cancels the old owner, and an old authoritative readback
cannot clear or overwrite the newer draft.

Independent landed evidence:

- reverse application check of the candidate patch: passed;
- Producer UI typecheck: passed;
- UI tests: 6 files, 34 tests passed;
- production UI build: passed;
- full repository test/build results appear in the final gate section.

## Optimal GUI topology from here

The current route topology is good and should be deepened rather than replaced:

| Route | Single job |
|---|---|
| Studio | brief → generate → audition A/B → edit/preview → score → ask Brain |
| Library | organize pieces and select a stable piece identity |
| Research | compare evidence cohorts without mutating product truth |
| Activity | explain durable jobs, stages, effects and reconciliation |
| Agent Settings | Draft → Catalog → Test → Apply |
| Generation Settings | exact profile/model/effort/orchestration ownership |
| System Settings | runtime/build/readback facts |

Within Studio, the durable mental model should be visible as:

```text
Piece
  ├─ Active revision A
  ├─ Audition candidate B
  ├─ Local editor draft based on A
  ├─ Preview operation/effect
  ├─ Exact score target
  └─ Brain thread bound to one revision/audio identity
```

Next extraction seams should follow ownership, not file size:

- `StudioWorkspace` state and identity selectors;
- generation operation controller;
- preview operation controller;
- score operation controller;
- Brain conversation/activity projection;
- Agent Settings workflow state;
- route-scoped styles.

Avoid a one-shot component rewrite. Extract a seam only while closing its
invariant or adding a feature it owns.

## Agent Brain and Settings blueprint

### Current strengths

The active Agent path already has the right shape:

```text
CactusStrudel → native CLIProxy `/v1` → exact selected model
```

The active settings service already separates Draft, Catalog, Test and Apply,
uses an exact fingerprint, performs an inert tool round-trip, stores immutable
Applied revisions, and prevents Brain tools from changing Agent settings.

### Required product model

Treat these as four visibly different objects:

1. **Applied revision** — sole behavioral authority.
2. **Draft** — editable candidate with a base revision.
3. **Catalog snapshot** — models and capabilities observed from the current
   CLIProxy route.
4. **Test receipt** — exact draft fingerprint, route, model, effort,
   orchestration, stages, result and timestamp.

Apply must compare all three identities:

```text
current draft fingerprint
  == passing Test fingerprint
  == server-side draft fingerprint
```

It must also use a base-revision compare-and-swap so two tabs cannot silently
overwrite each other.

### Agent Settings interaction

The target panel should provide:

- searchable exact model IDs;
- capability and source metadata;
- explicit reasoning-effort choices supported by that exact model;
- explicit orchestration, never inferred from a marketing label;
- a compact active-versus-draft diff;
- separate Catalog, Test and Apply stages;
- stage-specific errors and durable Test receipt;
- focused readback after every operation;
- a clear stale-test explanation after any draft edit;
- no hidden alias or route fallback.

### Brain runtime and Activity

Brain should expose product stages without exposing private model reasoning:

```text
queued
→ dispatched
→ model turn
→ read-only tool / mutating effect
→ finalizing
→ succeeded | failed | cancelled | reconciliation_required
```

Activity should show the job attempt, pinned settings revision, exact
piece/revision/audio target, effect state, receipt identity and recovery
decision. Historical conversations need stable lookup independent of the
currently scored revision.

Whether archive, restore, generate and preview remain available to Brain is a
product decision. Current docs and tests deliberately allow them. The review
did not remove them based on an external reviewer’s preference.

## Renderer and validator findings

### Landed build/preview provenance correction

Renderer-page startup no longer treats `dist/index.html` existence as proof.
It previews only when the current inputs and output tree match the controlled
receipt, then compares the bytes returned by Vite preview with that receipt.
An absent, stale, drifted or malformed receipt selects current-source Vite.
When preview verification fails, the old child must emit exit before its port
can be reused for the source server. Focused lifecycle tests cover that order.

The same receipt runner now owns Producer UI publication. This is deliberately
a build identity boundary, not a render-quality or musical-quality claim.

### P2 backlog

- AudioWorklet capture needs an explicit start/reset acknowledgement so a
  pre-start buffer cannot enter the render.
- ScriptProcessor fallback needs a final flush to avoid dropping the tail
  block.
- the process supervisor must drain and await the Vite descendant, not only
  terminate its immediate child;
- remote sample success set and content identity should enter render
  provenance;
- validator and timing extraction must share accepted tempo APIs;
  `setBpm`/`setCps` currently risk validating while timing falls back to a
  default;
- top-level unbounded constructs need an explicit composition envelope or
  bounded worker stop;
- provider and render deadlines should be monotonic wall deadlines;
- analyzer non-finite values and failed loudness probes should remain explicit
  unavailable results, not plausible numeric facts.

Extend static timing only from real pieces. Do not turn the validator into a
genre, arrangement, or taste engine.

## Repository, docs and archive

### Landed documentation topology

The operating topology is now intentionally small:

- `AGENTS.md`: 180-line sole cross-agent operating contract;
- `CLAUDE.md`: 9-line adapter;
- `docs/README.md`: human task router;
- `docs/areas.json`: machine-readable ownership router;
- colocated component READMEs;
- `docs/STATE.md`: generated mutable facts only;
- `docs/HANDOFF.md`: short baton, not a second architecture diary;
- this dated review: evidence and debt ledger, not operating policy.

Architecture, operations, renderer and runtime docs now state the filesystem/
database split, build-freshness boundary, backup limits, and bounded catch-up
behavior directly. Obsolete specialist agents, old apps/packages and historic
process documents are outside active discovery.

### Landed source/build identity and remaining landing boundary

#### RS-001 — HEAD still does not reproduce the reviewed product

The v3 cutover remains a large local working-tree transition over `95f85f6`.
A fresh checkout of that commit does not reproduce the reviewed source. This
is now explicit rather than hidden by an aggregate hash: source attestation
separates current effective bytes from HEAD and landing metadata. The remaining
action is an intentional commit/tag only if Bowei requests it.

#### RS-002 — effective source identity is now explicit

`bin/source-attest` emits a versioned, commit-independent attestation covering:

- current tracked and non-ignored untracked source bytes;
- Git-exposed index path, mode, object ID, stage and raw flags;
- decoded `assume-unchanged`, `skip-worktree`, `intent-to-add` and unknown
  future flag bits;
- separate effective, tracked-worktree, untracked, index, staged-state and
  landing identities;
- observed branch, HEAD, HEAD tree and compact staged/unstaged/untracked
  previews.

Generated builds, runtime data, generated STATE and ephemeral handoff readbacks
are excluded from source identity. Fourteen focused tests cover `MM`, `AD`,
untracked-to-staged transitions, hidden index flags, raw unknown flags,
symlink identity, Git absence, generated-output separation and process-count
bounds.

#### BUILD-UI-001 and BUILD-RND-001 — controlled publication

Both package build scripts now call `scripts/build-receipt.mjs run`. The runner
uses surface-specific input/output scopes, rejects task-input symlinks before
touching an intent or output, records source/lock/builder/command identity,
builds into a temporary tree, replaces only the owned output, rescans inputs,
and writes exact output path/bytes/SHA-256 values.

`check` rejects source drift, output drift, malformed receipts, wrong builder
identity and stale in-progress intents. `verify-served` compares the receipted
tree with a running HTTP surface. Thirteen tests cover same-size output drift,
stale-source attempts, source mutation during build, failed builds, output
replacement, URL encoding, redirects/non-200 responses, extra served bytes and
the symlink counterexample.

The machine-readable chain is therefore:

```text
effective source attestation
  → surface input manifest + lock/builder/command
  → controlled output receipt
  → current output check
  → served-byte comparison
```

This proves local attribution and freshness. It does not claim that the current
HEAD contains the source, that the renderer produced good audio, or that Bowei
accepted the GUI or music.

### Archive truth

Active workspace discovery is three apps plus three packages. Historical
research source, frozen GUI, old runtime evidence, migration plans and
machine-local bulk have separate roots and restore boundaries.

The roughly 3.5 GB `archive/local` tree is intentionally outside active
topology and was not item-by-item audited in this review. It must not be called
clean merely because it is ignored. Delete it only as an explicit disk-space
decision.

Of 448 tracked source deletions moved into archive, 443 have byte-identical
archive blobs. The remaining five annotations/transformations are no longer
presented as exact copies: `archive/transformations.json` records their old and
new paths, full Git blob OIDs, classification and reason, with 5/5 OIDs
independently read back. Named Python cache directories were moved to
recoverable Trash after the final Python gates; none remain in the repository.
The three ignored, unconsumed package `dist` trees produced by the final build
were moved with them; `runtime/app` and `apps/renderer-page/dist` remain because
they are the actual served UI and renderer-page build outputs.

## Product-ready Pro collaboration skill

The collaboration workflow is installed at:

```text
/Users/bowei/.codex/skills/pro-engineer-loop
```

This engagement’s durable receipt is:

```text
/Users/bowei/.codex/pro-engineer-loop/engagements/cactusstrudel-ultrareview-20260728/receipt.json
```

It activates on an explicit Pro/dual-agent request, or on a complex task where
at least two independent review signals justify the external pass. Routine
localized work remains normal Codex work.

The skill now provides:

- one-conversation default and a maximum three-domain split;
- logged-in/Pro/composer preflight from visible browser state;
- exact attachment and prompt verification;
- bounded tab/page/locator/upload/context recovery;
- no duplicate send while a conversation is visibly working;
- natural Codex-only continuation when the UI itself reports Pro unavailable;
- deterministic source capsule and adjacent receipt publication;
- duplicate-member, CRC, baseline, payload and extra-member ZIP checks;
- durable engagement receipt with file locking and monotonic revision;
- cumulative recovery counters;
- structured confirmed/refuted/unverified/duplicate findings;
- immutable refuted-finding history;
- validation and Git-outcome updates through the same locked CLI;
- exact artifact bytes/SHA readback;
- explicit distinction between candidate, landed, built, served and accepted.

The skill contains no separate policy vocabulary or workflow for concepts that
the Codex system owns. A binary scan of all skill files reports zero forbidden
terms.

Independent skill validation:

- 9 declared files;
- builder tests: 13 passed;
- receipt tests: 14 passed;
- total: 27 passed;
- skill validator: passed;
- Python AST checks: 4 passed;
- binary forbidden-term scan: zero;
- Python cache directories: zero;
- context-minimal forward dry run: passed;
- deterministic capsule: 19 files, 89,107 bytes, SHA-256
  `fa8883c807a061db21fd3793f21cc5ce3825c0710b36c9ed200a33cc9016c0de`;
- independent rebuild of that capsule: byte-identical;
- forward manifest SHA-256:
  `8e8a670726d5c2e66080a923c1d8f8eff7f6f78ba16497f919eecfb18d906d7c`;
- repository status identity unchanged across the dry run;
- directory-sync failure returns a successful known replacement plus
  `directory_synced=false`;
- concurrent receipt updates preserve every row and monotonic revision;
- refuted finding reclassification is rejected without changing receipt bytes.

The forward-test artifacts were moved to recoverable Trash after verification;
the installed skill and durable engagement receipt remain.

The local and `bowei@mbp` portable skill trees both hash to
`63bb62bb24e5e2d4171cc82a634683eecf0a668f7134faf4bb6686468cbdc5ca`.
Both run Codex `0.144.4`, and mbp passes the same 27/27 skill tests with nine
declared files and no Python cache. Its generic `quick_validate.py` could not
run because PyYAML is absent, so that validator is reported unavailable rather
than passed. Since the actual skill bytes are identical, no overwrite or remote
mutation was performed.

Important final file identities:

| File | SHA-256 |
|---|---|
| `SKILL.md` | `a941f88de948fd5cd09e4be90d06889565c405c4dfb9d88913754ae2212a7eed` |
| `scripts/build_bundle.py` | `c2557aaf815d4cfbc02f0fce91ad3061c6250eb0ef373ee7727e28f62b540cbd` |
| `scripts/receipt_tool.py` | `875798c835bb674a76d6914f3d5ee42da342b1ec89dcd31807e08f1cb0669f82` |
| `references/browser-state-machine.md` | `590ca798dc581ca19db53b1fe505ea4bed94b79f784c23cf71780ffb31346ba5` |
| `references/receipt-schema.md` | `32ffb40023f142328c1ae1a0d20b9b7a8dd0a0c88cb518863cf6357f9c20a580` |

## Corrected and refuted external claims

The following Pro claims were explicitly corrected rather than copied into the
repo:

1. `[X/J]` Brain must delete archive/generate tools. Their existence is source
   truth; whether they remain is Bowei’s product decision.
2. `[X]` `receipt_sha256` can be null and cause sorting failure. The schema
   declares it `NOT NULL`; the reverse-reconciliation defect was real for a
   different reason.
3. `[X]` generic preview/promotion responses can always hijack the workspace.
   Existing workspace intent/epoch checks already close the general case; only
   the exact own-SSE exception and late-input ownership needed repair.
4. `[X]` bootstrap freely overwrites newer state. Cursor and same-cursor
   ordering already prevent that general claim.
5. `[X]` Agent Apply bypasses Test, Test automatically Applies, or generation
   settings secretly change Brain. Current source/tests contradict all three.
6. `[X]` filter changes lose editor drafts, multiple audio owners exist, A/B
   loses position, prompt receipts lack revision identity, or effort is guessed.
   Current source contradicts these claims.
7. `[X]` the first capsule’s missing docs/screenshots were repository
   regressions. They were packaging omissions and disappeared in the combined
   snapshot.
8. `[X]` there are zero P0 defects. The single-owner fault injection disproved
   that.
9. `[X]` the initial repository fingerprint patch was production-ready. Its
   counterexamples and performance profile disproved that.
10. `[X]` the second repository patch produced an exact index/build identity.
    Flag-only index changes were invisible, and standalone receipt writing
    could attest stale `dist`.
11. `[X]` the corrected runtime systems patch closed the P0/P1 set. It
    regressed crossed receipt identity, skipped graceful close on `SIGTERM`,
    preserved a general promote-before-register orphan, and did not bind
    rating to current audio bytes.
12. `[X]` the third repository bundle’s build receipt closed all input
    identity cases. A task-input symlink preserved the claimed input hash while
    changed target bytes changed the output. The source-attestation half
    remained valid; the build half required the fourth narrow replacement.

## P2/P3 debt ledger

### Runtime and data

- domain mutations and normalized UI event publication are separate commits;
  add a narrow outbox or durable domain cursor;
- migration and connection ownership are fragmented; reject future schema
  versions and serialize migration;
- prototype settings/Brain tables remain discoverable beside active stores;
  freeze and later retire them through a named migration;
- staging reuse trusts metadata too early; verify before promotion;
- generation cancellation can leave staging;
- API patch types need stricter field validation;
- event payload retention and pagination need an explicit projection policy.

### GUI and product

- several screens/store/style modules remain too large;
- Research needs cohort drilldown to exact piece/revision/audio identities;
- Brain history needs durable conversation lookup;
- Activity needs stable ordering and effect/reconciliation drilldown;
- critical helper text should not remain 6–9 pixels;
- focus, reduced-motion and semantic labeling need one compact accessibility
  pass;
- unknown routes need an explicit not-found state instead of an implicit
  Studio fallback.

### Repository and operations

- docs checks validate paths and named topology but do not exhaustively prove
  every future workspace glob or lock importer;
- research routing still points at large evidence stores too early for bounded
  catch-up;
- the close operation is not idempotent;
- root builds can still create internal package output that is not a published
  web surface and therefore has no surface receipt;
- fresh-checkout install/build prerequisites need a concise operator path;
- shell launchers and helper dependencies need explicit gates;
- live SQLite readback tools should use read-only mode.

### Low-priority correctness and maintenance

- rating “latest” ordering and piece pagination tie-breaks differ;
- model response selection prefers the longest fenced block rather than the
  most relevant language fence;
- completed Brain futures remain in memory;
- malformed receipt shapes should degrade per item rather than abort broad
  scans;
- heartbeat exists without a clear writer;
- UI bootstrap fixtures need a compact visual-development harness.

## Remediation sequence

### Phase 0 — freeze invariant expansion

Do not add revision-lifecycle, Brain mutation, or renderer-capture features
until Phases 1–3 are closed. The independent source/build attribution seam is
already complete locally.

### Phase 1 — one owner

- acquire state-root ownership before construction;
- add owner epoch/attempt checks;
- implement quiesce and bounded drain;
- reproduce and close the two-process fault.

Exit: a second owner cannot migrate, recover, dispatch, finalize or publish
against the first owner’s state.

### Phase 2 — one revision-usability seam

- implement `RevisionUsability`;
- route list/serve/score/promote/Brain context through it;
- add render commit intent and exact orphan adoption;
- fault-test rename-before-database and mutated-audio cases.

Exit: every heard, scored, promoted or discussed revision is backed by the
same verified bytes and lifecycle decision.

### Phase 3 — one external-effect protocol

- unify generation child and Brain tool dispatch intents;
- persist effect-observed state;
- reconcile before replay;
- derive parent/job terminal state from durable children/effects.

Exit: no job can say failed while its effect silently committed, and no restart
can duplicate an uncertain effect.

### Phase 4 — finish GUI and Agent product depth

- add restart-level operation readback;
- finish Agent draft CAS and active-versus-draft diff;
- make Catalog/Test/Apply receipts first-class;
- add Activity effect/reconciliation drilldown;
- extract only the ownership seams touched.

Exit: every visible operation names its target, stage, attempt, outcome and
authoritative readback.

### Phase 5 — source/build/served identity — closed locally

- source scope and exclusions are explicit;
- HEAD/index flags/worktree/untracked/landing identities are separate;
- Producer UI and renderer-page use controlled build receipts;
- built and served trees can be compared;
- 14 source and 13 build counterexample tests are in the full gate.

Exit achieved in the working tree: a handoff can name the effective source,
both generated outputs and served bytes. This remains distinct from committing
that source.

### Phase 6 — intentional landing unit

- inspect all additions, modifications and deletions;
- retain `probe-renderer.mjs`;
- regenerate current state;
- run all gates;
- reproduce from an isolated checkout;
- only then create a commit/tag if Bowei separately requests it.

Exit: a fresh checkout reproduces the reviewed source and builds. This review
does not perform the commit.

### Phase 7 — compact real acceptance

Run one real model path, one real render, one A/B/preview/score journey, one
Agent Test, and a human listening/product pass. Do not build a model matrix or
automated taste theater.

Exit: runtime receipts are real and Bowei separately accepts or rejects the
product/music.

## Verification ledger

### Combined source capsule before accepted GUI patch

- dependency installation with frozen offline lock: passed;
- docs/topology: passed;
- Agent Python: 31 passed;
- RuntimeTruth Python: 18 passed at that baseline;
- application/API Python: 46 passed;
- Producer UI: 25 tests passed;
- full Vitest: 87 passed, 6 real-render tests skipped;
- Producer UI build: passed;
- renderer-page build: passed;
- root build: passed;
- operator shell syntax: passed.

### Accepted GUI patch in isolated combined snapshot

- patch dry-run and application: passed;
- Producer UI typecheck: passed;
- UI: 31 tests passed;
- full Vitest: 93 passed, 6 real-render tests skipped;
- Producer UI build: passed.

### Accepted source/build correction in isolation

- third-bundle source attestation: accepted, 14/14 focused tests;
- third-bundle controlled-build patch: rejected on the task-input symlink
  counterexample;
- fourth narrow replacement: ZIP/manifest/SHA verification passed;
- build-receipt tests: 13/13 passed;
- source-attestation tests: 14/14 passed;
- Agent: 31/31 passed;
- RuntimeTruth: 20/20 passed;
- application/API: 46/46 passed;
- full Vitest: 98 passed, 6 real-render tests skipped;
- Producer UI and renderer-page controlled builds: passed;
- Producer UI served-byte verification: passed;
- isolated full `scripts/verify-repo.sh`: passed.

### Primary working tree

After the GUI correction, late-ownership fixes, reverse-reconciliation identity
check, effective-source attestation and controlled-build correction:

- docs/topology: passed, 27 required paths, 30 current Markdown files, 3 apps,
  3 packages;
- repository/source counterexamples: 14 passed;
- controlled-build counterexamples: 13 passed;
- Agent Python: 31 passed;
- RuntimeTruth Python: 20 passed;
- application/API Python: 46 passed;
- Producer UI typecheck: passed;
- focused Producer UI: 34 passed;
- full Vitest: 98 passed, 6 real-render tests skipped;
- root recursive production build: passed for all active build owners;
- current UI build: 23 modules, CSS 49,700 bytes, JS 101,591 bytes;
- Producer UI input SHA-256:
  `81f3cc6fc0a8935870ad65388041aa7cff6d9d3cbd53acd82b795e408e955618`;
- Producer UI output SHA-256:
  `8a665b192545e3895c254d0d228dc0f2f5b5d3ebe4757b702f8d63e7fc5f0960`;
- renderer-page input SHA-256:
  `ced3cf3c52aa21669aa65879d220d2b7488252775163dc94e6d1bb615068c0a8`;
- renderer-page output SHA-256:
  `0d08d780c1d982d9db7ded83b935a9890223635b5757aedb2b9a90245a934f06`;
- served Producer UI matched the receipted output byte-for-byte;
- served CSS SHA-256:
  `5e6ff4a310e34e0ea374957d026d9f44be88e456880dd2eafbaf027b1eb435c3`;
- served JS SHA-256:
  `bc2537cb0b5d5f73dab4d21cc000ac1b6a80b5dc4984cad9cb91da1c32622cd6`;
- 1280×720 live Studio readback: three columns present, no browser log
  entries, explicit Editing/Auditioning identity visible;
- same-tab draft → Agent Settings → Back journey: draft restored; the
  temporary probe was then removed and exact source restored.

The renderer build retains existing Rollup namespace/chunk warnings. The
receipt proves the resulting bytes and current inputs, not that the build was
warning-free or that rendered audio is aesthetically acceptable.

Mechanical checks do not claim:

- a real current model response;
- a new real render;
- real Agent Apply;
- a real score mutation;
- Bowei’s listening or GUI acceptance;
- item-by-item validation of machine-local archive bulk.

## Final state classification

Current classification:

- architecture direction: sound;
- GUI P1 correction: landed locally and independently tested;
- reverse reconciliation and crossed-identity observability: landed locally
  and tested;
- docs/onboarding topology: landed locally and tested;
- archive exceptions: explicitly classified with verified old/new blob OIDs;
- Pro collaboration skill: installed and product-ready;
- runtime P0 owner (`RT-OWNER-001`): closed locally with two-process fault
  tests;
- runtime P1 consistency: blueprint, not closed;
- effective source/build/served attribution: landed locally and independently
  counterexample-tested;
- HEAD/fresh-checkout reproduction: awaits an intentional commit;
- real product/music acceptance: not run and not claimed;
- Git: local working-tree changes only;
- commit/push/pull request/deployment: none.

The next engineer should start with `bin/catch-up`, choose one area from
`docs/areas.json`, and take Phase 1. A new repo-wide scan is neither necessary
nor useful until the source baseline changes materially.
