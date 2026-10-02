#!/usr/bin/env node
// Code Quest installer.  Usage:  (the npm package is code-quest-cli; the bare name `code-quest`
// is blocked by npm's similarity rule for everyone, so nobody else can claim it either)
//   npx code-quest-cli install     wire up status line + hooks + slash commands (idempotent)
//   npx code-quest-cli uninstall   cleanly remove everything (add --purge to also wipe your save)
//   npx code-quest-cli status      show what's installed
import {
  readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, renameSync, existsSync, statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STR, fmt, maxlpFor, DEFAULT_CONFIG, DEFAULT_STRINGS } from './quest-data.mjs';

const PKG = dirname(fileURLToPath(import.meta.url));         // where this package's files live
const HOME = homedir();
const CLAUDE = join(HOME, '.claude');
const CQDIR = join(CLAUDE, 'code-quest');                   // state + installed runtime
const BIN = join(CQDIR, 'bin');                             // copied runtime scripts (stable absolute path)
const CMDDIR = join(CLAUDE, 'commands');
const SETTINGS = join(CLAUDE, 'settings.json');
const MANIFEST = join(CQDIR, '.install.json');
const say = (s = '') => process.stdout.write(s + '\n');     // installer output (a CLI prints; not debug)
// the scanner's in-content opt-out marker, built by concatenation: this file WRITES the sentinel
// into generated scripts but must not carry the literal itself (that would exempt cli.mjs from
// Code Quest's own scan).
const NOSCAN = 'code-quest:' + 'noscan';
// marker carried by OUR installed command files. Ownership checks (back up before overwrite,
// delete on uninstall) test for THIS string, not the words "Code Quest" — a user's own command
// that merely mentions the game by name must never be mistaken for one of ours.
const CMD_MARKER = 'code-quest:command';

const RUNTIME = [
  'quest-data.mjs', 'quest-rules.mjs', 'quest-analyze.mjs', 'quest-state.mjs', 'quest-dungeon.mjs',
  'quest-hook.mjs', 'quest-status.mjs', 'quest-report.mjs', 'quest-reroll.mjs', 'quest-nudge.mjs',
];
const COMMANDS = ['cq.md', 'cq-reroll.md', 'cq-help.md', 'cq-nudge.md'];
// Embed the node binary that ran the installer (with a PATH fallback): nvm/asdf users often have
// no `node` on the non-interactive PATH that hooks and the status line run under. Re-running
// install re-pins the path after a node upgrade. A path containing shell metacharacters can't be
// embedded safely inside the double-quoted hook/wrapper commands, so such a path is not pinned —
// those installs rely on the PATH fallback instead.
const NODE = /["$`\\]/.test(process.execPath) ? 'node' : process.execPath;
const HOOK_CMD = `n="${NODE}"; [ -x "$n" ] || n=node; "$n" "${join(BIN, 'quest-hook.mjs')}"`;
// PreToolUse exists only to timestamp tool starts for the vigil (which rewards a LONG-running
// tool). Sub-second tools (Read/Edit/Grep/...) can never earn one, so the matcher skips them —
// one less node spawn on the hottest path. PostToolUse (the game itself) still sees every tool.
const VIGIL_MATCHER = 'Bash|Task|Agent|Workflow|WebFetch|WebSearch|mcp__.*';
const STATUS_WRAPPER = join(BIN, 'quest-statusline.sh');
const ORIG_SCRIPT = join(BIN, 'quest-statusline.orig.sh');  // the user's original status line, stored verbatim
// Ours = the INSTALLED hook at its exact BIN path (same rule as isOurStatus below): a user's own
// hook entry that happens to invoke a repo checkout's quest-hook.mjs is THEIRS and must survive
// install/uninstall untouched, not be stripped as a stale copy of ours.
const isOurHook = (c) => typeof c === 'string' && c.includes(join(BIN, 'quest-hook.mjs'));
// Ours = the INSTALLED wrapper at its exact BIN path. Matching the bare filename would also match
// a user's own wrapper that happens to invoke a repo checkout's quest-statusline.sh — which is THEIR
// status line and must be preserved as the original, not mistaken for ours and dropped.
const isOurStatus = (c) => typeof c === 'string' && c.includes(STATUS_WRAPPER);

function readJson(p, def) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return def; } }
// Installer writes are STRICT, unlike the game's silent writeAtomic: a settings.json (or manifest)
// that failed to land must surface the error and exit 1 — never print "installed" over a write that
// silently went nowhere. Still atomic (temp + rename) and still preserves the target's permissions.
function writeJson(p, o) {
  let mode;
  try { mode = statSync(p).mode & 0o777; } catch {}
  const tmp = p + '.tmp' + process.pid;
  writeFileSync(tmp, JSON.stringify(o, null, 2) + '\n', mode === undefined ? {} : { mode });
  renameSync(tmp, p);
}
// the wrapper/side scripts get the same temp+rename treatment: a status line firing mid-reinstall
// must execute a complete old or new script, never a half-written one.
function writeScript(p, text) {
  const tmp = p + '.tmp' + process.pid;
  writeFileSync(tmp, text);
  renameSync(tmp, p);
}

// settings.json is the user's whole Claude Code configuration — treat it as precious. A corrupt
// file must ABORT (never be silently replaced with {}), and the FIRST time we ever touch it a
// pristine snapshot is taken — never overwritten by later runs, so it always shows the file from
// before Code Quest existed. A clean uninstall removes it (the restore has just happened), so a
// future reinstall takes a fresh snapshot.
const BACKUP = SETTINGS + '.cq-backup';
function readSettings() {
  let raw;
  try { raw = readFileSync(SETTINGS, 'utf8'); } catch { return { exists: false, ok: true, data: {} }; }
  try { return { exists: true, ok: true, data: JSON.parse(raw) }; }
  catch { return { exists: true, ok: false, data: null }; }
}
function loadSettingsOrDie() {
  const st = readSettings();
  if (!st.ok) { console.error(fmt(STR.install.settingsCorrupt, { settings: SETTINGS })); process.exit(1); }
  if (st.exists && !existsSync(BACKUP)) {
    // a failed snapshot must not be silent: the corrupt-uninstall path tells the user to recover
    // from this very file, so they deserve to know it never landed. Install still proceeds.
    try { copyFileSync(SETTINGS, BACKUP); }
    catch { console.error(fmt(STR.install.backupFailed, { settings: SETTINGS, backup: BACKUP })); }
  }
  return st.data;
}

// If the manifest was lost while our wrapper is still installed, the user's original status line
// command can be recovered: installs keep it VERBATIM in a side script next to the wrapper.
function recoverOriginalFromWrapper() {
  try {
    const header = new RegExp(`^#!.*\\n# ${NOSCAN}\\n`);
    const cmd = readFileSync(ORIG_SCRIPT, 'utf8').replace(header, '').trim();
    if (cmd) return { type: 'command', command: cmd };
  } catch {}
  return null;
}

// The original command is stored VERBATIM in its own script and invoked via `bash <file>` — never
// interpolated into the wrapper — so quotes, pipes or newlines in it can't break the wrapper's
// syntax or be mangled on recovery.
function writeWrapper(originalCmd) {
  const L = ['#!/usr/bin/env bash', `# ${NOSCAN}`, 'input=$(cat)',
    `node="${NODE}"; [ -x "$node" ] || node=node`,
    `game=$(printf '%s' "$input" | "$node" "${join(BIN, 'quest-status.mjs')}" 2>/dev/null)`];
  if (originalCmd) {
    writeScript(ORIG_SCRIPT, `#!/usr/bin/env bash\n# ${NOSCAN}\n${originalCmd}\n`);
    L.push(`orig=$(printf '%s' "$input" | bash "${ORIG_SCRIPT}" 2>/dev/null | head -1)`);
    L.push(`printf '%s  ┃  %s' "$orig" "$game"`);
  } else {
    try { rmSync(ORIG_SCRIPT, { force: true }); } catch {}      // no stale original for recovery to resurrect
    L.push(`printf '%s' "$game"`);
  }
  writeScript(STATUS_WRAPPER, L.join('\n') + '\n');
}

function ensureHook(settings, event, matcher) {
  settings.hooks = settings.hooks || {};
  const arr = settings.hooks[event] = settings.hooks[event] || [];
  if (arr.some(e => (e.hooks || []).some(h => isOurHook(h.command)))) return; // already present
  const entry = { hooks: [{ type: 'command', command: HOOK_CMD }] };
  if (matcher) entry.matcher = matcher;
  arr.push(entry);
}
function stripHook(settings, event) {
  if (!settings.hooks || !settings.hooks[event]) return;
  settings.hooks[event] = settings.hooks[event].filter(e => !(e.hooks || []).some(h => isOurHook(h.command)));
  if (!settings.hooks[event].length) delete settings.hooks[event];
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
}

function install() {
  // uninstall/status still work on Windows; only install is gated
  if (process.platform === 'win32') { say(STR.install.windowsUnsupported); process.exit(1); }
  mkdirSync(BIN, { recursive: true });
  mkdirSync(CMDDIR, { recursive: true });
  for (const f of RUNTIME) copyFileSync(join(PKG, f), join(BIN, f));

  const settings = loadSettingsOrDie();
  const manifest = readJson(MANIFEST, {});
  // capture the user's real statusLine once, so uninstall can restore it; if the manifest was
  // lost while our wrapper is active, recover the original command from the wrapper script.
  const original = isOurStatus(settings.statusLine && settings.statusLine.command)
    ? (manifest.originalStatusLine ?? recoverOriginalFromWrapper())
    : (settings.statusLine ?? null);
  writeWrapper(original && original.command);
  settings.statusLine = { type: 'command', command: `bash "${STATUS_WRAPPER}"` };

  // replace rather than merge our hook entries, so a re-install refreshes the embedded node path
  // and the PreToolUse matcher on an existing install instead of keeping the stale ones.
  for (const ev of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit']) stripHook(settings, ev);
  ensureHook(settings, 'PreToolUse', VIGIL_MATCHER);
  ensureHook(settings, 'PostToolUse', '*');
  ensureHook(settings, 'UserPromptSubmit');
  mkdirSync(CLAUDE, { recursive: true });
  writeJson(SETTINGS, settings);

  for (const c of COMMANDS) {
    const tpl = readFileSync(join(PKG, 'legacy-commands', c), 'utf8').replaceAll('__CQ_BIN__', BIN);
    const dest = join(CMDDIR, c);
    // a pre-existing command file that isn't ours (no CMD_MARKER) is the USER's own command:
    // snapshot it once beside itself so uninstall can put it back, never silently clobber it.
    try {
      const cur = readFileSync(dest, 'utf8');
      if (!cur.includes(CMD_MARKER) && !existsSync(dest + '.cq-backup')) {
        copyFileSync(dest, dest + '.cq-backup');
        say(fmt(STR.install.commandBackedUp, { file: dest, backup: dest + '.cq-backup' }));
      }
    } catch {}
    writeFileSync(dest, tpl);
  }
  writeJson(MANIFEST, {
    version: readJson(join(PKG, 'package.json'), {}).version || '?',
    binDir: BIN, originalStatusLine: original, commands: COMMANDS,
  });

  // seed the user-editable config/strings ONCE; never overwrite on upgrade so customizations
  // (and translations) survive. Always refresh a read-only reference of the latest full defaults.
  const seed = (name, obj) => { const p = join(CQDIR, name); if (!existsSync(p)) writeJson(p, obj); };
  seed('config.json', DEFAULT_CONFIG);
  seed('strings.json', DEFAULT_STRINGS);
  writeJson(join(CQDIR, 'config.defaults.json'), DEFAULT_CONFIG);
  writeJson(join(CQDIR, 'strings.defaults.json'), DEFAULT_STRINGS);

  say(fmt(STR.install.installed, {
    bin: BIN,
    cmds: COMMANDS.map(c => '/' + c.replace('.md', '')).join('  '),
    settings: SETTINGS,
  }));
}

function uninstall(purge) {
  const manifest = readJson(MANIFEST, null);
  // A corrupt settings.json must not strand the user mid-uninstall (install refusing is right;
  // uninstall refusing would leave everything behind): skip the settings edits — told to clean up
  // by hand, with the pristine backup KEPT for that — but still remove all our files below.
  const st = readSettings();
  if (!st.ok) {
    console.error(fmt(STR.install.settingsCorruptUninstall, { settings: SETTINGS, backup: BACKUP }));
  } else {
    const settings = st.data;
    if (settings.statusLine && isOurStatus(settings.statusLine.command)) {
      const original = (manifest && manifest.originalStatusLine) || recoverOriginalFromWrapper();
      if (original) settings.statusLine = original;
      else delete settings.statusLine;
    }
    stripHook(settings, 'PreToolUse');
    stripHook(settings, 'PostToolUse');
    stripHook(settings, 'UserPromptSubmit');
    if (st.exists) writeJson(SETTINGS, settings);
    try { rmSync(BACKUP, { force: true }); } catch {}   // restored — the pristine snapshot has served its purpose
  }

  for (const c of COMMANDS) {
    const dest = join(CMDDIR, c);
    // delete only OUR command file (it carries CMD_MARKER): a file the user rewrote as their own
    // is theirs now and must survive — and must not be clobbered by the backup either, so the
    // displaced original is only restored into a vacancy.
    try { if (readFileSync(dest, 'utf8').includes(CMD_MARKER)) rmSync(dest); } catch {}
    try { if (!existsSync(dest) && existsSync(dest + '.cq-backup')) renameSync(dest + '.cq-backup', dest); } catch {}
  }
  try { rmSync(BIN, { recursive: true, force: true }); } catch {}
  try { rmSync(MANIFEST, { force: true }); } catch {}
  if (purge) { try { rmSync(CQDIR, { recursive: true, force: true }); } catch {} }

  say(fmt(STR.install.removed, { tail: purge ? STR.install.removedPurged : STR.install.removedKept }));
}

function status() {
  const installed = existsSync(MANIFEST);
  const hero = readJson(join(CQDIR, 'hero.json'), null);
  const h = hero && (hero.d || hero);
  say(installed ? STR.install.statusInstalled : STR.install.statusNotInstalled);
  if (h) {
    say(fmt(STR.install.statusHero, {
      lv: h.lv, lp: h.lp, maxlp: maxlpFor(h),
      relics: (h.relics || []).length, revives: h.revives || 0,
    }));
  }
}

const cmd = (process.argv[2] || 'install').toLowerCase();
try {
  if (cmd === 'install') install();
  else if (cmd === 'uninstall' || cmd === 'remove') uninstall(process.argv.includes('--purge'));
  else if (cmd === 'status') status();
  else { say(STR.install.usage); process.exit(1); }
} catch (e) {
  console.error(STR.install.error, e.message);
  process.exit(1);
}
