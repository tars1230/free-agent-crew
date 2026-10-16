'use strict';
// crew quota: read-only status of each worker from crew's own events + quota state + cached model lists (never touches the network).
// Colours (same rules as the reference free-quota): green = an evidence-passed (non-provisional) model is usable now;
// yellow = only provisional models usable (or the gate errored); red = nothing usable; gray = no data (CLI missing, never used).
const fs = require('fs');
const U = require('./util');
const W = require('./workers');
const M = require('./models');
const G = require('./gate');
const E = require('./engine');

const KILO_HOUR_LIMIT = 200;
const FAIL_LABEL = { quota: '额度全部耗尽', timeout: '超过总时限', error: '运行出错', signal: '收到信号中止', auth: '需要登录', missing: 'CLI 未安装' };
const pad = (n) => String(n).padStart(2, '0');
const fmt = (t) => { const d = new Date(t); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function readEvents(p = U.eventsPath(), max = 20000) {
  let lines = []; try { lines = fs.readFileSync(p, 'utf8').split('\n').slice(-max); } catch (_) { return []; }
  const out = [];
  for (const l of lines) { if (!l) continue; try { const e = JSON.parse(l); if (e && typeof e === 'object' && e.agent && e.event) out.push(e); } catch (_) {} }
  return out;
}

// Group events into calls (by run id); outcome from the terminal event.
function runsOf(events, agent) {
  const runs = new Map();
  for (const e of events) {
    if (e.agent !== agent) continue;
    const t = Date.parse(e.ts); if (!Number.isFinite(t)) continue;
    const id = e.run || `${e.ts}|${e.event}`; // events without a run id (foreign writers) each count as their own call
    let r = runs.get(id); if (!r) { r = { start: t, end: t, model: null, outcome: null, rc: null }; runs.set(id, r); }
    r.start = Math.min(r.start, t); r.end = Math.max(r.end, t); if (e.model) r.model = e.model;
    const rc = Number.isInteger(e.rc) ? e.rc : null;
    if (e.event === 'done') { // keep a specific failure (quota/timeout/auth/missing) recorded earlier in the same run
      r.rc = rc;
      if (rc === 0) r.outcome = 'ok';
      else if (!r.outcome) r.outcome = /^signal_/.test(e.reason || '') || [129, 130, 143].includes(rc) ? 'signal' : 'error';
    }
    else if (e.event === 'quota_exhausted') { r.outcome = 'quota'; r.rc = rc ?? 75; }
    else if (e.event === 'timeout') { r.outcome = 'timeout'; r.rc = rc ?? 124; }
    else if (e.event === 'auth_required') { r.outcome = 'auth'; r.rc = rc ?? 77; }
    else if (e.event === 'missing_cli') { r.outcome = 'missing'; r.rc = rc ?? 127; }
  }
  return [...runs.values()];
}

async function workerStatus(name, { now = Date.now(), events = readEvents() } = {}) {
  const w = W.getWorker(name);
  const installed = !!E.resolveBin(w);
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0); const h0 = new Date(now); h0.setMinutes(0, 0, 0);
  const runs = runsOf(events, name);
  const today = runs.filter((r) => r.start >= d0.getTime());
  const known = today.filter((r) => r.outcome); const ok = known.filter((r) => r.outcome === 'ok').length;
  const fails = runs.filter((r) => r.outcome && r.outcome !== 'ok').sort((a, b) => b.end - a.end);
  const lf = fails[0] ? { time: fmt(fails[0].end), reason: FAIL_LABEL[fails[0].outcome], outcome: fails[0].outcome, model: fails[0].model, rc: fails[0].rc } : null;

  const info = []; let pl;
  try { pl = await M.plan(w, { offline: true }); } catch (e) { pl = { src: 'error', all: [], avail: [], skipped: [], excluded: [], provisional: [], info: ['plan_error ' + e.message] }; }
  const gateErr = (pl.info || []).some((i) => /^gate_error/.test(i)) || pl.src === 'error';
  const order = pl.all; const prov = pl.provisional || [];
  const cooling = pl.skipped.map((s) => ({ model: s.model, reset_at: fmt(s.until), reset_ts: s.until }));
  const avail = pl.avail; const availPass = avail.filter((m) => !prov.includes(m));
  const notes = []; const reasons = [];
  try { // strongest evidence-passed model in the rank table that is not in today's free list -> info only
    const g = G.apply(Object.keys(M.rankTable(w)), M.rankTable(w), (await G.bench(M.fetchJSON, info, { fetch: false })).models, { info });
    const top = g.eligible.find((m) => !g.provisional.includes(m));
    if (top && !order.includes(top)) notes.push(`能力分第一 ${top} 不在当前免费名单`);
  } catch (_) {}
  if (order[0] && cooling.some((c) => c.model === order[0]) && availPass.length) notes.push(`最强达标模型 ${order[0]} 冷却中，暂用 ${availPass[0]}`);
  if (gateErr) reasons.push('能力门槛模块出错，按旧排序');
  const noData = !installed || (pl.src === 'builtin' && !runs.length && !cooling.length);
  let status;
  if (noData) { status = 'unknown'; reasons.push(installed ? '还没有调用记录和模型名单缓存' : 'CLI 未安装（crew setup）'); }
  else if (!order.length) { status = 'red'; reasons.push('没有达标的免费模型（全部低于门槛）'); }
  else if (!avail.length) { status = 'red'; reasons.push('可用模型全部冷却'); }
  else if (!availPass.length) { status = 'yellow'; reasons.push(order.some((m) => !prov.includes(m)) ? '达标模型全部冷却，只剩试用期（无评测）模型' : '当前免费名单里只有试用期（无评测）模型'); }
  else status = gateErr ? 'yellow' : 'green';
  const d = {
    agent: name, status, installed, pool_src: pl.src, degraded_reasons: reasons, notes,
    calls_today: today.length, outcome_known_today: known.length, success_today: ok,
    success_rate: known.length ? Math.round((ok / known.length) * 1000) / 1000 : null, unknown_today: today.length - known.length,
    preferred_model: avail[0] || null, rank_top_model: order[0] || null, cooling, last_failure: lf,
    min_score: G.cfg().min, gate_excluded: (pl.excluded || []).map((x) => ({ model: x.model, score: x.score, reason: x.reason })),
    provisional: prov, gate_excluded_count: (pl.excluded || []).length, provisional_count: prov.length,
    log: require('path').join(U.logDir(), name + '.log'),
  };
  if (name === 'kilo') {
    d.hour_used = runs.filter((r) => r.start >= h0.getTime()).length; d.hour_limit = KILO_HOUR_LIMIT;
    d.hour_note = `本小时调用 ${d.hour_used} 次（限额 ${KILO_HOUR_LIMIT} 次请求/小时·IP，单次调用可能含多次请求）`;
  }
  return d;
}

async function quota(names = W.workerList(), opt = {}) {
  const events = readEvents();
  const agents = [];
  for (const n of names) agents.push(await workerStatus(n, { ...opt, events }));
  return { generated_at: U.isoLocal(), events_log: U.eventsPath(), agents };
}

const DOT = { green: '🟢', yellow: '🟡', red: '🔴', unknown: '⚪' };
function render(data) {
  const out = [`免费模型额度  ${data.generated_at}`];
  for (const x of data.agents) {
    const rate = x.success_rate === null ? '-' : `${Math.round(x.success_rate * 100)}%`;
    out.push(`${DOT[x.status]} ${x.agent}  今日 ${x.calls_today} 次 · 成功率 ${rate}${x.unknown_today ? `（${x.unknown_today} 次无结束记录）` : ''}`);
    x.degraded_reasons.forEach((r) => out.push(`  ${x.status === 'unknown' ? '无数据' : '降级'}: ${r}`));
    x.notes.forEach((r) => out.push(`  信息: ${r}`));
    out.push(`  门槛: 最低分 ${x.min_score} · 排除 ${x.gate_excluded_count} · 试用期 ${x.provisional_count} · 无结束记录 ${x.unknown_today}`);
    out.push(`  首选: ${x.preferred_model || '无'}`);
    if (x.hour_note) out.push('  ' + x.hour_note);
    x.cooling.forEach((c) => out.push(`  冷却: ${c.model} → ${c.reset_at} 恢复`));
    if (x.last_failure) out.push(`  最近失败: ${x.last_failure.time} ${x.last_failure.reason} 退出码 ${x.last_failure.rc} ${x.last_failure.model || ''}`.trimEnd());
    out.push('');
  }
  return out.join('\n');
}

// one line for status bars: "cline🟢 kilo🟡 opencode🔴"
function line(data) { return data.agents.map((x) => x.agent + DOT[x.status]).join(' '); }
module.exports = { quota, workerStatus, runsOf, readEvents, render, line, KILO_HOUR_LIMIT };
