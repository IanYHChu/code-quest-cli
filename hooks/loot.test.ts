import { expect, test } from 'claude-code/testing'

import { PREFIXES, SUFFIXES } from '../data/affixes'
import { BASES } from '../data/items'
import { BEATS, beatenBy, compare, generate, modLine } from './loot'

const many = (n: number, opts: Omit<Parameters<typeof generate>[0], 'seed'>) =>
  Array.from({ length: n }, (_, i) => generate({ ...opts, seed: `t${i}` }))
const kindOf = (id: string) => (PREFIXES.some(p => p.id === id) ? 'prefix' : 'suffix')

test('the cycle: fire beats ice, ice beats arcane, arcane beats fire', () => {
  expect(BEATS).toEqual({ fire: 'ice', ice: 'arcane', arcane: 'fire' })
  expect(beatenBy('ice')).toBe('fire')
})

test('the same seed always makes the same item', () => {
  expect(generate({ ilvl: 5, seed: 'x' })).toEqual(generate({ ilvl: 5, seed: 'x' }))
})

test('item level gates bases and affixes', () => {
  for (const it of many(200, { ilvl: 1 })) {
    expect(BASES.find(b => b.id === it.base)!.level).toBe(1)
    for (const id of it.affixes) expect([...PREFIXES, ...SUFFIXES].find(a => a.id === id)!.level[0]).toBe(1)
  }
  expect(many(300, { ilvl: 12 }).some(it => BASES.find(b => b.id === it.base)!.level >= 8)).toBe(true)
})

test('at most one prefix (one element); rarity sets the affix count; names follow D2', () => {
  for (const it of many(400, { ilvl: 10 })) {
    const pre = it.affixes.filter(id => kindOf(id) === 'prefix').length
    const suf = it.affixes.length - pre
    expect(pre).toBeLessThanOrEqual(1)
    expect(Boolean(it.infusion)).toBe(pre === 1)
    expect(it.wards).toHaveLength(suf)
    const base = BASES.find(b => b.id === it.base)!
    if (it.rarity === 'normal') { expect(it.affixes).toEqual([]); expect(it.name).toBe(base.name) }
    if (it.rarity === 'magic') { expect(suf).toBeLessThanOrEqual(1); expect(it.name).toContain(base.name) }
    if (it.rarity === 'rare') { expect(it.affixes.length).toBeGreaterThanOrEqual(2); expect(suf).toBeLessThanOrEqual(3) }
    // never the same ability against the same element twice
    expect(new Set(it.wards.map(w => `${w.ability}:${w.element}`)).size).toBe(it.wards.length)
  }
})

test('rolled numbers stay inside their ranges', () => {
  for (const it of many(400, { ilvl: 10 })) {
    for (const id of it.affixes) {
      const p = PREFIXES.find(x => x.id === id)
      if (p) { expect(it.infusion!.value).toBeGreaterThanOrEqual(p.value[0]); expect(it.infusion!.value).toBeLessThanOrEqual(p.value[1]) }
      const s = SUFFIXES.find(x => x.id === id)
      if (s) {
        const w = it.wards.find(x => x.ability === s.ability && x.element === s.element)!
        expect(w.pct).toBeGreaterThanOrEqual(s.pct[0])
        expect(w.pct).toBeLessThanOrEqual(s.pct[1])
      }
    }
  }
})

test("a monster's drops favor the element that beats it and wards against its own", () => {
  const share = (items: ReturnType<typeof many>, f: (i: ReturnType<typeof many>[number]) => boolean) => items.filter(f).length / items.length
  const vsIce = many(500, { ilvl: 6, against: 'ice' })
  const plain = many(500, { ilvl: 6 })
  const fire = (i: (typeof plain)[number]) => i.infusion?.element === 'fire'
  const iceWard = (i: (typeof plain)[number]) => i.wards.some(w => w.element === 'ice')
  expect(share(vsIce, fire)).toBeGreaterThan(share(plain, fire) * 1.5)
  expect(share(vsIce, iceWard)).toBeGreaterThan(share(plain, iceWard) * 1.5)
})

test('bosses drop rarer items', () => {
  const rares = (items: ReturnType<typeof many>) => items.filter(i => i.rarity !== 'normal').length
  expect(rares(many(300, { ilvl: 6, isBoss: true }))).toBeGreaterThan(rares(many(300, { ilvl: 6 })))
})

test('an item reads back as one line, and compares stat by stat', () => {
  const a = { id: 'a', base: 'x', slot: 'weapon', name: 'A', rarity: 'magic', ilvl: 1, affixes: [],
    mods: [{ stat: 'atk', value: 5 }], infusion: { element: 'fire', value: 3 }, wards: [{ ability: 'reflect', element: 'ice', pct: 7 }] } as const
  const b = { ...a, id: 'b', mods: [{ stat: 'atk', value: 3 }], infusion: null, wards: [{ ability: 'reflect', element: 'arcane', pct: 5 }] } as const
  expect(modLine(a as never)).toBe('ATK 5  fire +3  ice reflect 7%')
  expect(compare(a as never, b as never)).toBe('ATK 5(+2)  fire +3(new)  ice reflect 7%(new)  -arcane reflect')
})
