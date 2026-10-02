<!-- code-quest:noscan (this doc quotes the smell patterns; don't let the scanner flag it) -->
# Code Quest

A gear-driven roguelike that plays itself in a three-row band above your Claude Code prompt while
you work. Claude's tool calls drive the run, and **the monsters are bred from your code's smells**:
every file Claude reads is scanned, and what the scanner finds is what steps out to fight you.
Read a clean module and only tidy imps wander the halls. Read a file full of swallowed errors
and a hardcoded AWS key, and wraiths and slimes come for you.

```
╭─╮ ╭─╮ ╭─╮   swallowed-error wraith  [fire]  from api.ts        LP  017/024
│/│ │]│ │-│   017 [######..] >       m [###.....] 004            ATK 006  DEF 003
╰─╯ ╰─╯ ╰─╯   -5 to it fire>ice                                  /fire ]ice
```

**The game never spends your tokens.** It is a Claude Code mod: function hooks that run inside
Claude Code, react to the tool calls the session already makes, and draw in the band. Nothing is
sent to the model. Only the slash commands put text in the transcript, and only when you run them.

## Install

Inside Claude Code:

```
/plugin marketplace add IanYHChu/code-quest-cli
/plugin install code-quest@code-quest-cli
```

The marketplace lives in this repository; the plugin itself is fetched from npm
([`code-quest-cli`](https://www.npmjs.com/package/code-quest-cli)), so each release is a versioned
package. To run a checkout instead, load the folder: `claude --plugin-dir ./code-quest` (or name it
in `CLAUDE_CODE_PLUGIN_DIRS` to load it in every session).

**Coming from the status-line version (0.1)?** That one was installed by an npm CLI that patched
`settings.json`. Remove it first, so its hooks stop running on every tool call:

```bash
npx code-quest-cli@0.1.0 uninstall --purge   # restores your status line, removes its hooks, commands and save
```

The old save does not carry over: levels and relics are gone from the game. (`npx code-quest-cli`
without a version now only prints these instructions.)

## The band

- **Left: three gear slots.** `1` weapon, `2` armor, `3` skill. A slot lights yellow when the bag
  holds something stronger for it.
- **Middle: what is happening.** The current fight, blow by blow, or the latest event; or an
  open slot menu.
- **Right: the hero.** LP, ATK and DEF, and the element each slot grants (`/` weapon, `]` armor,
  `*` skill).

There are no levels. Your power is your gear.

## How the run moves

All on its own. You keep working; Claude's work is the run.

| What happens in the session | What happens in the dungeon |
| --- | --- |
| every second tool call | a foe steps out and fights you |
| Claude reads a file | that file's smells breed the next foes; dirtier code, faster-growing foes |
| tests fail | a bug from the failing tests attacks |
| tests pass | a fountain: +5 LP |
| `git commit` | a boss rises: the Commit Warden |
| you win a fight | an item drops into the bag (8 at most) and you heal 2 |

Fights resolve automatically and are animated blow by blow: your strike, your skill's spell every
third round, the foe's answer. When LP hits 0 the run ends at once: pick one item to carry into
the next run (`e` keeps it), and go on.

## Gear

Press `1`, `2` or `3` (or click the slot) to open that slot's menu in the middle zone: `q`
previous, `a` next, `e` equip, `z` drop. Press the slot again to close it. Letters, not arrows:
the prompt keeps the arrow keys.

Items are rolled Diablo II style from the tables in `data/`:

- **Rarity:** normal (plain), magic (blue), rare (yellow). Rarity sets how many affixes it rolls.
- **Prefix (at most one): the element.** On a weapon, extra damage of that element on every hit;
  on armor, your defending element and extra DEF; on a skill, a spell of that element every few
  rounds.
- **Suffixes: an ability against one element**, with a rolled percent: resist cuts that damage,
  absorb heals you a share of it, reflect sends a share back.

Elements cycle: **fire beats ice, ice beats arcane, arcane beats fire** (1.5x damage with the
edge, 0.7x against it). Drops favor what answers the foe that dropped them.

## The monsters are your tech debt

A foe's kind comes from a smell in the file Claude last read, weighted by how often it appears,
and its element from the smell's kind: runtime trouble burns, stale debt freezes, security holes
are dark magic.

| Smell | How it's detected | Breeds | Element |
| --- | --- | --- | --- |
| **Swallowed exceptions** | empty `catch (e) {}`, `except: pass`, bare `except:` | swallowed-error wraith | fire |
| **Debug leftovers** | `console.log` `print(` `debugger` `var_dump` `System.out.print` `fmt.Print` `dd(` | debug-print swarm | fire |
| **Commented-out dead code** | comment lines starting with `if/for/return/function/def/…` | dead-code revenant | ice |
| **Tech-debt / suppression markers** | `TODO` `FIXME` `HACK` `XXX`, and `@ts-ignore` `@SuppressWarnings` `# type: ignore` `# noqa` `//nolint` `#[allow(` | TODO trapper | ice |
| **Hardcoded secrets, weak credentials** | AWS key, PEM private key, `password=`/`api_key=` literals, `sk-…`, `ghp_…`, long base64 blobs; `password="admin"`, `secret="changeme"` | leaking-secret slime | arcane |
| **Insecure code, dangerous config, container misconfig, prompt injection** | weak crypto, plaintext `http://`, disabled TLS verify, `eval(`, shell injection, string-built SQL, unsafe deserialization; `dangerously*: true`, `sandbox: off`, `curl … \| sh`; `privileged: true`, `runAsUser: 0`, `docker.sock` mounts; injection phrases in docs | unchecked-input brute | arcane |

A file with none of these breeds only tidy imps: no element, the weakest numbers.

**How fast the foes grow** is set by how dirty the code is: smells per hundred lines, plus the
weight of the worst finding, less the file's virtues (tests, type annotations, doc comments,
named constants, handled errors). Every win raises the threat; a dirty file raises it faster.

Each security finding carries a **severity (0–9, CVSS-ish)** borrowed from the
[jibrilCon](https://github.com/IanYHChu/jibrilCon) rules engine, **plus a [MITRE CWE](https://cwe.mitre.org/)
id**: string-built SQL is CWE-89, weak crypto CWE-327, a hardcoded secret CWE-798, `eval(` CWE-95,
`privileged: true` CWE-250, and so on. The ruleset also covers XSS, SSRF, path traversal, XXE,
CSRF, weak RNG and C/C++ dangerous functions (`gets`/`strcpy`/`sprintf`, CWE-676).

**Documents are safe ground, except for injection.** In prose files (`.md` `.markdown` `.mdx`
`.txt` `.rst` `.adoc` `.org`) the only thing scanned is **indirect prompt injection**: content
trying to hijack the agent reading it (`ignore all previous instructions`, fake `<system>`/`[INST]`
tags, jailbreak personas). It fights like unchecked input. The lesson: treat document content as
untrusted data, never as instructions.

`/cq` shows the smells breeding your current foes, and how to fix each one.

### Language-aware code-quality smells

The scanner also flags **maintainability smells**, each tagged with a canonical
**ESLint / SonarQube / clippy / PMD rule id**. They do not breed monsters. They show up in
`/cq-nudge`. Each rule fires only for the languages where it makes sense, decided by file
extension:

| Rule (id) | Fires in | What it catches |
| --- | --- | --- |
| `eqeqeq` | js/ts only | loose `==` / `!=` (correct in Python/Go/C/Rust) |
| `no-var` | js/ts only | `var` (idiomatic in Go/Java, *not* flagged there) |
| `no-explicit-any` | ts only | `: any` weakening the type system |
| `clippy::unwrap_used` | rust | `.unwrap()` / `.expect()` / `panic!` |
| `revive:deep-exit` | go | `panic(` in library code |
| `PMD:AvoidPrintStackTrace` | java | `.printStackTrace()` |
| `no-disabled-tests` | all | skipped/focused tests (jest/pytest/JUnit/go/`#[ignore]`/gtest) |
| `S107` | all | long parameter lists (≥6), across def/function/fn/func |

## Commands

| Command | What it does |
| --- | --- |
| `/cq` | opens the full sheet in a pane: gear, wards, the bag, the smells breeding your foes with a fix tip for each, and what is queued |
| `/cq-nudge [count \| commit \| A..B] [--all] [--sarif]` | gentle pointers from your own recent commits (below) |
| `/cq-reroll` | asks first, then starts over at run 1 with nothing |
| `/cq-help` | how to play |

## Commit nudges: `/cq-nudge`

`/cq` is the game's view of the code Claude is reading. **`/cq-nudge` steps out of the game** and
answers a more practical question: *"in the code I just shipped, what could I have done better?"*
It re-scans the **added lines of your own recent commits** (local `git show`, zero tokens, nothing
leaves your machine) with the same ruleset, and lists each hit as a **nudge**: file, **exact line
number**, the canonical rule id (MITRE CWE for security, ESLint/SonarQube/clippy/PMD for quality),
the offending line, and a one-line fix tip:

```
a1b2c3d  add login endpoint  (2026-06-10)
   src/auth.js:42  [HIGH] CWE-798  Use of Hard-coded Credentials
       | const password = "hunter2";
       -> move to env vars or a secret manager, and rotate the leaked key
```

- **You answer only for your own commits.** By default it reviews commits authored by your
  `git config user.email` (`--all` widens to everyone, `/cq-nudge 10` looks further back). Git
  history is the database, so **any commit is scannable**: name one (`/cq-nudge abc1234`) or a
  range (`/cq-nudge main..HEAD`); a named commit is reviewed as asked, author filter off. The legacy
  code *around* your diff is out of scope, the same "you're responsible for the code you add"
  idea SonarQube calls [Clean as You Code](https://docs.sonarsource.com/sonarqube/latest/core-concepts/clean-as-you-code/).
- **It is honest about being a toy.** Regex heuristics, fast and deterministic, but no type or
  data-flow analysis, so **false positives happen and real issues get missed**. The report says so
  up front, frames every hit as *a question worth a look*, and ends with the professional tools to
  reach for: Semgrep, CodeQL, SonarQube, gitleaks, Trivy, and your language's linter.
- **`--sarif` exports [SARIF 2.1.0](https://sarifweb.azurewebsites.net/)**, so a run can be opened
  in a VS Code SARIF viewer or uploaded to GitHub code scanning. The disclaimer travels inside the
  file (`tool.driver.fullDescription`).

## Your run and your privacy

**Your run is saved** in the plugin's own store (a JSON file under your Claude Code configuration
directory), so it carries across sessions. Each session picks up the saved run when it starts; with
several sessions open at once, the last one to change the run wins.

**Everything stays on your machine:** no network calls, no telemetry. The mod sees only what Claude
Code already hands it (tool calls and their results), and keeps only the run: your gear, bag and
LP, and the smell counts and path of the file Claude last read.

## Making it your own

The game's content is data, not logic, so adding to it is editing a table:

- `data/items.ts`: item bases per slot, with their stat ranges and item-level gates.
- `data/affixes.ts`: element prefixes, ability suffixes and the rare-name pool.
- `data/monsters.ts`: what each smell breeds, its element, intro line and stat curve.

`hooks/content.test.ts` validates the tables, so a malformed entry fails the tests instead of the
game. The game's own numbers (base stats, spawn rate, bag size, the element edge) are at the top
of `hooks/game.ts`. The scanner's numbers and the report text live in `quest-config.mjs`; the smell
patterns themselves (the ruleset, shared by the game and `/cq-nudge`) in `quest-rules.mjs`.

## Development

```bash
claude plugin validate .   # what the module hooks and calls, and what the engine would refuse
claude plugin test .       # the hooks/*.test.ts suite, run against the engine itself
```

A release bumps the version in both `package.json` and `.claude-plugin/plugin.json`, then
`npm publish` (the `prepublishOnly` script runs validation and the tests first).

## Credits

Smell catalog informed by common linter / SAST rules:

- Code smells & anti-patterns: <https://www.codeant.ai/blogs/10-best-code-smell-detection-tools-in-2025>
- Security smells (hardcoded secrets, weak crypto, plaintext transport, bind-all): *The Seven Sins: Security Smells in Infrastructure as Code Scripts*: <https://akondrahman.github.io/files/papers/icse19_slic.pdf>
- Grep-detectable credential patterns: <https://nickjanetakis.com/blog/help-find-and-remove-hard-coded-passwords-and-secrets-in-a-project>
- Dangerous agent/gateway config flags (`dangerously*`, `allowInsecure*`, sandbox off, open policies): OpenClaw gateway security guide: <https://docs.openclaw.ai/gateway/security>
- Container/K8s misconfig patterns + severities: adapted from the open-source jibrilCon container-config rules engine: <https://github.com/IanYHChu/jibrilCon> (privileged, hostPath, runAsRoot, docker.sock, capabilities, `:latest`).
- Weakness taxonomy: each security rule is mapped to a [MITRE CWE](https://cwe.mitre.org/) id (CWE-22/78/79/89/95/250/295/319/327/330/352/494/502/532/611/653/668/676/693/732/798/918/1004/1188/1327/1357/1392).
- Code-quality rules mapped to canonical linter ids: [ESLint](https://eslint.org/docs/latest/rules/) (`eqeqeq`, `no-var`, `no-explicit-any`, `no-disabled-tests`), [SonarQube](https://rules.sonarsource.com/) (`S107`), Rust [clippy](https://rust-lang.github.io/rust-clippy/) (`unwrap_used`), Go [revive](https://revive.run/), Java [PMD](https://pmd.github.io/). Language-gated by file extension.
- Prompt-injection / jailbreak lexicon: the author's own ruleset, originally built for a sibling project; the patterns are collected from publicly documented prompt-injection / jailbreak examples, notably the probes in NVIDIA's [garak](https://github.com/NVIDIA/garak) LLM vulnerability scanner.
- Item generation after Diablo II's prefix/suffix affix system.
