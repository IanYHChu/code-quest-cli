#!/usr/bin/env node
// Code Quest - reroll. The ONLY way to reset your character. Run:  node quest-reroll.mjs
// Wipes the global hero (back to Lv01) and every project's dungeon. Zero tokens.
// Keeps your config.json/strings.json overrides — only save data is reset.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { STR, STATE_DIR } from './quest-data.mjs';

for (const p of ['hero.json', 'hero.json.bak', 'projects']) {
  try { rmSync(join(STATE_DIR, p), { recursive: true, force: true }); } catch {}
}
process.stdout.write(STR.reroll.done + '\n');
