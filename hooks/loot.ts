// Item generation, Diablo II style: pick a base the item level allows, roll a rarity, then draw
// at most one prefix (the item's element) and some suffixes (abilities against an element),
// weighted and item-level gated, and roll each number in its range. Deterministic: the same
// seed always yields the same item.
import type { Element, Item, Mod, Rarity, Slot, Stat } from '../types'
import { PREFIXES, RARE_NAMES, RARITIES, SUFFIXES } from '../data/affixes'
import { BASES } from '../data/items'
import type { PrefixDef, Range, SuffixDef } from '../data/schema'

// fire beats ice, ice beats arcane, arcane beats fire
export const BEATS: Record<Element, Element> = { fire: 'ice', ice: 'arcane', arcane: 'fire' }
export const beatenBy = (e: Element): Element => (Object.keys(BEATS) as Element[]).find(k => BEATS[k] === e)!
// drops from a monster favor the prefix that beats it and the suffixes against its element
const COUNTER_BOOST = 4

export const hash = (s: string) => {
  let x = 2166136261
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619)
  return x >>> 0
}

// a tiny seeded stream: each call draws the next number
function stream(seed: string) {
  let n = 0
  return {
    int: (lo: number, hi: number) => lo + (hash(`${seed}#${n++}`) % (hi - lo + 1)),
    pick<T>(items: readonly T[], weight: (t: T) => number): T | undefined {
      const total = items.reduce((s, t) => s + Math.max(0, weight(t)), 0)
      if (total <= 0) return undefined
      let r = hash(`${seed}#${n++}`) % total
      return items.find(t => (r -= Math.max(0, weight(t))) < 0)
    },
  }
}
type Rng = ReturnType<typeof stream>
const roll = (rng: Rng, r: Range) => rng.int(Math.min(r[0], r[1]), Math.max(r[0], r[1]))

export type DropOptions = { ilvl: number; seed: string; slot?: Slot; against?: Element | null; isBoss?: boolean }

export function generate({ ilvl, seed, slot, against, isBoss = false }: DropOptions): Item {
  const rng = stream(seed)
  const fits = (a: { slots: readonly Slot[]; level: Range }, s: Slot) => a.slots.includes(s) && ilvl >= a.level[0] && ilvl <= a.level[1]
  const favorPrefix = (p: PrefixDef) => p.weight * (against && p.element === beatenBy(against) ? COUNTER_BOOST : 1)
  const favorSuffix = (s: SuffixDef) => s.weight * (against && s.element === against ? COUNTER_BOOST : 1)

  const slots: Slot[] = ['weapon', 'armor', 'skill']
  const theSlot = slot ?? slots[rng.int(0, 2)]!
  const bases = BASES.filter(b => b.slot === theSlot && b.level <= ilvl)
  const base = rng.pick(bases, () => 1) ?? BASES.find(b => b.slot === theSlot)!

  const rarity = rng.pick(Object.keys(RARITIES) as Rarity[], r => (isBoss ? RARITIES[r].bossWeight : RARITIES[r].weight)) ?? 'normal'
  const R = RARITIES[rarity]
  const flat = new Map<Stat, number>()
  for (const [stat, range] of Object.entries(base.stats) as [Stat, Range][]) flat.set(stat, roll(rng, range))

  // draw affixes one by one, never two of a kind; a magic item may come out with only a suffix
  let prefix: PrefixDef | undefined
  const suffixes: SuffixDef[] = []
  const count = roll(rng, R.affixes)
  for (let i = 0; i < count; i++) {
    const prefixes = !prefix && R.maxPrefixes > 0 ? PREFIXES.filter(p => fits(p, theSlot)) : []
    const open = suffixes.length < R.maxSuffixes
      ? SUFFIXES.filter(s => fits(s, theSlot) && !suffixes.includes(s)
        // one ability per element on an item: no "Fire Resistance" twice in two tiers
        && !suffixes.some(t => t.ability === s.ability && t.element === s.element))
      : []
    const pool = [
      ...prefixes.map(p => ({ p, s: undefined, w: favorPrefix(p) })),
      ...open.map(s => ({ p: undefined, s, w: favorSuffix(s) })),
    ]
    const got = rng.pick(pool, x => x.w)
    if (!got) break
    if (got.p) prefix = got.p
    if (got.s) suffixes.push(got.s)
  }

  const name = rarity === 'rare'
    ? `${RARE_NAMES.first[rng.int(0, RARE_NAMES.first.length - 1)]} ${RARE_NAMES.second[rng.int(0, RARE_NAMES.second.length - 1)]}`
    : [prefix?.name, base.name, suffixes[0]?.name].filter(Boolean).join(' ')
  const mods: Mod[] = [...flat].filter(([, v]) => v > 0).map(([stat, value]) => ({ stat, value }))
  return {
    id: `${base.id}-${hash(seed).toString(36)}`, base: base.id, slot: theSlot, name, rarity, ilvl, mods,
    infusion: prefix ? { element: prefix.element, value: roll(rng, prefix.value) } : null,
    wards: suffixes.map(s => ({ ability: s.ability, element: s.element, pct: roll(rng, s.pct) })),
    affixes: [...(prefix ? [prefix.id] : []), ...suffixes.map(s => s.id)],
  }
}

// --- reading an item back -------------------------------------------------------------------

export const STATS: Stat[] = ['atk', 'def', 'hp']
const STAT_LABEL: Record<Stat, string> = { atk: 'ATK', def: 'DEF', hp: 'LP' }
export const statOf = (i: Item | null, s: Stat) => i?.mods.find(m => m.stat === s)?.value ?? 0

// what an element prefix reads as on each slot: "fire +3" on a weapon, "ice DEF+2" on armor
export function infusionLabel(slot: Slot, element: Element, value: number): string {
  return slot === 'weapon' ? `${element} +${value}` : slot === 'armor' ? `${element} DEF+${value}` : `${element} spell ${value}`
}
export const wardLabel = (w: { ability: string; element: string; pct: number }) => `${w.element} ${w.ability} ${w.pct}%`

// one item's numbers in a line: "ATK 5  fire +3  ice resist 15%"
export function modLine(i: Item): string {
  return [
    ...STATS.flatMap(s => (statOf(i, s) ? [`${STAT_LABEL[s]} ${statOf(i, s)}`] : [])),
    ...(i.infusion ? [infusionLabel(i.slot, i.infusion.element, i.infusion.value)] : []),
    ...i.wards.map(wardLabel),
  ].join('  ') || 'no stats'
}

// the same, against another item of the slot: "ATK 7(+2)  fire +3(new)  -ice resist"
export function compare(item: Item, than: Item | null): string {
  if (!than) return modLine(item)
  const parts: string[] = []
  for (const s of STATS) {
    const a = statOf(item, s)
    const b = statOf(than, s)
    if (!a && !b) continue
    if (!a) { parts.push(`-${STAT_LABEL[s]}`); continue }
    const d = a - b
    parts.push(`${STAT_LABEL[s]} ${a}${b ? (d ? `(${d > 0 ? '+' : ''}${d})` : '') : '(new)'}`)
  }
  const ia = item.infusion
  const ib = than.infusion
  if (ia) {
    const same = ib?.element === ia.element
    const d = same ? ia.value - ib.value : 0
    parts.push(`${infusionLabel(item.slot, ia.element, ia.value)}${same ? (d ? `(${d > 0 ? '+' : ''}${d})` : '') : '(new)'}`)
  } else if (ib) parts.push(`-${ib.element}`)
  for (const w of item.wards) {
    const o = than.wards.find(x => x.ability === w.ability && x.element === w.element)
    const d = o ? w.pct - o.pct : 0
    parts.push(`${wardLabel(w)}${o ? (d ? `(${d > 0 ? '+' : ''}${d})` : '') : '(new)'}`)
  }
  for (const o of than.wards) {
    if (!item.wards.some(w => w.ability === o.ability && w.element === o.element)) parts.push(`-${o.element} ${o.ability}`)
  }
  return parts.join('  ') || 'no stats'
}
