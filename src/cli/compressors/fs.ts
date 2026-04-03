import { estimateTokens } from '../tokens';
import { CompressResult } from './generic';

const MAX_LS_ENTRIES = 30;
const MAX_CAT_LINES = 150;
const MAX_GREP_MATCHES = 50;

/** ls — group by extension if too large */
export function compressLs(raw: string): CompressResult {
  const originalTokens = estimateTokens(raw);
  const lines = raw.split('\n').filter(l => l.trim());

  if (lines.length <= MAX_LS_ENTRIES) {
    return { output: raw, originalTokens, savedTokens: 0 };
  }

  // Count by extension
  const extMap = new Map<string, number>();
  const dirCount = lines.filter(l => l.startsWith('d')).length;

  for (const line of lines) {
    const parts = line.split(/\s+/);
    const name = parts[parts.length - 1];
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot) : '(no ext)';
    extMap.set(ext, (extMap.get(ext) ?? 0) + 1);
  }

  const grouped = Array.from(extMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([ext, n]) => `  ${ext.padEnd(12)} ${n} file${n > 1 ? 's' : ''}`)
    .join('\n');

  const output = `${lines.length} entries  (${dirCount} dirs)\n\nBy type:\n${grouped}\n\n[First ${MAX_LS_ENTRIES} entries:]\n${lines.slice(0, MAX_LS_ENTRIES).join('\n')}`;
  return { output, originalTokens, savedTokens: Math.max(0, originalTokens - estimateTokens(output)) };
}

/** cat — truncate long files keeping head + tail */
export function compressCat(raw: string): CompressResult {
  const originalTokens = estimateTokens(raw);
  const lines = raw.split('\n');

  if (lines.length <= MAX_CAT_LINES) {
    return { output: raw, originalTokens, savedTokens: 0 };
  }

  const head = lines.slice(0, 100);
  const tail = lines.slice(-30);
  const omitted = lines.length - 130;

  const output = [
    ...head,
    `\n[... ${omitted} lines omitted — use pikr search for full context ...]\n`,
    ...tail,
  ].join('\n');

  return { output, originalTokens, savedTokens: Math.max(0, originalTokens - estimateTokens(output)) };
}

/** grep — limit matches per file */
export function compressGrep(raw: string): CompressResult {
  const originalTokens = estimateTokens(raw);
  const lines = raw.split('\n').filter(Boolean);

  if (lines.length <= MAX_GREP_MATCHES) {
    return { output: raw, originalTokens, savedTokens: 0 };
  }

  const kept = lines.slice(0, MAX_GREP_MATCHES);
  const omitted = lines.length - MAX_GREP_MATCHES;

  const output = kept.join('\n') + `\n[... ${omitted} more matches omitted]`;
  return { output, originalTokens, savedTokens: Math.max(0, originalTokens - estimateTokens(output)) };
}
