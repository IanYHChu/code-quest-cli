// code-quest:noscan
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpHome, stateDir, readJson, run } from './helpers.mjs';

const ORIGINAL = { type: 'command', command: 'echo hi' };
function seedSettings(home, extra = {}) {
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'),
    JSON.stringify({ statusLine: ORIGINAL, permissions: { allow: ['Bash(ls:*)'] }, ...extra }, null, 2));
}
const settingsPath = (home) => join(home, '.claude', 'settings.json');
const backupPath = (home) => settingsPath(home) + '.cq-backup';
const wrapperPath = (home) => join(stateDir(home), 'bin', 'quest-statusline.sh');
const origPath = (home) => join(stateDir(home), 'bin', 'quest-statusline.orig.sh');
const ourHooks = (settings, event) =>
  (settings.hooks?.[event] || []).filter(e => (e.hooks || []).some(h => h.command.includes('quest-hook.mjs')));

test('install wraps the status line, adds hooks, preserves other settings, backs up', () => {
  const home = tmpHome();
  seedSettings(home);
  const r = run('cli.mjs', { home, args: ['install'] });
  assert.equal(r.status, 0, r.stderr);
  const s = readJson(settingsPath(home));
  assert.match(s.statusLine.command, /quest-statusline\.sh/);
  for (const ev of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit']) assert.equal(ourHooks(s, ev).length, 1, ev);
  assert.deepEqual(s.permissions, { allow: ['Bash(ls:*)'] });               // untouched
  assert.ok(existsSync(backupPath(home)), 'backup created');
  assert.match(readFileSync(wrapperPath(home), 'utf8'), /quest-statusline\.orig\.sh/, 'wrapper delegates to the side script');
  assert.match(readFileSync(origPath(home), 'utf8'), /echo hi/, 'original stored verbatim in its own file');
  // the node binary that ran the installer is pinned (with a PATH fallback) for nvm/asdf setups
  assert.ok(ourHooks(s, 'PostToolUse')[0].hooks[0].command.includes(process.execPath), 'node binary pinned in hooks');
  assert.match(readFileSync(wrapperPath(home), 'utf8'), /\[ -x "\$node" \] \|\| node=node/, 'node fallback in wrapper');
  // PreToolUse (the vigil timer) is matcher-limited to tools that can run long; PostToolUse sees all
  assert.match(ourHooks(s, 'PreToolUse')[0].matcher, /Bash/);
  assert.notEqual(ourHooks(s, 'PreToolUse')[0].matcher, '*');
  assert.ok(existsSync(join(home, '.claude', 'commands', 'cq.md')));
  assert.ok(existsSync(join(stateDir(home), 'config.json')), 'config seeded');
  rmSync(home, { recursive: true, force: true });
});

test('install is idempotent (no duplicate hooks, original preserved via manifest)', () => {
  const home = tmpHome();
  seedSettings(home);
  run('cli.mjs', { home, args: ['install'] });
  const r = run('cli.mjs', { home, args: ['install'] });
  assert.equal(r.status, 0, r.stderr);
  const s = readJson(settingsPath(home));
  for (const ev of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit']) assert.equal(ourHooks(s, ev).length, 1, ev);
  assert.match(readFileSync(origPath(home), 'utf8'), /echo hi/);
  rmSync(home, { recursive: true, force: true });
});

test('install refuses to touch a corrupt settings.json', () => {
  const home = tmpHome();
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(settingsPath(home), '{ this is not json');
  const r = run('cli.mjs', { home, args: ['install'] });
  assert.notEqual(r.status, 0, 'must exit non-zero');
  assert.equal(readFileSync(settingsPath(home), 'utf8'), '{ this is not json', 'file untouched');
  assert.ok(!existsSync(join(stateDir(home), '.install.json')), 'nothing installed');
  rmSync(home, { recursive: true, force: true });
});

test('uninstall restores the original status line and strips hooks', () => {
  const home = tmpHome();
  seedSettings(home);
  run('cli.mjs', { home, args: ['install'] });
  const r = run('cli.mjs', { home, args: ['uninstall'] });
  assert.equal(r.status, 0, r.stderr);
  const s = readJson(settingsPath(home));
  assert.deepEqual(s.statusLine, ORIGINAL);
  assert.equal(s.hooks, undefined);
  assert.deepEqual(s.permissions, { allow: ['Bash(ls:*)'] });
  assert.ok(!existsSync(join(home, '.claude', 'commands', 'cq.md')));
  rmSync(home, { recursive: true, force: true });
});

test('a lost manifest does not lose the original status line (recovered from the side script)', () => {
  const home = tmpHome();
  seedSettings(home);
  run('cli.mjs', { home, args: ['install'] });
  rmSync(join(stateDir(home), '.install.json'));
  const r = run('cli.mjs', { home, args: ['install'] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(origPath(home), 'utf8'), /echo hi/, 'original survives reinstall');
  assert.deepEqual(readJson(join(stateDir(home), '.install.json')).originalStatusLine, ORIGINAL);
  rmSync(home, { recursive: true, force: true });
});

test('an original status line with quotes, pipes and newlines is never mangled', () => {
  const home = tmpHome();
  const cmd = 'printf \'%s\' "a\\"b" | head -1\necho "second | line"';
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(settingsPath(home), JSON.stringify({ statusLine: { type: 'command', command: cmd } }, null, 2));
  run('cli.mjs', { home, args: ['install'] });
  assert.ok(readFileSync(origPath(home), 'utf8').includes(cmd), 'stored verbatim');
  rmSync(join(stateDir(home), '.install.json'));                 // force side-script recovery
  run('cli.mjs', { home, args: ['install'] });
  assert.equal(readJson(join(stateDir(home), '.install.json')).originalStatusLine.command, cmd, 'recovered verbatim');
  run('cli.mjs', { home, args: ['uninstall'] });
  assert.equal(readJson(settingsPath(home)).statusLine.command, cmd, 'restored verbatim');
  rmSync(home, { recursive: true, force: true });
});

test("a user wrapper that merely mentions quest-statusline.sh is THEIRS and is preserved", () => {
  // regression: a dev setup pointing settings at a repo checkout's quest-statusline.sh was
  // mistaken for our installed wrapper (basename match), so install dropped it instead of
  // chaining it. Ours is only the exact BIN path.
  const home = tmpHome();
  const devCmd = 'bash "/some/repo/checkout/quest-statusline.sh"';
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(settingsPath(home), JSON.stringify({ statusLine: { type: 'command', command: devCmd } }, null, 2));
  const r = run('cli.mjs', { home, args: ['install'] });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(readFileSync(origPath(home), 'utf8').includes(devCmd), 'dev wrapper captured as the original');
  assert.deepEqual(readJson(join(stateDir(home), '.install.json')).originalStatusLine.command, devCmd);
  run('cli.mjs', { home, args: ['uninstall'] });
  assert.equal(readJson(settingsPath(home)).statusLine.command, devCmd, 'restored on uninstall');
  rmSync(home, { recursive: true, force: true });
});

test("a user's own hook that merely mentions quest-hook.mjs is THEIRS and survives uninstall", () => {
  // same rule as the status-line wrapper: ours is only the exact BIN path, so a dev setup whose
  // hook invokes a repo checkout's quest-hook.mjs must never be stripped as a stale copy of ours
  const home = tmpHome();
  const userHook = { hooks: [{ type: 'command', command: 'node /some/repo/checkout/quest-hook.mjs' }] };
  seedSettings(home, { hooks: { PostToolUse: [userHook] } });
  run('cli.mjs', { home, args: ['install'] });
  let s = readJson(settingsPath(home));
  assert.equal(s.hooks.PostToolUse.length, 2, 'user hook + ours coexist after install');
  run('cli.mjs', { home, args: ['uninstall'] });
  s = readJson(settingsPath(home));
  assert.deepEqual(s.hooks.PostToolUse, [userHook], 'only ours removed');
  rmSync(home, { recursive: true, force: true });
});

test('uninstall with a corrupt settings.json still removes files, leaves settings and backup alone', () => {
  const home = tmpHome();
  seedSettings(home);
  run('cli.mjs', { home, args: ['install'] });
  writeFileSync(settingsPath(home), '{ broken');
  const r = run('cli.mjs', { home, args: ['uninstall'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(settingsPath(home), 'utf8'), '{ broken', 'settings untouched');
  assert.ok(!existsSync(join(home, '.claude', 'commands', 'cq.md')), 'commands removed');
  assert.ok(!existsSync(join(stateDir(home), 'bin')), 'runtime removed');
  assert.ok(existsSync(backupPath(home)), 'pristine backup kept for manual recovery');
  rmSync(home, { recursive: true, force: true });
});

test("a user's own command file with our name is backed up on install and restored on uninstall", () => {
  const home = tmpHome();
  seedSettings(home);
  const mine = '---\ndescription: my own cq command\n---\ndo my thing\n';
  mkdirSync(join(home, '.claude', 'commands'), { recursive: true });
  writeFileSync(join(home, '.claude', 'commands', 'cq.md'), mine);
  run('cli.mjs', { home, args: ['install'] });
  const installed = readFileSync(join(home, '.claude', 'commands', 'cq.md'), 'utf8');
  assert.match(installed, /quest-report\.mjs/, 'ours installed');
  // permission scope is the exact installed script, not a blanket node grant
  assert.match(installed, /allowed-tools: Bash\(node "[^"]*quest-report\.mjs":\*\)/, 'allowed-tools pinned to the script');
  assert.equal(readFileSync(join(home, '.claude', 'commands', 'cq.md.cq-backup'), 'utf8'), mine, 'user file backed up');
  run('cli.mjs', { home, args: ['install'] });                   // a re-install must not clobber the snapshot with OUR file
  assert.equal(readFileSync(join(home, '.claude', 'commands', 'cq.md.cq-backup'), 'utf8'), mine, 'snapshot survives re-install');
  run('cli.mjs', { home, args: ['uninstall'] });
  assert.equal(readFileSync(join(home, '.claude', 'commands', 'cq.md'), 'utf8'), mine, 'user file restored');
  assert.ok(!existsSync(join(home, '.claude', 'commands', 'cq.md.cq-backup')), 'backup consumed by the restore');
  rmSync(home, { recursive: true, force: true });
});

test('the settings backup is a pristine one-shot, removed on uninstall', () => {
  const home = tmpHome();
  seedSettings(home);
  const pristine = readFileSync(settingsPath(home), 'utf8');
  run('cli.mjs', { home, args: ['install'] });
  run('cli.mjs', { home, args: ['install'] });                   // a later run must not overwrite the snapshot
  assert.equal(readFileSync(backupPath(home), 'utf8'), pristine, 'snapshot still pre-Code-Quest');
  run('cli.mjs', { home, args: ['uninstall'] });
  assert.ok(!existsSync(backupPath(home)), 'snapshot removed after the restore');
  rmSync(home, { recursive: true, force: true });
});
