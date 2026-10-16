'use strict';
// Shared helpers: paths, logging, locked atomic JSON state, time formatting. Zero dependencies.
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
function home() { return process.env.CREW_FAKE_HOME || os.homedir(); }
function crewHome() { return process.env.CREW_HOME || path.join(home(), '.free-agent-crew'); }
function stateDir() { return process.env.CREW_STATE_DIR || path.join(crewHome(), 'state'); }
function logDir() { return process.env.CREW_LOG_DIR || path.join(crewHome(), 'logs'); }
function configDir() { return process.env.CREW_CONFIG_DIR || path.join(crewHome(), 'config'); }
function binDir() { return process.env.CREW_BIN_DIR || path.join(crewHome(), 'bin'); }
function runsDir() { return path.join(crewHome(), 'runs'); }
const PKG_ROOT = path.resolve(__dirname, '..');

function mkdirp(d) { try { fs.mkdirSync(d, { recursive: true }); } catch (_) {} return d; }

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Local ISO time with offset, e.g. 2026-10-15T16:40:00+08:00 (avoids "UTC vs local" confusion in logs).
function isoLocal(t) {
  const d = new Date(t === undefined ? Date.now() : t);
  const off = -d.getTimezoneOffset(); const s = off >= 0 ? '+' : '-'; const a = Math.abs(off);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${s}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

// Structured events (one JSON per line), same shape as the reference agent-events.jsonl plus a per-call "run" id:
// {ts, agent, caller, session_id, model, event, rc, duration, tokens, run}. Never contains prompts or output.
function eventsPath() { return process.env.CREW_EVENTS_LOG || path.join(logDir(), 'events.jsonl'); }
function event(agent, ev, { model = null, rc = null, run = null, t0 = null, reason } = {}) {
  try {
    const p = eventsPath(); mkdirp(path.dirname(p));
    const e = { ts: isoLocal(), agent, caller: String(process.env.AGENT_CALLER || 'crew').replace(/[^\w.:@+-]/g, '').slice(0, 64) || 'crew', session_id: null,
      model: model || null, event: ev, rc: Number.isInteger(rc) ? rc : null, duration: t0 ? Math.round((Date.now() - t0) / 1000) : null, tokens: null, run };
    if (reason) e.reason = reason;
    fs.appendFileSync(p, JSON.stringify(e) + '\n');
  } catch (_) { /* never break a run */ }
}

function log(name, msg) {
  try {
    mkdirp(logDir());
    fs.appendFileSync(path.join(logDir(), name + '.log'), `${isoLocal()} pid=${process.pid} ${msg}\n`);
  } catch (_) { /* logging must never break a run */ }
}

function readJSON(p, fallback) {
  try {
    const v = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    return v === null || v === undefined ? fallback : v;
  } catch (_) { return fallback; }
}

// Atomic write: tmp file in same dir + rename (rename replaces on POSIX and Windows; retry on transient EPERM/EBUSY).
function writeJSONAtomic(p, obj) {
  mkdirp(path.dirname(p));
  const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1) + '\n');
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, p); return; } catch (e) {
      if (i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
      sleepSync(50);
    }
  }
}

// Cross-platform lock: mkdir is atomic everywhere. Stale locks (holder dead or >30 s old) are broken.
function withLock(p, fn, { timeoutMs = 15000, staleMs = 30000 } = {}) {
  const lk = p + '.lockdir';
  mkdirp(path.dirname(p));
  const t0 = Date.now();
  for (;;) {
    try { fs.mkdirSync(lk); fs.writeFileSync(path.join(lk, 'owner'), String(process.pid)); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let stale = false;
      try {
        const st = fs.statSync(lk);
        if (Date.now() - st.mtimeMs > staleMs) stale = true;
        const owner = parseInt(fs.readFileSync(path.join(lk, 'owner'), 'utf8'), 10);
        if (owner && !pidAlive(owner)) stale = true;
      } catch (_) { /* owner file not written yet */ }
      if (stale) { try { fs.rmSync(lk, { recursive: true, force: true }); } catch (_) {} continue; }
      if (Date.now() - t0 > timeoutMs) { // never block a run forever on a lock: break it
        try { fs.rmSync(lk, { recursive: true, force: true }); } catch (_) {}
        continue;
      }
      sleepSync(25 + Math.random() * 50);
    }
  }
  try { return fn(); } finally { try { fs.rmSync(lk, { recursive: true, force: true }); } catch (_) {} }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r(?!\n)/g, '\n');
}

function fmtReset(t) { return isoLocal(t).slice(0, 16).replace('T', ' ') + ' ' + isoLocal(t).slice(19); }

module.exports = { IS_WIN, home, crewHome, stateDir, logDir, configDir, binDir, runsDir, PKG_ROOT,
  mkdirp, sleepSync, isoLocal, log, eventsPath, event, readJSON, writeJSONAtomic, withLock, pidAlive, stripAnsi, fmtReset };
