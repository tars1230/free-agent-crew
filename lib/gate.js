'use strict';
// Capability gate (mirrors the reference shell implementation, model_gate.py, used by the cline-/kilo-/opencode-auto wrappers).
// score = 2 x Artificial Analysis Intelligence Index v4.3.x. Baseline: score >= MODEL_MIN_SCORE (60 = AA 30)
// AND agentic floor (Terminal-Bench 4.0 >= MODEL_MIN_TB 10 %, or AA Agentic Index >= MODEL_MIN_AGENTIC 15 when TB unknown).
// Evidence: rank table -> live AA numbers from OpenRouter's public /api/v1/models (no key, 24 h cache, stale cache on failure)
// -> provisional estimate (same-family predecessor + capped premium / flagship price / name tier), admitted only if
// >= MIN - MODEL_PROVISIONAL_SLACK and always ordered after every rated model -> optional local feedback (AGENT_EVENTS_LOG).
// MODEL_MIN_SCORE=0 relaxes the gate; an explicit --model is never gated (callers put pref first).
const fs = require('fs');
const path = require('path');
const U = require('./util');

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const envNum = (k, d) => { const v = Number(process.env[k]); return process.env[k] !== undefined && process.env[k] !== '' && Number.isFinite(v) ? v : d; };
function cfg() {
  return { min: envNum('MODEL_MIN_SCORE', 60), tb: envNum('MODEL_MIN_TB', 10), agentic: envNum('MODEL_MIN_AGENTIC', 15),
    prov: process.env.MODEL_PROVISIONAL !== '0', slack: envNum('MODEL_PROVISIONAL_SLACK', 10) };
}
function norm(m) { return String(m).toLowerCase().split('/').pop().replace(/:free$/, '').replace(/-free$/, ''); }
const TIERS = new Set(['ultra', 'super', 'pro', 'max', 'plus', 'flash', 'mini', 'small', 'xs', 'nano', 'lite', 'lightning', 'tiny', 'air', 'omni', 'vl', 'code', 'coder', 'note', 'fin']);
function parts(n) {
  const toks = n.split(/[-_.]/); const stem = [];
  for (const t of toks) { if (/^v?\d/.test(t)) break; stem.push(t); }
  const v = n.match(/(\d+(?:\.\d+)?)/);
  return { stem: stem.join('-') || n, ver: v ? parseFloat(v[1]) : null, tiers: toks.filter((t) => TIERS.has(t)).sort().join(',') };
}
function benchPath() { return path.join(U.stateDir(), 'model-bench.json'); }
function parseOpenRouter(d) {
  const out = {};
  for (const x of (d && d.data) || []) {
    const id = x.id || ''; const aa = (x.benchmarks || {}).artificial_analysis || {};
    const price = (Number((x.pricing || {}).completion) || 0) * 1e6;
    const e = { id, aa: num(aa.intelligence_index), agentic: num(aa.agentic_index), price_out: Math.round(price * 1000) / 1000 };
    const k = norm(id); const o = out[k];
    if (!o || (o.aa === null && e.aa !== null) || (e.price_out > (o.price_out || 0) && (e.aa !== null) === (o.aa !== null))) out[k] = e;
  }
  return out;
}
async function bench(fetchJSON, info, { fetch = true } = {}) {
  const ttl = envNum('MODEL_BENCH_TTL', 86400) * 1000;
  const c = U.readJSON(benchPath(), null); const ok = c && typeof c === 'object' && c.models && typeof c.models === 'object';
  const now = Date.now();
  if (ok && now - (c.fetched_at || 0) >= 0 && now - (c.fetched_at || 0) < ttl) return { models: c.models, src: 'cache' };
  if (fetch && process.env.MODEL_BENCH_OFFLINE !== '1') {
    try {
      const { data } = await fetchJSON(process.env.MODEL_BENCH_URL || 'https://openrouter.ai/api/v1/models', envNum('MODEL_BENCH_TIMEOUT', 3) * 1000);
      const m = parseOpenRouter(data);
      if (Object.keys(m).length) { try { U.writeJSONAtomic(benchPath(), { fetched_at: now, models: m }); } catch (_) {} return { models: m, src: 'live' }; }
      info.push('bench_empty');
    } catch (e) { info.push('bench_fetch_failed ' + e.message + '（回落到缓存/排名表）'); }
  }
  if (ok) return { models: c.models, src: 'stale_cache' };
  return { models: {}, src: 'none' };
}
function feedback(days = 14) {
  const p = process.env.AGENT_EVENTS_LOG; const st = {}; if (!p) return st;
  let lines = []; try { lines = fs.readFileSync(p, 'utf8').split('\n').slice(-20000); } catch (_) { return st; }
  const cut = Date.now() - days * 86400e3;
  for (const l of lines) {
    let e; try { e = JSON.parse(l); } catch (_) { continue; }
    if (!e || e.event !== 'done' || !e.model || !Number.isInteger(e.rc) || [129, 130, 143].includes(e.rc)) continue;
    const t = Date.parse(e.ts); if (Number.isFinite(t) && t < cut) continue;
    const s = st[e.model] || (st[e.model] = [0, 0]); s[e.rc === 0 ? 0 : 1]++;
  }
  return st;
}
function estimate(m, bm) {
  const n = norm(m); const p = parts(n); let best = null;
  for (const [k, b] of Object.entries(bm)) {
    if (num(b.aa) === null) continue; const q = parts(k);
    if (q.stem !== p.stem || q.tiers !== p.tiers) continue;
    if (p.ver !== null && q.ver !== null && q.ver > p.ver) continue;
    if (!best || (q.ver || 0) > (best.ver || 0)) best = { b, ver: q.ver };
  }
  let s;
  if (best) { s = 2 * best.b.aa; if (p.ver !== null && best.ver !== null && p.ver > best.ver) s += Math.min(10, 10 * (p.ver - best.ver)); }
  else {
    s = 50;
    for (const [t, v] of [['ultra', 5], ['pro', 5], ['max', 5], ['coder', 3], ['mini', -12], ['small', -12], ['xs', -15], ['nano', -20], ['lite', -12], ['lightning', -15], ['tiny', -20], ['note', -12], ['fin', -10]]) {
      if (new RegExp(`(^|[-_.])${t}($|[-_.\\d])`).test(n)) s += v;
    }
  }
  const own = bm[n]; if (own && (own.price_out || 0) >= 2) s += 5;
  return Math.round(Math.min(s, 79) * 10) / 10;
}
function scoreOne(m, table, bm, c, fb) {
  const r = table[m]; const d = { model: m, score: null, status: null, evidence: null, reason: '' };
  let tb = null; let agentic = null;
  if (r && typeof r === 'object' && r.exclude) return { ...d, score: num(r.score) || 0, status: 'excluded', evidence: 'table', reason: typeof r.exclude === 'string' ? r.exclude : '排名表标记排除' };
  if (r && typeof r === 'object' && ('score' in r || 'aa' in r)) {
    let s = 'score' in r ? Number(r.score) : NaN; if (r.score === null || r.score === '' || !Number.isFinite(s)) s = null;
    if (s === null && num(r.aa) !== null) s = 2 * r.aa;
    if (s !== null) {
      tb = num(r.tb); agentic = num(r.agentic);
      d.evidence = r.evidence || (num(r.aa) !== null ? 'measured' : 'table'); d.score = Math.round(s * 10) / 10;
      if (['provisional', 'none', 'vendor'].includes(d.evidence)) d.status = 'provisional';
    } else d.reason = 'rank_bad_score';
  }
  if (d.score === null) {
    const k = norm(m); let b = bm[k];
    if (!b || num(b.aa) === null) { const k2 = k.replace(/-(contributor|preview|exp|beta)$/, ''); const b2 = bm[k2]; if (k2 !== k && b2 && num(b2.aa) !== null) b = { ...b2, proxy: true }; }
    if (b && num(b.aa) !== null) { agentic = num(b.agentic); d.score = Math.round((2 * b.aa - (b.proxy ? 5 : 0)) * 10) / 10; d.evidence = 'openrouter_aa' + (b.proxy ? '_proxy' : ''); d.reason = `AA ${b.aa}（OpenRouter/AA 实时）`; }
    else { d.score = estimate(m, bm); d.status = 'provisional'; d.evidence = 'estimate'; }
  }
  if (!d.status) d.status = 'pass';
  if (c.min > 0 && d.status === 'pass') {
    if (tb !== null && tb < c.tb) return { ...d, status: 'excluded', reason: `Terminal-Bench 4.0 ${tb}% < ${c.tb}%` };
    if (tb === null && agentic !== null && agentic < c.agentic) return { ...d, status: 'excluded', reason: `AA Agentic ${agentic} < ${c.agentic}` };
  }
  const f = fb[m];
  if (f && f[0] + f[1] >= 5) {
    const n = f[0] + f[1]; const rate = f[0] / n;
    if (rate < 0.5) { d.score = Math.round((d.score - 15) * 10) / 10; d.reason += ` 本机成功率 ${f[0]}/${n} 降级`; }
    else if (d.status === 'provisional' && rate >= 0.8) { d.status = 'pass'; d.score = Math.max(d.score, c.min); d.reason += ` 本机试用 ${f[0]}/${n} 转正`; }
  }
  if (c.min <= 0) return d;
  if (d.status === 'pass' && d.score < c.min) { d.status = 'excluded'; d.reason = `${d.reason} 分数 ${d.score} < 门槛 ${c.min}`.trim(); }
  else if (d.status === 'provisional') {
    if (!c.prov) { d.status = 'excluded'; d.reason = '无评测（MODEL_PROVISIONAL=0）'; }
    else if (d.score < c.min - c.slack) { d.status = 'excluded'; d.reason = `${d.reason} 无评测且估分 ${d.score} < ${c.min - c.slack}`.trim(); }
  }
  return d;
}
function apply(models, table, bm, { ordered = false, info = [], fb = feedback() } = {}) {
  const c = cfg(); const res = models.map((m) => scoreOne(m, table || {}, bm || {}, c, fb));
  const by = (a, b) => b.score - a.score;
  const pass = res.filter((d) => d.status === 'pass'); const prov = res.filter((d) => d.status === 'provisional'); const excl = res.filter((d) => d.status === 'excluded');
  const eligible = ordered ? res.filter((d) => d.status !== 'excluded').map((d) => d.model) : [...pass.slice().sort(by), ...prov.slice().sort(by)].map((d) => d.model);
  prov.forEach((d) => info.push(`rank_unknown model=${d.model} heuristic=${d.score} provisional`));
  if (excl.length) info.push('gate_excluded=' + excl.map((d) => `${d.model}:${d.score}`).join(','));
  return { eligible, excluded: excl, provisional: prov.map((d) => d.model), results: res, cfg: c };
}
function humanExcluded(excl, c = cfg()) {
  if (!excl || !excl.length) return '';
  const names = excl.slice(0, 8).map((d) => `${d.model.split('/').pop()}(${d.score})`).join('、') + (excl.length > 8 ? '…' : '');
  return `另有 ${excl.length} 个免费模型因能力分低于门槛 MODEL_MIN_SCORE=${c.min} 未参与轮换：${names}。确需使用可临时 MODEL_MIN_SCORE=0 放宽，或用 --model 指定。`;
}
// Judgement gate (v1.3.4, = model_gate.py --judge-grade in the reference wrappers): judgement calls (review / verify /
// accept / audit / 复核 / 验收 / supervision ...) only run on production-grade models. Grade with a FIXED baseline (rank
// table min_score, TB >= 10, Agentic >= 15), no env overrides, no live bench, no local feedback:
// prod = status pass AND evidence measured / openrouter_aa; anything else in a table = weak; not in any table = unrated.
const JUDGE_RE = /(review|verdict|judge|accept|audit|verify|supervision|second.?vote|复核|判断|验收|裁决)/i;
const PROD_EVIDENCE = ['measured', 'openrouter_aa'];
// '' = not a judgement call; otherwise the reason. AUTO_JUDGEMENT=1 (or CREW_JUDGEMENT=1) forces it; there is no "off" switch.
function judgeWhy(env = process.env) {
  if (env.AUTO_JUDGEMENT === '1' || env.CREW_JUDGEMENT === '1') return 'AUTO_JUDGEMENT=1';
  if (JUDGE_RE.test(env.AGENT_CALLER || '')) return 'caller=' + String(env.AGENT_CALLER).replace(/[^\w.:@+-]/g, '').slice(0, 64);
  if (JUDGE_RE.test(env.AGENT_TASK || '')) return 'AGENT_TASK';
  if (JUDGE_RE.test(env.AGENT_ROLE || '')) return 'AGENT_ROLE';
  return '';
}
function judgeNames(m) {
  const n = String(m).toLowerCase().split('/').pop().replace(/(:free|-free)$/, '');
  return [n, n.replace(/-(contributor|preview|exp|beta|high|low|medium)$/, '')];
}
// models -> [{model, grade: prod|weak|unrated, why}]; table = union of every rank table, minScore = its baseline.
function judgeGrade(models, table, minScore = 60) {
  const c = { min: Number.isFinite(+minScore) ? +minScore : 60, tb: 10, agentic: 15, prov: true, slack: 10 };
  const idx = {}; for (const k of Object.keys(table || {})) for (const n of judgeNames(k)) if (!(n in idx)) idx[n] = k;
  return models.map((m) => {
    const t = String(m).trim();
    const key = table && Object.prototype.hasOwnProperty.call(table, t) ? t : (judgeNames(t).map((n) => idx[n]).find(Boolean) || null);
    if (!key) return { model: t, grade: 'unrated', why: 'not_in_rank_tables' };
    const d = scoreOne(key, table, {}, c, {});
    const ok = d.status === 'pass' && PROD_EVIDENCE.includes(d.evidence);
    return { model: t, grade: ok ? 'prod' : 'weak', why: `${key}:${d.status}:${d.score}:${d.evidence}` };
  });
}

module.exports = { cfg, norm, parseOpenRouter, bench, feedback, estimate, scoreOne, apply, humanExcluded, benchPath, JUDGE_RE, PROD_EVIDENCE, judgeWhy, judgeGrade };
