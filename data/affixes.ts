// Prefixes and suffixes, Diablo II style: each fits some slots and an item-level range, and rolls
// its number inside its range. Prefixes give an element (fire > ice > arcane > fire); suffixes
// give an ability against one element. Higher tiers of the same idea sit at deeper levels.
// A monster's drop favors the prefix whose element beats it and the suffixes against its element.
import type { Ability, Element, Rarity } from '../types'
import type { PrefixDef, Range, RarityDef, SuffixDef } from './schema'

export const ELEMENTS: readonly Element[] = ['fire', 'ice', 'arcane']

export const PREFIXES: readonly PrefixDef[] = [
  // weapons: extra damage of the element on every hit
  { id: 'smoldering', name: 'Smoldering', element: 'fire', slots: ['weapon'], level: [1, 8], weight: 8, value: [1, 2] },
  { id: 'blazing', name: 'Blazing', element: 'fire', slots: ['weapon'], level: [6, 99], weight: 5, value: [3, 5] },
  { id: 'chilling', name: 'Chilling', element: 'ice', slots: ['weapon'], level: [1, 8], weight: 8, value: [1, 2] },
  { id: 'frozen', name: 'Frozen', element: 'ice', slots: ['weapon'], level: [6, 99], weight: 5, value: [3, 5] },
  { id: 'glowing', name: 'Glowing', element: 'arcane', slots: ['weapon'], level: [1, 8], weight: 8, value: [1, 2] },
  { id: 'eldritch', name: 'Eldritch', element: 'arcane', slots: ['weapon'], level: [6, 99], weight: 5, value: [3, 5] },
  // armor: your defending element, plus that much DEF
  { id: 'scorched', name: 'Scorched', element: 'fire', slots: ['armor'], level: [1, 8], weight: 8, value: [1, 2] },
  { id: 'volcanic', name: 'Volcanic', element: 'fire', slots: ['armor'], level: [6, 99], weight: 5, value: [2, 4] },
  { id: 'frost-lined', name: 'Frost-lined', element: 'ice', slots: ['armor'], level: [1, 8], weight: 8, value: [1, 2] },
  { id: 'glacial', name: 'Glacial', element: 'ice', slots: ['armor'], level: [6, 99], weight: 5, value: [2, 4] },
  { id: 'runed', name: 'Runed', element: 'arcane', slots: ['armor'], level: [1, 8], weight: 8, value: [1, 2] },
  { id: 'astral', name: 'Astral', element: 'arcane', slots: ['armor'], level: [6, 99], weight: 5, value: [2, 4] },
  // skills: a spell of the element every few rounds, for this much damage
  { id: 'kindling', name: 'Kindling', element: 'fire', slots: ['skill'], level: [1, 8], weight: 8, value: [3, 5] },
  { id: 'inferno', name: 'Inferno', element: 'fire', slots: ['skill'], level: [6, 99], weight: 5, value: [6, 10] },
  { id: 'frost', name: 'Frost', element: 'ice', slots: ['skill'], level: [1, 8], weight: 8, value: [3, 5] },
  { id: 'blizzard', name: 'Blizzard', element: 'ice', slots: ['skill'], level: [6, 99], weight: 5, value: [6, 10] },
  { id: 'hex', name: 'Hex', element: 'arcane', slots: ['skill'], level: [1, 8], weight: 8, value: [3, 5] },
  { id: 'starfall', name: 'Starfall', element: 'arcane', slots: ['skill'], level: [6, 99], weight: 5, value: [6, 10] },
]

// each ability comes in tiers; every tier exists once per element: "of Fire Resistance",
// "of Greater Ice Absorption". Edit the tiers here and every element follows.
type Tier = { level: Range; weight: number; pct: Range; title: string }
const TIERS: Record<Ability, { noun: string; slots: SuffixDef['slots']; tiers: Tier[] }> = {
  resist: {
    noun: 'Resistance', slots: ['armor', 'skill'],
    tiers: [
      { title: '', level: [1, 8], weight: 8, pct: [10, 20] },
      { title: 'Greater ', level: [6, 99], weight: 4, pct: [20, 40] },
    ],
  },
  absorb: {
    noun: 'Absorption', slots: ['armor', 'skill'],
    tiers: [
      { title: '', level: [2, 10], weight: 5, pct: [2, 6] },
      { title: 'Greater ', level: [8, 99], weight: 3, pct: [6, 12] },
    ],
  },
  reflect: {
    noun: 'Reflection', slots: ['weapon', 'armor'],
    tiers: [
      { title: '', level: [1, 10], weight: 5, pct: [5, 12] },
      { title: 'Greater ', level: [8, 99], weight: 3, pct: [12, 25] },
    ],
  },
}
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

export const SUFFIXES: readonly SuffixDef[] = (Object.keys(TIERS) as Ability[]).flatMap(ability =>
  ELEMENTS.flatMap(element => TIERS[ability].tiers.map((t, i) => ({
    id: `${element}-${ability}-${i + 1}`,
    name: `of ${t.title}${cap(element)} ${TIERS[ability].noun}`,
    ability, element, slots: TIERS[ability].slots, level: t.level, weight: t.weight, pct: t.pct,
  }))))

// normal: base only; magic: a prefix and/or a suffix; rare: up to one prefix and three suffixes,
// and a random name
export const RARITIES: Record<Rarity, RarityDef> = {
  normal: { affixes: [0, 0], maxPrefixes: 0, maxSuffixes: 0, weight: 55, bossWeight: 10 },
  magic: { affixes: [1, 2], maxPrefixes: 1, maxSuffixes: 1, weight: 35, bossWeight: 50 },
  rare: { affixes: [2, 4], maxPrefixes: 1, maxSuffixes: 3, weight: 10, bossWeight: 40 },
}

// a rare item is named from two of these, as "Grim Bite"
export const RARE_NAMES = {
  first: ['Grim', 'Hollow', 'Rune', 'Storm', 'Blight', 'Dread', 'Ghost', 'Iron', 'Null', 'Stack', 'Async', 'Legacy'],
  second: ['Bite', 'Song', 'Ward', 'Fang', 'Shell', 'Mark', 'Call', 'Thread', 'Pointer', 'Trace', 'Hook', 'Patch'],
} as const
