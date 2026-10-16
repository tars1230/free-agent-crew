'use strict';
// v1.3.1: CLIs installed into a custom npm prefix that is not on PATH are still found.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');

test('resolveBin finds CLIs under NPM_CONFIG_PREFIX and ~/.npmrc prefix=', { skip: process.platform === 'win32' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-res-'));
  const oldHome = process.env.HOME, oldCH = process.env.CREW_HOME;
  process.env.HOME = d; process.env.CREW_HOME = path.join(d, '.free-agent-crew');
  try {
    const E = require('../lib/engine'); const W = require('../lib/workers');
    const w = { ...W.getWorker('kilo'), bin: 'kilo-crewtest-xyz' };
    const env = { PATH: '/usr/bin:/bin' };
    assert.strictEqual(E.resolveBin(w, env), null);
    const p1 = path.join(d, 'pfx1'); fs.mkdirSync(path.join(p1, 'bin'), { recursive: true }); fs.writeFileSync(path.join(p1, 'bin', w.bin), '');
    assert.strictEqual(E.resolveBin(w, { ...env, NPM_CONFIG_PREFIX: p1 }), path.join(p1, 'bin', w.bin));
    const p2 = path.join(d, '.npm-global'); fs.mkdirSync(path.join(p2, 'bin'), { recursive: true }); fs.writeFileSync(path.join(p2, 'bin', w.bin), '');
    fs.writeFileSync(path.join(d, '.npmrc'), 'registry=https://example.invalid/\nprefix = "${HOME}/.npm-global" ; my global\n');
    assert.strictEqual(E.resolveBin(w, env), path.join(p2, 'bin', w.bin));
  } finally {
    process.env.HOME = oldHome; if (oldCH === undefined) delete process.env.CREW_HOME; else process.env.CREW_HOME = oldCH;
    fs.rmSync(d, { recursive: true, force: true });
  }
});
