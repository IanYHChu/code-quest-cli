// code-quest:noscan
// Dogfood: Code Quest's own runtime must pass its own scan. Only the rule catalog
// (quest-rules.mjs / quest-data.mjs — files made of trigger literals, the scanner-scans-scanner
// trap) is exempt by default; every other shipped file is scanned exactly like user code and must
// come out clean: no security hits, no quality rules, no smell counters, no over-long lines.
// depth > 0 proves a file was actually scanned rather than silently exempted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { ROOT, tmpHome, run } from './helpers.mjs';

const SCANNED = ['cli.mjs', 'quest-analyze.mjs', 'quest-state.mjs', 'quest-dungeon.mjs',
  'quest-hook.mjs', 'quest-status.mjs', 'quest-report.mjs', 'quest-reroll.mjs', 'quest-nudge.mjs'];
const EXEMPT = ['quest-rules.mjs', 'quest-data.mjs'];
const ZERO_KEYS = ['leaks', 'weak', 'insecure', 'misconfig', 'container', 'inj',
  'godFile', 'longLines', 'todos', 'magic', 'dead', 'debug', 'swallow'];

function selfscan(home, file) {
  const r = run('test/selfscan.mjs', { home, args: [join(ROOT, file)] });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('every scanned runtime file passes its own scan clean', () => {
  const home = tmpHome();
  for (const f of SCANNED) {
    const p = selfscan(home, f);
    const c = p.counts;
    assert.ok(c.depth > 0, `${f}: depth 0 means the file was exempted, not scanned`);
    assert.equal(p.power, 1, `${f}: power ${p.power}`);
    assert.equal(p.ambushBias, 0, `${f}: ambushBias ${p.ambushBias}`);
    assert.equal(p.secrets, 0, `${f}: secrets ${p.secrets}`);
    for (const k of ZERO_KEYS) assert.equal(c[k], 0, `${f}: counts.${k} = ${c[k]}`);
    assert.deepEqual(c.rules, [], `${f}: quality rules fired: ${c.rules}`);
    assert.deepEqual(c.cwes, [], `${f}: CWEs flagged: ${c.cwes}`);
  }
  rmSync(home, { recursive: true, force: true });
});

test('only the rule catalog is exempt by default', () => {
  const home = tmpHome();
  for (const f of EXEMPT) {
    const p = selfscan(home, f);
    assert.equal(p.power, 1, f);
    assert.equal(p.counts.depth, 0, `${f}: an exempt scan must return zero counts`);
  }
  rmSync(home, { recursive: true, force: true });
});
