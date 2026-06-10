// Code Quest - the save layer: the signed global hero, the per-project dungeon state, the smell
// log, plus the small stat helpers (damage, levels, relics) that read them. Pure persistence +
// arithmetic — no game flow here (that is quest-dungeon.mjs) — so it carries no pattern literals
// either; this file is scanned like any other code. Never throws: every read falls back, every
// write is atomic (see writeAtomic).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { CONFIG, STR, maxlpFor, writeAtomic, SAVE_VERSION, STATE_DIR, hashStr } from './quest-data.mjs';

export const DIR = STATE_DIR;
const HERO = join(DIR, 'hero.json');          // GLOBAL character (level + hp) - travels across all projects
const PROJDIR = join(DIR, 'projects');        // PER-PROJECT dungeon state, keyed by project path
const KEYFILE = join(DIR, '.key');            // per-install random signing key (generated on first run)

export const clamp = (lo, hi, n) => Math.max(lo, Math.min(hi, n));
// gameplay hash (FNV-1a): deterministic texture for rolls and track layout, NOT security —
// the save signature uses HMAC-SHA256 below, the state-file keys use sha256 (hashStr).
export function hash(str = '') {
  let h = 2_166_136_261;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16_777_619); }
  return h >>> 0;
}

export function projPath(cwd) { return join(PROJDIR, hashStr(cwd || 'global') + '.json'); }
// smell log is PER-PROJECT (keyed by repo) so /cq reports only the repo you ran it in, not every
// file read across every project/session.
export function findingsPath(cwd) { return join(PROJDIR, hashStr(cwd || 'global') + '.findings.jsonl'); }
export function logFindings(cwd, rec) {
  try {
    mkdirSync(PROJDIR, { recursive: true });
    const fp = findingsPath(cwd);
    let lines = [];
    try { lines = readFileSync(fp, 'utf8').trim().split('\n').filter(Boolean); } catch {}
    lines.push(JSON.stringify(rec));
    if (lines.length > CONFIG.store.findingsCap) lines = lines.slice(-CONFIG.store.findingsCap);
    writeAtomic(fp, lines.join('\n') + '\n');         // a concurrent /cq read never sees a half-written log
  } catch {}
}

// lifetime counters, signed with the save
export const freshLedger = () => ({ steps: 0, floors: 0, wins: 0, bigWins: 0 });
// the clean-floor profile a fresh dungeon starts on (regen falls back to it too)
export const CLEAN = {
  power: 1, trapDensity: 0, ambushBias: 0, secrets: 0, boonDensity: 0,
  len: CONFIG.lane.base, seed: 'origin',
};
export function freshHero() {                          // global character
  return {
    lv: 1, lp: CONFIG.hero.startLp, atk: 1, def: 0, hpbonus: 0, buff: 1,
    relics: [], revives: 0, penitent: false, ledger: freshLedger(), lastBattle: null,
  };
}
export function freshProj() {
  return {
    track: null, pos: 0, profile: { ...CLEAN }, next: null,
    amb: { back: false, front: false }, roll: 0, tamed: 0, ev: STR.events.enterDungeon, evk: 'dim',
  };
}
function readJson(p, def) {
  try { return { ...def, ...JSON.parse(readFileSync(p, 'utf8')) }; } catch { return { ...def }; }
}

// hero.json is HMAC-signed so casual hand-editing is detected. The key is random per install
// (never in the repo), so a clone of the public source can't forge a save. NOTE: it still lives on
// this machine, so this is tamper-DETECTION (deters hand-editing), not cryptographic secrecy.
function loadKey() {
  try { const k = readFileSync(KEYFILE, 'utf8').trim(); if (k) return k; } catch {}
  try {
    mkdirSync(DIR, { recursive: true });
    const k = randomBytes(24).toString('hex');
    writeFileSync(KEYFILE, k, { mode: 0o600 });
    return k;
  } catch {}
  return 'code-quest:fallback-key';            // last resort when the filesystem is unwritable
}
const SIGKEY = loadKey();
function sign(o) { return createHmac('sha256', SIGKEY).update(JSON.stringify(o)).digest('hex').slice(0, 16); }

// migrate an old save forward to the current schema. Each step lifts one version; fields the
// current code expects are guaranteed here so a save from any past version keeps the player's level.
// v1 is the baseline for the initial public release — freshHero() already includes all fields.
function migrateHero(d, _fromV) {
  return d;
}
function backupHero(raw) { try { writeAtomic(HERO + '.bak', raw); } catch {} } // never lose a save we couldn't verify

export function loadHero() {
  let raw;
  try { raw = readFileSync(HERO, 'utf8'); } catch { return { ...freshHero() }; }   // genuinely no save yet
  let w;
  try { w = JSON.parse(raw); }
  catch {
    // unparseable main save (e.g. a crash mid plain-write fallback): recover from the last backup
    // before giving up the level. The corrupt bytes must NOT be backed up first — that would
    // overwrite the very copy being recovered; they are kept only when no backup can stand in.
    try { w = JSON.parse(readFileSync(HERO + '.bak', 'utf8')); }
    catch { backupHero(raw); return { ...freshHero() }; }
  }
  const data = w && w.d ? w.d : w;                                  // still LOAD bare stats — the level is never wiped
  if (!data || typeof data !== 'object') return { ...freshHero() };
  // Signature mismatch means a different signing key (e.g. moved machines / lost .key) OR a hand-edit.
  // A save WITHOUT the {d,s} envelope is tampered too: every released version signs on save, so no
  // innocent save lacks it (stripping the envelope must not be a free pass around verification).
  // We DO NOT wipe: the player's hard-won level is preserved, the raw file is backed up, and the next
  // save re-signs it with the current key.
  const tampered = !w.d || sign(w.d) !== w.s;
  if (tampered) backupHero(raw);
  const hero = { ...freshHero(), ...migrateHero(data, w.v) };
  // Plausibility: Lv is ONLY earned by floor clears (+1) and boss wins (+1 / big +2), all counted in
  // the signed ledger — so a level the ledger cannot account for is mathematically impossible.
  const L = hero.ledger || freshLedger();
  const implausible = hero.lv > 1 + (L.floors | 0) + (L.wins | 0) + 2 * (L.bigWins | 0);
  // Either kind of broken lineage locks the hero into the PENITENT ENGINE: LP drains every move,
  // ATK is boosted, and only death (the normal revive) releases the mark. _penitentNew makes
  // the hook announce the sentence this turn (the underscore field is never persisted).
  if ((tampered || implausible) && !hero.penitent) { hero.penitent = true; hero._penitentNew = true; }
  return hero;
}
export function saveHero(s) {
  const L = s.ledger || freshLedger();
  const ledger = { steps: L.steps | 0, floors: L.floors | 0, wins: L.wins | 0, bigWins: L.bigWins | 0 };
  const d = {
    lv: s.lv, lp: s.lp, atk: s.atk, def: s.def, hpbonus: s.hpbonus, buff: s.buff,
    relics: (s.relics || []).slice(-50), revives: s.revives || 0, penitent: !!s.penitent,
    ledger, lastBattle: s.lastBattle || null,
  };
  writeAtomic(HERO, JSON.stringify({ v: SAVE_VERSION, d, s: sign(d) }));
}
export function recalcMax(s) { s.maxlp = maxlpFor(s); s.lp = Math.min(s.lp, s.maxlp); }
// Penitent Engine combat boost: effective ATK while marked — pure offense, no protection, true to
// the Warhammer source. The stored stat is never mutated, so the boost vanishes with the mark.
export const atkOf = (s) => (s.atk || 1) * (s.penitent ? CONFIG.tamper.penitentStatMult : 1);
// DEF + high level shrug off chip damage
export const mitFor = (s) => (s.def || 0) + Math.floor((s.lv || 1) / CONFIG.hero.mitigationLevelDivisor);
export function loadState(cwd) {
  const s = { ...loadHero(), ...readJson(projPath(cwd), freshProj()), _pk: projPath(cwd) };
  recalcMax(s);
  return s;
}
export function saveProj(s) {                          // per-project dungeon only (no hero write)
  try { mkdirSync(PROJDIR, { recursive: true }); } catch {}
  // ev/evk = current event (status line shows it). holdEv/holdEvk/holdUntil = a result the status line
  // keeps showing until holdUntil (so a follow-up command can't bury a boss-fight result before a redraw).
  writeAtomic(s._pk, JSON.stringify({
    v: SAVE_VERSION, track: s.track, pos: s.pos, profile: s.profile, next: s.next,
    amb: s.amb, roll: s.roll, tamed: s.tamed, ev: s.ev, evk: s.evk,
    holdEv: s.holdEv || null, holdEvk: s.holdEvk || null, holdUntil: s.holdUntil || 0,
  }));
}
export function saveState(s) { saveHero(s); saveProj(s); }

// good behavior levels you up (1-maxLevel); a level-up heals to full, a level-down just shrinks the cap.
export function addLv(s, d) {
  const before = s.lv;
  s.lv = clamp(1, CONFIG.hero.maxLevel, s.lv + d);
  s.maxlp = maxlpFor(s);
  if (s.lv > before) s.lp = s.maxlp; else s.lp = Math.min(s.lp, s.maxlp);
}
export function applyDamage(s, dmg) { s.lp = Math.max(0, s.lp - Math.max(1, dmg - mitFor(s))); }
export function grantRelic(s, seedn) {                 // boss loot / rare boon
  if (!Array.isArray(s.relics)) s.relics = [];
  const W = CONFIG.hero.relicWeights;
  let r = hash('relic' + seedn) % (W.atk + W.def + W.hp + W.revive);
  if ((r -= W.atk) < 0) { s.atk = (s.atk || 1) + 1; s.relics.push('ATK'); return STR.relics.atk; }
  if ((r -= W.def) < 0) { s.def = (s.def || 0) + 1; s.relics.push('DEF'); return STR.relics.def; }
  if ((r -= W.hp) < 0) {
    s.hpbonus = (s.hpbonus || 0) + CONFIG.hero.hpRelicBonus;
    recalcMax(s);
    s.lp = s.maxlp;
    s.relics.push('HP');
    return STR.relics.hp;
  }
  s.revives = (s.revives || 0) + 1;                    // consumable revive: a count, not a relics-tally entry
  return STR.relics.phoenix;
}
// Death is the ONLY release from the Penitent Engine: the normal revive applies, the mark lifts,
// and the save is ABSOLVED — the ledger is balanced so the (possibly forged) level now counts as
// paid for in blood. Without this the plausibility check would re-sentence the hero on every load.
export function releasePenance(s) {
  if (!s.penitent) return false;
  s.penitent = false;
  s.ledger = s.ledger || freshLedger();
  const earned = 1 + (s.ledger.floors | 0) + (s.ledger.wins | 0) + 2 * (s.ledger.bigWins | 0);
  if (s.lv > earned) s.ledger.floors = (s.ledger.floors | 0) + (s.lv - earned);
  return true;
}
