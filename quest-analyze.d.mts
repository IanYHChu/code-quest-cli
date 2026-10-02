// types for the scanner, as the mod (hooks/game.ts) calls it
export type AnalyzeCounts = {
  depth: number; godFile: number; longLines: number; todos: number; magic: number; dead: number
  debug: number; swallow: number; leaks: number; weak: number; insecure: number; misconfig: number
  container: number; maxSev: number; virtue: number; inj: number; cwes: string[]; rules: string[]
}
export type Analysis = {
  power: number; trapDensity: number; ambushBias: number; boonDensity: number; secrets: number
  len: number; seed: string; counts: AnalyzeCounts
}
export function analyze(content?: string, totalLines?: number, isProse?: boolean, path?: string): Analysis
