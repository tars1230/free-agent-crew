#!/usr/bin/env python3
"""model-discover v4 (2026-10-18): daily diff of kilo / cline / opencode free lists plus
cursor-agent (`--list-models`) and agy (`models`) against (a) last seen and (b) rank tables;
also watches OpenRouter for dated snapshots of ranked models. New / unranked / snapshot-updated
models go to the eval queue and alert. Never edits rank tables; never runs model inference
(list-only). Queue entries are never re-queued once present in any status. --dry-run: print only.
Env: MODEL_DISCOVER_STATE, MODEL_EVAL_QUEUE, MODEL_DISCOVER_ALERT, MODEL_DISCOVER_LOG,
     MODEL_RANK_DIR (default ~/.shared/config), OPENCODE_REAL, CURSOR_AGENT_BIN, AGY_BIN,
     MODEL_DISCOVER_TIMEOUT (default 30)."""
import json, os, re, shutil, subprocess, sys, time, urllib.request, datetime, fcntl
H = os.path.expanduser
RANK_DIR = os.environ.get('MODEL_RANK_DIR') or H('~/.shared/config')
STATE = os.environ.get('MODEL_DISCOVER_STATE') or H('~/.shared/state/model-discover-seen.json')
QUEUE = os.environ.get('MODEL_EVAL_QUEUE') or H('~/.shared/config/model-eval-queue.jsonl')
ALERT = os.environ.get('MODEL_DISCOVER_ALERT') or H('~/.shared/alerts/model-discover.alert')
LOG = os.environ.get('MODEL_DISCOVER_LOG') or H('~/.shared/logs/model-discover.log')
DRY = '--dry-run' in sys.argv
NOW = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
TIMEOUT = float(os.environ.get('MODEL_DISCOVER_TIMEOUT') or 30)
KILO_EXCL = re.compile(r'^kilo-auto/|^openrouter/free$|content-safety|lyria|music|audio|tts|lfm-|embed|guard', re.I)

def get(url, t=8):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'model-discover'}), timeout=t))

def run_cli(argv, notes, label, timeout=None):
    """Run a list-only CLI; return stdout or None on missing/error (skip that source)."""
    timeout = TIMEOUT if timeout is None else timeout
    bin0 = argv[0]
    if not os.path.isabs(bin0) and not shutil.which(bin0):
        notes.append('%s cli_missing' % label); return None
    if os.path.isabs(bin0) and not os.path.isfile(bin0):
        notes.append('%s cli_missing' % label); return None
    try:
        p = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        notes.append('%s cli_timeout' % label); return None
    except Exception as e:
        notes.append('%s cli_failed %s' % (label, type(e).__name__)); return None
    if p.returncode != 0:
        notes.append('%s cli_rc=%s' % (label, p.returncode)); return None
    return p.stdout or ''

def pool_opencode(notes):
    isfree = lambda i: (i.endswith('-free') or i == 'big-pickle') and not i.startswith('jev')
    api = cli = None
    try:
        api = {'opencode/' + x['id'] for x in get('https://opencode.ai/zen/v1/models').get('data', []) if isfree(x.get('id', ''))}
    except Exception as e:
        notes.append('opencode api_failed %s' % type(e).__name__)
    out = run_cli([os.environ.get('OPENCODE_REAL', '/opt/homebrew/bin/opencode'), 'models', 'opencode'], notes, 'opencode')
    if out is not None:
        cli = {l.strip() for l in out.splitlines() if l.startswith('opencode/') and isfree(l.strip().split('/', 1)[1])}
    if api and cli and api - cli:
        notes.append('opencode api_not_in_cli=%s (升级 opencode CLI 后才会进轮换)' % ','.join(sorted(api - cli)))
    return (api or set()) | (cli or set())

def pool_kilo(notes):
    out = set()
    for x in get('https://api.kilo.ai/api/gateway/models').get('data', []):
        i = x.get('id', ''); om = (x.get('architecture') or {}).get('output_modalities') or ['text']
        if x.get('isFree') and not KILO_EXCL.search(i) and 'text' in om: out.add('kilo/' + i)
    return out

def pool_cline(notes):
    return {x['id'] for x in get('https://api.cline.bot/api/v1/ai/cline/recommended-models').get('free', []) if x.get('id')}

def pool_cursor_agent(notes):
    """cursor-agent --list-models: lines like `id - Display Name`. List-only, no inference."""
    bin0 = os.environ.get('CURSOR_AGENT_BIN') or shutil.which('cursor-agent') or H('~/.local/bin/cursor-agent')
    out = run_cli([bin0, '--list-models'], notes, 'cursor-agent')
    if out is None: return set()
    ids = set()
    for l in out.splitlines():
        l = l.strip()
        if not l or l.startswith('Available') or l.startswith('Tip:') or l.startswith('Usage:'):
            continue
        mid = l.split(' - ', 1)[0].strip() if ' - ' in l else (l.split()[0] if l.split() else '')
        if mid and re.match(r'^[A-Za-z0-9][\w.\-]*$', mid):
            ids.add(mid)
    return ids

def pool_agy(notes):
    """agy models: tab- or space-separated id. List-only, no inference."""
    bin0 = os.environ.get('AGY_BIN') or shutil.which('agy') or H('~/.local/bin/agy')
    out = run_cli([bin0, 'models'], notes, 'agy')
    if out is None: return set()
    ids = set()
    for l in out.splitlines():
        l = l.strip()
        if not l or l.lower().startswith('fetching') or l.lower().startswith('available'):
            continue
        mid = l.split('\t', 1)[0].strip() if '\t' in l else l.split()[0]
        if mid and re.match(r'^[A-Za-z0-9][\w.\-]*$', mid):
            ids.add(mid)
    return ids

def norm(m):
    n = str(m).lower().split('/')[-1]
    n = re.sub(r':free$', '', n)
    return re.sub(r'-free$', '', n)

def key(e):
    r = e.get('reason', '')
    r = 'unranked' if r == 'new_unranked' else r
    return (e.get('agent'), e.get('model'), r, e.get('snapshot', ''))

SOURCES = (
    ('opencode', pool_opencode, 'opencode-model-rank.json'),
    ('kilo', pool_kilo, 'kilo-model-rank.json'),
    ('cline', pool_cline, 'cline-model-rank.json'),
    ('cursor-agent', pool_cursor_agent, 'subscription-model-rank.json'),
    ('agy', pool_agy, 'subscription-model-rank.json'),
)

def main():
    notes, events = [], []
    lk = None
    if not DRY:
        os.makedirs(os.path.dirname(QUEUE), exist_ok=True)
        lk = open(QUEUE + '.lock', 'a'); fcntl.flock(lk, fcntl.LOCK_EX)
    try: seen = json.load(open(STATE))
    except Exception: seen = {}
    ranked_norms = {}
    for w, fn, rank_fn in SOURCES:
        try: rank = json.load(open(os.path.join(RANK_DIR, rank_fn))).get('models', {})
        except Exception: rank = {}; notes.append('%s rank_table_missing' % w)
        for k in rank: ranked_norms.setdefault(norm(k), set()).add(w)
        try: pool = fn(notes)
        except Exception as e:
            notes.append('%s list_failed %s (本次不更新该家 seen)' % (w, type(e).__name__)); continue
        if not pool:
            notes.append('%s list_empty (不更新 seen)' % w); continue
        first_run = w not in seen
        prev = set(seen.get(w, {}).get('models', []))
        for m in sorted(pool) if not first_run else []:
            if m not in rank:
                events.append({'agent': w, 'model': m, 'reason': 'unranked' if m in prev else 'new_unranked'})
            elif m not in prev:
                events.append({'agent': w, 'model': m, 'reason': 'new_ranked'})
        for m in sorted(prev - pool):
            notes.append('%s gone=%s' % (w, m))
        seen[w] = {'models': sorted(pool), 'checked_at': NOW, 'rank_file': rank_fn}
    try:
        cut = time.time() - 30 * 86400; snap_seen = set(seen.get('_snapshots', []))
        for x in get('https://openrouter.ai/api/v1/models', 15).get('data', []):
            i = x.get('id', ''); n = norm(i)
            mm = re.match(r'^(.*?)-((?:0[1-9]|1[0-2])[0-3]\d|\d{2}(?:0[1-9]|1[0-2])[0-3]\d|20\d{2}(?:-?(?:0[1-9]|1[0-2])-?[0-3]\d))$', n)
            if mm and mm.group(1) in ranked_norms and (x.get('created') or 0) > cut and i not in snap_seen:
                aa = ((x.get('benchmarks') or {}).get('artificial_analysis') or {}).get('intelligence_index')
                for w in sorted(ranked_norms[mm.group(1)]):
                    events.append({'agent': w, 'model': mm.group(1), 'reason': 'upstream_snapshot', 'snapshot': i,
                                   'created': datetime.datetime.fromtimestamp(x['created']).astimezone().isoformat(timespec='seconds'), 'or_aa': aa})
                snap_seen.add(i)
        seen['_snapshots'] = sorted(snap_seen)
    except Exception as e:
        notes.append('openrouter_failed %s' % type(e).__name__)
    for e in events: print('EVENT', json.dumps(e, ensure_ascii=False))
    for n in notes: print('NOTE', n)
    if DRY: return 0
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    t = STATE + '.tmp'; json.dump(seen, open(t, 'w'), ensure_ascii=False, indent=1); os.replace(t, STATE)
    pend = set()
    try:
        for l in open(QUEUE):
            try: q = json.loads(l)
            except Exception: continue
            pend.add(key(q))
    except FileNotFoundError: pass
    new = [e for e in events if key(e) not in pend]
    if new:
        os.makedirs(os.path.dirname(QUEUE), exist_ok=True)
        with open(QUEUE, 'a') as f:
            for e in new: f.write(json.dumps(dict(e, ts=NOW, status='pending'), ensure_ascii=False) + '\n')
        os.makedirs(os.path.dirname(ALERT), exist_ok=True)
        with open(ALERT, 'a') as f:
            f.write('%s model-discover: %d 个待评测（%s），队列 %s\n' % (NOW, len(new), ', '.join('%s:%s' % (e['reason'], e.get('snapshot') or e['model']) for e in new[:6]), QUEUE))
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, 'a') as f:
        f.write('%s events=%d queued=%d notes=%s\n' % (NOW, len(events), len(new), ' | '.join(notes)))
    if lk is not None: lk.close()
    return 0

if __name__ == '__main__':
    sys.exit(main())
