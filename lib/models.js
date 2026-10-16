'use strict';
// Free-model pool: live list (3 s) -> fresh cache (1 h) -> stale cache -> builtin. Ranking: rank table, else name/family heuristic.
// Quota state: per worker JSON, locked + atomic; only FUTURE reset times are honoured; clock-skew safe.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const U = require('./util');
const W = require('./workers');
const G = require('./gate');

const CACHE_TTL = 3600 * 1000;
const FETCH_TIMEOUT = 3000;

function hasProxyEnv(env = process.env) { return ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'HTTP_PROXY', 'http_proxy'].some((k) => env[k]); }
function curlJSON(url, timeoutMs) {
  const r = cp.spawnSync('curl', ['-fsSL', '-m', String(Math.ceil(timeoutMs / 1000)), '-D', '-', '-H', 'User-Agent: free-agent-crew', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs + 1500, windowsHide: true });
  if (r.status !== 0) throw new Error('curl:' + (r.error ? r.error.code : 'rc' + r.status));
  const parts = r.stdout.split(/\r?\n\r?\n/); let body = r.stdout; let date = null;
  while (parts.length > 1 && /^HTTP\//.test(parts[0])) { const h = parts.shift(); const m = h.match(/^date:\s*(.+)$/im); if (m) date = m[1].trim(); body = parts.join('\n\n'); }
  return { data: JSON.parse(body), date };
}
async function nodeFetchJSON(url, timeoutMs) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'free-agent-crew', Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { data: await r.json(), date: r.headers.get('date') };
  } catch (e) { throw new Error('fetch:' + (e.name === 'AbortError' ? 'timeout' : e.message)); } finally { clearTimeout(t); }
}
// One attempt, hard 3 s budget. With a proxy env set, curl goes first (Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1).
async function fetchJSON(url, timeoutMs = FETCH_TIMEOUT) {
  const viaCurl = hasProxyEnv() && !process.env.NODE_USE_ENV_PROXY;
  if (viaCurl || typeof fetch !== 'function') {
    try { return curlJSON(url, timeoutMs); } catch (e) { if (typeof fetch !== 'function') throw e; if (!/ENOENT/.test(e.message)) throw e; }
  }
  return nodeFetchJSON(url, timeoutMs);
}

function cachePath(w) { return path.join(U.stateDir(), `${w.name}-free-models.json`); }
function statePath(w) { return path.join(U.stateDir(), `${w.name}-quota-state.json`); }

async function freePool(w, { refresh = false, override = process.env[`CREW_${w.name.toUpperCase()}_FREE_MODELS`] || '', bin = null } = {}) {
  const info = [];
  const ov = String(override).split(/[\s,]+/).filter(Boolean);
  if (ov.length) return { models: ov, src: 'env', info, ordered: true };
  const cache = U.readJSON(cachePath(w), null);
  const now = Date.now();
  const fresh = cache && Array.isArray(cache.models) && cache.models.length && typeof cache.fetched_at === 'number'
    && now - cache.fetched_at < CACHE_TTL && cache.fetched_at <= now + 300000; // future fetched_at = clock went back -> refetch
  if (fresh && !refresh) return { models: cache.models, src: 'cache', info };
  let live = null;
  try {
    const { data } = await fetchJSON(process.env[`CREW_${w.name.toUpperCase()}_URL`] || w.url);
    live = w.parseFree(data);
    if (!live.length) info.push('live_list_empty');
  } catch (e) { info.push('fetch_failed ' + e.message); }
  if (live && live.length && w.cliModels && bin) { // opencode: keep only models this CLI version knows
    try {
      const r = cp.spawnSync(bin, w.cliModels, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, shell: U.IS_WIN && /\.(cmd|bat)$/i.test(bin) });
      const cli = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith(w.modelPrefix));
      if (cli.length) { const both = live.filter((m) => cli.includes(m)); const dropped = live.filter((m) => !cli.includes(m)); if (dropped.length) info.push('live_not_in_cli=' + dropped.join(',')); if (both.length) live = both; }
    } catch (_) {}
  }
  if (live && live.length) {
    try { U.writeJSONAtomic(cachePath(w), { fetched_at: now, models: live }); } catch (_) {}
    return { models: live, src: 'live', info };
  }
  if (cache && Array.isArray(cache.models) && cache.models.length) return { models: cache.models, src: 'stale_cache', info };
  return { models: w.builtin.slice(), src: 'builtin', info };
}

// ---- ranking ----
function rankTable(w) {
  const base = U.readJSON(path.join(U.PKG_ROOT, 'data', `${w.name}-model-rank.json`), {});
  const user = U.readJSON(path.join(U.configDir(), `${w.name}-model-rank.json`), {});
  return Object.assign({}, (base && base.models) || {}, (user && user.models) || {});
}
const TIER = [['preview', 6], ['pro', 10], ['max', 10], ['ultra', 6], ['plus', 5], ['flagship', 8], ['coder', 5], ['code', 3], ['thinking', 3], ['reasoning', 3],
  ['mini', -12], ['flash', -6], ['lite', -15], ['nano', -20], ['small', -12], ['tiny', -20], ['air', -8], ['xs', -12], ['lightning', -15], ['contributor', -5], ['note', -6]];
// family prior: rough capability of the vendor's current line (only for models missing from the rank table).
const FAMILY = [[/step/, 10], [/deepseek/, 9], [/kimi|moonshot/, 8], [/qwen/, 7], [/glm|zhipu/, 7], [/ling|inclusion/, 7], [/mimo|xiaomi/, 5], [/minimax/, 5],
  [/longcat/, 4], [/gpt-oss|openai/, 5], [/claude|anthropic/, 8], [/gemini/, 6], [/grok/, 6], [/nemotron/, 1], [/llama/, 0], [/gemma/, -3], [/mistral|devstral|codestral/, 3], [/solar/, -3], [/pickle|stealth/, 0]];
function heuristic(m) {
  const full = String(m).toLowerCase();
  const n = full.split('/').pop().replace(/:free$/, '').replace(/-free$/, '');
  let s = 50;
  for (const [k, v] of TIER) if (new RegExp(`(^|[-_.])${k}($|[-_.\\d])`).test(n)) s += v;
  for (const [re, v] of FAMILY) if (re.test(full)) { s += v; break; }
  const b = n.match(/(\d+(?:\.\d+)?)b(?:[-_.]|$)/); // parameter count, e.g. 550b
  if (b) s += Math.max(-6, Math.min(10, Math.log2(parseFloat(b[1]) / 30) * 3));
  const v = n.match(/(\d+(?:\.\d+)?)/);
  if (v && !b) s += Math.min(parseFloat(v[1]), 10) * 0.5;
  return Math.round(s * 10) / 10;
}
function scoreOf(m, table, info) {
  const r = table[m];
  if (r && typeof r === 'object' && 'score' in r) {
    const x = Number(r.score);
    if (Number.isFinite(x)) return x;
    info && info.push(`rank_bad_score model=${m}`);
  }
  const h = heuristic(m);
  info && info.push(`rank_unknown model=${m} heuristic=${h}`);
  return h;
}
function rankModels(w, models, { ordered = false, info = [] } = {}) {
  if (ordered) return models.slice();
  const t = rankTable(w);
  const sc = new Map(models.map((m) => [m, scoreOf(m, t, info)]));
  return models.slice().sort((a, b) => sc.get(b) - sc.get(a));
}

// ---- quota state ----
const MAX_FUTURE = 8 * 86400 * 1000;
function validEntry(e, now) {
  return e && typeof e === 'object' && typeof e.reset_at === 'number' && Number.isFinite(e.reset_at) && e.reset_at > now && e.reset_at < now + MAX_FUTURE
    && !(typeof e.marked_at === 'number' && e.marked_at > now + 300000); // marked in the "future" = clock jumped back: ignore
}
function readState(w) {
  const st = U.readJSON(statePath(w), {});
  return st && typeof st === 'object' && !Array.isArray(st) ? st : {};
}
function exhaustedMap(w, now = Date.now()) {
  const st = readState(w); const out = {};
  for (const [k, v] of Object.entries(st)) {
    if (!validEntry(v, now)) continue;
    out[k] = v;
  }
  return out;
}
// Reset time from the error text: future ISO stamp > "reset/try again in 5h 29m" > retry-after > worker default.
function parseReset(w, txt, now = Date.now()) {
  txt = U.stripAnsi(txt || '');
  for (const m of txt.matchAll(W.ISO_RE)) {
    const t = Date.parse(m[1].replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
    if (Number.isFinite(t) && t > now + 30000 && t < now + MAX_FUTURE) return { at: t, how: 'iso' };
  }
  const rel = txt.match(/(?:reset|try again|retry)[^\n]{0,30}?in\s+(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?)?)?)?/i);
  if (rel && (rel[1] || rel[2] || rel[3])) return { at: now + (+(rel[1] || 0) * 3600 + +(rel[2] || 0) * 60 + +(rel[3] || 0)) * 1000, how: 'relative' };
  const ra = txt.match(/retry.?after["']?\s*[:=]?\s*["']?(\d+)/i);
  if (ra) return { at: now + Math.max(30, +ra[1]) * 1000, how: 'retry_after' };
  if (w.cooldown === 'next_hour') { const d = new Date(now); d.setMinutes(0, 0, 0); return { at: d.getTime() + 3600000, how: 'next_hour' }; }
  const d = new Date(now); return { at: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1), how: 'utc_midnight' };
}
function markExhausted(w, model, txt, now = Date.now()) {
  const r = parseReset(w, txt, now);
  U.withLock(statePath(w), () => {
    const st = readState(w); const keep = {};
    for (const [k, v] of Object.entries(st)) if (validEntry(v, now)) keep[k] = v; // prune expired / corrupt entries
    keep[model] = { reset_at: r.at, marked_at: now, source: r.how, reset_local: U.isoLocal(r.at) };
    U.writeJSONAtomic(statePath(w), keep);
  });
  return r;
}
function clearExhausted(w, model) {
  U.withLock(statePath(w), () => { const st = readState(w); if (model) delete st[model]; U.writeJSONAtomic(statePath(w), model ? st : {}); });
}

async function plan(w, { pref = '', refresh = false, bin = null } = {}) {
  const pool = await freePool(w, { refresh, bin });
  const info = pool.info.slice(); info.push(`pool src=${pool.src} n=${pool.models.length}`);
  let ranked; let excluded = []; let provisional = [];
  try { // capability gate: below-baseline models never enter rotation; unrated ones are provisional (after rated ones)
    const bm = await G.bench(fetchJSON, info);
    const g = G.apply(pool.models, rankTable(w), bm.models, { ordered: pool.ordered, info });
    info.push(`gate min=${g.cfg.min} bench=${bm.src}`);
    ranked = g.eligible; excluded = g.excluded; provisional = g.provisional;
  } catch (e) { info.push('gate_error ' + e.message + '（门槛未生效，按旧排序）'); ranked = rankModels(w, pool.models, { ordered: pool.ordered, info }); }
  const order = pref ? [pref, ...ranked.filter((m) => m !== pref)] : ranked; // explicit --model is never gated
  const ex = exhaustedMap(w);
  const avail = []; const skipped = [];
  for (const m of order) { if (ex[m] && m !== pref) skipped.push({ model: m, until: ex[m].reset_at }); else avail.push(m); }
  info.push('order=' + order.join(','));
  return { src: pool.src, all: order, avail, skipped, info, excluded, provisional, gateMsg: G.humanExcluded(excluded) };
}

module.exports = { fetchJSON, freePool, rankModels, heuristic, scoreOf, rankTable, parseReset, markExhausted, clearExhausted, exhaustedMap, readState, statePath, cachePath, plan, validEntry };
