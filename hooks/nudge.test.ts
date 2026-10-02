import { expect, test } from 'claude-code/testing'

import { nudge, parseAddedLines, parseArgs } from './nudge'
import type { Git } from './nudge'

const SHA = 'a'.repeat(40)
const DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -0,0 +10,3 @@',
  '+const key = "AKIAABCDEFGHIJKLMNOP"',
  '+console.log(key)',
  '+export const ok = 1',
].join('\n')

// a git that answers the commands the nudge report runs, and records them
function fakeGit(over: Partial<Record<string, { exitCode: number; stdout: string }>> = {}): { git: Git; calls: string[][] } {
  const calls: string[][] = []
  const git: Git = async args => {
    calls.push(args)
    const verb = args[0] ?? ''
    const answer = over[verb] ?? ({
      'rev-parse': { exitCode: 0, stdout: 'true\n' },
      config: { exitCode: 0, stdout: 'me@example.com\n' },
      log: { exitCode: 0, stdout: `${SHA}\t1700000000\tAdd the \x1b[31mapp\n` },
      show: { exitCode: 0, stdout: DIFF },
    } as Record<string, { exitCode: number; stdout: string }>)[verb]
    return answer ?? { exitCode: 1, stdout: '' }
  }
  return { git, calls }
}

test('arguments: a count, a revision, flags; the count is clamped', () => {
  expect(parseArgs('')).toMatchObject({ rev: null, count: 5, all: false, sarif: false })
  expect(parseArgs('3 --all')).toMatchObject({ rev: null, count: 3, all: true })
  expect(parseArgs('main..HEAD --sarif')).toMatchObject({ rev: 'main..HEAD', count: 50, sarif: true })
  expect(parseArgs('999').count).toBe(50)
})

test('a zero-context diff reads back as added lines with new-file numbers', () => {
  expect(parseAddedLines(DIFF).get('src/app.ts')?.map(l => l.n)).toEqual([10, 11, 12])
})

test('the report names file:line, the rule and a tip, and strips control characters', async () => {
  const { git, calls } = fakeGit()
  const text = await nudge(git, '')
  expect(text).toContain('src/app.ts:10')
  expect(text).toContain('src/app.ts:11')
  // the escape is gone, so what is left of the color code is inert text
  expect(text).toContain('Add the [31mapp')
  expect(text).not.toContain('\x1b')
  // your own commits only, by default
  expect(calls.find(c => c[0] === 'log')).toContain('--author=me@example.com')
})

test('outside a repo, or with a bad revision, it says so and runs nothing more', async () => {
  expect(await nudge(fakeGit({ 'rev-parse': { exitCode: 128, stdout: '' } }).git, '')).toMatch(/Not a git repository/)
  const { git, calls } = fakeGit()
  expect(await nudge(git, '--upload-pack=x')).toMatch(/usage|Looking/) // a flag is never read as a revision
  expect(await nudge(git, 'a;b')).toMatch(/Could not read "a;b"/)
  expect(calls.filter(c => c[0] === 'log' && c.includes('a;b'))).toEqual([])
})

test('--sarif emits SARIF 2.1.0 with one result per nudge', async () => {
  const out = JSON.parse(await nudge(fakeGit().git, '--sarif'))
  expect(out.version).toBe('2.1.0')
  expect(out.runs[0].results.length).toBeGreaterThan(0)
  expect(out.runs[0].results[0].partialFingerprints.commitSha).toBe(SHA)
})
