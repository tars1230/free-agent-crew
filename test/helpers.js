'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const STUBS = path.join(__dirname, 'stubs');
const CREW = path.join(ROOT, 'bin', 'crew.js');

function sandbox(extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-test-'));
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, CREW_HOME: path.join(home, '.free-agent-crew'), LANG: 'en_US.UTF-8',
    FAKE_LOG: path.join(home, 'fake.log'), FAKE_STATE: path.join(home, 'fake'), CREW_NET_RETRY: '1', SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT, TEMP: os.tmpdir(), TMPDIR: os.tmpdir(),
    MODEL_BENCH_URL: 'http://127.0.0.1:9/bench', MODEL_BENCH_TIMEOUT: '1' }; // gate: never reach OpenRouter from tests
  for (const n of ['cline', 'kilo', 'opencode']) {
    env[`CREW_${n.toUpperCase()}_BIN`] = path.join(STUBS, process.platform === 'win32' && n === 'cline' ? 'cline.cmd' : n);
    env[`CREW_${n.toUpperCase()}_FREE_MODELS`] = `${n}/a,${n}/b,${n}/c`;
  }
  // cline "logged in" (structure only; no secret)
  fs.mkdirSync(path.join(home, '.cline', 'data', 'settings'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cline', 'data', 'settings', 'providers.json'), JSON.stringify({ providers: { cline: { settings: { auth: { fake: true }, model: 'x' } } } }));
  fs.writeFileSync(path.join(home, '.cline', 'data', 'settings', 'global-settings.json'), JSON.stringify({ planActMode: 'plan', other: 1 }));
  return { home, env: { ...env, ...extra } };
}
function crew(args, sb, { input, timeout = 60000, env = {} } = {}) {
  const r = cp.spawnSync(process.execPath, [CREW, ...args], { env: { ...sb.env, ...env }, input, encoding: 'utf8', timeout, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  return { rc: r.status, out: r.stdout, err: r.stderr, error: r.error };
}
function calls(sb) { try { return fs.readFileSync(sb.env.FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch (_) { return []; } }
function state(sb, w) { try { return JSON.parse(fs.readFileSync(path.join(sb.env.CREW_HOME, 'state', `${w}-quota-state.json`), 'utf8')); } catch (_) { return null; } }
module.exports = { ROOT, STUBS, CREW, sandbox, crew, calls, state };
