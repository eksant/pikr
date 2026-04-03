import { compressGeneric, CompressResult } from './generic';
import { compressGit } from './git';
import { compressTestOutput } from './test';
import { compressLs, compressCat, compressGrep } from './fs';

/**
 * Route a command string to the right compressor.
 * cmd: the full original command string (e.g. "git status", "npm test")
 * raw: stdout + stderr of running that command
 */
export function compress(cmd: string, raw: string): CompressResult {
  const parts = cmd.trim().split(/\s+/);
  const bin = parts[0].toLowerCase();
  const sub = parts[1]?.toLowerCase() ?? '';

  // git
  if (bin === 'git') return compressGit(sub, raw);

  // test runners
  if (
    (bin === 'npm'  && (sub === 'test' || sub === 'run')) ||
    (bin === 'pnpm' && (sub === 'test' || sub === 'run')) ||
    (bin === 'yarn' && (sub === 'test' || sub === 'run')) ||
    bin === 'vitest' ||
    bin === 'jest'   ||
    bin === 'pytest' ||
    bin === 'go' && sub === 'test' ||
    bin === 'cargo' && sub === 'test'
  ) {
    return compressTestOutput(raw);
  }

  // filesystem
  if (bin === 'ls')   return compressLs(raw);
  if (bin === 'cat')  return compressCat(raw);
  if (bin === 'grep' || bin === 'rg') return compressGrep(raw);

  // fallback
  return compressGeneric(raw);
}
