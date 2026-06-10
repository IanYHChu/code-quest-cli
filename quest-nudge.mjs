#!/usr/bin/env node
// Code Quest - Commit Nudges. Re-scans YOUR own recent commits (local git only, zero tokens)
// with the game's ruleset and turns each hit into a gentle, line-attributed pointer for writing
// better code. Deliberately humble: regex heuristics, false positives possible, and the report
// says so - with pointers to professional tools for anything serious. `--sarif` exports
// SARIF 2.1.0 for GitHub code scanning / VS Code SARIF viewers.
// Usage: node quest-nudge.mjs [count | commit-id | A..B] [--all] [--sarif]
import { execFileSync } from 'node:child_process';
import { CONFIG, STR, ANSI, fmt, stripCtl } from './quest-data.mjs';
import { scanDetail } from './quest-rules.mjs';

const N = STR.nudge, R = STR.report, C = CONFIG.nudge;
const { bold: B, dim: D, g: G, y: Y, red: RED, cy: CY, reset: Z } = ANSI;
const clamp = (lo, hi, n) => Math.max(lo, Math.min(hi, n));
const say = (s = '') => process.stdout.write(s + '\n');   // report output (a CLI prints; not debug)
const MB = 1 << 20;

const argv = process.argv.slice(2);
const sarifMode = argv.includes('--sarif');
const allAuthors = argv.includes('--all');
const nArg = argv.find(a => /^\d+$/.test(a));
// anything that isn't a flag or a bare count is a git revision: a commit id, HEAD~3, a branch, or
// a range A..B / A...B. Git history is the database, so ANY past commit is scannable — including
// ones made before Code Quest was installed. Validated against a conservative charset (and never
// starting with '-') so an argument can't smuggle an option into git.
const revArg = argv.find(a => !a.startsWith('-') && !/^\d+$/.test(a));
const REV_PART = '[A-Za-z0-9_./~^@{}][A-Za-z0-9_./~^@{}-]*';
const REV_OK = new RegExp(`^${REV_PART}(\\.\\.\\.?${REV_PART})?$`);
const isRange = !!revArg && revArg.includes('..');
const nCommits = clamp(1, C.maxCommits, nArg ? parseInt(nArg, 10) : (isRange ? C.maxCommits : C.commits));

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8', timeout: 8_000, maxBuffer: C.maxDiffMB * MB,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

// --unified=0 diff -> Map(newFilePath -> [{ n, text }]) of ADDED lines with new-file line numbers.
// With zero context lines, only `+++` headers and `@@ -a,b +c,d @@` hunk starts move the counter.
function parseAddedLines(diff) {
  const files = new Map();
  let cur = null, n = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      cur = p === '/dev/null' ? null : (p.startsWith('b/') ? p.slice(2) : p);
      continue;
    }
    if (line.startsWith('@@')) { const m = /\+(\d+)/.exec(line); n = m ? parseInt(m[1], 10) : 0; continue; }
    if (cur && line[0] === '+' && !line.startsWith('+++')) {
      let arr = files.get(cur);
      if (!arr) { arr = []; files.set(cur, arr); }
      if (arr.length < C.maxLinesPerFile) arr.push({ n, text: line.slice(1) });
      n++;
    }
  }
  return files;
}

// attach the player-facing name + fix tip from the same string tables /cq uses. file + snippet
// come straight from repo content (an untrusted clone): strip terminal escapes here, so every
// consumer downstream (the pretty report AND the SARIF export) only ever sees clean text.
const smellOf = (key) => (R.smells || []).find(s => s.key === key) || {};
function enrich(f, file, commit) {
  let name = '', tip = '';
  if (f.kind === 'security') { name = R.cweNames[f.cwe] || f.cwe; tip = smellOf(f.cat).tip || ''; }
  else if (f.kind === 'quality') { name = R.ruleNames[f.ruleId] || f.ruleId; }
  else if (f.kind === 'inj') { name = smellOf('inj').label || 'prompt injection'; tip = smellOf('inj').tip || ''; }
  else { name = smellOf(f.ruleId).label || f.ruleId; tip = smellOf(f.ruleId).tip || ''; }
  return { ...f, file: stripCtl(file), snippet: stripCtl(f.snippet), commit, name, tip };
}
const sevInfo = (sev) => sev >= 7 ? { label: N.sev.high, col: RED, bucket: 'high' }
  : sev >= 4 ? { label: N.sev.med, col: Y, bucket: 'med' }
  : sev >= 1 ? { label: N.sev.low, col: Y, bucket: 'low' }
  : { label: N.sev.note, col: D, bucket: 'note' };

// --- gather ----------------------------------------------------------------------------------
let inRepo = false;
try { inRepo = git('rev-parse', '--is-inside-work-tree').trim() === 'true'; } catch {}
if (!inRepo) { say(N.notRepo); process.exit(0); }

let email = '';
try { email = git('config', 'user.email').trim(); } catch {}
const who = revArg ? revArg : (allAuthors || !email) ? N.anyAuthor : email;

if (revArg && !REV_OK.test(revArg)) { say(fmt(N.badRev, { rev: revArg })); process.exit(0); }
const logArgs = ['log', '--pretty=%H%x09%ct%x09%s'];
if (revArg) {
  // an explicitly named commit/range is scanned as asked: no author filter, and a single named
  // commit isn't dropped for being a merge
  if (isRange) logArgs.push('--no-merges', '-n', String(nCommits));
  else logArgs.push('-n', '1');
  logArgs.push(revArg, '--');                 // '--' ends revisions: a rev that also names a file reads as the rev
} else {
  logArgs.push('--no-merges', '-n', String(nCommits));
  if (!allAuthors && email) logArgs.push('--author=' + email);
}
let log = '', gitErr = false;
try { log = git(...logArgs); } catch { gitErr = true; }
if (gitErr) { say(fmt(N.badRev, { rev: revArg || 'HEAD' })); process.exit(0); }
const commits = log.trim().split('\n').filter(Boolean).map(l => {
  const [sha, ct, ...subj] = l.split('\t');
  return {
    sha, short: sha.slice(0, 7),
    date: new Date((parseInt(ct, 10) || 0) * 1_000).toISOString().slice(0, 10),
    subject: stripCtl(subj.join('\t')),                  // a commit subject is repo content too
  };
});
if (!commits.length) { say(fmt(N.noCommits, { who })); process.exit(0); }

for (const c of commits) {
  c.findings = [];
  let diff = '';
  try { diff = git('show', '--unified=0', '--format=', '--no-color', c.sha, '--'); } catch { continue; }
  for (const [file, lines] of parseAddedLines(diff)) {
    for (const f of scanDetail(lines, file)) c.findings.push(enrich(f, file, c));
  }
  c.findings.sort((a, b) => b.sev - a.sev || a.file.localeCompare(b.file) || a.line - b.line);
}
const all = commits.flatMap(c => c.findings);

// --- SARIF export ----------------------------------------------------------------------------
// One run, one result per nudge. ruleId is the canonical id (CWE-xxx / linter rule); the game's
// internal smell keys get a cq: prefix so they can't collide with real rule namespaces.
if (sarifMode) {
  const ruleIdOf = (f) => f.cwe ? f.cwe : (f.kind === 'quality' ? f.ruleId : 'cq:' + f.ruleId);
  const rules = new Map();
  const results = all.map(f => {
    const id = ruleIdOf(f);
    if (!rules.has(id)) {
      rules.set(id, {
        id,
        shortDescription: { text: f.name || id },
        ...(f.cwe ? { helpUri: 'https://cwe.mitre.org/data/definitions/' + f.cwe.slice(4) + '.html' } : {}),
      });
    }
    return {
      ruleId: id,
      level: f.sev >= 7 ? 'error' : f.sev >= 4 ? 'warning' : 'note',
      message: { text: (f.name || id) + (f.tip ? ' - ' + f.tip : '') + ' (commit ' + f.commit.short + ')' },
      locations: [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: f.line } } }],
      partialFingerprints: { commitSha: f.commit.sha },
    };
  });
  const driver = {
    name: 'code-quest-nudge',
    informationUri: 'https://github.com/IanYHChu/code-quest-cli',
    // honesty travels with the data, not just the pretty report
    fullDescription: { text: 'Lightweight regex-heuristic commit scan from the Code Quest toy. '
      + 'Educational nudges, not verified findings: false positives are expected and no data-flow '
      + 'analysis is performed.' },
    rules: [...rules.values()],
  };
  say(JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{ tool: { driver }, results }],
  }, null, 2));
  process.exit(0);
}

// --- the report ------------------------------------------------------------------------------
const RULE_LINE = `${B}============================================================${Z}`;
say(`\n${RULE_LINE}`);
say(`${B}  ${N.title}${Z}   ${D}${N.subtitle}${Z}`);
say(`${RULE_LINE}\n`);
for (const line of N.disclaimer) say(`  ${D}${line}${Z}`);
const reviewLine = revArg
  ? fmt(N.reviewingRev, { n: `${B}${commits.length}${Z}`, rev: `${B}${revArg}${Z}` })
  : fmt(N.reviewing, { n: `${B}${commits.length}${Z}`, who: `${B}${who}${Z}` });
say(`\n${reviewLine}  ${D}${N.usageHint}${Z}`);
say(`${D}${N.legacyNote}${Z}`);

for (const c of commits) {
  say(`\n${CY}${B}◆ ${c.short}${Z}  ${c.subject}  ${D}(${c.date})${Z}`);
  if (!c.findings.length) { say(`   ${G}${N.commitClean}${Z}`); continue; }
  for (const f of c.findings.slice(0, C.maxPerCommit)) {
    const s = sevInfo(f.sev);
    const rule = f.kind === 'security' ? f.cwe : f.ruleId;
    say(`   ${f.file}:${f.line}  ${s.col}[${s.label}]${Z} ${B}${rule}${Z}  ${f.name}`);
    if (f.snippet) say(`       ${D}| ${f.snippet}${Z}`);
    if (f.tip) say(`       ${D}-> ${f.tip}${Z}`);
  }
  if (c.findings.length > C.maxPerCommit) {
    say(`   ${D}${fmt(N.truncated, { n: c.findings.length - C.maxPerCommit })}${Z}`);
  }
}

say(`\n${B}${N.summaryTitle}${Z}`);
if (!all.length) say(`  ${G}${N.summaryClean}${Z}`);
else {
  const byBucket = { high: 0, med: 0, low: 0, note: 0 };
  const byRule = new Map();
  for (const f of all) {
    byBucket[sevInfo(f.sev).bucket]++;
    const rule = f.kind === 'security' ? f.cwe : f.ruleId;
    byRule.set(rule, (byRule.get(rule) || 0) + 1);
  }
  const tallies = {
    recs: `${B}${all.length}${Z}`, commits: commits.length,
    high: byBucket.high, med: byBucket.med, low: byBucket.low, note: byBucket.note,
  };
  say(`  ${fmt(N.summaryLine, tallies)}`);
  const top = [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([r, n]) => `${r} x${n}`).join(', ');
  say(`  ${D}${fmt(N.topRules, { list: top })}${Z}`);
}

say(`\n${B}${N.proTitle}${Z}`);
for (const t of N.proTools) {
  say(`  ${B}${t.name.padEnd(12)}${Z}${D}${(t.url || '').padEnd(42)}${Z}${t.note}`);
}
say(`\n${D}${N.sarifHint}${Z}\n`);
