<!-- code-quest:noscan (this doc quotes the smell patterns; don't let the scanner flag it) -->
# Code Quest

A brainless ASCII roguelike that plays itself in your Claude Code statusline while you work.
Your coding actions *are* the turns — and **the dungeon's danger is your tech debt**. Every file
you read is scanned for code smells, and the next floor's traps, ambushes and secret-leak hazards
are generated from what it finds. Read a clean module, get an easy floor. Read a 2000-line god-file
with a hardcoded AWS key, and the next floor will try to kill you.

```
claude-ts [Opus]  ┃  CQ:Lv05 012/028 ambushed! -3
```

**The gameplay never spends your tokens.** The always-on part — the status line plus a `PostToolUse`
/ `UserPromptSubmit` hook — only reacts to tool events the harness already emits and writes to a
local state file. Nothing is sent to the model: no extra prompts, no context bloat. It's a free
ambient toy that rides along on the work you were doing anyway. The only model-touching parts are
the on-demand [slash commands](#commands) (`/cq`, `/cq-nudge`, `/cq-reroll`, `/cq-help`), which cost
just the small turn it takes to show you a result — the Claude-Code-native way to interact.

**Zero tokens is not zero cost — the honest overhead.** Every tool call runs one short-lived Node
process (the `PostToolUse` hook, typically a few tens of ms). Tools that can run long — `Bash`,
sub-agents, web fetch/search, MCP tools — run one more when they *start* (`PreToolUse`, the vigil
timer; quick tools like Read/Edit skip it via the hook matcher). Each status-line redraw spawns the
wrapper (bash + Node). All of it is local and adds nothing to the model's latency or your token
bill, but on a very busy session you are paying a process spawn per tool call; if that bothers you,
`npx code-quest-cli uninstall` removes everything cleanly.

## The status line

```
CQ:Lv05 012/028 ambushed! -3
└┬┘ └─┤ └──┬──┘ └────┬────┘
 │    │    │         └─ event: what just happened (≤ 20 chars, colored by type)
 │    │    └─────────── LP: current / max  (current LP is yellow)
 │    └──────────────── Lv: your global character level, 1–99 (carried across every project)
 └───────────────────── CQ: Code Quest prefix
```

The dungeon still exists under the hood — you walk a generated lane and step on traps, boons and
the exit — but instead of drawing the map, the line reports **what just happened**, kept short so it
never crowds the rest of your status line. Only **Lv / LP / event** show here; your other stats
(ATK, DEF, buff, relics) are hidden values — see the full character sheet any time with `/cq`.

### One event at a time (and why)

The status line shows a **single event** — the most recent thing that happened. It is **read-only**:
the hook writes the event into your save, the status line just renders it.

Why not animate a sequence? Because the status line only redraws when there's activity — model output,
a tool call, your keystrokes — and **not on an idle timer**, and in practice those redraws are several
seconds apart. That's far too sparse to play a multi-frame animation (it would just jump to the last
frame), so Code Quest doesn't try: each event is self-contained. The `git commit` **boss fight** packs
its whole multi-round duel into one frame (see below). Important results also get a short **hold** (a
few seconds, `boss.holdMs`) so a quick follow-up command — like the `git log` after a commit — can't
bury them before a redraw lands.

| Event                | When                                  | Color |
| -------------------- | ------------------------------------- | ----- |
| `explore`            | stepped on empty floor                | dim   |
| `trap! -N`           | stepped on a trap (`-power`, reduced by DEF/level) | red |
| `LEAK! -N`           | stepped on a leaked-secret hazard (`-power×2`) | red |
| `ambushed! -N` / `struck ahead -N` / `pincer! -N` | hit from behind / front / both | red |
| `found loot +2`      | stepped on a boon (clean-code reward) | cyan  |
| `+ATK relic!` / `+DEF relic!` / `+HP relic!` / `+REVIVE relic!` | found a relic (permanent stat, or a consumable revive) | cyan |
| `floor clear! LvN`   | reached the exit — **Lv +1**, max-HP up, full heal, lane reshuffles | green |
| `tests pass buff xN` / `tests fail -3` | tests build attack buff (+3 LP) / cost LP | green / red |
| `▆▄▂▁ ▇▆▅▄ +2Lv` / `… DEFEAT` / `… REVIVE` | a `git commit` boss fight in one frame: boss HP bar (red) + your HP bar (yellow) + outcome | red+yellow / +green/red/cyan |
| `focus cast +N` / `cast! +N clears` | a good prompt healed (and cleared a hazard) | cyan |
| `mumble... no effect`| a lazy prompt fizzled                 | dim   |
| `~forbidden magic~`  | *your* prompt looked like an injection / jailbreak (easter egg) | magenta |
| `TAINTED DOC! injection` | a **doc you read** contained an indirect prompt-injection payload | magenta |
| `PENITENT ENGINE!` / `penance complete` | your save failed verification (edit / lost key / impossible stats) — LP drains each move, ATK +10%, until death absolves you | magenta / cyan |
| `vigil +N buff` / `+HP relic!` | a **long-running tool** finished — the wait paid off (≥12 min forges a relic) | cyan |
| `you fell! revived`  | LP hit 0 — revived at full, level kept | yellow |

## How a turn works

**Every** tool call advances `@` one tile — Read/Edit/Grep, but also `Bash`, `Task`/sub-agents,
`TodoWrite`, `WebFetch`, notebook edits, anything. So long explorations and sub-agent work keep the
dungeon moving instead of freezing it; a quiet step just shows varied ambient flavor (`quiet halls`,
`scouting`, …).

- **Read** a file → scans it for smells, seeds the **next** floor, and takes a step. A floor's
  **length scales with the file's size *and* your level** — a short helper at Lv1 is a quick ~6-tile
  lane; a big module, or any file once you're high-level, is a long slog (up to 250 tiles at the
  level cap — `lane.genMax`). Because higher
  levels mean longer floors, leveling curves from **fast early to slow late** (a real XP curve)
  instead of a flat +1 per floor.
- Step onto `#` → lose LP (`power`). Step onto `$` → lose `power × 2`. Step onto `+` → heal +2.
- Step onto `*` → you clear the floor: **Lv +1**, max LP rises, you heal to full, and a fresh lane
  is generated from the last file you read. Clearing floors is your steady base progression — you
  level up by working through the dungeon and surviving to the exit.
- LP hits 0 → revived at full LP (your level is kept — there is no permadeath).

**The Vigil.** A long-running tool (a slow build, a multi-minute `Task`/sub-agent) is exactly when
*you* have spare attention — so the wait pays off. A `PreToolUse` hook stamps when the tool starts;
when it finishes, Code Quest grants a reward scaled by how long it ran: **+1 buff per ~3 minutes**
(and a small heal), and a vigil of **≥12 minutes forges a relic** (+ATK/+DEF/+HP). So you kick off a
long build, glance back, and your hero spent the time training. (Requires the `PreToolUse` hook,
which is wired only to tools that can actually run long — `Bash`, sub-agents, web fetch/search,
MCP tools — so the hot Read/Edit path stays one process per call; without it the game still works,
vigils just never trigger.)

## Your level is global; the dungeon is per-project

Two separate save layers:

- **`hero.json` — your character, shared across every project.** Your stats travel everywhere:
  **Lv** (1–99), **ATK**, **DEF**, **max-HP bonus**, **buff**, and a list of **relics**.
  Max LP = `20 + (Lv−1)×2 + HP-relics`; damage taken is reduced by `DEF + ⌊Lv/25⌋`, so growing
  **literally makes clearing easier**. This is your persistent career.
- **`projects/<hash>.json` — one dungeon per repo.** The map, floor difficulty and how "tamed" the
  dungeon is are keyed by project path, so each codebase is its own world and two sessions in
  different projects never clobber each other. You bring your leveled hero into each.

**Stats come from real, verifiable behavior:**

- **Tests build your buff.** `tests pass` → `buff +1` (and +3 LP); `tests fail` → lose LP (and
  `buff −1`). Buff is stored attack power waiting to be spent. (Honesty note: pass/fail is judged
  by a keyword heuristic over the runner's output — same toy-grade caveat as the smell scanner, so
  output that merely *mentions* "error" or "fail" can occasionally misread.)
- **`git commit` is a multi-round boss fight.** The hook reads the diff (`git show HEAD`) and scans
  the **added lines**, then you trade blows with the boss round by round until one of you drops.
  The fight only triggers when a commit actually **landed** — HEAD's committer timestamp must be
  fresh (`boss.freshCommitSecs`), so a commit rejected by a pre-commit hook is no boss:
  - **Boss HP** = `round(maxlp × 1.25) + power×5 + smells×4` — it **exceeds your own max HP** and grows
    with you, so it's always a real opponent, fatter for a dirty diff or a debt-ridden repo.
  - **Your damage/round** = `round(Lv×0.5) + ATK×buff×5 + virtue + d6` — buff (test passes), ATK relics
    and a virtuous diff make you hit hard and **end the fight fast, before the boss grinds you down**.
  - **Boss damage/round** scales with your max HP (mitigated by `DEF + ⌊Lv/25⌋`), so a long fight is
    dangerous at any level.
  Win and you **level up** (+1, or **+2** for a genuinely nasty boss — a dirty diff or high-power
  dungeon), heal to full, often **loot a relic**, and **tame** the dungeon a little. Lose and you're
  **defeated**: you limp away at ~⅓ HP, keep your level, gain nothing. Either way the buff is spent.
  So: stack test passes and keep the diff clean, then land the commit to slay the boss fast. The fight
  is capped at 5 rounds and shown in **one status-line frame** — `▆▄▂▁` (boss HP bar, red) `▇▆▅▄`
  (your HP bar, yellow) `+2Lv`/`DEFEAT`/`REVIVE` — so it reads at a glance even though the status line
  redraws only every few seconds. The full blow-by-blow (every round's HP) is in **`/cq`** under *Last
  battle*. Balance and glyphs live in `config.json` (`boss.*`).
- **Relics are permanent — except one.** Boss loot (and the occasional boon) drops **+ATK**, **+DEF**,
  or **+max HP** (permanent), or a rarer **REVIVE** — a *consumable* that **auto-saves you from death**
  in a boss fight: the instant a blow would drop you, one revive is spent to heal you to full and the
  fight continues. Stockpile a couple before tackling a gnarly legacy file. Relics are how you get
  strong enough to clear nastier repos; check your count any time with `/cq`.

In-dungeon goodies (boons, good prompts) heal you but don't level you; levels are earned by
shipping. Still zero tokens — the diff read is a local `git` call.

**Tamper-evident saves: the Penitent Engine.** `hero.json` is stored as `{ d: <stats>, s: <HMAC> }`
— an HMAC-SHA256 signature over the stats, keyed by a **random per-install key** at
`~/.claude/code-quest/.key` (never in the repo, so a clone of the public source can't forge a save).
The stats also carry a signed **lifetime ledger** (steps walked, floors cleared, bosses slain) — and
since Lv is *only* earned from floor clears and boss wins, a level the ledger can't account for is
mathematically impossible. Honesty first: with both the key and the save on your machine, **true
anti-cheat is impossible client-side** (only a server could be that) — so Code Quest doesn't pretend
to reject edits. Instead, a save that fails verification (or claims an impossible level) is locked
into the **Penitent Engine**, Warhammer 40K style: the mark `✠` appears next to your level, **LP
drains every move**, and effective **ATK rises +10%** (pure offense, no extra protection — true to
the source) — the condemned fight harder on their march to the grave. The *only* release is **death**: the normal revive applies (full LP, level kept), the
mark lifts, and the save is absolved — penance is paid in blood, not erased. Nothing ever resets
your character except `/cq-reroll`.

> Moved to a new machine? Copy the whole `~/.claude/code-quest/` directory **including `.key`** —
> a save without its key verifies as broken lineage and earns an (innocent) tour in the Engine.
> If that happens anyway: take the tour; one death and you're absolved, level intact.

**The scanner eats its own dog food.** A scanner whose rules contain words like `eval(` or
`privileged` would flag its own source if it read it — so the **rule catalog** (`quest-rules.mjs` /
`quest-data.mjs`, files made of trigger literals) is exempt, the same way semgrep/gitleaks suppress
their own rule files. **Everything else in Code Quest is scanned like any other code** and ships
clean against its own ruleset — CI enforces it (`test/dogfood.test.mjs`). A file opts out two ways:
by **filename** (its basename matches a glob in `config.json`'s `scan.noscanFiles`, default only the
two catalog files) — robust even on a partial/offset read — or by an in-content
**`code-quest:noscan`** sentinel (à la `# noqa` / `gitleaks:allow`) for a full read. Exempt your own
generated/vendored files by adding globs to `scan.noscanFiles` (avoid generic basenames — a bare
name matches in every repo).

**Reroll.** Your character only resets on purpose — run `/cq-reroll`. It wipes `hero.json` (back to
Lv01) and all per-project dungeons. Nothing else ever resets you.

## What you control vs. luck

Code Quest is built so your **behavior**, not the dice, drives your fate.

**Base progression — just by working:** every floor you clear (reach the `*` exit) is **Lv +1**, a
higher max-HP, and a full heal. You advance steadily by coding through the dungeon and surviving to
the exit. The three buckets below shape *how that journey goes* — how dangerous it is, what bonuses
you pick up, and how much luck pokes at you:

**Positive — earned by good behavior (big, controllable):**

| Trigger | Effect |
| ------- | ------ |
| reading clean / tested / typed code | boons `+` to heal, a calm floor |
| a sharp, specific prompt | heal +2…5 and clears a hazard ahead |
| tests pass | +3 LP and +1 attack buff |
| a clean `git commit` (win the boss) | +1–2 Lv, a relic, and the dungeon gets tamed |

**Negative — caused by bad behavior (big, controllable):**

| Trigger | Effect |
| ------- | ------ |
| reading messy / insecure / secret-laden code | traps `#` and leaks `$` whose damage scales with how bad it is (`power`, up to −10) |
| reading a doc with prompt injection | a hostile floor |
| tests fail | −3 LP, −1 buff |
| losing the boss fight (dirty diff / unprepared) | defeated: limp away at ~⅓ HP, no level — unless a **revive** relic saves you |

**Random — luck, deliberately kept small so it never exceeds behavior:**

| Event | Effect |
| ----- | ------ |
| ambush (rear / front / pincer) | a small **fixed** chip (1–3, reduced by DEF/level). Your code health only changes how *often* it strikes (~20% of steps when clean), never how *hard* |
| stray loot | an occasional `+` (+2) on ~a third of floors |
| relic drops | only behind a boss win or a rare boon |
| the boss fight's d6 | a small swing inside an otherwise behavior-decided fight — pass tests to stack buff and your behavior outweighs the dice |

The rule: **behavior sets the stakes; luck is only texture.** A trap you walked into because you
read a 2000-line god-file hits for up to −10; a random ambush hits for 1–3. A bad roll can't undo
good work, and a lucky roll can't replace it — so you always feel in control.

## Ambushes

Each step, one roll decides whether you're jumped — on a **clean floor that's ~20%**, so four out of
five steps are quiet. When an ambush does happen, a second roll picks the kind:

- **Rear** — most common (≈10% of steps), a fixed 2-LP chip.
- **Front** — less common (≈6%), a fixed 1-LP chip.
- **Pincer** (hit from both sides) — rarest and worst (≈4%), both chips at once.

A dirty file widens the ~20% window (via `ambushBias`); a tamed dungeon shrinks it. Damage is then
reduced by your `DEF + ⌊Lv/25⌋`.

## Cast — your prompt is your move

You're not only prey. Every prompt you submit to Claude Code is scanned (by the same hook, via
`UserPromptSubmit`) and becomes a spell — **still zero tokens, nothing is sent to the model**:

- **A well-formed prompt heals you, and a great one strikes.** Quality is scored on plain
  prompt-engineering signals: gives context/constraints, names a file or code, asks for steps,
  shows an example, specifies an output format, is more than a one-liner. Score ≥ 2 → **heal LP**;
  score ≥ 3 → also **clear the nearest `#`/`$` hazard ahead** of you.
- **A lazy prompt fizzles.** `"fix it"`, `"make it better"`, one-word prompts → nothing happens.
- **A prompt-injection / jailbreak attempt flashes a forbidden incantation.** `ignore previous
  instructions`, `sudo mode`, `<system>` fake tags, `DAN`, … → the event line shows a **magenta**
  `~forbidden magic~`. Pure easter egg, no stat change. The detector is context-aware (the lexicon
  is the author's own, built from publicly documented injection samples — see Credits): negations
  and pasted code are *not* flagged, so
  `"don't ignore the lint errors"` heals you like any other good prompt.

## The dungeon is your tech debt

When you read a file, its content is scanned (single pass + a few regexes — fast, deterministic,
same file always yields the same floor). The content comes from the `tool_response` payload Claude
Code hands the `PostToolUse` hook; if a future Claude Code version changes that payload's shape,
floors simply come out clean — the game degrades gracefully, it never errors. Smells map to danger:

| Code smell                                   | How it's detected                                              | Dungeon effect                |
| -------------------------------------------- | -------------------------------------------------------------- | ----------------------------- |
| **Deep nesting**                             | max indentation depth                                          | `power` ↑, more `#` traps     |
| **God file / no modularization**             | `totalLines > 400`                                             | `power` +1, trap density ↑    |
| **Commented-out dead code**                  | comment lines starting with `if/for/return/function/def/…`     | trap density ↑                |
| **Tech-debt / suppression markers**          | `TODO` `FIXME` `HACK` `XXX`, and warning suppressions `@ts-ignore` `@SuppressWarnings` `# type: ignore` `# noqa` `//nolint` `#[allow(` | ambush rate ↑ (+3% each)      |
| **Magic numbers**                            | bare 4+ digit literals                                         | ambush rate ↑ (+1% each)      |
| **Over-long lines**                          | line length > 120                                              | ambush rate ↑ (+1% each)      |
| **Swallowed exceptions**                     | empty `catch (e) {}`, `except: pass`, bare `except:`           | ambush rate ↑ (+4% each)      |
| **Debug leftovers**                          | `console.log` `print(` `debugger` `var_dump` `System.out.print` `fmt.Print` `dd(` | ambush rate ↑ (+2% each) |
| **Insecure code**                            | weak crypto `MD5/SHA1/DES/RC4`, plaintext `http://`, bind `0.0.0.0`, disabled TLS verify, `eval(`/`exec(`, shell-injection (`shell=True`, `os.system`, `child_process.exec`), string-built SQL, unsafe deserialization (`pickle.loads`, `yaml.load`) | `power` +1 |
| **Dangerous config / misconfig**             | `dangerously*: true`, `allowInsecure*/allowUnsafe*: true`, `permissionMode: approve-all`, exec `security: full`, `sandbox: off`, `workspaceOnly: false`, `redactSensitive: off`, open `dm/groupPolicy`, `ALLOW_INSECURE`; docker `USER root`, `--privileged`, `:latest`, `curl … \| sh` | `power` +1, ambush rate ↑ (+3% each) |
| **Hardcoded secrets**                        | AWS key, PEM private key, `password=`/`api_key=` literals, `sk-…`, `ghp_…`, long base64 blobs | red `$` hazard (up to 2)      |
| **Default / weak credentials**               | `password="admin"/"root"/"123456"/…`, placeholder keys `secret="changeme"/"test"/…` | red `$` hazard (up to 2)      |
| **Container / K8s misconfig**                | `privileged: true`, `hostPID/Network/IPC: true`, `allowPrivilegeEscalation: true`, `runAsUser: 0`, `/var/run/docker.sock` mount, `hostPath` into `/proc /sys /etc`, dangerous capabilities, `seccompProfile: Unconfined` | `power` graded by severity (up to 5) |

Each security finding carries a **severity (0–9, CVSS-ish)** borrowed from the
[jibrilCon](https://github.com/IanYHChu/jibrilCon) rules engine, **plus a [MITRE CWE](https://cwe.mitre.org/)
id** — every security rule is essentially one CWE (string-built SQL → CWE-89, weak crypto → CWE-327,
hardcoded secret → CWE-798, `eval(` → CWE-95, `privileged: true` → CWE-250, …). The floor's `power` =
`max(structural mess, round(worstSeverity / 2))`, so a `privileged: true` (sev 9) floor is
maximally deadly regardless of how short the file is — danger is **graded**, not flat. The ruleset
also covers common web/app weaknesses (XSS, SSRF, path traversal, XXE, CSRF, weak RNG) and C/C++
dangerous functions (`gets`/`strcpy`/`sprintf` → CWE-676), and `/cq` prints a **CWE breakdown**
listing which weaknesses appeared and in which files.

### Language-aware code-quality smells

Beyond security, the scanner flags **maintainability smells**, each tagged with a canonical
**ESLint / SonarQube / clippy / PMD rule id** (the quality analogue of a CWE) and shown in `/cq`
under a **CODE SMELLS** breakdown. These feed ambush/trap density, never `power` — `power` stays
reserved for genuine danger. Crucially, the scanner branches on **file extension**, so a rule only
fires where it's meaningful and won't false-fire across languages:

| Rule (id)                          | Fires in            | What it catches                                  |
| ---------------------------------- | ------------------- | ------------------------------------------------ |
| `eqeqeq`                           | js/ts only          | loose `==` / `!=` (correct in Python/Go/C/Rust)  |
| `no-var`                           | js/ts only          | `var` (idiomatic in Go/Java — *not* flagged there) |
| `no-explicit-any`                  | ts only             | `: any` weakening the type system                |
| `clippy::unwrap_used`              | rust                | `.unwrap()` / `.expect()` / `panic!`             |
| `revive:deep-exit`                 | go                  | `panic(` in library code                         |
| `PMD:AvoidPrintStackTrace`         | java                | `.printStackTrace()`                             |
| `no-disabled-tests`                | all                 | skipped/focused tests (jest/pytest/JUnit/go/`#[ignore]`/gtest) |
| `S107`                             | all                 | long parameter lists (≥6), across def/function/fn/func |
| `S3776`                            | all                 | high cognitive complexity (branch-point count)  |

Languages covered by the extension dimension: **ts, js, python, go, rust, c/c++, java**. An unknown
extension still gets the language-agnostic rules (`no-disabled-tests`, `S107`, `S3776`) and all
security/structural smells.

Derived stats (all clamped):

- `power` 1–5 — damage of traps, `$`, and ambushes (graded by the worst severity present).
- `trapDensity` 0–1 — number of `#` on the floor (`round(density × 5)`, max 4).
- `ambushBias` 0–25 — extra percentage points added to the ~20% base ambush rate.
- `secrets` — number of red `$` hazards (capped at 2).
- `boonDensity` 0–1 — number of cyan `+` boons (see below).

## Clean code rewards you (and the floor is never empty)

The dungeon doesn't only punish bad code — it **celebrates good code**, so writing it well stays
fun instead of going quiet. Two things keep every floor eventful:

- **Boons from virtue.** Good-engineering signals — tests (`describe`/`test`/`assert`), type
  annotations, doc comments/docstrings, named constants, *handled* (not swallowed) errors, plus a
  shallow, focused file — raise `boonDensity` and spawn cyan `+` heal tiles. A clean, well-tested
  module becomes a floor paved with boons.
- **A baseline event layer.** Independent of code quality, ~35% of floors drop a stray `+` (seeded
  by the file path), so even a plain neutral file is never a dead, empty corridor.

Reward tracks **virtue and player skill** (good prompts); danger tracks **tech debt**. Boons never
scale with badness — a filthy file's lone `+` is just the baseline, not a prize for the mess.
Your character's strength mirrors your codebase's health: read clean modules to heal and grow, and
the gnarly 2000-line legacy file is the boss fight.

### Documents are safe ground — except injection

Prose files (`.md` `.markdown` `.mdx` `.txt` `.rst` `.adoc` `.org`) are **easy floors**: the
code-style smells (magic numbers, long lines, nesting) don't apply to writing, so reading docs is a
calm, lightly-rewarding stroll. The *one* thing scanned in a document is **indirect prompt
injection** — content trying to hijack the agent that's reading it (`ignore all previous
instructions`, fake `<system>`/`[INST]` tags, `DAN`/jailbreak personas). A tainted doc turns its
floor hostile (`power 5`, ambush rate way up) and shows `TAINTED DOC! injection`; `/cq` lists it
under **PROMPT INJECTION**. The lesson the game teaches: **treat document content as untrusted
data, never as instructions.**

## Install

One command, no dependencies:

```bash
npx code-quest-cli install      # wire up status line + hooks + /cq commands (idempotent)
npx code-quest-cli uninstall    # remove cleanly (add --purge to also wipe your save)
npx code-quest-cli status       # what's installed + your hero
```

**Platforms: macOS and Linux** (the status line wrapper needs bash; Node ≥ 18). On Windows the
installer declines with a pointer to Microsoft's upcoming native bash/coreutils
([microsoft/coreutils](https://github.com/microsoft/coreutils)) — until that lands, install inside WSL.

The installer:

- copies the runtime to `~/.claude/code-quest/bin/` (a stable path the hooks can point at),
- patches `~/.claude/settings.json` — it **wraps** any status line you already have (yours renders
  first, Code Quest is appended; your original command is stored **verbatim in its own side script**,
  never string-interpolated, so quotes/pipes/newlines in it can't be mangled) and adds the hooks
  (`PostToolUse` + `UserPromptSubmit` for every event, `PreToolUse` only for long-running-capable
  tools), leaving every other setting and hook untouched,
- installs the `/cq`, `/cq-nudge`, `/cq-reroll`, `/cq-help` slash commands,
- records what it did in `~/.claude/code-quest/.install.json`, so `uninstall` restores your original
  status line exactly and removes only its own hooks/commands.

Your `settings.json` is treated as precious: the **first** time Code Quest ever touches it, a
pristine snapshot is saved to `settings.json.cq-backup` — never overwritten by later runs, so it
always shows your config from before Code Quest existed (a clean uninstall removes it again). Every
write is **atomic**, and if the file exists but isn't valid JSON the installer **refuses to touch
it** (it will never silently replace a broken config with an empty one).

Hooks and the status line embed the **absolute path of the Node binary that ran the installer**
(falling back to `node` on `PATH`), so nvm/asdf setups — where non-interactive shells often have no
`node` — still work. If you later remove that Node version, just re-run `npx code-quest-cli install`
to re-pin the new one.

State lives in `~/.claude/code-quest/`: `hero.json` (global character, HMAC-signed, schema-versioned),
`.key` (per-install signing key), and `projects/<hash>.json` (one dungeon per repo). Customisation lives
beside it in `config.json` / `strings.json` (see [Tuning knobs](#tuning-knobs)). Restart Claude Code
after installing to load it.

**Privacy.** Everything stays on your machine: no network calls, no telemetry, ever. The hooks see
only what Claude Code already hands them (tool events, the content of files you read, your prompts)
and persist nothing of it except the smell log — `projects/<hash>.findings.jsonl`, the absolute
paths of files whose floors got harder plus their smell counts, which is what `/cq` reports from.
Note that a plain `uninstall` keeps your save *including that path list* (so a reinstall resumes
your hero); delete the directory or run `uninstall --purge` and it's gone.

**Your save survives upgrades and machine moves.** `hero.json` carries a `v` schema version and is
run through a migration step on load, so a newer version adapts old saves instead of breaking them.
If the signature ever fails to verify — a hand-edit, or the random `.key` lost in a machine move —
your level is **never wiped**: the raw file is backed up to `hero.json.bak`, the save is re-signed,
and the hero serves a stint in the [Penitent Engine](#tamper-evident-saves-the-penitent-engine)
(LP drain each move, +10% ATK, released by death with level intact). The only things that wipe
a save are, by design, `/cq-reroll` and `uninstall --purge`.

### Running several Claude Code windows at once

State is shared sensibly across concurrent sessions:

- **Different projects** are fully independent — each repo has its own `projects/<hash>.json`, so two
  windows in two repos never touch each other's dungeon.
- **The character (`hero.json`) is global**, so all windows share one level/LP/relics — that's the point
  (one hero across all your work).
- **The same repo in two windows** shares that one dungeon; the two sessions' steps simply interleave.

Only the hook writes state (the status line is read-only). Every save is written **atomically**
(write-to-temp then rename), so a window reading while another writes always sees a complete file — a
concurrent read can never catch a half-written `hero.json` and mistake it for corruption (which
previously could reset you to Lv01). The one caveat: writes are not *serialized*, so if two windows
resolve a level-up in the very same instant, last-write-wins and one increment can be missed. There's
no corruption or wipe — at worst a single rare missed step.

## Commands

Code Quest is driven entirely from Claude Code — there's nothing to run in a terminal. Slash
commands (installed to `~/.claude/commands/`):

| Command | What it does |
| ------- | ------------ |
| `/cq`        | your **character sheet** (Lv, ATK, DEF, max-HP, buff, relics) + the **dungeon report**: which files made it hard, the in-game effect, a fix tip, a **CWE breakdown** (each security finding mapped to its MITRE CWE), and a "top offenders" ranking |
| `/cq-nudge`  | **commit nudges** — steps out of the game: re-scans *your own* recent commits and gives gentle, line-attributed pointers for writing better code (see below). `/cq-nudge 10`, `/cq-nudge abc1234`, `/cq-nudge main..HEAD`, `--all`, `--sarif` |
| `/cq-reroll` | reset your character to Lv01 and wipe every dungeon |
| `/cq-help`   | how to play, mechanics, command list |

`/cq` answers "*why* was that floor brutal?" — re-read a file after fixing it and watch its floor
get easier. (Under the hood each command just runs a dependency-free Node script and relays its
output; the always-on gameplay — status line + hooks — stays zero-token, the commands cost only the
small turn it takes to show you the result.)

**Running a Code Quest command doesn't cost a turn.** Each command executes via the Bash tool, which
would normally fire the `PostToolUse` hook and advance the dungeon one step — so checking your stats
or rerolling would cost a move (and a reroll would immediately get ambushed). The hook detects when
the Bash command is one of Code Quest's own scripts (`quest-report/reroll/hook/status/nudge.mjs`) and
skips entirely: no step, no state change. So `/cq` is a free peek and `/cq-reroll` leaves you at a
clean Lv01 / full HP.

## Commit nudges — `/cq-nudge`

`/cq` is the game's view of your tech debt; **`/cq-nudge` steps out of the game** and answers a more
practical question: *"in the code I just shipped, what could I have done better?"* It re-scans the
**added lines of your own recent commits** (local `git show`, zero tokens, nothing leaves your
machine) with the same ruleset that drives the dungeon, and prints each hit as a **nudge** — file,
**exact line number**, the canonical rule id (MITRE CWE for security, ESLint/SonarQube/clippy/PMD
for quality), the offending line, and a one-line fix tip:

```
◆ a1b2c3d  add login endpoint  (2026-06-10)
   src/auth.js:42  [HIGH] CWE-798  Use of Hard-coded Credentials
       | const password = "hunter2";
       -> move to env vars or a secret manager, and rotate the leaked key
```

Three design choices worth knowing:

- **You answer only for your own commits.** By default it reviews commits authored by your
  `git config user.email` (`--all` widens to everyone, `/cq-nudge 10` looks further back). And
  because git history *is* the database — nothing is precomputed at commit time — **any commit ever
  made is scannable**, including ones from before Code Quest was installed: name one explicitly
  (`/cq-nudge abc1234`) or give a range (`/cq-nudge main..HEAD`); an explicitly named commit is
  reviewed as asked, author filter off. The
  legacy mess *around* your diff is deliberately out of scope — that's `/cq`'s dungeon. This is the
  same "you're responsible for the code you add, not the code you inherited" idea SonarQube calls
  [Clean as You Code](https://docs.sonarsource.com/sonarqube/latest/core-concepts/clean-as-you-code/).
- **It is honest about being a toy.** The nudges come from the game's regex heuristics — fast and
  deterministic, but no type or data-flow analysis, so **false positives happen and real issues get
  missed**. The report says this up front, frames every hit as *a question worth a look* rather than
  a verdict, and ends with the professional tools to reach for when it matters: Semgrep, CodeQL,
  SonarQube, gitleaks, Trivy, and your language's linter.
- **`--sarif` exports [SARIF 2.1.0](https://sarifweb.azurewebsites.net/)**, the OASIS-standard
  interchange format for static-analysis results — so a nudge run can be opened in a VS Code SARIF
  viewer or uploaded to GitHub code scanning if you want to play with the plumbing. The disclaimer
  travels inside the file (`tool.driver.fullDescription`).

## Tuning knobs

Every balance number and every line of player-facing text now lives as **data**, not buried in the
logic. The baked-in defaults are in `quest-data.mjs` (`DEFAULT_CONFIG` and `DEFAULT_STRINGS`); to
change them you don't edit code — you drop overrides into two files in your state dir:

- `~/.claude/code-quest/config.json` — balance knobs (damage, drop rates, lane length, boss
  difficulty, ambush frequency, level curve, …).
- `~/.claude/code-quest/strings.json` — all output text (event messages, flavour lines, the report's
  labels and fix tips, installer messages). Translate the game by rewriting these.

Both are **seeded once** by the installer with the full defaults and are **never overwritten on
upgrade**, so your tuning and translations survive every `npx code-quest-cli install`. At runtime each
file is *deep-merged over* the defaults — you only keep the keys you actually changed, and any new
keys a future version adds still take effect. A read-only `config.defaults.json` / `strings.defaults.json`
is refreshed on every install so you can always see (and copy from) the latest full schema.

```jsonc
// ~/.claude/code-quest/config.json — override just what you want
{ "ambush": { "baseAggro": 10 },          // calmer dungeon (default 20)
  "boss":   { "dropChance": 60 } }        // more loot on a kill (default 35)
```

```jsonc
// ~/.claude/code-quest/strings.json — e.g. localise a couple of events
{ "events": { "floorClear": "過關！Lv{lv}", "trap": "陷阱！-{dmg}" } }
```

Quick reference for where things live: ambush frequency/chip damage → `config.ambush`; lane length and
level curve → `config.lane`; boon generosity → `config.analyze.boonDivisor` + `config.track.baseBoonChance`;
boss difficulty / fight rendering → `config.boss` (HP/damage scaling, `maxRounds`, `holdMs`, `sparkBlocks`,
`freshCommitSecs`); Penitent Engine severity → `config.tamper` (`penitentDrain`, `penitentStatMult`);
scan latency guards → `config.analyze.scanMaxBytes` / `scanMaxLineLen`.
The smell regexes themselves (the *ruleset*, shared by the game and `/cq-nudge`) live in
`quest-rules.mjs`; the ANSI colour palette lives in `quest-data.mjs`.

## Credits

Smell catalog informed by common linter / SAST rules:

- Code smells & anti-patterns: <https://www.codeant.ai/blogs/10-best-code-smell-detection-tools-in-2025>
- Security smells (hardcoded secrets, weak crypto, plaintext transport, bind-all): *The Seven Sins: Security Smells in Infrastructure as Code Scripts* — <https://akondrahman.github.io/files/papers/icse19_slic.pdf>
- Grep-detectable credential patterns: <https://nickjanetakis.com/blog/help-find-and-remove-hard-coded-passwords-and-secrets-in-a-project>
- Dangerous agent/gateway config flags (`dangerously*`, `allowInsecure*`, sandbox off, open policies): OpenClaw gateway security guide — <https://docs.openclaw.ai/gateway/security>
- Container/K8s misconfig patterns + severities: adapted from the open-source jibrilCon container-config rules engine — <https://github.com/IanYHChu/jibrilCon> (privileged, hostPath, runAsRoot, docker.sock, capabilities, `:latest`).
- Weakness taxonomy: each security rule is mapped to a [MITRE CWE](https://cwe.mitre.org/) id (CWE-22/78/79/89/95/250/295/319/327/330/352/494/502/532/611/653/668/676/693/732/798/918/1004/1188/1327/1357/1392); `/cq` reports the CWE breakdown.
- Code-quality rules mapped to canonical linter ids: [ESLint](https://eslint.org/docs/latest/rules/) (`eqeqeq`, `no-var`, `no-explicit-any`, `no-disabled-tests`), [SonarQube](https://rules.sonarsource.com/) (`S107`, `S3776`), Rust [clippy](https://rust-lang.github.io/rust-clippy/) (`unwrap_used`), Go [revive](https://revive.run/), Java [PMD](https://pmd.github.io/). Language-gated by file extension.
- Prompt-injection / jailbreak lexicon: the author's own ruleset, originally built for a sibling project — the patterns are collected from publicly documented prompt-injection / jailbreak examples around the web, notably the probes in NVIDIA's [garak](https://github.com/NVIDIA/garak) LLM vulnerability scanner (lexeme matching + context-aware false-positive reduction).
- Prompt-quality signals: <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices> and <https://thenewstack.io/prompt-engineering-for-developers/>
