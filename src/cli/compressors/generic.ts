import { estimateTokens } from '../tokens';

export interface CompressResult {
  output: string;
  originalTokens: number;
  savedTokens: number;
}

const MAX_LINES = 400;
const MAX_CHARS = 32_000;

/** Fallback compressor: dedup consecutive identical lines + truncate. */
export function compressGeneric(raw: string): CompressResult {
  const originalTokens = estimateTokens(raw);

  const lines = raw.split('\n');
  const deduped: string[] = [];
  let run = 1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === lines[i + 1]) {
      run++;
    } else {
      deduped.push(run > 1 ? `${lines[i]}  [×${run}]` : lines[i]);
      run = 1;
    }
  }

  // Collapse 3+ consecutive blank lines to 1
  const collapsed: string[] = [];
  let blanks = 0;
  for (const line of deduped) {
    if (line.trim() === '') {
      blanks++;
      if (blanks <= 1) collapsed.push(line);
    } else {
      blanks = 0;
      collapsed.push(line);
    }
  }

  // Truncate
  let result = collapsed;
  let truncated = false;
  if (collapsed.length > MAX_LINES) {
    result = collapsed.slice(0, MAX_LINES);
    truncated = true;
  }

  let output = result.join('\n');
  if (output.length > MAX_CHARS) {
    output = output.slice(0, MAX_CHARS);
    truncated = true;
  }

  if (truncated) {
    const omitted = lines.length - result.length;
    output += `\n[... ${omitted} lines omitted — use pikr search for full context]`;
  }

  return { output, originalTokens, savedTokens: Math.max(0, originalTokens - estimateTokens(output)) };
}
