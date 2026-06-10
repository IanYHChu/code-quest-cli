// Code Quest - the dungeon mechanics: track generation, the step machine (tiles, ambushes,
// death/penance), the event line, and the prompt-as-spell scoring. State persistence lives in
// quest-state.mjs; the smell scanner in quest-analyze.mjs; this module is pure game flow and is
// scanned like any other code. All balance numbers come from CONFIG and all text from STR.
import { CONFIG, STR, fmt } from './quest-data.mjs';
import { hash, clamp, CLEAN, addLv, mitFor, grantRelic, releasePenance } from './quest-state.mjs';
import { INJ_CONTROL, INJ_TARGET, INJ_JAILBREAK, INJ_FAKETAG, INJ_BENIGN } from './quest-rules.mjs';

function place(t, startIdx, ch) {                      // linear-probe for a free floor tile in 1..len-1
  const len = t.length;
  for (let k = 0; k < len; k++) {
    const p = 1 + ((startIdx - 1 + k + (len - 1)) % (len - 1));
    if (t[p] === '.') { t[p] = ch; return; }
  }
}
export function genTrack(profile, roll, lv = 1) {
  const seed = profile.seed || 'origin';
  // length grows with file size AND your level: higher Lv = longer floors = more steps per level,
  // so leveling curves from fast (early) to slow (late) instead of being flat/linear.
  const len = clamp(CONFIG.lane.genMin, CONFIG.lane.genMax,
    (profile.len || CONFIG.lane.base) + Math.floor((lv || 1) * CONFIG.lane.levelLengthFactor));
  const t = new Array(len).fill('.');
  const exitAt = clamp(CONFIG.track.exitMinFromStart, len - 2,
    Math.floor(len / 2) + (hash(seed + ':' + roll) % Math.max(1, Math.floor(len / 3))));
  t[exitAt] = '*';                                     // exit in the latter half
  const nsec = Math.min(CONFIG.track.secretsCap, profile.secrets);  // $ claims a slot first - it's the whole point
  for (let i = 0; i < nsec; i++) place(t, 1 + (hash(seed + '$' + i) % (len - 1)), '$');
  const ntrap = Math.min(len - 3, Math.round(profile.trapDensity * (len - 2) * CONFIG.track.trapFactor));
  for (let i = 0; i < ntrap; i++) place(t, 1 + (hash(seed + '#' + i) % (len - 1)), '#');
  // baseline event layer: even neutral floors loot sometimes
  const baseBoon = (hash(seed + 'base') % 100) < CONFIG.track.baseBoonChance ? 1 : 0;
  const nboon = Math.min(len - 3,
    Math.round((profile.boonDensity || 0) * (len - 2) * CONFIG.track.boonFactor) + baseBoon);
  for (let i = 0; i < nboon; i++) place(t, 1 + (hash(seed + '+' + i) % (len - 1)), '+');
  return t;
}

export function regen(s) {
  s.profile = s.next || s.profile || { ...CLEAN };
  s.track = genTrack(s.profile, s.roll, s.lv);
  s.pos = 0;
  s.amb = { back: false, front: false };
}
export function revive(s) { if (s.lp <= 0) s.lp = s.maxlp; }         // gentle: revive at full, level kept
export function dieReborn(s) {
  revive(s);
  if (releasePenance(s)) setEv(s, STR.events.penanceDone, 'cy');
  else setEv(s, STR.events.fell, 'y');
}

// Ambushes are the RANDOM layer: a small FIXED chip (not power-scaled), so bad luck never outweighs
// behavior. Code health only nudges how OFTEN they happen, never how hard they hit.
export function rollAmbush(s, mit = 0) {
  s.amb = { back: false, front: false, dealt: 0 };
  // clean ~baseAggro; debt widens, taming shrinks
  const aggro = clamp(0, CONFIG.ambush.maxAggro,
    CONFIG.ambush.baseAggro + (s.profile.ambushBias || 0) - (s.tamed || 0));
  if (hash('A' + s.roll + s.profile.seed) % 100 >= aggro) return;    // most steps: nothing happens
  const t = hash('T' + s.roll + s.profile.seed) % 100;               // a second roll picks the kind
  if (t < CONFIG.ambush.pincerThreshold) { s.amb.back = true; s.amb.front = true; } // pincer — rarest, worst
  else if (t < CONFIG.ambush.rearThreshold) s.amb.back = true;       // rear — most common
  else s.amb.front = true;                                           // front
  let d = 0;
  if (s.amb.back) d += Math.max(1, CONFIG.ambush.backDmg - mit);     // small fixed bites, reduced by DEF/level
  if (s.amb.front) d += Math.max(1, CONFIG.ambush.frontDmg - mit);
  s.amb.dealt = d;
  s.lp = Math.max(0, s.lp - d);
}

export function setEv(s, ev, evk) { s.ev = String(ev).slice(0, 20); s.evk = evk; }
// vary "nothing happened" so it feels alive
export const flavor = (s) => STR.flavor[hash('x' + s.roll + s.profile.seed) % STR.flavor.length];

export function step(s) {
  if (!Array.isArray(s.track)) regen(s);
  // the Penitent Engine drains its pilot on every move; draining to 0 here IS the death that frees you
  if (s.penitent) {
    s.lp = Math.max(0, s.lp - CONFIG.tamper.penitentDrain);
    if (s.lp <= 0) { dieReborn(s); return; }
  }
  s.pos++;
  if (s.pos >= s.track.length) { regen(s); setEv(s, flavor(s), 'dim'); return; }
  const tile = s.track[s.pos];
  if (tile === '*') {                                  // clear a floor: Lv+1, max-HP up, full heal
    s.ledger.floors = (s.ledger.floors | 0) + 1;
    addLv(s, 1);
    regen(s);
    setEv(s, fmt(STR.events.floorClear, { lv: s.lv }), 'g');
    return;
  }
  const mit = mitFor(s);
  const pw = s.profile.power;
  // behavior-driven hazards scale with power
  const dTrap = Math.max(1, pw - mit), dLeak = Math.max(1, pw * CONFIG.hazard.leakMultiplier - mit);
  let relicMsg = '';
  if (tile === '#') s.lp = Math.max(0, s.lp - dTrap);
  else if (tile === '$') s.lp = Math.max(0, s.lp - dLeak);          // hardcoded secret: bites hardest
  else if (tile === '+') {
    s.lp = Math.min(s.maxlp, s.lp + CONFIG.hazard.boonHeal);
    if (hash('rb' + s.roll + s.profile.seed) % 100 < CONFIG.hazard.boonRelicChance) {
      relicMsg = grantRelic(s, 'b' + s.roll + s.profile.seed);
    }
  }
  rollAmbush(s, mit);
  // pick the most salient event for this step (rare relic > tile stepped on > ambush > quiet)
  if (relicMsg) setEv(s, relicMsg, 'cy');
  else if (tile === '$') setEv(s, fmt(STR.events.leak, { dmg: dLeak }), 'red');
  else if (tile === '#') setEv(s, fmt(STR.events.trap, { dmg: dTrap }), 'red');
  else if (s.amb.back && s.amb.front) setEv(s, fmt(STR.events.pincer, { dmg: s.amb.dealt }), 'red');
  else if (s.amb.back) setEv(s, fmt(STR.events.ambushBack, { dmg: s.amb.dealt }), 'red');
  else if (s.amb.front) setEv(s, fmt(STR.events.ambushFront, { dmg: s.amb.dealt }), 'red');
  else if (tile === '+') setEv(s, fmt(STR.events.loot, { n: CONFIG.hazard.boonHeal }), 'cy');
  else setEv(s, flavor(s), 'dim');
  if (s.lp <= 0) dieReborn(s);
}

// --- your prompt is your turn to ACT. Quality is scored deterministically (zero tokens). ---
// Injection/jailbreak lexicon adapted from a prompt-injection detection ruleset; prompt-quality
// signals follow common prompt-engineering best practices (context/constraints/format/steps).
const Q_CONSTRAINT = /\b(because|so that|ensure|must|should|avoid|only|given|constraint|requirement|don'?t)\b/i;
const Q_CODEREF = /`[^`]+`|\b\w+\.(ts|js|py|go|rs|java|json|ya?ml|md|sh|tsx|jsx|c|cpp|rb|php)\b/i;
const Q_STEPS = /\b(step|steps|plan|first|then|outline|break ?down|approach)\b/i;
const Q_EXAMPLE = /\b(example|e\.g\.|for instance|like this)\b/i;
const Q_FORMAT = /\b(format|json|table|list|bullet|markdown|return|output)\b/i;
const Q_VAGUE = /^(fix( it)?|do it|make it (better|work)|help|continue|go|next|again|ok|yes|更好|修一下|繼續)\b/i;

export function handlePrompt(s, text) {
  const P = CONFIG.prompt;
  const p = String(text || '');
  const hostile = (INJ_CONTROL.test(p) && INJ_TARGET.test(p)) || INJ_JAILBREAK.test(p) || INJ_FAKETAG.test(p);
  if (hostile && !INJ_BENIGN.test(p)) {
    setEv(s, STR.events.forbidden, 'mag');             // neutral easter egg, no stat change
    return;
  }
  const t = p.trim();
  if (t.length < P.minLen || Q_VAGUE.test(t)) { setEv(s, STR.events.mumble, 'dim'); return; } // a lazy prompt fizzles
  let score = 0;
  if (t.length >= P.scoreLenMin && t.length <= P.scoreLenMax) score++;
  if (Q_CONSTRAINT.test(p)) score++;
  if (Q_CODEREF.test(p)) score++;
  if (Q_STEPS.test(p)) score++;
  if (Q_EXAMPLE.test(p) || /```/.test(p)) score++;
  if (Q_FORMAT.test(p)) score++;
  if ((p.match(/[.!?\n]/g) || []).length >= P.sentenceCount) score++;
  if (score >= P.healScoreThreshold) {
    const heal = clamp(P.healMin, P.healMax, score);
    s.lp = Math.min(s.maxlp, s.lp + heal);             // good prompt = in-dungeon heal (level comes from commits/tests)
    let struck = false;
    if (score >= P.strikeScoreThreshold && Array.isArray(s.track)) { // strike: clear the nearest hazard ahead
      for (let i = s.pos + 1; i < s.track.length; i++) {
        if (s.track[i] === '#' || s.track[i] === '$') { s.track[i] = '.'; struck = true; break; }
      }
    }
    setEv(s, struck ? fmt(STR.events.castClears, { heal }) : fmt(STR.events.castFocus, { heal }), 'cy');
  } else {
    setEv(s, STR.events.weakCast, 'dim');
  }
}
