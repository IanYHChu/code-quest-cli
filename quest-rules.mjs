// code-quest:noscan  (this module defines the smell patterns — don't let the scanner flag its own rules)
// Code Quest - the smell RULESET, shared by the game hook (quest-hook.mjs) and the nudge
// report (quest-nudge.mjs). One source of truth: the hook does a fast presence-based pass for
// floor generation; the nudge re-uses the very same patterns for a line-attributed pass over
// your commit diffs (scanDetail). Security rules carry a severity (0-9, CVSS-ish) + a MITRE CWE
// id; quality rules carry a canonical ESLint/SonarQube/clippy/PMD rule id.
import { CONFIG } from './quest-data.mjs';

const clamp = (lo, hi, n) => Math.max(lo, Math.min(hi, n));

export const SECRET_PATS = [
  { re: /AKIA[0-9A-Z]{16}/, sev: 9, cwe: 'CWE-798' },                                  // AWS access key id
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, sev: 9, cwe: 'CWE-798' },                // PEM private key
  { re: /(api[_-]?key|secret|passwd|password|token|access[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i, sev: 7, cwe: 'CWE-798' }, // assigned secret literal
  { re: /sk-[A-Za-z0-9]{20,}/, sev: 8, cwe: 'CWE-798' },                               // openai-style key
  { re: /ghp_[A-Za-z0-9]{36}/, sev: 8, cwe: 'CWE-798' },                               // github token
  { re: /['"][A-Za-z0-9+/]{40,}={0,2}['"]/, sev: 5, cwe: 'CWE-798' },                  // long base64-ish blob
];
export const INSECURE_PATS = [
  { re: /\b(MD5|SHA1|DES|RC4)\b/i, sev: 6, cwe: 'CWE-327' },                           // weak crypto
  { re: /\bECB\b|MODE_ECB|AES-\d+-ECB/, sev: 6, cwe: 'CWE-327' },                       // ECB block-cipher mode leaks structure
  { re: /http:\/\/(?!localhost|127\.0\.0\.1)/i, sev: 5, cwe: 'CWE-319' },              // plaintext transport
  { re: /\b0\.0\.0\.0\b/, sev: 6, cwe: 'CWE-1327' },                                   // bind on all interfaces
  { re: /verify\s*=\s*False|InsecureSkipVerify|rejectUnauthorized\s*:\s*false/i, sev: 7, cwe: 'CWE-295' }, // TLS verification disabled
  // eval / exec / dynamic Function = code injection. `exec(` must not be preceded by '.', or every
  // JS regex `.exec(` call would fire — Python's bare exec() still matches, and child_process exec
  // is covered by the CWE-78 pattern below.
  { re: /\beval\(|(?<!\.)\bexec\(|new Function\(/, sev: 7, cwe: 'CWE-95' },
  { re: /shell\s*=\s*True|\bos\.system\s*\(|child_process\.execSync?\s*\(/i, sev: 8, cwe: 'CWE-78' }, // shell/OS command injection surface
  { re: /(SELECT|INSERT|UPDATE|DELETE)\b[^\n;]*["']\s*\+|f["'][^"'\n]*\b(SELECT|INSERT|UPDATE|DELETE)\b/i, sev: 8, cwe: 'CWE-89' }, // string-built SQL
  { re: /\bpickle\.loads?\b|yaml\.load\((?![^)]*Loader)/, sev: 8, cwe: 'CWE-502' },    // unsafe deserialization
  { re: /\b(gets|strcpy|strcat|sprintf|scanf)\s*\(/, sev: 7, cwe: 'CWE-676' },         // C/C++ dangerous unbounded functions (buffer overflow)
  // --- Level 2: common web/app weaknesses (still single-pass regex, low-FP, deterministic) ---
  { re: /dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\(|\bv-html\b/i, sev: 6, cwe: 'CWE-79' }, // XSS sink
  { re: /(readFile(Sync)?|createReadStream|sendFile|fopen|open)\s*\([^)]*\b(req|request|params|query|argv|userInput)\b/i, sev: 7, cwe: 'CWE-22' }, // path traversal (user input into a file path)
  { re: /(requests\.(get|post)|axios|fetch|urlopen|http\.get)\s*\([^)]*\b(req\.|request\.|params|\.query|userInput)\b/i, sev: 7, cwe: 'CWE-918' }, // SSRF (user-controlled outbound URL)
  { re: /resolve_entities\s*=\s*True|noent\s*=\s*True|external_general_entities\s*=\s*True|external-general-entities[^\n]{0,20}true/i, sev: 8, cwe: 'CWE-611' }, // XXE (external entities enabled)
  { re: /@?csrf_exempt|csrf\s*[:=]\s*(false|off)|csrfProtection\s*:\s*false|WTF_CSRF_ENABLED\s*=\s*False/i, sev: 6, cwe: 'CWE-352' }, // CSRF protection disabled
  { re: /(token|password|secret|nonce|salt|otp|session[_-]?id|api[_-]?key)\b[^\n]{0,40}(Math\.random|random\.random\(|\brand\(|mt_rand\()/i, sev: 5, cwe: 'CWE-330' }, // weak RNG for a security value
  { re: /httponly\s*[:=]\s*false/i, sev: 4, cwe: 'CWE-1004' },                          // session cookie missing HttpOnly
];
// default / weak credentials and placeholder keys -> these also spawn a $ hazard
export const WEAKCRED_PATS = [
  { re: /(password|passwd|pwd)\s*[:=]\s*["'](admin|root|password|123456|12345678|changeme|hunter2|test|guest|default)["']/i, sev: 7, cwe: 'CWE-1392' }, // use of default credentials
  { re: /(secret|secret[_-]?key|api[_-]?key|token)\s*[:=]\s*["'](changeme|change[_-]?me|placeholder|your[_-]?\w+|x{3,}|test|dev|secret|todo)["']/i, sev: 5, cwe: 'CWE-798' }, // hardcoded placeholder key
];
// dangerous agent/gateway misconfig flags. Patterns generalized from OpenClaw's gateway
// security guide (docs.openclaw.ai/gateway/security) but match any tool using these idioms.
export const MISCONFIG_PATS = [
  { re: /dangerously[A-Za-z]+\s*[:=]\s*true/i, sev: 8, cwe: 'CWE-1188' },              // dangerouslyAllow* / dangerouslyDisable* enabled
  { re: /allow(Insecure|Unsafe)[A-Za-z]*\s*[:=]\s*true/i, sev: 7, cwe: 'CWE-1188' },   // allowInsecureAuth / allowUnsafeExternalContent
  { re: /(permissionMode|security)\s*[:=]\s*["']?(approve-all|full)\b/i, sev: 7, cwe: 'CWE-732' }, // approve-all perms / exec security "full"
  { re: /\b(sandbox|deviceAuth)\b[^\n]{0,40}[:=]\s*["']?(off|false)\b/i, sev: 8, cwe: 'CWE-693' }, // sandbox off / device auth disabled
  { re: /workspaceOnly\s*[:=]\s*false/i, sev: 6, cwe: 'CWE-668' },                     // fs/patch tools escape the workspace
  { re: /redactSensitive\s*[:=]\s*["']?off\b/i, sev: 4, cwe: 'CWE-532' },              // logs leak unredacted output
  { re: /(dm|group)Policy\s*[:=]\s*["']?open\b/i, sev: 5, cwe: 'CWE-732' },            // open DM/group policy
  { re: /ALLOW_INSECURE|dangerouslyDisableSandbox/i, sev: 8, cwe: 'CWE-693' },         // break-glass insecure env / sandbox kill switch
  { re: /\bcurl\b[^\n|]*\|\s*(sudo\s+)?(sh|bash)\b/i, sev: 7, cwe: 'CWE-494' },        // curl | sh (download+run without integrity check)
];
// lightweight container/k8s/docker misconfig. Patterns + severities from the jibrilCon
// container-config rules engine (kubernetes_pod_rules.json, docker_config_rules.json).
export const CONTAINER_PATS = [
  { re: /privileged\s*[:=]\s*true/i, sev: 9, cwe: 'CWE-250' },                         // privileged container = host device access
  { re: /\bhost(PID|Network|IPC)\s*:\s*true/i, sev: 8, cwe: 'CWE-653' },               // host namespace sharing (broken isolation)
  { re: /allowPrivilegeEscalation\s*:\s*true/i, sev: 7, cwe: 'CWE-250' },              // setuid privilege escalation
  { re: /runAsUser\s*:\s*0\b|runAsNonRoot\s*:\s*false/i, sev: 7, cwe: 'CWE-250' },     // runs as root (UID 0)
  { re: /\/var\/run\/docker\.sock/, sev: 9, cwe: 'CWE-668' },                          // docker socket mount = host takeover
  { re: /hostPath:[\s\S]{0,60}path:\s*["']?\/(proc|sys|dev|etc|root|var\/run)\b/i, sev: 9, cwe: 'CWE-668' }, // dangerous host path mount
  { re: /capabilities:[\s\S]{0,80}(SYS_ADMIN|SYS_PTRACE|SYS_MODULE|NET_ADMIN)/i, sev: 8, cwe: 'CWE-250' }, // dangerous capabilities
  { re: /seccompProfile:[\s\S]{0,40}type:\s*Unconfined/i, sev: 6, cwe: 'CWE-693' },    // seccomp disabled
  { re: /FROM\s+\S+:latest|image:\s*["']?\S+:latest/i, sev: 5, cwe: 'CWE-1357' },      // unpinned :latest image
  { re: /^\s*USER\s+root\b/im, sev: 6, cwe: 'CWE-250' },                               // dockerfile runs as root
];
export const RE_DEBT = /\b(TODO|FIXME|HACK|XXX)\b|@ts-ignore|@SuppressWarnings|#\s*type:\s*ignore|#\s*noqa|\/\/\s*nolint|#\[allow\(/; // tech-debt + warning-suppression markers (ts/java/py/go/rust)
// bare magic numbers. magicDigits is clamped + the build is guarded: a bad user config value must
// never throw at import time (that would error the hook on every tool call).
let _magic;
try { _magic = new RegExp('[^.\\w]\\d{' + clamp(2, 9, CONFIG.analyze.magicDigits | 0) + ',}\\b'); }
catch { _magic = /[^.\w]\d{4,}\b/; }
export const RE_MAGIC = _magic;
export const RE_DEAD = /^\s*(\/\/|#)\s*(if|for|while|return|function|def|class|const|let|var)\b/; // commented-out code
export const RE_DEBUG = /console\.(log|debug)|(^|[^\w.])print\(|\bdebugger\b|var_dump|System\.out\.print|fmt\.Print|\bdd\(/; // debug leftovers
export const RE_SWALLOW_LINE = /except[^\n:]*:\s*pass|except\s*:/;         // swallowed exception (python)
export const RE_SWALLOW_BLOCK = /catch\s*\([^)]*\)\s*\{\s*\}/g;            // empty catch block (js/java)
// good-engineering signals -> these grow boons (+), NOT hazards. Reward tracks virtue, never debt.
export const VIRTUE_PATS = [
  /\b(describe|it|test)\s*\(|def test_|\bassert\b|expect\(|@Test\b/,                 // has tests
  /\)\s*:\s*[A-Za-z]|->\s*[A-Za-z]|:\s*(string|number|boolean|int|str|float|bool|List|Dict)\b/, // type annotations
  /\/\*\*|"""|'''/,                                                                  // doc comments / docstrings
  /\b[A-Z][A-Z0-9_]{3,}\s*[:=]/,                                                     // named constants
  /catch\s*\([^)]*\)\s*\{[^}]*\b(log|logger|console|throw|report|return)\b|except[^\n:]*:\s*\n\s*[^\sp]/, // errors handled, not swallowed
];

// language dimension: a quality rule only makes sense in some languages (== / var / any would
// false-fire on Python/Go/Rust). We branch on the file extension, mirroring the prose-vs-code split.
// Covers the common set: js/ts, python, go, rust, c/c++, java. Unknown extensions only get 'any' rules.
export function langTags(path) {
  const p = String(path || '');
  const isTs = /\.tsx?$/i.test(p);                                   // .ts / .tsx
  const isJs = isTs || /\.(c|m)?jsx?$/i.test(p);                     // .js/.jsx/.mjs/.cjs/.ts/.tsx
  const isPy = /\.pyi?$/i.test(p);
  const isGo = /\.go$/i.test(p);
  const isRust = /\.rs$/i.test(p);
  const isJava = /\.java$/i.test(p);
  const isC = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(p);             // C / C++ / headers
  return { isJs, isTs, isPy, isGo, isRust, isJava, isC };
}
// does a rule's language gate apply to this file's tags? ('js' -> isJs, 'rust' -> isRust, ...)
export const gateOk = (tags, gate) => gate === 'any' || tags['is' + gate[0].toUpperCase() + gate.slice(1)] === true;
// Tier A code-quality smells. Like the security rules carry a CWE, each carries an ESLint/SonarQube/
// clippy/PMD rule id — surfaced in /cq so a finding reads as a named, canonical rule. These feed
// ambush/trap density (kind), NEVER `power` (power is reserved for genuine danger). `lang` gates a rule
// to the file types where it's meaningful ('any' = every code language).
export const QUALITY_PATS = [
  { re: /[^=!<>](==|!=)[^=]/, rule: 'eqeqeq', lang: 'js', kind: 'trap' },             // loose equality (JS/TS only; == is correct elsewhere)
  { re: /\bvar\s+[A-Za-z_$]/, rule: 'no-var', lang: 'js', kind: 'ambush' },           // var instead of let/const (NOT Go/Java, where var is idiomatic)
  { re: /:\s*any\b|<any>|\bas any\b/, rule: 'no-explicit-any', lang: 'ts', kind: 'ambush' }, // explicit any weakens types
  { re: /\.unwrap\(\)|\.expect\(|\bpanic!\(/, rule: 'clippy::unwrap_used', lang: 'rust', kind: 'ambush' }, // Rust: panicking on Option/Result
  { re: /\bpanic\(/, rule: 'revive:deep-exit', lang: 'go', kind: 'ambush' },          // Go: panic in library code
  { re: /\.printStackTrace\s*\(/, rule: 'PMD:AvoidPrintStackTrace', lang: 'java', kind: 'ambush' }, // Java: swallow-ish error handling
  // cross-language (gated 'any'): the keyword/idiom set covers def/function/fn/func and braced bodies
  { re: /\b(it|test|describe)\.(only|skip)\b|\bx(it|describe)\s*\(|\bf(it|describe)\s*\(|@(Ignore|Disabled)\b|pytest\.mark\.skip|\bt\.Skip\(|#\[ignore\]|\bDISABLED_\w/, rule: 'no-disabled-tests', lang: 'any', kind: 'ambush' }, // skipped / focused tests (jest/pytest/JUnit/go/rust/gtest)
  // long parameter list (>=6): JS/Py/Rust/Go + braced (C/C++/Java). Segments are bounded and
  // mutually exclusive ([^(),\n]{0,120},) so the regex stays linear on long unclosed lines (no ReDoS).
  { re: /\b(function\s+\w*|def\s+\w+|fn\s+\w+|func[^(\n]{0,40})\s*\(([^(),\n]{0,120},){5,}|\(([^(),\n]{0,120},){5,}[^(),\n]{0,120}\)\s*(=>|\{)/, rule: 'S107', lang: 'any', kind: 'trap' },
];
// branch points -> cognitive-complexity proxy (Sonar S3776). Covers C-family (if/for/while/case),
// Python (elif/and/or), Rust/Go (match/switch) and short-circuit/ternary operators.
export const RE_COMPLEXITY = /\b(if|elif|for|while|case|catch|match|switch)\b|&&|\|\||\band\b|\bor\b|\?[^.?\s]/g;
// Complexity is counted on a comment-stripped copy: English prose is full of if/and/or, so a
// well-documented file would otherwise be inflated into a "complex" one. Only `//` and `#` line
// comments (whole-line or preceded by whitespace) are stripped — URLs (`https://`) survive, and a
// rare '#' inside a string costs at most a miscount in a heuristic, never a wrong scan elsewhere.
const RE_LINE_COMMENT = /(^|\s)(\/\/|#).*$/gm;
export const complexityCount = (text) =>
  (String(text).replace(RE_LINE_COMMENT, '$1').match(RE_COMPLEXITY) || []).length;

// indirect prompt-injection lexicon — reused for both YOUR prompts and untrusted doc content.
export const INJ_CONTROL = /\b(ignore|disregard|override|forget|bypass|disable|reset)\b/i;
export const INJ_TARGET = /\b(instructions?|prompt|rules|guidelines|filters?|system prompt)\b/i;
export const INJ_JAILBREAK = /\b(sudo mode|admin mode|developer mode|dev mode|DAN|do anything now|unrestricted|jailbreak)\b/i;
export const INJ_FAKETAG = /<\/?system>|<\/?assistant>|<\|im_start\|>|<<SYS>>|\[INST\]/i;
export const INJ_NEG = /\b(don'?t|do not|never|不要|別|勿)\s+\w{0,8}\s*(ignore|disregard|bypass|override)/i;
export const INJ_BENIGN = /```|\b(don'?t|do not|never|不要|別|勿)\s+\w{0,8}\s*(ignore|disregard|bypass|override)/i; // for YOUR prompts: pasted code / negation = not an attack
export function injCount(text) {                                          // strong injection signals in untrusted content
  let n = 0;
  if (INJ_CONTROL.test(text) && INJ_TARGET.test(text) && !INJ_NEG.test(text)) n++;
  if (INJ_JAILBREAK.test(text)) n++;
  if (INJ_FAKETAG.test(text)) n++;
  return n;
}

// prose files (.md/.txt/...) are scanned only for indirect prompt injection, never code smells
export const PROSE_RE = /\.(md|markdown|mdx|txt|rst|adoc|org)$/i;

// a file's BASENAME can opt out of scanning (config: scan.noscanFiles globs). Filename-based works
// even on a partial/offset read, unlike the in-content sentinel below (which a slice can miss).
const NOSCAN_RE = (CONFIG.scan.noscanFiles || []).map(g =>
  new RegExp('^' + String(g).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
export const baseName = (p) => String(p || '').split(/[\\/]/).pop();
export const noscanByName = (p) => { const b = baseName(p); return NOSCAN_RE.some(re => re.test(b)); };

// ---------------------------------------------------------------------------------------------
// scanDetail — the nudge report's line-attributed pass (NOT used by the game's hot path).
// Input: the ADDED lines of one file from a commit diff, as [{ n, text }] where n is the
// new-file line number. Output: one finding per (rule, line):
//   { kind: 'security'|'quality'|'smell'|'inj', ruleId, cwe?, cat?, sev, line, snippet }
// kind 'security' also carries cat (leaks|weak|insecure|misconfig|container) so the report can
// reuse the per-bucket fix tips from STR.report.smells. File-level structural metrics (god file,
// nesting depth, S3776 complexity) are deliberately absent: they can't be judged fairly from a
// partial diff, only from the whole file (the game's analyze() still covers those).
const SECURITY_LISTS = [
  { cat: 'leaks', pats: SECRET_PATS },
  { cat: 'weak', pats: WEAKCRED_PATS },
  { cat: 'insecure', pats: INSECURE_PATS },
  { cat: 'misconfig', pats: MISCONFIG_PATS },
  { cat: 'container', pats: CONTAINER_PATS },
];
const SMELL_LINE_RULES = [
  { key: 'todos', re: RE_DEBT },
  { key: 'magic', re: RE_MAGIC },
  { key: 'dead', re: RE_DEAD },
  { key: 'debug', re: RE_DEBUG },
  { key: 'swallow', re: RE_SWALLOW_LINE },
];
// patterns that can span lines get a second pass over each contiguous run of added lines,
// with the match offset converted back to a real line number
const BLOCK_PATS = [
  { re: RE_SWALLOW_BLOCK, kind: 'smell', ruleId: 'swallow', sev: 0 },
  ...CONTAINER_PATS.filter(p => p.re.source.includes('[\\s\\S]'))
    .map(p => ({ re: p.re, kind: 'security', cat: 'container', ruleId: p.cwe, cwe: p.cwe, sev: p.sev })),
];

export function scanDetail(addedLines, path) {
  if (noscanByName(path)) return [];
  const A = CONFIG.analyze;
  const lines = (addedLines || []).filter(l => l && typeof l.text === 'string');
  if (lines.some(l => l.text.includes('code-quest:noscan'))) return []; // in-content opt-out sentinel
  const out = [], seen = new Set();
  const snipLen = CONFIG.nudge.snippetLen;
  const push = (f, line, text) => {
    const k = f.ruleId + ':' + line;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ ...f, line, snippet: String(text).trim().slice(0, snipLen) });
  };
  if (PROSE_RE.test(path)) {                                       // docs: injection is the only threat
    for (const { n, text } of lines) if (injCount(text) > 0) push({ kind: 'inj', ruleId: 'inj', sev: 9 }, n, text);
    return out;
  }
  const tags = langTags(path);
  for (const { n, text } of lines) {
    if (text.length > A.scanMaxLineLen) continue;                  // minified guard: monster lines skip pattern scans
    for (const { cat, pats } of SECURITY_LISTS)
      for (const p of pats) if (p.re.test(text)) push({ kind: 'security', cat, ruleId: p.cwe, cwe: p.cwe, sev: p.sev }, n, text);
    for (const q of QUALITY_PATS)
      if (gateOk(tags, q.lang) && q.re.test(text)) push({ kind: 'quality', ruleId: q.rule, sev: 0 }, n, text);
    for (const r of SMELL_LINE_RULES) if (r.re.test(text)) push({ kind: 'smell', ruleId: r.key, sev: 0 }, n, text);
    if (text.length > A.longLineLen) push({ kind: 'smell', ruleId: 'longLines', sev: 0 }, n, text);
  }
  // contiguous added runs -> block patterns (empty catch {}, k8s blocks split across lines)
  const runs = [];
  let cur = null;
  for (const l of lines) {
    if (cur && l.n === cur.end + 1) { cur.lines.push(l); cur.end = l.n; }
    else { cur = { start: l.n, end: l.n, lines: [l] }; runs.push(cur); }
  }
  for (const r of runs) {
    const text = r.lines.map(l => l.text).join('\n');
    if (text.length > A.scanMaxBytes) continue;
    for (const b of BLOCK_PATS) {
      const re = new RegExp(b.re.source, b.re.flags.replace('g', '')); // fresh, non-sticky copy
      const m = re.exec(text);
      if (!m) continue;
      const line = r.start + text.slice(0, m.index).split('\n').length - 1;
      const src = r.lines[line - r.start];
      push({ kind: b.kind, cat: b.cat, ruleId: b.ruleId, cwe: b.cwe, sev: b.sev }, line, src ? src.text : m[0]);
    }
  }
  return out;
}
