// code-quest:noscan  (this module is the scanner's numbers + the report text)
// Code Quest - the pure data layer the scanner (quest-analyze.mjs, quest-rules.mjs) and the
// /cq-nudge report read: their tunable numbers (CONFIG), the smell, CWE and rule names with
// their fix tips, and the nudge report's text (STR). No Node APIs: it loads inside the mod.
// The game's own numbers live in hooks/game.ts and its content in data/.
// --- tunable scanner knobs ------------------------------------------------------------------
export const CONFIG = {
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
  // /cq-nudge — the commit-nudge report (hooks/nudge.ts): how many of YOUR recent commits to
  // re-scan, and output caps so a giant diff can't flood the terminal or stall the command.
  nudge: {
    commits: 5,                  // default number of recent commits to review (/cq-nudge N overrides)
    maxCommits: 50,              // hard ceiling on N
    maxPerCommit: 40,            // findings shown per commit before truncating
    maxLinesPerFile: 4000,       // added lines scanned per file per commit (latency guard)
    snippetLen: 100,             // max chars of the offending line echoed in the report
  },
  // files whose BASENAME matches one of these globs are never scanned for smells — robust even on a
  // partial (offset) read, unlike the in-content `code-quest:noscan` sentinel (which still works too).
  // The default exempts ONLY the rule catalog and its text (these two files are made of trigger
  // literals — the scanner-scans-scanner trap); the rest of Code Quest is scanned like any other
  // code. Avoid generic names here: a bare basename matches in EVERY repo.
  scan: { noscanFiles: ['quest-rules.mjs', 'quest-config.mjs'] },
};

// --- all player-facing text (templates use {name} placeholders, expanded by fmt()) ----------
export const STR = {
  report: {
    // MITRE CWE id -> short name. Each security regex carries a cwe.
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
    // ESLint / SonarQube rule id -> short name. Each Tier-A quality
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
};

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
