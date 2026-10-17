'use strict';
// Crew modes: ask | review | brainstorm | relay | cross. Picks workers that currently have quota, runs them, aggregates.
const fs = require('fs');
const path = require('path');
const U = require('./util');
const W = require('./workers');
const M = require('./models');
const E = require('./engine');
const G = require('./gate');

const MAX_FEED = 12000; // chars of one worker's output fed into the next prompt

async function availability(names) {
  return Promise.all(names.map(async (n) => {
    const w = W.getWorker(n);
    const bin = E.resolveBin(w);
    if (!bin) return { name: n, ok: false, code: 127, why: `未安装 ${w.bin}（crew setup 可装）` };
    const a = w.authCheck();
    if (!a.ok) return { name: n, ok: false, code: 77, why: `未登录：${a.why}；${w.loginHint || ''}` };
    let pl; try { pl = await M.plan(w, {}); } catch (e) { return { name: n, ok: true, why: 'planner error, will use builtin', avail: w.builtin.length }; }
    if (!pl.avail.length) { const nx = pl.skipped.length ? Math.min(...pl.skipped.map((s) => s.until)) : null; return { name: n, ok: false, code: 75, why: (nx ? `达标的免费模型额度全部用尽，最早 ${U.fmtReset(nx)} 恢复` : '没有达标的免费模型') + (pl.gateMsg ? '；' + pl.gateMsg : ''), nextReset: nx }; }
    return { name: n, ok: true, avail: pl.avail.length, top: pl.avail[0], src: pl.src };
  }));
}

// review / cross reviewers: formal review votes first (docs/RULES.md); kilo still works but never counts as a vote.
const REVIEW_ORDER = ['opencode', 'cline', 'kilo'];
function pickOrder(opt) {
  const req = opt.workers ? String(opt.workers).split(',').map((s) => s.trim()).filter(Boolean) : (process.env.CREW_ORDER ? process.env.CREW_ORDER.split(',') : (opt.review ? REVIEW_ORDER : W.ORDER));
  req.forEach((n) => W.getWorker(n));
  return req.map((n) => W.getWorker(n).name);
}
function modelFor(opt, n) {
  const spec = String(opt.model || '');
  for (const part of spec.split(',')) { const [k, v] = part.split('='); if (v && k.trim() === n) return v.trim(); }
  return '';
}
function clip(s, n = MAX_FEED) { s = String(s || ''); return s.length <= n ? s : '…(前文已截断)…\n' + s.slice(-n); }
// Review vote: production-level = passes the gate on evidence measured / openrouter_aa (proxy, vendor, none, estimate,
// provisional do not count; no local success-rate feedback). kilo never counts. Failed runs never count.
async function voteOf(r) {
  if (r.skipped || r.rc !== 0) return { vote: false, vote_note: '未完成，不计票' };
  if (r.worker === 'kilo') return { vote: false, vote_note: 'kilo 不计复核票' };
  if (!r.model) return { vote: false, vote_note: '未知模型，不计票' };
  try {
    const w = W.getWorker(r.worker); const bm = await G.bench(M.fetchJSON, [], { fetch: false });
    const d = G.scoreOne(r.model, M.rankTable(w), bm.models, G.cfg(), {});
    if (d.status === 'pass' && ['measured', 'openrouter_aa'].includes(d.evidence)) return { vote: true, vote_note: `生产级（evidence=${d.evidence}）` };
    return { vote: false, vote_note: `非生产级（status=${d.status}, evidence=${d.evidence || 'none'}），只作参考` };
  } catch (e) { return { vote: false, vote_note: '分级出错：' + e.message }; }
}
async function tagVotes(results) { for (const r of results) if (r && !r.skipped) Object.assign(r, await voteOf(r)); return results; }
function newRunDir(mode) { const d = path.join(U.runsDir(), U.isoLocal().replace(/[:+]/g, '').slice(0, 15) + '-' + mode + '-' + process.pid); return U.mkdirp(d); }

async function runOne(n, prompt, opt, runDir, readonly) {
  const r = await E.runTask(n, prompt, { cwd: opt.cwd, model: modelFor(opt, n), readonly, totalTimeout: opt.timeout, runDir });
  try { fs.writeFileSync(path.join(runDir, `${n}.md`), r.text + (r.err ? `\n\n<!-- stderr -->\n${U.stripAnsi(r.err).slice(-4000)}` : '')); } catch (_) {}
  return r;
}

// ask: first worker with quota; on 75/77/127/124 move to the next worker.
async function ask(prompt, opt, runDir) {
  const order = pickOrder(opt); const results = [];
  const av = await availability(order);
  for (const a of av) {
    if (!a.ok) { results.push({ worker: a.name, rc: a.code, message: a.why, skipped: true }); continue; }
    const r = await runOne(a.name, prompt, opt, runDir, !opt.write);
    results.push(r);
    if (r.rc === 0) return { final: r, results };
  }
  return { final: null, results };
}

async function parallel(prompts, opt, runDir, readonly) {
  const order = pickOrder(opt);
  const av = await availability(order);
  const ok = av.filter((a) => a.ok).slice(0, opt.n || 3);
  const skipped = av.filter((a) => !a.ok).map((a) => ({ worker: a.name, rc: a.code, message: a.why, skipped: true }));
  const res = await Promise.all(ok.map((a, i) => runOne(a.name, typeof prompts === 'function' ? prompts(a.name, i, ok.length) : prompts, opt, runDir, readonly)));
  return { results: res, skipped, avail: ok.map((a) => a.name) };
}

async function synthesize(kind, task, results, opt, runDir) {
  const good = results.filter((r) => r.rc === 0 && r.text);
  if (good.length < 2 || opt.synth === false) return null;
  const body = good.map((r) => `### ${r.worker} (${r.model})${kind === 'review' && r.vote === false ? ' — reference only, not a counted vote' : ''}\n${clip(r.text, Math.floor(MAX_FEED * 2 / good.length))}`).join('\n\n');
  const instr = kind === 'review'
    ? 'Merge these independent reviews into ONE consolidated review. De-duplicate, keep only issues at least one reviewer backed with concrete evidence, mark which reviewers agreed (inputs marked "reference only" may add evidence but never decide the verdict on their own), order by severity, and end with a single line "VERDICT: PASS" or "VERDICT: FAIL". Reply in the language of the task.'
    : 'Merge these brainstorm lists into ONE ranked list: de-duplicate, combine overlapping ideas, keep the best 10, give each a one-line rationale and note which worker proposed it. Reply in the language of the task.';
  const p = `${instr}\n\n## Original task\n${clip(task, 4000)}\n\n## Inputs\n${body}`;
  const order = [...good.map((r) => r.worker), ...pickOrder(opt)].filter((v, i, a) => a.indexOf(v) === i);
  for (const n of order) {
    const r = await runOne(n, p, { ...opt, model: '' }, runDir, true);
    if (r.rc === 0) { fs.writeFileSync(path.join(runDir, 'synthesis.md'), r.text); return r; }
  }
  return null;
}

const TPL = {
  review: (task, n, i, k) => `You are independent reviewer ${i + 1} of ${k} (${n}). Review the following carefully. Read any referenced files yourself.\nList concrete problems with severity (high/medium/low), location (file:line when relevant), evidence and a fix. Do not invent issues; say "no issues" if there are none. End with "VERDICT: PASS" or "VERDICT: FAIL". Reply in the language of the task.\n\n## What to review\n${task}`,
  brainstorm: (task, n, i, k) => `Brainstorm (${n}, ${i + 1}/${k}). Give 5-8 distinct, concrete, non-obvious ideas for the topic below, each with one line on why it works and one risk. Reply in the language of the topic.\n\n## Topic\n${task}`,
};

async function relay(task, opt, runDir) {
  const order = pickOrder(opt); const av = (await availability(order)).filter((a) => a.ok).map((a) => a.name);
  const stages = [
    { role: 'draft', p: (prev) => `Stage 1/3 (draft). Do the task below as well as you can.${opt.write ? '' : ' Return the result as text.'}\n\n## Task\n${task}` },
    { role: 'critique+improve', p: (prev) => `Stage 2/3 (critique + improve). Another worker produced the draft below for the task. Find its errors and gaps, then output an improved complete version (not just comments). Reply in the language of the task.\n\n## Task\n${clip(task, 4000)}\n\n## Previous draft\n${clip(prev)}` },
    { role: 'finalize', p: (prev) => `Stage 3/3 (final check). Verify the improved version below against the task, fix remaining mistakes, and output the final version followed by a short list of what you changed. Reply in the language of the task.\n\n## Task\n${clip(task, 4000)}\n\n## Current version\n${clip(prev)}` },
  ];
  const results = []; let prev = ''; let si = 0;
  const queue = av.slice();
  while (si < stages.length && queue.length) {
    const n = queue.shift(); // each stage goes to the next available worker; if one fails it is dropped and the next one takes the stage
    const r = await runOne(n, stages[si].p(prev), opt, runDir, !opt.write);
    r.role = stages[si].role; results.push(r);
    if (r.rc === 0 && r.text) { prev = r.text; si++; if (!queue.length && si < stages.length && av.length > 1) queue.push(...av.filter((x) => x !== n)); }
  }
  return { results, final: prev ? results.filter((r) => r.rc === 0).slice(-1)[0] : null };
}

// cross: one worker does the task (may write with --write), the others review its result in parallel.
async function cross(task, opt, runDir) {
  const first = await ask(task, { ...opt }, runDir);
  if (!first.final) return { results: first.results, final: null };
  const doer = first.final.worker;
  const others = pickOrder({ ...opt, review: true }).filter((n) => n !== doer);
  const rv = await parallel((n, i, k) => TPL.review(`Task given to ${doer}:\n${clip(task, 4000)}\n\n${doer}'s result:\n${clip(first.final.text)}${opt.write ? '\n\n(It may also have changed files in the working directory: inspect them.)' : ''}`, n, i, k), { ...opt, workers: others.join(',') }, runDir, true);
  await tagVotes(rv.results);
  return { results: [...first.results, ...rv.results, ...rv.skipped], final: first.final, reviews: rv.results };
}

function exitCodeOf(results, final) {
  if (final && final.rc === 0) return 0;
  const done = results.filter((r) => !r.skipped);
  if (done.some((r) => r.rc === 0)) return 0;
  const codes = results.map((r) => r.rc);
  if (codes.length && codes.every((c) => c === 75 || c === 127 || c === 77) && codes.includes(75)) return 75;
  if (codes.includes(77) && codes.every((c) => c === 77 || c === 127)) return 77;
  if (codes.length && codes.every((c) => c === 127)) return 127;
  return done.length ? done[done.length - 1].rc || 1 : (codes[0] || 1);
}

function render(mode, out) {
  const L = [];
  const head = (r) => `## ${r.worker}${r.role ? ' · ' + r.role : ''} — ${r.skipped ? '跳过' : r.rc === 0 ? '完成' : '失败'} (rc=${r.rc}${r.model ? ', model=' + r.model : ''}${r.ms ? ', ' + Math.round(r.ms / 1000) + 's' : ''})${'vote' in r ? (r.vote ? ' · 计票' : ' · 参考（不计票）') : ''}`;
  L.push(`# crew ${mode}: ${out.results.filter((r) => r.rc === 0).length}/${out.results.length} 个员工完成  (exit ${out.code})`);
  for (const r of out.results) {
    L.push('', head(r));
    if (r.skipped || r.rc !== 0) L.push(`> ${String(r.message || U.stripAnsi(r.err || '').trim().split('\n').slice(-3).join(' ')).slice(0, 600)}`);
    if (r.rc === 0 && r.text && mode !== 'relay') L.push('', r.text);
  }
  if (out.synthesis) L.push('', `## 汇总（由 ${out.synthesis.worker} 合并）`, '', out.synthesis.text);
  if (mode === 'relay' && out.final) L.push('', '## 最终版本', '', out.final.text);
  const voted = out.results.filter((r) => 'vote' in r);
  if (voted.length) { const v = voted.filter((r) => r.vote); L.push('', `计票 ${v.length} 票：${v.map((r) => `${r.worker}(${r.model})`).join('、') || '无'}；至少一票生产级：${v.length ? '是' : '否'}（规则见 docs/RULES.md）`); }
  L.push('', `_全部原始输出: ${out.runDir}_`);
  if (out.code === 75) L.push('', '**所有员工的免费额度都暂时用尽了。** 按上面的恢复时间等一等再跑，或给某个员工指定付费模型（--model kilo=xxx）。');
  return L.join('\n');
}

async function dispatch(mode, task, opt) {
  const runDir = newRunDir(mode);
  fs.writeFileSync(path.join(runDir, 'task.md'), task);
  let out;
  if (mode === 'ask') out = await ask(task, opt, runDir);
  else if (mode === 'review' || mode === 'brainstorm') {
    const r = await parallel((n, i, k) => TPL[mode](task, n, i, k), { ...opt, review: mode === 'review' }, runDir, mode === 'review' ? true : !opt.write);
    if (mode === 'review') await tagVotes(r.results);
    out = { results: [...r.results, ...r.skipped] };
    out.synthesis = await synthesize(mode, task, r.results, opt, runDir);
  } else if (mode === 'relay') out = await relay(task, opt, runDir);
  else if (mode === 'cross') out = await cross(task, opt, runDir);
  else throw Object.assign(new Error('unknown mode ' + mode), { code: 64 });
  out.runDir = runDir;
  out.code = exitCodeOf(out.results, out.final || out.synthesis);
  const summary = { mode, code: out.code, runDir, results: out.results.map((r) => ({ worker: r.worker, role: r.role, rc: r.rc, model: r.model, ms: r.ms, skipped: !!r.skipped, message: r.message, tried: r.tried, ...('vote' in r ? { vote: r.vote, vote_note: r.vote_note } : {}) })), synthesis: out.synthesis ? { worker: out.synthesis.worker, model: out.synthesis.model } : null };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 1));
  return { out, summary, text: render(mode, out) };
}

module.exports = { availability, dispatch, exitCodeOf, render, pickOrder, modelFor, TPL, REVIEW_ORDER, voteOf };
