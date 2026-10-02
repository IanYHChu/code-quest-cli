// types for the pure config layer, as the mod (hooks/nudge.ts, hooks/sheet.ts) reads it
type Tool = { name: string; url: string; note: string }
type SmellRow = { bucket: string; key: string; label: string; tip: string }
export const CONFIG: {
  nudge: { commits: number; maxCommits: number; maxPerCommit: number; maxLinesPerFile: number; snippetLen: number }
  [k: string]: unknown
}
export const STR: {
  report: { smells: SmellRow[]; cweNames: Record<string, string>; ruleNames: Record<string, string>; [k: string]: unknown }
  nudge: {
    title: string; subtitle: string; disclaimer: string[]; notRepo: string; noCommits: string; badRev: string
    reviewing: string; reviewingRev: string; anyAuthor: string; usageHint: string; commitClean: string
    truncated: string; legacyNote: string; summaryTitle: string; summaryLine: string; summaryClean: string
    topRules: string; proTitle: string; proTools: Tool[]; sarifHint: string
    sev: { high: string; med: string; low: string; note: string }
  }
  [k: string]: unknown
}
export function fmt(tpl: string, vars?: Record<string, string | number>): string
export function stripCtl(s: unknown): string
