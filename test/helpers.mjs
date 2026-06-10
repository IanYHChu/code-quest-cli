// code-quest:noscan
// Shared test helpers: every test runs the real scripts as black boxes in a throwaway HOME
// (os.homedir() honors $HOME on POSIX), feeding hook-event JSON on stdin.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const tmpHome = () => mkdtempSync(join(tmpdir(), 'cq-test-'));
export const stateDir = (home) => join(home, '.claude', 'code-quest');
export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function run(script, { home, input = '', args = [], cwd } = {}) {
  return spawnSync(process.execPath, [join(ROOT, script), ...args], {
    input, cwd: cwd || ROOT, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HOME: home },
  });
}

// the runtime's own project-key hash, so expected state-file paths can never drift from it
import { hashStr } from '../quest-data.mjs';
export { hashStr };
export const projFile = (home, cwd) => join(stateDir(home), 'projects', hashStr(cwd) + '.json');
export const findingsFile = (home, cwd) => join(stateDir(home), 'projects', hashStr(cwd) + '.findings.jsonl');

export function readEvent(cwd, filePath, content, totalLines) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Read', cwd,
    tool_input: { file_path: filePath },
    tool_response: { file: { filePath, content, totalLines: totalLines ?? content.split('\n').length } },
  });
}

export function bashEvent(cwd, command, stdout = '') {
  return JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd,
    tool_input: { command },
    tool_response: { stdout },
  });
}
