// /cq-nudge: re-scans YOUR own recent commits (local git only, zero tokens) with the game's
// ruleset and turns each hit into a gentle, line-attributed pointer for writing better code.
// Deliberately humble: regex heuristics, false positives possible, and the report says so, with
// pointers to professional tools for anything serious. `--sarif` exports SARIF 2.1.0.
// Pure apart from `git`, which the caller hands in (the mod passes $.process.run).
import { CONFIG, STR, fmt, stripCtl } from '../quest-config.mjs'
import { scanDetail } from '../quest-rules.mjs'
import type { Finding } from '../quest-rules.mjs'

export type Git = (args: string[]) => Promise<{ exitCode: number; stdout: string }>

type Commit = { sha: string; short: string; date: string; subject: string; findings: Nudge[] }
type Nudge = Finding & { file: string; commit: Commit; name: string; tip: string }

const N = STR.nudge
const R = STR.report
const C = CONFIG.nudge
const clamp = (lo: number, hi: number, n: number) => Math.max(lo, Math.min(hi, n))

// anything that isn't a flag or a bare count is a git revision: a commit id, HEAD~3, a branch, or
// a range A..B / A...B. Validated against a conservative charset (and never starting with '-')
// so an argument can't smuggle an option into git.
const REV_PART = '[A-Za-z0-9_./~^@{}][A-Za-z0-9_./~^@{}-]*'
const REV_OK = new RegExp(`^${REV_PART}(\\.\\.\\.?${REV_PART})?$`)

export type NudgeArgs = { rev: string | null; count: number; all: boolean; sarif: boolean }

export function parseArgs(args: string): NudgeArgs {
  const argv = args.split(/\s+/).filter(Boolean)
  const nArg = argv.find(a => /^\d+$/.test(a))
  const rev = argv.find(a => !a.startsWith('-') && !/^\d+$/.test(a)) ?? null
  const isRange = !!rev && rev.includes('..')
  return {
    rev, all: argv.includes('--all'), sarif: argv.includes('--sarif'),
    count: clamp(1, C.maxCommits, nArg ? parseInt(nArg, 10) : isRange ? C.maxCommits : C.commits),
  }
}

// --unified=0 diff -> Map(newFilePath -> [{ n, text }]) of ADDED lines with new-file line numbers.
// With zero context lines, only `+++` headers and `@@ -a,b +c,d @@` hunk starts move the counter.
export function parseAddedLines(diff: string): Map<string, { n: number; text: string }[]> {
  const files = new Map<string, { n: number; text: string }[]>()
  let cur: string | null = null
  let n = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim()
      cur = p === '/dev/null' ? null : p.startsWith('b/') ? p.slice(2) : p
      continue
    }
    if (line.startsWith('@@')) { const m = /\+(\d+)/.exec(line); n = parseInt(m?.[1] ?? '0', 10); continue }
    if (cur && line[0] === '+') {
      let arr = files.get(cur)
      if (!arr) { arr = []; files.set(cur, arr) }
      if (arr.length < C.maxLinesPerFile) arr.push({ n, text: line.slice(1) })
      n++
    }
  }
  return files
}

// the player-facing name and fix tip, from the same string tables the sheet uses. file and
// snippet come straight from repo content (an untrusted clone): control characters are
// stripped here, so the report and the SARIF export only ever see clean text
const smellOf = (key: string) => R.smells.find(s => s.key === key)
function enrich(f: Finding, file: string, commit: Commit): Nudge {
  let name = ''
  let tip = ''
  if (f.kind === 'security') { name = R.cweNames[f.cwe ?? ''] || f.cwe || f.ruleId; tip = smellOf(f.cat ?? '')?.tip ?? '' }
  else if (f.kind === 'quality') name = R.ruleNames[f.ruleId] || f.ruleId
  else if (f.kind === 'inj') { name = smellOf('inj')?.label ?? 'prompt injection'; tip = smellOf('inj')?.tip ?? '' }
  else { name = smellOf(f.ruleId)?.label ?? f.ruleId; tip = smellOf(f.ruleId)?.tip ?? '' }
  return { ...f, file: stripCtl(file), snippet: stripCtl(f.snippet), commit, name, tip }
}

type Bucket = 'high' | 'med' | 'low' | 'note'
const bucketOf = (sev: number): Bucket => sev >= 7 ? 'high' : sev >= 4 ? 'med' : sev >= 1 ? 'low' : 'note'
const ruleOf = (f: Nudge) => f.kind === 'security' ? f.cwe ?? f.ruleId : f.ruleId

// the commits asked for, each with its nudges; or the line to show instead
async function gather(git: Git, a: NudgeArgs): Promise<{ commits: Commit[]; who: string } | string> {
  const inRepo = await git(['rev-parse', '--is-inside-work-tree'])
  if (inRepo.exitCode !== 0 || inRepo.stdout.trim() !== 'true') return N.notRepo
  if (a.rev && !REV_OK.test(a.rev)) return fmt(N.badRev, { rev: a.rev })

  const cfg = await git(['config', 'user.email'])
  const email = cfg.exitCode === 0 ? cfg.stdout.trim() : ''
  const who = a.rev ? a.rev : a.all || !email ? N.anyAuthor : email

  const logArgs = ['log', '--pretty=%H%x09%ct%x09%s']
  if (a.rev) {
    // an explicitly named commit or range is scanned as asked: no author filter, and a single
    // named commit isn't dropped for being a merge
    if (a.rev.includes('..')) logArgs.push('--no-merges', '-n', String(a.count))
    else logArgs.push('-n', '1')
    logArgs.push(a.rev, '--') // '--' ends revisions: a rev that also names a file reads as the rev
  } else {
    logArgs.push('--no-merges', '-n', String(a.count))
    if (!a.all && email) logArgs.push(`--author=${email}`)
  }
  const log = await git(logArgs)
  if (log.exitCode !== 0) return fmt(N.badRev, { rev: a.rev || 'HEAD' })

  const commits: Commit[] = log.stdout.trim().split('\n').filter(Boolean).map(l => {
    const [sha = '', ct = '', ...subj] = l.split('\t')
    return {
      sha, short: sha.slice(0, 7), findings: [],
      date: new Date((parseInt(ct, 10) || 0) * 1000).toISOString().slice(0, 10),
      subject: stripCtl(subj.join('\t')), // a commit subject is repo content too
    }
  })
  if (!commits.length) return fmt(N.noCommits, { who })

  for (const c of commits) {
    const show = await git(['show', '--unified=0', '--format=', '--no-color', c.sha, '--'])
    if (show.exitCode !== 0) continue
    for (const [file, lines] of parseAddedLines(show.stdout)) {
      for (const f of scanDetail(lines, file)) c.findings.push(enrich(f, file, c))
    }
    c.findings.sort((x, y) => y.sev - x.sev || x.file.localeCompare(y.file) || x.line - y.line)
  }
  return { commits, who }
}

// One run, one result per nudge. ruleId is the canonical id (CWE-xxx / linter rule); the game's
// own smell keys get a cq: prefix so they can't collide with real rule namespaces.
function sarif(all: Nudge[]): string {
  const idOf = (f: Nudge) => f.cwe ? f.cwe : f.kind === 'quality' ? f.ruleId : `cq:${f.ruleId}`
  const rules = new Map<string, object>()
  const results = all.map(f => {
    const id = idOf(f)
    if (!rules.has(id)) {
      rules.set(id, {
        id, shortDescription: { text: f.name || id },
        ...(f.cwe ? { helpUri: `https://cwe.mitre.org/data/definitions/${f.cwe.slice(4)}.html` } : {}),
      })
    }
    return {
      ruleId: id,
      level: f.sev >= 7 ? 'error' : f.sev >= 4 ? 'warning' : 'note',
      message: { text: `${f.name || id}${f.tip ? ` - ${f.tip}` : ''} (commit ${f.commit.short})` },
      locations: [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: f.line } } }],
      partialFingerprints: { commitSha: f.commit.sha },
    }
  })
  const driver = {
    name: 'code-quest-nudge',
    informationUri: 'https://github.com/IanYHChu/code-quest-cli',
    // honesty travels with the data, not just the pretty report
    fullDescription: { text: 'Lightweight regex-heuristic commit scan from the Code Quest toy. '
      + 'Educational nudges, not verified findings: false positives are expected and no data-flow '
      + 'analysis is performed.' },
    rules: [...rules.values()],
  }
  return JSON.stringify({ $schema: 'https://json.schemastore.org/sarif-2.1.0.json', version: '2.1.0', runs: [{ tool: { driver }, results }] }, null, 2)
}

function report(commits: Commit[], who: string, a: NudgeArgs): string {
  const out: string[] = []
  const say = (s = '') => out.push(s)
  const all = commits.flatMap(c => c.findings)
  say(N.title)
  say(N.subtitle)
  say()
  for (const line of N.disclaimer) say(`  ${line}`)
  say()
  say(a.rev ? fmt(N.reviewingRev, { n: commits.length, rev: a.rev }) : fmt(N.reviewing, { n: commits.length, who }))
  say(N.usageHint)
  say(N.legacyNote)

  for (const c of commits) {
    say()
    say(`${c.short}  ${c.subject}  (${c.date})`)
    if (!c.findings.length) { say(`   ${N.commitClean}`); continue }
    for (const f of c.findings.slice(0, C.maxPerCommit)) {
      say(`   ${f.file}:${f.line}  [${N.sev[bucketOf(f.sev)]}] ${ruleOf(f)}  ${f.name}`)
      if (f.snippet) say(`       | ${f.snippet}`)
      if (f.tip) say(`       -> ${f.tip}`)
    }
    if (c.findings.length > C.maxPerCommit) say(`   ${fmt(N.truncated, { n: c.findings.length - C.maxPerCommit })}`)
  }

  say()
  say(N.summaryTitle)
  if (!all.length) say(`  ${N.summaryClean}`)
  else {
    const byBucket: Record<Bucket, number> = { high: 0, med: 0, low: 0, note: 0 }
    const byRule = new Map<string, number>()
    for (const f of all) {
      byBucket[bucketOf(f.sev)]++
      byRule.set(ruleOf(f), (byRule.get(ruleOf(f)) ?? 0) + 1)
    }
    say(`  ${fmt(N.summaryLine, { recs: all.length, commits: commits.length, ...byBucket })}`)
    const top = [...byRule.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([r, n]) => `${r} x${n}`).join(', ')
    say(`  ${fmt(N.topRules, { list: top })}`)
  }

  say()
  say(N.proTitle)
  for (const t of N.proTools) say(`  ${t.name.padEnd(12)}${(t.url || '').padEnd(42)}${t.note}`)
  say()
  say(N.sarifHint)
  return out.join('\n')
}

export async function nudge(git: Git, args: string): Promise<string> {
  const a = parseArgs(args)
  const got = await gather(git, a)
  if (typeof got === 'string') return got
  return a.sarif ? sarif(got.commits.flatMap(c => c.findings)) : report(got.commits, got.who, a)
}
