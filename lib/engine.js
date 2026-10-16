'use strict';
// Engine: run one worker CLI with quota-aware model fallback.
// Exit codes: 0 ok | 75 every gate-eligible free model exhausted/rate-limited (or none passes MODEL_MIN_SCORE) | 124 total/idle timeout | 127 CLI missing | 77 login needed | other = CLI's own rc.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const U = require('./util');
const P = require('./platform');
const W = require('./workers');
const M = require('./models');

const EX = { OK: 0, USAGE: 64, NOPERM: 77, TEMPFAIL: 75, TIMEOUT: 124, MISSING: 127 };

function resolveBin(w, env = process.env) {
  const o = env[`CREW_${w.name.toUpperCase()}_BIN`];
  if (o) return fs.existsSync(o) ? o : null;
  const found = P.which(w.bin, { env, skipDirs: [U.binDir()] });
  if (found) return found;
  // CLIs installed by the npm that belongs to the node running crew (e.g. portable node: <node dir>/cline)
  const nd = path.dirname(process.execPath);
  const sib = U.IS_WIN ? path.join(nd, w.bin + '.cmd') : path.join(nd, w.bin);
  if (fs.existsSync(sib)) return sib;
  // npm user prefix used by our installer when the global dir is not writable
  const alt = U.IS_WIN ? path.join(U.crewHome(), 'npm-global', w.bin + '.cmd') : path.join(U.crewHome(), 'npm-global', 'bin', w.bin);
  return fs.existsSync(alt) ? alt : null;
}

function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const [k, v] of Object.entries(P.SHIM_ENV)) if (env[k] === undefined) env[k] = v; // no auto-update / telemetry / share
  env.NO_UPDATE_NOTIFIER = '1'; env.npm_config_update_notifier = 'false';
  if (!env.LANG && !U.IS_WIN) env.LANG = 'en_US.UTF-8'; // UTF-8 for Chinese prompts
  // CLIs start with "#!/usr/bin/env node": make sure the node running crew (maybe a portable one) is first on PATH.
  const k = P.pathKey(env); const nd = path.dirname(process.execPath);
  env[k] = P.mergePathList(env[k] || '', [nd]).value;
  return Object.assign(env, extra);
}

// Read piped stdin without hanging: wait `firstMs` for the first byte, then until EOF or `idleMs` of silence.
function readStdinSafe({ firstMs = 1000, idleMs = 30000, stdin = process.stdin } = {}) {
  return new Promise((resolve) => {
    if (stdin.isTTY) return resolve(null);
    const chunks = []; let timer; let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); stdin.removeAllListeners('data'); stdin.pause(); try { stdin.destroy(); } catch (_) {} resolve(chunks.length ? Buffer.concat(chunks) : null); };
    timer = setTimeout(finish, firstMs);
    stdin.on('data', (b) => { chunks.push(b); clearTimeout(timer); timer = setTimeout(finish, idleMs); });
    stdin.on('end', finish); stdin.on('error', finish);
    stdin.resume();
  });
}

// ---- cline act-mode (ref-counted across concurrent runs; only the planActMode key is touched) ----
function clineSettings() { return path.join(U.home(), '.cline', 'data', 'settings', 'global-settings.json'); }
function actMode(op) {
  const sp = clineSettings();
  if (!fs.existsSync(sp)) return null;
  const sf = path.join(U.stateDir(), 'cline-actmode.json');
  return U.withLock(sf, () => {
    let st = U.readJSON(sf, {}); if (!st || typeof st !== 'object') st = {};
    const pids = (Array.isArray(st.pids) ? st.pids : []).filter((x) => Number.isInteger(x) && x !== process.pid && U.pidAlive(x));
    let prev = st.prev === undefined ? null : st.prev;
    const d = U.readJSON(sp, null); if (!d) return null;
    const cur = 'planActMode' in d ? d.planActMode : '__absent__';
    const set = (v) => { const x = U.readJSON(sp, {}); if (v === '__absent__') delete x.planActMode; else x.planActMode = v; U.writeJSONAtomic(sp, x); };
    let msg = null;
    if (op === 'enter') {
      if (!pids.length && prev === null && cur !== 'act') { set('act'); prev = cur; msg = 'force_act prev=' + prev; }
      pids.push(process.pid);
    } else if (!pids.length && prev !== null) {
      if (cur === 'act') { set(prev); msg = 'restore_mode to=' + prev; }
      prev = null;
    }
    U.writeJSONAtomic(sf, { pids, prev });
    return msg;
  });
}

function prepPrompt(w, prompt, runDir) {
  let p = w.name === 'cline' ? W.sanitizeForCline(prompt) : String(prompt);
  // Long prompts: Windows command lines max out at ~32K (cmd.exe 8K). Hand over a file instead.
  if (Buffer.byteLength(p) > 6000) {
    const f = path.join(U.mkdirp(runDir || path.join(os.tmpdir(), 'crew-prompts')), `prompt-${w.name}-${process.pid}-${Date.now()}.md`);
    fs.writeFileSync(f, p);
    p = `The full task is in the file ${f}. Read that file completely first, then do exactly what it says (reply in the language used there).`;
  }
  return p;
}

// One CLI invocation. opts: tee (stream to our stdout/stderr), stdinData (Buffer|null), stdinInherit, deadline, idleMs.
function runOnce(w, bin, argv, { tee = false, stdinData = null, stdinInherit = false, deadline = 0, idleMs = 0, cwd, onSpawn } = {}) {
  return new Promise((resolve) => {
    const sp = P.resolveSpawn(bin);
    const args = sp.shell ? [...sp.pre, ...argv].map(P.quoteCmdArg) : [...sp.pre, ...argv];
    let child;
    try {
      child = cp.spawn(sp.cmd, args, { cwd: cwd || process.cwd(), env: childEnv(), shell: sp.shell, windowsHide: true,
        detached: !U.IS_WIN, stdio: [stdinInherit ? 'inherit' : stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ rc: EX.MISSING, out: '', err: String(e.message), killed: '' }); }
    onSpawn && onSpawn(child);
    let out = ''; let err = ''; let killed = ''; let last = Date.now();
    const strongOut = w.strongOnStdout ? w.strongRe : W.outStrong(w);
    const check = () => {
      if (killed) return;
      if (w.limitRe.test(err) || strongOut.test(U.stripAnsi(out)) || (w.strongOnStdout && w.strongRe.test(out))) killed = 'limit';
      else if (deadline && Date.now() >= deadline) killed = 'timeout'; // a limit hit in the same tick wins
      else if (idleMs && Date.now() - last >= idleMs) killed = 'idle';
      if (killed) {
        setTimeout(() => { P.killTree(child, 'SIGTERM'); setTimeout(() => P.killTree(child, 'SIGKILL'), 5000).unref(); }, killed === 'limit' ? 1000 : 0);
      }
    };
    child.stdout.on('data', (b) => { const s = b.toString('utf8'); out += s; last = Date.now(); if (tee) process.stdout.write(b); if (out.length > 4e6) out = out.slice(-2e6); });
    child.stderr.on('data', (b) => { const s = b.toString('utf8'); err += s; last = Date.now(); if (tee) process.stderr.write(b); if (err.length > 4e6) err = err.slice(-2e6); });
    if (stdinData && child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(stdinData); }
    const iv = setInterval(check, 1000);
    child.on('error', (e) => { err += `\nspawn error: ${e.message}`; });
    child.on('close', (code, sig) => {
      clearInterval(iv); check();
      let rc = code === null ? (sig === 'SIGKILL' ? 137 : 143) : code;
      if (killed === 'timeout' || killed === 'idle') rc = EX.TIMEOUT;
      resolve({ rc, out, err, killed });
    });
  });
}

function isLimit(w, r) {
  if (r.killed === 'limit') return true;
  const both = r.out + '\n' + r.err;
  if (r.rc !== 0 && w.limitRe.test(both)) return true;
  if (w.strongRe.test(r.err)) return true;
  if (w.strongOnStdout && w.strongRe.test(r.out)) return true; // cline: its own error line, rc 0
  return false;
}

/**
 * Run worker with fallback across its free models.
 * argvFor(model) -> argv. Returns {rc, model, tried:[{model,rc,limit}], out, err, message}.
 */
async function runWithFallback(w, argvFor, { pref = '', tee = false, stdinData = null, stdinInherit = false, totalTimeout, idleMs, cwd, needAct = false, refresh = false } = {}) {
  const tag = w.name;
  const run = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; const t0 = Date.now();
  const ev = (e, o = {}) => U.event(tag, e, { run, t0, ...o });
  ev('start');
  const bin = resolveBin(w);
  if (!bin) {
    const msg = `${tag}: 找不到 ${w.bin} 命令。运行 \`crew setup\` 自动安装，或手动 \`npm i -g ${w.npm}\`。`;
    U.log(tag, 'missing_cli'); ev('missing_cli', { rc: EX.MISSING }); return { rc: EX.MISSING, tried: [], out: '', err: msg, message: msg };
  }
  const total = Number(totalTimeout !== undefined ? totalTimeout : (process.env.CREW_TOTAL_TIMEOUT || w.totalTimeout));
  const deadline = total > 0 ? Date.now() + total * 1000 : 0;
  let pl;
  try { pl = await M.plan(w, { pref, refresh, bin }); } catch (e) { // planner must never block a run
    U.log(tag, 'planner_failed ' + e.message);
    pl = { avail: (pref ? [pref] : []).concat(w.builtin.filter((m) => m !== pref)), skipped: [], info: [] };
  }
  pl.info.forEach((i) => U.log(tag, i));
  if (!pl.avail.length) {
    const next = pl.skipped.length ? Math.min(...pl.skipped.map((s) => s.until)) : null;
    const head = next ? `${tag}: 达标的免费模型额度都已用尽，最早 ${U.fmtReset(next)} 恢复。` : `${tag}: 没有达标的免费模型可用。`;
    const msg = `${head}可等恢复、换别的员工（crew 会自动换），或用 -m 指定模型。${pl.gateMsg || ''}状态文件: ${M.statePath(w)}`;
    U.log(tag, 'all_exhausted_before_run'); ev('quota_exhausted', { rc: EX.TEMPFAIL, reason: 'before_run' }); return { rc: EX.TEMPFAIL, tried: [], out: '', err: msg, message: msg, nextReset: next };
  }
  let actHeld = false;
  if (needAct && w.needsActMode) { try { const m = actMode('enter'); actHeld = true; m && U.log(tag, m); } catch (e) { U.log(tag, 'actmode_failed ' + e.message); } }
  const release = () => { if (actHeld) { actHeld = false; try { const m = actMode('leave'); m && U.log(tag, m); } catch (_) {} } };
  let current = null;
  let curModel = null;
  const onSig = (sig, code) => () => { if (current) P.killTree(current, 'SIGTERM'); release(); ev('done', { model: curModel, rc: code, reason: 'signal_' + sig.slice(3) }); process.exit(code); };
  const handlers = [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]].map(([s, c]) => { const h = onSig(s, c); process.on(s, h); return [s, h]; });
  const tried = [];
  try {
    let last = null;
    for (const m of pl.avail) {
      if (tried.length) { U.log(tag, `switch to=${m} reason=quota_or_rate_limit`); ev('switch', { model: m }); }
      curModel = m;
      const go = () => runOnce(w, bin, argvFor(m), { tee, stdinData, stdinInherit, deadline, idleMs: idleMs || +(process.env.CREW_IDLE_TIMEOUT || 0) * 1000, cwd, onSpawn: (c) => { current = c; } });
      let r = await go();
      if (r.rc === EX.TIMEOUT) { U.log(tag, `timeout kind=${r.killed} model=${m}`); ev('timeout', { model: m, rc: EX.TIMEOUT, reason: r.killed }); const msg = r.killed === 'idle' ? `${tag}: 长时间无任何输出，判定卡住并已终止（CREW_IDLE_TIMEOUT）。` : `${tag}: 超过总时限 ${total}s，已终止。`; return { rc: EX.TIMEOUT, model: m, tried: [...tried, { model: m, rc: 124 }], out: r.out, err: r.err + '\n' + msg, message: msg }; }
      if (!isLimit(w, r) && r.rc !== 0 && W.NET_RE.test(r.out + r.err) && process.env.CREW_NET_RETRY !== '0') {
        U.log(tag, `retry model=${m} reason=network rc=${r.rc}`); r = await go();
        if (r.rc === EX.TIMEOUT) { ev('timeout', { model: m, rc: EX.TIMEOUT, reason: r.killed }); return { rc: EX.TIMEOUT, model: m, tried, out: r.out, err: r.err, message: `${tag}: 超过总时限` }; }
      }
      if (isLimit(w, r)) {
        const rs = M.markExhausted(w, m, r.out + '\n' + r.err);
        U.log(tag, `exhausted model=${m} rc=${r.rc} reset=${U.isoLocal(rs.at)} how=${rs.how}`); ev('exhausted', { model: m, rc: r.rc });
        tried.push({ model: m, rc: r.rc, limit: true, reset: rs.at }); last = r; continue;
      }
      if (r.rc !== 0 && W.AUTH_RE.test(U.stripAnsi(r.out + '\n' + r.err))) {
        const msg = `${tag}: 需要登录/登录已过期。${w.loginHint || ''}`;
        U.log(tag, `auth_required model=${m} rc=${r.rc}`); ev('auth_required', { model: m, rc: EX.NOPERM });
        return { rc: EX.NOPERM, model: m, tried: [...tried, { model: m, rc: r.rc }], out: r.out, err: r.err + '\n' + msg, message: msg };
      }
      U.log(tag, `done model=${m} rc=${r.rc}`); ev('done', { model: m, rc: r.rc });
      return { rc: r.rc, model: m, tried: [...tried, { model: m, rc: r.rc }], out: r.out, err: r.err };
    }
    const next = Math.min(...tried.map((t) => t.reset));
    const msg = `${tag}: 达标的免费模型额度都已用尽或被限速（已试 ${tried.map((t) => t.model).join(', ')}），最早 ${U.fmtReset(next)} 恢复。crew 会自动换别的员工；单独调用时请等恢复或用 -m 指定模型。${pl.gateMsg || ''}`;
    U.log(tag, `all_exhausted tried=${tried.length}`); ev('quota_exhausted', { model: tried.length ? tried[tried.length - 1].model : null, rc: EX.TEMPFAIL });
    return { rc: EX.TEMPFAIL, tried, out: last ? last.out : '', err: (last ? last.err : '') + '\n' + msg, message: msg, nextReset: next };
  } finally { release(); handlers.forEach(([s, h]) => process.removeListener(s, h)); }
}

// High-level task API used by crew modes.
async function runTask(workerName, prompt, { cwd, model = '', readonly = false, totalTimeout, runDir, idleMs } = {}) {
  const w = W.getWorker(workerName);
  const guard = readonly ? 'READ-ONLY TASK: do not create, modify or delete any file, and do not run commands that change state. 只读：禁止写文件。\n\n' : '';
  const p = prepPrompt(w, guard + prompt, runDir);
  const t0 = Date.now();
  const r = await runWithFallback(w, (m) => w.taskArgs({ prompt: p, cwd, model: m }), { pref: model, cwd, totalTimeout, needAct: true, idleMs });
  return { worker: w.name, ms: Date.now() - t0, ...r, text: U.stripAnsi(r.out).trim() };
}

// Raw passthrough mode for the `<worker>-auto` shims: same CLI args as the bare CLI, plus fallback.
async function execRaw(workerName, rawArgs) {
  const w = W.getWorker(workerName);
  const bin = resolveBin(w);
  let pref = ''; const args = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '-m' || a === '--model') { pref = rawArgs[++i] || ''; continue; }
    if (a.startsWith('--model=')) { pref = a.slice(8); continue; }
    args.push(a);
  }
  const passthrough = () => {
    if (!bin) { process.stderr.write(`${w.name}: 找不到 ${w.bin}，运行 crew setup 安装。\n`); return EX.MISSING; }
    const sp = P.resolveSpawn(bin);
    const full = [...sp.pre, ...rawArgs];
    const r = cp.spawnSync(sp.cmd, sp.shell ? full.map(P.quoteCmdArg) : full, { stdio: [process.stdin.isTTY ? 'inherit' : 'ignore', 'inherit', 'inherit'], env: childEnv(), shell: sp.shell, windowsHide: true });
    return r.status === null ? 1 : r.status;
  };
  if (w.subcommand) {
    if (args[0] !== w.subcommand) return passthrough();
    if (args.includes('-h') || args.includes('--help')) return passthrough();
    args.shift();
  } else if (!args.length || w.passthrough.includes(args[0])) return passthrough();
  let final = args;
  let needAct = false;
  if (w.name === 'kilo') {
    const noAuto = final.indexOf('--no-auto'); if (noAuto >= 0) final.splice(noAuto, 1); else if (!final.includes('--auto')) final = ['--auto', ...final];
  }
  if (w.name === 'cline') {
    final = [];
    for (let i = 0; i < args.length; i++) { // a short --timeout cancels a still-working review: drop < 900 s
      const a = args[i]; let n = null;
      if (a === '-t' || a === '--timeout') { n = args[i + 1]; if (/^\d+$/.test(n || '') && +n > 0 && +n < 900) { U.log('cline', `timeout_dropped seconds=${n}`); i++; continue; } }
      else if (a.startsWith('--timeout=')) { n = a.slice(10); if (/^\d+$/.test(n) && +n > 0 && +n < 900) { U.log('cline', `timeout_dropped seconds=${n}`); continue; } }
      final.push(a);
    }
    const pi = final.findIndex((a) => a === '-p' || a === '--plan');
    if (pi >= 0) process.stderr.write('cline-auto: 提示 -p 是 plan（规划）模式，不是"传提示词"；提示词直接作为最后一个参数即可。\n');
    else needAct = true;
    const last = final.length - 1; // prompt is the last positional
    if (last >= 0 && !final[last].startsWith('-')) final[last] = W.sanitizeForCline(final[last]);
  }
  let stdinData = null; let stdinInherit = false;
  if (process.stdin.isTTY) stdinInherit = !!w.keepTtyStdin;
  else stdinData = await readStdinSafe({ firstMs: +(process.env.CREW_STDIN_WAIT || 1) * 1000 });
  const sub = w.subcommand ? [w.subcommand] : [];
  const r = await runWithFallback(w, (m) => [...sub, ...final, '-m', m], { pref, tee: true, stdinData, stdinInherit, needAct });
  if (r.message) process.stderr.write(r.message + '\n');
  return r.rc;
}

module.exports = { EX, resolveBin, childEnv, readStdinSafe, actMode, prepPrompt, runOnce, isLimit, runWithFallback, runTask, execRaw };
