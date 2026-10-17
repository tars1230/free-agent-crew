#!/usr/bin/env python3
"""model-discover (proposal, 2026-10-18): daily diff of the free-model lists of kilo / cline / opencode against
(a) the last seen list and (b) the rank tables; also watches OpenRouter for new dated snapshots of ranked models
(e.g. deepseek-v4.1-flash-1017).  New / unranked / snapshot-updated models are reported and appended to an eval queue.
It never edits rank tables (curation stays manual + model_gate rules).  Queue entries are never re-queued once present in
any status (set status to done/rejected by hand under the same QUEUE.lock).  --dry-run: print only, write nothing.
Env: MODEL_DISCOVER_STATE (seen file), MODEL_EVAL_QUEUE (jsonl), MODEL_DISCOVER_ALERT, MODEL_DISCOVER_LOG,
     MODEL_RANK_DIR (default ~/.shared/config), OPENCODE_REAL (default opencode)."""
import json, os, re, subprocess, sys, time, urllib.request, datetime, fcntl
H = os.path.expanduser
RANK_DIR = os.environ.get('MODEL_RANK_DIR') or H('~/.shared/config')
STATE = os.environ.get('MODEL_DISCOVER_STATE') or H('~/.shared/state/model-discover-seen.json')
QUEUE = os.environ.get('MODEL_EVAL_QUEUE') or H('~/.shared/config/model-eval-queue.jsonl')
ALERT = os.environ.get('MODEL_DISCOVER_ALERT') or H('~/.shared/alerts/model-discover.alert')
LOG = os.environ.get('MODEL_DISCOVER_LOG') or H('~/.shared/logs/model-discover.log')
DRY = '--dry-run' in sys.argv
NOW = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
KILO_EXCL = re.compile(r'^kilo-auto/|^openrouter/free$|content-safety|lyria|music|audio|tts|lfm-|embed|guard', re.I)  # = kilo-auto

def get(url, t=8):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'model-discover'}), timeout=t))

def pool_opencode(notes):
    isfree = lambda i: (i.endswith('-free') or i == 'big-pickle') and not i.startswith('jev')   # = opencode-auto
    api = cli = None
    try: api = {'opencode/' + x['id'] for x in get('https://opencode.ai/zen/v1/models').get('data', []) if isfree(x.get('id', ''))}
    except Exception as e: notes.append('opencode api_failed %s' % type(e).__name__)
    try:
        p = subprocess.run([os.environ.get('OPENCODE_REAL', '/opt/homebrew/bin/opencode'), 'models', 'opencode'], stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, timeout=30)
        cli = {l.strip() for l in p.stdout.splitlines() if l.startswith('opencode/') and isfree(l.strip().split('/', 1)[1])}
    except Exception as e: notes.append('opencode cli_failed %s' % type(e).__name__)
    if api and cli and api - cli:   # opencode-auto silently drops these; make them visible (10-15 deepseek case)
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

def norm(m):
    n = str(m).lower().split('/')[-1]; n = re.sub(r':free$', '', n); return re.sub(r'-free$', '', n)

def key(e):   # dedupe key; new_unranked/unranked are the same thing for the queue (review2 #3)
    r = e.get('reason', ''); r = 'unranked' if r == 'new_unranked' else r
    return (e.get('agent'), e.get('model'), r, e.get('snapshot', ''))

def main():
    notes, events = [], []
    lk = None
    if not DRY:   # one lock around the whole read-compute-write of STATE and QUEUE (review2 #1)
        os.makedirs(os.path.dirname(QUEUE), exist_ok=True)
        lk = open(QUEUE + '.lock', 'a'); fcntl.flock(lk, fcntl.LOCK_EX)
    try: seen = json.load(open(STATE))
    except Exception: seen = {}
    ranked_norms = {}
    for w, fn in (('opencode', pool_opencode), ('kilo', pool_kilo), ('cline', pool_cline)):
        try: rank = json.load(open(os.path.join(RANK_DIR, '%s-model-rank.json' % w))).get('models', {})
        except Exception: rank = {}; notes.append('%s rank_table_missing' % w)
        for k in rank: ranked_norms.setdefault(norm(k), set()).add(w)
        try: pool = fn(notes)
        except Exception as e: notes.append('%s list_failed %s (本次不更新该家 seen)' % (w, type(e).__name__)); continue
        if not pool: notes.append('%s list_empty (不更新 seen)' % w); continue
        first_run = w not in seen          # per-agent baseline: first sight of an agent only records, no flood
        prev = set(seen.get(w, {}).get('models', []))
        for m in sorted(pool) if not first_run else []:   # first sight of an agent: record baseline only, no events
            if m not in rank: events.append({'agent': w, 'model': m, 'reason': 'unranked' if m in prev else 'new_unranked'})
            elif m not in prev: events.append({'agent': w, 'model': m, 'reason': 'new_ranked'})
        for m in sorted(prev - pool): notes.append('%s gone=%s' % (w, m))
        seen[w] = {'models': sorted(pool), 'checked_at': NOW}
    # upstream dated snapshots of models we already rank (OpenRouter public catalogue, no key)
    try:
        cut = time.time() - 30 * 86400; snap_seen = set(seen.get('_snapshots', []))
        for x in get('https://openrouter.ai/api/v1/models', 15).get('data', []):
            i = x.get('id', ''); n = norm(i); mm = re.match(r'^(.*?)-((?:0[1-9]|1[0-2])[0-3]\d|\d{2}(?:0[1-9]|1[0-2])[0-3]\d|20\d{2}(?:-?(?:0[1-9]|1[0-2])-?[0-3]\d))$', n)   # MMDD / YYMMDD / YYYY[-]MM[-]DD
            if mm and mm.group(1) in ranked_norms and (x.get('created') or 0) > cut and i not in snap_seen:
                aa = ((x.get('benchmarks') or {}).get('artificial_analysis') or {}).get('intelligence_index')
                for w in sorted(ranked_norms[mm.group(1)]):
                    events.append({'agent': w, 'model': mm.group(1), 'reason': 'upstream_snapshot', 'snapshot': i,
                                   'created': datetime.datetime.fromtimestamp(x['created']).astimezone().isoformat(timespec='seconds'), 'or_aa': aa})
                snap_seen.add(i)
        seen['_snapshots'] = sorted(snap_seen)
    except Exception as e: notes.append('openrouter_failed %s' % type(e).__name__)
    for e in events: print('EVENT', json.dumps(e, ensure_ascii=False))
    for n in notes: print('NOTE', n)
    if DRY: return 0
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    t = STATE + '.tmp'; json.dump(seen, open(t, 'w'), ensure_ascii=False, indent=1); os.replace(t, STATE)
    pend = set()
    try:
        for l in open(QUEUE):
            try: q = json.loads(l)
            except Exception: continue          # skip a torn line, keep reading the rest
            pend.add(key(q))   # any status counts: a rejected/done entry is terminal and is never re-queued (review2 #2)
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
    with open(LOG, 'a') as f: f.write('%s events=%d queued=%d notes=%s\n' % (NOW, len(events), len(new), ' | '.join(notes)))
    lk.close()
    return 0

if __name__ == '__main__': sys.exit(main())
