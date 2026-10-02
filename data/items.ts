// Item bases: the flat stats an item starts from. An item that drops picks a base its item level
// allows, then rolls its rarity and affixes from affixes.ts.
import type { ItemBase } from './schema'

export const BASES: readonly ItemBase[] = [
  // weapons: the main source of ATK
  { id: 'dagger', slot: 'weapon', name: 'Rusty Dagger', level: 1, stats: { atk: [1, 3] } },
  { id: 'short-sword', slot: 'weapon', name: 'Short Sword', level: 1, stats: { atk: [2, 4] } },
  { id: 'war-axe', slot: 'weapon', name: 'War Axe', level: 4, stats: { atk: [4, 7] } },
  { id: 'rune-blade', slot: 'weapon', name: 'Rune Blade', level: 8, stats: { atk: [7, 11] } },
  { id: 'refactor-hammer', slot: 'weapon', name: 'Refactor Hammer', level: 12, stats: { atk: [10, 15] } },

  // armor: DEF, some LP
  { id: 'robe', slot: 'armor', name: 'Cloth Robe', level: 1, stats: { def: [0, 1], hp: [2, 4] } },
  { id: 'leather', slot: 'armor', name: 'Leather Coat', level: 1, stats: { def: [1, 2] } },
  { id: 'chain', slot: 'armor', name: 'Chain Mail', level: 4, stats: { def: [2, 4], hp: [0, 3] } },
  { id: 'plate', slot: 'armor', name: 'Plate Armor', level: 8, stats: { def: [4, 6], hp: [3, 6] } },
  { id: 'type-plate', slot: 'armor', name: 'Strict-Type Plate', level: 12, stats: { def: [6, 9], hp: [5, 9] } },

  // skills: LP, and the spell an element prefix turns them into
  { id: 'focus', slot: 'skill', name: 'Focus', level: 1, stats: { hp: [3, 6] } },
  { id: 'battle-cry', slot: 'skill', name: 'Battle Cry', level: 3, stats: { atk: [1, 3], hp: [1, 3] } },
  { id: 'meditation', slot: 'skill', name: 'Meditation', level: 6, stats: { hp: [5, 9] } },
  { id: 'code-review', slot: 'skill', name: 'Code Review', level: 10, stats: { atk: [2, 4], hp: [3, 6] } },
]
