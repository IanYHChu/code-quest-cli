import { expect, test } from 'claude-code/testing'

import type { Foe, Game, Infusion, Item, Mod, Slot, Ward } from '../types'
import {
  FRESH, advance, choose, conclude, density, discard, edge, engage, entries, fix, hasUpgrade, keep, openMenu, point,
  scan, simulate, stats,
} from './game'

const DIRTY = [
  'function run() {',
  '  try { go() } catch (e) {}',
  '  // TODO: fix this',
  '  console.log("x")',
  '  // const old = 1',
  '}',
].join('\n')

const item = (slot: Slot, name: string, ilvl: number, mods: Mod[], infusion: Infusion | null = null, wards: Ward[] = []): Item =>
  ({ id: `${name}-${ilvl}`, base: 'test', slot, name, rarity: 'magic', ilvl, mods, infusion, wards, affixes: [] })
const foe = (over: Partial<Foe>): Foe =>
  ({ name: 'tidy imp', source: 'x', element: null, hp: 1, atk: 0, isBoss: false, intro: 'hi', ...over })

test('the real scanner sees the smells, and the slope rises with them', () => {
  const p = scan('/repo/a.ts', DIRTY)
  expect(p.counts).toMatchObject({ swallow: 1, todo: 1, debug: 1, dead: 1 })
  expect(density(p)).toBeGreaterThan(density(scan('/repo/b.ts', 'export const a = 1\n'.repeat(50))))
})

test("the game's own files are not scanned (noscan)", () => {
  expect(scan('/repo/quest-rules.mjs', DIRTY).counts).toMatchObject({ swallow: 0, todo: 0, debug: 0, dead: 0 })
})

test('a read sets the breeding ground; every second step a foe from it fights', () => {
  let g = advance(FRESH, { kind: 'read', file: '/repo/a.ts', content: DIRTY })
  expect(g.fight).toBeNull()
  g = advance(g, { kind: 'step' })
  expect(g.fight?.foe.source).toBe('a.ts')
  expect(['swallowed-error wraith', 'TODO trapper', 'debug-print swarm', 'dead-code revenant']).toContain(g.fight?.foe.name)
})

test('a clean file breeds only tidy imps', () => {
  let g = advance(FRESH, { kind: 'read', file: '/repo/clean.ts', content: 'export const a = 1\n' })
  g = advance(g, { kind: 'step' })
  expect(g.fight?.foe.name).toBe('tidy imp')
})

test('a win drops a generated item into the bag; the slot menu equips it', () => {
  let g = conclude(engage({ ...FRESH, queue: [foe({ name: 'dead-code revenant', element: 'ice', hp: 6, atk: 1 })] }))
  expect(g.bag).toHaveLength(1)
  const loot = g.bag[0]!
  expect(hasUpgrade(g, loot.slot)).toBe(true)
  g = openMenu(g, loot.slot)
  expect(entries(g).map(i => i.id)).toEqual([loot.id])
  g = choose(g, 0)
  expect(g.gear[loot.slot]?.id).toBe(loot.id)
  expect(g.bag).toHaveLength(0)
  expect(g.menu).toBeNull()
})

test('the menu lists the worn item first; equipping another puts the worn one back in the bag', () => {
  const a = item('weapon', 'Short Sword', 1, [{ stat: 'atk', value: 3 }])
  const b = item('weapon', 'Smoldering Short Sword', 3, [{ stat: 'atk', value: 3 }], { element: 'fire', value: 2 })
  const c = item('armor', 'Leather Coat', 1, [{ stat: 'def', value: 1 }])
  let g: Game = { ...FRESH, gear: { ...FRESH.gear, weapon: a }, bag: [b, c] }
  g = openMenu(g, 'weapon')
  expect(entries(g).map(i => i.name)).toEqual(['Short Sword', 'Smoldering Short Sword'])
  g = point(g, 5)
  expect(g.menu?.cursor).toBe(1) // clamped to the list
  g = choose(g, 1)
  expect(g.gear.weapon?.name).toBe('Smoldering Short Sword')
  expect(stats(g.gear).strike).toEqual({ element: 'fire', value: 2 })
  expect(g.bag.map(i => i.name).sort()).toEqual(['Leather Coat', 'Short Sword'])
  expect(openMenu(openMenu(g, 'armor'), 'armor').menu).toBeNull() // the same slot again closes it
})

test('z drops a bag item and keeps the cursor in range; what you wear cannot be dropped', () => {
  const a = item('weapon', 'Short Sword', 1, [{ stat: 'atk', value: 3 }])
  const b = item('weapon', 'Rune Blade', 8, [{ stat: 'atk', value: 9 }])
  let g: Game = point(openMenu({ ...FRESH, gear: { ...FRESH.gear, weapon: a }, bag: [b] }, 'weapon'), 1)
  g = discard(g, 1)
  expect(g.bag).toEqual([])
  expect(g.menu?.cursor).toBe(0)
  g = discard(g, 0)
  expect(g.gear.weapon?.name).toBe('Short Sword')
  expect(g.event.text).toMatch(/cannot drop what you wear/)
})

test('gear stats add up: each slot sets its element, armor adds DEF, wards sum and cap', () => {
  const s = stats({
    weapon: item('weapon', 'w', 1, [{ stat: 'atk', value: 4 }], { element: 'fire', value: 3 }, [{ ability: 'reflect', element: 'ice', pct: 50 }]),
    armor: item('armor', 'a', 1, [{ stat: 'def', value: 3 }, { stat: 'hp', value: 5 }], { element: 'ice', value: 2 }, [{ ability: 'reflect', element: 'ice', pct: 40 }]),
    skill: item('skill', 's', 1, [], { element: 'arcane', value: 6 }, [{ ability: 'absorb', element: 'fire', pct: 4 }]),
  })
  expect(s).toMatchObject({ atk: 7, def: 6, maxlp: 25, strike: { element: 'fire', value: 3 }, guard: 'ice', spell: { element: 'arcane', value: 6 } })
  expect(s.wards.reflect.ice).toBe(75)
  expect(s.wards.absorb.fire).toBe(4)
})

test('the edge: 1.5x when your element beats theirs, 0.7x when theirs beats yours', () => {
  expect(edge('fire', 'ice')).toBe(1.5)
  expect(edge('fire', 'arcane')).toBe(0.7)
  expect(edge('fire', 'fire')).toBe(1)
  expect(edge(null, 'ice')).toBe(1)
})

test('a fight is told blow by blow: wind-up, flight, impact', () => {
  const { frames } = simulate({ ...FRESH, lp: 99 }, foe({ hp: 30, atk: 1 }))
  const arena = frames.map(f => f[1])
  expect(arena.some(r => /@> {13}m/.test(r))).toBe(true)
  expect(arena.some(r => /@ {7}> {6}m/.test(r))).toBe(true)
  expect(arena.some(r => /@ {14}\*/.test(r))).toBe(true)
  expect(arena.some(r => /@ {13}<m/.test(r))).toBe(true)
  expect(arena.some(r => /\* {14}m/.test(r))).toBe(true)
})

test('a fire weapon cuts an ice foe down faster than an arcane one', () => {
  const blade = item('weapon', 'Smoldering Dagger', 1, [{ stat: 'atk', value: 2 }], { element: 'fire', value: 2 })
  const g: Game = { ...FRESH, lp: 99, gear: { ...FRESH.gear, weapon: blade } }
  const vsIce = simulate(g, foe({ element: 'ice', hp: 60, atk: 1 }))
  const vsArcane = simulate(g, foe({ element: 'arcane', hp: 60, atk: 1 }))
  expect(vsIce.frames.length).toBeLessThan(vsArcane.frames.length)
  expect(vsIce.frames.some(f => f[2].includes('fire>ice'))).toBe(true)
  expect(vsArcane.frames.some(f => f[2].includes('fire<arcane'))).toBe(true)
})

test('resist cuts, absorb heals and reflect returns damage of their element only', () => {
  const coat = item('armor', 'Coat', 1, [], null, [
    { ability: 'resist', element: 'fire', pct: 50 }, { ability: 'absorb', element: 'fire', pct: 50 }, { ability: 'reflect', element: 'fire', pct: 50 },
  ])
  const g: Game = { ...FRESH, lp: 99, gear: { ...FRESH.gear, armor: coat } }
  const hot = simulate(g, foe({ element: 'fire', hp: 200, atk: 12 })).frames.map(f => f[2]).join('\n')
  expect(hot).toMatch(/resist 50%/)
  expect(hot).toMatch(/absorb \+\d/)
  expect(hot).toMatch(/reflect -\d/)
  const cold = simulate(g, foe({ element: 'ice', hp: 200, atk: 12 })).frames.map(f => f[2]).join('\n')
  expect(cold).not.toMatch(/resist|absorb|reflect/)
})

test('a skill with an element casts a spell every third round', () => {
  const hex = item('skill', 'Hex Focus', 1, [], { element: 'arcane', value: 5 })
  const { frames } = simulate({ ...FRESH, lp: 99, gear: { ...FRESH.gear, skill: hex } }, foe({ element: 'fire', hp: 200, atk: 1 }))
  expect(frames.some(f => f[2].startsWith('arcane spell -8 arcane>fire'))).toBe(true)
  expect(frames.some(f => f[1].includes('~'))).toBe(true)
})

test('the threat curve is steeper for dirty code', () => {
  const clean = conclude(engage({ ...FRESH, queue: [foe({})] }))
  const dirty = conclude(engage({ ...FRESH, profile: scan('/repo/a.ts', DIRTY), queue: [foe({})] }))
  expect(dirty.threat).toBeGreaterThan(clean.threat)
})

test('death ends the run and opens the keepsake menu; the pick, or the deepest item, carries over', () => {
  const sword = item('weapon', 'Short Sword', 1, [{ stat: 'atk', value: 3 }])
  const mail = item('armor', 'Frost-lined Chain Mail', 4, [{ stat: 'def', value: 3 }], { element: 'ice', value: 1 })
  const doomed: Game = { ...FRESH, lp: 5, gear: { weapon: sword, armor: null, skill: null }, bag: [mail], queue: [foe({ name: 'ogre', hp: 999, atk: 50 })] }
  const dead = conclude(engage(doomed))
  expect(dead.run).toBe(2)
  expect(dead.menu).toEqual({ kind: 'keep', cursor: 0 })
  expect(entries(dead).map(i => i.name)).toEqual(['Frost-lined Chain Mail', 'Short Sword'])
  expect(choose(dead, 1).gear).toEqual({ weapon: sword, armor: null, skill: null })
  expect(keep(dead, 1).bag).toEqual([])
  // unpicked: the next fight settles it with the deepest item
  const next = engage({ ...dead, queue: [foe({})] })
  expect(next.keepsake).toBeNull()
  expect(next.menu).toBeNull()
  expect(next.gear.armor?.name).toBe('Frost-lined Chain Mail')
})

test('a save from another version starts fresh', () => {
  expect(fix({ version: 2, run: 9 } as never)).toEqual(FRESH)
  expect(fix(null)).toEqual(FRESH)
  const g = { ...FRESH, run: 4 }
  expect(fix(g)).toBe(g)
})
