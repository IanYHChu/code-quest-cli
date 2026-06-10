---
description: Code Quest — how to play, mechanics, and commands
---
<!-- code-quest:command — ownership marker: the installer backs up / removes only files carrying it -->
Show the user the following Code Quest help text verbatim (it's a static reference — do not run anything, do not add commentary):

```
Code Quest — an ambient roguelike in your status line. Your coding IS the game.

THE STATUS LINE   CQ:Lv05 028/038 boss slain +1Lv
  Lv  = your global character level (1–99), carried across every project
  LP  = current / max health
  event = the latest thing that happened (colored)

PLAYING (all automatic, zero tokens — just work normally)
  • Read / Edit / Grep …  → you walk the dungeon; ambushes chip your LP
  • Reading a messy file   → the next floor turns nastier (traps #, secret-leaks $)
  • Reading a clean file    → boons + appear; step on them to heal
  • Tests pass             → build an attack buff (hidden); tests fail → take damage
  • git commit             → a multi-round BOSS FIGHT (shown as one frame: boss HP bar +
                             your HP bar + outcome). Buff/ATK/a clean diff end it fast;
                             win → +1-2 Lv, maybe loot a relic, tame the dungeon.
  • Relics                 → permanent +ATK / +DEF / +max-HP (or a consumable REVIVE),
                             dropped by bosses
  • Reach the exit (*)     → clear the floor: Lv +1, max-HP up, full heal, lane
                             reshuffles. Clearing floors is your steady leveling.

THE DUNGEON IS YOUR TECH DEBT
  Deep nesting, god-files, hardcoded secrets, TODO/FIXME, eval, weak crypto,
  container misconfig (privileged, docker.sock, runAsRoot, :latest) … all spawn
  hazards. Clean, tested, well-typed code spawns rewards instead.

CONTROL vs LUCK  (behavior sets the stakes; luck is only texture)
  • Behavior = big & controllable: clean/tested code + sharp prompts heal and level
    you; messy/insecure code + failed tests hurt (damage scales with how bad it is).
  • Random = small: ambushes are a fixed 1-3 chip; code health only changes how
    OFTEN they strike, never how hard. A bad roll can't undo good work.

COMMANDS
  /cq          show your character sheet + dungeon report (why it got hard, how to fix)
  /cq-nudge    gentle pointers from YOUR own recent commits — file:line, rule id (CWE /
               ESLint / Sonar), fix tip. Honest about being lightweight (regex heuristics,
               false positives possible); lists pro tools for the real thing.
               /cq-nudge [count | commit-id | A..B] [--all] [--sarif]
  /cq-reroll   reset your character to Lv01 and wipe all dungeons
  /cq-help     this help

Your level only resets via /cq-reroll. Saves are signed and ledger-checked: an edited
or impossible save locks you into the PENITENT ENGINE (✠) — LP drains every move,
ATK +10% — until death absolves you (revive as usual, level kept, mark lifted).

Platforms: macOS / Linux (Node >= 18). Windows: not yet — use WSL for now.
```
