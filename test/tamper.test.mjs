// code-quest:noscan
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { tmpHome, stateDir, readJson, run, readEvent, projFile } from './helpers.mjs';

const CWD = '/tmp/cq-proj-tamper';
const EV = () => readEvent(CWD, CWD + '/a.js', 'const x = 1;\n');
const heroPath = (home) => join(stateDir(home), 'hero.json');
const heroOf = (home) => readJson(heroPath(home)).d;
// same signing scheme as the runtime, keyed by the temp install's .key
const sign = (home, d) => createHmac('sha256', readFileSync(join(stateDir(home), '.key'), 'utf8').trim())
  .update(JSON.stringify(d)).digest('hex').slice(0, 16);

function freshSave(home) { run('quest-hook.mjs', { home, input: EV() }); return readJson(heroPath(home)); }

test('a hand-edited save keeps its level but enters the Penitent Engine', () => {
  const home = tmpHome();
  const w = freshSave(home);
  w.d.lv = 99;                                                  // hand-edit: signature now stale
  writeFileSync(heroPath(home), JSON.stringify(w));
  const r = run('quest-hook.mjs', { home, input: EV() });
  assert.equal(r.status, 0, r.stderr);
  const d = heroOf(home);
  assert.equal(d.lv, 99, 'level preserved, never wiped');
  assert.equal(d.penitent, true, 'sentenced');
  assert.ok(existsSync(heroPath(home) + '.bak'), 'raw save backed up');
  assert.equal(readJson(projFile(home, CWD)).ev, 'PENITENT ENGINE!');
  const status = run('quest-status.mjs', { home, input: JSON.stringify({ workspace: { current_dir: CWD } }) });
  assert.ok(status.stdout.includes('✠'), 'mark shown in the status line');
  rmSync(home, { recursive: true, force: true });
});

test('stripping the signature envelope is not a free pass: an unwrapped save is sentenced', () => {
  const home = tmpHome();
  const w = freshSave(home);
  writeFileSync(heroPath(home), JSON.stringify(w.d));             // bare stats, no { d, s } envelope
  run('quest-hook.mjs', { home, input: EV() });
  const d = heroOf(home);
  assert.equal(d.lv, w.d.lv, 'level preserved, never wiped');
  assert.equal(d.penitent, true, 'no envelope = broken lineage');
  assert.ok(existsSync(heroPath(home) + '.bak'), 'raw save backed up');
  rmSync(home, { recursive: true, force: true });
});

test('a correctly-signed but implausible level is sentenced by the ledger', () => {
  const home = tmpHome();
  const w = freshSave(home);
  w.d.lv = 50;                                                  // ledger says floors 0, wins 0 -> impossible
  w.s = sign(home, w.d);                                        // re-signed with the real key: HMAC alone passes
  writeFileSync(heroPath(home), JSON.stringify(w));
  run('quest-hook.mjs', { home, input: EV() });
  assert.equal(heroOf(home).penitent, true);
  rmSync(home, { recursive: true, force: true });
});

test('death releases the mark, absolves the ledger, and does not re-sentence', () => {
  const home = tmpHome();
  const w = freshSave(home);
  w.d.lv = 99; w.d.lp = 1;                                      // tampered AND one drain from death
  writeFileSync(heroPath(home), JSON.stringify(w));
  run('quest-hook.mjs', { home, input: EV() });                 // sentence + drain -> death -> absolution
  let d = heroOf(home);
  assert.equal(d.penitent, false, 'released by death');
  assert.equal(d.lv, 99, 'level kept through death');
  assert.ok(d.lp > 1, 'revived');
  assert.equal(readJson(projFile(home, CWD)).ev, 'penance complete');
  run('quest-hook.mjs', { home, input: EV() });                 // absolved ledger must satisfy plausibility
  d = heroOf(home);
  assert.equal(d.penitent, false, 'no re-sentencing after absolution');
  rmSync(home, { recursive: true, force: true });
});

test('an unparseable hero.json is recovered from the .bak backup, not reset', () => {
  const home = tmpHome();
  const w = freshSave(home);
  w.d.lv = 7; w.d.ledger.floors = 10;                           // plausible level, properly signed
  w.s = sign(home, w.d);
  writeFileSync(heroPath(home) + '.bak', JSON.stringify(w));    // a good backup exists
  writeFileSync(heroPath(home), '{ half-written garbage');      // main save corrupted mid-write
  const r = run('quest-hook.mjs', { home, input: EV() });
  assert.equal(r.status, 0, r.stderr);
  const d = heroOf(home);
  assert.equal(d.lv, 7, 'level recovered from the backup, not reset to 1');
  assert.equal(d.penitent, false, 'a verified backup is innocent — no sentence');
  rmSync(home, { recursive: true, force: true });
});

test('an unparseable hero.json with no usable backup still resets safely (raw preserved)', () => {
  const home = tmpHome();
  freshSave(home);
  writeFileSync(heroPath(home), '{ half-written garbage');      // no .bak exists yet
  const r = run('quest-hook.mjs', { home, input: EV() });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(heroOf(home).lv, 1, 'fresh hero');
  assert.equal(readFileSync(heroPath(home) + '.bak', 'utf8'), '{ half-written garbage',
    'the unreadable bytes are kept for forensics');
  rmSync(home, { recursive: true, force: true });
});

test('reroll wipes the save', () => {
  const home = tmpHome();
  freshSave(home);
  const r = run('quest-reroll.mjs', { home });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(heroPath(home)));
  rmSync(home, { recursive: true, force: true });
});
