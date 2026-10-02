// Code Quest's state contract: every value the mod keeps in $.state, and the vocabulary the
// content tables in data/ are written in.
export type Smell = 'swallow' | 'leak' | 'dead' | 'debug' | 'insecure' | 'todo'
export type Slot = 'weapon' | 'armor' | 'skill'
// flat stats an item base rolls
export type Stat = 'atk' | 'def' | 'hp'
// fire beats ice, ice beats arcane, arcane beats fire
export type Element = 'fire' | 'ice' | 'arcane'
// what a suffix does to damage of one element you take: resist cuts it, absorb heals you a
// share of it, reflect sends a share back
export type Ability = 'resist' | 'absorb' | 'reflect'
export type Rarity = 'normal' | 'magic' | 'rare'

export type Mod = { stat: Stat; value: number }
// a prefix: the item's element and how strong it is. On a weapon, extra damage of that element
// on every hit; on armor, your defending element and extra DEF; on a skill, a spell of that
// element every few rounds
export type Infusion = { element: Element; value: number }
// a suffix: an ability against one element, as a percent
export type Ward = { ability: Ability; element: Element; pct: number }
export type Item = {
  id: string; base: string; slot: Slot; name: string; rarity: Rarity; ilvl: number
  mods: Mod[]; infusion: Infusion | null; wards: Ward[]
  // the affix ids it rolled, for the sheet
  affixes: string[]
}
export type Gear = { weapon: Item | null; armor: Item | null; skill: Item | null }
export type Foe = { name: string; source: string; element: Element | null; hp: number; atk: number; isBoss: boolean; intro: string }
// a file as the scanner saw it: smell counts, how bad its worst finding is, and its virtues
export type Profile = { file: string; counts: Record<Smell, number>; lines: number; power: number; virtue: number }

// a fight is simulated whole when it starts and then played back frame by frame
export type Fight = { foe: Foe; frames: [string, string, string][]; at: number; won: boolean; lpAfter: number }
// the menu in the middle zone: browse one slot's items, or pick a keepsake after a death
export type Menu = { kind: 'gear'; slot: Slot; cursor: number } | { kind: 'keep'; cursor: number }

export type Game = {
  version: number
  run: number; lp: number; gear: Gear; threat: number; steps: number
  profile: Profile; queue: Foe[]; fight: Fight | null
  bag: Item[]; menu: Menu | null; keepsake: Item[] | null
  event: { text: string; tone: 'plain' | 'dim' | 'red' | 'yellow' | 'cyan' | 'green' }
}

declare module 'claude-code' {
  interface PluginState {
    'code-quest': { game: Game }
  }
}
