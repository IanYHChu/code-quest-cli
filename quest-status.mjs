#!/usr/bin/env node
// Code Quest - statusline renderer. One line, fast, never throws, READ-ONLY (writes nothing, so
// concurrent windows never clobber state).
// Format:  CQ:Lv05 012/028 ambushed! -3
//   Lv = global character level 1-99 (cross-project) | LP current/max (current is yellow)
//   event = what just happened. Most events are a short text + color key (evk); a boss fight is a
//   pre-colored 'raw' frame (HP sparklines) shown verbatim. Text/colors come from quest-data.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STR, ANSI, EVK_COLOR, maxlpFor, stripCtl, STATE_DIR, hashStr } from './quest-data.mjs';

const DIR = STATE_DIR;

function readJson(p, def) {
  try { return { ...def, ...JSON.parse(readFileSync(p, 'utf8')) }; } catch { return { ...def }; }
}

let cwd = '', projDir = '';
try {
  const ws = JSON.parse(readFileSync(0, 'utf8')).workspace || {};
  cwd = ws.current_dir || '';
  projDir = ws.project_dir || '';
} catch {}

const wrap = readJson(join(DIR, 'hero.json'), {});
const hero = { lv: 1, lp: 20, hpbonus: 0, ...(wrap.d || wrap) };  // unwrap the signed envelope
// The hook keys the dungeon by ITS payload's cwd, which normally equals current_dir here. If the
// two ever diverge (the session's working dir moved), fall back to the launch dir's dungeon
// rather than rendering a perpetual default line against a key the hook never writes.
let proj = null;
for (const c of new Set([cwd || 'global', projDir].filter(Boolean))) {
  try { proj = JSON.parse(readFileSync(join(DIR, 'projects', hashStr(c) + '.json'), 'utf8')); break; } catch {}
}
if (!proj) proj = { ev: STR.statusline.defaultEvent, evk: 'dim' };

// Only Lv / LP / event show here — buff, ATK, DEF, relics are hidden values; read them with quest-report.mjs.
const lv = Math.max(1, Math.min(99, hero.lv | 0));
const maxlp = maxlpFor(hero);
const pad = (n, w) => String(Math.max(0, n | 0)).padStart(w, '0');
const lp = `${ANSI.y}${pad(hero.lp, 3)}${ANSI.reset}`;
// a hero locked in the Penitent Engine wears the mark right on the level readout
const mark = hero.penitent ? `${ANSI.mag}${STR.statusline.penitentMark}${ANSI.reset}` : '';

// Pick the event: a "hold" (e.g. a boss-fight result) keeps showing for a while so a follow-up command
// can't bury it before a redraw lands; otherwise show the current event. The status line redraws only
// on activity (never on an idle timer), so there's no animation — each redraw just shows the latest.
const held = proj.holdUntil && proj.holdUntil > Date.now();
const evk = held ? proj.holdEvk : proj.evk;
const evRaw = held ? proj.holdEv : proj.ev;
// 'raw' frames carry their own ANSI colors (and may exceed 20 visible chars) — show them verbatim
// (they are authored by the hook itself); everything else is plain text with control characters
// stripped (the save file is data, not terminal input), clamped to 20 chars, in its event color.
let ev, c;
if (evk === 'raw') { ev = String(evRaw || ''); c = ''; }
else { ev = stripCtl(evRaw || STR.statusline.defaultEvent).slice(0, 20); c = EVK_COLOR[evk] || ''; }

process.stdout.write(`${STR.statusline.label}${pad(lv, 2)}${mark} ${lp}/${pad(maxlp, 3)} ${c}${ev}${ANSI.reset}`);
process.exit(0);
