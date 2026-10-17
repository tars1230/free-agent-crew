'use strict';
// v1.3.3 review votes (docs/RULES.md): kilo never counts; only production-level models (gate pass + measured/openrouter_aa).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path');
const C = require('../lib/crew');
const { sandbox, crew } = require('./helpers');

function sb3() {
  const sb = sandbox();
  const cfg = path.join(sb.env.CREW_HOME, 'config'); fs.mkdirSync(cfg, { recursive: true });
  const t = (n) => ({ models: { [`${n}/a`]: { score: 80, aa: 40, tb: 20, evidence: 'measured' }, [`${n}/b`]: { score: 80, evidence: 'proxy' }, [`${n}/c`]: { score: 30 } } });
  for (const n of ['cline', 'kilo', 'opencode']) fs.writeFileSync(path.join(cfg, `${n}-model-rank.json`), JSON.stringify(t(n)));
  return sb;
}
test('review: default reviewer order is opencode, cline, kilo; kilo is reference only', () => {
  const sb = sb3();
  const r = crew(['review', 'check x', '--json', '--no-synth'], sb); assert.strictEqual(r.rc, 0, r.err);
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.results.map((x) => x.worker), ['opencode', 'cline', 'kilo']);
  const by = Object.fromEntries(j.results.map((x) => [x.worker, x]));
  assert.strictEqual(by.opencode.vote, true); assert.strictEqual(by.cline.vote, true);
  assert.strictEqual(by.kilo.vote, false); assert.match(by.kilo.vote_note, /kilo 不计复核票/);
  const t = crew(['review', 'check x', '--no-synth'], sb).out;
  assert.match(t, /## kilo .*参考（不计票）/); assert.match(t, /计票 2 票：opencode\(opencode\/a\)、cline\(cline\/a\)；至少一票生产级：是/);
});
test('review: proxy evidence or a failed run is not a vote; --workers order is respected', () => {
  const sb = sb3();
  const r = crew(['review', 'x', '--json', '--no-synth', '--workers', 'cline,opencode', '--model', 'cline=cline/b'], { ...sb, env: { ...sb.env, FAKE_BEHAVIOR: 'opencode/a=fail,opencode/b=fail,opencode/c=fail' } });
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.results.map((x) => x.worker), ['cline', 'opencode']);
  // v1.3.4 judgement gate: review is a judgement call, so the weak --model cline/b is dropped and cline/a (prod) runs
  assert.strictEqual(j.results[0].model, 'cline/a'); assert.strictEqual(j.results[0].vote, true);
  assert.strictEqual(j.results[1].vote, false);
});
test('voteOf: proxy evidence is not a vote', async () => {
  const sb = sb3(); const old = process.env.CREW_CONFIG_DIR; process.env.CREW_CONFIG_DIR = path.join(sb.env.CREW_HOME, 'config');
  try {
    const v = await C.voteOf({ worker: 'cline', rc: 0, model: 'cline/b' });
    assert.strictEqual(v.vote, false); assert.match(v.vote_note, /evidence=proxy/);
  } finally { if (old === undefined) delete process.env.CREW_CONFIG_DIR; else process.env.CREW_CONFIG_DIR = old; }
});
test('ask keeps the cheapest-first order (kilo first)', () => {
  assert.deepStrictEqual(C.pickOrder({}), ['kilo', 'opencode', 'cline']);
  assert.deepStrictEqual(C.pickOrder({ review: true }), C.REVIEW_ORDER);
});
