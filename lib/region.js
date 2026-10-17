'use strict';
// Region block list (mirrors model_gate.region_* + the wrappers' region_hit/region_block/region_ok, 2026-10-17).
// A provider-side region/country refusal is not a quota or network problem: retrying is useless and proxies are not a fix.
// Such models are recorded in <config>/region-blocked-models.json (MODEL_REGION_BLOCK_FILE overrides), skipped by the planner
// until next_retry_ts (MODEL_REGION_RETRY_DAYS, default 7 days after the last region failure), then ONE run probes again
// (claimed for MODEL_REGION_PROBE_HOLD s so concurrent runs don't stampede). Success removes the entry; another region error
// re-blocks it. An explicit --model is never skipped. Same file format as the reference (ts in seconds). Never throws.
const path = require('path');
const U = require('./util');

const REGION_RE = new RegExp([
  'not available in (?:your|this|the current) (?:region|country|location)',
  'unsupported[_ ]country[_ ]region[_ ]territory',
  '(?:region|country|territory|location)[^\\n]{0,60}?(?:not (?:available|supported|allowed)|forbidden|restricted|blocked|unavailable)',
  '(?:forbidden|denied|restricted|blocked|unavailable|\\b403\\b)[^\\n]{0,80}?\\b(?:region|country|territory)\\b'].join('|'), 'i');
const envNum = (k, d) => { const v = Number(process.env[k]); return process.env[k] !== undefined && process.env[k] !== '' && Number.isFinite(v) ? v : d; };
const retryDays = () => envNum('MODEL_REGION_RETRY_DAYS', 7);
function file() { return process.env.MODEL_REGION_BLOCK_FILE || path.join(U.configDir(), 'region-blocked-models.json'); }
const isoS = (s) => U.isoLocal(s * 1000);
// -> first error line that looks like a region/country restriction (ANSI stripped, <= 500 chars), else null.
// Stricter than the reference (v1.3.3): a line must also read like an error, and our own identifiers / file names
// (region-blocked-models.json, region_blocked=..., lib/region.js) never count. The reference REGION_RE alone matched an
// `ls` line "region-blocked-models.example.json" in a CLI's tool output and blocked three healthy models (2026-10-18).
const ERRISH = /error|forbidden|denied|\b403\b|unsupported|not available|restricted|unavailable/i;
const OWN = /region[-_.](?:blocked|skip|retry|recovered|error|filter|state|file|match|mark|clear|js)|region-blocked-models/i;
function match(txt) {
  for (const l of U.stripAnsi(txt || '').split(/\r?\n/)) if (REGION_RE.test(l) && ERRISH.test(l) && !OWN.test(l)) return l.trim().slice(0, 500);
  return null;
}
function load() {
  const d = U.readJSON(file(), null);
  return d && typeof d === 'object' && !Array.isArray(d) && d.models && typeof d.models === 'object' && !Array.isArray(d.models) ? d : { models: {} };
}
function update(fn) { // read-modify-write under the lock, atomic replace; -> fn's result, or undefined on any error
  try {
    return U.withLock(file(), () => {
      const d = load(); const r = fn(d.models, Date.now() / 1000);
      d._note = `地区限制屏蔽名单（crew 遇到 region/forbidden 报错时自动写入）。next_retry 之前所有自动选择都跳过该模型；到期后由一次真实调用复查，成功即移除，再报地区错误则顺延 ${retryDays()} 天。地区限制是厂商政策，不要用代理绕过。手工解除：删掉对应条目。`;
      U.writeJSONAtomic(file(), d); return r;
    });
  } catch (_) { return undefined; }
}
function mark(model, agent, text) { // -> next_retry iso string, or null when the write failed
  const line = match(text) || String(text || '').trim().slice(0, 500);
  const r = update((ms, now) => {
    const e = ms[model] && typeof ms[model] === 'object' ? ms[model] : {}; const nxt = now + retryDays() * 86400;
    Object.assign(e, { first_blocked_at: e.first_blocked_at || isoS(now), last_failed_at: isoS(now), last_failed_ts: now, next_retry_at: isoS(nxt),
      next_retry_ts: nxt, count: (parseInt(e.count, 10) || 0) + 1, agent, error: line });
    delete e.probe_claimed_at; ms[model] = e; return e.next_retry_at;
  });
  return r || null;
}
function clear(model) { // a successful run: drop it. -> true if it was listed
  if (!(model in load().models)) return false;
  return !!update((ms) => { const had = model in ms; delete ms[model]; return had; });
}
function state(models, now = Date.now() / 1000) { // read-only: {model: entry + state 'blocked'|'due'} for listed models
  const out = {};
  for (const [m, e] of Object.entries(load().models)) {
    if (!models.includes(m) || !e || typeof e !== 'object') continue;
    const n = typeof e.next_retry_ts === 'number' && Number.isFinite(e.next_retry_ts) ? e.next_retry_ts : now + 86400; // malformed: blocked
    out[m] = { ...e, state: n > now ? 'blocked' : 'due' };
  }
  return out;
}
// planner helper: drop blocked models (pref kept); a due model stays for one probe (claimed). -> {order, skipped:[{model,until}]}
function filter(order, pref = '', info = [], { claim = true } = {}) {
  let st; try { st = state(order); } catch (e) { info.push('region_error ' + e.message + '（地区屏蔽名单未生效）'); return { order, skipped: [] }; }
  const kept = []; const skipped = [];
  for (const m of order) {
    const e = st[m];
    if (!e || m === pref) { kept.push(m); continue; }
    if (e.state === 'blocked') { skipped.push({ model: m, until: e.next_retry_at || null }); info.push(`region_skip model=${m} until=${e.next_retry_at}（地区不可用，已跳过）`); continue; }
    if (claim) {
      const hold = envNum('MODEL_REGION_PROBE_HOLD', 3600);
      const ok = update((ms, now) => {
        const x = ms[m]; if (!x || typeof x !== 'object') return true; // already cleared by another run
        const n = typeof x.next_retry_ts === 'number' ? x.next_retry_ts : 0; if (n > now) return false; // someone else claimed it
        Object.assign(x, { probe_claimed_at: isoS(now), next_retry_ts: now + hold, next_retry_at: isoS(now + hold) }); return true;
      });
      if (ok === false) { skipped.push({ model: m, until: null }); info.push(`region_skip model=${m}（另一个进程正在复查）`); continue; }
    }
    kept.push(m); info.push(`region_retry_due model=${m}（屏蔽满 ${retryDays()} 天，本次复查一次）`);
  }
  return { order: kept, skipped };
}
module.exports = { REGION_RE, file, match, load, mark, clear, state, filter };
