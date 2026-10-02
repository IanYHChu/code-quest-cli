// Code Quest rules: pure functions over the Game value, no $ and no clock.
// The hero is LP, ATK, DEF and whatever its three gear slots grant; there are no levels, power
// is gear. Monsters are bred from the code smells of the file Claude last read (the scanner in
// quest-analyze.mjs) and carry the element of their smell's kind; how fast they grow is set by
// how dirty that code is. Elements cycle: fire beats ice, ice beats arcane, arcane beats fire.
// Drops are generated from the tables in data/ and favor what answers the monster's element.
import type { Ability, Element, Foe, Game, Gear, Item, Menu, Profile, Slot, Smell } from '../types'
import { analyze } from '../quest-analyze.mjs'
import { PROSE_RE } from '../quest-rules.mjs'
import { MONSTERS, TIDY } from '../data/monsters'
import { BEATS, generate, hash, modLine, statOf } from './loot'

export const VERSION = 3
export const BASE = { lp: 20, atk: 3, def: 1 }
export const SLOTS: Slot[] = ['weapon', 'armor', 'skill']
const SPAWN_EVERY = 2
const QUEUE_MAX = 3
const BAG_MAX = 8
const ARENA = 14 // cells between you and the foe
const SPELL_EVERY = 3 // a skill's element spell fires every few rounds
const EDGE = 1.5 // damage when your element beats theirs
const BLUNT = 0.7 // damage when theirs beats yours
const CAPS: Record<Ability, number> = { resist: 75, absorb: 50, reflect: 75 }

const NO_SMELLS: Record<Smell, number> = { swallow: 0, leak: 0, dead: 0, debug: 0, insecure: 0, todo: 0 }
const CLEAN: Profile = { file: 'the entrance', lines: 0, counts: NO_SMELLS, power: 1, virtue: 0 }

export const FRESH: Game = {
  version: VERSION,
  run: 1, lp: BASE.lp, gear: { weapon: null, armor: null, skill: null }, threat: 1, steps: 0,
  profile: CLEAN, queue: [], fight: null, bag: [], menu: null, keepsake: null,
  event: { text: "You enter the dungeon empty-handed. Claude's work will lead you on.", tone: 'plain' },
}

const pad = (n: number, w: number) => String(Math.max(0, n | 0)).padStart(w, '0')
export const bar = (n: number, max: number, w: number) => {
  const full = Math.round((Math.max(0, Math.min(n, max)) / Math.max(1, max)) * w)
  return '#'.repeat(full) + '.'.repeat(w - full)
}
const base = (p: string) => p.split('/').pop() || p
const byLevel = (a: Item, b: Item) => b.ilvl - a.ilvl || (b.rarity > a.rarity ? 1 : -1)

// --- the hero, derived from gear --------------------------------------------------------------

export type Wards = Record<Ability, Record<Element, number>>
export type Stats = {
  atk: number; def: number; maxlp: number
  // the element each slot's prefix gave, and its value (a weapon's extra damage, a skill's spell)
  strike: { element: Element; value: number } | null
  guard: Element | null
  spell: { element: Element; value: number } | null
  // every suffix, summed per ability and element, capped
  wards: Wards
}

const noWards = (): Wards => ({
  resist: { fire: 0, ice: 0, arcane: 0 }, absorb: { fire: 0, ice: 0, arcane: 0 }, reflect: { fire: 0, ice: 0, arcane: 0 },
})

export function stats(g: Gear): Stats {
  const sum = (s: 'atk' | 'def' | 'hp') => SLOTS.reduce((n, slot) => n + statOf(g[slot], s), 0)
  const wards = noWards()
  for (const slot of SLOTS) {
    for (const w of g[slot]?.wards ?? []) wards[w.ability][w.element] = Math.min(CAPS[w.ability], wards[w.ability][w.element] + w.pct)
  }
  const armor = g.armor?.infusion
  return {
    atk: BASE.atk + sum('atk'),
    def: BASE.def + sum('def') + (armor?.value ?? 0),
    maxlp: BASE.lp + sum('hp'),
    strike: g.weapon?.infusion ?? null,
    guard: armor?.element ?? null,
    spell: g.skill?.infusion ?? null,
    wards,
  }
}

// how hard an element hits another: the cycle's edge, its bluntness, or even
export function edge(attack: Element | null, defend: Element | null): number {
  if (!attack || !defend) return 1
  return BEATS[attack] === defend ? EDGE : BEATS[defend] === attack ? BLUNT : 1
}

// the hero's elements in a few characters, for the status line: "/fire ]ice *arcane"
export function perks(s: Stats): string[] {
  return [
    s.strike && `/${s.strike.element}`, s.guard && `]${s.guard}`, s.spell && `*${s.spell.element}`,
  ].filter((p): p is string => Boolean(p))
}

// the suffixes in force, as "fire resist 30%  ice absorb 4%"
export function wardList(s: Stats): string[] {
  return (['resist', 'absorb', 'reflect'] as Ability[]).flatMap(a =>
    (['fire', 'ice', 'arcane'] as Element[]).filter(e => s.wards[a][e] > 0).map(e => `${e} ${a} ${s.wards[a][e]}%`))
}

export function describe(i: Item | null, slot: Slot): string {
  return i ? `${i.name} [${slot}, ilvl ${i.ilvl}] ${modLine(i)}` : `${slot}: empty`
}

// --- the code: what the scanner saw, and what it breeds ----------------------------------------

export function scan(file: string, content: string, totalLines?: number): Profile {
  const lines = totalLines || content.split('\n').length
  const a = analyze(content, lines, PROSE_RE.test(file), file)
  const c = a.counts
  return {
    file, lines, power: a.power, virtue: c.virtue,
    counts: {
      swallow: c.swallow, leak: c.leaks + c.weak, dead: c.dead, debug: c.debug,
      // injection in a doc is an attack on whoever reads it: it fights like unchecked input
      insecure: c.insecure + c.misconfig + c.container + c.inj, todo: c.todos,
    },
  }
}

// smells per hundred lines, plus the worst finding's weight, less the file's virtues:
// the slope of the threat curve
export function density(p: Profile): number {
  const total = Object.values(p.counts).reduce((a, b) => a + b, 0)
  const perHundred = p.lines ? (total * 100) / p.lines : 0
  return Math.max(0, Math.min(5, perHundred + (p.power - 1) * 0.3 - p.virtue * 0.2))
}

function breed(g: Game, salt: string, isBoss = false): Foe {
  const p = g.profile
  const smells = MONSTERS.filter(m => p.counts[m.smell] > 0)
  const t = g.threat * (isBoss ? 2.5 : 1)
  // weighted by count: the commonest smell breeds the most
  const total = smells.reduce((n, m) => n + p.counts[m.smell], 0)
  let r = total ? hash(`${salt}:${g.steps}:${g.run}`) % total : 0
  const kind = smells.find(m => (r -= p.counts[m.smell]) < 0) ?? TIDY
  const name = isBoss ? `the Commit Warden${kind === TIDY ? '' : `, ${kind.name} lord`}` : kind.name
  return {
    name, source: base(p.file), element: kind.element, isBoss, intro: kind.intro,
    hp: Math.round(kind.hp[0] + t * kind.hp[1]), atk: Math.round(kind.atk[0] + t * kind.atk[1]),
  }
}

// --- a fight, simulated whole, then cut into frames -------------------------------------------

// the arena row: you on the left, the foe on the right, a shot travelling between
function arena(foeGlyph: string, shot: { from: 'you' | 'foe'; at: number; glyph?: string } | null, hit: 'you' | 'foe' | null): string {
  const cells = Array.from({ length: ARENA }, () => ' ')
  if (shot) {
    const i = shot.from === 'you' ? shot.at : ARENA - 1 - shot.at
    cells[Math.max(0, Math.min(ARENA - 1, i))] = shot.glyph ?? (shot.from === 'you' ? '>' : '<')
  }
  return `${hit === 'you' ? '*' : '@'}${cells.join('')}${hit === 'foe' ? '*' : foeGlyph}`
}

// "fire>ice" when the attack has the edge, "fire<arcane" when it is blunted, "" when even
const matchup = (a: Element | null, d: Element | null) => {
  const m = edge(a, d)
  return m > 1 ? ` ${a}>${d}` : m < 1 ? ` ${a}<${d}` : ''
}

export function simulate(g: Game, foe: Foe): { frames: [string, string, string][]; won: boolean; lpAfter: number } {
  const me = stats(g.gear)
  const roll = (salt: string, n: number) => hash(`${salt}:${foe.name}:${g.steps}:${g.run}`) % n
  const glyph = foe.isBoss ? 'B' : 'm'
  let lp = Math.min(g.lp, me.maxlp)
  let hp = foe.hp
  // absorb and reflect pay out in whole points: small shares bank up across the fight
  let absorbBank = 0
  let reflectBank = 0
  const frames: [string, string, string][] = []
  const head = `${foe.name}${foe.isBoss ? ' (BOSS)' : ''}  [${foe.element ?? 'no element'}]  from ${foe.source}`
  const row = (mid: string) => `${pad(lp, 3)} [${bar(lp, me.maxlp, 8)}] ${mid} [${bar(hp, foe.hp, 8)}] ${pad(hp, 3)}`
  const still = (log: string) => { frames.push([head, row(arena(glyph, null, null)), log]) }
  // one blow, three frames: the wind-up, the shot in flight, the impact (numbers change on impact)
  const blow = (from: 'you' | 'foe', say: string, land: () => string, shotGlyph?: string) => {
    frames.push([head, row(arena(glyph, { from, at: 0, glyph: shotGlyph }, null)), say])
    frames.push([head, row(arena(glyph, { from, at: Math.floor(ARENA / 2), glyph: shotGlyph }, null)), say])
    const result = land()
    frames.push([head, row(arena(glyph, null, from === 'you' ? 'foe' : 'you')), result])
  }

  still(foe.isBoss ? 'a boss bars the way!' : foe.intro)
  for (let round = 1; lp > 0 && hp > 0 && round <= 12; round++) {
    const element = me.strike?.element ?? null
    blow('you', element ? `you strike with ${element}...` : 'you strike...', () => {
      const raw = me.atk + roll(`h${round}`, 3) + (me.strike?.value ?? 0)
      const hit = Math.max(1, Math.round(raw * edge(element, foe.element)))
      hp -= hit
      return `-${hit} to it${matchup(element, foe.element)}`
    })
    if (hp <= 0) break
    if (me.spell && round % SPELL_EVERY === 0) {
      const sp = me.spell
      blow('you', `you cast ${sp.element}...`, () => {
        const hit = Math.max(1, Math.round(sp.value * edge(sp.element, foe.element)))
        hp -= hit
        return `${sp.element} spell -${hit}${matchup(sp.element, foe.element)}`
      }, '~')
      if (hp <= 0) break
    }
    blow('foe', foe.element ? `it strikes with ${foe.element}...` : 'it strikes back...', () => {
      const parts: string[] = []
      const raw = Math.max(1, foe.atk + roll(`f${round}`, 2) - me.def)
      let dmg = Math.max(1, Math.round(raw * edge(foe.element, me.guard)))
      const e = foe.element
      if (e && me.wards.resist[e]) dmg = Math.max(1, Math.round(dmg * (1 - me.wards.resist[e] / 100)))
      lp -= dmg
      parts.push(`-${dmg} to you${matchup(e, me.guard)}${e && me.wards.resist[e] ? ` (resist ${me.wards.resist[e]}%)` : ''}`)
      if (e && me.wards.absorb[e]) {
        absorbBank += (dmg * me.wards.absorb[e]) / 100
        const heal = Math.floor(absorbBank)
        if (heal > 0 && lp > 0) { absorbBank -= heal; lp = Math.min(me.maxlp, lp + heal); parts.push(`absorb +${heal}`) }
      }
      if (e && me.wards.reflect[e]) {
        reflectBank += (dmg * me.wards.reflect[e]) / 100
        const back = Math.floor(reflectBank)
        if (back > 0) { reflectBank -= back; hp -= back; parts.push(`reflect -${back}`) }
      }
      return parts.join(', ')
    })
  }
  const won = hp <= 0 && lp > 0
  still(won ? `victory over the ${foe.name}!` : lp <= 0 ? 'you fall...' : 'it flees into the dark')
  return { frames, won, lpAfter: Math.max(0, lp) }
}

// --- the flow -------------------------------------------------------------------------------

function drop(g: Game, foe: Foe): Item {
  return generate({
    ilvl: Math.max(1, Math.round(g.threat * (foe.isBoss ? 1.5 : 1))),
    seed: `drop:${g.run}:${g.steps}:${foe.name}:${g.bag.length}`,
    against: foe.element, isBoss: foe.isBoss,
  })
}

// a death ends the run at once; the next run starts empty-handed while you pick one keepsake
function die(g: Game): Game {
  const all = [...SLOTS.map(s => g.gear[s]).filter((i): i is Item => i !== null), ...g.bag].sort(byLevel)
  return {
    ...FRESH, run: g.run + 1, profile: g.profile, steps: g.steps,
    keepsake: all.length ? all : null, menu: all.length ? { kind: 'keep', cursor: 0 } : null,
    event: { text: `Run ${g.run} ends. ${all.length ? 'Pick one item to carry on.' : 'You had nothing to carry.'}`, tone: 'red' },
  }
}

// an unpicked keepsake is settled before the next fight: the deepest item (listed first) goes with you
function settleKeepsake(g: Game): Game {
  return g.keepsake ? keep(g, 0) : g
}

export function keep(g: Game, i: number): Game {
  const item = g.keepsake?.[i]
  if (!item) return g
  const gear = { ...FRESH.gear, [item.slot]: item }
  return { ...g, keepsake: null, menu: null, gear, lp: stats(gear).maxlp, event: { text: `You carry ${item.name} into run ${g.run}.`, tone: 'cyan' } }
}

// --- the menu ---------------------------------------------------------------------------------

// what the open menu lists: a slot's equipped item first, then the bag's for that slot
export function entries(g: Game): Item[] {
  const m = g.menu
  if (!m) return []
  if (m.kind === 'keep') return g.keepsake ?? []
  const worn = g.gear[m.slot]
  return [...(worn ? [worn] : []), ...g.bag.filter(i => i.slot === m.slot).sort(byLevel)]
}

export function openMenu(g: Game, slot: Slot): Game {
  if (g.menu?.kind === 'keep') return g
  if (g.menu?.kind === 'gear' && g.menu.slot === slot) return { ...g, menu: null } // the same slot again closes it
  return { ...g, menu: { kind: 'gear', slot, cursor: 0 } }
}

export function point(g: Game, cursor: number): Game {
  if (!g.menu) return g
  const n = entries(g).length
  return { ...g, menu: { ...g.menu, cursor: Math.max(0, Math.min(n - 1, cursor)) } as Menu }
}

// e on an entry: keep it, or wear it (what you wore goes back into the bag)
export function choose(g: Game, i: number): Game {
  const m = g.menu
  if (!m) return g
  if (m.kind === 'keep') return keep(g, i)
  const item = entries(g)[i]
  const worn = g.gear[m.slot]
  if (!item || item.id === worn?.id) return { ...g, menu: null }
  const bag = [...g.bag.filter(b => b.id !== item.id), ...(worn ? [worn] : [])].sort(byLevel)
  const gear = { ...g.gear, [m.slot]: item }
  const lp = Math.min(stats(gear).maxlp, g.lp + Math.max(0, stats(gear).maxlp - stats(g.gear).maxlp))
  return { ...g, gear, bag, lp, menu: null, event: { text: `Equipped ${describe(item, m.slot)}`, tone: 'cyan' } }
}

// z on an entry: throw a bag item away; what you wear, or a keepsake, cannot be dropped
export function discard(g: Game, i: number): Game {
  const m = g.menu
  if (!m || m.kind !== 'gear') return g
  const item = entries(g)[i]
  if (!item) return g
  if (item.id === g.gear[m.slot]?.id) return { ...g, event: { text: `You cannot drop what you wear: equip another ${m.slot} first.`, tone: 'dim' } }
  const dropped = { ...g, bag: g.bag.filter(b => b.id !== item.id), event: { text: `Dropped ${item.name}.`, tone: 'dim' as const } }
  return point(dropped, i) // the cursor stays put, clamped to what is left
}

// a slot is worth a look when the bag holds a deeper item for it than what it wears
export function hasUpgrade(g: Game, slot: Slot): boolean {
  const worn = g.gear[slot]?.ilvl ?? 0
  return g.bag.some(i => i.slot === slot && i.ilvl > worn)
}

// start the next queued fight if none is playing
export function engage(g: Game): Game {
  const [foe, ...rest] = g.queue
  if (g.fight || !foe) return g
  const ready = settleKeepsake(g)
  const sim = simulate(ready, foe)
  return { ...ready, queue: rest, fight: { foe, ...sim, at: 0 } }
}

// the playback reached its end: apply the outcome
export function conclude(g: Game): Game {
  const f = g.fight
  if (!f) return g
  const after: Game = { ...g, fight: null, lp: f.lpAfter }
  if (!f.won) return f.lpAfter <= 0 ? engage(die(after)) : engage(after)
  const loot = drop(after, f.foe)
  const grow = 0.4 + density(after.profile) * 0.4 // dirtier code, steeper curve
  const me = stats(after.gear)
  const slotNo = SLOTS.indexOf(loot.slot) + 1
  const won: Game = {
    ...after, threat: after.threat + grow * (f.foe.isBoss ? 2 : 1),
    bag: [...after.bag, loot].sort(byLevel).slice(0, BAG_MAX),
    lp: Math.min(me.maxlp, after.lp + 2),
    event: { text: `Drop: ${describe(loot, loot.slot)}. Into the bag; press ${slotNo} to look.`, tone: loot.rarity === 'rare' ? 'yellow' : loot.rarity === 'magic' ? 'cyan' : 'plain' },
  }
  return engage(won)
}

export function enqueue(g: Game, foe: Foe): Game {
  return engage({ ...g, queue: [...g.queue, foe].slice(0, QUEUE_MAX) })
}

// Claude's tool calls drive the run: each one is a step; every few steps the code breeds a foe
export type Weather =
  | { kind: 'read'; file: string; content: string; totalLines?: number }
  | { kind: 'commit' } | { kind: 'tests'; passed: boolean } | { kind: 'step' }

export function advance(g: Game, w: Weather): Game {
  let s: Game = { ...g, steps: g.steps + 1 }
  if (w.kind === 'read') {
    s = { ...s, profile: scan(w.file, w.content, w.totalLines) }
    if (!s.fight && !s.keepsake) {
      const d = density(s.profile)
      s = { ...s, event: { text: `Claude reads ${base(w.file)}: ${d === 0 ? 'clean halls ahead.' : `the air turns foul (threat slope ${d.toFixed(1)}).`}`, tone: d === 0 ? 'green' : 'dim' } }
    }
  }
  if (w.kind === 'commit') return enqueue(s, breed(s, 'boss', true))
  if (w.kind === 'tests') {
    if (!w.passed) return enqueue(s, { ...breed(s, 'bug'), name: 'a bug from the failing tests', intro: 'The failing tests spit out a bug.' })
    const me = stats(s.gear)
    return { ...s, lp: Math.min(me.maxlp, s.lp + 5), event: s.fight ? s.event : { text: 'The tests pass: a fountain. +5 LP.', tone: 'green' } }
  }
  if (s.steps % SPAWN_EVERY === 0) return enqueue(s, breed(s, 'walk'))
  return s
}

// $.state outlives a reload: whatever an older build saved, start fresh on a version change
export function fix(raw: Partial<Game> | null | undefined): Game {
  return raw && raw.version === VERSION ? (raw as Game) : { ...FRESH }
}
