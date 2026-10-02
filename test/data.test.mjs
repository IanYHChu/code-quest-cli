// code-quest:noscan
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, DEFAULT_STRINGS, CONFIG, sanitizeConfig, fmt, maxlpFor, writeAtomic, sparkline } from '../quest-data.mjs';

test('sanitizeConfig falls back on wrong-typed overrides', () => {
  const merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  merged.analyze.magicDigits = 'oops';        // string where a number belongs
  merged.lane = 'nope';                       // scalar where an object belongs
  merged.boss.sparkBlocks = 7;                // number where a string belongs
  merged.ambush.baseAggro = '35';             // numeric string is coerced, not rejected
  merged.scan.noscanFiles = 'quest-*';        // scalar where an array belongs
  const c = sanitizeConfig(merged, DEFAULT_CONFIG);
  assert.equal(c.analyze.magicDigits, DEFAULT_CONFIG.analyze.magicDigits);
  assert.equal(c.lane.min, DEFAULT_CONFIG.lane.min);
  assert.equal(c.boss.sparkBlocks, DEFAULT_CONFIG.boss.sparkBlocks);
  assert.equal(c.ambush.baseAggro, 35);
  assert.deepEqual(c.scan.noscanFiles, DEFAULT_CONFIG.scan.noscanFiles);
});

test('sanitizeConfig also guards user strings overrides', () => {
  const merged = JSON.parse(JSON.stringify(DEFAULT_STRINGS));
  merged.report.smells = 'nope';              // scalar where the smell catalog (array) belongs
  merged.flavor = 42;                         // scalar where an array belongs
  merged.events.trap = 123;                   // number where a string belongs
  const s = sanitizeConfig(merged, DEFAULT_STRINGS);
  assert.deepEqual(s.report.smells, DEFAULT_STRINGS.report.smells);
  assert.deepEqual(s.flavor, DEFAULT_STRINGS.flavor);
  assert.equal(s.events.trap, DEFAULT_STRINGS.events.trap);
});

test('fmt expands known vars and leaves unknown placeholders visible', () => {
  assert.equal(fmt('Lv{lv} +{n}', { lv: 5, n: 2 }), 'Lv5 +2');
  assert.equal(fmt('{missing} stays', {}), '{missing} stays');
  assert.equal(fmt(null), '');
});

test('maxlpFor follows the documented formula and clamps the level', () => {
  const H = CONFIG.hero;
  assert.equal(maxlpFor({ lv: 1 }), H.lpBase);
  assert.equal(maxlpFor({ lv: 10, hpbonus: 5 }), H.lpBase + 9 * H.lpPerLevel + 5);
  assert.equal(maxlpFor({ lv: 9999 }), maxlpFor({ lv: H.maxLevel }));
});

test('writeAtomic leaves a complete file and no temp droppings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cq-atomic-'));
  const p = join(dir, 'out.json');
  writeAtomic(p, '{"ok":true}');
  assert.equal(readFileSync(p, 'utf8'), '{"ok":true}');
  writeAtomic(p, '{"ok":2}');
  assert.equal(readFileSync(p, 'utf8'), '{"ok":2}');
  rmSync(dir, { recursive: true, force: true });
});

test('sparkline maps values onto the glyph ramp', () => {
  const b = CONFIG.boss.sparkBlocks;
  const line = sparkline([0, 50, 100], 100);
  assert.equal(line.length, 3);
  assert.equal(line[0], b[0]);
  assert.equal(line[2], b[b.length - 1]);
});

test('applyOverrides overlays CONFIG in place and type-guards it', async () => {
  const { CONFIG: C, applyOverrides, DEFAULT_CONFIG: D } = await import('../quest-config.mjs');
  const before = C;
  applyOverrides({ config: { lane: { min: 'nope' }, analyze: { magicDigits: 5 } } });
  assert.equal(C, before, 'same object, so earlier importers see the change');
  assert.equal(C.lane.min, D.lane.min, 'wrong-typed value falls back to the default');
  assert.equal(C.analyze.magicDigits, 5);
  applyOverrides({ config: {} });
  assert.equal(C.analyze.magicDigits, D.analyze.magicDigits);
});
