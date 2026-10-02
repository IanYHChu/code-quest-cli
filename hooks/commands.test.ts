import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Game } from '../types'
import { FRESH } from './game'

const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const BAND = {
  plugin: 'code-quest', component: 'AbovePrompt', surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 76, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

// the engine beneath a session start: a clock, the command table, and a store that records
// what the plugin keeps
function boot(on: On, saved?: unknown): { store: Map<string, unknown> } {
  const store = new Map<string, unknown>(saved === undefined ? [] : [['game', saved]])
  mock.clock(on)
  on('command.register', () => ({}) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => { store.set(e.key, e.value); return {} as never })
  return { store }
}

// the run the band shows: "run 7, no elements" on the hero's third row
async function runShown($: Engine): Promise<number> {
  const ui = await $.ui.mount(BAND)
  const row = await ui.find({ type: 'Text', text: /^run \d+, no elements$/ })
  await ui.unmount()
  return Number(/\d+/.exec(row?.text ?? '')?.[0] ?? NaN)
}

test('a new session picks up the saved run', async ($, on) => {
  const saved: Game = { ...FRESH, run: 7, steps: 40 }
  boot(on, saved)
  await $.session.start(START)
  expect(await runShown($)).toBe(7)
})

test("a save from another build's shape starts fresh", async ($, on) => {
  boot(on, { version: 1, run: 9 })
  await $.session.start(START)
  expect(await runShown($)).toBe(1)
})

test('each tool call is saved for the next session', async ($, on) => {
  const { store } = boot(on)
  on('tool.call', () => ({ result: { stdout: '' }, text: '' }) as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(store.get('game')).toMatchObject({ steps: 1 })
})

test('/cq-help explains the band, the gear keys and the commands', async $ => {
  const { text } = await $.command.run({ command: 'cq-help', ...RUN })
  for (const s of ['THE BAND', 'q previous, a next, e equip, z drop', '/cq-nudge', '/cq-reroll']) expect(text).toContain(s)
})

test('/cq-reroll asks first; only "Reroll" starts over', async ($, on) => {
  const { store } = boot(on, { ...FRESH, run: 5 })
  let answer = 'Keep playing'
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = (e as unknown as { questions: { question: string }[] }).questions[0]?.question ?? ''
    return { result: { questions: [], answers: { [q]: answer } }, text: '' } as never
  })
  await $.session.start(START)
  expect((await $.command.run({ command: 'cq-reroll', ...RUN })).text).toMatch(/cancelled/)
  expect(await runShown($)).toBe(5)
  answer = 'Reroll'
  expect((await $.command.run({ command: 'cq-reroll', ...RUN })).text).toMatch(/rerolled/)
  expect(await runShown($)).toBe(1)
  expect(store.get('game')).toMatchObject({ run: 1 })
})
