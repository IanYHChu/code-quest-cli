#!/usr/bin/env node
// Code Quest - dungeon report. Pure code, zero tokens: reads the smell log the hook wrote
// and explains WHY the dungeon got dangerous, with a fix tip per smell.
// All labels/tips/titles come from quest-data.mjs.  Run:  node quest-report.mjs
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { CONFIG, STR, ANSI, fmt, maxlpFor, stripCtl, STATE_DIR, hashStr } from './quest-data.mjs';

// findings are per-project — report on the repo this command was run in (its cwd), not a global mix
const FINDINGS = join(STATE_DIR, 'projects', hashStr(process.cwd()) + '.findings.jsonl');
const { bold: B, dim: DIM, g: G, y: Y, red: RED, cy: CY, reset: Z } = ANSI;
const R = STR.report;
const say = (s = '') => process.stdout.write(s + '\n');   // report output (a CLI prints; not debug)
const RULE = `${B}============================================================${Z}`;

let recs = [];
// parse per line, skipping any corrupt one — a single bad line must not blank the whole report
try {
  recs = readFileSync(FINDINGS, 'utf8').trim().split('\n').filter(Boolean)
    .flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
} catch {}

function printCharacter() {
  try {
    const w = JSON.parse(readFileSync(join(STATE_DIR, 'hero.json'), 'utf8'));
    const h = { lv: 1, atk: 1, def: 0, hpbonus: 0, buff: 1, relics: [], revives: 0, penitent: false, ...(w.d || w) };
    const maxlp = maxlpFor(h);
    const tally = (h.relics || []).reduce((m, r) => (m[r] = (m[r] || 0) + 1, m), {});
    const relics = Object.entries(tally).map(([k, v]) => `${k}x${v}`).join(' ') || R.relicsNone;
    say(`${B}${R.characterLabel}${Z}  Lv${h.lv}  ATK ${h.atk}  DEF ${h.def}  maxHP ${maxlp}  buff x${h.buff}  `
      + `${DIM}${R.relicsLabel}: ${relics}  ${R.revivesLabel}: ${h.revives || 0}${Z}`);
    const T = CONFIG.tamper;
    const penitentLine = fmt(R.lineagePenitent,
      { drain: T.penitentDrain, pct: Math.round((T.penitentStatMult - 1) * 100) });
    say(h.penitent ? `  ${RED}${penitentLine}${Z}` : `  ${DIM}${R.lineageVerified}${Z}`);
    printLastBattle(h.lastBattle);
  } catch {}
}

// the full blow-by-blow of your most recent git-commit boss fight — the status line only had room
// to show a one-line summary; the detail lives here.
function printLastBattle(lb) {
  if (!lb || !Array.isArray(lb.rounds) || !lb.rounds.length) return;
  say(`\n${B}${R.lastBattleTitle}${Z} ${DIM}${R.lastBattleNote}${Z}`);
  say(`  boss HP ${B}${lb.bHp0}${Z}   your HP ${B}${lb.maxlp}${Z}`);
  lb.rounds.forEach((r, i) =>
    say(`  R${i + 1}  boss ${RED}${String(r.b).padStart(3)}${Z}  you ${Y}${String(r.p).padStart(3)}${Z}`));
  const res = lb.outcome === 'win' ? `${G}boss slain +${lb.lvUp}Lv${lb.relic ? '  ' + lb.relic : ''}${Z}`
    : lb.outcome === 'revive' ? `${CY}survived — revive relic used${Z}`
    : `${RED}defeated${Z}`;
  say(`  ${DIM}->${Z} ${res}`);
}

if (!recs.length) {
  say(`\n${B}${R.title}${Z}\n`);
  printCharacter();
  say(`\n${R.noSmells}\n`);
  process.exit(0);
}

// Merge per file: keep the worst (max) counts/hazards seen for each file across re-reads.
// Array-valued counts (cwes) are unioned, not maxed — they're a set of weaknesses, not a tally.
const byFile = new Map();
for (const r of recs) {
  const cur = byFile.get(r.file) || { counts: {}, hazards: {} };
  for (const k in (r.counts || {})) {
    const v = r.counts[k];
    if (Array.isArray(v)) cur.counts[k] = [...new Set([...(cur.counts[k] || []), ...v])];
    else cur.counts[k] = Math.max(cur.counts[k] || 0, v);
  }
  for (const k in (r.hazards || {})) cur.hazards[k] = Math.max(cur.hazards[k] || 0, r.hazards[k]);
  byFile.set(r.file, cur);
}
const files = [...byFile.entries()];

const SMELLS = R.smells;

// file names come from scanned repos (possibly untrusted clones): strip terminal escapes a
// hostile file name could smuggle into the report before printing it.
const base = (p) => stripCtl(basename(p));

const total = (key) => files.reduce((n, [, v]) => n + (v.counts[key] || 0), 0);
const where = (key) => files.filter(([, v]) => v.counts[key] > 0)
  .sort((a, b) => b[1].counts[key] - a[1].counts[key])
  .slice(0, 4).map(([f]) => base(f)).join(', ');

function section(title, color, buckets) {
  const rows = SMELLS.filter(s => buckets.includes(s.bucket) && total(s.key) > 0);
  if (!rows.length) return;
  say(`\n${color}${B}${title}${Z}`);
  for (const s of rows) {
    say(`  ${s.label.padEnd(56)} ${B}${String(total(s.key)).padStart(3)}${Z}  ${DIM}in: ${where(s.key)}${Z}`);
    say(`    ${DIM}-> ${s.tip}${Z}`);
  }
}

// deep nesting is a max, not a sum
const deepest = files.filter(([, v]) => (v.counts.depth || 0) >= 6)
  .sort((a, b) => b[1].counts.depth - a[1].counts.depth);

say(`\n${RULE}`);
say(`${B}  ${R.title}${Z}   ${DIM}${R.subtitle}${Z}`);
say(RULE);

printCharacter();
say(`${fmt(R.scanned, { n: `${B}${files.length}${Z}` })}  ${DIM}(${FINDINGS})${Z}`);

section(R.sections.inj, RED, ['inj']);
section(R.sections.leak, RED, ['leak']);
section(R.sections.sin, RED, ['sin']);

// CWE WEAKNESSES: every security regex carries a MITRE CWE id; list which weaknesses appeared and where.
const cweFiles = new Map();                            // cwe -> set of basenames
for (const [f, v] of files) for (const c of (v.counts.cwes || [])) {
  if (!cweFiles.has(c)) cweFiles.set(c, new Set());
  cweFiles.get(c).add(base(f));
}
if (cweFiles.size) {
  say(`\n${RED}${B}${R.sections.cwe}${Z}`);
  const cweNum = (c) => parseInt(String(c).slice(4), 10) || 0;       // "CWE-89" -> 89: sort numerically, not lexically
  const rows = [...cweFiles.entries()].sort((a, b) => b[1].size - a[1].size || cweNum(a[0]) - cweNum(b[0]));
  for (const [cwe, fileset] of rows) {
    const label = `${cwe}  ${R.cweNames[cwe] || ''}`.trimEnd();
    const inFiles = [...fileset].slice(0, 4).join(', ');
    say(`  ${label.padEnd(56)} ${B}${String(fileset.size).padStart(3)}${Z}  ${DIM}in: ${inFiles}${Z}`);
  }
}

// CODE SMELLS: Tier-A quality rules, each tagged with an ESLint/SonarQube id (the quality analogue
// of the CWE section). Listed by affected-file count, then rule id.
const ruleFiles = new Map();                           // rule id -> set of basenames
for (const [f, v] of files) for (const r of (v.counts.rules || [])) {
  if (!ruleFiles.has(r)) ruleFiles.set(r, new Set());
  ruleFiles.get(r).add(base(f));
}
if (ruleFiles.size) {
  say(`\n${Y}${B}${R.sections.codeSmells}${Z}`);
  const rows = [...ruleFiles.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  for (const [rule, fileset] of rows) {
    const label = `${rule}  ${R.ruleNames[rule] || ''}`.trimEnd();
    const inFiles = [...fileset].slice(0, 4).join(', ');
    say(`  ${label.padEnd(56)} ${B}${String(fileset.size).padStart(3)}${Z}  ${DIM}in: ${inFiles}${Z}`);
  }
}

section(R.sections.ambush, Y, ['ambush']);
section(R.sections.trap, Y, ['trap']);

if (deepest.length) {
  say(`\n${Y}${B}${R.sections.nesting}${Z}`);
  for (const [f, v] of deepest.slice(0, 4)) say(`  ${base(f).padEnd(56)} ${B}depth ${v.counts.depth}${Z}`);
  say(`    ${DIM}-> ${R.nestingTip}${Z}`);
}

// top offenders by a rough danger score
const score = (h) => (h.power || 0) * 4 + (h.dollars || 0) * 6 + (h.traps || 0) * 2 + (h.ambushBias || 0) / 4;
const top = files.map(([f, v]) => ({ f, h: v.hazards })).sort((a, b) => score(b.h) - score(a.h)).slice(0, 5);
say(`\n${B}${R.sections.topOffenders}${Z}  ${DIM}${R.sections.topOffendersNote}${Z}`);
top.forEach((o, i) => {
  const h = o.h;
  const line = fmt(R.offenderLine,
    { power: h.power || 1, dollars: h.dollars || 0, traps: h.traps || 0, ambush: h.ambushBias || 0 });
  say(`  ${i + 1}. ${base(o.f).padEnd(40)} ${DIM}${line}${Z}`);
});

say(`\n${DIM}${R.footer}${Z}\n`);
