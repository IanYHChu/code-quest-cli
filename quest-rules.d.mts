// the exports of the ruleset the mod needs
export const PROSE_RE: RegExp
// one line-attributed finding of the nudge pass
export type Finding = {
  kind: 'security' | 'quality' | 'smell' | 'inj'
  ruleId: string; cwe?: string; cat?: string; sev: number; line: number; snippet: string
}
export function scanDetail(addedLines: { n: number; text: string }[], path: string): Finding[]
