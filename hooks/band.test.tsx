import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'code-quest',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 76, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

test('the band: three slots, the event, the hero numbers', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    for (const k of ['slot0', 'slot1', 'slot2', 'pick0', 'pick1', 'pick2', 'event', 'hero']) expect(await ui.find({ key: k })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'LP  020/020' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'ATK 003  DEF 001' })).toBeDefined()
    await ui.unmount()
  }
})

test('pressing a slot opens its menu in the middle; pressing it again closes it', async $ => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'pick1' })
  expect(await ui.find({ type: 'Text', text: 'no armor yet  (press 2 to close)' })).toBeDefined()
  expect(await ui.find({ key: 'up' })).toBeUndefined()
  await ui.press({ key: 'pick1' })
  expect(await ui.find({ type: 'Text', text: /no armor yet/ })).toBeUndefined()
  await ui.unmount()
})

test('a bug from failing tests starts a fight in the middle zone', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: '1 failed' }, text: '1 failed' }) as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^a bug from the failing tests .*from the entrance/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\d{3} \[[#.]{8}\] @ {14}m \[[#.]{8}\] \d{3}$/ })).toBeDefined()
  await ui.unmount()
})

test("a Read's file content becomes the breeding ground", async ($, on) => {
  on('tool.call', () => ({ result: { type: 'text', file: { filePath: '/repo/x.ts', content: 'try { a() } catch {}\n// TODO x\n', numLines: 2, startLine: 1, totalLines: 2 } }, text: '' }) as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/x.ts' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Claude reads x\.ts: the air turns foul/ })).toBeDefined()
  await ui.unmount()
})

test('band yields to a survey', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine survey</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ type: 'Text', text: 'engine survey' })).toBeDefined()
  await ui.unmount()
})
