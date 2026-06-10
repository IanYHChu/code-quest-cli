---
description: Code Quest — reroll your character (reset to Lv01, wipe all dungeons)
allowed-tools: Bash(node "__CQ_BIN__/quest-reroll.mjs":*)
---
<!-- code-quest:command — ownership marker: the installer backs up / removes only files carrying it -->
This permanently resets the Code Quest hero to Lv01 and wipes every project's dungeon — it cannot be undone. Unless the user has already explicitly confirmed the reset in this conversation, ask them to confirm first (and stop here if they decline). Only after explicit confirmation, run `node "__CQ_BIN__/quest-reroll.mjs"` with the Bash tool and show its output to confirm it ran.
