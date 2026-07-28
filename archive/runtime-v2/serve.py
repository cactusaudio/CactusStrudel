#!/usr/bin/env python3
"""CactusStrudel Runtime server.

Static file serving (with HTTP Range for audio seek) + small POST/SSE
backend for the main page: AGY-CLI generation, score pieces, export MIDI,
save edited code, Claude Code bridge + brain chat.

Single file, stdlib only, threaded (Chrome keep-alive breaks single-thread).
"""
import difflib, glob, http.server, json, math, os, re, signal, socketserver, subprocess, tempfile, threading, time, urllib.error, urllib.parse, urllib.request, webbrowser
from http import HTTPStatus
from shutil import copy2

PORT  = int(os.environ.get('CACTUS_PORT') or 8765)   # env override for port conflicts
# ROOT = the project root, derived from this file's location so it works on
# any host (mbp / mac / Mac-Studio). Env override CACTUS_ROOT for unusual layouts.
ROOT  = os.environ.get('CACTUS_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL   = f'http://localhost:{PORT}/runtime/main.html'

MANIFEST = f'{ROOT}/producer-brain/corpus.jsonl'           # active library (post 2026-05-28)
PIECES   = f'{ROOT}/producer-brain/pieces'
AUDIO    = f'{ROOT}/producer-brain/audio'
PROMPTS  = f'{ROOT}/producer-brain/prompts'
FEATURES = f'{ROOT}/producer-brain/features'
ARCHIVE_INDEX = f'{ROOT}/producer-brain/archive-v0/index.jsonl'  # 104 legacy pieces, frozen, not counted
FAILURE_SPINE = f'{ROOT}/producer-brain/failure-spine.jsonl'      # active failure-pattern knowledge base
GENRE_CODES   = f'{ROOT}/producer-brain/genre-codes.json'
OPUS_PILOT_DOC = f'{ROOT}/docs/cactus-strudel-opus-pilot.md'

# AGY CLI binary — env override for Mac-Studio (`jack`) layout
# NOTE: AGY_BIN, CLIPROXY_BASE_URL, etc. are now resolved per-request via
# user_config.load() so changes in Settings UI take effect without restart.
# These module-level vars are kept as legacy defaults for code that hasn't
# been refactored yet.
AGY_BIN = os.environ.get('AGY_BIN') or os.path.expanduser('~/.local/bin/agy')
CLIPROXY_BASE_URL = os.environ.get('CLIPROXY_BASE_URL', 'http://127.0.0.1:8318/v1').rstrip('/')

# Brain chat model identifiers per route mode
BRAIN_CHAT_CLIPROXY_MODEL = 'claude-opus-4-8(xhigh)'
BRAIN_CHAT_DIRECT_MODEL   = 'claude-opus-4-8'  # Anthropic current (Opus 4.8)
# Legacy alias (some code still references CLIPROXY_MODEL)
CLIPROXY_MODEL = BRAIN_CHAT_CLIPROXY_MODEL

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import user_config  # noqa: E402

# Backend registry — each slot has BOTH a CLIProxy route and a direct-vendor
# API route. _resolve_slot_route() picks one at dispatch time based on what's
# configured. UI never sees model names. To add/remove slots: edit this dict.
BACKEND_REGISTRY = {
    'gpt-5.5':      {'label': 'GPT 5.5',      'vendor': 'openai',    'cliproxy_model': 'gpt-5.5(high)',                'direct_model': 'gpt-5-mini'},
    'gpt-5.5x':     {'label': 'GPT 5.5x',     'vendor': 'openai',    'cliproxy_model': 'gpt-5.5(xhigh)',               'direct_model': 'gpt-5'},
    'agy-cli':      {'label': 'AGY CLI',      'vendor': 'agy',       'cliproxy_model': None,                           'direct_model': None},
    'opus-4.8':     {'label': 'Opus 4.8',     'vendor': 'anthropic', 'cliproxy_model': 'claude-opus-4-8(xhigh)',       'direct_model': 'claude-opus-4-8'},
    'gemini-flash': {'label': 'Gemini Flash', 'vendor': 'google',    'cliproxy_model': 'gemini-3-flash-agent(high)',   'direct_model': 'gemini-2.5-flash'},
    'gemini-pro':   {'label': 'Gemini Pro',   'vendor': 'google',    'cliproxy_model': 'gemini-pro-agent(high)',       'direct_model': 'gemini-2.5-pro'},
    'grok-build':   {'label': 'Grok Build',   'vendor': 'xai',       'cliproxy_model': 'grok-build-0.1(high)',         'direct_model': 'grok-2-1212'},
}
BACKEND_SLOTS = ['gpt-5.5', 'gpt-5.5x', 'agy-cli', 'opus-4.8', 'gemini-flash', 'gemini-pro', 'grok-build']

_SERVER_BOOT_TS = time.time()

# In-flight generation jobs (any backend). Registered when subprocess/HTTP
# call starts, removed on completion. Survives SSE disconnect; lost on
# server restart (acceptable — only used to show "N gen running" pill).
_gen_jobs_lock = threading.Lock()
_gen_jobs = []  # list of {pid|None, started_at, backend, extra}

# Serializes ALL corpus.jsonl mutations (full-file rewrites in score/note/
# archive/delete/rename/update + appends from generation). Without it a
# rewrite that snapshotted N rows races a concurrent append and os.replace()
# silently erases the appended piece (data loss). Reentrant so the locked
# write/append helpers can be called from within a locked transaction.
# (data-integrity fix 2026-05-29.)
_manifest_lock = threading.RLock()
# Same protection for the failure-spine file (add=append vs status-update=rewrite).
_spine_lock = threading.RLock()
# Pending permanent-delete confirmation nonces (piece name → {nonce, ts}).
# Forces a deliberate two-call confirm round-trip for the irreversible delete.
_delete_nonces = {}

# Brain's generate_piece runs ASYNC (fire-and-forget) since batch tasks like
# "generate one per preset" need brain to fire 30+ tools in one chat round
# without blocking on each. Concurrency capped to keep CLIProxy + Playwright
# from thrashing.
_BRAIN_GEN_CONCURRENCY = 3
_brain_gen_sem = threading.BoundedSemaphore(_BRAIN_GEN_CONCURRENCY)
_brain_gen_jobs_lock = threading.Lock()
_brain_gen_jobs = []  # list of {job_id, slot, queued_at, status}
_jsonl_cache_lock = threading.RLock()
_jsonl_cache = {}  # (path, tail) -> {sig:(mtime_ns,size), rows:list}
_text_cache_lock = threading.RLock()
_text_cache = {}  # path -> {sig:(mtime_ns,size), text:str}

# ---- Claude Code bridge ---------------------------------------------------
BRIDGE = f'{ROOT}/runtime/cc-bridge'
INBOX     = f'{BRIDGE}/inbox.jsonl'
REPLIES   = f'{BRIDGE}/replies.jsonl'
PROPOSALS = f'{BRIDGE}/proposals.jsonl'
TASKS     = f'{BRIDGE}/tasks.jsonl'
TRANSCRIPT = f'{BRIDGE}/transcript-tail.jsonl'
BRAIN_HISTORY = f'{BRIDGE}/brain-chat-history.jsonl'
BRAIN_BACKUPS = f'{BRIDGE}/brain-edit-backups'
REVISIONS     = f'{ROOT}/producer-brain/revisions.jsonl'
TRANSCRIPT_CAP = 60
CC_SESSION_DIR = os.environ.get('CC_SESSION_DIR') or os.path.expanduser('~/.claude/projects/-Users-bowei')
PRESET_COMMANDS = [
    {'id':'recheck-latest', 'label':'Re-analyze 最近 5 条', 'tag':'analyze-recent', 'body':'分析 corpus 最近 5 条 piece：每条挑 1 个最强 musical move + 1 个弱点；建议是否值得提 spine 候选。'},
    {'id':'spine-scan',     'label':'扫近期 negative 找 spine 候选', 'tag':'spine-scan', 'body':'看 score < 6 的最近 N 条 piece，找出可能重复的失败模式，提 1–3 个 spine candidate。'},
    {'id':'diff-strongest', 'label':'Diff 最高分 vs 最低分', 'tag':'diff', 'body':'找 corpus 内 score 最高 vs 最低 piece，对比 code，归因到 guideline 段落。'},
    {'id':'guideline-audit','label':'Guideline 健康审计', 'tag':'audit', 'body':'读当前 PROMPT_BASE，逐段检查：是否仍 supported by spine VALIDATED entries / 是否被最近 corpus 证伪 / 有没有 dead lines。'},
]

# ---- ranged file helper ---------------------------------------------------
class _RangedFile:
    def __init__(self, f, length):
        self.f, self.remaining = f, length
    def read(self, n=-1):
        if self.remaining <= 0: return b''
        n = self.remaining if n == -1 else min(n, self.remaining)
        chunk = self.f.read(n)
        self.remaining -= len(chunk)
        return chunk
    def close(self): self.f.close()

# ---- main handler ---------------------------------------------------------
class H(http.server.SimpleHTTPRequestHandler):
    """Static + Range + a few JSON/SSE API routes."""

    # quiet down access log (still print errors)
    def log_message(self, fmt, *args):
        if 'POST' in fmt or 'error' in fmt.lower() or args and isinstance(args[1], str) and args[1] not in ('200','206','304'):
            super().log_message(fmt, *args)

    # ---- helpers ----------------------------------------------------------
    def _atomic_write_text(self, path, content):
        """Crash-safe text write: tmp + os.replace. Use for any file where
        a half-written truncation would be catastrophic (manifest, jsonl,
        config, etc.). Single-line files / tmp scratch use plain open() fine."""
        tmp = f'{path}.tmp.{os.getpid()}.{int(time.time() * 1000)}'
        try:
            with open(tmp, 'w') as f:
                f.write(content)
            os.replace(tmp, path)
            self._invalidate_jsonl_cache(path)
        except Exception:
            try: os.remove(tmp)
            except Exception: pass
            raise

    def _invalidate_jsonl_cache(self, path):
        with _jsonl_cache_lock:
            for key in [k for k in _jsonl_cache if k[0] == path]:
                _jsonl_cache.pop(key, None)

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def _safe_download_stem(name):
        safe = re.sub(r'[^A-Za-z0-9._-]+', '_', str(name or 'export')).strip('._-')
        return (safe or 'export')[:80]

    def _read_body(self):
        length = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(length) if length else b''

    def _json_body(self):
        """Parse the request JSON body. Returns {} on empty OR malformed input
        so handlers surface a clean field-validation 400 ('X required') instead
        of a 500 with a raw Python parse error. (2026-05-29.)"""
        try:
            return json.loads(self._read_body() or b'{}')
        except Exception:
            return {}

    def _open_sse(self):
        """Open an SSE response; return an emit(event, data) closure, or None if
        the client is already gone. Dedups the identical SSE setup across the
        generate handlers. emit silently no-ops once the socket breaks."""
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()
        except Exception:
            return None
        alive = [True]
        def emit(event, data):
            if not alive[0]: return
            try:
                self.wfile.write(f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'.encode('utf-8'))
                self.wfile.flush()
            except Exception:
                alive[0] = False
        emit.alive = alive
        return emit

    # ---- redirect bare / to main.html ------------------------------------
    def do_GET(self):
        if self.path in ('', '/', '/index.html'):
            self.send_response(HTTPStatus.FOUND)
            self.send_header('Location', '/runtime/main.html')
            self.end_headers()
            return
        if self.path.startswith('/api/'):
            return self._dispatch_get()
        # main.html gets a build-stamp injected so the page can self-detect
        # "I'm a cached old version" without needing me to hand-bump constants.
        if self.path.split('?')[0] == '/runtime/main.html':
            return self._serve_templated_html(f'{ROOT}/runtime/main.html')
        return super().do_GET()

    def _serve_templated_html(self, path):
        try:
            import datetime
            with open(path, 'rb') as f:
                html = f.read().decode('utf-8')
            build_ts = datetime.datetime.fromtimestamp(os.path.getmtime(path)).strftime('%Y-%m-%d_%H:%M:%S')
            html = html.replace('__PAGE_BUILD__', build_ts)
            body = html.encode('utf-8')
            self.send_response(HTTPStatus.OK)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(e))

    def do_POST(self):
        if self.path.startswith('/api/'):
            return self._dispatch_post()
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def do_PUT(self):
        if self.path.startswith('/api/'):
            return self._dispatch_put()
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def do_DELETE(self):
        if self.path.startswith('/api/'):
            return self._dispatch_delete()
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    # ---- API dispatch -----------------------------------------------------
    def _dispatch_get(self):
        p = urllib.parse.urlparse(self.path)
        if p.path == '/api/recent':      return self._api_recent(p)
        if p.path == '/api/archive':     return self._api_archive(p)
        if p.path == '/api/genre-codes': return self._api_genre_codes()
        if p.path == '/api/revisions':   return self._api_revisions(p)
        if p.path == '/api/gen-status':  return self._api_gen_status()
        if p.path == '/api/version':     return self._api_version()
        if p.path == '/api/piece':       return self._api_piece(p)
        # cc-bridge reads
        if p.path == '/api/cc/state':    return self._api_cc_state()        # one-call dump of all 5
        if p.path == '/api/cc/presets':  return self._json(200, {'presets': PRESET_COMMANDS})
        if p.path == '/api/cc/stream':   return self._api_cc_stream()       # SSE long-poll
        if p.path == '/api/kernel/fragments': return self._api_kernel_list()
        if p.path == '/api/kernel/fragment':  return self._api_kernel_get(p)
        if p.path == '/api/backends':    return self._api_backends()
        if p.path == '/api/settings':    return self._api_settings_get()
        if p.path == '/api/setup-status': return self._api_setup_status()
        if p.path == '/api/source-offer': return self._api_source_offer()
        self.send_error(HTTPStatus.NOT_FOUND)

    def _api_source_offer(self):
        self._json(200, self._source_offer_payload())

    @staticmethod
    def _source_offer_payload():
        bundle = '/tmp/cactus-strudel-bundle.tar.gz'
        return {
            'license': 'AGPL-3.0-or-later',
            'agpl_section_13': True,
            'repo_root': ROOT,
            'source_bundle': bundle if os.path.exists(bundle) else None,
            'source_bundle_sha256': H._file_sha256(bundle) if os.path.exists(bundle) else None,
            'notice': (
                'CactusStrudel includes AGPL Strudel/Essentia components. '
                'Anyone providing network access to this runtime must provide '
                'the complete corresponding source for this deployed version. '
                'On Bowei machines the live checkout is repo_root; packaged '
                'handoff builds are distributed as cactus-strudel-bundle.tar.gz.'
            ),
        }

    @staticmethod
    def _file_sha256(path):
        try:
            import hashlib
            h = hashlib.sha256()
            with open(path, 'rb') as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b''):
                    h.update(chunk)
            return h.hexdigest()
        except Exception:
            return None

    def _dispatch_post(self):
        if self.path == '/api/generate':          return self._api_generate()
        if self.path == '/api/score':             return self._api_score()
        if self.path == '/api/save-piece':        return self._api_save_piece()
        if self.path == '/api/update-piece-code': return self._api_update_piece_code()
        if self.path == '/api/midi':              return self._api_midi()
        if self.path == '/api/render':            return self._api_render()
        if self.path == '/api/generate/cancel':   return self._api_generate_cancel()
        if self.path == '/api/rename-piece':      return self._api_rename_piece()
        # cc-bridge writes
        if self.path == '/api/cc/inbox':           return self._api_cc_inbox_post()
        if self.path == '/api/brain-chat':         return self._api_brain_chat()
        if self.path == '/api/cc/proposal-action': return self._api_cc_proposal_action()
        if self.path == '/api/cc/task-action':     return self._api_cc_task_action()
        if self.path == '/api/cc/kick':            return self._api_cc_kick()
        if self.path == '/api/piece/archive':      return self._api_piece_archive()
        if self.path == '/api/settings/test-backend': return self._api_settings_test()
        self.send_error(HTTPStatus.NOT_FOUND)

    def _dispatch_put(self):
        if self.path == '/api/kernel/fragment': return self._api_kernel_put()
        if self.path == '/api/piece/note':      return self._api_piece_note()
        if self.path == '/api/settings':        return self._api_settings_put()
        self.send_error(HTTPStatus.NOT_FOUND)

    def _dispatch_delete(self):
        if self.path == '/api/piece': return self._api_piece_delete()
        self.send_error(HTTPStatus.NOT_FOUND)

    # ---- API: recent N pieces (corpus tail) ------------------------------
    def _api_recent(self, p):
        try:
            qs = urllib.parse.parse_qs(p.query)
            n = int((qs.get('n') or ['20'])[0])
            with open(MANIFEST) as f:
                lines = [l for l in f if l.strip()]
            items = [json.loads(l) for l in lines[-n:]]
            self._json(200, {'items': items, 'total': len(lines)})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: archive-v0 (legacy 104 pieces, not counted toward active) ──
    def _api_archive(self, p):
        try:
            qs = urllib.parse.parse_qs(p.query)
            n = int((qs.get('n') or ['200'])[0])
            items = []
            if os.path.exists(ARCHIVE_INDEX):
                with open(ARCHIVE_INDEX) as f:
                    lines = [l for l in f if l.strip()]
                items = [json.loads(l) for l in lines[-n:]]
            self._json(200, {'items': items, 'total': len(items), 'source': 'archive-v0'})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: genre code registry (the single source of truth) ────────────
    def _api_genre_codes(self):
        try:
            reg = self._read_genre_codes() or {}
            self._json(200, reg)
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: revisions (research database) ------------------------------
    # /api/revisions?piece=X&n=N      → latest N revisions for piece X
    # /api/revisions?n=N              → latest N across all pieces
    # /api/revisions?piece=X&id=rev-… → single revision (with full diff text)
    def _api_revisions(self, p):
        try:
            qs = urllib.parse.parse_qs(p.query)
            piece = (qs.get('piece') or [None])[0]
            rid   = (qs.get('id') or [None])[0]
            n     = int((qs.get('n') or ['30'])[0])
            include_diff = (qs.get('diff') or ['0'])[0] in ('1', 'true')
            rows = self._read_jsonl(REVISIONS) if os.path.exists(REVISIONS) else []
            if piece:
                rows = [r for r in rows if r.get('piece') == piece]
            if rid:
                rows = [r for r in rows if r.get('id') == rid]
                include_diff = True
            rows = rows[-n:]
            # optionally attach diff text from backup_dir
            if include_diff:
                for r in rows:
                    bdir = r.get('backup_dir')
                    if bdir:
                        diff_path = os.path.join(ROOT, bdir, 'diff.txt') if not bdir.startswith('/') else os.path.join(bdir, 'diff.txt')
                        if os.path.exists(diff_path):
                            try: r['diff_text'] = open(diff_path).read()
                            except Exception: pass
            self._json(200, {'items': rows, 'total_in_view': len(rows),
                             'total_db': sum(1 for _ in open(REVISIONS)) if os.path.exists(REVISIONS) else 0})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: single piece by name -> {entry, code} ----------------------
    def _api_piece(self, p):
        qs = urllib.parse.parse_qs(p.query)
        name = (qs.get('name') or [''])[0]
        if not name: return self._json(400, {'error': 'name required'})
        try:
            entry = None
            # Check active corpus first, then archive (so archive pieces still playable)
            for jsonl_path in (MANIFEST, ARCHIVE_INDEX):
                if not os.path.exists(jsonl_path): continue
                with open(jsonl_path) as f:
                    for line in f:
                        if not line.strip(): continue
                        d = json.loads(line)
                        if d.get('name') == name:
                            entry = d
                            entry['_source'] = 'archive-v0' if jsonl_path == ARCHIVE_INDEX else 'active'
                            break
                if entry: break
            if not entry: return self._json(404, {'error': 'not found'})
            code = ''
            if entry.get('js'):
                js_path = os.path.join(ROOT, entry['js']) if not entry['js'].startswith('/') else entry['js']
                if os.path.exists(js_path):
                    code = open(js_path).read()
            self._json(200, {'entry': entry, 'code': code})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: score (append patch to corpus entry) -----------------------
    def _api_score(self):
        try:
            body = self._json_body()
            name = body.get('name'); score = body.get('score'); note = body.get('note', '')
            if not name or score is None:
                return self._json(400, {'error': 'name + score required'})
            try:
                score_value = float(score)
            except (TypeError, ValueError):
                return self._json(400, {'error': 'score must be a finite number from 0 to 10'})
            if not math.isfinite(score_value) or score_value < 0 or score_value > 10:
                return self._json(400, {'error': 'score must be a finite number from 0 to 10'})
            with _manifest_lock:
                rows = self._manifest_entries()
                updated = False
                for d in rows:
                    if d.get('name') == name:
                        d['score_bowei'] = score_value
                        if note: d['note_bowei'] = note
                        updated = True
                if not updated: return self._json(404, {'error': 'name not found'})
                self._write_manifest_entries(rows)
            # Backfill latest open revision for this piece with the new score.
            # If no open revision exists, no-op (a pure rescore has nothing to
            # attribute the delta to — that's the design).
            rev_updated = self._backfill_revision_score(name, score_value)
            self._json(200, {'ok': True, 'name': name, 'score': score_value,
                             'revision_score_filled': rev_updated})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: rename piece (rename files on disk and update manifest) ----
    def _api_rename_piece(self):
        try:
            body = self._json_body()
            old_name = body.get('old_name')
            new_name_raw = body.get('new_name')
            if not old_name or not new_name_raw:
                return self._json(400, {'error': 'old_name and new_name required'})
            
            with _manifest_lock:
                rows = self._manifest_entries()
                target_entry = next((d for d in rows if d.get('name') == old_name), None)
                if not target_entry:
                    return self._json(404, {'error': f'Piece {old_name} not found'})

                idx = target_entry.get('i')
                clean_name = re.sub(r'^(0*' + re.escape(str(idx)) + r'[-\s_]*)', '', new_name_raw.strip())
                clean_name = re.sub(r'[^\w\-\s]', '', clean_name).strip().replace(' ', '_')
                if not clean_name:
                    return self._json(400, {'error': 'Invalid new name'})
                final_name = f"{idx:03d}-{clean_name}"

                old_js_rel = target_entry.get('js')
                old_mp3_rel = target_entry.get('mp3')
                old_prompt_rel = target_entry.get('prompt')
                new_js_rel = f"producer-brain/pieces/{final_name}.js"
                new_mp3_rel = f"producer-brain/audio/{final_name}.mp3"
                new_prompt_rel = f"producer-brain/prompts/{final_name}.txt"

                renamed_count = 0
                for old_rel, new_rel in [
                    (old_js_rel, new_js_rel),
                    (old_mp3_rel, new_mp3_rel),
                    (old_prompt_rel, new_prompt_rel)
                ]:
                    if old_rel and old_rel.strip():
                        old_abs = os.path.join(ROOT, old_rel)
                        new_abs = os.path.join(ROOT, new_rel)
                        if os.path.exists(old_abs):
                            os.makedirs(os.path.dirname(new_abs), exist_ok=True)
                            os.rename(old_abs, new_abs)
                            renamed_count += 1

                target_entry['name'] = final_name
                target_entry['js'] = new_js_rel
                if old_mp3_rel and old_mp3_rel.strip():
                    target_entry['mp3'] = new_mp3_rel
                if old_prompt_rel and old_prompt_rel.strip():
                    target_entry['prompt'] = new_prompt_rel
                self._write_manifest_entries(rows)

            self._json(200, {'ok': True, 'name': final_name, 'renamed_files': renamed_count})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: PUT note on a piece ----------------------------------------
    # Body: {name, note}. Updates note_bowei + note_ts on the corpus entry.
    # Atomic manifest rewrite.
    def _api_piece_note(self):
        try:
            body = self._json_body()
            name = body.get('name')
            note = body.get('note', '')
            if not name: return self._json(400, {'error': 'name required'})
            with _manifest_lock:
                rows = self._manifest_entries()
                target = None
                for r in rows:
                    if r.get('name') == name:
                        r['note_bowei'] = note
                        r['note_ts'] = time.strftime('%Y-%m-%d %H:%M:%S')
                        target = r
                        break
                if not target: return self._json(404, {'error': 'piece not found'})
                self._write_manifest_entries(rows)
            self._json(200, {'ok': True, 'name': name, 'note_ts': target['note_ts']})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: archive a piece (soft-delete: keep in corpus, mark archived) -
    # Body: {name}. Sets archived_at timestamp. Filtered out of default view.
    def _api_piece_archive(self):
        try:
            body = self._json_body()
            name = body.get('name')
            if not name: return self._json(400, {'error': 'name required'})
            with _manifest_lock:
                rows = self._manifest_entries()
                target = None
                for r in rows:
                    if r.get('name') == name:
                        r['archived_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                        target = r
                        break
                if not target: return self._json(404, {'error': 'piece not found'})
                self._write_manifest_entries(rows)
            self._json(200, {'ok': True, 'name': name, 'archived_at': target['archived_at']})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: permanently delete a piece ---------------------------------
    # Body: {name}. Removes corpus entry + .js + .mp3 + .txt + .json files.
    # No undo. Caller must confirm twice (UI responsibility).
    def _api_piece_delete(self):
        try:
            body = self._json_body()
            name = body.get('name')
            confirm = body.get('confirm', '')
            if not name: return self._json(400, {'error': 'name required'})
            if confirm != name:
                return self._json(400, {'error': f'confirm token must equal name; got {confirm!r}'})
            with _manifest_lock:
                rows = self._manifest_entries()
                target = None
                kept = []
                for r in rows:
                    if r.get('name') == name and not target:
                        target = r
                    else:
                        kept.append(r)
                if not target: return self._json(404, {'error': 'piece not found'})
                # Remove from manifest first (atomic rewrite)
                self._write_manifest_entries(kept)
            # Then delete files (best-effort; manifest already corrected)
            removed = []
            for key in ('js', 'mp3', 'prompt', 'prompt_json'):
                rel = target.get(key)
                if not rel: continue
                abs_path = os.path.join(ROOT, rel) if not rel.startswith('/') else rel
                if os.path.exists(abs_path):
                    try:
                        os.remove(abs_path)
                        removed.append(rel)
                    except Exception as e:
                        print(f'[piece-delete] failed to remove {rel}: {e}')
            self._json(200, {'ok': True, 'name': name, 'removed_files': removed})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: save edited code as a new piece (renders mp3 via auto-render)
    def _api_save_piece(self):
        try:
            body = self._json_body()
            code = body.get('code')
            if not code: return self._json(400, {'error': 'code required'})
            ts_ms = int(time.time() * 1000)
            fname = f'gemini_edit_{ts_ms}.js'
            js_abs = os.path.join(PIECES, fname)
            os.makedirs(PIECES, exist_ok=True); os.makedirs(AUDIO, exist_ok=True)
            open(js_abs, 'w').write(code)
            # Edit-saves are unscoped (no preset envelope); land in UN-NNN.
            with _manifest_lock:
                piece_name = body.get('name') or self._next_genre_name('UN')
                entry = self._build_corpus_entry(
                    name=piece_name,
                    js_rel=f'producer-brain/pieces/{fname}',
                    mp3_rel=f'producer-brain/audio/{fname.replace(".js", ".mp3")}',
                    extra_tag='(edited in main UI)',
                    source='manual-edit',
                )
                self._append_manifest_entry(entry)
            mp3_abs = self._mp3_path_for(js_abs)
            # render via auto-render in background; respond fast. On failure,
            # mark the entry (don't leave a silent dead audio link).
            def render():
                err = None
                try:
                    r = self._run_render_subprocess(js_abs)
                    if r.returncode != 0 or not os.path.exists(mp3_abs):
                        err = (r.stderr or '')[-300:] or f'exit {r.returncode}, no mp3'
                    else:
                        sha, dur = self._probe_mp3(mp3_abs)
                        features_abs = self._features_path_for(js_abs)
                        features_rel, audio_features = self._features_payload_for(features_abs)
                        with _manifest_lock:
                            rows = self._manifest_entries()
                            for row in rows:
                                if row.get('name') == piece_name:
                                    row['sha'] = sha
                                    row['dur'] = dur
                                    row['mp3'] = mp3_abs.replace(ROOT + '/', '')
                                    row['features'] = features_rel
                                    row['audio_features'] = audio_features
                                    row['render_error'] = None
                            self._write_manifest_entries(rows)
                except Exception as e:
                    err = str(e)[:300]
                if err:
                    print(f'[save-piece render] {piece_name} failed: {err}', flush=True)
                    self._mark_entry_field(piece_name, 'render_error', err)
            threading.Thread(target=render, daemon=True).start()
            self._json(200, {'ok': True, 'entry': entry, 'rendering': True})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: overwrite current piece code, backup, render, update manifest
    def _api_update_piece_code(self):
        try:
            body = self._json_body()
            name = body.get('name')
            code = body.get('code')
            # Optional caller-supplied intent (e.g., web UI knows the brain
            # suggested the edit + has the source message). Falls back to
            # source='manual-edit' with null intent fields.
            intent_in = body.get('intent') if isinstance(body.get('intent'), dict) else None
            source_in = body.get('source') or 'manual-edit'
            if not name: return self._json(400, {'error': 'name required'})
            if not code or not str(code).strip(): return self._json(400, {'error': 'code required'})

            entry, rows = self._find_piece_entry(name)
            if not entry: return self._json(404, {'error': 'piece not found'})
            entry_before = dict(entry)  # snapshot for revision record
            js_rel = entry.get('js')
            if not js_rel: return self._json(400, {'error': 'piece has no js path'})
            js_abs = os.path.join(ROOT, js_rel) if not js_rel.startswith('/') else js_rel
            if not os.path.exists(js_abs): return self._json(404, {'error': 'js not found'})

            with open(js_abs, encoding='utf-8') as f:
                old_code = f.read()
            backup = self._backup_piece_for_brain_edit(entry, 'manual Save+Render from code editor')
            mp3_abs = self._mp3_path_for(js_abs)
            features_abs = self._features_path_for(js_abs)
            staging_root = os.path.join(ROOT, 'producer-brain', '.staging')
            os.makedirs(staging_root, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='legacy-edit-', dir=staging_root) as stage_dir:
                staged_js = os.path.join(stage_dir, 'piece.js')
                with open(staged_js, 'w', encoding='utf-8') as f:
                    f.write(code)
                render = self._run_render_subprocess(staged_js, timeout=600)
                staged_mp3 = os.path.join(stage_dir, 'piece.mp3')
                staged_features = os.path.join(stage_dir, 'piece.features.json')
                if render.returncode != 0 or not os.path.isfile(staged_mp3) or os.path.getsize(staged_mp3) <= 0:
                    return self._json(500, {
                        'error': 'render failed; current code and audio left unchanged',
                        'backup': backup.replace(ROOT + '/', ''),
                        'stdout': (render.stdout or '')[-2000:],
                        'stderr': (render.stderr or '')[-2000:],
                    })
                sha, dur = self._probe_mp3(staged_mp3)
                try:
                    duration_ok = bool(sha) and math.isfinite(float(dur)) and float(dur) > 0
                except (TypeError, ValueError):
                    duration_ok = False
                if not duration_ok:
                    return self._json(500, {
                        'error': 'render output failed SHA/duration readback; current code and audio left unchanged',
                        'backup': backup.replace(ROOT + '/', ''),
                    })
                os.makedirs(os.path.dirname(mp3_abs), exist_ok=True)
                if os.path.isfile(staged_features):
                    os.makedirs(os.path.dirname(features_abs), exist_ok=True)
                    os.replace(staged_features, features_abs)
                os.replace(staged_mp3, mp3_abs)
                os.replace(staged_js, js_abs)

            features_rel, audio_features = self._features_payload_for(features_abs)
            # Re-read fresh under lock — `rows` above predates the long render,
            # during which background gens may have appended new pieces.
            with _manifest_lock:
                rows = self._manifest_entries()
                for row in rows:
                    if row.get('name') == name:
                        row['sha'] = sha
                        row['dur'] = dur
                        row['mp3'] = mp3_abs.replace(ROOT + '/', '')
                        row['features'] = features_rel
                        row['audio_features'] = audio_features
                        row['render_error'] = None
                        row['manual_last_save'] = {
                            'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
                            'backup': backup.replace(ROOT + '/', ''),
                        }
                self._write_manifest_entries(rows)
            updated_entry, _ = self._find_piece_entry(name)
            rev = self._record_revision(
                piece_name=name,
                entry_before=entry_before,
                entry_after=updated_entry or entry,
                code_before=old_code,
                code_after=code,
                backup_dir=backup,
                source=source_in,
                intent=intent_in or {
                    'kind': None, 'target': None, 'params': None,
                    'brain_reply_id': None,
                    'natural_lang_request': body.get('intent_text'),
                },
            )
            self._json(200, {
                'ok': True,
                'entry': updated_entry or entry,
                'backup': backup.replace(ROOT + '/', ''),
                'revision': rev,
                'stdout': render.stdout[-2000:],
                'stderr': render.stderr[-2000:],
            })
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: render a given .js (returns mp3 path when done) ------------
    def _api_render(self):
        try:
            body = self._json_body()
            js_path = body.get('js')
            if not js_path: return self._json(400, {'error': 'js path required'})
            js_abs = os.path.join(ROOT, js_path) if not js_path.startswith('/') else js_path
            if not os.path.isfile(js_abs):
                return self._json(404, {'error': 'js file not found'})

            # Render into same-filesystem staging. A stale existing MP3 can no
            # longer make a failed render look successful, and the current
            # asset remains untouched until exit/duration/SHA all pass.
            staging_root = os.path.join(ROOT, 'producer-brain', '.staging')
            os.makedirs(staging_root, exist_ok=True)
            target_mp3 = self._mp3_path_for(js_abs)
            target_features = self._features_path_for(js_abs)
            with tempfile.TemporaryDirectory(prefix='legacy-render-', dir=staging_root) as stage_dir:
                staged_js = os.path.join(stage_dir, 'piece.js')
                copy2(js_abs, staged_js)
                p = self._run_render_subprocess(staged_js, timeout=600)
                staged_mp3 = os.path.join(stage_dir, 'piece.mp3')
                staged_features = os.path.join(stage_dir, 'piece.features.json')
                if p.returncode != 0 or not os.path.isfile(staged_mp3) or os.path.getsize(staged_mp3) <= 0:
                    return self._json(500, {
                        'error': f'render failed; current audio left unchanged (exit {p.returncode})',
                        'stdout': (p.stdout or '')[-2000:],
                        'stderr': (p.stderr or '')[-2000:],
                    })
                sha, dur = self._probe_mp3(staged_mp3)
                try:
                    duration_ok = math.isfinite(float(dur)) and float(dur) > 0
                except (TypeError, ValueError):
                    duration_ok = False
                if not sha or not duration_ok:
                    return self._json(500, {
                        'error': 'render output failed SHA/duration readback; current audio left unchanged',
                        'stdout': (p.stdout or '')[-2000:],
                        'stderr': (p.stderr or '')[-2000:],
                    })
                os.makedirs(os.path.dirname(target_mp3), exist_ok=True)
                if os.path.isfile(staged_features):
                    os.makedirs(os.path.dirname(target_features), exist_ok=True)
                    os.replace(staged_features, target_features)
                os.replace(staged_mp3, target_mp3)

            mp3_rel = target_mp3.replace(ROOT + '/', '')
            features_rel, audio_features = self._features_payload_for(target_features)
            with _manifest_lock:
                rows = self._manifest_entries()
                changed = False
                for row in rows:
                    row_js = row.get('js') or ''
                    row_abs = os.path.join(ROOT, row_js) if row_js and not row_js.startswith('/') else row_js
                    if row_abs == js_abs:
                        row.update({
                            'mp3': mp3_rel,
                            'sha': sha,
                            'dur': dur,
                            'features': features_rel,
                            'audio_features': audio_features,
                            'render_error': None,
                        })
                        changed = True
                if changed:
                    self._write_manifest_entries(rows)
            self._json(200, {
                'ok': True,
                'mp3': mp3_rel,
                'sha': sha,
                'duration': float(dur),
                'manifest_updated': changed,
                'stdout': (p.stdout or '')[-2000:],
                'stderr': (p.stderr or '')[-2000:],
            })
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- API: backends (UI dropdown source of truth) ---------------------
    def _api_backends(self):
        slots = []
        for k in BACKEND_SLOTS:
            if k not in BACKEND_REGISTRY: continue
            info = BACKEND_REGISTRY[k]
            route = self._resolve_slot_route(k)
            slots.append({
                'key': k,
                'label': info['label'],
                'vendor': info['vendor'],
                'available': route['mode'] is not None,
                'mode': route['mode'],
                'reason': route['reason'],
            })
        self._json(200, {'slots': slots})

    # ---- API: settings -------------------------------------------------
    def _api_settings_get(self):
        cfg = user_config.load()
        self._json(200, {
            'config': user_config.mask_secrets(cfg),
            'defaults': user_config.mask_secrets(user_config.DEFAULTS),
            'vendors': list(user_config.VENDORS),
        })

    def _api_settings_put(self):
        try:
            body = self._json_body()
            submitted = body.get('config') or {}
            current = user_config.load()
            # Unmask: keep existing keys when UI sent the bullet placeholder
            unmasked = user_config.unmask_save(submitted, current)
            new_cfg = user_config.update(unmasked)
            self._json(200, {
                'ok': True,
                'config': user_config.mask_secrets(new_cfg),
            })
        except Exception as e:
            self._json(500, {'error': str(e)})

    def _api_settings_test(self):
        """Test connectivity of one backend section.
        Body: {"target": "cliproxy" | "agy" | <vendor>,
               "inline": {api_key, base_url, bin_path}  // optional unsaved-form override}
        Returns: {ok, detail, latency_ms}."""
        try:
            body = self._json_body()
            target = (body.get('target') or '').strip()
            inline = body.get('inline') or {}
            if not target: return self._json(400, {'error': 'target required'})
            t0 = time.time()
            if target == 'cliproxy':
                base = (inline.get('base_url') or '').strip() or self._cliproxy_base_url()
                base = base.rstrip('/')
                key  = inline.get('api_key') or self._cliproxy_api_key()
                if not key:
                    return self._json(200, {'ok': False, 'detail': 'no API key configured'})
                try:
                    req = urllib.request.Request(
                        f'{base}/models',
                        headers={'Authorization': f'Bearer {key}'},
                    )
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        data = json.loads(resp.read().decode('utf-8'))
                    n = len(data.get('data') or data.get('models') or [])
                    return self._json(200, {'ok': True, 'detail': f'{n} models', 'latency_ms': int((time.time()-t0)*1000)})
                except Exception as e:
                    return self._json(200, {'ok': False, 'detail': str(e)[:200]})
            if target == 'agy':
                agy = (inline.get('bin_path') or '').strip()
                agy = os.path.expanduser(agy) if agy else self._agy_bin_path()
                if not os.path.exists(agy):
                    return self._json(200, {'ok': False, 'detail': f'not found at {agy}'})
                try:
                    r = subprocess.run([agy, '--version'], capture_output=True, text=True, timeout=5)
                    return self._json(200, {'ok': True, 'detail': (r.stdout + r.stderr).strip()[:120], 'latency_ms': int((time.time()-t0)*1000)})
                except Exception as e:
                    return self._json(200, {'ok': False, 'detail': str(e)[:200]})
            if target in user_config.VENDORS:
                vendor = target
                key  = inline.get('api_key')  or self._vendor_key(vendor)
                base = (inline.get('base_url') or '').strip() or self._vendor_base_url(vendor)
                base = base.rstrip('/')
                if not key:
                    return self._json(200, {'ok': False, 'detail': 'no API key set'})
                try:
                    if vendor == 'openai' or vendor == 'xai':
                        req = urllib.request.Request(
                            f'{base}/models',
                            headers={'Authorization': f'Bearer {key}'},
                        )
                        with urllib.request.urlopen(req, timeout=8) as resp:
                            data = json.loads(resp.read().decode('utf-8'))
                        n = len(data.get('data') or [])
                        return self._json(200, {'ok': True, 'detail': f'{n} models', 'latency_ms': int((time.time()-t0)*1000)})
                    if vendor == 'anthropic':
                        req = urllib.request.Request(
                            f'{base}/v1/models',
                            headers={'x-api-key': key, 'anthropic-version': '2023-06-01'},
                        )
                        with urllib.request.urlopen(req, timeout=8) as resp:
                            data = json.loads(resp.read().decode('utf-8'))
                        n = len(data.get('data') or [])
                        return self._json(200, {'ok': True, 'detail': f'{n} models', 'latency_ms': int((time.time()-t0)*1000)})
                    if vendor == 'google':
                        req = urllib.request.Request(
                            f'{base}/models?key={urllib.parse.quote(key)}',
                        )
                        with urllib.request.urlopen(req, timeout=8) as resp:
                            data = json.loads(resp.read().decode('utf-8'))
                        n = len(data.get('models') or [])
                        return self._json(200, {'ok': True, 'detail': f'{n} models', 'latency_ms': int((time.time()-t0)*1000)})
                except Exception as e:
                    return self._json(200, {'ok': False, 'detail': str(e)[:200]})
            return self._json(400, {'error': f'unknown target: {target!r}'})
        except Exception as e:
            self._json(500, {'error': str(e)})

    def _api_setup_status(self):
        """Tell main.html whether to show the 'set up backends' banner.
        needs_setup = no slot resolvable to any mode."""
        any_available = False
        unavailable = []
        for slot in BACKEND_SLOTS:
            route = self._resolve_slot_route(slot)
            if route['mode'] is not None:
                any_available = True
            else:
                unavailable.append({'slot': slot, 'label': BACKEND_REGISTRY[slot]['label'], 'reason': route['reason']})
        self._json(200, {
            'needs_setup': not any_available,
            'available_count': sum(1 for s in BACKEND_SLOTS if self._resolve_slot_route(s)['mode'] is not None),
            'total': len(BACKEND_SLOTS),
            'unavailable': unavailable,
        })

    # ---- API: generate (slot-based dispatcher) ---------------------------
    # Body: {"slot": "<slot-key>", "extra": "<prompt>"}
    # Slot keys live in BACKEND_REGISTRY. _resolve_slot_route picks cliproxy
    # vs direct vs agy based on current user_config. UI never sends mode.
    # SSE response with start / log / error / done events.
    def _api_generate(self):
        body = self._json_body()
        slot = body.get('slot') or 'agy-cli'
        extra = body.get('extra', '')
        info = BACKEND_REGISTRY.get(slot)
        if not info:
            return self._json(400, {'error': f'unknown slot: {slot!r} (see /api/backends)'})
        route = self._resolve_slot_route(slot)
        if route['mode'] == 'agy':
            return self._api_run_agy_cli(extra, slot=slot)
        if route['mode'] == 'cliproxy':
            return self._api_run_cliproxy(extra, slot=slot, model=route['model'])
        if route['mode'] == 'direct':
            return self._api_run_direct(extra, slot=slot, model=route['model'],
                                        base_url=route['base_url'], api_key=route['api_key'])
        return self._json(503, {'error': route['reason']})

    def _api_run_direct(self, extra, *, slot, model, base_url, api_key):
        """Direct-vendor-API generation. Dispatches by vendor since each has
        a different chat-completion shape (OpenAI compat / Anthropic /
        Google generative). Then runs the shared render+register pipeline."""
        # Open SSE
        emit = self._open_sse()
        if emit is None:
            return

        info = BACKEND_REGISTRY[slot]
        label = info['label']
        vendor = info['vendor']
        # gen-status registration (job_id lets the client cancel server-side)
        gen_job = self._new_gen_job(slot, extra)
        emit('start', {'model': label, 'extra': extra or '(none)', 'job_id': gen_job['job_id']})

        try:
            kernel = self._read_compiled_kernel()
            prompt_snapshot = (
                f'# slot: {slot} ({label})\n'
                f'# mode: direct ({vendor})\n# model: {model}\n'
                f'# kernel hash: {kernel["hash"]}\n\n{kernel["text"]}'
            )
            if extra: prompt_snapshot += f'\n\nPROMPT_EXTRA:\n{extra}'

            user_content = f"""You are the CactusStrudel generator.

Return exactly one fenced ```javascript code block containing a complete executable Strudel piece.
Do not explain. The final expression must evaluate to a Strudel Pattern. Include setcpm(.../4).

{kernel["text"]}

PROMPT_EXTRA:
{extra or '(none)'}
"""
            emit('log', {'line': f'▶ [{label}] direct → {vendor} {model}'})
            try:
                output = self._call_direct_vendor(vendor, base_url, api_key, model, user_content)
            except Exception as e:
                emit('error', {'error': f'{vendor} call failed: {e}'})
                emit('done', {'exit': 1})
                return

            try:
                code = self._extract_strudel_code(output)
            except RuntimeError as e:
                emit('error', {'error': str(e)})
                emit('log', {'line': output[:600]})
                emit('done', {'exit': 1})
                return

            emit('log', {'line': f'▶ [{label}] code extracted ({len(code)}c); rendering…'})
            entry = self._render_and_register(
                code=code, prompt_snapshot=prompt_snapshot,
                extra=extra, slot=slot, emit=emit, gen_job=gen_job,
            )
            emit('done', {'exit': 0 if entry else 1, 'entry': entry})
        finally:
            with _gen_jobs_lock:
                try: _gen_jobs.remove(gen_job)
                except ValueError: pass

    # Validator prompts — AUTO-FIX semantics (Bowei pref 2026-05-29):
    # The reviewer UNDERSTANDS the AI's compositional intent, then patches
    # runtime issues in place (wrong bank names, unknown samples, missing
    # setcpm, $-prefixed vars, etc.) rather than just rejecting. Output is:
    #   VERDICT: VALID                             (code is fine as-is)
    #   VERDICT: FIXED\n```javascript\n<corrected>\n```   (fixes applied)
    #   VERDICT: BAD: <reason>                     (truly broken, no rescue)
    VALIDATOR_AUTOFIX_HEAD = """You are a Strudel code reviewer AND auto-corrector.

Your contract: understand the author's MUSICAL INTENT, then make sure the code
will (1) parse, (2) evaluate to a Pattern, (3) make all intended sounds play.
If you spot issues that would prevent playback, FIX them in place — preserving
the compositional intent — rather than rejecting the code.

KNOWN AUTO-FIXES (apply these silently when you see them):
- `bank("LinnDrum")` → `bank("AkaiLinn")`   (LinnDrum is not a Strudel bank; AkaiLinn is the closest)
- `bank("X")` where X is not a real Strudel bank → DROP the .bank() call (default dirt-samples will be used)
- `s("invented_name")` (e.g. "electric_drum", "warm_pad", "trap_kick") → substitute closest real sample (sd / hh / cp / piano / bass / etc.)
- `note(...).s("nonexistent_synth")` → swap to a known synth: sawtooth / sine / square / triangle / supersaw / gm_epiano1 / gm_pad_warm
- Missing `setcpm(.../4)` or `setcps(...)` → prepend `setcpm(120/4);` (or genre-appropriate BPM)
- `$drums = stack(...)` (REPL `$`-prefix) → `const drums = stack(...)` (declaration)
- `.lpf(0)` / `.gain(0)` at top level → use sensible value (`.lpf(800)` / `.gain(0.8)`)
- `.vib(N)` with single arg → `.vib("4 0.1")` (rate depth)
- Unbalanced parens/brackets/quotes → try to balance based on intent
- Top-level isn't a Pattern → wrap in `stack(...)` if you can infer the layers

DO NOT:
- Comment on musical/aesthetic choices (don't say "the chord progression is generic")
- Rewrite for taste — only patch what's broken
- Add features the author didn't include
- Change BPM or key unless they're entirely missing

REPLY FORMAT — output EXACTLY one of the three forms below, NOTHING else after:

VERDICT: VALID

OR

VERDICT: FIXED
```javascript
<the COMPLETE corrected code, ready to render>
```

OR

VERDICT: BAD: <one-line reason — only when truly unsalvageable>

"""

    VALIDATOR_PROMPT_LIGHT = VALIDATOR_AUTOFIX_HEAD + """SCOPE: one comprehensive pass — check parse + samples + playability all at once.

Strudel knowledge to apply:
- Mini-notation: "bd sd ~ cp" — events per cycle. ~ = rest. * = repeat. <a b> = pick one per cycle. [a b] = subdivide. {a b} = polymeter.
- Common samples (dirt-samples bank): bd, sd, hh, cp, cr, oh, mt, ht, lt, rim, sh, cl, cb, perc, fx — also numbered variants like bd:5, hh:3.
- Common synth names: sawtooth, sine, square, triangle, white, pink, brown, supersaw, fm, gm_* (GeneralMIDI) like gm_epiano1, gm_pad_warm, gm_strings.
- Banks via `bank("X")`: RolandTR909, RolandTR808, RolandTR707, AkaiLinn, dirt-samples (default).
- Tempo MUST be set: `setcpm(N/4)` for BPM-style, or `setcps(N)` for cps.
- Variables: `const name = ...` then reference. NEVER `$name = ...` — `$`-prefix is REPL-only.
- Common effects: .gain, .lpf, .lpq, .hpf, .room, .delay, .delaytime, .delayfeedback, .pan, .shape, .distort, .speed, .attack, .decay, .sustain, .release, .vib("rate depth").

After thinking through the code, output ONE of the three VERDICT forms above."""

    VALIDATOR_PROMPT_PARSE = VALIDATOR_AUTOFIX_HEAD + """SCOPE: parse + structure check only. (Sample names + playability are separate passes.)

Strict checks (FIX if issue found):
1. Balanced (), [], {}, "", '', `` — try to balance if not
2. setcpm(...) OR setcps(...) at top level — add `setcpm(120/4);` if missing
3. Top-level expression evaluates to a Pattern — wrap in stack() if necessary
4. `$varname = ...` REPL syntax → rewrite as `const varname = ...`
5. Variable references match declarations
6. Function-call arity sensible
7. No top-level await / no Node-only APIs

After analysis, output ONE of: VERDICT: VALID / VERDICT: FIXED + ```javascript``` block / VERDICT: BAD: ..."""

    VALIDATOR_PROMPT_SAMPLES = VALIDATOR_AUTOFIX_HEAD + """SCOPE: sample + synth + bank name audit. Every name in `s("...")`, `.s("...")`, `bank("...")` must EXIST.

Reference set (the safest names):
- Drum samples (dirt-samples bank): bd, sd, hh, cp, cr, oh, mt, ht, lt, rim, sh, cl, cb, perc, fx, click, tabla, tom, kick, snare, hat, ride, crash. Numbered variants OK: `bd:5`, `hh:3`.
- Pitched samples: piano, casio, chin, bass, gtr, sax, brass1.
- Synth primitives: sawtooth, sine, square, triangle, white, pink, brown, supersaw, fm.
- GeneralMIDI synths via `gm_*`: gm_epiano1, gm_pad_warm, gm_strings, gm_brass, gm_lead, gm_organ, gm_choir, gm_flute, gm_violin.
- Banks: RolandTR909, RolandTR808, RolandTR707, RolandTR606, AkaiLinn, SerLinn, dirt-samples.

Walk through every string passed to s(...) / .s(...) / bank(...). FIX invented names by substituting the closest real name (or dropping bank() if the bank doesn't exist).

After analysis, output ONE of: VERDICT: VALID / VERDICT: FIXED + ```javascript``` block / VERDICT: BAD: ..."""

    VALIDATOR_PROMPT_PLAYABILITY = VALIDATOR_AUTOFIX_HEAD + """SCOPE: playability — will every layer the author intended actually be audible?

Audit each voice/layer in stack(...) / arrange(...):
- .gain() reasonable (>0.05; 0 = silence). FIX .gain(0) → .gain(0.8).
- .lpf(N) with N<100 mutes treble. FIX .lpf(0) → .lpf(800).
- .hpf(N) with N>5000 mutes low/mid. FIX if entire piece's bass is over-hpf'd.
- .vib(N) single arg → FIX to .vib("4 0.1").
- arrange([cycles, pattern]) — fix cycles=0 → cycles=4.

Tempo sanity: setcpm(N/4) where N gives ~60-200 BPM. If N<20 or N>240, FIX to genre-appropriate.

After analysis, output ONE of: VERDICT: VALID / VERDICT: FIXED + ```javascript``` block / VERDICT: BAD: ..."""

    def _validator_pass(self, code, sys_prompt, route, max_tokens=2400, timeout_sec=120):
        """Run one validator pass. Returns {ok, reason, model_used, latency_ms, raw_reply}."""
        t0 = time.time()
        user_msg = f'```javascript\n{code}\n```'
        try:
            if route['mode'] == 'cliproxy':
                body = json.dumps({
                    'model': route['model'],
                    'messages': [
                        {'role': 'system', 'content': sys_prompt},
                        {'role': 'user', 'content': user_msg},
                    ],
                    'max_tokens': max_tokens,
                    'temperature': 0.1,
                }).encode('utf-8')
                req = urllib.request.Request(
                    f'{route["base_url"]}/chat/completions',
                    data=body,
                    headers={'Authorization': f'Bearer {route["api_key"]}', 'Content-Type': 'application/json'},
                    method='POST',
                )
                with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                reply = data['choices'][0]['message']['content']
            else:  # direct
                # Direct vendor: combine system + user into single user content
                reply = self._call_direct_vendor(
                    route.get('vendor', 'openai'), route['base_url'], route['api_key'], route['model'],
                    f'{sys_prompt}\n\n{user_msg}',
                )
        except Exception as e:
            # Fail OPEN on errors so the pipeline doesn't get blocked by a flaky validator
            return {'ok': True, 'reason': f'(validator pass errored — skipping: {type(e).__name__}: {str(e)[:120]})',
                    'model_used': route.get('model'), 'latency_ms': int((time.time() - t0) * 1000)}

        latency_ms = int((time.time() - t0) * 1000)
        text = (reply or '').strip()
        # Find the VERDICT: line (last one in text). It can be:
        #   VERDICT: VALID
        #   VERDICT: FIXED   (followed by a ```javascript ... ``` block)
        #   VERDICT: BAD: <reason>
        m = re.search(r'(?im)^\s*VERDICT:\s*(VALID|FIXED|BAD)\b\s*:?\s*(.*?)$', text)
        if not m:
            return {'ok': True, 'reason': f'(no VERDICT line — reply tail: {text[-120:].strip()})',
                    'model_used': route['model'], 'latency_ms': latency_ms, 'raw_reply': text[-2000:]}
        verdict = m.group(1).upper()
        verdict_tail = m.group(2).strip()
        if verdict == 'VALID':
            return {'ok': True, 'fixed_code': None, 'reason': '',
                    'model_used': route['model'], 'latency_ms': latency_ms}
        if verdict == 'BAD':
            return {'ok': False, 'fixed_code': None,
                    'reason': verdict_tail or 'unspecified',
                    'model_used': route['model'], 'latency_ms': latency_ms,
                    'raw_reply': text[-2000:]}
        if verdict == 'FIXED':
            # Extract the ```javascript ... ``` block that follows
            after = text[m.end():]
            cb = re.search(r'```(?:javascript|js|strudel)?\s*\n([\s\S]*?)```', after)
            if not cb:
                # Brain said FIXED but didn't give code — treat as valid (it might mean no change)
                return {'ok': True, 'fixed_code': None,
                        'reason': '(FIXED verdict but no code block — passing original)',
                        'model_used': route['model'], 'latency_ms': latency_ms}
            fixed = cb.group(1).strip()
            return {'ok': True, 'fixed_code': fixed, 'reason': 'auto-fixed',
                    'model_used': route['model'], 'latency_ms': latency_ms}
        return {'ok': True, 'fixed_code': None,
                'reason': f'(unrecognized verdict: {verdict})',
                'model_used': route['model'], 'latency_ms': latency_ms}

    def _brain_validate_strudel(self, code, *, slot, mode=None):
        """3-tier validator gate.
        mode: 'off' (skip) | 'light' (1 pass) | 'heavy' (3 passes). If None, read from user_config.

        Returns dict:
          {ok, reason, mode, model_used, latency_ms, passes (heavy only)}
        """
        if mode is None:
            cfg = user_config.load()
            mode = (cfg.get('validator') or {}).get('mode') or 'light'

        if mode == 'off':
            return {'ok': True, 'mode': 'off', 'reason': '', 'latency_ms': 0}

        # Resolve a chat route. Prefer current slot; for agy or unavailable, fall back.
        info = BACKEND_REGISTRY.get(slot) or {}
        route = self._resolve_slot_route(slot) if info.get('vendor') != 'agy' else None
        if not route or route['mode'] is None:
            for fb in ('gemini-flash', 'gpt-5.5', 'opus-4.8', 'grok-build', 'gpt-5.5x'):
                if fb == slot: continue
                r = self._resolve_slot_route(fb)
                if r['mode'] in ('cliproxy', 'direct'):
                    route = r
                    route['vendor'] = (BACKEND_REGISTRY.get(fb) or {}).get('vendor')
                    break
        if not route or route['mode'] not in ('cliproxy', 'direct'):
            return {'ok': True, 'mode': mode, 'reason': '(no validator route available — skipping)',
                    'model_used': None, 'latency_ms': 0}
        route.setdefault('vendor', info.get('vendor'))

        if mode == 'light':
            r = self._validator_pass(code, self.VALIDATOR_PROMPT_LIGHT, route, max_tokens=2400, timeout_sec=120)
            r['mode'] = 'light'
            # Pass through final_code (the corrected code if FIXED, else original)
            r['final_code'] = r.get('fixed_code') or code
            return r

        if mode == 'heavy':
            passes_spec = [
                ('parse',       self.VALIDATOR_PROMPT_PARSE,       80),
                ('samples',     self.VALIDATOR_PROMPT_SAMPLES,     100),
                ('playability', self.VALIDATOR_PROMPT_PLAYABILITY, 100),
            ]
            all_passes = []
            total_ms = 0
            current_code = code  # threaded through passes, updated if a pass FIXED
            for pass_name, prompt, t_per in passes_spec:
                r = self._validator_pass(current_code, prompt, route, max_tokens=2400, timeout_sec=t_per)
                all_passes.append({'pass': pass_name, **r,
                                    'applied_fix': bool(r.get('fixed_code'))})
                total_ms += r.get('latency_ms', 0)
                if not r['ok']:
                    return {'ok': False, 'mode': 'heavy',
                            'reason': f'{pass_name}: {r["reason"]}',
                            'passes': all_passes, 'latency_ms': total_ms,
                            'model_used': r.get('model_used')}
                if r.get('fixed_code'):
                    current_code = r['fixed_code']
            return {'ok': True, 'mode': 'heavy', 'reason': '',
                    'passes': all_passes, 'latency_ms': total_ms,
                    'model_used': route['model'],
                    'final_code': current_code,
                    'fixed_code': current_code if current_code != code else None}

        # Unknown mode — fail open
        return {'ok': True, 'mode': mode, 'reason': f'(unknown validator mode: {mode!r} — skipping)', 'latency_ms': 0}

    def _call_direct_vendor(self, vendor, base_url, api_key, model, user_content):
        """POST one chat turn to the vendor's native endpoint. Returns the
        model's text reply. Raises on HTTP / parse errors."""
        if vendor in ('openai', 'xai'):
            # OpenAI-compatible
            body = json.dumps({
                'model': model,
                'messages': [{'role': 'user', 'content': user_content}],
                'max_tokens': 4096,
            }).encode('utf-8')
            req = urllib.request.Request(
                f'{base_url}/chat/completions',
                data=body,
                headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            return data['choices'][0]['message']['content']
        if vendor == 'anthropic':
            body = json.dumps({
                'model': model,
                'max_tokens': 4096,
                'messages': [{'role': 'user', 'content': user_content}],
            }).encode('utf-8')
            req = urllib.request.Request(
                f'{base_url}/v1/messages',
                data=body,
                headers={
                    'x-api-key': api_key,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json',
                },
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            # Anthropic: content is a list of blocks; take the text block(s)
            parts = []
            for block in (data.get('content') or []):
                if isinstance(block, dict) and block.get('type') == 'text':
                    parts.append(block.get('text', ''))
            return '\n'.join(parts)
        if vendor == 'google':
            # Google Generative AI: POST /v1beta/models/{model}:generateContent
            body = json.dumps({
                'contents': [{'role': 'user', 'parts': [{'text': user_content}]}],
                'generationConfig': {'maxOutputTokens': 4096},
            }).encode('utf-8')
            # api_key as query param (no Bearer header on Google's legacy endpoint)
            req = urllib.request.Request(
                f'{base_url}/models/{model}:generateContent?key={urllib.parse.quote(api_key)}',
                data=body,
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            parts = []
            for cand in (data.get('candidates') or []):
                for p in ((cand.get('content') or {}).get('parts') or []):
                    if isinstance(p, dict) and 'text' in p:
                        parts.append(p['text'])
            return '\n'.join(parts)
        raise RuntimeError(f'unknown vendor: {vendor}')

    def _api_run_cliproxy(self, extra, *, slot, model):
        """Direct HTTP-API generation via the local CLIProxy gateway.
        OpenAI-compatible POST to /chat/completions with Bearer auth."""
        emit = self._open_sse()
        if emit is None:
            return

        label = BACKEND_REGISTRY[slot]['label']
        key = self._cliproxy_api_key()
        if not key:
            emit('start', {'model': label, 'extra': extra or '(none)'})
            emit('error', {'error': 'CLIProxy API key not found (set CLIPROXY_API_KEY env or check key doc path)'})
            emit('done', {'exit': 1})
            return

        # Register in /api/gen-status (job_id lets the client cancel server-side)
        gen_job = self._new_gen_job(slot, extra)
        emit('start', {'model': label, 'extra': extra or '(none)', 'job_id': gen_job['job_id']})

        try:
            kernel = self._read_compiled_kernel()
            prompt_snapshot = (
                f'# slot: {slot} ({label})\n'
                f'# model: {model}\n'
                f'# kernel hash: {kernel["hash"]}\n'
                f'# fragments: {", ".join(kernel["fragments_used"])}\n\n'
                f'{kernel["text"]}'
            )
            if extra:
                prompt_snapshot += f'\n\nPROMPT_EXTRA:\n{extra}'

            user_content = f"""You are the CactusStrudel generator.

Return exactly one fenced ```javascript code block containing a complete executable Strudel piece.
Do not explain your answer.
The final expression must evaluate to a Strudel Pattern. Include setcpm(.../4).

{kernel["text"]}

PROMPT_EXTRA:
{extra or '(none)'}
"""
            req_body = json.dumps({
                'model': model,
                'messages': [{'role': 'user', 'content': user_content}],
                'max_tokens': 4096,
            }).encode('utf-8')

            base = self._cliproxy_base_url()
            emit('log', {'line': f'▶ [{label}] POST {base}/chat/completions'})
            req = urllib.request.Request(
                f'{base}/chat/completions',
                data=req_body,
                headers={
                    'Authorization': f'Bearer {key}',
                    'Content-Type': 'application/json',
                },
                method='POST',
            )
            try:
                with urllib.request.urlopen(req, timeout=300) as resp:
                    resp_body = resp.read().decode('utf-8')
            except urllib.error.HTTPError as he:
                err_body = ''
                try: err_body = he.read().decode('utf-8')[:400]
                except Exception: pass
                emit('error', {'error': f'CLIProxy HTTP {he.code}: {err_body}'})
                emit('done', {'exit': 1})
                return
            except Exception as e:
                emit('error', {'error': f'CLIProxy request failed: {e}'})
                emit('done', {'exit': 1})
                return

            try:
                resp_data = json.loads(resp_body)
                output = resp_data['choices'][0]['message']['content']
            except Exception as e:
                emit('error', {'error': f'CLIProxy response parse failed: {e}'})
                emit('log', {'line': resp_body[:600]})
                emit('done', {'exit': 1})
                return

            try:
                code = self._extract_strudel_code(output)
            except RuntimeError as e:
                emit('error', {'error': str(e)})
                emit('log', {'line': output[:600]})
                emit('done', {'exit': 1})
                return

            emit('log', {'line': f'▶ [{label}] code extracted ({len(code)}c); rendering…'})
            entry = self._render_and_register(
                code=code,
                prompt_snapshot=prompt_snapshot,
                extra=extra,
                slot=slot,
                emit=emit,
                gen_job=gen_job,
            )
            emit('done', {'exit': 0 if entry else 1, 'entry': entry})
        finally:
            with _gen_jobs_lock:
                try: _gen_jobs.remove(gen_job)
                except ValueError: pass

    def _render_and_register(self, *, code, prompt_snapshot, extra, slot, emit, gen_job=None):
        """Shared post-generate pipeline: validate → write .js → render mp3 → append corpus entry.
        Used by cliproxy-api backend (and refactor target for agy-cli path). Returns
        the corpus entry dict, or None on failure (error already emitted)."""
        # Mechanical preflight only. Never let an LLM silently change the
        # first-shot composition before render/listen.
        cfg = user_config.load()
        mode = (cfg.get('validator') or {}).get('mode') or 'deterministic'
        if mode != 'off':
            emit('validate', {'phase': 'start', 'mode': 'deterministic'})
            deterministic = self._run_deterministic_validator_code(code)
            if deterministic.returncode != 0:
                reason = ((deterministic.stderr or '') + (deterministic.stdout or '')).strip()[-1200:]
                emit('validate', {'phase': 'fail', 'mode': 'deterministic',
                                  'reason': reason or f'exit {deterministic.returncode}'})
                emit('error', {'error': f'deterministic Strudel validation failed: {reason or deterministic.returncode}'})
                return None
            emit('validate', {'phase': 'pass', 'mode': 'deterministic',
                              'source_unchanged': True})

        # Honor a cancel that arrived during code-gen / validation.
        if gen_job is not None and (gen_job.get('cancelled') or gen_job.get('cancel_requested')):
            emit('error', {'error': 'cancelled'}); return None
        ts_ms = int(time.time() * 1000)
        fname = f'gemini_auto_{ts_ms}.js'
        js_abs = os.path.join(PIECES, fname)
        os.makedirs(PIECES, exist_ok=True); os.makedirs(AUDIO, exist_ok=True); os.makedirs(FEATURES, exist_ok=True)
        with open(js_abs, 'w') as f:
            f.write(code)
        render = self._run_render_subprocess(js_abs, timeout=480, job=gen_job)
        mp3_abs = self._mp3_path_for(js_abs)
        if render.returncode != 0 or not os.path.exists(mp3_abs):
            if gen_job is not None and (gen_job.get('cancelled') or gen_job.get('cancel_requested')):
                emit('error', {'error': 'cancelled'}); return None
            emit('error', {'error': f'auto-render failed (exit {render.returncode})'})
            emit('log', {'line': (render.stderr or '')[-800:]})
            return None
        sha, dur = self._probe_mp3(mp3_abs)
        features_abs = self._features_path_for(js_abs)
        features_rel, audio_features = self._features_payload_for(features_abs)
        js_rel  = js_abs.replace(ROOT + '/', '')
        mp3_rel = mp3_abs.replace(ROOT + '/', '')
        base = os.path.basename(js_rel).replace('.js', '')
        prompt_rel = f'producer-brain/prompts/{base}.txt'
        os.makedirs(PROMPTS, exist_ok=True)
        with open(f'{PROMPTS}/{base}.txt', 'w') as pf:
            pf.write(prompt_snapshot)
        g_code, g_preset, g_category, g_label = self._resolve_genre_code(extra)
        if not g_code: g_code = 'UN'
        label = BACKEND_REGISTRY[slot]['label']
        # Allocate name + i AND append in one locked section so concurrent
        # background gens can't collide on the same i / name.
        with _manifest_lock:
            name_str = self._next_genre_name(g_code)
            entry = self._build_corpus_entry(
                name=name_str,
                js_rel=js_rel,
                mp3_rel=mp3_rel,
                prompt_rel=prompt_rel,
                features_rel=features_rel,
                audio_features=audio_features,
                sha=sha,
                dur=dur,
                extra_tag=f'({label}, preset={g_preset or "(none)"})',
                genre_code=g_code,
                genre_preset=g_preset,
                genre_label=g_label,
                category=g_category,
                source=slot,  # slot key = stable identifier; UI maps to label via /api/backends
            )
            self._append_manifest_entry(entry)
        emit('log', {'line': f'▶ [{label}] Piece registered as {name_str}'})
        return entry

    # ── Genre code registry + naming ──────────────────────────────────────
    # Single source of truth: producer-brain/genre-codes.json maps preset key →
    # short code → category. New AGY-generated pieces are named <CODE>-<NNN>
    # where NNN is the next zero-padded 3-digit sequence per code.
    def _read_genre_codes(self):
        try:
            with open(GENRE_CODES) as f:
                return json.load(f)
        except Exception as e:
            print(f'[genre-codes] failed to read: {e}')
            return None

    # ── Single source of truth for corpus entry construction ─────────────
    # All write paths (AGY CLI / save-piece / future cliproxy-api) MUST go
    # through this helper. Guarantees schema_version=2 + monotonic i + the
    # canonical field set so the corpus stays single-schema.
    def _build_corpus_entry(self, *, name, js_rel, mp3_rel, prompt_rel=None,
                            features_rel=None, audio_features=None,
                            prompt_json_rel=None, sha='', dur='', extra_tag='',
                            genre_code=None, genre_preset=None, genre_label=None,
                            category=None, source='manual-edit'):
        next_i = (sum(1 for _ in open(MANIFEST)) + 1) if os.path.exists(MANIFEST) else 1
        entry = {
            'schema_version': 2,
            'i': next_i,
            'name': name,
            'genre_code': genre_code or 'UN',
            'genre_preset': genre_preset,
            'genre_label': genre_label,
            'category': category or 'uncategorized',
            'source': source,                      # 'agy-cli' | 'manual-edit' | 'cliproxy-api'
            'extra': extra_tag,
            'js': js_rel,
            'mp3': mp3_rel,
            'sha': sha,
            'dur': dur,
            'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
            'tags': [],
            'parent': None,
            'archived_at': None,
            'features': features_rel,
            'audio_features': audio_features,
        }
        if prompt_rel: entry['prompt'] = prompt_rel
        if prompt_json_rel: entry['prompt_json'] = prompt_json_rel
        return entry

    def _extract_preset_from_extra(self, extra):
        """Advanced prompt prefix is 'Style envelope they're after: <Label>.\\n'.
        Parse the label so we can look it up in genre-codes.preset_to_code via
        each preset's <option> label."""
        if not extra: return None
        m = re.match(r"\s*(?:.*?\n)*?\s*Style envelope they're after:\s*([^.\n]+)", extra, re.I)
        return m.group(1).strip() if m else None

    def _resolve_genre_code(self, extra):
        """Given the PROMPT_EXTRA (Advanced-compiled text), return
        (code, preset, category, label) or (None, None, None, None) when no
        preset could be identified (Fast mode / custom)."""
        registry = self._read_genre_codes()
        if not registry: return (None, None, None, None)
        label_seen = self._extract_preset_from_extra(extra)
        if not label_seen: return (None, None, None, None)
        ll = label_seen.lower().strip()
        codes_map = registry.get('codes', {})
        # 1) EXACT label match first — so "Psytrance" hits PT, not TR ("Trance")
        #    via substring. (substring-only matching mis-routed psytrance→trance,
        #    deep-house→house, tech-house→house, etc. — fixed 2026-05-29.)
        for code, info in codes_map.items():
            if (info.get('label') or '').lower().strip() == ll:
                return (code, info.get('preset'), info.get('category'), info.get('label'))
        # 2) substring fallback, preferring the LONGEST matching label so a
        #    shorter label ("Trance") can't capture a longer one ("Psytrance").
        best = None  # (result_tuple, matched_len)
        for code, info in codes_map.items():
            cl = (info.get('label') or '').lower().strip()
            if cl and cl in ll and (best is None or len(cl) > best[1]):
                best = ((code, info.get('preset'), info.get('category'), info.get('label')), len(cl))
        if best: return best[0]
        return (None, None, None, None)

    def _next_genre_name(self, code):
        """Return next available `<CODE>-NNN` for the given code, scanning the
        active manifest only (archive doesn't count)."""
        if not code: code = 'UN'
        seq = 0
        if os.path.exists(MANIFEST):
            with open(MANIFEST) as f:
                for line in f:
                    if not line.strip(): continue
                    try:
                        d = json.loads(line)
                        name = d.get('name','')
                        m = re.match(rf'^{re.escape(code)}-(\d+)$', name)
                        if m:
                            n = int(m.group(1))
                            if n > seq: seq = n
                    except Exception: pass
        return f'{code}-{seq+1:03d}'

    def _read_compiled_kernel(self):
        """Compile the producer-brain/kernel/* fragments fresh on each call.
        This is the AGY-CLI content source as of Phase 1. The kernel is the
        single source of truth for what AGY sees about the API surface, syntax
        rules, output contract, and creative freedom. It is deliberately silent
        on aesthetic/style choices — those are entirely the model's call."""
        import importlib, sys
        # Lazy import so a syntax error in prompt_kernel.py doesn't crash server boot
        sys.path.insert(0, os.path.dirname(__file__))
        import prompt_kernel  # noqa: E402
        importlib.reload(prompt_kernel)  # pick up live edits without server restart
        lock = prompt_kernel.verify_lock(mode='agy')
        if not lock.get('ok'):
            raise RuntimeError(lock.get('error') or 'kernel lock verification failed')
        return prompt_kernel.compile(mode='agy')  # returns dict {text, hash, fragments_used, mode, preset}

    # ---- Kernel fragment editor (replaces old PROMPT_BASE editor) ----------
    KERNEL_DIR = property(lambda self: f'{ROOT}/producer-brain/kernel')

    def _list_kernel_fragments(self):
        """Return list of {name, size} for all editable kernel files.

        Includes core fragments (NN-name.md at top level) and optional style/
        fragments. The order matches what prompt_kernel.compile() concatenates."""
        out = []
        kd = f'{ROOT}/producer-brain/kernel'
        if os.path.isdir(kd):
            for f in sorted(os.listdir(kd)):
                if re.match(r'^\d{2}-.*\.md$', f):
                    p = os.path.join(kd, f)
                    out.append({'name': f, 'size': os.path.getsize(p)})
            style_dir = os.path.join(kd, 'style')
            if os.path.isdir(style_dir):
                for f in sorted(os.listdir(style_dir)):
                    if f.endswith('.md'):
                        p = os.path.join(style_dir, f)
                        out.append({'name': f'style/{f}', 'size': os.path.getsize(p)})
        return out

    def _kernel_fragment_path(self, name):
        """Resolve a fragment name to its absolute path with strict allow-list
        validation (no path traversal). Returns None if name is invalid."""
        if not name or '..' in name or name.startswith('/'):
            return None
        # core: NN-*.md at top level; style: style/*.md
        if re.match(r'^\d{2}-[\w-]+\.md$', name):
            return f'{ROOT}/producer-brain/kernel/{name}'
        if re.match(r'^style/[\w-]+\.md$', name):
            return f'{ROOT}/producer-brain/kernel/{name}'
        return None

    def _api_kernel_list(self):
        try:
            self._json(200, {'fragments': self._list_kernel_fragments()})
        except Exception as e:
            self._json(500, {'error': str(e)})

    def _api_kernel_get(self, p):
        try:
            qs = urllib.parse.parse_qs(p.query)
            name = (qs.get('name') or [''])[0]
            path = self._kernel_fragment_path(name)
            if not path or not os.path.exists(path):
                return self._json(404, {'error': f'fragment not found: {name}'})
            content = open(path).read()
            import hashlib
            sha = hashlib.sha256(content.encode('utf-8')).hexdigest()
            self._json(200, {'name': name, 'content': content, 'sha': sha})
        except Exception as e:
            self._json(500, {'error': str(e)})

    def _api_kernel_put(self):
        try:
            body = self._json_body()
            name = body.get('name')
            content = body.get('content')
            if content is None: return self._json(400, {'error': 'content required'})
            path = self._kernel_fragment_path(name)
            if not path: return self._json(400, {'error': f'invalid fragment name: {name!r}'})
            if not os.path.exists(path):
                return self._json(404, {'error': f'fragment not found: {name}'})
            ts = time.strftime('%Y%m%d-%H%M%S')
            backup = f'{path}.bak.{ts}'
            try:
                with open(path) as src, open(backup, 'w') as dst:
                    dst.write(src.read())
            except Exception as e:
                return self._json(500, {'error': f'backup failed: {e}'})
            self._atomic_write_text(path, content)
            try:
                import importlib, sys
                sys.path.insert(0, os.path.dirname(__file__))
                import prompt_kernel  # noqa: E402
                importlib.reload(prompt_kernel)
                lock = prompt_kernel.write_lock()
            except Exception as e:
                return self._json(500, {'error': f'kernel saved but lock update failed: {e}', 'backup': os.path.basename(backup)})
            self._json(200, {'ok': True, 'name': name, 'backup': os.path.basename(backup), 'kernel_lock': lock})
        except Exception as e:
            self._json(500, {'error': str(e)})

    def _read_bridge_tasks(self):
        return self._read_jsonl(TASKS)

    def _write_bridge_tasks(self, tasks):
        tmp = f'{TASKS}.tmp.{os.getpid()}.{int(time.time() * 1000)}'
        with open(tmp, 'w') as f:
            for task in tasks:
                f.write(json.dumps(task, ensure_ascii=False) + '\n')
        os.replace(tmp, TASKS)
        self._invalidate_jsonl_cache(TASKS)

    def _update_bridge_task(self, task_id, **fields):
        tasks = self._read_bridge_tasks()
        updated = None
        for task in tasks:
            if task.get('id') == task_id:
                task.update(fields)
                updated = task
                break
        if not updated:
            raise RuntimeError(f'task not found: {task_id}')
        self._write_bridge_tasks(tasks)
        return updated

    def _extract_strudel_code(self, output):
        m = re.search(r"```(?:javascript|js|strudel)?\s*([\s\S]*?)```", output, re.I)
        code = (m.group(1) if m else output).strip()
        code = re.sub(r'^\s*(?:javascript|js|strudel)\s*\n', '', code, flags=re.I).strip()
        if not code or '```' in code:
            raise RuntimeError('AGY did not return a clean code block')
        if not re.search(r'\b(stack|arrange|note|n|s|chord)\s*\(', code):
            raise RuntimeError('AGY output does not look like Strudel code')
        return code + '\n'

    def _process_agy_generate_task(self, task_id, extra, agy_log):
        def stamp():
            return time.strftime('%Y-%m-%d %H:%M:%S')

        def rel(path):
            return path.replace(ROOT + '/', '')

        def log(line):
            with open(agy_log, 'a') as f:
                f.write(f'[{stamp()}] {line}\n')

        try:
            self._update_bridge_task(task_id, status='running', started_at=stamp())
            # ── Phase 1 (kernel) ──────────────────────────────────────────
            # AGY content source is now the compiled producer-brain/kernel/*.
            # The AGY CLI invocation (subprocess args, wrapping preamble,
            # output extraction, render pipeline) is unchanged — only the
            # body text differs from the old PROMPT_BASE + AGY_brief pair.
            kernel = self._read_compiled_kernel()
            prompt_snapshot = (
                f'# kernel hash: {kernel["hash"]}\n'
                f'# fragments: {", ".join(kernel["fragments_used"])}\n\n'
                f'{kernel["text"]}'
            )
            if extra:
                prompt_snapshot += f'\n\nPROMPT_EXTRA:\n{extra}'
            agy_prompt = f"""You are the CactusStrudel AGY CLI generator.

Return exactly one fenced ```javascript code block containing a complete executable Strudel piece.
Do not inspect files, do not run tools, and do not explain your answer.
The final expression must evaluate to a Strudel Pattern. Include setcpm(.../4).

{kernel["text"]}

PROMPT_EXTRA:
{extra or '(none)'}
"""
            # ── Phase 4: structured per-piece prompt meta ────────────────
            # The .txt prompt_snapshot stays for backward compat (data.html
            # Prompt tab + research-backfill rely on it). The .json sidecar
            # is the queryable surface — kernel hash for cross-piece compare,
            # extra blob verbatim for full reproducibility, compiled blob for
            # exact replay.
            prompt_meta = {
                'schema_version': 1,
                'mode': 'agy-cli',
                'ts': stamp(),
                'kernel': {
                    'hash': kernel['hash'],
                    'fragments_used': kernel['fragments_used'],
                    'text_length': len(kernel['text']),
                },
                'extra': extra or '',
                'compiled_prompt': agy_prompt,
            }
            log('running AGY narrow code-generation prompt')
            agy = subprocess.run(
                [self._agy_bin_path(), '-p', agy_prompt, '--print-timeout', '4m',
                 '--dangerously-skip-permissions'],
                cwd=ROOT,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=270,
            )
            if agy.stdout:
                log('AGY stdout:')
                with open(agy_log, 'a') as f:
                    f.write(agy.stdout.rstrip() + '\n')
            if agy.stderr:
                log('AGY stderr:')
                with open(agy_log, 'a') as f:
                    f.write(agy.stderr.rstrip() + '\n')
            if agy.returncode != 0:
                raise RuntimeError(f'AGY exited {agy.returncode}')

            code = self._extract_strudel_code(agy.stdout)
            # Mechanical preflight only. The generated first shot is kept
            # byte-for-byte; a Brain review must become a separate preview.
            cfg = user_config.load()
            mode = (cfg.get('validator') or {}).get('mode') or 'deterministic'
            if mode != 'off':
                deterministic = self._run_deterministic_validator_code(code)
                if deterministic.returncode != 0:
                    reason = ((deterministic.stderr or '') + (deterministic.stdout or '')).strip()[-1200:]
                    log(f'DETERMINISTIC VALIDATION FAILED: {reason or deterministic.returncode}')
                    raise RuntimeError(f'deterministic Strudel validation failed: {reason or deterministic.returncode}')
                log('deterministic validator: PASS (source unchanged)')
            ts_ms = int(time.time() * 1000)
            js_abs = f'{PIECES}/gemini_auto_{ts_ms}.js'
            os.makedirs(PIECES, exist_ok=True)
            with open(js_abs, 'w') as f:
                f.write(code)
            log(f'wrote {rel(js_abs)}')

            log('rendering via apps/cli/src/auto-render.ts')
            render = self._run_render_subprocess(js_abs, timeout=480, cycles='24')
            if render.stdout:
                log('render stdout:')
                with open(agy_log, 'a') as f:
                    f.write(render.stdout.rstrip() + '\n')
            if render.stderr:
                log('render stderr:')
                with open(agy_log, 'a') as f:
                    f.write(render.stderr.rstrip() + '\n')
            mp3_abs = self._mp3_path_for(js_abs)
            if render.returncode != 0:
                raise RuntimeError(f'auto-render exited {render.returncode}')
            if not os.path.exists(mp3_abs):
                raise RuntimeError(f'auto-render did not produce {rel(mp3_abs)}')

            self._update_bridge_task(
                task_id,
                status='done',
                ended_at=stamp(),
                result={'js': rel(js_abs), 'mp3': rel(mp3_abs),
                        'prompt_snapshot': prompt_snapshot,
                        'prompt_meta': prompt_meta},
            )
            if os.path.exists(os.path.join(BRIDGE, '.kick')):
                try:
                    os.remove(os.path.join(BRIDGE, '.kick'))
                except Exception:
                    pass
            log(f'done {rel(js_abs)} -> {rel(mp3_abs)}')
        except Exception as e:
            log(f'FAILED: {e}')
            self._update_bridge_task(
                task_id,
                status='failed',
                ended_at=stamp(),
                result={'error': str(e), 'log': rel(agy_log)},
            )

    def _api_run_agy_cli(self, extra, *, slot='agy-cli'):
        """AGY CLI model: queues a task in tasks.jsonl and spawns `agy` CLI
        narrowly for code generation. Local Python owns queue state, file
        writes, rendering, and task completion.

        This avoids the brittle "agy checks the inbox and drives the repo"
        route, where the closed-source Go CLI can crash while reading its own
        task logs.
        """
        emit = self._open_sse()
        if emit is None:
            return

        task_id = f"task-{int(time.time()*1000)}"
        ts_str = time.strftime('%Y-%m-%d %H:%M:%S')
        new_task = {
            'id': task_id,
            'ts': ts_str,
            'kind': 'generate-agy',
            'label': 'Generate piece via AGY CLI',
            'body': extra or '',
            'status': 'queued'
        }
        # Register in /api/gen-status registry so the running pill survives
        # SSE disconnect. Removed in the polling loop when status terminal.
        gen_job = {'pid': None, 'started_at': time.time(),
                   'backend': 'agy-cli', 'extra': (extra or '')[:80]}
        with _gen_jobs_lock: _gen_jobs.append(gen_job)

        tasks_list = []
        if os.path.exists(TASKS):
            try:
                for line in open(TASKS):
                    line = line.strip()
                    if line: tasks_list.append(json.loads(line))
            except Exception as e:
                print(f"[run-agy] failed to read tasks.jsonl: {e}")
        tasks_list.append(new_task)

        try:
            self._rewrite_jsonl(TASKS, tasks_list)
            with open(os.path.join(BRIDGE, '.kick'), 'w') as kf:
                kf.write(str(int(time.time())))
        except Exception as e:
            emit('error', {'error': f'Failed to write task: {e}'})
            return

        emit('start', {'model': 'agy-cli', 'extra': extra or '(none)'})
        emit('log', {'line': f'▶ [AGY CLI] Task queued as {task_id}'})
        emit('log', {'line': '▶ [AGY CLI] Running local task runner; AGY only writes Strudel code...'})

        # Run deterministic local queue/render code in a background thread.
        agy_log = os.path.join(BRIDGE, f'.agy-run-{task_id}.log')

        def trigger_agy_cli():
            self._process_agy_generate_task(task_id, extra, agy_log)

        threading.Thread(target=trigger_agy_cli, daemon=True).start()

        # Poll tasks.jsonl for task completion with a 6 minute timeout
        last_status = 'queued'
        completed_task = None
        poll_start = time.time()
        POLL_TIMEOUT = 360  # 6 minutes

        while time.time() - poll_start < POLL_TIMEOUT:
            time.sleep(2.0)
            try:
                current_tasks = self._read_bridge_tasks()
            except Exception:
                continue
            t_obj = next((t for t in current_tasks if t.get('id') == task_id), None)
            if not t_obj:
                emit('log', {'line': '▶ [AGY CLI] WARNING: Task was removed from queue.'})
                break

            status_val = t_obj.get('status', 'queued')
            if status_val != last_status:
                emit('log', {'line': f'▶ [AGY CLI] Task status: {last_status} → {status_val}'})
                last_status = status_val

            if status_val == 'done':
                completed_task = t_obj
                break
            elif status_val in ('failed', 'cancelled'):
                res = t_obj.get('result') if isinstance(t_obj.get('result'), dict) else {}
                err = res.get('error') or f'Task ended with status: {status_val}'
                emit('error', {'error': err})
                break
        else:
            # Timed out
            emit('log', {'line': '▶ [AGY CLI] ⚠ Timed out waiting for task completion (6 min).'})
            # Try to read and show last lines of agy log for debugging
            if os.path.exists(agy_log):
                try:
                    tail = open(agy_log).read()[-500:]
                    emit('log', {'line': f'▶ [AGY CLI] Last log output:\n{tail}'})
                except Exception:
                    pass

        entry = None
        if completed_task:
            res = completed_task.get('result', {})
            js_out = res.get('js')
            mp3_out = res.get('mp3')
            prompt_snapshot = res.get('prompt_snapshot')
            js_abs = os.path.join(ROOT, js_out) if js_out else None
            mp3_abs = os.path.join(ROOT, mp3_out) if mp3_out else None

            if js_abs and mp3_abs and os.path.exists(mp3_abs):
                try:
                    sha = subprocess.run(['shasum', '-a', '256', mp3_abs], capture_output=True, text=True).stdout[:16]
                    try:
                        dur = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3_abs],
                                             capture_output=True, text=True).stdout.strip()
                    except Exception: dur = ''
                    js_rel  = js_out.replace(ROOT + '/', '')
                    mp3_rel = mp3_out.replace(ROOT + '/', '')
                    features_abs = self._features_path_for(js_abs)
                    features_rel, audio_features = self._features_payload_for(features_abs)
                    base = os.path.basename(js_rel).replace('.js', '')
                    prompt_path_abs = f'{PROMPTS}/{base}.txt'
                    prompt_rel = f'producer-brain/prompts/{base}.txt'
                    if prompt_snapshot:
                        os.makedirs(PROMPTS, exist_ok=True)
                        with open(prompt_path_abs, 'w') as pf:
                            pf.write(prompt_snapshot)
                    # Phase 4: also write .json sidecar with structured prompt_meta
                    prompt_meta = res.get('prompt_meta') if isinstance(res, dict) else None
                    prompt_json_rel = None
                    if prompt_meta:
                        os.makedirs(PROMPTS, exist_ok=True)
                        prompt_json_abs = f'{PROMPTS}/{base}.json'
                        prompt_json_rel = f'producer-brain/prompts/{base}.json'
                        # attach piece name once we know it (set just below in tag/name assignment)
                        prompt_meta['piece'] = None  # filled after name_str assigned
                        with open(prompt_json_abs, 'w') as pf:
                            json.dump(prompt_meta, pf, ensure_ascii=False, indent=2)
                    # Resolve genre code from the extra blob; fall back to UN
                    g_code, g_preset, g_category, g_label = self._resolve_genre_code(extra)
                    if not g_code: g_code = 'UN'
                    with _manifest_lock:
                        name_str = self._next_genre_name(g_code)
                        entry = self._build_corpus_entry(
                            name=name_str,
                            js_rel=js_rel,
                            mp3_rel=mp3_rel,
                            prompt_rel=prompt_rel,
                            features_rel=features_rel,
                            audio_features=audio_features,
                            prompt_json_rel=prompt_json_rel,
                            sha=sha,
                            dur=dur,
                            extra_tag=f'(AGY CLI, preset={g_preset or "(none)"})',
                            genre_code=g_code,
                            genre_preset=g_preset,
                            genre_label=g_label,
                            category=g_category,
                            source=slot,
                        )
                        if prompt_json_rel:
                            try:
                                with open(prompt_json_abs) as pf:
                                    pm = json.load(pf)
                                pm['piece'] = name_str
                                with open(prompt_json_abs, 'w') as pf:
                                    json.dump(pm, pf, ensure_ascii=False, indent=2)
                            except Exception: pass
                        self._append_manifest_entry(entry)
                    emit('log', {'line': f'▶ [AGY CLI] Piece registered as {entry["name"]}'})
                except Exception as e:
                    print(f'[run-agy] manifest-append failed: {e}')

        with _gen_jobs_lock:
            try: _gen_jobs.remove(gen_job)
            except ValueError: pass
        emit('done', {'exit': 0 if completed_task and completed_task.get('status') == 'done' else 1, 'entry': entry})

    # ---- API: MIDI export (haps from rendered Strudel) -------------------
    def _api_midi(self):
        try:
            body = self._json_body()
            code = body.get('code'); name = body.get('name', 'export')
            cycles = float(body.get('cycles', 64))
            cps    = float(body.get('cps', 0.5))
            if not code: return self._json(400, {'error': 'code required'})
            # Write code to tmp, call midi-export.ts which uses the renderer-page to queryArc
            tmp_js = f'/tmp/_midi_{int(time.time()*1000)}.js'
            open(tmp_js, 'w').write(code)
            out_mid = f'/tmp/_midi_{int(time.time()*1000)}.mid'
            p = subprocess.run(
                ['/usr/bin/env', 'pnpm', '-s', 'exec', 'tsx', 'src/midi-export.ts', tmp_js, out_mid, str(cycles), str(cps)],
                cwd=os.path.join(ROOT, 'apps/cli'),
                timeout=300, capture_output=True, text=True
            )
            if not os.path.exists(out_mid):
                return self._json(500, {'error': 'midi-export failed', 'stdout': p.stdout[-2000:], 'stderr': p.stderr[-2000:]})
            data = open(out_mid, 'rb').read()
            self.send_response(200)
            self.send_header('Content-Type', 'audio/midi')
            safe_name = self._safe_download_stem(name)
            self.send_header('Content-Disposition', f'attachment; filename="{safe_name}.mid"')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            try: os.unlink(tmp_js); os.unlink(out_mid)
            except Exception: pass
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- version: page-vs-server staleness self-check --------------------
    def _api_version(self):
        try:
            html_mtime = os.path.getmtime(f'{ROOT}/runtime/main.html')
            srv_mtime  = os.path.getmtime(f'{ROOT}/runtime/serve.py')
            import datetime
            self._json(200, {
                'main_html_build': datetime.datetime.fromtimestamp(html_mtime).strftime('%Y-%m-%d_%H:%M:%S'),
                'serve_py_build':  datetime.datetime.fromtimestamp(srv_mtime).strftime('%Y-%m-%d_%H:%M:%S'),
                'server_started':  datetime.datetime.fromtimestamp(_SERVER_BOOT_TS).strftime('%Y-%m-%d_%H:%M:%S'),
            })
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- in-flight generate jobs (server-tracked, survives SSE disconnect) -
    def _new_gen_job(self, slot, extra):
        job = {'job_id': f'gen-{int(time.time()*1000)}-{slot}', 'pid': None,
               'started_at': time.time(), 'backend': slot,
               'extra': (extra or '')[:80], 'cancelled': False, 'render_proc': None}
        with _gen_jobs_lock:
            _gen_jobs.append(job)
        return job

    def _api_gen_status(self):
        now = time.time()
        with _gen_jobs_lock:
            jobs = [{'job_id': j.get('job_id'), 'source': 'main',
                     'started_at': j['started_at'], 'backend': j['backend'],
                     'extra': j.get('extra', ''), 'runtime': round(now - j['started_at'], 1),
                     'cancelled': j.get('cancelled', False)}
                    for j in _gen_jobs]
        # Merge in the brain's async generation jobs (queued/running) so the UI
        # pill reflects them too — previously they were completely invisible.
        with _brain_gen_jobs_lock:
            for j in _brain_gen_jobs:
                if j.get('status') in ('queued', 'running'):
                    st = j.get('started_at') or j.get('queued_at') or now
                    jobs.append({'job_id': j.get('job_id'), 'source': 'brain',
                                 'started_at': st, 'backend': j.get('slot'),
                                 'extra': j.get('extra', ''), 'runtime': round(now - st, 1),
                                 'status': j.get('status')})
        self._json(200, {'count': len(jobs), 'jobs': jobs})

    def _api_generate_cancel(self):
        """Cancel an in-flight generation server-side: set the cancel flag AND
        killpg the render subprocess if one is running. Body: {job_id} to target
        one, or {} to cancel all. Also cancels matching brain async jobs."""
        try:
            body = self._json_body()
        except Exception:
            body = {}
        jid = (body.get('job_id') or '').strip()
        cancelled = []
        with _gen_jobs_lock:
            for j in _gen_jobs:
                if jid and j.get('job_id') != jid:
                    continue
                j['cancelled'] = True
                proc = j.get('render_proc')
                if proc is not None:
                    self._killpg(proc)
                cancelled.append(j.get('job_id'))
        # Brain async jobs share the same cancel semantics.
        with _brain_gen_jobs_lock:
            for j in _brain_gen_jobs:
                if jid and j.get('job_id') != jid:
                    continue
                if j.get('status') in ('queued', 'running'):
                    j['cancel_requested'] = True
                    proc = j.get('render_proc')
                    if proc is not None:
                        self._killpg(proc)
                    cancelled.append(j.get('job_id'))
        self._json(200, {'ok': True, 'cancelled': cancelled})

    # ---- CC bridge: jsonl helpers ----------------------------------------
    def _read_jsonl(self, path, tail=None):
        if not os.path.exists(path): return []
        st = os.stat(path)
        sig = (getattr(st, 'st_mtime_ns', int(st.st_mtime * 1_000_000_000)), st.st_size)
        key = (path, tail)
        with _jsonl_cache_lock:
            cached = _jsonl_cache.get(key)
            if cached and cached.get('sig') == sig:
                return list(cached.get('rows', []))
        lines = self._tail_jsonl_lines(path, tail)
        out = []
        for l in lines:
            try: out.append(json.loads(l))
            except Exception: pass
        with _jsonl_cache_lock:
            _jsonl_cache[key] = {'sig': sig, 'rows': list(out)}
        return out

    def _read_text_cached(self, path):
        st = os.stat(path)
        sig = (getattr(st, 'st_mtime_ns', int(st.st_mtime * 1_000_000_000)), st.st_size)
        with _text_cache_lock:
            cached = _text_cache.get(path)
            if cached and cached.get('sig') == sig:
                return cached.get('text', '')
        with open(path) as f:
            text = f.read()
        with _text_cache_lock:
            _text_cache[path] = {'sig': sig, 'text': text}
        return text

    def _tail_jsonl_lines(self, path, tail=None):
        if not tail:
            with open(path) as f:
                return [l for l in f if l.strip()]
        # Read bounded chunks from the end so large task/reply logs do not get
        # reparsed in full on every /cc/state poll or SSE update.
        lines = []
        chunk_size = 8192
        with open(path, 'rb') as f:
            f.seek(0, os.SEEK_END)
            pos = f.tell()
            buf = b''
            while pos > 0 and len(lines) <= tail:
                read_size = min(chunk_size, pos)
                pos -= read_size
                f.seek(pos)
                buf = f.read(read_size) + buf
                lines = [l for l in buf.splitlines() if l.strip()]
            return [l.decode('utf-8', errors='replace') for l in lines[-tail:]]

    def _append_jsonl(self, path, obj):
        with open(path, 'a') as f:
            f.write(json.dumps(obj, ensure_ascii=False) + '\n')
        self._invalidate_jsonl_cache(path)

    def _rewrite_jsonl(self, path, items):
        if path == TASKS:
            items = self._prune_bridge_tasks(items)
        body = ''.join(json.dumps(it, ensure_ascii=False) + '\n' for it in items)
        self._atomic_write_text(path, body)

    @staticmethod
    def _prune_bridge_tasks(items, keep_terminal=200):
        active = []
        terminal = []
        for item in items:
            status = item.get('status') if isinstance(item, dict) else None
            if status in ('done', 'failed', 'cancelled'):
                terminal.append(item)
            else:
                active.append(item)
        return active + terminal[-keep_terminal:]

    # ---- CC: combined state (poll target for UI) -------------------------
    def _api_cc_state(self):
        try:
            self._json(200, {
                'inbox':       self._read_jsonl(INBOX,     tail=50),
                'replies':     self._read_jsonl(REPLIES,   tail=50),
                'proposals':   self._read_jsonl(PROPOSALS, tail=50),
                'tasks':       self._read_jsonl(TASKS,     tail=50),
                'transcript':  self._read_jsonl(TRANSCRIPT, tail=TRANSCRIPT_CAP),
                'presets':     PRESET_COMMANDS,
                'cc_awake_marker': os.path.exists(f'{BRIDGE}/.cc-awake') and os.path.getmtime(f'{BRIDGE}/.cc-awake') or 0,
                'kick_pending':    os.path.exists(f'{BRIDGE}/.kick'),
            })
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- CC: SSE long-poll (updates when any bridge file mtime changes) ---
    def _api_cc_stream(self):
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()
            last = 0.0
            paths = [INBOX, REPLIES, PROPOSALS, TASKS, TRANSCRIPT]
            # Bound the loop + send a heartbeat each tick so a dead socket is
            # detected promptly (write fails → break) instead of leaking a worker
            # thread forever when no bridge file changes. Client EventSource just
            # reconnects when we close. (thread-leak fix 2026-05-29.)
            deadline = time.time() + 600  # recycle every 10 min
            while time.time() < deadline:
                try:
                    cur = max(os.path.getmtime(p) for p in paths if os.path.exists(p))
                except ValueError:
                    cur = 0.0
                if cur > last:
                    last = cur
                    payload = {
                        'inbox':       self._read_jsonl(INBOX,     tail=50),
                        'replies':     self._read_jsonl(REPLIES,   tail=50),
                        'proposals':   self._read_jsonl(PROPOSALS, tail=50),
                        'tasks':       self._read_jsonl(TASKS,     tail=50),
                        'transcript':  self._read_jsonl(TRANSCRIPT, tail=TRANSCRIPT_CAP),
                    }
                    self.wfile.write(f'event: state\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n'.encode('utf-8'))
                    self.wfile.flush()
                else:
                    # heartbeat comment — fails fast if the client is gone
                    self.wfile.write(b': hb\n\n'); self.wfile.flush()
                time.sleep(1.0)
        except Exception:
            return  # client disconnected

    # ---- CC: Bowei writes inbox (chat msg or preset trigger) -------------
    def _api_cc_inbox_post(self):
        try:
            body = self._json_body()
            text  = (body.get('text') or '').strip()
            tag   = body.get('tag', 'chat')
            ctx   = body.get('context', {})  # {piece_name, code_excerpt, …}
            if not text and not ctx: return self._json(400, {'error': 'text or context required'})
            entry = {
                'id': f'in-{int(time.time()*1000)}',
                'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
                'tag': tag, 'text': text, 'context': ctx,
                'status': 'pending',
            }
            self._append_jsonl(INBOX, entry)
            # also drop kick marker so Claude Code knows next /check-inbox has new
            with open(f'{BRIDGE}/.kick', 'w') as kf:
                kf.write(str(time.time()))
            self._json(200, {'ok': True, 'entry': entry})
        except Exception as e:
            self._json(500, {'error': str(e)})

    def _cliproxy_api_key(self):
        """CLIProxy API key. Precedence: env (CLIPROXY_API_KEY) > user_config."""
        env_key = os.environ.get('CLIPROXY_API_KEY')
        if env_key:
            return env_key.strip()
        cfg = user_config.load()
        ck = (cfg.get('cliproxy') or {}).get('api_key') or ''
        return ck.strip()

    def _cliproxy_base_url(self):
        cfg = user_config.load()
        return ((cfg.get('cliproxy') or {}).get('base_url') or CLIPROXY_BASE_URL).rstrip('/')

    def _cliproxy_enabled(self):
        cfg = user_config.load()
        return bool((cfg.get('cliproxy') or {}).get('enabled')) and bool(self._cliproxy_api_key())

    def _vendor_key(self, vendor):
        cfg = user_config.load()
        info = (cfg.get('providers') or {}).get(vendor) or {}
        return (info.get('api_key') or '').strip()

    def _vendor_base_url(self, vendor):
        cfg = user_config.load()
        info = (cfg.get('providers') or {}).get(vendor) or {}
        return (info.get('base_url') or user_config.DEFAULTS['providers'][vendor]['base_url']).rstrip('/')

    def _agy_bin_path(self):
        cfg = user_config.load()
        return os.path.expanduser((cfg.get('agy') or {}).get('bin_path') or AGY_BIN)

    def _resolve_slot_route(self, slot):
        """Return how a slot should be dispatched right now.

        Returns dict:
          {'mode': 'cliproxy'|'direct'|'agy'|None,
           'base_url': str | None,
           'api_key':  str | None,
           'model':    str | None,
           'reason':   str  ('' if available, else why unavailable)}

        mode=None means the slot is unavailable.
        """
        info = BACKEND_REGISTRY.get(slot)
        if not info:
            return {'mode': None, 'reason': f'unknown slot {slot!r}'}
        vendor = info['vendor']
        # AGY CLI is its own thing — only binary check
        if vendor == 'agy':
            agy = self._agy_bin_path()
            if not os.path.exists(agy):
                return {'mode': None, 'reason': f'AGY binary not found at {agy}'}
            return {'mode': 'agy', 'base_url': None, 'api_key': None, 'model': None, 'reason': ''}
        # CLIProxy is preferred when enabled + key present
        if self._cliproxy_enabled() and info.get('cliproxy_model'):
            return {
                'mode': 'cliproxy',
                'base_url': self._cliproxy_base_url(),
                'api_key':  self._cliproxy_api_key(),
                'model':    info['cliproxy_model'],
                'reason':   '',
            }
        # Direct vendor API
        key = self._vendor_key(vendor)
        if key and info.get('direct_model'):
            return {
                'mode': 'direct',
                'base_url': self._vendor_base_url(vendor),
                'api_key':  key,
                'model':    info['direct_model'],
                'reason':   '',
            }
        # Neither path available
        return {
            'mode': None,
            'reason': f'No {vendor.title()} API key set; or enable CLIProxy in Settings.'
        }

    def _corpus_tail_context(self, n=14):
        try:
            rows = self._read_jsonl(MANIFEST, tail=n)
            compact = []
            for e in rows:
                compact.append({
                    'i': e.get('i'), 'name': e.get('name'), 'score_bowei': e.get('score_bowei'),
                    'generation_issue': e.get('generation_issue'), 'dur': e.get('dur'),
                    'extra': (e.get('extra') or '')[:120],
                })
            return compact
        except Exception:
            return []

    # OpenAI standard function-calling schema — CLIProxy converts to Anthropic
    # tool-use format. Brain emits tool_calls; we execute and feed back as
    # role:"tool" messages.
    BRAIN_TOOLS = [
        {
            'type': 'function',
            'function': {
                'name': 'generate_piece',
                'description': (
                    'Synthesize a complete Strudel piece via a chosen backend. '
                    'ASYNC fire-and-forget: returns IMMEDIATELY with a job_id '
                    'and queue_depth. The actual generation runs in background '
                    '(~2-4 min each, max 3 concurrent). For batch tasks ("one '
                    'per preset"), fire all calls in a single turn, then use '
                    'check_gen_status or list_recent to monitor results. '
                    'The "extra" arg is a multi-line envelope similar to Bowei\'s '
                    'Advanced panel: a leading line like "Style envelope they\'re '
                    'after: <Label>." then BPM, key, mood, groove, references.'
                ),
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'slot': {
                            'type': 'string',
                            'enum': ['gpt-5.5','gpt-5.5x','opus-4.8','gemini-flash','gemini-pro','grok-build'],
                            'description': 'Which backend to use. gpt-5.5 (purple, OpenAI fast), gpt-5.5x (deep purple, OpenAI xhigh), opus-4.8 (orange, Anthropic), gemini-flash (sky, Google fast), gemini-pro (deep blue, Google deep), grok-build (silver, xAI). agy-cli is NOT available via tools.',
                        },
                        'extra': {
                            'type': 'string',
                            'description': 'Full advanced-prompt envelope (style + BPM + key + mood + groove + references). Be specific about what you want; leave Strudel code to the backend.',
                        },
                    },
                    'required': ['slot', 'extra'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'check_gen_status',
                'description': 'Check status of all brain-fired generate_piece jobs. Returns counts (queued/running/done/failed) + per-job state. Use after firing a batch to see progress.',
                'parameters': {'type': 'object', 'properties': {}},
            },
        },
        # ── Piece operations (catalog UX parity) ──────────────────────
        {
            'type': 'function',
            'function': {
                'name': 'rename_piece',
                'description': 'Rename a piece. Renames JS + MP3 + prompt files on disk and rewrites corpus entry. Use new_name without extension.',
                'parameters': {'type': 'object', 'properties': {
                    'old_name': {'type': 'string'},
                    'new_name': {'type': 'string'},
                }, 'required': ['old_name', 'new_name']},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'delete_piece',
                'description': ('PERMANENTLY remove a piece (corpus row + js + mp3 + prompt files). '
                    'IRREVERSIBLE, server-enforced two-call confirm: the FIRST call (name + confirm=name) '
                    'returns a confirm_nonce and does NOT delete — you must get Bowei\'s explicit OK in chat, '
                    'THEN call again with the same name + confirm + confirm_nonce. To merely hide a piece use archive_piece.'),
                'parameters': {'type': 'object', 'properties': {
                    'name':    {'type': 'string'},
                    'confirm': {'type': 'string', 'description': 'Must equal name as a guard'},
                    'confirm_nonce': {'type': 'string', 'description': 'The nonce returned by the first call; only present on the confirming second call'},
                }, 'required': ['name', 'confirm']},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'update_piece_code',
                'description': 'Overwrite a piece\'s Strudel code and re-render its mp3 + record revision. Use for "make X louder" / "swap kick" type edits to existing pieces.',
                'parameters': {'type': 'object', 'properties': {
                    'name': {'type': 'string'},
                    'code': {'type': 'string', 'description': 'Complete new code'},
                }, 'required': ['name', 'code']},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'get_piece_prompt',
                'description': 'Read the original generation prompt for a piece (the .txt snapshot under producer-brain/prompts/).',
                'parameters': {'type': 'object', 'properties': {
                    'name': {'type': 'string'},
                }, 'required': ['name']},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'get_piece_revisions',
                'description': 'Read the revision history of one piece (list of {ts, source, intent, before/after} entries).',
                'parameters': {'type': 'object', 'properties': {
                    'name': {'type': 'string'},
                }, 'required': ['name']},
            },
        },
        # ── Settings ──────────────────────────────────────────────────
        {
            'type': 'function',
            'function': {
                'name': 'get_backends_status',
                'description': 'Return per-slot availability (mode/reason) for all 7 backends — like /api/backends.',
                'parameters': {'type': 'object', 'properties': {}},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'get_settings',
                'description': 'Return current user_config (API keys masked). Use to inspect current backend URLs, modes, etc.',
                'parameters': {'type': 'object', 'properties': {}},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'update_settings',
                'description': 'Update one or more user_config fields. Pass a partial dict matching the schema (e.g. {"validator": {"mode": "off"}} or {"providers": {"openai": {"api_key": "sk-…"}}}). API keys are persisted to ~/.cactus-strudel/config.json mode 0600.',
                'parameters': {'type': 'object', 'properties': {
                    'patch': {'type': 'object', 'description': 'Partial config dict to merge in. See docs/SETTINGS.md for schema.'},
                }, 'required': ['patch']},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'test_backend',
                'description': 'Probe connectivity of one backend ("cliproxy" | "agy" | "openai" | "anthropic" | "google" | "xai"). Returns ok + detail (e.g. "47 models").',
                'parameters': {'type': 'object', 'properties': {
                    'target': {'type': 'string', 'enum': ['cliproxy','agy','openai','anthropic','google','xai']},
                }, 'required': ['target']},
            },
        },
        # ── Persistent memory ─────────────────────────────────────────
        {
            'type': 'function',
            'function': {
                'name': 'read_scratchpad',
                'description': 'Read developer/brain-scratchpad.md — your persistent notes that survive across chat sessions. Use at start of complex tasks to recall prior context.',
                'parameters': {'type': 'object', 'properties': {}},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'append_scratchpad',
                'description': 'Append text to developer/brain-scratchpad.md (auto-timestamped). Use for things you want to remember next session: open questions, current plan, observations, TODOs.',
                'parameters': {'type': 'object', 'properties': {
                    'note': {'type': 'string', 'description': 'Markdown text to append. Will be prefixed by a "## YYYY-MM-DD HH:MM" header.'},
                }, 'required': ['note']},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'list_recent',
                'description': 'Return the N most recent corpus entries (pieces in the local CactusStrudel music library).',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'n': {'type': 'integer', 'description': 'How many entries (max 30)', 'default': 10},
                    },
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'get_piece_code',
                'description': 'Fetch the Strudel JavaScript code of a specific piece by name.',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'name': {'type': 'string', 'description': 'Piece name, e.g. "CHP-001" or "DB-002"'},
                    },
                    'required': ['name'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'search_corpus',
                'description': 'Free-text search across piece name + genre + note + extra fields.',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'q': {'type': 'string', 'description': 'Search query'},
                        'limit': {'type': 'integer', 'description': 'Max results (default 10)', 'default': 10},
                    },
                    'required': ['q'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'score_piece',
                'description': 'Record Bowei\'s score (1-10) and optional note on a piece. Use sparingly — only when Bowei explicitly asks.',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'name': {'type': 'string'},
                        'score': {'type': 'number', 'description': '1.0 - 10.0'},
                        'note': {'type': 'string', 'description': 'Optional Chinese/English note'},
                    },
                    'required': ['name', 'score'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'add_spine_entry',
                'description': (
                    'Record a failure-pattern observation into the failure-spine knowledge base. '
                    'Call this when Bowei observes something doesn\'t work ("kick anemic again", '
                    '"this lo-fi feels too busy", "lead vibrato sounds detuned"), OR when he '
                    'explicitly says "save this pattern". Each entry captures: what was heard, '
                    'why it likely happened, an actionable avoid-rule for future generation, '
                    'and which piece(s) triggered it. Append-only — entries can later be marked '
                    'validated/rejected/fixed via update_spine_status.'
                ),
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'symptom_heard': {'type': 'string', 'description': 'What Bowei observed — quote his words verbatim where possible'},
                        'root_cause':    {'type': 'string', 'description': 'Your diagnosis of why this happened (musical / Strudel-engineering)'},
                        'avoid_rule':    {'type': 'string', 'description': 'Actionable rule for future generation — something a generator can use'},
                        'evidence':      {'type': 'string', 'description': 'Which piece(s) + date triggered this. Reference by name (CHP-001, DB-002, etc.) so the spine page can link them.'},
                        'status': {
                            'type': 'string',
                            'enum': ['exploratory', 'baseline', 'validated', 'rejected', 'fixed', 'rolled-back'],
                            'description': 'Initial status. Use "exploratory" for fresh hypotheses; "baseline" for one-off observations; "validated"/"rejected"/"fixed" only after multi-piece confirmation.',
                            'default': 'exploratory',
                        },
                    },
                    'required': ['symptom_heard', 'avoid_rule', 'evidence'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'update_spine_status',
                'description': (
                    'Update the status of an existing failure-spine entry. Use when Bowei '
                    'confirms ("yes that fixed it" → fixed), rejects ("actually it sounds worse" '
                    '→ rejected), or rolls back ("revert that, was wrong" → rolled-back) a '
                    'pattern. Also records the reason for the transition for audit trail.'
                ),
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'id':         {'type': 'string', 'description': 'Spine entry id like "fs-021"'},
                        'new_status': {
                            'type': 'string',
                            'enum': ['exploratory', 'baseline', 'validated', 'rejected', 'fixed', 'rolled-back'],
                        },
                        'reason':     {'type': 'string', 'description': 'Short note on why this transition (1-2 sentences)'},
                    },
                    'required': ['id', 'new_status'],
                },
            },
        },
        # ── Expanded normal-mode tools (corpus housekeeping) ────────────
        {
            'type': 'function',
            'function': {
                'name': 'archive_piece',
                'description': 'Soft-archive a piece (hides from default view, files preserved). Use when Bowei says "归档 X" or "把这条收起来".',
                'parameters': {
                    'type': 'object',
                    'properties': { 'name': {'type': 'string'} },
                    'required': ['name'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'update_piece_note',
                'description': 'Set Bowei\'s note on a piece (no score change). Use when capturing his listening commentary.',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'name': {'type': 'string'},
                        'note': {'type': 'string'},
                    },
                    'required': ['name', 'note'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'list_spine',
                'description': 'List failure-spine entries. Optionally filter by status or free-text search. Use to check what patterns are already recorded before adding a new one.',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'status': {'type': 'string', 'description': 'Optional status filter (validated/fixed/rejected/etc.)'},
                        'q': {'type': 'string', 'description': 'Optional free-text search across id/symptom/rule/evidence (e.g. "kick").'},
                        'limit': {'type': 'integer', 'description': 'Max entries (default 20)', 'default': 20},
                    },
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'read_kernel_fragment',
                'description': 'Read the content of one kernel fragment (the prompt sources that drive generation). Read-only — to edit, Bowei uses Settings UI. Useful for diagnosing why output looks a certain way.',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'name': {'type': 'string', 'description': 'e.g. "00-identity.md", "40-creative-freedom.md", "style/jazz-house.md"'},
                    },
                    'required': ['name'],
                },
            },
        },
        # ── CC bridge: proposals / tasks / preset commands ────────────
        {
            'type': 'function',
            'function': {
                'name': 'list_proposals',
                'description': 'List Claude-Code-bridge proposals (the Proposals tab). Optionally filter by status (pending/accepted/rejected).',
                'parameters': {'type': 'object', 'properties': {
                    'status': {'type': 'string', 'description': 'Optional: pending/accepted/rejected'},
                }},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'decide_proposal',
                'description': 'Accept or reject a CC proposal by id (same as clicking the Proposals tab buttons). Kicks CC to act on the decision.',
                'parameters': {'type': 'object', 'properties': {
                    'id': {'type': 'string'},
                    'action': {'type': 'string', 'enum': ['accept', 'reject']},
                    'note': {'type': 'string', 'description': 'Optional decision note'},
                }, 'required': ['id', 'action']},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'list_tasks',
                'description': 'List Claude-Code task-queue entries (the Tasks tab). Optionally filter by status.',
                'parameters': {'type': 'object', 'properties': {
                    'status': {'type': 'string', 'description': 'Optional status filter'},
                }},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'run_preset_command',
                'description': 'Fire one of the configured CC preset commands (the Commands tab): recheck-latest, spine-scan, diff-strongest, guideline-audit. Writes the preset into the CC inbox and kicks CC.',
                'parameters': {'type': 'object', 'properties': {
                    'id': {'type': 'string', 'enum': ['recheck-latest', 'spine-scan', 'diff-strongest', 'guideline-audit']},
                }, 'required': ['id']},
            },
        },
        # ── archive-v0 (frozen legacy) read access ────────────────────
        {
            'type': 'function',
            'function': {
                'name': 'get_archived_piece',
                'description': 'Read a frozen archive-v0 piece (the 104 legacy pieces, not counted toward active corpus). Omit name to list available names; pass name to fetch one entry + its code.',
                'parameters': {'type': 'object', 'properties': {
                    'name': {'type': 'string', 'description': 'Archived piece name; omit to list'},
                }},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'get_archived_spine',
                'description': 'Read a frozen archive-v0 failure-spine entry (the 20 legacy spine entries). Omit id to list ids; pass id to fetch one.',
                'parameters': {'type': 'object', 'properties': {
                    'id': {'type': 'string', 'description': 'Archived spine id; omit to list'},
                }},
            },
        },
        # ── multi-step planning state (survives chat-history truncation) ─
        {
            'type': 'function',
            'function': {
                'name': 'set_plan',
                'description': 'Write/overwrite a persistent multi-step plan. Use at the START of any complex task so you survive chat-history truncation: record goal + ordered steps. On later turns, re-read with get_plan or rewrite with steps marked done.',
                'parameters': {'type': 'object', 'properties': {
                    'goal': {'type': 'string'},
                    'steps': {'type': 'array', 'description': 'List of step strings, OR objects {step, done}.',
                              'items': {'type': ['string', 'object']}},
                }, 'required': ['goal', 'steps']},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'get_plan',
                'description': 'Read the current persistent plan (goal + steps + done/total progress). Call this at the start of a turn when resuming a multi-step task.',
                'parameters': {'type': 'object', 'properties': {}},
            },
        },
        # ── workbench parity: cancel / fork / midi ────────────────────
        {
            'type': 'function',
            'function': {
                'name': 'cancel_generation',
                'description': 'Cancel a queued/running brain generation job. Pass job_id (from check_gen_status) to target one, or omit to cancel all in-flight. Queued jobs drop immediately; a render already in subprocess finishes.',
                'parameters': {'type': 'object', 'properties': {
                    'job_id': {'type': 'string', 'description': 'Optional; omit to cancel all queued/running'},
                }},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'save_piece_as_new',
                'description': 'Fork an existing piece into a NEW corpus entry. Pass source_name (required) and optionally code (the edited Strudel; defaults to the source code). Renders + registers with parent lineage set.',
                'parameters': {'type': 'object', 'properties': {
                    'source_name': {'type': 'string'},
                    'code': {'type': 'string', 'description': 'Optional edited code; defaults to source code'},
                }, 'required': ['source_name']},
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'export_midi',
                'description': "Export a piece's pattern to a .mid file (same as the workbench MIDI export). Pass the piece name.",
                'parameters': {'type': 'object', 'properties': {
                    'name': {'type': 'string'},
                }, 'required': ['name']},
            },
        },
        # ── Developer Mode tools (gated by user_config.developer.enabled) ──
        # These appear in the tool list ALWAYS, but the implementations refuse
        # to run when dev mode is off. This way the brain knows they exist and
        # can prompt Bowei to enable dev mode when needed.
        {
            'type': 'function',
            'function': {
                'name': 'dev_read_file',
                'description': '[DEV MODE] Read any file in the repo. Requires Developer Mode enabled in Settings. Use for understanding code before editing.',
                'parameters': {
                    'type': 'object',
                    'properties': { 'path': {'type': 'string', 'description': 'Relative to repo root (e.g. "runtime/serve.py") or absolute under ROOT'} },
                    'required': ['path'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'dev_write_file',
                'description': '[DEV MODE] Write a file. Default sandbox: writes ONLY to producer-brain/, developer/, /tmp/. To write to repo source (runtime/, scripts/, docs/, settings.html, etc.) Bowei must enable Settings → "Write override". Read the file first if overwriting.',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'path': {'type': 'string'},
                        'content': {'type': 'string'},
                    },
                    'required': ['path', 'content'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'dev_apply_patch',
                'description': '[DEV MODE] Surgical edit. Default sandbox: producer-brain/, developer/, /tmp/ only. Software source (runtime/, etc.) needs Bowei to enable "Write override". old_string must be unique.',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'path': {'type': 'string'},
                        'old_string': {'type': 'string'},
                        'new_string': {'type': 'string'},
                    },
                    'required': ['path', 'old_string', 'new_string'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'dev_run_bash',
                'description': '[DEV MODE — write_override gated] Run a shell command. Requires Bowei to enable Settings → "Write override". For read-only inspection (grep, ls, cat) prefer dev_read_file / dev_list_dir. NEVER sudo. NEVER git push.',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'command': {'type': 'string', 'description': 'Bash command to run from ROOT'},
                        'timeout_sec': {'type': 'integer', 'description': 'Default 60, max 600', 'default': 60},
                    },
                    'required': ['command'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'dev_list_dir',
                'description': '[DEV MODE] List directory contents (like ls -la). Requires Developer Mode.',
                'parameters': {
                    'type': 'object',
                    'properties': { 'path': {'type': 'string', 'description': 'Relative to repo root or absolute under ROOT'} },
                    'required': ['path'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': 'dev_create_checkpoint',
                'description': '[DEV MODE] Create a producer-brain checkpoint via bin/checkpoint-create. Use BEFORE substantive architectural changes and AFTER finishing them.',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'name': {'type': 'string', 'description': 'e.g. "36-spine-page-rework"'},
                        'description': {'type': 'string', 'description': 'One-line description'},
                    },
                    'required': ['name', 'description'],
                },
            },
        },
    ]

    BRAIN_TOOL_HINT = (
        'You have tools available (see the OpenAI function-calling schema). '
        'When Bowei asks you to generate / list / search / score / inspect a '
        'piece, CALL THE TOOL rather than describing what should be done.\n\n'
        '🚨 CRITICAL — NO FABRICATED RESULTS. You do NOT have the contents of '
        'the scratchpad, the plan, any file, any piece code/prompt/revisions, '
        'the settings, or the backend status in your context. Your chat history '
        'shows what you SAID before, not the live state. NEVER report a value, '
        'a write success, a byte count, a read result, a score, a note update, '
        'a backend ping, or any file content that you did not obtain from an '
        'ACTUAL tool call in THIS turn. If an operation has a matching tool, you '
        'MUST call it before answering:\n'
        '  • "记一条/写到 scratchpad" → append_scratchpad (then report)\n'
        '  • "读 scratchpad / 上次写了啥" → read_scratchpad (NEVER recall from history)\n'
        '  • "打分/score" → score_piece     • "改 note" → update_piece_note\n'
        '  • "测 backend / 连得上吗" → test_backend (do NOT infer from "we are talking")\n'
        '  • "prompt 是啥" → get_piece_prompt   • "改动记录" → get_piece_revisions\n'
        'Answering a state question without the tool call — even if you think you '
        'remember the answer — is a critical failure. When in doubt, call the tool.\n\n'
        'Hard limits: tools do NOT mutate repo source files (runtime/, scripts/, '
        'docs/, bin/, archive-gf/, producer-brain/kernel/). If Bowei asks for '
        'something outside these limits, refuse politely and explain.\n\n'
        'Reply after tool use: one short Chinese sentence reporting the result. '
        'Don\'t paste full code unless asked.'
    )

    def _brain_memory_messages(self):
        pilot = ''
        try:
            pilot = self._read_text_cached(OPUS_PILOT_DOC)
        except Exception as e:
            pilot = f'Pilot doc unavailable: {e}'
        sys_content = (
            f'{self.BRAIN_TOOL_HINT}\n\n'
            f'──────── PILOT DOC ────────\n\n'
            f'{pilot}\n\n'
            f'──────── RECENT CORPUS TAIL ────────\n\n'
            f'{json.dumps(self._corpus_tail_context(), ensure_ascii=False)}'
        )
        hist = self._read_jsonl(BRAIN_HISTORY, tail=24)
        messages = [{'role': 'system', 'content': sys_content}]
        for h in hist:
            role = h.get('role')
            if role in ('user', 'assistant') and h.get('content'):
                messages.append({'role': role, 'content': h['content']})
        return messages

    # ── Brain tool execution ─────────────────────────────────────────────
    def _parse_brain_tool_calls(self, text):
        """Extract <tool name="X">...</tool> blocks. Returns list of {name, args}."""
        out = []
        pattern = re.compile(r'<tool\s+name="([^"]+)"\s*>\s*([\s\S]*?)\s*</tool>', re.I)
        for m in pattern.finditer(text or ''):
            name = m.group(1).strip()
            raw = m.group(2).strip()
            # Strip fenced ```json``` wrapping if present
            raw = re.sub(r'^```(?:json)?\s*', '', raw)
            raw = re.sub(r'\s*```$', '', raw)
            try:
                args = json.loads(raw) if raw else {}
            except Exception as e:
                args = {'_parse_error': str(e), '_raw': raw[:200]}
            out.append({'name': name, 'args': args, 'raw': m.group(0)})
        return out

    # Confabulation guard. Only consulted when ZERO tools ran this turn (so
    # legitimate tool-using answers are never touched). Fires if the final
    # answer either CLAIMS a completed mutation or ASSERTS a fact about live
    # tracked state — both of which the brain cannot know without a tool call.
    _CONFAB_CLAIM = re.compile(
        r'(已打分|已评分|打了\s*[\d.]+\s*分|给.{0,8}打了|已更新|已改好|已改成|已修改|'
        r'已写入|已记录|已记下|已保存|已渲染|已生成|已归档|已删除|已重命名|已导出|'
        r'已设置|已设为|已加上|已添加|已备份|已 fork|已 rename|'
        r'\b(updated|saved|renamed|deleted|archived|exported|recorded|noted)\b)',
        re.I)
    _CONFAB_NOOP = re.compile(r'(无需修改|无需改动|已经是|不需要修改|不用改|没有变化|无变化)')

    # The USER asking about live state the brain can't know without a tool. Drives
    # the read-confab guard off QUESTION INTENT (precise) rather than scanning the
    # answer surface for bare IDs/counts (which false-fired on normal music advice
    # like "加 2 个 pad" and on the brain's prescribed "cite piece names"). 2026-05-29.
    _CONFAB_INTENT = re.compile(
        r'(scratchpad|便签|\bplan\b|计划|prompt|提示词|revision|改动记录|改过|'
        r'proposal|提案|\btask|任务|队列|\bspine\b|失败.?谱|fs-\d|'
        r'多少首|多少条|几首|几条|corpus.{0,6}(多少|几)|最近.{0,6}(首|条|piece)|'
        r'\bbackend|连得上|连不连|可用|当前.{0,6}(配置|设置)|validator\s*mode)', re.I)

    def _claims_unbacked_mutation(self, text):
        """True when a zero-tool answer asserts a completed MUTATION (打分/改 note/
        写 scratchpad/归档/…). Precise verb match; excludes legit no-ops."""
        if not text: return False
        t = text.strip()
        if self._CONFAB_NOOP.search(t):
            return False  # "已经是 heavy，无需修改" — legitimate no-op, not a claim
        return bool(self._CONFAB_CLAIM.search(t))

    def _should_force_tool(self, user_text, answer):
        """Confab guard signal (only consulted on a ZERO-tool turn): fire if the
        answer claims a mutation, OR the USER asked a live-state question and the
        brain answered substantively without calling any tool. Skips clarifying
        questions back to the user (those aren't fabrications)."""
        a = (answer or '').strip()
        if not a:
            return False
        if self._claims_unbacked_mutation(a):
            return True
        if self._CONFAB_INTENT.search(user_text or ''):
            if a.endswith('?') or a.endswith('？') or '吗？' in a or '需要我' in a or len(a) < 4:
                return False  # brain is asking back / trivial — not a fabricated assertion
            return True
        return False

    def _exec_brain_tool(self, name, args):
        """Execute one tool call. Returns dict result (will be JSON-serialized
        back to the brain). Catches exceptions and returns {ok:false, error}."""
        try:
            if name == 'generate_piece':
                return self._brain_tool_generate_piece(args)
            if name == 'list_recent':
                return self._brain_tool_list_recent(args)
            if name == 'check_gen_status':
                return self._brain_tool_check_gen_status(args)
            if name == 'rename_piece':         return self._brain_tool_rename_piece(args)
            if name == 'delete_piece':         return self._brain_tool_delete_piece(args)
            if name == 'update_piece_code':    return self._brain_tool_update_piece_code(args)
            if name == 'get_piece_prompt':     return self._brain_tool_get_piece_prompt(args)
            if name == 'get_piece_revisions':  return self._brain_tool_get_piece_revisions(args)
            if name == 'get_backends_status':  return self._brain_tool_get_backends_status(args)
            if name == 'get_settings':         return self._brain_tool_get_settings(args)
            if name == 'update_settings':      return self._brain_tool_update_settings(args)
            if name == 'test_backend':         return self._brain_tool_test_backend(args)
            if name == 'read_scratchpad':      return self._brain_tool_read_scratchpad(args)
            if name == 'append_scratchpad':    return self._brain_tool_append_scratchpad(args)
            if name == 'get_piece_code':
                return self._brain_tool_get_piece_code(args)
            if name == 'search_corpus':
                return self._brain_tool_search_corpus(args)
            if name == 'score_piece':
                return self._brain_tool_score_piece(args)
            if name == 'add_spine_entry':
                return self._brain_tool_add_spine_entry(args)
            if name == 'update_spine_status':
                return self._brain_tool_update_spine_status(args)
            # Expanded normal-mode
            if name == 'archive_piece':       return self._brain_tool_archive_piece(args)
            if name == 'update_piece_note':   return self._brain_tool_update_piece_note(args)
            if name == 'list_spine':          return self._brain_tool_list_spine(args)
            if name == 'read_kernel_fragment':return self._brain_tool_read_kernel_fragment(args)
            # CC bridge + archive + planning + workbench parity
            if name == 'list_proposals':      return self._brain_tool_list_proposals(args)
            if name == 'decide_proposal':     return self._brain_tool_decide_proposal(args)
            if name == 'list_tasks':          return self._brain_tool_list_tasks(args)
            if name == 'run_preset_command':  return self._brain_tool_run_preset_command(args)
            if name == 'get_archived_piece':  return self._brain_tool_get_archived_piece(args)
            if name == 'get_archived_spine':  return self._brain_tool_get_archived_spine(args)
            if name == 'set_plan':            return self._brain_tool_set_plan(args)
            if name == 'get_plan':            return self._brain_tool_get_plan(args)
            if name == 'cancel_generation':   return self._brain_tool_cancel_generation(args)
            if name == 'save_piece_as_new':   return self._brain_tool_save_piece_as_new(args)
            if name == 'export_midi':         return self._brain_tool_export_midi(args)
            # Developer mode (gated)
            if name in ('dev_read_file', 'dev_write_file', 'dev_apply_patch',
                        'dev_run_bash', 'dev_list_dir', 'dev_create_checkpoint'):
                cfg = user_config.load()
                if not (cfg.get('developer') or {}).get('enabled'):
                    return {'ok': False, 'error': 'Developer Mode is OFF. Bowei needs to enable it in Settings (toggle then Save) before this tool can run.'}
                self._dev_audit(name, args)
                if name == 'dev_read_file':       return self._brain_tool_dev_read_file(args)
                if name == 'dev_write_file':      return self._brain_tool_dev_write_file(args)
                if name == 'dev_apply_patch':     return self._brain_tool_dev_apply_patch(args)
                if name == 'dev_run_bash':        return self._brain_tool_dev_run_bash(args)
                if name == 'dev_list_dir':        return self._brain_tool_dev_list_dir(args)
                if name == 'dev_create_checkpoint': return self._brain_tool_dev_create_checkpoint(args)
            return {'ok': False, 'error': f'unknown tool: {name}'}
        except Exception as e:
            return {'ok': False, 'error': f'{type(e).__name__}: {e}'}

    def _brain_tool_generate_piece(self, args):
        """ASYNC fire-and-forget generation. Returns IMMEDIATELY with a job_id.
        The actual generation (CLIProxy call → validator → render → corpus
        append) runs in a background thread, capped at _BRAIN_GEN_CONCURRENCY
        concurrent jobs. Brain can fire 30+ tools in one chat round without
        blocking, and use list_recent to watch results land."""
        slot = args.get('slot') or 'gpt-5.5'
        extra = args.get('extra') or ''
        info = BACKEND_REGISTRY.get(slot)
        if not info:
            return {'ok': False, 'error': f'unknown slot: {slot}'}
        if info['vendor'] == 'agy':
            return {'ok': False, 'error': 'agy-cli not callable from brain tool (uses separate async queue); pick a vendor slot'}
        route = self._resolve_slot_route(slot)
        if route['mode'] is None:
            return {'ok': False, 'error': route['reason']}

        job_id = f'bgen-{int(time.time()*1000)}-{slot}'
        job_rec = {
            'job_id': job_id, 'slot': slot,
            'extra': extra[:80], 'queued_at': time.time(),
            'status': 'queued', 'render_proc': None,
        }
        with _brain_gen_jobs_lock:
            _brain_gen_jobs.append(job_rec)
            queue_depth = sum(1 for j in _brain_gen_jobs if j['status'] in ('queued', 'running'))

        # Capture context for background thread
        kernel = self._read_compiled_kernel()
        model = route['model']
        vendor = info['vendor']
        base_url = route['base_url']
        api_key = route['api_key']
        mode = route['mode']
        prompt_snapshot = (
            f'# brain-tool: generate_piece (async)\n'
            f'# slot: {slot}  (mode: {mode})\n# model: {model}\n'
            f'# kernel hash: {kernel["hash"]}\n\n{kernel["text"]}'
        )
        if extra: prompt_snapshot += f'\n\nPROMPT_EXTRA:\n{extra}'
        user_content = f"""You are the CactusStrudel generator.

Return exactly one fenced ```javascript code block containing a complete executable Strudel piece.
Do not explain. The final expression must evaluate to a Strudel Pattern. Include setcpm(.../4).

{kernel["text"]}

PROMPT_EXTRA:
{extra or '(none)'}
"""

        def _set_status(status, **extras):
            with _brain_gen_jobs_lock:
                for j in _brain_gen_jobs:
                    if j['job_id'] == job_id:
                        j['status'] = status
                        j.update(extras)
                        break
                # Prune terminal jobs so the list can't grow unbounded across a
                # long session (keep all active + the last 50 done/failed).
                if status in ('done', 'failed'):
                    terminal = [j for j in _brain_gen_jobs if j['status'] in ('done', 'failed')]
                    if len(terminal) > 50:
                        drop = set(id(j) for j in terminal[:-50])
                        _brain_gen_jobs[:] = [j for j in _brain_gen_jobs if id(j) not in drop]

        def _cancelled():
            with _brain_gen_jobs_lock:
                for j in _brain_gen_jobs:
                    if j['job_id'] == job_id:
                        return bool(j.get('cancel_requested'))
            return False

        def _bg():
            with _brain_gen_sem:
                # Honor a cancel that arrived while we were queued behind the semaphore.
                if _cancelled():
                    _set_status('failed', finished_at=time.time(), error='cancelled before start')
                    print(f'[brain bg gen] {job_id} cancelled before start')
                    return
                _set_status('running', started_at=time.time())
                try:
                    if mode == 'cliproxy':
                        req_body = json.dumps({
                            'model': model,
                            'messages': [{'role': 'user', 'content': user_content}],
                            'max_tokens': 4096,
                        }).encode('utf-8')
                        req = urllib.request.Request(
                            f'{base_url}/chat/completions', data=req_body,
                            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                            method='POST',
                        )
                        with urllib.request.urlopen(req, timeout=300) as resp:
                            resp_body = resp.read().decode('utf-8')
                        output = json.loads(resp_body)['choices'][0]['message']['content']
                    else:
                        output = self._call_direct_vendor(vendor, base_url, api_key, model, user_content)
                    code = self._extract_strudel_code(output)
                    sink = []
                    def emit(event, data):
                        sink.append({'event': event, 'data': data})
                    entry = self._render_and_register(
                        code=code, prompt_snapshot=prompt_snapshot,
                        extra=extra, slot=slot, emit=emit, gen_job=job_rec,
                    )
                    if entry:
                        _set_status('done', finished_at=time.time(),
                                    piece_name=entry['name'],
                                    genre_label=entry.get('genre_label'))
                        print(f'[brain bg gen] {job_id} → {entry["name"]}')
                    else:
                        last_err = ''
                        for s in sink[-5:]:
                            if s['event'] == 'error': last_err = s['data'].get('error', '')[:200]
                        _set_status('failed', finished_at=time.time(),
                                    error=f'render/register failed: {last_err}')
                        print(f'[brain bg gen] {job_id} render failed: {last_err}')
                except Exception as e:
                    _set_status('failed', finished_at=time.time(), error=str(e)[:200])
                    print(f'[brain bg gen] {job_id} exception: {e}')

        threading.Thread(target=_bg, daemon=True).start()
        return {
            'ok': True,
            'queued': True,
            'job_id': job_id,
            'slot': slot,
            'queue_depth': queue_depth,
            'note': f'Generation queued; runs in background (~2-4 min each, {_BRAIN_GEN_CONCURRENCY} concurrent max). Use list_recent or check_gen_status to monitor.',
        }

    def _brain_tool_check_gen_status(self, args):
        """Return current state of brain-generated jobs (queued / running / done / failed)."""
        with _brain_gen_jobs_lock:
            jobs = [dict(j) for j in _brain_gen_jobs]
        # Trim oldest done/failed if list gets long
        counts = {'queued': 0, 'running': 0, 'done': 0, 'failed': 0}
        for j in jobs:
            counts[j['status']] = counts.get(j['status'], 0) + 1
        # Don't return full list — too verbose. Summarize + show only active/recent.
        active = [j for j in jobs if j['status'] in ('queued', 'running')]
        recent_done = [j for j in jobs if j['status'] in ('done', 'failed')][-10:]
        return {
            'ok': True,
            'counts': counts,
            'active': active,
            'recent_completed': recent_done,
        }

    # ── Piece operations ──────────────────────────────────────────────
    def _brain_tool_rename_piece(self, args):
        old_name = (args.get('old_name') or '').strip()
        new_name = (args.get('new_name') or '').strip()
        if not old_name or not new_name:
            return {'ok': False, 'error': 'old_name + new_name required'}
        with _manifest_lock:
            rows = self._manifest_entries()
            target = next((r for r in rows if r.get('name') == old_name), None)
            if not target: return {'ok': False, 'error': f'piece not found: {old_name}'}
            # Clean & build final name with i prefix preserved
            idx = target.get('i')
            clean = re.sub(r'^(0*' + re.escape(str(idx)) + r'[-\s_]*)', '', new_name)
            clean = re.sub(r'[^\w\-]', '_', clean).strip('_')
            final = clean if clean else new_name
            # Rename files
            renames = {}
            for key in ('js', 'mp3', 'prompt', 'prompt_json'):
                old_rel = target.get(key)
                if not old_rel: continue
                old_abs = os.path.join(ROOT, old_rel) if not old_rel.startswith('/') else old_rel
                ext = os.path.splitext(old_abs)[1]
                new_basename = f'gemini_auto_renamed_{final}_{int(time.time()*1000)}{ext}'
                new_dir = os.path.dirname(old_abs)
                new_abs = os.path.join(new_dir, new_basename)
                if os.path.exists(old_abs):
                    os.rename(old_abs, new_abs)
                    target[key] = new_abs.replace(ROOT + '/', '')
                    renames[key] = target[key]
            target['name'] = final
            self._write_manifest_entries(rows)
        return {'ok': True, 'old_name': old_name, 'new_name': final, 'renamed_paths': renames}

    def _brain_tool_delete_piece(self, args):
        """Two-phase, server-enforced (irreversible op → hard gate, 2026-05-29):
        the FIRST call only mints a nonce + asks for explicit human confirmation;
        the piece is permanently removed only on a SECOND call carrying that
        nonce. The brain cannot satisfy the nonce on its own first call, so a
        deletion can never happen without a deliberate confirm round-trip."""
        name = (args.get('name') or '').strip()
        confirm = (args.get('confirm') or '').strip()
        nonce = (args.get('confirm_nonce') or '').strip()
        if not name: return {'ok': False, 'error': 'name required'}
        if confirm != name:
            return {'ok': False, 'error': f'confirm must equal name (got {confirm!r})'}
        good = _delete_nonces.get(name)
        fresh = good and (time.time() - good['ts'] < 600)
        if not (nonce and fresh and nonce == good['nonce']):
            new_nonce = f'del-{int(time.time()*1000)}'
            _delete_nonces[name] = {'nonce': new_nonce, 'ts': time.time()}
            return {
                'ok': False, 'requires_human_confirm': True, 'confirm_nonce': new_nonce,
                'error': (f'⚠️ 永久删除「{name}」不可恢复。请先获得 Bowei 的明确确认（在对话里问他），'
                          f'得到肯定答复后，再用同样的 name + confirm + confirm_nonce="{new_nonce}" 调用一次才会真正删除。'
                          f'若只是想隐藏，用 archive_piece（可恢复）。'),
            }
        _delete_nonces.pop(name, None)
        with _manifest_lock:
            rows = self._manifest_entries()
            target = next((r for r in rows if r.get('name') == name), None)
            if not target: return {'ok': False, 'error': f'piece not found: {name}'}
            kept = [r for r in rows if r.get('name') != name]
            self._write_manifest_entries(kept)
        removed = []
        for key in ('js', 'mp3', 'prompt', 'prompt_json'):
            rel = target.get(key)
            if not rel: continue
            abs_path = os.path.join(ROOT, rel) if not rel.startswith('/') else rel
            if os.path.exists(abs_path):
                try: os.remove(abs_path); removed.append(rel)
                except Exception: pass
        return {'ok': True, 'name': name, 'removed_files': removed}

    def _brain_tool_update_piece_code(self, args):
        name = (args.get('name') or '').strip()
        code = args.get('code') or ''
        if not name or not code:
            return {'ok': False, 'error': 'name + code required'}
        rows = self._manifest_entries()
        target = next((r for r in rows if r.get('name') == name), None)
        if not target: return {'ok': False, 'error': f'piece not found: {name}'}
        js_rel = target.get('js')
        if not js_rel: return {'ok': False, 'error': 'no js path'}
        js_abs = os.path.join(ROOT, js_rel) if not js_rel.startswith('/') else js_rel
        if not os.path.exists(js_abs): return {'ok': False, 'error': 'js file missing'}
        old_code = open(js_abs).read()
        # Backup
        backup = self._backup_piece_for_brain_edit(target, 'brain update_piece_code')
        open(js_abs, 'w').write(code)
        render = self._run_render_subprocess(js_abs, timeout=600)
        mp3_abs = self._mp3_path_for(js_abs)
        if render.returncode != 0 or not os.path.exists(mp3_abs):
            open(js_abs, 'w').write(old_code)
            return {'ok': False, 'error': '渲染失败，已回滚，音频未变。',
                    'stderr': (render.stderr or '')[-500:]}
        sha, dur = self._probe_mp3(mp3_abs)
        features_abs = self._features_path_for(js_abs)
        features_rel, audio_features = self._features_payload_for(features_abs)
        # Re-read fresh under lock (rows above predates the long render).
        with _manifest_lock:
            rows = self._manifest_entries()
            for row in rows:
                if row.get('name') == name:
                    row['sha'] = sha; row['dur'] = dur
                    row['mp3'] = mp3_abs.replace(ROOT + '/', '')
                    row['features'] = features_rel
                    row['audio_features'] = audio_features
                    row['render_error'] = None
            self._write_manifest_entries(rows)
        # Record revision
        self._record_revision(piece_name=name, entry_before=target, entry_after=target,
                              code_before=old_code, code_after=code,
                              backup_dir=backup, source='brain-tool',
                              intent={'kind': 'manual-via-brain'})
        return {'ok': True, 'name': name, 'sha': sha, 'dur': dur, 'backup': backup}

    def _brain_tool_get_piece_prompt(self, args):
        name = (args.get('name') or '').strip()
        if not name: return {'ok': False, 'error': 'name required'}
        rows = self._manifest_entries()
        target = next((r for r in rows if r.get('name') == name), None)
        if not target: return {'ok': False, 'error': f'piece not found: {name}'}
        result = {'ok': True, 'name': name}
        if target.get('prompt'):
            p = os.path.join(ROOT, target['prompt']) if not target['prompt'].startswith('/') else target['prompt']
            if os.path.exists(p):
                result['prompt_text'] = open(p).read()[:8000]
        if target.get('prompt_json'):
            p = os.path.join(ROOT, target['prompt_json']) if not target['prompt_json'].startswith('/') else target['prompt_json']
            if os.path.exists(p):
                try: result['prompt_meta'] = json.load(open(p))
                except Exception: pass
        return result

    def _brain_tool_get_piece_revisions(self, args):
        name = (args.get('name') or '').strip()
        if not name: return {'ok': False, 'error': 'name required'}
        if not os.path.exists(REVISIONS):
            return {'ok': True, 'name': name, 'items': []}
        items = []
        with open(REVISIONS) as f:
            for line in f:
                line = line.strip()
                if not line: continue
                try:
                    d = json.loads(line)
                    if (d.get('piece') or d.get('piece_name')) == name:
                        code_meta = d.get('code') if isinstance(d.get('code'), dict) else {}
                        items.append({
                            'id': d.get('id'),
                            'ts': d.get('ts'),
                            'source': d.get('source'),
                            'intent': d.get('intent'),
                            'code_chars_before': code_meta.get('before_chars', len(d.get('code_before') or '')),
                            'code_chars_after':  code_meta.get('after_chars', len(d.get('code_after') or '')),
                            'score_before': d.get('score_before'),
                            'score_after': d.get('score_after'),
                            'score_delta': d.get('score_delta'),
                        })
                except Exception: pass
        return {'ok': True, 'name': name, 'items': items, 'count': len(items)}

    # ── Settings ──────────────────────────────────────────────────────
    def _brain_tool_get_backends_status(self, args):
        slots = []
        for k in BACKEND_SLOTS:
            if k not in BACKEND_REGISTRY: continue
            info = BACKEND_REGISTRY[k]
            route = self._resolve_slot_route(k)
            slots.append({
                'key': k, 'label': info['label'], 'vendor': info['vendor'],
                'available': route['mode'] is not None,
                'mode': route['mode'], 'reason': route['reason'],
            })
        return {'ok': True, 'slots': slots}

    def _brain_tool_get_settings(self, args):
        cfg = user_config.load()
        return {'ok': True, 'config': user_config.mask_secrets(cfg)}

    # Keys the BRAIN is never allowed to change via update_settings — these are
    # security gates / endpoints / secrets that only the human may set (via the
    # Settings UI / direct /api/settings). Without this the brain could grant
    # itself developer.write_override (full source-write + bash) or repoint a
    # provider base_url to exfiltrate a key. (sandbox-escape fix 2026-05-29.)
    _BRAIN_SETTINGS_FORBIDDEN = (
        ('developer',),                 # whole developer block (enabled / write_override)
        ('cliproxy', 'api_key'), ('cliproxy', 'base_url'),
        ('cc', 'session_dir'),
    )

    def _sanitize_brain_settings_patch(self, patch):
        """Return (clean_patch, rejected_paths). Drops forbidden keys + any
        api_key/base_url under providers.*."""
        rejected = []
        def strip(node, prefix):
            if not isinstance(node, dict):
                return node
            out = {}
            for k, v in node.items():
                path = prefix + (k,)
                # exact forbidden path or a forbidden prefix
                if any(path[:len(f)] == f for f in self._BRAIN_SETTINGS_FORBIDDEN):
                    rejected.append('.'.join(path)); continue
                # any api_key / base_url anywhere (covers providers.<vendor>.*)
                if k in ('api_key', 'base_url'):
                    rejected.append('.'.join(path)); continue
                if isinstance(v, dict):
                    sub = strip(v, path)
                    if sub: out[k] = sub
                else:
                    out[k] = v
            return out
        return strip(patch, ()), rejected

    def _brain_tool_update_settings(self, args):
        patch = args.get('patch') or {}
        if not isinstance(patch, dict):
            return {'ok': False, 'error': 'patch must be an object'}
        clean, rejected = self._sanitize_brain_settings_patch(patch)
        if not clean:
            return {'ok': False, 'error': (
                'No settable keys. The brain may not change security gates, API '
                'keys, or endpoints (' + ', '.join(rejected) + '). Those are '
                'human-only via the Settings UI.')}
        current = user_config.load()
        unmasked = user_config.unmask_save(clean, current)
        new_cfg = user_config.update(unmasked)
        res = {'ok': True, 'config': user_config.mask_secrets(new_cfg)}
        if rejected:
            res['rejected_keys'] = rejected
            res['note'] = ('Applied the allowed keys; refused human-only keys: '
                           + ', '.join(rejected))
        return res

    def _brain_tool_test_backend(self, args):
        target = (args.get('target') or '').strip()
        if not target: return {'ok': False, 'error': 'target required'}
        # Mimic _api_settings_test
        try:
            if target == 'cliproxy':
                base = self._cliproxy_base_url()
                key = self._cliproxy_api_key()
                if not key: return {'ok': False, 'detail': 'no API key configured'}
                req = urllib.request.Request(f'{base}/models',
                    headers={'Authorization': f'Bearer {key}'})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    d = json.loads(resp.read().decode('utf-8'))
                return {'ok': True, 'detail': f'{len(d.get("data") or d.get("models") or [])} models'}
            if target == 'agy':
                agy = self._agy_bin_path()
                if not os.path.exists(agy):
                    return {'ok': False, 'detail': f'not found at {agy}'}
                r = subprocess.run([agy, '--version'], capture_output=True, text=True, timeout=5)
                return {'ok': True, 'detail': (r.stdout + r.stderr).strip()[:120]}
            if target in user_config.VENDORS:
                key = self._vendor_key(target)
                base = self._vendor_base_url(target)
                if not key: return {'ok': False, 'detail': 'no API key set'}
                if target in ('openai', 'xai'):
                    req = urllib.request.Request(f'{base}/models',
                        headers={'Authorization': f'Bearer {key}'})
                elif target == 'anthropic':
                    req = urllib.request.Request(f'{base}/v1/models',
                        headers={'x-api-key': key, 'anthropic-version': '2023-06-01'})
                else:  # google
                    req = urllib.request.Request(f'{base}/models?key={urllib.parse.quote(key)}')
                with urllib.request.urlopen(req, timeout=8) as resp:
                    d = json.loads(resp.read().decode('utf-8'))
                n = len(d.get('data') or d.get('models') or [])
                return {'ok': True, 'detail': f'{n} models'}
            return {'ok': False, 'error': f'unknown target {target!r}'}
        except Exception as e:
            return {'ok': False, 'detail': str(e)[:200]}

    # ── Persistent memory ─────────────────────────────────────────────
    def _brain_tool_read_scratchpad(self, args):
        path = f'{ROOT}/developer/brain-scratchpad.md'
        if not os.path.exists(path):
            return {'ok': True, 'content': '(empty)'}
        try:
            content = open(path).read()
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        # Return last 8000 chars (most relevant — recent notes at bottom)
        if len(content) > 8000:
            content = '... (truncated, head)\n' + content[-8000:]
        return {'ok': True, 'content': content}

    def _brain_tool_append_scratchpad(self, args):
        note = args.get('note') or ''
        if not note.strip():
            return {'ok': False, 'error': 'note required'}
        path = f'{ROOT}/developer/brain-scratchpad.md'
        os.makedirs(os.path.dirname(path), exist_ok=True)
        entry = f'\n\n## {time.strftime("%Y-%m-%d %H:%M")}\n\n{note.strip()}\n'
        with open(path, 'a') as f:
            f.write(entry)
        return {'ok': True, 'path': path, 'appended_bytes': len(entry.encode('utf-8'))}

    def _brain_tool_list_recent(self, args):
        n = max(1, min(int(args.get('n', 10) or 10), 30))
        rows = self._manifest_entries()
        rows.sort(key=lambda r: r.get('ts') or '', reverse=True)
        items = [{
            'name': r.get('name'),
            'source': r.get('source'),
            'genre_label': r.get('genre_label'),
            'score_bowei': r.get('score_bowei'),
            'dur': r.get('dur'),
            'ts': r.get('ts'),
        } for r in rows[:n]]
        return {'ok': True, 'items': items}

    def _brain_tool_get_piece_code(self, args):
        name = args.get('name')
        if not name: return {'ok': False, 'error': 'name required'}
        rows = self._manifest_entries()
        entry = next((r for r in rows if r.get('name') == name), None)
        if not entry: return {'ok': False, 'error': f'piece not found: {name}'}
        js_rel = entry.get('js')
        if not js_rel: return {'ok': False, 'error': 'no js path'}
        js_abs = os.path.join(ROOT, js_rel) if not js_rel.startswith('/') else js_rel
        if not os.path.exists(js_abs): return {'ok': False, 'error': 'js file missing'}
        return {'ok': True, 'name': name, 'code': open(js_abs).read()}

    def _brain_tool_search_corpus(self, args):
        q = (args.get('q') or '').strip().lower()
        limit = max(1, min(int(args.get('limit', 10) or 10), 30))
        if not q: return {'ok': False, 'error': 'q required'}
        rows = self._manifest_entries()
        hits = []
        for r in rows:
            blob = ' '.join(str(r.get(k) or '') for k in
                ('name', 'extra', 'genre_label', 'genre_code', 'category',
                 'source', 'note_bowei')).lower()
            if q in blob:
                hits.append({
                    'name': r.get('name'),
                    'source': r.get('source'),
                    'genre_label': r.get('genre_label'),
                    'score_bowei': r.get('score_bowei'),
                    'note_bowei': r.get('note_bowei'),
                    'ts': r.get('ts'),
                })
        hits.reverse()  # newest first
        return {'ok': True, 'items': hits[:limit], 'count': len(hits)}

    def _brain_tool_score_piece(self, args):
        name = args.get('name')
        score = args.get('score')
        note = args.get('note', '')
        if not name or score is None: return {'ok': False, 'error': 'name + score required'}
        with _manifest_lock:
            rows = self._manifest_entries()
            target = next((r for r in rows if r.get('name') == name), None)
            if not target: return {'ok': False, 'error': f'piece not found: {name}'}
            target['score_bowei'] = float(score)
            if note: target['note_bowei'] = note
            self._write_manifest_entries(rows)
        return {'ok': True, 'name': name, 'score': float(score)}

    def _read_spine(self):
        rows = []
        if os.path.exists(FAILURE_SPINE):
            with open(FAILURE_SPINE) as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try: rows.append(json.loads(line))
                        except Exception: pass
        return rows

    def _next_spine_id(self):
        """Highest existing fs-NNN +1 across BOTH active and archive (so we
        never collide with archived ids when looking back)."""
        max_n = 0
        for path in (FAILURE_SPINE, f'{ROOT}/producer-brain/archive-v0/failure-spine.jsonl'):
            if not os.path.exists(path): continue
            with open(path) as f:
                for line in f:
                    if not line.strip(): continue
                    try:
                        d = json.loads(line)
                        m = re.match(r'^fs-(\d+)$', str(d.get('id') or ''))
                        if m: max_n = max(max_n, int(m.group(1)))
                    except Exception: pass
        return f'fs-{max_n + 1:03d}'

    def _brain_tool_add_spine_entry(self, args):
        symptom = (args.get('symptom_heard') or '').strip()
        avoid_rule = (args.get('avoid_rule') or '').strip()
        evidence = (args.get('evidence') or '').strip()
        if not symptom or not avoid_rule or not evidence:
            return {'ok': False, 'error': 'symptom_heard + avoid_rule + evidence all required'}
        entry = {
            'id': self._next_spine_id(),
            'symptom_heard': symptom,
            'root_cause': (args.get('root_cause') or '').strip() or None,
            'avoid_rule': avoid_rule,
            'evidence': evidence,
            'ts': time.strftime('%Y-%m-%d'),
            'status': args.get('status') or 'exploratory',
        }
        # Drop None fields for cleanliness
        entry = {k: v for k, v in entry.items() if v is not None}
        with _spine_lock:
            # Re-allocate id inside the lock so concurrent adds don't collide.
            entry['id'] = self._next_spine_id()
            with open(FAILURE_SPINE, 'a') as f:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
        return {'ok': True, 'id': entry['id'], 'status': entry['status']}

    def _brain_tool_update_spine_status(self, args):
        sid = (args.get('id') or '').strip()
        new_status = (args.get('new_status') or '').strip()
        reason = (args.get('reason') or '').strip()
        if not sid or not new_status:
            return {'ok': False, 'error': 'id + new_status required'}
        with _spine_lock:
            rows = self._read_spine()
            target = next((r for r in rows if r.get('id') == sid), None)
            if not target:
                return {'ok': False, 'error': f'spine entry not found: {sid}'}
            old_status = target.get('status') or 'baseline'
            target['status'] = new_status
            # Record transition history for audit (append-friendly)
            transitions = target.setdefault('_transitions', [])
            transitions.append({
                'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
                'from': old_status, 'to': new_status,
                'reason': reason or '',
            })
            body = ''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows)
            self._atomic_write_text(FAILURE_SPINE, body)
        return {'ok': True, 'id': sid, 'from': old_status, 'to': new_status}

    # ── Expanded normal-mode tools ────────────────────────────────────
    def _brain_tool_archive_piece(self, args):
        name = (args.get('name') or '').strip()
        if not name: return {'ok': False, 'error': 'name required'}
        with _manifest_lock:
            rows = self._manifest_entries()
            target = next((r for r in rows if r.get('name') == name), None)
            if not target: return {'ok': False, 'error': f'piece not found: {name}'}
            target['archived_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
            self._write_manifest_entries(rows)
        return {'ok': True, 'name': name, 'archived_at': target['archived_at']}

    def _brain_tool_update_piece_note(self, args):
        name = (args.get('name') or '').strip()
        note = args.get('note', '')
        if not name: return {'ok': False, 'error': 'name required'}
        with _manifest_lock:
            rows = self._manifest_entries()
            target = next((r for r in rows if r.get('name') == name), None)
            if not target: return {'ok': False, 'error': f'piece not found: {name}'}
            target['note_bowei'] = note
            target['note_ts'] = time.strftime('%Y-%m-%d %H:%M:%S')
            self._write_manifest_entries(rows)
        return {'ok': True, 'name': name, 'note_ts': target['note_ts']}

    def _brain_tool_list_spine(self, args):
        status_filter = (args.get('status') or '').strip().lower() or None
        q = (args.get('q') or '').strip().lower() or None
        limit = max(1, min(int(args.get('limit', 20) or 20), 50))
        rows = self._read_spine()
        if status_filter:
            rows = [r for r in rows if (r.get('status') or 'baseline').lower() == status_filter]
        if q:
            def _hit(r):
                blob = ' '.join(str(r.get(k) or '') for k in
                                ('id', 'symptom_heard', 'avoid_rule', 'evidence', 'status')).lower()
                return q in blob
            rows = [r for r in rows if _hit(r)]
        rows.sort(key=lambda r: r.get('ts') or '', reverse=True)
        items = [{
            'id': r.get('id'),
            'status': r.get('status') or 'baseline',
            'symptom_heard': r.get('symptom_heard'),
            'avoid_rule': r.get('avoid_rule'),
            'evidence': r.get('evidence'),
            'ts': r.get('ts'),
        } for r in rows[:limit]]
        return {'ok': True, 'items': items, 'count': len(items)}

    def _brain_tool_read_kernel_fragment(self, args):
        name = (args.get('name') or '').strip()
        if not name: return {'ok': False, 'error': 'name required'}
        path = self._kernel_fragment_path(name)
        if not path or not os.path.exists(path):
            return {'ok': False, 'error': f'kernel fragment not found: {name}'}
        try:
            content = open(path).read()
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        return {'ok': True, 'name': name, 'content': content}

    # ── CC bridge: proposals / tasks / preset commands ────────────────
    def _brain_tool_list_proposals(self, args):
        status = (args.get('status') or '').strip().lower() or None
        rows = self._read_jsonl(PROPOSALS) if os.path.exists(PROPOSALS) else []
        if status:
            rows = [r for r in rows if (r.get('status') or 'pending').lower() == status]
        rows = rows[-30:]
        return {'ok': True, 'count': len(rows), 'proposals': rows}

    def _brain_tool_decide_proposal(self, args):
        pid = (args.get('id') or '').strip()
        action = (args.get('action') or '').strip().lower()
        note = args.get('note') or ''
        if not pid or action not in ('accept', 'reject'):
            return {'ok': False, 'error': 'id + action(accept|reject) required'}
        items = self._read_jsonl(PROPOSALS) if os.path.exists(PROPOSALS) else []
        found = False
        for it in items:
            if it.get('id') == pid:
                it['status'] = 'accepted' if action == 'accept' else 'rejected'
                it['decided_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                if note: it['decision_note'] = note
                found = True
        if not found: return {'ok': False, 'error': f'proposal id not found: {pid}'}
        self._rewrite_jsonl(PROPOSALS, items)
        try: open(f'{BRIDGE}/.kick', 'w').write(str(time.time()))
        except Exception: pass
        return {'ok': True, 'id': pid, 'action': action}

    def _brain_tool_list_tasks(self, args):
        status = (args.get('status') or '').strip().lower() or None
        rows = self._read_jsonl(TASKS) if os.path.exists(TASKS) else []
        if status:
            rows = [r for r in rows if (r.get('status') or '').lower() == status]
        rows = rows[-30:]
        return {'ok': True, 'count': len(rows), 'tasks': rows}

    def _brain_tool_run_preset_command(self, args):
        """Fire one of the configured CC preset commands (same path as the
        Commands tab in the UI: writes the preset body into the CC inbox)."""
        pid = (args.get('id') or '').strip()
        preset = next((p for p in PRESET_COMMANDS if p['id'] == pid), None)
        if not preset:
            ids = [p['id'] for p in PRESET_COMMANDS]
            return {'ok': False, 'error': f'unknown preset id {pid!r}. available: {ids}'}
        entry = {
            'id': f'msg-{int(time.time()*1000)}',
            'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
            'role': 'user',
            'text': preset['body'],
            'tag': preset['tag'],
            'source': 'brain-preset',
        }
        try:
            with open(INBOX, 'a') as f:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
            open(f'{BRIDGE}/.kick', 'w').write(str(time.time()))
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        return {'ok': True, 'fired': preset['id'], 'label': preset['label'], 'tag': preset['tag']}

    # ── archive-v0 (frozen legacy) read access ────────────────────────
    def _brain_tool_get_archived_piece(self, args):
        name = (args.get('name') or '').strip()
        rows = []
        if os.path.exists(ARCHIVE_INDEX):
            with open(ARCHIVE_INDEX) as f:
                rows = [json.loads(l) for l in f if l.strip()]
        if not name:
            return {'ok': True, 'count': len(rows),
                    'names': [r.get('name') for r in rows[:60]],
                    'note': 'pass name= to fetch one entry (with code if available)'}
        target = next((r for r in rows if r.get('name') == name), None)
        if not target: return {'ok': False, 'error': f'archived piece not found: {name}'}
        out = dict(target)
        js_rel = target.get('js')
        if js_rel:
            js_abs = os.path.join(ROOT, js_rel) if not js_rel.startswith('/') else js_rel
            if os.path.exists(js_abs):
                try: out['code'] = open(js_abs).read()
                except Exception: pass
        return {'ok': True, 'piece': out}

    def _brain_tool_get_archived_spine(self, args):
        sid = (args.get('id') or '').strip()
        path = f'{ROOT}/producer-brain/archive-v0/failure-spine.jsonl'
        rows = []
        if os.path.exists(path):
            with open(path) as f:
                rows = [json.loads(l) for l in f if l.strip()]
        if not sid:
            return {'ok': True, 'count': len(rows),
                    'ids': [r.get('id') for r in rows]}
        target = next((r for r in rows if r.get('id') == sid), None)
        if not target: return {'ok': False, 'error': f'archived spine entry not found: {sid}'}
        return {'ok': True, 'entry': target}

    # ── multi-step planning state (persists across chat turns) ────────
    def _brain_plan_path(self):
        return f'{ROOT}/developer/brain-plan.json'

    def _brain_tool_set_plan(self, args):
        """Persist a multi-step plan. Brain uses this for long tasks so it can
        survive chat-history truncation: write the plan, then re-read it (or
        mark steps done) on later turns."""
        goal = args.get('goal') or ''
        steps = args.get('steps') or []
        if not isinstance(steps, list):
            return {'ok': False, 'error': 'steps must be a list of strings or {step,done} objects'}
        norm = []
        for i, s in enumerate(steps):
            if isinstance(s, dict):
                norm.append({'n': i + 1, 'step': s.get('step') or s.get('text') or '',
                             'done': bool(s.get('done'))})
            else:
                norm.append({'n': i + 1, 'step': str(s), 'done': False})
        plan = {'goal': goal, 'steps': norm,
                'updated_at': time.strftime('%Y-%m-%d %H:%M:%S')}
        try:
            self._atomic_write_text(self._brain_plan_path(),
                                    json.dumps(plan, ensure_ascii=False, indent=2))
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        return {'ok': True, 'plan': plan}

    def _brain_tool_get_plan(self, args):
        path = self._brain_plan_path()
        if not os.path.exists(path):
            return {'ok': True, 'plan': None, 'note': 'no active plan — use set_plan to create one'}
        try:
            plan = json.loads(open(path).read())
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        done = sum(1 for s in plan.get('steps', []) if s.get('done'))
        total = len(plan.get('steps', []))
        return {'ok': True, 'plan': plan, 'progress': f'{done}/{total}'}

    # ── cancel a brain generation job ─────────────────────────────────
    def _brain_tool_cancel_generation(self, args):
        """Mark a queued/running brain gen job for cancellation. Queued jobs
        are dropped before they start; running jobs set a cancel flag the
        worker checks (best-effort — a render already in subprocess finishes)."""
        job_id = (args.get('job_id') or '').strip()
        cancelled = []
        with _brain_gen_jobs_lock:
            for j in _brain_gen_jobs:
                if (not job_id or j.get('job_id') == job_id) and j['status'] in ('queued', 'running'):
                    j['cancel_requested'] = True
                    if j['status'] == 'queued':
                        j['status'] = 'failed'
                        j['error'] = 'cancelled before start'
                    cancelled.append(j.get('job_id'))
        if not cancelled:
            return {'ok': False, 'error': 'no queued/running job matched' + (f' job_id={job_id}' if job_id else '')}
        return {'ok': True, 'cancelled': cancelled}

    # ── fork a piece into a new one ───────────────────────────────────
    def _brain_tool_save_piece_as_new(self, args):
        """Fork: take an existing piece's code (optionally with edits), render
        it, and register as a NEW corpus entry whose parent is the source."""
        src_name = (args.get('source_name') or args.get('name') or '').strip()
        new_code = args.get('code')
        if not src_name: return {'ok': False, 'error': 'source_name required'}
        rows = self._manifest_entries()
        src = next((r for r in rows if r.get('name') == src_name), None)
        if not src: return {'ok': False, 'error': f'source piece not found: {src_name}'}
        if not new_code:
            js_rel = src.get('js')
            js_abs = os.path.join(ROOT, js_rel) if js_rel and not js_rel.startswith('/') else js_rel
            if not js_abs or not os.path.exists(js_abs):
                return {'ok': False, 'error': 'source has no readable code and no code= supplied'}
            new_code = open(js_abs).read()
        # Reuse the synchronous render+register pipeline with a no-op emit.
        logs = []
        def emit(ev, data): logs.append((ev, data))
        prompt_snapshot = f'# fork of {src_name}\n# source preset: {src.get("genre_preset")}\n'
        extra = src.get('extra') or ''
        entry = self._render_and_register(
            code=new_code, prompt_snapshot=prompt_snapshot,
            extra=extra, slot=src.get('source') or 'gpt-5.5', emit=emit,
        )
        if not entry:
            err = next((d.get('error') for ev, d in logs if ev == 'error'), 'render failed')
            return {'ok': False, 'error': err, 'logs': [d for ev, d in logs if ev == 'log']}
        # Mark parent lineage (locked read-modify-write).
        self._mark_entry_field(entry['name'], 'parent', src_name)
        return {'ok': True, 'new_name': entry['name'], 'parent': src_name,
                'mp3': entry.get('mp3')}

    # ── MIDI export ───────────────────────────────────────────────────
    def _brain_tool_export_midi(self, args):
        """Export a piece's pattern to MIDI via the same midi-export.ts the
        /api/midi endpoint uses. Derives cycles/cps from the piece's code."""
        name = (args.get('name') or '').strip()
        if not name: return {'ok': False, 'error': 'name required'}
        rows = self._manifest_entries()
        target = next((r for r in rows if r.get('name') == name), None)
        if not target: return {'ok': False, 'error': f'piece not found: {name}'}
        js_rel = target.get('js')
        js_abs = os.path.join(ROOT, js_rel) if js_rel and not js_rel.startswith('/') else js_rel
        if not js_abs or not os.path.exists(js_abs):
            return {'ok': False, 'error': 'piece has no readable code'}
        code = open(js_abs).read()
        # cps from setcps(X) or setcpm(X/Y); cycles from arrange() sum, else 64.
        cps = self._code_tempo_to_cps(code)
        cycles = 64.0
        os.makedirs(f'{ROOT}/producer-brain/midi', exist_ok=True)
        out_mid = js_abs.replace('/pieces/', '/midi/').replace('.js', '.mid')
        try:
            r = subprocess.run(
                ['/usr/bin/env', 'pnpm', '-s', 'exec', 'tsx', 'src/midi-export.ts',
                 js_abs, out_mid, str(cycles), str(cps)],
                cwd=os.path.join(ROOT, 'apps/cli'),
                capture_output=True, text=True, timeout=300,
            )
        except Exception as e:
            return {'ok': False, 'error': f'midi export invocation failed: {e}'}
        if not os.path.exists(out_mid):
            return {'ok': False, 'error': f'midi export failed (exit {r.returncode}): {(r.stderr or "")[-300:]}'}
        return {'ok': True, 'name': name, 'midi': out_mid.replace(ROOT + '/', ''),
                'bytes': os.path.getsize(out_mid)}

    # ── Developer Mode tools (gated; audit logged) ────────────────────
    def _dev_audit(self, tool, args):
        """Append an audit record for every dev-mode tool call."""
        try:
            audit_path = f'{ROOT}/producer-brain/dev-mode-audit.jsonl'
            entry = {
                'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
                'tool': tool,
                'args': args,
            }
            with open(audit_path, 'a') as f:
                f.write(json.dumps(entry, ensure_ascii=False, default=str) + '\n')
        except Exception:
            pass

    def _dev_resolve_path(self, raw):
        """Resolve a brain-supplied path, refuse if outside ROOT or /tmp.
        Uses realpath (follows symlinks) so a link planted INSIDE the sandbox
        can't point at e.g. ~/.ssh and escape. (symlink-escape fix 2026-05-29.)"""
        if not raw: raise RuntimeError('path required')
        cand = raw if raw.startswith('/') else os.path.join(ROOT, raw)
        abs_path = os.path.realpath(cand)
        allowed = tuple(os.path.realpath(p) for p in (ROOT, '/tmp', '/private/tmp'))
        if not any(abs_path == r or abs_path.startswith(r + '/') for r in allowed):
            raise RuntimeError(f'path outside allowed roots: {abs_path}')
        # Block sensitive trees (whole dirs, not just one file) even within ROOT.
        BLOCKED = tuple(os.path.realpath(os.path.expanduser(p)) for p in (
            '~/.cactus-strudel',   # all config incl. api keys (not just config.json)
            '~/.claude',
            f'{ROOT}/.git',
        ))
        for b in BLOCKED:
            if abs_path == b or abs_path.startswith(b + '/'):
                raise RuntimeError(f'path blocked (sensitive): {abs_path}')
        base = os.path.basename(abs_path)
        if os.path.dirname(abs_path) == os.path.realpath(ROOT) and (base == '.env' or base.startswith('.env.')):
            raise RuntimeError(f'path blocked (sensitive env file): {abs_path}')
        return abs_path

    # Paths brain may WRITE without write_override.
    # All under ROOT only; absolute root paths added for clarity.
    SANDBOX_WRITE_ROOTS = (
        f'{ROOT}/producer-brain',
        f'{ROOT}/developer',
        '/tmp',
        '/private/tmp',
    )

    def _dev_write_allowed(self, abs_path):
        """Returns (ok, reason). Checks user_config.developer.write_override."""
        cfg = user_config.load()
        dev = cfg.get('developer') or {}
        if dev.get('write_override'):
            return True, ''
        # Default sandbox: only allow writes in producer-brain/, developer/, /tmp/
        for root in self.SANDBOX_WRITE_ROOTS:
            if abs_path == root or abs_path.startswith(root + '/'):
                return True, ''
        return False, (
            f'write blocked — outside sandbox. Path {abs_path} is repo source. '
            f'Ask Bowei to enable Settings → Developer Mode → "Write override" '
            f'(or do via /api/settings PUT developer.write_override=true) then retry.'
        )

    def _brain_tool_dev_read_file(self, args):
        try:
            path = self._dev_resolve_path(args.get('path', ''))
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        if not os.path.exists(path):
            return {'ok': False, 'error': 'file not found'}
        try:
            content = open(path).read()
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        content = self._redact_secrets(content)
        # Truncate huge files
        if len(content) > 40000:
            return {'ok': True, 'path': path, 'content': content[:40000], 'truncated': True, 'full_size': len(content)}
        return {'ok': True, 'path': path, 'content': content}

    def _brain_tool_dev_write_file(self, args):
        try:
            path = self._dev_resolve_path(args.get('path', ''))
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        ok, reason = self._dev_write_allowed(path)
        if not ok:
            return {'ok': False, 'error': reason}
        content = args.get('content', '')
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            self._atomic_write_text(path, content)
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        return {'ok': True, 'path': path, 'bytes': len(content.encode('utf-8'))}

    def _brain_tool_dev_apply_patch(self, args):
        try:
            path = self._dev_resolve_path(args.get('path', ''))
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        ok, reason = self._dev_write_allowed(path)
        if not ok:
            return {'ok': False, 'error': reason}
        old_string = args.get('old_string', '')
        new_string = args.get('new_string', '')
        if not old_string:
            return {'ok': False, 'error': 'old_string required (creating new files use dev_write_file)'}
        if not os.path.exists(path):
            return {'ok': False, 'error': 'file not found'}
        try:
            content = open(path).read()
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        if content.count(old_string) == 0:
            return {'ok': False, 'error': 'old_string not found in file'}
        if content.count(old_string) > 1:
            return {'ok': False, 'error': f'old_string appears {content.count(old_string)} times — needs more surrounding context to be unique'}
        new_content = content.replace(old_string, new_string, 1)
        try:
            self._atomic_write_text(path, new_content)
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        return {'ok': True, 'path': path, 'old_bytes': len(content), 'new_bytes': len(new_content)}

    def _brain_tool_dev_run_bash(self, args):
        # dev_run_bash entirely gated on write_override — read-only needs are
        # served by dev_read_file / dev_list_dir / dev_create_checkpoint.
        cfg = user_config.load()
        if not ((cfg.get('developer') or {}).get('write_override')):
            return {
                'ok': False,
                'error': 'dev_run_bash is gated by Developer Mode → write_override (currently OFF). '
                         'Ask Bowei to enable Settings → "Write override" for software-source-modifying tasks. '
                         'For read-only inspection use dev_read_file / dev_list_dir.'
            }
        command = args.get('command', '').strip()
        timeout = max(1, min(int(args.get('timeout_sec', 60) or 60), 600))
        if not command:
            return {'ok': False, 'error': 'command required'}
        # NOTE: dev_run_bash == user-level shell, by design, once a human enables
        # write_override. The list below is a thin guard against obvious accidents
        # (typos, fat-fingers) — NOT a security boundary; it's trivially bypassable
        # and we don't pretend otherwise. The real control is write_override being
        # human-only (the brain cannot set it via update_settings).
        FOOTGUNS = ('sudo ', 'rm -rf /', 'git push', 'chmod 777', 'mkfs', 'dd if=', '>/dev/sd')
        for f in FOOTGUNS:
            if f in command:
                return {'ok': False, 'error': f'refused likely-mistake pattern {f!r} (thin guard; not a security boundary)'}
        try:
            r = subprocess.run(
                ['/bin/bash', '-c', command],
                cwd=ROOT,
                capture_output=True, text=True, timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return {'ok': False, 'error': f'timeout after {timeout}s'}
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        def cap(s, n=4000):
            s = self._redact_secrets(s or '')
            return s if len(s) <= n else s[:n] + f'\n... (truncated, {len(s)} total)'
        return {
            'ok': r.returncode == 0,
            'exit_code': r.returncode,
            'stdout': cap(r.stdout),
            'stderr': cap(r.stderr),
        }

    def _redact_secrets(self, s):
        """Mask configured API keys + obvious high-entropy tokens so a stray
        `cat config.json` / `env` can't dump secrets into the chat/transcript."""
        if not s: return s
        try:
            cfg = user_config.load()
            secrets = set()
            cp = cfg.get('cliproxy') or {}
            if cp.get('api_key'): secrets.add(cp['api_key'])
            for v in (cfg.get('providers') or {}).values():
                if isinstance(v, dict) and v.get('api_key'): secrets.add(v['api_key'])
            for sec in secrets:
                if sec and len(sec) >= 8:
                    s = s.replace(sec, '***REDACTED***')
        except Exception:
            pass
        # Generic: sk-…, AIza…, and long hex/base64 runs.
        s = re.sub(r'\b(sk-[A-Za-z0-9_\-]{12,}|AIza[A-Za-z0-9_\-]{20,}|[A-Fa-f0-9]{40,})\b',
                   '***REDACTED***', s)
        return s

    def _brain_tool_dev_list_dir(self, args):
        try:
            path = self._dev_resolve_path(args.get('path', '.'))
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        if not os.path.isdir(path):
            return {'ok': False, 'error': 'not a directory'}
        try:
            items = []
            for name in sorted(os.listdir(path)):
                full = os.path.join(path, name)
                st = os.stat(full)
                items.append({
                    'name': name,
                    'is_dir': os.path.isdir(full),
                    'size': st.st_size,
                    'mtime': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(st.st_mtime)),
                })
            return {'ok': True, 'path': path, 'items': items}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def _brain_tool_dev_create_checkpoint(self, args):
        name = (args.get('name') or '').strip()
        desc = (args.get('description') or '').strip()
        if not name or not desc:
            return {'ok': False, 'error': 'name + description required'}
        try:
            r = subprocess.run(
                ['/bin/bash', f'{ROOT}/bin/checkpoint-create', name, desc],
                cwd=ROOT, capture_output=True, text=True, timeout=30,
            )
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        return {
            'ok': r.returncode == 0,
            'exit_code': r.returncode,
            'stdout': r.stdout[-500:],
            'stderr': r.stderr[-500:],
        }

    def _manifest_entries(self):
        # Tolerant of blank/corrupt lines: one interrupted append must not 500
        # every piece API. Bad lines are skipped + logged (not raised).
        with _manifest_lock:
            return self._read_jsonl(MANIFEST)

    def _write_manifest_entries(self, rows):
        body = ''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows)
        with _manifest_lock:
            self._atomic_write_text(MANIFEST, body)
            self._invalidate_jsonl_cache(MANIFEST)

    def _append_manifest_entry(self, entry):
        """Locked append. Ensures the file ends in a newline first so an
        interrupted prior append can't concatenate into one corrupt line."""
        with _manifest_lock:
            nl = ''
            if os.path.exists(MANIFEST) and os.path.getsize(MANIFEST) > 0:
                with open(MANIFEST, 'rb') as f:
                    f.seek(-1, os.SEEK_END)
                    if f.read(1) != b'\n':
                        nl = '\n'
            with open(MANIFEST, 'a') as f:
                f.write(nl + json.dumps(entry, ensure_ascii=False) + '\n')
            self._invalidate_jsonl_cache(MANIFEST)

    def _mark_entry_field(self, name, field, value):
        """Locked read-modify-write: set one field on the entry named `name`."""
        with _manifest_lock:
            rows = self._manifest_entries()
            hit = False
            for r in rows:
                if r.get('name') == name:
                    r[field] = value; hit = True
            if hit:
                self._write_manifest_entries(rows)
            return hit

    # ── Centralized render subprocess (single source of truth) ───────────
    # Launches the headless render in its OWN process group so a timeout can
    # kill the whole pnpm→tsx→node→chromium tree (Python's subprocess timeout
    # only signals the direct child → otherwise orphaned chromium/node zombies).
    def _run_render_subprocess(self, js_abs, *, timeout=480, cycles='24', job=None):
        """Render in its own process group so a timeout OR a user cancel can
        kill the whole pnpm→tsx→node→chromium tree. If `job` is given, the proc
        is stored on it (`job['render_proc']`) so /api/generate/cancel can
        killpg it mid-render."""
        validation = self._run_deterministic_validator(js_abs)
        if validation.returncode != 0:
            return validation
        env = os.environ.copy()
        env.setdefault('CACTUS_RENDER_DEFAULT_CYCLES', cycles)
        proc = subprocess.Popen(
            ['/usr/bin/env', 'pnpm', '-s', 'exec', 'tsx', 'src/auto-render.ts', js_abs],
            cwd=os.path.join(ROOT, 'apps/cli'), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            start_new_session=True,
        )
        if job is not None:
            job['render_proc'] = proc
        try:
            out, err = proc.communicate(timeout=timeout)
            return subprocess.CompletedProcess(proc.args, proc.returncode, out, err)
        except subprocess.TimeoutExpired:
            self._killpg(proc)
            try: out, err = proc.communicate(timeout=10)
            except Exception: out, err = '', ''
            return subprocess.CompletedProcess(
                proc.args, 124, out or '', (err or '') + '\n[render killed: timeout]')
        finally:
            if job is not None:
                job['render_proc'] = None

    def _run_deterministic_validator(self, js_abs):
        """Cheap pre-render validator. This is the deterministic gate; the LLM
        validator above is allowed to auto-fix before we get here, but render
        registration never proceeds when this validator rejects the final code."""
        try:
            r = subprocess.run(
                ['/usr/bin/env', 'pnpm', '-s', 'exec', 'tsx', 'src/validate-strudel.ts', '--json', js_abs],
                cwd=os.path.join(ROOT, 'apps/cli'),
                timeout=30, capture_output=True, text=True,
            )
            if r.returncode != 0:
                return subprocess.CompletedProcess(r.args, r.returncode, r.stdout, (r.stderr or '') + (r.stdout or ''))
            return r
        except subprocess.TimeoutExpired as e:
            return subprocess.CompletedProcess(
                ['/usr/bin/env', 'pnpm', '-s', 'exec', 'tsx', 'src/validate-strudel.ts', '--json', js_abs],
                124, e.stdout or '', (e.stderr or '') + '\n[deterministic validator killed: timeout]',
            )
        except Exception as e:
            return subprocess.CompletedProcess(
                ['/usr/bin/env', 'pnpm', '-s', 'exec', 'tsx', 'src/validate-strudel.ts', '--json', js_abs],
                1, '', f'[deterministic validator failed: {e}]',
            )

    def _run_deterministic_validator_code(self, code):
        """Validate generated code before it is persisted or rendered.
        Kept separate from the file-path gate so UI/SSE can report deterministic
        validation failures as validation failures, not generic render failures."""
        tmp = None
        try:
            with tempfile.NamedTemporaryFile('w', suffix='.strudel.js', delete=False, encoding='utf-8') as f:
                f.write(code)
                tmp = f.name
            return self._run_deterministic_validator(tmp)
        finally:
            if tmp:
                try: os.unlink(tmp)
                except Exception: pass

    @staticmethod
    def _killpg(proc):
        """Best-effort kill of a Popen's whole process group."""
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            try: proc.kill()
            except Exception: pass

    @staticmethod
    def _code_tempo_to_cps(code):
        """Parse top-level Strudel tempo helpers without evaluating code.
        setcps(X) is already cycles/second. setcpm(X/Y) is cycles/minute and
        converts to cps. If both exist, setcps wins because it is already the
        renderer-native unit and preserves older compiler output."""
        m = re.search(r'setcps\(([^)]+)\)', code or '')
        if m:
            return H._numeric_expr(m.group(1), 0.5)
        m = re.search(r'setcpm\(([^)]+)\)', code or '')
        return H._cpm_to_cps(m.group(1)) if m else 0.5

    @staticmethod
    def _cpm_to_cps(expr):
        """Parse a setcpm() argument to cps WITHOUT eval. Accepts 'N' or 'N/M'
        (the only shapes Strudel uses); anything else → default 0.5."""
        cpm = H._numeric_expr(expr, None)
        if cpm is not None:
            cps = cpm / 60.0
            return cps if 0 < cps < 100 else 0.5
        return 0.5

    @staticmethod
    def _numeric_expr(expr, fallback):
        """Parse a tiny unsigned numeric expression (N or N/M) without eval."""
        try:
            expr = (expr or '').strip()
            if '/' in expr:
                a, _, b = expr.partition('/')
                val = float(a) / float(b)
            else:
                val = float(expr)
            return val if 0 < val < 100 else fallback
        except Exception:
            return fallback

    def _mp3_path_for(self, js_abs):
        """Canonical mp3 path for a piece js. Renders live in pieces/, audio in
        audio/. Falls back to a sibling .mp3 if the path isn't under pieces/
        (instead of the old silent string-replace no-op)."""
        if '/producer-brain/pieces/' in js_abs:
            return js_abs.replace('/producer-brain/pieces/', '/producer-brain/audio/')[:-3] + '.mp3'
        base = os.path.basename(js_abs)[:-3] + '.mp3'
        return os.path.join(AUDIO, base)

    def _features_path_for(self, js_abs):
        """Canonical analyzer sidecar path for a piece js."""
        if '/producer-brain/pieces/' in js_abs:
            return js_abs.replace('/producer-brain/pieces/', '/producer-brain/features/')[:-3] + '.features.json'
        base = os.path.basename(js_abs)[:-3] + '.features.json'
        return os.path.join(FEATURES, base)

    def _features_payload_for(self, features_abs):
        """Return (relative path, parsed features) if analyzer sidecar exists."""
        if not features_abs or not os.path.exists(features_abs):
            return (None, None)
        rel_path = features_abs.replace(ROOT + '/', '')
        try:
            with open(features_abs) as f:
                return (rel_path, json.load(f))
        except Exception as e:
            return (rel_path, {'error': f'failed to read features sidecar: {e}'})

    def _probe_mp3(self, mp3_abs):
        """Return (sha16, duration_str), each best-effort (never raises)."""
        sha = ''
        try:
            sha = subprocess.run(['shasum', '-a', '256', mp3_abs],
                                 capture_output=True, text=True, timeout=30).stdout[:16]
        except Exception: pass
        dur = ''
        try:
            dur = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                                  'format=duration', '-of', 'csv=p=0', mp3_abs],
                                 capture_output=True, text=True, timeout=30).stdout.strip()
        except Exception: pass
        return sha, dur

    def _find_piece_entry(self, name):
        if not name:
            return None, []
        rows = self._manifest_entries()
        found = None
        for row in rows:
            if row.get('name') == name:
                found = row
        return found, rows

    def _backup_piece_for_brain_edit(self, entry, reason):
        safe_name = re.sub(r'[^A-Za-z0-9_.-]+', '_', entry.get('name') or 'piece')
        ts = time.strftime('%Y%m%d-%H%M%S')
        bdir = os.path.join(BRAIN_BACKUPS, f'{ts}-{safe_name}')
        os.makedirs(bdir, exist_ok=True)
        with open(os.path.join(bdir, 'manifest-entry.before.json'), 'w') as f:
            json.dump(entry, f, ensure_ascii=False, indent=2)
        with open(os.path.join(bdir, 'reason.txt'), 'w') as f:
            f.write(reason or '')
        for key in ('js', 'mp3', 'prompt'):
            rel = entry.get(key)
            if not rel:
                continue
            src = os.path.join(ROOT, rel) if not rel.startswith('/') else rel
            if os.path.exists(src):
                copy2(src, os.path.join(bdir, os.path.basename(src)))
        return bdir

    # ─── Research database: every save is recorded as a revision ───────────
    # See docs/research-database-plan.md for full design. Schema is forward-
    # compatible (jsonl, additive only). Backup dir already exists per save;
    # we just drop diff.txt + revision.json into it.
    def _record_revision(self, *, piece_name, entry_before, entry_after,
                         code_before, code_after, backup_dir, source, intent):
        try:
            old_lines = (code_before or '').splitlines()
            new_lines = (code_after or '').splitlines()
            diff_lines = list(difflib.unified_diff(
                old_lines, new_lines,
                fromfile=f'{piece_name}.before',
                tofile=f'{piece_name}.after',
                lineterm='',
            ))
            added   = sum(1 for l in diff_lines if l.startswith('+') and not l.startswith('+++'))
            removed = sum(1 for l in diff_lines if l.startswith('-') and not l.startswith('---'))
            diff_text = '\n'.join(diff_lines)

            score_before = entry_before.get('score_bowei') if isinstance(entry_before, dict) else None
            try: score_before = float(score_before) if score_before is not None else None
            except Exception: score_before = None

            rev = {
                'id': f'rev-{int(time.time()*1000)}',
                'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
                'piece': piece_name,
                'source': source,
                'intent': intent or {'kind': None, 'target': None, 'params': None,
                                     'brain_reply_id': None, 'natural_lang_request': None},
                'code': {
                    'before_chars': len(code_before or ''),
                    'after_chars':  len(code_after  or ''),
                    'delta_chars':  len(code_after or '') - len(code_before or ''),
                    'added_lines':   added,
                    'removed_lines': removed,
                },
                'from_sha': (entry_before or {}).get('sha'),
                'to_sha':   (entry_after  or {}).get('sha'),
                'from_dur': (entry_before or {}).get('dur'),
                'to_dur':   (entry_after  or {}).get('dur'),
                'score_before': score_before,
                'score_after':  None,
                'score_delta':  None,
                'backup_dir':   (backup_dir or '').replace(ROOT + '/', ''),
            }

            # Append index row + write per-revision detail into the backup dir
            os.makedirs(os.path.dirname(REVISIONS), exist_ok=True)
            self._append_jsonl(REVISIONS, rev)
            if backup_dir and os.path.isdir(backup_dir):
                try:
                    with open(os.path.join(backup_dir, 'diff.txt'), 'w') as f:
                        f.write(diff_text)
                    with open(os.path.join(backup_dir, 'revision.json'), 'w') as f:
                        json.dump(rev, f, ensure_ascii=False, indent=2)
                except Exception as e:
                    print(f'[revision] failed to write detail files: {e}')
            return rev
        except Exception as e:
            print(f'[revision] record failed for {piece_name}: {e}')
            return None

    def _backfill_revision_score(self, piece_name, new_score):
        """When a piece gets (re)scored, populate the most recent revision for
        that piece whose score_after is still null. In-place rewrite of
        revisions.jsonl. Idempotent: if no open revision, no-op."""
        try:
            new_score_f = float(new_score)
        except Exception:
            return None
        if not os.path.exists(REVISIONS):
            return None
        rows = self._read_jsonl(REVISIONS)
        # walk in reverse to find latest open revision for this piece
        for r in reversed(rows):
            if r.get('piece') == piece_name and r.get('score_after') is None:
                r['score_after'] = new_score_f
                if r.get('score_before') is not None:
                    try: r['score_delta'] = round(new_score_f - float(r['score_before']), 3)
                    except Exception: pass
                r['score_filled_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                self._rewrite_jsonl(REVISIONS, rows)
                return r
        return None


    # ---- Opus brain: chat (CLIProxy or direct Anthropic) ----------------
    def _api_brain_chat(self):
        try:
            body = self._json_body()
        except Exception:
            return self._json(400, {'error': 'invalid JSON body'})
        text = (body.get('text') or '').strip()
        ctx = body.get('context', {}) or {}
        if not text:
            return self._json(400, {'error': 'text required'})
        stream = bool(body.get('stream'))

        if stream:
            # SSE: emit per-tool progress so the user isn't staring at a frozen
            # UI for minutes. (人性化 fix 2026-05-29.)
            try:
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Accel-Buffering', 'no')
                self.end_headers()
            except Exception:
                return
            alive = [True]
            def emit(ev, data):
                if not alive[0]: return
                try:
                    self.wfile.write(f'event: {ev}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'.encode('utf-8'))
                    self.wfile.flush()
                except Exception:
                    alive[0] = False
            for ev in self._brain_chat_events(text, ctx):
                emit(ev['event'], ev['data'])
                if not alive[0]:
                    break  # client disconnected — stop work
            return

        # Non-stream JSON (back-compat): drain to the terminal event.
        final = None
        for ev in self._brain_chat_events(text, ctx):
            if ev['event'] in ('done', 'error'):
                final = ev
        if not final:
            return self._json(500, {'error': 'no result from brain'})
        if final['event'] == 'error':
            return self._json(final['data'].get('http', 502), final['data'])
        return self._json(200, final['data'])

    def _brain_chat_events(self, text, ctx):
        """Generator: runs the brain tool-loop, yielding {'event','data'} dicts
        ('start' → per-tool 'thinking'/'tool' → terminal 'done'|'error').
        Persists user/assistant turns + the reply. Shared by the SSE and JSON
        paths so there is exactly one brain-chat implementation."""
        # Pick brain chat route: CLIProxy if enabled, else direct Anthropic.
        brain_cfg = (user_config.load().get('brain') or {})
        if self._cliproxy_enabled():
            chat_mode = 'cliproxy'
            chat_base = self._cliproxy_base_url()
            chat_key  = self._cliproxy_api_key()
            chat_model = brain_cfg.get('cliproxy_model') or BRAIN_CHAT_CLIPROXY_MODEL
        else:
            # Honest 503: the tool-calling brain loop speaks the OpenAI-compatible
            # /chat/completions + tools surface, which CLIProxy provides. A direct
            # Anthropic key alone is NOT enough — api.anthropic.com needs x-api-key
            # + /v1/messages + Anthropic-native tool format, which this loop does
            # not implement. (Honest replacement for the previously-broken
            # "direct-anthropic" fallback that silently 4xx'd, 2026-05-29.)
            have_key = bool(self._vendor_key('anthropic'))
            yield {'event': 'error', 'data': {'http': 503, 'error': (
                'Brain chat requires CLIProxy (enable it + set the key in Settings). '
                + ('An Anthropic key is set, but direct-Anthropic tool-calling for the '
                   'brain is not implemented — only generation uses the direct vendor API.'
                   if have_key else 'No CLIProxy and no Anthropic key configured.'))}}
            return

        ts = time.strftime('%Y-%m-%d %H:%M:%S')
        msg_id = f'op-{int(time.time()*1000)}'
        user_entry = {'id': msg_id, 'ts': ts, 'tag': 'brain', 'text': text,
                      'context': ctx, 'status': 'answered'}
        self._append_jsonl(INBOX, user_entry)
        self._append_jsonl(BRAIN_HISTORY, {'ts': ts, 'role': 'user', 'content': text, 'context': ctx})
        yield {'event': 'start', 'data': {'msg_id': msg_id, 'model': chat_model}}

        messages = self._brain_memory_messages()
        ctx_text = json.dumps(ctx, ensure_ascii=False, indent=2) if ctx else '{}'
        messages.append({'role': 'user',
                         'content': f'Current UI context:\n{ctx_text}\n\nBowei message:\n{text}'})

        MAX_ITERATIONS = 40
        tool_log = []
        final_answer = ''
        generated_task = None
        confab_retried = False

        def _persist_and_done(answer, http_partial=None, error=None):
            visible = (answer or '').strip() or '(empty reply)'
            reply = {
                'id': f'rep-{int(time.time()*1000)}',
                'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
                'in_reply_to': msg_id, 'source': chat_mode, 'model': chat_model,
                'text': visible,
                'attached_piece': (generated_task or {}).get('name') or ctx.get('piece_name'),
                'tool_log': tool_log,
            }
            self._append_jsonl(REPLIES, reply)
            self._append_jsonl(BRAIN_HISTORY, {'ts': reply['ts'], 'role': 'assistant', 'content': visible})
            data = {'ok': error is None, 'entry': user_entry, 'reply': reply,
                    'model': chat_model, 'generated_task': generated_task, 'tool_log': tool_log}
            if error:
                data['error'] = error
                if http_partial: data['http'] = http_partial
            return data

        for _iter in range(MAX_ITERATIONS):
            payload = {'model': chat_model, 'messages': messages, 'tools': self.BRAIN_TOOLS,
                       'tool_choice': 'auto', 'temperature': 0.35, 'max_tokens': 2400}
            url = f'{chat_base}/chat/completions'
            headers = {'Authorization': f'Bearer {chat_key}', 'Content-Type': 'application/json'}
            req = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                         headers=headers, method='POST')
            raw = None
            for attempt in range(2):  # one retry on transient 5xx / URLError
                try:
                    with urllib.request.urlopen(req, timeout=300) as resp:
                        raw = resp.read().decode('utf-8', errors='replace')
                    break
                except urllib.error.HTTPError as he:
                    detail = ''
                    try: detail = he.read().decode('utf-8', errors='replace')[:500]
                    except Exception: pass
                    if he.code < 500 or attempt == 1:
                        # Persist partial trace so next turn knows what already ran.
                        yield {'event': 'error', 'data': _persist_and_done(
                            final_answer or f'(brain backend error: HTTP {he.code})',
                            http_partial=502, error=f'{chat_mode} HTTP {he.code}: {detail}')}
                        return
                    time.sleep(1.0)
                except Exception as e:
                    if attempt == 1:
                        yield {'event': 'error', 'data': _persist_and_done(
                            final_answer or '(brain backend unreachable)',
                            http_partial=502, error=f'{chat_mode} call failed: {e}')}
                        return
                    time.sleep(1.0)
            try:
                data = json.loads(raw)
                msg = data['choices'][0]['message']
            except Exception:
                yield {'event': 'error', 'data': _persist_and_done(
                    final_answer, http_partial=502,
                    error=f'{chat_mode} response parse failed')}
                return

            tool_calls = msg.get('tool_calls') or []
            if not tool_calls:
                candidate = msg.get('content') or ''
                if (not tool_log) and (not confab_retried) and self._should_force_tool(text, candidate):
                    confab_retried = True
                    messages.append({'role': 'assistant', 'content': candidate})
                    messages.append({'role': 'user', 'content': (
                        '停。你这一回合没有调用任何工具，却给出了关于实时状态的具体断言'
                        '（打分/改 note/写或读 scratchpad/proposals/tasks/spine/corpus 数量/'
                        '归档/重命名/删除/改设置 等）。这些状态不在你的上下文里，聊天记录只反映'
                        '你「说过」什么、不反映真实状态 —— 所以这是凭空捏造。请立刻调用对应的工具'
                        '拿到真实结果再回答；如果确实不需要调用（例如值没变），明说原因，绝不要谎报。')})
                    yield {'event': 'thinking', 'data': {'note': 'confab-guard retry'}}
                    continue
                final_answer = candidate
                break

            messages.append({'role': 'assistant', 'content': msg.get('content') or '',
                             'tool_calls': tool_calls})
            for tc in tool_calls:
                fn = tc.get('function', {})
                name = fn.get('name') or ''
                raw_args = fn.get('arguments') or '{}'
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except Exception:
                    args = {}
                yield {'event': 'tool', 'data': {'name': name, 'phase': 'start'}}
                result = self._exec_brain_tool(name, args)
                tool_log.append({'name': name, 'args': args, 'ok': result.get('ok', False)})
                if name == 'generate_piece' and result.get('ok'):
                    generated_task = result
                yield {'event': 'tool', 'data': {'name': name, 'phase': 'done',
                                                 'ok': result.get('ok', False)}}
                messages.append({'role': 'tool', 'tool_call_id': tc.get('id'),
                                 'content': json.dumps(result, ensure_ascii=False)})
        else:
            final_answer = '(tool loop reached max iterations; abandoning)'

        yield {'event': 'done', 'data': _persist_and_done(final_answer)}

    # ---- CC: Bowei accepts/rejects a proposal ----------------------------
    def _api_cc_proposal_action(self):
        try:
            body = self._json_body()
            pid    = body.get('id')
            action = body.get('action')  # accept | reject
            note   = body.get('note', '')
            if not pid or action not in ('accept', 'reject'):
                return self._json(400, {'error': 'id + action(accept|reject) required'})
            items = self._read_jsonl(PROPOSALS)
            found = False
            for it in items:
                if it.get('id') == pid:
                    it['status'] = 'accepted' if action == 'accept' else 'rejected'
                    it['decided_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                    if note: it['decision_note'] = note
                    found = True
            if not found: return self._json(404, {'error': 'proposal id not found'})
            self._rewrite_jsonl(PROPOSALS, items)
            open(f'{BRIDGE}/.kick', 'w').write(str(time.time()))
            self._json(200, {'ok': True, 'id': pid, 'action': action})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- CC: task cancel/retry (Bowei-side controls on Claude Code tasks) -
    def _api_cc_task_action(self):
        try:
            body = self._json_body()
            tid = body.get('id'); action = body.get('action')
            if not tid or action not in ('cancel', 'requeue'):
                return self._json(400, {'error': 'id + action(cancel|requeue) required'})
            items = self._read_jsonl(TASKS); ok = False
            for it in items:
                if it.get('id') == tid:
                    it['status'] = 'cancel_requested' if action == 'cancel' else 'queued'
                    it['updated_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                    ok = True
            if not ok: return self._json(404, {'error':'not found'})
            self._rewrite_jsonl(TASKS, items)
            open(f'{BRIDGE}/.kick', 'w').write(str(time.time()))
            self._json(200, {'ok': True})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- CC: kick marker (web wakes CC by leaving a file) ----------------
    def _api_cc_kick(self):
        try:
            open(f'{BRIDGE}/.kick', 'w').write(str(time.time()))
            self._json(200, {'ok': True, 'marker': f'{BRIDGE}/.kick'})
        except Exception as e:
            self._json(500, {'error': str(e)})

    # ---- static + Range ---------------------------------------------------
    # Anti-stale-page: HTML/JS/CSS get Cache-Control: no-store. Audio (mp3/wav)
    # and binary assets stay cacheable (they have content-hash filenames anyway,
    # so they're effectively immutable). This kills the "Cmd+R serves cached
    # main.html" footgun without making playback laggy.
    def _no_cache_for(self, path):
        return path.endswith(('.html', '.js', '.css', '.jsonl', '.json'))

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None
        try:
            fs   = os.fstat(f.fileno())
            size = fs.st_size
            ctype = self.guess_type(path)
            no_cache = self._no_cache_for(path)
            rng = self.headers.get('Range')
            m = re.match(r'bytes=(\d+)-(\d*)', rng) if rng else None
            if m:
                start = int(m.group(1))
                end   = int(m.group(2)) if m.group(2) else size - 1
                end   = min(end, size - 1)
                if start >= size or start > end:
                    self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    f.close(); return None
                length = end - start + 1
                f.seek(start)
                self.send_response(HTTPStatus.PARTIAL_CONTENT)
                self.send_header('Content-Type', ctype)
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.send_header('Content-Length', str(length))
                if no_cache: self.send_header('Cache-Control', 'no-store')
                else:        self.send_header('Last-Modified', self.date_time_string(fs.st_mtime))
                self.end_headers()
                return _RangedFile(f, length)
            self.send_response(HTTPStatus.OK)
            self.send_header('Content-Type', ctype)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(size))
            if no_cache: self.send_header('Cache-Control', 'no-store')
            else:        self.send_header('Last-Modified', self.date_time_string(fs.st_mtime))
            self.end_headers()
            return f
        except Exception:
            f.close()
            raise


class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


# ── Transcript watcher: tail Claude Code session jsonl ────────────────────
# Picks most-recently-modified ~/.claude/projects/-Users-bowei/*.jsonl and
# follows it; extracts assistant text + concise tool-use summaries + user
# messages; appends to cc-bridge/transcript-tail.jsonl (capped at TRANSCRIPT_CAP).
def _transcript_extract(rec):
    """Return list of {ts, kind, text, source_uuid} or [] for noise."""
    try:
        t = rec.get('timestamp') or rec.get('ts') or ''
        typ = rec.get('type')
        msg = rec.get('message') or {}
        role = msg.get('role') if isinstance(msg, dict) else None
        content = msg.get('content') if isinstance(msg, dict) else None
        uid = rec.get('uuid', '')

        # User -> may be plain text or tool_result block list
        if typ == 'user' and isinstance(content, list):
            for c in content:
                if c.get('type') == 'text':
                    return [{'ts': t, 'kind': 'user', 'text': c.get('text','')[:600], 'source_uuid': uid}]
            return []  # skip tool_result-only user records
        if typ == 'user' and isinstance(content, str):
            return [{'ts': t, 'kind': 'user', 'text': content[:600], 'source_uuid': uid}]

        # Assistant -> text + tool_use blocks
        if typ == 'assistant' and isinstance(content, list):
            out = []
            for c in content:
                ct = c.get('type')
                if ct == 'text' and c.get('text','').strip():
                    out.append({'ts': t, 'kind': 'assistant', 'text': c['text'][:600], 'source_uuid': uid})
                elif ct == 'tool_use':
                    nm = c.get('name','?')
                    inp = c.get('input', {}) or {}
                    if nm == 'Bash':
                        desc = inp.get('description') or (inp.get('command','')[:80])
                    elif nm in ('Read','Write','Edit'):
                        desc = inp.get('file_path','')
                    elif nm == 'Agent':
                        desc = inp.get('description') or inp.get('subagent_type','')
                    else:
                        desc = json.dumps({k:v for k,v in inp.items() if k in ('description','query','path','file_path')}, ensure_ascii=False)[:100]
                    out.append({'ts': t, 'kind': 'tool', 'text': f'{nm}: {desc}', 'source_uuid': uid})
            return out
        return []
    except Exception:
        return []

def _pick_active_session():
    try:
        files = glob.glob(f'{CC_SESSION_DIR}/*.jsonl')
        return max(files, key=os.path.getmtime) if files else None
    except Exception: return None

def transcript_watcher():
    """daemon thread; ~2s poll; cap at TRANSCRIPT_CAP entries."""
    current_path = None
    current_pos  = 0
    while True:
        try:
            picked = _pick_active_session()
            if picked != current_path:
                current_path = picked
                current_pos  = 0
            if not current_path: time.sleep(2.0); continue
            sz = os.path.getsize(current_path)
            if sz < current_pos:  # rotated
                current_pos = 0
            if sz > current_pos:
                with open(current_path) as f:
                    f.seek(current_pos)
                    new = f.read()
                    current_pos = f.tell()
                # parse new lines, extract, append
                existing = []
                if os.path.exists(TRANSCRIPT):
                    with open(TRANSCRIPT) as f:
                        existing = [l for l in f if l.strip()]
                added = []
                for line in new.splitlines():
                    if not line.strip(): continue
                    try: rec = json.loads(line)
                    except Exception: continue
                    for ex in _transcript_extract(rec):
                        added.append(json.dumps(ex, ensure_ascii=False))
                if added:
                    combined = (existing + added)[-TRANSCRIPT_CAP:]
                    with open(TRANSCRIPT, 'w') as f:
                        f.write('\n'.join(combined) + '\n')
        except Exception as e:
            print(f'[transcript-watcher] {e}')
        time.sleep(2.0)


def _toolchain_preflight():
    """Best-effort check that the render toolchain is reachable, so a fresh
    machine gets ONE clear boot warning instead of a cryptic per-piece
    'auto-render failed' later. Non-fatal."""
    warns = []
    try:
        r = subprocess.run(['/usr/bin/env', 'pnpm', '-s', 'exec', 'tsx', '--version'],
                           cwd=os.path.join(ROOT, 'apps/cli'),
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            warns.append("pnpm/tsx not runnable in apps/cli (run `pnpm install`).")
    except Exception as e:
        warns.append(f'render toolchain check failed: {e} (run `pnpm install` + `pnpm exec playwright install chromium`).')
    if warns:
        print('⚠ render toolchain warnings — generation may fail until fixed:')
        for w in warns: print('   · ' + w)

def main():
    os.chdir(ROOT)
    # Line-buffer stdout so background-thread prints ([brain bg gen] etc.) flush
    # promptly to the log instead of sitting in a block buffer (debuggability).
    try: sys.stdout.reconfigure(line_buffering=True); sys.stderr.reconfigure(line_buffering=True)
    except Exception: pass
    threading.Thread(target=transcript_watcher, daemon=True).start()
    threading.Thread(target=_toolchain_preflight, daemon=True).start()
    try:
        srv = ThreadedHTTPServer(('127.0.0.1', PORT), H)
    except OSError as e:
        print(f'✗ cannot bind 127.0.0.1:{PORT} — {e}')
        print(f'   Port in use? Find it:  lsof -i :{PORT}    Kill it, or set CACTUS_PORT=<other> and retry.')
        raise SystemExit(1)
    with srv:
        print(f'CactusStrudel Runtime → {URL}')
        print( '   (threaded + Range + cc-bridge + transcript-watcher)')
        threading.Timer(1.0, lambda: webbrowser.open(URL)).start()
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped.')


if __name__ == '__main__':
    main()
