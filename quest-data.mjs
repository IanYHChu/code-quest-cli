#!/usr/bin/env node
// code-quest:noscan  (this module is the single source of tunable numbers + output text)
// Code Quest - shared data layer. ALL balance knobs live in DEFAULT_CONFIG and ALL
// player-facing text lives in DEFAULT_STRINGS, so tuning / translating / porting the game
// means editing data, not logic. Both are overlaid (deep-merged) with optional user files:
//   ~/.claude/code-quest/config.json   and   ~/.claude/code-quest/strings.json
// Those override files are seeded once by the installer and NEVER overwritten on upgrade, so
// a new version refreshes the baked-in defaults (filling any new keys) without clobbering edits.
// Loads defensively: a missing or corrupt override file falls back to the defaults, never throws.
import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

// --- tunable balance knobs ------------------------------------------------------------------
export const DEFAULT_CONFIG = {
  hero: {
    startLp: 20,                 // fresh hero LP
    maxLevel: 99,                // level clamp
    lpBase: 20,                  // maxHP = lpBase + (lv-1)*lpPerLevel + hpbonus
    lpPerLevel: 2,
    hpRelicBonus: 5,             // +HP relic raises the cap by this much
    mitigationLevelDivisor: 25,  // every N levels shrugs off 1 more chip damage
    // relative drop odds per relic kind. revive is a consumable that auto-saves you from a boss
    // defeat (full heal, keep fighting); it is rarer than the permanent stat relics.
    relicWeights: { atk: 3, def: 3, hp: 3, revive: 2 },
  },
  lane: {
    min: 6, max: 18,             // base floor length range (from file size)
    base: 9,                     // fallback length when a profile has none
    baseOffset: 6,               // length = baseOffset + lines/linesPerStep
    linesPerStep: 80,
    genMin: 6, genMax: 250,      // length after the per-level stretch
    levelLengthFactor: 2.5,      // higher level = longer floors (slower late-game curve)
  },
  analyze: {
    longLineLen: 120,            // a line longer than this counts as a smell
    magicDigits: 4,              // bare integers with this many+ digits = magic number
    scanMaxBytes: 262144,        // only the first N bytes of a file are scanned (latency guard)
    scanMaxLineLen: 2000,        // a longer line counts as long but skips per-line pattern scans (minified guard)
    godFileLines: 400,           // files past this are "god files"
    indentTab: 2,                // a tab counts as this many indent columns
    tidyMaxDepth: 4, tidyMinLines: 8, tidyMaxLines: 300, // a focused shallow module earns a boon
    trapDepthDivisor: 12, trapGodFileWeight: 0.35, trapDeadWeight: 0.04, // -> trapDensity
    ambushCap: 25,               // ambushBias ceiling
    ambushTodoWeight: 3, ambushLongLineWeight: 1, ambushMagicWeight: 1,
    ambushSwallowWeight: 4, ambushDebugWeight: 2, ambushMisconfigWeight: 3, ambushContainerWeight: 2,
    ambushQualityWeight: 3,      // each Tier-A quality smell (no-var / any / skipped test / complexity) widens ambushes
    trapQualityWeight: 0.06,     // each structural quality smell (== / long param list) adds floor traps
    // file-wide branch-point count over this = cognitively complex (Sonar S3776). Counted on
    // comment-stripped text. Tuned so a few-hundred-line module with ordinary defensive branching
    // stays under it, while an unsplit do-everything file (measured ~230 on a real one) fires.
    complexityThreshold: 120,
    boonDivisor: 4,              // virtue / boonDivisor -> boonDensity
    proseBoonDensity: 0.35,      // a clean doc is a calm, rewarding stroll
    proseInjAmbushBias: 20,      // a tainted doc spikes ambushes
    proseInjPowerBase: 3, proseInjPowerMax: 5,
  },
  power: { min: 1, max: 5, severityDivisor: 2, depthDivisor: 3 }, // floor power grading
  track: {
    secretsCap: 2,               // at most this many $ per floor
    trapFactor: 0.5, boonFactor: 0.5, // density -> count scaling
    baseBoonChance: 45,          // % chance even a neutral floor seeds one boon
    exitMinFromStart: 3,         // the * never sits right at the entrance
  },
  ambush: {
    baseAggro: 20, maxAggro: 80, // clean ~20%; debt widens, taming shrinks
    pincerThreshold: 20, rearThreshold: 70, // kind-of-ambush roll bands (0-99)
    backDmg: 2, frontDmg: 1,     // small fixed chips, reduced by mitigation
    tamingCap: 40, tamingStep: 1, // a slain boss tames the dungeon
  },
  hazard: {
    leakMultiplier: 2,           // $ leak bites power*leakMultiplier
    boonHeal: 2,                 // + tile heal
    boonRelicChance: 8,          // % chance a + tile also forges a relic
  },
  boss: {
    // The fight is a multi-round HP duel, not a single check. Boss HP exceeds your maxlp, and you
    // trade blows each round until one side drops. Your per-round damage scales with level + ATK +
    // buff + the diff's virtue; the boss's per-round damage scales with your maxlp so it stays a real
    // threat at every level. Preparation (buff from tests, relics, a clean+virtuous diff) wins fast
    // and nearly unscathed; a naked or dirty commit drags it out and can get you defeated.
    hpMult: 1.25, hpPowerMult: 5, hpSmellMult: 4,        // boss HP = round(maxlp*hpMult) + power/smell bonus
    atkLvMult: 0.5, atkBuffMult: 5,                      // your dmg/round = round(lv*atkLvMult) + ATK*buff*atkBuffMult + virtue + d{diceSides}
    bossDmgFrac: 0.11, bossDmgPowerMult: 2, bossDmgSmellMult: 1.5, // boss dmg/round = round(maxlp*bossDmgFrac + power/smell) - mitigation
    diceSides: 6, maxRounds: 5,  // the whole fight is shown in ONE status-line frame, so keep it short
    sparkBlocks: '▁▂▃▄▅▆▇█',     // HP-bar glyphs (low→high) for the per-round sparklines
    loseReviveFrac: 0.34,        // a defeat leaves you limping at this fraction of maxlp (no free full revive)
    holdMs: 12000,               // the status line keeps showing the fight result for this long (so a
                                 // follow-up command like `git log` can't bury it before a redraw lands)
    // a +2 Lv "big boss" is a genuinely nasty fight: a dirty diff OR a high-power (debt-ridden) dungeon
    bigBossSmells: 3, bigBossPower: 4, bigBossLvUp: 2, normalLvUp: 1,
    dropChance: 35,              // % loot drop on a kill
    freshCommitSecs: 300,        // HEAD's committer time must be this fresh — a commit rejected by a
                                 // pre-commit hook leaves HEAD old, and an old HEAD is no boss
  },
  test: { failDamage: 3, passHeal: 3 },
  buff: { testCap: 6, max: 9, bossReset: 1 },
  // The Penitent Engine (a Warhammer 40K nod): a save whose signature fails to verify, or whose
  // level is impossible given its lifetime ledger, is locked into the engine — LP drains every
  // move while ATK is boosted (pure offense, no protection, true to the source) — until DEATH
  // releases it (the normal revive applies, the mark is lifted). Penance is paid in blood, not
  // erased. This is tamper-EVIDENCE with an in-fiction consequence, not anti-cheat (only a server
  // could be that).
  tamper: {
    penitentDrain: 1,            // LP lost on every move while penitent
    penitentStatMult: 1.1,       // effective ATK multiplier while penitent (+10%); DEF is untouched
  },
  prompt: {
    minLen: 12,                  // shorter than this fizzles
    scoreLenMin: 40, scoreLenMax: 1200, // a well-sized prompt earns a point
    healMin: 2, healMax: 5,      // good prompt = in-dungeon heal
    healScoreThreshold: 2,       // need this score to heal at all
    strikeScoreThreshold: 3,     // need this score to also clear a hazard ahead
    sentenceCount: 2,            // 2+ sentence-enders earns a point
  },
  vigil: {
    minMinutes: 1,               // a tool running this long fills the idle window
    perMinutes: 3,               // ~every N minutes = +1 buff
    buffCap: 4,                  // max buff from a single vigil
    relicMinutes: 12,            // a very long vigil forges a relic
  },
  store: { findingsCap: 300, pendingPruneMinutes: 30, stdinMaxMB: 8 }, // hook-payload size cap (oversized = skip the scan, never OOM)
  // /cq-nudge — the commit-nudge report (quest-nudge.mjs): how many of YOUR recent commits to
  // re-scan, and output caps so a giant diff can't flood the terminal or stall the command.
  nudge: {
    commits: 5,                  // default number of recent commits to review (/cq-nudge N overrides)
    maxCommits: 50,              // hard ceiling on N
    maxPerCommit: 40,            // findings shown per commit before truncating
    maxLinesPerFile: 4000,       // added lines scanned per file per commit (latency guard)
    snippetLen: 100,             // max chars of the offending line echoed in the report
    maxDiffMB: 8,                // git show buffer cap
  },
  // files whose BASENAME matches one of these globs are never scanned for smells — robust even on a
  // partial (offset) read, unlike the in-content `code-quest:noscan` sentinel (which still works too).
  // The default exempts ONLY the rule catalog (these two files are made of trigger literals — the
  // scanner-scans-scanner trap); the rest of Code Quest's runtime is scanned like any other code and
  // is kept clean enough to pass its own scan (see test/dogfood.test.mjs). Add your own globs for
  // generated/vendored files — but avoid generic names, a bare basename matches in EVERY repo.
  scan: { noscanFiles: ['quest-rules.mjs', 'quest-data.mjs'] },
};

// --- all player-facing text (templates use {name} placeholders, expanded by fmt()) ----------
export const DEFAULT_STRINGS = {
  events: {
    enterDungeon: 'enter the dungeon',
    floorClear: 'floor clear! Lv{lv}',
    trap: 'trap! -{dmg}',
    leak: 'LEAK! -{dmg}',
    loot: 'found loot +{n}',
    pincer: 'pincer! -{dmg}',
    ambushBack: 'ambushed! -{dmg}',
    ambushFront: 'struck ahead -{dmg}',
    fell: 'you fell! revived',
    commitSealed: 'commit sealed',
    testsFail: 'tests fail -{dmg}',
    testsPass: 'tests pass buff x{buff}',
    castClears: 'cast! +{heal} clears',
    castFocus: 'focus cast +{heal}',
    weakCast: 'weak cast',
    mumble: 'mumble... no effect',
    forbidden: '~forbidden magic~',
    taintedDoc: 'TAINTED DOC! injection',
    vigilBuff: 'vigil +{n} buff',
    penitent: 'PENITENT ENGINE!',
    penanceDone: 'penance complete',
  },
  relics: { atk: '+ATK relic!', def: '+DEF relic!', hp: '+HP relic!', phoenix: '+REVIVE relic!' },
  // git commit = a multi-round boss fight, rendered as one self-contained status-line frame.
  boss: {
    // the whole git-commit fight renders as ONE status-line frame:
    //   <red boss-HP sparkline> <yellow your-HP sparkline> <outcome>
    win: '+{lv}Lv',                  // outcome label: you slew the boss
    defeat: 'DEFEAT',                // outcome label: you fell
    revive: 'REVIVE',                // outcome label: a revive relic saved you, fight ended
  },
  // varies the "nothing happened" line so a quiet stretch still feels alive
  flavor: ['exploring…', 'quiet halls', 'press on', 'all clear', 'scouting', 'onward', 'dust and echoes', 'a calm stretch'],
  statusline: { label: 'CQ:Lv', defaultEvent: 'ready', penitentMark: '✠' },
  reroll: { done: 'Code Quest: rerolled. Hero back to Lv01, all dungeons reset.' },
  report: {
    title: 'Code Quest - Dungeon Report',
    subtitle: 'why your code became a dungeon',
    characterLabel: 'Character',
    relicsLabel: 'relics',
    revivesLabel: 'revives',
    relicsNone: 'none',
    lastBattleTitle: 'Last battle',
    lastBattleNote: '(your most recent git commit boss fight)',
    lineageVerified: 'save lineage: verified',
    lineagePenitent: 'save lineage: PENITENT ENGINE - LP -{drain} every move, ATK +{pct}%, released only by death',
    scanned: 'Scanned {n} file(s) that made the dungeon harder.',
    noSmells: 'No smells logged yet. Read a few files in Claude Code, then run this again.',
    sections: {
      inj: 'PROMPT INJECTION  (a doc tried to hijack the agent reading it)',
      leak: '$ CREDENTIAL LEAKS  (deadliest - spawn red $ hazards)',
      sin: 'SECURITY SINS  (+power: stronger traps & ambushes)',
      cwe: 'CWE WEAKNESSES  (mapped to MITRE CWE - distinct weaknesses found across your reads)',
      codeSmells: 'CODE SMELLS  (mapped to ESLint / SonarQube - maintainability & portability)',
      ambush: 'AMBUSHES  (raise the rate enemies strike from front/behind)',
      trap: 'TRAPS  (more # on the floor)',
      nesting: 'DEEP NESTING  (+power and more traps)',
      topOffenders: 'TOP OFFENDERS',
      topOffendersNote: '(hardest floors they generated)',
    },
    // MITRE CWE id -> short name, for the CWE WEAKNESSES section. Each security regex carries a cwe.
    cweNames: {
      'CWE-22': 'Path Traversal',
      'CWE-78': 'OS Command Injection',
      'CWE-79': 'Cross-site Scripting (XSS)',
      'CWE-89': 'SQL Injection',
      'CWE-95': 'Eval / Code Injection',
      'CWE-250': 'Execution with Unnecessary Privileges',
      'CWE-295': 'Improper Certificate Validation',
      'CWE-319': 'Cleartext Transmission',
      'CWE-327': 'Broken / Risky Crypto Algorithm',
      'CWE-330': 'Insufficiently Random Values',
      'CWE-352': 'Cross-Site Request Forgery (CSRF)',
      'CWE-494': 'Download of Code Without Integrity Check',
      'CWE-502': 'Deserialization of Untrusted Data',
      'CWE-532': 'Sensitive Info in Log File',
      'CWE-611': 'XML External Entity (XXE)',
      'CWE-676': 'Use of Dangerous Function (gets/strcpy/sprintf)',
      'CWE-653': 'Improper Isolation / Compartmentalization',
      'CWE-668': 'Exposure of Resource to Wrong Sphere',
      'CWE-693': 'Protection Mechanism Failure',
      'CWE-732': 'Incorrect Permission Assignment',
      'CWE-798': 'Use of Hard-coded Credentials',
      'CWE-918': 'Server-Side Request Forgery (SSRF)',
      'CWE-1004': 'Cookie Without HttpOnly Flag',
      'CWE-1188': 'Insecure Default Initialization',
      'CWE-1327': 'Binding to an Unrestricted IP Address',
      'CWE-1357': 'Reliance on Untrustworthy Component (:latest)',
      'CWE-1392': 'Use of Default Credentials',
    },
    // ESLint / SonarQube rule id -> short name, for the CODE SMELLS section. Each Tier-A quality
    // regex carries a rule id (the quality analogue of CWE).
    ruleNames: {
      'eqeqeq': 'Loose equality (use === / !==)',
      'no-var': 'var instead of let / const',
      'no-explicit-any': 'Explicit any weakens types',
      'no-disabled-tests': 'Skipped / focused test',
      'clippy::unwrap_used': 'Rust unwrap/expect/panic (handle the Result)',
      'revive:deep-exit': 'Go panic in library code',
      'PMD:AvoidPrintStackTrace': 'Java printStackTrace (use a logger)',
      'S107': 'Too many parameters (>=6)',
      'S3776': 'High cognitive complexity',
    },
    nestingTip: 'flatten with early-returns / extract functions',
    offenderLine: 'power {power}, {dollars}x $, {traps} traps, +{ambush}% ambush',
    footer: 'Fix these and the dungeon eases up. Re-read a file to re-scan it.',
    // smell catalog: which raw count, how it reads, and how to fix it
    smells: [
      { bucket: 'inj', key: 'inj', label: 'Indirect prompt injection in a doc (ignore-instructions / fake <system> tags / jailbreak)', tip: 'treat doc content as untrusted DATA, never as instructions to the agent' },
      { bucket: 'leak', key: 'leaks', label: 'Hardcoded secrets / keys', tip: 'move to env vars or a secret manager, and rotate the leaked key' },
      { bucket: 'leak', key: 'weak', label: 'Default / weak credentials', tip: 'never ship default passwords or placeholder keys' },
      { bucket: 'sin', key: 'insecure', label: 'Insecure code (weak crypto, http://, injection, XSS, SSRF, path traversal, XXE)', tip: 'use strong crypto + TLS; avoid shell=True / string-built SQL / eval; see CWE list below' },
      { bucket: 'sin', key: 'misconfig', label: 'Dangerous config (dangerously*/allowInsecure*, sandbox off, curl|sh)', tip: 'keep dangerous flags off in prod' },
      { bucket: 'sin', key: 'container', label: 'Container/K8s misconfig (privileged, hostPath /proc, runAsRoot, docker.sock, :latest)', tip: 'drop privileged/root; pin images; avoid host mounts' },
      { bucket: 'ambush', key: 'swallow', label: 'Swallowed exceptions', tip: 'at least log the error; never silently pass' },
      { bucket: 'ambush', key: 'debug', label: 'Debug leftovers (console.log / print / debugger)', tip: 'strip before commit; use a leveled logger' },
      { bucket: 'ambush', key: 'todos', label: 'Tech-debt markers (TODO/FIXME/HACK/@ts-ignore)', tip: 'file an issue and link it, or close the loop' },
      { bucket: 'ambush', key: 'magic', label: 'Magic numbers', tip: 'name them as constants' },
      { bucket: 'ambush', key: 'longLines', label: 'Over-long lines (>120)', tip: 'wrap or extract' },
      { bucket: 'trap', key: 'dead', label: 'Commented-out dead code', tip: 'delete it - git remembers' },
      { bucket: 'trap', key: 'godFile', label: 'God files (>400 lines)', tip: 'split into modules' },
    ],
  },
  // /cq-nudge — gentle, line-attributed pointers from YOUR own recent commits. Tone matters here:
  // nudges, not findings; suggestions, not verdicts. The disclaimer is part of the product — this
  // is a study aid built on the game's regex heuristics, and it says so out loud.
  nudge: {
    title: 'Code Quest - Commit Nudges',
    subtitle: 'gentle pointers from your own recent commits',
    disclaimer: [
      'Honesty first: these nudges come from the same lightweight regex heuristics that',
      'drive the game - NOT a real static analyzer. Expect occasional false positives,',
      'and expect it to miss anything that needs type or data-flow analysis. Treat each',
      'nudge as a question worth a look, never as a verdict. For serious scanning, use',
      'the professional tools listed at the bottom.',
    ],
    notRepo: 'Not a git repository here - nudges read your commits, so there is nothing to look at.',
    noCommits: 'No commits by {who} found yet. Land a commit and come back. (`/cq-nudge N --all` reviews every author.)',
    badRev: 'Could not read "{rev}" as a commit or range. Give a commit id (abc1234), a range (main..HEAD), or a count.',
    reviewing: 'Looking at {n} commit(s) by {who} - newest first.',
    reviewingRev: 'Looking at {n} commit(s) from {rev} - newest first.',
    anyAuthor: 'any author',
    usageHint: 'usage: /cq-nudge [count | commit-id | A..B] [--all] [--sarif]',
    commitClean: 'clean - nothing to nudge about. Nice.',
    truncated: '(+{n} more nudge(s) in this commit not shown)',
    legacyNote: "Only YOUR added lines are reviewed - the legacy code around them isn't your debt (that's what /cq shows).",
    summaryTitle: 'SUMMARY',
    summaryLine: '{recs} nudge(s) across {commits} commit(s): {high} high, {med} medium, {low} low, {note} style/maintainability',
    summaryClean: 'Nothing to nudge about in these commits. Ship on.',
    topRules: 'most frequent: {list}',
    proTitle: 'WHEN YOU NEED THE REAL THING  (professional scanners this toy cannot replace)',
    proTools: [
      { name: 'Semgrep', url: 'https://semgrep.dev', note: 'fast pattern-based SAST, big curated ruleset, easy in CI' },
      { name: 'CodeQL', url: 'https://codeql.github.com', note: 'deep data-flow analysis; free for open source via GitHub code scanning' },
      { name: 'SonarQube', url: 'https://www.sonarsource.com', note: 'code quality + "Clean as You Code" new-code quality gates' },
      { name: 'gitleaks', url: 'https://github.com/gitleaks/gitleaks', note: 'dedicated secret scanning across your whole git history' },
      { name: 'Trivy', url: 'https://trivy.dev', note: 'container images, IaC misconfig and dependency CVEs' },
      { name: 'your linter', url: '', note: 'ESLint / Ruff / clippy / golangci-lint / SpotBugs - run them on save or pre-commit' },
    ],
    sarifHint: '/cq-nudge --sarif emits SARIF 2.1.0 (GitHub code scanning / VS Code SARIF Viewer can read it).',
    sev: { high: 'HIGH', med: 'MED', low: 'LOW', note: 'tip' },
  },
  install: {
    installed: 'Code Quest installed.\n  runtime  -> {bin}\n  commands -> {cmds}\n  status line + Pre/PostToolUse + UserPromptSubmit hooks wired into {settings}\nRestart Claude Code (or open a new session) to load it, then just start coding.',
    removed: 'Code Quest removed (status line restored, hooks + commands deleted).{tail}',
    removedKept: ' Your hero/save was kept — uninstall --purge to wipe it.',
    removedPurged: ' Save data purged.',
    statusInstalled: 'Code Quest: installed',
    statusNotInstalled: 'Code Quest: not installed',
    statusHero: '  hero: Lv{lv} (hp {lp}/{maxlp})  relics: {relics}  revives: {revives}',
    usage: 'usage: code-quest [install|uninstall [--purge]|status]',
    error: 'code-quest:',
    settingsCorrupt: 'code-quest: {settings} exists but is not valid JSON. Refusing to touch it.\nFix the syntax error (or move the file aside) and run this again.',
    backupFailed: 'code-quest: warning — could not snapshot {settings} to {backup}; continuing without a pristine backup.',
    commandBackedUp: 'code-quest: {file} already existed (your own command) — backed up to {backup}; uninstall restores it.',
    settingsCorruptUninstall: 'code-quest: {settings} is not valid JSON, so its statusLine/hooks were left untouched — remove the Code Quest statusLine and the quest-hook.mjs hook entries by hand (a pristine pre-install snapshot is kept at {backup} if it exists). All Code Quest files were still removed.',
    windowsUnsupported: 'Code Quest currently supports macOS and Linux only (the status line wrapper needs bash).\nGood news: Microsoft is shipping native bash/coreutils for Windows (https://github.com/microsoft/coreutils),\nso native support should become possible soon. Until then, install inside WSL.',
  },
};

// --- ANSI palette (shared so colors are defined once, not per script) -----------------------
export const ANSI = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[91m', g: '\x1b[92m', y: '\x1b[93m', mag: '\x1b[95m', cy: '\x1b[96m',
};
// event-kind key -> color (the evk field on saved state)
export const EVK_COLOR = { red: ANSI.red, cy: ANSI.cy, g: ANSI.g, mag: ANSI.mag, y: ANSI.y, dim: ANSI.dim };

// --- loader: defaults overlaid with optional user override files ----------------------------
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
function deepMerge(base, over) {
  if (!isObj(over)) return base;
  const out = isObj(base) ? { ...base } : {};
  for (const k of Object.keys(over)) {
    out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}
function loadOverride(name) {
  try { return JSON.parse(readFileSync(join(STATE_DIR, name), 'utf8')); } catch { return null; }
}

// Type-guard a merged overlay (config OR strings) against its defaults: a user override of the
// wrong type (a string where a number belongs, a scalar where an array belongs) silently falls
// back to the default instead of crashing the hook at import time or producing NaN balance math.
// The defaults are the schema — only keys they define are checked; extra user keys pass through.
export function sanitizeConfig(merged, defaults) {
  if (!isObj(defaults)) return merged;
  const out = isObj(merged) ? { ...merged } : {};
  for (const k of Object.keys(defaults)) {
    const dv = defaults[k], mv = out[k];
    if (typeof dv === 'number') { const n = Number(mv); out[k] = Number.isFinite(n) ? n : dv; }
    else if (typeof dv === 'string') out[k] = typeof mv === 'string' ? mv : dv;
    else if (Array.isArray(dv)) out[k] = Array.isArray(mv) ? mv : dv;
    else if (isObj(dv)) out[k] = sanitizeConfig(isObj(mv) ? mv : {}, dv);
  }
  return out;
}

export const CONFIG = sanitizeConfig(deepMerge(DEFAULT_CONFIG, loadOverride('config.json') || {}), DEFAULT_CONFIG);
// strings get the same guard: a wrong-typed override (e.g. report.smells set to a scalar) falls
// back to the default instead of crashing /cq or the hook.
export const STR = sanitizeConfig(deepMerge(DEFAULT_STRINGS, loadOverride('strings.json') || {}), DEFAULT_STRINGS);

// {name} template expansion. Missing vars are left as-is so a typo is visible, never crashes.
export function fmt(tpl, vars = {}) {
  return String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Strip terminal control characters (C0 except tab/newline, DEL, C1) from UNTRUSTED text before
// echoing it: a hostile repo can smuggle ANSI/OSC escapes into a file name, a code line or a
// commit subject, and a report printing them raw would let the repo drive the user's terminal
// (title spoofing, clear-screen, OSC 52 clipboard writes). Our own coloring is added AFTER this.
export function stripCtl(s) {
  return String(s ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

// the one true maxHP formula (was duplicated across hook / status / report / cli)
export function maxlpFor(hero) {
  const lv = Math.max(1, Math.min(CONFIG.hero.maxLevel, hero.lv | 0));
  return CONFIG.hero.lpBase + (lv - 1) * CONFIG.hero.lpPerLevel + (hero.hpbonus || 0);
}

// render a series of values (0..max) as a sparkline of block glyphs — the boss/your HP bars
export function sparkline(vals, max) {
  const b = CONFIG.boss.sparkBlocks, m = max > 0 ? max : 1, hi = b.length - 1;
  return (vals || []).map(v => b[Math.max(0, Math.min(hi, Math.round((v / m) * hi)))]).join('');
}
