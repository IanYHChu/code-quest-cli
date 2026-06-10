// code-quest:noscan
// Tiny runner for the dogfood test: scans ONE file with the game's real analyze() and prints the
// profile as JSON. Spawned as a subprocess so HOME (and therefore CONFIG) is the test's throwaway
// home, never the developer's own ~/.claude/code-quest/config.json overrides.
import { readFileSync } from 'node:fs';
import { analyze } from '../quest-analyze.mjs';

const p = process.argv[2];
const content = readFileSync(p, 'utf8');
process.stdout.write(JSON.stringify(analyze(content, content.split('\n').length, false, p)));
