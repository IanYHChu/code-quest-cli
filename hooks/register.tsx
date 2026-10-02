// Code Quest mod prototype: a gear-driven auto-battler that Claude's work pushes forward.
//
// The band above the prompt, three rows, three zones:
//   left    three gear slots: 1 weapon, 2 armor, 3 skill. A slot lights yellow when the bag holds
//           something stronger for it. Pressing a slot opens its menu in the middle zone (press
//           it again to close).
//   middle  the fight, blow by blow, or the latest event; or the open menu, one item at a time:
//           q previous, a next, e equip, z drop. Letters, not arrows: the prompt keeps the arrows.
//           After a death the menu opens by itself (e keeps the item for the next run).
//   right   LP, ATK and DEF, and the element of each slot (/weapon ]armor *skill).
// Item names are colored by rarity, Diablo II style: normal plain, magic blue, rare yellow.
// Claude's tool calls are the steps: a Read sets the code the next foes are bred from, every
// second call a foe steps out, failing tests send a bug, a commit raises a boss. Fights resolve
// on their own. The rules live in game.ts; this file wires them to Claude Code.
// /cq-boss and /cq-bug raise foes by hand; /cq-pane opens the full sheet.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Element, Game, Rarity, Slot } from '../types'
import { MONSTERS } from '../data/monsters'
import { SLOTS, advance, choose, conclude, density, describe, discard, entries, fix, hasUpgrade, openMenu, perks, point, stats, wardList } from './game'
import type { Weather } from './game'
import { compare } from './loot'

const PANE = 'cq-pane'
const game = atom({ plugin: 'code-quest', key: 'game' } as const, fix(null))
const FRAME_MS = 260
const HOLD_FRAMES = 8
const STATUS_COLUMNS = 22
const GLYPH: Record<Slot, string> = { weapon: '/', armor: ']', skill: '*' }
const RE_COMMIT = /(^|[&|;]\s*)git\s+(\S+\s+){0,5}commit\b/
const RE_TEST = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(jest|vitest|pytest|cargo\s+test|go\s+test|node\s+--test)\b/
const RE_FAILED = /\bfail(s|ed|ing|ures?)?\b|\bnot ok\b/i

const edit = (fn: (g: Game) => Game) => (raw: Game) => fn(fix(raw))

const RARITY_COLOR: Record<Rarity, string | undefined> = { normal: undefined, magic: 'blue', rare: 'yellow' }
const ELEMENT_COLOR: Record<Element, string> = { fire: 'red', ice: 'cyan', arcane: 'magenta' }

// what a finished tool call means to the dungeon
function weatherOf(e: { tool: string } & Record<string, unknown>, ran: { result?: unknown; text?: string; isError?: true }): Weather {
  if (e.tool === 'Read') {
    const r = ran.result as { type?: string; file?: { filePath?: string; content?: string } } | undefined
    if (r?.type === 'text' && typeof r.file?.content === 'string') {
      const lines = (r.file as { totalLines?: number }).totalLines
      return { kind: 'read', file: String(r.file.filePath ?? e.file_path ?? ''), content: r.file.content, totalLines: lines }
    }
  }
  if (e.tool === 'Bash') {
    const cmd = String(e.command ?? '')
    if (RE_COMMIT.test(cmd) && !ran.isError) return { kind: 'commit' }
    if (RE_TEST.test(cmd)) return { kind: 'tests', passed: !(ran.isError === true || RE_FAILED.test(`${ran.text ?? ''}`)) }
  }
  return { kind: 'step' }
}

export const register: Register = on => {
  let player: { cancel(): void } | undefined

  on('session.start', async ($, e, next) => {
    // the fight player: one frame per beat, and nothing written while no fight plays
    player?.cancel()
    player = $.clock.every(FRAME_MS, () => {
      void (async () => {
        const g = fix(await read($, game))
        if (!g.fight) return
        await update($, game, edit(s => {
          if (!s.fight) return s
          return s.fight.at + 1 >= s.fight.frames.length + HOLD_FRAMES ? conclude(s) : { ...s, fight: { ...s.fight, at: s.fight.at + 1 } }
        }))
      })()
    })
    await $.command.register({ name: 'cq-pane', description: 'Code Quest prototype: open the full character sheet' })
    await $.command.register({ name: 'cq-bug', description: 'Code Quest prototype: a bug attacks (as if tests failed)' })
    await $.command.register({ name: 'cq-boss', description: 'Code Quest prototype: a boss rises (as if you committed)' })
    return next(e)
  })

  on('command.run', { command: 'cq-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Code Quest', closeOnEscape: true, columns: 48 })
    return { text: 'Code Quest sheet opened (Esc closes it).' }
  })
  on('command.run', { command: 'cq-bug' }, async $ => {
    await update($, game, edit(g => advance(g, { kind: 'tests', passed: false })))
    return { text: 'A bug attacks in the band.' }
  })
  on('command.run', { command: 'cq-boss' }, async $ => {
    await update($, game, edit(g => advance(g, { kind: 'commit' })))
    return { text: 'A boss rises in the band.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined) {
      const w = weatherOf(e as unknown as { tool: string } & Record<string, unknown>, ran)
      await update($, game, edit(g => advance(g, w)))
    }
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const g = fix(await read($, game))
    const me = stats(g.gear)

    // left: the three slots; a press opens (or closes) that slot's menu. While a keepsake is being
    // picked, the slot the highlighted item would fill lights up and shows its glyph
    const keepSlot = g.menu?.kind === 'keep' ? entries(g)[Math.min(g.menu.cursor, entries(g).length - 1)]?.slot ?? null : null
    const slots = (
      <Box key="slots" flexDirection="row" columnGap={1}>
        {SLOTS.map((slot, i) => {
          const item = g.gear[slot]
          const isOpen = g.menu?.kind === 'gear' && g.menu.slot === slot
          const isKeepSlot = keepSlot === slot
          const color = isOpen || isKeepSlot ? 'cyan' : hasUpgrade(g, slot) ? 'yellow' : undefined
          const press = () => update($, game, edit(s => openMenu(s, slot)))
          return (
            <Box key={`slot${i}`} borderStyle="round" borderColor={color} borderDimColor={!color && !item}>
              <Button key={`pick${i}`} label={item || isKeepSlot ? GLYPH[slot] : '-'} hotkey={String(i + 1)} plain dimColor={!item && !color} onPress={press} />
            </Box>
          )
        })}
      </Box>
    )

    // middle: the menu if one is open, else the fight frame, else the event
    const f = g.fight
    const frame = f ? f.frames[Math.min(f.at, f.frames.length - 1)] : undefined
    let middle
    if (g.menu) {
      // one item at a time: its name and place in the list, its numbers against what you wear, the keys
      const list = entries(g)
      const cursor = Math.min(g.menu.cursor, Math.max(0, list.length - 1))
      const pick = list[cursor]
      const isKeep = g.menu.kind === 'keep'
      const slot = g.menu.kind === 'gear' ? g.menu.slot : pick?.slot ?? 'weapon'
      const worn = isKeep ? null : g.gear[slot]
      const isWorn = !!pick && pick.id === worn?.id
      // its mods, each against what the slot wears now: "ATK 7(+2)  burn 2(+2)  LP 3(-1)"
      const numbers = pick ? compare(pick, isWorn ? null : worn) : ' '
      // read the cursor at press time, not draw time, so two quick presses both land
      const step = (by: number) => () => update($, game, edit(s => point(s, (s.menu?.cursor ?? 0) + by)))
      middle = (
        <Box key="event" flexDirection="column" flexGrow={1} flexShrink={1} marginX={2} height={3} overflow="hidden">
          {/* the name in its rarity color; the item you wear also bold */}
          <Text wrap="truncate" color={pick ? RARITY_COLOR[pick.rarity] : undefined} bold={isWorn}>
            {pick
              ? `${pick.name}  ${cursor + 1}/${list.length}${isKeep ? '  carry one on' : ''}`
              : `no ${slot} yet  (press ${SLOTS.indexOf(slot) + 1} to close)`}
          </Text>
          <Text wrap="truncate" dimColor={!pick}>{numbers}</Text>
          <Box key="keys" flexDirection="row" columnGap={1}>
            {pick && <Button key="up" label="^" hotkey="q" plain dimColor={cursor === 0} onPress={step(-1)} />}
            {pick && <Button key="down" label="v" hotkey="a" plain dimColor={cursor >= list.length - 1} onPress={step(1)} />}
            {pick && <Button key="use" label={isKeep ? 'keep' : isWorn ? 'close' : 'equip'} hotkey="e" plain
              onPress={() => update($, game, edit(s => choose(s, Math.min(s.menu?.cursor ?? 0, entries(s).length - 1))))} />}
            {pick && !isKeep && <Button key="drop" label="drop" hotkey="z" plain dimColor={isWorn}
              onPress={() => update($, game, edit(s => discard(s, s.menu?.cursor ?? 0)))} />}
          </Box>
        </Box>
      )
    } else {
      middle = (
        <Box key="event" flexDirection="column" flexGrow={1} flexShrink={1} marginX={2} height={3} overflow="hidden">
          {frame ? (
            <>
              <Text wrap="truncate" color="red">{frame[0]}</Text>
              <Text wrap="truncate">{frame[1]}</Text>
              <Text wrap="truncate" color="yellow" bold={f!.at >= f!.frames.length - 1}>{frame[2]}</Text>
            </>
          ) : (
            <Text wrap="wrap" dimColor={g.event.tone === 'dim'} color={g.event.tone === 'plain' || g.event.tone === 'dim' ? undefined : g.event.tone}>
              {g.event.text}
            </Text>
          )}
        </Box>
      )
    }

    // right: the hero is just its numbers and the perks its gear grants
    const pad = (n: number) => String(Math.max(0, n)).padStart(3, '0')
    const status = (
      <Box key="hero" flexDirection="column" width={STATUS_COLUMNS}>
        <Text>{'LP  '}<Text color="yellow">{pad(g.lp)}</Text>{`/${pad(me.maxlp)}`}</Text>
        <Text>{`ATK ${pad(me.atk)}  DEF ${pad(me.def)}`}</Text>
        <Text wrap="truncate" dimColor={!perks(me).length}>
          {perks(me).length
            ? perks(me).map((p, i) => <Text color={ELEMENT_COLOR[p.slice(1) as Element]}>{`${i ? ' ' : ''}${p}`}</Text>)
            : `run ${g.run}, no elements`}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="row" height={3}>
        {slots}
        {middle}
        {status}
      </Box>
    )
  })

  // on demand: the full sheet
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const g = fix(await read($, game))
    const me = stats(g.gear)
    const smells = MONSTERS.filter(m => g.profile.counts[m.smell] > 0)
      .map(m => `  ${m.smell} x${g.profile.counts[m.smell]}  -> ${m.name} [${m.element}]`)
    const rows = [
      `run ${g.run}   LP ${g.lp}/${me.maxlp}   ATK ${me.atk}   DEF ${me.def}   ${perks(me).join(' ')}`,
      ...SLOTS.map(s => describe(g.gear[s], s)),
      `wards: ${wardList(me).join('  ') || 'none'}`,
      '',
      `threat ${g.threat.toFixed(1)}   from ${g.profile.file} (slope ${density(g.profile).toFixed(1)}, power ${g.profile.power}, virtue ${g.profile.virtue})`,
      ...(smells.length ? smells : ['  no smells: tidy imps only']),
      '',
      `bag (${g.bag.length}):`,
      ...g.bag.map(i => `  ${describe(i, i.slot)}`),
      '',
      `waiting: ${g.queue.map(q => q.name).join(', ') || 'nothing'}`,
    ]
    return (
      <Box flexDirection="column">
        {rows.map(r => <Text>{r || ' '}</Text>)}
      </Box>
    )
  })
}

