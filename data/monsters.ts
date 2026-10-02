// What each code smell breeds. The scanner (quest-analyze.mjs) counts the smells of the file
// Claude last read; the commoner a smell, the more often its monster steps out. A smell's kind
// sets the element: runtime trouble burns (fire), stale debt freezes (ice), security holes are
// dark magic (arcane).
import type { MonsterDef } from './schema'

export const MONSTERS: readonly MonsterDef[] = [
  { smell: 'swallow', name: 'swallowed-error wraith', element: 'fire', hp: [6, 3], atk: [2, 1], intro: 'An error that was never handled flares out of the dark.' },
  { smell: 'debug', name: 'debug-print swarm', element: 'fire', hp: [5, 3], atk: [2, 1], intro: 'Forgotten debug prints buzz out in a burning cloud.' },
  { smell: 'dead', name: 'dead-code revenant', element: 'ice', hp: [8, 3], atk: [2, 1], intro: 'Commented-out code thaws and claws its way back.' },
  { smell: 'todo', name: 'TODO trapper', element: 'ice', hp: [6, 3], atk: [2, 1], intro: 'A TODO left frozen for later stirs awake.' },
  { smell: 'leak', name: 'leaking-secret slime', element: 'arcane', hp: [7, 3], atk: [2, 1], intro: 'A hardcoded secret oozes out, humming with stolen power.' },
  { smell: 'insecure', name: 'unchecked-input brute', element: 'arcane', hp: [7, 3], atk: [3, 1], intro: 'Unchecked input twists into a hex and charges.' },
]

// a file with no smells breeds only these: no element, the weakest numbers
export const TIDY = {
  name: 'tidy imp', element: null, hp: [5, 2] as const, atk: [1, 1] as const, intro: 'Clean halls; only a tidy imp wanders here.',
}
