// code-quest:noscan
// /cq-nudge black-box tests: real git repos in tmp dirs, real quest-nudge.mjs runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tmpHome, run, bashEvent, projFile } from './helpers.mjs';

// HOME is pointed at the throwaway test home, so the user's real ~/.gitconfig (gpg signing,
// hooks, diff drivers) can never leak into these repos.
function initRepo(home) {
  const dir = mkdtempSync(join(tmpdir(), 'cq-nudge-repo-'));
  const g = (...a) => {
    const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: home, GIT_CONFIG_SYSTEM: '/dev/null' } });
    assert.equal(r.status, 0, `git ${a.join(' ')} failed: ${r.stderr}`);
    return r;
  };
  g('init', '-q');
  g('config', 'user.email', 'nudge-test@example.com');
  g('config', 'user.name', 'CQ Test');
  g('config', 'commit.gpgsign', 'false');
  return { dir, g };
}
function commit(g, dir, file, content, msg, extra = []) {
  writeFileSync(join(dir, file), content);
  g('add', file);
  g('commit', '-q', '--no-verify', '-m', msg, ...extra);
}

const DIRTY = '// app entry\nconst password = "supersecretvalue1";\nvar counter = 1;\nconsole.log(counter);\n';

test('nudges are attributed to the right file and new-file line numbers', () => {
  const home = tmpHome();
  const { dir, g } = initRepo(home);
  commit(g, dir, 'app.js', DIRTY, 'add app');
  commit(g, dir, 'app.js', DIRTY + 'var more = 2;\n', 'append a var'); // second commit adds only line 5
  const r = run('quest-nudge.mjs', { home, cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /app\.js:2\s+\S*\[HIGH\]\S*\s+\S*CWE-798/, 'secret literal at line 2, high severity');
  assert.match(r.stdout, /app\.js:3.*no-var/, 'var at line 3');
  assert.match(r.stdout, /app\.js:4.*debug/, 'console.log at line 4');
  assert.match(r.stdout, /app\.js:5.*no-var/, 'the appended line lands on new-file line 5');
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('--sarif emits parseable SARIF 2.1.0 with correct locations', () => {
  const home = tmpHome();
  const { dir, g } = initRepo(home);
  commit(g, dir, 'app.js', DIRTY, 'add app');
  const r = run('quest-nudge.mjs', { home, cwd: dir, args: ['--sarif'] });
  assert.equal(r.status, 0, r.stderr);
  const sarif = JSON.parse(r.stdout);
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].tool.driver.name, 'code-quest-nudge');
  const hit = sarif.runs[0].results.find(x => x.ruleId === 'CWE-798');
  assert.ok(hit, 'CWE-798 present in results');
  assert.equal(hit.level, 'error');
  assert.equal(hit.locations[0].physicalLocation.artifactLocation.uri, 'app.js');
  assert.equal(hit.locations[0].physicalLocation.region.startLine, 2);
  const rule = sarif.runs[0].tool.driver.rules.find(x => x.id === 'CWE-798');
  assert.match(rule.helpUri, /cwe\.mitre\.org/);
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('only YOUR commits are reviewed by default; --all widens to every author', () => {
  const home = tmpHome();
  const { dir, g } = initRepo(home);
  commit(g, dir, 'lib.js', 'var fromSomeoneElse = 1;\n', 'their commit', ['--author=Other <other@example.com>']);
  let r = run('quest-nudge.mjs', { home, cwd: dir });
  assert.match(r.stdout, /No commits by/, 'a commit authored by someone else is not yours to answer for');
  r = run('quest-nudge.mjs', { home, cwd: dir, args: ['--all'] });
  assert.match(r.stdout, /their commit/, '--all reviews every author');
  assert.match(r.stdout, /lib\.js:1.*no-var/);
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('an explicit commit id scans that commit, any age, any author', () => {
  const home = tmpHome();
  const { dir, g } = initRepo(home);
  commit(g, dir, 'lib.js', 'var fromSomeoneElse = 1;\n', 'their old commit', ['--author=Other <other@example.com>']);
  commit(g, dir, 'clean.js', 'export const ONE = 1;\n', 'my clean commit');
  const sha = g('rev-parse', 'HEAD~1').stdout.trim();
  const r = run('quest-nudge.mjs', { home, cwd: dir, args: [sha] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /their old commit/, 'the named commit is reviewed even though it is not yours');
  assert.match(r.stdout, /lib\.js:1.*no-var/);
  assert.ok(!r.stdout.includes('my clean commit'), 'only the named commit is reviewed');
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('a range A..B scans exactly the commits in the range', () => {
  const home = tmpHome();
  const { dir, g } = initRepo(home);
  commit(g, dir, 'lib.js', 'var before = 1;\n', 'before the range');
  const base = g('rev-parse', 'HEAD').stdout.trim();
  commit(g, dir, 'app.js', 'var inside = 1;\n', 'inside the range');
  const r = run('quest-nudge.mjs', { home, cwd: dir, args: [base + '..HEAD'] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /app\.js:1.*no-var/, 'commit inside the range is reviewed');
  assert.ok(!r.stdout.includes('before the range'), 'commit before the range is excluded');
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('an unresolvable revision declines gracefully', () => {
  const home = tmpHome();
  const { dir, g } = initRepo(home);
  commit(g, dir, 'a.js', 'export const A = 1;\n', 'first');
  const r = run('quest-nudge.mjs', { home, cwd: dir, args: ['notarev'] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Could not read "notarev"/);
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('noscan basenames are exempt in nudges too', () => {
  const home = tmpHome();
  const { dir, g } = initRepo(home);
  commit(g, dir, 'quest-rules.mjs', DIRTY, 'add exempt file');
  const r = run('quest-nudge.mjs', { home, cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('CWE-798'), 'exempt basename produces no nudges');
  assert.match(r.stdout, /clean/);
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('terminal escapes smuggled into code lines and commit subjects are stripped', () => {
  const home = tmpHome();
  const { dir, g } = initRepo(home);
  // a hostile repo embeds OSC/CSI escapes in a source line and a commit subject
  const evil = 'var x = 1; // \x1b]0;pwned\x07 and \x1b[2J wiped\n';
  commit(g, dir, 'app.js', evil, 'sneaky \x1b[31msubject');
  const r = run('quest-nudge.mjs', { home, cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /app\.js:1.*no-var/, 'the finding itself still reports');
  assert.ok(!r.stdout.includes('\x1b]0;'), 'OSC title escape stripped from the snippet');
  assert.ok(!r.stdout.includes('\x1b[2J'), 'clear-screen escape stripped from the snippet');
  assert.ok(!r.stdout.includes('\x1b[31m'), 'escape stripped from the commit subject');
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('outside a git repo the nudge declines gracefully', () => {
  const home = tmpHome();
  const dir = mkdtempSync(join(tmpdir(), 'cq-nudge-norepo-'));
  const r = run('quest-nudge.mjs', { home, cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Not a git repository/);
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('running /cq-nudge does not advance the game', () => {
  const home = tmpHome();
  const cwd = '/tmp/cq-proj-nudge-self';
  const r = run('quest-hook.mjs', { home, input: bashEvent(cwd, 'node /x/bin/quest-nudge.mjs 10 --all') });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(projFile(home, cwd)), 'no state written, no step taken');
  rmSync(home, { recursive: true, force: true });
});
