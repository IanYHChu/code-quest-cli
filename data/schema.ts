// The shape of Code Quest's content tables. Everything a player can find or fight is data in
// this folder: item bases (items.ts), prefixes and suffixes (affixes.ts) and monsters
// (monsters.ts). Add an entry there and the game picks it up; hooks/content.test.ts checks every
// table against these rules (unique ids, sane ranges, known slots, elements and abilities).
import type { Ability, Element, Slot, Smell, Stat } from '../types'

// [min, max], both inclusive; a roll picks a whole number in between
export type Range = readonly [number, number]

// what an item is before any affix: a Short Sword, a Chain Mail, a Battle Cry
export type ItemBase = {
  id: string
  slot: Slot
  name: string
  // the lowest item level that can drop it
  level: number
  // its own flat stats, rolled once when it drops
  stats: Partial<Record<Stat, Range>>
}

// a prefix gives an item its element: "Blazing Short Sword". Its value is what the element
// adds on that slot (see Infusion in types/index.d.ts)
export type PrefixDef = {
  id: string
  name: string
  element: Element
  slots: readonly Slot[]
  // the item level range it can roll on: low tiers fade out, high tiers need deep runs
  level: Range
  // relative odds among the prefixes that fit
  weight: number
  value: Range
}

// a suffix gives an ability against one element: "Chain Mail of Fire Absorption"
export type SuffixDef = {
  id: string
  name: string
  ability: Ability
  element: Element
  slots: readonly Slot[]
  level: Range
  weight: number
  pct: Range
}

// what a smell in the code breeds
export type MonsterDef = {
  smell: Smell
  name: string
  // its attacks are of this element, and it defends as this element
  element: Element
  // [at threat 0, gained per threat point]
  hp: readonly [number, number]
  atk: readonly [number, number]
  // flavor for the event line when it steps out
  intro: string
}

// rarities: how many affixes, and how often each drops (boss drops shift toward the rare end).
// Every item has at most one prefix, so at most one element
export type RarityDef = { affixes: Range; maxPrefixes: 0 | 1; maxSuffixes: number; weight: number; bossWeight: number }
