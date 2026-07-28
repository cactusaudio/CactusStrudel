# Cross-Mac context

Bowei runs CactusStrudel across three machines on his LAN. Each one has its
own corpus + config. Mesh-aware operations need to know which is which.

## The triad

| Host | OS user | SSH | IP (current) | CLIProxy port |
|---|---|---|---|---|
| bowei@mac (Mac mini) — PRIMARY DEV | bowei | bowei@mac.local | 192.168.0.100 | 8318 |
| bowei@mbp (MacBook Pro) | bowei | bowei@mbp.local | 192.168.0.104 | 8317 |
| jack@Mac-Studio (Mac Studio) | jack | jack@Mac-Studio.local | 192.168.0.102 | (varies) |

Verified by `mesh status` writing to `~/.claude-sync-audit/topology.json`.
Do not ad-hoc ping/arp — read that file.

## Per-machine `~/.cactus-strudel/config.json`

- mac mini: `cliproxy.base_url = http://127.0.0.1:8318/v1`
- mbp: `cliproxy.base_url = http://127.0.0.1:8317/v1`
- Mac-Studio: depends on what's running locally

Each machine's CLIProxy has its own API key. **The keys are NOT the same**.
The key doc lives at `~/Downloads/CLIProxyAPI-<host-name>-LAN-API-Key-Usage.md`
on each machine; some have only `CLIProxyAPI-LAN-API-Key-Usage.md`.

Settings UI is the source of truth; the legacy ~/Downloads scan was removed
in ckpt-31.

## Mac-Studio is `jack` not `bowei`

The shared Claude Code memory is at `/Users/bowei/.claude/projects/-Users-bowei/`
on mac/mbp, but on Mac-Studio it lives at `/Users/jack/.claude/projects/-Users-jack/`
with a symlink `-Users-jack/memory → -Users-bowei/memory` so the actual
memory files stay canonical.

Implication: `cc.session_dir` auto-derives via `getpass.getuser()` so it
correctly resolves to `-Users-jack` on Mac-Studio. Don't hardcode `-Users-bowei`.

## Deployment recipe (mac → other Macs)

Build tar:
```bash
cd ~
tar [exclude list — see docs/PACKAGING.md] -czf /tmp/cactus-strudel-bundle.tar.gz CactusStrudel
```

Build installer:
```bash
cp bin/install-cactus-strudel.command.template /tmp/install-cactus-strudel.command
chmod +x /tmp/install-cactus-strudel.command
```

Ship:
```bash
# To mbp
rsync -avh /tmp/cactus-strudel-bundle.tar.gz /tmp/install-cactus-strudel.command bowei@mbp.local:Downloads/

# To Mac-Studio (different user)
rsync -avh /tmp/cactus-strudel-bundle.tar.gz /tmp/install-cactus-strudel.command jack@Mac-Studio.local:Downloads/
```

Target machine: user double-clicks `install-cactus-strudel.command` in Finder.
On first boot, Settings page shows "⚙ No backends configured yet" banner →
user pastes API keys → Save → ready.

## Mesh sync

`bash ~/.claude/skills/mesh/mesh.sh sync` is for `~/.claude/` (skills, commands,
memory). It does NOT sync CactusStrudel itself.

To bring code/data changes from one Mac to another, use the tar+install path
(or rsync individual files if precision needed).

**Do not initiate `mesh sync` from brain (even in Developer Mode) without
explicit Bowei OK.** It rewrites ~/.claude/ memory across all 3 Macs.

## Cross-Mac brain corpus is independent

Each Mac has its own `producer-brain/corpus.jsonl`. New pieces on mbp don't
appear on mac. This is by design (per ckpt-29).

If Bowei wants cross-Mac corpus sync, that's a separate feature — would need
either:
- A scheduled rsync of `producer-brain/{corpus.jsonl,pieces,audio,prompts}/`
- A push-model sync endpoint (POST /api/corpus/sync — accept a delta)
- A pull-model federation (GET /api/corpus/diff?since=ts)

Not implemented. See `docs/PACKAGING.md` "Future Hardening" for context.

## Common cross-Mac SSH ops

```bash
# Sanity check reachability
ssh bowei@mbp.local 'echo MBP_OK'
ssh jack@Mac-Studio.local 'echo MAC_STUDIO_OK'

# Check a file's mtime on the other machine
ssh bowei@mbp.local 'stat -f "%Sm %N" ~/CactusStrudel/runtime/serve.py'

# Tail server log on mbp
ssh bowei@mbp.local 'tail -30 /tmp/cactus-serve.log'

# Quick health probe on mbp
ssh bowei@mbp.local 'curl -s http://localhost:8765/api/version 2>&1'
```

## Known gotcha — file conflicts during sync

If you're rsync'ing a folder that the other machine is currently editing, you
can produce 3-way conflicts. The mesh sync script has rollback guards for
protected .md files. For CactusStrudel rsync (not via mesh), there's no such
guard — be careful.

Best practice: when shipping a new tar to a peer Mac, make sure the peer
isn't actively writing corpus.jsonl. Easiest: ask Bowei "is X currently
generating on mbp?" before rsync.
