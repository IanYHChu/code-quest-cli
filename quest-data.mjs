#!/usr/bin/env node
// code-quest:noscan  (this module is the single source of tunable numbers + output text)
// Code Quest - the Node data layer. The defaults themselves (DEFAULT_CONFIG, DEFAULT_STRINGS) and
// every pure helper live in quest-config.mjs, which also loads inside a Claude Code mod; this
// module adds what needs Node: the state dir, hashing, atomic writes, and the user files:
//   ~/.claude/code-quest/config.json   and   ~/.claude/code-quest/strings.json
// Those override files are seeded once by the installer and NEVER overwritten on upgrade, so
// a new version refreshes the baked-in defaults (filling any new keys) without clobbering edits.
// Loads defensively: a missing or corrupt override file falls back to the defaults, never throws.
import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG, STR, applyOverrides } from './quest-config.mjs';

// the pure layer, re-exported so every existing importer of quest-data.mjs keeps working
export * from './quest-config.mjs';

export const STATE_DIR = join(homedir(), '.claude', 'code-quest');
export const SAVE_VERSION = 1; // hero/proj save schema version — bump when migrateHero() gains a step

// key for per-project state files (and the vigil's pending stamps): truncated sha256 of the
// project path — collision-safe, unlike the 32-bit FNV-1a it replaced pre-release. Shared here so
// the hook, the status line, the report and the tests can never disagree on a project's file name.
export function hashStr(str = '') { return createHash('sha256').update(String(str)).digest('hex').slice(0, 16); }

// Atomic write: write a temp file then rename over the target (rename is atomic on POSIX). A
// CONCURRENT reader — a second Claude Code window, the status line, or Claude Code itself reading
// settings.json — always sees a complete old or new file, never a half-written one. (It still
// doesn't serialize write-vs-write; see the multi-instance note in README.)
export function writeAtomic(p, data) {
  const tmp = p + '.tmp' + process.pid;
  try {
    // preserve the target's permissions: rename would otherwise reset them to the umask default,
    // silently widening a file the user had locked down (e.g. a chmod-600 settings.json).
    let mode;
    try { mode = statSync(p).mode & 0o777; } catch {}
    writeFileSync(tmp, data, mode === undefined ? {} : { mode });
    renameSync(tmp, p);
  } catch { try { writeFileSync(p, data); } catch {} }
}

// --- user override files: read here (Node), applied to the shared CONFIG / STR in place ------
function loadOverride(name) {
  try { return JSON.parse(readFileSync(join(STATE_DIR, name), 'utf8')); } catch { return null; }
}

applyOverrides({ config: loadOverride('config.json'), strings: loadOverride('strings.json') });
export { CONFIG, STR };
