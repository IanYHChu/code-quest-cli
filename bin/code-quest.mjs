#!/usr/bin/env node
// Code Quest is a Claude Code plugin since 0.2: there is nothing to install from the command line.
// This only tells whoever runs `npx code-quest-cli` where the game went, and how to remove 0.1.
const say = (s = '') => process.stdout.write(`${s}\n`)

say('Code Quest is now a Claude Code plugin. Install it inside Claude Code:')
say()
say('  /plugin marketplace add IanYHChu/code-quest-cli')
say('  /plugin install code-quest@code-quest-cli')
say()
say('Still have the status-line version (0.1) installed? Remove it with:')
say()
say('  npx code-quest-cli@0.1.0 uninstall --purge')
say()
say('More: https://github.com/IanYHChu/code-quest-cli#readme')
if (process.argv.length > 2) process.exitCode = 1 // install/uninstall/status are 0.1 commands
