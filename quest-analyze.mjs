// Code Quest - the code-smell scanner: a single pass plus a few regexes over the file you just
// read, producing the next floor's profile. The ruleset itself (the pattern literals with their
// CWE ids, severities, linter rule ids) lives in quest-rules.mjs; this module only wires those
// patterns to counts, so unlike the catalog it carries no trigger strings of its own — it is
// scanned like any other file. All balance numbers come from CONFIG (quest-data.mjs).
import { CONFIG } from './quest-data.mjs';
import {
  SECRET_PATS, WEAKCRED_PATS, INSECURE_PATS, MISCONFIG_PATS, CONTAINER_PATS,
  RE_DEBT, RE_MAGIC, RE_DEAD, RE_DEBUG, RE_SWALLOW_LINE, RE_SWALLOW_BLOCK,
  VIRTUE_PATS, QUALITY_PATS, complexityCount, langTags, gateOk,
  injCount, noscanByName,
} from './quest-rules.mjs';

const clamp = (lo, hi, n) => Math.max(lo, Math.min(hi, n));

// floor length scales with file size
const laneLen = (totalLines) => clamp(CONFIG.lane.min, CONFIG.lane.max,
  CONFIG.lane.baseOffset + Math.floor((totalLines || 0) / CONFIG.lane.linesPerStep));

const ZERO_COUNTS = {
  depth: 0, godFile: 0, longLines: 0, todos: 0, magic: 0, dead: 0, debug: 0, swallow: 0,
  leaks: 0, weak: 0, insecure: 0, misconfig: 0, container: 0, maxSev: 0, virtue: 0, inj: 0,
  cwes: [], rules: [],
};

// the in-content opt-out marker, built by concatenation so this file MENTIONS the sentinel
// without CARRYING it (a literal would exempt this module from its own scan).
const SENTINEL = 'code-quest:' + 'noscan';

export function analyze(content = '', totalLines = 0, isProse = false, path = '') {
  const A = CONFIG.analyze;
  const text = String(content).slice(0, A.scanMaxBytes);   // latency guard: huge files are scanned by their head
  // opt out by filename (robust on partial reads) OR by the in-content sentinel (a `noqa`-style
  // marker). This is how the rule catalog avoids flagging itself on its own pattern strings.
  if (noscanByName(path) || text.includes(SENTINEL)) {
    return {
      power: 1, trapDensity: 0, ambushBias: 0, boonDensity: 0, secrets: 0,
      len: CONFIG.lane.base, seed: '', counts: { ...ZERO_COUNTS },
    };
  }
  // docs (.md/.txt/...) are easy floors: skip code-style smells. The only threat that matters in
  // untrusted prose is INDIRECT PROMPT INJECTION — content trying to hijack the agent reading it.
  if (isProse) {
    const inj = injCount(text);
    return {
      power: inj ? clamp(1, A.proseInjPowerMax, A.proseInjPowerBase + inj) : 1,
      trapDensity: 0,
      ambushBias: inj ? A.proseInjAmbushBias : 0,
      boonDensity: inj ? 0 : A.proseBoonDensity,                  // clean doc = calm, rewarding stroll
      secrets: 0, len: laneLen(totalLines), seed: '',
      counts: { ...ZERO_COUNTS, maxSev: inj ? 9 : 0, inj },
    };
  }
  const lines = text.split('\n');
  let maxIndent = 0, longLines = 0, todos = 0, magic = 0, dead = 0, debug = 0, swallow = 0;
  for (const line of lines) {
    const lead = (line.match(/^[ \t]*/) || [''])[0].replace(/\t/g, ' '.repeat(A.indentTab)).length;
    if (lead > maxIndent) maxIndent = lead;
    if (line.length > A.longLineLen) longLines++;
    if (line.length > A.scanMaxLineLen) continue;            // minified guard: monster lines skip pattern scans
    if (RE_DEBT.test(line)) todos++;
    if (RE_MAGIC.test(line)) magic++;
    if (RE_DEAD.test(line)) dead++;
    if (RE_DEBUG.test(line)) debug++;
    if (RE_SWALLOW_LINE.test(line)) swallow++;
  }
  // Full-text patterns get the same monster-line guard as the per-line scans above: the security/
  // quality regexes are unanchored, so on a miss .test() rescans from every offset — a single
  // hostile multi-KB line could stall the hook near O(n^2). Normal files pass through whole.
  const scanText = lines.some(l => l.length > A.scanMaxLineLen)
    ? lines.filter(l => l.length <= A.scanMaxLineLen).join('\n')
    : text;
  swallow += (scanText.match(RE_SWALLOW_BLOCK) || []).length;
  const depth = Math.floor(maxIndent / A.indentTab);                // nesting levels
  const godFile = totalLines > A.godFileLines ? 1 : 0;              // big file, likely unmodularized
  const scan = (pats) => {
    let n = 0, sev = 0;
    const cwes = [];
    for (const p of pats) {
      if (!p.re.test(scanText)) continue;
      n++;
      if (p.sev > sev) sev = p.sev;
      if (p.cwe) cwes.push(p.cwe);
    }
    return { n, sev, cwes };
  };
  const leaks = scan(SECRET_PATS), weak = scan(WEAKCRED_PATS), insec = scan(INSECURE_PATS);
  const misc = scan(MISCONFIG_PATS), cont = scan(CONTAINER_PATS);
  const secrets = leaks.n + weak.n;                                 // both kinds of credential sin spawn a $
  const maxSev = Math.max(leaks.sev, weak.sev, insec.sev, misc.sev, cont.sev); // worst single finding
  // distinct CWEs found, logged for /cq
  const cwes = [...new Set([...leaks.cwes, ...weak.cwes, ...insec.cwes, ...misc.cwes, ...cont.cwes])];
  const securityPower = Math.round(maxSev / CONFIG.power.severityDivisor); // 0-9 severity -> 0-5 power
  const structPower = Math.round(depth / CONFIG.power.depthDivisor) + godFile; // pain from sheer messiness
  const vhits = VIRTUE_PATS.reduce((n, re) => n + (re.test(scanText) ? 1 : 0), 0);
  const tidy = (depth <= A.tidyMaxDepth && totalLines >= A.tidyMinLines && totalLines <= A.tidyMaxLines)
    ? 1 : 0;                                                        // focused, shallow module earns a boon
  const virtue = vhits + tidy;                                      // good engineering -> boons
  // Tier A quality scan, gated by language. Each fired rule is recorded (id) for /cq and nudges
  // ambush/trap (never power). Presence-based: a rule fires once per file, like the debt/magic counters.
  const L = langTags(path);
  const rules = [];
  let qAmbush = 0, qTrap = 0;
  for (const q of QUALITY_PATS) {
    if (!gateOk(L, q.lang) || !q.re.test(scanText)) continue;
    rules.push(q.rule);
    if (q.kind === 'ambush') qAmbush++; else qTrap++;
  }
  // cognitively complex file (Sonar S3776, counted on code, not comments)
  if (complexityCount(scanText) >= A.complexityThreshold) { rules.push('S3776'); qAmbush++; }
  const counts = {
    depth, godFile, longLines, todos, magic, dead, debug, swallow,
    leaks: leaks.n, weak: weak.n, insecure: insec.n, misconfig: misc.n, container: cont.n,
    maxSev, virtue, inj: 0, cwes, rules,
  };
  return {
    // power is graded by the deadliest thing present
    power: clamp(CONFIG.power.min, CONFIG.power.max, Math.max(structPower, securityPower)),
    trapDensity: clamp(0, 1, depth / A.trapDepthDivisor + godFile * A.trapGodFileWeight
      + dead * A.trapDeadWeight + qTrap * A.trapQualityWeight),     // -> # count
    ambushBias: clamp(0, A.ambushCap, todos * A.ambushTodoWeight + longLines * A.ambushLongLineWeight
      + magic * A.ambushMagicWeight + swallow * A.ambushSwallowWeight + debug * A.ambushDebugWeight
      + misc.n * A.ambushMisconfigWeight + cont.n * A.ambushContainerWeight
      + qAmbush * A.ambushQualityWeight),                           // -> extra % on ambush rolls
    boonDensity: clamp(0, 1, virtue / A.boonDivisor),               // -> + boons (reward for clean code)
    secrets,                                                        // -> $ hazards (capped in genTrack)
    len: laneLen(totalLines),                                       // floor length scales with file size
    counts,                                                         // raw findings, logged for the report
    seed: '',                                                       // filled by caller
  };
}
