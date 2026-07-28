"""
prompt_kernel — single source of compositional prompt knowledge.

Compiles fragments from producer-brain/kernel/ into a single text blob,
freshly on each request. No caching: kernel content is the truth, anything
that can derive from it shouldn't be persisted out of phase.

Design constraints (from Bowei, 2026-05-28):
- Bridge between human user and AI producer; not a constraint layer.
- API existence / silent-failure syntax / output format ONLY.
- Zero creative or aesthetic restrictions in the kernel itself.
- The v3 Responses generation path compiles this kernel for every job.
- Human vision is appended as a brief; the kernel never converts taste into a
  recipe.
"""
import hashlib, json, os, re, time

ROOT = os.environ.get('CACTUS_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KERNEL_DIR = f'{ROOT}/producer-brain/kernel'
LOCK_PATH  = f'{ROOT}/producer-brain/kernel.lock.json'

# Core fragments in the order they're concatenated. Any file matching
# kernel/[0-9][0-9]-*.md is a core fragment; style/*.md are optional and
# opt-in per call.
CORE_GLOB = re.compile(r'^\d{2}-.*\.md$')


def _list_core_fragments():
    if not os.path.isdir(KERNEL_DIR):
        return []
    files = [f for f in os.listdir(KERNEL_DIR) if CORE_GLOB.match(f)]
    files.sort()
    return [os.path.join(KERNEL_DIR, f) for f in files]


def _read(path):
    with open(path) as f:
        return f.read()


def compile(mode='responses', preset=None, extras=None):
    """Compile a prompt blob for the requested generator mode.

    Args:
        mode: consumer label. v3 uses 'responses'. The mode does not currently
              change content; it is retained in the prompt receipt.
        preset: optional style fragment to include. If given, kernel/style/<preset>.md
                is appended after the core fragments.
        extras: optional free-form sections appended after the kernel.

    Returns:
        dict with keys:
          text:           the concatenated prompt body (str)
          hash:           sha256 hex of the body + version (str)
          fragments_used: list of relative fragment paths in order (list[str])
          mode:           echo of requested mode
          preset:         echo of requested preset
    """
    fragments = _list_core_fragments()
    if preset:
        style_path = os.path.join(KERNEL_DIR, 'style', f'{preset}.md')
        if os.path.exists(style_path):
            fragments.append(style_path)

    parts = []
    used = []
    fragment_hashes = {}
    for path in fragments:
        rel = os.path.relpath(path, ROOT)
        used.append(rel)
        # Strip leading H1 anchor noise — we want the body of each fragment.
        body = _read(path)
        fragment_hashes[rel] = hashlib.sha256(body.encode('utf-8')).hexdigest()
        parts.append(body.rstrip())

    body = '\n\n---\n\n'.join(parts) + '\n'
    h = hashlib.sha256(body.encode('utf-8')).hexdigest()[:16]
    return {
        'text': body,
        'hash': h,
        'fragments_used': used,
        'fragment_hashes': fragment_hashes,
        'mode': mode,
        'preset': preset,
    }


def verify_lock(mode='agy', preset=None):
    """Verify kernel.lock.json against the current fragments.

    The lock is a guardrail for bundled/offline installs: if a fragment is
    missing, stale, or partially overwritten, generation should fail loudly
    instead of silently changing the producer prompt.
    """
    if not os.path.exists(LOCK_PATH):
        return {'ok': False, 'error': 'kernel.lock.json missing'}
    try:
        with open(LOCK_PATH) as f:
            lock = json.load(f)
    except Exception as e:
        return {'ok': False, 'error': f'kernel.lock.json unreadable: {e}'}
    current = compile(mode=mode, preset=preset)
    mismatches = []
    for key in ('hash', 'fragments_used', 'fragment_hashes', 'text_length'):
        expected = lock.get(key)
        actual = len(current['text']) if key == 'text_length' else current.get(key)
        if expected != actual:
            mismatches.append(key)
    return {
        'ok': not mismatches,
        'error': f'kernel lock mismatch: {", ".join(mismatches)}' if mismatches else None,
        'lock': lock,
        'current': {
            'hash': current['hash'],
            'fragments_used': current['fragments_used'],
            'fragment_hashes': current['fragment_hashes'],
            'text_length': len(current['text']),
        },
    }


def write_lock():
    """Persist current compile state to kernel.lock.json so other tools (research-summary,
    state-refresh) can see which kernel hash is active without re-compiling."""
    c = compile()
    lock = {
        'hash': c['hash'],
        'fragments_used': c['fragments_used'],
        'fragment_hashes': c['fragment_hashes'],
        'text_length': len(c['text']),
        'compiled_at': time.strftime('%Y-%m-%d %H:%M:%S'),
    }
    with open(LOCK_PATH, 'w') as f:
        json.dump(lock, f, indent=2, ensure_ascii=False)
    return lock


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'lock':
        l = write_lock()
        print(f'kernel.lock.json written: hash={l["hash"]}, {l["text_length"]} chars, {len(l["fragments_used"])} fragments')
    else:
        c = compile()
        print(f'# compiled kernel (hash={c["hash"]}, {len(c["text"])} chars)')
        print(f'# fragments_used: {c["fragments_used"]}')
        print()
        print(c['text'])
