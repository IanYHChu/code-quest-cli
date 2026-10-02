---
description: Code Quest — commit nudges: gentle pointers from your own recent commits (honest, lightweight, line-by-line)
allowed-tools: Bash(node "__CQ_BIN__/quest-nudge.mjs":*)
---
<!-- code-quest:command — ownership marker: the installer backs up / removes only files carrying it -->
Run `node "__CQ_BIN__/quest-nudge.mjs" $ARGUMENTS` with the Bash tool and show its raw output to the user inside a code block. Add no analysis or commentary — just relay the report. (Optional arguments the user may pass: a commit count, a commit id or range like `main..HEAD`, `--all` to include every author, `--sarif` for machine-readable SARIF output.)
