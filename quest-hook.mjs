#!/usr/bin/env node
// Code Quest - the Pre/PostToolUse + UserPromptSubmit hook: the game's entry point. Reads one
// hook event from stdin, advances the dungeon one turn, writes the save, exits 0 — always.
// The smell scanner lives in quest-analyze.mjs, the dungeon mechanics in quest-dungeon.mjs and
// the save layer in quest-state.mjs, so each piece (this file included) stays small enough to
// pass its own scan. Never throws into Claude Code: all errors are swallowed.
import { readFileSync, readSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { CONFIG, STR, ANSI, fmt, sparkline, hashStr } from './quest-data.mjs';
import { PROSE_RE } from './quest-rules.mjs';
import { analyze } from './quest-analyze.mjs';
import {
  DIR, clamp, hash, loadState, saveState, logFindings, freshLedger,
  addLv, grantRelic, applyDamage, atkOf, mitFor, releasePenance,
} from './quest-state.mjs';
import { step, setEv, revive, regen, handlePrompt } from './quest-dungeon.mjs';

// Last line of defense for the "never throws" promise above: any uncaught error — a bug, a hostile
// save, an unexpected hook payload — ends the hook quietly with exit 0, so a broken toy can never
// surface a hook warning on the user's tool call.
process.on('uncaughtException', () => process.exit(0));

const MB = 1 << 20;

// stdin carries the whole hook payload, tool_response included. Read it in bounded chunks so a
// pathologically huge payload is DROPPED (the turn becomes a plain step) instead of slurped into
// memory whole. EAGAIN (a rare non-blocking stdin) falls back to one readFileSync slurp — the
// memory spike is unavoidable there, but the size cap still applies before anything is parsed.
function readStdin() {
  const max = CONFIG.store.stdinMaxMB * MB;
  try {
    const chunks = [];
    let total = 0;
    const buf = Buffer.alloc(1 << 16);
    for (;;) {
      let n;
      try { n = readSync(0, buf, 0, buf.length, null); }
      catch (e) {
        if (e.code === 'EOF') break;
        if (e.code !== 'EAGAIN') throw e;
        const rest = readFileSync(0);
        if (total + rest.length > max) return {};
        chunks.push(rest);
        break;
      }
      if (n <= 0) break;
      total += n;
      if (total > max) return {};
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return {}; }
}

const ev = readStdin();
// Code Quest's own commands (/cq, /cq-reroll) run via Bash — they must NOT advance the game or touch
// state, otherwise viewing/rerolling would cost you a dungeon step (and undo a fresh reroll). Match
// only an actual `node .../quest-X.mjs` invocation, NOT any command that merely mentions the filename
// (e.g. a commit touching these files) — that would skip real gameplay.
const RE_OWN_CMD = /\bnode\b[^&|;\n]*quest-(report|reroll|hook|status|nudge)\.mjs/;
if (ev.tool_name === 'Bash' && RE_OWN_CMD.test(String((ev.tool_input || {}).command || ''))) {
  process.exit(0);
}

// PreToolUse just timestamps the tool's start (PostToolUse later measures how long it ran).
// One stamp FILE per tool call, not one shared map: two tools finishing at the same instant would
// race a read-modify-write on a shared map and resurrect each other's deleted stamps (double-counted
// vigils); with separate files each Pre/Post pair only ever touches its own stamp.
const PENDING_DIR = join(DIR, '.pending');
const toolKey = ev.tool_use_id || ev.toolUseId || '_last';
const stampFile = join(PENDING_DIR, hashStr(String(toolKey)));
if (ev.hook_event_name === 'PreToolUse') {
  try {
    mkdirSync(PENDING_DIR, { recursive: true });
    const cut = Date.now() - CONFIG.store.pendingPruneMinutes * 60_000;
    for (const f of readdirSync(PENDING_DIR)) {                            // prune stale stamps
      const p = join(PENDING_DIR, f);
      try { if ((parseInt(readFileSync(p, 'utf8'), 10) || 0) < cut) unlinkSync(p); } catch {}
    }
    writeFileSync(stampFile, String(Date.now()));
  } catch {}
  process.exit(0);
}

const s = loadState(ev.cwd);
s.roll = (s.roll || 0) + 1;
s.ledger = s.ledger || freshLedger();
s.ledger.steps = (s.ledger.steps | 0) + 1;
if (!Array.isArray(s.track)) regen(s);

// how long did this tool run? (paired with the PreToolUse stamp). 0 if unknown.
let elapsedMs = 0;
try {
  const t = parseInt(readFileSync(stampFile, 'utf8'), 10) || 0;
  unlinkSync(stampFile);                                   // consume: an unlink can't clobber sibling stamps
  if (t) elapsedMs = Date.now() - t;
} catch {}

const tool = ev.tool_name || '';
const inp = ev.tool_input || {};
const resp = ev.tool_response || {};

// git commit = a BOSS FIGHT. Status redraws are too sparse to animate, so the whole fight renders
// as ONE self-contained frame: an HP duel simulated here, shown as two HP sparklines + the outcome.
// The fight only happens when a commit actually LANDED: a commit rejected by a pre-commit hook (or
// "nothing to commit") leaves HEAD untouched, so HEAD's committer time must be fresh.
function bossFight() {
  let added = '', fresh = false;
  try {
    const show = execSync('git show --format=%ct --unified=0 HEAD', {
      cwd: ev.cwd || undefined, timeout: 1_500, maxBuffer: 4 * MB, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    const lines = show.split('\n');
    fresh = Math.abs(Date.now() / 1_000 - (parseInt(lines[0], 10) || 0)) <= CONFIG.boss.freshCommitSecs;
    added = lines.slice(1).filter(l => l[0] === '+' && !l.startsWith('+++')).map(l => l.slice(1)).join('\n');
  } catch {}
  const c = analyze(added, added.split('\n').length).counts;
  const smells = c.todos + c.swallow + c.debug + c.dead + c.leaks + c.weak + c.insecure + c.misconfig + c.container;
  const pwr = s.profile.power || 1;
  step(s);                                                      // a commit is still a dungeon step
  if (!added || !fresh) { setEv(s, STR.events.commitSealed, 'dim'); return; } // no new commit landed: no boss
  const B = CONFIG.boss;
  const mit = mitFor(s);
  const fightMax = s.maxlp;                                     // your max HP entering the fight (pre level-up)
  const bHp0 = Math.round(fightMax * B.hpMult) + pwr * B.hpPowerMult + smells * B.hpSmellMult;
  const bDmg = Math.max(1,
    Math.round(fightMax * B.bossDmgFrac + pwr * B.bossDmgPowerMult + smells * B.bossDmgSmellMult) - mit);
  let bHp = bHp0, pHp = s.lp, round = 0, reviveUsed = false;
  const bSeq = [], ySeq = [];                                   // boss/your HP after each round (for the sparklines)
  while (bHp > 0 && pHp > 0 && round < B.maxRounds) {
    round++;
    const die = 1 + (hash('br' + round + s.roll + (s.profile.seed || '')) % B.diceSides);
    const pd = Math.max(1,
      Math.round((s.lv || 1) * B.atkLvMult + atkOf(s) * (s.buff || 1) * B.atkBuffMult) + (c.virtue || 0) + die);
    bHp -= pd;                                                  // your blow lands first
    if (bHp > 0) pHp -= bDmg;                                   // boss strikes back only while still standing
    bSeq.push(Math.max(0, bHp)); ySeq.push(Math.max(0, pHp));
    if (pHp <= 0 && (s.revives || 0) > 0) { s.revives--; reviveUsed = true; break; } // revive ENDS the fight
  }
  const won = !reviveUsed && (bHp <= 0 ? true : (pHp <= 0 ? false : (bHp / bHp0 < pHp / fightMax)));
  const bigBoss = smells >= B.bigBossSmells || pwr >= B.bigBossPower; // dirty diff / high-power dungeon = +2 Lv
  const lvUp = bigBoss ? B.bigBossLvUp : B.normalLvUp;
  let outTxt, outCol, outcome, relicMsg = '';
  if (reviveUsed) {
    s.lp = fightMax;                                            // full heal, fight ends — not a win, no level
    outTxt = STR.boss.revive; outCol = ANSI.cy; outcome = 'revive';
  } else if (won) {
    if (bigBoss) s.ledger.bigWins = (s.ledger.bigWins | 0) + 1; else s.ledger.wins = (s.ledger.wins | 0) + 1;
    addLv(s, lvUp);                                             // victory levels you up (and heals to full)
    s.tamed = Math.min(CONFIG.ambush.tamingCap, (s.tamed || 0) + CONFIG.ambush.tamingStep); // tames the dungeon
    outTxt = fmt(STR.boss.win, { lv: lvUp }); outCol = ANSI.g; outcome = 'win';
    if (hash('drop' + s.roll + (s.profile.seed || '')) % 100 < B.dropChance) {
      relicMsg = grantRelic(s, 'd' + s.roll);                   // loot drop
    }
  } else {
    s.lp = Math.max(1, Math.round(fightMax * B.loseReviveFrac)); // defeated: limp away, keep level, no reward
    outTxt = STR.boss.defeat; outCol = ANSI.red; outcome = 'lose';
  }
  s.buff = CONFIG.buff.bossReset;                               // buff is spent either way
  // ONE pre-colored frame: boss HP sparkline (red) + your HP sparkline (yellow) + outcome.
  const frame = `${ANSI.red}${sparkline(bSeq, bHp0)}${ANSI.reset} `
    + `${ANSI.y}${sparkline(ySeq, fightMax)}${ANSI.reset} ${outCol}${outTxt}${ANSI.reset}`;
  s.ev = frame; s.evk = 'raw';                                  // 'raw' = pre-colored, shown verbatim
  s.holdEv = frame; s.holdEvk = 'raw';
  s.holdUntil = Date.now() + B.holdMs;                          // keep showing it past follow-up commands
  // detailed log for /cq
  s.lastBattle = {
    bHp0, maxlp: fightMax, rounds: bSeq.map((b, i) => ({ b, p: ySeq[i] })),
    outcome, lvUp: won ? lvUp : 0, relic: relicMsg, t: Date.now(),
  };
}

const RE_GIT_COMMIT = /(^|[&|;]\s*)git\s+(\S+\s+){0,5}commit\b/;   // an actual git invocation, not a mere mention
// an actual test runner, not any command merely containing the word "test"
const RE_TEST_RUNNER = new RegExp(
  String.raw`\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(jest|vitest|pytest|playwright|rspec|ctest|tox)\b`
  + String.raw`|\bgo\s+test\b|\bcargo\s+(test|nextest)\b|\bmvn\s+test\b|\bnode\s+--test\b`);

if (ev.hook_event_name === 'UserPromptSubmit' || (ev.prompt && !tool)) {
  handlePrompt(s, ev.prompt);
} else if (tool === 'Read') {
  // payload-shape dependency: content/path come from the tool_response shape Claude Code currently
  // emits (resp.file.{content,filePath,totalLines}). If a future harness changes that shape, every
  // floor just comes out clean — graceful degradation, never an error.
  const f = resp.file || {};
  const seed = f.filePath || inp.file_path || 'void';
  const isProse = PROSE_RE.test(seed);                           // docs = easy floor, only watch for injection
  const prof = analyze(f.content, f.totalLines || f.numLines || 0, isProse, seed);
  const traps = Math.min(4, Math.round(prof.trapDensity * 5));
  const dollars = Math.min(CONFIG.track.secretsCap, prof.secrets);
  if (prof.power > 1 || prof.ambushBias > 0 || traps > 0 || dollars > 0) {  // log only floors that got harder
    logFindings(ev.cwd, {
      t: Date.now(), file: seed, counts: prof.counts,
      hazards: { power: prof.power, traps, dollars, ambushBias: prof.ambushBias },
    });
  }
  s.next = {                                                     // lean profile for gameplay
    power: prof.power, trapDensity: prof.trapDensity, ambushBias: prof.ambushBias,
    secrets: prof.secrets, boonDensity: prof.boonDensity, len: prof.len, seed,
  };
  step(s);
  if (prof.counts.inj > 0) setEv(s, STR.events.taintedDoc, 'mag'); // doc tried to hijack the agent
} else if (tool === 'Bash') {
  const cmd = String(inp.command || '').toLowerCase();
  if (RE_GIT_COMMIT.test(cmd)) {
    bossFight();
  } else if (RE_TEST_RUNNER.test(cmd)) {
    const out = JSON.stringify(resp).toLowerCase();
    const failed = /\bfail(s|ed|ing|ures?)?\b|\berrors?\b|✗|\bnot ok\b/.test(out)
      && !/\b(0|no)\s+(fail|failure|error)/.test(out);
    if (failed) {
      applyDamage(s, CONFIG.test.failDamage);
      s.buff = Math.max(CONFIG.buff.bossReset, (s.buff || 1) - 1);
      if (s.lp <= 0) { revive(s); releasePenance(s); }           // death by failing tests still completes penance
    } else {
      s.lp = Math.min(s.maxlp, s.lp + CONFIG.test.passHeal);
      s.buff = Math.min(CONFIG.buff.testCap, (s.buff || 1) + 1);
    }
    step(s);
    setEv(s, failed ? fmt(STR.events.testsFail, { dmg: CONFIG.test.failDamage })
      : fmt(STR.events.testsPass, { buff: s.buff }), failed ? 'red' : 'g'); // override step event
  } else {
    step(s);
  }
} else {
  step(s); // ANY other tool advances the dungeon: Edit/Write/Grep/Glob, Task/sub-agents, TodoWrite, WebFetch, etc.
}

// THE VIGIL: a long-running tool is the player's idle window — fill it with a reward scaled by the
// wait. Bonus attack buff (+a small heal); a very long vigil forges a relic. Never less than +1.
const mins = elapsedMs / 60_000;
if (mins >= CONFIG.vigil.minMinutes) {
  const b = clamp(1, CONFIG.vigil.buffCap, Math.round(mins / CONFIG.vigil.perMinutes)); // +1 per ~perMinutes
  s.buff = Math.min(CONFIG.buff.max, (s.buff || 1) + b);
  s.lp = Math.min(s.maxlp, s.lp + b);
  if (mins >= CONFIG.vigil.relicMinutes) setEv(s, grantRelic(s, 'vigil' + s.roll), 'cy'); // a long vigil forges a relic
  else setEv(s, fmt(STR.events.vigilBuff, { n: b }), 'cy');
}

// a freshly-detected tampered/implausible save: announce the sentence (unless this very turn's
// drain already killed and released them — then 'penance complete' stands).
if (s._penitentNew) { if (s.penitent) setEv(s, STR.events.penitent, 'mag'); delete s._penitentNew; }

saveState(s);
process.exit(0);
