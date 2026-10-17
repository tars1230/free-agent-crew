#!/usr/bin/env node
'use strict';
// Fake cline/kilo/opencode for tests. Behaviour per model via FAKE_BEHAVIOR="model=kind,..." (default ok).
// kinds: ok | limit | limit_hang | quote_limit | net | net_once | auth | fail | hang | silent | slow
const fs = require('fs');
const name = process.env.FAKE_NAME || require('path').basename(process.argv[1]).replace(/\.js$/, '');
const argv = process.argv.slice(2);
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ name, argv, pid: process.pid, stdinTTY: !!process.stdin.isTTY }) + '\n');
if (argv[0] === '--version' || argv[0] === '-V' || argv[0] === '-v') { console.log(`${name} 9.9.9-fake`); process.exit(0); }
if (argv[0] === 'models') { console.log((process.env.FAKE_MODELS || '').split(',').join('\n')); process.exit(0); }
const mi = argv.indexOf('-m'); const model = mi >= 0 ? argv[mi + 1] : '';
const beh = Object.fromEntries((process.env.FAKE_BEHAVIOR || '').split(',').filter(Boolean).map((x) => x.split('=')));
const kind = beh[model] || beh['*'] || 'ok';
const prompt = argv[argv.length - 1];
let stdinData = '';
const finish = () => {
  if (process.env.FAKE_PIDFILE) fs.writeFileSync(process.env.FAKE_PIDFILE, String(process.pid));
  switch (kind) {
    case 'ok': console.log(`[${name}:${model}] OK answer to: ${prompt.slice(0, 200)}${stdinData ? ' STDIN=' + stdinData.trim() : ''}`); process.exit(0);
    case 'quote_limit': console.log(`The user asked about "Daily free model limit reached" and "Rate limit exceeded" handling. OK.`); process.exit(0);
    case 'limit':
      if (name === 'cline') { console.log('\x1b[31merror:\x1b[0m Daily free model limit reached\nTry again in 2h 10m'); process.exit(0); }
      console.error(`Error: FreeUsageLimitError: Rate limit exceeded (429). {"ts":"2020-01-01T00:00:00Z"}`); process.exit(1);
    case 'limit_hang': console.error('Error: Rate limit exceeded, retry after 120'); setInterval(() => {}, 1000); break;
    case 'net': console.error('Error: fetch failed ECONNRESET'); process.exit(1);
    case 'net_once': {
      const f = process.env.FAKE_STATE + '.net'; if (!fs.existsSync(f)) { fs.writeFileSync(f, '1'); console.error('socket hang up'); process.exit(1); }
      console.log('recovered after network retry'); process.exit(0);
    }
    case 'auth': console.error('Error: 401 Unauthorized - please log in'); process.exit(1);
    case 'fail': console.error('Error: provider returned an invalid response'); process.exit(2);
    case 'hang': setInterval(() => process.stdout.write('.'), 500); break;
    case 'silent': setInterval(() => {}, 1000); break;
    case 'slow': setTimeout(() => { console.log('slow done'); process.exit(0); }, 2500); break;
    default: console.error('unknown kind ' + kind); process.exit(3);
  }
};
if (!process.stdin.isTTY && process.env.FAKE_READ_STDIN === '1') { process.stdin.on('data', (b) => { stdinData += b; }); process.stdin.on('end', finish); }
else finish();
