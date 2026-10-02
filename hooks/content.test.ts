// Guards the content tables in data/: whatever is added there must be well-formed.
import { expect, test } from 'claude-code/testing'

import type { Range } from '../data/schema'
import { ELEMENTS, PREFIXES, RARE_NAMES, RARITIES, SUFFIXES } from '../data/affixes'
import { BASES } from '../data/items'
import { MONSTERS, TIDY } from '../data/monsters'

const SLOTS = ['weapon', 'armor', 'skill']
const SMELLS = ['swallow', 'leak', 'dead', 'debug', 'insecure', 'todo']
const STATS = ['atk', 'def', 'hp']
const ABILITIES = ['resist', 'absorb', 'reflect']
const okRange = (r: Range) => Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 0 && r[0] <= r[1]
const unique = (ids: string[]) => new Set(ids).size === ids.length

test('item bases: unique ids, known slots and stats, sane ranges, every slot droppable at level 1', () => {
  expect(unique(BASES.map(b => b.id))).toBe(true)
  for (const b of BASES) {
    expect(SLOTS).toContain(b.slot)
    expect(b.level).toBeGreaterThanOrEqual(1)
    for (const [stat, r] of Object.entries(b.stats)) {
      expect(STATS).toContain(stat)
      expect(okRange(r!)).toBe(true)
    }
  }
  for (const s of SLOTS) expect(BASES.some(b => b.slot === s && b.level === 1)).toBe(true)
})

test('prefixes: unique ids, known elements and slots, sane ranges; every element on every slot from level 1', () => {
  expect(unique([...PREFIXES, ...SUFFIXES].map(a => a.id))).toBe(true)
  for (const p of PREFIXES) {
    expect(ELEMENTS).toContain(p.element)
    for (const s of p.slots) expect(SLOTS).toContain(s)
    expect(okRange(p.level) && okRange(p.value) && p.value[0] > 0).toBe(true)
    expect(p.weight).toBeGreaterThan(0)
  }
  for (const e of ELEMENTS) for (const s of SLOTS) {
    expect(PREFIXES.some(p => p.element === e && p.slots.includes(s as never) && p.level[0] === 1)).toBe(true)
  }
})

test('suffixes: known abilities and elements, percents in 1..100; every ability for every element', () => {
  for (const x of SUFFIXES) {
    expect(ABILITIES).toContain(x.ability)
    expect(ELEMENTS).toContain(x.element)
    for (const s of x.slots) expect(SLOTS).toContain(s)
    expect(okRange(x.level) && okRange(x.pct) && x.pct[0] >= 1 && x.pct[1] <= 100).toBe(true)
    expect(x.weight).toBeGreaterThan(0)
    expect(x.name).toMatch(/^of /)
  }
  for (const a of ABILITIES) for (const e of ELEMENTS) expect(SUFFIXES.some(x => x.ability === a && x.element === e)).toBe(true)
})

test('rarities and rare names are sane', () => {
  for (const r of Object.values(RARITIES)) {
    expect(okRange(r.affixes)).toBe(true)
    expect(r.affixes[1]).toBeLessThanOrEqual(r.maxPrefixes + r.maxSuffixes)
    expect(r.maxPrefixes).toBeLessThanOrEqual(1)
  }
  expect(RARE_NAMES.first.length).toBeGreaterThan(0)
  expect(RARE_NAMES.second.length).toBeGreaterThan(0)
})

test('monsters: one per smell, every element bred by some smell, sane numbers', () => {
  expect(MONSTERS.map(m => m.smell).sort()).toEqual([...SMELLS].sort())
  for (const e of ELEMENTS) expect(MONSTERS.some(m => m.element === e)).toBe(true)
  for (const m of [...MONSTERS, TIDY]) {
    expect(m.hp[0]).toBeGreaterThan(0)
    expect(m.atk[0]).toBeGreaterThan(0)
    expect(m.intro.length).toBeGreaterThan(0)
  }
})
